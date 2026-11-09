import { appAlert } from '../../shared/app-toast';
import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { RmBagHistoryService } from '../../services/rm-bag-history.service';
import { FirebaseAuthService } from '../../services/firebase-auth.service';
import { firstValueFrom } from 'rxjs';
import { ReportDocumentsService, ReportDocument, REPORT_DOC_MAX_BYTES } from './report-documents.service';
import { MaterialPlanService, MaterialPlan } from './material-plan.service';
import { PlanPeriod, PlanViewRow, PlanPeriodSummary, PlanKpi, buildPeriods, buildRows, summarize } from './material-plan-analysis';
import { NvlCatalogFullService, NvlCatalogItem, NvlStockLots } from '../../services/nvl-catalog-full.service';
import * as XLSX from 'xlsx';

/** Một khối số liệu (Carton + số mã hàng) cho 1 chiều (Nhập hoặc Xuất) của 1 nguồn (FG hoặc RM). */
export interface DaySection {
  /** null = không có dữ liệu carton đáng tin cho nguồn này (hiển thị "—"). */
  carton: number | null;
  /** Số mã hàng riêng biệt — FG: đếm theo materialCode; RM: đếm theo cặp materialCode+IMD. */
  codes: number;
  /** Ghi chú cảnh báo độ tin cậy của số carton (nếu có). */
  cartonCaveat?: string;
}

export interface DayStats {
  loading: boolean;
  loaded: boolean;
  error: string | null;
  fgIn: DaySection;
  fgOut: DaySection;
  rmIn: DaySection;
  rmOut: DaySection;
}

interface CalendarCell {
  date: Date;
  dateKey: string;
  day: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  isFuture: boolean;
}

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

const RM_IN_CARTON_CAVEAT =
  'Số thùng NVL nhập lấy từ "số tem cần in" (cartonCount) — có thể không phản ánh đúng số thùng thực tế nếu nhân viên không nhập/không in tem.';

@Component({
  selector: 'app-report',
  templateUrl: './report.component.html',
  styleUrls: ['./report.component.scss']
})
export class ReportComponent implements OnDestroy {
  readonly weekdayLabels = WEEKDAY_LABELS;

  viewYear: number;
  viewMonth: number; // 0-11

  weeks: CalendarCell[][] = [];
  dayStats = new Map<string, DayStats>();

  showDetailFor: string | null = null;

  private readonly todayKey: string;

  constructor(
    private firestore: AngularFirestore,
    private rmBagHistory: RmBagHistoryService,
    private router: Router,
    private reportDocs: ReportDocumentsService,
    private materialPlan: MaterialPlanService,
    private nvlCatalog: NvlCatalogFullService,
    private authService: FirebaseAuthService
  ) {
    const now = new Date();
    this.viewYear = now.getFullYear();
    this.viewMonth = now.getMonth();
    this.todayKey = this.toDateKey(now);
    this.buildCalendar();
  }

  ngOnDestroy(): void {}

  // ===== Lưu tài liệu: import file lên, máy nào cũng tải / in / xóa được =====
  activeTab: 'stats' | 'docs' | 'plan' = 'stats';
  docs: ReportDocument[] = [];
  docsLoading = false;
  docsLoaded = false;
  docsError = '';
  docsQuery = '';
  docsUploading: Array<{ name: string; pct: number; error?: string }> = [];
  docsBusyId = '';

  setTab(tab: 'stats' | 'docs' | 'plan'): void {
    this.activeTab = tab;
    if (tab === 'docs' && !this.docsLoaded) void this.loadDocs();
    if (tab === 'plan' && !this.planLoaded) void this.loadPlan();
  }

  // ===== Kế hoạch NVL: import file Total material request → về kho / xuất kho / rủi ro tồn =====
  plan: MaterialPlan | null = null;
  planLoading = false;
  planLoaded = false;
  planImporting = false;
  planError = '';
  /** Cột hiển thị ở bảng chi tiết. */
  planMode: 'in' | 'out' | 'both' = 'both';
  planGroup: 'day' | 'month' = 'month';
  planUnit: 'bag' | 'qty' = 'bag';
  /** Tồn thực tế tính theo nhà máy nào. */
  planFactory: 'all' | 'ASM1' | 'ASM2' = 'all';
  planFilter: 'active' | 'all' | 'risk' | 'neg' | 'nosp' = 'active';
  /** key = chỉ mã cần follow (mã B, trừ Tem / Dây rút / Dây buộc); all = mọi mã (mã cần follow vẫn lên đầu). */
  planScope: 'key' | 'all' = 'key';
  planKeyCount = 0;
  /** Ngưỡng box "Tồn thấp sắp dùng hết". */
  planLowMax = 1000;
  planLowPct = 90;
  planLowList: PlanViewRow[] = [];
  planQuery = '';
  planLimit = 200;
  /** Danh sách bên phải ô "Rủi ro": thiếu tồn, hoặc mã dùng tồn nhiều nhất. */
  planSideList: 'risk' | 'stock' = 'risk';
  planPeriods: PlanPeriod[] = [];
  planAll: PlanViewRow[] = [];
  planView: PlanViewRow[] = [];
  planSummary: PlanPeriodSummary[] = [];
  planKpi: PlanKpi | null = null;
  planTopIn: PlanViewRow[] = [];
  planRiskList: PlanViewRow[] = [];
  planStockList: PlanViewRow[] = [];
  planChartMax = 1;
  planStockLoading = false;
  planStockError = '';
  private planSp = new Map<string, number>();
  private planLots: Map<string, NvlStockLots> | null = null;

  async loadPlan(): Promise<void> {
    this.planLoading = true;
    this.planError = '';
    try {
      const [plan, catalog] = await Promise.all([
        this.materialPlan.loadLatest(),
        this.nvlCatalog.listAll().catch(() => [] as NvlCatalogItem[])
      ]);
      this.plan = plan;
      this.planSp = new Map(catalog.filter((c) => c.standardPacking > 0).map((c) => [this.nvlCatalog.normalizeCode(c.materialCode), c.standardPacking]));
      this.planLoaded = true;
      this.rebuildPlan();
      if (plan && !this.planLots) void this.loadPlanStock();
    } catch (e: any) {
      this.planError = 'Không tải được kế hoạch NVL: ' + (e?.message || e);
    } finally {
      this.planLoading = false;
    }
  }

  /** Tồn thực tế từng lô (inventory-materials ASM1 + ASM2) — đọc 1 lần / phiên. */
  async loadPlanStock(force = false): Promise<void> {
    this.planStockLoading = true;
    this.planStockError = '';
    try {
      this.planLots = await this.nvlCatalog.loadStockLotsByCode(force);
      this.rebuildPlan();
    } catch (e: any) {
      this.planStockError = 'Không tải được tồn thực tế: ' + (e?.message || e);
    } finally {
      this.planStockLoading = false;
    }
  }

  async onPlanPicked(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (this.plan && !confirm(`Thay kế hoạch hiện tại (${this.plan.fileName}) bằng file "${file.name}"?`)) return;
    this.planImporting = true;
    this.planError = '';
    try {
      const parsed = await this.materialPlan.parseFile(file);
      const user = await firstValueFrom(this.authService.currentUser).catch(() => null);
      const by = String((user as any)?.employeeId || (user as any)?.email || '').trim().toUpperCase();
      await this.materialPlan.save(parsed, by);
      await this.loadPlan();
    } catch (e: any) {
      this.planError = '❌ Import lỗi: ' + (e?.message || e);
    } finally {
      this.planImporting = false;
    }
  }

  /** Dựng lại kỳ + số liệu từng dòng (đổi file, Theo ngày / Theo tháng, nhà máy, tồn thực tế). */
  rebuildPlan(): void {
    const p = this.plan;
    if (!p) {
      this.planPeriods = [];
      this.planAll = [];
      this.planKpi = null;
      this.applyPlanFilter();
      return;
    }
    this.planPeriods = buildPeriods(p.buckets, this.planGroup);
    let lots: Map<string, number[]> | null = null;
    if (this.planLots) {
      lots = new Map();
      this.planLots.forEach((l, code) => {
        const arr = this.planFactory === 'ASM1' ? l.asm1 : this.planFactory === 'ASM2' ? l.asm2 : [...l.asm1, ...l.asm2];
        if (arr.length) lots!.set(code, arr);
      });
    }
    // Mã cần follow lên đầu bảng (giữ thứ tự file trong từng nhóm)
    const rows = buildRows(p, this.planPeriods, this.planSp, lots);
    this.planAll = [...rows.filter((v) => v.key), ...rows.filter((v) => !v.key)];
    this.planKeyCount = rows.filter((v) => v.key).length;

    const scoped = this.planScope === 'key' ? this.planAll.filter((v) => v.key) : this.planAll;
    const s = summarize(scoped, this.planPeriods);
    this.planSummary = s.periods;
    this.planKpi = s.kpi;
    this.planChartMax = Math.max(1, ...s.periods.map((x) => Math.max(x.inBags, x.outBags)));
    this.planTopIn = scoped.filter((v) => v.inBagTotal > 0).sort((a, b) => b.inBagTotal - a.inBagTotal).slice(0, 12);
    const riskRank = (v: PlanViewRow) => (v.risk === 'high' ? 0 : 1);
    this.planRiskList = scoped
      .filter((v) => v.risk)
      .sort((a, b) => riskRank(a) - riskRank(b) || this.gapBags(a) - this.gapBags(b));
    this.buildLowStockList(scoped);
    this.planStockList = scoped
      .filter((v) => v.useFromStock > 0.0005)
      .sort((a, b) => this.useBags(b) - this.useBags(a))
      .slice(0, 40);
    this.planLimit = 200;
    this.applyPlanFilter();
  }

  applyPlanFilter(): void {
    const q = this.planQuery.trim().toLowerCase();
    const eps = 0.0005;
    this.planView = this.planAll.filter((v) => {
      if (q && !`${v.row.code} ${v.row.cnCode} ${v.row.des} ${v.row.fg}`.toLowerCase().includes(q)) return false;
      // Đang tìm thì tìm cả mã không quan trọng (bấm mã từ danh sách / gõ đúng mã)
      if (!q && this.planScope === 'key' && !v.key) return false;
      switch (this.planFilter) {
        case 'active': return v.inTotal > eps || v.outTotal > eps;
        case 'risk': return !!v.risk;
        case 'neg': return v.minBal < -eps;
        case 'nosp': return !v.sp && (v.inTotal > eps || v.outTotal > eps);
        default: return true;
      }
    });
  }

  setPlanFilter(f: 'active' | 'all' | 'risk' | 'neg' | 'nosp'): void {
    this.planFilter = f;
    this.applyPlanFilter();
  }

  setPlanMode(m: 'in' | 'out' | 'both'): void {
    this.planMode = m;
  }

  setPlanGroup(g: 'day' | 'month'): void {
    this.planGroup = g;
    this.rebuildPlan();
  }

  /** Box "Tồn thấp sắp dùng hết": tồn < ngưỡng và phần cần dùng từ tồn ≥ ngưỡng % tồn. */
  buildLowStockList(scoped?: PlanViewRow[]): void {
    const src = scoped ?? (this.planScope === 'key' ? this.planAll.filter((v) => v.key) : this.planAll);
    const maxStock = Number(this.planLowMax) || 0;
    const minPct = Number(this.planLowPct) || 0;
    const order = new Map(this.planPeriods.map((p, i) => [p.label, i]));
    const needIdx = (v: PlanViewRow) => order.get(v.firstNeed) ?? 99;
    this.planLowList = src
      .filter((v) => v.stockBase > 0.0005 && v.stockBase < maxStock && v.useFromStock > 0.0005 && v.usePct >= minPct)
      // > 100% (tồn không đủ) lên đầu, rồi mã cần dùng sớm nhất, rồi % dùng cao
      .sort((a, b) => Number(b.usePct > 100.05) - Number(a.usePct > 100.05) || needIdx(a) - needIdx(b) || b.usePct - a.usePct);
  }

  setPlanScope(s: 'key' | 'all'): void {
    this.planScope = s;
    this.rebuildPlan();
  }

  setPlanFactory(f: 'all' | 'ASM1' | 'ASM2'): void {
    this.planFactory = f;
    this.rebuildPlan();
  }

  /** Bấm 1 mã ở ô tổng quan → lọc bảng chi tiết đúng mã đó. */
  focusPlanCode(code: string): void {
    this.planQuery = code;
    this.planFilter = 'all';
    this.applyPlanFilter();
    setTimeout(() => document.getElementById('rpt-plan-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  get planVisible(): PlanViewRow[] {
    return this.planView.slice(0, this.planLimit);
  }

  get planStockDateLabel(): string {
    const s = this.plan?.stockDate;
    if (!s) return '—';
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  }

  get planFactoryLabel(): string {
    return this.planFactory === 'all' ? 'ASM1 + ASM2' : this.planFactory;
  }

  /** Số hiển thị: số nguyên khi lớn, giữ 2 số lẻ khi nhỏ (keo, thiếc theo KG/chai). */
  planNum(n: number | null | undefined): string {
    if (n === null || n === undefined || Math.abs(n) < 0.0005) return '';
    const abs = Math.abs(n);
    return n.toLocaleString('en-US', { maximumFractionDigits: abs >= 100 ? 0 : 2 });
  }

  /** Nhãn ngắn trên cột biểu đồ: 12.3k */
  planShort(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 10_000) return Math.round(n / 1000) + 'k';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n));
  }

  /** Ô bảng chi tiết theo đơn vị đang chọn (bag khi có Standard Packing, ngược lại số lượng). */
  planCell(v: PlanViewRow, kind: 'in' | 'out', k: number): string {
    if (this.planUnit === 'bag' && v.sp) return this.planNum(kind === 'in' ? v.inB![k] : v.outB![k]);
    return this.planNum(kind === 'in' ? v.inQ[k] : v.outQ[k] + (k === 0 ? v.row.shortage : 0));
  }

  planQtyToUnit(v: PlanViewRow, qty: number | null): string {
    if (qty === null) return '—';
    if (this.planUnit === 'bag' && v.sp) return this.planNum(qty > 0 ? Math.ceil(qty / v.sp - 1e-9) : qty / v.sp) || '0';
    return this.planNum(qty) || '0';
  }

  /** Thiếu/dư so với phần cần dùng từ tồn, quy ra bag để xếp hạng (mã chưa có SP xếp theo số lượng). */
  gapBags(v: PlanViewRow): number {
    const g = v.gap ?? v.minBal;
    return v.sp ? g / v.sp : g;
  }

  useBags(v: PlanViewRow): number {
    return v.sp ? v.useFromStock / v.sp : 0;
  }

  /** Thanh ngang ở danh sách Top về: tỷ lệ so với mã đứng đầu. */
  topInPct(v: PlanViewRow): number {
    const max = this.planTopIn[0]?.inBagTotal || 1;
    return Math.max(2, (v.inBagTotal / max) * 100);
  }

  /** Thanh "đủ tồn": tồn thực tế / phần cần dùng từ tồn. */
  coverPct(v: PlanViewRow): number {
    if (!v.useFromStock || v.live === null) return 0;
    return Math.min(100, (v.live / v.useFromStock) * 100);
  }

  trackPlanRow(_: number, v: PlanViewRow): string {
    return v.row.code;
  }

  exportPlan(): void {
    if (!this.plan) return;
    const header = ['Mã VT', 'Mã CN', 'Mô tả', 'ĐVT', 'Standard Packing', `Tồn file ${this.planStockDateLabel}`,
      `Tồn thực tế (${this.planFactoryLabel})`, 'Bag tồn thực tế', 'Cần dùng từ tồn', 'Thiếu/dư so với tồn', 'Rủi ro', 'Nợ cũ (Shortage)'];
    this.planPeriods.forEach((p) => {
      header.push(`Về ${p.label}`, `Bag về ${p.label}`, `Xuất ${p.label}`, `Bag xuất ${p.label}`, `Tồn cuối ${p.label}`);
    });
    header.push('Tổng về', 'Bag về', 'Tổng xuất', 'Bag xuất', 'Remark', 'FG', 'Mã cần follow');
    const r3 = (n: number) => Math.round(n * 1000) / 1000;
    const rows: (string | number)[][] = [header];
    this.planView.forEach((v) => {
      const r: (string | number)[] = [v.row.code, v.row.cnCode, v.row.des, v.row.unit, v.sp || '', v.row.stock,
        v.live ?? '', v.sp ? v.liveBags : '', r3(v.useFromStock), v.gap === null ? '' : r3(v.gap),
        v.risk === 'high' ? 'Cao' : v.risk === 'mid' ? 'Trung bình' : '', v.row.shortage];
      this.planPeriods.forEach((_, k) => {
        r.push(r3(v.inQ[k]), v.inB ? v.inB[k] : '', r3(v.outQ[k]), v.outB ? v.outB[k] : '', r3(v.bal[k]));
      });
      r.push(r3(v.inTotal), v.sp ? v.inBagTotal : '', r3(v.outTotal), v.sp ? v.outBagTotal : '', v.row.remark, v.row.fg, v.key ? 'x' : '');
      rows.push(r);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ke hoach NVL');
    XLSX.writeFile(wb, `Ke_hoach_NVL_${this.planGroup === 'day' ? 'theo_ngay' : 'theo_thang'}.xlsx`);
  }

  async loadDocs(): Promise<void> {
    this.docsLoading = true;
    this.docsError = '';
    try {
      this.docs = await this.reportDocs.list();
      this.docsLoaded = true;
    } catch (e: any) {
      this.docsError = 'Không tải được danh sách tài liệu: ' + (e?.message || e);
    } finally {
      this.docsLoading = false;
    }
  }

  get docsFiltered(): ReportDocument[] {
    const q = this.docsQuery.trim().toLowerCase();
    return q ? this.docs.filter((d) => d.name.toLowerCase().includes(q) || d.uploadedBy.toLowerCase().includes(q)) : this.docs;
  }

  async onDocsPicked(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) return;
    const user = await firstValueFrom(this.authService.currentUser).catch(() => null);
    const by = String((user as any)?.employeeId || (user as any)?.email || '').trim().toUpperCase();
    for (const f of files) {
      const item: { name: string; pct: number; error?: string } = { name: f.name, pct: 0 };
      this.docsUploading.push(item);
      if (f.size > REPORT_DOC_MAX_BYTES) {
        item.error = 'File quá 50MB';
        continue;
      }
      try {
        await this.reportDocs.upload(f, by, (p) => (item.pct = p));
        this.docsUploading = this.docsUploading.filter((x) => x !== item);
      } catch (e: any) {
        item.error = 'Lỗi: ' + (e?.message || e);
      }
    }
    await this.loadDocs();
  }

  clearUploadErrors(): void {
    this.docsUploading = this.docsUploading.filter((x) => !x.error);
  }

  // Chọn nhiều tài liệu → tải lần lượt từng file
  docsSelected = new Set<string>();
  docsBulkBusy = false;
  docsBulkDone = 0;

  get docsAllChecked(): boolean {
    const list = this.docsFiltered;
    return list.length > 0 && list.every((d) => this.docsSelected.has(d.id));
  }

  toggleDoc(d: ReportDocument): void {
    if (this.docsSelected.has(d.id)) this.docsSelected.delete(d.id);
    else this.docsSelected.add(d.id);
  }

  toggleAllDocs(on: boolean): void {
    for (const d of this.docsFiltered) {
      if (on) this.docsSelected.add(d.id);
      else this.docsSelected.delete(d.id);
    }
  }

  async downloadSelectedDocs(): Promise<void> {
    const list = this.docs.filter((d) => this.docsSelected.has(d.id));
    if (!list.length) return;
    this.docsBulkBusy = true;
    this.docsBulkDone = 0;
    const failed: string[] = [];
    try {
      for (const d of list) {
        try {
          await this.reportDocs.download(d);
        } catch {
          failed.push(d.name);
        }
        this.docsBulkDone++;
        // Giãn cách để trình duyệt không chặn tải nhiều file liên tiếp
        await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      this.docsBulkBusy = false;
    }
    if (failed.length) appAlert('❌ Không tải được:\n' + failed.join('\n'));
    else this.docsSelected.clear();
  }

  async downloadDoc(d: ReportDocument): Promise<void> {
    this.docsBusyId = d.id;
    try {
      await this.reportDocs.download(d);
    } catch (e: any) {
      appAlert('❌ Không tải được file: ' + (e?.message || e));
    } finally {
      this.docsBusyId = '';
    }
  }

  /** Mở file ở tab mới để xem / in (PDF, ảnh mở thẳng trong trình duyệt). */
  openDoc(d: ReportDocument): void {
    window.open(d.url, '_blank', 'noopener');
  }

  async deleteDoc(d: ReportDocument): Promise<void> {
    if (!confirm(`Xóa tài liệu "${d.name}"?\nFile sẽ bị xóa khỏi hệ thống, mọi máy đều không tải được nữa.`)) return;
    this.docsBusyId = d.id;
    try {
      await this.reportDocs.remove(d);
      this.docs = this.docs.filter((x) => x.id !== d.id);
      this.docsSelected.delete(d.id);
    } catch (e: any) {
      appAlert('❌ Không xóa được: ' + (e?.message || e));
    } finally {
      this.docsBusyId = '';
    }
  }

  docSizeText(n: number): string {
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  docIcon(d: ReportDocument): string {
    const n = d.name.toLowerCase();
    if (n.endsWith('.pdf')) return 'picture_as_pdf';
    if (/\.(xlsx?|csv)$/.test(n)) return 'table_chart';
    if (/\.(docx?|txt)$/.test(n)) return 'description';
    if (/\.(png|jpe?g|gif|webp)$/.test(n)) return 'image';
    return 'insert_drive_file';
  }

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  get monthLabel(): string {
    return `Tháng ${this.viewMonth + 1}/${this.viewYear}`;
  }

  prevMonth(): void {
    this.viewMonth--;
    if (this.viewMonth < 0) {
      this.viewMonth = 11;
      this.viewYear--;
    }
    this.buildCalendar();
  }

  nextMonth(): void {
    this.viewMonth++;
    if (this.viewMonth > 11) {
      this.viewMonth = 0;
      this.viewYear++;
    }
    this.buildCalendar();
  }

  goToday(): void {
    const now = new Date();
    this.viewYear = now.getFullYear();
    this.viewMonth = now.getMonth();
    this.buildCalendar();
  }

  private toDateKey(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** Dựng lưới các tuần (T2 → CN) phủ trọn tháng đang xem, có kéo dài đầu/cuối để đủ tuần. */
  private buildCalendar(): void {
    const firstOfMonth = new Date(this.viewYear, this.viewMonth, 1);
    // JS: 0=CN..6=T7 → quy đổi về tuần bắt đầu T2 (0=T2..6=CN)
    const jsDay = firstOfMonth.getDay();
    const leadOffset = (jsDay + 6) % 7;
    const gridStart = new Date(this.viewYear, this.viewMonth, 1 - leadOffset);

    const today0 = new Date();
    today0.setHours(0, 0, 0, 0);

    const weeks: CalendarCell[][] = [];
    const cursor = new Date(gridStart);
    for (let w = 0; w < 6; w++) {
      const week: CalendarCell[] = [];
      for (let i = 0; i < 7; i++) {
        const dateKey = this.toDateKey(cursor);
        const cellDate0 = new Date(cursor);
        cellDate0.setHours(0, 0, 0, 0);
        week.push({
          date: new Date(cursor),
          dateKey,
          day: cursor.getDate(),
          inCurrentMonth: cursor.getMonth() === this.viewMonth,
          isToday: dateKey === this.todayKey,
          isFuture: cellDate0.getTime() > today0.getTime()
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push(week);
      const lastCellInNextMonth = week[6].date.getMonth() !== this.viewMonth && week[6].date > firstOfMonth;
      if (w >= 3 && lastCellInNextMonth) break;
    }
    this.weeks = weeks;
  }

  getStats(dateKey: string): DayStats | null {
    return this.dayStats.get(dateKey) || null;
  }

  /** Bấm Run trên 1 ngày — chỉ đọc dữ liệu của đúng ngày đó (không tự tải cả tháng). */
  async runDay(cell: CalendarCell, event?: Event): Promise<void> {
    if (event) event.stopPropagation();
    if (cell.isFuture) return;
    const dateKey = cell.dateKey;
    const existing = this.dayStats.get(dateKey);
    if (existing?.loading) return;

    const stats: DayStats = {
      loading: true,
      loaded: false,
      error: null,
      fgIn: { carton: 0, codes: 0 },
      fgOut: { carton: 0, codes: 0 },
      rmIn: { carton: 0, codes: 0 },
      rmOut: { carton: null, codes: 0 }
    };
    this.dayStats.set(dateKey, stats);

    const dayStart = new Date(cell.date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(cell.date);
    dayEnd.setHours(23, 59, 59, 999);

    try {
      const [fgOut, fgIn, rmOut, rmIn] = await Promise.all([
        this.loadFgOut(dayStart, dayEnd),
        this.loadFgIn(dayStart, dayEnd),
        this.loadRmOut(dayStart, dayEnd),
        this.loadRmIn(dayStart, dayEnd)
      ]);
      this.dayStats.set(dateKey, {
        loading: false,
        loaded: true,
        error: null,
        fgOut,
        fgIn,
        rmOut,
        rmIn
      });
    } catch (e: unknown) {
      console.error('runDay failed', dateKey, e);
      const msg = e instanceof Error ? e.message : String(e);
      this.dayStats.set(dateKey, { ...stats, loading: false, error: msg });
    }
  }

  // ── Nguồn dữ liệu ────────────────────────────────────────────────────────
  // fg-out / fg-in: gộp cả ASM1 + ASM2 (2 collection này vốn đã chứa cả 2 nhà máy).
  // outbound-materials / inbound-materials: chỉ ASM1 (đúng theo 2 tab outbound-asm1 / inbound-asm1).

  private async loadFgOut(dayStart: Date, dayEnd: Date): Promise<DaySection> {
    const snap = await this.firestore
      .collection('fg-out', ref => ref.where('exportDate', '>=', dayStart).where('exportDate', '<=', dayEnd))
      .get()
      .toPromise();
    let carton = 0;
    const codes = new Set<string>();
    (snap?.docs || []).forEach(doc => {
      const d = doc.data() as Record<string, unknown>;
      carton += Number(d.carton) || 0;
      const code = String(d.materialCode || '').trim().toUpperCase();
      if (code) codes.add(code);
    });
    return { carton, codes: codes.size };
  }

  private async loadFgIn(dayStart: Date, dayEnd: Date): Promise<DaySection> {
    const snap = await this.firestore
      .collection('fg-in', ref => ref.where('importDate', '>=', dayStart).where('importDate', '<=', dayEnd))
      .get()
      .toPromise();
    let carton = 0;
    const codes = new Set<string>();
    (snap?.docs || []).forEach(doc => {
      const d = doc.data() as Record<string, unknown>;
      carton += Number(d.carton) || 0;
      const code = String(d.materialCode || '').trim().toUpperCase();
      if (code) codes.add(code);
    });
    return { carton, codes: codes.size };
  }

  /** outbound-materials (ASM1): KHÔNG có field carton nào — NVL xuất theo bao/cuộn, không theo thùng. */
  private async loadRmOut(dayStart: Date, dayEnd: Date): Promise<DaySection> {
    const snap = await this.firestore
      .collection('outbound-materials', ref =>
        ref.where('factory', '==', 'ASM1').where('exportDate', '>=', dayStart).where('exportDate', '<=', dayEnd)
      )
      .get()
      .toPromise();
    const codeImdSet = new Set<string>();
    (snap?.docs || []).forEach(doc => {
      const d = doc.data() as Record<string, unknown>;
      const code = String(d.materialCode || '').trim().toUpperCase();
      if (!code) return;
      // Lưu ý: trên collection này field tên "importDate" thực chất chứa chuỗi IMD (không phải ngày giao dịch).
      const imdRaw = String(d.importDate ?? '').trim();
      const imdKey = imdRaw ? this.rmBagHistory.parseQrPart4(imdRaw).imdKey || imdRaw : '';
      codeImdSet.add(`${code}|${imdKey}`);
    });
    return { carton: null, codes: codeImdSet.size };
  }

  private async loadRmIn(dayStart: Date, dayEnd: Date): Promise<DaySection> {
    const snap = await this.firestore
      .collection('inbound-materials', ref =>
        ref.where('factory', '==', 'ASM1').where('importDate', '>=', dayStart).where('importDate', '<=', dayEnd)
      )
      .get()
      .toPromise();
    let carton = 0;
    const codes = new Set<string>();
    (snap?.docs || []).forEach(doc => {
      const d = doc.data() as Record<string, unknown>;
      carton += Number(d.cartonCount) || 0;
      const code = String(d.materialCode || '').trim().toUpperCase();
      if (code) codes.add(code);
    });
    return { carton, codes: codes.size, cartonCaveat: RM_IN_CARTON_CAVEAT };
  }

  // ── Tổng hợp hiển thị (ô lịch rút gọn) ──────────────────────────────────
  totalInCarton(s: DayStats): number {
    return (s.fgIn.carton ?? 0) + (s.rmIn.carton ?? 0);
  }

  /** Chỉ tính carton FG — RM xuất không có dữ liệu carton nên không cộng vào (tránh hiểu nhầm là tổng thật). */
  totalOutCarton(s: DayStats): number {
    return s.fgOut.carton ?? 0;
  }

  totalInCodes(s: DayStats): number {
    return s.fgIn.codes + s.rmIn.codes;
  }

  totalOutCodes(s: DayStats): number {
    return s.fgOut.codes + s.rmOut.codes;
  }

  openDetail(dateKey: string, hasData: boolean, event?: Event): void {
    if (event) event.stopPropagation();
    if (!hasData) return;
    this.showDetailFor = dateKey;
  }

  closeDetail(): void {
    this.showDetailFor = null;
  }

  get detailStats(): DayStats | null {
    return this.showDetailFor ? this.dayStats.get(this.showDetailFor) || null : null;
  }

  get detailDateLabel(): string {
    if (!this.showDetailFor) return '';
    const [y, m, d] = this.showDetailFor.split('-');
    return `${d}/${m}/${y}`;
  }
}
