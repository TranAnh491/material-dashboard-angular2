import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import { ReadTrackerService } from './read-tracker.service';

export type FgBackupCollectionKey = 'fg-inventory' | 'fg-in' | 'fg-out' | 'fg-check';

export interface FgBackupLoadResult {
  docs: Array<{ id: string; data: Record<string, unknown> }>;
  backupCount: number;
  deltaCount: number;
  usedFallback: boolean;
}

interface FgBackupConfig {
  sourceCollection: string;
  dateField: string;
  fallbackDateField?: string;
}

const FG_BACKUP_ROOT = 'fg-daily-backups';
const FG_DELETED_ROOT = 'fg-deleted-docs';
const CHUNK_SIZE = 250;

const FG_BACKUP_CONFIG: Record<FgBackupCollectionKey, FgBackupConfig> = {
  'fg-inventory': { sourceCollection: 'fg-inventory', dateField: 'updatedAt', fallbackDateField: 'importDate' },
  'fg-in': { sourceCollection: 'fg-in', dateField: 'updatedAt', fallbackDateField: 'importDate' },
  'fg-out': { sourceCollection: 'fg-out', dateField: 'updatedAt', fallbackDateField: 'exportDate' },
  'fg-check': { sourceCollection: 'fg-check', dateField: 'updatedAt', fallbackDateField: 'createdAt' }
};

@Injectable({ providedIn: 'root' })
export class FgDailyBackupService {
  constructor(
    private firestore: AngularFirestore,
    private readTracker: ReadTrackerService
  ) {}

  /** Đọc snapshot hôm qua + delta hôm nay (giảm reads so với full collection). */
  async loadMergedDocs(
    collectionKey: FgBackupCollectionKey,
    trackTab: string
  ): Promise<FgBackupLoadResult> {
    const cfg = FG_BACKUP_CONFIG[collectionKey];
    const yesterdayYmd = this.shiftYmd(this.todayYmd(), -1);
    const yesterdayDayKey = this.toDayKey(yesterdayYmd);
    const todayStart = this.startOfDayTimestamp(this.todayYmd());

    const backupItems = await this.loadBackupItems(collectionKey, yesterdayDayKey);
    let backupCount = backupItems.length;

    if (backupCount === 0) {
      const fallback = await this.loadLiveSince(cfg, todayStart, this.startOfDayTimestamp(yesterdayYmd), trackTab, collectionKey);
      return { docs: fallback, backupCount: 0, deltaCount: fallback.length, usedFallback: true };
    }

    const deltaSnap = await this.querySince(cfg, todayStart);
    const deltaCount = deltaSnap.docs.length;
    this.readTracker.track(trackTab, cfg.sourceCollection, backupCount + deltaCount);

    const merged = new Map<string, { id: string; data: Record<string, unknown> }>();
    for (const item of backupItems) {
      merged.set(item.id, item);
    }
    for (const doc of deltaSnap.docs) {
      merged.set(doc.id, { id: doc.id, data: doc.data() as Record<string, unknown> });
    }

    // Doc nằm trong backup hôm qua nhưng đã bị xóa hôm nay sẽ không có trong delta
    // (vì không còn tồn tại để query) → phải loại thủ công theo "tombstone", nếu không
    // nó sẽ tái xuất hiện mỗi lần load cho tới khi backup ngày mai được tạo lại.
    const deletedIds = await this.loadDeletedIds(collectionKey, this.startOfDayTimestamp(yesterdayYmd));
    for (const id of deletedIds) merged.delete(id);

    return {
      docs: Array.from(merged.values()),
      backupCount,
      deltaCount,
      usedFallback: false
    };
  }

  /**
   * Ghi "tombstone" khi xóa 1 doc — để loadMergedDocs loại nó ra dù backup hôm qua
   * (chụp trước khi xóa) vẫn còn chứa doc này. Gọi ngay sau khi delete() Firestore thành công.
   * Truyền kèm `data` (nội dung dòng vừa xóa) để hỗ trợ danh sách "Đã xóa gần đây" + khôi phục
   * (xem listRecentlyDeleted / restoreDeleted) — không bắt buộc, không có vẫn hoạt động bình thường.
   */
  async markDeleted(collectionKey: FgBackupCollectionKey, docId: string, data?: Record<string, unknown>): Promise<void> {
    if (!docId) return;
    try {
      const payload: Record<string, unknown> = {
        collectionKey,
        docId,
        deletedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (data) {
        payload.data = data;
        payload.materialCode = (data['materialCode'] as string) || null;
      }
      await this.firestore.collection(FG_DELETED_ROOT).doc(`${collectionKey}_${docId}`).set(payload, { merge: true });
    } catch (e) {
      console.error('[FgDailyBackup] markDeleted failed', collectionKey, docId, e);
    }
  }

  /** Danh sách các dòng đã xóa trong N ngày gần nhất (mặc định 7) — dùng cho popup "Đã xóa gần đây". */
  async listRecentlyDeleted(
    collectionKey: FgBackupCollectionKey,
    days = 7
  ): Promise<Array<{ docId: string; deletedAt: Date | null; data: Record<string, unknown> | null }>> {
    const since = firebase.firestore.Timestamp.fromDate(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
    try {
      const snap = await this.firestore
        .collection(FG_DELETED_ROOT, (ref) => ref.where('collectionKey', '==', collectionKey).where('deletedAt', '>=', since))
        .get()
        .toPromise();
      const rows = (snap?.docs || []).map((d) => {
        const raw = d.data() as { docId?: string; deletedAt?: { toDate?: () => Date }; data?: Record<string, unknown> };
        return {
          docId: raw.docId || d.id,
          deletedAt: typeof raw.deletedAt?.toDate === 'function' ? raw.deletedAt.toDate() : null,
          data: raw.data || null
        };
      });
      // Sort client-side (mới nhất trước) để không cần thêm composite index riêng cho orderBy.
      rows.sort((a, b) => (b.deletedAt?.getTime() || 0) - (a.deletedAt?.getTime() || 0));
      return rows;
    } catch (e) {
      console.error('[FgDailyBackup] listRecentlyDeleted failed', collectionKey, e);
      return [];
    }
  }

  /** Khôi phục 1 dòng đã xóa: ghi lại data (đã lưu kèm tombstone) vào collection gốc + xoá tombstone. */
  async restoreDeleted(collectionKey: FgBackupCollectionKey, docId: string, data: Record<string, unknown>): Promise<void> {
    const cfg = FG_BACKUP_CONFIG[collectionKey];
    await this.firestore.collection(cfg.sourceCollection).doc(docId).set(data);
    await this.firestore.collection(FG_DELETED_ROOT).doc(`${collectionKey}_${docId}`).delete();
  }

  /** Chỉ cần tombstone từ mốc backup hôm qua trở đi — cũ hơn thì backup kế tiếp đã tự loại bỏ rồi. */
  private async loadDeletedIds(
    collectionKey: FgBackupCollectionKey,
    since: firebase.firestore.Timestamp
  ): Promise<Set<string>> {
    try {
      const snap = await this.firestore
        .collection(FG_DELETED_ROOT, (ref) =>
          ref.where('collectionKey', '==', collectionKey).where('deletedAt', '>=', since)
        )
        .get()
        .toPromise();
      return new Set((snap?.docs || []).map((d) => (d.data() as { docId?: string }).docId).filter((id): id is string => !!id));
    } catch (e) {
      console.warn('[FgDailyBackup] loadDeletedIds failed', collectionKey, e);
      return new Set();
    }
  }

  private async loadBackupItems(
    collectionKey: FgBackupCollectionKey,
    dayKey: number
  ): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
    const dayRef = this.firestore
      .collection(FG_BACKUP_ROOT)
      .doc(collectionKey)
      .collection('days')
      .doc(String(dayKey));

    const metaSnap = await dayRef.get().toPromise();
    if (!metaSnap?.exists) return [];

    const chunksSnap = await dayRef
      .collection('chunks', (ref) => ref.orderBy('index', 'asc'))
      .get()
      .toPromise();
    const items: Array<{ id: string; data: Record<string, unknown> }> = [];
    for (const chunkDoc of chunksSnap?.docs || []) {
      const chunk = chunkDoc.data() as { items?: Array<{ id: string; data: Record<string, unknown> }> };
      for (const row of chunk.items || []) {
        if (row?.id) items.push({ id: row.id, data: row.data || {} });
      }
    }
    return items;
  }

  private async loadLiveSince(
    cfg: FgBackupConfig,
    todayStart: firebase.firestore.Timestamp,
    yesterdayStart: firebase.firestore.Timestamp,
    trackTab: string,
    collectionKey: FgBackupCollectionKey
  ): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
    try {
      const snap = await this.querySince(cfg, yesterdayStart);
      this.readTracker.track(trackTab, cfg.sourceCollection, snap.docs.length);
      return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> }));
    } catch (e) {
      console.warn(`[FgDailyBackup] fallback ${collectionKey} since yesterday failed, try today only`, e);
      try {
        const snap = await this.querySince(cfg, todayStart);
        this.readTracker.track(trackTab, cfg.sourceCollection, snap.docs.length);
        return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> }));
      } catch (e2) {
        console.error(`[FgDailyBackup] fallback ${collectionKey} failed`, e2);
        return [];
      }
    }
  }

  private querySince(cfg: FgBackupConfig, since: firebase.firestore.Timestamp) {
    return this.firestore
      .collection(cfg.sourceCollection, (ref) => ref.where(cfg.dateField, '>=', since).limit(5000))
      .get()
      .toPromise()
      .then((snap) => snap || { docs: [] as firebase.firestore.QueryDocumentSnapshot[] });
  }

  private todayYmd(): string {
    return this.formatYmdInTz(new Date());
  }

  private shiftYmd(ymd: string, days: number): string {
    const [y, m, d] = ymd.split('-').map((x) => Number(x));
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return this.formatYmdInTz(dt);
  }

  private formatYmdInTz(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value || '1970';
    const m = parts.find((p) => p.type === 'month')?.value || '01';
    const d = parts.find((p) => p.type === 'day')?.value || '01';
    return `${y}-${m}-${d}`;
  }

  private toDayKey(ymd: string): number {
    return Number(ymd.replace(/-/g, '')) || 0;
  }

  private startOfDayTimestamp(ymd: string): firebase.firestore.Timestamp {
    const [y, m, d] = ymd.split('-').map((x) => Number(x));
    const utcMs = Date.UTC(y, m - 1, d) - 7 * 60 * 60 * 1000;
    return firebase.firestore.Timestamp.fromDate(new Date(utcMs));
  }
}
