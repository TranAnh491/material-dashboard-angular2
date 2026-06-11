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
  if (shelf === 'H11') return 'H11';
  if (shelf.startsWith('IQC')) return 'IQC';
  if (shelf.startsWith('NG')) return 'NG';

  const m = /^([A-Z]+)/.exec(shelf);
  return m ? m[1] : shelf.charAt(0);
}

/** Mã thành phẩm P + 6 số (VD: P011022, P011022.E → P011022). */
export function normalizeFinishedGoodsPCode(input: string): string | null {
  const compact = String(input || '').replace(/\s/g, '').toUpperCase().replace(/\./g, '');
  const m = /^P(\d{6})/.exec(compact);
  return m ? `P${m[1]}` : null;
}

/** So khớp 7 ký tự đầu mã hàng FG (P + 6 số) — cùng logic cột Mã TP fg-inventory. */
export function matchesFinishedGoodsPCode(materialCode: string, pCode: string): boolean {
  const norm = String(materialCode || '').replace(/\s/g, '').toUpperCase().replace(/\./g, '');
  return norm.substring(0, 7) === pCode;
}

/** Pallet ASM1 (F1-xxxx) — không phải kệ F1 trên sơ đồ layout. */
const FG_PALLET_PREFIX_RE = /^F1-[A-Z0-9]/i;

/** Vị trí chỉ là pallet (VD: F1-0025), chưa gán kệ cụ thể. */
export function isFgPalletOnlyLocation(location: string): boolean {
  return FG_PALLET_PREFIX_RE.test(String(location || '').trim());
}

/**
 * Phần kệ trong cột vị trí fg-inventory (bỏ pallet F1-xxxx).
 * VD: B6.2-F1-0025 → B6.2; IQC+F1-0001 → IQC; F1-0025 → null.
 */
export function extractFgShelfPartFromLocation(location: string): string | null {
  const raw = String(location || '').trim().toUpperCase();
  if (!raw) return null;
  if (isFgPalletOnlyLocation(raw)) return null;
  if (/^IQC\+F1-/i.test(raw)) return 'IQC';
  const infix = raw.match(/^(.+?)[-+]F1-[A-Z0-9]/i);
  if (infix) {
    const part = infix[1].replace(/[.\s-]+$/g, '').trim();
    return part || null;
  }
  return raw;
}

/**
 * Map cột vị trí fg-inventory → kệ trên layout.
 * Bỏ qua pallet F1-xxxx; lấy 2 ký tự đầu phần kệ (VD: A3-01 → A3, B6.2-F1-0025 → B6).
 * Nếu khớp kệ đầy đủ trên sơ đồ (A12, H11…) thì ưu tiên kệ đó.
 */
export function mapFgLocationToLayoutShelf(location: string, knownShelves: string[] = []): string {
  const shelfPart = extractFgShelfPartFromLocation(location);
  if (!shelfPart) return '';

  const raw = shelfPart.toUpperCase();
  if (raw.startsWith('IQC')) return 'IQC';

  if (knownShelves.length) {
    const sorted = [...new Set(knownShelves.map(s => s.toUpperCase()))].sort(
      (a, b) => b.length - a.length
    );
    const compact = raw.replace(/[^A-Z0-9]/g, '');
    for (const shelf of sorted) {
      if (raw.startsWith(shelf) || compact.startsWith(shelf)) {
        return shelf;
      }
    }
  }

  return raw.substring(0, 2);
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
  'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'O', 'Q', 'A12', 'H11', 'K',
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

export const GENERAL_MATERIAL_SHELF_RANGE_LABEL = 'D1–D9, E1–E9, F1–F6, G1–G6';

export const GENERAL_MATERIAL_GUIDANCE =
  'Được để tất cả nguyên liệu không bắt buộc phải lưu trữ ở Kho mát và Tủ lạnh\n\n' +
  'Như : Dây điện, Đồ đóng gói, Ống co nhiệt, Ống chống nhiễu, Các loại ống lưới,';

/** D1–D9, E1–E9, F1–F6, G1–G6: nguyên liệu thường (không bắt buộc kho mát/tủ lạnh). */
export function isGeneralMaterialShelf(shelfOrLoc: string, knownShelves: string[] = []): boolean {
  const raw = String(shelfOrLoc || '').trim().toUpperCase();
  const parsed = knownShelves.length ? parseWarehouseLocation(raw, knownShelves) : null;
  const shelf = (parsed?.shelf || raw).toUpperCase();
  if (/^D[1-9]$/.test(shelf)) return true;
  if (/^E[1-9]$/.test(shelf)) return true;
  if (/^F[1-6]$/.test(shelf)) return true;
  if (/^G[1-6]$/.test(shelf)) return true;
  return false;
}

export function isGeneralMaterialRackLetter(rack: string): boolean {
  return /^[DEFG]$/.test(String(rack || '').trim().toUpperCase());
}

export function getDefaultLocationGuidance(loc: string, knownShelves: string[] = []): string {
  if (isFinishedGoodsShelf(loc, knownShelves)) return FINISHED_GOODS_GUIDANCE;
  if (isGeneralMaterialShelf(loc, knownShelves)) return GENERAL_MATERIAL_GUIDANCE;
  return '';
}

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

/** Kệ thuộc MIXZONE P trên sơ đồ (F7–F9, G7–G9). */
export const MIXZONE_SHELVES = new Set(['P', 'F7', 'F8', 'F9', 'G7', 'G8', 'G9']);

/** F71 / G91… (thiếu dấu chấm) → kệ MIXZONE F7 / G9. */
export function resolveMixzoneShelfFromLocation(location: string): string | null {
  const raw = String(location || '').trim().toUpperCase();
  if (!raw) return null;
  if (raw === 'P') return 'P';
  if (MIXZONE_SHELVES.has(raw)) return raw;
  const compact = /^(F[7-9]|G[7-9])(\d+)$/.exec(raw);
  if (compact && MIXZONE_SHELVES.has(compact[1])) return compact[1];
  return null;
}

/** Gom F7 / F7.1 / F71… về nhãn P trên Live list. */
export function normalizeMixzoneLiveLocation(location: string, knownShelves: string[] = []): string {
  const raw = String(location || '').trim().toUpperCase();
  if (!raw) return '';
  if (resolveMixzoneShelfFromLocation(raw)) return 'P';
  const parsed = knownShelves.length ? parseWarehouseLocation(raw, knownShelves) : null;
  if (parsed?.shelf && MIXZONE_SHELVES.has(parsed.shelf.toUpperCase())) return 'P';
  return raw;
}

export function compareRackLetters(a: string, b: string): number {
  const ai = RACK_LETTER_ORDER.indexOf(a);
  const bi = RACK_LETTER_ORDER.indexOf(b);
  if (ai >= 0 && bi >= 0) return ai - bi;
  if (ai >= 0) return -1;
  if (bi >= 0) return 1;
  return a.localeCompare(b, 'vi', { numeric: true });
}
