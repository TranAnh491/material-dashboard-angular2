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
  materialName: string; // Tên hàng - nhập tay
  scanDate: Date;
  quantityASM1: number;
  palletQuantityASM1: number; // Lượng pallet ASM1 - nhập tay
  palletCountASM1: number; // Số pallet ASM1 - tự tính
  quantityASM2: number;
  palletQuantityASM2: number; // Lượng pallet ASM2 - nhập tay
  palletCountASM2: number; // Số pallet ASM2 - tự tính
  totalQuantity: number;
  totalPalletCount: number; // Tổng số pallet
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

     // Format number with thousands separator
   formatNumberWithCommas(value: number): string {
     return value.toLocaleString('en-US');
   }
   
   // Get total pallet count for ASM1
   getTotalPalletASM1(): number {
     return this.filteredMaterials.reduce((total, material) => total + material.palletCountASM1, 0);
   }
   
   // Get total pallet count for ASM2
   getTotalPalletASM2(): number {
     return this.filteredMaterials.reduce((total, material) => total + material.palletCountASM2, 0);
   }

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
        'Tên hàng': material.materialName,
        'Lượng ASM1': material.quantityASM1,
        'Lượng Pallet ASM1': material.palletQuantityASM1,
        'Pallet ASM1': material.palletCountASM1,
        'Lượng ASM2': material.quantityASM2,
        'Lượng Pallet ASM2': material.palletQuantityASM2,
        'Pallet ASM2': material.palletCountASM2,
        'Tổng': material.totalQuantity,
        'Tổng Pallet': material.totalPalletCount,
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
        console.log(`📝 Lưu ý: Số lượng sẽ được cộng dồn vào dòng có sẵn nếu mã hàng đã tồn tại`);
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
    
    // Tìm kiếm material theo materialCode để đảm bảo LUÔN cập nhật dòng có sẵn thay vì tạo mới
    // Đây là logic chính để giải quyết vấn đề: số lượng scan phải nhảy vào dòng có sẵn
    let existingMaterial = this.safetyMaterials.find(
      m => m.materialCode === materialCode
    );

    if (existingMaterial) {
      console.log(`✅ Tìm thấy material có sẵn: ${materialCode} - sẽ cập nhật thay vì tạo mới`);
      console.log(`📊 Số lượng hiện tại: ASM1=${existingMaterial.quantityASM1}, ASM2=${existingMaterial.quantityASM2}`);
    } else {
      console.log(`🆕 Không tìm thấy material: ${materialCode} - sẽ tạo mới`);
    }

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
      // Cập nhật dòng có sẵn - thêm số lượng vào factory tương ứng và cập nhật scan date
      let updateData: Partial<SafetyMaterial> = {
        scanDate: this.scanDate, // Luôn cập nhật thành ngày scan mới nhất
        updatedAt: new Date()
      };
      
             if (this.scanFactory === 'ASM1') {
         const newQuantityASM1 = existingMaterial.quantityASM1 + quantity;
         updateData.quantityASM1 = newQuantityASM1;
         updateData.totalQuantity = newQuantityASM1 + existingMaterial.quantityASM2;
         
         // Tính toán số pallet ASM1
         if (existingMaterial.palletQuantityASM1 > 0) {
           updateData.palletCountASM1 = Math.ceil(newQuantityASM1 / existingMaterial.palletQuantityASM1);
         }
         
         console.log(`🔄 Cập nhật số lượng ASM1: ${existingMaterial.quantityASM1} + ${quantity} = ${newQuantityASM1}`);
       } else if (this.scanFactory === 'ASM2') {
         const newQuantityASM2 = existingMaterial.quantityASM2 + quantity;
         updateData.quantityASM2 = newQuantityASM2;
         updateData.totalQuantity = existingMaterial.quantityASM1 + newQuantityASM2;
         
         // Tính toán số pallet ASM2
         if (existingMaterial.palletQuantityASM2 > 0) {
           updateData.palletCountASM2 = Math.ceil(newQuantityASM2 / existingMaterial.palletQuantityASM2);
         }
         
         console.log(`🔄 Cập nhật số lượng ASM2: ${existingMaterial.quantityASM2} + ${quantity} = ${newQuantityASM2}`);
       }
       
       // Tính toán tổng số pallet
       const totalPalletCount = (updateData.palletCountASM1 || existingMaterial.palletCountASM1 || 0) + 
                               (updateData.palletCountASM2 || existingMaterial.palletCountASM2 || 0);
       updateData.totalPalletCount = totalPalletCount;
      
      this.safetyService.updateSafetyMaterial(existingMaterial.id!, updateData).then(() => {
        console.log(`✅ Đã cập nhật thành công ${materialCode} số lượng cho ${this.scanFactory} và ngày scan thành ${this.formatDate(this.scanDate)}`);
        this.refreshData();
      }).catch(error => {
        console.error('❌ Lỗi khi cập nhật material:', error);
      });
    } else {
      // Chỉ tạo material mới khi thực sự không có material nào với mã hàng này
      const newMaterial: Omit<SafetyMaterial, 'id'> = {
        scanDate: this.scanDate,
        materialCode: materialCode,
        materialName: '', // Tên hàng - để trống, người dùng nhập sau
        quantityASM1: this.scanFactory === 'ASM1' ? quantity : 0,
        palletQuantityASM1: 0, // Lượng pallet ASM1 - để trống, người dùng nhập sau
        palletCountASM1: 0, // Số pallet ASM1 - tự tính
        quantityASM2: this.scanFactory === 'ASM2' ? quantity : 0,
        palletQuantityASM2: 0, // Lượng pallet ASM2 - để trống, người dùng nhập sau
        palletCountASM2: 0, // Số pallet ASM2 - tự tính
        totalQuantity: quantity,
        totalPalletCount: 0, // Tổng số pallet - tự tính
        safety: 0, // Luôn là 0 cho material mới scan - không có safety level cho đến khi import
        status: 'Active'
      };

      console.log(`➕ Tạo material mới:`, newMaterial);

      this.safetyService.addSafetyMaterial(newMaterial).then(() => {
        console.log(`✅ Đã tạo thành công material mới: ${materialCode} với số lượng ${quantity} cho ${this.scanFactory}`);
        this.refreshData();
      }).catch(error => {
        console.error('❌ Lỗi khi tạo material:', error);
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

  // Manual input for material name
  updateMaterialName(material: SafetyMaterial, name: string) {
    const materialName = name || '';
    this.safetyService.updateSafetyMaterial(material.id!, {
      materialName: materialName,
      updatedAt: new Date()
    }).then(() => {
      console.log(`Updated material name for ${material.materialCode}: ${materialName}`);
      this.refreshData();
    }).catch(error => {
      console.error('Error updating material name:', error);
    });
  }

  // Manual input for pallet quantity ASM1
  updatePalletQuantityASM1(material: SafetyMaterial, palletQuantity: string | number) {
    const palletQuantityValue = palletQuantity === null || palletQuantity === undefined || palletQuantity === '' ? 0 : Number(palletQuantity);
    
    // Tính toán số pallet mới
    const palletCountASM1 = palletQuantityValue > 0 ? Math.ceil(material.quantityASM1 / palletQuantityValue) : 0;
    const totalPalletCount = palletCountASM1 + material.palletCountASM2;
    
    this.safetyService.updateSafetyMaterial(material.id!, {
      palletQuantityASM1: palletQuantityValue,
      palletCountASM1: palletCountASM1,
      totalPalletCount: totalPalletCount,
      updatedAt: new Date()
    }).then(() => {
      console.log(`Updated pallet quantity ASM1 for ${material.materialCode}: ${palletQuantityValue}, pallet count: ${palletCountASM1}`);
      this.refreshData();
    }).catch(error => {
      console.error('Error updating pallet quantity ASM1:', error);
    });
  }

  // Manual input for pallet quantity ASM2
  updatePalletQuantityASM2(material: SafetyMaterial, palletQuantity: string | number) {
    const palletQuantityValue = palletQuantity === null || palletQuantity === undefined || palletQuantity === '' ? 0 : Number(palletQuantity);
    
    // Tính toán số pallet mới
    const palletCountASM2 = palletQuantityValue > 0 ? Math.ceil(material.quantityASM2 / palletQuantityValue) : 0;
    const totalPalletCount = material.palletCountASM1 + palletCountASM2;
    
    this.safetyService.updateSafetyMaterial(material.id!, {
      palletQuantityASM2: palletQuantityValue,
      palletCountASM2: palletCountASM2,
      totalPalletCount: totalPalletCount,
      updatedAt: new Date()
    }).then(() => {
      console.log(`Updated pallet quantity ASM2 for ${material.materialCode}: ${palletQuantityValue}, pallet count: ${palletCountASM2}`);
      this.refreshData();
    }).catch(error => {
      console.error('Error updating pallet quantity ASM2:', error);
    });
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

  // Kiểm tra và hiển thị thông tin về các dòng trùng lặp
  checkDuplicateMaterials() {
    console.log('🔍 Kiểm tra các dòng trùng lặp...');
    
    const materialGroups = new Map<string, SafetyMaterial[]>();
    
    // Nhóm các material theo materialCode
    this.safetyMaterials.forEach(material => {
      if (!materialGroups.has(material.materialCode)) {
        materialGroups.set(material.materialCode, []);
      }
      materialGroups.get(material.materialCode)!.push(material);
    });
    
    let duplicateCount = 0;
    let totalDuplicates = 0;
    
    materialGroups.forEach((materials, materialCode) => {
      if (materials.length > 1) {
        duplicateCount++;
        totalDuplicates += materials.length - 1;
        console.log(`⚠️ ${materialCode}: ${materials.length} dòng (${materials.length - 1} dòng trùng lặp)`);
        
        materials.forEach((material, index) => {
          console.log(`  ${index + 1}. ID: ${material.id}, ASM1: ${material.quantityASM1}, ASM2: ${material.quantityASM2}, ScanDate: ${this.formatDate(material.scanDate)}`);
        });
      }
    });
    
    if (duplicateCount > 0) {
      const message = `Tìm thấy ${duplicateCount} mã hàng có ${totalDuplicates} dòng trùng lặp. Sử dụng "Gộp Dòng Trùng" để xử lý.`;
      this.showScanFeedback('error', message);
      console.log(`⚠️ ${message}`);
    } else {
      this.showScanFeedback('success', 'Không có dòng trùng lặp nào');
      console.log('✅ Không có dòng trùng lặp nào');
    }
  }

  // Gộp các dòng trùng lặp theo materialCode để tránh tạo dòng mới
  consolidateDuplicateMaterials() {
    console.log('🔄 Bắt đầu gộp các dòng trùng lặp...');
    
    const materialGroups = new Map<string, SafetyMaterial[]>();
    
    // Nhóm các material theo materialCode
    this.safetyMaterials.forEach(material => {
      if (!materialGroups.has(material.materialCode)) {
        materialGroups.set(material.materialCode, []);
      }
      materialGroups.get(material.materialCode)!.push(material);
    });
    
    let consolidatedCount = 0;
    
    // Xử lý từng nhóm
    materialGroups.forEach((materials, materialCode) => {
      if (materials.length > 1) {
        console.log(`🔄 Gộp ${materials.length} dòng cho ${materialCode}`);
        
        // Sắp xếp theo ngày tạo để giữ dòng cũ nhất
        materials.sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dateA - dateB;
        });
        
        const primaryMaterial = materials[0]; // Dòng chính (cũ nhất)
        const duplicateMaterials = materials.slice(1); // Các dòng trùng lặp
        
        // Tính tổng số lượng từ tất cả các dòng
        let totalQuantityASM1 = 0;
        let totalQuantityASM2 = 0;
        let maxSafety = 0;
        let materialName = '';
        
        materials.forEach(material => {
          totalQuantityASM1 += material.quantityASM1 || 0;
          totalQuantityASM2 += material.quantityASM2 || 0;
          if (material.safety && material.safety > maxSafety) {
            maxSafety = material.safety;
          }
          // Lấy tên hàng từ dòng đầu tiên có tên
          if (!materialName && material.materialName) {
            materialName = material.materialName;
          }
        });
        
        // Tính toán số pallet
        const palletCountASM1 = primaryMaterial.palletQuantityASM1 > 0 ? Math.ceil(totalQuantityASM1 / primaryMaterial.palletQuantityASM1) : 0;
        const palletCountASM2 = primaryMaterial.palletQuantityASM2 > 0 ? Math.ceil(totalQuantityASM2 / primaryMaterial.palletQuantityASM2) : 0;
        const totalPalletCount = palletCountASM1 + palletCountASM2;
        
        // Cập nhật dòng chính
        const updateData: Partial<SafetyMaterial> = {
          materialName: materialName,
          quantityASM1: totalQuantityASM1,
          quantityASM2: totalQuantityASM2,
          palletCountASM1: palletCountASM1,
          palletCountASM2: palletCountASM2,
          totalQuantity: totalQuantityASM1 + totalQuantityASM2,
          totalPalletCount: totalPalletCount,
          safety: maxSafety,
          scanDate: new Date(), // Cập nhật ngày scan mới nhất
          updatedAt: new Date()
        };
        
        // Cập nhật dòng chính
        this.safetyService.updateSafetyMaterial(primaryMaterial.id!, updateData).then(() => {
          console.log(`✅ Đã cập nhật dòng chính ${materialCode} với tổng số lượng: ASM1=${totalQuantityASM1}, ASM2=${totalQuantityASM2}`);
          
          // Xóa các dòng trùng lặp
          const deletePromises = duplicateMaterials.map(material => 
            this.safetyService.deleteSafetyMaterial(material.id!)
          );
          
          Promise.all(deletePromises).then(() => {
            console.log(`🗑️ Đã xóa ${duplicateMaterials.length} dòng trùng lặp cho ${materialCode}`);
            consolidatedCount++;
            
            // Refresh data sau khi gộp xong
            if (consolidatedCount === materialGroups.size) {
              this.refreshData();
              this.showScanFeedback('success', `Đã gộp thành công ${consolidatedCount} nhóm material trùng lặp`);
            }
          }).catch(error => {
            console.error(`❌ Lỗi khi xóa dòng trùng lặp cho ${materialCode}:`, error);
          });
        }).catch(error => {
          console.error(`❌ Lỗi khi cập nhật dòng chính cho ${materialCode}:`, error);
        });
      }
    });
    
    if (consolidatedCount === 0) {
      console.log('✅ Không có dòng trùng lặp nào để gộp');
      this.showScanFeedback('success', 'Không có dòng trùng lặp nào để gộp');
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
              materialName: '', // Tên hàng - để trống, người dùng nhập sau
              quantityASM1: 0,
              palletQuantityASM1: 0, // Lượng pallet ASM1 - để trống, người dùng nhập sau
              palletCountASM1: 0, // Số pallet ASM1 - tự tính
              quantityASM2: 0,
              palletQuantityASM2: 0, // Lượng pallet ASM2 - để trống, người dùng nhập sau
              palletCountASM2: 0, // Số pallet ASM2 - tự tính
              totalQuantity: 0,
              totalPalletCount: 0, // Tổng số pallet - tự tính
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
     
     if (percentage >= 201) return 'status-overstock'; // Tím - từ 201% trở lên
     if (percentage >= 101) return 'status-high'; // Xanh - 101% đến 200%
     if (percentage >= 51) return 'status-medium'; // Cam - 51% đến 100%
     return 'status-critical'; // Đỏ - dưới 50%
   }
   
   // Get status text based on percentage (giữ lại để tương thích)
   getStatusText(material: SafetyMaterial): string {
     const percentage = this.getStatusPercentage(material);
     
     if (percentage >= 201) return `${percentage}% (Dư thừa)`;
     if (percentage >= 101) return `${percentage}% (Cao)`;
     if (percentage >= 51) return `${percentage}% (Trung bình)`;
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

  // Reset quantities ASM1 and ASM2 to 0 for all materials
  resetQuantities() {
    if (confirm('Bạn có chắc muốn reset lượng ASM1 và ASM2 về 0 cho tất cả materials? Điều này sẽ xóa tất cả số lượng đã scan hoặc nhập vào.')) {
      this.isLoading = true;
      
      const updatePromises = this.safetyMaterials.map(material => 
        this.safetyService.updateSafetyMaterial(material.id!, {
          quantityASM1: 0,
          quantityASM2: 0,
          totalQuantity: 0,
          palletCountASM1: 0,
          palletCountASM2: 0,
          totalPalletCount: 0,
          updatedAt: new Date()
        })
      );
      
      Promise.all(updatePromises).then(() => {
        console.log('✅ Đã reset tất cả lượng ASM1 và ASM2 về 0');
        this.showScanFeedback('success', 'Đã reset tất cả lượng ASM1 và ASM2 về 0');
        this.refreshData();
      }).catch(error => {
        console.error('❌ Lỗi khi reset lượng:', error);
        this.showScanFeedback('error', 'Lỗi khi reset lượng: ' + error.message);
      }).finally(() => {
        this.isLoading = false;
      });
    }
  }
}
