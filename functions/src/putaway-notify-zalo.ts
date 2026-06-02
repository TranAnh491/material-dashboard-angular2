import * as admin from 'firebase-admin';
import { zaloBotToken } from './params-config';

export interface PutawayNotifyPayload {
  factory: string;
  memberIds: string[];   // e.g. ['ASP0106', 'ASP0538']
  materials: string[];   // mã hàng
  message?: string;      // override toàn bộ message nếu truyền vào
}

interface ZaloLinkDoc {
  memberId?: string;
  chatId?: string;
  name?: string;
}

async function resolvechatIds(
  db: admin.firestore.Firestore,
  memberIds: string[]
): Promise<{ memberId: string; chatId: string }[]> {
  const results: { memberId: string; chatId: string }[] = [];
  for (const mid of memberIds) {
    const snap = await db
      .collection('zalo_links')
      .where('memberId', '==', mid)
      .limit(1)
      .get();
    if (!snap.empty) {
      const d = snap.docs[0].data() as ZaloLinkDoc;
      const chatId = String(d.chatId || '').trim();
      if (chatId) results.push({ memberId: mid, chatId });
    }
  }
  return results;
}

export async function sendPutawayNotifyZalo(
  db: admin.firestore.Firestore,
  p: PutawayNotifyPayload
): Promise<{ sent: string[]; skipped: string[] }> {
  const token = zaloBotToken.value().trim();
  if (!token) throw new Error('Thiếu ZALO_BOT_TOKEN');

  const links = await resolvechatIds(db, p.memberIds);
  const skipped = p.memberIds.filter(m => !links.find(l => l.memberId === m));

  if (!links.length) {
    throw new Error(`Không tìm thấy chatId cho các nhân viên: ${p.memberIds.join(', ')}`);
  }

  const now = new Date();
  const dateStr = now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
  const matList = p.materials.map(m => `  • ${m}`).join('\n');
  const msg = p.message?.trim() ||
    `📦 [Cất NVL — ${String(p.factory || '').trim()}]\n` +
    `Thời gian: ${dateStr}\n` +
    `Các mã cần cất:\n${matList}\n` +
    `Vui lòng xác nhận và tiến hành cất kho.`;

  const url = `https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/sendMessage`;
  const sent: string[] = [];

  await Promise.all(
    links.map(async ({ memberId, chatId }) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error(`[putaway-notify] Zalo sendMessage failed for ${memberId}: ${res.status}`, body);
      } else {
        sent.push(memberId);
      }
    })
  );

  return { sent, skipped };
}
