import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

export type FactoryCode = 'ASM1' | 'ASM2';

export type ExportManifestRow = {
  materialCode: string;
  exportDate: Date;
  quantity: number;
};

export type ImportManifestRow = {
  materialCode: string;
  importDate: Date;
};

@Injectable({ providedIn: 'root' })
export class MaterialsDashboardService {
  constructor(private firestore: AngularFirestore) {}

  readonly EXPORT_MANIFEST_COLLECTION = 'materials-export-manifest';
  readonly IMPORT_MANIFEST_COLLECTION = 'materials-import-manifest';
  readonly AGING_COLLECTION = 'materials-dashboard-aging';
  readonly AGING_DOC_ID = 'current';

  private get db(): firebase.firestore.Firestore {
    // Use native Firestore to avoid AngularFirestore query overload pitfalls.
    return this.firestore.firestore as unknown as firebase.firestore.Firestore;
  }

  private async pageByDocId<T>(
    collection: string,
    buildBase: (ref: firebase.firestore.CollectionReference) => firebase.firestore.Query,
    mapDoc: (doc: firebase.firestore.QueryDocumentSnapshot) => T,
    opts?: { batchSize?: number }
  ): Promise<T[]> {
    const batchSize = Math.min(10000, Math.max(1, opts?.batchSize ?? 10000));
    const out: T[] = [];

    let lastId: string | null = null;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const colRef = this.db.collection(collection);
      let q = buildBase(colRef).orderBy(firebase.firestore.FieldPath.documentId()).limit(batchSize);
      if (lastId) q = q.startAfter(lastId);

      const snap = await q.get();
      const docs = snap.docs;
      for (const d of docs) out.push(mapDoc(d));

      if (docs.length < batchSize) break;
      lastId = docs[docs.length - 1].id;
    }

    return out;
  }

  private toDateUnsafe(v: any): Date | null {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v?.toDate === 'function') {
      const d = v.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    }
    if (typeof v === 'string' || typeof v === 'number') {
      const d = new Date(v);
      return !Number.isNaN(d.getTime()) ? d : null;
    }
    return null;
  }

  async loadMasterSkus(factories: FactoryCode[]): Promise<Set<string>> {
    const skuSet = new Set<string>();
    for (const f of factories) {
      const rows = await this.pageByDocId(
        'inventory-materials',
        (ref) => ref.where('factory', '==', f),
        (doc) => {
          const d: any = doc.data();
          return String(d?.materialCode ?? '').trim().toUpperCase();
        }
      );
      for (const code of rows) if (code) skuSet.add(code);
    }
    return skuSet;
  }

  async loadMasterSkuIndex(factories: FactoryCode[]): Promise<{ skus: Set<string>; locationBySku: Map<string, string> }> {
    // Single pass over inventory-materials to build both:
    // - master SKU set (normalized to Bxxxxxx)
    // - SKU -> most frequent location
    const skus = new Set<string>();
    const countsBySku = new Map<string, Map<string, number>>();

    for (const f of factories) {
      const docs = await this.pageByDocId('inventory-materials', (ref) => ref.where('factory', '==', f), (doc) => doc);
      for (const doc of docs as any[]) {
        const d: any = doc.data();
        const code = String(d?.materialCode ?? '').trim().toUpperCase();
        const m = /B(\d{6})/.exec(code);
        if (!m) continue;
        const sku = `B${m[1]}`;
        skus.add(sku);

        const loc = String(d?.location ?? '').trim().toUpperCase();
        if (!loc) continue;
        let lc = countsBySku.get(sku);
        if (!lc) {
          lc = new Map<string, number>();
          countsBySku.set(sku, lc);
        }
        lc.set(loc, (lc.get(loc) || 0) + 1);
      }
    }

    const locationBySku = new Map<string, string>();
    for (const [sku, locCounts] of countsBySku.entries()) {
      let best = '';
      let bestN = 0;
      for (const [loc, n] of locCounts.entries()) {
        if (n > bestN) {
          best = loc;
          bestN = n;
        }
      }
      if (best) locationBySku.set(sku, best);
    }

    return { skus, locationBySku };
  }

  async loadMasterSkuLocations(factories: FactoryCode[]): Promise<Map<string, string>> {
    // SKU -> most frequent non-empty location across inventory-materials rows.
    const countsBySku = new Map<string, Map<string, number>>();
    for (const f of factories) {
      const docs = await this.pageByDocId('inventory-materials', (ref) => ref.where('factory', '==', f), (doc) => doc);
      for (const doc of docs as any[]) {
        const d: any = doc.data();
        const code = String(d?.materialCode ?? '').trim().toUpperCase();
        const m = /B(\d{6})/.exec(code);
        if (!m) continue;
        const sku = `B${m[1]}`;
        const loc = String(d?.location ?? '').trim().toUpperCase();
        if (!loc) continue;

        let lc = countsBySku.get(sku);
        if (!lc) {
          lc = new Map<string, number>();
          countsBySku.set(sku, lc);
        }
        lc.set(loc, (lc.get(loc) || 0) + 1);
      }
    }

    const skuToBest = new Map<string, string>();
    for (const [sku, locCounts] of countsBySku.entries()) {
      let best = '';
      let bestN = 0;
      for (const [loc, n] of locCounts.entries()) {
        if (n > bestN) {
          best = loc;
          bestN = n;
        }
      }
      if (best) skuToBest.set(sku, best);
    }
    return skuToBest;
  }

  async saveExportManifest(rows: ExportManifestRow[], meta?: { sourceName?: string }): Promise<{ saved: number }> {
    const db = this.db;
    const col = db.collection(this.EXPORT_MANIFEST_COLLECTION);

    // Firestore batch limit is 500 writes.
    const batchSize = 450;
    let saved = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);
      const batch = db.batch();

      for (const r of chunk) {
        const materialCode = String(r.materialCode || '').trim().toUpperCase();
        if (!materialCode) continue;
        const exportDate = r.exportDate instanceof Date ? r.exportDate : new Date(r.exportDate as any);
        if (Number.isNaN(exportDate.getTime())) continue;
        const quantity = Number(r.quantity ?? 0);

        const ref = col.doc();
        batch.set(ref, {
          materialCode,
          exportDate: firebase.firestore.Timestamp.fromDate(exportDate),
          quantity: Number.isFinite(quantity) ? quantity : 0,
          sourceName: String(meta?.sourceName ?? ''),
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        saved++;
      }

      await batch.commit();
    }

    return { saved };
  }

  async loadManifestActivity(params: { start: Date; end: Date }): Promise<Map<string, number>> {
    const start = params.start;
    const end = params.end;
    const activityBySku = new Map<string, number>();

    try {
      const batchSize = 10000;
      const colRef = this.db.collection(this.EXPORT_MANIFEST_COLLECTION);
      let last: firebase.firestore.QueryDocumentSnapshot | null = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        let q: firebase.firestore.Query = colRef
          .where('exportDate', '>=', firebase.firestore.Timestamp.fromDate(start))
          .where('exportDate', '<=', firebase.firestore.Timestamp.fromDate(end))
          .orderBy('exportDate', 'asc')
          .limit(batchSize);
        if (last) q = q.startAfter(last);

        const snap = await q.get();
        const docs = snap.docs;
        for (const doc of docs) {
          const d: any = doc.data();
          const code = String(d?.materialCode ?? '').trim().toUpperCase();
          if (!code) continue;
          // "Số lần xuất": mỗi dòng = 1 lần (không dùng quantity)
          activityBySku.set(code, (activityBySku.get(code) || 0) + 1);
        }

        if (docs.length < batchSize) break;
        last = docs[docs.length - 1];
      }

      return activityBySku;
    } catch (e) {
      console.warn('[MaterialsDashboard] manifest range query failed, fallback to client filter', e);
    }

    const docs = await this.pageByDocId(this.EXPORT_MANIFEST_COLLECTION, (ref) => ref, (doc) => doc);
    for (const doc of docs as any[]) {
      const d: any = doc.data();
      const code = String(d?.materialCode ?? '').trim().toUpperCase();
      if (!code) continue;
      const exportDate = this.toDateUnsafe(d?.exportDate);
      if (!exportDate) continue;
      if (exportDate < start || exportDate > end) continue;
      activityBySku.set(code, (activityBySku.get(code) || 0) + 1);
    }

    return activityBySku;
  }

  /**
   * Ghi đè toàn bộ Aging (một doc): map SKU Bxxxxxx → số tháng aging.
   */
  async replaceMaterialsAging(bySku: Record<string, number>, meta?: { sourceName?: string }): Promise<{ saved: number }> {
    const cleaned: Record<string, number> = {};
    for (const [rawK, rawV] of Object.entries(bySku)) {
      const s = String(rawK || '').trim().toUpperCase();
      const bm = /B(\d{6})/.exec(s);
      const sku = bm ? `B${bm[1]}` : '';
      if (!sku) continue;
      const n = Number(rawV);
      if (!Number.isFinite(n)) continue;
      cleaned[sku] = n;
    }
    const ref = this.db.collection(this.AGING_COLLECTION).doc(this.AGING_DOC_ID);
    await ref.set(
      {
        bySku: cleaned,
        skuCount: Object.keys(cleaned).length,
        sourceName: String(meta?.sourceName ?? ''),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      },
      { merge: false }
    );
    return { saved: Object.keys(cleaned).length };
  }

  async loadMaterialsAging(): Promise<Map<string, number>> {
    const snap = await this.db.collection(this.AGING_COLLECTION).doc(this.AGING_DOC_ID).get();
    if (!snap.exists) return new Map();
    const d: any = snap.data();
    const raw = d?.bySku && typeof d.bySku === 'object' ? d.bySku : {};
    const m = new Map<string, number>();
    for (const [k, v] of Object.entries(raw)) {
      const sku = String(k || '').trim().toUpperCase();
      const n = Number(v);
      if (sku && Number.isFinite(n)) m.set(sku, n);
    }
    return m;
  }

  /** Bảng kê nhập: thêm từng dòng (giống xuất kho — không ghi đè collection). */
  async saveImportManifest(rows: ImportManifestRow[], meta?: { sourceName?: string }): Promise<{ saved: number }> {
    const db = this.db;
    const col = db.collection(this.IMPORT_MANIFEST_COLLECTION);
    const batchSize = 450;
    let saved = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);
      const batch = db.batch();

      for (const r of chunk) {
        const materialCode = String(r.materialCode || '').trim().toUpperCase();
        if (!materialCode) continue;
        const importDate = r.importDate instanceof Date ? r.importDate : new Date(r.importDate as any);
        if (Number.isNaN(importDate.getTime())) continue;

        const ref = col.doc();
        batch.set(ref, {
          materialCode,
          importDate: firebase.firestore.Timestamp.fromDate(importDate),
          sourceName: String(meta?.sourceName ?? ''),
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        saved++;
      }

      await batch.commit();
    }

    return { saved };
  }
}
