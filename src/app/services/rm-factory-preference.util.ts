/** Nhân viên mặc định ưu tiên xem ASM2 khi mở các trang RM (Inbound/Outbound/Inventory/Overview)
 *  chưa có ?factory= trên URL — thay vì mặc định ASM1 như các nhân viên khác. */
const ASM2_DEFAULT_EMPLOYEE_IDS = new Set(['ASP1761', 'ASP1726', 'ASP2767']);

export function getDefaultRmFactory(employeeId: string | null | undefined): 'ASM1' | 'ASM2' {
  const id = String(employeeId || '').trim().toUpperCase();
  return ASM2_DEFAULT_EMPLOYEE_IDS.has(id) ? 'ASM2' : 'ASM1';
}
