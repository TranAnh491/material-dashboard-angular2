import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';

export interface KkCatalogEntry {
  id: string;
  groupCode: string;
  productType: string;
  /** Vị trí gán trực tiếp trên nhóm mã. Trống thì dùng quy định kệ hoặc vị trí loại hàng. */
  location?: string;
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
   * Vị trí kệ theo đầu mã + khoảng nhóm mã (cùng quy định tab Quản lý nguyên liệu).
   * B018521–B018600 → S03-T5. B009/B016 theo tầng Sxx-T1…T5. B017 không gán kệ sẵn.
   */
  plannedShelfLocForMaterial(materialCode: string | null | undefined): string {
    const group = this.groupCodeFromMaterial(materialCode);
    const match = /^B(\d{3})(\d{3})$/.exec(group);
    if (!match) return '';
    const prefix = `B${match[1]}`;
    const seq = Number(match[2]);
    if (!seq) return '';
    const shelves = this.connectorShelves(prefix);
    if (!shelves) return '';
    for (const shelf of shelves) {
      if (seq < shelf.from || seq > shelf.to) continue;
      for (let level = 1; level <= 5; level++) {
        const from = shelf.from + (level - 1) * shelf.perFloor;
        if (from > shelf.to) break;
        const to = Math.min(from + shelf.perFloor - 1, shelf.to);
        if (seq >= from && seq <= to) return `${shelf.shelf}-T${level}`;
      }
    }
    return '';
  }

  private connectorShelves(prefix: string): Array<{ shelf: string; from: number; to: number; perFloor: number }> | null {
    if (prefix === 'B018') {
      return [
        { shelf: 'S01', from: 1, to: 200, perFloor: 50 },
        { shelf: 'S03', from: 201, to: 600, perFloor: 80 },
        { shelf: 'S05', from: 601, to: 999, perFloor: 80 }
      ];
    }
    if (prefix === 'B016') {
      return [
        { shelf: 'S11', from: 1, to: 250, perFloor: 50 },
        { shelf: 'S12', from: 251, to: 500, perFloor: 50 },
        { shelf: 'S13', from: 501, to: 750, perFloor: 50 },
        { shelf: 'S14', from: 751, to: 999, perFloor: 50 }
      ];
    }
    if (prefix === 'B009') {
      return [
        { shelf: 'S07', from: 1, to: 250, perFloor: 50 },
        { shelf: 'S08', from: 251, to: 500, perFloor: 50 },
        { shelf: 'S09', from: 501, to: 750, perFloor: 50 },
        { shelf: 'S10', from: 751, to: 999, perFloor: 50 }
      ];
    }
    return null;
  }

  /**
   * Vị trí dùng cho tem và quản lý: vị trí lưu trên nhóm mã, không có thì quy định kệ, rồi vị trí loại hàng.
   */
  assignedLocForMaterial(
    materialCode: string,
    typeMap?: Map<string, string>,
    homeLocs?: Map<string, string>
  ): string {
    const group = this.groupCodeFromMaterial(materialCode);
    const saved = this.savedGroupLocation(group);
    if (saved) return saved;
    return this.ruleLocForMaterial(materialCode, this.productTypeOf(materialCode, typeMap), typeMap, homeLocs);
  }

  /** Quy định kệ khi nhóm mã chưa gán vị trí riêng. Dây điện 28 AWG và 30 AWG → R02. */
  ruleLocForMaterial(
    materialCode: string,
    productType?: string,
    typeMap?: Map<string, string>,
    homeLocs?: Map<string, string>
  ): string {
    const planned = this.plannedShelfLocForMaterial(materialCode);
    if (planned) return planned;
    const type = String(productType || '').trim() || this.productTypeOf(materialCode, typeMap);
    const wireShelf = this.wireAwgShelf(type);
    if (wireShelf) return wireShelf;
    return this.homeLocForMaterial(materialCode, typeMap, homeLocs);
  }

  /** Dây điện / dây cáp 28 AWG và 30 AWG nằm ở kệ R02. */
  wireAwgShelf(productType: string | null | undefined): string {
    const u = String(productType || '')
      .toUpperCase()
      .replace(/Đ/g, 'D')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const gauge = /(\d+(?:\.\d+)?)\s*AWG\b/.exec(u) || /\bAWG\s*(\d+(?:\.\d+)?)/.exec(u);
    if (!gauge) return '';
    const n = Number(gauge[1]);
    if (n !== 28 && n !== 30) return '';
    if (!/DAY\s*DIEN|DAY\s*CAP|\bWIRE\b|\bCABLE\b/.test(u)) return '';
    return 'R02';
  }

  /**
   * Danh mục theo dãy kệ: R01, R02… và S01, S02…
   * Vị trí hiệu lực giống Danh mục vị trí (đã lưu, rồi quy định kệ, rồi vị trí loại hàng).
   */
  aisleCatalogRows(
    entries: KkCatalogEntry[],
    typeMap?: Map<string, string>,
    homeLocs?: Map<string, string>,
    rMax = 26,
    sMax = 25
  ): Array<{ shelf: string; groups: string; family: 'R' | 'S' }> {
    const byAisle = new Map<string, string[]>();
    for (const entry of entries) {
      const code = this.normalizeGroupCode(entry.groupCode) || String(entry.groupCode || '').trim().toUpperCase();
      if (!code) continue;
      for (const token of this.locationTokensForEntry(entry, typeMap, homeLocs)) {
        if (this.isStagingLocation(token)) continue;
        const aisle = this.aisleIdFromLocation(token);
        if (!aisle) continue;
        const list = byAisle.get(aisle) || [];
        list.push(code);
        byAisle.set(aisle, list);
      }
    }
    const rows: Array<{ shelf: string; groups: string; family: 'R' | 'S' }> = [];
    for (let n = 1; n <= rMax; n++) {
      const shelf = `R${String(n).padStart(2, '0')}`;
      rows.push({ shelf, family: 'R', groups: this.compressGroupCodes(byAisle.get(shelf) || []) });
    }
    for (let n = 1; n <= sMax; n++) {
      const shelf = `S${String(n).padStart(2, '0')}`;
      rows.push({ shelf, family: 'S', groups: this.compressGroupCodes(byAisle.get(shelf) || []) });
    }
    return rows;
  }

  private locationTokensForEntry(
    entry: KkCatalogEntry,
    typeMap?: Map<string, string>,
    homeLocs?: Map<string, string>
  ): string[] {
    const saved = String(entry.location || '').trim();
    const raw = saved || this.ruleLocForMaterial(entry.groupCode, entry.productType, typeMap, homeLocs);
    return String(raw || '')
      .split(/[\n\r,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** R01-3-4A và R1 → R01. S03-T5 và S23-1 → S03 / S23. */
  private aisleIdFromLocation(loc: string): string {
    const raw = String(loc || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!raw) return '';
    const rack = /^R0*(\d{1,2})(?!\d)/.exec(raw);
    if (rack) return `R${String(Number(rack[1])).padStart(2, '0')}`;
    const shelf = /^S0*(\d{1,2})(?!\d)/.exec(raw);
    if (shelf) return `S${String(Number(shelf[1])).padStart(2, '0')}`;
    return '';
  }

  private isStagingLocation(loc: string): boolean {
    const s = String(loc || '').trim().toUpperCase();
    return s === 'PASS' || s === 'BACKUP' || s.startsWith('PASS ') || s.startsWith('BACKUP ');
  }

  private compressGroupCodes(codes: string[]): string {
    const unique = Array.from(new Set(codes.filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'en', { numeric: true })
    );
    if (!unique.length) return '—';
    const parts: string[] = [];
    let i = 0;
    while (i < unique.length) {
      const start = unique[i];
      const seq = /^([A-Z]+)(\d+)$/.exec(start);
      if (!seq) {
        parts.push(start);
        i += 1;
        continue;
      }
      const prefix = seq[1];
      let n = Number(seq[2]);
      let end = start;
      let j = i + 1;
      while (j < unique.length) {
        const next = /^([A-Z]+)(\d+)$/.exec(unique[j]);
        if (!next || next[1] !== prefix || Number(next[2]) !== n + 1) break;
        end = unique[j];
        n = Number(next[2]);
        j += 1;
      }
      parts.push(start === end ? start : `${start}–${end}`);
      i = j;
    }
    return parts.join('\n');
  }

  savedGroupLocation(groupCode: string | null | undefined): string {
    const group = this.normalizeGroupCode(groupCode) || this.groupCodeFromMaterial(groupCode);
    if (!group) return '';
    const hit = (this.cachedEntries || []).find((entry) => entry.groupCode === group);
    return String(hit?.location || '').trim();
  }

  async saveGroupLocation(groupCode: string, location: string): Promise<void> {
    const code = this.normalizeGroupCode(groupCode);
    if (!code) return;
    const loc = String(location || '').trim().toUpperCase();
    const ref = this.firestore.collection(this.collectionName).doc(this.buildDocId(code)).ref;
    if (!loc) {
      await ref.set(
        {
          location: firebase.firestore.FieldValue.delete(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    } else {
      await ref.set(
        {
          groupCode: code,
          location: loc,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    }
    const hit = (this.cachedEntries || []).find((entry) => entry.groupCode === code);
    if (hit) hit.location = loc;
  }

  /** Vị trí yêu cầu đã gán theo loại hàng (danh mục KK). */
  homeLocForMaterial(
    materialCode: string,
    typeMap?: Map<string, string>,
    homeLocs?: Map<string, string>
  ): string {
    const type = this.productTypeOf(materialCode, typeMap);
    const locs = homeLocs || this.cachedHomeLocs;
    if (!locs) return '';
    if (type) {
      const direct = String(locs.get(type) || '').trim();
      if (direct) return direct;
      const fold = String(type)
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/Đ/g, 'D');
      if (/DAU\s*COT/.test(fold) || /\bTERMINAL/.test(fold)) {
        const grouped = String(locs.get('Đầu cốt (terminal)') || '').trim();
        if (grouped) return grouped;
      }
    }
    return '';
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

  readonly managerCollectionName = 'kk-type-managers';
  private cachedManagers: Map<string, string> | null = null;

  async loadManagers(forceRefresh = false): Promise<Map<string, string>> {
    if (!forceRefresh && this.cachedManagers) return this.cachedManagers;
    const snap = await firstValueFrom(
      this.firestore
        .collection(this.managerCollectionName, (ref) => ref.limit(2000))
        .get()
        .pipe(timeout(20000))
    );
    const map = new Map<string, string>();
    for (const doc of snap?.docs || []) {
      const data = (doc.data() || {}) as Record<string, unknown>;
      const productType = String(data['productType'] || doc.id || '').trim();
      const manager = String(data['manager'] || '').trim();
      if (productType && manager) map.set(productType, manager);
    }
    this.cachedManagers = map;
    return map;
  }

  async saveManager(productType: string, manager: string): Promise<void> {
    const type = String(productType || '').trim();
    if (!type) return;
    const name = String(manager || '').trim();
    const ref = this.firestore.collection(this.managerCollectionName).doc(this.buildHomeLocDocId(type));
    if (!this.cachedManagers) this.cachedManagers = new Map();
    if (!name) {
      await ref.delete();
      this.cachedManagers.delete(type);
      return;
    }
    await ref.set({
      productType: type,
      manager: name,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    this.cachedManagers.set(type, name);
  }

  private mapDoc(id: string, data: Record<string, unknown>): KkCatalogEntry {
    return {
      id,
      groupCode: this.normalizeGroupCode(String(data['groupCode'] || '')),
      productType: String(data['productType'] || '').trim(),
      location: String(data['location'] || '').trim().toUpperCase(),
      updatedAt: (data['updatedAt'] as firebase.firestore.Timestamp | undefined)?.toDate?.()
    };
  }
}
