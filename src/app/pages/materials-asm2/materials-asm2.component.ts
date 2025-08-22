import { Component, OnInit, OnDestroy, AfterViewInit, HostListener, ChangeDetectorRef } from '@angular/core';
import { Subject } from 'rxjs';
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
  
  // Data properties
  inventoryMaterials: InventoryMaterial[] = [];
  filteredInventory: InventoryMaterial[] = [];
  
  // Loading state
  isLoading = false;
  isCatalogLoading = false;
  
  // Catalog cache for faster access
  private catalogCache = new Map<string, any>();
  public catalogLoaded = false;
  
  // Search and filter
  searchTerm = '';
  searchType: 'material' | 'po' | 'location' = 'material';
  private searchSubject = new Subject<string>();
  
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
    // Load catalog first for material names mapping
    this.loadCatalogFromFirebase().then(() => {
      console.log('📚 ASM2 Catalog loaded, inventory ready for search');
    });
    this.loadPermissions();
    
    // Load inventory data and setup search after data is loaded
    this.loadInventoryAndSetupSearch();
    
    console.log('✅ ASM2 Materials component initialized - Search setup will happen after data loads');
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
    
    // Return to initial state - no data displayed
    console.log('🧹 ASM2 Search cleared, returning to initial state (no data displayed)');
  }

  // Change search type
  changeSearchType(type: 'material' | 'po' | 'location'): void {
    this.searchType = type;
    this.searchTerm = ''; // Clear search when changing type
    this.applyFilters(); // Reapply filters
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

  syncFromInbound(): void {
    console.log('Sync from inbound for ASM2');
  }

  // Update methods for editing
  updateExported(material: InventoryMaterial): void {
    if (!this.canEdit) return;
    this.updateMaterialInFirebase(material);
  }

  updateLocation(material: InventoryMaterial): void {
    if (!this.canEdit) return;
    this.updateMaterialInFirebase(material);
  }

  updateType(material: InventoryMaterial): void {
    if (!this.canEdit) return;
    this.updateMaterialInFirebase(material);
  }

  updateRollsOrBags(material: InventoryMaterial): void {
    if (!this.canEdit) return;
    this.updateMaterialInFirebase(material);
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
    if (!material.id) return;
    
    material.updatedAt = new Date();
    
    // Prepare update data, only include defined values
    const updateData: any = {
      exported: material.exported,
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
    
    this.firestore.collection('inventory-materials').doc(material.id).update(updateData).then(() => {
      console.log('✅ ASM2 Material updated successfully');
    }).catch(error => {
      console.error('❌ Error updating ASM2 material:', error);
    });
  }

  // Calculate current stock for display
  calculateCurrentStock(material: InventoryMaterial): number {
    const stock = (material.quantity || 0) - (material.exported || 0);
    return stock;
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

  // Reset zero stock items
  resetZeroStock(): void {
    if (!this.canDelete) {
      alert('❌ Bạn không có quyền thực hiện hành động này');
        return;
      }

    const zeroStockItems = this.filteredInventory.filter(item => 
      this.calculateCurrentStock(item) <= 0
    );

    if (zeroStockItems.length === 0) {
      alert('✅ Không có items nào có tồn kho ≤ 0');
      return;
    }

    if (confirm(`⚠️ Xác nhận xóa ${zeroStockItems.length} items có tồn kho ≤ 0?\n\nHành động này KHÔNG THỂ HOÀN TÁC!`)) {
      try {
        // Delete zero stock items
        const batch = this.firestore.firestore.batch();
        zeroStockItems.forEach(item => {
          if (item.id) {
            const docRef = this.firestore.collection('inventory-materials').doc(item.id).ref;
            batch.delete(docRef);
          }
        });

        batch.commit().then(() => {
          // Remove from local arrays
          this.inventoryMaterials = this.inventoryMaterials.filter(item => 
            this.calculateCurrentStock(item) > 0
          );
          this.filteredInventory = this.filteredInventory.filter(item => 
            this.calculateCurrentStock(item) > 0
          );
          
          alert(`✅ Đã xóa ${zeroStockItems.length} items có tồn kho ≤ 0`);
        }).catch(error => {
          console.error('❌ Error deleting zero stock items:', error);
          alert(`❌ Lỗi khi xóa items: ${error}`);
        });
        
      } catch (error) {
        console.error('❌ Error preparing batch delete:', error);
        alert(`❌ Lỗi khi chuẩn bị xóa: ${error}`);
      }
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