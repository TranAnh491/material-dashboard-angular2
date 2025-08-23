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
  selector: 'app-materials-asm1',
  templateUrl: './materials-asm1.component.html',
  styleUrls: ['./materials-asm1.component.scss']
})
export class MaterialsASM1Component implements OnInit, OnDestroy, AfterViewInit {
  // Fixed factory for ASM1
  readonly FACTORY = 'ASM1';
  
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
  
  // Negative stock filter state
  showOnlyNegativeStock = false;
  
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
      console.log('📚 ASM1 Catalog loaded, inventory ready for search');
    });
    this.loadPermissions();
    
    // Load inventory data and setup search after data is loaded
    this.loadInventoryAndSetupSearch();
    
    // Initialize negative stock count
    this.updateNegativeStockCount();
    
    console.log('✅ ASM1 Materials component initialized - Search setup will happen after data loads');
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

  // Load inventory data from Firebase - ONLY ASM1
  loadInventoryFromFirebase(): void {
    console.log('📦 Loading ASM1 inventory from Firebase...');
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
              factory: this.FACTORY, // Force ASM1
              importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : new Date(),
              receivedDate: data.receivedDate ? new Date(data.receivedDate.seconds * 1000) : new Date(),
              expiryDate: data.expiryDate ? new Date(data.expiryDate.seconds * 1000) : new Date(),
              xt: data.xt || 0 // Initialize XT field for old materials
            };
            
            // Apply catalog data if available
            if (this.catalogLoaded && this.catalogCache.has(material.materialCode)) {
              const catalogItem = this.catalogCache.get(material.materialCode)!;
              material.materialName = catalogItem.materialName;
              material.unit = catalogItem.unit;
            }
            
            return material;
          })
          .filter(material => material.factory === this.FACTORY); // Double check ASM1 only

        // Set filteredInventory to show all loaded items initially
        this.filteredInventory = [...this.inventoryMaterials];
        
        // Bỏ gộp inventory tự động - để Outbound xử lý thông minh
        // this.consolidateInventoryData();
        
        // Sắp xếp FIFO: Material Code -> PO (oldest first)
        this.sortInventoryFIFO();
        
        // Mark duplicates for display (không cần gộp nữa)
        this.markDuplicates();
        
        // Tự động cập nhật số lượng xuất từ outbound cho tất cả materials
        this.autoUpdateAllExportedFromOutbound();
        
        this.isLoading = false;
        
        console.log(`✅ Loaded ${this.inventoryMaterials.length} ASM1 inventory items`);
      }, error => {
        console.error('Error loading ASM1 inventory:', error);
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
      // THỬ NHIỀU COLLECTION NAMES - ƯU TIÊN 'materials' vì có 8750 documents với standardPacking
      let snapshot = null;
      let collectionName = '';
      
      // Thử collection 'materials' trước (có 8750 documents với standardPacking field)
      try {
        console.log('🔍 Trying collection: materials (priority - has 8750 docs with standardPacking)');
        snapshot = await this.firestore.collection('materials').get().toPromise();
        if (snapshot && !snapshot.empty) {
          collectionName = 'materials';
          console.log('✅ Found catalog data in collection: materials');
          console.log(`📊 Catalog snapshot size: ${snapshot.size}`);
        } else {
          console.log('⚠️ Collection "materials" exists but is empty');
        }
      } catch (e) {
        console.log('❌ Collection "materials" not found or error:', e);
      }
      
      // Nếu không có, thử collection 'catalog' (dự phòng)
      if (!snapshot || snapshot.empty) {
        try {
          console.log('🔍 Trying collection: catalog (fallback)');
          snapshot = await this.firestore.collection('catalog').get().toPromise();
          if (snapshot && !snapshot.empty) {
            collectionName = 'catalog';
            console.log('✅ Found catalog data in collection: catalog');
            console.log(`📊 Catalog snapshot size: ${snapshot.size}`);
          } else {
            console.log('⚠️ Collection "catalog" exists but is empty');
          }
        } catch (e) {
          console.log('❌ Collection "catalog" not found or error:', e);
        }
      }
      
      // Nếu không có, thử 'material-catalog'
      if (!snapshot || snapshot.empty) {
        try {
          console.log('🔍 Trying collection: material-catalog');
          snapshot = await this.firestore.collection('material-catalog').get().toPromise();
          if (snapshot && !snapshot.empty) {
            collectionName = 'material-catalog';
            console.log('✅ Found catalog data in collection: material-catalog');
            console.log(`📊 Catalog snapshot size: ${snapshot.size}`);
          } else {
            console.log('⚠️ Collection "material-catalog" exists but is empty');
          }
        } catch (e) {
          console.log('❌ Collection "material-catalog" not found or error:', e);
        }
      }
      
      if (snapshot && !snapshot.empty) {
        this.catalogCache.clear();
        
        // Log first few documents to see structure
        console.log('📄 Sample catalog documents:');
        snapshot.docs.slice(0, 3).forEach((doc, index) => {
          const data = doc.data() as any;
          console.log(`  ${index + 1}. ${doc.id}:`, {
            materialCode: data.materialCode,
            materialName: data.materialName,
            unit: data.unit,
            standardPacking: data.standardPacking
          });
        });
        
        // Process all documents and add to cache - HANDLE DUPLICATES
        let processedCount = 0;
        let duplicateCount = 0;
        const processedCodes = new Set<string>();
        
        snapshot.forEach(doc => {
          const data = doc.data() as any;
          console.log(`📝 Processing doc ${doc.id}:`, data);
          
          // Kiểm tra các field có thể có trong collection 'materials'
          const materialCode = data.materialCode || data.code || data.material_code;
          const materialName = data.materialName || data.name || data.material_name;
          
          if (materialCode && materialName) {
            // Kiểm tra trùng lặp materialCode
            if (processedCodes.has(materialCode)) {
              duplicateCount++;
              console.log(`⚠️ Duplicate materialCode ${materialCode} found in doc ${doc.id} - skipping`);
              return; // Skip duplicate
            }
            
            const catalogItem = {
              materialCode: materialCode,
              materialName: materialName,
              unit: data.unit || data.unitOfMeasure || 'PCS',
              standardPacking: data.standardPacking || data.packing || data.unitSize || 0
            };
            
            this.catalogCache.set(materialCode, catalogItem);
            processedCodes.add(materialCode); // Mark as processed
            processedCount++;
            console.log(`✅ Added to cache: ${materialCode} ->`, catalogItem);
          } else {
            console.log(`⚠️ Skipping doc ${doc.id} - missing materialCode or materialName:`, {
              materialCode: materialCode,
              materialName: materialName,
              availableFields: Object.keys(data)
            });
          }
        });
        
        console.log(`📊 Duplicate handling: ${duplicateCount} duplicates skipped, ${processedCount} unique items processed`);
        
        this.catalogLoaded = true;
        console.log(`✅ Loaded ${this.catalogCache.size} catalog items from Firebase collection: ${collectionName}`);
        console.log(`📋 Catalog cache keys:`, Array.from(this.catalogCache.keys()));
        console.log(`📊 Processed ${processedCount} documents`);
        
        if (duplicateCount > 0) {
          console.log(`⚠️ WARNING: ${duplicateCount} duplicate materialCodes were skipped to avoid conflicts`);
        }
        
        if (collectionName === 'materials') {
          console.log('🎯 SUCCESS: Catalog loaded from "materials" collection with standardPacking field!');
        }
        
        // Update any existing inventory items with catalog data
        if (this.inventoryMaterials.length > 0) {
          this.inventoryMaterials.forEach(material => {
            if (this.catalogCache.has(material.materialCode)) {
              const catalogItem = this.catalogCache.get(material.materialCode)!;
              material.materialName = catalogItem.materialName;
              material.unit = catalogItem.unit;
              // ✅ Cập nhật standardPacking nếu có
              if (catalogItem.standardPacking) {
                material.standardPacking = catalogItem.standardPacking;
              }
            }
          });
          this.cdr.detectChanges();
        }
      } else {
        console.warn('❌ No catalog data found in any collection. Please check Firebase.');
        this.catalogLoaded = true;
      }
    } catch (error) {
      console.error('❌ Error loading catalog from Firebase:', error);
      this.catalogLoaded = true;
    } finally {
      this.isCatalogLoading = false;
    }
  }

  // Apply filters to inventory
  applyFilters(): void {
    // Reset negative stock filter when applying other filters
    this.showOnlyNegativeStock = false;
    
    this.filteredInventory = this.inventoryMaterials.filter(material => {
      // Always filter by ASM1 only
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
    this.sortInventoryFIFO();
    
    // Mark duplicates
    this.markDuplicates();
    
    console.log('🔍 ASM1 filters applied. Items found:', this.filteredInventory.length);
  }

  // New optimized search method
  onSearchInput(event: any): void {
    let searchTerm = event.target.value;
    console.log('🔍 ASM1 Search input:', searchTerm);
    
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
    console.log('🧹 ASM1 Search cleared, returning to initial state (no data displayed)');
  }

  // Change search type
  changeSearchType(type: 'material' | 'po' | 'location'): void {
    this.searchType = type;
    this.searchTerm = ''; // Clear search when changing type
    this.applyFilters(); // Reapply filters
  }

  // Perform search with Search-First approach for ASM1 - IMPROVED VERSION
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
      console.log(`⏰ ASM1 Search term "${searchTerm}" quá ngắn (cần ít nhất 3 ký tự)`);
      return;
    }
    
    this.searchTerm = searchTerm;
    this.isLoading = true;
    
    try {
      console.log(`🔍 ASM1 Searching for: "${searchTerm}" - Loading from Firebase...`);
      
      // IMPROVED: Query Firebase với nhiều điều kiện hơn để tìm kiếm toàn diện
      let querySnapshot;
      
      // Thử tìm kiếm theo materialCode trước (chính xác nhất) - ASM1 only
      querySnapshot = await this.firestore.collection('inventory-materials', ref => 
        ref.where('factory', '==', this.FACTORY)
           .where('materialCode', '==', searchTerm)
           .limit(50)
      ).get().toPromise();
      
      // Nếu không tìm thấy, tìm kiếm theo pattern matching
      if (!querySnapshot || querySnapshot.empty) {
        console.log(`🔍 ASM1 No exact match for "${searchTerm}", trying pattern search...`);
        
        querySnapshot = await this.firestore.collection('inventory-materials', ref => 
          ref.where('factory', '==', this.FACTORY)
             .where('materialCode', '>=', searchTerm)
             .where('materialCode', '<=', searchTerm + '\uf8ff')
             .limit(100)
        ).get().toPromise();
      }
      
      // Nếu vẫn không tìm thấy, tìm kiếm theo PO number
      if (!querySnapshot || querySnapshot.empty) {
        console.log(`🔍 ASM1 No pattern match for "${searchTerm}", trying PO search...`);
        
        querySnapshot = await this.firestore.collection('inventory-materials', ref => 
          ref.where('factory', '==', this.FACTORY)
             .where('poNumber', '>=', searchTerm)
             .where('poNumber', '<=', searchTerm + '\uf8ff')
             .limit(100)
        ).get().toPromise();
      }
      
      if (querySnapshot && !querySnapshot.empty) {
        console.log(`✅ ASM1 Found ${querySnapshot.docs.length} documents from Firebase`);
        
        // Process search results
        this.inventoryMaterials = querySnapshot.docs.map(doc => {
          const data = doc.data() as any;
          const material = {
            id: doc.id,
            ...data,
            factory: this.FACTORY, // Force ASM1
            importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : new Date(),
            receivedDate: data.receivedDate ? new Date(data.receivedDate.seconds * 1000) : new Date(),
            expiryDate: data.expiryDate ? new Date(data.expiryDate.seconds * 1000) : new Date(),
            xt: data.xt || 0 // Initialize XT field for search results
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
        
        // Sắp xếp FIFO: Material Code -> PO (oldest first)
        this.sortInventoryFIFO();
        
        // Tự động cập nhật số lượng xuất từ outbound cho kết quả tìm kiếm
        this.autoUpdateSearchResultsExportedFromOutbound();
        
        console.log(`✅ ASM1 Search completed: ${this.filteredInventory.length} results from ${this.inventoryMaterials.length} loaded items`);
        
        // Debug: Log tất cả material codes tìm được
        const materialCodes = this.filteredInventory.map(item => item.materialCode);
        console.log(`🔍 ASM1 Found material codes:`, materialCodes);
        
      } else {
        // No results found
        this.inventoryMaterials = [];
        this.filteredInventory = [];
        console.log(`🔍 ASM1 No results found for: "${searchTerm}" after trying all search methods`);
      }
      
    } catch (error) {
      console.error('❌ ASM1 Error during search:', error);
      this.filteredInventory = [];
    } finally {
      this.isLoading = false;
    }
  }

  // Track by function for ngFor optimization
  trackByFn(index: number, item: any): any {
    return item.id || index;
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

  // Status helper methods
  getStatusClass(item: InventoryMaterial): string {
    if (item.isCompleted) return 'status-completed';
    if (item.isDuplicate) return 'status-duplicate';
    if (item.importStatus === 'Import') return 'status-import';
    return 'status-active';
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

  // Mark duplicates within ASM1
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

  // Consolidate inventory data by material code + PO + location
  consolidateInventoryData(): void {
    console.log('🔄 Starting inventory data consolidation...');
    
    const consolidatedMap = new Map<string, InventoryMaterial>();
    
    this.inventoryMaterials.forEach(material => {
      // Create key: materialCode + PO + location
      const key = `${material.materialCode}_${material.poNumber}_${material.location}`;
      
      if (consolidatedMap.has(key)) {
        // Same material + PO + location - merge quantities
        const existing = consolidatedMap.get(key)!;
        existing.quantity += material.quantity;
        existing.stock = (existing.stock || 0) + (material.stock || 0);
        existing.exported = (existing.exported || 0) + (material.exported || 0);
        existing.xt = (existing.xt || 0) + (material.xt || 0);
        
        // Keep earliest import date and latest expiry date
        if (material.importDate < existing.importDate) {
          existing.importDate = material.importDate;
        }
        if (material.expiryDate > existing.expiryDate) {
          existing.expiryDate = material.expiryDate;
        }
        
        // Merge other fields
        existing.notes = existing.notes ? `${existing.notes}; ${material.notes}` : material.notes;
        existing.remarks = existing.remarks ? `${existing.remarks}; ${material.remarks}` : material.remarks;
        existing.supplier = existing.supplier ? `${existing.supplier}; ${material.supplier}` : material.supplier;
        
        console.log(`🔄 Merged duplicate: ${material.materialCode} - PO: ${material.poNumber} - Location: ${material.location}`);
        
      } else {
        // New unique combination - add to map
        consolidatedMap.set(key, { ...material });
      }
    });
    
    // Now handle same material + PO but different locations
    const materialPoMap = new Map<string, InventoryMaterial[]>();
    
    consolidatedMap.forEach((material, key) => {
      const materialPoKey = `${material.materialCode}_${material.poNumber}`;
      
      if (!materialPoMap.has(materialPoKey)) {
        materialPoMap.set(materialPoKey, []);
      }
      materialPoMap.get(materialPoKey)!.push(material);
    });
    
    // Final consolidation map
    const finalConsolidatedMap = new Map<string, InventoryMaterial>();
    
    materialPoMap.forEach((materials, materialPoKey) => {
      if (materials.length === 1) {
        // Single location - keep as is
        const material = materials[0];
        finalConsolidatedMap.set(materialPoKey, material);
      } else {
        // Multiple locations - merge into one row with combined location info
        const baseMaterial = { ...materials[0] };
        const locations = materials.map(m => m.location).join('; ');
        
        // Combine quantities
        baseMaterial.quantity = materials.reduce((sum, m) => sum + m.quantity, 0);
        baseMaterial.stock = materials.reduce((sum, m) => sum + (m.stock || 0), 0);
        baseMaterial.exported = materials.reduce((sum, m) => sum + (m.exported || 0), 0);
        baseMaterial.xt = materials.reduce((sum, m) => sum + (m.xt || 0), 0);
        
        // Combine location field
        baseMaterial.location = locations;
        
        // Keep earliest import date and latest expiry date
        baseMaterial.importDate = new Date(Math.min(...materials.map(m => m.importDate.getTime())));
        baseMaterial.expiryDate = new Date(Math.max(...materials.map(m => m.expiryDate.getTime())));
        
        // Merge other fields
        baseMaterial.notes = materials.map(m => m.notes).filter(n => n).join('; ');
        baseMaterial.remarks = materials.map(m => m.remarks).filter(r => r).join('; ');
        baseMaterial.supplier = materials.map(m => m.supplier).filter(s => s).join('; ');
        
        finalConsolidatedMap.set(materialPoKey, baseMaterial);
        
        console.log(`🔄 Consolidated multi-location: ${baseMaterial.materialCode} - PO: ${baseMaterial.poNumber} - Locations: ${locations}`);
      }
    });
    
    // Update the inventory data
    const originalCount = this.inventoryMaterials.length;
    this.inventoryMaterials = Array.from(finalConsolidatedMap.values());
    this.filteredInventory = [...this.inventoryMaterials];
    
    // Sắp xếp FIFO sau khi gộp dữ liệu
    this.sortInventoryFIFO();
    
    console.log(`✅ Inventory consolidation completed: ${originalCount} → ${this.inventoryMaterials.length} items`);
    
    // Show consolidation message
    const reducedCount = originalCount - this.inventoryMaterials.length;
    if (reducedCount > 0) {
      this.consolidationMessage = `✅ Đã gộp ${reducedCount} dòng dữ liệu trùng lặp. Từ ${originalCount} → ${this.inventoryMaterials.length} dòng.`;
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
  }

  // Load permissions
  loadPermissions(): void {
    console.log('🔍 DEBUG: loadPermissions called');
    
    this.tabPermissionService.canAccessTab('materials-asm1')
      .pipe(takeUntil(this.destroy$))
      .subscribe(canAccess => {
        console.log(`🔍 DEBUG: Tab permission result for 'materials-asm1': ${canAccess}`);
        
        // Set basic permissions based on tab access
        this.canView = canAccess;
        this.canEdit = canAccess;
        this.canExport = canAccess;
        this.canDelete = canAccess;
        // this.canEditHSD = canAccess; // Removed - HSD column deleted
        
        // Lưu ý: Cột "Đã xuất" luôn có thể chỉnh sửa (giống cột "Vị trí")
        // không phụ thuộc vào canExport permission
        
        console.log('🔑 ASM1 Permissions loaded:', {
          canView: this.canView,
          canEdit: this.canEdit,
          canExport: this.canExport,
          canDelete: this.canDelete,
          // canEditHSD: this.canEditHSD // Removed - HSD column deleted
        });
      });
  }

  // Import current stock with ASM1 filter
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

                      // Start import process with ASM1 filter and duplicate strategy
            const result = await this.excelImportService.importStockFile(file, 50, 'ASM1', duplicateStrategy);
          
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
      message += `🎉 Đã thêm ${result.success} items mới vào inventory ASM1\n`;
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

  // Update Standard Packing only - Simple and focused
  async importCatalog(): Promise<void> {
    try {
      console.log('📥 Updating Standard Packing values');
      
      // Check Firebase status first
      try {
        console.log('🔍 Testing Firebase connection...');
        const testSnapshot = await this.firestore.collection('materials').get().toPromise();
        if (testSnapshot) {
          console.log('✅ Firebase connection OK');
        }
      } catch (firebaseError) {
        console.error('❌ Firebase connection failed:', firebaseError);
        
        if (firebaseError.code === 'resource-exhausted') {
          alert(`❌ KHÔNG THỂ KẾT NỐI FIREBASE!\n\n🚨 Firebase Quota Exceeded\n\n💡 Giải pháp:\n1. Kiểm tra Firebase Console → Usage and billing\n2. Đợi quota reset hoặc upgrade plan\n3. Thử lại sau khi fix quota`);
          return;
        } else {
          alert(`❌ Lỗi kết nối Firebase:\n\n${firebaseError.message}\n\n💡 Vui lòng kiểm tra kết nối và thử lại`);
          return;
        }
      }
      
      // Create file input element
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.xlsx,.xls';
      fileInput.style.display = 'none';
      
      fileInput.onchange = async (event: any) => {
        const file = event.target.files[0];
        if (!file) return;
        
        try {
          // Show loading
          this.isCatalogLoading = true;
          
          // Read Excel file
          const data = await this.readExcelFile(file);
          console.log('📊 Excel data read:', data);
          
          // Process catalog data
          const catalogData = this.processCatalogData(data);
          console.log('📋 Processed catalog data:', catalogData);
          
          try {
            // Save to Firebase
            await this.saveCatalogToFirebase(catalogData);
            console.log('✅ Firebase update completed successfully');
            
            // Update local cache
            this.updateCatalogCache(catalogData);
            
            // Reload catalog from Firebase to ensure consistency
            await this.loadCatalogFromFirebase();
            
            // Show success message ONLY after successful Firebase update
            alert(`✅ Cập nhật Standard Packing thành công!\n\n📦 Tổng số mã hàng: ${catalogData.length}\n💡 Chỉ cập nhật field Standard Packing\n🎯 Dữ liệu được update trong collections 'materials' (chính) và 'catalog'\n🔄 Cột Standard Packing sẽ hiển thị số đúng ngay lập tức`);
            
          } catch (firebaseError) {
            console.error('❌ Firebase update failed:', firebaseError);
            
            // Check if it's a quota error
            if (firebaseError.code === 'resource-exhausted') {
              alert(`❌ KHÔNG THỂ LƯU DỮ LIỆU!\n\n🚨 Firebase Quota Exceeded\n\n💡 Giải pháp:\n1. Kiểm tra Firebase Console → Usage and billing\n2. Đợi quota reset hoặc upgrade plan\n3. Thử lại sau khi fix quota`);
            } else {
              alert(`❌ Lỗi khi lưu vào Firebase:\n\n${firebaseError.message}\n\n💡 Vui lòng thử lại hoặc liên hệ admin`);
            }
            
            // Don't show success message if Firebase failed
            return;
          }
          
        } catch (error) {
          console.error('❌ Error importing catalog:', error);
          alert('❌ Lỗi khi import danh mục: ' + error.message);
        } finally {
          this.isCatalogLoading = false;
          // Remove file input
          document.body.removeChild(fileInput);
        }
      };
      
      // Trigger file selection
      document.body.appendChild(fileInput);
      fileInput.click();
      
    } catch (error) {
      console.error('❌ Error in importCatalog:', error);
      alert('❌ Lỗi khi import danh mục: ' + error.message);
    }
  }

  // Read Excel file and return data
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

  // Process catalog data from Excel - FOCUS ON Standard Packing only
  private processCatalogData(data: any[]): any[] {
    return data.map(row => {
      // ✅ CHỈ CẦN 2 FIELD: Mã hàng + Standard Packing
      const materialCode = row['Mã hàng'] || row['materialCode'] || row['Mã'] || row['Code'] || '';
      const standardPacking = parseFloat(row['Standard Packing'] || row['standardPacking'] || row['Số lượng đóng gói'] || '0') || 0;
      
      return {
        materialCode,
        standardPacking
      };
    }).filter(item => {
      // Filter out rows without materialCode
      const hasMaterialCode = item.materialCode && item.materialCode.trim() !== '';
      // Warn if standardPacking is 0
      if (hasMaterialCode && item.standardPacking === 0) {
        console.warn(`⚠️ Warning: Material ${item.materialCode} has standardPacking = 0`);
      }
      return hasMaterialCode;
    });
  }

  // Save catalog to Firebase - UPDATE Standard Packing in both collections
  private async saveCatalogToFirebase(catalogData: any[]): Promise<void> {
    try {
      console.log('💾 Starting Firebase update...');
      
      const batch = this.firestore.firestore.batch();
      
              for (const item of catalogData) {
          // ✅ UPDATE field standardPacking trong collection 'materials' (chính - có 8750 docs)
          const materialsDocRef = this.firestore.collection('materials').doc(item.materialCode).ref;
          batch.update(materialsDocRef, {
            standardPacking: item.standardPacking,
            updatedAt: new Date()
          });
          
          // ✅ Cũng UPDATE trong collection 'catalog' (đồng bộ)
          const catalogDocRef = this.firestore.collection('catalog').doc(item.materialCode).ref;
          batch.update(catalogDocRef, {
            standardPacking: item.standardPacking,
            updatedAt: new Date()
          });
          
          console.log(`📝 Prepared update for ${item.materialCode}: standardPacking = ${item.standardPacking}`);
        }
      
      console.log('🚀 Committing batch update to Firebase...');
      await batch.commit();
      console.log(`✅ Successfully updated Standard Packing for ${catalogData.length} materials in both collections`);
      
    } catch (error) {
      console.error('❌ Firebase update failed:', error);
      
      // Re-throw the error to be handled by the caller
      throw error;
    }
  }

  // Update local catalog cache
  private updateCatalogCache(catalogData: any[]): void {
    for (const item of catalogData) {
      this.catalogCache.set(item.materialCode, item);
    }
    this.catalogLoaded = true;
    console.log(`🔄 Updated local catalog cache with ${catalogData.length} items`);
  }

  downloadCatalogTemplate(): void {
    try {
      console.log('📥 Downloading catalog template - Standard Packing only');
      
      // ✅ CHỈ CẦN 2 CỘT: Mã hàng + Standard Packing
      const templateData = [
        {
          'Mã hàng': 'B001003',
          'Standard Packing': 100
        },
        {
          'Mã hàng': 'P0123',
          'Standard Packing': 50
        },
        {
          'Mã hàng': 'B018694',
          'Standard Packing': 200
        }
      ];
      
      // Create workbook and worksheet
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(templateData);
      
      // Set column widths - chỉ 2 cột
      worksheet['!cols'] = [
        { width: 15 }, // Mã hàng
        { width: 18 }  // Standard Packing
      ];
      
      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Standard Packing Update');
      
      // Generate file and download
      const fileName = `Standard_Packing_Update_ASM1_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      
      console.log('✅ Standard Packing template downloaded successfully');
      
    } catch (error) {
      console.error('❌ Error downloading template:', error);
      alert('❌ Lỗi khi tải template: ' + error.message);
    }
  }

  downloadStockTemplate(): void {
    console.log('Download stock template');
  }

  downloadFIFOReportASM1(): void {
    console.log('Download FIFO report for ASM1');
  }

  // Delete single inventory item
  async deleteInventoryItem(material: InventoryMaterial): Promise<void> {
    console.log('🗑️ ASM1 deleteInventoryItem called for:', material.materialCode);
    
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
    
    if (confirm(`Xác nhận xóa item ${material.materialCode} khỏi ASM1 Inventory?\n\nPO: ${material.poNumber}\nVị trí: ${material.location}\nSố lượng: ${material.quantity} ${material.unit}`)) {
      console.log(`✅ User confirmed deletion of ${material.materialCode}`);
      
      try {
        // Show loading
        this.isLoading = true;
        
        // Delete from Firebase
        await this.firestore.collection('inventory-materials').doc(material.id).delete();
        console.log('✅ Item deleted from Firebase successfully');
        
        // Remove from local array
        const index = this.inventoryMaterials.indexOf(material);
        if (index > -1) {
          this.inventoryMaterials.splice(index, 1);
          console.log(`✅ Removed ${material.materialCode} from local array`);
          
          // Refresh the view
          this.applyFilters();
          
          // Show success message
          alert(`✅ Đã xóa thành công item ${material.materialCode}!\n\nPO: ${material.poNumber}\nVị trí: ${material.location}`);
        }
      } catch (error) {
        console.error('❌ Error deleting item:', error);
        alert(`❌ Lỗi khi xóa item ${material.materialCode}: ${error.message || 'Lỗi không xác định'}`);
      } finally {
        this.isLoading = false;
      }
    } else {
      console.log(`❌ User cancelled deletion of ${material.materialCode}`);
    }
  }

  // Delete all inventory for ASM1
  async deleteAllInventory(): Promise<void> {
    try {
      // Confirm deletion with user
      const confirmDelete = confirm(
        '⚠️ CẢNH BÁO: Bạn có chắc chắn muốn xóa TOÀN BỘ tồn kho ASM1?\n\n' +
        'Thao tác này sẽ:\n' +
        '• Xóa tất cả dữ liệu tồn kho ASM1\n' +
        '• Không thể hoàn tác\n' +
        '• Cần import lại toàn bộ dữ liệu\n\n' +
        'Nhập "DELETE" để xác nhận:'
      );
      
      if (!confirmDelete) return;
      
      const userInput = prompt('Nhập "DELETE" để xác nhận xóa toàn bộ tồn kho ASM1:');
      if (userInput !== 'DELETE') {
        alert('❌ Xác nhận không đúng. Thao tác bị hủy.');
        return;
      }

      // Show loading
      this.isLoading = true;
      
      // Get all ASM1 inventory documents
      const inventoryQuery = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', 'ASM1')
      ).get().toPromise();
      
      if (!inventoryQuery || inventoryQuery.empty) {
        alert('✅ Không có dữ liệu tồn kho ASM1 để xóa.');
        this.isLoading = false;
        return;
      }

      const totalItems = inventoryQuery.docs.length;
      console.log(`🗑️ Starting deletion of ${totalItems} ASM1 inventory items...`);
      
      // Delete all documents in batches
      const batchSize = 500; // Firestore batch limit
      const batches = [];
      
      for (let i = 0; i < inventoryQuery.docs.length; i += batchSize) {
        const batch = this.firestore.firestore.batch();
        const batchDocs = inventoryQuery.docs.slice(i, i + batchSize);
        
        batchDocs.forEach(doc => {
          batch.delete(doc.ref);
        });
        
        batches.push(batch);
      }
      
      // Execute all batches
      let deletedCount = 0;
      for (const batch of batches) {
        await batch.commit();
        deletedCount += batchSize;
        console.log(`✅ Deleted batch: ${deletedCount}/${totalItems} items`);
      }
      
      // Clear local data
      this.inventoryMaterials = [];
      this.filteredInventory = [];
      
      // Show success message
      alert(`✅ Đã xóa thành công ${totalItems} items tồn kho ASM1!\n\n` +
            `Bạn có thể import lại dữ liệu mới.`);
      
      console.log(`✅ Successfully deleted all ${totalItems} ASM1 inventory items`);
      
    } catch (error) {
      console.error('❌ Error deleting all inventory:', error);
      alert(`❌ Lỗi khi xóa tồn kho: ${error.message}`);
    } finally {
      this.isLoading = false;
    }
  }

  // completeInventory method removed - replaced with resetZeroStock
  // completeInventory(): void {
  //   this.showCompleted = !this.showCompleted;
  // }

  syncFromInbound(): void {
    console.log('🔄 Syncing inventory data from Firebase...');
    
    // Reload inventory data from Firebase
    this.loadInventoryFromFirebase();
    
    // Reload catalog data
    this.loadCatalogFromFirebase();
    
    console.log('✅ Sync completed - Data reloaded from Firebase');
  }

  // Update methods for editing
  // updateExported method removed - exported quantity is now read-only and auto-updated from outbound

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

  updateRemarks(material: InventoryMaterial): void {
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
      console.log(`✅ ASM1 Material updated successfully: ${material.materialCode}`);
      console.log(`📊 Stock updated: ${this.calculateCurrentStock(material)} (Quantity: ${material.quantity} - Exported: ${material.exported} - XT: ${material.xt || 0})`);
      
      // Update negative stock count for real-time display
      this.updateNegativeStockCount();
      
      // Show success message to user
      this.showUpdateSuccessMessage(material);
      
    }).catch(error => {
      console.error(`❌ Error updating ASM1 material ${material.materialCode}:`, error);
      
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

  // Calculate current stock for display
  calculateCurrentStock(material: InventoryMaterial): number {
    const stock = (material.quantity || 0) - (material.exported || 0) - (material.xt || 0);
    return stock;
  }

  // Get exported quantity from RM1 outbound based on material code and PO
  async getExportedQuantityFromOutbound(materialCode: string, poNumber: string): Promise<number> {
    try {
      console.log(`🔍 Getting exported quantity for ${materialCode} - PO: ${poNumber}`);
      
      const outboundRef = this.firestore.collection('outbound-materials');
      const snapshot = await outboundRef
        .ref
        .where('factory', '==', 'ASM1')
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

  // Update exported quantity from outbound data and save permanently
  async updateExportedFromOutbound(material: InventoryMaterial): Promise<void> {
    try {
      const exportedQuantity = await this.getExportedQuantityFromOutbound(material.materialCode, material.poNumber);
      
      if (material.exported !== exportedQuantity) {
        material.exported = exportedQuantity;
        console.log(`📊 Updated exported quantity for ${material.materialCode} - PO ${material.poNumber}: ${exportedQuantity}`);
        
        // Update exported field directly in Firebase to preserve the value permanently
        // This ensures the exported quantity is preserved even if outbound records are deleted
        if (material.id) {
          await this.firestore.collection('inventory-materials').doc(material.id).update({
            exported: exportedQuantity,
            updatedAt: new Date()
          });
          console.log(`💾 Exported quantity saved permanently to Firebase for ${material.materialCode}`);
        }
      }
    } catch (error) {
      console.error(`❌ Error updating exported quantity for ${material.materialCode}:`, error);
    }
  }

  // Update XT (planned export) quantity
  async updateXT(material: InventoryMaterial): Promise<void> {
    try {
      console.log(`📝 Updating XT quantity for ${material.materialCode} - PO ${material.poNumber}: ${material.xt}`);
      
      // Update in Firebase
      this.updateMaterialInFirebase(material);
      
      // Recalculate stock
      const newStock = this.calculateCurrentStock(material);
      console.log(`📊 New stock calculated: ${newStock} (Quantity: ${material.quantity} - Exported: ${material.exported} - XT: ${material.xt})`);
      
      // Update negative stock count for real-time display
      this.updateNegativeStockCount();
      
    } catch (error) {
      console.error(`❌ Error updating XT quantity for ${material.materialCode}:`, error);
    }
  }

  // Auto-update all exported quantities from RM1 outbound (silent, no user interaction)
  private async autoUpdateAllExportedFromOutbound(): Promise<void> {
    try {
      console.log('🔄 Auto-updating exported quantities from RM1 outbound...');
      
      let updatedCount = 0;
      let errorCount = 0;
      
      for (const material of this.inventoryMaterials) {
        try {
          await this.updateExportedFromOutbound(material);
          updatedCount++;
        } catch (error) {
          console.error(`❌ Error auto-updating ${material.materialCode} - PO ${material.poNumber}:`, error);
          errorCount++;
        }
      }
      
      console.log(`✅ Auto-update completed: ${updatedCount} materials updated, ${errorCount} errors`);
      
      // Refresh the display
      this.filteredInventory = [...this.inventoryMaterials];
      
      // Sắp xếp FIFO sau khi cập nhật
      this.sortInventoryFIFO();
      
    } catch (error) {
      console.error('❌ Error during auto-update:', error);
    }
  }

  // Auto-update exported quantities for search results only
  private async autoUpdateSearchResultsExportedFromOutbound(): Promise<void> {
    try {
      console.log('🔄 Auto-updating exported quantities for search results...');
      
      let updatedCount = 0;
      let errorCount = 0;
      
      for (const material of this.filteredInventory) {
        try {
          await this.updateExportedFromOutbound(material);
          updatedCount++;
        } catch (error) {
          console.error(`❌ Error auto-updating search result ${material.materialCode} - PO ${material.poNumber}:`, error);
          errorCount++;
        }
      }
      
      console.log(`✅ Search results auto-update completed: ${updatedCount} materials updated, ${errorCount} errors`);
      
    } catch (error) {
      console.error('❌ Error during search results auto-update:', error);
    }
  }

  // Sync all exported quantities from RM1 outbound (manual sync - kept for backward compatibility)
  async syncAllExportedFromOutbound(): Promise<void> {
    try {
      console.log('🔄 Starting manual sync of all exported quantities from RM1 outbound...');
      
      let updatedCount = 0;
      let errorCount = 0;
      
      for (const material of this.inventoryMaterials) {
        try {
          await this.updateExportedFromOutbound(material);
          updatedCount++;
        } catch (error) {
          console.error(`❌ Error syncing ${material.materialCode} - PO ${material.poNumber}:`, error);
          errorCount++;
        }
      }
      
      console.log(`✅ Manual sync completed: ${updatedCount} materials updated, ${errorCount} errors`);
      
      // Refresh the display
      this.filteredInventory = [...this.inventoryMaterials];
      
      // Sắp xếp FIFO sau khi đồng bộ
      this.sortInventoryFIFO();
      
      // Show success message
      if (errorCount === 0) {
        alert(`✅ Đồng bộ hoàn tất!\n\nĐã cập nhật ${updatedCount} mã hàng từ RM1 outbound.`);
      } else {
        alert(`⚠️ Đồng bộ hoàn tất với ${errorCount} lỗi!\n\nĐã cập nhật ${updatedCount} mã hàng từ RM1 outbound.`);
      }
      
    } catch (error) {
      console.error('❌ Error during manual sync:', error);
      alert('❌ Lỗi khi đồng bộ số lượng xuất từ RM1 outbound!');
    }
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
  }





  // Toggle negative stock filter
  toggleNegativeStockFilter(): void {
    console.log('🔄 Toggling negative stock filter...');
    console.log(`📊 Current showOnlyNegativeStock: ${this.showOnlyNegativeStock}`);
    console.log(`📊 Total materials in inventoryMaterials: ${this.inventoryMaterials.length}`);
    console.log(`📊 Total materials in filteredInventory: ${this.filteredInventory.length}`);
    
    this.showOnlyNegativeStock = !this.showOnlyNegativeStock;
    
    if (this.showOnlyNegativeStock) {
      // Filter to show only negative stock items
      // Use filteredInventory as base if inventoryMaterials is empty
      const baseMaterials = this.inventoryMaterials.length > 0 ? this.inventoryMaterials : this.filteredInventory;
      
      this.filteredInventory = baseMaterials.filter(material => {
        const stock = this.calculateCurrentStock(material);
        const isNegative = stock < 0;
        console.log(`🔍 ${material.materialCode} - PO ${material.poNumber}: Stock = ${stock}, Is Negative = ${isNegative}`);
        return isNegative;
      });
      console.log(`🔍 Filtered to show only negative stock items: ${this.filteredInventory.length} items`);
    } else {
      // Show all items
      // Use filteredInventory as base if inventoryMaterials is empty
      const baseMaterials = this.inventoryMaterials.length > 0 ? this.inventoryMaterials : this.filteredInventory;
      this.filteredInventory = [...baseMaterials];
      console.log(`🔍 Showing all items: ${this.filteredInventory.length} items`);
    }
    
    // Force change detection
    this.cdr.detectChanges();
    
    // Update negative stock count after filtering
    this.updateNegativeStockCount();
    
    console.log(`✅ Filter toggled. showOnlyNegativeStock: ${this.showOnlyNegativeStock}, filteredItems: ${this.filteredInventory.length}`);
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
  getStandardPacking(materialCode: string): number {
    console.log(`🔍 Getting Standard Packing for ${materialCode}`);
    console.log(`📋 Catalog cache size: ${this.catalogCache.size}`);
    console.log(`📋 Catalog loaded: ${this.catalogLoaded}`);
    
    if (this.catalogCache.has(materialCode)) {
      const catalogItem = this.catalogCache.get(materialCode);
      console.log(`✅ Found in catalog:`, catalogItem);
      const result = catalogItem?.standardPacking || 0;
      console.log(`📦 Standard Packing result: ${result}`);
      return result;
    } else {
      console.log(`❌ Material ${materialCode} NOT found in catalog cache`);
      console.log(`📋 Available catalog keys:`, Array.from(this.catalogCache.keys()));
      return 0;
    }
  }





  // Helper method to check if Rolls/Bags is valid for QR printing
  isRollsOrBagsValid(material: InventoryMaterial): boolean {
    const rollsOrBagsValue = material.rollsOrBags;
    return rollsOrBagsValue && 
           !(typeof rollsOrBagsValue === 'string' && rollsOrBagsValue.trim() === '') &&
           parseFloat(String(rollsOrBagsValue)) > 0;
  }

  // Print QR Code for inventory items
  async printQRCode(material: InventoryMaterial): Promise<void> {
    try {
      console.log('🏷️ Generating QR code for ASM1 material:', material.materialCode);
      
      // Kiểm tra Rolls/Bags trước khi tạo QR
      const rollsOrBagsValue = material.rollsOrBags;
      if (!rollsOrBagsValue || 
          (typeof rollsOrBagsValue === 'string' && rollsOrBagsValue.trim() === '') ||
          parseFloat(String(rollsOrBagsValue)) <= 0) {
        alert('❌ Không thể in tem QR!\n\nLý do: Thiếu Rolls/Bags\n\nVui lòng nhập số lượng Rolls/Bags trước khi in tem QR.');
        return;
      }
      
      // Calculate quantity per roll/bag
      const rollsOrBags = parseFloat(material.rollsOrBags) || 1;
      const totalQuantity = this.calculateCurrentStock(material);
      
      if (!totalQuantity || totalQuantity <= 0) {
        alert('❌ Vui lòng nhập số lượng trước khi tạo QR code!');
        return;
      }
      
      // Calculate how many full units we can make
      const fullUnits = Math.floor(totalQuantity / rollsOrBags);
      const remainingQuantity = totalQuantity % rollsOrBags;
      
      console.log('📊 QR calculation:', {
        totalQuantity,
        rollsOrBags,
        fullUnits,
        remainingQuantity
      });
      
      // Generate QR codes based on quantity per unit
      const qrCodes = [];
      
      // Add full units
      for (let i = 0; i < fullUnits; i++) {
        qrCodes.push({
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          unitNumber: rollsOrBags,
          qrData: `${material.materialCode}|${material.poNumber}|${rollsOrBags}`
        });
      }
      
      // Add remaining quantity if any
      if (remainingQuantity > 0) {
        qrCodes.push({
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          unitNumber: remainingQuantity,
          qrData: `${material.materialCode}|${material.poNumber}|${remainingQuantity}`
        });
      }

      if (qrCodes.length === 0) {
        alert('❌ Vui lòng nhập đơn vị hợp lệ trước khi tạo QR code!');
        return;
      }

      console.log(`📦 Generated ${qrCodes.length} QR codes for ASM1`);

      // Generate QR code images
      const qrImages = await Promise.all(
        qrCodes.map(async (qrCode, index) => {
          const qrImage = await QRCode.toDataURL(qrCode.qrData, {
            width: 200,
            margin: 1,
            color: {
              dark: '#000000',
              light: '#FFFFFF'
            }
          });
          
          return {
            image: qrImage,
            materialCode: qrCode.materialCode,
            poNumber: qrCode.poNumber,
            unitNumber: qrCode.unitNumber,
            qrData: qrCode.qrData,
            index: index + 1
          };
        })
      );

      // Create print window
      this.createQRPrintWindow(qrImages, material);
      
    } catch (error) {
      console.error('❌ Error generating QR code for ASM1:', error);
      alert('❌ Lỗi khi tạo QR code: ' + error.message);
    }
  }

  // Scan QR for location change
  scanLocationQR(material: InventoryMaterial): void {
    console.log('📷 Opening QR scanner for location change:', material.materialCode);
    
    const dialogData: QRScannerData = {
      title: 'Quét Barcode Vị Trí',
      message: 'Camera sẽ tự động quét barcode vị trí mới',
      materialCode: material.materialCode
    };

    const dialogRef = this.dialog.open(QRScannerModalComponent, {
      width: '500px',
      maxWidth: '95vw',
      data: dialogData,
      disableClose: true, // Prevent accidental close
      panelClass: 'qr-scanner-dialog'
    });

    dialogRef.afterClosed().subscribe(result => {
      console.log('📷 QR Scanner result:', result);
      
      if (result && result.success && result.location) {
        // Update location
        const oldLocation = material.location;
        material.location = result.location;
        
        console.log(`📍 Location changed: ${oldLocation} → ${result.location}`);
        
        // Save to Firebase
        this.updateLocation(material);
        
        // Show success message
        const method = result.manual ? 'nhập thủ công' : 'quét QR';
        alert(`✅ Đã thay đổi vị trí thành công!\n\nMã hàng: ${material.materialCode}\nVị trí cũ: ${oldLocation}\nVị trí mới: ${result.location}\n\nPhương thức: ${method}`);
        
      } else if (result && result.cancelled) {
        console.log('❌ QR scan cancelled by user');
      } else {
        console.log('❌ QR scan failed or no result');
      }
    });
  }

  // Reset function - Delete items with zero stock
  async resetZeroStock(): Promise<void> {
    try {
      // Find all items with stock = 0
      const zeroStockItems = this.inventoryMaterials.filter(item => 
        item.factory === this.FACTORY && this.calculateCurrentStock(item) === 0
      );

      if (zeroStockItems.length === 0) {
        alert('✅ Không có mã hàng nào có tồn kho = 0 trong ASM1');
        return;
      }

      // Show confirmation dialog
      const confirmed = confirm(
        `🔄 RESET ASM1 INVENTORY\n\n` +
        `Tìm thấy ${zeroStockItems.length} mã hàng có tồn kho = 0\n\n` +
        `Bạn có muốn xóa tất cả những mã hàng này không?\n\n` +
        `⚠️ Hành động này không thể hoàn tác!`
      );

      if (!confirmed) {
        return;
      }

      console.log(`🗑️ Starting reset for ASM1: ${zeroStockItems.length} items to delete`);

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

        console.log(`✅ ASM1 Reset batch ${Math.floor(i/batchSize) + 1} completed: ${deletedCount}/${zeroStockItems.length}`);

        // Small delay between batches
        if (i + batchSize < zeroStockItems.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      alert(`✅ Reset hoàn thành!\nĐã xóa ${deletedCount} mã hàng có tồn kho = 0 từ ASM1`);

      // Reload inventory data
      this.loadInventoryFromFirebase();

    } catch (error) {
      console.error('❌ Error during ASM1 reset:', error);
      alert(`❌ Lỗi khi reset ASM1: ${error.message}`);
    }
  }

  // Create print window for QR codes - Using Inbound format
  private createQRPrintWindow(qrImages: any[], material: InventoryMaterial): void {
    const printWindow = window.open('', '_blank');
    
    if (!printWindow) {
      alert('❌ Không thể mở cửa sổ in. Vui lòng cho phép popup!');
      return;
    }

    const currentDate = new Date().toLocaleDateString('vi-VN');
    
    // Use exact same format as Inbound for consistency
    printWindow.document.write(`
      <html>
        <head>
          <title>QR Label - ASM1 - ${material.materialCode}</title>
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
              padding: 1mm !important;
              display: flex !important;
              flex-direction: column !important;
              justify-content: space-between !important;
              font-size: 8px !important;
              line-height: 1.1 !important;
              box-sizing: border-box !important;
            }
            
            .info-row {
              margin: 0.3mm 0 !important;
              font-weight: bold !important;
            }
            
            .info-row.small {
              font-size: 7px !important;
              color: #666 !important;
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
                font-size: 8px !important;
                padding: 1mm !important;
              }
              
              .info-row.small {
                font-size: 7px !important;
              }
              
              .qr-grid {
                gap: 0 !important;
                padding: 0 !important;
                margin: 0 !important;
                width: 57mm !important;
                height: 32mm !important;
              }
            }
          </style>
        </head>
        <body>
          <div class="qr-grid">
            ${qrImages.map(qr => `
              <div class="qr-container">
                <div class="qr-section">
                  <img src="${qr.image}" alt="QR Code" class="qr-image">
                </div>
                <div class="info-section">
                  <div class="info-row">${qr.materialCode}</div>
                  <div class="info-row">${qr.poNumber}</div>
                  <div class="info-row">${qr.unitNumber}</div>
                  <div class="info-row small">ASM1</div>
                  <div class="info-row small">${currentDate}</div>
                </div>
              </div>
            `).join('')}
          </div>
          <script>
            window.onload = function() {
              setTimeout(() => {
                window.print();
              }, 500);
            };
          </script>
        </body>
      </html>
    `);

    printWindow.document.close();
    console.log(`✅ QR labels created for ASM1 with Inbound format - ${qrImages.length} labels`);
  }

  // Export inventory data to Excel
  exportToExcel(): void {
    if (!this.canExport) {
      alert('Bạn không có quyền xuất dữ liệu');
      return;
    }

    try {
      console.log('📊 Exporting ASM1 inventory data to Excel...');
      
      // Optimize data for smaller file size
      const exportData = this.filteredInventory.map(material => ({
        'Factory': material.factory || 'ASM1',
        'Import Date': material.importDate.toLocaleDateString('vi-VN', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit'
        }),
        'Batch': material.batchNumber || '',
        'Material': material.materialCode || '',
        'Name': material.materialName || '',
        'PO': material.poNumber || '',
        'Qty': material.quantity || 0,
        'Unit': material.unit || '',
        'Exported': material.exported || 0,
        'XT': material.xt || 0,
        'Stock': (material.quantity || 0) - (material.exported || 0) - (material.xt || 0),
        'Location': material.location || '',
        'Type': material.type || '',
        'Expiry': material.expiryDate?.toLocaleDateString('vi-VN', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit'
        }) || '',
        'QC': material.qualityCheck ? 'Yes' : 'No',
        'Received': material.isReceived ? 'Yes' : 'No',
        'Completed': material.isCompleted ? 'Yes' : 'No',
        'Supplier': material.supplier || ''
      }));
      
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      
      // Set column widths for better readability
      const colWidths = [
        { wch: 8 },   // Factory
        { wch: 10 },  // Import Date
        { wch: 12 },  // Batch
        { wch: 15 },  // Material
        { wch: 20 },  // Name
        { wch: 12 },  // PO
        { wch: 8 },   // Qty
        { wch: 6 },   // Unit
        { wch: 8 },   // Exported
        { wch: 6 },   // XT
        { wch: 8 },   // Stock
        { wch: 12 },  // Location
        { wch: 8 },   // Type
        { wch: 10 },  // Expiry
        { wch: 6 },   // QC
        { wch: 8 },   // Received
        { wch: 8 },   // Completed
        { wch: 15 }   // Supplier
      ];
      worksheet['!cols'] = colWidths;
      
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'ASM1_Inventory');
      
      const fileName = `ASM1_Inventory_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      
      console.log('✅ ASM1 inventory data exported to Excel');
      alert(`✅ Đã xuất ${exportData.length} records ra file Excel`);
      
    } catch (error) {
      console.error('❌ Export error:', error);
      alert('Lỗi export: ' + error.message);
    }
  }



  // Kiểm tra lịch sử xuất của material
  checkExportHistory(material: InventoryMaterial): void {
    console.log(`🔍 DEBUG: Checking export history for ${material.materialCode} - PO: ${material.poNumber}`);
    console.log(`📊 Material details:`, {
      id: material.id,
      quantity: material.quantity,
      exported: material.exported,
      xt: material.xt,
      calculatedStock: this.calculateCurrentStock(material),
      location: material.location
    });

    // Kiểm tra trong collection outbound-materials
    this.firestore.collection('outbound-materials', ref => 
      ref.where('materialCode', '==', material.materialCode)
         .where('poNumber', '==', material.poNumber)
         .where('factory', '==', 'ASM1')
         .orderBy('exportDate', 'desc')
         .limit(10)
    ).get().subscribe(snapshot => {
      console.log(`📦 Found ${snapshot.docs.length} outbound records for ${material.materialCode} - ${material.poNumber}`);
      
      snapshot.docs.forEach((doc, index) => {
        const data = doc.data() as any;
        console.log(`  ${index + 1}. Export: ${data.exportQuantity} on ${data.exportDate?.toDate?.() || data.exportDate}`);
      });
    });

    // Kiểm tra trong collection inventory-materials
    this.firestore.collection('inventory-materials', ref => 
      ref.where('materialCode', '==', material.materialCode)
         .where('poNumber', '==', material.poNumber)
         .where('factory', '==', 'ASM1')
    ).get().subscribe(snapshot => {
      console.log(`📋 Found ${snapshot.docs.length} inventory records for ${material.materialCode} - ${material.poNumber}`);
      
      snapshot.docs.forEach((doc, index) => {
        const data = doc.data() as any;
        console.log(`  ${index + 1}. ID: ${doc.id}, Exported: ${data.exported}, Stock: ${data.stock}, Updated: ${data.updatedAt?.toDate?.() || data.updatedAt}`);
      });
    });
  }
}
