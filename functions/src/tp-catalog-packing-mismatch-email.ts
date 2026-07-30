import * as nodemailer from 'nodemailer';
import { ALERT_RECIPIENTS, esc, getSmtpConfig } from './carton-packing-qty-alert-email';

export type TpCatalogPackingMismatchPayload = {
  materialCode: string;
  standardQty: number;
  cartonPackingQty: number;
  reportedBy: string;
};

/** Danh mục TP: bấm icon "Gửi mail" ở dòng lệch SL SP/thùng ≠ Lượng Đóng Thùng → báo Kho + Kỹ thuật. */
export async function sendTpCatalogPackingMismatchEmail(p: TpCatalogPackingMismatchPayload): Promise<void> {
  const cfg = getSmtpConfig();
  if (!cfg) {
    throw new Error('Thiếu SMTP (EMAIL_USER, EMAIL_PASS)');
  }
  const atStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });

  const text =
    `Cảnh báo: Mã TP dưới đây đang lệch SL SP/thùng so với Lượng Đóng Thùng trong Danh mục TP.\n\n` +
    `Thời điểm: ${atStr}\n` +
    `Mã TP: ${p.materialCode}\n` +
    `SL SP/thùng: ${p.standardQty}\n` +
    `Lượng Đóng Thùng: ${p.cartonPackingQty}\n` +
    `Người báo: ${p.reportedBy}\n\n` +
    `Vui lòng kiểm tra lại và cập nhật cho khớp.`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<p><strong>⚠️ Cảnh báo lệch SL SP/thùng ≠ Lượng Đóng Thùng — Danh mục TP</strong></p>
<p>Thời điểm: <strong>${esc(atStr)}</strong></p>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px" cellpadding="6" border="1">
<tr><td>Mã TP</td><td><strong>${esc(p.materialCode)}</strong></td></tr>
<tr><td>SL SP/thùng</td><td>${esc(String(p.standardQty))}</td></tr>
<tr><td>Lượng Đóng Thùng</td><td>${esc(String(p.cartonPackingQty))}</td></tr>
<tr><td>Người báo</td><td>${esc(p.reportedBy)}</td></tr>
</table>
<p style="color:#555;font-size:12px">Vui lòng kiểm tra lại và cập nhật cho khớp.</p>
</body></html>`;

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass }
  });
  await transporter.sendMail({
    from: cfg.from,
    to: ALERT_RECIPIENTS,
    subject: `[Cảnh báo] Mã TP ${p.materialCode} lệch SL SP/thùng`.slice(0, 250),
    text,
    html
  });
}
