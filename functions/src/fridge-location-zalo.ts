import * as admin from 'firebase-admin';
import { sendZaloToChat } from './zalo-notify.util';

/** Khớp src/app/pages/materials/fridge-nvl-catalog.ts — mọi mã B037 phải ở HOACHAT. */
const B037_REQUIRED_LOCATION = 'HOACHAT';
const KHO_GROUP_DOC = 'zalo_group_config/quanly_kho';
const DEDUPE_COLLECTION = 'fridge-location-zalo';
const DEDUPE_MS = 12 * 60 * 60 * 1000;
const FACTORIES = ['ASM1', 'ASM2'] as const;

export interface FridgeLocationViolation {
  factory: 'ASM1' | 'ASM2';
  materialCode: string;
  location: string;
  poNumber: string;
}

function groupCodeOf(materialCode: string): string {
  const compact = String(materialCode || '').replace(/\s/g, '').toUpperCase();
  const match = /^B(\d{6})/.exec(compact);
  return match ? `B${match[1]}` : '';
}

function isB037Code(materialCode: string): boolean {
  return groupCodeOf(materialCode).startsWith('B037');
}

function locationTokens(location: string): string[] {
  return String(location || '')
    .split(/[,;/\n|]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isHoachatLocation(location: string): boolean {
  const tokens = locationTokens(location).map((part) => part.replace(/\s/g, '').toUpperCase());
  return tokens.length > 0 && tokens.every((token) => token === 'HOACHAT');
}

function availableStock(data: Record<string, unknown>): number {
  const qty = Number(data['quantity']) || 0;
  const exported = Number(data['exported']) || 0;
  const xt = Number(data['xt']) || 0;
  const openingRaw = data['openingStock'];
  const opening = openingRaw != null && openingRaw !== '' ? Number(openingRaw) || 0 : 0;
  if (qty !== 0 || exported !== 0 || xt !== 0 || opening !== 0) {
    return opening + qty - exported - xt;
  }
  const stock = Number(data['stock']);
  return Number.isFinite(stock) ? stock : 0;
}

function readLocation(data: Record<string, unknown>): string {
  return String(data['location'] ?? data['viTri'] ?? '').trim();
}

export function violationFromInventory(
  factory: string,
  data: Record<string, unknown>
): FridgeLocationViolation | null {
  if (factory !== 'ASM1' && factory !== 'ASM2') return null;
  const materialCode = String(data['materialCode'] || '').trim().toUpperCase();
  if (!isB037Code(materialCode)) return null;
  if (availableStock(data) <= 0) return null;
  const location = readLocation(data);
  if (isHoachatLocation(location)) return null;
  return {
    factory,
    materialCode: groupCodeOf(materialCode),
    location: location || '(chưa có vị trí)',
    poNumber: String(data['poNumber'] || '').trim()
  };
}

function formatLines(rows: FridgeLocationViolation[]): string[] {
  return rows.map((row) => {
    const po = row.poNumber ? ` | PO ${row.poNumber}` : '';
    return `- ${row.factory} · ${row.materialCode}${po} | đang ở ${row.location}`;
  });
}

function chunkText(title: string, lines: string[], max = 1900): string[] {
  const chunks: string[] = [];
  let current = title;
  for (const line of lines) {
    const next = `${current}\n${line}`;
    if (next.length > max && current !== title) {
      chunks.push(current);
      current = `${title}\n${line}`;
    } else {
      current = next;
    }
  }
  if (current !== title) chunks.push(current);
  return chunks;
}

async function khoChatId(db: admin.firestore.Firestore): Promise<string> {
  const doc = await db.doc(KHO_GROUP_DOC).get();
  return String(doc.data()?.chatId || '').trim();
}

async function sendReport(
  db: admin.firestore.Firestore,
  title: string,
  rows: FridgeLocationViolation[]
): Promise<number> {
  if (!rows.length) return 0;
  const chatId = await khoChatId(db);
  if (!chatId) {
    console.error('fridge-location-zalo: chưa gắn nhóm Kho');
    return 0;
  }
  let sent = 0;
  for (const text of chunkText(title, formatLines(rows))) {
    if (await sendZaloToChat(chatId, text)) sent += 1;
  }
  return sent;
}

function dedupeId(row: FridgeLocationViolation): string {
  const loc = row.location.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 80) || 'empty';
  return `${row.factory}_${row.materialCode}_${loc}`.slice(0, 700);
}

async function recentlySent(db: admin.firestore.Firestore, row: FridgeLocationViolation): Promise<boolean> {
  const snap = await db.collection(DEDUPE_COLLECTION).doc(dedupeId(row)).get();
  const at = snap.data()?.sentAt;
  const ms = typeof at?.toMillis === 'function' ? at.toMillis() : 0;
  return ms > 0 && Date.now() - ms < DEDUPE_MS;
}

async function markSent(db: admin.firestore.Firestore, row: FridgeLocationViolation): Promise<void> {
  await db.collection(DEDUPE_COLLECTION).doc(dedupeId(row)).set({
    ...row,
    sentAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

/** Quét tồn ASM1 và ASM2. Mã B037 không ở HOACHAT thì báo nhóm Kho. */
export async function sendFridgeLocationZaloReport(
  db: admin.firestore.Firestore
): Promise<{ sent: number; violations: number }> {
  const rows: FridgeLocationViolation[] = [];
  for (const factory of FACTORIES) {
    const snap = await db.collection('inventory-materials').where('factory', '==', factory).get();
    snap.docs.forEach((doc) => {
      const row = violationFromInventory(factory, doc.data() as Record<string, unknown>);
      if (row) rows.push(row);
    });
  }
  rows.sort((a, b) => a.factory.localeCompare(b.factory) || a.materialCode.localeCompare(b.materialCode));
  if (!rows.length) return { sent: 0, violations: 0 };
  const sent = await sendReport(
    db,
    `B037 — SAI VỊ TRÍ\nVị trí đúng: ${B037_REQUIRED_LOCATION}`,
    rows
  );
  return { sent, violations: rows.length };
}

/** Báo ngay khi dòng tồn B037 đổi sang vị trí không phải HOACHAT. */
export async function notifyFridgeLocationOnWrite(
  db: admin.firestore.Firestore,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): Promise<{ sent: number }> {
  if (!after) return { sent: 0 };
  const factory = String(after['factory'] || '');
  const row = violationFromInventory(factory, after);
  if (!row) return { sent: 0 };
  const beforeLoc = before ? readLocation(before) : null;
  const afterLoc = readLocation(after);
  if (before && beforeLoc === afterLoc) return { sent: 0 };
  if (await recentlySent(db, row)) return { sent: 0 };
  const sent = await sendReport(
    db,
    `B037 — SAI VỊ TRÍ\nVị trí đúng: ${B037_REQUIRED_LOCATION}`,
    [row]
  );
  if (sent > 0) await markSent(db, row);
  return { sent };
}
