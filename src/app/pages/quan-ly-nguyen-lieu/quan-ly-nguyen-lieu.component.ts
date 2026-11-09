import { appAlert } from '../../shared/app-toast';
import { Component, inject } from '@angular/core';
import { MaterialPlanService } from '../report/material-plan.service';
import { firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { splitMultiLocations } from '../layout-warehouse/layout-warehouse-location.util';
import { getLayoutLocationGroups, isJWarehouseLocation, jKhoMatSFirstRowForPrefix, jKhoMatBlocksForRow, parseJRackLocation, formatJRackAisle } from '../materials/layout-location-catalog';
import { PendingPxkInfo } from '../../services/linkq-pending-pxk.service';
import { InventoryStockReportService } from '../../services/inventory-stock-report.service';
import { KkLogRow, kkLogDateKey } from '../../services/kk-history-log.service';
import * as firebase from 'firebase/compat/app';
import { KK_PO_BLANK, kkPoCmpCode, kkPoCmpPo } from '../materials/kk-po-compare';
import { MaterialsComponent, InventoryMaterial, KkWarehouse, KkLocMaterialRow, KkTypeRow, LinkQCompareTab, LinkQCompareRow, KkTypeByCodeRow, KkStockBoxRef } from '../materials/materials.component';

/** Mục DS Check: '' = tắt. */
type DsCheckMode = '' | 'willUse' | 'usedUp';
type LinkQRowFn = 'lines' | 'po';
/** Check PO: LinkQ làm gốc, so tồn web theo từng PO. */
interface LinkQPoRow {
  po: string;
  linkQ: number | null;
  web: number;
  diff: number;
  status: 'ok' | 'over' | 'short' | 'nodata';
  lines: InventoryMaterial[];
}
/** Cảnh báo theo mã: hết stock / cần giảm / cần tăng stock web cho khớp LinkQ. */
interface LinkQWarn {
  cls: 'out' | 'dec' | 'inc';
  label: string;
  qty: number;
}
/** Tự sửa Check PO: 1 đề nghị cho 1 dòng tồn (gửi vào Danh mục điều chỉnh, quản lý duyệt). */
interface KkFixItem {
  key: string;
  m: InventoryMaterial;
  kind: 'delete' | 'dec' | 'po';
  target: '' | 'opening' | 'closing';
  qty: number;
  newPo: string;
  reason: string;
  code: string;
  po: string;
  on: boolean;
}
/** Mã + PO lệch nhưng không tự sửa được (thiếu dòng / lệch quá lớn) → làm tay. */
interface KkFixManual {
  code: string;
  po: string;
  text: string;
}
interface KkFixPlan {
  items: KkFixItem[];
  manual: KkFixManual[];
  before: number;
  after: number;
  /** id dòng → lý do tô đỏ (dòng có đề nghị + dòng của nhóm phải làm tay). */
  flags: Map<string, string>;
}
const DS_CHECK_MODES: DsCheckMode[] = ['willUse', 'usedUp'];

/**
 * Tab Quản lý Nguyên Liệu (`/quan-ly-nguyen-lieu`) — Kiểm tra KK theo loại hàng, mã hàng và vị trí.
 *
 * Tách khỏi RM Inventory (`/materials`): kế thừa phần dùng chung (tồn kho, danh mục, nhà máy, popup)
 * từ MaterialsComponent; logic chỉ dùng cho Kiểm kê nằm ở file này.
 */
@Component({
  selector: 'app-quan-ly-nguyen-lieu',
  templateUrl: '../materials/materials.component.html',
  styleUrls: ['../materials/materials.component.scss', '../materials/materials-mobile.scss']
})
export class QuanLyNguyenLieuComponent extends MaterialsComponent {
  override get isNguyenLieuPage(): boolean {
    return true;
  }

  protected override initKkPage(): void {
    if (!this.isMobile) {
      this.enterKkLocMap();
    } else {
      void this.ensureKkMobileCatalog();
      void this.loadPlanCheckList();
      this.nlScanDevice = 'pda';
      this.showNlDevicePicker = false;
    }
  }

  protected override openKkAllMucsForPoCmp(): void {
    this.openKkAllMucs();
  }

  protected override onKkPoCmpChanged(): void {
    this.kkTypePage = 1;
  }

  protected override onKkPageFactoryChanged(): void {
    if (!this.isMobile) {
      this.enterKkLocMap();
    } else {
      this.closeKkLocMap();
      void this.ensureKkMobileCatalog();
    }
    if (this.kkLiveActive) this.startKkLive();
  }

  protected override onKkPageResize(): void {
    this.fitKkTypePageSize();
  }

  override openKkLocMapFromMore(): void {
    this.closeMorePopup();
    this.enterKkLocMap();
  }

  // ── Logic chỉ dùng cho Kiểm kê (chuyển từ MaterialsComponent) ──

  /** Menu thả xuống trên thanh công cụ trang KK: 'print' = In & báo cáo, 'tools' = Công cụ */
  kkToolMenu: 'print' | 'tools' | null = null;
  showLinkQCompare = false;
  linkQCompareLoading = false;
  linkQCompareError = '';
  linkQCompareLabel = '';
  linkQCompareExpanded = new Set<string>();
  /** Đang cập nhật nền — vẫn hiện dữ liệu cache. */
  linkQCompareRefreshing = false;
  linkQCompareUpdatedAt = 0;
  private linkQCompareFactory = '';
  private linkQCompareCache = new Map<string, { rows: LinkQCompareRow[]; label: string; ts: number; po: Map<string, Map<string, number>> }>();
  /** Tồn LinkQ theo mã → PO (chỉ có khi file LinkQ import kèm cột PO). */
  linkQPoByCode = new Map<string, Map<string, number>>();
  /** Chức năng đang chọn trong phần mở rộng của từng mã: dòng tồn web / Check PO. */
  linkQRowFn = new Map<string, LinkQRowFn>();
  /** PO đang mở chi tiết trong Check PO — key `mã|PO`. */
  linkQPoOpen = new Set<string>();
  private linkQPoRowsCache = new Map<string, LinkQPoRow[]>();
  /** Lượng thiếu / dư nhập tay theo dòng tồn (id) — gửi thành đề nghị điều chỉnh chờ quản lý duyệt. */
  private linkQAdjDrafts = new Map<string, { short: number | null; over: number | null }>();
  /** Đề nghị điều chỉnh đang chờ duyệt theo dòng tồn (materialId). */
  linkQAdjPending = new Map<string, Array<{ direction: string; qty: number; target: string }>>();
  linkQAdjPendingCount = 0;
  linkQCheckImporting = false;
  private linkQCompareQueryTimer: any = null;
  readonly kkTypePageSizeOptions = [20, 50, 100];
  /** Popup Thao tác (tick KK, reset, pallet, vị trí…). */
  kkActionsOpen = false;
  kkLocScanLoading = false;
  private kkManagerRowsCached: Array<{
    name: string;
    codeCount: number;
    typeCount: number;
    types: string[];
    prefixes: string[];
    mucs: string[];
  }> = [];
  private kkTypeBoxGroupsCached: Array<{
    category: string;
    title: string;
    boxes: typeof this.kkTypeBoxesCached;
    groups?: Array<{
      key: string;
      title: string;
      boxes: typeof this.kkTypeBoxesCached;
      subMucs: Array<{ key: string; title: string; boxes: typeof this.kkTypeBoxesCached }>;
    }>;
  }> = [];
  kkTypeMucCollapsed: Record<string, boolean> = {};
  /** Sơ đồ kệ B009/B016/B018 chỉ mở khi bấm Sơ Đồ. */
  kkConnectorBoardOpen: Record<string, boolean> = {};
  kkMucShelfMenuX = 0;
  kkMucShelfMenuY = 0;
  kkScanGuideSending = false;
  kkScanGuideSendMsg = '';
  kkScanGuideSendErr = false;
  kkTypePrintBusy = false;
  kkShelfLabelQuery = '';
  kkMucReportQuery = '';
  /** Tick đầu mã để in giấy kiểm kê. */
  kkKiemKeSelectedPrefixes: Record<string, boolean> = {};
  kkCodeLookupInput = '';
  kkCodeLookupBusy = false;
  kkCodeLookupResult: {
    code: string;
    productType: string;
    stock: number;
    lines: number;
    found: boolean;
  } | null = null;
  /** Từ 14/10/2026 chỉ còn Kho J (D1 / 00 / ASM3 đã bỏ). */
  readonly kkLocMapWarehouseOptions: Array<{ id: KkWarehouse; label: string }> = [
    { id: 'J', label: 'Kho J' }
  ];
  kkTypeBoxMenuX = 0;
  kkTypeBoxMenuY = 0;

  /** PDA / Enter: tìm mã ngay, không đợi debounce 2s. */
  runMobileNguyenLieuSearch(): void {
    const term = String(this.searchTerm || '').trim().toUpperCase();
    this.searchTerm = term;
    if (!term || term.length < 4) return;
    void this.performSearch(term);
  }

  get kkScanHideKeyboard(): boolean {
    return this.isMobile;
  }

  onKkScanTrapBlur(event: FocusEvent): void {
    if (!this.showKkTypeScanModal) return;
    const next = event.relatedTarget as HTMLElement | null;
    if (next?.closest?.('.kk-type-scan') && (next.tagName === 'BUTTON' || next.closest('button, a, input[type="number"]'))) {
      return;
    }
    setTimeout(() => this.pinKkScanFocus(), 0);
  }

  onNlKkTick(material: InventoryMaterial, checked: boolean): void {
    if (!this.canEdit || !material?.id) return;
    if (!!material.kkChecked === !!checked) return;
    void this.toggleKk(material);
  }

  closeNlPdaScan(): void {
    this.showNlPdaScan = false;
    this.nlPdaBuffer = '';
    this.nlScanLastReadMs = null;
  }

  submitNlPdaScan(): void {
    const el = document.getElementById('nl-pda-scan-input') as HTMLInputElement | null;
    this.applyNlSearchScan(el?.value || this.nlPdaBuffer);
  }
  kkLogFrom = '';
  kkLogTo = '';
  kkLogQuery = '';
  kkLogRows: KkLogRow[] = [];
  kkLogLoading = false;
  kkLogError = '';
  kkLogSourceLabel = '';
  kkLogArchiveBusy = false;
  kkLogPage = 1;
  readonly kkLogPageSize = 200;
  private kkLogFilterMemo: { rows: KkLogRow[] | null; q: string; out: KkLogRow[] } = { rows: null, q: '', out: [] };

  openKkLog(): void {
    const today = new Date();
    this.kkLogTo = kkLogDateKey(today);
    this.kkLogFrom = kkLogDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6));
    this.kkLogQuery = '';
    this.showKkLog = true;
    void this.loadKkLog();
    void this.checkKkLogArchive();
  }

  async loadKkLog(): Promise<void> {
    if (!this.kkLogFrom || !this.kkLogTo) { this.kkLogError = 'Chọn từ ngày / đến ngày.'; return; }
    if (this.kkLogFrom > this.kkLogTo) [this.kkLogFrom, this.kkLogTo] = [this.kkLogTo, this.kkLogFrom];
    this.kkLogLoading = true;
    this.kkLogError = '';
    this.cdr.detectChanges();
    try {
      const { rows, reads } = await this.kkLog.loadRange(this.selectedFactory, this.kkLogFrom, this.kkLogTo);
      this.readTracker.track('materials', 'kk-history-log', reads);
      this.kkLogRows = rows;
      this.kkLogPage = 1;
      this.kkLogSourceLabel = `${this.selectedFactory} · ${this.kkLogFrom} → ${this.kkLogTo}`;
      if (!rows.length) this.kkLogError = 'Không có lịch sử KK trong khoảng ngày này.';
    } catch (e: any) {
      console.error('❌ loadKkLog:', e);
      this.kkLogError = 'Không đọc được lịch sử KK: ' + (e?.message || e);
    } finally {
      this.kkLogLoading = false;
      this.cdr.detectChanges();
    }
  }

  get kkLogFiltered(): KkLogRow[] {
    const q = this.kkLogQuery.trim().toUpperCase();
    const memo = this.kkLogFilterMemo;
    if (memo.rows === this.kkLogRows && memo.q === q) return memo.out;
    const out = !q ? this.kkLogRows : this.kkLogRows.filter((r) =>
      r.code.toUpperCase().includes(q) || r.po.toUpperCase().includes(q) ||
      r.location.toUpperCase().includes(q) || r.by.toUpperCase().includes(q));
    this.kkLogFilterMemo = { rows: this.kkLogRows, q, out };
    return out;
  }

  get kkLogPageRows(): KkLogRow[] {
    const start = (this.kkLogPage - 1) * this.kkLogPageSize;
    return this.kkLogFiltered.slice(start, start + this.kkLogPageSize);
  }

  get kkLogPageCount(): number {
    return Math.max(1, Math.ceil(this.kkLogFiltered.length / this.kkLogPageSize));
  }

  onKkLogQueryChange(): void {
    this.kkLogPage = 1;
  }

  downloadKkLogView(): void {
    const rows = this.kkLogFiltered;
    if (!rows.length) { appAlert('Không có dòng nào để tải.'); return; }
    const sorted = [...rows].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const from = sorted[0].date;
    const to = sorted[sorted.length - 1].date;
    this.kkLog.downloadText(`KK-log_${this.selectedFactory}_${from}_${to}.txt`,
      this.kkLog.buildFileText(this.selectedFactory, sorted, from, to));
  }

  async onKkLogImport(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const rows = this.kkLog.parseFileText(await file.text());
      if (!rows.length) { appAlert('File không đúng định dạng log KK (hoặc trống).'); return; }
      this.kkLogRows = rows;
      this.kkLogPage = 1;
      this.kkLogError = '';
      this.kkLogSourceLabel = `File: ${file.name} (${rows.length.toLocaleString('vi-VN')} dòng)`;
    } catch (e: any) {
      appAlert('❌ Không đọc được file: ' + (e?.message || e));
    } finally {
      this.cdr.detectChanges();
    }
  }

  /** Tải file log quá 1 năm về máy rồi xóa khỏi Firestore. */
  async archiveKkLog(): Promise<void> {
    if (this.kkLogArchiveBusy) return;
    this.kkLogArchiveBusy = true;
    this.cdr.detectChanges();
    try {
      const f = this.selectedFactory;
      const arc = await this.kkLog.loadArchive(f);
      this.readTracker.track('materials', 'kk-history-log', arc.ids.length || 1);
      if (!arc.ids.length) { this.kkLogArchiveDue = false; appAlert('Không có log quá 1 năm.'); return; }
      const name = `KK-log_${f}_${arc.from}_${arc.to}.txt`;
      this.kkLog.downloadText(name, this.kkLog.buildFileText(f, arc.rows, arc.from, arc.to));
      const ok = confirm(`Đã tải file "${name}" (${arc.rows.length.toLocaleString('vi-VN')} dòng, ${arc.from} → ${arc.to}).\n\n` +
        'Kiểm tra file đã nằm trong máy (thư mục Downloads) và cất giữ cẩn thận.\n' +
        'Bấm OK để xóa phần log này khỏi hệ thống (khi cần xem: Import file vào màn Lịch sử KK).');
      if (!ok) return;
      await this.kkLog.deleteDocs(arc.ids);
      this.kkLogArchiveDue = false;
      try { localStorage.setItem(`kk-log-archive-check:${f}`, `${kkLogDateKey(new Date())}:0`); } catch { /* bỏ qua */ }
      appAlert('✅ Đã lưu file và dọn log quá 1 năm.');
    } catch (e: any) {
      console.error('❌ archiveKkLog:', e);
      appAlert('❌ Không lưu trữ được: ' + (e?.message || e));
    } finally {
      this.kkLogArchiveBusy = false;
      this.cdr.detectChanges();
    }
  }
  zaloCheckFrom = '';
  zaloCheckTo = '';
  zaloCheckQuery = '';
  zaloCheckStatus: '' | 'du' | 'thieu' = '';
  zaloCheckRows: Array<{ id: string; code: string; status: string; note: string; by: string; byName: string;
    at: Date | null; webTotal: string; linkQ: string }> = [];
  zaloCheckLoading = false;
  zaloCheckError = '';

  openZaloCheckLog(): void {
    const today = new Date();
    this.zaloCheckTo = kkLogDateKey(today);
    this.zaloCheckFrom = kkLogDateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6));
    this.zaloCheckQuery = '';
    this.zaloCheckStatus = '';
    this.showZaloCheckLog = true;
    void this.loadZaloCheckLog();
  }

  async loadZaloCheckLog(): Promise<void> {
    if (!this.zaloCheckFrom || !this.zaloCheckTo) { this.zaloCheckError = 'Chọn từ ngày / đến ngày.'; return; }
    if (this.zaloCheckFrom > this.zaloCheckTo) [this.zaloCheckFrom, this.zaloCheckTo] = [this.zaloCheckTo, this.zaloCheckFrom];
    const [fy, fm, fd] = this.zaloCheckFrom.split('-').map(Number);
    const [ty, tm, td] = this.zaloCheckTo.split('-').map(Number);
    const start = new Date(fy, fm - 1, fd);
    const end = new Date(ty, tm - 1, td + 1);
    this.zaloCheckLoading = true;
    this.zaloCheckError = '';
    this.cdr.detectChanges();
    try {
      // 1 field (at) → không cần index ghép
      const snap = await this.firestore.firestore.collection('zalo-material-check-log')
        .where('at', '>=', start).where('at', '<', end).orderBy('at', 'desc').limit(5000).get();
      this.readTracker.track('materials', 'zalo-material-check-log', snap.size || 1);
      this.zaloCheckRows = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          code: String(x.materialCode || '').trim().toUpperCase(),
          status: String(x.status || ''),
          note: String(x.note || ''),
          by: String(x.by || '').trim().toUpperCase(),
          byName: String(x.byName || x.senderName || '').trim(),
          at: this.normalizeTimestamp(x.at),
          webTotal: String(x.webTotal || ''),
          linkQ: String(x.linkQ || '')
        };
      });
      if (!this.zaloCheckRows.length) this.zaloCheckError = 'Chưa có log đủ / thiếu trong khoảng ngày này.';
    } catch (e: any) {
      console.error('❌ loadZaloCheckLog:', e);
      this.zaloCheckError = 'Không đọc được log: ' + (e?.message || e);
    } finally {
      this.zaloCheckLoading = false;
      this.cdr.detectChanges();
    }
  }

  get zaloCheckFiltered() {
    const q = this.zaloCheckQuery.trim().toUpperCase();
    return this.zaloCheckRows.filter((r) =>
      (!this.zaloCheckStatus || r.status === this.zaloCheckStatus) &&
      (!q || r.code.includes(q) || r.by.includes(q) || r.byName.toUpperCase().includes(q) || r.note.toUpperCase().includes(q)));
  }

  get zaloCheckCounts(): { du: number; thieu: number } {
    let du = 0;
    let thieu = 0;
    for (const r of this.zaloCheckRows) {
      if (r.status === 'du') du += 1;
      else if (r.status === 'thieu') thieu += 1;
    }
    return { du, thieu };
  }

  async downloadZaloCheckLog(): Promise<void> {
    const rows = this.zaloCheckFiltered;
    if (!rows.length) { appAlert('Không có dòng nào để tải.'); return; }
    const XLSX = await import('xlsx');
    const data = rows.map((r) => ({
      'Thời gian': r.at ? r.at.toLocaleString('vi-VN') : '',
      'Mã hàng': r.code,
      'Kết quả': r.status === 'du' ? 'Đủ' : r.status === 'thieu' ? 'Thiếu' : r.status,
      'Ghi chú': r.note,
      'Người kiểm': r.by,
      'Tên': r.byName,
      'Tồn web lúc tra': r.webTotal,
      'LinkQ lúc tra': r.linkQ
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Log du thieu');
    XLSX.writeFile(wb, `Log-du-thieu_${this.zaloCheckFrom}_${this.zaloCheckTo}.xlsx`);
  }

  async openThCheck(manage = false): Promise<void> {
    this.closeMorePopup();
    this.thManage = manage;
    this.showThCheck = true;
    this.thQuery = '';
    this.thOptionFilter = '';
    await this.loadThList();
    if (this.thItems.length) void this.loadThStock();
  }

  /** Mục Week: bảng chi tiết như Xem toàn bộ tất cả các mục — chỉ dòng có Week (nhập ở Inbound). */
  openKkWeekView(code = ''): void {
    const boxes = this.kkTypeBoxGroups.reduce((acc, m) => acc.concat(m.boxes as any[]), [] as any[]);
    if (!boxes.length) {
      appAlert('Chưa có danh sách box KK — bấm Đọc toàn kho trước.');
      return;
    }
    const needFullRead = !this.kkStockLoaded;
    this.openKkMucAll({ category: '__WEEK__', title: 'mã có Week', boxes }, undefined, needFullRead);
    this.kkWeekMode = true;
    this.kkTypePageSize = QuanLyNguyenLieuComponent.KK_WEEK_PAGE_SIZE;
    this.kkTypePage = 1;
    if (code) {
      this.kkTypeDetailQuery = code;
      this.kkTypeSearchDraft = code;
    }
    // Mã bật theo dõi Week ở Danh mục NVL (+Week) → hiện cả PO chưa có Week của mã đó
    void this.nvlCatalogFull.loadWeekTrackedCodes().then((set) => {
      this.kkWeekCatalogTracked = set;
      this.invalidateKkTypeViewCache();
      this.cdr.detectChanges();
    }).catch(() => undefined);
    // Khách theo Danh mục NVLKH → quyết định hạn dùng tem (Gilbarco / khách khác)
    void this.nvlkhCatalog.loadAllAsMap().then((map) => {
      this.nvlkhCustomerMap = map;
      this.cdr.detectChanges();
    }).catch(() => undefined);
    this.invalidateKkTypeViewCache();
    if (needFullRead) void this.loadKkByType();
    this.cdr.detectChanges();
  }

  async openKkThView(): Promise<void> {
    await this.loadThList();
    if (!this.thItems.length) {
      appAlert('Chưa có danh sách tiêu hủy. Vào Công cụ → Tiêu hủy để import.');
      return;
    }
    const boxes = this.kkTypeBoxGroups.reduce((acc, m) => acc.concat(m.boxes as any[]), [] as any[]);
    if (!boxes.length) {
      appAlert('Chưa có danh sách box KK — bấm Đọc toàn kho trước.');
      return;
    }
    const needFullRead = !this.kkStockLoaded;
    this.openKkMucAll({ category: '__TH__', title: 'danh sách tiêu hủy (TH)', boxes }, undefined, needFullRead);
    this.kkThMode = true;
    this.invalidateKkTypeViewCache();
    if (needFullRead) void this.loadKkByType();
    this.cdr.detectChanges();
  }

  private async loadThList(): Promise<void> {
    this.thLoading = true;
    this.thError = '';
    this.cdr.detectChanges();
    try {
      const snap = await this.thDocRef().get();
      this.readTracker.track('materials', 'tieu-huy-check', 1);
      const d = (snap.exists ? snap.data() : null) as any;
      this.thItems = Array.isArray(d?.items) ? d.items.map((x: any) => ({
        code: String(x.code || '').trim().toUpperCase(),
        qty: Number(x.qty) || 0,
        option: (['co', 'khong-co', 'thieu'].includes(x.option) ? x.option : '') as any,
        actualQty: x.actualQty == null || x.actualQty === '' ? null : Number(x.actualQty)
      })) : [];
      this.thMeta = {
        fileName: String(d?.fileName || ''),
        importedAt: this.normalizeTimestamp(d?.importedAt),
        importedBy: String(d?.importedBy || '')
      };
    } catch (e: any) {
      this.thError = 'Không đọc được danh sách tiêu hủy: ' + (e?.message || e);
    } finally {
      this.thLoading = false;
      this.rebuildThIndex();
      this.cdr.detectChanges();
    }
  }

  toggleKkToolMenu(menu: 'print' | 'tools'): void {
    this.kkToolMenu = this.kkToolMenu === menu ? null : menu;
  }

  toggleKkLive(): void {
    if (this.kkLiveActive) this.stopKkLive();
    else this.startKkLive();
  }

  /** Cột "Thời gian" cạnh cột KK: ngày giờ tick (dd/MM HH:mm). Chưa tick → trống. */
  kkTickTimeText(m: InventoryMaterial): string {
    if (!m || !this.isKkFlagOn(m.kkChecked)) return '';
    const raw: any = (m as any).kkAt;
    const d: Date | null = !raw ? null
      : typeof raw.toDate === 'function' ? raw.toDate()
      : raw.seconds != null ? new Date(raw.seconds * 1000)
      : raw instanceof Date ? raw : new Date(raw);
    if (!d || Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** Người tick KK: tên rút gọn 2 chữ cuối (Trần Tuấn Anh → Tuấn Anh); chưa tra được tên thì hiện mã. */
  kkTickByText(m: InventoryMaterial): string {
    if (!m || !this.isKkFlagOn(m.kkChecked)) return '';
    const id = String((m as any).kkBy || '').trim().toUpperCase();
    return this.kkEmployeeShortName(id) || id;
  }

  formatKkLiveTime(d: Date | null | undefined): string {
    if (!d || Number.isNaN(d.getTime()) || !d.getTime()) return '—';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  openKkIdReport(): void {
    const today = this.toDateKey(new Date());
    if (!this.kkIdReportStart) this.kkIdReportStart = today;
    if (!this.kkIdReportEnd) this.kkIdReportEnd = today;
    this.showKkIdReport = true;
    this.kkIdReportError = '';
    if (!this.kkIdReportRows.length && !this.kkIdReportLoading) {
      void this.loadKkIdReport();
    }
  }

  setKkLocMapView(view: 'location' | 'material' | 'type' | 'manager'): void {
    if (this.kkLocMapView === view && !this.kkLocMapLoading) {
      if (this.kkActiveProductType) this.backKkTypeBoxes();
      return;
    }
    this.kkLocMapView = view;
    this.kkLocMapQuery = '';
    this.kkLocMapExpandedKey = null;
    this.kkActiveProductType = null;
    this.kkActiveTypeDraft = null;
    this.kkActivePinSplit = null;
    this.kkActiveSourceProductType = null;
    this.kkAllStockDetail = false;
    this.kkConnectorFloorDetail = null;
    if (!this.kkStockLoaded) {
      if (view === 'type') void this.loadKkMucAllowedLocs();
      return;
    }
    if (view === 'location') void this.loadKkLocMap();
    else if (view === 'material') void this.loadKkByMaterial();
    else if (view === 'manager' && this.kkLocMapTypeCache.size) {
      this.invalidateKkTypeViewCache();
      this.cdr.detectChanges();
    } else {
      void this.loadKkCatalogForMap();
    }
    if (view === 'type') void this.loadKkMucAllowedLocs();
    this.syncKkPageLock();
  }

  openKkCodeLookup(): void {
    this.showKkCodeLookup = true;
    this.kkCodeLookupBusy = false;
    if (!this.kkCodeLookupResult) this.kkCodeLookupInput = '';
    this.cdr.detectChanges();
    setTimeout(() => {
      const el = document.getElementById('kkCodeLookupInput') as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 80);
  }

  closeKkCodeLookup(): void {
    this.showKkCodeLookup = false;
  }

  openKkPalletCheck(): void {
    this.showKkPalletCheck = true;
    void this.loadKkPalletCheck();
  }

  async loadKkPalletCheck(): Promise<void> {
    this.kkPalletCheckBusy = true;
    this.kkPalletCheckRows = [];
    this.kkPalletCheckTotal = 0;
    this.cdr.detectChanges();
    try {
      const snap = await this.firestore
        .collection('inventory-materials', (ref) =>
          ref.where('factory', '==', this.selectedFactory).limit(10000)
        )
        .get()
        .toPromise();
      const byWh = new Map<KkWarehouse, { pallets: Set<string>; lines: number; noPallet: number }>();
      for (const w of this.kkLocMapWarehouseOptions) {
        byWh.set(w.id, { pallets: new Set<string>(), lines: 0, noPallet: 0 });
      }
      for (const doc of snap?.docs || []) {
        const data = doc.data() as any;
        const stock = this.stockFromInventoryDoc(data);
        if (stock <= 0) continue;
        if (this.isKkQcNgData(data)) continue;
        const warehouse = this.kkWarehouseFromLocation(this.locationFromInventoryDoc(data));
        const cur = byWh.get(warehouse);
        if (!cur) continue;
        cur.lines += 1;
        const pallet = String(data.palletId || '').trim().toUpperCase();
        if (!pallet) cur.noPallet += 1;
        else cur.pallets.add(pallet);
      }
      this.kkPalletCheckRows = this.kkLocMapWarehouseOptions.map((w) => {
        const cur = byWh.get(w.id)!;
        return {
          warehouse: w.id,
          label: w.label,
          pallets: cur.pallets.size,
          lines: cur.lines,
          noPallet: cur.noPallet
        };
      });
      this.kkPalletCheckTotal = this.kkPalletCheckRows.reduce((n, r) => n + r.pallets, 0);
    } catch (e) {
      console.error('loadKkPalletCheck:', e);
      appAlert('Không đếm được pallet theo kho.');
    } finally {
      this.kkPalletCheckBusy = false;
      this.cdr.detectChanges();
    }
  }

  onKkCodeLookupInput(value: string): void {
    this.kkCodeLookupInput = String(value || '').toUpperCase();
  }

  async submitKkCodeLookup(): Promise<void> {
    const code = String(this.kkCodeLookupInput || '').trim().toUpperCase();
    this.kkCodeLookupInput = code;
    if (!code) {
      this.kkCodeLookupResult = null;
      return;
    }
    this.kkCodeLookupBusy = true;
    this.kkCodeLookupResult = null;
    this.cdr.detectChanges();
    try {
      if (!this.kkCatalogTypeMap.size) {
        this.kkCatalogTypeMap = await this.kkCatalog.loadAllAsMap();
      }
      const productType = this.kkTypeOrGroupOfMaterial(code);
      const inCatalog = !!this.kkCatalog.productTypeOf(code, this.kkCatalogTypeMap);
      let stock = 0;
      let lines = 0;
      this.kkLocMapTypeCache.forEach((list) => {
        for (const m of list) {
          if (String(m.materialCode || '').trim().toUpperCase() !== code) continue;
          stock += this.calculateCurrentStock(m);
          lines += 1;
        }
      });
      if (!lines) {
        this.kkLocMapMaterialCache.forEach((list) => {
          for (const m of list) {
            if (String(m.materialCode || '').trim().toUpperCase() !== code) continue;
            stock += this.calculateCurrentStock(m);
            lines += 1;
          }
        });
      }
      if (!lines) {
        const snap = await this.firestore
          .collection('inventory-materials', (ref) =>
            ref.where('materialCode', '==', code).limit(200)
          )
          .get()
          .toPromise();
        const factory = String(this.selectedFactory || '').trim().toUpperCase();
        const seen = new Set<string>();
        for (const doc of snap?.docs || []) {
          const data = doc.data() as any;
          if (String(data.factory || '').trim().toUpperCase() !== factory) continue;
          if (seen.has(doc.id)) continue;
          seen.add(doc.id);
          stock += this.stockFromInventoryDoc(data);
          lines += 1;
        }
      }
      this.kkCodeLookupResult = {
        code,
        productType,
        stock,
        lines,
        found: lines > 0 || inCatalog
      };
    } catch (e) {
      console.error('❌ submitKkCodeLookup:', e);
      this.kkCodeLookupResult = {
        code,
        productType: '—',
        stock: 0,
        lines: 0,
        found: false
      };
      appAlert('❌ Không tra được mã hàng.');
    } finally {
      this.kkCodeLookupBusy = false;
      this.cdr.detectChanges();
    }
  }

  get kkLocMapFilteredBoxes(): Array<{ loc: string; checked: number; total: number }> {
    let boxes = this.kkLocMapBoxes;
    if (this.kkJOnly || this.kkLocMapWarehouseFilter === 'J') {
      boxes = boxes.filter((b) => this.kkWarehouseFromLocation(b.loc) === 'J');
    } else if (this.kkLocMapWarehouseFilter) {
      boxes = boxes.filter((b) => this.kkWarehouseFromLocation(b.loc) === this.kkLocMapWarehouseFilter);
    }
    const q = this.kkEffectiveSearchQuery();
    if (q) boxes = boxes.filter((b) => b.loc.includes(q));
    return boxes;
  }

  get kkTypeBoxGroups(): Array<{
    category: string;
    title: string;
    boxes: Array<{
      productType: string;
      groupCodes: string[];
      sharedPrefix: string;
      stock: number;
      checked: number;
      totalLines: number;
      remaining: number;
    }>;
    groups?: Array<{
      key: string;
      title: string;
      boxes: typeof this.kkTypeBoxesCached;
      subMucs: Array<{ key: string; title: string; boxes: typeof this.kkTypeBoxesCached }>;
    }>;
  }> {
    // `kkTypeBoxes` đã tự cache theo `kkTypeBoxesSig`; nhóm mục chỉ phụ thuộc vào nó
    // nên tái dùng kết quả cho tới khi chữ ký đổi — tránh gom nhóm lại mỗi CD tick.
    const boxes = this.kkTypeBoxes;
    const groupsSig = `${this.kkTypeBoxesSig}|${this.selectedFactory}`;
    if (this.kkTypeBoxGroupsSig === groupsSig) {
      return this.kkTypeBoxGroupsCached;
    }
    const map = new Map<string, typeof this.kkTypeBoxesCached>();
    for (const box of boxes) {
      const category = this.kkTypeCategoryOf(box.productType, box.groupCodes);
      const list = map.get(category) || [];
      list.push(box);
      map.set(category, list);
    }
    this.kkTypeBoxGroupsCached = Array.from(map.entries())
      .map(([category, boxesInCat]) => {
        const sorted = this.sortKkTypeBoxesInCategory(category, boxesInCat);
        return {
          category,
          title: this.kkTypeMucTitle(category),
          boxes: sorted,
          groups: this.kkTypeBrandGroupsOf(category, sorted)
        };
      })
      // Chưa đọc tồn toàn kho: hiện đủ mục (mở mục mới đọc); đã đọc thì ẩn mục không còn tồn
      .filter((muc) => !this.kkStockLoaded || muc.boxes.some((b) => (b.stock || 0) > 0 || (b.totalLines || 0) > 0))
      // Không hiển thị mục B033 — 14/10/2026
      .filter((muc) => !MaterialsComponent.KK_HIDDEN_MUCS.includes(muc.category));
    if (this.selectedFactory === 'ASM2') {
      // ASM2 theo đầu mã: mục nào cũng giữ riêng, xếp theo đầu mã
      this.kkTypeBoxGroupsCached.sort((a, b) => a.category.localeCompare(b.category, 'en', { numeric: true }));
    } else {
      this.kkTypeBoxGroupsCached = this.mergeKkSingletonMucsFromB019(this.kkTypeBoxGroupsCached);
    }
    this.kkTypeBoxGroupsSig = groupsSig;
    return this.kkTypeBoxGroupsCached;
  }

  /**
   * Từ B019 trở đi: mục chỉ có 1 loại → gom vào "Mục còn lại".
   * Giữ nguyên B036/B042 và các mục đặc biệt (< B019, NHUA, DAYCAP…).
   */
  private mergeKkSingletonMucsFromB019(
    mucs: typeof this.kkTypeBoxGroupsCached
  ): typeof this.kkTypeBoxGroupsCached {
    const keep: typeof this.kkTypeBoxGroupsCached = [];
    const mergedBoxes: typeof this.kkTypeBoxesCached = [];
    for (const muc of mucs) {
      const m = /^B(\d{3})$/.exec(String(muc.category || ''));
      const n = m ? Number(m[1]) : 0;
      // B036 / B042 giữ mục riêng (đã bỏ mục con, chỉ box phẳng)
      if (muc.category === 'B036' || muc.category === 'B042') {
        keep.push(muc);
        continue;
      }
      if (n >= 19 && muc.boxes.length === 1) {
        mergedBoxes.push(...muc.boxes);
        continue;
      }
      keep.push(muc);
    }
    if (!mergedBoxes.length) return keep;
    const sorted = this.sortKkTypeBoxesInCategory('CONLAI', mergedBoxes);
    keep.push({
      category: 'CONLAI',
      title: this.kkTypeMucTitle('CONLAI'),
      boxes: sorted,
      groups: undefined
    });
    return keep;
  }

  /** Gom loại hàng thành mục. Cùng đầu mã B+3 → một mục, các box nằm trong đó. */
  kkTypeCategoryOf(productType: string, groupCodes: string[] = []): string {
    const raw = String(productType || '').trim();
    if (!raw) return 'Khác';
    if (raw === 'Chưa gán danh mục') return raw;
    const prefixes = this.kkTypeGroupPrefixes(groupCodes);
    // ASM2: mỗi mục = 1 đầu mã (B001, B002, R028…), không gom mục đặc biệt
    if (this.selectedFactory === 'ASM2') {
      if (prefixes.length) return prefixes[0];
      const head = /^([A-Z]\d{3})/i.exec(raw);
      return head ? head[1].toUpperCase() : this.kkTypeNameHeadOf(raw);
    }
    // Mọi loại có mã đầu A (A001, A031…) gom chung một mục "A" — 14/10/2026
    if (prefixes.length ? prefixes.every((p) => p.startsWith('A')) : /^A\d{3}$/i.test(raw)) return 'A';
    if (this.isKkDauNoiMuc(raw, groupCodes)) return this.kkDauNoiGroupKey({ groupCodes });
    const bPrefix = this.kkTypeSharedBPrefix(groupCodes);
    if (bPrefix === 'B018') return 'B018';
    if (this.isKkDauCotMuc(raw, groupCodes)) return 'ĐẦU CỐT';
    if (this.isKkNhuaType(prefixes, raw)) return 'NHUA';
    if (this.isKkDayCapType(prefixes, raw)) return 'DAYCAP';
    // Đầu mã dây cáp đơn lẻ (B002/B003/B005/B006) → luôn vào Mục Dây cáp
    if (bPrefix && this.isKkDayCapPrefix(bPrefix)) return 'DAYCAP';
    if (bPrefix) return bPrefix;
    if (/DAU\s*NOI/.test(this.foldKkTypeName(raw))) return 'Khác';
    return this.kkTypeNameHeadOf(raw);
  }

  /** B009/B016/B018 chia kệ × tầng. B017, Nhựa, Dây cáp, B036, B042: không chia mục con. */
  private kkTypeBrandGroupsOf(
    category: string,
    boxes: typeof this.kkTypeBoxesCached
  ): Array<{
    key: string;
    title: string;
    boxes: typeof this.kkTypeBoxesCached;
    subMucs: Array<{ key: string; title: string; boxes: typeof this.kkTypeBoxesCached }>;
  }> | undefined {
    // B017 hiện hai dãy R17/R18, không chia kệ S.
    // Từ 14/10/2026: B009/B016/B018 cũng không chia kệ × tầng nữa — mọi mục hiện lưới phẳng.
    return undefined;
  }

  /**
   * Mục hiện theo sơ đồ mâm kệ trên trang KK. Từ 14/10/2026 không chia mâm kệ nữa (B009/B016/B018
   * hiện lưới phẳng như các mục khác). In tem kệ theo mâm vẫn dùng isKkConnectorRackMuc.
   */
  isKkRackBoardMuc(_category: string): boolean {
    return false;
  }

  isKkPrefixColsMuc(category: string): boolean {
    // Không còn chia cột mục con cho Nhựa / B036 / B042
    return false;
  }

  isKkNameColsMuc(category: string): boolean {
    return category === 'B036' || category === 'B042';
  }

  private isKkNhuaPrefix(prefix: string): boolean {
    return prefix === 'B011' || prefix === 'B012' || prefix === 'B014' || prefix === 'B013';
  }

  private isKkDayCapPrefix(prefix: string): boolean {
    return prefix === 'B003' || prefix === 'B005' || prefix === 'B002' || prefix === 'B006';
  }

  /** Loại có một hoặc nhiều đầu mã nhựa, hoặc tên loại là nhựa. */
  private isKkNhuaType(prefixes: string[], productType = ''): boolean {
    if (prefixes.length && prefixes.every((p) => this.isKkNhuaPrefix(p))) return true;
    const fold = this.foldKkTypeName(this.kkTypeNameHeadOf(productType) || productType);
    return /^NHUA\b/.test(fold) || fold === 'PLASTIC';
  }

  /** Loại có một hoặc nhiều đầu mã dây cáp (vd B002+B005), hoặc tên loại là dây cáp. */
  private isKkDayCapType(prefixes: string[], productType = ''): boolean {
    if (prefixes.length && prefixes.every((p) => this.isKkDayCapPrefix(p))) return true;
    const fold = this.foldKkTypeName(this.kkTypeNameHeadOf(productType) || productType);
    return /^DAY\s*CAP/.test(fold) || fold === 'CABLE';
  }

  private kkDauNoiGroupKey(box: { groupCodes?: string[] }): string {
    const prefixes = this.kkTypeGroupPrefixes(box.groupCodes || []);
    for (const p of ['B008', 'B009', 'B016'] as const) {
      if (prefixes.includes(p)) return p;
    }
    return prefixes[0] || 'Khác';
  }

  kkTypeMucTitle(category: string): string {
    if (category === 'Chưa gán danh mục') return 'Chưa gán danh mục';
    if (category === 'Khác') return 'Mục khác';
    if (category === 'CONLAI') return 'Mục còn lại';
    if (category === 'ĐẦU NỐI') return 'Mục Đầu nối';
    if (category === 'ĐẦU CỐT') return 'Mục Đầu cốt (Terminal)';
    if (category === 'NHUA') return 'Mục Nhựa';
    if (category === 'DAYCAP') return 'Mục Dây cáp';
    if (category === 'A') return 'Nhóm A';
    if (/^B\d{3}$/.test(category)) return `Mục ${category}`;
    const lower = category.toLocaleLowerCase('vi');
    const pretty = lower ? lower.charAt(0).toLocaleUpperCase('vi') + lower.slice(1) : category;
    return `Mục ${pretty}`;
  }

  isKkTypeMucCollapsed(category: string): boolean {
    // Mục cấp 1 luôn mở (chỉ hiện 1 mục đang chọn ở cột trái)
    if (!category.includes('|')) return false;
    return !!this.kkTypeMucCollapsed[category];
  }

  /** Chọn mục ở cột trái: chỉ hiện mục đó; chưa đọc toàn kho thì đọc tồn riêng mục này. */
  selectKkMuc(muc: { category: string; title: string; boxes: Array<any> }): void {
    this.kkSelectedMuc = muc.category;
    if (!this.kkStockLoaded) {
      const boxes = muc.boxes.filter((b) => !this.isKkTypeBoxStockLoaded(b));
      if (boxes.length) void this.loadKkStockForBoxes(boxes, `mục ${muc.title}`);
    }
    const el = this.kkPageBodyEl();
    if (el) el.scrollTop = 0;
  }

  /** Box của mục đang chọn; đang tìm kiếm thì hiện mọi mục khớp. */
  get kkVisibleMucs(): typeof this.kkTypeBoxGroupsCached {
    const all = this.kkTypeBoxGroups;
    if (this.kkEffectiveSearchQuery()) return all;
    if (this.kkVisibleMucsMemo.src === all && this.kkVisibleMucsMemo.sel === this.kkSelectedMuc) {
      return this.kkVisibleMucsMemo.out;
    }
    const out = all.filter((m) => m.category === this.kkSelectedMuc);
    this.kkVisibleMucsMemo = { src: all, sel: this.kkSelectedMuc, out };
    return out;
  }

  private kkVisibleMucsMemo: { src: unknown; sel: string | null; out: typeof this.kkTypeBoxGroupsCached } = {
    src: null,
    sel: null,
    out: []
  };

  toggleKkTypeMuc(category: string, event?: Event): void {
    event?.stopPropagation();
    if (!category.includes('|')) return;
    this.kkTypeMucCollapsed = {
      ...this.kkTypeMucCollapsed,
      [category]: !this.kkTypeMucCollapsed[category]
    };
  }

  kkTypeNestKey(...parts: string[]): string {
    return parts.filter(Boolean).join('|');
  }

  kkB009ShelfGroups(muc: {
    groups?: Array<{
      key: string;
      title: string;
      boxes: typeof this.kkTypeBoxesCached;
      subMucs: Array<{ key: string; title: string; boxes: typeof this.kkTypeBoxesCached }>;
    }>;
  }): NonNullable<typeof muc.groups> {
    return (muc.groups || []).filter((g) => /^S\d{2}$/.test(g.key));
  }

  kkB009OtherGroups(muc: {
    groups?: Array<{
      key: string;
      title: string;
      boxes: typeof this.kkTypeBoxesCached;
      subMucs: Array<{ key: string; title: string; boxes: typeof this.kkTypeBoxesCached }>;
    }>;
  }): NonNullable<typeof muc.groups> {
    return (muc.groups || []).filter((g) => !/^S\d{2}$/.test(g.key));
  }

  kkB009LevelsTopDown(group: {
    subMucs: Array<{ key: string; title: string; boxes: typeof this.kkTypeBoxesCached }>;
  }): typeof group.subMucs {
    return [...group.subMucs].sort((a, b) => this.kkB009SubLevel(b) - this.kkB009SubLevel(a));
  }

  kkB009SubLevel(sub: { key: string }): number {
    const m = /-T(\d+)$/.exec(sub.key);
    return m ? Number(m[1]) : 0;
  }

  kkB009FloorEmpty(sub: { title: string }): boolean {
    return /trống/i.test(sub.title);
  }

  kkB009SubFullRange(sub: { title: string }): string {
    const raw = String(sub.title || '').split(' · ').pop() || '';
    if (/trống/i.test(raw)) return 'Trống';
    return raw.trim();
  }

  kkB009ShelfShortRange(group: { title: string }): string {
    const m = /B\d{3}(\d{3})\s*~\s*B\d{3}(\d{3})/i.exec(group.title || '');
    return m ? `${m[1]}–${m[2]}` : '';
  }

  isKkB009FloorOn(category: string, shelf: string, sub: { key: string }): boolean {
    return this.kkConnectorViewShelf(category) === shelf
      && this.kkConnectorViewLevel(category) === this.kkB009SubLevel(sub);
  }

  setKkB009Floor(category: string, shelf: string, sub: { key: string }): void {
    const level = this.kkB009SubLevel(sub);
    const prev = this.kkConnectorRackView[category];
    this.kkConnectorRackView = {
      ...this.kkConnectorRackView,
      [category]: { shelf, level }
    };
    // Đổi tầng → đóng danh sách chi tiết cũ
    if (!prev || prev.shelf !== shelf || prev.level !== level) {
      this.kkConnectorFloorCodesOpen = { ...this.kkConnectorFloorCodesOpen, [category]: false };
    }
  }

  /** Bấm ô mâm/tầng: chọn tầng (highlight). Chi tiết → bảng KK. */
  selectKkB009Floor(category: string, shelf: string, sub: { key: string; title: string }): void {
    if (!this.kkB009FloorSelectable(category, shelf, sub)) return;
    this.setKkB009Floor(category, shelf, sub);
  }

  isKkConnectorBoardOpen(category: string): boolean {
    return !!this.kkConnectorBoardOpen[category];
  }

  toggleKkConnectorBoard(category: string, event?: Event): void {
    event?.stopPropagation();
    this.kkConnectorBoardOpen = {
      ...this.kkConnectorBoardOpen,
      [category]: !this.kkConnectorBoardOpen[category]
    };
  }

  onKkMucContextMenu(event: MouseEvent, category: string): void {
    const id = String(category || '').trim();
    if (!id) return;
    event.preventDefault();
    event.stopPropagation();
    this.kkMucShelfMenuCategory = id;
    this.kkMucShelfMenuX = event.clientX;
    this.kkMucShelfMenuY = event.clientY;
    this.kkMucShelfDraft = '';
    this.skipKkTypeBoxMenuClose = true;
    setTimeout(() => { this.skipKkTypeBoxMenuClose = false; }, 0);
    this.cdr.detectChanges();
  }

  /** Mã khác nhau trong 1 box (mỗi mã có thể nhiều PO) — memo theo lần đổi dữ liệu KK. */
  private kkBoxCodesMemo: { sig: string; map: Map<string, Set<string>> } = { sig: '', map: new Map() };

  private kkBoxCodeSet(productType: string): Set<string> {
    const sig = `${this.kkTypeCacheRev}|${this.kkCheckActive ? this.linkQCheckSet.size : 0}`;
    if (this.kkBoxCodesMemo.sig !== sig) this.kkBoxCodesMemo = { sig, map: new Map() };
    const hit = this.kkBoxCodesMemo.map.get(productType);
    if (hit) return hit;
    const set = new Set<string>();
    for (const m of this.kkCachedLinesForType(productType)) {
      if (this.calculateCurrentStock(m) <= 0) continue;
      if (this.kkCheckActive && !this.kkCheckHas(m.materialCode)) continue;
      if (this.isKkAgingExempt(m)) continue;
      const c = String(m.materialCode || '').trim().toUpperCase();
      if (c) set.add(c);
    }
    this.kkBoxCodesMemo.map.set(productType, set);
    return set;
  }

  kkBoxCodeCount(box: { productType: string }): number {
    return this.kkBoxCodeSet(box.productType).size;
  }

  /** Số mã khác nhau của cả mục (gộp các box). */
  kkMucUniqueCodes(muc: { boxes?: Array<{ productType: string }> }): number {
    const all = new Set<string>();
    for (const b of muc.boxes || []) this.kkBoxCodeSet(b.productType).forEach((c) => all.add(c));
    return all.size;
  }

  kkMucCodeTotal(muc: { boxes?: Array<{ totalLines?: number }> }): number {
    return (muc.boxes || []).reduce((n, box) => n + (Number(box.totalLines) || 0), 0);
  }

  // ===== Nút % của mục: đọc toàn kho (nếu chưa) → % mã đã KK / tổng mã của từng mục =====
  kkMucPctOn = false;
  kkMucPctLoading = false;

  async showKkMucPct(event?: Event): Promise<void> {
    event?.stopPropagation();
    if (this.kkMucPctOn && !this.kkMucPctLoading) {
      this.kkMucPctOn = false;
      return;
    }
    this.kkMucPctOn = true;
    if (!this.kkStockLoaded) {
      this.kkMucPctLoading = true;
      this.cdr.detectChanges();
      try {
        await this.loadKkByType();
      } finally {
        this.kkMucPctLoading = false;
        this.cdr.detectChanges();
      }
    }
  }

  /** % KK của mục: số dòng (mã + PO) đã tick KK / tổng dòng của mục. */
  kkMucLinePct(muc: { boxes?: Array<{ checked?: number; totalLines?: number }> }): number {
    const total = this.kkMucCodeTotal(muc);
    return total ? Math.round((this.kkMucCheckedTotal(muc) / total) * 1000) / 10 : 0;
  }

  kkMucCheckedTotal(muc: { boxes?: Array<{ checked?: number }> }): number {
    return (muc.boxes || []).reduce((n, box) => n + (Number(box.checked) || 0), 0);
  }

  kkMucParentShelves(category: string): string[] {
    const removed = new Set(this.kkMucRemovedShelves[category] || []);
    const base = this.kkConnectorRackShelfDefs(category)
      .map((row) => row.shelf)
      .filter((shelf) => !removed.has(shelf));
    const extra = (this.kkMucExtraShelves[category] || []).filter((shelf) => !base.includes(shelf) && !removed.has(shelf));
    return [...base, ...extra];
  }

  addKkMucParentShelf(): void {
    const category = this.kkMucShelfMenuCategory;
    if (!category || this.kkMucShelfSaving) return;
    if (!this.canEdit) {
      appAlert('Bạn không có quyền thêm kệ.');
      return;
    }
    const shelf = this.normalizeKkParentShelf(this.kkMucShelfDraft);
    if (!shelf) {
      appAlert('Nhập tên kệ mẹ.');
      return;
    }
    const defs = new Set(this.kkConnectorRackShelfDefs(category).map((row) => row.shelf));
    const removed = new Set(this.kkMucRemovedShelves[category] || []);
    if (removed.has(shelf)) {
      removed.delete(shelf);
      void this.saveKkMucShelfState(category, this.kkMucExtraShelves[category] || [], [...removed]);
      return;
    }
    if (this.kkMucParentShelves(category).includes(shelf)) {
      appAlert(`${shelf} đã có trong mục ${category}.`);
      return;
    }
    const next = defs.has(shelf)
      ? (this.kkMucExtraShelves[category] || [])
      : [...(this.kkMucExtraShelves[category] || []), shelf];
    void this.saveKkMucShelfState(category, next, [...removed]);
  }

  removeKkMucParentShelf(shelf: string): void {
    const category = this.kkMucShelfMenuCategory;
    if (!category || this.kkMucShelfSaving || !this.canEdit) return;
    const defs = new Set(this.kkConnectorRackShelfDefs(category).map((row) => row.shelf));
    const extras = (this.kkMucExtraShelves[category] || []).filter((id) => id !== shelf);
    const removed = (this.kkMucRemovedShelves[category] || []).filter((id) => id !== shelf);
    if (defs.has(shelf)) removed.push(shelf);
    void this.saveKkMucShelfState(category, extras, removed);
  }

  hasKkMucAllowedSet(category: string): boolean {
    return Array.isArray(this.kkMucAllowedLocs[category]);
  }

  kkMucLocAllowed(category: string, loc: string): boolean {
    const set = this.kkMucAllowedLocs[category];
    if (!set) return true;
    return set.includes(loc);
  }

  kkB009FloorSelectable(category: string, shelf: string, sub: { key: string }): boolean {
    if (!this.hasKkMucAllowedSet(category)) return true;
    const level = this.kkB009SubLevel(sub);
    return this.kkShelfBlockNos(shelf).some((block) => this.kkMucLocAllowed(category, this.kkB009LocOf(shelf, block, level)));
  }

  kkB009VisibleShelfGroups(muc: {
    category?: string;
    groups?: Array<{
      key: string;
      title: string;
      boxes: typeof this.kkTypeBoxesCached;
      subMucs: Array<{ key: string; title: string; boxes: typeof this.kkTypeBoxesCached }>;
    }>;
  }): NonNullable<typeof muc.groups> {
    const groups = this.kkB009ShelfGroups(muc);
    const category = String(muc.category || '');
    if (!this.hasKkMucAllowedSet(category)) return groups;
    return groups.filter((group) =>
      this.kkB009LevelsTopDown(group).some((sub) => this.kkB009FloorSelectable(category, group.key, sub))
    );
  }

  kkB009VisibleLevels(
    category: string,
    group: { key: string; subMucs: Array<{ key: string; title: string; boxes: typeof this.kkTypeBoxesCached }> }
  ): typeof group.subMucs {
    const levels = this.kkB009LevelsTopDown(group);
    if (!this.hasKkMucAllowedSet(category)) return levels;
    return levels.filter((sub) => this.kkB009FloorSelectable(category, group.key, sub));
  }

  /** Toàn bộ tồn kho — không phân loại theo loại hàng; 50 dòng/trang; tìm mã / vị trí. */
  openKkAllStockDetail(): void {
    this.kkAllStockDetail = true;
    this.kkConnectorFloorDetail = null;
    const title = this.kkAllStockDetailTitle;
    this.kkActiveProductType = title;
    this.kkActiveSourceProductType = title;
    this.kkActivePinSplit = null;
    this.kkActiveTypeDraft = this.buildEmptyKkTypeRow(title);
    this.clearKkLocScanDay();
    this.kkTypePage = 1;
    this.kkTypePageSize = 50;
    this.kkTypeDetailQuery = '';
    this.kkTypeSearchDraft = '';
    this.kkTypeFilterLoc = '';
    this.kkTypeFilterWh = '';
    this.kkTypeFilterRolls = '';
    this.kkTypeSortQtyDesc = false;
    this.kkTypeSortRollsDesc = false;
    this.kkTypeSortKkTimeDesc = false;
    this.kkTypeShowExtraFilter = false;
    this.kkTypeDetailSig = '';
    if (!this.kkStockLoaded) void this.loadKkByType();
    this.syncKkPageLock();
    this.cdr.detectChanges();
    setTimeout(() => void this.ensureKkTypeMaterialNames(), 0);
  }

  /** Chi tiết KK đang chờ người dùng nhập mã hoặc vị trí. */
  kkAllStockWaitingSearch(): boolean {
    return this.kkAllStockDetail && !this.kkAllStockSearch() && !this.kkPoCmpActive;
  }

  kkB009ViewSub(muc: {
    category?: string;
    groups?: Array<{
      key: string;
      title: string;
      boxes: typeof this.kkTypeBoxesCached;
      subMucs: Array<{ key: string; title: string; boxes: typeof this.kkTypeBoxesCached }>;
    }>;
  }): { key: string; title: string; boxes: typeof this.kkTypeBoxesCached } | null {
    const category = String(muc.category || '');
    const shelf = this.kkConnectorViewShelf(category);
    const g = this.kkB009ShelfGroups(muc).find((x) => x.key === shelf);
    return g?.subMucs.find((s) => this.kkB009SubLevel(s) === this.kkConnectorViewLevel(category)) || null;
  }

  kkB009FloorCodeCount(sub: { title: string }): number {
    const r = this.kkB009SubRangeNums(sub);
    return r ? r.to - r.from + 1 : 0;
  }

  /** Ẩn prefix đã trùng với tiêu đề mục/cột đang bao ngoài — tránh lặp lại thông tin đã rõ. */
  kkTypeVisibleGroupPrefixes(box: { groupCodes: string[] }, hide: Array<string | undefined> = []): string[] {
    const hideSet = new Set(hide.filter((h): h is string => !!h));
    return this.kkTypeGroupPrefixes(box.groupCodes).filter((p) => !hideSet.has(p));
  }

  kkTypeBoxTone(box: { checked: number; totalLines: number }): string {
    if (!box.totalLines) return 'empty';
    if (box.checked >= box.totalLines) return 'done';
    if (box.checked <= 0) return 'none';
    return 'partial';
  }

  /** "Xem toàn bộ" tất cả các mục: gộp mọi box của mọi mục; chưa đọc toàn kho thì đọc toàn kho 1 lần. */
  openKkAllMucs(event?: Event): void {
    event?.stopPropagation();
    const boxes = this.kkTypeBoxGroups.reduce((acc, m) => acc.concat(m.boxes as any[]), [] as any[]);
    if (!boxes.length) return;
    const needFullRead = !this.kkStockLoaded;
    this.openKkMucAll({ category: '__ALL__', title: 'tất cả các mục', boxes }, undefined, needFullRead);
    if (needFullRead) void this.loadKkByType();
  }

  openKkMucAll(muc: { category: string; title: string; boxes: Array<any> }, event?: Event, skipBoxLoad = false): void {
    event?.stopPropagation();
    if (!muc?.boxes?.length) return;
    this.kkThMode = false;
    this.kkWeekMode = false;
    this.kkTypeListScrollTop = this.kkPageBodyEl()?.scrollTop || 0;
    const title = `Toàn bộ ${muc.title}`;
    this.kkAllStockDetail = false;
    this.kkConnectorFloorDetail = null;
    this.kkMucAllDetail = { title, boxes: muc.boxes };
    this.kkActiveProductType = title;
    this.kkActiveSourceProductType = title;
    this.kkActivePinSplit = null;
    this.kkActiveTypeDraft = this.buildEmptyKkTypeRow(title);
    this.kkTypePage = 1;
    this.kkTypeDetailQuery = '';
    this.kkTypeSearchDraft = '';
    this.kkTypeFilterLoc = '';
    this.kkTypeFilterWh = '';
    this.kkTypeFilterRolls = '';
    this.kkTypeSortQtyDesc = false;
    this.kkTypeSortRollsDesc = false;
    this.kkTypeShowExtraFilter = false;
    this.invalidateKkTypeViewCache();
    if (!this.kkStockLoaded && !skipBoxLoad) {
      const missing = muc.boxes.filter((b) => !this.isKkTypeBoxStockLoaded(b));
      if (missing.length) void this.loadKkStockForBoxes(missing, `mục ${muc.title}`);
    }
    this.syncKkPageLock();
    setTimeout(() => void this.ensureKkTypeMaterialNames(), 0);
    this.scheduleFitKkTypePageSize();
  }

  kkTypeManagerOf(productType: string): string {
    return this.kkTypeManagers.get(String(productType || '').trim()) || '';
  }

  private kkManagerNameForType(productType: string, sources: string[] = []): string {
    const keys = [productType, ...sources];
    for (const k of keys) {
      const n = this.kkTypeManagerOf(k);
      if (n) return n;
    }
    return '';
  }

  get kkManagerRows(): Array<{
    name: string;
    codeCount: number;
    typeCount: number;
    types: string[];
    prefixes: string[];
    mucs: string[];
  }> {
    const q = String(this.kkLocMapQuery || '').trim().toLowerCase();
    const sig = [
      this.kkTypeCacheRev,
      this.kkTypeManagers.size,
      this.kkLocMapTypeCache.size,
      this.kkLocMapWarehouseFilter,
      this.kkCountWh3 ? 1 : 0,
      this.kkWh3Only ? 1 : 0,
      this.kkJOnly ? 1 : 0,
      q
    ].join('|');
    if (sig === this.kkManagerRowsSig) return this.kkManagerRowsCached;
    this.kkManagerRowsSig = sig;
    this.kkManagerRowsCached = this.buildKkManagerRows(q);
    return this.kkManagerRowsCached;
  }

  get kkManagerTotalCodes(): number {
    return this.kkManagerRows.reduce((sum, row) => sum + row.codeCount, 0);
  }

  private buildKkManagerRows(query: string): Array<{
    name: string;
    codeCount: number;
    typeCount: number;
    types: string[];
    prefixes: string[];
    mucs: string[];
  }> {
    const map = new Map<string, { productType: string; groups: Set<string>; sources: Set<string> }>();
    const bump = (productType: string, groupCodes: string[] = []) => {
      const key = this.kkCanonicalTypeKey(productType, groupCodes);
      const cur = map.get(key) || {
        productType: key,
        groups: new Set<string>(),
        sources: new Set<string>()
      };
      cur.sources.add(productType);
      groupCodes.forEach((g) => cur.groups.add(g));
      map.set(key, cur);
      return cur;
    };
    for (const e of this.kkCatalogEntries) {
      bump(e.productType).groups.add(e.groupCode);
    }
    for (const r of this.kkLocMapByType) {
      bump(r.productType, r.groupCodes);
    }
    this.kkTypeManagers.forEach((_name, typeKey) => bump(typeKey));

    const zone = this.kkLocMapWarehouseFilter;
    const byManager = new Map<string, {
      display: string;
      types: Set<string>;
      codes: Set<string>;
      prefixes: Set<string>;
      mucs: Set<string>;
    }>();
    map.forEach((cur) => {
      const sources = Array.from(cur.sources);
      const manager = this.kkManagerNameForType(cur.productType, sources);
      if (!manager) return;
      const nk = manager.toLocaleLowerCase('vi');
      let rec = byManager.get(nk);
      if (!rec) {
        rec = {
          display: manager,
          types: new Set<string>(),
          codes: new Set<string>(),
          prefixes: new Set<string>(),
          mucs: new Set<string>()
        };
        byManager.set(nk, rec);
      }
      const seen = new Set<string>();
      const codesBefore = rec.codes.size;
      for (const src of sources) {
        for (const m of this.kkLocMapTypeCache.get(src) || []) {
          const id = String(m.id || '');
          if (id) {
            if (seen.has(id)) continue;
            seen.add(id);
          }
          const wh = this.kkWarehouseFromLocation(m.location);
          if (!this.kkMatchesWh3Mode(wh)) continue;
          if (zone && wh !== zone) continue;
          if (this.calculateCurrentStock(m) <= 0) continue;
          const code = String(m.materialCode || '').trim().toUpperCase();
          if (code) rec.codes.add(code);
        }
      }
      if (rec.codes.size <= codesBefore) return;
      rec.types.add(cur.productType);
      const groupCodes = Array.from(cur.groups);
      for (const p of this.kkTypeGroupPrefixes(groupCodes)) rec.prefixes.add(p);
      const muc = this.kkTypeMucTitle(this.kkTypeCategoryOf(cur.productType, groupCodes));
      if (muc) rec.mucs.add(muc);
    });

    let rows = Array.from(byManager.values())
      .filter((rec) => rec.codes.size > 0)
      .map((rec) => ({
      name: rec.display,
      codeCount: rec.codes.size,
      typeCount: rec.types.size,
      types: Array.from(rec.types).sort((a, b) => a.localeCompare(b, 'vi')),
      prefixes: Array.from(rec.prefixes).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
      mucs: Array.from(rec.mucs).sort((a, b) => a.localeCompare(b, 'vi'))
    }));
    rows.sort((a, b) => b.codeCount - a.codeCount || a.name.localeCompare(b.name, 'vi'));
    if (query) {
      rows = rows.filter((r) =>
        r.name.toLowerCase().includes(query)
        || r.types.some((t) => t.toLowerCase().includes(query))
        || r.prefixes.some((p) => p.toLowerCase().includes(query))
        || r.mucs.some((m) => m.toLowerCase().includes(query))
      );
    }
    return rows;
  }

  openKkTypeBoxMenu(event: MouseEvent, box: { productType: string; groupCodes?: string[] }): void {
    event.preventDefault();
    event.stopPropagation();
    const productType = String(box?.productType || '').trim();
    if (!productType) return;
    this.kkTypeBoxMenuBox = { productType, groupCodes: box.groupCodes || [] };
    this.kkTypeBoxMenuManagerDraft = this.kkTypeManagerOf(productType);
    this.kkTypeBoxMenuSaving = false;
    this.kkTypeBoxMenuX = event.clientX;
    this.kkTypeBoxMenuY = event.clientY;
    this.kkTypeBoxMenuVisible = true;
    this.skipKkTypeBoxMenuClose = true;
    setTimeout(() => { this.skipKkTypeBoxMenuClose = false; }, 0);
    this.cdr.detectChanges();
  }

  onKkTypeBoxMenuAssign(): void {
    const box = this.kkTypeBoxMenuBox;
    this.closeKkTypeBoxMenu();
    if (box) this.openKkTypeHomeLocPicker(box);
  }

  onKkTypeBoxMenuPrint(): void {
    const box = this.kkTypeBoxMenuBox;
    this.closeKkTypeBoxMenu();
    if (!box?.productType) return;
    this.printKkTypeNameLabel(box.productType);
  }

  async saveKkTypeBoxManager(): Promise<void> {
    const productType = String(this.kkTypeBoxMenuBox?.productType || '').trim();
    if (!productType || !this.canEdit || this.kkTypeBoxMenuSaving) return;
    const name = String(this.kkTypeBoxMenuManagerDraft || '').trim();
    this.kkTypeBoxMenuSaving = true;
    this.cdr.detectChanges();
    try {
      await this.kkCatalog.saveManager(productType, name);
      if (name) this.kkTypeManagers.set(productType, name);
      else this.kkTypeManagers.delete(productType);
      this.kkTypeManagers = new Map(this.kkTypeManagers);
      this.invalidateKkTypeViewCache();
      this.closeKkTypeBoxMenu();
      this.cdr.detectChanges();
    } catch (e) {
      console.error('saveKkTypeBoxManager:', e);
      appAlert('Không lưu được tên người quản lý. Thử lại.');
      this.kkTypeBoxMenuSaving = false;
      this.cdr.detectChanges();
    }
  }

  openKkShelfLabelPicker(): void {
    this.kkShelfLabelQuery = '';
    this.showKkShelfLabelPicker = true;
  }

  closeKkShelfLabelPicker(): void {
    this.showKkShelfLabelPicker = false;
    this.kkShelfLabelQuery = '';
  }

  openKkMucReportPicker(): void {
    this.kkMucReportQuery = '';
    if (!Object.keys(this.kkKiemKeSelectedPrefixes).length) {
      for (const p of this.kkKiemKeAllPrefixes()) {
        this.kkKiemKeSelectedPrefixes[p] = false;
      }
    }
    this.showKkMucReportPicker = true;
  }

  closeKkMucReportPicker(): void {
    this.showKkMucReportPicker = false;
    this.kkMucReportQuery = '';
  }

  private kkKiemKeAllPrefixes(): string[] {
    const set = new Set<string>();
    for (const muc of this.kkTypeBoxGroups) {
      const cat = String(muc.category || '').trim().toUpperCase();
      if (/^B\d{3}$/.test(cat)) set.add(cat);
      for (const box of muc.boxes || []) {
        for (const p of this.kkTypeGroupPrefixes(box.groupCodes || [])) {
          if (/^B\d{3}$/.test(p)) set.add(p);
        }
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  }

  get kkKiemKePrefixOptions(): string[] {
    const q = String(this.kkMucReportQuery || '').trim().toUpperCase();
    return this.kkKiemKeAllPrefixes().filter((p) => !q || p.includes(q) || this.kkTypeMucTitle(p).toUpperCase().includes(q));
  }

  get kkKiemKeSelectedCount(): number {
    return Object.keys(this.kkKiemKeSelectedPrefixes).filter((k) => this.kkKiemKeSelectedPrefixes[k]).length;
  }

  toggleKkKiemKePrefix(prefix: string, on: boolean): void {
    this.kkKiemKeSelectedPrefixes = { ...this.kkKiemKeSelectedPrefixes, [prefix]: !!on };
  }

  selectAllKkKiemKePrefixes(on: boolean): void {
    const next: Record<string, boolean> = { ...this.kkKiemKeSelectedPrefixes };
    for (const p of this.kkKiemKePrefixOptions) next[p] = !!on;
    this.kkKiemKeSelectedPrefixes = next;
  }

  async printKkKiemKePaper(): Promise<void> {
    const prepared = await this.prepareKkKiemKeShelves();
    if (!prepared) return;
    this.closeKkMucReportPicker();
    await this.renderKkKiemKePaper(prepared.shelves, prepared.linkQLabel);
  }

  async downloadKkKiemKeExcel(): Promise<void> {
    const prepared = await this.prepareKkKiemKeShelves();
    if (!prepared) return;
    const rows: Record<string, unknown>[] = [];
    for (const s of prepared.shelves) {
      let stt = 1;
      for (const mam of s.mams) {
        for (const r of mam.rows) {
          rows.push({
            'Đầu mã': s.prefix,
            'Kệ': s.shelf,
            'Mâm': mam.mam,
            'STT': stt++,
            'Mã': r.code,
            'PO': r.po,
            'Tồn vị trí': r.stock,
            'Tồn web': r.webStock ?? '',
            'Tồn LinkQ': r.linkQStock ?? '',
            'VT1': r.locs[0] || '',
            'VT2': r.locs[1] || '',
            'VT3': r.locs[2] || '',
            'VT4': r.locs[3] || '',
            'VT5': r.locs[4] || '',
            'Lưu ý': r.note || ''
          });
        }
      }
    }
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Kiem ke');
    const day = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Giay_kiem_ke_${this.selectedFactory}_${day}.xlsx`);
  }

  private async prepareKkKiemKeShelves(): Promise<{
    shelves: Array<{
      prefix: string;
      shelf: string;
      mams: Array<{
        mam: string;
        rows: Array<{
          code: string;
          po: string;
          stock: number;
          locs: string[];
          webStock: number | null;
          linkQStock: number | null;
          note: string;
          noteWarn: boolean;
        }>;
      }>;
    }>;
    linkQLabel: string;
  } | null> {
    const prefixes = Object.keys(this.kkKiemKeSelectedPrefixes)
      .filter((k) => this.kkKiemKeSelectedPrefixes[k])
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    if (!prefixes.length) {
      appAlert('Tick ít nhất một đầu mã để in giấy kiểm kê.');
      return null;
    }
    this.kkTypePrintBusy = true;
    this.cdr.markForCheck();
    try {
      const shelves: Array<{
        prefix: string;
        shelf: string;
        mams: Array<{
          mam: string;
          rows: Array<{
            code: string;
            po: string;
            stock: number;
            locs: string[];
            webStock: number | null;
            linkQStock: number | null;
            note: string;
            noteWarn: boolean;
          }>;
        }>;
      }> = [];
      for (const prefix of prefixes) {
        const byShelf = this.buildKkKiemKeShelfMap(prefix);
        const shelfIds = Array.from(byShelf.keys()).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
        for (const shelf of shelfIds) {
          const mamMap = byShelf.get(shelf)!;
          const mamIds = Array.from(mamMap.keys()).sort((a, b) => {
            if (a.includes('chưa gán')) return 1;
            if (b.includes('chưa gán')) return -1;
            return a.localeCompare(b, 'en', { numeric: true });
          });
          const mams = mamIds
            .map((mam) => ({
              mam,
              rows: mamMap.get(mam)!.sort((x, y) =>
                x.code.localeCompare(y.code, 'en', { numeric: true })
                || x.po.localeCompare(y.po, 'en', { numeric: true })
              )
            }))
            .filter((m) => m.rows.length);
          if (mams.length) shelves.push({ prefix, shelf, mams });
        }
      }
      if (!shelves.length) {
        appAlert('Các đầu mã đã chọn chưa có vị trí kệ S/R để in.');
        return null;
      }

      const codes = new Set<string>();
      for (const s of shelves) {
        for (const mam of s.mams) {
          for (const r of mam.rows) codes.add(r.code);
        }
      }
      const linkQPack = await this.loadKkKiemKeLinkQPack();
      const webByCode = await this.buildKkKiemKeWebStockByCode(codes);
      for (const s of shelves) {
        for (const mam of s.mams) {
          for (const r of mam.rows) {
            const info = this.kkKiemKeLinkQInfo(r.code, linkQPack.map, webByCode);
            r.webStock = info.web;
            r.linkQStock = info.linkQ;
            r.note = info.note;
            r.noteWarn = info.warn;
          }
        }
      }
      return { shelves, linkQLabel: linkQPack.label };
    } finally {
      this.kkTypePrintBusy = false;
      this.cdr.markForCheck();
    }
  }

  /** shelf → mâm → dòng kiểm kê (theo vị trí thực tế). */
  private buildKkKiemKeShelfMap(prefix: string): Map<
    string,
    Map<string, Array<{
      code: string;
      po: string;
      stock: number;
      locs: string[];
      webStock: number | null;
      linkQStock: number | null;
      note: string;
      noteWarn: boolean;
    }>>
  > {
    type Row = {
      code: string;
      po: string;
      stock: number;
      locs: string[];
      webStock: number | null;
      linkQStock: number | null;
      note: string;
      noteWarn: boolean;
    };
    const byShelf = new Map<string, Map<string, Row[]>>();
    const materials = this.kkKiemKeMaterialsForPrefix(prefix);
    for (const m of materials) {
      const code = String(m.materialCode || '').trim().toUpperCase();
      if (!code) continue;
      const po = String(m.poNumber || '').trim().toUpperCase() || '—';
      const stock = this.calculateCurrentStock(m);
      const locs = this.locationParts(m.location)
        .map((p) => this.displayLocationToken(p))
        .filter((p) => !!p && p !== '-');
      if (!locs.length) continue;
      const shelfSlots: Array<{ shelf: string; mam: string }> = [];
      for (const loc of locs) {
        const parsed = this.kkParseKiemKeMam(loc);
        if (!parsed) continue;
        const dup = shelfSlots.some(
          (s) => s.shelf === parsed.shelf && s.mam.toUpperCase() === parsed.mam.toUpperCase()
        );
        if (!dup) shelfSlots.push(parsed);
      }
      if (!shelfSlots.length) continue;
      // Tồn chỉ gắn với vị trí kệ chính của dòng (vị trí đầu), không lặp số tồn sang vị trí khác.
      const home = shelfSlots[0];
      let mamMap = byShelf.get(home.shelf);
      if (!mamMap) {
        mamMap = new Map();
        byShelf.set(home.shelf, mamMap);
      }
      let rows = mamMap.get(home.mam);
      if (!rows) {
        rows = [];
        mamMap.set(home.mam, rows);
      }
      const ordered = [
        home.mam,
        ...locs.filter((l) => l.toUpperCase() !== home.mam.toUpperCase())
      ].slice(0, 5);
      rows.push({
        code,
        po,
        stock,
        locs: ordered,
        webStock: null,
        linkQStock: null,
        note: '',
        noteWarn: false
      });
    }
    return byShelf;
  }

  /** Tồn web theo mã — đọc inventory-materials (dedupe id), khớp Overview «Theo mã». */
  private async buildKkKiemKeWebStockByCode(codes: Set<string>): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const seen = new Set<string>();
    const add = (m: InventoryMaterial) => {
      const code = this.normalizeTieuHuyCode(m.materialCode);
      if (!code || !codes.has(code)) return;
      if (m.factory && m.factory !== this.selectedFactory) return;
      const id = String(m.id || `${code}|${m.poNumber}|${this.getDisplayIMD(m)}`);
      if (seen.has(id)) return;
      seen.add(id);
      map.set(code, (map.get(code) || 0) + this.calculateCurrentStock(m));
    };
    const fetched = await this.fetchTieuHuyStockByCodes(Array.from(codes));
    fetched.forEach(add);
    this.kkLocMapTypeCache.forEach((list) => (list || []).forEach(add));
    (this.inventoryMaterials || []).forEach(add);
    map.forEach((v, k) => map.set(k, Math.round(v)));
    return map;
  }

  /** Overview: lệch nếu |web − LinkQ| > 1; mã khớp → để trống các cột so sánh. */
  private kkKiemKeLinkQInfo(
    code: string,
    linkQMap: Map<string, number>,
    webByCode: Map<string, number>
  ): { web: number | null; linkQ: number | null; note: string; warn: boolean } {
    const key = this.normalizeTieuHuyCode(code);
    const web = webByCode.has(key) ? Number(webByCode.get(key)) : null;
    // Chưa có LinkQ hoặc không so được → không ghi gì
    if (!key || !linkQMap.has(key)) {
      return { web: null, linkQ: null, note: '', warn: false };
    }
    const linkQ = Number(linkQMap.get(key));
    const webN = web == null ? 0 : web;
    if (!Number.isFinite(linkQ)) {
      return { web: null, linkQ: null, note: '', warn: false };
    }
    const diff = Math.round(webN - linkQ);
    const warn = this.isLinkqDiffBad(diff);
    // Không lệch: vẫn hiện số Tồn LinkQ. Tồn web và lưu ý chỉ khi lệch.
    if (!warn) {
      return { web: null, linkQ, note: '', warn: false };
    }
    const diffTxt = `${diff > 0 ? '+' : ''}${this.formatNumber(diff)}`;
    return {
      web: webN,
      linkQ,
      note: `Lệch ${diffTxt}`,
      warn: true
    };
  }

  private kkKiemKeMaterialsForPrefix(prefix: string): InventoryMaterial[] {
    const p = String(prefix || '').trim().toUpperCase();
    const out: InventoryMaterial[] = [];
    const seen = new Set<string>();
    const push = (m: InventoryMaterial) => {
      const id = String(m.id || `${m.materialCode}|${m.poNumber}|${this.getDisplayIMD(m)}`);
      if (seen.has(id)) return;
      seen.add(id);
      out.push(m);
    };
    for (const box of this.kkTypeBoxesCached || []) {
      if (!this.kkBoxHasBPrefix(box, p)) continue;
      for (const m of this.kkMucReportLinesForBox(box)) push(m);
    }
    // Bổ sung dòng tồn có mã thuộc đầu mã (kể cả chưa map box)
    this.kkLocMapTypeCache.forEach((list) => {
      for (const m of list || []) {
        const code = String(m.materialCode || '').trim().toUpperCase();
        const g = this.kkCatalog.groupCodeFromMaterial(code)
          || this.kkCatalog.normalizeGroupCode(code)
          || code;
        if (!g.startsWith(p)) continue;
        const wh = this.kkWarehouseFromLocation(m.location);
        if (!this.kkMatchesWh3Mode(wh)) continue;
        const zone = this.kkLocMapWarehouseFilter;
        if (zone && wh !== zone) continue;
        push(m);
      }
    });
    return out;
  }

  /** S01-1-1 → shelf S01, mam S01-1-1; S01 trần → mâm «chưa gán». */
  private kkParseKiemKeMam(token: string): { shelf: string; mam: string } | null {
    const raw = String(token || '').trim().toUpperCase().replace(/\s+/g, '');
    const bare = (this.stripDoiKhoWhPrefix(raw) || raw).toUpperCase();
    const full = /^([SR])(\d{1,2})-(\d+)-(\d+)$/.exec(bare);
    if (full) {
      const shelf = `${full[1]}${String(Number(full[2])).padStart(2, '0')}`;
      return { shelf, mam: `${shelf}-${Number(full[3])}-${Number(full[4])}` };
    }
    const aisle = /^([SR])(\d{1,2})$/.exec(bare);
    if (aisle) {
      const shelf = `${aisle[1]}${String(Number(aisle[2])).padStart(2, '0')}`;
      return { shelf, mam: `${shelf} (chưa gán mâm)` };
    }
    const aisleSeq = /^([SR])(\d{1,2})-(\d+)$/.exec(bare);
    if (aisleSeq) {
      const shelf = `${aisleSeq[1]}${String(Number(aisleSeq[2])).padStart(2, '0')}`;
      return { shelf, mam: `${shelf}-${Number(aisleSeq[3])}` };
    }
    return null;
  }

  private async renderKkKiemKePaper(
    shelves: Array<{
      prefix: string;
      shelf: string;
      mams: Array<{
        mam: string;
        rows: Array<{
          code: string;
          po: string;
          stock: number;
          locs: string[];
          webStock: number | null;
          linkQStock: number | null;
          note: string;
          noteWarn: boolean;
        }>;
      }>;
    }>,
    linkQLabel = ''
  ): Promise<void> {
    const win = window.open('', '_blank', 'width=980,height=900');
    if (!win) {
      appAlert('Trình duyệt chặn popup. Vui lòng cho phép popup để in.');
      return;
    }
    const esc = (s: string) => this.escapeHtmlForPrint(s);
    const now = new Date().toLocaleString('vi-VN');
    const QRCode = await import('qrcode') as any;
    const qrByShelf = new Map<string, string>();
    const shelvesNeedQr = Array.from(new Set(shelves.map((s) => s.shelf)));
    await Promise.all(
      shelvesNeedQr.map(async (key) => {
        try {
          qrByShelf.set(
            key,
            await QRCode.toDataURL(key, {
              width: 220,
              margin: 0,
              color: { dark: '#000000', light: '#FFFFFF' }
            })
          );
        } catch {
          qrByShelf.set(key, '');
        }
      })
    );

    const locCells = (locs: string[]) => {
      const cells: string[] = [];
      for (let i = 0; i < 5; i++) {
        cells.push(`<td class="loc">${esc(locs[i] || '')}</td>`);
      }
      return cells.join('');
    };

    const pagesHtml = shelves.map((s, pageIdx) => {
      let stt = 1;
      const mamHtml = s.mams.map((mam) => {
        const body = mam.rows.map((r) => {
          const n = stt++;
          const noteCls = r.noteWarn ? ' note--warn' : '';
          const webTxt = r.webStock == null ? '' : this.formatNumber(r.webStock);
          const lqTxt = r.linkQStock == null ? '' : this.formatNumber(r.linkQStock);
          return `<tr>
            <td class="c">${n}</td>
            <td class="code">${esc(r.code)}</td>
            <td class="po">${esc(r.po)}</td>
            <td class="c stock">
              <span class="stock-old">${esc(this.formatNumber(r.stock))}</span>
              <span class="stock-new" title="Ghi tồn mới"></span>
            </td>
            <td class="c num">${esc(webTxt)}</td>
            <td class="c num">${esc(lqTxt)}</td>
            ${locCells(r.locs)}
            <td class="tick"></td>
            <td class="tick"></td>
            <td class="note${noteCls}">${esc(r.note || '')}</td>
          </tr>`;
        }).join('');
        return `<section class="mam">
          <div class="mam-head">
            <h3>Mâm ${esc(mam.mam)}</h3>
            <span>${mam.rows.length} dòng</span>
          </div>
          <table>
            <thead>
              <tr>
                <th class="c" rowspan="2">STT</th>
                <th rowspan="2">Mã</th>
                <th rowspan="2">PO</th>
                <th class="c" rowspan="2">Tồn vị trí<br><small>Ghi số mới nếu tồn sai</small></th>
                <th class="c" rowspan="2">Tồn web<br><small>theo mã</small></th>
                <th class="c" rowspan="2">Tồn LinkQ</th>
                <th class="c" colspan="5">Vị trí (tối đa 5)</th>
                <th class="c" colspan="2">Kiểm</th>
                <th rowspan="2">Lưu ý</th>
              </tr>
              <tr>
                <th class="c">VT1</th><th class="c">VT2</th><th class="c">VT3</th><th class="c">VT4</th><th class="c">VT5</th>
                <th class="c">Đủ</th><th class="c">Thiếu</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </section>`;
      }).join('');

      const shelfQr = qrByShelf.get(s.shelf) || '';
      return `<article class="shelf-page"${pageIdx ? ' style="page-break-before:always"' : ''}>
        <header class="sheet-head">
          <div class="sheet-meta">
            <h1>GIẤY KIỂM KÊ — ${esc(s.prefix)} · Kệ ${esc(s.shelf)}</h1>
            <p>Nhà máy <strong>${esc(this.selectedFactory)}</strong>
              &nbsp;|&nbsp; Đầu mã <strong>${esc(s.prefix)}</strong>
              &nbsp;|&nbsp; Kệ <strong>${esc(s.shelf)}</strong>
              &nbsp;|&nbsp; In: ${esc(now)}</p>
            <p class="hint">LinkQ: <strong>${esc(linkQLabel || '—')}</strong>. Tồn LinkQ luôn hiện. Tồn web và Lưu ý chỉ khi lệch. Ghi số mới vào cột Tồn vị trí nếu sai.</p>
            <div class="nv-box">
              <div class="nv-row"><span>Mã nhân viên</span><b></b></div>
              <div class="nv-row"><span>Họ và tên</span><b></b></div>
            </div>
          </div>
          <div class="sheet-qr">
            ${shelfQr ? `<img src="${shelfQr}" alt="QR ${esc(s.shelf)}">` : ''}
            <div class="sheet-qr-lab">${esc(s.shelf)}</div>
          </div>
        </header>
        ${mamHtml}
      </article>`;
    }).join('');

    win.document.open();
    win.document.write(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Giấy kiểm kê</title>
  <style>
    @page { size: A4 landscape; margin: 7mm 7mm 9mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 9px; color: #000; background: #fff; }
    .no-print { background:#ecfdf5; border:1px solid #34d399; padding:8px 14px; margin-bottom:12px;
                border-radius:4px; display:flex; justify-content:space-between; align-items:center; gap:8px; }
    .no-print button { background:#0f172a; color:#fff; border:none; padding:7px 18px;
                       border-radius:4px; cursor:pointer; font-size:12px; }
    .shelf-page { break-inside: avoid-page; }
    .sheet-head { display:flex; gap:12px; align-items:stretch; border:1.5px solid #000;
                  padding:8px 10px; margin-bottom:10px; }
    .sheet-meta { flex:1; min-width:0; }
    .sheet-meta h1 { font-size:14px; letter-spacing:.3px; margin-bottom:4px; }
    .sheet-meta p { font-size:9px; color:#222; margin-bottom:5px; }
    .sheet-meta .hint { font-size:8px; color:#444; font-style:italic; margin-bottom:8px; }
    .nv-box { border:1px solid #000; padding:6px 8px; display:grid; gap:6px; max-width:420px; }
    .nv-row { display:grid; grid-template-columns:110px 1fr; gap:8px; align-items:end; min-height:20px; }
    .nv-row span { font-size:9px; font-weight:700; }
    .nv-row b { border-bottom:1px solid #000; min-height:14px; display:block; }
    .sheet-qr { width:84px; text-align:center; flex-shrink:0; }
    .sheet-qr img { width:72px; height:72px; display:block; margin:0 auto 4px; }
    .sheet-qr-lab { font-size:11px; font-weight:800; letter-spacing:.4px; }
    .mam { margin-bottom:8px; page-break-inside: avoid; }
    .mam-head { display:flex; align-items:baseline; gap:8px;
               border-bottom:1px solid #000; padding:2px 0 4px; margin-bottom:4px; }
    .mam-head h3 { font-size:11px; }
    .mam-head span { font-size:8px; color:#444; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; }
    thead { display: table-header-group; }
    th, td { border:1px solid #333; padding:2px 3px; vertical-align:middle; }
    th { background:#f3f4f6; font-size:8px; text-transform:uppercase; }
    th small { font-size:6px; text-transform:none; font-weight:600; }
    td.c, th.c { text-align:center; }
    td.code { font-weight:700; font-size:9px; word-break:break-all; }
    td.po { font-size:8px; word-break:break-all; }
    td.stock { white-space:nowrap; }
    td.num { font-variant-numeric:tabular-nums; font-size:8px; }
    .stock-old { display:inline-block; min-width:2em; font-variant-numeric:tabular-nums; }
    .stock-new { display:inline-block; border-bottom:1px solid #000; min-width:2.4em; min-height:10px;
                 margin-left:3px; vertical-align:bottom; }
    td.loc { font-size:7px; text-align:center; word-break:break-all; }
    td.tick { width:22px; height:16px; }
    td.note { font-size:7px; font-weight:700; color:#333; word-break:break-word; }
    td.note--warn { color:#9a3412; background:#fff7ed; }
    @media print { .no-print { display:none !important; } }
  </style>
</head>
<body>
  <div class="no-print">
    <span>Giấy kiểm kê — QR dãy kệ. LinkQ: ${esc(linkQLabel || '—')}. Nhấn <strong>Ctrl+P</strong>.</span>
    <button onclick="window.print()">In ngay</button>
  </div>
  ${pagesHtml}
</body>
</html>`);
    win.document.close();
    win.focus();
  }

  private kkBoxHasBPrefix
(box: { groupCodes?: string[] }, prefix: string): boolean {
    return this.kkTypeGroupPrefixes(box.groupCodes || []).includes(prefix);
  }

  private kkShelfLabelTrayCount(prefix: string): number {
    return this.kkConnectorAllTrays(prefix).filter((t) => t.from > 0).length;
  }


  get kkShelfLabelGroups(): Array<{
    category: string;
    title: string;
    boxes: typeof this.kkTypeBoxesCached;
    labelCount: number;
  }> {
    const q = String(this.kkShelfLabelQuery || '').trim().toLowerCase();
    const out: Array<{
      category: string;
      title: string;
      boxes: typeof this.kkTypeBoxesCached;
      labelCount: number;
    }> = [];
    let addedB018 = false;
    const b018Group = () => ({
      category: 'B018',
      title: this.kkTypeMucTitle('B018'),
      boxes: [] as typeof this.kkTypeBoxesCached,
      labelCount: this.kkShelfLabelTrayCount('B018')
    });
    for (const muc of this.kkTypeBoxGroups) {
      const category = String(muc.category || '');
      if (this.isKkConnectorRackMuc(category)) {
        if (category === 'B018') addedB018 = true;
        out.push({
          category,
          title: muc.title,
          boxes: muc.boxes,
          labelCount: this.kkShelfLabelTrayCount(category)
        });
        continue;
      }
      if (category === 'ĐẦU CỐT') {
        const rest = muc.boxes.filter((box) => !this.kkBoxHasBPrefix(box, 'B018'));
        if (!addedB018 && muc.boxes.some((box) => this.kkBoxHasBPrefix(box, 'B018'))) {
          addedB018 = true;
          out.push(b018Group());
        }
        if (!rest.length) continue;
        out.push({
          category,
          title: muc.title,
          boxes: rest,
          labelCount: rest.filter((box) => !!this.kkShelfLabelLocOf(box)).length
        });
        continue;
      }
      out.push({
        category,
        title: muc.title,
        boxes: muc.boxes,
        labelCount: muc.boxes.filter((box) => !!this.kkShelfLabelLocOf(box)).length
      });
    }
    return out.filter((g) => {
      if (!q) return true;
      return g.title.toLowerCase().includes(q) || String(g.category || '').toLowerCase().includes(q);
    });
  }

  printKkShelfLabelsForGroup(group: {
    category?: string;
    title: string;
    boxes: Array<{ productType: string; groupCodes?: string[] }>;
  }): void {
    const category = String(group?.category || '');
    const rackPrefix = this.isKkConnectorRackMuc(category)
      ? category
      : ((group?.boxes || []).some((box) => this.kkBoxHasBPrefix(box, 'B018')) ? 'B018' : '');
    if (rackPrefix) {
      const labels = this.kkConnectorAllTrays(rackPrefix)
        .filter((t) => t.from > 0)
        .map((t) => ({
          name: this.kkConnectorRangeText(rackPrefix, t.from, t.to),
          loc: t.loc
        }));
      if (!labels.length) {
        appAlert(`Mục ${rackPrefix} chưa có dải mã để in tem kệ.`);
        return;
      }
      this.closeKkShelfLabelPicker();
      void this.printKkShelfLabels(labels, group.title);
      return;
    }
    const boxes = group?.boxes || [];
    const labels = boxes
      .map((box) => ({
        name: this.kkShelfLabelTitle(box),
        loc: this.kkShelfLabelLocOf(box)
      }))
      .filter((row) => !!row.loc)
      .sort((a, b) => a.loc.localeCompare(b.loc, 'en', { numeric: true })
        || a.name.localeCompare(b.name, 'vi', { numeric: true }));
    if (!labels.length) {
      appAlert(`Nhóm ${group?.title || ''} chưa có vị trí yêu cầu để in tem kệ.`);
      return;
    }
    this.closeKkShelfLabelPicker();
    void this.printKkShelfLabels(labels, group.title);
  }

  private kkShelfLabelLocOf(box: {
    productType: string;
    groupCodes?: string[];
    sourceProductType?: string;
    sourceProductTypes?: string[];
  }): string {
    const loc = this.kkTypeBoxHomeLoc(box);
    const shown = this.primaryLocationDisplay(loc);
    return shown && shown !== '-' ? shown : '';
  }

  private kkShelfLabelTitle(box: { productType: string; groupCodes?: string[] }): string {
    const type = String(box?.productType || '').trim();
    const codes = box?.groupCodes || [];
    if (this.isKkDauCotMuc(type, codes)) {
      const brand = String(this.kkTerminalBrandTail(type) || '').replace(/\s+/g, ' ').trim();
      const pretty = this.kkShelfLabelPretty(brand);
      return pretty ? `Terminal ${pretty}` : 'Terminal';
    }
    return this.kkShelfLabelPretty(this.kkTypeNameHeadOf(type) || type) || type;
  }

  private kkShelfLabelPretty(raw: string): string {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (/^[A-Z0-9][A-Z0-9.&/-]{1,10}$/.test(s)) return s;
    const lower = s.toLocaleLowerCase('vi');
    return lower.charAt(0).toLocaleUpperCase('vi') + lower.slice(1);
  }

  /** Tem kệ 57×32mm: tên + vị trí + QR góc phải (nội dung = vị trí để scan). */
  private async printKkShelfLabels(labels: Array<{ name: string; loc: string }>, title: string): Promise<void> {
    if (!labels.length) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      appAlert('❌ Không thể mở cửa sổ in. Vui lòng cho phép popup!');
      return;
    }
    const esc = (s: string) => this.escapeHtmlForPrint(s);
    try {
      const QRCode = await import('qrcode') as any;
      const qrImages = await Promise.all(
        labels.map((row) =>
          QRCode.toDataURL(String(row.loc || '').trim() || '—', {
            width: 360,
            margin: 0,
            color: { dark: '#000000', light: '#FFFFFF' }
          })
        )
      );
      const pages = labels.map((row, i) => {
        const nameSize = row.name.length > 22 ? '12px' : row.name.length > 14 ? '15px' : '17px';
        return `<div class="label">
    <img class="qr" src="${qrImages[i]}" alt="QR ${esc(row.loc)}">
    <div class="text">
      <div class="name" style="font-size:${nameSize}!important">${esc(row.name)}</div>
      <div class="loc">${esc(row.loc)}</div>
    </div>
  </div>`;
      }).join('\n');
      printWindow.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(title)} — tem kệ</title>
<style>
  * { margin:0!important; padding:0!important; box-sizing:border-box!important; }
  body {
    font-family: Arial, sans-serif;
    background: white!important;
    color: #000!important;
  }
  .label {
    position: relative!important;
    display: flex!important;
    flex-direction: row!important;
    align-items: center!important;
    justify-content: flex-start!important;
    width: 57mm!important;
    height: 32mm!important;
    padding: 2mm 22mm 2mm 2.5mm!important;
    border: 1px solid #000!important;
    page-break-after: always!important;
    page-break-inside: avoid!important;
    box-sizing: border-box!important;
    color: #000!important;
    gap: 1.5mm!important;
  }
  .label:last-child { page-break-after: auto!important; }
  .qr {
    position: absolute!important;
    top: 1.5mm!important;
    right: 1.5mm!important;
    width: 20mm!important;
    height: 20mm!important;
    object-fit: contain!important;
  }
  .text {
    flex: 1!important;
    min-width: 0!important;
    display: flex!important;
    flex-direction: column!important;
    justify-content: center!important;
    align-items: flex-start!important;
    text-align: left!important;
    gap: 1mm!important;
    padding-right: 1mm!important;
  }
  .name {
    font-weight: 800!important;
    line-height: 1.15!important;
    word-break: break-word!important;
    max-width: 30mm!important;
  }
  .loc {
    font-size: 18px!important;
    font-weight: 800!important;
    line-height: 1.1!important;
    letter-spacing: 0.3px!important;
  }
  @media print {
    @page { margin:0!important; size: 57mm 32mm!important; padding:0!important; }
    .label { width:57mm!important; height:32mm!important; }
  }
</style></head>
<body>
  ${pages}
  <script>window.onload=function(){setTimeout(function(){window.print();},300);};</script>
</body></html>`);
      printWindow.document.close();
    } catch (e) {
      console.error('❌ printKkShelfLabels QR:', e);
      printWindow.close();
      appAlert('Lỗi tạo QR tem kệ. Vui lòng thử lại.');
    }
  }

  private kkMucReportLinesForBox(box: {
    productType: string;
    sourceProductType?: string;
    sourceProductTypes?: string[];
  }): InventoryMaterial[] {
    const sources = (box.sourceProductTypes && box.sourceProductTypes.length)
      ? box.sourceProductTypes
      : [box.sourceProductType || box.productType];
    const seen = new Set<string>();
    const out: InventoryMaterial[] = [];
    const zone = this.kkLocMapWarehouseFilter;
    for (const src of sources) {
      for (const m of this.kkLocMapTypeCache.get(src) || []) {
        const id = String(m.id || '');
        if (id) {
          if (seen.has(id)) continue;
          seen.add(id);
        }
        const wh = this.kkWarehouseFromLocation(m.location);
        if (!this.kkMatchesWh3Mode(wh)) continue;
        if (zone && wh !== zone) continue;
        out.push(m);
      }
    }
    return out;
  }

  private kkNormalizeSShelfId(token: string): string {
    const raw = String(token || '').trim().toUpperCase().replace(/\s+/g, '');
    const m = /^S0*(\d{1,2})(?:-|$)/.exec(raw);
    if (!m) return '';
    const n = Number(m[1]);
    if (n < 1 || n > 25) return '';
    return `S${String(n).padStart(2, '0')}`;
  }

  private kkSLevelFromLoc(token: string): number {
    const raw = String(token || '').trim().toUpperCase().replace(/\s+/g, '');
    const m = /^S\d{1,2}-\d+-(\d+)/.exec(raw);
    return m ? Number(m[1]) : 0;
  }

  private kkSPrefixOfCode(code: string): string {
    const g = this.kkCatalog.normalizeGroupCode(code)
      || String(code || '').trim().toUpperCase();
    const m = /^(B\d{3})/.exec(g);
    return m ? m[1] : '';
  }

  private kkSShelfKind(n: number): 'empty' | 'B018' | 'B009' | 'B016' | 'B007' | 'B008' | 'B017' | 'home' {
    if (n === 2 || n === 4 || n === 6) return 'empty';
    if (n === 1 || n === 3 || n === 5) return 'B018';
    if (n >= 7 && n <= 10) return 'B009';
    if (n >= 11 && n <= 14) return 'B016';
    if (n === 15) return 'B007';
    if (n === 16) return 'B008';
    if (n >= 23 && n <= 25) return 'home';
    return 'home';
  }

  private kkSHomeLocRecords(): Array<{
    code: string;
    typeName: string;
    prefix: string;
    terminal: boolean;
    shelf: string;
    loc: string;
    level: number;
  }> {
    const out: Array<{
      code: string;
      typeName: string;
      prefix: string;
      terminal: boolean;
      shelf: string;
      loc: string;
      level: number;
    }> = [];
    const seen = new Set<string>();
    for (const e of this.kkCatalogEntries) {
      const code = this.kkCatalog.normalizeGroupCode(e.groupCode)
        || String(e.groupCode || '').trim().toUpperCase();
      if (!code) continue;
      const locJoined = String(
        this.kkCatalog.homeLocForMaterial(code) || this.kkTypeHomeLocOf(e.productType) || ''
      ).trim();
      const tokens = splitMultiLocations(locJoined);
      const terminal = this.isKkDauCotMuc(e.productType, [code]);
      const prefix = this.kkSPrefixOfCode(code);
      if (!tokens.length) {
        const key = `${code}|`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ code, typeName: e.productType, prefix, terminal, shelf: '', loc: '', level: 0 });
        continue;
      }
      for (const token of tokens) {
        const shelf = this.kkNormalizeSShelfId(token);
        const key = `${code}|${shelf}|${token}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          code,
          typeName: e.productType,
          prefix,
          terminal,
          shelf,
          loc: String(token || '').toUpperCase(),
          level: this.kkSLevelFromLoc(token)
        });
      }
    }
    return out;
  }

  private kkCodesRangeSummary(codes: string[]): { group: string; range: string } {
    const byPrefix = new Map<string, { min: number; max: number }>();
    const extra: string[] = [];
    for (const raw of codes) {
      const code = this.kkCatalog.normalizeGroupCode(raw)
        || String(raw || '').trim().toUpperCase();
      if (!code) continue;
      const prefix = this.kkSPrefixOfCode(code);
      const n = prefix ? this.kkConnectorSeqOf(prefix, code) : null;
      if (prefix && n != null) {
        const cur = byPrefix.get(prefix);
        if (!cur) byPrefix.set(prefix, { min: n, max: n });
        else {
          cur.min = Math.min(cur.min, n);
          cur.max = Math.max(cur.max, n);
        }
        continue;
      }
      extra.push(code);
    }
    const prefixes = Array.from(byPrefix.keys()).sort((a, b) => a.localeCompare(b, 'en'));
    const ranges = prefixes.map((p) => {
      const r = byPrefix.get(p)!;
      return this.kkConnectorRangeText(p, r.min, r.max);
    });
    const uniqExtra = Array.from(new Set(extra)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const group = [...prefixes, ...uniqExtra.map((c) => this.kkSPrefixOfCode(c) || c)]
      .filter(Boolean)
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .join(', ');
    const range = [...ranges, ...uniqExtra].join(', ');
    return { group: group || '—', range: range || '—' };
  }

  private kkRHomeCodesByShelf(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const e of this.kkCatalogEntries) {
      const code = this.kkCatalog.normalizeGroupCode(e.groupCode)
        || String(e.groupCode || '').trim().toUpperCase();
      if (!code) continue;
      const locJoined = String(
        this.kkCatalog.homeLocForMaterial(code) || this.kkTypeHomeLocOf(e.productType) || ''
      ).trim();
      for (const token of splitMultiLocations(locJoined)) {
        const p = parseJRackLocation(token);
        if (!p?.rack) continue;
        const shelf = formatJRackAisle(p.rack);
        const list = map.get(shelf) || [];
        if (!list.includes(code)) list.push(code);
        map.set(shelf, list);
      }
    }
    return map;
  }

  /** Danh sách kệ S01–S25 và kệ R — chỉ kệ + nhóm mã / khoảng mã. */
  printKkSShelfMap(): void {
    const win = window.open('', '_blank', 'width=980,height=860');
    if (!win) {
      appAlert('Trình duyệt chặn popup. Vui lòng cho phép popup để in.');
      return;
    }
    const esc = (s: string) => this.escapeHtmlForPrint(s);
    const now = new Date().toLocaleString('vi-VN');
    const sHome = new Map<string, string[]>();
    for (const rec of this.kkSHomeLocRecords()) {
      if (!rec.shelf) continue;
      const list = sHome.get(rec.shelf) || [];
      if (!list.includes(rec.code)) list.push(rec.code);
      sHome.set(rec.shelf, list);
    }
    const plannedKind = (kind: string): kind is 'B018' | 'B009' | 'B016' | 'B017' =>
      kind === 'B018' || kind === 'B009' || kind === 'B016' || kind === 'B017';

    const sRows = Array.from({ length: 25 }, (_, i) => {
      const n = i + 1;
      const shelf = `S${String(n).padStart(2, '0')}`;
      const kind = this.kkSShelfKind(n);
      if (kind === 'empty') return { shelf, group: '—', range: 'Trống', empty: true };
      if (plannedKind(kind)) {
        const planned = this.kkConnectorRackShelves(kind).find((row) => row.shelf === shelf);
        if (planned) {
          return {
            shelf,
            group: kind,
            range: this.kkConnectorRangeText(kind, planned.from, planned.to),
            empty: false
          };
        }
      }
      const sum = this.kkCodesRangeSummary(sHome.get(shelf) || []);
      if (kind === 'B007' || kind === 'B008') {
        return {
          shelf,
          group: kind,
          range: sum.range === '—' ? kind : sum.range,
          empty: sum.range === '—'
        };
      }
      return { shelf, group: sum.group, range: sum.range, empty: sum.range === '—' };
    });

    const rHome = this.kkRHomeCodesByShelf();
    let rMax = 28;
    for (const key of rHome.keys()) {
      const n = Number(String(key).replace(/^R0*/, '')) || 0;
      if (n > rMax) rMax = n;
    }
    const rRows = Array.from({ length: rMax }, (_, i) => {
      const shelf = formatJRackAisle(i + 1);
      const sum = this.kkCodesRangeSummary(rHome.get(shelf) || []);
      return { shelf, group: sum.group, range: sum.range, empty: sum.range === '—' };
    });

    const tableRows = (rows: Array<{ shelf: string; group: string; range: string; empty: boolean }>) =>
      rows.map((s) => `<tr class="${s.empty ? 'empty' : ''}">
        <td class="c"><strong>${esc(s.shelf)}</strong></td>
        <td class="c">${esc(s.group)}</td>
        <td>${esc(s.range)}</td>
      </tr>`).join('');

    win.document.open();
    win.document.write(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Sơ đồ kệ S và R</title>
  <style>
    @page { size: A4 portrait; margin: 10mm 10mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #111; background: #fff; }
    .no-print { background:#fffbe6; border:1px solid #e6c000; padding:8px 14px; margin-bottom:12px;
                border-radius:4px; display:flex; justify-content:space-between; align-items:center; }
    .no-print button { background:#0f172a; color:#fff; border:none; padding:7px 18px;
                       border-radius:4px; cursor:pointer; font-size:12px; }
    h1 { font-size: 20px; margin-bottom: 6px; }
    h2 { font-size: 14px; margin: 16px 0 8px; }
    .sub { color:#475569; margin-bottom: 12px; }
    table.index { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    table.index th, table.index td { border: 1px solid #111; padding: 6px 8px; }
    table.index th { background: #0f172a; color: #fff; text-align: left; }
    table.index td.c, table.index th.c { text-align: center; }
    table.index tr.empty td { color: #64748b; background: #f8fafc; }
    .foot { margin-top: 10px; font-size: 10px; color: #64748b; text-align: right; }
    @media print { .no-print { display: none !important; } }
  </style>
</head>
<body>
  <div class="no-print">
    <span>Danh sách kệ S và R — nhấn <strong>Ctrl+P</strong> hoặc bấm nút để in</span>
    <button onclick="window.print()">In ngay</button>
  </div>
  <h1>HÌNH SƠ ĐỒ KỆ S &amp; R</h1>
  <p class="sub">Chỉ kệ và nhóm mã / khoảng mã. S01–S25 · R01–R${String(rMax).padStart(2, '0')}</p>
  <h2>Kệ S</h2>
  <table class="index">
    <thead>
      <tr>
        <th class="c">Kệ</th>
        <th class="c">Nhóm mã</th>
        <th>Khoảng mã</th>
      </tr>
    </thead>
    <tbody>${tableRows(sRows)}</tbody>
  </table>
  <h2>Kệ R</h2>
  <table class="index">
    <thead>
      <tr>
        <th class="c">Kệ</th>
        <th class="c">Nhóm mã</th>
        <th>Khoảng mã</th>
      </tr>
    </thead>
    <tbody>${tableRows(rRows)}</tbody>
  </table>
  <div class="foot">In lúc: ${esc(now)} · ${esc(this.selectedFactory)}</div>
</body>
</html>`);
    win.document.close();
    win.focus();
  }

  openKkTypeHomeLocPicker(box: { productType: string; groupCodes?: string[] }, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    const productType = String(box?.productType || '').trim();
    if (!productType) return;
    this.layoutLocTypeAssign = productType;
    this.layoutLocTypeAssignGroups = box.groupCodes || [];
    this.layoutLocMaterial = null;
    this.layoutLocFocus = 'location';
    this.layoutLocWh = 'J';
    const existing = this.kkTypeHomeLocOf(productType);
    const tokens = this.layoutLocNormalizeTokens(splitMultiLocations(existing));
    this.layoutLocSelected = new Set(tokens);
    const groups = getLayoutLocationGroups('J');
    const hit = this.layoutLocGroupFromTokens(tokens);
    const prefixes = this.kkTypeGroupPrefixes(this.layoutLocTypeAssignGroups);
    const bPrefix = prefixes.find((p) => /^B\d{3}$/.test(p)) || '';
    const suggestedS = jKhoMatSFirstRowForPrefix(bPrefix);
    if (hit) {
      this.layoutLocGroupId = hit.id;
      this.layoutLocFamily = /^S\d{2}$/.test(hit.id) ? 'S' : 'R';
    } else if (suggestedS) {
      this.layoutLocGroupId = suggestedS;
      this.layoutLocFamily = 'S';
    } else {
      this.layoutLocGroupId = groups[0]?.id || '';
      this.layoutLocFamily = 'R';
    }
    this.layoutLocQuery = '';
    this.layoutLocManualDraft = '';
    this.layoutLocPalletDraft = '';
    this.syncLayoutJFocusBlockFromSelection();
    this.showLayoutLocPicker = true;
    this.cdr.detectChanges();
  }

  backKkTypeBoxes(): void {
    this.kkThMode = false;
    this.kkWeekMode = false;
    this.kkMucAllDetail = null;
    this.kkTypeInnerQuery = '';
    this.kkActiveProductType = null;
    this.kkActiveTypeDraft = null;
    this.kkActivePinSplit = null;
    this.kkActiveSourceProductType = null;
    this.kkConnectorFloorDetail = null;
    this.kkAllStockDetail = false;
    this.kkTypePage = 1;
    this.kkTypeDetailQuery = '';
    this.kkTypeSearchDraft = '';
    this.kkTypeFilterLoc = '';
    this.kkTypeFilterWh = '';
    this.kkTypeFilterRolls = '';
    this.kkTypeSortQtyDesc = false;
    this.kkTypeSortRollsDesc = false;
    this.kkTypeSortKkTimeDesc = false;
    this.kkTypeShowExtraFilter = false;
    this.clearKkLocScanDay();
    this.syncKkPageLock();
    // Quay lại đúng chỗ đang xem trong mục, không phải kéo tìm lại
    const top = this.kkTypeListScrollTop;
    setTimeout(() => {
      const el = this.kkPageBodyEl();
      if (el) el.scrollTop = top;
    }, 0);
  }

  get kkTypeLocationOptions(): string[] {
    const set = new Set<string>();
    for (const m of this.kkTypeDetailAll) {
      const loc = String(m.location || '').trim().toUpperCase();
      if (loc) set.add(loc);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  }

  get kkTypeRollsOptions(): string[] {
    const set = new Set<string>();
    for (const m of this.kkTypeDetailAll) {
      const t = this.getKkRollsText(m);
      if (t && t !== '—') set.add(t);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  }

  get kkSearchReady(): boolean {
    return !!this.kkEffectiveSearchQuery();
  }

  onKkLocMapQueryChange(value: string): void {
    if (this.kkLocMapView === 'manager') {
      this.kkLocMapQuery = String(value || '');
      this.kkManagerRowsSig = '';
      this.cdr.detectChanges();
      return;
    }
    this.kkLocMapQuery = String(value || '').toUpperCase();
    const q = this.kkEffectiveSearchQuery();
    if (!q) {
      if (this.kkLocMapView === 'type') {
        this.kkTypeSearchDraft = '';
        this.kkTypeDetailQuery = '';
        this.kkTypePage = 1;
        this.invalidateKkTypeViewCache();
      }
      return;
    }
    if (!this.kkStockLoaded && !this.kkLocMapLoading && !this.kkLocMapBusy) {
      this.playKkStock();
      return;
    }
    if (this.kkLocMapView === 'type') this.onKkTypeUnifiedSearch();
  }

  clearKkTypeUnifiedSearch(): void {
    this.kkLocMapQuery = '';
    this.onKkTypeUnifiedSearch();
  }

  clearKkTypeFilters(): void {
    this.kkTypeFilterLoc = '';
    this.kkTypeFilterWh = '';
    this.kkTypeFilterRolls = '';
    this.kkTypeSortQtyDesc = false;
    this.kkTypeSortRollsDesc = false;
    this.kkTypeSortKkTimeDesc = false;
    this.kkTypeDetailQuery = '';
    this.kkTypeSearchDraft = '';
    this.clearKkLocScanDay();
    this.kkTypePage = 1;
  }

  setKkLocScanDay(day: 'today' | 'yesterday'): void {
    if (this.kkLocScanDay === day) {
      this.clearKkLocScanDay();
      this.kkTypePage = 1;
      this.invalidateKkTypeViewCache();
      return;
    }
    this.kkLocScanDay = day;
    this.kkLocScanReady = false;
    this.kkLocScanIds = new Set();
    this.kkTypePage = 1;
    this.invalidateKkTypeViewCache();
    void this.loadKkLocScanIds(day);
  }

  private clearKkLocScanDay(): void {
    this.kkLocScanDay = '';
    this.kkLocScanLoading = false;
    this.kkLocScanReady = false;
    this.kkLocScanIds = new Set();
    this.kkLocScanReq++;
  }

  /** Mã có lịch sử scan vị trí (kk-location-scan) trong ngày. */
  private async loadKkLocScanIds(day: 'today' | 'yesterday'): Promise<void> {
    const req = ++this.kkLocScanReq;
    this.kkLocScanLoading = true;
    const { start, end } = this.kkLocScanRange(day);
    const factory = String(this.selectedFactory || '').trim().toUpperCase();
    try {
      const snap = await this.firestore.firestore
        .collection('material-location-history')
        .where('changedAt', '>=', start)
        .where('changedAt', '<', end)
        .get();
      if (req !== this.kkLocScanReq || this.kkLocScanDay !== day) return;
      const ids = new Set<string>();
      snap.forEach((doc) => {
        const data = doc.data() as {
          changeType?: string;
          materialId?: string;
          factory?: string;
        };
        if (String(data.changeType || '') !== 'kk-location-scan') return;
        const rowFactory = String(data.factory || '').trim().toUpperCase();
        if (factory && rowFactory && rowFactory !== factory) return;
        const id = String(data.materialId || '').trim();
        if (id) ids.add(id);
      });
      this.kkLocScanIds = ids;
      this.kkLocScanReady = true;
    } catch (err) {
      console.error('loadKkLocScanIds', err);
      if (req !== this.kkLocScanReq) return;
      this.kkLocScanIds = new Set();
      this.kkLocScanReady = true;
      appAlert('Không lọc được mã scan vị trí. Vui lòng thử lại.');
    } finally {
      if (req === this.kkLocScanReq) {
        this.kkLocScanLoading = false;
        this.invalidateKkTypeViewCache();
        this.cdr.detectChanges();
      }
    }
  }

  protected override onKkTypeSortChanged(): void {
    this.kkTypePage = 1;
  }

  toggleKkTypeSortQty(): void {
    this.kkTypeSortQtyDesc = !this.kkTypeSortQtyDesc;
    if (this.kkTypeSortQtyDesc) {
      this.kkTypeSortKkTimeDesc = false;
      this.kkTypeSortRollsDesc = false;
    }
    this.kkTypePage = 1;
  }

  /** Mã / dòng nhiều cuộn nhất lên đầu (cột Cuộn). */
  toggleKkTypeSortRolls(): void {
    this.kkTypeSortRollsDesc = !this.kkTypeSortRollsDesc;
    if (this.kkTypeSortRollsDesc) {
      this.kkTypeSortQtyDesc = false;
      this.kkTypeSortKkTimeDesc = false;
    }
    this.kkTypePage = 1;
  }

  toggleKkTypeSortKkTime(): void {
    this.kkTypeSortKkTimeDesc = !this.kkTypeSortKkTimeDesc;
    if (this.kkTypeSortKkTimeDesc) {
      this.kkTypeSortQtyDesc = false;
      this.kkTypeSortRollsDesc = false;
    }
    this.kkTypePage = 1;
    this.kkTypeDetailSig = '';
  }

  onKkTypeFilterChange(): void {
    this.kkTypePage = 1;
  }

  onKkTypePageSizeChange(size: number): void {
    const n = Number(size) || 0;
    this.kkTypePageAuto = !n;
    this.kkTypePage = 1;
    if (n) this.kkTypePageSize = n;
    else this.fitKkTypePageSize();
  }

  get kkTypeShowingFrom(): number {
    if (!this.kkTypeDetailFiltered.length) return 0;
    return (this.kkTypePage - 1) * this.kkTypePageSize + 1;
  }

  get kkTypeShowingTo(): number {
    return Math.min(this.kkTypePage * this.kkTypePageSize, this.kkTypeDetailFiltered.length);
  }

  get kkTypeVisiblePages(): Array<number | 'ellipsis'> {
    const total = this.kkTypeDetailTotalPages;
    const current = Math.min(Math.max(1, this.kkTypePage), total);
    if (total <= 7) {
      return Array.from({ length: Math.max(total, 1) }, (_, i) => i + 1);
    }
    if (current <= 4) {
      return [1, 2, 3, 4, 5, 'ellipsis', total];
    }
    if (current >= total - 3) {
      return [1, 'ellipsis', total - 4, total - 3, total - 2, total - 1, total];
    }
    return [1, 'ellipsis', current - 1, current, current + 1, 'ellipsis', total];
  }

  kkTypeGoToVisiblePage(page: number | 'ellipsis'): void {
    if (page === 'ellipsis') return;
    this.kkTypeGoToPage(page);
  }

  onKkTypeDetailQueryChange(): void {
    this.kkTypePage = 1;
  }

  /** Số bộ lọc đang bật (hiện trên nút Lọc). */
  get kkTypeActiveFilterCount(): number {
    return [this.kkTypeWarnFilter, this.kkTypeLinkQFilter, this.kkTypeCodeToneFilter, this.kkTypeKkFilter, this.kkTypeDiffFilter, this.kkTypeFilterLoc, this.kkTypeFilterRolls, this.kkLocScanDay,
      this.kkTypeSortQtyDesc ? 1 : '', this.kkTypeSortRollsDesc ? 1 : '', this.kkTypeSortKkTimeDesc ? 1 : ''].filter((v) => !!v).length;
  }

  onKkTypeWarnFilterChange(): void {
    if (this.kkTypeLinkQFilter || this.kkTypeDiffFilter) void this.ensureKkTypeLinkQ();
    this.kkTypePage = 1;
    this.kkByCodeOpen = null;
  }

  get kkTypeWarnFilterLabel(): string {
    return this.kkWarningOptions.find((o) => o.value === this.kkTypeWarnFilter)?.label || '';
  }

  /** Xóa toàn bộ 1 loại cảnh báo (cả nhà máy) — cần mã Zalo 4 số gửi ASP0106. */
  requestClearKkWarning(): void {
    const value = this.kkTypeWarnFilter;
    if (!value || value === 'any' || !this.canEdit) return;
    this.kkWarnClearPending = value;
    this.pendingMaterialsOtpAction = 'clear-kk-warning';
    this.materialsOtpActionLabel = `Xóa toàn bộ cảnh báo "${this.kkTypeWarnFilterLabel}" — ${this.selectedFactory}`;
    this.openMaterialsOtpModal();
  }

  onKkTypeInnerQueryChange(): void {
    this.kkTypePage = 1;
    this.kkByCodeOpen = null;
  }

  onKkFilterUncheckedChange(): void {
    this.kkTypePage = 1;
    this.cdr.detectChanges();
  }

  kkTypeRowIndex(indexOnPage: number): number {
    const page = Math.min(Math.max(1, this.kkTypePage), this.kkTypeDetailTotalPages);
    return (page - 1) * this.kkTypePageSize + indexOnPage + 1;
  }

  kkTypeGoToPage(page: number): void {
    const max = this.kkTypeDetailTotalPages;
    if (page < 1 || page > max) return;
    this.kkTypePage = page;
    setTimeout(() => void this.ensureKkTypeMaterialNames(), 0);
  }

  kkTypePrevPage(): void {
    this.kkTypeGoToPage(this.kkTypePage - 1);
  }

  kkTypeNextPage(): void {
    this.kkTypeGoToPage(this.kkTypePage + 1);
  }

  isKkMaterialExpanded(row: KkLocMaterialRow): boolean {
    return this.kkLocMapExpandedKey === this.kkMaterialRowKey(row);
  }

  kkMaterialDetailLines(row: KkLocMaterialRow): InventoryMaterial[] {
    const list = this.kkLocMapMaterialCache.get(this.kkMaterialRowKey(row)) || [];
    return list
      .filter((m) => this.calculateCurrentStock(m) > 0)
      .sort((a, b) => {
        const po = String(a.poNumber || '').localeCompare(String(b.poNumber || ''), 'en', { numeric: true });
        if (po) return po;
        return this.getDisplayIMD(a).localeCompare(this.getDisplayIMD(b), 'en', { numeric: true });
      });
  }

  private kkLinesForRow(row: KkLocMaterialRow): InventoryMaterial[] {
    return (this.kkLocMapMaterialCache.get(this.kkMaterialRowKey(row)) || []).filter((m) => !!m.id);
  }

  private kkLinesForMaterialCode(materialCode: string): InventoryMaterial[] {
    const code = String(materialCode || '').trim().toUpperCase();
    const rows: InventoryMaterial[] = [];
    this.kkLocMapMaterialCache.forEach((list, key) => {
      if (key.endsWith(`|${code}`)) {
        rows.push(...list);
      }
    });
    return rows;
  }

  private syncKkMaterialRows(materialCode: string): void {
    const code = String(materialCode || '').trim().toUpperCase();
    this.kkLocMapByMaterial = this.kkLocMapByMaterial.map((row) => {
      if (row.materialCode !== code) return row;
      const key = `${row.warehouse}|${code}`;
      const list = this.kkLocMapMaterialCache.get(key) || [];
      const checked = list.filter((m) => this.isKkFlagOn(m.kkChecked)).length;
      return {
        ...row,
        checked,
        remaining: Math.max(0, row.totalLines - checked)
      };
    });
  }

  /** Tick KK theo mã hàng — ghi tất cả dòng cùng mã (mọi kho trong factory đang xem). */
  async onKkByMaterialTick(row: KkLocMaterialRow, checked: boolean): Promise<void> {
    if (!this.canEdit || this.kkLocMapBusy || this.denyAction('kkTick')) {
      this.cdr.detectChanges();
      return;
    }
    const next = !!checked;
    const lines = this.kkLinesForMaterialCode(row.materialCode).filter((m) => !!m.id);
    const targets = lines.filter((m) => this.isKkFlagOn(m.kkChecked) !== next);
    if (!targets.length) {
      this.syncKkMaterialRows(row.materialCode);
      this.cdr.detectChanges();
      return;
    }
    if (!next) {
      const ok = confirm(`Bỏ tick KK mọi dòng mã ${row.materialCode}?\n(${targets.length} dòng)`);
      if (!ok) {
        this.cdr.detectChanges();
        return;
      }
    }
    const operator = next
      ? await this.resolveKkOperatorId()
      : await this.resolveKkOperatorFromSession();
    if (!operator) {
      this.cdr.detectChanges();
      return;
    }

    this.kkLocMapBusy = true;
    this.cdr.detectChanges();
    const kkAt = new Date();
    try {
      const chunkSize = 400;
      for (let i = 0; i < targets.length; i += chunkSize) {
        const chunk = targets.slice(i, i + chunkSize);
        const batch = this.firestore.firestore.batch();
        for (const m of chunk) {
          batch.update(this.firestore.collection('inventory-materials').doc(m.id!).ref, {
            kkChecked: next,
            kkBy: operator,
            kkAt,
            updatedAt: new Date(),
            ...(next ? {} : { kkScanCount: 0, kkScanQty: 0 })
          });
        }
        await batch.commit();
        if (next) {
          const histBatch = this.firestore.firestore.batch();
          for (const m of chunk) {
            this.kkLogSet(histBatch, {
              inventoryDocId: m.id,
              factory: this.resolveKkFactoryForMaterial(m),
              materialCode: String(m.materialCode || '').trim().toUpperCase(),
              materialName: String(m.materialName || '').trim(),
              poNumber: String(m.poNumber || '').trim(),
              batchNumber: String(m.batchNumber || '').trim(),
              location: String(m.location || '').trim().toUpperCase(),
              quantity: Number(m.quantity) || 0,
              stock: Number(this.calculateCurrentStock(m)) || 0,
              unit: String(m.unit || '').trim(),
              checkedBy: operator,
              checkedAt: kkAt,
              checkedDateKey: this.toDateKey(kkAt),
              createdAt: new Date()
            });
          }
          await histBatch.commit();
        }
      }
      for (const m of targets) {
        m.kkChecked = next;
        m.kkBy = operator;
        m.kkAt = kkAt;
        if (!next) { m.kkScanCount = 0; m.kkScanQty = 0; }
      }
      this.invalidateKkInvSnapCache();
      this.syncKkMaterialRows(row.materialCode);
    } catch (e) {
      console.error('❌ onKkByMaterialTick:', e);
      appAlert('❌ Không lưu được tick KK theo mã hàng.');
    } finally {
      this.kkLocMapBusy = false;
      this.cdr.detectChanges();
    }
  }

  onKkMaterialPalletEnter(row: KkLocMaterialRow, event: Event): void {
    (event.target as HTMLInputElement | null)?.blur();
  }

  /** Nhập pallet trên dòng theo mã — ghi mọi dòng cùng mã hàng. */
  async saveKkMaterialPallet(row: KkLocMaterialRow): Promise<void> {
    if (!this.canEdit || this.kkLocMapBusy) return;
    const next = String(row.palletId || '').trim().toUpperCase();
    row.palletId = next;
    if (row.palletMixed && !next) return;
    if (next === row.palletSaved && !row.palletMixed) return;

    const lines = this.kkLinesForRow(row);
    if (!lines.length) return;

    this.kkLocMapBusy = true;
    this.cdr.detectChanges();
    try {
      const modifiedBy = await this.resolveLocationOperatorId();
      const chunkSize = 400;
      for (let i = 0; i < lines.length; i += chunkSize) {
        const chunk = lines.slice(i, i + chunkSize);
        const batch = this.firestore.firestore.batch();
        for (const m of chunk) {
          batch.update(this.firestore.collection('inventory-materials').doc(m.id!).ref, {
            palletId: next,
            updatedAt: new Date(),
            lastModified: firebase.default.firestore.FieldValue.serverTimestamp(),
            modifiedBy
          });
        }
        await batch.commit();
      }
      for (const m of lines) {
        m.palletId = next;
        (m as { __prevPalletId?: string }).__prevPalletId = next;
      }
      row.palletSaved = next;
      row.palletMixed = false;
    } catch (e) {
      console.error('❌ saveKkMaterialPallet:', e);
      appAlert('❌ Không lưu được số pallet.');
    } finally {
      this.kkLocMapBusy = false;
      this.cdr.detectChanges();
    }
  }

  onKkMaterialLocationEnter(row: KkLocMaterialRow, event: Event): void {
    (event.target as HTMLInputElement | null)?.blur();
  }

  /** Sửa vị trí ở dòng tổng → ghi tất cả dòng chi tiết (PO/IMD) của mã này. */
  async saveKkMaterialLocation(row: KkLocMaterialRow): Promise<void> {
    if (!this.canEdit || this.kkLocMapBusy) return;
    const next = this.normalizeMultiLocationValue(String(row.location || ''));
    row.location = next;
    if (!next) return;
    if (next === row.locationSaved) return;

    const lines = this.kkLinesForRow(row);
    if (!lines.length) return;

    this.kkLocMapBusy = true;
    this.cdr.detectChanges();
    try {
      const modifiedBy = await this.resolveLocationOperatorId();
      const changedAt = new Date();
      const chunkSize = 400;
      for (let i = 0; i < lines.length; i += chunkSize) {
        const chunk = lines.slice(i, i + chunkSize);
        const batch = this.firestore.firestore.batch();
        for (const m of chunk) {
          const fromLocation = this.normalizeMultiLocationValue(String(m.location || ''));
          const payload: Record<string, unknown> = {
            ...this.inventoryLocationWriteFields(next),
            updatedAt: changedAt,
            lastModified: firebase.default.firestore.FieldValue.serverTimestamp(),
            modifiedBy,
            locationManualOverride: true
          };
          if ((next === 'F62' || next === 'F62TRA') && m.iqcStatus !== 'Pass') {
            payload.iqcStatus = 'Pass';
          }
          batch.update(this.firestore.collection('inventory-materials').doc(m.id!).ref, payload);
          if (fromLocation !== next) {
            batch.set(this.firestore.collection('material-location-history').doc().ref, {
              factory: this.selectedFactory,
              materialId: m.id,
              materialCode: m.materialCode,
              poNumber: m.poNumber || '',
              fromLocation,
              toLocation: next,
              changedBy: modifiedBy,
              changeType: 'kk-material-summary',
              changedAt: firebase.default.firestore.FieldValue.serverTimestamp()
            });
          }
        }
        await batch.commit();
      }
      for (const m of lines) {
        m.location = next;
        if (next === 'F62' || next === 'F62TRA') m.iqcStatus = 'Pass';
        const rowMeta = m as { __prevLocation?: string; __locationAtLoad?: string; locationManualOverride?: boolean };
        rowMeta.__prevLocation = next;
        rowMeta.__locationAtLoad = next;
        rowMeta.locationManualOverride = true;
      }
      row.locationSaved = next;
    } catch (e) {
      console.error('❌ saveKkMaterialLocation:', e);
      appAlert('❌ Không lưu được vị trí.');
    } finally {
      this.kkLocMapBusy = false;
      this.cdr.detectChanges();
    }
  }

  async saveKkWarning(line: InventoryMaterial, value: string): Promise<void> {
    if (!this.canEdit || !line?.id) return;
    const next = String(value || '');
    const prev = this.kkWarningOf(line);
    if (next === prev) return;
    (line as any).kkWarning = next;
    this.cdr.detectChanges();
    // Cảnh báo "Đề nghị xóa": gửi đề nghị (chờ quản lý duyệt) + Zalo nhóm Quản lý kho; hủy thì trả lại cảnh báo cũ
    if (next === 'de-nghi-xoa' && !(await this.requestKkDelete(line))) {
      (line as any).kkWarning = prev;
      this.cdr.detectChanges();
      return;
    }
    try {
      const by = await this.resolveLocationOperatorId();
      const patch = {
        kkWarning: next,
        kkWarningBy: next ? by : '',
        kkWarningAt: firebase.default.firestore.FieldValue.serverTimestamp()
      };
      await this.firestore.firestore.collection('inventory-materials').doc(line.id).update(patch);
      (line as any).kkWarningBy = patch.kkWarningBy;
      this.patchKkInvSnapCache(line.id, { kkWarning: next, kkWarningBy: patch.kkWarningBy });
    } catch (e) {
      console.error('❌ saveKkWarning:', e);
      (line as any).kkWarning = prev;
      appAlert('❌ Không lưu được cảnh báo.');
    } finally {
      this.cdr.detectChanges();
    }
  }

  /**
   * Aging (tháng) của 1 dòng tồn:
   * - IMD từ 01/01/2026: theo IMD, 1 chữ số lẻ (vd 2.3).
   * - IMD trước đó: theo PO (8 số cuối, 4 số đầu = MMYY), làm tròn tháng.
   * Dưới 1 tháng → không tính (null).
   */
  kkAging(m: InventoryMaterial | null | undefined): { months: number; by: 'IMD' | 'PO'; label: string } | null {
    // Hiển thị cả Aging dưới 1 tháng (vd 0.4); dòng < 1 tháng vẫn là "Không cần kiểm" (isKkAgingExempt)
    return this.kkAgingRaw(m);
  }

  kkAgingText(m: InventoryMaterial | null | undefined): string {
    const a = this.kkAging(m);
    return a ? String(a.months) : '';
  }

  kkAgingTitle(m: InventoryMaterial | null | undefined): string {
    const a = this.kkAging(m);
    return a
      ? `${a.label} → ${a.months} tháng (${a.by === 'IMD' ? 'theo IMD, từ 01/01/2026' : 'theo PO'})`
      : 'Không xác định được IMD/PO';
  }

  /** Chi tiết box: xem gộp theo mã (cộng mọi PO) + tồn LinkQ. */
  kkTypeByCodeView = false;
  kkTypeLinkQLoading = false;

  /** Thanh chi tiết: chỉ "LinkQ" + ngày file, không hiện tên file. */
  get kkTypeLinkQShortLabel(): string {
    const raw = String(this.kkTypeLinkQLabel || '').trim();
    if (!raw) return '';
    if (/^chưa|^không/i.test(raw)) return raw;
    const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    if (iso) return `LinkQ ${iso[3]}/${iso[2]}/${iso[1]}`;
    const vi = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw);
    if (vi) return `LinkQ ${vi[1].padStart(2, '0')}/${vi[2].padStart(2, '0')}/${vi[3]}`;
    return 'LinkQ';
  }
  private kkTypeByCodeMemo: { sig: string; rows: KkTypeByCodeRow[] } = { sig: '', rows: [] };
  /** Số mã web không có trong file LinkQ — bị ẩn ở bảng Theo mã LinkQ. */
  kkByCodeHiddenCount = 0;

  async toggleKkTypeByCodeView(): Promise<void> {
    this.kkTypeByCodeView = !this.kkTypeByCodeView;
    if (!this.kkTypeByCodeView) return;
    this.kkPoCheckView = false;
    await Promise.all([this.ensureKkTypeLinkQ(), this.loadKkByCodePxk()]);
  }

  /** PXK chưa xuất theo mã (ASM1) cho bảng Theo mã LinkQ — đọc mới mỗi lần bật; lỗi thì bỏ cột (null). */
  kkByCodePxk: Map<string, { qty: number; lsx: number }> | null = null;

  private async loadKkByCodePxk(): Promise<void> {
    const factory = this.selectedFactory;
    if (factory !== 'ASM1') {
      this.kkByCodePxk = null;
      return;
    }
    try {
      const map = await this.linkQPendingPxkSvc.load(factory, true);
      if (factory === this.selectedFactory) this.kkByCodePxk = map;
    } catch (e) {
      console.warn('loadKkByCodePxk:', e);
      this.kkByCodePxk = null;
    } finally {
      this.cdr.detectChanges();
    }
  }

  // ===== Check PO: bảng chi tiết giữ nguyên, chỉ thêm 2 cột PO LinkQ + Lượng PO LinkQ (file tuổi hàng LinkQ) =====
  kkPoCheckView = false;
  kkPoCheckLoading = false;

  async toggleKkPoCheck(): Promise<void> {
    if (this.kkPoCheckView) {
      this.kkPoCheckView = false;
      return;
    }
    this.kkPoCheckLoading = true;
    this.cdr.detectChanges();
    try {
      if (!this.kkPoCmp || this.kkPoCmpFactory !== this.selectedFactory) await this.loadKkPoCmp();
    } catch (e: any) {
      appAlert('❌ Không đọc được file PO LinkQ (tuổi hàng): ' + (e?.message || e));
      return;
    } finally {
      this.kkPoCheckLoading = false;
      this.cdr.detectChanges();
    }
    if (!this.kkPoCmp) {
      if (confirm(`Chưa có file PO LinkQ (Báo cáo tuổi hàng NVL) cho ${this.selectedFactory}. Import file ngay?`)) this.importKkPoCompare();
      return;
    }
    this.kkTypeByCodeView = false;
    this.kkPoCheckView = true;
    // File tồn LinkQ: biết file tuổi hàng đã trừ PXK chưa (tránh trừ PXK 2 lần)
    void this.ensureKkTypeLinkQ();
    // PXK chưa xuất theo PO (ASM1) — trừ vào phần dư khi tô dòng nghi sai
    if (this.selectedFactory === 'ASM1') this.loadKkPoCmpPending();
    void this.loadLinkQAdjPending();
    this.cdr.detectChanges();
  }

  /** Bật Check PO và chưa bật So sánh PO (So sánh PO đã có cột PO LinkQ riêng). */
  get kkPoCheckCols(): boolean {
    return this.kkPoCheckView && !!this.kkPoCmp && !this.kkPoCmpActive;
  }

  /**
   * PO LinkQ của 1 dòng tồn web: LinkQ có đúng PO này → PO + lượng;
   * không có → vẫn hiện các PO LinkQ của mã kèm lượng (để so), match = false.
   */
  kkPoCheckLinkQ(m: InventoryMaterial): { match: boolean; items: Array<{ po: string; qty: number }> } {
    const d = this.kkPoCmp;
    // Cùng 1 object cho cùng Mã + PO — tránh ngFor vẽ lại cả ô mỗi lần change detection
    if (this.kkPoCheckMemoSrc !== d) {
      this.kkPoCheckMemoSrc = d;
      this.kkPoCheckMemo.clear();
    }
    const code = kkPoCmpCode(m.materialCode);
    const po = kkPoCmpPo(m.poNumber);
    const key = `${code}|${po}`;
    const hit = this.kkPoCheckMemo.get(key);
    if (hit) return hit;
    const pos = d?.byCode.get(code);
    // LinkQ không có đúng Mã + PO của dòng → để trống (không liệt kê PO khác của mã)
    const out = d && pos?.has(po)
      ? { match: true, items: [{ po, qty: d.qtyByKey.get(`${code}|${po}`) ?? 0 }] }
      : { match: false, items: [] };
    this.kkPoCheckMemo.set(key, out);
    return out;
  }

  /**
   * Dòng nghi sai (tô đỏ ô Tồn kho) = đúng các dòng mà Tự sửa sẽ đề nghị xóa / giảm / tăng / đổi PO,
   * cộng mọi dòng của Mã + PO lệch mà không tự sửa được. Mã không có trên LinkQ thì bỏ qua.
   */
  kkPoCheckSuspect(m: InventoryMaterial): string {
    const all = this.kkTypeDetailAll;
    const d = this.kkPoCmp;
    const sig = [this.kkTypeCacheRev, all.length, this.kkActiveProductType || '', d?.pairCount || 0,
      d?.importedAt?.getTime() || 0, this.kkPoCmpPending?.size ?? -1, this.kkTypeLinkQMap?.size ?? -1].join('|');
    if (sig !== this.kkPoSuspectSig) {
      this.kkPoSuspectSig = sig;
      this.kkPoSuspect = this.buildKkFixPlan(all, false).flags;
    }
    return this.kkPoSuspect.get(String(m.id || '')) || '';
  }

  private kkPoSuspectSig = '';
  private kkPoSuspect = new Map<string, string>();

  /** Dòng giữ lại trước: đã KK / đã scan vị trí, rồi dòng tạo trước. */
  private kkFixKeepRank(m: InventoryMaterial): number {
    const scanned = m.kkAt || m.locationScannedAt ? 1 : 0;
    const t = new Date((m.createdAt || m.importDate || 0) as any).getTime() || 0;
    return scanned * 1e15 - t;
  }

  /** Số ngày coi là "mới nhập" — file LinkQ thường chưa kịp có PO này. */
  private static readonly KK_FIX_FRESH_DAYS = 7;

  /** Dòng đang ở IQC hoặc nhập trong vài ngày gần đây → Tự sửa không đụng (chỉ báo làm tay). */
  private isKkFixFresh(m: InventoryMaterial): boolean {
    const loc = String(this.primaryLocationDisplay(m.location) || m.location || '').trim().toUpperCase();
    if (loc.startsWith('IQC')) return true;
    const toMs = (v: any): number => {
      if (!v) return 0;
      const d = typeof v?.toDate === 'function' ? v.toDate() : new Date(v);
      return d.getTime() || 0;
    };
    let t = Math.max(toMs((m as any).receivedDate), toMs(m.createdAt), toMs(m.importDate));
    const imd = String(this.getDisplayIMD(m) || '');
    if (/^\d{8}/.test(imd)) {
      const it = new Date(+imd.slice(4, 8), +imd.slice(2, 4) - 1, +imd.slice(0, 2)).getTime() || 0;
      t = Math.max(t, it);
    }
    return t > 0 && Date.now() - t < QuanLyNguyenLieuComponent.KK_FIX_FRESH_DAYS * 864e5;
  }

  /**
   * Phương án Tự sửa theo từng Mã + PO (gốc = LinkQ file tuổi hàng), lệch = web − PXK chưa xuất − LinkQ:
   * 1) PO web không có trên LinkQ, cùng lượng với 1 PO LinkQ chưa khớp → đổi PO.
   * 2) Web dư: xóa dòng trùng (cùng IMD + vị trí + lượng) → xóa 1–3 dòng cộng đúng phần dư → giảm dòng mới nhất.
   * 3) Web thiếu: không bao giờ tăng tồn → làm tay. PO LinkQ chưa có dòng web / lệch quá lớn → làm tay.
   */
  private buildKkFixPlan(lines: InventoryMaterial[], skipPending: boolean): KkFixPlan {
    const plan: KkFixPlan = { items: [], manual: [], before: 0, after: 0, flags: new Map() };
    const d = this.kkPoCmp;
    if (!d) return plan;
    const tol = 1;
    const r4 = (n: number) => Math.round(n * 10000) / 10000;
    const fmt = (n: number) => this.formatNumber(n);
    const isOff = (e: number) => Math.abs(e) > tol && this.isLinkqDiffBad(e);
    const byCode = new Map<string, Map<string, { lines: InventoryMaterial[]; web: number }>>();
    for (const m of lines) {
      const code = kkPoCmpCode(m.materialCode);
      if (!d.byCode.get(code)?.size) continue;
      const stock = this.calculateCurrentStock(m);
      if (!(stock > 0)) continue;
      const po = kkPoCmpPo(m.poNumber) || '—';
      const pos = byCode.get(code) || new Map();
      const g = pos.get(po) || { lines: [], web: 0 };
      g.lines.push(m);
      g.web = r4(g.web + stock);
      pos.set(po, g);
      byCode.set(code, pos);
    }
    const usable = (m: InventoryMaterial) => !skipPending || !this.linkQAdjPending.get(String(m.id || ''))?.length;
    const add = (it: Omit<KkFixItem, 'key' | 'on'>) => {
      plan.items.push({ ...it, key: `${it.m.id}|${it.kind}|${it.target}`, on: true });
      const id = String(it.m.id || '');
      if (!plan.flags.has(id)) plan.flags.set(id, it.reason);
    };
    const manual = (code: string, po: string, text: string, g?: { lines: InventoryMaterial[] }) => {
      plan.manual.push({ code, po, text });
      g?.lines.forEach((m) => {
        const id = String(m.id || '');
        if (!plan.flags.has(id)) plan.flags.set(id, 'Cần làm tay: ' + text);
      });
    };

    byCode.forEach((pos, code) => {
      const lqPos = d.byCode.get(code) || new Set<string>();
      const lq = (po: string) => (lqPos.has(po) ? d.qtyByKey.get(`${code}|${po}`) ?? 0 : 0);
      // PO chung của LinkQ không làm đích đổi PO
      const lqUnused = Array.from(lqPos).filter((po) => po !== KK_PO_BLANK && !pos.has(po) && lq(po) > tol);
      plan.before = r4(plan.before + lqUnused.reduce((s, po) => s + lq(po), 0));

      pos.forEach((g, po) => {
        const pxk = this.kkAgingPxkOf(code, po);
        const L = lq(po);
        const E = r4(g.web - pxk - L);
        if (!isOff(E)) return;
        if (po === KK_PO_BLANK) {
          // PO chung (trống / PO00000000): không tự sửa, chỉ báo
          manual(code, po, `PO chung lệch ${E > 0 ? '+' : ''}${fmt(E)} (web ${fmt(g.web)}${pxk ? ` − PXK ${fmt(pxk)}` : ''} vs LinkQ ${fmt(L)}) — không tự sửa PO chung`, g);
          plan.before = r4(plan.before + Math.abs(E));
          plan.after = r4(plan.after + Math.abs(E));
          return;
        }
        plan.before = r4(plan.before + Math.abs(E));
        const base = `PO ${po}: web ${fmt(g.web)}${pxk ? ` − PXK ${fmt(pxk)}` : ''} ${lqPos.has(po) ? `vs LinkQ ${fmt(L)}` : '(LinkQ không có PO này)'}`;
        const avail = g.lines.filter(usable);

        // Có dòng mới nhập / đang IQC: LinkQ có thể chưa cập nhật → không tự xóa / giảm / đổi PO, chỉ báo làm tay
        const fresh = g.lines.filter((m) => this.isKkFixFresh(m));
        if (fresh.length && E > 0) {
          const fs = r4(fresh.reduce((s, m) => s + this.calculateCurrentStock(m), 0));
          manual(code, po, `Dư ${fmt(E)} (${base}) — có ${fresh.length} dòng mới nhập / IQC (${fmt(fs)}), LinkQ có thể chưa cập nhật → không tự sửa, kiểm tra tay`, g);
          plan.after = r4(plan.after + E);
          return;
        }

        // 1) PO gõ khác: web có PO lạ, LinkQ có đúng 1 PO chưa dòng nào khớp cùng lượng
        if (!lqPos.has(po)) {
          const net = r4(g.web - pxk);
          const cand = lqUnused.filter((p) => Math.abs(lq(p) - net) <= tol);
          if (cand.length === 1 && avail.length === g.lines.length) {
            const to = cand[0];
            lqUnused.splice(lqUnused.indexOf(to), 1);
            plan.before = r4(plan.before - lq(to));
            g.lines.forEach((m) => add({
              m, kind: 'po', target: '', qty: 0, newPo: to, code, po,
              reason: `Đổi PO ${po} → ${to}: LinkQ không có ${po}, PO ${to} trên LinkQ ${fmt(lq(to))} = web ${fmt(net)}`
            }));
            return;
          }
        }

        if (E > 0) {
          let rest = E;
          const picked = new Set<InventoryMaterial>();
          // 2a) dòng trùng
          const buckets = new Map<string, InventoryMaterial[]>();
          avail.forEach((m) => {
            const k = `${this.getDisplayIMD(m)}|${this.primaryLocationDisplay(m.location)}|${r4(this.calculateCurrentStock(m))}`;
            buckets.set(k, [...(buckets.get(k) || []), m]);
          });
          buckets.forEach((list) => {
            if (list.length < 2) return;
            const sorted = [...list].sort((a, b) => this.kkFixKeepRank(b) - this.kkFixKeepRank(a));
            const keep = sorted[0];
            for (const m of sorted.slice(1)) {
              const s = this.calculateCurrentStock(m);
              if (s > rest + tol) break;
              picked.add(m);
              rest = r4(rest - s);
              add({
                m, kind: 'delete', target: '', qty: s, newPo: '', code, po,
                reason: `Trùng dòng (cùng PO, IMD ${this.getDisplayIMD(keep)}, vị trí ${this.primaryLocationDisplay(keep.location) || '—'}, lượng ${fmt(s)}) · ${base}`
              });
            }
          });
          // 2b) 1–3 dòng cộng đúng phần dư (ưu tiên ít dòng, dòng mới)
          if (rest > tol) {
            const pool = avail.filter((m) => !picked.has(m)).sort((a, b) => this.kkFixKeepRank(a) - this.kkFixKeepRank(b));
            const st = pool.map((m) => this.calculateCurrentStock(m));
            const near = (s: number) => Math.abs(s - rest) <= tol;
            let hit: number[] | null = null;
            for (let i = 0; i < pool.length && !hit; i++) if (near(st[i])) hit = [i];
            if (pool.length <= 60) {
              for (let i = 0; i < pool.length && !hit; i++) {
                for (let j = i + 1; j < pool.length && !hit; j++) if (near(st[i] + st[j])) hit = [i, j];
              }
            }
            if (pool.length <= 25) {
              for (let i = 0; i < pool.length && !hit; i++) {
                for (let j = i + 1; j < pool.length && !hit; j++) {
                  for (let k = j + 1; k < pool.length && !hit; k++) if (near(st[i] + st[j] + st[k])) hit = [i, j, k];
                }
              }
            }
            if (hit) {
              const sum = hit.reduce((s, i) => s + st[i], 0);
              hit.forEach((i) => {
                picked.add(pool[i]);
                add({
                  m: pool[i], kind: 'delete', target: '', qty: st[i], newPo: '', code, po,
                  reason: `${hit!.length > 1 ? `${hit!.length} dòng cộng` : 'Dòng'} ${fmt(sum)} = phần dư ${fmt(rest)} · ${base}`
                });
              });
              rest = r4(rest - sum);
            }
          }
          // 2c) giảm dòng mới nhất (chỉ giảm nên dư lớn vẫn sửa; không còn dòng nào → làm tay)
          if (rest > tol) {
            if (!avail.some((m) => !picked.has(m))) {
              manual(code, po, `Dư ${fmt(rest)} (${base}) — các dòng đang chờ duyệt, làm tay`, g);
              plan.after = r4(plan.after + rest);
              return;
            }
            const pool = avail.filter((m) => !picked.has(m)).sort((a, b) => this.kkFixKeepRank(a) - this.kkFixKeepRank(b));
            for (const m of pool) {
              if (rest <= tol) break;
              const s = this.calculateCurrentStock(m);
              const take = r4(Math.min(rest, s));
              rest = r4(rest - take);
              const why = `Dư ${fmt(E)} không khớp dòng nào → giảm dòng mới nhất · ${base}`;
              if (take >= s - tol) {
                add({ m, kind: 'delete', target: '', qty: s, newPo: '', code, po, reason: why });
                continue;
              }
              const nk = Math.max(0, Number(m.quantity) || 0);
              const c = r4(Math.min(take, nk));
              if (c > 0) add({ m, kind: 'dec', target: 'closing', qty: c, newPo: '', code, po, reason: why });
              if (take - c > 0) add({ m, kind: 'dec', target: 'opening', qty: r4(take - c), newPo: '', code, po, reason: why });
            }
          }
          plan.after = r4(plan.after + Math.abs(rest));
          return;
        }

        // 3) Web thiếu — Tự sửa không bao giờ tăng tồn, chỉ báo làm tay
        const S = -E;
        manual(code, po, `Web thiếu ${fmt(S)} (${base}) — không tự tăng tồn, kiểm tra / làm tay`, g);
        plan.after = r4(plan.after + S);
      });

      lqUnused.forEach((po) => {
        manual(code, po, `LinkQ có PO ${po} ${fmt(lq(po))} nhưng web không có dòng nào → tạo dòng tay (cần IMD, vị trí)`);
        plan.after = r4(plan.after + lq(po));
      });
    });
    plan.items.sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }) || a.po.localeCompare(b.po));
    return plan;
  }

  // ===== Nút Tự sửa (Check PO): xem trước → tick → gửi đề nghị vào Danh mục điều chỉnh + 1 tin Zalo =====
  kkFix: (KkFixPlan & { busy: boolean; msg: string; ok: boolean }) | null = null;
  kkFixLoading = false;

  async openKkAutoFix(): Promise<void> {
    if (!this.canEdit || this.denyAction('invAdjustRequest')) return;
    if (!this.kkPoCheckCols || this.kkFixLoading) return;
    this.kkFixLoading = true;
    this.cdr.detectChanges();
    try {
      await Promise.all([this.loadLinkQAdjPending(), this.ensureKkTypeLinkQ()]);
      const factory = this.selectedFactory;
      let kitting = new Map<string, string[]>();
      if (factory === 'ASM1') {
        // Đọc lại PXK chưa xuất ngay lúc bấm — Kitting đang scan xuất, số cũ có thể đã sai
        const fresh = await this.linkQPendingPxkSvc.loadByPo(factory, true).catch(() => null);
        if (fresh && factory === this.selectedFactory) {
          this.kkPoCmpPending = fresh;
          this.kkPoSuspectSig = '';
        }
        kitting = await this.linkQPendingPxkSvc.loadKittingCodes(factory).catch(() => new Map());
      }
      const bs = await this.loadKkBsPendingCodes(factory);
      if (factory !== this.selectedFactory) return;
      // Mã đang Kitting / đang chờ Xuất BS: có thể sắp scan xuất → không tự sửa, chỉ báo
      const skip = new Map<string, string>();
      kitting.forEach((lsx, code) => skip.set(kkPoCmpCode(code), `Đang Kitting (${lsx.join(', ')}) — có thể đang scan xuất, không tự sửa`));
      bs.forEach((lsx, code) => {
        const why = `Đang chờ Xuất BS (${lsx.join(', ')}) — có thể sắp scan xuất, không tự sửa`;
        skip.set(code, skip.has(code) ? `${skip.get(code)} · ${why}` : why);
      });
      const plan = this.buildKkFixPlan(this.kkTypeDetailAll, true);
      const skipped = new Set<string>();
      [...plan.items.map((x) => x.code), ...plan.manual.map((x) => x.code)].forEach((c) => skip.has(c) && skipped.add(c));
      plan.items = plan.items.filter((x) => !skipped.has(x.code));
      plan.manual = [
        ...Array.from(skipped).sort().map((code) => ({ code, po: '—', text: skip.get(code) || '' })),
        ...plan.manual.filter((x) => !skipped.has(x.code))
      ];
      this.kkFix = { ...plan, busy: false, msg: '', ok: false };
    } finally {
      this.kkFixLoading = false;
      this.cdr.detectChanges();
    }
  }

  /**
   * Mã còn trên phiếu Xuất BS chưa xuất (pxk-bs-data: chưa done / ẩn / xóa, import trong 30 ngày + LSX Chung) → các LSX.
   * Đọc theo factory (không cần index ghép), lỗi thì coi như không có.
   */
  private async loadKkBsPendingCodes(factory: string): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    try {
      const cutoff = Date.now() - 30 * 86400000;
      const snap = await this.firestore.firestore.collection('pxk-bs-data').where('factory', '==', factory).get();
      snap.docs.forEach((doc) => {
        const d = doc.data() as any;
        const common = doc.id.endsWith('_LSX_Chung') || doc.id.endsWith('_NO_LSX');
        const at = d?.importedAt?.toDate ? d.importedAt.toDate().getTime() : (d?.importedAt ? new Date(d.importedAt).getTime() : 0);
        if (!common && at && at < cutoff) return;
        const lsxRaw = String(d?.lsx || '').trim();
        const lsx = common || !lsxRaw || /^lsx\s*chung$/i.test(lsxRaw) ? 'N/A' : lsxRaw;
        (Array.isArray(d?.lines) ? d.lines : []).forEach((l: any) => {
          if (l?.done || l?.hidden || l?.deletedAt) return;
          if (!(Number(l?.quantity ?? l?.soLuong ?? 0) > 0)) return;
          const code = kkPoCmpCode(l?.materialCode || l?.maVatTu || l?.maHang);
          if (!code) return;
          const list = out.get(code) || [];
          if (!list.includes(lsx)) out.set(code, [...list, lsx]);
        });
      });
    } catch (e) {
      console.warn('loadKkBsPendingCodes:', e);
    }
    return out;
  }

  kkFixKindLabel(it: KkFixItem): string {
    if (it.kind === 'delete') return 'Xóa dòng';
    if (it.kind === 'po') return 'Đổi PO';
    return `Giảm ${it.target === 'opening' ? 'tồn đầu' : 'tồn'}`;
  }

  kkFixSelected(): KkFixItem[] {
    return this.kkFix?.items.filter((x) => x.on) || [];
  }

  kkFixToggleAll(on: boolean): void {
    this.kkFix?.items.forEach((x) => (x.on = on));
  }

  async submitKkAutoFix(): Promise<void> {
    const f = this.kkFix;
    if (!f || f.busy || f.ok) return;
    const sel = this.kkFixSelected();
    if (!sel.length) {
      f.msg = 'Chưa tick đề nghị nào.';
      return;
    }
    f.busy = true;
    f.msg = '';
    this.cdr.detectChanges();
    try {
      const db = this.firestore.firestore;
      const by = await this.getMaterialsOtpRequester();
      const now = firebase.default.firestore.FieldValue.serverTimestamp();
      for (let i = 0; i < sel.length; i += 400) {
        const batch = db.batch();
        sel.slice(i, i + 400).forEach((it) => {
          const m = it.m;
          const stock = this.calculateCurrentStock(m);
          const current = it.target === 'opening' ? Number(m.openingStock) || 0 : stock;
          const expected = it.kind === 'delete' ? 0
            : it.kind === 'po' ? stock
              : Math.round((current - it.qty) * 10000) / 10000;
          batch.set(db.collection('inventory-adjust-requests').doc(), {
            factory: this.selectedFactory,
            materialId: m.id,
            materialCode: m.materialCode || '',
            po: m.poNumber || '',
            imd: this.getDisplayIMD(m),
            location: this.primaryLocationDisplay(m.location),
            target: it.kind === 'delete' ? 'delete' : it.kind === 'po' ? 'po' : it.target,
            direction: it.kind === 'dec' ? 'dec' : '',
            qty: it.kind === 'po' ? 0 : it.qty,
            currentValue: current,
            expectedValue: expected,
            ...(it.kind === 'po' ? { newPo: it.newPo } : {}),
            note: 'Tự sửa Check PO: ' + it.reason,
            source: 'kk-autofix',
            status: 'pending',
            by,
            at: now
          });
        });
        await batch.commit();
      }
      const count = (k: KkFixItem['kind']) => sel.filter((x) => x.kind === k).length;
      const parts = [
        count('delete') && `xóa ${count('delete')} dòng`,
        count('dec') && `giảm ${count('dec')}`,
        count('po') && `đổi PO ${count('po')}`
      ].filter(Boolean).join(', ');
      const sample = sel.slice(0, 12).map((x) =>
        `• ${x.code} · ${x.po} · ${this.kkFixKindLabel(x)}${x.kind === 'po' ? ` → ${x.newPo}` : ` ${this.formatNumber(x.qty)}`}`).join('\n');
      let zaloOk = true;
      try {
        await this.invStockReportSvc.notify({
          factory: this.selectedFactory,
          materialCode: `Mục ${this.kkActiveProductType || ''}`.trim(),
          po: '',
          imd: '',
          stock: '',
          location: '',
          status: `Tự sửa Check PO: ${sel.length} đề nghị`,
          reportedBy: by,
          detail: `Đề nghị ${parts} để khớp PO LinkQ.\n${sample}${sel.length > 12 ? `\n… và ${sel.length - 12} đề nghị khác` : ''}`
            + '\nDuyệt tại Materials → More → Danh mục điều chỉnh.'
        });
      } catch (e) {
        console.warn('submitKkAutoFix zalo:', e);
        zaloOk = false;
      }
      f.ok = true;
      f.msg = `✅ Đã gửi ${sel.length} đề nghị (${parts}).` + (zaloOk ? ' Bot Zalo đã báo nhóm Quản lý kho.' : ' Zalo chưa gửi được.');
      await this.loadLinkQAdjPending();
    } catch (e: any) {
      console.error('submitKkAutoFix:', e);
      f.msg = '❌ Không gửi được: ' + (e?.message || e);
    } finally {
      f.busy = false;
      this.cdr.detectChanges();
    }
  }

  private kkPoCheckMemoSrc: unknown = null;
  private kkPoCheckMemo = new Map<string, { match: boolean; items: Array<{ po: string; qty: number }> }>();

  /** File LinkQ (1 doc, có cache) — cho cột Có LinkQ / Tồn LinkQ ở chi tiết box. */
  private async ensureKkTypeLinkQ(): Promise<void> {
    if (this.kkTypeLinkQMap || this.kkTypeLinkQLoading) return;
    this.kkTypeLinkQLoading = true;
    this.cdr.detectChanges();
    try {
      const pack = await this.getLinkQPackCached(false);
      this.kkTypeLinkQMap = pack.map;
      this.kkTypeLinkQLabel = pack.map.size ? pack.label : 'Chưa có file LinkQ (import ở Inventory Overview)';
    } catch (e) {
      console.warn('toggleKkTypeByCodeView:', e);
      this.kkTypeLinkQLabel = 'Không đọc được LinkQ';
      this.kkTypeLinkQMap = new Map(); // không thử lại liên tục mỗi lần vẽ bảng
    } finally {
      this.kkTypeLinkQLoading = false;
      this.kkTypeByCodeMemo.sig = '';
      this.cdr.detectChanges();
    }
  }

  get kkTypeByCodeRows(): KkTypeByCodeRow[] {
    const lines = this.kkTypeDetailFiltered;
    const sig = [this.kkTypeDetailSig, this.kkTypeCacheRev, lines.length, this.kkTypeLinkQLabel, this.kkByCodePxk?.size ?? -1].join('|');
    if (sig === this.kkTypeByCodeMemo.sig) return this.kkTypeByCodeMemo.rows;
    const map = new Map<string, { code: string; name: string; lines: number; web: number; checked: number; exempt: number; aging: number | null; locs: Set<string>; items: InventoryMaterial[] }>();
    for (const m of lines) {
      const code = String(m.materialCode || '').trim().toUpperCase();
      if (!code) continue;
      const cur = map.get(code) || { code, name: this.getKkMaterialName(m), lines: 0, web: 0, checked: 0, exempt: 0, aging: null, locs: new Set<string>(), items: [] };
      cur.lines += 1;
      cur.items.push(m);
      const age = this.kkAging(m)?.months;
      if (age != null && (cur.aging == null || age > cur.aging)) cur.aging = age;
      cur.web += this.calculateCurrentStock(m);
      if (this.isKkAgingExempt(m)) cur.exempt += 1;
      else if (this.isKkFlagOn(m.kkChecked)) cur.checked += 1;
      const loc = this.primaryLocationDisplay(m.location);
      if (loc) cur.locs.add(loc);
      map.set(code, cur);
    }
    const linkQ = this.kkTypeLinkQMap;
    // Chỉ mã có trong file LinkQ (chưa đọc xong LinkQ thì tạm hiện hết)
    const onlyLinkQ = !!linkQ && linkQ.size > 0;
    let hidden = 0;
    const rows = Array.from(map.values()).filter((v) => {
      if (!onlyLinkQ || linkQ!.has(this.normalizeTieuHuyCode(v.code))) return true;
      hidden += 1;
      return false;
    }).map((v) => {
      const key = this.normalizeTieuHuyCode(v.code);
      const q = linkQ && linkQ.has(key) ? Number(linkQ.get(key)) : null;
      const web = Math.round(v.web * 10000) / 10000;
      // Theo mã: không so PO — Lệch = Tồn web − (Tồn LinkQ + PXK chưa xuất của mã)
      const pxk = this.kkByCodePxk ? this.kkByCodePxk.get(v.code)?.qty || 0 : null;
      const diff = q == null ? null : Math.round((web - q - (pxk || 0)) * 10000) / 10000;
      return {
        code: v.code,
        name: v.name,
        lines: v.lines,
        aging: v.aging,
        web,
        linkQ: q,
        pxk,
        diff,
        warn: this.isLinkqDiffBad(diff),
        checked: v.checked,
        kkLines: v.lines - v.exempt,
        locs: Array.from(v.locs).sort().join(', '),
        items: v.items.sort((a, b) => String(a.poNumber || '').localeCompare(String(b.poNumber || '')) || this.getDisplayIMD(a).localeCompare(this.getDisplayIMD(b)))
      };
    }).sort((a, b) => Number(b.warn) - Number(a.warn) || a.code.localeCompare(b.code));
    this.kkTypeByCodeMemo = { sig, rows };
    this.kkByCodeHiddenCount = hidden;
    return rows;
  }

  /** Yes / No: mã có trong file LinkQ mới nhất; chưa đọc xong LinkQ thì "…". */
  kkHasLinkQText(code: string | null | undefined): string {
    if (!this.kkTypeLinkQMap) {
      void this.ensureKkTypeLinkQ();
      return '…';
    }
    if (!this.kkTypeLinkQMap.size) return '—';
    return this.kkTypeLinkQMap.has(this.normalizeTieuHuyCode(code)) ? 'Yes' : 'No';
  }

  /**
   * Khi gõ ô tìm trong box / mục: theo từng mã khớp, cộng tồn web (mọi PO đang hiện) rồi trừ tồn LinkQ (tổng của mã).
   * Tối đa 8 mã để gọn.
   */
  get kkInnerSearchDiffs(): Array<{ code: string; web: number; linkQ: number | null; diff: number | null }> {
    if (!this.kkTypeInnerQuery.trim()) return [];
    const byCode = new Map<string, number>();
    for (const m of this.kkTypeDetailFiltered) {
      const c = String(m.materialCode || '').trim().toUpperCase();
      if (!c) continue;
      byCode.set(c, (byCode.get(c) || 0) + this.calculateCurrentStock(m));
    }
    const r4 = (n: number) => Math.round(n * 10000) / 10000;
    return Array.from(byCode.entries()).slice(0, 8).map(([code, web]) => {
      const key = this.normalizeTieuHuyCode(code);
      const lq = this.kkTypeLinkQMap && this.kkTypeLinkQMap.has(key) ? Number(this.kkTypeLinkQMap.get(key)) || 0 : null;
      return { code, web: r4(web), linkQ: lq, diff: lq == null ? null : r4(web - lq) };
    });
  }
  kkPendingPxkLoading = false;

  async toggleKkPendingPxk(): Promise<void> {
    if (this.kkPendingPxkLoading) return;
    if (this.kkPendingPxk) {
      this.kkPendingPxk = null;
      this.kkTypeDiffFilter = '';
      this.kkTypeDetailSig = '';
      return;
    }
    if (this.selectedFactory !== 'ASM1') { appAlert('PXK chưa xuất hiện chỉ tính cho ASM1.'); return; }
    this.kkPendingPxkLoading = true;
    this.cdr.detectChanges();
    try {
      const factory = this.selectedFactory;
      // File tuổi hàng (LinkQ theo PO) cho cột Chênh lệch theo dòng — đọc trước vì nó xóa PXK theo PO;
      // chưa có file thì cột tính theo tổng mã
      if (!this.kkPoCmp || this.kkPoCmpFactory !== factory) await this.loadKkPoCmp().catch((e) => console.warn('loadKkPoCmp:', e));
      await this.ensureKkTypeLinkQ();
      this.kkPendingPxk = await this.linkQPendingPxkSvc.load(factory, true);
      // Cùng 1 lần tính (cache của service) — lượng theo Mã + PO cho cột PXK chưa xuất từng dòng
      const byPo = await this.linkQPendingPxkSvc.loadByPo(factory);
      if (factory === this.selectedFactory) {
        this.kkPoCmpPending = byPo;
        this.kkPoSuspectSig = '';
      }
    } catch (e: any) {
      appAlert('❌ Không tính được PXK chưa xuất: ' + (e?.message || e));
    } finally {
      this.kkPendingPxkLoading = false;
      this.cdr.detectChanges();
    }
  }

  kkPxkDiffText(code: string | null | undefined): string {
    const d = this.kkPxkDiff(code);
    return d == null ? '…' : `${d > 0 ? '+' : ''}${this.formatNumber(d)}`;
  }

  kkPxkDiffTitle(code: string | null | undefined): string {
    const c = String(code || '').trim().toUpperCase();
    if (!this.kkTypeLinkQMap) return 'Đang đọc LinkQ…';
    const lq = Number(this.kkTypeLinkQMap.get(this.normalizeTieuHuyCode(c))) || 0;
    const pxk = this.kkPendingPxk?.get(c)?.qty || 0;
    return `Tồn web ${this.formatNumber(this.kkWebTotalOfCode(c))} − (LinkQ ${this.formatNumber(lq)} + PXK chưa xuất ${this.formatNumber(pxk)}) — tổng mã`;
  }

  kkPendingPxkText(code: string | null | undefined): string {
    const p = this.kkPendingPxk?.get(String(code || '').trim().toUpperCase());
    return p ? this.formatNumber(p.qty) : '—';
  }

  /**
   * Chênh lệch từng dòng: mã có trong file tuổi hàng → LinkQ + PXK chưa xuất của PO được trừ dần vào các dòng
   * của PO (dòng giữ lại trước: đã KK / scan, rồi dòng tạo trước) → phần dư rơi vào dòng nghi sai,
   * thiếu (âm) dồn vào dòng lớn nhất. Tổng các dòng = chênh lệch của PO. Mã không có trong file → theo tổng mã.
   */
  override kkPxkDiffOf(m: InventoryMaterial): number | null {
    const hit = this.kkLineDiffMap().get(String(m.id || ''));
    return hit ? hit.diff : this.kkPxkDiff(m.materialCode);
  }

  kkLineDiffText(m: InventoryMaterial): string {
    const d = this.kkPxkDiffOf(m);
    return d == null ? '…' : `${d > 0 ? '+' : ''}${this.formatNumber(d)}`;
  }

  kkLineDiffTitle(m: InventoryMaterial): string {
    const hit = this.kkLineDiffMap().get(String(m.id || ''));
    return hit ? hit.why : this.kkPxkDiffTitle(m.materialCode);
  }

  /**
   * PXK chưa xuất cộng thêm khi so web với file tuổi hàng (LinkQ theo PO).
   * File tuổi hàng có thể cũ hơn file tồn LinkQ: nếu tổng tuổi hàng của mã ≈ LinkQ tồn + PXK chưa xuất
   * (gần hơn ≈ LinkQ tồn) thì file tuổi hàng CHƯA trừ PXK → không cộng PXK nữa (tránh trừ 2 lần).
   * Chưa đọc được file tồn LinkQ → cộng PXK như cũ.
   */
  kkAgingPxkOf(code: string, po: string): number {
    const pxk = this.kkPoCmpPendingOf(code, po);
    return pxk > 0 && this.kkAgingHasPxk(code) ? 0 : pxk;
  }

  /** true = file tuổi hàng của mã còn chứa lượng PXK chưa xuất (LinkQ chưa trừ lúc xuất file tuổi hàng). */
  kkAgingHasPxk(code: string): boolean {
    const d = this.kkPoCmp;
    const lqMap = this.kkTypeLinkQMap;
    if (!d || !lqMap?.size) return false;
    const sig = `${d.pairCount}|${d.importedAt?.getTime() || 0}|${this.kkPoCmpPending?.size ?? -1}|${lqMap.size}`;
    if (sig !== this.kkAgingHasPxkSig) {
      this.kkAgingHasPxkSig = sig;
      this.kkAgingHasPxkMemo.clear();
    }
    const c = kkPoCmpCode(code);
    const hit = this.kkAgingHasPxkMemo.get(c);
    if (hit != null) return hit;
    let aging = 0;
    let pxk = 0;
    (d.byCode.get(c) || new Set<string>()).forEach((po) => {
      aging += d.qtyByKey.get(`${c}|${po}`) ?? 0;
    });
    this.kkPoCmpPending?.forEach((v, key) => {
      if (key.slice(0, key.indexOf('|')) === c) pxk += v.qty;
    });
    const lq = Number(lqMap.get(this.normalizeTieuHuyCode(c)));
    const out = pxk > 0 && Number.isFinite(lq) && Math.abs(aging - (lq + pxk)) < Math.abs(aging - lq);
    this.kkAgingHasPxkMemo.set(c, out);
    return out;
  }

  private kkAgingHasPxkSig = '';
  private kkAgingHasPxkMemo = new Map<string, boolean>();

  private kkLineDiffSig = '';
  private kkLineDiffCache = new Map<string, { diff: number; why: string }>();

  private kkLineDiffMap(): Map<string, { diff: number; why: string }> {
    const all = this.kkTypeDetailAll;
    const d = this.kkPoCmp;
    const sig = [this.kkTypeCacheRev, all.length, this.kkActiveProductType || '', d?.pairCount || 0,
      d?.importedAt?.getTime() || 0, this.kkPoCmpPending?.size ?? -1, this.kkTypeLinkQMap?.size ?? -1].join('|');
    if (sig === this.kkLineDiffSig) return this.kkLineDiffCache;
    this.kkLineDiffSig = sig;
    const out = new Map<string, { diff: number; why: string }>();
    this.kkLineDiffCache = out;
    if (!d) return out;
    const r4 = (n: number) => Math.round(n * 10000) / 10000;
    const fmt = (n: number) => this.formatNumber(n);
    const groups = new Map<string, { code: string; po: string; lines: InventoryMaterial[] }>();
    for (const m of all) {
      const code = kkPoCmpCode(m.materialCode);
      if (!d.byCode.get(code)?.size) continue;
      const po = kkPoCmpPo(m.poNumber);
      const key = `${code}|${po}`;
      const g = groups.get(key) || { code, po, lines: [] };
      g.lines.push(m);
      groups.set(key, g);
    }
    groups.forEach((g, key) => {
      const inLq = !!d.byCode.get(g.code)?.has(g.po);
      const lq = inLq ? d.qtyByKey.get(key) ?? 0 : 0;
      const pxk = this.kkAgingPxkOf(g.code, g.po);
      const web = r4(g.lines.reduce((s, m) => s + Math.max(0, this.calculateCurrentStock(m)), 0));
      const poDiff = r4(web - lq - pxk);
      const rawPxk = this.kkPoCmpPendingOf(g.code, g.po);
      const pxkNote = rawPxk > pxk ? ` (PXK chưa xuất ${fmt(rawPxk)} đã nằm trong file tuổi hàng — không cộng)` : '';
      const head = `PO ${g.po}: web ${fmt(web)} − (LinkQ ${inLq ? fmt(lq) : 'không có PO'} + PXK ${fmt(pxk)}) = ${poDiff > 0 ? '+' : ''}${fmt(poDiff)}${pxkNote}`;
      const order = [...g.lines].sort((a, b) => this.kkFixKeepRank(b) - this.kkFixKeepRank(a));
      let cover = r4(lq + pxk);
      order.forEach((m) => {
        const s = Math.max(0, this.calculateCurrentStock(m));
        const used = Math.min(s, cover);
        cover = r4(cover - used);
        out.set(String(m.id || ''), { diff: r4(s - used), why: `Dòng ${fmt(s)}, được trừ ${fmt(used)} · ${head}` });
      });
      if (cover > 0 && order.length) {
        // Web thiếu so với LinkQ + PXK → dồn phần âm vào dòng lớn nhất
        const big = [...order].sort((a, b) => this.calculateCurrentStock(b) - this.calculateCurrentStock(a))[0];
        const cur = out.get(String(big.id || ''))!;
        out.set(String(big.id || ''), { diff: r4(cur.diff - cover), why: `${cur.why} · thiếu ${fmt(cover)} dồn vào dòng này` });
      }
    });
    return out;
  }

  /** PXK chưa xuất của Mã + PO dòng này (mọi dòng cùng PO hiện cùng số). */
  kkPendingPxkPoText(m: InventoryMaterial): string {
    const q = this.kkPoCmpPendingOf(m.materialCode, m.poNumber);
    return q > 0 ? this.formatNumber(q) : '—';
  }

  kkPendingPxkPoTitle(m: InventoryMaterial): string {
    const p = kkPoCmpPo(m.poNumber);
    const hit = this.kkPoCmpPending?.get(`${kkPoCmpCode(m.materialCode)}|${p === KK_PO_BLANK ? '' : p}`);
    const code = this.kkPendingPxk?.get(String(m.materialCode || '').trim().toUpperCase());
    const total = code ? ` · tổng mã ${this.formatNumber(code.qty)}` : '';
    if (!hit?.qty) return `PO ${m.poNumber || '—'}: không có PXK chưa xuất${total}`;
    return `PO ${m.poNumber || '—'}: ${this.formatNumber(hit.qty)} chưa xuất — `
      + hit.lsx.map((x) => `${x.lsx} ${this.formatNumber(x.qty)}`).join(', ')
      + ` (số của cả PO, các dòng cùng PO hiện cùng số)${total}`;
  }

  kkPendingPxkTitle(code: string | null | undefined): string {
    const p = this.kkPendingPxk?.get(String(code || '').trim().toUpperCase());
    return p ? `${this.formatNumber(p.qty)} trên PXK của ${p.lsx} LSX chưa Done mà web chưa scan xuất` : 'Không có PXK chưa xuất';
  }

  /** Tồn LinkQ theo mã (file LinkQ mới nhất); chưa đọc xong → "…". */
  kkLinkQQtyText(code: string | null | undefined): string {
    if (!this.kkTypeLinkQMap) {
      void this.ensureKkTypeLinkQ();
      return '…';
    }
    const key = this.normalizeTieuHuyCode(code);
    return this.kkTypeLinkQMap.has(key) ? this.formatNumber(Number(this.kkTypeLinkQMap.get(key)) || 0) : '—';
  }

  kkTypeDetailExportBusy = false;

  /** Tải Excel đúng bảng đang hiện ở chi tiết box / toàn bộ mục (mọi dòng đang lọc). */
  /** Dòng của bảng đang hiện (mọi dòng đang lọc) — dùng cho Tải xuống và In. */
  private kkTypeDetailExportRows(): Array<Record<string, unknown>> {
    const warnLabel = new Map(this.kkWarningOptions.map((o) => [o.value, o.label] as [string, string]));
    let rows: Array<Record<string, unknown>>;
    if (this.kkTypeByCodeView) {
      rows = this.kkTypeByCodeRows.map((r, i) => ({
        'STT': i + 1,
        'Mã hàng': r.code,
        'Tên hàng': r.name,
        'Có LinkQ': r.linkQ == null ? 'No' : 'Yes',
        'Số dòng': r.lines,
        'Aging (tháng)': r.aging ?? '',
        'Tồn web': r.web,
        'Tồn LinkQ': r.linkQ ?? '',
        'Lệch (Web − LinkQ)': r.diff ?? '',
        'Đã KK': `${r.checked}/${r.lines}`,
        'Vị trí': r.locs
      }));
    } else {
      rows = this.kkTypeDetailFiltered.map((m, i) => {
        const stock = this.calculateCurrentStock(m);
        const short = this.kkShortQtyOf(m) || 0;
        const age = this.kkAging(m);
        return {
          'STT': i + 1,
          'Mã hàng': m.materialCode,
          'Tên hàng': this.getKkMaterialName(m),
          'Có LinkQ': this.kkHasLinkQText(m.materialCode),
          'Tồn LinkQ (mã)': this.kkTypeLinkQMap?.get(this.normalizeTieuHuyCode(m.materialCode)) ?? '',
          ...(this.kkPendingPxk ? { 'PXK chưa xuất (mã)': this.kkPendingPxk.get(String(m.materialCode || '').trim().toUpperCase())?.qty ?? '' } : {}),
          ...(this.kkPendingPxk ? { 'Chênh lệch dòng (Web − (LinkQ + PXK))': this.kkPxkDiffOf(m) ?? '' } : {}),
          'PO': m.poNumber || '',
          ...(this.kkPoCheckCols ? (() => {
            const lq = this.kkPoCheckLinkQ(m);
            return {
              'PO LinkQ': lq.match ? lq.items[0].po : '',
              'Lượng PO LinkQ': lq.match ? lq.items[0].qty : ''
            };
          })() : {}),
          'IMD': this.getDisplayIMD(m),
          'Aging (tháng)': age ? age.months : '',
          'QC': m.iqcStatus || '',
          'Tồn kho': stock,
          'Vị trí': this.primaryLocationDisplay(m.location) || '',
          ...(this.kkThMode ? {
            'TH (lượng tiêu hủy)': this.thItemOf(m.materialCode)?.qty ?? '',
            'Tùy chọn TH': this.thOptions.find((o) => o.value === this.thItemOf(m.materialCode)?.option)?.label.replace('—', '') || '',
            'Lượng hàng TH': this.thItemOf(m.materialCode)?.actualQty ?? ''
          } : {}),
          'Kho': 'J',
          'Pallet': m.palletId || '',
          'Standard': this.getEffectiveStandardPacking(m) || '',
          'Cuộn': this.getKkRollsText(m),
          'Lượng quét': `${this.getKkScanQty(m)} / ${this.calculateCurrentStock(m)}`,
          'KK': this.isKkFlagOn(m.kkChecked) ? 'Có' : '',
          'Thời gian KK': this.kkTickTimeText(m),
          'Người KK': this.kkTickByText(m),
          'Ghi chú': this.getKkTypePalletNote(m) || '',
          'Cảnh báo': warnLabel.get(this.kkWarningOf(m)) || '',
          'Lượng thiếu': short || '',
          '% thiếu': short && stock > 0 ? Math.round((short / stock) * 1000) / 10 : '',
          'Lượng dư': this.kkExcessQtyOf(m) || ''
        };
      });
    }
    return rows;
  }

  async printKkTypeDetail(withHistory = true): Promise<void> {
    if (!this.kkActiveProductType) return;
    const win = window.open('', '_blank');
    if (!win) { appAlert('Trình duyệt chặn cửa sổ in — cho phép popup rồi thử lại.'); return; }
    await this.ensureKkTypeLinkQ();
    const rows = this.kkTypeDetailExportRows();
    const esc = (v: unknown) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    // Bản in gọn: bỏ các cột ít dùng khi kiểm trên giấy
    const hidden = new Set(['Tên hàng', 'Kho', 'Pallet', 'Standard', 'Cuộn', 'Lượng quét', 'Ghi chú', 'Cảnh báo', '% thiếu']);
    // Không lịch sử: bỏ cột Thời gian / Người KK, cột KK để trống (giấy kiểm mới)
    if (!withHistory) {
      hidden.add('Thời gian KK');
      hidden.add('Người KK');
      rows.forEach((r) => { if ('KK' in r) r['KK'] = ''; });
    }
    const cols = rows.length ? Object.keys(rows[0]).filter((c) => !hidden.has(c)) : [];
    const fmt = (v: unknown) => typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(v ?? '');
    const title = `${this.kkActiveProductType} — ${this.selectedFactory}`;
    const when = new Date().toLocaleString('vi-VN', { hour12: false });
    // Mỗi trang A4 ngang đúng 30 dòng, chữ to dễ đọc; mỗi trang lặp tiêu đề + hàng tên cột
    const PER_PAGE = 30;
    const pages: Array<Array<Record<string, unknown>>> = [];
    for (let i = 0; i < rows.length; i += PER_PAGE) pages.push(rows.slice(i, i + PER_PAGE));
    if (!pages.length) pages.push([]);
    const head = `<tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
    const body = pages.map((pg, pi) => `
<section class="page">
  <div class="top"><h1>${esc(title)}</h1><span class="meta">${rows.length} dòng · in lúc ${esc(when)}${this.kkTypeByCodeView ? ' · xem theo mã LinkQ' : ''} · Trang ${pi + 1}/${pages.length}</span></div>
  <table><thead>${head}</thead><tbody>${pg.map((r) => `<tr>${cols.map((c) => `<td class="${typeof r[c] === 'number' ? 'n' : ''}">${esc(fmt(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody></table>
</section>`).join('');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4 landscape; margin: 7mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; color: #000; margin: 0; }
  .page { page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin: 0 0 2mm; }
  h1 { font-size: 15px; margin: 0; }
  .meta { font-size: 11px; color: #333; white-space: nowrap; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; table-layout: auto; }
  th, td { border: 1px solid #444; padding: 0 4px; height: 5.75mm; line-height: 1.15; text-align: left; vertical-align: middle;
    white-space: nowrap; overflow: hidden; }
  th { background: #e6e6e6; font-weight: 700; font-size: 11.5px; }
  td.n { text-align: right; }
</style></head><body>${body}
<script>window.onload = function () { setTimeout(function () { window.print(); }, 300); };<\/script>
</body></html>`);
    win.document.close();
  }

  async downloadKkTypeDetail(): Promise<void> {
    if (this.denyAction('export')) return;
    if (this.kkTypeDetailExportBusy || !this.kkActiveProductType) return;
    this.kkTypeDetailExportBusy = true;
    this.cdr.detectChanges();
    try {
      await this.ensureKkTypeLinkQ();
      const rows = this.kkTypeDetailExportRows();
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), this.kkTypeByCodeView ? 'Theo mã LinkQ' : 'Chi tiết');
      const safe = String(this.kkActiveProductType).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
      XLSX.writeFile(wb, `KK_${this.selectedFactory}_${safe}_${this.toDateKey(new Date())}.xlsx`);
    } catch (e) {
      console.error('downloadKkTypeDetail:', e);
      appAlert('❌ Không tải được file.');
    } finally {
      this.kkTypeDetailExportBusy = false;
      this.cdr.detectChanges();
    }
  }

  kkAccountingExportBusy = false;

  /**
   * File Excel "Kế toán KK" để in: mọi dòng đang lọc của mục, cột Thực tế để trống điền tay,
   * Chênh lệch = Thực tế − Tồn sổ (công thức), ký tên cuối trang. A4 dọc, vừa 1 trang ngang, lặp tiêu đề cột.
   */
  async downloadKkAccounting(): Promise<void> {
    if (this.denyAction('export')) return;
    if (this.kkAccountingExportBusy || !this.kkActiveProductType) return;
    const lines = this.kkTypeDetailFiltered;
    if (!lines.length) {
      appAlert('Không có dòng nào để xuất.');
      return;
    }
    this.kkAccountingExportBusy = true;
    this.cdr.detectChanges();
    try {
      const ExcelJS: any = await import('exceljs');
      const wb = new (ExcelJS.Workbook || ExcelJS.default.Workbook)();
      const ws = wb.addWorksheet('Kế toán KK', {
        pageSetup: {
          paperSize: 9,
          orientation: 'portrait',
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
          horizontalCentered: true,
          margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.5, header: 0.2, footer: 0.2 }
        },
        headerFooter: { oddFooter: '&LKế toán KK &CTrang &P / &N' }
      });
      const cols = [
        { h: 'STT', w: 5 },
        { h: 'Mã hàng', w: 11 },
        { h: 'Tên hàng', w: 30 },
        { h: 'PO', w: 15 },
        { h: 'IMD', w: 10 },
        { h: 'Vị trí', w: 10 },
        { h: 'ĐVT', w: 6 },
        { h: 'Tồn sổ', w: 11 },
        { h: 'Thực tế KK', w: 11 },
        { h: 'Chênh lệch', w: 11 },
        { h: 'Ghi chú', w: 16 }
      ];
      ws.columns = cols.map((c) => ({ width: c.w }));
      const last = String.fromCharCode(64 + cols.length);
      const thin = { style: 'thin', color: { argb: 'FF000000' } };
      const box = { top: thin, left: thin, bottom: thin, right: thin };

      const date = new Date();
      const dd = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
      ws.mergeCells(`A1:${last}1`);
      ws.getCell('A1').value = 'BIÊN BẢN KIỂM KÊ NGUYÊN VẬT LIỆU';
      ws.getCell('A1').font = { bold: true, size: 15 };
      ws.getCell('A1').alignment = { horizontal: 'center' };
      ws.mergeCells(`A2:${last}2`);
      ws.getCell('A2').value = `Nhà máy: ${this.selectedFactory}   ·   Mục: ${this.kkActiveProductType}   ·   Ngày kiểm: ${dd}   ·   ${lines.length} dòng`;
      ws.getCell('A2').alignment = { horizontal: 'center' };
      ws.getRow(3).height = 6;

      const head = ws.getRow(4);
      cols.forEach((c, i) => {
        const cell = head.getCell(i + 1);
        cell.value = c.h;
        cell.font = { bold: true };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6E6E6' } };
        cell.border = box;
      });
      head.height = 20;
      ws.pageSetup.printTitlesRow = '4:4';
      ws.views = [{ state: 'frozen', ySplit: 4 }];

      const sorted = [...lines].sort((a, b) =>
        String(a.materialCode || '').localeCompare(String(b.materialCode || '')) ||
        String(a.poNumber || '').localeCompare(String(b.poNumber || '')));
      sorted.forEach((m, i) => {
        const r = 5 + i;
        const row = ws.getRow(r);
        const vals = [
          i + 1,
          m.materialCode || '',
          this.getKkMaterialName(m) || '',
          m.poNumber || '',
          this.getDisplayIMD(m),
          this.primaryLocationDisplay(m.location) || '',
          (m as any).unit || '',
          Math.round(this.calculateCurrentStock(m) * 10000) / 10000,
          null,
          null,
          ''
        ];
        vals.forEach((v, ci) => {
          const cell = row.getCell(ci + 1);
          cell.value = v;
          cell.border = box;
          cell.alignment = { vertical: 'middle', wrapText: ci === 2 };
        });
        row.getCell(10).value = { formula: `IF(I${r}="","",I${r}-H${r})` };
        [8, 9, 10].forEach((ci) => (row.getCell(ci).numFmt = '#,##0.####'));
        row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
        row.height = 18;
      });

      const end = 5 + sorted.length;
      const total = ws.getRow(end);
      ws.mergeCells(`A${end}:G${end}`);
      total.getCell(1).value = 'TỔNG CỘNG';
      total.getCell(1).alignment = { horizontal: 'right' };
      total.getCell(8).value = { formula: `SUM(H5:H${end - 1})` };
      total.getCell(9).value = { formula: `IF(COUNT(I5:I${end - 1})=0,"",SUM(I5:I${end - 1}))` };
      total.getCell(10).value = { formula: `IF(I${end}="","",I${end}-H${end})` };
      for (let ci = 1; ci <= cols.length; ci++) {
        total.getCell(ci).border = box;
        total.getCell(ci).font = { bold: true };
        if (ci >= 8 && ci <= 10) total.getCell(ci).numFmt = '#,##0.####';
      }

      const sign = end + 3;
      const signs: Array<[string, string]> = [['A', 'C'], ['D', 'G'], ['H', last]];
      ['Người kiểm kê', 'Kế toán', 'Thủ kho'].forEach((label, i) => {
        const [a, b] = signs[i];
        ws.mergeCells(`${a}${sign}:${b}${sign}`);
        ws.getCell(`${a}${sign}`).value = label;
        ws.getCell(`${a}${sign}`).font = { bold: true };
        ws.getCell(`${a}${sign}`).alignment = { horizontal: 'center' };
        ws.mergeCells(`${a}${sign + 1}:${b}${sign + 1}`);
        ws.getCell(`${a}${sign + 1}`).value = '(Ký, ghi rõ họ tên)';
        ws.getCell(`${a}${sign + 1}`).font = { italic: true, size: 9 };
        ws.getCell(`${a}${sign + 1}`).alignment = { horizontal: 'center' };
      });
      ws.pageSetup.printArea = `A1:${last}${sign + 5}`;

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safe = String(this.kkActiveProductType).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);
      link.href = url;
      link.download = `KeToan_KK_${this.selectedFactory}_${safe}_${this.toDateKey(date)}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      console.error('downloadKkAccounting:', e);
      appAlert('❌ Không tạo được file Kế toán KK.');
    } finally {
      this.kkAccountingExportBusy = false;
      this.cdr.detectChanges();
    }
  }

  trackKkByCode(_: number, r: KkTypeByCodeRow): string {
    return r.code;
  }

  /** Mã đang xổ trong "Xem theo mã LinkQ" (bấm mã khác → mã cũ thu lại). */
  kkByCodeOpen: string | null = null;

  toggleKkByCodeOpen(code: string): void {
    this.kkByCodeOpen = this.kkByCodeOpen === code ? null : code;
  }

  /** Các dòng PO / IMD của mã đang xổ (cũ nhất trước theo aging PO). */
  get kkByCodeOpenLines(): InventoryMaterial[] {
    const code = this.kkByCodeOpen;
    if (!code) return [];
    return this.kkTypeDetailFiltered
      .filter((m) => String(m.materialCode || '').trim().toUpperCase() === code)
      .sort((a, b) => (this.kkAging(b)?.months ?? -1) - (this.kkAging(a)?.months ?? -1));
  }
  kkWarnReportLoading = false;
  kkWarnReportError = '';
  kkWarnReportOpen: string | null = null;
  kkWarnReportTotalCodes = 0;
  kkWarnReportGroups: Array<{
    key: string;
    label: string;
    codes: number;
    shortQty: number;
    lines: Array<{ code: string; po: string; loc: string; stock: number; short: number; by: string }>;
  }> = [];

  /** Chỉ đọc các dòng có cảnh báo / lượng thiếu (không quét cả kho). */
  async openKkWarnReport(): Promise<void> {
    this.showKkWarnReport = true;
    this.kkWarnReportOpen = null;
    this.kkWarnReportLoading = true;
    this.kkWarnReportError = '';
    this.cdr.detectChanges();
    try {
      const col = this.firestore.firestore.collection('inventory-materials');
      const [warnSnap, shortSnap] = await Promise.all([
        col.where('kkWarning', 'in', this.kkWarningOptions.map((o) => o.value)).get(),
        col.where('kkShortQty', '>', 0).get()
      ]);
      const factory = this.selectedFactory;
      const docs = new Map<string, any>();
      [...warnSnap.docs, ...shortSnap.docs].forEach((d) => docs.set(d.id, d));
      const groups = new Map<string, { label: string; codes: Set<string>; shortQty: number; lines: any[] }>();
      const labelOf = new Map(this.kkWarningOptions.map((o) => [o.value, o.label] as [string, string]));
      const all = new Set<string>();
      docs.forEach((d) => {
        const data = d.data() as any;
        if (String(data.factory || '').trim().toUpperCase() !== factory) return;
        const code = String(data.materialCode || '').trim().toUpperCase();
        if (!code) return;
        const warn = String(data.kkWarning || '');
        const short = Math.max(0, Number(data.kkShortQty) || 0);
        const key = warn && labelOf.has(warn) ? warn : (short ? 'chi-luong-thieu' : '');
        if (!key) return;
        const g = groups.get(key) || {
          label: labelOf.get(key) || 'Chỉ nhập lượng thiếu',
          codes: new Set<string>(),
          shortQty: 0,
          lines: []
        };
        g.codes.add(code);
        g.shortQty += short;
        g.lines.push({
          code,
          po: String(data.poNumber || ''),
          loc: this.primaryLocationDisplay(this.locationFromInventoryDoc(data)),
          stock: this.stockFromInventoryDoc(data),
          short,
          by: String((warn ? data.kkWarningBy : data.kkShortBy) || data.kkShortBy || '').trim().toUpperCase()
        });
        groups.set(key, g);
        all.add(code);
      });
      const order = [...this.kkWarningOptions.map((o) => o.value), 'chi-luong-thieu'];
      this.kkWarnReportGroups = order
        .filter((k) => groups.has(k) || labelOf.has(k))
        .map((k) => {
          const g = groups.get(k);
          return {
            key: k,
            label: g?.label || labelOf.get(k) || k,
            codes: g?.codes.size || 0,
            shortQty: Math.round((g?.shortQty || 0) * 10000) / 10000,
            lines: (g?.lines || []).sort((a, b) => a.code.localeCompare(b.code))
          };
        });
      this.kkWarnReportTotalCodes = all.size;
      this.readTracker.track('materials', 'inventory-materials', warnSnap.size + shortSnap.size);
    } catch (e) {
      console.error('openKkWarnReport:', e);
      this.kkWarnReportError = 'Không đọc được dữ liệu cảnh báo. Thử lại.';
    } finally {
      this.kkWarnReportLoading = false;
      this.cdr.detectChanges();
    }
  }

  kkFullReportBusy = false;
  kkFullReportStatus = '';

  /**
   * Tải report Excel toàn bộ mã hàng: mỗi dòng tồn (mã + PO + IMD) kèm so sánh LinkQ theo mã,
   * cảnh báo, lượng thiếu, % thiếu, vị trí và thông tin NVL. Sheet 2 gộp theo mã.
   */
  async downloadKkFullReport(): Promise<void> {
    if (this.kkFullReportBusy) return;
    this.kkFullReportBusy = true;
    const setStatus = (t: string) => { this.kkFullReportStatus = t; this.cdr.detectChanges(); };
    try {
      setStatus('Đang đọc tồn kho…');
      const factory = this.selectedFactory;
      const [docs, pack] = await Promise.all([
        this.getKkFactoryDocs(factory),
        this.getLinkQPackCached(false).catch(() => ({ map: new Map<string, number>(), label: 'Không đọc được LinkQ' }))
      ]);
      const lines = docs
        .map((d) => this.mapKkInventoryDoc(d))
        .map((m, i) => {
          const data = docs[i]?.data ? docs[i].data() : docs[i];
          m.kkChecked = this.isKkFlagOn(data?.kkChecked);
          return m;
        })
        .filter((m) => this.calculateCurrentStock(m) > 0 && String(m.materialCode || '').trim());
      setStatus('Đang lấy thông tin NVL…');
      await this.ensureCatalogForMaterialCodes(lines.map((m) => m.materialCode));
      const linkQ = pack.map;
      const warnLabel = new Map(this.kkWarningOptions.map((o) => [o.value, o.label] as [string, string]));
      const webByCode = new Map<string, number>();
      for (const m of lines) {
        const code = m.materialCode.trim().toUpperCase();
        webByCode.set(code, (webByCode.get(code) || 0) + this.calculateCurrentStock(m));
      }
      const r4 = (n: number) => Math.round(n * 10000) / 10000;
      const linkQOf = (code: string) => {
        const key = this.normalizeTieuHuyCode(code);
        return linkQ.has(key) ? Number(linkQ.get(key)) : null;
      };
      setStatus('Đang tạo file…');
      const detail = lines
        .sort((a, b) => a.materialCode.localeCompare(b.materialCode) || String(a.poNumber || '').localeCompare(String(b.poNumber || '')))
        .map((m) => {
          const code = m.materialCode.trim().toUpperCase();
          const cat = this.catalogCache.get(code);
          const stock = r4(this.calculateCurrentStock(m));
          const short = this.kkShortQtyOf(m) || 0;
          const webCode = r4(webByCode.get(code) || 0);
          const q = linkQOf(code);
          const age = this.kkAging(m);
          return {
            'Mã hàng': code,
            'Tên hàng': this.getKkMaterialName(m),
            'Đơn vị': String(cat?.unit || m.unit || ''),
            'Standard Packing': this.getEffectiveStandardPacking(m) || '',
            'MSD/ESD': this.getMsdEsdLabel(code) || '',
            'Loại hàng': this.kkTypeOrGroupOfMaterial(code),
            'Kiểm 100%': this.isK100(code) ? 'Có' : '',
            'PO': m.poNumber || '',
            'IMD': this.getDisplayIMD(m),
            'Aging (tháng)': age ? age.months : '',
            'Tồn web (dòng)': stock,
            'Tồn web (tổng mã)': webCode,
            'Tồn LinkQ (mã)': q == null ? '' : q,
            'Lệch mã (Web − LinkQ)': q == null ? '' : r4(webCode - q),
            'Vị trí': this.primaryLocationDisplay(m.location) || '',
            'Pallet': m.palletId || '',
            'IQC': m.iqcStatus || '',
            'Đã KK': this.isKkFlagOn(m.kkChecked) ? 'Có' : '',
            'Người KK': this.kkTickByText(m),
            'Thời gian KK': this.kkTickTimeText(m),
            'Cảnh báo': warnLabel.get(this.kkWarningOf(m)) || '',
            'Lượng thiếu': short || '',
            '% thiếu': short && stock > 0 ? Math.round((short / stock) * 1000) / 10 : '',
            'Báo cáo': this.invReportOptions.find((o) => o.value === this.invReportOf(m))?.label || '',
            'Lưu ý': m.remarks || ''
          };
        });
      const byCode = new Map<string, any>();
      for (const row of detail) {
        const cur = byCode.get(row['Mã hàng']) || {
          'Mã hàng': row['Mã hàng'],
          'Tên hàng': row['Tên hàng'],
          'Đơn vị': row['Đơn vị'],
          'Standard Packing': row['Standard Packing'],
          'Loại hàng': row['Loại hàng'],
          'Số dòng': 0,
          'Aging lớn nhất (tháng)': '',
          'Tồn web': row['Tồn web (tổng mã)'],
          'Tồn LinkQ': row['Tồn LinkQ (mã)'],
          'Lệch (Web − LinkQ)': row['Lệch mã (Web − LinkQ)'],
          'Đã KK (dòng)': 0,
          'Cảnh báo': new Set<string>(),
          'Lượng thiếu': 0,
          '% thiếu': '',
          'Vị trí': new Set<string>()
        };
        cur['Số dòng'] += 1;
        if (row['Aging (tháng)'] !== '' && (cur['Aging lớn nhất (tháng)'] === '' || row['Aging (tháng)'] > cur['Aging lớn nhất (tháng)'])) {
          cur['Aging lớn nhất (tháng)'] = row['Aging (tháng)'];
        }
        if (row['Đã KK']) cur['Đã KK (dòng)'] += 1;
        if (row['Cảnh báo']) cur['Cảnh báo'].add(row['Cảnh báo']);
        cur['Lượng thiếu'] = r4(cur['Lượng thiếu'] + (Number(row['Lượng thiếu']) || 0));
        if (row['Vị trí']) cur['Vị trí'].add(row['Vị trí']);
        byCode.set(row['Mã hàng'], cur);
      }
      const summary = Array.from(byCode.values()).map((c) => ({
        ...c,
        'Cảnh báo': Array.from(c['Cảnh báo']).join(', '),
        'Lượng thiếu': c['Lượng thiếu'] || '',
        '% thiếu': c['Lượng thiếu'] && c['Tồn web'] > 0 ? Math.round((c['Lượng thiếu'] / c['Tồn web']) * 1000) / 10 : '',
        'Vị trí': Array.from(c['Vị trí']).sort().join(', ')
      }));
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Theo mã');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), 'Chi tiết PO-IMD');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
        { 'Thông tin': 'Nhà máy', 'Giá trị': factory },
        { 'Thông tin': 'Thời điểm', 'Giá trị': new Date().toLocaleString('vi-VN', { hour12: false }) },
        { 'Thông tin': 'File LinkQ', 'Giá trị': pack.label },
        { 'Thông tin': 'Số mã', 'Giá trị': summary.length },
        { 'Thông tin': 'Số dòng tồn', 'Giá trị': detail.length }
      ]), 'Thông tin');
      const day = this.toDateKey(new Date());
      XLSX.writeFile(wb, `Report_NVL_${factory}_${day}.xlsx`);
    } catch (e) {
      console.error('downloadKkFullReport:', e);
      appAlert('❌ Không tạo được report. Thử lại.');
    } finally {
      this.kkFullReportBusy = false;
      this.kkFullReportStatus = '';
      this.cdr.detectChanges();
    }
  }

  /** Cột Lượng thiếu: số lượng thiếu khi kiểm kê (0 / trống = không thiếu). */
  kkShortQtyOf(line: InventoryMaterial): number | null {
    const n = Number((line as any)?.kkShortQty);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /** % thiếu = lượng thiếu ÷ tồn kho của dòng. */
  kkShortPctText(line: InventoryMaterial): string {
    const short = this.kkShortQtyOf(line);
    if (!short) return '—';
    const stock = this.calculateCurrentStock(line);
    if (!(stock > 0)) return '—';
    return `${(Math.round((short / stock) * 1000) / 10).toLocaleString('vi-VN')}%`;
  }

  /** Cột Lượng dư: số lượng dư khi kiểm kê (0 / trống = không dư). */
  kkExcessQtyOf(line: InventoryMaterial): number | null {
    const n = Number((line as any)?.kkExcessQty);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  async saveKkExcessQty(line: InventoryMaterial, raw: string): Promise<void> {
    if (!this.canEdit || !line?.id) return;
    const n = Math.max(0, Math.round((Number(String(raw ?? '').replace(',', '.')) || 0) * 10000) / 10000);
    const prev = this.kkExcessQtyOf(line) || 0;
    if (n === prev) return;
    (line as any).kkExcessQty = n;
    this.cdr.detectChanges();
    try {
      const by = await this.resolveLocationOperatorId();
      await this.firestore.firestore.collection('inventory-materials').doc(line.id).update({
        kkExcessQty: n,
        kkExcessBy: n ? by : '',
        kkExcessAt: firebase.default.firestore.FieldValue.serverTimestamp()
      });
      this.patchKkInvSnapCache(line.id, { kkExcessQty: n, kkExcessBy: n ? by : '' });
    } catch (e) {
      console.error('❌ saveKkExcessQty:', e);
      (line as any).kkExcessQty = prev;
      appAlert('❌ Không lưu được lượng dư.');
    } finally {
      this.cdr.detectChanges();
    }
  }

  async saveKkShortQty(line: InventoryMaterial, raw: string): Promise<void> {
    if (!this.canEdit || !line?.id) return;
    const n = Math.max(0, Math.round((Number(String(raw ?? '').replace(',', '.')) || 0) * 10000) / 10000);
    const prev = this.kkShortQtyOf(line) || 0;
    if (n === prev) return;
    (line as any).kkShortQty = n;
    this.cdr.detectChanges();
    try {
      const by = await this.resolveLocationOperatorId();
      await this.firestore.firestore.collection('inventory-materials').doc(line.id).update({
        kkShortQty: n,
        kkShortBy: n ? by : '',
        kkShortAt: firebase.default.firestore.FieldValue.serverTimestamp()
      });
      this.patchKkInvSnapCache(line.id, { kkShortQty: n, kkShortBy: n ? by : '' });
    } catch (e) {
      console.error('❌ saveKkShortQty:', e);
      (line as any).kkShortQty = prev;
      appAlert('❌ Không lưu được lượng thiếu.');
    } finally {
      this.cdr.detectChanges();
    }
  }

  async saveKkDetailPallet(line: InventoryMaterial): Promise<void> {
    if (!this.canEdit || this.kkLocMapBusy || !line?.id) return;
    await this.persistPalletChange(line, String(line.palletId || ''), { silent: true, bypassUnlock: true });
    this.invalidateKkTypeViewCache();
  }

  /** Đổi số pallet: nhập pallet hiện tại → pallet mới, áp cho loại hàng đang mở. */
  async renameKkTypePallet(row: KkTypeRow): Promise<void> {
    if (!this.canEdit || this.kkLocMapBusy || !row) return;
    const fromRaw = window.prompt('Nhập số pallet hiện tại:');
    if (fromRaw == null) return;
    const from = String(fromRaw).trim().toUpperCase();
    if (!from) {
      appAlert('Chưa nhập số pallet hiện tại.');
      return;
    }

    const toRaw = window.prompt('Nhập số pallet mới:');
    if (toRaw == null) return;
    const to = String(toRaw).trim().toUpperCase();
    if (!to) {
      appAlert('Chưa nhập số pallet mới.');
      return;
    }
    if (from === to) {
      appAlert('Số pallet không đổi.');
      return;
    }

    const lines = this.kkLinesForTypeRow(row).filter(
      (m) => String(m.palletId || '').trim().toUpperCase() === from && !!m.id
    );
    if (!lines.length) {
      appAlert(`Không có dòng pallet ${from} trong loại hàng này.`);
      return;
    }
    if (!confirm(`Đổi pallet ${from} → ${to}?\n${lines.length} dòng loại ${row.productType}`)) return;

    this.kkLocMapBusy = true;
    this.cdr.detectChanges();
    try {
      const modifiedBy = await this.resolveLocationOperatorId();
      const chunkSize = 400;
      for (let i = 0; i < lines.length; i += chunkSize) {
        const chunk = lines.slice(i, i + chunkSize);
        const batch = this.firestore.firestore.batch();
        for (const m of chunk) {
          batch.update(this.firestore.collection('inventory-materials').doc(m.id!).ref, {
            palletId: to,
            updatedAt: new Date(),
            lastModified: firebase.default.firestore.FieldValue.serverTimestamp(),
            modifiedBy
          });
        }
        await batch.commit();
      }
      const ids = new Set(lines.map((m) => m.id));
      const stamp = (m: InventoryMaterial) => {
        if (!ids.has(m.id)) return;
        m.palletId = to;
        (m as { __prevPalletId?: string }).__prevPalletId = to;
      };
      this.kkLocMapTypeCache.forEach((list) => list.forEach(stamp));
      this.kkLocMapMaterialCache.forEach((list) => list.forEach(stamp));
      appAlert(`✅ Đã đổi pallet ${from} → ${to} (${lines.length} dòng).`);
    } catch (e) {
      console.error('❌ renameKkTypePallet:', e);
      appAlert('❌ Không đổi được số pallet.');
    } finally {
      this.kkLocMapBusy = false;
      this.cdr.detectChanges();
    }
  }

  kkTypePalletLabelName(row: KkTypeRow | null): string {
    if (!row) return '';
    const codes = this.kkTypeUniqueMaterialCodes(row);
    if (codes.length === 1) {
      const code = codes[0];
      const prefix = this.kkTypeCodePrefix(code);
      const abbr = this.kkTypeCustomerAbbr(this.nvlkhCustomerMap.get(code) || this.getCustomerForMaterial({ materialCode: code } as InventoryMaterial));
      if (prefix && abbr) return `${prefix}-${abbr}`;
      return code;
    }
    return String(row.productType || '').trim();
  }

  private kkTypeUniqueMaterialCodes(row: KkTypeRow): string[] {
    const set = new Set<string>();
    const lines = this.kkActiveProductType === row.productType
      ? this.kkTypeDetailAll
      : this.kkLinesForTypeRow(row).filter((m) => this.calculateCurrentStock(m) > 0);
    for (const m of lines) {
      const code = String(m.materialCode || '').trim().toUpperCase();
      if (code) set.add(code);
    }
    return Array.from(set);
  }

  private kkTypeCodePrefix(code: string): string {
    const c = String(code || '').replace(/\s/g, '').toUpperCase();
    const m = /^([ABR]\d{3})/.exec(c);
    return m ? m[1] : (c.length >= 4 ? c.slice(0, 4) : c);
  }

  private kkTypeCustomerAbbr(customer: string): string {
    const s = String(customer || '').trim();
    if (!s || /^shared$/i.test(s)) return '';
    const first = (s.split(/[\s/_-]+/).filter(Boolean)[0] || s).trim();
    return first.slice(0, 8).toUpperCase();
  }

  async printKkTypePalletLabel(row: KkTypeRow): Promise<void> {
    if (!row || this.kkTypePrintBusy) return;
    try {
      if (!this.nvlkhCustomerMap.size) {
        this.nvlkhCustomerMap = await this.nvlkhCatalog.loadAllAsMap();
      }
    } catch {
      /* in vẫn được nếu không có khách hàng */
    }
    const name = this.kkTypePalletLabelName(row);
    if (!name) {
      appAlert('Chưa có tên pallet để in.');
      return;
    }
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      appAlert('Trình duyệt chặn cửa sổ in. Cho phép popup và thử lại.');
      return;
    }
    this.kkTypePrintBusy = true;
    this.cdr.detectChanges();
    try {
      const QRCode = await import('qrcode') as any;
      const qrDataUrl = await QRCode.toDataURL(name, {
        width: 640,
        margin: 1,
        color: { dark: '#000000', light: '#FFFFFF' }
      });
      const esc = (s: string) => this.escapeHtmlForPrint(s);
      const typeName = String(row.productType || '').trim();
      printWindow.document.open();
      printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${esc(name)}</title>
  <style>
    @page { size: 100mm 100mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100mm;
      height: 100mm;
      font-family: Arial, Helvetica, sans-serif;
      color: #000;
      background: #fff;
    }
    .label {
      width: 100mm;
      height: 100mm;
      padding: 5mm 4mm 4mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
    }
    .name {
      font-size: ${name.length > 14 ? '16pt' : '22pt'};
      font-weight: 800;
      letter-spacing: 0.4px;
      text-align: center;
      line-height: 1.15;
      word-break: break-word;
      max-width: 92mm;
    }
    .qr img {
      width: 58mm;
      height: 58mm;
      display: block;
    }
    .meta {
      font-size: 8pt;
      font-weight: 700;
      text-align: center;
      color: #222;
    }
  </style>
</head>
<body>
  <div class="label">
    <div class="name">${esc(name)}</div>
    <div class="qr"><img src="${qrDataUrl}" alt="QR"></div>
    <div class="meta">${esc(typeName && typeName !== name ? typeName : 'Pallet label')} · ${esc(this.selectedFactory)}</div>
  </div>
  <script>
    window.onload = function() { setTimeout(function() { window.print(); }, 250); };
  </script>
</body>
</html>`);
      printWindow.document.close();
    } catch (e) {
      console.error('❌ printKkTypePalletLabel:', e);
      try { printWindow.close(); } catch { /* ignore */ }
      appAlert('Không in được tem pallet.');
    } finally {
      this.kkTypePrintBusy = false;
      this.cdr.detectChanges();
    }
  }

  get kkTypeScanOpUntilLabel(): string {
    if (!this.kkTypeScanOpUntil) return '';
    const h = this.kkTypeScanOpUntil.getHours();
    const m = this.kkTypeScanOpUntil.getMinutes();
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  openKkScanGuide(): void {
    this.showKkScanGuide = true;
    this.kkScanGuideSending = false;
    this.kkScanGuideSendMsg = '';
    this.kkScanGuideSendErr = false;
  }

  closeKkScanGuide(): void {
    this.showKkScanGuide = false;
  }

  async sendKkScanGuideToZalo(): Promise<void> {
    if (this.kkScanGuideSending) return;
    this.kkScanGuideSending = true;
    this.kkScanGuideSendMsg = '';
    this.kkScanGuideSendErr = false;
    this.cdr.detectChanges();
    try {
      const user = await firstValueFrom(this.authService.currentUser);
      const sentBy = String(user?.employeeId || this.kkTypeScanOperator || '').trim().toUpperCase();
      const r = await this.kkScanGuideZalo.sendToKhoGroup(sentBy);
      this.kkScanGuideSendErr = false;
      this.kkScanGuideSendMsg =
        r?.images > 0
          ? `Đã gửi ${r.images} hình + hướng dẫn vào nhóm Quản lý kho.`
          : 'Đã gửi hướng dẫn vào nhóm Quản lý kho.';
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string; error?: { message?: string; status?: string } };
      const raw = String(err?.error?.message || err?.message || '').trim();
      const lower = raw.toLowerCase();
      this.kkScanGuideSendErr = true;
      if (
        lower.includes('cors') ||
        lower.includes('err_failed') ||
        lower.includes('not-found') ||
        err?.code === 'functions/not-found' ||
        err?.error?.status === 'NOT_FOUND' ||
        raw === 'internal' ||
        err?.code === 'functions/internal'
      ) {
        this.kkScanGuideSendMsg =
          'Chưa gửi được vào nhóm Quản lý kho. Thử lại sau.';
      } else {
        this.kkScanGuideSendMsg =
          raw || 'Không gửi được Zalo vào nhóm Quản lý kho. Thử lại.';
      }
    } finally {
      this.kkScanGuideSending = false;
      this.cdr.detectChanges();
    }
  }

  get kkTypeScanModalTitle(): string {
    return this.kkTypeScanMode === 'inventory' ? 'Scan kiểm kê' : 'Cập nhật vị trí';
  }

  setKkTypeScanUiTab(tab: 'scan' | 'shelf' | 'log'): void {
    this.kkTypeScanUiTab = tab;
    this.cdr.detectChanges();
    if (tab === 'scan') {
      if (this.kkTypeScanStep === 'location') this.focusKkTypeScanInput('kkTypeScanLocationInput');
      else if (this.kkTypeScanStep === 'codes') this.focusKkTypeScanInput('kkTypeScanQrInput');
    } else if (tab === 'shelf' && this.kkTypeScanStep === 'codes') {
      // giữ kệ hiện tại — chỉ xem / đổi qua nút
    }
  }

  get kkTypeScanStageTitle(): string {
    if (this.kkTypeScanStep === 'location') return 'Quét kệ S/R';
    if (this.kkTypeScanStep === 'codes') return 'Quét mã hàng (mã · PO · IMD)';
    return 'Nhập mã nhân viên';
  }

  get kkTypeScanStageSub(): string {
    if (this.kkTypeScanStep === 'location') {
      return 'Bắn tem kệ S… / R… vào ô bằng máy scanner';
    }
    if (this.kkTypeScanStep === 'codes' && this.kkTypeScanLocation) {
      return `Kệ ${this.kkTypeScanLocation} · bắn tem mã hàng vào ô`;
    }
    return 'Bắn tem vào ô bằng máy scanner';
  }

  get kkTypeScanStepHint(): string {
    if (this.kkTypeScanStep === 'operator') {
      return 'Bước 1: Nhập tay mã nhân viên (ASP + 4 số).';
    }
    if (this.kkTypeScanStep === 'location') {
      return 'Bước 2: Scan kệ S/R — vd S16-1-1, R03, hoặc R10-1 (theo số pallet).';
    }
    if (this.kkTypeScanMode === 'location') {
      return 'Bước 3: Scan mã hàng — chuyển về kệ này, rồi scan mã tiếp.';
    }
    return 'Bước 3: Scan mã hàng — đọc mã, PO, IMD (không đọc lượng).';
  }

  get kkTypeScanProgressLabel(): string {
    if (this.kkTypeScanMode === 'inventory' && this.kkTypeScanMaterialCode && this.kkTypeScanCartonTotal) {
      return `${this.formatNumber(this.kkTypeScanQtyScanned)} / ${this.kkTypeScanCartonTotal} Box`;
    }
    const done = this.kkTypeScanOkCount;
    const total = done + this.kkTypeScanMissCount;
    if (total <= 0) return `${done} mã`;
    return `${done} / ${total} mã`;
  }

  get kkTypeScanProgressPct(): number {
    if (this.kkTypeScanMode === 'inventory' && this.kkTypeScanMaterialCode && this.kkTypeScanCartonTotal) {
      return Math.min(100, Math.round((this.kkTypeScanQtyScanned / this.kkTypeScanCartonTotal) * 100));
    }
    const done = this.kkTypeScanOkCount;
    const total = done + this.kkTypeScanMissCount;
    if (total <= 0) return 0;
    return Math.min(100, Math.round((done / total) * 100));
  }

  get kkTypeScanRecentLogs(): Array<{ id: number; ok: boolean; skip?: boolean; text: string; readMs?: number; saveMs?: number }> {
    return (this.kkTypeScanLogs || []).slice(0, 4);
  }

  closeKkTypeScanModal(): void {
    if (this.kkTypeScanBusy) return;
    if (this.nlCameraPurpose === 'kk') this.stopNlCamera();
    this.unlockKkScanKeyboard();
    this.showKkTypeScanModal = false;
    this.showKkTypeScanConfirm = false;
    this.kkTypeScanConfirm = null;
    this.kkTypeScanLocToast = null;
    if (this.kkTypeScanLocToastTimer) {
      clearTimeout(this.kkTypeScanLocToastTimer);
      this.kkTypeScanLocToastTimer = null;
    }
    this.kkTypeScanStep = 'location';
    this.kkTypeScanLocation = '';
    this.kkTypeScanLocationInput = '';
    this.kkTypeScanQrInput = '';
    this.kkTypeScanMaterialCode = '';
    this.kkTypeScanStandardDraft = '';
    this.kkTypeScanLogs = [];
    this.kkTypeScanExtraLines = [];
    this.kkTypeScanCartons = {};
    this.kkHidQrQueue = [];
    this.kkHidQrDraining = false;
    this.syncKkTypeRows();
  }

  acknowledgeKkTypeScanConfirm(): void {
    this.showKkTypeScanConfirm = false;
    this.kkTypeScanConfirm = null;
    this.kkHidQrQueue = [];
    this.nlScanLock = false;
    this.cdr.detectChanges();
    this.focusKkTypeScanInput('kkTypeScanQrInput');
  }

  backKkTypeScanToLocation(): void {
    this.kkTypeScanStep = 'location';
    this.kkTypeScanLocation = '';
    this.kkTypeScanLocationInput = '';
    this.kkTypeScanQrInput = '';
    this.kkTypeScanMaterialCode = '';
    this.kkTypeScanStandardDraft = '';
    this.kkTypeScanCartons = {};
    this.kkHidQrQueue = [];
    this.cdr.detectChanges();
    this.focusKkTypeScanInput('kkTypeScanLocationInput');
    setTimeout(() => {
      const el = document.getElementById('kkTypeScanLocationInput') as HTMLInputElement | null;
      if (el) {
        el.value = '';
        el.focus();
      }
    }, 80);
  }

  get kkTypeScanProgressTone(): '' | 'ok' | 'low' | 'over' {
    const scanned = this.kkTypeScanQtyScanned;
    const total = this.kkTypeScanCartonTotal;
    if (scanned <= 0) return '';
    if (!total) return 'low';
    if (scanned === total) return 'ok';
    return scanned < total ? 'low' : 'over';
  }

  get kkTypeScanStatusText(): string {
    const scanned = this.kkTypeScanQtyScanned;
    const total = this.kkTypeScanCartonTotal;
    if (!total) return scanned ? `Đã scan ${scanned} Box` : 'Chưa scan';
    if (scanned < total) return `Thiếu ${total - scanned} Box`;
    if (scanned > total) return `Thừa ${scanned - total} Box`;
    return 'Đủ Box';
  }

  get kkTypeScanAllTicked(): boolean {
    const rows = this.kkTypeScanCodeRows;
    return !!rows.length && rows.every((m) => this.isKkFlagOn(m.kkChecked));
  }

  async saveKkTypeScanStandard(): Promise<void> {
    const first = this.kkTypeScanCodeRows[0];
    if (!first) return;
    first.standardPacking = Math.max(0, Number(this.kkTypeScanStandardDraft) || 0);
    await this.saveKkTypeStandard(first);
    this.kkTypeScanStandardDraft = this.getEffectiveStandardPacking(first) || '';
    this.cdr.detectChanges();
  }

  async onKkTypeScanTickAll(checked: boolean): Promise<void> {
    const rows = this.kkTypeScanCodeRows;
    if (!rows.length) return;
    await this.applyKkTypeScanTick(rows, !!checked);
  }

  async onKkTypeScanRowTick(line: InventoryMaterial, checked: boolean): Promise<void> {
    if (!line) return;
    await this.applyKkTypeScanTick([line], !!checked);
  }

  private async applyKkTypeScanTick(lines: InventoryMaterial[], checked: boolean): Promise<void> {
    if (!this.canEdit || this.kkTypeScanBusy || this.denyAction('kkTick')) return;
    const next = !!checked;
    const targets = lines.filter((m) => !!m?.id && this.isKkFlagOn(m.kkChecked) !== next);
    if (!targets.length) {
      this.cdr.detectChanges();
      return;
    }
    if (!next) {
      const ok = confirm(targets.length > 1
        ? `Bỏ tick KK ${targets.length} dòng mã ${this.kkTypeScanMaterialCode}?`
        : `Bỏ tick KK mã ${this.kkTypeScanMaterialCode}?`);
      if (!ok) {
        this.cdr.detectChanges();
        return;
      }
    }
    const operator = next
      ? (this.kkTypeScanOperator || this.kkOperatorIdCache || await this.resolveKkOperatorId())
      : await this.resolveKkOperatorFromSession();
    if (!operator) {
      if (next && !this.kkTypeScanOperator) {
        this.kkTypeScanStep = 'operator';
        this.cdr.detectChanges();
        this.focusKkTypeScanInput('kkTypeScanOperatorInput');
      }
      return;
    }
    this.kkTypeScanOperator = operator;
    this.kkOperatorIdCache = operator;

    this.kkTypeScanBusy = true;
    this.cdr.detectChanges();
    const kkAt = new Date();
    try {
      const chunkSize = 400;
      for (let i = 0; i < targets.length; i += chunkSize) {
        const chunk = targets.slice(i, i + chunkSize);
        const batch = this.firestore.firestore.batch();
        for (const m of chunk) {
          const payload: Record<string, unknown> = {
            kkChecked: next,
            kkBy: operator,
            kkAt,
            updatedAt: new Date(),
            lastModified: firebase.default.firestore.FieldValue.serverTimestamp(),
            modifiedBy: operator
          };
          if (!next) { payload.kkScanCount = 0; payload.kkScanQty = 0; }
          batch.update(this.firestore.collection('inventory-materials').doc(m.id!).ref, payload);
        }
        await batch.commit();
        if (next) {
          const histBatch = this.firestore.firestore.batch();
          for (const m of chunk) {
            this.kkLogSet(histBatch, {
              inventoryDocId: m.id,
              factory: this.resolveKkFactoryForMaterial(m),
              materialCode: String(m.materialCode || '').trim().toUpperCase(),
              materialName: String(m.materialName || '').trim(),
              poNumber: String(m.poNumber || '').trim(),
              batchNumber: String(m.batchNumber || '').trim(),
              location: this.kkTypeScanLocation || String(m.location || '').trim().toUpperCase(),
              palletId: String(m.palletId || '').trim(),
              quantity: Number(m.quantity) || 0,
              stock: Number(this.calculateCurrentStock(m)) || 0,
              unit: String(m.unit || '').trim(),
              checkedBy: operator,
              checkedAt: kkAt,
              checkedDateKey: this.toDateKey(kkAt),
              createdAt: new Date(),
              source: 'kk-type-scan'
            });
          }
          await histBatch.commit();
        }
      }
      for (const m of targets) {
        m.kkChecked = next;
        m.kkBy = operator;
        m.kkAt = kkAt;
        if (!next) { m.kkScanCount = 0; m.kkScanQty = 0; }
        const stamp = (x: InventoryMaterial) => {
          if (x.id !== m.id) return;
          x.kkChecked = next;
          x.kkBy = operator;
          x.kkAt = kkAt;
          if (!next) { x.kkScanCount = 0; x.kkScanQty = 0; }
        };
        this.kkLocMapTypeCache.forEach((list) => list.forEach(stamp));
        this.kkLocMapMaterialCache.forEach((list) => list.forEach(stamp));
      }
      this.invalidateKkInvSnapCache();
      this.syncKkTypeRows();
      this.pushKkTypeScanLog(true, next
        ? `KK ${targets.length} dòng ${this.kkTypeScanMaterialCode}${this.kkTypeScanLocation ? ` · ${this.kkTypeScanLocation}` : ''}`
        : `Bỏ KK ${targets.length} dòng ${this.kkTypeScanMaterialCode}`);
      this.kkTypeScanBeep('ok');
    } catch (e) {
      console.error('❌ applyKkTypeScanTick:', e);
      this.pushKkTypeScanLog(false, 'Không lưu được tick KK');
      this.kkTypeScanBeep('err');
      appAlert('❌ Không lưu được tick KK.');
    } finally {
      this.kkTypeScanBusy = false;
      this.cdr.detectChanges();
      this.focusKkTypeScanInput('kkTypeScanQrInput');
    }
  }

  async saveKkDetailWarehouse(line: InventoryMaterial, value: string): Promise<void> {
    if (!this.canEdit || this.kkLocMapBusy || !line?.id) return;
    await this.commitWhChange(line, value, { silent: true, bypassUnlock: true });
    this.syncKkMaterialRows(String(line.materialCode || '').trim().toUpperCase());
    this.syncKkTypeRows();
    this.cdr.detectChanges();
  }

  /** So Lượng quét (cộng lượng trên tem) với tồn kho của dòng. */
  kkScanStockTone(material: InventoryMaterial): '' | 'ok' | 'low' | 'over' {
    const scanned = this.getKkScanQty(material);
    if (scanned <= 0) return '';
    const total = this.calculateCurrentStock(material);
    if (!(total > 0)) return 'over';
    if (Math.abs(scanned - total) < 1e-6) return 'ok';
    return scanned < total ? 'low' : 'over';
  }

  getKkScanCompareTitle(material: InventoryMaterial): string {
    const scanned = this.getKkScanQty(material);
    const total = this.calculateCurrentStock(material);
    const tone = this.kkScanStockTone(material);
    const f = (n: number) => this.formatNumber(Math.round(n * 10000) / 10000);
    const boxes = this.getKkScanCount(material);
    const boxNote = boxes ? ` · ${boxes} lần quét` : '';
    if (tone === 'ok') return `Đã quét ${f(scanned)} = tồn ${f(total)} — đủ${boxNote}`;
    if (tone === 'low') return `Đã quét ${f(scanned)} / tồn ${f(total)} — thiếu ${f(total - scanned)}${boxNote}`;
    if (tone === 'over') return `Đã quét ${f(scanned)} / tồn ${f(total)} — thừa ${f(scanned - total)}${boxNote}`;
    return `Chưa quét · tồn ${f(total)}`;
  }

  getKkRollsTitle(material: InventoryMaterial): string {
    const b = this.getKkStockBreakdown(material, this.getEffectiveStandardPacking(material));
    if (!b.sp) return 'Chưa có Standard Packing';
    if (b.oddBags) {
      return `${b.fullCount} cuộn chẵn × ${this.formatNumber(b.sp)} + 1 cuộn lẻ ${this.formatNumber(b.oddQty)}`;
    }
    return `${b.fullCount} cuộn × ${this.formatNumber(b.sp)}`;
  }

  async saveKkTypeStandard(material: InventoryMaterial): Promise<void> {
    if (!this.canEdit || this.kkLocMapBusy || !material) return;
    const code = String(material.materialCode || '').trim().toUpperCase();
    const sp = Math.max(0, Number(material.standardPacking) || 0);
    if (!code) return;
    const cat = this.catalogCache.get(code);
    const prev = this.getStandardPacking(code) || Number(cat?.standardPacking) || 0;
    if (Math.abs(sp - prev) < 1e-9) {
      this.applyKkStandardToCode(code, sp);
      return;
    }
    this.kkLocMapBusy = true;
    this.cdr.detectChanges();
    try {
      const live = await this.nvlCatalogFull.getByCode(code);
      if (live) {
        this.mergeNvlItemIntoCatalogCache(live);
        this.persistCatalogCache();
        if (live.standardPackingLocked === true) {
          appAlert('⚠️ Standard Packing của mã này đang Lock trên Danh mục NVL.');
          material.standardPacking = Number(live.standardPacking) || 0;
          this.applyKkStandardToCode(code, Number(live.standardPacking) || 0);
          return;
        }
      }
      const operator = await this.resolveKkOperatorFromSession();
      await this.nvlCatalogFull.update(code, { standardPacking: sp }, operator);
      this.mergeNvlItemIntoCatalogCache({
        materialCode: code,
        standardPacking: sp,
        standardPackingLocked: false,
        materialName: live?.materialName,
        unit: live?.unit,
        isMsd: live?.isMsd,
        isEsd: live?.isEsd
      });
      this.persistCatalogCache();
      this.applyKkStandardToCode(code, sp);
    } catch (e) {
      console.error('❌ saveKkTypeStandard:', e);
      appAlert('❌ Không lưu được Standard Packing lên danh mục.');
    } finally {
      this.kkLocMapBusy = false;
      this.cdr.detectChanges();
    }
  }

  private applyKkStandardToCode(code: string, sp: number): void {
    const apply = (m: InventoryMaterial) => {
      if (String(m.materialCode || '').trim().toUpperCase() === code) {
        m.standardPacking = sp;
      }
    };
    this.kkLocMapTypeCache.forEach((list) => list.forEach(apply));
    this.inventoryMaterials.forEach(apply);
    this.filteredInventory.forEach(apply);
    this.displayedInventory.forEach(apply);
    this.invalidateKkTypeViewCache();
  }

  async onKkDetailTick(line: InventoryMaterial, checked: boolean): Promise<void> {
    if (!this.canEdit || this.denyAction('kkTick') || this.kkLocMapBusy || !line?.id) {
      this.cdr.detectChanges();
      return;
    }
    const wantOn = !!checked;
    if (this.isKkFlagOn(line.kkChecked) === wantOn) return;
    await this.toggleKk(line);
    this.syncKkMaterialRows(String(line.materialCode || '').trim().toUpperCase());
    this.syncKkTypeRows();
    this.cdr.detectChanges();
  }

  /** Nhóm vị trí KK theo chữ cái đầu (A, B, C, D…). */
  kkLocFirstLetter(loc: string): string {
    if (this.kkWarehouseFromLocation(loc) === 'J') {
      const body = this.stripDoiKhoWhPrefix(String(loc || '')).trim().toUpperCase();
      if (isJWarehouseLocation(body) || isJWarehouseLocation(String(loc || ''))) {
        return body.startsWith('S') ? 'Kho J · S' : 'Kho J · R';
      }
      return 'Kho J';
    }
    const raw = String(loc || '').trim().toUpperCase();
    if (!raw || raw === '—') return '#';
    const body = raw.replace(/^(ASM3-|WH3-)/, '');
    const ch = body.charAt(0);
    return ch || '#';
  }

  get kkLocMapGroupedBoxes(): Array<{
    key: string;
    boxes: Array<{ loc: string; checked: number; total: number }>;
    checked: number;
    total: number;
  }> {
    const buckets = new Map<string, Array<{ loc: string; checked: number; total: number }>>();
    for (const box of this.kkLocMapFilteredBoxes) {
      const key = this.kkLocFirstLetter(box.loc);
      const list = buckets.get(key) || [];
      list.push(box);
      buckets.set(key, list);
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))
      .map(([key, boxes]) => {
        boxes.sort((x, y) => x.loc.localeCompare(y.loc, 'en', { numeric: true }));
        return {
          key,
          boxes,
          checked: boxes.reduce((n, b) => n + b.checked, 0),
          total: boxes.reduce((n, b) => n + b.total, 0)
        };
      });
  }

  kkLocBoxTone(box: { checked: number; total: number }): string {
    if (!box.total) return 'empty';
    if (box.checked >= box.total) return 'done';
    if (box.checked <= 0) return 'none';
    return 'partial';
  }

  onKkLocBoxClick(box: { loc: string }): void {
    const loc = String(box?.loc || '').trim();
    if (!loc || loc === '—') return;
    const rows = [...(this.kkLocMapRowCache.get(loc) || [])];
    if (this.isNguyenLieuPage) {
      void this.router.navigate(['/materials'], {
        queryParams: { factory: this.selectedFactory, location: loc }
      });
      return;
    }
    this.closeKkLocMap();
    this.showKkLocMapRows(loc, rows);
  }

  /** Hiện đúng bộ mã đã dùng để đếm ô KK — tồn > 0, chưa KK lên đầu. */
  private showKkLocMapRows(loc: string, rows: InventoryMaterial[]): void {
    this.searchByLocation = true;
    this.searchByCustomer = false;
    this.searchByKk = false;
    this.searchType = 'location';
    this.searchTerm = loc;
    this.showOnlyNegativeStock = false;
    this.inventoryMaterials = rows.map((row) => ({ ...row }));
    this.inventoryMaterials.sort((a, b) => {
      const ak = this.isKkFlagOn(a.kkChecked) ? 1 : 0;
      const bk = this.isKkFlagOn(b.kkChecked) ? 1 : 0;
      if (ak !== bk) return ak - bk;
      const codeCmp = this.compareMaterialCodesFIFO(
        String(a.materialCode || ''),
        String(b.materialCode || '')
      );
      if (codeCmp) return codeCmp;
      return String(a.poNumber || '').localeCompare(String(b.poNumber || ''), 'en', { numeric: true });
    });
    this.filteredInventory = [...this.inventoryMaterials];
    this.currentPage = 1;
    this.updatePagination();
    this.updateDisplayedInventory();
    this.updateNegativeStockCount();
    this.cdr.detectChanges();
    if (this.filteredInventory.length) {
      void this.refreshLastStatusForMaterials(this.filteredInventory);
    }
  }

  isKkMucStockLoaded(muc: { boxes: Array<any> }): boolean {
    if (this.kkStockLoaded) return true;
    return (muc?.boxes || []).every((b) => this.isKkTypeBoxStockLoaded(b));
  }

  async onKkByTypeTick(row: KkTypeRow, checked: boolean): Promise<void> {
    if (!this.canEdit || this.denyAction('kkTick') || this.kkLocMapBusy) {
      this.cdr.detectChanges();
      return;
    }
    const next = !!checked;
    const lines = this.kkLinesForTypeRow(row);
    const targets = lines.filter((m) => this.isKkFlagOn(m.kkChecked) !== next);
    if (!targets.length) {
      this.syncKkTypeRows();
      this.cdr.detectChanges();
      return;
    }
    if (!next) {
      const ok = confirm(`Bỏ tick KK mọi dòng loại hàng ${row.productType}?\n(${targets.length} dòng)`);
      if (!ok) {
        this.cdr.detectChanges();
        return;
      }
    }
    const operator = next
      ? await this.resolveKkOperatorId()
      : await this.resolveKkOperatorFromSession();
    if (!operator) {
      this.cdr.detectChanges();
      return;
    }

    this.kkLocMapBusy = true;
    this.cdr.detectChanges();
    const kkAt = new Date();
    try {
      const chunkSize = 400;
      for (let i = 0; i < targets.length; i += chunkSize) {
        const chunk = targets.slice(i, i + chunkSize);
        const batch = this.firestore.firestore.batch();
        for (const m of chunk) {
          batch.update(this.firestore.collection('inventory-materials').doc(m.id!).ref, {
            kkChecked: next,
            kkBy: operator,
            kkAt,
            updatedAt: new Date(),
            ...(next ? {} : { kkScanCount: 0, kkScanQty: 0 })
          });
        }
        await batch.commit();
        if (next) {
          const histBatch = this.firestore.firestore.batch();
          for (const m of chunk) {
            this.kkLogSet(histBatch, {
              inventoryDocId: m.id,
              factory: this.resolveKkFactoryForMaterial(m),
              materialCode: String(m.materialCode || '').trim().toUpperCase(),
              materialName: String(m.materialName || '').trim(),
              poNumber: String(m.poNumber || '').trim(),
              batchNumber: String(m.batchNumber || '').trim(),
              location: String(m.location || '').trim().toUpperCase(),
              quantity: Number(m.quantity) || 0,
              stock: Number(this.calculateCurrentStock(m)) || 0,
              unit: String(m.unit || '').trim(),
              checkedBy: operator,
              checkedAt: kkAt,
              checkedDateKey: this.toDateKey(kkAt),
              createdAt: new Date()
            });
          }
          await histBatch.commit();
        }
      }
      for (const m of targets) {
        m.kkChecked = next;
        m.kkBy = operator;
        m.kkAt = kkAt;
        if (!next) { m.kkScanCount = 0; m.kkScanQty = 0; }
      }
      this.invalidateKkInvSnapCache();
      this.syncKkTypeRows();
    } catch (e) {
      console.error('❌ onKkByTypeTick:', e);
      appAlert('❌ Không lưu được tick KK theo loại hàng.');
    } finally {
      this.kkLocMapBusy = false;
      this.cdr.detectChanges();
    }
  }

  async resetKkScanForBoxes(
    boxes: Array<{ productType: string }>,
    label: string,
    event?: Event
  ): Promise<void> {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!this.canEdit || this.kkLocMapBusy) return;
    const seen = new Set<string>();
    const lines: InventoryMaterial[] = [];
    for (const box of boxes || []) {
      for (const m of this.kkCachedLinesForType(box.productType)) {
        if (!m?.id || seen.has(m.id)) continue;
        seen.add(m.id);
        lines.push(m);
      }
    }
    await this.commitKkScanCountReset(lines, label);
  }

  async resetKkScanForCurrentCode(event?: Event): Promise<void> {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    await this.commitKkScanCountReset(
      this.kkTypeScanCodeRows,
      this.kkTypeScanMaterialCode || 'mã đang quét'
    );
  }

  private async commitKkScanCountReset(lines: InventoryMaterial[], label: string): Promise<void> {
    if (!this.canEdit) return;
    const targets = (lines || []).filter((m) => !!m?.id && (this.getKkScanCount(m) > 0 || this.getKkScanQty(m) > 0));
    if (!targets.length) {
      appAlert(`Chưa có lần quét nào để xóa (${label}).`);
      return;
    }
    if (!confirm(`Xóa lần quét cũ của ${label}?\n${targets.length} dòng sẽ về 0 để quét lại.`)) {
      return;
    }
    this.kkLocMapBusy = true;
    this.kkTypeScanBusy = true;
    this.cdr.detectChanges();
    const operator = this.kkTypeScanOperator || this.kkOperatorIdCache || '';
    try {
      const chunkSize = 400;
      for (let i = 0; i < targets.length; i += chunkSize) {
        const chunk = targets.slice(i, i + chunkSize);
        const batch = this.firestore.firestore.batch();
        for (const m of chunk) {
          const payload: Record<string, unknown> = {
            kkScanCount: 0,
            kkScanQty: 0,
            updatedAt: new Date(),
            lastModified: firebase.default.firestore.FieldValue.serverTimestamp()
          };
          if (operator) payload.modifiedBy = operator;
          batch.update(this.firestore.collection('inventory-materials').doc(m.id!).ref, payload);
        }
        await batch.commit();
      }
      const ids = new Set(targets.map((m) => m.id));
      const stamp = (x: InventoryMaterial) => {
        if (x?.id && ids.has(x.id)) { x.kkScanCount = 0; x.kkScanQty = 0; }
      };
      targets.forEach((m) => { m.kkScanCount = 0; m.kkScanQty = 0; });
      this.kkLocMapTypeCache.forEach((list) => list.forEach(stamp));
      this.kkLocMapMaterialCache.forEach((list) => list.forEach(stamp));
      this.kkTypeScanExtraLines.forEach(stamp);
      this.inventoryMaterials.forEach(stamp);
      targets.forEach((m) => this.patchKkInvSnapCache(m.id!, { kkScanCount: 0, kkScanQty: 0 }));
      const codes = new Set(
        targets.map((m) => String(m.materialCode || '').trim().toUpperCase()).filter(Boolean)
      );
      const nextCartons = { ...this.kkTypeScanCartons };
      codes.forEach((c) => { delete nextCartons[c]; });
      this.kkTypeScanCartons = nextCartons;
      this.syncKkTypeRows();
      if (this.showKkTypeScanModal) {
        this.pushKkTypeScanLog(true, `Reset lần quét ${label} · ${targets.length} dòng`);
      }
    } catch (e) {
      console.error('❌ resetKkScanCount:', e);
      appAlert('❌ Không xóa được lần quét. Thử lại.');
    } finally {
      this.kkLocMapBusy = false;
      this.kkTypeScanBusy = false;
      this.cdr.detectChanges();
      if (this.showKkTypeScanModal) this.focusKkTypeScanInput('kkTypeScanQrInput');
    }
  }

  onKkTypeLocationEnter(row: KkTypeRow, event: Event): void {
    (event.target as HTMLInputElement | null)?.blur();
  }

  async saveKkTypeLocation(row: KkTypeRow): Promise<void> {
    if (!this.canEdit || this.kkLocMapBusy) return;
    const next = this.normalizeMultiLocationValue(String(row.location || ''));
    row.location = next;
    if (!next) return;
    if (next === row.locationSaved) return;
    const lines = this.kkLinesForTypeRow(row);
    if (!lines.length) return;
    await this.writeKkTypeLocations(row, next, lines);
  }

  async clearKkTypeLocations(row: KkTypeRow): Promise<void> {
    if (!this.canEdit || this.kkLocMapBusy) return;
    const lines = this.kkLinesForTypeRow(row).filter((m) => String(m.location || '').trim());
    if (!lines.length) {
      row.location = '';
      row.locationSaved = '';
      this.cdr.detectChanges();
      return;
    }
    const ok = confirm(`Xóa vị trí mọi dòng loại hàng ${row.productType}?\n(${lines.length} dòng)`);
    if (!ok) return;
    await this.writeKkTypeLocations(row, '', lines);
  }

  private async writeKkTypeLocations(row: KkTypeRow, next: string, lines: InventoryMaterial[]): Promise<void> {
    this.kkLocMapBusy = true;
    this.cdr.detectChanges();
    try {
      const modifiedBy = await this.resolveLocationOperatorId();
      const changedAt = new Date();
      const chunkSize = 400;
      for (let i = 0; i < lines.length; i += chunkSize) {
        const chunk = lines.slice(i, i + chunkSize);
        const batch = this.firestore.firestore.batch();
        for (const m of chunk) {
          const fromLocation = this.normalizeMultiLocationValue(String(m.location || ''));
          const payload: Record<string, unknown> = {
            ...this.inventoryLocationWriteFields(next),
            updatedAt: changedAt,
            lastModified: firebase.default.firestore.FieldValue.serverTimestamp(),
            modifiedBy,
            locationManualOverride: true
          };
          if ((next === 'F62' || next === 'F62TRA') && m.iqcStatus !== 'Pass') {
            payload.iqcStatus = 'Pass';
          }
          batch.update(this.firestore.collection('inventory-materials').doc(m.id!).ref, payload);
          if (fromLocation !== next) {
            batch.set(this.firestore.collection('material-location-history').doc().ref, {
              factory: this.selectedFactory,
              materialId: m.id,
              materialCode: m.materialCode,
              poNumber: m.poNumber || '',
              fromLocation,
              toLocation: next,
              changedBy: modifiedBy,
              changeType: next ? 'kk-type-summary' : 'kk-type-clear',
              changedAt: firebase.default.firestore.FieldValue.serverTimestamp()
            });
          }
        }
        await batch.commit();
      }
      for (const m of lines) {
        m.location = next;
        const rowMeta = m as { __prevLocation?: string; __locationAtLoad?: string; locationManualOverride?: boolean };
        rowMeta.__prevLocation = next;
        rowMeta.__locationAtLoad = next;
        rowMeta.locationManualOverride = true;
      }
      row.location = next;
      row.locationSaved = next;
    } catch (e) {
      console.error('❌ writeKkTypeLocations:', e);
      appAlert(next ? '❌ Không lưu được vị trí theo loại hàng.' : '❌ Không xóa được vị trí theo loại hàng.');
    } finally {
      this.kkLocMapBusy = false;
      this.cdr.detectChanges();
    }
  }

  /** Vị trí cuộn trang KK trước khi mở LinkQ (phần KK bị gỡ khỏi trang khi đang xem LinkQ). */
  private kkBodyScrollBeforeLinkQ = 0;

  openLinkQCompare(): void {
    this.kkBodyScrollBeforeLinkQ = (document.querySelector('.kk-page .kk-page__body') as HTMLElement | null)?.scrollTop || 0;
    this.showLinkQCompare = true;
    this.linkQCompareTab = 'all';
    this.linkQCompareQuery = '';
    this.linkQCompareSort = { key: 'code', dir: 1 };
    this.linkQCompareExpanded = new Set<string>();
    this.linkQRowFn = new Map<string, LinkQRowFn>();
    this.linkQPoOpen = new Set<string>();
    this.loadLinkQCheckStored();
    const factory = this.selectedFactory;
    void this.loadLinkQAdjPending();
    const cached = this.linkQCompareCache.get(factory);
    if (cached) {
      this.applyLinkQCompareData(factory, cached.rows, cached.label, cached.ts, cached.po);
      if (Date.now() - cached.ts > MaterialsComponent.LINKQ_COMPARE_TTL_MS) void this.loadLinkQCompare();
      return;
    }
    this.linkQCompareFactory = factory;
    this.linkQCompareRows = [];
    this.linkQCompareError = '';
    this.recomputeLinkQCompareBase();
    void this.loadLinkQCompare();
  }

  closeLinkQCompare(): void {
    this.showLinkQCompare = false;
    clearTimeout(this.linkQCompareQueryTimer);
    // Trang KK vẽ lại → trả về đúng chỗ đang cuộn trước khi mở LinkQ
    const top = this.kkBodyScrollBeforeLinkQ;
    if (top > 0) {
      setTimeout(() => {
        const body = document.querySelector('.kk-page .kk-page__body') as HTMLElement | null;
        if (body) body.scrollTop = top;
      });
    }
  }

  /** LinkQ làm gốc (chỉ mã tồn > 0), so với tổng tồn web theo mã (cộng mọi PO, bỏ kho TIEUHUY). */
  async loadLinkQCompare(force = false): Promise<void> {
    if (this.linkQCompareLoading || this.linkQCompareRefreshing) return;
    const factory = this.selectedFactory;
    const background = this.linkQCompareFactory === factory && this.linkQCompareRows.length > 0;
    if (background) this.linkQCompareRefreshing = true;
    else this.linkQCompareLoading = true;
    this.linkQCompareError = '';
    this.cdr.detectChanges();
    try {
      const [pack, docs] = await Promise.all([
        this.getLinkQPackCached(force),
        this.getKkFactoryDocs(factory, force, true)
      ]);
      if (factory !== this.selectedFactory) return;
      if (!pack.map.size) {
        this.linkQCompareLabel = pack.label;
        this.linkQCompareRows = [];
        this.recomputeLinkQCompareBase();
        this.linkQCompareError = `Chưa có file LinkQ cho ${factory}. Import file LinkQ ở tab Inventory Overview.`;
        return;
      }
      const rows = this.buildLinkQCompareRows(pack.map, docs);
      const ts = Date.now();
      const po = pack.po || new Map<string, Map<string, number>>();
      this.linkQCompareCache.set(factory, { rows, label: pack.label, ts, po });
      this.applyLinkQCompareData(factory, rows, pack.label, ts, po);
    } catch (e) {
      console.error('[LinkQ compare] failed', e);
      if (!background) this.linkQCompareError = 'Không đọc được dữ liệu so sánh. Thử lại.';
    } finally {
      this.linkQCompareLoading = false;
      this.linkQCompareRefreshing = false;
      this.cdr.detectChanges();
    }
  }

  private buildLinkQCompareRows(linkQMap: Map<string, number>, docs: any[]): LinkQCompareRow[] {
    const web = new Map<string, { total: number; pos: Map<string, { po: string; locs: Set<string>; stock: number }> }>();
    for (const doc of docs) {
      const data = (doc?.data ? doc.data() : doc) as any;
      const code = this.normalizeTieuHuyCode(data?.materialCode);
      if (!code) continue;
      const location = this.locationFromInventoryDoc(data);
      if (this.isTieuHuyLocation(location)) continue;
      const stock = (Number(data.openingStock) || 0) + (Number(data.quantity) || 0)
        - (Number(data.exported) || 0) - (Number(data.xt) || 0);
      let entry = web.get(code);
      if (!entry) {
        entry = { total: 0, pos: new Map() };
        web.set(code, entry);
      }
      entry.total += stock;
      const po = String(data.poNumber || '').trim().toUpperCase() || '—';
      let poEntry = entry.pos.get(po);
      if (!poEntry) {
        poEntry = { po, locs: new Set<string>(), stock: 0 };
        entry.pos.set(po, poEntry);
      }
      poEntry.stock += stock;
      if (location && location !== '-') poEntry.locs.add(location);
    }

    const poList = (code: string) => Array.from(web.get(code)?.pos.values() || [])
      .map((p) => {
        const stock = Math.round(p.stock);
        return { po: p.po, location: Array.from(p.locs).join(', '), stock, stockText: this.formatNumber(stock) };
      })
      .filter((p) => p.stock !== 0)
      .sort((a, b) => a.po.localeCompare(b.po, 'en', { numeric: true }));

    const makeRow = (code: string, linkQ: number | null, webTotal: number, kind: LinkQCompareRow['kind']): LinkQCompareRow => {
      const diff = webTotal - (linkQ || 0);
      const isDiff = this.isLinkqDiffBad(diff);
      const status = kind === 'webOnly'
        ? { label: 'Web có, LinkQ không có', cls: 'webonly' }
        : kind === 'linkqOnly'
          ? { label: 'LinkQ có, web không có', cls: 'linkqonly' }
          : isDiff ? { label: 'Lệch', cls: 'diff' } : { label: 'Khớp', cls: 'ok' };
      return {
        code,
        linkQ,
        web: webTotal,
        diff,
        kind,
        isDiff,
        linkQText: linkQ == null ? '—' : this.formatNumber(linkQ),
        webText: this.formatNumber(webTotal),
        diffText: isDiff ? this.formatSignedNumber(diff) : 'Khớp',
        statusLabel: status.label,
        statusCls: status.cls,
        pos: poList(code)
      };
    };

    const rows: LinkQCompareRow[] = [];
    const linkQPositive = new Set<string>();
    linkQMap.forEach((linkQ, code) => {
      if (!(linkQ > 0) || MaterialsComponent.isLinkQCompareExcluded(code)) return;
      linkQPositive.add(code);
      const webTotal = Math.round(web.get(code)?.total || 0);
      rows.push(makeRow(code, linkQ, webTotal, webTotal > 0 ? 'both' : 'linkqOnly'));
    });
    web.forEach((entry, code) => {
      const webTotal = Math.round(entry.total);
      if (linkQPositive.has(code) || webTotal <= 0 || MaterialsComponent.isLinkQCompareExcluded(code)) return;
      rows.push(makeRow(code, linkQMap.has(code) ? (linkQMap.get(code) as number) : null, webTotal, 'webOnly'));
    });
    return rows;
  }

  /** PXK chưa xuất theo mã (Work Order chưa Done, web chưa scan xuất) — giải thích lệch LinkQ / web. */
  linkQPendingPxk: Map<string, PendingPxkInfo> | null = null;
  linkQPendingPxkLoading = false;
  linkQPendingPxkError = '';

  /** Nút "Tính PXK chưa xuất" — chỉ chạy khi bấm (đỡ lượt đọc), chỉ ASM1, Work Order 7 ngày gần nhất. */
  runLinkQPendingPxk(): void {
    if (this.linkQPendingPxkLoading) return;
    if ((this.linkQCompareFactory || this.selectedFactory) !== 'ASM1') {
      appAlert('PXK chưa xuất chỉ tính cho ASM1.');
      return;
    }
    this.loadLinkQPendingPxk(true);
  }

  private loadLinkQPendingPxk(force = false): void {
    const factory = this.linkQCompareFactory || this.selectedFactory;
    this.linkQPendingPxkLoading = true;
    this.linkQPendingPxkError = '';
    this.linkQPendingPxk$(factory, force)
      .then((map) => {
        if (factory !== this.linkQCompareFactory) return;
        this.linkQPendingPxk = map;
      })
      .catch((e) => {
        console.error('[LinkQ] pending PXK failed', e);
        this.linkQPendingPxkError = 'Không đọc được PXK chưa xuất';
      })
      .finally(() => {
        this.linkQPendingPxkLoading = false;
        this.cdr.detectChanges();
      });
  }

  private linkQPendingPxk$(factory: string, force: boolean): Promise<Map<string, PendingPxkInfo>> {
    return this.linkQPendingPxkSvc.load(factory, force);
  }

  linkQPendingPxkText(code: string): string {
    if (this.linkQPendingPxkLoading && !this.linkQPendingPxk) return '…';
    if (!this.linkQPendingPxk) return '';
    const p = this.linkQPendingPxk.get(code);
    return p ? this.formatNumber(p.qty) : '—';
  }

  /** Lệch còn lại sau khi trừ PXK chưa xuất: (web − PXK) − LinkQ. LinkQ đã trừ theo PXK, web chỉ trừ khi scan. */
  linkQDiffAfterPxk(r: LinkQCompareRow): number | null {
    if (!this.linkQPendingPxk || r.linkQ == null) return null;
    const pending = this.linkQPendingPxk.get(r.code)?.qty || 0;
    return Math.round((r.diff - pending) * 10000) / 10000;
  }

  linkQDiffAfterPxkText(r: LinkQCompareRow): string {
    const v = this.linkQDiffAfterPxk(r);
    if (v == null) return '—';
    return `${v > 0 ? '+' : ''}${this.formatNumber(v)}`;
  }

  linkQDiffAfterPxkOk(r: LinkQCompareRow): boolean {
    const v = this.linkQDiffAfterPxk(r);
    return v == null || Math.abs(v) <= 1;
  }

  linkQPendingPxkTitle(code: string): string {
    const p = this.linkQPendingPxk?.get(code);
    return p
      ? `${this.formatNumber(p.qty)} trên PXK của ${p.lsx} LSX (7 ngày gần nhất) chưa Done mà web chưa scan xuất`
      : 'Không có PXK chưa xuất';
  }

  /** Dòng tồn (theo từng PO / vị trí) của mã đang mở trong trang LinkQ — để tick KK, sửa vị trí, Standard. */
  private linkQLinesCache = new Map<string, InventoryMaterial[]>();

  linkQCodeLines(code: string): InventoryMaterial[] {
    const hit = this.linkQLinesCache.get(code);
    if (hit) return hit;
    const docs = this.kkInvSnapCache.get(String(this.linkQCompareFactory || '').trim().toUpperCase())?.docs || [];
    // Dùng lại đúng đối tượng trang KK đã tải (tick / sửa ở đâu cũng đồng bộ)
    const known = new Map<string, InventoryMaterial>();
    this.kkLocMapTypeCache.forEach((list) => list.forEach((m) => { if (m.id) known.set(String(m.id), m); }));
    const lines: InventoryMaterial[] = [];
    for (const doc of docs) {
      const data = (doc?.data ? doc.data() : doc) as any;
      if (this.normalizeTieuHuyCode(data?.materialCode) !== code) continue;
      if (this.isTieuHuyLocation(this.locationFromInventoryDoc(data))) continue;
      if (this.stockFromInventoryDoc(data) <= 0) continue;
      let m = known.get(String(doc.id));
      if (!m) {
        m = this.mapKkInventoryDoc(doc);
        m.kkChecked = this.isKkFlagOn(data.kkChecked);
      }
      lines.push(m);
    }
    lines.sort((a, b) => String(a.poNumber || '').localeCompare(String(b.poNumber || ''), 'en', { numeric: true }));
    this.linkQLinesCache.set(code, lines);
    return lines;
  }

  trackKkLineById(_: number, m: InventoryMaterial): string {
    return String(m.id || '');
  }

  private applyLinkQCompareData(factory: string, rows: LinkQCompareRow[], label: string, ts: number, po: Map<string, Map<string, number>>): void {
    if (this.linkQCompareFactory !== factory) this.linkQPendingPxk = null;
    this.linkQCompareFactory = factory;
    this.linkQCompareRows = rows;
    this.linkQPoByCode = po;
    this.linkQLinesCache.clear();
    this.linkQPoRowsCache.clear();
    if (!po.size) void this.ensureLinkQPoFromAging();
    this.linkQCompareLabel = label;
    this.linkQCompareUpdatedAt = ts;
    this.linkQCompareError = '';
    this.recomputeLinkQCompareBase();
  }

  /** Bật / tắt DS Check (bật lại mục đã chọn trước, mặc định "Mục sẽ xài"). */
  toggleLinkQCheckOnly(): void {
    if (!this.linkQCheckCodes.length) return;
    this.setDsCheckMode(this.dsCheckMode ? '' : (this.pendingCheckMode || 'willUse'));
  }

  setLinkQCompareTab(tab: LinkQCompareTab): void {
    if (this.linkQCompareTab === tab) return;
    this.linkQCompareTab = tab;
    this.refreshLinkQCompareView();
  }

  onLinkQCompareQuery(value: string): void {
    this.linkQCompareQuery = value;
    clearTimeout(this.linkQCompareQueryTimer);
    this.linkQCompareQueryTimer = setTimeout(() => this.refreshLinkQCompareView(), 150);
  }

  clearLinkQCompareQuery(): void {
    clearTimeout(this.linkQCompareQueryTimer);
    this.linkQCompareQuery = '';
    this.refreshLinkQCompareView();
  }

  sortLinkQCompare(key: 'code' | 'linkQ' | 'web' | 'diff'): void {
    const cur = this.linkQCompareSort;
    this.linkQCompareSort = cur.key === key
      ? { key, dir: cur.dir === 1 ? -1 : 1 }
      : { key, dir: key === 'code' ? 1 : -1 };
    this.refreshLinkQCompareView();
  }

  linkQCompareSortIcon(key: 'code' | 'linkQ' | 'web' | 'diff'): string {
    if (this.linkQCompareSort.key !== key) return 'unfold_more';
    return this.linkQCompareSort.dir === 1 ? 'arrow_upward' : 'arrow_downward';
  }

  get linkQCompareUpdatedText(): string {
    return this.linkQCompareUpdatedAt ? new Date(this.linkQCompareUpdatedAt).toLocaleTimeString('vi-VN') : '';
  }

  toggleLinkQCompareRow(code: string): void {
    const next = new Set(this.linkQCompareExpanded);
    if (next.has(code)) next.delete(code);
    else {
      next.add(code);
      // Standard / tên hàng đọc từ danh mục — máy chưa có cache danh mục thì đọc riêng mã này
      if (!this.catalogCache.has(code)) {
        void this.ensureCatalogForMaterialCodes([code]).then(() => this.cdr.detectChanges());
      }
    }
    this.linkQCompareExpanded = next;
  }

  // ===== Phần mở rộng của từng mã: chọn chức năng (Dòng tồn web / Check PO), cảnh báo, nhập lượng thiếu / dư =====

  linkQFnOf(code: string): LinkQRowFn {
    return this.linkQRowFn.get(code) || 'lines';
  }

  setLinkQRowFn(code: string, fn: LinkQRowFn): void {
    const next = new Map(this.linkQRowFn);
    next.set(code, fn);
    this.linkQRowFn = next;
  }

  linkQCatalogName(code: string): string {
    return String(this.catalogCache.get(code)?.materialName || '').trim();
  }

  linkQCatalogUnit(code: string): string {
    return String(this.catalogCache.get(code)?.unit || '').trim();
  }

  /** Lệch dùng để cảnh báo: đã tính PXK chưa xuất thì lấy lệch sau PXK. */
  private linkQWarnDiff(r: LinkQCompareRow): number {
    const after = this.linkQDiffAfterPxk(r);
    return after == null ? r.diff : after;
  }

  /**
   * Cảnh báo theo mã (LinkQ làm gốc):
   * web hết mà LinkQ còn / LinkQ hết mà web còn → "Đã hết stock";
   * web > LinkQ → "Cần giảm stock"; web < LinkQ → "Cần tăng stock".
   */
  linkQWarn(r: LinkQCompareRow): LinkQWarn | null {
    if (r.kind === 'linkqOnly') return { cls: 'out', label: 'Web đã hết stock · cần tăng', qty: r.linkQ || 0 };
    if (r.kind === 'webOnly') return { cls: 'out', label: 'LinkQ đã hết stock · cần giảm', qty: r.web };
    const diff = this.linkQWarnDiff(r);
    if (!this.isLinkqDiffBad(diff)) return null;
    return diff > 0
      ? { cls: 'dec', label: 'Cần giảm stock', qty: diff }
      : { cls: 'inc', label: 'Cần tăng stock', qty: -diff };
  }

  /** File LinkQ tồn kho không có cột PO → lấy tồn theo PO từ file tuổi hàng LinkQ (đã import ở So sánh PO). */
  private async ensureLinkQPoFromAging(): Promise<void> {
    if (this.linkQPoByCode.size) return;
    try {
      if (!this.kkPoCmp || this.kkPoCmpFactory !== this.selectedFactory) await this.loadKkPoCmp();
    } catch (e) {
      console.warn('[LinkQ] load PO aging failed', e);
      return;
    }
    const d = this.kkPoCmp;
    if (!d || this.linkQPoByCode.size) return;
    const map = new Map<string, Map<string, number>>();
    d.byCode.forEach((pos, code) => {
      const byPo = new Map<string, number>();
      pos.forEach((po) => byPo.set(po, d.qtyByKey.get(`${code}|${po}`) ?? 0));
      map.set(this.normalizeTieuHuyCode(code), byPo);
    });
    this.linkQPoByCode = map;
    this.linkQPoRowsCache.clear();
    this.cdr.detectChanges();
  }

  get linkQHasPoData(): boolean {
    return this.linkQPoByCode.size > 0;
  }

  /** Check PO của 1 mã: LinkQ làm gốc, so tồn web theo từng PO → PO web dư / thiếu so với LinkQ. */
  linkQPoRows(code: string): LinkQPoRow[] {
    const hit = this.linkQPoRowsCache.get(code);
    if (hit) return hit;
    const lines = this.linkQCodeLines(code);
    const web = new Map<string, { qty: number; lines: InventoryMaterial[] }>();
    for (const m of lines) {
      const po = kkPoCmpPo(m.poNumber) || '—';
      const cur = web.get(po) || { qty: 0, lines: [] };
      cur.qty += this.calculateCurrentStock(m);
      cur.lines.push(m);
      web.set(po, cur);
    }
    const linkQ = this.linkQPoByCode.get(code) || null;
    const pos = new Set<string>([...web.keys(), ...(linkQ ? Array.from(linkQ.entries()).filter(([, q]) => q > 0).map(([p]) => p) : [])]);
    const r4 = (n: number) => Math.round(n * 10000) / 10000;
    const rows: LinkQPoRow[] = Array.from(pos).map((po) => {
      const w = r4(web.get(po)?.qty || 0);
      const q = linkQ ? (linkQ.get(po) || 0) : null;
      const diff = q == null ? 0 : r4(w - q);
      const status: LinkQPoRow['status'] = q == null
        ? 'nodata'
        : !this.isLinkqDiffBad(diff) ? 'ok' : diff > 0 ? 'over' : 'short';
      return { po, linkQ: q, web: w, diff, status, lines: web.get(po)?.lines || [] };
    });
    const rank = { short: 0, over: 1, nodata: 2, ok: 3 };
    rows.sort((a, b) => rank[a.status] - rank[b.status] || a.po.localeCompare(b.po, 'en', { numeric: true }));
    this.linkQPoRowsCache.set(code, rows);
    return rows;
  }

  linkQPoCount(code: string, status: LinkQPoRow['status']): number {
    return this.linkQPoRows(code).filter((p) => p.status === status).length;
  }

  linkQPoStatusLabel(p: LinkQPoRow): string {
    if (p.status === 'nodata') return 'Chưa có PO LinkQ';
    if (p.status === 'ok') return 'Khớp';
    if (p.status === 'over') return p.linkQ ? 'Web dư' : 'Web dư PO (LinkQ không có)';
    return p.web ? 'Web thiếu' : 'Web thiếu PO (web không có)';
  }

  toggleLinkQPo(code: string, po: string): void {
    const key = `${code}|${po}`;
    const next = new Set(this.linkQPoOpen);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.linkQPoOpen = next;
  }

  linkQAdjDraft(line: InventoryMaterial): { short: number | null; over: number | null } {
    const id = String(line.id || '');
    let d = this.linkQAdjDrafts.get(id);
    if (!d) {
      d = { short: null, over: null };
      this.linkQAdjDrafts.set(id, d);
    }
    return d;
  }

  linkQAdjPendingText(line: InventoryMaterial): string {
    const list = this.linkQAdjPending.get(String(line.id || ''));
    if (!list?.length) return '';
    return list.map((x) => x.target === 'delete' ? 'xóa dòng' : `${x.direction === 'inc' ? '+' : '−'}${this.formatNumber(x.qty)}`).join(', ');
  }

  /** Dòng tồn đã có đề nghị xóa đang chờ quản lý duyệt. */
  kkDeletePending(m: InventoryMaterial): boolean {
    return !!this.linkQAdjPending.get(String(m.id || ''))?.some((x) => x.target === 'delete');
  }

  kkDeleteBusyId: string | null = null;

  /**
   * Cột Đề nghị xóa: lưu đề nghị (chờ duyệt ở Danh mục điều chỉnh) + bot Zalo báo nhóm Quản lý kho.
   * Quản lý duyệt → dòng vào Danh mục Ẩn (khôi phục được), không xóa cứng.
   */
  async requestKkDelete(m: InventoryMaterial): Promise<boolean> {
    if (!this.canEdit || this.denyAction('invAdjustRequest')) return false;
    if (!m?.id || this.kkDeleteBusyId) return false;
    await this.loadLinkQAdjPending();
    if (this.kkDeletePending(m)) {
      appAlert('Dòng này đã có đề nghị xóa đang chờ quản lý duyệt.');
      return true;
    }
    const stock = this.calculateCurrentStock(m);
    const suspect = this.kkPoCheckCols ? this.kkPoCheckSuspect(m) : '';
    const reason = prompt(
      `Đề nghị XÓA dòng tồn ${m.materialCode} · PO ${m.poNumber || '—'} · IMD ${this.getDisplayIMD(m)} · tồn ${this.formatNumber(stock)} · ${this.primaryLocationDisplay(m.location) || '—'}\n`
      + 'Lý do (gửi kèm Zalo nhóm Quản lý kho):',
      suspect.replace(/^Nghi sai: /, '')
    );
    if (reason === null) return false;
    this.kkDeleteBusyId = String(m.id);
    this.cdr.detectChanges();
    try {
      const by = await this.getMaterialsOtpRequester();
      const note = reason.trim();
      await this.firestore.firestore.collection('inventory-adjust-requests').add({
        factory: this.selectedFactory,
        materialId: m.id,
        materialCode: m.materialCode || '',
        po: m.poNumber || '',
        imd: this.getDisplayIMD(m),
        location: this.primaryLocationDisplay(m.location),
        target: 'delete',
        direction: '',
        qty: stock,
        currentValue: stock,
        expectedValue: 0,
        note,
        status: 'pending',
        by,
        at: firebase.default.firestore.FieldValue.serverTimestamp()
      });
      let zaloOk = true;
      try {
        await this.invStockReportSvc.notify({
          factory: this.selectedFactory,
          materialCode: String(m.materialCode || ''),
          po: String(m.poNumber || ''),
          imd: this.getDisplayIMD(m),
          stock: this.formatNumber(stock),
          location: this.primaryLocationDisplay(m.location),
          status: 'Đề nghị xóa dòng',
          reportedBy: by,
          detail: `Đề nghị xóa dòng tồn ${this.formatNumber(stock)}.`
            + (note ? `\nLý do: ${note}` : '')
            + '\nDuyệt tại Quản lý NL → More → Danh mục điều chỉnh.'
        });
      } catch (e) {
        console.warn('requestKkDelete zalo:', e);
        zaloOk = false;
      }
      await this.loadLinkQAdjPending();
      appAlert(zaloOk
        ? '✅ Đã gửi đề nghị xóa — bot Zalo đã báo nhóm Quản lý kho.'
        : '✅ Đã lưu đề nghị xóa (chờ duyệt). Zalo chưa gửi được tới nhóm Quản lý kho.');
      return true;
    } catch (e: any) {
      console.error('requestKkDelete:', e);
      appAlert('❌ Không gửi được đề nghị xóa: ' + (e?.message || e));
      return false;
    } finally {
      this.kkDeleteBusyId = null;
      this.cdr.detectChanges();
    }
  }

  /**
   * Nhập lượng thiếu (tăng tồn) hoặc dư (giảm tồn) cho 1 dòng tồn → gửi đề nghị điều chỉnh Tồn cuối,
   * quản lý mở More → Danh mục điều chỉnh để duyệt / sửa số sau.
   */
  async sendLinkQAdjust(line: InventoryMaterial, code: string, context: string): Promise<void> {
    if (!this.canEdit || this.denyAction('invAdjustRequest')) return;
    const d = this.linkQAdjDraft(line);
    const short = Number(d.short) || 0;
    const over = Number(d.over) || 0;
    if (short > 0 && over > 0) {
      appAlert('Chỉ nhập 1 ô: Thiếu hoặc Dư.');
      return;
    }
    if (!(short > 0) && !(over > 0)) {
      appAlert('Nhập lượng thiếu hoặc lượng dư (> 0).');
      return;
    }
    const r = this.linkQCompareRows.find((x) => x.code === code);
    const base = r ? `LinkQ ${r.linkQText} · web ${r.webText}` : 'LinkQ';
    this.invAdjust = {
      material: line,
      target: 'closing',
      direction: short > 0 ? 'inc' : 'dec',
      qty: short > 0 ? short : over,
      note: `Check LinkQ (${context}): ${short > 0 ? 'thiếu' : 'dư'} · ${base}`,
      busy: false,
      msg: '',
      ok: false
    };
    await this.submitInvAdjust();
    if (this.invAdjust?.ok) {
      this.linkQAdjDrafts.delete(String(line.id || ''));
      void this.loadLinkQAdjPending();
    }
  }

  /** Đề nghị điều chỉnh đang chờ duyệt của nhà máy — hiện cạnh dòng tồn để khỏi gửi trùng. */
  async loadLinkQAdjPending(): Promise<void> {
    const factory = this.selectedFactory;
    try {
      const snap = await this.firestore.firestore.collection('inventory-adjust-requests')
        .where('factory', '==', factory)
        .where('status', '==', 'pending')
        .get();
      if (factory !== this.selectedFactory) return;
      const map = new Map<string, Array<{ direction: string; qty: number; target: string }>>();
      snap.docs.forEach((doc) => {
        const x = doc.data() as any;
        const id = String(x.materialId || '');
        if (!id) return;
        const list = map.get(id) || [];
        list.push({ direction: String(x.direction || ''), qty: Number(x.qty) || 0, target: String(x.target || '') });
        map.set(id, list);
      });
      this.linkQAdjPending = map;
      this.linkQAdjPendingCount = snap.size;
    } catch (e) {
      console.warn('[LinkQ] load pending adjust failed', e);
    } finally {
      this.cdr.detectChanges();
    }
  }

  openLinkQAdjustList(): void {
    this.openInvAdjustList();
  }

  trackLinkQCompareRow(_: number, r: LinkQCompareRow): string {
    return r.code;
  }

  formatSignedNumber(n: number): string {
    return `${n > 0 ? '+' : ''}${this.formatNumber(n)}`;
  }

  /** KK: bấm cột vị trí → popup nhập mã hoặc chọn ô kệ Layout Kho J. */
  openKkLayoutLocPicker(material: InventoryMaterial, event?: Event): void {
    if (this.denyAction('location')) return;
    if (!this.canEdit || this.kkLocMapBusy || !material) return;
    this.openLayoutLocPicker(material, event, 'location');
  }


  closeKkLocMap(): void {
    this.showKkLocMap = false;
    this.kkLocMapLoading = false;
    this.kkLocMapStatus = '';
    this.kkLocMapQuery = '';
    this.kkStockLoaded = false;
    this.kkBoxStockLoaded.clear();
    this.kkSelectedMuc = null;
    this.kkBoxStockLoadingKey = null;
    this.kkLocMapView = null;
    this.kkLocMapWarehouseFilter = '';
    this.kkCountWh3 = true;
    this.kkWh3Only = false;
    this.kkJOnly = false;
    this.kkFilterUncheckedOnly = false;
    this.kkLocMapBoxes = [];
    this.kkLocMapByMaterial = [];
    this.kkLocMapByType = [];
    this.kkLocMapRowCache.clear();
    this.kkLocMapMaterialCache.clear();
    this.kkLocMapTypeCache.clear();
    this.kkLocMapLoadId++;
    this.kkLocMapBusy = false;
    this.kkLocMapExpandedKey = null;
    this.kkActiveProductType = null;
    this.kkActiveTypeDraft = null;
    this.kkActivePinSplit = null;
    this.kkActiveSourceProductType = null;
    this.kkAllStockDetail = false;
    this.kkConnectorFloorDetail = null;
    this.showKkTypeReportMenu = false;
    this.showKkIdReport = false;
    this.showKkPalletCheck = false;
    this.stopKkLive();
    this.syncKkPageLock();
  }

  linkQCompareRows: LinkQCompareRow[] = [];
  linkQCompareTab: LinkQCompareTab = 'all';
  linkQCompareQuery = '';
  linkQCompareSort: { key: 'code' | 'linkQ' | 'web' | 'diff'; dir: 1 | -1 } = { key: 'code', dir: 1 };
  linkQCompareCounts = { all: 0, linkq: 0, diff: 0, diffPos: 0, diffNeg: 0, linkqOnly: 0, webOnly: 0 };
  linkQCompareTotals = { linkQ: 0, web: 0 };
  /** File Check: cột A từ dòng 2 = danh sách mã cần kiểm kê. */
  linkQCheckCodes: string[] = [];
  linkQCheckFileName = '';
  /** Mã trong file Check nhưng không có tồn ở cả LinkQ lẫn web. */
  linkQCheckMissing: string[] = [];
  /** Mục đang chọn ở cột trái (chỉ hiện các box của mục này). */
  kkSelectedMuc: string | null = null;
  private kkMucAllowedLoaded = false;

  /** Bỏ cache KK — gọi sau khi tick/bỏ tick KK hàng loạt hoặc khi người dùng bấm "Làm mới". */
  protected invalidateKkInvSnapCache(factory?: string): void {
    if (factory) {
      this.kkInvSnapCache.delete(String(factory).trim().toUpperCase());
    } else {
      this.kkInvSnapCache.clear();
    }
  }
  kkTypeManagers = new Map<string, string>();

  private async ensureKkMobileCatalog(): Promise<void> {
    try {
      if (!this.kkCatalogTypeMap.size) {
        this.kkCatalogTypeMap = await this.kkCatalog.loadAllAsMap();
      }
      this.kkTypeHomeLocs = await this.kkCatalog.loadHomeLocs();
      this.kkTypeManagers = await this.kkCatalog.loadManagers();
      this.cdr.markForCheck();
    } catch (e) {
      console.error('ensureKkMobileCatalog:', e);
    }
  }

  /** Mở trang Kiểm tra KK (tab Quản lý Nguyên Liệu). */
  enterKkLocMap(): void {
    this.showKkLocMap = true;
    this.kkLocMapQuery = '';
    this.kkStockLoaded = false;
    this.kkBoxStockLoaded.clear();
    this.kkSelectedMuc = null;
    this.kkBoxStockLoadingKey = null;
    this.kkLocMapView = 'type';
    this.kkLocMapWarehouseFilter = '';
    this.kkCountWh3 = true;
    this.kkWh3Only = false;
    this.kkJOnly = false;
    this.kkFilterUncheckedOnly = false;
    this.kkLocMapBoxes = [];
    this.kkLocMapByMaterial = [];
    this.kkLocMapByType = [];
    this.kkLocMapRowCache.clear();
    this.kkLocMapMaterialCache.clear();
    this.kkLocMapTypeCache.clear();
    this.kkLocMapExpandedKey = null;
    this.kkActiveProductType = null;
    this.kkActiveTypeDraft = null;
    this.kkActivePinSplit = null;
    this.kkActiveSourceProductType = null;
    this.kkAllStockDetail = false;
    this.kkConnectorFloorDetail = null;
    setTimeout(() => void this.loadKkCatalogMeta(), 0);
    void this.loadKkMucAllowedLocs();
    this.loadLinkQCheckStored();
  }

  startKkLive(): void {
    this.kkLiveStop$.next();
    this.kkLiveActive = true;
    this.kkLiveLoading = true;
    this.kkLiveError = '';
    this.kkLiveRows = [];
    const factory = this.selectedFactory;
    const dateKey = this.toDateKey(new Date());
    const listen = (ordered: boolean) => {
      this.firestore
        .collection('inventory-kk-history', (ref) => {
          let q = ref.where('factory', '==', factory).where('checkedDateKey', '==', dateKey);
          if (ordered) q = q.orderBy('checkedAt', 'desc');
          return q.limit(200);
        })
        .valueChanges()
        .pipe(takeUntil(this.destroy$), takeUntil(this.kkLiveStop$))
        .subscribe({
          next: (rows) => {
            this.applyKkLiveHistory(rows || []);
          },
          error: (err) => {
            console.error('❌ kk live:', err);
            if (ordered) {
              listen(false);
              return;
            }
            this.kkLiveLoading = false;
            this.kkLiveError = 'Không đọc được KK live.';
            this.cdr.detectChanges();
          }
        });
    };
    listen(true);
  }

  private applyKkLiveHistory(rows: unknown[]): void {
    const parsed = (rows as Array<Record<string, unknown>>).map((data) => {
      const checkedAt = this.normalizeTimestamp(data?.checkedAt) || this.normalizeTimestamp(data?.createdAt);
      return {
        materialCode: String(data?.materialCode || '').trim().toUpperCase(),
        location: String(data?.location || '').trim().toUpperCase(),
        poNumber: String(data?.poNumber || '').trim(),
        checkedBy: String(data?.checkedBy || '').trim(),
        checkedAt: checkedAt || new Date(0)
      };
    }).filter((r) => !!r.materialCode);
    parsed.sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime());
    const byCode = new Map<string, typeof parsed[number]>();
    for (const row of parsed) {
      if (!byCode.has(row.materialCode)) byCode.set(row.materialCode, row);
    }
    this.kkLiveRows = Array.from(byCode.values());
    this.kkLiveLoading = false;
    this.kkLiveError = '';
    this.cdr.detectChanges();
  }

  /** Nút Play: đọc tồn kho. Search không bấm Play thì chỉ chạy khi đủ 4 số. */
  playKkStock(): void {
    this.refreshKkLocMap(true);
  }

  refreshKkLocMap(force = false): void {
    if (!force && this.kkLocMapView === 'type' && !this.kkStockLoaded) {
      // Chưa đọc toàn kho: chỉ đọc lại các box / mục đã mở (không quét cả kho)
      this.ensureKkTypeBoxesCache();
      const opened = this.kkTypeBoxesCached.filter((b) => this.isKkTypeBoxStockLoaded(b));
      this.kkBoxStockLoaded.clear();
      this.invalidateKkTypeViewCache();
      if (opened.length) void this.loadKkStockForBoxes(opened, 'các mục đã mở');
      return;
    }
    if (force) this.invalidateKkInvSnapCache(this.selectedFactory);
    if (this.kkLocMapView === 'material') void this.loadKkByMaterial();
    else if (this.kkLocMapView === 'location') void this.loadKkLocMap();
    else if (this.kkLocMapView === 'type' || this.kkLocMapView === 'manager') {
      void this.loadKkCatalogForMap(true);
    } else {
      this.kkLocMapView = 'type';
      void this.loadKkCatalogForMap(true);
    }
  }

  protected normalizeKkParentShelf(raw: string): string {
    const text = String(raw || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!text || text.length > 40) return '';
    const rack = /^([RS])\s*0*(\d{1,2})$/.exec(text.replace(/\s+/g, ''));
    if (rack) {
      const n = Number(rack[2]);
      if (!n || n > 99) return '';
      return `${rack[1]}${String(n).padStart(2, '0')}`;
    }
    return text;
  }

  protected async loadKkMucAllowedLocs(): Promise<void> {
    if (this.kkMucAllowedLoaded) return;
    this.kkMucAllowedLoaded = true;
    try {
      const snap = await this.firestore.collection('kk-muc-allowed-locs').get().toPromise();
      const next: Record<string, string[] | null> = {};
      const extra: Record<string, string[]> = {};
      const removed: Record<string, string[]> = {};
      for (const doc of snap?.docs || []) {
        const data = (doc.data() || {}) as { locations?: unknown; parentShelves?: unknown; removedParentShelves?: unknown };
        if (Array.isArray(data.locations)) {
          next[doc.id] = data.locations.map((loc) => String(loc || '').trim()).filter(Boolean);
        }
        if (Array.isArray(data.parentShelves)) {
          const shelves = data.parentShelves
            .map((shelf) => this.normalizeKkParentShelf(String(shelf || '')))
            .filter(Boolean);
          extra[doc.id] = Array.from(new Set(shelves));
        }
        if (Array.isArray(data.removedParentShelves)) {
          const shelves = data.removedParentShelves
            .map((shelf) => this.normalizeKkParentShelf(String(shelf || '')))
            .filter(Boolean);
          removed[doc.id] = Array.from(new Set(shelves));
        }
      }
      this.kkMucAllowedLocs = next;
      this.kkMucExtraShelves = extra;
      this.kkMucRemovedShelves = removed;
      if (Object.keys(extra).length || Object.keys(removed).length) this.invalidateKkTypeViewCache();
      this.cdr.detectChanges();
    } catch (e) {
      this.kkMucAllowedLoaded = false;
      console.error('loadKkMucAllowedLocs', e);
    }
  }

  private palletSummaryOf(list: InventoryMaterial[]): { palletId: string; palletMixed: boolean } {
    const ids = Array.from(
      new Set(
        list
          .map((m) => String(m.palletId || '').trim().toUpperCase())
          .filter(Boolean)
      )
    );
    if (ids.length === 1) return { palletId: ids[0], palletMixed: false };
    if (ids.length === 0) return { palletId: '', palletMixed: false };
    return { palletId: '', palletMixed: true };
  }

  async loadKkLocMap(): Promise<void> {
    const loadId = ++this.kkLocMapLoadId;
    this.kkLocMapLoading = true;
    this.kkLocMapStatus = `Đang đọc tồn kho ${this.selectedFactory}…`;
    this.kkLocMapBoxes = [];
    this.cdr.detectChanges();
    try {
      const snap = await this.loadKkInventorySnap();
      if (loadId !== this.kkLocMapLoadId) return;

      this.kkLocMapRowCache.clear();
      const byLoc = new Map<string, Map<string, { rows: number; kk: number }>>();
      const locDocs = snap?.docs || [];
      for (let i = 0; i < locDocs.length; i++) {
        if (i > 0 && i % 400 === 0) {
          await this.yieldUi();
          if (loadId !== this.kkLocMapLoadId) return;
        }
        const doc = locDocs[i];
        const data = doc.data() as any;
        if (this.stockFromInventoryDoc(data) <= 0) continue;
        if (this.isKkQcNgData(data)) continue;
        const code = String(data.materialCode || '').trim().toUpperCase();
        if (!code) continue;
        const tokens = splitMultiLocations(String(data.location || data.viTri || ''));
        const groups = tokens.length
          ? [...new Set(tokens.map((t) => this.locationGroupKey(t) || '—'))]
          : ['—'];
        const kkOn = this.isKkFlagOn(data.kkChecked);
        const material = this.mapKkInventoryDoc(doc);
        material.kkChecked = kkOn;
        for (const loc of groups) {
          let codes = byLoc.get(loc);
          if (!codes) {
            codes = new Map();
            byLoc.set(loc, codes);
          }
          const cur = codes.get(code) || { rows: 0, kk: 0 };
          cur.rows += 1;
          if (kkOn) cur.kk += 1;
          codes.set(code, cur);
          const list = this.kkLocMapRowCache.get(loc) || [];
          list.push({ ...material });
          this.kkLocMapRowCache.set(loc, list);
        }
      }

      const boxes = Array.from(byLoc.entries()).map(([loc, codes]) => {
        let checked = 0;
        codes.forEach((v) => {
          if (v.rows > 0 && v.kk >= v.rows) checked += 1;
        });
        return { loc, checked, total: codes.size };
      });

      const known = this.knownLocationGroups;
      boxes.sort((a, b) => {
        const ai = known.indexOf(a.loc);
        const bi = known.indexOf(b.loc);
        if (ai >= 0 || bi >= 0) {
          if (ai < 0) return 1;
          if (bi < 0) return -1;
          return ai - bi;
        }
        if (a.loc === '—') return 1;
        if (b.loc === '—') return -1;
        return a.loc.localeCompare(b.loc, 'en', { numeric: true });
      });

      if (loadId !== this.kkLocMapLoadId) return;
      this.kkLocMapBoxes = boxes;
      this.readTracker.track('materials', 'inventory-materials', snap?.docs?.length || 0);
    } catch (e) {
      if (loadId !== this.kkLocMapLoadId) return;
      console.error('❌ loadKkLocMap:', e);
      this.kkLocMapBoxes = [];
      appAlert('❌ Không tải được sơ đồ KK theo vị trí.');
    } finally {
      this.finishKkLocMapLoad(loadId);
    }
  }

  async loadKkByMaterial(): Promise<void> {
    const loadId = ++this.kkLocMapLoadId;
    this.kkLocMapLoading = true;
    this.kkLocMapStatus = 'Đang đọc tồn kho theo mã hàng…';
    this.kkLocMapByMaterial = [];
    this.cdr.detectChanges();
    try {
      const snap = await this.loadKkInventorySnap();
      if (loadId !== this.kkLocMapLoadId) return;

      this.kkLocMapMaterialCache.clear();
      const byKey = new Map<string, {
        materialCode: string;
        warehouse: KkWarehouse;
        stock: number;
        checked: number;
        totalLines: number;
      }>();
      const matDocs = snap?.docs || [];
      for (let i = 0; i < matDocs.length; i++) {
        if (i > 0 && i % 400 === 0) {
          await this.yieldUi();
          if (loadId !== this.kkLocMapLoadId) return;
        }
        const doc = matDocs[i];
        const data = doc.data() as any;
        const stock = this.stockFromInventoryDoc(data);
        if (stock <= 0) continue;
        if (this.isKkQcNgData(data)) continue;
        const materialCode = String(data.materialCode || '').trim().toUpperCase();
        if (!materialCode) continue;
        const warehouse = this.kkWarehouseFromLocation(this.locationFromInventoryDoc(data));
        const key = `${warehouse}|${materialCode}`;
        const kkOn = this.isKkFlagOn(data.kkChecked);
        const cur = byKey.get(key) || {
          materialCode,
          warehouse,
          stock: 0,
          checked: 0,
          totalLines: 0
        };
        cur.stock += stock;
        cur.totalLines += 1;
        if (kkOn) cur.checked += 1;
        byKey.set(key, cur);
        const material = this.mapKkInventoryDoc(doc);
        material.kkChecked = kkOn;
        const list = this.kkLocMapMaterialCache.get(key) || [];
        list.push(material);
        this.kkLocMapMaterialCache.set(key, list);
      }

      const warehouseOrder: Record<string, number> = { D1: 0, '00': 1, J: 2, ASM3: 3 };
      this.kkLocMapByMaterial = Array.from(byKey.values())
        .map((v) => {
          const key = `${v.warehouse}|${v.materialCode}`;
          const pallet = this.palletSummaryOf(this.kkLocMapMaterialCache.get(key) || []);
          return {
            ...v,
            remaining: Math.max(0, v.totalLines - v.checked),
            palletId: pallet.palletId,
            palletMixed: pallet.palletMixed,
            palletSaved: pallet.palletId,
            location: '',
            locationSaved: ''
          };
        })
        .sort((a, b) => {
          const codeCmp = a.materialCode.localeCompare(b.materialCode, 'en', { numeric: true });
          if (codeCmp) return codeCmp;
          return (warehouseOrder[a.warehouse] ?? 9) - (warehouseOrder[b.warehouse] ?? 9);
        });
      this.readTracker.track('materials', 'inventory-materials', snap?.docs?.length || 0);
    } catch (e) {
      if (loadId !== this.kkLocMapLoadId) return;
      console.error('❌ loadKkByMaterial:', e);
      this.kkLocMapByMaterial = [];
      appAlert('❌ Không tải được Kiểm tra KK theo mã hàng.');
    } finally {
      this.finishKkLocMapLoad(loadId);
    }
  }

  private async loadKkCatalogMeta(forceRefresh = false): Promise<void> {
    this.kkLocMapBusy = true;
    this.kkLocMapStatus = 'Đang tải danh mục KK…';
    this.cdr.detectChanges();
    try {
      this.kkCatalogEntries = await this.kkCatalog.loadAll(forceRefresh);
      this.kkCatalogTypeMap = await this.kkCatalog.loadAllAsMap();
      try {
        this.kkTypeHomeLocs = await this.kkCatalog.loadHomeLocs(forceRefresh);
      } catch (homeErr) {
        console.error('❌ loadHomeLocs:', homeErr);
      }
      try {
        this.kkTypeManagers = await this.kkCatalog.loadManagers(forceRefresh);
      } catch (mgrErr) {
        console.error('❌ loadManagers:', mgrErr);
      }
      this.invalidateKkTypeViewCache();
    } catch (e) {
      console.error('❌ loadKkCatalogMeta:', e);
      this.kkCatalogEntries = [];
      this.kkCatalogTypeMap = new Map();
    } finally {
      this.kkLocMapBusy = false;
      this.kkLocMapStatus = '';
      this.cdr.detectChanges();
      if (this.kkEffectiveSearchQuery() && !this.kkStockLoaded) {
        this.playKkStock();
      }
    }
  }

  protected async loadKkCatalogForMap(forceRefresh = false): Promise<void> {
    const loadId = ++this.kkLocMapLoadId;
    this.kkLocMapBusy = true;
    this.kkLocMapStatus = 'Đang tải danh mục KK…';
    if (this.kkLocMapView === 'type' || this.kkLocMapView === 'manager') {
      this.kkLocMapLoading = false;
    } else {
      this.kkLocMapLoading = true;
    }
    this.cdr.detectChanges();
    let handedOff = false;
    try {
      this.kkCatalogEntries = await this.kkCatalog.loadAll(forceRefresh);
      this.kkCatalogTypeMap = await this.kkCatalog.loadAllAsMap();
      try {
        this.kkTypeHomeLocs = await this.kkCatalog.loadHomeLocs(forceRefresh);
      } catch (homeErr) {
        console.error('❌ loadHomeLocs:', homeErr);
      }
      try {
        this.kkTypeManagers = await this.kkCatalog.loadManagers(forceRefresh);
      } catch (mgrErr) {
        console.error('❌ loadManagers:', mgrErr);
      }
      if (loadId !== this.kkLocMapLoadId) return;
      this.invalidateKkTypeViewCache();
      this.cdr.detectChanges();
      if (this.kkLocMapView === 'type' || this.kkLocMapView === 'manager') {
        this.kkLocMapStatus = 'Đang đọc tồn kho…';
        this.cdr.detectChanges();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        handedOff = true;
        await this.loadKkByType(loadId);
      }
    } catch (e) {
      console.error('❌ loadKkCatalogForMap:', e);
      this.kkCatalogEntries = [];
      this.kkCatalogTypeMap = new Map();
    } finally {
      if (!handedOff) this.finishKkLocMapLoad(loadId, false);
    }
  }

  private get linkQCheckActive(): boolean {
    return this.linkQCheckOnly && this.linkQCheckSet.size > 0;
  }

  /** Bộ dữ liệu gốc của trang: toàn bộ, hoặc chỉ mã trong file Check khi bật Check. */
  private linkQCompareBaseRows(): LinkQCompareRow[] {
    if (!this.linkQCheckActive) return this.linkQCompareRows;
    return this.linkQCompareRows.filter((r) => this.linkQCheckSet.has(r.code));
  }

  /** Đếm tab / tổng tồn theo bộ gốc rồi lọc lại bảng. */
  protected recomputeLinkQCompareBase(): void {
    const rows = this.linkQCompareBaseRows();
    if (this.linkQCheckActive) {
      const present = new Set(rows.map((r) => r.code));
      this.linkQCheckMissing = this.linkQCheckCodes.filter((c) => !present.has(c) && !MaterialsComponent.isLinkQCompareExcluded(c));
    } else {
      this.linkQCheckMissing = [];
    }
    const counts = { all: rows.length, linkq: 0, diff: 0, diffPos: 0, diffNeg: 0, linkqOnly: 0, webOnly: 0 };
    const totals = { linkQ: 0, web: 0 };
    for (const r of rows) {
      totals.web += r.web;
      if (r.kind === 'webOnly') {
        counts.webOnly++;
        continue;
      }
      counts.linkq++;
      totals.linkQ += r.linkQ || 0;
      if (r.isDiff) {
        counts.diff++;
        // Lệch dương: web > LinkQ · lệch âm: LinkQ > web (diff = web − LinkQ)
        if (r.diff > 0) counts.diffPos++;
        else counts.diffNeg++;
      }
      if (r.kind === 'linkqOnly') counts.linkqOnly++;
    }
    this.linkQCompareCounts = counts;
    this.linkQCompareTotals = totals;
    this.refreshLinkQCompareView();
  }

  /** Lọc theo tab + ô tìm, sắp xếp, rồi render trang đầu. */
  protected refreshLinkQCompareView(): void {
    const q = this.normalizeTieuHuyCode(this.linkQCompareQuery);
    const tab = this.linkQCompareTab;
    const list = this.linkQCompareBaseRows().filter((r) => {
      if (q && !r.code.includes(q)) return false;
      switch (tab) {
        case 'diff': return r.kind !== 'webOnly' && r.isDiff;
        case 'diffPos': return r.kind !== 'webOnly' && r.isDiff && r.diff > 0;
        case 'diffNeg': return r.kind !== 'webOnly' && r.isDiff && r.diff < 0;
        case 'linkqOnly': return r.kind === 'linkqOnly';
        case 'webOnly': return r.kind === 'webOnly';
        case 'linkq': return r.kind !== 'webOnly';
        default: return true;
      }
    });
    const { key, dir } = this.linkQCompareSort;
    list.sort((a, b) => {
      let c = 0;
      if (key === 'linkQ') c = (a.linkQ ?? -Infinity) - (b.linkQ ?? -Infinity);
      else if (key === 'web') c = a.web - b.web;
      else if (key === 'diff') c = Math.abs(a.diff) - Math.abs(b.diff);
      if (c === 0) c = a.code.localeCompare(b.code, 'en', { numeric: true });
      return c * dir;
    });
    this.linkQCompareVisibleRows = list;
    this.linkQCompareShownRows = list.slice(0, MaterialsComponent.LINKQ_COMPARE_PAGE);
    if (this.linkQSheetEl) this.linkQSheetEl.scrollTop = 0;
  }

  private linkQCheckStorageKey(): string {
    return `materials-linkq-check:${this.selectedFactory}`;
  }

  protected loadLinkQCheckStored(): void {
    let mode: DsCheckMode = '';
    try {
      const raw = localStorage.getItem(this.linkQCheckStorageKey());
      const saved = raw ? JSON.parse(raw) : null;
      // Bản cũ chỉ lưu { on } → coi như "Mục sẽ xài"
      mode = DS_CHECK_MODES.includes(saved?.mode) ? saved.mode : (saved?.on ? 'willUse' : '');
    } catch {
      mode = '';
    }
    this.pendingCheckMode = mode;
    void this.loadPlanCheckList();
  }

  private readonly materialPlan = inject(MaterialPlanService);
  private readonly invStockReportSvc = inject(InventoryStockReportService);
  /** Kế hoạch NVL chỉ tải 1 lần mỗi lần mở trang (dùng chung 2 nhà máy). */
  private planCheckLoad: Promise<void> | null = null;
  /** Mục đã lưu, áp khi danh sách tải xong. */
  private pendingCheckMode: DsCheckMode = '';
  /** Mục DS Check đang chọn ('' = tắt). */
  dsCheckMode: DsCheckMode = '';
  /** Các mục DS Check từ Kế hoạch NVL (tab Report). */
  dsCheckLists: Record<Exclude<DsCheckMode, ''>, string[]> = { willUse: [], usedUp: [] };
  readonly dsCheckOptions: Array<{ mode: Exclude<DsCheckMode, ''>; label: string; hint: string }> = [
    { mode: 'willUse', label: 'Mục sẽ xài', hint: 'Mã có nhu cầu xuất từ đầu tháng này trở đi (hoặc còn nợ cũ)' },
    { mode: 'usedUp', label: 'Mục xài hết', hint: 'Mã mà nhu cầu các tháng tới ≥ tồn trong file kế hoạch — tồn sẽ dùng hết' }
  ];

  /**
   * DS Check theo Kế hoạch NVL (bản import mới nhất), chỉ tính mốc ngày từ đầu tháng này:
   *  - Mục sẽ xài: có nợ cũ (Shortage) hoặc có lượng xuất;
   *  - Mục xài hết: có tồn trong file và tổng cần xuất (nợ cũ + xuất) ≥ tồn đó.
   */
  private loadPlanCheckList(): Promise<void> {
    if (this.planCheckLoad) {
      return this.planCheckLoad.then(() => this.applyDsCheckMode(this.pendingCheckMode, false));
    }
    this.planCheckLoad = (async () => {
      const lists: Record<Exclude<DsCheckMode, ''>, string[]> = { willUse: [], usedUp: [] };
      try {
        const plan = await this.materialPlan.loadLatest();
        const now = new Date();
        const fromKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const idx = (plan?.buckets || []).map((b, i) => (b >= fromKey ? i : -1)).filter((i) => i >= 0);
        const seen = new Set<string>();
        for (const row of plan?.rows || []) {
          const code = this.normalizeTieuHuyCode(row.code);
          if (!code || seen.has(code)) continue;
          const shortage = Number(row.shortage) || 0;
          const out = shortage + idx.reduce((a, i) => a + (Number(row.outQty?.[i]) || 0), 0);
          if (out <= 0.0005) continue;
          seen.add(code);
          lists.willUse.push(code);
          const stock = Number(row.stock) || 0;
          if (stock > 0.0005 && out >= stock - 0.0005) lists.usedUp.push(code);
        }
        this.linkQCheckFileName = plan ? `Kế hoạch NVL: ${plan.fileName}` : '';
      } catch (e) {
        console.warn('[DS Check] đọc Kế hoạch NVL lỗi', e);
        this.linkQCheckFileName = '';
      }
      this.dsCheckLists = lists;
      this.planUsedUpSet = new Set(lists.usedUp);
      this.cdr.markForCheck();
    })();
    return this.planCheckLoad.then(() => this.applyDsCheckMode(this.pendingCheckMode, false));
  }

  /** Mã "Mục xài hết" (nhu cầu kế hoạch ≥ tồn trong file) — tô cam ở mọi bảng của trang. */
  private planUsedUpSet = new Set<string>();

  override isPlanUsedUp(code: string | null | undefined): boolean {
    return this.planUsedUpSet.size > 0 && this.planUsedUpSet.has(this.normalizeTieuHuyCode(code));
  }

  override planUsedUpTitle(code: string | null | undefined): string {
    return this.isPlanUsedUp(code) ? 'Kế hoạch NVL: nhu cầu các tháng tới ≥ tồn — mã này sẽ dùng hết tồn kho' : '';
  }

  /** Chọn mục DS Check ('' = tắt). */
  setDsCheckMode(mode: DsCheckMode): void {
    this.applyDsCheckMode(mode, true);
  }

  private applyDsCheckMode(mode: DsCheckMode, save: boolean): void {
    const codes = mode ? this.dsCheckLists[mode] || [] : [];
    this.dsCheckMode = codes.length ? mode : '';
    // Tắt: vẫn giữ danh sách "Mục sẽ xài" để nút hiện số mã
    this.linkQCheckCodes = codes.length ? codes : this.dsCheckLists.willUse;
    this.linkQCheckSet = new Set(this.linkQCheckCodes);
    this.linkQCheckOnly = !!this.dsCheckMode;
    if (save) this.saveLinkQCheckStored();
    this.recomputeLinkQCompareBase();
    this.invalidateKkTypeViewCache();
    this.cdr.detectChanges();
  }

  get dsCheckLabel(): string {
    return this.dsCheckOptions.find((o) => o.mode === this.dsCheckMode)?.label || '';
  }

  protected saveLinkQCheckStored(): void {
    this.pendingCheckMode = this.dsCheckMode;
    try {
      localStorage.setItem(this.linkQCheckStorageKey(), JSON.stringify({ mode: this.dsCheckMode }));
    } catch {
      /* localStorage đầy / bị chặn — chỉ giữ trong phiên */
    }
  }

  kkLocMapStatus = '';
  /** Box loại hàng đã đọc tồn riêng (bấm vào box) khi chưa đọc tồn toàn kho. */
  protected kkBoxStockLoaded = new Set<string>();
  kkBoxStockLoadingKey: string | null = null;
  kkLocMapBoxes: Array<{ loc: string; checked: number; total: number }> = [];
  kkLocMapByMaterial: KkLocMaterialRow[] = [];
  protected kkLocMapRowCache = new Map<string, InventoryMaterial[]>();
  protected kkLocMapLoadId = 0;
  kkLocMapBusy = false;
  /** warehouse|mã — dòng tổng đang xổ chi tiết PO/IMD trong popup. */
  /** warehouse|mã — dòng tổng đang xổ chi tiết PO/IMD trong popup. */
  kkLocMapExpandedKey: string | null = null;
  kkTypePage = 1;
  kkTypePageSize = 20;
  /** Số dòng mỗi trang tự vừa chiều cao bảng (không phải kéo dọc). */
  kkTypePageAuto = true;
  kkTypeSearchDraft = '';
  kkTypeShowExtraFilter = false;
  protected kkTypeListScrollTop = 0;
  kkConnectorRackView: Record<string, { shelf: string; level: number }> = {
    B009: { shelf: 'S07', level: 1 },
    B016: { shelf: 'S11', level: 1 },
    B017: { shelf: 'S23', level: 1 },
    B018: { shelf: 'S01', level: 1 }
  };
  /** Mở danh sách mã phẳng (Chi tiết) theo đầu mã B009/B016/B018 — đã thay bằng bảng KK */
  kkConnectorFloorCodesOpen: Record<string, boolean> = {};
  /** null = chưa set, mọi vị trí đều chọn được. */
  kkMucAllowedLocs: Record<string, string[] | null> = {};
  kkMucExtraShelves: Record<string, string[]> = {};
  kkMucRemovedShelves: Record<string, string[]> = {};
  /** Tab UI màn scan pro: Scan | Vị trí | Nhật ký */
  kkTypeScanUiTab: 'scan' | 'shelf' | 'log' = 'scan';
  kkTypeScanBusy = false;
  nlScanLastReadMs: number | null = null;

  protected yieldUi(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  showNlDevicePicker = false;
  nlPdaBuffer = '';
  nlCameraPurpose: 'search' | 'location' | 'kk' = 'search';

  startNlSearchScan(): void {
    this.nlScanDevice = 'pda';
    this.stopNlCamera();
    this.nlPdaBuffer = '';
    this.showNlPdaScan = true;
    setTimeout(() => this.focusNlPdaInput(), 50);
  }

  startNlKkScan(): void {
    if (!this.canEdit || this.isLoading) return;
    this.nlScanDevice = 'pda';
    this.stopNlCamera();
    // Cập nhật vị trí: scan kệ S/R (kể cả R10-1…) → scan mã — chỉ đổi vị trí
    this.openKkTypeScanModal(undefined, 'location');
  }

  private lockKkScanKeyboard(): void {
    const meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    if (meta && !this.kkPrevViewport) {
      this.kkPrevViewport = meta.content || '';
      if (!/interactive-widget/.test(meta.content || '')) {
        meta.content = `${meta.content || ''}, interactive-widget=overlays-content`.replace(/^,\s*/, '');
      }
    }
    try {
      const vk = (navigator as Navigator & { virtualKeyboard?: { overlaysContent: boolean } }).virtualKeyboard;
      if (vk) vk.overlaysContent = true;
    } catch { /* ignore */ }
    document.body.classList.add('kk-scan-kb-lock');
    this.attachKkDocScan();
  }

  /** Khóa scroll .main-panel khi mở chi tiết KK — tránh thanh kéo ngoài làm lệch footer. */
  protected syncKkPageLock(): void {
    const lock = !this.isMobile
      && !!(this.showKkLocMap || this.isNguyenLieuPage)
      && !!this.kkActiveProductType;
    document.body.classList.toggle('kk-page-lock', lock);
    if (lock) {
      const panel = document.querySelector('.main-panel') as HTMLElement | null;
      if (panel) panel.scrollTop = 0;
      window.scrollTo(0, 0);
    }
  }

  private attachKkDocScan(): void {
    if (this.kkDocScanHandler) return;
    this.kkDocScanHandler = (event: KeyboardEvent) => this.onKkDocScanKey(event);
    document.addEventListener('keydown', this.kkDocScanHandler, true);
  }

  private onKkDocScanKey(event: KeyboardEvent): void {
    if (!this.showKkTypeScanModal) return;
    if (this.showKkTypeScanConfirm) return;
    // Mã NV chỉ nhập tay
    if (this.kkTypeScanStep === 'operator') return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('.kk-type-scan__std')) return;
    // Ô trap đang focus: để bindHidScanInput nhận ký tự native
    if (
      target &&
      (target.id === 'kkTypeScanLocationInput' || target.id === 'kkTypeScanQrInput')
    ) {
      return;
    }
    // PDA: bắt cấp document khi ô mất focus (cả kệ lẫn mã hàng)
    if (this.kkTypeScanStep === 'codes' && this.nlScanDevice !== 'pda') return;
    const key = event.key;
    if (!key || key === 'Escape' || key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') return;
    if (key === 'Tab' || key === 'Enter') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.flushKkDocScan(true);
      return;
    }
    if (key === 'Backspace') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.kkDocScanBuf = this.kkDocScanBuf.slice(0, -1);
      this.paintKkDocScanBuf();
      return;
    }
    if (key.length !== 1) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!this.kkDocScanAt) this.kkDocScanAt = performance.now();
    this.kkDocScanBuf += key;
    this.paintKkDocScanBuf();
    // Đợi tem đủ dài — không cắt sớm
    const idle = this.kkTypeScanStep === 'codes' ? 220 : 200;
    this.scheduleKkDocScanFlush(idle);
  }

  private scheduleKkDocScanFlush(idleMs: number): void {
    if (this.kkDocScanTimer) clearTimeout(this.kkDocScanTimer);
    this.kkDocScanTimer = setTimeout(() => {
      this.kkDocScanTimer = null;
      this.flushKkDocScan();
    }, idleMs);
  }

  private paintKkDocScanBuf(): void {
    const id = this.kkActiveScanInputId();
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = this.kkDocScanBuf;
    if (this.kkTypeScanStep === 'operator') this.kkTypeScanOperatorInput = this.kkDocScanBuf;
    if (this.kkTypeScanStep === 'location') this.kkTypeScanLocationInput = this.kkDocScanBuf;
  }

  private flushKkDocScan(fromEnter = false): void {
    if (this.kkDocScanTimer) {
      clearTimeout(this.kkDocScanTimer);
      this.kkDocScanTimer = null;
    }
    const raw = String(this.kkDocScanBuf || '')
      .replace(/[\r\n\t]+/g, '')
      .replace(/[\u0000-\u001F]/g, '')
      .trim();
    if (this.kkTypeScanStep === 'operator' && !fromEnter) {
      this.pinKkScanFocus();
      return;
    }
    // Không từ Enter: chỉ nhận khi tem đủ dạng (tránh cắt sớm)
    if (!fromEnter) {
      if (this.kkTypeScanStep === 'location') {
        const t = raw.toUpperCase().replace(/\s+/g, '');
        if (!/^[SR]\d{1,2}(?:-\d+(?:-\d+)?)?$/.test(t)) {
          this.pinKkScanFocus();
          return;
        }
      } else if (this.kkTypeScanStep === 'codes') {
        const parts = raw.split('|');
        if (parts.length < 3 || parts[0].trim().length < 4) {
          this.pinKkScanFocus();
          return;
        }
      }
    }
    this.kkDocScanBuf = '';
    this.kkDocScanAt = 0;
    this.paintKkDocScanBuf();
    if (!raw) {
      this.pinKkScanFocus();
      return;
    }
    if (this.kkTypeScanStep === 'operator') {
      this.submitKkTypeScanOperator(undefined, raw);
    } else if (this.kkTypeScanStep === 'location') {
      this.submitKkTypeScanLocation(undefined, raw);
    } else {
      this.enqueueKkTypeScanCode(raw, 0);
    }
    this.pinKkScanFocus();
  }

  /** Tem NV: chỉ lấy 7 ký tự đầu ASP + 4 số, bỏ phần còn lại. */
  private parseKkEmployeeBadge(raw: string): string {
    const compact = String(raw || '')
      .replace(/[\r\n\t]+/g, '')
      .replace(/[\u0000-\u001F]/g, '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (!compact) return '';
    const found = compact.match(/ASP\d{4}/);
    if (found) return found[0];
    const head = compact.slice(0, 7);
    if (/^ASP\d{4}$/.test(head)) return head;
    if (/^\d{4}/.test(compact)) return `ASP${compact.slice(0, 4)}`;
    return head;
  }

  extractMaterialCodeFromScan(raw: string): string {
    const t = String(raw || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!t) return '';
    if (t.includes('|')) {
      return t.split('|').map((p) => p.trim()).find(Boolean) || '';
    }
    return t.split(/[\s,;]+/)[0] || t;
  }

  applyNlSearchScan(raw: string): void {
    const code = this.extractMaterialCodeFromScan(raw);
    if (!code) {
      appAlert('Không đọc được mã hàng. Quét lại tem.');
      return;
    }
    this.searchTerm = code;
    this.showNlPdaScan = false;
    this.nlPdaBuffer = '';
    this.stopNlCamera();
    void this.performSearch(code);
  }

  private focusNlPdaInput(): void {
    const el = document.getElementById('nl-pda-scan-input') as HTMLInputElement | null;
    if (!el) return;
    this.suppressVirtualKeyboard(el);
    el.focus({ preventScroll: true });
    this.bindHidScanInput(el, (raw, readMs) => {
      this.nlScanLastReadMs = readMs;
      this.applyNlSearchScan(raw);
    }, { idleMs: 50 });
  }

  private kkLocMatMemo: { key: unknown[]; rows: KkLocMaterialRow[] } | null = null;

  /** Lọc bảng theo mã — chỉ tính lại khi dữ liệu/bộ lọc đổi (trước đây lọc lại mỗi lần vẽ màn hình). */
  get kkLocMapFilteredMaterials(): KkLocMaterialRow[] {
    const key: unknown[] = [
      this.kkLocMapByMaterial, this.kkEffectiveSearchQuery(), this.kkLocMapWarehouseFilter,
      this.kkJOnly, this.kkWh3Only, this.kkCountWh3, this.kkFilterUncheckedOnly,
      this.kkCheckActive, this.linkQCheckSet
    ];
    const m = this.kkLocMatMemo;
    if (m && m.key.length === key.length && m.key.every((v, i) => v === key[i])) return m.rows;
    const rows = this.computeKkLocMapFilteredMaterials();
    this.kkLocMatMemo = { key, rows };
    return rows;
  }

  trackKkLocMaterialRow = (_: number, row: KkLocMaterialRow): string => this.kkMaterialRowKey(row);

  private computeKkLocMapFilteredMaterials(): KkLocMaterialRow[] {
    let rows = this.kkLocMapByMaterial;
    const q = this.kkEffectiveSearchQuery();
    if (q) rows = rows.filter((r) => this.kkCodeMatchesSearch(r.materialCode, q));
    if (this.kkLocMapWarehouseFilter) {
      rows = rows.filter((r) => r.warehouse === this.kkLocMapWarehouseFilter);
    }
    rows = rows.filter((r) => this.kkMatchesWh3Mode(r.warehouse));
    if (this.kkFilterUncheckedOnly) {
      rows = rows.filter((r) => r.remaining > 0);
    }
    if (this.kkCheckActive) rows = rows.filter((r) => this.kkCheckHas(r.materialCode));
    return rows;
  }

  /** Tên hãng/đầu loại (Molex, JST…) — bỏ màu và thông số. */
  protected kkTypeNameHeadOf(productType: string): string {
    const raw = String(productType || '').trim();
    if (!raw) return '';
    const tokens = raw.split(/\s+/).filter(Boolean);
    const skip = new Set([
      'DEN', 'TRANG', 'DO', 'XANH', 'VANG', 'NAU', 'XAM', 'CAM', 'HONG', 'TIM',
      'BLACK', 'WHITE', 'RED', 'BLUE', 'YELLOW', 'GREEN', 'GREY', 'GRAY', 'BROWN', 'ORANGE'
    ]);
    const isSpec = (t: string): boolean => {
      const u = t.toUpperCase().replace(/[(),]/g, '');
      if (!u) return true;
      if (/^\d/.test(u)) return true;
      if (/^(AWG|MM|CM|M|IN|MIL|V|A|W|KG|G|PCS|PC|Ø|PHI)$/.test(u)) return true;
      if (/\d/.test(u)) return true;
      return false;
    };
    const head: string[] = [];
    for (const t of tokens) {
      if (skip.has(this.foldKkTypeName(t))) continue;
      if (isSpec(t)) break;
      head.push(t);
    }
    return head.length ? head.join(' ') : raw;
  }

  protected kkConnectorRackShelves(prefix: string): Array<{
    shelf: string;
    from: number;
    to: number;
    perFloor: number;
  }> {
    const removed = new Set(this.kkMucRemovedShelves[prefix] || []);
    return this.kkConnectorRackShelfDefs(prefix).filter((row) => !removed.has(row.shelf));
  }

  protected kkConnectorRackShelfDefs(prefix: string): Array<{
    shelf: string;
    from: number;
    to: number;
    perFloor: number;
  }> {
    if (prefix === 'B017') {
      return [
        { shelf: 'S23', from: 1, to: 40, perFloor: 20 },
        { shelf: 'S24', from: 41, to: 80, perFloor: 20 },
        { shelf: 'S25', from: 81, to: 999, perFloor: 20 }
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
    if (prefix === 'B018') {
      return [
        { shelf: 'S01', from: 1, to: 200, perFloor: 50 },
        { shelf: 'S03', from: 201, to: 600, perFloor: 80 },
        { shelf: 'S05', from: 601, to: 999, perFloor: 80 }
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
    return [];
  }

  private kkConnectorFloorRange(
    s: { from: number; to: number; perFloor: number },
    lv: number
  ): { from: number; to: number } | null {
    if (lv < 1 || lv > 5 || s.from <= 0) return null;
    const from = s.from + (lv - 1) * s.perFloor;
    if (from > s.to) return null;
    return { from, to: Math.min(from + s.perFloor - 1, s.to) };
  }

  isKkConnectorRackMuc(category: string): boolean {
    return category === 'B009' || category === 'B016' || category === 'B018';
  }

  kkShelfBlockNos(shelf: string): number[] {
    const n = jKhoMatBlocksForRow(shelf);
    return Array.from({ length: n }, (_, i) => i + 1);
  }

  protected kkConnectorRangeText(prefix: string, from: number, to: number): string {
    return `${this.kkConnectorCode(prefix, from)} ~ ${this.kkConnectorCode(prefix, to)}`;
  }

  protected kkConnectorSeqOf(prefix: string, groupCode: string): number | null {
    const g = this.kkCatalog.normalizeGroupCode(groupCode)
      || this.kkCatalog.groupCodeFromMaterial(groupCode)
      || String(groupCode || '').trim().toUpperCase();
    const m = new RegExp(`^${prefix}(\\d{3})$`).exec(g);
    if (!m) return null;
    return Number(m[1]);
  }

  protected kkPageBodyEl(): HTMLElement | null {
    return document.querySelector('.kk-page .kk-page__body');
  }

  kkConnectorViewShelf(category: string): string {
    return this.kkConnectorRackView[category]?.shelf || '';
  }

  kkConnectorViewLevel(category: string): number {
    return this.kkConnectorRackView[category]?.level || 1;
  }

  protected async saveKkMucShelfState(category: string, shelves: string[], removed: string[]): Promise<void> {
    const prev = this.kkMucExtraShelves[category] || [];
    const prevRemoved = this.kkMucRemovedShelves[category] || [];
    this.kkMucShelfSaving = true;
    this.kkMucExtraShelves = { ...this.kkMucExtraShelves, [category]: shelves };
    this.kkMucRemovedShelves = { ...this.kkMucRemovedShelves, [category]: removed };
    this.invalidateKkTypeViewCache();
    this.cdr.detectChanges();
    try {
      await this.firestore.collection('kk-muc-allowed-locs').doc(category).set({
        category,
        parentShelves: shelves,
        removedParentShelves: removed,
        updatedAt: firebase.default.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      this.kkMucShelfDraft = '';
      this.kkMucShelfSaving = false;
      this.cdr.detectChanges();
    } catch (e) {
      console.error('saveKkMucShelfState', e);
      this.kkMucExtraShelves = { ...this.kkMucExtraShelves, [category]: prev };
      this.kkMucRemovedShelves = { ...this.kkMucRemovedShelves, [category]: prevRemoved };
      this.invalidateKkTypeViewCache();
      this.kkMucShelfSaving = false;
      appAlert('Không lưu được kệ mẹ.');
      this.cdr.detectChanges();
    }
  }

  /** Chi tiết tầng B009/B016/B018 → giao diện kiểm kê, mọi mã set cho vị trí tầng đó. */
  openKkConnectorFloorKkDetail(category: string, event?: Event): void {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const prefix = String(category || '').trim().toUpperCase();
    if (!this.isKkConnectorRackMuc(prefix)) return;
    const shelf = this.kkConnectorViewShelf(prefix);
    const level = this.kkConnectorViewLevel(prefix);
    if (!shelf) return;
    const rack = this.kkConnectorRackShelves(prefix).find((s) => s.shelf === shelf);
    if (!rack) return;
    const range = this.kkConnectorFloorRange(rack, level);
    if (!range?.from || range.to < range.from) return;
    const locs = this.kkShelfBlockNos(shelf).map((b) => this.kkB009LocOf(shelf, b, level));
    const title = `${shelf}-T${level} · ${this.kkConnectorRangeText(prefix, range.from, range.to)}`;
    this.kkAllStockDetail = false;
    this.kkConnectorFloorDetail = {
      prefix,
      shelf,
      level,
      from: range.from,
      to: range.to,
      locs,
      title
    };
    this.kkConnectorFloorCodesOpen = { ...this.kkConnectorFloorCodesOpen, [prefix]: false };
    this.kkActiveProductType = title;
    this.kkActiveSourceProductType = title;
    this.kkActivePinSplit = null;
    const draft = this.buildEmptyKkTypeRow(title);
    draft.productType = title;
    draft.groupCodes = this.kkB009FloorCodes(prefix, {
      title: this.kkConnectorRangeText(prefix, range.from, range.to)
    });
    this.kkActiveTypeDraft = draft;
    this.kkTypePage = 1;
    this.kkTypeDetailQuery = '';
    this.kkTypeSearchDraft = '';
    this.kkTypeFilterLoc = '';
    this.kkTypeFilterWh = '';
    this.kkTypeFilterRolls = '';
    this.kkTypeSortQtyDesc = false;
    this.kkTypeSortRollsDesc = false;
    this.kkTypeSortKkTimeDesc = false;
    this.kkTypeShowExtraFilter = false;
    this.kkTypeDetailSig = '';
    if (!this.kkStockLoaded) void this.loadKkByType();
    this.syncKkPageLock();
    this.cdr.detectChanges();
    setTimeout(() => void this.ensureKkTypeMaterialNames(), 0);
  }

  /** Danh sách mã phẳng trên tầng đang chọn (B009001…), không nhóm theo P. */
  kkB009FloorCodes(prefix: string, sub: { title: string }): string[] {
    const r = this.kkB009SubRangeNums(sub);
    if (!r) {
      // title dạng B009001 ~ B009050
      const m = /B\d{3}(\d{3})\s*~\s*B\d{3}(\d{3})/i.exec(sub?.title || '');
      if (!m) return [];
      const from = Number(m[1]);
      const to = Number(m[2]);
      if (!from || !to || to < from) return [];
      const out: string[] = [];
      for (let n = from; n <= to; n++) out.push(this.kkConnectorCode(prefix, n));
      return out;
    }
    const out: string[] = [];
    for (let n = r.from; n <= r.to; n++) out.push(this.kkConnectorCode(prefix, n));
    return out;
  }

  kkB009LocOf(shelf: string, block: number, level: number): string {
    return `${shelf}-${block}-${level}`;
  }

  protected kkB009SubRangeNums(sub: { title: string }): { from: number; to: number } | null {
    const m = /B\d{3}(\d{3})\s*~\s*B\d{3}(\d{3})/i.exec(sub?.title || '');
    if (!m) return null;
    const from = Number(m[1]);
    const to = Number(m[2]);
    if (!from || !to || to < from) return null;
    return { from, to };
  }

  /** Số AWG trên tên loại (28AWG, 28 AWG, AWG28). Không có → null. */
  private parseKkAwgFromType(productType: string): number | null {
    const u = String(productType || '').toUpperCase().replace(/,/g, ' ');
    const m = /(\d+(?:\.\d+)?)\s*AWG\b/.exec(u) || /\bAWG\s*(\d+(?:\.\d+)?)/.exec(u);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }

  /** Trong cùng mục: vị trí yêu cầu nhỏ nhất trước (S1 / R1 nhỏ nhất). Chưa gán vị trí xuống cuối. */
  protected sortKkTypeBoxesInCategory(
    category: string,
    boxes: typeof this.kkTypeBoxesCached
  ): typeof this.kkTypeBoxesCached {
    const list = [...boxes];
    // Mục chia theo khoảng 100 mã: xếp theo khoảng (001–100, 101–200…)
    if (MaterialsComponent.KK_RANGE_PREFIXES.includes(category)) {
      return list.sort((a, b) => a.productType.localeCompare(b.productType, 'en', { numeric: true }));
    }
    list.sort((a, b) => {
      const byHome = this.compareKkTypeBoxByHomeLoc(a, b);
      if (byHome) return byHome;
      if (category === 'B001') {
        const awgA = this.parseKkAwgFromType(a.productType);
        const awgB = this.parseKkAwgFromType(b.productType);
        if (awgA != null && awgB != null && awgA !== awgB) return awgB - awgA;
        if (awgA != null && awgB == null) return -1;
        if (awgA == null && awgB != null) return 1;
      }
      return this.compareKkTypeBox(a, b);
    });
    return list;
  }

  protected kkTypeBoxHomeLoc(box: {
    productType: string;
    sourceProductType?: string;
    sourceProductTypes?: string[];
  }): string {
    const keys = [
      box.productType,
      box.sourceProductType,
      ...(box.sourceProductTypes || [])
    ].filter(Boolean);
    for (const k of keys) {
      const loc = this.kkTypeHomeLocOf(String(k));
      if (loc) return loc;
    }
    return '';
  }

  /** S1 < S2; R1 < R1-6 < R3. Token khác / trống xuống sau. */
  private parseKkHomeLocRank(token: string): number[] {
    const raw = String(token || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!raw) return [9, 999, 999, 999, 999];
    const s = /^S0*(\d{1,2})(?:-(\d+))?(?:-(\d+))?$/.exec(raw);
    if (s) return [0, Number(s[1]), Number(s[2] || 0), Number(s[3] || 0), 0];
    const posOf = (ch?: string) => (ch ? ch.charCodeAt(0) - 64 : 0);
    const r = parseJRackLocation(raw);
    if (r) return [1, r.rack, r.block || 0, r.level || 0, posOf(r.pos)];
    return [8, 999, 999, 999, 999];
  }

  private minKkHomeLocRank(joined: string): { empty: boolean; rank: number[]; text: string } {
    const tokens = splitMultiLocations(joined).filter(Boolean);
    if (!tokens.length) return { empty: true, rank: [9, 999, 999, 999, 999], text: '' };
    let bestText = tokens[0];
    let bestRank = this.parseKkHomeLocRank(bestText);
    for (let i = 1; i < tokens.length; i++) {
      const rank = this.parseKkHomeLocRank(tokens[i]);
      if (this.compareKkHomeLocRank(rank, bestRank) < 0) {
        bestRank = rank;
        bestText = tokens[i];
      }
    }
    return { empty: false, rank: bestRank, text: String(bestText || '').toUpperCase() };
  }

  private compareKkHomeLocRank(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i] !== b[i]) return a[i] - b[i];
    }
    return a.length - b.length;
  }

  private compareKkTypeBoxByHomeLoc(
    a: { productType: string; sourceProductType?: string; sourceProductTypes?: string[] },
    b: { productType: string; sourceProductType?: string; sourceProductTypes?: string[] }
  ): number {
    const ha = this.minKkHomeLocRank(this.kkTypeBoxHomeLoc(a));
    const hb = this.minKkHomeLocRank(this.kkTypeBoxHomeLoc(b));
    if (ha.empty !== hb.empty) return ha.empty ? 1 : -1;
    const byRank = this.compareKkHomeLocRank(ha.rank, hb.rank);
    if (byRank) return byRank;
    return ha.text.localeCompare(hb.text, 'en', { numeric: true });
  }

  selectKkTypeBox(productType: string): void {
    this.kkThMode = false;
    this.kkWeekMode = false;
    this.kkMucAllDetail = null;
    this.kkTypeListScrollTop = this.kkPageBodyEl()?.scrollTop || 0;
    this.kkAllStockDetail = false;
    this.kkConnectorFloorDetail = null;
    this.ensureKkTypeBoxesCache();
    const box = this.kkTypeBoxesCached.find((b) => b.productType === productType)
      || this.kkTypeBoxesCached.find((b) => !!b.sourceProductTypes?.includes(productType));
    this.kkActiveProductType = box?.productType || productType;
    this.kkActiveSourceProductType = box?.sourceProductType || productType;
    this.kkActivePinSplit = box?.pinSplit || null;
    const draft = this.buildEmptyKkTypeRow(this.kkActiveSourceProductType);
    draft.productType = productType;
    if (box?.groupCodes?.length) draft.groupCodes = box.groupCodes;
    this.kkActiveTypeDraft = draft;
    this.kkTypePage = 1;
    this.kkTypeDetailQuery = this.kkLocMapQuery;
    this.kkTypeSearchDraft = this.kkLocMapQuery;
    this.kkTypeFilterLoc = '';
    this.kkTypeFilterWh = '';
    this.kkTypeFilterRolls = '';
    this.kkTypeSortQtyDesc = false;
    this.kkTypeSortRollsDesc = false;
    this.kkTypeSortKkTimeDesc = false;
    this.kkTypeShowExtraFilter = false;
    if (!this.kkStockLoaded && !this.isKkTypeBoxStockLoaded(box || { productType })) {
      void this.loadKkStockForBox(box || { productType, groupCodes: draft.groupCodes || [] });
    }
    this.syncKkPageLock();
    setTimeout(() => void this.ensureKkTypeMaterialNames(), 0);
    this.scheduleFitKkTypePageSize();
  }

  kkTypeHomeLocOf(productType: string): string {
    return this.kkTypeHomeLocs.get(String(productType || '').trim()) || '';
  }

  /** B009 / B016 / B018: mã theo tầng; tầng không có dải thì from=0. */
  protected kkConnectorAllTrays(prefix: string): Array<{
    loc: string;
    shelf: string;
    block: number;
    level: number;
    from: number;
    to: number;
  }> {
    const out: Array<{ loc: string; shelf: string; block: number; level: number; from: number; to: number }> = [];
    for (const s of this.kkConnectorRackShelves(prefix)) {
      const blocks = jKhoMatBlocksForRow(s.shelf);
      for (let lv = 1; lv <= 7; lv++) {
        const range = this.kkConnectorFloorRange(s, lv);
        const from = range?.from || 0;
        const to = range?.to || 0;
        for (let block = 1; block <= blocks; block++) {
          out.push({
            loc: `${s.shelf}-${block}-${lv}`,
            shelf: s.shelf,
            block,
            level: lv,
            from,
            to
          });
        }
      }
    }
    return out;
  }

  /** Lọc danh sách chi tiết (bảng) theo mã / tên / pallet / vị trí / kho / cuộn / chưa KK. */
  get kkTypeDetailFiltered(): InventoryMaterial[] {
    this.ensureKkTypeDetailCache();
    return this.kkTypeDetailFilteredCached;
  }

  onKkTypeUnifiedSearch(): void {
    this.kkTypeSearchDraft = this.kkLocMapQuery;
    this.kkTypeDetailQuery = this.kkLocMapQuery;
    this.kkTypePage = 1;
    this.invalidateKkTypeViewCache();
  }

  /** "Vừa trang": số dòng = chiều cao vùng bảng ÷ chiều cao 1 dòng. */
  /** Trang Week: cố định 39 dòng / trang. */
  static readonly KK_WEEK_PAGE_SIZE = 39;

  fitKkTypePageSize(): void {
    if (this.kkWeekMode) {
      if (this.kkTypePageSize !== QuanLyNguyenLieuComponent.KK_WEEK_PAGE_SIZE) {
        this.kkTypePageSize = QuanLyNguyenLieuComponent.KK_WEEK_PAGE_SIZE;
        this.cdr.detectChanges();
      }
      return;
    }
    if (!this.kkTypePageAuto || !this.kkActiveProductType) return;
    const box = document.querySelector('.kk-page .kk-type-detail__table') as HTMLElement | null;
    if (!box || !box.clientHeight) return;
    const head = (box.querySelector('thead') as HTMLElement | null)?.offsetHeight || 34;
    const row = Math.max(24, (box.querySelector('tbody tr') as HTMLElement | null)?.offsetHeight || 34);
    const n = Math.max(5, Math.floor((box.clientHeight - head - 4) / row));
    if (n === this.kkTypePageSize) return;
    this.kkTypePageSize = n;
    const pages = Math.max(1, Math.ceil(this.kkTypeDetailFiltered.length / n));
    if (this.kkTypePage > pages) this.kkTypePage = pages;
    this.cdr.detectChanges();
  }

  protected scheduleFitKkTypePageSize(): void {
    setTimeout(() => this.fitKkTypePageSize(), 30);
    setTimeout(() => this.fitKkTypePageSize(), 400);
  }

  get kkTypeDetailTotalPages(): number {
    return Math.max(1, Math.ceil(this.kkTypeDetailFiltered.length / this.kkTypePageSize));
  }

  get kkTypeDetailPaged(): InventoryMaterial[] {
    const all = this.kkTypeDetailFiltered;
    const maxPage = Math.max(1, Math.ceil(all.length / this.kkTypePageSize));
    const page = Math.min(Math.max(1, this.kkTypePage), maxPage);
    const start = (page - 1) * this.kkTypePageSize;
    return all.slice(start, start + this.kkTypePageSize);
  }

  kkMaterialRowKey(row: { materialCode: string; warehouse: string }): string {
    return `${row.warehouse}|${String(row.materialCode || '').trim().toUpperCase()}`;
  }

  toggleKkMaterialExpand(row: KkLocMaterialRow, event?: Event): void {
    event?.stopPropagation();
    const key = this.kkMaterialRowKey(row);
    this.kkLocMapExpandedKey = this.kkLocMapExpandedKey === key ? null : key;
  }

  private nextKkScanOpExpiry(from: Date = new Date()): Date {
    const cutHours = [12, 17, 20];
    for (const h of cutHours) {
      const cut = new Date(from.getFullYear(), from.getMonth(), from.getDate(), h, 0, 0, 0);
      if (from.getTime() < cut.getTime()) return cut;
    }
    return new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1, 12, 0, 0, 0);
  }

  private persistKkScanOpSession(): void {
    if (!this.kkTypeScanOperator || !this.kkTypeScanOpUntil || Date.now() >= this.kkTypeScanOpUntil.getTime()) {
      sessionStorage.removeItem(MaterialsComponent.KK_SCAN_OP_KEY);
      return;
    }
    sessionStorage.setItem(MaterialsComponent.KK_SCAN_OP_KEY, JSON.stringify({
      employeeId: this.kkTypeScanOperator,
      until: this.kkTypeScanOpUntil.getTime()
    }));
  }

  private startKkScanOpSession(employeeId: string): void {
    this.kkTypeScanOperator = employeeId;
    this.kkOperatorIdCache = employeeId;
    this.kkTypeScanOpUntil = this.nextKkScanOpExpiry(new Date());
    this.persistKkScanOpSession();
    this.scheduleKkScanOpExpiry();
  }

  openKkTypeScanModal(row?: KkTypeRow, mode: 'inventory' | 'location' = 'location'): void {
    if (!this.canEdit || this.kkLocMapBusy) return;
    if (row && !row.totalLines) return;
    this.restoreKkScanOpSession();
    this.kkTypeScanMode = mode;
    this.kkTypeScanUiTab = 'scan';
    this.showKkTypeScanModal = true;
    this.kkTypeScanOperatorInput = this.kkTypeScanOperator;
    // Luôn bắt đầu bằng nhập tay mã nhân viên
    this.kkTypeScanStep = 'operator';
    this.kkTypeScanLocation = '';
    this.kkTypeScanLocationInput = '';
    this.kkTypeScanQrInput = '';
    this.kkTypeScanBusy = false;
    this.kkHidQrQueue = [];
    this.kkHidQrDraining = false;
    this.kkTypeScanMaterialCode = '';
    this.kkTypeScanStandardDraft = '';
    this.kkTypeScanOkCount = 0;
    this.kkTypeScanSkipCount = 0;
    this.kkTypeScanMissCount = 0;
    this.kkTypeScanLogs = [];
    this.kkTypeScanLastReadMs = null;
    this.kkTypeScanLastSaveMs = null;
    this.kkTypeScanLastSavePending = false;
    this.kkTypeScanExtraLines = [];
    this.kkTypeScanCartons = {};
    this.kkTypeScanErr = '';
    this.showKkTypeScanConfirm = false;
    this.kkTypeScanConfirm = null;
    this.kkTypeScanLocToast = null;
    if (this.kkTypeScanLocToastTimer) {
      clearTimeout(this.kkTypeScanLocToastTimer);
      this.kkTypeScanLocToastTimer = null;
    }
    this.lockKkScanKeyboard();
    this.cdr.detectChanges();
    setTimeout(() => this.focusKkTypeScanInput('kkTypeScanOperatorInput'), 80);
  }

  submitKkTypeScanOperator(event?: Event, rawOverride?: string): void {
    event?.preventDefault?.();
    const el = (event?.target as HTMLInputElement | undefined)
      || (document.getElementById('kkTypeScanOperatorInput') as HTMLInputElement | null);
    const raw = String(rawOverride ?? el?.value ?? this.kkTypeScanOperatorInput ?? '');
    const shortCode = this.parseKkEmployeeBadge(raw);
    if (!/^ASP\d{4}$/.test(shortCode)) {
      this.kkTypeScanErr = 'Mã nhân viên không đúng. Chỉ nhập tay ASP + 4 số (vd ASP1234).';
      this.kkTypeScanBeep('err');
      this.cdr.detectChanges();
      el?.focus();
      return;
    }
    this.kkTypeScanErr = '';
    this.startKkScanOpSession(shortCode);
    this.kkTypeScanOperatorInput = shortCode;
    this.kkTypeScanStep = 'location';
    this.cdr.detectChanges();
    this.focusKkTypeScanInput('kkTypeScanLocationInput');
  }

  private readKkTypeScanInput(id: string, fallback: string, event?: Event): string {
    const el = (event?.target as HTMLInputElement | undefined)
      || (document.getElementById(id) as HTMLInputElement | null);
    return String(el?.value ?? fallback ?? '')
      .replace(/[\r\n\t]+/g, '')
      .replace(/[\u0000-\u001F]/g, '')
      .trim();
  }

  async submitKkTypeScanCode(event?: Event): Promise<void> {
    event?.preventDefault?.();
    if (this.kkTypeScanStep !== 'codes') return;
    const raw = this.readKkTypeScanInput('kkTypeScanQrInput', this.kkTypeScanQrInput, event);
    this.kkTypeScanQrInput = '';
    const inputEl = document.getElementById('kkTypeScanQrInput') as HTMLInputElement | null;
    if (inputEl) inputEl.value = '';
    if (raw) this.enqueueKkTypeScanCode(raw, 0);
  }

  protected async ensureKkTypeMaterialNames(): Promise<void> {
    try {
      const rows = this.kkTypeDetailPaged;
      // Lấy cả mã đã có tên trên dòng tồn: cột Standard chỉ đọc từ danh mục — trước đây bỏ qua các mã này
      // nên máy nào chưa có cache danh mục trong ngày (chưa mở Danh mục / Materials) thì Standard trống.
      const codes = [...new Set(
        rows.map((m) => String(m.materialCode || '').trim().toUpperCase()).filter(Boolean)
      )].filter((code) => !this.catalogCache.has(code));
      if (!codes.length) return;
      await this.ensureCatalogForMaterialCodes(codes);
      this.applyCatalogToMaterials(rows);
      this.cdr.detectChanges();
    } catch (e) {
      console.warn('[KK] ensureKkTypeMaterialNames:', e);
    }
  }

  protected finishKkLocMapLoad(loadId: number, markStock = true): void {
    if (loadId === this.kkLocMapLoadId) {
      this.kkLocMapLoading = false;
      this.kkLocMapBusy = false;
      this.kkLocMapStatus = '';
      if (markStock) {
        this.kkStockLoaded = true;
        if (this.kkLocMapView === 'type' && this.kkEffectiveSearchQuery()) {
          this.onKkTypeUnifiedSearch();
        }
      }
      this.cdr.detectChanges();
      return;
    }
    if (!this.showKkLocMap) {
      this.kkLocMapLoading = false;
      this.kkLocMapBusy = false;
      this.kkLocMapStatus = '';
    }
  }

  /**
   * `{ docs }` cho các view Sơ đồ KK — đọc qua cache KK theo factory thay vì quét lại
   * 10k doc mỗi lần đổi view. Giữ shape `{ docs }` để các chỗ gọi cũ không phải sửa.
   */
  protected async loadKkInventorySnap(force = false): Promise<{ docs: any[] }> {
    const docs = await this.getKkFactoryDocs(this.selectedFactory, force);
    return { docs };
  }

  async loadKkByType(existingLoadId?: number): Promise<void> {
    const loadId = existingLoadId ?? ++this.kkLocMapLoadId;
    this.kkLocMapBusy = true;
    this.kkLocMapStatus = this.kkLocMapStatus || 'Đang đọc tồn kho theo loại hàng…';
    this.cdr.detectChanges();
    try {
      if (!this.kkCatalogTypeMap.size) {
        this.kkCatalogTypeMap = await this.kkCatalog.loadAllAsMap();
        this.kkCatalogEntries = await this.kkCatalog.loadAll();
      }
      const snap = await this.loadKkInventorySnap();
      if (loadId !== this.kkLocMapLoadId) return;

      this.kkLocMapTypeCache.clear();
      const byType = new Map<string, {
        productType: string;
        groups: Set<string>;
        warehouse: KkWarehouse;
        stock: number;
        checked: number;
        totalLines: number;
      }>();
      const typeDocs = snap?.docs || [];
      for (let i = 0; i < typeDocs.length; i++) {
        if (i > 0 && i % 400 === 0) {
          await this.yieldUi();
          if (loadId !== this.kkLocMapLoadId) return;
        }
        const doc = typeDocs[i];
        const data = doc.data() as any;
        const stock = this.stockFromInventoryDoc(data);
        if (stock <= 0) continue;
        if (this.isKkQcNgData(data)) continue;
        const materialCode = String(data.materialCode || '').trim().toUpperCase();
        if (!materialCode) continue;
        const warehouse = this.kkWarehouseFromLocation(this.locationFromInventoryDoc(data));
        const groupCode = this.kkCatalog.groupCodeFromMaterial(materialCode);
        const productType = this.kkTypeOrGroupOfMaterial(materialCode);
        const kkOn = this.isKkFlagOn(data.kkChecked);
        const cur = byType.get(productType) || {
          productType,
          groups: new Set<string>(),
          warehouse,
          stock: 0,
          checked: 0,
          totalLines: 0
        };
        if (groupCode) cur.groups.add(groupCode);
        cur.stock += stock;
        cur.totalLines += 1;
        if (kkOn) cur.checked += 1;
        byType.set(productType, cur);
        const material = this.mapKkInventoryDoc(doc);
        material.kkChecked = kkOn;
        const list = this.kkLocMapTypeCache.get(productType) || [];
        list.push(material);
        this.kkLocMapTypeCache.set(productType, list);
      }

      this.kkBoxStockLoaded.clear();
      this.kkLocMapByType = Array.from(byType.values())
        .map((v) => ({
          productType: v.productType,
          groupCodes: Array.from(v.groups).sort((a, b) => this.compareNhuaGroupCode(a, b)),
          warehouse: v.warehouse,
          stock: v.stock,
          checked: v.checked,
          totalLines: v.totalLines,
          remaining: Math.max(0, v.totalLines - v.checked),
          location: '',
          locationSaved: ''
        }))
        .sort((a, b) => this.compareKkTypeBox(a, b));
      this.saveKkTypeSkeleton();
      this.invalidateKkTypeViewCache();
      this.readTracker.track('materials', 'inventory-materials', snap?.docs?.length || 0);
    } catch (e) {
      if (loadId !== this.kkLocMapLoadId) return;
      console.error('❌ loadKkByType:', e);
      this.kkLocMapByType = [];
      const timedOut = String((e as any)?.name || e).toLowerCase().includes('timeout');
      appAlert(timedOut
        ? '❌ Hết thời gian đọc tồn kho. Bấm Làm mới để thử lại.'
        : '❌ Không tải được Kiểm tra KK theo loại hàng.');
    } finally {
      this.finishKkLocMapLoad(loadId);
    }
  }

  private saveKkTypeSkeleton(): void {
    try {
      const rows = this.kkLocMapByType.map((r) => ({ t: r.productType, g: r.groupCodes || [] }));
      this.kkTypeSkeletonMemo = { key: this.kkTypeSkeletonKey(), rows };
      localStorage.setItem(this.kkTypeSkeletonKey(), JSON.stringify(rows));
    } catch {
      /* localStorage đầy / bị chặn — bỏ qua */
    }
  }

  isKkTypeBoxStockLoaded(box: { productType: string; sourceProductType?: string; pinSplit?: string }): boolean {
    if (this.kkStockLoaded) return true;
    if (this.kkBoxStockLoaded.has(box.productType)) return true;
    return !!box.pinSplit && !!box.sourceProductType && this.kkBoxStockLoaded.has(`pin:${box.sourceProductType}`);
  }

  /** Khoảng mã hàng [từ, đến] cần đọc cho 1 box. */
  private kkBoxCodeRanges(box: { productType: string; groupCodes?: string[]; sourceProductTypes?: string[] }): Array<[string, string]> {
    const END = '';
    const label = String(box.productType || '').trim().toUpperCase();
    const range = /^(B\d{3})(\d{3})\s*[–-]\s*B\d{3}(\d{3})$/.exec(label);
    if (range) return [[`${range[1]}${range[2]}`, `${range[1]}${range[3]}${END}`]];
    const prefixes = new Set<string>();
    const head = /^([A-Z]\d{3})$/.exec(label);
    if (head) prefixes.add(head[1]);
    for (const src of box.sourceProductTypes || []) {
      const h = /^([A-Z]\d{3})$/.exec(String(src || '').trim().toUpperCase());
      if (h) prefixes.add(h[1]);
    }
    for (const g of box.groupCodes || []) {
      const code = String(g || '').trim().toUpperCase();
      if (!code) continue;
      if (Array.from(prefixes).some((p) => code.startsWith(p))) continue;
      prefixes.add(code);
    }
    return Array.from(prefixes).map((p) => [p, p + END] as [string, string]);
  }

  /** Bấm box khi chưa đọc tồn toàn kho: chỉ đọc tồn các mã thuộc box đó. */
  loadKkStockForBox(box: KkStockBoxRef): Promise<void> {
    return this.loadKkStockForBoxes([box], box.productType);
  }

  /** Đọc tồn cho một nhóm box (1 box hoặc cả mục). Nhiều nhóm mã thì gom theo đầu mã B+3 để ít truy vấn. */
  async loadKkStockForBoxes(boxes: KkStockBoxRef[], label: string): Promise<void> {
    if (!boxes.length) return;
    const rangeMap = new Map<string, [string, string]>();
    for (const b of boxes) {
      for (const r of this.kkBoxCodeRanges(b)) rangeMap.set(r[0], r);
    }
    let ranges = Array.from(rangeMap.values());
    if (ranges.length > 10) {
      const END = '\uf8ff';
      const compact = new Map<string, [string, string]>();
      for (const r of ranges) {
        const head = /^([A-Z]\d{3})/.exec(r[0]);
        const key = head ? head[1] : r[0];
        compact.set(key, head ? [key, key + END] : r);
      }
      ranges = Array.from(compact.values());
    }
    if (!ranges.length) {
      // Box không có nhóm mã để tra (vd "Chưa gán danh mục") — không quét cả kho; dùng nút Đọc toàn kho nếu cần
      boxes.forEach((b) => this.kkBoxStockLoaded.add(b.productType));
      this.invalidateKkTypeViewCache();
      return;
    }
    const factory = this.selectedFactory;
    const loadKey = label;
    this.kkBoxStockLoadingKey = loadKey;
    this.kkLocMapBusy = true;
    this.kkLocMapStatus = `Đang đọc tồn ${label}…`;
    this.cdr.detectChanges();
    try {
      if (!this.kkCatalogTypeMap.size) {
        this.kkCatalogTypeMap = await this.kkCatalog.loadAllAsMap();
        this.kkCatalogEntries = await this.kkCatalog.loadAll();
      }
      const snaps = await Promise.all(ranges.map(([lo, hi]) =>
        this.firestore.firestore.collection('inventory-materials')
          .where('materialCode', '>=', lo)
          .where('materialCode', '<=', hi)
          .get()
      ));
      if (this.selectedFactory !== factory || this.kkStockLoaded || !this.showKkLocMap) return;
      const sources = new Set<string>();
      for (const b of boxes) {
        [b.productType, ...(b.sourceProductTypes || []), b.sourceProductType || ''].forEach((t) => t && sources.add(t));
      }
      const seen = new Set<string>();
      const byType = new Map<string, InventoryMaterial[]>();
      const groupsByType = new Map<string, Set<string>>();
      let reads = 0;
      for (const snap of snaps) {
        reads += snap.docs.length;
        for (const doc of snap.docs) {
          if (seen.has(doc.id)) continue;
          seen.add(doc.id);
          const data = doc.data() as any;
          if (String(data.factory || '').trim().toUpperCase() !== factory) continue;
          if (this.stockFromInventoryDoc(data) <= 0) continue;
          if (this.isKkQcNgData(data)) continue;
          const materialCode = String(data.materialCode || '').trim().toUpperCase();
          if (!materialCode) continue;
          const productType = this.kkTypeOrGroupOfMaterial(materialCode);
          if (!sources.has(productType)) continue;
          const material = this.mapKkInventoryDoc(doc);
          material.kkChecked = this.isKkFlagOn(data.kkChecked);
          const list = byType.get(productType) || [];
          list.push(material);
          byType.set(productType, list);
          const g = this.kkCatalog.groupCodeFromMaterial(materialCode);
          const gs = groupsByType.get(productType) || new Set<string>();
          if (g) gs.add(g);
          groupsByType.set(productType, gs);
        }
      }
      sources.forEach((src) => this.kkLocMapTypeCache.delete(src));
      byType.forEach((list, type) => this.kkLocMapTypeCache.set(type, list));
      const keep = this.kkLocMapByType.filter((r) => !sources.has(r.productType));
      byType.forEach((list, type) => {
        const checked = list.filter((m) => this.isKkFlagOn(m.kkChecked)).length;
        keep.push({
          productType: type,
          groupCodes: Array.from(groupsByType.get(type) || []).sort((a, b) => this.compareNhuaGroupCode(a, b)),
          warehouse: this.kkWarehouseFromLocation(list[0]?.location),
          stock: list.reduce((n, m) => n + this.calculateCurrentStock(m), 0),
          checked,
          totalLines: list.length,
          remaining: Math.max(0, list.length - checked),
          location: '',
          locationSaved: ''
        });
      });
      this.kkLocMapByType = keep.sort((a, b) => this.compareKkTypeBox(a, b));
      for (const b of boxes) {
        this.kkBoxStockLoaded.add(b.productType);
        if (b.pinSplit && b.sourceProductType) this.kkBoxStockLoaded.add(`pin:${b.sourceProductType}`);
      }
      this.invalidateKkTypeViewCache();
      this.readTracker.track('materials', 'inventory-materials', reads);
      setTimeout(() => void this.ensureKkTypeMaterialNames(), 0);
      this.scheduleFitKkTypePageSize();
    } catch (e) {
      console.error('❌ loadKkStockForBox:', e);
      appAlert(`❌ Không đọc được tồn kho của ${label}.`);
    } finally {
      if (this.kkBoxStockLoadingKey === loadKey) {
        this.kkBoxStockLoadingKey = null;
        this.kkLocMapBusy = false;
        this.kkLocMapStatus = '';
      }
      this.cdr.detectChanges();
    }
  }
}
