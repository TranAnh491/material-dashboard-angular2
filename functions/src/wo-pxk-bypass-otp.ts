/**
 * Work Order Status: OTP 4 số gửi Zalo tới ASP0106
 * để vượt quyền đổi tình trạng khi PXK lệch — mỗi LSX một mã riêng.
 */
import * as admin from 'firebase-admin';
import { zaloBotToken } from './params-config';

const OTP_RECIPIENT_ID = 'ASP0106';
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_COLLECTION = 'wo-pxk-bypass-otp';

function random4DigitCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function vnNowLabel(d = new Date()): string {
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}

export function woPxkBypassOtpDocId(lsxRaw: string): string {
  return String(lsxRaw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/\//g, '_')
    .replace(/[^A-Z0-9._-]/g, '')
    .slice(0, 80);
}

async function sendOtpToZalo(
  db: admin.firestore.Firestore,
  code: string,
  token: string,
  lsx: string,
  requestedBy: string,
  nextStatus: string,
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
  const lines = [
    `🔐 Vượt quyền PXK lệch (Work Order)`,
    `Thời điểm: ${vnNowLabel(new Date())}`,
    requestedBy ? `Người yêu cầu: ${requestedBy}` : '',
    factory ? `Nhà máy: ${factory}` : '',
    `LSX: ${lsx}`,
    nextStatus ? `Tình trạng: ${nextStatus}` : '',
    `Mã xác nhận: ${code}`,
    `Hiệu lực: 10 phút (một lần, chỉ LSX này)`
  ].filter(Boolean);
  const url = `https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: lines.join('\n') })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Zalo sendMessage failed: ${res.status} ${JSON.stringify(body)}`);
  }
}

export async function requestWoPxkBypassOtp(
  db: admin.firestore.Firestore,
  opts?: { lsx?: string; requestedBy?: string; nextStatus?: string; factory?: string }
): Promise<void> {
  const token = zaloBotToken.value().trim();
  if (!token) {
    throw new Error('Thiếu ZALO_BOT_TOKEN');
  }
  const lsx = String(opts?.lsx || '').trim().toUpperCase().slice(0, 40);
  const docId = woPxkBypassOtpDocId(lsx);
  if (!lsx || !docId) {
    throw new Error('Thiếu LSX để gửi OTP vượt quyền.');
  }
  const requestedBy = String(opts?.requestedBy || '').trim().toUpperCase().slice(0, 20);
  const nextStatus = String(opts?.nextStatus || '').trim().slice(0, 20);
  const factory = String(opts?.factory || '').trim().toUpperCase().slice(0, 16);
  const code = random4DigitCode();
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + OTP_TTL_MS);
  await db.collection(OTP_COLLECTION).doc(docId).set({
    code,
    lsx,
    recipientId: OTP_RECIPIENT_ID,
    requestedBy: requestedBy || '',
    nextStatus,
    factory,
    expiresAt,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  await sendOtpToZalo(db, code, token, lsx, requestedBy, nextStatus, factory);
}

export async function verifyWoPxkBypassOtp(
  db: admin.firestore.Firestore,
  codeRaw: string,
  lsxRaw: string
): Promise<{ ok: true; lsx: string }> {
  const code = String(codeRaw || '').trim();
  if (!/^\d{4}$/.test(code)) {
    throw new Error('Mã OTP phải gồm 4 chữ số.');
  }
  const lsx = String(lsxRaw || '').trim().toUpperCase().slice(0, 40);
  const docId = woPxkBypassOtpDocId(lsx);
  if (!lsx || !docId) {
    throw new Error('Thiếu LSX để xác nhận OTP.');
  }
  const ref = db.collection(OTP_COLLECTION).doc(docId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error('Chưa có mã OTP cho LSX này. Vui lòng yêu cầu gửi lại qua Zalo.');
  }
  const data = snap.data() as {
    code?: string;
    lsx?: string;
    expiresAt?: admin.firestore.Timestamp;
  };
  const storedLsx = String(data.lsx || '').trim().toUpperCase();
  if (storedLsx && storedLsx !== lsx) {
    throw new Error('Mã OTP không khớp LSX này.');
  }
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
  return { ok: true, lsx };
}
