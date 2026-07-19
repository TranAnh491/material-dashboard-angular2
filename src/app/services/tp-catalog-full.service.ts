import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';

export interface MergedCatalogItem {
  catalogId?: string;
  mappingId?: string;
  materialCode: string;
  standard: string;
  customerCode: string;
  description: string;
  productName: string;
  unit: string;
  cartonSize: string;
  grossWeight: string;
  netWeight: string;
  /** Lượng Đóng Thùng — đọc/ghi qua CartonPackingQtyService (collection riêng `carton-packing-qty`), gắn tạm vào đây để hiển thị. */
  cartonPackingQty?: number;
}

export interface TpImportMeta {
  lastImportAt: Date | null;
  fileName: string;
  addedCount: number;
  updatedCount: number;
}

export interface TpImportRow {
  materialCode: string;
  customerCode: string;
  productName: string;
  unit: string;
  description: string;
  cartonSize: string;
  grossWeight: string;
  netWeight: string;
  standard: string;
  /** Ngày tạo bản vẽ — chỉ dùng để chọn dòng nào thắng khi trùng Mã S.Phẩm KH, không lưu vào fg-catalog. */
  drawingDate?: Date | null;
  /** Toàn bộ cột gốc trong file Excel (kể cả cột chưa có UI riêng) — lưu nguyên vào fg-catalog. */
  raw?: Record<string, any>;
}

/** Doc thô trong `fg-catalog` — dùng cho các tab (FG In/Out/Check/Inventory, Shipment...) chỉ cần tra cứu, không quản lý. */
export interface RawFgCatalogDoc {
  id: string;
  materialCode: string;
  standard: string;
  customer: string;
  customerCode: string;
  productName: string;
  unit: string;
  cartonSize: string;
  grossWeight: string;
  netWeight: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Doc thô trong `fg-customer-mapping` — dùng cho các tab chỉ cần tra cứu. */
export interface RawFgCustomerMappingDoc {
  id: string;
  customerCode: string;
  materialCode: string;
  description: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Danh mục TP (thành phẩm) + Mapping KH-TP — dùng chung cho tab Danh mục NVL & TP, và là NGUỒN ĐỌC
 * DÙNG CHUNG cho mọi tab khác cần dữ liệu này (FG In/Out/Check/Inventory, Shipment...) thay vì mỗi
 * tab tự đọc thẳng Firestore. Nguồn chính là collection `fg-catalog` (Mã vật tư, Mã S.Phẩm KH,
 * Tên vật tư, Đvt, Khách hàng, K.Thước thùng, Gross/Net Weight, SL SP trên thùng). `fg-customer-mapping`
 * chỉ còn giữ để tương thích dữ liệu cũ (mapping thủ công trước đây) — import mới không ghi vào đây nữa.
 *
 * Cache 2 lớp (bộ nhớ + localStorage, TTL 6 tiếng) DÙNG CHUNG giữa mọi tab/consumer trong cùng
 * trình duyệt: tab đầu tiên mở trong 6 tiếng mới thật sự đọc Firestore, các tab sau (kể cả khác
 * trang) dùng lại cache — giảm mạnh số lượt đọc dù nhiều tab cùng cần danh mục này liên tục.
 */
@Injectable({ providedIn: 'root' })
export class TpCatalogFullService {
  private readonly catalogCollection = 'fg-catalog';
  private readonly mappingCollection = 'fg-customer-mapping';
  private readonly importMetaPath = 'fg-catalog-meta/merged-import';
  private static readonly CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  private static readonly LS_KEY = 'tp-catalog-full-cache-v1';
  private static readonly CATALOG_RAW_LS_KEY = 'fg-catalog-raw-cache-v1';
  private static readonly MAPPING_RAW_LS_KEY = 'fg-customer-mapping-raw-cache-v1';

  private cachedItems: MergedCatalogItem[] | null = null;
  private cachedAt = 0;

  private cachedCatalogDocs: RawFgCatalogDoc[] | null = null;
  private cachedCatalogDocsAt = 0;
  private cachedMappingDocs: RawFgCustomerMappingDoc[] | null = null;
  private cachedMappingDocsAt = 0;

  constructor(private firestore: AngularFirestore) {}

  private norm(v: any): string {
    return String(v ?? '').trim();
  }

  private key(materialCode: any, customerCode: any): string {
    return `${this.norm(materialCode).toUpperCase()}|${this.norm(customerCode).toUpperCase()}`;
  }

  private toDate(v: any): Date | undefined {
    return v?.toDate ? v.toDate() : v?.seconds ? new Date(v.seconds * 1000) : undefined;
  }

  /**
   * Doc thô `fg-catalog`, cache dùng chung 6 tiếng. Dùng cho các tab chỉ cần Standard/Customer
   * theo Mã TP (FG In/Out/Check/Inventory...) — không nên tự query Firestore riêng nữa.
   */
  async getCatalogItemsCached(forceRefresh = false): Promise<RawFgCatalogDoc[]> {
    const now = Date.now();
    if (!forceRefresh && this.cachedCatalogDocs && now - this.cachedCatalogDocsAt < TpCatalogFullService.CACHE_TTL_MS) {
      return this.cachedCatalogDocs;
    }
    if (!forceRefresh) {
      const fromLs = this.loadRawFromLocalStorage<RawFgCatalogDoc>(TpCatalogFullService.CATALOG_RAW_LS_KEY);
      if (fromLs) {
        this.cachedCatalogDocs = fromLs;
        this.cachedCatalogDocsAt = now;
        return fromLs;
      }
    }

    const snap = await this.firestore.collection(this.catalogCollection).get().toPromise();
    const docs: RawFgCatalogDoc[] = (snap?.docs || []).map(doc => {
      const d = doc.data() as any;
      return {
        id: doc.id,
        materialCode: this.norm(d.materialCode),
        standard: this.norm(d.standard),
        customer: this.norm(d.customer),
        customerCode: this.norm(d.customerCode),
        productName: this.norm(d.productName),
        unit: this.norm(d.unit),
        cartonSize: this.norm(d.cartonSize),
        grossWeight: this.norm(d.grossWeight),
        netWeight: this.norm(d.netWeight),
        createdAt: this.toDate(d.createdAt),
        updatedAt: this.toDate(d.updatedAt)
      };
    });
    this.cachedCatalogDocs = docs;
    this.cachedCatalogDocsAt = now;
    this.saveRawToLocalStorage(TpCatalogFullService.CATALOG_RAW_LS_KEY, docs, now);
    return docs;
  }

  /**
   * Doc thô `fg-customer-mapping`, cache dùng chung 6 tiếng. Dùng cho các tab chỉ cần tra cứu Tên KH
   * theo Mã KH / Mã TP (Shipment, FG Check...) — không nên tự query Firestore riêng nữa.
   */
  async getMappingItemsCached(forceRefresh = false): Promise<RawFgCustomerMappingDoc[]> {
    const now = Date.now();
    if (!forceRefresh && this.cachedMappingDocs && now - this.cachedMappingDocsAt < TpCatalogFullService.CACHE_TTL_MS) {
      return this.cachedMappingDocs;
    }
    if (!forceRefresh) {
      const fromLs = this.loadRawFromLocalStorage<RawFgCustomerMappingDoc>(TpCatalogFullService.MAPPING_RAW_LS_KEY);
      if (fromLs) {
        this.cachedMappingDocs = fromLs;
        this.cachedMappingDocsAt = now;
        return fromLs;
      }
    }

    const snap = await this.firestore.collection(this.mappingCollection).get().toPromise();
    const docs: RawFgCustomerMappingDoc[] = (snap?.docs || []).map(doc => {
      const d = doc.data() as any;
      return {
        id: doc.id,
        customerCode: this.norm(d.customerCode),
        materialCode: this.norm(d.materialCode),
        description: this.norm(d.description),
        createdAt: this.toDate(d.createdAt),
        updatedAt: this.toDate(d.updatedAt)
      };
    });
    this.cachedMappingDocs = docs;
    this.cachedMappingDocsAt = now;
    this.saveRawToLocalStorage(TpCatalogFullService.MAPPING_RAW_LS_KEY, docs, now);
    return docs;
  }

  private saveRawToLocalStorage<T>(key: string, items: T[], timestamp: number): void {
    try {
      localStorage.setItem(key, JSON.stringify({ items, timestamp }));
    } catch {
      /* localStorage full/unavailable — bỏ qua, vẫn còn cache trong bộ nhớ */
    }
  }

  private loadRawFromLocalStorage<T>(key: string): T[] | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { items: T[]; timestamp: number };
      if (!parsed?.items || Date.now() - parsed.timestamp >= TpCatalogFullService.CACHE_TTL_MS) return null;
      return parsed.items;
    } catch {
      return null;
    }
  }

  /** Tải và gộp catalog + mapping theo cặp (materialCode, customerCode). Cache dùng chung 6 tiếng. */
  async loadMerged(forceRefresh = false): Promise<MergedCatalogItem[]> {
    const now = Date.now();
    if (!forceRefresh && this.cachedItems && now - this.cachedAt < TpCatalogFullService.CACHE_TTL_MS) {
      return this.cachedItems;
    }
    if (!forceRefresh) {
      const fromLocalStorage = this.loadRawFromLocalStorage<MergedCatalogItem>(TpCatalogFullService.LS_KEY);
      if (fromLocalStorage) {
        this.cachedItems = fromLocalStorage;
        this.cachedAt = now;
        return fromLocalStorage;
      }
    }

    const merged = await this.fetchMerged(forceRefresh);
    this.cachedItems = merged;
    this.cachedAt = now;
    this.saveRawToLocalStorage(TpCatalogFullService.LS_KEY, merged, now);
    return merged;
  }

  /**
   * Xóa cache dùng chung (bộ nhớ + localStorage). Gọi sau khi ghi thẳng vào `fg-catalog` /
   * `fg-customer-mapping` từ nơi khác ngoài các method của service này (vd: import Excel riêng
   * ở Shipment), để lần đọc kế tiếp lấy dữ liệu mới thay vì cache cũ.
   */
  invalidateCache(): void {
    this.cachedItems = null;
    this.cachedAt = 0;
    this.cachedCatalogDocs = null;
    this.cachedCatalogDocsAt = 0;
    this.cachedMappingDocs = null;
    this.cachedMappingDocsAt = 0;
    [TpCatalogFullService.LS_KEY, TpCatalogFullService.CATALOG_RAW_LS_KEY, TpCatalogFullService.MAPPING_RAW_LS_KEY].forEach(k => {
      try {
        localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    });
  }

  private async fetchMerged(forceRefresh = false): Promise<MergedCatalogItem[]> {
    const [catalogItems, mappingItems] = await Promise.all([
      this.getCatalogItemsCached(forceRefresh),
      this.getMappingItemsCached(forceRefresh)
    ]);
    const map = new Map<string, MergedCatalogItem>();

    catalogItems.forEach(c => {
      const k = this.key(c.materialCode, c.customerCode);
      map.set(k, {
        catalogId: c.id,
        materialCode: this.norm(c.materialCode),
        customerCode: this.norm(c.customerCode),
        description: this.norm(c.customer),
        standard: this.norm(c.standard),
        productName: this.norm(c.productName),
        unit: this.norm(c.unit),
        cartonSize: this.norm(c.cartonSize),
        grossWeight: this.norm(c.grossWeight),
        netWeight: this.norm(c.netWeight)
      });
    });

    // Chỉ gắn mappingId/description bổ sung cho dòng đã có sẵn trong fg-catalog — KHÔNG tạo dòng mới
    // từ mapping mồ côi (mapping không khớp catalog nào), tránh hiện "dữ liệu cũ" ảo sau khi import
    // thay thế toàn bộ fg-catalog. `fg-customer-mapping` vẫn giữ nguyên, không bị đụng tới ở đây.
    mappingItems.forEach(m => {
      const k = this.key(m.materialCode, m.customerCode);
      const existing = map.get(k);
      if (existing) {
        existing.mappingId = m.id;
        const desc = this.norm(m.description);
        if (desc && !existing.description) existing.description = desc;
      }
    });

    return Array.from(map.values())
      .filter(m => m.materialCode || m.customerCode)
      .sort((a, b) => a.materialCode.localeCompare(b.materialCode) || a.customerCode.localeCompare(b.customerCode));
  }

  /** Thêm một dòng: ghi vào fg-catalog. */
  async addItem(item: {
    materialCode: string;
    standard: string;
    customerCode: string;
    description: string;
    productName?: string;
    unit?: string;
    cartonSize?: string;
    grossWeight?: string;
    netWeight?: string;
  }): Promise<void> {
    const mc = this.norm(item.materialCode);
    const cc = this.norm(item.customerCode);
    if (!mc && !cc) throw new Error('Vui lòng nhập ít nhất Mã vật tư hoặc Mã S.Phẩm KH');

    const now = new Date();
    await this.firestore.collection(this.catalogCollection).add({
      materialCode: mc,
      standard: this.norm(item.standard),
      customer: this.norm(item.description),
      customerCode: cc,
      productName: this.norm(item.productName),
      unit: this.norm(item.unit),
      cartonSize: this.norm(item.cartonSize),
      grossWeight: this.norm(item.grossWeight),
      netWeight: this.norm(item.netWeight),
      createdAt: now,
      updatedAt: now
    });
    this.invalidateCache();
  }

  /** Cập nhật toàn bộ field của dòng danh mục (giữ nguyên mappingId nếu có, chỉ đồng bộ Tên KH sang mapping). */
  async updateItem(item: MergedCatalogItem): Promise<void> {
    const description = this.norm(item.description);
    const tasks: Promise<void>[] = [];
    if (item.catalogId) {
      tasks.push(
        this.firestore.collection(this.catalogCollection).doc(item.catalogId).update({
          standard: this.norm(item.standard),
          customer: description,
          productName: this.norm(item.productName),
          unit: this.norm(item.unit),
          cartonSize: this.norm(item.cartonSize),
          grossWeight: this.norm(item.grossWeight),
          netWeight: this.norm(item.netWeight),
          updatedAt: new Date()
        }) as Promise<void>
      );
    }
    if (item.mappingId) {
      tasks.push(
        this.firestore.collection(this.mappingCollection).doc(item.mappingId).update({
          description,
          updatedAt: new Date()
        }) as Promise<void>
      );
    }
    if (tasks.length === 0) throw new Error('Không tìm thấy dữ liệu để cập nhật');
    await Promise.all(tasks);
    this.invalidateCache();
  }

  async deleteItem(item: MergedCatalogItem): Promise<void> {
    const tasks: Promise<void>[] = [];
    if (item.catalogId) {
      tasks.push(this.firestore.collection(this.catalogCollection).doc(item.catalogId).delete() as Promise<void>);
    }
    if (item.mappingId) {
      tasks.push(this.firestore.collection(this.mappingCollection).doc(item.mappingId).delete() as Promise<void>);
    }
    await Promise.all(tasks);
    this.invalidateCache();
  }

  /** Xóa các dòng không có Mã S.Phẩm KH (customerCode rỗng) trong danh mục gộp hiện tại. Không thể hoàn tác. */
  async deleteItemsWithoutCustomerCode(items: MergedCatalogItem[]): Promise<number> {
    const targets = items.filter(i => !this.norm(i.customerCode));
    if (targets.length === 0) return 0;

    const db = this.firestore.firestore;
    const refs = targets.flatMap(item => {
      const out = [];
      if (item.catalogId) out.push(this.firestore.collection(this.catalogCollection).doc(item.catalogId).ref);
      if (item.mappingId) out.push(this.firestore.collection(this.mappingCollection).doc(item.mappingId).ref);
      return out;
    });

    let idx = 0;
    while (idx < refs.length) {
      const batch = db.batch();
      const chunk = refs.slice(idx, idx + 450);
      chunk.forEach(ref => batch.delete(ref));
      await batch.commit();
      idx += chunk.length;
    }
    this.invalidateCache();
    return targets.length;
  }

  /** Xóa TOÀN BỘ danh mục TP + mapping KH (collection `fg-catalog` + `fg-customer-mapping`). Không thể hoàn tác. */
  async deleteAll(): Promise<number> {
    const db = this.firestore.firestore;
    const [catalogSnap, mappingSnap] = await Promise.all([
      this.firestore.collection(this.catalogCollection).get().toPromise(),
      this.firestore.collection(this.mappingCollection).get().toPromise()
    ]);
    const refs = [...(catalogSnap?.docs || []).map(d => d.ref), ...(mappingSnap?.docs || []).map(d => d.ref)];
    let idx = 0;
    while (idx < refs.length) {
      const batch = db.batch();
      const chunk = refs.slice(idx, idx + 450);
      chunk.forEach(ref => batch.delete(ref));
      await batch.commit();
      idx += chunk.length;
    }
    this.invalidateCache();
    return (catalogSnap?.docs || []).length;
  }

  private async deleteAllCatalogOnly(): Promise<void> {
    const db = this.firestore.firestore;
    const snap = await this.firestore.collection(this.catalogCollection).get().toPromise();
    const refs = (snap?.docs || []).map(d => d.ref);
    let idx = 0;
    while (idx < refs.length) {
      const batch = db.batch();
      const chunk = refs.slice(idx, idx + 450);
      chunk.forEach(ref => batch.delete(ref));
      await batch.commit();
      idx += chunk.length;
    }
  }

  /**
   * Import Excel = THAY THẾ TOÀN BỘ danh mục TP (`fg-catalog`): xóa hết dữ liệu cũ rồi ghi lại từ file.
   * Ghi TẤT CẢ dòng trong file — 1 Mã S.Phẩm KH có nhiều Mã vật tư là hợp lệ, giữ hết. Chỉ gộp dòng
   * trùng THẬT SỰ (cùng cả Mã vật tư LẪN Mã S.Phẩm KH): ưu tiên giữ dòng có "Ngày tạo bản vẽ" MỚI
   * NHẤT, không có ngày (hoặc bằng nhau) thì giữ dòng nằm CUỐI CÙNG trong file. Dòng thiếu cả Mã vật
   * tư lẫn Mã S.Phẩm KH bị bỏ qua. Không đụng tới `fg-customer-mapping`.
   */
  async replaceAllFromRows(rows: TpImportRow[], fileName = ''): Promise<{ count: number }> {
    const byPair = new Map<string, TpImportRow>();
    rows.forEach(r => {
      const mc = this.norm(r.materialCode);
      const cc = this.norm(r.customerCode);
      if (!mc && !cc) return;
      const dedupeKey = `${mc.toUpperCase()}|${cc.toUpperCase()}`;
      const existing = byPair.get(dedupeKey);
      if (!existing) {
        byPair.set(dedupeKey, r);
        return;
      }
      const existingTime = existing.drawingDate?.getTime() ?? -Infinity;
      const newTime = r.drawingDate?.getTime() ?? -Infinity;
      if (newTime >= existingTime) {
        byPair.set(dedupeKey, r);
      }
    });
    const finalRows = Array.from(byPair.values());

    await this.deleteAllCatalogOnly();

    const db = this.firestore.firestore;
    const now = new Date();
    let idx = 0;
    while (idx < finalRows.length) {
      const batch = db.batch();
      const chunk = finalRows.slice(idx, idx + 450);
      chunk.forEach(r => {
        const ref = this.firestore.collection(this.catalogCollection).doc().ref;
        // Ghi toàn bộ cột gốc trong file trước (bỏ giá trị undefined vì Firestore không chấp nhận),
        // rồi đè lên bằng các field đã chuẩn hoá — đảm bảo phần đang có UI/tính toán riêng luôn đúng.
        const rawEntries = Object.entries(r.raw || {}).filter(([, v]) => v !== undefined);
        const sanitizedRaw = Object.fromEntries(rawEntries);
        batch.set(ref, {
          ...sanitizedRaw,
          materialCode: this.norm(r.materialCode),
          customerCode: this.norm(r.customerCode),
          productName: this.norm(r.productName),
          unit: this.norm(r.unit),
          customer: this.norm(r.description),
          cartonSize: this.norm(r.cartonSize),
          grossWeight: this.norm(r.grossWeight),
          netWeight: this.norm(r.netWeight),
          standard: this.norm(r.standard),
          createdAt: now,
          updatedAt: now
        });
      });
      await batch.commit();
      idx += chunk.length;
    }

    await this.saveLastImportMeta({ addedCount: finalRows.length, updatedCount: 0, fileName });
    this.invalidateCache();
    return { count: finalRows.length };
  }

  async loadLastImportMeta(): Promise<TpImportMeta | null> {
    const snap = await this.firestore.doc(this.importMetaPath).get().toPromise();
    if (!snap?.exists) return null;
    const d = snap.data() as any;
    const at = d?.lastImportAt;
    return {
      lastImportAt: at?.toDate ? at.toDate() : at ? new Date(at) : null,
      fileName: String(d?.fileName || ''),
      addedCount: Number(d?.addedCount) || 0,
      updatedCount: Number(d?.updatedCount) || 0
    };
  }

  async saveLastImportMeta(meta: { addedCount: number; updatedCount: number; fileName?: string }): Promise<void> {
    await this.firestore.doc(this.importMetaPath).set(
      {
        lastImportAt: new Date(),
        addedCount: meta.addedCount,
        updatedCount: meta.updatedCount,
        fileName: meta.fileName || '',
        updatedAt: new Date()
      },
      { merge: true }
    );
  }
}
