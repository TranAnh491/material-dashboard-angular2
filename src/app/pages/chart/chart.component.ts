import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { SafetyService } from '../../services/safety.service';

export interface SafetyMaterial {
  id?: string;
  materialCode: string;
  materialName: string;
  scanDate: Date;
  quantityASM1: number;
  palletQuantityASM1: number;
  palletCountASM1: number;
  quantityASM2: number;
  palletQuantityASM2: number;
  palletCountASM2: number;
  totalQuantity: number;
  totalPalletCount: number;
  safety: number;
  status: string;
  createdAt?: Date;
  updatedAt?: Date;
}

@Component({
  selector: 'app-chart',
  templateUrl: './chart.component.html',
  styleUrls: ['./chart.component.scss']
})
export class ChartComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  
     // Weekday data
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
  
  constructor(private safetyService: SafetyService) {}
  
  ngOnInit() {
    this.initializeCurrentWeek();
    this.loadSafetyData();
  }
  
  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
  
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

  getDayOfMonth(date: Date | null): string {
    if (!date) return '';
    return date.getDate().toString();
  }

  getMonth(date: Date | null): string {
    if (!date) return '';
    return (date.getMonth() + 1).toString().padStart(2, '0');
  }
  
  refreshData() {
    this.initializeCurrentWeek();
    this.loadSafetyData();
  }
}
