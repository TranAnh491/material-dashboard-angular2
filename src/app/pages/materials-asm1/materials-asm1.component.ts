import { Component, OnInit, OnDestroy, AfterViewInit, HostListener, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
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
  source?: 'inbound' | 'manual' | 'import'; // Nguồn gốc của dòng dữ liệu
  iqcStatus?: string; // IQC Status: PASS, NG, ĐẶC CÁCH, CHỜ XÁC NHẬN
  
  // Edit states
  isEditingOpeningStock?: boolean;
  isEditingXT?: boolean;

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
  
  // 🔧 LOGIC MỚI: Cập nhật số lượng xuất từ Outbound theo Material + PO
  // - Mỗi dòng Inventory được cập nhật số lượng xuất DỰA TRÊN Material + PO
  // - Outbound RM1 scan/nhập: Material + PO (không còn vị trí)
  // - Hệ thống sẽ tìm tất cả outbound records có cùng Material + PO và cộng dồn
  // - KHÔNG còn bị lỗi số âm sai khi search
  
  // Data properties
  inventoryMaterials: InventoryMaterial[] = [];
  filteredInventory: InventoryMaterial[] = [];
  displayedInventory: InventoryMaterial[] = []; // Items to display on current page
  
  // Pagination
  currentPage: number = 1;
  itemsPerPage: number = 20;
  totalPages: number = 1;
  
  // Loading state
  isLoading = false;
  isCatalogLoading = false;
  isResetting = false; // Loading state for reset operation
  
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
  
  // 🚀 OPTIMIZATION: Add loading states
  isSearching = false;
  searchProgress = 0;
  // Negative stock tracking
  private negativeStockSubject = new BehaviorSubject<number>(0);
  public negativeStockCount$ = this.negativeStockSubject.asObservable();
  
  // Total stock tracking
  private totalStockSubject = new BehaviorSubject<number>(0);
  public totalStockCount$ = this.totalStockSubject.asObservable();
  
  // Negative stock filter state
  showOnlyNegativeStock = false;
  
  
  // Dropdown state
  isDropdownOpen = false;
  
  // Mobile menu state
  showMobileMenu = false;
  showMobileStats = false;
  
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
    private dialog: MatDialog,
    private router: Router
  ) {}

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  ngOnInit(): void {
    console.log('🔍 DEBUG: ngOnInit - Starting component initialization');
    
    // Load catalog first for material names mapping
    this.loadCatalogFromFirebase().then(() => {
      console.log('📚 ASM1 Catalog loaded, inventory ready for search');
    });
    this.loadPermissions();
    
    // Load inventory data and setup search after data is loaded
    this.loadInventoryAndSetupSearch();
    
    // Initialize negative stock count and total stock count
    this.updateNegativeStockCount();
    
    // 🆕 Load catalog once when component initializes
    this.loadCatalogOnce();
    
    // 🔍 DEBUG: Check outbound data on init
    this.debugOutboundDataOnInit();
    
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

  // Download inventory stock data from Firebase as Excel file
  async loadInventoryStockFromFirebase(): Promise<void> {
    console.log('📦 Downloading ASM1 inventory stock from Firebase as Excel...');
    this.isLoading = true;
    
    try {
      // Get all inventory materials from Firebase
      const snapshot = await this.firestore.collection('inventory-materials', ref => 
        ref.where('factory', '==', 'ASM1')
      ).get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        console.log('ℹ️ No inventory stock data found in Firebase');
        alert('Không tìm thấy dữ liệu tồn kho trong Firebase');
        this.isLoading = false;
        return;
      }
      
      console.log(`📊 Found ${snapshot.docs.length} inventory records in Firebase`);
      
      const inventoryData: any[] = [];
      
      snapshot.docs.forEach(doc => {
        const data = doc.data() as any;
        
        // Create Excel row with all Firebase fields
        const excelRow = {
          'STT': inventoryData.length + 1,
          'ID': doc.id,
          'Factory': data.factory || 'ASM1',
          'Mã hàng': data.materialCode || '',
          'Tên hàng': data.materialName || '',
          'PO': data.poNumber || '',
          'Import Date': data.importDate ? (data.importDate.toDate ? data.importDate.toDate().toLocaleDateString('en-GB').split('/').join('') : data.importDate) : '',
          'Received Date': data.receivedDate ? data.receivedDate.toDate().toLocaleDateString('vi-VN') : '',
          'Tồn đầu': data.openingStock || 0,
          'Số lượng': data.quantity || 0,
          'Đã xuất': data.exported || 0,
          'XT': data.xt || 0,
          'Tồn kho': (data.openingStock || 0) + (data.quantity || 0) - (data.exported || 0) - (data.xt || 0),
          'Đơn vị': data.unit || '',
          'Vị trí': data.location || '',
          'Loại hình': data.type || '',
          'Expiry Date': data.expiryDate ? data.expiryDate.toDate().toLocaleDateString('vi-VN') : '',
          'Quality Check': data.qualityCheck ? 'Yes' : 'No',
          'Is Received': data.isReceived ? 'Yes' : 'No',
          'Notes': data.notes || '',
          'Rolls/Bags': data.rollsOrBags || '',
          'Supplier': data.supplier || '',
          'Remarks': data.remarks || '',
          'Standard Packing': data.standardPacking || 0,
          'Is Completed': data.isCompleted ? 'Yes' : 'No',
          'Import Status': data.importStatus || '',
          'Source': data.source || '',
          'Updated At': data.updatedAt ? data.updatedAt.toDate().toLocaleString('vi-VN') : '',
          'Created At': data.createdAt ? data.createdAt.toDate().toLocaleString('vi-VN') : ''
        };
        
        inventoryData.push(excelRow);
      });
      
      // Create Excel file
      const worksheet = XLSX.utils.json_to_sheet(inventoryData);
      
      // Set column widths
      const columnWidths = [
        { wch: 5 },   // STT
        { wch: 20 },  // ID
        { wch: 8 },   // Factory
        { wch: 15 },  // Mã hàng
        { wch: 25 },  // Tên hàng
        { wch: 15 },  // PO
        { wch: 12 },  // Import Date
        { wch: 12 },  // Received Date
        { wch: 10 },  // Tồn đầu
        { wch: 10 },  // Số lượng
        { wch: 10 },  // Đã xuất
        { wch: 8 },   // XT
        { wch: 10 },  // Tồn kho
        { wch: 8 },   // Đơn vị
        { wch: 12 },  // Vị trí
        { wch: 12 },  // Loại hình
        { wch: 12 },  // Expiry Date
        { wch: 12 },  // Quality Check
        { wch: 12 },  // Is Received
        { wch: 20 },  // Notes
        { wch: 12 },  // Rolls/Bags
        { wch: 15 },  // Supplier
        { wch: 20 },  // Remarks
        { wch: 12 },  // Standard Packing
        { wch: 12 },  // Is Completed
        { wch: 12 },  // Import Status
        { wch: 10 },  // Source
        { wch: 18 },  // Updated At
        { wch: 18 }   // Created At
      ];
      worksheet['!cols'] = columnWidths;
      
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'ASM1_Inventory_Firebase');
      
      // Generate filename with current date
      const currentDate = new Date().toISOString().split('T')[0];
      const fileName = `ASM1_Inventory_Firebase_${currentDate}.xlsx`;
      
      XLSX.writeFile(workbook, fileName);
      
      console.log(`✅ Successfully exported ${inventoryData.length} inventory items to Excel`);
      alert(`✅ Đã tải thành công file Excel với ${inventoryData.length} mặt hàng tồn kho từ Firebase!\n\nFile: ${fileName}\nBao gồm tất cả thông tin đang lưu trên Firebase.`);
      
    } catch (error) {
      console.error('❌ Error downloading inventory stock from Firebase:', error);
      alert('❌ Lỗi khi tải file Excel từ Firebase. Vui lòng thử lại.');
    } finally {
      this.isLoading = false;
    }
  }

  // Load inventory data from Firebase - ONLY ASM1
  async loadInventoryFromFirebase(): Promise<void> {
    console.log('📦 Loading ASM1 inventory from Firebase...');
    this.isLoading = true;
    
    // 🚀 OPTIMIZATION: Add limit and orderBy for faster loading
    console.log('🔍 Setting up Firebase subscription for inventory-materials...');
    this.firestore.collection('inventory-materials', ref => 
      ref.where('factory', '==', this.FACTORY)
         .orderBy('importDate', 'desc')
         .limit(1000) // Limit to 1000 items for faster initial load
    )
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((actions) => {
        console.log(`🔍 Firebase subscription received ${actions.length} actions`);
        
        this.inventoryMaterials = actions
          .map(action => {
            const data = action.payload.doc.data() as any;
            const id = action.payload.doc.id;
            const material = {
              id: id,
              ...data,
              factory: this.FACTORY, // Force ASM1
              importDate: this.parseImportDate(data.importDate),
              receivedDate: data.receivedDate ? new Date(data.receivedDate.seconds * 1000) : new Date(),
              expiryDate: data.expiryDate ? new Date(data.expiryDate.seconds * 1000) : new Date(),
              openingStock: data.openingStock || null, // Initialize openingStock field - để trống nếu không có
              xt: data.xt || 0, // Initialize XT field for old materials
              source: data.source || 'manual', // Set default source for old materials
              iqcStatus: data.iqcStatus || undefined // Load IQC status from Firestore
            };
            
            // 🔍 DEBUG: Log batchNumber để kiểm tra sequence number
            if (data.batchNumber && (data.batchNumber.includes('01') || data.batchNumber.includes('02') || data.batchNumber.includes('03'))) {
              console.log(`🔍 DEBUG: Found material with sequence batchNumber:`, {
                materialCode: material.materialCode,
                poNumber: material.poNumber,
                batchNumber: data.batchNumber,
                source: data.source
              });
            }
            
            // Apply catalog data if available
            if (this.catalogLoaded && this.catalogCache.has(material.materialCode)) {
              const catalogItem = this.catalogCache.get(material.materialCode)!;
              material.materialName = catalogItem.materialName;
              material.unit = catalogItem.unit;
              
              // Tự động điền rollsOrBags từ Standard Packing nếu trống
              if (!material.rollsOrBags || material.rollsOrBags === '' || material.rollsOrBags === '0') {
                const standardPacking = catalogItem.standardPacking;
                if (standardPacking && standardPacking > 0) {
                  material.rollsOrBags = standardPacking.toString();
                  console.log(`🔄 Auto-filled rollsOrBags from Standard Packing: ${material.materialCode} = ${standardPacking}`);
                }
              }
            }
            
            return material;
          })
          .filter(material => material.factory === this.FACTORY); // Double check ASM1 only

        // Set filteredInventory to show all loaded items initially
        this.filteredInventory = [...this.inventoryMaterials];
        console.log(`🔍 DEBUG: Loaded ${this.inventoryMaterials.length} inventory materials`);
        console.log(`🔍 DEBUG: First material:`, this.inventoryMaterials[0]);
        
        // Gộp dòng trùng lặp TRƯỚC KHI xử lý outbound
        console.log('🔄 Consolidating duplicate materials...');
        
        // Kiểm tra xem có dòng trùng lặp không
        const materialPoMap = new Map<string, InventoryMaterial[]>();
        this.inventoryMaterials.forEach(material => {
          const key = `${material.materialCode}_${material.poNumber}`;
          if (!materialPoMap.has(key)) {
            materialPoMap.set(key, []);
          }
          materialPoMap.get(key)!.push(material);
        });
        
        const duplicateGroups = Array.from(materialPoMap.values()).filter(group => group.length > 1);
        
        if (duplicateGroups.length > 0) {
          console.log(`⚠️ Found ${duplicateGroups.length} duplicate groups, auto-consolidating...`);
          
          // Gộp dòng tự động khi load toàn bộ inventory
          this.autoConsolidateOnLoad().then(() => {
            // Tiếp tục xử lý sau khi gộp xong
            this.continueAfterConsolidation();
          });
        } else {
          console.log('✅ No duplicate groups found, proceeding with normal flow...');
          // Gộp dòng bình thường (chỉ local)
          this.consolidateInventoryData();
          
          // Tiếp tục xử lý
          this.continueAfterConsolidation();
        }
      }, error => {
        console.error('❌ Error loading ASM1 inventory:', error);
        console.error('❌ Error details:', error.message);
        this.isLoading = false;
      });
  }

  // Parse importDate from various formats
  private parseImportDate(importDate: any): Date {
    if (!importDate) {
      return new Date();
    }
    
    // If it's already a Date object
    if (importDate instanceof Date) {
      return importDate;
    }
    
    // If it's a Firestore Timestamp
    if (importDate.seconds) {
      return new Date(importDate.seconds * 1000);
    }
    
    // If it's a string in format "26082025" (DDMMYYYY)
    if (typeof importDate === 'string' && /^\d{8}$/.test(importDate)) {
      const day = importDate.substring(0, 2);
      const month = importDate.substring(2, 4);
      const year = importDate.substring(4, 8);
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }
    
    // If it's a string in format "DD/MM/YYYY" or "DD-MM-YYYY"
    if (typeof importDate === 'string' && (importDate.includes('/') || importDate.includes('-'))) {
      const parts = importDate.split(/[\/\-]/);
      if (parts.length === 3) {
        const day = parts[0];
        const month = parts[1];
        const year = parts[2];
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      }
    }
    
    // If it's a string that can be parsed as Date
    if (typeof importDate === 'string') {
      const parsed = new Date(importDate);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    
    // If it's a number (timestamp)
    if (typeof importDate === 'number') {
      return new Date(importDate);
    }
    
    // Fallback to current date
    console.warn('⚠️ Could not parse importDate:', importDate, 'using current date');
    return new Date();
  }

  // Load inventory and setup search mechanism
  private loadInventoryAndSetupSearch(): void {
    console.log('📦 Setting up search mechanism and loading inventory data...');
    
    // Setup search mechanism immediately
    console.log('🔍 Setting up search mechanism...');
    this.setupDebouncedSearch();
    console.log('✅ Search mechanism setup completed');
    
    // 🔧 FIX: Load inventory data immediately
    console.log('🔍 Loading inventory data...');
    this.loadInventoryFromFirebase();
  }

  // Debug function to check outbound data on init
  async debugOutboundDataOnInit(): Promise<void> {
    try {
      console.log('🔍 DEBUG: Checking outbound data on init...');
      
      const outboundSnapshot = await this.firestore.collection('outbound-materials')
        .ref
        .where('factory', '==', 'ASM1')
        .limit(5)
        .get();
      
      console.log(`🔍 DEBUG: Found ${outboundSnapshot.size} outbound records for ASM1`);
      
      if (!outboundSnapshot.empty) {
        console.log('📋 Outbound records found:');
        let index = 0;
        outboundSnapshot.forEach((doc) => {
          const data = doc.data() as any;
          console.log(`  ${index + 1}. Material: ${data.materialCode}, PO: ${data.poNumber}, Quantity: ${data.exportQuantity || data.quantity || 'N/A'}, Date: ${data.exportDate}`);
          index++;
        });
      } else {
        console.log('⚠️ No outbound records found for ASM1');
      }
      
    } catch (error) {
      console.error('❌ Error checking outbound data:', error);
    }
  }

  // Helper function to get display IMD (importDate + sequence if any)
  getDisplayIMD(material: InventoryMaterial): string {
    if (!material.importDate) return 'N/A';
    
    const baseDate = material.importDate.toLocaleDateString('en-GB').split('/').join('');
    
    // Kiểm tra nếu batchNumber có format đúng (chỉ chứa số và có độ dài hợp lý)
    if (material.batchNumber && material.batchNumber !== baseDate) {
      // Chỉ xử lý nếu batchNumber bắt đầu bằng baseDate và chỉ có thêm số sequence
      if (material.batchNumber.startsWith(baseDate)) {
        const suffix = material.batchNumber.substring(baseDate.length);
        // Chỉ chấp nhận suffix nếu nó chỉ chứa số và có độ dài <= 2
        if (/^\d{1,2}$/.test(suffix)) {
          return baseDate + suffix;
        }
      }
    }
    
    return baseDate;
  }

  // Debug function to find problematic batchNumbers
  async debugProblematicBatchNumbers(): Promise<void> {
    console.log('🔍 DEBUG: Checking for problematic batchNumbers...');
    
    try {
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', 'ASM1')
      ).get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        console.log('❌ No inventory materials found');
        return;
      }
      
      const problematicItems: any[] = [];
      
      snapshot.forEach(doc => {
        const data = doc.data() as any;
        const batchNumber = data.batchNumber;
        const importDate = data.importDate;
        
        if (batchNumber && importDate) {
          const expectedBaseDate = new Date(importDate.seconds * 1000).toLocaleDateString('en-GB').split('/').join('');
          
          // Kiểm tra nếu batchNumber có format không đúng
          if (!batchNumber.startsWith(expectedBaseDate) || 
              (batchNumber.length > expectedBaseDate.length && 
               !/^\d{1,2}$/.test(batchNumber.substring(expectedBaseDate.length)))) {
            problematicItems.push({
              id: doc.id,
              materialCode: data.materialCode,
              poNumber: data.poNumber,
              batchNumber: batchNumber,
              expectedBaseDate: expectedBaseDate,
              importDate: importDate
            });
          }
        }
      });
      
      console.log(`🔍 Found ${problematicItems.length} problematic batchNumbers:`, problematicItems);
      
      if (problematicItems.length > 0) {
        console.log('📋 Problematic items:');
        problematicItems.forEach((item, index) => {
          console.log(`  ${index + 1}. ${item.materialCode} - ${item.poNumber}`);
          console.log(`     Current: ${item.batchNumber}`);
          console.log(`     Expected: ${item.expectedBaseDate}`);
        });
      }
      
    } catch (error) {
      console.error('❌ Error checking problematic batchNumbers:', error);
    }
  }

  // Fix problematic batchNumbers in Firebase
  async fixProblematicBatchNumbers(): Promise<void> {
    console.log('🔧 Starting to fix problematic batchNumbers...');
    this.isLoading = true;
    
    try {
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', 'ASM1')
      ).get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        console.log('❌ No inventory materials found');
        return;
      }
      
      const batch = this.firestore.firestore.batch();
      let updateCount = 0;
      
      snapshot.forEach(doc => {
        const data = doc.data() as any;
        const batchNumber = data.batchNumber;
        const importDate = data.importDate;
        
        if (batchNumber && importDate) {
          const expectedBaseDate = new Date(importDate.seconds * 1000).toLocaleDateString('en-GB').split('/').join('');
          
          // Kiểm tra nếu batchNumber có format không đúng
          if (!batchNumber.startsWith(expectedBaseDate) || 
              (batchNumber.length > expectedBaseDate.length && 
               !/^\d{1,2}$/.test(batchNumber.substring(expectedBaseDate.length)))) {
            
            console.log(`🔧 Fixing ${data.materialCode} - ${data.poNumber}:`);
            console.log(`  Current: ${batchNumber}`);
            console.log(`  Fixed to: ${expectedBaseDate}`);
            
            // Cập nhật batchNumber về format đúng
            batch.update(doc.ref, {
              batchNumber: expectedBaseDate,
              updatedAt: new Date()
            });
            
            updateCount++;
          }
        }
      });
      
      if (updateCount > 0) {
        await batch.commit();
        console.log(`✅ Fixed ${updateCount} problematic batchNumbers`);
        alert(`✅ Đã sửa ${updateCount} batchNumber có format không đúng!`);
        
        // Refresh data
        this.loadInventoryFromFirebase();
      } else {
        console.log('ℹ️ No problematic batchNumbers found');
        alert('Không tìm thấy batchNumber nào cần sửa');
      }
      
    } catch (error) {
      console.error('❌ Error fixing batchNumbers:', error);
      alert('❌ Lỗi khi sửa batchNumbers. Vui lòng thử lại.');
    } finally {
      this.isLoading = false;
    }
  }

  // Debug function to check materials collection
  async debugMaterialsCollection(): Promise<void> {
    console.log('🔍 DEBUG: Checking materials collection...');
    
    try {
      const snapshot = await this.firestore.collection('materials').get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        console.log('❌ Collection "materials" is empty or does not exist');
        alert('❌ Collection "materials" is empty or does not exist');
        return;
      }
      
      console.log(`📊 Total documents in materials collection: ${snapshot.size}`);
      
      // Phân tích cấu trúc dữ liệu
      let withStandardPacking = 0;
      let withMaterialCode = 0;
      let withMaterialName = 0;
      const fieldCounts: { [key: string]: number } = {};
      
      snapshot.docs.forEach((doc, index) => {
        const data = doc.data() as any;
        
        // Đếm các field quan trọng
        if (data.standardPacking !== undefined && data.standardPacking !== null) {
          withStandardPacking++;
        }
        if (data.materialCode) {
          withMaterialCode++;
        }
        if (data.materialName) {
          withMaterialName++;
        }
        
        // Đếm tất cả fields
        Object.keys(data).forEach(field => {
          fieldCounts[field] = (fieldCounts[field] || 0) + 1;
        });
        
        // Log 3 documents đầu tiên để xem cấu trúc
        if (index < 3) {
          console.log(`📄 Document ${index + 1} (${doc.id}):`, data);
        }
      });
      
      console.log('📊 Field Analysis:');
      console.log(`  - Documents with standardPacking: ${withStandardPacking}`);
      console.log(`  - Documents with materialCode: ${withMaterialCode}`);
      console.log(`  - Documents with materialName: ${withMaterialName}`);
      
      console.log('📊 All fields and their frequency:');
      Object.entries(fieldCounts)
        .sort(([,a], [,b]) => b - a)
        .forEach(([field, count]) => {
          console.log(`  - ${field}: ${count} documents`);
        });
      
      alert(`🔍 MATERIALS COLLECTION DEBUG:\n\n` +
            `📊 Total documents: ${snapshot.size}\n` +
            `📦 With standardPacking: ${withStandardPacking}\n` +
            `🏷️ With materialCode: ${withMaterialCode}\n` +
            `📝 With materialName: ${withMaterialName}\n\n` +
            `💡 Check console (F12) for detailed field analysis`);
      
    } catch (error) {
      console.error('❌ Error checking materials collection:', error);
      alert('❌ Error checking materials collection: ' + error.message);
    }
  }

  // Xóa các mã không có standardPacking
  async deleteMaterialsWithoutStandardPacking(): Promise<void> {
    console.log('🗑️ Starting deletion of materials without standardPacking...');
    
    const confirmMessage = `⚠️ XÓA CÁC MÃ KHÔNG CÓ STANDARDPACKING\n\n` +
      `📊 Tổng documents: 8,750\n` +
      `📦 Có standardPacking: 5,792 (66%)\n` +
      `❌ Không có standardPacking: 3,958 (34%)\n\n` +
      `⚠️ Bạn có chắc chắn muốn XÓA 3,958 documents không có standardPacking?\n` +
      `⚠️ Hành động này KHÔNG THỂ HOÀN TÁC!`;
    
    if (!confirm(confirmMessage)) {
      console.log('❌ User cancelled deletion');
      return;
    }
    
    try {
      console.log('🔍 Loading materials collection...');
      const snapshot = await this.firestore.collection('materials').get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        console.log('❌ No materials found');
        alert('❌ Không tìm thấy materials nào');
        return;
      }
      
      console.log(`📊 Total materials to check: ${snapshot.size}`);
      
      // Tìm các documents không có standardPacking
      const documentsToDelete: any[] = [];
      let processedCount = 0;
      
      snapshot.docs.forEach(doc => {
        const data = doc.data() as any;
        processedCount++;
        
        // Kiểm tra không có standardPacking hoặc standardPacking = null/undefined
        if (data.standardPacking === undefined || data.standardPacking === null) {
          documentsToDelete.push({
            id: doc.id,
            materialCode: data.materialCode || 'Unknown',
            materialName: data.materialName || 'Unknown'
          });
        }
        
        // Log progress mỗi 1000 documents
        if (processedCount % 1000 === 0) {
          console.log(`📊 Processed ${processedCount}/${snapshot.size} documents, found ${documentsToDelete.length} to delete`);
        }
      });
      
      console.log(`📊 Analysis complete:`);
      console.log(`  - Total processed: ${processedCount}`);
      console.log(`  - Documents to delete: ${documentsToDelete.length}`);
      console.log(`  - Documents to keep: ${processedCount - documentsToDelete.length}`);
      
      if (documentsToDelete.length === 0) {
        alert('✅ Tất cả materials đều có standardPacking! Không cần xóa gì.');
        return;
      }
      
      // Xác nhận lần 2 với số liệu cụ thể
      const finalConfirm = `⚠️ XÁC NHẬN CUỐI CÙNG\n\n` +
        `📊 Sẽ xóa: ${documentsToDelete.length} documents\n` +
        `📊 Sẽ giữ lại: ${processedCount - documentsToDelete.length} documents\n\n` +
        `⚠️ Hành động này KHÔNG THỂ HOÀN TÁC!\n` +
        `⚠️ Bạn có chắc chắn muốn tiếp tục?`;
      
      if (!confirm(finalConfirm)) {
        console.log('❌ User cancelled final confirmation');
        return;
      }
      
      // Bắt đầu xóa theo batch (Firebase limit: 500 operations per batch)
      const batchSize = 500;
      let deletedCount = 0;
      const totalBatches = Math.ceil(documentsToDelete.length / batchSize);
      
      console.log(`🗑️ Starting deletion in ${totalBatches} batches...`);
      
      for (let i = 0; i < documentsToDelete.length; i += batchSize) {
        const batch = this.firestore.firestore.batch();
        const currentBatch = documentsToDelete.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        
        console.log(`🗑️ Processing batch ${batchNumber}/${totalBatches} (${currentBatch.length} documents)...`);
        
        currentBatch.forEach(docToDelete => {
          const docRef = this.firestore.collection('materials').doc(docToDelete.id).ref;
          batch.delete(docRef);
        });
        
        await batch.commit();
        deletedCount += currentBatch.length;
        
        console.log(`✅ Batch ${batchNumber} completed. Deleted: ${deletedCount}/${documentsToDelete.length}`);
        
        // Hiển thị progress
        const progress = Math.round((deletedCount / documentsToDelete.length) * 100);
        console.log(`📊 Progress: ${progress}% (${deletedCount}/${documentsToDelete.length})`);
      }
      
      console.log(`✅ Deletion completed! Deleted ${deletedCount} documents`);
      
      alert(`✅ XÓA THÀNH CÔNG!\n\n` +
            `🗑️ Đã xóa: ${deletedCount} documents\n` +
            `📊 Còn lại: ${processedCount - deletedCount} documents\n` +
            `📦 Tất cả materials còn lại đều có standardPacking\n\n` +
            `💡 Collection materials đã được làm sạch!`);
      
    } catch (error) {
      console.error('❌ Error deleting materials without standardPacking:', error);
      alert('❌ Lỗi khi xóa materials: ' + error.message);
    }
  }

  // Load catalog from Firebase
  private async loadCatalogFromFirebase(): Promise<void> {
    this.isCatalogLoading = true;
    console.log('📋 Loading catalog from Firebase...');
    
    // 🚀 OPTIMIZATION: Check cache first
    if (this.catalogCache.size > 0) {
      console.log('📚 Using cached catalog data');
      this.isCatalogLoading = false;
      this.catalogLoaded = true;
      return;
    }
    
    try {
      // THỬ NHIỀU COLLECTION NAMES - KIỂM TRA THỰC TẾ SỐ LƯỢNG DOCUMENTS
      let snapshot = null;
      let collectionName = '';
      
      // Thử collection 'materials' trước - KIỂM TRA THỰC TẾ
      try {
        console.log('🔍 Trying collection: materials - checking actual document count...');
        snapshot = await this.firestore.collection('materials').get().toPromise();
        if (snapshot && !snapshot.empty) {
          collectionName = 'materials';
          console.log('✅ Found catalog data in collection: materials');
          console.log(`📊 ACTUAL Catalog snapshot size: ${snapshot.size} documents`);
          
          // Kiểm tra thêm: đếm documents có standardPacking field
          let withStandardPacking = 0;
          snapshot.docs.forEach(doc => {
            const data = doc.data() as any;
            if (data.standardPacking !== undefined && data.standardPacking !== null) {
              withStandardPacking++;
            }
          });
          console.log(`📊 Documents WITH standardPacking field: ${withStandardPacking}`);
          console.log(`📊 Documents WITHOUT standardPacking field: ${snapshot.size - withStandardPacking}`);
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
    
    // Update pagination and displayed inventory
    this.updatePagination();
    this.updateDisplayedInventory();
    
    console.log('🔍 ASM1 filters applied. Items found:', this.filteredInventory.length);
  }

  // Update pagination
  updatePagination(): void {
    this.totalPages = Math.ceil(this.filteredInventory.length / this.itemsPerPage);
    if (this.currentPage > this.totalPages && this.totalPages > 0) {
      this.currentPage = 1;
    }
  }

  // Update displayed inventory based on current page
  updateDisplayedInventory(): void {
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    this.displayedInventory = this.filteredInventory.slice(startIndex, endIndex);
  }

  // Go to specific page
  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.updateDisplayedInventory();
    }
  }

  // Next page
  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.updateDisplayedInventory();
    }
  }

  // Previous page
  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.updateDisplayedInventory();
    }
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
    
    // Chỉ search khi có ít nhất 3 ký tự để tránh mất thời gian (trừ location search)
    if (this.searchType !== 'location' && searchTerm.length < 3) {
      this.filteredInventory = [];
      console.log(`⏰ ASM1 Search term "${searchTerm}" quá ngắn (cần ít nhất 3 ký tự)`);
      return;
    }
    
    // Location search: cho phép từ 1 ký tự trở lên
    if (this.searchType === 'location' && searchTerm.length < 1) {
      this.filteredInventory = [];
      return;
    }
    
    this.searchTerm = searchTerm;
    this.isLoading = true;
    this.isSearching = true;
    this.searchProgress = 0;
    
    try {
      console.log(`🔍 ASM1 Searching for: "${searchTerm}" (type: ${this.searchType}) - Loading from Firebase...`);
      
      // IMPROVED: Query Firebase với nhiều điều kiện hơn để tìm kiếm toàn diện
      let querySnapshot;
      
      // Tìm kiếm theo searchType
      if (this.searchType === 'location') {
        // Tìm kiếm theo location
        this.searchProgress = 25;
        const normalizedLocation = searchTerm.trim().toUpperCase();
        console.log(`🔍 ASM1 Searching by location: "${normalizedLocation}"...`);
        
        // Thử exact match trước (chính xác nhất)
        querySnapshot = await this.firestore.collection('inventory-materials', ref => 
          ref.where('factory', '==', this.FACTORY)
             .where('location', '==', normalizedLocation)
             .limit(200)
        ).get().toPromise();
        
        // Nếu không tìm thấy với exact match, thử pattern matching
        if (!querySnapshot || querySnapshot.empty) {
          console.log(`🔍 ASM1 No exact match for location "${normalizedLocation}", trying pattern search...`);
          this.searchProgress = 50;
          
          querySnapshot = await this.firestore.collection('inventory-materials', ref => 
            ref.where('factory', '==', this.FACTORY)
               .where('location', '>=', normalizedLocation)
               .where('location', '<=', normalizedLocation + '\uf8ff')
               .limit(200)
          ).get().toPromise();
        }
      } else if (this.searchType === 'po') {
        // Tìm kiếm theo PO number
        this.searchProgress = 25;
        console.log(`🔍 ASM1 Searching by PO: "${searchTerm}"...`);
        
        querySnapshot = await this.firestore.collection('inventory-materials', ref => 
          ref.where('factory', '==', this.FACTORY)
             .where('poNumber', '>=', searchTerm)
             .where('poNumber', '<=', searchTerm + '\uf8ff')
             .limit(100)
        ).get().toPromise();
        
        // Nếu không tìm thấy, thử exact match
        if (!querySnapshot || querySnapshot.empty) {
          console.log(`🔍 ASM1 No pattern match for PO "${searchTerm}", trying exact match...`);
          this.searchProgress = 50;
          
          querySnapshot = await this.firestore.collection('inventory-materials', ref => 
            ref.where('factory', '==', this.FACTORY)
               .where('poNumber', '==', searchTerm)
               .limit(100)
          ).get().toPromise();
        }
      } else {
        // Tìm kiếm theo materialCode (default)
        // Thử tìm kiếm theo materialCode trước (chính xác nhất) - ASM1 only
        this.searchProgress = 25;
        querySnapshot = await this.firestore.collection('inventory-materials', ref => 
          ref.where('factory', '==', this.FACTORY)
             .where('materialCode', '==', searchTerm)
             .limit(50)
        ).get().toPromise();
        
        // Nếu không tìm thấy, tìm kiếm theo pattern matching
        if (!querySnapshot || querySnapshot.empty) {
          console.log(`🔍 ASM1 No exact match for "${searchTerm}", trying pattern search...`);
          this.searchProgress = 50;
          
          querySnapshot = await this.firestore.collection('inventory-materials', ref => 
            ref.where('factory', '==', this.FACTORY)
               .where('materialCode', '>=', searchTerm)
               .where('materialCode', '<=', searchTerm + '\uf8ff')
               .limit(100)
          ).get().toPromise();
        }
        
        // Nếu vẫn không tìm thấy, tìm kiếm theo PO number (fallback)
        if (!querySnapshot || querySnapshot.empty) {
          console.log(`🔍 ASM1 No pattern match for "${searchTerm}", trying PO search...`);
          this.searchProgress = 75;
          
          querySnapshot = await this.firestore.collection('inventory-materials', ref => 
            ref.where('factory', '==', this.FACTORY)
               .where('poNumber', '>=', searchTerm)
               .where('poNumber', '<=', searchTerm + '\uf8ff')
               .limit(100)
          ).get().toPromise();
        }
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
            openingStock: data.openingStock || null, // Initialize openingStock field - để trống nếu không có
            xt: data.xt || 0, // Initialize XT field for search results
            source: data.source || 'manual' // Set default source for old materials
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
        
        // KHÔNG gộp dòng khi search - chỉ gộp khi bấm nút "Gộp dòng trùng lặp"
        // this.consolidateInventoryData();
        
        // Sắp xếp FIFO: Material Code -> PO (oldest first)
        this.sortInventoryFIFO();
        
        // Reset to page 1 and update pagination
        this.currentPage = 1;
        this.updatePagination();
        this.updateDisplayedInventory();
        
        // 🔧 SIMPLIFIED: Exported quantities loaded directly from Firebase (no auto-update needed)
        console.log('✅ Search results exported quantities loaded directly from Firebase');
        
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
      this.isSearching = false;
      this.searchProgress = 100;
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
    // Không hiển thị IQC status trong cột Trạng thái nữa
    if (item.isCompleted) return 'status-completed';
    if (item.isDuplicate) return 'status-duplicate';
    if (item.importStatus === 'Import') return 'status-import';
    return 'status-active';
  }

  getStatusText(item: InventoryMaterial): string {
    // Không hiển thị IQC status trong cột Trạng thái nữa
    if (item.isCompleted) return 'Hoàn thành';
    if (item.isDuplicate) return 'Trùng lặp';
    if (item.importStatus === 'Import') return 'Import';
    return 'Hoạt động';
  }

  // Hàm riêng cho IQC Status
  getIQCStatusClass(item: InventoryMaterial): string {
    if (!item.iqcStatus) return '';
    
    switch (item.iqcStatus) {
      case 'PASS':
        return 'status-iqc-pass';
      case 'NG':
        return 'status-iqc-ng';
      case 'ĐẶC CÁCH':
        return 'status-iqc-special';
      case 'CHỜ XÁC NHẬN':
        return 'status-iqc-pending';
      default:
        return 'status-iqc-default';
    }
  }

  getIQCStatusText(item: InventoryMaterial): string {
    return item.iqcStatus || '-';
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

  // Convert old location format to new format
  // TR12 -> T1.2(R), TR11 -> T1.1(R), etc.
  convertLocationFormat(location: string): string {
    if (!location) return location;
    
    const loc = location.trim().toUpperCase();
    
    // Pattern matching for old format: [Letter][Letter][Number]
    const oldFormatPattern = /^([A-Z])([A-Z])(\d+)$/;
    const match = loc.match(oldFormatPattern);
    
    if (match) {
      const [, firstLetter, secondLetter, number] = match;
      
      // Convert based on the pattern
      if (secondLetter === 'R') {
        // TR12 -> T1.2(R)
        const rowLetter = firstLetter;
        const numStr = number.toString();
        if (numStr.length >= 2) {
          const firstDigit = numStr[0];
          const remainingDigits = numStr.substring(1);
          return `${rowLetter}${firstDigit}.${remainingDigits}(R)`;
        } else {
          return `${rowLetter}${number}(R)`;
        }
      } else if (secondLetter === 'L') {
        // TL12 -> T1.2(L)
        const rowLetter = firstLetter;
        const numStr = number.toString();
        if (numStr.length >= 2) {
          const firstDigit = numStr[0];
          const remainingDigits = numStr.substring(1);
          return `${rowLetter}${firstDigit}.${remainingDigits}(L)`;
        } else {
          return `${rowLetter}${number}(L)`;
        }
      }
    }
    
    // Special cases for Q and A12
    if (loc === 'Q1') return 'Q1(L)';
    if (loc === 'Q2') return 'Q2(L)';
    if (loc === 'Q3') return 'Q3(L)';
    if (loc === 'A12') return 'NVL-A12';
    
    // If no pattern matches, return original
    return location;
  }

  // Update all locations in inventory to new format
  async updateAllLocationsToNewFormat(): Promise<void> {
    if (!confirm('Bạn có chắc muốn cập nhật tất cả vị trí sang format mới?\n\nVí dụ: TR12 -> T1.2(R), TL12 -> T1.2(L)\n\nHành động này không thể hoàn tác!')) {
      return;
    }

    try {
      this.isLoading = true;
      console.log('🔄 Bắt đầu cập nhật vị trí sang format mới...');

      // Get all inventory materials
      const snapshot = await this.firestore.collection('inventory-materials', ref => 
        ref.where('factory', '==', 'ASM1')
      ).get().toPromise();

      if (!snapshot || snapshot.empty) {
        alert('Không tìm thấy dữ liệu inventory để cập nhật');
        return;
      }

      const batch = this.firestore.firestore.batch();
      let updateCount = 0;

      snapshot.docs.forEach(doc => {
        const data = doc.data() as any;
        const oldLocation = data.location;
        const newLocation = this.convertLocationFormat(oldLocation);

        if (oldLocation !== newLocation) {
          console.log(`📍 Cập nhật: ${oldLocation} -> ${newLocation}`);
          batch.update(doc.ref, { 
            location: newLocation,
            updatedAt: new Date()
          });
          updateCount++;
        }
      });

      if (updateCount > 0) {
        await batch.commit();
        console.log(`✅ Đã cập nhật ${updateCount} vị trí sang format mới`);
        alert(`✅ Đã cập nhật thành công ${updateCount} vị trí sang format mới!\n\nVí dụ: TR12 -> T1.2(R), TL12 -> T1.2(L)`);
        
        // Refresh data
        this.loadInventoryFromFirebase();
      } else {
        console.log('ℹ️ Không có vị trí nào cần cập nhật');
        alert('Không có vị trí nào cần cập nhật sang format mới');
      }

    } catch (error) {
      console.error('❌ Lỗi khi cập nhật vị trí:', error);
      alert('❌ Lỗi khi cập nhật vị trí. Vui lòng thử lại.');
    } finally {
      this.isLoading = false;
    }
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

  // Consolidate inventory data by material code + PO (gộp tất cả dòng có cùng mã hàng và PO)
  consolidateInventoryData(): void {
    try {
      console.log('🔄 Starting inventory data consolidation by Material + PO...');
      
      if (!this.inventoryMaterials || this.inventoryMaterials.length === 0) {
        console.log('⚠️ No inventory materials to consolidate');
        return;
      }
      
      console.log(`📊 Input: ${this.inventoryMaterials.length} materials to process`);
    
    // Group materials by Material + PO + Batch
    const materialPoMap = new Map<string, InventoryMaterial[]>();
    
    this.inventoryMaterials.forEach(material => {
      // Chỉ gộp dòng không phải từ inbound (source !== 'inbound')
      if (material.source === 'inbound') {
        console.log(`⏭️ Skipping inbound material in consolidation: ${material.materialCode} - ${material.poNumber}`);
        return;
      }
      
      const key = `${material.materialCode}_${material.poNumber}_${material.batchNumber || 'NO_BATCH'}`;
      
      if (!materialPoMap.has(key)) {
        materialPoMap.set(key, []);
      }
      materialPoMap.get(key)!.push(material);
    });
    
    console.log(`📊 Found ${materialPoMap.size} unique Material+PO+Batch combinations from ${this.inventoryMaterials.length} total items`);
    
    // Final consolidation map
    const finalConsolidatedMap = new Map<string, InventoryMaterial>();
    
    materialPoMap.forEach((materials, materialPoKey) => {
      if (materials.length === 1) {
        // Single item - keep as is
        const material = materials[0];
        finalConsolidatedMap.set(materialPoKey, material);
        console.log(`✅ Single item: ${material.materialCode} - PO ${material.poNumber} - Batch: ${material.batchNumber || 'NO_BATCH'} - Location: ${material.location}`);
      } else {
        // Multiple items - merge into one row
        console.log(`🔄 Consolidating ${materials.length} items for ${materialPoKey}`);
        
        const baseMaterial = { ...materials[0] };
        
        // Combine quantities
        const totalOpeningStock = materials.reduce((sum, m) => {
          const stock = m.openingStock !== null ? m.openingStock : 0;
          return sum + stock;
        }, 0);
        baseMaterial.openingStock = totalOpeningStock > 0 ? totalOpeningStock : null;
        baseMaterial.quantity = materials.reduce((sum, m) => sum + m.quantity, 0);
        baseMaterial.stock = materials.reduce((sum, m) => sum + (m.stock || 0), 0);
        baseMaterial.exported = materials.reduce((sum, m) => sum + (m.exported || 0), 0);
        baseMaterial.xt = materials.reduce((sum, m) => sum + (m.xt || 0), 0);
        
        // Combine location field - gộp tất cả vị trí khác nhau
        const uniqueLocations = [...new Set(materials.map(m => m.location).filter(loc => loc))];
        baseMaterial.location = uniqueLocations.join('; ');
        
        // Combine type field - gộp tất cả loại hình khác nhau
        const uniqueTypes = [...new Set(materials.map(m => m.type).filter(type => type))];
        baseMaterial.type = uniqueTypes.join('; ');
        
        // Keep earliest import date and latest expiry date
        baseMaterial.importDate = new Date(Math.min(...materials.map(m => m.importDate.getTime())));
        baseMaterial.expiryDate = new Date(Math.max(...materials.map(m => m.expiryDate.getTime())));
        
        // Merge other fields
        baseMaterial.notes = materials.map(m => m.notes).filter(n => n).join('; ');
        baseMaterial.remarks = materials.map(m => m.remarks).filter(r => r).join('; ');
        baseMaterial.supplier = materials.map(m => m.supplier).filter(s => s).join('; ');
        baseMaterial.rollsOrBags = materials.map(m => m.rollsOrBags).filter(r => r).join('; ');
        
        finalConsolidatedMap.set(materialPoKey, baseMaterial);
        
        console.log(`✅ Consolidated: ${baseMaterial.materialCode} - PO: ${baseMaterial.poNumber} - Batch: ${baseMaterial.batchNumber || 'NO_BATCH'}`);
        console.log(`  📍 Location: ${baseMaterial.location} (from first row)`);
        console.log(`  🏷️ Type: ${baseMaterial.type} (from first row)`);
        console.log(`  📦 Total Quantity: ${baseMaterial.quantity}`);
        console.log(`  📤 Total Exported: ${baseMaterial.exported}`);
      }
    });
    
    // Add inbound materials back to the final list (they were skipped during consolidation)
    const inboundMaterials = this.inventoryMaterials.filter(material => material.source === 'inbound');
    console.log(`📦 Adding ${inboundMaterials.length} inbound materials back to the list`);
    
    // Update the inventory data
    const originalCount = this.inventoryMaterials.length;
    this.inventoryMaterials = [...Array.from(finalConsolidatedMap.values()), ...inboundMaterials];
    this.filteredInventory = [...this.inventoryMaterials];
    
    // Sắp xếp FIFO sau khi gộp dữ liệu
    this.sortInventoryFIFO();
    
    console.log(`✅ Inventory consolidation completed: ${originalCount} → ${this.inventoryMaterials.length} items`);
    
    // Show consolidation message
    const reducedCount = originalCount - this.inventoryMaterials.length;
    if (reducedCount > 0) {
      this.consolidationMessage = `✅ Đã gộp ${reducedCount} dòng dữ liệu trùng lặp theo Material+PO. Từ ${originalCount} → ${this.inventoryMaterials.length} dòng.`;
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
    
    } catch (error) {
      console.error('❌ Error during consolidation:', error);
    }
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
        
        
        // Lưu ý: Cột "Đã xuất" chỉ có thể chỉnh sửa khi user có quyền Xóa và đã mở khóa
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
          await this.loadInventoryFromFirebase();
          
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

  // Toggle mobile menu
  toggleMobileMenu(): void {
    this.showMobileMenu = !this.showMobileMenu;
    console.log('📱 Mobile menu toggled:', this.showMobileMenu);
  }

  toggleMobileStats(): void {
    this.showMobileStats = !this.showMobileStats;
    console.log('📊 Mobile stats toggled:', this.showMobileStats);
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

  // Tải Standard Packing từ Firebase và xuất Excel
  async loadStandardPacking(): Promise<void> {
    try {
      console.log('📥 Loading Standard Packing from Firebase and exporting to Excel...');
      
      // Hiển thị loading state
      this.isCatalogLoading = true;
      
      // Tải dữ liệu từ collection materials
      const snapshot = await this.firestore.collection('materials').get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        alert('❌ Không tìm thấy dữ liệu Standard Packing trong Firebase!');
        return;
      }
      
      console.log(`📊 Found ${snapshot.size} materials with Standard Packing data`);
      
      // Chuẩn bị dữ liệu cho Excel
      const excelData: any[] = [];
      let withStandardPacking = 0;
      let totalMaterials = 0;
      
      snapshot.docs.forEach(doc => {
        const data = doc.data() as any;
        totalMaterials++;
        
        // Thêm vào dữ liệu Excel
        excelData.push({
          'Material Code': data.materialCode || '',
          'Material Name': data.materialName || '',
          'Unit': data.unit || '',
          'Standard Packing': data.standardPacking || 0,
          'Supplier': data.supplier || '',
          'Description': data.description || ''
        });
        
        if (data.standardPacking !== undefined && data.standardPacking !== null && data.standardPacking > 0) {
          withStandardPacking++;
        }
      });
      
      // Tạo workbook và worksheet
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(excelData);
      
      // Thiết lập độ rộng cột
      const columnWidths = [
        { wch: 15 }, // Material Code
        { wch: 30 }, // Material Name
        { wch: 10 }, // Unit
        { wch: 18 }, // Standard Packing
        { wch: 20 }, // Supplier
        { wch: 25 }  // Description
      ];
      worksheet['!cols'] = columnWidths;
      
      // Thêm worksheet vào workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Standard Packing');
      
      // Tạo tên file với timestamp
      const now = new Date();
      const timestamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
      const fileName = `Standard_Packing_ASM1_${timestamp}.xlsx`;
      
      // Xuất file Excel
      XLSX.writeFile(workbook, fileName);
      
      // Cập nhật cache
      await this.loadCatalogFromFirebase();
      
      alert(`✅ Tải Standard Packing thành công!\n\n` +
            `📊 Tổng materials: ${totalMaterials}\n` +
            `📦 Có Standard Packing: ${withStandardPacking}\n` +
            `📈 Tỷ lệ: ${((withStandardPacking / totalMaterials) * 100).toFixed(1)}%\n\n` +
            `📁 File Excel đã được tải về: ${fileName}`);
      
    } catch (error) {
      console.error('❌ Error loading Standard Packing:', error);
      alert('❌ Lỗi khi tải Standard Packing: ' + error.message);
    } finally {
      this.isCatalogLoading = false;
    }
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
    
    // Nếu rollsOrBags trống, tự động lấy từ Standard Packing
    if (!material.rollsOrBags || material.rollsOrBags === '' || material.rollsOrBags === '0') {
      const standardPacking = this.getStandardPacking(material.materialCode);
      if (standardPacking && standardPacking > 0) {
        material.rollsOrBags = standardPacking.toString();
        console.log(`🔄 Auto-filled rollsOrBags from Standard Packing: ${material.materialCode} = ${standardPacking}`);
      }
    }
    
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
    
    // Nếu location là F62 hoặc F62TRA, tự động set iqcStatus = 'Pass'
    if ((material.location === 'F62' || material.location === 'F62TRA') && material.iqcStatus !== 'Pass') {
      material.iqcStatus = 'Pass';
      console.log(`✅ Auto-set IQC status to Pass for ${material.materialCode} (location: ${material.location})`);
    }
    
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
    
    console.log(`💾 Saving to Firebase: ${material.materialCode} - Exported: ${material.exported || 0} - XT: ${material.xt || 0}`);
    console.log(`🔍 DEBUG: Full material object:`, material);
    
    // Prepare update data, only include defined values
    // Note: exported field is included when user manually updates it
    const updateData: any = {
      exported: material.exported || 0, // Đảm bảo exported luôn có giá trị
      updatedAt: material.updatedAt
    };
    
    // Chỉ thêm các field có giá trị
    if (material.openingStock !== undefined && material.openingStock !== null) {
      updateData.openingStock = material.openingStock;
    }
    
    if (material.xt !== undefined && material.xt !== null) {
      updateData.xt = material.xt;
    }
    
    if (material.location) {
      updateData.location = material.location;
    }
    
    // Nếu location là F62 hoặc F62TRA, tự động set iqcStatus = 'Pass'
    if ((material.location === 'F62' || material.location === 'F62TRA') && material.iqcStatus !== 'Pass') {
      material.iqcStatus = 'Pass';
      updateData.iqcStatus = 'Pass';
      console.log(`✅ Auto-set IQC status to Pass for ${material.materialCode} (location: ${material.location})`);
    } else if (material.iqcStatus) {
      // Nếu có iqcStatus, cập nhật vào Firebase
      updateData.iqcStatus = material.iqcStatus;
    }
    
    if (material.type) {
      updateData.type = material.type;
    }
    
    if (material.rollsOrBags !== undefined && material.rollsOrBags !== null) {
      updateData.rollsOrBags = material.rollsOrBags;
    }
    
    if (material.remarks) {
      updateData.remarks = material.remarks;
    }
    
    if (material.expiryDate) {
      updateData.expiryDate = material.expiryDate;
    }
    
    if (material.importDate) {
      updateData.importDate = material.importDate;
    }
    
    if (material.batchNumber) {
      updateData.batchNumber = material.batchNumber;
    }
    
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

  // 🔧 LOGIC FIFO MỚI: Lấy số lượng xuất từ Outbound theo FIFO (Material + PO + Batch)
  // - Sử dụng logic FIFO để phân bổ số lượng xuất cho từng dòng inventory
  // - Đảm bảo dòng có FIFO thấp nhất được trừ trước
  // - Tránh tồn kho âm ở các dòng sau
  // - QUAN TRỌNG: Phải match theo Material + PO + Batch để tránh nhận sai dữ liệu
  async getExportedQuantityFromOutboundFIFO(materialCode: string, poNumber: string, batch?: string): Promise<{ totalExported: number; outboundRecords: any[] }> {
    try {
      console.log(`🔍 Getting exported quantity with FIFO logic for ${materialCode} - PO: ${poNumber} - Batch: ${batch || 'N/A'}`);
      
      const outboundRef = this.firestore.collection('outbound-materials');
      
      // QUAN TRỌNG: Query theo Material + PO + Batch để tránh nhận sai dữ liệu
      let snapshot;
      try {
        if (batch) {
          // Nếu có batch, query theo Material + PO + Batch
          console.log(`🔍 Querying with batch: ${materialCode} - PO: ${poNumber} - Batch: ${batch}`);
          
          // Thử query với field 'importDate' trước (vì outbound data sử dụng importDate)
          try {
            console.log(`🔍 Trying query with 'importDate' field...`);
            snapshot = await outboundRef
              .ref
              .where('factory', '==', 'ASM1')
              .where('materialCode', '==', materialCode)
              .where('poNumber', '==', poNumber)
              .where('importDate', '==', batch)
              .orderBy('exportDate', 'asc')
              .get();
            console.log(`✅ Query with 'importDate' field successful, found ${snapshot.size} records`);
          } catch (importDateError) {
            console.log(`⚠️ Query with 'importDate' field failed, trying with 'batch':`, importDateError);
            // Fallback: thử với field 'batch'
            try {
              snapshot = await outboundRef
                .ref
                .where('factory', '==', 'ASM1')
                .where('materialCode', '==', materialCode)
                .where('poNumber', '==', poNumber)
                .where('batch', '==', batch)
                .orderBy('exportDate', 'asc')
                .get();
              console.log(`✅ Query with 'batch' field successful, found ${snapshot.size} records`);
            } catch (batchError) {
              console.log(`⚠️ Query with 'batch' field failed, trying with 'batchNumber':`, batchError);
              // Fallback: thử với field 'batchNumber'
              snapshot = await outboundRef
                .ref
                .where('factory', '==', 'ASM1')
                .where('materialCode', '==', materialCode)
                .where('poNumber', '==', poNumber)
                .where('batchNumber', '==', batch)
                .orderBy('exportDate', 'asc')
                .get();
              console.log(`✅ Query with 'batchNumber' field successful, found ${snapshot.size} records`);
            }
          }
        } else {
          // Nếu không có batch, query theo Material + PO (fallback)
          console.log(`⚠️ No batch provided, querying without batch: ${materialCode} - PO: ${poNumber}`);
          snapshot = await outboundRef
            .ref
            .where('factory', '==', 'ASM1')
            .where('materialCode', '==', materialCode)
            .where('poNumber', '==', poNumber)
            .orderBy('exportDate', 'asc')
            .get();
          console.log(`✅ Query without batch successful, found ${snapshot.size} records`);
        }
              } catch (orderByError) {
          console.log(`⚠️ OrderBy exportDate failed, trying without orderBy:`, orderByError);
          // Fallback: tìm không có orderBy
          if (batch) {
            // Thử query với field 'batch' trước
            try {
              snapshot = await outboundRef
                .ref
                .where('factory', '==', 'ASM1')
                .where('materialCode', '==', materialCode)
                .where('poNumber', '==', poNumber)
                .where('batch', '==', batch)
                .get();
            } catch (batchError) {
              console.log(`⚠️ Query with 'batch' field failed, trying with 'batchNumber':`, batchError);
              // Fallback: thử với field 'batchNumber'
              snapshot = await outboundRef
                .ref
                .where('factory', '==', 'ASM1')
                .where('materialCode', '==', materialCode)
                .where('poNumber', '==', poNumber)
                .where('batchNumber', '==', batch)
                .get();
            }
          } else {
            snapshot = await outboundRef
              .ref
              .where('factory', '==', 'ASM1')
              .where('materialCode', '==', materialCode)
              .where('poNumber', '==', poNumber)
              .get();
          }
        }

      console.log(`🔍 Query result: ${snapshot.size} records found`);
      
      if (!snapshot.empty) {
        let totalExported = 0;
        const outboundRecords: any[] = [];
        
        console.log(`📋 Processing ${snapshot.size} outbound records:`);
        snapshot.forEach((doc, index) => {
          const data = doc.data() as any;
          console.log(`  Record ${index + 1}:`, {
            materialCode: data.materialCode,
            poNumber: data.poNumber,
            batch: data.batch || data.batchNumber || 'N/A',
            exportQuantity: data.exportQuantity,
            exported: data.exported,
            quantity: data.quantity,
            exportDate: data.exportDate
          });
          
          // Thử nhiều field names khác nhau để tìm số lượng xuất
          let exportQuantity = 0;
          
          // Kiểm tra từng field name có thể có
          if (data.exportQuantity !== undefined && data.exportQuantity !== null) {
            exportQuantity = data.exportQuantity;
            console.log(`    → Using exportQuantity: ${exportQuantity}`);
          } else if (data.exported !== undefined && data.exported !== null) {
            exportQuantity = data.exported;
            console.log(`    → Using exported: ${exportQuantity}`);
          } else if (data.quantity !== undefined && data.quantity !== null) {
            exportQuantity = data.quantity;
            console.log(`    → Using quantity: ${exportQuantity}`);
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
        
        const batchInfo = batch ? ` - Batch: ${batch}` : '';
        console.log(`✅ Total exported quantity with FIFO for ${materialCode} - PO ${poNumber}${batchInfo}: ${totalExported} (${outboundRecords.length} records)`);
        
        // Debug: Log chi tiết từng record và raw data
        console.log(`📋 Detailed outbound records:`);
        outboundRecords.forEach((record, index) => {
          console.log(`  ${index + 1}. ID: ${record.id}, Quantity: ${record.exportQuantity}, Date: ${record.exportDate}, Location: ${record.location}`);
        });
        
        // Debug: Log raw data từ snapshot để kiểm tra field names
        console.log(`🔍 Raw snapshot data for debugging:`);
        snapshot.forEach(doc => {
          const rawData = doc.data();
          console.log(`  Doc ${doc.id}:`, {
            materialCode: rawData.materialCode,
            poNumber: rawData.poNumber,
            batch: rawData.batch,
            batchNumber: rawData.batchNumber, // Kiểm tra cả batch và batchNumber
            exportQuantity: rawData.exportQuantity,
            exported: rawData.exported,
            quantity: rawData.quantity,
            exportDate: rawData.exportDate,
            factory: rawData.factory
          });
        });
        
        return { totalExported, outboundRecords };
      } else {
        console.log(`ℹ️ No outbound records found for ${materialCode} - PO ${poNumber}`);
        
        // Debug: Kiểm tra xem có records nào với material code này không
        const debugSnapshot = await outboundRef
          .ref
          .where('factory', '==', 'ASM1')
          .where('materialCode', '==', materialCode)
          .limit(5)
          .get();
        
        if (!debugSnapshot.empty) {
          console.log(`🔍 Found ${debugSnapshot.size} outbound records with material code ${materialCode}, but PO numbers don't match:`);
          debugSnapshot.forEach(doc => {
            const data = doc.data() as any;
            console.log(`  - PO: "${data.poNumber}" (type: ${typeof data.poNumber}), Material: "${data.materialCode}" (type: ${typeof data.materialCode})`);
          });
        } else {
          console.log(`⚠️ No outbound records found at all for material code ${materialCode}`);
        }
        
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
      
      // Lấy thông tin outbound - QUAN TRỌNG: Truyền importDate để query chính xác
      const { totalExported, outboundRecords } = await this.getExportedQuantityFromOutboundFIFO(
        material.materialCode, 
        material.poNumber, 
        material.importDate ? material.importDate.toLocaleDateString('en-GB').split('/').join('') : undefined // Truyền importDate để query chính xác
      );
      
      console.log(`🔍 Debug: ${material.materialCode} - PO ${material.poNumber} - Total exported from outbound: ${totalExported}, Records: ${outboundRecords.length}`);
      
      // Debug chi tiết: Kiểm tra từng outbound record
      if (outboundRecords.length > 0) {
        console.log(`📋 Outbound records found:`);
        outboundRecords.forEach((record, index) => {
          console.log(`  ${index + 1}. Material: ${record.materialCode}, PO: ${record.poNumber}, Quantity: ${record.exportQuantity || record.quantity}, Date: ${record.exportDate}`);
        });
      } else {
        console.log(`🔍 No outbound records found for ${material.materialCode} - ${material.poNumber} - ImportDate: ${material.importDate ? material.importDate.toLocaleDateString('en-GB').split('/').join('') : 'N/A'}`);
        console.log(`💡 Checking if outbound records exist with different criteria...`);
        
        // Kiểm tra tất cả outbound records có material code này
        const allOutboundQuery = await this.firestore.collection('outbound-materials')
          .ref
          .where('factory', '==', 'ASM1')
          .where('materialCode', '==', material.materialCode)
          .limit(10)
          .get();
        
        if (!allOutboundQuery.empty) {
          console.log(`📋 Found ${allOutboundQuery.size} outbound records with material code ${material.materialCode}:`);
          allOutboundQuery.forEach(doc => {
            const data = doc.data() as any;
            const outboundImportDate = data.importDate ? (typeof data.importDate === 'string' ? data.importDate : data.importDate.toLocaleDateString('en-GB').split('/').join('')) : 'N/A';
            const inventoryImportDate = material.importDate ? material.importDate.toLocaleDateString('en-GB').split('/').join('') : 'N/A';
            console.log(`  - PO: "${data.poNumber}" (type: ${typeof data.poNumber}), ImportDate: "${outboundImportDate}", Quantity: ${data.exportQuantity || data.quantity}`);
            console.log(`    → Inventory PO: "${material.poNumber}" (type: ${typeof material.poNumber}), ImportDate: "${inventoryImportDate}"`);
            
            // Kiểm tra match
            const poMatch = data.poNumber === material.poNumber;
            const importDateMatch = outboundImportDate === inventoryImportDate;
            console.log(`    → PO Match: ${poMatch}, ImportDate Match: ${importDateMatch}`);
          });
        } else {
          console.log(`⚠️ No outbound records found at all for material code ${material.materialCode}`);
        }
      }
      
      // Cập nhật số lượng xuất trực tiếp - CHỈ CẬP NHẬT NẾU TÌM THẤY OUTBOUND RECORDS
      if (outboundRecords.length > 0) {
        console.log(`🔄 BEFORE UPDATE: material.exported = ${material.exported}, totalExported = ${totalExported}`);
        
        if (material.exported !== totalExported) {
          const oldExported = material.exported;
          material.exported = totalExported;
          console.log(`🔄 UPDATING: ${oldExported} → ${totalExported}`);
          
          await this.updateExportedInFirebase(material, totalExported);
          console.log(`✅ AFTER UPDATE: material.exported = ${material.exported}`);
          
          // Force UI update
          this.filteredInventory = [...this.inventoryMaterials];
          console.log(`🔄 UI updated, filteredInventory length: ${this.filteredInventory.length}`);
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
    console.log(`🔍 updateExportedInFirebase called with:`);
    console.log(`  - material.id: ${material.id}`);
    console.log(`  - material.materialCode: ${material.materialCode}`);
    console.log(`  - material.poNumber: ${material.poNumber}`);
    console.log(`  - exportedQuantity: ${exportedQuantity}`);
    
    if (!material.id) {
      console.error(`❌ Cannot update: material.id is missing for ${material.materialCode} - PO ${material.poNumber}`);
      return;
    }
    
    try {
      console.log(`🔄 Updating Firebase document: inventory-materials/${material.id}`);
      const updateData = {
        exported: exportedQuantity,
        updatedAt: new Date()
      };
      console.log(`📝 Update data:`, updateData);
      
      await this.firestore.collection('inventory-materials').doc(material.id).update(updateData);
      console.log(`💾 Exported quantity saved to Firebase: ${material.materialCode} - PO ${material.poNumber} = ${exportedQuantity}`);
    } catch (error) {
      console.error(`❌ Error saving exported quantity to Firebase: ${material.materialCode} - PO ${material.poNumber}:`, error);
      console.error(`❌ Full error details:`, error);
    }
  }
  
  // Test method để kiểm tra logic FIFO
  async testFIFOLogic(materialCode: string, poNumber: string): Promise<void> {
    try {
      console.log(`🧪 Testing FIFO logic for ${materialCode} - PO ${poNumber}`);
      
      // Tìm tất cả dòng inventory cùng Material + PO
      const allInventoryItems = this.inventoryMaterials.filter(item => 
        item.materialCode === materialCode && 
        item.poNumber === poNumber
      );
      
      if (allInventoryItems.length === 0) {
        console.log(`⚠️ No inventory items found for ${materialCode} - PO ${poNumber}`);
        return;
      }
      
      console.log(`📊 Found ${allInventoryItems.length} inventory items:`);
      allInventoryItems.forEach(item => {
        const availableStock = (item.openingStock || 0) + item.quantity - (item.xt || 0);
        console.log(`  Item: Stock=${availableStock}, Exported=${item.exported || 0}, Current=${this.calculateCurrentStock(item)}`);
      });
      
      // Lấy thông tin outbound - Lưu ý: testFIFOLogic không có batch cụ thể nên sẽ query theo Material + PO
      const { totalExported } = await this.getExportedQuantityFromOutboundFIFO(materialCode, poNumber);
      console.log(`📦 Total outbound: ${totalExported}`);
      
      // Mô phỏng phân bổ FIFO
      let remainingExported = totalExported;
      console.log(`🔄 FIFO Distribution Simulation:`);
      
      for (const item of allInventoryItems) {
        if (remainingExported <= 0) break;
        
        const availableStock = (item.openingStock || 0) + item.quantity - (item.xt || 0);
        if (availableStock <= 0) {
          console.log(`  Item: Skip (no stock)`);
          continue;
        }
        
        const exportedFromThisItem = Math.min(remainingExported, availableStock);
        console.log(`  Item: Export ${exportedFromThisItem} from ${availableStock} available, Remaining: ${remainingExported - exportedFromThisItem}`);
        
        remainingExported -= exportedFromThisItem;
      }
      
      console.log(`✅ FIFO test completed for ${materialCode} - PO ${poNumber}`);
      
    } catch (error) {
      console.error(`❌ Error testing FIFO logic for ${materialCode} - PO ${poNumber}:`, error);
    }
  }

  // Test method để kiểm tra dữ liệu outbound
  async testOutboundData(): Promise<void> {
    try {
      console.log('🔍 Testing outbound data...');
      
      // Kiểm tra collection outbound-materials
      const outboundSnapshot = await this.firestore.collection('outbound-materials')
        .ref
        .where('factory', '==', 'ASM1')
        .limit(10)
        .get();
      
      console.log(`📊 Found ${outboundSnapshot.size} outbound records for ASM1`);
      
      if (!outboundSnapshot.empty) {
        outboundSnapshot.forEach(doc => {
          const data = doc.data() as any;
          console.log(`📦 Outbound: ${data.materialCode} - PO: ${data.poNumber} - Quantity: ${data.exportQuantity || data.exported || data.quantity || 'N/A'} - Date: ${data.exportDate}`);
        });
      } else {
        console.log('⚠️ No outbound records found for ASM1');
        
        // Kiểm tra xem có collection nào khác không
        console.log('🔍 Checking other possible collections...');
        const collections = ['outbound', 'exports', 'shipments', 'materials-out'];
        
        for (const collectionName of collections) {
          try {
            const snapshot = await this.firestore.collection(collectionName).ref.limit(1).get();
            if (snapshot && !snapshot.empty) {
              console.log(`✅ Found collection: ${collectionName} with ${snapshot.size} documents`);
              const sampleDoc = snapshot.docs[0].data() as any;
              console.log(`📋 Sample document fields:`, Object.keys(sampleDoc));
            }
          } catch (e) {
            console.log(`❌ Collection ${collectionName} not found`);
          }
        }
      }
      
    } catch (error) {
      console.error('❌ Error testing outbound data:', error);
    }
  }

  /**
   * Debug method để kiểm tra vấn đề matching giữa Outbound và Inventory
   */
  async debugInventoryMatching(): Promise<void> {
    try {
      console.log('🔍 Debugging RM1 Inventory matching issue...');
      
      // 1. Kiểm tra dữ liệu Outbound
      console.log('\n📦 === CHECKING OUTBOUND DATA ===');
      const outboundSnapshot = await this.firestore.collection('outbound-materials')
        .ref
        .where('factory', '==', 'ASM1')
        .limit(10)
        .get();
      
      console.log(`📊 Found ${outboundSnapshot.size} outbound records for ASM1`);
      
      if (!outboundSnapshot.empty) {
        console.log('\n📋 Outbound Records:');
        outboundSnapshot.forEach((doc) => {
          const data = doc.data() as any;
          console.log(`  ID: ${doc.id}`);
          console.log(`     Material: ${data.materialCode}`);
          console.log(`     PO: "${data.poNumber}" (type: ${typeof data.poNumber})`);
          console.log(`     ImportDate: ${data.importDate} (type: ${typeof data.importDate})`);
          console.log(`     ExportQuantity: ${data.exportQuantity}`);
          console.log(`     ExportDate: ${data.exportDate}`);
          console.log('     ---');
        });
      }
      
      // 2. Kiểm tra dữ liệu Inventory
      console.log('\n📦 === CHECKING INVENTORY DATA ===');
      const inventorySnapshot = await this.firestore.collection('inventory-materials')
        .ref
        .where('factory', '==', 'ASM1')
        .limit(10)
        .get();
      
      console.log(`📊 Found ${inventorySnapshot.size} inventory records for ASM1`);
      
      if (!inventorySnapshot.empty) {
        console.log('\n📋 Inventory Records:');
        inventorySnapshot.forEach((doc) => {
          const data = doc.data() as any;
          console.log(`  ID: ${doc.id}`);
          console.log(`     Material: ${data.materialCode}`);
          console.log(`     PO: "${data.poNumber}" (type: ${typeof data.poNumber})`);
          console.log(`     ImportDate: ${data.importDate} (type: ${typeof data.importDate})`);
          console.log(`     Quantity: ${data.quantity}`);
          console.log(`     Exported: ${data.exported}`);
          console.log(`     Location: ${data.location}`);
          console.log('     ---');
        });
      }
      
      // 3. Tìm matching records
      console.log('\n🔍 === FINDING MATCHING RECORDS ===');
      const outboundRecords: any[] = [];
      const inventoryRecords: any[] = [];
      
      outboundSnapshot.forEach(doc => {
        const data = doc.data() as any;
        outboundRecords.push({ id: doc.id, ...data });
      });
      
      inventorySnapshot.forEach(doc => {
        const data = doc.data() as any;
        inventoryRecords.push({ id: doc.id, ...data });
      });
      
      let matchCount = 0;
      let noMatchCount = 0;
      
      outboundRecords.forEach(outbound => {
        console.log(`\n🔍 Checking outbound: ${outbound.materialCode} - PO: "${outbound.poNumber}"`);
        
        const matches = inventoryRecords.filter(inventory => {
          const materialMatch = inventory.materialCode === outbound.materialCode;
          const poMatch = inventory.poNumber === outbound.poNumber;
          
          // Check import date match
          let importDateMatch = false;
          if (outbound.importDate && inventory.importDate) {
            let outboundDate = '';
            let inventoryDate = '';
            
            // Parse outbound import date
            if (outbound.importDate.toDate) {
              outboundDate = outbound.importDate.toDate().toLocaleDateString('en-GB').split('/').join('');
            } else {
              outboundDate = outbound.importDate.toString();
            }
            
            // Parse inventory import date
            if (inventory.importDate.toDate) {
              inventoryDate = inventory.importDate.toDate().toLocaleDateString('en-GB').split('/').join('');
            } else {
              inventoryDate = inventory.importDate.toString();
            }
            
            importDateMatch = outboundDate === inventoryDate;
          }
          
          return materialMatch && poMatch && importDateMatch;
        });
        
        if (matches.length > 0) {
          matchCount++;
          console.log(`  ✅ FOUND ${matches.length} matching inventory records:`);
          matches.forEach(match => {
            console.log(`    - Inventory ID: ${match.id}`);
            console.log(`    - Current Exported: ${match.exported || 0}`);
            console.log(`    - Outbound Export: ${outbound.exportQuantity || outbound.quantity || 0}`);
          });
        } else {
          noMatchCount++;
          console.log(`  ❌ NO matching inventory records found`);
          console.log(`    - Checking available inventory for material ${outbound.materialCode}:`);
          
          const materialMatches = inventoryRecords.filter(inv => inv.materialCode === outbound.materialCode);
          if (materialMatches.length > 0) {
            console.log(`    - Found ${materialMatches.length} records with same material:`);
            materialMatches.forEach(match => {
              console.log(`      * PO: "${match.poNumber}" vs "${outbound.poNumber}"`);
              console.log(`      * ImportDate: ${match.importDate} vs ${outbound.importDate}`);
            });
          } else {
            console.log(`    - No inventory records found for material ${outbound.materialCode}`);
          }
        }
      });
      
      console.log(`\n📊 === SUMMARY ===`);
      console.log(`✅ Matching records: ${matchCount}`);
      console.log(`❌ No match records: ${noMatchCount}`);
      
      // 4. Kiểm tra logic update
      console.log('\n🔧 === TESTING UPDATE LOGIC ===');
      if (matchCount > 0) {
        console.log('💡 Logic should work for matching records');
        console.log('💡 Check if updateExportedFromOutboundFIFO is being called');
        console.log('💡 Check if updateInventoryExported is being called');
      } else {
        console.log('⚠️ No matching records found - this explains why inventory is not updating');
        console.log('💡 Possible issues:');
        console.log('   - PO Number format mismatch');
        console.log('   - Import Date format mismatch');
        console.log('   - Missing inventory records');
        console.log('   - Data type issues');
      }
      
    } catch (error) {
      console.error('❌ Error during debug:', error);
    }
  }

  // Test sync with detailed debug logging
  async testSyncWithDebug(): Promise<void> {
    try {
      console.log('🧪 Testing sync with detailed debug logging...');
      
      // Kiểm tra dữ liệu hiện tại
      console.log(`📋 Current inventory materials: ${this.inventoryMaterials.length}`);
      if (this.inventoryMaterials.length > 0) {
        const firstMaterial = this.inventoryMaterials[0];
        console.log(`🔍 First material before sync:`, {
          materialCode: firstMaterial.materialCode,
          poNumber: firstMaterial.poNumber,
          batchNumber: firstMaterial.batchNumber,
          exported: firstMaterial.exported
        });
      }
      
      // Test sync với một material cụ thể
      if (this.inventoryMaterials.length > 0) {
        const testMaterial = this.inventoryMaterials[0];
        console.log(`🧪 Testing sync for material: ${testMaterial.materialCode} - PO: ${testMaterial.poNumber}`);
        await this.updateExportedFromOutboundFIFO(testMaterial);
        
        console.log(`🔍 First material after sync:`, {
          materialCode: testMaterial.materialCode,
          poNumber: testMaterial.poNumber,
          batchNumber: testMaterial.batchNumber,
          exported: testMaterial.exported
        });
        
        // Force UI update
        this.filteredInventory = [...this.inventoryMaterials];
        console.log(`🔄 UI updated, filteredInventory length: ${this.filteredInventory.length}`);
      }
      
    } catch (error) {
      console.error('❌ Error testing sync with debug:', error);
      alert(`❌ Error testing sync: ${error.message}`);
    }
  }

  // Simple test method to check if data is loaded
  async testDataLoading(): Promise<void> {
    try {
      console.log('🔍 Testing data loading...');
      
      // Check inventory data
      console.log(`📋 Inventory materials loaded: ${this.inventoryMaterials.length}`);
      if (this.inventoryMaterials.length > 0) {
        const first = this.inventoryMaterials[0];
        console.log(`📦 First material:`, {
          id: first.id,
          materialCode: first.materialCode,
          poNumber: first.poNumber,
          batchNumber: first.batchNumber,
          exported: first.exported,
          quantity: first.quantity
        });
      } else {
        console.log('⚠️ No inventory data loaded, trying backup method...');
        await this.loadInventoryBackup();
      }
      
      // Check outbound data
      const outboundSnapshot = await this.firestore.collection('outbound-materials')
        .ref
        .where('factory', '==', 'ASM1')
        .limit(5)
        .get();
      
      console.log(`📤 Outbound records found: ${outboundSnapshot.size}`);
      if (!outboundSnapshot.empty) {
        outboundSnapshot.forEach(doc => {
          const data = doc.data() as any;
          console.log(`📤 Outbound:`, {
            materialCode: data.materialCode,
            poNumber: data.poNumber,
            batch: data.batch || data.batchNumber,
            quantity: data.exportQuantity || data.exported || data.quantity
          });
        });
      }
      
      // Test sync for first material
      if (this.inventoryMaterials.length > 0) {
        const material = this.inventoryMaterials[0];
        console.log(`🔄 Testing sync for: ${material.materialCode} - PO: ${material.poNumber}`);
        
        const { totalExported, outboundRecords } = await this.getExportedQuantityFromOutboundFIFO(
          material.materialCode, 
          material.poNumber, 
          material.batchNumber
        );
        
        console.log(`📊 Sync result:`, {
          totalExported,
          outboundRecords: outboundRecords.length,
          currentExported: material.exported
        });
      }
      
    } catch (error) {
      console.error('❌ Error testing data loading:', error);
    }
  }

  // Backup method to load inventory data if subscription fails
  async loadInventoryBackup(): Promise<void> {
    try {
      console.log('🔄 Loading inventory data using backup method...');
      
      const snapshot = await this.firestore.collection('inventory-materials')
        .ref
        .where('factory', '==', this.FACTORY)
        .orderBy('importDate', 'desc')
        .limit(1000)
        .get();
      
      console.log(`📦 Backup method found ${snapshot.size} inventory records`);
      
      this.inventoryMaterials = snapshot.docs.map(doc => {
        const data = doc.data() as any;
        const id = doc.id;
        return {
          id: id,
          ...data,
          factory: this.FACTORY,
          importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : new Date(),
          receivedDate: data.receivedDate ? new Date(data.receivedDate.seconds * 1000) : new Date(),
          expiryDate: data.expiryDate ? new Date(data.expiryDate.seconds * 1000) : new Date(),
          openingStock: data.openingStock || null,
          xt: data.xt || 0,
          source: data.source || 'manual'
        };
      });
      
      this.filteredInventory = [...this.inventoryMaterials];
      console.log(`✅ Backup method loaded ${this.inventoryMaterials.length} materials`);
      
      // 🔧 SIMPLIFIED: Exported quantities loaded directly from Firebase (no auto-update needed)
      console.log('✅ Backup method exported quantities loaded directly from Firebase');
      
    } catch (error) {
      console.error('❌ Error in backup method:', error);
    }
  }

  // Test method để kiểm tra link outbound-inventory
  async testOutboundInventoryLink(materialCode: string, poNumber: string): Promise<void> {
    try {
      console.log(`🔗 Testing outbound-inventory link for ${materialCode} - PO ${poNumber}`);
      
      // 1. Kiểm tra dữ liệu outbound - Lưu ý: testOutboundInventoryLink không có batch cụ thể nên sẽ query theo Material + PO
      const { totalExported, outboundRecords } = await this.getExportedQuantityFromOutboundFIFO(materialCode, poNumber);
      console.log(`📦 Outbound data: ${totalExported} units from ${outboundRecords.length} records`);
      
      // 2. Kiểm tra dữ liệu inventory
      const inventoryItems = this.inventoryMaterials.filter(item => 
        item.materialCode === materialCode && 
        item.poNumber === poNumber
      );
      console.log(`📋 Inventory items: ${inventoryItems.length} found`);
      
      inventoryItems.forEach((item, index) => {
        console.log(`  ${index + 1}. ID: ${item.id}, Location: ${item.location}, Exported: ${item.exported}, Stock: ${this.calculateCurrentStock(item)}`);
      });
      
      // 3. So sánh
      const totalInventoryExported = inventoryItems.reduce((sum, item) => sum + (item.exported || 0), 0);
      console.log(`🔍 Comparison: Outbound total = ${totalExported}, Inventory total = ${totalInventoryExported}`);
      
      if (totalExported === totalInventoryExported) {
        console.log(`✅ Link is working correctly!`);
      } else {
        console.log(`⚠️ Link mismatch! Need to sync.`);
      }
      
    } catch (error) {
      console.error(`❌ Error testing outbound-inventory link:`, error);
    }
  }

  // Tạo dữ liệu test outbound nếu không có
  async createTestOutboundData(): Promise<void> {
    try {
      console.log('🧪 Creating test outbound data...');
      
      // Kiểm tra xem có dữ liệu outbound nào không
      const existingSnapshot = await this.firestore.collection('outbound-materials')
        .ref
        .where('factory', '==', 'ASM1')
        .limit(1)
        .get();
      
      if (!existingSnapshot.empty) {
        console.log('✅ Outbound data already exists, no need to create test data');
        return;
      }
      
      // Tạo dữ liệu test cho mã hàng B024052
      const testData = [
        {
          factory: 'ASM1',
          materialCode: 'B024052',
          poNumber: 'KZP00525/0207',
          exportQuantity: 5,
          exportDate: new Date(),
          location: 'A1',
          notes: 'Test data - Auto generated'
        },
        {
          factory: 'ASM1',
          materialCode: 'B024052',
          poNumber: 'KZP00625/0070',
          exportQuantity: 3,
          exportDate: new Date(),
          location: 'B2',
          notes: 'Test data - Auto generated'
        }
      ];
      
      // Thêm vào Firebase
      for (const data of testData) {
        await this.firestore.collection('outbound-materials').add(data);
        console.log(`✅ Created test outbound record: ${data.materialCode} - PO ${data.poNumber} - Quantity: ${data.exportQuantity}`);
      }
      
      console.log('✅ Test outbound data created successfully!');
      
      // Refresh dữ liệu
      setTimeout(() => {
        this.autoUpdateAllExportedFromOutbound();
      }, 1000);
      
    } catch (error) {
      console.error('❌ Error creating test outbound data:', error);
    }
  }

  // Cập nhật display sau khi sync để tránh mất dữ liệu
  private updateDisplayAfterSync(): void {
    try {
      console.log('🔄 Updating display after sync...');
      
      // Đảm bảo dữ liệu exported được giữ nguyên
      this.filteredInventory = this.filteredInventory.map(item => {
        const originalItem = this.inventoryMaterials.find(m => m.id === item.id);
        if (originalItem && originalItem.exported !== undefined) {
          item.exported = originalItem.exported;
        }
        return item;
      });
      
      // Cập nhật counters
      this.updateNegativeStockCount();
      this.updateTotalStockCount();
      
      console.log('✅ Display updated after sync');
      
    } catch (error) {
      console.error('❌ Error updating display after sync:', error);
    }
  }

  // Auto-fix và test toàn bộ hệ thống
  async autoFixAndTest(): Promise<void> {
    try {
      console.log('🔧 Starting auto-fix and test process...');
      
      // 1. Kiểm tra dữ liệu outbound
      console.log('📋 Step 1: Checking outbound data...');
      await this.testOutboundData();
      
      // 2. Tạo dữ liệu test nếu cần
      console.log('📋 Step 2: Creating test data if needed...');
      await this.createTestOutboundData();
      
      // 3. Sync dữ liệu từ outbound
      console.log('📋 Step 3: Syncing data from outbound...');
      await this.syncAllExportedFromOutbound();
      
      // 4. Test link cụ thể
      console.log('📋 Step 4: Testing specific links...');
      if (this.inventoryMaterials.length > 0) {
        const firstMaterial = this.inventoryMaterials[0];
        await this.testOutboundInventoryLink(firstMaterial.materialCode, firstMaterial.poNumber);
      }
      
      console.log('✅ Auto-fix and test process completed!');
      
    } catch (error) {
      console.error('❌ Error during auto-fix and test:', error);
    }
  }

  // Fix cả 2 vấn đề: gộp dòng và hiển thị số lượng xuất
  async fixInventoryIssues(): Promise<void> {
    try {
      console.log('🔧 Fixing inventory issues...');
      
      // 1. Kiểm tra trạng thái hiện tại
      console.log(`📊 Current state: ${this.inventoryMaterials.length} materials, ${this.filteredInventory.length} filtered`);
      
      // 2. Gộp dòng trùng lặp (mã hàng + PO)
      console.log('🔄 Step 1: Consolidating duplicate materials...');
      const beforeCount = this.inventoryMaterials.length;
      this.consolidateInventoryData();
      const afterCount = this.inventoryMaterials.length;
      console.log(`✅ Consolidation: ${beforeCount} → ${afterCount} items`);
      
      // 3. Tạo dữ liệu test outbound nếu cần
      console.log('🔄 Step 2: Creating test outbound data...');
      await this.createTestOutboundData();
      
      // 4. Sync số lượng xuất từ outbound
      console.log('🔄 Step 3: Syncing exported quantities...');
      await this.syncAllExportedFromOutbound();
      
      // 5. Kiểm tra kết quả
      console.log('🔄 Step 4: Checking results...');
      this.inventoryMaterials.forEach((material, index) => {
        console.log(`${index + 1}. ${material.materialCode} - PO: ${material.poNumber} - Exported: ${material.exported} - Stock: ${this.calculateCurrentStock(material)}`);
      });
      
      // 6. Cập nhật display
      this.filteredInventory = [...this.inventoryMaterials];
      this.updateNegativeStockCount();
      
      console.log('✅ Inventory issues fixed!');
      
    } catch (error) {
      console.error('❌ Error fixing inventory issues:', error);
    }
  }

  // Kiểm tra trạng thái gộp dòng
  checkConsolidationStatus(): void {
    try {
      console.log('🔍 Checking consolidation status...');
      
      // Kiểm tra dữ liệu hiện tại
      const materialPoMap = new Map<string, InventoryMaterial[]>();
      
      this.inventoryMaterials.forEach(material => {
        // Gộp theo Mã hàng + PO + Batch
        const key = `${material.materialCode}_${material.poNumber}_${material.batchNumber || 'NO_BATCH'}`;
        if (!materialPoMap.has(key)) {
          materialPoMap.set(key, []);
        }
        materialPoMap.get(key)!.push(material);
      });
      
      // Hiển thị thống kê
      console.log(`📊 Total materials: ${this.inventoryMaterials.length}`);
      console.log(`📊 Unique Material+PO+Batch combinations: ${materialPoMap.size}`);
      
      // Hiển thị các dòng trùng lặp
      materialPoMap.forEach((materials, key) => {
        if (materials.length > 1) {
          console.log(`⚠️ Duplicate found: ${key} (${materials.length} items)`);
          materials.forEach((material, index) => {
            console.log(`  ${index + 1}. ID: ${material.id}, Location: ${material.location}, Type: ${material.type}, Quantity: ${material.quantity}, Exported: ${material.exported}`);
          });
        }
      });
      
      // Kiểm tra số lượng xuất
      const materialsWithExported = this.inventoryMaterials.filter(m => m.exported && m.exported > 0);
      console.log(`📦 Materials with exported quantities: ${materialsWithExported.length}`);
      
      if (materialsWithExported.length > 0) {
        materialsWithExported.forEach(material => {
          console.log(`  📦 ${material.materialCode} - PO ${material.poNumber}: Exported = ${material.exported}`);
        });
      } else {
        console.log('⚠️ No materials have exported quantities!');
      }
      
    } catch (error) {
      console.error('❌ Error checking consolidation status:', error);
    }
  }

  // Gộp dòng ngay lập tức
  forceConsolidateNow(): void {
    try {
      console.log('🚀 Force consolidating inventory data now...');
      
      const beforeCount = this.inventoryMaterials.length;
      console.log(`📊 Before consolidation: ${beforeCount} items`);
      
      // Gộp dòng
      this.consolidateInventoryData();
      
      const afterCount = this.inventoryMaterials.length;
      console.log(`📊 After consolidation: ${afterCount} items`);
      console.log(`✅ Reduced by: ${beforeCount - afterCount} items`);
      
      // Cập nhật display
      this.filteredInventory = [...this.inventoryMaterials];
      this.updateNegativeStockCount();
      
      console.log('✅ Force consolidation completed!');
      
    } catch (error) {
      console.error('❌ Error during force consolidation:', error);
    }
  }

  // Test gộp dòng đơn giản
  simpleConsolidate(): void {
    try {
      console.log('🔧 Simple consolidation test...');
      
      if (!this.inventoryMaterials || this.inventoryMaterials.length === 0) {
        console.log('⚠️ No materials to consolidate');
        return;
      }
      
      console.log(`📊 Input: ${this.inventoryMaterials.length} materials`);
      
      // Tạo map theo Material + PO + Batch
      const map = new Map<string, InventoryMaterial>();
      
      this.inventoryMaterials.forEach((material, index) => {
        const key = `${material.materialCode}_${material.poNumber}_${material.batchNumber || 'NO_BATCH'}`;
        
        console.log(`🔍 Row ${index + 1}: ${material.materialCode} - PO ${material.poNumber} - Batch ${material.batchNumber || 'NO_BATCH'} - Key: ${key}`);
        
        if (map.has(key)) {
          // Gộp với dòng hiện có
          const existing = map.get(key)!;
          console.log(`🔄 Found duplicate! Merging with existing row...`);
          console.log(`  Existing: Quantity=${existing.quantity}, Exported=${existing.exported}`);
          console.log(`  New: Quantity=${material.quantity}, Exported=${material.exported}`);
          
          existing.quantity += material.quantity;
          existing.exported = (existing.exported || 0) + (material.exported || 0);
          existing.xt = (existing.xt || 0) + (material.xt || 0);
          
          // Vị trí và loại hình lấy từ dòng đầu tiên (không gộp)
          // existing.location và existing.type giữ nguyên từ dòng đầu tiên
          
          console.log(`✅ After merge: Quantity=${existing.quantity}, Exported=${existing.exported}`);
        } else {
          // Dòng mới
          map.set(key, { ...material });
          console.log(`✅ New row added to map`);
        }
      });
      
      // Cập nhật dữ liệu
      const beforeCount = this.inventoryMaterials.length;
      this.inventoryMaterials = Array.from(map.values());
      this.filteredInventory = [...this.inventoryMaterials];
      
      console.log(`✅ Simple consolidation: ${beforeCount} → ${this.inventoryMaterials.length} items`);
      
      // Hiển thị kết quả gộp
      console.log(`📊 Final consolidated data:`);
      this.inventoryMaterials.forEach((material, index) => {
        console.log(`  ${index + 1}. ${material.materialCode} - PO ${material.poNumber} - Batch ${material.batchNumber || 'NO_BATCH'} - Quantity: ${material.quantity}`);
      });
      
    } catch (error) {
      console.error('❌ Error in simple consolidation:', error);
    }
  }

  // Test gộp dòng cụ thể cho B001430
  testB001430Consolidation(): void {
    try {
      console.log('🧪 Testing B001430 consolidation specifically...');
      
      if (!this.inventoryMaterials || this.inventoryMaterials.length === 0) {
        console.log('⚠️ No materials to test');
        return;
      }
      
      // Tìm tất cả dòng B001430
      const b001430Rows = this.inventoryMaterials.filter(m => m.materialCode === 'B001430');
      console.log(`📊 Found ${b001430Rows.length} rows with B001430`);
      
      b001430Rows.forEach((row, index) => {
        console.log(`  Row ${index + 1}: PO=${row.poNumber}, Batch=${row.batchNumber}, NK=${row.quantity}, Location=${row.location}`);
      });
      
      // Tìm dòng trùng lặp theo PO + Batch
      const poBatchMap = new Map<string, InventoryMaterial[]>();
      
      b001430Rows.forEach(row => {
        const key = `${row.poNumber}_${row.batchNumber || 'NO_BATCH'}`;
        if (!poBatchMap.has(key)) {
          poBatchMap.set(key, []);
        }
        poBatchMap.get(key)!.push(row);
      });
      
      console.log(`📊 PO+Batch combinations for B001430:`);
      poBatchMap.forEach((rows, key) => {
        console.log(`  ${key}: ${rows.length} rows`);
        if (rows.length > 1) {
          console.log(`    ⚠️ DUPLICATE FOUND! ${rows.length} rows with same PO+Batch`);
          rows.forEach((row, index) => {
            console.log(`      ${index + 1}. NK=${row.quantity}, Location=${row.location}`);
          });
        }
      });
      
      // Thực hiện gộp test
      console.log(`🔄 Testing consolidation for B001430...`);
      this.simpleConsolidate();
      
    } catch (error) {
      console.error('❌ Error in B001430 test:', error);
    }
  }

  // Gộp dòng thủ công khi cần thiết (không tự động gộp)
  async manualConsolidateData(): Promise<void> {
    try {
      console.log('🔄 Manual consolidation started...');
      
      // Lưu dữ liệu exported trước khi gộp
      const exportedData = new Map<string, number>();
      this.inventoryMaterials.forEach(material => {
        const key = `${material.materialCode}_${material.poNumber}`;
        if (material.exported && material.exported > 0) {
          exportedData.set(key, material.exported);
        }
      });
      
      // Gộp dòng
      this.consolidateInventoryData();
      
      // Khôi phục dữ liệu exported sau khi gộp
      this.inventoryMaterials.forEach(material => {
        const key = `${material.materialCode}_${material.poNumber}`;
        if (exportedData.has(key)) {
          material.exported = exportedData.get(key)!;
          // Cập nhật Firebase
          this.updateExportedInFirebase(material, material.exported);
        }
      });
      
      console.log('✅ Manual consolidation completed with exported data preserved!');
      
    } catch (error) {
      console.error('❌ Error during manual consolidation:', error);
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
      console.log(`📊 New stock calculated: ${newStock} (Opening Stock: ${material.openingStock} + Quantity: ${material.quantity} - Exported: ${material.exported} - XT: ${material.xt})`);
      
      // Update negative stock count for real-time display
      this.updateNegativeStockCount();
      
    } catch (error) {
      console.error(`❌ Error updating XT quantity for ${material.materialCode}:`, error);
    }
  }

  // Update opening stock quantity
  async updateOpeningStock(material: InventoryMaterial): Promise<void> {
    try {
      const openingStockDisplay = material.openingStock !== null ? material.openingStock : 'trống';
      console.log(`📝 Updating opening stock for ${material.materialCode} - PO ${material.poNumber}: ${openingStockDisplay}`);
      
      // Update in Firebase
      this.updateMaterialInFirebase(material);
      
      // Recalculate stock
      const newStock = this.calculateCurrentStock(material);
      const openingStockValue = material.openingStock !== null ? material.openingStock : 0;
      console.log(`📊 New stock calculated: ${newStock} (Opening Stock: ${openingStockValue} + Quantity: ${material.quantity} - Exported: ${material.exported} - XT: ${material.xt})`);
      
      // Update negative stock count for real-time display
      this.updateNegativeStockCount();
      
    } catch (error) {
      console.error(`❌ Error updating opening stock for ${material.materialCode}:`, error);
    }
  }

  // Update exported amount (when unlocked) - Chỉ cho phép user có quyền Xóa
  updateExportedAmount(material: InventoryMaterial): void {
    console.log(`🔍 updateExportedAmount called for: ${material.materialCode} - PO ${material.poNumber}`);
    console.log(`🔍 Current material.exported value: ${material.exported}`);
    console.log(`🔍 Current material.id: ${material.id}`);
    
    // Kiểm tra quyền và trạng thái mở khóa
    if (!this.canDelete) {
      console.error('❌ User does not have delete permission to update exported amount');
      return;
    }
    
    
    // Đảm bảo exported có giá trị hợp lệ
    if (material.exported === null || material.exported === undefined) {
      material.exported = 0;
    }
    
    console.log(`📝 Updating exported amount for ${material.materialCode} - PO ${material.poNumber}: ${material.exported} (by user with delete permission)`);
    
    // Update in Firebase - sử dụng updateMaterialInFirebase như ASM2
    this.updateMaterialInFirebase(material);
    
    // Update negative stock count for real-time display
    this.updateNegativeStockCount();
  }







  // Auto-update all exported quantities from RM1 outbound (silent, no user interaction)
  private async autoUpdateAllExportedFromOutbound(): Promise<void> {
    try {
      console.log('🔄 Auto-updating exported quantities from RM1 outbound with FIFO logic...');
      
      // Debug: Kiểm tra dữ liệu outbound trước
      console.log('🔍 Debug: Checking outbound data...');
      const outboundSnapshot = await this.firestore.collection('outbound-materials')
        .ref
        .where('factory', '==', 'ASM1')
        .limit(5)
        .get();
      
      console.log(`🔍 Debug: Found ${outboundSnapshot.size} outbound records for ASM1`);
      if (!outboundSnapshot.empty) {
        outboundSnapshot.forEach(doc => {
          const data = doc.data() as any;
          console.log(`🔍 Debug: Outbound record - Material: ${data.materialCode}, PO: ${data.poNumber}, Quantity: ${data.exportQuantity || data.exported || data.quantity || 'N/A'}`);
        });
      }
      
      let updatedCount = 0;
      let errorCount = 0;
      
      for (const material of this.inventoryMaterials) {
        try {
          console.log(`🔍 Debug: Processing material ${material.materialCode} - PO ${material.poNumber}, current exported: ${material.exported}`);
          await this.updateExportedFromOutboundFIFO(material);
          console.log(`🔍 Debug: After update - exported: ${material.exported}`);
          updatedCount++;
        } catch (error) {
          console.error(`❌ Error auto-updating ${material.materialCode} - PO ${material.poNumber} - Location ${material.location}:`, error);
          errorCount++;
        }
      }
      
      console.log(`✅ Auto-update completed with FIFO logic: ${updatedCount} materials updated, ${errorCount} errors`);
      
      // Refresh the display
      this.filteredInventory = [...this.inventoryMaterials];
      
      // KHÔNG gộp dòng sau khi cập nhật exported để tránh mất dữ liệu
      // this.consolidateInventoryData();
      
      // Sắp xếp FIFO sau khi cập nhật
      this.sortInventoryFIFO();
      
    } catch (error) {
      console.error('❌ Error during auto-update:', error);
    }
  }

  // Auto-update exported quantities for search results only
  private async autoUpdateSearchResultsExportedFromOutbound(): Promise<void> {
    try {
      console.log('🔄 Auto-updating exported quantities for search results with FIFO logic...');
      
      let updatedCount = 0;
      let errorCount = 0;
      
      for (const material of this.filteredInventory) {
        try {
          await this.updateExportedFromOutboundFIFO(material);
          updatedCount++;
        } catch (error) {
          console.error(`❌ Error auto-updating search result ${material.materialCode} - PO ${material.poNumber} - Location ${material.location}:`, error);
          errorCount++;
        }
      }
      
      console.log(`✅ Search results auto-update completed with FIFO logic: ${updatedCount} materials updated, ${errorCount} errors`);
      
    } catch (error) {
      console.error('❌ Error during search results auto-update:', error);
    }
  }

  // Sync all exported quantities from RM1 outbound (manual sync - kept for backward compatibility)
  async syncAllExportedFromOutbound(): Promise<void> {
    try {
      console.log('🔄 Starting manual sync of all exported quantities from RM1 outbound with FIFO logic...');
      console.log(`📋 Total inventory materials to process: ${this.inventoryMaterials.length}`);
      
      let updatedCount = 0;
      let errorCount = 0;
      
      for (let i = 0; i < this.inventoryMaterials.length; i++) {
        const material = this.inventoryMaterials[i];
        console.log(`\n🔄 Processing material ${i + 1}/${this.inventoryMaterials.length}: ${material.materialCode} - PO: ${material.poNumber}`);
        console.log(`  Current exported: ${material.exported || 0}`);
        
        try {
          await this.updateExportedFromOutboundFIFO(material);
          console.log(`  Final exported: ${material.exported || 0}`);
          updatedCount++;
        } catch (error) {
          console.error(`❌ Error syncing ${material.materialCode} - PO ${material.poNumber} - Location ${material.location}:`, error);
          errorCount++;
        }
      }
      
      console.log(`\n✅ Manual sync completed with FIFO logic: ${updatedCount} materials updated, ${errorCount} errors`);
      
      // Refresh the display
      this.filteredInventory = [...this.inventoryMaterials];
      console.log(`🔄 Display refreshed, filteredInventory length: ${this.filteredInventory.length}`);
      
      // KHÔNG gộp dòng sau khi đồng bộ để tránh mất dữ liệu exported
      // this.consolidateInventoryData();
      
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



  // Edit functions for Opening Stock
  startEditingOpeningStock(material: InventoryMaterial): void {
    material.isEditingOpeningStock = true;
  }

  finishEditingOpeningStock(material: InventoryMaterial): void {
    material.isEditingOpeningStock = false;
    this.updateOpeningStock(material);
  }

  cancelEditingOpeningStock(material: InventoryMaterial): void {
    material.isEditingOpeningStock = false;
    // Revert to original value if needed
  }

  // Edit functions for XT
  startEditingXT(material: InventoryMaterial): void {
    material.isEditingXT = true;
  }

  finishEditingXT(material: InventoryMaterial): void {
    material.isEditingXT = false;
    this.updateXT(material);
  }

  cancelEditingXT(material: InventoryMaterial): void {
    material.isEditingXT = false;
    // Revert to original value if needed
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
      
      // Get Standard Packing for comparison
      const standardPacking = this.getStandardPacking(material.materialCode);
      
      // Check if this is a partial label (in tem lẻ)
      const isPartialLabel = standardPacking && rollsOrBags !== standardPacking;
      
      console.log('📊 QR calculation:', {
        totalQuantity,
        rollsOrBags,
        standardPacking,
        isPartialLabel
      });
      
      // Generate QR codes based on quantity per unit
      // QR code format: Mã hàng|PO|Số đơn vị|IMD (có sequence number nếu duplicate)
      // Sử dụng getDisplayIMD để lấy đúng IMD có sequence number
      const qrCodes = [];
      
      // Sử dụng getDisplayIMD để lấy đúng IMD có sequence number
      const imdForQR = this.getDisplayIMD(material);
      
      console.log('🏷️ QR Code IMD info:', {
        materialCode: material.materialCode,
        poNumber: material.poNumber,
        importDate: material.importDate,
        batchNumber: material.batchNumber,
        displayIMD: imdForQR,
        hasSequenceNumber: imdForQR !== (material.importDate ? material.importDate.toLocaleDateString('en-GB').split('/').join('') : 'N/A')
      });
      
      if (isPartialLabel) {
        // 🆕 LOGIC MỚI: In tem lẻ - chỉ in 1 tem với số lượng nhập vào
        console.log('🏷️ In tem lẻ - chỉ in 1 tem với số lượng:', rollsOrBags);
        qrCodes.push({
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          unitNumber: rollsOrBags,
          qrData: `${material.materialCode}|${material.poNumber}|${rollsOrBags}|${imdForQR}`
        });
      } else {
        // 🔄 LOGIC CŨ: Tính toán bình thường dựa trên tổng tồn kho
        const fullUnits = Math.floor(totalQuantity / rollsOrBags);
        const remainingQuantity = totalQuantity % rollsOrBags;
        
        console.log('📦 In tem chuẩn - tính toán:', {
          fullUnits,
          remainingQuantity
        });
      
      // Add full units
      for (let i = 0; i < fullUnits; i++) {
        qrCodes.push({
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          unitNumber: rollsOrBags,
          qrData: `${material.materialCode}|${material.poNumber}|${rollsOrBags}|${imdForQR}`
        });
      }
      
      // Add remaining quantity if any
      if (remainingQuantity > 0) {
        qrCodes.push({
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          unitNumber: remainingQuantity,
          qrData: `${material.materialCode}|${material.poNumber}|${remainingQuantity}|${imdForQR}`
        });
        }
      }

      if (qrCodes.length === 0) {
        alert('❌ Vui lòng nhập đơn vị hợp lệ trước khi tạo QR code!');
        return;
      }

      console.log(`📦 Generated ${qrCodes.length} QR codes for ASM1${isPartialLabel ? ' (Tem lẻ)' : ' (Tem chuẩn)'}`);

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
      this.createQRPrintWindow(qrImages, material, isPartialLabel);
      
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

  // Reset function - Delete items with zero stock (runs in background, queries directly from Firebase)
  async resetZeroStock(): Promise<void> {
    // Show confirmation dialog first
      const confirmed = confirm(
        `🔄 RESET ASM1 INVENTORY\n\n` +
        `Bạn có muốn xóa tất cả mã hàng có tồn kho = 0 không?\n\n` +
        `⚠️ Hành động này không thể hoàn tác!\n\n` +
        `💡 Quá trình sẽ chạy ngầm, không ảnh hưởng đến hiệu suất.`
      );

      if (!confirmed) {
        return;
      }

      // Start background process
      this.isResetting = true;
      console.log('🗑️ Starting background reset for ASM1...');

      // Run in background (don't await, let it run async)
      this.performBackgroundReset().catch(error => {
        console.error('❌ Error during background reset:', error);
        alert(`❌ Lỗi khi reset ASM1: ${error.message}`);
        this.isResetting = false;
      });
  }

  // Background reset process - queries directly from Firebase
  private async performBackgroundReset(): Promise<void> {
    try {
      // Query all ASM1 materials directly from Firebase
      console.log('📡 Querying all ASM1 materials from Firebase...');
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', this.FACTORY)
      ).get().toPromise();

      if (!snapshot || snapshot.empty) {
        alert('✅ Không có mã hàng nào trong ASM1');
        this.isResetting = false;
        return;
      }

      console.log(`📦 Found ${snapshot.size} materials, checking for zero stock...`);

      // Calculate stock for each item and find zero stock items
      const zeroStockDocs: any[] = [];
      
      snapshot.docs.forEach(doc => {
        const data = doc.data() as any;
        const openingStock = data.openingStock !== null && data.openingStock !== undefined ? data.openingStock : 0;
        const quantity = data.quantity || 0;
        const exported = data.exported || 0;
        const xt = data.xt || 0;
        
        // Calculate current stock: openingStock + quantity - exported - xt
        const currentStock = openingStock + quantity - exported - xt;
        
        if (currentStock === 0) {
          zeroStockDocs.push(doc);
        }
      });

      if (zeroStockDocs.length === 0) {
        alert('✅ Không có mã hàng nào có tồn kho = 0 trong ASM1');
        this.isResetting = false;
        return;
      }

      console.log(`🗑️ Found ${zeroStockDocs.length} items with zero stock, starting deletion...`);

      // Delete items in batches
      const batchSize = 50;
      let deletedCount = 0;

      for (let i = 0; i < zeroStockDocs.length; i += batchSize) {
        const batch = this.firestore.firestore.batch();
        const currentBatch = zeroStockDocs.slice(i, i + batchSize);

        currentBatch.forEach(doc => {
          const docRef = this.firestore.collection('inventory-materials').doc(doc.id).ref;
          batch.delete(docRef);
        });

        await batch.commit();
        deletedCount += currentBatch.length;

        console.log(`✅ ASM1 Reset batch ${Math.floor(i/batchSize) + 1} completed: ${deletedCount}/${zeroStockDocs.length}`);

        // Small delay between batches to avoid overwhelming Firebase
        if (i + batchSize < zeroStockDocs.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      console.log(`✅ Reset completed! Deleted ${deletedCount} items with zero stock`);
      alert(`✅ Reset hoàn thành!\nĐã xóa ${deletedCount} mã hàng có tồn kho = 0 từ ASM1`);

      // Clear local data if it exists (optional, to keep UI in sync)
      if (this.inventoryMaterials.length > 0) {
        this.inventoryMaterials = this.inventoryMaterials.filter(item => {
          const stock = this.calculateCurrentStock(item);
          return stock !== 0;
        });
        this.applyFilters();
      }

      this.isResetting = false;

    } catch (error) {
      console.error('❌ Error during background reset:', error);
      alert(`❌ Lỗi khi reset ASM1: ${error.message}`);
      this.isResetting = false;
    }
  }

  // Create print window for QR codes - Using Inbound format
  private createQRPrintWindow(qrImages: any[], material: InventoryMaterial, isPartialLabel: boolean = false): void {
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
              font-size: 9.6px !important; /* Tăng 20% từ 8px */
              line-height: 1.1 !important;
              box-sizing: border-box !important;
              color: #000000 !important; /* Tất cả text màu đen */
            }
            
            .info-row {
              margin: 0.3mm 0 !important;
              font-weight: bold !important;
              color: #000000 !important; /* Tất cả text màu đen */
            }
            
            .info-row.small {
              font-size: 8.4px !important; /* Tăng 20% từ 7px */
              color: #000000 !important; /* Đổi từ #666 thành đen */
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
                font-size: 9.6px !important; /* Tăng 20% từ 8px */
                padding: 1mm !important;
                color: #000000 !important; /* Tất cả text màu đen */
              }
              
              .info-row.small {
                font-size: 8.4px !important; /* Tăng 20% từ 7px */
                color: #000000 !important; /* Đổi từ #666 thành đen */
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
    console.log(`✅ QR labels created for ASM1 with Inbound format - ${qrImages.length} labels${isPartialLabel ? ' (Tem lẻ)' : ' (Tem chuẩn)'}`);
  }

  // 🆕 Load catalog once when component initializes (no real-time updates)
  private async loadCatalogOnce(): Promise<void> {
    try {
      console.log('📦 Loading catalog once for Standard Packing...');
      
      const snapshot = await this.firestore.collection('materials')
        .ref
        .get();
      
      console.log(`📦 Loaded ${snapshot.size} catalog items`);
      
      // Clear existing cache
      this.catalogCache.clear();
      
      // Load all catalog data
      snapshot.forEach(doc => {
        const data = doc.data() as any;
        const materialCode = doc.id;
        
        if (data.standardPacking && data.standardPacking > 0) {
          this.catalogCache.set(materialCode, {
            materialCode: materialCode,
            materialName: data.materialName || 'N/A',
            unit: data.unit || 'N/A',
            standardPacking: data.standardPacking
          });
        }
      });
      
      this.catalogLoaded = true;
      console.log(`✅ Catalog loaded once: ${this.catalogCache.size} items with Standard Packing`);
      
      // Apply catalog data to existing inventory materials
      this.applyCatalogToInventory();
      
    } catch (error) {
      console.error('❌ Error loading catalog once:', error);
    }
  }

  // Apply catalog data to existing inventory materials
  private applyCatalogToInventory(): void {
    if (!this.catalogLoaded || this.inventoryMaterials.length === 0) {
      return;
    }
    
    console.log('🔄 Applying catalog data to inventory materials...');
    
    this.inventoryMaterials.forEach(material => {
      if (this.catalogCache.has(material.materialCode)) {
        const catalogData = this.catalogCache.get(material.materialCode)!;
        material.standardPacking = catalogData.standardPacking;
        material.materialName = catalogData.materialName;
        material.unit = catalogData.unit;
      }
    });
    
    // Refresh display
    this.filteredInventory = [...this.inventoryMaterials];
    console.log('✅ Catalog data applied to inventory materials');
  }

  // Gộp dòng tự động khi load toàn bộ inventory
  private async autoConsolidateOnLoad(): Promise<void> {
    try {
      console.log('🔄 Auto-consolidating duplicate materials on load...');
      
      // Sử dụng dữ liệu hiện tại
      const currentData = this.inventoryMaterials;
      const originalCount = currentData.length;
      const materialPoMap = new Map<string, InventoryMaterial[]>();
      
      currentData.forEach(material => {
        // Chỉ gộp dòng không phải từ inbound (source !== 'inbound')
        if (material.source === 'inbound') {
          console.log(`⏭️ Skipping inbound material: ${material.materialCode} - ${material.poNumber}`);
          return;
        }
        
        const key = `${material.materialCode}_${material.poNumber}`;
        if (!materialPoMap.has(key)) {
          materialPoMap.set(key, []);
        }
        materialPoMap.get(key)!.push(material);
      });
      
      const duplicateGroups = Array.from(materialPoMap.values()).filter(group => group.length > 1);
      const totalDuplicates = duplicateGroups.reduce((sum, group) => sum + group.length, 0);
      
      if (duplicateGroups.length === 0) {
        console.log('✅ No duplicates to consolidate');
        return;
      }
      
      console.log(`📊 Found ${duplicateGroups.length} duplicate groups with ${totalDuplicates} total items`);
      
      // Thực hiện gộp dòng
      const consolidatedMaterials: InventoryMaterial[] = [];
      const materialsToDelete: string[] = [];
      
      // Xử lý từng nhóm trùng lặp
      for (const group of duplicateGroups) {
        if (group.length === 1) continue;
        
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
        
        // Gộp location field
        const uniqueLocations = [...new Set(group.map(m => m.location).filter(loc => loc))];
        baseMaterial.location = uniqueLocations.join('; ');
        
        // Gộp type field
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
        console.log(`✅ Auto-consolidated: ${baseMaterial.materialCode} - PO ${baseMaterial.poNumber}`);
      }
      
      // Thêm các item không trùng lặp
      materialPoMap.forEach((group, key) => {
        if (group.length === 1) {
          consolidatedMaterials.push(group[0]);
        }
      });
      
      // Lưu vào Firebase
      console.log(`💾 Saving auto-consolidated materials to Firebase...`);
      
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
          console.log(`✅ Auto-updated: ${material.materialCode} - PO ${material.poNumber}`);
        }
      }
      
      // Xóa các item trùng lặp
      if (materialsToDelete.length > 0) {
        console.log(`🗑️ Auto-deleting ${materialsToDelete.length} duplicate items...`);
        
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
          console.log(`✅ Auto-deleted batch ${Math.floor(i/batchSize) + 1}: ${currentBatch.length} items`);
        }
      }
      
      // Cập nhật local data
      this.inventoryMaterials = consolidatedMaterials;
      this.filteredInventory = [...this.inventoryMaterials];
      
      const finalCount = this.inventoryMaterials.length;
      const reducedCount = originalCount - finalCount;
      
      console.log(`✅ Auto-consolidation completed: ${originalCount} → ${finalCount} items (reduced by ${reducedCount})`);
      
      // Hiển thị thông báo cho user
      if (reducedCount > 0) {
        this.consolidationMessage = `✅ Đã tự động gộp ${reducedCount} dòng trùng lặp khi load inventory. Từ ${originalCount} → ${finalCount} dòng.`;
        this.showConsolidationMessage = true;
        
        // Auto-hide message after 8 seconds
        setTimeout(() => {
          this.showConsolidationMessage = false;
        }, 8000);
      }
      
    } catch (error) {
      console.error('❌ Error during auto-consolidation:', error);
      // Không hiển thị error cho user vì đây là auto-process
    }
  }

  // Tiếp tục xử lý sau khi gộp dòng
  private continueAfterConsolidation(): void {
    // Sắp xếp FIFO: Material Code -> PO (oldest first)
    this.sortInventoryFIFO();
    
    // Mark duplicates for display
    this.markDuplicates();
    
    // 🔧 SIMPLIFIED: Exported quantity được lưu trực tiếp vào Firebase từ outbound scan
    console.log('✅ Exported quantities loaded directly from Firebase (no auto-update needed)');
    console.log(`🔍 DEBUG: First material exported: ${this.inventoryMaterials[0]?.exported || 0}`);
    
    this.isLoading = false;
    
    console.log(`✅ Loaded ${this.inventoryMaterials.length} ASM1 inventory items`);
    console.log(`🔍 DEBUG: After auto-update, first material exported: ${this.inventoryMaterials[0]?.exported || 0}`);
  }

  // Gộp toàn bộ dòng trùng lặp và lưu vào Firebase
  async consolidateAllInventory(): Promise<void> {
    try {
      // Hiển thị thống kê trước khi gộp
      const originalCount = this.inventoryMaterials.length;
      const materialPoMap = new Map<string, InventoryMaterial[]>();
      
      this.inventoryMaterials.forEach(material => {
        // Gộp theo Mã hàng + PO + Batch
        const key = `${material.materialCode}_${material.poNumber}_${material.batchNumber || 'NO_BATCH'}`;
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
      details += `🔍 Gộp theo: Mã hàng + PO + Batch\n\n`;
      duplicateGroups.forEach((group, index) => {
        const material = group[0];
        details += `${index + 1}. ${material.materialCode} - PO: ${material.poNumber} - Batch: ${material.batchNumber || 'NO_BATCH'} (${group.length} dòng)\n`;
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
        
        // Gộp location field
        const uniqueLocations = [...new Set(group.map(m => m.location).filter(loc => loc))];
        baseMaterial.location = uniqueLocations.join('; ');
        
        // Gộp type field
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
        if (material.id && materialPoMap.get(`${material.materialCode}_${material.poNumber}_${material.batchNumber || 'NO_BATCH'}`)!.length > 1) {
          // Đây là item đã gộp, cần update
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
          console.log(`✅ Updated: ${material.materialCode} - PO ${material.poNumber} - Batch ${material.batchNumber || 'NO_BATCH'}`);
        }
      }
      
      // Xóa các item trùng lặp
      if (materialsToDelete.length > 0) {
        console.log(`🗑️ Deleting ${materialsToDelete.length} duplicate items...`);
        
        // Xóa theo batch (Firestore limit: 500 operations per batch)
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
      
      // Sort và mark duplicates
      this.sortInventoryFIFO();
      this.markDuplicates();
      this.updateNegativeStockCount();
      
      // Hiển thị kết quả
      const finalCount = this.inventoryMaterials.length;
      const reducedCount = originalCount - finalCount;
      
      alert(`✅ GỘP DÒNG HOÀN TẤT!\n\n` +
        `📊 Kết quả:\n` +
        `• Tổng dòng trước: ${originalCount}\n` +
        `• Tổng dòng sau: ${finalCount}\n` +
        `• Đã gộp: ${reducedCount} dòng\n` +
        `• Số nhóm xử lý: ${duplicateGroups.length}\n\n` +
        `💾 Dữ liệu đã được lưu vào Firebase!\n` +
        `⚠️ Hành động này không thể hoàn tác.`);
      
      console.log(`✅ Consolidation completed: ${originalCount} → ${finalCount} items`);
      
    } catch (error) {
      console.error('❌ Error during consolidation:', error);
      alert(`❌ Lỗi khi gộp dòng: ${error.message}\n\nVui lòng thử lại!`);
    } finally {
      this.isLoading = false;
    }
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
        'Import Date': material.importDate ? (typeof material.importDate === 'string' ? material.importDate : material.importDate.toLocaleDateString('en-GB').split('/').join('')) : 'N/A',
        'Batch': material.batchNumber || '',
        'Material': material.materialCode || '',
        'Name': material.materialName || '',
        'PO': material.poNumber || '',
        'Opening Stock': material.openingStock !== null ? material.openingStock : '',
        'Qty': material.quantity || 0,
        'Unit': material.unit || '',
        'Exported': material.exported || 0,
        'XT': material.xt || 0,
        'Stock': (material.openingStock !== null ? material.openingStock : 0) + (material.quantity || 0) - (material.exported || 0) - (material.xt || 0),
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
        { wch: 12 },  // Opening Stock
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
    console.log(`🔍 DEBUG: Checking export history for ${material.materialCode} - PO: ${material.poNumber} - Location: ${material.location}`);
    console.log(`📊 Material details:`, {
      id: material.id,
      quantity: material.quantity,
      exported: material.exported,
      xt: material.xt,
      calculatedStock: this.calculateCurrentStock(material),
      location: material.location
    });

    // Kiểm tra trong collection outbound-materials - CHỈ LẤY THEO VỊ TRÍ CỤ THỂ
    this.firestore.collection('outbound-materials', ref => 
      ref.where('materialCode', '==', material.materialCode)
         .where('poNumber', '==', material.poNumber)
         .where('location', '==', material.location) // Thêm điều kiện vị trí để tránh nhân đôi
         .where('factory', '==', 'ASM1')
         .orderBy('exportDate', 'desc')
         .limit(10)
    ).get().subscribe(snapshot => {
      console.log(`📦 Found ${snapshot.docs.length} outbound records for ${material.materialCode} - ${material.poNumber} - Location ${material.location}`);
      
      snapshot.docs.forEach((doc, index) => {
        const data = doc.data() as any;
        console.log(`  ${index + 1}. Export: ${data.exportQuantity} from Location ${data.location} on ${data.exportDate?.toDate?.() || data.exportDate}`);
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
        console.log(`  ${index + 1}. ID: ${doc.id}, Location: ${data.location}, Exported: ${data.exported}, Stock: ${data.stock}, Updated: ${data.updatedAt?.toDate?.() || data.updatedAt}`);
      });
    });
  }


}
