import * as admin from 'firebase-admin';
import { sendZaloToChat } from './zalo-notify.util';

/**
 * Nhắc import dữ liệu tồn kho qua Zalo (nhóm Quản lý kho).
 *
 * Lịch: thứ 2 / 4 / 6 phải import bản mới. Sáng hôm sau (thứ 3 / 5 / 7) lúc 9h, 12h, 15h, 17h:
 * nguồn nào chưa có bản import từ 00:00 ngày hôm trước thì nhắn nhóm. Import xong là lần sau tự hết nhắc.
 */
const ZALO_KHO_GROUP_DOC = 'zalo_group_config/quanly_kho';

type Source = {
  label: string;
  tab: string;
  factory: 'ASM1' | 'ASM2';
  doc: string;
  /** Trường thời điểm import trong doc (lấy trường đầu tiên có giá trị) */
  fields: string[];
};

const SOURCES: Source[] = [
  { label: 'Báo cáo tồn kho TP', tab: 'FG Overview', factory: 'ASM1', doc: 'fg-overview-import-cache/current-asm1', fields: ['updatedAt'] },
  { label: 'Báo cáo tồn kho TP', tab: 'FG Overview', factory: 'ASM2', doc: 'fg-overview-import-cache/current-asm2', fields: ['updatedAt'] },
  { label: 'LinkQ', tab: 'Inventory Overview', factory: 'ASM1', doc: 'linkQFiles/ASM1', fields: ['uploadDate', 'importedAt'] },
  { label: 'LinkQ', tab: 'Inventory Overview', factory: 'ASM2', doc: 'linkQFiles/ASM2', fields: ['uploadDate', 'importedAt'] }
];

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

function toDate(v: unknown): Date | null {
  if (!v) return null;
  if (typeof (v as { toDate?: () => Date }).toDate === 'function') return (v as { toDate: () => Date }).toDate();
  const d = v instanceof Date ? v : new Date(v as string);
  return isFinite(d.getTime()) ? d : null;
}

/** 00:00 (giờ VN) của ngày hôm trước so với `now`. */
function startOfYesterdayVn(now: Date): Date {
  const vn = new Date(now.getTime() + VN_OFFSET_MS);
  const midnightVnUtcMs = Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()) - VN_OFFSET_MS;
  return new Date(midnightVnUtcMs - 24 * 60 * 60 * 1000);
}

function fmtVn(d: Date | null): string {
  if (!d) return 'chưa có';
  return d.toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', hour12: false,
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

const WEEKDAY_VN = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

export async function runImportOverdueZalo(
  db: admin.firestore.Firestore,
  now = new Date(),
  opts: { dryRun?: boolean } = {}
): Promise<{ overdue: string[]; sent: boolean; message: string }> {
  const since = startOfYesterdayVn(now);
  const overdue: Array<{ s: Source; last: Date | null }> = [];
  for (const s of SOURCES) {
    const snap = await db.doc(s.doc).get();
    const data = (snap.exists ? snap.data() : null) || {};
    let last: Date | null = null;
    for (const f of s.fields) {
      last = toDate((data as Record<string, unknown>)[f]);
      if (last) break;
    }
    if (!last || last.getTime() < since.getTime()) overdue.push({ s, last });
  }
  if (!overdue.length) return { overdue: [], sent: false, message: '' };

  const dueDay = new Date(since.getTime() + VN_OFFSET_MS);
  const dueLabel = `${WEEKDAY_VN[dueDay.getUTCDay()]} ${String(dueDay.getUTCDate()).padStart(2, '0')}/${String(dueDay.getUTCMonth() + 1).padStart(2, '0')}`;
  const lines = [
    '⚠️ CHƯA IMPORT DỮ LIỆU TỒN KHO',
    `Chưa có bản cập nhật của ${dueLabel} (lịch import: thứ 2, 4, 6):`,
    ...overdue.map(o => `• ${o.s.tab} – ${o.s.label} ${o.s.factory}: lần gần nhất ${fmtVn(o.last)}`),
    '',
    'Vui lòng import bản mới. Bot nhắc lại lúc 9h, 12h, 15h, 17h hôm nay cho tới khi có bản cập nhật.'
  ];
  const message = lines.join('\n');
  if (opts.dryRun) return { overdue: overdue.map(o => `${o.s.tab} ${o.s.factory}`), sent: false, message };

  const groupDoc = await db.doc(ZALO_KHO_GROUP_DOC).get();
  const chatId = String(groupDoc.data()?.chatId || '').trim();
  if (!chatId) {
    console.error('import-overdue-zalo: chưa gắn nhóm Quản lý kho trong', ZALO_KHO_GROUP_DOC);
    return { overdue: overdue.map(o => `${o.s.tab} ${o.s.factory}`), sent: false, message };
  }
  const sent = await sendZaloToChat(chatId, message);
  return { overdue: overdue.map(o => `${o.s.tab} ${o.s.factory}`), sent, message };
}
