import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import * as XLSX from 'xlsx';
import {
  AGING_FACTORIES, AGING_FACTORY_LABEL, AGING_FILE_KIND_LABEL, AgingFactory, AgingFactoryMeta, AgingReportService,
  FactoryLedger, ImportLogEntry, ParsedAgingFile, StoredReportInfo, parseAgingWorkbook,
} from '../../services/aging-report.service';
import {
  AGING_BUCKETS, AgingLevel, FactoryCompareResult, LotCompareRow, SkuCompareRow, compareFactory,
} from './aging-report.logic';

type FactoryView = 'ALL' | AgingFactory;
type ViewMode = 'summary' | 'lot' | 'sku';
type LevelFilter = 'all' | AgingLevel;

interface PendingFile extends ParsedAgingFile {
  rowCount: number;
  kindLabel: string;
  status: 'cho' | 'dang' | 'xong' | 'loi';
  error?: string;
}

interface BucketLine {
  label: string;
  values: Record<AgingFactory, number>;
  total: number;
  percent: number;
  calcTotal: number;
}

const PAGE_SIZE = 300;
const RATE_STORAGE_KEY = 'aging-report-usd-rate';

@Component({
  selector: 'app-aging-report',
  templateUrl: './aging-report.component.html',
  styleUrls: ['./aging-report.component.scss']
})
export class AgingReportComponent implements OnInit {
  readonly factories = AGING_FACTORIES;
  readonly factoryLabel = AGING_FACTORY_LABEL;
  readonly kindLabel = AGING_FILE_KIND_LABEL;

  factoryView: FactoryView = 'ALL';
  viewMode: ViewMode = 'summary';
  levelFilter: LevelFilter = 'error';
  searchText = '';
  /** Ô tìm kiếm dưới tiêu đề từng cột (key = tên cột) */
  lotColFilter: Record<string, string> = {};
  skuColFilter: Record<string, string> = {};
  hasColFilter = false;
  /** Thứ tự cột (sau cột Nhà máy) của bảng Theo lot / Theo mã TP — khớp với template */
  readonly lotFilterKeys = ['sku', 'lot', 'wh', 'agingInb', 'ledgerInb', 'agingMonths', 'calcMonths', 'agingQty',
    'ledgerQty', 'diffQty', 'inOut', 'value', 'status'];
  readonly skuFilterKeys = ['sku', 'name', 'cus', 'invQty', 'agingQtyScope', 'diffQty', 'agingQtyAll', 'agingValue', 'status'];
  usdRate = 25660;

  isLoading = false;
  loadError = '';
  statusLineText = '';

  meta: Partial<Record<AgingFactory, AgingFactoryMeta>> = {};
  private ledgers: Partial<Record<AgingFactory, FactoryLedger>> = {};
  selectedReportId: Partial<Record<AgingFactory, string>> = {};
  results: Partial<Record<AgingFactory, FactoryCompareResult>> = {};

  filteredLots: LotCompareRow[] = [];
  filteredSkus: SkuCompareRow[] = [];
  visibleCount = PAGE_SIZE;
  levelCounts: Record<LevelFilter, number> = { all: 0, error: 0, ok: 0, info: 0, scope: 0 };
  bucketLines: BucketLine[] = [];
  bucketTotal: BucketLine | null = null;
  whLines: { wh: string; values: Record<AgingFactory, number>; total: number }[] = [];
  factoryCards: {
    factory: AgingFactory; reportTo: string; ledgerRange: string; inventoryTo: string;
    lots: number; lotErrors: number; skuErrors: number; value: number; qty: number;
    /** Aging chốt sau ngày cuối bảng kê: ghi chú số mã chưa kiểm được */
    gapNote: string;
  }[] = [];

  showImportDialog = false;
  pendingFiles: PendingFile[] = [];
  isImporting = false;
  importMessage = '';

  showMoreMenu = false;
  showHistory = false;
  historyRows: (ImportLogEntry & { factory: AgingFactory })[] = [];

  constructor(private router: Router, private agingService: AgingReportService) {}

  ngOnInit(): void {
    try {
      const saved = Number(localStorage.getItem(RATE_STORAGE_KEY));
      if (saved > 0) this.usdRate = saved;
    } catch { /* bỏ qua */ }
    this.loadAll();
  }

  // ───────────────────────── Tải dữ liệu ─────────────────────────

  async loadAll(): Promise<void> {
    this.isLoading = true;
    this.loadError = '';
    try {
      await Promise.all(this.factories.map(async f => {
        const [meta, ledger] = await Promise.all([this.agingService.loadMeta(f), this.agingService.loadLedger(f)]);
        this.meta[f] = meta;
        this.ledgers[f] = ledger;
        const sel = this.selectedReportId[f];
        if (!sel || !meta.reports.some(r => r.id === sel)) this.selectedReportId[f] = meta.reports[0]?.id;
      }));
      await Promise.all(this.factories.map(f => this.computeFactory(f)));
      this.rebuild();
    } catch (e) {
      console.error('[Aging Report] load error', e);
      this.loadError = 'Không tải được dữ liệu Aging Report: ' + ((e as Error)?.message || e);
    } finally {
      this.isLoading = false;
    }
  }

  private async computeFactory(f: AgingFactory): Promise<void> {
    const meta = this.meta[f];
    const ledger = this.ledgers[f];
    const report = meta?.reports.find(r => r.id === this.selectedReportId[f]);
    if (!meta || !ledger || !report) {
      delete this.results[f];
      return;
    }
    const inventory = this.pickInventory(meta.inventories, report.to);
    const [agingRows, inventoryRows] = await Promise.all([
      this.agingService.loadAgingRows(report),
      inventory ? this.agingService.loadInventoryRows(inventory) : Promise.resolve(null),
    ]);
    const ledgerFrom = [meta.ledgerRange.N?.from, meta.ledgerRange.X?.from].filter(Boolean).sort()[0] || '';
    const ledgerTo = [meta.ledgerRange.N?.to, meta.ledgerRange.X?.to].filter(Boolean).sort()[0] || '';
    this.results[f] = compareFactory(f, ledger, ledgerFrom, report.to, agingRows, inventoryRows, {
      ledgerTo, inventoryTo: inventory?.to || '',
    });
  }

  /** BC tồn kho cùng ngày với Aging; không có thì lấy bản gần nhất trước đó. */
  private pickInventory(list: StoredReportInfo[], to: string): StoredReportInfo | undefined {
    return list.find(i => i.to === to) || list.filter(i => i.to <= to).sort((a, b) => b.to.localeCompare(a.to))[0];
  }

  async onReportChange(f: AgingFactory, id: string): Promise<void> {
    this.selectedReportId[f] = id;
    this.isLoading = true;
    try {
      await this.computeFactory(f);
      this.rebuild();
    } finally {
      this.isLoading = false;
    }
  }

  // ───────────────────────── Lọc / hiển thị ─────────────────────────

  setFactoryView(v: FactoryView): void {
    this.factoryView = v;
    this.rebuild();
  }

  setViewMode(v: ViewMode): void {
    this.viewMode = v;
    this.visibleCount = PAGE_SIZE;
    this.applyFilters();
  }

  setLevelFilter(v: LevelFilter): void {
    this.levelFilter = v;
    this.visibleCount = PAGE_SIZE;
    this.applyFilters();
  }

  onSearchChange(): void {
    this.visibleCount = PAGE_SIZE;
    this.applyFilters();
  }

  showMore(): void {
    this.visibleCount += PAGE_SIZE;
  }

  onRateChange(): void {
    try { localStorage.setItem(RATE_STORAGE_KEY, String(this.usdRate)); } catch { /* bỏ qua */ }
  }

  get viewFactories(): AgingFactory[] {
    return this.factoryView === 'ALL' ? this.factories : [this.factoryView];
  }

  private rebuild(): void {
    this.buildSummary();
    this.applyFilters();
    this.statusLineText = this.factories.map(f => {
      const r = this.results[f];
      const m = this.meta[f];
      const range = this.ledgerRangeText(m);
      return r
        ? `${AGING_FACTORY_LABEL[f]}: Aging ${this.fmtDate(r.reportTo)} · bảng kê ${range}`
        : `${AGING_FACTORY_LABEL[f]}: chưa có báo cáo tuổi hàng`;
    }).join('   |   ');
  }

  private ledgerRangeText(m: AgingFactoryMeta | undefined): string {
    const n = m?.ledgerRange.N;
    const x = m?.ledgerRange.X;
    if (!n && !x) return 'chưa có';
    const from = [n?.from, x?.from].filter(Boolean).sort()[0] || '';
    const to = [n?.to, x?.to].filter(Boolean).sort().reverse()[0] || '';
    return `${this.fmtDate(from)} → ${this.fmtDate(to)}`;
  }

  /** Chữ của từng cột (giống nội dung hiển thị) để lọc theo ô tìm kiếm dưới tiêu đề cột. */
  private lotColText(r: LotCompareRow): Record<string, string> {
    return {
      factory: r.factory, sku: `${r.sku} ${r.name}`, lot: r.lot || '(không lô)', wh: r.wh,
      agingInb: this.fmtDate(r.agingInb), ledgerInb: this.fmtDate(r.ledgerInb),
      agingMonths: r.agingMonths == null ? '' : String(r.agingMonths),
      calcMonths: r.calcMonths == null ? '' : String(r.calcMonths),
      agingQty: r.inAging ? String(r.agingQty) : '', ledgerQty: r.ledgerQty == null ? '' : String(r.ledgerQty),
      diffQty: `${r.diffQty ?? ''} ${r.openingQty != null ? 'đầu kỳ ' + r.openingQty : ''}`,
      inOut: r.ledgerQty == null ? '' : `${r.inQty} / ${r.outQty}`, value: String(Math.round(r.value)),
      status: r.statusText,
    };
  }

  private skuColText(r: SkuCompareRow): Record<string, string> {
    return {
      factory: r.factory, sku: r.sku, name: r.name, cus: r.cus,
      invQty: r.invQty == null ? 'chưa có' : String(r.invQty), agingQtyScope: String(r.agingQtyScope),
      diffQty: r.diffQty == null ? '' : String(r.diffQty), agingQtyAll: String(r.agingQtyAll),
      agingValue: String(Math.round(r.agingValue)), status: r.statusText,
    };
  }

  /** Ô lọc cột: chứa chuỗi, không phân biệt hoa thường, bỏ dấu phẩy / chấm ngăn cách số. */
  private activeColFilters(f: Record<string, string>): [string, string][] {
    return Object.keys(f)
      .map(k => [k, this.normFilter(f[k])] as [string, string])
      .filter(([, v]) => !!v);
  }

  private normFilter(s: string): string {
    return String(s ?? '').trim().toLowerCase().replace(/(\d)[,.](?=\d{3}\b)/g, '$1');
  }

  clearColFilters(): void {
    this.lotColFilter = {};
    this.skuColFilter = {};
    this.onSearchChange();
  }

  private applyFilters(): void {
    const q = this.searchText.trim().toLowerCase();
    const counts: Record<LevelFilter, number> = { all: 0, error: 0, ok: 0, info: 0, scope: 0 };
    const lotCols = this.activeColFilters(this.lotColFilter);
    const skuCols = this.activeColFilters(this.skuColFilter);
    const colsMatch = (text: Record<string, string>, cols: [string, string][]) =>
      cols.every(([k, v]) => this.normFilter(text[k]).includes(v));
    const pass = (r: { level: AgingLevel; searchText: string }) => {
      if (q && !r.searchText.includes(q)) return false;
      counts.all++;
      counts[r.level]++;
      return this.levelFilter === 'all' || r.level === this.levelFilter;
    };
    const lots: LotCompareRow[] = [];
    const skus: SkuCompareRow[] = [];
    for (const f of this.viewFactories) {
      const r = this.results[f];
      if (!r) continue;
      if (this.viewMode === 'sku') {
        skus.push(...r.skus.filter(x => (!skuCols.length || colsMatch(this.skuColText(x), skuCols)) && pass(x)));
      } else {
        lots.push(...r.lots.filter(x => (!lotCols.length || colsMatch(this.lotColText(x), lotCols)) && pass(x)));
      }
    }
    this.hasColFilter = (this.viewMode === 'sku' ? skuCols : lotCols).length > 0;
    this.filteredLots = lots;
    this.filteredSkus = skus;
    this.levelCounts = counts;
  }

  private buildSummary(): void {
    const zero = (): Record<AgingFactory, number> => ({ KZ: 0, LH: 0 });
    const facs = this.viewFactories.filter(f => this.results[f]);
    const labels = new Set<string>(AGING_BUCKETS);
    facs.forEach(f => Object.keys(this.results[f]!.bucketFile).forEach(k => labels.add(k)));
    const grand = facs.reduce((s, f) => s + this.results[f]!.totalValue, 0);
    this.bucketLines = Array.from(labels).map(label => {
      const values = zero();
      let calcTotal = 0;
      facs.forEach(f => {
        values[f] = this.results[f]!.bucketFile[label] || 0;
        calcTotal += this.results[f]!.bucketCalc[label] || 0;
      });
      const total = values.KZ + values.LH;
      return { label, values, total, percent: grand ? (total / grand) * 100 : 0, calcTotal };
    }).filter(l => (AGING_BUCKETS as readonly string[]).includes(l.label) || l.total || l.calcTotal);
    const tv = zero();
    facs.forEach(f => (tv[f] = this.results[f]!.totalValue));
    this.bucketTotal = { label: 'Grand Total', values: tv, total: grand, percent: grand ? 100 : 0, calcTotal: grand };

    const whs = new Set<string>();
    facs.forEach(f => Object.keys(this.results[f]!.valueByWh).forEach(w => whs.add(w)));
    this.whLines = Array.from(whs).sort().map(wh => {
      const values = zero();
      facs.forEach(f => (values[f] = this.results[f]!.valueByWh[wh] || 0));
      return { wh, values, total: values.KZ + values.LH };
    });

    this.factoryCards = facs.map(f => {
      const r = this.results[f]!;
      const meta = this.meta[f]!;
      const report = meta.reports.find(x => x.id === this.selectedReportId[f]);
      const inv = report ? this.pickInventory(meta.inventories, report.to) : undefined;
      return {
        factory: f,
        reportTo: r.reportTo,
        ledgerRange: this.ledgerRangeText(meta),
        inventoryTo: inv?.to || '',
        lots: r.lots.filter(l => l.inAging).length,
        lotErrors: r.lots.filter(l => l.level === 'error').length,
        skuErrors: r.skus.filter(s => s.level === 'error').length,
        gapNote: r.ledgerTo && r.ledgerTo < r.reportTo
          ? `Bảng kê chỉ đến ${this.fmtDate(r.ledgerTo)}, Aging chốt ${this.fmtDate(r.reportTo)}: ${r.gapSkuCount} mã có phát sinh sau ngày bảng kê, chưa kiểm được tồn lot`
          : '',
        value: r.totalValue,
        qty: r.totalQty,
      };
    });
  }

  fmtDate(iso: string): string {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }

  trackById(_: number, r: { id: string }): string {
    return r.id;
  }

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  // ───────────────────────── Import ─────────────────────────

  openImportDialog(): void {
    this.pendingFiles = [];
    this.importMessage = '';
    this.showImportDialog = true;
  }

  closeImportDialog(): void {
    if (this.isImporting) return;
    this.showImportDialog = false;
  }

  async onFilesSelected(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = '';
    this.importMessage = files.length ? 'Đang đọc file…' : '';
    for (const file of files) {
      try {
        const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
        const parsed = parseAgingWorkbook(wb, file.name);
        if (!parsed) {
          this.pendingFiles.push(this.badFile(file.name, 'Không nhận diện được loại file (cần Bảng kê phiếu nhập / xuất, Báo cáo tuổi hàng hoặc Báo cáo tồn kho)'));
          continue;
        }
        const rows = parsed.ledgerRows || parsed.agingRows || parsed.inventoryRows || [];
        const p: PendingFile = { ...parsed, rowCount: rows.length, kindLabel: AGING_FILE_KIND_LABEL[parsed.kind], status: 'cho' };
        if (!p.to) { p.status = 'loi'; p.error = 'Không đọc được ngày báo cáo trong tiêu đề'; }
        else if (!rows.length) { p.status = 'loi'; p.error = 'File không có dòng dữ liệu'; }
        this.pendingFiles = this.pendingFiles.filter(x => x.fileName !== p.fileName).concat(p);
      } catch (e) {
        this.pendingFiles.push(this.badFile(file.name, 'Lỗi đọc file: ' + ((e as Error)?.message || e)));
      }
    }
    this.importMessage = '';
  }

  private badFile(fileName: string, error: string): PendingFile {
    return { fileName, kind: 'aging', factory: null, from: '', to: '', rowCount: 0, kindLabel: '—', status: 'loi', error };
  }

  removePending(p: PendingFile): void {
    this.pendingFiles = this.pendingFiles.filter(x => x !== p);
  }

  get canSaveImport(): boolean {
    return !this.isImporting && this.pendingFiles.some(p => p.status === 'cho') &&
      this.pendingFiles.filter(p => p.status === 'cho').every(p => !!p.factory);
  }

  async saveImport(): Promise<void> {
    if (!this.canSaveImport) return;
    this.isImporting = true;
    // Bảng kê trước, báo cáo sau
    const order: Record<string, number> = { N: 0, X: 1, ton: 2, aging: 3 };
    const queue = this.pendingFiles.filter(p => p.status === 'cho').sort((a, b) => order[a.kind] - order[b.kind]);
    let ok = 0;
    for (const p of queue) {
      p.status = 'dang';
      this.importMessage = `Đang lưu ${p.fileName}…`;
      try {
        const f = p.factory as AgingFactory;
        await this.agingService.saveParsedFile({ ...p, factory: f }, this.ledgers[f] || null);
        p.status = 'xong';
        ok++;
      } catch (e) {
        console.error('[Aging Report] save error', p.fileName, e);
        p.status = 'loi';
        p.error = 'Lưu thất bại: ' + ((e as Error)?.message || e);
      }
    }
    this.importMessage = `Đã lưu ${ok}/${queue.length} file. Đang tính lại báo cáo…`;
    this.selectedReportId = {};
    await this.loadAll();
    this.importMessage = `Đã lưu ${ok}/${queue.length} file.`;
    this.isImporting = false;
  }

  // ───────────────────────── More: lịch sử, xuất Excel ─────────────────────────

  toggleMoreMenu(): void {
    this.showMoreMenu = !this.showMoreMenu;
  }

  openHistory(): void {
    this.showMoreMenu = false;
    this.historyRows = this.factories
      .flatMap(f => (this.meta[f]?.imports || []).map(i => ({ ...i, factory: f })))
      .sort((a, b) => b.at.localeCompare(a.at));
    this.showHistory = true;
  }

  exportExcel(): void {
    this.showMoreMenu = false;
    const facs = this.viewFactories.filter(f => this.results[f]);
    if (!facs.length) return;
    const wb = XLSX.utils.book_new();

    const summary: (string | number)[][] = [
      ['FGs Aging Report – tổng hợp'],
      ['Tỷ giá', this.usdRate],
      [],
      ['Type of Aging', ...facs.map(f => AGING_FACTORY_LABEL[f] + ' (VND)'), 'Tổng (VND)', 'Tổng (USD)', '%', 'Tổng tính lại theo ngày nhập (VND)'],
      ...this.bucketLines.concat(this.bucketTotal ? [this.bucketTotal] : []).map(l => [
        l.label, ...facs.map(f => Math.round(l.values[f])), Math.round(l.total),
        this.usdRate ? Math.round((l.total / this.usdRate) * 100) / 100 : 0, Math.round(l.percent * 100) / 100, Math.round(l.calcTotal),
      ]),
      [],
      ['WH', ...facs.map(f => AGING_FACTORY_LABEL[f] + ' (VND)'), 'Tổng (VND)'],
      ...this.whLines.map(l => [l.wh, ...facs.map(f => Math.round(l.values[f])), Math.round(l.total)]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Tổng hợp');

    const lotHeader = [
      'Nhà máy', 'Mã TP', 'Tên', 'Khách hàng', 'Mã lô', 'Kho', 'Ngày nhập (Aging)', 'Ngày nhập (bảng kê)',
      'Số tháng (Aging)', 'Số tháng (tính lại)', 'Nhóm tuổi (Aging)', 'Nhóm tuổi (tính lại)', 'Tồn Aging', 'Tồn bảng kê',
      'Chênh lệch', 'Tồn đầu suy ra', 'Nhập trong kỳ', 'Xuất trong kỳ', 'Đơn giá', 'Giá trị', 'Kết quả',
    ];
    const lots = facs.flatMap(f => this.results[f]!.lots);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([lotHeader, ...lots.map(r => [
      AGING_FACTORY_LABEL[r.factory], r.sku, r.name, r.cus, r.lot, r.wh, this.fmtDate(r.agingInb), this.fmtDate(r.ledgerInb),
      r.agingMonths ?? '', r.calcMonths ?? '', r.agingType, r.calcType, r.agingQty, r.ledgerQty ?? '', r.diffQty ?? '',
      r.openingQty ?? '', r.inQty, r.outQty, r.price, Math.round(r.value), r.statusText,
    ])]), 'Theo lot');

    const skuHeader = ['Nhà máy', 'Mã TP', 'Tên', 'Khách hàng', 'Tồn BC tồn kho', 'Tồn Aging (kho bảng kê)', 'Chênh lệch', 'Tồn Aging (tất cả kho)', 'Giá trị Aging', 'Kết quả'];
    const skus = facs.flatMap(f => this.results[f]!.skus);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([skuHeader, ...skus.map(r => [
      AGING_FACTORY_LABEL[r.factory], r.sku, r.name, r.cus, r.invQty ?? '', r.agingQtyScope, r.diffQty ?? '', r.agingQtyAll,
      Math.round(r.agingValue), r.statusText,
    ])]), 'Theo mã TP');

    const tag = this.factoryView === 'ALL' ? 'Tong' : this.factoryView;
    const date = facs.map(f => this.results[f]!.reportTo).sort().reverse()[0] || '';
    XLSX.writeFile(wb, `Aging_Report_${tag}_${date}.xlsx`);
  }
}
