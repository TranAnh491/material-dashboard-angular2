import * as admin from 'firebase-admin';
import { zaloBotToken } from './params-config';

const ALLOWED_EMPLOYEE_IDS = new Set(['ASP0106', 'ASP0119', 'ASP0538', 'ASP1761']);
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_COLLECTION = 'location-unlock-otp';

function normalizeEmployeeId(raw: string): string | null {
  const compact = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  const m = /^ASP(\d{4})$/.exec(compact);
  return m ? `ASP${m[1]}` : null;
}

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
  token: string
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
  const msg =
    `🔐 Mã mở khóa cột Vị trí (Materials)\n` +
    `Thời điểm: ${atStr}\n` +
    `Mã nhân viên: ${memberId}\n` +
    `Mã đăng nhập: ${code}\n` +
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

export async function requestLocationUnlockOtp(db: admin.firestore.Firestore, employeeIdRaw: string): Promise<void> {
  const employeeId = normalizeEmployeeId(employeeIdRaw);
  if (!employeeId || !ALLOWED_EMPLOYEE_IDS.has(employeeId)) {
    throw new Error('Mã nhân viên không được phép mở khóa cột Vị trí.');
  }
  const token = zaloBotToken.value().trim();
  if (!token) {
    throw new Error('Thiếu ZALO_BOT_TOKEN');
  }
  const code = random4DigitCode();
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + OTP_TTL_MS);
  await db.collection(OTP_COLLECTION).doc(employeeId).set({
    employeeId,
    code,
    expiresAt,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  await sendOtpToZalo(db, employeeId, code, token);
}

export async function verifyLocationUnlockOtp(
  db: admin.firestore.Firestore,
  employeeIdRaw: string,
  codeRaw: string
): Promise<{ ok: true; employeeId: string }> {
  const employeeId = normalizeEmployeeId(employeeIdRaw);
  if (!employeeId || !ALLOWED_EMPLOYEE_IDS.has(employeeId)) {
    throw new Error('Mã nhân viên không được phép mở khóa cột Vị trí.');
  }
  const code = String(codeRaw || '').trim();
  if (!/^\d{4}$/.test(code)) {
    throw new Error('Mã OTP phải gồm 4 chữ số.');
  }
  const ref = db.collection(OTP_COLLECTION).doc(employeeId);
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
  return { ok: true, employeeId };
}
