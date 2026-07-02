import * as nodemailer from 'nodemailer';
import {
  emailFrom,
  emailPass,
  emailSmtpHost,
  emailSmtpPort,
  emailUser,
  qcPriorityEmailTo
} from './params-config';

function safeText(s: unknown, max = 200): string {
  return String(s ?? '').trim().slice(0, max);
}

function decodePdfDataUrl(pdfDataUrl: string): Buffer {
  const m = /^data:application\/pdf;base64,(.+)$/i.exec(pdfDataUrl || '');
  if (!m?.[1]) {
    throw new Error('pdfDataUrl không hợp lệ (cần data:application/pdf;base64,...)');
  }
  return Buffer.from(m[1], 'base64');
}

/** Cùng SMTP + người nhận với mail QC ưu tiên (QC_PRIORITY_EMAIL_TO). */
function getSmtpForWarehouseQuiz():
  | { host: string; port: number; user: string; pass: string; from: string; to: string }
  | null {
  const user = emailUser.value().trim();
  const pass = emailPass.value().trim();
  const to = qcPriorityEmailTo.value().trim();
  if (!user || !pass || !to) return null;
  const host = emailSmtpHost.value().trim() || 'smtp.gmail.com';
  const port = parseInt(emailSmtpPort.value().trim() || '587', 10) || 587;
  const fromRaw = emailFrom.value().trim();
  const from = fromRaw || user;
  return { host, port, user, pass, from, to };
}

export async function sendWarehouseTrainingQuizPdfEmail(payload: {
  employeeId?: string;
  fullName?: string;
  joinDate?: string;
  sectionId?: string;
  resultText?: string;
  pdfDataUrl: string;
}): Promise<{ ok: true }> {
  const cfg = getSmtpForWarehouseQuiz();
  if (!cfg) {
    throw new Error('Thiếu SMTP (EMAIL_USER, EMAIL_PASS) hoặc QC_PRIORITY_EMAIL_TO');
  }

  const pdfBuf = decodePdfDataUrl(payload.pdfDataUrl);
  if (!pdfBuf?.length) {
    throw new Error('PDF rỗng');
  }

  const employeeId = safeText(payload.employeeId, 40);
  const fullName = safeText(payload.fullName, 120);
  const joinDate = safeText(payload.joinDate, 40);
  const sectionId = safeText(payload.sectionId, 40);
  const resultText = safeText(payload.resultText, 600);

  const atStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
  const subject =
    `[WH] Kết quả kiểm tra đào tạo kho` +
    (sectionId ? ` (${sectionId})` : '') +
    (employeeId ? ` — ${employeeId}` : '') +
    (fullName ? ` — ${fullName}` : '');

  const text =
    `Bài kiểm tra đào tạo kho đã hoàn thành.\n\n` +
    `Thời điểm: ${atStr}\n` +
    (sectionId ? `Bài: ${sectionId}\n` : '') +
    (fullName ? `Họ tên: ${fullName}\n` : '') +
    (employeeId ? `Mã NV: ${employeeId}\n` : '') +
    (joinDate ? `Ngày vào làm: ${joinDate}\n` : '') +
    (resultText ? `Kết quả: ${resultText}\n` : '');

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass }
  });

  const safeFileName = `${employeeId || 'NV'}_${(fullName || 'nhan-vien').replace(/\s+/g, '_')}.pdf`.replace(
    /[^\w.\-()]+/g,
    '_'
  );

  await transporter.sendMail({
    from: cfg.from,
    to: cfg.to,
    subject: subject.slice(0, 250),
    text,
    attachments: [
      {
        filename: safeFileName,
        content: pdfBuf,
        contentType: 'application/pdf'
      }
    ]
  });

  return { ok: true };
}
