export interface ParsedWarehouseLocation {
  shelf: string;
  slot: string | null;
  raw: string;
}

export function parseWarehouseLocation(
  location: string,
  knownShelves: string[]
): ParsedWarehouseLocation | null {
  const raw = String(location || '').trim().toUpperCase();
  if (!raw) return null;

  const sorted = [...new Set(knownShelves.map(s => s.toUpperCase()))].sort(
    (a, b) => b.length - a.length
  );

  const dotMatch = raw.match(/^([A-Z]+\d*)\.(\d+)/i);
  if (dotMatch) {
    const shelf = matchShelf(dotMatch[1].toUpperCase(), sorted);
    if (shelf) {
      return { shelf, slot: dotMatch[2], raw };
    }
  }

  for (const shelf of sorted) {
    if (!raw.startsWith(shelf)) continue;

    const remainder = raw.slice(shelf.length);
    const slotMatch = remainder.match(/^(\d+)/);
    if (slotMatch) {
      return { shelf, slot: slotMatch[1], raw };
    }

    if (!remainder || /^[^0-9]/.test(remainder)) {
      return { shelf, slot: null, raw };
    }
  }

  if (raw.startsWith('IQC')) {
    const plusRef = raw.match(/^IQC\+(.+)$/)?.[1] || null;
    if (plusRef) {
      const nested = parseWarehouseLocation(plusRef, sorted);
      if (nested) {
        return { shelf: 'IQC', slot: nested.slot, raw };
      }
      return { shelf: 'IQC', slot: null, raw };
    }
    const suffix = raw.slice(3).match(/^(\d+)/)?.[1] || null;
    return { shelf: 'IQC', slot: suffix, raw };
  }

  return null;
}

function matchShelf(part: string, sorted: string[]): string | null {
  if (sorted.includes(part)) return part;
  for (const shelf of sorted) {
    if (part.startsWith(shelf)) return shelf;
  }
  return null;
}

/** Dãy kệ từ vị trí/kệ (A1→A, F6→F, R3(R)→R, A12→A12). */
export function extractRackLetter(location: string, knownShelves: string[]): string {
  const raw = String(location || '').trim().toUpperCase();
  if (!raw) return '';

  const parsed = parseWarehouseLocation(raw, knownShelves);
  const shelf = parsed?.shelf || raw;

  if (shelf === 'A12') return 'A12';
  if (shelf.startsWith('IQC')) return 'IQC';
  if (shelf.startsWith('NG')) return 'NG';

  const m = /^([A-Z]+)/.exec(shelf);
  return m ? m[1] : shelf.charAt(0);
}

/** Đầu mã B+3 số (VD: B018127 → B018). */
export function extractMaterialPrefix4(materialCode: string): string {
  const compact = String(materialCode || '').replace(/\s/g, '').toUpperCase();
  const m = /^B(\d{3})/.exec(compact);
  if (m) return `B${m[1]}`;
  return compact.length >= 4 ? compact.substring(0, 4) : compact;
}

const RACK_LETTER_ORDER = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G',
  'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'O', 'Q', 'A12', 'K',
  'IQC', 'NG'
];

/** Mọi vị trí bắt đầu bằng IQC (IQC, IQC+F1-0001, IQC+F7, …). */
export function isIqcPrefixLocation(loc: string): boolean {
  return String(loc || '').replace(/\s/g, '').toUpperCase().startsWith('IQC');
}

/** Phần sau IQC+ (VD: IQC+F1-0001 → F1-0001). */
export function extractIqcPlusRef(loc: string): string | null {
  const raw = String(loc || '').replace(/\s/g, '').toUpperCase();
  const m = /^IQC\+(.+)$/.exec(raw);
  return m ? m[1] : null;
}

export const FINISHED_GOODS_GUIDANCE = 'Lưu trữ thành phẩm';

/** A1–A6, B1–B9, C1–C9: khu lưu thành phẩm. */
export function isFinishedGoodsShelf(shelfOrLoc: string, knownShelves: string[] = []): boolean {
  const raw = String(shelfOrLoc || '').trim().toUpperCase();
  const parsed = knownShelves.length ? parseWarehouseLocation(raw, knownShelves) : null;
  const shelf = (parsed?.shelf || raw).toUpperCase();
  if (/^A[1-6]$/.test(shelf)) return true;
  if (/^B[1-9]$/.test(shelf)) return true;
  if (/^C[1-9]$/.test(shelf)) return true;
  return false;
}

/** Kệ Quality R,S,T,U,V,W,X,Y,Z,O — Z1.5(R) trên hệ thống = ô Z1(R) trên sơ đồ (2 ký tự đầu + hậu tố (L)/(R)). */
const DOT_RACK_MAP_LETTERS = 'RSTUVWXYZO';

export function mapDotRackLocationToMapCell(location: string): string | null {
  const compact = String(location || '').replace(/\s/g, '').toUpperCase();
  const m = new RegExp(`^([${DOT_RACK_MAP_LETTERS}])(\\d)\\.\\d+(\\([LR]\\))$`).exec(compact);
  if (!m) return null;
  return `${m[1]}${m[2]}${m[3]}`;
}

export function compareRackLetters(a: string, b: string): number {
  const ai = RACK_LETTER_ORDER.indexOf(a);
  const bi = RACK_LETTER_ORDER.indexOf(b);
  if (ai >= 0 && bi >= 0) return ai - bi;
  if (ai >= 0) return -1;
  if (bi >= 0) return 1;
  return a.localeCompare(b, 'vi', { numeric: true });
}
