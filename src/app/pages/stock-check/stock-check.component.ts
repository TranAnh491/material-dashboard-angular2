import { Component, OnInit, OnDestroy, ChangeDetectorRef, HostListener } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { Subject } from 'rxjs';
import { takeUntil, first, filter, skip, debounceTime } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import * as firebase from 'firebase/compat/app';
import { environment } from '../../../environments/environment';
import { Router } from '@angular/router';
import { RmBagHistoryService } from '../../services/rm-bag-history.service';

interface RackStat {
  location: string;
  total: number;
  full: number;     // Đã kiểm đủ lượng
  partial: number;  // Kiểm chưa đủ lượng
  unchecked: number;// Chưa kiểm
}

/** Nhóm box con theo Z1, Z2, ... (ví dụ Z1.1 Z1.2 chung nhóm Z1) */
interface ChildBoxGroup {
  groupLabel: string;
  boxes: RackStat[];
}

interface StockCheckMaterial {
  stt: number;
  materialCode: string;
  poNumber: string;
  imd: string;
  stock: number;
  location: string;
  /** Document id của `inventory-materials` để update đổi vị trí */
  inventoryId?: string;
  actualLocation?: string; // Vị trí thực tế (scan)
  standardPacking?: string;
  /** Template tem mới (có bag): bag của lần scan gần nhất (phục vụ UI/report) */
  lastBag?: string;
  stockCheck: string;
  qtyCheck: number | null;
  idCheck: string;
  dateCheck: Date | null;
  
  // Original data from inventory
  openingStock?: number;
  quantity: number;
  exported?: number;
  xt?: number;
  importDate?: Date;
  batchNumber?: string;
  
  // Flag để đánh dấu material được thêm mới khi scan (không có trong tồn kho)
  isNewMaterial?: boolean;
  
  // Thông tin đổi vị trí
  locationChangeInfo?: {
    hasChanged: boolean; // Đã đổi vị trí hay chưa
    newLocation: string; // Vị trí mới (hiện tại)
    changeDate?: Date; // Ngày đổi vị trí
    changedBy?: string; // Người đổi (nếu có)
  };
  // KHSX: có trong danh sách KHSX hay không
  hasKhsx?: boolean;
}

interface WrongLocationItem {
  key: string; // materialCode_po_imd
  material: StockCheckMaterial;
  fromLocation: string;
  toLocation: string;
  scannedQtyTotal: number;
  ignoredExcessTotal: number;
  status: 'unchecked' | 'partial' | 'full';
  remaining: number; // còn thiếu để đủ
}

interface StockCheckData {
  factory: string;
  materialCode: string;
  poNumber: string;
  imd: string;
  stockCheck: string;
  qtyCheck: number;
  idCheck: string;
  dateCheck: any;
  updatedAt: any;
  checkHistory?: CheckHistoryItem[];
}

interface CheckHistoryItem {
  idCheck: string;
  qtyCheck: number;
  dateCheck: any;
  updatedAt: any;
  /** Template tem mới (có bag) */
  bag?: string;
}

interface ReportDayAggRow {
  materialCode: string;
  poNumber: string;
  imd: string;
  stock: number;
  qtyCheckTotal: number;
  location: string;
  standardPacking: string;
  idCheck: string;
  lastDateCheck: Date;
  hasKhsx: boolean;
  /** Template tem mới (có bag): bag của lần scan mới nhất trong ngày */
  bag?: string;
}

interface ReportCompareRow {
  materialCode: string;
  checkedQty: number;
  inventoryStock: number;
  difference: number;
  status: 'MATCH' | 'CHECK_ONLY' | 'INVENTORY_ONLY' | 'DIFF';
  imdList?: string;
}

@Component({
  selector: 'app-stock-check',
  templateUrl: './stock-check.component.html',
  styleUrls: ['./stock-check.component.scss']
})
export class StockCheckComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private dataSubscription: any = null; // Track subscription để có thể unsubscribe
  private snapshotSubscription: any = null; // Track snapshot subscription để reload khi có thay đổi
  private isInitialDataLoaded: boolean = false; // Track xem đã load initial data chưa
  /** Tránh reset sai khi snapshot valueChanges() emit null lúc reconnect */
  private lastGoodSnapshotAt: number = 0;

  /** Index để lookup vật tư theo (materialCode+po+imd) nhanh khi scan */
  private materialByKey = new Map<string, StockCheckMaterial>();
  /** Cache: list box hiện tại đang build cho vị trí nào */
  private locationMaterialsLocCache: string = '';

  /** Hàng đợi scan để "nuốt" input thật nhanh, xử lý ở nền */
  private scanQueue: string[] = [];
  private isProcessingScanQueue = false;

  /** Tránh load lại inventory nhiều lần (valueChanges realtime gây nặng) */
  private inventoryLoadedFactory: 'ASM1' | 'ASM2' | null = null;

  /** Highlight (viền) mã vừa scan, không reorder list */
  private lastScannedHighlightKey: string = '';
  private lastScannedHighlightTimer: ReturnType<typeof setTimeout> | null = null;
  
  // Factory selection
  selectedFactory: 'ASM1' | 'ASM2' | null = null;
  
  // Data
  allMaterials: StockCheckMaterial[] = [];
  filteredMaterials: StockCheckMaterial[] = [];
  displayedMaterials: StockCheckMaterial[] = [];
  
  // Pagination
  currentPage = 1;
  itemsPerPage = 50;
  totalPages = 1;
  
  // Loading state
  isLoading = false;
  
  // Employee login
  currentEmployeeId: string = ''; // Mã nhân viên đang đăng nhập
  showEmployeeScanModal = false; // Modal scan mã nhân viên
  employeeScanInput = ''; // Input scan mã nhân viên
  /** Mobile: sau khi đăng nhập nhân viên — chọn ASM1/ASM2 trước khi kiểm kê */
  showMobileFactoryModal = false;
  
  // Scanner
  scanStep: 'idle' | 'employee' | 'location' | 'material' = 'idle';
  scannedEmployeeId = '';
  showScanModal = false;
  scanMessage = '';
  scanInput = '';
  scanHistory: string[] = [];
  currentScanLocation: string = ''; // Vị trí hiện tại đang kiểm kê
  locationMaterials: StockCheckMaterial[] = []; // Danh sách NVL theo vị trí đang scan (hiển thị dạng box)
  locationMaterialsView: Array<StockCheckMaterial & { _status: 'unchecked' | 'partial' | 'full'; _flash?: boolean }> = []; // Pre-computed view với status
  /** Key (materialCode_po_imd) của mã vừa scan — box đó sẽ được đưa lên đầu danh sách */
  lastScannedLocationKey: string = '';
  /** Danh sách mã scan sai vị trí: tìm thấy ở vị trí khác nhưng đang scan tại currentScanLocation */
  wrongLocationItems: WrongLocationItem[] = [];

  private searchDebounceTimer: any = null; // Timer debounce search
  
  // Scan success popup
  showScanSuccessPopup = false;
  scannedMaterialCode = '';
  scannedSTT = 0;
  scannedQty = 0;
  scannedPO = '';
  scannedCount = 0; // Đếm số mã đã scan trong session

  /** Popup tự tắt (scan dư / thông báo không chặn) — không dùng alert() */
  showScanNoticePopup = false;
  scanNoticeTitle = '';
  scanNoticeBody = '';
  private scanNoticeTimer: ReturnType<typeof setTimeout> | null = null;

  // Filter state
  filterMode: 'all' | 'checked' | 'unchecked' | 'outside' | 'location-change' | 'khsx-unchecked' = 'all';

  // KHSX
  showKhsxDialog: boolean = false;
  khsxCodes: string[] = []; // Danh sách mã có KHSX (loaded từ Firebase)
  
  // Search (chỉ mã hàng; kết quả snapshot — không tự cập nhật khi Firestore reload)
  searchInput: string = '';
  /** Đang xem bảng kết quả tìm (toàn nhà máy), không gắn với một box vị trí */
  searchResultsMode = false;
  /** Bản sao cố định các dòng tìm được (tách khỏi allMaterials realtime) */
  frozenSearchMaterials: StockCheckMaterial[] = [];
  
  // Sort mode
  sortMode: 'alphabetical' | 'byDateCheck' = 'alphabetical';
  
  // ID Check Statistics
  idCheckStats: { id: string; count: number }[] = [];
  
  // Material Detail Modal
  showMaterialDetailModal: boolean = false;
  selectedMaterialDetail: StockCheckMaterial | null = null;
  materialCheckHistory: any[] = [];
  
  // Reset modal
  showResetModal = false;
  resetPassword = '';
  isResetting = false;
  
  // Rack modal
  showRackModal: boolean = false;
  rackStats: RackStat[] = [];
  showRackDetailModal: boolean = false;
  rackDetailLocation: string = '';
  rackDetailMaterials: StockCheckMaterial[] = [];

  // History modal (for material history column)
  showHistoryModal: boolean = false;
  selectedMaterialForHistory: StockCheckMaterial | null = null;
  materialHistoryList: any[] = [];
  isLoadingHistory = false;

  // Report by date modal
  showReportByDateModal: boolean = false;
  isLoadingReportDates: boolean = false;
  /** Đang xóa report: giữ `dateKey` để disable nút tương ứng */
  isDeletingReportDateKey: string | null = null;
  reportDateOptions: Array<{ dateKey: string; dateLabel: string; totalMaterials: number }> = [];
  private reportDataByDateKey: Map<string, ReportDayAggRow[]> = new Map();
  private reportDatesLoadedFactory: string | null = null;
  /** Đang export report theo tháng (gộp nhiều ngày). */
  isExportingMonthlyReport: boolean = false;
  /** Đang tạo & lưu file tháng lên Firebase Storage */
  isSavingMonthlyReport: boolean = false;
  /** Link file tháng đã lưu (nếu có) */
  monthlyReportUrl: string | null = null;
  monthlyReportUpdatedAt: Date | null = null;
  private readonly MONTHLY_REPORTS_COLLECTION = 'stock-check-monthly-reports';
  /** ON/OFF ghi nhận dữ liệu theo ngày report (true = ghi nhận, false = bỏ qua). */
  reportDateEnabledMap: { [dateKey: string]: boolean } = {};
  /**
   * Persist report-date switches across machines.
   * If set: ONLY this dateKey is enabled; all others are OFF.
   */
  private reportOnlyDateKey: string | null = null;
  private readonly REPORT_SETTINGS_COLLECTION = 'stock-check-report-settings';

  // ======================== CHECK BY LIST / CHECK BY CODE ========================
  /** Mode scan: location = yêu cầu scan vị trí; list/code = cho phép scan không cần vị trí */
  scanMode: 'location' | 'list' | 'code' = 'location';
  /** Cho phép scan vật tư khi chưa scan vị trí (list/code mode). */
  private allowMaterialScanWithoutLocation = false;

  // ======================== KIỂM DS (PXK) ========================
  showStockCheckMoreModal = false;
  showDsSettingsModal = false;
  showDsListPage = false;
  dsLoading = false;
  dsError = '';
  /** DS: nếu bị Firestore permission-denied thì dừng retry để tránh spam lỗi */
  private dsPermissionDenied = false;
  /** DS: đang xuất report */
  dsReportBusy = false;
  /** DS: watch PXK realtime để auto reload khi có import mới */
  private dsPxkWatchSub: any = null;
  private dsPxkWatchDebounceId: any = null;

  /** Khoảng ngày để load PXK (theo importedAt trong pxk-import-data) */
  dsFromDate: Date = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  dsToDate: Date = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  /** Loại trừ mã/nhóm mã khi hiển thị Kiểm DS */
  dsExcludeEnabled = false;
  dsExcludeCatalogText = '';
  private dsExcludeCodesSet = new Set<string>();

  /** Bảng Kiểm DS: lấy từ PXK -> lọc inventory-materials đã load -> hiển thị */
  dsRows: Array<{
    materialCode: string;
    poNumber: string;
    imd: string;
    location: string;
    qtyCheck: number | null;
    dateCheck: Date | null;
  }> = [];

  // DS view (box theo vị trí) — giống giao diện kiểm kê
  dsSelectedLocationForDetail: string | null = null;
  dsSelectedParentGroup: string | null = null;
  /** DS: mở danh sách theo counter (Tổng/Đã kiểm/Chưa kiểm) */
  dsCounterListMode = false;
  dsCounterListFilter: 'all' | 'checked' | 'unchecked' = 'all';
  private _dsRackStatsCache: RackStat[] | null = null;

  private readonly STOCK_CHECK_DS_SETTINGS_COLLECTION = 'stock-check-ds-settings';
  private readonly STOCK_CHECK_SESSIONS_COLLECTION = 'stock-check-check-sessions';

  /** Lock scan theo dòng Kiểm DS (mã+PO+IMD) */
  private dsLockMaterialCode = '';
  private dsLockPoNumber = '';
  private dsLockImd = '';

  /** DS: khi scan ở màn hình chi tiết, chỉ ghi nhận các dòng thuộc DS hiện tại */
  private dsAllowedMaterialKeys: Set<string> | null = null;
  /** DS: cộng dồn lượng kiểm kê theo từng dòng trong phiên scan hiện tại */
  dsSessionQtyByKey: Map<string, number> = new Map();
  /** DS: bag đã scan trong phiên (để chặn trùng bag) */
  private dsSessionBags: Set<string> = new Set();
  /** DS: danh sách dòng đang kiểm (để hiển thị trong scan modal) */
  private dsScanRowsForDisplay: Array<{ materialCode: string; poNumber: string; imd: string }> = [];

  get dsTotalMaterials(): number {
    return this.dsRows.length;
  }

  get dsCheckedMaterials(): number {
    return this.dsRows.filter(r => this.dsIsCheckedByRule(r)).length;
  }

  get dsUncheckedMaterials(): number {
    return Math.max(0, this.dsTotalMaterials - this.dsCheckedMaterials);
  }

  /** DS: danh sách theo counter (không theo vị trí) */
  get dsCounterListRows(): Array<{
    materialCode: string;
    poNumber: string;
    imd: string;
    location: string;
    qtyCheck: number | null;
    dateCheck: Date | null;
  }> {
    const mode = this.dsCounterListFilter;
    const rows = this.dsRows.slice();
    const filtered =
      mode === 'all'
        ? rows
        : mode === 'checked'
          ? rows.filter(r => this.dsIsCheckedByRule(r))
          : rows.filter(r => !this.dsIsCheckedByRule(r));
    return filtered.sort((a, b) => {
      const stA = this.dsIsCheckedByRule(a) ? 0 : 1; // checked lên trước khi mode=all
      const stB = this.dsIsCheckedByRule(b) ? 0 : 1;
      if (mode === 'all' && stA !== stB) return stA - stB;
      const mc = a.materialCode.localeCompare(b.materialCode, 'vi');
      if (mc !== 0) return mc;
      const po = a.poNumber.localeCompare(b.poNumber, 'vi');
      if (po !== 0) return po;
      return a.imd.localeCompare(b.imd, 'vi');
    });
  }

  openDsCounterList(filter: 'all' | 'checked' | 'unchecked'): void {
    this.dsCounterListFilter = filter;
    this.dsCounterListMode = true;
    this.dsSelectedLocationForDetail = null;
    this.dsSelectedParentGroup = null;
    this.cdr.detectChanges();
    setTimeout(() => {
      const el = document.querySelector('.ds-counter-list') as HTMLElement | null;
      el?.scrollIntoView({ behavior: 'auto', block: 'start' });
    }, 0);
  }

  closeDsCounterList(): void {
    this.dsCounterListMode = false;
    this.cdr.detectChanges();
  }

  get dsLocationBoxStats(): RackStat[] {
    return this.computeDsRackStats();
  }

  /** Box mẹ cho DS: A/B/C... dựa vào ký tự đầu của location */
  get dsParentBoxStats(): RackStat[] {
    const map = new Map<string, RackStat>();
    for (const r of this.dsLocationBoxStats) {
      const g = (r.location || '').trim().toUpperCase().charAt(0);
      if (!g) continue;
      if (!map.has(g)) {
        map.set(g, { location: g, total: 0, full: 0, partial: 0, unchecked: 0 });
      }
      const stat = map.get(g)!;
      stat.total += r.total;
      stat.full += r.full;
      stat.partial += r.partial;
      stat.unchecked += r.unchecked;
    }
    return Array.from(map.values()).sort((a, b) => this.naturalSortLocations(a.location, b.location));
  }

  /** DS: nhóm box con theo Z1, Z2... (reuse same helper) */
  get dsChildBoxGroups(): ChildBoxGroup[] {
    const g = (this.dsSelectedParentGroup || '').trim().toUpperCase();
    if (!g) return [];
    const boxes = this.dsLocationBoxStats.filter(r => (r.location || '').trim().toUpperCase().startsWith(g));
    const map = new Map<string, RackStat[]>();
    for (const r of boxes) {
      const sub = this.getSubGroupPrefix(r.location);
      if (!map.has(sub)) map.set(sub, []);
      map.get(sub)!.push(r);
    }
    const groups: ChildBoxGroup[] = [];
    map.forEach((arr, groupLabel) => {
      arr.sort((a, b) => this.naturalSortLocations(a.location, b.location));
      groups.push({ groupLabel, boxes: arr });
    });
    groups.sort((a, b) => this.naturalSortLocations(a.groupLabel, b.groupLabel));
    return groups;
  }

  openDsParentGroup(group: string): void {
    const g = (group || '').trim().toUpperCase().charAt(0);
    if (!g) return;
    this.dsSelectedParentGroup = g;
    this.cdr.detectChanges();
  }

  backDsToParentGroups(): void {
    this.dsSelectedParentGroup = null;
    this.cdr.detectChanges();
  }

  openDsLocationDetail(location: string): void {
    const loc = (location || '').trim().toUpperCase();
    if (!loc) return;
    this.dsSelectedLocationForDetail = loc;
    this.cdr.detectChanges();
    setTimeout(() => {
      const el = document.querySelector('.ds-location-detail') as HTMLElement | null;
      el?.scrollIntoView({ behavior: 'auto', block: 'start' });
    }, 0);
  }

  backDsToLocationBoxes(): void {
    this.dsSelectedLocationForDetail = null;
    this.dsSelectedParentGroup = null;
    this.dsCounterListMode = false;
    this.cdr.detectChanges();
    setTimeout(() => {
      const el = document.querySelector('.ds-location-boxes') as HTMLElement | null;
      el?.scrollIntoView({ behavior: 'auto', block: 'start' });
    }, 0);
  }

  get dsDetailRows(): Array<{
    materialCode: string;
    poNumber: string;
    imd: string;
    location: string;
    qtyCheck: number | null;
    dateCheck: Date | null;
  }> {
    const loc = (this.dsSelectedLocationForDetail || '').trim().toUpperCase();
    if (!loc) return [];
    return this.dsRows
      .filter(r => String(r.location || '—').trim().toUpperCase() === loc)
      .slice()
      .sort((a, b) => {
        const mc = a.materialCode.localeCompare(b.materialCode, 'vi');
        if (mc !== 0) return mc;
        const po = a.poNumber.localeCompare(b.poNumber, 'vi');
        if (po !== 0) return po;
        return a.imd.localeCompare(b.imd, 'vi');
      });
  }

  private dsRuleFromMs(): number {
    const d = this.dsFromDate instanceof Date ? this.dsFromDate : new Date(this.dsFromDate as any);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
  }

  private dsRuleToMs(): number {
    const d = this.dsToDate instanceof Date ? this.dsToDate : new Date(this.dsToDate as any);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
  }

  private buildStockCheckHistoryDocId(factory: string, materialCode: string, poNumber: string, imd: string): string {
    const sanitizedMaterialCode = String(materialCode || '').replace(/\//g, '_');
    const sanitizedPoNumber = String(poNumber || '').replace(/\//g, '_');
    const sanitizedImd = String(imd || '').replace(/\//g, '_');
    return `${factory}_${sanitizedMaterialCode}_${sanitizedPoNumber}_${sanitizedImd}`;
  }

  /** REPORT cho KIỂM DS: xuất danh sách PXK + lịch sử scan chi tiết (có bag) */
  async exportDsReport(): Promise<void> {
    if (!this.selectedFactory) {
      alert('Vui lòng chọn nhà máy trước!');
      return;
    }
    if (this.dsReportBusy) return;
    this.dsReportBusy = true;
    try {
      const factory = this.selectedFactory;
      const fromMs = this.dsRuleFromMs();
      const toMs = this.dsRuleToMs();

      // ===== Sheet 1: PXK list (DS rows) =====
      const pxkRows = this.dsRows.map((r, idx) => {
        const stock = this.dsStockForRow(r);
        const checkedByRule = this.dsIsCheckedByRule(r);
        const qtyCheck = checkedByRule ? (r.qtyCheck == null ? 0 : Number(r.qtyCheck)) : 0;
        const dateCheck = checkedByRule && r.dateCheck ? new Date(r.dateCheck) : null;
        const deltaText = this.dsQtyDeltaDisplay(r);
        return {
          'STT': idx + 1,
          'Mã hàng': r.materialCode,
          'PO': r.poNumber,
          'IMD': r.imd,
          'Vị trí': r.location || '—',
          'Tồn Kho': stock == null ? '' : stock,
          'Kiểm Kê': qtyCheck,
          'Chênh Lệch': deltaText,
          'Tình trạng': checkedByRule ? this.dsQtyStatus(r).label : 'CHƯA KIỂM',
          'ID Check': checkedByRule ? (this.materialByKey.get(this.buildMaterialKey(r.materialCode, r.poNumber, r.imd))?.idCheck || '') : '',
          'Date Check': dateCheck ? dateCheck.toLocaleString('vi-VN') : ''
        };
      });

      // ===== Sheet 2: DS checked detail (history items) =====
      const dsKeySet = new Set(this.dsRows.map(r => this.buildMaterialKey(r.materialCode, r.poNumber, r.imd)));
      const detail: any[] = [];

      // ===== Sheet 3/4: Thống kê theo nhân viên theo 2 khung giờ =====
      type EmpAgg = {
        dateKey: string; // YYYY-MM-DD (local)
        employeeId: string;
        bagKeys: Set<string>;
        scanLines: number;
        qtyTotal: number;
      };
      const morningAgg = new Map<string, EmpAgg>(); // key = dateKey__emp
      const eveningAgg = new Map<string, EmpAgg>(); // key = dateKey__emp

      const toLocalYmd = (d: Date): string => {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      };
      const minutesOfDay = (d: Date): number => d.getHours() * 60 + d.getMinutes();
      const inMorningShift = (d: Date): boolean => {
        const m = minutesOfDay(d);
        // 08:00–17:00, loại trừ 12:15–13:15
        if (m < 8 * 60 || m > 17 * 60) return false;
        if (m >= (12 * 60 + 15) && m < (13 * 60 + 15)) return false;
        return true;
      };
      const inEveningShift = (d: Date): boolean => {
        const m = minutesOfDay(d);
        // 17:30–20:00
        return m >= (17 * 60 + 30) && m <= (20 * 60);
      };
      const bumpEmpAgg = (map: Map<string, EmpAgg>, dateKey: string, emp: string, bagKey: string | null, qty: number): void => {
        const k = `${dateKey}__${emp}`;
        if (!map.has(k)) {
          map.set(k, { dateKey, employeeId: emp, bagKeys: new Set<string>(), scanLines: 0, qtyTotal: 0 });
        }
        const a = map.get(k)!;
        a.scanLines += 1;
        a.qtyTotal += qty;
        if (bagKey) a.bagKeys.add(bagKey);
      };

      const snap = await this.firestore
        .collection('stock-check-history', ref => ref.where('factory', '==', factory))
        .get()
        .toPromise();

      if (snap && !(snap as any).empty) {
        (snap as any).forEach((doc: any) => {
          const data = doc.data() as any;
          const mc = String(data?.materialCode || '').trim().toUpperCase();
          const po = String(data?.poNumber || '').trim();
          const imd = String(data?.imd || '').trim();
          const materialKey = this.buildMaterialKey(mc, po, imd);
          if (!dsKeySet.has(materialKey)) return;
          const history: any[] = Array.isArray(data?.history) ? data.history : [];
          for (const it of history) {
            const d = this.parseFirestoreDate(it?.dateCheck);
            if (!d) continue;
            const t = d.getTime();
            if (t < fromMs || t > toMs) continue;
            const qty = it?.qtyCheck !== undefined && it?.qtyCheck !== null ? Number(it.qtyCheck) : 0;
            if (!qty || qty === 0) continue;
            const bag = String(it?.bag || '').trim();
            const emp = String(it?.idCheck || '').trim() || '-';
            detail.push({
              'Mã hàng': mc,
              'PO': po,
              'IMD': imd,
              'Bag': bag,
              'Qty (scan)': qty,
              'Date Check': d.toLocaleString('vi-VN'),
              'ID Check': emp,
              'Vị trí': String(it?.location || '').trim(),
              'Tồn Kho (lúc scan)': it?.stock !== undefined && it?.stock !== null ? Number(it.stock) : '',
              'Standard Packing': String(it?.standardPacking || '').trim()
            });

            // Thống kê theo nhân viên theo khung giờ:
            // - Luôn cộng lượt scan + tổng qty
            // - Chỉ cộng "Số bag" khi có bag (tem cũ có thể trống)
            const dateKey = toLocalYmd(d);
            const bagKey = bag ? `${mc}__${po}__${imd}__${bag}` : null; // unique bag theo dòng
            if (inMorningShift(d)) bumpEmpAgg(morningAgg, dateKey, emp, bagKey, qty);
            if (inEveningShift(d)) bumpEmpAgg(eveningAgg, dateKey, emp, bagKey, qty);
          }
        });
      }

      detail.sort((a, b) => String(b['Date Check'] || '').localeCompare(String(a['Date Check'] || ''), 'vi'));

      // ===== Write workbook =====
      const wb = XLSX.utils.book_new();
      const ws1 = XLSX.utils.json_to_sheet(pxkRows);
      ws1['!cols'] = [
        { wch: 6 },  // STT
        { wch: 14 }, // Mã
        { wch: 14 }, // PO
        { wch: 12 }, // IMD
        { wch: 10 }, // Vị trí
        { wch: 12 }, // Tồn kho
        { wch: 12 }, // Kiểm kê
        { wch: 12 }, // Chênh lệch
        { wch: 12 }, // Tình trạng
        { wch: 12 }, // ID
        { wch: 20 }  // Date
      ];
      XLSX.utils.book_append_sheet(wb, ws1, 'PXK List (DS)');

      const ws2 = XLSX.utils.json_to_sheet(detail);
      ws2['!cols'] = [
        { wch: 14 }, // Mã
        { wch: 14 }, // PO
        { wch: 12 }, // IMD
        { wch: 12 }, // Bag
        { wch: 10 }, // Qty
        { wch: 20 }, // Date
        { wch: 12 }, // ID
        { wch: 10 }, // Vị trí
        { wch: 14 }, // Stock
        { wch: 16 }  // Standard
      ];
      XLSX.utils.book_append_sheet(wb, ws2, 'DS Checked Detail');

      // ===== Sheet: CHƯA KIỂM (tính số bịch theo standardPacking) =====
      const secPerBag = 20;
      const uncheckRowsRaw = this.dsRows.filter(r => !this.dsIsCheckedByRule(r));
      let totalBagsNeed = 0;
      let totalMinutesNeed = 0;
      const resolveStandardPackingForDs = (r: { materialCode: string; poNumber: string; imd: string }): number => {
        // 1) Thử match chính xác theo key (mã+po+imd)
        const key = this.buildMaterialKey(r.materialCode, r.poNumber, r.imd);
        const mExact = this.materialByKey.get(key);
        const exact = this.parseStandardPackingNumber(mExact?.standardPacking);
        if (exact > 0) return exact;

        // 2) Fallback theo mã hàng (nhiều dòng PXK có IMD rỗng nên không match được)
        const mc = this.normalizeCodeUpper(r.materialCode);
        const anyRow = this.allMaterials.find(x => this.normalizeCodeUpper(x.materialCode) === mc && this.parseStandardPackingNumber(x.standardPacking) > 0);
        return this.parseStandardPackingNumber(anyRow?.standardPacking);
      };
      const uncheckRows = uncheckRowsRaw.map((r, idx) => {
        const stock = this.dsStockForRow(r) ?? 0;
        const std = resolveStandardPackingForDs(r);
        const bagsNeed = std > 0 && stock > 0 ? Math.ceil(stock / std) : 0;
        const minutesNeed = bagsNeed > 0 ? Math.round((bagsNeed * secPerBag) / 60 * 100) / 100 : 0;
        totalBagsNeed += bagsNeed;
        totalMinutesNeed += minutesNeed;
        return {
          'STT': idx + 1,
          'Mã hàng': r.materialCode,
          'PO': r.poNumber,
          'IMD': r.imd || '',
          'Vị trí': r.location || '—',
          'Tồn kho': stock,
          'StandardPacking': std || '',
          'Số bịch cần scan': bagsNeed || '',
          'Ước tính phút (20s/bịch)': minutesNeed || ''
        };
      });
      // dòng tổng
      uncheckRows.push({
        'STT': '',
        'Mã hàng': 'TỔNG',
        'PO': '',
        'IMD': '',
        'Vị trí': '',
        'Tồn kho': '',
        'StandardPacking': '',
        'Số bịch cần scan': totalBagsNeed,
        'Ước tính phút (20s/bịch)': Math.round(totalMinutesNeed * 100) / 100
      } as any);

      const wsUn = XLSX.utils.json_to_sheet(uncheckRows);
      wsUn['!cols'] = [
        { wch: 6 },   // STT
        { wch: 14 },  // Mã
        { wch: 14 },  // PO
        { wch: 12 },  // IMD
        { wch: 10 },  // Vị trí
        { wch: 12 },  // Tồn kho
        { wch: 16 },  // Standard
        { wch: 14 },  // Số bịch
        { wch: 20 }   // phút
      ];
      XLSX.utils.book_append_sheet(wb, wsUn, 'CHUA KIEM');

      // ===== Sheet 3: SÁNG =====
      const morningRows = Array.from(morningAgg.values())
        .sort((a, b) => (a.dateKey.localeCompare(b.dateKey) || a.employeeId.localeCompare(b.employeeId, 'vi')))
        .map((a, idx) => ({
          'STT': idx + 1,
          'Ngày': a.dateKey,
          'Mã NV': a.employeeId,
          'Số bag': a.bagKeys.size,
          'Tổng lượt scan': a.scanLines,
          'Tổng Qty': a.qtyTotal
        }));
      const ws3 = XLSX.utils.json_to_sheet(morningRows);
      ws3['!cols'] = [
        { wch: 6 },  // STT
        { wch: 12 }, // Ngày
        { wch: 12 }, // Mã NV
        { wch: 10 }, // Số bag
        { wch: 14 }, // lượt
        { wch: 12 }  // Qty
      ];
      XLSX.utils.book_append_sheet(wb, ws3, 'SÁNG (08h-17h)');

      // ===== Sheet 4: TỐI =====
      const eveningRows = Array.from(eveningAgg.values())
        .sort((a, b) => (a.dateKey.localeCompare(b.dateKey) || a.employeeId.localeCompare(b.employeeId, 'vi')))
        .map((a, idx) => ({
          'STT': idx + 1,
          'Ngày': a.dateKey,
          'Mã NV': a.employeeId,
          'Số bag': a.bagKeys.size,
          'Tổng lượt scan': a.scanLines,
          'Tổng Qty': a.qtyTotal
        }));
      const ws4 = XLSX.utils.json_to_sheet(eveningRows);
      ws4['!cols'] = ws3['!cols'];
      // Excel không cho phép ký tự ':' trong tên sheet
      XLSX.utils.book_append_sheet(wb, ws4, 'TỐI (17h30-20h)');

      const ymd = (d: Date): string => {
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}${mm}${dd}`;
      };
      const fileName = `Report_DS_${factory}_${ymd(this.dsFromDate)}-${ymd(this.dsToDate)}.xlsx`;
      XLSX.writeFile(wb, fileName);
    } catch (e) {
      console.error('[StockCheck DS] export report failed', e);
      alert('❌ Không xuất được report DS (kiểm tra quyền đọc stock-check-history).');
    } finally {
      this.dsReportBusy = false;
      this.cdr.detectChanges();
    }
  }

  /** DS: xác định "Đã kiểm/Chưa kiểm" theo rule ngày trong More */
  dsIsCheckedByRule(r: { dateCheck: Date | null }): boolean {
    if (!r?.dateCheck) return false;
    const t = r.dateCheck instanceof Date ? r.dateCheck.getTime() : new Date(r.dateCheck as any).getTime();
    if (!Number.isFinite(t) || t <= 0) return false;
    const from = this.dsRuleFromMs();
    const to = this.dsRuleToMs();
    return t >= from && t <= to;
  }

  dsRowStatusLabel(r: { dateCheck: Date | null }): string {
    return this.dsIsCheckedByRule(r) ? 'ĐÃ KIỂM' : 'CHƯA KIỂM';
  }

  /** DS: tình trạng theo so sánh stock vs qtyCheck (ĐỦ/THIẾU/DƯ) */
  dsQtyStatus(r: { materialCode: string; poNumber: string; imd: string; qtyCheck: number | null }): { label: string; kind: 'du' | 'thieu' | 'dủ' | 'chua' } {
    const key = this.buildMaterialKey(String(r.materialCode || '').toUpperCase().trim(), String(r.poNumber || '').trim(), String(r.imd || '').trim());
    const m = this.materialByKey.get(key);
    const stock = m?.stock ?? null;
    const qc = r.qtyCheck == null ? null : Number(r.qtyCheck);
    if (qc == null || !Number.isFinite(qc)) return { label: '—', kind: 'chua' };
    if (stock == null || !Number.isFinite(stock)) return { label: '—', kind: 'chua' };
    if (qc === stock) return { label: 'ĐỦ', kind: 'dủ' };
    if (qc < stock) return { label: 'THIẾU', kind: 'thieu' };
    return { label: 'DƯ', kind: 'du' };
  }

  /** DS: lượng kiểm kê trong phiên scan hiện tại */
  dsSessionQtyFor(r: { materialCode: string; poNumber: string; imd: string }): number | null {
    const key = this.buildMaterialKey(String(r.materialCode || '').toUpperCase().trim(), String(r.poNumber || '').trim(), String(r.imd || '').trim());
    const v = this.dsSessionQtyByKey.get(key);
    return v == null ? null : v;
  }

  /** DS: hiển thị chênh lệch (qtyCheck - stock) để biết dư/thiếu bao nhiêu */
  dsQtyDeltaDisplay(r: { materialCode: string; poNumber: string; imd: string; qtyCheck: number | null; dateCheck: Date | null }): string {
    // Nếu DS chưa kiểm theo rule ngày: để trống
    if (!this.dsIsCheckedByRule(r)) return '';
    const key = this.buildMaterialKey(String(r.materialCode || '').toUpperCase().trim(), String(r.poNumber || '').trim(), String(r.imd || '').trim());
    const m = this.materialByKey.get(key);
    const stock = m?.stock;
    const qc = r.qtyCheck == null ? null : Number(r.qtyCheck);
    if (stock == null || !Number.isFinite(stock) || qc == null || !Number.isFinite(qc)) return '';
    const diff = qc - stock;
    const fmt = (n: number): string => {
      const fixed = Number.isInteger(n) ? n : Number(n.toFixed(2));
      // dùng dấu , theo hàng ngàn
      return fixed.toLocaleString('en-US', { maximumFractionDigits: 2 });
    };
    if (diff === 0) return '0';
    return diff > 0 ? `+${fmt(diff)}` : fmt(diff);
  }

  /** DS: tồn kho (stock) theo dòng */
  dsStockForRow(r: { materialCode: string; poNumber: string; imd: string }): number | null {
    const key = this.buildMaterialKey(String(r.materialCode || '').toUpperCase().trim(), String(r.poNumber || '').trim(), String(r.imd || '').trim());
    const m = this.materialByKey.get(key);
    const v = m?.stock;
    return v == null || !Number.isFinite(v) ? null : v;
  }

  trackByDsDetailRow = (_: number, r: { materialCode: string; poNumber: string; imd: string }) =>
    `${String(r.materialCode || '').toUpperCase().trim()}__${String(r.poNumber || '').trim()}__${String(r.imd || '').trim()}`;

  private computeDsRackStats(): RackStat[] {
    if (this._dsRackStatsCache) return this._dsRackStatsCache;
    const map = new Map<string, RackStat>();
    for (const r of this.dsRows) {
      // Keep parity with DS list: rows with missing location are still counted (grouped as '—')
      const loc = String(r.location || '—').trim().toUpperCase() || '—';
      if (!map.has(loc)) {
        map.set(loc, { location: loc, total: 0, full: 0, partial: 0, unchecked: 0 });
      }
      const stat = map.get(loc)!;
      stat.total += 1;
      // DS mode: không có stock để tính full/partial => coi "checked" là full
      if (this.dsIsCheckedByRule(r)) stat.full += 1;
      else stat.unchecked += 1;
    }
    this._dsRackStatsCache = Array.from(map.values()).sort((a, b) => this.naturalSortLocations(a.location, b.location));
    return this._dsRackStatsCache;
  }

  private invalidateDsRackStatsCache(): void {
    this._dsRackStatsCache = null;
  }

  // Check by code modal/session
  showCodeCheckModal = false;
  codeCheckBusy = false;
  codeCheckError = '';
  codeCheckScanInput = '';
  /** Mã đang kiểm theo mode "theo mã" (khóa theo mã đầu tiên scan) */
  codeCheckActiveMaterialCode = '';
  /** Lần đầu scan mã (chỉ mã hàng) -> load dữ liệu rồi mới cho scan QR */
  codeCheckLoaded = false;

  trackByMaterialRow = (_: number, m: StockCheckMaterial) =>
    `${String(m.materialCode || '').toUpperCase().trim()}__${String(m.poNumber || '').trim()}__${String(m.imd || '').trim()}`;

  private normalizeCodeUpper(v: string): string {
    return String(v || '').trim().toUpperCase();
  }

  private parseExcludeCatalogText(text: string): string[] {
    const raw = String(text || '')
      .split(/[\n,;]+/)
      .map(s => s.trim().toUpperCase())
      .filter(Boolean);
    // unique
    return Array.from(new Set(raw));
  }

  private isCodeExcludedByRules(mcUpper: string): boolean {
    if (!this.dsExcludeEnabled) return false;
    const mc = (mcUpper || '').trim().toUpperCase();
    if (!mc) return false;
    for (const ex of this.dsExcludeCodesSet) {
      if (ex.length === 4) {
        if (mc.startsWith(ex)) return true;
      } else if (mc === ex) {
        return true;
      }
    }
    return false;
  }

  openStockCheckMoreModal(): void {
    this.showStockCheckMoreModal = true;
    this.cdr.detectChanges();
  }

  closeStockCheckMoreModal(): void {
    this.showStockCheckMoreModal = false;
    this.cdr.detectChanges();
  }

  async openDsSettingsModal(): Promise<void> {
    if (!this.selectedFactory) {
      alert('Vui lòng chọn nhà máy trước!');
      return;
    }
    if (!this.currentEmployeeId) {
      alert('Vui lòng scan mã nhân viên trước!');
      this.showEmployeeScanModal = true;
      return;
    }
    this.dsError = '';
    this.showDsSettingsModal = true;
    try {
      await this.loadDsSettings();
    } catch (e) {
      console.warn('[StockCheck DS] load settings failed', e);
    }
    // NOTE: Settings modal in MORE is for configuration only (no list render here).
  }

  closeDsSettingsModal(): void {
    this.showDsSettingsModal = false;
    this.dsError = '';
    this.cdr.detectChanges();
  }

  async openDsListModal(): Promise<void> {
    if (!this.selectedFactory) {
      alert('Vui lòng chọn nhà máy trước!');
      return;
    }
    if (!this.currentEmployeeId) {
      alert('Vui lòng scan mã nhân viên trước!');
      this.showEmployeeScanModal = true;
      return;
    }
    this.dsError = '';
    this.showDsListPage = true;
    // reset permission flag mỗi lần mở DS page (trường hợp user vừa đăng nhập/cấp quyền)
    this.dsPermissionDenied = false;
    try {
      await this.loadDsSettings(); // dùng rule đã lưu
    } catch (e) {
      console.warn('[StockCheck DS] load settings failed', e);
    }
    await this.reloadDsRowsFromPxk();
    this.startDsPxkWatch();
  }

  closeDsListPage(): void {
    this.showDsListPage = false;
    this.dsError = '';
    this.stopDsPxkWatch();
    this.cdr.detectChanges();
  }

  private startDsPxkWatch(): void {
    if (!this.selectedFactory) return;
    if (this.dsPermissionDenied) return;
    if (this.dsPxkWatchSub) return;

    try {
      this.dsPxkWatchSub = this.firestore
        .collection('pxk-import-data', ref => ref.where('factory', '==', this.selectedFactory))
        .valueChanges()
        .pipe(takeUntil(this.destroy$), debounceTime(500))
        .subscribe({
          next: () => {
            // Khi PXK thay đổi trong lúc đang ở DS page, reload lại theo rule ngày hiện tại.
            if (!this.showDsListPage || this.dsPermissionDenied) return;
            if (this.dsPxkWatchDebounceId) clearTimeout(this.dsPxkWatchDebounceId);
            this.dsPxkWatchDebounceId = setTimeout(() => {
              void this.reloadDsRowsFromPxk();
            }, 200);
          },
          error: (e: any) => {
            const code = e?.code || '';
            if (String(code).includes('permission-denied')) {
              this.dsPermissionDenied = true;
              this.dsError = 'Không có quyền đọc PXK (pxk-import-data). Vui lòng đăng nhập/tài khoản được cấp quyền.';
            }
          }
        });
    } catch (e) {
      console.warn('[StockCheck DS] start watch failed', e);
    }
  }

  private stopDsPxkWatch(): void {
    try {
      if (this.dsPxkWatchDebounceId) {
        clearTimeout(this.dsPxkWatchDebounceId);
        this.dsPxkWatchDebounceId = null;
      }
      if (this.dsPxkWatchSub && typeof this.dsPxkWatchSub.unsubscribe === 'function') {
        this.dsPxkWatchSub.unsubscribe();
      }
    } catch {}
    this.dsPxkWatchSub = null;
  }

  private dsSettingsDocId(factory: string): string {
    return `${factory}_ds_settings`;
  }

  private async loadDsSettings(): Promise<void> {
    if (!this.selectedFactory) return;
    const docId = this.dsSettingsDocId(this.selectedFactory);
    let snap: any;
    try {
      snap = await this.firestore
        .collection(this.STOCK_CHECK_DS_SETTINGS_COLLECTION)
        .doc(docId)
        .get()
        .toPromise();
    } catch (e) {
      const code = (e as any)?.code || '';
      if (String(code).includes('permission-denied')) {
        this.dsPermissionDenied = true;
        this.dsError = 'Không có quyền đọc rule DS (stock-check-ds-settings). Vui lòng đăng nhập/tài khoản được cấp quyền.';
        return;
      }
      throw e;
    }
    if (!snap || !snap.exists) return;
    const d = snap.data() as any;
    this.dsExcludeEnabled = d?.excludeEnabled === true;
    this.dsExcludeCatalogText = typeof d?.excludeCatalogText === 'string' ? d.excludeCatalogText : '';
    // dates stored as ymd
    const ymdFrom = typeof d?.fromYmd === 'string' ? d.fromYmd : '';
    const ymdTo = typeof d?.toYmd === 'string' ? d.toYmd : '';
    const parseYmd = (ymd: string): Date | null => {
      const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return null;
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      const da = parseInt(m[3], 10);
      const dt = new Date(y, mo, da);
      return Number.isNaN(dt.getTime()) ? null : dt;
    };
    const f = parseYmd(ymdFrom);
    const t = parseYmd(ymdTo);
    if (f) this.dsFromDate = f;
    if (t) this.dsToDate = t;
    this.rebuildDsExcludeSet();
  }

  private async saveDsSettings(): Promise<void> {
    if (!this.selectedFactory) return;
    const docId = this.dsSettingsDocId(this.selectedFactory);
    const toYmd = (d: Date): string => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };
    await this.firestore
      .collection(this.STOCK_CHECK_DS_SETTINGS_COLLECTION)
      .doc(docId)
      .set(
        {
          factory: this.selectedFactory,
          excludeEnabled: this.dsExcludeEnabled,
          excludeCatalogText: this.dsExcludeCatalogText,
          fromYmd: toYmd(this.dsFromDate),
          toYmd: toYmd(this.dsToDate),
          updatedAt: firebase.default.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
  }

  private rebuildDsExcludeSet(): void {
    const arr = this.parseExcludeCatalogText(this.dsExcludeCatalogText);
    this.dsExcludeCodesSet = new Set(arr);
  }

  async onDsSettingsChanged(): Promise<void> {
    if (this.dsPermissionDenied) return;
    this.rebuildDsExcludeSet();
    await this.saveDsSettings();
    // Only reload list when DS page is visible (outside button "KIỂM DS")
    if (this.showDsListPage) {
      await this.reloadDsRowsFromPxk();
    }
  }

  onDsFromDateChange(ymd: string): void {
    if (!ymd) return;
    const d = new Date(`${ymd}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      this.dsFromDate = d;
      void this.onDsSettingsChanged();
    }
  }

  onDsToDateChange(ymd: string): void {
    if (!ymd) return;
    const d = new Date(`${ymd}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      this.dsToDate = d;
      void this.onDsSettingsChanged();
    }
  }

  private async loadPxkPairsFromFirebase(): Promise<Set<string>> {
    if (!this.selectedFactory) return new Set();
    if (this.dsPermissionDenied) return new Set();
    const from = new Date(this.dsFromDate.getFullYear(), this.dsFromDate.getMonth(), this.dsFromDate.getDate(), 0, 0, 0, 0);
    const to = new Date(this.dsToDate.getFullYear(), this.dsToDate.getMonth(), this.dsToDate.getDate(), 23, 59, 59, 999);
    const out = new Set<string>();

    const addFromDocs = (docs: any[]): void => {
      for (const doc of docs) {
        const d = typeof doc?.data === 'function' ? doc.data() : doc;
        const lines: any[] = Array.isArray(d?.lines) ? d.lines : [];
        for (const ln of lines) {
          const mc = this.normalizeCodeUpper(String(ln?.materialCode || ''));
          const po = String(ln?.po || ln?.poNumber || '').trim();
          if (!mc || !po) continue;
          if (this.isCodeExcludedByRules(mc)) continue;
          out.add(`${mc}__${po}`);
        }
      }
    };

    const isInRange = (v: any): boolean => {
      if (!v) return false;
      const dt = typeof v?.toDate === 'function' ? v.toDate() : (v instanceof Date ? v : new Date(v));
      const t = dt?.getTime?.() || 0;
      if (!t) return false;
      return t >= from.getTime() && t <= to.getTime();
    };

    // Try indexed query first (factory + importedAt range)
    try {
      const snap = await this.firestore
        .collection('pxk-import-data', ref =>
          ref.where('factory', '==', this.selectedFactory).where('importedAt', '>=', from).where('importedAt', '<=', to)
        )
        .get()
        .toPromise();
      if (snap && !snap.empty) {
        addFromDocs((snap as any).docs || []);
      }
      return out;
    } catch (e) {
      const code = (e as any)?.code || '';
      if (String(code).includes('permission-denied')) {
        this.dsPermissionDenied = true;
        this.dsError = 'Không có quyền đọc PXK (pxk-import-data). Vui lòng đăng nhập/tài khoản được cấp quyền.';
        return new Set();
      }
      // Fallback: query by factory only (avoid composite index), then filter by date on client
      console.warn('[StockCheck DS] indexed query failed, fallback to factory-only', e);
      const snap2 = await this.firestore
        .collection('pxk-import-data', ref => ref.where('factory', '==', this.selectedFactory))
        .get()
        .toPromise();
      // permission denied ở fallback cũng cần chặn
      if (!snap2 && (e as any)?.code && String((e as any).code).includes('permission-denied')) {
        this.dsPermissionDenied = true;
        this.dsError = 'Không có quyền đọc PXK (pxk-import-data). Vui lòng đăng nhập/tài khoản được cấp quyền.';
        return new Set();
      }
      if (!snap2 || (snap2 as any).empty) return out;
      const docs = (snap2 as any).docs || [];
      const inRangeDocs = docs.filter((doc: any) => {
        const d = doc?.data?.() || {};
        return isInRange(d?.importedAt);
      });
      addFromDocs(inRangeDocs);
      return out;
    }
    return out;
  }

  /** DS: load danh sách cặp (Mã+PO) từ PXK theo rule ngày để render (không phụ thuộc tồn kho). */
  private async loadPxkPairsListFromFirebase(): Promise<Array<{ materialCode: string; poNumber: string }>> {
    if (!this.selectedFactory) return [];
    if (this.dsPermissionDenied) return [];
    const from = new Date(this.dsFromDate.getFullYear(), this.dsFromDate.getMonth(), this.dsFromDate.getDate(), 0, 0, 0, 0);
    const to = new Date(this.dsToDate.getFullYear(), this.dsToDate.getMonth(), this.dsToDate.getDate(), 23, 59, 59, 999);
    const out: Array<{ materialCode: string; poNumber: string }> = [];
    const seen = new Set<string>();

    const normPo = (v: any): string => String(v ?? '').replace(/\s+/g, '').trim();

    const addFromDocs = (docs: any[]): void => {
      for (const doc of docs) {
        const d = typeof doc?.data === 'function' ? doc.data() : doc;
        const lines: any[] = Array.isArray(d?.lines) ? d.lines : [];
        for (const ln of lines) {
          const mc = this.normalizeCodeUpper(String(ln?.materialCode || ''));
          const po = normPo(ln?.po || ln?.poNumber || '');
          if (!mc || !po) continue;
          if (this.isCodeExcludedByRules(mc)) continue;
          const key = `${mc}__${po}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ materialCode: mc, poNumber: po });
        }
      }
    };

    const isInRange = (v: any): boolean => {
      if (!v) return false;
      const dt = typeof v?.toDate === 'function' ? v.toDate() : (v instanceof Date ? v : new Date(v));
      const t = dt?.getTime?.() || 0;
      if (!t) return false;
      return t >= from.getTime() && t <= to.getTime();
    };

    try {
      const snap = await this.firestore
        .collection('pxk-import-data', ref =>
          ref.where('factory', '==', this.selectedFactory).where('importedAt', '>=', from).where('importedAt', '<=', to)
        )
        .get()
        .toPromise();
      if (snap && !snap.empty) {
        addFromDocs((snap as any).docs || []);
      }
      return out;
    } catch (e) {
      const code = (e as any)?.code || '';
      if (String(code).includes('permission-denied')) {
        this.dsPermissionDenied = true;
        this.dsError = 'Không có quyền đọc PXK (pxk-import-data). Vui lòng đăng nhập/tài khoản được cấp quyền.';
        return [];
      }
      // fallback factory-only
      const snap2 = await this.firestore
        .collection('pxk-import-data', ref => ref.where('factory', '==', this.selectedFactory))
        .get()
        .toPromise();
      if (!snap2 || (snap2 as any).empty) return out;
      const docs = (snap2 as any).docs || [];
      const inRangeDocs = docs.filter((doc: any) => {
        const d = doc?.data?.() || {};
        return isInRange(d?.importedAt);
      });
      addFromDocs(inRangeDocs);
      return out;
    }
  }

  private async reloadDsRowsFromPxk(): Promise<void> {
    this.dsLoading = true;
    this.dsError = '';
    this.dsRows = [];
    try {
      const pxkPairs = await this.loadPxkPairsListFromFirebase();
      if (pxkPairs.length === 0) {
        this.dsRows = [];
        return;
      }
      const normPoInv = (v: any): string => String(v ?? '').replace(/\s+/g, '').trim();
      const rows: Array<{
        materialCode: string;
        poNumber: string;
        imd: string;
        location: string;
        qtyCheck: number | null;
        dateCheck: Date | null;
      }> = [];

      for (const p of pxkPairs) {
        const mc = this.normalizeCodeUpper(p.materialCode);
        const po = String(p.poNumber || '').trim();
        const matches = this.allMaterials.filter(m => {
          const mc2 = this.normalizeCodeUpper(m.materialCode);
          const po2 = normPoInv(m.poNumber);
          return mc2 === mc && po2 === normPoInv(po);
        });
        if (matches.length === 0) {
          // PXK có nhưng kho chưa có dòng tương ứng -> vẫn hiển thị để không bị thiếu
          rows.push({
            materialCode: mc,
            poNumber: po,
            imd: '',
            location: '',
            qtyCheck: null,
            dateCheck: null
          });
        } else {
          for (const m of matches) {
            rows.push({
              materialCode: mc,
              poNumber: String(m.poNumber || '').replace(/\s+/g, '').trim(),
              imd: String(m.imd || '').trim(),
              location: String(m.location || '').trim(),
              qtyCheck: m.qtyCheck ?? null,
              dateCheck: m.dateCheck ?? null
            });
          }
        }
      }

      // Sort: Mã, PO, IMD
      rows.sort((a, b) => {
        const mc = a.materialCode.localeCompare(b.materialCode, 'vi');
        if (mc !== 0) return mc;
        const po = a.poNumber.localeCompare(b.poNumber, 'vi');
        if (po !== 0) return po;
        return a.imd.localeCompare(b.imd, 'vi');
      });
      this.dsRows = rows;
      this.invalidateDsRackStatsCache();
      this.dsSelectedLocationForDetail = null;
      this.dsSelectedParentGroup = null;
    } catch (e) {
      console.error('[StockCheck DS] reload failed', e);
      this.dsError = 'Không tải được danh sách PXK (kiểm tra quyền/index Firestore).';
    } finally {
      this.dsLoading = false;
      this.cdr.detectChanges();
    }
  }

  /** Kiểm kê theo dòng PXK (khóa mã+PO+IMD) */
  startDsRowCheck(r: { materialCode: string; poNumber: string; imd: string }): void {
    if (!this.selectedFactory || !this.currentEmployeeId) return;
    this.dsLockMaterialCode = this.normalizeCodeUpper(r.materialCode);
    this.dsLockPoNumber = String(r.poNumber || '').trim();
    this.dsLockImd = String(r.imd || '').trim();
    this.dsAllowedMaterialKeys = null;
    this.dsSessionQtyByKey = new Map();
    this.dsSessionBags = new Set();
    this.dsScanRowsForDisplay = [
      { materialCode: this.normalizeCodeUpper(r.materialCode), poNumber: String(r.poNumber || '').trim(), imd: String(r.imd || '').trim() }
    ];
    this.scanMode = 'list';
    this.allowMaterialScanWithoutLocation = true;
    this.currentScanLocation = '';
    this.showScanModal = true;
    this.scanStep = 'material';
    this.scannedEmployeeId = this.currentEmployeeId;
    this.scanInput = '';
    this.scanHistory = [];
    this.wrongLocationItems = [];
    this.scanMessage =
      `MODE: KIỂM DS (PXK)\n` +
      `ID: ${this.currentEmployeeId}\n` +
      `Factory: ${this.selectedFactory}\n` +
      `Khóa: ${this.dsLockMaterialCode} | PO:${this.dsLockPoNumber} | IMD:${this.dsLockImd}\n\n` +
      `Scan QR: Mã|PO|Số lượng|IMD\n` +
      `Rule: Qty mỗi lần scan ≤ StandardPacking.`;
    setTimeout(() => {
      const input = document.getElementById('scan-input') as HTMLInputElement;
      if (input) input.focus();
    }, 200);
  }

  /** DS: Kiểm kê theo danh sách đang hiển thị (chi tiết vị trí hoặc danh sách theo counter) */
  startDsDetailCheck(
    rows: Array<{ materialCode: string; poNumber: string; imd: string }>,
    contextLabel: string
  ): void {
    if (!this.selectedFactory || !this.currentEmployeeId) return;
    const allowed = new Set<string>();
    for (const r of rows) {
      const mc = this.normalizeCodeUpper(r.materialCode);
      const po = String(r.poNumber || '').trim();
      const imd = String(r.imd || '').trim();
      if (!mc || !po || !imd) continue;
      allowed.add(this.buildMaterialKey(mc, po, imd));
    }
    this.dsAllowedMaterialKeys = allowed;
    this.dsLockMaterialCode = '';
    this.dsLockPoNumber = '';
    this.dsLockImd = '';
    this.dsSessionQtyByKey = new Map();
    this.dsSessionBags = new Set();
    this.dsScanRowsForDisplay = rows.map(r => ({
      materialCode: this.normalizeCodeUpper(r.materialCode),
      poNumber: String(r.poNumber || '').trim(),
      imd: String(r.imd || '').trim()
    }));

    this.scanMode = 'list';
    this.allowMaterialScanWithoutLocation = true;
    this.currentScanLocation = '';
    this.showScanModal = true;
    this.scanStep = 'material';
    this.scannedEmployeeId = this.currentEmployeeId;
    this.scanInput = '';
    this.scanHistory = [];
    this.wrongLocationItems = [];
    this.scanMessage =
      `MODE: KIỂM DS (PXK)\n` +
      `ID: ${this.currentEmployeeId}\n` +
      `Factory: ${this.selectedFactory}\n` +
      `Phạm vi: ${contextLabel}\n\n` +
      `Rule:\n` +
      `- Chỉ ghi nhận mã có trong DS hiện tại\n` +
      `- Qty mỗi lần scan ≤ StandardPacking\n` +
      `- Trùng bag -> bỏ qua`;
    setTimeout(() => {
      const input = document.getElementById('scan-input') as HTMLInputElement;
      if (input) input.focus();
    }, 200);
  }

  /** DS: rows hiển thị trong scan modal (show qty scan cộng dồn + qtyCheck hiện tại) */
  get dsScanRowsView(): Array<{
    materialCode: string;
    poNumber: string;
    imd: string;
    scannedQty: number;
    qtyCheck: number | null;
  }> {
    if (this.scanMode !== 'list' || this.scanStep !== 'material') return [];
    const out: Array<{ materialCode: string; poNumber: string; imd: string; scannedQty: number; qtyCheck: number | null }> = [];
    for (const r of this.dsScanRowsForDisplay) {
      const key = this.buildMaterialKey(r.materialCode, r.poNumber, r.imd);
      const scannedQty = this.dsSessionQtyByKey.get(key) || 0;
      const m = this.materialByKey.get(key);
      out.push({
        materialCode: r.materialCode,
        poNumber: r.poNumber,
        imd: r.imd,
        scannedQty,
        qtyCheck: m?.qtyCheck ?? null
      });
    }
    // Ưu tiên dòng đã scan nhiều lên trên
    out.sort((a, b) => (b.scannedQty || 0) - (a.scannedQty || 0) || a.materialCode.localeCompare(b.materialCode, 'vi'));
    return out;
  }

  private parseStandardPackingNumber(sp: unknown): number {
    const raw = String(sp ?? '').trim().replace(/,/g, '');
    const n = parseFloat(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  private enforceStandardPerScan(material: StockCheckMaterial | null, scannedQty: number): { ok: boolean; max?: number } {
    const max = this.parseStandardPackingNumber(material?.standardPacking);
    if (max > 0 && scannedQty > max) {
      return { ok: false, max };
    }
    return { ok: true, max: max || undefined };
  }

  // (Removed old Kiểm DS import-file flow; replaced by PXK-based list in modal)

  openCodeCheckModal(): void {
    if (!this.selectedFactory) {
      alert('Vui lòng chọn nhà máy trước!');
      return;
    }
    if (!this.currentEmployeeId) {
      alert('Vui lòng scan mã nhân viên trước!');
      this.showEmployeeScanModal = true;
      return;
    }
    this.codeCheckError = '';
    this.codeCheckScanInput = '';
    this.codeCheckActiveMaterialCode = '';
    this.codeCheckLoaded = false;
    this.showCodeCheckModal = true;
    this.cdr.detectChanges();
    setTimeout(() => {
      const input = document.getElementById('stock-check-code-scan-input') as HTMLInputElement;
      if (input) input.focus();
    }, 200);
  }

  closeCodeCheckModal(): void {
    this.showCodeCheckModal = false;
  }

  async onCodeCheckFirstScanEnter(): Promise<void> {
    const raw = (this.codeCheckScanInput || '').trim();
    if (!raw) return;
    if (!this.selectedFactory || !this.currentEmployeeId) return;
    if (this.codeCheckBusy) return;
    this.codeCheckBusy = true;
    this.codeCheckError = '';
    try {
      // Accept: only materialCode OR full QR (mc|po|qty|imd...)
      const mc = raw.includes('|') ? this.normalizeCodeUpper(raw.split('|')[0] || '') : this.normalizeCodeUpper(raw);
      if (!mc) {
        this.codeCheckError = 'Mã không hợp lệ.';
        return;
      }
      this.codeCheckActiveMaterialCode = mc;

      // Fast load: query inventory-materials only for this code + factory
      const snap = await this.firestore
        .collection('inventory-materials', ref =>
          ref.where('factory', '==', this.selectedFactory).where('materialCode', '==', mc)
        )
        .get()
        .toPromise();

      const rows: StockCheckMaterial[] = [];
      if (snap && !snap.empty) {
        snap.forEach(doc => {
          const d = doc.data() as any;
          const openingStockValue = d.openingStock ?? 0;
          const qty = d.quantity ?? 0;
          const exported = d.exported ?? 0;
          const xt = d.xt ?? 0;
          const stock = Number(openingStockValue) + Number(qty) - Number(exported) - Number(xt);
          rows.push({
            stt: 0,
            materialCode: String(d.materialCode || mc).trim(),
            poNumber: String(d.poNumber || '').trim(),
            imd: String(d.batchNumber || d.imd || '').trim() || String(d.importDate || '').trim(),
            stock: Number.isFinite(stock) ? stock : 0,
            location: String(d.location || '').trim(),
            inventoryId: doc.id,
            actualLocation: '',
            standardPacking: String(d.standardPacking || '').trim(),
            stockCheck: '',
            qtyCheck: null,
            idCheck: '',
            dateCheck: null,
            openingStock: Number(openingStockValue) || 0,
            quantity: Number(qty) || 0,
            exported: Number(exported) || 0,
            xt: Number(xt) || 0,
            importDate: d.importDate?.toDate?.() ?? (d.importDate instanceof Date ? d.importDate : undefined),
            batchNumber: String(d.batchNumber || '').trim()
          });
        });
      }

      // Merge into local arrays for scanning logic reuse
      for (const r of rows) {
        const key = this.buildMaterialKey(r.materialCode, r.poNumber, r.imd);
        if (key && !this.materialByKey.has(key)) {
          this.allMaterials.push(r);
          this.materialByKey.set(key, r);
        }
      }
      // rebuild stt lazily
      this.codeCheckLoaded = true;
      this.codeCheckScanInput = '';
    } catch (e) {
      console.warn('[StockCheck] code-check load failed', e);
      this.codeCheckError = 'Không tải được dữ liệu mã hàng (kiểm tra quyền/index Firestore).';
    } finally {
      this.codeCheckBusy = false;
      this.cdr.detectChanges();
    }
  }

  /** Start scan modal locked to codeCheckActiveMaterialCode (no location required). */
  startCodeCheckScan(): void {
    if (!this.selectedFactory) return;
    if (!this.currentEmployeeId) return;
    if (!this.codeCheckActiveMaterialCode) {
      alert('Vui lòng scan Mã hàng trước.');
      return;
    }
    this.scanMode = 'code';
    this.allowMaterialScanWithoutLocation = true;
    this.currentScanLocation = '';
    this.showScanModal = true;
    this.scanStep = 'material';
    this.scannedEmployeeId = this.currentEmployeeId;
    this.scanInput = '';
    this.scanHistory = [];
    this.wrongLocationItems = [];
    this.scanMessage =
      `MODE: KIỂM KÊ THEO MÃ\n` +
      `ID: ${this.currentEmployeeId}\n` +
      `Factory: ${this.selectedFactory}\n` +
      `Mã: ${this.codeCheckActiveMaterialCode}\n\n` +
      `Scan QR: Mã|PO|Số lượng|IMD\n` +
      `Rule: Qty mỗi lần scan ≤ StandardPacking.`;
    setTimeout(() => {
      const input = document.getElementById('scan-input') as HTMLInputElement;
      if (input) input.focus();
    }, 200);
  }

  // Locations from Location tab (for validation)
  validLocations: string[] = []; // Danh sách vị trí hợp lệ từ Location tab

  /** Mobile (≤768px): ẩn bảng/counters, chỉ hiện nút KIỂM KÊ + modal scan — skip filter/stats để chạy nhanh hơn */
  isMobile = false;

  /** Khi chọn 1 vị trí (box) thì hiển thị bảng chi tiết theo vị trí đó; null = đang xem grid box */
  selectedLocationForDetail: string | null = null;

  /** Box mẹ (A, B, C, D...) đang được chọn; null = đang xem danh sách box mẹ */
  selectedParentGroup: string | null = null;

  // Counters
  get totalMaterials(): number {
    return this.allMaterials.length;
  }

  get checkedMaterials(): number {
    return this.allMaterials.filter(m => m.stockCheck === '✓').length;
  }

  get uncheckedMaterials(): number {
    // 🔧 Công thức: Tổng mã - (Đã kiểm tra + Đổi vị trí)
    // Lưu ý: Nếu 1 mã có ở cả 2 thì chỉ tính 1 lần (không double count)
    const checkedOrLocationChanged = new Set<string>();
    
    this.allMaterials.forEach(m => {
      const key = `${m.materialCode}_${m.poNumber}_${m.imd}`;
      if (m.stockCheck === '✓' || m.locationChangeInfo?.hasChanged === true) {
        checkedOrLocationChanged.add(key);
      }
    });
    
    return this.totalMaterials - checkedOrLocationChanged.size;
  }

  get locationChangedMaterials(): number {
    // Đếm số lượng materials đã đổi vị trí
    return this.allMaterials.filter(m => 
      m.locationChangeInfo?.hasChanged === true
    ).length;
  }

  /** Danh sách vị trí (mỗi vị trí 1 box) — dùng cho giao diện grid 6 cột */
  get locationBoxStats(): RackStat[] {
    return this.computeRackStats();
  }

  /** Box mẹ: gom theo ký tự đầu (A/B/C/...) */
  get parentBoxStats(): RackStat[] {
    const map = new Map<string, RackStat>();
    for (const r of this.locationBoxStats) {
      const g = (r.location || '').trim().toUpperCase().charAt(0);
      if (!g) continue;
      if (!map.has(g)) map.set(g, { location: g, total: 0, full: 0, partial: 0, unchecked: 0 });
      const agg = map.get(g)!;
      agg.total += r.total;
      agg.full += r.full;
      agg.partial += r.partial;
      agg.unchecked += r.unchecked;
    }
    return Array.from(map.values()).sort((a, b) => a.location.localeCompare(b.location));
  }

  /** Box con: danh sách vị trí thuộc group mẹ đang chọn (phẳng, giữ cho tương thích) */
  get childBoxStats(): RackStat[] {
    const g = (this.selectedParentGroup || '').trim().toUpperCase();
    if (!g) return [];
    return this.locationBoxStats.filter(r => (r.location || '').trim().toUpperCase().startsWith(g));
  }

  /** Trích prefix nhóm con từ location: Z1.1 -> Z1, Z2.6(L) -> Z2 */
  private getSubGroupPrefix(loc: string): string {
    const s = (loc || '').trim().toUpperCase();
    const match = s.match(/^([A-Z]\d+)/);
    return match ? match[1] : s.charAt(0) || '';
  }

  /** Sắp xếp chuỗi theo số (Z1, Z2, Z10 thay vì Z1, Z10, Z2) */
  private naturalSortLocations(a: string, b: string): number {
    const na = (a.match(/(\d+)/g) || []).map(Number);
    const nb = (b.match(/(\d+)/g) || []).map(Number);
    for (let i = 0; i < Math.max(na.length, nb.length); i++) {
      const va = na[i] ?? 0;
      const vb = nb[i] ?? 0;
      if (va !== vb) return va - vb;
    }
    return (a || '').localeCompare(b || '');
  }

  /** Box con theo nhóm Z1, Z2, ... để dễ nhìn (Z1.1 Z1.2 chung nhóm Z1) */
  get childBoxGroups(): ChildBoxGroup[] {
    const children = this.childBoxStats;
    if (children.length === 0) return [];
    const map = new Map<string, RackStat[]>();
    for (const r of children) {
      const sub = this.getSubGroupPrefix(r.location);
      if (!map.has(sub)) map.set(sub, []);
      map.get(sub)!.push(r);
    }
    const groups: ChildBoxGroup[] = [];
    map.forEach((boxes, groupLabel) => {
      boxes.sort((a, b) => this.naturalSortLocations(a.location, b.location));
      groups.push({ groupLabel, boxes });
    });
    groups.sort((a, b) => this.naturalSortLocations(a.groupLabel, b.groupLabel));
    return groups;
  }

  get outsideStockMaterials(): number {
    // Đếm mã ngoài tồn kho: isNewMaterial = true HOẶC stock = 0
    return this.allMaterials.filter(m => {
      if (m.isNewMaterial === true) return true;
      // Tính stock hiện tại
      const openingStockValue = m.openingStock !== null && m.openingStock !== undefined ? m.openingStock : 0;
      const currentStock = openingStockValue + (m.quantity || 0) - (m.exported || 0) - (m.xt || 0);
      return currentStock === 0 || currentStock < 0;
    }).length;
  }

  /** Số mã có KHSX nhưng chưa được stock check */
  get khsxUncheckedCount(): number {
    return this.allMaterials.filter(m => m.hasKhsx && m.stockCheck !== '✓').length;
  }

  /** Tổng số mã có KHSX */
  get khsxTotalCount(): number {
    return this.allMaterials.filter(m => m.hasKhsx).length;
  }

  /**
   * Set filter mode
   */
  setFilterMode(mode: 'all' | 'checked' | 'unchecked' | 'outside' | 'location-change' | 'khsx-unchecked'): void {
    this.exitSearchResultsMode();
    this.searchInput = '';
    this.filterMode = mode;
    this.applyFilter();
  }

  /**
   * Toggle sort mode between alphabetical and by date check
   */
  toggleSortMode(): void {
    if (this.sortMode === 'alphabetical') {
      this.sortMode = 'byDateCheck';
    } else {
      this.sortMode = 'alphabetical';
    }

    if (this.searchResultsMode && this.frozenSearchMaterials.length > 0) {
      this.sortMaterialListInPlace(this.frozenSearchMaterials);
      this.frozenSearchMaterials.forEach((mat, index) => {
        mat.stt = index + 1;
      });
      this.filteredMaterials = this.frozenSearchMaterials;
      this.totalPages = Math.ceil(this.filteredMaterials.length / this.itemsPerPage) || 1;
      if (this.currentPage > this.totalPages) {
        this.currentPage = Math.max(1, this.totalPages);
      }
      this.loadPageFromFiltered(this.currentPage);
      this.cdr.detectChanges();
      return;
    }

    // Sort materials
    this.sortMaterials();

    // Update STT after sorting
    this.allMaterials.forEach((mat, index) => {
      mat.stt = index + 1;
    });

    // Reapply filter to update displayed materials
    this.applyFilter();

    // Reload current page
    this.loadPageFromFiltered(this.currentPage);

    this.cdr.detectChanges();
  }

  /**
   * Sort materials based on current sort mode
   */
  private sortMaterialListInPlace(list: StockCheckMaterial[]): void {
    if (this.sortMode === 'alphabetical') {
      list.sort((a, b) => a.materialCode.localeCompare(b.materialCode));
    } else {
      list.sort((a, b) => {
        if (a.dateCheck && !b.dateCheck) return -1;
        if (!a.dateCheck && b.dateCheck) return 1;
        if (a.dateCheck && b.dateCheck) {
          const dateA = a.dateCheck instanceof Date ? a.dateCheck.getTime() : new Date(a.dateCheck).getTime();
          const dateB = b.dateCheck instanceof Date ? b.dateCheck.getTime() : new Date(b.dateCheck).getTime();
          return dateB - dateA;
        }
        return a.materialCode.localeCompare(b.materialCode);
      });
    }
  }

  private sortMaterials(): void {
    this.sortMaterialListInPlace(this.allMaterials);
  }

  /** Bản sao một dòng để snapshot kết quả tìm (không dùng chung reference với allMaterials) */
  private cloneStockCheckRow(m: StockCheckMaterial): StockCheckMaterial {
    const cloneDate = (d: any): Date | null => {
      if (d == null) return null;
      if (d instanceof Date) return new Date(d.getTime());
      const t = new Date(d);
      return isNaN(t.getTime()) ? null : t;
    };
    const lci = m.locationChangeInfo;
    return {
      ...m,
      dateCheck: cloneDate(m.dateCheck),
      importDate: m.importDate != null ? cloneDate(m.importDate) || undefined : undefined,
      locationChangeInfo: lci
        ? {
            hasChanged: lci.hasChanged,
            newLocation: lci.newLocation,
            changeDate: lci.changeDate ? cloneDate(lci.changeDate) || undefined : undefined,
            changedBy: lci.changedBy
          }
        : undefined
    };
  }

  private exitSearchResultsMode(): void {
    this.searchResultsMode = false;
    this.frozenSearchMaterials = [];
  }

  /** Tóm tắt vị trí (ASM1 / scan) của các dòng đang xem trong kết quả tìm */
  get searchResultLocationSummary(): string {
    if (!this.searchResultsMode || !this.frozenSearchMaterials.length) {
      return '';
    }
    const set = new Set<string>();
    this.frozenSearchMaterials.forEach(mat => {
      const asm1 = (mat.location || '').trim();
      const scan = (mat.actualLocation || '').trim();
      if (asm1) set.add(`ASM1: ${asm1}`);
      if (scan) set.add(`Scan: ${scan}`);
    });
    return Array.from(set).sort().join(' · ') || '-';
  }

  /** Bấm nút search / Enter: chạy tìm ngay (không chờ debounce) */
  runSearchNow(): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
    this._doSearch();
  }

  /**
   * Calculate ID check statistics
   * Trên mobile không hiển thị bảng → skip để giao diện mobile chạy nhanh hơn.
   */
  calculateIdCheckStats(): void {
    if (this.isMobile) return;
    const idMap = new Map<string, number>();
    
    this.allMaterials.forEach(mat => {
      if (mat.idCheck && mat.stockCheck === '✓') {
        const count = idMap.get(mat.idCheck) || 0;
        idMap.set(mat.idCheck, count + 1);
      }
    });
    
    this.idCheckStats = Array.from(idMap.entries())
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Search materials by material code
   */
  onSearchInput(): void {
    // Debounce 250ms để tránh filter chạy từng keystroke
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    this.searchDebounceTimer = setTimeout(() => {
      this._doSearch();
    }, 250);
  }

  private _doSearch(): void {
    if (this.isMobile) return;
    if (!this.searchInput.trim()) {
      this.exitSearchResultsMode();
      this.selectedLocationForDetail = null;
      this.applyFilter();
      return;
    }

    const searchTerm = this.searchInput.trim().toUpperCase();
    let filtered = [...this.allMaterials];

    // Apply filter mode first
    if (this.filterMode === 'checked') {
      filtered = filtered.filter(m => m.stockCheck === '✓');
    } else if (this.filterMode === 'unchecked') {
      filtered = filtered.filter(m => m.stockCheck !== '✓');
    } else if (this.filterMode === 'outside') {
      filtered = filtered.filter(m => {
        if (m.isNewMaterial === true) return true;
        const openingStockValue = m.openingStock !== null && m.openingStock !== undefined ? m.openingStock : 0;
        const currentStock = openingStockValue + (m.quantity || 0) - (m.exported || 0) - (m.xt || 0);
        return currentStock === 0 || currentStock < 0;
      });
    } else if (this.filterMode === 'location-change') {
      filtered = filtered.filter(m => m.locationChangeInfo?.hasChanged === true);
    } else if (this.filterMode === 'khsx-unchecked') {
      filtered = filtered.filter(m => m.hasKhsx && m.stockCheck !== '✓');
    }

    // Chỉ tìm theo mã hàng
    filtered = filtered.filter(m => m.materialCode.toUpperCase().includes(searchTerm));

    // Snapshot cố định — không cập nhật theo realtime allMaterials
    const frozen = filtered.map(m => this.cloneStockCheckRow(m));
    frozen.forEach((mat, index) => {
      mat.stt = index + 1;
    });

    this.frozenSearchMaterials = frozen;
    this.filteredMaterials = frozen;
    this.searchResultsMode = true;
    this.selectedLocationForDetail = null;

    this.totalPages = Math.ceil(frozen.length / this.itemsPerPage) || 1;
    this.currentPage = 1;
    this.loadPageFromFiltered(1);
    this.cdr.detectChanges();

    setTimeout(() => {
      const el = document.querySelector('.location-detail-section') as HTMLElement | null;
      el?.scrollIntoView({ behavior: 'auto', block: 'start' });
    }, 0);
  }

  /**
   * Clear search
   */
  clearSearch(): void {
    this.searchInput = '';
    this.exitSearchResultsMode();
    this.selectedLocationForDetail = null;
    this.applyFilter();
  }

  /**
   * Show material detail modal
   */
  async showMaterialDetail(material: StockCheckMaterial): Promise<void> {
    this.selectedMaterialDetail = material;
    this.showMaterialDetailModal = true;
    await this.loadMaterialCheckHistory(material);
  }

  /**
   * Load check history for a material (từ stock-check-history - lịch sử vĩnh viễn)
   */
  async loadMaterialCheckHistory(material: StockCheckMaterial): Promise<void> {
    try {
      const sanitizedMaterialCode = material.materialCode.replace(/\//g, '_');
      const sanitizedPoNumber = material.poNumber.replace(/\//g, '_');
      const sanitizedImd = material.imd.replace(/\//g, '_');
      const historyDocId = `${this.selectedFactory}_${sanitizedMaterialCode}_${sanitizedPoNumber}_${sanitizedImd}`;
      
      // Load từ stock-check-history (lịch sử vĩnh viễn)
      const historyDoc = await this.firestore
        .collection('stock-check-history')
        .doc(historyDocId)
        .get()
        .toPromise();
      
      if (historyDoc && historyDoc.exists) {
        const data = historyDoc.data() as any;
        if (data.history && Array.isArray(data.history)) {
          this.materialCheckHistory = data.history
            .map((item: any) => ({
              idCheck: item.idCheck || '-',
              qtyCheck: item.qtyCheck !== undefined && item.qtyCheck !== null ? item.qtyCheck : '-',
              dateCheck: item.dateCheck?.toDate ? item.dateCheck.toDate() : (item.dateCheck ? new Date(item.dateCheck) : null),
              updatedAt: item.updatedAt?.toDate ? item.updatedAt.toDate() : (item.updatedAt ? new Date(item.updatedAt) : null),
              stock: item.stock !== undefined && item.stock !== null ? item.stock : null,
              location: item.location || '-',
              standardPacking: item.standardPacking || '-'
            }))
            .sort((a: any, b: any) => {
              const dateA = a.dateCheck ? new Date(a.dateCheck).getTime() : 0;
              const dateB = b.dateCheck ? new Date(b.dateCheck).getTime() : 0;
              return dateB - dateA; // Newest first
            });
        } else {
          this.materialCheckHistory = [];
        }
      } else {
        this.materialCheckHistory = [];
      }
    } catch (error) {
      console.error('❌ Error loading check history:', error);
      this.materialCheckHistory = [];
    }
  }
  
  /**
   * Show history modal for a material (click vào cột Lịch sử)
   */
  async showMaterialHistory(material: StockCheckMaterial): Promise<void> {
    this.selectedMaterialForHistory = material;
    this.showHistoryModal = true;
    this.isLoadingHistory = true;
    this.materialHistoryList = [];
    
    try {
      await this.loadMaterialCheckHistory(material);
      this.materialHistoryList = this.materialCheckHistory;
    } catch (error) {
      console.error('❌ Error loading material history:', error);
    } finally {
      this.isLoadingHistory = false;
    }
  }
  
  /**
   * Close history modal
   */
  closeHistoryModal(): void {
    this.showHistoryModal = false;
    this.selectedMaterialForHistory = null;
    this.materialHistoryList = [];
  }

  /**
   * Close material detail modal
   */
  closeMaterialDetailModal(): void {
    this.showMaterialDetailModal = false;
    this.selectedMaterialDetail = null;
    this.materialCheckHistory = [];
  }

  /**
   * Apply filter to displayed materials
   * Trên mobile không hiển thị bảng → skip để giao diện mobile chạy nhanh hơn.
   */
  applyFilter(): void {
    if (this.isMobile) return;
    if (this.searchResultsMode) {
      return;
    }
    let filtered = [...this.allMaterials];

    if (this.filterMode === 'checked') {
      filtered = filtered.filter(m => m.stockCheck === '✓');
    } else if (this.filterMode === 'unchecked') {
      filtered = filtered.filter(m => m.stockCheck !== '✓');
    } else if (this.filterMode === 'location-change') {
      // Hiển thị các mã đã đổi vị trí
      filtered = filtered.filter(m => m.locationChangeInfo?.hasChanged === true);
    } else if (this.filterMode === 'outside') {
      // Hiển thị mã ngoài tồn kho: isNewMaterial = true HOẶC stock = 0
      filtered = filtered.filter(m => {
        if (m.isNewMaterial === true) return true;
        // Tính stock hiện tại
        const openingStockValue = m.openingStock !== null && m.openingStock !== undefined ? m.openingStock : 0;
        const currentStock = openingStockValue + (m.quantity || 0) - (m.exported || 0) - (m.xt || 0);
        return currentStock === 0 || currentStock < 0;
      });
    } else if (this.filterMode === 'khsx-unchecked') {
      // Mã có KHSX nhưng chưa được stock check
      filtered = filtered.filter(m => m.hasKhsx && m.stockCheck !== '✓');
    }
    
    // Sort based on current sort mode
    if (this.sortMode === 'alphabetical') {
      filtered.sort((a, b) => a.materialCode.localeCompare(b.materialCode));
    } else {
      filtered.sort((a, b) => {
        if (a.dateCheck && !b.dateCheck) return -1;
        if (!a.dateCheck && b.dateCheck) return 1;
        if (a.dateCheck && b.dateCheck) {
          const dateA = a.dateCheck instanceof Date ? a.dateCheck.getTime() : new Date(a.dateCheck).getTime();
          const dateB = b.dateCheck instanceof Date ? b.dateCheck.getTime() : new Date(b.dateCheck).getTime();
          return dateB - dateA; // Newest first
        }
        return a.materialCode.localeCompare(b.materialCode);
      });
    }

    // Update STT
    filtered.forEach((mat, index) => {
      mat.stt = index + 1;
    });

    // Calculate total pages
    this.totalPages = Math.ceil(filtered.length / this.itemsPerPage);

    // Store filtered results
    this.filteredMaterials = filtered;

    // Reset to first page
    this.currentPage = 1;
    this.loadPageFromFiltered(1);
  }

  constructor(
    private firestore: AngularFirestore,
    private fns: AngularFireFunctions,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private rmBagHistory: RmBagHistoryService
  ) {}

  goToMenu(): void {
    // app.routing.ts uses hash routing; Router will handle it.
    void this.router.navigateByUrl('/menu');
  }

  private buildMaterialKey(materialCode: string, poNumber: string, imd: string): string {
    return `${(materialCode || '').toUpperCase().trim()}|${(poNumber || '').trim()}|${(imd || '').trim()}`;
  }

  private rebuildMaterialIndex(): void {
    this.materialByKey.clear();
    for (const m of this.allMaterials) {
      const key = this.buildMaterialKey(m.materialCode, m.poNumber, m.imd);
      if (key) this.materialByKey.set(key, m);
    }
  }

  private buildMaterialKeyFromLastScannedKey(lastKey: string): string {
    // lastScannedLocationKey format: materialCode_po_imd
    const parts = String(lastKey || '').split('_');
    if (parts.length < 3) return '';
    const materialCode = parts[0] || '';
    const poNumber = parts[1] || '';
    const imd = parts.slice(2).join('_') || '';
    return this.buildMaterialKey(materialCode, poNumber, imd);
  }

  private focusScanInputSoon(delayMs: number = 0): void {
    setTimeout(() => {
      const input = document.getElementById('scan-input') as HTMLInputElement;
      if (input) input.focus();
    }, delayMs);
  }

  private enqueueScan(scannedData: string): void {
    this.scanQueue.push(scannedData);
    if (!this.isProcessingScanQueue) {
      this.isProcessingScanQueue = true;
      // xử lý nền, nhường event loop để ưu tiên nhận scan tiếp theo
      setTimeout(() => this.processScanQueue(), 0);
    }
  }

  private async processScanQueue(): Promise<void> {
    try {
      while (this.scanQueue.length > 0) {
        const data = this.scanQueue.shift()!;
        await this.processMaterialScan(data);
        // nhường UI giữa các item để không block nhập
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    } finally {
      this.isProcessingScanQueue = false;
    }
  }

  private async processMaterialScan(scannedData: string): Promise<void> {
    // Dùng mã nhân viên đã đăng nhập
    this.scannedEmployeeId = this.currentEmployeeId;
    const parts = scannedData.split('|');

    // QR tối thiểu: Mã|PO|Số lượng|IMD  (mẫu mới có thêm |Bag)
    if (parts.length < 4) {
      this.scanMessage = '❌ Mã không hợp lệ!\n\nFormat: Mã|PO|Số lượng|IMD\n\nScan lại';
      this.cdr.detectChanges();
      this.focusScanInputSoon(0);
      return;
    }

    const materialCode = String(parts[0] ?? '').trim();
    const poNumber = String(parts[1] ?? '').trim();
    const quantity = String(parts[2] ?? '').trim();
    const part4Raw = String(parts[3] ?? '').trim();
    const imd = (part4Raw.split('-')[0] || '').trim();
    // Bag có thể nằm trong QR part 4 dạng DDMMYYYY-i/tổng(T1) (giống outbound)
    const bagFromPart4 = this.rmBagHistory.extractBagLabelFromQrPart4(part4Raw);
    const bagFromPart5 = parts.length >= 5 ? String(parts.slice(4).join('|') ?? '').trim() : '';
    const bag = (bagFromPart5 || bagFromPart4 || '').trim();

    const codeUpper = materialCode.toUpperCase().trim();
    const poTrim = poNumber.trim();
    const imdTrim = imd.trim();

    // DS detail mode: chỉ nhận mã thuộc DS hiện tại
    if (this.scanMode === 'list' && this.dsAllowedMaterialKeys && this.dsAllowedMaterialKeys.size > 0) {
      const key = this.buildMaterialKey(codeUpper, poTrim, imdTrim);
      if (!this.dsAllowedMaterialKeys.has(key)) {
        this.showAutoDismissScanNotice(
          'Không thuộc DS',
          `Bạn scan: ${this.normalizeCodeUpper(codeUpper)} | PO:${poTrim} | IMD:${imdTrim}\nKhông có trong danh sách DS hiện tại.\nBỏ qua scan này.`
        );
        return;
      }
    }

    // Lock theo dòng Kiểm DS: mã + PO + IMD phải khớp
    if (this.scanMode === 'list' && this.dsLockMaterialCode) {
      const lockMc = this.normalizeCodeUpper(this.dsLockMaterialCode);
      const lockPo = String(this.dsLockPoNumber || '').trim();
      const lockImd = String(this.dsLockImd || '').trim();
      if (this.normalizeCodeUpper(codeUpper) !== lockMc || poTrim !== lockPo || imdTrim !== lockImd) {
        this.showAutoDismissScanNotice(
          'Sai dòng',
          `Đang kiểm DS: ${lockMc} | PO:${lockPo} | IMD:${lockImd}\nBạn scan: ${this.normalizeCodeUpper(codeUpper)} | PO:${poTrim} | IMD:${imdTrim}\nBỏ qua scan này.`
        );
        return;
      }
    }

    const lookupKey = this.buildMaterialKey(codeUpper, poTrim, imdTrim);
    let matchingMaterial = this.materialByKey.get(lookupKey);
    const viewKey = `${codeUpper}_${poTrim}_${imdTrim}`;

    // Nếu không khớp đủ 3: kiểm tra sai IMD để báo rõ (chỉ khi cần)
    if (!matchingMaterial) {
      const candidatesSameCodePo = this.allMaterials.filter(m =>
        (m.materialCode || '').toUpperCase().trim() === codeUpper &&
        (m.poNumber || '').trim() === poTrim
      );
      if (candidatesSameCodePo.length > 0) {
        const imdList = candidatesSameCodePo.map(c => (c.imd || '').trim()).filter(Boolean);
        this.scanMessage =
          `❌ IMD KHÔNG ĐÚNG — Không ghi nhận.\n` +
          `Mã: ${materialCode} | PO: ${poNumber}\n` +
          `IMD scan: ${imdTrim}\n` +
          `IMD trong dữ liệu: ${imdList.join(', ') || '-'}\n\nVui lòng scan đúng mã (đúng IMD).`;
        this.cdr.detectChanges();
        this.focusScanInputSoon(0);
        return;
      }
    }

    if (matchingMaterial) {
      const openingStockValue = matchingMaterial.openingStock !== null && matchingMaterial.openingStock !== undefined ? matchingMaterial.openingStock : 0;
      const currentStock = openingStockValue + (matchingMaterial.quantity || 0) - (matchingMaterial.exported || 0) - (matchingMaterial.xt || 0);
      if (currentStock === 0 || currentStock < 0) {
        matchingMaterial.isNewMaterial = true;
      }

      matchingMaterial.stockCheck = '✓';
      matchingMaterial.idCheck = this.scannedEmployeeId;
      matchingMaterial.dateCheck = new Date();
      if (this.currentScanLocation) {
        matchingMaterial.actualLocation = this.currentScanLocation;
      }

      const scannedQty = parseFloat(quantity) || 0;
      // Mode "theo mã": chỉ nhận scan đúng mã đang khóa
      if (this.scanMode === 'code' && this.codeCheckActiveMaterialCode) {
        const lockCode = this.normalizeCodeUpper(this.codeCheckActiveMaterialCode);
        if (this.normalizeCodeUpper(codeUpper) !== lockCode) {
          this.showAutoDismissScanNotice(
            'Sai mã',
            `Đang kiểm theo mã: ${lockCode}.\nBạn vừa scan: ${this.normalizeCodeUpper(codeUpper)}.\nBỏ qua scan này.`
          );
          return;
        }
      }
      // Rule: Qty mỗi lần scan không được > StandardPacking
      const stdCheck = this.enforceStandardPerScan(matchingMaterial, scannedQty);
      if (!stdCheck.ok) {
        this.showAutoDismissScanNotice(
          'Vượt Standard',
          `Qty scan: ${scannedQty} > Standard: ${stdCheck.max}\nMã: ${codeUpper}\nBỏ qua scan này.`
        );
        return;
      }
      const dataLoc = (matchingMaterial.location || '').trim().toUpperCase();
      const scanLoc = (this.currentScanLocation || '').trim().toUpperCase();
      const isWrongLocation = !!scanLoc && !!dataLoc && dataLoc !== scanLoc;

      const existingQty = matchingMaterial.qtyCheck || 0;
      const stockVal = matchingMaterial.stock || 0;
      const remaining = stockVal - existingQty;
      let qtyToSave = scannedQty;
      let ignoredExcess = 0;
      // DS mode: cho phép cộng dồn vượt stock để hiển thị "Dư"
      if (this.scanMode !== 'list') {
        if (remaining <= 0) {
          ignoredExcess = scannedQty;
          qtyToSave = 0;
        } else if (scannedQty > remaining) {
          ignoredExcess = scannedQty - remaining;
          qtyToSave = remaining;
        }
      }

      // DS: trùng bag -> không ghi nhận (mỗi bag chỉ 1 lần)
      if (this.scanMode === 'list' && bag) {
        const bagKey = bag.trim().toUpperCase();
        if (bagKey && this.dsSessionBags.has(bagKey)) {
          this.showAutoDismissScanNotice('Trùng bag', `Bag: ${bag}\nĐã được scan trước đó.\nBỏ qua scan này.`);
          return;
        }
        if (bagKey) this.dsSessionBags.add(bagKey);
        matchingMaterial.lastBag = bag;
      }

      if (isWrongLocation) {
        const key = `${matchingMaterial.materialCode}_${matchingMaterial.poNumber}_${matchingMaterial.imd}`;
        const existingWrong = this.wrongLocationItems.find(w => w.key === key);
        const statusNow = this.getMaterialCheckStatus(matchingMaterial);
        const remainingNow = Math.max((matchingMaterial.stock || 0) - (matchingMaterial.qtyCheck || 0), 0);
        if (existingWrong) {
          existingWrong.scannedQtyTotal += qtyToSave;
          existingWrong.ignoredExcessTotal += ignoredExcess;
          existingWrong.toLocation = scanLoc;
          existingWrong.status = statusNow;
          existingWrong.remaining = remainingNow;
        } else {
          this.wrongLocationItems.unshift({
            key,
            material: matchingMaterial,
            fromLocation: dataLoc,
            toLocation: scanLoc,
            scannedQtyTotal: qtyToSave,
            ignoredExcessTotal: ignoredExcess,
            status: statusNow,
            remaining: remainingNow
          });
        }
        if (this.wrongLocationItems.length > 50) this.wrongLocationItems.pop();

        const invId = matchingMaterial.inventoryId;
        if (invId) {
          this.firestore
            .collection('inventory-materials')
            .doc(invId)
            .set(
              {
                location: scanLoc,
                lastModified: firebase.default.firestore.FieldValue.serverTimestamp(),
                modifiedBy: 'stock-check-wrong-location-scan'
              },
              { merge: true }
            )
            .catch(err => console.error('❌ Error syncing wrong location to inventory-materials:', err));
        }
      }

      if (qtyToSave <= 0) {
        this.flashLocationMaterial(viewKey, matchingMaterial);
        this.cdr.detectChanges();
        this.focusScanInputSoon(0);
        return;
      }

      // DS: cộng dồn lượng kiểm kê theo phiên để hiển thị ở màn DS
      if (this.scanMode === 'list') {
        const k = this.buildMaterialKey(codeUpper, poTrim, imdTrim);
        const prev = this.dsSessionQtyByKey.get(k) || 0;
        this.dsSessionQtyByKey.set(k, prev + qtyToSave);
      }

      this.saveStockCheckToFirebase(matchingMaterial, qtyToSave, bag || undefined)
        .catch(err => console.error('❌ Error saving stock check (async):', err));

      const qtyText = ignoredExcess > 0 ? `${qtyToSave} (dư ${ignoredExcess} bỏ qua)` : `${qtyToSave}`;
      this.scanHistory.unshift(`✓ ${materialCode} | PO: ${poNumber} | Qty: ${qtyText}${bag ? ` | Bag: ${bag}` : ''}`);
      if (this.scanHistory.length > 5) this.scanHistory.pop();

      this.scanMessage = isWrongLocation
        ? `⚠️ SAI VỊ TRÍ (đã ghi nhận)\n` +
          `Mã: ${materialCode}\nPO: ${poNumber} | Số lượng: ${qtyText}\n` +
          `Vị trí dữ liệu (ASM1): ${dataLoc}\n` +
          `Vị trí scan: ${scanLoc}\n\n` +
          `Scan mã tiếp theo (cùng vị trí)`
        : `✓ Đã kiểm tra: ${materialCode}\nPO: ${poNumber} | Số lượng: ${qtyText}\nVị trí scan: ${this.currentScanLocation}\n\nScan mã tiếp theo (cùng vị trí)`;

      this.flashLocationMaterial(viewKey, matchingMaterial);
      this.cdr.detectChanges();
      this.focusScanInputSoon(0);
      return;
    }

    // Không tìm thấy trong bảng - tạo material mới và thêm vào (không await tải standardPacking)
    const scannedQty = parseFloat(quantity) || 0;
    // Mode "theo mã": không cho tạo mới bằng mã khác
    if (this.scanMode === 'code' && this.codeCheckActiveMaterialCode) {
      const lockCode = this.normalizeCodeUpper(this.codeCheckActiveMaterialCode);
      if (this.normalizeCodeUpper(codeUpper) !== lockCode) {
        this.showAutoDismissScanNotice(
          'Sai mã',
          `Đang kiểm theo mã: ${lockCode}.\nBạn vừa scan: ${this.normalizeCodeUpper(codeUpper)}.\nBỏ qua scan này.`
        );
        return;
      }
    }
    const newMaterial: StockCheckMaterial = {
      stt: 0,
      materialCode: materialCode,
      poNumber: poNumber,
      imd: imd,
      stock: 0,
      location: this.currentScanLocation || '',
      actualLocation: this.currentScanLocation || '',
      standardPacking: '',
      stockCheck: '✓',
      qtyCheck: scannedQty,
      idCheck: this.scannedEmployeeId,
      dateCheck: new Date(),
      openingStock: undefined,
      quantity: 0,
      exported: undefined,
      xt: undefined,
      importDate: undefined,
      batchNumber: undefined,
      isNewMaterial: true
    };

    this.allMaterials.push(newMaterial);
    this.materialByKey.set(this.buildMaterialKey(newMaterial.materialCode, newMaterial.poNumber, newMaterial.imd), newMaterial);

    // sort/filter có thể nặng; để nền để không block scan
    setTimeout(() => {
      this.sortMaterials();
      this.allMaterials.forEach((mat, index) => (mat.stt = index + 1));
      this.rebuildMaterialIndex();
      this.cdr.detectChanges();
    }, 0);

    this.saveStockCheckToFirebase(newMaterial, scannedQty, bag || undefined)
      .catch(err => console.error('❌ Error saving new material stock check (async):', err));

    this.firestore
      .collection('materials')
      .doc(materialCode)
      .get()
      .pipe(first())
      .subscribe({
        next: (materialDoc: any) => {
          try {
            if (materialDoc && materialDoc.exists) {
              const data = materialDoc.data();
              if (data && data.standardPacking) {
                newMaterial.standardPacking = data.standardPacking.toString();
                this.cdr.detectChanges();
              }
            }
          } catch (e) {
            console.log('⚠️ Could not parse standardPacking for new material:', e);
          }
        },
        error: (error: any) => console.log('⚠️ Could not load standardPacking for new material:', error)
      });

    this.scannedCount++;
    this.scanHistory.unshift(`✓ ${materialCode} | PO: ${poNumber} | Qty: ${quantity} (MỚI)`);
    if (this.scanHistory.length > 5) this.scanHistory.pop();

    this.scanMessage = `✓ Đã thêm mới và kiểm tra: ${materialCode}\nPO: ${poNumber} | Số lượng: ${quantity}\nVị trí: ${this.currentScanLocation}\n\nScan mã tiếp theo (cùng vị trí)`;
    this.flashLocationMaterial(viewKey, newMaterial);
    this.cdr.detectChanges();
    this.focusScanInputSoon(0);
  }

  private flashLocationMaterial(viewKey: string, mat: StockCheckMaterial): void {
    const loc = (this.currentScanLocation || '').trim().toUpperCase();
    if (!loc) return;

    // clear highlight cũ
    if (this.lastScannedHighlightKey && this.lastScannedHighlightKey !== viewKey) {
      const prevIdx = this.locationMaterials.findIndex(m => `${(m.materialCode || '').toUpperCase().trim()}_${(m.poNumber || '').trim()}_${(m.imd || '').trim()}` === this.lastScannedHighlightKey);
      if (prevIdx >= 0 && this.locationMaterialsView[prevIdx]) {
        (this.locationMaterialsView[prevIdx] as any)._flash = false;
      }
    }

    this.lastScannedHighlightKey = viewKey;

    // đảm bảo item có trong list box hiện tại (không reorder)
    const idx = this.locationMaterials.findIndex(m => `${(m.materialCode || '').toUpperCase().trim()}_${(m.poNumber || '').trim()}_${(m.imd || '').trim()}` === viewKey);
    if (idx >= 0) {
      const m = this.locationMaterials[idx];
      this.locationMaterialsView[idx] = {
        ...(m as any),
        _status: this.getMaterialCheckStatus(m),
        _flash: true
      };
    } else if (this.getDisplayLocation(mat) === loc) {
      this.locationMaterials.push(mat);
      this.locationMaterialsView.push({
        ...(mat as any),
        _status: this.getMaterialCheckStatus(mat),
        _flash: true
      });
    }

    if (this.lastScannedHighlightTimer) {
      clearTimeout(this.lastScannedHighlightTimer);
      this.lastScannedHighlightTimer = null;
    }
    this.lastScannedHighlightTimer = setTimeout(() => {
      const idx2 = this.locationMaterials.findIndex(m => `${(m.materialCode || '').toUpperCase().trim()}_${(m.poNumber || '').trim()}_${(m.imd || '').trim()}` === viewKey);
      if (idx2 >= 0 && this.locationMaterialsView[idx2]) {
        (this.locationMaterialsView[idx2] as any)._flash = false;
        this.cdr.detectChanges();
      }
      this.lastScannedHighlightTimer = null;
    }, 650);
  }

  private updateLocationMaterials(): void {
    const loc = (this.currentScanLocation || '').trim().toUpperCase();
    if (!loc) {
      this.locationMaterials = [];
      this.locationMaterialsView = [];
      this.locationMaterialsLocCache = '';
      return;
    }

    // Full rebuild (chỉ khi scan/chọn vị trí, hoặc vừa load dữ liệu) — KHÔNG sort, KHÔNG reorder để nhẹ nhất.
    this.locationMaterialsLocCache = loc;
    this.locationMaterials = this.allMaterials
      .filter(m => this.getDisplayLocation(m) === loc)
      .slice();

    this.locationMaterialsView = this.locationMaterials.map(m => ({
      ...m,
      _status: this.getMaterialCheckStatus(m),
      _flash: false
    }));
  }

  // TrackBy functions - tránh Angular re-render toàn bộ list
  trackByMaterial(index: number, mat: StockCheckMaterial): string {
    return `${mat.materialCode}_${mat.poNumber}_${mat.imd}`;
  }

  trackByIndex(index: number): number {
    return index;
  }

  trackByLocationBox(index: number, r: RackStat): string {
    return r.location;
  }

  trackByParentGroup(index: number, r: RackStat): string {
    return r.location; // A/B/C/...
  }

  trackByChildBoxGroup(index: number, grp: ChildBoxGroup): string {
    return grp.groupLabel;
  }

  get locationTotalCount(): number {
    return this.locationMaterials.length;
  }

  get locationCheckedCount(): number {
    const loc = (this.currentScanLocation || '').trim().toUpperCase();
    if (!loc) return 0;
    // Đếm số mã tại vị trí này đã được scan (dựa vào actualLocation)
    return this.locationMaterials.filter(m =>
      m.stockCheck === '✓' && (m.actualLocation || '').trim().toUpperCase() === loc
    ).length;
  }

  getMaterialCheckStatus(material: StockCheckMaterial): 'unchecked' | 'partial' | 'full' {
    const checkedQty = material.qtyCheck != null ? Number(material.qtyCheck) : 0;
    const expectedQty = material.stock != null ? Number(material.stock) : 0;
    if (!material.stockCheck || material.stockCheck !== '✓') return 'unchecked';
    if (expectedQty > 0 && checkedQty < expectedQty) return 'partial';
    return 'full';
  }

  ngOnInit(): void {
    this.checkMobile();
    // Reset factory selection to show selection screen
    this.selectedFactory = null;
    this.showEmployeeScanModal = true; // Scan mã nhân viên trước
    this.employeeScanInput = '';
    this.allMaterials = [];
    this.filteredMaterials = [];
    this.displayedMaterials = [];
    this.currentPage = 1;
    this.filterMode = 'all';
    this.currentScanLocation = '';
    this.locationMaterials = [];

    // Load valid locations from Location tab
    this.loadValidLocations();
  }

  @HostListener('window:resize')
  onResize(): void {
    this.checkMobile();
  }

  /** Cập nhật isMobile (≤768px) để tối ưu: không render bảng + skip filter/stats trên mobile */
  private checkMobile(): void {
    if (typeof window === 'undefined') return;
    const next = window.innerWidth <= 768;
    if (next !== this.isMobile) {
      this.isMobile = next;
      if (!this.isMobile) {
        this.showMobileFactoryModal = false;
        this.applyFilter();
        this.calculateIdCheckStats();
      }
      this.cdr.detectChanges();
    }
  }

  /**
   * Load valid locations from Location tab (collection 'locations')
   */
  loadValidLocations(): void {
    try {
      this.firestore.collection('locations')
        .valueChanges()
        .pipe(takeUntil(this.destroy$))
        .subscribe((locations: any[]) => {
          // Extract viTri field from locations
          this.validLocations = locations
            .map(loc => loc.viTri ? loc.viTri.trim().toUpperCase() : '')
            .filter(loc => loc !== ''); // Remove empty locations
          
          console.log(`✅ Loaded ${this.validLocations.length} valid locations from Location tab`);
        }, error => {
          console.error('❌ Error loading locations:', error);
          this.validLocations = []; // Fallback to empty array
        });
    } catch (error) {
      console.error('❌ Error loading valid locations:', error);
      this.validLocations = [];
    }
  }

  /**
   * Validate location format and existence
   * Location must:
   * 1. Start with letter D-Z
   * 2. Followed by numbers
   * 3. Exist in validLocations list from Location tab
   */
  validateLocation(location: string): { isValid: boolean; errorMessage?: string } {
    const locationUpper = location.trim().toUpperCase();
    
    // Check 1: Must start with letter D-Z
    if (!/^[D-Z]/.test(locationUpper)) {
      return {
        isValid: false,
        errorMessage: `❌ Vị trí không hợp lệ!\n\nVị trí phải bắt đầu bằng chữ cái từ D đến Z.\n\nVị trí đã quét: ${locationUpper}`
      };
    }
    
    // Check 2: Must be followed by numbers
    if (!/^[D-Z]\d+/.test(locationUpper)) {
      return {
        isValid: false,
        errorMessage: `❌ Vị trí không hợp lệ!\n\nVị trí phải bắt đầu bằng chữ cái (D-Z) và theo sau là số.\n\nVị trí đã quét: ${locationUpper}`
      };
    }
    
    // Check 3: Must exist in validLocations list
    if (this.validLocations.length > 0 && !this.validLocations.includes(locationUpper)) {
      return {
        isValid: false,
        errorMessage: `❌ Vị trí không tồn tại!\n\nVị trí "${locationUpper}" không có trong danh sách vị trí từ tab Location.\n\nVui lòng kiểm tra lại hoặc thêm vị trí này vào tab Location trước.`
      };
    }
    
    return { isValid: true };
  }

  ngOnDestroy(): void {
    if (this.scanNoticeTimer) {
      clearTimeout(this.scanNoticeTimer);
      this.scanNoticeTimer = null;
    }
    // Unsubscribe data subscription nếu có
    if (this.dataSubscription) {
      this.dataSubscription.unsubscribe();
      this.dataSubscription = null;
    }
    // Unsubscribe snapshot subscription nếu có
    if (this.snapshotSubscription) {
      this.snapshotSubscription.unsubscribe();
      this.snapshotSubscription = null;
    }
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Thông báo ngắn tự đóng — thay cho alert khi scan dư (không cần bấm OK) */
  private showAutoDismissScanNotice(title: string, body: string, durationMs = 300): void {
    if (this.scanNoticeTimer) {
      clearTimeout(this.scanNoticeTimer);
      this.scanNoticeTimer = null;
    }
    this.scanNoticeTitle = title;
    this.scanNoticeBody = body;
    this.showScanNoticePopup = true;
    this.cdr.detectChanges();
    this.scanNoticeTimer = setTimeout(() => {
      this.showScanNoticePopup = false;
      this.scanNoticeTimer = null;
      this.cdr.detectChanges();
      const input = document.getElementById('scan-input') as HTMLInputElement;
      if (input) {
        input.focus();
      }
    }, durationMs);
  }

  /**
   * Select factory and load data
   */
  async selectFactory(factory: 'ASM1' | 'ASM2'): Promise<void> {
    this.showMobileFactoryModal = false;
    this.selectedFactory = factory;
    this.currentPage = 1;
    this.isInitialDataLoaded = false; // Reset flag
    this.inventoryLoadedFactory = null;
    // Load report-date settings (persist across machines) BEFORE subscribing/loading snapshot.
    // If we don't await this, scan may still see old snapshot in cache and over-count.
    this.reportDateEnabledMap = {};
    this.reportOnlyDateKey = null;
    try {
      await this.loadReportDateSettings();
    } catch (err) {
      console.error('❌ [ReportByDate] Error loading report settings:', err);
    }

    // Subscribe ngay từ đầu để catch mọi thay đổi (sau khi settings đã sẵn sàng)
    this.subscribeToSnapshotChanges();

    this.loadData();

    // Nếu chưa login thì yêu cầu scan lại (edge case). Còn đã scan rồi thì không bắt scan lần nữa.
    if (!this.currentEmployeeId) {
      this.showEmployeeScanModal = true;
      this.employeeScanInput = '';
      setTimeout(() => {
        const input = document.getElementById('employee-scan-input') as HTMLInputElement;
        if (input) input.focus();
      }, 300);
    } else {
      this.showEmployeeScanModal = false;
    }
  }

  /**
   * Back to factory selection
   */
  backToSelection(): void {
    this.selectedFactory = null;
    this.exitSearchResultsMode();
    this.searchInput = '';
    this.allMaterials = [];
    this.filteredMaterials = [];
    this.displayedMaterials = [];
    this.currentPage = 1;
    this.filterMode = 'all';
    this.showEmployeeScanModal = false;
    this.currentScanLocation = '';
    this.locationMaterials = [];
  }
  
  /**
   * Handle employee ID scan (after factory selection)
   */
  onEmployeeScanEnter(): void {
    const scannedData = this.employeeScanInput.trim().toUpperCase();
    if (!scannedData) return;
    
    // Validate format: ASP + 4 số (7 ký tự)
    // Lấy 7 ký tự đầu tiên
    const employeeId = scannedData.substring(0, 7);
    
    // Check format: ASP + 4 số
    if (/^ASP\d{4}$/.test(employeeId)) {
      this.currentEmployeeId = employeeId;
      this.showEmployeeScanModal = false;
      this.employeeScanInput = '';
      this.cdr.detectChanges();

      if (this.isMobile) {
        this.showMobileFactoryModal = true;
      } else {
        setTimeout(() => {
          const searchInput = document.querySelector('.search-input') as HTMLInputElement;
          if (searchInput) {
            searchInput.focus();
          }
        }, 100);
      }
    } else {
      // Invalid format
      alert('❌ Mã nhân viên không hợp lệ!\n\nVui lòng nhập mã ASP + 4 số (ví dụ: ASP1234)');
      this.employeeScanInput = '';
      setTimeout(() => {
        const input = document.getElementById('employee-scan-input') as HTMLInputElement;
        if (input) {
          input.focus();
        }
      }, 100);
    }
  }

  cancelEmployeeScan(): void {
    this.employeeScanInput = '';
    this.cdr.detectChanges();
    setTimeout(() => {
      const input = document.getElementById('employee-scan-input') as HTMLInputElement;
      if (input) input.focus();
    }, 50);
  }

  /** Mobile: quay lại scan nhân viên từ popup chọn nhà máy */
  mobileFactoryGoBackToEmployee(): void {
    this.showMobileFactoryModal = false;
    this.selectedFactory = null;
    this.currentEmployeeId = '';
    this.showEmployeeScanModal = true;
    this.employeeScanInput = '';
    this.cdr.detectChanges();
    setTimeout(() => {
      const input = document.getElementById('employee-scan-input') as HTMLInputElement;
      if (input) input.focus();
    }, 200);
  }
  
  /**
   * Logout employee (kết thúc phiên làm việc)
   */
  logoutEmployee(): void {
    if (confirm('Bạn có chắc muốn đăng xuất?')) {
      this.showMobileFactoryModal = false;
      this.currentEmployeeId = '';
      this.showScanModal = false;
      this.scanStep = 'idle';
      this.scannedEmployeeId = '';
      this.scanInput = '';
      this.scanMessage = '';
      this.scanHistory = [];

      if (this.isMobile) {
        this.selectedFactory = null;
        this.currentScanLocation = '';
        this.locationMaterials = [];
        this.locationMaterialsView = [];
      }
      
      // Show employee scan modal again
      this.showEmployeeScanModal = true;
      this.employeeScanInput = '';
      setTimeout(() => {
        const input = document.getElementById('employee-scan-input') as HTMLInputElement;
        if (input) {
          input.focus();
        }
      }, 300);
    }
  }

  /**
   * Load inventory data from Firestore
   */
  loadData(): void {
    if (!this.selectedFactory) {
      console.log('⚠️ No factory selected');
      return;
    }

    // Unsubscribe subscription cũ nếu có để tránh race condition
    if (this.dataSubscription) {
      this.dataSubscription.unsubscribe();
      this.dataSubscription = null;
    }

    console.log(`📊 Loading data for factory: ${this.selectedFactory}`);
    this.isLoading = true;
    this.allMaterials = [];
    this.materialByKey.clear();
    this.displayedMaterials = [];

    // Load inventory materials: chỉ load 1 lần để tránh xử lý nặng lặp lại khi Firestore realtime thay đổi.
    // (snapshot stock-check đã subscribe riêng để cập nhật check realtime)
    this.dataSubscription = this.firestore
      .collection('inventory-materials', ref => ref.where('factory', '==', this.selectedFactory))
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe(async (snap: any) => {
        const materials: any[] = (snap?.docs || []).map((d: any) => ({ id: d.id, ...d.data() }));
        if (!materials || materials.length === 0) {
          this.isLoading = false;
          this.cdr.detectChanges();
          return;
        }

        // Group by materialCode and poNumber, then sum quantities
        const groupedMap = new Map<string, any>();

        materials.forEach(mat => {
          // Filter: Only show materials starting with A or B (giống materials-asm1)
          if (!mat.materialCode || (!mat.materialCode.toUpperCase().startsWith('A') && !mat.materialCode.toUpperCase().startsWith('B'))) {
            return;
          }
          
          // KHÔNG group - giữ nguyên tất cả dòng như materials-asm1
          // Mỗi dòng trong inventory-materials là 1 item riêng biệt
          const key = `${mat.materialCode}_${mat.poNumber}_${mat.batchNumber || ''}_${mat.id || ''}`;
          
          groupedMap.set(key, {
            materialCode: mat.materialCode,
            poNumber: mat.poNumber,
            location: mat.location || '',
            openingStock: mat.openingStock || 0,
            quantity: mat.quantity || 0,
            exported: mat.exported || 0,
            xt: mat.xt || 0,
            importDate: mat.importDate ? mat.importDate.toDate() : null,
            batchNumber: mat.batchNumber || '',
            id: mat.id || '',
            // Thông tin đổi vị trí
            lastModified: mat.lastModified ? (mat.lastModified.toDate ? mat.lastModified.toDate() : new Date(mat.lastModified)) : null,
            modifiedBy: mat.modifiedBy || ''
          });
        });

        // Convert map to array và tính stock ngay (không chờ standardPacking để load nhanh hơn)
        const materialCodes = Array.from(groupedMap.keys()).map(key => key.split('_')[0]);
        const uniqueMaterialCodes = [...new Set(materialCodes)];
        const materialsArray = Array.from(groupedMap.values()).map((mat, index) => {
          const openingStockValue = mat.openingStock !== null ? mat.openingStock : 0;
          const stock = openingStockValue + (mat.quantity || 0) - (mat.exported || 0) - (mat.xt || 0);
          const standardPacking = ''; // Sẽ tải ở background
          
          // Kiểm tra xem material có đổi vị trí không
          const hasLocationChange = mat.modifiedBy === 'location-change-scanner' && mat.lastModified;
          const locationChangeInfo = hasLocationChange ? {
            hasChanged: true,
            newLocation: mat.location,
            changeDate: mat.lastModified,
            changedBy: mat.modifiedBy || 'Hệ thống'
          } : {
            hasChanged: false,
            newLocation: mat.location,
            changeDate: undefined,
            changedBy: undefined
          };
          
          return {
            stt: index + 1,
            materialCode: mat.materialCode,
            poNumber: mat.poNumber,
            imd: this.getDisplayIMD(mat),
            stock: stock,
            location: mat.location,
            inventoryId: mat.id,
            standardPacking: standardPacking,
            stockCheck: '',
            qtyCheck: null,
            idCheck: '',
            dateCheck: null,
            openingStock: mat.openingStock,
            quantity: mat.quantity,
            exported: mat.exported,
            xt: mat.xt,
            importDate: mat.importDate,
            batchNumber: mat.batchNumber,
            locationChangeInfo: locationChangeInfo
          };
        });
        
        console.log(`📊 Stock Check: Loaded ${materialsArray.length} materials (KHÔNG group - giống materials-asm1)`);
        console.log(`📊 Stock Check: Total from inventory-materials: ${materials.length}, After filter A/B: ${materialsArray.length}`);

        // Load stock check data from Firebase
        await this.loadStockCheckData(materialsArray);
        // Apply report date ON/OFF switches
        this.applyReportDateRecognitionToMaterials(materialsArray);

        // BỎ load KHSX để giảm tải (theo yêu cầu)

        this.allMaterials = materialsArray;
        this.rebuildMaterialIndex();
        this.invalidateRackStatsCache();
        this.inventoryLoadedFactory = this.selectedFactory;

        // Nếu đang có vị trí scan, cập nhật danh sách box theo vị trí
        this.updateLocationMaterials();
        
        // Calculate ID check statistics
        this.calculateIdCheckStats();

        // Sort materials based on current sort mode
        this.sortMaterials();

        // Update STT after sorting
        this.allMaterials.forEach((mat, index) => {
          mat.stt = index + 1;
        });
        this.rebuildMaterialIndex();

        // Kết quả tìm kiếm (snapshot) giữ nguyên — không ghi đè khi Firestore cập nhật
        if (this.searchResultsMode) {
          this.filteredMaterials = this.frozenSearchMaterials;
          this.totalPages = Math.ceil(this.frozenSearchMaterials.length / this.itemsPerPage) || 1;
          if (this.currentPage > this.totalPages) {
            this.currentPage = Math.max(1, this.totalPages);
          }
          this.loadPageFromFiltered(this.currentPage);
        } else {
          // Initialize filtered materials
          this.filteredMaterials = [...this.allMaterials];

          // Calculate total pages
          this.totalPages = Math.ceil(this.filteredMaterials.length / this.itemsPerPage);

          // Load first page
          this.loadPageFromFiltered(1);
        }
        
        // Calculate ID check statistics
        this.calculateIdCheckStats();
        
        // Force change detection to ensure UI updates
        this.cdr.detectChanges();
        
        this.isLoading = false;
        
        // Final check - log checked materials count
        const checkedCount = this.allMaterials.filter(m => m.stockCheck === '✓').length;
        console.log(`✅ [loadData] Final: ${checkedCount} materials marked as checked out of ${this.allMaterials.length} total`);
        
        // Đánh dấu đã load initial data xong
        this.isInitialDataLoaded = true;

        // Tải standardPacking ở background để không chặn giao diện
        this.loadStandardPackingInBackground(uniqueMaterialCodes).catch(err =>
          console.error('Error loading standardPacking in background:', err)
        );
      });
  }

  /** Tải standardPacking cho các mã và cập nhật vào allMaterials (chạy sau khi đã hiển thị danh sách) */
  private async loadStandardPackingInBackground(codes: string[]): Promise<void> {
    if (!codes.length) return;
    const standardPackingMap = new Map<string, string>();
    try {
      const batchSize = 100;
      for (let i = 0; i < codes.length; i += batchSize) {
        const chunk = codes.slice(i, i + batchSize);
        const snaps = await Promise.all(
          chunk.map(code => this.firestore.collection('materials').doc(code).get().toPromise())
        );
        snaps.forEach((doc, idx) => {
          if (doc && doc.exists) {
            const data = doc.data();
            const sp = data?.['standardPacking'];
            if (sp != null) standardPackingMap.set(chunk[idx], sp.toString());
          }
        });
      }
      this.allMaterials.forEach(m => {
        const sp = standardPackingMap.get(m.materialCode);
        if (sp) m.standardPacking = sp;
      });
      this.cdr.detectChanges();
    } catch (e) {
      console.error('loadStandardPackingInBackground:', e);
    }
  }

  /**
   * Subscribe to stock-check-snapshot changes để real-time update
   */
  private subscribeToSnapshotChanges(): void {
    // Unsubscribe subscription cũ nếu có
    if (this.snapshotSubscription) {
      this.snapshotSubscription.unsubscribe();
      this.snapshotSubscription = null;
    }

    if (!this.selectedFactory) {
      return;
    }

    const docId = `${this.selectedFactory}_stock_check_current`;
    
    this.snapshotSubscription = this.firestore
      .collection('stock-check-snapshot')
      .doc(docId)
      .valueChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe(async (snapshotData: any) => {
        // Khi đang scan: bỏ qua reload realtime để tránh lag (local state đã cập nhật ngay khi scan)
        if (this.showScanModal || this.isProcessingScanQueue) {
          return;
        }
        // Nếu chưa load initial data, skip (sẽ được load trong loadData)
        if (!this.isInitialDataLoaded) {
          console.log(`⏳ [subscribeToSnapshotChanges] Initial data not loaded yet, skipping...`);
          return;
        }

        if (!this.allMaterials || this.allMaterials.length === 0) {
          console.log(`⚠️ [subscribeToSnapshotChanges] No materials loaded yet, skipping update`);
          return;
        }

        // valueChanges() đôi khi emit null/undefined khi reconnect => KHÔNG reset ngay.
        // Chỉ reset khi xác nhận doc thật sự không tồn tại (RESET).
        if (!snapshotData || !snapshotData.materials) {
          console.log(`⚠️ [subscribeToSnapshotChanges] Snapshot missing (transient?). Verifying...`);
          const factoryAtCall = this.selectedFactory;
          const verifyDocId = `${factoryAtCall}_stock_check_current`;
          try {
            const doc = await this.firestore
              .collection('stock-check-snapshot')
              .doc(verifyDocId)
              .get()
              .toPromise();

            // Nếu user đã đổi factory trong lúc await thì bỏ qua
            if (this.selectedFactory !== factoryAtCall) return;

            if (!doc || !doc.exists) {
              console.log(`🧹 [subscribeToSnapshotChanges] Snapshot doc deleted. Resetting local check state...`);
              if (this.selectedFactory) {
                this.snapshotCache[this.selectedFactory] = { materials: [], lastUpdated: new Date() };
              }
              this.allMaterials.forEach(mat => {
                mat.stockCheck = '';
                mat.qtyCheck = null;
                mat.idCheck = '';
                mat.dateCheck = null;
                mat.actualLocation = '';
              });
              this.invalidateRackStatsCache();
              this.updateLocationMaterials();
              if (!this.searchResultsMode) {
                this.filteredMaterials = [...this.allMaterials];
                this.loadPageFromFiltered(this.currentPage);
              }
              this.calculateIdCheckStats();
              this.cdr.detectChanges();
            } else {
              const data = doc.data() as any;
              if (data && data.materials) {
                console.log(`✅ [subscribeToSnapshotChanges] Snapshot exists. Applying latest without reset.`);
                this.lastGoodSnapshotAt = Date.now();
                await this.loadStockCheckData(this.allMaterials, data);
                this.applyReportDateRecognitionToMaterials(this.allMaterials);
                this.invalidateRackStatsCache();
                this.updateLocationMaterials();
                if (!this.searchResultsMode) {
                  this.filteredMaterials = [...this.allMaterials];
                  this.loadPageFromFiltered(this.currentPage);
                }
                this.calculateIdCheckStats();
                this.cdr.detectChanges();
              }
            }
          } catch (e) {
            // Nếu verify lỗi (mạng), giữ nguyên trạng thái hiện tại, không reset
            console.log('⚠️ [subscribeToSnapshotChanges] Verify snapshot failed, keeping current UI:', e);
          }
          return;
        }

        console.log(`🔄 [subscribeToSnapshotChanges] Snapshot updated! Detected ${snapshotData.materials.length} checked materials, reloading...`);
        this.lastGoodSnapshotAt = Date.now();
        
        // Reload stock check data và apply vào materials hiện tại (truyền snapshotData trực tiếp)
        await this.loadStockCheckData(this.allMaterials, snapshotData);
        // Apply report date ON/OFF switches after snapshot updates
        this.applyReportDateRecognitionToMaterials(this.allMaterials);
        this.invalidateRackStatsCache();

        // Update location view (box) nếu đang scan theo vị trí
        this.updateLocationMaterials();
        
        // Update filtered materials (không ghi đè khi đang xem snapshot tìm kiếm)
        if (!this.searchResultsMode) {
          this.filteredMaterials = [...this.allMaterials];
          this.loadPageFromFiltered(this.currentPage);
        }

        // Recalculate stats
        this.calculateIdCheckStats();

        // Force change detection
        this.cdr.detectChanges();

        const checkedCount = this.allMaterials.filter(m => m.stockCheck === '✓').length;
        console.log(`✅ [subscribeToSnapshotChanges] Updated: ${checkedCount} materials marked as checked`);
      });
  }

  /**
   * Load stock check data from Firebase - Đơn giản: load từ 1 collection duy nhất
   */
  async loadStockCheckData(materials: StockCheckMaterial[], snapshotData?: any): Promise<void> {
    try {
      if (!this.selectedFactory || !materials || materials.length === 0) {
        return;
      }

      let checkedMaterials: any[] = [];
      const cacheKey = this.selectedFactory;

      if (snapshotData) {
        // Nếu có snapshotData trực tiếp (từ subscription), dùng luôn
        checkedMaterials = snapshotData.materials || [];
      } else {
        // Nếu không có, load từ Firebase
        const docId = `${this.selectedFactory}_stock_check_current`;
        const doc = await this.firestore
          .collection('stock-check-snapshot')
          .doc(docId)
          .get()
          .toPromise();

        if (!doc || !doc.exists) {
          console.log(`⚠️ [loadStockCheckData] No snapshot found for factory: ${this.selectedFactory}`);
          // Clear cache
          this.snapshotCache[this.selectedFactory] = {
            materials: [],
            lastUpdated: new Date()
          };
          // Reset tất cả materials về chưa check
          materials.forEach(mat => {
            mat.stockCheck = '';
            mat.qtyCheck = null;
            mat.idCheck = '';
            mat.dateCheck = null;
          });
          return;
        }

        const data = doc.data() as any;
        checkedMaterials = data.materials || [];
      }

      // Apply report-date settings to snapshot materials (this affects scanning math & prevents overcount)
      if (checkedMaterials && checkedMaterials.length > 0) {
        checkedMaterials = checkedMaterials.filter((it: any) => {
          const d = this.parseFirestoreDate(it?.dateCheck);
          if (!d) return true;
          const dk = this.toLocalDateKey(d);
          return this.isReportDateEnabled(dk);
        });
      }

      // Update cache AFTER report-date filtering so scan math won't read disabled-day data.
      this.snapshotCache[cacheKey] = {
        materials: [...checkedMaterials],
        lastUpdated: new Date()
      };

      if (checkedMaterials.length === 0) {
        console.log(`⚠️ [loadStockCheckData] No checked materials in snapshot`);
        // Reset tất cả materials về chưa check
        materials.forEach(mat => {
          mat.stockCheck = '';
          mat.qtyCheck = null;
          mat.idCheck = '';
          mat.dateCheck = null;
        });
        return;
      }

      console.log(`📦 [loadStockCheckData] Loaded ${checkedMaterials.length} checked materials from snapshot`);

      // Tạo map: key = materialCode_PO_IMD
      const checkedMap = new Map<string, any>();
      checkedMaterials.forEach((item: any) => {
        if (item.materialCode && item.poNumber && item.imd) {
          const key = `${item.materialCode}_${item.poNumber}_${item.imd}`;
          checkedMap.set(key, item);
        }
      });

      // Reset tất cả materials về chưa check trước
      materials.forEach(mat => {
        mat.stockCheck = '';
        mat.qtyCheck = null;
        mat.idCheck = '';
        mat.dateCheck = null;
      });

      // Apply checked data vào materials
      let matchedCount = 0;
      materials.forEach(mat => {
        if (mat.materialCode && mat.poNumber && mat.imd) {
          const key = `${mat.materialCode}_${mat.poNumber}_${mat.imd}`;
          const checkedItem = checkedMap.get(key);
          
          if (checkedItem) {
            mat.stockCheck = '✓';
            mat.qtyCheck = checkedItem.qtyCheck || null;
            mat.idCheck = checkedItem.idCheck || '';
            mat.dateCheck = checkedItem.dateCheck?.toDate ? checkedItem.dateCheck.toDate() : 
                           (checkedItem.dateCheck ? new Date(checkedItem.dateCheck) : null);
            mat.actualLocation = checkedItem.actualLocation || ''; // Load vị trí thực tế từ Firebase
            matchedCount++;
          }
        }
      });

      console.log(`✅ [loadStockCheckData] Applied ${matchedCount} checked materials to ${materials.length} total materials`);
      this.cdr.detectChanges();
    } catch (error) {
      console.error('❌ Error loading stock check data:', error);
    }
  }

  /**
   * Migrate dữ liệu từ collection cũ sang snapshot mới - Loại bỏ duplicate
   */
  async migrateToSnapshot(checkedMaterials: any[]): Promise<void> {
    try {
      // Loại bỏ duplicate trước khi migrate
      const uniqueMap = new Map<string, any>();
      checkedMaterials.forEach((item: any) => {
        const key = `${item.materialCode}_${item.poNumber}_${item.imd}`;
        // Nếu đã có, giữ lại bản mới nhất
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, item);
        } else {
          const existing = uniqueMap.get(key);
          const existingDate = existing.dateCheck?.toDate ? existing.dateCheck.toDate() : 
                              (existing.dateCheck ? new Date(existing.dateCheck) : new Date(0));
          const newDate = item.dateCheck?.toDate ? item.dateCheck.toDate() : 
                         (item.dateCheck ? new Date(item.dateCheck) : new Date(0));
          if (newDate > existingDate) {
            uniqueMap.set(key, item);
          }
        }
      });

      const uniqueMaterials = Array.from(uniqueMap.values());
      console.log(`📊 [migrateToSnapshot] Removed duplicates: ${checkedMaterials.length} -> ${uniqueMaterials.length}`);

      const docId = `${this.selectedFactory}_stock_check_current`;
      await this.firestore
        .collection('stock-check-snapshot')
        .doc(docId)
        .set({
          factory: this.selectedFactory,
          materials: uniqueMaterials,
          lastUpdated: new Date(),
          updatedAt: firebase.default.firestore.FieldValue.serverTimestamp(),
          migrated: true
        }, { merge: true });
      
      console.log(`✅ [migrateToSnapshot] Migrated ${uniqueMaterials.length} unique materials to snapshot`);
    } catch (error) {
      console.error('❌ [migrateToSnapshot] Error migrating:', error);
    }
  }

  /**
   * Save stock check data to Firebase - Đơn giản: lưu toàn bộ vào 1 document snapshot
   */
  // Cache snapshot trong memory để tránh đọc Firebase mỗi lần scan
  private snapshotCache: { [factory: string]: { materials: any[], lastUpdated: Date } } = {};
  /** Cache rack stats để giảm tính toán khi render box vị trí */
  private _rackStatsCache: RackStat[] | null = null;

  async saveStockCheckToFirebase(material: StockCheckMaterial, scannedQty?: number, bag?: string): Promise<void> {
    try {
      const snapshotDocId = `${this.selectedFactory}_stock_check_current`;
      
      // Sử dụng cache nếu có, nếu không thì load từ Firebase
      let checkedMaterials: any[] = [];
      const cacheKey = this.selectedFactory;
      
      if (this.snapshotCache[cacheKey] && this.snapshotCache[cacheKey].materials) {
        // Sử dụng cache - nhanh hơn nhiều
        checkedMaterials = [...this.snapshotCache[cacheKey].materials];
      } else {
        // Load snapshot hiện tại từ Firebase (chỉ lần đầu hoặc khi cache không có)
        const doc = await this.firestore
          .collection('stock-check-snapshot')
          .doc(snapshotDocId)
          .get()
          .toPromise();

        if (doc && doc.exists) {
          const data = doc.data() as any;
          checkedMaterials = data.materials || [];
        }
        
        // Lưu vào cache
        this.snapshotCache[cacheKey] = {
          materials: [...checkedMaterials],
          lastUpdated: new Date()
        };
      }

      // Tìm material trong danh sách đã check
      const key = `${material.materialCode}_${material.poNumber}_${material.imd}`;
      const existingIndex = checkedMaterials.findIndex((item: any) => 
        `${item.materialCode}_${item.poNumber}_${item.imd}` === key
      );

      // Cộng dồn số lượng nếu đã tồn tại
      const newQty = scannedQty !== undefined ? scannedQty : (material.qtyCheck || 0);
      
      if (existingIndex >= 0) {
        const existing = checkedMaterials[existingIndex];
        checkedMaterials[existingIndex] = {
          ...existing,
          qtyCheck: (existing.qtyCheck || 0) + newQty,
          idCheck: material.idCheck,
          dateCheck: material.dateCheck || new Date(),
          actualLocation: material.actualLocation || existing.actualLocation || '', // Lưu vị trí thực tế
          updatedAt: new Date()
        };
        material.qtyCheck = checkedMaterials[existingIndex].qtyCheck;
        // Cập nhật actualLocation từ Firebase
        material.actualLocation = checkedMaterials[existingIndex].actualLocation;
      } else {
        // Thêm mới
        checkedMaterials.push({
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          imd: material.imd,
          qtyCheck: newQty,
          idCheck: material.idCheck,
          dateCheck: material.dateCheck || new Date(),
          actualLocation: material.actualLocation || '', // Lưu vị trí thực tế
          updatedAt: new Date()
        });
        material.qtyCheck = newQty;
      }

      // Cập nhật cache
      this.snapshotCache[cacheKey] = {
        materials: [...checkedMaterials],
        lastUpdated: new Date()
      };

      // Lưu snapshot vào Firebase (không await - fire and forget để tăng tốc)
      // Sẽ được sync sau trong background
      this.firestore
        .collection('stock-check-snapshot')
        .doc(snapshotDocId)
        .set({
          factory: this.selectedFactory,
          materials: checkedMaterials,
          lastUpdated: new Date(),
          updatedAt: firebase.default.firestore.FieldValue.serverTimestamp()
        }, { merge: true })
        .catch(error => {
          console.error('❌ Error saving snapshot (async):', error);
        });

      // Lưu vào lịch sử vĩnh viễn (không await - fire and forget để tăng tốc)
      // Lịch sử không cần thiết phải block scan
      const historyItem: CheckHistoryItem = {
        idCheck: material.idCheck,
        qtyCheck: newQty,
        dateCheck: material.dateCheck || new Date(),
        updatedAt: new Date(),
        bag: bag || material.lastBag || undefined
      };
      
      // Save history async - không block scan
      this.saveToPermanentHistory(material, newQty, historyItem).catch(error => {
        console.error('❌ Error saving history (async):', error);
      });

      // Đồng bộ vị trí thực tế sang inventory-materials (tab materials-asm1) — mỗi lần scan có vị trí đều cập nhật
      const loc = (material.actualLocation || '').trim().toUpperCase();
      const invId = material.inventoryId;
      if (loc && invId) {
        this.firestore
          .collection('inventory-materials')
          .doc(invId)
          .set(
            {
              location: loc,
              lastModified: firebase.default.firestore.FieldValue.serverTimestamp(),
              modifiedBy: 'stock-check-actual-location'
            },
            { merge: true }
          )
          .catch(err => console.error('❌ Error syncing location to inventory-materials:', err));
      }
      
      // Khi đang scan: chỉ cập nhật location box, skip sort toàn bảng
      this.updateLocationMaterials();
      if (!this.showScanModal) {
        this.calculateIdCheckStats();
      }
      
      console.log(`✅ Stock check saved (cached): ${checkedMaterials.length} materials`);
    } catch (error) {
      console.error('❌ Error saving stock check to Firebase:', error);
    }
  }

  /**
   * Lưu vào lịch sử vĩnh viễn (collection riêng, không bị xóa khi RESET)
   * Tối ưu: Chỉ filter/sort khi cần thiết (khi history > 100 items)
   */
  async saveToPermanentHistory(material: StockCheckMaterial, scannedQty: number, historyItem: CheckHistoryItem): Promise<void> {
    try {
      if (!this.selectedFactory) return;
      
      const sanitizedMaterialCode = material.materialCode.replace(/\//g, '_');
      const sanitizedPoNumber = material.poNumber.replace(/\//g, '_');
      const sanitizedImd = material.imd.replace(/\//g, '_');
      const historyDocId = `${this.selectedFactory}_${sanitizedMaterialCode}_${sanitizedPoNumber}_${sanitizedImd}`;
      
      // Lấy document hiện tại
      const historyDoc = await this.firestore
        .collection('stock-check-history')
        .doc(historyDocId)
        .get()
        .toPromise();
      
      let historyList: any[] = [];
      if (historyDoc && historyDoc.exists) {
        const data = historyDoc.data() as any;
        historyList = data.history || [];
      }
      
      // Thêm lịch sử mới
      const newHistoryItem = {
        idCheck: historyItem.idCheck,
        qtyCheck: scannedQty, // Số lượng vừa scan
        // Không dùng serverTimestamp trong array (Firebase không hỗ trợ trong array values)
        dateCheck: new Date(),
        updatedAt: new Date(),
        bag: historyItem.bag || material.lastBag || '',
        stock: material.stock, // Lưu stock tại thời điểm check
        location: material.location || '',
        standardPacking: material.standardPacking || ''
      };
      
      historyList.push(newHistoryItem);
      
      // Tối ưu: Chỉ filter/sort khi history quá lớn (> 100 items)
      // Điều này giúp tăng tốc đáng kể khi scan nhiều
      if (historyList.length > 100) {
        // XÓA DỮ LIỆU CŨ HƠN 1 NĂM
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        
        historyList = historyList.filter(item => {
          const itemDate = item.dateCheck?.toDate ? item.dateCheck.toDate() : (item.dateCheck ? new Date(item.dateCheck) : null);
          if (!itemDate) return true; // Giữ lại nếu không có date
          return itemDate >= oneYearAgo;
        });
        
        // Sắp xếp theo date (mới nhất trước)
        historyList.sort((a, b) => {
          const dateA = a.dateCheck?.toDate ? a.dateCheck.toDate().getTime() : (a.dateCheck ? new Date(a.dateCheck).getTime() : 0);
          const dateB = b.dateCheck?.toDate ? b.dateCheck.toDate().getTime() : (b.dateCheck ? new Date(b.dateCheck).getTime() : 0);
          return dateB - dateA;
        });
      }
      
      // Lưu vào Firebase
      await this.firestore
        .collection('stock-check-history')
        .doc(historyDocId)
        .set({
          factory: this.selectedFactory,
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          imd: material.imd,
          history: historyList,
          lastUpdated: firebase.default.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      
      // Chỉ log khi cần debug
      // console.log(`📝 Saved to permanent history: ${material.materialCode} | Qty: ${scannedQty}`);
    } catch (error) {
      console.error('❌ Error saving to permanent history:', error);
    }
  }

  /**
   * Get IMD display (same logic as materials-asm1)
   */
  getDisplayIMD(material: any): string {
    if (!material.importDate) return 'N/A';
    
    const baseDate = material.importDate.toLocaleDateString('en-GB').split('/').join('');
    
    // Check if batchNumber has correct format
    if (material.batchNumber && material.batchNumber !== baseDate) {
      // Only process if batchNumber starts with baseDate and only has sequence number added
      if (material.batchNumber.startsWith(baseDate)) {
        const suffix = material.batchNumber.substring(baseDate.length);
        // Only accept suffix if it contains only numbers and has length <= 2
        if (/^\d{1,2}$/.test(suffix)) {
          return baseDate + suffix;
        }
      }
    }
    
    return baseDate;
  }

  /**
   * Load specific page from filtered materials
   */
  loadPageFromFiltered(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    
    this.currentPage = page;
    const startIndex = (page - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    
    this.displayedMaterials = this.filteredMaterials.slice(startIndex, endIndex);
  }

  /**
   * Load specific page (backward compatibility)
   */
  loadPage(page: number): void {
    this.loadPageFromFiltered(page);
  }

  /**
   * Go to previous page
   */
  previousPage(): void {
    if (this.currentPage > 1) {
      this.loadPage(this.currentPage - 1);
    }
  }

  /**
   * Go to next page
   */
  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.loadPage(this.currentPage + 1);
    }
  }

  /**
   * Update material data
   */
  updateMaterial(material: StockCheckMaterial): void {
    // Here you can add logic to save changes to Firestore if needed
    console.log('Material updated:', material);
  }

  /**
   * Start inventory checking (Kiểm Kê)
   */
  startInventoryCheck(): void {
    if (this.isLoading) {
      return;
    }
    if (!this.selectedFactory) {
      if (this.isMobile) {
        this.showMobileFactoryModal = true;
      } else {
        alert('Vui lòng chọn nhà máy (ASM1 hoặc ASM2) trước!');
      }
      return;
    }
    // Kiểm tra xem đã đăng nhập mã nhân viên chưa
    if (!this.currentEmployeeId) {
      alert('Vui lòng scan mã nhân viên trước!');
      this.showEmployeeScanModal = true;
      this.employeeScanInput = '';
      setTimeout(() => {
        const input = document.getElementById('employee-scan-input') as HTMLInputElement;
        if (input) {
          input.focus();
        }
      }, 300);
      return;
    }
    
    // Đã có mã nhân viên
    // Nếu chưa có vị trí (lần đầu hoặc đã đóng modal), yêu cầu scan vị trí
    // Nếu đã có vị trí (đang trong session), bỏ qua bước scan vị trí
    if (!this.currentScanLocation) {
      // Chưa có vị trí - yêu cầu scan vị trí trước
      this.showScanModal = true;
      this.scanStep = 'location'; // Bước 1: scan vị trí
      this.scannedEmployeeId = this.currentEmployeeId;
      this.scanInput = '';
      this.scanMessage = `ID: ${this.currentEmployeeId}\n\nVui lòng SCAN VỊ TRÍ trước, sau đó có thể SCAN MÃ HÀNG hàng loạt.`;
      this.scanHistory = [];
      this.locationMaterials = [];
      this.wrongLocationItems = [];
    } else {
      // Đã có vị trí - bỏ qua bước scan vị trí, scan mã hàng luôn
      this.showScanModal = true;
      this.scanStep = 'material'; // Bỏ qua bước scan vị trí
      this.scannedEmployeeId = this.currentEmployeeId;
      this.scanInput = '';
      this.scanMessage = `ID: ${this.currentEmployeeId}\nVị trí: ${this.currentScanLocation}\n\nScan MÃ HÀNG kiểm kê tại vị trí này.`;
      this.scanHistory = [];
      this.wrongLocationItems = [];
      this.updateLocationMaterials();
    }
    
    // Focus input after modal opens
    setTimeout(() => {
      const input = document.getElementById('scan-input') as HTMLInputElement;
      if (input) {
        input.focus();
      }
    }, 300);
  }

  /**
   * Handle scanner input (triggered by Enter or scanner)
   */
  async onScanInputEnter(): Promise<void> {
    const scannedData = this.scanInput.trim();
    if (!scannedData) return;

    // Ưu tiên "nuốt" input thật nhanh: clear + focus ngay, còn xử lý đẩy qua queue
    this.scanInput = '';
    this.cdr.detectChanges();
    this.focusScanInputSoon(0);

    // Bước 1: scan vị trí
    if (this.scanStep === 'location') {
      const locationUpper = scannedData.toUpperCase().trim();
      
      // Validate location
      const validation = this.validateLocation(locationUpper);
      
      if (!validation.isValid) {
        // Invalid location - show error and clear input
        alert(validation.errorMessage || '❌ Vị trí không hợp lệ!');
        this.scanInput = '';
        this.scanMessage = `ID: ${this.currentEmployeeId}\n\n❌ Vị trí không hợp lệ!\n\nVui lòng SCAN LẠI VỊ TRÍ.\n\nYêu cầu:\n- Bắt đầu bằng chữ cái D-Z\n- Theo sau là số\n- Phải có trong danh sách vị trí từ tab Location`;
        
        // Focus lại input để scan lại
        setTimeout(() => {
          const input = document.getElementById('scan-input') as HTMLInputElement;
          if (input) {
            input.focus();
          }
        }, 100);
        return;
      }
      
      // Location is valid - save and proceed
      this.currentScanLocation = locationUpper;
      this.scanHistory.push(`📍 Vị trí: ${this.currentScanLocation}`);
      this.updateLocationMaterials();
      this.wrongLocationItems = [];
      
      // Chuyển sang bước scan mã hàng
      this.scanStep = 'material';
      this.scanMessage = `ID: ${this.currentEmployeeId}\nVị trí: ${this.currentScanLocation}\n\nScan MÃ HÀNG kiểm kê tại vị trí này.`;
      
      // Focus lại input để scan tiếp
      this.focusScanInputSoon(0);
      return;
    }

    if (this.scanStep === 'material') {
      // Đảm bảo có mã nhân viên từ currentEmployeeId
      if (!this.currentEmployeeId) {
        // Nếu không có mã nhân viên, đóng modal và yêu cầu scan lại
        this.closeScanModal();
        alert('Vui lòng scan mã nhân viên trước!');
        this.showEmployeeScanModal = true;
        return;
      }
      
      // Đảm bảo đã có vị trí (nếu chưa có thì yêu cầu scan lại)
      if (!this.currentScanLocation) {
        if (!this.allowMaterialScanWithoutLocation) {
          // Nếu chưa có vị trí, chuyển về bước scan vị trí
          this.scanStep = 'location';
          this.scanInput = '';
          this.scanMessage = `ID: ${this.currentEmployeeId}\n\nVui lòng SCAN VỊ TRÍ trước, sau đó có thể SCAN MÃ HÀNG hàng loạt.`;
          setTimeout(() => {
            const input = document.getElementById('scan-input') as HTMLInputElement;
            if (input) {
              input.focus();
            }
          }, 100);
          return;
        }
      }
      
      // Đẩy qua queue để không block nhịp scan
      this.enqueueScan(scannedData);
    }
  }

  /**
   * Handle input change (auto-detect when scanner finishes)
   */
  onScanInputChange(): void {
    // Scanner typically sends data very fast followed by Enter
    // We'll rely on Enter key or manual submission
  }

  /**
   * Close scan modal
   */
  closeScanModal(showSummaryAlert: boolean = true): void {
    this.showScanModal = false;
    this.scanStep = 'idle';
    this.scanMode = 'location';
    this.allowMaterialScanWithoutLocation = false;
    this.dsLockMaterialCode = '';
    this.dsLockPoNumber = '';
    this.dsLockImd = '';
    this.scannedEmployeeId = '';
    this.scanMessage = '';
    this.scanInput = '';
    this.scanHistory = [];
    this.currentScanLocation = '';
    this.locationMaterials = [];
    this.locationMaterialsView = [];
    this.lastScannedLocationKey = '';
    this.wrongLocationItems = [];

    // Sau khi đóng modal mới sync lại bảng + stats (tránh làm chậm khi đang scan)
    this.applyFilter();
    this.calculateIdCheckStats();
    this.cdr.detectChanges();

    // Hiển thị thông báo tổng số mã đã scan
    if (showSummaryAlert && this.scannedCount > 0) {
      alert(`Đã scan kiểm kê: ${this.scannedCount} mã`);
      this.scannedCount = 0;
    }
  }

  /** Done: nếu có mã sai vị trí thì hỏi có chuyển vị trí về currentScanLocation không */
  async onDoneScan(): Promise<void> {
    if (this.scanStep !== 'material') {
      this.closeScanModal(false);
      return;
    }

    const scanLoc = (this.currentScanLocation || '').trim().toUpperCase();
    const hasWrong = this.wrongLocationItems.length > 0 && !!scanLoc;
    const scannedTotal = this.scannedCount;

    if (hasWrong) {
      const count = this.wrongLocationItems.length;
      const ok = confirm(
        `Có ${count} mã đang bị SAI VỊ TRÍ.\n\n` +
        `Bạn có muốn CHUYỂN các mã này về vị trí đang scan: ${scanLoc} không?\n\n` +
        `- YES: chuyển vị trí\n- NO: giữ nguyên (chỉ ghi nhận check, không đổi vị trí)`
      );
      if (ok) {
        await this.moveWrongLocationsToScanLocation(scanLoc);
      }
    }

    // Lưu session summary cho mode danh sách / theo mã (để report/đối chiếu)
    try {
        if (this.selectedFactory && this.currentEmployeeId && (this.scanMode === 'list' || this.scanMode === 'code')) {
        const sid = `${this.selectedFactory}_${this.currentEmployeeId}_${Date.now()}`;
        await this.firestore
          .collection(this.STOCK_CHECK_SESSIONS_COLLECTION)
          .doc(sid)
          .set(
            {
              factory: this.selectedFactory,
              mode: this.scanMode,
              employeeId: this.currentEmployeeId,
              scannedTotal,
              scanLocation: scanLoc || '',
                checklistId: null,
              materialCode: this.scanMode === 'code' ? (this.codeCheckActiveMaterialCode || '') : '',
              createdAt: firebase.default.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
          );

        // No checklist persistence in PXK mode
      }
    } catch (e) {
      console.warn('[StockCheck] save session summary failed', e);
    }

    // Đóng modal trước (auto close popup), sau đó báo hoàn thành
    this.closeScanModal(false);
    this.scannedCount = 0;
    setTimeout(() => {
      const msg =
        `✅ Đã hoàn thành kiểm kê` +
        (scanLoc ? ` vị trí ${scanLoc}` : '') +
        (scannedTotal > 0 ? `.\n\nTổng mã đã scan: ${scannedTotal}` : '.');
      alert(msg);
    }, 0);
  }

  private async moveWrongLocationsToScanLocation(scanLoc: string): Promise<void> {
    const updates = this.wrongLocationItems.slice();
    if (updates.length === 0) return;

    try {
      // Update Firestore theo inventoryId (doc id của inventory-materials)
      for (const w of updates) {
        const invId = w.material.inventoryId;
        if (!invId) continue;

        await this.firestore
          .collection('inventory-materials')
          .doc(invId)
          .set(
            {
              location: scanLoc,
              modifiedBy: 'location-change-scanner',
              lastModified: firebase.default.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
          );

        // Update local state
        w.material.location = scanLoc;
        w.material.locationChangeInfo = {
          hasChanged: true,
          newLocation: scanLoc,
          changeDate: new Date(),
          changedBy: 'location-change-scanner'
        };
      }

      // Refresh views
      this.updateLocationMaterials();
      this.cdr.detectChanges();
    } catch (error) {
      console.error('❌ Error moving wrong locations:', error);
      alert('Có lỗi khi chuyển vị trí. Vui lòng thử lại.');
    } finally {
      this.wrongLocationItems = [];
    }
  }
  
  /**
   * Close scan success popup
   */
  closeScanSuccessPopup(showAlert: boolean = false): void {
    this.showScanSuccessPopup = false;
    this.cdr.detectChanges();
    
    // Hiển thị thông báo tổng số mã đã scan nếu được yêu cầu (khi bấm nút đóng)
    if (showAlert && this.scannedCount > 0) {
      setTimeout(() => {
        alert(`Đã scan kiểm kê: ${this.scannedCount} mã`);
      }, 200);
    }
    
    // Focus lại input để scan tiếp
    setTimeout(() => {
      const input = document.getElementById('scan-input') as HTMLInputElement;
      if (input) {
        input.focus();
      }
    }, 100);
  }

  /**
   * Mở modal reset stock check
   */
  openResetModal(): void {
    this.showResetModal = true;
    this.resetPassword = '';
    this.cdr.detectChanges();
    setTimeout(() => {
      const input = document.getElementById('reset-password-input') as HTMLInputElement;
      if (input) input.focus();
    }, 100);
  }
  
  /**
   * Đóng modal reset
   */
  closeResetModal(): void {
    this.showResetModal = false;
    this.resetPassword = '';
  }
  
  /**
   * Reset stock check (xóa tất cả dữ liệu kiểm kê nhưng lưu vào lịch sử)
   */
  async resetStockCheck(): Promise<void> {
    if (this.resetPassword !== 'admin') {
      alert('❌ Mật khẩu không đúng!');
      return;
    }
    
    if (!this.selectedFactory) {
      alert('❌ Vui lòng chọn nhà máy trước!');
      return;
    }
    
    if (!confirm(`⚠️ Bạn có chắc muốn RESET tất cả dữ liệu kiểm kê cho ${this.selectedFactory}?\n\nLịch sử vĩnh viễn sẽ được giữ lại (không bị xóa).`)) {
      return;
    }
    
    this.isResetting = true;
    
    try {
      // XÓA SNAPSHOT (đơn giản: chỉ cần xóa 1 document)
      const snapshotDocId = `${this.selectedFactory}_stock_check_current`;
      await this.firestore
        .collection('stock-check-snapshot')
        .doc(snapshotDocId)
        .delete();
      
      console.log(`🗑️ Deleted stock check snapshot for ${this.selectedFactory} (history preserved)`);

      // Clear snapshot cache để tránh hiển thị dữ liệu cũ
      this.snapshotCache[this.selectedFactory] = { materials: [], lastUpdated: new Date() };
      
      // Reset local data
      this.allMaterials.forEach(mat => {
        mat.stockCheck = '';
        mat.qtyCheck = null;
        mat.idCheck = '';
        mat.dateCheck = null;
        mat.actualLocation = '';
      });
      
      // Refresh view
      this.applyFilter();
      this.updateLocationMaterials();
      this.calculateIdCheckStats();
      
      alert(`✅ Đã RESET thành công!\n\nĐã xóa dữ liệu kiểm kê hiện tại. Lịch sử vĩnh viễn vẫn được giữ lại.`);
      this.closeResetModal();
    } catch (error: any) {
      console.error('❌ Error resetting stock check:', error);
      alert('❌ Lỗi khi reset: ' + (error.message || 'Unknown error'));
    } finally {
      this.isResetting = false;
    }
  }
  
  // ======================== KHSX FEATURE ========================

  /** Mở dialog KHSX */
  openKhsxDialog(): void {
    this.showKhsxDialog = true;
  }

  /** Đóng dialog KHSX */
  closeKhsxDialog(): void {
    this.showKhsxDialog = false;
  }

  /** Tải template Excel KHSX (1 cột: Mã hàng) */
  downloadKhsxTemplate(): void {
    const templateData = [{ 'Mã hàng': 'A001234' }, { 'Mã hàng': 'B056789' }];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(templateData);
    ws['!cols'] = [{ wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, 'KHSX');
    XLSX.writeFile(wb, 'Template_KHSX.xlsx');
  }

  /** Xử lý chọn file KHSX để import */
  onKhsxFileSelected(event: any): void {
    const file: File = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(ws);
        const codes: string[] = rows
          .map(row => {
            const val = row['Mã hàng'] || row['MA HANG'] || row['ma hang'] || Object.values(row)[0];
            return val ? String(val).trim().toUpperCase() : '';
          })
          .filter(c => c.length > 0);
        if (codes.length === 0) {
          alert('❌ Không tìm thấy dữ liệu mã hàng trong file. Vui lòng kiểm tra cột "Mã hàng".');
          return;
        }
        this.saveKhsxCodes(codes);
      } catch (err) {
        console.error('❌ Error reading KHSX file:', err);
        alert('❌ Lỗi khi đọc file Excel.');
      }
    };
    reader.readAsArrayBuffer(file);
    // Reset input để có thể chọn lại cùng file
    event.target.value = '';
  }

  /** Lưu danh sách mã KHSX vào Firebase (ghi đè dữ liệu cũ) */
  async saveKhsxCodes(codes: string[]): Promise<void> {
    if (!this.selectedFactory) return;
    try {
      const docId = `${this.selectedFactory}_khsx_list`;
      await this.firestore.collection('khsx').doc(docId).set({
        factory: this.selectedFactory,
        codes: codes,
        updatedAt: new Date(),
        count: codes.length
      });
      this.khsxCodes = codes;
      this.applyKhsxToMaterials();
      this.applyFilter();
      this.closeKhsxDialog();
      alert(`✅ Đã import ${codes.length} mã KHSX thành công!`);
    } catch (error) {
      console.error('❌ Error saving KHSX codes:', error);
      alert('❌ Lỗi khi lưu dữ liệu KHSX.');
    }
  }

  /** Load danh sách mã KHSX từ Firebase */
  async loadKhsxData(materials?: StockCheckMaterial[]): Promise<void> {
    if (!this.selectedFactory) return;
    try {
      const docId = `${this.selectedFactory}_khsx_list`;
      const doc = await this.firestore.collection('khsx').doc(docId).get().toPromise();
      if (doc && doc.exists) {
        const data = doc.data() as any;
        this.khsxCodes = (data.codes || []).map((c: string) => String(c).trim().toUpperCase());
      } else {
        this.khsxCodes = [];
      }
      // Áp dụng lên mảng materials truyền vào (hoặc allMaterials)
      this.applyKhsxToMaterials(materials);
    } catch (error) {
      console.error('❌ Error loading KHSX data:', error);
      this.khsxCodes = [];
    }
  }

  /** Đánh dấu hasKhsx cho từng material dựa vào khsxCodes */
  applyKhsxToMaterials(materials?: StockCheckMaterial[]): void {
    const target = materials || this.allMaterials;
    const khsxSet = new Set(this.khsxCodes);
    target.forEach(m => {
      m.hasKhsx = khsxSet.has((m.materialCode || '').trim().toUpperCase());
    });
  }

  // ======================== LOCATION BOX VIEW (grid) ========================

  /** Mở chi tiết bảng theo vị trí khi bấm vào 1 box */
  openLocationDetail(location: string): void {
    const loc = (location || '').trim().toUpperCase();
    if (!loc) return;
    this.exitSearchResultsMode();
    this.searchInput = '';
    this.selectedLocationForDetail = loc;
    this.filteredMaterials = this.allMaterials
      .filter(m => this.getDisplayLocation(m) === loc)
      .slice()
      .sort((a, b) => {
        const code = a.materialCode.localeCompare(b.materialCode);
        if (code !== 0) return code;
        const po = (a.poNumber || '').localeCompare(b.poNumber || '');
        if (po !== 0) return po;
        return (a.imd || '').localeCompare(b.imd || '');
      });
    this.filteredMaterials.forEach((mat, index) => { mat.stt = index + 1; });
    this.totalPages = Math.ceil(this.filteredMaterials.length / this.itemsPerPage);
    this.currentPage = 1;
    this.loadPageFromFiltered(1);
    console.log('[StockCheck] openLocationDetail', {
      loc,
      filtered: this.filteredMaterials.length,
      displayed: this.displayedMaterials.length,
      totalPages: this.totalPages
    });
    this.cdr.detectChanges();

    // Đảm bảo người dùng nhìn thấy phần chi tiết ngay sau khi bấm box
    setTimeout(() => {
      const el = document.querySelector('.location-detail-section') as HTMLElement | null;
      el?.scrollIntoView({ behavior: 'auto', block: 'start' });
    }, 0);
  }

  /** Click box mẹ → show box con */
  openParentGroup(group: string): void {
    const g = (group || '').trim().toUpperCase().charAt(0);
    if (!g) return;
    this.selectedParentGroup = g;
    this.cdr.detectChanges();
  }

  /** Quay lại danh sách box mẹ */
  backToParentGroups(): void {
    this.selectedParentGroup = null;
    this.cdr.detectChanges();
  }

  /** Quay lại giao diện grid box (ẩn bảng chi tiết) */
  backToLocationBoxes(): void {
    if (this.searchResultsMode) {
      this.clearSearch();
      this.cdr.detectChanges();
      setTimeout(() => {
        const el = document.querySelector('.location-boxes-wrapper') as HTMLElement | null;
        el?.scrollIntoView({ behavior: 'auto', block: 'start' });
      }, 0);
      return;
    }
    this.selectedLocationForDetail = null;
    // Khi quay lại danh sách box, mặc định về box mẹ
    this.selectedParentGroup = null;
    this.applyFilter();
    console.log('[StockCheck] backToLocationBoxes');
    this.cdr.detectChanges();

    setTimeout(() => {
      const el = document.querySelector('.location-boxes-wrapper') as HTMLElement | null;
      el?.scrollIntoView({ behavior: 'auto', block: 'start' });
    }, 0);
  }

  // ======================== RACK FEATURE ========================

  openRackModal(): void {
    this.rackStats = this.computeRackStats();
    this.showRackModal = true;
    this.cdr.detectChanges();
  }

  closeRackModal(): void {
    this.showRackModal = false;
  }

  openRackDetail(location: string): void {
    const loc = (location || '').trim().toUpperCase();
    this.rackDetailLocation = loc;
    this.rackDetailMaterials = this.allMaterials
      .filter(m => this.getDisplayLocation(m) === loc)
      .slice()
      .sort((a, b) => {
        const code = a.materialCode.localeCompare(b.materialCode);
        if (code !== 0) return code;
        const po = (a.poNumber || '').localeCompare(b.poNumber || '');
        if (po !== 0) return po;
        return (a.imd || '').localeCompare(b.imd || '');
      });
    this.showRackDetailModal = true;
    this.cdr.detectChanges();
  }

  closeRackDetailModal(): void {
    this.showRackDetailModal = false;
    this.rackDetailLocation = '';
    this.rackDetailMaterials = [];
  }

  /** Vị trí dùng cho box + Chi tiết vị trí + đồng bộ cột Vị trí materials-asm1: ưu tiên actualLocation */
  private getDisplayLocation(mat: StockCheckMaterial): string {
    return (mat.actualLocation || mat.location || '').trim().toUpperCase();
  }

  private computeRackStats(): RackStat[] {
    if (this._rackStatsCache) return this._rackStatsCache;
    const map = new Map<string, RackStat>();

    for (const mat of this.allMaterials) {
      const loc = this.getDisplayLocation(mat);
      if (!loc) continue;

      if (!map.has(loc)) {
        map.set(loc, { location: loc, total: 0, full: 0, partial: 0, unchecked: 0 });
      }
      const stat = map.get(loc)!;
      stat.total++;

      const status = this.getMaterialCheckStatus(mat);
      if (status === 'full') stat.full++;
      else if (status === 'partial') stat.partial++;
      else stat.unchecked++;
    }

    this._rackStatsCache = Array.from(map.values())
      .sort((a, b) => a.location.localeCompare(b.location));
    return this._rackStatsCache;
  }

  private invalidateRackStatsCache(): void {
    this._rackStatsCache = null;
  }

  exportRackReport(): void {
    if (this.rackStats.length === 0) return;

    const exportData = this.rackStats.map(r => ({
      'Vị trí':          r.location,
      'Tổng mã':         r.total,
      'Đã kiểm đủ':      r.full,
      'Kiểm chưa đủ':    r.partial,
      'Chưa kiểm':       r.unchecked,
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);
    ws['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Rack');
    XLSX.writeFile(wb, `Rack_${this.selectedFactory}_${new Date().toISOString().split('T')[0]}.xlsx`);
  }

  /**
   * Export stock check report to Excel
   */
  exportStockCheckReport(): void {
    if (this.allMaterials.length === 0) {
      alert('Không có dữ liệu để xuất!');
      return;
    }

    // Prepare data for export
    const exportData = this.allMaterials.map(mat => {
      const stockVal = mat.stock != null ? parseFloat(mat.stock.toFixed(2)) : 0;
      const qtyCheckVal = mat.qtyCheck != null ? mat.qtyCheck : null;
      const soSanh = qtyCheckVal !== null ? parseFloat((stockVal - qtyCheckVal).toFixed(2)) : '';
      return {
        'STT': mat.stt,
        'Mã hàng': mat.materialCode,
        'PO': mat.poNumber,
        'IMD': mat.imd,
        'Bag': (mat as any).lastBag || '',
        'Tồn Kho': stockVal,
        'KHSX': mat.hasKhsx ? '✔' : '',
        'Vị trí': mat.location,
        'Standard Packing': mat.standardPacking || '',
        'Stock Check': mat.stockCheck || '',
        'Qty Check': qtyCheckVal !== null ? qtyCheckVal : '',
        'So Sánh Stock': soSanh,
        'ID Check': mat.idCheck || '',
        'Date Check': mat.dateCheck ? new Date(mat.dateCheck).toLocaleString('vi-VN') : ''
      };
    });

    // Create workbook
    const wb = XLSX.utils.book_new();
    
    // Create main sheet
    const ws = XLSX.utils.json_to_sheet(exportData);
    
    // Set column widths
    ws['!cols'] = [
      { wch: 6 },  // STT
      { wch: 15 }, // Mã hàng
      { wch: 12 }, // PO
      { wch: 10 }, // IMD
      { wch: 12 }, // Bag
      { wch: 10 }, // Tồn Kho
      { wch: 8 },  // KHSX
      { wch: 12 }, // Vị trí
      { wch: 18 }, // Standard Packing
      { wch: 12 }, // Stock Check
      { wch: 10 }, // Qty Check
      { wch: 15 }, // So Sánh Stock
      { wch: 15 }, // ID Check
      { wch: 20 }  // Date Check
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Stock Check');

    // Create summary sheet
    const summary = [
      { 'Thông tin': 'Factory', 'Giá trị': this.selectedFactory },
      { 'Thông tin': 'Ngày xuất', 'Giá trị': new Date().toLocaleString('vi-VN') },
      { 'Thông tin': 'Tổng mã', 'Giá trị': this.totalMaterials },
      { 'Thông tin': 'Đã kiểm tra', 'Giá trị': this.checkedMaterials },
      { 'Thông tin': 'Chưa kiểm tra', 'Giá trị': this.uncheckedMaterials },
      { 'Thông tin': 'Tỷ lệ hoàn thành', 'Giá trị': `${((this.checkedMaterials / this.totalMaterials) * 100).toFixed(2)}%` }
    ];

    const wsSummary = XLSX.utils.json_to_sheet(summary);
    wsSummary['!cols'] = [{ wch: 20 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Tóm tắt');

    // Save file
    const fileName = `Stock_Check_${this.selectedFactory}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);

    console.log(`✅ Exported stock check report: ${fileName}`);
  }

  // ======================== REPORT BY DATE ========================

  openReportByDateModal(): void {
    if (!this.selectedFactory) {
      alert('Vui lòng chọn nhà máy trước!');
      return;
    }

    this.showReportByDateModal = true;

    // Load một lần theo factory
    if (this.reportDatesLoadedFactory !== this.selectedFactory) {
      this.loadReportDatesAndCache().catch(err =>
        console.error('❌ [ReportByDate] Error loading report dates:', err)
      );
    }
  }

  closeReportByDateModal(): void {
    this.showReportByDateModal = false;
  }

  private toLocalDateKey(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private dateKeyToLabel(dateKey: string): string {
    // YYYY-MM-DD -> dd/MM/yyyy
    const [y, m, d] = dateKey.split('-');
    if (!y || !m || !d) return dateKey;
    return `${d}/${m}/${y}`;
  }

  private parseFirestoreDate(v: any): Date | null {
    try {
      if (!v) return null;
      if (v instanceof Date) return v;
      if (typeof v?.toDate === 'function') {
        const d = v.toDate();
        return d instanceof Date && !isNaN(d.getTime()) ? d : null;
      }
      const d = new Date(v);
      return !isNaN(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }

  private async loadReportDatesAndCache(): Promise<void> {
    if (!this.selectedFactory) return;

    this.isLoadingReportDates = true;
    this.reportDateOptions = [];
    this.reportDataByDateKey.clear();

    try {
      const khsxSet = new Set((this.khsxCodes || []).map(c => String(c).trim().toUpperCase()));
      const snap = await this.firestore
        .collection('stock-check-history', ref =>
          ref.where('factory', '==', this.selectedFactory)
        )
        .get()
        .toPromise();

      if (!snap || snap.empty) {
        this.reportDatesLoadedFactory = this.selectedFactory;
        return;
      }

      // dateKey -> materialKey -> aggregated row
      const tempByDateKey: Map<string, Map<string, ReportDayAggRow>> = new Map();

      snap.forEach(doc => {
        const data = doc.data() as any;
        const materialCode = String(data?.materialCode || '').trim().toUpperCase();
        const poNumber = String(data?.poNumber || '').trim();
        const imd = String(data?.imd || '').trim();
        const history: any[] = Array.isArray(data?.history) ? data.history : [];
        if (!materialCode || !poNumber || !imd || history.length === 0) return;

        const materialKey = `${materialCode}__${poNumber}__${imd}`;

        for (const item of history) {
          const d = this.parseFirestoreDate(item?.dateCheck);
          if (!d) continue;
          const dateKey = this.toLocalDateKey(d);

          const qty = item?.qtyCheck !== undefined && item?.qtyCheck !== null ? Number(item.qtyCheck) : 0;
          if (!qty || qty === 0) {
            // vẫn có thể cần location/stock, nhưng report qty=0 thường không cần
            continue;
          }

          const stockVal = item?.stock !== undefined && item?.stock !== null ? Number(item.stock) : 0;
          const location = String(item?.location || '').trim();
          const standardPacking = String(item?.standardPacking || '').trim();
          const idCheck = String(item?.idCheck || '').trim() || '-';
          const bag = String(item?.bag || '').trim();

          if (!tempByDateKey.has(dateKey)) tempByDateKey.set(dateKey, new Map());
          const byMat = tempByDateKey.get(dateKey)!;

          const existing = byMat.get(materialKey);
          if (!existing) {
            byMat.set(materialKey, {
              materialCode,
              poNumber,
              imd,
              stock: stockVal,
              qtyCheckTotal: qty,
              location: location,
              standardPacking: standardPacking,
              idCheck: idCheck,
              lastDateCheck: d,
              hasKhsx: khsxSet.has(materialCode),
              bag: bag
            });
          } else {
            existing.qtyCheckTotal += qty;
            if (d.getTime() >= existing.lastDateCheck.getTime()) {
              existing.stock = stockVal;
              existing.location = location;
              existing.standardPacking = standardPacking;
              existing.idCheck = idCheck;
              existing.lastDateCheck = d;
              existing.bag = bag;
            }
          }
        }
      });

      const dateKeys = Array.from(tempByDateKey.keys());
      dateKeys.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());

      for (const dk of dateKeys) {
        const rows = Array.from(tempByDateKey.get(dk)!.values()).sort((a, b) =>
          a.materialCode.localeCompare(b.materialCode)
        );
        this.reportDataByDateKey.set(dk, rows);
        this.reportDateOptions.push({
          dateKey: dk,
          dateLabel: this.dateKeyToLabel(dk),
          totalMaterials: rows.length
        });

        // Default ON for newly detected date keys
        if (this.reportDateEnabledMap[dk] === undefined) {
          this.reportDateEnabledMap[dk] = true;
        }
      }

      this.reportDatesLoadedFactory = this.selectedFactory;
    } finally {
      this.isLoadingReportDates = false;
    }
  }

  isReportDateEnabled(dateKey: string): boolean {
    if (this.reportOnlyDateKey) {
      return dateKey === this.reportOnlyDateKey;
    }
    return this.reportDateEnabledMap[dateKey] !== false;
  }

  async onToggleReportDateEnabled(dateKey: string, enabled: boolean): Promise<void> {
    // Manual toggles exit "only date" mode.
    if (this.reportOnlyDateKey) {
      this.reportOnlyDateKey = null;
    }
    this.reportDateEnabledMap[dateKey] = enabled;
    await this.saveReportDateSettings();
    await this.reloadAndApplyReportDateRecognition();
  }

  private hasAnyReportDateDisabled(): boolean {
    if (this.reportOnlyDateKey) return true;
    return Object.values(this.reportDateEnabledMap).some(v => v === false);
  }

  /** Áp ON/OFF theo ngày vào dữ liệu đang hiển thị. */
  private applyReportDateRecognitionToMaterials(materials: StockCheckMaterial[]): void {
    if (!materials || materials.length === 0) return;
    if (!this.hasAnyReportDateDisabled()) return;

    materials.forEach(mat => {
      if (mat.stockCheck !== '✓') return;
      if (!mat.dateCheck) return;

      const dateObj = mat.dateCheck instanceof Date ? mat.dateCheck : new Date(mat.dateCheck as any);
      if (isNaN(dateObj.getTime())) return;

      const dk = this.toLocalDateKey(dateObj);
      const enabled = this.isReportDateEnabled(dk);
      if (!enabled) {
        mat.stockCheck = '';
        mat.qtyCheck = null;
        mat.idCheck = '';
        mat.dateCheck = null;
        mat.actualLocation = '';
      }
    });
  }

  // ======================== REPORT SETTINGS (PERSIST ACROSS MACHINES) ========================

  private reportSettingsDocId(factory: string): string {
    return `${factory}_report_settings`;
  }

  private async loadReportDateSettings(): Promise<void> {
    if (!this.selectedFactory) return;
    const docId = this.reportSettingsDocId(this.selectedFactory);
    const snap = await this.firestore
      .collection(this.REPORT_SETTINGS_COLLECTION)
      .doc(docId)
      .get()
      .toPromise();

    if (!snap || !snap.exists) {
      // Theo yêu cầu: mặc định chỉ bật ngày hôm nay (tắt toàn bộ report ngày cũ).
      this.reportOnlyDateKey = this.toLocalDateKey(new Date());
      this.reportDateEnabledMap = {};
      await this.saveReportDateSettings();
      return;
    }

    const data = snap.data() as any;
    this.reportOnlyDateKey =
      typeof data?.onlyDateKey === 'string' && data.onlyDateKey.trim()
        ? data.onlyDateKey.trim()
        : null;
    const map = data?.enabledMap && typeof data.enabledMap === 'object' ? data.enabledMap : {};
    this.reportDateEnabledMap = { ...(map || {}) };
  }

  private async saveReportDateSettings(): Promise<void> {
    if (!this.selectedFactory) return;
    const docId = this.reportSettingsDocId(this.selectedFactory);
    await this.firestore
      .collection(this.REPORT_SETTINGS_COLLECTION)
      .doc(docId)
      .set(
        {
          factory: this.selectedFactory,
          onlyDateKey: this.reportOnlyDateKey,
          enabledMap: this.reportDateEnabledMap,
          updatedAt: firebase.default.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
  }

  /** Reload snapshot check data then apply report-date switches to UI/state. */
  private async reloadAndApplyReportDateRecognition(): Promise<void> {
    if (!this.selectedFactory || !this.allMaterials || this.allMaterials.length === 0) return;

    await this.loadStockCheckData(this.allMaterials);
    this.applyReportDateRecognitionToMaterials(this.allMaterials);

    if (!this.searchResultsMode) {
      this.applyFilter();
      this.loadPageFromFiltered(this.currentPage);
    } else {
      // Keep search snapshot stable; only refresh pagination view from frozen list
      this.loadPageFromFiltered(this.currentPage);
    }

    this.calculateIdCheckStats();
    this.updateLocationMaterials();
    this.invalidateRackStatsCache();
    this.cdr.detectChanges();
  }

  async exportStockCheckReportByDate(dateKey: string): Promise<void> {
    if (!this.selectedFactory) return;

    if (!this.reportDataByDateKey.has(dateKey)) {
      await this.loadReportDatesAndCache();
    }

    const rows = this.reportDataByDateKey.get(dateKey) || [];
    if (rows.length === 0) {
      alert('Không có dữ liệu để xuất cho ngày này.');
      return;
    }

    const exportData = rows.map((r, idx) => {
      const stockVal = Number(r.stock || 0);
      const qtyCheckVal = Number(r.qtyCheckTotal || 0);
      const soSanh = parseFloat((stockVal - qtyCheckVal).toFixed(2));
      return {
        'STT': idx + 1,
        'Mã hàng': r.materialCode,
        'PO': r.poNumber,
        'IMD': r.imd,
        'Bag': r.bag || '',
        'Tồn Kho': stockVal,
        'KHSX': r.hasKhsx ? '✔' : '',
        'Vị trí': r.location || '-',
        'Standard Packing': r.standardPacking || '',
        'Stock Check': '✓',
        'Qty Check': qtyCheckVal,
        'So Sánh Stock': soSanh,
        'ID Check': r.idCheck || '',
        'Date Check': r.lastDateCheck ? r.lastDateCheck.toLocaleString('vi-VN') : ''
      };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportData);

    ws['!cols'] = [
      { wch: 6 },  // STT
      { wch: 15 }, // Mã hàng
      { wch: 12 }, // PO
      { wch: 10 }, // IMD
      { wch: 12 }, // Bag
      { wch: 10 }, // Tồn Kho
      { wch: 8 },  // KHSX
      { wch: 12 }, // Vị trí
      { wch: 18 }, // Standard Packing
      { wch: 12 }, // Stock Check
      { wch: 10 }, // Qty Check
      { wch: 15 }, // So Sánh Stock
      { wch: 15 }, // ID Check
      { wch: 20 }  // Date Check
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Stock Check');

    // Sheet so sánh với tồn kho import từ inventory-overview (nguồn inventory-materials theo factory)
    const compareRows = await this.buildCheckedVsInventoryComparison(rows);
    const compareExport = compareRows.map((r, idx) => ({
      'STT': idx + 1,
      'Mã hàng': r.materialCode,
      'IMD (đã kiểm)': r.imdList || '',
      'Qty đã kiểm': r.checkedQty,
      'Tồn kho import': r.inventoryStock,
      'Chênh lệch (Tồn - Check)': r.difference,
      'Trạng thái': r.status
    }));
    const wsCompare = XLSX.utils.json_to_sheet(compareExport);
    wsCompare['!cols'] = [
      { wch: 6 },   // STT
      { wch: 15 },  // Mã hàng
      { wch: 20 },  // IMD
      { wch: 12 },  // Qty đã kiểm
      { wch: 12 },  // Tồn kho import
      { wch: 20 },  // Chênh lệch
      { wch: 16 }   // Trạng thái
    ];
    XLSX.utils.book_append_sheet(wb, wsCompare, 'So sánh tồn kho');

    const summary = [
      { 'Thông tin': 'Factory', 'Giá trị': this.selectedFactory },
      { 'Thông tin': 'Ngày', 'Giá trị': this.dateKeyToLabel(dateKey) },
      { 'Thông tin': 'Tổng mã', 'Giá trị': rows.length }
    ];

    const wsSummary = XLSX.utils.json_to_sheet(summary);
    wsSummary['!cols'] = [{ wch: 20 }, { wch: 25 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Tóm tắt');

    const fileName = `Stock_Check_${this.selectedFactory}_${dateKey}.xlsx`;
    XLSX.writeFile(wb, fileName);

    this.closeReportByDateModal();
  }

  /** Export: gộp toàn bộ report theo THÁNG (vd. tháng 3) thành 1 file Excel. */
  async exportStockCheckReportByMonth(month1to12: number): Promise<void> {
    if (!this.selectedFactory) return;
    if (this.isExportingMonthlyReport) return;

    this.isExportingMonthlyReport = true;
    this.cdr.detectChanges();
    try {
      if (this.reportDataByDateKey.size === 0) {
        await this.loadReportDatesAndCache();
      }

      const mm = String(month1to12).padStart(2, '0');
      const dateKeys = Array.from(this.reportDataByDateKey.keys()).filter(dk => {
        const parts = String(dk || '').split('-');
        return parts.length === 3 && parts[1] === mm;
      }).sort((a, b) => a.localeCompare(b));

      if (dateKeys.length === 0) {
        alert(`Không có dữ liệu report trong tháng ${month1to12}.`);
        return;
      }

      // Gộp theo key vật tư: Mã + PO + IMD (+ Bag + Location) để tránh dính dòng khác vị trí/bịch
      const merged = new Map<string, ReportDayAggRow>();
      for (const dk of dateKeys) {
        const dayRows = this.reportDataByDateKey.get(dk) || [];
        for (const r of dayRows) {
          const key = `${String(r.materialCode || '').trim().toUpperCase()}\0${String(r.poNumber || '').trim().toUpperCase()}\0${String(r.imd || '').trim()}\0${String(r.bag || '').trim()}\0${String(r.location || '').trim().toUpperCase()}`;
          const existing = merged.get(key);
          if (!existing) {
            merged.set(key, { ...r });
            continue;
          }
          existing.qtyCheckTotal = Number(existing.qtyCheckTotal || 0) + Number(r.qtyCheckTotal || 0);
          // Stock/standard/location/khsx: giữ giá trị "mới nhất" nếu có
          existing.stock = r.stock ?? existing.stock;
          existing.standardPacking = r.standardPacking || existing.standardPacking;
          existing.location = r.location || existing.location;
          existing.hasKhsx = existing.hasKhsx || !!r.hasKhsx;
          // Bag: giữ nếu có
          existing.bag = existing.bag || r.bag;
          // Lấy lần check cuối cùng
          const tOld = existing.lastDateCheck ? new Date(existing.lastDateCheck).getTime() : 0;
          const tNew = r.lastDateCheck ? new Date(r.lastDateCheck).getTime() : 0;
          if (tNew > tOld) {
            existing.lastDateCheck = r.lastDateCheck;
            existing.idCheck = r.idCheck || existing.idCheck;
          }
        }
      }

      const rows = Array.from(merged.values()).sort((a, b) => {
        const mc = a.materialCode.localeCompare(b.materialCode);
        if (mc !== 0) return mc;
        const po = String(a.poNumber || '').localeCompare(String(b.poNumber || ''), 'vi');
        if (po !== 0) return po;
        return String(a.imd || '').localeCompare(String(b.imd || ''), 'vi');
      });

      const exportData = rows.map((r, idx) => {
        const stockVal = Number(r.stock || 0);
        const qtyCheckVal = Number(r.qtyCheckTotal || 0);
        const soSanh = parseFloat((stockVal - qtyCheckVal).toFixed(2));
        return {
          'STT': idx + 1,
          'Mã hàng': r.materialCode,
          'PO': r.poNumber,
          'IMD': r.imd,
          'Bag': r.bag || '',
          'Tồn Kho': stockVal,
          'KHSX': r.hasKhsx ? '✔' : '',
          'Vị trí': r.location || '-',
          'Standard Packing': r.standardPacking || '',
          'Stock Check': '✓',
          'Qty Check': qtyCheckVal,
          'So Sánh Stock': soSanh,
          'ID Check': r.idCheck || '',
          'Date Check': r.lastDateCheck ? r.lastDateCheck.toLocaleString('vi-VN') : ''
        };
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(exportData);
      ws['!cols'] = [
        { wch: 6 },  // STT
        { wch: 15 }, // Mã hàng
        { wch: 12 }, // PO
        { wch: 10 }, // IMD
        { wch: 12 }, // Bag
        { wch: 10 }, // Tồn Kho
        { wch: 8 },  // KHSX
        { wch: 12 }, // Vị trí
        { wch: 18 }, // Standard Packing
        { wch: 12 }, // Stock Check
        { wch: 10 }, // Qty Check
        { wch: 15 }, // So Sánh Stock
        { wch: 15 }, // ID Check
        { wch: 20 }  // Date Check
      ];
      XLSX.utils.book_append_sheet(wb, ws, `Thang_${mm}`);

      // Sheet so sánh với tồn kho import
      const compareRows = await this.buildCheckedVsInventoryComparison(rows);
      const compareExport = compareRows.map((r, idx) => ({
        'STT': idx + 1,
        'Mã hàng': r.materialCode,
        'IMD (đã kiểm)': r.imdList || '',
        'Qty đã kiểm': r.checkedQty,
        'Tồn kho import': r.inventoryStock,
        'Chênh lệch (Tồn - Check)': r.difference,
        'Trạng thái': r.status
      }));
      const wsCompare = XLSX.utils.json_to_sheet(compareExport);
      wsCompare['!cols'] = [
        { wch: 6 },   // STT
        { wch: 15 },  // Mã hàng
        { wch: 20 },  // IMD
        { wch: 12 },  // Qty đã kiểm
        { wch: 12 },  // Tồn kho import
        { wch: 20 },  // Chênh lệch
        { wch: 16 }   // Trạng thái
      ];
      XLSX.utils.book_append_sheet(wb, wsCompare, 'So sánh tồn kho');

      const years = Array.from(new Set(dateKeys.map(dk => dk.split('-')[0]).filter(Boolean))).sort();
      const monthLabel = years.length ? `${mm}/${years.join(',')}` : mm;
      const summary = [
        { 'Thông tin': 'Factory', 'Giá trị': this.selectedFactory },
        { 'Thông tin': 'Tháng', 'Giá trị': monthLabel },
        { 'Thông tin': 'Số ngày', 'Giá trị': dateKeys.length },
        { 'Thông tin': 'Tổng dòng (gộp)', 'Giá trị': rows.length }
      ];
      const wsSummary = XLSX.utils.json_to_sheet(summary);
      wsSummary['!cols'] = [{ wch: 20 }, { wch: 25 }];
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Tóm tắt');

      const fileName = `Stock_Check_${this.selectedFactory}_Thang${mm}.xlsx`;
      XLSX.writeFile(wb, fileName);
      this.closeReportByDateModal();
    } catch (e) {
      console.error('❌ [ReportByDate] Export month failed:', e);
      alert('❌ Không xuất được report theo tháng.');
    } finally {
      this.isExportingMonthlyReport = false;
      this.cdr.detectChanges();
    }
  }

  private monthlyReportDocId(factory: string, year: number, month1to12: number): string {
    const mm = String(month1to12).padStart(2, '0');
    return `${factory}__${year}-${mm}`;
  }

  async loadMonthlyReportLink(month1to12: number): Promise<void> {
    if (!this.selectedFactory) return;
    const year = new Date().getFullYear();
    const docId = this.monthlyReportDocId(this.selectedFactory, year, month1to12);
    try {
      const doc = await this.firestore.collection(this.MONTHLY_REPORTS_COLLECTION).doc(docId).ref.get();
      if (!doc.exists) {
        this.monthlyReportUrl = null;
        this.monthlyReportUpdatedAt = null;
        return;
      }
      const d: any = doc.data() || {};
      this.monthlyReportUrl = d.url || null;
      this.monthlyReportUpdatedAt = d.updatedAt?.toDate?.() || null;
    } catch (e) {
      console.error('❌ [MonthlyReport] load link failed', e);
      this.monthlyReportUrl = null;
      this.monthlyReportUpdatedAt = null;
    } finally {
      this.cdr.detectChanges();
    }
  }

  openMonthlyReportInNewTab(): void {
    if (!this.monthlyReportUrl) return;
    window.open(this.monthlyReportUrl, '_blank');
  }

  /** Tạo file Excel tháng và lưu lên Firebase (Storage + Firestore link). */
  async saveStockCheckMonthlyReportToFirebase(month1to12: number): Promise<void> {
    if (!this.selectedFactory) return;
    if (this.isSavingMonthlyReport) return;

    this.isSavingMonthlyReport = true;
    this.cdr.detectChanges();

    const factory = this.selectedFactory;
    const year = new Date().getFullYear();

    try {
      // Gọi Cloud Function để generate & upload server-side (không dính CORS).
      const res: any = await this.fns
        .httpsCallable('generateStockCheckMonthlyReportFn')({
          factory,
          year,
          month: month1to12
        })
        .toPromise();

      const url = res?.url || null;
      if (!url) {
        alert(`Không có dữ liệu report trong tháng ${month1to12}/${year}.`);
        return;
      }

      this.monthlyReportUrl = url;
      this.monthlyReportUpdatedAt = new Date();
      alert('✅ Đã gộp & lưu report tháng lên Firebase.');
    } catch (e) {
      console.error('❌ [MonthlyReport] save failed', e);
      alert('❌ Không lưu được report tháng lên Firebase.');
    } finally {
      this.isSavingMonthlyReport = false;
      this.cdr.detectChanges();
    }
  }

  /** So sánh danh sách đã kiểm kê với tồn kho import (ASM1/ASM2) theo Mã hàng (cộng dồn nhiều PO). */
  private async buildCheckedVsInventoryComparison(rows: ReportDayAggRow[]): Promise<ReportCompareRow[]> {
    if (!this.selectedFactory) return [];

    const checkedMap = new Map<string, { materialCode: string; checkedQty: number; imdSet: Set<string> }>();
    rows.forEach(r => {
      const materialCode = String(r.materialCode || '').trim().toUpperCase();
      if (!materialCode) return;
      const key = materialCode;
      const existing = checkedMap.get(key);
      if (!existing) {
        checkedMap.set(key, {
          materialCode,
          checkedQty: Number(r.qtyCheckTotal || 0),
          imdSet: new Set<string>([String(r.imd || '').trim()].filter(Boolean))
        });
      } else {
        existing.checkedQty += Number(r.qtyCheckTotal || 0);
        const imd = String(r.imd || '').trim();
        if (imd) existing.imdSet.add(imd);
      }
    });

    const inventoryMap = new Map<string, { materialCode: string; inventoryStock: number }>();
    const invSnap = await this.firestore
      .collection('inventory-materials', ref => ref.where('factory', '==', this.selectedFactory))
      .get()
      .toPromise();

    if (invSnap && !invSnap.empty) {
      invSnap.forEach(doc => {
        const data = doc.data() as any;
        const materialCode = String(data?.materialCode || '').trim().toUpperCase();
        if (!materialCode) return;
        const openingStock = Number(data?.openingStock ?? 0);
        const quantity = Number(data?.quantity ?? 0);
        const exported = Number(data?.exported ?? 0);
        const xt = Number(data?.xt ?? 0);
        const stock = openingStock + quantity - exported - xt;
        const key = materialCode;
        const existing = inventoryMap.get(key);
        if (!existing) {
          inventoryMap.set(key, { materialCode, inventoryStock: stock });
        } else {
          existing.inventoryStock += stock;
        }
      });
    }

    const allKeys = new Set<string>([...checkedMap.keys(), ...inventoryMap.keys()]);
    const result: ReportCompareRow[] = [];
    allKeys.forEach(key => {
      const c = checkedMap.get(key);
      const i = inventoryMap.get(key);
      const checkedQty = Number(c?.checkedQty ?? 0);
      const inventoryStock = Number(i?.inventoryStock ?? 0);
      const difference = Number((inventoryStock - checkedQty).toFixed(2));
      let status: ReportCompareRow['status'] = 'MATCH';
      if (c && !i) status = 'CHECK_ONLY';
      else if (!c && i) status = 'INVENTORY_ONLY';
      else if (Math.abs(difference) > 0.0001) status = 'DIFF';
      result.push({
        materialCode: c?.materialCode || i?.materialCode || '',
        checkedQty,
        inventoryStock: Number(inventoryStock.toFixed(2)),
        difference,
        status,
        imdList: c ? Array.from(c.imdSet).join(', ') : ''
      });
    });

    result.sort((a, b) =>
      a.materialCode.localeCompare(b.materialCode)
    );
    return result;
  }

  /**
   * Xóa toàn bộ mục lịch sử (history) có dateCheck thuộc ngày đã chọn — khớp cách gom ngày khi export report.
   */
  async deleteReportByDate(dateKey: string): Promise<void> {
    if (!this.selectedFactory || !dateKey) return;

    const label = this.dateKeyToLabel(dateKey);
    if (
      !confirm(
        `Xóa report kiểm kê ngày ${label}?\n\n` +
          `Sẽ gỡ mọi bản ghi scan trong lịch sử (stock-check-history) có ngày này.\n` +
          `Không thể hoàn tác.`
      )
    ) {
      return;
    }

    this.isDeletingReportDateKey = dateKey;
    this.cdr.detectChanges();

    try {
      const snap = await this.firestore
        .collection('stock-check-history', ref =>
          ref.where('factory', '==', this.selectedFactory)
        )
        .get()
        .toPromise();

      if (!snap || snap.empty) {
        alert('Không có dữ liệu để xóa.');
        return;
      }

      const db = this.firestore.firestore;
      let batch = db.batch();
      let opCount = 0;
      const MAX_BATCH = 400;

      const flushBatch = async (): Promise<void> => {
        if (opCount === 0) return;
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      };

      let updatedDocs = 0;
      let deletedDocs = 0;

      for (const docSnap of snap.docs) {
        const data = docSnap.data() as any;
        const history: any[] = Array.isArray(data?.history) ? data.history : [];
        if (history.length === 0) continue;

        const newHistory = history.filter(item => {
          const d = this.parseFirestoreDate(item?.dateCheck);
          if (!d) return true;
          return this.toLocalDateKey(d) !== dateKey;
        });

        if (newHistory.length === history.length) continue;

        const ref = docSnap.ref;
        if (newHistory.length === 0) {
          batch.delete(ref);
          deletedDocs++;
        } else {
          batch.update(ref, { history: newHistory });
          updatedDocs++;
        }
        opCount++;
        if (opCount >= MAX_BATCH) {
          await flushBatch();
        }
      }

      await flushBatch();

      if (updatedDocs === 0 && deletedDocs === 0) {
        alert(`Không có bản ghi lịch sử nào thuộc ngày ${label} để xóa.`);
        return;
      }

      this.reportDatesLoadedFactory = null;
      this.reportDataByDateKey.clear();
      await this.loadReportDatesAndCache();

      alert(
        `Đã xóa report ngày ${label}.\n` +
          `Cập nhật ${updatedDocs} tài liệu, xóa ${deletedDocs} tài liệu (hết lịch sử).`
      );
    } catch (e) {
      console.error('❌ deleteReportByDate:', e);
      alert('Lỗi khi xóa report. Xem console.');
    } finally {
      this.isDeletingReportDateKey = null;
      this.cdr.detectChanges();
    }
  }
}
