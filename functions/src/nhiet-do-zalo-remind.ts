import * as admin from 'firebase-admin';
import { zaloBotToken } from './params-config';

export type NhietDoFactory = 'ASM1' | 'ASM2';
export type NhietDoSlot = 'morning' | 'afternoon';
export type ReminderAction = 1 | 2 | 'escalate';

const FACTORIES: NhietDoFactory[] = ['ASM1', 'ASM2'];
const FORM_TYPES = ['regular', 'special', 'cold'] as const;
const ESCALATION_MEMBER_IDS = ['ASP0119', 'ASP1761', 'ASP0538'];
/** 3 biểu mẫu × 2 ca/ngày */
export const SLOTS_PER_DAY = 6;
/** Số ID nhận nhắc mỗi ngày */
export const DAILY_ASSIGNEE_COUNT = 2;
const SETTINGS_COLLECTION = 'nhiet-do-zalo-settings';
const STATE_COLLECTION = 'nhiet-do-reminder-state';
const CHECKLIST_COLLECTION = 'warehouse-temp-humidity-checklists';

const FORM_LABELS: Record<string, string> = {
  regular: 'Kho Thường',
  special: 'Kho Lưu Trữ Đặc Biệt',
  cold: 'Tủ Lạnh'
};

interface ZaloLinkDoc {
  memberId?: string;
  chatId?: string;
  name?: string;
}

interface FactorySettings {
  memberIds?: string[];
  enabled?: boolean;
}

interface DayReading {
  tempMorning?: number | null;
  tempAfternoon?: number | null;
  humidityMorning?: number | null;
  humidityAfternoon?: number | null;
}

export interface VnDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = CN
}

export function getVnDateTime(now = new Date()): VnDateTime {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false
  }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    weekday: wdMap[get('weekday')] ?? 0
  };
}

export function slotFromHour(hour: number): NhietDoSlot | null {
  if (hour >= 8 && hour <= 10) return 'morning';
  if (hour >= 14 && hour <= 16) return 'afternoon';
  return null;
}

/** 8:55 / 9:25 / 9:55 và 14:55 / 15:25 / 15:55 (VN) */
export function getReminderAction(
  hour: number,
  minute: number,
  slot: NhietDoSlot
): ReminderAction | null {
  const t = hour * 60 + minute;
  if (slot === 'morning') {
    if (t >= 8 * 60 + 53 && t <= 8 * 60 + 59) return 1;
    if (t >= 9 * 60 + 23 && t <= 9 * 60 + 29) return 2;
    if (t >= 9 * 60 + 53 && t <= 9 * 60 + 59) return 'escalate';
  } else {
    if (t >= 14 * 60 + 53 && t <= 14 * 60 + 59) return 1;
    if (t >= 15 * 60 + 23 && t <= 15 * 60 + 29) return 2;
    if (t >= 15 * 60 + 53 && t <= 15 * 60 + 59) return 'escalate';
  }
  return null;
}

function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Chọn ngẫu nhiên (ổn định theo ngày) 2 ID từ danh sách nhà máy */
export function pickDailyAssignees(
  memberIds: string[],
  factory: NhietDoFactory,
  dateKey: string,
  count = DAILY_ASSIGNEE_COUNT
): string[] {
  const ids = [...new Set(memberIds.map(normalizeMemberId).filter(Boolean))];
  if (!ids.length) return [];
  if (ids.length <= count) return ids;
  const rng = seededRandom(`${factory}:${dateKey}`);
  const arr = [...ids];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, count);
}

function normalizeMemberId(raw: string): string {
  const t = String(raw || '').trim().toUpperCase();
  if (!t) return '';
  const id = t.substring(0, 7);
  if (id.length === 7 && id.startsWith('ASP') && /^\d{4}$/.test(id.substring(3))) return id;
  return t;
}

async function resolveChatIds(
  db: admin.firestore.Firestore,
  memberIds: string[]
): Promise<{ memberId: string; chatId: string }[]> {
  const uniq = [...new Set(memberIds.map(normalizeMemberId).filter(Boolean))];
  if (!uniq.length) return [];

  const snap = await db.collection('zalo_links').get();
  const byMember = new Map<string, string>();
  snap.docs.forEach(doc => {
    const d = doc.data() as ZaloLinkDoc;
    const mid = normalizeMemberId(d.memberId || '');
    const chatId = String(d.chatId || doc.id || '').trim();
    if (mid && chatId && !byMember.has(mid)) byMember.set(mid, chatId);
  });

  return uniq
    .filter(mid => byMember.has(mid))
    .map(mid => ({ memberId: mid, chatId: byMember.get(mid)! }));
}

async function sendZaloText(
  token: string,
  chatIds: string[],
  text: string
): Promise<void> {
  const url = `https://bot-api.zaloplatforms.com/bot${encodeURIComponent(token)}/sendMessage`;
  await Promise.all(
    chatIds.map(async chatId => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error('[nhiet-do-zalo] send failed', res.status, body);
      }
    })
  );
}

function isFiniteNum(v: unknown): boolean {
  return v != null && Number.isFinite(Number(v));
}

function isDayReadingComplete(day: DayReading, slot: NhietDoSlot): boolean {
  if (slot === 'morning') {
    return isFiniteNum(day.tempMorning) && isFiniteNum(day.humidityMorning);
  }
  return isFiniteNum(day.tempAfternoon) && isFiniteNum(day.humidityAfternoon);
}

export async function isFactorySlotComplete(
  db: admin.firestore.Firestore,
  factory: NhietDoFactory,
  vn: VnDateTime,
  slot: NhietDoSlot
): Promise<{ complete: boolean; missing: string[] }> {
  const monthPad = String(vn.month).padStart(2, '0');
  const dayIdx = vn.day - 1;
  const daysInMonth = new Date(vn.year, vn.month, 0).getDate();
  if (vn.day < 1 || vn.day > daysInMonth) {
    return { complete: true, missing: [] };
  }

  const missing: string[] = [];
  for (const formType of FORM_TYPES) {
    const docId = `${factory}-${formType}-${vn.year}-${monthPad}`;
    const snap = await db.collection(CHECKLIST_COLLECTION).doc(docId).get();
    const days = (snap.data()?.days as DayReading[] | undefined) || [];
    const row = days[dayIdx] || {};
    if (!isDayReadingComplete(row, slot)) {
      missing.push(FORM_LABELS[formType] || formType);
    }
  }
  return { complete: missing.length === 0, missing };
}

function stateDocId(factory: string, dateKey: string, slot: string): string {
  return `${factory}_${dateKey}_${slot}`;
}

function buildMessage(
  factory: NhietDoFactory,
  slot: NhietDoSlot,
  action: ReminderAction,
  missing: string[],
  vn: VnDateTime,
  assigneeIds?: string[]
): string {
  const slotVi = slot === 'morning' ? 'Sáng (9:00)' : 'Chiều (15:00)';
  const slotEn = slot === 'morning' ? 'Morning' : 'Afternoon';
  const dateStr = `${String(vn.day).padStart(2, '0')}/${String(vn.month).padStart(2, '0')}/${vn.year}`;
  const missLines = missing.map(m => `  • ${m}`).join('\n');

  const dutyLine = assigneeIds?.length
    ? `Phụ trách ghi hôm nay (${assigneeIds.length} ID, ${SLOTS_PER_DAY} lần/ngày): ${assigneeIds.join(', ')}\n`
    : '';

  if (action === 'escalate') {
    return (
      `🚨 [Nhiệt độ & Độ ẩm — ${factory}] Chưa cập nhật sau 2 lần nhắc\n` +
      `Ca: ${slotVi} · Ngày ${dateStr}\n` +
      dutyLine +
      `Thiếu biểu mẫu:\n${missLines}\n` +
      `Vui lòng xử lý gấp. / Urgent update required.`
    );
  }

  const remindNo = action === 1 ? '1' : '2';
  return (
    `🌡️ [Nhiệt độ & Độ ẩm — ${factory}] Nhắc cập nhật (lần ${remindNo})\n` +
    `Ca: ${slotVi} (${slotEn}) · Ngày ${dateStr}\n` +
    dutyLine +
    `(3 biểu mẫu × 2 ca = ${SLOTS_PER_DAY} lần ghi/ngày · chỉ nhắc ${DAILY_ASSIGNEE_COUNT} ID/ngày)\n` +
    `Vui lòng nhập số liệu các biểu mẫu:\n${missLines}\n` +
    `Tab: Nhiệt Độ → ${factory}`
  );
}

async function loadFactorySettings(
  db: admin.firestore.Firestore,
  factory: NhietDoFactory
): Promise<FactorySettings> {
  const snap = await db.collection(SETTINGS_COLLECTION).doc(factory).get();
  return (snap.data() as FactorySettings) || { memberIds: [], enabled: true };
}

export async function runNhietDoZaloRemind(db: admin.firestore.Firestore): Promise<void> {
  const token = zaloBotToken.value().trim();
  if (!token) {
    console.error('[nhiet-do-zalo] missing ZALO_BOT_TOKEN');
    return;
  }

  const vn = getVnDateTime();
  if (vn.weekday === 0) {
    console.log('[nhiet-do-zalo] Sunday — skip');
    return;
  }

  const slot = slotFromHour(vn.hour);
  if (!slot) return;

  const action = getReminderAction(vn.hour, vn.minute, slot);
  if (!action) return;

  const dateKey = `${vn.year}-${String(vn.month).padStart(2, '0')}-${String(vn.day).padStart(2, '0')}`;

  for (const factory of FACTORIES) {
    try {
      const settings = await loadFactorySettings(db, factory);
      if (settings.enabled === false) continue;

      const { complete, missing } = await isFactorySlotComplete(db, factory, vn, slot);
      const stateRef = db.collection(STATE_COLLECTION).doc(stateDocId(factory, dateKey, slot));
      const stateSnap = await stateRef.get();
      const stage = Number(stateSnap.data()?.stage ?? 0);

      if (complete) {
        if (!stateSnap.data()?.completed) {
          await stateRef.set(
            { factory, dateKey, slot, completed: true, stage, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
        }
        continue;
      }

      const expectedStage = action === 1 ? 0 : action === 2 ? 1 : 2;
      if (stage !== expectedStage) continue;

      const pool = (settings.memberIds || []).map(normalizeMemberId).filter(Boolean);
      const dailyAssignees = pickDailyAssignees(pool, factory, dateKey);

      const memberIds =
        action === 'escalate'
          ? [...new Set([...dailyAssignees, ...ESCALATION_MEMBER_IDS])]
          : dailyAssignees;

      const links = await resolveChatIds(db, memberIds);
      if (!links.length) {
        console.warn(`[nhiet-do-zalo] ${factory} ${slot} no chatId for`, memberIds);
        continue;
      }

      const msg = buildMessage(factory, slot, action, missing, vn, dailyAssignees);
      await sendZaloText(
        token,
        links.map(l => l.chatId),
        msg
      );

      const newStage = action === 'escalate' ? 3 : action === 2 ? 2 : 1;
      await stateRef.set(
        {
          factory,
          dateKey,
          slot,
          stage: newStage,
          lastAction: String(action),
          completed: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      console.log(`[nhiet-do-zalo] sent ${factory} ${slot} action=${action} stage→${newStage}`);
    } catch (e) {
      console.error(`[nhiet-do-zalo] ${factory} error`, e);
    }
  }
}

export interface NhietDoZaloTestSendResult {
  ok: true;
  sent: number;
  memberIds: string[];
  slot: NhietDoSlot;
  preview: string;
}

/** Gửi thử tin Zalo tới 2 ID phụ trách hôm nay (nút「Gửi ngay」trên UI). */
export async function sendNhietDoZaloRemindTest(
  db: admin.firestore.Firestore,
  factory: NhietDoFactory,
  options?: { slot?: NhietDoSlot; memberIds?: string[] }
): Promise<NhietDoZaloTestSendResult> {
  const token = zaloBotToken.value().trim();
  if (!token) {
    throw new Error('Thiếu ZALO_BOT_TOKEN trên Cloud Functions.');
  }

  const vn = getVnDateTime();
  const slot: NhietDoSlot =
    options?.slot === 'afternoon' || options?.slot === 'morning'
      ? options.slot
      : slotFromHour(vn.hour) ?? 'morning';

  const dateKey = `${vn.year}-${String(vn.month).padStart(2, '0')}-${String(vn.day).padStart(2, '0')}`;

  let pool: string[];
  if (options?.memberIds?.length) {
    pool = options.memberIds.map(normalizeMemberId).filter(Boolean);
  } else {
    const settings = await loadFactorySettings(db, factory);
    pool = (settings.memberIds || []).map(normalizeMemberId).filter(Boolean);
  }

  if (!pool.length) {
    throw new Error('Chưa chọn ID trong danh sách nhắc. Chọn ít nhất 1 ID rồi thử lại.');
  }

  const dailyAssignees = pickDailyAssignees(pool, factory, dateKey);
  if (!dailyAssignees.length) {
    throw new Error('Không xác định được ID phụ trách hôm nay.');
  }

  const { complete, missing } = await isFactorySlotComplete(db, factory, vn, slot);
  const slotVi = slot === 'morning' ? 'Sáng (9:00)' : 'Chiều (15:00)';
  const dateStr = `${String(vn.day).padStart(2, '0')}/${String(vn.month).padStart(2, '0')}/${vn.year}`;
  const missLines = missing.length ? missing.map(m => `  • ${m}`).join('\n') : '  • (đã nhập đủ 3 biểu mẫu)';

  const preview =
    `🧪 [TEST — Nhiệt độ & Độ ẩm — ${factory}]\n` +
    `Tin nhắn thử — không tính lần nhắc tự động.\n` +
    `Ca: ${slotVi} · Ngày ${dateStr}\n` +
    `Phụ trách ghi hôm nay (${dailyAssignees.length} ID, ${SLOTS_PER_DAY} lần/ngày): ${dailyAssignees.join(', ')}\n` +
    `(3 biểu mẫu × 2 ca = ${SLOTS_PER_DAY} lần ghi/ngày)\n` +
    `Trạng thái nhập liệu ca này: ${complete ? 'Đủ' : 'Thiếu'}\n` +
    `${complete ? '' : 'Thiếu biểu mẫu:\n' + missLines + '\n'}` +
    `Tab: Nhiệt Độ → ${factory}`;

  const links = await resolveChatIds(db, dailyAssignees);
  if (!links.length) {
    throw new Error(
      `Không tìm thấy chatId zalo_links cho: ${dailyAssignees.join(', ')}`
    );
  }

  await sendZaloText(
    token,
    links.map(l => l.chatId),
    preview
  );

  console.log(`[nhiet-do-zalo] TEST sent ${factory} ${slot} → ${dailyAssignees.join(', ')}`);

  return {
    ok: true,
    sent: links.length,
    memberIds: dailyAssignees,
    slot,
    preview
  };
}
