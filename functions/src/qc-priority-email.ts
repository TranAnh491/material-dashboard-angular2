import * as nodemailer from 'nodemailer';
import {
  emailFrom,
  emailPass,
  emailSmtpHost,
  emailSmtpPort,
  emailUser,
  qcPriorityEmailTo
} from './params-config';

export type QcPriorityResolvedPayload = {
  materialCode: string;
  poNumber: string;
  imd: string;
  location: string;
  factory: string;
  oldStatus: string;
  newStatus: string;
  checkedBy: string;
};

function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getSmtpForQcNotify():
  | { host: string; port: number; user: string; pass: string; from: string; to: string }
  | null {
  const user = emailUser.value().trim();
  const pass = emailPass.value().trim();
  const to = qcPriorityEmailTo.value().trim();
  if (!user || !pass || !to) {
    return null;
  }
  const host = emailSmtpHost.value().trim() || 'smtp.gmail.com';
  const port = parseInt(emailSmtpPort.value().trim() || '587', 10) || 587;
  const fromRaw = emailFrom.value().trim();
  const from = fromRaw || user;
  return { host, port, user, pass, from, to };
}

/** Mail khi mã ưu tiên (danh sách Chờ kiểm) đổi từ CHỜ KIỂM sang trạng thái khác. */
export async function sendQcPriorityResolvedEmail(p: QcPriorityResolvedPayload): Promise<void> {
  const cfg = getSmtpForQcNotify();
  if (!cfg) {
    throw new Error('Thiếu SMTP (EMAIL_USER, EMAIL_PASS) hoặc QC_PRIORITY_EMAIL_TO');
  }
  const atStr = new Date().toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false
  });
  const text =
    `Mã ưu tiên (Chờ kiểm) vừa được cập nhật trạng thái IQC.\n\n` +
    `Thời điểm: ${atStr}\n` +
    `Nhà máy: ${p.factory}\n` +
    `Mã hàng: ${p.materialCode}\n` +
    `PO: ${p.poNumber}\n` +
    `IMD/Batch: ${p.imd}\n` +
    `Vị trí: ${p.location}\n` +
    `Trạng thái cũ: ${p.oldStatus}\n` +
    `Trạng thái mới: ${p.newStatus}\n` +
    `Người kiểm: ${p.checkedBy}\n`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<p><strong>QC — Mã ưu tiên (Chờ kiểm) đã xử lý</strong></p>
<p>Thời điểm: <strong>${esc(atStr)}</strong></p>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px" cellpadding="6" border="1">
<tr><td>Nhà máy</td><td>${esc(p.factory)}</td></tr>
<tr><td>Mã hàng</td><td>${esc(p.materialCode)}</td></tr>
<tr><td>PO</td><td>${esc(p.poNumber)}</td></tr>
<tr><td>IMD/Batch</td><td>${esc(p.imd)}</td></tr>
<tr><td>Vị trí</td><td>${esc(p.location)}</td></tr>
<tr><td>Trạng thái cũ</td><td>${esc(p.oldStatus)}</td></tr>
<tr><td>Trạng thái mới</td><td>${esc(p.newStatus)}</td></tr>
<tr><td>Người kiểm</td><td>${esc(p.checkedBy)}</td></tr>
</table>
<p style="color:#555;font-size:12px">Gửi từ Tuấn Anh</p>
</body></html>`;

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass }
  });
  await transporter.sendMail({
    from: cfg.from,
    to: cfg.to,
    subject: `[QC Ưu tiên] ${p.materialCode} — ${p.oldStatus} → ${p.newStatus}`.slice(0, 250),
    text,
    html
  });
}
