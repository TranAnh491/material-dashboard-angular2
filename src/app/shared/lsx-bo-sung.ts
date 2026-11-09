/**
 * LSX Bổ sung: LSX được import thêm (sau khi LSX chính đã soạn) → Work Order + PXK riêng,
 * số LSX = "BS " + LSX chính (vd "BS KZLSX1126/0438"). Mỗi LSX chính chỉ có 1 LSX bổ sung (cộng dồn).
 */
export const LSX_BS_PREFIX = 'BS ';

/** Nhóm (factory) của Work Order bổ sung — tab Bổ sung ASM1 / ASM2 / ASM3. */
export const BO_SUNG_FACTORIES = ['BS ASM1', 'BS ASM2', 'BS ASM3'] as const;

/** LSX có tiền tố BS (BS KZLSX…, BS-LHLSX…, BS1126/0438…) */
export function isBsLsx(lsx: unknown): boolean {
  const t = String(lsx ?? '').trim().toUpperCase();
  return /^BS[\s\-_:]*((KZ|LH)?LSX|\d{4}[\/\-.]\d)/.test(t);
}

/** Bỏ tiền tố BS → LSX chính. */
export function stripBsLsx(lsx: unknown): string {
  const t = String(lsx ?? '').trim();
  return isBsLsx(t) ? t.replace(/^BS[\s\-_:]*/i, '').trim() : t;
}

/** LSX chính → LSX bổ sung ("BS KZLSX1126/0438"). */
export function toBsLsx(lsx: unknown): string {
  return LSX_BS_PREFIX + stripBsLsx(lsx);
}

export function isBoSungFactory(factory: unknown): boolean {
  return /^BS\s*ASM[123]$/i.test(String(factory ?? '').trim());
}
