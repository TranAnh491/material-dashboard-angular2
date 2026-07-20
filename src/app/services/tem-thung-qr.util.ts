/**
 * Mã đánh dấu ẩn gắn vào dữ liệu QR của Tem Thùng (không hiện trên tem in, chỉ máy quét đọc được)
 * để Outbound ASM1/ASM2 nhận diện đây là Tem Thùng — khác với tem QR thường (cột QR) — và áp dụng
 * luật Xuất thùng (chỉ mã được tick "Xuất thùng" trong Danh mục NVL mới quét xuất được).
 *
 * Dùng chung giữa Materials ASM1/ASM2 (nơi in tem) và Outbound ASM1/ASM2 (nơi quét tem).
 */
export const TEM_THUNG_QR_MARKER = 'TT:';

/** Format: `TT:<Mã>|<PO>|<Lượng>|<IMD>-<i>/<n>` — giống hệt format tem QR thường, chỉ thêm tiền tố. */
export function buildTemThungQrData(
  materialCode: string,
  poNumber: string,
  qty: number | string,
  imdWithLabelIndex: string
): string {
  return `${TEM_THUNG_QR_MARKER}${materialCode}|${poNumber}|${qty}|${imdWithLabelIndex}`;
}

/**
 * Nhận vào đoạn đầu tiên (trước dấu `|` đầu) của chuỗi quét/QR — trả về đã có phải Tem Thùng
 * không, và mã hàng thật (đã bỏ tiền tố) để dùng tiếp cho các bước xử lý phía sau.
 */
export function stripTemThungMarker(firstSegment: string): { isTemThung: boolean; materialCode: string } {
  const raw = String(firstSegment || '').trim();
  if (raw.startsWith(TEM_THUNG_QR_MARKER)) {
    return { isTemThung: true, materialCode: raw.slice(TEM_THUNG_QR_MARKER.length).trim() };
  }
  return { isTemThung: false, materialCode: raw };
}
