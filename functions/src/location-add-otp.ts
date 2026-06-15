import * as admin from 'firebase-admin';
import { zaloBotToken } from './params-config';

const OTP_RECIPIENT_ID = 'ASP0106';
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_DOC_ID = 'current';
const OTP_COLLECTION = 'location-add-otp';

function random4DigitCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function vnNowLabel(d = new Date()): string {
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}

async function sendOtpToZalo(
  db: admin.firestore.Firestore,
  memberId: string,
  code: string,
  token: string,
  requestedBy: string,
  locationName: string
): Promise<void> {
  const linkSnap = await db.collection('zalo_links').where('memberId', '==', memberId).limit(1).get();
  if (linkSnap.empty) {
    throw new Error(`Chưa có zalo_links cho ${memberId}`);
  }
  const chatId = String(linkSnap.docs[0].data()?.chatId || '').trim();
  if (!chatId) {
    throw new Error(`Thiếu chatId cho ${memberId}`);
  }
  const atStr = vnNowLabel(new Date());
  const requesterLine = requestedBy ? `Người yêu cầu: ${requestedBy}\n` : '';
  const locationLine = locationName ? `Vị trí: ${locationName}\n` : '';
  const msg =
    `🔐 Yêu cầu thêm vị trí mới (Location)\n` +
    `Thời điểm: ${atStr}\n` +
    requesterLine +
    locationLine +
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

export async function requestLocationAddOtp(
  db: admin.firestore.Firestore,
  requestedByRaw?: string,
  locationNameRaw?: string
): Promise<void> {
  const token = zaloBotToken.value().trim();
  if (!token) {
    throw new Error('Thiếu ZALO_BOT_TOKEN');
  }
  const requestedBy = String(requestedByRaw || '').trim().toUpperCase().slice(0, 20);
  const locationName = String(locationNameRaw || '').trim().slice(0, 80);
  const code = random4DigitCode();
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + OTP_TTL_MS);
  await db.collection(OTP_COLLECTION).doc(OTP_DOC_ID).set({
    code,
    recipientId: OTP_RECIPIENT_ID,
    requestedBy: requestedBy || '',
    locationName,
    expiresAt,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  await sendOtpToZalo(db, OTP_RECIPIENT_ID, code, token, requestedBy, locationName);
}

export async function verifyLocationAddOtp(
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
