import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { FactoryAccessService } from '../../services/factory-access.service';
import { TabPermissionService } from '../../services/tab-permission.service';


interface InventoryOverviewItem {
  id: string;
  materialCode: string;
  materialName?: string; // Thêm materialName
  poNumber: string;
  quantity: number;
  openingStock: number; // Thêm openingStock để giống RM1 Inventory
  exported: number;
  xt: number;
  location: string;
  type: string;
  currentStock: number;
  isNegative: boolean;
  factory?: string; // Thêm factory
  importDate?: string | Date; // Thêm importDate
  batchNumber?: string; // Thêm batchNumber
  // LinkQ fields
  linkQStock?: number;
  stockDifference?: number;
  hasDifference?: boolean;
}

interface LinkQFileInfo {
  id: string;
  fileName: string;
  uploadDate: Date;
  totalItems: number;
  processedItems: number;
  skippedItems: number;
  userId?: string;
  // Add actual LinkQ data storage
  linkQData?: { [materialCode: string]: number };
}

@Component({
  selector: 'app-inventory-overview-asm1',
  templateUrl: './inventory-overview-asm1.component.html',
  styleUrls: ['./inventory-overview-asm1.component.scss']
})
export class InventoryOverviewASM1Component implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  
  // Data
  inventoryItems: InventoryOverviewItem[] = [];
  filteredItems: InventoryOverviewItem[] = [];
  
  // Filter states
  showOnlyNegativeStock = false;
  searchTerm = '';
  
  // Filter mode states
  currentFilterMode: 'all' | 'negative' | 'linkq-difference' = 'all';
  
  // Group by states
  groupByType: 'po' | 'material' = 'po';
  isGroupByDropdownOpen = false;
  
  // More actions dropdown state
  isMoreActionsDropdownOpen = false;
  
  // LinkQ data
  linkQData: Map<string, number> = new Map(); // materialCode -> stock
  isLinkQDataLoaded = false;
  
  // LinkQ file management
  linkQFiles: LinkQFileInfo[] = [];
  currentLinkQFileId: string | null = null;
  
  // Loading states
  isLoading = false;
  isExporting = false;
  
  // Pagination
  currentPage = 1;
  itemsPerPage = 100;
  
  // Permissions
  hasAccess = false;
  
  constructor(
    private firestore: AngularFirestore,
    private factoryAccessService: FactoryAccessService,
    private tabPermissionService: TabPermissionService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    console.log('🚀 InventoryOverviewASM1Component initialized');
    this.checkPermissions();
    
    // Fallback: if permission check takes too long, load data anyway
    setTimeout(() => {
      if (this.inventoryItems.length === 0 && !this.isLoading) {
        console.log('⏰ Permission check timeout, loading data anyway...');
        this.loadInventoryOverview();
      }
    }, 3000); // 3 seconds timeout
    
    // 🔧 SỬA LỖI: Bỏ auto-refresh - chỉ load khi user F5
    // this.startAutoRefresh();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Check user permissions
  private async checkPermissions(): Promise<void> {
    try {
      console.log('🔐 Checking permissions for inventory-overview-asm1...');
      
      // Use canAccessTab method instead of checkTabPermission
      this.tabPermissionService.canAccessTab('inventory-overview-asm1').subscribe(
        (hasAccess: boolean) => {
          this.hasAccess = hasAccess;
          console.log(`🔐 Tab permission result for 'inventory-overview-asm1': ${this.hasAccess}`);
          
          if (!this.hasAccess) {
            console.warn('⚠️ User does not have access to this tab');
            // Still try to load data for debugging
            console.log('🔄 Attempting to load data anyway for debugging...');
            this.loadInventoryOverview();
            return;
          }
          
          // Load data after permission check
          this.loadInventoryOverview();
        },
        (error) => {
          console.error('❌ Error checking permissions:', error);
          this.hasAccess = false;
          // Fallback: try to load data anyway
          console.log('🔄 Permission check failed, attempting to load data anyway...');
          this.loadInventoryOverview();
        }
      );
    } catch (error) {
      console.error('❌ Error checking permissions:', error);
      this.hasAccess = false;
      // Fallback: try to load data anyway
      console.log('🔄 Permission check failed, attempting to load data anyway...');
      this.loadInventoryOverview();
    }
  }

  // Load inventory overview data
  // QUAN TRỌNG: Lấy dữ liệu từ TẤT CẢ các collection để đảm bảo RM1 Inventory Overview 
  // hiển thị chính xác những gì có trong RM1 Inventory (không dư, không thiếu)
  private async loadInventoryOverview(): Promise<void> {
    // Remove permission check for debugging
    // if (!this.hasAccess) return;
    
    this.isLoading = true;
    console.log('🔄 Loading inventory overview...');
    
    try {
      // Load LinkQ file history first
      await this.loadLinkQFileHistory();
      
      // 🔧 SỬA LỖI: Sử dụng real-time listener thay vì one-time snapshot
      // Để đảm bảo RM1 Overview cập nhật ngay lập tức khi có thay đổi từ RM1 Inventory
      console.log('🔍 Lấy dữ liệu từ collection inventory-materials với filter factory == ASM1...');
      
      // Sử dụng snapshotChanges() để có real-time updates
      // 🔧 SỬA LỖI: Bỏ orderBy để tránh cần index
      this.firestore.collection('inventory-materials', ref => 
        ref.where('factory', '==', 'ASM1')
      )
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((actions) => {
        console.log(`🔄 Real-time update: ${actions.length} ASM1 documents changed`);
        
        if (actions.length === 0) {
          console.log('ℹ️ Không tìm thấy dữ liệu ASM1 trong collection inventory-materials');
          this.inventoryItems = [];
          this.filteredItems = [];
          this.isLoading = false;
          return;
        }
        
        console.log(`✅ Real-time update: ${actions.length} ASM1 documents trong collection inventory-materials`);
        
        // Process real-time changes
        this.processInventoryData(actions);
      });
      
      return; // Exit early since we're using subscription
      
    } catch (error) {
      console.error('❌ Error loading inventory overview:', error);
      // Show error in UI
      this.inventoryItems = [];
      this.filteredItems = [];
      this.isLoading = false;
    }
  }

  // Process real-time inventory data changes
  private processInventoryData(actions: any[]): void {
    try {
      console.log(`📊 Processing ${actions.length} real-time changes...`);
      
      const items: InventoryOverviewItem[] = [];
      let validItemsCount = 0;
      let invalidItemsCount = 0;
      
      actions.forEach((action, index) => {
        const data = action.payload.doc.data() as any;
        const docId = action.payload.doc.id;
        const changeType = action.type;
        
        // Log first few documents for debugging
        if (index < 3) {
          console.log(`🔍 Real-time change ${index + 1} (${changeType}):`, {
            materialCode: data.materialCode,
            poNumber: data.poNumber,
            quantity: data.quantity,
            openingStock: data.openingStock,
            exported: data.exported,
            xt: data.xt,
            location: data.location,
            type: data.type
          });
        }
        
        // Skip deleted documents
        if (changeType === 'removed') {
          console.log(`🗑️ Document removed: ${docId}`);
          return;
        }
        
        // 🔍 FILTER: Loại bỏ dữ liệu scan sai
        const materialCode = data.materialCode || '';
        const poNumber = data.poNumber || '';
        
        // Debug cho mã B001239
        if (materialCode === 'B001239') {
          console.log(`🔍 DEBUG B001239 (PO: ${poNumber}):`, {
            openingStock: data.openingStock,
            quantity: data.quantity,
            exported: data.exported,
            xt: data.xt,
            calculatedStock: (data.openingStock || 0) + (data.quantity || 0) - (data.exported || 0) - (data.xt || 0)
          });
        }
        
        // Kiểm tra mã hàng hợp lệ (không phải số đơn giản như "25")
        if (!this.isValidMaterialCode(materialCode)) {
          console.log(`⚠️ Skipping invalid material code: "${materialCode}" (PO: ${poNumber})`);
          invalidItemsCount++;
          return; // Bỏ qua dòng này
        }
        
        // Kiểm tra PO hợp lệ
        if (!this.isValidPONumber(poNumber)) {
          console.log(`⚠️ Skipping invalid PO: "${poNumber}" (Material: ${materialCode})`);
          invalidItemsCount++;
          return; // Bỏ qua dòng này
        }
        
        // Sử dụng đúng field names từ collection inventory-materials
        const quantity = data.quantity || 0;
        const openingStock = data.openingStock || 0;
        const exported = data.exported || 0;
        const xt = data.xt || 0;
        
        // Tính toán current stock giống hệt như RM1 Inventory
        const currentStock = openingStock + quantity - exported - xt;
        
        // Debug cho mã B001627
        if (materialCode === 'B001627') {
          console.log(`🔍 DEBUG LOAD B001627:`, {
            poNumber: poNumber,
            openingStock: openingStock,
            quantity: quantity,
            exported: exported,
            xt: xt,
            currentStock: currentStock
          });
        }
        
        // Tạo item mới với LinkQ data nếu có
        const newItem: InventoryOverviewItem = {
          id: docId, // Sử dụng ID thật từ Firebase
          materialCode: materialCode,
          materialName: data.materialName || '', // Thêm materialName
          poNumber: poNumber,
          quantity: quantity,
          openingStock: openingStock,
          exported: exported,
          xt: xt,
          location: data.location || '',
          type: data.type || '',
          currentStock: currentStock,
          isNegative: currentStock < 0,
          factory: data.factory || 'ASM1', // Thêm factory
          importDate: data.importDate || '', // Thêm importDate
          batchNumber: data.batchNumber || '', // Thêm batchNumber
          // 🔧 SỬA LỖI: Xử lý LinkQ data trong real-time update
          linkQStock: undefined,
          stockDifference: undefined,
          hasDifference: undefined
        };
        
        // Nếu có LinkQ data, tính toán comparison
        if (this.isLinkQDataLoaded && this.linkQData.has(materialCode)) {
          const linkQStock = this.linkQData.get(materialCode)!;
          const roundedCurrentStock = Math.round(currentStock);
          const roundedLinkQStock = Math.round(linkQStock);
          
          newItem.linkQStock = roundedLinkQStock;
          newItem.stockDifference = roundedCurrentStock - roundedLinkQStock;
          
          // Chỉ hiện lệch > 1 hoặc < -1
          const absDifference = Math.abs(newItem.stockDifference);
          newItem.hasDifference = absDifference > 1;
          
          // Debug log cho một số items
          if (materialCode === 'B001627' || materialCode === 'B001239') {
            console.log(`🔍 REAL-TIME LINKQ ${materialCode}:`, {
              currentStock: currentStock,
              linkQStock: linkQStock,
              stockDifference: newItem.stockDifference,
              hasDifference: newItem.hasDifference
            });
          }
        }
        
        items.push(newItem);
        
        validItemsCount++;
      });
      
      console.log(`✅ Real-time update: ${validItemsCount} valid items, ${invalidItemsCount} invalid items skipped`);
      
      // Debug: Đếm items có LinkQ data
      const itemsWithLinkQ = items.filter(item => item.linkQStock !== undefined).length;
      const itemsWithDifference = items.filter(item => item.hasDifference).length;
      console.log(`📊 Real-time update: ${itemsWithLinkQ} items có LinkQ data, ${itemsWithDifference} items có lệch`);
      
      // Sort by material code then PO (FIFO)
      items.sort((a, b) => {
        if (a.materialCode !== b.materialCode) {
          return a.materialCode.localeCompare(b.materialCode);
        }
        return a.poNumber.localeCompare(b.poNumber);
      });
      
      this.inventoryItems = items;
      this.filteredItems = [...items];
      
      console.log(`✅ Real-time update: ${items.length} ASM1 inventory items từ collection inventory-materials`);
      console.log(`📊 Negative stock items: ${items.filter(item => item.isNegative).length}`);
      
      // Log negative stock items specifically
      const negativeItems = items.filter(item => item.isNegative);
      if (negativeItems.length > 0) {
        console.log('🔴 Negative stock items found:');
        negativeItems.forEach(item => {
          console.log(`  - ${item.materialCode} (PO: ${item.poNumber}): Stock = ${item.currentStock}`);
        });
      }
      
      // Apply filters to refresh display
      console.log(`🔄 Real-time update: Applying filters with mode ${this.currentFilterMode}, LinkQ loaded: ${this.isLinkQDataLoaded}`);
      this.applyFilters();
      
      // Force change detection
      this.cdr.detectChanges();
      
    } catch (error) {
      console.error('❌ Error processing real-time inventory data:', error);
    } finally {
      this.isLoading = false;
    }
  }

  // Toggle negative stock filter
  toggleNegativeStockFilter(): void {
    this.showOnlyNegativeStock = !this.showOnlyNegativeStock;
    this.applyFilters();
    console.log(`🔄 Toggled negative stock filter: ${this.showOnlyNegativeStock}`);
  }

  // Cycle through filter modes
  cycleFilterMode(): void {
    if (this.currentFilterMode === 'all') {
      this.currentFilterMode = 'negative';
    } else if (this.currentFilterMode === 'negative') {
      if (this.isLinkQDataLoaded) {
        this.currentFilterMode = 'linkq-difference';
      } else {
        this.currentFilterMode = 'all';
      }
    } else {
      this.currentFilterMode = 'all';
    }
    
    console.log(`🔄 Changed filter mode to: ${this.currentFilterMode}`);
    this.applyFilters();
  }

  // Get filter mode icon
  getFilterModeIcon(): string {
    switch (this.currentFilterMode) {
      case 'negative':
        return 'warning';
      case 'linkq-difference':
        return 'compare_arrows';
      default:
        return 'list';
    }
  }

  // Get filter mode text
  getFilterModeText(): string {
    switch (this.currentFilterMode) {
      case 'negative':
        return 'Chỉ mã âm';
      case 'linkq-difference':
        return 'Chỉ mã lệch LinkQ (>1)';
      default:
        return 'Tất cả';
    }
  }

  // Toggle group by dropdown
  toggleGroupByDropdown(): void {
    this.isGroupByDropdownOpen = !this.isGroupByDropdownOpen;
    console.log(`🔄 Toggled group by dropdown: ${this.isGroupByDropdownOpen}`);
  }

  // Toggle more actions dropdown
  toggleMoreActionsDropdown(): void {
    this.isMoreActionsDropdownOpen = !this.isMoreActionsDropdownOpen;
    console.log(`🔄 Toggled more actions dropdown: ${this.isMoreActionsDropdownOpen}`);
  }

  // Set group by type
  setGroupByType(type: 'po' | 'material'): void {
    console.log(`🔄 Changing group by type from ${this.groupByType} to ${type}`);
    
    this.groupByType = type;
    this.isGroupByDropdownOpen = false;
    this.isMoreActionsDropdownOpen = false; // Close more actions dropdown too
    
    // 🔧 SỬA LỖI: Nếu có LinkQ data và chuyển sang group by material, 
    // cần đảm bảo comparison được tính toán lại
    if (this.isLinkQDataLoaded && type === 'material') {
      console.log('🔍 LinkQ data detected, will recalculate comparison for material grouping');
    }
    
    this.applyFilters();
    console.log(`✅ Changed group by type to: ${type}`);
  }

  // Group data by material code (sum up quantities, clear PO)
  private groupByMaterialCode(items: InventoryOverviewItem[]): InventoryOverviewItem[] {
    const groupedMap = new Map<string, InventoryOverviewItem>();
    
    items.forEach(item => {
      if (groupedMap.has(item.materialCode)) {
        // Add quantities for same material code
        const existing = groupedMap.get(item.materialCode)!;
        const oldStock = existing.currentStock;
        
        existing.openingStock += item.openingStock || 0;
        existing.quantity += item.quantity;
        existing.exported += item.exported;
        existing.xt += item.xt;
        
        // 🔧 SỬA LỖI: Tính lại currentStock từ các thành phần đã cộng dồn
        existing.currentStock = existing.openingStock + existing.quantity - existing.exported - existing.xt;
        
        // Debug cho mã B001627 (từ hình ảnh)
        if (item.materialCode === 'B001627') {
          console.log(`🔍 DEBUG GROUP B001627:`, {
            poNumber: item.poNumber,
            itemStock: item.currentStock,
            oldGroupedStock: oldStock,
            newGroupedStock: existing.currentStock,
            openingStock: existing.openingStock,
            quantity: existing.quantity,
            exported: existing.exported,
            xt: existing.xt,
            linkQStock: existing.linkQStock,
            stockDifference: existing.stockDifference
          });
        }
        
        // 🔧 LÀM TRÒN SỐ: Làm tròn số tồn kho sau khi tính toán
        existing.currentStock = Math.round(existing.currentStock);
        existing.isNegative = existing.currentStock < 0;
        
        // 🔧 SỬA LỖI: LinkQ không được cộng dồn, chỉ giữ nguyên giá trị từ item đầu tiên
        // Vì LinkQ là dữ liệu từ hệ thống bên ngoài, không nên cộng dồn
        if (item.linkQStock !== undefined && existing.linkQStock === undefined) {
          // Chỉ set LinkQ nếu chưa có (từ item đầu tiên gặp mã này)
          existing.linkQStock = item.linkQStock;
          // Tính toán lại stockDifference dựa trên currentStock mới (đã cộng dồn)
          existing.stockDifference = existing.currentStock - existing.linkQStock;
          // Kiểm tra lại hasDifference - chỉ hiện các mã lệch lớn hơn 1 và -1
          const absDifference = Math.abs(existing.stockDifference);
          existing.hasDifference = absDifference > 1;
          
          // Debug log cho việc group by material
          console.log(`🔍 GROUP BY MATERIAL: ${item.materialCode}`, {
            poNumber: item.poNumber,
            itemLinkQ: item.linkQStock,
            groupedCurrentStock: existing.currentStock,
            groupedLinkQ: existing.linkQStock,
            stockDifference: existing.stockDifference
          });
        }
      } else {
        // Create new grouped item
        const groupedItem: InventoryOverviewItem = {
          id: item.materialCode, // Use material code as ID for grouped items
          materialCode: item.materialCode,
          materialName: item.materialName || '', // Thêm materialName
          poNumber: '', // Clear PO for grouped view
          quantity: item.quantity,
          openingStock: item.openingStock || 0, // Thêm openingStock
          exported: item.exported,
          xt: item.xt,
          location: item.location,
          type: item.type,
          currentStock: item.currentStock,
          isNegative: item.currentStock < 0,
          factory: item.factory || 'ASM1', // Thêm factory
          importDate: item.importDate || '', // Thêm importDate
          batchNumber: item.batchNumber || '', // Thêm batchNumber
          // Copy LinkQ data
          linkQStock: item.linkQStock,
          stockDifference: item.stockDifference,
          hasDifference: item.linkQStock !== undefined ? Math.abs(item.stockDifference || 0) > 1 : false
        };
        
        // Debug cho mã B001627 (từ hình ảnh)
        if (item.materialCode === 'B001627') {
          console.log(`🔍 DEBUG NEW GROUP B001627:`, {
            poNumber: item.poNumber,
            itemStock: item.currentStock,
            openingStock: item.openingStock,
            quantity: item.quantity,
            exported: item.exported,
            xt: item.xt,
            linkQStock: item.linkQStock,
            stockDifference: item.stockDifference
          });
        }
        
        groupedMap.set(item.materialCode, groupedItem);
      }
    });
    
    // 🔧 SỬA LỖI: Sau khi group, cần tính toán lại tất cả LinkQ comparison
    const groupedItems = Array.from(groupedMap.values());
    this.recalculateLinkQComparisonForGroupedItems(groupedItems);
    
    return groupedItems;
  }

  // Recalculate LinkQ comparison for grouped items
  private recalculateLinkQComparisonForGroupedItems(groupedItems: InventoryOverviewItem[]): void {
    console.log('🔍 Recalculating LinkQ comparison for grouped items...');
    
    let updatedCount = 0;
    let differenceCount = 0;
    
    groupedItems.forEach(item => {
      if (item.linkQStock !== undefined) {
        // 🔧 LÀM TRÒN SỐ: Làm tròn số tồn kho hiện tại thành số chẵn
        const roundedCurrentStock = Math.round(item.currentStock);
        const roundedLinkQStock = Math.round(item.linkQStock);
        
        // Tính toán lại stockDifference dựa trên currentStock mới (đã được cộng dồn)
        item.stockDifference = roundedCurrentStock - roundedLinkQStock;
        
        // Kiểm tra lại hasDifference - chỉ hiện các mã lệch lớn hơn 1 và -1
        const absDifference = Math.abs(item.stockDifference);
        item.hasDifference = absDifference > 1;
        
        // Debug log cho việc tính hasDifference
        if (item.materialCode === 'B001627' || item.materialCode === 'B001239') {
          console.log(`🔍 DEBUG HASDIFFERENCE ${item.materialCode}:`, {
            currentStock: item.currentStock,
            linkQStock: item.linkQStock,
            stockDifference: item.stockDifference,
            absDifference: absDifference,
            hasDifference: item.hasDifference
          });
        }
        
        if (item.hasDifference) {
          differenceCount++;
        }
        
        updatedCount++;
        
        // Log debug cho một số items đầu tiên
        if (updatedCount <= 5) {
          console.log(`🔍 Grouped ${item.materialCode}: Current=${item.currentStock}→${roundedCurrentStock}, LinkQ=${item.linkQStock}→${roundedLinkQStock}, Diff=${item.stockDifference}, HasDiff=${item.hasDifference}`);
        }
      }
    });
    
    console.log(`✅ LinkQ comparison recalculated for grouped items: ${updatedCount} items processed, ${differenceCount} items have differences`);
  }

  // Apply filters
  applyFilters(): void {
    console.log('🔍 Starting applyFilters...');
    console.log(`📊 Inventory items: ${this.inventoryItems.length}, LinkQ loaded: ${this.isLinkQDataLoaded}`);
    console.log(`🔍 Current filter mode: ${this.currentFilterMode}, Group by: ${this.groupByType}`);
    
    // 🔧 SỬA LỖI: Tạo deep copy để không làm mất dữ liệu LinkQ
    let filtered = this.inventoryItems.map(item => {
      const copy = { ...item };
      // Đảm bảo dữ liệu LinkQ được copy đúng
      copy.linkQStock = item.linkQStock;
      copy.stockDifference = item.stockDifference;
      copy.hasDifference = item.hasDifference;
      
      // 🔧 SỬA LỖI: Đảm bảo currentStock được copy đúng
      copy.currentStock = item.currentStock;
      
      return copy;
    });
    
    // 🔧 SỬA LỖI: Group by material TRƯỚC khi filter LinkQ difference
    // Để đảm bảo tất cả items có cùng mã hàng được cộng dồn trước khi filter
    if (this.groupByType === 'material') {
      const beforeGroup = filtered.length;
      filtered = this.groupByMaterialCode(filtered);
      console.log(`🔍 Material grouping (before filter): ${beforeGroup} → ${filtered.length} items`);
    }
    
    // Filter by current filter mode
    switch (this.currentFilterMode) {
      case 'negative':
        filtered = filtered.filter(item => item.isNegative);
        console.log(`🔍 Negative filter: ${filtered.length} items`);
        break;
      case 'linkq-difference':
        if (this.isLinkQDataLoaded) {
          // 🔧 SỬA LỖI: Chỉ hiện các dòng lệch từ số 1 và -1 (loại bỏ từ -1 đến 1)
          const beforeFilter = filtered.length;
          filtered = filtered.filter(item => {
            if (item.stockDifference === undefined) return false;
            const absDifference = Math.abs(item.stockDifference);
            
            // Debug cho B001627
            if (item.materialCode === 'B001627') {
              console.log(`🔍 DEBUG FILTER B001627:`, {
                currentStock: item.currentStock,
                linkQStock: item.linkQStock,
                stockDifference: item.stockDifference,
                absDifference: absDifference,
                willShow: absDifference > 1
              });
            }
            
            return absDifference > 1; // Chỉ hiện lệch > 1 hoặc < -1
          });
          console.log(`🔍 LinkQ difference filter: ${beforeFilter} → ${filtered.length} items (only differences > 1 or < -1)`);
        } else {
          console.log('⚠️ LinkQ data not loaded, cannot filter by differences');
        }
        break;
      default:
        // 'all' - no additional filtering
        console.log(`🔍 All items filter: ${filtered.length} items`);
        break;
    }
    
    // Filter by search term
    if (this.searchTerm.trim()) {
      const searchLower = this.searchTerm.toLowerCase();
      const beforeSearch = filtered.length;
      filtered = filtered.filter(item => 
        item.materialCode.toLowerCase().includes(searchLower) ||
        item.poNumber.toLowerCase().includes(searchLower)
      );
      console.log(`🔍 Search filter: ${beforeSearch} → ${filtered.length} items`);
    }
    
    // If groupByType === 'po', keep original structure (no grouping needed)
    
    
    this.filteredItems = filtered;
    this.currentPage = 1; // Reset to first page
    
    // 🔧 SỬA LỖI: Kiểm tra dữ liệu LinkQ sau khi filter
    const itemsWithLinkQ = filtered.filter(item => item.linkQStock !== undefined).length;
    const itemsWithDifference = filtered.filter(item => item.hasDifference).length;
    
    // Debug cho B001627
    const b001627Item = filtered.find(item => item.materialCode === 'B001627');
    if (b001627Item) {
      console.log(`🔍 DEBUG FINAL B001627:`, {
        currentStock: b001627Item.currentStock,
        linkQStock: b001627Item.linkQStock,
        stockDifference: b001627Item.stockDifference,
        hasDifference: b001627Item.hasDifference,
        filterMode: this.currentFilterMode
      });
    }
    
    console.log(`✅ Applied filters: ${filtered.length} items shown`);
    console.log(`📊 LinkQ data preserved: ${itemsWithLinkQ} items have LinkQ data`);
    console.log(`📊 Items with differences: ${itemsWithDifference} items`);
    console.log(`🔍 Filter mode: ${this.currentFilterMode}, Group by: ${this.groupByType}`);
    
  }

  // Clear search
  clearSearch(): void {
    this.searchTerm = '';
    this.currentFilterMode = 'all'; // Reset to show all items
    this.groupByType = 'po'; // Reset to PO view
    this.isGroupByDropdownOpen = false; // Close group by dropdown
    this.isMoreActionsDropdownOpen = false; // Close more actions dropdown
    this.applyFilters();
  }

  // Get paginated items
  get paginatedItems(): InventoryOverviewItem[] {
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    return this.filteredItems.slice(startIndex, endIndex);
  }

  // Get total pages
  get totalPages(): number {
    return Math.ceil(this.filteredItems.length / this.itemsPerPage);
  }

  // Change page
  changePage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
    }
  }

  // Get negative stock count
  get negativeStockCount(): number {
    return this.inventoryItems.filter(item => item.isNegative).length;
  }

  // Get total items count
  get totalItemsCount(): number {
    return this.inventoryItems.length;
  }

  // Get LinkQ difference count
  get linkQDifferenceCount(): number {
    if (!this.isLinkQDataLoaded) return 0;
    return this.inventoryItems.filter(item => item.hasDifference).length;
  }

  // Export to Excel
  async exportToExcel(): Promise<void> {
    if (this.filteredItems.length === 0) {
      console.warn('⚠️ No data to export');
      return;
    }

    const XLSX = await import('xlsx');
    try {
      console.log('📊 Exporting to Excel...');
      
      // Prepare data for export
      const exportData = this.filteredItems.map(item => {
        const row: any = {
          'Mã hàng': item.materialCode
        };
        
        if (this.groupByType === 'po') {
          row['PO'] = item.poNumber;
        }
        
        row['Tồn kho'] = item.currentStock;
        row['Vị trí'] = item.location || '-';
        
        if (this.isLinkQDataLoaded) {
          row['LinkQ'] = item.linkQStock !== undefined ? item.linkQStock : '-';
          row['So Sánh'] = item.stockDifference !== undefined ? item.stockDifference : '-';
        }
        
        return row;
      });

      // Create workbook and worksheet
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(exportData);

      // Auto-size columns
      const colWidths = [
        { wch: 15 }, // Mã hàng
        ...(this.groupByType === 'po' ? [{ wch: 15 }] : []), // PO (if applicable)
        { wch: 12 }, // Tồn kho
        { wch: 15 }, // Vị trí
        ...(this.isLinkQDataLoaded ? [{ wch: 12 }, { wch: 12 }] : []) // LinkQ, So Sánh (if applicable)
      ];
      ws['!cols'] = colWidths;

      // Add worksheet to workbook
      const sheetName = this.groupByType === 'po' ? 'RM1_Inventory_PO' : 'RM1_Inventory_Material';
      XLSX.utils.book_append_sheet(wb, ws, sheetName);

      // Generate filename
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const filename = `${sheetName}_${timestamp}.xlsx`;

      // Save file
      XLSX.writeFile(wb, filename);
      
      console.log(`✅ Excel exported successfully: ${filename}`);
    } catch (error) {
      console.error('❌ Error exporting to Excel:', error);
    }
  }

  // Download full report with all data
  async downloadFullReport(): Promise<void> {
    if (this.inventoryItems.length === 0) {
      console.warn('⚠️ No data to export');
      alert('⚠️ Không có dữ liệu để tải báo cáo');
      return;
    }

    const XLSX = await import('xlsx');
    try {
      console.log('📊 Downloading full report...');
      
      // Prepare comprehensive data for export
      const exportData = this.inventoryItems.map(item => {
        const row: any = {
          'Mã hàng': item.materialCode,
          'Tên hàng': item.materialName || '',
          'PO': item.poNumber || '',
          'Tồn đầu': item.openingStock || 0,
          'NK': item.quantity || 0,
          'Đã xuất': item.exported || 0,
          'XT': item.xt || 0,
          'Tồn kho': item.currentStock,
          'Vị trí': item.location || '-',
          'Loại hình': item.type || '',
          'Factory': item.factory || 'ASM1',
          'Ngày nhập': item.importDate ? (typeof item.importDate === 'string' ? item.importDate : (item.importDate instanceof Date ? item.importDate.toLocaleDateString('vi-VN') : String(item.importDate))) : '-',
          'Batch': item.batchNumber || '',
          'Trạng thái': item.isNegative ? 'Tồn kho âm' : 'Bình thường'
        };
        
        if (this.isLinkQDataLoaded) {
          row['LinkQ Stock'] = item.linkQStock !== undefined ? item.linkQStock : '-';
          row['Chênh lệch'] = item.stockDifference !== undefined ? item.stockDifference : '-';
          row['Có lệch'] = item.hasDifference ? 'Có' : 'Không';
        }
        
        return row;
      });

      // Create workbook and worksheet
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(exportData);

      // Set column widths for better readability
      const colWidths = [
        { wch: 15 }, // Mã hàng
        { wch: 25 }, // Tên hàng
        { wch: 15 }, // PO
        { wch: 12 }, // Tồn đầu
        { wch: 12 }, // NK
        { wch: 12 }, // Đã xuất
        { wch: 12 }, // XT
        { wch: 12 }, // Tồn kho
        { wch: 15 }, // Vị trí
        { wch: 12 }, // Loại hình
        { wch: 10 }, // Factory
        { wch: 12 }, // Ngày nhập
        { wch: 15 }, // Batch
        { wch: 15 }, // Trạng thái
        ...(this.isLinkQDataLoaded ? [{ wch: 12 }, { wch: 12 }, { wch: 10 }] : []) // LinkQ columns
      ];
      ws['!cols'] = colWidths;

      // Add worksheet to workbook
      const sheetName = 'RM1_Inventory_Full_Report';
      XLSX.utils.book_append_sheet(wb, ws, sheetName);

      // Generate filename
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const filename = `RM1_Inventory_Full_Report_${timestamp}.xlsx`;

      // Save file
      XLSX.writeFile(wb, filename);
      
      console.log(`✅ Full report downloaded successfully: ${filename}`);
      alert(`✅ Đã tải báo cáo đầy đủ: ${filename}\n\n📊 Tổng số dòng: ${exportData.length}\n📅 Thời gian: ${new Date().toLocaleString('vi-VN')}`);
    } catch (error) {
      console.error('❌ Error downloading full report:', error);
      alert('❌ Lỗi khi tải báo cáo: ' + error.message);
    }
  }

  // Refresh data
  refreshData(): void {
    console.log('🔄 Manual refresh requested');
    
    // If LinkQ data is loaded, ask user if they want to refresh
    if (this.isLinkQDataLoaded) {
      const shouldRefresh = confirm(
        '⚠️ Bạn đang có dữ liệu LinkQ để so sánh.\n\n' +
        'Nếu refresh, dữ liệu LinkQ sẽ bị mất và bạn cần load lại.\n\n' +
        'Bạn có chắc muốn refresh không?\n\n' +
        '• Nhấn OK để refresh (mất dữ liệu LinkQ)\n' +
        '• Nhấn Cancel để giữ nguyên dữ liệu LinkQ'
      );
      
      if (shouldRefresh) {
        // Clear LinkQ data and refresh
        this.clearLinkQData();
        this.loadInventoryOverview();
      } else {
        console.log('⏸️ User cancelled refresh to preserve LinkQ data');
      }
    } else {
      // No LinkQ data, safe to refresh
      this.loadInventoryOverview();
    }
  }

  // Clear LinkQ data
  private clearLinkQData(): void {
    console.log('🗑️ Clearing LinkQ data...');
    this.linkQData.clear();
    this.isLinkQDataLoaded = false;
    this.currentLinkQFileId = null;
    
    // Clear LinkQ data from all items
    this.inventoryItems.forEach(item => {
      item.linkQStock = undefined;
      item.stockDifference = undefined;
      item.hasDifference = undefined;
    });
    
    this.filteredItems.forEach(item => {
      item.linkQStock = undefined;
      item.stockDifference = undefined;
      item.hasDifference = undefined;
    });
    
    console.log('✅ LinkQ data cleared');
  }
  

  // 🔧 Force refresh LinkQ data (fix cho dữ liệu bị mất)
  forceRefreshLinkQData(): void {
    try {
      console.log('🔄 Force refreshing LinkQ data...');
      
      if (this.linkQFiles.length === 0) {
        console.log('⚠️ No LinkQ files available');
        return;
      }
      
      // Load lại dữ liệu LinkQ từ file gần nhất
      this.autoLoadMostRecentLinkQData().then(() => {
        // Update stock comparison silently to avoid page reload
        this.updateStockComparisonSilently();
        
        // Apply filters để refresh display
        this.applyFilters();
        
        console.log('✅ LinkQ data force refreshed successfully');
      });
      
    } catch (error) {
      console.error('❌ Error force refreshing LinkQ data:', error);
    }
  }

  // Refresh LinkQ data without losing current data
  refreshLinkQDataOnly(): void {
    try {
      console.log('🔄 Refreshing LinkQ data only...');
      
      if (this.linkQFiles.length === 0) {
        console.log('⚠️ No LinkQ files available');
        return;
      }
      
      // Load lại dữ liệu LinkQ từ file gần nhất
      this.autoLoadMostRecentLinkQData().then(() => {
        // Update stock comparison silently to avoid page reload
        this.updateStockComparisonSilently();
        
        // Apply filters để refresh display
        this.applyFilters();
        
        console.log('✅ LinkQ data refreshed successfully without losing current data');
      });
      
    } catch (error) {
      console.error('❌ Error refreshing LinkQ data:', error);
    }
  }

  // Recalculate LinkQ comparison for current view (useful when switching between PO and Material views)
  recalculateLinkQComparison(): void {
    try {
      console.log('🔍 Manually recalculating LinkQ comparison...');
      
      if (!this.isLinkQDataLoaded) {
        console.log('⚠️ No LinkQ data loaded, nothing to recalculate');
        return;
      }
      
      if (this.groupByType === 'material') {
        // Nếu đang group by material, cần recalculate cho grouped items
        this.recalculateLinkQComparisonForGroupedItems(this.filteredItems);
      } else {
        // Nếu đang group by PO, sử dụng method thông thường
        this.updateStockComparisonSilently();
      }
      
      // Apply filters để refresh display
      this.applyFilters();
      
      console.log('✅ LinkQ comparison recalculated successfully');
      
    } catch (error) {
      console.error('❌ Error recalculating LinkQ comparison:', error);
    }
  }
  
  // 🔧 SỬA LỖI: Bỏ auto refresh hoàn toàn - chỉ load khi user F5
  // Với real-time listener, không cần auto refresh nữa
  private startAutoRefresh(): void {
    console.log('ℹ️ Auto-refresh disabled - data will only refresh when user manually refreshes page');
    // Bỏ auto refresh hoàn toàn
  }

  // Import LinkQ stock data
  async importLinkQData(): Promise<void> {
    try {
      console.log('📥 Importing LinkQ stock data...');
      
      // Create file input element
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.xlsx,.xls,.csv';
      fileInput.style.display = 'none';
      
      fileInput.onchange = async (event: any) => {
        const file = event.target.files[0];
        if (!file) return;
        
        try {
          // Read Excel file
          const data = await this.readLinkQExcelFile(file);
          console.log('📊 LinkQ Excel data read:', data);
          
          // Process LinkQ data
          await this.processLinkQData(data, file.name);
          
          // Update stock comparison silently to avoid page reload
          this.updateStockComparisonSilently();
          
          // Show success message
          alert(`✅ Đã import thành công dữ liệu LinkQ!\n\n📦 Tổng số mã hàng: ${this.linkQData.size}\n🔄 Dữ liệu cũ đã được ghi đè hoàn toàn\n🔍 Hệ thống sẽ so sánh với tồn kho hiện tại\n\n📊 Lưu ý: Tất cả số liệu đều được làm tròn thành số chẵn để so sánh chính xác\n\n⚠️ Kiểm tra console để xem chi tiết duplicate (nếu có)`);
          
        } catch (error) {
          console.error('❌ Error importing LinkQ data:', error);
          alert('❌ Lỗi khi import dữ liệu LinkQ: ' + error.message);
        } finally {
          // Remove file input
          document.body.removeChild(fileInput);
        }
      };
      
      // Trigger file selection
      document.body.appendChild(fileInput);
      fileInput.click();
      
    } catch (error) {
      console.error('❌ Error in importLinkQData:', error);
      alert('❌ Lỗi khi import dữ liệu LinkQ: ' + error.message);
    }
  }

  // Download LinkQ Excel template
  async downloadLinkQTemplate(): Promise<void> {
    const XLSX = await import('xlsx');
    try {
      console.log('📥 Downloading LinkQ template...');
      
      // Create sample data for template
      const templateData = [
        {
          'Mã hàng': 'B001003',
          'Tồn kho': 100
        },
        {
          'Mã hàng': 'P0123',
          'Tồn kho': 50
        },
        {
          'Mã hàng': 'B018694',
          'Tồn kho': 200
        },
        {
          'Mã hàng': 'A001234',
          'Tồn kho': 75
        },
        {
          'Mã hàng': 'C005678',
          'Tồn kho': 150
        }
      ];
      
      // Create workbook and worksheet
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(templateData);
      
      // Set column widths
      worksheet['!cols'] = [
        { width: 20 },  // Mã hàng
        { width: 15 }   // Tồn kho
      ];
      
      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(workbook, worksheet, 'LinkQ Template');
      
      // Generate file and download
      const fileName = `LinkQ_Template_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      
      console.log('✅ LinkQ template downloaded successfully');
      alert('✅ Đã tải template LinkQ!\n\n📋 Template có 2 cột:\n• Mã hàng: Mã sản phẩm\n• Tồn kho: Số lượng tồn kho\n\n💡 Bạn có thể copy dữ liệu từ hệ thống LinkQ vào template này để import.');
      
    } catch (error) {
      console.error('❌ Error downloading template:', error);
      alert('❌ Lỗi khi tải template: ' + error.message);
    }
  }

  // Download LinkQ comparison report
  async downloadLinkQComparisonReport(): Promise<void> {
    const XLSX = await import('xlsx');
    try {
      if (!this.isLinkQDataLoaded) {
        alert('⚠️ Vui lòng import dữ liệu LinkQ trước khi tải báo cáo so sánh!');
        return;
      }

      console.log('📊 Downloading LinkQ comparison report...');
      
      let comparisonData;
      let colWidths;
      let fileName;
      
      if (this.groupByType === 'material') {
        // Export grouped by material code (no PO column)
        comparisonData = this.filteredItems.map(item => {
          const linkQStock = item.linkQStock || 0;
          const stockDifference = item.currentStock - linkQStock;
          const hasDifference = stockDifference > 1 || stockDifference < -1;
          
          return {
            'Mã hàng': item.materialCode,
            'Tồn kho hiện tại': item.currentStock,
            'Tồn kho LinkQ': linkQStock,
            'Chênh lệch': stockDifference,
            'Có lệch': hasDifference ? 'Có' : 'Không',
            'Ghi chú': hasDifference ? 
              (stockDifference > 0 ? 'Hệ thống > LinkQ' : 'Hệ thống < LinkQ') : 
              'Không có lệch'
          };
        });
        
        // Set column widths for material view
        colWidths = [
          { wch: 15 },  // Mã hàng
          { wch: 18 },  // Tồn kho hiện tại
          { wch: 18 },  // Tồn kho LinkQ
          { wch: 15 },  // Chênh lệch
          { wch: 12 },  // Có lệch
          { wch: 25 }   // Ghi chú
        ];
        
        fileName = `LinkQ_Comparison_Report_Material_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.xlsx`;
        
      } else {
        // Export by PO (original format with PO column)
        comparisonData = this.filteredItems.map(item => {
          const linkQStock = item.linkQStock || 0;
          const stockDifference = item.currentStock - linkQStock;
          const hasDifference = stockDifference > 1 || stockDifference < -1;
          
          return {
            'Mã hàng': item.materialCode,
            'PO': item.poNumber,
            'Tồn kho hiện tại': item.currentStock,
            'Tồn kho LinkQ': linkQStock,
            'Chênh lệch': stockDifference,
            'Có lệch': hasDifference ? 'Có' : 'Không',
            'Ghi chú': hasDifference ? 
              (stockDifference > 0 ? 'Hệ thống > LinkQ' : 'Hệ thống < LinkQ') : 
              'Không có lệch'
          };
        });
        
        // Set column widths for PO view
        colWidths = [
          { wch: 15 },  // Mã hàng
          { wch: 20 },  // PO
          { wch: 18 },  // Tồn kho hiện tại
          { wch: 18 },  // Tồn kho LinkQ
          { wch: 15 },  // Chênh lệch
          { wch: 12 },  // Có lệch
          { wch: 25 }   // Ghi chú
        ];
        
        fileName = `LinkQ_Comparison_Report_PO_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.xlsx`;
      }
      
      // Create workbook and worksheet
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(comparisonData);
      
      // Set column widths
      worksheet['!cols'] = colWidths;
      
      // Add worksheet to workbook
      const sheetName = this.groupByType === 'material' ? 'So Sánh LinkQ (Theo Mã Hàng)' : 'So Sánh LinkQ (Theo PO)';
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
      
      // Generate file and download
      XLSX.writeFile(workbook, fileName);
      
      // Calculate summary statistics
      const totalItems = comparisonData.length;
      const itemsWithDifference = comparisonData.filter(item => item['Có lệch'] === 'Có').length;
      const positiveDifferences = comparisonData.filter(item => item['Chênh lệch'] > 0).length;
      const negativeDifferences = comparisonData.filter(item => item['Chênh lệch'] < 0).length;
      
      console.log(`✅ LinkQ comparison report downloaded successfully (${this.groupByType} view)`);
      alert(`✅ Đã tải báo cáo so sánh LinkQ!\n\n📊 Thống kê (${this.groupByType === 'material' ? 'Theo Mã Hàng' : 'Theo PO'}):\n• Tổng mã hàng: ${totalItems}\n• Mã có lệch: ${itemsWithDifference}\n• Lệch dương: ${positiveDifferences}\n• Lệch âm: ${negativeDifferences}\n\n📁 File: ${fileName}`);
      
    } catch (error) {
      console.error('❌ Error downloading comparison report:', error);
      alert('❌ Lỗi khi tải báo cáo so sánh: ' + error.message);
    }
  }

  // Read LinkQ Excel file
  private async readLinkQExcelFile(file: File): Promise<any[]> {
    const XLSX = await import('xlsx');
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

  // Process LinkQ data from Excel
  private async processLinkQData(data: any[], fileName: string): Promise<void> {
    try {
      // Clear old LinkQ data completely before processing new data
      this.linkQData.clear();
      
      // Reset LinkQ-related fields in all inventory items
      this.inventoryItems.forEach(item => {
        item.linkQStock = undefined;
        item.stockDifference = undefined;
        item.hasDifference = undefined;
      });
      
      // Reset LinkQ data loaded flag
      this.isLinkQDataLoaded = false;
      
      console.log('🧹 Cleared old LinkQ data, processing new import...');
      
      // Delete old LinkQ files from Firebase
      await this.deleteOldLinkQFiles();
      
      // Debug: Log the first few rows to see actual column names
      if (data.length > 0) {
        console.log('🔍 DEBUG: First row structure:', data[0]);
        console.log('🔍 DEBUG: Available column names:', Object.keys(data[0]));
        
        // Log first 3 rows for debugging
        data.slice(0, 3).forEach((row, index) => {
          console.log(`🔍 DEBUG: Row ${index + 1}:`, row);
        });
        
        // 🔧 KIỂM TRA DUPLICATE: Phân tích file Excel trước khi xử lý
        this.analyzeExcelDuplicates(data);
      }
      
      let processedCount = 0;
      let skippedCount = 0;
      let duplicateCount = 0;
      
      // 🔧 SỬA LỖI: Tạo Map để track duplicate material codes
      const materialCodeCount = new Map<string, number>();
      
      data.forEach((row, index) => {
        // Try multiple possible column names for material code
        const materialCode = row['Mã hàng'] || 
                            row['materialCode'] || 
                            row['Mã'] || 
                            row['Code'] || 
                            row['Material'] || 
                            row['Item'] ||
                            row['Part'] ||
                            row['SKU'] ||
                            row['Product'] ||
                            row['Item Code'] ||
                            row['Part Number'] ||
                            row['Material Code'] ||
                            row['Product Code'] ||
                            '';
        
        // Try multiple possible column names for stock/quantity
        let stock = parseFloat(row['Tồn kho'] || 
                                row['stock'] || 
                                row['Stock'] || 
                                row['Số lượng'] || 
                                row['Quantity'] || 
                                row['Qty'] ||
                                row['Amount'] ||
                                row['Total'] ||
                                row['Available'] ||
                                row['On Hand'] ||
                                row['Inventory'] ||
                                row['Balance'] ||
                                '0') || 0;
        
        // 🔧 LÀM TRÒN SỐ: Làm tròn số từ file LinkQ thành số chẵn
        stock = Math.round(stock);
        
        if (materialCode && materialCode.toString().trim() !== '') {
          const trimmedCode = materialCode.toString().trim();
          
          // 🔧 SỬA LỖI: Kiểm tra duplicate trong file Excel
          if (materialCodeCount.has(trimmedCode)) {
            const currentCount = materialCodeCount.get(trimmedCode)!;
            materialCodeCount.set(trimmedCode, currentCount + 1);
            duplicateCount++;
            
            console.log(`⚠️ DUPLICATE: Material code "${trimmedCode}" appears ${currentCount + 1} times in Excel file (row ${index + 1})`);
            
            // Có thể chọn: ghi đè, cộng dồn, hoặc bỏ qua
            // Hiện tại: ghi đè với giá trị mới nhất
            this.linkQData.set(trimmedCode, stock);
            console.log(`🔄 Overwrote with latest value: ${trimmedCode} -> ${stock}`);
          } else {
            // Lần đầu tiên gặp mã này
            materialCodeCount.set(trimmedCode, 1);
            this.linkQData.set(trimmedCode, stock);
            processedCount++;
            
            // Log first few successful items for debugging
            if (processedCount <= 5) {
              console.log(`✅ DEBUG: Processed item ${processedCount}: ${trimmedCode} -> ${stock}`);
            }
          }
        } else {
          skippedCount++;
          
          // Log first few skipped items for debugging
          if (skippedCount <= 5) {
            console.log(`⚠️ DEBUG: Skipped row ${index + 1}: materialCode="${materialCode}", stock="${stock}"`);
          }
        }
      });
      
      // Save file info to Firebase
      await this.saveLinkQFileToFirebase(fileName, data.length, processedCount, skippedCount);
      
      this.isLinkQDataLoaded = true;
      console.log(`✅ Processed ${processedCount} unique LinkQ items, skipped ${skippedCount} rows, found ${duplicateCount} duplicates`);
      console.log(`🔄 New LinkQ data has completely replaced old data and saved to Firebase`);
      
      // Log some sample data for verification
      if (this.linkQData.size > 0) {
        const sampleItems = Array.from(this.linkQData.entries()).slice(0, 5);
        console.log('🔍 DEBUG: Sample processed items:', sampleItems);
      }
    } catch (error) {
      console.error('❌ Error processing LinkQ data:', error);
      throw error;
    }
  }

  // Update stock comparison between current system and LinkQ
  private updateStockComparison(): void {
    console.log('🔍 Starting stock comparison update...');
    console.log(`📊 LinkQ data size: ${this.linkQData.size}`);
    
    let updatedCount = 0;
    let differenceCount = 0;
    
    this.inventoryItems.forEach(item => {
      const linkQStock = this.linkQData.get(item.materialCode);
      
      // Kiểm tra nếu có dữ liệu LinkQ
      if (linkQStock !== undefined) {
        // 🔧 LÀM TRÒN SỐ: Làm tròn số tồn kho hiện tại thành số chẵn
        const roundedCurrentStock = Math.round(item.currentStock);
        const roundedLinkQStock = Math.round(linkQStock);
        
        item.linkQStock = roundedLinkQStock;
        item.stockDifference = roundedCurrentStock - roundedLinkQStock;
        
        // 🔧 SỬA LỖI SO SÁNH: Chỉ tính lệch khi chênh lệch >= 1 hoặc <= -1
        // Bỏ qua các chênh lệch nhỏ từ -0.99 đến 0.99
        const absDifference = Math.abs(item.stockDifference);
        item.hasDifference = absDifference > 1;
        
        if (item.hasDifference) {
          differenceCount++;
        }
        
        updatedCount++;
        
        // Log debug cho một số items đầu tiên
        if (updatedCount <= 5) {
          console.log(`🔍 ${item.materialCode}: Current=${item.currentStock}→${roundedCurrentStock}, LinkQ=${linkQStock}→${roundedLinkQStock}, Diff=${item.stockDifference}, HasDiff=${item.hasDifference}`);
        }
      } else {
        // Không có dữ liệu LinkQ
        item.linkQStock = undefined;
        item.stockDifference = undefined;
        item.hasDifference = undefined;
      }
    });
    
    console.log(`✅ Stock comparison updated: ${updatedCount} items processed, ${differenceCount} items have differences`);
    
    // 🔧 SỬA LỖI: KHÔNG gọi applyFilters() ở đây để tránh mất dữ liệu LinkQ
    // this.applyFilters(); // Commented out to prevent data loss
  }

  // Update stock comparison silently without triggering page reload
  private updateStockComparisonSilently(): void {
    console.log('🔍 Starting silent stock comparison update...');
    console.log(`📊 LinkQ data size: ${this.linkQData.size}`);
    
    // 🔧 DEBUG: Kiểm tra LinkQ data
    if (this.linkQData.size === 0) {
      console.log('⚠️ WARNING: LinkQ data is empty! This means no LinkQ data was loaded.');
      console.log('🔍 Checking if LinkQ data exists in Firebase...');
      return;
    }
    
    // Debug: Log first few LinkQ entries
    const linkQEntries = Array.from(this.linkQData.entries()).slice(0, 5);
    console.log('🔍 DEBUG: First few LinkQ entries:', linkQEntries);
    
    let updatedCount = 0;
    let differenceCount = 0;
    
    // Update both inventoryItems and filteredItems to maintain consistency
    [this.inventoryItems, this.filteredItems].forEach(itemsArray => {
      itemsArray.forEach(item => {
        const linkQStock = this.linkQData.get(item.materialCode);
        
        // Kiểm tra nếu có dữ liệu LinkQ
        if (linkQStock !== undefined) {
          // 🔧 LÀM TRÒN SỐ: Làm tròn số tồn kho hiện tại thành số chẵn
          const roundedCurrentStock = Math.round(item.currentStock);
          const roundedLinkQStock = Math.round(linkQStock);
          
          item.linkQStock = roundedLinkQStock;
          item.stockDifference = roundedCurrentStock - roundedLinkQStock;
          
          // Chỉ tính lệch khi chênh lệch >= 1 hoặc <= -1
          const absDifference = Math.abs(item.stockDifference);
          item.hasDifference = absDifference > 1;
          
          if (item.hasDifference) {
            differenceCount++;
          }
          
          updatedCount++;
        } else {
          // Không có dữ liệu LinkQ
          item.linkQStock = undefined;
          item.stockDifference = undefined;
          item.hasDifference = undefined;
        }
      });
    });
    
    console.log(`✅ Silent stock comparison updated: ${updatedCount} items processed, ${differenceCount} items have differences`);
    
    // Force change detection without reloading data
    this.cdr.detectChanges();
  }

  // Get status badge class
  getStatusBadgeClass(item: InventoryOverviewItem): string {
    return item.isNegative ? 'status-negative' : 'status-ok';
  }

  // Get status text
  getStatusText(item: InventoryOverviewItem): string {
    return item.isNegative ? 'Âm' : 'OK';
  }

  // Track by function for ngFor performance
  trackByItem(index: number, item: InventoryOverviewItem): string {
    return item.id;
  }

  // Debug method
  debugComponent(): void {
    console.log('🔍 === DEBUG COMPONENT STATE ===');
    console.log('hasAccess:', this.hasAccess);
    console.log('isLoading:', this.isLoading);
    console.log('inventoryItems.length:', this.inventoryItems.length);
    console.log('filteredItems.length:', this.filteredItems.length);
    console.log('showOnlyNegativeStock:', this.showOnlyNegativeStock);
    console.log('searchTerm:', this.searchTerm);
    console.log('groupByType:', this.groupByType);
    console.log('isGroupByDropdownOpen:', this.isGroupByDropdownOpen);
    console.log('isMoreActionsDropdownOpen:', this.isMoreActionsDropdownOpen);
    console.log('currentPage:', this.currentPage);
    console.log('totalPages:', this.totalPages);
    console.log('negativeStockCount:', this.negativeStockCount);
    console.log('totalItemsCount:', this.totalItemsCount);
    
    // 🔍 DEBUG LinkQ data
    console.log('🔍 === LINKQ DEBUG ===');
    console.log('isLinkQDataLoaded:', this.isLinkQDataLoaded);
    console.log('linkQData.size:', this.linkQData.size);
    console.log('currentLinkQFileId:', this.currentLinkQFileId);
    
    if (this.inventoryItems.length > 0) {
      console.log('First 3 items:', this.inventoryItems.slice(0, 3));
      
      // Kiểm tra dữ liệu LinkQ trong items
      const itemsWithLinkQ = this.inventoryItems.filter(item => item.linkQStock !== undefined);
      console.log(`Items with LinkQ data: ${itemsWithLinkQ.length}`);
      
      if (itemsWithLinkQ.length > 0) {
        console.log('Sample items with LinkQ:', itemsWithLinkQ.slice(0, 3));
      }
      
      // Kiểm tra items có difference
      const itemsWithDifference = this.inventoryItems.filter(item => item.hasDifference);
      console.log(`Items with differences: ${itemsWithDifference.length}`);
      
      if (itemsWithDifference.length > 0) {
        console.log('Sample items with differences:', itemsWithDifference.slice(0, 3));
      }
    }
    
    console.log('=== END DEBUG ===');
  }

  // Load LinkQ file history from Firebase
  private async loadLinkQFileHistory(): Promise<void> {
    try {
      console.log('📥 Loading LinkQ file history...');
      const snapshot = await this.firestore.collection('linkQFiles').ref.orderBy('uploadDate', 'desc').limit(10).get();
      this.linkQFiles = snapshot.docs.map(doc => {
        const data = doc.data() as any;
        return {
          id: doc.id,
          fileName: data.fileName || '',
          uploadDate: data.uploadDate?.toDate() || new Date(),
          totalItems: data.totalItems || 0,
          processedItems: data.processedItems || 0,
          skippedItems: data.skippedItems || 0,
          userId: data.userId || '',
          // Add actual LinkQ data storage
          linkQData: data.linkQData || {}
        } as LinkQFileInfo;
      });
      console.log(`✅ Loaded ${this.linkQFiles.length} LinkQ file history items.`);
      
      // Auto-load the most recent LinkQ data if available
      if (this.linkQFiles.length > 0) {
        await this.autoLoadMostRecentLinkQData();
      }
    } catch (error) {
      console.error('❌ Error loading LinkQ file history:', error);
      this.linkQFiles = []; // Clear history on error
    }
  }

  // Auto-load the most recent LinkQ data
  private async autoLoadMostRecentLinkQData(): Promise<void> {
    try {
      const mostRecentFile = this.linkQFiles[0]; // First item is most recent due to orderBy desc
      
      if (mostRecentFile.linkQData && Object.keys(mostRecentFile.linkQData).length > 0) {
        console.log(`🔄 Auto-loading most recent LinkQ data from: ${mostRecentFile.fileName}`);
        console.log(`🔍 DEBUG: LinkQ data keys count: ${Object.keys(mostRecentFile.linkQData).length}`);
        
        // Restore LinkQ data
        this.linkQData.clear();
        Object.entries(mostRecentFile.linkQData).forEach(([materialCode, stock]) => {
          this.linkQData.set(materialCode, stock as number);
        });
        
        console.log(`🔍 DEBUG: Loaded ${this.linkQData.size} LinkQ items into memory`);
        
        // Set as current file
        this.currentLinkQFileId = mostRecentFile.id;
        
        // Mark as loaded
        this.isLinkQDataLoaded = true;
        
        // Update stock comparison silently to avoid page reload
        this.updateStockComparisonSilently();
        
        console.log(`✅ Auto-loaded ${this.linkQData.size} LinkQ items from ${mostRecentFile.fileName}`);
        console.log(`📊 Current file: ${mostRecentFile.fileName} (${mostRecentFile.processedItems} items)`);
      } else {
        console.log('⚠️ Most recent file has no LinkQ data to restore');
        console.log(`🔍 DEBUG: mostRecentFile.linkQData:`, mostRecentFile.linkQData);
        console.log(`🔍 DEBUG: Object.keys(mostRecentFile.linkQData):`, Object.keys(mostRecentFile.linkQData || {}));
      }
    } catch (error) {
      console.error('❌ Error auto-loading most recent LinkQ data:', error);
    }
  }

  // Save LinkQ file info to Firebase
  private async saveLinkQFileToFirebase(fileName: string, totalItems: number, processedItems: number, skippedItems: number): Promise<void> {
    try {
      console.log('📤 Saving LinkQ file info to Firebase...');
      const newDocRef = await this.firestore.collection('linkQFiles').add({
        fileName: fileName,
        uploadDate: new Date(),
        totalItems: totalItems,
        processedItems: processedItems,
        skippedItems: skippedItems,
        userId: 'current_user_id', // Replace with actual user ID
        // Add actual LinkQ data storage
        linkQData: Object.fromEntries(this.linkQData)
      });
      
      // Set as current file
      this.currentLinkQFileId = newDocRef.id;
      
      // Reload file history
      await this.loadLinkQFileHistory();
      
      console.log(`✅ File info saved with ID: ${newDocRef.id}`);
    } catch (error) {
      console.error('❌ Error saving LinkQ file info to Firebase:', error);
      throw error;
    }
  }

  // Load LinkQ data from saved file
  async loadLinkQFileData(fileId: string): Promise<void> {
    try {
      console.log(`📥 Loading LinkQ data from file ID: ${fileId}`);
      
      // Find the file in our loaded history
      const fileInfo = this.linkQFiles.find(file => file.id === fileId);
      if (!fileInfo) {
        alert('❌ File không tồn tại trong lịch sử!');
        return;
      }
      
      // Set as current file
      this.currentLinkQFileId = fileId;
      
      if (fileInfo.linkQData && Object.keys(fileInfo.linkQData).length > 0) {
        // Restore LinkQ data
        this.linkQData.clear();
        Object.entries(fileInfo.linkQData).forEach(([materialCode, stock]) => {
          this.linkQData.set(materialCode, stock as number);
        });
        
        // Mark as loaded
        this.isLinkQDataLoaded = true;
        
        // Update stock comparison WITHOUT reloading the page
        this.updateStockComparisonSilently();
        
        // Show success message
        alert(`✅ Đã load lại dữ liệu LinkQ từ file: ${fileInfo.fileName}\n\n📊 Thông tin file:\n• Tổng items: ${fileInfo.totalItems}\n• Xử lý thành công: ${fileInfo.processedItems}\n• Bỏ qua: ${fileInfo.skippedItems}\n• Ngày upload: ${fileInfo.uploadDate.toLocaleDateString('vi-VN')}\n\n🔄 Đã khôi phục ${this.linkQData.size} mã hàng để so sánh`);
        
        console.log(`✅ LinkQ data restored from ${fileInfo.fileName}: ${this.linkQData.size} items`);
      } else {
        alert(`⚠️ File ${fileInfo.fileName} không có dữ liệu LinkQ để khôi phục!`);
        console.log('⚠️ File has no LinkQ data to restore');
      }
      
    } catch (error) {
      console.error('❌ Error loading LinkQ file data:', error);
      alert('❌ Lỗi khi load dữ liệu file: ' + error.message);
    }
  }

  // Track by function for file history
  trackByFile(index: number, file: LinkQFileInfo): string {
    return file.id;
  }

  // Delete old LinkQ files from Firebase
  private async deleteOldLinkQFiles(): Promise<void> {
    try {
      console.log('🗑️ Deleting old LinkQ files...');
      const snapshot = await this.firestore.collection('linkQFiles').ref.get();
      
      if (snapshot.size > 0) {
        const deletePromises = snapshot.docs.map(doc => doc.ref.delete());
        await Promise.all(deletePromises);
        console.log(`🗑️ Deleted ${snapshot.size} old LinkQ files`);
      } else {
        console.log('ℹ️ No old LinkQ files to delete');
      }
    } catch (error) {
      console.error('❌ Error deleting old LinkQ files:', error);
      // Don't throw error, continue with new file import
    }
  }

  // 🔍 Phân tích duplicate trong file Excel
  private analyzeExcelDuplicates(data: any[]): void {
    console.log('🔍 Analyzing Excel file for duplicates...');
    
    const materialCodeCount = new Map<string, { count: number, rows: number[] }>();
    
    data.forEach((row, index) => {
      const materialCode = row['Mã hàng'] || 
                          row['materialCode'] || 
                          row['Mã'] || 
                          row['Code'] || 
                          row['Material'] || 
                          row['Item'] ||
                          row['Part'] ||
                          row['SKU'] ||
                          row['Product'] ||
                          row['Item Code'] ||
                          row['Part Number'] ||
                          row['Material Code'] ||
                          row['Product Code'] ||
                          '';
      
      if (materialCode && materialCode.toString().trim() !== '') {
        const trimmedCode = materialCode.toString().trim();
        
        if (materialCodeCount.has(trimmedCode)) {
          const existing = materialCodeCount.get(trimmedCode)!;
          existing.count++;
          existing.rows.push(index + 1);
        } else {
          materialCodeCount.set(trimmedCode, { count: 1, rows: [index + 1] });
        }
      }
    });
    
    // Tìm và báo cáo duplicates
    const duplicates = Array.from(materialCodeCount.entries())
      .filter(([code, info]) => info.count > 1)
      .sort((a, b) => b[1].count - a[1].count);
    
    if (duplicates.length > 0) {
      console.log(`⚠️ FOUND ${duplicates.length} DUPLICATE MATERIAL CODES in Excel file:`);
      duplicates.forEach(([code, info]) => {
        console.log(`  📋 "${code}": appears ${info.count} times in rows ${info.rows.join(', ')}`);
      });
    } else {
      console.log('✅ No duplicate material codes found in Excel file');
    }
  }

  // 🔍 Kiểm tra mã hàng hợp lệ (loại bỏ dữ liệu scan sai)
  private isValidMaterialCode(materialCode: string): boolean {
    if (!materialCode || materialCode.trim() === '') {
      return false;
    }
    
    // Loại bỏ mã hàng chỉ có số đơn giản (như "25", "123", "999")
    if (/^\d{1,3}$/.test(materialCode.trim())) {
      return false;
    }
    
    // Loại bỏ mã hàng quá ngắn (dưới 4 ký tự)
    if (materialCode.trim().length < 4) {
      return false;
    }
    
    // Loại bỏ mã hàng chỉ có ký tự đặc biệt
    if (/^[^a-zA-Z0-9]*$/.test(materialCode.trim())) {
      return false;
    }
    
    return true;
  }

  // 🔍 Kiểm tra PO hợp lệ
  private isValidPONumber(poNumber: string): boolean {
    if (!poNumber || poNumber.trim() === '') {
      return false;
    }
    
    // Loại bỏ PO chỉ có số đơn giản
    if (/^\d{1,5}$/.test(poNumber.trim())) {
      return false;
    }
    
    // Loại bỏ PO quá ngắn (dưới 3 ký tự)
    if (poNumber.trim().length < 3) {
      return false;
    }
    
    // Loại bỏ PO chỉ có ký tự đặc biệt
    if (/^[^a-zA-Z0-9]*$/.test(poNumber.trim())) {
      return false;
    }
    
    return true;
  }
}
