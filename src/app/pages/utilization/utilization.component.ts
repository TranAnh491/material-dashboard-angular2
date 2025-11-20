import { Component, OnInit, OnDestroy, ChangeDetectorRef, HostListener } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subscription } from 'rxjs';
import * as XLSX from 'xlsx';

interface RackLoading {
  position: string;
  maxCapacity: number;
  currentLoad: number;
  usage: number; // Percentage
  status: 'available' | 'normal' | 'warning' | 'critical';
  itemCount: number;
}

interface InventoryMaterial {
  materialCode: string;
  location: string;
  openingStock?: number | null; // Tồn đầu
  quantity: number; // Số lượng nhập
  exported?: number; // Đã xuất
  xt?: number; // Cần xuất
  stock?: number; // Tồn kho (có thể có sẵn hoặc tính)
  factory?: string;
}

interface CatalogItem {
  materialCode: string;
  materialName?: string;
  unitWeight?: number; // Trọng lượng đơn vị (gram)
  unit?: string;
  standardPacking?: number;
}

@Component({
  selector: 'app-utilization',
  templateUrl: './utilization.component.html',
  styleUrls: ['./utilization.component.scss']
})
export class UtilizationComponent implements OnInit, OnDestroy {
  
  // Rack Loading Data
  rackLoadingData: RackLoading[] = [];
  private rackDataSubscription: Subscription | undefined;
  private catalogSubscription: Subscription | undefined;
  isRefreshing: boolean = false;
  lastRackDataUpdate: Date | null = null;
  
  // Store inventory materials for position details export
  private inventoryMaterials: InventoryMaterial[] = [];
  
  // Catalog cache for unit weights
  private catalogCache = new Map<string, CatalogItem>();
  catalogLoaded = false;
  
  // Track missing unitWeight
  missingUnitWeightCount = 0;
  private missingUnitWeightMaterials: Array<{
    materialCode: string;
    location: string;
    stock: number;
    materialName?: string;
  }> = [];
  
  // Import progress
  showImportProgress = false;
  importProgress = 0;
  importCurrentBatch = 0;
  importTotalBatches = 0;
  importSuccessCount = 0;
  importErrorCount = 0;
  
  // More menu
  showMoreMenu = false;

  constructor(
    private firestore: AngularFirestore,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    // CHỈ load catalog, KHÔNG tự động load rack data
    // User phải ấn nút Refresh để load
    this.loadCatalog();
  }
  
  toggleMoreMenu(): void {
    this.showMoreMenu = !this.showMoreMenu;
  }
  
  @HostListener('document:click', ['$event'])
  onClickOutside(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const clickedInside = target.closest('.more-dropdown');
    
    if (!clickedInside && this.showMoreMenu) {
      this.showMoreMenu = false;
    }
  }

  ngOnDestroy(): void {
    if (this.rackDataSubscription) {
      this.rackDataSubscription.unsubscribe();
    }
    if (this.catalogSubscription) {
      this.catalogSubscription.unsubscribe();
    }
  }

  private loadCatalog(): void {
    console.log('📚 Loading catalog from Firestore...');
    
    this.catalogSubscription = this.firestore.collection('materials')
      .valueChanges()
      .subscribe({
        next: (materials: any[]) => {
          console.log('📦 Loaded', materials.length, 'catalog items');
          
          this.catalogCache.clear();
          materials.forEach(item => {
            if (item.materialCode) {
              const code = item.materialCode.toString().trim().toUpperCase();
              this.catalogCache.set(code, {
                materialCode: code,
                materialName: item.materialName || item.name,
                unitWeight: item.unitWeight || item.unit_weight || 0,
                unit: item.unit,
                standardPacking: item.standardPacking
              });
            }
          });
          
          this.catalogLoaded = true;
          console.log('✅ Catalog loaded:', this.catalogCache.size, 'items');
          
          // Reload rack data after catalog is loaded
          if (this.rackLoadingData.length > 0) {
            this.loadRackDataFromInventory();
          }
        },
        error: (error) => {
          console.error('❌ Error loading catalog:', error);
        }
      });
  }

  private initializeRackLoading() {
    // Start with empty data - will be populated from inventory-materials
    this.rackLoadingData = [];

    // Load real data from Firestore (materials-asm1)
    this.loadRackDataFromInventory();
  }

  private loadRackDataFromInventory() {
    console.log('📊 Loading rack data from inventory-materials (ASM1)...');
    
    this.rackDataSubscription = this.firestore.collection('inventory-materials', ref =>
      ref.where('factory', '==', 'ASM1')
    ).valueChanges().subscribe({
      next: (materials: any[]) => {
        console.log('📦 Loaded', materials.length, 'materials from inventory');
        this.updateRackLoadingFromInventory(materials);
        this.lastRackDataUpdate = new Date();
      },
      error: (error) => {
        console.error('❌ Error loading rack data from inventory:', error);
      }
    });
  }

  refreshRackData() {
    this.isRefreshing = true;
    
    setTimeout(() => {
      this.loadRackDataFromInventory();
      this.isRefreshing = false;
    }, 1500);
  }

  private normalizePosition(location: string): string {
    if (!location) return '';
    
    // Remove dots, commas, and get first 3 characters
    const cleaned = location.replace(/[.,]/g, '').substring(0, 3).toUpperCase();
    
    // Validate: phải bắt đầu bằng A-G và theo sau là 2 số
    // Ví dụ: A01, B12, C99, D05, E23, F45, G67
    const validPattern = /^[A-G]\d{2}$/;
    
    if (!validPattern.test(cleaned)) {
      return ''; // Invalid position
    }
    
    return cleaned;
  }

  private updateRackLoadingFromInventory(materials: InventoryMaterial[]) {
    console.log('🔄 Processing', materials.length, 'materials...');
    console.log('📚 Catalog loaded:', this.catalogLoaded, '| Catalog size:', this.catalogCache.size);
    
    // Store materials for position details export
    this.inventoryMaterials = materials;
    
    // Reset missing materials list
    this.missingUnitWeightMaterials = [];
    
    // Group by normalized position (first 3 chars, no dots/commas)
    const positionMap = new Map<string, { totalWeightKg: number, itemCount: number }>();
    
    let processedCount = 0;
    let skippedCount = 0;
    
    materials.forEach(material => {
      const position = this.normalizePosition(material.location);
      if (!position) {
        skippedCount++;
        return; // Skip if no valid position
      }
      
      // TÍNH TỒN KHO CHÍNH XÁC: openingStock + quantity - exported - xt
      const openingStockValue = material.openingStock !== null && material.openingStock !== undefined 
        ? material.openingStock 
        : 0;
      const stockQty = openingStockValue + (material.quantity || 0) - (material.exported || 0) - (material.xt || 0);
      
      if (stockQty <= 0) {
        skippedCount++;
        return; // Skip if no stock
      }
      
      // Normalize materialCode to match catalog format (UPPERCASE, TRIM)
      const normalizedMaterialCode = material.materialCode?.toString().trim().toUpperCase();
      
      // Get unit weight from catalog (in grams)
      const catalogItem = this.catalogCache.get(normalizedMaterialCode);
      const unitWeightGram = catalogItem?.unitWeight || 0;
      
      if (unitWeightGram <= 0) {
        // DEBUG: Show materialCode details
        const codeDebug = `"${normalizedMaterialCode}" (original: "${material.materialCode}", len: ${normalizedMaterialCode?.length})`;
        console.warn(`⚠️ No unit weight for ${codeDebug}`);
        
        // Check if similar code exists in catalog
        const similarCodes = Array.from(this.catalogCache.keys()).filter(k => 
          k.toLowerCase().includes(normalizedMaterialCode.toLowerCase()) || 
          normalizedMaterialCode.toLowerCase().includes(k.toLowerCase())
        );
        if (similarCodes.length > 0) {
          console.warn(`  💡 Similar codes in catalog:`, similarCodes);
        }
        
        // Track missing unitWeight materials
        this.missingUnitWeightMaterials.push({
          materialCode: normalizedMaterialCode,
          location: material.location,
          stock: stockQty,
          materialName: catalogItem?.materialName
        });
        
        skippedCount++;
        return;
      }
      
      // Calculate weight in kg: Stock × UnitWeight (gram) / 1000
      const weightKg = (stockQty * unitWeightGram) / 1000;
      
      if (!positionMap.has(position)) {
        positionMap.set(position, { totalWeightKg: 0, itemCount: 0 });
      }
      
      const current = positionMap.get(position)!;
      current.totalWeightKg += weightKg;
      current.itemCount += 1;
      processedCount++;
      
      if (processedCount <= 5) {
        console.log(`📊 ${normalizedMaterialCode} @ ${position}: ${stockQty} × ${unitWeightGram}g = ${weightKg.toFixed(2)}kg`);
      }
    });
    
    // Update missing count (unique materials only)
    const uniqueMaterialCodes = new Set(this.missingUnitWeightMaterials.map(m => m.materialCode));
    this.missingUnitWeightCount = uniqueMaterialCodes.size;
    
    console.log(`⚠️ Missing unitWeight: ${this.missingUnitWeightCount} unique materials (${this.missingUnitWeightMaterials.length} total records)`);
    
    console.log(`📊 Processed: ${processedCount} materials, Skipped: ${skippedCount}`);
    console.log('📍 Found', positionMap.size, 'unique positions');
    
    // Convert to RackLoading array
    this.rackLoadingData = Array.from(positionMap.entries())
      .filter(([_, data]) => data.totalWeightKg > 0) // Only show positions with weight
      .map(([position, data]) => {
        // Set max capacity based on position - positions ending with '1' have 5000kg capacity
        const maxCapacity = position.endsWith('1') ? 5000 : 1300; // kg
        const usage = Math.round((data.totalWeightKg / maxCapacity) * 100 * 10) / 10;
        
        return {
          position: position,
          maxCapacity: maxCapacity,
          currentLoad: Math.round(data.totalWeightKg * 100) / 100, // Round to 2 decimals
          usage: Math.min(usage, 100), // Cap at 100%
          status: this.calculateRackStatus(usage),
          itemCount: data.itemCount
        };
      })
      .sort((a, b) => a.position.localeCompare(b.position)); // Sort by position name

    console.log('✅ Created rack loading data for', this.rackLoadingData.length, 'positions');
    
    if (this.rackLoadingData.length > 0) {
      const totalWeight = this.rackLoadingData.reduce((sum, r) => sum + r.currentLoad, 0);
      console.log(`📊 Total weight across all positions: ${totalWeight.toFixed(2)} kg`);
    }
  }

  private calculateRackStatus(usage: number): 'available' | 'normal' | 'warning' | 'critical' {
    if (usage >= 95) return 'critical';
    if (usage >= 80) return 'warning';
    if (usage >= 20) return 'normal';
    return 'available';
  }

  getRackStatusClass(usage: number): string {
    if (usage >= 95) return 'critical';
    if (usage >= 80) return 'warning';
    if (usage >= 20) return 'normal';
    return 'available';
  }

  getUsageBarClass(usage: number): string {
    if (usage >= 95) return 'critical';
    if (usage >= 80) return 'warning';
    if (usage >= 20) return 'normal';
    return 'available';
  }

  getRackStatusLabel(usage: number): string {
    if (usage >= 95) return 'Critical';
    if (usage >= 80) return 'Warning';
    if (usage >= 20) return 'Normal';
    return 'Available';
  }

  getTotalRacks(): number {
    return this.rackLoadingData.length;
  }

  getHighUsageRacks(): number {
    return this.rackLoadingData.filter(rack => rack.usage >= 95).length;
  }

  getAvailableRacks(): number {
    return this.rackLoadingData.filter(rack => rack.usage < 20).length;
  }

  getTotalWeight(): number {
    return this.rackLoadingData.reduce((sum, rack) => sum + rack.currentLoad, 0);
  }

  getOccupiedRacks(): number {
    return this.rackLoadingData.filter(rack => rack.usage >= 20).length;
  }

  getUseRate(): number {
    const totalCapacity = this.rackLoadingData.reduce((sum, rack) => sum + rack.maxCapacity, 0);
    const totalUsed = this.getTotalWeight();
    return totalCapacity > 0 ? Math.round((totalUsed / totalCapacity) * 100) : 0;
  }

  // ==================== IMPORT/EXPORT FUNCTIONS ====================

  async clearAllUnitWeight(): Promise<void> {
    const confirmed = confirm('⚠️ XÓA TẤT CẢ UNIT WEIGHT\n\nBạn có chắc chắn muốn xóa hết unitWeight của TẤT CẢ materials?\n\nHành động này KHÔNG THỂ HOÀN TÁC!\n\nSau khi xóa, bạn sẽ cần import lại từ đầu.');
    
    if (!confirmed) return;
    
    const doubleConfirm = confirm('🚨 XÁC NHẬN LẦN 2\n\nĐây là hành động NGUY HIỂM!\n\nTất cả unitWeight sẽ bị XÓA vĩnh viễn.\n\nClick OK để tiếp tục xóa.');
    
    if (!doubleConfirm) return;
    
    try {
      console.log('🗑️ Starting to clear all unitWeight...');
      
      // Get all materials
      const snapshot = await this.firestore.collection('materials').get().toPromise();
      
      const totalMaterials = snapshot.size;
      let clearedCount = 0;
      
      console.log(`📦 Found ${totalMaterials} materials to clear`);
      
      // Show progress
      this.showImportProgress = true;
      this.importTotalBatches = Math.ceil(totalMaterials / 200);
      this.importCurrentBatch = 0;
      this.importProgress = 0;
      this.importSuccessCount = 0;
      this.importErrorCount = 0;
      this.cdr.detectChanges();
      
      // Process in batches
      const batchSize = 200;
      const docs = snapshot.docs;
      
      for (let i = 0; i < docs.length; i += batchSize) {
        const batch = this.firestore.firestore.batch();
        const batchDocs = docs.slice(i, Math.min(i + batchSize, docs.length));
        
        batchDocs.forEach(doc => {
          batch.update(doc.ref, { unitWeight: 0 });
          clearedCount++;
        });
        
        await batch.commit();
        
        // Update progress
        this.importCurrentBatch = Math.floor(i / batchSize) + 1;
        this.importProgress = Math.round((clearedCount / totalMaterials) * 100);
        this.importSuccessCount = clearedCount;
        
        if (this.importCurrentBatch % 2 === 0) {
          this.cdr.detectChanges();
        }
        
        console.log(`✅ Cleared ${clearedCount}/${totalMaterials} materials`);
      }
      
      // Hide progress
      this.showImportProgress = false;
      this.cdr.detectChanges();
      
      console.log('✅ All unitWeight cleared');
      alert(`✅ Đã xóa unitWeight của ${clearedCount} materials!\n\nBây giờ bạn có thể import lại từ đầu.`);
      
      // Reload catalog
      this.catalogCache.clear();
      this.catalogLoaded = false;
      this.loadCatalog();
      this.loadRackDataFromInventory();
      
    } catch (error) {
      console.error('❌ Error clearing unitWeight:', error);
      alert(`❌ Lỗi khi xóa: ${error.message}`);
      this.showImportProgress = false;
      this.cdr.detectChanges();
    }
  }

  exportMissingUnitWeight(): void {
    console.log('📤 Exporting materials missing unitWeight...');
    
    if (this.missingUnitWeightMaterials.length === 0) {
      alert('✅ Tất cả materials đều đã có unitWeight!\n\nKhông có materials nào thiếu dữ liệu.');
      return;
    }

    // Prepare data for export - CHỈ 2 CỘT
    // Loại bỏ trùng lặp materialCode
    const uniqueMaterials = new Map<string, any>();
    this.missingUnitWeightMaterials.forEach(m => {
      const code = m.materialCode.trim().toUpperCase();
      if (!uniqueMaterials.has(code)) {
        uniqueMaterials.set(code, m);
      }
    });
    
    const exportData = Array.from(uniqueMaterials.values()).map(m => ({
      materialCode: m.materialCode,
      unitWeight: ''
    }));

    // Create workbook
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(exportData);
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Missing UnitWeight');

    // Add instructions
    const instructions = [
      { instruction: `DANH SÁCH ${this.missingUnitWeightMaterials.length} MATERIALS THIẾU UNIT WEIGHT` },
      { instruction: '' },
      { instruction: 'HƯỚNG DẪN:' },
      { instruction: '1. Điền unitWeight (gram) cho từng material' },
      { instruction: '2. Điền các thông tin khác (unit, standardPacking, category, supplier)' },
      { instruction: '3. Lưu file Excel' },
      { instruction: '4. Import lại vào tab Utilization bằng nút "Import Catalog"' },
      { instruction: '' },
      { instruction: 'LƯU Ý:' },
      { instruction: '- unitWeight phải tính bằng GRAM (không phải kg)' },
      { instruction: '- Ví dụ: Dây điện 1.5mm = 50g/m, Motor 1HP = 4000g' },
      { instruction: '- Cột materialCode và unitWeight là BẮT BUỘC' },
      { instruction: '' },
      { instruction: 'VÍ DỤ unitWeight (GRAM):' },
      { instruction: '- Dây điện 1.5mm: 50g/m' },
      { instruction: '- Dây điện 2.5mm: 80g/m' },
      { instruction: '- Motor 1/4HP: 1500g' },
      { instruction: '- Motor 1HP: 4000g' },
      { instruction: '- Túi nhựa nhỏ: 5g' },
      { instruction: '- Capacitor: 15g' },
      { instruction: '- Relay: 25g' }
    ];
    const wsInstructions: XLSX.WorkSheet = XLSX.utils.json_to_sheet(instructions);
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Hướng dẫn');

    // Summary sheet
    const uniqueCount = Array.from(uniqueMaterials.keys()).length;
    const summary = [
      { label: 'Số materials unique thiếu unitWeight', value: uniqueCount },
      { label: 'Tổng records thiếu unitWeight', value: this.missingUnitWeightMaterials.length },
      { label: 'Ngày export', value: new Date().toLocaleDateString('vi-VN') },
      { label: 'Thời gian', value: new Date().toLocaleTimeString('vi-VN') },
      { label: '', value: '' },
      { label: 'TOP 10 MATERIALS THIẾU UNITWEIGHT:', value: '' }
    ];
    
    // Add top 10 by stock
    const top10 = [...this.missingUnitWeightMaterials]
      .sort((a, b) => b.stock - a.stock)
      .slice(0, 10)
      .map((m, i) => ({
        label: `${i + 1}. ${m.materialCode}`,
        value: `Stock: ${m.stock} @ ${m.location}`
      }));
    
    const wsSummary: XLSX.WorkSheet = XLSX.utils.json_to_sheet([...summary, ...top10]);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Tóm tắt');

    // Download
    const fileName = `missing_unitweight_${new Date().getTime()}.xlsx`;
    XLSX.writeFile(wb, fileName);
    
    console.log('✅ Exported', uniqueMaterials.size, 'unique missing materials');
    alert(`📤 Đã export ${uniqueMaterials.size} materials thiếu unitWeight!\n\nFile: ${fileName}\n\n✅ CHỈ CẦN 2 CỘT:\n• materialCode (đã có sẵn)\n• unitWeight (điền gram)\n\nVui lòng:\n1. Mở file Excel\n2. Điền unitWeight (gram)\n3. Import lại bằng "Import Catalog"`);
  }

  downloadTemplate(): void {
    console.log('📥 Downloading unit weight template...');
    
    // Create template data - CHỈ 2 CỘT
    const templateData = [
      { materialCode: 'B001003', unitWeight: 50 },
      { materialCode: 'B017431', unitWeight: 80 },
      { materialCode: 'P0123', unitWeight: 5 },
      { materialCode: 'M001234', unitWeight: 2500 },
      { materialCode: 'C005678', unitWeight: 15 },
      { materialCode: 'R009876', unitWeight: 25 }
    ];

    // Create workbook
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(templateData);
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'UnitWeight');

    // Add instructions sheet
    const instructions = [
      { instruction: 'HƯỚNG DẪN IMPORT UNIT WEIGHT' },
      { instruction: '' },
      { instruction: 'FILE CHỈ CẦN 2 CỘT:' },
      { instruction: '1. materialCode - Mã hàng (bắt buộc)' },
      { instruction: '2. unitWeight - Trọng lượng đơn vị tính bằng GRAM (bắt buộc)' },
      { instruction: '' },
      { instruction: 'LƯU Ý:' },
      { instruction: '- unitWeight phải tính bằng GRAM (không phải kg)' },
      { instruction: '- Ví dụ: 1kg = 1000 gram' },
      { instruction: '- Import sẽ GHI ĐÈ unitWeight cũ (nếu có)' },
      { instruction: '' },
      { instruction: 'VÍ DỤ unitWeight (GRAM):' },
      { instruction: '- Dây điện 1.5mm: 50g/mét' },
      { instruction: '- Dây điện 2.5mm: 80g/mét' },
      { instruction: '- Motor 1/4HP: 1500g' },
      { instruction: '- Motor 1HP: 4000g' },
      { instruction: '- Túi nhựa nhỏ: 5g' },
      { instruction: '- Capacitor: 15g' },
      { instruction: '- Relay: 25g' },
      { instruction: '' },
      { instruction: 'CÔNG THỨC TÍNH:' },
      { instruction: 'Current Load (kg) = Stock × unitWeight (gram) / 1000' },
      { instruction: '' },
      { instruction: 'CÁCH SỬ DỤNG:' },
      { instruction: '1. Điền dữ liệu vào sheet "UnitWeight"' },
      { instruction: '2. Lưu file Excel' },
      { instruction: '3. Click "Import Catalog" trong tab Utilization' },
      { instruction: '4. Chọn file → Xác nhận' },
      { instruction: '5. Tab Utilization tự động cập nhật' }
    ];
    const wsInstructions: XLSX.WorkSheet = XLSX.utils.json_to_sheet(instructions);
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Hướng dẫn');

    // Download file
    const fileName = `unitweight_template_${new Date().getTime()}.xlsx`;
    XLSX.writeFile(wb, fileName);
    
    console.log('✅ Template downloaded:', fileName);
    alert('✅ Đã tải template thành công!\n\nFile có 2 cột:\n• materialCode (mã hàng)\n• unitWeight (gram)\n\nVui lòng:\n1. Mở file Excel\n2. Điền unitWeight (gram)\n3. Lưu file\n4. Click "Import Catalog"');
  }

  async onFileSelected(event: any): Promise<void> {
    const file: File = event.target.files[0];
    if (!file) return;

    console.log('📂 File selected:', file.name);
    
    if (!file.name.match(/\.(xlsx|xls|csv)$/)) {
      alert('❌ Chỉ chấp nhận file Excel (.xlsx, .xls) hoặc CSV (.csv)');
      return;
    }

    const confirmed = confirm(`📥 Import catalog từ file: ${file.name}\n\nĐiều này sẽ cập nhật unitWeight vào Firestore.\n\nBạn có chắc chắn muốn tiếp tục?`);
    if (!confirmed) return;

    try {
      console.log('📊 Reading file...');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData: any[] = XLSX.utils.sheet_to_json(worksheet);

      console.log('📦 Parsed', jsonData.length, 'rows from Excel');

      if (jsonData.length === 0) {
        alert('❌ File không có dữ liệu!');
        return;
      }

      // Validate required fields
      const requiredFields = ['materialCode', 'unitWeight'];
      const firstRow = jsonData[0];
      const missingFields = requiredFields.filter(field => !(field in firstRow));
      
      if (missingFields.length > 0) {
        alert(`❌ Thiếu cột bắt buộc: ${missingFields.join(', ')}\n\nVui lòng sử dụng template đúng định dạng.`);
        return;
      }

      // Import to Firestore - BATCH PROCESSING
      let successCount = 0;
      let errorCount = 0;
      const errors: string[] = [];
      const successList: string[] = [];

      console.log('🔄 Starting import of', jsonData.length, 'rows...');

      // FIRESTORE BATCH WRITE: 500 operations/batch (tối đa của Firestore)
      const FIRESTORE_BATCH_LIMIT = 500;
      const totalBatches = Math.ceil(jsonData.length / FIRESTORE_BATCH_LIMIT);
      
      // Show progress modal
      this.showImportProgress = true;
      this.importTotalBatches = totalBatches;
      this.importCurrentBatch = 0;
      this.importProgress = 0;
      this.importSuccessCount = 0;
      this.importErrorCount = 0;
      
      this.cdr.detectChanges();
      
      for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
        const start = batchIndex * FIRESTORE_BATCH_LIMIT;
        const end = Math.min(start + FIRESTORE_BATCH_LIMIT, jsonData.length);
        const batchData = jsonData.slice(start, end);
        
        console.log(`📦 Batch ${batchIndex + 1}/${totalBatches}: ${start + 1}-${end}`);
        
        // Tạo Firestore Batch (BATCH WRITE THỰC SỰ - CHỈ 1 NETWORK CALL)
        const batch = this.firestore.firestore.batch();
        let batchOperations = 0;
        
        // Validate và thêm vào batch
        for (let i = 0; i < batchData.length; i++) {
          const row = batchData[i];
          const rowIndex = start + i;
          
          try {
            const materialCode = row.materialCode?.toString().trim().toUpperCase();
            const unitWeightRaw = row.unitWeight?.toString().trim();
            
            // Parse decimal
            const unitWeight = parseFloat(unitWeightRaw?.replace(',', '.') || '0');

            // Validation
            if (!materialCode || materialCode === '') {
              errors.push(`Dòng ${rowIndex + 2}: Thiếu materialCode`);
              errorCount++;
              continue;
            }

            if (!unitWeightRaw || unitWeightRaw === '') {
              errors.push(`${materialCode}: Thiếu unitWeight`);
              errorCount++;
              continue;
            }

            if (isNaN(unitWeight) || unitWeight <= 0) {
              errors.push(`${materialCode}: unitWeight không hợp lệ (${unitWeightRaw})`);
              errorCount++;
              continue;
            }

            // Thêm vào batch
            const docRef = this.firestore.firestore.collection('materials').doc(materialCode);
            batch.set(docRef, {
              materialCode: materialCode,
              unitWeight: unitWeight,
              updatedAt: new Date()
            }, { merge: true });
            
            batchOperations++;
            
            const formattedWeight = unitWeight % 1 === 0 ? unitWeight.toString() : unitWeight.toFixed(3).replace(/\.?0+$/, '');
            successList.push(`${materialCode} = ${formattedWeight}g`);
            
          } catch (error) {
            errors.push(`${row.materialCode || 'Unknown'}: ${error.message}`);
            errorCount++;
          }
        }
        
        // COMMIT BATCH (1 lần cho tất cả operations)
        if (batchOperations > 0) {
          await batch.commit();
          successCount += batchOperations;
          console.log(`✅ Committed ${batchOperations} operations`);
        }
        
        // Update progress
        this.importCurrentBatch = batchIndex + 1;
        this.importProgress = Math.round((this.importCurrentBatch / totalBatches) * 100);
        this.importSuccessCount = successCount;
        this.importErrorCount = errorCount;
        
        // Update UI mỗi batch
        this.cdr.detectChanges();
        console.log(`Progress: ${this.importProgress}% - Success: ${successCount}, Errors: ${errorCount}`);
      }

      console.log('📊 Import completed');
      console.log('  ✅ Success:', successCount);
      console.log('  ❌ Errors:', errorCount);

      // Hide progress modal
      this.showImportProgress = false;
      this.cdr.detectChanges();

      // Show results
      let message = `📊 KẾT QUẢ IMPORT:\n\n`;
      message += `✅ Thành công: ${successCount} materials\n`;
      message += `❌ Lỗi: ${errorCount} materials\n`;
      
      if (successCount > 0 && successCount <= 10) {
        message += `\n📦 Đã import:\n` + successList.slice(0, 10).join('\n');
      } else if (successCount > 10) {
        message += `\n📦 Đã import (10 đầu tiên):\n` + successList.slice(0, 10).join('\n');
        message += `\n... và ${successCount - 10} materials khác`;
      }
      
      if (errors.length > 0) {
        message += '\n\n❌ LỖI:';
        if (errors.length <= 10) {
          message += '\n' + errors.join('\n');
        } else {
          message += '\n' + errors.slice(0, 10).join('\n') + `\n... và ${errors.length - 10} lỗi khác`;
        }
        message += '\n\n💡 Mở Console (F12) để xem chi tiết';
      }

      // Show result
      alert(message);

      if (successCount > 0) {
        console.log('🔄 Reloading catalog...');
        
        // CHỈ ĐỢI 500MS thay vì 2000ms
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Force reload catalog
        this.catalogLoaded = false;
        this.catalogCache.clear();
        
        // Reload nhanh - không log từng item
        const snapshot = await this.firestore.collection('materials').get().toPromise();
        snapshot.forEach(doc => {
          const item = doc.data() as any;
          if (item.materialCode) {
            const code = item.materialCode.toString().trim().toUpperCase();
            this.catalogCache.set(code, {
              materialCode: code,
              materialName: item.materialName || item.name,
              unitWeight: item.unitWeight || item.unit_weight || 0,
              unit: item.unit,
              standardPacking: item.standardPacking
            });
          }
        });
        
        this.catalogLoaded = true;
        console.log('✅ Catalog reloaded:', this.catalogCache.size, 'items');
        
        // Reload rack data
        this.loadRackDataFromInventory();
      }

      // Reset file input
      event.target.value = '';

    } catch (error) {
      console.error('❌ Error processing file:', error);
      alert(`❌ Lỗi xử lý file: ${error.message}`);
    }
  }

  // Export position details (materials at specific position)
  exportPositionDetails(position: string): void {
    console.log('📥 Exporting details for position:', position);
    
    // Filter materials by position
    const materialsAtPosition = this.inventoryMaterials.filter(material => {
      const normalizedPos = this.normalizePosition(material.location);
      return normalizedPos === position;
    });
    
    if (materialsAtPosition.length === 0) {
      alert(`⚠️ Không có vật tư tại vị trí ${position}`);
      return;
    }
    
    console.log('📦 Materials at position:', materialsAtPosition);
    console.log('🔍 Sample material fields:', materialsAtPosition[0]);
    
    // Prepare export data
    const exportData: any[] = [];
    let totalWeightKg = 0;
    let materialsWithWeight = 0;
    let materialsWithoutWeight = 0;
    
    materialsAtPosition.forEach(material => {
      const materialCode = material.materialCode?.toString().trim().toUpperCase();
      
      // TÍNH CỘT TỒN KHO CHÍNH XÁC: openingStock + quantity - exported - xt
      // Giống logic trong materials-asm1 component
      const openingStockValue = material.openingStock !== null && material.openingStock !== undefined 
        ? material.openingStock 
        : 0;
      const stockQty = openingStockValue + (material.quantity || 0) - (material.exported || 0) - (material.xt || 0);
      
      // Debug log
      console.log(`${materialCode}: opening=${material.openingStock}, qty=${material.quantity}, exported=${material.exported}, xt=${material.xt}, calculated stock=${stockQty}`);
      
      // Get catalog info
      const catalogItem = this.catalogCache.get(materialCode);
      const unitWeightGram = catalogItem?.unitWeight || 0;
      const materialName = catalogItem?.materialName || '';
      
      // Calculate total weight in kg
      const totalWeightKgForItem = (stockQty * unitWeightGram) / 1000;
      totalWeightKg += totalWeightKgForItem;
      
      if (unitWeightGram > 0) {
        materialsWithWeight++;
      } else {
        materialsWithoutWeight++;
      }
      
      exportData.push({
        'Mã hàng': materialCode,
        'Tên hàng': materialName,
        'Vị trí': material.location,
        'Tồn đầu': material.openingStock || 0,
        'Số lượng nhập': material.quantity || 0,
        'Đã xuất': material.exported || 0,
        'Cần xuất (XT)': material.xt || 0,
        'Tồn kho': stockQty,
        'Đơn vị trọng lượng (g)': unitWeightGram > 0 ? unitWeightGram : 'Chưa có',
        'Tổng trọng lượng (kg)': unitWeightGram > 0 ? totalWeightKgForItem.toFixed(2) : 'N/A'
      });
    });
    
    // Sort by total weight (descending)
    exportData.sort((a, b) => {
      const weightA = parseFloat(a['Tổng trọng lượng (kg)']) || 0;
      const weightB = parseFloat(b['Tổng trọng lượng (kg)']) || 0;
      return weightB - weightA;
    });
    
    // Create summary sheet
    const summary = [
      { 'Thông tin': 'Vị trí', 'Giá trị': position },
      { 'Thông tin': 'Tổng số loại vật tư', 'Giá trị': materialsAtPosition.length },
      { 'Thông tin': 'Vật tư có unitWeight', 'Giá trị': materialsWithWeight },
      { 'Thông tin': 'Vật tư chưa có unitWeight', 'Giá trị': materialsWithoutWeight },
      { 'Thông tin': 'Tổng trọng lượng (kg)', 'Giá trị': totalWeightKg.toFixed(2) },
      { 'Thông tin': 'Ngày xuất', 'Giá trị': new Date().toLocaleString('vi-VN') }
    ];
    
    // Get rack info
    const rackInfo = this.rackLoadingData.find(r => r.position === position);
    if (rackInfo) {
      summary.push(
        { 'Thông tin': 'Max Capacity (kg)', 'Giá trị': rackInfo.maxCapacity },
        { 'Thông tin': 'Current Load (kg)', 'Giá trị': rackInfo.currentLoad.toFixed(1) },
        { 'Thông tin': 'Mức sử dụng (%)', 'Giá trị': rackInfo.usage.toFixed(1) + '%' },
        { 'Thông tin': 'Trạng thái', 'Giá trị': this.getRackStatusLabel(rackInfo.usage) }
      );
    }
    
    // Create workbook
    const wb = XLSX.utils.book_new();
    
    // Add summary sheet
    const wsSummary = XLSX.utils.json_to_sheet(summary);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Tóm tắt');
    
    // Add details sheet
    const wsDetails = XLSX.utils.json_to_sheet(exportData);
    XLSX.utils.book_append_sheet(wb, wsDetails, 'Chi tiết');
    
    // Download file
    const fileName = `position_${position}_${new Date().getTime()}.xlsx`;
    XLSX.writeFile(wb, fileName);
    
    console.log(`✅ Exported ${materialsAtPosition.length} materials from position ${position}`);
    
    // Show notification
    const message = `✅ Đã xuất chi tiết vị trí ${position}\n\n` +
                   `📦 Tổng số loại vật tư: ${materialsAtPosition.length}\n` +
                   `⚖️ Tổng trọng lượng: ${totalWeightKg.toFixed(2)} kg\n` +
                   `${materialsWithoutWeight > 0 ? `\n⚠️ ${materialsWithoutWeight} vật tư chưa có unitWeight` : ''}`;
    
    alert(message);
  }
} 