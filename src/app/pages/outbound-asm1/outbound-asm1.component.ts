import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import * as XLSX from 'xlsx';
import { Html5Qrcode } from 'html5-qrcode';
import { FactoryAccessService } from '../../services/factory-access.service';


export interface OutboundMaterial {
  id?: string;
  factory?: string;
  materialCode: string;
  poNumber: string;
  quantity: number;
  unit: string;
  exportQuantity: number;
  exportDate: Date;
  location: string;
  exportedBy: string;
  batch?: string;
  scanMethod?: string;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
  productionOrder?: string; // Lệnh sản xuất
  employeeId?: string; // Mã nhân viên

}

@Component({
  selector: 'app-outbound-asm1',
  templateUrl: './outbound-asm1.component.html',
  styleUrls: ['./outbound-asm1.component.scss']
})
export class OutboundASM1Component implements OnInit, OnDestroy {
  materials: OutboundMaterial[] = [];
  filteredMaterials: OutboundMaterial[] = [];
  selectedFactory: string = 'ASM1';
  currentPage: number = 1;
  itemsPerPage: number = 50;
  totalPages: number = 1;
  isLoading: boolean = false;
  errorMessage: string = '';
  private destroy$ = new Subject<void>();
  
  // QR Scanner properties
  isCameraScanning: boolean = false;
  isScannerLoading: boolean = false;
  scanner: Html5Qrcode | null = null;
  lastScannedData: any = null;
  exportQuantity: number = 0;
  
  // Physical Scanner properties
  isScannerInputActive: boolean = false;
  scannerBuffer: string = '';
  scannerTimeout: any = null;
  scanStartTime: number = 0;
  
  // Batch Scanning Mode properties
  isBatchScanningMode: boolean = false;
  batchProductionOrder: string = '';
  batchEmployeeId: string = '';
  isProductionOrderScanned: boolean = false;
  isEmployeeIdScanned: boolean = false;
  
  // Date Range properties
  startDate: string = '';
  endDate: string = '';
  showOnlyToday: boolean = true;
  
  // Auto-hide previous day's scan history
  hidePreviousDayHistory: boolean = true;
  
  // Dropdown management
  isDropdownOpen: boolean = false;
  
  // REMOVED: inventoryMaterials - Không cần tính stock để scan nhanh
  
  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private factoryAccessService: FactoryAccessService,
    private cdr: ChangeDetectorRef
  ) {}
  
  ngOnInit(): void {
    console.log('🏭 Outbound ASM1 component initialized');
    this.setupDefaultDateRange();
    this.loadMaterials();
    // REMOVED: loadInventoryMaterials() - Không cần tính stock để scan nhanh
    
    // Add click outside listener to close dropdown
    document.addEventListener('click', this.onDocumentClick.bind(this));
  }
  
  private setupDefaultDateRange(): void {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Default to show only today's data
    this.startDate = today.toISOString().split('T')[0];
    this.endDate = today.toISOString().split('T')[0];
    this.showOnlyToday = true;
    this.hidePreviousDayHistory = true;
    
    console.log('📅 Date range set to:', { startDate: this.startDate, endDate: this.endDate, showOnlyToday: this.showOnlyToday, hidePreviousDayHistory: this.hidePreviousDayHistory });
  }
  
  onDateRangeChange(): void {
    console.log('📅 Date range changed:', { startDate: this.startDate, endDate: this.endDate });
    
    // Check if showing only today
    const today = new Date().toISOString().split('T')[0];
    this.showOnlyToday = (this.startDate === today && this.endDate === today);
    
    // Auto-hide previous day's history when user selects today
    if (this.showOnlyToday) {
      this.hidePreviousDayHistory = true;
      console.log('📅 User selected today, automatically hiding previous day\'s history');
    }
    
    // Reload materials with new date filter
    this.loadMaterials();
  }
  
  // Toggle auto-hide previous day's scan history
  toggleHidePreviousDayHistory(): void {
    this.hidePreviousDayHistory = !this.hidePreviousDayHistory;
    console.log(`📅 Auto-hide previous day's scan history: ${this.hidePreviousDayHistory ? 'ON' : 'OFF'}`);
    this.loadMaterials();
  }
  
  // Reset to today's date
  resetToToday(): void {
    const today = new Date();
    this.startDate = today.toISOString().split('T')[0];
    this.endDate = today.toISOString().split('T')[0];
    this.hidePreviousDayHistory = true;
    console.log('📅 Reset to today\'s date and hide previous day\'s history');
    this.loadMaterials();
  }
  
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    
    // Cleanup scanner
    if (this.scanner) {
      this.scanner.stop().catch(console.error);
    }
    
    // Remove click outside listener
    document.removeEventListener('click', this.onDocumentClick.bind(this));
  }
  
  // Dropdown methods
  toggleDropdown(): void {
    this.isDropdownOpen = !this.isDropdownOpen;
    this.cdr.detectChanges();
  }
  
  closeDropdown(): void {
    this.isDropdownOpen = false;
    this.cdr.detectChanges();
  }
  
  onDocumentClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.dropdown')) {
      this.closeDropdown();
    }
  }
  

  
  loadMaterials(): void {
    this.isLoading = true;
    this.errorMessage = '';
    console.log('📦 Loading ASM1 outbound materials with real-time listener...');
    
    // Use real-time listener to automatically update when data changes
    this.firestore.collection('outbound-materials', ref => 
      ref.limit(1000)
    ).snapshotChanges()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        console.log(`🔍 Real-time update from outbound-materials contains ${snapshot.length} documents`);
        
        // Filter for ASM1 factory and sort client-side
        const allMaterials = snapshot.map(doc => {
          const data = doc.payload.doc.data() as any;
          console.log(`📦 Processing doc ${doc.payload.doc.id}, factory: ${data.factory}`);
          return {
            id: doc.payload.doc.id,
            factory: data.factory || 'ASM1',
            materialCode: data.materialCode || '',
            poNumber: data.poNumber || '',
            quantity: data.quantity || 0,
            unit: data.unit || '',
            exportQuantity: data.exportQuantity || 0,
            exportDate: data.exportDate?.toDate() || new Date(),
            location: data.location || '',
            exportedBy: data.exportedBy || '',
                         employeeId: data.employeeId || '', // Fix: properly map employeeId
             productionOrder: data.productionOrder || '', // Fix: properly map productionOrder
             
            scanMethod: data.scanMethod || 'MANUAL',
            notes: data.notes || '',
            createdAt: data.createdAt?.toDate() || data.createdDate?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || data.lastUpdated?.toDate() || new Date()
          } as OutboundMaterial;
        });
        
        console.log(`🏭 All materials before filter: ${allMaterials.length}`);
        console.log(`🏭 Factory values found:`, allMaterials.map(m => m.factory));
        
        this.materials = allMaterials
          .filter(material => material.factory === 'ASM1')
          .filter(material => {
            // Auto-hide previous day's scan history
            if (this.hidePreviousDayHistory) {
              const today = new Date();
              today.setHours(0, 0, 0, 0); // Start of today
              
              const exportDate = new Date(material.exportDate);
              exportDate.setHours(0, 0, 0, 0); // Start of export date
              
              // Hide records from previous days
              if (exportDate < today) {
                return false;
              }
            }
            
            // Filter by date range if specified
            if (this.startDate && this.endDate) {
              const exportDate = material.exportDate.toISOString().split('T')[0];
              return exportDate >= this.startDate && exportDate <= this.endDate;
            }
            return true;
          });
        
        // Consolidate records by same date + material code + PO
        this.materials = this.consolidateOutboundRecords(this.materials);
        
        // Sort by latest scan first (newest first)
        this.materials.sort((a, b) => {
          // Sort by latest updated time first (newest first)
          const updatedCompare = b.updatedAt.getTime() - a.updatedAt.getTime();
          if (updatedCompare !== 0) return updatedCompare;
          
          // If same updated time, sort by export date (newest first)
          const dateCompare = b.exportDate.getTime() - a.exportDate.getTime();
          if (dateCompare !== 0) return dateCompare;
          
          // If same date, sort by creation time (newest first)
          return b.createdAt.getTime() - a.createdAt.getTime();
        });
        
        console.log(`✅ ASM1 materials after filter: ${this.materials.length}`);
        
        // Log filter information
        if (this.hidePreviousDayHistory) {
          console.log(`📅 Previous day's scan history is hidden`);
        }
        console.log(`🔍 Filter applied: ${this.materials.length}/${allMaterials.filter(m => m.factory === 'ASM1').length} ASM1 records shown`);
        
        this.filteredMaterials = [...this.materials];
        this.updatePagination();
        this.isLoading = false;
        
        console.log(`✅ Final filtered materials: ${this.filteredMaterials.length}`);
        
        // Force change detection to update UI
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('❌ Error loading ASM1 outbound materials:', error);
        this.errorMessage = 'Lỗi khi tải dữ liệu: ' + error.message;
        this.isLoading = false;
      }
    });
  }
  
  // Load inventory materials để lấy số tồn kho chính xác
  loadInventoryMaterials(): void {
    console.log('📦 Loading ASM1 inventory materials for stock calculation with real-time listener...');
    console.log(`🔍 Query: factory == '${this.selectedFactory}', limit: 5000`);
    
    this.firestore.collection('inventory-materials', ref => 
      ref.where('factory', '==', this.selectedFactory)
         .limit(5000) // Tăng limit để lấy nhiều dữ liệu hơn
    ).snapshotChanges()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        console.log(`📦 Raw snapshot from Firebase: ${snapshot.length} documents`);
        
        // REMOVED: inventoryMaterials loading - Không cần tính stock để scan nhanh
      },
      error: (error) => {
        console.error('❌ Error loading inventory materials:', error);
        console.log('⚠️ Will use fallback calculation method');
      }
    });
  }
  

  
  updatePagination(): void {
    this.totalPages = Math.ceil(this.filteredMaterials.length / this.itemsPerPage);
    if (this.currentPage > this.totalPages) { this.currentPage = 1; }
  }
  
  getPaginatedMaterials(): OutboundMaterial[] {
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    return this.filteredMaterials.slice(startIndex, endIndex);
  }
  

  
  onExportDateChange(event: any, material: OutboundMaterial): void {
    const target = event.target as HTMLInputElement;
    if (target.value) {
      // Xử lý datetime-local input
      const [datePart, timePart] = target.value.split('T');
      if (datePart && timePart) {
        const [year, month, day] = datePart.split('-').map(Number);
        const [hour, minute] = timePart.split(':').map(Number);
        material.exportDate = new Date(year, month - 1, day, hour, minute);
      } else {
        material.exportDate = new Date(target.value);
      }
    } else {
      material.exportDate = new Date();
    }
    this.updateMaterial(material);
  }
  

  
  goToPage(page: number): void { if (page >= 1 && page <= this.totalPages) { this.currentPage = page; } }
  previousPage(): void { if (this.currentPage > 1) { this.currentPage--; } }
  nextPage(): void { if (this.currentPage < this.totalPages) { this.currentPage++; } }
  
  async addMaterial(): Promise<void> {
    const newMaterial: OutboundMaterial = {
      factory: 'ASM1',
      materialCode: '',
      poNumber: '',
      quantity: 0,
      unit: '',
      exportQuantity: 0,
      exportDate: new Date(),
      location: '',
      exportedBy: '',
      employeeId: '',
      productionOrder: '',
      
      scanMethod: 'MANUAL',
      notes: '',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    try {
      await this.firestore.collection('outbound-materials').add(newMaterial);
      console.log('✅ ASM1 outbound material added');
      this.loadMaterials();
    } catch (error) {
      console.error('❌ Error adding ASM1 outbound material:', error);
      this.errorMessage = 'Lỗi thêm material: ' + error.message;
    }
  }
  
  async updateMaterial(material: OutboundMaterial): Promise<void> {
    if (!material.id) return;
    try {
      material.updatedAt = new Date();
      material.factory = 'ASM1';
      await this.firestore.collection('outbound-materials').doc(material.id).update(material);
      console.log('✅ ASM1 outbound material updated:', material.materialCode);
    } catch (error) {
      console.error('❌ Error updating ASM1 outbound material:', error);
      this.errorMessage = 'Lỗi cập nhật: ' + error.message;
    }
  }
  
  async deleteMaterial(material: OutboundMaterial): Promise<void> {
    if (!material.id) return;
    if (!confirm(`Xóa outbound material ${material.materialCode}?`)) return;
    try {
      await this.firestore.collection('outbound-materials').doc(material.id).delete();
      console.log('✅ ASM1 outbound material deleted:', material.materialCode);
      this.loadMaterials();
    } catch (error) {
      console.error('❌ Error deleting ASM1 outbound material:', error);
      this.errorMessage = 'Lỗi xóa: ' + error.message;
    }
  }
  
  exportToExcel(): void {
    try {
      console.log('📊 Exporting ASM1 outbound data to Excel...');
      
             // Optimize data for smaller file size
       const exportData = this.filteredMaterials.map(material => ({
         'Factory': material.factory || 'ASM1',
         'Material': material.materialCode || '',
         'PO': material.poNumber || '',
         'Qty': material.quantity || 0,
         'Unit': material.unit || '',
         'Export Qty': material.exportQuantity || 0,
         'Ngày xuất': material.exportDate ? material.exportDate.toLocaleString('vi-VN') : '',
         'Location': material.location || '',
         'Employee ID': material.employeeId || '',
         'Production Order': material.productionOrder || '',
         'Method': material.scanMethod || 'MANUAL'
       }));
      
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      
             // Set column widths for better readability
       const colWidths = [
         { wch: 8 },   // Factory
         { wch: 15 },  // Material
         { wch: 12 },  // PO
         { wch: 8 },   // Qty
         { wch: 6 },   // Unit
         { wch: 10 },  // Export Qty
         { wch: 18 },  // Ngày xuất
         { wch: 12 },  // Location
         { wch: 12 },  // Employee ID
         { wch: 18 },  // Production Order
         { wch: 8 }    // Method
       ];
      worksheet['!cols'] = colWidths;
      
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'ASM1_Outbound');
      
      const fileName = `ASM1_Outbound_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      
      console.log('✅ ASM1 outbound data exported to Excel');
      alert(`✅ Đã xuất ${exportData.length} records ra file Excel`);
    } catch (error) {
      console.error('❌ Export error:', error);
      this.errorMessage = 'Lỗi export: ' + error.message;
      alert('❌ Lỗi export: ' + error.message);
    }
  }

  // Download report without complex Firebase queries
  async downloadReport(): Promise<void> {
    try {
      const reportType = prompt(
        'Chọn loại báo cáo:\n' +
        '1 - Xuất dữ liệu hiện tại (nhanh)\n' +
        '2 - Xuất theo khoảng thời gian (chậm hơn)\n' +
        'Nhập 1 hoặc 2:',
        '1'
      );
      
      if (!reportType) return;
      
      if (reportType === '1') {
        // Option 1: Export current filtered data (fast)
        this.exportToExcel();
        return;
      }
      
      if (reportType === '2') {
        // Option 2: Export by date range (slower but more data)
        const startDate = prompt('Nhập ngày bắt đầu (YYYY-MM-DD):', this.startDate);
        const endDate = prompt('Nhập ngày kết thúc (YYYY-MM-DD):', this.endDate);
        
        if (!startDate || !endDate) return;
        
        console.log('📊 Downloading report for date range:', startDate, 'to', endDate);
        
        // Use simple query without complex where/orderBy to avoid index issues
        const querySnapshot = await this.firestore.collection('outbound-materials', ref =>
          ref.limit(5000) // Increased limit for more data
        ).get().toPromise();
        
        if (!querySnapshot || querySnapshot.empty) {
          alert('Không có dữ liệu để xuất');
          return;
        }
        
        // Filter client-side to avoid Firebase index requirements
        const allData = querySnapshot.docs.map(doc => {
          const data = doc.data() as any;
          return {
            id: doc.id,
            factory: data.factory || '',
            materialCode: data.materialCode || '',
            poNumber: data.poNumber || '',
            quantity: data.quantity || 0,
            unit: data.unit || '',
            exportQuantity: data.exportQuantity || 0,
            exportDate: data.exportDate?.toDate() || new Date(),
            location: data.location || '',
            exportedBy: data.exportedBy || '',
            employeeId: data.employeeId || '',
            productionOrder: data.productionOrder || '',
            scanMethod: data.scanMethod || 'MANUAL',
            notes: data.notes || ''
          };
        });
        
        // Filter by factory and date range
        const filteredData = allData.filter(item => {
          if (item.factory !== 'ASM1') return false;
          
          const itemDate = item.exportDate.toISOString().split('T')[0];
          return itemDate >= startDate && itemDate <= endDate;
        });
        
        if (filteredData.length === 0) {
          alert(`Không có dữ liệu ASM1 trong khoảng thời gian ${startDate} đến ${endDate}`);
          return;
        }
        
        // Sort by date
        filteredData.sort((a, b) => a.exportDate.getTime() - b.exportDate.getTime());
        
        // Export to Excel
        const exportData = filteredData.map(item => ({
          'Factory': item.factory,
          'Material': item.materialCode,
          'PO': item.poNumber,
          'Qty': item.quantity,
          'Unit': item.unit,
          'Export Qty': item.exportQuantity,
          'Date': item.exportDate.toLocaleDateString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit'
          }),
          'Location': item.location,
          'Employee ID': item.employeeId || '',
          'Production Order': item.productionOrder || '',
          'Method': item.scanMethod
        }));
        
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        
        // Set column widths
        const colWidths = [
          { wch: 8 }, { wch: 15 }, { wch: 12 }, { wch: 8 }, { wch: 6 },
          { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 8 }
        ];
        worksheet['!cols'] = colWidths;
        
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, `ASM1_Outbound_${startDate}_${endDate}`);
        
        const fileName = `ASM1_Outbound_Report_${startDate}_${endDate}.xlsx`;
        XLSX.writeFile(workbook, fileName);
        
        console.log(`✅ Date range report downloaded: ${fileName}`);
        alert(`✅ Đã tải báo cáo: ${filteredData.length} records\nFile: ${fileName}`);
      }
      
    } catch (error) {
      console.error('❌ Error downloading report:', error);
      alert('Lỗi tải báo cáo: ' + error.message);
    }
  }
  
  // Cleanup old data (move to archive or delete)
  async cleanupData(): Promise<void> {
    try {
      const confirmCleanup = confirm(
        '⚠️ CẢNH BÁO: Thao tác này sẽ xóa dữ liệu cũ trên Firebase!\n\n' +
        'Dữ liệu sẽ được tải về trước khi xóa.\n' +
        'Bạn có chắc chắn muốn tiếp tục?'
      );
      
      if (!confirmCleanup) return;
      
      // Get cutoff date (e.g., 30 days ago)
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);
      
      console.log('🧹 Starting data cleanup, cutoff date:', cutoffDate);
      
      // Get old data for backup
      const oldDataQuery = await this.firestore.collection('outbound-materials', ref =>
        ref.where('factory', '==', 'ASM1')
           .where('exportDate', '<', cutoffDate)
      ).get().toPromise();
      
      if (!oldDataQuery || oldDataQuery.empty) {
        alert('Không có dữ liệu cũ để dọn dẹp');
        return;
      }
      
      // Backup old data to Excel
      const oldData = oldDataQuery.docs.map(doc => {
        const data = doc.data() as any;
        return {
          'ID': doc.id,
          'Factory': data.factory,
          'Material Code': data.materialCode,
          'PO Number': data.poNumber,
          'Quantity': data.quantity,
          'Unit': data.unit,
          'Export Quantity': data.exportQuantity,
          'Export Date': data.exportDate?.toDate().toLocaleDateString('vi-VN') || '',
          'Location': data.location,
          'Exported By': data.exportedBy,
          'Employee ID': data.employeeId || '',
          'Production Order': data.productionOrder || '',
          'Scan Method': data.scanMethod,
          'Notes': data.notes
        };
      });
      
      // Save backup
      const worksheet = XLSX.utils.json_to_sheet(oldData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Old_Data_Backup');
      const backupFileName = `ASM1_Outbound_Backup_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, backupFileName);
      
      console.log(`✅ Backup saved: ${backupFileName}`);
      
      // Delete old data
      const deletePromises = oldDataQuery.docs.map(doc => doc.ref.delete());
      await Promise.all(deletePromises);
      
      console.log(`✅ Deleted ${oldDataQuery.docs.length} old records`);
      
      // Reload data
      this.loadMaterials();
      
      alert(`✅ Dọn dẹp hoàn tất!\n\n` +
            `📁 Backup: ${backupFileName}\n` +
            `🗑️ Đã xóa: ${oldDataQuery.docs.length} records cũ\n` +
            `📅 Dữ liệu trước: ${cutoffDate.toLocaleDateString('vi-VN')}`);
      
    } catch (error) {
      console.error('❌ Error during data cleanup:', error);
      alert('Lỗi dọn dẹp dữ liệu: ' + error.message);
    }
  }
  
  formatDate(date: Date | null): string { if (!date) return ''; return date.toLocaleDateString('vi-VN'); }
  formatDateTime(date: Date | null): string { if (!date) return ''; return date.toLocaleString('vi-VN'); }
  
  // Camera QR Scanner methods
  async startCameraScanning(): Promise<void> {
    try {
      console.log('🎯 Starting QR scanner for Outbound ASM1...');
      this.isScannerLoading = true;
      this.errorMessage = '';
      this.lastScannedData = null;
      this.exportQuantity = 0;
      
      // Show modal first, then wait for DOM element
      this.isCameraScanning = true;
      this.cdr.detectChanges(); // Force change detection to render modal
      
      // Wait for DOM element to be available after modal renders
      await this.waitForElement('qr-reader');
      
      // Initialize scanner
      this.scanner = new Html5Qrcode("qr-reader");
      
      const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0
      };
      
      await this.scanner.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
          console.log('📱 QR Code scanned:', decodedText);
          this.onScanSuccess(decodedText);
        },
        (errorMessage) => {
          // Silent error handling for scanning attempts
        }
      );
      
      // Scanner started successfully
      this.isScannerLoading = false;
      console.log('✅ Scanner started successfully');
      
    } catch (error) {
      console.error('❌ Error starting scanner:', error);
      
      let errorMsg = 'Không thể khởi động scanner';
      if (error?.message) {
        if (error.message.includes('not found')) {
          errorMsg = 'Không tìm thấy camera hoặc element scanner';
        } else if (error.message.includes('Permission')) {
          errorMsg = 'Vui lòng cấp quyền truy cập camera';
        } else {
          errorMsg = error.message;
        }
      }
      
      this.errorMessage = 'Lỗi scanner: ' + errorMsg;
      this.isCameraScanning = false;
      this.isScannerLoading = false;
      
      // Show user alert
      alert('❌ ' + errorMsg + '\n\nVui lòng:\n1. Cấp quyền camera\n2. Sử dụng HTTPS\n3. Thử lại');
    }
  }
  
  private async waitForElement(elementId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 20; // 2 seconds max wait
      
      const checkElement = () => {
        const element = document.getElementById(elementId);
        if (element) {
          console.log('✅ Found element:', elementId);
          resolve();
        } else if (attempts >= maxAttempts) {
          reject(new Error(`Element with id="${elementId}" not found after ${maxAttempts} attempts`));
        } else {
          attempts++;
          setTimeout(checkElement, 100); // Check every 100ms
        }
      };
      
      // Start checking immediately
      checkElement();
    });
  }
  
  async stopScanning(): Promise<void> {
    if (this.scanner) {
      try {
        await this.scanner.stop();
        console.log('✅ Camera scanner stopped');
      } catch (error) {
        console.error('❌ Error stopping camera scanner:', error);
      }
      this.scanner = null;
    }
    
    // Reset all scanner states
    this.isCameraScanning = false;
    this.isScannerLoading = false;
    this.isScannerInputActive = false;
    this.lastScannedData = null;
    this.exportQuantity = 0;
    this.scannerBuffer = '';
    
    console.log('✅ All scanner states reset');
  }
  
  private onScanSuccess(decodedText: string): void {
    try {
      console.log('🔍 Processing scanned QR data:', decodedText);
      
      // Parse QR data format: "MaterialCode|PONumber|Quantity"
      const parts = decodedText.split('|');
      if (parts.length >= 3) {
        this.lastScannedData = {
          materialCode: parts[0].trim(),
          poNumber: parts[1].trim(),
          quantity: parseInt(parts[2]) || 0
        };
        
        console.log('✅ Parsed QR data (pipe format):', this.lastScannedData);
        
        // Set default export quantity to full quantity
        this.exportQuantity = this.lastScannedData.quantity;
        
      } else if (decodedText.includes(',')) {
        // Try comma-separated format: "MaterialCode,PONumber,Quantity"
        const commaParts = decodedText.split(',');
        if (commaParts.length >= 3) {
          this.lastScannedData = {
            materialCode: commaParts[0].trim(),
            poNumber: commaParts[1].trim(),
            quantity: parseInt(commaParts[1]) || 0
          };
          
          console.log('✅ Parsed QR data (comma format):', this.lastScannedData);
          this.exportQuantity = this.lastScannedData.quantity;
        } else {
          throw new Error('Invalid comma format');
        }
      } else {
        // Try JSON format as fallback
        try {
          const jsonData = JSON.parse(decodedText);
          if (jsonData.materialCode && jsonData.poNumber) {
            this.lastScannedData = {
              materialCode: jsonData.materialCode.toString().trim(),
              poNumber: jsonData.poNumber.toString().trim(),
              quantity: parseInt(jsonData.quantity) || parseInt(jsonData.unitNumber) || 0
            };
            
            console.log('✅ Parsed QR data (JSON format):', this.lastScannedData);
            this.exportQuantity = this.lastScannedData.quantity;
          } else {
            throw new Error('Missing required fields in JSON');
          }
        } catch (jsonError) {
          // If all parsing methods fail, try to extract any recognizable pattern
          console.log('🔍 Trying pattern extraction from:', decodedText);
          
          // Look for common patterns like "B018694" (material code)
          const materialCodeMatch = decodedText.match(/[A-Z]\d{6,}/);
          const poMatch = decodedText.match(/PO\d+|P\d+/i);
          const numberMatch = decodedText.match(/\d+/);
          
          if (materialCodeMatch && poMatch && numberMatch) {
            this.lastScannedData = {
              materialCode: materialCodeMatch[0],
              poNumber: poMatch[0],
              quantity: parseInt(numberMatch[0]) || 0
            };
            
            console.log('✅ Parsed QR data (pattern extraction):', this.lastScannedData);
            this.exportQuantity = this.lastScannedData.quantity;
          } else {
            throw new Error('Could not extract material information from QR code');
          }
        }
      }
      
      // Validate parsed data
      if (!this.lastScannedData.materialCode || !this.lastScannedData.poNumber || this.lastScannedData.quantity <= 0) {
        throw new Error('Invalid material data: missing code, PO, or quantity');
      }
      
      console.log('✅ Final parsed data:', this.lastScannedData);
      console.log('✅ Export quantity set to:', this.exportQuantity);
      
      // Auto-export immediately after successful scan
      this.autoExportScannedMaterial();
      
    } catch (error) {
      console.error('❌ Error parsing QR data:', error);
      console.error('❌ Raw QR data was:', decodedText);
      alert(`QR code không hợp lệ: ${error.message}\n\nDữ liệu quét được: ${decodedText}\n\nVui lòng quét QR code từ hệ thống hoặc kiểm tra format.`);
    }
  }
  
  // Consolidate outbound records by ALL 4 fields: material code + PO + employee ID + production order (LSX)
  private consolidateOutboundRecords(materials: OutboundMaterial[]): OutboundMaterial[] {
    const consolidatedMap = new Map<string, OutboundMaterial>();
    
    materials.forEach(material => {
      // Create key: materialCode + poNumber + employeeId + productionOrder
      // Chỉ gộp khi CẢ 4 thông tin giống hệt nhau
      const key = `${material.materialCode}_${material.poNumber}_${material.employeeId || 'NO_EMPLOYEE'}_${material.productionOrder || 'NO_LSX'}`;
      
      if (consolidatedMap.has(key)) {
        // Merge with existing record - chỉ khi 4 thông tin giống hệt
        const existing = consolidatedMap.get(key)!;
        existing.exportQuantity += material.exportQuantity;
        existing.quantity = Math.max(existing.quantity, material.quantity); // Keep max quantity
        existing.updatedAt = new Date(Math.max(existing.updatedAt.getTime(), material.updatedAt.getTime()));
        existing.createdAt = new Date(Math.min(existing.createdAt.getTime(), material.createdAt.getTime())); // Keep earliest creation
        
        // Ghi chú về việc gộp
        const oldQuantity = existing.exportQuantity - material.exportQuantity;
        existing.notes = `Gộp từ ${oldQuantity} + ${material.exportQuantity} = ${existing.exportQuantity} - ${material.notes || 'Auto-scanned export'}`;
        
        console.log(`🔄 Merged outbound record: ${material.materialCode} - PO: ${material.poNumber} - Employee: ${material.employeeId} - LSX: ${material.productionOrder}`);
        
      } else {
        // New record - tạo dòng mới khi có bất kỳ thông tin nào khác nhau
        consolidatedMap.set(key, { ...material });
        console.log(`➕ New outbound record: ${material.materialCode} - PO: ${material.poNumber} - Employee: ${material.employeeId} - LSX: ${material.productionOrder}`);
      }
    });
    
    console.log(`🔄 Consolidated ${materials.length} records into ${consolidatedMap.size} unique entries`);
    console.log(`📊 Consolidation rule: Only merge when ALL 4 fields match (Material + PO + Employee + LSX)`);
    
    return Array.from(consolidatedMap.values());
  }

  // Create new outbound record
  private async createNewOutboundRecord(exportedBy: string): Promise<void> {
    const outboundRecord: OutboundMaterial = {
      factory: 'ASM1',
      materialCode: this.lastScannedData.materialCode,
      poNumber: this.lastScannedData.poNumber,
      quantity: this.lastScannedData.quantity,
      unit: 'KG', // Default unit
      exportQuantity: this.exportQuantity,
      exportDate: new Date(),
      location: '',
      exportedBy: exportedBy,
      employeeId: exportedBy, // Use exportedBy as employeeId for now
      productionOrder: '', // Empty for manual scans
      scanMethod: 'QR_SCANNER',
      notes: `Auto-scanned export - Original: ${this.lastScannedData.quantity}, Exported: ${this.exportQuantity}`,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    console.log('📝 Creating new outbound record:', outboundRecord);
    
    // Add to outbound collection
    console.log('🔥 Adding to Firebase collection: outbound-materials');
    const docRef = await this.firestore.collection('outbound-materials').add(outboundRecord);
    console.log('✅ New outbound record created with ID:', docRef.id);
  }

  // Auto-export method that runs immediately after scan
  private async autoExportScannedMaterial(): Promise<void> {
    if (!this.lastScannedData || !this.exportQuantity || this.exportQuantity <= 0) {
      console.log('❌ Auto-export validation failed:', { lastScannedData: this.lastScannedData, exportQuantity: this.exportQuantity });
      return;
    }
    
    try {
      console.log('🚀 Auto-exporting scanned material...');
      console.log('📊 Scanned data:', this.lastScannedData);
      console.log('📊 Export quantity:', this.exportQuantity);
      
      // Get current user
      const user = await this.afAuth.currentUser;
      const exportedBy = user ? (user.email || user.uid) : 'SCANNER_USER';
      console.log('👤 Current user:', exportedBy);
      
      // Check if record with same date + material code + PO already exists
      const today = new Date().toISOString().split('T')[0];
      const existingRecordQuery = await this.firestore.collection('outbound-materials', ref => 
        ref.where('factory', '==', 'ASM1')
           .where('materialCode', '==', this.lastScannedData.materialCode)
           .where('poNumber', '==', this.lastScannedData.poNumber)
           .limit(1)
      ).get().toPromise();
      
      if (existingRecordQuery && !existingRecordQuery.empty) {
        // Update existing record
        const existingDoc = existingRecordQuery.docs[0];
        const existingData = existingDoc.data() as any;
        const existingDate = (existingData.exportDate?.toDate ? existingData.exportDate.toDate() : existingData.exportDate).toISOString().split('T')[0];
        
        if (existingDate === today) {
          // Same day - update existing record
          console.log('🔄 Updating existing record for same day:', existingDoc.id);
          
          const newExportQuantity = existingData.exportQuantity + this.exportQuantity;
          const newNotes = `Gộp từ ${existingData.exportQuantity} + ${this.exportQuantity} = ${newExportQuantity} - ${existingData.notes || 'Auto-scanned export'}`;
          
          await existingDoc.ref.update({
            exportQuantity: newExportQuantity,
            updatedAt: new Date(),
            exportedBy: exportedBy,
            scanMethod: 'QR_SCANNER',
            notes: newNotes
          });
          
          console.log('✅ Existing record updated successfully');
        } else {
          // Different day - create new record
          await this.createNewOutboundRecord(exportedBy);
        }
      } else {
        // No existing record - create new one
        await this.createNewOutboundRecord(exportedBy);
      }
      
      // Cập nhật cột "đã xuất" trong inventory
      console.log('📦 Updating inventory exported quantity...');
      await this.updateInventoryExported(this.lastScannedData.materialCode, this.lastScannedData.poNumber, this.exportQuantity);
      console.log('✅ Inventory exported quantity updated successfully');
      
      // Store data for success message
      const successData = {
        materialCode: this.lastScannedData.materialCode,
        exportQuantity: this.exportQuantity,
        unit: 'KG' // Default unit
      };
      
      // Reset scanner state
      this.lastScannedData = null;
      this.exportQuantity = 0;
      
      // Reload data
      console.log('🔄 Reloading materials data...');
      await this.loadMaterials();
      console.log('✅ Materials data reloaded');
      
      // Success - no popup needed for normal export
      console.log(`✅ Auto-export completed: ${successData.exportQuantity} ${successData.unit} của ${successData.materialCode}`);
      
    } catch (error) {
      console.error('❌ Error in auto-export:', error);
      console.error('❌ Error details:', {
        message: error.message,
        stack: error.stack,
        lastScannedData: this.lastScannedData,
        exportQuantity: this.exportQuantity
      });
      // Bỏ alert - chỉ log console để scan liên tục
      console.error('❌ Lỗi tự động xuất:', error.message);
    }
  }
  
  // REMOVED: updateInventoryStock() - Không cần tính stock để scan nhanh
  
  // Physical Scanner methods
  activatePhysicalScanner(): void {
    console.log('🔌 Activating physical scanner input...');
    this.isScannerInputActive = !this.isScannerInputActive;
    
    if (this.isScannerInputActive) {
      this.scannerBuffer = '';
      this.focusScannerInput();
      console.log('✅ Physical scanner activated - Ready to receive input');
    } else {
      console.log('⏹️ Physical scanner deactivated');
    }
  }

  // Batch Scanning Mode methods
  startBatchScanningMode(): void {
    console.log('🚀 Starting batch scanning mode...');
    this.isBatchScanningMode = true;
    this.batchProductionOrder = '';
    this.batchEmployeeId = '';
    this.isProductionOrderScanned = false;
    this.isEmployeeIdScanned = false;
    this.scannerBuffer = '';
    this.focusScannerInput();
    console.log('✅ Batch scanning mode activated');
  }

  stopBatchScanningMode(): void {
    console.log('🛑 Stopping batch scanning mode...');
    this.isBatchScanningMode = false;
    this.batchProductionOrder = '';
    this.batchEmployeeId = '';
    this.isProductionOrderScanned = false;
    this.isEmployeeIdScanned = false;
    this.scannerBuffer = '';
    console.log('✅ Batch scanning mode deactivated');
  }



  private processBatchScanInput(scannedData: string): void {
    if (!scannedData.trim()) return;

    console.log('🔍 Processing batch scan input:', scannedData);

    // Auto-detect what type of data was scanned
    
    // Check if this is an employee ID (ASP + 4 digits)
    if (scannedData.startsWith('ASP') && scannedData.length >= 7 && !this.isEmployeeIdScanned) {
      this.processEmployeeIdScan(scannedData);
      return;
    }
    
    // Check if this is a production order (KZLSX + 9 characters)
    if (scannedData.startsWith('KZLSX') && scannedData.length === 14 && !this.isProductionOrderScanned) {
      this.processProductionOrderScan(scannedData);
      return;
    }
    
    // If both production order and employee ID are scanned, process as material
    if (this.isProductionOrderScanned && this.isEmployeeIdScanned) {
      this.processBatchMaterialScan(scannedData);
    } else {
      // Show what's still needed - chỉ log console, không alert
      if (!this.isProductionOrderScanned) {
        console.log('⚠️ Vui lòng scan lệnh sản xuất (KZLSX...) trước!');
        // Bỏ alert - chỉ log console
      } else if (!this.isEmployeeIdScanned) {
        console.log('⚠️ Vui lòng scan mã nhân viên (ASP...) trước!');
        // Bỏ alert - chỉ log console
      }
    }
  }

  // Process employee ID scan
  private processEmployeeIdScan(scannedData: string): void {
    try {
      console.log('🔍 Processing employee ID scan:', scannedData);
      
      // Try different patterns for employee ID
      let employeeId = '';
      
      // Pattern 1: ASP + 4 digits (7 characters total)
      if (scannedData.startsWith('ASP') && scannedData.length >= 7) {
        employeeId = scannedData.substring(0, 7);
      }
      // Pattern 2: Just ASP + digits (flexible length)
      else if (scannedData.startsWith('ASP')) {
        employeeId = scannedData;
      }
      // Pattern 3: Any 7-character code starting with ASP
      else if (scannedData.length === 7 && scannedData.startsWith('ASP')) {
        employeeId = scannedData;
      }
      // Pattern 4: Look for ASP pattern anywhere in the string
      else {
        const aspIndex = scannedData.indexOf('ASP');
        if (aspIndex >= 0) {
          employeeId = scannedData.substring(aspIndex, aspIndex + 7);
        }
      }
      
      if (employeeId && employeeId.startsWith('ASP')) {
        this.batchEmployeeId = employeeId;
        this.isEmployeeIdScanned = true;
        
        console.log('✅ Employee ID scanned successfully:', employeeId);
        console.log('📊 Original scanned data:', scannedData);
        console.log('📊 Extracted employee ID:', employeeId);
        
        // Auto-focus for next scan
        setTimeout(() => {
          this.focusScannerInput();
        }, 100);
        
      } else {
        throw new Error(`Không thể xác định mã nhân viên từ dữ liệu scan: ${scannedData}`);
      }
      
    } catch (error) {
      console.error('❌ Error processing employee ID:', error);
      console.log('🔍 Raw scanned data for debugging:', scannedData);
      console.log('🔍 Data length:', scannedData.length);
      console.log('🔍 Data characters:', scannedData.split('').map(c => c.charCodeAt(0)));
    }
  }

  // Process production order scan
  private processProductionOrderScan(scannedData: string): void {
    try {
      console.log('🔍 Processing production order scan:', scannedData);
      
      if (scannedData.startsWith('KZLSX') && scannedData.length === 14) {
        this.batchProductionOrder = scannedData;
        this.isProductionOrderScanned = true;
        
        console.log('✅ Production Order scanned successfully:', scannedData);
        // Bỏ alert - chỉ log console
        
        // Auto-focus for next scan
        setTimeout(() => {
          this.focusScannerInput();
        }, 100);
        
      } else {
        throw new Error(`Lệnh sản xuất phải bắt đầu bằng KZLSX và có 14 ký tự, nhận được: ${scannedData}`);
      }
      
    } catch (error) {
      console.error('❌ Error processing production order:', error);
      // Bỏ alert - chỉ log console
    }
  }

  private processBatchMaterialScan(scannedData: string): void {
    try {
      // Kiểm tra xem đã scan mã nhân viên chưa
      if (!this.isEmployeeIdScanned) {
        console.log('⚠️ Phải scan mã nhân viên trước khi scan mã hàng!');
        // Bỏ alert - chỉ log console
        return;
      }
      
      console.log('🔍 Processing material scan:', scannedData);
      
      let materialCode = '';
      let poNumber = '';
      let quantity = 1;
      
      // Pattern 1: Format "MaterialCode|PONumber|Quantity" (dấu |)
      if (scannedData.includes('|')) {
        const parts = scannedData.split('|');
        if (parts.length >= 3) {
          materialCode = parts[0].trim();
          poNumber = parts[1].trim();
          quantity = parseInt(parts[2]) || 1;
          console.log('✅ Parsed pipe format:', { materialCode, poNumber, quantity });
        }
      }
      // Pattern 2: Format "MaterialCode,PONumber,Quantity" (dấu phẩy)
      else if (scannedData.includes(',')) {
        const parts = scannedData.split(',');
        if (parts.length >= 3) {
          materialCode = parts[0].trim();
          poNumber = parts[1].trim();
          quantity = parseInt(parts[2]) || 1;
          console.log('✅ Parsed comma format:', { materialCode, poNumber, quantity });
        }
      }
      // Pattern 3: Format "MaterialCode PONumber Quantity" (dấu cách)
      else if (scannedData.includes(' ')) {
        const parts = scannedData.split(' ');
        if (parts.length >= 3) {
          materialCode = parts[0].trim();
          poNumber = parts[1].trim();
          quantity = parseInt(parts[2]) || 1;
          console.log('✅ Parsed space format:', { materialCode, poNumber, quantity });
        }
      }
      // Pattern 4: Try to extract material code pattern (e.g., B024039, A002009)
      else {
        // Look for material code pattern: letter + 6+ digits
        const materialCodeMatch = scannedData.match(/[A-Z]\d{6,}/);
        if (materialCodeMatch) {
          materialCode = materialCodeMatch[0];
          // Look for PO pattern: PO + digits or KZP + digits
          const poMatch = scannedData.match(/(?:PO|KZP)\d+[\/\d]*/i);
          if (poMatch) {
            poNumber = poMatch[0];
          }
          // Look for quantity (number at the end)
          const quantityMatch = scannedData.match(/\d+$/);
          if (quantityMatch) {
            quantity = parseInt(quantityMatch[0]);
          }
          console.log('✅ Parsed pattern extraction:', { materialCode, poNumber, quantity });
        }
      }
      
      // Validate parsed data
      if (!materialCode) {
        console.log('⚠️ Could not extract material code, using raw data');
        materialCode = scannedData.trim();
      }
      
      if (!poNumber) {
        console.log('⚠️ Could not extract PO number, using default');
        poNumber = 'Unknown';
      }
      
      if (quantity <= 0) {
        console.log('⚠️ Invalid quantity, using default 1');
        quantity = 1;
      }
      
      // Lưu thẳng vào database thay vì lưu vào batch array
      this.saveMaterialDirectlyToDatabase(materialCode, poNumber, quantity);
      
    } catch (error) {
      console.error('❌ Error processing material scan:', error);
      console.log('❌ Lỗi xử lý mã hàng!');
    }
  }

  // Lưu mã hàng trực tiếp vào database
  private async saveMaterialDirectlyToDatabase(materialCode: string, poNumber: string, quantity: number): Promise<void> {
    try {
      console.log('💾 Saving material directly to database:', { materialCode, poNumber, quantity });
      
      const outboundRecord: OutboundMaterial = {
        factory: 'ASM1',
        materialCode: materialCode,
        poNumber: poNumber,
        quantity: quantity,
        unit: 'KG', // Default unit
        exportQuantity: quantity,
        exportDate: new Date(),
        location: 'ASM1',
        exportedBy: this.batchEmployeeId,
        productionOrder: this.batchProductionOrder,
        employeeId: this.batchEmployeeId,
        scanMethod: 'Direct Scanner',
        notes: `Direct scan - ${this.batchProductionOrder}`,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Lưu vào outbound collection
      const docRef = await this.firestore.collection('outbound-materials').add(outboundRecord);
      console.log('✅ Material saved directly to database:', materialCode, 'with ID:', docRef.id);
      
      // Cập nhật cột "đã xuất" trong inventory
      console.log('📦 Updating inventory exported quantity...');
      await this.updateInventoryExported(materialCode, poNumber, quantity);
      console.log('✅ Inventory exported quantity updated successfully');
      
      // Bỏ alert - chỉ log console để scan liên tục
      console.log(`✅ Đã lưu mã hàng: ${materialCode}, PO: ${poNumber}, Số lượng: ${quantity}`);
      
      // Reload data để hiển thị mã hàng mới
      await this.loadMaterials();
      console.log('✅ Data reloaded successfully');
      
    } catch (error) {
      console.error('❌ Error saving material directly:', error);
      alert('❌ Lỗi khi lưu mã hàng: ' + error.message);
    }
  }



  private focusScannerInput(): void {
    setTimeout(() => {
      const inputElement = document.querySelector('.scanner-input') as HTMLInputElement;
      if (inputElement) {
        inputElement.focus();
        console.log('📍 Scanner input focused');
      }
    }, 100);
  }
  
  onScannerKeydown(event: KeyboardEvent): void {
    const input = event.target as HTMLInputElement;
    
    // Record scan start time on first character
    if (input.value.length === 0) {
      this.scanStartTime = Date.now();
    }
    
    // Clear existing timeout
    if (this.scannerTimeout) {
      clearTimeout(this.scannerTimeout);
    }
    
    // Handle Enter key (most scanners send Enter after scanning)
    if (event.key === 'Enter') {
      event.preventDefault();
      console.log('🔌 Enter key detected - processing scanner input');
      this.processScannerInput(input.value);
      return;
    }
    
    // Handle Tab key (some scanners send Tab instead of Enter)
    if (event.key === 'Tab') {
      event.preventDefault();
      console.log('🔌 Tab key detected - processing scanner input');
      this.processScannerInput(input.value);
      return;
    }
    
    // Set timeout to auto-process if no more input (for scanners without Enter/Tab)
    this.scannerTimeout = setTimeout(() => {
      if (input.value.trim().length > 5) { // Minimum barcode length
        const scanDuration = Date.now() - this.scanStartTime;
        console.log(`🔌 Auto-process timeout - duration: ${scanDuration}ms, length: ${input.value.length}`);
        
        // If input was typed very fast (< 1000ms), likely from scanner
        if (scanDuration < 1000) {
          console.log('🔌 Fast input detected - processing as scanner input');
          this.processScannerInput(input.value);
        } else {
          console.log('🔌 Slow input - likely manual typing, not processing');
        }
      }
    }, 200); // Giảm timeout để xử lý nhanh hơn
  }
  
  onScannerInputBlur(): void {
    // Process input on blur if there's content
    const inputElement = document.querySelector('.scanner-input') as HTMLInputElement;
    if (inputElement && inputElement.value.trim().length > 5) {
      this.processScannerInput(inputElement.value);
    }
  }
  
  private processScannerInput(scannedData: string): void {
    if (!scannedData.trim()) return;
    
    // Clean the scanned data - remove common scanner artifacts
    let cleanData = scannedData.trim();
    
    // Remove common suffix characters that some scanners add
    const suffixesToRemove = ['\r', '\n', '\t', ' ', '\0'];
    suffixesToRemove.forEach(suffix => {
      cleanData = cleanData.replace(new RegExp(suffix, 'g'), '');
    });
    
    // Remove common prefix characters
    const prefixesToRemove = ['\0', ' ', '\t'];
    prefixesToRemove.forEach(prefix => {
      if (cleanData.startsWith(prefix)) {
        cleanData = cleanData.substring(prefix.length);
      }
    });
    
    console.log('🔌 Physical scanner input received:', scannedData);
    console.log('🔌 Cleaned data:', cleanData);
    console.log('🔌 Input length:', cleanData.length);
    console.log('🔌 Input characters:', cleanData.split('').map(c => c.charCodeAt(0)));
    
    // Clear the input
    this.scannerBuffer = '';
    const inputElement = document.querySelector('.scanner-input') as HTMLInputElement;
    if (inputElement) {
      inputElement.value = '';
    }
    
    // If in batch mode, process with batch logic
    if (this.isBatchScanningMode) {
      this.processBatchScanInput(cleanData);
      
      // Auto-focus for next scan in batch mode
      setTimeout(() => {
        this.focusScannerInput();
      }, 100);
    } else {
      // Process the scanned data (same as camera scan)
      this.onScanSuccess(cleanData);
      
      // Keep input focused for next scan
      if (this.isScannerInputActive) {
        this.focusScannerInput();
      }
    }
  }

  // REMOVED: getMaterialStock() - Không cần tính stock để scan nhanh

  // REMOVED: getNegativeStockCount() và getNegativeInventoryCount() - Không cần tính stock để scan nhanh

  // Debug method để kiểm tra máy scan
  debugScannerInput(input: string): void {
    console.log('🔍 === SCANNER DEBUG INFO ===');
    console.log('🔍 Raw input:', input);
    console.log('🔍 Input length:', input.length);
    console.log('🔍 Input type:', typeof input);
    console.log('🔍 Character codes:', input.split('').map(c => `${c}(${c.charCodeAt(0)})`));
    console.log('🔍 Has Enter (13):', input.includes('\r'));
    console.log('🔍 Has Newline (10):', input.includes('\n'));
    console.log('🔍 Has Tab (9):', input.includes('\t'));
    console.log('🔍 Has Null (0):', input.includes('\0'));
    console.log('🔍 Has Space (32):', input.includes(' '));
    console.log('🔍 === END DEBUG INFO ===');
  }

  // REMOVED: debugMaterialStock() - Không cần tính stock để scan nhanh

  /**
   * Cập nhật cột "đã xuất" trong inventory khi quét outbound - LOGIC THÔNG MINH
   * Tìm record có cùng materialCode + poNumber và cộng dồn vào cột exported
   * KHÔNG BAO GIỜ reset về 0 - luôn cộng dồn vào số hiện tại (kể cả khi user sửa tay)
   */
  private async updateInventoryExported(materialCode: string, poNumber: string, exportQuantity: number): Promise<void> {
    try {
      console.log(`🧠 SMART UPDATE: Updating inventory exported for ${materialCode}, PO: ${poNumber}, Export: ${exportQuantity}`);
      
      // Tìm tất cả inventory items có cùng material code và PO (ASM1 only)
      const inventoryQuery = await this.firestore.collection('inventory-materials', ref =>
        ref.where('materialCode', '==', materialCode)
           .where('poNumber', '==', poNumber)
           .where('factory', '==', 'ASM1')
           .limit(50)
      ).get().toPromise();

      if (!inventoryQuery || inventoryQuery.empty) {
        console.log(`⚠️ Không tìm thấy inventory record cho ${materialCode} - ${poNumber}`);
        console.log(`💡 Tạo mới inventory record với exported = ${exportQuantity}`);
        
        // Tạo mới inventory record nếu không tìm thấy
        await this.createNewInventoryRecord(materialCode, poNumber, exportQuantity);
        return;
      }

      console.log(`📊 Tìm thấy ${inventoryQuery.docs.length} inventory records cần cập nhật`);

      // Cập nhật từng record - LUÔN CỘNG DỒN
      const batch = this.firestore.firestore.batch();
      let totalUpdated = 0;
      let totalExportedBefore = 0;
      let totalExportedAfter = 0;

      for (const doc of inventoryQuery.docs) {
        const data = doc.data() as any;
        const currentExported = Number(data.exported) || 0;
        const newExported = currentExported + exportQuantity;
        
        totalExportedBefore += currentExported;
        totalExportedAfter += newExported;

        console.log(`  🧠 SMART UPDATE ${doc.id}:`);
        console.log(`    - Exported hiện tại: ${currentExported}`);
        console.log(`    - Số lượng mới: +${exportQuantity}`);
        console.log(`    - Exported sau cập nhật: ${newExported}`);
        console.log(`    - Ghi chú: ${data.notes || 'N/A'}`);

        // Cập nhật với metadata chi tiết
        batch.update(doc.ref, {
          exported: newExported,
          lastExportDate: new Date(),
          lastUpdated: new Date(),
          lastExportQuantity: exportQuantity, // Số lượng xuất lần cuối
          exportHistory: this.updateExportHistory(data.exportHistory || [], exportQuantity), // Lịch sử xuất
          notes: this.updateInventoryNotes(data.notes || '', exportQuantity, currentExported, newExported)
        });

        totalUpdated++;
      }

      // Commit batch update
      await batch.commit();
      
      console.log(`✅ SMART UPDATE hoàn tất: ${totalUpdated} inventory records`);
      console.log(`📊 Tổng exported trước: ${totalExportedBefore} → Sau: ${totalExportedAfter}`);
      console.log(`📦 Số lượng mới được cộng: +${exportQuantity} cho ${materialCode}-${poNumber}`);
      console.log(`🧠 LOGIC: Luôn cộng dồn, không bao giờ reset về 0!`);

    } catch (error) {
      console.error('❌ Error trong SMART UPDATE inventory exported:', error);
      // Không throw error để không block quá trình scan
    }
  }

  /**
   * Tạo mới inventory record nếu không tìm thấy
   */
  private async createNewInventoryRecord(materialCode: string, poNumber: string, exportQuantity: number): Promise<void> {
    try {
      const newInventoryRecord = {
        factory: 'ASM1',
        materialCode: materialCode,
        poNumber: poNumber,
        quantity: 0, // Chưa có số lượng nhập
        exported: exportQuantity, // Số lượng đã xuất
        unit: 'KG',
        location: 'ASM1',
        createdAt: new Date(),
        updatedAt: new Date(),
        lastExportDate: new Date(),
        lastUpdated: new Date(),
        lastExportQuantity: exportQuantity,
        exportHistory: [{
          date: new Date(),
          quantity: exportQuantity,
          source: 'outbound-scan',
          notes: 'Tạo mới từ outbound scan'
        }],
        notes: `Tạo mới từ outbound scan - Xuất: ${exportQuantity}`
      };

      await this.firestore.collection('inventory-materials').add(newInventoryRecord);
      console.log(`✅ Tạo mới inventory record: ${materialCode}-${poNumber} với exported = ${exportQuantity}`);
      
    } catch (error) {
      console.error('❌ Error tạo mới inventory record:', error);
    }
  }

  /**
   * Cập nhật lịch sử xuất hàng
   */
  private updateExportHistory(history: any[], newExportQuantity: number): any[] {
    const newEntry = {
      date: new Date(),
      quantity: newExportQuantity,
      source: 'outbound-scan',
      timestamp: Date.now()
    };
    
    // Giữ tối đa 20 entries gần nhất
    const updatedHistory = [newEntry, ...history].slice(0, 20);
    return updatedHistory;
  }

  /**
   * Cập nhật ghi chú inventory với thông tin xuất hàng
   */
  private updateInventoryNotes(currentNotes: string, newExportQuantity: number, oldExported: number, newExported: number): string {
    const timestamp = new Date().toLocaleString('vi-VN');
    const newNote = `[${timestamp}] Outbound scan: +${newExportQuantity} (${oldExported} → ${newExported})`;
    
    // Giữ ghi chú cũ và thêm ghi chú mới
    const updatedNotes = currentNotes ? `${currentNotes}\n${newNote}` : newNote;
    
    // Giới hạn độ dài ghi chú để tránh quá dài
    return updatedNotes.length > 500 ? updatedNotes.substring(0, 500) + '...' : updatedNotes;
  }

}
