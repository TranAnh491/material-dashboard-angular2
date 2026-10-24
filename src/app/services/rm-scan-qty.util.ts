/**
 * Số lượng trên tem NVL khi scan (Inbound / Outbound / Inventory).
 * ASM1: nhận số lẻ ("12.5", "12,55", "1,234.5", "1.234,56") — Materials + Inbound ghi nhận 4 số lẻ, Outbound 2 số lẻ.
 * ASM2: giữ cách đọc cũ ở từng màn (hàm này chỉ dùng khi factory = ASM1).
 */

/** Mặc định (Outbound). */
export const RM_SCAN_QTY_DECIMALS = 2;
/** Materials + Inbound ASM1: ghi nhận lượng 4 số lẻ. */
export const RM_QTY_DECIMALS_4 = 4;

export function isRmQtyDecimalFactory(factory: string | null | undefined): boolean {
  return String(factory || '').trim().toUpperCase() === 'ASM1';
}

/** Làm tròn số lẻ (cộng dồn 10.1 + 10.2 = 20.3, không ra 20.2999…). */
export function roundRmQty(n: number, decimals = RM_SCAN_QTY_DECIMALS): number {
  const f = 10 ** decimals;
  const r = Math.round((Number(n) || 0) * f + Number.EPSILON) / f;
  return r === 0 ? 0 : r;
}

/** Đọc chữ số lượng trên tem (dấu . hoặc , đều được làm dấu thập phân). */
export function parseRmQtyText(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  let s = String(raw ?? '').trim().replace(/\s/g, '');
  if (!s) return 0;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // Dấu xuất hiện sau cùng là dấu thập phân
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (hasDot && /^\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Số lượng scan cho ASM1: đọc + làm tròn (mặc định 2 số lẻ); ≤ 0 → 0. */
export function parseRmScanQty(raw: unknown, decimals = RM_SCAN_QTY_DECIMALS): number {
  const n = roundRmQty(parseRmQtyText(raw), decimals);
  return n > 0 ? n : 0;
}

/** Chuỗi hiển thị lượng: tối đa `decimals` số lẻ, bỏ số 0 thừa (12.5000 → 12.5). */
export function fmtRmQty(n: number, decimals = RM_SCAN_QTY_DECIMALS): string {
  const v = roundRmQty(Number(n) || 0, decimals);
  return String(v);
}
