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

  refreshInterval: any;
  refreshTime = 300000; // 5 phút

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
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    const matAccuracy = [99.76, 99.86, 99.85, 99.88, 99.9, 99.93];
    const fgAccuracy = [100, 100, 100, 100, 100, 100];
    const fgTurnover = [0.8, 0.88, 1.21, 1.33, 1.14, 1.48];

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
  }

}
