import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import firebase from 'firebase/compat/app';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { FactoryAccessService } from '../../services/factory-access.service';
import { FgExportService } from '../../services/fg-export.service';
import { FgInService } from '../../services/fg-in.service';
import { ReadTrackerService } from '../../services/read-tracker.service';
import { FgDailyBackupService } from '../../services/fg-daily-backup.service';
import { TpCatalogFullService } from '../../services/tp-catalog-full.service';
import { CartonPackingQtyService } from '../../services/carton-packing-qty.service';
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
  /** Vị trí kiểm kê (scan từ FG Location), không đè cột Vị trí gốc */
  viTriKK?: string;
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
  /** Mã TP (7 ký tự, tự tìm) hoặc Vị trí / Khách hàng (bấm Search). */
  searchMode: 'material' | 'location' | 'customer' = 'material';
  searchStatus: 'idle' | 'typing' | 'searching' | 'found' | 'not-found' | 'non-stock-only' = 'idle';
  /** Ba ô filter UI (đồng bộ với searchTerm + searchMode). */
  filterMaTp = '';
  filterLocation = '';
  filterCustomer = '';

  // Pagination (client-side trên filteredMaterials)
  pageSize = 20;
  currentPage = 1;
  readonly pageSizeOptions = [20, 50, 100, 200];
  lastUpdatedAt: Date | null = null;
  
  // Factory filter — mặc định ASM1 (không dùng TOTAL khi mở tab)
  selectedFactory: string = 'ASM1';
  availableFactories: string[] = ['ASM1', 'ASM2', 'TOTAL'];

  // Catalog data (loaded once)
  catalogItems: ProductCatalogItem[] = [];
  catalogLoaded: boolean = false;

  /** Lượng Đóng Thùng (danh mục riêng của Kho) — key = 7 ký tự đầu Mã TP, dùng để tính Carton cho dòng Tồn đầu (batch TDAU). */
  cartonPackingQtyMap: Map<string, number> = new Map();

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

  // Location (Vị trí) report modal — tổng hợp số mã đã tick KK / chưa tick theo từng vị trí
  showLocationReportModal: boolean = false;
  isLoadingLocationReport: boolean = false;
  locationReportRows: Array<{ location: string; totalCount: number; checkedCount: number; uncheckedCount: number }> = [];

  showCustomerSummaryModal: boolean = false;
  isLoadingCustomerSummary: boolean = false;
  customerSummaryRows: Array<{ customer: string; totalCarton: number }> = [];

  // Sửa vị trí (bấm vào ô Vị trí) — nhập tay hoặc "Chuyển ASM3" chọn từ danh sách vị trí kho ASM3
  showLocationEditModal: boolean = false;
  locationEditMaterial: FGInventoryItem | null = null;
  locationEditDraft: string = '';
  showAsm3PositionPicker: boolean = false;
  readonly asm3PositionRows: string[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
  readonly asm3PositionIndexes: number[] = Array.from({ length: 60 }, (_, i) => i + 1);

  // Factory menu popup
  showFactoryMenu: boolean = false;

  // Import progress dialog (hiển thị trong quá trình import)
  showImportProgressDialog: boolean = false;
  importMode: 'tonDau' | 'addMaTp' = 'tonDau';
  importProgressCurrentBatch: number = 0;
  importProgressTotalBatches: number = 0;
  importProgressImportedCount: number = 0;
  importProgressTotalCount: number = 0;

  // Import success dialog
  showImportSuccessDialog: boolean = false;
  importSuccessCount: number = 0;
  importSkippedCount: number = 0;  // Số dòng bỏ qua do trùng
  importSkippedFactoryCount: number = 0; // Add mã TP: bỏ qua do khác nhà máy đang xem

  // Add mã TP dialog
  showAddMaTpDialog: boolean = false;

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
    private cdr: ChangeDetectorRef,
    private readTracker: ReadTrackerService,
    private fgDailyBackup: FgDailyBackupService,
    private router: Router,
    private tpCatalogService: TpCatalogFullService,
    private cartonPackingQtyService: CartonPackingQtyService
  ) {}

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  get pagedMaterials(): FGInventoryItem[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredMaterials.slice(start, start + this.pageSize);
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredMaterials.length / this.pageSize) || 1);
  }

  get pageStartIndex(): number {
    if (!this.filteredMaterials.length) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageEndIndex(): number {
    return Math.min(this.currentPage * this.pageSize, this.filteredMaterials.length);
  }

  get pageNumbers(): Array<number | '...'> {
    const total = this.totalPages;
    const current = this.currentPage;
    if (total <= 7) {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    const pages: Array<number | '...'> = [1];
    if (current > 3) pages.push('...');
    const start = Math.max(2, current - 1);
    const end = Math.min(total - 1, current + 1);
    for (let p = start; p <= end; p++) pages.push(p);
    if (current < total - 2) pages.push('...');
    pages.push(total);
    return pages;
  }

  setPage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
  }

  onPageSizeChange(): void {
    this.currentPage = 1;
  }

  markUpdatedNow(): void {
    this.lastUpdatedAt = new Date();
  }

  formatLastUpdated(): string {
    if (!this.lastUpdatedAt) return '—';
    const d = this.lastUpdatedAt;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  onFilterMaTpChange(value: string): void {
    this.filterMaTp = String(value || '').toUpperCase();
    this.filterLocation = '';
    this.filterCustomer = '';
    this.searchMode = 'material';
    this.searchTerm = this.filterMaTp;
    this.currentPage = 1;
    this.onSearchChange({ target: { value: this.filterMaTp } } as any);
  }

  onFilterLocationChange(value: string): void {
    this.filterLocation = String(value || '').toUpperCase();
    this.filterMaTp = '';
    this.filterCustomer = '';
    this.searchMode = 'location';
    this.searchTerm = this.filterLocation;
    this.currentPage = 1;
    this.onSearchChange({ target: { value: this.filterLocation } } as any);
  }

  onFilterCustomerChange(value: string): void {
    this.filterCustomer = String(value || '').toUpperCase();
    this.filterMaTp = '';
    this.filterLocation = '';
    this.searchMode = 'customer';
    this.searchTerm = this.filterCustomer;
    this.currentPage = 1;
    this.onCustomerSelected(this.filterCustomer);
  }

  clearFilterCustomer(): void {
    this.filterCustomer = '';
    this.searchTerm = '';
    this.searchStatus = 'idle';
    this.filteredMaterials = [];
    this.currentPage = 1;
  }

  clearFilterMaTp(): void {
    this.filterMaTp = '';
    if (this.searchMode === 'material') {
      this.searchTerm = '';
      this.searchStatus = 'idle';
      this.filteredMaterials = [];
      this.currentPage = 1;
    }
  }

  clearFilterLocation(): void {
    this.filterLocation = '';
    if (this.searchMode === 'location') {
      this.searchTerm = '';
      this.searchStatus = 'idle';
      this.filteredMaterials = [];
      this.currentPage = 1;
    }
  }

  /** Chỉ cho sửa "Tồn đầu" với dòng import tồn đầu (batch TDAU1-/TDAU2-) */
  isTonDauEditable(material: FGInventoryItem): boolean {
    const batch = (material?.batchNumber || '').toString().trim().toUpperCase();
    return batch.startsWith('TDAU1-') || batch.startsWith('TDAU2-');
  }

  ngOnInit(): void {
    this.setupDebouncedSearch();
    this.loadCatalogFromFirebase();
    this.loadCartonPackingQty();
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
      debounceTime(400),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe((searchTerm) => {
      void this.runInventorySearch(searchTerm);
    });
  }

  private mapDocToInventoryItem(id: string, data: any): FGInventoryItem {
    const tonDau = data.tonDau || 0;
    const nhap = data.nhap || data.quantity || 0;
    const xuat = data.xuat || data.exported || 0;
    const ton = data.ton != null ? data.ton : data.stock != null ? data.stock : tonDau + nhap - xuat;

    const toDate = (v: any) => {
      if (!v) return new Date();
      if (typeof v?.toDate === 'function') return v.toDate();
      if (v?.seconds != null) return new Date(v.seconds * 1000);
      return v instanceof Date ? v : new Date(v);
    };

    return {
      id,
      factory: data.factory || 'ASM1',
      importDate: toDate(data.importDate),
      receivedDate: toDate(data.receivedDate),
      batchNumber: data.batchNumber || '',
      materialCode: data.materialCode || data.maTP || '',
      lot: data.lot || data.Lot || '',
      lsx: data.lsx || data.LSX || '',
      quantity: data.quantity || 0,
      standard: data.standard || 0,
      carton: data.carton || 0,
      odd: data.odd || 0,
      tonDau,
      nhap,
      xuat,
      ton,
      location: data.location || data.viTri || 'Temp-1',
      viTriKK: data.viTriKK || data.locationKK || '',
      notes: data.notes || data.ghiChu || '',
      customer: data.customer || data.khach || '',
      poNumber: data.poNumber || data.soPO || '',
      isReceived: data.isReceived || false,
      isCompleted: data.isCompleted || false,
      isDuplicate: data.isDuplicate || false,
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt)
    };
  }

  /** Tìm theo mã TP khi đủ 7 ký tự — query Firestore, không load full collection. */
  async runInventorySearch(termRaw: string): Promise<void> {
    const term = String(termRaw || '').trim().toUpperCase();
    this.searchTerm = term;

    if (term.length < 7) {
      this.searchStatus = 'typing';
      this.filteredMaterials = [];
      this.cdr.detectChanges();
      return;
    }

    this.isLoading = true;
    this.searchStatus = 'searching';
    this.cdr.detectChanges();

    try {
      const prefixEnd = term + '\uf8ff';
      const [byCodeSnap, byMaTpSnap] = await Promise.all([
        this.firestore
          .collection('fg-inventory', (ref) =>
            ref.where('materialCode', '>=', term).where('materialCode', '<=', prefixEnd).limit(300)
          )
          .get()
          .toPromise(),
        this.firestore
          .collection('fg-inventory', (ref) =>
            ref.where('maTP', '>=', term).where('maTP', '<=', prefixEnd).limit(300)
          )
          .get()
          .toPromise()
      ]).catch(async () => {
        const byCodeSnap = await this.firestore
          .collection('fg-inventory', (ref) =>
            ref.where('materialCode', '>=', term).where('materialCode', '<=', prefixEnd).limit(300)
          )
          .get()
          .toPromise();
        return [byCodeSnap, { docs: [] }] as const;
      });

      const readCount = (byCodeSnap?.docs.length || 0) + (byMaTpSnap?.docs.length || 0);
      this.readTracker.track('fg-inventory', 'fg-inventory-search', readCount);

      const merged = new Map<string, FGInventoryItem>();
      for (const doc of [...(byCodeSnap?.docs || []), ...(byMaTpSnap?.docs || [])]) {
        merged.set(doc.id, this.mapDocToInventoryItem(doc.id, doc.data()));
      }

      this.materials = Array.from(merged.values());
      this.applyFilters();

      if (this.filteredMaterials.length > 0) {
        this.searchStatus = 'found';
      } else if (this.materials.length > 0) {
        this.searchStatus = 'non-stock-only';
      } else {
        this.searchStatus = 'not-found';
      }
    } catch (e) {
      console.error('runInventorySearch failed', e);
      this.materials = [];
      this.filteredMaterials = [];
      this.searchStatus = 'not-found';
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  /** Chuẩn hóa vị trí khi search: bỏ dấu chấm (C1.2 ↔ C12). */
  private normalizeLocationSearch(value: string): string {
    return String(value || '').trim().toUpperCase().replace(/\./g, '');
  }

  /**
   * Prefix query Firestore rộng hơn — ví dụ C1.2 và C12 đều query theo C1.
   * Áp dụng cho vị trí kho A/B/C/D.
   */
  private getLocationFirestoreQueryPrefix(term: string): string {
    const norm = this.normalizeLocationSearch(term);
    if (!norm) return '';
    const zoneMatch = norm.match(/^([ABCD])(.*)$/);
    if (zoneMatch) {
      const letter = zoneMatch[1];
      const body = zoneMatch[2] || '';
      if (!body) return letter;
      return letter + body.charAt(0);
    }
    return norm.length <= 2 ? norm : norm.slice(0, 2);
  }

  private locationMatchesSearch(material: FGInventoryItem, term: string): boolean {
    const normTerm = this.normalizeLocationSearch(term);
    if (!normTerm) return true;
    const normLoc = this.normalizeLocationSearch(material.location);
    const normViTri = this.normalizeLocationSearch(material.viTriKK);
    return normLoc.startsWith(normTerm) || normViTri.startsWith(normTerm);
  }

  /** Tìm theo vị trí — bấm Search; hiển thị các mã có tồn tại vị trí đó. */
  async runLocationSearch(locationRaw: string): Promise<void> {
    const loc = String(locationRaw || '').trim().toUpperCase();
    this.searchTerm = loc;

    if (!loc || loc.length < 2) {
      this.searchStatus = 'typing';
      this.filteredMaterials = [];
      this.cdr.detectChanges();
      return;
    }

    this.isLoading = true;
    this.searchStatus = 'searching';
    this.cdr.detectChanges();

    try {
      const queryPrefix = this.getLocationFirestoreQueryPrefix(loc);
      const prefixEnd = queryPrefix + '\uf8ff';
      const [byLocationSnap, byViTriSnap, byViTriKkSnap] = await Promise.all([
        this.firestore
          .collection('fg-inventory', (ref) =>
            ref.where('location', '>=', queryPrefix).where('location', '<=', prefixEnd).limit(300)
          )
          .get()
          .toPromise(),
        this.firestore
          .collection('fg-inventory', (ref) =>
            ref.where('viTri', '>=', queryPrefix).where('viTri', '<=', prefixEnd).limit(300)
          )
          .get()
          .toPromise()
          .catch(() => null),
        this.firestore
          .collection('fg-inventory', (ref) =>
            ref.where('viTriKK', '>=', queryPrefix).where('viTriKK', '<=', prefixEnd).limit(300)
          )
          .get()
          .toPromise()
          .catch(() => null)
      ]);

      const readCount =
        (byLocationSnap?.docs.length || 0) +
        (byViTriSnap?.docs.length || 0) +
        (byViTriKkSnap?.docs.length || 0);
      this.readTracker.track('fg-inventory', 'fg-inventory-location-search', readCount);

      const merged = new Map<string, FGInventoryItem>();
      for (const doc of [
        ...(byLocationSnap?.docs || []),
        ...(byViTriSnap?.docs || []),
        ...(byViTriKkSnap?.docs || [])
      ]) {
        merged.set(doc.id, this.mapDocToInventoryItem(doc.id, doc.data()));
      }

      this.materials = Array.from(merged.values());
      this.applyFilters();

      if (this.filteredMaterials.length > 0) {
        this.searchStatus = 'found';
      } else if (this.materials.length > 0) {
        this.searchStatus = 'non-stock-only';
      } else {
        this.searchStatus = 'not-found';
      }
    } catch (e) {
      console.error('runLocationSearch failed', e);
      this.materials = [];
      this.filteredMaterials = [];
      this.searchStatus = 'not-found';
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  /**
   * Tìm theo Khách hàng — chọn ở dropdown. Không query thẳng field `customer` trên fg-inventory
   * (dữ liệu thô, có thể thiếu/không khớp) mà dò theo đúng cột "Khách hàng" ở tab Danh mục TP
   * (fg-catalog.customer, đã cache sẵn qua catalogItems từ lúc mở tab — KHÔNG dùng mappingItems/
   * fg-customer-mapping vì đó là dữ liệu cũ, import mới không còn ghi vào đó nữa): dò theo cột
   * Mã vật tư (materialCode) để biết Khách hàng, gom lại danh sách Mã TP gốc (7 ký tự) thuộc khách
   * đó. Danh mục TP lưu đúng 7 ký tự gốc, nhưng fg-inventory có thể lưu kèm hậu tố (VD "P013011_0")
   * — nên phải query theo kiểu "bắt đầu bằng" (prefix range), KHÔNG dùng 'in' so khớp tuyệt đối
   * (sẽ không khớp được các dòng có hậu tố).
   */
  async runCustomerSearch(customerRaw: string): Promise<void> {
    const term = String(customerRaw || '').trim().toUpperCase();
    this.searchTerm = term;

    if (!term || term.length < 2) {
      this.searchStatus = 'typing';
      this.filteredMaterials = [];
      this.cdr.detectChanges();
      return;
    }

    this.isLoading = true;
    this.searchStatus = 'searching';
    this.cdr.detectChanges();

    try {
      const matchedCodes = Array.from(
        new Set(
          this.catalogItems
            .filter(c => (c.customer || '').trim().toUpperCase() === term)
            .map(c => (c.materialCode || '').trim().toUpperCase().slice(0, 7))
            .filter(Boolean)
        )
      );

      if (matchedCodes.length === 0) {
        this.materials = [];
        this.filteredMaterials = [];
        this.searchStatus = 'not-found';
        return;
      }

      const snaps = await Promise.all(
        matchedCodes.map(code =>
          this.firestore
            .collection('fg-inventory', ref =>
              ref.where('materialCode', '>=', code).where('materialCode', '<', code + '')
            )
            .get()
            .toPromise()
            .catch(() => null)
        )
      );

      const readCount = snaps.reduce((sum, s) => sum + (s?.docs.length || 0), 0);
      this.readTracker.track('fg-inventory', 'fg-inventory-customer-search', readCount);

      const merged = new Map<string, FGInventoryItem>();
      for (const snap of snaps) {
        (snap?.docs || []).forEach(doc => merged.set(doc.id, this.mapDocToInventoryItem(doc.id, doc.data())));
      }

      this.materials = Array.from(merged.values());
      this.applyFilters();

      if (this.filteredMaterials.length > 0) {
        this.searchStatus = 'found';
      } else if (this.materials.length > 0) {
        this.searchStatus = 'non-stock-only';
      } else {
        this.searchStatus = 'not-found';
      }
    } catch (e) {
      console.error('runCustomerSearch failed', e);
      this.materials = [];
      this.filteredMaterials = [];
      this.searchStatus = 'not-found';
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  setSearchMode(mode: 'material' | 'location' | 'customer'): void {
    if (this.searchMode === mode) return;
    this.searchMode = mode;
    this.clearSearch();
  }

  /** Danh sách tên khách hàng (cột "Khách hàng" ở tab Danh mục TP, theo Mã vật tư) — dùng cho dropdown chọn khi search theo Khách hàng, không cần gõ tay. */
  get customerOptions(): string[] {
    const set = new Set<string>();
    for (const c of this.catalogItems) {
      const name = (c.customer || '').trim();
      if (name) set.add(name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  }

  /** Bấm chọn 1 khách trong dropdown — tìm luôn, không cần bấm Search. */
  onCustomerSelected(value: string): void {
    if (!value) {
      this.clearSearch();
      return;
    }
    void this.runCustomerSearch(value);
  }

  onSearchClick(): void {
    const term = String(this.searchTerm || '').trim().toUpperCase();
    if (!term) return;
    if (this.searchMode === 'location') {
      void this.runLocationSearch(term);
      return;
    }
    if (this.searchMode === 'customer') {
      void this.runCustomerSearch(term);
      return;
    }
    if (term.length >= 7) {
      void this.runInventorySearch(term);
    }
  }

  onSearchKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    this.onSearchClick();
  }
  async loadMaterialsFromFirebase(): Promise<void> {
    this.isLoading = true;

    try {
      const merged = await this.fgDailyBackup.loadMergedDocs('fg-inventory', 'fg-inventory');
      const docs = merged.docs;

      const firebaseMaterials = docs.map((doc) => this.mapDocToInventoryItem(doc.id, doc.data as any));

        this.materials = firebaseMaterials;

        this.sortMaterials();
        this.applyFilters();
        this.isLoading = false;
        this.cdr.detectChanges();
    } catch (e) {
      console.error('loadMaterialsFromFirebase failed', e);
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  /** Làm mới tồn FG + cache fg-in (sau nhập/xuất hoặc bấm Refresh). */
  async refreshInventoryData(): Promise<void> {
    await this.refreshFgInOutCaches();
    await this.loadMaterialsFromFirebase();
    this.markUpdatedNow();
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

  /** 🔧 FIX: chỉ .get() khi mở tab / refresh thủ công — bỏ interval 5 phút. */
  private subscribeFGInOutCaches(): void {
    void this.refreshFgInOutCaches();
  }

  async refreshFgInOutCaches(): Promise<void> {
      try {
        const merged = await this.fgDailyBackup.loadMergedDocs('fg-in', 'fg-inventory');
        const snap = { docs: merged.docs.map((d) => ({ data: () => d.data })) };
        this.fgInQtyByKey.clear();
        this.fgInQtyByBatchKey.clear();
        this.fgInPoByBatchKey.clear();
        (snap?.docs || []).forEach(doc => {
          const d = doc.data() as any;
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
      } catch (e) {
        console.error('refreshFgInOutCaches failed', e);
      }
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
    const trimmedSearch = (this.searchTerm || '').trim();
    if (this.searchMode === 'material' && trimmedSearch.length > 0 && trimmedSearch.length < 7) {
      this.filteredMaterials = [];
      return;
    }

    this.filteredMaterials = this.materials.filter(material => {
      if (this.searchMode === 'material' && this.selectedFactory === 'ASM1' && trimmedSearch.length < 7) {
        return false;
      }

      if (trimmedSearch) {
        const term = trimmedSearch.toUpperCase();
        if (this.searchMode === 'location') {
          if (!this.locationMatchesSearch(material, trimmedSearch)) return false;
        } else if (this.searchMode === 'customer') {
          // Đã lọc đúng theo Khách hàng khi fetch (runCustomerSearch dùng mapping Mã hàng ↔ Khách) — không lọc lại theo text ở đây.
        } else {
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

      // Filter by stock (ton): ẩn ton=0 — chỉ hiện khi bấm Non Stock
      const ton = material.ton ?? 0;
      if (this.showNegativeStock) {
        if (ton >= 0) return false;
      } else if (this.showNonStock) {
        if (ton > 0) return false;
      } else if (ton <= 0) {
        return false;
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

    const maxPage = Math.max(1, Math.ceil(this.filteredMaterials.length / this.pageSize) || 1);
    if (this.currentPage > maxPage) this.currentPage = maxPage;
    this.markUpdatedNow();
  }

  // Search functionality with debouncing
  onSearchChange(event: any): void {
    let searchTerm = event.target.value;

    if (searchTerm && searchTerm !== searchTerm.toUpperCase()) {
      searchTerm = searchTerm.toUpperCase();
      event.target.value = searchTerm;
    }

    if (!searchTerm || searchTerm.trim() === '') {
      this.clearSearch();
      return;
    }

    const trimmed = searchTerm.trim();

    if (this.searchMode === 'location') {
      this.searchTerm = trimmed;
      this.searchStatus = trimmed.length < 2 ? 'typing' : 'idle';
      this.filteredMaterials = [];
      this.cdr.detectChanges();
      return;
    }

    if (trimmed.length < 7) {
      this.searchTerm = trimmed;
      this.searchStatus = 'typing';
      this.filteredMaterials = [];
      this.cdr.detectChanges();
      return;
    }

    if (trimmed.length === 7) {
      void this.runInventorySearch(trimmed);
      return;
    }

    this.searchSubject.next(trimmed);
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.filterMaTp = '';
    this.filterLocation = '';
    this.filterCustomer = '';
    this.filteredMaterials = [];
    this.materials = [];
    this.searchStatus = 'idle';
    this.currentPage = 1;
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
    const term = (this.searchTerm || '').trim();
    if (this.searchMode === 'location' && term.length >= 2) {
      void this.runLocationSearch(term);
      return;
    }
    if (this.searchMode === 'customer' && term.length >= 2) {
      void this.runCustomerSearch(term);
      return;
    }
    if (term.length >= 7) {
      void this.runInventorySearch(this.searchTerm);
      return;
    }
    this.applyFilters();
  }

  /** Số Batch đã chuẩn hóa (trim, uppercase) - mỗi số batch phải riêng biệt trong kho */
  private getBatchNormalized(material: FGInventoryItem): string {
    return String(material.batchNumber || '').trim().toUpperCase();
  }

  /**
   * Nguồn dữ liệu để kiểm tra trùng batch:
   * - Giữ theo factory + date range + trạng thái hiển thị tồn/non-stock/âm
   * - BỎ qua filter search để cảnh báo vẫn hiện ngay cả khi chưa lọc mã TP.
   */
  private getDuplicateCheckSourceMaterials(): FGInventoryItem[] {
    return this.materials.filter(material => {
      // Filter by factory (TOTAL = xem tất cả)
      if (this.selectedFactory && this.selectedFactory !== 'TOTAL') {
        const materialFactory = material.factory || 'ASM1';
        if (materialFactory !== this.selectedFactory) return false;
      }

      // Filter by date range
      if (this.startDate && this.endDate) {
        const importDate = new Date(material.importDate);
        const start = new Date(this.startDate + 'T00:00:00');
        const end = new Date(this.endDate + 'T23:59:59');
        if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
          if (!(importDate >= start && importDate <= end)) return false;
        }
      }

      // Filter by completed status
      if (!(this.showCompleted || !material.isCompleted)) return false;

      // Filter by stock mode
      const ton = material.ton ?? 0;
      if (this.showNegativeStock) {
        if (ton >= 0) return false;
      } else if (this.showNonStock) {
        if (ton > 0) return false;
      } else {
        if (ton <= 0) return false;
      }

      return true;
    });
  }

  /** Danh sách số Batch đang trùng (cùng số batch xuất hiện > 1 lần trong filteredMaterials) */
  getDuplicateBatchKeys(): string[] {
    const countByBatch = new Map<string, number>();
    this.getDuplicateCheckSourceMaterials().forEach(m => {
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
    const source = this.getDuplicateCheckSourceMaterials();
    return keys.map(batchKey => ({
      batchKey,
      materials: source.filter(m => this.getBatchNormalized(m) === batchKey)
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

  isViTriKkChecked(material: FGInventoryItem): boolean {
    return !!String(material.viTriKK || '').trim();
  }

  toggleViTriKk(material: FGInventoryItem, checked: boolean): void {
    if (!material.id || !this.canEditMaterial(material)) {
      return;
    }

    const now = new Date();
    const location = String(material.location || 'TEMPORARY').trim().toUpperCase();

    if (checked) {
      material.viTriKK = location;
      this.firestore.collection('fg-inventory').doc(material.id).update({
        viTriKK: location,
        updatedAt: now,
        kkUpdatedAt: now
      }).then(() => {
        console.log(`viTriKK set for ${material.materialCode}: ${location}`);
      }).catch(error => {
        console.error('Error setting viTriKK:', error);
      });
      return;
    }

    material.viTriKK = '';
    this.firestore.collection('fg-inventory').doc(material.id).update({
      viTriKK: firebase.firestore.FieldValue.delete(),
      updatedAt: now,
      kkUpdatedAt: now
    }).then(() => {
      console.log(`viTriKK cleared for ${material.materialCode}`);
    }).catch(error => {
      console.error('Error clearing viTriKK:', error);
    });
  }

  get locationReportTotalCodes(): number {
    return this.locationReportRows.reduce((sum, r) => sum + r.totalCount, 0);
  }

  get locationReportTotalChecked(): number {
    return this.locationReportRows.reduce((sum, r) => sum + r.checkedCount, 0);
  }

  trackByLocation(_: number, row: { location: string }): string {
    return row.location;
  }

  /** Bấm 1 vị trí trong Báo cáo Vị trí → tìm đúng vị trí đó (giống search vị trí bình thường). */
  viewLocationFromReport(location: string): void {
    this.showLocationReportModal = false;
    this.searchMode = 'location';
    this.searchTerm = location;
    this.filterLocation = location;
    this.filterMaTp = '';
    this.filterCustomer = '';
    this.currentPage = 1;
    void this.runLocationSearch(location);
  }

  /**
   * Báo cáo Vị trí (nút More → Vị trí): với mỗi vị trí, đếm số mã đã tick KK (viTriKK có giá trị)
   * và chưa tick. Chỉ tính mã còn tồn > 0 (mã tồn = 0 không cần kiểm kê). Đọc một lần khi bấm nút
   * (không tự động lặp lại) — đủ theo nhà máy đang chọn.
   */
  async openLocationReportModal(): Promise<void> {
    this.showLocationReportModal = true;
    this.isLoadingLocationReport = true;
    this.locationReportRows = [];
    this.cdr.detectChanges();

    try {
      const snap = await this.firestore
        .collection('fg-inventory', (ref) => {
          let q: firebase.firestore.Query = ref;
          if (this.selectedFactory && this.selectedFactory !== 'TOTAL') {
            q = q.where('factory', '==', this.selectedFactory);
          }
          return q.limit(5000);
        })
        .get()
        .toPromise();

      this.readTracker.track('fg-inventory', 'fg-inventory-location-report', snap?.docs.length || 0);

      const byLocation = new Map<string, { checked: number; unchecked: number }>();
      (snap?.docs || []).forEach((doc) => {
        const item = this.mapDocToInventoryItem(doc.id, doc.data());
        if ((item.ton ?? 0) <= 0) return; // Bỏ qua mã tồn = 0 — không cần kiểm kê
        const location = String(item.location || 'Temporary').trim().toUpperCase() || 'TEMPORARY';
        const cur = byLocation.get(location) || { checked: 0, unchecked: 0 };
        if (this.isViTriKkChecked(item)) {
          cur.checked++;
        } else {
          cur.unchecked++;
        }
        byLocation.set(location, cur);
      });

      this.locationReportRows = Array.from(byLocation.entries())
        .map(([location, v]) => ({
          location,
          totalCount: v.checked + v.unchecked,
          checkedCount: v.checked,
          uncheckedCount: v.unchecked
        }))
        .sort((a, b) => a.location.localeCompare(b.location));
    } catch (e) {
      console.error('openLocationReportModal failed', e);
      this.locationReportRows = [];
    } finally {
      this.isLoadingLocationReport = false;
      this.cdr.detectChanges();
    }
  }

  /**
   * Tổng hợp Carton theo Khách hàng (nút More → Khách hàng): với mỗi khách (Tên Khách Hàng từ
   * Customer Code Mapping), cộng dồn Carton của các mã còn tồn > 0. Đọc một lần khi bấm nút,
   * theo nhà máy đang chọn — giống openLocationReportModal.
   */
  async openCustomerSummaryModal(): Promise<void> {
    this.showCustomerSummaryModal = true;
    this.isLoadingCustomerSummary = true;
    this.customerSummaryRows = [];
    this.cdr.detectChanges();

    try {
      const snap = await this.firestore
        .collection('fg-inventory', (ref) => {
          let q: firebase.firestore.Query = ref;
          if (this.selectedFactory && this.selectedFactory !== 'TOTAL') {
            q = q.where('factory', '==', this.selectedFactory);
          }
          return q.limit(5000);
        })
        .get()
        .toPromise();

      this.readTracker.track('fg-inventory', 'fg-inventory-customer-summary', snap?.docs.length || 0);

      const byCustomer = new Map<string, number>();
      (snap?.docs || []).forEach((doc) => {
        const item = this.mapDocToInventoryItem(doc.id, doc.data());
        if ((item.ton ?? 0) <= 0) return; // Bỏ qua mã tồn = 0
        const customer = this.getCustomerNameFromMapping(item.materialCode).trim() || 'Không xác định';
        byCustomer.set(customer, (byCustomer.get(customer) || 0) + (item.carton || 0));
      });

      this.customerSummaryRows = Array.from(byCustomer.entries())
        .map(([customer, totalCarton]) => ({ customer, totalCarton }))
        .sort((a, b) => b.totalCarton - a.totalCarton);
    } catch (e) {
      console.error('openCustomerSummaryModal failed', e);
      this.customerSummaryRows = [];
    } finally {
      this.isLoadingCustomerSummary = false;
      this.cdr.detectChanges();
    }
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
      // Đọc thẳng Firestore để biết batch TDAU lớn nhất đã có — tránh sinh trùng batch với các lần
      // import trước (trước đây luôn bắt đầu lại từ 000001 mỗi lần import).
      const startSeqByFactory = {
        ASM1: await this.getNextTdauBatchSeq('ASM1'),
        ASM2: await this.getNextTdauBatchSeq('ASM2')
      };
      const materials = this.parseExcelData(rawData, startSeqByFactory);
      await this.runInventoryImport(materials, 'tonDau');

    } catch (error) {
      console.error('Error processing Excel file:', error);
      this.isLoading = false;
      this.showImportProgressDialog = false;
      alert(`❌ Lỗi khi import file Excel: ${error.message || error}`);
    }
  }

  /**
   * Số thứ tự tiếp theo cho batch TDAU (Tồn đầu) theo nhà máy — đọc thẳng Firestore (không dựa vào
   * this.materials vì đó chỉ là kết quả search hiện tại, có thể chưa chứa hết batch TDAU đã có) để
   * đảm bảo không sinh trùng batch với các lần import trước.
   */
  private async getNextTdauBatchSeq(factory: string): Promise<number> {
    const prefix = (factory === 'ASM2' ? 'TDAU2-' : 'TDAU1-').toUpperCase();
    try {
      const snap = await this.firestore
        .collection('fg-inventory', ref =>
          ref
            .where('batchNumber', '>=', prefix + '000000')
            .where('batchNumber', '<=', prefix + '999999')
            .orderBy('batchNumber', 'desc')
            .limit(1)
        )
        .get()
        .toPromise();
      const doc = snap?.docs?.[0];
      if (!doc) return 1;
      const b = String((doc.data() as any)?.batchNumber || '').trim().toUpperCase();
      const n = parseInt(b.slice(prefix.length), 10);
      return !isNaN(n) ? n + 1 : 1;
    } catch (e) {
      console.error('getNextTdauBatchSeq failed', e);
      return 1;
    }
  }

  openAddMaTpDialog(): void {
    this.showAddMaTpDialog = true;
  }

  closeAddMaTpDialog(): void {
    this.showAddMaTpDialog = false;
  }

  importAddMaTpFile(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,.xls';
    fileInput.style.display = 'none';

    fileInput.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.closeAddMaTpDialog();
        this.processAddMaTpExcelFile(file);
      }
    };

    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
  }

  private async processAddMaTpExcelFile(file: File): Promise<void> {
    try {
      this.isLoading = true;
      this.importSkippedFactoryCount = 0;
      const rawData = await this.readExcelFile(file);
      const materials = this.parseAddMaTpExcelData(rawData);

      if (materials.length === 0) {
        this.isLoading = false;
        alert('⚠️ Không có dòng hợp lệ để import. Kiểm tra lại file Excel và nhà máy đang chọn.');
        return;
      }

      await this.runInventoryImport(materials, 'addMaTp');
    } catch (error: any) {
      console.error('Error processing Add mã TP file:', error);
      this.isLoading = false;
      this.showImportProgressDialog = false;
      alert(`❌ Lỗi khi import Add mã TP: ${error?.message || error}`);
    }
  }

  private async runInventoryImport(materials: FGInventoryItem[], mode: 'tonDau' | 'addMaTp'): Promise<void> {
    materials.forEach(m => {
      const catalogItem = this.catalogItems.find(c => c.materialCode === m.materialCode);
      const standard = catalogItem?.standard ? parseFloat(String(catalogItem.standard)) : 0;
      m.standard = standard;
      const qtyBase = mode === 'tonDau' ? m.tonDau : m.nhap;
      if (standard > 0 && qtyBase > 0) {
        m.carton = Math.floor(qtyBase / standard);
        m.odd = qtyBase % standard;
      }
    });

    this.importMode = mode;
    const totalBatches = Math.ceil(materials.length / this.IMPORT_CHUNK_SIZE);
    this.importProgressTotalBatches = totalBatches;
    this.importProgressTotalCount = materials.length;
    this.importProgressCurrentBatch = 0;
    this.importProgressImportedCount = 0;
    this.showImportProgressDialog = true;
    this.cdr.detectChanges();

    await this.saveMaterialsToFirebase(materials, mode);

    this.showImportProgressDialog = false;
    this.isLoading = false;
    this.importSuccessCount = materials.length - this.importSkippedCount;
    this.showImportSuccessDialog = true;
    this.cdr.detectChanges();
  }

  closeImportSuccessDialog(): void {
    this.showImportSuccessDialog = false;
    this.importSuccessCount = 0;
    this.importSkippedFactoryCount = 0;
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
  // startSeqByFactory: số thứ tự bắt đầu (đã trừ trùng với batch cũ) — xem getNextTdauBatchSeq().
  private parseExcelData(
    rawData: any[][],
    startSeqByFactory: Record<string, number> = { ASM1: 1, ASM2: 1 }
  ): FGInventoryItem[] {
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
    const seqByFactory: Record<string, number> = { ASM1: 1, ASM2: 1, ...startSeqByFactory };
    mergedMap.forEach((item) => {
      const factory = item.factory || 'ASM1';
      const prefix = factory === 'ASM2' ? 'TDAU2' : 'TDAU1';
      const seq = seqByFactory[factory] || 1;
      seqByFactory[factory] = seq + 1;
      const notes = item.notes.filter(n => n).join('; ');
      // Tính Carton/ODD ngay lúc import theo Lượng Đóng Thùng/SL SP thùng ở Danh mục TP — không cần
      // đợi sửa Tồn đầu hoặc bấm "Tính Tồn" mới có carton đúng.
      const packingQty = this.getPackingQtyForTdau(item.materialCode);
      const carton = packingQty > 0 ? Math.ceil(item.tonDau / packingQty) : 0;
      const odd = packingQty > 0 ? item.tonDau % packingQty : 0;
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
        carton,
        odd,
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

  // Add mã TP — A=Nhà máy, B=Mã TP, C=LOT, D=LSX, E=PO, F=Lượng, G=Vị trí
  private parseAddMaTpExcelData(rawData: any[][]): FGInventoryItem[] {
    const rows = rawData.filter(r => r && r.length > 0);
    let startIndex = 0;
    if (rows.length > 0 && this.isAddMaTpHeaderRow(rows[0])) {
      startIndex = 1;
    }

    const mergedMap = new Map<string, {
      factory: string;
      materialCode: string;
      lot: string;
      lsx: string;
      poNumber: string;
      location: string;
      quantity: number;
    }>();

    for (let i = startIndex; i < rows.length; i++) {
      const row = rows[i];
      const factory = this.normalizeImportFactory(String(row[0] || '').trim());
      const materialCode = String(row[1] || '').trim().toUpperCase();
      const lot = String(row[2] || '').trim().toUpperCase();
      const lsx = String(row[3] || '').trim().toUpperCase();
      const poNumber = String(row[4] || '').trim();
      const quantity = this.parseImportQuantity(row[5]);
      const location = String(row[6] || '').trim().toUpperCase() || 'TEMPORARY';

      if (!materialCode || quantity <= 0) continue;

      if (this.selectedFactory !== 'TOTAL' && factory !== this.selectedFactory) {
        this.importSkippedFactoryCount++;
        continue;
      }

      const key = `${factory}|${materialCode}|${lot}|${lsx}|${location}|${poNumber}`.toUpperCase();
      const existing = mergedMap.get(key);
      if (existing) {
        existing.quantity += quantity;
      } else {
        mergedMap.set(key, { factory, materialCode, lot, lsx, poNumber, location, quantity });
      }
    }

    const seqByFactory: Record<string, number> = {
      ASM1: this.getNextAddMaTpBatchSeq('ASM1'),
      ASM2: this.getNextAddMaTpBatchSeq('ASM2')
    };

    const materials: FGInventoryItem[] = [];
    mergedMap.forEach(item => {
      const factory = item.factory || 'ASM1';
      const prefix = factory === 'ASM2' ? 'ADDMA2-' : 'ADDMA1-';
      const seq = seqByFactory[factory] || 1;
      seqByFactory[factory] = seq + 1;

      materials.push({
        factory,
        importDate: new Date(),
        receivedDate: new Date(),
        batchNumber: `${prefix}${seq.toString().padStart(6, '0')}`,
        materialCode: item.materialCode,
        lot: item.lot,
        lsx: item.lsx,
        poNumber: item.poNumber,
        quantity: item.quantity,
        standard: 0,
        carton: 0,
        odd: 0,
        tonDau: 0,
        nhap: item.quantity,
        xuat: 0,
        ton: item.quantity,
        location: item.location,
        notes: 'Import Add mã TP',
        customer: this.getCustomerNameFromMapping(item.materialCode),
        isReceived: true,
        isCompleted: false,
        isDuplicate: false,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });

    return materials;
  }

  private isAddMaTpHeaderRow(row: any[]): boolean {
    if (!row || row.length === 0) return true;
    const colA = String(row[0] || '').toLowerCase();
    const colB = String(row[1] || '').toLowerCase();
    return colA.includes('nhà máy') || colA.includes('factory') ||
      colB.includes('mã') || colB.includes('ma tp') || colB.includes('material');
  }

  private normalizeImportFactory(factory: string): string {
    const f = (factory || 'ASM1').toUpperCase();
    if (f === 'ASM2') return 'ASM2';
    return 'ASM1';
  }

  private parseImportQuantity(value: any): number {
    if (typeof value === 'number' && !isNaN(value)) return Math.max(0, Math.floor(value));
    const s = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
    const n = parseFloat(s);
    return !isNaN(n) && n > 0 ? Math.floor(n) : 0;
  }

  private getNextAddMaTpBatchSeq(factory: string): number {
    const prefix = (factory === 'ASM2' ? 'ADDMA2-' : 'ADDMA1-').toUpperCase();
    let max = 0;
    this.materials.forEach(m => {
      const b = String(m.batchNumber || '').trim().toUpperCase();
      if (!b.startsWith(prefix)) return;
      const n = parseInt(b.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return max + 1;
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

  async saveMaterialsToFirebase(materials: FGInventoryItem[], mode: 'tonDau' | 'addMaTp' = 'tonDau'): Promise<void> {
    let batchIndex = 0;
    let savedCount = 0;
    this.importSkippedCount = 0;
    
    for (let i = 0; i < materials.length; i += this.IMPORT_CHUNK_SIZE) {
      const chunk = materials.slice(i, i + this.IMPORT_CHUNK_SIZE);
      batchIndex++;
      
      for (const material of chunk) {
        const exists = mode === 'addMaTp'
          ? await this.checkDuplicateAddMaTpExists(material)
          : await this.checkDuplicateExists(material);
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
        if (material.poNumber) {
          materialData.poNumber = material.poNumber;
        }

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

  /** Trùng Add mã TP: Nhà máy + Mã TP + LOT + LSX + Lượng + Vị trí */
  private async checkDuplicateAddMaTpExists(material: FGInventoryItem): Promise<boolean> {
    const snapshot = await this.firestore.collection('fg-inventory', ref =>
      ref.where('materialCode', '==', material.materialCode || '')
         .where('lot', '==', material.lot || '')
         .where('lsx', '==', material.lsx || '')
         .where('nhap', '==', material.nhap)
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

  downloadAddMaTpTemplate(): void {
    const templateData = [
      ['Nhà máy', 'Mã TP', 'LOT', 'LSX', 'PO', 'Lượng', 'Vị trí'],
      ['ASM1', 'P001001_K001', 'LOT001', 'KZLSX0126/0001', 'PO12345', 100, 'A1-01'],
      ['ASM1', 'P002002_K002', 'LOT002', 'KZLSX0126/0002', '', 200, 'A1-02'],
      ['ASM2', 'P003003_K003', 'LOT003', 'LHLSX0226/0001', 'PO67890', 150, 'B1-01']
    ];

    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = XLSX.utils.aoa_to_sheet(templateData);
    ws['!cols'] = [
      { wch: 10 },
      { wch: 16 },
      { wch: 12 },
      { wch: 18 },
      { wch: 12 },
      { wch: 10 },
      { wch: 12 }
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Add ma TP');
    XLSX.writeFile(wb, 'FG_Inventory_AddMaTP_Template.xlsx');
  }

  /** Chuẩn hóa các biến thể tạm (Tem1/tem-1/temp1/Temporary…) về Temp-1/Temp-2/Temp-3.
   *  Vị trí thật (không khớp biến thể tạm nào) được giữ nguyên (viết hoa). */
  private normalizeFgLocationValue(raw: string | undefined | null): string {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) return '';
    const compact = trimmed.toUpperCase().replace(/[\s_-]+/g, '');
    if (compact === 'TEMPORARY') return 'Temp-1';
    const zoneMatch = compact.match(/^(?:TEMPORARY|TEMP|TEM|TAM)([123])$/);
    if (zoneMatch) return `Temp-${zoneMatch[1]}`;
    return trimmed.toUpperCase();
  }

  // Additional methods needed for the component
  editLocation(material: FGInventoryItem): void {
    this.locationEditMaterial = material;
    this.locationEditDraft = material.location || '';
    this.showAsm3PositionPicker = false;
    this.showLocationEditModal = true;
  }

  /** Đóng modal sửa vị trí — nếu đang ở bước chọn vị trí ASM3 thì lùi về bước nhập tay trước. */
  closeLocationEditModal(): void {
    if (this.showAsm3PositionPicker) {
      this.showAsm3PositionPicker = false;
      return;
    }
    this.showLocationEditModal = false;
    this.locationEditMaterial = null;
    this.locationEditDraft = '';
  }

  /** Lưu vị trí nhập tay (không qua ASM3). */
  saveLocationEdit(): void {
    if (!this.locationEditMaterial) return;
    const material = this.locationEditMaterial;
    material.location = this.normalizeFgLocationValue(this.locationEditDraft);
    material.updatedAt = new Date();
    console.log(`Updated location for ${material.materialCode}: ${material.location}`);
    this.updateMaterialInFirebase(material);
    this.showLocationEditModal = false;
    this.locationEditMaterial = null;
    this.locationEditDraft = '';
  }

  openAsm3PositionPicker(): void {
    this.showAsm3PositionPicker = true;
  }

  /** Bấm chọn 1 vị trí ASM3 (VD A1, B23...) — cập nhật thẳng vị trí, dạng "WH3-{Dãy}{Số}". */
  selectAsm3Position(row: string, index: number): void {
    if (!this.locationEditMaterial) return;
    const material = this.locationEditMaterial;
    material.location = `WH3-${row}${index}`;
    material.updatedAt = new Date();
    console.log(`Updated location for ${material.materialCode}: ${material.location}`);
    this.updateMaterialInFirebase(material);
    this.showAsm3PositionPicker = false;
    this.showLocationEditModal = false;
    this.locationEditMaterial = null;
    this.locationEditDraft = '';
  }



  updateNotes(material: FGInventoryItem): void {
    console.log('Updating notes for material:', material.materialCode, 'to:', material.notes);
    this.updateMaterialInFirebase(material);
  }

  // Scan location using QR code
  scanLocation(material: FGInventoryItem): void {
    const dialogData: QRScannerData = {
      title: `Scan QR Code - Đổi vị trí cho ${material.materialCode}`,
      message: `Vị trí hiện tại: ${material.location || 'Temp-1'}`,
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
        material.location = this.normalizeFgLocationValue(result);
        
        // Update in Firebase
        this.updateMaterialInFirebase(material);
        
        console.log(`Updated location for ${material.materialCode}: ${oldLocation} → ${result}`);
        alert(`✅ Đã cập nhật vị trí cho ${material.materialCode}: ${result}`);
      }
    });
  }

  // Load catalog — dùng cache dùng chung (TpCatalogFullService) thay vì tự đọc thẳng fg-catalog
  loadCatalogFromFirebase(): void {
    if (this.catalogLoaded) {
      return; // Already loaded
    }

    this.tpCatalogService
      .getCatalogItemsCached()
      .then(items => {
        this.catalogItems = items;
        this.catalogLoaded = true;
        console.log('Catalog loaded (cached):', this.catalogItems.length, 'items');
      })
      .catch(err => console.error('Load fg-catalog (cached) failed:', err));
  }

  /**
   * Lấy Tên khách hàng theo Mã TP — dò trên cột "Khách hàng" ở tab Danh mục TP (catalogItems, từ
   * fg-catalog). Không dùng mappingItems (fg-customer-mapping) vì đó là dữ liệu cũ, import mới
   * không còn ghi vào đó nữa. Mã TP luôn có dạng P + 6 số (7 ký tự); Mã vật tư ở Danh mục TP có thể
   * kèm hậu tố theo khách (VD "P001005_C") nên chỉ so 7 ký tự đầu của cả 2 bên.
   */
  getCustomerNameFromMapping(materialCode: string): string {
    const code7 = String(materialCode || '').trim().toUpperCase().slice(0, 7);
    if (!code7) return '';
    const catalogItem = this.catalogItems.find(
      c => (c.materialCode || '').trim().toUpperCase().slice(0, 7) === code7
    );
    return catalogItem ? (catalogItem.customer || '') : '';
  }

  /** Lượng Đóng Thùng — danh mục riêng của Kho (collection carton-packing-qty), key = Mã TP. */
  async loadCartonPackingQty(forceRefresh = false): Promise<void> {
    try {
      this.cartonPackingQtyMap = await this.cartonPackingQtyService.loadAllAsMap(forceRefresh);
    } catch (err) {
      console.error('Load carton-packing-qty failed:', err);
    }
  }

  /**
   * SL SP/thùng dùng để tính Carton cho dòng Tồn đầu (batch TDAU1-/TDAU2-): ưu tiên Lượng Đóng Thùng
   * (danh mục riêng của Kho) nếu có; không có thì lấy SL SP/thùng ở Danh mục TP. So theo 7 ký tự đầu
   * Mã TP vì cả 2 nguồn đều lưu đúng mã gốc, còn material.materialCode ở dòng TDAU có thể kèm hậu tố
   * tùy file import (VD "P013011_0").
   */
  private getPackingQtyForTdau(materialCode: string): number {
    const code7 = String(materialCode || '').trim().toUpperCase().slice(0, 7);
    if (!code7) return 0;
    const override = this.cartonPackingQtyMap.get(code7);
    if (override && override > 0) return override;
    const catalogItem = this.catalogItems.find(
      c => (c.materialCode || '').trim().toUpperCase().slice(0, 7) === code7
    );
    const standard = catalogItem ? parseFloat(catalogItem.standard) : NaN;
    return !isNaN(standard) && standard > 0 ? standard : 0;
  }

  /**
   * Carton hiển thị trên bảng — tính trực tiếp lúc render cho dòng Tồn đầu (TDAU) thay vì chỉ đọc
   * material.carton đã lưu (nhiều dòng cũ import trước khi có Lượng Đóng Thùng vẫn đang lưu 0).
   */
  getDisplayCarton(material: FGInventoryItem): number {
    if (this.isTonDauEditable(material)) {
      const packingQty = this.getPackingQtyForTdau(material.materialCode);
      return packingQty > 0 ? Math.ceil((material.ton || 0) / packingQty) : 0;
    }
    return material.carton || 0;
  }

  /** ODD hiển thị trên bảng — cùng cách tính với getDisplayCarton (xem giải thích ở đó). */
  getDisplayOdd(material: FGInventoryItem): number {
    if (this.isTonDauEditable(material)) {
      const packingQty = this.getPackingQtyForTdau(material.materialCode);
      return packingQty > 0 ? (material.ton || 0) % packingQty : 0;
    }
    return material.odd || 0;
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

    // Dòng Tồn đầu (batch TDAU): tính Carton theo Lượng Đóng Thùng/SL SP thùng ở Danh mục TP,
    // không dùng material.standard (thường = 0 vì đây là dòng import tồn đầu, không qua FG In).
    if (this.isTonDauEditable(material)) {
      const packingQty = this.getPackingQtyForTdau(material.materialCode);
      if (packingQty > 0) {
        material.carton = Math.ceil(material.ton / packingQty);
        material.odd = material.ton % packingQty;
      }
    } else if (material.standard > 0) {
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

        // Recalculate Carton/ODD based on new Tồn — dòng Tồn đầu (TDAU) dùng Lượng Đóng Thùng/SL SP
        // thùng ở Danh mục TP thay vì material.standard.
        if (this.isTonDauEditable(material)) {
          const packingQty = this.getPackingQtyForTdau(material.materialCode);
          if (packingQty > 0) {
            material.carton = Math.ceil(material.ton / packingQty);
            material.odd = material.ton % packingQty;
          }
        } else if (material.standard > 0) {
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
      'Vị trí KK': m.viTriKK || '',
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
    this.filterMaTp = '';
    this.filterLocation = '';
    this.filterCustomer = '';
    this.startDate = '2020-01-01';
    this.endDate = '2030-12-31';
    this.showCompleted = true;
    this.showNonStock = false;
    this.showNegativeStock = false;
    this.selectedFactory = 'TOTAL';
    this.currentPage = 1;
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


