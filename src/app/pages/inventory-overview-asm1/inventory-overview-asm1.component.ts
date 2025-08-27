import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { FactoryAccessService } from '../../services/factory-access.service';
import { TabPermissionService } from '../../services/tab-permission.service';
import * as XLSX from 'xlsx';

interface InventoryOverviewItem {
  id: string;
  materialCode: string;
  poNumber: string;
  quantity: number;
  openingStock: number; // Thêm openingStock để giống RM1 Inventory
  exported: number;
  xt: number;
  location: string;
  type: string;
  currentStock: number;
  isNegative: boolean;
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
    
    // Start auto-refresh to keep data in sync with RM1 Inventory
    this.startAutoRefresh();
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
      
      // Lấy dữ liệu từ collection inventory-materials với filter factory == 'ASM1' 
      // Giống hệt như logic trong RM1 Inventory để đảm bảo tính nhất quán
      console.log('🔍 Lấy dữ liệu từ collection inventory-materials với filter factory == ASM1...');
      
      const snapshot = await this.firestore.collection('inventory-materials', ref => 
        ref.where('factory', '==', 'ASM1')
      ).ref.get();
      
      if (snapshot.empty) {
        console.log('ℹ️ Không tìm thấy dữ liệu ASM1 trong collection inventory-materials');
        this.inventoryItems = [];
        this.filteredItems = [];
        return;
      }
      
      console.log(`✅ Tìm thấy ${snapshot.size} ASM1 documents trong collection inventory-materials`);
      
      // Lấy outbound data cho ASM1
      let outboundSnapshot: any = null;
      try {
        console.log('🔍 Lấy dữ liệu outbound cho ASM1...');
        outboundSnapshot = await this.firestore.collection('outbound-materials', ref =>
          ref.where('factory', '==', 'ASM1')
        ).ref.get();
        console.log(`📊 Tìm thấy ${outboundSnapshot.size} ASM1 outbound documents`);
      } catch (err) {
        console.log('⚠️ Không thể lấy dữ liệu outbound ASM1:', err);
      }
      
      // Xử lý dữ liệu từ collection inventory-materials để đảm bảo chính xác
      console.log(`📊 Xử lý ${snapshot.size} ASM1 documents từ collection inventory-materials`);
      
      const items: InventoryOverviewItem[] = [];
      
      // Xử lý từng document từ collection inventory-materials
      let itemIndex = 0;
      let validItemsCount = 0;
      let invalidItemsCount = 0;
      
      snapshot.forEach((doc) => {
        const data = doc.data() as any;
        
        // Log first few documents for debugging
        if (itemIndex < 3) {
          console.log(`🔍 Document ${itemIndex + 1} (ASM1):`, {
            materialCode: data.materialCode,
            poNumber: data.poNumber,
            quantity: data.quantity,
            openingStock: data.openingStock,
            exported: data.exported,
            xt: data.xt,
            location: data.location,
            type: data.type,
            // Log all available fields
            allFields: Object.keys(data)
          });
        }
        
        // 🔍 FILTER: Loại bỏ dữ liệu scan sai
        const materialCode = data.materialCode || '';
        const poNumber = data.poNumber || '';
        
        // Kiểm tra mã hàng hợp lệ (không phải số đơn giản như "25")
        if (!this.isValidMaterialCode(materialCode)) {
          console.log(`⚠️ Skipping invalid material code: "${materialCode}" (PO: ${poNumber})`);
          invalidItemsCount++;
          itemIndex++;
          return; // Bỏ qua dòng này
        }
        
        // Kiểm tra PO hợp lệ
        if (!this.isValidPONumber(poNumber)) {
          console.log(`⚠️ Skipping invalid PO: "${poNumber}" (Material: ${materialCode})`);
          invalidItemsCount++;
          itemIndex++;
          return; // Bỏ qua dòng này
        }
        
        // Sử dụng đúng field names từ collection inventory-materials
        const quantity = data.quantity || 0;
        const openingStock = data.openingStock || 0;
        const exported = data.exported || 0;
        const xt = data.xt || 0;
        
        // Tính toán current stock giống hệt như RM1 Inventory
        const currentStock = openingStock + quantity - exported - xt;
        
        items.push({
          id: doc.id, // Sử dụng ID thật từ Firebase
          materialCode: materialCode,
          poNumber: poNumber,
          quantity: quantity,
          openingStock: openingStock, // Thêm openingStock
          exported: exported,
          xt: xt,
          location: data.location || '',
          type: data.type || '',
          currentStock: currentStock,
          isNegative: currentStock < 0,
        });
        
        validItemsCount++;
        itemIndex++;
      });
      
      console.log(`✅ Filtered results: ${validItemsCount} valid items, ${invalidItemsCount} invalid items skipped`);
      
      // Sort by material code then PO (FIFO)
      items.sort((a, b) => {
        if (a.materialCode !== b.materialCode) {
          return a.materialCode.localeCompare(b.materialCode);
        }
        return a.poNumber.localeCompare(b.poNumber);
      });
      
      this.inventoryItems = items;
      this.filteredItems = [...items];
      
      console.log(`✅ Loaded ${items.length} ASM1 inventory items từ collection inventory-materials`);
      console.log(`📊 Negative stock items: ${items.filter(item => item.isNegative).length}`);
      
      // Log negative stock items specifically
      const negativeItems = items.filter(item => item.isNegative);
      if (negativeItems.length > 0) {
        console.log('🔴 Negative stock items found:');
        negativeItems.forEach(item => {
          console.log(`  - ${item.materialCode} (PO: ${item.poNumber}): Stock = ${item.currentStock}`);
        });
      }
      
      // Force change detection
      this.cdr.detectChanges();
      
    } catch (error) {
      console.error('❌ Error loading inventory overview:', error);
      // Show error in UI
      this.inventoryItems = [];
      this.filteredItems = [];
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
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
    
    this.applyFilters();
    console.log(`🔄 Changed filter mode to: ${this.currentFilterMode}`);
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
        return 'Chỉ mã lệch LinkQ';
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
    this.groupByType = type;
    this.isGroupByDropdownOpen = false;
    this.isMoreActionsDropdownOpen = false; // Close more actions dropdown too
    this.applyFilters();
    console.log(`🔄 Changed group by type to: ${type}`);
  }

  // Group data by material code (sum up quantities, clear PO)
  private groupByMaterialCode(items: InventoryOverviewItem[]): InventoryOverviewItem[] {
    const groupedMap = new Map<string, InventoryOverviewItem>();
    
    items.forEach(item => {
      if (groupedMap.has(item.materialCode)) {
        // Add quantities for same material code
        const existing = groupedMap.get(item.materialCode)!;
        existing.openingStock += item.openingStock || 0;
        existing.quantity += item.quantity;
        existing.exported += item.exported;
        existing.xt += item.xt;
        existing.currentStock += item.currentStock;
        existing.isNegative = existing.currentStock < 0;
        
        // Update LinkQ data if available
        if (item.linkQStock !== undefined) {
          existing.linkQStock = item.linkQStock;
          existing.stockDifference = item.stockDifference;
          existing.hasDifference = item.hasDifference;
        }
      } else {
        // Create new grouped item
        const groupedItem: InventoryOverviewItem = {
          id: item.materialCode, // Use material code as ID for grouped items
          materialCode: item.materialCode,
          poNumber: '', // Clear PO for grouped view
          quantity: item.quantity,
          openingStock: item.openingStock || 0, // Thêm openingStock
          exported: item.exported,
          xt: item.xt,
          location: item.location,
          type: item.type,
          currentStock: item.currentStock,
          isNegative: item.currentStock < 0,
          // Copy LinkQ data
          linkQStock: item.linkQStock,
          stockDifference: item.stockDifference,
          hasDifference: item.hasDifference
        };
        groupedMap.set(item.materialCode, groupedItem);
      }
    });
    
    return Array.from(groupedMap.values());
  }

  // Apply filters
  applyFilters(): void {
    console.log('🔍 Starting applyFilters...');
    console.log(`📊 Inventory items: ${this.inventoryItems.length}, LinkQ loaded: ${this.isLinkQDataLoaded}`);
    
    // 🔧 SỬA LỖI: Tạo deep copy để không làm mất dữ liệu LinkQ
    let filtered = this.inventoryItems.map(item => {
      const copy = { ...item };
      // Đảm bảo dữ liệu LinkQ được copy đúng
      copy.linkQStock = item.linkQStock;
      copy.stockDifference = item.stockDifference;
      copy.hasDifference = item.hasDifference;
      return copy;
    });
    
    // Filter by current filter mode
    switch (this.currentFilterMode) {
      case 'negative':
        filtered = filtered.filter(item => item.isNegative);
        console.log(`🔍 Negative filter: ${filtered.length} items`);
        break;
      case 'linkq-difference':
        if (this.isLinkQDataLoaded) {
          filtered = filtered.filter(item => item.hasDifference);
          console.log(`🔍 LinkQ difference filter: ${filtered.length} items`);
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
    
    // Group data based on groupByType
    if (this.groupByType === 'material') {
      const beforeGroup = filtered.length;
      filtered = this.groupByMaterialCode(filtered);
      console.log(`🔍 Material grouping: ${beforeGroup} → ${filtered.length} items`);
    }
    // If groupByType === 'po', keep original structure (no grouping needed)
    
    this.filteredItems = filtered;
    this.currentPage = 1; // Reset to first page
    
    // 🔧 SỬA LỖI: Kiểm tra dữ liệu LinkQ sau khi filter
    const itemsWithLinkQ = filtered.filter(item => item.linkQStock !== undefined).length;
    const itemsWithDifference = filtered.filter(item => item.hasDifference).length;
    
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
  exportToExcel(): void {
    if (this.filteredItems.length === 0) {
      console.warn('⚠️ No data to export');
      return;
    }

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

  // Refresh data
  refreshData(): void {
    console.log('🔄 Manually refreshing inventory overview data...');
    this.loadInventoryOverview();
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
        // Update stock comparison
        this.updateStockComparison();
        
        // Apply filters để refresh display
        this.applyFilters();
        
        console.log('✅ LinkQ data force refreshed successfully');
      });
      
    } catch (error) {
      console.error('❌ Error force refreshing LinkQ data:', error);
    }
  }
  
  // Auto refresh data every 30 seconds to keep in sync with RM1 Inventory
  private startAutoRefresh(): void {
    setInterval(() => {
      if (!this.isLoading) {
        console.log('🔄 Auto-refreshing inventory overview data...');
        this.loadInventoryOverview();
      }
    }, 30000); // 30 seconds
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
          
          // Update stock comparison
          this.updateStockComparison();
          
          // Show success message
          alert(`✅ Đã import thành công dữ liệu LinkQ!\n\n📦 Tổng số mã hàng: ${this.linkQData.size}\n🔄 Dữ liệu cũ đã được ghi đè hoàn toàn\n🔍 Hệ thống sẽ so sánh với tồn kho hiện tại`);
          
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
  downloadLinkQTemplate(): void {
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
  downloadLinkQComparisonReport(): void {
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
          const hasDifference = stockDifference >= 1 || stockDifference <= -1;
          
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
          const hasDifference = stockDifference >= 1 || stockDifference <= -1;
          
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
      }
      
      let processedCount = 0;
      let skippedCount = 0;
      
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
        const stock = parseFloat(row['Tồn kho'] || 
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
        
        if (materialCode && materialCode.toString().trim() !== '') {
          const trimmedCode = materialCode.toString().trim();
          this.linkQData.set(trimmedCode, stock);
          processedCount++;
          
          // Log first few successful items for debugging
          if (processedCount <= 5) {
            console.log(`✅ DEBUG: Processed item ${processedCount}: ${trimmedCode} -> ${stock}`);
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
      console.log(`✅ Processed ${processedCount} LinkQ items, skipped ${skippedCount} rows`);
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
        item.linkQStock = linkQStock;
        item.stockDifference = item.currentStock - linkQStock;
        
        // 🔧 SỬA LỖI SO SÁNH: Chỉ tính lệch khi chênh lệch >= 1 hoặc <= -1
        // Bỏ qua các chênh lệch nhỏ từ -0.99 đến 0.99
        const absDifference = Math.abs(item.stockDifference);
        item.hasDifference = absDifference >= 1;
        
        if (item.hasDifference) {
          differenceCount++;
        }
        
        updatedCount++;
        
        // Log debug cho một số items đầu tiên
        if (updatedCount <= 5) {
          console.log(`🔍 ${item.materialCode}: Current=${item.currentStock}, LinkQ=${linkQStock}, Diff=${item.stockDifference}, HasDiff=${item.hasDifference}`);
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
        
        // Restore LinkQ data
        this.linkQData.clear();
        Object.entries(mostRecentFile.linkQData).forEach(([materialCode, stock]) => {
          this.linkQData.set(materialCode, stock as number);
        });
        
        // Set as current file
        this.currentLinkQFileId = mostRecentFile.id;
        
        // Mark as loaded
        this.isLinkQDataLoaded = true;
        
        // Update stock comparison
        this.updateStockComparison();
        
        console.log(`✅ Auto-loaded ${this.linkQData.size} LinkQ items from ${mostRecentFile.fileName}`);
        console.log(`📊 Current file: ${mostRecentFile.fileName} (${mostRecentFile.processedItems} items)`);
      } else {
        console.log('⚠️ Most recent file has no LinkQ data to restore');
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
        
        // Update stock comparison
        this.updateStockComparison();
        
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
