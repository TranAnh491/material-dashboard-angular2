/**
 * Tự tick KK (kiểm kê) khi hàng vừa được xác nhận thực tế:
 * - Nhập kho ở Inbound → tick bởi người nhập
 * - Đổi vị trí từ PASS vào kệ → tick bởi người đổi vị trí
 */

/** Vị trí PASS (PASS, PASS-xx…). */
export function isPassLocation(loc: string | null | undefined): boolean {
  return String(loc || '').replace(/\s/g, '').toUpperCase().startsWith('PASS');
}

/** Vị trí kệ thật: không trống, không PASS, không IQC. */
export function isShelfLocation(loc: string | null | undefined): boolean {
  const c = String(loc || '').replace(/\s/g, '').toUpperCase();
  return !!c && !c.startsWith('PASS') && !c.startsWith('IQC');
}

/** Đổi từ PASS vào kệ → cần tick KK. */
export function isPassToShelf(from: string | null | undefined, to: string | null | undefined): boolean {
  return isPassLocation(from) && isShelfLocation(to);
}

export function kkDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Field ghi lên dòng tồn khi tự tick KK. */
export function autoKkFields(by: string, at: Date, source: string): Record<string, unknown> {
  return { kkChecked: true, kkBy: by, kkAt: at, kkAutoSource: source };
}

/** Bản ghi lịch sử KK (collection inventory-kk-history + log ngày). */
export function autoKkLog(p: {
  inventoryDocId: string; factory: string; materialCode: string; poNumber?: string; batchNumber?: string;
  location: string; quantity?: number; stock?: number; unit?: string; by: string; at: Date; source: string;
}): Record<string, any> {
  return {
    inventoryDocId: p.inventoryDocId,
    factory: p.factory,
    materialCode: String(p.materialCode || '').trim().toUpperCase(),
    materialName: '',
    poNumber: String(p.poNumber || '').trim(),
    batchNumber: String(p.batchNumber || '').trim(),
    location: String(p.location || '').trim().toUpperCase(),
    quantity: Number(p.quantity) || 0,
    stock: Number(p.stock) || 0,
    unit: String(p.unit || '').trim(),
    checkedBy: p.by,
    checkedAt: p.at,
    checkedDateKey: kkDateKey(p.at),
    createdAt: new Date(),
    source: p.source
  };
}
