import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject } from 'rxjs';
import * as firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

/** Tồn từng lô (còn > 0) của 1 mã theo nhà máy. */
export interface NvlStockLots {
  asm1: number[];
  asm2: number[];
}

export interface NvlCatalogItem {
  materialCode: string;
  materialName: string;
  unit: string;
  /** Trọng lượng đơn vị (gram) nếu có trong danh mục NVL. */
  unitWeight?: number;
  /** GW 1 bag nguyên (gram) — nhập ở Inbound / Danh mục NVL; dùng kiểm GW bag CL khi tách tem lẻ. */
  gwBag?: number;
  /** Lượng trong 1 thùng — nhập ở Inbound (cột Lượng trong thùng) / Danh mục; dùng tính số tem thùng. */
  cartonQty?: number;
  /** Số bộ phận của mã (2 / 3 / 4) — chọn ở Quản lý nguyên liệu, hiện khi scan Outbound. 0 = chưa chọn. */
  boPhan?: number;
  standardPacking: number;
  standardPackingLocked: boolean;
  /** Cho phép quét Tem Thùng (tem thùng riêng, không phải QR thường) để xuất kho ở Outbound ASM1/ASM2. */
  allowExportByCarton: boolean;
  /** Mã cần theo dõi Week trên tem (gán ở Danh mục NVL → +Week). */
  weekTracked?: boolean;
  /** Mã thuộc danh sách MSD (Moisture Sensitive Device) — gán ở Inbound/Danh mục, hiển thị ở Materials ASM1/ASM2. */
  isMsd: boolean;
  /** Mã thuộc danh sách ESD (Electrostatic Sensitive Device) — gán ở Inbound/Danh mục, hiển thị ở Materials ASM1/ASM2. */
  isEsd: boolean;
  updatedAt?: Date;
  /** Mã nhân viên (employeeId) người sửa gần nhất — hiển thị ở cột ID cuối bảng Danh mục NVL. */
  lastEditedBy?: string;
}

/** Thay đổi danh mục trên server kể từ một mốc — để máy khác F5 thấy mã vừa sửa. */
export interface NvlCatalogRemoteChanges {
  /** Mốc mới của cache sau khi áp thay đổi. */
  syncTs: number;
  /** Có xóa hàng loạt / gộp trùng → phải đọc lại toàn bộ. */
  reset: boolean;
  items: NvlCatalogItem[];
  deletedCodes: string[];
}

export interface OutboundQtyStats {
  /** Giá trị "quantity" (tem đầy) xuất hiện nhiều nhất trong lịch sử Outbound của mã này. */
  suggestedStandardPacking: number;
  /** Số lần giá trị đề xuất xuất hiện. */
  sampleCount: number;
  /** Tổng số lần scan có quantity hợp lệ của mã này (mọi giá trị). */
  totalScans: number;
}

/**
 * Danh mục NVL (nguyên vật liệu) — dùng chung cho ASM1 & ASM2, lưu trong collection `materials`.
 * Đây là nguồn duy nhất cho tab quản lý Danh mục NVL & TP; Materials ASM1/ASM2 chỉ đọc (read-only)
 * để hiển thị Tên/ĐVT/Standard Packing trên bảng tồn kho.
 *
 * Cache 2 lớp (bộ nhớ + localStorage, 1 lần/ngày) để mở tab không phải đọc lại toàn bộ
 * ~8-9 nghìn document mỗi lần — chỉ đọc lại khi sang ngày mới hoặc bấm "Cập nhật danh mục".
 * Sửa 1 mã (Standard Packing, …) ghi thêm một mốc thời gian + bản vá nhỏ để Outbound
 * và Inventory áp ngay, không chờ hết ngày và không đọc lại cả collection.
 */
@Injectable({ providedIn: 'root' })
export class NvlCatalogFullService {
  readonly collectionName = 'materials';
  private static readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  private static readonly LS_KEY = 'nvl-catalog-full-cache-v1';
  /** Mốc lần sửa gần nhất — tab khác lắng nghe storage event này. */
  static readonly cacheStampKey = 'nvl-catalog-cache-ts-v1';
  private static readonly PATCH_KEY = 'nvl-catalog-patches-v1';
  /** Doc ghi mốc lần sửa danh mục gần nhất (giờ server) — mọi máy đọc 1 doc này để biết có gì mới. */
  private static readonly META_COLLECTION = 'app-meta';
  private static readonly META_DOC = 'nvl-catalog';
  /** Đọc doc mốc tối đa 1 lần / phút mỗi tab. */
  private static readonly META_CHECK_MS = 60 * 1000;
  /** Lùi mốc khi truy vấn mã đã sửa — bù lệch giờ máy khách ghi updatedAt. */
  private static readonly DELTA_MARGIN_MS = 15 * 60 * 1000;

  /** Bắn khi 1 mã vừa được sửa trong phiên này. */
  readonly changed$ = new Subject<string>();

  private cachedItems: NvlCatalogItem[] | null = null;
  private cachedAt = 0;
  private cachedDateKey = '';
  private codesWithStockCache: Set<string> | null = null;
  private stockLotsCache: Map<string, NvlStockLots> | null = null;
  /** Mốc server mà cache này đã đồng bộ tới (lưu cùng cache localStorage). */
  private syncTs = 0;
  private metaPromise: Promise<{ updatedAt: number; resetAt: number; deleted: Record<string, number> } | null> | null = null;
  private metaReadAt = 0;

  private todayKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private dateKeyFromTs(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  constructor(private firestore: AngularFirestore) {}

  normalizeCode(code: string | null | undefined): string {
    return String(code || '').trim().toUpperCase();
  }

  /** Cache trong RAM — đọc đồng bộ, không JSON.parse / Firestore. */
  peekCached(): NvlCatalogItem[] | null {
    if (this.cachedItems && this.cachedDateKey === this.todayKey()) {
      return this.cachedItems;
    }
    return null;
  }

  /** Mốc cache trong RAM của tab này. */
  cacheSavedAt(): number {
    return this.cachedAt;
  }

  /** Mốc mới nhất, kể cả tab khác vừa ghi localStorage. */
  readCacheTimestamp(): number {
    let stamped = 0;
    try {
      stamped = Number(localStorage.getItem(NvlCatalogFullService.cacheStampKey)) || 0;
    } catch { /* ignore */ }
    return Math.max(this.cachedAt, stamped);
  }

  async listAll(forceRefresh = false): Promise<NvlCatalogItem[]> {
    const today = this.todayKey();
    if (!forceRefresh) {
      const stamped = this.readCacheTimestamp();
      const mem = this.peekCached();
      if (mem) {
        // Tab khác vừa sửa mã: áp bản vá vào RAM, không đọc lại cả collection.
        if (stamped > this.cachedAt) {
          this.applyPatches(mem);
          this.cachedAt = stamped;
        }
      } else {
        const fromLocalStorage = this.loadFromLocalStorage();
        if (fromLocalStorage) {
          this.applyPatches(fromLocalStorage.items);
          this.cachedItems = fromLocalStorage.items;
          this.cachedAt = Math.max(fromLocalStorage.timestamp, stamped);
          this.cachedDateKey = today;
          this.syncTs = fromLocalStorage.syncTs;
        }
      }
      if (this.cachedItems && this.cachedDateKey === today) {
        // Máy khác sửa danh mục: đọc 1 doc mốc + chỉ các mã đã sửa.
        if (await this.syncRemoteChanges()) return this.cachedItems;
      }
    }

    // Nhiều nơi gọi cùng lúc (vd. nhiều storage event) → dùng chung 1 lần đọc, không đọc cả danh mục N lần.
    if (!this.fullReadPromise) {
      this.fullReadPromise = this.readAllFromServer().finally(() => { this.fullReadPromise = null; });
    }
    return this.fullReadPromise;
  }

  private fullReadPromise: Promise<NvlCatalogItem[]> | null = null;

  private async readAllFromServer(): Promise<NvlCatalogItem[]> {
    const meta = await this.readMeta(true).catch(() => null);
    // Danh mục đã > 10.000 mã. Firestore chỉ cho tối đa 10.000 dòng / truy vấn → đọc theo trang.
    const PAGE = 5000;
    const docs: firebase.default.firestore.QueryDocumentSnapshot[] = [];
    let last: firebase.default.firestore.QueryDocumentSnapshot | null = null;
    for (let guard = 0; guard < 20; guard++) {
      let q = this.firestore.firestore
        .collection(this.collectionName)
        .orderBy(firebase.default.firestore.FieldPath.documentId())
        .limit(PAGE);
      if (last) q = q.startAfter(last);
      const page = await q.get();
      docs.push(...page.docs);
      if (page.size < PAGE) break;
      last = page.docs[page.docs.length - 1];
    }
    const items = docs.map(doc => this.mapDoc(doc.id, doc.data() as Record<string, unknown>));
    items.sort((a, b) => a.materialCode.localeCompare(b.materialCode));
    this.clearPatches();
    this.syncTs = meta?.updatedAt || Date.now();
    this.setCache(items);
    return items;
  }

  private syncing: Promise<boolean> | null = null;

  /** Áp thay đổi từ server vào cache RAM. false = cần đọc lại toàn bộ. */
  private syncRemoteChanges(): Promise<boolean> {
    if (!this.syncing) {
      this.syncing = this.doSyncRemoteChanges().finally(() => { this.syncing = null; });
    }
    return this.syncing;
  }

  private async doSyncRemoteChanges(): Promise<boolean> {
    let changes: NvlCatalogRemoteChanges | null;
    try {
      changes = await this.fetchChangesSince(this.syncTs);
    } catch (e) {
      console.warn('NVL catalog: không kiểm tra được thay đổi từ server', e);
      return true;
    }
    if (!changes) return true;
    if (changes.reset) return false;
    const items = this.cachedItems;
    if (!items) return false;
    const deleted = new Set(changes.deletedCodes);
    const byCode = new Map(changes.items.map(i => [i.materialCode, i]));
    const merged = items.filter(i => !deleted.has(i.materialCode) && !byCode.has(i.materialCode));
    merged.push(...byCode.values());
    merged.sort((a, b) => a.materialCode.localeCompare(b.materialCode));
    this.cachedItems = merged;
    this.syncTs = changes.syncTs;
    this.cachedAt = Date.now();
    this.saveToLocalStorage(merged);
    if (byCode.size || deleted.size) this.changed$.next('*');
    return true;
  }

  /**
   * Mã đã sửa trên server sau mốc `since` (giờ server). null = không có gì mới.
   * Tốn 1 lượt read cho doc mốc (tối đa 1 lần/phút) + số mã đã sửa.
   */
  async fetchChangesSince(since: number): Promise<NvlCatalogRemoteChanges | null> {
    if (!since) return null;
    const meta = await this.readMeta();
    if (!meta || meta.updatedAt <= since) return null;
    if (meta.resetAt > since) {
      return { syncTs: meta.updatedAt, reset: true, items: [], deletedCodes: [] };
    }
    const snap = await this.firestore
      .collection(this.collectionName, ref =>
        ref.where('updatedAt', '>', new Date(since - NvlCatalogFullService.DELTA_MARGIN_MS))
      )
      .get()
      .toPromise();
    const items = (snap?.docs || []).map(doc => this.mapDoc(doc.id, doc.data() as Record<string, unknown>));
    const deletedCodes = Object.entries(meta.deleted)
      .filter(([, ts]) => ts > since - NvlCatalogFullService.DELTA_MARGIN_MS)
      .map(([code]) => code)
      .filter(code => !items.some(i => i.materialCode === code));
    return { syncTs: meta.updatedAt, reset: false, items, deletedCodes };
  }

  /** Mốc server mà cache danh mục trong service đang có. */
  remoteSyncTs(): number {
    return this.syncTs;
  }

  private readMeta(force = false): Promise<{ updatedAt: number; resetAt: number; deleted: Record<string, number> } | null> {
    const now = Date.now();
    if (!force && this.metaPromise && now - this.metaReadAt < NvlCatalogFullService.META_CHECK_MS) {
      return this.metaPromise;
    }
    this.metaReadAt = now;
    this.metaPromise = this.firestore
      .collection(NvlCatalogFullService.META_COLLECTION)
      .doc(NvlCatalogFullService.META_DOC)
      .get()
      .toPromise()
      .then(snap => {
        if (!snap?.exists) return null;
        const d = (snap.data() || {}) as Record<string, unknown>;
        const deleted: Record<string, number> = {};
        const rawDeleted = (d['deleted'] || {}) as Record<string, unknown>;
        for (const [code, ts] of Object.entries(rawDeleted)) deleted[code] = this.toMillis(ts);
        return { updatedAt: this.toMillis(d['updatedAt']), resetAt: this.toMillis(d['resetAt']), deleted };
      })
      .catch(e => {
        this.metaPromise = null;
        throw e;
      });
    return this.metaPromise;
  }

  private toMillis(v: unknown): number {
    if (!v) return 0;
    if (typeof (v as any).toMillis === 'function') return (v as any).toMillis();
    if (v instanceof Date) return v.getTime();
    return Number(v) || 0;
  }

  /**
   * Ghi mốc "danh mục vừa đổi" (giờ server). Gọi sau mọi lần ghi vào collection `materials`
   * để máy khác F5 biết mà tải phần đã sửa.
   */
  async markRemoteChanged(opts: { deletedCodes?: string[]; reset?: boolean } = {}): Promise<void> {
    const serverTs = firebase.default.firestore.FieldValue.serverTimestamp();
    const payload: Record<string, unknown> = { updatedAt: serverTs };
    if (opts.reset) payload['resetAt'] = serverTs;
    if (opts.deletedCodes?.length) {
      const deleted: Record<string, unknown> = {};
      for (const code of opts.deletedCodes) deleted[code] = serverTs;
      payload['deleted'] = deleted;
    }
    try {
      await this.firestore
        .collection(NvlCatalogFullService.META_COLLECTION)
        .doc(NvlCatalogFullService.META_DOC)
        .set(payload, { merge: true });
      this.metaPromise = null;
    } catch (e) {
      console.warn('NVL catalog: không ghi được mốc thay đổi', e);
    }
  }

  /** Đọc 1 mã từ Firestore (không dùng cache) — để Materials biết Lock vừa unlock trên Danh mục NVL. */
  async getByCode(materialCode: string): Promise<NvlCatalogItem | null> {
    const code = this.normalizeCode(materialCode);
    if (!code) return null;
    const snap = await this.firestore.collection(this.collectionName).doc(code).get().toPromise();
    if (!snap?.exists) {
      const q = await this.firestore.collection(this.collectionName, ref =>
        ref.where('materialCode', '==', code).limit(1)
      ).get().toPromise();
      const doc = q?.docs?.[0];
      if (!doc) return null;
      const item = this.mapDoc(doc.id, doc.data() as Record<string, unknown>);
      this.refreshCachedItem(item);
      return item;
    }
    const item = this.mapDoc(snap.id, snap.data() as Record<string, unknown>);
    this.refreshCachedItem(item);
    return item;
  }

  /**
   * Đọc 1 mã chỉ làm mới RAM của tab này. Không ghi mốc localStorage / không bắn changed$:
   * trước đây mỗi lần đọc (vd. PXK Check lượng đọc vài chục mã) bị coi như "vừa sửa", các tab khác
   * nhận storage event rồi cùng lúc đọc lại cả danh mục ~10.000 mã → phanh đọc dữ liệu.
   */
  private refreshCachedItem(item: NvlCatalogItem): void {
    if (!this.cachedItems || !item.materialCode) return;
    const idx = this.cachedItems.findIndex(i => i.materialCode === item.materialCode);
    if (idx >= 0) this.cachedItems[idx] = { ...this.cachedItems[idx], ...item };
  }

  private mapDoc(id: string, d: Record<string, unknown>): NvlCatalogItem {
    return {
      materialCode: String(d['materialCode'] || id).trim().toUpperCase(),
      materialName: String(d['materialName'] || ''),
      unit: String(d['unit'] || ''),
      unitWeight: Number(d['unitWeight'] ?? d['unit_weight']) || 0,
      gwBag: Number(d['gwBag']) || 0,
      cartonQty: Number(d['cartonQty']) || 0,
      boPhan: Number(d['boPhan']) || 0,
      standardPacking: Number(d['standardPacking']) || 0,
      standardPackingLocked: d['standardPackingLocked'] === true,
      allowExportByCarton: d['allowExportByCarton'] === true,
      weekTracked: d['weekTracked'] === true,
      isMsd: d['isMsd'] === true,
      isEsd: d['isEsd'] === true,
      updatedAt: (d['updatedAt'] as any)?.toDate ? (d['updatedAt'] as any).toDate() : undefined,
      lastEditedBy: d['lastEditedBy'] ? String(d['lastEditedBy']) : undefined
    };
  }

  private setCache(items: NvlCatalogItem[]): void {
    this.cachedItems = items;
    // Không ghi mốc localStorage ở đây: mốc đó bắn storage event sang tab khác.
    // Nếu cache lớn không lưu được localStorage, các tab sẽ đọc lại cả collection rồi bắn tiếp → vòng lặp.
    this.cachedAt = Date.now();
    this.cachedDateKey = this.todayKey();
    this.saveToLocalStorage(items);
  }

  private stampCache(): void {
    this.cachedAt = Date.now();
    this.cachedDateKey = this.todayKey();
    try {
      localStorage.setItem(NvlCatalogFullService.cacheStampKey, String(this.cachedAt));
    } catch { /* ignore */ }
  }

  private readPatches(): Record<string, Partial<NvlCatalogItem>> {
    try {
      const raw = localStorage.getItem(NvlCatalogFullService.PATCH_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, Partial<NvlCatalogItem>>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private writePatch(code: string, patch: Partial<NvlCatalogItem> | null): void {
    const all = this.readPatches();
    if (patch === null) delete all[code];
    else all[code] = { ...patch, materialCode: code };
    try {
      localStorage.setItem(NvlCatalogFullService.PATCH_KEY, JSON.stringify(all));
    } catch { /* ignore */ }
  }

  private clearPatches(): void {
    try {
      localStorage.removeItem(NvlCatalogFullService.PATCH_KEY);
    } catch { /* ignore */ }
  }

  private applyPatches(items: NvlCatalogItem[]): void {
    const patches = this.readPatches();
    for (const [code, patch] of Object.entries(patches)) {
      if (!patch) continue;
      const idx = items.findIndex(i => i.materialCode === code);
      if (idx >= 0) {
        items[idx] = { ...items[idx], ...patch, materialCode: code };
      }
    }
  }

  private saveToLocalStorage(items: NvlCatalogItem[]): void {
    try {
      localStorage.setItem(
        NvlCatalogFullService.LS_KEY,
        JSON.stringify({ items, timestamp: this.cachedAt, dateKey: this.cachedDateKey, syncTs: this.syncTs })
      );
    } catch {
      /* localStorage full/unavailable — bỏ qua, vẫn còn cache trong bộ nhớ */
    }
  }

  private loadFromLocalStorage(): { items: NvlCatalogItem[]; timestamp: number; syncTs: number } | null {
    try {
      const raw = localStorage.getItem(NvlCatalogFullService.LS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { items: NvlCatalogItem[]; timestamp: number; dateKey?: string; syncTs?: number };
      if (!parsed?.items) return null;
      const ts = Number(parsed.timestamp) || 0;
      if (!ts || Date.now() - ts >= NvlCatalogFullService.CACHE_TTL_MS) return null;
      const cacheDay = parsed.dateKey || this.dateKeyFromTs(ts);
      if (cacheDay !== this.todayKey()) return null;
      return {
        timestamp: ts,
        items: parsed.items,
        // Cache cũ chưa có mốc server: dùng giờ lưu cache.
        syncTs: Number(parsed.syncTs) || ts
      };
    } catch {
      return null;
    }
  }

  private invalidateCache(): void {
    this.cachedItems = null;
    this.cachedAt = 0;
    this.cachedDateKey = '';
    this.clearPatches();
    try {
      localStorage.removeItem(NvlCatalogFullService.LS_KEY);
      localStorage.removeItem(NvlCatalogFullService.cacheStampKey);
    } catch {
      /* ignore */
    }
  }

  /** Cập nhật 1 dòng trong cache tại chỗ (thay vì đọc lại toàn bộ collection). */
  private patchCache(code: string, patch: Partial<NvlCatalogItem> | null): void {
    this.stampCache();
    this.writePatch(code, patch);
    if (!this.cachedItems) {
      this.changed$.next(code);
      return;
    }
    const idx = this.cachedItems.findIndex(i => i.materialCode === code);
    if (patch === null) {
      if (idx >= 0) this.cachedItems.splice(idx, 1);
    } else if (idx >= 0) {
      this.cachedItems[idx] = { ...this.cachedItems[idx], ...patch };
    } else {
      this.cachedItems.push({
        materialCode: code,
        materialName: '',
        unit: '',
        unitWeight: 0,
        standardPacking: 0,
        standardPackingLocked: false,
        allowExportByCarton: false,
        isMsd: false,
        isEsd: false,
        ...patch
      });
      this.cachedItems.sort((a, b) => a.materialCode.localeCompare(b.materialCode));
    }
    this.saveToLocalStorage(this.cachedItems);
    this.changed$.next(code);
  }

  /** Thêm mã mới. Báo lỗi nếu mã đã tồn tại (dùng addOrUpdate để ghi đè có chủ đích). */
  async addNew(
    item: { materialCode: string; materialName: string; unit: string; unitWeight?: number; standardPacking: number },
    editedBy?: string
  ): Promise<void> {
    const code = this.normalizeCode(item.materialCode);
    if (!code) throw new Error('Thiếu mã NVL');
    const ref = this.firestore.collection(this.collectionName).doc(code);
    const existing = await ref.get().toPromise();
    if (existing?.exists) {
      throw new Error(`Mã NVL "${code}" đã tồn tại`);
    }
    const materialName = (item.materialName || '').trim() || code;
    const unit = (item.unit || '').trim() || 'PCS';
    const unitWeight = Math.max(0, Number(item.unitWeight) || 0);
    const standardPacking = Math.max(0, Number(item.standardPacking) || 0);
    await ref.set({
      materialCode: code,
      materialName,
      unit,
      unitWeight,
      standardPacking,
      standardPackingLocked: false,
      allowExportByCarton: false,
      isMsd: false,
      isEsd: false,
      ...(editedBy ? { lastEditedBy: editedBy } : {}),
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await this.markRemoteChanged();
    this.patchCache(code, {
      materialCode: code,
      materialName,
      unit,
      unitWeight,
      standardPacking,
      standardPackingLocked: false,
      allowExportByCarton: false,
      isMsd: false,
      isEsd: false,
      ...(editedBy ? { lastEditedBy: editedBy } : {})
    });
  }

  async update(
    materialCode: string,
    changes: { materialName?: string; unit?: string; unitWeight?: number; gwBag?: number; cartonQty?: number; standardPacking?: number; boPhan?: number },
    editedBy?: string
  ): Promise<void> {
    const code = this.normalizeCode(materialCode);
    if (!code) return;
    const payload: Record<string, unknown> = { updatedAt: new Date() };
    const patch: Partial<NvlCatalogItem> = {};
    if (changes.materialName !== undefined) {
      payload['materialName'] = changes.materialName.trim();
      patch.materialName = changes.materialName.trim();
    }
    if (changes.unit !== undefined) {
      payload['unit'] = changes.unit.trim();
      patch.unit = changes.unit.trim();
    }
    if (changes.unitWeight !== undefined) {
      const unitWeight = Math.max(0, Number(changes.unitWeight) || 0);
      payload['unitWeight'] = unitWeight;
      patch.unitWeight = unitWeight;
    }
    if (changes.gwBag !== undefined) {
      const gw = Math.max(0, Number(changes.gwBag) || 0);
      payload['gwBag'] = gw;
      patch.gwBag = gw;
    }
    if (changes.cartonQty !== undefined) {
      const cq = Math.max(0, Math.round((Number(changes.cartonQty) || 0) * 10000) / 10000);
      payload['cartonQty'] = cq;
      patch.cartonQty = cq;
    }
    if (changes.standardPacking !== undefined) {
      const sp = Math.max(0, Number(changes.standardPacking) || 0);
      payload['standardPacking'] = sp;
      patch.standardPacking = sp;
    }
    if (changes.boPhan !== undefined) {
      const bp = Math.max(0, Math.round(Number(changes.boPhan) || 0));
      payload['boPhan'] = bp;
      patch.boPhan = bp;
    }
    if (editedBy) {
      payload['lastEditedBy'] = editedBy;
      patch.lastEditedBy = editedBy;
    }
    await this.firestore.collection(this.collectionName).doc(code).set(payload, { merge: true });
    await this.markRemoteChanged();
    this.patchCache(code, patch);
  }

  /** GW bag nguyên (gram) — ghi được cả khi mã đang Lock (Lock chỉ khóa Standard / tên / ĐVT). */
  async setGwBag(materialCode: string, gwBag: number, editedBy?: string): Promise<void> {
    await this.update(materialCode, { gwBag }, editedBy);
  }

  /** Lượng trong thùng — ghi được cả khi mã đang Lock. */
  async setCartonQty(materialCode: string, cartonQty: number, editedBy?: string): Promise<void> {
    await this.update(materialCode, { cartonQty }, editedBy);
  }

  async setLocked(materialCode: string, locked: boolean, editedBy?: string): Promise<void> {
    const code = this.normalizeCode(materialCode);
    if (!code) return;
    const payload: Record<string, unknown> = { standardPackingLocked: locked, updatedAt: new Date() };
    if (editedBy) payload['lastEditedBy'] = editedBy;
    await this.firestore.collection(this.collectionName).doc(code).set(payload, { merge: true });
    await this.markRemoteChanged();
    this.patchCache(code, { standardPackingLocked: locked, ...(editedBy ? { lastEditedBy: editedBy } : {}) });
  }

  async setAllowExportByCarton(materialCode: string, allowed: boolean, editedBy?: string): Promise<void> {
    const code = this.normalizeCode(materialCode);
    if (!code) return;
    const payload: Record<string, unknown> = { allowExportByCarton: allowed, updatedAt: new Date() };
    if (editedBy) payload['lastEditedBy'] = editedBy;
    await this.firestore.collection(this.collectionName).doc(code).set(payload, { merge: true });
    await this.markRemoteChanged();
    this.patchCache(code, { allowExportByCarton: allowed, ...(editedBy ? { lastEditedBy: editedBy } : {}) });
  }

  /** Bật / tắt theo dõi Week cho mã (chỉ ghi khi mã đã có trong danh mục). */
  async setWeekTracked(materialCode: string, tracked: boolean, editedBy?: string): Promise<void> {
    const code = this.normalizeCode(materialCode);
    if (!code) return;
    const payload: Record<string, unknown> = { weekTracked: tracked, updatedAt: new Date() };
    if (editedBy) payload['lastEditedBy'] = editedBy;
    await this.firestore.collection(this.collectionName).doc(code).set(payload, { merge: true });
    await this.markRemoteChanged();
    this.patchCache(code, { weekTracked: tracked, ...(editedBy ? { lastEditedBy: editedBy } : {}) });
    this.weekTrackedCache = null;
  }

  private weekTrackedCache: { at: number; set: Set<string> } | null = null;

  /** Mã vừa có Week ở 1 lô → Danh mục tự bật theo dõi Week (bỏ qua nếu đã bật). */
  async ensureWeekTracked(materialCode: string, editedBy?: string): Promise<void> {
    const code = this.normalizeCode(materialCode);
    if (!code) return;
    const set = await this.loadWeekTrackedCodes().catch(() => null);
    if (set?.has(code)) return;
    // update (không set merge): mã chưa có trong danh mục thì bỏ qua, không tạo dòng danh mục rỗng
    const payload: Record<string, unknown> = { weekTracked: true, updatedAt: new Date() };
    if (editedBy) payload['lastEditedBy'] = editedBy;
    try {
      await this.firestore.firestore.collection(this.collectionName).doc(code).update(payload);
    } catch (e: any) {
      if (e?.code !== 'not-found') throw e;
      // Doc danh mục không đặt id = mã → tìm theo trường materialCode
      const q = await this.firestore.firestore.collection(this.collectionName).where('materialCode', '==', code).limit(1).get();
      if (q.empty) return;
      await q.docs[0].ref.update(payload);
    }
    await this.markRemoteChanged();
    this.patchCache(code, { weekTracked: true, ...(editedBy ? { lastEditedBy: editedBy } : {}) });
    set?.add(code);
  }

  /**
   * Mã đang theo dõi Week (Danh mục NVL → +Week). Truy vấn riêng chỉ lấy mã có cờ — vài lượt đọc,
   * không đọc lại cả danh mục. Cache 10 phút trong phiên.
   */
  async loadWeekTrackedCodes(force = false): Promise<Set<string>> {
    if (!force && this.weekTrackedCache && Date.now() - this.weekTrackedCache.at < 10 * 60 * 1000) {
      return this.weekTrackedCache.set;
    }
    const snap = await this.firestore.firestore.collection(this.collectionName).where('weekTracked', '==', true).get();
    const set = new Set<string>();
    snap.forEach((d) => {
      const c = this.normalizeCode(String((d.data() as any)?.materialCode || d.id));
      if (c) set.add(c);
    });
    this.weekTrackedCache = { at: Date.now(), set };
    return set;
  }

  /**
   * Tập mã được phép quét Tem Thùng để xuất kho — dùng ở Outbound ASM1/ASM2, load 1 lần từ cache
   * dùng chung (listAll, TTL 6 tiếng), không tạo thêm lượt đọc Firestore mỗi lần scan.
   */
  async loadAllowExportByCartonSet(forceRefresh = false): Promise<Set<string>> {
    const items = await this.listAll(forceRefresh);
    return new Set(items.filter(i => i.allowExportByCarton).map(i => i.materialCode));
  }

  async deleteItem(materialCode: string): Promise<void> {
    const code = this.normalizeCode(materialCode);
    if (!code) return;
    await this.firestore.collection(this.collectionName).doc(code).delete();
    await this.markRemoteChanged({ deletedCodes: [code] });
    this.patchCache(code, null);
  }

  /**
   * Tập mã đang có tồn kho > 0 (quét `inventory-materials` ASM1 + ASM2) — dùng cho bộ lọc
   * "Chỉ có tồn" ở Danh mục NVL. Chỉ đọc khi bật lọc (không tải sẵn khi mở tab), cache trong
   * bộ nhớ theo phiên làm việc — bật/tắt lại không đọc lại Firestore.
   */
  async loadCodesWithStock(forceRefresh = false): Promise<Set<string>> {
    if (!forceRefresh && this.codesWithStockCache) return this.codesWithStockCache;
    const lots = await this.loadStockLotsByCode(forceRefresh);
    this.codesWithStockCache = new Set(lots.keys());
    return this.codesWithStockCache;
  }

  /**
   * Tồn từng lô (dòng `inventory-materials` còn tồn > 0) theo mã, tách ASM1 / ASM2 — để tính số bag
   * (mỗi lô = làm tròn lên tồn ÷ Standard Packing). Đọc 1 lần theo phiên, cache trong bộ nhớ.
   */
  async loadStockLotsByCode(forceRefresh = false): Promise<Map<string, NvlStockLots>> {
    if (!forceRefresh && this.stockLotsCache) return this.stockLotsCache;

    const factories: Array<'ASM1' | 'ASM2'> = ['ASM1', 'ASM2'];
    const snaps = await Promise.all(
      factories.map(f =>
        this.firestore
          .collection('inventory-materials', ref => ref.where('factory', '==', f).limit(10000))
          .get()
          .toPromise()
      )
    );

    const out = new Map<string, NvlStockLots>();
    snaps.forEach((snap, i) => {
      const key = factories[i] === 'ASM1' ? 'asm1' : 'asm2';
      for (const doc of snap?.docs || []) {
        const d = doc.data() as Record<string, unknown>;
        const code = this.normalizeCode(String(d['materialCode'] || ''));
        if (!code) continue;
        const openingStock = d['openingStock'] != null ? Number(d['openingStock']) : 0;
        const quantity = Number(d['quantity']) || 0;
        const exported = Number(d['exported']) || 0;
        const xt = Number(d['xt']) || 0;
        const stock = Math.round((openingStock + quantity - exported - xt) * 10000) / 10000;
        if (!(stock > 0)) continue;
        const cur = out.get(code) || { asm1: [], asm2: [] };
        cur[key].push(stock);
        out.set(code, cur);
      }
    });

    this.stockLotsCache = out;
    return out;
  }

  /**
   * Rà soát Standard Packing từ lịch sử Outbound (ASM1+ASM2): mỗi lần quét ghi lại `quantity`
   * (tem đầy) — hoặc `exportQuantity` nếu `quantity` trống (luồng Bổ Sung không ghi quantity).
   * Với mỗi mã, giá trị xuất hiện NHIỀU NHẤT chính là Standard Packing thực tế (tem đầy quét đủ
   * = đúng bằng Standard Packing). Đọc 1 lần khi bấm nút "Rà soát" — không cache, không tự chạy lại.
   */
  async auditStandardPackingFromOutbound(): Promise<Map<string, OutboundQtyStats>> {
    const freq = new Map<string, Map<number, number>>();
    const factories: Array<'ASM1' | 'ASM2'> = ['ASM1', 'ASM2'];

    const ingestDoc = (d: Record<string, unknown>): void => {
      const code = this.normalizeCode(String(d['materialCode'] || ''));
      if (!code) return;
      const fromQuantity = Number(d['quantity']);
      const fromExport = Number(d['exportQuantity']);
      const qty = fromQuantity > 0 ? fromQuantity : fromExport > 0 ? fromExport : 0;
      if (qty <= 0) return;
      let table = freq.get(code);
      if (!table) {
        table = new Map<number, number>();
        freq.set(code, table);
      }
      table.set(qty, (table.get(qty) || 0) + 1);
    };

    // Firestore giới hạn limit tối đa 10000/truy vấn — phân trang theo documentId để đọc hết lịch sử.
    const db = this.firestore.firestore;
    const col = db.collection('outbound-materials');
    const idPath = firebase.default.firestore.FieldPath.documentId();
    const pageSize = 2000;
    for (const factory of factories) {
      let last: firebase.default.firestore.QueryDocumentSnapshot | null = null;
      for (;;) {
        let q: firebase.default.firestore.Query = col.where('factory', '==', factory).orderBy(idPath).limit(pageSize);
        if (last) {
          q = q.startAfter(last);
        }
        const snap = await q.get();
        if (snap.empty) break;
        snap.docs.forEach(doc => ingestDoc(doc.data() as Record<string, unknown>));
        if (snap.docs.length < pageSize) break;
        last = snap.docs[snap.docs.length - 1] as firebase.default.firestore.QueryDocumentSnapshot;
      }
    }

    const result = new Map<string, OutboundQtyStats>();
    for (const [code, table] of freq.entries()) {
      let bestQty = 0;
      let bestCount = 0;
      let totalScans = 0;
      for (const [qty, count] of table.entries()) {
        totalScans += count;
        if (count > bestCount) {
          bestCount = count;
          bestQty = qty;
        }
      }
      if (bestCount > 0) {
        result.set(code, { suggestedStandardPacking: bestQty, sampleCount: bestCount, totalScans });
      }
    }
    return result;
  }

  /** Xóa TOÀN BỘ danh mục NVL (collection `materials`). Không thể hoàn tác. */
  async deleteAll(): Promise<number> {
    const db = this.firestore.firestore;
    const snap = await this.firestore.collection(this.collectionName, ref => ref.limit(10000)).get().toPromise();
    const docs = snap?.docs || [];
    let idx = 0;
    while (idx < docs.length) {
      const batch = db.batch();
      const chunk = docs.slice(idx, idx + 450);
      chunk.forEach(d => batch.delete(d.ref));
      await batch.commit();
      idx += chunk.length;
    }
    await this.markRemoteChanged({ reset: true });
    this.invalidateCache();
    return docs.length;
  }

  /**
   * Gộp các document bị trùng mã (cùng materialCode sau chuẩn hóa nhưng nằm ở doc ID khác nhau —
   * dữ liệu cũ trước khi doc ID luôn = mã chuẩn hóa). Mỗi mã chỉ giữ lại đúng 1 document tại đúng
   * vị trí `doc(code)` (nơi mọi thao tác CRUD khác đang dùng); dữ liệu không rỗng ở các bản trùng
   * được gộp vào bản giữ lại trước khi xóa phần thừa, tránh mất dữ liệu.
   */
  async dedupeDuplicates(): Promise<{ dedupedCodes: number; deletedDocs: number }> {
    const snap = await this.firestore.collection(this.collectionName, ref => ref.limit(10000)).get().toPromise();
    const docs = snap?.docs || [];

    const groups = new Map<string, typeof docs>();
    for (const d of docs) {
      const data = d.data() as Record<string, unknown>;
      const code = this.normalizeCode(String(data['materialCode'] || d.id));
      if (!code) continue;
      const arr = groups.get(code) || [];
      arr.push(d);
      groups.set(code, arr);
    }

    const toUpsert: Array<{ id: string; data: Record<string, unknown> }> = [];
    const toDelete: string[] = [];
    let dedupedCodes = 0;

    for (const [code, group] of groups) {
      if (group.length <= 1) continue;
      dedupedCodes++;

      const canonical = group.find(d => d.id === code) || group[0];
      const others = group.filter(d => d.id !== canonical.id);
      const canonicalData = canonical.data() as Record<string, unknown>;

      const merged: Record<string, unknown> = {};
      for (const other of others) {
        const od = other.data() as Record<string, unknown>;
        if (!canonicalData['materialName'] && od['materialName']) merged['materialName'] = od['materialName'];
        if (!canonicalData['unit'] && od['unit']) merged['unit'] = od['unit'];
        if (!Number(canonicalData['standardPacking']) && Number(od['standardPacking'])) merged['standardPacking'] = od['standardPacking'];
        if (od['standardPackingLocked'] === true) merged['standardPackingLocked'] = true;
        if (od['allowExportByCarton'] === true) merged['allowExportByCarton'] = true;
        if (od['isMsd'] === true) merged['isMsd'] = true;
        if (od['isEsd'] === true) merged['isEsd'] = true;
        toDelete.push(other.id);
      }

      if (canonical.id !== code) {
        toUpsert.push({ id: code, data: { ...canonicalData, ...merged, materialCode: code, updatedAt: new Date() } });
        toDelete.push(canonical.id);
      } else if (Object.keys(merged).length > 0) {
        toUpsert.push({ id: code, data: { ...merged, updatedAt: new Date() } });
      }
    }

    const db = this.firestore.firestore;
    let idx = 0;
    while (idx < toUpsert.length) {
      const batch = db.batch();
      const chunk = toUpsert.slice(idx, idx + 400);
      chunk.forEach(u => batch.set(this.firestore.collection(this.collectionName).doc(u.id).ref, u.data, { merge: true }));
      await batch.commit();
      idx += chunk.length;
    }
    idx = 0;
    while (idx < toDelete.length) {
      const batch = db.batch();
      const chunk = toDelete.slice(idx, idx + 400);
      chunk.forEach(id => batch.delete(this.firestore.collection(this.collectionName).doc(id).ref));
      await batch.commit();
      idx += chunk.length;
    }

    await this.markRemoteChanged({ reset: true });
    this.invalidateCache();
    return { dedupedCodes, deletedDocs: toDelete.length };
  }

  /**
   * Import Danh mục NVL gốc (Mã, Tên, ĐVT): thêm mã mới nếu chưa có, cập nhật Tên/ĐVT cho mã đã có.
   * KHÔNG đụng tới Standard Packing / Lock / Xuất thùng — các cột đó do Kho tự quản lý riêng
   * (chỉ sửa tay hoặc qua các hành động chuyên biệt khác), độc lập với import danh mục gốc này.
   */
  /**
   * Import danh mục NVL từ file hệ thống (cột Mã vật tư / Tên vật tư / Đvt):
   * Thêm mã chưa có; mã đã có thì CHỈ điền Tên (và ĐVT) khi trên web đang trống / tên = mã —
   * không sửa bất cứ gì khác của mã đã có. Đọc lại toàn bộ danh mục từ server trước khi ghi.
   */
  async addMissingFromRows(
    rows: Array<{ materialCode: string; materialName: string; unit: string }>
  ): Promise<{ added: string[]; named: string[]; existing: number; uniqueInFile: number }> {
    const byCode = new Map<string, { materialName: string; unit: string }>();
    for (const r of rows) {
      const code = this.normalizeCode(r.materialCode);
      if (!code || byCode.has(code)) continue;
      byCode.set(code, { materialName: (r.materialName || '').trim(), unit: (r.unit || '').trim() });
    }
    const uniqueInFile = byCode.size;
    if (!uniqueInFile) return { added: [], named: [], existing: 0, uniqueInFile: 0 };

    const db = this.firestore.firestore;
    const existingCodes = new Set<string>();
    /** Mã đã có nhưng thiếu tên (trống hoặc tên = mã): code → { doc id, ĐVT hiện tại } */
    const noName = new Map<string, { id: string; unit: string }>();
    const snap = await db.collection(this.collectionName).get();
    snap.forEach((d) => {
      const data = d.data() as any;
      const idCode = this.normalizeCode(d.id);
      const c = this.normalizeCode(data?.materialCode) || idCode;
      existingCodes.add(idCode);
      existingCodes.add(c);
      const name = String(data?.materialName || '').trim();
      if (!name || name.toUpperCase() === c) noName.set(c, { id: d.id, unit: String(data?.unit || '').trim() });
    });

    // Điền tên cho mã đã có nhưng chưa có tên (chỉ field Tên, ĐVT nếu đang trống)
    const named: string[] = [];
    const nameWrites: Array<{ id: string; code: string; payload: Record<string, unknown>; patch: Partial<NvlCatalogItem> }> = [];
    noName.forEach((cur, code) => {
      const info = byCode.get(code);
      const name = (info?.materialName || '').trim();
      if (!name || name.toUpperCase() === code) return;
      const payload: Record<string, unknown> = { materialName: name, updatedAt: new Date() };
      const patch: Partial<NvlCatalogItem> = { materialName: name };
      if (!cur.unit && info?.unit) {
        payload['unit'] = info.unit;
        patch.unit = info.unit;
      }
      nameWrites.push({ id: cur.id, code, payload, patch });
      named.push(code);
    });
    for (let i = 0; i < nameWrites.length; i += 450) {
      const batch = db.batch();
      for (const w of nameWrites.slice(i, i + 450)) {
        batch.update(db.collection(this.collectionName).doc(w.id), w.payload);
        this.patchCache(w.code, w.patch);
      }
      await batch.commit();
    }

    const newCodes = [...byCode.keys()].filter((c) => !existingCodes.has(c));
    let idx = 0;
    while (idx < newCodes.length) {
      const batch = db.batch();
      const chunk = newCodes.slice(idx, idx + 450);
      for (const code of chunk) {
        const info = byCode.get(code)!;
        const materialName = info.materialName || code;
        const unit = info.unit || 'PCS';
        const doc = {
          materialCode: code,
          materialName,
          unit,
          standardPacking: 0,
          standardPackingLocked: false,
          allowExportByCarton: false,
          isMsd: false,
          isEsd: false
        };
        batch.set(db.collection(this.collectionName).doc(code), { ...doc, createdAt: new Date(), updatedAt: new Date() });
        this.patchCache(code, doc);
      }
      await batch.commit();
      idx += chunk.length;
    }
    if (newCodes.length || named.length) await this.markRemoteChanged();
    return { added: newCodes, named, existing: uniqueInFile - newCodes.length, uniqueInFile };
  }

  async importCatalogFromRows(
    rows: Array<{ materialCode: string; materialName: string; unit: string }>
  ): Promise<{ added: number; updated: number; skipped: number; uniqueInFile: number }> {
    const byCode = new Map<string, { materialName: string; unit: string }>();
    for (const r of rows) {
      const code = this.normalizeCode(r.materialCode);
      if (!code) continue;
      byCode.set(code, { materialName: (r.materialName || '').trim(), unit: (r.unit || '').trim() });
    }
    const codes = Array.from(byCode.keys());
    if (codes.length === 0) return { added: 0, updated: 0, skipped: 0, uniqueInFile: 0 };

    const existing = await this.listAll();
    const existingCodes = new Set(existing.map(i => i.materialCode));

    const db = this.firestore.firestore;
    let added = 0;
    let updated = 0;
    let skipped = 0;
    let idx = 0;
    while (idx < codes.length) {
      const batch = db.batch();
      const chunk = codes.slice(idx, idx + 450);
      for (const code of chunk) {
        const info = byCode.get(code)!;
        const ref = this.firestore.collection(this.collectionName).doc(code).ref;
        if (existingCodes.has(code)) {
          if (!info.materialName && !info.unit) {
            skipped++;
            continue;
          }
          const payload: Record<string, unknown> = { updatedAt: new Date() };
          const patch: Partial<NvlCatalogItem> = {};
          if (info.materialName) {
            payload['materialName'] = info.materialName;
            patch.materialName = info.materialName;
          }
          if (info.unit) {
            payload['unit'] = info.unit;
            patch.unit = info.unit;
          }
          batch.set(ref, payload, { merge: true });
          this.patchCache(code, patch);
          updated++;
        } else {
          const materialName = info.materialName || code;
          const unit = info.unit || 'PCS';
          batch.set(ref, {
            materialCode: code,
            materialName,
            unit,
            standardPacking: 0,
            standardPackingLocked: false,
            allowExportByCarton: false,
            isMsd: false,
            isEsd: false,
            createdAt: new Date(),
            updatedAt: new Date()
          });
          this.patchCache(code, {
            materialCode: code,
            materialName,
            unit,
            standardPacking: 0,
            standardPackingLocked: false,
            allowExportByCarton: false,
            isMsd: false,
            isEsd: false
          });
          added++;
        }
      }
      await batch.commit();
      idx += chunk.length;
    }
    if (added || updated) await this.markRemoteChanged();

    return { added, updated, skipped, uniqueInFile: codes.length };
  }
}
