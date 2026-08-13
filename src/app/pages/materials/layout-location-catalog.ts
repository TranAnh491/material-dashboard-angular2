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

/** Token J warehouse: R11-1A (rack+block - tầng + A/B/C). Không nhầm kệ Quality R1(R). */
export function isJWarehouseLocation(loc: string): boolean {
  return /^R\d+-\d[ABC]\b/i.test(String(loc || '').trim());
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
      return { id: `R${rack}`, label: `Dãy R${rack}`, slots };
    });
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
