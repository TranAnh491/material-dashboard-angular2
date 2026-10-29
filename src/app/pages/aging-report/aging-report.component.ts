import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import * as XLSX from 'xlsx';
import {
  AGING_FACTORIES, AGING_FACTORY_LABEL, AGING_FILE_KIND_LABEL, AgingCorrection, AgingFactory, AgingFactoryMeta,
  AgingReportService, AgingRow, FactoryLedger, ImportLogEntry, InventoryRow, ParsedAgingFile, StoredReportInfo,
  parseAgingWorkbook,
} from '../../services/aging-report.service';
import {
  AGING_BUCKETS, AgingLevel, FactoryCompareResult, FixSuggestion, ISSUE, LotCompareRow, SkuCompareRow, WorkAgingRow,
  agingBucket, agingMonths, applyCorrections, compareFactory, isExcludedSku, suggestFix,
} from './aging-report.logic';

/** Một dòng của tab Cần sửa: lot + sai ở đâu + đề xuất. */
interface FixRow {
  id: string;
  lot: LotCompareRow;
  reasons: string[];
  suggestion: FixSuggestion | null;
  /** Đề xuất (tự động) hoặc gợi ý sửa tay */
  suggestText: string;
  state: FixFilter;
  colText: Record<string, string>;
}

type FixFilter = 'todo' | 'done' | 'ignored' | 'note';

const FIX_STATE_LABEL: Record<FixFilter, string> = { todo: 'Chưa sửa', done: 'Đã sửa', ignored: 'Bỏ qua', note: 'Lưu ý' };

/** Một lot trong phần mở rộng của bảng Theo mã TP, kèm câu giải thích sai ở đâu. */
interface SkuLotDetail {
  lot: LotCompareRow;
  reasons: string[];
}

type FactoryView = 'ALL' | AgingFactory;
type ViewMode = 'fix' | 'summary' | 'lot' | 'sku';
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
  viewMode: ViewMode = 'fix';
  levelFilter: LevelFilter = 'error';
  searchText = '';
  /** Ô tìm kiếm dưới tiêu đề từng cột (key = tên cột) */
  lotColFilter: Record<string, string> = {};
  skuColFilter: Record<string, string> = {};
  hasColFilter = false;
  /** Dòng mã TP đang mở chi tiết lot */
  expandedSkuId: string | null = null;
  expandedLots: SkuLotDetail[] = [];
  expandedSkuNote = '';
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
  /** Dữ liệu đã tải của báo cáo đang chọn (để tính lại ngay khi sửa, không tải lại) */
  private loaded: Partial<Record<AgingFactory, {
    reportId: string; reportTo: string; agingRows: AgingRow[]; inventoryRows: InventoryRow[] | null;
    inventoryTo: string; corrections: Record<string, AgingCorrection>;
  }>> = {};
  /** Báo cáo tuổi hàng sau khi áp chỉnh sửa (đã bỏ mã A) — dùng xuất file đã hiệu chỉnh */
  private workRows: Partial<Record<AgingFactory, WorkAgingRow[]>> = {};

  // ── Tab Cần sửa ──
  fixFilter: FixFilter | 'all' = 'todo';
  fixRowsAll: FixRow[] = [];
  filteredFixRows: FixRow[] = [];
  fixCounts: Record<FixFilter | 'all', number> = { todo: 0, done: 0, ignored: 0, note: 0, all: 0 };
  fixColFilter: Record<string, string> = {};
  readonly fixFilterKeys = ['sku', 'lot', 'wh', 'where', 'suggest', 'status'];

  // ── Form sửa 1 dòng ──
  editRow: LotCompareRow | null = null;
  editForm = { lot: '', inb: '', qty: 0, price: 0, note: '' };
  editPreview = { months: '' as string | number, type: '', value: 0 };
  isSaving = false;
  actionMessage = '';

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
    fixed: number; ignored: number;
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

  /** Tải báo cáo tuổi hàng, BC tồn kho và chỉnh sửa của báo cáo đang chọn, rồi đối chiếu. */
  private async computeFactory(f: AgingFactory): Promise<void> {
    const meta = this.meta[f];
    const report = meta?.reports.find(r => r.id === this.selectedReportId[f]);
    if (!meta || !this.ledgers[f] || !report) {
      delete this.results[f];
      delete this.loaded[f];
      return;
    }
    const inventory = this.pickInventory(meta.inventories, report.to);
    const [agingRows, inventoryRows, corrections] = await Promise.all([
      this.agingService.loadAgingRows(report),
      inventory ? this.agingService.loadInventoryRows(inventory) : Promise.resolve(null),
      this.agingService.loadCorrections(report.id),
    ]);
    this.loaded[f] = { reportId: report.id, reportTo: report.to, agingRows, inventoryRows, inventoryTo: inventory?.to || '', corrections };
    this.recompute(f);
  }

  /** Đối chiếu lại từ dữ liệu đã tải (sau khi sửa / bỏ qua một dòng). */
  private recompute(f: AgingFactory): void {
    const meta = this.meta[f];
    const ledger = this.ledgers[f];
    const d = this.loaded[f];
    if (!meta || !ledger || !d) return;
    const ledgerFrom = [meta.ledgerRange.N?.from, meta.ledgerRange.X?.from].filter(Boolean).sort()[0] || '';
    const ledgerTo = [meta.ledgerRange.N?.to, meta.ledgerRange.X?.to].filter(Boolean).sort()[0] || '';
    const work = applyCorrections(d.agingRows, d.corrections, d.reportTo);
    const ignored: Record<string, string> = {};
    Object.values(d.corrections).forEach(c => { if (c.action === 'ignore') ignored[c.key] = c.note || ''; });
    this.workRows[f] = work.filter(r => !isExcludedSku(r.sku));
    this.results[f] = compareFactory(f, ledger, ledgerFrom, d.reportTo, work, d.inventoryRows, {
      ledgerTo, inventoryTo: d.inventoryTo, ignored,
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
    this.buildFixRows();
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
    this.fixColFilter = {};
    this.onSearchChange();
  }

  setFixFilter(v: FixFilter | 'all'): void {
    this.fixFilter = v;
    this.visibleCount = PAGE_SIZE;
    this.applyFilters();
  }

  /** Danh sách tab Cần sửa: lot sai, lot đã sửa / bỏ qua, và lot chỉ cần lưu ý (phát sinh sau ngày bảng kê). */
  private buildFixRows(): void {
    const priceBySku = this.priceBySku();
    const rows: FixRow[] = [];
    for (const f of this.viewFactories) {
      const r = this.results[f];
      if (!r) continue;
      for (const l of r.lots) {
        const relevant = l.level === 'error' || l.fix !== 'none' || (l.level === 'info' && l.issues.includes(ISSUE.afterLedger));
        if (!relevant) continue;
        const state: FixFilter = l.level === 'error' ? 'todo'
          : l.fix === 'ignored' ? 'ignored'
          : l.fix !== 'none' ? 'done' : 'note';
        const reasons = this.explainLot(l);
        const suggestion = suggestFix(l, r.reportTo, priceBySku);
        const suggestText = suggestion?.text || (state === 'todo' ? this.manualHint(l) : '');
        rows.push({
          id: l.id, lot: l, reasons, suggestion, state, suggestText,
          colText: {
            factory: l.factory, sku: `${l.sku} ${l.name}`, lot: l.lot || '(không lô)', wh: l.wh,
            where: reasons.join(' '), suggest: suggestText, status: FIX_STATE_LABEL[state],
          },
        });
      }
    }
    const order: Record<FixFilter, number> = { todo: 0, done: 1, ignored: 2, note: 3 };
    rows.sort((a, b) => order[a.state] - order[b.state] || a.lot.sku.localeCompare(b.lot.sku) || a.lot.lot.localeCompare(b.lot.lot));
    this.fixRowsAll = rows;
  }

  /** Gợi ý khi không tự sửa được. */
  private manualHint(l: LotCompareRow): string {
    if (l.issues.includes(ISSUE.overExport) || l.issues.includes(ISSUE.belowMovement)) return 'Kiểm tra mã lô trên phiếu xuất, rồi Sửa tay hoặc Bỏ qua';
    if (l.issues.includes(ISSUE.noReceipt)) return 'Kiểm tra phiếu nhập của lô, rồi Sửa tay ngày nhập';
    if (l.issues.includes(ISSUE.noInb)) return 'Sửa tay: nhập ngày nhập';
    if (l.issues.includes(ISSUE.zeroValue)) return 'Sửa tay: nhập đơn giá khi có giá vốn';
    return 'Sửa tay';
  }

  /** Đơn giá theo mã (lấy dòng Aging đầu tiên có giá) — gợi ý giá cho lot thêm mới. */
  private priceBySku(): Map<string, number> {
    const m = new Map<string, number>();
    this.factories.forEach(f => (this.workRows[f] || []).forEach(r => {
      const k = `${f}|${r.sku}`;
      if (r.price > 0 && !m.has(k)) m.set(k, r.price);
    }));
    return m;
  }

  private applyFilters(): void {
    if (this.viewMode === 'fix') {
      const q = this.searchText.trim().toLowerCase();
      const cols = this.activeColFilters(this.fixColFilter);
      const counts: Record<FixFilter | 'all', number> = { todo: 0, done: 0, ignored: 0, note: 0, all: 0 };
      this.filteredFixRows = this.fixRowsAll.filter(r => {
        if (q && !r.lot.searchText.includes(q)) return false;
        if (cols.length && !cols.every(([k, v]) => this.normFilter(r.colText[k]).includes(v))) return false;
        counts.all++;
        counts[r.state]++;
        return this.fixFilter === 'all' || r.state === this.fixFilter;
      });
      this.fixCounts = counts;
      this.hasColFilter = cols.length > 0;
      return;
    }
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
        fixed: r.lots.filter(l => (l.fix === 'edited' || l.fix === 'added') && l.level !== 'error').length,
        ignored: r.lots.filter(l => l.fix === 'ignored').length,
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

  // ───────────────────────── Theo mã TP: mở các lot của mã ─────────────────────────

  /** Bấm 1 dòng mã TP → hiện các lot của mã đó (lot sai lên đầu) và lý do sai. */
  toggleSkuDetail(r: SkuCompareRow): void {
    if (this.expandedSkuId === r.id) {
      this.expandedSkuId = null;
      this.expandedLots = [];
      this.expandedSkuNote = '';
      return;
    }
    const order: Record<AgingLevel, number> = { error: 0, info: 1, ok: 2, scope: 3 };
    const lots = (this.results[r.factory]?.lots || [])
      .filter(l => l.sku === r.sku)
      .sort((a, b) => order[a.level] - order[b.level] || a.lot.localeCompare(b.lot));
    this.expandedSkuId = r.id;
    this.expandedLots = lots.map(lot => ({ lot, reasons: this.explainLot(lot) }));
    this.expandedSkuNote = r.diffQty
      ? `BC tồn kho ${this.fmtNum(r.invQty)} · Aging (TP, DL) ${this.fmtNum(r.agingQtyScope)} · lệch ${this.fmtNum(r.diffQty)}`
      : '';
  }

  private fmtNum(n: number | null | undefined): string {
    return n == null ? '' : n.toLocaleString('en-US', { maximumFractionDigits: 3 });
  }

  /** Câu giải thích cho từng lỗi của lot (cùng dữ liệu đang hiển thị ở bảng Theo lot). */
  private explainLot(l: LotCompareRow): string[] {
    const d = (s: string) => this.fmtDate(s) || '(trống)';
    return l.issues.map(issue => {
      switch (issue) {
        case ISSUE.qty: return `Sai tồn: Aging ${this.fmtNum(l.agingQty)}, bảng kê ${this.fmtNum(l.ledgerQty)} (lệch ${this.fmtNum(l.diffQty)})`;
        case ISSUE.inb: return `Sai ngày nhập: Aging ${d(l.agingInb)}, phiếu nhập ${d(l.ledgerInb)}`;
        case ISSUE.months: return `Sai số tháng: Aging ${l.agingMonths ?? '(trống)'}, tính lại ${l.calcMonths ?? ''}`;
        case ISSUE.type: return `Sai nhóm tuổi: Aging "${l.agingType || '(trống)'}", đúng là "${l.calcType}"`;
        case ISSUE.value: return `Sai giá trị: ${this.fmtNum(l.agingQty)} × ${this.fmtNum(l.price)} ≠ ${this.fmtNum(Math.round(l.value))}`;
        case ISSUE.zeroValue: return `Giá trị = 0: tồn ${this.fmtNum(l.agingQty)} nhưng đơn giá 0 (chưa có giá vốn)`;
        case ISSUE.noInb: return 'Thiếu ngày nhập trong Aging';
        case ISSUE.noReceipt: return `Không có phiếu nhập: Aging ghi nhập ${d(l.agingInb)} nhưng bảng kê không có phiếu nhập lot này`;
        case ISSUE.belowMovement: return `Tồn Aging < phát sinh: Aging ${this.fmtNum(l.agingQty)}, bảng kê nhập − xuất ${this.fmtNum(l.ledgerQty)}`;
        case ISSUE.missingInAging: return `Thiếu trong Aging: bảng kê còn ${this.fmtNum(l.ledgerQty)} (nhập ${this.fmtNum(l.inQty)}, xuất ${this.fmtNum(l.outQty)}) nhưng Aging không có lot này`;
        case ISSUE.overExport: return `Xuất vượt nhập: nhập ${this.fmtNum(l.inQty)}, xuất ${this.fmtNum(l.outQty)}`;
        case ISSUE.afterLedger: return 'Có phiếu sau ngày cuối bảng kê, chưa kiểm được tồn lot';
        default: return issue;
      }
    });
  }

  // ───────────────────────── Sửa / bỏ qua / hoàn tác ─────────────────────────

  /** 1 bấm: áp đề xuất (theo bảng kê) cho lot sai. */
  async applySuggestion(row: FixRow): Promise<void> {
    const s = row.suggestion;
    if (!s) return;
    const l = row.lot;
    await this.saveCorrection(l, s.action === 'add'
      ? { action: 'add', sku: l.sku, name: l.name, unit: 'PCS', wh: l.wh, cus: l.cus, lot: l.lot, inb: s.inb, qty: s.qty, price: s.price ?? 0, note: 'Áp đề xuất theo bảng kê' }
      : { action: 'edit', lot: l.lot, inb: s.inb ?? l.agingInb, qty: s.qty ?? l.agingQty, price: l.price, note: 'Áp đề xuất theo bảng kê' },
      `Đã sửa ${l.sku} lô ${l.lot || '(không lô)'}: ${s.text}`);
  }

  async ignoreRow(l: LotCompareRow): Promise<void> {
    await this.saveCorrection(l, { action: 'ignore', note: '' }, `Đã bỏ qua lỗi của ${l.sku} lô ${l.lot || '(không lô)'}`);
  }

  async revertRow(l: LotCompareRow): Promise<void> {
    await this.saveCorrection(l, null, `Đã hoàn tác ${l.sku} lô ${l.lot || '(không lô)'} về số liệu gốc`);
  }

  /** Mở form sửa tay cho 1 lot (từ tab Cần sửa hoặc phần mở rộng Theo mã TP). */
  openEdit(l: LotCompareRow): void {
    const isAdd = !l.inAging || l.fix === 'added';
    this.editRow = l;
    this.editForm = {
      lot: l.lot,
      inb: isAdd && !l.inAging ? l.ledgerInb : l.agingInb,
      qty: isAdd && !l.inAging ? (l.ledgerQty ?? 0) : l.agingQty,
      price: isAdd && !l.inAging ? (this.priceBySku().get(`${l.factory}|${l.sku}`) || 0) : l.price,
      note: l.fixNote || '',
    };
    this.onEditChange();
  }

  closeEdit(): void {
    if (this.isSaving) return;
    this.editRow = null;
  }

  /** Lấy giá trị theo bảng kê vào ô đang sửa. */
  useLedger(field: 'inb' | 'qty'): void {
    if (!this.editRow) return;
    if (field === 'inb' && this.editRow.ledgerInb) this.editForm.inb = this.editRow.ledgerInb;
    if (field === 'qty' && this.editRow.ledgerQty != null) this.editForm.qty = this.editRow.ledgerQty;
    this.onEditChange();
  }

  onEditChange(): void {
    const end = this.editRow ? this.results[this.editRow.factory]?.reportTo || '' : '';
    const months = agingMonths(this.editForm.inb, end);
    this.editPreview = {
      months: months ?? '',
      type: months == null ? '' : agingBucket(months),
      value: Math.round((Number(this.editForm.qty) || 0) * (Number(this.editForm.price) || 0)),
    };
  }

  async saveEdit(): Promise<void> {
    const l = this.editRow;
    if (!l) return;
    const v = this.editForm;
    const isAdd = !l.inAging || l.fix === 'added';
    const base = { lot: String(v.lot || '').trim(), inb: v.inb, qty: Number(v.qty) || 0, price: Number(v.price) || 0, note: v.note || '' };
    const ok = await this.saveCorrection(l, isAdd
      ? { action: 'add', sku: l.sku, name: l.name, unit: 'PCS', wh: l.wh, cus: l.cus, ...base }
      : { action: 'edit', ...base },
      `Đã lưu chỉnh sửa ${l.sku} lô ${base.lot || '(không lô)'}`);
    if (ok) this.editRow = null;
  }

  private async saveCorrection(
    l: LotCompareRow, c: Omit<AgingCorrection, 'by' | 'at' | 'key'> | null, message: string
  ): Promise<boolean> {
    const d = this.loaded[l.factory];
    if (!d || this.isSaving) return false;
    this.isSaving = true;
    try {
      d.corrections = await this.agingService.saveCorrection(d.reportId, l.key, c);
      this.recompute(l.factory);
      this.rebuild();
      this.refreshExpandedSku();
      this.actionMessage = message;
      return true;
    } catch (e) {
      console.error('[Aging Report] save correction error', e);
      this.actionMessage = 'Lưu thất bại: ' + ((e as Error)?.message || e);
      return false;
    } finally {
      this.isSaving = false;
    }
  }

  private refreshExpandedSku(): void {
    const id = this.expandedSkuId;
    if (!id) return;
    const sku = this.filteredSkus.find(s => s.id === id) || this.results[id.split('|')[0] as AgingFactory]?.skus.find(s => s.id === id);
    this.expandedSkuId = null;
    if (sku) this.toggleSkuDetail(sku);
  }

  /** Xuất báo cáo tuổi hàng đã hiệu chỉnh (cùng mẫu cột ERP, bỏ mã A) + cột ghi chú hiệu chỉnh. */
  exportCorrected(): void {
    this.showMoreMenu = false;
    const facs = this.viewFactories.filter(f => this.workRows[f]);
    if (!facs.length) return;
    const wb = XLSX.utils.book_new();
    const header = ['SKU', 'Name', 'Unit', 'Mã lô', 'Hạn sử dụng', 'Shelf life (month)', 'WH', 'Inbound Date', 'Aging',
      'ERP inventory', 'Unit Price', 'Value', 'Type of Aging', 'Cus', 'Hiệu chỉnh', 'Ghi chú'];
    for (const f of facs) {
      const d = this.loaded[f]!;
      const ignored = new Set(Object.values(d.corrections).filter(c => c.action === 'ignore').map(c => c.key));
      const rows = this.workRows[f]!.map(r => {
        let change = '';
        if (r.fix === 'added') change = 'Thêm lot';
        else if (r.fix === 'edited' && r.orig) {
          const o = r.orig;
          const parts: string[] = [];
          if (o.lot !== r.lot) parts.push(`lô ${o.lot} → ${r.lot}`);
          if (o.inb !== r.inb) parts.push(`ngày nhập ${this.fmtDate(o.inb)} → ${this.fmtDate(r.inb)}`);
          if (o.qty !== r.qty) parts.push(`tồn ${o.qty} → ${r.qty}`);
          if (o.price !== r.price) parts.push(`đơn giá ${o.price} → ${r.price}`);
          if (o.aging !== r.aging) parts.push(`số tháng ${o.aging ?? ''} → ${r.aging ?? ''}`);
          change = parts.join('; ') || 'Tính lại';
        } else if (ignored.has(r.key)) change = 'Bỏ qua lỗi';
        return [r.sku, r.name, r.unit, r.lot, '', '', r.wh, this.fmtDate(r.inb), r.aging ?? '', r.qty, r.price,
          Math.round(r.value), r.type, r.cus, change, r.fixNote];
      });
      const title = [
        [`Báo cáo tuổi hàng thành phẩm ${AGING_FACTORY_LABEL[f]} – đã hiệu chỉnh`],
        [`Đến ngày ${this.fmtDate(d.reportTo)} · không tính mã bắt đầu bằng A`],
        [],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...title, header, ...rows]), `Aging ${f}`);
    }
    const summary: (string | number)[][] = [
      ['FGs Aging Report – đã hiệu chỉnh'],
      ['Tỷ giá', this.usdRate],
      [],
      ['Type of Aging', ...facs.map(f => AGING_FACTORY_LABEL[f] + ' (VND)'), 'Tổng (VND)', 'Tổng (USD)', '%'],
      ...this.bucketLines.concat(this.bucketTotal ? [this.bucketTotal] : []).map(l => [
        l.label, ...facs.map(f => Math.round(l.values[f])), Math.round(l.total),
        this.usdRate ? Math.round((l.total / this.usdRate) * 100) / 100 : 0, Math.round(l.percent * 100) / 100,
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Tổng hợp');
    const tag = this.factoryView === 'ALL' ? 'Tong' : this.factoryView;
    const date = facs.map(f => this.loaded[f]!.reportTo).sort().reverse()[0] || '';
    XLSX.writeFile(wb, `Aging_Report_hieu_chinh_${tag}_${date}.xlsx`);
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
