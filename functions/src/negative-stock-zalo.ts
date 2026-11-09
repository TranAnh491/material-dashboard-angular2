import * as admin from 'firebase-admin';
import { sendZaloToChat } from './zalo-notify.util';

/**
 * Tồn NVL âm (≤ -1) → Zalo nhóm Kho: mã, PO, vị trí, tồn và các lần xuất gần nhất (LSX + người scan).
 * Chỉ báo khi tồn vừa xuống ≤ -1 (trước đó > -1), mỗi dòng tồn tối đa 1 lần / 6 giờ.
 */
const KHO_GROUP_DOC = 'zalo_group_config/quanly_kho';
const DEDUPE_COLLECTION = 'negative-stock-zalo';
const DEDUPE_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_THRESHOLD = -1;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function stockOf(d: Record<string, unknown>): number {
  const opening = d['openingStock'] != null && d['openingStock'] !== '' ? num(d['openingStock']) : 0;
  return opening + num(d['quantity']) - num(d['exported']) - num(d['xt']);
}

function fmt(n: number): string {
  return (Math.round(n * 1000) / 1000).toLocaleString('en-US');
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof admin.firestore.Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  const t = v as { toDate?: () => Date; seconds?: number };
  if (typeof t.toDate === 'function') return t.toDate();
  if (typeof t.seconds === 'number') return new Date(t.seconds * 1000);
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

function vnTime(d: Date | null): string {
  if (!d) return '';
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const normPo = (s: unknown) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');

export async function notifyNegativeStockOnWrite(
  db: admin.firestore.Firestore,
  docId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): Promise<void> {
  if (!after) return;
  const code = String(after['materialCode'] || '').trim().toUpperCase();
  if (!code) return;
  const stockAfter = stockOf(after);
  if (stockAfter > NEGATIVE_THRESHOLD) return;
  // Chỉ khi vừa vượt ngưỡng (tránh báo lại mỗi lần ghi khi đã âm sẵn)
  if (before && stockOf(before) <= NEGATIVE_THRESHOLD) return;

  const dedupeRef = db.collection(DEDUPE_COLLECTION).doc(docId);
  const ok = await db.runTransaction(async (tx) => {
    const snap = await tx.get(dedupeRef);
    const last = toDate(snap.data()?.['sentAt'])?.getTime() || 0;
    if (Date.now() - last < DEDUPE_MS) return false;
    tx.set(dedupeRef, { sentAt: admin.firestore.FieldValue.serverTimestamp(), materialCode: code, stock: stockAfter });
    return true;
  });
  if (!ok) return;

  const factory = String(after['factory'] || '').trim();
  const po = String(after['poNumber'] || '').trim();
  const location = String(after['location'] ?? after['viTri'] ?? '').trim();

  // Các lần xuất mã + PO này (LSX, người scan) — lọc trong bộ nhớ để không cần index ghép
  const outSnap = await db.collection('outbound-materials').where('materialCode', '==', code).get();
  const outs = outSnap.docs
    .map((d) => d.data() as Record<string, unknown>)
    .filter((o) => (!factory || String(o['factory'] || '') === factory) && (!po || normPo(o['poNumber']) === normPo(po)))
    .map((o) => ({
      at: toDate(o['exportDate']) || toDate(o['createdAt']),
      lsx: String(o['productionOrder'] || '').trim(),
      by: String(o['exportedBy'] || o['employeeId'] || '').trim(),
      qty: num(o['exportQuantity'] ?? o['quantity']),
      method: String(o['scanMethod'] || '').trim()
    }))
    .sort((a, b) => (b.at?.getTime() || 0) - (a.at?.getTime() || 0));

  const recent = outs.slice(0, 6);
  const byLsx = new Map<string, number>();
  for (const o of outs) byLsx.set(o.lsx || '(không LSX)', (byLsx.get(o.lsx || '(không LSX)') || 0) + o.qty);

  const opening = after['openingStock'] != null && after['openingStock'] !== '' ? num(after['openingStock']) : 0;
  const lines = [
    `⚠️ Tồn NVL âm (${factory || '—'})`,
    `Mã: ${code}${po ? ` · PO ${po}` : ''}`,
    `Vị trí: ${location || '(chưa có)'}`,
    `Tồn: ${fmt(stockAfter)} (đầu kỳ ${fmt(opening)} + nhập ${fmt(num(after['quantity']))} − xuất ${fmt(num(after['exported']))} − XT ${fmt(num(after['xt']))})`,
  ];
  if (recent.length) {
    lines.push('', 'Các lần xuất gần nhất (mới nhất trước):');
    recent.forEach((o, i) => {
      lines.push(`${i === 0 ? '👉' : '-'} ${vnTime(o.at)} · LSX ${o.lsx || '—'} · ${o.by || 'không rõ người scan'} · ${fmt(o.qty)}${o.method ? ` (${o.method})` : ''}`);
    });
    if (byLsx.size > 1) {
      lines.push('', 'Tổng xuất theo LSX:');
      [...byLsx.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
        .forEach(([lsx, q]) => lines.push(`- ${lsx}: ${fmt(q)}`));
    }
  } else {
    lines.push('', 'Không tìm thấy lần xuất nào của mã + PO này (có thể âm do sửa tay / XT).');
  }

  const groupSnap = await db.doc(KHO_GROUP_DOC).get();
  const chatId = String(groupSnap.data()?.['chatId'] || '').trim();
  if (!chatId) {
    console.warn('[negative-stock-zalo] Chưa gắn nhóm Kho (zalo_group_config/quanly_kho)');
    return;
  }
  await sendZaloToChat(chatId, lines.join('\n').slice(0, 1990));
}
