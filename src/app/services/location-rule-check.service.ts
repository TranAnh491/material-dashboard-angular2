import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';

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

interface RuleCheckContext {
  factory: 'ASM1' | 'ASM2';
  rules: LocationRule[];
  locationByViTriMap: Record<string, WarehouseType>;
  legacyFirstCharMap: Record<string, WarehouseType>;
  materialPrefixWarehouseMap: Record<string, WarehouseType>;
}

@Injectable({ providedIn: 'root' })
export class LocationRuleCheckService {
  private readonly warehouseTypeOptions: WarehouseType[] = ['Kho Thường', 'Kho Mát'];

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

      const resolved = this.resolveAllowedFirstChars(context, materialCode);
      if (!resolved.allowedChars.length) {
        skippedNoRule++;
        continue;
      }

      checkedCount++;
      const locationChar = this.getLocationFirstChar(location);
      if (!resolved.allowedChars.includes(locationChar)) {
        violations.push({
          materialCode,
          location,
          poNumber: row.poNumber,
          reason: resolved.warehouseType
            ? `Mã thuộc ${resolved.warehouseType} — kệ ${locationChar} sai`
            : `Kệ ${locationChar} sai rule cũ`,
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

  /** IQC* và NG: không áp rule — mọi mã đều được cất. */
  isRuleExemptLocation(location: string): boolean {
    const raw = String(location || '').replace(/\s/g, '').toUpperCase();
    return raw.startsWith('IQC') || raw.startsWith('NG');
  }

  /** @deprecated dùng isRuleExemptLocation */
  isIqcExemptLocation(location: string): boolean {
    return this.isRuleExemptLocation(location);
  }

  private async loadRuleContext(factory: 'ASM1' | 'ASM2'): Promise<RuleCheckContext> {
    const [warehouseSnap, rulesSnap] = await Promise.all([
      this.firestore.collection<LocationWarehouseRulesDoc>('location-warehouse-rules').doc(factory).get().toPromise(),
      this.firestore.collection('location-rules').get().toPromise()
    ]);

    const warehouseDoc = warehouseSnap?.exists ? (warehouseSnap.data() as LocationWarehouseRulesDoc) : null;
    const maps = this.applyWarehouseMapsFromDoc(warehouseDoc);
    const rules = this.parseLocationRulesFromDocs(
      (rulesSnap?.docs || []).map(doc => ({ id: doc.id, data: () => doc.data() })),
      factory
    );

    return {
      factory,
      rules,
      ...maps
    };
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

  private resolveAllowedFirstChars(
    context: RuleCheckContext,
    materialCode: string
  ): { warehouseType: WarehouseType | ''; allowedChars: string[]; expectedLabel: string } {
    const warehouseType = this.getWarehouseTypeForMaterial(context, materialCode);
    if (warehouseType) {
      const allowedChars = this.getFirstCharsForWarehouse(context, warehouseType);
      return {
        warehouseType,
        allowedChars,
        expectedLabel: `${warehouseType} — kệ: ${allowedChars.join(', ')}`
      };
    }

    const legacy = this.findMatchedRuleFromList(context, materialCode);
    const allowedChars = Array.from(
      new Set((legacy?.destinationLocationPrefixes || []).map(p => this.getLocationFirstChar(p)).filter(Boolean))
    ).sort();
    return {
      warehouseType: '',
      allowedChars,
      expectedLabel: allowedChars.length ? `Kệ: ${allowedChars.join(', ')}` : ''
    };
  }

  private getFirstCharsForWarehouse(context: RuleCheckContext, warehouseType: WarehouseType): string[] {
    const chars = new Set<string>();

    for (const [loc, wh] of Object.entries(context.locationByViTriMap)) {
      if (wh === warehouseType && !this.isRuleExemptLocation(loc)) {
        const c = this.getLocationFirstChar(loc);
        if (c) chars.add(c);
      }
    }

    if (!chars.size) {
      for (const [c, wh] of Object.entries(context.legacyFirstCharMap)) {
        if (wh === warehouseType) chars.add(c);
      }
    }

    return Array.from(chars).sort((a, b) => a.localeCompare(b));
  }

  private getLocationFirstChar(viTri: string): string {
    const formatted = this.formatViTriInput(String(viTri || '').trim());
    return (formatted || String(viTri || '').trim().toUpperCase()).charAt(0);
  }

  private getWarehouseTypeForMaterial(context: RuleCheckContext, materialCode: string): WarehouseType | '' {
    const prefix = this.getMaterialPrefix4ForWarehouse(materialCode);
    return prefix ? context.materialPrefixWarehouseMap[prefix] || '' : '';
  }

  private findMatchedRuleFromList(context: RuleCheckContext, materialCode: string): LocationRule | null {
    const scannedCode7 = this.normalizeMaterialCodeForRule(materialCode);
    const exactRule = context.rules.find(r => r.materialCode.length === 7 && r.materialCode === scannedCode7);
    if (exactRule) return exactRule;

    const prefixRules = context.rules
      .filter(r => r.materialCode.length < 7)
      .filter(r => scannedCode7.startsWith(r.materialCode))
      .sort((a, b) => b.materialCode.length - a.materialCode.length);

    return prefixRules[0] || null;
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
      const p = this.normalizeMaterialPrefixForWarehouse(k);
      const wh = this.normalizeWarehouseType(v);
      if (p && wh) matMap[p] = wh;
    }

    return {
      locationByViTriMap: locMap,
      legacyFirstCharMap: legacyMap,
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

  private normalizeMaterialPrefixForWarehouse(raw: string): string {
    const compact = String(raw || '').replace(/\s/g, '').toUpperCase();
    const m = /^B(\d{3})/.exec(compact);
    return m ? `B${m[1]}` : '';
  }

  private getMaterialPrefix4ForWarehouse(materialCode: string): string {
    return this.normalizeMaterialPrefixForWarehouse(this.normalizeMaterialCodeForRule(materialCode));
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
