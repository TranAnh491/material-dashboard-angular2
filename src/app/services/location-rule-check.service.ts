import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import {
  blocksSingleLetterPrefixMatch,
  getDefaultLocationsForWarehouse,
  mergeWarehouseMapsFromFirestore
} from './location-warehouse-defaults.util';

export type WarehouseType = 'Kho Thường' | 'Kho Mát';

interface LocationRule {
  id?: string;
  factory: 'ASM1' | 'ASM2';
  materialCode: string;
  destinationLocationPrefixes: string[];
}

interface LocationWarehouseRulesDoc {
  factory: 'ASM1' | 'ASM2';
  locationByViTri?: Record<string, WarehouseType>;
  locationByFirstChar?: Record<string, WarehouseType>;
  materialByPrefix?: Record<string, WarehouseType>;
}

export interface InventoryLocationRow {
  id?: string;
  materialCode: string;
  location: string;
  poNumber?: string;
  stock?: number;
}

export interface RuleViolation {
  materialCode: string;
  location: string;
  poNumber?: string;
  reason: string;
  expectedLabel: string;
}

export interface LocationRuleCheckResult {
  violations: RuleViolation[];
  checkedCount: number;
  skippedNoRule: number;
  skippedExempt: number;
  skippedEmptyLocation: number;
}

interface PreparedAllowedEntry {
  raw: string;
  key: string;
  exempt: boolean;
}

interface PreparedAllowedLocations {
  entries: PreparedAllowedEntry[];
}

interface MaterialRuleResolution {
  warehouseType: WarehouseType | '';
  allowed: PreparedAllowedLocations;
  expectedLabel: string;
}

interface RuleCheckContext {
  factory: 'ASM1' | 'ASM2';
  rules: LocationRule[];
  locationByViTriMap: Record<string, WarehouseType>;
  legacyFirstCharMap: Record<string, WarehouseType>;
  materialPrefixWarehouseMap: Record<string, WarehouseType>;
  allowedByWarehouse: Record<WarehouseType, PreparedAllowedLocations>;
  materialRuleCache: Map<string, MaterialRuleResolution | null>;
  prefixRules: LocationRule[];
}

@Injectable({ providedIn: 'root' })
export class LocationRuleCheckService {
  private readonly warehouseTypeOptions: WarehouseType[] = ['Kho Thường', 'Kho Mát'];
  private contextCache: { factory: 'ASM1' | 'ASM2'; ctx: RuleCheckContext; at: number } | null = null;
  private readonly contextCacheTtlMs = 120_000;

  constructor(private firestore: AngularFirestore) {}

  async checkInventoryAgainstRules(
    factory: 'ASM1' | 'ASM2',
    rows?: InventoryLocationRow[]
  ): Promise<LocationRuleCheckResult> {
    const context = await this.loadRuleContext(factory);
    const inventory = rows?.length ? rows : await this.loadInventoryWithLocation(factory);

    const violations: RuleViolation[] = [];
    let skippedNoRule = 0;
    let skippedExempt = 0;
    let skippedEmptyLocation = 0;
    let checkedCount = 0;

    for (const row of inventory) {
      const location = String(row.location || '').trim();
      const materialCode = String(row.materialCode || '').trim();
      if (!materialCode) continue;
      if (!location) {
        skippedEmptyLocation++;
        continue;
      }
      if (this.isRuleExemptLocation(location)) {
        skippedExempt++;
        continue;
      }

      const resolved = this.resolveMaterialRule(context, materialCode);
      if (!resolved) {
        skippedNoRule++;
        continue;
      }

      checkedCount++;
      if (!this.matchesPreparedAllowed(location, resolved.allowed)) {
        violations.push({
          materialCode,
          location,
          poNumber: row.poNumber,
          reason: resolved.warehouseType
            ? `Mã thuộc ${resolved.warehouseType} — vị trí không đúng kho`
            : 'Vị trí không đúng rule cũ',
          expectedLabel: resolved.expectedLabel
        });
      }
    }

    violations.sort((a, b) => a.location.localeCompare(b.location, 'vi', { numeric: true }));

    return {
      violations,
      checkedCount,
      skippedNoRule,
      skippedExempt,
      skippedEmptyLocation
    };
  }

  /** IQC*, NG, ASM3*: không áp rule — mọi mã đều được cất (ASM3 không có trên sơ đồ layout). */
  isRuleExemptLocation(location: string): boolean {
    const raw = String(location || '').replace(/\s/g, '').toUpperCase();
    return raw.startsWith('IQC') || raw.startsWith('NG') || raw.startsWith('ASM3');
  }

  /** @deprecated dùng isRuleExemptLocation */
  isIqcExemptLocation(location: string): boolean {
    return this.isRuleExemptLocation(location);
  }

  private async loadRuleContext(factory: 'ASM1' | 'ASM2'): Promise<RuleCheckContext> {
    const now = Date.now();
    if (
      this.contextCache &&
      this.contextCache.factory === factory &&
      now - this.contextCache.at < this.contextCacheTtlMs
    ) {
      return this.contextCache.ctx;
    }

    const [warehouseSnap, rulesSnap] = await Promise.all([
      this.firestore.collection<LocationWarehouseRulesDoc>('location-warehouse-rules').doc(factory).get().toPromise(),
      this.firestore
        .collection('location-rules', ref => ref.where('factory', '==', factory))
        .get()
        .toPromise()
        .catch(() => this.firestore.collection('location-rules').get().toPromise())
    ]);

    const warehouseDoc = warehouseSnap?.exists ? (warehouseSnap.data() as LocationWarehouseRulesDoc) : null;
    const maps = this.applyWarehouseMapsFromDoc(warehouseDoc);
    const rules = this.parseLocationRulesFromDocs(
      (rulesSnap?.docs || []).map(doc => ({ id: doc.id, data: () => doc.data() })),
      factory
    );
    const prefixRules = rules
      .filter(r => r.materialCode.length < 7)
      .sort((a, b) => b.materialCode.length - a.materialCode.length);

    const ctx: RuleCheckContext = {
      factory,
      rules,
      prefixRules,
      materialRuleCache: new Map(),
      allowedByWarehouse: {
        'Kho Thường': this.prepareAllowedLocations(this.buildLocationListForWarehouse(maps, 'Kho Thường')),
        'Kho Mát': this.prepareAllowedLocations(this.buildLocationListForWarehouse(maps, 'Kho Mát'))
      },
      ...maps
    };

    this.contextCache = { factory, ctx, at: now };
    return ctx;
  }

  private async loadInventoryWithLocation(factory: 'ASM1' | 'ASM2'): Promise<InventoryLocationRow[]> {
    const snap = await this.firestore
      .collection('inventory-materials', ref => ref.where('factory', '==', factory).limit(10000))
      .get()
      .toPromise();

    return (snap?.docs || [])
      .map(doc => {
        const data = doc.data() as Record<string, unknown>;
        return {
          id: doc.id,
          materialCode: String(data['materialCode'] || ''),
          location: String(data['location'] ?? data['viTri'] ?? '').trim(),
          poNumber: String(data['poNumber'] || ''),
          stock: Number(data['stock'] ?? data['quantity'] ?? 0)
        };
      })
      .filter(row => row.materialCode && row.location);
  }

  private resolveMaterialRule(
    context: RuleCheckContext,
    materialCode: string
  ): MaterialRuleResolution | null {
    const code7 = this.normalizeMaterialCodeForRule(materialCode);
    if (context.materialRuleCache.has(code7)) {
      return context.materialRuleCache.get(code7) || null;
    }

    const warehouseType = this.getWarehouseTypeForMaterial(context, materialCode);
    let resolved: MaterialRuleResolution | null = null;

    if (warehouseType) {
      const allowed = context.allowedByWarehouse[warehouseType];
      const locLabels = allowed.entries.map(e => e.raw);
      resolved = {
        warehouseType,
        allowed,
        expectedLabel: locLabels.length ? `${warehouseType} — ${locLabels.join(', ')}` : warehouseType
      };
    } else {
      const legacy = this.findMatchedRuleFromList(context, materialCode);
      const prefixes = legacy?.destinationLocationPrefixes || [];
      if (prefixes.length) {
        resolved = {
          warehouseType: '',
          allowed: this.prepareAllowedLocations(prefixes),
          expectedLabel: `Vị trí: ${prefixes.join(', ')}`
        };
      }
    }

    context.materialRuleCache.set(code7, resolved);
    return resolved;
  }

  private buildLocationListForWarehouse(
    maps: Pick<RuleCheckContext, 'locationByViTriMap' | 'legacyFirstCharMap'>,
    warehouseType: WarehouseType
  ): string[] {
    const locs = new Set<string>(getDefaultLocationsForWarehouse(warehouseType));
    for (const [loc, wh] of Object.entries(maps.locationByViTriMap)) {
      if (wh === warehouseType && !this.isRuleExemptLocation(loc)) {
        locs.add(loc);
      }
    }
    for (const [c, wh] of Object.entries(maps.legacyFirstCharMap)) {
      if (wh === warehouseType) {
        locs.add(c);
      }
    }
    return Array.from(locs);
  }

  private prepareAllowedLocations(locations: string[]): PreparedAllowedLocations {
    const entries = locations
      .map(raw => {
        const exempt = this.isRuleExemptLocation(raw);
        const allowedRaw = String(raw || '').replace(/\s/g, '').toUpperCase();
        const key = exempt
          ? allowedRaw
          : this.normalizeLocationWarehouseKey(this.formatViTriInput(raw) || raw);
        return { raw, key, exempt };
      })
      .filter(e => !!e.key)
      .sort((a, b) => b.key.length - a.key.length);
    return { entries };
  }

  private matchesPreparedAllowed(target: string, prepared: PreparedAllowedLocations): boolean {
    if (this.isRuleExemptLocation(target)) return true;
    if (!prepared.entries.length) return false;

    const targetRaw = String(target || '').replace(/\s/g, '').toUpperCase();
    const formatted = this.formatViTriInput(target || '');
    const normalized = formatted ? this.normalizeLocationWarehouseKey(formatted) : targetRaw;

    for (const { key, exempt } of prepared.entries) {
      if (exempt) {
        if (targetRaw.startsWith(key)) return true;
        continue;
      }
      if (normalized === key) return true;
      if (key.length >= 2 && normalized.startsWith(key)) return true;
      if (
        key.length === 1 &&
        !blocksSingleLetterPrefixMatch(normalized, key) &&
        normalized.startsWith(key)
      ) {
        return true;
      }
    }
    return false;
  }

  private getWarehouseTypeForMaterial(context: RuleCheckContext, materialCode: string): WarehouseType | '' {
    const b6 = this.getMaterialB6Prefix(materialCode);
    if (b6 && context.materialPrefixWarehouseMap[b6]) {
      return context.materialPrefixWarehouseMap[b6];
    }
    const b3 = this.getMaterialB3Prefix(materialCode);
    if (b3 && context.materialPrefixWarehouseMap[b3]) {
      return context.materialPrefixWarehouseMap[b3];
    }
    return '';
  }

  private findMatchedRuleFromList(context: RuleCheckContext, materialCode: string): LocationRule | null {
    const scannedCode7 = this.normalizeMaterialCodeForRule(materialCode);
    const exactRule = context.rules.find(r => r.materialCode.length === 7 && r.materialCode === scannedCode7);
    if (exactRule) return exactRule;

    return context.prefixRules.find(r => scannedCode7.startsWith(r.materialCode)) || null;
  }

  private applyWarehouseMapsFromDoc(data: LocationWarehouseRulesDoc | null | undefined): {
    locationByViTriMap: Record<string, WarehouseType>;
    legacyFirstCharMap: Record<string, WarehouseType>;
    materialPrefixWarehouseMap: Record<string, WarehouseType>;
  } {
    const locMap: Record<string, WarehouseType> = {};
    const legacyMap: Record<string, WarehouseType> = {};
    const matMap: Record<string, WarehouseType> = {};

    for (const [k, v] of Object.entries(data?.locationByViTri || {})) {
      const key = this.normalizeLocationWarehouseKey(k);
      const wh = this.normalizeWarehouseType(v);
      if (key && wh) locMap[key] = wh;
    }
    for (const [k, v] of Object.entries(data?.locationByFirstChar || {})) {
      const c = String(k || '').trim().toUpperCase().charAt(0);
      const wh = this.normalizeWarehouseType(v);
      if (c && wh) legacyMap[c] = wh;
    }
    for (const [k, v] of Object.entries(data?.materialByPrefix || {})) {
      const p = this.normalizeMaterialPrefixKey(k);
      const wh = this.normalizeWarehouseType(v);
      if (p && wh) matMap[p] = wh;
    }

    const merged = mergeWarehouseMapsFromFirestore(locMap, legacyMap);
    return {
      locationByViTriMap: merged.locationByViTriMap,
      legacyFirstCharMap: merged.legacyFirstCharMap,
      materialPrefixWarehouseMap: matMap
    };
  }

  private parseLocationRulesFromDocs(
    docs: { id: string; data: () => any }[],
    factory: 'ASM1' | 'ASM2'
  ): LocationRule[] {
    return docs
      .map(doc => ({ id: doc.id, raw: doc.data() || {} }))
      .filter(({ raw }) => !raw.factory || raw.factory === factory)
      .map(({ id, raw }) => ({
        id,
        factory: (raw.factory || factory) as 'ASM1' | 'ASM2',
        materialCode: this.normalizeMaterialCodeForRule(raw.materialCode || ''),
        destinationLocationPrefixes: Array.isArray(raw.destinationLocationPrefixes)
          ? raw.destinationLocationPrefixes
              .map((p: unknown) => this.normalizeRuleDestinationPrefix(String(p || '')))
              .filter((p: string) => !!p)
          : []
      }))
      .filter(r => r.materialCode && r.destinationLocationPrefixes.length > 0)
      .sort((a, b) => (a.materialCode || '').localeCompare(b.materialCode || ''));
  }

  private normalizeMaterialCodeForRule(code: string): string {
    return (code || '').replace(/\s/g, '').toUpperCase().substring(0, 7);
  }

  private normalizeMaterialPrefixKey(raw: string): string {
    const compact = String(raw || '').replace(/\s/g, '').toUpperCase();
    if (/^B\d{6}$/.test(compact)) return compact;
    if (/^B\d{3}$/.test(compact)) return compact;
    const m6 = /^B(\d{6})/.exec(compact);
    if (m6) return `B${m6[1]}`;
    const m3 = /^B(\d{3})/.exec(compact);
    if (m3) return `B${m3[1]}`;
    return '';
  }

  private getMaterialB6Prefix(materialCode: string): string {
    const compact = this.normalizeMaterialCodeForRule(materialCode);
    const m = /^B(\d{6})/.exec(compact);
    return m ? `B${m[1]}` : '';
  }

  private getMaterialB3Prefix(materialCode: string): string {
    const compact = this.normalizeMaterialCodeForRule(materialCode);
    const m = /^B(\d{3})/.exec(compact);
    return m ? `B${m[1]}` : '';
  }

  private normalizeRuleDestinationPrefix(raw: string): string {
    const s = String(raw || '').replace(/\s/g, '').toUpperCase();
    if (!s) return '';
    if (this.isRuleExemptLocation(s)) return s;
    const formatted = this.formatViTriInput(s);
    return formatted && this.validateViTriInput(formatted) ? formatted : '';
  }

  private normalizeLocationWarehouseKey(viTri: string): string {
    const formatted = this.formatViTriInput(String(viTri || '').trim());
    return formatted || String(viTri || '').trim().toUpperCase().replace(/[.\-()]/g, '');
  }

  private formatViTriInput(input: string): string {
    if (!input) return '';
    let formatted = input.replace(/\s/g, '').toUpperCase();
    formatted = formatted.replace(/[^A-Z0-9.\-()]/g, '');
    return formatted;
  }

  private validateViTriInput(input: string): boolean {
    if (!input) return false;
    return /^[A-Z0-9.\-()]+$/.test(input);
  }

  private normalizeWarehouseType(value: unknown): WarehouseType | '' {
    const s = String(value || '').trim();
    if (!s) return '';
    const lower = s.toLowerCase();
    if (lower === 'kho thường' || lower === 'kho thuong') return 'Kho Thường';
    if (lower === 'kho mát' || lower === 'kho mat') return 'Kho Mát';
    return this.warehouseTypeOptions.includes(s as WarehouseType) ? (s as WarehouseType) : '';
  }
}
