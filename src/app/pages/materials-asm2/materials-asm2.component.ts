import { Component, OnInit, OnDestroy, AfterViewInit, HostListener, ChangeDetectorRef } from '@angular/core';
import { Subject, BehaviorSubject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import * as XLSX from 'xlsx';
import * as QRCode from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';
import { MatDialog } from '@angular/material/dialog';
import { TabPermissionService } from '../../services/tab-permission.service';
import { FactoryAccessService } from '../../services/factory-access.service';
import { ExcelImportService } from '../../services/excel-import.service';
import { ImportProgressDialogComponent } from '../../components/import-progress-dialog/import-progress-dialog.component';
import { QRScannerModalComponent, QRScannerData } from '../../components/qr-scanner-modal/qr-scanner-modal.component';

export interface InventoryMaterial {
  id?: string;
  factory?: string;
  importDate: Date;
  receivedDate?: Date;
  batchNumber: string;
  materialCode: string;
  materialName?: string;
  poNumber: string;
  openingStock: number | null; // Tồn đầu - nhập tay được, có thể null
  quantity: number;
  unit: string;
  exported?: number;
  xt?: number; // Số lượng cần xuất (nhập tay)
  stock?: number;
  location: string;
  type: string;
  expiryDate: Date;
  qualityCheck: boolean;
  isReceived: boolean;
  notes: string;
  rollsOrBags: string;
  supplier: string;
  remarks: string;
  standardPacking?: number;
  isCompleted: boolean;
  isDuplicate?: boolean;
  importStatus?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

@Component({
  selector: 'app-materials-asm2',
  templateUrl: './materials-asm2.component.html',
  styleUrls: ['./materials-asm2.component.scss']
})
export class MaterialsASM2Component implements OnInit, OnDestroy, AfterViewInit {
  // Fixed factory for ASM2
  readonly FACTORY = 'ASM2';
  
  // 🔧 LOGIC MỚI: Cập nhật số lượng xuất từ Outbound theo Material + PO
  // - Mỗi dòng Inventory được cập nhật số lượng xuất DỰA TRÊN Material + PO
  // - Outbound RM2 scan/nhập: Material + PO (không còn vị trí)
  // - Hệ thống sẽ tìm tất cả outbound records có cùng Material + PO và cộng dồn
  // - KHÔNG còn bị lỗi số âm sai khi search
  
  // Data properties
  inventoryMaterials: InventoryMaterial[] = [];
  filteredInventory: InventoryMaterial[] = [];
  
  // Loading state
  isLoading = false;
  isCatalogLoading = false;
  
  // Consolidation status
  consolidationMessage = '';
  showConsolidationMessage = false;
  
  // Catalog cache for faster access
  private catalogCache = new Map<string, any>();
  public catalogLoaded = false;
  
  // Search and filter
  searchTerm = '';
  searchType: 'material' | 'po' | 'location' = 'material';
  private searchSubject = new Subject<string>();
  
  // Negative stock tracking
  private negativeStockSubject = new BehaviorSubject<number>(0);
  public negativeStockCount$ = this.negativeStockSubject.asObservable();
  
  // Total stock tracking
  private totalStockSubject = new BehaviorSubject<number>(0);
  public totalStockCount$ = this.totalStockSubject.asObservable();
  
  // Negative stock filter state
  showOnlyNegativeStock = false;
  
  // Export column lock state
  isExportColumnUnlocked = false;
  
  // Dropdown state
  isDropdownOpen = false;
  
  // Show completed items
  // showCompleted = true; // Removed - replaced with Reset function
  
  // Lifecycle
  private destroy$ = new Subject<void>();
  
  // QR Scanner
  private html5QrCode: Html5Qrcode | null = null;
  isScanning = false;
  
  // Permissions
  canView = false;
  canEdit = false;
  canExport = false;
  canDelete = false;
  // canEditHSD = false; // Removed - HSD column deleted

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private cdr: ChangeDetectorRef,
    private tabPermissionService: TabPermissionService,
    private factoryAccessService: FactoryAccessService,
    private excelImportService: ExcelImportService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    console.log('🔍 DEBUG: ngOnInit - Starting component initialization');
    
    // Load catalog first for material names mapping
    this.loadCatalogFromFirebase().then(() => {
      console.log('📚 ASM2 Catalog loaded, inventory ready for search');
    });
    this.loadPermissions();
    
    // Load inventory data and setup search after data is loaded
    this.loadInventoryAndSetupSearch();
    
    // Initialize negative stock count and total stock count
    this.updateNegativeStockCount();
    
    console.log('✅ ASM2 Materials component initialized - Search setup will happen after data loads');
    console.log('🔍 DEBUG: ngOnInit - Component initialization completed');
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.autoResizeNotesColumn();
    }, 1000);
  }

  ngOnDestroy(): void {
    this.stopScanning();
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Setup debounced search for better performance
  private setupDebouncedSearch(): void {
    this.searchSubject.pipe(
      debounceTime(2000), // Đợi 2 giây sau khi user ngừng gõ
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(searchTerm => {
      this.performSearch(searchTerm);
    });
  }

  // Load inventory data from Firebase - ONLY ASM2
  loadInventoryFromFirebase(): void {
    console.log('📦 Loading ASM2 inventory from Firebase...');
    this.isLoading = true;
    
    this.firestore.collection('inventory-materials', ref => 
      ref.where('factory', '==', this.FACTORY)
    )
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((actions) => {
        this.inventoryMaterials = actions
          .map(action => {
            const data = action.payload.doc.data() as any;
            const id = action.payload.doc.id;
            const material = {
              id: id,
              ...data,
              factory: this.FACTORY, // Force ASM2
              importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : new Date(),
              receivedDate: data.receivedDate ? new Date(data.receivedDate.seconds * 1000) : new Date(),
              expiryDate: data.expiryDate ? new Date(data.expiryDate.seconds * 1000) : new Date()
            };
            
            // Apply catalog data if available
            if (this.catalogLoaded && this.catalogCache.has(material.materialCode)) {
              const catalogItem = this.catalogCache.get(material.materialCode)!;
              material.materialName = catalogItem.materialName;
              material.unit = catalogItem.unit;
            }
            
            return material;
          })
          .filter(material => material.factory === this.FACTORY); // Double check ASM2 only

        // Set filteredInventory to show all loaded items initially
        this.filteredInventory = [...this.inventoryMaterials];
        
        // Mark duplicates for display
        this.markDuplicates();
        
        this.isLoading = false;
        
        console.log(`✅ Loaded ${this.inventoryMaterials.length} ASM2 inventory items`);
      }, error => {
        console.error('Error loading ASM2 inventory:', error);
        this.isLoading = false;
      });
  }

  // Load inventory and setup search mechanism
  private loadInventoryAndSetupSearch(): void {
    console.log('📦 Setting up search mechanism without loading initial data...');
    
    // Don't load any data initially - only setup search
    this.inventoryMaterials = [];
    this.filteredInventory = [];
    
    // Setup search mechanism immediately
    console.log('🔍 Setting up search mechanism...');
    this.setupDebouncedSearch();
    console.log('✅ Search mechanism setup completed - No initial data loaded');
  }

  // Load catalog from Firebase
  private async loadCatalogFromFirebase(): Promise<void> {
    this.isCatalogLoading = true;
    console.log('📋 Loading catalog from Firebase...');
    
    try {
      const snapshot = await this.firestore.collection('material-catalog').get().toPromise();
      
      if (snapshot && !snapshot.empty) {
        this.catalogCache.clear();
        
        snapshot.forEach(doc => {
          const data = doc.data() as any;
          if (data.materialCode && data.materialName) {
            this.catalogCache.set(data.materialCode, {
              materialCode: data.materialCode,
              materialName: data.materialName,
              unit: data.unit || 'PCS'
            });
          }
        });
        
        this.catalogLoaded = true;
        console.log(`✅ Loaded ${this.catalogCache.size} catalog items from Firebase`);
        
        // Update any existing inventory items with catalog names
        if (this.inventoryMaterials.length > 0) {
          this.inventoryMaterials.forEach(material => {
            if (this.catalogCache.has(material.materialCode)) {
              const catalogItem = this.catalogCache.get(material.materialCode)!;
              material.materialName = catalogItem.materialName;
              material.unit = catalogItem.unit;
            }
          });
          this.cdr.detectChanges();
        }
      } else {
        console.warn('No catalog data found in Firebase');
        this.catalogLoaded = true;
      }
    } catch (error) {
      console.error('Error loading catalog from Firebase:', error);
      this.catalogLoaded = true;
    } finally {
      this.isCatalogLoading = false;
    }
  }

  // Apply filters to inventory
  applyFilters(): void {
    this.filteredInventory = this.inventoryMaterials.filter(material => {
      // Always filter by ASM2 only
      if (material.factory !== this.FACTORY) {
        return false;
      }

      // Apply search filter based on search type
      if (this.searchTerm) {
        const searchTermLower = this.searchTerm.toLowerCase();
        
        switch (this.searchType) {
          case 'material':
            // Search by material code or name
            if (!material.materialCode?.toLowerCase().includes(searchTermLower) &&
                !material.materialName?.toLowerCase().includes(searchTermLower)) {
          return false;
        }
            break;
            
          case 'po':
            // Search by PO number
            if (!material.poNumber?.toLowerCase().includes(searchTermLower)) {
              return false;
            }
            break;
            
          case 'location':
            // Search by location
            if (!material.location?.toLowerCase().includes(searchTermLower)) {
              return false;
            }
            break;
        }
      }
      
      return true;
    });

    // Sort by Material Code -> PO (oldest first) - SIMPLE FIFO LOGIC
    this.filteredInventory.sort((a, b) => {
      // First compare by Material Code (group same materials together)
        const materialComparison = this.compareMaterialCodesFIFO(a.materialCode, b.materialCode);
        if (materialComparison !== 0) {
          return materialComparison;
        }
        
      // If same material code, sort by PO: Year -> Month -> Sequence (oldest first)
        return this.comparePOFIFO(a.poNumber, b.poNumber);
    });
    
    // Mark duplicates
    this.markDuplicates();
    
    console.log('🔍 ASM2 filters applied. Items found:', this.filteredInventory.length);
  }

  // New optimized search method
  onSearchInput(event: any): void {
    let searchTerm = event.target.value;
    console.log('🔍 ASM2 Search input:', searchTerm);
    
    // Auto-convert to uppercase (only if different to avoid infinite loop)
    if (searchTerm && searchTerm !== searchTerm.toUpperCase()) {
      searchTerm = searchTerm.toUpperCase();
      // Use setTimeout to avoid infinite loop with ngModel
      setTimeout(() => {
        event.target.value = searchTerm;
        this.searchTerm = searchTerm;
      }, 0);
    }
    
    // Clear results immediately if search is empty
    if (!searchTerm || searchTerm.trim() === '') {
      this.clearSearch();
      return;
    }
    
    // Send to debounced search
    this.searchSubject.next(searchTerm);
  }

  // Handle search input with better uppercase conversion
  onSearchKeyUp(event: any): void {
    const searchTerm = event.target.value;
    
    // Convert to uppercase on key up
    if (searchTerm && searchTerm !== searchTerm.toUpperCase()) {
      event.target.value = searchTerm.toUpperCase();
      this.searchTerm = searchTerm.toUpperCase();
    }
  }





  // Clear search and reset to initial state
  clearSearch(): void {
    this.searchTerm = '';
    this.filteredInventory = [];
    this.inventoryMaterials = [];
    
    // Reset negative stock filter
    this.showOnlyNegativeStock = false;
    
    // Return to initial state - no data displayed
    console.log('🧹 ASM2 Search cleared, returning to initial state (no data displayed)');
  }

  // Perform search with Search-First approach for ASM2 - IMPROVED VERSION
  private async performSearch(searchTerm: string): Promise<void> {
    if (searchTerm.length === 0) {
      this.filteredInventory = [];
      this.searchTerm = '';
      this.inventoryMaterials = []; // Clear loaded data
      return;
    }
    
    // Chỉ search khi có ít nhất 3 ký tự để tránh mất thời gian
    if (searchTerm.length < 3) {
      this.filteredInventory = [];
      console.log(`⏰ ASM2 Search term "${searchTerm}" quá ngắn (cần ít nhất 3 ký tự)`);
      return;
    }
    
    this.searchTerm = searchTerm;
    this.isLoading = true;
    
    try {
      console.log(`🔍 ASM2 Searching for: "${searchTerm}" - Loading from Firebase...`);
      
      // IMPROVED: Query Firebase với nhiều điều kiện hơn để tìm kiếm toàn diện
      let querySnapshot;
      
      // Thử tìm kiếm theo materialCode trước (chính xác nhất) - ASM2 only
      querySnapshot = await this.firestore.collection('inventory-materials', ref => 
        ref.where('factory', '==', this.FACTORY)
           .where('materialCode', '==', searchTerm)
           .limit(50)
      ).get().toPromise();
      
      // Nếu không tìm thấy, tìm kiếm theo pattern matching
      if (!querySnapshot || querySnapshot.empty) {
        console.log(`🔍 ASM2 No exact match for "${searchTerm}", trying pattern search...`);
        
        querySnapshot = await this.firestore.collection('inventory-materials', ref => 
          ref.where('factory', '==', this.FACTORY)
             .where('materialCode', '>=', searchTerm)
             .where('materialCode', '<=', searchTerm + '\uf8ff')
             .limit(100)
        ).get().toPromise();
      }
      
      // Nếu vẫn không tìm thấy, tìm kiếm theo PO number
      if (!querySnapshot || querySnapshot.empty) {
        console.log(`🔍 ASM2 No pattern match for "${searchTerm}", trying PO search...`);
        
        querySnapshot = await this.firestore.collection('inventory-materials', ref => 
          ref.where('factory', '==', this.FACTORY)
             .where('poNumber', '>=', searchTerm)
             .where('poNumber', '<=', searchTerm + '\uf8ff')
             .limit(100)
        ).get().toPromise();
      }
      
      if (querySnapshot && !querySnapshot.empty) {
        console.log(`✅ ASM2 Found ${querySnapshot.docs.length} documents from Firebase`);
        
        // Process search results
        this.inventoryMaterials = querySnapshot.docs.map(doc => {
          const data = doc.data() as any;
          const material = {
            id: doc.id,
            ...data,
            factory: this.FACTORY, // Force ASM2
            importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : new Date(),
            receivedDate: data.receivedDate ? new Date(data.receivedDate.seconds * 1000) : new Date(),
            expiryDate: data.expiryDate ? new Date(data.expiryDate.seconds * 1000) : new Date()
          };
          
          // Apply catalog data if available
          if (this.catalogLoaded && this.catalogCache.has(material.materialCode)) {
            const catalogItem = this.catalogCache.get(material.materialCode)!;
            material.materialName = catalogItem.materialName;
            material.unit = catalogItem.unit;
          }
          
          return material;
        });
        
        // IMPROVED: Không cần filter thêm nữa vì đã query chính xác từ Firebase
        this.filteredInventory = [...this.inventoryMaterials];
        
        console.log(`✅ ASM2 Search completed: ${this.filteredInventory.length} results from ${this.filteredInventory.length} loaded items`);
        
        // Debug: Log tất cả material codes tìm được
        const materialCodes = this.filteredInventory.map(item => item.materialCode);
        console.log(`🔍 ASM2 Found material codes:`, materialCodes);
        
      } else {
        // No results found
        this.inventoryMaterials = [];
        this.filteredInventory = [];
        console.log(`🔍 ASM2 No results found for: "${searchTerm}" after trying all search methods`);
      }
      
    } catch (error) {
      console.error('❌ ASM2 Error during search:', error);
      this.filteredInventory = [];
    } finally {
      this.isLoading = false;
    }
  }

  // Track by function for ngFor optimization
  trackByFn(index: number, item: any): any {
    return item.id || index;
  }

  // Get count of materials with negative stock
  getNegativeStockCount(): number {
    // Always count from inventoryMaterials (not filteredInventory) to get real total
    const count = this.inventoryMaterials.filter(material => {
      const stock = this.calculateCurrentStock(material);
      return stock < 0;
    }).length;
    
    // Emit new value to BehaviorSubject for real-time updates
    this.negativeStockSubject.next(count);
    
    console.log(`📊 Negative stock count calculated: ${count} from total ${this.inventoryMaterials.length} materials`);
    
    return count;
  }

  // Update negative stock count manually (for real-time updates)
  private updateNegativeStockCount(): void {
    const count = this.getNegativeStockCount();
    console.log(`📊 Negative stock count updated: ${count}`);
    
    // Also update total stock count
    this.updateTotalStockCount();
  }
  
  // Update total stock count for real-time display
  private updateTotalStockCount(): void {
    if (!this.filteredInventory || this.filteredInventory.length === 0) {
      this.totalStockSubject.next(0);
      return;
    }
    
    const totalStock = this.filteredInventory.reduce((sum, material) => {
      return sum + this.calculateCurrentStock(material);
    }, 0);
    
    this.totalStockSubject.next(totalStock);
    console.log(`📊 Total stock count updated: ${totalStock}`);
  }

  // Calculate current stock for display
  calculateCurrentStock(material: InventoryMaterial): number {
    const openingStockValue = material.openingStock !== null ? material.openingStock : 0;
    const stock = openingStockValue + (material.quantity || 0) - (material.exported || 0) - (material.xt || 0);
    return stock;
  }

  // Calculate total stock for all filtered materials
  getTotalStock(): number {
    if (!this.filteredInventory || this.filteredInventory.length === 0) {
      return 0;
    }
    
    const totalStock = this.filteredInventory.reduce((sum, material) => {
      return sum + this.calculateCurrentStock(material);
    }, 0);
    
    // Update the BehaviorSubject for reactive updates
    this.totalStockSubject.next(totalStock);
    
    return totalStock;
  }

  // Compare material codes for FIFO sorting
  private compareMaterialCodesFIFO(codeA: string, codeB: string): number {
    if (!codeA || !codeB) return 0;
    
    // Extract first letter and 6-digit number
    const parseCode = (code: string) => {
      const match = code.match(/^([ABR])(\d{6})/);
      if (!match) return { letter: 'Z', number: 999999 }; // Put invalid codes at end
      return { 
        letter: match[1], 
        number: parseInt(match[2], 10) 
      };
    };
    
    const parsedA = parseCode(codeA);
    const parsedB = parseCode(codeB);
    
    // Priority order: A -> B -> R
    const letterOrder = { 'A': 1, 'B': 2, 'R': 3, 'Z': 999 };
    
    // Compare by letter first
    const letterComparison = letterOrder[parsedA.letter] - letterOrder[parsedB.letter];
    if (letterComparison !== 0) {
      return letterComparison;
    }
    
    // If same letter, compare by number (ascending order for FIFO)
    return parsedA.number - parsedB.number;
  }

  // Compare PO numbers for FIFO sorting (older first) - FIXED LOGIC
  private comparePOFIFO(poA: string, poB: string): number {
    if (!poA || !poB) return 0;
    
    // Extract mmyy/xxxx pattern from PO
    const parsePO = (po: string) => {
      // Look for mmyy/xxxx pattern at the end of PO
      const match = po.match(/(\d{2})(\d{2})\/(\d{4})$/);
      if (!match) return { month: 99, year: 99, sequence: 9999 }; // Invalid PO goes to end
      
      const month = parseInt(match[1], 10);
      const year = parseInt(match[2], 10);
      const sequence = parseInt(match[3], 10);
      
      return { month, year, sequence };
    };
    
    const parsedA = parsePO(poA);
    const parsedB = parsePO(poB);
    
    // FIFO: Earlier year first (21 before 25)
    if (parsedA.year !== parsedB.year) {
      return parsedA.year - parsedB.year;
    }
    
    // If same year, earlier month first (02 before 03) 
    if (parsedA.month !== parsedB.month) {
      return parsedA.month - parsedB.month;
    }
    
    // If same month/year, lower sequence first (0007 before 0165)
    return parsedA.sequence - parsedB.sequence;
  }

  // Sort inventory by FIFO: Material Code -> PO (oldest first)
  private sortInventoryFIFO(): void {
    if (!this.filteredInventory || this.filteredInventory.length === 0) return;
    
    console.log('🔄 Sorting inventory by FIFO: Material Code -> PO (oldest first)...');
    
    this.filteredInventory.sort((a, b) => {
      // First compare by Material Code (group same materials together)
      const materialComparison = this.compareMaterialCodesFIFO(a.materialCode, b.materialCode);
      if (materialComparison !== 0) {
        return materialComparison;
      }
      
      // If same material code, sort by PO: Year -> Month -> Sequence (oldest first)
      return this.comparePOFIFO(a.poNumber, b.poNumber);
    });
    
    console.log('✅ Inventory sorted by FIFO successfully');
    
    // Update negative stock count after sorting
    this.updateNegativeStockCount();
  }

  // Status helper methods
  getStatusClass(item: InventoryMaterial): string {
    if (item.isCompleted) return 'status-completed';
    if (item.isDuplicate) return 'status-duplicate';
    if (item.importStatus === 'Import') return 'status-import';
    return 'status-active';
  }

  // Mark duplicates within ASM2
  markDuplicates(): void {
    const poMap = new Map<string, InventoryMaterial[]>();
    
    // Group materials by PO
    this.filteredInventory.forEach(material => {
      if (!poMap.has(material.poNumber)) {
        poMap.set(material.poNumber, []);
      }
      poMap.get(material.poNumber)!.push(material);
    });
    
    // Mark duplicates
    poMap.forEach((materials, po) => {
      if (materials.length > 1) {
        materials.forEach(material => {
          material.isDuplicate = true;
        });
      } else {
        materials[0].isDuplicate = false;
      }
    });
    
    // Update negative stock count after marking duplicates
    this.updateNegativeStockCount();
  }

  getStatusText(item: InventoryMaterial): string {
    if (item.isCompleted) return 'Hoàn thành';
    if (item.isDuplicate) return 'Trùng lặp';
    if (item.importStatus === 'Import') return 'Import';
    return 'Hoạt động';
  }

  getExpiryDateText(expiryDate: Date): string {
    if (!expiryDate) return 'N/A';
    
    const today = new Date();
    const diffTime = expiryDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return 'Hết hạn';
    if (diffDays <= 30) return `${diffDays}d`;
    if (diffDays <= 90) return `${Math.ceil(diffDays/30)}m`;
    return `${Math.ceil(diffDays/365)}y`;
  }

  // Check if location is IQC
  isIQCLocation(location: string): boolean {
    return location && location.toUpperCase() === 'IQC';
  }



  // Load permissions
  loadPermissions(): void {
    this.tabPermissionService.canAccessTab('materials-asm2')
      .pipe(takeUntil(this.destroy$))
      .subscribe(canAccess => {
        // Set basic permissions based on tab access
        this.canView = canAccess;
        this.canEdit = canAccess;
        this.canExport = canAccess;
        this.canDelete = canAccess;
        // this.canEditHSD = canAccess; // Removed - HSD column deleted
        
        // Lưu ý: Cột "Đã xuất" luôn có thể chỉnh sửa (giống cột "Vị trí")
        // không phụ thuộc vào canExport permission
        
        console.log('🔑 ASM2 Permissions loaded:', {
          canView: this.canView,
          canEdit: this.canEdit,
          canExport: this.canExport,
          canDelete: this.canDelete,
          // canEditHSD: this.canEditHSD // Removed - HSD column deleted
        });
      });
  }

  // Import current stock with ASM2 filter
  async importCurrentStock(): Promise<void> {
    try {
      // Ask user for duplicate strategy
      const duplicateStrategy = await this.getDuplicateStrategy();
      if (!duplicateStrategy) return;

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx,.xls,.csv';
      
      input.onchange = async (event: any) => {
        const file = event.target.files[0];
        if (!file) return;

        const validation = this.excelImportService.validateFile(file);
        if (!validation.valid) {
          alert(validation.message);
          return;
        }

        try {
          const dialogRef = this.dialog.open(ImportProgressDialogComponent, {
            width: '500px',
            disableClose: true,
            data: { progress$: this.excelImportService.progress$ }
          });

                      // Start import process with ASM2 filter and duplicate strategy
            const result = await this.excelImportService.importStockFile(file, 50, 'ASM2', duplicateStrategy);
          
          const dialogResult = await dialogRef.afterClosed().toPromise();
          
          // Show detailed import results
          this.showImportResults(result);
          
          // Reload inventory data
            this.loadInventoryFromFirebase();
          
        } catch (error) {
          console.error('Import error:', error);
          alert(`❌ Lỗi import: ${error}`);
        }
      };
      
      input.click();
      
    } catch (error) {
      console.error('Error setting up file input:', error);
      alert('Có lỗi xảy ra khi mở file picker');
    }
  }

  // Get duplicate handling strategy from user
  private async getDuplicateStrategy(): Promise<'skip' | 'update' | 'ask' | null> {
    const strategy = prompt(
      'Chọn cách xử lý items trùng lặp:\n' +
      '1 - Bỏ qua (Skip) - Chỉ import items mới\n' +
      '2 - Cập nhật (Update) - Cập nhật tất cả items trùng lặp\n' +
      '3 - Hỏi từng item (Ask) - Hỏi từng item trùng lặp\n' +
      'Nhập 1, 2, hoặc 3:',
      '3'
    );

    switch (strategy) {
      case '1': return 'skip';
      case '2': return 'update';
      case '3': return 'ask';
      default: return null;
    }
  }

  // Show detailed import results
  private showImportResults(result: { success: number; errors: string[]; duplicates: number; updated: number }): void {
    const totalProcessed = result.success + result.updated + result.duplicates;
    
    let message = `✅ Import hoàn thành!\n\n`;
    message += `📊 Tổng quan:\n`;
    message += `   • Tổng items xử lý: ${totalProcessed}\n`;
    message += `   • Items mới: ${result.success}\n`;
    message += `   • Items cập nhật: ${result.updated}\n`;
    message += `   • Items bỏ qua: ${result.duplicates}\n`;
    message += `   • Lỗi: ${result.errors.length}\n\n`;
    
    if (result.success > 0) {
      message += `🎉 Đã thêm ${result.success} items mới vào inventory ASM2\n`;
    }
    
    if (result.updated > 0) {
      message += `🔄 Đã cập nhật ${result.updated} items hiện có\n`;
    }
    
    if (result.duplicates > 0) {
      message += `⏭️ Đã bỏ qua ${result.duplicates} items trùng lặp\n`;
    }
    
    if (result.errors.length > 0) {
      message += `\n⚠️ Có ${result.errors.length} lỗi xảy ra`;
    }

    alert(message);

    // Show detailed errors if any
    if (result.errors.length > 0) {
      console.warn('Import errors:', result.errors);
      
      const errorMessage = result.errors.length <= 10 
        ? `Chi tiết lỗi:\n${result.errors.join('\n')}`
        : `Có ${result.errors.length} lỗi. Xem console để biết chi tiết.\n\nLỗi đầu tiên:\n${result.errors.slice(0, 5).join('\n')}`;
      
      alert(`⚠️ ${errorMessage}`);
    }
  }

  // Placeholder methods - implement as needed
  toggleDropdown(event: any): void {
    this.isDropdownOpen = !this.isDropdownOpen;
  }

  refreshInventory(): void {
    this.loadInventoryFromFirebase();
  }

  stopScanning(): void {
    if (this.html5QrCode) {
      this.html5QrCode.stop();
      this.html5QrCode = null;
    }
    this.isScanning = false;
  }

  autoResizeNotesColumn(): void {
    // Placeholder for auto-resize functionality
  }

  // Placeholder for other methods that exist in original component

  downloadStockTemplate(): void {
    console.log('Download stock template');
  }

  downloadFIFOReportASM2(): void {
    console.log('Download FIFO report for ASM2');
  }

  // completeInventory method removed - replaced with resetZeroStock
  // completeInventory(): void {
  //   this.showCompleted = !this.showCompleted;
  // }

  // Reset function - Delete items with zero stock
  async resetZeroStock(): Promise<void> {
    try {
      // Find all items with stock = 0
      const zeroStockItems = this.inventoryMaterials.filter(item => 
        item.factory === this.FACTORY && this.calculateCurrentStock(item) === 0
      );

      if (zeroStockItems.length === 0) {
        alert('✅ Không có mã hàng nào có tồn kho = 0 trong ASM2');
        return;
      }

      // Show confirmation dialog
      const confirmed = confirm(
        `🔄 RESET ASM2 INVENTORY\n\n` +
        `Tìm thấy ${zeroStockItems.length} mã hàng có tồn kho = 0\n\n` +
        `Bạn có muốn xóa tất cả những mã hàng này không?\n\n` +
        `⚠️ Hành động này không thể hoàn tác!`
      );

      if (!confirmed) {
        return;
      }

      console.log(`🗑️ Starting reset for ASM2: ${zeroStockItems.length} items to delete`);

      // Delete items in batches
      const batchSize = 50;
      let deletedCount = 0;

      for (let i = 0; i < zeroStockItems.length; i += batchSize) {
        const batch = this.firestore.firestore.batch();
        const currentBatch = zeroStockItems.slice(i, i + batchSize);

        currentBatch.forEach(item => {
          if (item.id) {
            const docRef = this.firestore.collection('inventory-materials').doc(item.id).ref;
            batch.delete(docRef);
          }
        });

        await batch.commit();
        deletedCount += currentBatch.length;

        console.log(`✅ ASM2 Reset batch ${Math.floor(i/batchSize) + 1} completed: ${deletedCount}/${zeroStockItems.length}`);

        // Small delay between batches
        if (i + batchSize < zeroStockItems.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      alert(`✅ Reset hoàn thành!\nĐã xóa ${deletedCount} mã hàng có tồn kho = 0 từ ASM2`);

      // Reload inventory data
      await this.loadInventoryFromFirebase();

    } catch (error) {
      console.error('❌ Error during ASM2 reset:', error);
      alert(`❌ Lỗi khi reset ASM2: ${error.message}`);
    }
  }

  syncFromInbound(): void {
    console.log('Sync from inbound for ASM2');
  }

  // Update methods for editing
  updateExported(material: InventoryMaterial): void {
    if (!this.canEdit) return;
    this.updateMaterialInFirebase(material);
  }

  updateOpeningStock(material: InventoryMaterial): void {
    if (!this.canEdit) return;
    this.updateMaterialInFirebase(material);
    
    // Update negative stock count for real-time display
    this.updateNegativeStockCount();
  }

  updateLocation(material: InventoryMaterial): void {
    if (!this.canEdit) return;
    this.updateMaterialInFirebase(material);
    
    // Update negative stock count for real-time display
    this.updateNegativeStockCount();
  }

  updateType(material: InventoryMaterial): void {
    if (!this.canEdit) return;
    this.updateMaterialInFirebase(material);
    
    // Update negative stock count for real-time display
    this.updateNegativeStockCount();
  }

  updateRollsOrBags(material: InventoryMaterial): void {
    if (!this.canEdit) return;
    this.updateMaterialInFirebase(material);
    
    // Update negative stock count for real-time display
    this.updateNegativeStockCount();
  }

  updateXT(material: InventoryMaterial): void {
    if (!this.canEdit) return;
    this.updateMaterialInFirebase(material);
    
    // Update negative stock count for real-time display
    this.updateNegativeStockCount();
  }

  updateExportedAmount(material: InventoryMaterial): void {
    if (!this.canEdit) return;
    this.updateMaterialInFirebase(material);
    
    // Update negative stock count for real-time display
    this.updateNegativeStockCount();
  }

  // onHSDChange method removed - HSD column deleted
  // onHSDChange(event: any, material: InventoryMaterial): void {
  //   if (!this.canEditHSD) return;
  //   const dateValue = event.target.value;
  //   if (dateValue) {
  //     material.expiryDate = new Date(dateValue);
  //     this.updateMaterialInFirebase(material);
  //   }
  // }

  onLocationChange(material: InventoryMaterial): void {
    if (!this.canEdit) return;
    this.updateMaterialInFirebase(material);
  }

  // Update material in Firebase
  private updateMaterialInFirebase(material: InventoryMaterial): void {
    console.log(`🔍 DEBUG: updateMaterialInFirebase called for ${material.materialCode}`);
    console.log(`🔍 DEBUG: material.id = ${material.id}`);
    
    if (!material.id) {
      console.log(`❌ DEBUG: No material ID - cannot save to Firebase`);
      return;
    }
    
    material.updatedAt = new Date();
    
    console.log(`💾 Saving to Firebase: ${material.materialCode} - XT: ${material.xt || 0} (Exported is auto-updated from outbound)`);
    console.log(`🔍 DEBUG: Full material object:`, material);
    
    // Prepare update data, only include defined values
    // Note: exported field is not included here as it's auto-updated from outbound
    const updateData: any = {
      openingStock: material.openingStock, // Có thể là null
      xt: material.xt,
      location: material.location,
      type: material.type,
      rollsOrBags: material.rollsOrBags,
      remarks: material.remarks,
      expiryDate: material.expiryDate,
      updatedAt: material.updatedAt
    };
    
    // Only add standardPacking if it has a valid value
    if (material.standardPacking !== undefined && material.standardPacking !== null) {
      updateData.standardPacking = material.standardPacking;
    }
    
    console.log(`🔍 DEBUG: Update data to Firebase:`, updateData);
    
    this.firestore.collection('inventory-materials').doc(material.id).update(updateData).then(() => {
      console.log(`✅ ASM2 Material updated successfully: ${material.materialCode}`);
      console.log(`📊 Stock updated: ${this.calculateCurrentStock(material)} (Quantity: ${material.quantity} - Exported: ${material.exported} - XT: ${material.xt || 0})`);
      
      // Update negative stock count for real-time display
      this.updateNegativeStockCount();
      
      // Show success message to user
      this.showUpdateSuccessMessage(material);
      
    }).catch(error => {
      console.error(`❌ Error updating ASM2 material ${material.materialCode}:`, error);
      
      // Show error message to user
      this.showUpdateErrorMessage(material, error);
    });
  }

  // Show success message when update is successful
  private showUpdateSuccessMessage(material: InventoryMaterial): void {
    const stock = this.calculateCurrentStock(material);
    console.log(`🎉 Update successful! ${material.materialCode} - New stock: ${stock}`);
    
    // You can add a toast notification here if needed
    // For now, just log to console
  }

  // Show error message when update fails
  private showUpdateErrorMessage(material: InventoryMaterial, error: any): void {
    console.error(`💥 Update failed for ${material.materialCode}:`, error.message);
    
    // You can add an error toast notification here if needed
    // For now, just log to console
  }



  // Format numbers with thousand separators
  formatNumber(value: any): string {
    if (value === null || value === undefined || value === '') {
      return '0';
    }
    
    const num = parseFloat(value);
    if (isNaN(num)) {
      return '0';
    }
    
    if (num % 1 === 0) {
      return num.toLocaleString('vi-VN');
    } else {
      return num.toLocaleString('vi-VN', { 
        minimumFractionDigits: 0, 
        maximumFractionDigits: 2 
      });
    }
  }

  // Get material name from catalog
  getMaterialName(materialCode: string): string {
    if (this.catalogCache.has(materialCode)) {
      return this.catalogCache.get(materialCode)!.materialName;
    }
    return materialCode;
  }

  // Get material unit from catalog
  getMaterialUnit(materialCode: string): string {
    if (this.catalogCache.has(materialCode)) {
      return this.catalogCache.get(materialCode)!.unit;
    }
    return 'PCS';
  }

  // Get standard packing from catalog
  getStandardPacking(materialCode: string): string {
    if (this.catalogCache.has(materialCode)) {
      const catalogItem = this.catalogCache.get(materialCode)!;
      return catalogItem.standardPacking ? catalogItem.standardPacking.toString() : 'N/A';
    }
    return 'N/A';
  }

  // Check if rolls or bags is valid for QR generation
  isRollsOrBagsValid(material: InventoryMaterial): boolean {
    return material.rollsOrBags && 
           material.rollsOrBags.toString().trim() !== '' && 
           parseFloat(material.rollsOrBags.toString()) > 0;
  }

  // Change search type (material, po, location)
  changeSearchType(searchType: 'material' | 'po' | 'location'): void {
    this.searchType = searchType;
    console.log(`🔍 ASM2 Search type changed to: ${searchType}`);
    
    // Clear current search results when changing search type
    if (this.searchTerm) {
      this.clearSearch();
    }
  }

  // Print QR code for material
  async printQRCode(material: InventoryMaterial): Promise<void> {
    try {
      if (!this.isRollsOrBagsValid(material)) {
        alert('❌ Không thể in QR - thiếu Rolls/Bags');
        return;
      }

      // Generate QR code data
      const qrData = {
        materialCode: material.materialCode,
        poNumber: material.poNumber,
        quantity: material.rollsOrBags,
        factory: this.FACTORY,
        timestamp: new Date().toISOString()
      };

      // Generate QR code
      const qrCodeDataUrl = await QRCode.toDataURL(JSON.stringify(qrData));
      
      // Create print window
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('❌ Không thể mở cửa sổ in. Vui lòng cho phép popup!');
        return;
      }

      // Generate print content
      printWindow.document.write(`
        <html>
          <head>
            <title>QR Label - ASM2 - ${material.materialCode}</title>
            <style>
              body { 
                font-family: Arial, sans-serif; 
                margin: 0; 
                padding: 20px;
                text-align: center;
              }
              .qr-container { 
                display: flex; 
                flex-direction: column;
                align-items: center;
                gap: 10px;
              }
              .qr-code { 
                width: 200px; 
                height: 200px; 
              }
              .material-info {
                font-size: 14px;
                line-height: 1.4;
              }
              .material-code {
                font-weight: bold;
                font-size: 16px;
              }
              .po-number {
                color: #666;
              }
              .quantity {
                font-weight: bold;
                color: #333;
              }
              @media print {
                body { margin: 0; }
                .qr-container { page-break-inside: avoid; }
              }
            </style>
          </head>
          <body>
            <div class="qr-container">
              <img src="${qrCodeDataUrl}" alt="QR Code" class="qr-code">
              <div class="material-info">
                <div class="material-code">${material.materialCode}</div>
                <div class="po-number">PO: ${material.poNumber}</div>
                <div class="quantity">Qty: ${material.rollsOrBags}</div>
                <div>Factory: ${this.FACTORY}</div>
                <div>${new Date().toLocaleDateString('vi-VN')}</div>
              </div>
            </div>
            <script>
              window.onload = function() {
                window.print();
                setTimeout(() => window.close(), 1000);
              };
            </script>
          </body>
        </html>
      `);

      printWindow.document.close();
      
    } catch (error) {
      console.error('❌ Error generating QR code:', error);
      alert('❌ Lỗi khi tạo QR code: ' + error.message);
    }
  }

  // 🔧 QUERY LOGIC MỚI: Lấy số lượng xuất từ Outbound theo Material + PO (không còn vị trí)
  // - Trước đây: Query theo Material + PO + Location → Bị lỗi khi Outbound không có vị trí
  // - Bây giờ: Chỉ query theo Material + PO → Lấy tất cả outbound records
  // - Kết quả: Số lượng xuất chính xác cho từng Material + PO
  // - Không còn bị lỗi số âm sai khi search
  async getExportedQuantityFromOutbound(materialCode: string, poNumber: string, location: string): Promise<number> {
    try {
      console.log(`🔍 Getting exported quantity for ${materialCode} - PO: ${poNumber}`);
      
      const outboundRef = this.firestore.collection('outbound-materials');
      const snapshot = await outboundRef
        .ref
        .where('factory', '==', 'ASM2')
        .where('materialCode', '==', materialCode)
        .where('poNumber', '==', poNumber)
        .get();

      if (!snapshot.empty) {
        let totalExported = 0;
        snapshot.forEach(doc => {
          const data = doc.data() as any;
          totalExported += (data.exportQuantity || 0);
        });
        
        console.log(`✅ Total exported quantity for ${materialCode} - PO ${poNumber}: ${totalExported}`);
        return totalExported;
      } else {
        console.log(`ℹ️ No outbound records found for ${materialCode} - PO ${poNumber}`);
        return 0;
      }
    } catch (error) {
      console.error(`❌ Error getting exported quantity for ${materialCode} - PO ${poNumber}:`, error);
      return 0;
    }
  }

  // 🔧 LOGIC FIFO MỚI: Lấy số lượng xuất từ Outbound theo FIFO (Material + PO)
  // - Sử dụng logic FIFO để phân bổ số lượng xuất cho từng dòng inventory
  // - Đảm bảo dòng có FIFO thấp nhất được trừ trước
  // - Tránh tồn kho âm ở các dòng sau
  async getExportedQuantityFromOutboundFIFO(materialCode: string, poNumber: string): Promise<{ totalExported: number; outboundRecords: any[] }> {
    try {
      console.log(`🔍 Getting exported quantity with FIFO logic for ${materialCode} - PO: ${poNumber}`);
      
      const outboundRef = this.firestore.collection('outbound-materials');
      // Thử tìm với orderBy trước, nếu lỗi thì tìm không có orderBy
      let snapshot;
      try {
        snapshot = await outboundRef
          .ref
          .where('factory', '==', 'ASM2')
          .where('materialCode', '==', materialCode)
          .where('poNumber', '==', poNumber)
          .orderBy('exportDate', 'asc') // Sắp xếp theo thời gian xuất (cũ nhất trước)
          .get();
      } catch (orderByError) {
        console.log(`⚠️ OrderBy exportDate failed, trying without orderBy:`, orderByError);
        // Fallback: tìm không có orderBy
        snapshot = await outboundRef
          .ref
          .where('factory', '==', 'ASM2')
          .where('materialCode', '==', poNumber)
          .get();
      }

      if (!snapshot.empty) {
        let totalExported = 0;
        const outboundRecords: any[] = [];
        
        snapshot.forEach(doc => {
          const data = doc.data() as any;
          // Thử nhiều field names khác nhau để tìm số lượng xuất
          let exportQuantity = 0;
          
          // Kiểm tra từng field name có thể có
          if (data.exportQuantity !== undefined && data.exportQuantity !== null) {
            exportQuantity = data.exportQuantity;
          } else if (data.exported !== undefined && data.exported !== null) {
            exportQuantity = data.exported;
          } else if (data.quantity !== undefined && data.quantity !== null) {
            exportQuantity = data.quantity;
          } else if (data.amount !== undefined && data.amount !== null) {
            exportQuantity = data.amount;
          } else if (data.qty !== undefined && data.qty !== null) {
            exportQuantity = data.qty;
          }
          
          // Đảm bảo exportQuantity là số
          if (typeof exportQuantity === 'string') {
            exportQuantity = parseFloat(exportQuantity) || 0;
          }
          
          totalExported += exportQuantity;
          
          outboundRecords.push({
            id: doc.id,
            exportQuantity: exportQuantity,
            exportDate: data.exportDate,
            location: data.location || 'N/A'
          });
          
          console.log(`🔍 Debug: Outbound record - ID: ${doc.id}, Material: ${data.materialCode}, PO: ${data.poNumber}, Quantity: ${exportQuantity}`);
        });
        
        console.log(`✅ Total exported quantity with FIFO for ${materialCode} - PO ${poNumber}: ${totalExported} (${outboundRecords.length} records)`);
        
        return { totalExported, outboundRecords };
      } else {
        console.log(`ℹ️ No outbound records found for ${materialCode} - PO ${poNumber}`);
        return { totalExported: 0, outboundRecords: [] };
      }
    } catch (error) {
      console.error(`❌ Error getting exported quantity with FIFO for ${materialCode} - PO ${poNumber}:`, error);
      return { totalExported: 0, outboundRecords: [] };
    }
  }

  // 🔧 UPDATE LOGIC ĐƠN GIẢN: Cập nhật số lượng xuất từ Outbound
  // - Lấy tổng số lượng xuất từ outbound theo Material + PO
  // - Cập nhật trực tiếp vào inventory
  async updateExportedFromOutboundFIFO(material: InventoryMaterial): Promise<void> {
    try {
      console.log(`🔄 Updating exported quantity for ${material.materialCode} - PO ${material.poNumber}`);
      
      // Lấy thông tin outbound
      const { totalExported, outboundRecords } = await this.getExportedQuantityFromOutboundFIFO(material.materialCode, material.poNumber);
      
      console.log(`🔍 Debug: ${material.materialCode} - PO ${material.poNumber} - Total exported from outbound: ${totalExported}, Records: ${outboundRecords.length}`);
      
      // Cập nhật số lượng xuất trực tiếp - CHỈ CẬP NHẬT NẾU TÌM THẤY OUTBOUND RECORDS
      if (outboundRecords.length > 0) {
        if (material.exported !== totalExported) {
          material.exported = totalExported;
          await this.updateExportedInFirebase(material, totalExported);
          console.log(`📊 Updated exported quantity: ${material.exported} → ${totalExported}`);
        } else {
          console.log(`📊 Exported quantity already up-to-date: ${material.exported}`);
        }
      } else {
        // KHÔNG TÌM THẤY OUTBOUND RECORDS - GIỮ NGUYÊN GIÁ TRỊ EXPORTED HIỆN TẠI
        console.log(`⚠️ No outbound records found - Keeping current exported: ${material.exported}`);
        console.log(`💡 This prevents overwriting exported quantity to 0 when outbound data is missing`);
      }

    } catch (error) {
      console.error(`❌ Error updating exported quantity for ${material.materialCode} - PO ${material.poNumber}:`, error);
    }
  }

  // Helper method để cập nhật exported quantity vào Firebase
  private async updateExportedInFirebase(material: InventoryMaterial, exportedQuantity: number): Promise<void> {
    if (!material.id) return;
    
    try {
      await this.firestore.collection('inventory-materials').doc(material.id).update({
        exported: exportedQuantity,
        updatedAt: new Date()
      });
      console.log(`💾 Exported quantity saved to Firebase: ${material.materialCode} - PO ${material.poNumber} = ${exportedQuantity}`);
    } catch (error) {
      console.error(`❌ Error saving exported quantity to Firebase: ${material.materialCode} - PO ${material.poNumber}:`, error);
    }
  }

  // Gộp toàn bộ dòng trùng lặp và lưu vào Firebase
  async consolidateAllInventory(): Promise<void> {
    try {
      // Hiển thị thống kê trước khi gộp
      const originalCount = this.inventoryMaterials.length;
      const materialPoMap = new Map<string, InventoryMaterial[]>();
      
      this.inventoryMaterials.forEach(material => {
        const key = `${material.materialCode}_${material.poNumber}`;
        if (!materialPoMap.has(key)) {
          materialPoMap.set(key, []);
        }
        materialPoMap.get(key)!.push(material);
      });
      
      const duplicateGroups = Array.from(materialPoMap.values()).filter(group => group.length > 1);
      const totalDuplicates = duplicateGroups.reduce((sum, group) => sum + group.length, 0);
      
      if (duplicateGroups.length === 0) {
        alert('✅ Không có dòng trùng lặp nào để gộp!');
        return;
      }
      
      // Xác định loại dữ liệu
      const dataType = this.filteredInventory.length > 0 && this.filteredInventory.length < this.inventoryMaterials.length ? 
        'kết quả search' : 'toàn bộ inventory';
      
      // Hiển thị thông tin chi tiết
      let details = `📊 THÔNG TIN GỘP DÒNG:\n\n`;
      details += `• Loại dữ liệu: ${dataType}\n`;
      details += `• Tổng dòng hiện tại: ${originalCount}\n`;
      details += `• Số nhóm trùng lặp: ${duplicateGroups.length}\n`;
      details += `• Tổng dòng sẽ được gộp: ${totalDuplicates - duplicateGroups.length}\n`;
      details += `• Dòng còn lại sau gộp: ${originalCount - (totalDuplicates - duplicateGroups.length)}\n\n`;
      
      details += `📋 CHI TIẾT CÁC NHÓM TRÙNG LẶP:\n`;
      duplicateGroups.forEach((group, index) => {
        const material = group[0];
        details += `${index + 1}. ${material.materialCode} - PO: ${material.poNumber} (${group.length} dòng)\n`;
      });
      
      // Xác nhận gộp
      const confirmMessage = details + `\n⚠️ CẢNH BÁO: Hành động này sẽ:\n` +
        `• Gộp tất cả dòng trùng lặp theo Material+PO trong ${dataType}\n` +
        `• Lưu trực tiếp vào Firebase\n` +
        `• KHÔNG THỂ HOÀN TÁC\n\n` +
        `Bạn có muốn tiếp tục không?`;
      
      if (!confirm(confirmMessage)) {
        console.log('❌ User cancelled consolidation');
        return;
      }
      
      // Xác nhận lần thứ 2
      const finalConfirm = confirm(`🚨 XÁC NHẬN CUỐI CÙNG:\n\n` +
        `Bạn có chắc chắn muốn gộp ${totalDuplicates - duplicateGroups.length} dòng trùng lặp ` +
        `và lưu vào Firebase?\n\n` +
        `Hành động này KHÔNG THỂ HOÀN TÁC!`);
      
      if (!finalConfirm) {
        console.log('❌ User cancelled final confirmation');
        return;
      }
      
      console.log(`🚀 Starting consolidation of ${duplicateGroups.length} duplicate groups...`);
      
      // Show loading
      this.isLoading = true;
      
      // Thực hiện gộp dòng
      const consolidatedMaterials: InventoryMaterial[] = [];
      const materialsToDelete: string[] = [];
      
      // Xử lý từng nhóm trùng lặp
      for (const group of duplicateGroups) {
        if (group.length === 1) continue; // Bỏ qua nhóm chỉ có 1 item
        
        const baseMaterial = { ...group[0] };
        
        // Gộp quantities
        const totalOpeningStock = group.reduce((sum, m) => {
          const stock = m.openingStock !== null ? m.openingStock : 0;
          return sum + stock;
        }, 0);
        baseMaterial.openingStock = totalOpeningStock > 0 ? totalOpeningStock : null;
        baseMaterial.quantity = group.reduce((sum, m) => sum + m.quantity, 0);
        baseMaterial.stock = group.reduce((sum, m) => sum + (m.stock || 0), 0);
        baseMaterial.exported = group.reduce((sum, m) => sum + (m.exported || 0), 0);
        baseMaterial.xt = group.reduce((sum, m) => sum + (m.xt || 0), 0);
        
        // Gộp location field - gộp tất cả vị trí khác nhau
        const uniqueLocations = [...new Set(group.map(m => m.location).filter(loc => loc))];
        baseMaterial.location = uniqueLocations.join('; ');
        
        // Gộp type field - gộp tất cả loại hình khác nhau
        const uniqueTypes = [...new Set(group.map(m => m.type).filter(type => type))];
        baseMaterial.type = uniqueTypes.join('; ');
        
        // Keep earliest import date and latest expiry date
        baseMaterial.importDate = new Date(Math.min(...group.map(m => m.importDate.getTime())));
        baseMaterial.expiryDate = new Date(Math.max(...group.map(m => m.expiryDate.getTime())));
        
        // Merge other fields
        baseMaterial.notes = group.map(m => m.notes).filter(n => n).join('; ');
        baseMaterial.remarks = group.map(m => m.remarks).filter(r => r).join('; ');
        baseMaterial.supplier = group.map(m => m.supplier).filter(s => s).join('; ');
        baseMaterial.rollsOrBags = group.map(m => m.rollsOrBags).filter(r => r).join('; ');
        
        // Giữ lại ID của item đầu tiên để update
        if (baseMaterial.id) {
          // Thêm các item khác vào danh sách xóa
          for (let i = 1; i < group.length; i++) {
            if (group[i].id) {
              materialsToDelete.push(group[i].id);
            }
          }
        }
        
        // Cập nhật thời gian
        baseMaterial.updatedAt = new Date();
        
        consolidatedMaterials.push(baseMaterial);
        console.log(`✅ Consolidated: ${baseMaterial.materialCode} - PO ${baseMaterial.poNumber}`);
      }
      
      // Thêm các item không trùng lặp
      materialPoMap.forEach((group, key) => {
        if (group.length === 1) {
          consolidatedMaterials.push(group[0]);
        }
      });
      
      // Lưu vào Firebase
      console.log(`💾 Saving consolidated materials to Firebase...`);
      
      // Update các item đã gộp
      for (const material of consolidatedMaterials) {
        if (material.id && materialPoMap.get(`${material.materialCode}_${material.poNumber}`)!.length > 1) {
          await this.firestore.collection('inventory-materials').doc(material.id).update({
            openingStock: material.openingStock,
            quantity: material.quantity,
            stock: material.stock,
            exported: material.exported,
            xt: material.xt,
            location: material.location,
            type: material.type,
            importDate: material.importDate,
            expiryDate: material.expiryDate,
            notes: material.notes,
            remarks: material.remarks,
            supplier: material.supplier,
            rollsOrBags: material.rollsOrBags,
            updatedAt: material.updatedAt
          });
          console.log(`✅ Updated: ${material.materialCode} - PO ${material.poNumber}`);
        }
      }
      
      // Xóa các item trùng lặp
      if (materialsToDelete.length > 0) {
        console.log(`🗑️ Deleting ${materialsToDelete.length} duplicate items...`);
        
        // Xóa theo batch
        const batchSize = 500;
        for (let i = 0; i < materialsToDelete.length; i += batchSize) {
          const batch = this.firestore.firestore.batch();
          const currentBatch = materialsToDelete.slice(i, i + batchSize);
          
          currentBatch.forEach(id => {
            const docRef = this.firestore.collection('inventory-materials').doc(id).ref;
            batch.delete(docRef);
          });
          
          await batch.commit();
          console.log(`✅ Deleted batch ${Math.floor(i/batchSize) + 1}: ${currentBatch.length} items`);
        }
      }
      
      // Cập nhật local data
      this.inventoryMaterials = consolidatedMaterials;
      this.filteredInventory = [...this.inventoryMaterials];
      
      const finalCount = this.inventoryMaterials.length;
      const reducedCount = originalCount - finalCount;
      
      console.log(`✅ Consolidation completed: ${originalCount} → ${finalCount} items (reduced by ${reducedCount})`);
      
      // Hiển thị thông báo cho user
      if (reducedCount > 0) {
        this.consolidationMessage = `✅ Đã gộp ${reducedCount} dòng dữ liệu trùng lặp theo Material+PO. Từ ${originalCount} → ${finalCount} dòng.`;
        this.showConsolidationMessage = true;
        
        // Auto-hide message after 5 seconds
        setTimeout(() => {
          this.showConsolidationMessage = false;
        }, 5000);
      } else {
        this.consolidationMessage = 'ℹ️ Không có dữ liệu trùng lặp để gộp.';
        this.showConsolidationMessage = true;
        
        // Auto-hide message after 3 seconds
        setTimeout(() => {
          this.showConsolidationMessage = false;
        }, 3000);
      }
      
      // Mark duplicates after consolidation
      this.markDuplicates();
      
      // Sắp xếp FIFO sau khi gộp dữ liệu
      this.sortInventoryFIFO();
      
    } catch (error) {
      console.error('❌ Error during consolidation:', error);
      alert(`❌ Lỗi khi gộp dòng: ${error.message}`);
    } finally {
      this.isLoading = false;
    }
  }

  // Import catalog from Excel
  async importCatalog(): Promise<void> {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx,.xls,.csv';
      
      input.onchange = async (event: any) => {
        const file = event.target.files[0];
        if (!file) return;

        try {
          const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
          const worksheet = workbook.Sheets[workbook.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json(worksheet);

          if (data.length === 0) {
            alert('❌ File không có dữ liệu');
      return;
    }
    
          // Validate required columns
          const firstRow = data[0] as any;
          if (!firstRow.materialCode || !firstRow.standardPacking) {
            alert('❌ File phải có cột "materialCode" và "standardPacking"');
      return;
    }
    
          // Process catalog data
          const catalogData = data.map((row: any) => ({
            materialCode: String(row.materialCode || '').trim(),
            materialName: String(row.materialName || '').trim(),
            unit: String(row.unit || 'PCS').trim(),
            standardPacking: Number(row.standardPacking) || 0
          })).filter(item => item.materialCode && item.standardPacking > 0);

          if (catalogData.length === 0) {
            alert('❌ Không có dữ liệu hợp lệ trong file');
        return;
      }
      
          // Save to Firebase
        const batch = this.firestore.firestore.batch();
          const catalogRef = this.firestore.collection('catalog');

          catalogData.forEach(item => {
            const docRef = catalogRef.doc().ref;
            batch.set(docRef, {
              ...item,
              factory: this.FACTORY,
              createdAt: new Date(),
              updatedAt: new Date()
            });
        });
        
        await batch.commit();
          
          // Update local cache
          this.loadCatalogFromFirebase();
          
          alert(`✅ Đã import ${catalogData.length} items vào catalog ASM2`);
          
        } catch (error) {
          console.error('❌ Error importing catalog:', error);
          alert(`❌ Lỗi khi import catalog: ${error}`);
        }
      };
      
      input.click();
      
    } catch (error) {
      console.error('Error setting up file input:', error);
      alert('Có lỗi xảy ra khi mở file picker');
    }
  }

  // Download catalog template
  downloadCatalogTemplate(): void {
    const templateData = [
      {
        materialCode: 'B001001',
        materialName: 'Ví dụ tên hàng',
        unit: 'PCS',
        standardPacking: 100
      },
      {
        materialCode: 'B001002',
        materialName: 'Ví dụ tên hàng khác',
        unit: 'PCS',
        standardPacking: 50
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Catalog Template');
    
    const fileName = `Danh_muc_hang_hoa_ASM2_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  }

  // Delete all ASM2 data
  async deleteAllASM2Data(): Promise<void> {
    if (!this.canDelete) {
      alert('❌ Bạn không có quyền xóa dữ liệu');
      return;
    }

    if (!confirm('⚠️ CẢNH BÁO: Bạn có chắc chắn muốn xóa TẤT CẢ dữ liệu ASM2?\n\nHành động này KHÔNG THỂ HOÀN TÁC!')) {
        return;
      }

    try {
      // Get all ASM2 documents
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', this.FACTORY)
      ).get().toPromise();

      if (!snapshot || snapshot.empty) {
        alert('❌ Không có dữ liệu ASM2 để xóa');
        return;
      }

      // Delete in batches
        const batch = this.firestore.firestore.batch();
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
        });

        await batch.commit();
      
      // Clear local arrays
      this.inventoryMaterials = [];
      this.filteredInventory = [];
      
      alert(`✅ Đã xóa ${snapshot.docs.length} items ASM2`);

    } catch (error) {
      console.error('❌ Error deleting all ASM2 data:', error);
      alert(`❌ Lỗi khi xóa dữ liệu: ${error}`);
    }
  }

  // Export to Excel
  exportToExcel(): void {
    try {
      if (this.filteredInventory.length === 0) {
        alert('❌ Không có dữ liệu để export');
        return;
      }
      
      const exportData = this.filteredInventory.map(material => ({
        'Factory': material.factory || 'ASM2',
        'Material Code': material.materialCode,
        'Material Name': material.materialName || '',
        'PO Number': material.poNumber,
        'Quantity': material.quantity,
        'Unit': material.unit,
        'Exported': material.exported || 0,
        'Stock': this.calculateCurrentStock(material),
        'Location': material.location,
        'Type': material.type,
        'Expiry Date': material.expiryDate ? material.expiryDate.toISOString().split('T')[0] : '',
        'Remarks': material.remarks || '',
        'Standard Packing': material.standardPacking || 0,
        'Import Date': material.importDate ? material.importDate.toISOString().split('T')[0] : '',
        'Received Date': material.receivedDate ? material.receivedDate.toISOString().split('T')[0] : '',
        'Status': this.getStatusText(material)
      }));

      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'ASM2 Inventory');
      
      const fileName = `ASM2_Inventory_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      
      console.log(`✅ Exported ${exportData.length} items to Excel`);
      
    } catch (error) {
      console.error('❌ Error exporting to Excel:', error);
      alert(`❌ Lỗi khi export Excel: ${error}`);
    }
  }



  // Delete single inventory item
  async deleteInventoryItem(material: InventoryMaterial): Promise<void> {
    console.log('🗑️ ASM2 deleteInventoryItem called for:', material.materialCode);
    
    // Check permissions
    if (!this.canDelete) {
      console.error('❌ User does not have delete permission');
      alert('❌ Bạn không có quyền xóa item này. Vui lòng liên hệ admin để được cấp quyền.');
      return;
    }
    
    if (!material.id) {
      console.error('❌ Cannot delete item: No ID found');
      alert('❌ Không thể xóa item: Không tìm thấy ID');
      return;
    }
    
    if (confirm(`Xác nhận xóa item ${material.materialCode} khỏi ASM2 Inventory?\n\nPO: ${material.poNumber}\nVị trí: ${material.location}\nSố lượng: ${material.quantity} ${material.unit}`)) {
      console.log(`🗑️ Deleting ASM2 inventory item: ${material.materialCode} - PO: ${material.poNumber}`);
      
      try {
        await this.firestore.collection('inventory-materials').doc(material.id).delete();
        console.log(`✅ ASM2 inventory item deleted successfully: ${material.materialCode}`);
        
        // Remove from local arrays
        this.inventoryMaterials = this.inventoryMaterials.filter(item => item.id !== material.id);
        this.filteredInventory = this.filteredInventory.filter(item => item.id !== material.id);
        
        // Show success message
        alert(`✅ Đã xóa item ${material.materialCode} khỏi ASM2 Inventory`);
      
    } catch (error) {
        console.error('❌ Error deleting ASM2 inventory item:', error);
        alert(`❌ Lỗi khi xóa item: ${error}`);
      }
    }
  }
}