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

    return {
      docs: Array.from(merged.values()),
      backupCount,
      deltaCount,
      usedFallback: false
    };
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
