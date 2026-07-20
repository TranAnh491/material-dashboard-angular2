export interface ParsedWarehouseLocation {
  shelf: string;
  slot: string | null;
  raw: string;
}

/** Locker, Locker1, Locker+3, LOCKER 2… → kệ Locker trên sơ đồ. */
export function isLockerPrefixLocation(loc: string): boolean {
  const raw = String(loc || '').replace(/\s/g, '').toUpperCase();
  return raw === 'LOCKER' || /^LOCKER(?:\+?\d+)$/.test(raw);
}

/** Gom mọi Locker+N về nhãn Locker (Live list / heatmap). */
export function normalizeLockerLiveLocation(loc: string): string {
  return isLockerPrefixLocation(loc) ? 'Locker' : '';
}

function parseLockerLocation(raw: string): ParsedWarehouseLocation | null {
  const compact = raw.replace(/\s/g, '').toUpperCase();
  if (compact === 'LOCKER') {
    return { shelf: 'Locker', slot: null, raw };
  }
  const m = /^LOCKER(?:\+?(\d+))$/.exec(compact);
  if (m) {
    return { shelf: 'Locker', slot: m[1] || null, raw };
  }
  return null;
}

/** ASM3+U3.2(R)03, ASM3-U3.2(R)03, ASM3U3.2(R)03… */
export function isAsm3PrefixLocation(loc: string): boolean {
  const raw = String(loc || '').replace(/\s/g, '').toUpperCase();
  return raw.startsWith('ASM3');
}

/**
 * Vị trí thuộc kho ASM3 theo 1 trong 2 cách ghi đang tồn tại trong thực tế:
 * - "ASM3..." (quy ước cũ, dùng trong cột Vị trí ở Materials ASM1/ASM2)
 * - "WH3..." (tên ô thực tế trên sơ đồ kho ASM3, VD WH3-A1)
 * Dùng cho "Kiểm tra vị trí nhà máy": cả 2 tiền tố đều coi là đúng nhà máy ASM3.
 */
export function isAsm3OrWh3PrefixLocation(loc: string): boolean {
  const raw = String(loc || '').replace(/\s/g, '').toUpperCase();
  return raw.startsWith('ASM3') || raw.startsWith('WH3');
}

/** Bỏ tiền tố ASM3 (+ / - / dính liền). */
export function extractAsm3LocationBody(location: string): string | null {
  const raw = String(location || '').replace(/\s/g, '').toUpperCase();
  if (!raw.startsWith('ASM3')) return null;
  const rest = raw.replace(/^ASM3[+_-]?/, '');
  return rest || null;
}

/**
 * Bỏ số ô sau (R)/(L) và mọi hậu tố phía sau (05, -TX, TX…).
 * VD: X1.2(L)05 → X1.2(L); X1.2(L)05-TX → X1.2(L).
 */
export function stripQualityRackSlotSuffix(location: string): string {
  const core = extractQualityRackCore(location);
  if (core) return core;
  const compact = String(location || '').replace(/\s/g, '').toUpperCase();
  const m = /^(.+\([LR]\))\d*$/.exec(compact);
  return m ? m[1] : compact;
}

/** Kệ Quality R,S,T,U,V,W,X,Y,Z,O — Z1.5(R) trên hệ thống = ô Z1(R) trên sơ đồ (2 ký tự đầu + hậu tố (L)/(R)). */
const DOT_RACK_MAP_LETTERS = 'RSTUVWXYZO';

/**
 * Lấy phần kệ Quality từ đầu chuỗi — bỏ số ô và hậu tố (-TX, TX, pallet…).
 * VD: X1.2(L)05 → X1.2(L); U3.2(R)03-F1-0001 → U3.2(R).
 */
export function extractQualityRackCore(location: string): string | null {
  const compact = String(location || '').replace(/\s/g, '').toUpperCase();
  const m = new RegExp(`^([${DOT_RACK_MAP_LETTERS}]\\d(?:\\.\\d+)?\\([LR]\\))`).exec(compact);
  return m ? m[1] : null;
}

/** Vị trí/kệ Quality → ô trên sơ đồ (VD: X1.2(L)05 → X1(L)). */
export function resolveQualityRackLayoutCell(location: string): string | null {
  const core = extractQualityRackCore(location);
  if (!core) return null;
  return mapDotRackLocationToMapCell(core) || core;
}

/** Gom vị trí Quality về ô layout cho Live list / heatmap. */
export function normalizeQualityRackLiveLocation(location: string): string {
  return resolveQualityRackLayoutCell(location) || '';
}

export function mapDotRackLocationToMapCell(location: string): string | null {
  const compact = stripQualityRackSlotSuffix(location);
  const m = new RegExp(`^([${DOT_RACK_MAP_LETTERS}])(\\d)\\.\\d+(\\([LR]\\))$`).exec(compact);
  if (!m) return null;
  return `${m[1]}${m[2]}${m[3]}`;
}

/** Kệ ASM3 từ vị trí (ASM3+… hoặc factory ASM3). */
export function resolveAsm3WarehouseShelf(location: string, factory?: string): string | null {
  const body = extractAsm3LocationBody(location);
  if (body) {
    return stripQualityRackSlotSuffix(body);
  }
  if (String(factory || '').toUpperCase() === 'ASM3') {
    const compact = String(location || '').replace(/\s/g, '').toUpperCase();
    if (!compact) return null;
    return stripQualityRackSlotSuffix(compact);
  }
  return null;
}

/** U3.2(R) → U3(R) trên sơ đồ SVG (ô hiện có). */
export function mapAsm3ShelfToLayoutCell(shelf: string): string | null {
  const resolved = resolveQualityRackLayoutCell(shelf);
  if (resolved) return resolved;
  const compact = String(shelf || '').replace(/\s/g, '').toUpperCase();
  return mapDotRackLocationToMapCell(compact) || compact || null;
}

export function parseWarehouseLocation(
  location: string,
  knownShelves: string[]
): ParsedWarehouseLocation | null {
  const raw = String(location || '').trim().toUpperCase();
  if (!raw) return null;

  const lockerParsed = parseLockerLocation(raw);
  if (lockerParsed) return lockerParsed;

  const asm3Body = extractAsm3LocationBody(raw);
  if (asm3Body) {
    const shelf = stripQualityRackSlotSuffix(asm3Body);
    const layoutShelf = mapDotRackLocationToMapCell(shelf) || shelf;
    const slotTail = asm3Body.slice(shelf.length).replace(/\D/g, '') || null;
    return { shelf: layoutShelf, slot: slotTail, raw };
  }

  const qualityCore = extractQualityRackCore(raw);
  if (qualityCore) {
    const layoutShelf = mapDotRackLocationToMapCell(qualityCore) || qualityCore;
    const slot = raw.slice(qualityCore.length).match(/^(\d+)/)?.[1] || null;
    return { shelf: layoutShelf, slot, raw };
  }

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

  if (isNgPrefixLocation(raw)) {
    const tail = raw.slice(2).replace(/^[-+_.]/, '');
    const slot = tail.match(/^(\d+)/)?.[1] || null;
    return { shelf: 'NG', slot, raw };
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
  if (shelf.toUpperCase() === 'LOCKER' || shelf.toUpperCase().startsWith('LOCKER')) return 'Locker';
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
  'Locker', 'IQC', 'NG'
];

/** Mọi vị trí bắt đầu bằng IQC (IQC, IQC+F1-0001, IQC+F7, …). */
export function isIqcPrefixLocation(loc: string): boolean {
  return String(loc || '').replace(/\s/g, '').toUpperCase().startsWith('IQC');
}

/** Mọi vị trí NG (NG, NG-01, NG01, …). */
export function isNgPrefixLocation(loc: string): boolean {
  const raw = String(loc || '').replace(/\s/g, '').toUpperCase();
  return raw === 'NG' || /^NG(?:[+_.-]?\d*)$/.test(raw);
}

/** Gom mọi vị trí NG về nhãn NG (Live list / heatmap). */
export function normalizeNgLiveLocation(loc: string): string {
  return isNgPrefixLocation(loc) ? 'NG' : '';
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

/** Số tầng / ô mặc định trên kệ Quality (VD: V1.1 … V1.5, ô 01–05). */
export const QUALITY_RACK_LEVEL_COUNT = 7;
export const QUALITY_RACK_SLOT_COUNT = 5;

export interface LayoutQualityRackCell {
  letter: string;
  column: number;
  side: 'L' | 'R';
  label: string;
}

/** Ô trên sơ đồ: V1(R), X1(L)… */
export function isLayoutQualityRackCell(loc: string): boolean {
  return !!parseLayoutQualityRackCell(loc);
}

export function parseLayoutQualityRackCell(loc: string): LayoutQualityRackCell | null {
  const m = /^([RSTUVWXYZO])(\d)\(([LR])\)$/.exec(String(loc || '').replace(/\s/g, '').toUpperCase());
  if (!m) return null;
  return {
    letter: m[1],
    column: Number(m[2]),
    side: m[3] as 'L' | 'R',
    label: `${m[1]}${m[2]}(${m[3]})`
  };
}

export function buildQualityRackLevelLabel(cell: LayoutQualityRackCell, level: number): string {
  return `${cell.letter}${cell.column}.${level}(${cell.side})`;
}

export function buildQualityRackSlotLocation(cell: LayoutQualityRackCell, level: number, slot: number): string {
  return `${buildQualityRackLevelLabel(cell, level)}${String(slot).padStart(2, '0')}`;
}

/**
 * Chuẩn hoá vị trí Quality theo quy ước 4 ký tự:
 * - V1.1(R)  -> V11R
 * - V1.1(R)05-TX -> V11R05TX (khi so khớp chỉ lấy 4 ký tự đầu V11R)
 * Bỏ toàn bộ ký tự không phải chữ/số.
 */
export function normalizeQualityRackCompact(location: string): string {
  return String(location || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** Lấy key 4 ký tự đầu (VD: V1.1(R) -> V11R). */
export function getQualityRackKey4(location: string): string {
  return normalizeQualityRackCompact(location).slice(0, 4);
}

/** Parse key4 kiểu Y15R -> { level: 5 } (kệ Y1, tầng 5, bên R). */
export function parseQualityRackLevelFromKey4(key4: string): { level: number } | null {
  const m = /^([RSTUVWXYZO])(\d)(\d)([LR])$/.exec(String(key4 || '').trim().toUpperCase());
  if (!m) return null;
  const level = Number(m[3]);
  if (!Number.isFinite(level) || level <= 0) return null;
  return { level };
}

/** V1.2(R)05-TX thuộc kệ layout V1(R). */
export function locationBelongsToLayoutQualityRack(location: string, layoutCell: string): boolean {
  const cell = parseLayoutQualityRackCell(layoutCell);
  if (!cell) return false;
  const core = extractQualityRackCore(location);
  if (!core) return false;
  const m = /^([RSTUVWXYZO])(\d)\.(\d+)\(([LR])\)$/.exec(core);
  if (!m) return false;
  return m[1] === cell.letter && Number(m[2]) === cell.column && m[4] === cell.side;
}

export function parseQualityRackSlotFromLocation(location: string): { level: number; slot: number } | null {
  // Theo rule mới: chỉ cần khớp 4 ký tự đầu (V11R) để map lên tầng.
  const compact = normalizeQualityRackCompact(location);
  const key4 = compact.slice(0, 4);
  const parsed = parseQualityRackLevelFromKey4(key4);
  if (!parsed) return null;
  const level = parsed.level;

  // Slot: nếu có số phía sau key4 (VD: V11R05...) thì lấy 2 số đầu làm slot.
  const tail = compact.slice(4);
  const slotM = /^(\d{1,2})/.exec(tail);
  const slotRaw = slotM ? Number(slotM[1]) : 1;
  const slot = Math.max(1, Math.min(QUALITY_RACK_SLOT_COUNT, slotRaw || 1));
  return { level, slot };
}

export function compareRackLetters(a: string, b: string): number {
  const ai = RACK_LETTER_ORDER.indexOf(a);
  const bi = RACK_LETTER_ORDER.indexOf(b);
  if (ai >= 0 && bi >= 0) return ai - bi;
  if (ai >= 0) return -1;
  if (bi >= 0) return 1;
  return a.localeCompare(b, 'vi', { numeric: true });
}
