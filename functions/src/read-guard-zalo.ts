import * as admin from 'firebase-admin';
import { sendZaloToEmployee } from './zalo-notify.util';

/** Người nhận báo động đọc dữ liệu bất thường. */
const RECIPIENT = 'ASP0106';
/** Cùng trang + cùng kiểu lỗi: tối đa 1 tin / 10 phút. */
const DEDUPE_MS = 10 * 60 * 1000;
const DEDUPE_COLLECTION = 'read-guard-notify';

/** Có sự cố phanh đọc (read-guard-incidents) → báo Zalo ASP0106. */
export async function notifyReadGuardIncident(
  db: admin.firestore.Firestore,
  incidentId: string,
  data: Record<string, any>
): Promise<{ sent: boolean }> {
  const route = String(data.route || '?');
  const reason = String(data.reason || '?');
  const dedupeRef = db.collection(DEDUPE_COLLECTION).doc(`${route}__${reason}`.replace(/[^a-zA-Z0-9_-]/g, '_'));
  const now = Date.now();
  const skip = await db.runTransaction(async (tx) => {
    const snap = await tx.get(dedupeRef);
    const last = snap.exists ? Number((snap.data() as any).lastAt || 0) : 0;
    if (now - last < DEDUPE_MS) {
      tx.set(dedupeRef, { suppressed: admin.firestore.FieldValue.increment(1) }, { merge: true });
      return true;
    }
    tx.set(dedupeRef, { lastAt: now, lastIncident: incidentId, suppressed: 0 }, { merge: true });
    return false;
  });
  if (skip) return { sent: false };

  const top = Array.isArray(data.topCollections) ? data.topCollections : [];
  const lines = [
    '🚨 PHANH ĐỌC DỮ LIỆU BẤT THƯỜNG',
    `Trang: ${route}`,
    `Lý do: ${reason === 'rate' ? 'Đọc quá nhiều trong 1 phút' : reason === 'repeat' ? 'Một truy vấn bị lặp liên tục' : reason}`,
    `Chi tiết: ${String(data.detail || '')}`,
    `Người dùng: ${String(data.userEmail || '—')}`,
    `Thời gian: ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false })}`
  ];
  if (top.length) {
    lines.push('Collection đọc nhiều nhất (60 giây):');
    top.forEach((t: any) => lines.push(`  • ${t.collection}: ${Number(t.reads || 0).toLocaleString('en-US')}`));
  }
  if (data.queryKey) lines.push(`Truy vấn lặp: ${String(data.queryKey).slice(0, 200)}`);
  lines.push('Trình duyệt đã tự dừng đọc. Xem chi tiết: read-guard-incidents/' + incidentId);
  const sent = await sendZaloToEmployee(RECIPIENT, lines.join('\n'));
  await db.collection('read-guard-incidents').doc(incidentId).set({ zaloSent: sent }, { merge: true });
  return { sent };
}
