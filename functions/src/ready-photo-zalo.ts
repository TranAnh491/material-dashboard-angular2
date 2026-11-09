/**
 * LSX chuyển Ready ở Line cần chụp hình (WHA / WHB / WHG / WHH, USB C):
 * Zalo riêng cho từng người trong team soạn (khớp tên / mã ASP với zalo_links).
 */
import * as admin from 'firebase-admin';
import { sendZaloToChat } from './zalo-notify.util';

const NOTICE_COLLECTION = 'ready-photo-zalo';

function fold(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function lsxDocId(lsx: string): string {
  return lsx
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/\//g, '_')
    .replace(/[^A-Z0-9._-]/g, '')
    .slice(0, 80);
}

/** Khớp tên đúng trước ("Tuấn" ↔ "Tuấn"); không có thì khớp chữ đầu nếu chỉ 1 người ("Tình" ↔ "Tình mlem"). */
function matchLinks(
  names: string[],
  links: Array<{ memberId: string; name: string; chatId: string }>
): Map<string, { memberId: string; name: string; chatId: string }> {
  const out = new Map<string, { memberId: string; name: string; chatId: string }>();
  for (const raw of names) {
    const n = fold(raw);
    if (!n) continue;
    const exact = links.filter((l) => fold(l.name) === n);
    const pick = exact.length ? exact : links.filter((l) => fold(l.name).split(' ')[0] === n);
    if (pick.length === 1) out.set(pick[0].memberId, pick[0]);
  }
  return out;
}

export async function notifyReadyPhotoRequired(
  db: admin.firestore.Firestore,
  opts: {
    lsx: string;
    line: string;
    factory: string;
    productCode: string;
    team: string;
    names: string[];
    memberIds: string[];
  }
): Promise<{ sentTo: string[]; skipped: boolean }> {
  const lsx = String(opts.lsx || '').trim().slice(0, 40);
  const docId = lsxDocId(lsx);
  if (!lsx || !docId) throw new Error('Thiếu LSX.');
  const line = String(opts.line || '').trim().slice(0, 40);

  const noticeRef = db.collection(NOTICE_COLLECTION).doc(docId);
  const prev = await noticeRef.get();
  const prevAt = prev.data()?.notifiedAt?.toMillis?.() || 0;
  // Đổi qua lại Ready trong 12h → không nhắn lại.
  if (prevAt && Date.now() - prevAt < 12 * 3600 * 1000) return { sentTo: [], skipped: true };

  const snap = await db.collection('zalo_links').get();
  const links = snap.docs
    .map((d) => d.data())
    .filter((d) => d?.enabled !== false && d?.chatId && d?.memberId)
    .map((d) => ({
      memberId: String(d.memberId).trim().toUpperCase(),
      name: String(d.name || '').trim(),
      chatId: String(d.chatId).trim()
    }));

  const targets = matchLinks((opts.names || []).slice(0, 20), links);
  for (const id of (opts.memberIds || []).slice(0, 5)) {
    const m = links.find((l) => l.memberId === String(id || '').trim().toUpperCase());
    if (m) targets.set(m.memberId, m);
  }
  if (!targets.size) return { sentTo: [], skipped: false };

  const factory = String(opts.factory || '').trim().slice(0, 16);
  const productCode = String(opts.productCode || '').trim().slice(0, 40);
  const team = String(opts.team || '').trim().slice(0, 40);
  const text = [
    `📸 CẦN CHỤP HÌNH — LSX ${lsx} đã READY`,
    `Line nhận: ${line}${factory ? ` · ${factory}` : ''}`,
    productCode ? `Mã TP: ${productCode}` : '',
    team ? `Team soạn: ${team}` : '',
    'Line này yêu cầu chụp hình hàng khi giao — nhớ chụp trước khi giao LSX.'
  ]
    .filter(Boolean)
    .join('\n');

  const sentTo: string[] = [];
  for (const t of targets.values()) {
    if (await sendZaloToChat(t.chatId, text)) sentTo.push(`${t.name} (${t.memberId})`);
  }
  if (sentTo.length) {
    await noticeRef.set({
      lsx,
      line,
      factory,
      team,
      sentTo,
      notifiedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  return { sentTo, skipped: false };
}
