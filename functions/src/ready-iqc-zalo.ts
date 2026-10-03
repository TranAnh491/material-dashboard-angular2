/**
 * LSX Ready-IQC: báo nhóm PLN các mã NVL đang ở vị trí IQC, chưa Pass.
 */
import * as admin from 'firebase-admin';
import { zaloBotToken } from './params-config';

const NOTICE_COLLECTION = 'ready-iqc-zalo';

export type ReadyIqcItem = {
  materialCode: string;
  po: string;
  location: string;
  iqcStatus: string;
};

function fold(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function groupBlob(id: string, data: admin.firestore.DocumentData | undefined): string {
  return fold([id, data?.label, data?.name, data?.purpose, data?.key].filter(Boolean).join(' '));
}

function isPlnGroup(id: string, data: admin.firestore.DocumentData | undefined): boolean {
  const blob = groupBlob(id, data);
  return blob === 'pln' || blob.includes('nhompln') || blob.includes('pln');
}

function lsxDocId(lsx: string): string {
  return lsx
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/\//g, '_')
    .replace(/[^A-Z0-9._-]/g, '')
    .slice(0, 80);
}

async function sendText(token: string, chatId: string, text: string): Promise<void> {
  const url = `https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 2000) })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || (body && (body as { ok?: boolean }).ok === false)) {
    throw new Error(`Zalo sendMessage failed: ${res.status} ${JSON.stringify(body)}`);
  }
}

async function resolvePlnChatId(db: admin.firestore.Firestore): Promise<string> {
  const snap = await db.collection('zalo_group_config').get();
  let pln = '';
  snap.docs.forEach((doc) => {
    const chatId = String(doc.data()?.chatId || '').trim();
    if (!chatId || pln) return;
    if (isPlnGroup(doc.id, doc.data())) pln = chatId;
  });
  if (!pln) throw new Error('Chưa gắn nhóm PLN (zalo_group_config, tên/nhãn có PLN).');
  return pln;
}

export async function notifyReadyIqcWaiting(
  db: admin.firestore.Firestore,
  opts?: { lsx?: string; factory?: string; items?: ReadyIqcItem[] }
): Promise<{ sent: boolean }> {
  const token = zaloBotToken.value().trim();
  if (!token) throw new Error('Thiếu ZALO_BOT_TOKEN');
  const lsx = String(opts?.lsx || '').trim().slice(0, 40);
  const docId = lsxDocId(lsx);
  if (!lsx || !docId) throw new Error('Thiếu LSX.');
  const factory = String(opts?.factory || '').trim().toUpperCase().slice(0, 16);
  const items = (Array.isArray(opts?.items) ? opts.items : [])
    .map((item) => ({
      materialCode: String(item?.materialCode || '').trim().toUpperCase().slice(0, 40),
      po: String(item?.po || '').trim().slice(0, 80),
      location: String(item?.location || '').trim().slice(0, 40),
      iqcStatus: String(item?.iqcStatus || '').trim().slice(0, 40) || 'Chưa pass'
    }))
    .filter((item) => item.materialCode);
  if (!items.length) return { sent: false };

  const signature = items
    .map((item) => `${item.materialCode}|${item.po}|${item.iqcStatus}`)
    .sort()
    .join('\n');
  const noticeRef = db.collection(NOTICE_COLLECTION).doc(docId);
  const prev = await noticeRef.get();
  if (String(prev.data()?.signature || '') === signature) return { sent: false };

  const pln = await resolvePlnChatId(db);
  const codes = items.map((item) => item.materialCode);
  const shown = codes.slice(0, 30);
  const more = codes.length - shown.length;
  const codeText = more > 0 ? `${shown.join(', ')} và ${more} mã nữa` : shown.join(', ');
  const text = `Chào chị Hồng,\nLSX ${lsx} đã ready, nhưng chờ mã ${codeText}`;
  await sendText(token, pln, text);
  await noticeRef.set({
    lsx,
    factory,
    signature,
    itemCount: items.length,
    notifiedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { sent: true };
}
