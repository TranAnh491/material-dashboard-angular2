import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';

/**
 * Đếm số lượt đọc Firestore theo từng tab, để biết tab nào đang tốn nhiều mà không cần
 * bật Cloud Audit Logs. KHÔNG ghi 1 lượt/lần đọc (sẽ tốn thêm rất nhiều write) — gộp trong
 * bộ nhớ, xả (flush) định kỳ mỗi 60s + khi rời trang, mỗi lần flush chỉ 1 write duy nhất
 * dùng increment() để cộng dồn an toàn dù nhiều tab/nhiều máy cùng ghi.
 *
 * Cách dùng trong component: gọi readTracker.track('shipment', 'shipments', snapshot.docs.length)
 * ngay sau khi 1 lần đọc Firestore hoàn tất (trong callback .subscribe() hoặc sau .get()).
 *
 * Xem dữ liệu: Firestore Console → collection `read-tracker` → document theo ngày (YYYY-MM-DD).
 */
@Injectable({
  providedIn: 'root'
})
export class ReadTrackerService {
  private static readonly COLLECTION = 'read-tracker';
  private static readonly FLUSH_INTERVAL_MS = 60_000;

  /** tab -> collection -> số lượt đọc cộng dồn từ lần flush trước */
  private pending = new Map<string, Map<string, number>>();
  private flushTimer?: ReturnType<typeof setInterval>;
  private flushBound = () => void this.flush();

  constructor(private firestore: AngularFirestore) {
    this.flushTimer = setInterval(this.flushBound, ReadTrackerService.FLUSH_INTERVAL_MS);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          void this.flush();
        }
      });
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.flushBound);
    }
  }

  /** Gọi ngay sau mỗi lần đọc Firestore hoàn tất (get()/valueChanges()/snapshotChanges() emit). */
  track(tab: string, collectionName: string, docCount: number): void {
    if (!tab || !collectionName || !Number.isFinite(docCount) || docCount <= 0) {
      return;
    }
    let byCollection = this.pending.get(tab);
    if (!byCollection) {
      byCollection = new Map<string, number>();
      this.pending.set(tab, byCollection);
    }
    byCollection.set(collectionName, (byCollection.get(collectionName) || 0) + docCount);
  }

  private todayKey(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private async flush(): Promise<void> {
    if (this.pending.size === 0) return;

    // Lấy snapshot hiện tại rồi xóa ngay để tránh đếm trùng nếu flush tiếp theo chạy trước khi write xong.
    const snapshot = this.pending;
    this.pending = new Map();

    const byTab: Record<string, Record<string, firebase.firestore.FieldValue | number>> = {};
    for (const [tab, byCollection] of snapshot.entries()) {
      const tabPayload: Record<string, firebase.firestore.FieldValue | number> = {};
      let tabTotal = 0;
      for (const [collectionName, count] of byCollection.entries()) {
        tabPayload[collectionName] = firebase.firestore.FieldValue.increment(count);
        tabTotal += count;
      }
      tabPayload['total'] = firebase.firestore.FieldValue.increment(tabTotal);
      byTab[tab] = tabPayload;
    }

    try {
      await this.firestore
        .doc(`${ReadTrackerService.COLLECTION}/${this.todayKey()}`)
        .set(
          {
            byTab,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
    } catch (e) {
      console.warn('ReadTrackerService: flush failed (không ảnh hưởng chức năng chính)', e);
    }
  }
}
