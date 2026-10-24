/** Lý do báo "không cân được" khi tách lẻ & cân (Materials / Outbound) — vào danh sách Check lượng PXK chờ duyệt. */
export const WEIGH_EXEMPT_REASONS: string[] = [
  'Dây rút',
  'Lá Đồng',
  'Vật tư theo bộ',
  'Để trong khay'
];

/** Lựa chọn "Lý do khác" (nhập tay). */
export const WEIGH_EXEMPT_OTHER = '__other__';

/** Ghép lý do gửi lên: lý do chọn / nhập tay + nguồn báo. */
export function buildWeighExemptReason(choice: string, other: string, source: string): string {
  const base = choice === WEIGH_EXEMPT_OTHER ? String(other || '').trim() : String(choice || '').trim();
  return base ? `${base} (${source})` : '';
}

/**
 * Danh mục Check lượng (Danh mục NVL/TP → tab Check lượng / Cân): nhóm đầu mã phải CÂN + mã thêm (pxk-weight-check-include),
 * trừ mã "không cần cân" (pxk-weight-check-exempt). Dùng chung cho tách lẻ (Materials) và Check lượng PXK (Outbound / Work Order Status).
 * GW bag ở Inbound theo danh sách Kiểm 100% (gộp cùng tab), không theo nhóm đầu mã.
 */
export const WEIGH_REQUIRED_PREFIXES: string[] = [
  'B008', 'B009', 'B016', 'B018', 'B019', 'B020', 'B021', 'B022', 'B023', 'B024'
];

/** Ngưỡng đạt chung: trọng lượng cân lệch không quá ±5% so với dự kiến. */
export const WEIGH_TOLERANCE_PERCENT = 5;

/** % = trọng lượng cân / dự kiến × 100 (làm tròn 1 chữ số như số đang hiện). */
export function weighPercentOk(percent: number): boolean {
  return Math.abs(Math.round(percent * 10) / 10 - 100) <= WEIGH_TOLERANCE_PERCENT;
}

/** Trọng lượng 1 bag nguyên (gram) trong danh mục NVL: GW bag, mã cũ chưa có thì lấy cột Trọng lượng. */
export function catalogBagWeight(item: { gwBag?: number; unitWeight?: number } | null | undefined): number {
  return Number(item?.gwBag) || Number(item?.unitWeight) || 0;
}

export function needsWeigh(code: string | null | undefined, exempt?: Set<string> | null, include?: Set<string> | null): boolean {
  const c = String(code || '').trim().toUpperCase();
  if (!c || exempt?.has(c)) return false;
  if (include?.has(c)) return true;
  return WEIGH_REQUIRED_PREFIXES.some((p) => c.startsWith(p));
}

/**
 * In tem lẻ (Materials / Outbound): đầu mã / mã không bắt nhập GW CL / GW bag nguyên / chụp + GW TL — cứ in.
 * Danh sách quản lý ở Danh mục NVL/TP → tab Check lượng / Cân (app-settings/tem-le-no-weigh); đây là giá trị mặc định khi chưa lưu lần nào.
 */
export const TEM_LE_NO_WEIGH_DEFAULT: string[] = ['B030', 'B034', 'B036', 'B041', 'B042'];

export function temLeMustWeigh(
  code: string | null | undefined,
  exempt?: Set<string> | null,
  include?: Set<string> | null,
  noWeighPrefixes: string[] = TEM_LE_NO_WEIGH_DEFAULT
): boolean {
  const c = String(code || '').trim().toUpperCase();
  if (noWeighPrefixes.some((p) => p && c.startsWith(p))) return false;
  return needsWeigh(c, exempt, include);
}
