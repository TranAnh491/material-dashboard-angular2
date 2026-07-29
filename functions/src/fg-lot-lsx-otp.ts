import * as admin from 'firebase-admin';
import { zaloBotToken } from './params-config';

const OTP_RECIPIENT_ID = 'ASP0106';
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_DOC_ID = 'current';
const OTP_COLLECTION = 'fg-lot-lsx-otp';

function random4DigitCode(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function vnNowLabel(d = new Date()): string {
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}

export type FgLotLsxOtpMeta = {
  requestedBy?: string;
  materialCode?: string;
  batchNumber?: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
};

async function sendOtpToZalo(
  db: admin.firestore.Firestore,
  code: string,
  token: string,
  meta: FgLotLsxOtpMeta
): Promise<void> {
  const linkSnap = await db.collection('zalo_links').where('memberId', '==', OTP_RECIPIENT_ID).limit(1).get();
  if (linkSnap.empty) {
    throw new Error(`Chưa có zalo_links cho ${OTP_RECIPIENT_ID}`);
  }
  const chatId = String(linkSnap.docs[0].data()?.chatId || '').trim();
  if (!chatId) {
    throw new Error(`Thiếu chatId cho ${OTP_RECIPIENT_ID}`);
  }
  const atStr = vnNowLabel(new Date());
  const fieldLabel = String(meta.field || '').toUpperCase() === 'LSX' ? 'LSX' : 'LOT';
  const lines = [
    `🔐 Yêu cầu sửa ${fieldLabel} (FG Inventory)`,
    `Thời điểm: ${atStr}`,
    meta.requestedBy ? `Người yêu cầu: ${meta.requestedBy}` : '',
    meta.materialCode ? `Mã TP: ${meta.materialCode}` : '',
    meta.batchNumber ? `Batch: ${meta.batchNumber}` : '',
    `Sửa ${fieldLabel}: ${meta.oldValue || '—'} → ${meta.newValue || '—'}`,
    `Mã xác nhận: ${code}`,
    `Hiệu lực: 10 phút (một lần dùng)`
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

export async function requestFgLotLsxOtp(
  db: admin.firestore.Firestore,
  metaRaw?: FgLotLsxOtpMeta
): Promise<void> {
  const token = zaloBotToken.value().trim();
  if (!token) {
    throw new Error('Thiếu ZALO_BOT_TOKEN');
  }
  const meta: FgLotLsxOtpMeta = {
    requestedBy: String(metaRaw?.requestedBy || '').trim().toUpperCase().slice(0, 20),
    materialCode: String(metaRaw?.materialCode || '').trim().toUpperCase().slice(0, 40),
    batchNumber: String(metaRaw?.batchNumber || '').trim().toUpperCase().slice(0, 40),
    field: String(metaRaw?.field || 'LOT').trim().toUpperCase().slice(0, 8),
    oldValue: String(metaRaw?.oldValue || '').trim().slice(0, 80),
    newValue: String(metaRaw?.newValue || '').trim().slice(0, 80)
  };
  const code = random4DigitCode();
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + OTP_TTL_MS);
  await db.collection(OTP_COLLECTION).doc(OTP_DOC_ID).set({
    code,
    recipientId: OTP_RECIPIENT_ID,
    ...meta,
    expiresAt,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  await sendOtpToZalo(db, code, token, meta);
}

export async function verifyFgLotLsxOtp(
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
