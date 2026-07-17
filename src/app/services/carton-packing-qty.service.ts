import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';

/**
 * Danh mục "Lượng Đóng Thùng" — riêng của Kho, tách khỏi Danh mục TP (`fg-catalog`) nên KHÔNG bị
 * xóa mỗi khi Import Excel (thay thế toàn bộ) Danh mục TP. Dùng để ghi đè "SL SP/thùng" khi kho
 * phát hiện số thùng thực tế sai lệch (sửa ở FG In → nút "Sai số thùng").
 *
 * Ưu tiên tính Carton ở FG In: có Lượng Đóng Thùng cho mã đó → dùng giá trị này; không có → dùng
 * "SL SP/thùng" (field `standard` trong `fg-catalog`).
 */
@Injectable({ providedIn: 'root' })
export class CartonPackingQtyService {
  private readonly collectionName = 'carton-packing-qty';
  private static readonly CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  private static readonly LS_KEY = 'carton-packing-qty-cache-v1';

  private cachedMap: Map<string, number> | null = null;
  private cachedAt = 0;

  constructor(private firestore: AngularFirestore) {}

  private normalizeCode(code: string | null | undefined): string {
    return String(code || '').trim().toUpperCase();
  }

  async loadAllAsMap(forceRefresh = false): Promise<Map<string, number>> {
    const now = Date.now();
    if (!forceRefresh && this.cachedMap && now - this.cachedAt < CartonPackingQtyService.CACHE_TTL_MS) {
      return this.cachedMap;
    }
    if (!forceRefresh) {
      const fromLocalStorage = this.loadFromLocalStorage();
      if (fromLocalStorage) {
        this.cachedMap = fromLocalStorage;
        this.cachedAt = now;
        return fromLocalStorage;
      }
    }

    const snap = await this.firestore.collection(this.collectionName, ref => ref.limit(10000)).get().toPromise();
    const map = new Map<string, number>();
    (snap?.docs || []).forEach(doc => {
      const d = doc.data() as Record<string, unknown>;
      const code = this.normalizeCode(String(d['materialCode'] || doc.id));
      const qty = Number(d['quantity']) || 0;
      if (code && qty > 0) map.set(code, qty);
    });
    this.setCache(map);
    return map;
  }

  private setCache(map: Map<string, number>): void {
    this.cachedMap = map;
    this.cachedAt = Date.now();
    try {
      localStorage.setItem(
        CartonPackingQtyService.LS_KEY,
        JSON.stringify({ entries: Array.from(map.entries()), timestamp: this.cachedAt })
      );
    } catch {
      /* localStorage full/unavailable — bỏ qua, vẫn còn cache trong bộ nhớ */
    }
  }

  private loadFromLocalStorage(): Map<string, number> | null {
    try {
      const raw = localStorage.getItem(CartonPackingQtyService.LS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { entries: Array<[string, number]>; timestamp: number };
      if (!parsed?.entries || Date.now() - parsed.timestamp >= CartonPackingQtyService.CACHE_TTL_MS) return null;
      return new Map(parsed.entries);
    } catch {
      return null;
    }
  }

  private invalidateCache(): void {
    this.cachedMap = null;
    this.cachedAt = 0;
    try {
      localStorage.removeItem(CartonPackingQtyService.LS_KEY);
    } catch {
      /* ignore */
    }
  }

  /** Ghi đè Lượng Đóng Thùng cho 1 mã — dùng ở FG In (Sai số thùng) và Danh mục TP. */
  async upsert(materialCode: string, quantity: number): Promise<void> {
    const code = this.normalizeCode(materialCode);
    if (!code) return;
    const qty = Math.max(0, Math.round(Number(quantity) || 0));
    await this.firestore.collection(this.collectionName).doc(code).set(
      { materialCode: code, quantity: qty, updatedAt: new Date() },
      { merge: true }
    );
    if (this.cachedMap) {
      if (qty > 0) this.cachedMap.set(code, qty);
      else this.cachedMap.delete(code);
      this.setCache(this.cachedMap);
    }
  }

  /**
   * Bước 1 (thiết lập/đồng bộ lại): copy toàn bộ "SL SP/thùng" hiện có sang Lượng Đóng Thùng,
   * GHI ĐÈ giá trị đang có. Chỉ copy các mã có SL SP/thùng > 0.
   */
  async copyAllFromStandard(items: Array<{ materialCode: string; standard: string }>): Promise<number> {
    const rows = items
      .map(i => ({ code: this.normalizeCode(i.materialCode), qty: Math.round(parseFloat(i.standard) || 0) }))
      .filter(r => r.code && r.qty > 0);
    if (rows.length === 0) return 0;

    const db = this.firestore.firestore;
    const now = new Date();
    let idx = 0;
    while (idx < rows.length) {
      const batch = db.batch();
      const chunk = rows.slice(idx, idx + 450);
      chunk.forEach(r => {
        const ref = this.firestore.collection(this.collectionName).doc(r.code).ref;
        batch.set(ref, { materialCode: r.code, quantity: r.qty, updatedAt: now }, { merge: true });
      });
      await batch.commit();
      idx += chunk.length;
    }
    this.invalidateCache();
    return rows.length;
  }
}
