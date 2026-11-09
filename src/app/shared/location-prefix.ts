/**
 * Bỏ tiền tố "J5-" khỏi vị trí (VD J5-LOCKER130 → LOCKER130) — áp dụng mọi nơi nhập / ghi vị trí,
 * kể cả tạo vị trí mới. Chuỗi nhiều vị trí (cách nhau dấu phẩy / chấm phẩy) bỏ ở từng vị trí.
 */
export function stripJ5Prefix(loc: string | null | undefined): string {
  return String(loc ?? '')
    .split(/([,;]\s*)/)
    .map((t) => t.replace(/^(\s*)J5-/i, '$1'))
    .join('');
}
