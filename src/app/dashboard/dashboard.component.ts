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
      const currentDate = new Date();
      const currentYear = currentDate.getFullYear();
      const currentMonth = currentDate.getMonth() + 1;
      
      // Get work orders for selected factory (ASM1 or ASM2) and Sample factories
      const factoryFilter = this.selectedFactory === 'ASM1' ? ['ASM1', 'Sample 1'] : ['ASM2', 'Sample 2'];
      
      console.log(`Loading work orders for factories: ${factoryFilter.join(', ')}`);
      
      this.firestore.collection('work-orders', ref => 
        ref.where('year', '==', currentYear)
           .where('month', '==', currentMonth)
      ).valueChanges().subscribe((workOrders: any[]) => {
        // Filter by factory
        this.workOrders = workOrders.filter(wo => {
          const woFactory = wo.factory || 'ASM1';
          return factoryFilter.includes(woFactory);
        });
        
        this.filteredWorkOrders = [...this.workOrders];
        
        console.log(`Loaded ${this.workOrders.length} work orders for ${this.selectedFactory} (${factoryFilter.join(', ')})`);
        console.log('Work orders:', this.workOrders.map(wo => ({
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
    // Keep existing shipment loading logic
    fetch('https://docs.google.com/spreadsheets/d/1dGfJhDx-JNsFJ0l3kcz8uAHvMtm7GhPeAcUj8pBqx_Q/pub?gid=1580861382&single=true&output=csv')
      .then(res => res.text())
      .then(csv => {
        const rows = csv.split('\n').map(row => row.split(','));

        for (let cells of rows) {
          if (cells[0]?.trim().toLowerCase() === "shipment") this.shipment = cells[1]?.trim();
        }

        // Shipment Status (keep existing)
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
    
    console.log('📅 Current week initialized:', this.currentWeekDates.map(d => d.toLocaleDateString('vi-VN')));
  }

  private loadSafetyData() {
    this.safetyService.getSafetyMaterials().subscribe(materials => {
      if (materials.length > 0) {
        // Find the latest update date
        const latestDate = materials.reduce((latest, material) => {
          const materialDate = material.updatedAt ? new Date(material.updatedAt) : new Date(material.scanDate);
          return materialDate > latest ? materialDate : latest;
        }, new Date(0));
        
        this.latestUpdateDate = latestDate;
        console.log('📊 Latest update date from Safety:', this.latestUpdateDate.toLocaleDateString('vi-VN'));
        
        this.updateWeekdayColors();
      }
    });
  }

  private updateWeekdayColors() {
    if (!this.latestUpdateDate) return;
    
    const today = new Date();
    const currentDay = today.getDay();
    
    this.weekdays.forEach((weekday, index) => {
      if (!weekday.date) return;
      
      const weekdayDate = weekday.date;
      const isLatestUpdate = this.isSameDate(weekdayDate, this.latestUpdateDate!);
      const isInventoryDay = index === 1 || index === 5; // Tuesday (index 1) and Saturday (index 5)
      
      // Reset flags and status
      weekday.hasFlag = false;
      weekday.status = 'unknown';
      
      // Check if this is a late day (past due date)
      const isLate = weekdayDate < today && !this.isSameDate(weekdayDate, today);
      
      // Apply status logic based on the image interface
      if (index === 1) { // Tuesday - Inventory day
        if (isLate) {
          weekday.status = 'late'; // Red for late Tuesday
          // No flag, keep weekday name visible
        } else {
          weekday.status = 'inventory'; // Orange for normal Tuesday
        }
      } else if (index === 5) { // Saturday - Inventory day
        weekday.status = 'inventory'; // Always orange for Saturday
      } else {
        // Other days (Monday, Wednesday, Thursday, Friday) - Regular days
        if (isLatestUpdate) {
          weekday.status = 'scan-day'; // Blue for scan day
        } else {
          weekday.status = 'regular'; // White for regular days
        }
      }
      
      // Add today class
      if (this.isSameDate(weekdayDate, today)) {
        weekday.isToday = true;
      }
    });
    
    console.log('🎨 Weekday status updated:', this.weekdays.map(w => ({ name: w.name, status: w.status, isToday: w.isToday, hasFlag: w.hasFlag })));
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

  // Test method to force refresh weekday colors
  testRefreshWeekdayColors() {
    console.log('🧪 Testing weekday colors refresh...');
    this.latestUpdateDate = new Date(); // Use today as latest update
    this.updateWeekdayColors();
  }
}
