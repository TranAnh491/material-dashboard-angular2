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
  batchStartTime?: Date; // Thời gian bắt đầu batch
  batchEndTime?: Date; // Thời gian kết thúc batch
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
  batchMaterials: any[] = [];
  isProductionOrderScanned: boolean = false;
  isEmployeeIdScanned: boolean = false;
  batchStartTime: Date | null = null; // Thời gian bắt đầu batch
  isBatchCompleted: boolean = false; // Trạng thái hoàn thành batch
  isBatchFullyReceived: boolean = false; // Tick xác nhận đã nhận toàn bộ lô hàng
  
  // Date Range properties
  startDate: string = '';
  endDate: string = '';
  showOnlyToday: boolean = true;
  
  // Dropdown management
  isDropdownOpen: boolean = false;
  
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
    
    console.log('📅 Date range set to:', { startDate: this.startDate, endDate: this.endDate, showOnlyToday: this.showOnlyToday });
  }
  
  onDateRangeChange(): void {
    console.log('📅 Date range changed:', { startDate: this.startDate, endDate: this.endDate });
    
    // Check if showing only today
    const today = new Date().toISOString().split('T')[0];
    this.showOnlyToday = (this.startDate === today && this.endDate === today);
    
    // Reload materials with new date filter
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
    console.log('📦 Loading ASM1 outbound materials...');
    
    // Use simplified query without where/orderBy to avoid index requirements
    this.firestore.collection('outbound-materials', ref => 
      ref.limit(1000)
    ).snapshotChanges()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        console.log(`🔍 Raw snapshot from outbound-materials contains ${snapshot.length} documents`);
        
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
             batchStartTime: data.batchStartTime?.toDate() || data.batchStartTime || null,
             batchEndTime: data.batchEndTime?.toDate() || data.batchEndTime || null,
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
        
        this.filteredMaterials = [...this.materials];
        this.updatePagination();
        this.isLoading = false;
        
        console.log(`✅ Final filtered materials: ${this.filteredMaterials.length}`);
      },
      error: (error) => {
        console.error('❌ Error loading ASM1 outbound materials:', error);
        this.errorMessage = 'Lỗi khi tải dữ liệu: ' + error.message;
        this.isLoading = false;
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
      batchStartTime: null,
      batchEndTime: null,
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
         'Thời gian bắt đầu': material.exportDate ? material.exportDate.toLocaleString('vi-VN') : '',
         'Thời gian thực hiện': this.calculateDuration(material),
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
         { wch: 18 },  // Thời gian bắt đầu
         { wch: 15 },  // Thời gian thực hiện
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
  
  // Consolidate outbound records by same date + material code + PO
  private consolidateOutboundRecords(materials: OutboundMaterial[]): OutboundMaterial[] {
    const consolidatedMap = new Map<string, OutboundMaterial>();
    
    materials.forEach(material => {
      // Create key: date + materialCode + poNumber
      const exportDate = material.exportDate.toISOString().split('T')[0];
      const key = `${exportDate}_${material.materialCode}_${material.poNumber}`;
      
      if (consolidatedMap.has(key)) {
        // Merge with existing record
        const existing = consolidatedMap.get(key)!;
        existing.exportQuantity += material.exportQuantity;
        existing.quantity = Math.max(existing.quantity, material.quantity); // Keep max quantity
        existing.updatedAt = new Date(Math.max(existing.updatedAt.getTime(), material.updatedAt.getTime()));
        existing.createdAt = new Date(Math.min(existing.createdAt.getTime(), material.createdAt.getTime())); // Keep earliest creation
        existing.exportedBy = material.exportedBy; // Use latest user
                 existing.employeeId = material.employeeId || existing.employeeId; // Keep employeeId if available
         existing.productionOrder = material.productionOrder || existing.productionOrder; // Keep productionOrder if available
         existing.batchStartTime = material.batchStartTime || existing.batchStartTime; // Keep batchStartTime if available
         existing.batchEndTime = material.batchEndTime || existing.batchEndTime; // Keep batchEndTime if available
         existing.scanMethod = material.scanMethod; // Use latest scan method
         existing.notes = `Gộp từ ${existing.exportQuantity - material.exportQuantity + material.exportQuantity} lần quét - ${material.notes || 'Auto-scanned export'}`;
      } else {
        // New record
        consolidatedMap.set(key, { ...material });
      }
    });
    
    console.log(`🔄 Consolidated ${materials.length} records into ${consolidatedMap.size} unique entries`);
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
      
      // Update inventory stock
      console.log('📦 Starting inventory update...');
      await this.updateInventoryStock(this.lastScannedData.materialCode, this.lastScannedData.poNumber, this.exportQuantity);
      console.log('✅ Inventory updated successfully');
      
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
      alert('Lỗi tự động xuất: ' + error.message);
    }
  }
  
  private async updateInventoryStock(materialCode: string, poNumber: string, exportQuantity: number): Promise<void> {
    try {
      console.log(`📦 Updating inventory stock for ${materialCode}, PO: ${poNumber}, Export: ${exportQuantity}`);
      
      // First, try to find by materialCode and factory
      let inventoryQuery = await this.firestore.collection('inventory-materials', ref =>
        ref.where('materialCode', '==', materialCode)
           .where('factory', '==', 'ASM1')
           .limit(10)
      ).get().toPromise();
      
      let inventoryDoc = null;
      let inventoryData = null;
      
      if (inventoryQuery && !inventoryQuery.empty) {
        // If multiple items found, try to match by PO number
        if (inventoryQuery.docs.length > 1) {
          console.log(`🔍 Found ${inventoryQuery.docs.length} inventory items for ${materialCode}, searching for PO match...`);
          for (const doc of inventoryQuery.docs) {
            const data = doc.data() as any;
            if (data.poNumber === poNumber) {
              inventoryDoc = doc;
              inventoryData = data;
              console.log('✅ Found matching inventory item by PO:', data);
              break;
            }
          }
        } else {
          // Single item found
          inventoryDoc = inventoryQuery.docs[0];
          inventoryData = inventoryDoc.data();
          console.log('✅ Found single inventory item:', inventoryData);
        }
      }
      
      // If still no match, try broader search
      if (!inventoryDoc) {
        console.log('🔍 Trying broader inventory search...');
        inventoryQuery = await this.firestore.collection('inventory-materials', ref =>
          ref.where('materialCode', '==', materialCode)
             .limit(20)
        ).get().toPromise();
        
        if (inventoryQuery && !inventoryQuery.empty) {
          console.log(`🔍 Found ${inventoryQuery.docs.length} inventory items across all factories`);
          for (const doc of inventoryQuery.docs) {
            const data = doc.data() as any;
            console.log(`  - Factory: ${data.factory}, PO: ${data.poNumber}, Stock: ${data.stock}`);
          }
          
          // Use first ASM1 item or first available item
          for (const doc of inventoryQuery.docs) {
            const data = doc.data() as any;
            if (data.factory === 'ASM1') {
              inventoryDoc = doc;
              inventoryData = data;
              console.log('✅ Using ASM1 inventory item:', data);
              break;
            }
          }
          
          if (!inventoryDoc && inventoryQuery.docs.length > 0) {
            inventoryDoc = inventoryQuery.docs[0];
            inventoryData = inventoryDoc.data() as any;
            console.log('⚠️ Using first available inventory item (not ASM1):', inventoryData);
          }
        }
      }
      
      if (!inventoryDoc || !inventoryData) {
        throw new Error(`Không tìm thấy ${materialCode} trong inventory. Vui lòng kiểm tra dữ liệu inventory.`);
      }
      
      const currentStock = inventoryData.stock || 0;
      const currentExported = inventoryData.exported || 0;
      
      console.log(`📊 Current inventory: Stock: ${currentStock}, Already Exported: ${currentExported}`);
      
      if (currentStock < exportQuantity) {
        throw new Error(`Không đủ tồn kho! Hiện có: ${currentStock}, muốn xuất: ${exportQuantity}`);
      }
      
      // Update inventory
      const newStock = currentStock - exportQuantity;
      const newExported = currentExported + exportQuantity;
      
      await this.firestore.collection('inventory-materials').doc(inventoryDoc.id).update({
        stock: newStock,
        exported: newExported,
        updatedAt: new Date()
      });
      
      console.log(`✅ Inventory updated: Stock: ${currentStock} → ${newStock}, Exported: ${currentExported} → ${newExported}`);
      
    } catch (error) {
      console.error('❌ Error updating inventory stock:', error);
      throw error;
    }
  }
  
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
    this.batchMaterials = [];
    this.isProductionOrderScanned = false;
    this.isEmployeeIdScanned = false;
    this.scannerBuffer = '';
    this.batchStartTime = new Date(); // Ghi lại thời gian bắt đầu
    this.isBatchCompleted = false; // Reset trạng thái hoàn thành
    this.isBatchFullyReceived = false; // Reset trạng thái xác nhận
    this.focusScannerInput();
    console.log('✅ Batch scanning mode activated at:', this.batchStartTime);
  }

  stopBatchScanningMode(): void {
    console.log('🛑 Stopping batch scanning mode...');
    this.isBatchScanningMode = false;
    this.batchProductionOrder = '';
    this.batchEmployeeId = '';
    this.batchMaterials = [];
    this.isProductionOrderScanned = false;
    this.isEmployeeIdScanned = false;
    this.scannerBuffer = '';
    this.batchStartTime = null; // Reset thời gian bắt đầu
    this.isBatchCompleted = false; // Reset trạng thái hoàn thành
    this.isBatchFullyReceived = false; // Reset trạng thái xác nhận
    console.log('✅ Batch scanning mode deactivated');
  }

  // Scan mã nhân viên bằng máy scan
  focusEmployeeInput(): void {
    // Focus vào input để người dùng có thể scan bằng máy scan
    const employeeInput = document.querySelector('.employee-input') as HTMLInputElement;
    if (employeeInput) {
      employeeInput.focus();
      console.log('🎯 Focused on employee ID input for scanning');
    }
  }

  // Xử lý khi focus vào input mã nhân viên
  onEmployeeInputFocus(event: FocusEvent): void {
    // Nếu input đã được scan, không cho phép focus
    if (this.isEmployeeIdScanned) {
      event.preventDefault();
      return;
    }
    
    // Không clear input khi focus - để máy scan có thể nhập dữ liệu
    console.log('🎯 Employee ID input focused, ready for scanning');
  }

  // Xử lý khi nhập mã nhân viên bằng máy scan
  onEmployeeIdKeydown(event: KeyboardEvent): void {
    // Chỉ xử lý khi nhấn Enter (máy scan thường gửi Enter)
    if (event.key === 'Enter') {
      event.preventDefault();
      console.log('🔍 Enter key pressed, current batchEmployeeId:', this.batchEmployeeId);
      this.processEmployeeId();
    }
    
    // KHÔNG chặn các phím khác - để máy scan có thể nhập dữ liệu
    // Chỉ chặn một số phím đặc biệt để tránh xung đột
    if (event.key === 'F1' || event.key === 'F2' || event.key === 'F3' || 
        event.key === 'F4' || event.key === 'F5' || event.key === 'F6' || 
        event.key === 'F7' || event.key === 'F8' || event.key === 'F9' || 
        event.key === 'F10' || event.key === 'F11' || event.key === 'F12') {
      event.preventDefault();
      return;
    }
  }

  // Xử lý mã nhân viên đã scan
  private processEmployeeId(): void {
    try {
      console.log('🔍 Processing scanned employee ID:', this.batchEmployeeId);
      console.log('🔍 Type of batchEmployeeId:', typeof this.batchEmployeeId);
      console.log('🔍 Length of batchEmployeeId:', this.batchEmployeeId ? this.batchEmployeeId.length : 'undefined');
      
      // Đọc toàn bộ dữ liệu scan được, sau đó lấy 7 ký tự đầu tiên
      if (this.batchEmployeeId && this.batchEmployeeId.toString().length > 0) {
        const scannedData = this.batchEmployeeId.toString();
        console.log('🔍 Scanned data received:', scannedData);
        
        // Lấy 7 ký tự đầu tiên từ dữ liệu scan được
        const employeeId = scannedData.substring(0, 7);
        console.log('🔍 Extracted 7 characters:', employeeId);
        
        // Kiểm tra xem có bắt đầu bằng ASP không
        if (employeeId.startsWith('ASP')) {
        this.batchEmployeeId = employeeId;
        this.isEmployeeIdScanned = true;
        
        console.log('✅ Employee ID scanned successfully:', employeeId);
          console.log('📝 Full scanned data was:', scannedData);
        
        // Hiển thị thông báo thành công
        alert(`✅ Đã scan mã nhân viên: ${employeeId}\n\nBây giờ bạn có thể scan các mã hàng.`);
        
        // Focus vào input scanner để scan mã hàng
        setTimeout(() => {
          this.focusScannerInput();
        }, 500);
        
      } else {
          throw new Error(`Mã nhân viên phải bắt đầu bằng ASP, nhận được: ${employeeId}`);
        }
        
      } else {
        throw new Error(`Không có dữ liệu scan được. batchEmployeeId: "${this.batchEmployeeId}"`);
      }
      
    } catch (error) {
      console.error('❌ Error processing employee ID:', error);
      alert(`❌ Lỗi xử lý mã nhân viên: ${error.message}\n\nVui lòng quét lại mã nhân viên hợp lệ.`);
      
      // Reset và focus lại
      this.batchEmployeeId = '';
      this.isEmployeeIdScanned = false;
      this.focusEmployeeInput();
    }
  }

  private processBatchScanInput(scannedData: string): void {
    if (!scannedData.trim()) return;

    console.log('🔍 Processing batch scan input:', scannedData);

    // Check if this is a production order (KZLSX + 9 characters)
    if (scannedData.startsWith('KZLSX') && scannedData.length === 14 && !this.isProductionOrderScanned) {
      this.batchProductionOrder = scannedData;
      this.isProductionOrderScanned = true;
      console.log('✅ Production Order scanned:', scannedData);
      // Show brief confirmation in console
      console.log('📋 Production Order: ' + scannedData + ' - Ready for employee ID scan');
      return;
    }

    // Cho phép scan mã nhân viên qua máy scan USB (đã được xử lý ở onEmployeeIdKeydown)
    // Không cần xử lý ở đây nữa vì đã có input riêng cho mã nhân viên

    // If both production order and employee ID are scanned, process as material
    if (this.isProductionOrderScanned && this.isEmployeeIdScanned) {
      this.processBatchMaterialScan(scannedData);
    } else {
      if (!this.isProductionOrderScanned) {
        console.log('⚠️ Vui lòng scan lệnh sản xuất (KZLSX...) trước!');
      } else if (!this.isEmployeeIdScanned) {
        console.log('⚠️ Vui lòng scan mã nhân viên bằng camera trước!');
      }
    }
  }

  private processBatchMaterialScan(scannedData: string): void {
    try {
      // Kiểm tra xem đã scan mã nhân viên bằng camera chưa
      if (!this.isEmployeeIdScanned) {
        console.log('⚠️ Phải scan mã nhân viên bằng camera trước khi scan mã hàng!');
        alert('⚠️ Phải scan mã nhân viên bằng camera trước!\n\nVui lòng nhấn nút "Scan" để scan mã nhân viên.');
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
      
      const materialData = {
        materialCode,
        poNumber,
        quantity,
        scannedData,
        timestamp: new Date()
      };

      this.batchMaterials.push(materialData);
      console.log('✅ Material added to batch:', materialData);
      console.log(`📦 Total materials in batch: ${this.batchMaterials.length}`);
      
      // KHÔNG tự động lưu nữa - chỉ thêm vào batch array
      // this.autoSaveBatchMaterial(materialData);
      
    } catch (error) {
      console.error('❌ Error processing material scan:', error);
      console.log('❌ Lỗi xử lý mã hàng!');
    }
  }

  // Xóa method autoSaveBatchMaterial vì không cần thiết nữa
  // private async autoSaveBatchMaterial(materialData: any): Promise<void> { ... }

  async saveBatchToOutbound(): Promise<void> {
    console.log('🔄 Completing batch scanning...');
    console.log(`📦 Total materials scanned in this batch: ${this.batchMaterials.length}`);
    
    if (this.batchMaterials.length === 0) {
      alert('⚠️ Chưa có mã hàng nào được scan trong batch này!');
      return;
    }
    
    try {
      // Tính thời gian thực hiện
      const batchEndTime = new Date();
      const durationMinutes = this.batchStartTime ? 
        Math.round((batchEndTime.getTime() - this.batchStartTime.getTime()) / (1000 * 60)) : 0;
      
      console.log(`⏱️ Batch duration: ${durationMinutes} minutes`);
      
      // Lưu tất cả materials trong batch vào database
      console.log('💾 Saving all batch materials to database...');
      const savePromises = this.batchMaterials.map(async (materialData) => {
      const outboundRecord: OutboundMaterial = {
        factory: 'ASM1',
        materialCode: materialData.materialCode,
        poNumber: materialData.poNumber,
        quantity: materialData.quantity,
        unit: 'KG', // Default unit
        exportQuantity: materialData.quantity,
        exportDate: this.batchStartTime || new Date(), // Sử dụng thời gian bắt đầu batch
        location: 'ASM1',
        exportedBy: this.batchEmployeeId, // Use the 7-character employee ID
        productionOrder: this.batchProductionOrder,
        employeeId: this.batchEmployeeId, // Use the 7-character employee ID
        batchStartTime: this.batchStartTime, // Lưu thời gian bắt đầu
          batchEndTime: batchEndTime, // Lưu thời gian kết thúc
        scanMethod: 'Batch Scanner',
        notes: `Batch scan - ${this.batchProductionOrder}`,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Lưu vào outbound
        const docRef = await this.firestore.collection('outbound-materials').add(outboundRecord);
        console.log('✅ Saved batch material:', materialData.materialCode, 'with ID:', docRef.id);
      
        // Cập nhật inventory stock để trừ số lượng
        console.log('📦 Updating inventory stock for:', materialData.materialCode);
      await this.updateInventoryStock(materialData.materialCode, materialData.poNumber, materialData.quantity);
        console.log('✅ Inventory updated for:', materialData.materialCode);
        
        return docRef;
      });
      
      // Đợi tất cả materials được lưu xong
      await Promise.all(savePromises);
      console.log(`✅ All ${this.batchMaterials.length} materials saved successfully`);
      
      // Đánh dấu batch đã hoàn thành
      this.isBatchCompleted = true;
      
      // Cập nhật batchEndTime cho tất cả materials đã scan
        await this.updateBatchEndTimeForMaterials(durationMinutes);
      
      // Show summary of all scanned materials
      const summary = this.batchMaterials.map((item, index) => 
        `${index + 1}. ${item.materialCode} - PO: ${item.poNumber} - Qty: ${item.quantity}`
      ).join('\n');
      
      console.log('📋 Batch Summary:');
      console.log(summary);
      
      // Reload data to show all materials in the report
      await this.loadMaterials();
      console.log('✅ Data reloaded successfully');
      
      // Reset batch mode
      this.stopBatchScanningMode();
      
      // Show completion message with summary
      alert(`✅ Batch scanning completed!\n\n📦 Total materials: ${this.batchMaterials.length}\n⏱️ Duration: ${durationMinutes} minutes\n\n${summary}`);
      
    } catch (error) {
      console.error('❌ Error completing batch:', error);
      alert('❌ Lỗi khi hoàn thành batch: ' + error.message);
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
      this.processScannerInput(input.value);
      return;
    }
    
    // Set timeout to auto-process if no more input (for scanners without Enter)
    this.scannerTimeout = setTimeout(() => {
      if (input.value.trim().length > 5) { // Minimum barcode length
        const scanDuration = Date.now() - this.scanStartTime;
        // If input was typed very fast (< 500ms), likely from scanner
        if (scanDuration < 500) {
          this.processScannerInput(input.value);
        }
      }
    }, 300);
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
    
    console.log('🔌 Physical scanner input received:', scannedData);
    console.log('🔌 Input length:', scannedData.length);
    console.log('🔌 Input characters:', scannedData.split('').map(c => c.charCodeAt(0)));
    
    // Clear the input
    this.scannerBuffer = '';
    const inputElement = document.querySelector('.scanner-input') as HTMLInputElement;
    if (inputElement) {
      inputElement.value = '';
    }
    
    // If in batch mode, process with batch logic
    if (this.isBatchScanningMode) {
      this.processBatchScanInput(scannedData);
      
      // Auto-focus for next scan in batch mode
      setTimeout(() => {
        this.focusScannerInput();
      }, 100);
    } else {
      // Process the scanned data (same as camera scan)
      this.onScanSuccess(scannedData);
      
      // Keep input focused for next scan
      if (this.isScannerInputActive) {
        this.focusScannerInput();
      }
    }
  }

  // Cập nhật batchEndTime cho tất cả materials đã scan
  private async updateBatchEndTimeForMaterials(durationMinutes: number): Promise<void> {
    try {
      console.log('🔄 Updating batch end time for materials...');
      
      // Tìm tất cả materials có cùng productionOrder và employeeId trong batch này
      const batchMaterialsQuery = await this.firestore.collection('outbound-materials', ref =>
        ref.where('productionOrder', '==', this.batchProductionOrder)
           .where('employeeId', '==', this.batchEmployeeId)
           .where('scanMethod', '==', 'Batch Scanner')
           .limit(100)
      ).get().toPromise();
      
      if (batchMaterialsQuery && !batchMaterialsQuery.empty) {
        const updatePromises = batchMaterialsQuery.docs.map(doc => {
          const data = doc.data() as any;
          // Chỉ cập nhật những materials được scan trong batch này (có batchStartTime)
          if (data.batchStartTime && this.batchStartTime) {
            const dataStartTime = data.batchStartTime.toDate ? data.batchStartTime.toDate() : data.batchStartTime;
            if (Math.abs(dataStartTime.getTime() - this.batchStartTime.getTime()) < 60000) { // Trong vòng 1 phút
              return doc.ref.update({
                batchEndTime: new Date(),
                updatedAt: new Date()
              });
            }
          }
          return Promise.resolve();
        });
        
        await Promise.all(updatePromises);
        console.log(`✅ Updated ${updatePromises.length} materials with batch end time`);
      }
      
    } catch (error) {
      console.error('❌ Error updating batch end time:', error);
    }
  }

  // Tính thời gian thực hiện cho material
  calculateDuration(material: OutboundMaterial): string {
    if (!material.batchStartTime || !material.batchEndTime) {
      return '-';
    }
    
    try {
      // Xử lý cả Date và Firestore Timestamp
      let startTime: Date;
      let endTime: Date;
      
      if (material.batchStartTime && typeof material.batchStartTime === 'object') {
        startTime = (material.batchStartTime as any).toDate ? (material.batchStartTime as any).toDate() : material.batchStartTime;
      } else {
        return '-';
      }
      
      if (material.batchEndTime && typeof material.batchEndTime === 'object') {
        endTime = (material.batchEndTime as any).toDate ? (material.batchEndTime as any).toDate() : material.batchEndTime;
      } else {
        return '-';
      }
      
      const durationMs = endTime.getTime() - startTime.getTime();
      const durationMinutes = Math.round(durationMs / (1000 * 60));
      
      if (durationMinutes < 1) {
        return '< 1 phút';
      } else if (durationMinutes < 60) {
        return `${durationMinutes} phút`;
      } else {
        const hours = Math.floor(durationMinutes / 60);
        const minutes = durationMinutes % 60;
        return `${hours}h ${minutes}p`;
      }
    } catch (error) {
      console.error('❌ Error calculating duration:', error);
      return '-';
    }
  }


}
