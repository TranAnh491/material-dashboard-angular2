import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';

export type NhietDoZaloFactory = 'ASM1' | 'ASM2';

export interface ZaloLinkRow {
  docId: string;
  memberId: string;
  name: string;
  chatId: string;
  /** ASM1 | ASM2 | ALL — lọc danh sách theo nhà máy */
  factory: string;
}

export interface NhietDoZaloFactorySettings {
  factory: NhietDoZaloFactory;
  memberIds: string[];
  enabled: boolean;
  updatedAt?: Date;
}

/** Mỗi nhà máy: 3 biểu mẫu × 2 ca/ngày */
export const NHET_DO_ZALO_SLOTS_PER_DAY = 6;
/** Số ID nhận nhắc mỗi ngày (chia ngẫu nhiên từ danh sách) */
export const NHET_DO_ZALO_DAILY_ASSIGNEE_COUNT = 2;

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

/** Ngày theo giờ VN — yyyy-MM-dd */
export function nhietDoVnDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Chọn ngẫu nhiên (ổn định theo ngày) `count` ID từ danh sách */
export function pickDailyZaloAssignees(
  memberIds: string[],
  factory: NhietDoZaloFactory,
  dateKey: string,
  count = NHET_DO_ZALO_DAILY_ASSIGNEE_COUNT
): string[] {
  const ids = [...new Set(memberIds.map(m => m.trim().toUpperCase()).filter(Boolean))];
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

@Injectable({ providedIn: 'root' })
export class NhietDoZaloSettingsService {
  private readonly settingsCollection = 'nhiet-do-zalo-settings';

  constructor(private firestore: AngularFirestore) {}

  normalizeMemberId(raw: string): string {
    const t = String(raw || '').trim();
    if (!t) return '';
    const id = t.substring(0, 7).toUpperCase();
    if (id.length === 7 && id.startsWith('ASP') && /^\d{4}$/.test(id.substring(3))) {
      return id;
    }
    return t.toUpperCase();
  }

  async loadZaloLinks(): Promise<ZaloLinkRow[]> {
    const snap = await this.firestore.collection('zalo_links').get().toPromise();
    const rows: ZaloLinkRow[] = [];
    (snap?.docs || []).forEach(doc => {
      const d = doc.data() as { memberId?: string; name?: string; chatId?: string; factory?: string };
      const memberId = this.normalizeMemberId(d.memberId || '');
      if (!memberId) return;
      const factory = String(d.factory ?? 'ALL').trim().toUpperCase() || 'ALL';
      rows.push({
        docId: doc.id,
        memberId,
        name: String(d.name || '').trim() || memberId,
        chatId: String(d.chatId || doc.id).trim(),
        factory
      });
    });
    rows.sort((a, b) => a.memberId.localeCompare(b.memberId));
    return rows;
  }

  async loadFactorySettings(factory: NhietDoZaloFactory): Promise<NhietDoZaloFactorySettings> {
    const snap = await this.firestore.collection(this.settingsCollection).doc(factory).get().toPromise();
    const d = snap?.data() as { memberIds?: string[]; enabled?: boolean; updatedAt?: unknown } | undefined;
    const memberIds = Array.isArray(d?.memberIds)
      ? [...new Set(d!.memberIds.map(m => this.normalizeMemberId(m)).filter(Boolean))]
      : [];
    return {
      factory,
      memberIds,
      enabled: d?.enabled !== false
    };
  }

  async saveFactorySettings(
    factory: NhietDoZaloFactory,
    memberIds: string[],
    enabled: boolean
  ): Promise<void> {
    const ids = [...new Set(memberIds.map(m => this.normalizeMemberId(m)).filter(Boolean))];
    await this.firestore.collection(this.settingsCollection).doc(factory).set(
      {
        factory,
        memberIds: ids,
        enabled,
        updatedAt: new Date()
      },
      { merge: true }
    );
  }
}
