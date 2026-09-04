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

/** Token J warehouse: R11-1A (kệ thường) hoặc S01-1-3 (kệ kho mát, 7 tầng, không A/B/C). */
export function isJWarehouseLocation(loc: string): boolean {
  const raw = String(loc || '').trim().toUpperCase();
  if (/^R\d+-\d[ABC]\b/.test(raw)) return true;
  return /^S\d{2}-\d+-\d+\b/.test(raw);
}

/** Dãy kệ S trong kho mát J (18.6m): 0.5m; S01–S06 = 2 block, các dãy sau = 3 block × 7 tầng. */
export function listJKhoMatRowIds(): string[] {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const roomEnd = 18.6;
  const wideW = 1;
  const narrowW = 0.5;
  const gap = 0.8;
  const ids: string[] = [];
  let x = round2(wideW + gap);
  while (round2(x + narrowW) <= roomEnd) {
    ids.push(`S${String(ids.length + 1).padStart(2, '0')}`);
    const secondX = round2(x + narrowW);
    if (round2(secondX + narrowW) <= roomEnd) {
      ids.push(`S${String(ids.length + 1).padStart(2, '0')}`);
    }
    x = round2(secondX + narrowW + gap);
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

/** S01–S06: 2 kệ; các dãy S còn lại: 3 kệ. */
export function jKhoMatBlocksForRow(rowId: string): number {
  const n = jKhoMatSRowNum(rowId);
  return n >= 1 && n <= 6 ? 2 : 3;
}

/** Quy định dãy S kho mát. Các dãy chưa ghi sẽ set sau. */
export interface JKhoMatSRule {
  from: number;
  to: number;
  code: string;
  label: string;
}

export const J_KHO_MAT_S_RULES: JKhoMatSRule[] = [
  { from: 6, to: 9, code: 'B009', label: 'B009' },
  { from: 10, to: 13, code: 'B016', label: 'B016' },
  { from: 14, to: 15, code: 'B008', label: 'B008' }
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

export function getLayoutLocationGroups(wh: LayoutWhPick): LayoutLocGroup[] {
  if (wh === 'ASM3') {
    return ASM3_ROWS.map((row) => ({
      id: row,
      label: `Dãy ${row}`,
      slots: Array.from({ length: 60 }, (_, i) => `ASM3-${row}${i + 1}`)
    }));
  }

  if (wh === 'J') {
    const shortBlocks = new Set([1, 4]);
    return Array.from({ length: 30 }, (_, r) => {
      const rack = r + 1;
      const slots: string[] = [];
      for (let block = 1; block <= 6; block++) {
        const poses = shortBlocks.has(block) ? ['A', 'B'] : ['A', 'B', 'C'];
        for (let lv = 1; lv <= 4; lv++) {
          for (const pos of poses) {
            slots.push(`R${rack}${block}-${lv}${pos}`);
          }
        }
      }
      return { id: `R${rack}`, label: `R${rack}`, slots };
    }).concat(
      listJKhoMatRowIds().map((rowId) => ({
        id: rowId,
        label: rowId,
        slots: jKhoMatSlotsForRow(rowId)
      }))
    );
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
