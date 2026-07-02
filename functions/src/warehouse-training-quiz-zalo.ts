import * as admin from 'firebase-admin';
import { zaloBotToken } from './params-config';

const TARGET_MEMBER_ID = 'ASP0119';

function vnNowLabel(d = new Date()): string {
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}

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

async function lookupChatId(db: admin.firestore.Firestore, memberId: string): Promise<string> {
  const linkSnap = await db.collection('zalo_links').where('memberId', '==', memberId).limit(1).get();
  if (linkSnap.empty) {
    throw new Error(`Chưa có zalo_links cho ${memberId}`);
  }
  const chatId = String((linkSnap.docs[0].data() as any)?.chatId || '').trim();
  if (!chatId) {
    throw new Error(`Thiếu chatId cho ${memberId}`);
  }
  return chatId;
}

async function uploadPdfAndGetSignedUrl(buf: Buffer, fileName: string): Promise<string> {
  const bucket = admin.storage().bucket();
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const path = `warehouse-training-quiz/${yyyy}${mm}${dd}/${hh}${mi}${ss}_${fileName}`.replace(/[^\w./-]/g, '_');
  const file = bucket.file(path);
  await file.save(buf, {
    contentType: 'application/pdf',
    resumable: false,
    metadata: { cacheControl: 'private, max-age=0, no-transform' }
  });
  const [url] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000
  });
  return url;
}

export async function sendWarehouseTrainingQuizPdfZalo(
  db: admin.firestore.Firestore,
  payload: {
    employeeId?: string;
    fullName?: string;
    joinDate?: string;
    resultText?: string;
    sectionId?: string;
    pdfDataUrl: string;
  }
): Promise<{ ok: true; url: string }> {
  const token = zaloBotToken.value().trim();
  if (!token) {
    throw new Error('Thiếu ZALO_BOT_TOKEN');
  }

  const buf = decodePdfDataUrl(payload.pdfDataUrl);
  if (!buf?.length) throw new Error('PDF rỗng');

  const employeeId = safeText(payload.employeeId, 40);
  const fullName = safeText(payload.fullName, 120);
  const joinDate = safeText(payload.joinDate, 40);
  const resultText = safeText(payload.resultText, 600);
  const sectionId = safeText(payload.sectionId, 40);

  const baseName = `${employeeId || 'NV'}_${fullName || 'nhan-vien'}`.replace(/\s+/g, '_');
  const signedUrl = await uploadPdfAndGetSignedUrl(buf, `${baseName}.pdf`);

  const chatId = await lookupChatId(db, TARGET_MEMBER_ID);
  const atStr = vnNowLabel(new Date());

  const msg =
    `✅ KT đào tạo kho — Hoàn thành\n` +
    `Thời điểm: ${atStr}\n` +
    (sectionId ? `Bài: ${sectionId}\n` : '') +
    (fullName ? `Họ tên: ${fullName}\n` : '') +
    (employeeId ? `Mã NV: ${employeeId}\n` : '') +
    (joinDate ? `Ngày vào làm: ${joinDate}\n` : '') +
    (resultText ? `Kết quả: ${resultText}\n` : '') +
    `PDF: ${signedUrl}`;

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

  return { ok: true, url: signedUrl };
}

