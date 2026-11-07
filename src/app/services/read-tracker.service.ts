import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

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
  /** Đếm tự động (mọi lượt đọc của trình duyệt): route -> collection -> số lượt đọc. */
  private autoPending = new Map<string, Map<string, number>>();
  private autoInstalled = false;

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

  /**
   * Đếm TỰ ĐỘNG mọi lượt đọc Firestore của trình duyệt (get + listener realtime) theo trang đang mở,
   * bằng cách bọc Query/DocumentReference của SDK compat. Không cần gắn track() từng chỗ.
   * Ghi vào field byRoute của cùng document ngày; không tính snapshot từ cache (không bị tính tiền).
   */
  installAutoTracking(): void {
    if (this.autoInstalled) return;
    this.autoInstalled = true;
    const fs: any = (firebase as any).firestore;
    const qProto = fs?.Query?.prototype;
    const dProto = fs?.DocumentReference?.prototype;
    if (!qProto || !dProto) return;
    const self = this;
    const guardError = () => {
      const e: any = new Error('READ_GUARD: tạm dừng đọc dữ liệu do phát hiện đọc bất thường — tải lại trang.');
      e.code = 'read-guard';
      return e;
    };
    /** Bọc callback listener: đếm lượt đọc; khi đã phanh thì không chuyển tiếp dữ liệu nữa. */
    const wrapListenerArgs = (args: any[], onSnap: (snap: any, first: boolean) => void): { args: any[]; onError: (e: any) => void } => {
      let first = true;
      let onError: (e: any) => void = () => {};
      const wrap = (fn: (snap: any) => any) => (snap: any) => {
        if (self.guardTripped) return undefined;
        try {
          if (!snap?.metadata?.fromCache) {
            onSnap(snap, first);
            first = false;
          }
        } catch { /* bỏ qua lỗi đếm */ }
        if (self.guardTripped) return undefined;
        return fn(snap);
      };
      const a = args.slice();
      for (let i = 0; i < a.length; i++) {
        if (typeof a[i] === 'function') {
          a[i] = wrap(a[i]);
          if (typeof a[i + 1] === 'function') onError = a[i + 1];
          break;
        }
        const o = a[i];
        if (o && typeof o === 'object' && typeof o.next === 'function') {
          if (typeof o.error === 'function') onError = o.error.bind(o);
          a[i] = {
            next: wrap(o.next.bind(o)),
            error: typeof o.error === 'function' ? o.error.bind(o) : undefined,
            complete: typeof o.complete === 'function' ? o.complete.bind(o) : undefined
          };
          break;
        }
      }
      return { args: a, onError };
    };
    /** Đăng ký listener (đã phanh thì báo lỗi ngay, không mở listener). Lưu hàm hủy để phanh có thể đóng hết. */
    const listen = (target: any, orig: any, args: any[], onSnap: (snap: any, first: boolean) => void) => {
      const { args: wrapped, onError } = wrapListenerArgs(args, onSnap);
      if (self.guardTripped) {
        setTimeout(() => { try { onError(guardError()); } catch { /* */ } }, 0);
        return () => {};
      }
      const unsub = orig.apply(target, wrapped);
      self.liveUnsubs.add(unsub);
      return () => {
        self.liveUnsubs.delete(unsub);
        return unsub();
      };
    };

    const origQGet = qProto.get;
    qProto.get = function (...args: any[]) {
      if (self.guardTripped) return Promise.reject(guardError());
      return origQGet.apply(this, args).then((snap: any) => {
        try { if (!snap?.metadata?.fromCache) self.autoCountQuery(this, snap, true, true); } catch { /* */ }
        return snap;
      });
    };
    const origQSnap = qProto.onSnapshot;
    qProto.onSnapshot = function (...args: any[]) {
      const q = this;
      return listen(this, origQSnap, args, (snap, first) => self.autoCountQuery(q, snap, first, first));
    };
    const origDGet = dProto.get;
    dProto.get = function (...args: any[]) {
      if (self.guardTripped) return Promise.reject(guardError());
      return origDGet.apply(this, args).then((snap: any) => {
        try { if (!snap?.metadata?.fromCache) self.autoAdd(this?.parent?.id || '?', 1, 'doc:' + (this?.path || '?')); } catch { /* */ }
        return snap;
      });
    };
    const origDSnap = dProto.onSnapshot;
    dProto.onSnapshot = function (...args: any[]) {
      const ref = this;
      return listen(this, origDSnap, args, (snap, first) => {
        if (!snap?.metadata?.hasPendingWrites) self.autoAdd(ref?.parent?.id || '?', 1, first ? 'doc:' + (ref?.path || '?') : '');
      });
    };

    // Ngưỡng chỉnh được: read-guard-config/main (đọc 1 lần, lỗi thì giữ mặc định)
    setTimeout(() => {
      this.firestore.firestore.doc(ReadTrackerService.GUARD_CONFIG_DOC).get().then((snap) => {
        const d = (snap.data() || {}) as any;
        const num = (v: any, def: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : def);
        this.guardCfg = {
          enabled: d.enabled !== false,
          maxReadsPerMinute: num(d.maxReadsPerMinute, this.guardCfg.maxReadsPerMinute),
          maxSameQueryPerMinute: num(d.maxSameQueryPerMinute, this.guardCfg.maxSameQueryPerMinute),
          minSameQueryReads: num(d.minSameQueryReads, this.guardCfg.minSameQueryReads)
        };
      }).catch(() => { /* chưa đăng nhập / chưa có config → dùng mặc định */ });
    }, 5000);
  }

  // ===== Phanh đọc bất thường (read guard) =====
  private static readonly GUARD_CONFIG_DOC = 'read-guard-config/main';
  private static readonly GUARD_INCIDENTS = 'read-guard-incidents';
  private guardCfg = { enabled: true, maxReadsPerMinute: 200000, maxSameQueryPerMinute: 30, minSameQueryReads: 2000 };
  /** Lượt đọc trong 60 giây gần nhất: [thời điểm, số lượt, collection, khóa truy vấn]. */
  private guardWindow: Array<{ t: number; n: number; col: string; key: string }> = [];
  private guardTripped = false;
  private liveUnsubs = new Set<() => void>();

  private guardRecord(col: string, n: number, key: string): void {
    if (this.guardTripped || !this.guardCfg.enabled) return;
    const now = Date.now();
    this.guardWindow.push({ t: now, n, col, key });
    const cut = now - 60000;
    let i = 0;
    while (i < this.guardWindow.length && this.guardWindow[i].t < cut) i++;
    if (i) this.guardWindow.splice(0, i);

    const total = this.guardWindow.reduce((s, e) => s + e.n, 0);
    if (total > this.guardCfg.maxReadsPerMinute) {
      this.tripGuard('rate', `${total.toLocaleString('en-US')} lượt đọc trong 60 giây (ngưỡng ${this.guardCfg.maxReadsPerMinute.toLocaleString('en-US')})`, '');
      return;
    }
    if (key) {
      let count = 0;
      let reads = 0;
      for (const e of this.guardWindow) {
        if (e.key !== key) continue;
        count++;
        reads += e.n;
      }
      if (count > this.guardCfg.maxSameQueryPerMinute && reads >= this.guardCfg.minSameQueryReads) {
        this.tripGuard('repeat', `Cùng 1 truy vấn chạy lại ${count} lần trong 60 giây (${reads.toLocaleString('en-US')} lượt đọc)`, key);
      }
    }
  }

  private tripGuard(reason: 'rate' | 'repeat', detail: string, key: string): void {
    if (this.guardTripped) return;
    this.guardTripped = true;
    // Đóng mọi listener đang mở để vòng lặp dừng hẳn
    this.liveUnsubs.forEach((u) => { try { u(); } catch { /* */ } });
    this.liveUnsubs.clear();

    const byCol = new Map<string, number>();
    this.guardWindow.forEach((e) => byCol.set(e.col, (byCol.get(e.col) || 0) + e.n));
    const top = Array.from(byCol.entries()).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([c, n]) => ({ collection: c, reads: n }));
    const total = this.guardWindow.reduce((s, e) => s + e.n, 0);
    const user = (firebase as any).auth?.()?.currentUser;
    void this.firestore.collection(ReadTrackerService.GUARD_INCIDENTS).add({
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      clientAt: new Date(),
      reason,
      detail,
      route: this.currentRoute(),
      url: typeof location !== 'undefined' ? location.href.slice(0, 300) : '',
      readsLastMinute: total,
      topCollections: top,
      queryKey: key.slice(0, 300),
      userEmail: user?.email || '',
      userUid: user?.uid || '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 200) : ''
    }).catch((e) => console.warn('ReadGuard: ghi sự cố lỗi', e));
    void this.flush();
    console.error('[ReadGuard] ĐÃ PHANH:', detail, top);
    this.showGuardBanner(detail);
  }

  private showGuardBanner(detail: string): void {
    if (typeof document === 'undefined' || document.getElementById('read-guard-banner')) return;
    const el = document.createElement('div');
    el.id = 'read-guard-banner';
    el.setAttribute('style', [
      'position:fixed', 'left:0', 'right:0', 'top:0', 'z-index:2147483647',
      'background:#b91c1c', 'color:#fff', 'padding:12px 16px', 'font:600 14px/1.4 Segoe UI,Arial,sans-serif',
      'display:flex', 'gap:12px', 'align-items:center', 'box-shadow:0 4px 12px rgba(0,0,0,.3)'
    ].join(';'));
    const text = document.createElement('span');
    text.style.flex = '1';
    text.textContent = `⚠ Phát hiện đọc dữ liệu bất thường — đã tạm dừng để tránh tốn chi phí. ${detail}. Đã báo quản lý. Bấm "Tải lại trang" để tiếp tục.`;
    const btn = document.createElement('button');
    btn.textContent = 'Tải lại trang';
    btn.setAttribute('style', 'background:#fff;color:#b91c1c;border:0;border-radius:6px;padding:8px 14px;font-weight:700;cursor:pointer');
    btn.onclick = () => location.reload();
    el.appendChild(text);
    el.appendChild(btn);
    document.body.appendChild(el);
  }

  private autoCountQuery(query: any, snap: any, first: boolean, isExecution = false): void {
    let n: number;
    if (first) {
      n = Math.max(1, Number(snap?.size) || 0); // query rỗng vẫn tính 1 lượt đọc
    } else {
      if (snap?.metadata?.hasPendingWrites) return;
      n = typeof snap?.docChanges === 'function' ? snap.docChanges().length : 0;
    }
    if (n <= 0) return;
    const col = snap?.docs?.[0]?.ref?.parent?.id || query?.id || this.queryCollectionId(query) || '?';
    // Khóa nhận diện "cùng 1 truy vấn": collection + số dòng + id dòng đầu/cuối (vòng lặp trả cùng kết quả)
    const docs = snap?.docs || [];
    const key = isExecution
      ? `q:${col}|${docs.length}|${docs[0]?.id || ''}|${docs[docs.length - 1]?.id || ''}`
      : '';
    this.autoAdd(col, n, key);
  }

  private queryCollectionId(query: any): string {
    try {
      const path = query?._delegate?._query?.path;
      if (path && typeof path.lastSegment === 'function') return String(path.lastSegment());
      const cg = query?._delegate?._query?.collectionGroup;
      if (cg) return String(cg);
    } catch { /* */ }
    return '';
  }

  private currentRoute(): string {
    if (typeof location === 'undefined') return 'unknown';
    const raw = (location.hash || location.pathname || '').replace(/^#?\/?/, '');
    const seg = raw.split(/[/?]/)[0] || 'root';
    return seg.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || 'root';
  }

  private autoAdd(collectionName: string, n: number, key = ''): void {
    if (!(n > 0)) return;
    const route = this.currentRoute();
    const col = String(collectionName || '?').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || '_';
    let byCol = this.autoPending.get(route);
    if (!byCol) {
      byCol = new Map<string, number>();
      this.autoPending.set(route, byCol);
    }
    byCol.set(col, (byCol.get(col) || 0) + n);
    this.guardRecord(col, n, key);
  }

  private todayKey(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private async flush(): Promise<void> {
    if (this.pending.size === 0 && this.autoPending.size === 0) return;

    // Lấy snapshot hiện tại rồi xóa ngay để tránh đếm trùng nếu flush tiếp theo chạy trước khi write xong.
    const snapshot = this.pending;
    this.pending = new Map();
    const autoSnapshot = this.autoPending;
    this.autoPending = new Map();
    const byRoute: Record<string, Record<string, firebase.firestore.FieldValue | number>> = {};
    for (const [route, byCollection] of autoSnapshot.entries()) {
      const payload: Record<string, firebase.firestore.FieldValue | number> = {};
      let total = 0;
      for (const [collectionName, count] of byCollection.entries()) {
        payload[collectionName] = firebase.firestore.FieldValue.increment(count);
        total += count;
      }
      payload['total'] = firebase.firestore.FieldValue.increment(total);
      byRoute[route] = payload;
    }

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
            ...(Object.keys(byTab).length ? { byTab } : {}),
            ...(Object.keys(byRoute).length ? { byRoute } : {}),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
    } catch (e) {
      console.warn('ReadTrackerService: flush failed (không ảnh hưởng chức năng chính)', e);
    }
  }
}
