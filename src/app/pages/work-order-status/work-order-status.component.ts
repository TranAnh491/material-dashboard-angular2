import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { MAT_RIPPLE_GLOBAL_OPTIONS, RippleGlobalOptions } from '@angular/material/core';
import { Router } from '@angular/router';
import { MaterialLifecycleService } from '../../services/material-lifecycle.service';
import { WorkOrder, WorkOrderStatus } from '../../models/material-lifecycle.model';
import { Subject, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import * as QRCode from 'qrcode';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { QRScannerService, QRScanResult } from '../../services/qr-scanner.service';
import { MatDialog } from '@angular/material/dialog';
import { QRScannerModalComponent, QRScannerData } from '../../components/qr-scanner-modal/qr-scanner-modal.component';
import { PrintOptionDialogComponent } from '../../components/print-option-dialog/print-option-dialog.component';
import { getFirestore, collection, addDoc, getDocs, query, orderBy, where, limit, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { initializeApp } from 'firebase/app';
import { environment } from '../../../environments/environment';
import { UserPermissionService } from '../../services/user-permission.service';
import { FactoryAccessService } from '../../services/factory-access.service';

// Interface for scanned items
interface ScannedItem {
  lsx: string;
  currentStatus: string;
  newStatus: string;
  workOrderId?: string;
}

// Interface for scan data storage
interface ScanData {
  lsx: string;
  quantity: number;
  scannedAt: Date;
  scannedBy: string;
  factory: string;
  workOrderId: string;
}

/** Dòng PXK đã import (theo LSX) */
interface PxkLine {
  materialCode: string;
  quantity: number;
  unit: string;
  po: string;
  soChungTu?: string; // Số chứng từ
  maKho?: string;    // Mã kho: NVL, NVL_E31, NVL_KE31, NVL_SX, NVL_KS, NVL_EXPIRED
  loaiHinh?: string; // Loại hình
  tenVatTu?: string; dinhMuc?: string; tenTP?: string; tongSLYCau?: string; soPOKH?: string; phanTramHaoHut?: string; maKhachHang?: string; ghiChu?: string;
}

/** Dữ liệu PXK nhóm theo LSX */
type PxkDataByLsx = { [lsx: string]: PxkLine[] };

/** LSX có PXK import và So sánh có Thiếu thì không cho chọn Transfer/Done */
const RULE_THIEU_BLOCK_DATE = new Date(2025, 0, 1); // Luôn áp dụng

const globalRippleConfig: RippleGlobalOptions = { disabled: true };

@Component({
  selector: 'app-work-order-status',
  templateUrl: './work-order-status.component.html',
  styleUrls: ['./work-order-status.component.scss'],
  providers: [
    { provide: MAT_RIPPLE_GLOBAL_OPTIONS, useValue: globalRippleConfig }
  ]
})
export class WorkOrderStatusComponent implements OnInit, OnDestroy {
  Object = Object;
  workOrders: WorkOrder[] = [];
  filteredWorkOrders: WorkOrder[] = [];
  
  // Import functionality
  selectedFunction: string | null = null;
  selectedFactory: string = 'ASM1'; // Default to ASM1
  firebaseSaved: boolean = false;
  isSaving: boolean = false;
  isLoading: boolean = false;
  
  // Filters
  searchTerm: string = '';
  statusFilter: WorkOrderStatus | 'all' = 'all';
  doneFilter: 'notCompleted' | 'completed' = 'notCompleted'; // Default: show not completed
  yearFilter: number = new Date().getFullYear();
  monthFilter: number = new Date().getMonth() + 1;

  displayLimit = 100; // Chỉ hiển thị 100 dòng đầu để tránh chậm
  readonly DISPLAY_PAGE_SIZE = 100;

  get displayedWorkOrders(): WorkOrder[] {
    return this.filteredWorkOrders.slice(0, this.displayLimit);
  }
  get hasMoreToDisplay(): boolean {
    return this.displayLimit < this.filteredWorkOrders.length;
  }
  get remainingCount(): number {
    return this.filteredWorkOrders.length - this.displayLimit;
  }
  
  // Summary data
  totalOrders: number = 0;
  waitingOrders: number = 0;
  kittingOrders: number = 0;
  readyOrders: number = 0;
  transferOrders: number = 0;
  doneOrders: number = 0;
  delayOrders: number = 0;
  checkCount: number = 0; // Số LSX đã import PXK nhưng còn Thiếu (So sánh)
  lsxWithThieuSet = new Set<string>();
  workOrderIdsWithThieu = new Set<string>(); // wo.id có Thiếu - dùng để tô đỏ LSX
  
  // Form data for new work order
  newWorkOrder: Partial<WorkOrder> = {
    year: new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    orderNumber: '',
    productCode: '',
    productionOrder: '',
    quantity: 0,
    customer: '',
    deliveryDate: new Date(),
    productionLine: '',
    status: WorkOrderStatus.WAITING,
    createdBy: '',
    planReceivedDate: new Date(),
    notes: ''
  };
  
  // Import functionality
  isImporting: boolean = false;
  importProgress: number = 0;
  importResults: any = null;
  showImportDialog: boolean = false;
  showTimeRangeDialog: boolean = false;
  
  // Time range for filtering
  startDate: Date = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  endDate: Date = new Date();
  showHiddenWorkOrders: boolean = false;
  
  // Delete functionality
  showDeleteDialog: boolean = false;
  deleteStartDate: Date = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  deleteEndDate: Date = new Date();
  deleteFactoryFilter: string = '';
  deletePreviewItems: WorkOrder[] = [];
  isDeleting: boolean = false;
  currentUserDepartment: string = '';
  currentUserId: string = '';
  hasDeletePermissionValue: boolean = false;
  hasCompletePermissionValue: boolean = false;

  // Page navigation
  currentView: 'main' | 'scan' = 'main';

  // Scan QR functionality
  showScanDialog: boolean = false;
  isScannerActive: boolean = false;
  isProcessingScan: boolean = false;
  scannedItems: ScannedItem[] = [];
  allWorkOrdersForScan: WorkOrder[] = []; // Store all work orders across factories for scan lookup

  // Scan QR -> Chọn trạng thái dialog (sau khi scan LSX)
  showScanStatusSelectDialog: boolean = false;
  scanStatusSelectWorkOrder: WorkOrder | null = null;

  /** true = đang chờ máy scanner (popup mode, không dùng camera) */
  isScanPopupMode: boolean = false;

  /** Popup chờ quét LSX (hiển thị thay vì alert) */
  showScanLSXPopup: boolean = false;

  // Physical scanner support
  isPhysicalScannerMode: boolean = true; // Default to physical scanner
  scannerBuffer: string = '';
  scannerTimeoutId: any = null;
  keyboardListener: any = null;

  // PXK Import
  pxkDataByLsx: PxkDataByLsx = {};
  private _pxkLinesCache = new Map<string, PxkLine[]>();  // cache kết quả lookup
  isImportingPxk: boolean = false;
  isClearingPxk: boolean = false;
  showPxkDownloadDialog: boolean = false;
  pxkDownloadDate: Date = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  pxkDownloadAllMonths: boolean = false; // true = tải tất cả, false = lọc theo tháng
  isDownloadingPxk: boolean = false;
  
  

  
  isAddingWorkOrder: boolean = false;
  availableLines: string[] = ['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5'];
  availablePersons: string[] = ['Tuấn', 'Tình', 'Vũ', 'Phúc', 'Tú', 'Hưng', 'Toàn', 'Ninh'];
  years: number[] = [];
  
  // Selection functionality for bulk operations
  selectedWorkOrders: WorkOrder[] = [];
  

  
  months = [
    { value: 1, name: 'January' },
    { value: 2, name: 'February' },
    { value: 3, name: 'March' },
    { value: 4, name: 'April' },
    { value: 5, name: 'May' },
    { value: 6, name: 'June' },
    { value: 7, name: 'July' },
    { value: 8, name: 'August' },
    { value: 9, name: 'September' },
    { value: 10, name: 'October' },
    { value: 11, name: 'November' },
    { value: 12, name: 'December' }
  ];
  
  private destroy$ = new Subject<void>();

  constructor(
    private materialService: MaterialLifecycleService,
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private userPermissionService: UserPermissionService,
    private factoryAccessService: FactoryAccessService,
    private qrScannerService: QRScannerService,
    private dialog: MatDialog,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {
    // Generate years from current year - 2 to current year + 2
    const currentYear = new Date().getFullYear();
    for (let i = currentYear - 2; i <= currentYear + 2; i++) {
      this.years.push(i);
    }
  }

  ngOnInit(): void {
    console.log('🚀 WorkOrderStatusComponent initialized');
    console.log('📅 Initial filters:', {
      year: this.yearFilter,
      month: this.monthFilter,
      status: this.statusFilter
    });
    
    // Load user department information and permissions
    this.loadUserDepartment();
    this.loadDeletePermission();
    
    // Factory access disabled for work order tab - only applies to materials inventory
    // this.loadFactoryAccess();
    
    // Set default function to view
    this.selectedFunction = 'view';
    
    this.loadWorkOrders();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    
    // Clean up physical scanner
    this.stopPhysicalScanner();
  }

  selectFunction(functionName: string): void {
    this.selectedFunction = functionName;
    console.log('🔧 Selected function:', functionName);
  }

  selectFactory(factory: string): void {
    // Factory access check disabled for work order tab - only applies to materials inventory
    // Direct factory selection without permission check
    this.selectedFactory = factory;
    console.log('🏭 Selected factory:', factory);
    // Re-apply filters to show only work orders from selected factory
    this.applyFilters();
    // Update summary cards based on selected factory
    this.calculateSummary();
  }

  // Helper method to normalize factory names for comparison
  private normalizeFactoryName(factory: string): string {
    if (!factory) return '';
    return factory.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // Helper method to check if factory is valid
  private isValidFactory(factory: string): boolean {
    if (!factory) return false;
    const normalized = this.normalizeFactoryName(factory);
    const validFactories = ['asm1', 'asm2', 'asm3', 'sample 1', 'sample 2'];
    return validFactories.includes(normalized);
  }

  // Helper method to reset all loading states
  resetLoadingStates(): void {
    this.isLoading = false;
    this.isSaving = false;
    this.isImporting = false;
    this.importProgress = 0;
    console.log('🔄 Reset all loading states');
  }

  async onFileSelected(event: any): Promise<void> {
    const file = event.target.files[0];
    if (file) {
      console.log('📁 File selected:', file.name, 'Size:', file.size, 'bytes');
      
      // Validate file type
      const validExtensions = ['.xlsx', '.xls'];
      const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
      
      if (!validExtensions.includes(fileExtension)) {
        alert('❌ Vui lòng chọn file Excel (.xlsx hoặc .xls)');
        return;
      }
      
      // Validate file size (max 10MB)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        alert('❌ File quá lớn. Vui lòng chọn file nhỏ hơn 10MB');
        return;
      }
      
      console.log('✅ File validation passed, processing...');
      this.readExcelFile(file).then(async (jsonData) => {
        await this.processExcelData(jsonData);
      }).catch((error) => {
        console.error('❌ Error reading Excel file:', error);
        alert(`❌ Lỗi khi đọc file Excel:\n${error.message || error}`);
      });
    }
  }

  async loadWorkOrders(): Promise<void> {
    console.log('🔄 Loading work orders from database...');
    await this.loadPxkFromFirebase();
    console.log('📄 Using direct Firestore methods for better reliability');
    await this.loadWorkOrdersDirect();
  }

  /** Load PXK từ Firebase để dùng khi cần (Box Check, Print PXK, chặn Done) */
  async loadPxkFromFirebase(): Promise<void> {
    try {
      const snapshot = await firstValueFrom(this.firestore.collection('pxk-import-data').get());
      this.pxkDataByLsx = {};
      let skipped = 0;
      snapshot.docs.forEach((docSnap: any) => {
        const d = docSnap.data();
        const lsx = String(d?.lsx || '').trim();
        const lines = Array.isArray(d?.lines) ? d.lines : [];
        if (lsx && lines.length > 0) {
          this.pxkDataByLsx[lsx] = lines;
        } else {
          skipped++;
          console.warn(`[PXK Load] Bỏ qua doc ${docSnap.id}: lsx="${lsx}", lines=${lines.length}`);
        }
      });
      this.invalidatePxkCache();
      console.log(`[PXK Load] ✅ Tổng docs: ${snapshot.docs.length}, Loaded: ${Object.keys(this.pxkDataByLsx).length} LSX, Bỏ qua: ${skipped}`);
      if (snapshot.docs.length === 0) {
        console.warn('[PXK Load] ⚠️ Collection pxk-import-data TRỐNG — chưa có dữ liệu nào được lưu');
      }
    } catch (e) {
      console.error('[PXK Load] ❌ Lỗi khi load:', e);
    }
  }

  /** Xóa dữ liệu PXK theo LSX (nhập LSX cần xóa) */
  async clearPxkImportedData(): Promise<void> {
    const input = prompt(
      'Nhập LSX cần xóa dữ liệu PXK:\n' +
      '  ASM1 / Sample 1 → KZLSX0326/0089\n' +
      '  ASM2 / Sample 2 → LHLSX0326/0012\n\n' +
      '⚠️ Phải nhập đầy đủ prefix KZLSX hoặc LHLSX để tránh xóa nhầm nhà máy.'
    );
    if (input == null || input === undefined) return;
    const lsxToDelete = String(input).trim();
    if (!lsxToDelete) { alert('Chưa nhập LSX.'); return; }

    // Normalize GIỮ NGUYÊN prefix KZ/LH để phân biệt ASM1 và ASM2
    const normLsx = (s: string): string => {
      const t = String(s || '').trim().toUpperCase().replace(/\s/g, '');
      const m = t.match(/(\d{4}[\/\-\.]\d+)/);
      const numPart = m ? m[1].replace(/[-.]/g, '/') : '';
      if (!numPart) return t;
      const prefix = t.startsWith('KZ') ? 'KZ' : t.startsWith('LH') ? 'LH' : '';
      return prefix ? `${prefix}_${numPart}` : numPart;
    };

    const targetNorm = normLsx(lsxToDelete);
    if (!targetNorm) {
      alert('LSX không đúng format.\nASM1: KZLSX0326/0089\nASM2: LHLSX0326/0012');
      return;
    }

    // Cảnh báo nếu nhập thiếu prefix
    const upper = lsxToDelete.toUpperCase().replace(/\s/g, '');
    if (!upper.startsWith('KZ') && !upper.startsWith('LH')) {
      const confirm = window.confirm(
        `⚠️ LSX "${lsxToDelete}" không có prefix KZLSX/LHLSX.\n` +
        `Sẽ xóa tất cả LSX có phần số khớp (cả ASM1 lẫn ASM2).\n\nTiếp tục?`
      );
      if (!confirm) return;
    }

    this.isClearingPxk = true;
    try {
      const snapshot = await firstValueFrom(this.firestore.collection('pxk-import-data').get());
      const toDelete: { id: string; lsx: string }[] = [];
      snapshot.docs.forEach((docSnap: any) => {
        const d = docSnap.data();
        const docLsx = String(d?.lsx || '').trim();
        if (normLsx(docLsx) === targetNorm) toDelete.push({ id: docSnap.id, lsx: docLsx });
      });
      if (toDelete.length === 0) {
        alert(`Không tìm thấy dữ liệu PXK cho LSX: ${lsxToDelete}`);
        return;
      }
      for (const { id } of toDelete) {
        await this.firestore.collection('pxk-import-data').doc(id).delete();
      }
      Object.keys(this.pxkDataByLsx).forEach(k => {
        if (normLsx(k) === targetNorm) delete this.pxkDataByLsx[k];
      });
      this.invalidatePxkCache();
      this.calculateSummary();
      this.cdr.detectChanges();
      alert(`✅ Đã xóa dữ liệu PXK cho LSX: ${toDelete.map(x => x.lsx).join(', ')}.`);
    } catch (e) {
      console.error('[PXK] Lỗi khi xóa:', e);
      alert('Lỗi khi xóa dữ liệu PXK: ' + (e && (e as Error).message ? (e as Error).message : 'Vui lòng thử lại.'));
    } finally {
      this.isClearingPxk = false;
    }
  }
  
  private processLoadedWorkOrders(workOrders: WorkOrder[]): void {
    console.log(`📊 Loaded ${workOrders.length} work orders from database:`, workOrders);
    
    // Process date fields to ensure they are proper Date objects
    const processedWorkOrders = workOrders.map(wo => {
      const processedWo = { ...wo };
      
      // Handle deliveryDate
      if (processedWo.deliveryDate) {
        if (typeof processedWo.deliveryDate === 'object' && processedWo.deliveryDate !== null && 'toDate' in processedWo.deliveryDate) {
          // Firestore Timestamp
          processedWo.deliveryDate = (processedWo.deliveryDate as any).toDate();
          console.log(`📅 Converted deliveryDate from Firestore Timestamp:`, processedWo.deliveryDate);
        } else if (typeof processedWo.deliveryDate === 'string') {
          // String date
          processedWo.deliveryDate = new Date(processedWo.deliveryDate);
          console.log(`📅 Converted deliveryDate from string:`, processedWo.deliveryDate);
        } else if (!(processedWo.deliveryDate instanceof Date)) {
          // Other format, try to convert
          processedWo.deliveryDate = new Date(processedWo.deliveryDate);
          console.log(`📅 Converted deliveryDate from other format:`, processedWo.deliveryDate);
        }
      }
      
      // Handle planReceivedDate
      if (processedWo.planReceivedDate) {
        if (typeof processedWo.planReceivedDate === 'object' && processedWo.planReceivedDate !== null && 'toDate' in processedWo.planReceivedDate) {
          // Firestore Timestamp
          processedWo.planReceivedDate = (processedWo.planReceivedDate as any).toDate();
          console.log(`📅 Converted planReceivedDate from Firestore Timestamp:`, processedWo.planReceivedDate);
        } else if (typeof processedWo.planReceivedDate === 'string') {
          // String date
          processedWo.planReceivedDate = new Date(processedWo.planReceivedDate);
          console.log(`📅 Converted planReceivedDate from string:`, processedWo.planReceivedDate);
        } else if (!(processedWo.planReceivedDate instanceof Date)) {
          // Other format, try to convert
          processedWo.planReceivedDate = new Date(processedWo.planReceivedDate);
          console.log(`📅 Converted planReceivedDate from other format:`, processedWo.planReceivedDate);
        }
      }
      
      // Handle createdDate and lastUpdated
      if (processedWo.createdDate && typeof processedWo.createdDate === 'object' && processedWo.createdDate !== null && 'toDate' in processedWo.createdDate) {
        processedWo.createdDate = (processedWo.createdDate as any).toDate();
      }
      if (processedWo.lastUpdated && typeof processedWo.lastUpdated === 'object' && processedWo.lastUpdated !== null && 'toDate' in processedWo.lastUpdated) {
        processedWo.lastUpdated = (processedWo.lastUpdated as any).toDate();
      }
      
      return processedWo;
    });
    
    this.workOrders = processedWorkOrders;
    
    // Auto-mark old completed work orders as completed
    this.markOldCompletedWorkOrders();
    
    // Auto-assign sequential numbers based on delivery date within each month
    this.assignSequentialNumbers();
    
    // Debug: Check current filters
    
    this.applyFilters();
    this.calculateSummary();
    
    
    // Auto-adjust filters if no data is shown but data exists
    if (this.filteredWorkOrders.length === 0 && this.workOrders.length > 0) {
      console.log('⚠️ No work orders match current filters, but data exists. Checking if we should adjust filters...');
      this.handleEmptyFilterResults();
    }
  }
  
  private async loadWorkOrdersDirect(): Promise<void> {
    console.log('🔄 Loading work orders using direct Firestore...');
    
    try {
      // Try Firebase v9 SDK first (most reliable)
      console.log('📄 Trying Firebase v9 SDK first...');
      await this.loadWorkOrdersWithFirebaseV9();
    } catch (firebaseV9Error) {
      console.log('⚠️ Firebase v9 SDK failed, trying AngularFirestore...', firebaseV9Error);
      
      try {
        console.log('📄 Trying AngularFirestore...');
        this.firestore.collection('work-orders', ref =>
          ref.where('year', '==', this.yearFilter)
             .where('month', '==', this.monthFilter)
             .limit(500)
        ).snapshotChanges()
          .pipe(takeUntil(this.destroy$))
          .subscribe({
            next: (actions) => {
              const workOrders = actions.map(a => {
                const data = a.payload.doc.data() as WorkOrder;
                const id = a.payload.doc.id;
                return { id, ...data };
              });
              console.log('✅ AngularFirestore load successful!');
              this.processLoadedWorkOrders(workOrders);
            },
            error: (error) => {
              console.error('❌ All Firestore load methods failed!', error);
              // Try one more time after delay
              setTimeout(() => {
                console.log('🔄 Retrying load after delay...');
                this.loadWorkOrdersWithFirebaseV9();
              }, 2000);
            }
          });
      } catch (angularFireError) {
        console.error('❌ All Firestore load methods failed!', angularFireError);
        alert(`⚠️ Error loading work orders: ${angularFireError?.message || angularFireError}\n\nPlease check your internet connection and try refreshing the page.`);
      }
    }
  }
  
  private async loadWorkOrdersWithFirebaseV9(): Promise<void> {
    try {
      console.log('📄 Using Firebase v9 SDK to load work orders (Năm:', this.yearFilter, ', Tháng:', this.monthFilter, ')...');
      
      const app = initializeApp(environment.firebase);
      const db = getFirestore(app);
      const q = query(
        collection(db, 'work-orders'),
        where('year', '==', this.yearFilter),
        where('month', '==', this.monthFilter),
        limit(500)
      );
      
      const querySnapshot = await getDocs(q);
      const workOrders: WorkOrder[] = [];
      
      querySnapshot.forEach((doc) => {
        const data = doc.data() as WorkOrder;
        workOrders.push({ id: doc.id, ...data });
      });
      
      console.log('✅ Firebase v9 SDK load successful!');
      this.processLoadedWorkOrders(workOrders);
    } catch (error) {
      console.error('❌ Firebase v9 SDK load failed!', error);
      throw error;
    }
  }

  // Auto-mark old completed work orders as completed
  private markOldCompletedWorkOrders(): void {
    console.log('🏷️ Marking old completed work orders...');
    
    let markedCount = 0;
    this.workOrders.forEach(wo => {
      // If work order has status DONE but no isCompleted flag, mark it as completed
      if (wo.status === WorkOrderStatus.DONE && !wo.isCompleted) {
        wo.isCompleted = true;
        markedCount++;
        console.log(`✅ Marked old completed work order: ${wo.productionOrder} (${wo.productCode})`);
      }
    });
    
    if (markedCount > 0) {
      console.log(`✅ Marked ${markedCount} old completed work orders as completed`);
    } else {
      console.log('ℹ️ No old completed work orders found');
    }
  }

  // Auto-assign sequential numbers based on delivery date within each month
  private assignSequentialNumbers(): void {
    
    // Group work orders by year and month from delivery date
    const groups: { [key: string]: WorkOrder[] } = {};
    
    this.workOrders.forEach(wo => {
      if (wo.deliveryDate) {
        // Ensure deliveryDate is a proper Date object
        const deliveryDate = wo.deliveryDate instanceof Date ? wo.deliveryDate : new Date(wo.deliveryDate);
        
        // Validate date
        if (isNaN(deliveryDate.getTime())) {
          console.warn('Invalid delivery date for work order:', wo.id, wo.deliveryDate);
          return;
        }
        
        const year = deliveryDate.getFullYear();
        const month = deliveryDate.getMonth() + 1; // 1-based month
        const key = `${year}-${month.toString().padStart(2, '0')}`;
        
        if (!groups[key]) {
          groups[key] = [];
        }
        groups[key].push(wo);
        
      } else {
        console.warn('Work order missing delivery date:', wo.id, wo.productCode);
      }
    });
    
    // Sort each group by delivery date and assign sequential numbers
    Object.keys(groups).sort().forEach(key => {
      const workOrdersInMonth = groups[key];
      
      
      // Sort by delivery date (earliest first)
      workOrdersInMonth.sort((a, b) => {
        const dateA = a.deliveryDate instanceof Date ? a.deliveryDate : new Date(a.deliveryDate!);
        const dateB = b.deliveryDate instanceof Date ? b.deliveryDate : new Date(b.deliveryDate!);
        
        const timeA = dateA.getTime();
        const timeB = dateB.getTime();
        
        return timeA - timeB;
      });
      
      workOrdersInMonth.forEach((wo, index) => {
        wo.orderNumber = (index + 1).toString();
      });
    });
    
  }

  applyFilters(): void {
    this.displayLimit = this.DISPLAY_PAGE_SIZE;
    this.filteredWorkOrders = this.workOrders.filter(wo => {
      const matchesSearch = !this.searchTerm || 
        wo.orderNumber.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        wo.productCode.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        wo.productionOrder.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        wo.customer.toLowerCase().includes(this.searchTerm.toLowerCase());
      
      // Lọc theo thứ tự: Năm → Tháng → Trạng thái
      const matchesYear = wo.year === this.yearFilter;
      const matchesMonth = wo.month === this.monthFilter;
      const matchesStatus = this.statusFilter === 'all' || wo.status === this.statusFilter;
      
      // Filter by selected factory - but be more flexible to handle missing factory data
      let matchesFactory = false;
      if (!this.selectedFactory) {
        matchesFactory = true; // No factory filter selected, show all
      } else if (wo.factory) {
        const normalizedData = this.normalizeFactoryName(wo.factory);
        const normalizedSelected = this.normalizeFactoryName(this.selectedFactory);
        matchesFactory = normalizedData === normalizedSelected;
        
      } else {
        // No factory in work order, default to ASM1
        matchesFactory = this.selectedFactory === 'ASM1';
      }
      
      // Apply done filter
      let matchesDoneFilter = true;
      if (this.doneFilter === 'notCompleted') {
        matchesDoneFilter = !wo.isCompleted;
      } else if (this.doneFilter === 'completed') {
        matchesDoneFilter = wo.isCompleted;
      }
      
      return matchesSearch && matchesStatus && matchesYear && matchesMonth && matchesFactory && matchesDoneFilter;
    });
    
    
    // Sort filtered results: urgent first, then by delivery date (earliest first)
    this.filteredWorkOrders.sort((a, b) => {
      // First priority: urgent work orders go to the top
      if (a.isUrgent && !b.isUrgent) return -1;
      if (!a.isUrgent && b.isUrgent) return 1;
      
      // Second priority: delivery date (earliest first)
      const dateA = a.deliveryDate ? new Date(a.deliveryDate).getTime() : 0;
      const dateB = b.deliveryDate ? new Date(b.deliveryDate).getTime() : 0;
      return dateA - dateB;
    });
    
  }

  calculateSummary(): void {
    const filtered = this.filteredWorkOrders;
    this.totalOrders = filtered.length;
    this.waitingOrders = filtered.filter(wo => wo.status === WorkOrderStatus.WAITING).length;
    this.kittingOrders = filtered.filter(wo => wo.status === WorkOrderStatus.KITTING).length;
    this.readyOrders = filtered.filter(wo => wo.status === WorkOrderStatus.READY).length;
    this.transferOrders = filtered.filter(wo => wo.status === WorkOrderStatus.TRANSFER).length;
    this.doneOrders = filtered.filter(wo => wo.status === WorkOrderStatus.DONE).length;
    this.delayOrders = filtered.filter(wo => wo.status === WorkOrderStatus.DELAY).length;
    this.calculateCheckCount(); // Đếm LSX đã import PXK có Thiếu
  }

  /** Đếm số LSX (đã import PXK) có So sánh Thiếu - load outbound 1 lần/factory để tránh lag */
  async calculateCheckCount(): Promise<void> {
    this.lsxWithThieuSet.clear();
    this.workOrderIdsWithThieu.clear();
    if (!this.isRuleEffectiveDate()) {
      this.checkCount = 0;
      this.cdr.detectChanges();
      return;
    }
    const filtered = this.filteredWorkOrders;
    const lsxMap = new Map<string, { lsx: string; factory: string }>();
    for (const wo of filtered) {
      if (!this.hasPxkForWorkOrder(wo)) continue;
      const lsx = (wo.productionOrder || '').trim();
      if (!lsx) continue;
      const norm = lsx.toUpperCase().replace(/\s/g, '');
      if (!lsxMap.has(norm)) lsxMap.set(norm, { lsx, factory: wo.factory || this.selectedFactory || 'ASM1' });
    }
    const factories = [...new Set([...lsxMap.values()].map(e => e.factory))];
    const normLsx = (s: string) => {
      const t = String(s || '').trim().toUpperCase().replace(/\s/g, '');
      const m = t.match(/(\d{4}[\/\-\.]\d+)/);
      return m ? m[1].replace(/[-.]/g, '/') : t;
    };
    const factoryToLsxScanMap = new Map<string, Map<string, Map<string, number>>>(); // factory -> lsxNorm -> mat|po -> qty
    for (const fac of factories) {
      const isAsm1 = (fac || 'ASM1').toUpperCase().includes('ASM1');
      try {
        const snap = await firstValueFrom(this.firestore.collection('outbound-materials', ref =>
          ref.where('factory', '==', isAsm1 ? 'ASM1' : 'ASM2')
        ).get());
        const byLsx = new Map<string, Map<string, number>>();
        snap.docs.forEach((doc: any) => {
          const d = doc.data() as any;
          const poLsxNorm = normLsx(d.productionOrder || '');
          if (!poLsxNorm) return;
          const mat = String(d.materialCode || '').trim().toUpperCase();
          if (mat.charAt(0) !== 'B') return;
          const po = String(d.poNumber ?? d.po ?? '').trim();
          const qty = Number(d.exportQuantity || 0) || 0;
          if (!byLsx.has(poLsxNorm)) byLsx.set(poLsxNorm, new Map());
          const scanMap = byLsx.get(poLsxNorm)!;
          const key = `${mat}|${po}`;
          scanMap.set(key, (scanMap.get(key) || 0) + qty);
        });
        factoryToLsxScanMap.set(fac, byLsx);
      } catch (_) {}
    }
    const getSoSanhForCheck = (xuất: number, scan: number): string => {
      const diff = scan - xuất;
      if (Math.abs(diff) < 1) return 'Đủ';
      if (diff < 0) return 'Thiếu';
      return 'Dư';
    };
    let count = 0;
    for (const entry of lsxMap.values()) {
      const woLsxNorm = normLsx(entry.lsx);
      const byLsx = factoryToLsxScanMap.get(entry.factory);
      const scanMap = byLsx?.get(woLsxNorm);
      const lines = this.getPxkLinesForLsx(entry.lsx);
      const getScanQty = (mat: string, po: string) => scanMap?.get(`${String(mat || '').trim().toUpperCase()}|${String(po || '').trim()}`) || 0;
      const hasAnyScanData = lines.some(l => {
        if (String(l.materialCode || '').trim().toUpperCase().charAt(0) === 'R') return false;
        return getScanQty(l.materialCode, (l as any).po || (l as any).poNumber) > 0;
      });
      let hasThieu = false;
      for (const l of lines) {
        const matCode = String(l.materialCode || '').trim().toUpperCase();
        const maKho = String((l as any).maKho || '').trim().toUpperCase();
        const isNvlSxOnly = maKho === 'NVL_SX';
        const isR = matCode.charAt(0) === 'R';
        const isB033 = matCode.startsWith('B033');
        const isB030 = matCode.startsWith('B030');
        const po = String((l as any).po || (l as any).poNumber || '').trim();
        let scanQty: number;
        if (isNvlSxOnly) scanQty = Number(l.quantity) || 0;
        else if ((isR || isB030 || isB033) && hasAnyScanData) scanQty = Number(l.quantity) || 0;
        else scanQty = getScanQty(l.materialCode, po);
        if (isR) continue;
        const qtyPxk = Number(l.quantity) || 0;
        const soSanh = !hasAnyScanData && scanQty === 0 ? '' : getSoSanhForCheck(qtyPxk, scanQty);
        if (soSanh.startsWith('Thiếu')) { hasThieu = true; break; }
      }
      if (hasThieu) {
        count++;
        const entryNorm = normLsx(entry.lsx) || entry.lsx.toUpperCase().replace(/\s/g, '');
        this.lsxWithThieuSet.add(entryNorm);
        this.lsxWithThieuSet.add(entry.lsx.toUpperCase().replace(/\s/g, ''));
        for (const wo of filtered) {
          if (!wo.productionOrder || !wo.id || !this.hasPxkForWorkOrder(wo)) continue;
          if (normLsx(wo.productionOrder) === entryNorm) {
            this.lsxWithThieuSet.add((wo.productionOrder || '').trim().toUpperCase().replace(/\s/g, ''));
            this.workOrderIdsWithThieu.add(wo.id);
          }
        }
      }
    }
    this.checkCount = count;
    this.cdr.detectChanges();
  }

  /** Chuẩn hóa LSX giống hasPxkThieuForLsx để so khớp */
  private normLsxForMatch(s: string): string {
    const t = String(s || '').trim().toUpperCase().replace(/\s/g, '');
    const m = t.match(/(\d{4}[\/\-\.]\d+)/);
    return m ? m[1].replace(/[-.]/g, '/') : t;
  }

  /** Kiểm tra LSX có bị thiếu không (để disable option Transfer và tô đỏ cột LSX) */
  isTransferDisabledForWorkOrder(wo: WorkOrder): boolean {
    if (!wo) return false;
    if (wo.id && this.workOrderIdsWithThieu.has(wo.id)) return true;
    if (!wo.productionOrder || !this.hasPxkForWorkOrder(wo)) return false;
    const raw = (wo.productionOrder || '').trim().toUpperCase().replace(/\s/g, '');
    const norm = this.normLsxForMatch(wo.productionOrder);
    return this.lsxWithThieuSet.has(raw) || this.lsxWithThieuSet.has(norm);
  }

  onSearchChange(): void {
    this.clearSelection();
    this.applyFilters();
    this.calculateSummary();
  }

  loadMoreDisplayed(): void {
    this.displayLimit = Math.min(
      this.displayLimit + this.DISPLAY_PAGE_SIZE,
      this.filteredWorkOrders.length
    );
  }

  onStatusFilterChange(): void {
    this.clearSelection();
    this.applyFilters();
    this.calculateSummary();
  }

  onDoneFilterChange(): void {
    this.clearSelection();
    this.applyFilters();
    this.calculateSummary();
  }

  onYearFilterChange(): void {
    this.clearSelection();
    this.loadWorkOrders(); // Reload từ Firebase theo Năm+Tháng mới
  }

  onMonthFilterChange(): void {
    this.clearSelection();
    this.loadWorkOrders(); // Reload từ Firebase theo Năm+Tháng mới
  }



  addNewWorkOrder(): void {
    if (this.isValidWorkOrder()) {
      // Generate order number if not provided
      if (!this.newWorkOrder.orderNumber) {
        this.newWorkOrder.orderNumber = this.generateOrderNumber();
      }

      const workOrder: WorkOrder = {
        ...this.newWorkOrder,
        createdDate: new Date(),
        lastUpdated: new Date()
      } as WorkOrder;

      this.materialService.addWorkOrder(workOrder)
        .then((docRef) => {
          console.log('✅ Work order added successfully:', docRef.id);
          this.resetForm();
          this.isAddingWorkOrder = false;
          
          // Immediate refresh to show new work order
          setTimeout(() => {
            this.loadWorkOrders();
          }, 500);
        })
        .catch(error => {
          console.error('❌ Error adding work order:', error);
          alert(`❌ Error adding work order: ${error.message || error}\n\nPlease try again.`);
        });
    }
  }

  private generateOrderNumber(): string {
    const year = this.newWorkOrder.year?.toString().slice(-2) || '24';
    const month = this.newWorkOrder.month?.toString().padStart(2, '0') || '01';
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `WO-${year}${month}-${random}`;
  }

  private isValidWorkOrder(): boolean {
    return !!(
      this.newWorkOrder.productCode &&
      this.newWorkOrder.productionOrder &&
      this.newWorkOrder.quantity && this.newWorkOrder.quantity > 0 &&
      this.newWorkOrder.customer &&
      this.newWorkOrder.deliveryDate &&
      this.newWorkOrder.productionLine &&
      this.newWorkOrder.createdBy &&
      this.newWorkOrder.planReceivedDate
    );
  }

  resetForm(): void {
    this.newWorkOrder = {
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
      orderNumber: '',
      productCode: '',
      productionOrder: '',
      quantity: 0,
      customer: '',
      deliveryDate: new Date(),
          productionLine: '',
    status: WorkOrderStatus.WAITING,
    createdBy: '',
      planReceivedDate: new Date(),
      notes: ''
    };
  }

  readonly BYPASS_PASSWORD = '111';

  /** Kiểm tra pass vượt quyền khi LSX thiếu - trả về true nếu được phép vượt */
  async checkBypassPasswordForThieu(): Promise<boolean> {
    const pass = prompt('LSX đang thiếu. Nhập mật khẩu vượt quyền để tiếp tục:');
    if (pass === this.BYPASS_PASSWORD) return true;
    alert('Mật khẩu không đúng. Không thể vượt quyền.');
    return false;
  }

  /** Kiểm tra option có bị disable theo rule chuyển trạng thái không */
  isStatusOptionDisabled(wo: WorkOrder, optionValue: string): boolean {
    const current = (wo?.status || WorkOrderStatus.WAITING) as WorkOrderStatus;
    const next = this.convertStringToStatus(optionValue);
    const check = this.isStatusTransitionAllowed(current, next);
    return !check.allowed;
  }

  /** Rule: Transfer phải từ Ready, Ready phải từ Kitting, Kitting phải từ Waiting */
  private isStatusTransitionAllowed(current: WorkOrderStatus, next: WorkOrderStatus): { allowed: boolean; message?: string } {
    const rules: [WorkOrderStatus, WorkOrderStatus][] = [
      [WorkOrderStatus.WAITING, WorkOrderStatus.KITTING],
      [WorkOrderStatus.KITTING, WorkOrderStatus.READY],
      [WorkOrderStatus.READY, WorkOrderStatus.TRANSFER]
    ];
    const rule = rules.find(([, to]) => to === next);
    if (rule) {
      const [requiredFrom] = rule;
      if (current !== requiredFrom) {
        const reqText = requiredFrom === WorkOrderStatus.WAITING ? 'Waiting' : requiredFrom === WorkOrderStatus.KITTING ? 'Kitting' : 'Ready';
        return { allowed: false, message: `Chỉ được chọn ${next === WorkOrderStatus.KITTING ? 'Kitting' : next === WorkOrderStatus.READY ? 'Ready' : 'Transfer'} khi tình trạng hiện tại là ${reqText}.` };
      }
    }
    return { allowed: true };
  }

  async onStatusChange(workOrder: WorkOrder, newStatus: string): Promise<void> {
    const oldStatus = workOrder.status;
    const newStatusEnum = this.convertStringToStatus(newStatus);
    const currentStatus = (workOrder.status || WorkOrderStatus.WAITING) as WorkOrderStatus;
    const transitionCheck = this.isStatusTransitionAllowed(currentStatus, newStatusEnum);
    if (!transitionCheck.allowed) {
      alert(transitionCheck.message);
      workOrder.status = oldStatus;
      this.cdr.detectChanges();
      return;
    }
    const blocked = await this.isThieuBlockedForWorkOrder(workOrder);
    if (blocked && (newStatusEnum === WorkOrderStatus.DONE || newStatusEnum === WorkOrderStatus.TRANSFER)) {
      const bypass = await this.checkBypassPasswordForThieu();
      if (!bypass) {
        workOrder.status = oldStatus;
        this.cdr.detectChanges();
        return;
      }
    }
    await this.updateWorkOrderStatus(workOrder, newStatusEnum);
  }

  async updateWorkOrderStatus(workOrder: WorkOrder, newStatus: WorkOrderStatus): Promise<void> {
    try {
      // If changing from DONE to other status, remove completed flag
      let updatedWorkOrder = { ...workOrder, status: newStatus, lastUpdated: new Date() };
      
      if (workOrder.status === WorkOrderStatus.DONE && newStatus !== WorkOrderStatus.DONE) {
        updatedWorkOrder.isCompleted = false;
        console.log('🔄 Removing completed flag - status changed from DONE to', newStatus);
      }
      
      console.log('🔄 Updating work order status:', {
        id: workOrder.id,
        oldStatus: workOrder.status,
        newStatus: newStatus,
        isCompleted: updatedWorkOrder.isCompleted
      });
      
      await this.materialService.updateWorkOrder(workOrder.id!, updatedWorkOrder);
      
      // Update local array
      const index = this.workOrders.findIndex(wo => wo.id === workOrder.id);
      if (index !== -1) {
        this.workOrders[index] = { ...this.workOrders[index], ...updatedWorkOrder };
        this.applyFilters();
        this.calculateSummary();
        console.log('✅ Local work order status updated successfully');
      }
      
      console.log('✅ Work order status updated in Firebase successfully');
    } catch (error) {
      console.error('❌ Error updating work order status:', error);
      throw error; // Re-throw to handle in calling method
    }
  }

  updateWorkOrder(workOrder: WorkOrder, field: string, value: any): void {
    console.log(`🔄 Updating work order ${workOrder.id} - Field: ${field}, Value:`, value);
    
    // Handle date fields specifically
    let processedValue = value;
    if (field === 'deliveryDate' || field === 'planReceivedDate') {
      if (value instanceof Date) {
        processedValue = value;
        console.log(`📅 Date field ${field} - Original:`, value, 'Type:', typeof value);
      } else if (value && typeof value === 'string') {
        processedValue = new Date(value);
        console.log(`📅 Converting string to Date for ${field}:`, value, '→', processedValue);
      } else if (value && value.toDate) {
        // Handle Firestore Timestamp
        processedValue = value.toDate();
        console.log(`📅 Converting Firestore Timestamp for ${field}:`, value, '→', processedValue);
      }
    }
    
    let updatedWorkOrder = { 
      ...workOrder, 
      [field]: processedValue, 
      lastUpdated: new Date() 
    };
    
    // If updating status field and changing from DONE to other status, remove completed flag
    if (field === 'status' && workOrder.status === WorkOrderStatus.DONE && processedValue !== WorkOrderStatus.DONE) {
      updatedWorkOrder.isCompleted = false;
      console.log('🔄 Removing completed flag - status changed from DONE to', processedValue);
    }
    
    console.log(`💾 Saving to Firebase - Updated work order:`, updatedWorkOrder);
    
    this.materialService.updateWorkOrder(workOrder.id!, updatedWorkOrder)
      .then(() => {
        console.log(`✅ Successfully updated work order ${workOrder.id} in Firebase`);
        
        // Update local array
        const index = this.workOrders.findIndex(wo => wo.id === workOrder.id);
        if (index !== -1) {
          this.workOrders[index] = { ...this.workOrders[index], ...updatedWorkOrder };
          this.applyFilters();
          this.calculateSummary();
          console.log(`✅ Updated local work order data`);
        }
      })
      .catch(error => {
        console.error(`❌ Error updating work order ${workOrder.id}:`, error);
        alert(`❌ Lỗi khi cập nhật work order: ${error.message || error}`);
      });
  }

  async deleteWorkOrder(workOrder: WorkOrder): Promise<void> {
    // Check delete permission first
    const hasPermission = await this.hasDeletePermission();
    if (!hasPermission) {
      alert('❌ Bạn không có quyền xóa dữ liệu! Vui lòng liên hệ quản trị viên để được cấp quyền.');
      return;
    }

    // Enhanced confirmation dialog with more details
    const confirmMessage = `⚠️ DELETE WORK ORDER CONFIRMATION ⚠️

Work Order Details:
• Order Number: ${workOrder.orderNumber}
• Product Code: ${workOrder.productCode}
• Production Order: ${workOrder.productionOrder}
• Customer: ${workOrder.customer}
• Quantity: ${workOrder.quantity}
• Status: ${workOrder.status}

⚠️ WARNING: This action cannot be undone!

Are you absolutely sure you want to delete this work order?`;

    if (confirm(confirmMessage)) {
      // Show loading state
      const originalButtonText = event?.target instanceof HTMLElement ? (event.target.closest('button')?.innerHTML || '') : '';
      const deleteButton = event?.target instanceof HTMLElement ? event.target.closest('button') : null;
      
      if (deleteButton) {
        deleteButton.innerHTML = '<mat-icon>hourglass_empty</mat-icon>';
        deleteButton.setAttribute('disabled', 'true');
      }

      this.deleteWorkOrderWithFallback(workOrder.id!, workOrder)
        .then(() => {
          // Remove from local array
          this.workOrders = this.workOrders.filter(wo => wo.id !== workOrder.id);
          this.applyFilters();
          this.calculateSummary();
          
          // Show success message
          alert(`✅ Work Order ${workOrder.orderNumber} has been deleted successfully.`);
        })
        .catch(error => {
          console.error('Error deleting work order:', error);
          
          // Show error message
          alert(`❌ Error: Failed to delete Work Order ${workOrder.orderNumber}. Please try again.
          
Error details: ${error.message || 'Unknown error occurred'}`);
        })
        .finally(() => {
          // Restore button state
          if (deleteButton && originalButtonText) {
            deleteButton.innerHTML = originalButtonText;
            deleteButton.removeAttribute('disabled');
          }
        });
    }
  }

  // Add bulk delete functionality for multiple work orders
  async deleteMultipleWorkOrders(workOrders: WorkOrder[]): Promise<void> {
    // Check delete permission first
    const hasPermission = await this.hasDeletePermission();
    if (!hasPermission) {
      alert('❌ Bạn không có quyền xóa dữ liệu! Vui lòng liên hệ quản trị viên để được cấp quyền.');
      return;
    }

    if (workOrders.length === 0) {
      alert('⚠️ No work orders selected for deletion.');
      return;
    }

    const confirmMessage = `⚠️ BULK DELETE CONFIRMATION ⚠️

You are about to delete ${workOrders.length} work orders:

${workOrders.map(wo => `• ${wo.orderNumber} - ${wo.productCode} (${wo.customer})`).join('\n')}

⚠️ WARNING: This action cannot be undone!

Are you absolutely sure you want to delete these ${workOrders.length} work orders?`;

    if (confirm(confirmMessage)) {
      const deletePromises = workOrders.map(wo => this.deleteWorkOrderWithFallback(wo.id!, wo));
      
      Promise.allSettled(deletePromises)
        .then(results => {
          const successful = results.filter(r => r.status === 'fulfilled').length;
          const failed = results.filter(r => r.status === 'rejected').length;
          
          // Update local data
          const deletedIds = workOrders.map(wo => wo.id);
          this.workOrders = this.workOrders.filter(wo => !deletedIds.includes(wo.id));
          this.applyFilters();
          this.calculateSummary();
          
          // Show results
          if (failed === 0) {
            alert(`✅ Successfully deleted all ${successful} work orders.`);
          } else {
            alert(`⚠️ Bulk delete completed:
• Successfully deleted: ${successful} work orders
• Failed to delete: ${failed} work orders

Please check the console for error details.`);
          }
        })
        .catch(error => {
          console.error('Bulk delete error:', error);
          alert(`❌ Error during bulk delete operation. Please try again.`);
        });
    }
  }

  getStatusClass(status: WorkOrderStatus): string {
    switch (status) {
      case WorkOrderStatus.WAITING: return 'status-waiting';
      case WorkOrderStatus.KITTING: return 'status-kitting';
      case WorkOrderStatus.READY: return 'status-ready';
      case WorkOrderStatus.TRANSFER: return 'status-transfer';
      case WorkOrderStatus.DONE: return 'status-done';
      case WorkOrderStatus.DELAY: return 'status-delay';
      default: return '';
    }
  }

  getPriorityClass(deliveryDate: Date): string {
    const today = new Date();
    const delivery = new Date(deliveryDate);
    const daysUntilDelivery = Math.ceil((delivery.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysUntilDelivery < 0) return 'priority-overdue';
    if (daysUntilDelivery <= 3) return 'priority-urgent';
    if (daysUntilDelivery <= 7) return 'priority-high';
    return 'priority-normal';
  }

  exportToCSV(): void {
    // Filter by selected factory and current month/year
    const filteredData = this.workOrders.filter(wo => 
      wo.factory === this.selectedFactory && 
      wo.year === this.yearFilter && 
      wo.month === this.monthFilter
    );

    if (filteredData.length === 0) {
      alert(`❌ Không có dữ liệu nào cho nhà máy ${this.selectedFactory} trong tháng ${this.monthFilter}/${this.yearFilter}`);
      return;
    }

    const headers = [
      'Năm', 'Tháng', 'STT', 'Mã TP VN LSX', 'Lượng', 'Khách hàng', 'Gấp',
      'Ngày Giao Line', 'NVL thiếu', 'Người soạn', 'Tình trạng', 'Đủ/Thiếu',
      'Ngày nhận thông tin', 'Ghi Chú'
    ];
    
    const csvData = filteredData.map((wo, index) => [
      wo.year,
      wo.month,
      index + 1,
      `${wo.productCode || ''} ${wo.productionOrder || ''}`.trim(),
      wo.quantity,
      wo.customer,
      wo.isUrgent ? 'Có' : 'Không',
      wo.deliveryDate ? new Date(wo.deliveryDate).toLocaleDateString('vi-VN') : '',
      wo.missingMaterials || '',
      wo.createdBy || '',
      this.getStatusText(wo.status),
      wo.materialsStatus === 'sufficient' ? 'Đủ' : wo.materialsStatus === 'insufficient' ? 'Thiếu' : '',
      wo.planReceivedDate ? new Date(wo.planReceivedDate).toLocaleDateString('vi-VN') : '',
      wo.notes || ''
    ]);
    
    const csvContent = [headers, ...csvData]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `work-orders-${this.selectedFactory}-${this.yearFilter}-${this.monthFilter}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    console.log(`📊 Xuất ${filteredData.length} work orders của nhà máy ${this.selectedFactory} tháng ${this.monthFilter}/${this.yearFilter}`);
  }

  // Excel Import Functionality
  openImportDialog(): void {
    this.showImportDialog = true;
    this.importResults = null;
  }

  closeImportDialog(): void {
    this.showImportDialog = false;
    this.importResults = null;
    this.importProgress = 0;
  }

  async importExcelFile(file: File): Promise<void> {
    this.isImporting = true;
    this.importProgress = 0;
    
    console.log('Starting Excel import process for file:', file.name, 'Size:', file.size, 'bytes');
    
    try {
      // Step 1: Read Excel file
      console.log('Step 1: Reading Excel file...');
      this.importProgress = 10;
      const data = await this.readExcelFile(file);
      console.log('Excel file read successfully, rows:', data.length);
      
      // Debug: Log first few rows to understand structure
      if (data.length > 0) {
        console.log('Excel headers:', data[0]);
        if (data.length > 1) {
          console.log('First data row:', data[1]);
        }
        if (data.length > 2) {
          console.log('Second data row:', data[2]);
        }
      }
      
      // Step 2: Parse data with timeout protection
      console.log('Step 2: Parsing Excel data...');
      this.importProgress = 20;
      
      const workOrders = await this.parseExcelDataWithTimeout(data);
      console.log(`✅ Parsed ${workOrders.length} valid work orders`);
      
      if (workOrders.length === 0) {
        throw new Error('No valid work orders found in the Excel file');
      }
      
      // Step 3: Check for duplicate LSX (productionOrder) values in Firebase
      console.log('Step 3: Checking for duplicate LSX in Firebase...');
      this.importProgress = 30;
      
      // Extract all LSX values from the imported data
      const importedLSX = workOrders.map(wo => wo.productionOrder).filter(lsx => lsx);
      console.log('📋 LSX values to check:', importedLSX);
      
      // Check against Firebase for existing LSX
      const lsxCheck = await this.checkExistingLSXInFirebase(importedLSX);
      
      console.log('📊 Firebase LSX Check Results:');
      console.log('  - Existing in Firebase:', lsxCheck.existing);
      console.log('  - New (not in Firebase):', lsxCheck.new);
      console.log('  - Total imported LSX:', importedLSX.length);
      console.log('  - Already exist:', lsxCheck.existing.length);
      console.log('  - New:', lsxCheck.new.length);
      
      // Filter work orders based on Firebase check
      const validWorkOrders: Partial<WorkOrder>[] = [];
      const duplicates: string[] = [];
      
      for (const workOrder of workOrders) {
        if (workOrder.productionOrder && lsxCheck.existing.includes(workOrder.productionOrder)) {
          duplicates.push(workOrder.productionOrder);
          console.warn(`⚠️ LSX already exists in Firebase: ${workOrder.productionOrder}`);
        } else {
          validWorkOrders.push(workOrder);
        }
      }

      if (duplicates.length > 0) {
        const duplicateMessage = `⚠️ Tìm thấy ${duplicates.length} LSX đã tồn tại trong Firebase:\n${duplicates.join(', ')}\n\nChỉ import ${validWorkOrders.length} work orders mới.`;
        console.warn(duplicateMessage);
        // Don't show alert here, let the bulk insert handle it
      }

      // Validate data before saving
      if (validWorkOrders.length === 0) {
        throw new Error('No valid data found in Excel file (all LSX already exist in Firebase)');
      }

      // Step 4: Bulk insert
      console.log('Step 4: Starting bulk insert...');
      this.importProgress = 40;
      const results = await this.bulkInsertWorkOrders(validWorkOrders);
      
      // Step 5: Complete
      console.log('Step 5: Import completed');
      this.importResults = results;
      // Progress will be set to 100% by bulkInsertWorkOrders
      
      // Show detailed results message - only alert on complete failure
      if (results.success === 0) {
        // Complete failure - show alert
        const message = `❌ Import thất bại hoàn toàn!\n\n` +
          `Không có work order nào được import thành công.\n` +
          `Vui lòng kiểm tra format file Excel và thử lại.`;
        alert(message);
      } else if (results.success > 0 && results.failed > 0) {
        // Partial success - log to console only, no alert to avoid confusion
        console.log(`⚠️ Import hoàn thành với một số lỗi:
✅ Thành công: ${results.success} work orders
❌ Thất bại: ${results.failed} work orders
Kiểm tra chi tiết lỗi trong popup import.`);
      } else {
        // Complete success - log to console only
        console.log(`🎉 Import hoàn thành thành công!
✅ Đã import thành công: ${results.success} work orders`);
      }

      // Show duplicate LSX warning if any
      if (duplicates.length > 0) {
        const duplicateMessage = `⚠️ Tìm thấy ${duplicates.length} LSX đã tồn tại trong Firebase:\n${duplicates.join(', ')}\n\nChỉ import ${validWorkOrders.length} work orders mới.`;
        alert(duplicateMessage);
      }
      
      // Always reload data to show any successful imports
      if (results.success > 0) {
        console.log('✅ Import successful! Reloading data and resetting filters...');
        
        // Close import dialog immediately to show results
        this.closeImportDialog();
        
        // Wait longer for Firestore to sync then reload
        setTimeout(() => {
          console.log('🔄 Reloading work orders after import...');
          
          // Reset filters to show all work orders (including newly imported ones)
          this.resetFiltersToShowAll();
          
          // Reload data
          this.loadWorkOrders(); // This will automatically call assignSequentialNumbers
          
          console.log('✅ Data reload completed');
        }, 2000); // Increased to 2 seconds for better Firestore sync
      }
      
    } catch (error) {
      console.error('Import error:', error);
      const errorMessage = error?.message || error?.toString() || 'Unknown error occurred';
      
      this.importResults = {
        success: 0,
        failed: 1,
        errors: [{ 
          row: 0, 
          error: `Import failed: ${errorMessage}`,
          data: null 
        }]
      };
      
      // Show error message to user
      alert(`❌ Import failed:\n\n${errorMessage}\n\nPlease check the file format and try again.`);
      
    } finally {
      this.isImporting = false;
      this.importProgress = 100;
      console.log('Import process fully completed - UI updated');
      
      // Force UI update
      setTimeout(() => {
        this.importProgress = 100;
      }, 100);
    }
  }

  // Wrapper for parseExcelData with timeout protection
  private async parseExcelDataWithTimeout(data: any[]): Promise<Partial<WorkOrder>[]> {
    return new Promise((resolve, reject) => {
      // Set timeout to prevent hanging
      const timeoutId = setTimeout(() => {
        reject(new Error('Excel parsing timeout after 30 seconds. File may be too large or complex.'));
      }, 30000);
      
      try {
        console.log('🔄 Starting Excel data parsing...');
        const result = this.parseExcelData(data);
        console.log('✅ Excel parsing completed successfully');
        clearTimeout(timeoutId);
        resolve(result);
      } catch (error) {
        console.error('❌ Excel parsing failed:', error);
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }



  private parseExcelData(data: any[]): Partial<WorkOrder>[] {
    if (data.length < 2) {
      throw new Error('Excel file must have headers and at least one data row');
    }

    const headers = data[0];
    const workOrders: Partial<WorkOrder>[] = [];
    const errors: string[] = [];

    console.log('Excel headers:', headers);
    console.log('Total rows to process:', data.length - 1);

    // Expected headers (simplified import - only essential fields, No will be auto-generated)
    const expectedHeaders = [
      'P/N', 'Work Order', 'Quantity', 'Customer', 'Delivery Date', 'Line', 'Plan Received'
    ];

    // Show date format reminder
    console.log('📅 Expected date format: DD/MM/YYYY (e.g., 31/12/2024)');
    console.log('🔢 Note: No column will be auto-generated based on delivery date sequence');

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      
      // Skip completely empty rows
      if (!row || row.length === 0 || row.every(cell => !cell || cell === '')) {
        console.log(`Skipping empty row ${i}`);
        continue;
      }

      try {
        console.log(`Processing row ${i}:`, row);

        // Validate required fields with updated indices (Factory is now first column)
        if (!row[4] || row[4].toString().trim() === '') { // P/N is required (now at index 4)
          errors.push(`Row ${i + 1}: Product Code (P/N) is required`);
          continue;
        }
        if (!row[5] || row[5].toString().trim() === '') { // Work Order is required (now at index 5)
          errors.push(`Row ${i + 1}: Work Order is required`);
          continue;
        }
        
        // More lenient quantity check
        const quantityValue = row[6];
        const quantity = parseInt(quantityValue);
        if (!quantityValue || isNaN(quantity) || quantity <= 0) { // Quantity is required and must be positive number
          errors.push(`Row ${i + 1}: Valid positive quantity is required (got: ${quantityValue})`);
          continue;
        }
        
        if (!row[7] || row[7].toString().trim() === '') { // Customer is required (now at index 7)
          errors.push(`Row ${i + 1}: Customer is required`);
          continue;
        }
        if (!row[10] || row[10].toString().trim() === '') { // Line is required (now at index 10)
          errors.push(`Row ${i + 1}: Production Line is required`);
          continue;
        }

        // Parse factory from Excel (first column in template)
        let factory = this.selectedFactory; // Default to selected factory
        if (row[0] && row[0].toString().trim()) { // Factory is in first column (index 0)
          const factoryValue = row[0].toString().trim();
          // Validate factory value
          const validFactories = ['ASM1', 'ASM2', 'Sample 1', 'Sample 2'];
          if (validFactories.includes(factoryValue)) {
            factory = factoryValue;
            console.log(`Row ${i + 1}: Factory set to ${factory}`);
          } else {
            console.warn(`Row ${i + 1}: Invalid factory value "${factoryValue}", using default ${this.selectedFactory}`);
          }
        } else {
          console.log(`Row ${i + 1}: No factory specified, using default ${this.selectedFactory}`);
        }

        const workOrder: Partial<WorkOrder> = {
          year: new Date().getFullYear(),
          month: new Date().getMonth() + 1,
          factory: factory, // Use parsed factory value
          orderNumber: '', // Will be auto-assigned based on delivery date sequence
          productCode: row[4].toString().trim(), // P/N (now at index 4)
          productionOrder: row[5].toString().trim(), // Work Order (now at index 5)
          quantity: quantity, // Use the validated quantity (from index 6)
          customer: row[7].toString().trim(), // Customer (now at index 7)
          deliveryDate: undefined, // Sẽ gán bên dưới
          productionLine: row[10].toString().trim(), // Line (now at index 10)
          status: WorkOrderStatus.WAITING,
          createdBy: 'Excel Import', // Set import source
          checkedBy: '', // Will be set on web
          planReceivedDate: undefined, // Sẽ gán bên dưới
          notes: 'Imported from Excel', // Set import note
          createdDate: new Date(),
          lastUpdated: new Date()
        };

        // Parse and log Delivery Date
        const deliveryRaw = row[9]; // Delivery Date is now at index 9
        const deliveryParsed = this.parseExcelDate(deliveryRaw);
        if (!deliveryParsed || isNaN(deliveryParsed.getTime())) {
          console.warn(`Row ${i + 1}: Delivery Date parse failed! Raw value:`, deliveryRaw, 'Parsed:', deliveryParsed);
        } else {
          console.log(`Row ${i + 1}: Delivery Date OK. Raw:`, deliveryRaw, 'Parsed:', deliveryParsed);
        }
        workOrder.deliveryDate = deliveryParsed;

        // Parse and log Plan Received Date
        const planRaw = row[15]; // Plan Received Date is now at index 15
        const planParsed = this.parseExcelDate(planRaw);
        if (!planParsed || isNaN(planParsed.getTime())) {
          console.warn(`Row ${i + 1}: Plan Received Date parse failed! Raw value:`, planRaw, 'Parsed:', planParsed);
        } else {
          console.log(`Row ${i + 1}: Plan Received Date OK. Raw:`, planRaw, 'Parsed:', planParsed);
        }
        workOrder.planReceivedDate = planParsed;

        console.log(`Successfully parsed work order:`, workOrder);
        workOrders.push(workOrder);
      } catch (error) {
        const errorMsg = `Row ${i + 1}: ${error?.message || error?.toString() || 'Unknown parsing error'}`;
        console.error(errorMsg, error);
        errors.push(errorMsg);
        // Continue processing other rows even if this one fails
      }
    }

    console.log(`✅ Parsed ${workOrders.length} work orders from ${data.length - 1} rows`);
    
    if (errors.length > 0) {
      console.warn('⚠️ Parsing errors found:', errors);
      console.warn(`🔢 ${errors.length} rows had issues and were skipped`);
      console.warn(`📅 Remember: Date format should be DD/MM/YYYY (e.g., 31/12/2024)`);
      
      // Store errors for later display instead of blocking with alert
      this.importResults = this.importResults || { success: 0, failed: 0, errors: [] };
      this.importResults.parseErrors = errors;
    }

    if (workOrders.length === 0) {
      throw new Error(`No valid work orders found in Excel file. Found ${errors.length} parsing errors. Please check the data format and column headers.`);
    }

    return workOrders;
  }

  private parseExcelDate(dateValue: any): Date {
    try {
      if (!dateValue) {
        console.log('Empty date value, using current date');
        return new Date();
      }
      
      console.log('Parsing date value:', dateValue, 'Type:', typeof dateValue);
    
    // If it's already a Date object
      if (dateValue instanceof Date) {
        if (isNaN(dateValue.getTime())) {
          console.warn('Invalid Date object, using current date');
          return new Date();
        }
        console.log('Already a Date object:', dateValue);
        return dateValue;
      }
      
      // If it's an Excel date number (days since 1900-01-01)
      if (typeof dateValue === 'number' && dateValue > 1) {
        try {
          const excelDate = new Date((dateValue - 25569) * 86400 * 1000);
          if (isNaN(excelDate.getTime())) {
            throw new Error('Invalid Excel date calculation');
          }
          console.log('Parsed Excel number date:', dateValue, '->', excelDate);
          return excelDate;
        } catch (error) {
          console.error('Error parsing Excel date number:', error);
          return new Date();
        }
    }
    
    // If it's a string, try to parse it
    if (typeof dateValue === 'string') {
        const trimmedValue = dateValue.trim();
        if (!trimmedValue) {
          return new Date();
        }
        
        // Try different date formats
        let parsed: Date;
        
        try {
          // Priority Format: DD/MM/YYYY (Vietnamese standard)
          if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmedValue)) {
            const parts = trimmedValue.split('/');
            const day = parseInt(parts[0]);
            const month = parseInt(parts[1]);
            const year = parseInt(parts[2]);
            
            // Validate day and month ranges
            if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900 && year <= 2100) {
              // Create date in DD/MM/YYYY format
              parsed = new Date(year, month - 1, day); // month is 0-indexed in JS Date
              if (!isNaN(parsed.getTime())) {
                console.log('Parsed DD/MM/YYYY date:', trimmedValue, '->', parsed);
                return parsed;
              }
            }
            console.warn('Invalid DD/MM/YYYY date range:', trimmedValue);
          }
          // Format: YYYY-MM-DD
          else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmedValue)) {
            parsed = new Date(trimmedValue + 'T00:00:00');
            if (!isNaN(parsed.getTime())) {
              console.log('Parsed YYYY-MM-DD date:', trimmedValue, '->', parsed);
              return parsed;
            }
          }
          // Format: DD-MM-YYYY
          else if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(trimmedValue)) {
            const parts = trimmedValue.split('-');
            const day = parseInt(parts[0]);
            const month = parseInt(parts[1]);
            const year = parseInt(parts[2]);
            
            if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900 && year <= 2100) {
              parsed = new Date(year, month - 1, day);
              if (!isNaN(parsed.getTime())) {
                console.log('Parsed DD-MM-YYYY date:', trimmedValue, '->', parsed);
                return parsed;
              }
            }
            console.warn('Invalid DD-MM-YYYY date range:', trimmedValue);
          }
          
          // Fallback to default Date parsing
          parsed = new Date(trimmedValue);
          if (!isNaN(parsed.getTime())) {
            console.log('Parsed with default parser:', trimmedValue, '->', parsed);
            return parsed;
          }
          
        } catch (parseError) {
          console.error('Error parsing date string:', parseError);
        }
      }
      
      console.log('Unable to parse date, using current date');
      return new Date();
      
    } catch (error) {
      console.error('Unexpected error in parseExcelDate:', error);
    return new Date();
    }
  }

  private async bulkInsertWorkOrders(workOrders: Partial<WorkOrder>[]): Promise<any> {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as any[]
    };

    const total = workOrders.length;
    console.log(`🚀 Starting bulk insert of ${total} work orders...`);
    console.log('📊 Sample work order data:', workOrders[0]);
    
    // Progress range: 30% - 95% (reserve 5% for final steps)
    const progressStart = 30;
    const progressEnd = 95;
    const progressRange = progressEnd - progressStart;
    
    // Process in smaller batches to avoid overwhelming Firestore
    const batchSize = 3; // Reduce batch size for better debugging
    
    for (let batchStart = 0; batchStart < total; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize, total);
      const batch = workOrders.slice(batchStart, batchEnd);
      const batchNumber = Math.floor(batchStart/batchSize) + 1;
      const totalBatches = Math.ceil(total / batchSize);
      
      console.log(`📦 Processing batch ${batchNumber}/${totalBatches}: items ${batchStart + 1}-${batchEnd}`);
    
      // Process batch items sequentially for better error tracking
      for (let i = 0; i < batch.length; i++) {
        const workOrderData = batch[i];
        const globalIndex = batchStart + i;
        
        try {
          console.log(`🔄 Processing work order ${globalIndex + 1}/${total}:`, workOrderData);
          
          // Additional validation before insert
          const workOrder = workOrderData as WorkOrder;
          
          // Validate required fields with detailed logging
          if (!workOrder.productCode || !workOrder.productionOrder || !workOrder.customer) {
            const missingFields = [];
            if (!workOrder.productCode) missingFields.push('productCode');
            if (!workOrder.productionOrder) missingFields.push('productionOrder'); 
            if (!workOrder.customer) missingFields.push('customer');
            throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
          }
          
          // Ensure all required fields have valid values with logging
          if (!workOrder.orderNumber) {
            workOrder.orderNumber = this.generateOrderNumber();
            console.log(`🏷️ Generated order number: ${workOrder.orderNumber}`);
          }
          if (!workOrder.deliveryDate) {
            workOrder.deliveryDate = new Date();
            console.log(`📅 Set default delivery date: ${workOrder.deliveryDate}`);
          }
          if (!workOrder.planReceivedDate) {
            workOrder.planReceivedDate = new Date();
            console.log(`📅 Set default plan received date: ${workOrder.planReceivedDate}`);
          }
          
                     // Add default values if missing
           if (!workOrder.status) workOrder.status = WorkOrderStatus.WAITING;
           if (!workOrder.productionLine) workOrder.productionLine = 'Line 1';
          if (!workOrder.year) workOrder.year = new Date().getFullYear();
          if (!workOrder.month) workOrder.month = new Date().getMonth() + 1;
          
          console.log(`📤 Sending to Firebase:`, JSON.stringify(workOrder, null, 2));
          
          // Try with retry mechanism
          let saveSuccess = false;
          let lastError;
          
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              console.log(`🔄 Firebase save attempt ${attempt}/3 for work order ${globalIndex + 1}`);
              
              // Add debug logging for service method
              console.log('🔍 Checking materialService:', {
                serviceExists: !!this.materialService,
                addWorkOrderExists: !!(this.materialService && this.materialService.addWorkOrder),
                serviceType: typeof this.materialService,
                methodType: typeof (this.materialService && this.materialService.addWorkOrder)
              });
              
              // Use direct Firestore method as backup for production build issues
              let result;
              if (this.materialService && typeof this.materialService.addWorkOrder === 'function') {
                console.log('📄 Using MaterialLifecycleService.addWorkOrder');
                result = await this.materialService.addWorkOrder(workOrder);
              } else {
                console.log('⚠️ Using fallback direct Firestore method');
                result = await this.addWorkOrderDirect(workOrder);
              }
              console.log(`✅ Firebase save successful on attempt ${attempt}:`, result);
              saveSuccess = true;
              break;
              
            } catch (saveError) {
              console.error(`❌ Firebase save attempt ${attempt} failed:`, saveError);
              lastError = saveError;
              
              if (attempt < 3) {
                console.log(`⏳ Waiting 1 second before retry...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
          }
          
          if (!saveSuccess) {
            throw lastError || new Error('Failed to save after 3 attempts');
          }
          
        results.success++;
          console.log(`✅ Successfully saved work order ${globalIndex + 1}: ${workOrder.orderNumber} (Total success: ${results.success})`);
          
      } catch (error) {
          console.error(`❌ Failed to process work order ${globalIndex + 1}:`, error);
          console.error('📋 Failed work order data:', workOrderData);
          console.error('🔍 Error details:', {
            message: error?.message,
            stack: error?.stack,
            name: error?.name
          });
          
        results.failed++;
        results.errors.push({
            row: globalIndex + 2, // +2 for Excel row numbering
            data: workOrderData,
            error: `${error?.message || error?.toString() || 'Unknown error'} (Attempts: 3)`
          });
        }
        
        // Update progress
        const completed = results.success + results.failed;
        const progressPercent = (completed / total) * progressRange + progressStart;
        this.importProgress = Math.round(progressPercent);
        console.log(`📈 Progress update: ${completed}/${total} completed = ${this.importProgress}%`);
        
        // Small delay between items to prevent rate limiting
        if (globalIndex < total - 1) {
          console.log(`⏳ Waiting 300ms before next item...`);
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      console.log(`✅ Batch ${batchNumber}/${totalBatches} completed. Current results: ${results.success} success, ${results.failed} failed`);
    }

    console.log(`🏁 Bulk insert completed: ${results.success} success, ${results.failed} failed`);
    
    // Log detailed results
    if (results.errors.length > 0) {
      console.error('❌ Import errors summary:');
      results.errors.forEach((error, index) => {
        console.error(`Error ${index + 1}: Row ${error.row} - ${error.error}`);
      });
    }
    
    // Ensure progress reaches 100% when completely finished
    this.importProgress = 100;
    console.log('🎯 Progress set to 100% - Import process completed');

    return results;
  }

  downloadTemplate(): void {
    console.log('📥 Creating Work Order Excel template...');
    
    // Create template data with Factory as first column
    const templateData = [
      ['Nhà Máy', 'Năm', 'Tháng', 'STT', 'Mã TP VN', 'LSX', 'Lượng sản phẩm', 'Khách hàng', 'Gấp', 'Ngày Giao NVL', 'Line', 'NVL thiếu', 'Người soạn', 'Tình trạng', 'Đủ/Thiếu', 'Ngày nhận thông tin', 'Ghi Chú'],
      ['ASM1', 2024, 12, 'WO001', 'P/N001', 'PO2024001', 100, 'Khách hàng A', 'Gấp', '31/12/2024', 'Line 1', 'NVL A, NVL B', 'Hoàng Tuấn', 'Waiting', 'Đủ', '01/12/2024', 'Ghi chú mẫu'],
      ['ASM2', 2024, 12, 'WO002', 'P/N002', 'PO2024002', 50, 'Khách hàng B', '', '15/12/2024', 'Line 2', '', 'Hữu Tình', 'Ready', 'Thiếu', '01/12/2024', ''],
      ['ASM1', 2024, 12, 'WO003', 'P/N003', 'PO2024003', 75, 'Khách hàng C', '', '20/12/2024', 'Line 3', 'NVL C', 'Hoàng Vũ', 'Done', 'Đủ', '01/12/2024', 'Hoàn thành']
    ];
    
    // Create workbook
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(templateData);
    
    // Set column widths
    const columnWidths = [
      { wch: 10 }, // Nhà Máy
      { wch: 8 },  // Năm
      { wch: 8 },  // Tháng
      { wch: 12 }, // STT
      { wch: 15 }, // Mã TP VN
      { wch: 15 }, // LSX
      { wch: 12 }, // Lượng sản phẩm
      { wch: 15 }, // Khách hàng
      { wch: 8 },  // Gấp
      { wch: 15 }, // Ngày Giao NVL
      { wch: 12 }, // Line
      { wch: 20 }, // NVL thiếu
      { wch: 12 }, // Người soạn
      { wch: 12 }, // Tình trạng
      { wch: 10 }, // Đủ/Thiếu
      { wch: 18 }, // Ngày nhận thông tin
      { wch: 20 }  // Ghi Chú
    ];
    worksheet['!cols'] = columnWidths;
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Work Orders Template');
    
    // Generate filename with current date
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const filename = `Work_Orders_Template_${dateStr}.xlsx`;
    
    // Download file
    XLSX.writeFile(workbook, filename);
    
    console.log('✅ Work Order template downloaded:', filename);
    alert(`✅ Đã tải xuống template Excel: ${filename}`);
  }

  /** Tải form mẫu import PXK - cập nhật theo template in PXK. Cột E=Mã Khách Hàng, cột P=Số PO KH, cột R=Ghi chú */
  downloadPxkTemplate(): void {
    const templateData = [
      ['Mã Ctừ', 'Số Chứng Từ', 'Số lệnh sản xuất', 'Mã sản phẩm', 'Mã Khách Hàng', 'Mã vật tư', 'Tên Vật Tư', 'Đơn vị tính', 'Số PO', 'Xuất Kho', 'Mã Kho', 'Định Mức', 'Loại Hình', 'Tên TP', 'Tổng SL Y/Cầu', 'Số PO KH', 'Phần Trăm Hao Hụt', 'Ghi chú'],
      ['PX', 'KZPX0226/0001', 'KZLSX0326/0089', 'P005363_A', '', 'B006006', '', 'M', 'PO001', 1054.58, 'NVL', '', '', '', '', '', '', ''],
      ['PX', 'KZPX0226/0001', 'KZLSX0326/0089', 'P001013_A', '', 'B009598', '', 'PCS', 'PO002', 100, 'NVL_SX', '', '', '', '', '', '', ''],
      ['PX', 'LHPX0226/0001', 'LHLSX0326/0089', 'P005363_A', '', 'B006006', '', 'M', 'PO001', 500, 'NVL', '', '', '', '', '', '', '']
    ];
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(templateData);
    worksheet['!cols'] = [
      { wch: 12 }, // A: Mã Ctừ
      { wch: 15 }, // B: Số Chứng Từ
      { wch: 22 }, // C: Số lệnh sản xuất
      { wch: 15 }, // D: Mã sản phẩm
      { wch: 18 }, // E: Mã Khách Hàng
      { wch: 15 }, // F: Mã vật tư
      { wch: 20 }, // G: Tên Vật Tư
      { wch: 12 }, // H: Đơn vị tính
      { wch: 12 }, // I: Số PO
      { wch: 12 }, // J: Xuất Kho
      { wch: 14 }, // K: Mã Kho
      { wch: 12 }, // L: Định Mức
      { wch: 12 }, // M: Loại Hình
      { wch: 15 }, // N: Tên TP
      { wch: 14 }, // O: Tổng SL Y/Cầu
      { wch: 12 }, // P: Số PO KH
      { wch: 16 }, // Q: Phần Trăm Hao Hụt
      { wch: 25 }  // R: Ghi chú
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet, 'PXK');
    const filename = `Form_Import_PXK_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, filename);
    alert(`✅ Đã tải xuống form PXK: ${filename}`);
  }

  /** Tải lịch sử PXK theo tháng - tất cả các cột từ PXK. Nếu pxkDownloadAllMonths=true thì tải tất cả không lọc tháng. */
  async downloadPxkHistoryByMonth(): Promise<void> {
    this.isDownloadingPxk = true;
    try {
      const snapshot = await firstValueFrom(this.firestore.collection('pxk-import-data').get());
      const y = this.pxkDownloadDate.getFullYear();
      const m = this.pxkDownloadDate.getMonth() + 1;
      const startOfMonth = new Date(y, m - 1, 1);
      const endOfMonth = new Date(y, m, 0, 23, 59, 59, 999);
      const filterByMonth = !this.pxkDownloadAllMonths;
      const rows: any[][] = [
        ['Mã Ctừ', 'Số CT', 'LSX', 'Mã SP', 'Mã vật tư', 'Số PO', 'Mã Kho', 'Số lượng xuất thực tế', 'Đvt', 'Loại Hình', 'Nhà máy', 'Ngày import']
      ];
      let totalRows = 0;
      snapshot.docs.forEach((docSnap: any) => {
        const d = docSnap.data();
        const lsx = String(d?.lsx || '').trim();
        const lines = Array.isArray(d?.lines) ? d.lines : [];
        let importedAt: Date | null = null;
        if (d?.importedAt) {
          const t = d.importedAt;
          importedAt = t?.toDate ? t.toDate() : (t instanceof Date ? t : new Date(t));
        }
        if (filterByMonth && (!importedAt || importedAt < startOfMonth || importedAt > endOfMonth)) return;
        if (!lsx || lines.length === 0) return;
        for (const line of lines) {
          const l = line as any;
          const factoryVal = (d?.factory ?? l?.factory ?? this.selectedFactory ?? '') as string;
          rows.push([
            'PX',
            l?.soChungTu ?? '',
            lsx,
            l?.maSanPham ?? '', // Mã SP - không lưu trong PxkLine, để trống
            l?.materialCode ?? '',
            l?.po ?? '',
            l?.maKho ?? '',
            l?.quantity ?? 0,
            l?.unit ?? '',
            l?.loaiHinh ?? '',
            factoryVal,
            importedAt ? importedAt.toLocaleDateString('vi-VN') : ''
          ]);
          totalRows++;
        }
      });
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      worksheet['!cols'] = [
        { wch: 8 }, { wch: 16 }, { wch: 22 }, { wch: 14 }, { wch: 15 },
        { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 14 }
      ];
      XLSX.utils.book_append_sheet(workbook, worksheet, 'PXK');
      const monthName = this.months.find(mo => mo.value === m)?.name || String(m);
      const filename = this.pxkDownloadAllMonths
        ? `PXK_LichSu_TatCa_${new Date().toISOString().split('T')[0]}.xlsx`
        : `PXK_LichSu_${y}_${String(m).padStart(2, '0')}_${monthName}.xlsx`;
      XLSX.writeFile(workbook, filename);
      const msg = this.pxkDownloadAllMonths
        ? `Đã tải xuống ${totalRows} dòng PXK (tất cả): ${filename}`
        : `Đã tải xuống ${totalRows} dòng PXK tháng ${m}/${y}: ${filename}`;
      alert(`✅ ${msg}`);
    } catch (e) {
      console.error('[PXK Download]', e);
      alert('Lỗi khi tải PXK: ' + (e && (e as Error).message ? (e as Error).message : 'Vui lòng thử lại.'));
    } finally {
      this.isDownloadingPxk = false;
      this.showPxkDownloadDialog = false;
    }
  }

  // Selection functionality methods
  isSelected(workOrder: WorkOrder): boolean {
    return this.selectedWorkOrders.some(wo => wo.id === workOrder.id);
  }

  toggleSelection(workOrder: WorkOrder, event: any): void {
    if (event.checked) {
      this.selectedWorkOrders.push(workOrder);
    } else {
      this.selectedWorkOrders = this.selectedWorkOrders.filter(wo => wo.id !== workOrder.id);
    }
  }

  isAllSelected(): boolean {
    return this.filteredWorkOrders.length > 0 && 
           this.selectedWorkOrders.length === this.filteredWorkOrders.length;
  }

  isIndeterminate(): boolean {
    return this.selectedWorkOrders.length > 0 && 
           this.selectedWorkOrders.length < this.filteredWorkOrders.length;
  }

  toggleAllSelection(event: any): void {
    if (event.checked) {
      // Select all filtered work orders
      this.selectedWorkOrders = [...this.filteredWorkOrders];
    } else {
      // Deselect all
      this.selectedWorkOrders = [];
    }
  }

  async deleteSelectedWorkOrders(): Promise<void> {
    if (this.selectedWorkOrders.length === 0) {
      alert('⚠️ No work orders selected for deletion.');
      return;
    }

    await this.deleteMultipleWorkOrders(this.selectedWorkOrders);
    
    // Clear selection after deletion attempt
    this.selectedWorkOrders = [];
  }

  // Clear selection when filters change
  private clearSelection(): void {
    this.selectedWorkOrders = [];
  }

  // Handle case when filters result in no data but work orders exist
  // Direct Firestore method as fallback for production build issues
  // Reset filters to show all work orders (useful after import)
  private resetFiltersToShowAll(): void {
    console.log('🔄 Resetting filters to show all work orders...');
    
    // Use existing showAllWorkOrders method to truly show everything
    this.showAllWorkOrders();
    
    console.log('✅ Filters reset to show all work orders');
  }

  private async addWorkOrderDirect(workOrder: WorkOrder): Promise<any> {
    console.log('🔄 Direct Firestore save for work order:', {
      orderNumber: workOrder.orderNumber,
      productCode: workOrder.productCode,
      customer: workOrder.customer
    });
    
    try {
      // Add timestamps
      workOrder.createdDate = new Date();
      workOrder.lastUpdated = new Date();
      
      // Try Angular Fire first
      try {
        const result = await this.firestore.collection('work-orders').add(workOrder);
        console.log('✅ Angular Fire save successful!', result);
        return result;
      } catch (angularFireError) {
        console.log('⚠️ Angular Fire failed, trying Firebase v9 SDK...', angularFireError);
        
        // Fallback to Firebase v9 modular SDK
        const app = initializeApp(environment.firebase);
        const db = getFirestore(app);
        const docRef = await addDoc(collection(db, 'work-orders'), workOrder);
        console.log('✅ Firebase v9 SDK save successful!', docRef);
        return { id: docRef.id };
      }
    } catch (error) {
      console.error('❌ All Firestore save methods failed!', error);
      throw new Error(`Direct Firestore save failed: ${error?.message || error}`);
    }
  }

  // Enhanced fallback delete method to handle all production issues
  private async deleteWorkOrderWithFallback(id: string, workOrder: WorkOrder): Promise<void> {
    console.log('🗑️ Attempting to delete work order:', id);
    
    // Try method 1: MaterialLifecycleService
    try {
      if (this.materialService && typeof this.materialService.deleteWorkOrder === 'function') {
        console.log('📄 Attempt 1: MaterialLifecycleService.deleteWorkOrder');
        await this.materialService.deleteWorkOrder(id);
        console.log('✅ MaterialLifecycleService delete successful');
        return; // Success, exit early
      }
    } catch (error) {
      console.log('⚠️ MaterialLifecycleService failed, trying fallback methods...', error);
    }

    // Try method 2: Direct AngularFirestore
    try {
      console.log('📄 Attempt 2: Direct AngularFirestore delete');
      await this.firestore.collection('work-orders').doc(id).delete();
      console.log('✅ Direct AngularFirestore delete successful');
      return; // Success, exit early
    } catch (error) {
      console.log('⚠️ AngularFirestore failed, trying Firebase v9 SDK...', error);
    }

    // Try method 3: Firebase v9 SDK (final fallback)
    try {
      console.log('📄 Attempt 3: Firebase v9 SDK delete');
      const app = initializeApp(environment.firebase);
      const db = getFirestore(app);
      await deleteDoc(doc(db, 'work-orders', id));
      console.log('✅ Firebase v9 SDK delete successful');
      return; // Success, exit early
    } catch (error) {
      console.error('❌ All delete methods failed!', error);
      throw new Error(`All delete methods failed for work order ${id}: ${error?.message || error}`);
    }
  }

  readExcelFile(file: File): Promise<any[]> {
    return new Promise((resolve, reject) => {
      console.log('📋 Starting Excel file processing...');
      
      const reader = new FileReader();
      
      reader.onload = (e: any) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          
          // Get the first sheet
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          
          // Convert to JSON
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          
          console.log('📊 Raw Excel data:', jsonData.length, 'rows');
          
          if (jsonData.length < 2) {
            throw new Error('File không có dữ liệu hoặc thiếu header');
          }
          
          resolve(jsonData);
          
        } catch (error) {
          console.error('❌ Error processing Excel file:', error);
          reject(error);
        }
      };
      
      reader.onerror = (error) => {
        console.error('❌ Error reading file:', error);
        reject(error);
      };
      
      reader.readAsArrayBuffer(file);
    });
  }

  async processExcelData(jsonData: any[]): Promise<void> {
    console.log('📋 Processing Excel data...');
    this.isLoading = true;
    
    try {
      // Remove header row and convert to WorkOrder format
      const dataRows = jsonData.slice(1); // Skip header row
      const newWorkOrderData = dataRows.map((row: any, index: number) => ({
        factory: row[0]?.toString() || this.selectedFactory, // First column is factory (ASM1/ASM2)
        year: row[1] ? parseInt(row[1].toString()) : new Date().getFullYear(),
        month: row[2] ? parseInt(row[2].toString()) : new Date().getMonth() + 1,
        orderNumber: row[3]?.toString() || '',
        productCode: row[4]?.toString() || '',
        productionOrder: row[5]?.toString()?.trim() || '', // Trim whitespace
        quantity: row[6] ? parseInt(row[6].toString()) : 0,
        customer: row[7]?.toString() || '',
        isUrgent: row[8]?.toString().toLowerCase() === 'gấp' || row[8]?.toString().toLowerCase() === 'urgent',
        deliveryDate: this.parseExcelDate(row[9]) || new Date(),
        productionLine: row[10]?.toString() || '',
        missingMaterials: row[11]?.toString() || '',
        createdBy: row[12]?.toString() || '',
        status: this.parseStatus(row[13]) || WorkOrderStatus.WAITING,
        materialsComplete: row[14]?.toString().toLowerCase() === 'đủ' || row[14]?.toString().toLowerCase() === 'complete',
        planReceivedDate: this.parseExcelDate(row[15]) || new Date(),
        notes: row[16]?.toString() || '',
        createdDate: new Date(),
        lastUpdated: new Date()
      } as WorkOrder)).filter(wo => wo.productionOrder); // Filter out empty LSX

      console.log('📋 Processed new work order data:', newWorkOrderData.length, 'items');

      // Check for duplicate LSX (productionOrder) values - KIỂM TRA VỚI FIREBASE THAY VÌ this.workOrders
      const importedLSX = newWorkOrderData
        .map(wo => wo.productionOrder?.trim())
        .filter(lsx => lsx);
      console.log('📋 LSX values to check (after trim):', importedLSX);
      console.log('📋 Raw LSX values from Excel:', newWorkOrderData.map(wo => `"${wo.productionOrder}"`));
      
      // Check against Firebase for existing LSX (giống như importWorkOrdersFromExcel)
      const lsxCheck = await this.checkExistingLSXInFirebase(importedLSX);
      
      console.log('📊 Firebase LSX Check Results:');
      console.log('  - Existing in Firebase:', lsxCheck.existing);
      console.log('  - New (not in Firebase):', lsxCheck.new);
      console.log('  - Total imported LSX:', importedLSX.length);
      console.log('  - Already exist:', lsxCheck.existing.length);
      console.log('  - New:', lsxCheck.new.length);

      // Check for duplicates within the import batch itself
      const batchDuplicates: string[] = [];
      const seenInBatch = new Set<string>();
      
      const duplicates: string[] = [];
      const invalidLsxFactory: string[] = []; // ASM2 dùng KZLSX (sai format)
      const validWorkOrders: WorkOrder[] = [];

      for (const workOrder of newWorkOrderData) {
        const lsx = workOrder.productionOrder?.trim();
        if (!lsx) {
          console.warn(`⚠️ Skipping work order with empty LSX:`, workOrder);
          continue;
        }
        
        // ASM2 chỉ dùng LHLSX, không dùng KZLSX
        const factory = (workOrder.factory || this.selectedFactory || '').toUpperCase();
        if (factory === 'ASM2' && lsx.toUpperCase().startsWith('KZLSX')) {
          invalidLsxFactory.push(`${lsx} (ASM2 phải dùng LHLSX, không dùng KZLSX)`);
          continue;
        }
        
        // Check duplicate within batch (normalized)
        const normalizedLsx = lsx.toUpperCase();
        if (seenInBatch.has(normalizedLsx)) {
          batchDuplicates.push(lsx);
          console.warn(`⚠️ Duplicate LSX within import batch: "${lsx}"`);
          continue;
        }
        seenInBatch.add(normalizedLsx);
        
        // Check against Firebase (normalized comparison)
        // lsxCheck.existing now contains normalized values (uppercase, trimmed)
        const isExisting = lsxCheck.existing.includes(normalizedLsx);
        
        if (isExisting) {
          duplicates.push(lsx);
          
          // Find the matching work order to show details
          const allWorkOrders = await this.loadAllWorkOrdersFromFirebase();
          const matchingWO = allWorkOrders.find(wo => 
            wo.productionOrder?.trim().toUpperCase() === normalizedLsx
          );
          
          if (matchingWO) {
            const locationInfo = `Factory: ${matchingWO.factory || 'N/A'}, Status: ${matchingWO.status || 'N/A'}, Year: ${matchingWO.year || 'N/A'}, Month: ${matchingWO.month || 'N/A'}`;
            console.warn(`⚠️ LSX already exists in Firebase: "${lsx}"`);
            console.warn(`   📍 Location: ${locationInfo}`);
            
            // Check if factory is valid
            const isValidFactory = this.isValidFactory(matchingWO.factory || '');
            
            if (!isValidFactory) {
              // Factory is invalid (e.g., ASM3), allow import
              console.warn(`   ⚠️ LSX tồn tại ở factory không hợp lệ: "${matchingWO.factory}"`);
              console.warn(`   ✅ Cho phép import lại vì factory không hợp lệ (chỉ có ASM1, ASM2, Sample 1, Sample 2)`);
              validWorkOrders.push(workOrder);
              console.log(`✅ LSX sẽ được import lại vì factory cũ không hợp lệ: "${lsx}"`);
            } else {
              // Factory is valid, check if it matches current filter
              console.warn(`   🔍 This LSX may not appear in your current view because:`);
              console.warn(`      - Current factory filter: "${this.selectedFactory}"`);
              console.warn(`      - Current status filter: "${this.statusFilter}"`);
              console.warn(`      - LSX exists in factory: "${matchingWO.factory || 'N/A'}"`);
              console.warn(`      - LSX status: "${matchingWO.status || 'N/A'}"`);
              
              // Show user-friendly alert
              alert(`⚠️ LSX "${lsx}" đã tồn tại trong Firebase!\n\n` +
                    `📍 Thông tin LSX đã tồn tại:\n` +
                    `   - Nhà máy: ${matchingWO.factory || 'N/A'}\n` +
                    `   - Trạng thái: ${matchingWO.status || 'N/A'}\n` +
                    `   - Năm: ${matchingWO.year || 'N/A'}\n` +
                    `   - Tháng: ${matchingWO.month || 'N/A'}\n\n` +
                    `💡 Lý do không thấy khi search:\n` +
                    `   - Bạn đang filter theo nhà máy: "${this.selectedFactory}"\n` +
                    `   - LSX này ở nhà máy: "${matchingWO.factory || 'N/A'}"\n\n` +
                    `🔧 Giải pháp: Chuyển sang nhà máy "${matchingWO.factory || 'N/A'}" để xem LSX này.`);
            }
          } else {
            console.warn(`⚠️ LSX already exists in Firebase: "${lsx}" (normalized: "${normalizedLsx}")`);
          }
        } else {
          validWorkOrders.push(workOrder);
          console.log(`✅ LSX is new and will be imported: "${lsx}" (normalized: "${normalizedLsx}")`);
        }
      }

      // Show warnings
      if (batchDuplicates.length > 0) {
        const batchMessage = `⚠️ Tìm thấy ${batchDuplicates.length} LSX trùng lặp trong file:\n${batchDuplicates.join(', ')}`;
        console.warn(batchMessage);
      }

      if (duplicates.length > 0) {
        const duplicateMessage = `⚠️ Tìm thấy ${duplicates.length} LSX đã tồn tại trong Firebase:\n${duplicates.join(', ')}\n\nChỉ import ${validWorkOrders.length} work orders mới.`;
        alert(duplicateMessage);
      }

      if (invalidLsxFactory.length > 0) {
        alert(`⚠️ Bỏ qua ${invalidLsxFactory.length} dòng vì ASM2 phải dùng LSX dạng LHLSX:\n${invalidLsxFactory.join('\n')}`);
      }

      // Validate data before saving
      if (validWorkOrders.length === 0) {
        throw new Error('No valid data found in Excel file (all LSX are duplicates or already exist in Firebase)');
      }

      // Save each work order individually to ensure proper saving
      await this.saveWorkOrdersIndividually(validWorkOrders);
      
    } catch (error) {
      console.error('❌ Error processing Excel data:', error);
      alert(`❌ Lỗi khi xử lý dữ liệu Excel:\n${error.message || error}`);
      this.isLoading = false;
    } finally {
      // Always reset isLoading to false, regardless of success or error
      this.isLoading = false;
    }
  }

  private async saveWorkOrdersIndividually(workOrders: WorkOrder[]): Promise<void> {
    console.log('🔥 Saving work orders individually to Firebase...');
    this.isSaving = true;
    
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < workOrders.length; i++) {
      const workOrder = workOrders[i];
      try {
        await this.addWorkOrderDirect(workOrder);
        successCount++;
        console.log(`✅ Saved work order ${i + 1}/${workOrders.length}:`, workOrder.productCode);
      } catch (error) {
        errorCount++;
        console.error(`❌ Failed to save work order ${i + 1}/${workOrders.length}:`, error);
      }
    }
    
    this.isSaving = false;
    this.isLoading = false; // Reset isLoading after saving is complete
    
    if (successCount > 0) {
      this.firebaseSaved = true;
      console.log(`✅ Successfully saved ${successCount} work orders to Firebase`);
      alert(`✅ Đã lưu thành công ${successCount} work orders vào Firebase!${errorCount > 0 ? `\n❌ ${errorCount} work orders không thể lưu.` : ''}`);
      
      // Reload data to show the new work orders
      this.loadWorkOrders();
    } else {
      this.firebaseSaved = false;
      console.error('❌ Failed to save any work orders');
      alert('❌ Không thể lưu work orders nào vào Firebase!');
    }
  }

  saveToFirebase(data: WorkOrder[]): void {
    console.log('🔥 Saving work orders to Firebase...');
    this.isSaving = true;
    
    const workOrderDoc = {
      data: data,
      importedAt: new Date(),
      month: this.getCurrentMonth(),
      recordCount: data.length,
      lastUpdated: new Date(),
      importHistory: [
        {
          importedAt: new Date(),
          recordCount: data.length,
          month: this.getCurrentMonth(),
          description: `Import ${data.length} work orders`
        }
      ]
    };

    console.log('📤 Attempting to save work order data:', {
      recordCount: workOrderDoc.recordCount,
      month: workOrderDoc.month,
      timestamp: workOrderDoc.importedAt
    });

    // Add timeout to Firebase save
    const savePromise = this.firestore.collection('work-orders').add(workOrderDoc);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Firebase save timeout after 15 seconds')), 15000)
    );

    Promise.race([savePromise, timeoutPromise])
      .then((docRef: any) => {
        console.log('✅ Data successfully saved to Firebase with ID: ', docRef.id);
        this.firebaseSaved = true;
        this.isSaving = false;
        console.log('🔄 Updated firebaseSaved to:', this.firebaseSaved);
        alert('✅ Dữ liệu đã được lưu thành công vào Firebase!');
      })
      .catch((error) => {
        console.error('❌ Error saving to Firebase: ', error);
        this.isSaving = false;
        this.firebaseSaved = false;
        console.log('🔄 Updated firebaseSaved to:', this.firebaseSaved);
        alert(`❌ Lỗi khi lưu dữ liệu vào Firebase:\n${error.message || error}`);
      });
  }

  getCurrentMonth(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  // Check if user has delete permission
  async loadDeletePermission(): Promise<void> {
    try {
      const user = await this.afAuth.currentUser;
      if (!user) {
        console.log('❌ No authenticated user found');
        this.hasDeletePermissionValue = false;
        this.hasCompletePermissionValue = false;
        return;
      }

      // Get user permission from Firebase
      const userPermission = await firstValueFrom(this.userPermissionService.getUserPermission(user.uid));
      if (!userPermission) {
        console.log('❌ No user permission found for user:', user.uid);
        this.hasDeletePermissionValue = false;
        this.hasCompletePermissionValue = false;
        return;
      }

      // Check if user has delete and complete permissions
      this.hasDeletePermissionValue = userPermission.hasDeletePermission;
      this.hasCompletePermissionValue = userPermission.hasCompletePermission;
      console.log('🔐 User permissions - delete:', this.hasDeletePermissionValue, 'complete:', this.hasCompletePermissionValue);
    } catch (error) {
      console.error('❌ Error loading permissions:', error);
      this.hasDeletePermissionValue = false;
      this.hasCompletePermissionValue = false;
    }
  }

  async hasDeletePermission(): Promise<boolean> {
    try {
      const user = await this.afAuth.currentUser;
      if (!user) {
        console.log('❌ No authenticated user found');
        return false;
      }

      // Get user permission from Firebase
      const userPermission = await firstValueFrom(this.userPermissionService.getUserPermission(user.uid));
      if (!userPermission) {
        console.log('❌ No user permission found for user:', user.uid);
        return false;
      }

      // Check if user has delete permission
      const hasPermission = userPermission.hasDeletePermission;
      console.log('🔐 User delete permission:', hasPermission);
      return hasPermission;
    } catch (error) {
      console.error('❌ Error checking delete permission:', error);
      return false;
    }
  }

  async hasCompletePermission(): Promise<boolean> {
    try {
      const user = await this.afAuth.currentUser;
      if (!user) {
        console.log('❌ No authenticated user found');
        return false;
      }

      // Get user permission from Firebase
      const userPermission = await firstValueFrom(this.userPermissionService.getUserPermission(user.uid));
      if (!userPermission) {
        console.log('❌ No user permission found for user:', user.uid);
        return false;
      }

      // Check if user has complete permission
      const hasPermission = userPermission.hasCompletePermission;
      console.log('🔐 User complete permission:', hasPermission);
      return hasPermission;
    } catch (error) {
      console.error('❌ Error checking complete permission:', error);
      return false;
    }
  }

  // Load user department information
  async loadUserDepartment(): Promise<void> {
    try {
      const user = await this.afAuth.currentUser;
      if (user) {
        // Get user department from user-permissions collection
        const userPermissionDoc = await this.firestore.collection('user-permissions').doc(user.uid).get().toPromise();
        if (userPermissionDoc && userPermissionDoc.exists) {
          const userData = userPermissionDoc.data() as any;
          this.currentUserDepartment = userData.department || '';
          console.log('👤 Current user department:', this.currentUserDepartment);
        }
      }
    } catch (error) {
      console.error('❌ Error loading user department:', error);
    }
  }

  // Check if current user is QA department
  isQADepartment(): boolean {
    return this.currentUserDepartment === 'QA';
  }

  // Check if user can edit (QA cannot edit anything in Work Order)
  canEdit(): boolean {
    return !this.isQADepartment();
  }

  // Load factory access based on user permissions
  private loadFactoryAccess(): void {
    // Factory access disabled for work order tab - only applies to materials inventory
    // This method is kept for compatibility but does nothing
    console.log('🏭 Factory access disabled for work order tab');
  }



  // Preview items to be deleted
  previewDeleteItems(): void {
    if (!this.deleteStartDate || !this.deleteEndDate) {
      alert('Vui lòng chọn khoảng thời gian!');
      return;
    }

    const startDate = new Date(this.deleteStartDate);
    const endDate = new Date(this.deleteEndDate);
    endDate.setHours(23, 59, 59, 999); // Include the entire end date

    this.deletePreviewItems = this.workOrders.filter(wo => {
      const createdDate = new Date(wo.createdDate);
      const matchesTimeRange = createdDate >= startDate && createdDate <= endDate;
      const matchesFactory = !this.deleteFactoryFilter || wo.factory === this.deleteFactoryFilter;
      
      return matchesTimeRange && matchesFactory;
    });

    console.log(`🔍 Preview: Found ${this.deletePreviewItems.length} work orders to delete`);
  }

  // Delete work orders by time range
  async deleteWorkOrdersByTimeRange(): Promise<void> {
    const hasPermission = await this.hasDeletePermission();
    if (!hasPermission) {
      alert('❌ Bạn không có quyền xóa dữ liệu! Vui lòng liên hệ quản trị viên để được cấp quyền.');
      return;
    }

    if (this.deletePreviewItems.length === 0) {
      alert('❌ Không có work orders nào để xóa!');
      return;
    }

    const confirmMessage = `⚠️ Bạn có chắc chắn muốn xóa ${this.deletePreviewItems.length} work orders?\n\nThao tác này không thể hoàn tác!`;
    if (!confirm(confirmMessage)) {
      return;
    }

    this.isDeleting = true;
    let successCount = 0;
    let errorCount = 0;

    try {
      for (const workOrder of this.deletePreviewItems) {
        try {
          if (workOrder.id) {
            await this.deleteWorkOrderWithFallback(workOrder.id, workOrder);
            successCount++;
            console.log(`✅ Deleted work order: ${workOrder.orderNumber}`);
          }
        } catch (error) {
          errorCount++;
          console.error(`❌ Failed to delete work order ${workOrder.orderNumber}:`, error);
        }
      }

      // Refresh the work orders list
      await this.loadWorkOrders();

      // Show result
      const message = `✅ Đã xóa thành công ${successCount} work orders!${errorCount > 0 ? `\n❌ ${errorCount} work orders không thể xóa.` : ''}`;
      alert(message);

      // Close dialog and reset
      this.showDeleteDialog = false;
      this.deletePreviewItems = [];

    } catch (error) {
      console.error('❌ Error during bulk delete:', error);
      alert(`❌ Lỗi khi xóa work orders: ${error.message || error}`);
    } finally {
      this.isDeleting = false;
    }
  }

  parseStatus(statusStr: any): WorkOrderStatus {
    if (!statusStr) return WorkOrderStatus.WAITING;
    
    const status = statusStr.toString().toLowerCase();
    switch (status) {
      case 'waiting':
      case 'chờ':
        return WorkOrderStatus.WAITING;
      case 'kitting':
      case 'chuẩn bị':
        return WorkOrderStatus.KITTING;
      case 'ready':
      case 'sẵn sàng':
        return WorkOrderStatus.READY;
      case 'transfer':
      case 'chuyển':
        return WorkOrderStatus.TRANSFER;
      case 'done':
      case 'hoàn thành':
        return WorkOrderStatus.DONE;
      case 'delay':
      case 'chậm':
        return WorkOrderStatus.DELAY;
      default:
        return WorkOrderStatus.WAITING;
    }
  }

  convertStringToStatus(statusStr: string): WorkOrderStatus {
    const status = statusStr.toLowerCase();
    switch (status) {
      case 'kitting':
        return WorkOrderStatus.KITTING;
      case 'ready':
        return WorkOrderStatus.READY;
      case 'transfer':
        return WorkOrderStatus.TRANSFER;
      case 'done':
        return WorkOrderStatus.DONE;
      case 'waiting':
        return WorkOrderStatus.WAITING;
      case 'delay':
        return WorkOrderStatus.DELAY;
      default:
        return WorkOrderStatus.WAITING;
    }
  }

  private handleEmptyFilterResults(): void {
    console.log('🔧 Analyzing filter mismatch...');
    
    // Find unique years and months in the data
    const availableYears = [...new Set(this.workOrders.map(wo => wo.year))].sort();
    const availableMonths = [...new Set(this.workOrders.map(wo => wo.month))].sort();
    
    console.log('📊 Available data:', {
      years: availableYears,
      months: availableMonths,
      currentFilters: { year: this.yearFilter, month: this.monthFilter }
    });
    
    // Check if current year exists in data
    const hasCurrentYear = availableYears.includes(this.yearFilter);
    const hasCurrentMonth = this.workOrders.some(wo => wo.year === this.yearFilter && wo.month === this.monthFilter);
    
    if (!hasCurrentYear && availableYears.length > 0) {
      console.log(`⚡ Auto-adjusting year filter from ${this.yearFilter} to ${availableYears[availableYears.length - 1]}`);
      this.yearFilter = availableYears[availableYears.length - 1]; // Use most recent year
    }
    
    if (!hasCurrentMonth && availableYears.includes(this.yearFilter)) {
      const monthsInYear = [...new Set(this.workOrders.filter(wo => wo.year === this.yearFilter).map(wo => wo.month))].sort();
      if (monthsInYear.length > 0) {
        console.log(`⚡ Auto-adjusting month filter from ${this.monthFilter} to ${monthsInYear[monthsInYear.length - 1]}`);
        this.monthFilter = monthsInYear[monthsInYear.length - 1]; // Use most recent month in year
      }
    }
    
    // Re-apply filters after adjustment
    this.applyFilters();
    this.calculateSummary();
    
    if (this.filteredWorkOrders.length > 0) {
      console.log('✅ Filters auto-adjusted successfully');
      alert(`📅 Filters đã được tự động điều chỉnh để hiển thị dữ liệu:\n• Năm: ${this.yearFilter}\n• Tháng: ${this.monthFilter}\n\nHiển thị ${this.filteredWorkOrders.length} work orders.`);
    } else {
      console.log('❌ Still no data after filter adjustment');
    }
  }

  editWorkOrder(workOrder: WorkOrder): void {
    console.log('✏️ Editing work order:', workOrder);
    // For now, just log the action. You can implement edit functionality later
    alert(`Chỉnh sửa Work Order: ${workOrder.orderNumber || workOrder.productCode}`);
  }

  // New methods for the updated UI
  async completeWorkOrder(workOrder: WorkOrder): Promise<void> {
    const blocked = await this.isDoneBlockedForWorkOrder(workOrder);
    if (blocked) {
      const bypass = await this.checkBypassPasswordForThieu();
      if (!bypass) return;
    }
    console.log('🔄 Bắt đầu hoàn thành work order:', workOrder.productCode, 'ID:', workOrder.id);
    
    // Kiểm tra quyền hoàn thành
    const hasPermission = await this.hasCompletePermission();
    if (!hasPermission) {
      alert('❌ Bạn không có quyền hoàn thành Work Order! Vui lòng liên hệ quản trị viên để được cấp quyền.');
      return;
    }
    
    // Mark as completed and hide from list
    workOrder.status = WorkOrderStatus.DONE;
    workOrder.isCompleted = true; // Add completed flag
    workOrder.isUrgent = false;
    
    // Update all fields at once
    const updatedWorkOrder = { ...workOrder, isCompleted: true, isUrgent: false };
    await this.materialService.updateWorkOrder(workOrder.id!, updatedWorkOrder);
    
    // Update local array
    const index = this.workOrders.findIndex(wo => wo.id === workOrder.id);
    if (index !== -1) {
      this.workOrders[index] = updatedWorkOrder;
    }
    
    // Re-apply filters to hide completed work order
    this.applyFilters();
    this.calculateSummary();
    console.log('✅ Hoàn thành work order:', workOrder.productCode, '- Đã ẩn khỏi danh sách');
  }

  showAllWorkOrders(): void {
    this.showHiddenWorkOrders = !this.showHiddenWorkOrders;
    
    if (this.showHiddenWorkOrders) {
      // Show all work orders including manually completed ones
      this.doneFilter = 'completed';
      this.filteredWorkOrders = this.workOrders.filter(wo => wo.factory === this.selectedFactory);
      console.log(`👁️ Hiển thị tất cả work orders của nhà máy ${this.selectedFactory} (bao gồm đã hoàn thành)`);
    } else {
      // Show only non-completed work orders
      this.doneFilter = 'notCompleted';
      this.filteredWorkOrders = this.workOrders.filter(wo => wo.factory === this.selectedFactory && !wo.isCompleted);
      console.log(`👁️ Chỉ hiển thị work orders chưa hoàn thành của nhà máy ${this.selectedFactory}`);
    }
    
    this.applyFilters();
    this.calculateSummary();
  }



  getStatusText(status: WorkOrderStatus): string {
    const statusMap: { [key: string]: string } = {
      'waiting': 'Waiting',
      'kitting': 'Kitting',
      'ready': 'Ready',
      'transfer': 'Transfer',
      'done': 'Done',
      'delay': 'Delay'
    };
    return statusMap[status] || 'Waiting';
  }

  getStatusBadgeClass(status: WorkOrderStatus): string {
    const statusClassMap: { [key: string]: string } = {
      'waiting': 'badge badge-warning',
      'kitting': 'badge badge-info',
      'ready': 'badge badge-primary',
      'transfer': 'badge badge-secondary',
      'done': 'badge badge-success',
      'delay': 'badge badge-danger'
    };
    return statusClassMap[status] || 'badge badge-warning';
  }

  toggleUrgent(workOrder: WorkOrder): void {
    workOrder.isUrgent = !workOrder.isUrgent;
    this.updateWorkOrder(workOrder, 'isUrgent', workOrder.isUrgent);
    
    if (workOrder.isUrgent) {
      console.log('🔥 Đánh dấu gấp cho work order:', workOrder.productCode);
    } else {
      console.log('✅ Bỏ đánh dấu gấp cho work order:', workOrder.productCode);
    }
    
    // Re-apply filters to re-sort the list with urgent items at the top
    this.applyFilters();
    this.calculateSummary();
  }

  exportWorkOrdersByTimeRange(): void {
    const startDateStr = this.startDate ? this.startDate.toISOString().split('T')[0] : '';
    const endDateStr = this.endDate ? this.endDate.toISOString().split('T')[0] : '';
    
    if (!startDateStr || !endDateStr) {
      alert('❌ Vui lòng chọn khoảng thời gian!');
      return;
    }
    
    // Filter work orders by date range and selected factory
    const filteredByDateAndFactory = this.workOrders.filter(wo => {
      const deliveryDate = wo.deliveryDate ? new Date(wo.deliveryDate) : null;
      const planDate = wo.planReceivedDate ? new Date(wo.planReceivedDate) : null;
      
      if (!deliveryDate && !planDate) return false;
      
      const start = new Date(startDateStr);
      const end = new Date(endDateStr);
      
      const isInDateRange = (deliveryDate && deliveryDate >= start && deliveryDate <= end) ||
                           (planDate && planDate >= start && planDate <= end);
      
      const isFromSelectedFactory = wo.factory === this.selectedFactory;
      
      return isInDateRange && isFromSelectedFactory;
    });
    
    if (filteredByDateAndFactory.length === 0) {
      alert(`❌ Không có work orders nào của nhà máy ${this.selectedFactory} trong khoảng thời gian đã chọn!`);
      return;
    }
    
    // Export to CSV with English headers
    this.exportToCSVWithDataEnglish(filteredByDateAndFactory, `work-orders-${this.selectedFactory}-${startDateStr}-to-${endDateStr}`);
    
    console.log(`📊 Xuất ${filteredByDateAndFactory.length} work orders của nhà máy ${this.selectedFactory} từ ${startDateStr} đến ${endDateStr}`);
  }

  private exportToCSVWithData(data: WorkOrder[], filename: string): void {
    const headers = [
      'Năm', 'Tháng', 'STT', 'Mã TP VN LSX', 'Lượng', 'Khách hàng', 'Gấp',
      'Ngày Giao Line', 'NVL thiếu', 'Người soạn', 'Tình trạng', 'Đủ/Thiếu',
      'Ngày nhận thông tin', 'Ghi Chú'
    ];
    
    const csvData = data.map((wo, index) => [
      wo.year,
      wo.month,
      index + 1,
      `${wo.productCode || ''} ${wo.productionOrder || ''}`.trim(),
      wo.quantity,
      wo.customer,
      wo.isUrgent ? 'Có' : 'Không',
      wo.deliveryDate ? new Date(wo.deliveryDate).toLocaleDateString('vi-VN') : '',
      wo.missingMaterials || '',
      wo.createdBy || '',
      this.getStatusText(wo.status || WorkOrderStatus.WAITING),
      wo.materialsStatus === 'sufficient' ? 'Đủ' : wo.materialsStatus === 'insufficient' ? 'Thiếu' : '',
      wo.planReceivedDate ? new Date(wo.planReceivedDate).toLocaleDateString('vi-VN') : '',
      wo.notes || ''
    ]);
    
    const csvContent = [headers, ...csvData]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    
    console.log(`✅ Đã xuất ${data.length} work orders thành file CSV`);
  }

  private exportToCSVWithDataEnglish(data: WorkOrder[], filename: string): void {
    const headers = [
      'Year', 'Month', 'Order No', 'Product Code VN LSX', 'Quantity', 'Customer', 'Urgent',
      'Material Delivery Date', 'Missing Materials', 'Creator', 'Status', 'Sufficient/Insufficient',
      'Plan Received Date', 'Notes'
    ];
    
    const csvData = data.map((wo, index) => [
      wo.year,
      wo.month,
      index + 1,
      `${wo.productCode || ''} ${wo.productionOrder || ''}`.trim(),
      wo.quantity,
      wo.customer,
      wo.isUrgent ? 'Yes' : 'No',
      wo.deliveryDate ? new Date(wo.deliveryDate).toLocaleDateString('en-US') : '',
      wo.missingMaterials || '',
      wo.createdBy || '',
      this.getStatusTextEnglish(wo.status || WorkOrderStatus.WAITING),
      wo.materialsStatus === 'sufficient' ? 'Sufficient' : wo.materialsStatus === 'insufficient' ? 'Insufficient' : '',
      wo.planReceivedDate ? new Date(wo.planReceivedDate).toLocaleDateString('en-US') : '',
      wo.notes || ''
    ]);
    
    const csvContent = [headers, ...csvData]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    
    console.log(`✅ Đã xuất ${data.length} work orders thành file CSV (English)`);
  }

  private getStatusTextEnglish(status: WorkOrderStatus): string {
    const statusMap: { [key: string]: string } = {
      'waiting': 'Waiting',
      'kitting': 'Kitting',
      'ready': 'Ready',
      'transfer': 'Transfer',
      'done': 'Done',
      'delay': 'Delay'
    };
    return statusMap[status] || 'Waiting';
  }

  private async checkExistingLSXInFirebase(lsxValues: string[]): Promise<{ existing: string[], new: string[] }> {
    console.log('🔍 Checking existing LSX in Firebase for:', lsxValues);
    
    try {
      // Get all existing work orders from Firebase
      const existingWorkOrders = await this.loadAllWorkOrdersFromFirebase();
      
      // Normalize existing LSX: trim and uppercase for comparison
      // Also create a map for exact matching
      const existingLSXMap = new Map<string, string>(); // normalized -> original
      const existingLSXNormalized: string[] = [];
      
      existingWorkOrders.forEach(wo => {
        if (wo.productionOrder) {
          const trimmed = wo.productionOrder.trim();
          const normalized = trimmed.toUpperCase();
          if (normalized && !existingLSXMap.has(normalized)) {
            existingLSXMap.set(normalized, trimmed);
            existingLSXNormalized.push(normalized);
          }
        }
      });
      
      console.log('📊 Found existing LSX in Firebase (normalized):', existingLSXNormalized.length, 'items');
      console.log('📋 Sample existing LSX (first 10):', existingLSXNormalized.slice(0, 10));
      
      const existing: string[] = []; // Store normalized values for comparison
      const newLSX: string[] = [];
      
      for (const lsx of lsxValues) {
        if (!lsx || !lsx.trim()) {
          console.log(`⚠️ Skipping empty LSX: "${lsx}"`);
          continue; // Skip empty LSX
        }
        
        const trimmedLsx = lsx.trim();
        const normalizedLsx = trimmedLsx.toUpperCase();
        
        console.log(`🔍 Checking LSX: "${trimmedLsx}" (normalized: "${normalizedLsx}")`);
        
        // Check with normalized comparison (case-insensitive, trimmed)
        if (existingLSXNormalized.includes(normalizedLsx)) {
          // Store normalized value for consistent comparison later
          existing.push(normalizedLsx);
          const originalLsx = existingLSXMap.get(normalizedLsx);
          console.warn(`⚠️ LSX already exists in Firebase: "${trimmedLsx}" (normalized: "${normalizedLsx}", matched with: "${originalLsx}")`);
          
          // Debug: Show the exact match
          const matchingWO = existingWorkOrders.find(wo => 
            wo.productionOrder?.trim().toUpperCase() === normalizedLsx
          );
          if (matchingWO) {
            console.log(`   📋 Matched Work Order:`, {
              id: matchingWO.id,
              productionOrder: matchingWO.productionOrder,
              factory: matchingWO.factory,
              year: matchingWO.year,
              month: matchingWO.month,
              normalized: matchingWO.productionOrder?.trim().toUpperCase()
            });
          }
        } else {
          newLSX.push(trimmedLsx);
          console.log(`✅ LSX is new: "${trimmedLsx}" (normalized: "${normalizedLsx}")`);
        }
      }
      
      console.log(`📊 LSX Check Results:
        - Total checked: ${lsxValues.length}
        - Already exist: ${existing.length}
        - New: ${newLSX.length}`);
      
      // Debug: Show all existing LSX if there are matches
      if (existing.length > 0) {
        console.log('📋 All existing LSX that matched:', existing);
      }
      
      return { existing, new: newLSX };
    } catch (error) {
      console.error('❌ Error checking existing LSX in Firebase:', error);
      // If we can't check Firebase, assume all are new to be safe
      return { existing: [], new: lsxValues.filter(lsx => lsx && lsx.trim()) };
    }
  }

  private async loadAllWorkOrdersFromFirebase(): Promise<WorkOrder[]> {
    console.log('🔄 Loading all work orders from Firebase for LSX check...');
    
    try {
      // Try Firebase v9 SDK first
      const app = initializeApp(environment.firebase);
      const db = getFirestore(app);
      const querySnapshot = await getDocs(collection(db, 'work-orders'));
      
      const workOrders: WorkOrder[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data() as WorkOrder;
        workOrders.push({ id: doc.id, ...data });
      });
      
      console.log(`✅ Loaded ${workOrders.length} work orders from Firebase for LSX check`);
      return workOrders;
    } catch (error) {
      console.error('❌ Error loading work orders from Firebase for LSX check:', error);
      throw error;
    }
  }

  openPrintOptionDialog(workOrder: WorkOrder): void {
    const dialogRef = this.dialog.open(PrintOptionDialogComponent, {
      width: '400px',
      data: { workOrder }
    });
    dialogRef.afterClosed().subscribe((result: 'qr' | 'pxk') => {
      if (result === 'qr') this.generateQRCode(workOrder);
      else if (result === 'pxk') this.printPxk(workOrder);
    });
  }

  // Generate QR Code for Work Order
  generateQRCode(workOrder: WorkOrder): void {
    console.log('Generating QR code for work order:', workOrder.productionOrder);
    
    // Create QR code data with LSX only (simplified for scanning)
    const qrData = workOrder.productionOrder;
    
    console.log('QR Code data:', qrData);
    
    // Generate QR code image
    QRCode.toDataURL(qrData, {
      width: 240, // 30mm = 240px (8px/mm)
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    }).then(qrImage => {
      // Show QR code dialog
      this.showQRCodeDialog(qrImage, workOrder, qrData);
    }).catch(error => {
      console.error('Error generating QR code:', error);
      alert('Lỗi khi tạo QR code!');
    });
  }

  // Show QR code dialog
  async showQRCodeDialog(qrImage: string, workOrder: WorkOrder, qrData: string): Promise<void> {
    try {
      // Get current user info
      const user = await this.afAuth.currentUser;
      const currentUser = user ? user.email || user.uid : 'UNKNOWN';
      const printDate = new Date().toLocaleDateString('vi-VN');
      
      // Create print window with professional label layout
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        newWindow.document.write(`
          <html>
            <head>
              <title>QR Code LSX - ${workOrder.productionOrder}</title>
              <style>
                * {
                  margin: 0 !important;
                  padding: 0 !important;
                  box-sizing: border-box !important;
                }
                
                body { 
                  font-family: Arial, sans-serif; 
                  margin: 0 !important; 
                  padding: 0 !important;
                  background: white !important;
                  overflow: hidden !important;
                  width: 57mm !important;
                  height: 32mm !important;
                }
                
                .qr-container { 
                  display: flex !important; 
                  margin: 0 !important; 
                  padding: 0 !important; 
                  border: 1px solid #000 !important; 
                  width: 57mm !important; 
                  height: 32mm !important; 
                  page-break-inside: avoid !important;
                  background: white !important;
                  box-sizing: border-box !important;
                }
                
                .qr-section {
                  width: 30mm !important;
                  height: 30mm !important;
                  display: flex !important;
                  align-items: center !important;
                  justify-content: center !important;
                  border-right: 1px solid #ccc !important;
                  box-sizing: border-box !important;
                }
                
                .qr-image {
                  width: 28mm !important;
                  height: 28mm !important;
                  display: block !important;
                }
                
                .info-section {
                  flex: 1 !important;
                  padding: 0.5mm !important;
                  display: flex !important;
                  flex-direction: column !important;
                  justify-content: space-between !important;
                  font-size: 6px !important;
                  line-height: 1.0 !important;
                  box-sizing: border-box !important;
                }
                
                .info-row {
                  margin: 0.2mm 0 !important;
                  font-weight: bold !important;
                  white-space: nowrap !important;
                  overflow: hidden !important;
                  text-overflow: ellipsis !important;
                }
                
                .info-row.small {
                  font-size: 5px !important;
                  color: #666 !important;
                  margin: 0.1mm 0 !important;
                }
                
                .qr-grid {
                  text-align: center !important;
                  display: flex !important;
                  flex-direction: row !important;
                  flex-wrap: wrap !important;
                  align-items: flex-start !important;
                  justify-content: flex-start !important;
                  gap: 0 !important;
                  padding: 0 !important;
                  margin: 0 !important;
                  width: 57mm !important;
                  height: 32mm !important;
                }
                
                @media print {
                  body { 
                    margin: 0 !important; 
                    padding: 0 !important;
                    overflow: hidden !important;
                    width: 57mm !important;
                    height: 32mm !important;
                  }
                  
                  @page {
                    margin: 0 !important;
                    size: 57mm 32mm !important;
                    padding: 0 !important;
                  }
                  
                  .qr-container { 
                    margin: 0 !important; 
                    padding: 0 !important;
                    width: 57mm !important;
                    height: 32mm !important;
                    page-break-inside: avoid !important;
                    border: 1px solid #000 !important;
                  }
                  
                  .qr-section {
                    width: 30mm !important;
                    height: 30mm !important;
                  }
                  
                  .qr-image {
                    width: 28mm !important;
                    height: 28mm !important;
                  }
                  
                  .info-section {
                    font-size: 6px !important;
                    padding: 0.5mm !important;
                  }
                  
                  .info-row {
                    margin: 0.2mm 0 !important;
                  }
                  
                  .info-row.small {
                    font-size: 5px !important;
                    margin: 0.1mm 0 !important;
                  }
                  
                  .qr-grid {
                    gap: 0 !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    width: 57mm !important;
                    height: 32mm !important;
                  }
                  
                  /* Hide all browser elements */
                  @media screen {
                    body::before,
                    body::after,
                    header,
                    footer,
                    nav,
                    .browser-ui {
                      display: none !important;
                    }
                  }
                }
              </style>
            </head>
            <body>
              <div class="qr-grid">
                <div class="qr-container">
                  <div class="qr-section">
                    <img src="${qrImage}" class="qr-image" alt="QR Code LSX">
                  </div>
                  <div class="info-section">
                    <div>
                      <div class="info-row">LSX: ${workOrder.productionOrder}</div>
                      <div class="info-row">Mã TP: ${workOrder.productCode}</div>
                      <div class="info-row">Lượng: ${workOrder.quantity}</div>
                      <div class="info-row">KH: ${workOrder.customer}</div>
                    </div>
                    <div>
                      <div class="info-row small">Ngày in: ${printDate}</div>
                      <div class="info-row small">NV: ${currentUser}</div>
                    </div>
                  </div>
                </div>
              </div>
              <script>
                window.onload = function() {
                  // Remove all browser UI elements
                  document.title = '';
                  
                  // Hide browser elements
                  const style = document.createElement('style');
                  style.textContent = '@media print { body { margin: 0 !important; padding: 0 !important; width: 57mm !important; height: 32mm !important; } @page { margin: 0 !important; size: 57mm 32mm !important; padding: 0 !important; } body::before, body::after, header, footer, nav, .browser-ui { display: none !important; } }';
                  document.head.appendChild(style);
                  
                  // Remove any browser elements
                  const elementsToRemove = document.querySelectorAll('header, footer, nav, .browser-ui');
                  elementsToRemove.forEach(el => el.remove());
                  
                  setTimeout(() => {
                    window.print();
                  }, 500);
                }
              </script>
            </body>
          </html>
        `);
        newWindow.document.close();
      }
    } catch (error) {
      console.error('Error showing QR code dialog:', error);
      alert('Lỗi khi hiển thị QR code!');
    }
  }

  // PXK Import
  triggerPxkImport(): void {
    const input = document.getElementById('pxkFileInput') as HTMLInputElement;
    if (input) {
      input.value = '';
      input.click();
    }
  }

  async onPxkFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) return;
    this.isImportingPxk = true;
    try {
      const data = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve((e.target as FileReader).result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      });
      const workbook = XLSX.read(data, { type: 'array' });
      let sheet = workbook.Sheets['Sheet1'] || workbook.Sheets['sheet1'];
      if (!sheet) {
        const sheet1 = workbook.SheetNames.find((n: string) => n.trim().toLowerCase() === 'sheet1');
        if (sheet1) sheet = workbook.Sheets[sheet1];
      }
      if (!sheet) {
        const found = workbook.SheetNames.find((n: string) => {
          const lower = n.trim().toLowerCase();
          return lower.includes('bảng kê') || lower.includes('bang ke') || lower.includes('phiếu xuất') || lower.includes('phieu xuat');
        });
        if (found) sheet = workbook.Sheets[found];
      }
      if (!sheet) sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true }) as any[][];
      if (rows.length < 2) {
        alert('File PXK không có dữ liệu.');
        return;
      }
      const norm = (s: string) => s.toLowerCase().replace(/\s/g, '').replace(/[àáảãạăắằẳẵặâấầẩẫậ]/g, 'a').replace(/[đ]/g, 'd').replace(/[èéẻẽẹêếềểễệ]/g, 'e').replace(/[ìíỉĩị]/g, 'i').replace(/[òóỏõọôốồổỗộơớờởỡợ]/g, 'o').replace(/[ùúủũụưứừửữự]/g, 'u');
      const colIdx = (headers: string[], ...names: string[]): number => {
        for (const name of names) {
          const i = headers.findIndex((h: string) => norm(h).includes(norm(name)) || norm(name).includes(norm(h)));
          if (i >= 0) return i;
        }
        return -1;
      };
      const hasRequiredHeaders = (h: string[]): boolean => {
        const hasMaCtu = colIdx(h, 'Mã Ctừ', 'Ma Ctu', 'MaCtu', 'Mã chứng từ', 'Ma chung tu', 'Chứng từ', 'Loại ctừ') >= 0;
        const hasLsx = colIdx(h, 'Số lệnh sản xuất', 'So lenh san xuat', 'SoLenhSanXuat', 'Lệnh sản xuất', 'Lenh san xuat', 'LSX', 'Số LSX') >= 0;
        const hasMaVatTu = colIdx(h, 'Mã vật tư', 'Ma vat tu', 'MaVatTu', 'Mã VT', 'Ma VT', 'Vật tư') >= 0;
        return hasMaCtu && hasLsx && hasMaVatTu;
      };
      let headerRowIndex = -1;
      for (let r = 0; r < Math.min(20, rows.length); r++) {
        const rowHeaders = (rows[r] || []).map((h: any) => String(h || '').trim());
        const cellC = norm((rowHeaders[2] || '').trim());
        if (r <= 1 && (cellC.includes('so lenh san xuat') || cellC.includes('lsx'))) {
          headerRowIndex = r;
          break;
        }
        if (hasRequiredHeaders(rowHeaders)) {
          headerRowIndex = r;
          break;
        }
      }
      console.log('[PXK Import] Raw rows sample (first 8 rows, first 12 cols):', rows.slice(0, 8).map((r: any[]) => (r || []).slice(0, 12).map((c: any) => String(c ?? '').substring(0, 20))));
      // Format: A=Mã Ctừ, B=Số CT, C=LSX, D=Mã SP, E=Mã vật tư, F=Số PO, G=Mã Kho, H=Số lượng, I=Đvt, J=Loại Hình
      const COL_A = 0, COL_B = 1, COL_C = 2, COL_D = 3, COL_E = 4, COL_F = 5, COL_G = 6, COL_H = 7, COL_I = 8, COL_J = 9;
      let idxMaCtu: number; let idxSoLenhSX: number; let idxMaVatTu: number;
      let idxSoLuongXTT: number; let idxDvt: number; let idxSoPO: number; let idxSoChungTu: number; let idxMaKho: number; let idxLoaiHinh: number;
      let idxTenVatTu: number; let idxDinhMuc: number; let idxTenTP: number; let idxTongSLYCau: number; let idxMaKhachHang: number; let idxSoPOKH: number; let idxPhanTramHaoHut: number; let idxGhiChu: number;
      idxMaCtu = COL_A;
      idxSoChungTu = COL_B;
      idxSoLenhSX = COL_C;
      idxMaVatTu = COL_E;
      idxSoPO = COL_F;
      idxMaKho = -1; // Tìm theo header, -1 nếu file cũ không có cột Mã Kho
      idxSoLuongXTT = COL_H;
      idxDvt = COL_I;
      idxLoaiHinh = -1; // Tìm theo header, -1 nếu file cũ không có cột Loại Hình
      if (headerRowIndex >= 0) {
        const headers = (rows[headerRowIndex] || []).map((h: any) => String(h || '').trim());
        idxMaCtu = colIdx(headers, 'Mã Ctừ', 'Ma Ctu', 'MaCtu') >= 0 ? colIdx(headers, 'Mã Ctừ', 'Ma Ctu', 'MaCtu') : COL_A;
        idxSoChungTu = colIdx(headers, 'Số Chứng Từ', 'Số Ctừ', 'So Ctu', 'Số CT', 'So CT') >= 0 ? colIdx(headers, 'Số Chứng Từ', 'Số Ctừ', 'So Ctu', 'Số CT', 'So CT') : COL_B;
        idxSoLenhSX = colIdx(headers, 'Số lệnh sản xuất', 'So lenh san xuat', 'LSX', 'Số LSX') >= 0 ? colIdx(headers, 'Số lệnh sản xuất', 'So lenh san xuat', 'LSX', 'Số LSX') : COL_C;
        idxMaVatTu = colIdx(headers, 'Mã vật tư', 'Ma vat tu', 'MaVatTu') >= 0 ? colIdx(headers, 'Mã vật tư', 'Ma vat tu', 'MaVatTu') : COL_E;
        idxSoPO = colIdx(headers, 'Số PO', 'So PO', 'PO') >= 0 ? colIdx(headers, 'Số PO', 'So PO', 'PO') : COL_F;
        idxMaKho = colIdx(headers, 'Mã Kho', 'Ma Kho', 'MaKho');
        idxSoLuongXTT = colIdx(headers, 'Xuất Kho', 'Xuat Kho', 'Số lượng xuất thực tế', 'So luong xuat', 'Số lượng xuất') >= 0 ? colIdx(headers, 'Xuất Kho', 'Xuat Kho', 'Số lượng xuất thực tế', 'So luong xuat', 'Số lượng xuất') : COL_H;
        idxDvt = colIdx(headers, 'Đvt', 'DVT', 'Đơn vị tính') >= 0 ? colIdx(headers, 'Đvt', 'DVT', 'Đơn vị tính') : COL_I;
        idxLoaiHinh = colIdx(headers, 'Loại Hình', 'Loai Hinh', 'LoaiHinh');
        idxTenVatTu = colIdx(headers, 'Tên Vật Tư', 'Ten Vat Tu');
        idxDinhMuc = colIdx(headers, 'Định Mức', 'Dinh Muc');
        idxTenTP = colIdx(headers, 'Tên TP', 'Ten TP');
        idxTongSLYCau = colIdx(headers, 'Tổng SL Y/Cầu', 'Tong SL Y/Cau');
        // Luôn dùng cố định: cột E (index 4) = Mã Khách Hàng, cột P (index 15) = Số PO KH
        idxMaKhachHang = 4;
        idxSoPOKH = 15;
        idxPhanTramHaoHut = colIdx(headers, 'Phần Trăm Hao Hụt', 'Phan Tram Hao Hut');
        idxGhiChu = colIdx(headers, 'Ghi chú', 'Ghi Chu', 'GhiChu', 'Note', 'Ghi chú');
      } else {
        headerRowIndex = 0;
        idxMaCtu = COL_A;
        idxSoChungTu = COL_B;
        idxTenVatTu = idxDinhMuc = idxTenTP = idxTongSLYCau = idxSoPOKH = idxPhanTramHaoHut = idxGhiChu = -1;
        idxMaKhachHang = 4; // Cột E
      }
      const allWo = [...this.workOrders, ...(this.filteredWorkOrders || [])];
      const woLsxList = [...new Set(allWo.map(wo => String(wo.productionOrder || '').trim()).filter(Boolean))];
      const normalizeLsx = (s: string): string => {
        const t = String(s || '').trim().toUpperCase().replace(/\s/g, '');
        const m = t.match(/(\d{4}[\/\-\.]\d+)/);
        return m ? m[1].replace(/[-.]/g, '/') : t;
      };
      const woNormToOriginal = new Map<string, string[]>();
      woLsxList.forEach(lsx => {
        const n = normalizeLsx(lsx);
        if (n) {
          const arr = woNormToOriginal.get(n) || [];
          if (!arr.includes(lsx)) arr.push(lsx);
          woNormToOriginal.set(n, arr);
        }
      });
      const samePrefix = (a: string, b: string): boolean => {
        const ua = (a || '').toUpperCase();
        const ub = (b || '').toUpperCase();
        return (ua.startsWith('KZ') && ub.startsWith('KZ')) || (ua.startsWith('LH') && ub.startsWith('LH'));
      };
      const findMatchingWoLsx = (pxkLsx: string): string | null => {
        const trimmed = String(pxkLsx || '').trim();
        if (!trimmed) return null;
        const upper = trimmed.toUpperCase();
        for (const wo of woLsxList) {
          const woUpper = wo.toUpperCase();
          if (woUpper === upper) return wo;
          if (samePrefix(trimmed, wo) && (woUpper.includes(upper) || upper.includes(woUpper))) return wo;
        }
        const n = normalizeLsx(trimmed);
        const candidates = woNormToOriginal.get(n) || [];
        return candidates.find(c => samePrefix(trimmed, c)) || candidates[0] || null;
      };
      const getFullLsxFromCell = (val: any): string => {
        if (val == null || val === '') return '';
        if (typeof val === 'string') return val.trim();
        if (typeof val === 'number' && val >= 0 && val < 1 && !Number.isInteger(val)) return '';
        return String(val).trim();
      };
      /** Chuẩn LSX: ASM1 = KZLSX + 4 số + / + 4 số (VD: KZLSX0326/0089); ASM2 = LHLSX + 4 số + / + 4 số (VD: LHLSX0326/0089) */
      const isValidLsxFormat = (s: string): boolean => /^(KZLSX|LHLSX)\d{4}\/\d{4}$/i.test(String(s || '').trim());
      /** Xác định factory từ prefix LSX: KZ → ASM1, LH → ASM2 */
      const getFactoryFromLsx = (lsxStr: string): 'ASM1' | 'ASM2' =>
        String(lsxStr || '').trim().toUpperCase().startsWith('KZ') ? 'ASM1' : 'ASM2';
      /** Đọc tất cả LSX từ file, không phụ thuộc Work Order - lưu toàn bộ để dùng sau */
      const parseWithCols = (maCtuCol: number, lsxCol: number, vatTuCol: number, qtyCol: number, dvtCol: number, poCol: number, soChungTuCol: number, maKhoCol: number, loaiHinhCol: number,
        tenVatTuCol = -1, dinhMucCol = -1, tenTPCol = -1, tongSLYCauCol = -1, maKhachHangCol = -1, soPOKHCol = -1, phanTramHaoHutCol = -1, ghiChuCol = -1) => {
        const out: PxkDataByLsx = {};
        let cnt = 0;
        for (let r = dataStartRow; r < rows.length; r++) {
          const row = rows[r] || [];
          const v = String(row[maCtuCol] ?? '').trim().toUpperCase();
          if (v !== 'PX' && !v.includes('PX') && !v.includes('PHIEU XUAT') && !v.includes('PHIẾU XUẤT')) continue;
          cnt++;
          const pxkLsxRaw = getFullLsxFromCell(row[lsxCol]);
          if (!pxkLsxRaw) continue;
          if (!isValidLsxFormat(pxkLsxRaw)) continue;
          const matchedLsx = findMatchingWoLsx(pxkLsxRaw) || pxkLsxRaw;
          const storeKey = (pxkLsxRaw.toUpperCase().startsWith('KZLSX') || pxkLsxRaw.toUpperCase().startsWith('LHLSX') || /\d{4}[\/\-\.]\d+/.test(pxkLsxRaw)) ? pxkLsxRaw : matchedLsx;
          const soChungTu = String(row[soChungTuCol] ?? '').trim();
          const materialCode = String(row[vatTuCol] ?? '').trim();
          const qtyRaw = row[qtyCol];
          const quantity = typeof qtyRaw === 'number' ? qtyRaw : parseFloat(String(qtyRaw ?? '0').replace(/,/g, '')) || 0;
          const unit = String(row[dvtCol] ?? '').trim();
          const po = String(row[poCol] ?? '').trim();
          const maKho = maKhoCol >= 0 ? String(row[maKhoCol] ?? '').trim() : '';
          const loaiHinh = loaiHinhCol >= 0 ? String(row[loaiHinhCol] ?? '').trim() : '';
          const tenVatTu = tenVatTuCol >= 0 ? String(row[tenVatTuCol] ?? '').trim() : undefined;
          const dinhMuc = dinhMucCol >= 0 ? String(row[dinhMucCol] ?? '').trim() : undefined;
          const tenTP = tenTPCol >= 0 ? String(row[tenTPCol] ?? '').trim() : undefined;
          const tongSLYCau = tongSLYCauCol >= 0 ? String(row[tongSLYCauCol] ?? '').trim() : undefined;
          const maKhachHang = maKhachHangCol >= 0 ? String(row[maKhachHangCol] ?? '').trim() : undefined;
          const soPOKH = soPOKHCol >= 0 ? String(row[soPOKHCol] ?? '').trim() : undefined;
          const phanTramHaoHut = phanTramHaoHutCol >= 0 ? String(row[phanTramHaoHutCol] ?? '').trim() : undefined;
          const ghiChu = ghiChuCol >= 0 ? String(row[ghiChuCol] ?? '').trim() : undefined;
          if (!out[storeKey]) out[storeKey] = [];
          const lineObj: any = { materialCode, quantity, unit, po };
          if (soChungTu)     lineObj.soChungTu     = soChungTu;
          if (maKho)         lineObj.maKho         = maKho;
          if (loaiHinh)      lineObj.loaiHinh      = loaiHinh;
          if (tenVatTu)      lineObj.tenVatTu      = tenVatTu;
          if (dinhMuc)       lineObj.dinhMuc       = dinhMuc;
          if (tenTP)         lineObj.tenTP         = tenTP;
          if (tongSLYCau)    lineObj.tongSLYCau    = tongSLYCau;
          if (maKhachHang)   lineObj.maKhachHang   = maKhachHang;
          if (soPOKH)        lineObj.soPOKH        = soPOKH;
          if (phanTramHaoHut) lineObj.phanTramHaoHut = phanTramHaoHut;
          if (ghiChu)        lineObj.ghiChu        = ghiChu;
          out[storeKey].push(lineObj);
        }
        return { byLsx: out, rowsWithPx: cnt };
      };
      const dataStartRow = headerRowIndex + 1;
      let idxMaCtuFinal = idxMaCtu, idxSoLenhSXFinal = idxSoLenhSX, idxMaVatTuFinal = idxMaVatTu;
      let idxSoLuongXTTFinal = idxSoLuongXTT, idxDvtFinal = idxDvt, idxSoPOFinal = idxSoPO, idxSoChungTuFinal = idxSoChungTu;
      let idxMaKhoFinal = idxMaKho, idxLoaiHinhFinal = idxLoaiHinh;
      let idxTenVatTuFinal = idxTenVatTu ?? -1, idxDinhMucFinal = idxDinhMuc ?? -1, idxTenTPFinal = idxTenTP ?? -1;
      let idxTongSLYCauFinal = idxTongSLYCau ?? -1, idxMaKhachHangFinal = 4, idxSoPOKHFinal = 15, idxPhanTramHaoHutFinal = idxPhanTramHaoHut ?? -1, idxGhiChuFinal = idxGhiChu ?? -1;
      let byLsx: PxkDataByLsx = {};
      let rowsWithPx = 0;
      const pxkLsxSamples: string[] = [];
      const tryParse = () => {
        const res = parseWithCols(idxMaCtuFinal, idxSoLenhSXFinal, idxMaVatTuFinal, idxSoLuongXTTFinal, idxDvtFinal, idxSoPOFinal, idxSoChungTuFinal, idxMaKhoFinal, idxLoaiHinhFinal, idxTenVatTuFinal, idxDinhMucFinal, idxTenTPFinal, idxTongSLYCauFinal, idxMaKhachHangFinal, idxSoPOKHFinal, idxPhanTramHaoHutFinal, idxGhiChuFinal);
        byLsx = res.byLsx;
        rowsWithPx = res.rowsWithPx;
      };
      tryParse();
      if (rowsWithPx === 0 && rows.length > dataStartRow) {
        const pxCountByCol: number[] = [];
        for (let c = 0; c <= 10; c++) pxCountByCol[c] = 0;
        for (let r = dataStartRow; r < Math.min(dataStartRow + 200, rows.length); r++) {
          const row = rows[r] || [];
          for (let c = 0; c <= 10; c++) {
            const v = String(row[c] ?? '').trim().toUpperCase();
            if (v === 'PX' || v.includes('PX')) pxCountByCol[c]++;
          }
        }
        const bestMaCtuCol = pxCountByCol.reduce((best, cnt, i) => cnt > (pxCountByCol[best] || 0) ? i : best, 0);
        if ((pxCountByCol[bestMaCtuCol] || 0) > 0) {
          console.log('[PXK Import] Fallback: cột có nhiều PX nhất =', bestMaCtuCol + 1, '(', pxCountByCol[bestMaCtuCol], 'dòng)');
          idxMaCtuFinal = bestMaCtuCol;
          tryParse();
        }
      }
      for (let r = dataStartRow; r < rows.length && pxkLsxSamples.length < 5; r++) {
        const row = rows[r] || [];
        const v = String(row[idxMaCtuFinal] ?? '').trim().toUpperCase();
        if (v !== 'PX' && !v.includes('PX')) continue;
        const pxkLsxRaw = getFullLsxFromCell(row[idxSoLenhSXFinal]);
        if (pxkLsxRaw) pxkLsxSamples.push(pxkLsxRaw);
      }
      // Merge: cùng số CT ghi đè, khác số CT thêm mới
      for (const [lsxKey, newLines] of Object.entries(byLsx)) {
        const existing = this.pxkDataByLsx[lsxKey] || [];
        const newSoCtSet = new Set(newLines.map(l => l.soChungTu ?? ''));
        const kept = existing.filter(l => !newSoCtSet.has(l.soChungTu ?? ''));
        this.pxkDataByLsx[lsxKey] = [...kept, ...newLines];
      }
      this.invalidatePxkCache();
      const total = Object.values(byLsx).reduce((s, arr) => s + arr.length, 0);
      const storedKeys = Object.keys(byLsx);
      console.log('[PXK Import] Sheet:', Object.keys(workbook.Sheets).find(k => workbook.Sheets[k] === sheet), '| Header row:', headerRowIndex, '| Cols:', { idxMaCtu: idxMaCtuFinal, idxSoLenhSX: idxSoLenhSXFinal, idxMaVatTu: idxMaVatTuFinal }, '| Rows PX:', rowsWithPx, '| Total:', total, '| Stored LSX keys:', storedKeys.slice(0, 10), '| WO LSX sample:', woLsxList.slice(0, 5), '| PXK LSX sample:', pxkLsxSamples);
      if (total === 0) {
        if (rowsWithPx > 0) {
          alert(`Import PXK: Tìm thấy ${rowsWithPx} dòng Mã Ctừ=PX nhưng không có dòng nào có LSX đúng format.\nASM1: KZLSX + 4 số + / + 4 số (VD: KZLSX0326/0089)\nASM2: LHLSX + 4 số + / + 4 số (VD: LHLSX0326/0089)\nCột LSX đang đọc: cột C.`);
        } else if (rows.length > dataStartRow) {
          alert(`Import PXK: Không tìm thấy dòng nào có Mã Ctừ = PX.\nKiểm tra cột "Mã Ctừ" (cột ${idxMaCtuFinal + 1}).\nDòng tiêu đề: ${headerRowIndex + 1}. Mở Console (F12) để xem chi tiết.`);
        } else {
          alert('Import PXK: Không có dữ liệu sau dòng tiêu đề.');
        }
      } else {
        // Loại bỏ undefined khỏi object trước khi lưu Firestore (Firestore không chấp nhận undefined)
        const sanitizeLine = (line: any): any => {
          const out: any = {};
          for (const [k, v] of Object.entries(line)) {
            if (v !== undefined && v !== null && v !== '') out[k] = v;
          }
          return out;
        };
        let saveOk = 0;
        let saveErrors = 0;
        // Chỉ lưu các LSX vừa import, dùng dữ liệu đã merge (this.pxkDataByLsx)
        for (const lsxKey of Object.keys(byLsx)) {
          const lines = this.pxkDataByLsx[lsxKey] || [];
          const factorySave = getFactoryFromLsx(lsxKey);
          const docId = `${factorySave}_${lsxKey.replace(/\//g, '_').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
          const sanitizedLines = lines.map(sanitizeLine);
          try {
            await this.firestore.collection('pxk-import-data').doc(docId).set({
              lsx: lsxKey,
              factory: factorySave,
              lines: sanitizedLines,
              importedAt: new Date()
            });
            saveOk++;
            console.log(`[PXK Save] ✅ Đã lưu LSX ${lsxKey} (${sanitizedLines.length} dòng), docId: ${docId}`);
          } catch (innerErr) {
            saveErrors++;
            console.error(`[PXK Save] ❌ Lỗi LSX ${lsxKey}:`, innerErr);
          }
        }
        console.log(`[PXK Save] Kết quả: ${saveOk} LSX lưu thành công, ${saveErrors} lỗi`);
        if (saveErrors > 0) {
          alert(`⚠️ Import PXK: ${saveOk} LSX lưu thành công, ${saveErrors} LSX bị lỗi. Mở F12 Console để xem chi tiết.`);
        }
        const lsxList = Object.keys(byLsx).sort();
        const maxShow = 15;
        const lsxDisplay = lsxList.length <= maxShow
          ? lsxList.join(', ')
          : lsxList.slice(0, maxShow).join(', ') + ` và ${lsxList.length - maxShow} LSX khác`;
        alert(`Đã import PXK: ${total} dòng, ${lsxList.length} LSX.\n\nLSX đã import:\n${lsxDisplay}`);
        this.calculateSummary();
      }
    } catch (err) {
      console.error('PXK import error:', err);
      alert('Lỗi khi đọc file PXK: ' + (err as Error).message);
    } finally {
      this.isImportingPxk = false;
      input.value = '';
    }
  }

  /** Xóa cache khi dữ liệu PXK thay đổi (sau load hoặc import) */
  private invalidatePxkCache(): void {
    this._pxkLinesCache.clear();
  }

  getPxkLinesForLsx(lsx: string): PxkLine[] {
    if (!lsx) return [];
    const woLsx = String(lsx).trim();
    if (this._pxkLinesCache.has(woLsx)) return this._pxkLinesCache.get(woLsx)!;

    const woUpper = woLsx.toUpperCase();
    const normalizeLsx = (s: string): string => {
      const t = String(s || '').trim().toUpperCase().replace(/\s/g, '');
      const m = t.match(/(\d{4}[\/\-\.]\d+)/);
      return m ? m[1].replace(/[-.]/g, '/') : t;
    };
    const samePrefix = (a: string, b: string): boolean => {
      const ua = (a || '').toUpperCase();
      const ub = (b || '').toUpperCase();
      const aKz = ua.startsWith('KZLSX') || ua.startsWith('KZ');
      const bKz = ub.startsWith('KZLSX') || ub.startsWith('KZ');
      const aLh = ua.startsWith('LHLSX') || ua.startsWith('LH');
      const bLh = ub.startsWith('LHLSX') || ub.startsWith('LH');
      return (aKz && bKz) || (aLh && bLh);
    };
    const woNorm = normalizeLsx(woLsx);
    let result: PxkLine[] = [];
    for (const key of Object.keys(this.pxkDataByLsx)) {
      if (key.toUpperCase() === woUpper
        || (samePrefix(woLsx, key) && (woUpper.includes(key.toUpperCase()) || key.toUpperCase().includes(woUpper)))
        || (samePrefix(woLsx, key) && woNorm && normalizeLsx(key) === woNorm)) {
        result = this.pxkDataByLsx[key] || [];
        break;
      }
    }
    this._pxkLinesCache.set(woLsx, result);
    return result;
  }

  hasPxkForWorkOrder(wo: WorkOrder): boolean {
    return this.getPxkLinesForLsx(wo.productionOrder || '').length > 0;
  }

  private isRuleEffectiveDate(): boolean {
    return new Date() >= RULE_THIEU_BLOCK_DATE;
  }

  /** Kiểm tra LSX có PXK và So sánh có dòng Thiếu không - dùng CHÍNH XÁC logic In PXK */
  async hasPxkThieuForLsx(lsx: string, factory: string): Promise<boolean> {
    const lines = this.getPxkLinesForLsx(lsx);
    if (lines.length === 0) return false;
    const isAsm1 = (factory || 'ASM1').toUpperCase().includes('ASM1');
    const factoryFilter = isAsm1 ? 'ASM1' : 'ASM2';
    const normLsx = (s: string) => {
      const t = String(s || '').trim().toUpperCase().replace(/\s/g, '');
      const m = t.match(/(\d{4}[\/\-\.]\d+)/);
      return m ? m[1].replace(/[-.]/g, '/') : t;
    };
    const woLsxNorm = normLsx(lsx);
    const scanMap = new Map<string, number>();
    try {
      const outboundSnapshot = await firstValueFrom(this.firestore.collection('outbound-materials', ref =>
        ref.where('factory', '==', factoryFilter)
      ).get());
      outboundSnapshot.docs.forEach((doc: any) => {
        const d = doc.data() as any;
        const poLsxNorm = normLsx(d.productionOrder || '');
        if (!woLsxNorm || !poLsxNorm || poLsxNorm !== woLsxNorm) return;
        const mat = String(d.materialCode || '').trim().toUpperCase();
        if (mat.charAt(0) !== 'B') return;
        const po = String(d.poNumber ?? d.po ?? '').trim();
        const qty = Number(d.exportQuantity || 0) || 0;
        const key = `${mat}|${po}`;
        scanMap.set(key, (scanMap.get(key) || 0) + qty);
      });
    } catch (e) {
      return false;
    }
    const getScanQty = (materialCode: string, po: string): number =>
      scanMap.get(`${String(materialCode || '').trim().toUpperCase()}|${String(po || '').trim()}`) || 0;
    const getSoSanh = (xuất: number, scan: number): string => {
      const diff = scan - xuất;
      if (Math.abs(diff) < 1) return 'Đủ';
      if (diff < 0) return 'Thiếu';
      return 'Dư';
    };
    const hasAnyScanData = lines.some(l => getScanQty(l.materialCode, l.po || (l as any).poNumber) > 0);
    for (const l of lines) {
      const matCode = String(l.materialCode || '').trim().toUpperCase();
      const maKho = String((l as any).maKho || '').trim().toUpperCase();
      const isNvlSxOnly = maKho === 'NVL_SX';
      const isR = matCode.charAt(0) === 'R';
      const isB033 = matCode.startsWith('B033');
      const isB030 = matCode.startsWith('B030');
      const po = String((l as any).po || (l as any).poNumber || '').trim();
      let scanQty: number;
      if (isNvlSxOnly) {
        scanQty = Number(l.quantity) || 0; // Đã Giao
      } else if ((isR || isB030 || isB033) && hasAnyScanData) {
        scanQty = Number(l.quantity) || 0; // Coi như đủ
      } else {
        scanQty = getScanQty(l.materialCode, po);
      }
      const qtyPxk = Number(l.quantity) || 0;
      if (isR) continue; // R không tính thiếu
      const soSanh = !hasAnyScanData && scanQty === 0 ? '' : getSoSanh(qtyPxk, scanQty);
      if (soSanh.startsWith('Thiếu')) return true;
    }
    return false;
  }

  /** Nếu LSX có PXK và So sánh có Thiếu thì không cho chọn Done hoặc Transfer */
  async isThieuBlockedForWorkOrder(wo: WorkOrder): Promise<boolean> {
    if (!this.isRuleEffectiveDate()) return false;
    if (!this.hasPxkForWorkOrder(wo)) return false;
    const factory = wo.factory || this.selectedFactory || 'ASM1';
    return this.hasPxkThieuForLsx(wo.productionOrder || '', factory);
  }

  /** @deprecated Dùng isThieuBlockedForWorkOrder */
  async isDoneBlockedForWorkOrder(wo: WorkOrder): Promise<boolean> {
    return this.isThieuBlockedForWorkOrder(wo);
  }

  private formatQuantityForPxk(n: number): string {
    const num = Number(n);
    const fixed = num.toFixed(2);
    const parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }

  async printPxk(workOrder: WorkOrder): Promise<void> {
    try {
    const lines = this.getPxkLinesForLsx(workOrder.productionOrder || '');
    if (lines.length === 0) {
      alert('Chưa có dữ liệu PXK cho LSX ' + workOrder.productionOrder + '. Vui lòng import file PXK trước.');
      return;
    }
    const lsx = workOrder.productionOrder || '';
    const factory = (workOrder.factory || this.selectedFactory || 'ASM1').toUpperCase();
    const isAsm1 = factory.includes('ASM1') || factory === 'ASM1';
    let qrImage = '';
    let qrImageLine = '';
    try {
      qrImage = await QRCode.toDataURL(lsx, { width: 120, margin: 1 });
    } catch (e) {
      console.warn('Không tạo được QR code:', e);
    }
    const lineNhan = (workOrder.productionLine || '').trim() || '-';
    try {
      if (lineNhan !== '-') qrImageLine = await QRCode.toDataURL(lineNhan, { width: 120, margin: 1 });
    } catch (e) {
      console.warn('Không tạo được QR code Line:', e);
    }
    const locationMap = new Map<string, string>();
    try {
      const snapshot = await firstValueFrom(this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', isAsm1 ? 'ASM1' : 'ASM2')
      ).get());
      snapshot.docs.forEach((doc: any) => {
        const d = doc.data() as any;
        const mat = String(d.materialCode || '').trim();
        const po = String(d.poNumber || d.po || '').trim();
        const loc = String(d.location || '').trim();
        if (mat && po) locationMap.set(`${mat}|${po}`, loc);
      });
    } catch (e) {
      console.warn('Không load được vị trí từ inventory:', e);
    }
    const getLocation = (materialCode: string, po: string): string =>
      locationMap.get(`${String(materialCode || '').trim()}|${String(po || '').trim()}`) || '-';
    const scanQtyMap = new Map<string, number>();
    const employeeIds = new Set<string>();
    const factoryFilter = isAsm1 ? 'ASM1' : 'ASM2';
    try {
      const normLsx = (s: string) => {
        const t = String(s || '').trim().toUpperCase().replace(/\s/g, '');
        const m = t.match(/(\d{4}[\/\-\.]\d+)/);
        return m ? m[1].replace(/[-.]/g, '/') : t;
      };
      const woLsxNorm = normLsx(lsx);
      const outboundSnapshot = await firstValueFrom(this.firestore.collection('outbound-materials', ref =>
        ref.where('factory', '==', factoryFilter)
      ).get());
      outboundSnapshot.docs.forEach((doc: any) => {
        const d = doc.data() as any;
        const poLsxNorm = normLsx(d.productionOrder || '');
        if (!woLsxNorm || !poLsxNorm || poLsxNorm !== woLsxNorm) return;
        const empId = String(d.employeeId || d.exportedBy || '').trim();
        if (empId) employeeIds.add(empId.length > 7 ? empId.substring(0, 7) : empId);
        const mat = String(d.materialCode || '').trim().toUpperCase();
        const po = String(d.poNumber || d.po || '').trim();
        const exportQty = Number(d.exportQuantity || 0);
        if (mat && po) {
          const key = `${mat}|${po}`;
          scanQtyMap.set(key, (scanQtyMap.get(key) || 0) + exportQty);
        }
      });
    } catch (e) {
      console.warn('Không load được Lượng Scan từ outbound:', e);
    }
    const nhanVienSoanStr = employeeIds.size > 0 ? [...employeeIds].filter(Boolean).join(', ') : '-';
    let nhanVienGiaoStr = '-';
    let nhanVienNhanStr = '-';
    const deliveryQtyMap = new Map<string, number>(); // materialCode|PO → checkQuantity
    try {
      const deliverySnapshot = await firstValueFrom(this.firestore.collection('rm1-delivery-records', ref =>
        ref.where('lsx', '==', lsx)
      ).get());
      // Nếu không tìm thấy, thử normalize LSX
      let deliveryDoc: any = null;
      if (!deliverySnapshot.empty) {
        deliveryDoc = deliverySnapshot.docs[0].data() as any;
      } else {
        // Thử tìm bằng cách normalize LSX (loại bỏ khoảng trắng, uppercase)
        const normLsx = lsx.trim().toUpperCase();
        const allDeliverySnap = await firstValueFrom(this.firestore.collection('rm1-delivery-records').get());
        for (const doc of allDeliverySnap.docs) {
          const d = doc.data() as any;
          if ((d.lsx || '').trim().toUpperCase() === normLsx) {
            deliveryDoc = d;
            break;
          }
        }
      }
      if (deliveryDoc) {
        nhanVienGiaoStr = (deliveryDoc.employeeName || deliveryDoc.employeeId || '').trim() || '-';
        nhanVienNhanStr = (deliveryDoc.receiverEmployeeName || deliveryDoc.receiverEmployeeId || '').trim() || '-';
        // Build delivery qty map từ pxkLines
        (deliveryDoc.pxkLines || []).forEach((line: any) => {
          const mat = String(line.materialCode || '').trim().toUpperCase();
          const po  = String(line.poNumber || line.po || '').trim();
          const qty = Number(line.checkQuantity ?? 0);
          if (mat && po) {
            const key = `${mat}|${po}`;
            deliveryQtyMap.set(key, (deliveryQtyMap.get(key) || 0) + qty);
          }
        });
      }
    } catch (e) {
      console.warn('Không load được dữ liệu Delivery từ RM1 Delivery:', e);
    }
    const getDeliveryQty = (materialCode: string, po: string): number =>
      deliveryQtyMap.get(`${String(materialCode || '').trim().toUpperCase()}|${String(po || '').trim()}`) || 0;
    const getScanQty = (materialCode: string, po: string): number =>
      scanQtyMap.get(`${String(materialCode || '').trim().toUpperCase()}|${String(po || '').trim()}`) || 0;
    const getSoSanh = (xuất: number, scan: number): string => {
      const diff = scan - xuất;
      if (Math.abs(diff) < 1) return 'Đủ';
      if (diff < 0) return 'Thiếu ' + this.formatQuantityForPxk(xuất - scan);
      return 'Dư ' + this.formatQuantityForPxk(scan - xuất);
    };
    // Sắp xếp: nhóm 1 (NVL, NVL_E31, NVL_KE31, NVL_EXPIRED) trên cùng, nhóm 2 còn lại dưới, ngăn cách bằng dòng trắng
    const TOP_MA_KHO = new Set(['NVL', 'NVL_E31', 'NVL_KE31', 'NVL_EXPIRED', '00']);
    const sortByMat = (a: PxkLine, b: PxkLine) => (a.materialCode || '').localeCompare(b.materialCode || '');
    const group1 = lines.filter(l => TOP_MA_KHO.has(String((l as any).maKho || '').trim().toUpperCase())).sort(sortByMat);
    const group2 = lines.filter(l => !TOP_MA_KHO.has(String((l as any).maKho || '').trim().toUpperCase())).sort(sortByMat);
    const sortedLines: (PxkLine | null)[] = group1.length > 0 && group2.length > 0
      ? [...group1, null, ...group2]   // null = dòng trống ngăn cách 2 nhóm
      : [...group1, ...group2];
    const soChungTuList = [...new Set(lines.map(l => (l.soChungTu || '').trim()).filter(Boolean))].sort();
    const soChungTuDisplay = soChungTuList.length > 0 ? soChungTuList.map(s => this.escapeHtmlForPrint(s)).join('<br>') : '-';
    const tenTPDisplay = lines.length > 0 ? String((lines[0] as any).tenTP || '').trim() : '';
    const soPOKHDisplay = lines.map(l => String((l as any).soPOKH || '').trim()).find(v => v) || '';
    const phanTramHaoHutDisplay = lines.length > 0 ? String((lines[0] as any).phanTramHaoHut || '').trim() : '';
    const hasAnyScanData = lines.some(l => getScanQty(l.materialCode, l.po) > 0);
    const hasAnyDeliveryData = lines.some(l => getDeliveryQty(l.materialCode, l.po) > 0);
    let sttCounter = 0;
    const rowsHtml = sortedLines.map((l) => {
      if (l === null) {
        return '<tr><td colspan="14" style="border:1px solid #000;padding:8px;background:#fff;"></td></tr>';
      }
      sttCounter++;
      const matCode = String(l.materialCode || '').trim().toUpperCase();
      const maKho = String((l as any).maKho || '').trim().toUpperCase();
      const qtyStr = this.formatQuantityForPxk(l.quantity);
      const loaiHinh = String((l as any).loaiHinh || '').trim();
      const tenVatTu = String((l as any).tenVatTu || '').trim();
      const dinhMuc = String((l as any).dinhMuc || '').trim();
      const tongSLYCau = String((l as any).tongSLYCau || '').trim();
      const po = String(l.po || '').trim();
      const isNvlSxOnly = maKho === 'NVL_SX';
      const isR = matCode.charAt(0) === 'R';
      const isB033 = matCode.startsWith('B033');
      const isB030 = matCode.startsWith('B030');
      let scanQty: number;
      if (isNvlSxOnly) {
        scanQty = Number(l.quantity) || 0;
      } else if ((isR || isB030 || isB033) && hasAnyScanData) {
        scanQty = Number(l.quantity) || 0;
      } else {
        scanQty = getScanQty(l.materialCode, po);
      }
      const qtyPxk = Number(l.quantity) || 0;
      const soSanhStr = !hasAnyScanData && scanQty === 0 ? '' : getSoSanh(qtyPxk, scanQty);
      const soSanhColor = soSanhStr.startsWith('Thiếu') ? 'color:red;font-weight:bold;' : soSanhStr === 'Đủ' ? 'color:green;font-weight:bold;' : soSanhStr.startsWith('Dư') ? 'color:orange;font-weight:bold;' : '';
      const scanQtyStr = scanQty > 0 ? this.formatQuantityForPxk(scanQty) : '';
      const deliveryQty = getDeliveryQty(l.materialCode, po);
      const deliveryQtyStr = deliveryQty > 0 ? this.formatQuantityForPxk(deliveryQty) : '';
      return `<tr>
        <td style="border:1px solid #000;padding:6px;text-align:center;">${sttCounter}</td>
        <td style="border:1px solid #000;padding:6px;">${this.escapeHtmlForPrint(l.materialCode)}</td>
        <td class="col-ten-vat-tu" style="border:1px solid #000;padding:6px;">${this.escapeHtmlForPrint(tenVatTu || '-')}</td>
        <td style="border:1px solid #000;padding:6px;text-align:center;">${this.escapeHtmlForPrint(l.unit)}</td>
        <td style="border:1px solid #000;padding:6px;text-align:center;">${this.escapeHtmlForPrint(dinhMuc || '-')}</td>
        <td style="border:1px solid #000;padding:6px;text-align:center;">${this.escapeHtmlForPrint(tongSLYCau || '-')}</td>
        <td style="border:1px solid #000;padding:6px;text-align:center;">${this.escapeHtmlForPrint(po)}</td>
        <td style="border:1px solid #000;padding:6px;text-align:right;">${qtyStr}</td>
        <td style="border:1px solid #000;padding:6px;">${this.escapeHtmlForPrint(maKho)}</td>
        <td class="col-vitri" style="border:1px solid #000;padding:6px;">${this.escapeHtmlForPrint(getLocation(l.materialCode, l.po))}</td>
        <td style="border:1px solid #000;padding:6px;text-align:center;">${this.escapeHtmlForPrint(loaiHinh)}</td>
        <td class="col-luong-scan" style="border:1px solid #000;padding:6px;text-align:right;">${this.escapeHtmlForPrint(scanQtyStr)}</td>
        <td style="border:1px solid #000;padding:6px;text-align:center;${soSanhColor}">${this.escapeHtmlForPrint(soSanhStr)}</td>
        <td style="border:1px solid #000;padding:6px;text-align:right;">${this.escapeHtmlForPrint(deliveryQtyStr)}</td>
        <td class="col-ghi-chu" style="border:1px solid #000;padding:6px;">${this.escapeHtmlForPrint(String((l as any).ghiChu || ''))}</td>
        <td class="col-sx-tra" style="border:1px solid #000;padding:6px;"></td>
      </tr>`;
    }).join('');
    // Box kho NVL_SX, NVL_KS: Mã vật tư, PO, Mã Kho, LSX (LSX gần nhất mà mã hàng+po được xuất)
    const nvlSxKsLines = lines.filter(l => ['NVL_SX', 'NVL_KS'].includes(String((l as any).maKho || '').trim().toUpperCase()));
    let nvlSxKsBoxHtml = '';
    if (nvlSxKsLines.length > 0) {
      const normLsxForCompare = (s: string) => String(s || '').trim().toUpperCase().replace(/\s/g, '');
      const currentLsxNorm = normLsxForCompare(lsx);
      const matPotoLsxMap = new Map<string, { lsx: string; importedAt: number }>();
      const lsxToLineMap = new Map<string, string>();
      try {
        const pxkSnap = await firstValueFrom(this.firestore.collection('pxk-import-data', ref =>
          ref.where('factory', '==', factoryFilter)
        ).get());
        (pxkSnap?.docs || []).forEach((docSnap: any) => {
          const d = docSnap.data();
          const docLsx = String(d?.lsx || '').trim();
          if (normLsxForCompare(docLsx) === currentLsxNorm) return; // Bỏ qua LSX hiện tại, chỉ tìm LSX cũ hơn
          const impAt = d?.importedAt?.toMillis?.() ?? d?.importedAt?.getTime?.() ?? 0;
          (Array.isArray(d?.lines) ? d.lines : []).forEach((ln: any) => {
            const mk = String(ln.maKho || '').trim().toUpperCase();
            if (mk !== 'NVL_SX' && mk !== 'NVL_KS') return;
            const mat = String(ln.materialCode || '').trim();
            const po = String(ln.po || ln.poNumber || '').trim();
            const key = `${mat}|${po}`;
            const cur = matPotoLsxMap.get(key);
            if (!cur || impAt > cur.importedAt) matPotoLsxMap.set(key, { lsx: docLsx, importedAt: impAt });
          });
        });
        // Load Line từ work-orders cho các LSX tìm được
        const lsxSet = new Set([...matPotoLsxMap.values()].map(v => normLsxForCompare(v.lsx)));
        if (lsxSet.size > 0) {
          const woSnap = await this.firestore.collection('work-orders', ref =>
            ref.where('factory', '==', factoryFilter).limit(500)
          ).get().toPromise();
          (woSnap?.docs || []).forEach((docSnap: any) => {
            const wo = docSnap.data();
            const woLsx = String(wo?.productionOrder || '').trim();
            if (lsxSet.has(normLsxForCompare(woLsx))) {
              const line = String(wo?.productionLine || '').trim();
              if (line) lsxToLineMap.set(normLsxForCompare(woLsx), line);
            }
          });
        }
      } catch (e) {
        console.warn('Không load LSX gần nhất cho NVL_SX/NVL_KS:', e);
      }
      const nvlRows = nvlSxKsLines.sort((a, b) => (a.materialCode || '').localeCompare(b.materialCode || '')).map((l, i) => {
        const key = `${String(l.materialCode || '').trim()}|${String(l.po || '').trim()}`;
        const info = matPotoLsxMap.get(key);
        const lsxVal = info?.lsx || '-';
        const lineVal = info ? lsxToLineMap.get(normLsxForCompare(info.lsx)) || '' : '';
        return `<tr>
          <td style="border:1px solid #000;padding:6px;text-align:center;">${i + 1}</td>
          <td style="border:1px solid #000;padding:6px;">${this.escapeHtmlForPrint(l.materialCode)}</td>
          <td style="border:1px solid #000;padding:6px;">${this.escapeHtmlForPrint(l.po)}</td>
          <td style="border:1px solid #000;padding:6px;">${this.escapeHtmlForPrint(String((l as any).maKho || '').trim())}</td>
          <td style="border:1px solid #000;padding:6px;">${this.escapeHtmlForPrint(lsxVal)}</td>
          <td style="border:1px solid #000;padding:6px;">${this.escapeHtmlForPrint(lineVal)}</td>
        </tr>`;
      }).join('');
      nvlSxKsBoxHtml = `
<div style="margin-top:16px;">
  <div style="font-weight:bold;margin-bottom:6px;font-size:10px;">Kho NVL_SX / NVL_KS được sử dụng gần nhất</div>
  <table class="pxk-table" style="margin-top:4px;">
    <thead><tr><th>STT</th><th>Mã vật tư</th><th>PO</th><th>Mã Kho</th><th>LSX</th><th>Line</th></tr></thead>
    <tbody>${nvlRows}</tbody>
  </table>
</div>`;
    }
    const deliveryDateStr = workOrder.deliveryDate
      ? (workOrder.deliveryDate instanceof Date ? workOrder.deliveryDate : new Date(workOrder.deliveryDate)).toLocaleDateString('vi-VN')
      : '-';
    const boxStyle = `flex:1;min-height:120px;border:1px solid #000;padding:6px;display:flex;flex-direction:column;font-size:13px;box-sizing:border-box;position:relative`;
    const infoBox = (label: string, value: string) =>
      `<div style="${boxStyle}"><strong style="font-size:10px;text-transform:uppercase;position:absolute;top:6px;left:6px;">${label}</strong><div style="flex:1;display:flex;align-items:center;justify-content:center;text-align:center;word-break:break-all;line-height:1.2;padding-top:18px;"><span>${value}</span></div></div>`;
    const lsxUpper = lsx.toUpperCase().replace(/\s/g, '');
    const isKZ = lsxUpper.startsWith('KZ');
    const isLH = lsxUpper.startsWith('LH');
    const isWHE = lineNhan.trim().toUpperCase() === 'WH E';
    const factoryIconHtml = isKZ
      ? `<span style="position:absolute;top:6px;left:6px;font-size:16px;font-weight:bold;">${isWHE ? 'ASM3' : 'ASM1'}</span>`
      : isLH
        ? `<span style="position:absolute;top:6px;left:6px;font-size:16px;font-weight:bold;">ASM2</span>`
        : '';
    const maTPVNBox = `<div style="${boxStyle}"><strong style="font-size:10px;text-transform:uppercase;position:absolute;top:6px;left:6px;">Mã TP VN</strong><div style="flex:1;display:flex;align-items:center;justify-content:center;text-align:center;word-break:break-all;line-height:1.2;padding-top:18px;"><span>${this.escapeHtmlForPrint(workOrder.productCode || '-')}</span></div></div>`;
    const maKhachHangDisplay = lines.map(l => String((l as any).maKhachHang || '').trim()).find(v => v) || workOrder.customer || '-';
    const maKhachHangBox = infoBox('Mã Khách Hàng', this.escapeHtmlForPrint(maKhachHangDisplay));
    const lsxBox = `<div style="${boxStyle};position:relative;"><div style="position:absolute;top:6px;left:6px;"><strong style="font-size:10px;text-transform:uppercase;display:block;margin-bottom:2px;">Lệnh Sản Xuất</strong><span style="word-break:break-all;font-size:11px;">${this.escapeHtmlForPrint(lsx)}</span></div>${qrImage ? `<img src="${qrImage}" alt="QR" style="position:absolute;bottom:6px;right:6px;width:70px;height:70px;display:block;" />` : ''}</div>`;
    const isUsbCLine = /USB\s*C/i.test(lineNhan);
    const cameraIconHtml = isUsbCLine ? `<span style="position:absolute;top:4px;right:4px;width:24px;height:24px;display:inline-block;" title="Chụp hình"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg></span>` : '';
    const lineNhanBoxStyle = boxStyle + ';flex-direction:row;align-items:center;justify-content:space-between;gap:6px;';
    const lineNhanBox = `<div style="${lineNhanBoxStyle}">${factoryIconHtml}${cameraIconHtml}<div style="flex:1;display:flex;flex-direction:column;padding-top:${factoryIconHtml ? '22px' : '0'};"><strong style="font-size:10px;text-transform:uppercase;margin-bottom:2px;">Line Nhận</strong><span style="word-break:break-all;font-size:11px;">${this.escapeHtmlForPrint(lineNhan)}</span></div>${qrImageLine ? `<img src="${qrImageLine}" alt="QR Line" style="width:70px;height:70px;flex-shrink:0;display:block;" />` : ''}</div>`;
    const soChungTuBox = `<div style="${boxStyle}"><strong style="font-size:10px;text-transform:uppercase;position:absolute;top:6px;left:6px;">Số Chứng Từ</strong><div style="flex:1;display:flex;align-items:center;justify-content:center;text-align:center;word-break:break-all;line-height:1.4;font-size:11px;padding-top:18px;"><span>${soChungTuDisplay}</span></div></div>`;
    const emptyBox = `<div style="${boxStyle}"></div>`;
    const rowStyle = 'display:flex;flex-direction:row;gap:8px;width:100%;margin-bottom:8px';
    const headerSection = `
<div style="margin-bottom:16px;width:100%;box-sizing:border-box;">
  <div style="${rowStyle}">
    ${maTPVNBox}
    ${maKhachHangBox}
    ${infoBox('Phần Trăm Hao Hụt', phanTramHaoHutDisplay ? this.escapeHtmlForPrint(phanTramHaoHutDisplay) + '%' : '')}
    ${`<div style="${boxStyle}"><strong style="font-size:10px;text-transform:uppercase;position:absolute;top:6px;left:6px;">Lượng sản phẩm</strong><div style="flex:1;display:flex;align-items:center;justify-content:center;text-align:center;word-break:break-all;line-height:1.2;padding-top:18px;"><span>${this.formatQuantityForPxk(workOrder.quantity || 0)}</span></div>${deliveryDateStr !== '-' ? `<span style="position:absolute;bottom:6px;left:6px;font-size:11px;">Ngày giao: ${this.escapeHtmlForPrint(deliveryDateStr)}</span>` : ''}</div>`}
    ${lsxBox}
    ${lineNhanBox}
  </div>
  <div style="${rowStyle}">
    ${infoBox('Tên TP', this.escapeHtmlForPrint(tenTPDisplay || ''))}
    ${infoBox('Số PO KH', this.escapeHtmlForPrint(soPOKHDisplay || ''))}
    ${soChungTuBox}
    ${infoBox('Nhân Viên Soạn', this.escapeHtmlForPrint(nhanVienSoanStr))}
    ${infoBox('Nhân viên Giao', this.escapeHtmlForPrint(nhanVienGiaoStr))}
    ${infoBox('Nhân viên Nhận', this.escapeHtmlForPrint(nhanVienNhanStr))}
  </div>
</div>`;
    const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title></title>
<style>
@page{size:A4 landscape;margin:0;marks:none}
*{margin:0;padding:0;box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:Arial,sans-serif;padding:5mm;color:#000;font-size:12px}
@media print{
  html::before,html::after,body::before,body::after{display:none!important;content:none!important}
  head,header,footer,nav{display:none!important}
}
.pxk-table{width:100%;border-collapse:collapse;margin-top:8px}
.pxk-table th,.pxk-table td{border:1px solid #000;padding:6px;font-size:10px}
.pxk-table th{background:#f0f0f0;font-weight:bold;text-transform:uppercase}
.pxk-table th.col-ten-vat-tu{min-width:120px;width:14%}.pxk-table td.col-ten-vat-tu{min-width:120px;width:14%;font-size:8px}
.pxk-table th.col-vitri,.pxk-table td.col-vitri{min-width:80px;width:9.6%}
.pxk-table th.col-luong-scan,.pxk-table td.col-luong-scan,.pxk-table th.col-sx-tra,.pxk-table td.col-sx-tra{min-width:70px;width:7%}.pxk-table th.col-ghi-chu,.pxk-table td.col-ghi-chu{min-width:80px;width:9%}
.pxk-top-header{width:100%;border-collapse:collapse;margin-bottom:12px}
.pxk-top-header td{vertical-align:middle;border:1px solid #000;padding:8px}
.pxk-top-header .logo-cell{width:230px;min-width:230px;text-align:center;vertical-align:middle}
.pxk-top-header .logo-cell img{max-width:100%;max-height:80px;object-fit:contain}
.pxk-top-header .title-cell{text-align:center;padding:8px}
.pxk-top-header .title-inner{width:100%;border-collapse:collapse}
.pxk-top-header .title-inner td{border:none;padding:8px;text-align:center}
.pxk-top-header .title-line1{font-size:18px;font-weight:bold}
.pxk-top-header .title-line2{font-size:14px;text-transform:uppercase}
.pxk-top-header .meta-cell{width:230px;min-width:230px}
.pxk-top-header .meta-table{width:100%;border-collapse:collapse;font-size:11px}
.pxk-top-header .meta-table td{border:1px solid #000;padding:4px 6px}
.pxk-top-header .meta-table td:not(.meta-label){white-space:nowrap}
.pxk-top-header .meta-table .meta-label{width:45%;background:#f5f5f5}
</style></head><body>
<div class="pxk-top-header-wrap">
<table class="pxk-top-header">
<tr>
  <td class="logo-cell"><img src="${(typeof window !== 'undefined' ? window.location.origin : '') + '/assets/img/logo.png'}" alt="AIRSPEED" /></td>
  <td class="title-cell">
    <table class="title-inner"><tr><td class="title-line1">AIRSPEED MANUFACTURING VIET NAM</td></tr><tr><td class="title-line2">DANH SÁCH VẬT TƯ THEO LỆNH SẢN XUẤT</td></tr></table>
  </td>
  <td class="meta-cell">
    <table class="meta-table">
      <tr><td class="meta-label">Mã quản lý</td><td>WH-WI0005/F07</td></tr>
      <tr><td class="meta-label">Phiên bản</td><td>00</td></tr>
      <tr><td class="meta-label">Ngày ban hành</td><td>05/03/2026</td></tr>
      <tr><td class="meta-label">Số Trang</td><td>01</td></tr>
    </table>
  </td>
</tr>
</table>
</div>
${headerSection}
<table class="pxk-table">
<thead><tr><th>STT</th><th>Mã vật tư</th><th class="col-ten-vat-tu">Tên Vật Tư</th><th>Đơn vị tính</th><th>Định Mức</th><th>Tổng SL Y/Cầu</th><th>PO</th><th>Xuất Kho</th><th>Mã Kho</th><th class="col-vitri">Vị trí</th><th>Loại Hình</th><th class="col-luong-scan">Lượng Scan</th><th>So Sánh</th><th>Lượng Giao</th><th class="col-ghi-chu">Ghi chú</th><th class="col-sx-tra">SX trả</th></tr></thead>
<tbody>${rowsHtml}</tbody>
</table>
${nvlSxKsBoxHtml}
<script>window.onload=function(){window.print()}</script>
</body></html>`;
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
    } else {
      alert('Không mở được cửa sổ in. Vui lòng cho phép popup cho trang này (hoặc bấm Ctrl+P để in trang hiện tại).');
    }
    } catch (err) {
      console.error('Lỗi khi in PXK:', err);
      alert('Lỗi khi in PXK: ' + (err && (err as Error).message ? (err as Error).message : 'Vui lòng thử lại.'));
    }
  }

  private escapeHtmlForPrint(s: string): string {
    if (s == null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }








  // Page Navigation
  /** Mở scan QR - chỉ dùng máy scanner (không camera) */
  async openScanPopup(): Promise<void> {
    console.log('🚀 Opening scan - máy scanner...');
    await this.loadAllWorkOrdersForScan();
    this.isScanPopupMode = true;
    this.isPhysicalScannerMode = true;
    this.showScanLSXPopup = true;
    this.startPhysicalScanner();
  }

  async openScanPage(): Promise<void> {
    console.log('🚀 Opening scan page...');
    this.currentView = 'scan';
    this.scannedItems = [];

    // Load all work orders first, then start scanner
    await this.loadAllWorkOrdersForScan();
    
    // Auto-start scanner mode after data is loaded
    setTimeout(() => {
      if (this.isPhysicalScannerMode) {
        this.startPhysicalScanner();
      } else {
        // If in camera mode, start camera scanner
        this.startScanner();
      }
    }, 500);
  }

  backToMainView(): void {
    console.log('🔙 Returning to main view...');
    this.currentView = 'main';
    this.stopScanner();
    this.stopPhysicalScanner();
    this.scannedItems = [];
    this.isProcessingScan = false;
  }

  // Legacy methods for compatibility (can be removed later)
  openScanDialog(): void {
    this.openScanPage();
  }

  closeScanDialog(): void {
    this.backToMainView();
  }

  async loadAllWorkOrdersForScan(): Promise<void> {
    try {
      console.log('🔍 Loading all work orders for scan lookup...');
      
      // Use AngularFirestore instead of native Firestore
      const querySnapshot = await this.firestore.collection('work-orders', ref => 
        ref.orderBy('createdDate', 'desc')
      ).get().toPromise();
      
      if (querySnapshot) {
        console.log(`📊 Total documents in workOrders collection: ${querySnapshot.size}`);
        
        this.allWorkOrdersForScan = [];
        querySnapshot.forEach((doc) => {
          const data = doc.data() as WorkOrder;
          this.allWorkOrdersForScan.push({
            id: doc.id,
            ...data
          } as WorkOrder);
        });

        console.log(`✅ Loaded ${this.allWorkOrdersForScan.length} work orders for scan lookup`);
        
        // Debug: show first few work orders
        console.log('🔍 Sample work orders:', this.allWorkOrdersForScan.slice(0, 3).map(wo => ({
          lsx: wo.productionOrder,
          factory: wo.factory,
          id: wo.id
        })));
      } else {
        console.log('❌ QuerySnapshot is null');
      }
    } catch (error) {
      console.error('❌ Error loading all work orders for scan:', error);
    }
  }

  private async loadWorkOrdersByFactory(factory: string): Promise<WorkOrder[]> {
    try {
      console.log(`🔍 Loading work orders for factory: ${factory}`);
      const db = getFirestore();
      const workOrdersCollection = collection(db, 'workOrders');
      const q = query(workOrdersCollection, orderBy('createdDate', 'desc'));
      const querySnapshot = await getDocs(q);
      
      console.log(`📊 Total documents in workOrders collection: ${querySnapshot.size}`);
      
      const workOrders: WorkOrder[] = [];
      querySnapshot.forEach((doc) => {
        const data = doc.data() as WorkOrder;
        // Load ALL work orders for scan (don't filter by factory)
        workOrders.push({
          id: doc.id,
          ...data
        } as WorkOrder);
      });
      
      console.log(`✅ Loaded ${workOrders.length} work orders from ${factory}`);
      return workOrders;
    } catch (error) {
      console.error(`❌ Error loading work orders for factory ${factory}:`, error);
      return [];
    }
  }

  async startScanner(): Promise<void> {
    try {
      console.log('📷 Starting QR scanner...');
      
      // Use QRScannerModal for better mobile compatibility
      const dialogData: QRScannerData = {
        title: 'Quét QR Work Order',
        message: 'Quét mã QR của Work Order để cập nhật trạng thái'
      };
      
      const dialogRef = this.dialog.open(QRScannerModalComponent, {
        width: '100vw',
        maxWidth: '100vw',
        height: '80vh',
        maxHeight: '80vh',
        data: dialogData,
        panelClass: 'qr-scanner-modal'
      });
      
      dialogRef.afterClosed().subscribe(result => {
        if (result && result.text) {
          console.log('📱 QR Code scanned:', result.text);
          this.onScanSuccess(result.text);
        }
      });

      console.log('✅ QR scanner started successfully');
    } catch (error) {
      console.error('❌ Error starting scanner:', error);
      alert('Không thể khởi động camera. Vui lòng kiểm tra quyền truy cập camera.');
    }
  }

  async stopScanner(): Promise<void> {
    try {
      if (this.isScannerActive) {
        this.qrScannerService.stopScanning();
        console.log('🛑 QR scanner stopped');
      }
      this.isScannerActive = false;
    } catch (error) {
      console.error('❌ Error stopping scanner:', error);
      this.isScannerActive = false;
    }
  }

  onScanSuccess(decodedText: string): void {
    console.log('📱 QR Code scanned:', decodedText);
    
    try {
      // Xử lý QR code chỉ chứa LSX
      const lsxValue = decodedText.trim();
      this.processLSXQRCode(lsxValue);
    } catch (error) {
      console.error('❌ Error processing scan:', error);
      alert(`❌ Lỗi xử lý QR code: ${error}`);
    }
  }

  async processLSXQRCode(lsxValue: string): Promise<void> {
    console.log('🔍 Looking for Work Order with LSX:', lsxValue);
    
    const trimUpper = (s: string) => String(s || '').trim().toUpperCase();
    const scanNorm = trimUpper(lsxValue);
    
    // Find work order by LSX (exact, base, hoặc normalize)
    let workOrder = this.allWorkOrdersForScan.find(wo => {
      const po = String(wo.productionOrder || '').trim();
      if (po === lsxValue || po === scanNorm) return true;
      if (trimUpper(po) === scanNorm) return true;
      const baseScan = lsxValue.split('/')[0];
      if (po === baseScan || trimUpper(po) === trimUpper(baseScan)) return true;
      return false;
    });

    if (!workOrder) {
      console.log('❌ Available work orders count:', this.allWorkOrdersForScan.length);
      console.log('❌ Available work orders:', this.allWorkOrdersForScan.map(wo => ({
        lsx: wo.productionOrder,
        factory: wo.factory
      })));
      console.log('❌ Looking for LSX:', lsxValue);
      alert(`❌ Không tìm thấy Work Order với LSX: ${lsxValue}.\n\nCó ${this.allWorkOrdersForScan.length} work orders trong hệ thống.`);
      return;
    }
    
    console.log('✅ Found work order:', workOrder);

    // Đóng popup chờ quét, mở dialog chọn trạng thái
    this.showScanLSXPopup = false;
    this.scanStatusSelectWorkOrder = workOrder;
    this.showScanStatusSelectDialog = true;
    console.log('✅ Mở dialog chọn trạng thái cho LSX:', lsxValue);
  }

  closeScanStatusSelectDialog(): void {
    this.showScanStatusSelectDialog = false;
    this.scanStatusSelectWorkOrder = null;
    this.stopScanPopupMode();
  }

  /** Đóng popup chờ quét LSX và dừng scanner */
  closeScanLSXPopup(): void {
    this.showScanLSXPopup = false;
    this.stopScanPopupMode();
  }

  private stopScanPopupMode(): void {
    if (this.isScanPopupMode) {
      this.isScanPopupMode = false;
      this.stopPhysicalScanner();
    }
  }

  async onScanStatusSelect(newStatus: string): Promise<void> {
    const wo = this.scanStatusSelectWorkOrder;
    if (!wo) return;
    await this.onStatusChange(wo, newStatus);
    this.closeScanStatusSelectDialog();
    // Cập nhật allWorkOrdersForScan để lần scan sau có data mới
    const idx = this.allWorkOrdersForScan.findIndex(w => w.id === wo.id);
    if (idx >= 0) {
      this.allWorkOrdersForScan[idx] = { ...this.allWorkOrdersForScan[idx], status: newStatus as WorkOrderStatus };
    }
  }



  removeScannedItem(index: number): void {
    this.scannedItems.splice(index, 1);
  }

  // Physical Scanner Methods
  startPhysicalScanner(): void {
    console.log('📱 Starting physical scanner mode...');
    this.isPhysicalScannerMode = true;
    this.scannerBuffer = '';
    
    // Add keyboard event listener
    this.keyboardListener = this.handlePhysicalScannerInput.bind(this);
    document.addEventListener('keydown', this.keyboardListener);
    
    console.log('✅ Physical scanner mode enabled. Ready to scan...');
  }

  stopPhysicalScanner(): void {
    console.log('🛑 Stopping physical scanner mode...');
    this.isPhysicalScannerMode = false;
    this.scannerBuffer = '';
    
    // Remove keyboard event listener
    if (this.keyboardListener) {
      document.removeEventListener('keydown', this.keyboardListener);
      this.keyboardListener = null;
    }
    
    // Clear any pending timeout
    if (this.scannerTimeoutId) {
      clearTimeout(this.scannerTimeoutId);
      this.scannerTimeoutId = null;
    }
    
    console.log('✅ Physical scanner mode disabled');
  }

  // Set camera mode
  setCameraMode(): void {
    console.log('📷 Switching to camera mode...');
    if (this.isPhysicalScannerMode) {
      this.stopPhysicalScanner();
      this.isPhysicalScannerMode = false;
    }
    // Start camera scanner when switching to camera mode
    this.startScanner();
  }

  // Set scanner mode
  setScanMode(): void {
    console.log('📱 Switching to scanner mode...');
    // Stop camera scanner if active
    if (this.isScannerActive) {
      this.stopScanner();
    }
    if (!this.isPhysicalScannerMode) {
      this.startPhysicalScanner();
    }
  }

  // Complete scan and return to main view
  async completeScanAndReturn(): Promise<void> {
    if (this.scannedItems.length === 0) {
      this.backToMainView();
      return;
    }

    try {
      this.isProcessingScan = true;
      
      const user = await this.afAuth.currentUser;
      const currentUser = user?.displayName || 'Unknown';

      // Process each scanned item
      for (const scannedItem of this.scannedItems) {
        try {
          const workOrder = this.allWorkOrdersForScan.find(wo => wo.productionOrder === scannedItem.lsx || wo.productionOrder === scannedItem.lsx.split('/')[0]);
          
          if (!workOrder) {
            console.error(`❌ Work order not found for LSX: ${scannedItem.lsx}`);
            continue;
          }

          // Save scan data
          await this.saveScanData({
            lsx: scannedItem.lsx,
            quantity: workOrder.quantity,
            scannedAt: new Date(),
            scannedBy: currentUser,
            factory: workOrder.factory || 'Unknown',
            workOrderId: workOrder.id!
          });

          // Update work order status to new status (but don't auto-complete)
          const newStatusEnum = this.convertStringToStatus(scannedItem.newStatus);
          workOrder.status = newStatusEnum;
          await this.updateWorkOrderInFirebase(workOrder);
          
          // Note: Work Order is now Done but not completed yet
          // Employee needs to manually click "Hoàn thành" button to complete it

        } catch (error) {
          console.error(`❌ Error processing scan for ${scannedItem.lsx}:`, error);
        }
      }

      // Reload work orders to reflect changes
      await this.loadWorkOrders();
      
      // Clear scanned items and return to main view
      this.scannedItems = [];
      this.backToMainView();

    } catch (error) {
      console.error('❌ Error completing scan:', error);
      alert('❌ Lỗi khi hoàn thành scan!');
    } finally {
      this.isProcessingScan = false;
    }
  }

  private handlePhysicalScannerInput(event: KeyboardEvent): void {
    // Chấp nhận khi: (1) scan page mở, hoặc (2) scan popup mode (nút Scan QR - chỉ máy scanner)
    const isActive = this.isPhysicalScannerMode && (this.currentView === 'scan' || this.isScanPopupMode);
    if (!isActive) {
      return;
    }

    // Prevent default behavior for scanner input
    if (event.key === 'Enter' || (event.key.length === 1 && /[a-zA-Z0-9|\/]/.test(event.key))) {
      event.preventDefault();
      event.stopPropagation();
    }

    // Clear existing timeout
    if (this.scannerTimeoutId) {
      clearTimeout(this.scannerTimeoutId);
    }

    if (event.key === 'Enter') {
      // Process the complete scan
      if (this.scannerBuffer.trim()) {
        console.log('📱 Physical scanner input:', this.scannerBuffer);
        this.onScanSuccess(this.scannerBuffer.trim());
        this.scannerBuffer = '';
      }
    } else if (event.key.length === 1) {
      // Add character to buffer
      this.scannerBuffer += event.key;
      
      // Set timeout to auto-process if no more input (in case Enter is not sent)
      this.scannerTimeoutId = setTimeout(() => {
        if (this.scannerBuffer.trim()) {
          console.log('📱 Physical scanner input (timeout):', this.scannerBuffer);
          this.onScanSuccess(this.scannerBuffer.trim());
          this.scannerBuffer = '';
        }
      }, 100); // 100ms timeout for scan completion
    }
  }

  async processScanResults(): Promise<void> {
    if (this.scannedItems.length === 0) {
      alert('❌ Chưa có item nào được scan!');
      return;
    }

    this.isProcessingScan = true;

    try {
      const user = await this.afAuth.currentUser;
      const currentUser = user ? user.email || user.uid : 'UNKNOWN';

      for (const scannedItem of this.scannedItems) {
        try {
          const workOrder = this.allWorkOrdersForScan.find(wo => wo.id === scannedItem.workOrderId);
          if (!workOrder) {
            console.error(`❌ Work order not found for LSX: ${scannedItem.lsx}`);
            continue;
          }

          await this.saveScanData({
            lsx: scannedItem.lsx,
            quantity: workOrder.quantity,
            scannedAt: new Date(),
            scannedBy: currentUser,
            factory: workOrder.factory || 'Unknown',
            workOrderId: workOrder.id!
          });

          // Note: updateWorkOrderStatusAfterScan is removed - status is already updated in processLSXQRCode

        } catch (error) {
          console.error(`❌ Error processing scan for ${scannedItem.lsx}:`, error);
        }
      }

      await this.loadWorkOrders();
      alert(`✅ Đã xử lý thành công ${this.scannedItems.length} scans!`);
      this.backToMainView();

    } catch (error) {
      console.error('❌ Error processing scan results:', error);
      alert('❌ Lỗi khi xử lý scan results!');
    } finally {
      this.isProcessingScan = false;
    }
  }

  private async saveScanData(scanData: ScanData): Promise<void> {
    try {
      const db = getFirestore();
      const scansCollection = collection(db, 'workOrderScans');
      await addDoc(scansCollection, {
        ...scanData,
        createdAt: new Date()
      });
      console.log('✅ Scan data saved to Firebase:', scanData.lsx);
    } catch (error) {
      console.error('❌ Error saving scan data:', error);
      throw error;
    }
  }

  private async updateWorkOrderStatusAfterScan(workOrder: WorkOrder): Promise<void> {
    try {
      const scanCount = await this.getScanCountForWorkOrder(workOrder.id!);
      
      let newStatus: WorkOrderStatus;
      switch (scanCount) {
        case 1:
          newStatus = WorkOrderStatus.KITTING;
          break;
        case 2:
          newStatus = WorkOrderStatus.READY;
          break;
        case 3:
          newStatus = WorkOrderStatus.TRANSFER;
          break;
        case 4:
        default:
          newStatus = WorkOrderStatus.DONE;
          break;
      }

      workOrder.status = newStatus;
      await this.updateWorkOrderInFirebase(workOrder);
      
      console.log(`✅ Updated work order ${workOrder.productionOrder} status to ${newStatus} (scan count: ${scanCount})`);
    } catch (error) {
      console.error('❌ Error updating work order status after scan:', error);
      throw error;
    }
  }

  private async getScanCountForWorkOrder(workOrderId: string): Promise<number> {
    try {
      const db = getFirestore();
      const scansCollection = collection(db, 'workOrderScans');
      const q = query(scansCollection, orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      let count = 0;
      querySnapshot.forEach((doc) => {
        const data = doc.data() as ScanData;
        if (data.workOrderId === workOrderId) {
          count++;
        }
      });

      return count;
    } catch (error) {
      console.error('❌ Error getting scan count:', error);
      return 0;
    }
  }

  private async updateWorkOrderInFirebase(workOrder: WorkOrder): Promise<void> {
    try {
      if (this.materialService && typeof this.materialService.updateWorkOrder === 'function') {
        await this.materialService.updateWorkOrder(workOrder.id!, workOrder);
        return;
      }

      const db = getFirestore();
      const workOrderRef = doc(db, 'workOrders', workOrder.id!);
      await updateDoc(workOrderRef, {
        status: workOrder.status,
        lastModified: new Date()
      });

    } catch (error) {
      console.error('❌ Error updating work order in Firebase:', error);
      throw error;
    }
  }

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

} 
