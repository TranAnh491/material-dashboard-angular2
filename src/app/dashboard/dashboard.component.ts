import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import Chart from 'chart.js/auto';
import { AngularFirestore } from '@angular/fire/compat/firestore';
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

interface WoHeatmapDayCol {
  label: string;
  weekday: string;
  total: number;
  cells: { kind: WoHeatKind }[];
}

/** Nhóm IQC hiển thị Putaway staging — màu ô heatmap */
type PutawayIqcStatusKind = 'pass' | 'ng' | 'pending';

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

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, OnDestroy {

  /** SKU không thuộc 8 tuần hoặc thiếu ngày — nhãn cột heatmap/modal, luôn đứng trước các tuần Wxx. */
  private readonly putawayLateWeekLabel = 'Late';

  /**
   * Tóm tắt tháng hiện tại (Done/Tổng) — cùng nguồn với Cloud Function `notifyDashboardZaloWeekdays1130`
   * (codebase `zalo`: `zalo/dashboard-digest.js` + `zalo/index.js`, 11:30 thứ 2–6 VN).
   */
  workOrder = "...";
  shipment = "...";
  workOrderStatus: WorkOrderStatusRow[] = [];
  /** 6 cột T2–T7, mỗi ô = 1 WO (màu theo trạng thái) */
  woHeatmapDays: WoHeatmapDayCol[] = [];
  yesterdayOverdueCount: number = 0;
  shipmentStatus: any[] = [];

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
  
  // IQC Materials Modal
  showIQCMaterialsModal: boolean = false;
  iqcMaterialsByWeek: Array<{
    week: string;
    weekNum: number;
    startDate: Date;
    endDate: Date;
    materials: Array<{
      materialCode: string;
      poNumber: string;
      imd: string;
      stock: number;
      location: string;
      iqcStatus?: string;
      statusKind: PutawayIqcStatusKind;
    }>;
  }> = [];
  iqcMaterialsLoading: boolean = false;

  refreshInterval: any;
  refreshTime = 300000; // 5 phút
  rackWarningsRefreshInterval: any;
  rackWarningsRefreshTime = 14400000; // 4 tiếng

  // Charts for widgets
  private fgTurnoverChart: Chart | null = null;

  /** % Accuracy hiển thị “tháng này” (đồng bộ với donut) */
  matAccuracyThisMonth = 99.85;
  fgAccuracyThisMonth = 100;

  /** FGs Inventory Turnover — theo tháng 2026 (cột) + target tháng */
  readonly fgTurnoverMonthLabels = ['Thg 1', 'Thg 2', 'Thg 3', 'Thg 4'];
  readonly fgTurnoverMonthValues = [1.33, 0.4, 0.83, 1.16];
  readonly fgTurnoverTargetMonthly = 1.33;

  get fgTurnoverYtd(): number {
    return this.fgTurnoverMonthValues.reduce((a, b) => a + b, 0);
  }

  // Shipment table pagination
  shipmentCurrentPage = 1;
  shipmentPageSize = 10;
  get shipmentPageCount(): number { return Math.max(1, Math.ceil(this.shipmentStatus.length / this.shipmentPageSize)); }
  get shipmentPagedRows(): any[] {
    const start = (this.shipmentCurrentPage - 1) * this.shipmentPageSize;
    return this.shipmentStatus.slice(start, start + this.shipmentPageSize);
  }
  shipmentPrevPage(): void { if (this.shipmentCurrentPage > 1) this.shipmentCurrentPage--; }
  shipmentNextPage(): void { if (this.shipmentCurrentPage < this.shipmentPageCount) this.shipmentCurrentPage++; }

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

  // Menu tabs for icon grid
  menuTabs = [
    // ASM1 RM
    { path: '/inbound-asm1', title: 'RM1 Inbound', icon: 'arrow_downward', category: 'ASM1 RM' },
    { path: '/outbound-asm1', title: 'RM1 Outbound', icon: 'arrow_upward', category: 'ASM1 RM' },
    { path: '/materials-asm1', title: 'RM1 Inventory', icon: 'inventory', category: 'ASM1 RM' },
    { path: '/inventory-overview-asm1', title: 'RM1 Overview', icon: 'assessment', category: 'ASM1 RM' },
    { path: '/bag-history', title: 'Control Batch', icon: 'history', category: 'ASM1 RM' },
    
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
    { path: '/fg-location', title: 'FG Location', icon: 'edit_location', category: 'ASM FG' },
    { path: '/pallet-id', title: 'Pallet ID', icon: 'view_in_ar', category: 'ASM FG' },
    
    // Tools & Operations
    { path: '/assistant', title: 'Assistant', icon: 'smart_toy', category: 'Tools' },
    { path: '/work-order-status', title: 'Work Order', icon: 'assignment', category: 'Tools' },
    { path: '/shipment', title: 'Shipment', icon: 'local_shipping', category: 'Tools' },
    { path: '/label', title: 'Label', icon: 'label', category: 'Tools' },
    { path: '/rm1-delivery', title: 'RM Delivery', icon: 'local_shipping', category: 'Main' },
    { path: '/find-rm1', title: 'Find RM1', icon: 'search', category: 'Tools' },
    { path: '/location', title: 'Location', icon: 'location_on', category: 'Tools' },
    { path: '/warehouse-loading', title: 'Loading', icon: 'assessment', category: 'Tools' },
    { path: '/trace-back', title: 'Trace Back', icon: 'track_changes', category: 'Tools' },
    { path: '/stock-check', title: 'Stock Check', icon: 'inventory_2', category: 'Tools' },
    { path: '/qc', title: 'Quality', icon: 'assignment_turned_in', category: 'Tools' },
    { path: '/safety', title: 'Safety Stock', icon: 'security', category: 'Tools' },
    
    // Admin & Reports
    { path: '/index', title: 'Bonded Report', icon: 'analytics', category: 'Admin' },
    { path: '/utilization', title: 'Utilization', icon: 'assessment', category: 'Admin' },
    { path: '/checklist', title: 'Safety & Quality', icon: 'checklist', category: 'Admin' },
    { path: '/equipment', title: 'Training', icon: 'integration_instructions', category: 'Admin' },
    { path: '/manage', title: 'Manage', icon: 'manage_search', category: 'Admin' },
    { path: '/settings', title: 'Settings', icon: 'settings', category: 'Admin' }
  ];

  constructor(
    private firestore: AngularFirestore, 
    private safetyService: SafetyService, 
    private cdr: ChangeDetectorRef,
    private router: Router,
    private authService: FirebaseAuthService
  ) { }
  
  navigateToTab(path: string): void {
    this.router.navigate([path]);
  }

  ngOnInit() {
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

  private async loadWorkOrdersFromFirebase() {
    try {
      // Get work orders for selected factory (ASM1 or ASM2) and Sample factories
      const factoryFilter = this.selectedFactory === 'ASM1' ? ['ASM1', 'Sample 1'] : ['ASM2', 'Sample 2'];
      
      console.log(`Loading work orders for factories: ${factoryFilter.join(', ')} (count by deliveryDate - Ngày Giao NVL)`);
      
      // Load work orders from database
      this.firestore.collection('work-orders').snapshotChanges().subscribe((actions) => {
        const workOrders = actions.map(a => {
          const data = a.payload.doc.data() as any;
          const id = a.payload.doc.id;
          
          // Process deliveryDate to ensure proper Date object
          let deliveryDate: Date | null = null;
          if (data.deliveryDate) {
            if (typeof data.deliveryDate === 'object' && data.deliveryDate !== null && 'toDate' in data.deliveryDate) {
              deliveryDate = data.deliveryDate.toDate();
            } else if (data.deliveryDate instanceof Date) {
              deliveryDate = data.deliveryDate;
            } else {
              deliveryDate = new Date(data.deliveryDate);
            }
          }
          
          return { id, ...data, deliveryDate };
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
        
        console.log(`Loaded ${this.workOrders.length} work orders for ${this.selectedFactory} (all delivery dates)`);
        console.log('Sample work orders:', this.workOrders.slice(0, 5).map(wo => ({
          id: wo.id,
          productCode: wo.productCode,
          factory: wo.factory,
          status: wo.status,
          deliveryDate: wo.deliveryDate
        })));
        
        // Update summaries after loading data
        this.updateWorkOrderSummary();
        this.updateWorkOrderStatus();
      });
      
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
      
      // Count work orders by status for this date
      const workOrdersForDate = this.workOrders.filter(wo => {
        if (!wo.deliveryDate) return false;
        
        let deliveryDate: Date;
        if (wo.deliveryDate instanceof Date) {
          deliveryDate = wo.deliveryDate;
        } else if (typeof wo.deliveryDate === 'object' && wo.deliveryDate !== null && 'toDate' in wo.deliveryDate) {
          // Handle Firestore Timestamp
          deliveryDate = (wo.deliveryDate as any).toDate();
        } else {
          // Handle string date
          deliveryDate = new Date(wo.deliveryDate as any);
        }
        
        // Compare dates (ignore time)
        return deliveryDate.toDateString() === targetDate.toDateString();
      });
      
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

    this.rebuildWoHeatmapFromStatus();
    this.cdr.detectChanges();
  }

  get woHeatmapHasCells(): boolean {
    return (this.woHeatmapDays || []).some((d) => (d.cells?.length || 0) > 0);
  }

  woHeatCellTitle(kind: WoHeatKind): string {
    const m: Record<WoHeatKind, string> = {
      done: 'Done',
      waiting: 'Waiting',
      kitting: 'Kitting',
      ready: 'Ready',
      delay: 'Delay'
    };
    return m[kind] || kind;
  }

  private rebuildWoHeatmapFromStatus(): void {
    const rows = this.workOrderStatus || [];
    const vnDays = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    this.woHeatmapDays = rows.map((row, idx) => {
      const d = this.parseCellNumber(row.value);
      const w = this.parseCellNumber(row.note);
      const k = this.parseCellNumber(row.kitting);
      const r = this.parseCellNumber(row.ready);
      const dl = this.parseCellNumber(row.extra);
      const cells: { kind: WoHeatKind }[] = [];
      for (let i = 0; i < d; i++) cells.push({ kind: 'done' });
      for (let i = 0; i < w; i++) cells.push({ kind: 'waiting' });
      for (let i = 0; i < k; i++) cells.push({ kind: 'kitting' });
      for (let i = 0; i < r; i++) cells.push({ kind: 'ready' });
      for (let i = 0; i < dl; i++) cells.push({ kind: 'delay' });
      return {
        label: row.code,
        weekday: vnDays[idx] ?? `D${idx + 1}`,
        total: d + w + k + r + dl,
        cells
      };
    });
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

  private loadShipmentDataFromGoogleSheets() {
    // Load shipment data from Firebase collection 'shipments'
    console.log(`Loading shipment data from Firebase (tháng hiện tại)`);

    this.firestore.collection('shipments').get().subscribe(snapshot => {
      const allShipments = snapshot.docs.map(doc => {
        const data = doc.data() as any;
        return {
          id: doc.id,
          ...data,
          requestDate: data.requestDate ? (data.requestDate.toDate ? data.requestDate.toDate() : new Date(data.requestDate)) : null,
          actualShipDate: data.actualShipDate ? (data.actualShipDate.toDate ? data.actualShipDate.toDate() : new Date(data.actualShipDate)) : null,
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

      // Shipment Status for next 7 days (chỉ dòng thuộc tháng hiện tại)
      this.updateShipmentStatus(monthShipments);
    }, error => {
      console.error('Error loading shipment data from Firebase:', error);
      this.shipment = "0/0";
      this.shipmentStatus = [];
    });
  }
  
  private updateShipmentStatus(allShipments: any[]) {
    this.shipmentStatus = [];
    const today = new Date();
    
    console.log('Updating shipment status for next 7 days starting from:', today.toDateString());
    
    // Generate next 7 days
    for (let i = 0; i < 7; i++) {
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + i);
      
      const dateStr = targetDate.toLocaleDateString('vi-VN', { 
        day: '2-digit', 
        month: '2-digit' 
      });
      
      // Find shipments for this date (based on actualShipDate)
      const shipmentsForDate = allShipments.filter(s => {
        if (!s.actualShipDate) return false;
        const shipDate = s.actualShipDate;
        return shipDate.toDateString() === targetDate.toDateString();
      });
      
      // Group by shipment code
      const shipmentGroups = new Map<string, any[]>();
      shipmentsForDate.forEach(s => {
        const code = String(s.shipmentCode || '').trim().toUpperCase();
        if (!shipmentGroups.has(code)) {
          shipmentGroups.set(code, []);
        }
        shipmentGroups.get(code)!.push(s);
      });
      
      // Create rows for each shipment code on this date
      shipmentGroups.forEach((items, shipmentCode) => {
        const totalCartons = items.reduce((sum, item) => sum + (item.carton || 0), 0);
        const statuses = [...new Set(items.map(item => item.status || ''))].join(', ');
        
        this.shipmentStatus.push({
          shipDate: dateStr,
          shipment: shipmentCode,
          customer: '', // Để trống cột Customer
          carton: totalCartons > 0 ? totalCartons.toString() : '—',
          statusDetail: statuses || '—'
        });
      });
    }
    
    console.log(`Updated Shipment Status for next 7 days:`, this.shipmentStatus);
  }

  private createCharts() {
    this.matAccuracyThisMonth = 99.85;
    this.fgAccuracyThisMonth = 100;

    this.createAccuracyDonutChart('dailySalesChart', 'Materials Accuracy (%)', this.matAccuracyThisMonth, '#22c55e');
    this.createAccuracyDonutChart('websiteViewsChart', 'Finished Goods Accuracy (%)', this.fgAccuracyThisMonth, '#3b82f6');

    this.createFgTurnoverMonthlyBarChart('completedTasksChart');
  }

  /** Cột theo tháng + đường target tháng (1.33) */
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
            callbacks: {
              label: (context) => {
                const v = context.parsed.y;
                if (v === undefined || v === null) return '';
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
              font: { size: 11, family: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif" }
            },
            border: { display: false }
          },
          y: {
            beginAtZero: true,
            suggestedMax: Math.max(...bars, tgt) * 1.15,
            grid: { color: 'rgba(15,23,42,0.06)' },
            ticks: {
              color: 'rgba(15,23,42,0.45)',
              font: { size: 10, family: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif" }
            },
            border: { display: false }
          }
        }
      }
    });
  }

  private parseCellNumber(v: any): number {
    const s = String(v ?? '').trim();
    if (!s || s === '—' || s === '-') return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  isShipDone(statusDetail: string): boolean {
    const s = String(statusDetail || '').toLowerCase();
    return s.includes('đã xong') || s.includes('da xong') || s.includes('done') || s.includes('đã ship') || s.includes('da ship');
  }

  isShipWarn(statusDetail: string): boolean {
    const s = String(statusDetail || '').toLowerCase();
    return s.includes('chưa') || s.includes('cho soan') || s.includes('chờ') || s.includes('delay') || s.includes('warning');
  }

  shipBadgeText(statusDetail: string): string {
    const s = String(statusDetail || '').trim();
    if (!s) return 'Chờ soạn';
    if (this.isShipDone(s)) return 'Đã xong';
    if (/chưa/i.test(s)) return 'Chưa đủ';
    return 'Chờ soạn';
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
    this.loadDashboardData();
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

  /** Pass / NG / Chờ kiểm (và biến thể trong DB). */
  private normalizePutawayIqcStatus(raw: string): PutawayIqcStatusKind | null {
    const s = (raw || '').trim();
    if (!s) return null;
    const u = s.toUpperCase();
    if (u === 'PASS') return 'pass';
    if (u === 'NG') return 'ng';
    if (
      u.includes('CHỜ KIỂM') ||
      u.includes('CHỜ XÁC NHẬN') ||
      u.includes('CHỜ KIỂM TRA') ||
      u.includes('CHO KIEM') ||
      u.includes('CHO XAC NHAN')
    ) {
      return 'pending';
    }
    const compact = u.replace(/\s+/g, '');
    if (compact.includes('CHỜKIỂM') || compact.includes('CHỜXÁCNHẬN')) return 'pending';
    return null;
  }

  private mergePutawayStatusKind(a: PutawayIqcStatusKind, b: PutawayIqcStatusKind): PutawayIqcStatusKind {
    const rank: Record<PutawayIqcStatusKind, number> = { ng: 3, pending: 2, pass: 1 };
    return rank[a] >= rank[b] ? a : b;
  }

  private putawayStatusShortLabel(kind: PutawayIqcStatusKind): string {
    if (kind === 'pass') return 'Pass';
    if (kind === 'ng') return 'NG';
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

  // Load IQC Materials by Week (8 weeks)
  async loadIQCByWeek() {
    this.iqcLoading = true;
    try {
      const now = new Date();
      const weeks = this.buildPutawayWeekBuckets(now);

      const factory = this.selectedFactory || 'ASM1';
      const docs = await this.fetchPutawayStagingInventoryDocs(factory);

      if (!docs.length) {
        this.iqcWeekData = [];
        this.iqcHeatmapWeeks = [];
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
    this.iqcMaterialsByWeek = [];
  }

  // Load IQC Materials by Week for modal
  async loadIQCMaterialsByWeek(): Promise<void> {
    this.iqcMaterialsLoading = true;
    try {
      // Get current week number (ISO week)
      const now = new Date();
      const weeks = this.buildPutawayWeekBuckets(now);

      const factory = this.selectedFactory || 'ASM1';
      const docs = await this.fetchPutawayStagingInventoryDocs(factory);

      // Initialize materials array for each week
      this.iqcMaterialsByWeek = weeks.map(w => ({
        week: w.week,
        weekNum: w.weekNum,
        startDate: w.startDate,
        endDate: w.endDate,
        materials: []
      }));

      if (docs.length > 0) {
        const materialsMap = new Map<string, Array<{
          materialCode: string;
          poNumber: string;
          imd: string;
          stock: number;
          location: string;
          iqcStatus?: string;
          statusKind: PutawayIqcStatusKind;
        }>>();

        // Initialize map for each week
        weeks.forEach(w => {
          materialsMap.set(w.week, []);
        });

        docs.forEach((doc: any) => {
          const data = doc.data() as any;
          const locRaw = (data.location || '').trim();
          if (!this.isIqcStagingLocation(locRaw)) {
            return;
          }

          // Calculate stock: openingStock + quantity - exported - xt
          const openingStock = data.openingStock !== null && data.openingStock !== undefined ? Number(data.openingStock) : 0;
          const quantity = Number(data.quantity) || 0;
          const exported = Number(data.exported) || 0;
          const xt = Number(data.xt) || 0;
          const stock = openingStock + quantity - exported - xt;
          
          // Only count materials with stock > 0
          if (stock <= 0) {
            return;
          }

          const iqcStatus = (data.iqcStatus || '').trim();
          const statusKind = this.normalizePutawayIqcStatus(iqcStatus);
          if (!statusKind) {
            return;
          }

          // Get date for week calculation
          let materialDate: Date | null = null;
          
          // Priority 1: importDate
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
          
          // Priority 2: lastUpdated
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
          
          // Priority 3: createdAt
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
          
          const pushOrMerge = (weekKey: string) => {
            const materialCode = (data.materialCode || '').toUpperCase().trim();
            const poNumber = (data.poNumber || '').trim();
            const batchNumber = (data.batchNumber || '').trim();
            const imd = this.getIMDFromDate(materialDate || new Date(), batchNumber);
            const uniqueKey = `${materialCode}_${poNumber}_${imd}`;
            const weekMaterials = materialsMap.get(weekKey) || [];
            const existingIndex = weekMaterials.findIndex(m =>
              m.materialCode === materialCode &&
              m.poNumber === poNumber &&
              m.imd === imd
            );
            if (existingIndex >= 0) {
              weekMaterials[existingIndex].stock += stock;
              weekMaterials[existingIndex].iqcStatus = iqcStatus;
              weekMaterials[existingIndex].statusKind = this.mergePutawayStatusKind(
                weekMaterials[existingIndex].statusKind,
                statusKind
              );
              weekMaterials[existingIndex].location = locRaw;
            } else {
              weekMaterials.push({
                materialCode,
                poNumber,
                imd,
                stock,
                location: locRaw,
                iqcStatus,
                statusKind
              });
            }
            materialsMap.set(weekKey, weekMaterials);
          };

          // Nếu không có date => gom vào Late
          if (!materialDate) {
            pushOrMerge(this.putawayLateWeekLabel);
            return;
          }

          // Find which week this material belongs to (8 tuần); nếu không match => Late
          let placed = false;
          for (const week of weeks) {
            if (week.week === this.putawayLateWeekLabel) continue;
            if (materialDate >= week.startDate && materialDate <= week.endDate) {
              const materialCode = (data.materialCode || '').toUpperCase().trim();
              const poNumber = (data.poNumber || '').trim();
              const batchNumber = (data.batchNumber || '').trim();
              const imd = this.getIMDFromDate(materialDate, batchNumber);
              
              // Check if material already exists in this week (unique by materialCode_PO_IMD)
              const uniqueKey = `${materialCode}_${poNumber}_${imd}`;
              const weekMaterials = materialsMap.get(week.week) || [];
              const existingIndex = weekMaterials.findIndex(m => 
                m.materialCode === materialCode && 
                m.poNumber === poNumber && 
                m.imd === imd
              );
              
              if (existingIndex >= 0) {
                weekMaterials[existingIndex].stock += stock;
                weekMaterials[existingIndex].iqcStatus = iqcStatus;
                weekMaterials[existingIndex].statusKind = this.mergePutawayStatusKind(
                  weekMaterials[existingIndex].statusKind,
                  statusKind
                );
              } else {
                weekMaterials.push({
                  materialCode: materialCode,
                  poNumber: poNumber,
                  imd: imd,
                  stock: stock,
                  location: locRaw,
                  iqcStatus: iqcStatus,
                  statusKind
                });
              }
              
              materialsMap.set(week.week, weekMaterials);
              placed = true;
              break;
            }
          }
          if (!placed) {
            pushOrMerge(this.putawayLateWeekLabel);
          }
        });

        // Update iqcMaterialsByWeek with materials
        this.iqcMaterialsByWeek = this.iqcMaterialsByWeek
          .map((weekData) => ({
            ...weekData,
            materials: materialsMap.get(weekData.week) || []
          }))
          .filter((w) => w.materials.length > 0);
      } else {
        this.iqcMaterialsByWeek = [];
      }

      console.log('📊 IQC Materials by Week loaded:', this.iqcMaterialsByWeek);
      this.cdr.detectChanges();
    } catch (error) {
      console.error('❌ Error loading IQC materials by week:', error);
      this.iqcMaterialsByWeek = [];
    } finally {
      this.iqcMaterialsLoading = false;
    }
  }

  // Download IQC Materials Report
  downloadIQCMaterialsReport(): void {
    if (this.iqcMaterialsByWeek.length === 0) {
      alert('Không có dữ liệu để tải xuống!');
      return;
    }

    try {
      // Prepare data for Excel - one sheet per week
      const wb = XLSX.utils.book_new();
      
      this.iqcMaterialsByWeek.forEach(weekData => {
        const excelData = weekData.materials.map((material, index) => ({
          'STT': index + 1,
          'Mã hàng': material.materialCode,
          'PO': material.poNumber,
          'IMD': material.imd,
          'IQC status': material.iqcStatus || '',
          'Tồn kho': material.stock,
          'Vị trí': material.location
        }));

        const isOtherBucket = weekData.week === this.putawayLateWeekLabel;
        // Add header row with week info
        const headerRow = [{
          'STT': weekData.week,
          'Mã hàng': isOtherBucket
            ? 'Ngoài 8 tuần gần nhất (hoặc thiếu ngày import/updated/created)'
            : `Từ ${weekData.startDate.toLocaleDateString('vi-VN')} đến ${weekData.endDate.toLocaleDateString('vi-VN')}`,
          'PO': `Tổng: ${weekData.materials.length} mã`,
          'IMD': '',
          'IQC status': '',
          'Tồn kho': '',
          'Vị trí': ''
        }];
        
        const allData = [...headerRow, ...excelData];
        
        // Create worksheet
        const ws = XLSX.utils.json_to_sheet(allData);
        XLSX.utils.book_append_sheet(wb, ws, weekData.week);
      });

      // Generate filename
      const date = new Date().toISOString().split('T')[0];
      const filename = `IQC_Materials_Report_${date}.xlsx`;

      // Write and download
      XLSX.writeFile(wb, filename);
      console.log(`✅ IQC Materials Report downloaded: ${filename}`);
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
