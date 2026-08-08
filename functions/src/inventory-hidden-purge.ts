/**
 * RM Inventory — danh mục Ẩn:
 * Sau 30 ngày gửi backup CSV về wh1@airspeedmfgvn.com rồi xóa document.
 */
import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';
import { emailFrom, emailPass, emailSmtpHost, emailSmtpPort, emailUser } from './params-config';

export const INVENTORY_HIDDEN_COLLECTION = 'inventory-materials-hidden';
export const HIDDEN_BACKUP_TO = 'wh1@airspeedmfgvn.com';
export const HIDDEN_RETENTION_DAYS = 30;

function getSmtp(): { host: string; port: number; user: string; pass: string; from: string } | null {
  const user = emailUser.value().trim();
  const pass = emailPass.value().trim();
  if (!user || !pass) return null;
  const host = emailSmtpHost.value().trim() || 'smtp.gmail.com';
  const port = parseInt(emailSmtpPort.value().trim() || '587', 10) || 587;
  const from = emailFrom.value().trim() || user;
  return { host, port, user, pass, from };
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toIso(raw: unknown): string {
  if (!raw) return '';
  if (raw instanceof admin.firestore.Timestamp) return raw.toDate().toISOString();
  if (raw instanceof Date) return raw.toISOString();
  if (typeof (raw as { toDate?: () => Date }).toDate === 'function') {
    try {
      return (raw as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return '';
    }
  }
  const d = new Date(raw as string | number);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function buildCsv(docs: Array<{ id: string; data: admin.firestore.DocumentData }>): string {
  const headers = [
    'id',
    'factory',
    'materialCode',
    'poNumber',
    'location',
    'quantity',
    'openingStock',
    'exported',
    'xt',
    'unit',
    'batchNumber',
    'hideReason',
    'hiddenBy',
    'hiddenAt',
    'deleteAfterAt',
    'payloadJson'
  ];
  const lines = [headers.join(',')];
  for (const { id, data } of docs) {
    const payload = { ...data };
    delete payload.payloadJson;
    lines.push(
      [
        csvEscape(id),
        csvEscape(data.factory),
        csvEscape(data.materialCode),
        csvEscape(data.poNumber),
        csvEscape(data.location ?? data.viTri),
        csvEscape(data.quantity),
        csvEscape(data.openingStock),
        csvEscape(data.exported),
        csvEscape(data.xt),
        csvEscape(data.unit),
        csvEscape(data.batchNumber),
        csvEscape(data.hideReason),
        csvEscape(data.hiddenBy),
        csvEscape(toIso(data.hiddenAt)),
        csvEscape(toIso(data.deleteAfterAt)),
        csvEscape(JSON.stringify(payload))
      ].join(',')
    );
  }
  return '\uFEFF' + lines.join('\n');
}

/**
 * Lấy các bản ghi đã hết hạn 30 ngày, gửi backup mail, rồi xóa.
 */
export async function runInventoryHiddenPurgeJob(
  db: admin.firestore.Firestore
): Promise<{ expiredCount: number; deletedCount: number; sent: boolean }> {
  const now = admin.firestore.Timestamp.now();
  const snap = await db
    .collection(INVENTORY_HIDDEN_COLLECTION)
    .where('deleteAfterAt', '<=', now)
    .limit(500)
    .get();

  if (snap.empty) {
    console.log('[inventory-hidden-purge] Không có bản ghi hết hạn.');
    return { expiredCount: 0, deletedCount: 0, sent: false };
  }

  const docs = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  const cfg = getSmtp();
  if (!cfg) {
    throw new Error('Thiếu SMTP (EMAIL_USER, EMAIL_PASS) — không gửi backup được, giữ nguyên bản ghi ẩn.');
  }

  const atStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
  const dateLabel = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const csv = buildCsv(docs);
  const ymd = new Date().toISOString().slice(0, 10);
  const subject = `[RM Inventory] Backup danh mục Ẩn hết hạn — ${dateLabel} (${docs.length} dòng)`;
  const text =
    `Backup trước khi tự xóa danh mục Ẩn (RM Inventory).\n\n` +
    `Thời điểm: ${atStr}\n` +
    `Số dòng hết hạn (≥ ${HIDDEN_RETENTION_DAYS} ngày): ${docs.length}\n` +
    `File đính kèm: CSV đầy đủ payload.\n`;

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass }
  });

  await transporter.sendMail({
    from: cfg.from,
    to: HIDDEN_BACKUP_TO,
    subject,
    text,
    attachments: [
      {
        filename: `inventory-hidden-expired-${ymd}.csv`,
        content: csv,
        contentType: 'text/csv; charset=utf-8'
      }
    ]
  });

  console.log(`[inventory-hidden-purge] Đã gửi backup ${docs.length} dòng tới ${HIDDEN_BACKUP_TO}`);

  const batchSize = 400;
  let deletedCount = 0;
  for (let i = 0; i < snap.docs.length; i += batchSize) {
    const batch = db.batch();
    const chunk = snap.docs.slice(i, i + batchSize);
    chunk.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deletedCount += chunk.length;
  }

  console.log(`[inventory-hidden-purge] Đã xóa ${deletedCount} bản ghi hết hạn.`);
  return { expiredCount: docs.length, deletedCount, sent: true };
}
