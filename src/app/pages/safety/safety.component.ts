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
  factory: string;
  scanDate: Date;
  materialCode: string;
  actualQuantity: number;
  safety: number;
  status: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// Add new interface for import data
export interface SafetyImportData {
  factory: string;
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
  searchType: 'material' | 'factory' = 'material';
  private searchSubject = new Subject<string>();
  
  // Total counter
  private totalCountSubject = new BehaviorSubject<number>(0);
  public totalCount$ = this.totalCountSubject.asObservable();
  
  // Factory filter
  selectedFactory = 'ALL';
  availableFactories: string[] = ['ALL', 'ASM1', 'ASM2', 'FGS'];
  
  // Scan mode
  isScanMode = false;
  scanFactory = '';
  
  // Scan date
  scanDate = new Date();
  
  // Safety categories
  safetyCategories = [
    { value: 1, label: '1 - Rất thấp' },
    { value: 2, label: '2 - Thấp' },
    { value: 3, label: '3 - Trung bình' },
    { value: 4, label: '4 - Cao' },
    { value: 5, label: '5 - Rất cao' }
  ];
  
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
        this.safetyMaterials = materials;
        this.filteredMaterials = [...this.safetyMaterials];
        this.updateTotalCount();
        this.isLoading = false;
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
          material.factory.toLowerCase().includes(searchLower) ||
          material.safety.toString().includes(searchLower) ||
          material.status.toLowerCase().includes(searchLower)
        );
      });
    }
    this.updateTotalCount();
  }

  clearSearch() {
    this.searchTerm = '';
    this.filteredMaterials = [...this.safetyMaterials];
    this.updateTotalCount();
  }

  changeSearchType(type: 'material' | 'factory') {
    this.searchType = type;
    this.searchTerm = '';
    this.filteredMaterials = [...this.safetyMaterials];
    this.updateTotalCount();
  }

  onFactoryChange() {
    if (this.selectedFactory === 'ALL') {
      this.filteredMaterials = [...this.safetyMaterials];
      this.updateTotalCount();
    } else {
      this.safetyService.getSafetyMaterialsByFactory(this.selectedFactory).subscribe(materials => {
        this.filteredMaterials = materials;
        this.updateTotalCount();
      });
    }
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
        'Factory': material.factory,
        'Ngày Scan': this.formatDate(material.scanDate),
        'Mã hàng': material.materialCode,
        'Số Lượng Thực Tế': material.actualQuantity,
        'Safety Level': material.safety,
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
     console.log(`Started scan mode for ${factory} on ${this.formatDate(this.scanDate)}`);
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
        this.processScannedData(this.scanBuffer.trim());
        this.scanBuffer = '';
      }
    }, 100);
  }

  // Process scanned data from tem format: Rxxxxxx yyyy or Bxxxxxx yyyy
  processScannedData(scannedText: string) {
    if (!this.isScanMode || !this.scanFactory) {
      console.log('Not in scan mode');
      return;
    }

    console.log('Processing scanned data:', scannedText);

    // Parse tem format: Rxxxxxx yyyy or Bxxxxxx yyyy (where xxxxxx is 6 digits)
    const match = scannedText.match(/^([RB])(\d{6})\s+(\d+)$/);
    if (match) {
      const prefix = match[1]; // R or B
      const digits = match[2]; // 6 digits
      const quantity = parseInt(match[3], 10);
      
      if (quantity > 0) {
        const materialCode = prefix + digits; // Full 7-character code
        this.addOrUpdateScannedMaterial(materialCode, quantity);
        // Show success feedback
        this.showScanFeedback('success', `Đã scan: ${materialCode} - ${quantity}`);
      } else {
        console.log('Invalid quantity:', quantity);
        this.showScanFeedback('error', 'Số lượng không hợp lệ');
      }
    } else {
      console.log('Invalid tem format:', scannedText);
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
    // Check if material already exists for this factory and scan date
    const existingMaterial = this.safetyMaterials.find(
      m => m.materialCode === materialCode && 
           m.factory === this.scanFactory && 
           this.isSameDate(m.scanDate, this.scanDate)
    );

    if (existingMaterial) {
      // Update existing material - add quantity
      const newQuantity = existingMaterial.actualQuantity + quantity;
      this.safetyService.updateSafetyMaterial(existingMaterial.id!, {
        actualQuantity: newQuantity,
        updatedAt: new Date()
      }).then(() => {
        console.log(`Updated ${materialCode} quantity: ${existingMaterial.actualQuantity} + ${quantity} = ${newQuantity}`);
      }).catch(error => {
        console.error('Error updating material:', error);
      });
    } else {
      // Add new material
      const newMaterial: Omit<SafetyMaterial, 'id'> = {
        factory: this.scanFactory,
        scanDate: this.scanDate,
        materialCode: materialCode,
        actualQuantity: quantity,
        safety: 3, // Default safety level (trung bình)
        status: 'Active'
      };

      this.safetyService.addSafetyMaterial(newMaterial).then(() => {
        console.log(`Added new material: ${materialCode} with quantity ${quantity}`);
      }).catch(error => {
        console.error('Error adding material:', error);
      });
    }
  }

  // Helper method to check if two dates are the same day
  private isSameDate(date1: Date, date2: Date): boolean {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
  }

  // Helper method to format date for display
  formatDate(date: Date): string {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleDateString('vi-VN');
  }

  // Manual input for safety column
  updateSafety(material: SafetyMaterial, safety: number) {
    this.safetyService.updateSafetyMaterial(material.id!, {
      safety: safety,
      updatedAt: new Date()
    }).then(() => {
      console.log(`Updated safety for ${material.materialCode}: ${safety}`);
    }).catch(error => {
      console.error('Error updating safety:', error);
    });
  }

  // Test scan method for development
  testScan() {
    const testInput = document.querySelector('.test-input') as HTMLInputElement;
    if (testInput && testInput.value.trim()) {
      const testValue = testInput.value.trim();
      this.processScannedData(testValue);
      testInput.value = '';
    } else {
      console.log('Test input is empty or not found');
    }
  }

  // Delete material
  deleteMaterial(material: SafetyMaterial) {
    if (confirm(`Bạn có chắc muốn xóa ${material.materialCode}?`)) {
      this.safetyService.deleteSafetyMaterial(material.id!).then(() => {
        console.log(`Deleted material: ${material.materialCode}`);
        this.refreshData();
      }).catch(error => {
        console.error('Error deleting material:', error);
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
      
      // Process import data
      const importData: SafetyImportData[] = jsonData.map((row: any) => ({
        factory: row['Factory'] || row['factory'],
        materialCode: row['Mã hàng'] || row['materialCode'],
        safety: parseInt(row['Safety'] || row['safety']) || 3
      })).filter(item => item.factory && item.materialCode);
      
      // Update safety levels
      await this.updateSafetyLevelsFromImport(importData);
      
      this.showScanFeedback('success', `Đã import ${importData.length} safety levels`);
      this.refreshData();
      
    } catch (error) {
      console.error('Error importing file:', error);
      this.showScanFeedback('error', 'Lỗi khi import file');
    } finally {
      this.isImporting = false;
      this.importProgress = 0;
    }
  }

  private async updateSafetyLevelsFromImport(importData: SafetyImportData[]) {
    let updatedCount = 0;
    
    for (const item of importData) {
      try {
        // Find existing material with same factory and material code
        const existingMaterial = this.safetyMaterials.find(
          m => m.factory === item.factory && m.materialCode === item.materialCode
        );
        
        if (existingMaterial) {
          // Update existing material's safety level
          await this.safetyService.updateSafetyMaterial(existingMaterial.id!, {
            safety: item.safety,
            updatedAt: new Date()
          });
          updatedCount++;
        } else {
          // Create new material with default values
          const newMaterial: Omit<SafetyMaterial, 'id'> = {
            factory: item.factory,
            scanDate: new Date(),
            materialCode: item.materialCode,
            actualQuantity: 0,
            safety: item.safety,
            status: 'Active'
          };
          await this.safetyService.addSafetyMaterial(newMaterial);
          updatedCount++;
        }
        
        this.importProgress = (updatedCount / importData.length) * 100;
        
      } catch (error) {
        console.error(`Error updating material ${item.materialCode}:`, error);
      }
    }
  }

  // Calculate status percentage based on actual quantity vs safety level
  getStatusPercentage(material: SafetyMaterial): number {
    if (material.safety <= 0) return 0;
    return Math.round((material.actualQuantity / material.safety) * 100);
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
      { 'Factory': 'ASM1', 'Mã hàng': 'R123456', 'Safety': 100 },
      { 'Factory': 'ASM1', 'Mã hàng': 'B018694', 'Safety': 150 },
      { 'Factory': 'ASM2', 'Mã hàng': 'R789012', 'Safety': 200 },
      { 'Factory': 'ASM2', 'Mã hàng': 'B345678', 'Safety': 120 }
    ];

    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(sampleData);
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Safety Template');
    
    XLSX.writeFile(wb, 'Safety_Import_Template.xlsx');
  }
}
