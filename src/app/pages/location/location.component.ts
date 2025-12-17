import { Component, OnInit, OnDestroy, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { Subject, BehaviorSubject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import * as XLSX from 'xlsx';
import * as QRCode from 'qrcode';
import { TabPermissionService } from '../../services/tab-permission.service';
import { FactoryAccessService } from '../../services/factory-access.service';
import { QRScannerService, QRScanResult } from '../../services/qr-scanner.service';
import { trigger, state, style, transition, animate } from '@angular/animations';

export interface LocationItem {
  id?: string;
  stt: number;
  viTri: string;
  qrCode: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CustomerCode {
  id?: string;
  no: number;
  customer: string;
  group: string;
  code: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface FGLocation {
  id?: string;
  stt: number;
  viTri: string;
  qrCode: string;
  createdAt?: Date;
  updatedAt?: Date;
}

@Component({
  selector: 'app-location',
  templateUrl: './location.component.html',
  styleUrls: ['./location.component.scss'],
  animations: [
    trigger('slideIn', [
      transition(':enter', [
        style({ transform: 'translateX(100%)', opacity: 0 }),
        animate('300ms ease-out', style({ transform: 'translateX(0)', opacity: 1 }))
      ])
    ])
  ]
})
export class LocationComponent implements OnInit, OnDestroy, AfterViewInit {
  // Data properties
  locationItems: LocationItem[] = [];
  filteredItems: LocationItem[] = [];
  
  // Loading state
  isLoading = false;
  
  // Search and filter
  searchTerm = '';
  private searchSubject = new Subject<string>();
  
  // Total counter
  private totalCountSubject = new BehaviorSubject<number>(0);
  public totalCount$ = this.totalCountSubject.asObservable();
  
  // Permission
  canDelete = false;
  
  // Dropdown state
  isDropdownOpen = false;
  
  // New item form
  newItem: Partial<LocationItem> = {
    stt: 0,
    viTri: '',
    qrCode: ''
  };
  
  // Auto STT counter
  nextStt = 1;
  
  // Edit mode
  editingItem: LocationItem | null = null;
  
  // Change Location Modal
  showChangeLocationModal = false;
  changeLocationStep = 1; // 1: Choose scanner, 2: Scan material, 3: Scan location, 4: Confirm
  selectedScannerType: 'camera' | 'scanner' | null = null;
  selectedScannerTypes = {
    step1: 'camera' as 'camera' | 'scanner',
    step2: 'camera' as 'camera' | 'scanner',
    step3: 'camera' as 'camera' | 'scanner'
  };
  scannedMaterialCode = '';
  scannedNewLocation = '';
  newLocation = '';
  currentLocation = '';
  foundRM1Item: any = null;
  
  // QR Scanner properties
  isScanning = false;
  isScannerReady = false;
  scannerState: 'idle' | 'starting' | 'scanning' | 'error' = 'idle';
  errorMessage = '';
  
  // Scan flow control
  isActivelyScanningMaterial = false;
  isActivelyScanningLocation = false;
  materialScanCompleted = false;
  locationScanCompleted = false;
  
  // Success notification
  showSuccessNotification = false;
  successMessage = '';
  
  // Store Material Modal (Cất NVL)
  showStoreMaterialModal = false;
  storeMaterialQRInput = '';
  scannedMaterialCodeForStore = '';
  foundMaterialsForStore: any[] = []; // Các materials tìm được theo materialCode
  selectedMaterialForStore: any = null; // Material được chọn để cất
  suggestedLocations: string[] = []; // Danh sách vị trí hiện tại của material
  selectedTargetLocation = ''; // Vị trí đích được chọn
  isSearchingMaterial = false;
  storeMaterialStep: 'scan' | 'select' | 'choose-location' | 'confirm' = 'scan';
  
  // FG Location Modal
  showFGModal = false;
  fgLocations: FGLocation[] = [];
  filteredFGLocations: FGLocation[] = [];
  fgSearchTerm = '';
  
  // Customer Codes
  customerCodes: CustomerCode[] = [];
  filteredCustomerCodes: CustomerCode[] = [];
  customerSearchTerm = '';
  showCustomerModal = false;
  
  private destroy$ = new Subject<void>();

  constructor(
    private firestore: AngularFirestore,
    private auth: AngularFireAuth,
    private tabPermissionService: TabPermissionService,
    private factoryAccessService: FactoryAccessService,
    private cdr: ChangeDetectorRef,
    private qrScannerService: QRScannerService
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
    this.loadLocationData();
    this.loadCustomerCodes();
    
    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      this.isDropdownOpen = false;
    });
  }

  ngAfterViewInit() {
    this.cdr.detectChanges();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    
    // Stop scanner if active
    this.stopScanning();
    
    // Remove event listeners
    document.removeEventListener('click', () => {
      this.isDropdownOpen = false;
    });
  }

  stopScanning(): void {
    this.isScanning = false;
    this.isScannerReady = false;
    this.scannerState = 'idle';
    
    // Stop QRScannerService
    try {
      this.qrScannerService.stopScanning();
      console.log('📹 QRScannerService stopped');
    } catch (error) {
      console.error('❌ Error stopping QRScannerService:', error);
    }
    
    // Clear containers
    this.clearScannerContainer('material-scanner-container');
    this.clearScannerContainer('location-scanner-container');
  }

  private clearScannerContainer(containerId: string): void {
    try {
      const container = document.getElementById(containerId);
      if (container) {
        container.innerHTML = '';
        console.log(`🧹 Cleared container: ${containerId}`);
      }
    } catch (error) {
      console.error(`❌ Error clearing container ${containerId}:`, error);
    }
  }


  startMaterialScanning(): void {
    this.isScanning = true;
    this.scannerState = 'starting';
    this.isScannerReady = false;
    this.errorMessage = '';
    
    // Reset scan states
    this.isActivelyScanningMaterial = true; // 🔧 FIX: Set true ngay để sẵn sàng scan
    this.materialScanCompleted = false;
    
    console.log('📱 Starting material scanning...');
    
    // 🔧 FIX: Tăng timeout cho mobile chậm và force change detection
    this.cdr.detectChanges();
    setTimeout(() => {
      const container = document.getElementById('material-scanner-container');
      if (container) {
        console.log('✅ Container found, initializing scanner...');
        this.initializeCameraScanner('material-scanner-container');
      } else {
        console.error('❌ Container not found!');
        this.handleScannerError('Không tìm thấy container scanner');
      }
    }, 500); // Tăng từ 200ms lên 500ms
  }

  startMaterialScan(): void {
    console.log('🔍 Starting material scan...');
    this.isActivelyScanningMaterial = true;
    this.materialScanCompleted = false;
    // ZXing scanner is already running, just enable scanning mode
  }

  proceedToLocationScan(): void {
    console.log('📍 Proceeding to location scan...');
    this.changeLocationStep = 3;
    
    // Initialize location scanner
    setTimeout(() => {
      this.initializeCameraScanner('location-scanner-container');
    }, 200);
  }

  startLocationScan(): void {
    console.log('🔍 Starting location scan...');
    this.isActivelyScanningLocation = true;
    this.locationScanCompleted = false;
    // ZXing scanner is already running, just enable scanning mode
  }

  stopLocationScan(): void {
    console.log('⏹️ Stopping location scan...');
    this.isActivelyScanningLocation = false;
  }

  goBackToMaterialScan(): void {
    console.log('🔙 Going back to material scan...');
    this.changeLocationStep = 2;
    this.materialScanCompleted = false;
    this.isActivelyScanningMaterial = false;
    
    // Restart material scanner
    setTimeout(() => {
      this.startMaterialScanning();
    }, 200);
  }

  startQRScannerForStep(step: number): void {
    console.log(`📱 Starting QR scanner for step ${step}`);
    this.isScanning = true;
    this.scannerState = 'starting';
    this.isScannerReady = false;
    
    // Initialize camera for location scanning (step 3)
    if (step === 3) {
      console.log('📱 Starting location scanning...');
      
      // 🔧 FIX: Tăng timeout cho mobile chậm và force change detection
      this.cdr.detectChanges();
      setTimeout(() => {
        const container = document.getElementById('location-scanner-container');
        if (container) {
          console.log('✅ Location container found, initializing scanner...');
          this.initializeCameraScanner('location-scanner-container');
        } else {
          console.error('❌ Location container not found!');
          this.handleScannerError('Không tìm thấy container scanner');
        }
      }, 500); // Tăng từ 200ms lên 500ms
    }
  }

  async initializeCameraScanner(containerId: string): Promise<void> {
    try {
      console.log(`🔧 Initializing optimized camera scanner for container: ${containerId}`);
      
      // Check if container exists
      const container = document.getElementById(containerId);
      if (!container) {
        throw new Error(`Container ${containerId} not found`);
      }

      // Set scanning state
      this.scannerState = 'starting';
      this.isScannerReady = false;
      this.cdr.detectChanges();

      // Use QRScannerService for better performance
      const scanResult$ = await this.qrScannerService.startScanning({
        facingMode: 'environment',
        width: 640,
        height: 480
      }, container);

      // Subscribe to scan results
      scanResult$.subscribe({
        next: (result: QRScanResult) => {
          console.log('📖 QR Code detected via service:', result.text);
          this.handleScannedCode(result.text, containerId);
        },
        error: (error) => {
          console.error('❌ Scanner service error:', error);
          this.handleScannerError(error.message || 'Lỗi scanner');
        }
      });

      // Monitor scanner state
      this.qrScannerService.scannerState$.subscribe(state => {
        console.log(`📱 Scanner state: ${state}`);
        if (state === 'scanning') {
          this.scannerState = 'scanning';
          this.isScannerReady = true;
          this.errorMessage = '';
          this.cdr.detectChanges();
        } else if (state === 'error') {
          this.handleScannerError('Lỗi khởi tạo scanner');
        }
      });

    } catch (error) {
      console.error('❌ Camera scanner initialization error:', error);
      let errorMessage = 'Không thể truy cập camera';
      
      if (error instanceof Error) {
        if (error.message.includes('Camera không được hỗ trợ')) {
          errorMessage = 'Camera không được hỗ trợ trên thiết bị này';
        } else if (error.message.includes('Không thể truy cập camera')) {
          errorMessage = 'Vui lòng cho phép truy cập camera';
        } else {
          errorMessage = error.message;
        }
      }
      
      this.handleScannerError(errorMessage);
    }
  }

  private handleScannerError(message: string): void {
    this.scannerState = 'error';
    this.errorMessage = message;
    this.isScannerReady = false;
    this.isScanning = false;
    this.cdr.detectChanges();
  }

  private handleScannedCode(scannedCode: string, containerId: string): void {
    console.log(`📱 Code scanned from ${containerId}:`, scannedCode);
    
    if (containerId === 'material-scanner-container' && this.isActivelyScanningMaterial) {
      // Handle material code scanning (step 2)
      this.isActivelyScanningMaterial = false;
      this.materialScanCompleted = true;
      this.scannedMaterialCode = scannedCode;
      
      // Process material code
      this.processMaterialCode();
      
    } else if (containerId === 'location-scanner-container' && this.isActivelyScanningLocation) {
      // Handle location scanning (step 3)
      this.isActivelyScanningLocation = false;
      this.locationScanCompleted = true;
      this.newLocation = scannedCode.trim();
      
      console.log(`✅ Location scanned: ${scannedCode.trim()}`);
      
      // Stop scanner
      this.stopScanning();
      
      // 🔧 FIX: Tự động cập nhật ngay, không cần confirm
      this.autoConfirmLocationChange();
    }
  }

  private async autoConfirmLocationChange(): Promise<void> {
    console.log('🔄 Auto-confirming location change...');
    
    // 🔧 FIX: Lưu thông tin trước khi cập nhật (vì confirmLocationChange sẽ reset foundRM1Item)
    const materialCode = this.foundRM1Item?.parsedData?.materialCode || this.foundRM1Item?.materialCode || 'N/A';
    const newLocationValue = this.newLocation;
    
    // Hiển thị loading
    this.isLoading = true;
    this.cdr.detectChanges();
    
    try {
      // Cập nhật location
      await this.confirmLocationChange();
      
      // Hiển thị thông báo thành công (dùng dữ liệu đã lưu)
      console.log('✅ Location updated successfully!');
      alert(`✅ Đã cập nhật vị trí thành công!\n\nMã hàng: ${materialCode}\nVị trí mới: ${newLocationValue}`);
      
      // Đóng modal
      this.closeChangeLocationModal();
      
    } catch (error) {
      console.error('❌ Error updating location:', error);
      alert('❌ Lỗi cập nhật vị trí: ' + error.message);
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  private startLocationScanning(): void {
    // Restart location scanner
    setTimeout(() => {
      this.initializeCameraScanner('location-scanner-container');
    }, 200);
  }

  private async checkPermissions() {
    try {
      this.tabPermissionService.canAccessTab('location')
        .pipe(takeUntil(this.destroy$))
        .subscribe(canAccess => {
          this.canDelete = canAccess;
        });
    } catch (error) {
      console.error('Error checking permissions:', error);
    }
  }

  private async loadLocationData() {
    this.isLoading = true;
    try {
      this.firestore.collection('locations', ref => ref.orderBy('stt', 'asc'))
        .valueChanges({ idField: 'id' })
        .pipe(takeUntil(this.destroy$))
        .subscribe((items: any[]) => {
          this.locationItems = items;
          
          // Sort by Vị Trí (A,B,C) then by STT
          this.locationItems.sort((a, b) => {
            // First sort by Vị Trí alphabetically
            const viTriComparison = a.viTri.localeCompare(b.viTri);
            if (viTriComparison !== 0) return viTriComparison;
            // If Vị Trí is same, sort by STT
            return a.stt - b.stt;
          });
          
          // Reassign STT automatically starting from 1
          this.locationItems.forEach((item, index) => {
            item.stt = index + 1;
          });
          
          this.filteredItems = [...this.locationItems];
          this.updateTotalCount();
          this.calculateNextStt();
          this.isLoading = false;
        });
    } catch (error) {
      console.error('Error loading location data:', error);
      this.isLoading = false;
    }
  }

  toggleDropdown(event: Event) {
    event.stopPropagation();
    this.isDropdownOpen = !this.isDropdownOpen;
  }

  private updateTotalCount() {
    this.totalCountSubject.next(this.filteredItems.length);
  }
  
  private calculateNextStt() {
    // STT sẽ luôn là số tiếp theo sau số cuối cùng
    this.nextStt = this.locationItems.length + 1;
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
    if (!term || term.trim().length < 2) {
      this.filteredItems = [...this.locationItems];
    } else {
      this.filteredItems = this.locationItems.filter(item => {
        const searchLower = term.toLowerCase();
        return (
          item.stt.toString().includes(searchLower) ||
          item.viTri.toLowerCase().includes(searchLower) ||
          item.qrCode.toLowerCase().includes(searchLower)
        );
      });
    }
    this.updateTotalCount();
  }

  clearSearch() {
    this.searchTerm = '';
    this.filteredItems = [...this.locationItems];
    this.updateTotalCount();
  }

  refreshData() {
    this.loadLocationData();
  }

  // Generate QR code based on location
  generateQRCode(viTri: string): string {
    if (!viTri) return '';
    // QR code chỉ chứa nội dung vị trí
    return viTri.toUpperCase();
  }

  // Normalize location code for duplicate checking
  // Q1.1(L) -> Q11L, Q-1-1-L -> Q11L
  normalizeLocationCode(viTri: string): string {
    if (!viTri) return '';
    
    // Convert to uppercase and remove all special characters (dots, hyphens, parentheses)
    return viTri.toUpperCase().replace(/[.\-()]/g, '');
  }

  // Format and validate viTri input
  formatViTriInput(input: string): string {
    if (!input) return '';
    
    // Remove all spaces and convert to uppercase
    let formatted = input.replace(/\s/g, '').toUpperCase();
    
    // Only allow letters, numbers, dots, hyphens, and parentheses (escape parentheses)
    formatted = formatted.replace(/[^A-Z0-9.\-()]/g, '');
    
    return formatted;
  }

  // Validate viTri input
  validateViTriInput(input: string): boolean {
    if (!input) return false;
    
    // Check if contains only allowed characters: letters, numbers, dots, hyphens, and parentheses (escape parentheses)
    const allowedPattern = /^[A-Z0-9.\-()]+$/;
    return allowedPattern.test(input);
  }

  // Handle viTri input change
  onViTriInputChange(event: any, isEditing: boolean = false) {
    const input = event.target.value;
    const formatted = this.formatViTriInput(input);
    
    if (isEditing && this.editingItem) {
      this.editingItem.viTri = formatted;
    } else {
      this.newItem.viTri = formatted;
    }
    
    // Update the input value to show formatted result
    event.target.value = formatted;
  }

  // Add new location item
  addLocationItem() {
    if (!this.newItem.viTri) {
      alert('Vui lòng nhập Vị Trí');
      return;
    }

    // Validate viTri format
    if (!this.validateViTriInput(this.newItem.viTri)) {
      alert('Vị Trí chỉ được chứa chữ cái, số, dấu chấm (.), dấu gạch ngang (-) và dấu ngoặc đơn ()');
      return;
    }

    // Check if Vị Trí already exists (exact match)
    if (this.locationItems.find(item => item.viTri === this.newItem.viTri)) {
      alert('Vị Trí đã tồn tại, vui lòng chọn Vị Trí khác');
      return;
    }

    // Check if normalized Vị Trí already exists (Q1.1(L) vs Q-1-1-L both become Q11L)
    const normalizedNewViTri = this.normalizeLocationCode(this.newItem.viTri);
    const duplicateItem = this.locationItems.find(item => {
      const normalizedExistingViTri = this.normalizeLocationCode(item.viTri);
      return normalizedExistingViTri === normalizedNewViTri;
    });

    if (duplicateItem) {
      alert(`Vị trí "${this.newItem.viTri}" trùng với vị trí đã có "${duplicateItem.viTri}" (cả hai đều đọc là "${normalizedNewViTri}")`);
      return;
    }

    const newItem: Omit<LocationItem, 'id'> = {
      stt: this.nextStt, // Use auto-generated STT
      viTri: this.newItem.viTri!,
      qrCode: this.generateQRCode(this.newItem.viTri!),
      createdAt: new Date()
    };

    this.firestore.collection('locations').add(newItem).then(() => {
      console.log('Added new location item');
      this.resetNewItemForm();
      this.refreshData();
    }).catch(error => {
      console.error('Error adding location item:', error);
    });
  }

  // Edit location item
  editLocationItem(item: LocationItem) {
    this.editingItem = { ...item };
  }

  // Save edited item
  saveEditedItem() {
    if (!this.editingItem) return;

    if (!this.editingItem.viTri) {
      alert('Vui lòng nhập Vị Trí');
      return;
    }

    // Validate viTri format
    if (!this.validateViTriInput(this.editingItem.viTri)) {
      alert('Vị Trí chỉ được chứa chữ cái, số, dấu chấm (.), dấu gạch ngang (-) và dấu ngoặc đơn ()');
      return;
    }

    // Check if Vị Trí already exists (exact match, excluding current item)
    if (this.locationItems.find(item => 
      item.viTri === this.editingItem!.viTri && item.id !== this.editingItem!.id
    )) {
      alert('Vị Trí đã tồn tại, vui lòng chọn Vị Trí khác');
      return;
    }

    // Check if normalized Vị Trí already exists (Q1.1(L) vs Q-1-1-L both become Q11L)
    const normalizedNewViTri = this.normalizeLocationCode(this.editingItem.viTri);
    const duplicateItem = this.locationItems.find(item => {
      if (item.id === this.editingItem!.id) return false; // Skip current item
      const normalizedExistingViTri = this.normalizeLocationCode(item.viTri);
      return normalizedExistingViTri === normalizedNewViTri;
    });

    if (duplicateItem) {
      alert(`Vị trí "${this.editingItem.viTri}" trùng với vị trí đã có "${duplicateItem.viTri}" (cả hai đều đọc là "${normalizedNewViTri}")`);
      return;
    }

    const updatedItem = {
      stt: this.editingItem.stt,
      viTri: this.editingItem.viTri,
      qrCode: this.generateQRCode(this.editingItem.viTri),
      updatedAt: new Date()
    };

    this.firestore.collection('locations').doc(this.editingItem.id!).update(updatedItem).then(() => {
      console.log('Updated location item');
      this.cancelEdit();
      this.refreshData();
    }).catch(error => {
      console.error('Error updating location item:', error);
    });
  }

  // Cancel edit
  cancelEdit() {
    this.editingItem = null;
  }

  // Reset new item form
  resetNewItemForm() {
    this.newItem = {
      viTri: '',
      qrCode: ''
    };
  }

  // Delete location item
  deleteLocationItem(item: LocationItem) {
    if (confirm(`Bạn có chắc muốn xóa vị trí ${item.viTri}?`)) {
      this.firestore.collection('locations').doc(item.id!).delete().then(() => {
        console.log(`Deleted location item: ${item.viTri}`);
        this.refreshData();
      }).catch(error => {
        console.error('Error deleting location item:', error);
      });
    }
  }

  // Export to Excel
  exportToExcel() {
    try {
      const exportData = this.filteredItems.map(item => ({
        'STT': item.stt,
        'Vị Trí': item.viTri,
        'QR Code': item.qrCode
      }));

      const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(exportData);
      const wb: XLSX.WorkBook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Location Data');
      
      XLSX.writeFile(wb, `Location_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
    }
  }

  // Initialize sample data
  initializeSampleData() {
    const sampleData: Omit<LocationItem, 'id'>[] = [
      { stt: 0, viTri: 'A1-01', qrCode: this.generateQRCode('A1-01'), createdAt: new Date() },
      { stt: 0, viTri: 'A1-02', qrCode: this.generateQRCode('A1-02'), createdAt: new Date() },
      { stt: 0, viTri: 'A2-01', qrCode: this.generateQRCode('A2-01'), createdAt: new Date() },
      { stt: 0, viTri: 'A2-02', qrCode: this.generateQRCode('A2-02'), createdAt: new Date() },
      { stt: 0, viTri: 'B1-01', qrCode: this.generateQRCode('B1-01'), createdAt: new Date() }
    ];

    // Clear existing data first
    this.firestore.collection('locations').get().subscribe(snapshot => {
      const batch = this.firestore.firestore.batch();
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      batch.commit().then(() => {
        // Add sample data
        const addBatch = this.firestore.firestore.batch();
        sampleData.forEach(item => {
          const docRef = this.firestore.collection('locations').doc().ref;
          addBatch.set(docRef, item);
        });
        
        addBatch.commit().then(() => {
          console.log('Sample data initialized');
          this.refreshData();
        });
      });
    });
  }

  // Import locations from file
  importLocations() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.processImportFile(file);
      }
    };
    input.click();
  }

  // Process imported file
  // IMPORTANT: This function ADDS new data to existing data, does NOT replace/delete existing data
  private processImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        console.log('📋 Imported data:', jsonData);
        console.log('ℹ️ IMPORT MODE: Adding new data to existing data (not replacing)');
        
        // Skip header row (dòng 1) and process all data from row 2 onwards
        const locations = [];
        const normalizedCodes = new Set<string>(); // Track normalized codes to prevent duplicates
        
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i] as any[];
          if (row && row[0] && row[0].toString().trim()) {
            const viTri = row[0].toString().trim().toUpperCase();
            console.log(`📋 Processing row ${i + 1}: "${viTri}"`);
            
            if (this.validateViTriInput(viTri)) {
              const normalizedCode = this.normalizeLocationCode(viTri);
              
              // Check for duplicates within import data
              if (normalizedCodes.has(normalizedCode)) {
                console.log(`❌ Duplicate in import data: ${viTri} (normalized: ${normalizedCode})`);
                continue;
              }
              
              // Check for duplicates with existing data
              const existingDuplicate = this.locationItems.find(item => {
                const normalizedExistingViTri = this.normalizeLocationCode(item.viTri);
                return normalizedExistingViTri === normalizedCode;
              });
              
              if (existingDuplicate) {
                console.log(`❌ Duplicate with existing: ${viTri} vs ${existingDuplicate.viTri} (both normalized to: ${normalizedCode})`);
                continue;
              }
              
              normalizedCodes.add(normalizedCode);
              locations.push({
                stt: 0, // Will be auto-assigned
                viTri: viTri,
                qrCode: this.generateQRCode(viTri),
                createdAt: new Date()
              });
              console.log(`✅ Valid location added: ${viTri} (normalized: ${normalizedCode})`);
            } else {
              console.log(`❌ Invalid location format: ${viTri}`);
            }
          } else {
            console.log(`⚠️ Empty row ${i + 1}, skipping`);
          }
        }
        
        console.log(`📊 Total valid locations found: ${locations.length}`);
        
        if (locations.length > 0) {
          this.saveImportedLocations(locations);
        } else {
          alert('Không tìm thấy dữ liệu hợp lệ để import. Vui lòng kiểm tra:\n- Dòng 1 phải là tiêu đề "Vị trí"\n- Từ dòng 2 trở đi phải có dữ liệu vị trí\n- Định dạng vị trí chỉ được chứa chữ cái, số, dấu chấm (.), dấu gạch ngang (-) và dấu ngoặc đơn ()');
        }
      } catch (error) {
        console.error('Error processing file:', error);
        alert('Lỗi khi đọc file. Vui lòng kiểm tra định dạng file.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // Save imported locations to database
  // IMPORTANT: This function ADDS new locations to existing data, does NOT replace existing data
  private saveImportedLocations(locations: Omit<LocationItem, 'id'>[]) {
    const batch = this.firestore.firestore.batch();
    
    // Add each new location as a new document (preserves existing data)
    locations.forEach(location => {
      const docRef = this.firestore.collection('locations').doc().ref;
      batch.set(docRef, location); // This ADDS new data, doesn't replace
    });
    
    batch.commit().then(() => {
      console.log(`✅ Imported ${locations.length} new locations (added to existing data)`);
      this.refreshData();
      alert(`✅ Đã import thành công ${locations.length} vị trí mới!\n\n📝 Lưu ý: Dữ liệu mới được THÊM VÀO dữ liệu cũ, không thay thế dữ liệu cũ.`);
    }).catch(error => {
      console.error('Error importing locations:', error);
      alert('Lỗi khi import dữ liệu. Vui lòng thử lại.');
    });
  }

  // Download template file
  downloadTemplate() {
    try {
      const templateData = [
        ['Vị trí'], // Tiêu đề cột
        ['A1-01'],  // Dòng 2 - sẽ được import
        ['A1-02'],  // Dòng 3 - sẽ được import
        ['A2-01'],  // Dòng 4 - sẽ được import
        ['A2-02'],  // Dòng 5 - sẽ được import
        ['B1-01'],  // Dòng 6 - sẽ được import
        ['B1-02'],  // Dòng 7 - sẽ được import
        ['B2-01'],  // Dòng 8 - sẽ được import
        ['C1-01'],  // Dòng 9 - sẽ được import
        ['C1-02'],  // Dòng 10 - sẽ được import
        ['D1.01'],  // Dòng 11 - ví dụ với dấu chấm
        ['D1.02'],  // Dòng 12 - ví dụ với dấu chấm
        ['E1(01)'], // Dòng 13 - ví dụ với dấu ngoặc đơn
        ['E1(02)'], // Dòng 14 - ví dụ với dấu ngoặc đơn
        ['F1-01.02'], // Dòng 15 - ví dụ kết hợp dấu gạch ngang và chấm
        ['G1(01)-02'] // Dòng 16 - ví dụ kết hợp dấu ngoặc đơn và gạch ngang
      ];

      const ws: XLSX.WorkSheet = XLSX.utils.aoa_to_sheet(templateData);
      const wb: XLSX.WorkBook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Location Template');
      
      XLSX.writeFile(wb, 'Location_Template.xlsx');
    } catch (error) {
      console.error('Error creating template:', error);
      alert('Lỗi khi tạo template. Vui lòng thử lại.');
    }
  }

  // Delete all locations
  deleteAllLocations() {
    if (confirm('Bạn có chắc muốn xóa TẤT CẢ vị trí? Hành động này không thể hoàn tác!')) {
      this.firestore.collection('locations').get().subscribe(snapshot => {
        const batch = this.firestore.firestore.batch();
        snapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        
        batch.commit().then(() => {
          console.log('All locations deleted');
          this.refreshData();
          alert('Đã xóa tất cả vị trí');
        }).catch(error => {
          console.error('Error deleting all locations:', error);
          alert('Lỗi khi xóa dữ liệu. Vui lòng thử lại.');
        });
      });
    }
  }

    // Print QR Code - Tem 50mm x 30mm
  async printQRCode(item: LocationItem) {
    try {
      // Tạo mã QR thực sự từ vị trí
      const qrImage = await QRCode.toDataURL(item.viTri, {
        width: 200, // 200px để đảm bảo chất lượng khi in
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });

      // Tạo nội dung để in QR code với kích thước 50mm x 30mm
      const printContent = `
        <div class="qr-label" style="
          width: 50mm; 
          height: 30mm; 
          border: 1px solid #000; 
          display: flex; 
          align-items: center; 
          padding: 2mm;
          box-sizing: border-box;
          font-family: Arial, sans-serif;
          background: white;
        ">
          <!-- Phía trái: Mã QR 25mm x 25mm -->
          <div class="qr-section" style="
            width: 25mm; 
            height: 25mm; 
            display: flex; 
            align-items: center; 
            justify-content: center;
            border: 1px solid #ccc;
            background: #f8f9fa;
            overflow: hidden;
          ">
            <img src="${qrImage}" 
                 alt="QR Code for ${item.viTri}" 
                 style="
                   width: 100%; 
                   height: 100%; 
                   object-fit: contain;
                   max-width: 23mm;
                   max-height: 23mm;
                 "
                 title="QR Code: ${item.viTri}">
          </div>
          
          <!-- Phía phải: Tên vị trí -->
          <div class="location-section" style="
            width: 20mm; 
            height: 25mm; 
            display: flex; 
            align-items: center; 
            justify-content: center;
            padding-left: 2mm;
          ">
            <div style="
              font-size: 14px; 
              font-weight: bold; 
              color: #000;
              font-family: 'Arial', sans-serif;
              text-align: center;
              line-height: 1.2;
              word-break: break-word;
            ">
              ${item.viTri}
            </div>
          </div>
        </div>
      `;
    
          const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>Location QR Code - ${item.viTri}</title>
              <style>
                body { 
                  margin: 0; 
                  padding: 10mm; 
                  font-family: Arial, sans-serif; 
                  background: #f0f0f0;
                }
                
                .qr-label {
                  margin: 0 auto;
                  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }
                
                @media print {
                  body { 
                    margin: 0; 
                    padding: 0; 
                    background: white;
                  }
                  .no-print { display: none; }
                  .qr-label {
                    box-shadow: none;
                    border: 1px solid #000 !important;
                  }
                }
              </style>
            </head>
            <body>
              ${printContent}
              <div class="no-print" style="margin-top: 20px; text-align: center;">
                <button onclick="window.print()" style="
                  background: #007bff; 
                  color: white; 
                  border: none; 
                  padding: 10px 20px; 
                  border-radius: 5px; 
                  cursor: pointer;
                  margin-right: 10px;
                ">Print QR Code</button>
                <button onclick="window.close()" style="
                  background: #6c757d; 
                  color: white; 
                  border: none; 
                  padding: 10px 20px; 
                  border-radius: 5px; 
                  cursor: pointer;
                ">Close</button>
              </div>
            </body>
          </html>
        `);
        printWindow.document.close();
      }
    } catch (error) {
      console.error('Error generating QR code:', error);
      alert('Lỗi khi tạo mã QR. Vui lòng thử lại.');
    }
  }

  trackByFn(index: number, item: LocationItem): string {
    return item.id || index.toString();
  }

  trackByFG(index: number, item: FGLocation): string {
    return item.id || index.toString();
  }

  // Change Location Modal Methods
  openChangeLocationModal(): void {
    this.showChangeLocationModal = true;
    this.resetChangeLocation();
  }

  closeChangeLocationModal(): void {
    // Stop camera before closing
    this.stopScanning();
    
    this.showChangeLocationModal = false;
    this.resetChangeLocation();
  }

  resetChangeLocation(): void {
    this.changeLocationStep = 1;
    this.selectedScannerType = null;
    this.scannedMaterialCode = '';
    this.scannedNewLocation = '';
    this.newLocation = '';
    this.currentLocation = '';
    this.foundRM1Item = null;
    
    // Reset scanner states
    this.isScanning = false;
    this.isScannerReady = false;
    this.scannerState = 'idle';
    this.errorMessage = '';
    
    // Reset scan flow states
    this.isActivelyScanningMaterial = false;
    this.isActivelyScanningLocation = false;
    this.materialScanCompleted = false;
    this.locationScanCompleted = false;
    
    // Stop scanner if active
    this.stopScanning();
  }

  selectScannerType(type: 'camera' | 'scanner'): void {
    this.selectedScannerType = type;
    this.changeLocationStep = 2;
    
    if (type === 'camera') {
      // Start QR scanner for material code
      this.startMaterialScanning();
    } else {
      // Focus on material input for scanner
    setTimeout(() => {
      const materialInput = document.querySelector('#materialInput') as HTMLInputElement;
      if (materialInput) {
        materialInput.focus();
      }
    }, 100);
    }
  }

  processMaterialCode(): void {
    if (!this.scannedMaterialCode.trim()) {
      alert('Vui lòng nhập mã hàng');
      return;
    }

    // Validate and parse the scanned code
    const parsedData = this.parseScannedCode(this.scannedMaterialCode.trim());
    
    // Check if parsing was successful
    if (!parsedData.materialCode) {
      alert('🏷️ TEM LỖI - Format mã QR không đúng');
      this.scannedMaterialCode = '';
      return;
    }

    // Search for material in RM1 inventory
    this.searchRM1Material(parsedData);
  }

  // Parse scanned code: B001639|KZPO0425/0114|150|13082025
  // Rules: 
  // - First 7 chars (0-6): Material Code
  // - Chars 9-21: PO Number  
  // - Last 8 chars: IMD (Import Date)
  private parseScannedCode(scannedCode: string): any {
    const cleanCode = scannedCode.replace(/\s/g, ''); // Remove spaces
    
    // Validate basic format
    if (cleanCode.length < 7) {
      console.log(`❌ Code too short: ${cleanCode}`);
      return {
        materialCode: null,
        poNumber: null,
        batch: null,
        quantity: null,
        originalCode: scannedCode,
        error: 'Code too short'
      };
    }
    
    if (cleanCode.includes('|') && cleanCode.length >= 25) {
      // Full format QR code validation
      const parts = cleanCode.split('|');
      if (parts.length < 4) {
        console.log(`❌ Invalid format - not enough parts: ${parts.length}`);
        return {
          materialCode: null,
          poNumber: null,
          batch: null,
          quantity: null,
          originalCode: scannedCode,
          error: 'Invalid format'
        };
      }
      
      // Parse by splitting and position
      const materialCode = parts[0]; // First part: B001639 (but take only 7 chars)
      const poNumber = parts[1]; // Second part: KZPO0425/0114
      const quantity = parts[2]; // Third part: 150
      const imd = parts[3]; // Fourth part: 13082025 or 08092025 (Import Date)
      
      // Ensure material code is exactly 7 characters
      const finalMaterialCode = materialCode.substring(0, 7);
      
      // Validate material code format (should be letters and numbers)
      if (!/^[A-Za-z0-9]{7}$/.test(finalMaterialCode)) {
        console.log(`❌ Invalid material code format: ${finalMaterialCode}`);
        return {
          materialCode: null,
          poNumber: null,
          batch: null,
          quantity: null,
          originalCode: scannedCode,
          error: 'Invalid material code format'
        };
      }
      
      // Validate IMD format (should be 8 digits)
      if (!/^\d{8}$/.test(imd)) {
        console.log(`❌ Invalid IMD format: ${imd}`);
        return {
          materialCode: null,
          poNumber: null,
          imd: null,
          quantity: null,
          originalCode: scannedCode,
          error: 'Invalid IMD format'
        };
      }
      
      console.log(`✅ Valid QR Code parsed:`, {
        originalCode: scannedCode,
        cleanCode: cleanCode,
        parts: parts,
        finalMaterialCode: finalMaterialCode,
        poNumber: poNumber,
        imd: imd,
        quantity: quantity,
        codeLength: cleanCode.length
      });
      
      return {
        materialCode: finalMaterialCode.toUpperCase(),
        poNumber: poNumber,
        imd: imd,
        quantity: quantity,
        originalCode: scannedCode
      };
    } else {
      // Fallback: treat as plain material code if length is reasonable
      if (cleanCode.length >= 7) {
        const materialCode = cleanCode.substring(0, 7);
        console.log(`📋 Fallback parsing - using as material code: ${materialCode}`);
        return {
          materialCode: materialCode.toUpperCase(),
          poNumber: null,
          imd: null,
          quantity: null,
          originalCode: scannedCode
        };
      } else {
        console.log(`❌ Code too short for fallback: ${cleanCode}`);
        return {
          materialCode: null,
          poNumber: null,
          imd: null,
          quantity: null,
          originalCode: scannedCode,
          error: 'Code too short'
        };
      }
    }
  }

  private async searchRM1Material(parsedData: any): Promise<void> {
    try {
      console.log(`🔍 Searching for material:`, parsedData);
      
      // Check multiple collections for the IMD (Import Date)
      console.log(`🔍 Checking multiple collections for IMD ${parsedData.imd}...`);
      
      // Skip inbound and outbound collections for IMD-based search
      // Focus only on inventory-materials since it has the actual Import Date field
      console.log(`🔍 Focusing on INVENTORY-MATERIALS for IMD-based search...`);
      
      // Check INVENTORY-MATERIALS with Import Date matching
      console.log(`🔍 Checking INVENTORY-MATERIALS with Import Date matching...`);
      
      // Convert IMD (DDMMYYYY) to Date for comparison
      const imdStr = parsedData.imd; // e.g., "13082024"
      const day = parseInt(imdStr.substring(0, 2));
      const month = parseInt(imdStr.substring(2, 4)) - 1; // Month is 0-indexed
      const year = parseInt(imdStr.substring(4, 8));
      const searchDate = new Date(year, month, day);
      
      console.log(`🔍 Searching for Import Date: ${searchDate.toLocaleDateString('vi-VN')} (from IMD: ${imdStr})`);
      
      // Query inventory-materials by materialCode, poNumber, and importDate
        const inventoryQuery = this.firestore.collection('inventory-materials', ref => 
          ref.where('materialCode', '==', parsedData.materialCode)
             .where('factory', '==', 'ASM1')
             .where('poNumber', '==', parsedData.poNumber)
        );
        
        const inventorySnapshot = await inventoryQuery.get().toPromise();
      console.log(`📋 INVENTORY-MATERIALS - Found ${inventorySnapshot?.docs.length || 0} records with Material + PO match`);
      
      // Filter by Import Date manually (since Firestore date queries can be tricky)
      const matchingInventoryDocs = inventorySnapshot?.docs.filter(doc => {
        const data = doc.data() as any;
        if (data.importDate) {
          const docDate = data.importDate.toDate();
          const docDateStr = docDate.toLocaleDateString('en-GB').split('/').join(''); // Convert to DDMMYYYY
          console.log(`📅 Comparing: IMD ${imdStr} vs Doc Date ${docDateStr}`);
          return docDateStr === imdStr;
        }
        return false;
      }) || [];
      
      console.log(`📋 INVENTORY-MATERIALS (with matching Import Date) - Found ${matchingInventoryDocs.length} records`);
      
      // Check if found in inventory-materials with matching IMD
      if (matchingInventoryDocs && matchingInventoryDocs.length > 0) {
        const foundDoc = matchingInventoryDocs[0];
        const foundRecord = foundDoc.data() as any;
        
        this.foundRM1Item = {
          id: foundDoc.id,
          ...foundRecord,
            parsedData: parsedData
          };
        
          this.currentLocation = this.foundRM1Item.location || 'N/A';
          
        console.log(`✅ Found in INVENTORY-MATERIALS with matching Import Date:`, this.foundRM1Item);
          
          // Move to next step
          this.changeLocationStep = 3;
          
          // Initialize location scanner if camera was selected
          setTimeout(() => {
            this.initializeLocationScannerForStep3();
            
            const locationInput = document.querySelector('#locationInput') as HTMLInputElement;
            if (locationInput) {
              locationInput.focus();
            }
          }, 100);
          
        return;
      }
      // If not found, show error
      console.log(`❌ Material not found in RM1 Inventory`);
      alert(`❌ Không tìm thấy mã hàng trong RM1 Inventory!\n\nMã hàng: ${parsedData.materialCode}\nPO: ${parsedData.poNumber}\nIMD: ${parsedData.imd}\n\nVui lòng kiểm tra lại thông tin.`);
            this.scannedMaterialCode = '';
            return;
    } catch (error) {
      console.error('❌ Error searching for material:', error);
      alert('❌ Lỗi khi tìm kiếm mã hàng. Vui lòng thử lại.');
      this.scannedMaterialCode = '';
    }
  }

  initializeLocationScannerForStep3(): void {
    console.log(`🔧 Initializing location scanner for step 3...`);
    
    // 🔧 FIX: Set scanning state trước khi khởi tạo scanner
    this.isActivelyScanningLocation = true;
    this.locationScanCompleted = false;
    
    if (this.selectedScannerTypes.step3 === 'camera') {
      // Start QR scanner for step 3
      setTimeout(() => {
        console.log(`📸 Starting QR scanner for location (step 3)...`);
        this.startQRScannerForStep(3);
      }, 200);
    }
  }

  processNewLocation(): void {
    if (!this.scannedNewLocation || !this.scannedNewLocation.trim()) {
      alert('⚠️ Vui lòng nhập vị trí mới!');
      return;
    }
    
    console.log(`📍 Processing new location: ${this.scannedNewLocation}`);
    
    // Set new location và tự động confirm
    this.newLocation = this.scannedNewLocation.trim();
    this.autoConfirmLocationChange();
  }

  confirmLocationChange(): void {
    if (!this.foundRM1Item || !this.newLocation) {
      alert('❌ Thiếu thông tin. Vui lòng scan lại.');
      return;
    }

    // Validate new location format
    if (!this.validateViTriInput(this.newLocation)) {
      alert('❌ Vị trí không hợp lệ. Chỉ cho phép chữ cái, số, dấu chấm (.), gạch ngang (-), và ngoặc đơn (()).');
      return;
    }

    const formattedLocation = this.formatViTriInput(this.newLocation);
    
    // Check if new location exists in location list
    const locationExists = this.locationItems.some(item => 
      this.normalizeLocationCode(item.viTri) === this.normalizeLocationCode(formattedLocation)
    );

    if (!locationExists) {
      alert(`❌ Vị trí "${formattedLocation}" không tồn tại trong danh sách vị trí.\n\nVui lòng chọn vị trí hợp lệ hoặc thêm vị trí mới trước.`);
      return;
    }

    // Show confirmation dialog
    const confirmMessage = `🔄 Xác nhận thay đổi vị trí:\n\n` +
      `Mã hàng: ${this.foundRM1Item.materialCode}\n` +
      `PO: ${this.foundRM1Item.poNumber}\n` +
      `IMD: ${this.foundRM1Item.parsedData.imd}\n\n` +
      `Từ: ${this.currentLocation}\n` +
      `Đến: ${formattedLocation}\n\n` +
      `Bạn có chắc chắn muốn thay đổi?`;

    if (confirm(confirmMessage)) {
      this.updateRM1LocationInFirebase(formattedLocation);
    }
  }

  async updateRM1LocationInFirebase(newLocation: string): Promise<void> {
    try {
      console.log(`🔄 Updating location in Firebase...`);
      
      const docRef = this.firestore.collection('inventory-materials').doc(this.foundRM1Item.id);
      
      await docRef.update({
        location: newLocation,
        lastModified: new Date(),
        modifiedBy: 'location-change-scanner'
      });

      console.log(`✅ Location updated successfully!`);
      
      alert(`✅ Đã cập nhật vị trí thành công!\n\n` +
        `Mã hàng: ${this.foundRM1Item.materialCode}\n` +
        `PO: ${this.foundRM1Item.poNumber}\n` +
        `IMD: ${this.foundRM1Item.parsedData.imd}\n` +
        `Vị trí mới: ${newLocation}`);

      // Reset and close modal
      this.resetChangeLocation();
      this.closeChangeLocationModal();
      
    } catch (error) {
      console.error('❌ Error updating location:', error);
      alert(`❌ Lỗi khi cập nhật vị trí: ${error}`);
    }
  }

  // Helper function to wait for element
  private waitForElement(selector: string): Promise<Element> {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver(() => {
        const element = document.querySelector(selector);
        if (element) {
          observer.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element ${selector} not found`));
      }, 5000);
    });
  }

  // Store Material (Cất NVL) Functions
  openStoreMaterialModal(): void {
    this.showStoreMaterialModal = true;
    this.storeMaterialStep = 'scan';
    this.storeMaterialQRInput = '';
    this.scannedMaterialCodeForStore = '';
    this.foundMaterialsForStore = [];
    this.selectedMaterialForStore = null;
    this.suggestedLocations = [];
    this.selectedTargetLocation = '';
    this.isSearchingMaterial = false;
    
    // Force change detection để đảm bảo modal đã render
    this.cdr.detectChanges();
    
    // Auto focus vào input sau khi modal mở
    setTimeout(() => {
      const input = document.getElementById('storeMaterialQRInput') as HTMLInputElement;
      if (input) {
        input.focus();
        // Không select() để người dùng có thể scan ngay
        console.log('✅ Input focused for store material');
      } else {
        console.log('⚠️ Input not found, retrying...');
        // Retry sau 200ms nếu chưa tìm thấy
        setTimeout(() => {
          const retryInput = document.getElementById('storeMaterialQRInput') as HTMLInputElement;
          if (retryInput) {
            retryInput.focus();
            console.log('✅ Input focused on retry');
          }
        }, 200);
      }
    }, 150);
  }

  closeStoreMaterialModal(): void {
    this.showStoreMaterialModal = false;
    this.storeMaterialStep = 'scan';
    this.storeMaterialQRInput = '';
    this.scannedMaterialCodeForStore = '';
    this.foundMaterialsForStore = [];
    this.selectedMaterialForStore = null;
    this.suggestedLocations = [];
    this.selectedTargetLocation = '';
    this.isSearchingMaterial = false;
  }

  async processStoreMaterialQR(): Promise<void> {
    const qrCode = this.storeMaterialQRInput.trim();
    if (!qrCode) {
      alert('⚠️ Vui lòng nhập hoặc scan mã QR');
      return;
    }

    this.isSearchingMaterial = true;
    this.scannedMaterialCodeForStore = qrCode;

    try {
      // Parse QR code: MaterialCode|PO|Quantity|Date
      const parts = qrCode.split('|');
      let materialCode = '';
      let poNumber = '';

      if (parts.length >= 2) {
        materialCode = parts[0].trim().substring(0, 7); // Lấy 7 ký tự đầu
        poNumber = parts[1].trim(); // PO number
      } else if (parts.length >= 1) {
        materialCode = parts[0].trim().substring(0, 7);
      } else {
        materialCode = qrCode.trim().substring(0, 7);
      }

      if (!materialCode) {
        alert('❌ Không thể đọc mã hàng từ QR code');
        this.isSearchingMaterial = false;
        return;
      }

      console.log(`🔍 Searching for material: ${materialCode}, PO: ${poNumber || 'N/A'}`);

      // Tìm tất cả materials có materialCode này trong inventory-materials (để lấy các vị trí khác)
      const allMaterialsSnapshot = await this.firestore
        .collection('inventory-materials', ref =>
          ref.where('factory', '==', 'ASM1')
             .where('materialCode', '==', materialCode)
        )
        .get()
        .toPromise();

      if (!allMaterialsSnapshot || allMaterialsSnapshot.empty) {
        alert(`❌ Không tìm thấy material với mã: ${materialCode}`);
        this.isSearchingMaterial = false;
        return;
      }

      // Lấy tất cả materials để tìm các vị trí khác
      const allMaterials: any[] = [];
      const locationSet = new Set<string>();
      let matchedMaterial: any = null;

      allMaterialsSnapshot.forEach(doc => {
        const data = doc.data() as any;
        
        // Tính stock đúng cách: openingStock + quantity - exported - xt
        const openingStockValue = data.openingStock !== null && data.openingStock !== undefined ? Number(data.openingStock) : 0;
        const quantity = Number(data.quantity) || 0;
        const exported = Number(data.exported) || 0;
        const xt = Number(data.xt) || 0;
        const calculatedStock = openingStockValue + quantity - exported - xt;
        
        const material = {
          id: doc.id,
          materialCode: data.materialCode || '',
          poNumber: data.poNumber || '',
          location: data.location || '',
          stock: calculatedStock,
          openingStock: data.openingStock,
          quantity: quantity,
          exported: exported,
          xt: xt,
          batchNumber: data.batchNumber || '',
          importDate: data.importDate
        };

        allMaterials.push(material);
        
        // Thu thập tất cả các vị trí
        if (material.location && material.location.trim() !== '') {
          locationSet.add(material.location);
        }

        // Tìm material khớp với QR code (materialCode + PO)
        if (material.materialCode === materialCode) {
          if (poNumber && material.poNumber === poNumber) {
            // Khớp cả materialCode và PO
            matchedMaterial = material;
          } else if (!poNumber && !matchedMaterial) {
            // Nếu không có PO trong QR code, lấy material đầu tiên
            matchedMaterial = material;
          }
        }
      });

      // Nếu không tìm thấy material khớp chính xác, lấy material đầu tiên
      if (!matchedMaterial && allMaterials.length > 0) {
        matchedMaterial = allMaterials[0];
        console.log(`⚠️ Không tìm thấy material khớp chính xác, sử dụng material đầu tiên`);
      }

      if (!matchedMaterial) {
        alert(`❌ Không tìm thấy material khớp với QR code`);
        this.isSearchingMaterial = false;
        return;
      }

      // Chỉ hiển thị material được scan (khớp với QR code)
      this.foundMaterialsForStore = [matchedMaterial];
      this.selectedMaterialForStore = matchedMaterial;

      // Tạo danh sách tất cả các vị trí hiện có của cùng materialCode
      // Bao gồm tất cả các vị trí (không loại bỏ vị trí hiện tại)
      // Sắp xếp và loại bỏ trùng lặp
      const allLocations = Array.from(locationSet).filter(loc => loc && loc.trim() !== '').sort();
      this.suggestedLocations = allLocations;

      console.log(`✅ Found material: ${matchedMaterial.materialCode} (PO: ${matchedMaterial.poNumber})`);
      console.log(`📍 Material hiện tại ở vị trí: ${matchedMaterial.location || 'Chưa có'}`);
      console.log(`📍 Tất cả các vị trí hiện có của mã hàng này: ${allLocations.join(', ') || 'Không có'}`);

      // Chuyển sang bước chọn vị trí
      this.storeMaterialStep = 'choose-location';
      
      // Clear và focus vào input để sẵn sàng scan/nhập vị trí mới
      this.selectedTargetLocation = '';
      this.storeMaterialQRInput = '';
      this.isSearchingMaterial = false;
      
      // Auto focus vào input vị trí sau khi modal render
      setTimeout(() => {
        const locationInput = document.querySelector('.location-input') as HTMLInputElement;
        if (locationInput) {
          locationInput.focus();
        }
      }, 200);
    } catch (error) {
      console.error('❌ Error searching material:', error);
      alert(`❌ Lỗi khi tìm kiếm material: ${error}`);
      this.isSearchingMaterial = false;
    }
  }

  selectMaterialForStore(material: any): void {
    this.selectedMaterialForStore = material;
    this.storeMaterialStep = 'choose-location';
  }

  async confirmStoreMaterial(): Promise<void> {
    if (!this.selectedMaterialForStore || !this.selectedTargetLocation) {
      alert('⚠️ Vui lòng chọn material và vị trí đích');
      return;
    }

    try {
      // Cập nhật location trong Firebase
      await this.firestore
        .collection('inventory-materials')
        .doc(this.selectedMaterialForStore.id)
        .update({
          location: this.selectedTargetLocation,
          lastModified: new Date(),
          modifiedBy: 'store-material-scanner'
        });

      alert(`✅ Đã cất material thành công!\n\n` +
            `Mã hàng: ${this.selectedMaterialForStore.materialCode}\n` +
            `PO: ${this.selectedMaterialForStore.poNumber}\n` +
            `Vị trí mới: ${this.selectedTargetLocation}`);

      // Đóng modal và reset
      this.closeStoreMaterialModal();
    } catch (error) {
      console.error('❌ Error storing material:', error);
      alert(`❌ Lỗi khi cất material: ${error}`);
    }
  }

  // ==================== CUSTOMER CODE METHODS ====================

  // Import Customer Codes
  importCustomerCodes() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.processImportCustomerFile(file);
      }
    };
    input.click();
  }

  // Process imported customer file
  private processImportCustomerFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        console.log('📋 Imported customer data:', jsonData);
        console.log('ℹ️ IMPORT MODE: New codes will OVERWRITE existing codes');
        
        // Skip header row (row 1) and process all data from row 2 onwards
        const customers = [];
        const codes = new Set<string>(); // Track codes to prevent duplicates within import file
        
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i] as any[];
          if (row && row.length >= 4 && row[0] && row[0].toString().trim()) {
            const no = parseInt(row[0].toString().trim()) || i;
            const customer = row[1] ? row[1].toString().trim() : '';
            const group = row[2] ? row[2].toString().trim() : '';
            const code = row[3] ? row[3].toString().trim() : '';
            
            if (customer && code) {
              // Check for duplicates within import data only (use last occurrence)
              if (codes.has(code)) {
                console.log(`⚠️ Duplicate in import file: ${code} - Will use last occurrence`);
                // Remove previous entry with same code
                const existingIndex = customers.findIndex(c => c.code === code);
                if (existingIndex >= 0) {
                  customers.splice(existingIndex, 1);
                }
              }
              
              // Check if code exists in database
              const existingItem = this.customerCodes.find(item => item.code === code);
              if (existingItem) {
                console.log(`🔄 Code exists in database: ${code} - Will UPDATE`);
                customers.push({
                  id: existingItem.id, // Keep existing ID to update
                  no: no,
                  customer: customer,
                  group: group || '',
                  code: code,
                  updatedAt: new Date()
                });
              } else {
                console.log(`✅ New code: ${code} - Will ADD`);
                customers.push({
                  no: no,
                  customer: customer,
                  group: group || '',
                  code: code,
                  createdAt: new Date()
                });
              }
              
              codes.add(code);
            }
          }
        }
        
        console.log(`📊 Total valid customers: ${customers.length} (includes both new and updates)`);
        
        if (customers.length > 0) {
          this.saveImportedCustomerCodes(customers);
        } else {
          alert('Không tìm thấy dữ liệu hợp lệ để import. Vui lòng kiểm tra:\n- Dòng 1 phải là tiêu đề: No, Customer, Group, Code\n- Từ dòng 2 trở đi phải có dữ liệu đầy đủ');
        }
      } catch (error) {
        console.error('Error processing customer file:', error);
        alert('Lỗi khi đọc file. Vui lòng kiểm tra định dạng file.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // Save imported customer codes to database (ADD new or UPDATE existing)
  private saveImportedCustomerCodes(customers: any[]) {
    const batch = this.firestore.firestore.batch();
    let addCount = 0;
    let updateCount = 0;
    
    customers.forEach(customer => {
      if (customer.id) {
        // UPDATE existing document
        const docRef = this.firestore.collection('customer-codes').doc(customer.id).ref;
        const updateData = {
          no: customer.no,
          customer: customer.customer,
          group: customer.group,
          code: customer.code,
          updatedAt: new Date()
        };
        batch.update(docRef, updateData);
        updateCount++;
        console.log(`🔄 Updating: ${customer.code}`);
      } else {
        // ADD new document
        const docRef = this.firestore.collection('customer-codes').doc().ref;
        const newData = {
          no: customer.no,
          customer: customer.customer,
          group: customer.group,
          code: customer.code,
          createdAt: new Date()
        };
        batch.set(docRef, newData);
        addCount++;
        console.log(`➕ Adding: ${customer.code}`);
      }
    });
    
    batch.commit().then(() => {
      console.log(`✅ Import complete: ${addCount} added, ${updateCount} updated`);
      alert(`✅ Import thành công!\n- Thêm mới: ${addCount} mã\n- Cập nhật: ${updateCount} mã\n- Tổng: ${customers.length} mã`);
      this.loadCustomerCodes();
    }).catch(error => {
      console.error('Error importing customer codes:', error);
      alert('Lỗi khi import dữ liệu. Vui lòng thử lại.');
    });
  }

  // Delete single customer code
  deleteCustomerCode(customer: CustomerCode) {
    if (!confirm(`⚠️ Xóa mã khách hàng?\n\nCustomer: ${customer.customer}\nCode: ${customer.code}\n\nBạn có chắc muốn xóa?`)) {
      return;
    }

    if (!customer.id) {
      alert('❌ Không tìm thấy ID của mã khách hàng!');
      return;
    }

    this.firestore.collection('customer-codes').doc(customer.id).delete()
      .then(() => {
        console.log(`✅ Deleted customer code: ${customer.code}`);
        alert(`✅ Đã xóa mã khách hàng: ${customer.code}`);
        // Data will auto-reload via subscription in loadCustomerCodes()
      })
      .catch(error => {
        console.error('❌ Error deleting customer code:', error);
        alert('Lỗi khi xóa. Vui lòng thử lại.');
      });
  }

  // Load customer codes from database
  loadCustomerCodes() {
    this.firestore.collection('customer-codes', ref => ref.orderBy('no', 'asc'))
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe(actions => {
        this.customerCodes = actions.map(action => ({
          id: action.payload.doc.id,
          ...action.payload.doc.data() as CustomerCode
        }));
        // Cập nhật filteredCustomerCodes ngay sau khi load
        this.filteredCustomerCodes = [...this.customerCodes];
      });
  }

  // Download customer code template
  downloadCustomerTemplate() {
    try {
      const templateData = [
        ['No', 'Customer', 'Group', 'Code'], // Header row
        [1, 'Customer A', 'Group 1', 'CUST001'],
        [2, 'Customer B', 'Group 1', 'CUST002'],
        [3, 'Customer C', 'Group 2', 'CUST003'],
        [4, 'Customer D', 'Group 2', 'CUST004'],
        [5, 'Customer E', 'Group 3', 'CUST005']
      ];

      const ws: XLSX.WorkSheet = XLSX.utils.aoa_to_sheet(templateData);
      const wb: XLSX.WorkBook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Customer Code Template');
      
      XLSX.writeFile(wb, 'Customer_Code_Template.xlsx');
    } catch (error) {
      console.error('Error creating customer template:', error);
      alert('Lỗi khi tạo template. Vui lòng thử lại.');
    }
  }

  // ==================== FG LOCATION METHODS ====================

  // Open FG Location Modal
  openFGModal() {
    this.showFGModal = true;
    this.loadFGLocations();
    this.isDropdownOpen = false;
  }

  // Close FG Location Modal
  closeFGModal() {
    this.showFGModal = false;
    this.fgSearchTerm = '';
    this.filteredFGLocations = [...this.fgLocations];
  }

  // Load FG Locations from database
  loadFGLocations() {
    this.firestore.collection('fg-locations', ref => ref.orderBy('stt', 'asc'))
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe(actions => {
        this.fgLocations = actions.map(action => ({
          id: action.payload.doc.id,
          ...action.payload.doc.data() as FGLocation
        }));
        this.filteredFGLocations = [...this.fgLocations];
      });
  }

  // Search FG Locations
  onFGSearchInput(event: any) {
    const term = event.target.value.toLowerCase();
    this.fgSearchTerm = term;
    
    if (!term || term.trim().length < 1) {
      this.filteredFGLocations = [...this.fgLocations];
    } else {
      this.filteredFGLocations = this.fgLocations.filter(item => {
        return (
          item.stt.toString().includes(term) ||
          item.viTri.toLowerCase().includes(term) ||
          item.qrCode.toLowerCase().includes(term)
        );
      });
    }
  }

  // Clear FG Search
  clearFGSearch() {
    this.fgSearchTerm = '';
    this.filteredFGLocations = [...this.fgLocations];
  }

  // ==================== CUSTOMER MODAL METHODS ====================

  // Open Customer Modal
  openCustomerModal() {
    this.showCustomerModal = true;
    this.loadCustomerCodes();
  }

  // Close Customer Modal
  closeCustomerModal() {
    this.showCustomerModal = false;
    this.customerSearchTerm = '';
    this.filteredCustomerCodes = [...this.customerCodes];
  }

  // Search Customer Codes
  onCustomerSearchInput(event: any) {
    const term = event.target.value.toLowerCase();
    this.customerSearchTerm = term;
    
    if (!term || term.trim().length < 1) {
      this.filteredCustomerCodes = [...this.customerCodes];
    } else {
      this.filteredCustomerCodes = this.customerCodes.filter(item => {
        return (
          item.no.toString().includes(term) ||
          item.customer.toLowerCase().includes(term) ||
          item.group.toLowerCase().includes(term) ||
          item.code.toLowerCase().includes(term)
        );
      });
    }
  }

  // Clear Customer Search
  clearCustomerSearch() {
    this.customerSearchTerm = '';
    this.filteredCustomerCodes = [...this.customerCodes];
  }

  // Print Customer Label
  async printCustomerLabel(customer: CustomerCode) {
    try {
      // Tạo mã QR từ customer code với độ phân giải cao
      const qrImage = await QRCode.toDataURL(customer.code, {
        width: 800,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });

      // Tạo nội dung để in label với kích thước 100mm x 130mm
      // Code text ở trên, QR code ở dưới, mỗi phần chiếm 50% chiều cao
      // Cả tem quay 90 độ để hiển thị dọc
      const printContent = `
        <div class="customer-label" style="
          width: 100mm; 
          height: 130mm; 
          border: none; 
          display: flex; 
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
          padding: 5mm;
          margin: 0;
          box-sizing: border-box;
          font-family: Arial, sans-serif;
          background: white;
          position: relative;
        ">
          <!-- Code text - Flexible height -->
          <div class="code-section" style="
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            border: none;
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            overflow: visible;
          ">
            <div style="
              font-size: 96px; 
              font-weight: bold; 
              color: #000;
              font-family: 'Arial', sans-serif;
              letter-spacing: 6px;
              display: inline-block;
              writing-mode: vertical-rl;
              text-orientation: mixed;
              transform: rotate(180deg);
              white-space: nowrap;
            ">
              ${customer.code}
            </div>
          </div>
          
          <!-- Spacer - Fixed gap -->
          <div style="height: 10mm; flex-shrink: 0;"></div>
          
          <!-- QR Code - Fixed size -->
          <div class="qr-section" style="
            flex-shrink: 0;
            display: flex; 
            align-items: center; 
            justify-content: center;
            overflow: visible;
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          ">
            <img src="${qrImage}" 
                 alt="QR Code for ${customer.code}" 
                 style="
                   width: 60mm !important; 
                   height: 60mm !important;
                   min-width: 60mm;
                   min-height: 60mm;
                   max-width: 60mm;
                   max-height: 60mm;
                   object-fit: contain;
                   display: block;
                   border: none;
                 "
                 title="QR Code: ${customer.code}">
          </div>
        </div>
      `;
    
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Customer Label</title>
              <style>
                @page {
                  size: 100mm 130mm;
                  margin: 0mm;
                  padding: 0mm;
                }
                
                * {
                  margin: 0;
                  padding: 0;
                  box-sizing: border-box;
                  -webkit-print-color-adjust: exact;
                  print-color-adjust: exact;
                  color-adjust: exact;
                }
                
                html {
                  width: 100mm;
                  height: 130mm;
                  margin: 0;
                  padding: 0;
                }
                
                body {
                  width: 100mm;
                  height: 130mm;
                  margin: 0 !important;
                  padding: 0 !important;
                  overflow: hidden;
                  font-family: Arial, sans-serif;
                  background: white;
                  transform-origin: top left;
                  transform: scale(1);
                }
                
                .customer-label {
                  width: 100mm !important;
                  height: 130mm !important;
                  margin: 0 !important;
                  padding: 0 !important;
                  box-shadow: none;
                  border: none;
                  position: absolute;
                  top: 0;
                  left: 0;
                }
                
                @media print {
                  @page {
                    size: 100mm 130mm;
                    margin: 0mm;
                  }
                  
                  html, body {
                    width: 100mm;
                    height: 130mm;
                    margin: 0 !important;
                    padding: 0 !important;
                    overflow: visible;
                  }
                  
                  .customer-label {
                    width: 100mm !important;
                    height: 130mm !important;
                    page-break-after: avoid;
                    page-break-inside: avoid;
                  }
                }
              </style>
            </head>
            <body>
              ${printContent}
              <script>
                window.onload = function() {
                  // Show instruction alert before printing
                  alert('⚠️ QUAN TRỌNG:\\n\\nTrong hộp thoại Print:\\n1. Mở "More settings"\\n2. TẮT "Headers and footers"\\n3. Đặt Scale = 100% (Default)\\n4. Margins = None\\n5. Nhấn Print');
                  
                  setTimeout(function() {
                    window.print();
                    window.onafterprint = function() {
                      window.close();
                    };
                  }, 100);
                };
              </script>
            </body>
          </html>
        `);
        printWindow.document.close();
      }
    } catch (error) {
      console.error('Error printing customer label:', error);
      alert('❌ Lỗi khi in tem khách hàng');
    }
  }
}

