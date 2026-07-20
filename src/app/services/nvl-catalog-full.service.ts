import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';

export interface NvlCatalogItem {
  materialCode: string;
  materialName: string;
  unit: string;
  standardPacking: number;
  standardPackingLocked: boolean;
  /** Cho phép quét Tem Thùng (tem thùng riêng, không phải QR thường) để xuất kho ở Outbound ASM1/ASM2. */
  allowExportByCarton: boolean;
  updatedAt?: Date;
}

/**
 * Danh mục NVL (nguyên vật liệu) — dùng chung cho ASM1 & ASM2, lưu trong collection `materials`.
 * Đây là nguồn duy nhất cho tab quản lý Danh mục NVL & TP; Materials ASM1/ASM2 chỉ đọc (read-only)
 * để hiển thị Tên/ĐVT/Standard Packing trên bảng tồn kho.
 *
 * Cache 2 lớp (bộ nhớ + localStorage, TTL 6 tiếng) để mở tab không phải đọc lại toàn bộ
 * ~8-9 nghìn document mỗi lần — chỉ đọc lại khi hết hạn cache hoặc bấm "Làm mới".
 */
@Injectable({ providedIn: 'root' })
export class NvlCatalogFullService {
  readonly collectionName = 'materials';
  private static readonly CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  private static readonly LS_KEY = 'nvl-catalog-full-cache-v1';

  private cachedItems: NvlCatalogItem[] | null = null;
  private cachedAt = 0;

  constructor(private firestore: AngularFirestore) {}

  normalizeCode(code: string | null | undefined): string {
    return String(code || '').trim().toUpperCase();
  }

  async listAll(forceRefresh = false): Promise<NvlCatalogItem[]> {
    const now = Date.now();
    if (!forceRefresh && this.cachedItems && now - this.cachedAt < NvlCatalogFullService.CACHE_TTL_MS) {
      return this.cachedItems;
    }
    if (!forceRefresh) {
      const fromLocalStorage = this.loadFromLocalStorage();
      if (fromLocalStorage) {
        this.cachedItems = fromLocalStorage;
        this.cachedAt = now;
        return fromLocalStorage;
      }
    }

    const snap = await this.firestore
      .collection(this.collectionName, ref => ref.limit(10000))
      .get()
      .toPromise();
    const items = (snap?.docs || []).map(doc => this.mapDoc(doc.id, doc.data() as Record<string, unknown>));
    items.sort((a, b) => a.materialCode.localeCompare(b.materialCode));
    this.setCache(items);
    return items;
  }

  private mapDoc(id: string, d: Record<string, unknown>): NvlCatalogItem {
    return {
      materialCode: String(d['materialCode'] || id).trim().toUpperCase(),
      materialName: String(d['materialName'] || ''),
      unit: String(d['unit'] || ''),
      standardPacking: Number(d['standardPacking']) || 0,
      standardPackingLocked: d['standardPackingLocked'] === true,
      allowExportByCarton: d['allowExportByCarton'] === true,
      updatedAt: (d['updatedAt'] as any)?.toDate ? (d['updatedAt'] as any).toDate() : undefined
    };
  }

  private setCache(items: NvlCatalogItem[]): void {
    this.cachedItems = items;
    this.cachedAt = Date.now();
    this.saveToLocalStorage(items);
  }

  private saveToLocalStorage(items: NvlCatalogItem[]): void {
    try {
      localStorage.setItem(
        NvlCatalogFullService.LS_KEY,
        JSON.stringify({ items, timestamp: this.cachedAt })
      );
    } catch {
      /* localStorage full/unavailable — bỏ qua, vẫn còn cache trong bộ nhớ */
    }
  }

  private loadFromLocalStorage(): NvlCatalogItem[] | null {
    try {
      const raw = localStorage.getItem(NvlCatalogFullService.LS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { items: NvlCatalogItem[]; timestamp: number };
      if (!parsed?.items || Date.now() - parsed.timestamp >= NvlCatalogFullService.CACHE_TTL_MS) return null;
      return parsed.items.map(i => ({ ...i, updatedAt: i.updatedAt ? new Date(i.updatedAt) : undefined }));
    } catch {
      return null;
    }
  }

  private invalidateCache(): void {
    this.cachedItems = null;
    this.cachedAt = 0;
    try {
      localStorage.removeItem(NvlCatalogFullService.LS_KEY);
    } catch {
      /* ignore */
    }
  }

  /** Cập nhật 1 dòng trong cache tại chỗ (thay vì đọc lại toàn bộ collection). */
  private patchCache(code: string, patch: Partial<NvlCatalogItem> | null): void {
    if (!this.cachedItems) return;
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
        standardPacking: 0,
        standardPackingLocked: false,
        allowExportByCarton: false,
        ...patch
      });
      this.cachedItems.sort((a, b) => a.materialCode.localeCompare(b.materialCode));
    }
    this.saveToLocalStorage(this.cachedItems);
  }

  /** Thêm mã mới. Báo lỗi nếu mã đã tồn tại (dùng addOrUpdate để ghi đè có chủ đích). */
  async addNew(item: { materialCode: string; materialName: string; unit: string; standardPacking: number }): Promise<void> {
    const code = this.normalizeCode(item.materialCode);
    if (!code) throw new Error('Thiếu mã NVL');
    const ref = this.firestore.collection(this.collectionName).doc(code);
    const existing = await ref.get().toPromise();
    if (existing?.exists) {
      throw new Error(`Mã NVL "${code}" đã tồn tại`);
    }
    const materialName = (item.materialName || '').trim() || code;
    const unit = (item.unit || '').trim() || 'PCS';
    const standardPacking = Math.max(0, Number(item.standardPacking) || 0);
    await ref.set({
      materialCode: code,
      materialName,
      unit,
      standardPacking,
      standardPackingLocked: false,
      allowExportByCarton: false,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    this.patchCache(code, {
      materialCode: code,
      materialName,
      unit,
      standardPacking,
      standardPackingLocked: false,
      allowExportByCarton: false
    });
  }

  async update(materialCode: string, changes: { materialName?: string; unit?: string; standardPacking?: number }): Promise<void> {
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
    if (changes.standardPacking !== undefined) {
      const sp = Math.max(0, Number(changes.standardPacking) || 0);
      payload['standardPacking'] = sp;
      patch.standardPacking = sp;
    }
    await this.firestore.collection(this.collectionName).doc(code).set(payload, { merge: true });
    this.patchCache(code, patch);
  }

  async setLocked(materialCode: string, locked: boolean): Promise<void> {
    const code = this.normalizeCode(materialCode);
    if (!code) return;
    await this.firestore.collection(this.collectionName).doc(code).set(
      { standardPackingLocked: locked, updatedAt: new Date() },
      { merge: true }
    );
    this.patchCache(code, { standardPackingLocked: locked });
  }

  async setAllowExportByCarton(materialCode: string, allowed: boolean): Promise<void> {
    const code = this.normalizeCode(materialCode);
    if (!code) return;
    await this.firestore.collection(this.collectionName).doc(code).set(
      { allowExportByCarton: allowed, updatedAt: new Date() },
      { merge: true }
    );
    this.patchCache(code, { allowExportByCarton: allowed });
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
    this.patchCache(code, null);
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
    this.invalidateCache();
    return docs.length;
  }

  /**
   * Import Excel Standard Packing: CHỈ cập nhật mã đã có sẵn trong `materials`, bỏ qua mã không tồn tại
   * (không tạo mới qua import) và bỏ qua mã đang Lock. Giữ nguyên hành vi cũ để không phá dữ liệu hiện có.
   */
  async importStandardPackingFromRows(
    rows: Array<{ materialCode: string; standardPacking: number }>
  ): Promise<{ updated: number; skipped: number; uniqueInFile: number }> {
    const byCode = new Map<string, number>();
    for (const r of rows) {
      const code = this.normalizeCode(r.materialCode);
      if (!code) continue;
      byCode.set(code, Number(r.standardPacking) || 0);
    }
    const codes = Array.from(byCode.keys());
    if (codes.length === 0) return { updated: 0, skipped: 0, uniqueInFile: 0 };

    const existing = await this.listAll();
    const existingByCode = new Map(existing.map(i => [i.materialCode, i]));

    const db = this.firestore.firestore;
    let updated = 0;
    let skipped = 0;
    let idx = 0;
    const toApply = codes.filter(code => {
      const item = existingByCode.get(code);
      if (!item) {
        skipped++;
        return false;
      }
      if (item.standardPackingLocked) {
        skipped++;
        return false;
      }
      return true;
    });

    while (idx < toApply.length) {
      const batch = db.batch();
      const chunk = toApply.slice(idx, idx + 450);
      for (const code of chunk) {
        const ref = this.firestore.collection(this.collectionName).doc(code).ref;
        batch.update(ref, { standardPacking: byCode.get(code), updatedAt: new Date() });
      }
      await batch.commit();
      chunk.forEach(code => this.patchCache(code, { standardPacking: byCode.get(code) }));
      updated += chunk.length;
      idx += chunk.length;
    }

    return { updated, skipped, uniqueInFile: codes.length };
  }
}
