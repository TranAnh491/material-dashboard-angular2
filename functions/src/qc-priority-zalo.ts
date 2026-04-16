import * as admin from 'firebase-admin';
import { zaloBotToken } from './params-config';
import type { QcPriorityResolvedPayload } from './qc-priority-email';

const TARGET_MEMBER_ID = 'ASP0609';

function vnNowLabel(d = new Date()): string {
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}

export async function sendQcPriorityStatusChangedZalo(
  db: admin.firestore.Firestore,
  p: QcPriorityResolvedPayload
): Promise<void> {
  const token = zaloBotToken.value().trim();
  if (!token) {
    throw new Error('Thiếu ZALO_BOT_TOKEN');
  }

  const linkSnap = await db
    .collection('zalo_links')
    .where('memberId', '==', TARGET_MEMBER_ID)
    .limit(1)
    .get();

  if (linkSnap.empty) {
    throw new Error(`Chưa có zalo_links cho ${TARGET_MEMBER_ID}`);
  }

  const chatId = String((linkSnap.docs[0].data() as any)?.chatId || '').trim();
  if (!chatId) {
    throw new Error(`Thiếu chatId cho ${TARGET_MEMBER_ID}`);
  }

  const atStr = vnNowLabel(new Date());
  const msg =
    `⚠️ QC ưu tiên (ASM1) đã đổi trạng thái\n` +
    `Thời điểm: ${atStr}\n` +
    `Mã: ${p.materialCode}\n` +
    (p.poNumber ? `PO: ${p.poNumber}\n` : '') +
    (p.imd ? `IMD/Batch: ${p.imd}\n` : '') +
    (p.location ? `Vị trí: ${p.location}\n` : '') +
    `Trạng thái: ${p.oldStatus} → ${p.newStatus}\n` +
    (p.checkedBy ? `Người kiểm: ${p.checkedBy}` : '');

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

