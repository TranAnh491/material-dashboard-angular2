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

export type LocationInventoryDetailLine = {
  id: string;
  factory: FactoryCode;
  materialCode: string;
  poNumber: string;
  imd: string;
  location: string;
  stock: number;
};

export type InventoryLastAction = {
  actionType: 'Inbound' | 'Outbound' | 'Change location' | 'Update';
  actionLabel: string;
  performedBy: string;
  actionAt: Date | null;
};

/** Dòng hiển thị Last Action — tối đa 100 mã gần nhất. */
export type RecentActionMaterialRow = LocationInventoryDetailLine & {
  lastActionLabel: string;
  lastActionBy: string;
  lastActionAt: Date | null;
};

/** Một hoạt động scan của nhân viên (ASP) trong ngày — gộp từ nhiều tab. */
export type EmployeeScanActivityRow = {
  id: string;
  at: Date | null;
  tab: string;
  action: string;
  factory: string;
  detail: string;
};

type RawActionEvent = {
  materialCode: string;
  poNumber: string;
  imd: string;
  factory: FactoryCode;
  actionLabel: string;
  performedBy: string;
  actionAt: Date | null;
  inventoryDocId?: string;
  locationHint?: string;
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

  /** Vị trí kho RM: ưu tiên `location`, fallback `viTri` (dữ liệu cũ). */
  private extractRmInventoryLocation(d: any): string {
    return String(d?.location ?? d?.viTri ?? '').trim().toUpperCase();
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

        const loc = this.extractRmInventoryLocation(d);
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
        const loc = this.extractRmInventoryLocation(d);
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

  private computeInventoryStock(d: Record<string, unknown>): number {
    if (d['stock'] != null && Number.isFinite(Number(d['stock']))) {
      return Number(d['stock']);
    }
    const openingStock =
      d['openingStock'] !== null && d['openingStock'] !== undefined ? Number(d['openingStock']) : 0;
    const quantity = Number(d['quantity']) || 0;
    const exported = Number(d['exported']) || 0;
    const xt = Number(d['xt']) || 0;
    return openingStock + quantity - exported - xt;
  }

  private mapInventoryDetailLine(
    docId: string,
    d: Record<string, unknown>,
    factory: FactoryCode
  ): LocationInventoryDetailLine {
    const loc = this.extractRmInventoryLocation(d);
    return {
      id: docId,
      factory,
      materialCode: String(d['materialCode'] ?? '').trim().toUpperCase(),
      poNumber: String(d['poNumber'] ?? '').trim(),
      imd: String(d['batchNumber'] ?? '').trim(),
      location: loc || '—',
      stock: this.computeInventoryStock(d)
    };
  }

  /** Tải tất cả dòng inventory-materials tại một vị trí (ASM1 + ASM2). */
  async loadInventoryLinesAtLocation(
    locationKey: string,
    displayLocation: string,
    factories: FactoryCode[] = ['ASM1', 'ASM2']
  ): Promise<LocationInventoryDetailLine[]> {
    const isNone = locationKey === '__NONE__';
    const targetLoc = String(displayLocation || '').trim().toUpperCase();
    const lines: LocationInventoryDetailLine[] = [];

    for (const factory of factories) {
      if (isNone) {
        const docs = await this.pageByDocId('inventory-materials', (ref) => ref.where('factory', '==', factory), (doc) => doc);
        for (const doc of docs as firebase.firestore.QueryDocumentSnapshot[]) {
          const d = doc.data() as Record<string, unknown>;
          const loc = this.extractRmInventoryLocation(d);
          if (loc) continue;
          const line = this.mapInventoryDetailLine(doc.id, d, factory);
          if (line.materialCode) lines.push(line);
        }
        continue;
      }

      const queries = [
        this.db.collection('inventory-materials').where('factory', '==', factory).where('location', '==', targetLoc).get(),
        this.db.collection('inventory-materials').where('factory', '==', factory).where('viTri', '==', targetLoc).get()
      ];
      const snaps = await Promise.allSettled(queries);
      const seen = new Set<string>();
      for (const r of snaps) {
        if (r.status !== 'fulfilled') continue;
        for (const doc of r.value.docs) {
          if (seen.has(doc.id)) continue;
          seen.add(doc.id);
          const d = doc.data() as Record<string, unknown>;
          const line = this.mapInventoryDetailLine(doc.id, d, factory);
          if (line.materialCode) lines.push(line);
        }
      }
    }

    lines.sort((a, b) => {
      const c = a.materialCode.localeCompare(b.materialCode);
      if (c !== 0) return c;
      const p = a.poNumber.localeCompare(b.poNumber);
      if (p !== 0) return p;
      return a.imd.localeCompare(b.imd);
    });
    return lines;
  }

  private pickLatestBagEvent(docs: firebase.firestore.QueryDocumentSnapshot[]): {
    at: Date | null;
    type: InventoryLastAction['actionType'];
    label: string;
  } | null {
    let best: { at: Date | null; type: InventoryLastAction['actionType']; label: string } | null = null;
    for (const doc of docs) {
      const d = doc.data() as Record<string, unknown>;
      const at = this.toDateUnsafe(d['createdAt']);
      const ev = String(d['event'] ?? '').trim().toUpperCase();
      let type: InventoryLastAction['actionType'] = 'Update';
      let label = 'Cập nhật';
      if (ev === 'NHẬP' || ev === 'NHAP') {
        type = 'Inbound';
        label = 'Inbound (Nhập kho)';
      } else if (ev === 'XUẤT' || ev === 'XUAT') {
        type = 'Outbound';
        label = 'Outbound (Xuất kho)';
      }
      if (!best || ((at?.getTime() ?? 0) > (best.at?.getTime() ?? 0))) {
        best = { at, type, label };
      }
    }
    return best;
  }

  /** Last action: rm-bag-history (NHẬP/XUẤT) vs material-location-history (đổi vị trí). */
  async loadLastActionForInventoryLine(line: LocationInventoryDetailLine): Promise<InventoryLastAction> {
    let modifiedBy = '';
    let modifiedAt: Date | null = null;
    let source = '';
    try {
      const invSnap = await this.db.collection('inventory-materials').doc(line.id).get();
      const inv = (invSnap.data() || {}) as Record<string, unknown>;
      modifiedBy = String(inv['modifiedBy'] ?? '').trim();
      modifiedAt = this.toDateUnsafe(inv['lastModified']) || this.toDateUnsafe(inv['lastUpdated']);
      source = String(inv['source'] ?? '').trim().toLowerCase();
    } catch {
      /* ignore */
    }

    const [bagSnap, locSnap] = await Promise.all([
      this.db.collection('rm-bag-history').where('inventoryDocId', '==', line.id).limit(15).get().catch(() => null),
      this.db.collection('material-location-history').where('materialId', '==', line.id).limit(15).get().catch(() => null)
    ]);

    const bagBest = bagSnap ? this.pickLatestBagEvent(bagSnap.docs) : null;
    let locBest: { at: Date | null; by: string } | null = null;
    if (locSnap) {
      for (const doc of locSnap.docs) {
        const d = doc.data() as Record<string, unknown>;
        const at = this.toDateUnsafe(d['changedAt']);
        const by = String(d['changedBy'] ?? '').trim();
        if (!locBest || ((at?.getTime() ?? 0) > (locBest.at?.getTime() ?? 0))) {
          locBest = { at, by };
        }
      }
    }

    const bagMs = bagBest?.at?.getTime() ?? -1;
    const locMs = locBest?.at?.getTime() ?? -1;

    if (bagMs >= 0 && bagMs >= locMs) {
      return {
        actionType: bagBest!.type,
        actionLabel: bagBest!.label,
        performedBy: modifiedBy || '—',
        actionAt: bagBest!.at
      };
    }
    if (locMs >= 0) {
      return {
        actionType: 'Change location',
        actionLabel: 'Change location (Đổi vị trí)',
        performedBy: locBest!.by || modifiedBy || '—',
        actionAt: locBest!.at
      };
    }

    if (source === 'inbound') {
      return {
        actionType: 'Inbound',
        actionLabel: 'Inbound (Nhập kho)',
        performedBy: modifiedBy || '—',
        actionAt: modifiedAt
      };
    }

    return {
      actionType: 'Update',
      actionLabel: modifiedAt ? 'Cập nhật tồn' : '—',
      performedBy: modifiedBy || '—',
      actionAt: modifiedAt
    };
  }

  async loadLastActionsForInventoryLines(
    lines: LocationInventoryDetailLine[],
    onProgress?: (done: number, total: number) => void
  ): Promise<Map<string, InventoryLastAction>> {
    const out = new Map<string, InventoryLastAction>();
    const chunkSize = 12;
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunk = lines.slice(i, i + chunkSize);
      const pairs = await Promise.all(
        chunk.map(async (line) => [line.id, await this.loadLastActionForInventoryLine(line)] as const)
      );
      for (const [id, action] of pairs) out.set(id, action);
      onProgress?.(Math.min(i + chunk.length, lines.length), lines.length);
    }
    return out;
  }

  private bagEventLabel(ev: string): string | null {
    const u = (ev || '').trim().toUpperCase();
    if (u === 'NHẬP' || u === 'NHAP') return 'Inbound (Nhập kho)';
    if (u === 'XUẤT' || u === 'XUAT') return 'Outbound (Xuất kho)';
    if (u === 'TỒN' || u === 'TON') return null;
    return null;
  }

  private async fetchRecentBagActionEvents(maxDocs: number): Promise<RawActionEvent[]> {
    const out: RawActionEvent[] = [];
    try {
      const snap = await this.db
        .collection('rm-bag-history')
        .orderBy('createdAt', 'desc')
        .limit(maxDocs)
        .get();
      for (const doc of snap.docs) {
        const d = doc.data() as Record<string, unknown>;
        const label = this.bagEventLabel(String(d['event'] ?? ''));
        if (!label) continue;
        const materialCode = String(d['materialCode'] ?? '').trim().toUpperCase();
        if (!materialCode) continue;
        const factoryRaw = String(d['factory'] ?? 'ASM1').trim().toUpperCase();
        const factory: FactoryCode = factoryRaw === 'ASM2' ? 'ASM2' : 'ASM1';
        out.push({
          materialCode,
          poNumber: String(d['poNumber'] ?? '').trim(),
          imd: String(d['imd'] ?? '').trim(),
          factory,
          actionLabel: label,
          performedBy: '',
          actionAt: this.toDateUnsafe(d['createdAt']),
          inventoryDocId: String(d['inventoryDocId'] ?? '').trim() || undefined
        });
      }
    } catch (e) {
      console.warn('[MaterialsDashboard] rm-bag-history recent fetch failed', e);
    }
    return out;
  }

  private async fetchRecentLocationChangeEvents(maxDocs: number): Promise<RawActionEvent[]> {
    const mapDocs = (docs: firebase.firestore.QueryDocumentSnapshot[]): RawActionEvent[] => {
      const rows: RawActionEvent[] = [];
      for (const doc of docs) {
        const d = doc.data() as Record<string, unknown>;
        const materialCode = String(d['materialCode'] ?? '').trim().toUpperCase();
        if (!materialCode) continue;
        const factoryRaw = String(d['factory'] ?? 'ASM1').trim().toUpperCase();
        const factory: FactoryCode = factoryRaw === 'ASM2' ? 'ASM2' : 'ASM1';
        rows.push({
          materialCode,
          poNumber: String(d['poNumber'] ?? '').trim(),
          imd: '',
          factory,
          actionLabel: 'Change location (Đổi vị trí)',
          performedBy: String(d['changedBy'] ?? '').trim(),
          actionAt: this.toDateUnsafe(d['changedAt']),
          inventoryDocId: String(d['materialId'] ?? '').trim() || undefined,
          locationHint: String(d['toLocation'] ?? '').trim().toUpperCase() || undefined
        });
      }
      return rows;
    };

    try {
      const snap = await this.db
        .collection('material-location-history')
        .orderBy('changedAt', 'desc')
        .limit(maxDocs)
        .get();
      return mapDocs(snap.docs);
    } catch (e) {
      console.warn('[MaterialsDashboard] material-location-history orderBy failed, fallback', e);
      try {
        const snap = await this.db.collection('material-location-history').limit(maxDocs).get();
        const rows = mapDocs(snap.docs);
        rows.sort((a, b) => (b.actionAt?.getTime() ?? 0) - (a.actionAt?.getTime() ?? 0));
        return rows;
      } catch (e2) {
        console.warn('[MaterialsDashboard] material-location-history fallback failed', e2);
        return [];
      }
    }
  }

  private pickTopUniqueMaterialActions(events: RawActionEvent[], limit: number): RawActionEvent[] {
    const sorted = [...events].sort((a, b) => (b.actionAt?.getTime() ?? 0) - (a.actionAt?.getTime() ?? 0));
    const picked: RawActionEvent[] = [];
    const seenCodes = new Set<string>();
    for (const ev of sorted) {
      if (!ev.materialCode || seenCodes.has(ev.materialCode)) continue;
      seenCodes.add(ev.materialCode);
      picked.push(ev);
      if (picked.length >= limit) break;
    }
    return picked;
  }

  private async enrichActionEvent(ev: RawActionEvent): Promise<RecentActionMaterialRow> {
    let line: LocationInventoryDetailLine | null = null;
    let modifiedBy = '';
    if (ev.inventoryDocId) {
      try {
        const snap = await this.db.collection('inventory-materials').doc(ev.inventoryDocId).get();
        if (snap.exists) {
          const d = snap.data() as Record<string, unknown>;
          const f = String(d['factory'] ?? ev.factory).trim().toUpperCase() === 'ASM2' ? 'ASM2' : 'ASM1';
          line = this.mapInventoryDetailLine(snap.id, d, f);
          modifiedBy = String(d['modifiedBy'] ?? '').trim();
        }
      } catch {
        /* ignore */
      }
    }

    const location = line?.location && line.location !== '—' ? line.location : ev.locationHint || '—';
    return {
      id: line?.id || ev.inventoryDocId || '',
      factory: line?.factory || ev.factory,
      materialCode: ev.materialCode,
      poNumber: line?.poNumber || ev.poNumber || '—',
      imd: line?.imd || ev.imd || '—',
      location,
      stock: line?.stock ?? 0,
      lastActionLabel: ev.actionLabel,
      lastActionBy: ev.performedBy || modifiedBy || '—',
      lastActionAt: ev.actionAt
    };
  }

  /** 100 mã hàng được đổi vị trí gần nhất (material-location-history). */
  async loadTopRecentMaterialActions(limit = 100): Promise<RecentActionMaterialRow[]> {
    const fetchEach = Math.max(limit * 8, 800);
    const locEvents = await this.fetchRecentLocationChangeEvents(fetchEach);
    const top = this.pickTopUniqueMaterialActions(locEvents, limit);
    const rows: RecentActionMaterialRow[] = [];
    for (const ev of top) {
      rows.push(await this.enrichActionEvent(ev));
    }
    rows.sort((a, b) => (b.lastActionAt?.getTime() ?? 0) - (a.lastActionAt?.getTime() ?? 0));
    return rows;
  }

  /** Chuẩn hóa mã ASP (VD: ASP0701). */
  normalizeEmployeeId(raw: string): string | null {
    const compact = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
    const m = /^ASP(\d{4})$/.exec(compact);
    return m ? `ASP${m[1]}` : null;
  }

  private todayRangeLocal(): { start: Date; end: Date } {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  private isWithinToday(d: Date | null, start: Date, end: Date): boolean {
    if (!d || Number.isNaN(d.getTime())) return false;
    const t = d.getTime();
    return t >= start.getTime() && t <= end.getTime();
  }

  private matchEmployeeId(field: string, empId: string): boolean {
    const f = String(field || '').trim().toUpperCase();
    if (!f) return false;
    if (f === empId) return true;
    const asp = f.match(/ASP\d{4}/);
    return asp ? asp[0] === empId : false;
  }

  private tsFromDate(d: Date): firebase.firestore.Timestamp {
    return firebase.firestore.Timestamp.fromDate(d);
  }

  private pushActivity(
    out: EmployeeScanActivityRow[],
    row: Omit<EmployeeScanActivityRow, 'id'> & { id?: string }
  ): void {
    const atKey = row.at?.getTime() ?? 0;
    const id = row.id || `${row.tab}|${atKey}|${row.detail}`.slice(0, 200);
    out.push({ ...row, id });
  }

  private async fetchOutboundActivitiesToday(
    empId: string,
    start: Date,
    end: Date
  ): Promise<EmployeeScanActivityRow[]> {
    const out: EmployeeScanActivityRow[] = [];
    try {
      const snap = await this.db.collection('outbound-materials').where('employeeId', '==', empId).get();
      for (const doc of snap.docs) {
        const d = doc.data() as Record<string, unknown>;
        const at =
          this.toDateUnsafe(d['exportDate']) ||
          this.toDateUnsafe(d['createdAt']) ||
          this.toDateUnsafe(d['createdDate']);
        if (!this.isWithinToday(at, start, end)) continue;
        const code = String(d['materialCode'] ?? '').trim().toUpperCase();
        const po = String(d['poNumber'] ?? '').trim();
        const qty = d['exportedQuantity'] ?? d['quantity'] ?? '';
        const lsx = String(d['productionOrder'] ?? '').trim();
        const factory = String(d['factory'] ?? 'ASM1').trim().toUpperCase() === 'ASM2' ? 'ASM2' : 'ASM1';
        const parts = [code, po ? `PO ${po}` : '', lsx ? `LSX ${lsx}` : '', qty !== '' ? `SL ${qty}` : ''].filter(Boolean);
        this.pushActivity(out, {
          at,
          tab: 'Outbound ASM1',
          action: 'Xuất kho',
          factory,
          detail: parts.join(' · ') || doc.id
        });
      }
    } catch (e) {
      console.warn('[MaterialsDashboard] outbound activities today failed', e);
    }
    return out;
  }

  private async fetchInboundActivitiesToday(
    empId: string,
    start: Date,
    end: Date
  ): Promise<EmployeeScanActivityRow[]> {
    const out: EmployeeScanActivityRow[] = [];
    try {
      const snap = await this.db.collection('inbound-materials').where('employeeIds', 'array-contains', empId).get();
      for (const doc of snap.docs) {
        const d = doc.data() as Record<string, unknown>;
        const at =
          this.toDateUnsafe(d['batchEndTime']) ||
          this.toDateUnsafe(d['batchStartTime']) ||
          this.toDateUnsafe(d['updatedAt']) ||
          this.toDateUnsafe(d['createdAt']);
        if (!this.isWithinToday(at, start, end)) continue;
        const factory = String(d['factory'] ?? 'ASM1').trim().toUpperCase() === 'ASM2' ? 'ASM2' : 'ASM1';
        const code = String(d['materialCode'] ?? '').trim().toUpperCase();
        const po = String(d['poNumber'] ?? '').trim();
        const batch = String(d['batchNumber'] ?? d['batchId'] ?? '').trim();
        const parts = [code, po ? `PO ${po}` : '', batch ? `Lô ${batch}` : ''].filter(Boolean);
        this.pushActivity(out, {
          at,
          tab: 'Inbound ASM1',
          action: 'Kiểm nhập kho',
          factory,
          detail: parts.join(' · ') || doc.id
        });
      }
    } catch (e) {
      console.warn('[MaterialsDashboard] inbound activities today failed', e);
    }
    return out;
  }

  private async fetchWorkOrderScansToday(
    empId: string,
    start: Date,
    end: Date
  ): Promise<EmployeeScanActivityRow[]> {
    const out: EmployeeScanActivityRow[] = [];
    const startTs = this.tsFromDate(start);
    try {
      const snap = await this.db
        .collection('workOrderScans')
        .where('scannedAt', '>=', startTs)
        .orderBy('scannedAt', 'desc')
        .limit(800)
        .get();
      for (const doc of snap.docs) {
        const d = doc.data() as Record<string, unknown>;
        const scannedBy = String(d['scannedBy'] ?? d['employeeId'] ?? '').trim();
        if (!this.matchEmployeeId(scannedBy, empId)) continue;
        const at = this.toDateUnsafe(d['scannedAt']) || this.toDateUnsafe(d['createdAt']);
        if (!this.isWithinToday(at, start, end)) continue;
        const lsx = String(d['lsx'] ?? '').trim();
        const factory = String(d['factory'] ?? '—').trim();
        const qty = d['quantity'] ?? '';
        const parts = [lsx ? `LSX ${lsx}` : '', qty !== '' ? `SL ${qty}` : ''].filter(Boolean);
        this.pushActivity(out, {
          at,
          tab: 'Work Order',
          action: 'Scan LSX',
          factory: factory || '—',
          detail: parts.join(' · ') || doc.id
        });
      }
    } catch (e) {
      console.warn('[MaterialsDashboard] workOrderScans today failed, fallback', e);
      try {
        const snap = await this.db.collection('workOrderScans').orderBy('scannedAt', 'desc').limit(1200).get();
        for (const doc of snap.docs) {
          const d = doc.data() as Record<string, unknown>;
          const scannedBy = String(d['scannedBy'] ?? d['employeeId'] ?? '').trim();
          if (!this.matchEmployeeId(scannedBy, empId)) continue;
          const at = this.toDateUnsafe(d['scannedAt']) || this.toDateUnsafe(d['createdAt']);
          if (!this.isWithinToday(at, start, end)) continue;
          const lsx = String(d['lsx'] ?? '').trim();
          this.pushActivity(out, {
            at,
            tab: 'Work Order',
            action: 'Scan LSX',
            factory: String(d['factory'] ?? '—').trim() || '—',
            detail: lsx ? `LSX ${lsx}` : doc.id
          });
        }
      } catch (e2) {
        console.warn('[MaterialsDashboard] workOrderScans fallback failed', e2);
      }
    }
    return out;
  }

  private async fetchLocationChangesToday(
    empId: string,
    start: Date,
    end: Date
  ): Promise<EmployeeScanActivityRow[]> {
    const out: EmployeeScanActivityRow[] = [];
    const startTs = this.tsFromDate(start);
    try {
      const snap = await this.db
        .collection('material-location-history')
        .where('changedAt', '>=', startTs)
        .orderBy('changedAt', 'desc')
        .limit(800)
        .get();
      for (const doc of snap.docs) {
        const d = doc.data() as Record<string, unknown>;
        const changedBy = String(d['changedBy'] ?? '').trim();
        if (!this.matchEmployeeId(changedBy, empId)) continue;
        const at = this.toDateUnsafe(d['changedAt']);
        if (!this.isWithinToday(at, start, end)) continue;
        const factory = String(d['factory'] ?? 'ASM1').trim().toUpperCase() === 'ASM2' ? 'ASM2' : 'ASM1';
        const code = String(d['materialCode'] ?? '').trim().toUpperCase();
        const toLoc = String(d['toLocation'] ?? '').trim().toUpperCase();
        const fromLoc = String(d['fromLocation'] ?? '').trim().toUpperCase();
        const locPart = toLoc ? `${fromLoc || '—'} → ${toLoc}` : '';
        this.pushActivity(out, {
          at,
          tab: 'Location',
          action: 'Đổi vị trí',
          factory,
          detail: [code, locPart].filter(Boolean).join(' · ') || doc.id
        });
      }
    } catch (e) {
      console.warn('[MaterialsDashboard] location changes today failed', e);
    }
    return out;
  }

  private async fetchStockCheckSessionsToday(
    empId: string,
    start: Date,
    end: Date
  ): Promise<EmployeeScanActivityRow[]> {
    const out: EmployeeScanActivityRow[] = [];
    const startTs = this.tsFromDate(start);
    try {
      const snap = await this.db
        .collection('stock-check-check-sessions')
        .where('employeeId', '==', empId)
        .where('createdAt', '>=', startTs)
        .get();
      for (const doc of snap.docs) {
        const d = doc.data() as Record<string, unknown>;
        const at = this.toDateUnsafe(d['createdAt']);
        if (!this.isWithinToday(at, start, end)) continue;
        const factory = String(d['factory'] ?? 'ASM1').trim().toUpperCase() === 'ASM2' ? 'ASM2' : 'ASM1';
        const mode = String(d['mode'] ?? '').trim();
        const loc = String(d['scanLocation'] ?? '').trim().toUpperCase();
        const total = d['scannedTotal'] ?? 0;
        const code = String(d['materialCode'] ?? '').trim().toUpperCase();
        const parts = [
          mode ? `Mode ${mode}` : '',
          loc ? `Vị trí ${loc}` : '',
          code ? `Mã ${code}` : '',
          `Tổng scan ${total}`
        ].filter(Boolean);
        this.pushActivity(out, {
          at,
          tab: 'Stock Check',
          action: 'Phiên kiểm kê',
          factory,
          detail: parts.join(' · ')
        });
      }
    } catch (e) {
      console.warn('[MaterialsDashboard] stock-check sessions today failed', e);
    }
    return out;
  }

  private async fetchStockCheckLineScansToday(
    empId: string,
    start: Date,
    end: Date
  ): Promise<EmployeeScanActivityRow[]> {
    const out: EmployeeScanActivityRow[] = [];
    const startTs = this.tsFromDate(start);
    for (const factory of ['ASM1', 'ASM2'] as FactoryCode[]) {
      try {
        const snap = await this.db
          .collection('stock-check-history')
          .where('factory', '==', factory)
          .where('lastUpdated', '>=', startTs)
          .get();
        for (const doc of snap.docs) {
          const d = doc.data() as Record<string, unknown>;
          const code = String(d['materialCode'] ?? '').trim().toUpperCase();
          const po = String(d['poNumber'] ?? '').trim();
          const imd = String(d['imd'] ?? '').trim();
          const history = Array.isArray(d['history']) ? (d['history'] as Record<string, unknown>[]) : [];
          for (let i = 0; i < history.length; i++) {
            const h = history[i];
            const idCheck = String(h['idCheck'] ?? '').trim().toUpperCase();
            if (idCheck !== empId) continue;
            const at = this.toDateUnsafe(h['dateCheck']) || this.toDateUnsafe(h['updatedAt']);
            if (!this.isWithinToday(at, start, end)) continue;
            const qty = h['qtyCheck'] ?? '';
            const bag = String(h['bag'] ?? '').trim();
            const loc = String(h['location'] ?? '').trim().toUpperCase();
            const parts = [code, po ? `PO ${po}` : '', imd ? `IMD ${imd}` : '', qty !== '' ? `SL ${qty}` : '', bag ? `Bag ${bag}` : '', loc ? `Vị trí ${loc}` : ''].filter(Boolean);
            this.pushActivity(out, {
              id: `${doc.id}|${i}|${at?.getTime() ?? 0}`,
              at,
              tab: 'Stock Check',
              action: 'Kiểm mã',
              factory,
              detail: parts.join(' · ')
            });
          }
        }
      } catch (e) {
        console.warn(`[MaterialsDashboard] stock-check-history today (${factory}) failed`, e);
      }
    }
    return out;
  }

  private async fetchLabelReprintToday(
    empId: string,
    start: Date,
    end: Date
  ): Promise<EmployeeScanActivityRow[]> {
    const out: EmployeeScanActivityRow[] = [];
    const startTs = this.tsFromDate(start);
    try {
      const snap = await this.db.collection('label-reprint-flags').where('reprintedAt', '>=', startTs).get();
      for (const doc of snap.docs) {
        const d = doc.data() as Record<string, unknown>;
        const by = String(d['reprintedBy'] ?? '').trim();
        if (!this.matchEmployeeId(by, empId)) continue;
        const at = this.toDateUnsafe(d['reprintedAt']);
        if (!this.isWithinToday(at, start, end)) continue;
        const factory = String(d['factory'] ?? 'ASM1').trim().toUpperCase() === 'ASM2' ? 'ASM2' : 'ASM1';
        const code = String(d['materialCode'] ?? '').trim().toUpperCase();
        const po = String(d['poNumber'] ?? '').trim();
        const source = String(d['source'] ?? '').trim();
        const parts = [code, po ? `PO ${po}` : '', source ? source : ''].filter(Boolean);
        this.pushActivity(out, {
          at,
          tab: 'Materials ASM1',
          action: 'In lại tem',
          factory,
          detail: parts.join(' · ') || doc.id
        });
      }
    } catch (e) {
      console.warn('[MaterialsDashboard] label-reprint today failed', e);
    }
    return out;
  }

  /**
   * Gộp scan/hoạt động của một mã ASP trong ngày hôm nay từ các tab:
   * Outbound, Inbound, Work Order, Location, Stock Check, Materials (in lại tem).
   * Print Label chưa lưu mã ASP lên Firestore — không có trong kết quả.
   */
  async loadEmployeeScanActivitiesToday(employeeIdRaw: string): Promise<EmployeeScanActivityRow[]> {
    const empId = this.normalizeEmployeeId(employeeIdRaw);
    if (!empId) return [];

    const { start, end } = this.todayRangeLocal();
    const chunks = await Promise.all([
      this.fetchOutboundActivitiesToday(empId, start, end),
      this.fetchInboundActivitiesToday(empId, start, end),
      this.fetchWorkOrderScansToday(empId, start, end),
      this.fetchLocationChangesToday(empId, start, end),
      this.fetchStockCheckSessionsToday(empId, start, end),
      this.fetchStockCheckLineScansToday(empId, start, end),
      this.fetchLabelReprintToday(empId, start, end)
    ]);

    const merged = chunks.flat();
    merged.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
    return merged;
  }
}
