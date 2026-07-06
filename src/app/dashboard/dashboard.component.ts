import { Component, OnInit, OnDestroy, ChangeDetectorRef, HostListener, HostBinding } from '@angular/core';
import { Router } from '@angular/router';
import Chart from 'chart.js/auto';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { firstValueFrom } from 'rxjs';
import { WorkOrder, WorkOrderStatus } from '../models/material-lifecycle.model';
import { SafetyService } from '../services/safety.service';
import { FirebaseAuthService } from '../services/firebase-auth.service';
import * as XLSX from 'xlsx';

interface WorkOrderStatusRow {
  code: string;
  value: string;
  note: string;
  kitting: string;
  ready: string;
  extra: string;
  doneClass: string;
  waitingClass: string;
  kittingClass: string;
  readyClass: string;
  delayClass: string;
}

/** Heatmap weekly: mỗi ô = 1 WO theo trạng thái */
type WoHeatKind = 'done' | 'waiting' | 'kitting' | 'ready' | 'delay';

interface WoHeatmapCell {
  kind: WoHeatKind;
  tooltip: string;
  /** Line WHE/WHD hoặc ghi chú ASM3 → chấm xanh giữa ô SKU */
  giaoAsm3?: boolean;
}

interface WoHeatmapDayCol {
  label: string;
  weekday: string;
  total: number;
  cells: WoHeatmapCell[];
}

/** FG Inbound — heatmap tuần T2–T7: mỗi ô = 1 mã TP (SKU) chờ nhập kho */
type FgInHeatKind = 'chua-khoa' | 'cho-vi-tri';

interface FgInHeatmapDayCol {
  label: string;
  weekday: string;
  total: number;
  cells: { kind: FgInHeatKind; tooltip: string }[];
}

/** Nhóm IQC hiển thị Putaway staging — màu ô heatmap */
type PutawayIqcStatusKind = 'pass' | 'ng' | 'pending' | 'confirm' | 'lock';

interface PutawaySkuAgg {
  materialCode: string;
  poNumber: string;
  imd: string;
  stock: number;
  statusKind: PutawayIqcStatusKind;
}

/** 1 ô heatmap = 1 SKU (mã+PO+IMD) trong tuần đó — Putaway staging */
interface IqcHeatmapCell {
  materialCode: string;
  poNumber: string;
  imd: string;
  stock: number;
  statusKind: PutawayIqcStatusKind;
  tooltip: string;
}

interface IqcHeatmapWeekCol {
  week: string;
  count: number;
  cells: IqcHeatmapCell[];
}

/** Cột Day trong grid Day 1–Day >11 của Putaway Staging box */
interface PutawayDayCol {
  dayLabel: string;   // 'Day 1' … 'Day >11'
  colIdx: number;     // 0–11
  counts: { pass: number; ng: number; pending: number; confirm: number; tra: number };
  total: number;
}

/** Popup Putaway: 1 dòng = 1 mã hàng (SKU), gom số SKU con đã/chưa Pass */
interface PutawayModalSkuRow {
  materialCode: string;
  passCount: number;
  holdCount: number;
  notPassCount: number;
  totalSkuCount: number;
  totalStock: number;
  /** Số ngày kể từ khi nhập IQC (Day 1 = hôm nay, Day 2 = hôm qua, ...) */
  dayInIqc: number;
}

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, OnDestroy {

  /** SKU không thuộc 8 tuần hoặc thiếu ngày — nhãn cột heatmap/modal, luôn đứng trước các tuần Wxx. */
  private readonly putawayLateWeekLabel = 'Late';
  /** Putaway widget: tối đa 18 hàng/cột; vượt thì thêm cột ngang. */
  private readonly putawayMaxRowsPerColumn = 18;

  /** Tóm tắt tháng hiện tại (Done/Tổng). */
  workOrder = "...";
  shipment = "...";
  workOrderStatus: WorkOrderStatusRow[] = [];
  /** 6 cột T2–T7, mỗi ô = 1 WO (màu theo trạng thái) */
  woHeatmapDays: WoHeatmapDayCol[] = [];
  /** 0 = tuần hiện tại, -1 = tuần trước */
  woHeatmapWeekOffset = 0;
  /** Hiển thị tooltip heatmap — khớp `createdByPickerOptions` tab Work Order Status */
  private readonly woCreatedByLabels: Record<string, string> = {
    TÌNH: 'Tình',
    TUẤN: 'Tuấn',
    VŨ: 'Vũ',
    PHÚC: 'Phúc',
    TRÍ: 'Trí',
    ĐÔNG: 'Đông',
    THỊNH: 'Thịnh',
    ÂN: 'Ân',
    HOÀNG: 'Hoàng',
  };
  yesterdayOverdueCount: number = 0;
  /** Bảng chi tiết cuối dashboard: shipment 7 ngày sắp tới (cùng collection tab Shipment) */
  shipmentWeeklyDetailRows: Array<{
    shipDateLabel: string;
    shipmentCode: string;
    cartonLabel: string;
    statusLabel: string;
    statusBadge: 'green' | 'red' | 'amber';
  }> = [];
  /** 6 cột T2–T7: mỗi ô = 1 mã TP (SKU) chờ nhập kho — FG Inbound */
  fgInHeatmapDays: FgInHeatmapDayCol[] = [];

  // Factory selection
  selectedFactory: string = 'ASM1';

  
  // Work order data
  workOrders: WorkOrder[] = [];
  filteredWorkOrders: WorkOrder[] = [];

  // Safety Stock Level data - Copied from Chart tab
  weekdays = [
    { name: 'Thứ 2', day: 'Monday', date: null as Date | null, status: 'unknown', isToday: false, hasFlag: false },
    { name: 'Thứ 3', day: 'Tuesday', date: null as Date | null, status: 'unknown', isToday: false, hasFlag: false },
    { name: 'Thứ 4', day: 'Wednesday', date: null as Date | null, status: 'unknown', isToday: false, hasFlag: false },
    { name: 'Thứ 5', day: 'Thursday', date: null as Date | null, status: 'unknown', isToday: false, hasFlag: false },
    { name: 'Thứ 6', day: 'Friday', date: null as Date | null, status: 'unknown', isToday: false, hasFlag: false },
    { name: 'Thứ 7', day: 'Saturday', date: null as Date | null, status: 'unknown', isToday: false, hasFlag: false }
  ];

  // Current week dates
  currentWeekDates: Date[] = [];
  
  // Latest update date from Safety tab
  latestUpdateDate: Date | null = null;
  
  // All scan dates from Safety tab
  allScanDates: Date[] = [];
  
  // Rack Utilization Warnings
  rackWarnings: Array<{
    position: string;
    usage: number;
    currentLoad: number;
    maxCapacity: number;
    status: 'warning' | 'critical';
  }> = [];
  rackWarningsLoading = false;
  criticalCount = 0;
  warningCount = 0;

  // IQC Materials by Week
  iqcWeekData: Array<{
    week: string; // W32, W33, ...
    count: number;
  }> = [];
  /** 8 cột tuần, mỗi ô = 1 SKU trong tuần (IQC staging) */
  iqcHeatmapWeeks: IqcHeatmapWeekCol[] = [];
  iqcLoading = false;

  get iqcHeatmapHasAnySku(): boolean {
    return (this.iqcHeatmapWeeks || []).some((c) => (c.cells?.length || 0) > 0);
  }
  
  /** Grid Day 1–Day >11 hiển thị trong box Putaway Staging Area */
  putawayDayGrid: PutawayDayCol[] = [];

  // IQC Materials Modal (Putaway popup — 1 mã = 1 SKU)
  showIQCMaterialsModal: boolean = false;
  iqcMaterialsBySku: PutawayModalSkuRow[] = [];
  putawayTraMaterialsBySku: PutawayModalSkuRow[] = [];
  iqcMaterialsLoading: boolean = false;
  /** 'all' | 'pass' | 'not-pass' | 'hold' | 'tra' */
  putawayFilterMode: 'all' | 'pass' | 'not-pass' | 'hold' | 'tra' = 'all';
  putawaySortByDay: 'none' | 'asc' | 'desc' = 'none';

  togglePutawaySortDay(): void {
    if (this.putawaySortByDay === 'none' || this.putawaySortByDay === 'desc') {
      this.putawaySortByDay = 'asc';
    } else {
      this.putawaySortByDay = 'desc';
    }
  }

  refreshInterval: any;
  refreshTime = 300000; // 5 phút
  rackWarningsRefreshInterval: any;
  rackWarningsRefreshTime = 14400000; // 4 tiếng

  // Charts for widgets
  private fgTurnoverChart: Chart | null = null;

  /** % Accuracy hiển thị “tháng này” (đồng bộ với donut) */
  matAccuracyThisMonth = 99.85;
  fgAccuracyThisMonth = 100;

  /** FGs Inventory Turnover — 12 tháng 2026 (cột có số; tháng chưa có dữ liệu: chỉ nhãn) + target tháng */
  readonly fgTurnoverMonthLabels = Array.from({ length: 12 }, (_, i) => `Thg ${i + 1}`);
  readonly fgTurnoverMonthValues: readonly (number | null)[] = [
    1.33, 0.4, 0.83, 0.8, 1, null, null, null, null, null, null, null
  ];
  readonly fgTurnoverTargetMonthly = 1.33;

  get fgTurnoverReportedMonthsCount(): number {
    return this.fgTurnoverMonthValues.filter((v) => typeof v === 'number' && Number.isFinite(v)).length;
  }

  // Shipment — pagination bảng chi tiết (7 ngày sắp tới, tab Shipment)
  shipmentDetailCurrentPage = 1;
  shipmentDetailPageSize = 10;
  get shipmentDetailPageCount(): number {
    return Math.max(1, Math.ceil(this.shipmentWeeklyDetailRows.length / this.shipmentDetailPageSize));
  }
  get shipmentDetailPagedRows(): typeof this.shipmentWeeklyDetailRows {
    const start = (this.shipmentDetailCurrentPage - 1) * this.shipmentDetailPageSize;
    return this.shipmentWeeklyDetailRows.slice(start, start + this.shipmentDetailPageSize);
  }
  shipmentDetailPrevPage(): void {
    if (this.shipmentDetailCurrentPage > 1) this.shipmentDetailCurrentPage--;
  }
  shipmentDetailNextPage(): void {
    if (this.shipmentDetailCurrentPage < this.shipmentDetailPageCount) this.shipmentDetailCurrentPage++;
  }

  // WO table — same pagination
  woCurrentPage = 1;
  woPageSize = 10;
  get woPageCount(): number { return Math.max(1, Math.ceil(this.workOrderStatus.length / this.woPageSize)); }
  get woPagedRows(): WorkOrderStatusRow[] {
    const start = (this.woCurrentPage - 1) * this.woPageSize;
    return this.workOrderStatus.slice(start, start + this.woPageSize);
  }
  woPrevPage(): void { if (this.woCurrentPage > 1) this.woCurrentPage--; }
  woNextPage(): void { if (this.woCurrentPage < this.woPageCount) this.woCurrentPage++; }

  /** Layout mobile: lưới module + drill-down nhóm (≤768px / PDA ≤1024px). */
  isMobileLayout = false;
  private readonly dashboardMobileBodyClass = 'dashboard-mobile-layout';

  @HostBinding('class.dashboard-host--mobile')
  get hostMobileClass(): boolean {
    return this.isMobileLayout;
  }
  mobileNav: 'home' | 'search' | 'fav' | 'profile' = 'home';
  mobileModuleSearch = '';
  /** null = lưới theo nhóm; string = danh sách chi tiết một nhóm */
  mobileDrillCategory: string | null = null;
  mobileSearchExpanded = false;

  /** Giống menu.component: ẩn trên mobile PDA (mở đầy đủ trên desktop). */
  private readonly desktopOnlyTabPaths: string[] = [
    '/dashboard',
    '/bag-history',
    '/fg-overview',
    '/qc',
    '/qc-traceability',
    '/label',
    '/work-order-status',
    '/shipment',
    '/inventory-overview-asm1',
    '/inventory-overview-asm2',
    '/fg-out',
    '/fg-inventory',
    '/pallet-id',
    '/checklist',
    '/equipment',
    '/manage',
    '/sxxk',
    '/settings',
    '/zalo',
    '/shorted-materials'
  ];

  readonly mobileCategoryOrder = [
    'Main',
    'Production',
    'ASM1 RM',
    'Quality',
    'ASM2 RM',
    'ASM FG',
    'Tools',
    'Report',
    'Admin'
  ];

  // Menu tabs for icon grid (+ Main giống menu hệ thống)
  menuTabs = [
    { path: '/work-order-status', title: 'Work Order', icon: 'assignment', category: 'Main' },
    { path: '/shipment', title: 'Shipment', icon: 'local_shipping', category: 'Main' },
    {
      path: '/location',
      title: 'Materials',
      icon: 'inventory_2',
      category: 'Main',
      subtitle: 'Đổi vị trí cho toàn bộ nguyên vật liệu',
    },
    // Report
    { path: '/report', title: 'Report', icon: 'analytics', category: 'Report' },
    { path: '/shorted-materials', title: 'Shorted materials', icon: 'difference', category: 'Report' },
    // ASM1 RM
    { path: '/inbound-asm1', title: 'RM1 Inbound', icon: 'arrow_downward', category: 'ASM1 RM' },
    { path: '/outbound-asm1', title: 'RM1 Outbound', icon: 'arrow_upward', category: 'ASM1 RM' },
    { path: '/materials-asm1', title: 'RM1 Inventory', icon: 'inventory', category: 'ASM1 RM' },
    { path: '/inventory-overview-asm1', title: 'RM1 Overview', icon: 'assessment', category: 'ASM1 RM' },
    { path: '/bag-history', title: 'Control Batch', icon: 'history', category: 'ASM1 RM' },

    { path: '/qc', title: 'Quality', icon: 'verified', category: 'Quality' },
    { path: '/qc-traceability', title: 'Traceability', icon: 'timeline', category: 'Quality' },

    // ASM2 RM
    { path: '/inbound-asm2', title: 'RM2 Inbound', icon: 'arrow_downward', category: 'ASM2 RM' },
    { path: '/outbound-asm2', title: 'RM2 Outbound', icon: 'arrow_upward', category: 'ASM2 RM' },
    { path: '/materials-asm2', title: 'RM2 Inventory', icon: 'inventory', category: 'ASM2 RM' },
    { path: '/inventory-overview-asm2', title: 'RM2 Overview', icon: 'assessment', category: 'ASM2 RM' },

    // ASM FG
    { path: '/fg-in', title: 'FG In', icon: 'input', category: 'ASM FG' },
    { path: '/fg-out', title: 'FG Out', icon: 'output', category: 'ASM FG' },
    { path: '/fg-check', title: 'FG Check', icon: 'fact_check', category: 'ASM FG' },
    { path: '/fg-inventory', title: 'FG Inventory', icon: 'inventory_2', category: 'ASM FG' },
    { path: '/fg-overview', title: 'FG Overview', icon: 'table_chart', category: 'ASM FG' },
    { path: '/fg-location', title: 'FG Location', icon: 'edit_location', category: 'ASM FG' },
    { path: '/pallet-id', title: 'Pallet ID', icon: 'view_in_ar', category: 'ASM FG' },

    // Production
    { path: '/pd-control', title: 'PD Control', icon: 'precision_manufacturing', category: 'Production' },

    // Tools & Operations
    { path: '/materials-dashboard', title: 'Materials Dashboard', icon: 'grid_view', category: 'Tools' },
    { path: '/rm1-delivery', title: 'RM Delivery', icon: 'local_shipping', category: 'Tools' },
    { path: '/fgs-dashboard', title: 'FGs Dashboard', icon: 'grid_view', category: 'Tools' },
    { path: '/label', title: 'Label', icon: 'label', category: 'Tools' },
    { path: '/stock-check', title: 'Stock Check', icon: 'inventory_2', category: 'Tools' },

    // Admin & Reports
    { path: '/index', title: 'Bonded Report', icon: 'analytics', category: 'Admin' },
    { path: '/checklist', title: 'Safety & Quality', icon: 'checklist', category: 'Admin' },
    { path: '/equipment', title: 'Training', icon: 'integration_instructions', category: 'Admin' },
    { path: '/manage', title: 'Manage', icon: 'manage_search', category: 'Admin' },
    { path: '/sxxk', title: 'SXXK', icon: 'inventory_2', category: 'Admin' },
    { path: '/scrap', title: 'Scrap', icon: 'delete_sweep', category: 'Admin' },
    { path: '/zalo', title: 'Zalo', icon: 'chat', category: 'Admin' },
    { path: '/settings', title: 'Settings', icon: 'settings', category: 'Admin' }
  ];

  constructor(
    private firestore: AngularFirestore,
    private fns: AngularFireFunctions,
    private safetyService: SafetyService, 
    private cdr: ChangeDetectorRef,
    private router: Router,
    private authService: FirebaseAuthService
  ) { }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.updateMobileLayout();
  }

  private updateMobileLayout(): void {
    const w = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isMobileUa = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|pda|handheld|mobile/i.test(
      ua.toLowerCase()
    );
    const wasMobile = this.isMobileLayout;
    this.isMobileLayout = w <= 768 || (isMobileUa && w <= 1024);
    if (!this.isMobileLayout) {
      this.mobileDrillCategory = null;
      this.mobileSearchExpanded = false;
    } else if (!wasMobile && this.isMobileLayout) {
      this.router.navigate(['/menu']);
    }
    this.syncDashboardMobileBodyClass();
    this.cdr.markForCheck();
  }

  private syncDashboardMobileBodyClass(): void {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle(this.dashboardMobileBodyClass, this.isMobileLayout);
  }

  /** Tab hiển thị trên lưới mobile (ẩn module chỉ-desktop giống Menu). */
  isTabShownOnMobile(path: string): boolean {
    if (!this.isMobileLayout) return true;
    return !this.desktopOnlyTabPaths.includes(path);
  }

  mobileTabsFiltered(): typeof this.menuTabs {
    const q = (this.mobileModuleSearch || '').trim().toLowerCase();
    return this.menuTabs.filter((t) => {
      if (!this.isTabShownOnMobile(t.path)) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.path.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      );
    });
  }

  mobileCategoriesVisible(): string[] {
    const tabs = this.mobileTabsFiltered();
    const set = new Set(tabs.map((t) => t.category));
    return this.mobileCategoryOrder.filter((c) => set.has(c));
  }

  mobileTabsForCategory(category: string): typeof this.menuTabs {
    return this.mobileTabsFiltered().filter((t) => t.category === category);
  }

  get mobileSearchActive(): boolean {
    return this.mobileSearchExpanded || this.mobileNav === 'search';
  }

  get mobileHasSearchQuery(): boolean {
    return !!(this.mobileModuleSearch || '').trim();
  }

  openMobileCategoryDrill(category: string): void {
    this.mobileDrillCategory = category;
    this.mobileNav = 'home';
  }

  closeMobileCategoryDrill(): void {
    this.mobileDrillCategory = null;
  }

  mobileCardDesc(tab: { title: string; path?: string; subtitle?: string }): string {
    if (tab?.subtitle) {
      return tab.subtitle;
    }
    const byPath: Record<string, string> = {
      '/dashboard': 'Bảng tổng quan và chỉ số vận hành',
      '/task': 'Quản lý công việc',
      '/work-order-status': 'Theo dõi trạng thái lệnh sản xuất',
      '/shipment': 'Kế hoạch và theo dõi giao hàng',
      '/location': 'Đổi vị trí cho toàn bộ nguyên vật liệu',
      '/layout-warehouse': 'Sơ đồ kho D — LayoutD',
      '/report': 'Báo cáo và phân tích',
      '/shorted-materials': 'Theo dõi nguyên liệu bị thiếu',
      '/pd-control': 'Giám sát điều khiển sản xuất',
      '/inbound-asm1': 'Nhập kho nguyên liệu ASM1',
      '/outbound-asm1': 'Xuất kho nguyên liệu ASM1',
      '/materials-asm1': 'Quản lý tồn kho nguyên liệu ASM1',
      '/inventory-overview-asm1': 'Xem tổng quan tồn kho RM1',
      '/bag-history': 'Kiểm soát batch và bịch xuất',
      '/label': 'In tem nhãn nguyên liệu',
      '/qc': 'Kiểm tra chất lượng nguyên liệu',
      '/nhiet-do': 'Ghi nhận và theo dõi nhiệt độ',
      '/qc-traceability': 'Truy xuất nguồn gốc nguyên liệu',
      '/inbound-asm2': 'Nhập kho nguyên liệu ASM2',
      '/outbound-asm2': 'Xuất kho nguyên liệu ASM2',
      '/materials-asm2': 'Quản lý tồn kho nguyên liệu ASM2',
      '/inventory-overview-asm2': 'Xem tổng quan tồn kho RM2',
      '/fg-in': 'Nhập thành phẩm vào kho',
      '/fg-out': 'Xuất thành phẩm',
      '/fg-check': 'Kiểm tra thành phẩm trước khi xuất',
      '/fg-inventory': 'Quản lý tồn kho thành phẩm',
      '/fg-overview': 'Tổng quan tồn kho thành phẩm',
      '/fg-location': 'Đổi vị trí và nhà máy thành phẩm',
      '/pallet-id': 'Quản lý mã pallet',
      '/materials-dashboard': 'Bảng tổng hợp nguyên vật liệu',
      '/rm1-delivery': 'Giao nguyên liệu cho sản xuất',
      '/fgs-dashboard': 'Bảng tổng hợp thành phẩm',
      '/stock-check': 'Kiểm kê và đối chiếu tồn kho',
      '/index': 'Báo cáo kho ngoại quan',
      '/sxxk': 'Quản lý sản xuất xuất khẩu',
      '/scrap': 'Quản lý phế liệu',
      '/checklist': 'An toàn và chất lượng',
      '/equipment': 'Đào tạo nhân viên kho',
      '/manage': 'Cấu hình và quản trị hệ thống',
      '/settings': 'Cài đặt tài khoản và phân quyền',
      '/zalo': 'Tích hợp thông báo Zalo',
    };
    if (tab?.path && byPath[tab.path]) {
      return byPath[tab.path];
    }
    const hit = this.menuTabs.find(
      (t) => t.path === tab?.path || t.title === tab?.title
    );
    if (hit?.subtitle) {
      return hit.subtitle;
    }
    const byCategory: Record<string, string> = {
      Main: 'Quản lý vận hành và giao hàng',
      Production: 'Giám sát sản xuất',
      'ASM1 RM': 'Nhập — xuất — tồn RM1',
      Quality: 'Kiểm soát chất lượng',
      'ASM2 RM': 'Nhập — xuất — tồn RM2',
      'ASM FG': 'Quản lý thành phẩm',
      Report: 'Báo cáo và phân tích',
      Tools: 'Công cụ hỗ trợ vận hành',
      Admin: 'Quản trị hệ thống',
    };
    if (hit?.category && byCategory[hit.category]) {
      return byCategory[hit.category];
    }
    return `Mở ${tab?.title || ''}`;
  }

  iconTintClass(category: string): string {
    const map: Record<string, string> = {
      Main: 'dash-mob-ico--blue',
      Production: 'dash-mob-ico--violet',
      'ASM1 RM': 'dash-mob-ico--sky',
      Quality: 'dash-mob-ico--teal',
      'ASM2 RM': 'dash-mob-ico--rose',
      'ASM FG': 'dash-mob-ico--amber',
      Tools: 'dash-mob-ico--slate',
      Report: 'dash-mob-ico--teal',
      Admin: 'dash-mob-ico--gray'
    };
    return map[category] || 'dash-mob-ico--blue';
  }

  setMobileNav(tab: 'home' | 'search' | 'fav' | 'profile'): void {
    this.mobileNav = tab;
    if (tab === 'search') {
      this.mobileSearchExpanded = true;
    } else {
      this.mobileSearchExpanded = false;
    }
    if (tab === 'home') {
      this.closeMobileCategoryDrill();
      this.mobileSearchExpanded = false;
      this.mobileModuleSearch = '';
    }
    if (tab === 'profile') {
      this.navigateToTab('/settings');
      this.mobileNav = 'home';
    }
    if (tab === 'fav') {
      this.navigateToTab('/menu');
      this.mobileNav = 'home';
    }
    this.cdr.markForCheck();
  }
  
  navigateToTab(path: string): void {
    this.router.navigate([path]);
  }

  ngOnInit() {
    this.updateMobileLayout();
    if (this.isMobileLayout) {
      this.router.navigate(['/menu']);
      return;
    }
    // Load selected factory from localStorage
    const savedFactory = localStorage.getItem('selectedFactory');
    if (savedFactory) {
      this.selectedFactory = savedFactory;
    }
    
    this.initializeCurrentWeek();
    this.loadDashboardData();
    this.refreshInterval = setInterval(() => this.loadDashboardData(), this.refreshTime);
    
    // Load Safety data for weekday colors - Copied from Chart tab
    this.loadSafetyData();
    
    // Load Rack Utilization Warnings
    this.loadRackWarnings();

    this.rackWarningsRefreshInterval = setInterval(
      () => this.loadRackWarnings(),
      this.rackWarningsRefreshTime
    );
    
    // Load IQC materials by week
    this.loadIQCByWeek();
    
    // Listen for factory changes from navbar
    window.addEventListener('factoryChanged', (event: any) => {
      this.selectedFactory = event.detail.factory;
      console.log('Dashboard received factory change:', this.selectedFactory);
      this.loadDashboardData();
      this.loadIQCByWeek();
    });
    
    // Listen for factory changes from localStorage (for cross-tab sync)
    window.addEventListener('storage', (event) => {
      if (event.key === 'selectedFactory') {
        this.selectedFactory = event.newValue || 'ASM1';
        this.loadDashboardData();
        this.loadIQCByWeek();
      }
    });
  }

  ngOnDestroy() {
    if (typeof document !== 'undefined') {
      document.body.classList.remove(this.dashboardMobileBodyClass);
    }
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    if (this.rackWarningsRefreshInterval) clearInterval(this.rackWarningsRefreshInterval);
    if (this.fgTurnoverChart) {
      try {
        this.fgTurnoverChart.destroy();
      } catch {}
      this.fgTurnoverChart = null;
    }
  }

  createChart(canvasId: string, label: string, labels: string[], data: number[], color: string, yRange?: { min?: number, max?: number }) {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label,
          data,
          borderColor: color,
          backgroundColor: color + '33',
          fill: true,
          tension: 0.4,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#fff',
          pointBorderColor: color,
          borderWidth: 2
        }]
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `${context.dataset.label}: ${context.raw}`
            }
          }
        },
        responsive: true,
        scales: {
          y: { 
            beginAtZero: false,
            min: yRange?.min,
            max: yRange?.max,
            grid: {
              display: false // Remove Y-axis grid lines
            }
          },
          x: {
            grid: {
              display: false // Remove X-axis grid lines
            }
          }
        }
      }
    });
  }

  /** Donut tròn đầy đủ — % tháng này ở giữa */
  createAccuracyDonutChart(canvasId: string, label: string, percentage: number, color: string = '#ff9800') {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const existing = Chart.getChart(canvas);
    if (existing) {
      try {
        existing.destroy();
      } catch {}
    }

    const percentageText = percentage % 1 === 0 ? percentage.toFixed(0) + '%' : percentage.toFixed(2) + '%';
    const trackColor = 'rgba(15,23,42,0.08)';

    new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Accuracy', 'Remaining'],
        datasets: [{
          data: [percentage, Math.max(0, 100 - percentage)],
          backgroundColor: [color, trackColor],
          borderWidth: 0,
          borderRadius: 4,
          spacing: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '66%',
        layout: { padding: { top: 4, bottom: 4, left: 4, right: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false }
        }
      },
      plugins: [{
        id: 'accuracyCenterText',
        afterDraw: (chart) => {
          const c = chart.ctx;
          const { left, right, top, bottom } = chart.chartArea;
          const cx = (left + right) / 2;
          const cy = (top + bottom) / 2;
          c.save();
          c.font = `800 22px Inter, system-ui, -apple-system, 'Segoe UI', sans-serif`;
          c.fillStyle = color;
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(percentageText, cx, cy);
          c.restore();
        }
      }]
    });
  }

  // Create donut chart with total in center
  createDonutChart(canvasId: string, label: string, data: number[]) {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Calculate total
    const total = data.reduce((sum, val) => sum + val, 0);
    const totalRounded = total.toFixed(2);

    // All segments use blue color
    const blueColor = '#2196f3';
    const colors = Array(12).fill(blueColor);

    const chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: Array.from({ length: 12 }, (_, i) => `Month ${i + 1}`),
        datasets: [{
          data: data,
          backgroundColor: colors,
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '70%', // Donut hole size
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.parsed || 0;
                return `Month ${context.dataIndex + 1}: ${value.toFixed(2)}`;
              }
            }
          }
        }
      },
      plugins: [{
        id: 'centerTextPlugin',
        afterDraw: (chart) => {
          const ctx = chart.ctx;
          const centerX = chart.chartArea.left + (chart.chartArea.right - chart.chartArea.left) / 2;
          const centerY = chart.chartArea.top + (chart.chartArea.bottom - chart.chartArea.top) / 2;

          ctx.save();
          ctx.font = 'bold 32px Arial';
          ctx.fillStyle = 'rgba(229, 231, 235, 0.92)'; // light text for dark UI
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(totalRounded, centerX, centerY);
          ctx.restore();
        }
      }]
    });
  }

  async loadDashboardData() {
    try {
      // Load work orders from Firebase (this will also update summaries)
      await this.loadWorkOrdersFromFirebase();
      
      // Load shipment data from Google Sheets (keep existing)
      this.loadShipmentDataFromGoogleSheets();
      
      // Create charts (keep existing)
      this.createCharts();
      
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    }
  }

  /** Chỉ tải work order tạo trong N ngày gần nhất — Dashboard chỉ cần tuần/tháng hiện tại. */
  private readonly DASHBOARD_WO_RECENT_DAYS = 50;

  /**
   * 🔧 FIX: Trước đây dùng .snapshotChanges() KHÔNG giới hạn trên toàn bộ collection work-orders,
   * và hàm này được setInterval gọi lại mỗi 5 phút (this.refreshInterval) mà KHÔNG hủy listener cũ
   * trước khi tạo listener mới → mỗi 5 phút chồng thêm 1 listener đọc toàn bộ work-orders, để lâu
   * (màn hình luôn mở tab Dashboard) là hàng trăm listener chồng nhau. Đổi sang .get() (đọc 1 lần,
   * tự kết thúc — không thể chồng) + giới hạn 50 ngày gần nhất theo createdDate.
   */
  private async loadWorkOrdersFromFirebase() {
    try {
      // Get work orders for selected factory (ASM1 or ASM2) and Sample factories
      const factoryFilter = this.selectedFactory === 'ASM1' ? ['ASM1', 'Sample 1'] : ['ASM2', 'Sample 2'];

      console.log(`Loading work orders for factories: ${factoryFilter.join(', ')} (count by deliveryDate - Ngày Giao NVL)`);

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - this.DASHBOARD_WO_RECENT_DAYS);

      const snapshot = await this.firestore
        .collection('work-orders', ref => ref.where('createdDate', '>=', cutoff).limit(3000))
        .get()
        .toPromise();

      const workOrders = (snapshot?.docs || []).map(d => {
        const data = d.data() as any;
        const id = d.id;

        const deliveryDate = this.parseFirestoreDate(data.deliveryDate);
        const lastUpdated = this.parseFirestoreDate(data.lastUpdated);
        const createdDate = this.parseFirestoreDate(data.createdDate);
        const kittingStartedAt = this.parseFirestoreDate(data.kittingStartedAt);

        return { id, ...data, deliveryDate, lastUpdated, createdDate, kittingStartedAt };
      });

      // Filter by factory only.
      // Date counting (WO: Thứ 2–Thứ 7 tuần hiện tại / yesterday overdue) theo deliveryDate (Ngày Giao NVL).
      this.workOrders = workOrders.filter(wo => {
        const woFactory = wo.factory || 'ASM1';
        const normalizedFactory = (woFactory || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
        const normalizedTargets = factoryFilter.map(f => (f || '').toString().trim().toLowerCase().replace(/\s+/g, ' '));
        return normalizedTargets.includes(normalizedFactory);
      });

      this.filteredWorkOrders = [...this.workOrders];

      console.log(`Loaded ${this.workOrders.length} work orders for ${this.selectedFactory} (last ${this.DASHBOARD_WO_RECENT_DAYS} days)`);

      // Update summaries after loading data
      this.updateWorkOrderSummary();
      this.updateWorkOrderStatus();
    } catch (error) {
      console.error('Error loading work orders from Firebase:', error);
    }
  }

  /** LSX thuộc tháng hiện tại: ưu tiên year/month trên doc; không có thì theo Ngày Giao NVL. */
  private isWorkOrderInCurrentMonth(wo: WorkOrder): boolean {
    const now = new Date();
    const cy = now.getFullYear();
    const cm = now.getMonth() + 1;
    const y = Number(wo.year);
    const m = Number(wo.month);
    if (Number.isFinite(y) && Number.isFinite(m) && y > 0 && m >= 1 && m <= 12) {
      return y === cy && m === cm;
    }
    if (!wo.deliveryDate) {
      return false;
    }
    let d: Date;
    if (wo.deliveryDate instanceof Date) {
      d = wo.deliveryDate;
    } else if (typeof wo.deliveryDate === 'object' && wo.deliveryDate !== null && 'toDate' in (wo.deliveryDate as any)) {
      d = (wo.deliveryDate as any).toDate();
    } else {
      d = new Date(wo.deliveryDate as any);
    }
    return d.getFullYear() === cy && d.getMonth() + 1 === cm;
  }

  private updateWorkOrderSummary() {
    const monthOrders = this.workOrders.filter(wo => this.isWorkOrderInCurrentMonth(wo));

    if (monthOrders.length === 0) {
      this.workOrder = '0';
      console.log('No work orders in current month, setting summary to 0');
      return;
    }

    const totalWorkOrders = monthOrders.length;
    const completedWorkOrders = monthOrders.filter(wo => {
      if (wo.isCompleted) return true;
      if (wo.status === WorkOrderStatus.DONE) return true;
      return false;
    }).length;

    this.workOrder = `${completedWorkOrders}/${totalWorkOrders}`;
    console.log(`Work Order Summary (tháng hiện tại): ${this.workOrder} for ${this.selectedFactory}`);
    console.log(`Total in month: ${totalWorkOrders}, Completed: ${completedWorkOrders}`);

    const statusBreakdown = monthOrders.reduce((acc, wo) => {
      const status = wo.status || 'UNKNOWN';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as any);

    console.log('Work order status breakdown (month):', statusBreakdown);
  }

  /** Thứ 2 00:00 của tuần chứa `ref` (Thứ 7 = thứ Bảy, không tính Chủ nhật). */
  private getMondayOfWeekContaining(ref: Date): Date {
    const d = new Date(ref);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0 CN … 6 T7
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
  }

  private updateWorkOrderStatus() {
    this.workOrderStatus = [];
    const today = new Date();
    this.yesterdayOverdueCount = this.getYesterdayOverdueCount(today);
    
    const monday = this.getMondayOfWeekContaining(today);
    console.log('Updating work order status for Mon–Sat of week:', monday.toDateString());
    console.log('Total work orders to process:', this.workOrders.length);
    
    // 6 ngày: Thứ 2 → Thứ 7 (không Chủ nhật)
    for (let i = 0; i < 6; i++) {
      const targetDate = new Date(monday);
      targetDate.setDate(monday.getDate() + i);
      
      const dateStr = targetDate.toLocaleDateString('vi-VN', { 
        day: '2-digit', 
        month: '2-digit' 
      });
      
      const workOrdersForDate = this.getWorkOrdersForDeliveryDate(targetDate);
      
      console.log(`Date ${dateStr}: Found ${workOrdersForDate.length} work orders`);
      
      const doneCount = workOrdersForDate.filter(wo => 
        wo.status === WorkOrderStatus.DONE || wo.isCompleted
      ).length;
      
      const waitingCount = workOrdersForDate.filter(wo => 
        wo.status === WorkOrderStatus.WAITING
      ).length;

      const kittingCount = workOrdersForDate.filter(wo =>
        wo.status === WorkOrderStatus.KITTING
      ).length;
      
      const readyCount = workOrdersForDate.filter(wo => 
        wo.status === WorkOrderStatus.READY
      ).length;
      
      const delayCount = workOrdersForDate.filter(wo => 
        wo.status === WorkOrderStatus.DELAY
      ).length;
      
      const statusRow: WorkOrderStatusRow = {
        code: dateStr,
        value: doneCount > 0 ? doneCount.toString() : '—',
        note: waitingCount > 0 ? waitingCount.toString() : '—',
        kitting: kittingCount > 0 ? kittingCount.toString() : '—',
        ready: readyCount > 0 ? readyCount.toString() : '—',
        extra: delayCount > 0 ? delayCount.toString() : '—',
        // Add CSS classes for styling
        doneClass: doneCount > 0 ? 'has-value' : 'empty-cell',
        waitingClass: waitingCount > 0 ? 'has-value' : 'empty-cell',
        kittingClass: kittingCount > 0 ? 'has-value' : 'empty-cell',
        readyClass: readyCount > 0 ? 'has-value' : 'empty-cell',
        delayClass: delayCount > 0 ? 'has-value' : 'empty-cell'
      };
      
      this.workOrderStatus.push(statusRow);
      
      console.log(`Date ${dateStr}: Done=${doneCount}, Waiting=${waitingCount}, Kitting=${kittingCount}, Ready=${readyCount}, Delay=${delayCount}`);
    }
    
    console.log(`Updated Work Order Status (T2–T7, 6 ngày):`, this.workOrderStatus);

    this.refreshWoHeatmap();
    this.cdr.detectChanges();
  }

  get woHeatmapHasCells(): boolean {
    return (this.woHeatmapDays || []).some((d) => (d.cells?.length || 0) > 0);
  }

  get woWeekPillLabel(): string {
    const monday = this.getWoHeatmapMonday();
    const saturday = new Date(monday);
    saturday.setDate(monday.getDate() + 5);
    const fmt = (d: Date) =>
      d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
    const range = `${fmt(monday)}–${fmt(saturday)}`;
    return this.woHeatmapWeekOffset === 0
      ? `Tuần này · ${range}`
      : `Tuần trước · ${range}`;
  }

  toggleWoHeatmapWeek(): void {
    this.woHeatmapWeekOffset = this.woHeatmapWeekOffset === 0 ? -1 : 0;
    this.refreshWoHeatmap();
    this.cdr.detectChanges();
  }

  private getWoHeatmapMonday(): Date {
    const monday = this.getMondayOfWeekContaining(new Date());
    if (this.woHeatmapWeekOffset !== 0) {
      monday.setDate(monday.getDate() + this.woHeatmapWeekOffset * 7);
    }
    return monday;
  }

  private refreshWoHeatmap(): void {
    this.rebuildWoHeatmap(this.getWoHeatmapMonday());
  }

  get fgInHeatmapHasCells(): boolean {
    return (this.fgInHeatmapDays || []).some((d) => (d.cells?.length || 0) > 0);
  }

  private parseFirestoreDate(value: any): Date | null {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
    if (typeof value === 'object' && value !== null && 'toDate' in value) {
      const d = (value as { toDate: () => Date }).toDate();
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  private getWorkOrdersForDeliveryDate(targetDate: Date): WorkOrder[] {
    return this.workOrders.filter(wo => {
      const deliveryDate = this.parseFirestoreDate(wo.deliveryDate);
      if (!deliveryDate) return false;
      return deliveryDate.toDateString() === targetDate.toDateString();
    });
  }

  private woHeatKindFromWorkOrder(wo: WorkOrder): WoHeatKind | null {
    if (wo.status === WorkOrderStatus.DONE || wo.isCompleted) return 'done';
    if (wo.status === WorkOrderStatus.WAITING) return 'waiting';
    if (wo.status === WorkOrderStatus.KITTING) return 'kitting';
    if (wo.status === WorkOrderStatus.READY) return 'ready';
    if (wo.status === WorkOrderStatus.DELAY) return 'delay';
    return null;
  }

  private woHeatKindLabel(kind: WoHeatKind): string {
    const m: Record<WoHeatKind, string> = {
      done: 'Done',
      waiting: 'Waiting',
      kitting: 'Kitting',
      ready: 'Ready',
      delay: 'Delay'
    };
    return m[kind] || kind;
  }

  private formatWoCreatedByLabel(createdBy?: string): string {
    const key = String(createdBy ?? '').trim().toUpperCase();
    if (!key) return '—';
    return this.woCreatedByLabels[key] || createdBy || '—';
  }

  private formatWoKittingStartTime(wo: WorkOrder): string {
    const raw = (wo as any).kittingStartedAt ?? wo.lastUpdated ?? wo.createdDate;
    const d = this.parseFirestoreDate(raw);
    if (!d) return '—';
    return d.toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /** Ghi chú WO khớp "Giao ASM3" / "ASM3" (không phân biệt hoa thường). */
  private isGiaoAsm3Notes(notes?: string): boolean {
    const n = (notes || '').trim().toLowerCase();
    return n === 'giao asm3' || n === 'asm3';
  }

  private normalizeProductionLineKey(line: string): string {
    return String(line || '').replace(/\s/g, '').toUpperCase();
  }

  /** Line nhận WHE / WHD → ASM3 (cùng quy tắc tab Work Order Status). */
  private isAsm3ProductionLine(line?: string): boolean {
    const key = this.normalizeProductionLineKey(line || '');
    if (!key || key === '-') return false;
    if (key === 'WHE' || key === 'WHD') return true;
    return key.startsWith('WHE') || key.startsWith('WHD');
  }

  private isWoAsm3Marked(wo: WorkOrder): boolean {
    return this.isAsm3ProductionLine(wo.productionLine) || this.isGiaoAsm3Notes(wo.notes);
  }

  private formatWoAsm3TooltipSuffix(wo: WorkOrder): string | null {
    if (this.isAsm3ProductionLine(wo.productionLine)) {
      const line = String(wo.productionLine || '').trim();
      return line ? `ASM3 (Line ${line})` : 'ASM3';
    }
    const notes = (wo.notes || '').trim().toLowerCase();
    if (notes === 'giao asm3') return 'Giao ASM3';
    if (notes === 'asm3') return 'ASM3';
    return null;
  }

  private buildWoHeatmapCell(wo: WorkOrder, kind: WoHeatKind): WoHeatmapCell {
    const giaoAsm3 = this.isWoAsm3Marked(wo);
    const asm3Label = this.formatWoAsm3TooltipSuffix(wo);
    if (kind !== 'kitting') {
      const sku = (wo.productCode || '').trim();
      const base = this.woHeatKindLabel(kind);
      const parts = sku ? [`${sku} · ${base}`] : [base];
      if (asm3Label) parts.push(asm3Label);
      return { kind, tooltip: parts.join('\n'), giaoAsm3 };
    }
    const sku = (wo.productCode || '—').trim();
    const lsx = (wo.productionOrder || '').trim();
    const lines = [sku];
    if (lsx) lines.push(`LSX: ${lsx}`);
    lines.push(`Người soạn: ${this.formatWoCreatedByLabel(wo.createdBy)}`);
    lines.push(`Bắt đầu: ${this.formatWoKittingStartTime(wo)}`);
    if (asm3Label) lines.push(asm3Label);
    return { kind, tooltip: lines.join('\n'), giaoAsm3 };
  }

  private rebuildWoHeatmap(monday: Date): void {
    const vnDays = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const kindOrder: WoHeatKind[] = ['done', 'waiting', 'kitting', 'ready', 'delay'];
    this.woHeatmapDays = [];
    for (let i = 0; i < 6; i++) {
      const targetDate = new Date(monday);
      targetDate.setDate(monday.getDate() + i);
      const dateStr = targetDate.toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit'
      });
      const workOrdersForDate = this.getWorkOrdersForDeliveryDate(targetDate);
      const cells: WoHeatmapCell[] = [];
      for (const kind of kindOrder) {
        for (const wo of workOrdersForDate) {
          if (this.woHeatKindFromWorkOrder(wo) === kind) {
            cells.push(this.buildWoHeatmapCell(wo, kind));
          }
        }
      }
      this.woHeatmapDays.push({
        label: dateStr,
        weekday: vnDays[i] ?? `D${i + 1}`,
        total: cells.length,
        cells
      });
    }
  }

  private getYesterdayOverdueCount(today: Date): number {
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    return this.workOrders.filter(wo => {
      if (!wo.deliveryDate) return false;

      let deliveryDate: Date;
      if (wo.deliveryDate instanceof Date) {
        deliveryDate = wo.deliveryDate;
      } else if (typeof wo.deliveryDate === 'object' && wo.deliveryDate !== null && 'toDate' in wo.deliveryDate) {
        deliveryDate = (wo.deliveryDate as any).toDate();
      } else {
        deliveryDate = new Date(wo.deliveryDate as any);
      }

      const isYesterday = deliveryDate.toDateString() === yesterday.toDateString();
      const isDone = wo.status === WorkOrderStatus.DONE || !!wo.isCompleted;
      return isYesterday && !isDone;
    }).length;
  }

  /** Ngày tham chiếu tháng: ưu tiên ngày ship thực tế, không có thì ngày yêu cầu. */
  private getShipmentMonthReferenceDate(s: any): Date | null {
    if (s.actualShipDate) {
      const d = s.actualShipDate instanceof Date ? s.actualShipDate : new Date(s.actualShipDate);
      return isNaN(d.getTime()) ? null : d;
    }
    if (s.requestDate) {
      const d = s.requestDate instanceof Date ? s.requestDate : new Date(s.requestDate);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  /** Chỉ tính shipment thuộc tháng hiện tại (theo actualShipDate hoặc requestDate). */
  private isShipmentInCurrentMonth(s: any): boolean {
    const d = this.getShipmentMonthReferenceDate(s);
    if (!d) return false;
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }

  /**
   * Ngày tham chiếu cho bảng chi tiết Shipment: Dispatch → Request → Import
   * (cùng thứ tự ưu tiên với tab Shipment).
   */
  private getShipmentDashboardWeekReferenceDate(s: any): Date | null {
    if (s.actualShipDate) return s.actualShipDate as Date;
    if (s.requestDate) return s.requestDate as Date;
    if (s.importDate) return s.importDate as Date;
    return null;
  }

  /** 7 ngày sắp tới: từ 00:00 hôm nay đến hết ngày thứ 7 (gồm hôm nay + 6 ngày sau). */
  private isDateInNextSevenDaysFromToday(d: Date): boolean {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    const t = new Date(d);
    t.setHours(12, 0, 0, 0);
    return t.getTime() >= start.getTime() && t.getTime() <= end.getTime();
  }

  private isShipmentDetailDone(status: string): boolean {
    const s = String(status || '').toLowerCase();
    return s.includes('đã xong') || s.includes('da xong') || s.includes('done') || s.includes('đã ship') || s.includes('da ship');
  }

  private isShipmentDetailWarn(status: string): boolean {
    const s = String(status || '').toLowerCase();
    return s.includes('chưa') || s.includes('cho soan') || s.includes('chờ') || s.includes('delay') || s.includes('warning');
  }

  private shipmentDetailStatusBadge(status: string): 'green' | 'red' | 'amber' {
    const raw = String(status || '').trim();
    if (this.isShipmentDetailDone(raw)) {
      return 'green';
    }
    if (this.isShipmentDetailWarn(raw)) {
      return 'red';
    }
    return 'amber';
  }

  private rebuildShipmentWeeklyDetailRows(allShipments: any[]): void {
    this.shipmentWeeklyDetailRows = [];
    this.shipmentDetailCurrentPage = 1;

    /** Gộp theo shipment + trạng thái: cộng dồn carton; ngày ship = ngày tham chiếu sớm nhất trong nhóm. */
    const agg = new Map<
      string,
      { refEarliest: Date; shipmentCode: string; statusLabel: string; cartonSum: number }
    >();

    for (const s of allShipments) {
      if (s.hidden) {
        continue;
      }
      if (!this.materialMatchesDashboardFactory(s.factory || 'ASM1')) {
        continue;
      }
      const ref = this.getShipmentDashboardWeekReferenceDate(s);
      if (!ref || !this.isDateInNextSevenDaysFromToday(ref)) {
        continue;
      }

      const shipmentCode = (s.shipmentCode || '—').toString().trim().toUpperCase() || '—';
      const statusLabel = String(s.status || '').trim() || '—';
      const key = `${shipmentCode}\u001e${statusLabel}`;

      const cartonNum = Number(s.carton);
      const add =
        Number.isFinite(cartonNum) && cartonNum > 0 ? Math.round(cartonNum) : 0;

      const prev = agg.get(key);
      if (!prev) {
        agg.set(key, {
          refEarliest: new Date(ref.getTime()),
          shipmentCode,
          statusLabel,
          cartonSum: add
        });
      } else {
        prev.cartonSum += add;
        if (ref.getTime() < prev.refEarliest.getTime()) {
          prev.refEarliest = new Date(ref.getTime());
        }
      }
    }

    this.shipmentWeeklyDetailRows = Array.from(agg.values()).map((v) => ({
      shipDateLabel: v.refEarliest.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
      shipmentCode: v.shipmentCode,
      cartonLabel: v.cartonSum > 0 ? String(v.cartonSum) : '—',
      statusLabel: v.statusLabel,
      statusBadge: this.shipmentDetailStatusBadge(v.statusLabel)
    }));

    this.shipmentWeeklyDetailRows.sort((a, b) => {
      if (a.shipDateLabel !== b.shipDateLabel) {
        return a.shipDateLabel.localeCompare(b.shipDateLabel, 'vi');
      }
      const sc = a.shipmentCode.localeCompare(b.shipmentCode, 'vi');
      if (sc !== 0) {
        return sc;
      }
      return a.statusLabel.localeCompare(b.statusLabel, 'vi');
    });

    console.log(`Shipment chi tiết — 7 ngày sắp tới (${this.selectedFactory}): ${this.shipmentWeeklyDetailRows.length} dòng (đã gộp carton theo shipment + trạng thái)`);
  }

  private loadShipmentDataFromGoogleSheets() {
    // Load shipment data from Firebase collection 'shipments'
    console.log(`Loading shipment data from Firebase (tháng hiện tại)`);

    this.firestore.collection('shipments').get().subscribe(snapshot => {
      const allShipments = snapshot.docs.map(doc => {
        const data = doc.data() as any;
        const toD = (v: any): Date | null => {
          if (!v) return null;
          if (typeof v.toDate === 'function') {
            const d = v.toDate();
            return isNaN(d.getTime()) ? null : d;
          }
          if (v?.seconds != null) {
            const d = new Date(v.seconds * 1000);
            return isNaN(d.getTime()) ? null : d;
          }
          if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
          const d = new Date(v);
          return isNaN(d.getTime()) ? null : d;
        };
        return {
          id: doc.id,
          ...data,
          hidden: data.hidden === true,
          factory: data.factory || 'ASM1',
          materialCode: String(data.materialCode || '').trim().toUpperCase(),
          shipmentCode: String(data.shipmentCode || '').trim().toUpperCase(),
          carton: Number(data.carton) || 0,
          importDate: toD(data.importDate),
          requestDate: toD(data.requestDate),
          actualShipDate: toD(data.actualShipDate),
          status: data.status || 'Chờ soạn'
        };
      });

      const monthShipments = allShipments.filter(s => this.isShipmentInCurrentMonth(s));
      console.log(`Shipments: ${monthShipments.length}/${allShipments.length} dòng thuộc tháng hiện tại`);

      // Group by shipmentCode — chỉ trong tháng hiện tại
      const shipmentGroups = new Map<string, any[]>();
      monthShipments.forEach(s => {
        const code = String(s.shipmentCode || '').trim().toUpperCase();
        if (!code) return; // Skip empty shipment codes
        if (!shipmentGroups.has(code)) {
          shipmentGroups.set(code, []);
        }
        shipmentGroups.get(code)!.push(s);
      });
      
      // Count total unique shipments
      const totalShipments = shipmentGroups.size;
      
      // Count completed shipments (all items in shipment have status "Đã Ship")
      let completedShipments = 0;
      shipmentGroups.forEach((items, shipmentCode) => {
        const allShipped = items.every(item => item.status === 'Đã Ship');
        if (allShipped) {
          completedShipments++;
        }
      });
      
      this.shipment = `${completedShipments}/${totalShipments}`;
      console.log(`Shipment (tháng hiện tại): ${this.shipment} (Đã Ship / Tổng số shipment)`);
      console.log(`Breakdown: ${completedShipments} shipment hoàn tất / ${totalShipments} shipment trong tháng`);

      this.rebuildShipmentWeeklyDetailRows(allShipments);
      this.cdr.detectChanges();
    }, error => {
      console.error('Error loading shipment data from Firebase:', error);
      this.shipment = "0/0";
      this.shipmentWeeklyDetailRows = [];
      this.shipmentDetailCurrentPage = 1;
      this.cdr.detectChanges();
    });

    this.loadFgInPendingWeeklyHeatmap();
  }

  /** FG Inbound: cùng filter factory với WO (ASM1 + Sample 1 / ASM2 + Sample 2). */
  private materialMatchesDashboardFactory(factory: string): boolean {
    const factoryFilter = this.selectedFactory === 'ASM1' ? ['ASM1', 'Sample 1'] : ['ASM2', 'Sample 2'];
    const f = (factory || 'ASM1').toString().trim().toLowerCase().replace(/\s+/g, ' ');
    const targets = factoryFilter.map((x) => (x || '').toString().trim().toLowerCase().replace(/\s+/g, ' '));
    return targets.includes(f);
  }

  private parseFgInImportDate(data: any): Date | null {
    const v = data?.importDate;
    if (!v) return null;
    if (typeof v.toDate === 'function') {
      const d = v.toDate();
      return isNaN(d.getTime()) ? null : d;
    }
    if (v?.seconds != null) {
      const d = new Date(v.seconds * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
    if (v instanceof Date) {
      return isNaN(v.getTime()) ? null : v;
    }
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  private isFgTemporaryLocation(location: string): boolean {
    const s = String(location ?? '').trim();
    if (!s) return true;
    return s.toUpperCase() === 'TEMPORARY';
  }

  /** Chờ nhập kho: chưa khóa, hoặc đã khóa nhưng chưa có vị trí thật (Temporary / rỗng). */
  private isFgInPendingWarehouseRow(data: { isReceived?: boolean; location?: string }): boolean {
    if (!data.isReceived) return true;
    return !!(data.isReceived && this.isFgTemporaryLocation(String(data.location ?? '')));
  }

  private fgInRowKind(data: { isReceived?: boolean; location?: string }): FgInHeatKind {
    if (!data.isReceived) return 'chua-khoa';
    return 'cho-vi-tri';
  }

  private loadFgInPendingWeeklyHeatmap(): void {
    this.firestore
      .collection('fg-in')
      .get()
      .subscribe(
        (snapshot) => {
          const rows = snapshot.docs.map((doc) => {
            const data = doc.data() as any;
            const importDate = this.parseFgInImportDate(data);
            const factory = data.factory || 'ASM1';
            const materialCode = String(data.materialCode || data.maTP || '').trim().toUpperCase();
            const isReceived = !!data.isReceived;
            const location = data.location || data.viTri || '';
            return {
              id: doc.id,
              factory,
              materialCode,
              importDate,
              isReceived,
              location
            };
          });

          const today = new Date();
          const monday = this.getMondayOfWeekContaining(today);
          const vnDays = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

          this.fgInHeatmapDays = [];

          for (let i = 0; i < 6; i++) {
            const targetDate = new Date(monday);
            targetDate.setDate(monday.getDate() + i);
            const label = targetDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });

            const pendingForDay = rows.filter((r) => {
              if (!r.importDate) return false;
              if (!this.materialMatchesDashboardFactory(r.factory)) return false;
              if (!this.isFgInPendingWarehouseRow(r)) return false;
              return r.importDate.toDateString() === targetDate.toDateString();
            });

            const skuMap = new Map<string, FgInHeatKind>();
            for (const r of pendingForDay) {
              if (!r.materialCode) continue;
              const kind = this.fgInRowKind(r);
              const prev = skuMap.get(r.materialCode);
              if (!prev || kind === 'chua-khoa') {
                skuMap.set(r.materialCode, kind);
              }
            }

            const cells: { kind: FgInHeatKind; tooltip: string }[] = [];
            skuMap.forEach((kind, code) => {
              const title =
                kind === 'chua-khoa'
                  ? `${code}: Waiting`
                  : `${code}: Done`;
              cells.push({ kind, tooltip: title });
            });

            this.fgInHeatmapDays.push({
              label,
              weekday: vnDays[i] ?? `D${i + 1}`,
              total: skuMap.size,
              cells
            });
          }

          console.log(
            `FG Inbound pending (heatmap T2–T7, ${this.selectedFactory}):`,
            this.fgInHeatmapDays.map((d) => ({ day: d.weekday, n: d.total }))
          );
          this.cdr.detectChanges();
        },
        (err) => {
          console.error('Error loading fg-in for dashboard:', err);
          this.fgInHeatmapDays = [];
          this.cdr.detectChanges();
        }
      );
  }

  private createCharts() {
    this.matAccuracyThisMonth = 99.85;
    this.fgAccuracyThisMonth = 100;

    this.createAccuracyDonutChart('dailySalesChart', 'Materials Accuracy (%)', this.matAccuracyThisMonth, '#22c55e');
    this.createAccuracyDonutChart('websiteViewsChart', 'Finished Goods Accuracy (%)', this.fgAccuracyThisMonth, '#3b82f6');

    this.createFgTurnoverMonthlyBarChart('completedTasksChart');
  }

  /** Cột 12 tháng + đường target; số vẽ trong cột; tháng chưa có dữ liệu: null (chỉ nhãn trục X) */
  private createFgTurnoverMonthlyBarChart(canvasId: string): void {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (this.fgTurnoverChart) {
      try {
        this.fgTurnoverChart.destroy();
      } catch {}
      this.fgTurnoverChart = null;
    }

    const labels = [...this.fgTurnoverMonthLabels];
    const bars = [...this.fgTurnoverMonthValues];
    const tgt = this.fgTurnoverTargetMonthly;
    const targetLine = labels.map(() => tgt);
    const numericBars = bars.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const yTop = Math.max(tgt, ...numericBars, 0.01) * 1.15;

    const barBlue = '#2563eb';
    const targetColor = '#ef4444';

    this.fgTurnoverChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            type: 'bar' as const,
            label: 'Turnover tháng',
            data: bars,
            backgroundColor: barBlue,
            borderRadius: 6,
            borderSkipped: false,
            order: 2
          },
          {
            type: 'line' as const,
            label: `Target tháng (${tgt})`,
            data: targetLine,
            borderColor: targetColor,
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [7, 5],
            pointRadius: 0,
            pointHoverRadius: 0,
            fill: false,
            tension: 0,
            order: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 4, right: 4, bottom: 0, left: 2 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              boxWidth: 10,
              boxHeight: 10,
              usePointStyle: true,
              font: { size: 11, weight: 'bold' as const, family: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif" }
            }
          },
          tooltip: {
            filter: (item) => {
              if (item.datasetIndex !== 0) return true;
              const raw = item.raw;
              return typeof raw === 'number' && Number.isFinite(raw);
            },
            callbacks: {
              label: (context) => {
                const v = context.parsed.y;
                if (v === undefined || v === null || Number.isNaN(Number(v))) return '';
                return `${context.dataset.label}: ${Number(v).toFixed(2)}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: 'rgba(15,23,42,0.55)',
              maxRotation: 45,
              minRotation: 0,
              font: { size: 9, family: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif" }
            },
            border: { display: false }
          },
          y: {
            beginAtZero: true,
            suggestedMax: yTop,
            grid: { color: 'rgba(15,23,42,0.06)' },
            ticks: {
              color: 'rgba(15,23,42,0.45)',
              font: { size: 10, family: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif" }
            },
            border: { display: false }
          }
        }
      },
      plugins: [
        {
          id: 'fgTurnoverBarValueLabels',
          afterDatasetsDraw: (chart) => {
            const ds = chart.data.datasets[0];
            const meta = chart.getDatasetMeta(0);
            if (!ds || meta.type !== 'bar' || !meta.data?.length) return;
            const c = chart.ctx;
            c.save();
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.font =
              "bold 10px Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";
            meta.data.forEach((elem, i) => {
              const raw = ds.data[i];
              if (typeof raw !== 'number' || !Number.isFinite(raw)) return;
              const el = elem as unknown as { getProps?: (keys: string[], final?: boolean) => Record<string, number> };
              if (typeof el.getProps !== 'function') return;
              const p = el.getProps(['x', 'y', 'base'], true);
              const x = p.x;
              const y = p.y;
              const base = p.base;
              if (![x, y, base].every((n) => typeof n === 'number' && Number.isFinite(n))) return;
              const midY = (y + base) / 2;
              c.fillStyle = '#ffffff';
              c.fillText(raw.toFixed(2), x, midY);
            });
            c.restore();
          }
        }
      ]
    });
  }

  private parseCellNumber(v: any): number {
    const s = String(v ?? '').trim();
    if (!s || s === '—' || s === '-') return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  goShipment(): void {
    this.router.navigate(['/shipment']);
  }

  goHome(): void {
    this.router.navigate(['/dashboard']);
  }

  goMenu(): void {
    this.router.navigate(['/menu']);
  }

  // Method to handle factory selection changes
  onFactoryChange(factory: string) {
    this.selectedFactory = factory;
    this.woHeatmapWeekOffset = 0;
    this.loadDashboardData();
    this.loadIQCByWeek();
  }

  // Safety Stock Level methods - Copied from Chart tab
  private initializeCurrentWeek() {
    const today = new Date();
    const currentDay = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    
    // Calculate Monday of current week
    const monday = new Date(today);
    const daysToMonday = currentDay === 0 ? 6 : currentDay - 1; // If Sunday, go back 6 days
    monday.setDate(today.getDate() - daysToMonday);
    
    // Generate dates for Monday to Saturday (6 days)
    this.currentWeekDates = [];
    for (let i = 0; i < 6; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      this.currentWeekDates.push(date);
    }
    
    // Update weekdays with dates
    this.weekdays.forEach((weekday, index) => {
      weekday.date = this.currentWeekDates[index];
    });
    
  }

  private loadSafetyData() {
    this.safetyService.getSafetyMaterials().subscribe(materials => {
      if (materials.length > 0) {
        // Get all scan dates from materials - ONLY from scanDate column
        const scanDates = new Set<string>();
        
        materials.forEach(material => {
          // Only check scanDate, not updatedAt
          if (material.scanDate && material.scanDate > new Date(0)) {
            const scanDateStr = material.scanDate.toDateString();
            scanDates.add(scanDateStr);
          }
        });
        
        // Find the latest scan date
        const allScanDates = Array.from(scanDates).map(dateStr => new Date(dateStr));
        if (allScanDates.length > 0) {
          this.latestUpdateDate = allScanDates.reduce((latest, date) => 
            date > latest ? date : latest
          );
        } else {
          this.latestUpdateDate = null;
        }
        
        // Store all scan dates for checking individual days
        this.allScanDates = allScanDates;
        
        this.updateWeekdayColors();
      } else {
        this.latestUpdateDate = null;
        this.allScanDates = [];
        this.updateWeekdayColors();
      }
    });
  }

  private updateWeekdayColors() {
    const today = new Date();
    const currentDay = today.getDay();
    
    this.weekdays.forEach((weekday, index) => {
      if (!weekday.date) return;
      
      const weekdayDate = weekday.date;
      const isInventoryDay = index === 1 || index === 5; // Tuesday (index 1) and Saturday (index 5)
      
      // Reset flags and status
      weekday.hasFlag = false;
      weekday.status = 'unknown';
      
      // Check if this day has scan data from Safety tab
      const hasScanData = this.allScanDates.some(scanDate => this.isSameDate(weekdayDate, scanDate));
      
      // Check if this day is past due (yesterday or earlier)
      const isPastDue = weekdayDate < today && !this.isSameDate(weekdayDate, today);
      
      // Apply new logic based on requirements
      if (isInventoryDay) {
        // Thứ 3 (index 1) and Thứ 7 (index 5) - Inventory days
        if (hasScanData) {
          weekday.status = 'scan-day'; // Blue when scanned on correct date
        } else if (isPastDue) {
          weekday.status = 'late'; // Red when past due without scan
        } else {
          weekday.status = 'inventory'; // Orange by default
        }
      } else {
        // Thứ 2, 4, 5, 6 - Regular days
        if (hasScanData) {
          weekday.status = 'scan-day'; // Blue when scanned on correct date
        } else {
          weekday.status = 'regular'; // White by default (no change for no scan)
        }
      }
      
      // Add today class
      if (this.isSameDate(weekdayDate, today)) {
        weekday.isToday = true;
      }
    });
  }

  private isSameDate(date1: Date, date2: Date): boolean {
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
  }

  getWeekdayClass(weekday: any): string {
    let classes = `weekday-item ${weekday.status}`;
    if (weekday.isToday) {
      classes += ' today';
    }
    return classes;
  }

  getWeekdayNumber(index: number): string {
    const numbers = ['2', '3', '4', '5', '6', '7', 'CN'];
    return numbers[index];
  }

  formatDate(date: Date): string {
    return date.toLocaleDateString('vi-VN', { 
      day: '2-digit', 
      month: '2-digit' 
    });
  }

  getWeekdayName(date: Date): string {
    const days = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
    const dayIndex = date.getDay();
    return days[dayIndex - 1] || days[0];
  }

  getDayOfMonth(date: Date): string {
    return date.getDate().toString();
  }

  getMonth(date: Date): string {
    return (date.getMonth() + 1).toString().padStart(2, '0');
  }

  refreshData() {
    this.initializeCurrentWeek();
    this.loadSafetyData();
    this.loadRackWarnings();
  }
  
  // Load Rack Utilization Warnings
  async loadRackWarnings() {
    this.rackWarningsLoading = true;
    
    try {
      // Load inventory materials for ASM1
      const inventorySnapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', 'ASM1')
      ).get().toPromise();
      
      const materials = inventorySnapshot.docs.map(doc => doc.data() as any);

      // Load catalog for unit weights
      const catalogSnapshot = await this.firestore.collection('materials').get().toPromise();
      const catalogCache = new Map<string, any>();
      
      catalogSnapshot.docs.forEach(doc => {
        const item = doc.data();
        if (item['materialCode']) {
          const code = item['materialCode'].toString().trim().toUpperCase();
          catalogCache.set(code, {
            unitWeight: item['unitWeight'] || item['unit_weight'] || 0
          });
        }
      });
      
      // Calculate rack loading
      const positionMap = new Map<string, { totalWeightKg: number, itemCount: number }>();
      
      materials.forEach(material => {
        const location = material.location || '';
        const position = this.normalizePosition(location);
        
        if (!position) return;
        
        // Calculate stock: openingStock + quantity - exported - xt
        const openingStock = material.openingStock !== null && material.openingStock !== undefined 
          ? material.openingStock 
          : 0;
        const stockQty = openingStock + (material.quantity || 0) - (material.exported || 0) - (material.xt || 0);
        
        if (stockQty <= 0) return;
        
        const materialCode = material.materialCode?.toString().trim().toUpperCase();
        const catalogItem = catalogCache.get(materialCode);
        const unitWeightGram = catalogItem?.unitWeight || 0;
        
        if (unitWeightGram <= 0) return;
        
        const weightKg = (stockQty * unitWeightGram) / 1000;
        
        if (!positionMap.has(position)) {
          positionMap.set(position, { totalWeightKg: 0, itemCount: 0 });
        }
        
        const posData = positionMap.get(position)!;
        posData.totalWeightKg += weightKg;
        posData.itemCount++;
      });
      
      // Find positions with warnings (>= 80%)
      const warnings: typeof this.rackWarnings = [];
      
      positionMap.forEach((data, position) => {
        // Max capacity logic from utilization tab:
        // Positions ending with '1' have 5000kg, others have 1300kg
        const maxCapacity = position.endsWith('1') ? 5000 : 1300;
        const usage = (data.totalWeightKg / maxCapacity) * 100;
        
        if (usage >= 80) {
          warnings.push({
            position: position,
            usage: usage,
            currentLoad: data.totalWeightKg,
            maxCapacity: maxCapacity,
            status: usage >= 95 ? 'critical' : 'warning'
          });
        }
      });
      
      // Sort by usage descending
      warnings.sort((a, b) => b.usage - a.usage);
      
      this.rackWarnings = warnings;
      
      // Count critical and warning
      this.criticalCount = warnings.filter(w => w.status === 'critical').length;
      this.warningCount = warnings.filter(w => w.status === 'warning').length;
      
      console.log('📊 Rack warnings loaded:', warnings.length, `(${this.criticalCount} critical, ${this.warningCount} warning)`);
      
    } catch (error) {
      console.error('❌ Error loading rack warnings:', error);
    } finally {
      this.rackWarningsLoading = false;
      this.cdr.detectChanges();
    }
  }
  
  private normalizePosition(location: string): string {
    if (!location) return '';
    
    const cleaned = location.replace(/[.,]/g, '').substring(0, 3).toUpperCase();
    const validPattern = /^[A-G]\d{2}$/;
    
    if (!validPattern.test(cleaned)) {
      return '';
    }
    
    return cleaned;
  }
  
  getWarningStatusClass(status: 'warning' | 'critical'): string {
    return status === 'critical' ? 'status-critical' : 'status-warning';
  }

  /** Vị trí bắt đầu bằng IQC (sau trim, không phân biệt hoa thường). */
  private isIqcStagingLocation(locationRaw: string): boolean {
    return (locationRaw || '').trim().toUpperCase().startsWith('IQC');
  }

  /** Vị trí hàng trả TRA (sau trim, không phân biệt hoa thường). */
  private isTraStagingLocation(locationRaw: string): boolean {
    const loc = (locationRaw || '').trim().toUpperCase();
    return loc === 'TRA' || loc.startsWith('TRA+') || loc.startsWith('TRA-');
  }

  /** Pass / NG / Chờ kiểm (và biến thể trong DB). */
  private normalizePutawayIqcStatus(raw: string): PutawayIqcStatusKind | null {
    const s = (raw || '').trim();
    if (!s) return null;
    const u = s.toUpperCase();
    if (u === 'PASS') return 'pass';
    if (u === 'NG') return 'ng';
    if (u.includes('LOCK') || u.includes('KHÓA') || u.includes('KHOA')) return 'lock';
    if (u === 'HOLD' || u.includes('ĐẶC CÁCH') || u.includes('DAC CACH')) return 'confirm';
    if (u.includes('CHỜ XÁC NHẬN') || u.includes('CHO XAC NHAN')) return 'confirm';
    if (u.includes('CHỜ KIỂM') || u.includes('CHỜ KIỂM TRA') || u.includes('CHO KIEM')) return 'pending';
    const compact = u.replace(/\s+/g, '');
    if (compact.includes('CHỜXÁCNHẬN') || compact.includes('CHOXACNHAN')) return 'confirm';
    if (compact.includes('CHỜKIỂM') || compact.includes('CHỜKIỂMTRA') || compact.includes('CHOKIEM')) return 'pending';
    return null;
  }

  private mergePutawayStatusKind(a: PutawayIqcStatusKind, b: PutawayIqcStatusKind): PutawayIqcStatusKind {
    const rank: Record<PutawayIqcStatusKind, number> = { lock: 5, ng: 4, confirm: 3, pending: 2, pass: 1 };
    return rank[a] >= rank[b] ? a : b;
  }

  private putawayStatusShortLabel(kind: PutawayIqcStatusKind): string {
    if (kind === 'pass') return 'Pass';
    if (kind === 'ng') return 'NG';
    if (kind === 'confirm') return 'Chờ xác nhận';
    if (kind === 'lock') return 'Lock';
    return 'Chờ kiểm';
  }

  /**
   * Lấy document inventory-materials để xử lý Putaway: **sau đó** lọc client theo vị trí bắt đầu bằng IQC.
   * Firestore range [IQC,IQD) bỏ sót location viết thường (`iqc-…`) hoặc có khoảng trắng đầu chuỗi trong DB — nên gộp thêm [iqc,iqd).
   * Nếu cả hai range trả về 0 dòng (hoặc lỗi index), fallback một query theo factory + limit và vẫn lọc bằng `isIqcStagingLocation`.
   */
  /** 8 tuần ISO + cột Late (đầu tiên). */
  private buildPutawayWeekBuckets(referenceDate: Date): Array<{ week: string; weekNum: number; startDate: Date; endDate: Date }> {
    const currentYear = referenceDate.getFullYear();
    const currentWeek = this.getISOWeek(referenceDate);
    const isoWeeks: Array<{ week: string; weekNum: number; startDate: Date; endDate: Date }> = [];
    for (let i = 7; i >= 0; i--) {
      let weekNum = currentWeek - i;
      let year = currentYear;
      if (weekNum <= 0) {
        year--;
        const lastWeekOfYear = this.getISOWeek(new Date(year, 11, 31));
        weekNum = lastWeekOfYear + weekNum;
      }
      const weekDate = this.getDateFromISOWeek(year, weekNum);
      const startDate = this.getStartOfWeek(weekDate);
      const endDate = this.getEndOfWeek(weekDate);
      isoWeeks.push({
        week: `W${weekNum}`,
        weekNum,
        startDate,
        endDate
      });
    }
    return [
      {
        week: this.putawayLateWeekLabel,
        weekNum: -1,
        startDate: new Date(0),
        endDate: new Date(0)
      },
      ...isoWeeks
    ];
  }

  private async fetchPutawayStagingInventoryDocs(factory: string): Promise<any[]> {
    const mergeSnapshotsByDocId = (snaps: any[]): any[] => {
      const byId = new Map<string, any>();
      for (const snap of snaps) {
        if (!snap || snap.empty) {
          continue;
        }
        snap.docs.forEach((d: any) => byId.set(d.id, d));
      }
      return Array.from(byId.values());
    };

    const rangePromises = [
      this.firestore
        .collection('inventory-materials', (ref) =>
          ref.where('factory', '==', factory).where('location', '>=', 'IQC').where('location', '<', 'IQD')
        )
        .get()
        .toPromise(),
      this.firestore
        .collection('inventory-materials', (ref) =>
          ref.where('factory', '==', factory).where('location', '>=', 'iqc').where('location', '<', 'iqd')
        )
        .get()
        .toPromise()
    ];

    let merged: any[] = [];
    try {
      const settled = await Promise.allSettled(rangePromises);
      const snaps = settled
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && !!r.value)
        .map((r) => r.value);
      merged = mergeSnapshotsByDocId(snaps);
    } catch (e) {
      console.warn('Putaway: không gộp được truy vấn range IQC', e);
    }

    if (merged.length > 0) {
      return merged;
    }

    try {
      const fb = await this.firestore
        .collection('inventory-materials', (ref) => ref.where('factory', '==', factory).limit(8000))
        .get()
        .toPromise();
      return fb?.docs?.length ? fb.docs : [];
    } catch (e2) {
      console.error('Putaway: fallback query theo factory thất bại', e2);
      return [];
    }
  }

  private async fetchPutawayTraInventoryDocs(factory: string): Promise<any[]> {
    try {
      const snap = await this.firestore
        .collection('inventory-materials', (ref) =>
          ref.where('factory', '==', factory).where('location', '==', 'TRA')
        )
        .get()
        .toPromise();
      return snap?.docs?.length ? snap.docs : [];
    } catch (e) {
      console.warn('Putaway: không tải được hàng vị trí TRA', e);
      try {
        const fb = await this.firestore
          .collection('inventory-materials', (ref) => ref.where('factory', '==', factory).limit(8000))
          .get()
          .toPromise();
        return (fb?.docs || []).filter((d: any) => this.isTraStagingLocation((d.data() as any).location || ''));
      } catch (e2) {
        console.error('Putaway: fallback query TRA thất bại', e2);
        return [];
      }
    }
  }

  // Load IQC Materials by Week (8 weeks)
  async loadIQCByWeek() {
    this.iqcLoading = true;
    try {
      const now = new Date();
      const weeks = this.buildPutawayWeekBuckets(now);

      const factory = this.selectedFactory || 'ASM1';
      const [docs, traDocs] = await Promise.all([
        this.fetchPutawayStagingInventoryDocs(factory),
        this.fetchPutawayTraInventoryDocs(factory)
      ]);

      if (!docs.length) {
        this.iqcWeekData = [];
        this.iqcHeatmapWeeks = [];
        this.putawayDayGrid = this.buildPutawayDayGrid([], traDocs);
        this.cdr.detectChanges();
        return;
      }

      const weekCells = new Map<string, Map<string, PutawaySkuAgg>>();
      weeks.forEach((w) => weekCells.set(w.week, new Map()));

      docs.forEach((doc: any) => {
        const data = doc.data() as any;
        const locRaw = (data.location || '').trim();
        if (!this.isIqcStagingLocation(locRaw)) {
          return;
        }

        // Calculate stock: openingStock + quantity - exported - xt (giống Manage tab)
        const openingStock = data.openingStock !== null && data.openingStock !== undefined ? Number(data.openingStock) : 0;
        const quantity = Number(data.quantity) || 0;
        const exported = Number(data.exported) || 0;
        const xt = Number(data.xt) || 0;
        const stock = openingStock + quantity - exported - xt;
        
        // Only count materials with stock > 0 (giống Manage tab)
        if (stock <= 0) {
          return;
        }

        const iqcStatusRaw = (data.iqcStatus || '').trim();
        const statusKind = this.normalizePutawayIqcStatus(iqcStatusRaw);
        if (!statusKind) {
          return;
        }

        // Get date for week calculation - use lastActionDate (giống Manage tab: lastActionDate)
        // Priority: importDate > lastUpdated > createdAt
        let materialDate: Date | null = null;
        
        // Priority 1: importDate (giống Manage tab dùng importDate cho lastActionDate)
        if (data.importDate) {
          if (data.importDate.toDate && typeof data.importDate.toDate === 'function') {
            materialDate = data.importDate.toDate();
          } else if (data.importDate instanceof Date) {
            materialDate = data.importDate;
          } else if (data.importDate.seconds) {
            materialDate = new Date(data.importDate.seconds * 1000);
          } else {
            materialDate = new Date(data.importDate);
          }
        }
        
        // Priority 2: lastUpdated (nếu không có importDate)
        if (!materialDate && data.lastUpdated) {
          if (data.lastUpdated.toDate && typeof data.lastUpdated.toDate === 'function') {
            materialDate = data.lastUpdated.toDate();
          } else if (data.lastUpdated instanceof Date) {
            materialDate = data.lastUpdated;
          } else if (data.lastUpdated.seconds) {
            materialDate = new Date(data.lastUpdated.seconds * 1000);
          } else {
            materialDate = new Date(data.lastUpdated);
          }
        }
        
        // Priority 3: createdAt (nếu không có importDate và lastUpdated)
        if (!materialDate && data.createdAt) {
          if (data.createdAt.toDate && typeof data.createdAt.toDate === 'function') {
            materialDate = data.createdAt.toDate();
          } else if (data.createdAt instanceof Date) {
            materialDate = data.createdAt;
          } else if (data.createdAt.seconds) {
            materialDate = new Date(data.createdAt.seconds * 1000);
          } else {
            materialDate = new Date(data.createdAt);
          }
        }
        
        const upsertToWeek = (weekKey: string) => {
          const materialCode = (data.materialCode || '').toUpperCase().trim();
          const poNumber = (data.poNumber || '').trim();
          const batchNumber = (data.batchNumber || '').trim();
          const imd = this.getIMDFromDate(materialDate || new Date(), batchNumber);
          const uniqueKey = `${materialCode}_${poNumber}_${imd}`;
          const wm = weekCells.get(weekKey);
          if (!wm) return;
          const prev = wm.get(uniqueKey);
          if (prev) {
            prev.stock += stock;
            prev.statusKind = this.mergePutawayStatusKind(prev.statusKind, statusKind);
          } else {
            wm.set(uniqueKey, { materialCode, poNumber, imd, stock, statusKind });
          }
        };

        // Nếu không có date => gom vào Late
        if (!materialDate) {
          upsertToWeek(this.putawayLateWeekLabel);
          return;
        }

        // Find which week this material belongs to (8 tuần); nếu không match => Late
        let placed = false;
        for (const week of weeks) {
          if (week.week === this.putawayLateWeekLabel) continue;
          if (materialDate >= week.startDate && materialDate <= week.endDate) {
            // Create unique key: materialCode_PO_IMD (giống Manage tab)
            upsertToWeek(week.week);
            placed = true;
            break;
          }
        }
        if (!placed) {
          upsertToWeek(this.putawayLateWeekLabel);
        }
      });

      this.finalizeIqcHeatmapFromWeekMaps(weeks, weekCells);
      this.putawayDayGrid = this.buildPutawayDayGrid(docs, traDocs);
      console.log('📊 IQC Week Data:', this.iqcWeekData);
      this.cdr.detectChanges();
    } catch (error) {
      console.error('❌ Error loading IQC by week:', error);
      this.iqcWeekData = [];
      this.iqcHeatmapWeeks = [];
    } finally {
      this.iqcLoading = false;
    }
  }

  private finalizeIqcHeatmapFromWeekMaps(
    weeks: Array<{ week: string; weekNum: number; startDate: Date; endDate: Date }>,
    weekCells: Map<string, Map<string, PutawaySkuAgg>>
  ): void {
    const cols = weeks.map((w) => {
      const m = weekCells.get(w.week);
      const arr = m ? Array.from(m.values()).sort((a, b) => b.stock - a.stock) : [];
      const cells: IqcHeatmapCell[] = arr.map((v) => {
        const tooltip = `${v.materialCode} · PO ${v.poNumber || '—'} · IMD ${v.imd} · ${this.putawayStatusShortLabel(v.statusKind)} · Tồn: ${v.stock.toFixed(2)}`;
        return {
          materialCode: v.materialCode,
          poNumber: v.poNumber,
          imd: v.imd,
          stock: v.stock,
          statusKind: v.statusKind,
          tooltip
        };
      });
      return { week: w.week, count: cells.length, cells };
    });
    const visible = cols.filter((c) => c.count > 0);
    this.iqcHeatmapWeeks = visible;
    this.iqcWeekData = visible.map((c) => ({ week: c.week, count: c.count }));
  }

  /** Xây grid Day 1 – Day >11 từ cùng docs đã load */
  /**
   * Đếm số ngày từ 'from' đến 'to', bỏ qua Chủ Nhật (getDay() === 0).
   * from/to phải được normalize về 00:00:00.
   */
  private countDaysNoSunday(from: Date, to: Date): number {
    if (to <= from) return 0;
    let count = 0;
    const cursor = new Date(from);
    while (cursor < to) {
      cursor.setDate(cursor.getDate() + 1);
      if (cursor.getDay() !== 0) count++;
    }
    return count;
  }

  private buildPutawayDayGrid(docs: any[], traDocs: any[] = []): PutawayDayCol[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const COLS = 12;

    const cols: PutawayDayCol[] = Array.from({ length: COLS }, (_, i) => ({
      dayLabel: i < 11 ? `Day ${i + 1}` : '>11',
      colIdx: i,
      counts: { pass: 0, ng: 0, pending: 0, confirm: 0, tra: 0 },
      total: 0
    }));

    // Track unique materialCode per (colIdx, status) to avoid double-counting
    const seen = new Set<string>();
    const seenTra = new Set<string>();

    docs.forEach((doc: any) => {
      const data = doc.data ? doc.data() : doc;
      const locRaw = (data.location || '').trim();
      if (!this.isIqcStagingLocation(locRaw)) return;

      // Ẩn mã có tồn kho <= 0
      const openingStock =
        data.openingStock !== null && data.openingStock !== undefined ? Number(data.openingStock) : 0;
      const quantity = Number(data.quantity) || 0;
      const exported = Number(data.exported) || 0;
      const xt = Number(data.xt) || 0;
      const stock = openingStock + quantity - exported - xt;
      if (stock <= 0) return;

      const statusKind = this.normalizePutawayIqcStatus((data.iqcStatus || '').trim());
      if (!statusKind) return;

      const materialCode = (data.materialCode || '').toUpperCase().trim();
      if (!materialCode) return;

      const matDate = this.parsePutawayInventoryDate(data);
      if (!matDate) return;

      const d0 = new Date(matDate); d0.setHours(0, 0, 0, 0);
      const daysDiff = this.countDaysNoSunday(d0, today);
      const colIdx = Math.min(daysDiff, 11);

      // map lock → ng
      const mapped: 'pass' | 'ng' | 'pending' | 'confirm' =
        statusKind === 'lock' ? 'ng' : statusKind;

      const key = `${colIdx}|${materialCode}|${mapped}`;
      if (seen.has(key)) return;
      seen.add(key);

      cols[colIdx].counts[mapped]++;
      cols[colIdx].total++;
    });

    traDocs.forEach((doc: any) => {
      const data = doc.data ? doc.data() : doc;
      const locRaw = (data.location || '').trim();
      if (!this.isTraStagingLocation(locRaw)) return;

      const openingStock =
        data.openingStock !== null && data.openingStock !== undefined ? Number(data.openingStock) : 0;
      const quantity = Number(data.quantity) || 0;
      const exported = Number(data.exported) || 0;
      const xt = Number(data.xt) || 0;
      const stock = openingStock + quantity - exported - xt;
      if (stock <= 0) return;

      const materialCode = (data.materialCode || '').toUpperCase().trim();
      if (!materialCode) return;

      const matDate = this.parsePutawayInventoryDate(data);
      if (!matDate) return;

      const d0 = new Date(matDate);
      d0.setHours(0, 0, 0, 0);
      const daysDiff = this.countDaysNoSunday(d0, today);
      const colIdx = Math.min(daysDiff, 11);

      const key = `${colIdx}|${materialCode}`;
      if (seenTra.has(key)) return;
      seenTra.add(key);

      cols[colIdx].counts.tra++;
    });

    return cols;
  }

  /** Số cột lưới (18 hàng/cột) cho một tuần Putaway. */
  putawayGridColumnCount(cellCount: number): number {
    if (cellCount <= 0) return 0;
    return Math.ceil(cellCount / this.putawayMaxRowsPerColumn);
  }

  // Helper: Get ISO week number
  private getISOWeek(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  // Helper: Get date from ISO week
  private getDateFromISOWeek(year: number, week: number): Date {
    const simple = new Date(year, 0, 1 + (week - 1) * 7);
    const dow = simple.getDay();
    const ISOweekStart = simple;
    if (dow <= 4) {
      ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
    } else {
      ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
    }
    return ISOweekStart;
  }

  // Helper: Get start of week (Monday)
  private getStartOfWeek(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    return new Date(d.setDate(diff));
  }

  // Helper: Get end of week (Sunday)
  private getEndOfWeek(date: Date): Date {
    const start = this.getStartOfWeek(date);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return end;
  }

  // Helper: Get IMD from date and batch number
  private getIMDFromDate(date: Date, batchNumber: string): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear());
    return `${day}${month}${year}`;
  }

  // Open IQC Materials Modal
  openIQCMaterialsModal(): void {
    this.showIQCMaterialsModal = true;
    this.loadIQCMaterialsByWeek();
  }

  // Close IQC Materials Modal
  closeIQCMaterialsModal(): void {
    this.showIQCMaterialsModal = false;
    this.iqcMaterialsBySku = [];
    this.putawayTraMaterialsBySku = [];
    this.putawayFilterMode = 'all';
    this.putawaySortByDay = 'none';
  }

  private parsePutawayInventoryDate(data: any): Date | null {
    const fields = ['importDate', 'lastUpdated', 'createdAt'];
    for (const key of fields) {
      const raw = data?.[key];
      if (!raw) continue;
      if (raw.toDate && typeof raw.toDate === 'function') {
        return raw.toDate();
      }
      if (raw instanceof Date) {
        return raw;
      }
      if (raw.seconds) {
        return new Date(raw.seconds * 1000);
      }
      const parsed = new Date(raw);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return null;
  }

  /** Gom inventory IQC staging → 1 dòng / mã hàng, đếm SKU con Pass vs chưa Pass. */
  private buildPutawayModalSkuRows(docs: any[]): PutawayModalSkuRow[] {
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const skuLines = new Map<
      string,
      { materialCode: string; statusKind: PutawayIqcStatusKind; stock: number }
    >();
    // earliest importDate per materialCode
    const earliestDate = new Map<string, Date>();

    docs.forEach((doc: any) => {
      const data = doc.data() as any;
      const locRaw = (data.location || '').trim();
      if (!this.isIqcStagingLocation(locRaw)) return;

      const openingStock =
        data.openingStock !== null && data.openingStock !== undefined ? Number(data.openingStock) : 0;
      const quantity = Number(data.quantity) || 0;
      const exported = Number(data.exported) || 0;
      const xt = Number(data.xt) || 0;
      const stock = openingStock + quantity - exported - xt;
      if (stock <= 0) return;

      const statusKind = this.normalizePutawayIqcStatus((data.iqcStatus || '').trim());
      if (!statusKind) return;

      const materialCode = (data.materialCode || '').toUpperCase().trim();
      if (!materialCode) return;

      const poNumber = (data.poNumber || '').trim();
      const batchNumber = (data.batchNumber || '').trim();
      const materialDate = this.parsePutawayInventoryDate(data) || new Date();
      const imd = this.getIMDFromDate(materialDate, batchNumber);
      const lineKey = `${materialCode}|${poNumber}|${imd}`;

      // Track earliest date per materialCode
      const prev = earliestDate.get(materialCode);
      if (!prev || materialDate < prev) earliestDate.set(materialCode, materialDate);

      const existing = skuLines.get(lineKey);
      if (existing) {
        existing.stock += stock;
        existing.statusKind = this.mergePutawayStatusKind(existing.statusKind, statusKind);
      } else {
        skuLines.set(lineKey, { materialCode, statusKind, stock });
      }
    });

    const byCode = new Map<string, { passCount: number; holdCount: number; notPassCount: number; totalStock: number }>();
    skuLines.forEach((line) => {
      const bucket = byCode.get(line.materialCode) || { passCount: 0, holdCount: 0, notPassCount: 0, totalStock: 0 };
      if (line.statusKind === 'pass') bucket.passCount += 1;
      else if (line.statusKind === 'confirm') bucket.holdCount += 1;
      else bucket.notPassCount += 1;
      bucket.totalStock += line.stock;
      byCode.set(line.materialCode, bucket);
    });

    return Array.from(byCode.entries())
      .map(([materialCode, v]) => {
        const d0 = earliestDate.get(materialCode) || today;
        const d0noon = new Date(d0); d0noon.setHours(0, 0, 0, 0);
        const daysDiff = this.countDaysNoSunday(d0noon, today);
        return {
          materialCode,
          passCount: v.passCount,
          holdCount: v.holdCount,
          notPassCount: v.notPassCount,
          totalSkuCount: v.passCount + v.holdCount + v.notPassCount,
          totalStock: v.totalStock,
          dayInIqc: daysDiff + 1,   // Day 1 = nhập hôm nay (không tính Chủ Nhật)
        };
      })
      .sort((a, b) => {
        // Sắp xếp Day từ lớn đến nhỏ
        if (b.dayInIqc !== a.dayInIqc) return b.dayInIqc - a.dayInIqc;
        if (b.notPassCount !== a.notPassCount) return b.notPassCount - a.notPassCount;
        if (b.passCount !== a.passCount) return b.passCount - a.passCount;
        return a.materialCode.localeCompare(b.materialCode);
      });
  }

  /** Gom inventory vị trí TRA → 1 dòng / mã hàng. */
  private buildPutawayTraModalSkuRows(docs: any[]): PutawayModalSkuRow[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const skuLines = new Map<
      string,
      { materialCode: string; statusKind: PutawayIqcStatusKind; stock: number }
    >();
    const earliestDate = new Map<string, Date>();

    docs.forEach((doc: any) => {
      const data = doc.data() as any;
      const locRaw = (data.location || '').trim();
      if (!this.isTraStagingLocation(locRaw)) return;

      const openingStock =
        data.openingStock !== null && data.openingStock !== undefined ? Number(data.openingStock) : 0;
      const quantity = Number(data.quantity) || 0;
      const exported = Number(data.exported) || 0;
      const xt = Number(data.xt) || 0;
      const stock = openingStock + quantity - exported - xt;
      if (stock <= 0) return;

      const statusKind = this.normalizePutawayIqcStatus((data.iqcStatus || '').trim()) || 'pass';

      const materialCode = (data.materialCode || '').toUpperCase().trim();
      if (!materialCode) return;

      const poNumber = (data.poNumber || '').trim();
      const batchNumber = (data.batchNumber || '').trim();
      const materialDate = this.parsePutawayInventoryDate(data) || new Date();
      const imd = this.getIMDFromDate(materialDate, batchNumber);
      const lineKey = `${materialCode}|${poNumber}|${imd}`;

      const prev = earliestDate.get(materialCode);
      if (!prev || materialDate < prev) earliestDate.set(materialCode, materialDate);

      const existing = skuLines.get(lineKey);
      if (existing) {
        existing.stock += stock;
        existing.statusKind = this.mergePutawayStatusKind(existing.statusKind, statusKind);
      } else {
        skuLines.set(lineKey, { materialCode, statusKind, stock });
      }
    });

    const byCode = new Map<string, { passCount: number; holdCount: number; notPassCount: number; totalStock: number }>();
    skuLines.forEach((line) => {
      const bucket = byCode.get(line.materialCode) || { passCount: 0, holdCount: 0, notPassCount: 0, totalStock: 0 };
      if (line.statusKind === 'pass') bucket.passCount += 1;
      else if (line.statusKind === 'confirm') bucket.holdCount += 1;
      else bucket.notPassCount += 1;
      bucket.totalStock += line.stock;
      byCode.set(line.materialCode, bucket);
    });

    return Array.from(byCode.entries())
      .map(([materialCode, v]) => {
        const d0 = earliestDate.get(materialCode) || today;
        const d0noon = new Date(d0);
        d0noon.setHours(0, 0, 0, 0);
        const daysDiff = this.countDaysNoSunday(d0noon, today);
        return {
          materialCode,
          passCount: v.passCount,
          holdCount: v.holdCount,
          notPassCount: v.notPassCount,
          totalSkuCount: v.passCount + v.holdCount + v.notPassCount,
          totalStock: v.totalStock,
          dayInIqc: daysDiff + 1,
        };
      })
      .sort((a, b) => {
        if (b.dayInIqc !== a.dayInIqc) return b.dayInIqc - a.dayInIqc;
        if (b.totalStock !== a.totalStock) return b.totalStock - a.totalStock;
        return a.materialCode.localeCompare(b.materialCode);
      });
  }

  // Load Putaway popup: 1 mã hàng = 1 SKU, xếp theo Pass / Chưa Pass
  async loadIQCMaterialsByWeek(): Promise<void> {
    this.iqcMaterialsLoading = true;
    try {
      const factory = this.selectedFactory || 'ASM1';
      const [docs, traDocs] = await Promise.all([
        this.fetchPutawayStagingInventoryDocs(factory),
        this.fetchPutawayTraInventoryDocs(factory)
      ]);
      this.iqcMaterialsBySku = docs.length > 0 ? this.buildPutawayModalSkuRows(docs) : [];
      this.putawayTraMaterialsBySku = traDocs.length > 0 ? this.buildPutawayTraModalSkuRows(traDocs) : [];

      console.log('📊 Putaway modal SKU rows:', this.iqcMaterialsBySku.length, 'TRA:', this.putawayTraMaterialsBySku.length);
      this.cdr.detectChanges();
    } catch (error) {
      console.error('❌ Error loading Putaway staging modal:', error);
      this.iqcMaterialsBySku = [];
      this.putawayTraMaterialsBySku = [];
    } finally {
      this.iqcMaterialsLoading = false;
    }
  }

  get putawayModalTotalPassSku(): number {
    return (this.iqcMaterialsBySku || []).reduce((sum, r) => sum + r.passCount, 0);
  }

  get putawayModalTotalNotPassSku(): number {
    return (this.iqcMaterialsBySku || []).reduce((sum, r) => sum + r.notPassCount, 0);
  }

  get putawayModalTotalHoldSku(): number {
    return (this.iqcMaterialsBySku || []).reduce((sum, r) => sum + (r.holdCount || 0), 0);
  }

  get putawayModalActiveSourceRows(): PutawayModalSkuRow[] {
    return this.putawayFilterMode === 'tra'
      ? (this.putawayTraMaterialsBySku || [])
      : (this.iqcMaterialsBySku || []);
  }

  get putawayModalIsEmpty(): boolean {
    return this.putawayModalActiveSourceRows.length === 0;
  }

  /** Danh sách hiển thị trong modal theo filter + sort */
  get putawayModalDisplayRows(): PutawayModalSkuRow[] {
    if (this.putawayFilterMode === 'tra') {
      return this.sortPutawayModalRows(this.putawayTraMaterialsBySku || []);
    }

    let rows = this.iqcMaterialsBySku || [];

    if (this.putawayFilterMode === 'pass') {
      rows = rows.filter(r => r.passCount > 0);
    } else if (this.putawayFilterMode === 'not-pass') {
      rows = rows.filter(r => r.notPassCount > 0);
    } else if (this.putawayFilterMode === 'hold') {
      rows = rows.filter(r => (r.holdCount || 0) > 0);
    }

    return this.sortPutawayModalRows(rows);
  }

  private sortPutawayModalRows(rows: PutawayModalSkuRow[]): PutawayModalSkuRow[] {
    if (this.putawaySortByDay !== 'none') {
      const dir = this.putawaySortByDay === 'asc' ? 1 : -1;
      return [...rows].sort((a, b) => {
        if (a.dayInIqc !== b.dayInIqc) return (a.dayInIqc - b.dayInIqc) * dir;
        return a.materialCode.localeCompare(b.materialCode);
      });
    }

    return [...rows].sort((a, b) => {
      if (b.dayInIqc !== a.dayInIqc) return b.dayInIqc - a.dayInIqc;
      if (b.notPassCount !== a.notPassCount) return b.notPassCount - a.notPassCount;
      if (b.passCount !== a.passCount) return b.passCount - a.passCount;
      return a.materialCode.localeCompare(b.materialCode);
    });
  }

  /** Màu nền xanh gradient theo tỷ lệ pass (đậm = nhiều pass, nhạt = ít) */
  passRowBackground(row: PutawayModalSkuRow): string {
    if (!row.passCount || !row.totalSkuCount) return '';
    const ratio = row.passCount / row.totalSkuCount; // 0..1
    // lightness: ratio=1 → 78%, ratio→0 → 94%
    const l = Math.round(94 - ratio * 16);
    return `hsl(142, 72%, ${l}%)`;
  }

  // Download IQC Materials Report
  downloadIQCMaterialsReport(): void {
    const rows = this.putawayModalDisplayRows;
    if (rows.length === 0) {
      alert('Không có dữ liệu để tải xuống!');
      return;
    }

    try {
      const wb = XLSX.utils.book_new();
      const excelData = rows.map((row, index) => ({
        STT: index + 1,
        'Mã hàng (SKU)': row.materialCode,
        'Đã Pass': row.passCount,
        Hold: row.holdCount || 0,
        'Chưa Pass': row.notPassCount,
        'Tổng SKU (PO+IMD)': row.totalSkuCount,
        'Tồn kho': row.totalStock,
      }));

      const ws = XLSX.utils.json_to_sheet(excelData);
      XLSX.utils.book_append_sheet(wb, ws, 'Putaway_SKU');

      const date = new Date().toISOString().split('T')[0];
      const traSuffix = this.putawayFilterMode === 'tra' ? '_TRA' : this.putawayFilterMode === 'hold' ? '_Hold' : '';
      const filename = `Putaway_Staging_SKU_${this.selectedFactory}${traSuffix}_${date}.xlsx`;

      XLSX.writeFile(wb, filename);
      console.log(`✅ Putaway SKU report downloaded: ${filename}`);
      alert(`✅ Đã tải báo cáo: ${filename}`);
    } catch (error) {
      console.error('❌ Error downloading IQC materials report:', error);
      alert(`❌ Lỗi khi tải báo cáo: ${error.message}`);
    }
  }

  // Logout method for mobile
  async logout(): Promise<void> {
    console.log('🚪 Logging out...');
    
    try {
      // 1. Sign out from Firebase Auth first (IMPORTANT!)
      await this.authService.signOut();
      console.log('✅ Firebase auth signed out');
      
      // 2. Clear session storage and local storage
      sessionStorage.clear();
      localStorage.clear();
      console.log('✅ Storage cleared');
      
      // 3. Navigate to login page using Angular Router (for hash routing)
      await this.router.navigate(['/login']);
      console.log('✅ Redirected to login page');
      
    } catch (error) {
      console.error('❌ Error in logout:', error);
      
      // Fallback: Clear everything and force redirect
      sessionStorage.clear();
      localStorage.clear();
      window.location.hash = '#/login';
      window.location.reload();
    }
  }

}
