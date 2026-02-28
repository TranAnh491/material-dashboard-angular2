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
  ready: string;
  extra: string;
  doneClass: string;
  waitingClass: string;
  readyClass: string;
  delayClass: string;
}

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.css']
})
export class DashboardComponent implements OnInit, OnDestroy {

  workOrder = "...";
  shipment = "...";
  workOrderStatus: WorkOrderStatusRow[] = [];
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
  iqcLoading = false;
  
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
    }>;
  }> = [];
  iqcMaterialsLoading: boolean = false;

  refreshInterval: any;
  refreshTime = 300000; // 5 phút
  rackWarningsRefreshInterval: any;
  rackWarningsRefreshTime = 14400000; // 4 tiếng

  // Menu tabs for icon grid
  menuTabs = [
    // ASM1 RM
    { path: '/inbound-asm1', title: 'RM1 Inbound', icon: 'arrow_downward', category: 'ASM1 RM' },
    { path: '/outbound-asm1', title: 'RM1 Outbound', icon: 'arrow_upward', category: 'ASM1 RM' },
    { path: '/materials-asm1', title: 'RM1 Inventory', icon: 'inventory', category: 'ASM1 RM' },
    { path: '/inventory-overview-asm1', title: 'RM1 Overview', icon: 'assessment', category: 'ASM1 RM' },
    
    // ASM2 RM
    { path: '/inbound-asm2', title: 'RM2 Inbound', icon: 'arrow_downward', category: 'ASM2 RM' },
    { path: '/outbound-asm2', title: 'RM2 Outbound', icon: 'arrow_upward', category: 'ASM2 RM' },
    { path: '/materials-asm2', title: 'RM2 Inventory', icon: 'inventory', category: 'ASM2 RM' },
    { path: '/inventory-overview-asm2', title: 'RM2 Overview', icon: 'assessment', category: 'ASM2 RM' },
    
    // ASM1 FG
    { path: '/fg-in', title: 'FG In', icon: 'input', category: 'ASM1 FG' },
    { path: '/fg-out', title: 'FG Out', icon: 'output', category: 'ASM1 FG' },
    { path: '/fg-check', title: 'FG Check', icon: 'fact_check', category: 'ASM1 FG' },
    { path: '/fg-inventory', title: 'FG Inventory', icon: 'inventory_2', category: 'ASM1 FG' },
    
    // Tools & Operations
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
    
    // Auto refresh rack warnings every 4 hours
    this.rackWarningsRefreshInterval = setInterval(() => this.loadRackWarnings(), this.rackWarningsRefreshTime);
    
    // Load IQC materials by week
    this.loadIQCByWeek();
    
    // Listen for factory changes from navbar
    window.addEventListener('factoryChanged', (event: any) => {
      this.selectedFactory = event.detail.factory;
      console.log('Dashboard received factory change:', this.selectedFactory);
      this.loadDashboardData();
    });
    
    // Listen for factory changes from localStorage (for cross-tab sync)
    window.addEventListener('storage', (event) => {
      if (event.key === 'selectedFactory') {
        this.selectedFactory = event.newValue || 'ASM1';
        this.loadDashboardData();
      }
    });
  }

  ngOnDestroy() {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    if (this.rackWarningsRefreshInterval) clearInterval(this.rackWarningsRefreshInterval);
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

  // Create donut chart for accuracy with percentage in center
  createAccuracyDonutChart(canvasId: string, label: string, percentage: number, color: string = '#ff9800') {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Format percentage: if it's a whole number, show 0 decimals, otherwise show 2 decimals
    const percentageText = percentage % 1 === 0 ? percentage.toFixed(0) + '%' : percentage.toFixed(2) + '%';

    const chart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Accuracy'],
        datasets: [{
          data: [percentage, 100 - percentage],
          backgroundColor: [color, '#e0e0e0'],
          borderWidth: 0
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
            enabled: false
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
          ctx.fillStyle = color;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(percentageText, centerX, centerY);
          ctx.restore();
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
          ctx.fillStyle = '#000000'; // Black text
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
      
      // Get current month and year for filtering by deliveryDate
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth() + 1; // 1-12
      const currentYear = currentDate.getFullYear();
      
      console.log(`Loading work orders for factories: ${factoryFilter.join(', ')} in month ${currentMonth}/${currentYear} (by deliveryDate)`);
      
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
        
        // Filter by factory AND deliveryDate month/year
        this.workOrders = workOrders.filter(wo => {
          const woFactory = wo.factory || 'ASM1';
          
          // Check factory match
          const factoryMatch = factoryFilter.includes(woFactory);
          
          // Check deliveryDate month/year match
          let monthYearMatch = false;
          if (wo.deliveryDate) {
            const deliveryMonth = wo.deliveryDate.getMonth() + 1;
            const deliveryYear = wo.deliveryDate.getFullYear();
            monthYearMatch = deliveryMonth === currentMonth && deliveryYear === currentYear;
          }
          
          return factoryMatch && monthYearMatch;
        });
        
        this.filteredWorkOrders = [...this.workOrders];
        
        console.log(`Loaded ${this.workOrders.length} work orders for ${this.selectedFactory} with deliveryDate in ${currentMonth}/${currentYear}`);
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

  private updateWorkOrderSummary() {
    if (this.workOrders.length === 0) {
      this.workOrder = "0";
      console.log('No work orders found, setting summary to 0');
      return;
    }
    
    const totalWorkOrders = this.workOrders.length;
    const completedWorkOrders = this.workOrders.filter(wo => {
      // Check if work order is completed
      if (wo.isCompleted) return true;
      if (wo.status === WorkOrderStatus.DONE) return true;
      return false;
    }).length;
    
    this.workOrder = `${completedWorkOrders}/${totalWorkOrders}`;
    console.log(`Work Order Summary: ${this.workOrder} for ${this.selectedFactory}`);
    console.log(`Total: ${totalWorkOrders}, Completed: ${completedWorkOrders}`);
    
    // Log work order status breakdown
    const statusBreakdown = this.workOrders.reduce((acc, wo) => {
      const status = wo.status || 'UNKNOWN';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {} as any);
    
    console.log('Work order status breakdown:', statusBreakdown);
  }

  private updateWorkOrderStatus() {
    this.workOrderStatus = [];
    const today = new Date();
    
    console.log('Updating work order status for next 7 days starting from:', today.toDateString());
    console.log('Total work orders to process:', this.workOrders.length);
    
    // Generate next 7 days
    for (let i = 0; i < 7; i++) {
      const targetDate = new Date(today);
      targetDate.setDate(today.getDate() + i);
      
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
        ready: readyCount > 0 ? readyCount.toString() : '—',
        extra: delayCount > 0 ? delayCount.toString() : '—',
        // Add CSS classes for styling
        doneClass: doneCount > 0 ? 'has-value' : 'empty-cell',
        waitingClass: waitingCount > 0 ? 'has-value' : 'empty-cell',
        readyClass: readyCount > 0 ? 'has-value' : 'empty-cell',
        delayClass: delayCount > 0 ? 'has-value' : 'empty-cell'
      };
      
      this.workOrderStatus.push(statusRow);
      
      console.log(`Date ${dateStr}: Done=${doneCount}, Waiting=${waitingCount}, Ready=${readyCount}, Delay=${delayCount}`);
    }
    
    console.log(`Updated Work Order Status for next 7 days:`, this.workOrderStatus);
  }

  private loadShipmentDataFromGoogleSheets() {
    // Load shipment data from Firebase collection 'shipments'
    console.log(`Loading all shipment data from Firebase`);
    
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
      
      // Group by shipmentCode (đếm tất cả shipments, không filter theo tháng)
      const shipmentGroups = new Map<string, any[]>();
      allShipments.forEach(s => {
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
      console.log(`Total Shipments: ${this.shipment} (completed/total shipments)`);
      console.log(`Breakdown: ${completedShipments} shipments fully shipped out of ${totalShipments} total shipments`);
      
      // Shipment Status for next 7 days
      this.updateShipmentStatus(allShipments);
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
    // Cập nhật dữ liệu thực tế cho 3 box chart
    const months = ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'];
    const matAccuracy = [99.9, 99.93, 99.80, 99.91, 99.87, 99.86];
    const fgAccuracy = [100, 100, 100, 100, 100, 100];
    
    // FGs Inventory Turnover - 12 tháng dữ liệu
    const fgTurnover12Months = [1.21, 0.98, 1.29, 1.63, 1.70, 1.26, 1.63, 1.95, 1.44, 1.56, 1.35, 1.5];
    
    this.createAccuracyDonutChart('dailySalesChart', 'Materials Accuracy (%)', 99.85, '#4caf50');
    this.createAccuracyDonutChart('websiteViewsChart', 'Finished Goods Accuracy (%)', 100, '#2196f3');
    this.createDonutChart('completedTasksChart', 'FGs Inventory Turnover', fgTurnover12Months);
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

  // Load IQC Materials by Week (8 weeks)
  async loadIQCByWeek() {
    this.iqcLoading = true;
    try {
      // Get current week number (ISO week)
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentWeek = this.getISOWeek(now);
      
      // Get 8 weeks (current week and 7 previous weeks)
      const weeks: Array<{ week: string, weekNum: number, startDate: Date, endDate: Date }> = [];
      for (let i = 7; i >= 0; i--) {
        let weekNum = currentWeek - i;
        let year = currentYear;
        
        // Handle year boundary
        if (weekNum <= 0) {
          year--;
          const lastWeekOfYear = this.getISOWeek(new Date(year, 11, 31));
          weekNum = lastWeekOfYear + weekNum;
        }
        
        const weekDate = this.getDateFromISOWeek(year, weekNum);
        const startDate = this.getStartOfWeek(weekDate);
        const endDate = this.getEndOfWeek(weekDate);
        weeks.push({
          week: `W${weekNum}`,
          weekNum: weekNum,
          startDate: startDate,
          endDate: endDate
        });
      }

      // Load all materials with location = "IQC" (exact match) - Filter by ASM1 factory
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', 'ASM1')
          .where('location', '==', 'IQC')
      ).get().toPromise();

      if (!snapshot || snapshot.empty) {
        this.iqcWeekData = weeks.map(w => ({ week: w.week, count: 0 }));
        this.cdr.detectChanges();
        return;
      }

      // Count unique materials per week
      const weekCounts = new Map<string, Set<string>>();
      weeks.forEach(w => {
        weekCounts.set(w.week, new Set());
      });

      snapshot.forEach(doc => {
        const data = doc.data() as any;
        const location = (data.location || '').toUpperCase().trim();
        
        // Check if location is exactly IQC
        if (location !== 'IQC') {
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

        // 🔧 Chỉ tính materials có IQC status là "Chờ kiểm" hoặc "CHỜ KIỂM"
        const iqcStatus = (data.iqcStatus || '').trim();
        if (iqcStatus !== 'Chờ kiểm' && iqcStatus !== 'CHỜ KIỂM' && iqcStatus !== 'Chờ kiểm tra' && iqcStatus !== 'CHỜ XÁC NHẬN') {
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
        
        // If no date, skip this material
        if (!materialDate) {
          return;
        }

        // Find which week this material belongs to
        for (const week of weeks) {
          if (materialDate >= week.startDate && materialDate <= week.endDate) {
            // Create unique key: materialCode_PO_IMD (giống Manage tab)
            const materialCode = (data.materialCode || '').toUpperCase().trim();
            const poNumber = (data.poNumber || '').trim();
            const batchNumber = (data.batchNumber || '').trim();
            const imd = this.getIMDFromDate(materialDate, batchNumber);
            const uniqueKey = `${materialCode}_${poNumber}_${imd}`;
            
            weekCounts.get(week.week)?.add(uniqueKey);
            break; // Material can only belong to one week
          }
        }
      });

      // Convert to array format
      this.iqcWeekData = weeks.map(w => ({
        week: w.week,
        count: weekCounts.get(w.week)?.size || 0
      }));

      console.log('📊 IQC Week Data:', this.iqcWeekData);
      this.cdr.detectChanges();
    } catch (error) {
      console.error('❌ Error loading IQC by week:', error);
      this.iqcWeekData = [];
    } finally {
      this.iqcLoading = false;
    }
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
      const currentYear = now.getFullYear();
      const currentWeek = this.getISOWeek(now);
      
      // Get 8 weeks (current week and 7 previous weeks)
      const weeks: Array<{ week: string, weekNum: number, startDate: Date, endDate: Date }> = [];
      for (let i = 7; i >= 0; i--) {
        let weekNum = currentWeek - i;
        let year = currentYear;
        
        // Handle year boundary
        if (weekNum <= 0) {
          year--;
          const lastWeekOfYear = this.getISOWeek(new Date(year, 11, 31));
          weekNum = lastWeekOfYear + weekNum;
        }
        
        const weekDate = this.getDateFromISOWeek(year, weekNum);
        const startDate = this.getStartOfWeek(weekDate);
        const endDate = this.getEndOfWeek(weekDate);
        weeks.push({
          week: `W${weekNum}`,
          weekNum: weekNum,
          startDate: startDate,
          endDate: endDate
        });
      }

      // Load all materials with location = "IQC" (exact match) - Filter by ASM1 factory
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', 'ASM1')
          .where('location', '==', 'IQC')
      ).get().toPromise();

      // Initialize materials array for each week
      this.iqcMaterialsByWeek = weeks.map(w => ({
        week: w.week,
        weekNum: w.weekNum,
        startDate: w.startDate,
        endDate: w.endDate,
        materials: []
      }));

      if (snapshot && !snapshot.empty) {
        const materialsMap = new Map<string, Array<{
          materialCode: string;
          poNumber: string;
          imd: string;
          stock: number;
          location: string;
        }>>();

        // Initialize map for each week
        weeks.forEach(w => {
          materialsMap.set(w.week, []);
        });

        snapshot.forEach(doc => {
          const data = doc.data() as any;
          const location = (data.location || '').toUpperCase().trim();
          
          // Check if location is exactly IQC
          if (location !== 'IQC') {
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

          // 🔧 Chỉ tính materials có IQC status là "Chờ kiểm" hoặc "CHỜ KIỂM"
          const iqcStatus = (data.iqcStatus || '').trim();
          if (iqcStatus !== 'Chờ kiểm' && iqcStatus !== 'CHỜ KIỂM' && iqcStatus !== 'Chờ kiểm tra' && iqcStatus !== 'CHỜ XÁC NHẬN') {
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
          
          // If no date, skip this material
          if (!materialDate) {
            return;
          }

          // Find which week this material belongs to
          for (const week of weeks) {
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
                // Update stock if already exists
                weekMaterials[existingIndex].stock += stock;
              } else {
                // Add new material
                weekMaterials.push({
                  materialCode: materialCode,
                  poNumber: poNumber,
                  imd: imd,
                  stock: stock,
                  location: 'IQC'
                });
              }
              
              materialsMap.set(week.week, weekMaterials);
              break; // Material can only belong to one week
            }
          }
        });

        // Update iqcMaterialsByWeek with materials
        this.iqcMaterialsByWeek = this.iqcMaterialsByWeek.map(weekData => ({
          ...weekData,
          materials: materialsMap.get(weekData.week) || []
        }));
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
          'Tồn kho': material.stock,
          'Vị trí': material.location
        }));

        // Add header row with week info
        const headerRow = [{
          'STT': weekData.week,
          'Mã hàng': `Từ ${weekData.startDate.toLocaleDateString('vi-VN')} đến ${weekData.endDate.toLocaleDateString('vi-VN')}`,
          'PO': `Tổng: ${weekData.materials.length} mã`,
          'IMD': '',
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
