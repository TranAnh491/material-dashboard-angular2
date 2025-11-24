import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
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
  scanStep: 'idle' | 'employee' | 'material' = 'idle';
  scannedEmployeeId = '';
  showScanModal = false;
  scanMessage = '';
  scanInput = '';
  scanHistory: string[] = [];

  // Filter state
  filterMode: 'all' | 'checked' | 'unchecked' | 'outside' = 'all';
  
  // Search
  searchInput: string = '';
  
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

  // Counters
  get totalMaterials(): number {
    return this.allMaterials.length;
  }

  get checkedMaterials(): number {
    return this.allMaterials.filter(m => m.stockCheck === '✓').length;
  }

  get uncheckedMaterials(): number {
    return this.totalMaterials - this.checkedMaterials;
  }

  get outsideStockMaterials(): number {
    // Đếm các materials được thêm mới khi scan (không có trong tồn kho ban đầu)
    return this.allMaterials.filter(m => m.isNewMaterial === true).length;
  }

  /**
   * Set filter mode
   */
  setFilterMode(mode: 'all' | 'checked' | 'unchecked' | 'outside'): void {
    this.filterMode = mode;
    this.applyFilter();
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
      filtered = filtered.filter(m => m.isNewMaterial === true);
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
    } else if (this.filterMode === 'outside') {
      filtered = filtered.filter(m => m.isNewMaterial === true);
    }
    
    // Sort alphabetically
    filtered.sort((a, b) => a.materialCode.localeCompare(b.materialCode));

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

  ngOnInit(): void {
    // Reset factory selection to show selection screen
    this.selectedFactory = null;
    this.allMaterials = [];
    this.filteredMaterials = [];
    this.displayedMaterials = [];
    this.currentPage = 1;
    this.filterMode = 'all';
  }

  ngOnDestroy(): void {
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

    console.log(`📊 Loading data for factory: ${this.selectedFactory}`);
    this.isLoading = true;
    this.allMaterials = [];
    this.displayedMaterials = [];

    // Load inventory materials
    this.firestore
      .collection('inventory-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
      )
      .valueChanges({ idField: 'id' })
      .pipe(takeUntil(this.destroy$))
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
            id: mat.id || ''
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
            batchNumber: mat.batchNumber
          };
        });
        
        console.log(`📊 Stock Check: Loaded ${materialsArray.length} materials (KHÔNG group - giống materials-asm1)`);
        console.log(`📊 Stock Check: Total from inventory-materials: ${materials.length}, After filter A/B: ${materialsArray.length}`);

        // Load stock check data from Firebase
        await this.loadStockCheckData(materialsArray);

        this.allMaterials = materialsArray;
        
        // Calculate ID check statistics
        this.calculateIdCheckStats();

        // Sort alphabetically by material code
        this.allMaterials.sort((a, b) => a.materialCode.localeCompare(b.materialCode));

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
        
        this.isLoading = false;
      });
  }

  /**
   * Load stock check data from Firebase
   */
  async loadStockCheckData(materials: StockCheckMaterial[]): Promise<void> {
    try {
      console.log(`🔍 [loadStockCheckData] Loading stock-check for factory: ${this.selectedFactory}`);
      console.log(`🔍 [loadStockCheckData] Environment production: ${environment.production}`);
      console.log(`🔍 [loadStockCheckData] Firebase projectId: ${environment.firebase.projectId}`);
      
      const stockCheckSnapshot = await this.firestore
        .collection('stock-check', ref =>
          ref.where('factory', '==', this.selectedFactory)
        )
        .get()
        .toPromise();

      console.log(`📦 [loadStockCheckData] Found ${stockCheckSnapshot?.size || 0} stock-check records`);
      
      // Log first few documents for debugging
      if (stockCheckSnapshot && !stockCheckSnapshot.empty) {
        const firstFew = stockCheckSnapshot.docs.slice(0, 3).map(doc => {
          const data = doc.data() as StockCheckData;
          return {
            id: doc.id,
            materialCode: data.materialCode,
            poNumber: data.poNumber,
            imd: data.imd,
            factory: data.factory,
            qtyCheck: data.qtyCheck
          };
        });
        console.log(`📋 [loadStockCheckData] Sample documents:`, firstFew);
      }
      
      if (stockCheckSnapshot && !stockCheckSnapshot.empty) {
        const stockCheckMap = new Map<string, StockCheckData>();
        
        stockCheckSnapshot.forEach(doc => {
          const data = doc.data() as StockCheckData;
          const key = `${data.materialCode}_${data.poNumber}_${data.imd}`;
          stockCheckMap.set(key, data);
        });

        console.log(`📊 [loadStockCheckData] Mapped ${stockCheckMap.size} unique items`);

        // Apply stock check data to materials
        let matchedCount = 0;
        let unmatchedKeys: string[] = [];
        
        materials.forEach(mat => {
          // Try exact match first
          const key = `${mat.materialCode}_${mat.poNumber}_${mat.imd}`;
          let checkData = stockCheckMap.get(key);
          
          // If not found, try matching without case sensitivity and trimming
          if (!checkData) {
            const normalizedKey = `${mat.materialCode.trim().toUpperCase()}_${mat.poNumber.trim()}_${mat.imd.trim()}`;
            for (const [mapKey, mapData] of stockCheckMap.entries()) {
              const normalizedMapKey = `${mapData.materialCode.trim().toUpperCase()}_${mapData.poNumber.trim()}_${mapData.imd.trim()}`;
              if (normalizedKey === normalizedMapKey) {
                checkData = mapData;
                console.log(`🔄 [loadStockCheckData] Matched with normalized key: ${key} -> ${mapKey}`);
                break;
              }
            }
          }
          
          // If still not found, try matching by materialCode + PO only (ignore IMD)
          if (!checkData) {
            const candidates = Array.from(stockCheckMap.values()).filter(data => 
              data.materialCode.trim().toUpperCase() === mat.materialCode.trim().toUpperCase() &&
              data.poNumber.trim() === mat.poNumber.trim()
            );
            if (candidates.length === 1) {
              checkData = candidates[0];
              console.log(`🔄 [loadStockCheckData] Matched by code+PO only (ignoring IMD): ${mat.materialCode}_${mat.poNumber}`);
            } else if (candidates.length > 1) {
              console.log(`⚠️ [loadStockCheckData] Multiple candidates found for ${mat.materialCode}_${mat.poNumber}, using first one`);
              checkData = candidates[0];
            }
          }
          
          if (checkData) {
            mat.stockCheck = '✓';
            mat.qtyCheck = checkData.qtyCheck;
            mat.idCheck = checkData.idCheck;
            mat.dateCheck = checkData.dateCheck?.toDate ? checkData.dateCheck.toDate() : checkData.dateCheck;
            matchedCount++;
          } else {
            unmatchedKeys.push(key);
          }
        });

        console.log(`✅ [loadStockCheckData] Applied stock check data to ${matchedCount} materials`);
        if (unmatchedKeys.length > 0 && unmatchedKeys.length <= 10) {
          console.log(`⚠️ [loadStockCheckData] Unmatched keys (first 10):`, unmatchedKeys.slice(0, 10));
        }
        
        // Log sample of stock-check keys for debugging
        if (stockCheckMap.size > 0) {
          const sampleKeys = Array.from(stockCheckMap.keys()).slice(0, 5);
          console.log(`📋 [loadStockCheckData] Sample stock-check keys:`, sampleKeys);
        }
      } else {
        console.log(`⚠️ [loadStockCheckData] No stock-check data found for factory: ${this.selectedFactory}`);
      }
    } catch (error) {
      console.error('❌ [loadStockCheckData] Error loading stock check data:', error);
    }
  }

  /**
   * Save stock check data to Firebase
   */
  async saveStockCheckToFirebase(material: StockCheckMaterial, scannedQty?: number): Promise<void> {
    try {
      // Replace special characters that are not allowed in Firebase document IDs
      const sanitizedMaterialCode = material.materialCode.replace(/\//g, '_');
      const sanitizedPoNumber = material.poNumber.replace(/\//g, '_');
      const sanitizedImd = material.imd.replace(/\//g, '_');
      
      const docId = `${this.selectedFactory}_${sanitizedMaterialCode}_${sanitizedPoNumber}_${sanitizedImd}`;
      
      // Get existing document to preserve check history và lấy qtyCheck hiện tại từ Firebase
      const existingDoc = await this.firestore
        .collection('stock-check')
        .doc(docId)
        .get()
        .toPromise();
      
      let checkHistory: CheckHistoryItem[] = [];
      let existingQtyCheck = 0;
      
      if (existingDoc && existingDoc.exists) {
        const existingData = existingDoc.data() as StockCheckData;
        checkHistory = existingData.checkHistory || [];
        existingQtyCheck = existingData.qtyCheck || 0;
      }
      
      // CỘNG DỒN: Lấy giá trị từ Firebase + số lượng mới scan
      // Nếu có scannedQty (số lượng vừa scan), thì cộng với existingQtyCheck
      // Nếu không có, dùng material.qtyCheck (đã được cộng dồn ở local)
      const newQty = scannedQty !== undefined ? scannedQty : (material.qtyCheck || 0);
      const finalQtyCheck = existingQtyCheck + newQty;
      
      // Update material.qtyCheck với giá trị đã cộng dồn từ Firebase
      material.qtyCheck = finalQtyCheck;
      
      // Add current check to history (lưu số lượng mới scan, không phải tổng)
      const historyItem: CheckHistoryItem = {
        idCheck: material.idCheck,
        qtyCheck: newQty, // Lưu số lượng vừa scan (chưa cộng dồn)
        dateCheck: material.dateCheck || new Date(),
        updatedAt: new Date()
      };
      
      // Add to history (avoid duplicates by checking if same ID and date within 1 minute)
      const isDuplicate = checkHistory.some(item => {
        const itemDate = item.dateCheck?.toDate ? item.dateCheck.toDate() : new Date(item.dateCheck);
        const newDate = historyItem.dateCheck?.toDate ? historyItem.dateCheck.toDate() : new Date(historyItem.dateCheck);
        const timeDiff = Math.abs(itemDate.getTime() - newDate.getTime());
        return item.idCheck === historyItem.idCheck && timeDiff < 60000; // 1 minute
      });
      
      if (!isDuplicate) {
        checkHistory.push(historyItem);
        // Keep only last 50 history items
        if (checkHistory.length > 50) {
          checkHistory = checkHistory.slice(-50);
        }
      }
      
      const checkData = {
        factory: this.selectedFactory,
        materialCode: material.materialCode,
        poNumber: material.poNumber,
        imd: material.imd,
        stockCheck: material.stockCheck,
        qtyCheck: finalQtyCheck, // Tổng số lượng đã cộng dồn
        idCheck: material.idCheck,
        dateCheck: material.dateCheck,
        checkHistory: checkHistory,
        updatedAt: new Date()
      };

      await this.firestore
        .collection('stock-check')
        .doc(docId)
        .set(checkData, { merge: true });

      console.log(`✅ Saved stock check to Firebase: ${material.materialCode} | Qty: ${finalQtyCheck} (scanned: ${newQty}, existing: ${existingQtyCheck})`);
      
      // LƯU VÀO LỊCH SỬ VĨNH VIỄN (không bị xóa khi RESET)
      await this.saveToPermanentHistory(material, newQty, historyItem);
      
      // Recalculate ID stats
      this.calculateIdCheckStats();
    } catch (error) {
      console.error('❌ Error saving stock check to Firebase:', error);
    }
  }

  /**
   * Lưu vào lịch sử vĩnh viễn (collection riêng, không bị xóa khi RESET)
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
      
      console.log(`📝 Saved to permanent history: ${material.materialCode} | Qty: ${scannedQty}`);
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
    
    // Đã có mã nhân viên, chỉ cần scan mã hàng
    this.showScanModal = true;
    this.scanStep = 'material'; // Bỏ qua bước scan employee
    this.scannedEmployeeId = this.currentEmployeeId; // Dùng mã nhân viên đã đăng nhập
    this.scanInput = '';
    this.scanMessage = `ID: ${this.currentEmployeeId}\n\nScan mã hàng hóa`;
    this.scanHistory = [];
    
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

    if (this.scanStep === 'material') {
      // Đảm bảo có mã nhân viên từ currentEmployeeId
      if (!this.currentEmployeeId) {
        // Nếu không có mã nhân viên, đóng modal và yêu cầu scan lại
        this.closeScanModal();
        alert('Vui lòng scan mã nhân viên trước!');
        this.showEmployeeScanModal = true;
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
          
          // Update the material - CỘNG DỒN số lượng thay vì ghi đè
          matchingMaterial.stockCheck = '✓';
          matchingMaterial.idCheck = this.scannedEmployeeId;
          matchingMaterial.dateCheck = new Date();
          
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
          
          this.scanMessage = `✓ Đã kiểm tra: ${materialCode}\nPO: ${poNumber} | Số lượng: ${quantity}\n\nScan mã tiếp theo`;
          
          // Refresh the current view to show updated check status
          this.applyFilter();
          
          this.scanInput = '';
          this.cdr.detectChanges();
        } else {
          // Không tìm thấy trong bảng - tạo material mới và thêm vào
          console.log('📝 Material not found in table, creating new entry:', { materialCode, poNumber, imd, quantity });
          
          const newMaterial: StockCheckMaterial = {
            stt: this.allMaterials.length + 1,
            materialCode: materialCode,
            poNumber: poNumber,
            imd: imd,
            stock: 0, // Không có thông tin stock từ scan
            location: '', // Không có thông tin location từ scan
            standardPacking: '', // Sẽ tải sau nếu cần
            stockCheck: '✓',
            qtyCheck: parseFloat(quantity),
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
          
          // Lưu vào Firebase
          await this.saveStockCheckToFirebase(newMaterial);
          
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
          
          // Add to history
          this.scanHistory.unshift(`✓ ${materialCode} | PO: ${poNumber} | Qty: ${quantity} (MỚI)`);
          if (this.scanHistory.length > 5) {
            this.scanHistory.pop();
          }
          
          this.scanMessage = `✓ Đã thêm mới và kiểm tra: ${materialCode}\nPO: ${poNumber} | Số lượng: ${quantity}\n\nScan mã tiếp theo`;
          
          // Refresh the current view to show new material
          this.applyFilter();
          
          this.scanInput = '';
          this.cdr.detectChanges();
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
      // CHỈ XÓA DỮ LIỆU TRONG stock-check (KHÔNG XÓA stock-check-history)
      const stockCheckRef = this.firestore.collection('stock-check', ref =>
        ref.where('factory', '==', this.selectedFactory)
      );
      
      const snapshot = await stockCheckRef.get().toPromise();
      
      if (snapshot && !snapshot.empty) {
        // Xóa dữ liệu trong collection stock-check
        const deletePromises = snapshot.docs.map(doc => doc.ref.delete());
        await Promise.all(deletePromises);
        console.log(`🗑️ Deleted ${snapshot.docs.length} stock check records (history preserved)`);
      }
      
      // Reset local data
      this.allMaterials.forEach(mat => {
        mat.stockCheck = '';
        mat.qtyCheck = null;
        mat.idCheck = '';
        mat.dateCheck = null;
      });
      
      // Refresh view
      this.applyFilter();
      
      alert(`✅ Đã RESET thành công!\n\nĐã lưu ${snapshot?.docs.length || 0} bản ghi vào lịch sử và xóa dữ liệu hiện tại.`);
      this.closeResetModal();
    } catch (error: any) {
      console.error('❌ Error resetting stock check:', error);
      alert('❌ Lỗi khi reset: ' + (error.message || 'Unknown error'));
    } finally {
      this.isResetting = false;
    }
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
    const exportData = this.allMaterials.map(mat => ({
      'STT': mat.stt,
      'Mã hàng': mat.materialCode,
      'PO': mat.poNumber,
      'IMD': mat.imd,
      'Tồn Kho': mat.stock,
      'Vị trí': mat.location,
      'Standard Packing': mat.standardPacking || '',
      'Stock Check': mat.stockCheck || '',
      'Qty Check': mat.qtyCheck || '',
      'So Sánh Stock': mat.qtyCheck !== null ? (mat.stock - (mat.qtyCheck || 0)) : '',
      'ID Check': mat.idCheck || '',
      'Date Check': mat.dateCheck ? new Date(mat.dateCheck).toLocaleString('vi-VN') : ''
    }));

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
