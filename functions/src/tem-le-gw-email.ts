/**
 * Tem lẻ: mã tách bag CL có GW lệch > 5% (hoặc bỏ qua không cân) — email 8h sáng hôm sau.
 * Nguồn: `tem-le-gw-suspects` (emailed == false). Gửi xong đánh dấu emailed = true.
 */
import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';
import { emailFrom, emailPass, emailSmtpHost, emailSmtpPort, emailUser } from './params-config';

const TO = 'wh1@airspeedmfgvn.com';
const COLLECTION = 'tem-le-gw-suspects';

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function runTemLeGwSuspectEmail(db: admin.firestore.Firestore): Promise<number> {
  const snap = await db.collection(COLLECTION).where('emailed', '==', false).get();
  if (snap.empty) {
    console.log('[tem-le-gw] Không có mã nghi ngờ mới — không gửi mail.');
    return 0;
  }
  const rows = snap.docs
    .map((d) => ({ ref: d.ref, ...(d.data() as any) }))
    .sort((a, b) => (a.at?.toMillis?.() || 0) - (b.at?.toMillis?.() || 0));

  const user = emailUser.value().trim();
  const pass = emailPass.value().trim();
  if (!user || !pass) throw new Error('Thiếu SMTP (EMAIL_USER, EMAIL_PASS)');
  const port = parseInt(emailSmtpPort.value().trim() || '587', 10) || 587;
  const transporter = nodemailer.createTransport({
    host: emailSmtpHost.value().trim() || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user, pass }
  });

  const when = (r: any) => (r.at?.toDate ? r.at.toDate().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false }) : '');
  const head = ['Thời gian', 'Nhà máy', 'Mã hàng', 'PO', 'IMD', 'Tem', 'Lượng CL', 'Lượng bag nguyên', 'GW bag nguyên (g)', 'GW cân (g)', 'GW dự kiến (g)', 'Lệch / lý do', 'Người'];
  const cells = (r: any) => [when(r), r.factory, r.materialCode, r.po, r.imd, r.clTag, r.clQty, r.fullQty, r.gwBagFull, r.gwCl ?? '—', r.gwExpected ?? '—', r.reason, r.by];
  const html =
    `<p>Danh sách mã tách bag CL có GW lệch &gt; 5% so với GW bag nguyên (hoặc không cân) — ${rows.length} dòng.</p>` +
    `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-family:Arial;font-size:12px">` +
    `<tr style="background:#eee">${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>` +
    rows.map((r) => `<tr>${cells(r).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') +
    `</table><p>Xem trên web: Materials → Tem lẻ → Danh mục nghi ngờ GW.</p>`;
  const text = rows.map((r) => cells(r).join(' | ')).join('\n');
  const dateLabel = new Date().toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

  await transporter.sendMail({
    from: emailFrom.value().trim() || user,
    to: TO,
    subject: `[Tem lẻ] Nghi ngờ sai lệch GW bag CL — ${dateLabel} (${rows.length} dòng)`,
    text,
    html
  });

  const now = admin.firestore.FieldValue.serverTimestamp();
  for (let i = 0; i < rows.length; i += 400) {
    const batch = db.batch();
    rows.slice(i, i + 400).forEach((r) => batch.update(r.ref, { emailed: true, emailedAt: now }));
    await batch.commit();
  }
  return rows.length;
}
