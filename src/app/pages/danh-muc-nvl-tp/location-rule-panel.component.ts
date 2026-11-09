import { appAlert } from '../../shared/app-toast';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { mergeWarehouseMapsFromFirestore } from '../../services/location-warehouse-defaults.util';

type Factory = 'ASM1' | 'ASM2';
type WarehouseType = 'Kho Thường' | 'Kho Mát';

interface LocationRule {
  id?: string;
  factory: Factory;
  materialCode: string;
  destinationLocationPrefixes: string[];
}

interface LocationWarehouseRow {
  viTri: string;
  warehouseType: WarehouseType | '';
}

interface MaterialPrefixWarehouseRow {
  materialPrefix: string;
  warehouseType: WarehouseType;
}

interface LocationWarehouseRulesDoc {
  factory: Factory;
  locationByViTri?: Record<string, WarehouseType>;
  locationByFirstChar?: Record<string, WarehouseType>;
  materialByPrefix?: Record<string, WarehouseType>;
}

/**
 * Tab "Rule vị trí" của Danh mục (chuyển từ popup Rule ép vị trí ở Quản lý vị trí, 27/10/2026).
 * Chỉ sửa dữ liệu rule; việc chặn khi đổi vị trí vẫn ở Quản lý vị trí (đọc cùng collection):
 *  - location-warehouse-rules/{factory}: vị trí → loại kho, đầu mã B+3/B+6 → loại kho
 *  - location-rules: mã 4/7 ký tự → prefix vị trí (rule cũ)
 */
@Component({
  selector: 'app-location-rule-panel',
  templateUrl: './location-rule-panel.component.html',
  styleUrls: ['./location-rule-panel.component.scss']
})
export class LocationRulePanelComponent implements OnInit {
  readonly warehouseTypeOptions: WarehouseType[] = ['Kho Thường', 'Kho Mát'];
  /** Chỉ ASM2 — rule ASM1 theo Sơ đồ lưu trữ ở J-Warehouse (27/10/2026). */
  readonly factory: Factory = 'ASM2';

  rules: LocationRule[] = [];
  rulesLoadError = '';
  locationWarehouseRows: LocationWarehouseRow[] = [];
  locationRuleFilter = '';
  materialPrefixRows: MaterialPrefixWarehouseRow[] = [];
  newMaterialPrefixInput = '';
  newMaterialPrefixWarehouse: WarehouseType = 'Kho Thường';
  ruleMaterialCodeInput = '';
  ruleDestinationLocationInput = '';
  editingLegacyRuleId: string | null = null;
  isWarehouseRulesSaving = false;
  isWarehouseRulesLoading = false;
  isMaterialPrefixRulesSaving = false;
  isLegacyRulesSaving = false;
  warehouseRulesLoadError = '';

  private locationViTris: string[] = [];
  private locationByViTriMap: Record<string, WarehouseType> = {};
  private legacyFirstCharMap: Record<string, WarehouseType> = {};
  private materialPrefixWarehouseMap: Record<string, WarehouseType> = {};

  constructor(private firestore: AngularFirestore, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    void this.loadAll();
  }

  async loadAll(): Promise<void> {
    this.isWarehouseRulesLoading = true;
    this.warehouseRulesLoadError = '';
    this.rulesLoadError = '';
    this.cdr.markForCheck();
    try {
      const [locSnap] = await Promise.all([
        this.locationViTris.length ? Promise.resolve(null) : this.firestore.firestore.collection('locations').get(),
        this.loadWarehouseRules(),
        this.reloadLegacyRules()
      ]);
      if (locSnap) {
        this.locationViTris = locSnap.docs.map((d) => String((d.data() as any)?.viTri || '').trim()).filter(Boolean);
      }
      this.buildLocationWarehouseRows();
    } catch (e: unknown) {
      this.warehouseRulesLoadError = (e as Error)?.message || String(e);
      console.error('❌ [Rule vị trí] load:', e);
    } finally {
      this.isWarehouseRulesLoading = false;
      this.cdr.markForCheck();
    }
  }

  // ── Chuẩn hoá (giống Quản lý vị trí) ─────────────────────────
  private formatViTriInput(input: string): string {
    return String(input || '').replace(/\s/g, '').toUpperCase().replace(/[^A-Z0-9.\-()]/g, '');
  }

  private normalizeLocationWarehouseKey(viTri: string): string {
    const formatted = this.formatViTriInput(String(viTri || '').trim());
    return formatted || String(viTri || '').trim().toUpperCase().replace(/[.\-()]/g, '');
  }

  private isIqcExemptLocation(location: string): boolean {
    return String(location || '').replace(/\s/g, '').toUpperCase().startsWith('IQC');
  }

  private isBoxExemptLocation(location: string): boolean {
    return /^BOX-\d/.test(String(location || '').replace(/\s/g, '').toUpperCase());
  }

  private normalizeMaterialCodeForRule(code: string): string {
    return (code || '').replace(/\s/g, '').toUpperCase().substring(0, 7);
  }

  private normalizeMaterialPrefixKey(raw: string): string {
    const compact = String(raw || '').replace(/\s/g, '').toUpperCase();
    const m6 = /^B(\d{6})/.exec(compact);
    if (m6) return `B${m6[1]}`;
    const m3 = /^B(\d{3})/.exec(compact);
    return m3 ? `B${m3[1]}` : '';
  }

  private normalizeWarehouseType(value: unknown): WarehouseType | '' {
    const lower = String(value || '').trim().toLowerCase();
    if (lower === 'kho thường' || lower === 'kho thuong') return 'Kho Thường';
    if (lower === 'kho mát' || lower === 'kho mat') return 'Kho Mát';
    return '';
  }

  private normalizeRuleDestinationPrefix(raw: string): string {
    const s = String(raw || '').replace(/\s/g, '').toUpperCase();
    if (!s) return '';
    if (this.isIqcExemptLocation(s)) return s;
    const formatted = this.formatViTriInput(s);
    return formatted && /^[A-Z0-9.\-()]+$/.test(formatted) ? formatted : '';
  }

  // ── Vị trí → Loại kho / Đầu mã → Loại kho ────────────────────
  private async loadWarehouseRules(): Promise<void> {
    const snap = await this.firestore.firestore.collection('location-warehouse-rules').doc(this.factory).get();
    const data = snap.exists ? (snap.data() as LocationWarehouseRulesDoc) : null;
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
    this.locationByViTriMap = merged.locationByViTriMap;
    this.legacyFirstCharMap = merged.legacyFirstCharMap;
    this.materialPrefixWarehouseMap = matMap;
    this.syncMaterialPrefixRowsFromMap();
  }

  private buildLocationWarehouseRows(): void {
    const seen = new Set<string>();
    const rows: LocationWarehouseRow[] = [];
    for (const viTri of this.locationViTris) {
      if (this.isIqcExemptLocation(viTri) || this.isBoxExemptLocation(viTri)) continue;
      const key = this.normalizeLocationWarehouseKey(viTri);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        viTri,
        warehouseType:
          this.locationByViTriMap[key] ||
          this.locationByViTriMap[viTri.toUpperCase()] ||
          this.legacyFirstCharMap[viTri.toUpperCase().charAt(0)] ||
          ''
      });
    }
    for (const [locKey, wh] of Object.entries(this.locationByViTriMap)) {
      if (this.isIqcExemptLocation(locKey) || this.isBoxExemptLocation(locKey) || seen.has(locKey)) continue;
      seen.add(locKey);
      rows.push({ viTri: locKey, warehouseType: wh });
    }
    this.locationWarehouseRows = rows.sort((a, b) => a.viTri.localeCompare(b.viTri, 'vi', { numeric: true }));
  }

  get filteredLocationWarehouseRows(): LocationWarehouseRow[] {
    const q = this.locationRuleFilter.trim().toUpperCase();
    if (!q) return this.locationWarehouseRows;
    return this.locationWarehouseRows.filter((r) => String(r.viTri || '').toUpperCase().includes(q));
  }

  private syncMaterialPrefixRowsFromMap(): void {
    const rows: MaterialPrefixWarehouseRow[] = [];
    const seen = new Set<string>();
    for (const [p, w] of Object.entries(this.materialPrefixWarehouseMap)) {
      const prefix = this.normalizeMaterialPrefixKey(p);
      const wh = this.normalizeWarehouseType(w);
      if (!prefix || !wh || seen.has(prefix)) continue;
      seen.add(prefix);
      rows.push({ materialPrefix: prefix, warehouseType: wh });
    }
    this.materialPrefixRows = rows.sort((a, b) => a.materialPrefix.localeCompare(b.materialPrefix));
  }

  addMaterialPrefixRuleRow(): void {
    const prefix = this.normalizeMaterialPrefixKey(this.newMaterialPrefixInput);
    if (!prefix) {
      appAlert('Đầu mã phải đúng định dạng B+3 số (VD: B034) hoặc B+6 số (VD: B034567).');
      return;
    }
    if (this.materialPrefixRows.some((r) => r.materialPrefix === prefix)) {
      appAlert(`Đầu mã ${prefix} đã có trong danh sách.`);
      return;
    }
    this.materialPrefixWarehouseMap[prefix] = this.newMaterialPrefixWarehouse;
    this.syncMaterialPrefixRowsFromMap();
    this.newMaterialPrefixInput = '';
    void this.persistMaterialPrefixRules();
  }

  removeMaterialPrefixRuleRow(prefix: string): void {
    delete this.materialPrefixWarehouseMap[prefix];
    this.syncMaterialPrefixRowsFromMap();
    void this.persistMaterialPrefixRules();
  }

  onMaterialPrefixWarehouseChange(prefix: string, warehouseType: WarehouseType): void {
    this.materialPrefixWarehouseMap[prefix] = warehouseType;
    void this.persistMaterialPrefixRules();
  }

  private buildMaterialByPrefixForSave(): Record<string, WarehouseType> {
    const out: Record<string, WarehouseType> = {};
    for (const row of this.materialPrefixRows) {
      const prefix = this.normalizeMaterialPrefixKey(row.materialPrefix);
      const wh = this.normalizeWarehouseType(row.warehouseType);
      if (prefix && wh) out[prefix] = wh;
    }
    return out;
  }

  /** Lưu ngay rule đầu mã B. */
  private async persistMaterialPrefixRules(): Promise<void> {
    const materialByPrefix = this.buildMaterialByPrefixForSave();
    this.isMaterialPrefixRulesSaving = true;
    this.cdr.markForCheck();
    try {
      await this.firestore.collection('location-warehouse-rules').doc(this.factory).set(
        { factory: this.factory, materialByPrefix, updatedAt: new Date() },
        { merge: true }
      );
      this.materialPrefixWarehouseMap = { ...materialByPrefix };
      this.syncMaterialPrefixRowsFromMap();
    } catch (e: unknown) {
      console.error('❌ persistMaterialPrefixRules:', e);
      appAlert(`❌ Không lưu được rule đầu mã: ${(e as Error)?.message || e}`);
    } finally {
      this.isMaterialPrefixRulesSaving = false;
      this.cdr.markForCheck();
    }
  }

  async saveWarehouseRules(): Promise<void> {
    const locationByViTri: Record<string, WarehouseType> = {};
    for (const row of this.locationWarehouseRows) {
      if (row.viTri && row.warehouseType && !this.isIqcExemptLocation(row.viTri) && !this.isBoxExemptLocation(row.viTri)) {
        locationByViTri[this.normalizeLocationWarehouseKey(row.viTri)] = row.warehouseType;
      }
    }
    const materialByPrefix = this.buildMaterialByPrefixForSave();
    this.isWarehouseRulesSaving = true;
    this.cdr.markForCheck();
    try {
      await this.firestore.collection('location-warehouse-rules').doc(this.factory).set(
        { factory: this.factory, locationByViTri, materialByPrefix, updatedAt: new Date() },
        { merge: true }
      );
      this.locationByViTriMap = { ...locationByViTri };
      this.materialPrefixWarehouseMap = { ...materialByPrefix };
      this.syncMaterialPrefixRowsFromMap();
      this.buildLocationWarehouseRows();
      appAlert('✅ Đã lưu rule ép vị trí');
    } catch (e: unknown) {
      console.error('❌ saveWarehouseRules:', e);
      appAlert(`❌ Không lưu được rule: ${(e as Error)?.message || e}`);
    } finally {
      this.isWarehouseRulesSaving = false;
      this.cdr.markForCheck();
    }
  }

  // ── Rule cũ: mã → vị trí ─────────────────────────────────────
  private async reloadLegacyRules(): Promise<void> {
    try {
      const snap = await this.firestore.firestore.collection('location-rules').get();
      this.rules = snap.docs
        .map((doc) => ({ id: doc.id, raw: (doc.data() || {}) as any }))
        .filter(({ raw }) => !raw.factory || raw.factory === this.factory)
        .map(({ id, raw }) => ({
          id,
          factory: (raw.factory || this.factory) as Factory,
          materialCode: this.normalizeMaterialCodeForRule(raw.materialCode || ''),
          destinationLocationPrefixes: Array.isArray(raw.destinationLocationPrefixes)
            ? raw.destinationLocationPrefixes
                .map((p: unknown) => this.normalizeRuleDestinationPrefix(String(p || '')))
                .filter((p: string) => !!p)
            : []
        }))
        .filter((r) => r.materialCode && r.destinationLocationPrefixes.length > 0)
        .sort((a, b) => a.materialCode.localeCompare(b.materialCode));
    } catch (e: unknown) {
      console.error('❌ reloadLegacyRules:', e);
      this.rulesLoadError = (e as Error)?.message || String(e);
    }
  }

  clearLegacyRuleForm(): void {
    this.ruleMaterialCodeInput = '';
    this.ruleDestinationLocationInput = '';
    this.editingLegacyRuleId = null;
  }

  startEditLegacyRule(rule: LocationRule): void {
    this.editingLegacyRuleId = rule.id || null;
    this.ruleMaterialCodeInput = rule.materialCode || '';
    this.ruleDestinationLocationInput = (rule.destinationLocationPrefixes || []).join(', ');
  }

  async upsertLegacyRuleFromInputs(): Promise<void> {
    const materialCode = this.normalizeMaterialCodeForRule(this.ruleMaterialCodeInput);
    const destinationPrefixes = String(this.ruleDestinationLocationInput || '')
      .split(',')
      .map((s) => this.normalizeRuleDestinationPrefix(s))
      .filter((s) => !!s);
    if (!materialCode || (materialCode.length !== 4 && materialCode.length !== 7)) {
      appAlert('Mã nguyên liệu phải đúng 4 ký tự (prefix) hoặc 7 ký tự (mã đầy đủ), VD: B034 hoặc B037005');
      return;
    }
    if (!destinationPrefixes.length) {
      appAlert('Vui lòng nhập ít nhất một prefix vị trí đích (cách nhau bởi dấu phẩy), VD: Z, K hoặc FRIDGE hoặc IQC+F7');
      return;
    }
    const payload = { factory: this.factory, materialCode, destinationLocationPrefixes: destinationPrefixes, updatedAt: new Date() };
    this.isLegacyRulesSaving = true;
    this.cdr.markForCheck();
    try {
      const col = this.firestore.collection('location-rules');
      const existingId = this.editingLegacyRuleId || this.rules.find((r) => r.materialCode === materialCode)?.id;
      if (existingId) await col.doc(existingId).update(payload);
      else await col.add({ ...payload, createdAt: new Date() });
      await this.reloadLegacyRules();
      this.clearLegacyRuleForm();
      appAlert('✅ Đã lưu rule cũ');
    } catch (e: unknown) {
      console.error('❌ upsertLegacyRuleFromInputs:', e);
      appAlert(`❌ Không lưu được rule cũ: ${(e as Error)?.message || e}`);
    } finally {
      this.isLegacyRulesSaving = false;
      this.cdr.markForCheck();
    }
  }

  async deleteLegacyRule(rule: LocationRule): Promise<void> {
    if (!rule?.materialCode || !confirm(`Xóa rule cũ cho mã ${rule.materialCode}?`)) return;
    this.isLegacyRulesSaving = true;
    this.cdr.markForCheck();
    try {
      if (rule.id) await this.firestore.collection('location-rules').doc(rule.id).delete();
      if (this.editingLegacyRuleId === rule.id) this.clearLegacyRuleForm();
      await this.reloadLegacyRules();
    } catch (e: unknown) {
      console.error('❌ deleteLegacyRule:', e);
      appAlert(`❌ Không xóa được rule: ${(e as Error)?.message || e}`);
    } finally {
      this.isLegacyRulesSaving = false;
      this.cdr.markForCheck();
    }
  }

  trackByLocationWarehouseRow(_i: number, row: LocationWarehouseRow): string { return row.viTri; }
  trackByMaterialPrefixRow(_i: number, row: MaterialPrefixWarehouseRow): string { return row.materialPrefix; }
  trackByLegacyRule(_i: number, rule: LocationRule): string { return rule.id || rule.materialCode; }
}
