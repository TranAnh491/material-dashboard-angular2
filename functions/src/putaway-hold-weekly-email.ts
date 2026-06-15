import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';
import { emailFrom, emailPass, emailSmtpHost, emailSmtpPort, emailUser } from './params-config';

export const HOLD_NOTIFICATION_EMAILS_DOC = 'qc-settings/hold-notification-emails';

type PutawayIqcStatusKind = 'pass' | 'ng' | 'pending' | 'confirm' | 'lock';

type HoldSkuLine = {
  factory: string;
  materialCode: string;
  poNumber: string;
  imd: string;
  location: string;
  iqcStatus: string;
  stock: number;
  dayInIqc: number;
};

type HoldMaterialRow = {
  factory: string;
  materialCode: string;
  holdCount: number;
  totalStock: number;
  dayInIqc: number;
};

function esc(s: string | undefined | null): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isIqcStagingLocation(locationRaw: string): boolean {
  return (locationRaw || '').trim().toUpperCase().startsWith('IQC');
}

function normalizePutawayIqcStatus(raw: string): PutawayIqcStatusKind | null {
  const s = (raw || '').trim();
  if (!s) return null;
  const u = s.toUpperCase();
  if (u === 'PASS') return 'pass';
  if (u === 'NG') return 'ng';
  if (u.includes('LOCK') || u.includes('KHÓA') || u.includes('KHOA')) return 'lock';
  if (u === 'HOLD' || u.includes('ĐẶC CÁCH') || u.includes('DAC CACH')) return 'confirm';
  if (u.includes('CHỜ XÁC NHẬN') || u.includes('CHO XAC NHAN')) return 'confirm';
  if (u.includes('CHỜ KIỂM') || u.includes('CHỜ KIỂM TRA') || u.includes('CHO KIEM')) return 'pending';
  const compact = u.replace(/\s+/g, '');
  if (compact.includes('CHỜXÁCNHẬN') || compact.includes('CHOXACNHAN')) return 'confirm';
  if (compact.includes('CHỜKIỂM') || compact.includes('CHỜKIỂMTRA') || compact.includes('CHOKIEM')) return 'pending';
  return null;
}

function mergePutawayStatusKind(a: PutawayIqcStatusKind, b: PutawayIqcStatusKind): PutawayIqcStatusKind {
  const rank: Record<PutawayIqcStatusKind, number> = { lock: 5, ng: 4, confirm: 3, pending: 2, pass: 1 };
  return rank[a] >= rank[b] ? a : b;
}

function parseInventoryDate(data: admin.firestore.DocumentData): Date | null {
  const fields = ['importDate', 'lastUpdated', 'createdAt'];
  for (const key of fields) {
    const raw = data?.[key];
    if (!raw) continue;
    if (raw instanceof Date) return raw;
    if (raw instanceof admin.firestore.Timestamp) return raw.toDate();
    if (raw?.toDate) return raw.toDate();
    if (raw?.seconds) return new Date(raw.seconds * 1000);
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function getIMDFromDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  return `${day}${month}${year}`;
}

function countDaysNoSunday(from: Date, to: Date): number {
  if (to <= from) return 0;
  let count = 0;
  const cursor = new Date(from);
  while (cursor < to) {
    cursor.setDate(cursor.getDate() + 1);
    if (cursor.getDay() !== 0) count += 1;
  }
  return count;
}

function computeDayInIqc(materialDate: Date | null): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!materialDate) return 1;
  const d0 = new Date(materialDate);
  d0.setHours(0, 0, 0, 0);
  return countDaysNoSunday(d0, today) + 1;
}

async function fetchPutawayStagingInventoryDocs(
  db: admin.firestore.Firestore,
  factory: string
): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  const mergeSnapshotsByDocId = (snaps: admin.firestore.QuerySnapshot[]): admin.firestore.QueryDocumentSnapshot[] => {
    const byId = new Map<string, admin.firestore.QueryDocumentSnapshot>();
    for (const snap of snaps) {
      snap.docs.forEach((d) => byId.set(d.id, d));
    }
    return Array.from(byId.values());
  };

  const col = db.collection('inventory-materials');
  const rangePromises = [
    col.where('factory', '==', factory).where('location', '>=', 'IQC').where('location', '<', 'IQD').get(),
    col.where('factory', '==', factory).where('location', '>=', 'iqc').where('location', '<', 'iqd').get()
  ];

  try {
    const snaps = await Promise.all(rangePromises);
    const merged = mergeSnapshotsByDocId(snaps);
    if (merged.length > 0) return merged;
  } catch (e) {
    console.warn(`[putaway-hold] range IQC query failed for ${factory}`, e);
  }

  const fb = await col.where('factory', '==', factory).limit(8000).get();
  return fb.docs.filter((d) => isIqcStagingLocation(String(d.data()?.location || '')));
}

function collectHoldSkuLines(
  factory: string,
  docs: admin.firestore.QueryDocumentSnapshot[]
): HoldSkuLine[] {
  const skuLines = new Map<
    string,
    {
      materialCode: string;
      poNumber: string;
      imd: string;
      location: string;
      iqcStatus: string;
      statusKind: PutawayIqcStatusKind;
      stock: number;
      materialDate: Date | null;
    }
  >();

  for (const doc of docs) {
    const data = doc.data();
    const locRaw = String(data.location || '').trim();
    if (!isIqcStagingLocation(locRaw)) continue;

    const openingStock =
      data.openingStock !== null && data.openingStock !== undefined ? Number(data.openingStock) : 0;
    const quantity = Number(data.quantity) || 0;
    const exported = Number(data.exported) || 0;
    const xt = Number(data.xt) || 0;
    const stock = openingStock + quantity - exported - xt;
    if (stock <= 0) continue;

    const iqcStatusRaw = String(data.iqcStatus || '').trim();
    const statusKind = normalizePutawayIqcStatus(iqcStatusRaw);
    if (statusKind !== 'confirm') continue;

    const materialCode = String(data.materialCode || '').toUpperCase().trim();
    if (!materialCode) continue;

    const poNumber = String(data.poNumber || '').trim();
    const materialDate = parseInventoryDate(data);
    const imd = getIMDFromDate(materialDate || new Date());
    const lineKey = `${materialCode}|${poNumber}|${imd}|${locRaw}`;

    const existing = skuLines.get(lineKey);
    if (existing) {
      existing.stock += stock;
      existing.statusKind = mergePutawayStatusKind(existing.statusKind, statusKind);
      if (materialDate && (!existing.materialDate || materialDate < existing.materialDate)) {
        existing.materialDate = materialDate;
      }
    } else {
      skuLines.set(lineKey, {
        materialCode,
        poNumber,
        imd,
        location: locRaw,
        iqcStatus: iqcStatusRaw,
        statusKind,
        stock,
        materialDate
      });
    }
  }

  const earliestByCode = new Map<string, Date>();
  skuLines.forEach((line) => {
    if (!line.materialDate) return;
    const prev = earliestByCode.get(line.materialCode);
    if (!prev || line.materialDate < prev) earliestByCode.set(line.materialCode, line.materialDate);
  });

  return Array.from(skuLines.values())
    .map((line) => ({
      factory,
      materialCode: line.materialCode,
      poNumber: line.poNumber,
      imd: line.imd,
      location: line.location,
      iqcStatus: line.iqcStatus,
      stock: line.stock,
      dayInIqc: computeDayInIqc(earliestByCode.get(line.materialCode) || line.materialDate)
    }))
    .sort((a, b) => {
      if (b.dayInIqc !== a.dayInIqc) return b.dayInIqc - a.dayInIqc;
      if (a.materialCode !== b.materialCode) return a.materialCode.localeCompare(b.materialCode);
      return a.poNumber.localeCompare(b.poNumber);
    });
}

function buildHoldMaterialRows(skuLines: HoldSkuLine[]): HoldMaterialRow[] {
  const byCode = new Map<string, { holdCount: number; totalStock: number; dayInIqc: number; factory: string }>();
  for (const line of skuLines) {
    const bucket = byCode.get(`${line.factory}|${line.materialCode}`) || {
      factory: line.factory,
      holdCount: 0,
      totalStock: 0,
      dayInIqc: line.dayInIqc
    };
    bucket.holdCount += 1;
    bucket.totalStock += line.stock;
    if (line.dayInIqc > bucket.dayInIqc) bucket.dayInIqc = line.dayInIqc;
    byCode.set(`${line.factory}|${line.materialCode}`, bucket);
  }

  return Array.from(byCode.entries())
    .map(([key, v]) => ({
      factory: v.factory,
      materialCode: key.split('|')[1] || '',
      holdCount: v.holdCount,
      totalStock: v.totalStock,
      dayInIqc: v.dayInIqc
    }))
    .sort((a, b) => {
      if (b.dayInIqc !== a.dayInIqc) return b.dayInIqc - a.dayInIqc;
      return a.materialCode.localeCompare(b.materialCode);
    });
}

export async function loadHoldNotificationEmails(db: admin.firestore.Firestore): Promise<string[]> {
  const snap = await db.doc(HOLD_NOTIFICATION_EMAILS_DOC).get();
  const d = snap.exists ? (snap.data() as { emails?: unknown }) : null;
  const arr = Array.isArray(d?.emails) ? d.emails : [];
  const list = arr
    .map((x: unknown) => String(x ?? '').trim().toLowerCase())
    .filter((x: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
  return Array.from(new Set(list));
}

function getSmtp(): { host: string; port: number; user: string; pass: string; from: string } | null {
  const user = emailUser.value().trim();
  const pass = emailPass.value().trim();
  if (!user || !pass) return null;
  const host = emailSmtpHost.value().trim() || 'smtp.gmail.com';
  const port = parseInt(emailSmtpPort.value().trim() || '587', 10) || 587;
  const fromRaw = emailFrom.value().trim();
  const from = fromRaw || user;
  return { host, port, user, pass, from };
}

async function loadHoldDataForFactories(
  db: admin.firestore.Firestore,
  factories: string[]
): Promise<{ skuLines: HoldSkuLine[]; materialRows: HoldMaterialRow[] }> {
  const allSku: HoldSkuLine[] = [];
  for (const factory of factories) {
    const docs = await fetchPutawayStagingInventoryDocs(db, factory);
    allSku.push(...collectHoldSkuLines(factory, docs));
  }
  return { skuLines: allSku, materialRows: buildHoldMaterialRows(allSku) };
}

function buildHoldEmailHtml(materialRows: HoldMaterialRow[], skuLines: HoldSkuLine[], atStr: string): string {
  const summaryRows = materialRows
    .map(
      (r) =>
        `<tr>
<td>${esc(r.factory)}</td>
<td>${esc(r.materialCode)}</td>
<td style="text-align:right">${r.dayInIqc}</td>
<td style="text-align:right">${r.holdCount}</td>
<td style="text-align:right">${r.totalStock.toFixed(2)}</td>
</tr>`
    )
    .join('');

  const detailRows = skuLines
    .map(
      (r) =>
        `<tr>
<td>${esc(r.factory)}</td>
<td>${esc(r.materialCode)}</td>
<td>${esc(r.poNumber || '—')}</td>
<td>${esc(r.imd)}</td>
<td>${esc(r.location)}</td>
<td>${esc(r.iqcStatus)}</td>
<td style="text-align:right">${r.stock.toFixed(2)}</td>
<td style="text-align:right">${r.dayInIqc}</td>
</tr>`
    )
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="font-family:sans-serif;font-size:14px;color:#111">
<p><strong>Putaway — Báo cáo mã hàng đang Hold (Chờ xác nhận / HOLD)</strong></p>
<p>Thời điểm: <strong>${esc(atStr)}</strong></p>
<p>Tổng: <strong>${materialRows.length}</strong> mã hàng · <strong>${skuLines.length}</strong> SKU (PO+IMD) đang Hold tại khu IQC.</p>

<h3 style="margin:20px 0 8px;font-size:15px">Tóm tắt theo mã hàng</h3>
<table style="border-collapse:collapse;width:100%;max-width:720px" cellpadding="6" border="1">
<thead><tr style="background:#fff7ed">
<th>Nhà máy</th><th>Mã hàng</th><th>Day</th><th>Hold SKU</th><th>Tồn kho</th>
</tr></thead>
<tbody>${summaryRows || '<tr><td colspan="5">Không có mã Hold.</td></tr>'}</tbody>
</table>

<h3 style="margin:20px 0 8px;font-size:15px">Chi tiết SKU đang Hold</h3>
<table style="border-collapse:collapse;width:100%;max-width:960px;font-size:13px" cellpadding="5" border="1">
<thead><tr style="background:#fff7ed">
<th>Nhà máy</th><th>Mã hàng</th><th>PO</th><th>IMD</th><th>Vị trí</th><th>IQC Status</th><th>Tồn</th><th>Day</th>
</tr></thead>
<tbody>${detailRows || '<tr><td colspan="8">Không có SKU Hold.</td></tr>'}</tbody>
</table>

<p style="color:#555;font-size:12px;margin-top:16px">Nguồn: Dashboard Putaway · vị trí IQC · tồn &gt; 0 · trạng thái Hold/Chờ xác nhận/Đặc cách.</p>
</body></html>`;
}

function buildHoldEmailText(materialRows: HoldMaterialRow[], skuLines: HoldSkuLine[], atStr: string): string {
  const summary = materialRows
    .map(
      (r) =>
        `  • [${r.factory}] ${r.materialCode} — Day ${r.dayInIqc}, Hold SKU: ${r.holdCount}, Tồn: ${r.totalStock.toFixed(2)}`
    )
    .join('\n');
  const detail = skuLines
    .map(
      (r) =>
        `  • [${r.factory}] ${r.materialCode} | PO ${r.poNumber || '—'} | IMD ${r.imd} | ${r.location} | ${r.iqcStatus} | Tồn ${r.stock.toFixed(2)} | Day ${r.dayInIqc}`
    )
    .join('\n');
  return (
    `Putaway — Báo cáo mã hàng đang Hold\n\n` +
    `Thời điểm: ${atStr}\n` +
    `Tổng: ${materialRows.length} mã hàng, ${skuLines.length} SKU Hold.\n\n` +
    `--- Tóm tắt ---\n${summary || '  (không có)'}\n\n` +
    `--- Chi tiết SKU ---\n${detail || '  (không có)'}\n`
  );
}

export async function runPutawayHoldWeeklyEmail(
  db: admin.firestore.Firestore
): Promise<{ sent: boolean; holdMaterialCount: number; holdSkuCount: number; recipientCount: number }> {
  const recipients = await loadHoldNotificationEmails(db);
  if (recipients.length === 0) {
    console.log('[putaway-hold] Bỏ qua: chưa cấu hình email (qc-settings/hold-notification-emails).');
    return { sent: false, holdMaterialCount: 0, holdSkuCount: 0, recipientCount: 0 };
  }

  const { skuLines, materialRows } = await loadHoldDataForFactories(db, ['ASM1', 'ASM2']);
  if (skuLines.length === 0) {
    console.log('[putaway-hold] Không có mã Hold — vẫn gửi mail báo không có.');
  }

  const cfg = getSmtp();
  if (!cfg) {
    throw new Error('Thiếu SMTP (EMAIL_USER, EMAIL_PASS)');
  }

  const atStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false });
  const dateLabel = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
  const subject = `[Putaway Hold] Báo cáo tuần — ${dateLabel} (${materialRows.length} mã, ${skuLines.length} SKU)`;
  const html = buildHoldEmailHtml(materialRows, skuLines, atStr);
  const text = buildHoldEmailText(materialRows, skuLines, atStr);

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass }
  });

  await transporter.sendMail({
    from: cfg.from,
    to: recipients.join(', '),
    subject,
    text,
    html
  });

  console.log(
    `[putaway-hold] Đã gửi mail tới ${recipients.length} người nhận. Hold: ${materialRows.length} mã, ${skuLines.length} SKU.`
  );

  return {
    sent: true,
    holdMaterialCount: materialRows.length,
    holdSkuCount: skuLines.length,
    recipientCount: recipients.length
  };
}
