export type LayoutWhPick = 'ASM1' | 'ASM3' | 'J';

export interface LayoutLocGroup {
  id: string;
  label: string;
  slots: string[];
}

const ASM3_ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'K', 'L'];
const QUALITY_LETTERS = ['R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'O'];

function rangeSlots(prefix: string, from: number, to: number): string[] {
  const out: string[] = [];
  for (let i = from; i <= to; i++) out.push(`${prefix}${i}`);
  return out;
}

/** Token kho J: vị trí bắt đầu bằng R1–R99 hoặc S1–S99 (kèm hậu tố cũng tính). */
export function isJWarehouseLocation(loc: string): boolean {
  const raw = String(loc || '').trim().toUpperCase().replace(/\s+/g, '');
  return /^[RS](0?[1-9]|[1-9]\d)(?!\d)/.test(raw);
}

const J_RACK_SHORT_BLOCKS = new Set([1, 4]);

export type JRackLoc = {
  rack: number;
  block: number;
  level: number;
  pos: string;
};

/** R01 / R05 — mã dãy kệ. */
export function formatJRackAisle(rack: number): string {
  return `R${String(rack).padStart(2, '0')}`;
}

/** R05-2 — cả block kệ. */
export function formatJRackBlock(rack: number, block: number): string {
  return `${formatJRackAisle(rack)}-${block}`;
}

/** R01-3-4A — kệ, block, tầng + vị trí mâm. */
export function formatJRackSlot(rack: number, block: number, level: number, pos: string): string {
  return `${formatJRackBlock(rack, block)}-${level}${String(pos || '').toUpperCase()}`;
}

export function parseJRackLocation(loc: string): JRackLoc | null {
  const raw = String(loc || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!raw) return null;
  const neuSlot = /^R0*(\d{1,2})-([1-6])-(\d+)([A-C])$/.exec(raw);
  if (neuSlot) {
    return { rack: Number(neuSlot[1]), block: Number(neuSlot[2]), level: Number(neuSlot[3]), pos: neuSlot[4] };
  }
  const neuBlock = /^R0*(\d{1,2})-([1-6])$/.exec(raw);
  if (neuBlock) {
    return { rack: Number(neuBlock[1]), block: Number(neuBlock[2]), level: 0, pos: '' };
  }
  const oldSlot = /^R(\d{1,2})([1-6])-(\d+)([A-C])$/.exec(raw);
  if (oldSlot) {
    return { rack: Number(oldSlot[1]), block: Number(oldSlot[2]), level: Number(oldSlot[3]), pos: oldSlot[4] };
  }
  const aisle = /^R0*(\d{1,2})$/.exec(raw);
  if (aisle) return { rack: Number(aisle[1]), block: 0, level: 0, pos: '' };
  return null;
}

export function normalizeJRackLocation(loc: string): string {
  const p = parseJRackLocation(loc);
  if (!p) return String(loc || '').trim().toUpperCase();
  if (p.level && p.pos) return formatJRackSlot(p.rack, p.block, p.level, p.pos);
  if (p.block) return formatJRackBlock(p.rack, p.block);
  return formatJRackAisle(p.rack);
}

export function listJRackBlockSlots(rack: number, block: number): string[] {
  const poses = J_RACK_SHORT_BLOCKS.has(block) ? ['A', 'B'] : ['A', 'B', 'C'];
  const out: string[] = [];
  for (let lv = 1; lv <= 4; lv++) {
    for (const pos of poses) out.push(formatJRackSlot(rack, block, lv, pos));
  }
  return out;
}

export function compactJRackLocations(tokens: string[]): string[] {
  const out: string[] = [];
  const byBlock = new Map<string, Set<string>>();
  const order: string[] = [];
  for (const raw of tokens) {
    const key = normalizeJRackLocation(raw);
    if (!key) continue;
    const p = parseJRackLocation(key);
    if (!p || !p.block) {
      if (!out.includes(key)) out.push(key);
      continue;
    }
    const bk = formatJRackBlock(p.rack, p.block);
    if (!byBlock.has(bk)) {
      byBlock.set(bk, new Set());
      order.push(bk);
    }
    if (!p.level) byBlock.get(bk)!.add(bk);
    else byBlock.get(bk)!.add(key);
  }
  for (const bk of order) {
    const set = byBlock.get(bk)!;
    if (set.has(bk)) {
      if (!out.includes(bk)) out.push(bk);
      continue;
    }
    const p = parseJRackLocation(bk);
    const all = p ? listJRackBlockSlots(p.rack, p.block) : [];
    if (all.length && all.every((s) => set.has(s))) {
      out.push(bk);
      continue;
    }
    for (const s of all) {
      if (set.has(s) && !out.includes(s)) out.push(s);
    }
    for (const s of set) {
      if (!out.includes(s)) out.push(s);
    }
  }
  return out;
}

/** Dãy kệ S trong kho mát J: 0.5m; S01 cách vách VP Kho 5.5m; S01–S02 = 2 block, các dãy sau = 3 block × 7 tầng. Kéo đến sát kho hóa chất. */
export function listJKhoMatRowIds(): string[] {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const khoMatW = 18.6;
  const extW = 10;
  const chemW = 1.5;
  const totalW = khoMatW + extW - chemW;
  const narrowW = 0.5;
  const gap = 0.8;
  const s01FromVp = 5.5;
  const ids: string[] = [];
  let xRight = round2(totalW - s01FromVp);
  while (round2(xRight - narrowW) >= 0) {
    ids.push(`S${String(ids.length + 1).padStart(2, '0')}`);
    const leftColX = round2(xRight - narrowW * 2);
    if (leftColX >= 0) {
      ids.push(`S${String(ids.length + 1).padStart(2, '0')}`);
    }
    xRight = round2(leftColX - gap);
  }
  return ids;
}

function jKhoMatSlotsForRow(rowId: string): string[] {
  const slots: string[] = [];
  const blocks = jKhoMatBlocksForRow(rowId);
  for (let block = 1; block <= blocks; block++) {
    for (let lv = 1; lv <= 7; lv++) {
      slots.push(`${rowId}-${block}-${lv}`);
    }
  }
  return slots;
}

/** S01–S02: 2 kệ; các dãy S còn lại: 3 kệ. */
export function jKhoMatBlocksForRow(rowId: string): number {
  const n = jKhoMatSRowNum(rowId);
  return n >= 1 && n <= 2 ? 2 : 3;
}

/** Quy định dãy S kho mát. Các dãy chưa ghi sẽ set sau. */
export interface JKhoMatSRule {
  from: number;
  to: number;
  code: string;
  label: string;
}

export const J_KHO_MAT_S_RULES: JKhoMatSRule[] = [
  { from: 1, to: 6, code: 'B018', label: 'B018' },
  { from: 7, to: 10, code: 'B009', label: 'B009' },
  { from: 11, to: 14, code: 'B016', label: 'B016' },
  { from: 15, to: 15, code: 'B007', label: 'B007' },
  { from: 16, to: 16, code: 'B008', label: 'B008' }
];

export function jKhoMatSRowNum(id: string): number {
  const m = /^S(\d{1,2})$/i.exec(String(id || '').trim());
  return m ? Number(m[1]) : 0;
}

export function jKhoMatSRuleOfRow(id: string): JKhoMatSRule | null {
  const n = jKhoMatSRowNum(id);
  if (!n) return null;
  return J_KHO_MAT_S_RULES.find((r) => n >= r.from && n <= r.to) || null;
}

export function jKhoMatSRuleLabel(id: string): string {
  const rule = jKhoMatSRuleOfRow(id);
  if (!rule) return '';
  return rule.label === rule.code ? rule.code : `${rule.label} (${rule.code})`;
}

export function jKhoMatSFirstRowForPrefix(prefix: string): string {
  const code = String(prefix || '').trim().toUpperCase();
  const rule = J_KHO_MAT_S_RULES.find((r) => r.code === code);
  if (!rule) return '';
  return `S${String(rule.from).padStart(2, '0')}`;
}

export function jKhoMatSRowIdFromSlot(slot: string): string {
  const m = /^(S\d{2})-/i.exec(String(slot || '').trim());
  return m ? m[1].toUpperCase() : '';
}

/** Đưa vị trí ASM3 về dạng Materials: ASM3-D45. */
export function normalizeLayoutLocToken(loc: string, wh?: LayoutWhPick): string {
  const raw = String(loc || '').trim().toUpperCase();
  if (!raw) return '';
  const m = raw.match(/^(?:WH3-|ASM3-)?([A-IK-L])(\d{1,2})$/);
  if (m && (wh === 'ASM3' || /^(WH3-|ASM3-)/.test(raw))) {
    return `ASM3-${m[1]}${Number(m[2])}`;
  }
  return raw;
}

let jLayoutGroupsCache: LayoutLocGroup[] | null = null;

export function getLayoutLocationGroups(wh: LayoutWhPick): LayoutLocGroup[] {
  if (wh === 'ASM3') {
    return ASM3_ROWS.map((row) => ({
      id: row,
      label: `Dãy ${row}`,
      slots: Array.from({ length: 60 }, (_, i) => `ASM3-${row}${i + 1}`)
    }));
  }

  if (wh === 'J') {
    if (jLayoutGroupsCache) return jLayoutGroupsCache;
    jLayoutGroupsCache = Array.from({ length: 28 }, (_, r) => {
      const rack = r + 1;
      const slots: string[] = [];
      for (let block = 1; block <= 6; block++) {
        slots.push(...listJRackBlockSlots(rack, block));
      }
      const id = formatJRackAisle(rack);
      return { id, label: id, slots };
    }).concat(
      listJKhoMatRowIds().map((rowId) => ({
        id: rowId,
        label: rowId,
        slots: jKhoMatSlotsForRow(rowId)
      }))
    );
    return jLayoutGroupsCache;
  }

  const groups: LayoutLocGroup[] = [];
  for (const letter of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
    const max = letter === 'A' ? 12 : 9;
    groups.push({
      id: letter,
      label: `Dãy ${letter}`,
      slots: rangeSlots(letter, 1, max)
    });
  }
  groups.push({
    id: 'mix',
    label: 'Mixzone / khác',
    slots: ['F7', 'F8', 'F9', 'G7', 'G8', 'G9', 'P', 'IQC', 'NG', 'F62', 'F62TRA', 'H11', 'Q1', 'Q2', 'Q3', 'Locker1', 'Locker2', 'Locker', 'Frigde']
  });
  const quality: string[] = [];
  for (const L of QUALITY_LETTERS) {
    for (let n = 1; n <= 3; n++) {
      quality.push(`${L}${n}(R)`, `${L}${n}(L)`);
    }
  }
  groups.push({ id: 'quality', label: 'Kệ Quality', slots: quality });
  return groups;
}
