import * as admin from 'firebase-admin';
import { zaloBotToken } from './params-config';

const OTP_RECIPIENT_ID = 'ASP0106';
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_COLLECTION = 'catalog-delete-otp';

type CatalogScope = 'nvl' | 'tp';

const SCOPE_LABEL: Record<CatalogScope, string> = {
  nvl: 'Danh mục NVL',
  tp: 'Danh mục TP & Mapping KH'
};

function normalizeScope(raw: unknown): CatalogScope {
  return raw === 'tp' ? 'tp' : 'nvl';
}

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
  scope: CatalogScope,
  requestedBy: string
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
  const requesterLine = requestedBy ? `Người yêu cầu: ${requestedBy}\n` : '';
  const msg =
    `🚨 Yêu cầu XÓA TOÀN BỘ ${SCOPE_LABEL[scope]}\n` +
    `Thời điểm: ${atStr}\n` +
    requesterLine +
    `Mã xác nhận: ${code}\n` +
    `Hiệu lực: 10 phút (một lần dùng)\n` +
    `⚠️ Hành động không thể hoàn tác — chỉ cung cấp mã nếu bạn chắc chắn yêu cầu này hợp lệ.`;
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

export async function requestCatalogDeleteOtp(
  db: admin.firestore.Firestore,
  scopeRaw: unknown,
  requestedByRaw?: string
): Promise<void> {
  const scope = normalizeScope(scopeRaw);
  const token = zaloBotToken.value().trim();
  if (!token) {
    throw new Error('Thiếu ZALO_BOT_TOKEN');
  }
  const requestedBy = String(requestedByRaw || '').trim().toUpperCase().slice(0, 20);
  const code = random4DigitCode();
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + OTP_TTL_MS);
  await db.collection(OTP_COLLECTION).doc(scope).set({
    code,
    scope,
    recipientId: OTP_RECIPIENT_ID,
    requestedBy,
    expiresAt,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  await sendOtpToZalo(db, code, token, scope, requestedBy);
}

export async function verifyCatalogDeleteOtp(
  db: admin.firestore.Firestore,
  scopeRaw: unknown,
  codeRaw: string
): Promise<{ ok: true }> {
  const scope = normalizeScope(scopeRaw);
  const code = String(codeRaw || '').trim();
  if (!/^\d{4}$/.test(code)) {
    throw new Error('Mã OTP phải gồm 4 chữ số.');
  }
  const ref = db.collection(OTP_COLLECTION).doc(scope);
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
