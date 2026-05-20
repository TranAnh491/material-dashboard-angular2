import * as admin from 'firebase-admin';
import { zaloBotToken } from './params-config';

export interface WorkOrderKittingZaloContext {
  workOrderId: string;
  productionOrder: string;
  factory?: string;
  employeeId: string;
}

function vnNowLabel(d = new Date()): string {
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
}

export function isCreatedByEmpty(createdBy: unknown): boolean {
  const s = String(createdBy ?? '').trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  if (lower === 'excel import' || lower === 'chưa có') return true;
  return false;
}

export function normalizeAspEmployeeId(raw: unknown): string {
  const s = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return '';
  if (/^\d{4}$/.test(s)) return `ASP${s}`;
  if (/^ASP\d{4}$/.test(s)) return s;
  return '';
}

function toMillis(v: unknown): number {
  if (!v) return 0;
  if (typeof (v as { toDate?: () => Date }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate().getTime();
  }
  if (v instanceof Date) return v.getTime();
  const n = new Date(v as string | number).getTime();
  return Number.isNaN(n) ? 0 : n;
}

function pickEmployeeIdFromOutbound(data: Record<string, unknown>): string {
  const fromEmp = normalizeAspEmployeeId(data.employeeId);
  if (fromEmp) return fromEmp;
  return normalizeAspEmployeeId(data.exportedBy);
}

export async function findLatestOutboundEmployeeId(
  db: admin.firestore.Firestore,
  productionOrder: string,
  factory?: string
): Promise<string | null> {
  const lsx = String(productionOrder ?? '').trim();
  if (!lsx) return null;

  const factoryNorm = String(factory ?? '').trim().toUpperCase();
  const candidates = [lsx, lsx.toUpperCase()];
  const seenLsx = new Set<string>();

  let best: { employeeId: string; at: number } | null = null;

  for (const qLsx of candidates) {
    if (!qLsx || seenLsx.has(qLsx)) continue;
    seenLsx.add(qLsx);

    const snap = await db
      .collection('outbound-materials')
      .where('productionOrder', '==', qLsx)
      .limit(300)
      .get();

    for (const doc of snap.docs) {
      const data = doc.data() as Record<string, unknown>;
      if (factoryNorm && factoryNorm !== 'ALL') {
        const rowFactory = String(data.factory ?? '').trim().toUpperCase();
        if (rowFactory && rowFactory !== factoryNorm) continue;
      }
      const employeeId = pickEmployeeIdFromOutbound(data);
      if (!employeeId) continue;
      const at = Math.max(toMillis(data.createdAt), toMillis(data.updatedAt), toMillis(data.exportDate));
      if (!best || at >= best.at) {
        best = { employeeId, at };
      }
    }
  }

  return best?.employeeId ?? null;
}

async function resolveZaloChatId(
  db: admin.firestore.Firestore,
  memberId: string
): Promise<string> {
  const linkSnap = await db.collection('zalo_links').where('memberId', '==', memberId).limit(1).get();
  if (linkSnap.empty) {
    throw new Error(`Chưa có zalo_links cho ${memberId}`);
  }
  const chatId = String((linkSnap.docs[0].data() as { chatId?: string })?.chatId || '').trim();
  if (!chatId) {
    throw new Error(`Thiếu chatId cho ${memberId}`);
  }
  return chatId;
}

export async function sendWorkOrderKittingZalo(
  db: admin.firestore.Firestore,
  ctx: WorkOrderKittingZaloContext
): Promise<void> {
  const token = zaloBotToken.value().trim();
  if (!token) {
    throw new Error('Thiếu ZALO_BOT_TOKEN');
  }

  const memberId = normalizeAspEmployeeId(ctx.employeeId);
  if (!memberId) {
    throw new Error('employeeId outbound không hợp lệ');
  }

  const chatId = await resolveZaloChatId(db, memberId);
  const atStr = vnNowLabel(new Date());
  const lsx = String(ctx.productionOrder || '').trim() || '—';
  const factory = String(ctx.factory || '').trim() || '—';

  const msg =
    `📦 Lệnh Kitting — chưa có người soạn\n` +
    `Thời điểm: ${atStr}\n` +
    `LSX: ${lsx}\n` +
    `Nhà máy: ${factory}\n` +
    `Bạn là người quét outbound gần nhất của lệnh này.\n` +
    `Vui lòng cập nhật cột「Người soạn」trên Work Order Status.`;

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

export async function handleWorkOrderKittingZaloNotify(
  db: admin.firestore.Firestore,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  workOrderId: string
): Promise<void> {
  const oldStatus = String(before.status ?? '').trim().toLowerCase();
  const newStatus = String(after.status ?? '').trim().toLowerCase();
  if (newStatus !== 'kitting' || oldStatus === 'kitting') {
    return;
  }
  if (!isCreatedByEmpty(after.createdBy)) {
    return;
  }

  const productionOrder = String(after.productionOrder ?? '').trim();
  if (!productionOrder) {
    console.warn('work-order-kitting-zalo: thiếu productionOrder', workOrderId);
    return;
  }

  const factory = String(after.factory ?? '').trim();
  const employeeId = await findLatestOutboundEmployeeId(db, productionOrder, factory);
  if (!employeeId) {
    console.warn(
      'work-order-kitting-zalo: không tìm thấy outbound gần nhất',
      workOrderId,
      productionOrder
    );
    return;
  }

  await sendWorkOrderKittingZalo(db, {
    workOrderId,
    productionOrder,
    factory,
    employeeId
  });

  console.log('work-order-kitting-zalo: sent', workOrderId, productionOrder, employeeId);
}
