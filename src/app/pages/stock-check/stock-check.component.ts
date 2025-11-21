import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as XLSX from 'xlsx';

interface StockCheckMaterial {
  stt: number;
  materialCode: string;
  poNumber: string;
  imd: string;
  stock: number;
  location: string;
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
  
  // Scanner
  scanStep: 'idle' | 'employee' | 'material' = 'idle';
  scannedEmployeeId = '';
  showScanModal = false;
  scanMessage = '';
  scanInput = '';
  scanHistory: string[] = [];

  // Filter state
  filterMode: 'all' | 'checked' | 'unchecked' = 'all';

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

  /**
   * Set filter mode
   */
  setFilterMode(mode: 'all' | 'checked' | 'unchecked'): void {
    this.filterMode = mode;
    this.applyFilter();
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
    // Component initialized, waiting for factory selection
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
    this.loadData();
  }

  /**
   * Load inventory data from Firestore
   */
  loadData(): void {
    if (!this.selectedFactory) return;

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
          // Filter: Only show materials starting with A or B
          if (!mat.materialCode || (!mat.materialCode.toUpperCase().startsWith('A') && !mat.materialCode.toUpperCase().startsWith('B'))) {
            return;
          }
          
          const key = `${mat.materialCode}_${mat.poNumber}`;
          
          if (groupedMap.has(key)) {
            const existing = groupedMap.get(key);
            // Sum up quantities
            existing.openingStock = (existing.openingStock || 0) + (mat.openingStock || 0);
            existing.quantity = (existing.quantity || 0) + (mat.quantity || 0);
            existing.exported = (existing.exported || 0) + (mat.exported || 0);
            existing.xt = (existing.xt || 0) + (mat.xt || 0);
          } else {
            groupedMap.set(key, {
              materialCode: mat.materialCode,
              poNumber: mat.poNumber,
              location: mat.location || '',
              openingStock: mat.openingStock || 0,
              quantity: mat.quantity || 0,
              exported: mat.exported || 0,
              xt: mat.xt || 0,
              importDate: mat.importDate ? mat.importDate.toDate() : null,
              batchNumber: mat.batchNumber || ''
            });
          }
        });

        // Convert map to array and calculate stock
        const materialsArray = Array.from(groupedMap.values()).map((mat, index) => {
          const stock = (mat.openingStock || 0) + (mat.quantity || 0) - (mat.exported || 0) - (mat.xt || 0);
          
          return {
            stt: index + 1,
            materialCode: mat.materialCode,
            poNumber: mat.poNumber,
            imd: this.getDisplayIMD(mat),
            stock: stock,
            location: mat.location,
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

        // Load stock check data from Firebase
        await this.loadStockCheckData(materialsArray);

        this.allMaterials = materialsArray;

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
        
        this.isLoading = false;
      });
  }

  /**
   * Load stock check data from Firebase
   */
  async loadStockCheckData(materials: StockCheckMaterial[]): Promise<void> {
    try {
      const stockCheckSnapshot = await this.firestore
        .collection('stock-check', ref =>
          ref.where('factory', '==', this.selectedFactory)
        )
        .get()
        .toPromise();

      if (stockCheckSnapshot && !stockCheckSnapshot.empty) {
        const stockCheckMap = new Map<string, StockCheckData>();
        
        stockCheckSnapshot.forEach(doc => {
          const data = doc.data() as StockCheckData;
          const key = `${data.materialCode}_${data.poNumber}_${data.imd}`;
          stockCheckMap.set(key, data);
        });

        // Apply stock check data to materials
        materials.forEach(mat => {
          const key = `${mat.materialCode}_${mat.poNumber}_${mat.imd}`;
          const checkData = stockCheckMap.get(key);
          
          if (checkData) {
            mat.stockCheck = '✓';
            mat.qtyCheck = checkData.qtyCheck;
            mat.idCheck = checkData.idCheck;
            mat.dateCheck = checkData.dateCheck?.toDate ? checkData.dateCheck.toDate() : checkData.dateCheck;
          }
        });

        console.log(`✅ Loaded stock check data for ${stockCheckMap.size} items`);
      }
    } catch (error) {
      console.error('❌ Error loading stock check data:', error);
    }
  }

  /**
   * Save stock check data to Firebase
   */
  async saveStockCheckToFirebase(material: StockCheckMaterial): Promise<void> {
    try {
      // Replace special characters that are not allowed in Firebase document IDs
      const sanitizedMaterialCode = material.materialCode.replace(/\//g, '_');
      const sanitizedPoNumber = material.poNumber.replace(/\//g, '_');
      const sanitizedImd = material.imd.replace(/\//g, '_');
      
      const docId = `${this.selectedFactory}_${sanitizedMaterialCode}_${sanitizedPoNumber}_${sanitizedImd}`;
      
      const checkData = {
        factory: this.selectedFactory,
        materialCode: material.materialCode,
        poNumber: material.poNumber,
        imd: material.imd,
        stockCheck: material.stockCheck,
        qtyCheck: material.qtyCheck,
        idCheck: material.idCheck,
        dateCheck: material.dateCheck,
        updatedAt: new Date()
      };

      await this.firestore
        .collection('stock-check')
        .doc(docId)
        .set(checkData, { merge: true });

      console.log(`✅ Saved stock check to Firebase: ${material.materialCode} (docId: ${docId})`);
    } catch (error) {
      console.error('❌ Error saving stock check to Firebase:', error);
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
    this.showScanModal = true;
    this.scanStep = 'employee';
    this.scannedEmployeeId = '';
    this.scanInput = '';
    this.scanMessage = 'Nhập hoặc scan mã nhân viên (ASP + 6 số)';
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

    if (this.scanStep === 'employee') {
      // Process employee ID
      const normalizedId = scannedData.replace(/ÁP/gi, 'ASP').toUpperCase();
      
      // Check if it matches ASP + 4-6 digits
      if (/^ASP\d{4,6}$/.test(normalizedId)) {
        this.scannedEmployeeId = normalizedId;
        this.scanMessage = `✓ ID: ${normalizedId}\n\nBây giờ scan mã hàng hóa`;
        this.scanStep = 'material';
        this.scanInput = '';
        this.cdr.detectChanges();
        
        // Re-focus input
        setTimeout(() => {
          const input = document.getElementById('scan-input') as HTMLInputElement;
          if (input) input.focus();
        }, 100);
      } else {
        this.scanMessage = '❌ Mã nhân viên không hợp lệ!\n\nVui lòng nhập mã ASP + 4-6 số';
        this.scanInput = '';
        this.cdr.detectChanges();
      }
    } else if (this.scanStep === 'material') {
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
          
          // Update the material
          matchingMaterial.stockCheck = '✓';
          matchingMaterial.qtyCheck = parseFloat(quantity);
          matchingMaterial.idCheck = this.scannedEmployeeId;
          matchingMaterial.dateCheck = new Date();
          
          // Save to Firebase
          await this.saveStockCheckToFirebase(matchingMaterial);
          
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
          console.error('❌ No match found for:', { materialCode, poNumber, imd });
          
          // Show detailed error with available materials
          const materialsWithSameCode = this.allMaterials.filter(m => 
            m.materialCode.toUpperCase().trim() === materialCode.toUpperCase().trim()
          );
          
          if (materialsWithSameCode.length > 0) {
            console.log('📋 Materials with same code but different PO/IMD:', 
              materialsWithSameCode.map(m => ({ po: m.poNumber, imd: m.imd }))
            );
          }
          
          this.scanMessage = `❌ Không tìm thấy:\n${materialCode} | PO: ${poNumber} | IMD: ${imd}\n\nKiểm tra console (F12) để xem chi tiết`;
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
      'Stock Check': mat.stockCheck || '',
      'Qty Check': mat.qtyCheck || '',
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
      { wch: 12 }, // Stock Check
      { wch: 10 }, // Qty Check
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
