import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';

export interface NvlkhEntry {
  id: string;
  materialCode: string;
  customer: string;
  updatedAt?: Date;
}

/**
 * Danh mục NVL — Khách hàng (mã nguyên liệu → khách hàng, hoặc "Shared" nếu dùng chung).
 * Import từ Excel (cột A: mã NVL, cột B: khách hàng) ở tab "Danh mục NVLKH",
 * dùng để hiển thị cột KH ở Materials ASM1/ASM2.
 */
@Injectable({ providedIn: 'root' })
export class NvlkhCatalogService {
  readonly collectionName = 'nvl-kh-catalog';

  /** Cache trong phiên làm việc — tránh đọc lại toàn bộ danh mục nhiều lần trong 1 lần mở tab. */
  private cachedMap: Map<string, string> | null = null;
  private cachedAt = 0;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(private firestore: AngularFirestore) {}

  normalizeMaterialCode(code: string | null | undefined): string {
    return String(code || '').trim().toUpperCase();
  }

  /** Doc id theo mã NVL đã chuẩn hóa — import lại cùng mã sẽ tự ghi đè (upsert), không tạo trùng. */
  buildDocId(materialCode: string): string {
    const code = this.normalizeMaterialCode(materialCode);
    const safe = code.replace(/[\/\\.#$\[\]]/g, '_').replace(/\s+/g, '_');
    return safe || '_empty';
  }

  /**
   * Đọc toàn bộ danh mục 1 lần (dữ liệu tham chiếu nhỏ — mã NVL/khách hàng), cache trong bộ nhớ
   * ~5 phút để Materials ASM1/ASM2 tra cứu theo mã mà không phải đọc lại Firestore mỗi lần.
   */
  async loadAllAsMap(forceRefresh = false): Promise<Map<string, string>> {
    const now = Date.now();
    if (!forceRefresh && this.cachedMap && now - this.cachedAt < NvlkhCatalogService.CACHE_TTL_MS) {
      return this.cachedMap;
    }

    const snap = await this.firestore
      .collection(this.collectionName, ref => ref.limit(10000))
      .get()
      .toPromise();

    const map = new Map<string, string>();
    (snap?.docs || []).forEach(doc => {
      const d = doc.data() as Record<string, unknown>;
      const code = this.normalizeMaterialCode(String(d['materialCode'] || ''));
      const customer = String(d['customer'] || '').trim();
      if (code && customer) map.set(code, customer);
    });

    this.cachedMap = map;
    this.cachedAt = now;
    return map;
  }

  async listEntries(): Promise<NvlkhEntry[]> {
    const snap = await this.firestore
      .collection(this.collectionName, ref => ref.orderBy('materialCode', 'asc').limit(10000))
      .get()
      .toPromise();
    return (snap?.docs || []).map(doc => this.mapDoc(doc.id, doc.data() as Record<string, unknown>));
  }

  /**
   * Import = THAY THẾ TOÀN BỘ danh mục: mã nào không có trong file import sẽ bị xóa khỏi
   * danh mục, chỉ giữ lại đúng các mã có trong lần import này. Batch 400 doc/lần.
   */
  async importFromRows(rows: Array<{ materialCode: string; customer: string }>): Promise<number> {
    const clean = rows
      .map(r => ({
        materialCode: this.normalizeMaterialCode(r.materialCode),
        customer: String(r.customer || '').trim()
      }))
      .filter(r => r.materialCode && r.customer);

    if (!clean.length) return 0;

    const newIds = new Set(clean.map(r => this.buildDocId(r.materialCode)));

    // Xóa các mã hiện có mà không nằm trong file import mới
    const existingSnap = await this.firestore
      .collection(this.collectionName, ref => ref.limit(10000))
      .get()
      .toPromise();
    const idsToDelete = (existingSnap?.docs || [])
      .map(doc => doc.id)
      .filter(id => !newIds.has(id));

    const chunkSize = 400;
    for (let i = 0; i < idsToDelete.length; i += chunkSize) {
      const batch = this.firestore.firestore.batch();
      idsToDelete.slice(i, i + chunkSize).forEach(id => {
        batch.delete(this.firestore.collection(this.collectionName).doc(id).ref);
      });
      await batch.commit();
    }

    for (let i = 0; i < clean.length; i += chunkSize) {
      const batch = this.firestore.firestore.batch();
      clean.slice(i, i + chunkSize).forEach(r => {
        const id = this.buildDocId(r.materialCode);
        const ref = this.firestore.collection(this.collectionName).doc(id).ref;
        batch.set(
          ref,
          {
            materialCode: r.materialCode,
            customer: r.customer,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      });
      await batch.commit();
    }

    this.cachedMap = null; // Buộc tải lại lần tra cứu tiếp theo
    return clean.length;
  }

  async deleteEntry(id: string): Promise<void> {
    await this.firestore.collection(this.collectionName).doc(id).delete();
    this.cachedMap = null;
  }

  private mapDoc(id: string, data: Record<string, unknown>): NvlkhEntry {
    return {
      id,
      materialCode: this.normalizeMaterialCode(String(data['materialCode'] || '')),
      customer: String(data['customer'] || ''),
      updatedAt: (data['updatedAt'] as firebase.firestore.Timestamp | undefined)?.toDate?.()
    };
  }
}
