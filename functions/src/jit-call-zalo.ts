import * as admin from 'firebase-admin';
import { sendZaloToChat } from './zalo-notify.util';

/**
 * JIT (Production): gọi kho lấy hàng cho LSX.
 * - jit-call-log/{id} mới (nút Gọi hoặc hẹn giờ) → Zalo bot nhắn nhóm Kho.
 * - jit-calls/{woId}.nextCallAt tới giờ → tự tạo log gọi (auto) + hẹn lần sau theo mẫu của mã TP.
 */
const KHO_GROUP_DOC = 'zalo_group_config/quanly_kho';
const ROUNDS = 3;

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

function vnTime(d: Date): string {
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export async function onJitCallLogCreated(
  db: admin.firestore.Firestore,
  ref: admin.firestore.DocumentReference,
  d: Record<string, unknown>
): Promise<void> {
  const lsx = String(d['lsx'] || '').trim();
  if (!lsx) return;
  const round = Number(d['round']) || 1;
  const auto = !!d['auto'];
  const qty = Number(d['quantity']) || 0;
  const lines = [
    `📦 JIT — GỌI KHO LẤY HÀNG${auto ? ' (hẹn giờ)' : ''}`,
    `LSX: ${lsx}${d['factory'] ? ` (${d['factory']})` : ''}`,
    `Mã TP: ${d['productCode'] || '—'}${qty ? ` · SL ${qty.toLocaleString('en-US')}` : ''}`,
    d['customer'] ? `Khách: ${d['customer']}` : '',
    d['line'] ? `Line: ${d['line']}` : '',
    `Lần lấy: ${round}/${ROUNDS}`,
    auto ? 'Gọi tự động theo giờ hẹn' : `Người gọi: ${d['by'] || '—'}`,
    `Lúc: ${vnTime(toDate(d['at']) || new Date())}`
  ].filter(Boolean);
  const items = (Array.isArray(d['items']) ? d['items'] : []) as Array<{ code?: string; po?: string; qty?: number; unit?: string; rolls?: number }>;
  if (items.length) {
    lines.push('', `NVL đưa lên line lần ${round} (${items.length} mã):`);
    const MAX = 40;
    items.slice(0, MAX).forEach((it, i) => {
      const rolls = Number(it.rolls) || 0;
      const qty = `${(Number(it.qty) || 0).toLocaleString('en-US')} ${it.unit || ''}`.trim();
      lines.push(`${i + 1}. ${it.code || ''}${it.po ? ' · ' + it.po : ''}: ${rolls > 0 ? `${rolls} cuộn (${qty})` : qty}`);
    });
    if (items.length > MAX) lines.push(`… và ${items.length - MAX} mã khác (xem trang JIT)`);
  }
  const groupSnap = await db.doc(KHO_GROUP_DOC).get();
  const chatId = String(groupSnap.data()?.['chatId'] || '').trim();
  if (!chatId) {
    await ref.set({ sent: false, error: 'Chưa gắn nhóm Kho (zalo_group_config/quanly_kho)' }, { merge: true });
    return;
  }
  const ok = await sendZaloToChat(chatId, lines.join('\n').slice(0, 1990));
  await ref.set({ sent: ok, sentAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
}

/** Mỗi 5 phút: LSX tới giờ hẹn → tạo log gọi (trigger gửi Zalo), hẹn lần sau theo mẫu mã TP. */
export async function runJitScheduledCalls(db: admin.firestore.Firestore): Promise<void> {
  const now = new Date();
  const snap = await db.collection('jit-calls').where('nextCallAt', '<=', now).get();
  for (const doc of snap.docs) {
    const d = doc.data() as Record<string, any>;
    if (!toDate(d['nextCallAt'])) continue;
    const picks: boolean[] = Array.isArray(d['picks']) ? d['picks'] : [];
    const idx = picks.findIndex((x) => !x);
    const round = idx < 0 ? ROUNDS : idx + 1;
    const calls: any[] = Array.isArray(d['calls']) ? d['calls'] : [];
    const newCalls = [...calls, { at: now, round, by: 'BOT', auto: true }];
    let next: Date | null = null;
    const code = String(d['productCode'] || '').trim();
    if (code && newCalls.length < ROUNDS && !picks.every(Boolean)) {
      const pat = (await db.collection('jit-product-pattern').doc(code).get()).data() as any;
      const gap = Number(pat?.gapsMin?.[newCalls.length - 1]) || 0;
      if (gap > 0) next = new Date(now.getTime() + gap * 60000);
    }
    await db.collection('jit-call-log').add({
      woId: doc.id, lsx: d['lsx'] || '', productCode: code, factory: d['factory'] || '',
      quantity: d['quantity'] || 0, customer: d['customer'] || '', line: d['line'] || '',
      round, by: 'BOT', auto: true, at: now,
      // NVL của lần lấy này theo sắp xếp đã lưu
      items: Object.values((d['plan'] || {}) as Record<string, any>)
        .filter((p) => (Number(p?.q?.[round - 1]) || 0) > 0)
        .map((p) => ({ code: p.code || '', po: p.po || '', qty: Number(p.q[round - 1]) || 0, unit: p.unit || '', rolls: Number(p?.rolls?.[round - 1]) || 0 }))
    });
    await doc.ref.set({ calls: newCalls, lastCallAt: now, nextCallAt: next, updatedAt: now }, { merge: true });
  }
}
