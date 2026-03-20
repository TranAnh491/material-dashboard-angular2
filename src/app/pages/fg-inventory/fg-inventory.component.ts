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
  poNumber?: string; // Số PO từ FG In
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
  
  // Factory filter — mặc định ASM1 (không dùng TOTAL khi mở tab)
  selectedFactory: string = 'ASM1';
  availableFactories: string[] = ['ASM1', 'ASM2', 'TOTAL'];

  // Catalog data (loaded once)
  catalogItems: ProductCatalogItem[] = [];
  catalogLoaded: boolean = false;

  // Customer Code Mapping (Tên Khách Hàng = description)
  mappingItems: CustomerCodeMappingItem[] = [];

  // Search optimization
  private searchSubject = new Subject<string>();

  /** Cache tổng Nhập/Xuất theo key Mã TP|Batch|LSX|LOT để đồng bộ từ FG In / FG Export */
  private fgInQtyByKey = new Map<string, number>();
  private fgInPoByBatchKey = new Map<string, Set<string>>(); // batch → tập hợp PO từ fg-in
  /** Cache theo Batch (chỉ dựa vào số batch) */
  private fgInQtyByBatchKey = new Map<string, number>();
  
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

  // Reset dialog
  showResetDialog: boolean = false;
  resetSelectedFactory: string = 'ASM1';

  // More menu popup
  showMoreMenu: boolean = false;
  
  // Factory menu popup
  showFactoryMenu: boolean = false;

  // Import progress dialog (hiển thị trong quá trình import)
  showImportProgressDialog: boolean = false;
  importProgressCurrentBatch: number = 0;
  importProgressTotalBatches: number = 0;
  importProgressImportedCount: number = 0;
  importProgressTotalCount: number = 0;

  // Import success dialog
  showImportSuccessDialog: boolean = false;
  importSuccessCount: number = 0;
  importSkippedCount: number = 0;  // Số dòng bỏ qua do trùng

  // Duplicate batch dialog
  showDuplicateBatchDialog: boolean = false;
  duplicateBatchPassword: string = '';
  duplicateBatchPasswordError: string = '';
  duplicateBatchAuthenticated: boolean = false;
  isFixingDuplicateBatches: boolean = false;
  private readonly DUPLICATE_BATCH_PASSWORD = '111';
  
  // Display options
  showCompleted: boolean = true;
  showNonStock: boolean = false; // false = ẩn ton=0; true (Non Stock mode) = chỉ hiện ton=0
  showNegativeStock: boolean = false; // true = chỉ hiện ton < 0 (tồn âm)
  
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

  /** Chỉ cho sửa "Tồn đầu" với dòng import tồn đầu (batch TDAU1-/TDAU2-) */
  isTonDauEditable(material: FGInventoryItem): boolean {
    const batch = (material?.batchNumber || '').toString().trim().toUpperCase();
    return batch.startsWith('TDAU1-') || batch.startsWith('TDAU2-');
  }

  ngOnInit(): void {
    this.setupDebouncedSearch();
    this.loadCatalogFromFirebase(); // Load catalog first
    this.loadMappingFromFirebase(); // Load mapping for customer names
    this.subscribeFGInOutCaches();  // Đồng bộ Nhập/Xuất từ fg-in và fg-export
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

        // Đồng bộ lại cột Nhập/Xuất/Tồn theo cache từ fg-in và fg-export
        this.applyFGInOutCachesToMaterials();

        this.sortMaterials();
        this.applyFilters();
        this.isLoading = false;
        this.cdr.detectChanges();
      });
  }

  /** Key chuẩn hoá để map Nhập/Xuất theo đúng dòng (Mã TP|Batch|LSX|LOT). */
  private fgKey(materialCode: any, batchNumber: any, lsx: any, lot: any): string {
    return [
      String(materialCode || '').trim().toUpperCase(),
      String(batchNumber || '').trim().toUpperCase(),
      String(lsx || '').trim().toUpperCase(),
      String(lot || '').trim().toUpperCase()
    ].join('|');
  }

  /** Key theo Batch (chỉ dựa vào số batch). */
  private fgBatchKey(batchNumber: any): string {
    return String(batchNumber || '').trim().toUpperCase();
  }

  /** Subscribe 1 lần để lấy tổng Nhập/Xuất từ fg-in và fg-out (đúng theo tab FG Out). */
  private subscribeFGInOutCaches(): void {
    // FG In: tổng nhập theo key + PO theo batch
    this.firestore.collection('fg-in')
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe(actions => {
        this.fgInQtyByKey.clear();
        this.fgInQtyByBatchKey.clear();
        this.fgInPoByBatchKey.clear();
        actions.forEach(a => {
          const d = a.payload.doc.data() as any;
          const k = this.fgKey(d.materialCode, d.batchNumber, d.lsx, d.lot);
          const bk = this.fgBatchKey(d.batchNumber);
          const q = Number(d.quantity) || 0;
          if (k && k !== '|||') {
            this.fgInQtyByKey.set(k, (this.fgInQtyByKey.get(k) || 0) + q);
          }
          if (bk) {
            this.fgInQtyByBatchKey.set(bk, (this.fgInQtyByBatchKey.get(bk) || 0) + q);
            // Gộp tất cả số PO unique theo batch (1 batch có thể nhiều phiếu nhập / nhiều PO)
            const po = String(d.poNumber || d.soPO || '').trim();
            if (po) {
              if (!this.fgInPoByBatchKey.has(bk)) {
                this.fgInPoByBatchKey.set(bk, new Set<string>());
              }
              this.fgInPoByBatchKey.get(bk)!.add(po);
            }
          }
        });
        this.applyFGInOutCachesToMaterials();
        this.applyFilters();
        this.cdr.detectChanges();
      });
  }

  /**
   * Ghi đè số Nhập/Xuất hiển thị theo cache:
   * - Ưu tiên cache (fg-in/fg-export) nếu có key khớp.
   * - Tự tính lại `ton = tonDau + nhap - xuat` để cột Tồn kho đồng bộ.
   */
  private applyFGInOutCachesToMaterials(): void {
    if (!this.materials || this.materials.length === 0) return;
    this.materials.forEach(m => {
      // Theo yêu cầu: chỉ cộng theo số batch.
      // LOT/LSX/Mã TP chỉ là thông tin đi kèm của dòng batch trong fg-inventory.
      const bk = this.fgBatchKey(m.batchNumber);
      if (!bk) return;

      const nhapCache = this.fgInQtyByBatchKey.get(bk);

      if (nhapCache != null) m.nhap = nhapCache;

      // Gán PO number từ fg-in: gộp tất cả PO unique của batch bằng dấu ", "
      const poSet = this.fgInPoByBatchKey.get(bk);
      if (poSet && poSet.size > 0) m.poNumber = Array.from(poSet).join(', ');

      const tonDau = Number(m.tonDau) || 0;
      const nhap = Number(m.nhap) || 0;
      const xuat = Number(m.xuat) || 0;
      m.ton = tonDau + nhap - xuat;
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
      // ASM1: không hiển thị danh sách khi chưa search, phải bấm search mới hiện
      if (this.selectedFactory === 'ASM1' && (!this.searchTerm || this.searchTerm.trim() === '')) {
        return false;
      }

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

      // Filter by stock (ton): ẩn ton=0 theo mặc định; Non Stock mode = chỉ hiện ton=0
      const ton = material.ton ?? 0;
      if (this.showNegativeStock) {
        if (ton >= 0) return false; // Tồn Âm: chỉ hiện ton < 0
      } else if (this.showNonStock) {
        if (ton > 0) return false; // Non Stock: chỉ hiện ton=0
      } else {
        if (ton <= 0) return false; // Mặc định: ẩn ton=0 và tồn âm
      }

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

  /** Danh sách nhóm trùng batch: mỗi nhóm có batchKey và materials */
  getDuplicateBatchGroups(): { batchKey: string; materials: FGInventoryItem[] }[] {
    const keys = this.getDuplicateBatchKeys();
    return keys.map(batchKey => ({
      batchKey,
      materials: this.filteredMaterials.filter(m => this.getBatchNormalized(m) === batchKey)
    }));
  }

  // --- Duplicate Batch Dialog ---
  openDuplicateBatchDialog(): void {
    this.showDuplicateBatchDialog = true;
    this.duplicateBatchPassword = '';
    this.duplicateBatchPasswordError = '';
    this.duplicateBatchAuthenticated = false;
    this.cdr.detectChanges();
  }

  closeDuplicateBatchDialog(): void {
    this.showDuplicateBatchDialog = false;
    this.duplicateBatchPassword = '';
    this.duplicateBatchPasswordError = '';
    this.duplicateBatchAuthenticated = false;
    this.cdr.detectChanges();
  }

  verifyDuplicateBatchPassword(): void {
    this.duplicateBatchPasswordError = '';
    if (this.duplicateBatchPassword.trim() === this.DUPLICATE_BATCH_PASSWORD) {
      this.duplicateBatchAuthenticated = true;
      this.duplicateBatchPassword = '';
    } else {
      this.duplicateBatchPasswordError = 'Mật khẩu không đúng.';
    }
    this.cdr.detectChanges();
  }

  async fixDuplicateBatches(): Promise<void> {
    if (this.isFixingDuplicateBatches) return;
    const groups = this.getDuplicateBatchGroups();
    if (groups.length === 0) return;

    this.isFixingDuplicateBatches = true;
    this.cdr.detectChanges();

    try {
      let updatedCount = 0;
      for (const group of groups) {
        const { materials } = group;
        const baseBatch = materials[0].batchNumber || group.batchKey;
        // Giữ dòng đầu, sửa các dòng còn lại: thêm suffix -02, -03, -04...
        for (let i = 1; i < materials.length; i++) {
          const m = materials[i];
          const newBatch = `${baseBatch}-${(i + 1).toString().padStart(2, '0')}`;
          if (m.id) {
            await this.firestore.collection('fg-inventory').doc(m.id).update({
              batchNumber: newBatch,
              updatedAt: new Date()
            });
            m.batchNumber = newBatch;
            updatedCount++;
          }
        }
      }
      // Dữ liệu sẽ tự cập nhật qua snapshot listener
      this.closeDuplicateBatchDialog();
      alert(`✅ Đã sửa ${updatedCount} số batch trùng.`);
    } catch (err) {
      console.error('Error fixing duplicate batches:', err);
      alert('Lỗi khi sửa batch: ' + (err as Error).message);
    } finally {
      this.isFixingDuplicateBatches = false;
      this.cdr.detectChanges();
    }
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
      this.isLoading = true;
      const rawData = await this.readExcelFile(file);
      const materials = this.parseExcelData(rawData);
      
      // Tính Carton, ODD từ catalog (nếu có)
      materials.forEach(m => {
        const catalogItem = this.catalogItems.find(c => c.materialCode === m.materialCode);
        const standard = catalogItem?.standard ? parseFloat(String(catalogItem.standard)) : 0;
        if (standard > 0) {
          m.carton = Math.ceil(m.tonDau / standard);
          m.odd = m.tonDau % standard;
        }
      });
      
      // Hiển thị popup tiến trình import
      const totalBatches = Math.ceil(materials.length / this.IMPORT_CHUNK_SIZE);
      this.importProgressTotalBatches = totalBatches;
      this.importProgressTotalCount = materials.length;
      this.importProgressCurrentBatch = 0;
      this.importProgressImportedCount = 0;
      this.showImportProgressDialog = true;
      this.cdr.detectChanges();
      
      // Save to Firebase - chia nhỏ từng phần
      await this.saveMaterialsToFirebase(materials);
      
      // Đóng popup tiến trình, hiển thị popup thành công
      this.showImportProgressDialog = false;
      this.isLoading = false;
      this.importSuccessCount = materials.length - this.importSkippedCount;  // Số dòng thực sự đã thêm
      this.showImportSuccessDialog = true;
      this.cdr.detectChanges();
      
    } catch (error) {
      console.error('Error processing Excel file:', error);
      this.isLoading = false;
      this.showImportProgressDialog = false;
      alert(`❌ Lỗi khi import file Excel: ${error.message || error}`);
    }
  }

  closeImportSuccessDialog(): void {
    this.showImportSuccessDialog = false;
    this.importSuccessCount = 0;
  }

  private async readExcelFile(file: File): Promise<any[][]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          // header: 1 = array of arrays (theo cột A, B, C...)
          const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
          resolve(rawData);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  // Kiểm tra row có phải header không
  private isHeaderRow(row: any[]): boolean {
    if (!row || row.length === 0) return true;
    const first = String(row[0] || '').toLowerCase();
    const third = String(row[2] || '').toLowerCase();
    return first.includes('nhà máy') || first.includes('factory') ||
           third.includes('mã') || third.includes('ma tp');
  }

  // Parse dữ liệu import tồn đầu - cột: A=Nhà máy, C=Mã TP, D=LOT, E=LSX, F=Tồn đầu, G=Vị trí, H=Ghi chú
  // Batch tự sinh: TDAU000001, TDAU000002... (đọc batch biết là import tồn đầu)
  // Loại trùng: gộp các dòng trùng (Factory + Mã TP + LOT + LSX + Vị trí) bằng cách cộng dồn tồn đầu
  private parseExcelData(rawData: any[][]): FGInventoryItem[] {
    const rows = rawData.filter(r => r && r.length > 0);
    let startIndex = 0;
    if (rows.length > 0 && this.isHeaderRow(rows[0])) {
      startIndex = 1; // Bỏ qua dòng header
    }

    // Bước 1: Parse và gộp trùng theo key (factory|materialCode|lot|lsx|location)
    const mergedMap = new Map<string, { factory: string; materialCode: string; lot: string; lsx: string; location: string; tonDau: number; notes: string[] }>();
    
    for (let i = startIndex; i < rows.length; i++) {
      const row = rows[i];
      const factory = String(row[0] || '').trim() || 'ASM1';
      const materialCode = String(row[2] || '').trim(); // Cột C
      const lot = String(row[3] || '').trim();          // Cột D
      const lsx = String(row[4] || '').trim();          // Cột E
      const tonDau = parseInt(String(row[5] || '0'), 10) || 0;  // Cột F
      const location = String(row[6] || '').trim() || 'Temporary'; // Cột G
      const notes = String(row[7] || '').trim();        // Cột H

      // Bỏ qua dòng trống (không có mã TP hoặc tồn đầu = 0)
      if (!materialCode && tonDau === 0) continue;

      const key = `${factory}|${materialCode}|${lot}|${lsx}|${location}`.toUpperCase();
      const existing = mergedMap.get(key);
      
      if (existing) {
        existing.tonDau += tonDau;
        if (notes) existing.notes.push(notes);
      } else {
        mergedMap.set(key, {
          factory,
          materialCode,
          lot,
          lsx,
          location,
          tonDau,
          notes: notes ? [notes] : []
        });
      }
    }

    // Bước 2: Chuyển thành FGInventoryItem với batch tự sinh (ASM1: TDAU1-xxx, ASM2: TDAU2-xxx)
    const materials: FGInventoryItem[] = [];
    const seqByFactory: Record<string, number> = { ASM1: 1, ASM2: 1 };
    mergedMap.forEach((item) => {
      const factory = item.factory || 'ASM1';
      const prefix = factory === 'ASM2' ? 'TDAU2' : 'TDAU1';
      const seq = seqByFactory[factory] || 1;
      seqByFactory[factory] = seq + 1;
      const notes = item.notes.filter(n => n).join('; ');
      materials.push({
        factory,
        importDate: new Date(),
        receivedDate: new Date(),
        batchNumber: `${prefix}-${seq.toString().padStart(6, '0')}`,
        materialCode: item.materialCode || '',
        lot: item.lot,
        lsx: item.lsx,
        quantity: 0,
        standard: 0,
        carton: 0,
        odd: 0,
        tonDau: item.tonDau,
        nhap: 0,
        xuat: 0,
        ton: item.tonDau,
        location: item.location,
        notes,
        customer: '',
        isReceived: true,
        isCompleted: false,
        isDuplicate: false,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });
    return materials;
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

  // Save materials to Firebase - chia nhỏ từng phần (chunk), ghi tuần tự từng dòng tránh lỗi "Document already exists"
  private readonly IMPORT_CHUNK_SIZE = 50;

  async saveMaterialsToFirebase(materials: FGInventoryItem[]): Promise<void> {
    let batchIndex = 0;
    let savedCount = 0;
    this.importSkippedCount = 0;
    
    for (let i = 0; i < materials.length; i += this.IMPORT_CHUNK_SIZE) {
      const chunk = materials.slice(i, i + this.IMPORT_CHUNK_SIZE);
      batchIndex++;
      
      for (const material of chunk) {
        // Kiểm tra trùng: Mã TP + LOT + LSX + Tồn đầu + Vị trí
        const exists = await this.checkDuplicateExists(material);
        if (exists) {
          this.importSkippedCount++;
          continue;
        }
        
        const materialData: any = {
          factory: material.factory,
          importDate: material.importDate,
          receivedDate: material.receivedDate,
          batchNumber: material.batchNumber,
          materialCode: material.materialCode,
          lot: material.lot,
          lsx: material.lsx,
          quantity: material.quantity,
          standard: material.standard,
          carton: material.carton,
          odd: material.odd,
          tonDau: material.tonDau,
          nhap: material.nhap,
          xuat: material.xuat,
          ton: material.ton,
          location: material.location,
          notes: material.notes,
          customer: material.customer,
          isReceived: material.isReceived,
          isCompleted: material.isCompleted,
          isDuplicate: material.isDuplicate,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        await this.firestore.collection('fg-inventory').add(materialData);
        savedCount++;
      }
      
      // Cập nhật tiến trình cho popup
      this.importProgressCurrentBatch = batchIndex;
      this.importProgressImportedCount = savedCount + this.importSkippedCount;
      this.cdr.detectChanges();
      
      console.log(`✅ Batch ${batchIndex}/${this.importProgressTotalBatches}: saved ${chunk.length} items`);
    }
    console.log(`✅ Import done: ${savedCount} saved, ${this.importSkippedCount} skipped (duplicate)`);
  }

  // Kiểm tra đã tồn tại record trùng: Mã TP + LOT + LSX + Tồn đầu + Vị trí
  private async checkDuplicateExists(material: FGInventoryItem): Promise<boolean> {
    const snapshot = await this.firestore.collection('fg-inventory', ref =>
      ref.where('materialCode', '==', material.materialCode || '')
         .where('lot', '==', material.lot || '')
         .where('lsx', '==', material.lsx || '')
         .where('tonDau', '==', material.tonDau)
         .where('location', '==', material.location || '')
         .where('factory', '==', material.factory || 'ASM1')
         .limit(1)
    ).get().toPromise();
    
    return snapshot && !snapshot.empty;
  }

  // Download template - Import tồn đầu: A=Nhà máy, C=Mã TP, D=LOT, E=LSX, F=Tồn đầu, G=Vị trí, H=Ghi chú
  // Batch tự sinh (TDAU000001...) khi import
  downloadTemplate(): void {
    const templateData = [
      ['Nhà máy', '', 'Mã TP', 'LOT', 'LSX', 'Tồn đầu', 'Vị trí', 'Ghi chú'],
      ['ASM1', '', 'P001234', 'LOT001', '0124/0001', 100, 'A1-01', 'Ghi chú mẫu'],
      ['ASM1', '', 'P002345', 'LOT002', '0124/0002', 200, 'A1-02', ''],
      ['ASM2', '', 'P003456', 'LOT003', '0224/0001', 150, 'B1-01', '']
    ];

    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = XLSX.utils.aoa_to_sheet(templateData);
    
    const colWidths = [
      { wch: 10 },  // A: Nhà máy
      { wch: 5 },   // B: (trống)
      { wch: 12 },  // C: Mã TP
      { wch: 10 },  // D: LOT
      { wch: 12 },  // E: LSX
      { wch: 10 },  // F: Tồn đầu
      { wch: 10 },  // G: Vị trí
      { wch: 20 }   // H: Ghi chú
    ];
    ws['!cols'] = colWidths;
    
    XLSX.utils.book_append_sheet(wb, ws, 'Tồn đầu');
    XLSX.writeFile(wb, 'FG_Inventory_TonDau_Template.xlsx');
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

  // Reset dialog
  openResetDialog(): void {
    this.resetSelectedFactory = 'ASM1';
    this.showResetDialog = true;
  }

  closeResetDialog(): void {
    this.showResetDialog = false;
  }

  getResetMaterialCount(): number {
    if (this.resetSelectedFactory === 'TOTAL') {
      return this.materials.length;
    }
    return this.materials.filter(m => (m.factory || 'ASM1') === this.resetSelectedFactory).length;
  }

  /** Tải báo cáo tồn kho trước khi reset */
  downloadInventoryReport(factory: string): void {
    const list = factory === 'TOTAL'
      ? [...this.materials]
      : this.materials.filter(m => (m.factory || 'ASM1') === factory);
    if (list.length === 0) return;

    const excelData = list.map((m, i) => ({
      'No': i + 1,
      'Factory': m.factory || 'ASM1',
      'Batch': m.batchNumber,
      'Mã TP': m.materialCode,
      'LOT': m.lot,
      'LSX': m.lsx,
      'Tồn đầu': m.tonDau,
      'Nhập': m.nhap,
      'Xuất': m.xuat,
      'Tồn kho': m.ton,
      'Carton': m.carton,
      'ODD': m.odd,
      'Vị trí': m.location || 'Temporary',
      'Ghi chú': m.notes || '',
      'Khách': this.getCustomerNameFromMapping(m.materialCode)
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'FG_Inventory_Report');
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `FG_Inventory_BaoCao_${factory}_${dateStr}.xlsx`;
    XLSX.writeFile(wb, filename);
    console.log(`✅ Đã tải báo cáo tồn kho: ${filename}`);
  }

  /** Xác nhận reset: tải báo cáo trước, rồi xóa dữ liệu nhà máy đã chọn */
  confirmResetWithFactory(): void {
    const count = this.getResetMaterialCount();
    if (count === 0) {
      alert('Không có dữ liệu để reset cho nhà máy đã chọn.');
      return;
    }
    const factoryLabel = this.resetSelectedFactory === 'TOTAL' ? 'TẤT CẢ' : this.resetSelectedFactory;
    const msg = `⚠️ Xác nhận reset?\n\nSẽ xóa ${count} dòng dữ liệu của nhà máy ${factoryLabel}.\n\nTrước khi xóa, báo cáo tồn kho sẽ được tải xuống tự động.\n\nHành động này KHÔNG THỂ HOÀN TÁC!`;
    if (!confirm(msg)) return;

    this.showResetDialog = false;
    this.isLoading = true;

    // 1. Tải báo cáo trước
    this.downloadInventoryReport(this.resetSelectedFactory);

    const toDelete = this.resetSelectedFactory === 'TOTAL'
      ? this.materials.filter(m => m.id)
      : this.materials.filter(m => (m.factory || 'ASM1') === this.resetSelectedFactory && m.id);

    const batch = this.firestore.firestore.batch();
    toDelete.forEach(material => {
      if (material.id) {
        const ref = this.firestore.collection('fg-inventory').doc(material.id).ref;
        batch.delete(ref);
      }
    });

    batch.commit()
      .then(() => {
        toDelete.forEach(m => {
          const idx = this.materials.indexOf(m);
          if (idx > -1) this.materials.splice(idx, 1);
        });
        this.filteredMaterials = this.materials.filter(() => true);
        this.isLoading = false;
        alert(`✅ Đã reset thành công!\n\nĐã xóa ${toDelete.length} dòng.\nBáo cáo tồn kho đã được tải xuống trước khi reset.`);
      })
      .catch(error => {
        console.error('❌ Error resetting FG Inventory:', error);
        this.isLoading = false;
        alert(`❌ Lỗi khi reset: ${error.message}`);
      });
  }



  viewAllMaterials(): void {
    this.searchTerm = '';
    this.startDate = '2020-01-01';
    this.endDate = '2030-12-31';
    this.showCompleted = true;
    this.showNonStock = false;
    this.showNegativeStock = false;
    this.selectedFactory = 'TOTAL';
    this.applyFilters();
    this.showTimeRangeDialog = false;
    
    console.log('Cleared search - all materials hidden:', {
      totalMaterials: this.materials.length,
      filteredMaterials: this.filteredMaterials.length
    });
  }

  filterNonStock(): void {
    this.showNonStock = !this.showNonStock;
    if (this.showNonStock) this.showNegativeStock = false; // chỉ chọn 1 chế độ
    this.applyFilters();
  }

  filterNegativeStock(): void {
    this.showNegativeStock = !this.showNegativeStock;
    if (this.showNegativeStock) this.showNonStock = false; // chỉ chọn 1 chế độ
    this.applyFilters();
  }

  /** Có tồn âm theo factory + date range hiện tại (không phụ thuộc search / mode). */
  hasNegativeStockBatches(): boolean {
    return this.materials.some(m => {
      // Filter by factory (TOTAL = xem tất cả)
      if (this.selectedFactory && this.selectedFactory !== 'TOTAL') {
        const f = (m.factory || 'ASM1').toString().trim();
        if (f !== this.selectedFactory) return false;
      }

      // Filter by date range
      if (this.startDate && this.endDate) {
        const importDate = new Date(m.importDate);
        const start = new Date(this.startDate + 'T00:00:00');
        const end   = new Date(this.endDate   + 'T23:59:59');
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
          if (!(importDate >= start && importDate <= end)) return false;
        }
      }

      return (Number(m.ton ?? 0) < 0);
    });
  }

  // ====================== HOÀN LƯỢNG XUẤT ======================
  showRecalcXuatDialog: boolean = false;
  recalcBatchInput: string = '';
  isRecalcXuatLoading: boolean = false;
  recalcXuatResult: { success: boolean; message: string } | null = null;

  openRecalcXuatDialog(): void {
    this.showRecalcXuatDialog = true;
    this.recalcBatchInput = '';
    this.recalcXuatResult = null;
    this.isRecalcXuatLoading = false;
  }

  closeRecalcXuatDialog(): void {
    this.showRecalcXuatDialog = false;
    this.recalcBatchInput = '';
    this.recalcXuatResult = null;
    this.isRecalcXuatLoading = false;
  }

  /**
   * Tính lại lượng Xuất cho batch từ fg-out:
   * 1. Cộng tổng QTY từ tất cả dòng trong fg-out có batchNumber = input.
   * 2. Cập nhật field `xuat` và tính lại `ton` cho tất cả dòng fg-inventory cùng batch.
   */
  async recalcXuatForBatch(): Promise<void> {
    const batch = (this.recalcBatchInput || '').trim().toUpperCase();
    if (!batch) return;

    this.isRecalcXuatLoading = true;
    this.recalcXuatResult = null;

    try {
      // Bước 1: Tổng QTY xuất trong fg-out theo batch
      const fgOutSnap = await this.firestore
        .collection('fg-out', ref =>
          ref.where('batchNumber', '==', batch)
             .where('approved', '==', true)
        )
        .get().toPromise();

      let totalXuat = 0;
      if (fgOutSnap && !fgOutSnap.empty) {
        fgOutSnap.docs.forEach(doc => {
          const d = doc.data() as any;
          totalXuat += Number(d.quantity ?? 0) || 0;
        });
      }

      // Bước 2: Cập nhật fg-inventory theo batch
      const invSnap = await this.firestore
        .collection('fg-inventory', ref => ref.where('batchNumber', '==', batch))
        .get().toPromise();

      if (!invSnap || invSnap.empty) {
        this.recalcXuatResult = {
          success: false,
          message: `⚠️ Không tìm thấy dòng nào trong FG Inventory cho batch "${batch}".`
        };
        this.isRecalcXuatLoading = false;
        return;
      }

      const firestoreBatch = this.firestore.firestore.batch();
      invSnap.docs.forEach(doc => {
        const d = doc.data() as any;
        const tonDau = Number(d.tonDau ?? 0) || 0;
        const nhap = Number(d.nhap ?? d.quantity ?? 0) || 0;
        const newTon = tonDau + nhap - totalXuat;
        firestoreBatch.update(doc.ref, {
          xuat: totalXuat,
          exported: totalXuat,
          ton: newTon,
          updatedAt: new Date()
        });
      });
      await firestoreBatch.commit();

      this.recalcXuatResult = {
        success: true,
        message: `✅ Đã cập nhật batch "${batch}": Xuất = ${totalXuat.toLocaleString()}, cập nhật ${invSnap.size} dòng FG Inventory.`
      };
    } catch (error: any) {
      this.recalcXuatResult = {
        success: false,
        message: `❌ Lỗi: ${error?.message || error}`
      };
    } finally {
      this.isRecalcXuatLoading = false;
    }
  }

  /**
   * Refresh hoan tác (undo) từ FG Out:
   * - Load các bản ghi fg-out-undo chưa xử lý
   * - Tìm dòng FG Inventory tương ứng (materialCode + batchNumber + lsx + lot)
   * - Giảm `xuat` tương ứng và cập nhật `ton`
   * - Đánh dấu undo đã xử lý
   */
  async refreshUndoExports(): Promise<void> {
    this.isLoading = true;
    try {
      const undoSnap = await this.firestore
        .collection('fg-out-undo', ref => ref.where('processed', '==', false))
        .get()
        .toPromise();

      if (!undoSnap || undoSnap.empty) {
        alert('Không có dữ liệu hoan tác để refresh.');
        return;
      }

      const processedAt = new Date();

      for (const undoDoc of undoSnap.docs) {
        const u = undoDoc.data() as any;
        const factory = String(u.factory || 'ASM1').trim().toUpperCase();
        const materialCodeRaw = String(u.materialCode || '').trim();
        const batchNumberRaw = String(u.batchNumber || '').trim();
        const lsxRaw = String(u.lsx || '').trim();
        const lotRaw = String(u.lot || '').trim();

        const materialCodeNorm = materialCodeRaw.toUpperCase();
        const batchNumberNorm = batchNumberRaw.toUpperCase();
        const lsxNorm = lsxRaw.toUpperCase();
        const lotNorm = lotRaw.toUpperCase();

        const quantity = Number(u.quantity ?? 0) || 0;

        if (!materialCodeRaw || !batchNumberRaw || quantity <= 0) continue;

        // Query theo (factory + batchNumber) rồi lọc tiếp trong JS
        // để tránh lỗi case-sensitive string khi query.
        const invSnap = await this.firestore
          .collection('fg-inventory', ref =>
            ref.where('factory', '==', factory)
               .where('batchNumber', '==', batchNumberRaw)
          )
          .get()
          .toPromise();

        let remaining = quantity;

        if (invSnap && !invSnap.empty) {
          for (const invDoc of invSnap.docs) {
            if (remaining <= 0) break;

            const d = invDoc.data() as any;
            const invFactory = String(d.factory || 'ASM1').trim().toUpperCase();
            if (invFactory !== factory) continue;

            const invCode = String(d.materialCode || d.maTP || '').trim().toUpperCase();
            if (invCode && invCode !== materialCodeNorm) continue;

            const invLsx = String(d.lsx || d.LSX || '').trim().toUpperCase();
            if (lsxNorm && invLsx !== lsxNorm) continue;

            const invLot = String(d.lot || d.Lot || '').trim().toUpperCase();
            if (lotNorm && invLot !== lotNorm) continue;

            const currentTon = Number(d.ton ?? d.stock ?? 0) || 0;
            const currentExported = Number(d.xuat ?? d.exported ?? 0) || 0;

            // Chỉ hoàn tác tối đa phần đã xuất
            const qtyToAddBack = Math.min(remaining, currentExported);
            if (qtyToAddBack <= 0) continue;

            const newTon = currentTon + qtyToAddBack;
            const newExported = Math.max(0, currentExported - qtyToAddBack);

            await invDoc.ref.update({
              ton: newTon,
              xuat: newExported,
              exported: newExported,
              updatedAt: processedAt
            });

            remaining -= qtyToAddBack;
          }
        }

        // Mark undo đã xử lý để tránh trừ lặp
        await undoDoc.ref.update({
          processed: true,
          processedAt
        });
      }

      this.applyFilters();
      this.cdr.detectChanges();
    } catch (error: any) {
      console.error('refreshUndoExports error:', error);
      alert(`❌ Lỗi refresh hoan tác: ${error?.message || error}`);
    } finally {
      this.isLoading = false;
    }
  }

  filterTodayImport(): void {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = ('0' + (today.getMonth() + 1)).slice(-2);
    const dd = ('0' + today.getDate()).slice(-2);
    const todayStr = `${yyyy}-${mm}-${dd}`;
    
    this.startDate = todayStr;
    this.endDate = todayStr;
    this.searchTerm = '';
    this.selectedFactory = 'TOTAL';
    this.applyFilters();
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


