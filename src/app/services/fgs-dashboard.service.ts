import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

export type FactoryCode = 'ASM1' | 'ASM2';

export type FgExportManifestRow = {
  materialCode: string;
  exportDate: Date;
  quantity: number;
};

export type FgImportManifestRow = {
  materialCode: string;
  importDate: Date;
};

@Injectable({ providedIn: 'root' })
export class FgsDashboardService {
  constructor(private firestore: AngularFirestore) {}

  readonly EXPORT_MANIFEST_COLLECTION = 'fgs-export-manifest';
  readonly IMPORT_MANIFEST_COLLECTION = 'fgs-import-manifest';
  readonly AGING_COLLECTION = 'fgs-dashboard-aging';
  readonly AGING_DOC_ID = 'current';

  private get db(): firebase.firestore.Firestore {
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

  /** Cột vị trí giống `fg-inventory`: `location` hoặc legacy `viTri`, mặc định `Temporary` khi trống. */
  private extractFgInventoryLocation(d: any): string {
    const raw = d?.location ?? d?.viTri;
    const s = String(raw ?? '').trim();
    return s || 'Temporary';
  }

  /** Mã TP chuẩn hóa: trim + upper; bỏ rỗng. */
  normalizeFgMaterialCode(raw: unknown): string | null {
    const t = String(raw ?? '').trim().toUpperCase();
    return t || null;
  }

  async loadMasterFgMaterialCodes(factories: FactoryCode[]): Promise<Set<string>> {
    const set = new Set<string>();
    for (const f of factories) {
      const rows = await this.pageByDocId(
        'fg-inventory',
        (ref) => ref.where('factory', '==', f),
        (doc) => {
          const d: any = doc.data();
          return this.normalizeFgMaterialCode(d?.materialCode ?? d?.maTP);
        }
      );
      for (const code of rows) if (code) set.add(code);
    }
    return set;
  }

  async loadMasterFgMaterialIndex(
    factories: FactoryCode[]
  ): Promise<{ skus: Set<string>; locationBySku: Map<string, string> }> {
    const skus = new Set<string>();
    const countsBySku = new Map<string, Map<string, number>>();

    for (const f of factories) {
      const docs = await this.pageByDocId('fg-inventory', (ref) => ref.where('factory', '==', f), (doc) => doc);
      for (const doc of docs as any[]) {
        const d: any = doc.data();
        const code = this.normalizeFgMaterialCode(d?.materialCode ?? d?.maTP);
        if (!code) continue;
        skus.add(code);

        const loc = this.extractFgInventoryLocation(d).trim().toUpperCase();
        if (!loc) continue;
        let lc = countsBySku.get(code);
        if (!lc) {
          lc = new Map<string, number>();
          countsBySku.set(code, lc);
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

  async loadMasterFgLocations(factories: FactoryCode[]): Promise<Map<string, string>> {
    const { locationBySku } = await this.loadMasterFgMaterialIndex(factories);
    return locationBySku;
  }

  async saveExportManifest(rows: FgExportManifestRow[], meta?: { sourceName?: string }): Promise<{ saved: number }> {
    const db = this.db;
    const col = db.collection(this.EXPORT_MANIFEST_COLLECTION);
    const batchSize = 450;
    let saved = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);
      const batch = db.batch();

      for (const r of chunk) {
        const materialCode = this.normalizeFgMaterialCode(r.materialCode);
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

  async saveImportManifest(rows: FgImportManifestRow[], meta?: { sourceName?: string }): Promise<{ saved: number }> {
    const db = this.db;
    const col = db.collection(this.IMPORT_MANIFEST_COLLECTION);
    const batchSize = 450;
    let saved = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const chunk = rows.slice(i, i + batchSize);
      const batch = db.batch();

      for (const r of chunk) {
        const materialCode = this.normalizeFgMaterialCode(r.materialCode);
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

  private addActivity(map: Map<string, number>, code: string): void {
    const c = this.normalizeFgMaterialCode(code);
    if (!c) return;
    map.set(c, (map.get(c) || 0) + 1);
  }

  async loadManifestActivity(params: { start: Date; end: Date }): Promise<Map<string, number>> {
    const start = params.start;
    const end = params.end;
    const activityBySku = new Map<string, number>();

    await this.loadExportManifestActivityInto(this.EXPORT_MANIFEST_COLLECTION, 'exportDate', start, end, activityBySku);
    await this.mergeFgExportCollectionActivity(start, end, activityBySku);

    return activityBySku;
  }

  private async loadExportManifestActivityInto(
    collection: string,
    dateField: 'exportDate',
    start: Date,
    end: Date,
    activityBySku: Map<string, number>
  ): Promise<void> {
    try {
      const batchSize = 10000;
      const colRef = this.db.collection(collection);
      let last: firebase.firestore.QueryDocumentSnapshot | null = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        let q: firebase.firestore.Query = colRef
          .where(dateField, '>=', firebase.firestore.Timestamp.fromDate(start))
          .where(dateField, '<=', firebase.firestore.Timestamp.fromDate(end))
          .orderBy(dateField, 'asc')
          .limit(batchSize);
        if (last) q = q.startAfter(last);

        const snap = await q.get();
        const docs = snap.docs;
        for (const doc of docs) {
          const d: any = doc.data();
          this.addActivity(activityBySku, d?.materialCode);
        }

        if (docs.length < batchSize) break;
        last = docs[docs.length - 1];
      }
    } catch (e) {
      console.warn('[FgsDashboard] manifest range query failed, fallback', e);
      const docs = await this.pageByDocId(collection, (ref) => ref, (doc) => doc);
      for (const doc of docs as any[]) {
        const d: any = doc.data();
        const exportDate = this.toDateUnsafe(d?.exportDate);
        if (!exportDate || exportDate < start || exportDate > end) continue;
        this.addActivity(activityBySku, d?.materialCode);
      }
    }
  }

  /** Mỗi dòng fg-export đã duyệt = một lần xuất (giống manifest). Dùng approvedAt hoặc createdAt. */
  private async mergeFgExportCollectionActivity(
    start: Date,
    end: Date,
    activityBySku: Map<string, number>
  ): Promise<void> {
    try {
      const batchSize = 5000;
      const colRef = this.db.collection('fg-export');
      let last: firebase.firestore.QueryDocumentSnapshot | null = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        let q: firebase.firestore.Query = colRef
          .where('approvedAt', '>=', firebase.firestore.Timestamp.fromDate(start))
          .where('approvedAt', '<=', firebase.firestore.Timestamp.fromDate(end))
          .orderBy('approvedAt', 'asc')
          .limit(batchSize);
        if (last) q = q.startAfter(last);

        const snap = await q.get();
        const docs = snap.docs;
        for (const doc of docs) {
          const d: any = doc.data();
          this.addActivity(activityBySku, d?.materialCode);
        }
        if (docs.length < batchSize) break;
        last = docs[docs.length - 1];
      }
    } catch (e) {
      console.warn('[FgsDashboard] fg-export range query failed, fallback full scan', e);
      const docs = await this.pageByDocId('fg-export', (ref) => ref, (doc) => doc);
      for (const doc of docs as any[]) {
        const d: any = doc.data();
        const dt = this.toDateUnsafe(d?.approvedAt) || this.toDateUnsafe(d?.createdAt);
        if (!dt || dt < start || dt > end) continue;
        this.addActivity(activityBySku, d?.materialCode);
      }
    }
  }

  async replaceFgsAging(bySku: Record<string, number>, meta?: { sourceName?: string }): Promise<{ saved: number }> {
    const cleaned: Record<string, number> = {};
    for (const [rawK, rawV] of Object.entries(bySku)) {
      const sku = this.normalizeFgMaterialCode(rawK);
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

  async loadFgsAging(): Promise<Map<string, number>> {
    const snap = await this.db.collection(this.AGING_COLLECTION).doc(this.AGING_DOC_ID).get();
    if (!snap.exists) return new Map();
    const d: any = snap.data();
    const raw = d?.bySku && typeof d.bySku === 'object' ? d.bySku : {};
    const m = new Map<string, number>();
    for (const [k, v] of Object.entries(raw)) {
      const sku = this.normalizeFgMaterialCode(k);
      const n = Number(v);
      if (sku && Number.isFinite(n)) m.set(sku, n);
    }
    return m;
  }
}
