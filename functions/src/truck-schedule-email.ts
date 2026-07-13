import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';
import { emailFrom, emailPass, emailSmtpHost, emailSmtpPort, emailUser } from './params-config';

export type TruckDecisionType = 'approved' | 'rejected' | 'rescheduled';

function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Chỉ gửi cho email công ty thật (bỏ qua các email nội bộ giả asp####@asp.com). */
function isCompanyEmail(email: string): boolean {
  const e = (email || '').trim().toLowerCase();
  return e.endsWith('@airspeedmfgvn.com') || e.endsWith('@airspeedmfg.com');
}

/**
 * Gửi email cho người đăng ký lệnh giao hàng (Xe Tải) khi kho Duyệt / Từ chối / Đổi ngày.
 * Đọc lại document từ Firestore (admin SDK) theo requestId thay vì tin dữ liệu client gửi lên,
 * để nội dung email luôn khớp đúng dữ liệu đã lưu.
 */
export async function sendTruckDeliveryDecisionEmail(requestId: string, decision: TruckDecisionType): Promise<void> {
  const snap = await admin.firestore().collection('truck-delivery-requests').doc(requestId).get();
  if (!snap.exists) {
    throw new Error('Không tìm thấy lệnh giao hàng.');
  }
  const d = snap.data() as Record<string, unknown>;

  const to = String(d.createdByEmail || '').trim();
  if (!to || !isCompanyEmail(to)) {
    console.log('[TruckSchedule Email] Bỏ qua — không có email công ty hợp lệ:', to);
    return;
  }

  const user = emailUser.value().trim();
  const pass = emailPass.value().trim();
  if (!user || !pass) {
    throw new Error('Thiếu cấu hình SMTP (EMAIL_USER, EMAIL_PASS secret).');
  }
  const host = emailSmtpHost.value().trim() || 'smtp.gmail.com';
  const port = parseInt(emailSmtpPort.value().trim() || '587', 10) || 587;
  const from = emailFrom.value().trim() || user;

  const dateYmd = String(d.dateYmd || '');
  const employeeCode = String(d.employeeCode || '');
  const employeeName = String(d.employeeName || '');
  const warehouseNote = String(d.warehouseNote || '').trim();

  let subject: string;
  let statusLabel: string;
  let actionNote = '';
  if (decision === 'approved') {
    subject = `[Xe Tải] Lệnh giao hàng ngày ${dateYmd} đã được DUYỆT`;
    statusLabel = 'ĐÃ DUYỆT (Đã đặt)';
  } else if (decision === 'rejected') {
    subject = `[Xe Tải] Lệnh giao hàng ngày ${dateYmd} bị TỪ CHỐI`;
    statusLabel = 'TỪ CHỐI (Không đặt được)';
  } else {
    subject = `[Xe Tải] Lệnh giao hàng đã được ĐỔI NGÀY sang ${dateYmd}`;
    statusLabel = `ĐỔI NGÀY → ${dateYmd}`;
    actionNote =
      'Vui lòng vào app Xe Tải, mở lệnh này và bấm "Đồng ý đổi lịch" để xác nhận ngày mới — ' +
      'lệnh chỉ chính thức được duyệt sau khi bạn xác nhận.';
  }

  const text =
    `Xin chào ${employeeName || employeeCode},\n\n` +
    `Lệnh giao hàng của bạn (mã NV ${employeeCode}) vừa được cập nhật:\n` +
    `Trạng thái: ${statusLabel}\n` +
    (warehouseNote ? `Ghi chú kho: ${warehouseNote}\n` : '') +
    (actionNote ? `\n${actionNote}\n` : '') +
    `\nXem chi tiết trong app Xe Tải.\n`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<p>Xin chào <strong>${esc(employeeName || employeeCode)}</strong>,</p>
<p>Lệnh giao hàng của bạn vừa được cập nhật:</p>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px" cellpadding="8" border="1">
<tr><td>Mã nhân viên</td><td>${esc(employeeCode)}</td></tr>
<tr><td>Ngày</td><td>${esc(dateYmd)}</td></tr>
<tr><td>Trạng thái</td><td><strong>${esc(statusLabel)}</strong></td></tr>
${warehouseNote ? `<tr><td>Ghi chú kho</td><td>${esc(warehouseNote)}</td></tr>` : ''}
</table>
${actionNote ? `<p style="color:#c0392b;font-weight:bold;">${esc(actionNote)}</p>` : ''}
<p style="color:#555;font-size:12px">Gửi tự động từ hệ thống Xe Tải — Warehouse.</p>
</body></html>`;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  await transporter.sendMail({
    from,
    to,
    subject: subject.slice(0, 250),
    text,
    html
  });
}
