import * as admin from 'firebase-admin';
import { sendZaloToChat } from './zalo-notify.util';

const KHO_GROUP_DOC = 'zalo_group_config/quanly_kho';

type Frequency = 'daily' | 'weekly' | 'monthly';

interface EquipmentDoc {
  equipmentId?: string;
  equipmentName?: string;
  managementCode?: string;
  responsibleEmployeeId?: string | null;
  frequency?: Frequency;
  status?: string;
}

interface InspectionDoc {
  equipmentId?: string;
  inspectionDate?: string;
  result?: string;
}

/** Ngày lễ cố định hằng năm: Tết Dương lịch, 30/4, 1/5, 2/9. */
const FIXED_HOLIDAYS = ['01-01', '04-30', '05-01', '09-02'];

/**
 * Ngày nghỉ thêm theo thông báo nghỉ lễ.
 * 2026: Tết 16–20/2, Giỗ Tổ 25 và 27/4, Quốc khánh thêm 1/9.
 */
const EXTRA_HOLIDAYS = new Set<string>([
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20',
  '2026-04-25', '2026-04-27',
  '2026-09-01'
]);

function todayKey(now = new Date()): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return fmt.format(now);
}

function isSunday(now = new Date()): boolean {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    weekday: 'short'
  }).format(now);
  return weekday === 'Sun';
}

function weekStart(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function isDue(eq: EquipmentDoc, records: InspectionDoc[], day: string): boolean {
  const id = String(eq.equipmentId || eq.managementCode || '');
  const closed = records.filter(r =>
    r.equipmentId === id && (r.result === 'PASS' || r.result === 'FAIL' || r.result === 'NA')
  );
  const frequency = eq.frequency || 'daily';
  if (frequency === 'monthly') return !closed.some(r => String(r.inspectionDate || '').slice(0, 7) === day.slice(0, 7));
  if (frequency === 'weekly') {
    const start = weekStart(day);
    return !closed.some(r => {
      const date = String(r.inspectionDate || '');
      return date >= start && date <= day;
    });
  }
  return !closed.some(r => r.inspectionDate === day);
}

async function isHoliday(db: admin.firestore.Firestore, day: string): Promise<boolean> {
  if (FIXED_HOLIDAYS.includes(day.slice(5)) || EXTRA_HOLIDAYS.has(day)) return true;
  const snap = await db.collection('warehouse-equipment-meta').doc('holidays').get();
  const dates = (snap.data()?.dates as string[] | undefined) || [];
  return dates.includes(day);
}

export async function sendEquipmentChecklistZaloRemind(
  db: admin.firestore.Firestore,
  now = new Date()
): Promise<{ sent: number; due: number; offDay: boolean }> {
  if (isSunday(now) || await isHoliday(db, todayKey(now))) {
    return { sent: 0, due: 0, offDay: true };
  }
  const day = todayKey(now);
  const month = day.slice(0, 7);
  const [eqSnap, recSnap] = await Promise.all([
    db.collection('warehouse-equipment').get(),
    db.collection('warehouse-equipment-inspections')
      .where('inspectionDate', '>=', `${month}-01`)
      .where('inspectionDate', '<=', `${month}-31`)
      .get()
  ]);
  const records = recSnap.docs.map(d => d.data() as InspectionDoc);
  const due = eqSnap.docs
    .map(d => d.data() as EquipmentDoc)
    .filter(eq => eq.status !== 'DISPOSED' && eq.status !== 'INACTIVE' && eq.status !== 'SPARE')
    .filter(eq => isDue(eq, records, day));
  if (!due.length) return { sent: 0, due: 0, offDay: false };

  const groupSnap = await db.doc(KHO_GROUP_DOC).get();
  const chatId = String(groupSnap.data()?.chatId || '').trim();
  if (!chatId) throw new Error('Chưa gắn nhóm Kho trong zalo_group_config/quanly_kho.');

  const lines = due.slice(0, 25).map(eq => `- ${eq.managementCode || eq.equipmentId}: ${eq.equipmentName || ''}`);
  const more = due.length > 25 ? `\n… và ${due.length - 25} thiết bị khác` : '';
  const text = `Nhắc kiểm tra thiết bị kho (${day})\nChưa kiểm tra trước 11:00:\n${lines.join('\n')}${more}\nQuét QR trên tem hoặc tick trên máy tính để ghi kết quả.`;
  const ok = await sendZaloToChat(chatId, text);
  return { sent: ok ? 1 : 0, due: due.length, offDay: false };
}
