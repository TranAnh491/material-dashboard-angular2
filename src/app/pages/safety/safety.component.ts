import { Component, OnInit, OnDestroy, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { Subject, BehaviorSubject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import * as XLSX from 'xlsx';
import { TabPermissionService } from '../../services/tab-permission.service';
import { FactoryAccessService } from '../../services/factory-access.service';
import { SafetyService } from '../../services/safety.service';

export interface SafetyMaterial {
  id?: string;
  materialCode: string;
  scanDate: Date;
  quantityASM1: number;
  quantityASM2: number;
  totalQuantity: number;
  safety: number;
  status: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// Add new interface for import data
export interface SafetyImportData {
  materialCode: string;
  safety: number;
}

@Component({
  selector: 'app-safety',
  templateUrl: './safety.component.html',
  styleUrls: ['./safety.component.scss']
})
export class SafetyComponent implements OnInit, OnDestroy, AfterViewInit {
  // Data properties
  safetyMaterials: SafetyMaterial[] = [];
  filteredMaterials: SafetyMaterial[] = [];
  
  // Loading state
  isLoading = false;
  
  // Search and filter
  searchTerm = '';
  searchType: 'material' = 'material';
  private searchSubject = new Subject<string>();
  
  // Total counter
  private totalCountSubject = new BehaviorSubject<number>(0);
  public totalCount$ = this.totalCountSubject.asObservable();
  
  // Scan mode
  isScanMode = false;
  scanFactory = '';
  
  // Scan date
  scanDate = new Date();
  
  // Permission
  canDelete = false;
  
  // Dropdown state
  isDropdownOpen = false;
  
  private destroy$ = new Subject<void>();

  // Import properties
  importFile: File | null = null;
  isImporting = false;
  importProgress = 0;

  constructor(
    private firestore: AngularFirestore,
    private auth: AngularFireAuth,
    private tabPermissionService: TabPermissionService,
    private factoryAccessService: FactoryAccessService,
    private safetyService: SafetyService,
    private cdr: ChangeDetectorRef
  ) {
    // Setup search debouncing
    this.searchSubject.pipe(
      takeUntil(this.destroy$),
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(term => {
      this.performSearch(term);
    });
  }

  ngOnInit() {
    this.checkPermissions();
    this.loadSafetyData();
    
    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      this.isDropdownOpen = false;
    });
    
    // Listen for keyboard input when in scan mode
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
  }

  ngAfterViewInit() {
    this.cdr.detectChanges();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    
    // Remove event listeners
    document.removeEventListener('click', () => {
      this.isDropdownOpen = false;
    });
    document.removeEventListener('keydown', this.handleKeyDown.bind(this));
  }

  private async checkPermissions() {
    try {
      // Check tab access permission for safety tab
      this.tabPermissionService.canAccessTab('safety')
        .pipe(takeUntil(this.destroy$))
        .subscribe(canAccess => {
          console.log(`🔍 DEBUG: Tab permission result for 'safety': ${canAccess}`);
          
          // Set delete permission based on tab access
          this.canDelete = canAccess;
          
          console.log('🔑 Safety Permissions loaded:', {
            canDelete: this.canDelete
          });
        });
    } catch (error) {
      console.error('Error checking permissions:', error);
    }
  }

  private async loadSafetyData() {
    this.isLoading = true;
    try {
      // Subscribe to safety materials from service
      this.safetyService.getSafetyMaterials().subscribe(materials => {
        // Ensure scanDate is properly converted to Date objects
        this.safetyMaterials = materials.map(material => ({
          ...material,
          scanDate: material.scanDate ? new Date(material.scanDate) : new Date(),
          createdAt: material.createdAt ? new Date(material.createdAt) : new Date(),
          updatedAt: material.updatedAt ? new Date(material.updatedAt) : new Date()
        }));
        
        // Sắp xếp theo mã hàng
        this.safetyMaterials.sort((a, b) => {
          return a.materialCode.localeCompare(b.materialCode);
        });
        
        this.filteredMaterials = [...this.safetyMaterials];
        this.updateTotalCount();
        this.isLoading = false;
        
        console.log('📊 Loaded safety materials:', this.safetyMaterials.length);
        console.log('📅 Sample scan dates:', this.safetyMaterials.slice(0, 3).map(m => ({
          code: m.materialCode,
          scanDate: this.formatDate(m.scanDate)
        })));
      });
    } catch (error) {
      console.error('Error loading safety data:', error);
      this.isLoading = false;
    }
  }

  toggleDropdown(event: Event) {
    event.stopPropagation();
    this.isDropdownOpen = !this.isDropdownOpen;
  }



  private updateTotalCount() {
    this.totalCountSubject.next(this.filteredMaterials.length);
  }

  onSearchInput(event: any) {
    const term = event.target.value;
    this.searchTerm = term;
    this.searchSubject.next(term);
  }

  onSearchKeyUp(event: any) {
    if (event.key === 'Enter') {
      this.performSearch(this.searchTerm);
    }
  }

  private performSearch(term: string) {
    if (!term || term.trim().length < 3) {
      this.filteredMaterials = [...this.safetyMaterials];
    } else {
      this.filteredMaterials = this.safetyMaterials.filter(material => {
        const searchLower = term.toLowerCase();
        return (
          material.materialCode.toLowerCase().includes(searchLower) ||
          material.safety.toString().includes(searchLower) ||
          material.status.toLowerCase().includes(searchLower)
        );
      });
      
      // Sắp xếp kết quả tìm kiếm theo mã hàng
      this.filteredMaterials.sort((a, b) => {
        return a.materialCode.localeCompare(b.materialCode);
      });
    }
    this.updateTotalCount();
  }

  clearSearch() {
    this.searchTerm = '';
    this.filteredMaterials = [...this.safetyMaterials];
    // Đảm bảo thứ tự sắp xếp được giữ nguyên
    this.updateTotalCount();
  }

  changeSearchType(type: 'material') {
    this.searchType = type;
    this.searchTerm = '';
    this.filteredMaterials = [...this.safetyMaterials];
    // Thứ tự sắp xếp đã được giữ nguyên từ safetyMaterials
    this.updateTotalCount();
  }

  onFactoryChange() {
    // Không còn filter theo factory, hiển thị tất cả
    this.filteredMaterials = [...this.safetyMaterials];
    this.updateTotalCount();
  }

  refreshData() {
    this.loadSafetyData();
  }

  initializeSampleData() {
    this.safetyService.initializeSampleData().then(() => {
      console.log('Sample data initialized');
      this.refreshData();
    }).catch(error => {
      console.error('Error initializing sample data:', error);
    });
  }

  exportToExcel() {
    try {
      const exportData = this.filteredMaterials.map(material => ({
        'Ngày Scan': this.formatDate(material.scanDate),
        'Mã hàng': material.materialCode,
        'Lượng ASM1': material.quantityASM1,
        'Lượng ASM2': material.quantityASM2,
        'Tổng': material.totalQuantity,
        'Safety': material.safety,
        'Tình Trạng (%)': this.getStatusText(material),
        'Phần Trăm Tồn Kho': this.getStatusPercentage(material)
      }));

      const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(exportData);
      const wb: XLSX.WorkBook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Safety Data');
      
      XLSX.writeFile(wb, `Safety_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
    }
  }

     // Scan mode methods
   startScanMode(factory: 'ASM1' | 'ASM2') {
     this.isScanMode = true;
     this.scanFactory = factory;
     // Tự động set ngày hiện tại khi bắt đầu scan
     this.scanDate = new Date();
     
     // Clear any existing scan buffer
     this.scanBuffer = '';
     if (this.scanTimeout) {
       clearTimeout(this.scanTimeout);
     }
     
     console.log(`🚀 Started scan mode for ${factory} on ${this.formatDate(this.scanDate)}`);
     console.log('📅 Current scan date:', this.scanDate);
     console.log('📅 Current scan date (ISO):', this.scanDate.toISOString());
   }

  stopScanMode() {
    this.isScanMode = false;
    this.scanFactory = '';
    console.log('Stopped scan mode');
  }

  // Handle keyboard input for scan mode
  private handleKeyDown(event: KeyboardEvent) {
    if (!this.isScanMode) return;
    
    // Ignore if typing in input fields
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    
    // Start collecting characters when typing
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey) {
      this.startCollectingScanData(event.key);
    }
  }

  private scanBuffer = '';
  private scanTimeout: any;

  private startCollectingScanData(char: string) {
    this.scanBuffer += char;
    
    // Clear previous timeout
    if (this.scanTimeout) {
      clearTimeout(this.scanTimeout);
    }
    
    // Set timeout to process scan data after 100ms of no input
    this.scanTimeout = setTimeout(() => {
      if (this.scanBuffer.trim()) {
        console.log('🔍 Processing scan buffer:', this.scanBuffer.trim());
        this.processScannedData(this.scanBuffer.trim());
        this.scanBuffer = '';
      }
    }, 100);
  }

  // Process scanned data from tem format: Rxxxxxx yyyy or Bxxxxxx yyyy
  processScannedData(scannedText: string) {
    if (!this.isScanMode || !this.scanFactory) {
      console.log('❌ Not in scan mode or no factory selected');
      return;
    }

    console.log('🔍 Processing scanned data:', scannedText);
    console.log('🏭 Current scan factory:', this.scanFactory);
    console.log('📅 Current scan date:', this.formatDate(this.scanDate));

    // Parse tem format: Rxxxxxx yyyy or Bxxxxxx yyyy (where xxxxxx is 6 digits)
    const match = scannedText.match(/^([RB])(\d{6})\s+(\d+)$/);
    if (match) {
      const prefix = match[1]; // R or B
      const digits = match[2]; // 6 digits
      const quantity = parseInt(match[3], 10);
      
      if (quantity > 0) {
        const materialCode = prefix + digits; // Full 7-character code
        console.log(`✅ Parsed scan data: ${materialCode} - ${quantity}`);
        this.addOrUpdateScannedMaterial(materialCode, quantity);
        // Show success feedback
        this.showScanFeedback('success', `Đã scan: ${materialCode} - ${quantity}`);
      } else {
        console.log('❌ Invalid quantity:', quantity);
        this.showScanFeedback('error', 'Số lượng không hợp lệ');
      }
    } else {
      console.log('❌ Invalid tem format:', scannedText);
      this.showScanFeedback('error', 'Định dạng tem không đúng: Rxxxxxx yyyy hoặc Bxxxxxx yyyy (x là 6 số)');
    }
  }

  private showScanFeedback(type: 'success' | 'error', message: string) {
    // Create temporary feedback element
    const feedback = document.createElement('div');
    feedback.className = `scan-feedback scan-feedback-${type}`;
    feedback.textContent = message;
    feedback.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 6px;
      color: white;
      font-weight: 500;
      z-index: 10000;
      animation: slideInRight 0.3s ease-out;
      ${type === 'success' ? 'background: #4caf50;' : 'background: #f44336;'}
    `;
    
    document.body.appendChild(feedback);
    
    // Remove after 3 seconds
    setTimeout(() => {
      if (feedback.parentNode) {
        feedback.parentNode.removeChild(feedback);
      }
    }, 3000);
  }

  private addOrUpdateScannedMaterial(materialCode: string, quantity: number) {
    console.log(`🔍 Processing scan: ${materialCode} - ${quantity} for ${this.scanFactory} on ${this.formatDate(this.scanDate)}`);
    
    // Ensure scan date is properly set
    if (!this.scanDate) {
      this.scanDate = new Date();
      console.log('⚠️ Scan date was null, set to current date:', this.formatDate(this.scanDate));
    }
    
    // Check if material already exists by materialCode (regardless of scan date)
    const existingMaterial = this.safetyMaterials.find(
      m => m.materialCode === materialCode
    );

    console.log('🔍 Existing material found:', existingMaterial);
    console.log('📅 Current scan date:', this.scanDate);
    console.log('📅 Current scan date (ISO):', this.scanDate.toISOString());
    console.log('📊 Available materials:', this.safetyMaterials.map(m => ({
      code: m.materialCode,
      scanDate: this.formatDate(m.scanDate),
      scanDateISO: m.scanDate ? m.scanDate.toISOString() : 'null',
      quantityASM1: m.quantityASM1,
      quantityASM2: m.quantityASM2,
      totalQuantity: m.totalQuantity
    })));

    if (existingMaterial) {
      // Update existing material - add quantity to appropriate factory and update scan date
      let updateData: Partial<SafetyMaterial> = {
        scanDate: this.scanDate, // Always update to latest scan date
        updatedAt: new Date()
      };
      
      if (this.scanFactory === 'ASM1') {
        const newQuantityASM1 = existingMaterial.quantityASM1 + quantity;
        updateData.quantityASM1 = newQuantityASM1;
        updateData.totalQuantity = newQuantityASM1 + existingMaterial.quantityASM2;
        console.log(`🔄 Updating ASM1 quantity: ${existingMaterial.quantityASM1} + ${quantity} = ${newQuantityASM1}`);
      } else if (this.scanFactory === 'ASM2') {
        const newQuantityASM2 = existingMaterial.quantityASM2 + quantity;
        updateData.quantityASM2 = newQuantityASM2;
        updateData.totalQuantity = existingMaterial.quantityASM1 + newQuantityASM2;
        console.log(`🔄 Updating ASM2 quantity: ${existingMaterial.quantityASM2} + ${quantity} = ${newQuantityASM2}`);
      }
      
      this.safetyService.updateSafetyMaterial(existingMaterial.id!, updateData).then(() => {
        console.log(`✅ Successfully updated ${materialCode} quantity for ${this.scanFactory} and scan date to ${this.formatDate(this.scanDate)}`);
        this.refreshData();
      }).catch(error => {
        console.error('❌ Error updating material:', error);
      });
    } else {
      // Add new material
      const newMaterial: Omit<SafetyMaterial, 'id'> = {
        scanDate: this.scanDate,
        materialCode: materialCode,
        quantityASM1: this.scanFactory === 'ASM1' ? quantity : 0,
        quantityASM2: this.scanFactory === 'ASM2' ? quantity : 0,
        totalQuantity: quantity,
        safety: 0, // ALWAYS 0 for new scanned materials - no safety level until imported
        status: 'Active'
      };

      console.log(`➕ Adding new material:`, newMaterial);

      this.safetyService.addSafetyMaterial(newMaterial).then(() => {
        console.log(`✅ Successfully added new material: ${materialCode} with quantity ${quantity} for ${this.scanFactory}`);
        this.refreshData();
      }).catch(error => {
        console.error('❌ Error adding material:', error);
      });
    }
  }

  // Helper method to check if two dates are the same day
  private isSameDate(date1: Date, date2: Date): boolean {
    if (!date1 || !date2) {
      console.log('⚠️ One of the dates is null/undefined:', { date1, date2 });
      return false;
    }
    
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    
    // Check if dates are valid
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
      console.log('⚠️ One of the dates is invalid:', { date1, date2, d1, d2 });
      return false;
    }
    
    // Normalize to start of day for comparison
    const d1Normalized = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
    const d2Normalized = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
    
    const isSame = d1Normalized.getTime() === d2Normalized.getTime();
    
    console.log('📅 Date comparison:', {
      date1: this.formatDate(date1),
      date2: this.formatDate(date2),
      d1Normalized: d1Normalized.toISOString(),
      d2Normalized: d2Normalized.toISOString(),
      isSame
    });
    
    return isSame;
  }

  // Helper method to format date for display
  formatDate(date: Date): string {
    if (!date) {
      console.log('⚠️ formatDate: date is null/undefined');
      return 'N/A';
    }
    
    try {
      const d = new Date(date);
      
      // Check if date is valid
      if (isNaN(d.getTime())) {
        console.log('⚠️ formatDate: invalid date:', date);
        return 'Invalid Date';
      }
      
      return d.toLocaleDateString('vi-VN');
    } catch (error) {
      console.error('❌ Error formatting date:', error, date);
      return 'Error';
    }
  }

  // Manual input for safety column
  updateSafety(material: SafetyMaterial, safety: string | number) {
    const safetyValue = safety === null || safety === undefined || safety === '' ? 0 : Number(safety);
    this.safetyService.updateSafetyMaterial(material.id!, {
      safety: safetyValue,
      scanDate: new Date(), // Cập nhật scanDate thành ngày hiện tại khi nhập tay
      updatedAt: new Date()
    }).then(() => {
      console.log(`Updated safety for ${material.materialCode}: ${safetyValue} and scan date to ${this.formatDate(new Date())}`);
      this.refreshData();
    }).catch(error => {
      console.error('Error updating safety:', error);
    });
  }

  // Test scan method for development
  testScan() {
    const testInput = document.querySelector('.test-input') as HTMLInputElement;
    if (testInput && testInput.value.trim()) {
      const testValue = testInput.value.trim();
      console.log('🧪 Test scan with value:', testValue);
      this.processScannedData(testValue);
      testInput.value = '';
    } else {
      console.log('❌ Test input is empty or not found');
    }
  }

  // Test scan with specific values for debugging
  testScanWithValue(value: string) {
    console.log('🧪 Test scan with specific value:', value);
    this.processScannedData(value);
  }

  // Debug scan date and materials
  debugScanInfo() {
    console.log('🔍 DEBUG SCAN INFO:');
    console.log('📅 Current scan date:', this.scanDate);
    console.log('📅 Current scan date (ISO):', this.scanDate ? this.scanDate.toISOString() : 'null');
    console.log('🏭 Current scan factory:', this.scanFactory);
    console.log('📊 Total materials loaded:', this.safetyMaterials.length);
    console.log('📊 Materials with scan dates:', this.safetyMaterials.map(m => ({
      code: m.materialCode,
      scanDate: this.formatDate(m.scanDate),
      scanDateISO: m.scanDate ? m.scanDate.toISOString() : 'null',
      quantityASM1: m.quantityASM1,
      quantityASM2: m.quantityASM2,
      totalQuantity: m.totalQuantity
    })));
  }

  // Delete material - chỉ xóa số lượng thực tế, giữ nguyên mã hàng và safety level
  deleteMaterial(material: SafetyMaterial) {
    if (confirm(`Bạn có chắc muốn xóa số lượng thực tế của ${material.materialCode}? Mã hàng và Safety Level sẽ được giữ nguyên.`)) {
      // Thay vì xóa hoàn toàn, chỉ reset số lượng thực tế về 0
      this.safetyService.updateSafetyMaterial(material.id!, {
        quantityASM1: 0,
        quantityASM2: 0,
        totalQuantity: 0,
        updatedAt: new Date()
      }).then(() => {
        console.log(`✅ Đã xóa số lượng thực tế của ${material.materialCode}, giữ nguyên mã hàng và safety level`);
        this.showScanFeedback('success', `Đã xóa số lượng thực tế của ${material.materialCode}`);
        this.refreshData();
      }).catch(error => {
        console.error('❌ Lỗi khi xóa số lượng thực tế:', error);
        this.showScanFeedback('error', 'Lỗi khi xóa số lượng thực tế');
      });
    }
  }

  // Import safety levels from Excel
  importSafetyLevels() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,.xls';
    fileInput.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.processImportFile(file);
      }
    };
    fileInput.click();
  }

  private async processImportFile(file: File) {
    this.isImporting = true;
    this.importProgress = 0;
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      
      console.log('📁 Import file data:', jsonData);
      
      // Process import data - ensure proper parsing
      const importData: SafetyImportData[] = jsonData.map((row: any) => {
        const materialCode = row['Mã hàng'] || row['materialCode'] || row['Material Code'];
        const safety = parseInt(row['Safety'] || row['safety'] || row['Safety Level']) || 0;
        
        console.log(`📊 Parsing row: Code=${materialCode}, Safety=${safety}`);
        
        return {
          materialCode: materialCode,
          safety: safety
        };
      }).filter(item => {
        const isValid = item.materialCode && item.safety > 0;
        if (!isValid) {
          console.log(`⚠️ Skipping invalid row:`, item);
        }
        return isValid;
      });
      
      console.log('✅ Valid import data:', importData);
      
      if (importData.length === 0) {
        this.showScanFeedback('error', 'Không có dữ liệu hợp lệ trong file import');
        return;
      }
      
      // Update safety levels
      await this.updateSafetyLevelsFromImport(importData);
      
      this.showScanFeedback('success', `Đã import ${importData.length} safety levels thành công`);
      this.refreshData();
      
    } catch (error) {
      console.error('❌ Error importing file:', error);
      this.showScanFeedback('error', 'Lỗi khi import file: ' + error.message);
    } finally {
      this.isImporting = false;
      this.importProgress = 0;
    }
  }

  private async updateSafetyLevelsFromImport(importData: SafetyImportData[]) {
    let updatedCount = 0;
    let errorCount = 0;
    
    console.log('🔄 Starting import process for', importData.length, 'items');
    
    try {
      // First, reset ALL existing materials' safety to 0
      console.log('🔄 Resetting all existing safety levels to 0...');
      const resetPromises = this.safetyMaterials.map(material => 
        this.safetyService.updateSafetyMaterial(material.id!, {
          safety: 0,
          updatedAt: new Date()
        })
      );
      
      await Promise.all(resetPromises);
      console.log('✅ Đã reset tất cả Safety Level về 0');
      
      // Then, update only materials that exist in import file
      for (const item of importData) {
        try {
          console.log(`🔄 Processing import item: ${item.materialCode} - Safety: ${item.safety}`);
          
          // Find existing material with same factory and material code
          const existingMaterial = this.safetyMaterials.find(
            m => m.materialCode === item.materialCode
          );
          
          if (existingMaterial) {
            // Update existing material's safety level from import
            console.log(`🔄 Updating existing material: ${item.materialCode}`);
            await this.safetyService.updateSafetyMaterial(existingMaterial.id!, {
              safety: item.safety,
              updatedAt: new Date()
            });
            updatedCount++;
            console.log(`✅ Updated safety for ${item.materialCode}: ${item.safety}`);
          } else {
            // Create new material with safety level from import
            console.log(`🔄 Creating new material: ${item.materialCode}`);
            const newMaterial: Omit<SafetyMaterial, 'id'> = {
              scanDate: new Date(),
              materialCode: item.materialCode,
              quantityASM1: 0,
              quantityASM2: 0,
              totalQuantity: 0,
              safety: item.safety,
              status: 'Active'
            };
            await this.safetyService.addSafetyMaterial(newMaterial);
            updatedCount++;
            console.log(`✅ Created new material ${item.materialCode} with safety: ${item.safety}`);
          }
          
          this.importProgress = (updatedCount / importData.length) * 100;
          
        } catch (error) {
          errorCount++;
          console.error(`❌ Error processing ${item.materialCode}:`, error);
        }
      }
      
      console.log(`✅ Import completed: ${updatedCount} materials updated, ${errorCount} errors`);
      
      if (errorCount > 0) {
        this.showScanFeedback('error', `Import hoàn thành với ${errorCount} lỗi. Vui lòng kiểm tra console.`);
      }
      
    } catch (error) {
      console.error('❌ Critical error during import:', error);
      throw error;
    }
  }

  // Verify imported safety levels
  verifyImportedSafetyLevels() {
    console.log('🔍 VERIFYING IMPORTED SAFETY LEVELS:');
    console.log('�� Total materials:', this.safetyMaterials.length);
    
    const materialsWithSafety = this.safetyMaterials.filter(m => m.safety > 0);
    const materialsWithoutSafety = this.safetyMaterials.filter(m => m.safety === 0);
    
    console.log('✅ Materials WITH safety levels:', materialsWithSafety.length);
    materialsWithSafety.forEach(m => {
      console.log(`  - ${m.materialCode}: Safety = ${m.safety}`);
    });
    
    console.log('❌ Materials WITHOUT safety levels:', materialsWithoutSafety.length);
    materialsWithoutSafety.forEach(m => {
      console.log(`  - ${m.materialCode}: Safety = ${m.safety}`);
    });
    
    this.showScanFeedback('success', `Kiểm tra: ${materialsWithSafety.length} có safety, ${materialsWithoutSafety.length} không có`);
  }

  // Calculate status percentage based on total quantity vs safety level
  getStatusPercentage(material: SafetyMaterial): number {
    if (material.safety <= 0) return 0;
    return Math.round((material.totalQuantity / material.safety) * 100);
  }

  // Get status class based on percentage
  getStatusClass(material: SafetyMaterial): string {
    const percentage = this.getStatusPercentage(material);
    
    if (percentage >= 100) return 'status-overstock'; // Overstock
    if (percentage >= 80) return 'status-high'; // High stock
    if (percentage >= 50) return 'status-medium'; // Medium stock
    if (percentage >= 20) return 'status-low'; // Low stock
    return 'status-critical'; // Critical stock
  }

  // Get status text based on percentage
  getStatusText(material: SafetyMaterial): string {
    const percentage = this.getStatusPercentage(material);
    
    if (percentage >= 100) return `${percentage}% (Dư thừa)`;
    if (percentage >= 80) return `${percentage}% (Cao)`;
    if (percentage >= 50) return `${percentage}% (Trung bình)`;
    if (percentage >= 20) return `${percentage}% (Thấp)`;
    return `${percentage}% (Thiếu hụt)`;
  }

  trackByFn(index: number, item: SafetyMaterial): string {
    return item.id || index.toString();
  }

  // Download sample Excel template for import
  downloadSampleTemplate() {
    const sampleData = [
      { 'Mã hàng': 'R123456', 'Safety': 100 },
      { 'Mã hàng': 'B018694', 'Safety': 150 },
      { 'Mã hàng': 'R789012', 'Safety': 200 },
      { 'Mã hàng': 'B345678', 'Safety': 120 }
    ];

    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(sampleData);
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Safety Template');
    
    XLSX.writeFile(wb, 'Safety_Import_Template.xlsx');
  }

  // Reset all safety levels to 0 (to fix existing data)
  resetAllSafetyLevels() {
    if (confirm('Bạn có chắc muốn reset tất cả Safety Level về 0? Điều này sẽ xóa tất cả safety levels hiện tại.')) {
      this.isLoading = true;
      
      const updatePromises = this.safetyMaterials.map(material => 
        this.safetyService.updateSafetyMaterial(material.id!, {
          safety: 0,
          updatedAt: new Date()
        })
      );
      
      Promise.all(updatePromises).then(() => {
        console.log('✅ Đã reset tất cả Safety Level về 0');
        this.showScanFeedback('success', 'Đã reset tất cả Safety Level về 0');
        this.refreshData();
      }).catch(error => {
        console.error('❌ Lỗi khi reset Safety Level:', error);
        this.showScanFeedback('error', 'Lỗi khi reset Safety Level');
      }).finally(() => {
        this.isLoading = false;
      });
    }
  }

  // Migrate old data from factory-based structure to new structure
  migrateOldData() {
    if (confirm('Bạn có chắc muốn migrate dữ liệu cũ từ cấu trúc factory sang cấu trúc mới? Điều này sẽ gộp các dòng trùng lặp mã hàng.')) {
      this.isLoading = true;
      
      this.safetyService.migrateOldData().then(() => {
        console.log('✅ Đã migrate dữ liệu cũ thành công');
        this.showScanFeedback('success', 'Đã migrate dữ liệu cũ thành công');
        this.refreshData();
      }).catch(error => {
        console.error('❌ Lỗi khi migrate dữ liệu:', error);
        this.showScanFeedback('error', 'Lỗi khi migrate dữ liệu: ' + error.message);
      }).finally(() => {
        this.isLoading = false;
      });
    }
  }
}
