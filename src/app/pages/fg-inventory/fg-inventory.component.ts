import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { FactoryAccessService } from '../../services/factory-access.service';
import { FgExportService } from '../../services/fg-export.service';
import { FgInService } from '../../services/fg-in.service';
import { MatDialog } from '@angular/material/dialog';
import { QRScannerModalComponent, QRScannerData } from '../../components/qr-scanner-modal/qr-scanner-modal.component';

export interface FGInventoryItem {
  id?: string;
  factory?: string;
  importDate: Date;
  receivedDate: Date;
  batchNumber: string;
  materialCode: string;
  lot: string;
  lsx: string;
  quantity: number;
  standard: number; // Standard từ catalog
  carton: number;
  odd: number;
  tonDau: number; // Tồn đầu
  nhap: number;   // Nhập (từ FG In)
  xuat: number;   // Xuất
  ton: number;    // Tồn kho hiện tại
  location: string;
  notes: string;
  customer: string;
  isReceived: boolean;
  isCompleted: boolean;
  isDuplicate: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ProductCatalogItem {
  id?: string;
  materialCode: string; // Mã TP
  standard: string; // Standard
  customer: string; // Khách
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CustomerCodeMappingItem {
  id?: string;
  customerCode: string;
  materialCode: string;
  description?: string; // Tên Khách Hàng
  createdAt?: Date;
  updatedAt?: Date;
}

@Component({
  selector: 'app-fg-inventory',
  templateUrl: './fg-inventory.component.html',
  styleUrls: ['./fg-inventory.component.scss']
})
export class FGInventoryComponent implements OnInit, OnDestroy {
  materials: FGInventoryItem[] = [];
  filteredMaterials: FGInventoryItem[] = [];

  // Search and filter
  searchTerm: string = '';
  
  // Factory filter — mặc định TOTAL để hiển thị tất cả tồn kho
  selectedFactory: string = 'TOTAL';
  availableFactories: string[] = ['ASM1', 'ASM2', 'TOTAL'];

  // Catalog data (loaded once)
  catalogItems: ProductCatalogItem[] = [];
  catalogLoaded: boolean = false;

  // Customer Code Mapping (Tên Khách Hàng = description)
  mappingItems: CustomerCodeMappingItem[] = [];

  // Search optimization
  private searchSubject = new Subject<string>();
  
  // Loading state
  isLoading: boolean = false;
  
  // Time range filter — dùng string 'yyyy-MM-dd' để tương thích với <input type="date">
  showTimeRangeDialog: boolean = false;
  startDate: string = '2020-01-01';
  endDate: string = '2030-12-31';
  
  // Create PX dialog
  showCreatePXDialog: boolean = false;
  selectedMaterial: FGInventoryItem | null = null;
  pxForm = {
    shipment: '',
    quantity: 0,
    notes: ''
  };
  
  // Display options
  showCompleted: boolean = true;
  
  // Permissions
  hasDeletePermission: boolean = false;
  hasCompletePermission: boolean = false;
  
  private destroy$ = new Subject<void>();

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private factoryAccessService: FactoryAccessService,
    private fgExportService: FgExportService,
    private fgInService: FgInService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.setupDebouncedSearch();
    this.loadCatalogFromFirebase(); // Load catalog first
    this.loadMappingFromFirebase(); // Load mapping for customer names
    this.loadMaterialsFromFirebase();
    this.startDate = '2020-01-01';
    this.endDate = '2030-12-31';
    this.applyFilters();
    this.loadPermissions();
    this.loadFactoryAccess();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Setup debounced search for better performance
  private setupDebouncedSearch(): void {
    this.searchSubject.pipe(
      debounceTime(1000), // Đợi 1 giây sau khi user ngừng gõ
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(searchTerm => {
      this.performSearch(searchTerm);
    });
  }

  // Load materials from Firebase - Real-time listener để tự động cập nhật khi FG In thêm mới
  loadMaterialsFromFirebase(): void {
    this.isLoading = true;

    this.firestore.collection('fg-inventory')
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((actions) => {
        const firebaseMaterials = actions.map(action => {
          const data = action.payload.doc.data() as any;
          const id = action.payload.doc.id;

          // Tồn kho = tonDau + nhap - xuat (ưu tiên đọc trực tiếp từ Firebase nếu đã tính sẵn)
          const tonDau = data.tonDau || 0;
          const nhap   = data.nhap   || data.quantity || 0;
          const xuat   = data.xuat   || data.exported || 0;
          const ton    = data.ton    != null ? data.ton : (data.stock != null ? data.stock : (tonDau + nhap - xuat));

          // Firestore Timestamp: có thể là .toDate() hoặc .seconds
          const toDate = (v: any) => {
            if (!v) return new Date();
            if (typeof v?.toDate === 'function') return v.toDate();
            if (v?.seconds != null) return new Date(v.seconds * 1000);
            return v instanceof Date ? v : new Date(v);
          };

          return {
            id,
            factory:      data.factory      || 'ASM1',
            importDate:   toDate(data.importDate),
            receivedDate: toDate(data.receivedDate),
            batchNumber:  data.batchNumber  || '',
            materialCode: data.materialCode || data.maTP || '',
            lot:          data.lot          || data.Lot  || '',
            lsx:          data.lsx          || data.LSX  || '',
            quantity:     data.quantity     || 0,
            standard:     data.standard     || 0,
            carton:       data.carton       || 0,
            odd:          data.odd          || 0,
            tonDau,
            nhap,
            xuat,
            ton,
            location:     data.location     || data.viTri || 'Temporary',
            notes:        data.notes        || data.ghiChu || '',
            customer:     data.customer     || data.khach  || '',
            isReceived:   data.isReceived   || false,
            isCompleted:  data.isCompleted  || false,
            isDuplicate:  data.isDuplicate  || false,
            createdAt:    toDate(data.createdAt),
            updatedAt:    toDate(data.updatedAt)
          };
        });

        this.materials = firebaseMaterials;

        this.sortMaterials();
        this.applyFilters();
        this.isLoading = false;
        this.cdr.detectChanges();
      });
  }

  // Load export and import data for all materials
  private loadExportDataForMaterials(): void {
    this.materials.forEach(material => {
      // Load export data from fg-export collection
      this.fgExportService.getTotalExportQuantity(
        material.materialCode, 
        material.batchNumber, 
        material.lsx, 
        material.lot
      ).pipe(takeUntil(this.destroy$))
      .subscribe(totalExport => {
        material.xuat = totalExport;
        this.recalculateTon(material);
        console.log(`Updated export for ${material.materialCode}: ${totalExport} units`);
      });

      // Load import data from fg-in collection
      this.fgInService.getTotalImportQuantity(
        material.materialCode, 
        material.batchNumber, 
        material.lsx, 
        material.lot
      ).pipe(takeUntil(this.destroy$))
      .subscribe(totalImport => {
        material.nhap = totalImport;
        this.recalculateTon(material);
        console.log(`Updated import for ${material.materialCode}: ${totalImport} units`);
      });
    });
  }

  // Recalculate Tồn kho: Tồn đầu + Nhập - Xuất
  private recalculateTon(material: FGInventoryItem): void {
    const tonDau = material.tonDau || 0;
    const nhap = material.nhap || 0;
    const xuat = material.xuat || 0;
    
    material.ton = tonDau + nhap - xuat;
    
    console.log(`Recalculated ton for ${material.materialCode}: ${tonDau} + ${nhap} - ${xuat} = ${material.ton}`);
  }

  // Update material in Firebase
  updateMaterialInFirebase(material: FGInventoryItem): void {
    if (material.id) {
      const updateData = {
        ...material,
        importDate: material.importDate,
        receivedDate: material.receivedDate,
        updatedAt: new Date()
      };
      
      delete updateData.id;
      
      this.firestore.collection('fg-inventory').doc(material.id).update(updateData)
        .then(() => {
          console.log('FG Inventory material updated in Firebase successfully');
        })
        .catch(error => {
          console.error('Error updating FG Inventory material in Firebase:', error);
        });
    }
  }

  // Delete material
  deleteMaterial(material: FGInventoryItem): void {
    if (material.id) {
      this.firestore.collection('fg-inventory').doc(material.id).delete()
        .then(() => {
          console.log('FG Inventory material deleted from Firebase successfully');
        })
        .catch(error => {
          console.error('Error deleting FG Inventory material from Firebase:', error);
        });
    }
    
    // Remove from local array immediately
    const index = this.materials.indexOf(material);
    if (index > -1) {
      this.materials.splice(index, 1);
      console.log(`Deleted FG Inventory material: ${material.materialCode}`);
      this.applyFilters();
    }
  }

  // Delete item (alias for deleteMaterial)
  deleteItem(material: FGInventoryItem): void {
    this.deleteMaterial(material);
  }

  // Helper method to parse LSX for sorting
  private parseLSXForSorting(lsx: string): { year: number, month: number, sequence: number } {
    if (!lsx || lsx.length < 9) {
      return { year: 9999, month: 12, sequence: 9999 }; // Put invalid LSX at the end
    }
    
    // Get last 9 characters: mmyy/xxxx
    const last9Chars = lsx.slice(-9);
    const parts = last9Chars.split('/');
    
    if (parts.length !== 2) {
      return { year: 9999, month: 12, sequence: 9999 }; // Invalid format
    }
    
    const mmyy = parts[0]; // MMYY
    const xxxx = parts[1]; // XXXX
    
    if (mmyy.length !== 4 || xxxx.length !== 4) {
      return { year: 9999, month: 12, sequence: 9999 }; // Invalid format
    }
    
    const month = parseInt(mmyy.substring(0, 2));
    const year = parseInt(mmyy.substring(2, 4)) + 2000; // Convert YY to full year
    const sequence = parseInt(xxxx);
    
    return { year, month, sequence };
  }

  // Helper method to parse Batch for sorting
  // Format 8 ký tự: WWMMSSSS (ví dụ 05020003 = tuần 05, 02, thứ tự 0003)
  private parseBatchForSorting(batch: string): { week: number, middle: number, sequence: number } {
    const def = { week: 9999, middle: 99, sequence: 9999 };
    if (!batch || batch.length < 6) return def;
    const week = parseInt(batch.substring(0, 2), 10) || 0;
    // 8 ký tự: WWMMSSSS → middle 2 số, sequence 4 số cuối
    if (batch.length >= 8) {
      const middle = parseInt(batch.substring(2, 4), 10) || 0;
      const sequence = parseInt(batch.substring(4, 8), 10) ?? 9999;
      return { week, middle, sequence };
    }
    // 6 ký tự: WWXXXX (cũ)
    const sequence = parseInt(batch.substring(2, 6), 10) ?? 9999;
    return { week, middle: 0, sequence };
  }

  // Sort materials FIFO: Mã TP (A,B,C) rồi BATCH (số thứ tự trước sau)
  sortMaterials(): void {
    this.materials.sort((a, b) => {
      // 1. Mã TP theo A, B, C
      const materialCodeA = (a.materialCode || '').toString().toUpperCase();
      const materialCodeB = (b.materialCode || '').toString().toUpperCase();
      const codeCompare = materialCodeA.localeCompare(materialCodeB);
      if (codeCompare !== 0) return codeCompare;
      
      // 2. Cùng Mã TP → sắp theo BATCH (số thứ tự trước sau: week → middle → sequence)
      const batchA = this.parseBatchForSorting(a.batchNumber);
      const batchB = this.parseBatchForSorting(b.batchNumber);
      if (batchA.week !== batchB.week) return batchA.week - batchB.week;
      if (batchA.middle !== batchB.middle) return batchA.middle - batchB.middle;
      return batchA.sequence - batchB.sequence;
    });
  }

  // Apply search filters
  applyFilters(): void {
    this.filteredMaterials = this.materials.filter(material => {
      // Filter by search term (chuẩn hóa: bỏ dấu chấm để "P011022.E" khớp "P011022")
      if (this.searchTerm && this.searchTerm.trim() !== '') {
        const term = (this.searchTerm || '').trim().toUpperCase();
        const termNorm = term.replace(/\./g, '');
        const searchableText = [
          material.materialCode,
          material.batchNumber,
          material.location,
          material.lsx,
          material.lot,
          material.ton?.toString(),
          material.notes,
          material.customer
        ].filter(Boolean).join(' ').toUpperCase();
        const textNorm = searchableText.replace(/\./g, '');
        const match = searchableText.includes(term) || textNorm.includes(termNorm);
        if (!match) return false;
      }

      // Filter by factory (TOTAL = xem tất cả)
      if (this.selectedFactory && this.selectedFactory !== 'TOTAL') {
        const materialFactory = material.factory || 'ASM1';
        if (materialFactory !== this.selectedFactory) {
          return false;
        }
      }
      
      // Filter by date range (startDate/endDate là string 'yyyy-MM-dd')
      let isInDateRange = true;
      if (this.startDate && this.endDate) {
        const importDate = new Date(material.importDate);
        const start = new Date(this.startDate + 'T00:00:00');
        const end   = new Date(this.endDate   + 'T23:59:59');
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
          isInDateRange = importDate >= start && importDate <= end;
        }
      }

      // Filter by completed status
      const isCompletedVisible = this.showCompleted || !material.isCompleted;

      return isInDateRange && isCompletedVisible;
    });
    
    // Sort FIFO: Mã TP (A,B,C) rồi BATCH (số thứ tự trước sau)
    this.filteredMaterials.sort((a, b) => {
      const materialCodeA = (a.materialCode || '').toString().toUpperCase();
      const materialCodeB = (b.materialCode || '').toString().toUpperCase();
      const codeCompare = materialCodeA.localeCompare(materialCodeB);
      if (codeCompare !== 0) return codeCompare;
      
      const batchA = this.parseBatchForSorting(a.batchNumber);
      const batchB = this.parseBatchForSorting(b.batchNumber);
      if (batchA.week !== batchB.week) return batchA.week - batchB.week;
      if (batchA.middle !== batchB.middle) return batchA.middle - batchB.middle;
      return batchA.sequence - batchB.sequence;
    });
    
    console.log('FG Inventory search results:', {
      searchTerm: this.searchTerm,
      totalMaterials: this.materials.length,
      filteredMaterials: this.filteredMaterials.length
    });
  }

  // Search functionality with debouncing
  onSearchChange(event: any): void {
    let searchTerm = event.target.value;
    
    // Auto-convert to uppercase
    if (searchTerm && searchTerm !== searchTerm.toUpperCase()) {
      searchTerm = searchTerm.toUpperCase();
      event.target.value = searchTerm;
    }
    
    // Clear results immediately if search is empty
    if (!searchTerm || searchTerm.trim() === '') {
      this.clearSearch();
      return;
    }
    
    // Send to debounced search
    this.searchSubject.next(searchTerm);
  }

  // Clear search and reset to initial state
  clearSearch(): void {
    this.searchTerm = '';
    this.applyFilters(); // Show all materials
    console.log('Cleared search - showing all materials');
  }

  // Perform search with minimum character requirement
  private performSearch(searchTerm: string): void {
    if (searchTerm.length < 3) {
      this.applyFilters(); // Show all materials if search too short
      console.log(`Search term "${searchTerm}" quá ngắn (cần ít nhất 3 ký tự) - showing all materials`);
      return;
    }
    
    this.searchTerm = searchTerm;
    this.applyFilters();
  }

  // Format number: dấu phẩy hàng nghìn, không có số thập phân
  formatNumber(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '0';
    }
    return value.toLocaleString('en-US', { maximumFractionDigits: 0, minimumFractionDigits: 0 });
  }

  setFactoryFilter(factory: string): void {
    this.selectedFactory = factory;
    this.applyFilters();
  }

  /** Số Batch đã chuẩn hóa (trim, uppercase) - mỗi số batch phải riêng biệt trong kho */
  private getBatchNormalized(material: FGInventoryItem): string {
    return String(material.batchNumber || '').trim().toUpperCase();
  }

  /** Danh sách số Batch đang trùng (cùng số batch xuất hiện > 1 lần trong filteredMaterials) */
  getDuplicateBatchKeys(): string[] {
    const countByBatch = new Map<string, number>();
    this.filteredMaterials.forEach(m => {
      const batch = this.getBatchNormalized(m);
      if (batch) countByBatch.set(batch, (countByBatch.get(batch) || 0) + 1);
    });
    return Array.from(countByBatch.entries())
      .filter(([, count]) => count > 1)
      .map(([batch]) => batch);
  }

  /** Có đang tồn tại trùng Batch không */
  hasDuplicateBatches(): boolean {
    return this.getDuplicateBatchKeys().length > 0;
  }

  /** Dòng này có số Batch trùng không (số batch này xuất hiện ở nhiều dòng) */
  isBatchDuplicate(material: FGInventoryItem): boolean {
    const batch = this.getBatchNormalized(material);
    if (!batch) return false;
    const count = this.filteredMaterials.filter(m => this.getBatchNormalized(m) === batch).length;
    return count > 1;
  }

  /** Chuỗi mô tả các số Batch trùng (để hiển thị trong box) */
  getDuplicateBatchMessage(): string {
    const batches = this.getDuplicateBatchKeys();
    return batches.length === 0 ? '' : batches.join('; ');
  }

  // Load user permissions
  loadPermissions(): void {
    this.hasDeletePermission = true;
    this.hasCompletePermission = true;
  }

  // Load factory access permissions
  private loadFactoryAccess(): void {
    this.availableFactories = ['ASM1', 'ASM2', 'TOTAL'];
    
    console.log('🏭 Factory access set for FG Inventory (ASM1 only):', {
      selectedFactory: this.selectedFactory,
      availableFactories: this.availableFactories
    });
  }

  // Check if user can edit material
  canEditMaterial(material: FGInventoryItem): boolean {
    const materialFactory = material.factory || 'ASM1';
    return this.availableFactories.includes(materialFactory);
  }

  // Check if user can view material
  canViewMaterial(material: FGInventoryItem): boolean {
    const materialFactory = material.factory || 'ASM1';
    return this.availableFactories.includes(materialFactory);
  }

  // Format date
  private formatDate(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  // Import file functionality
  importFile(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,.xls';
    fileInput.style.display = 'none';
    
    fileInput.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.processExcelFile(file);
      }
    };
    
    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
  }

  private async processExcelFile(file: File): Promise<void> {
    try {
      const data = await this.readExcelFile(file);
      const materials = this.parseExcelData(data);
      
      this.materials = [...this.materials, ...materials];
      this.applyFilters();
      
      // Save to Firebase
      this.saveMaterialsToFirebase(materials);
      
      alert(`✅ Đã import thành công ${materials.length} materials từ file Excel!`);
      
    } catch (error) {
      console.error('Error processing Excel file:', error);
      alert(`❌ Lỗi khi import file Excel: ${error.message || error}`);
    }
  }

  private async readExcelFile(file: File): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);
          resolve(jsonData);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  private parseExcelData(data: any[]): FGInventoryItem[] {
    return data.map((row: any, index: number) => ({
      factory: 'ASM1',
      importDate: new Date(),
      receivedDate: new Date(),
      batchNumber: row['Batch'] || '',
      materialCode: row['Mã TP'] || '',
      lot: row['LOT'] || '',
      lsx: row['LSX'] || '',
      quantity: 0, // Not used in FG Inventory
      standard: 0, // Will be calculated from catalog
      carton: 0, // Will be calculated
      odd: 0, // Will be calculated
      tonDau: parseInt(row['Tồn Đầu']) || 0,
      nhap: 0, // Not in new template - will be set to 0
      xuat: 0, // Not in new template - will be set to 0
      ton: parseInt(row['Tồn Đầu']) || 0, // Initial ton = tonDau
      location: row['Vị Trí'] || 'Temporary',
      notes: '', // Not in new template
      customer: row['Khách'] || '',
      isReceived: true,
      isCompleted: false,
      isDuplicate: false,
      createdAt: new Date(),
      updatedAt: new Date()
    }));
  }

  private parseDate(dateStr: string): Date | null {
    if (!dateStr || dateStr.trim() === '') return null;
    
    if (typeof dateStr === 'string' && dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      }
    }
    
    return new Date(dateStr);
  }

  // Save materials to Firebase
  saveMaterialsToFirebase(materials: FGInventoryItem[]): void {
    materials.forEach(material => {
      const materialData = {
        ...material,
        importDate: material.importDate,
        receivedDate: material.receivedDate,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      delete materialData.id;
      
      this.firestore.collection('fg-inventory').add(materialData)
        .then((docRef) => {
          console.log('FG Inventory material saved to Firebase successfully with ID:', docRef.id);
        })
        .catch(error => {
          console.error('Error saving FG Inventory material to Firebase:', error);
        });
    });
  }

  // Download template
  downloadTemplate(): void {
    const templateData = [
      {
        'Batch': '010001',
        'Mã TP': 'P001234',
        'LOT': 'LOT001',
        'LSX': '0124/0001',
        'Tồn Đầu': 100,
        'Vị Trí': 'A1-01',
        'Khách': 'Customer A'
      },
      {
        'Batch': '010002',
        'Mã TP': 'P002345',
        'LOT': 'LOT002',
        'LSX': '0124/0002',
        'Tồn Đầu': 200,
        'Vị Trí': 'A1-02',
        'Khách': 'Customer B'
      },
      {
        'Batch': '020001',
        'Mã TP': 'P003456',
        'LOT': 'LOT003',
        'LSX': '0224/0001',
        'Tồn Đầu': 150,
        'Vị Trí': 'B1-01',
        'Khách': 'Customer C'
      }
    ];

    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(templateData);
    
    // Set column widths for better readability
    const colWidths = [
      { wch: 10 }, // Batch
      { wch: 12 }, // Mã TP
      { wch: 10 }, // LOT
      { wch: 12 }, // LSX
      { wch: 12 }, // Tồn Đầu
      { wch: 10 }, // Vị Trí
      { wch: 15 }  // Khách
    ];
    ws['!cols'] = colWidths;
    
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'FG_Inventory_Template.xlsx');
  }

  // Additional methods needed for the component
  editLocation(material: FGInventoryItem): void {
    const newLocation = prompt('Nhập vị trí (sẽ tự động viết hoa):', material.location || '');
    if (newLocation !== null) {
      material.location = newLocation.toUpperCase();
      material.updatedAt = new Date();
      console.log(`Updated location for ${material.materialCode}: ${material.location}`);
      this.updateMaterialInFirebase(material);
    }
  }



  updateNotes(material: FGInventoryItem): void {
    console.log('Updating notes for material:', material.materialCode, 'to:', material.notes);
    this.updateMaterialInFirebase(material);
  }

  // Scan location using QR code
  scanLocation(material: FGInventoryItem): void {
    const dialogData: QRScannerData = {
      title: `Scan QR Code - Đổi vị trí cho ${material.materialCode}`,
      message: `Vị trí hiện tại: ${material.location || 'Temporary'}`,
      materialCode: material.materialCode
    };

    const dialogRef = this.dialog.open(QRScannerModalComponent, {
      width: '500px',
      maxWidth: '95vw',
      data: dialogData,
      disableClose: true,
      panelClass: 'qr-scanner-dialog'
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result && result.trim() !== '') {
        const oldLocation = material.location;
        material.location = result.toUpperCase();
        
        // Update in Firebase
        this.updateMaterialInFirebase(material);
        
        console.log(`Updated location for ${material.materialCode}: ${oldLocation} → ${result}`);
        alert(`✅ Đã cập nhật vị trí cho ${material.materialCode}: ${result}`);
      }
    });
  }

  // Load catalog from Firebase (only once)
  loadCatalogFromFirebase(): void {
    if (this.catalogLoaded) {
      return; // Already loaded
    }

    this.firestore.collection('fg-catalog')
      .get()
      .subscribe((querySnapshot) => {
        this.catalogItems = querySnapshot.docs.map(doc => {
          const data = doc.data() as any;
          return {
            id: doc.id,
            materialCode: data.materialCode || '',
            standard: data.standard || '',
            customer: data.customer || '',
            createdAt: data.createdAt ? new Date(data.createdAt.seconds * 1000) : new Date(),
            updatedAt: data.updatedAt ? new Date(data.updatedAt.seconds * 1000) : new Date()
          };
        });
        this.catalogLoaded = true;
        console.log('Catalog loaded once:', this.catalogItems.length, 'items');
        
        // Only calculate Tồn - other data comes from FG In
      });
  }

  // Load Customer Code Mapping từ Firebase (Tên Khách Hàng = description)
  loadMappingFromFirebase(): void {
    this.firestore.collection('fg-customer-mapping')
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe(actions => {
        const firebaseMapping = actions.map(action => {
          const data = action.payload.doc.data() as any;
          return {
            id: action.payload.doc.id,
            customerCode: data.customerCode || '',
            materialCode: data.materialCode || '',
            description: data.description || ''
          };
        });
        this.mappingItems = firebaseMapping;
        console.log('Loaded Customer Code Mapping from Firebase:', this.mappingItems.length);
      });
  }

  // Lấy Tên khách hàng từ Mapping (cột Tên Khách Hàng = description)
  getCustomerNameFromMapping(materialCode: string): string {
    const mapping = this.mappingItems.find(item => item.materialCode === materialCode);
    return mapping ? (mapping.description || '') : '';
  }

  // Get customer from material data (no catalog lookup needed)
  getCustomerFromCatalog(materialCode: string): string {
    // Customer data comes from FG In, no lookup needed
    return '';
  }

  // Calculate Carton and ODD - data comes from FG In
  calculateCartonAndOdd(material: FGInventoryItem): { carton: number, odd: number } {
    // Data already calculated in FG In, just return stored values
    return { 
      carton: material.carton || 0, 
      odd: material.odd || 0 
    };
  }

  // Calculate and save Standard/Carton/ODD for materials that don't have them
  calculateAndSaveCartonOdd(): void {
    if (!this.catalogLoaded) {
      console.log('Catalog not loaded yet, skipping calculation');
      return; // Wait for catalog to load
    }

    console.log('Starting Standard/Carton/ODD calculation for', this.materials.length, 'materials');
    const materialsToUpdate: FGInventoryItem[] = [];

    this.materials.forEach(material => {
      let needsUpdate = false;
      
      // Get standard from catalog
      const catalogItem = this.catalogItems.find(item => item.materialCode === material.materialCode);
      if (catalogItem && catalogItem.standard && !isNaN(parseFloat(catalogItem.standard))) {
        const standardValue = parseFloat(catalogItem.standard);
        if (material.standard !== standardValue) {
          material.standard = standardValue;
          needsUpdate = true;
        }
      }
      
      // Calculate Tồn: Tồn Đầu + Nhập - Xuất = Tồn
      const calculatedTon = (material.tonDau || 0) + (material.nhap || 0) - (material.xuat || 0);
      if (material.ton !== calculatedTon) {
        material.ton = calculatedTon;
        needsUpdate = true;
      }
      
      // Calculate Carton/ODD if standard is available
      if (material.standard > 0) {
        const tonToUse = material.ton || 0;
        const newCarton = Math.ceil(tonToUse / material.standard);
        const newOdd = tonToUse % material.standard;
        
        if (material.carton !== newCarton || material.odd !== newOdd) {
          material.carton = newCarton;
          material.odd = newOdd;
          needsUpdate = true;
        }
      }
      
      if (needsUpdate) {
        materialsToUpdate.push(material);
        console.log(`Will update ${material.materialCode}: Tồn=${material.ton}, Standard=${material.standard}, Carton=${material.carton}, ODD=${material.odd}`);
      }
    });

    // Save updated materials to Firebase
    if (materialsToUpdate.length > 0) {
      console.log(`Updating Tồn/Standard/Carton/ODD for ${materialsToUpdate.length} materials`);
      materialsToUpdate.forEach(material => {
        this.updateMaterialInFirebase(material);
      });
    } else {
      console.log('No materials need Tồn/Standard/Carton/ODD calculation');
    }
  }

  // Calculate Tồn for a specific material - SIMPLIFIED
  calculateTon(material: FGInventoryItem): number {
    const tonDau = material.tonDau || 0;
    const nhap = material.nhap || 0;
    const xuat = material.xuat || 0;
    return tonDau + nhap - xuat;
  }

  // Update Tồn when Tồn đầu, Nhập, or Xuất changes
  updateTon(material: FGInventoryItem): void {
    this.recalculateTon(material);
    
    // Recalculate Carton/ODD based on new Tồn
    if (material.standard > 0) {
      material.carton = Math.ceil(material.ton / material.standard);
      material.odd = material.ton % material.standard;
    }
    
    this.updateMaterialInFirebase(material);
    console.log(`Updated Tồn for ${material.materialCode}: ${material.ton}, Carton: ${material.carton}, ODD: ${material.odd}`);
  }

  // Debug Carton/ODD calculation
  debugCartonOdd(): void {
    console.log('=== DEBUG CARTON/ODD ===');
    console.log('Catalog loaded:', this.catalogLoaded);
    console.log('Catalog items:', this.catalogItems.length);
    console.log('Total materials:', this.materials.length);
    console.log('Filtered materials:', this.filteredMaterials.length);
    
    this.catalogItems.forEach((item, index) => {
      console.log(`Catalog ${index + 1}:`, {
        materialCode: item.materialCode,
        standard: item.standard,
        customer: item.customer
      });
    });
    
    this.materials.forEach((material, index) => {
      const calculation = this.calculateCartonAndOdd(material);
      const calculatedTon = this.calculateTon(material);
      console.log(`Material ${index + 1}:`, {
        materialCode: material.materialCode,
        tonDau: material.tonDau,
        nhap: material.nhap,
        xuat: material.xuat,
        ton: material.ton,
        calculatedTon: calculatedTon,
        standard: material.standard,
        carton: material.carton,
        odd: material.odd,
        calculatedCarton: calculation.carton,
        calculatedOdd: calculation.odd
      });
    });
    console.log('=== END DEBUG ===');
  }

  // Force calculate Tồn for all materials
  forceCalculateTon(): void {
    console.log('Force calculating Tồn for all materials...');
    const materialsToUpdate: FGInventoryItem[] = [];

    this.materials.forEach(material => {
      const calculatedTon = this.calculateTon(material);
      if (material.ton !== calculatedTon) {
        material.ton = calculatedTon;
        
        // Recalculate Carton/ODD based on new Tồn
        if (material.standard > 0) {
          material.carton = Math.ceil(material.ton / material.standard);
          material.odd = material.ton % material.standard;
        }
        
        materialsToUpdate.push(material);
        console.log(`Updated ${material.materialCode}: Tồn=${material.ton}, Carton=${material.carton}, ODD=${material.odd}`);
      }
    });

    // Save updated materials to Firebase
    if (materialsToUpdate.length > 0) {
      console.log(`Updating Tồn for ${materialsToUpdate.length} materials`);
      materialsToUpdate.forEach(material => {
        this.updateMaterialInFirebase(material);
      });
      alert(`✅ Đã cập nhật Tồn cho ${materialsToUpdate.length} materials!`);
    } else {
      console.log('No materials need Tồn calculation');
      alert('ℹ️ Tất cả materials đã có Tồn chính xác!');
    }
  }

  // Check raw data from Firebase
  checkRawData(): void {
    console.log('=== CHECKING RAW DATA ===');
    console.log('Total materials:', this.materials.length);
    
    this.materials.forEach((material, index) => {
      console.log(`Material ${index + 1} (${material.materialCode}):`, {
        id: material.id,
        tonDau: material.tonDau,
        nhap: material.nhap,
        xuat: material.xuat,
        ton: material.ton,
        standard: material.standard,
        carton: material.carton,
        odd: material.odd,
        allProperties: Object.keys(material)
      });
    });
    
    // Check if materials have any data at all
    if (this.materials.length === 0) {
      console.log('❌ No materials found!');
      alert('❌ Không có dữ liệu materials nào!');
    } else {
      console.log('✅ Found materials, check console for details');
      alert(`✅ Tìm thấy ${this.materials.length} materials. Xem console để kiểm tra chi tiết.`);
    }
    console.log('=== END CHECKING RAW DATA ===');
  }

  // Reset all data to zero
  resetAllData(): void {
    if (this.materials.length === 0) {
      alert('✅ Không có dữ liệu để reset!');
      return;
    }

    const confirmMessage = `⚠️ CẢNH BÁO!\n\nBạn có chắc chắn muốn xóa TOÀN BỘ dữ liệu trong FG Inventory?\n\nSẽ xóa ${this.materials.length} materials.\n\nHành động này KHÔNG THỂ HOÀN TÁC!`;
    
    if (confirm(confirmMessage)) {
      this.isLoading = true;
      console.log('🗑️ Starting reset of all FG Inventory data...');
      
      // Delete all materials from Firebase
      const batch = this.firestore.firestore.batch();
      this.materials.forEach(material => {
        if (material.id) {
          const materialRef = this.firestore.collection('fg-inventory').doc(material.id).ref;
          batch.delete(materialRef);
        }
      });
      
      batch.commit()
        .then(() => {
          console.log('✅ All FG Inventory data deleted successfully');
          
          // Clear local data
          this.materials = [];
          this.filteredMaterials = [];
          
          this.isLoading = false;
          alert(`✅ Đã xóa thành công tất cả materials!\n\nFG Inventory đã được reset về 0.`);
        })
        .catch(error => {
          console.error('❌ Error deleting FG Inventory data:', error);
          this.isLoading = false;
          alert(`❌ Lỗi khi xóa dữ liệu: ${error.message}`);
        });
    }
  }



  viewAllMaterials(): void {
    this.searchTerm = '';
    this.startDate = '2020-01-01';
    this.endDate = '2030-12-31';
    this.showCompleted = true;
    this.selectedFactory = 'TOTAL';
    this.applyFilters();
    this.showTimeRangeDialog = false;
    
    console.log('Cleared search - all materials hidden:', {
      totalMaterials: this.materials.length,
      filteredMaterials: this.filteredMaterials.length
    });
  }

  applyTimeRangeFilter(): void {
    this.applyFilters();
    this.showTimeRangeDialog = false;
  }

  // Open Create PX Dialog
  openCreatePXDialog(material: FGInventoryItem): void {
    this.selectedMaterial = material;
    this.pxForm = {
      shipment: '',
      quantity: 0,
      notes: ''
    };
    this.showCreatePXDialog = true;
  }

  // Check if PX form is valid
  isPXFormValid(): boolean {
    return !!(this.pxForm.shipment.trim() && 
              this.pxForm.quantity > 0 && 
              this.pxForm.quantity <= (this.selectedMaterial?.ton || 0));
  }

  // Create PX (Phiếu Xuất)
  createPX(): void {
    if (!this.selectedMaterial || !this.isPXFormValid()) {
      alert('❌ Vui lòng nhập đầy đủ thông tin!');
      return;
    }

    // Confirm before creating
    const confirmMessage = `✅ Xác nhận tạo phiếu xuất?\n\n` +
      `Mã TP: ${this.selectedMaterial.materialCode}\n` +
      `Batch: ${this.selectedMaterial.batchNumber}\n` +
      `Shipment: ${this.pxForm.shipment}\n` +
      `Số lượng: ${this.pxForm.quantity}\n\n` +
      `Dữ liệu sẽ được tạo trong FG Out.`;
    
    if (!confirm(confirmMessage)) {
      return;
    }

    // Generate PushNo
    const now = new Date();
    const day = now.getDate().toString().padStart(2, '0');
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const pushNo = day + month + hours + minutes;

    // Create FG Out record
    const fgOutRecord = {
      factory: 'ASM1',
      exportDate: now,
      shipment: this.pxForm.shipment.trim(),
      materialCode: this.selectedMaterial.materialCode,
      customerCode: this.selectedMaterial.customer || '',
      batchNumber: this.selectedMaterial.batchNumber,
      lsx: this.selectedMaterial.lsx,
      lot: this.selectedMaterial.lot,
      quantity: this.pxForm.quantity,
      poShip: '', // Empty for special PX
      carton: Math.ceil(this.pxForm.quantity / 100), // Default carton calculation
      qtyBox: 100, // Default QTYBOX
      odd: this.pxForm.quantity % 100, // Calculate odd
      location: this.selectedMaterial.location || '',
      notes: this.pxForm.notes.trim() || `Tạo từ FG Inventory - ${now.toLocaleString('vi-VN')}`,
      updateCount: 1,
      pushNo: pushNo,
      approved: false, // Not approved yet
      createdAt: now,
      updatedAt: now
    };

    // Save to Firebase
    this.firestore.collection('fg-out').add(fgOutRecord)
      .then(() => {
        console.log('✅ Created special PX in FG Out:', fgOutRecord);
        
        const successMessage = `✅ Đã tạo phiếu xuất thành công!\n\n` +
          `Mã TP: ${this.selectedMaterial.materialCode}\n` +
          `Shipment: ${this.pxForm.shipment}\n` +
          `Số lượng: ${this.pxForm.quantity}\n` +
          `PushNo: ${pushNo}\n\n` +
          `Vui lòng vào FG Out để duyệt xuất.`;
        
        alert(successMessage);
        this.showCreatePXDialog = false;
      })
      .catch(error => {
        console.error('❌ Error creating PX:', error);
        alert(`❌ Lỗi khi tạo phiếu xuất: ${error.message}`);
      });
  }


}


