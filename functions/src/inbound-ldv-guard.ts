/**
 * Inbound: OTP 4 số Zalo → ASP0106 để sửa lượng đơn vị đã nhập.
 * Mail khi lượng đơn vị khác Standard Packing.
 */
import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';
import { zaloBotToken } from './params-config';
import { esc, getSmtpConfig } from './carton-packing-qty-alert-email';

/** Mail lệch lượng đơn vị / Standard Packing — chỉ kho, không gửi engineer/AST. */
const LDV_MISMATCH_RECIPIENTS = [
  'wh1@airspeedmfgvn.com',
  'wh2@airspeedmfgvn.com',
  'wh3@airspeedmfgvn.com',
  'wh4@airspeedmfgvn.com'
].join(',');

const OTP_RECIPIENT_ID = 'ASP0106';
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_DOC_ID = 'current';
const OTP_COLLECTION = 'inbound-ldv-otp';

function random4DigitCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function vnNowLabel(d = new Date()): string {
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}

async function sendOtpToZalo(
  db: admin.firestore.Firestore,
  code: string,
  token: string,
  requestedBy: string,
  materialCode: string,
  factory: string
): Promise<void> {
  const linkSnap = await db.collection('zalo_links').where('memberId', '==', OTP_RECIPIENT_ID).limit(1).get();
  if (linkSnap.empty) {
    throw new Error(`Chưa có zalo_links cho ${OTP_RECIPIENT_ID}`);
  }
  const chatId = String(linkSnap.docs[0].data()?.chatId || '').trim();
  if (!chatId) {
    throw new Error(`Thiếu chatId cho ${OTP_RECIPIENT_ID}`);
  }
  const msg =
    `🔐 Sửa lượng đơn vị (Nhận hàng)\n` +
    `Thời điểm: ${vnNowLabel()}\n` +
    (requestedBy ? `Người yêu cầu: ${requestedBy}\n` : '') +
    (factory ? `Nhà máy: ${factory}\n` : '') +
    (materialCode ? `Mã hàng: ${materialCode}\n` : '') +
    `Mã xác nhận: ${code}\n` +
    `Hiệu lực: 10 phút (một lần dùng)`;
  const url = `https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: msg })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Zalo sendMessage failed: ${res.status} ${JSON.stringify(body)}`);
  }
}

export async function requestInboundLdvOtp(
  db: admin.firestore.Firestore,
  opts?: { requestedBy?: string; materialCode?: string; factory?: string }
): Promise<void> {
  const token = zaloBotToken.value().trim();
  if (!token) throw new Error('Thiếu ZALO_BOT_TOKEN');
  const requestedBy = String(opts?.requestedBy || '').trim().toUpperCase().slice(0, 20);
  const materialCode = String(opts?.materialCode || '').trim().slice(0, 80);
  const factory = String(opts?.factory || '').trim().toUpperCase().slice(0, 10);
  const code = random4DigitCode();
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + OTP_TTL_MS);
  await db.collection(OTP_COLLECTION).doc(OTP_DOC_ID).set({
    code,
    recipientId: OTP_RECIPIENT_ID,
    requestedBy,
    materialCode,
    factory,
    expiresAt,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  await sendOtpToZalo(db, code, token, requestedBy, materialCode, factory);
}

export async function verifyInboundLdvOtp(
  db: admin.firestore.Firestore,
  codeRaw: string
): Promise<{ ok: true }> {
  const code = String(codeRaw || '').trim();
  if (!/^\d{4}$/.test(code)) {
    throw new Error('Mã OTP phải gồm 4 chữ số.');
  }
  const ref = db.collection(OTP_COLLECTION).doc(OTP_DOC_ID);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error('Chưa có mã OTP. Vui lòng yêu cầu gửi lại qua Zalo.');
  }
  const data = snap.data() as { code?: string; expiresAt?: admin.firestore.Timestamp };
  const stored = String(data.code || '').trim();
  const expiresMs = data.expiresAt?.toMillis?.() ?? 0;
  if (Date.now() > expiresMs) {
    await ref.delete().catch(() => undefined);
    throw new Error('Mã OTP đã hết hạn. Vui lòng yêu cầu mã mới.');
  }
  if (stored !== code) {
    throw new Error('Mã OTP không đúng.');
  }
  await ref.delete();
  return { ok: true };
}

export type InboundLdvMismatchPayload = {
  materialCode: string;
  poNumber: string;
  batchNumber: string;
  factory: string;
  rollsOrBags: number;
  standardPacking: number;
  reportedBy: string;
};

export async function sendInboundLdvMismatchEmail(p: InboundLdvMismatchPayload): Promise<void> {
  const cfg = getSmtpConfig();
  if (!cfg) throw new Error('Thiếu SMTP (EMAIL_USER, EMAIL_PASS)');
  const atStr = vnNowLabel();
  const text =
    `Lượng đơn vị khi nhận hàng khác Standard Packing.\n\n` +
    `Thời điểm: ${atStr}\n` +
    `Nhà máy: ${p.factory}\n` +
    `Mã hàng: ${p.materialCode}\n` +
    `P.O: ${p.poNumber}\n` +
    `Lô: ${p.batchNumber}\n` +
    `Lượng đơn vị: ${p.rollsOrBags}\n` +
    `Standard Packing: ${p.standardPacking}\n` +
    `Người nhập: ${p.reportedBy}\n`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<p><strong>Lượng đơn vị khác Standard Packing</strong></p>
<p>Thời điểm: <strong>${esc(atStr)}</strong></p>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px" cellpadding="6" border="1">
<tr><td>Nhà máy</td><td>${esc(p.factory)}</td></tr>
<tr><td>Mã hàng</td><td><strong>${esc(p.materialCode)}</strong></td></tr>
<tr><td>P.O</td><td>${esc(p.poNumber)}</td></tr>
<tr><td>Lô</td><td>${esc(p.batchNumber)}</td></tr>
<tr><td>Lượng đơn vị</td><td><strong>${esc(String(p.rollsOrBags))}</strong></td></tr>
<tr><td>Standard Packing</td><td><strong>${esc(String(p.standardPacking))}</strong></td></tr>
<tr><td>Người nhập</td><td>${esc(p.reportedBy)}</td></tr>
</table>
</body></html>`;
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass }
  });
  await transporter.sendMail({
    from: cfg.from,
    to: LDV_MISMATCH_RECIPIENTS,
    subject: `[Nhận hàng] ${p.materialCode} lệch lượng đơn vị / Standard Packing`.slice(0, 250),
    text,
    html
  });
}
