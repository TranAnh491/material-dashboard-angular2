import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';
import { emailFrom, emailPass, emailSmtpHost, emailSmtpPort, emailUser } from './params-config';

const LATE_EMAILS_DOC = 'print-label-settings/late-notification-emails';

type ScheduleRow = {
  maTem?: string;
  tinhTrang?: string;
  ngayNhanKeHoach?: string;
  khachHang?: string;
  lenhSanXuat?: string;
  nguoiIn?: string;
};

function esc(s: string | undefined | null): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isDoneStatus(s: string | undefined): boolean {
  const t = (s || '').toLowerCase().trim();
  return t === 'done' || t === 'completed' || t === 'hoàn thành';
}

function parseNgayNhanKeHoach(raw: unknown): Date | null {
  const s = String(raw ?? '').trim();
  if (!s) {
    return null;
  }
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const y = parseInt(m[3], 10);
    const dt = new Date(y, mo, d);
    if (!isNaN(dt.getTime())) {
      return dt;
    }
  }
  const m2 = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m2) {
    const dt = new Date(parseInt(m2[1], 10), parseInt(m2[2], 10) - 1, parseInt(m2[3], 10));
    if (!isNaN(dt.getTime())) {
      return dt;
    }
  }
  const t = Date.parse(s);
  if (!isNaN(t)) {
    return new Date(t);
  }
  return null;
}

/** YYYY-MM-DD theo múi Asia/Ho_Chi_Minh */
function toYmdVN(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function todayYmdVN(): string {
  return toYmdVN(new Date());
}

function getSmtp():
  | { host: string; port: number; user: string; pass: string; from: string }
  | null {
  const user = emailUser.value().trim();
  const pass = emailPass.value().trim();
  if (!user || !pass) {
    return null;
  }
  const host = emailSmtpHost.value().trim() || 'smtp.gmail.com';
  const port = parseInt(emailSmtpPort.value().trim() || '587', 10) || 587;
  const fromRaw = emailFrom.value().trim();
  const from = fromRaw || user;
  return { host, port, user, pass, from };
}

async function loadRecipientEmails(db: admin.firestore.Firestore): Promise<string[]> {
  const snap = await db.doc(LATE_EMAILS_DOC).get();
  const d = snap.exists ? (snap.data() as any) : null;
  const arr = Array.isArray(d?.emails) ? d.emails : [];
  const list = arr
    .map((x: unknown) => String(x ?? '').trim().toLowerCase())
    .filter((x: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
  return Array.from(new Set(list));
}

async function loadLatestScheduleRows(db: admin.firestore.Firestore): Promise<ScheduleRow[]> {
  const qs = await db.collection('print-schedules').orderBy('importedAt', 'desc').limit(1).get();
  if (qs.empty) {
    return [];
  }
  const data = qs.docs[0].data() as any;
  const arr = data?.data;
  if (!Array.isArray(arr)) {
    return [];
  }
  return arr as ScheduleRow[];
}

function collectLateItems(rows: ScheduleRow[]): ScheduleRow[] {
  const today = todayYmdVN();
  const out: ScheduleRow[] = [];
  for (const row of rows) {
    if (isDoneStatus(row.tinhTrang)) {
      continue;
    }
    const dt = parseNgayNhanKeHoach(row.ngayNhanKeHoach);
    if (!dt) {
      continue;
    }
    const planYmd = toYmdVN(dt);
    if (planYmd < today) {
      out.push(row);
    }
  }
  return out;
}

export async function runPrintLabelLateNotify(db: admin.firestore.Firestore): Promise<{
  sent: boolean;
  lateCount: number;
  recipientCount: number;
}> {
  const recipients = await loadRecipientEmails(db);
  if (recipients.length === 0) {
    console.log('[print-label-late] Bỏ qua: chưa cấu hình email (print-label-settings/late-notification-emails).');
    return { sent: false, lateCount: 0, recipientCount: 0 };
  }

  const rows = await loadLatestScheduleRows(db);
  const late = collectLateItems(rows);
  if (late.length === 0) {
    console.log('[print-label-late] Không có mã trễ kế hoạch (chưa Done + quá ngày nhận KH).');
    return { sent: false, lateCount: 0, recipientCount: recipients.length };
  }

  const cfg = getSmtp();
  if (!cfg) {
    throw new Error('Thiếu SMTP (EMAIL_USER, EMAIL_PASS)');
  }

  const atStr = new Date().toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour12: false
  });
  const lines = late.map(
    r =>
      `- ${r.maTem || '(no maTem)'} | ${r.tinhTrang || '-'} | KH: ${r.ngayNhanKeHoach || '-'} | KH hàng: ${r.khachHang || '-'} | LSX: ${r.lenhSanXuat || '-'}`
  );
  const text =
    `Print Label — cảnh báo tem trễ ngày nhận kế hoạch (Late)\n` +
    `Thời điểm quét: ${atStr} (Asia/Ho_Chi_Minh)\n` +
    `Số mã: ${late.length}\n\n` +
    `${lines.join('\n')}\n`;

  const tableRows = late
    .map(
      r =>
        `<tr>
  <td>${esc(r.maTem)}</td>
  <td>${esc(r.tinhTrang)}</td>
  <td>${esc(r.ngayNhanKeHoach)}</td>
  <td>${esc(r.khachHang)}</td>
  <td>${esc(r.lenhSanXuat)}</td>
  <td>${esc(r.nguoiIn)}</td>
</tr>`
    )
    .join('\n');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<p><strong>Print Label — Tem trễ kế hoạch (Late)</strong></p>
<p>Thời điểm: <strong>${esc(atStr)}</strong> · Múi giờ: Asia/Ho_Chi_Minh</p>
<p>Số mã chưa Done và đã quá <strong>Ngày nhận kế hoạch</strong>: <strong>${late.length}</strong></p>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:13px" cellpadding="6" border="1">
<thead><tr><th>Mã tem</th><th>Tình trạng</th><th>Ngày nhận KH</th><th>Khách hàng</th><th>Lệnh SX</th><th>Người in</th></tr></thead>
<tbody>${tableRows}</tbody>
</table>
<p style="color:#555;font-size:12px">Gửi tự động từ Cloud Functions (Print Label Late).</p>
</body></html>`;

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass }
  });
  await transporter.sendMail({
    from: cfg.from,
    to: recipients.join(','),
    subject: `[Print Label Late] ${late.length} mã trễ kế hoạch`.slice(0, 250),
    text,
    html
  });

  console.log(`[print-label-late] Đã gửi mail tới ${recipients.length} địa chỉ, ${late.length} mã.`);
  return { sent: true, lateCount: late.length, recipientCount: recipients.length };
}
