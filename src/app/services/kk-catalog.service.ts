import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';

export interface KkCatalogEntry {
  id: string;
  groupCode: string;
  productType: string;
  updatedAt?: Date;
}

/**
 * Danh mục KK — map Nhóm mã (B + 6 số, ví dụ B001680) → Loại hàng.
 * Import Excel (cột Nhóm mã, Loại hàng) từ More → Danh mục KK.
 */
@Injectable({ providedIn: 'root' })
export class KkCatalogService {
  readonly collectionName = 'kk-catalog';

  private cachedEntries: KkCatalogEntry[] | null = null;
  private cachedMap: Map<string, string> | null = null;
  private cachedAt = 0;
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(private firestore: AngularFirestore) {}

  /** Chuẩn hóa nhóm mã về B + đúng 6 số (B1680 → B001680, B001680XX → B001680). */
  normalizeGroupCode(raw: string | null | undefined): string {
    const s = String(raw || '').trim().toUpperCase();
    if (!s) return '';
    const exact = s.match(/^B(\d{6})(?:\b|$)/);
    if (exact) return `B${exact[1]}`;
    const padded = s.match(/^B\s*0*(\d{1,6})$/);
    if (padded) return `B${padded[1].padStart(6, '0')}`;
    return '';
  }

  /** Nhóm mã từ mã hàng (B + 6 số đầu). */
  groupCodeFromMaterial(materialCode: string | null | undefined): string {
    return this.normalizeGroupCode(String(materialCode || '').trim().toUpperCase());
  }

  buildDocId(groupCode: string): string {
    const code = this.normalizeGroupCode(groupCode);
    return code || '_empty';
  }

  async loadAll(forceRefresh = false): Promise<KkCatalogEntry[]> {
    const now = Date.now();
    if (!forceRefresh && this.cachedEntries && now - this.cachedAt < KkCatalogService.CACHE_TTL_MS) {
      return this.cachedEntries;
    }

    const snap = await firstValueFrom(
      this.firestore
        .collection(this.collectionName, (ref) => ref.limit(10000))
        .get()
        .pipe(timeout(30000))
    );

    const items = (snap?.docs || [])
      .map((doc) => this.mapDoc(doc.id, doc.data() as Record<string, unknown>))
      .filter((x) => x.groupCode && x.productType)
      .sort((a, b) => a.groupCode.localeCompare(b.groupCode, 'en', { numeric: true }));

    this.cachedEntries = items;
    this.cachedMap = new Map(items.map((x) => [x.groupCode, x.productType]));
    this.cachedAt = now;
    return items;
  }

  async loadAllAsMap(forceRefresh = false): Promise<Map<string, string>> {
    await this.loadAll(forceRefresh);
    return this.cachedMap || new Map();
  }

  productTypeOf(materialCode: string, map?: Map<string, string>): string {
    const group = this.groupCodeFromMaterial(materialCode);
    if (!group) return '';
    return (map || this.cachedMap || new Map()).get(group) || '';
  }

  /**
   * Import = THAY THẾ TOÀN BỘ danh mục. Nhóm mã trùng trong file: dòng sau ghi đè.
   */
  async importFromRows(rows: Array<{ groupCode: string; productType: string }>): Promise<number> {
    const byGroup = new Map<string, string>();
    for (const r of rows) {
      const groupCode = this.normalizeGroupCode(r.groupCode);
      const productType = String(r.productType || '').trim();
      if (!groupCode || !productType) continue;
      byGroup.set(groupCode, productType);
    }
    const clean = Array.from(byGroup.entries()).map(([groupCode, productType]) => ({ groupCode, productType }));
    if (!clean.length) return 0;

    const newIds = new Set(clean.map((r) => this.buildDocId(r.groupCode)));
    const existingSnap = await this.firestore
      .collection(this.collectionName, (ref) => ref.limit(10000))
      .get()
      .toPromise();
    const idsToDelete = (existingSnap?.docs || []).map((doc) => doc.id).filter((id) => !newIds.has(id));

    const chunkSize = 400;
    for (let i = 0; i < idsToDelete.length; i += chunkSize) {
      const batch = this.firestore.firestore.batch();
      idsToDelete.slice(i, i + chunkSize).forEach((id) => {
        batch.delete(this.firestore.collection(this.collectionName).doc(id).ref);
      });
      await batch.commit();
    }

    for (let i = 0; i < clean.length; i += chunkSize) {
      const batch = this.firestore.firestore.batch();
      clean.slice(i, i + chunkSize).forEach((r) => {
        const ref = this.firestore.collection(this.collectionName).doc(this.buildDocId(r.groupCode)).ref;
        batch.set(
          ref,
          {
            groupCode: r.groupCode,
            productType: r.productType,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      });
      await batch.commit();
    }

    this.cachedEntries = null;
    this.cachedMap = null;
    return clean.length;
  }

  readonly homeLocCollectionName = 'kk-type-home-locs';
  private cachedHomeLocs: Map<string, string> | null = null;

  buildHomeLocDocId(productType: string): string {
    const s = String(productType || '').trim().replace(/\//g, '_');
    return s.slice(0, 700) || '_empty';
  }

  async loadHomeLocs(forceRefresh = false): Promise<Map<string, string>> {
    if (!forceRefresh && this.cachedHomeLocs) return this.cachedHomeLocs;
    const snap = await firstValueFrom(
      this.firestore
        .collection(this.homeLocCollectionName, (ref) => ref.limit(2000))
        .get()
        .pipe(timeout(20000))
    );
    const map = new Map<string, string>();
    for (const doc of snap?.docs || []) {
      const data = (doc.data() || {}) as Record<string, unknown>;
      const productType = String(data['productType'] || doc.id || '').trim();
      const location = String(data['location'] || '').trim();
      if (productType && location) map.set(productType, location);
    }
    this.cachedHomeLocs = map;
    return map;
  }

  async saveHomeLoc(productType: string, location: string): Promise<void> {
    const type = String(productType || '').trim();
    if (!type) return;
    const loc = String(location || '').trim();
    const ref = this.firestore.collection(this.homeLocCollectionName).doc(this.buildHomeLocDocId(type));
    if (!this.cachedHomeLocs) this.cachedHomeLocs = new Map();
    if (!loc) {
      await ref.delete();
      this.cachedHomeLocs.delete(type);
      return;
    }
    await ref.set({
      productType: type,
      location: loc,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    this.cachedHomeLocs.set(type, loc);
  }

  private mapDoc(id: string, data: Record<string, unknown>): KkCatalogEntry {
    return {
      id,
      groupCode: this.normalizeGroupCode(String(data['groupCode'] || '')),
      productType: String(data['productType'] || '').trim(),
      updatedAt: (data['updatedAt'] as firebase.firestore.Timestamp | undefined)?.toDate?.()
    };
  }
}
