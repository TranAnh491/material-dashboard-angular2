import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import * as XLSX from 'xlsx';
import { ExportManifestRow, ImportManifestRow, MaterialsDashboardService } from '../../services/materials-dashboard.service';

type AgingFlagTier = 'green' | 'yellow' | 'orange' | 'red';

/** Màu heatmap — lưu localStorage, chỉnh trong popup Settings (icon bánh răng). */
type HeatmapColorSettings = {
  noExport: string;
  activityBuckets: string[];
  groupPalette: string[];
  locationLight: string;
  locationDark: string;
  agingGreen: string;
  agingYellow: string;
  agingOrange: string;
  agingRed: string;
  stockCheckRing: string;
};

const HEATMAP_COLORS_STORAGE_KEY = 'materials-dashboard-heatmap-colors';

const DEFAULT_HEATMAP_COLORS: HeatmapColorSettings = {
  noExport: '#FFFFFF',
  activityBuckets: ['#E0F2FE', '#BAE6FD', '#7DD3FC', '#38BDF8', '#0EA5E9', '#0284C7', '#0369A1', '#075985'],
  groupPalette: ['#E0F2FE', '#BAE6FD', '#7DD3FC', '#38BDF8', '#0EA5E9', '#0284C7'],
  locationLight: '#E0F2FE',
  locationDark: '#075985',
  agingGreen: '#22c55e',
  agingYellow: '#eab308',
  agingOrange: '#f97316',
  agingRed: '#ef4444',
  stockCheckRing: '#4ade80'
};

type CellVM = {
  sku: string;
  group: string; // 3 digits after B
  exportCount: number; // number of exports (times)
  status: 'NO_EXPORT' | 'EXPORTED';
  bg: string;
  fg: string;
  title: string;
  /** Có trong snapshot kiểm kê (stock-check-snapshot) khi bật so sánh */
  stockChecked: boolean;
  /** Cờ aging (góc ô) khi layer Aging có dữ liệu import */
  agingFlag: AgingFlagTier | null;
};

@Component({
  selector: 'app-materials-dashboard',
  templateUrl: './materials-dashboard.component.html',
  styleUrls: ['./materials-dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MaterialsDashboardComponent implements OnInit {
  isLoading = false;
  error: string = '';

  // Heatmap sizing (dense view)
  /** Kích thước ô heatmap (px); compact 7×1.3×1.2, comfortable 11×1.3×1.2 */
  cellSizePx = 7 * 1.3 * 1.2;
  viewMode: 'compact' | 'comfortable' = 'compact';
  groupByAaa = true;
  sortMode: 'activity_desc' | 'activity_asc' | 'sku_asc' | 'aging_asc' | 'aging_desc' = 'activity_desc';
  lastUpdatedText = '';

  // Filters / controls
  startDate = '';
  endDate = '';
  selectedYear: number | 'All' = 2020;
  readonly yearOptions: Array<number | 'All'> = ['All', 2020, 2021, 2022, 2023, 2024, 2025, 2026];
  searchSku = '';
  selectedGroup = '';

  // Fill controls
  fillByGroup = false;
  fillFunction: 'Activities' | 'Location' = 'Activities';
  layerMode: 'None' | 'Aging' | 'Location' = 'Aging';

  /**
   * Yes: so khớp với dữ liệu snapshot Stock Check (cùng nguồn tab Stock-Check: ASM1/ASM2_stock_check_current).
   * No: không tải / không viền.
   */
  stockCheckCompareEnabled = false;
  /** SKU chuẩn Bxxxxxx đã xuất hiện trong snapshot kiểm kê (ít nhất một dòng material) */
  private checkedSkuSet = new Set<string>();

  /** Aging import (Firebase `materials-dashboard-aging/current`) — số tháng / SKU khi layer Aging có dữ liệu */
  private agingBySku = new Map<string, number>();

  heatmapColors: HeatmapColorSettings = this.cloneHeatmapDefaults();
  /** Bản chỉnh trong popup màu (Lưu mới ghi vào heatmapColors + localStorage) */
  colorSettingsDraft: HeatmapColorSettings = this.cloneHeatmapDefaults();
  showColorSettingsPopup = false;

  readonly activityBucketLabels = ['1–10', '11–20', '21–30', '31–40', '41–50', '51–60', '61–70', '71+'];

  // More popup — import / info / templates
  showMorePopup = false;
  importingExport = false;
  importingAging = false;
  importingInbound = false;
  importExportError = '';
  importExportSavedCount = 0;
  importAgingError = '';
  importAgingSavedSkuCount = 0;
  importInboundError = '';
  importInboundSavedCount = 0;
  isExporting = false;

  // Computed model
  cells: CellVM[] = [];
  titlesEnabled = true;
  private masterSkuList: string[] = [];
  baseRows: Array<{ sku: string; group: string; count: number }> = [];
  private locationBySku = new Map<string, string>();
  private locationRank = new Map<string, number>();
  private masterSkusCache: Set<string> | null = null;
  private masterLocationsLoaded = false;
  isLoadingLocations = false;

  // KPIs
  kpiTotalSkus = 0;
  kpiActiveSkus = 0;
  kpiNoActivitySkus = 0;

  // Activity scale
  private exportCountMax = 0;
  private exportBucketMax = 0;

  // UI perf: debounce + incremental render
  private filtersTimer: any = null;
  private renderToken = 0;

  constructor(
    private svc: MaterialsDashboardService,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private firestore: AngularFirestore
  ) {}

  ngOnInit(): void {
    this.heatmapColors = this.loadHeatmapColorsFromStorage();
    const today = new Date();
    this.startDate = '2020-01-01';
    this.endDate = today.toISOString().slice(0, 10);
    this.selectedYear = today.getFullYear() >= 2020 && today.getFullYear() <= 2026 ? today.getFullYear() : 2026;
    void this.reload();
  }

  get heatmapColorCssVars(): Record<string, string> {
    const c = this.heatmapColors;
    return {
      '--md-aging-green': c.agingGreen,
      '--md-aging-yellow': c.agingYellow,
      '--md-aging-orange': c.agingOrange,
      '--md-aging-red': c.agingRed,
      '--md-stock-ring': c.stockCheckRing
    };
  }

  openColorSettings(): void {
    this.colorSettingsDraft = this.cloneHeatmapColors(this.heatmapColors);
    this.showColorSettingsPopup = true;
    this.cdr.markForCheck();
  }

  closeColorSettings(): void {
    this.showColorSettingsPopup = false;
    this.cdr.markForCheck();
  }

  saveColorSettings(): void {
    this.heatmapColors = this.normalizeHeatmapColors(this.colorSettingsDraft);
    try {
      localStorage.setItem(HEATMAP_COLORS_STORAGE_KEY, JSON.stringify(this.heatmapColors));
    } catch {
      /* ignore quota */
    }
    this.recomputeView();
    this.closeColorSettings();
  }

  resetColorSettingsDraft(): void {
    this.colorSettingsDraft = this.cloneHeatmapDefaults();
    this.cdr.markForCheck();
  }

  private cloneHeatmapDefaults(): HeatmapColorSettings {
    return this.cloneHeatmapColors(DEFAULT_HEATMAP_COLORS);
  }

  private cloneHeatmapColors(c: HeatmapColorSettings): HeatmapColorSettings {
    return JSON.parse(JSON.stringify(c));
  }

  private loadHeatmapColorsFromStorage(): HeatmapColorSettings {
    try {
      const raw = localStorage.getItem(HEATMAP_COLORS_STORAGE_KEY);
      if (!raw) return this.cloneHeatmapDefaults();
      const parsed = JSON.parse(raw) as Partial<HeatmapColorSettings>;
      return this.normalizeHeatmapColors(parsed);
    } catch {
      return this.cloneHeatmapDefaults();
    }
  }

  private normalizeHeatmapColors(p: Partial<HeatmapColorSettings>): HeatmapColorSettings {
    const d = DEFAULT_HEATMAP_COLORS;
    const buckets = Array.isArray(p.activityBuckets) ? [...p.activityBuckets] : [];
    while (buckets.length < 8) buckets.push(d.activityBuckets[buckets.length]);
    buckets.length = 8;

    const gp = Array.isArray(p.groupPalette) ? [...p.groupPalette] : [];
    while (gp.length < 6) gp.push(d.groupPalette[gp.length]);
    gp.length = 6;

    return {
      noExport: this.sanitizeHexColor(p.noExport, d.noExport),
      activityBuckets: buckets.map((x, i) => this.sanitizeHexColor(x, d.activityBuckets[i])),
      groupPalette: gp.map((x, i) => this.sanitizeHexColor(x, d.groupPalette[i])),
      locationLight: this.sanitizeHexColor(p.locationLight, d.locationLight),
      locationDark: this.sanitizeHexColor(p.locationDark, d.locationDark),
      agingGreen: this.sanitizeHexColor(p.agingGreen, d.agingGreen),
      agingYellow: this.sanitizeHexColor(p.agingYellow, d.agingYellow),
      agingOrange: this.sanitizeHexColor(p.agingOrange, d.agingOrange),
      agingRed: this.sanitizeHexColor(p.agingRed, d.agingRed),
      stockCheckRing: this.sanitizeHexColor(p.stockCheckRing, d.stockCheckRing)
    };
  }

  private sanitizeHexColor(v: unknown, fallback: string): string {
    const s = String(v ?? '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toUpperCase();
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      const h = s.slice(1);
      return (`#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`).toUpperCase();
    }
    return fallback;
  }

  setViewMode(mode: 'compact' | 'comfortable'): void {
    this.viewMode = mode;
    this.cellSizePx = mode === 'compact' ? 7 * 1.3 * 1.2 : 11 * 1.3 * 1.2;
    this.cdr.markForCheck();
  }

  applyYear(): void {
    if (this.selectedYear === 'All') {
      this.startDate = '2020-01-01';
      this.endDate = new Date().toISOString().slice(0, 10);
      void this.reload();
      return;
    }

    const y = Number(this.selectedYear);
    const start = new Date(y, 0, 1);
    const end = y === new Date().getFullYear() ? new Date() : new Date(y, 11, 31);
    this.startDate = start.toISOString().slice(0, 10);
    this.endDate = end.toISOString().slice(0, 10);
    void this.reload();
  }

  async onStockCheckCompareChange(): Promise<void> {
    if (this.stockCheckCompareEnabled) {
      await this.refreshStockCheckCheckedSkus();
    } else {
      this.checkedSkuSet.clear();
    }
    this.recomputeView();
    this.cdr.markForCheck();
  }

  /**
   * Đọc `stock-check-snapshot` giống tab Stock-Check (mỗi xưởng một doc), gom mã Bxxxxxx đã có dòng kiểm kê.
   */
  private async loadStockCheckSnapshotInto(target: Set<string>): Promise<void> {
    target.clear();
    const factories: Array<'ASM1' | 'ASM2'> = ['ASM1', 'ASM2'];
    for (const factory of factories) {
      const docId = `${factory}_stock_check_current`;
      try {
        const snap = await firstValueFrom(this.firestore.collection('stock-check-snapshot').doc(docId).get());
        if (!snap?.exists) continue;
        const data = snap.data() as { materials?: any[] } | undefined;
        const materials = data?.materials || [];
        for (const it of materials) {
          const sku = this.normalizeSkuFromAny(it?.materialCode);
          if (sku) target.add(sku);
        }
      } catch (e) {
        console.warn(`[MaterialsDashboard] stock-check-snapshot read failed (${docId}):`, e);
      }
    }
  }

  private async refreshStockCheckCheckedSkus(): Promise<void> {
    await this.loadStockCheckSnapshotInto(this.checkedSkuSet);
  }

  private async refreshAgingMap(): Promise<void> {
    try {
      this.agingBySku = await this.svc.loadMaterialsAging();
    } catch (e) {
      console.warn('[MaterialsDashboard] load aging failed', e);
      this.agingBySku = new Map();
    }
  }

  setLayerMode(mode: 'None' | 'Aging' | 'Location'): void {
    this.layerMode = mode;
    this.fillByGroup = false;
    if (mode === 'Location') {
      this.fillFunction = 'Location';
      void this.ensureLocationsLoaded();
    } else {
      this.fillFunction = 'Activities';
    }
    this.onFiltersChanged();
  }

  /** Template: hiển thị legend cờ aging */
  hasAgingImportData(): boolean {
    return this.agingBySku.size > 0;
  }

  setFillByGroup(on: boolean): void {
    this.fillByGroup = on;
    this.onFiltersChanged();
  }

  setFillFunction(fn: 'Activities' | 'Location'): void {
    this.fillFunction = fn;
    if (!this.fillByGroup && fn === 'Location') {
      void this.ensureLocationsLoaded();
    }
    this.onFiltersChanged();
  }

  async reload(forceMaster = false): Promise<void> {
    this.isLoading = true;
    this.error = '';
    this.cdr.markForCheck();

    try {
      const start = this.parseIsoDate(this.startDate, true);
      const end = this.parseIsoDate(this.endDate, false);

      // Master SKU + locations are expensive; cache them and only reload when forced.
      if (forceMaster || !this.masterSkusCache) {
        this.masterSkusCache = await this.svc.loadMasterSkus(['ASM1', 'ASM2']);
      }

      // Only load location map when needed (Location fill). It's expensive.
      if (forceMaster) {
        this.masterLocationsLoaded = false;
        this.locationBySku = new Map<string, string>();
        this.locationRank.clear();
      }
      if (!this.fillByGroup && this.fillFunction === 'Location') {
        await this.ensureLocationsLoaded();
      }
      const activityBySku = await this.svc.loadManifestActivity({ start, end });

      if (this.stockCheckCompareEnabled) {
        await this.refreshStockCheckCheckedSkus();
      } else {
        this.checkedSkuSet.clear();
      }

      await this.refreshAgingMap();

      this.applyModel(this.masterSkusCache, activityBySku);
    } catch (e: any) {
      console.error(e);
      this.error = e?.message ? String(e.message) : 'Load failed';
    } finally {
      this.isLoading = false;
      this.lastUpdatedText = this.formatNow();
      this.cdr.markForCheck();
    }
  }

  onFiltersChanged(): void {
    // Debounce to avoid recompute on every keystroke/change burst.
    if (this.filtersTimer) window.clearTimeout(this.filtersTimer);
    this.filtersTimer = window.setTimeout(() => {
      this.filtersTimer = null;
      this.recomputeView();
    }, 120);
  }

  clearSearch(): void {
    this.searchSku = '';
    this.recomputeView();
    this.cdr.markForCheck();
  }

  get kpiActivePct(): number {
    if (!this.kpiTotalSkus) return 0;
    return Math.round((this.kpiActiveSkus / this.kpiTotalSkus) * 1000) / 10;
  }

  get kpiNoActivityPct(): number {
    if (!this.kpiTotalSkus) return 0;
    return Math.round((this.kpiNoActivitySkus / this.kpiTotalSkus) * 1000) / 10;
  }

  private formatNow(): string {
    try {
      const d = new Date();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const yyyy = d.getFullYear();
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      return `${mm}/${dd}/${yyyy} ${hh}:${mi}`;
    } catch {
      return '';
    }
  }

  /** Xuất Excel: A = mã Bxxxxxx, B = số lần xuất, C = Stock check (Có/Không — snapshot ASM1+ASM2). */
  async exportExcel(): Promise<void> {
    if (!this.baseRows?.length || this.isExporting) return;
    this.isExporting = true;
    this.error = '';
    this.cdr.markForCheck();

    try {
      const stockSet = new Set<string>();
      await this.loadStockCheckSnapshotInto(stockSet);

      const rows = this.filterAndSortRows(this.baseRows || []);
      const start = String(this.startDate || '').trim().replace(/[^\d\-]/g, '') || 'start';
      const end = String(this.endDate || '').trim().replace(/[^\d\-]/g, '') || 'end';

      const aoa: (string | number)[][] = [
        ['Mã hàng', 'Số lần xuất', 'Stock check'],
        ...rows.map((r) => [
          r.sku,
          r.count ?? 0,
          stockSet.has(r.sku) ? 'Có' : 'Không'
        ])
      ];

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Export');
      XLSX.writeFile(wb, `materials-dashboard_${start}_${end}.xlsx`);
    } catch (e: any) {
      console.error(e);
      this.error = e?.message ? String(e.message) : 'Export failed';
    } finally {
      this.isExporting = false;
      this.cdr.markForCheck();
    }
  }

  private filterAndSortRows(base: Array<{ sku: string; group: string; count: number }>): Array<{ sku: string; group: string; count: number }> {
    const q = String(this.searchSku || '').trim().toUpperCase();
    const only = String(this.selectedGroup || '').trim();

    const filtered = base.filter((x) => {
      if (only && x.group !== only) return false;
      if (q && !x.sku.includes(q)) return false;
      return true;
    });

    // Mirror UI sorting logic
    const groupTotal = new Map<string, number>();
    if (this.groupByAaa || this.fillByGroup) {
      for (const r of filtered) groupTotal.set(r.group, (groupTotal.get(r.group) || 0) + (r.count || 0));
    }

    filtered.sort((a, b) => {
      if (this.groupByAaa || this.fillByGroup) {
        if (this.sortMode === 'activity_desc' || this.sortMode === 'activity_asc') {
          const ta = groupTotal.get(a.group) || 0;
          const tb = groupTotal.get(b.group) || 0;
          const gd = this.sortMode === 'activity_desc' ? tb - ta : ta - tb;
          if (gd !== 0) return gd;
        }
        if (this.sortMode === 'aging_desc' || this.sortMode === 'aging_asc') {
          const ga = this.groupMaxAging(a.group, filtered);
          const gb = this.groupMaxAging(b.group, filtered);
          const gd = this.compareAgingNullable(ga, gb, this.sortMode === 'aging_desc');
          if (gd !== 0) return gd;
        }
        const g = a.group.localeCompare(b.group);
        if (g !== 0) return g;
      }
      if (this.sortMode === 'activity_desc') {
        const d = (b.count || 0) - (a.count || 0);
        if (d !== 0) return d;
        return a.sku.localeCompare(b.sku);
      }
      if (this.sortMode === 'activity_asc') {
        const d = (a.count || 0) - (b.count || 0);
        if (d !== 0) return d;
        return a.sku.localeCompare(b.sku);
      }
      if (this.sortMode === 'aging_desc') {
        const d = this.compareAgingRows(a.sku, b.sku, true);
        if (d !== 0) return d;
        return a.sku.localeCompare(b.sku);
      }
      if (this.sortMode === 'aging_asc') {
        const d = this.compareAgingRows(a.sku, b.sku, false);
        if (d !== 0) return d;
        return a.sku.localeCompare(b.sku);
      }
      return a.sku.localeCompare(b.sku);
    });

    return filtered;
  }

  trackBySku(_: number, cell: CellVM): string {
    return cell.sku;
  }

  private parseSku(code: string): { sku: string; group: string } | null {
    const s = String(code || '').trim().toUpperCase();
    // Accept exact "Bxxxxxx" OR extract from longer material codes
    const m = /B(\d{6})/.exec(s);
    if (!m) return null;
    const digits = m[1];
    return { sku: `B${digits}`, group: digits.slice(0, 3) };
  }

  private parseIsoDate(iso: string, startOfDay: boolean): Date {
    const s = String(iso || '').trim();
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return new Date();
    if (startOfDay) d.setHours(0, 0, 0, 0);
    else d.setHours(23, 59, 59, 999);
    return d;
  }

  private applyModel(masterSkus: Set<string>, exportCountBySku: Map<string, number>): void {
    const list: Array<{ sku: string; group: string; count: number }> = [];
    let max = 0;
    let active = 0;
    for (const raw of masterSkus) {
      const p = this.parseSku(raw);
      if (!p) continue;
      const count = exportCountBySku.get(p.sku) || 0;
      if (count > max) max = count;
      if (count > 0) active++;
      list.push({ sku: p.sku, group: p.group, count });
    }

    // KPIs (master only)
    this.kpiTotalSkus = list.length;
    this.kpiActiveSkus = active;
    this.kpiNoActivitySkus = this.kpiTotalSkus - this.kpiActiveSkus;

    this.exportCountMax = max;
    this.exportBucketMax = Math.max(1, Math.ceil(max / 10));
    this.masterSkuList = list.map((x) => x.sku);
    this.baseRows = list;

    // Build initial view
    this.recomputeViewFrom(list);
  }

  private recomputeView(): void {
    // Use cached base rows (master SKU + activity count) to avoid rebuilding
    // maps from the rendered cells on every filter/sort change.
    this.recomputeViewFrom(this.baseRows || []);
  }

  private recomputeViewFrom(base: Array<{ sku: string; group: string; count: number }>): void {
    const filtered = this.filterAndSortRows(base);

    // Disable per-cell title tooltips when rendering a very large set (expensive string building)
    this.titlesEnabled = filtered.length <= 6000;

    this.renderCellsIncrementally(filtered);
  }

  private renderCellsIncrementally(rows: Array<{ sku: string; group: string; count: number }>): void {
    const token = ++this.renderToken;
    // Mutate existing array to avoid realloc churn; render progressively to keep UI responsive.
    this.cells.length = 0;
    this.cdr.markForCheck();

    const chunkSize = 2000;
    let i = 0;

    const runChunk = () => {
      if (token !== this.renderToken) return; // cancelled by newer render
      const end = Math.min(rows.length, i + chunkSize);
      for (; i < end; i++) {
        const r = rows[i];
        this.cells.push(this.buildSkuCell(r.sku, r.group, r.count));
      }
      this.cdr.markForCheck();
      if (i < rows.length) {
        window.setTimeout(runChunk, 0);
      }
    };

    runChunk();
  }

  private buildSkuCell(sku: string, group: string, exportCount: number): CellVM {
    const status: CellVM['status'] = exportCount > 0 ? 'EXPORTED' : 'NO_EXPORT';
    const fg = '#0f172a';
    const loc = this.locationBySku.get(sku) || '-';
    const level =
      exportCount <= 0 ? 'No export' : `${(Math.ceil(exportCount / 10) - 1) * 10 + 1}-${Math.ceil(exportCount / 10) * 10} times`;

    let bg: string;
    let fn: string;
    if (this.fillByGroup) {
      bg = this.groupColor(group);
      fn = 'Fill: Group';
    } else if (this.fillFunction === 'Location') {
      bg = this.locationColor(sku);
      fn = `Fill: Location (${loc})`;
    } else {
      bg = this.bucketColor(exportCount);
      fn = `Fill: Activities (${level})`;
    }

    let agingFlag: AgingFlagTier | null = null;
    if (
      this.layerMode === 'Aging' &&
      !this.fillByGroup &&
      this.fillFunction === 'Activities' &&
      this.agingBySku.has(sku)
    ) {
      const months = this.agingBySku.get(sku)!;
      agingFlag = this.agingFlagTierFromMonths(months);
      fn += `\nAging: ${months} tháng (cờ ${this.agingTierLabelVi(agingFlag)})`;
    }

    const stockChecked = this.stockCheckCompareEnabled && this.checkedSkuSet.has(sku);
    const scLine = stockChecked ? '\nStock check: đã kiểm kê (snapshot)' : '';
    const title = this.titlesEnabled ? `SKU: ${sku}\nGroup: ${group}\nExport count: ${exportCount}\n${fn}${scLine}` : '';
    return { sku, group, exportCount, status, bg, fg, title, stockChecked, agingFlag };
  }

  /** Ngưỡng theo tháng: &lt;12 xanh · 12–&lt;24 vàng · 24–36 cam · &gt;36 đỏ */
  private agingFlagTierFromMonths(months: number): AgingFlagTier {
    const m = Number(months);
    if (!Number.isFinite(m)) return 'green';
    if (m < 12) return 'green';
    if (m < 24) return 'yellow';
    if (m <= 36) return 'orange';
    return 'red';
  }

  private agingTierLabelVi(tier: AgingFlagTier): string {
    switch (tier) {
      case 'green':
        return 'xanh';
      case 'yellow':
        return 'vàng';
      case 'orange':
        return 'cam';
      default:
        return 'đỏ';
    }
  }

  private groupMaxAging(group: string, rows: Array<{ sku: string; group: string; count: number }>): number | null {
    let mx: number | null = null;
    for (const r of rows) {
      if (r.group !== group) continue;
      const v = this.agingBySku.get(r.sku);
      if (v === undefined || !Number.isFinite(v)) continue;
      if (mx === null || v > mx) mx = v;
    }
    return mx;
  }

  /** null = không có aging trong nhóm — xếp cuối */
  private compareAgingNullable(a: number | null, b: number | null, desc: boolean): number {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    const d = desc ? b - a : a - b;
    if (d === 0) return 0;
    return d > 0 ? 1 : -1;
  }

  /** Thiếu aging → xếp cuối */
  private compareAgingRows(aSku: string, bSku: string, desc: boolean): number {
    const va = this.agingBySku.get(aSku);
    const vb = this.agingBySku.get(bSku);
    const aMiss = va === undefined || !Number.isFinite(va);
    const bMiss = vb === undefined || !Number.isFinite(vb);
    if (aMiss && bMiss) return 0;
    if (aMiss) return 1;
    if (bMiss) return -1;
    const d = (va as number) - (vb as number);
    if (d === 0) return 0;
    return desc ? (d > 0 ? -1 : 1) : d > 0 ? 1 : -1;
  }

  private async ensureLocationsLoaded(): Promise<void> {
    if (this.masterLocationsLoaded || this.isLoadingLocations) return;
    this.isLoadingLocations = true;
    this.cdr.markForCheck();
    try {
      this.locationBySku = await this.svc.loadMasterSkuLocations(['ASM1', 'ASM2']);
      this.rebuildLocationRank();
      this.masterLocationsLoaded = true;
    } catch (e) {
      console.warn('[MaterialsDashboard] load locations failed', e);
    } finally {
      this.isLoadingLocations = false;
      this.cdr.markForCheck();
    }
  }

  private groupColor(group: string): string {
    const g = String(group || '').trim();
    if (!g) return '#E5E7EB';
    let n = 0;
    for (let i = 0; i < g.length; i++) n = (n * 31 + g.charCodeAt(i)) >>> 0;
    const pal = this.heatmapColors.groupPalette;
    const idx = n % pal.length;
    return pal[idx];
  }

  private bucketColor(exportCount: number): string {
    if (exportCount <= 0) return this.heatmapColors.noExport;
    const bucket = Math.ceil(exportCount / 10); // 1..N (1-10 => 1, 11-20 => 2, ...)
    const palette = this.heatmapColors.activityBuckets;
    const idx = Math.min(palette.length - 1, Math.max(0, bucket - 1));
    return palette[idx];
  }

  private rebuildLocationRank(): void {
    const locs = Array.from(new Set(Array.from(this.locationBySku.values()).filter(Boolean))).sort();
    this.locationRank.clear();
    locs.forEach((l, i) => this.locationRank.set(l, i));
  }

  private locationColor(sku: string): string {
    const loc = this.locationBySku.get(sku) || '';
    if (!loc) return '#E5E7EB';
    const idx = this.locationRank.get(loc) ?? 0;
    const max = Math.max(1, this.locationRank.size - 1);
    const t = Math.min(1, Math.max(0, idx / max));
    // Sky blue very light -> deep
    return this.lerpColor(this.heatmapColors.locationLight, this.heatmapColors.locationDark, t);
  }

  private lerpColor(a: string, b: string, t: number): string {
    const pa = this.hexToRgb(a);
    const pb = this.hexToRgb(b);
    if (!pa || !pb) return b;
    const r = Math.round(pa.r + (pb.r - pa.r) * t);
    const g = Math.round(pa.g + (pb.g - pa.g) * t);
    const bb = Math.round(pa.b + (pb.b - pa.b) * t);
    return `rgb(${r}, ${g}, ${bb})`;
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const h = String(hex || '').trim().replace('#', '');
    const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    const n = parseInt(s, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  tooltip(cell: CellVM): string {
    const bucketFrom = cell.exportCount <= 0 ? 0 : (Math.ceil(cell.exportCount / 10) - 1) * 10 + 1;
    const bucketTo = cell.exportCount <= 0 ? 0 : Math.ceil(cell.exportCount / 10) * 10;
    const level = cell.exportCount <= 0 ? 'No export' : `${bucketFrom}-${bucketTo} times`;
    const loc = this.locationBySku.get(cell.sku) || '-';
    const fn = this.fillByGroup
      ? 'Fill: Group'
      : this.fillFunction === 'Location'
        ? `Fill: Location (${loc})`
        : `Fill: Activities (${level})`;
    return `SKU: ${cell.sku}\nGroup: ${cell.group}\nExport count: ${cell.exportCount}\n${fn}`;
  }

  get distinctAaaOptions(): string[] {
    const set = new Set<string>();
    for (const c of this.cells) set.add(c.group);
    return Array.from(set).sort();
  }

  openMore(): void {
    this.importExportError = '';
    this.importExportSavedCount = 0;
    this.importAgingError = '';
    this.importAgingSavedSkuCount = 0;
    this.importInboundError = '';
    this.importInboundSavedCount = 0;
    this.importingExport = false;
    this.importingAging = false;
    this.importingInbound = false;
    this.showMorePopup = true;
  }

  goMenu(): void {
    this.router.navigate(['/menu']);
  }

  closeMore(): void {
    this.showMorePopup = false;
  }

  async onImportFileSelected(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) return;
    this.importExportError = '';
    this.importingExport = true;
    this.importExportSavedCount = 0;
    this.cdr.markForCheck();

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true }) as any[][];

      const parsed: ExportManifestRow[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || [];
        const rawCode = r[0];
        const rawDate = r[1];
        const rawQty = r[2];

        const code = this.normalizeSkuFromAny(rawCode);
        const date = this.parseExcelDate(rawDate);
        const qty = Number(rawQty ?? 0);
        if (!code || !date || !Number.isFinite(qty)) continue;
        parsed.push({ materialCode: code, exportDate: date, quantity: qty });
      }

      if (!parsed.length) throw new Error('Không đọc được dòng hợp lệ (cần cột A=mã, B=ngày, C=lượng).');
      const res = await this.svc.saveExportManifest(parsed, { sourceName: file.name });
      this.importExportSavedCount = res.saved;
      await this.reload();
    } catch (e: any) {
      console.error(e);
      this.importExportError = e?.message ? String(e.message) : 'Import failed';
    } finally {
      this.importingExport = false;
      if (input) input.value = '';
      this.cdr.markForCheck();
    }
  }

  async onImportAgingFileSelected(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) return;
    this.importAgingError = '';
    this.importingAging = true;
    this.importAgingSavedSkuCount = 0;
    this.cdr.markForCheck();

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true }) as any[][];

      const bySku: Record<string, number> = {};
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || [];
        const code = this.normalizeSkuFromAny(r[0]);
        const aging = Number(r[1]);
        if (!code || !Number.isFinite(aging)) continue;
        bySku[code] = aging;
      }

      if (!Object.keys(bySku).length) {
        throw new Error('Không đọc được dòng hợp lệ (cột A = mã Bxxxxxx, cột B = aging — số tháng).');
      }

      const res = await this.svc.replaceMaterialsAging(bySku, { sourceName: file.name });
      this.importAgingSavedSkuCount = res.saved;
      await this.refreshAgingMap();
      this.recomputeView();
    } catch (e: any) {
      console.error(e);
      this.importAgingError = e?.message ? String(e.message) : 'Import Aging failed';
    } finally {
      this.importingAging = false;
      if (input) input.value = '';
      this.cdr.markForCheck();
    }
  }

  async onImportInboundFileSelected(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) return;
    this.importInboundError = '';
    this.importingInbound = true;
    this.importInboundSavedCount = 0;
    this.cdr.markForCheck();

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, raw: true }) as any[][];

      const parsed: ImportManifestRow[] = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || [];
        const code = this.normalizeSkuFromAny(r[0]);
        const dt = this.parseExcelDate(r[1]);
        if (!code || !dt) continue;
        parsed.push({ materialCode: code, importDate: dt });
      }

      if (!parsed.length) throw new Error('Không đọc được dòng hợp lệ (cột A = mã, cột B = ngày nhập).');
      const res = await this.svc.saveImportManifest(parsed, { sourceName: file.name });
      this.importInboundSavedCount = res.saved;
    } catch (e: any) {
      console.error(e);
      this.importInboundError = e?.message ? String(e.message) : 'Import failed';
    } finally {
      this.importingInbound = false;
      if (input) input.value = '';
      this.cdr.markForCheck();
    }
  }

  downloadMaterialsTemplate(kind: 'export' | 'aging' | 'inbound'): void {
    let aoa: (string | number)[][];
    let filename: string;
    if (kind === 'export') {
      aoa = [
        ['Mã hàng (B+6 số)', 'Ngày xuất', 'Lượng'],
        ['B123456', '2025-01-15', 100]
      ];
      filename = 'template-bang-ke-xuat-kho.xlsx';
    } else if (kind === 'aging') {
      aoa = [
        ['Mã hàng (B+6 số)', 'Aging (tháng)'],
        ['B123456', 24]
      ];
      filename = 'template-aging.xlsx';
    } else {
      aoa = [
        ['Mã hàng (B+6 số)', 'Ngày nhập'],
        ['B123456', '2025-01-15']
      ];
      filename = 'template-bang-ke-nhap.xlsx';
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, filename);
  }

  private normalizeSkuFromAny(v: any): string | null {
    const s = String(v ?? '').trim().toUpperCase();
    const m = /B(\d{6})/.exec(s);
    if (m) return `B${m[1]}`;
    const d = /(\d{6})/.exec(s);
    if (d) return `B${d[1]}`;
    return null;
  }

  private parseExcelDate(v: any): Date | null {
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
    if (typeof v === 'number' && Number.isFinite(v)) {
      // Excel serial date
      const dc = XLSX.SSF.parse_date_code(v);
      if (dc && dc.y && dc.m && dc.d) return new Date(dc.y, dc.m - 1, dc.d);
    }
    const s = String(v ?? '').trim();
    if (!s) return null;
    // Try ISO / locale variants
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d;
    // dd/MM/yyyy
    const m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(s);
    if (m) {
      const dd = Number(m[1]);
      const mm = Number(m[2]);
      const yy = Number(m[3].length === 2 ? `20${m[3]}` : m[3]);
      const d2 = new Date(yy, mm - 1, dd);
      return !Number.isNaN(d2.getTime()) ? d2 : null;
    }
    return null;
  }
}

