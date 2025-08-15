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
          })
          .sort((a, b) => {
            // Sort by export date first (oldest first)
            const dateCompare = a.exportDate.getTime() - b.exportDate.getTime();
            if (dateCompare !== 0) return dateCompare;
            
            // If same date, sort by creation time (export order)
            return a.createdAt.getTime() - b.createdAt.getTime();
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
    material.exportDate = target.value ? new Date(target.value) : new Date();
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
        'Date': material.exportDate ? material.exportDate.toLocaleDateString('vi-VN', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit'
        }) : '',
        'Location': material.location || '',
        'User': material.exportedBy || '',
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
        { wch: 10 },  // Date
        { wch: 12 },  // Location
        { wch: 20 },  // User
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
      alert('Lỗi export: ' + error.message);
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
          'User': item.exportedBy,
          'Method': item.scanMethod
        }));
        
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        
        // Set column widths
        const colWidths = [
          { wch: 8 }, { wch: 15 }, { wch: 12 }, { wch: 8 }, { wch: 6 },
          { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 20 }, { wch: 8 }
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
      
      // Create outbound record
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
        scanMethod: 'QR_SCANNER',
        notes: `Auto-scanned export - Original: ${this.lastScannedData.quantity}, Exported: ${this.exportQuantity}`,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      console.log('📝 Outbound record to create:', outboundRecord);
      
      // Add to outbound collection
      console.log('🔥 Adding to Firebase collection: outbound-materials');
      const docRef = await this.firestore.collection('outbound-materials').add(outboundRecord);
      console.log('✅ Outbound record created with ID:', docRef.id);
      
      // Update inventory stock
      console.log('📦 Starting inventory update...');
      await this.updateInventoryStock(this.lastScannedData.materialCode, this.lastScannedData.poNumber, this.exportQuantity);
      console.log('✅ Inventory updated successfully');
      
      // Store data for success message
      const successData = {
        materialCode: this.lastScannedData.materialCode,
        exportQuantity: this.exportQuantity,
        unit: outboundRecord.unit
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
    
    // Process the scanned data (same as camera scan)
    this.onScanSuccess(scannedData);
    
    // Keep input focused for next scan
    if (this.isScannerInputActive) {
      this.focusScannerInput();
    }
  }
  
  // Manual barcode entry
  onManualScannerInput(): void {
    const scannedData = this.scannerBuffer.trim();
    if (scannedData.length > 5) {
      console.log('✋ Manual barcode entry:', scannedData);
      this.processScannerInput(scannedData);
    } else {
      console.log('⚠️ Manual input too short:', scannedData);
      alert('Vui lòng nhập đủ ký tự (tối thiểu 6 ký tự)');
    }
  }
}
