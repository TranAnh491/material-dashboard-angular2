import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';
import {
  emailFrom,
  emailPass,
  emailSmtpHost,
  emailSmtpPort,
  emailTo,
  emailUser
} from './params-config';

/** 00:00 ngày 02/04/2026 (giờ Việt Nam UTC+7) = 01/04/2026 17:00 UTC */
const OUTBOUND_DUP_SINCE_MS = Date.UTC(2026, 3, 1, 17, 0, 0, 0);

export type OutboundDupRow = {
  factory: string;
  materialCode: string;
  poNumber: string;
  imd: string;
  bagBatch: string;
  count: number;
  productionOrderSummary: string;
};

type Agg = {
  count: number;
  sample: Pick<OutboundDupRow, 'factory' | 'materialCode' | 'poNumber' | 'imd' | 'bagBatch'>;
  lsx: Set<string>;
};

function isValidRmMaterialCode(code: string): boolean {
  const c = (code || '').trim().toUpperCase();
  return /^[AB]\d{6}$/.test(c);
}

function isValidOutboundPo(po: string): boolean {
  const p = (po || '').trim();
  if (!p || !/[A-Za-z]/.test(p)) {
    return false;
  }
  const u = p.toUpperCase();
  return u.startsWith('KZ') || u.startsWith('LH');
}

function stringHasDigit(s: string): boolean {
  return /\d/.test(String(s || ''));
}

function isOutboundRowEligible(
  materialCode: string,
  poNumber: string,
  imd: string,
  bagBatch: string
): boolean {
  const mc = (materialCode || '').trim().toUpperCase();
  if (!isValidRmMaterialCode(mc)) {
    return false;
  }
  if (!isValidOutboundPo(poNumber)) {
    return false;
  }
  if (!stringHasDigit(imd)) {
    return false;
  }
  if (!stringHasDigit(bagBatch)) {
    return false;
  }
  return true;
}

function docTimeMs(data: admin.firestore.DocumentData): number | null {
  const tryOne = (v: unknown): number | null => {
    if (v == null) {
      return null;
    }
    if (v instanceof admin.firestore.Timestamp) {
      return v.toMillis();
    }
    if (v instanceof Date) {
      const t = v.getTime();
      return Number.isNaN(t) ? null : t;
    }
    return null;
  };
  return tryOne(data.exportDate) ?? tryOne(data.createdAt) ?? tryOne(data.updatedAt);
}

function isOnOrAfterDupSince(data: admin.firestore.DocumentData): boolean {
  const t = docTimeMs(data);
  if (t == null) {
    return false;
  }
  return t >= OUTBOUND_DUP_SINCE_MS;
}

function compositeKey(
  factory: string,
  materialCode: string,
  poNumber: string,
  imd: string,
  bagBatch: string
): string {
  const fac = (factory || '').trim();
  const mc = (materialCode || '').trim().toUpperCase();
  const po = (poNumber || '').trim();
  const im = (imd || '').trim();
  const bag = (bagBatch || '').trim();
  return `${fac}|${mc}|${po}|${im}|${bag}`;
}

async function fetchAllOutboundByFactory(
  db: admin.firestore.Firestore,
  factory: string
): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  const ref = db.collection('outbound-materials');
  const batchSize = 500;
  const idPath = admin.firestore.FieldPath.documentId();
  const out: admin.firestore.QueryDocumentSnapshot[] = [];
  let last: admin.firestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let q: admin.firestore.Query = ref.where('factory', '==', factory).orderBy(idPath).limit(batchSize);
    if (last) {
      q = q.startAfter(last);
    }
    const snap = await q.get();
    if (snap.empty) {
      break;
    }
    out.push(...snap.docs);
    if (snap.docs.length < batchSize) {
      break;
    }
    last = snap.docs[snap.docs.length - 1];
  }
  return out;
}

/** Cùng logic với tab Control Batch (Angular). */
export async function scanOutboundDuplicates(db: admin.firestore.Firestore): Promise<OutboundDupRow[]> {
  const [docs1, docs2] = await Promise.all([
    fetchAllOutboundByFactory(db, 'ASM1'),
    fetchAllOutboundByFactory(db, 'ASM2')
  ]);
  const all = [...docs1, ...docs2];
  const counts = new Map<string, Agg>();

  for (const doc of all) {
    const d = doc.data();
    if (!isOnOrAfterDupSince(d)) {
      continue;
    }
    const factory = String(d.factory ?? '');
    const materialCode = String(d.materialCode ?? '');
    const poNumber = String(d.poNumber ?? '');
    const imdRaw = d.batchNumber ?? d.importDate;
    const imd = imdRaw != null ? String(imdRaw) : '';
    const bagRaw = d.bagBatch;
    const bagBatch = bagRaw != null ? String(bagRaw) : '';

    if (!isOutboundRowEligible(materialCode, poNumber, imd, bagBatch)) {
      continue;
    }

    const key = compositeKey(factory, materialCode, poNumber, imd, bagBatch);
    const lsxVal = d.productionOrder;
    const lsxStr = lsxVal != null ? String(lsxVal).trim() : '';
    const prev = counts.get(key);
    if (prev) {
      prev.count += 1;
      if (lsxStr) {
        prev.lsx.add(lsxStr);
      }
    } else {
      const lsx = new Set<string>();
      if (lsxStr) {
        lsx.add(lsxStr);
      }
      counts.set(key, {
        count: 1,
        sample: {
          factory: factory.trim(),
          materialCode: materialCode.trim(),
          poNumber: poNumber.trim(),
          imd: imd.trim(),
          bagBatch: bagBatch.trim()
        },
        lsx
      });
    }
  }

  const dupes: OutboundDupRow[] = [];
  for (const { count, sample, lsx } of counts.values()) {
    if (count > 1) {
      const lsxList = Array.from(lsx).sort((a, b) => a.localeCompare(b, 'vi'));
      const productionOrderSummary = lsxList.length > 0 ? lsxList.join(' · ') : '—';
      dupes.push({ ...sample, count, productionOrderSummary });
    }
  }
  dupes.sort((a, b) => {
    const fc = (a.factory || '').localeCompare(b.factory || '');
    if (fc !== 0) {
      return fc;
    }
    const mc = (a.materialCode || '').localeCompare(b.materialCode || '');
    if (mc !== 0) {
      return mc;
    }
    const po = (a.poNumber || '').localeCompare(b.poNumber || '');
    if (po !== 0) {
      return po;
    }
    const im = (a.imd || '').localeCompare(b.imd || '');
    if (im !== 0) {
      return im;
    }
    return (a.bagBatch || '').localeCompare(b.bagBatch || '');
  });
  return dupes;
}

type EmailCfg = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  to: string[];
};

function getEmailCfg(): EmailCfg | null {
  const user = emailUser.value().trim();
  const pass = emailPass.value().trim();
  const toRaw = emailTo.value().trim();
  const to = toRaw
    .split(/[,;]/)
    .map(s => s.trim())
    .filter(Boolean);
  if (!user || !pass || to.length === 0) {
    return null;
  }
  const host = emailSmtpHost.value().trim() || 'smtp.gmail.com';
  const port = parseInt(emailSmtpPort.value().trim() || '587', 10) || 587;
  const fromRaw = emailFrom.value().trim();
  const from = fromRaw || user;
  return { host, port, user, pass, from, to };
}

function buildPlainText(dupes: OutboundDupRow[]): string {
  const lines = dupes.map(
    r =>
      `- ${r.factory} | ${r.materialCode} | PO ${r.poNumber} | IMD ${r.imd || '—'} | Bag ${r.bagBatch || '—'} | ${r.count} lần | LSX: ${r.productionOrderSummary}`
  );
  return (
    `Control Batch — phát hiện ${dupes.length} nhóm trùng xuất kho (từ 02/04/2026, đủ điều kiện định dạng).\n\n` +
    lines.join('\n')
  );
}

function buildHtml(dupes: OutboundDupRow[]): string {
  const rows = dupes
    .map(
      r =>
        `<tr><td>${esc(r.factory)}</td><td>${esc(r.materialCode)}</td><td>${esc(r.poNumber)}</td><td>${esc(r.imd)}</td><td>${esc(r.bagBatch)}</td><td style="text-align:right">${r.count}</td><td>${esc(r.productionOrderSummary)}</td></tr>`
    )
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<p><strong>Control Batch</strong> — ${dupes.length} nhóm <strong>trùng xuất kho</strong> (từ 02/04/2026).</p>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:13px">
<thead><tr><th>Nhà máy</th><th>Mã</th><th>PO</th><th>IMD</th><th>Bag</th><th>Số lần</th><th>Lệnh SX</th></tr></thead>
<tbody>${rows}</tbody></table>
<p style="color:#555;font-size:12px">Gửi tự động từ Firebase Functions.</p>
</body></html>`;
}

function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function sendDupEmail(dupes: OutboundDupRow[], cfg: EmailCfg): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass }
  });
  await transporter.sendMail({
    from: cfg.from,
    to: cfg.to.join(', '),
    subject: `[Control Batch] Cảnh báo: ${dupes.length} nhóm trùng xuất kho`,
    text: buildPlainText(dupes),
    html: buildHtml(dupes)
  });
}

/**
 * Quét trùng tại thời điểm gọi và gửi mail (nút Send Mail trên Control Batch).
 * Cùng logic lọc với lịch 12h/17h.
 */
export async function sendOutboundDupReportManual(
  db: admin.firestore.Firestore
): Promise<{ dupGroups: number }> {
  const dupes = await scanOutboundDuplicates(db);
  const cfg = getEmailCfg();
  if (!cfg) {
    throw new Error('Thiếu cấu hình SMTP (EMAIL_USER, EMAIL_PASS, EMAIL_TO)');
  }
  const at = new Date();
  const atStr = at.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false
  });
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass }
  });

  if (dupes.length === 0) {
    await transporter.sendMail({
      from: cfg.from,
      to: cfg.to.join(', '),
      subject: `[Control Batch] Báo cáo — không có nhóm trùng (${atStr})`,
      text:
        `Kiểm tra trùng xuất kho (từ 02/04/2026, đủ điều kiện định dạng).\n` +
        `Thời điểm quét: ${atStr}\n\nKhông có nhóm trùng (mã + PO + IMD + bag, >1 lần).`,
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<p><strong>Control Batch</strong> — báo cáo từ nút Send Mail.</p>
<p>Thời điểm quét: <strong>${esc(atStr)}</strong></p>
<p>Không có nhóm trùng xuất kho.</p>
<p style="color:#555;font-size:12px">Gửi từ Firebase Functions.</p>
</body></html>`
    });
    return { dupGroups: 0 };
  }

  const bodyHtml = buildHtml(dupes).replace(
    '</body>',
    `<p style="margin-top:12px">Thời điểm quét: <strong>${esc(
      atStr
    )}</strong> (báo cáo từ nút Send Mail).</p></body>`
  );
  await transporter.sendMail({
    from: cfg.from,
    to: cfg.to.join(', '),
    subject: `[Control Batch] Báo cáo — ${dupes.length} nhóm trùng xuất kho (${atStr})`,
    text: `${buildPlainText(dupes)}\n\n---\nThời điểm quét: ${atStr}`,
    html: bodyHtml
  });
  return { dupGroups: dupes.length };
}

function vnDateKey(d = new Date()): string {
  const vn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const y = vn.getUTCFullYear();
  const m = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const day = String(vn.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Chạy theo lịch 12h / 17h (VN). Khóa theo ngày + khung giờ để idempotent.
 * SMTP: params EMAIL_USER, secret EMAIL_PASS, EMAIL_TO (+ tuỳ chọn EMAIL_FROM, EMAIL_SMTP_*).
 */
export async function runOutboundDupNotifyForSlot(
  db: admin.firestore.Firestore,
  slot: '12' | '17'
): Promise<void> {
  const dateKey = vnDateKey(new Date());
  const lockId = `${dateKey}-${slot}h`;
  const lockRef = db.collection('outbound-dup-notify-locks').doc(lockId);

  const canProceed = await db.runTransaction(async tx => {
    const snap = await tx.get(lockRef);
    if (snap.exists) {
      const st = (snap.data() as { status?: string })?.status;
      if (st === 'done' || st === 'sending') {
        return false;
      }
    }
    tx.set(
      lockRef,
      { status: 'sending', slot, dateKey, startedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    return true;
  });
  if (!canProceed) {
    console.log('outbound-dup-notify: skip (lock)', lockId);
    return;
  }

  try {
    const dupes = await scanOutboundDuplicates(db);
    if (dupes.length === 0) {
      await lockRef.set(
        {
          status: 'done',
          dupGroups: 0,
          emailSent: false,
          finishedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      return;
    }

    const emailCfg = getEmailCfg();
    if (!emailCfg) {
      console.error(
        'outbound-dup-notify: có trùng nhưng thiếu SMTP (EMAIL_USER, secret EMAIL_PASS, EMAIL_TO)'
      );
      await lockRef.set(
        {
          status: 'done',
          dupGroups: dupes.length,
          emailSent: false,
          emailSkippedReason: 'missing_smtp_config',
          finishedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      return;
    }

    await sendDupEmail(dupes, emailCfg);
    await lockRef.set(
      {
        status: 'done',
        dupGroups: dupes.length,
        emailSent: true,
        finishedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    console.log('outbound-dup-notify: emailed', dupes.length, 'groups', lockId);
  } catch (e) {
    console.error('outbound-dup-notify failed', e);
    await lockRef.set(
      {
        status: 'error',
        errorAt: admin.firestore.FieldValue.serverTimestamp(),
        error: (e as Error)?.message || String(e)
      },
      { merge: true }
    );
  }
}
