import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import {
  B037_REQUIRED_LOCATION,
  FRIDGE_NVL_CODES,
  FRIDGE_NVL_TYPE,
  isB037Code,
  isFridgeNvlCode
} from '../pages/materials/fridge-nvl-catalog';
import { shelfGroupRows } from '../pages/materials/shelf-group-catalog';

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

    const [snap] = await Promise.all([
      firstValueFrom(
        this.firestore
          .collection(this.collectionName, (ref) => ref.limit(10000))
          .get()
          .pipe(timeout(30000))
      ),
      this.loadShelfMap()
    ]);

    const items = this.applyFridgeCatalog(
      (snap?.docs || [])
        .map((doc) => this.mapDoc(doc.id, doc.data() as Record<string, unknown>))
        .filter((x) => x.groupCode && x.productType)
    );

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
    if (isFridgeNvlCode(group)) return FRIDGE_NVL_TYPE;
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
    if (isB037Code(group)) return B037_REQUIRED_LOCATION;
    const saved = this.savedGroupLocation(group);
    const base = saved
      || this.ruleLocForMaterial(materialCode, this.productTypeOf(materialCode, typeMap), typeMap, homeLocs);
    return this.withShelfMapLocations(base, materialCode);
  }

  /**
   * Cộng thêm kệ từ Danh mục dãy kệ (kk-shelf-group-map/layout) theo đầu mã (B018, R029…):
   * - đã có vị trí (lưu trên nhóm mã / quy định kệ / vị trí loại hàng) → thêm các kệ R chưa có
   *   (vd B009: S07-T3 → "S07-T3, R15" — được phép ở cả 2 nơi);
   * - chưa có vị trí → lấy mọi kệ R và S ghi đầu mã đó.
   * Bảng dãy kệ nạp cùng loadAll(); chưa nạp thì giữ nguyên vị trí cũ.
   */
  withShelfMapLocations(base: string, codeOrGroup: string | null | undefined): string {
    const head = /^([BR]\d{3})/.exec(String(codeOrGroup || '').trim().toUpperCase());
    const shelves = head ? (this.shelfMapByPrefix?.get(head[1]) || []) : [];
    const tokens = String(base || '')
      .split(/[\n\r,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!shelves.length) return tokens.join(', ');
    if (!tokens.length) return shelves.join(', ');
    const aisles = new Set(tokens.map((t) => this.aisleIdFromLocation(t)).filter(Boolean));
    for (const shelf of shelves) {
      if (shelf.startsWith('R') && !aisles.has(shelf)) {
        tokens.push(shelf);
        aisles.add(shelf);
      }
    }
    return tokens.join(', ');
  }

  /** Đầu mã (B018, R029…) → các kệ ghi trong Danh mục dãy kệ, R trước S. */
  private shelfMapByPrefix: Map<string, string[]> | null = null;

  /** Nạp lại bảng dãy kệ (gọi sau khi lưu Danh mục dãy kệ). */
  async loadShelfMap(): Promise<void> {
    try {
      const snap = await firstValueFrom(
        this.firestore.collection('kk-shelf-group-map').doc('layout').get().pipe(timeout(20000))
      );
      const raw = (snap?.data() as { shelves?: unknown } | undefined)?.shelves;
      const saved = raw && typeof raw === 'object' ? raw as Record<string, string> : null;
      const map = new Map<string, string[]>();
      for (const row of shelfGroupRows(saved)) {
        if (!/^[RS]\d{2}$/.test(row.shelf)) continue;
        for (const part of row.groups.split(',')) {
          const token = part.trim().toUpperCase();
          if (!/^[BR]\d{3}$/.test(token)) continue;
          const list = map.get(token) || [];
          if (!list.includes(row.shelf)) list.push(row.shelf);
          map.set(token, list);
        }
      }
      map.forEach((list) => list.sort((a, b) =>
        a[0] !== b[0] ? (a[0] === 'R' ? -1 : 1) : Number(a.slice(1)) - Number(b.slice(1))
      ));
      this.shelfMapByPrefix = map;
    } catch (e) {
      console.warn('[KkCatalog] loadShelfMap failed', e);
    }
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

  /** Vị trí không phải dãy R/S: khu vực lưu trữ và nhóm mã được gán. */
  storageAreas(
    entries: KkCatalogEntry[],
    typeMap?: Map<string, string>,
    homeLocs?: Map<string, string>
  ): Array<{ name: string; groups: string }> {
    const byName = new Map<string, { name: string; codes: string[] }>();
    for (const entry of entries) {
      const code = this.normalizeGroupCode(entry.groupCode) || String(entry.groupCode || '').trim().toUpperCase();
      if (!code) continue;
      for (const token of this.locationTokensForEntry(entry, typeMap, homeLocs)) {
        if (this.aisleIdFromLocation(token)) continue;
        const name = token.replace(/\s+/g, ' ').trim().toUpperCase();
        if (!name) continue;
        const row = byName.get(name) || { name, codes: [] };
        row.codes.push(code);
        byName.set(name, row);
      }
    }
    return [...byName.values()]
      .map((row) => ({ name: row.name, groups: this.compressGroupCodes(row.codes) }))
      .filter((row) => row.groups !== '—')
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }

  /**
   * Nhãn sơ đồ lưu trữ: mỗi kệ / khu vực một dòng loại hàng.
   * Dây 28AWG và 30 AWG trên cùng kệ → "Dây 28AWG, 30 AWG".
   */
  storageLayoutLabels(
    entries: KkCatalogEntry[],
    typeMap?: Map<string, string>,
    homeLocs?: Map<string, string>
  ): {
    shelves: Array<{ shelf: string; groups: string; family: 'R' | 'S' }>;
    areas: Array<{ name: string; groups: string }>;
  } {
    const aisleTypes = new Map<string, string[]>();
    const areaTypes = new Map<string, string[]>();
    for (const entry of entries) {
      const type = String(entry.productType || '').trim();
      if (!type) continue;
      for (const token of this.locationTokensForEntry(entry, typeMap, homeLocs)) {
        const aisle = this.aisleIdFromLocation(token);
        if (aisle) {
          if (this.isStagingLocation(token)) continue;
          const list = aisleTypes.get(aisle) || [];
          list.push(type);
          aisleTypes.set(aisle, list);
          continue;
        }
        const name = token.replace(/\s+/g, ' ').trim().toUpperCase();
        if (!name) continue;
        const list = areaTypes.get(name) || [];
        list.push(type);
        areaTypes.set(name, list);
      }
    }
    const shelves: Array<{ shelf: string; groups: string; family: 'R' | 'S' }> = [];
    aisleTypes.forEach((types, shelf) => {
      const groups = this.summarizeStorageTypes(types);
      if (!groups) return;
      shelves.push({ shelf, groups, family: shelf.startsWith('S') ? 'S' : 'R' });
    });
    shelves.sort((a, b) => a.shelf.localeCompare(b.shelf, 'en', { numeric: true }));
    const areas = [...areaTypes.entries()]
      .map(([name, types]) => ({ name, groups: this.summarizeStorageTypes(types) }))
      .filter((row) => row.groups)
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    return { shelves, areas };
  }

  /**
   * Nhãn kệ R theo vị trí đã gán trong quản lý nguyên liệu.
   * Dây điện 24/26/28/30 AWG trên cùng kệ → "Dây điện 24AWG, 26AWG, 28AWG, 30AWG".
   */
  rackStorageLabels(
    entries: KkCatalogEntry[],
    typeMap?: Map<string, string>,
    homeLocs?: Map<string, string>
  ): Map<string, string> {
    const aisleTypes = new Map<string, string[]>();
    for (const entry of entries) {
      const type = String(entry.productType || '').trim();
      if (!type) continue;
      for (const token of this.locationTokensForEntry(entry, typeMap, homeLocs)) {
        const aisle = this.aisleIdFromLocation(token);
        if (!aisle || !aisle.startsWith('R') || this.isStagingLocation(token)) continue;
        const list = aisleTypes.get(aisle) || [];
        list.push(type);
        aisleTypes.set(aisle, list);
      }
    }
    const labels = new Map<string, string>();
    aisleTypes.forEach((types, shelf) => {
      const groups = this.summarizeRackProductTypes(types);
      if (groups) labels.set(shelf, groups);
    });
    return labels;
  }

  /** Gộp loại hàng trên kệ R. Dây điện theo cỡ AWG thành một cụm. */
  summarizeRackProductTypes(types: string[]): string {
    const unique = Array.from(new Set(types.map((type) => String(type || '').trim()).filter(Boolean)));
    const dien: number[] = [];
    const cap: number[] = [];
    const seenDien = new Set<number>();
    const seenCap = new Set<number>();
    const others: string[] = [];
    const seenOther = new Set<string>();
    for (const type of unique) {
      const gauge = this.storageWireGauge(type);
      if (gauge) {
        const cable = this.isStorageCableType(type);
        const bag = cable ? seenCap : seenDien;
        const list = cable ? cap : dien;
        if (!bag.has(gauge.n)) {
          bag.add(gauge.n);
          list.push(gauge.n);
        }
        continue;
      }
      if (this.isStorageWireType(type)) continue;
      const short = this.shortStorageType(type);
      if (!short || this.isStorageCodeOnly(short)) continue;
      const key = this.foldStorageType(short);
      if (!key || seenOther.has(key)) continue;
      seenOther.add(key);
      others.push(short);
    }
    dien.sort((a, b) => a - b);
    cap.sort((a, b) => a - b);
    const parts: string[] = [];
    if (dien.length) parts.push(`Dây điện ${dien.map((n) => this.storageAwgToken(n)).join(', ')}`);
    if (cap.length) parts.push(`Dây cáp ${cap.map((n) => this.storageAwgToken(n)).join(', ')}`);
    parts.push(...others);
    return parts.join(', ');
  }

  private isStorageCableType(productType: string): boolean {
    const u = this.foldStorageType(productType);
    return /DAY\s*CAP|\bCABLE\b/.test(u) && !/DAY\s*DIEN|\bWIRE\b/.test(u);
  }

  private storageAwgToken(n: number): string {
    const text = Number.isInteger(n) ? String(n) : String(n);
    return `${text}AWG`;
  }

  /** Gộp loại hàng trên một chỗ. Dây điện theo cỡ AWG thành một cụm. */
  summarizeStorageTypes(types: string[]): string {
    const unique = Array.from(new Set(types.map((type) => String(type || '').trim()).filter(Boolean)));
    const gauges: Array<{ n: number; token: string }> = [];
    const seenGauge = new Set<number>();
    const others: string[] = [];
    const seenOther = new Set<string>();
    let bareWire = false;
    for (const type of unique) {
      const gauge = this.storageWireGauge(type);
      if (gauge) {
        if (!seenGauge.has(gauge.n)) {
          seenGauge.add(gauge.n);
          gauges.push(gauge);
        }
        continue;
      }
      if (this.isStorageWireType(type)) {
        bareWire = true;
        continue;
      }
      const short = this.shortStorageType(type);
      if (!short || this.isStorageCodeOnly(short)) continue;
      const key = this.foldStorageType(short);
      if (!key || seenOther.has(key)) continue;
      seenOther.add(key);
      others.push(short);
    }
    gauges.sort((a, b) => a.n - b.n);
    const parts: string[] = [];
    if (gauges.length) parts.push(`Dây ${gauges.map((gauge) => gauge.token).join(', ')}`);
    else if (bareWire) parts.push('Dây');
    parts.push(...others);
    return parts.join(', ');
  }

  private storageWireGauge(productType: string): { n: number; token: string } | null {
    if (!this.isStorageWireType(productType)) return null;
    const raw = String(productType || '');
    const hit = /(\d+(?:\.\d+)?)\s*AWG/i.exec(raw) || /AWG\s*(\d+(?:\.\d+)?)/i.exec(raw);
    if (!hit) return null;
    const n = Number(hit[1]);
    if (!Number.isFinite(n)) return null;
    const token = /\d\s+AWG/i.test(hit[0]) ? `${hit[1]} AWG` : /AWG\s+\d/i.test(hit[0]) ? `AWG ${hit[1]}` : `${hit[1]}AWG`;
    return { n, token };
  }

  private isStorageWireType(productType: string): boolean {
    const u = this.foldStorageType(productType);
    return /DAY\s*(DIEN|CAP)?|\bDAY\b|\bWIRE\b|\bCABLE\b/.test(u);
  }

  private shortStorageType(productType: string): string {
    const raw = String(productType || '').trim().replace(/\s+/g, ' ');
    const colors = new Set([
      'DEN', 'TRANG', 'DO', 'XANH', 'VANG', 'NAU', 'XAM', 'CAM', 'HONG', 'TIM',
      'BLACK', 'WHITE', 'RED', 'BLUE', 'YELLOW', 'GREEN', 'GREY', 'GRAY', 'BROWN', 'ORANGE'
    ]);
    const kept = raw
      .split(' ')
      .filter((token) => token && !colors.has(this.foldStorageType(token)) && !this.isStorageCodeToken(token));
    return (kept.length ? kept : []).join(' ');
  }

  private isStorageCodeOnly(value: string): boolean {
    const tokens = String(value || '').split(/[\s,;/]+/).filter(Boolean);
    return tokens.length > 0 && tokens.every((token) => this.isStorageCodeToken(token));
  }

  private isStorageCodeToken(token: string): boolean {
    const raw = String(token || '').trim().toUpperCase();
    if (!raw) return false;
    if (/^[A-Z]\d{3,}$/.test(raw)) return true;
    if (/^[A-Z]\d{3,}[–-][A-Z]?\d{3,}$/.test(raw)) return true;
    if (/^R\d{1,2}(-\d+)*[A-C]?$/.test(raw)) return true;
    if (/^S\d{1,2}(-T?\d+)*$/.test(raw)) return true;
    return false;
  }

  private foldStorageType(value: string): string {
    return String(value || '')
      .toUpperCase()
      .replace(/Đ/g, 'D')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  private locationTokensForEntry(
    entry: KkCatalogEntry,
    typeMap?: Map<string, string>,
    homeLocs?: Map<string, string>
  ): string[] {
    const saved = String(entry.location || '').trim();
    const base = saved || this.ruleLocForMaterial(entry.groupCode, entry.productType, typeMap, homeLocs);
    const raw = isB037Code(entry.groupCode) ? base : this.withShelfMapLocations(base, entry.groupCode);
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
    map.set(FRIDGE_NVL_TYPE, B037_REQUIRED_LOCATION);
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

  /** Mọi mã B037 gắn vị trí yêu cầu HOACHAT. Năm mã tủ lạnh giữ loại hàng Tủ lạnh. */
  private applyFridgeCatalog(items: KkCatalogEntry[]): KkCatalogEntry[] {
    const byCode = new Map(items.map((entry) => [entry.groupCode, entry]));
    for (const entry of items) {
      if (isB037Code(entry.groupCode)) entry.location = B037_REQUIRED_LOCATION;
    }
    for (const code of FRIDGE_NVL_CODES) {
      const hit = byCode.get(code);
      if (hit) {
        hit.productType = FRIDGE_NVL_TYPE;
        hit.location = B037_REQUIRED_LOCATION;
        continue;
      }
      const row: KkCatalogEntry = {
        id: `fridge-${code}`,
        groupCode: code,
        productType: FRIDGE_NVL_TYPE,
        location: B037_REQUIRED_LOCATION
      };
      items.push(row);
      byCode.set(code, row);
    }
    return items.sort((a, b) => a.groupCode.localeCompare(b.groupCode, 'en', { numeric: true }));
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
