import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import Chart from 'chart.js/auto';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { WorkOrder, WorkOrderStatus } from '../models/material-lifecycle.model';
import { SafetyService } from '../services/safety.service';

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

  refreshInterval: any;
  refreshTime = 300000; // 5 phút
  rackWarningsRefreshInterval: any;
  rackWarningsRefreshTime = 14400000; // 4 tiếng

  constructor(private firestore: AngularFirestore, private safetyService: SafetyService, private cdr: ChangeDetectorRef) { }

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
      
      // Get current month and year for filtering
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth() + 1; // 1-12
      const currentYear = currentDate.getFullYear();
      
      console.log(`Loading work orders for factories: ${factoryFilter.join(', ')} for month ${currentMonth}/${currentYear}`);
      
      // Load work orders from database with monthly filter
      this.firestore.collection('work-orders').snapshotChanges().subscribe((actions) => {
        const workOrders = actions.map(a => {
          const data = a.payload.doc.data() as any;
          const id = a.payload.doc.id;
          return { id, ...data };
        });
        
        // Filter by factory AND current month/year
        this.workOrders = workOrders.filter(wo => {
          const woFactory = wo.factory || 'ASM1';
          const woMonth = wo.month || 1;
          const woYear = wo.year || currentYear;
          
          // Check factory match
          const factoryMatch = factoryFilter.includes(woFactory);
          
          // Check month/year match
          const monthYearMatch = woMonth === currentMonth && woYear === currentYear;
          
          return factoryMatch && monthYearMatch;
        });
        
        this.filteredWorkOrders = [...this.workOrders];
        
        console.log(`Loaded ${this.workOrders.length} work orders for ${this.selectedFactory} (${factoryFilter.join(', ')}) in ${currentMonth}/${currentYear}`);
        console.log('Work orders:', this.workOrders.map(wo => ({
          id: wo.id,
          productCode: wo.productCode,
          factory: wo.factory,
          status: wo.status,
          month: wo.month,
          year: wo.year,
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
    // Get current month and year for filtering
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1; // 1-12
    const currentYear = currentDate.getFullYear();
    
    console.log(`Loading shipment data for ${currentMonth}/${currentYear}`);
    
    // Keep existing shipment loading logic from Google Sheets
    fetch('https://docs.google.com/spreadsheets/d/1dGfJhDx-JNsFJ0l3kcz8uAHvMtm7GhPeAcUj8pBqx_Q/pub?gid=1580861382&single=true&output=csv')
      .then(res => res.text())
      .then(csv => {
        const rows = csv.split('\n').map(row => row.split(','));

        // Parse shipment data from CSV
        let totalShipments = 0;
        let completedShipments = 0;
        
        for (let cells of rows) {
          if (cells[0]?.trim().toLowerCase() === "shipment") {
            // Try to parse the shipment value as "completed/total" format
            const shipmentValue = cells[1]?.trim();
            if (shipmentValue && shipmentValue.includes('/')) {
              const parts = shipmentValue.split('/');
              completedShipments = parseInt(parts[0]) || 0;
              totalShipments = parseInt(parts[1]) || 0;
            } else {
              // Fallback to single value
              this.shipment = shipmentValue || "0/0";
            }
          }
        }
        
        // Set shipment display with monthly context
        this.shipment = `${completedShipments}/${totalShipments}`;
        console.log(`Shipment data for ${currentMonth}/${currentYear}: ${this.shipment} (completed/total)`);

        // Shipment Status (keep existing logic for next 7 days)
        this.shipmentStatus = [];
        for (let i = 31; i < rows.length; i++) {
          if (!rows[i] || !rows[i][0] || rows[i][0].trim() === '') break;
          if (rows[i][0].trim().toLowerCase() === 'ship date') continue;

          this.shipmentStatus.push({
            shipDate: rows[i][0]?.trim(),
            shipment: rows[i][1]?.trim(),
            customer: rows[i][2]?.trim(),
            carton: rows[i][3]?.trim(),
            statusDetail: rows[i][4]?.trim()
          });
        }
      })
      .catch(error => {
        console.error('Error loading shipment data:', error);
        // Fallback values
        this.shipment = "0/0";
      });
  }

  private createCharts() {
    // Cập nhật dữ liệu thực tế cho 3 box chart
    const months = ['May', 'Jun' , 'Jul', 'Aug', 'Sep', 'Oct'];
    const matAccuracy = [99.88, 99.9, 99.93, 99.80, 99.91, 99.87];
    const fgAccuracy = [100, 100, 100, 100, 100, 100];
    const fgTurnover = [1.33, 1.14, 1.48, 1.6, 1.15, 1.36];

    this.createChart('dailySalesChart', 'Materials Accuracy (%)', months, matAccuracy, '#4caf50', { min: 99, max: 100 });
    this.createChart('websiteViewsChart', 'Finished Goods Accuracy (%)', months, fgAccuracy, '#ff9800');
    this.createChart('completedTasksChart', 'FGs Inventory Turnover', months, fgTurnover, '#2196f3', { min: 0.5, max: 2 });
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

      // Load all materials with location = "IQC" (exact match)
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('location', '==', 'IQC')
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

        // Get import date
        let materialDate: Date;
        if (data.importDate) {
          if (data.importDate.toDate) {
            materialDate = data.importDate.toDate();
          } else if (data.importDate instanceof Date) {
            materialDate = data.importDate;
          } else if (data.importDate.seconds) {
            materialDate = new Date(data.importDate.seconds * 1000);
          } else {
            materialDate = new Date(data.importDate);
          }
        } else {
          // If no importDate, skip this material
          return;
        }

        // Find which week this material belongs to
        for (const week of weeks) {
          if (materialDate >= week.startDate && materialDate <= week.endDate) {
            // Create unique key: materialCode_PO_IMD
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

}
