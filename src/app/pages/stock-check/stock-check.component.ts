import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject } from 'rxjs';
import { takeUntil, first, filter, skip } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import * as firebase from 'firebase/compat/app';
import { environment } from '../../../environments/environment';

interface StockCheckMaterial {
  stt: number;
  materialCode: string;
  poNumber: string;
  imd: string;
  stock: number;
  location: string;
  actualLocation?: string; // Vị trí thực tế (scan)
  standardPacking?: string;
  stockCheck: string;
  qtyCheck: number | null;
  idCheck: string;
  dateCheck: Date | null;
  
  // Original data from inventory
  openingStock?: number;
  quantity: number;
  exported?: number;
  xt?: number;
  importDate?: Date;
  batchNumber?: string;
  
  // Flag để đánh dấu material được thêm mới khi scan (không có trong tồn kho)
  isNewMaterial?: boolean;
  
  // Thông tin đổi vị trí
  locationChangeInfo?: {
    hasChanged: boolean; // Đã đổi vị trí hay chưa
    newLocation: string; // Vị trí mới (hiện tại)
    changeDate?: Date; // Ngày đổi vị trí
    changedBy?: string; // Người đổi (nếu có)
  };
  // KHSX: có trong danh sách KHSX hay không
  hasKhsx?: boolean;
}

interface StockCheckData {
  factory: string;
  materialCode: string;
  poNumber: string;
  imd: string;
  stockCheck: string;
  qtyCheck: number;
  idCheck: string;
  dateCheck: any;
  updatedAt: any;
  checkHistory?: CheckHistoryItem[];
}

interface CheckHistoryItem {
  idCheck: string;
  qtyCheck: number;
  dateCheck: any;
  updatedAt: any;
}

@Component({
  selector: 'app-stock-check',
  templateUrl: './stock-check.component.html',
  styleUrls: ['./stock-check.component.scss']
})
export class StockCheckComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private dataSubscription: any = null; // Track subscription để có thể unsubscribe
  private snapshotSubscription: any = null; // Track snapshot subscription để reload khi có thay đổi
  private isInitialDataLoaded: boolean = false; // Track xem đã load initial data chưa
  
  // Factory selection
  selectedFactory: 'ASM1' | 'ASM2' | null = null;
  
  // Data
  allMaterials: StockCheckMaterial[] = [];
  filteredMaterials: StockCheckMaterial[] = [];
  displayedMaterials: StockCheckMaterial[] = [];
  
  // Pagination
  currentPage = 1;
  itemsPerPage = 50;
  totalPages = 1;
  
  // Loading state
  isLoading = false;
  
  // Employee login
  currentEmployeeId: string = ''; // Mã nhân viên đang đăng nhập
  showEmployeeScanModal = false; // Modal scan mã nhân viên
  employeeScanInput = ''; // Input scan mã nhân viên
  
  // Scanner
  scanStep: 'idle' | 'employee' | 'location' | 'material' = 'idle';
  scannedEmployeeId = '';
  showScanModal = false;
  scanMessage = '';
  scanInput = '';
  scanHistory: string[] = [];
  currentScanLocation: string = ''; // Vị trí hiện tại đang kiểm kê
  locationMaterials: StockCheckMaterial[] = []; // Danh sách NVL theo vị trí đang scan (hiển thị dạng box)
  
  // Scan success popup
  showScanSuccessPopup = false;
  scannedMaterialCode = '';
  scannedSTT = 0;
  scannedQty = 0;
  scannedPO = '';
  scannedCount = 0; // Đếm số mã đã scan trong session

  // Filter state
  filterMode: 'all' | 'checked' | 'unchecked' | 'outside' | 'location-change' | 'khsx-unchecked' = 'all';

  // KHSX
  showKhsxDialog: boolean = false;
  khsxCodes: string[] = []; // Danh sách mã có KHSX (loaded từ Firebase)
  
  // Search
  searchInput: string = '';
  
  // Sort mode
  sortMode: 'alphabetical' | 'byDateCheck' = 'alphabetical';
  
  // ID Check Statistics
  idCheckStats: { id: string; count: number }[] = [];
  
  // Material Detail Modal
  showMaterialDetailModal: boolean = false;
  selectedMaterialDetail: StockCheckMaterial | null = null;
  materialCheckHistory: any[] = [];
  
  // Reset modal
  showResetModal = false;
  resetPassword = '';
  isResetting = false;
  
  // History modal (for material history column)
  showHistoryModal: boolean = false;
  selectedMaterialForHistory: StockCheckMaterial | null = null;
  materialHistoryList: any[] = [];
  isLoadingHistory = false;

  // Locations from Location tab (for validation)
  validLocations: string[] = []; // Danh sách vị trí hợp lệ từ Location tab

  // Counters
  get totalMaterials(): number {
    return this.allMaterials.length;
  }

  get checkedMaterials(): number {
    return this.allMaterials.filter(m => m.stockCheck === '✓').length;
  }

  get uncheckedMaterials(): number {
    // 🔧 Công thức: Tổng mã - (Đã kiểm tra + Đổi vị trí)
    // Lưu ý: Nếu 1 mã có ở cả 2 thì chỉ tính 1 lần (không double count)
    const checkedOrLocationChanged = new Set<string>();
    
    this.allMaterials.forEach(m => {
      const key = `${m.materialCode}_${m.poNumber}_${m.imd}`;
      if (m.stockCheck === '✓' || m.locationChangeInfo?.hasChanged === true) {
        checkedOrLocationChanged.add(key);
      }
    });
    
    return this.totalMaterials - checkedOrLocationChanged.size;
  }

  get locationChangedMaterials(): number {
    // Đếm số lượng materials đã đổi vị trí
    return this.allMaterials.filter(m => 
      m.locationChangeInfo?.hasChanged === true
    ).length;
  }

  get outsideStockMaterials(): number {
    // Đếm mã ngoài tồn kho: isNewMaterial = true HOẶC stock = 0
    return this.allMaterials.filter(m => {
      if (m.isNewMaterial === true) return true;
      // Tính stock hiện tại
      const openingStockValue = m.openingStock !== null && m.openingStock !== undefined ? m.openingStock : 0;
      const currentStock = openingStockValue + (m.quantity || 0) - (m.exported || 0) - (m.xt || 0);
      return currentStock === 0 || currentStock < 0;
    }).length;
  }

  /** Số mã có KHSX nhưng chưa được stock check */
  get khsxUncheckedCount(): number {
    return this.allMaterials.filter(m => m.hasKhsx && m.stockCheck !== '✓').length;
  }

  /** Tổng số mã có KHSX */
  get khsxTotalCount(): number {
    return this.allMaterials.filter(m => m.hasKhsx).length;
  }

  /**
   * Set filter mode
   */
  setFilterMode(mode: 'all' | 'checked' | 'unchecked' | 'outside' | 'location-change' | 'khsx-unchecked'): void {
    this.filterMode = mode;
    this.applyFilter();
  }

  /**
   * Toggle sort mode between alphabetical and by date check
   */
  toggleSortMode(): void {
    if (this.sortMode === 'alphabetical') {
      this.sortMode = 'byDateCheck';
    } else {
      this.sortMode = 'alphabetical';
    }
    
    // Sort materials
    this.sortMaterials();
    
    // Update STT after sorting
    this.allMaterials.forEach((mat, index) => {
      mat.stt = index + 1;
    });
    
    // Reapply filter to update displayed materials
    this.applyFilter();
    
    // Reload current page
    this.loadPageFromFiltered(this.currentPage);
    
    this.cdr.detectChanges();
  }

  /**
   * Sort materials based on current sort mode
   */
  private sortMaterials(): void {
    if (this.sortMode === 'alphabetical') {
      // Sort alphabetically by material code
      this.allMaterials.sort((a, b) => a.materialCode.localeCompare(b.materialCode));
    } else {
      // Sort by dateCheck (newest first), then by material code for items without dateCheck
      this.allMaterials.sort((a, b) => {
        // Items with dateCheck come first
        if (a.dateCheck && !b.dateCheck) return -1;
        if (!a.dateCheck && b.dateCheck) return 1;
        
        // Both have dateCheck - sort by newest first
        if (a.dateCheck && b.dateCheck) {
          const dateA = a.dateCheck instanceof Date ? a.dateCheck.getTime() : new Date(a.dateCheck).getTime();
          const dateB = b.dateCheck instanceof Date ? b.dateCheck.getTime() : new Date(b.dateCheck).getTime();
          return dateB - dateA; // Newest first
        }
        
        // Both don't have dateCheck - sort alphabetically
        return a.materialCode.localeCompare(b.materialCode);
      });
    }
  }

  /**
   * Calculate ID check statistics
   */
  calculateIdCheckStats(): void {
    const idMap = new Map<string, number>();
    
    this.allMaterials.forEach(mat => {
      if (mat.idCheck && mat.stockCheck === '✓') {
        const count = idMap.get(mat.idCheck) || 0;
        idMap.set(mat.idCheck, count + 1);
      }
    });
    
    this.idCheckStats = Array.from(idMap.entries())
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Search materials by material code
   */
  onSearchInput(): void {
    if (!this.searchInput.trim()) {
      this.applyFilter();
      return;
    }
    
    const searchTerm = this.searchInput.trim().toUpperCase();
    let filtered = [...this.allMaterials];
    
    // Apply filter mode first
    if (this.filterMode === 'checked') {
      filtered = filtered.filter(m => m.stockCheck === '✓');
    } else if (this.filterMode === 'unchecked') {
      filtered = filtered.filter(m => m.stockCheck !== '✓');
    } else if (this.filterMode === 'outside') {
      filtered = filtered.filter(m => {
        if (m.isNewMaterial === true) return true;
        const openingStockValue = m.openingStock !== null && m.openingStock !== undefined ? m.openingStock : 0;
        const currentStock = openingStockValue + (m.quantity || 0) - (m.exported || 0) - (m.xt || 0);
        return currentStock === 0 || currentStock < 0;
      });
    } else if (this.filterMode === 'location-change') {
      filtered = filtered.filter(m => m.locationChangeInfo?.hasChanged === true);
    } else if (this.filterMode === 'khsx-unchecked') {
      filtered = filtered.filter(m => m.hasKhsx && m.stockCheck !== '✓');
    }
    
    // Then apply search
    filtered = filtered.filter(m => 
      m.materialCode.toUpperCase().includes(searchTerm) ||
      m.poNumber.toUpperCase().includes(searchTerm) ||
      m.imd.toUpperCase().includes(searchTerm)
    );
    
    // Update STT
    filtered.forEach((mat, index) => {
      mat.stt = index + 1;
    });
    
    this.filteredMaterials = filtered;
    this.totalPages = Math.ceil(filtered.length / this.itemsPerPage);
    this.currentPage = 1;
    this.loadPageFromFiltered(1);
  }

  /**
   * Clear search
   */
  clearSearch(): void {
    this.searchInput = '';
    this.applyFilter();
  }

  /**
   * Show material detail modal
   */
  async showMaterialDetail(material: StockCheckMaterial): Promise<void> {
    this.selectedMaterialDetail = material;
    this.showMaterialDetailModal = true;
    await this.loadMaterialCheckHistory(material);
  }

  /**
   * Load check history for a material (từ stock-check-history - lịch sử vĩnh viễn)
   */
  async loadMaterialCheckHistory(material: StockCheckMaterial): Promise<void> {
    try {
      const sanitizedMaterialCode = material.materialCode.replace(/\//g, '_');
      const sanitizedPoNumber = material.poNumber.replace(/\//g, '_');
      const sanitizedImd = material.imd.replace(/\//g, '_');
      const historyDocId = `${this.selectedFactory}_${sanitizedMaterialCode}_${sanitizedPoNumber}_${sanitizedImd}`;
      
      // Load từ stock-check-history (lịch sử vĩnh viễn)
      const historyDoc = await this.firestore
        .collection('stock-check-history')
        .doc(historyDocId)
        .get()
        .toPromise();
      
      if (historyDoc && historyDoc.exists) {
        const data = historyDoc.data() as any;
        if (data.history && Array.isArray(data.history)) {
          this.materialCheckHistory = data.history
            .map((item: any) => ({
              idCheck: item.idCheck || '-',
              qtyCheck: item.qtyCheck !== undefined && item.qtyCheck !== null ? item.qtyCheck : '-',
              dateCheck: item.dateCheck?.toDate ? item.dateCheck.toDate() : (item.dateCheck ? new Date(item.dateCheck) : null),
              updatedAt: item.updatedAt?.toDate ? item.updatedAt.toDate() : (item.updatedAt ? new Date(item.updatedAt) : null),
              stock: item.stock !== undefined && item.stock !== null ? item.stock : null,
              location: item.location || '-',
              standardPacking: item.standardPacking || '-'
            }))
            .sort((a: any, b: any) => {
              const dateA = a.dateCheck ? new Date(a.dateCheck).getTime() : 0;
              const dateB = b.dateCheck ? new Date(b.dateCheck).getTime() : 0;
              return dateB - dateA; // Newest first
            });
        } else {
          this.materialCheckHistory = [];
        }
      } else {
        this.materialCheckHistory = [];
      }
    } catch (error) {
      console.error('❌ Error loading check history:', error);
      this.materialCheckHistory = [];
    }
  }
  
  /**
   * Show history modal for a material (click vào cột Lịch sử)
   */
  async showMaterialHistory(material: StockCheckMaterial): Promise<void> {
    this.selectedMaterialForHistory = material;
    this.showHistoryModal = true;
    this.isLoadingHistory = true;
    this.materialHistoryList = [];
    
    try {
      await this.loadMaterialCheckHistory(material);
      this.materialHistoryList = this.materialCheckHistory;
    } catch (error) {
      console.error('❌ Error loading material history:', error);
    } finally {
      this.isLoadingHistory = false;
    }
  }
  
  /**
   * Close history modal
   */
  closeHistoryModal(): void {
    this.showHistoryModal = false;
    this.selectedMaterialForHistory = null;
    this.materialHistoryList = [];
  }

  /**
   * Close material detail modal
   */
  closeMaterialDetailModal(): void {
    this.showMaterialDetailModal = false;
    this.selectedMaterialDetail = null;
    this.materialCheckHistory = [];
  }

  /**
   * Apply filter to displayed materials
   */
  applyFilter(): void {
    let filtered = [...this.allMaterials];

    if (this.filterMode === 'checked') {
      filtered = filtered.filter(m => m.stockCheck === '✓');
    } else if (this.filterMode === 'unchecked') {
      filtered = filtered.filter(m => m.stockCheck !== '✓');
    } else if (this.filterMode === 'location-change') {
      // Hiển thị các mã đã đổi vị trí
      filtered = filtered.filter(m => m.locationChangeInfo?.hasChanged === true);
    } else if (this.filterMode === 'outside') {
      // Hiển thị mã ngoài tồn kho: isNewMaterial = true HOẶC stock = 0
      filtered = filtered.filter(m => {
        if (m.isNewMaterial === true) return true;
        // Tính stock hiện tại
        const openingStockValue = m.openingStock !== null && m.openingStock !== undefined ? m.openingStock : 0;
        const currentStock = openingStockValue + (m.quantity || 0) - (m.exported || 0) - (m.xt || 0);
        return currentStock === 0 || currentStock < 0;
      });
    } else if (this.filterMode === 'khsx-unchecked') {
      // Mã có KHSX nhưng chưa được stock check
      filtered = filtered.filter(m => m.hasKhsx && m.stockCheck !== '✓');
    }
    
    // Sort based on current sort mode
    if (this.sortMode === 'alphabetical') {
      filtered.sort((a, b) => a.materialCode.localeCompare(b.materialCode));
    } else {
      filtered.sort((a, b) => {
        if (a.dateCheck && !b.dateCheck) return -1;
        if (!a.dateCheck && b.dateCheck) return 1;
        if (a.dateCheck && b.dateCheck) {
          const dateA = a.dateCheck instanceof Date ? a.dateCheck.getTime() : new Date(a.dateCheck).getTime();
          const dateB = b.dateCheck instanceof Date ? b.dateCheck.getTime() : new Date(b.dateCheck).getTime();
          return dateB - dateA; // Newest first
        }
        return a.materialCode.localeCompare(b.materialCode);
      });
    }

    // Update STT
    filtered.forEach((mat, index) => {
      mat.stt = index + 1;
    });

    // Calculate total pages
    this.totalPages = Math.ceil(filtered.length / this.itemsPerPage);

    // Store filtered results
    this.filteredMaterials = filtered;

    // Reset to first page
    this.currentPage = 1;
    this.loadPageFromFiltered(1);
  }

  constructor(
    private firestore: AngularFirestore,
    private cdr: ChangeDetectorRef
  ) {}

  private updateLocationMaterials(): void {
    const loc = (this.currentScanLocation || '').trim().toUpperCase();
    if (!loc) {
      this.locationMaterials = [];
      return;
    }

    // Load toàn bộ NVL đang có ở vị trí (dữ liệu inventory)
    // Sort theo mã + PO + IMD để dễ scan.
    this.locationMaterials = this.allMaterials
      .filter(m => (m.location || '').trim().toUpperCase() === loc)
      .slice()
      .sort((a, b) => {
        const code = a.materialCode.localeCompare(b.materialCode);
        if (code !== 0) return code;
        const po = (a.poNumber || '').localeCompare(b.poNumber || '');
        if (po !== 0) return po;
        return (a.imd || '').localeCompare(b.imd || '');
      });
  }

  get locationTotalCount(): number {
    return this.locationMaterials.length;
  }

  get locationCheckedCount(): number {
    const loc = (this.currentScanLocation || '').trim().toUpperCase();
    if (!loc) return 0;
    // Đếm số mã tại vị trí này đã được scan (dựa vào actualLocation)
    return this.locationMaterials.filter(m =>
      m.stockCheck === '✓' && (m.actualLocation || '').trim().toUpperCase() === loc
    ).length;
  }

  getMaterialCheckStatus(material: StockCheckMaterial): 'unchecked' | 'partial' | 'full' {
    const checkedQty = material.qtyCheck != null ? Number(material.qtyCheck) : 0;
    const expectedQty = material.stock != null ? Number(material.stock) : 0;
    if (!material.stockCheck || material.stockCheck !== '✓') return 'unchecked';
    if (expectedQty > 0 && checkedQty < expectedQty) return 'partial';
    return 'full';
  }

  ngOnInit(): void {
    // Reset factory selection to show selection screen
    this.selectedFactory = null;
    this.allMaterials = [];
    this.filteredMaterials = [];
    this.displayedMaterials = [];
    this.currentPage = 1;
    this.filterMode = 'all';
    this.currentScanLocation = '';
    this.locationMaterials = [];
    
    // Load valid locations from Location tab
    this.loadValidLocations();
  }

  /**
   * Load valid locations from Location tab (collection 'locations')
   */
  loadValidLocations(): void {
    try {
      this.firestore.collection('locations')
        .valueChanges()
        .pipe(takeUntil(this.destroy$))
        .subscribe((locations: any[]) => {
          // Extract viTri field from locations
          this.validLocations = locations
            .map(loc => loc.viTri ? loc.viTri.trim().toUpperCase() : '')
            .filter(loc => loc !== ''); // Remove empty locations
          
          console.log(`✅ Loaded ${this.validLocations.length} valid locations from Location tab`);
        }, error => {
          console.error('❌ Error loading locations:', error);
          this.validLocations = []; // Fallback to empty array
        });
    } catch (error) {
      console.error('❌ Error loading valid locations:', error);
      this.validLocations = [];
    }
  }

  /**
   * Validate location format and existence
   * Location must:
   * 1. Start with letter D-Z
   * 2. Followed by numbers
   * 3. Exist in validLocations list from Location tab
   */
  validateLocation(location: string): { isValid: boolean; errorMessage?: string } {
    const locationUpper = location.trim().toUpperCase();
    
    // Check 1: Must start with letter D-Z
    if (!/^[D-Z]/.test(locationUpper)) {
      return {
        isValid: false,
        errorMessage: `❌ Vị trí không hợp lệ!\n\nVị trí phải bắt đầu bằng chữ cái từ D đến Z.\n\nVị trí đã quét: ${locationUpper}`
      };
    }
    
    // Check 2: Must be followed by numbers
    if (!/^[D-Z]\d+/.test(locationUpper)) {
      return {
        isValid: false,
        errorMessage: `❌ Vị trí không hợp lệ!\n\nVị trí phải bắt đầu bằng chữ cái (D-Z) và theo sau là số.\n\nVị trí đã quét: ${locationUpper}`
      };
    }
    
    // Check 3: Must exist in validLocations list
    if (this.validLocations.length > 0 && !this.validLocations.includes(locationUpper)) {
      return {
        isValid: false,
        errorMessage: `❌ Vị trí không tồn tại!\n\nVị trí "${locationUpper}" không có trong danh sách vị trí từ tab Location.\n\nVui lòng kiểm tra lại hoặc thêm vị trí này vào tab Location trước.`
      };
    }
    
    return { isValid: true };
  }

  ngOnDestroy(): void {
    // Unsubscribe data subscription nếu có
    if (this.dataSubscription) {
      this.dataSubscription.unsubscribe();
      this.dataSubscription = null;
    }
    // Unsubscribe snapshot subscription nếu có
    if (this.snapshotSubscription) {
      this.snapshotSubscription.unsubscribe();
      this.snapshotSubscription = null;
    }
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Select factory and load data
   */
  selectFactory(factory: 'ASM1' | 'ASM2'): void {
    this.selectedFactory = factory;
    this.currentPage = 1;
    this.currentEmployeeId = ''; // Reset employee ID
    this.isInitialDataLoaded = false; // Reset flag
    
    // Subscribe ngay từ đầu để catch mọi thay đổi (trước khi load data)
    this.subscribeToSnapshotChanges();
    
    this.loadData();
    
    // Show employee scan modal after selecting factory
    setTimeout(() => {
      this.showEmployeeScanModal = true;
      this.employeeScanInput = '';
      setTimeout(() => {
        const input = document.getElementById('employee-scan-input') as HTMLInputElement;
        if (input) {
          input.focus();
        }
      }, 300);
    }, 100);
  }

  /**
   * Back to factory selection
   */
  backToSelection(): void {
    this.selectedFactory = null;
    this.allMaterials = [];
    this.filteredMaterials = [];
    this.displayedMaterials = [];
    this.currentPage = 1;
    this.filterMode = 'all';
    this.currentEmployeeId = ''; // Reset employee ID
    this.showEmployeeScanModal = false;
    this.currentScanLocation = '';
    this.locationMaterials = [];
  }
  
  /**
   * Handle employee ID scan (after factory selection)
   */
  onEmployeeScanEnter(): void {
    const scannedData = this.employeeScanInput.trim().toUpperCase();
    if (!scannedData) return;
    
    // Validate format: ASP + 4 số (7 ký tự)
    // Lấy 7 ký tự đầu tiên
    const employeeId = scannedData.substring(0, 7);
    
    // Check format: ASP + 4 số
    if (/^ASP\d{4}$/.test(employeeId)) {
      this.currentEmployeeId = employeeId;
      this.showEmployeeScanModal = false;
      this.employeeScanInput = '';
      this.cdr.detectChanges();
      
      // Focus vào input search hoặc button Kiểm Kê
      setTimeout(() => {
        const searchInput = document.querySelector('.search-input') as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
        }
      }, 100);
    } else {
      // Invalid format
      alert('❌ Mã nhân viên không hợp lệ!\n\nVui lòng nhập mã ASP + 4 số (ví dụ: ASP1234)');
      this.employeeScanInput = '';
      setTimeout(() => {
        const input = document.getElementById('employee-scan-input') as HTMLInputElement;
        if (input) {
          input.focus();
        }
      }, 100);
    }
  }
  
  /**
   * Logout employee (kết thúc phiên làm việc)
   */
  logoutEmployee(): void {
    if (confirm('Bạn có chắc muốn đăng xuất?')) {
      this.currentEmployeeId = '';
      this.showScanModal = false;
      this.scanStep = 'idle';
      this.scannedEmployeeId = '';
      this.scanInput = '';
      this.scanMessage = '';
      this.scanHistory = [];
      
      // Show employee scan modal again
      this.showEmployeeScanModal = true;
      this.employeeScanInput = '';
      setTimeout(() => {
        const input = document.getElementById('employee-scan-input') as HTMLInputElement;
        if (input) {
          input.focus();
        }
      }, 300);
    }
  }

  /**
   * Load inventory data from Firestore
   */
  loadData(): void {
    if (!this.selectedFactory) {
      console.log('⚠️ No factory selected');
      return;
    }

    // Unsubscribe subscription cũ nếu có để tránh race condition
    if (this.dataSubscription) {
      this.dataSubscription.unsubscribe();
      this.dataSubscription = null;
    }

    console.log(`📊 Loading data for factory: ${this.selectedFactory}`);
    this.isLoading = true;
    this.allMaterials = [];
    this.displayedMaterials = [];

    // Load inventory materials - sử dụng valueChanges() để real-time update
    // Nhưng chỉ xử lý khi có data (filter empty arrays)
    this.dataSubscription = this.firestore
      .collection('inventory-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
      )
      .valueChanges({ idField: 'id' })
      .pipe(
        takeUntil(this.destroy$),
        filter((materials: any[]) => materials && materials.length > 0) // Chỉ xử lý khi có data
      )
      .subscribe(async (materials: any[]) => {
        // Group by materialCode and poNumber, then sum quantities
        const groupedMap = new Map<string, any>();

        materials.forEach(mat => {
          // Filter: Only show materials starting with A or B (giống materials-asm1)
          if (!mat.materialCode || (!mat.materialCode.toUpperCase().startsWith('A') && !mat.materialCode.toUpperCase().startsWith('B'))) {
            return;
          }
          
          // KHÔNG group - giữ nguyên tất cả dòng như materials-asm1
          // Mỗi dòng trong inventory-materials là 1 item riêng biệt
          const key = `${mat.materialCode}_${mat.poNumber}_${mat.batchNumber || ''}_${mat.id || ''}`;
          
          groupedMap.set(key, {
            materialCode: mat.materialCode,
            poNumber: mat.poNumber,
            location: mat.location || '',
            openingStock: mat.openingStock || 0,
            quantity: mat.quantity || 0,
            exported: mat.exported || 0,
            xt: mat.xt || 0,
            importDate: mat.importDate ? mat.importDate.toDate() : null,
            batchNumber: mat.batchNumber || '',
            id: mat.id || '',
            // Thông tin đổi vị trí
            lastModified: mat.lastModified ? (mat.lastModified.toDate ? mat.lastModified.toDate() : new Date(mat.lastModified)) : null,
            modifiedBy: mat.modifiedBy || ''
          });
        });

        // Load standardPacking from materials collection
        const materialCodes = Array.from(groupedMap.keys()).map(key => key.split('_')[0]);
        const uniqueMaterialCodes = [...new Set(materialCodes)];
        const standardPackingMap = new Map<string, string>();
        
        try {
          const materialsSnapshot = await Promise.all(
            uniqueMaterialCodes.map(code => 
              this.firestore.collection('materials').doc(code).get().toPromise()
            )
          );
          
          materialsSnapshot.forEach((doc, index) => {
            if (doc && doc.exists) {
              const data = doc.data();
              const standardPacking = data?.['standardPacking'];
              if (standardPacking) {
                standardPackingMap.set(uniqueMaterialCodes[index], standardPacking.toString());
              }
            }
          });
        } catch (error) {
          console.error('Error loading standardPacking:', error);
        }

        // Convert map to array and calculate stock (giống hệt materials-asm1)
        // KHÔNG group - mỗi dòng trong inventory-materials là 1 item riêng biệt
        const materialsArray = Array.from(groupedMap.values()).map((mat, index) => {
          // Tính stock giống hệt materials-asm1: openingStock (có thể null) + quantity - exported - xt
          const openingStockValue = mat.openingStock !== null ? mat.openingStock : 0;
          const stock = openingStockValue + (mat.quantity || 0) - (mat.exported || 0) - (mat.xt || 0);
          const standardPacking = standardPackingMap.get(mat.materialCode) || '';
          
          // Kiểm tra xem material có đổi vị trí không
          const hasLocationChange = mat.modifiedBy === 'location-change-scanner' && mat.lastModified;
          const locationChangeInfo = hasLocationChange ? {
            hasChanged: true,
            newLocation: mat.location,
            changeDate: mat.lastModified,
            changedBy: mat.modifiedBy || 'Hệ thống'
          } : {
            hasChanged: false,
            newLocation: mat.location,
            changeDate: undefined,
            changedBy: undefined
          };
          
          return {
            stt: index + 1,
            materialCode: mat.materialCode,
            poNumber: mat.poNumber,
            imd: this.getDisplayIMD(mat),
            stock: stock,
            location: mat.location,
            standardPacking: standardPacking,
            stockCheck: '',
            qtyCheck: null,
            idCheck: '',
            dateCheck: null,
            openingStock: mat.openingStock,
            quantity: mat.quantity,
            exported: mat.exported,
            xt: mat.xt,
            importDate: mat.importDate,
            batchNumber: mat.batchNumber,
            locationChangeInfo: locationChangeInfo
          };
        });
        
        console.log(`📊 Stock Check: Loaded ${materialsArray.length} materials (KHÔNG group - giống materials-asm1)`);
        console.log(`📊 Stock Check: Total from inventory-materials: ${materials.length}, After filter A/B: ${materialsArray.length}`);

        // Load stock check data from Firebase
        await this.loadStockCheckData(materialsArray);

        // Load KHSX data và đánh dấu materials
        await this.loadKhsxData(materialsArray);

        this.allMaterials = materialsArray;

        // Nếu đang có vị trí scan, cập nhật danh sách box theo vị trí
        this.updateLocationMaterials();
        
        // Calculate ID check statistics
        this.calculateIdCheckStats();

        // Sort materials based on current sort mode
        this.sortMaterials();

        // Update STT after sorting
        this.allMaterials.forEach((mat, index) => {
          mat.stt = index + 1;
        });

        // Initialize filtered materials
        this.filteredMaterials = [...this.allMaterials];
        
        // Calculate total pages
        this.totalPages = Math.ceil(this.filteredMaterials.length / this.itemsPerPage);

        // Load first page
        this.loadPageFromFiltered(1);
        
        // Calculate ID check statistics
        this.calculateIdCheckStats();
        
        // Force change detection to ensure UI updates
        this.cdr.detectChanges();
        
        this.isLoading = false;
        
        // Final check - log checked materials count
        const checkedCount = this.allMaterials.filter(m => m.stockCheck === '✓').length;
        console.log(`✅ [loadData] Final: ${checkedCount} materials marked as checked out of ${this.allMaterials.length} total`);
        
        // Đánh dấu đã load initial data xong
        this.isInitialDataLoaded = true;
      });
  }

  /**
   * Subscribe to stock-check-snapshot changes để real-time update
   */
  private subscribeToSnapshotChanges(): void {
    // Unsubscribe subscription cũ nếu có
    if (this.snapshotSubscription) {
      this.snapshotSubscription.unsubscribe();
      this.snapshotSubscription = null;
    }

    if (!this.selectedFactory) {
      return;
    }

    const docId = `${this.selectedFactory}_stock_check_current`;
    
    this.snapshotSubscription = this.firestore
      .collection('stock-check-snapshot')
      .doc(docId)
      .valueChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe(async (snapshotData: any) => {
        // Nếu chưa load initial data, skip (sẽ được load trong loadData)
        if (!this.isInitialDataLoaded) {
          console.log(`⏳ [subscribeToSnapshotChanges] Initial data not loaded yet, skipping...`);
          return;
        }

        if (!this.allMaterials || this.allMaterials.length === 0) {
          console.log(`⚠️ [subscribeToSnapshotChanges] No materials loaded yet, skipping update`);
          return;
        }

        if (!snapshotData || !snapshotData.materials) {
          console.log(`⚠️ [subscribeToSnapshotChanges] No snapshot data, skipping update`);
          return;
        }

        console.log(`🔄 [subscribeToSnapshotChanges] Snapshot updated! Detected ${snapshotData.materials.length} checked materials, reloading...`);
        
        // Reload stock check data và apply vào materials hiện tại (truyền snapshotData trực tiếp)
        await this.loadStockCheckData(this.allMaterials, snapshotData);

        // Update location view (box) nếu đang scan theo vị trí
        this.updateLocationMaterials();
        
        // Update filtered materials
        this.filteredMaterials = [...this.allMaterials];
        
        // Reload current page
        this.loadPageFromFiltered(this.currentPage);
        
        // Recalculate stats
        this.calculateIdCheckStats();
        
        // Force change detection
        this.cdr.detectChanges();
        
        const checkedCount = this.allMaterials.filter(m => m.stockCheck === '✓').length;
        console.log(`✅ [subscribeToSnapshotChanges] Updated: ${checkedCount} materials marked as checked`);
      });
  }

  /**
   * Load stock check data from Firebase - Đơn giản: load từ 1 collection duy nhất
   */
  async loadStockCheckData(materials: StockCheckMaterial[], snapshotData?: any): Promise<void> {
    try {
      if (!this.selectedFactory || !materials || materials.length === 0) {
        return;
      }

      let checkedMaterials: any[] = [];

      if (snapshotData) {
        // Nếu có snapshotData trực tiếp (từ subscription), dùng luôn
        checkedMaterials = snapshotData.materials || [];
        // Cập nhật cache
        this.snapshotCache[this.selectedFactory] = {
          materials: [...checkedMaterials],
          lastUpdated: new Date()
        };
      } else {
        // Nếu không có, load từ Firebase
        const docId = `${this.selectedFactory}_stock_check_current`;
        const doc = await this.firestore
          .collection('stock-check-snapshot')
          .doc(docId)
          .get()
          .toPromise();

        if (!doc || !doc.exists) {
          console.log(`⚠️ [loadStockCheckData] No snapshot found for factory: ${this.selectedFactory}`);
          // Clear cache
          this.snapshotCache[this.selectedFactory] = {
            materials: [],
            lastUpdated: new Date()
          };
          // Reset tất cả materials về chưa check
          materials.forEach(mat => {
            mat.stockCheck = '';
            mat.qtyCheck = null;
            mat.idCheck = '';
            mat.dateCheck = null;
          });
          return;
        }

        const data = doc.data() as any;
        checkedMaterials = data.materials || [];
        // Cập nhật cache
        this.snapshotCache[this.selectedFactory] = {
          materials: [...checkedMaterials],
          lastUpdated: new Date()
        };
      }

      if (checkedMaterials.length === 0) {
        console.log(`⚠️ [loadStockCheckData] No checked materials in snapshot`);
        // Reset tất cả materials về chưa check
        materials.forEach(mat => {
          mat.stockCheck = '';
          mat.qtyCheck = null;
          mat.idCheck = '';
          mat.dateCheck = null;
        });
        return;
      }

      console.log(`📦 [loadStockCheckData] Loaded ${checkedMaterials.length} checked materials from snapshot`);

      // Tạo map: key = materialCode_PO_IMD
      const checkedMap = new Map<string, any>();
      checkedMaterials.forEach((item: any) => {
        if (item.materialCode && item.poNumber && item.imd) {
          const key = `${item.materialCode}_${item.poNumber}_${item.imd}`;
          checkedMap.set(key, item);
        }
      });

      // Reset tất cả materials về chưa check trước
      materials.forEach(mat => {
        mat.stockCheck = '';
        mat.qtyCheck = null;
        mat.idCheck = '';
        mat.dateCheck = null;
      });

      // Apply checked data vào materials
      let matchedCount = 0;
      materials.forEach(mat => {
        if (mat.materialCode && mat.poNumber && mat.imd) {
          const key = `${mat.materialCode}_${mat.poNumber}_${mat.imd}`;
          const checkedItem = checkedMap.get(key);
          
          if (checkedItem) {
            mat.stockCheck = '✓';
            mat.qtyCheck = checkedItem.qtyCheck || null;
            mat.idCheck = checkedItem.idCheck || '';
            mat.dateCheck = checkedItem.dateCheck?.toDate ? checkedItem.dateCheck.toDate() : 
                           (checkedItem.dateCheck ? new Date(checkedItem.dateCheck) : null);
            mat.actualLocation = checkedItem.actualLocation || ''; // Load vị trí thực tế từ Firebase
            matchedCount++;
          }
        }
      });

      console.log(`✅ [loadStockCheckData] Applied ${matchedCount} checked materials to ${materials.length} total materials`);
      this.cdr.detectChanges();
    } catch (error) {
      console.error('❌ Error loading stock check data:', error);
    }
  }

  /**
   * Migrate dữ liệu từ collection cũ sang snapshot mới - Loại bỏ duplicate
   */
  async migrateToSnapshot(checkedMaterials: any[]): Promise<void> {
    try {
      // Loại bỏ duplicate trước khi migrate
      const uniqueMap = new Map<string, any>();
      checkedMaterials.forEach((item: any) => {
        const key = `${item.materialCode}_${item.poNumber}_${item.imd}`;
        // Nếu đã có, giữ lại bản mới nhất
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, item);
        } else {
          const existing = uniqueMap.get(key);
          const existingDate = existing.dateCheck?.toDate ? existing.dateCheck.toDate() : 
                              (existing.dateCheck ? new Date(existing.dateCheck) : new Date(0));
          const newDate = item.dateCheck?.toDate ? item.dateCheck.toDate() : 
                         (item.dateCheck ? new Date(item.dateCheck) : new Date(0));
          if (newDate > existingDate) {
            uniqueMap.set(key, item);
          }
        }
      });

      const uniqueMaterials = Array.from(uniqueMap.values());
      console.log(`📊 [migrateToSnapshot] Removed duplicates: ${checkedMaterials.length} -> ${uniqueMaterials.length}`);

      const docId = `${this.selectedFactory}_stock_check_current`;
      await this.firestore
        .collection('stock-check-snapshot')
        .doc(docId)
        .set({
          factory: this.selectedFactory,
          materials: uniqueMaterials,
          lastUpdated: new Date(),
          updatedAt: firebase.default.firestore.FieldValue.serverTimestamp(),
          migrated: true
        }, { merge: true });
      
      console.log(`✅ [migrateToSnapshot] Migrated ${uniqueMaterials.length} unique materials to snapshot`);
    } catch (error) {
      console.error('❌ [migrateToSnapshot] Error migrating:', error);
    }
  }

  /**
   * Save stock check data to Firebase - Đơn giản: lưu toàn bộ vào 1 document snapshot
   */
  // Cache snapshot trong memory để tránh đọc Firebase mỗi lần scan
  private snapshotCache: { [factory: string]: { materials: any[], lastUpdated: Date } } = {};

  async saveStockCheckToFirebase(material: StockCheckMaterial, scannedQty?: number): Promise<void> {
    try {
      const snapshotDocId = `${this.selectedFactory}_stock_check_current`;
      
      // Sử dụng cache nếu có, nếu không thì load từ Firebase
      let checkedMaterials: any[] = [];
      const cacheKey = this.selectedFactory;
      
      if (this.snapshotCache[cacheKey] && this.snapshotCache[cacheKey].materials) {
        // Sử dụng cache - nhanh hơn nhiều
        checkedMaterials = [...this.snapshotCache[cacheKey].materials];
      } else {
        // Load snapshot hiện tại từ Firebase (chỉ lần đầu hoặc khi cache không có)
        const doc = await this.firestore
          .collection('stock-check-snapshot')
          .doc(snapshotDocId)
          .get()
          .toPromise();

        if (doc && doc.exists) {
          const data = doc.data() as any;
          checkedMaterials = data.materials || [];
        }
        
        // Lưu vào cache
        this.snapshotCache[cacheKey] = {
          materials: [...checkedMaterials],
          lastUpdated: new Date()
        };
      }

      // Tìm material trong danh sách đã check
      const key = `${material.materialCode}_${material.poNumber}_${material.imd}`;
      const existingIndex = checkedMaterials.findIndex((item: any) => 
        `${item.materialCode}_${item.poNumber}_${item.imd}` === key
      );

      // Cộng dồn số lượng nếu đã tồn tại
      const newQty = scannedQty !== undefined ? scannedQty : (material.qtyCheck || 0);
      
      if (existingIndex >= 0) {
        const existing = checkedMaterials[existingIndex];
        checkedMaterials[existingIndex] = {
          ...existing,
          qtyCheck: (existing.qtyCheck || 0) + newQty,
          idCheck: material.idCheck,
          dateCheck: material.dateCheck || new Date(),
          actualLocation: material.actualLocation || existing.actualLocation || '', // Lưu vị trí thực tế
          updatedAt: new Date()
        };
        material.qtyCheck = checkedMaterials[existingIndex].qtyCheck;
        // Cập nhật actualLocation từ Firebase
        material.actualLocation = checkedMaterials[existingIndex].actualLocation;
      } else {
        // Thêm mới
        checkedMaterials.push({
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          imd: material.imd,
          qtyCheck: newQty,
          idCheck: material.idCheck,
          dateCheck: material.dateCheck || new Date(),
          actualLocation: material.actualLocation || '', // Lưu vị trí thực tế
          updatedAt: new Date()
        });
        material.qtyCheck = newQty;
      }

      // Cập nhật cache
      this.snapshotCache[cacheKey] = {
        materials: [...checkedMaterials],
        lastUpdated: new Date()
      };

      // Lưu snapshot vào Firebase (không await - fire and forget để tăng tốc)
      // Sẽ được sync sau trong background
      this.firestore
        .collection('stock-check-snapshot')
        .doc(snapshotDocId)
        .set({
          factory: this.selectedFactory,
          materials: checkedMaterials,
          lastUpdated: new Date(),
          updatedAt: firebase.default.firestore.FieldValue.serverTimestamp()
        }, { merge: true })
        .catch(error => {
          console.error('❌ Error saving snapshot (async):', error);
        });

      // Lưu vào lịch sử vĩnh viễn (không await - fire and forget để tăng tốc)
      // Lịch sử không cần thiết phải block scan
      const historyItem: CheckHistoryItem = {
        idCheck: material.idCheck,
        qtyCheck: newQty,
        dateCheck: material.dateCheck || new Date(),
        updatedAt: new Date()
      };
      
      // Save history async - không block scan
      this.saveToPermanentHistory(material, newQty, historyItem).catch(error => {
        console.error('❌ Error saving history (async):', error);
      });
      
      // Recalculate ID stats (nhanh, không cần await)
      this.calculateIdCheckStats();

      // Refresh list theo vị trí hiện tại (để đổi màu box ngay)
      this.updateLocationMaterials();
      
      console.log(`✅ Stock check saved (cached): ${checkedMaterials.length} materials`);
    } catch (error) {
      console.error('❌ Error saving stock check to Firebase:', error);
    }
  }

  /**
   * Lưu vào lịch sử vĩnh viễn (collection riêng, không bị xóa khi RESET)
   * Tối ưu: Chỉ filter/sort khi cần thiết (khi history > 100 items)
   */
  async saveToPermanentHistory(material: StockCheckMaterial, scannedQty: number, historyItem: CheckHistoryItem): Promise<void> {
    try {
      if (!this.selectedFactory) return;
      
      const sanitizedMaterialCode = material.materialCode.replace(/\//g, '_');
      const sanitizedPoNumber = material.poNumber.replace(/\//g, '_');
      const sanitizedImd = material.imd.replace(/\//g, '_');
      const historyDocId = `${this.selectedFactory}_${sanitizedMaterialCode}_${sanitizedPoNumber}_${sanitizedImd}`;
      
      // Lấy document hiện tại
      const historyDoc = await this.firestore
        .collection('stock-check-history')
        .doc(historyDocId)
        .get()
        .toPromise();
      
      let historyList: any[] = [];
      if (historyDoc && historyDoc.exists) {
        const data = historyDoc.data() as any;
        historyList = data.history || [];
      }
      
      // Thêm lịch sử mới
      const newHistoryItem = {
        idCheck: historyItem.idCheck,
        qtyCheck: scannedQty, // Số lượng vừa scan
        dateCheck: firebase.default.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.default.firestore.FieldValue.serverTimestamp(),
        stock: material.stock, // Lưu stock tại thời điểm check
        location: material.location || '',
        standardPacking: material.standardPacking || ''
      };
      
      historyList.push(newHistoryItem);
      
      // Tối ưu: Chỉ filter/sort khi history quá lớn (> 100 items)
      // Điều này giúp tăng tốc đáng kể khi scan nhiều
      if (historyList.length > 100) {
        // XÓA DỮ LIỆU CŨ HƠN 1 NĂM
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        
        historyList = historyList.filter(item => {
          const itemDate = item.dateCheck?.toDate ? item.dateCheck.toDate() : (item.dateCheck ? new Date(item.dateCheck) : null);
          if (!itemDate) return true; // Giữ lại nếu không có date
          return itemDate >= oneYearAgo;
        });
        
        // Sắp xếp theo date (mới nhất trước)
        historyList.sort((a, b) => {
          const dateA = a.dateCheck?.toDate ? a.dateCheck.toDate().getTime() : (a.dateCheck ? new Date(a.dateCheck).getTime() : 0);
          const dateB = b.dateCheck?.toDate ? b.dateCheck.toDate().getTime() : (b.dateCheck ? new Date(b.dateCheck).getTime() : 0);
          return dateB - dateA;
        });
      }
      
      // Lưu vào Firebase
      await this.firestore
        .collection('stock-check-history')
        .doc(historyDocId)
        .set({
          factory: this.selectedFactory,
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          imd: material.imd,
          history: historyList,
          lastUpdated: firebase.default.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      
      // Chỉ log khi cần debug
      // console.log(`📝 Saved to permanent history: ${material.materialCode} | Qty: ${scannedQty}`);
    } catch (error) {
      console.error('❌ Error saving to permanent history:', error);
    }
  }

  /**
   * Get IMD display (same logic as materials-asm1)
   */
  getDisplayIMD(material: any): string {
    if (!material.importDate) return 'N/A';
    
    const baseDate = material.importDate.toLocaleDateString('en-GB').split('/').join('');
    
    // Check if batchNumber has correct format
    if (material.batchNumber && material.batchNumber !== baseDate) {
      // Only process if batchNumber starts with baseDate and only has sequence number added
      if (material.batchNumber.startsWith(baseDate)) {
        const suffix = material.batchNumber.substring(baseDate.length);
        // Only accept suffix if it contains only numbers and has length <= 2
        if (/^\d{1,2}$/.test(suffix)) {
          return baseDate + suffix;
        }
      }
    }
    
    return baseDate;
  }

  /**
   * Load specific page from filtered materials
   */
  loadPageFromFiltered(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    
    this.currentPage = page;
    const startIndex = (page - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    
    this.displayedMaterials = this.filteredMaterials.slice(startIndex, endIndex);
  }

  /**
   * Load specific page (backward compatibility)
   */
  loadPage(page: number): void {
    this.loadPageFromFiltered(page);
  }

  /**
   * Go to previous page
   */
  previousPage(): void {
    if (this.currentPage > 1) {
      this.loadPage(this.currentPage - 1);
    }
  }

  /**
   * Go to next page
   */
  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.loadPage(this.currentPage + 1);
    }
  }

  /**
   * Update material data
   */
  updateMaterial(material: StockCheckMaterial): void {
    // Here you can add logic to save changes to Firestore if needed
    console.log('Material updated:', material);
  }

  /**
   * Start inventory checking (Kiểm Kê)
   */
  startInventoryCheck(): void {
    // Kiểm tra xem đã đăng nhập mã nhân viên chưa
    if (!this.currentEmployeeId) {
      alert('Vui lòng scan mã nhân viên trước!');
      this.showEmployeeScanModal = true;
      this.employeeScanInput = '';
      setTimeout(() => {
        const input = document.getElementById('employee-scan-input') as HTMLInputElement;
        if (input) {
          input.focus();
        }
      }, 300);
      return;
    }
    
    // Đã có mã nhân viên
    // Nếu chưa có vị trí (lần đầu hoặc đã đóng modal), yêu cầu scan vị trí
    // Nếu đã có vị trí (đang trong session), bỏ qua bước scan vị trí
    if (!this.currentScanLocation) {
      // Chưa có vị trí - yêu cầu scan vị trí trước
      this.showScanModal = true;
      this.scanStep = 'location'; // Bước 1: scan vị trí
      this.scannedEmployeeId = this.currentEmployeeId;
      this.scanInput = '';
      this.scanMessage = `ID: ${this.currentEmployeeId}\n\nVui lòng SCAN VỊ TRÍ trước, sau đó có thể SCAN MÃ HÀNG hàng loạt.`;
      this.scanHistory = [];
      this.locationMaterials = [];
    } else {
      // Đã có vị trí - bỏ qua bước scan vị trí, scan mã hàng luôn
      this.showScanModal = true;
      this.scanStep = 'material'; // Bỏ qua bước scan vị trí
      this.scannedEmployeeId = this.currentEmployeeId;
      this.scanInput = '';
      this.scanMessage = `ID: ${this.currentEmployeeId}\nVị trí: ${this.currentScanLocation}\n\nScan MÃ HÀNG kiểm kê tại vị trí này.`;
      this.scanHistory = [];
      this.updateLocationMaterials();
    }
    
    // Focus input after modal opens
    setTimeout(() => {
      const input = document.getElementById('scan-input') as HTMLInputElement;
      if (input) {
        input.focus();
      }
    }, 300);
  }

  /**
   * Handle scanner input (triggered by Enter or scanner)
   */
  async onScanInputEnter(): Promise<void> {
    const scannedData = this.scanInput.trim();
    if (!scannedData) return;

    console.log('📥 Scanned data:', scannedData);

    // Bước 1: scan vị trí
    if (this.scanStep === 'location') {
      const locationUpper = scannedData.toUpperCase().trim();
      
      // Validate location
      const validation = this.validateLocation(locationUpper);
      
      if (!validation.isValid) {
        // Invalid location - show error and clear input
        alert(validation.errorMessage || '❌ Vị trí không hợp lệ!');
        this.scanInput = '';
        this.scanMessage = `ID: ${this.currentEmployeeId}\n\n❌ Vị trí không hợp lệ!\n\nVui lòng SCAN LẠI VỊ TRÍ.\n\nYêu cầu:\n- Bắt đầu bằng chữ cái D-Z\n- Theo sau là số\n- Phải có trong danh sách vị trí từ tab Location`;
        
        // Focus lại input để scan lại
        setTimeout(() => {
          const input = document.getElementById('scan-input') as HTMLInputElement;
          if (input) {
            input.focus();
          }
        }, 100);
        return;
      }
      
      // Location is valid - save and proceed
      this.currentScanLocation = locationUpper;
      this.scanHistory.push(`📍 Vị trí: ${this.currentScanLocation}`);
      this.updateLocationMaterials();
      
      // Chuyển sang bước scan mã hàng
      this.scanStep = 'material';
      this.scanInput = '';
      this.scanMessage = `ID: ${this.currentEmployeeId}\nVị trí: ${this.currentScanLocation}\n\nScan MÃ HÀNG kiểm kê tại vị trí này.`;
      
      // Focus lại input để scan tiếp
      setTimeout(() => {
        const input = document.getElementById('scan-input') as HTMLInputElement;
        if (input) {
          input.focus();
        }
      }, 100);
      return;
    }

    if (this.scanStep === 'material') {
      // Đảm bảo có mã nhân viên từ currentEmployeeId
      if (!this.currentEmployeeId) {
        // Nếu không có mã nhân viên, đóng modal và yêu cầu scan lại
        this.closeScanModal();
        alert('Vui lòng scan mã nhân viên trước!');
        this.showEmployeeScanModal = true;
        return;
      }
      
      // Đảm bảo đã có vị trí (nếu chưa có thì yêu cầu scan lại)
      if (!this.currentScanLocation) {
        // Nếu chưa có vị trí, chuyển về bước scan vị trí
        this.scanStep = 'location';
        this.scanInput = '';
        this.scanMessage = `ID: ${this.currentEmployeeId}\n\nVui lòng SCAN VỊ TRÍ trước, sau đó có thể SCAN MÃ HÀNG hàng loạt.`;
        setTimeout(() => {
          const input = document.getElementById('scan-input') as HTMLInputElement;
          if (input) {
            input.focus();
          }
        }, 100);
        return;
      }
      
      // Dùng mã nhân viên đã đăng nhập
      this.scannedEmployeeId = this.currentEmployeeId;
      // Process material QR code
      // Format: materialCode|poNumber|quantity|imd
      const parts = scannedData.split('|');
      
      if (parts.length === 4) {
        const [materialCode, poNumber, quantity, imd] = parts.map(p => p.trim());
        
        console.log('🔍 Searching for material:', {
          scanned: { materialCode, poNumber, imd, quantity },
          totalMaterials: this.allMaterials.length
        });
        
        // Debug: Show some materials for comparison
        const sampleMaterials = this.allMaterials.slice(0, 3).map(m => ({
          code: m.materialCode,
          po: m.poNumber,
          imd: m.imd
        }));
        console.log('📋 Sample materials in database:', sampleMaterials);
        
        // Find matching material in all materials (not just displayed)
        // Try different matching strategies
        let matchingMaterial = this.allMaterials.find(m => 
          m.materialCode.toUpperCase().trim() === materialCode.toUpperCase().trim() && 
          m.poNumber.trim() === poNumber.trim() && 
          m.imd.trim() === imd.trim()
        );
        
        // If not found, try without IMD (just material code + PO)
        if (!matchingMaterial) {
          console.log('⚠️ Not found with IMD, trying without IMD...');
          const candidates = this.allMaterials.filter(m => 
            m.materialCode.toUpperCase().trim() === materialCode.toUpperCase().trim() && 
            m.poNumber.trim() === poNumber.trim()
          );
          
          if (candidates.length > 0) {
            console.log(`📌 Found ${candidates.length} candidates with matching code+PO:`, 
              candidates.map(c => ({ code: c.materialCode, po: c.poNumber, imd: c.imd }))
            );
            
            // Use the first match if IMD is close
            matchingMaterial = candidates.find(c => c.imd === imd) || candidates[0];
            
            if (matchingMaterial && matchingMaterial.imd !== imd) {
              console.log(`⚠️ IMD mismatch but using closest match. Expected: ${imd}, Got: ${matchingMaterial.imd}`);
            }
          }
        }
        
        if (matchingMaterial) {
          console.log('✅ Found matching material:', {
            code: matchingMaterial.materialCode,
            po: matchingMaterial.poNumber,
            imd: matchingMaterial.imd
          });
          
          // Tính stock hiện tại: openingStock + quantity - exported - xt
          const openingStockValue = matchingMaterial.openingStock !== null && matchingMaterial.openingStock !== undefined ? matchingMaterial.openingStock : 0;
          const currentStock = openingStockValue + (matchingMaterial.quantity || 0) - (matchingMaterial.exported || 0) - (matchingMaterial.xt || 0);
          
          // Nếu stock = 0 hoặc không có trong tồn kho, đánh dấu là material ngoài tồn kho
          if (currentStock === 0 || currentStock < 0) {
            matchingMaterial.isNewMaterial = true;
            console.log(`📌 Material có stock = ${currentStock}, đánh dấu là mã ngoài tồn kho`);
          }
          
          // Update the material - CỘNG DỒN số lượng thay vì ghi đè
          matchingMaterial.stockCheck = '✓';
          matchingMaterial.idCheck = this.scannedEmployeeId;
          matchingMaterial.dateCheck = new Date();
          
          // Gán vị trí thực tế (nếu đã scan vị trí)
          if (this.currentScanLocation) {
            matchingMaterial.actualLocation = this.currentScanLocation;
          }
          
          // Lấy số lượng mới scan
          const newQty = parseFloat(quantity) || 0;
          
          // Save to Firebase - hàm này sẽ lấy giá trị từ Firebase và cộng dồn
          await this.saveStockCheckToFirebase(matchingMaterial, newQty);
          
          // Sau khi save, cập nhật lại qtyCheck từ Firebase (đã được cộng dồn)
          // qtyCheck sẽ được cập nhật trong saveStockCheckToFirebase
          
          // Add to history
          this.scanHistory.unshift(`✓ ${materialCode} | PO: ${poNumber} | Qty: ${quantity}`);
          if (this.scanHistory.length > 5) {
            this.scanHistory.pop();
          }
          
          this.scanMessage = `✓ Đã kiểm tra: ${materialCode}\nPO: ${poNumber} | Số lượng: ${quantity}\nVị trí: ${this.currentScanLocation}\n\nScan mã tiếp theo (cùng vị trí)`;
          
          // Clear input ngay lập tức để có thể scan tiếp
          this.scanInput = '';
          
          // Refresh view (không block scan - async)
          setTimeout(() => {
            this.applyFilter();
            this.updateLocationMaterials();
            this.cdr.detectChanges();
          }, 0);
        } else {
          // Không tìm thấy trong bảng - tạo material mới và thêm vào
          console.log('📝 Material not found in table, creating new entry:', { materialCode, poNumber, imd, quantity });
          
          const scannedQty = parseFloat(quantity) || 0;
          
          const newMaterial: StockCheckMaterial = {
            stt: 0, // Sẽ được cập nhật sau khi sort
            materialCode: materialCode,
            poNumber: poNumber,
            imd: imd,
            stock: 0, // Không có thông tin stock từ scan
            location: '', // Vị trí trong tồn kho (không có từ scan)
            actualLocation: this.currentScanLocation || '', // Vị trí thực tế từ scan
            standardPacking: '', // Sẽ tải sau nếu cần
            stockCheck: '✓',
            qtyCheck: scannedQty,
            idCheck: this.scannedEmployeeId,
            dateCheck: new Date(),
            openingStock: undefined,
            quantity: 0,
            exported: undefined,
            xt: undefined,
            importDate: undefined,
            batchNumber: undefined,
            isNewMaterial: true // Đánh dấu là material mới (không có trong tồn kho)
          };
          
          // Thêm vào allMaterials
          this.allMaterials.push(newMaterial);
          
          // Sort lại theo sort mode hiện tại
          this.sortMaterials();
          
          // Update STT sau khi sort
          this.allMaterials.forEach((mat, index) => {
            mat.stt = index + 1;
          });
          
          // Lưu vào Firebase
          await this.saveStockCheckToFirebase(newMaterial, scannedQty);
          
          // Thử tải standardPacking từ materials collection nếu có
          try {
            const materialDoc = await this.firestore.collection('materials').doc(materialCode).get().toPromise();
            if (materialDoc && materialDoc.exists) {
              const data = materialDoc.data() as any;
              if (data && data.standardPacking) {
                newMaterial.standardPacking = data.standardPacking.toString();
              }
            }
          } catch (error) {
            console.log('⚠️ Could not load standardPacking for new material:', error);
          }
          
          // Refresh view trước để có STT chính xác
          this.applyFilter();
          this.updateLocationMaterials();
          
          // Tìm lại material sau khi filter để lấy STT chính xác
          const updatedMaterial = this.filteredMaterials.find(m => 
            m.materialCode.toUpperCase().trim() === materialCode.toUpperCase().trim() && 
            m.poNumber.trim() === poNumber.trim() && 
            m.imd.trim() === imd.trim()
          ) || newMaterial;
          
          // Tăng counter số mã đã scan
          this.scannedCount++;
          
          // Hiển thị popup thành công
          this.scannedMaterialCode = materialCode;
          this.scannedSTT = updatedMaterial.stt;
          this.scannedQty = scannedQty;
          this.scannedPO = poNumber;
          this.showScanSuccessPopup = true;
          
          // Add to history
          this.scanHistory.unshift(`✓ ${materialCode} | PO: ${poNumber} | Qty: ${quantity} (MỚI)`);
          if (this.scanHistory.length > 5) {
            this.scanHistory.pop();
          }
          
          this.scanMessage = `✓ Đã thêm mới và kiểm tra: ${materialCode}\nPO: ${poNumber} | Số lượng: ${quantity}\nVị trí: ${this.currentScanLocation}\n\nScan mã tiếp theo (cùng vị trí)`;
          
          // Clear input ngay lập tức để có thể scan tiếp
          this.scanInput = '';
          
          // Tự động đóng popup sau 1.5 giây và focus lại input
          setTimeout(() => {
            this.closeScanSuccessPopup();
          }, 1500);
          
          // Update filtered materials và displayed materials (không block scan - async)
          setTimeout(() => {
            // Nếu đang ở filter mode 'all' hoặc 'outside', hiển thị material mới
            if (this.filterMode === 'all' || this.filterMode === 'outside') {
              // Tìm page chứa material mới
              const materialIndex = this.filteredMaterials.findIndex(m => 
                m.materialCode === materialCode && 
                m.poNumber === poNumber && 
                m.imd === imd
              );
              
              if (materialIndex >= 0) {
                const page = Math.floor(materialIndex / this.itemsPerPage) + 1;
                this.currentPage = page;
                this.loadPageFromFiltered(page);
              }
            }
            
            this.cdr.detectChanges();
          }, 0);
        }
      } else {
        this.scanMessage = '❌ Mã không hợp lệ!\n\nFormat: Mã|PO|Số lượng|IMD\n\nScan lại';
        this.scanInput = '';
        this.cdr.detectChanges();
      }
      
      // Re-focus input for next scan
      setTimeout(() => {
        const input = document.getElementById('scan-input') as HTMLInputElement;
        if (input) input.focus();
      }, 100);
    }
  }

  /**
   * Handle input change (auto-detect when scanner finishes)
   */
  onScanInputChange(): void {
    // Scanner typically sends data very fast followed by Enter
    // We'll rely on Enter key or manual submission
  }

  /**
   * Close scan modal
   */
  closeScanModal(): void {
    this.showScanModal = false;
    this.scanStep = 'idle';
    this.scannedEmployeeId = '';
    this.scanMessage = '';
    this.scanInput = '';
    this.scanHistory = [];
    this.currentScanLocation = '';
    this.locationMaterials = [];
    
    // Hiển thị thông báo tổng số mã đã scan
    if (this.scannedCount > 0) {
      alert(`Đã scan kiểm kê: ${this.scannedCount} mã`);
      this.scannedCount = 0; // Reset counter
    }
  }
  
  /**
   * Close scan success popup
   */
  closeScanSuccessPopup(showAlert: boolean = false): void {
    this.showScanSuccessPopup = false;
    this.cdr.detectChanges();
    
    // Hiển thị thông báo tổng số mã đã scan nếu được yêu cầu (khi bấm nút đóng)
    if (showAlert && this.scannedCount > 0) {
      setTimeout(() => {
        alert(`Đã scan kiểm kê: ${this.scannedCount} mã`);
      }, 200);
    }
    
    // Focus lại input để scan tiếp
    setTimeout(() => {
      const input = document.getElementById('scan-input') as HTMLInputElement;
      if (input) {
        input.focus();
      }
    }, 100);
  }

  /**
   * Mở modal reset stock check
   */
  openResetModal(): void {
    this.showResetModal = true;
    this.resetPassword = '';
    setTimeout(() => {
      const input = document.getElementById('reset-password-input') as HTMLInputElement;
      if (input) {
        input.focus();
      }
    }, 300);
  }
  
  /**
   * Đóng modal reset
   */
  closeResetModal(): void {
    this.showResetModal = false;
    this.resetPassword = '';
  }
  
  /**
   * Reset stock check (xóa tất cả dữ liệu kiểm kê nhưng lưu vào lịch sử)
   */
  async resetStockCheck(): Promise<void> {
    if (this.resetPassword !== 'admin') {
      alert('❌ Mật khẩu không đúng!');
      return;
    }
    
    if (!this.selectedFactory) {
      alert('❌ Vui lòng chọn nhà máy trước!');
      return;
    }
    
    if (!confirm(`⚠️ Bạn có chắc muốn RESET tất cả dữ liệu kiểm kê cho ${this.selectedFactory}?\n\nLịch sử vĩnh viễn sẽ được giữ lại (không bị xóa).`)) {
      return;
    }
    
    this.isResetting = true;
    
    try {
      // XÓA SNAPSHOT (đơn giản: chỉ cần xóa 1 document)
      const snapshotDocId = `${this.selectedFactory}_stock_check_current`;
      await this.firestore
        .collection('stock-check-snapshot')
        .doc(snapshotDocId)
        .delete();
      
      console.log(`🗑️ Deleted stock check snapshot for ${this.selectedFactory} (history preserved)`);
      
      // Reset local data
      this.allMaterials.forEach(mat => {
        mat.stockCheck = '';
        mat.qtyCheck = null;
        mat.idCheck = '';
        mat.dateCheck = null;
      });
      
      // Refresh view
      this.applyFilter();
      
      alert(`✅ Đã RESET thành công!\n\nĐã xóa dữ liệu kiểm kê hiện tại. Lịch sử vĩnh viễn vẫn được giữ lại.`);
      this.closeResetModal();
    } catch (error: any) {
      console.error('❌ Error resetting stock check:', error);
      alert('❌ Lỗi khi reset: ' + (error.message || 'Unknown error'));
    } finally {
      this.isResetting = false;
    }
  }
  
  // ======================== KHSX FEATURE ========================

  /** Mở dialog KHSX */
  openKhsxDialog(): void {
    this.showKhsxDialog = true;
  }

  /** Đóng dialog KHSX */
  closeKhsxDialog(): void {
    this.showKhsxDialog = false;
  }

  /** Tải template Excel KHSX (1 cột: Mã hàng) */
  downloadKhsxTemplate(): void {
    const templateData = [{ 'Mã hàng': 'A001234' }, { 'Mã hàng': 'B056789' }];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(templateData);
    ws['!cols'] = [{ wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, 'KHSX');
    XLSX.writeFile(wb, 'Template_KHSX.xlsx');
  }

  /** Xử lý chọn file KHSX để import */
  onKhsxFileSelected(event: any): void {
    const file: File = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(ws);
        const codes: string[] = rows
          .map(row => {
            const val = row['Mã hàng'] || row['MA HANG'] || row['ma hang'] || Object.values(row)[0];
            return val ? String(val).trim().toUpperCase() : '';
          })
          .filter(c => c.length > 0);
        if (codes.length === 0) {
          alert('❌ Không tìm thấy dữ liệu mã hàng trong file. Vui lòng kiểm tra cột "Mã hàng".');
          return;
        }
        this.saveKhsxCodes(codes);
      } catch (err) {
        console.error('❌ Error reading KHSX file:', err);
        alert('❌ Lỗi khi đọc file Excel.');
      }
    };
    reader.readAsArrayBuffer(file);
    // Reset input để có thể chọn lại cùng file
    event.target.value = '';
  }

  /** Lưu danh sách mã KHSX vào Firebase (ghi đè dữ liệu cũ) */
  async saveKhsxCodes(codes: string[]): Promise<void> {
    if (!this.selectedFactory) return;
    try {
      const docId = `${this.selectedFactory}_khsx_list`;
      await this.firestore.collection('khsx').doc(docId).set({
        factory: this.selectedFactory,
        codes: codes,
        updatedAt: new Date(),
        count: codes.length
      });
      this.khsxCodes = codes;
      this.applyKhsxToMaterials();
      this.applyFilter();
      this.closeKhsxDialog();
      alert(`✅ Đã import ${codes.length} mã KHSX thành công!`);
    } catch (error) {
      console.error('❌ Error saving KHSX codes:', error);
      alert('❌ Lỗi khi lưu dữ liệu KHSX.');
    }
  }

  /** Load danh sách mã KHSX từ Firebase */
  async loadKhsxData(materials?: StockCheckMaterial[]): Promise<void> {
    if (!this.selectedFactory) return;
    try {
      const docId = `${this.selectedFactory}_khsx_list`;
      const doc = await this.firestore.collection('khsx').doc(docId).get().toPromise();
      if (doc && doc.exists) {
        const data = doc.data() as any;
        this.khsxCodes = (data.codes || []).map((c: string) => String(c).trim().toUpperCase());
      } else {
        this.khsxCodes = [];
      }
      // Áp dụng lên mảng materials truyền vào (hoặc allMaterials)
      this.applyKhsxToMaterials(materials);
    } catch (error) {
      console.error('❌ Error loading KHSX data:', error);
      this.khsxCodes = [];
    }
  }

  /** Đánh dấu hasKhsx cho từng material dựa vào khsxCodes */
  applyKhsxToMaterials(materials?: StockCheckMaterial[]): void {
    const target = materials || this.allMaterials;
    const khsxSet = new Set(this.khsxCodes);
    target.forEach(m => {
      m.hasKhsx = khsxSet.has((m.materialCode || '').trim().toUpperCase());
    });
  }

  /**
   * Export stock check report to Excel
   */
  exportStockCheckReport(): void {
    if (this.allMaterials.length === 0) {
      alert('Không có dữ liệu để xuất!');
      return;
    }

    // Prepare data for export
    const exportData = this.allMaterials.map(mat => {
      const stockVal = mat.stock != null ? parseFloat(mat.stock.toFixed(2)) : 0;
      const qtyCheckVal = mat.qtyCheck != null ? mat.qtyCheck : null;
      const soSanh = qtyCheckVal !== null ? parseFloat((stockVal - qtyCheckVal).toFixed(2)) : '';
      return {
        'STT': mat.stt,
        'Mã hàng': mat.materialCode,
        'PO': mat.poNumber,
        'IMD': mat.imd,
        'Tồn Kho': stockVal,
        'KHSX': mat.hasKhsx ? '✔' : '',
        'Vị trí': mat.location,
        'Standard Packing': mat.standardPacking || '',
        'Stock Check': mat.stockCheck || '',
        'Qty Check': qtyCheckVal !== null ? qtyCheckVal : '',
        'So Sánh Stock': soSanh,
        'ID Check': mat.idCheck || '',
        'Date Check': mat.dateCheck ? new Date(mat.dateCheck).toLocaleString('vi-VN') : ''
      };
    });

    // Create workbook
    const wb = XLSX.utils.book_new();
    
    // Create main sheet
    const ws = XLSX.utils.json_to_sheet(exportData);
    
    // Set column widths
    ws['!cols'] = [
      { wch: 6 },  // STT
      { wch: 15 }, // Mã hàng
      { wch: 12 }, // PO
      { wch: 10 }, // IMD
      { wch: 10 }, // Tồn Kho
      { wch: 8 },  // KHSX
      { wch: 12 }, // Vị trí
      { wch: 18 }, // Standard Packing
      { wch: 12 }, // Stock Check
      { wch: 10 }, // Qty Check
      { wch: 15 }, // So Sánh Stock
      { wch: 15 }, // ID Check
      { wch: 20 }  // Date Check
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Stock Check');

    // Create summary sheet
    const summary = [
      { 'Thông tin': 'Factory', 'Giá trị': this.selectedFactory },
      { 'Thông tin': 'Ngày xuất', 'Giá trị': new Date().toLocaleString('vi-VN') },
      { 'Thông tin': 'Tổng mã', 'Giá trị': this.totalMaterials },
      { 'Thông tin': 'Đã kiểm tra', 'Giá trị': this.checkedMaterials },
      { 'Thông tin': 'Chưa kiểm tra', 'Giá trị': this.uncheckedMaterials },
      { 'Thông tin': 'Tỷ lệ hoàn thành', 'Giá trị': `${((this.checkedMaterials / this.totalMaterials) * 100).toFixed(2)}%` }
    ];

    const wsSummary = XLSX.utils.json_to_sheet(summary);
    wsSummary['!cols'] = [{ wch: 20 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Tóm tắt');

    // Save file
    const fileName = `Stock_Check_${this.selectedFactory}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);

    console.log(`✅ Exported stock check report: ${fileName}`);
  }
}
