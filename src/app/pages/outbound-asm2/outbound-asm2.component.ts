import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import * as XLSX from 'xlsx';
import { Html5Qrcode } from 'html5-qrcode';
import { FactoryAccessService } from '../../services/factory-access.service';
import { QRScannerService, QRScanResult } from '../../services/qr-scanner.service';
import { MatDialog } from '@angular/material/dialog';
import { QRScannerModalComponent, QRScannerData } from '../../components/qr-scanner-modal/qr-scanner-modal.component';


export interface OutboundMaterial {
  id?: string;
  factory?: string;
  materialCode: string;
  poNumber: string;
  quantity: number;
  unit: string;
  exportQuantity: number;
  exportDate: Date;
  location: string;
  exportedBy: string;
  batch?: string;
      batchNumber?: string; // Batch number từ QR code
  scanMethod?: string;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
  productionOrder?: string; // Lệnh sản xuất
  employeeId?: string; // Mã nhân viên
  importDate?: string; // Ngày nhập từ QR code để so sánh chính xác với inventory

}

@Component({
  selector: 'app-outbound-asm2',
  templateUrl: './outbound-asm2.component.html',
  styleUrls: ['./outbound-asm2.component.scss', './lsx-filter-styles.scss']
})
export class OutboundASM2Component implements OnInit, OnDestroy {
  materials: OutboundMaterial[] = [];
  filteredMaterials: OutboundMaterial[] = [];
  selectedFactory: string = 'ASM2';
  currentPage: number = 1;
  itemsPerPage: number = 50;
  totalPages: number = 1;
  isLoading: boolean = false;
  errorMessage: string = '';
  private destroy$ = new Subject<void>();
  
  // QR Scanner properties
  isCameraScanning: boolean = false;
  isScannerLoading: boolean = false;
  scanner: Html5Qrcode | null = null;
  lastScannedData: any = null;
  exportQuantity: number = 0;
  
  // Mobile Scanner Selection
  selectedScanMethod: 'camera' | 'scanner' | null = null; // 🔧 SỬA LỖI: Không chọn gì mặc định
  isMobile: boolean = false;
  
  // REMOVED: processedScans - không cần duplicate detection nữa
  
  // Physical Scanner properties
  isScannerInputActive: boolean = false;
  scannerBuffer: string = '';
  scannerTimeout: any = null;
  scanStartTime: number = 0;
  
  // Batch Scanning Mode properties
  isBatchScanningMode: boolean = false;
  batchProductionOrder: string = '';
  batchEmployeeId: string = '';
  isProductionOrderScanned: boolean = false;
  isEmployeeIdScanned: boolean = false;
  
  // Scan queue to avoid losing scans during rapid input
  private isProcessingMaterialScan: boolean = false;
  private materialScanQueue: string[] = [];
  
  // 🔧 LOGIC MỚI SIÊU TỐI ƯU: Chỉ lưu dữ liệu scan, Done mới update
  pendingScanData: any[] = []; // Lưu trữ tạm thời các scan
  showScanReviewModal: boolean = false; // Hiển thị modal review
  isSavingBatchData: boolean = false; // Trạng thái đang lưu dữ liệu
  // - Bước 1: Scan lệnh sản xuất và mã nhân viên
  // - Bước 2: Scan mã hàng (Material + PO + Quantity) - lưu vào pendingScanData
  // - Bước 3: Bấm Done -> batch update inventory + Firebase
  currentScanStep: 'batch' | 'material' = 'batch';
  isWaitingForMaterial: boolean = false;
  
  // Date Range properties
  startDate: string = '';
  endDate: string = '';
  showOnlyToday: boolean = true;
  
  // Production Order Filter properties
  selectedProductionOrder: string = '';
  searchProductionOrder: string = '';
  availableProductionOrders: string[] = [];
  
  // Professional Scanning Modal properties
  showScanningSetupModal: boolean = false;
  scanningSetupStep: 'lsx' | 'employee' = 'lsx';
  
  // Auto-hide previous day's scan history
  hidePreviousDayHistory: boolean = true;
  
  // Dropdown management
  isDropdownOpen: boolean = false;
  
  // REMOVED: inventoryMaterials - Không cần tính stock để scan nhanh
  
  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private factoryAccessService: FactoryAccessService,
    private cdr: ChangeDetectorRef,
    private qrScannerService: QRScannerService,
    private dialog: MatDialog
  ) {}
  
  ngOnInit(): void {
    console.log('🏭 Outbound ASM2 component initialized');
    this.detectMobileDevice();
    this.setupDefaultDateRange();
    this.restorePendingFromStorage();
    // 🔧 OPTIMIZATION: Không load materials khi khởi tạo - chỉ load khi search LSX
    console.log('⏸️ Ready - waiting for LSX search to load data');
    // REMOVED: loadMaterials() - Chỉ load khi user nhập LSX
    // REMOVED: loadInventoryMaterials() - Không cần tính stock để scan nhanh
    
    // Add click outside listener to close dropdown
    document.addEventListener('click', this.onDocumentClick.bind(this));
    
    // Add window resize listener for mobile detection
    window.addEventListener('resize', this.onWindowResize.bind(this));
    
    // 🔧 GLOBAL SCANNER LISTENER: Lắng nghe tất cả keyboard input khi setup modal mở
    document.addEventListener('keydown', (event) => this.onGlobalKeydown(event));
  }
  
  private setupDefaultDateRange(): void {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // Default to show only today's data
    this.startDate = today.toISOString().split('T')[0];
    this.endDate = today.toISOString().split('T')[0];
    this.showOnlyToday = true;
    this.hidePreviousDayHistory = true;
    
    console.log('📅 Date range set to:', { startDate: this.startDate, endDate: this.endDate, showOnlyToday: this.showOnlyToday, hidePreviousDayHistory: this.hidePreviousDayHistory });
  }
  
  onDateRangeChange(): void {
    console.log('📅 Date range changed:', { startDate: this.startDate, endDate: this.endDate });
    
    // Check if showing only today
    const today = new Date().toISOString().split('T')[0];
    this.showOnlyToday = (this.startDate === today && this.endDate === today);
    
    // Auto-hide previous day's history when user selects today
    if (this.showOnlyToday) {
      this.hidePreviousDayHistory = true;
      console.log('📅 User selected today, automatically hiding previous day\'s history');
    }
    
    // Reload materials with new date filter
    this.loadMaterials();
  }
  
  // Toggle auto-hide previous day's scan history
  toggleHidePreviousDayHistory(): void {
    this.hidePreviousDayHistory = !this.hidePreviousDayHistory;
    console.log(`📅 Auto-hide previous day's scan history: ${this.hidePreviousDayHistory ? 'ON' : 'OFF'}`);
    this.loadMaterials();
  }
  
  // Reset to today's date
  resetToToday(): void {
    const today = new Date();
    this.startDate = today.toISOString().split('T')[0];
    this.endDate = today.toISOString().split('T')[0];
    this.hidePreviousDayHistory = true;
    console.log('📅 Reset to today\'s date and hide previous day\'s history');
    this.loadMaterials();
  }
  
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    
    // Cleanup scanner
    if (this.scanner) {
      this.scanner.stop().catch(console.error);
    }
    
    // Remove click outside listener
    document.removeEventListener('click', this.onDocumentClick.bind(this));
    
    // Remove window resize listener
    window.removeEventListener('resize', this.onWindowResize.bind(this));
  }

  // 📱 Mobile Detection
  private detectMobileDevice(): void {
    const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
    const isMobileUserAgent = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
    const isMobileScreen = window.innerWidth <= 768;
    
    // 🔧 SỬA LỖI: PDA có thể không được detect đúng, nên coi tất cả device nhỏ là mobile
    // Hoặc có thể PDA có user agent đặc biệt
    const isPDA = /pda|handheld|mobile|android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
    const isSmallScreen = window.innerWidth <= 1024; // Tăng threshold cho PDA
    
    // Consider it mobile if either user agent, screen size, or PDA-like device
    this.isMobile = isMobileUserAgent || isMobileScreen || isPDA || isSmallScreen;
    
    // 🔧 SỬA LỖI: Force mobile mode cho PDA nếu có vấn đề detect
    // Nếu user đã chọn scanner và device có vẻ như PDA, force mobile mode
    if (this.selectedScanMethod === 'scanner' && (isPDA || isSmallScreen)) {
      console.log('🔧 Force mobile mode for PDA device');
      this.isMobile = true;
    }
    
    console.log('📱 Device detection:', {
      userAgent: userAgent,
      isMobileUserAgent,
      isMobileScreen,
      isPDA,
      isSmallScreen,
      windowWidth: window.innerWidth,
      isMobile: this.isMobile,
      currentSelectedMethod: this.selectedScanMethod
    });
    
    // 🔧 SỬA LỖI: Chỉ set default khi chưa có lựa chọn, không reset lựa chọn của user
    if (this.selectedScanMethod === null) {
      if (this.isMobile) {
        console.log('📱 Mobile device detected - Default to camera mode');
        this.selectedScanMethod = 'camera';
      } else {
        console.log('🖥️ Desktop device detected - Default to scanner mode');
        this.selectedScanMethod = 'scanner';
      }
    } else {
      console.log(`📱 Device detection: ${this.isMobile ? 'Mobile' : 'Desktop'}, keeping user selection: ${this.selectedScanMethod}`);
    }
  }

  // 📱 Mobile Scanner Method Selection
  selectScanMethod(method: 'camera' | 'scanner'): void {
    this.selectedScanMethod = method;
    console.log(`📱 Selected scan method: ${method}`);
    console.log(`📱 Will call: ${method === 'scanner' ? 'startBatchScanningMode()' : 'startCameraScanning()'}`);
    
    // Stop current scanning if active
    if (this.isCameraScanning) {
      this.stopScanning();
    }
    
    // 🔧 SYNC FIX: Refresh inventory data khi chuyển đổi method
    console.log(`🔄 Refreshing inventory data for ${method} method...`);
    this.loadMaterials();
  }


  // 📱 Window Resize Handler
  private onWindowResize(): void {
    const wasMobile = this.isMobile;
    this.detectMobileDevice();
    
    // If mobile state changed, trigger change detection
    if (wasMobile !== this.isMobile) {
      console.log('📱 Mobile state changed:', this.isMobile);
      this.cdr.detectChanges();
    }
  }
  
  // Dropdown methods
  toggleDropdown(): void {
    this.isDropdownOpen = !this.isDropdownOpen;
    this.cdr.detectChanges();
  }
  
  closeDropdown(): void {
    this.isDropdownOpen = false;
    this.cdr.detectChanges();
  }
  
  // Search by Production Order (LSX) - Only load when user enters LSX
  searchByProductionOrder(): void {
    if (!this.searchProductionOrder || !this.searchProductionOrder.trim()) {
      alert('⚠️ Vui lòng nhập lệnh sản xuất!');
      return;
    }
    
    const searchTerm = this.searchProductionOrder.trim().toUpperCase();
    console.log(`🔍 Searching for Production Order: ${searchTerm}`);
    
    // 🔧 TÌM KIẾM KHÔNG PHÂN BIỆT CHỮ HOA/THƯỜNG
    // Tìm trong availableProductionOrders để khớp chính xác
    const foundLSX = this.availableProductionOrders.find(lsx => 
      lsx.toUpperCase() === searchTerm || lsx.toUpperCase().includes(searchTerm)
    );
    
    console.log(`📋 Available LSX list (${this.availableProductionOrders.length}):`, this.availableProductionOrders);
    
    if (foundLSX) {
      this.selectedProductionOrder = foundLSX; // Dùng LSX gốc từ DB
      console.log(`✅ Found matching LSX: ${foundLSX}`);
    } else {
      // Không tìm thấy - vẫn thử search để xem có dữ liệu không
      this.selectedProductionOrder = this.searchProductionOrder.trim();
      console.log(`⚠️ No exact match in available list. Searching with: ${this.selectedProductionOrder}`);
      console.log(`💡 Tip: Available LSX in DB:`, this.availableProductionOrders.slice(0, 5));
    }
    
    this.loadMaterials(); // Load data for this LSX
  }
  
  // Clear Production Order filter (hide all data)
  clearProductionOrderFilter(): void {
    this.selectedProductionOrder = '';
    this.searchProductionOrder = '';
    console.log('🔄 Clearing Production Order filter - hiding all data');
    this.loadMaterials(); // Reload to hide all
  }
  
  // Display only first 7 characters of employee ID
  getDisplayEmployeeId(employeeId: string): string {
    if (!employeeId) return 'N/A';
    return employeeId.length > 7 ? employeeId.substring(0, 7) : employeeId;
  }
  
  // 🗑️ REMOVED: Debug functions - không cần nữa
  
  // 🔧 UNIFIED INVENTORY UPDATE: Đảm bảo camera và scanner cùng dùng 1 method
  private async unifiedUpdateInventory(materialCode: string, poNumber: string, exportQuantity: number, importDate?: string, scanMethod: string = 'UNIFIED'): Promise<void> {
    try {
      console.log(`🎯 UNIFIED UPDATE: ${scanMethod} - Material=${materialCode}, PO=${poNumber}, Qty=${exportQuantity}, Batch=${importDate}`);
      
      // Gọi method cập nhật inventory thống nhất (đã loại bỏ các delay không cần thiết)
      await this.updateInventoryExported(materialCode, poNumber, exportQuantity, importDate);
      
      console.log(`✅ UNIFIED: Inventory updated successfully for ${scanMethod}`);
      
    } catch (error) {
      console.error(`❌ UNIFIED: Error updating inventory for ${scanMethod}:`, error);
      throw error;
    }
  }
  
  // Professional Scanning Setup Modal Methods
  closeScanningSetupModal(): void {
    this.showScanningSetupModal = false;
    this.scanningSetupStep = 'lsx';
    this.isScannerInputActive = false; // Reset scanner input state
    console.log('❌ Professional scanning setup modal closed');
  }
  
  // Handle LSX scan in modal (auto-detect from scanner input)
  onLSXScanned(lsx: string): void {
    if (!lsx || !lsx.trim()) return;
    
    this.batchProductionOrder = lsx.trim();
    this.isProductionOrderScanned = true;
    this.scanningSetupStep = 'employee';
    console.log(`✅ LSX scanned: ${lsx} - Moving to employee scan`);
    
    // Clear scanner buffer for next scan
    this.scannerBuffer = '';
    
    // 🔧 ENHANCED AUTO-FOCUS: Tự động focus cho bước tiếp theo với delay lâu hơn
    setTimeout(() => {
      this.focusScannerInput();
      console.log('📍 Auto-focused scanner input for Employee ID step');
    }, 500);
  }
  
  // Handle Employee ID scan in modal (auto-detect from scanner input)
  onEmployeeScanned(employeeId: string): void {
    if (!employeeId || !employeeId.trim()) return;
    
    // 🔧 LẤY 7 KÝ TỰ ĐẦU TIÊN: QR code có thể dài bao nhiêu cũng được, chỉ lấy 7 ký tự đầu
    const trimmedId = employeeId.trim();
    const extractedId = trimmedId.substring(0, 7); // Lấy 7 ký tự đầu tiên
    
    console.log(`🔍 Original QR code: "${trimmedId}" (length: ${trimmedId.length})`);
    console.log(`🔍 Extracted 7 chars: "${extractedId}"`);
    
    // 🔧 VALIDATION: Validate format ASP + 4 số sau khi lấy 7 ký tự đầu
    if (extractedId.length === 7 && extractedId.startsWith('ASP')) {
      const aspPart = extractedId.substring(0, 3);
      const numberPart = extractedId.substring(3, 7);
      
      if (aspPart === 'ASP' && /^\d{4}$/.test(numberPart)) {
        this.batchEmployeeId = extractedId;
        this.isEmployeeIdScanned = true;
        console.log(`✅ Employee ID scanned: ${extractedId} - Setup complete`);
        
        // Close setup modal and start material scanning
        this.showScanningSetupModal = false;
        this.isBatchScanningMode = true;
        this.currentScanStep = 'material';
        
        // Clear scanner buffer for next scan
        this.scannerBuffer = '';
        
        // 🔧 ENHANCED AUTO-FOCUS: Tự động focus cho material scanning
        setTimeout(() => {
          this.focusScannerInput();
          console.log('📍 Auto-focused scanner input for material scanning');
        }, 500);
        
        console.log('🎯 Professional scanning setup complete - Ready for material scanning');
      } else {
        // ❌ Invalid format - show error and stay on employee step
        this.showScanError(`Sai định dạng mã nhân viên: ${extractedId}. Phải có format ASP + 4 số (ví dụ: ASP2101)`);
        console.log('❌ Invalid employee ID format, staying on employee step');
      }
    } else {
      // ❌ Invalid format - show error and stay on employee step
      this.showScanError(`Mã nhân viên phải có 7 ký tự (ASP + 4 số). Nhận được: ${extractedId}`);
      console.log('❌ Invalid employee ID length/format, staying on employee step');
    }
  }
  
  // Auto-detect scan input when in setup modal - REMOVED: xử lý trực tiếp trong processScannerInput()
  
  // Skip to next step in modal (for manual input)
  skipToNextStep(): void {
    if (this.scanningSetupStep === 'lsx') {
      this.scanningSetupStep = 'employee';
      console.log('⏭️ Skipped LSX scan - Moving to employee scan');
    } else if (this.scanningSetupStep === 'employee') {
      // Close modal and start material scanning
      this.showScanningSetupModal = false;
      this.isBatchScanningMode = true;
      this.currentScanStep = 'material';
      console.log('⏭️ Skipped employee scan - Setup complete');
    }
  }
  
  onDocumentClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.dropdown')) {
      this.closeDropdown();
    }
  }
  
  // 🔧 GLOBAL KEYBOARD LISTENER: Lắng nghe tất cả keyboard input khi setup modal mở
  onGlobalKeydown(event: KeyboardEvent): void {
    // Chỉ xử lý khi setup modal đang mở và không phải từ input field
    if (!this.showScanningSetupModal) return;
    
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    
    // 🔧 ENHANCED: Xử lý tất cả keyboard input như scanner
    console.log('🔍 Global keyboard input detected:', event.key);
    
    // Chuyển focus về scanner input và xử lý
    const scannerInput = document.querySelector('.scanner-input') as HTMLInputElement;
    if (scannerInput) {
      scannerInput.focus();
      scannerInput.select(); // Clear existing text
      
      // Simulate typing the key
      if (event.key.length === 1) {
        scannerInput.value += event.key;
        // Trigger input event
        const inputEvent = new Event('input', { bubbles: true });
        scannerInput.dispatchEvent(inputEvent);
      } else if (event.key === 'Enter') {
        // Process the scanned data
        this.processScannerInput(scannerInput.value);
      }
    }
  }
  

  
  // Chỉ hiển thị 50 dòng gần nhất để tối ưu hiệu suất
  private readonly DISPLAY_LIMIT = 50;
  
  loadMaterials(): void {
    // 🔧 OPTIMIZATION: Không load gì cả nếu chưa có LSX được chọn
    if (!this.selectedProductionOrder || !this.selectedProductionOrder.trim()) {
      console.log('⏸️ No LSX selected - skipping data load');
      this.materials = [];
      this.filteredMaterials = [];
      this.isLoading = false;
      return;
    }
    
    this.isLoading = true;
    this.errorMessage = '';
    console.log(`📦 Loading materials for LSX: ${this.selectedProductionOrder}...`);
    
    // 🔧 MOBILE OPTIMIZATION: Chỉ load records của LSX được chọn
    // Bỏ orderBy để tránh cần composite index, sẽ sort ở client-side
    this.firestore.collection('outbound-materials', ref => 
      ref.where('factory', '==', this.selectedFactory)
         .where('productionOrder', '==', this.selectedProductionOrder)
         .limit(100)
    ).snapshotChanges()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        // 🔧 TỐI ƯU HÓA: Xử lý batch thay vì từng record để tăng tốc độ
        const materials = snapshot.map(doc => {
          const data = doc.payload.doc.data() as any;
          
          return {
            id: doc.payload.doc.id,
            factory: data.factory || this.selectedFactory,
            materialCode: data.materialCode || '',
            poNumber: data.poNumber || '',
            quantity: data.quantity || 0,
            unit: data.unit || '',
            exportQuantity: data.exportQuantity || 0,
            exportDate: data.exportDate?.toDate() || new Date(),
            location: data.location || '',
            exportedBy: data.exportedBy || '',
            employeeId: data.employeeId || '',
            productionOrder: data.productionOrder || '',
            batchNumber: data.batchNumber || data.importDate || null,
            importDate: data.importDate || null,
            scanMethod: data.scanMethod || 'MANUAL',
            notes: data.notes || '',
            createdAt: data.createdAt?.toDate() || data.createdDate?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || data.lastUpdated?.toDate() || new Date()
          } as OutboundMaterial;
        });
        
        console.log(`📦 Loaded ${materials.length} total materials from outbound-materials collection`);
        
        // 🔧 TỐI ƯU HÓA: Xử lý tất cả trong một lần để tăng tốc độ
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // 🔧 NGUYÊN TẮC MỚI: Không hiển thị LSX nào khi mở màn hình, chỉ show khi lọc
        if (materials.length > 0) {
          // Lấy danh sách tất cả LSX có sẵn để tạo dropdown
          this.availableProductionOrders = [...new Set(
            materials
              .filter(m => m.productionOrder && m.productionOrder.trim() !== '')
              .map(m => m.productionOrder)
          )].sort((a, b) => {
            // Sort LSX theo thời gian tạo (mới nhất trước)
            const aTime = materials.find(m => m.productionOrder === a)?.createdAt?.getTime() || 0;
            const bTime = materials.find(m => m.productionOrder === b)?.createdAt?.getTime() || 0;
            return bTime - aTime;
          });
          
          console.log(`📋 Available Production Orders: ${this.availableProductionOrders.length}`, this.availableProductionOrders);
        }
        
        // 🔧 DEBUG: Log trước khi filter
        if (this.selectedProductionOrder) {
          const matchingMaterials = materials.filter(m => {
            const materialLSX = (m.productionOrder || '').toUpperCase();
            const selectedLSX = (this.selectedProductionOrder || '').toUpperCase();
            return materialLSX.includes(selectedLSX) || materialLSX === selectedLSX;
          });
          console.log(`🔍 Search for LSX "${this.selectedProductionOrder}": Found ${matchingMaterials.length} matching materials`);
          if (matchingMaterials.length > 0) {
            console.log(`📋 Sample matching materials:`, matchingMaterials.slice(0, 3).map(m => ({
              lsx: m.productionOrder,
              material: m.materialCode,
              date: m.exportDate
            })));
          }
        }
        
        // 🔧 OPTIMIZATION: Đã query đúng LSX rồi, không cần filter nữa
        this.materials = materials
          .sort((a, b) => {
            // Sort by latest updated time first (newest first)
            const updatedCompare = b.updatedAt.getTime() - a.updatedAt.getTime();
            if (updatedCompare !== 0) return updatedCompare;
            
            // If same updated time, sort by export date (newest first)
            const dateCompare = b.exportDate.getTime() - a.exportDate.getTime();
            if (dateCompare !== 0) return dateCompare;
            
            // If same date, sort by creation time (newest first)
            return b.createdAt.getTime() - a.createdAt.getTime();
          })
          .filter(material => {
            // Filter by date range if specified
            if (this.startDate && this.endDate) {
              const exportDate = material.exportDate.toISOString().split('T')[0];
              return exportDate >= this.startDate && exportDate <= this.endDate;
            }
            
            // Auto-hide previous day's scan history
            if (this.hidePreviousDayHistory) {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const exportDate = new Date(material.exportDate);
              exportDate.setHours(0, 0, 0, 0);
              if (exportDate < today) return false;
            }
            
            return true;
          })
          .slice(0, this.DISPLAY_LIMIT); // Lấy 50 dòng gần nhất
        
        this.filteredMaterials = [...this.materials];
        this.updatePagination();
        this.isLoading = false;
        
        // 🔧 TỐI ƯU HÓA: Chỉ log một lần thay vì nhiều lần
        console.log(`✅ Loaded ${materials.length} total, displaying ${this.materials.length} ASM2 materials`);
        
        // Debug: Check if new data was added
        const recentMaterials = materials.filter(m => {
          const now = new Date();
          const materialTime = m.createdAt;
          const timeDiff = now.getTime() - materialTime.getTime();
          return timeDiff < 60000; // Within last minute
        });
        if (recentMaterials.length > 0) {
          console.log(`🆕 Found ${recentMaterials.length} recently added materials:`, recentMaterials.map(m => ({
            materialCode: m.materialCode,
            createdAt: m.createdAt,
            scanMethod: m.scanMethod
          })));
        }
        
        // Force change detection to update UI
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('❌ Error loading ASM1 outbound materials:', error);
        this.errorMessage = 'Lỗi khi tải dữ liệu: ' + error.message;
        this.isLoading = false;
      }
    });
  }
  
  // Load inventory materials để lấy số tồn kho chính xác
  loadInventoryMaterials(): void {
    console.log('📦 Loading ASM2 inventory materials for stock calculation with real-time listener...');
    console.log(`🔍 Query: factory == '${this.selectedFactory}', limit: 5000`);
    
    this.firestore.collection('inventory-materials', ref => 
      ref.where('factory', '==', this.selectedFactory)
         .limit(5000) // Tăng limit để lấy nhiều dữ liệu hơn
    ).snapshotChanges()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        console.log(`📦 Raw snapshot from Firebase: ${snapshot.length} documents`);
        
        // REMOVED: inventoryMaterials loading - Không cần tính stock để scan nhanh
      },
      error: (error) => {
        console.error('❌ Error loading inventory materials:', error);
        console.log('⚠️ Will use fallback calculation method');
      }
    });
  }
  

  
  updatePagination(): void {
    this.totalPages = Math.ceil(this.filteredMaterials.length / this.itemsPerPage);
    if (this.currentPage > this.totalPages) { this.currentPage = 1; }
  }
  
  getPaginatedMaterials(): OutboundMaterial[] {
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    return this.filteredMaterials.slice(startIndex, endIndex);
  }
  

  
  onExportDateChange(event: any, material: OutboundMaterial): void {
    const target = event.target as HTMLInputElement;
    if (target.value) {
      // Xử lý datetime-local input
      const [datePart, timePart] = target.value.split('T');
      if (datePart && timePart) {
        const [year, month, day] = datePart.split('-').map(Number);
        const [hour, minute] = timePart.split(':').map(Number);
        material.exportDate = new Date(year, month - 1, day, hour, minute);
      } else {
        material.exportDate = new Date(target.value);
      }
    } else {
      material.exportDate = new Date();
    }
    this.updateMaterial(material);
  }
  

  
  goToPage(page: number): void { if (page >= 1 && page <= this.totalPages) { this.currentPage = page; } }
  previousPage(): void { if (this.currentPage > 1) { this.currentPage--; } }
  nextPage(): void { if (this.currentPage < this.totalPages) { this.currentPage++; } }
  
  async addMaterial(): Promise<void> {
    const newMaterial: OutboundMaterial = {
      factory: this.selectedFactory,
      materialCode: '',
      poNumber: '',
      quantity: 0,
      unit: '',
      exportQuantity: 0,
      exportDate: new Date(),
      location: '',
      exportedBy: '',
      employeeId: '',
      productionOrder: '',
      
      scanMethod: 'MANUAL',
      notes: '',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    try {
      await this.firestore.collection('outbound-materials').add(newMaterial);
      console.log('✅ ASM2 outbound material added');
      this.loadMaterials();
    } catch (error) {
      console.error('❌ Error adding ASM2 outbound material:', error);
      this.errorMessage = 'Lỗi thêm material: ' + error.message;
    }
  }
  
  async updateMaterial(material: OutboundMaterial): Promise<void> {
    if (!material.id) return;
    try {
      material.updatedAt = new Date();
      material.factory = this.selectedFactory;
      await this.firestore.collection('outbound-materials').doc(material.id).update(material);
      console.log('✅ ASM2 outbound material updated:', material.materialCode);
    } catch (error) {
      console.error('❌ Error updating ASM2 outbound material:', error);
      this.errorMessage = 'Lỗi cập nhật: ' + error.message;
    }
  }
  
  async deleteMaterial(material: OutboundMaterial): Promise<void> {
    if (!material.id) return;
    if (!confirm(`Xóa outbound material ${material.materialCode}?`)) return;
    try {
      await this.firestore.collection('outbound-materials').doc(material.id).delete();
      console.log('✅ ASM2 outbound material deleted:', material.materialCode);
      this.loadMaterials();
    } catch (error) {
      console.error('❌ Error deleting ASM1 outbound material:', error);
      this.errorMessage = 'Lỗi xóa: ' + error.message;
    }
  }
  
  // Export tất cả dữ liệu (không giới hạn 50 dòng)
  async exportToExcel(): Promise<void> {
    try {
      console.log('📊 Exporting TẤT CẢ ASM2 outbound data to Excel...');
      
      // Load tất cả dữ liệu từ Firebase
      const snapshot = await this.firestore.collection('outbound-materials', ref => 
        ref.where('factory', '==', this.selectedFactory)
      ).ref.get();
      
      const allMaterials = snapshot.docs.map(doc => {
        const data = doc.data() as any;
        return {
          id: doc.id,
          factory: data.factory || this.selectedFactory,
          materialCode: data.materialCode || '',
          poNumber: data.poNumber || '',
          quantity: data.quantity || 0,
          unit: data.unit || '',
          exportQuantity: data.exportQuantity || 0,
          exportDate: data.exportDate?.toDate() || new Date(),
          location: data.location || '',
          exportedBy: data.exportedBy || '',
          employeeId: data.employeeId || '',
          productionOrder: data.productionOrder || '',
          batchNumber: data.batchNumber || data.importDate || null,
          importDate: data.importDate || null,
          scanMethod: data.scanMethod || 'MANUAL',
          notes: data.notes || '',
          createdAt: data.createdAt?.toDate() || data.createdDate?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || data.lastUpdated?.toDate() || new Date()
        } as OutboundMaterial;
      });
      
      // Sort by createdAt desc để có dữ liệu mới nhất trước
      const sortedMaterials = allMaterials.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      
      console.log(`📊 Exporting ${sortedMaterials.length} records (tất cả dữ liệu)`);
      
             // Optimize data for smaller file size
      const exportData = sortedMaterials.map(material => ({
          'Factory': material.factory || this.selectedFactory,
          'Material': material.materialCode || '',
          'PO': material.poNumber || '',
          'Qty': material.quantity || 0,
          'Unit': material.unit || '',
          'Export Qty': material.exportQuantity || 0,
          'Ngày xuất': material.exportDate ? material.exportDate.toLocaleString('vi-VN') : '',
          'Employee ID': material.employeeId || '',
          'Production Order': material.productionOrder || '',
          'Method': material.scanMethod || 'MANUAL'
        }));
      
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      
                     // Set column widths for better readability
        const colWidths = [
          { wch: 8 },   // Factory
          { wch: 15 },  // Material
          { wch: 12 },  // PO
          { wch: 8 },   // Qty
          { wch: 6 },   // Unit
          { wch: 10 },  // Export Qty
          { wch: 18 },  // Ngày xuất
          { wch: 12 },  // Employee ID
          { wch: 18 },  // Production Order
          { wch: 8 }    // Method
        ];
      worksheet['!cols'] = colWidths;
      
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'ASM2_Outbound');
      
      const fileName = `ASM2_Outbound_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      
      console.log('✅ ASM2 outbound data exported to Excel');
      alert(`✅ Đã xuất ${exportData.length} records ra file Excel`);
    } catch (error) {
      console.error('❌ Export error:', error);
      this.errorMessage = 'Lỗi export: ' + error.message;
      alert('❌ Lỗi export: ' + error.message);
    }
  }

  // 🗑️ REMOVED: downloadReport() - đã gộp vào downloadMonthlyHistory()

  // Download monthly history - Tải lịch sử outbound theo tháng
  async downloadMonthlyHistory(): Promise<void> {
    try {
      // Hiện popup chọn tháng
      const monthYear = prompt(
        'Chọn tháng để tải lịch sử outbound:\n' +
        'Nhập theo định dạng YYYY-MM (ví dụ: 2024-12)',
        new Date().toISOString().slice(0, 7) // Mặc định tháng hiện tại
      );
      
      if (!monthYear) return;
      
      // Validate format YYYY-MM
      if (!/^\d{4}-\d{2}$/.test(monthYear)) {
        alert('❌ Định dạng không đúng! Vui lòng nhập theo định dạng YYYY-MM (ví dụ: 2024-12)');
        return;
      }
      
      const [year, month] = monthYear.split('-');
      const startDate = new Date(parseInt(year), parseInt(month) - 1, 1); // Ngày đầu tháng
      const endDate = new Date(parseInt(year), parseInt(month), 0); // Ngày cuối tháng
      
      console.log('📅 Downloading monthly history for:', monthYear, 'from', startDate, 'to', endDate);
      
      // 🔧 SỬA LỖI INDEX: Chỉ query factory, filter date ở client để tránh composite index
      const querySnapshot = await this.firestore.collection('outbound-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
           .limit(10000) // Lấy nhiều data để filter client-side
      ).get().toPromise();
      
      if (!querySnapshot || querySnapshot.empty) {
        alert(`📭 Không có dữ liệu outbound ASM2`);
        return;
      }
      
      // Filter theo date range ở client-side
      const filteredDocs = querySnapshot.docs.filter(doc => {
        const data = doc.data() as any;
        const exportDate = data.exportDate?.toDate();
        if (!exportDate) return false;
        return exportDate >= startDate && exportDate <= endDate;
      });
      
      if (filteredDocs.length === 0) {
        alert(`📭 Không có dữ liệu outbound ASM2 trong tháng ${monthYear}`);
        return;
      }
      
      console.log(`✅ Found ${filteredDocs.length} records for ${monthYear}`);
      
      // Chuyển đổi dữ liệu và sort ở client-side
      const exportData = filteredDocs
        .map(doc => {
          const data = doc.data() as any;
          return {
            data,
            exportDate: data.exportDate?.toDate() || new Date(0)
          };
        })
        .sort((a, b) => b.exportDate.getTime() - a.exportDate.getTime()) // Sort desc
        .map(item => {
        const data = item.data;
        return {
          'Factory': data.factory || this.selectedFactory,
          'Material Code': data.materialCode || '',
          'PO Number': data.poNumber || '',
          'Batch': data.importDate || 'N/A',
          'Export Quantity': data.exportQuantity || 0,
          'Unit': data.unit || '',
          'Export Date': data.exportDate?.toDate().toLocaleDateString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }) || '',
          'Employee ID': data.employeeId || '',
          'Production Order': data.productionOrder || '',
          'Scan Method': data.scanMethod || 'MANUAL',
          'Notes': data.notes || ''
        };
      });
      
      // Tạo file Excel
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      
      // Set column widths
      const colWidths = [
        { wch: 8 },   // Factory
        { wch: 15 },  // Material Code
        { wch: 15 },  // PO Number
        { wch: 12 },  // Batch
        { wch: 12 },  // Export Quantity
        { wch: 8 },   // Unit
        { wch: 20 },  // Export Date
        { wch: 12 },  // Employee ID
        { wch: 20 },  // Production Order
        { wch: 12 },  // Scan Method
        { wch: 20 }   // Notes
      ];
      worksheet['!cols'] = colWidths;
      
      // Tạo workbook và export
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Monthly_History');
      
      const fileName = `ASM2_Outbound_History_${monthYear}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      
      console.log(`✅ Monthly history exported: ${fileName}`);
      alert(`✅ Đã tải lịch sử outbound tháng ${monthYear}!\n\n` +
            `📁 File: ${fileName}\n` +
            `📊 Số lượng records: ${exportData.length}\n` +
            `📅 Từ: ${startDate.toLocaleDateString('vi-VN')} đến ${endDate.toLocaleDateString('vi-VN')}`);
      
    } catch (error) {
      console.error('❌ Error downloading monthly history:', error);
      alert('❌ Lỗi tải lịch sử theo tháng: ' + error.message);
    }
  }
  
  // Cleanup old data (move to archive or delete)
  async cleanupData(): Promise<void> {
    try {
      const confirmCleanup = confirm(
        '⚠️ CẢNH BÁO: Thao tác này sẽ xóa dữ liệu cũ trên Firebase!\n\n' +
        'Dữ liệu sẽ được tải về trước khi xóa.\n' +
        'Bạn có chắc chắn muốn tiếp tục?'
      );
      
      if (!confirmCleanup) return;
      
      // Get cutoff date (e.g., 30 days ago)
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);
      
      console.log('🧹 Starting data cleanup, cutoff date:', cutoffDate);
      
      // Get old data for backup
      const oldDataQuery = await this.firestore.collection('outbound-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
           .where('exportDate', '<', cutoffDate)
      ).get().toPromise();
      
      if (!oldDataQuery || oldDataQuery.empty) {
        alert('Không có dữ liệu cũ để dọn dẹp');
        return;
      }
      
             // Backup old data to Excel
       const oldData = oldDataQuery.docs.map(doc => {
         const data = doc.data() as any;
         return {
           'ID': doc.id,
           'Factory': data.factory,
           'Material Code': data.materialCode,
           'PO Number': data.poNumber,
           'Quantity': data.quantity,
           'Unit': data.unit,
           'Export Quantity': data.exportQuantity,
           'Export Date': data.exportDate?.toDate().toLocaleDateString('vi-VN') || '',
           'Exported By': data.exportedBy,
           'Employee ID': data.employeeId || '',
           'Production Order': data.productionOrder || '',
           'Scan Method': data.scanMethod,
           'Notes': data.notes
         };
       });
      
      // Save backup
      const worksheet = XLSX.utils.json_to_sheet(oldData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Old_Data_Backup');
      const backupFileName = `ASM2_Outbound_Backup_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, backupFileName);
      
      console.log(`✅ Backup saved: ${backupFileName}`);
      
      // Delete old data
      const deletePromises = oldDataQuery.docs.map(doc => doc.ref.delete());
      await Promise.all(deletePromises);
      
      console.log(`✅ Deleted ${oldDataQuery.docs.length} old records`);
      
      // Reload data
      this.loadMaterials();
      
      alert(`✅ Dọn dẹp hoàn tất!\n\n` +
            `📁 Backup: ${backupFileName}\n` +
            `🗑️ Đã xóa: ${oldDataQuery.docs.length} records cũ\n` +
            `📅 Dữ liệu trước: ${cutoffDate.toLocaleDateString('vi-VN')}`);
      
    } catch (error) {
      console.error('❌ Error during data cleanup:', error);
      alert('Lỗi dọn dẹp dữ liệu: ' + error.message);
    }
  }
  
  formatDate(date: Date | null): string { if (!date) return ''; return date.toLocaleDateString('vi-VN'); }
  formatDateTime(date: Date | null): string { if (!date) return ''; return date.toLocaleString('vi-VN'); }
  
  // Camera QR Scanner methods using QRScannerModalComponent (same as RM1 inventory)
  startCameraScanning(): void {
    console.log('🎯 Starting QR scanner for Outbound ASM2...');
    console.log('📱 Mobile device:', this.isMobile);
    console.log('📱 Selected scan method:', this.selectedScanMethod);
    console.log('📱 Current scan step:', this.currentScanStep);
    
    // 🔧 SỬA LỖI: Khởi tạo batch mode nếu chưa có
    if (!this.isBatchScanningMode) {
      console.log('📱 Initializing batch scanning mode for camera');
      this.isBatchScanningMode = true;
      this.currentScanStep = 'batch';
      this.batchProductionOrder = '';
      this.batchEmployeeId = '';
      this.isProductionOrderScanned = false;
      this.isEmployeeIdScanned = false;
    }
    
    let title = 'Quét QR Code';
    let message = 'Camera sẽ tự động quét QR code';
    
    if (this.currentScanStep === 'batch') {
      if (!this.isProductionOrderScanned) {
        title = 'Quét LSX (Lệnh Sản Xuất)';
        message = 'Quét mã LSX để bắt đầu xuất kho';
      } else if (!this.isEmployeeIdScanned) {
        title = 'Quét Mã Nhân Viên';
        message = 'Quét mã nhân viên (ASP + 4 số)';
      } else {
        // Both LSX and Employee ID scanned, ready for material
        title = 'Quét Mã Hàng Hóa';
        message = 'Quét QR code của hàng hóa để xuất kho';
        this.currentScanStep = 'material';
      }
    } else if (this.currentScanStep === 'material') {
      title = 'Quét Mã Hàng Hóa';
      message = 'Quét QR code của hàng hóa để xuất kho (camera sẽ tiếp tục mở để quét thêm)';
    }
    
    const dialogData: QRScannerData = {
      title: title,
      message: message,
      materialCode: undefined
    };

    const dialogRef = this.dialog.open(QRScannerModalComponent, {
      width: '500px',
      maxWidth: '95vw',
      data: dialogData,
      disableClose: true, // Prevent accidental close
      panelClass: 'qr-scanner-dialog'
    });

    dialogRef.afterClosed().subscribe(result => {
      console.log('📱 QR Scanner result:', result);
      
      if (result && result.success && result.text) {
        // Process the scanned data using SAME LOGIC as scanner
        this.processCameraScanResult(result.text);
        
        // Debug: Check current state after processing
        console.log('📱 After processing scan:');
        console.log('📱 - isProductionOrderScanned:', this.isProductionOrderScanned);
        console.log('📱 - isEmployeeIdScanned:', this.isEmployeeIdScanned);
        console.log('📱 - currentScanStep:', this.currentScanStep);
        console.log('📱 - batchProductionOrder:', this.batchProductionOrder);
        console.log('📱 - batchEmployeeId:', this.batchEmployeeId);
        
        // Update UI after processing
        this.cdr.detectChanges();
        
        // Only reopen camera if we're still in batch scanning mode and not ready to process
        if (this.isBatchScanningMode && (!this.isProductionOrderScanned || !this.isEmployeeIdScanned)) {
          console.log('📱 Still need to scan LSX/Employee - reopening camera...');
          setTimeout(() => {
            this.startCameraScanning();
          }, 1000);
        } else if (this.isBatchScanningMode && this.isProductionOrderScanned && this.isEmployeeIdScanned) {
          // After scanning material, continue camera for more materials
          console.log('📱 Material scanned - continuing camera for more materials...');
          setTimeout(() => {
            this.startCameraScanning();
          }, 1000);
        } else {
          console.log('📱 Batch scanning completed or stopped');
        }
      } else if (result && result.error) {
        console.error('❌ QR Scanner error:', result.error);
        this.errorMessage = 'Lỗi quét QR: ' + result.error;
        
        // Reopen camera even after error for continuous scanning
        if (this.isBatchScanningMode) {
          console.log('📱 Reopening camera after error...');
          setTimeout(() => {
            this.startCameraScanning();
          }, 1000);
        }
        } else {
        console.log('📱 QR Scanner cancelled or closed by user');
        // Don't reset data when camera is closed, just stop camera scanning
        // User can still use Review and Save buttons
        console.log('📱 Camera scanning stopped - data preserved for processing');
      }
    });
  }
  
  // Stop camera scanning (for continuous mode)
  stopCameraScanning(): void {
    console.log('📱 Stopping camera scanning...');
    // Don't reset data, just stop the camera
    // User can still use Done button to process pending data
    console.log('📱 Camera scanning stopped - data preserved for processing');
  }
  
  // Reset all scanning data (when user wants to start fresh)
  resetScanningData(): void {
    console.log('🔄 Resetting all scanning data...');
    this.isBatchScanningMode = false;
    this.isProductionOrderScanned = false;
    this.isEmployeeIdScanned = false;
    this.batchProductionOrder = '';
    this.batchEmployeeId = '';
    this.pendingScanData = [];
    this.currentScanStep = 'batch';
    this.errorMessage = '';
    console.log('✅ All scanning data reset');
  }
  
  // Debug method to check current state
  debugCurrentState(): void {
    console.log('🔍 === DEBUG CURRENT STATE ===');
    console.log('🔍 isBatchScanningMode:', this.isBatchScanningMode);
    console.log('🔍 isProductionOrderScanned:', this.isProductionOrderScanned);
    console.log('🔍 isEmployeeIdScanned:', this.isEmployeeIdScanned);
    console.log('🔍 batchProductionOrder:', this.batchProductionOrder);
    console.log('🔍 batchEmployeeId:', this.batchEmployeeId);
    console.log('🔍 currentScanStep:', this.currentScanStep);
    console.log('🔍 pendingScanData.length:', this.pendingScanData.length);
    console.log('🔍 pendingScanData:', this.pendingScanData);
    console.log('🔍 selectedScanMethod:', this.selectedScanMethod);
    console.log('🔍 isMobile:', this.isMobile);
    console.log('🔍 === END DEBUG STATE ===');
  }
  
  // Start camera scanning for materials (after LSX and Employee ID are scanned)
  startMaterialCameraScanning(): void {
    console.log('📱 Starting material camera scanning...');
    if (!this.isProductionOrderScanned || !this.isEmployeeIdScanned) {
      this.errorMessage = 'Phải scan LSX và mã nhân viên trước!';
      return;
    }
    
    this.currentScanStep = 'material';
    this.startCameraScanning();
  }
  
  // Save scanned data to outbound
  saveScannedData(): void {
    console.log('💾 Saving scanned data to outbound...');
    if (this.pendingScanData.length === 0) {
      this.errorMessage = 'Không có dữ liệu để lưu!';
      return;
    }
    
    // Use the same logic as stopBatchScanningMode but without stopping batch mode
    this.processPendingScanData();
  }
  
  // Process pending scan data (extracted from stopBatchScanningMode)
  private async processPendingScanData(): Promise<void> {
    if (this.pendingScanData.length === 0) {
      console.log('📦 No pending data to process');
      return;
    }
    
    try {
      console.log(`📦 Processing ${this.pendingScanData.length} pending items...`);
      
      // Show loading
      this.isLoading = true;
      this.errorMessage = `Đang xử lý ${this.pendingScanData.length} mã hàng...`;
      
      // Process each scanned item by creating outbound records
      const batch = this.firestore.firestore.batch();
      const outboundCollection = this.firestore.collection('outbound-materials');
      
      for (const scanItem of this.pendingScanData) {
        const outboundData: OutboundMaterial = {
          factory: this.selectedFactory,
          materialCode: scanItem.materialCode,
          poNumber: scanItem.poNumber,
          quantity: scanItem.quantity,
          unit: 'PCS',
          exportQuantity: scanItem.quantity,
          exportDate: new Date(),
          location: scanItem.location,
          exportedBy: scanItem.employeeId,
          batch: scanItem.importDate,
          batchNumber: scanItem.importDate,
          scanMethod: 'CAMERA', // 🔧 CAMERA ONLY: Đánh dấu rõ ràng là camera
          notes: `Auto-scanned export - ${scanItem.scanTime.toISOString()}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          productionOrder: scanItem.productionOrder,
          employeeId: scanItem.employeeId,
          importDate: scanItem.importDate
        };
        
        const docRef = outboundCollection.ref.doc();
        batch.set(docRef, outboundData);
      }
      
      // Commit batch
      await batch.commit();
      console.log(`✅ Successfully saved ${this.pendingScanData.length} items to outbound-materials collection`);
      
      // 🔧 UNIFIED: Cập nhật inventory exported quantity cho từng item (TUẦN TỰ)
      console.log('📦 Updating inventory exported quantities sequentially...');
      for (let i = 0; i < this.pendingScanData.length; i++) {
        const scanItem = this.pendingScanData[i];
        try {
          console.log(`📦 Processing item ${i + 1}/${this.pendingScanData.length}: ${scanItem.materialCode}`);
          await this.unifiedUpdateInventory(
            scanItem.materialCode,
            scanItem.poNumber,
            scanItem.quantity,
            scanItem.importDate,
            'BATCH_SCANNER'
          );
          console.log(`✅ Updated inventory for ${scanItem.materialCode} - PO: ${scanItem.poNumber} - Qty: ${scanItem.quantity}`);
          
          // 🔧 SYNC FIX: Thêm delay giữa các lần update để tránh race condition
          if (i < this.pendingScanData.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        } catch (error) {
          console.error(`❌ Error updating inventory for ${scanItem.materialCode}:`, error);
        }
      }
      console.log('✅ All inventory exported quantities updated');
      
      // Clear pending data
      const processedCount = this.pendingScanData.length;
      this.pendingScanData = [];
      this.savePendingToStorage();
      
      // Success message
      this.errorMessage = `✅ Đã lưu ${processedCount} mã hàng vào outbound và cập nhật inventory!`;
      
      // 🔧 CAMERA SYNC FIX: Không gọi loadMaterials() ở đây để tránh race condition
      console.log('✅ Camera batch processing completed - inventory will be refreshed by stopBatchScanningMode()');
      
    } catch (error) {
      console.error('❌ Error processing pending data:', error);
      this.errorMessage = 'Lỗi xử lý dữ liệu: ' + error.message;
    } finally {
      this.isLoading = false;
    }
  }
  
  private async waitForElement(elementId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 20; // 2 seconds max wait
      
      console.log('🔍 Waiting for element:', elementId);
      
      const checkElement = () => {
        const element = document.getElementById(elementId);
        console.log(`🔍 Attempt ${attempts + 1}: Looking for element "${elementId}", found:`, !!element);
        
        if (element) {
          console.log('✅ Found element:', elementId);
          resolve();
        } else if (attempts >= maxAttempts) {
          console.error('❌ Element not found after max attempts:', elementId);
          reject(new Error(`Element with id="${elementId}" not found after ${maxAttempts} attempts`));
        } else {
          attempts++;
          setTimeout(checkElement, 100); // Check every 100ms
        }
      };
      
      // Start checking immediately
      checkElement();
    });
  }
  
  async stopScanning(): Promise<void> {
    // Stop QRScannerService
    this.qrScannerService.stopScanning();
    
    // Also stop Html5Qrcode if it exists
    if (this.scanner) {
      try {
        await this.scanner.stop();
        console.log('✅ Html5Qrcode scanner stopped');
      } catch (error) {
        console.error('❌ Error stopping Html5Qrcode scanner:', error);
      }
      this.scanner = null;
    }
    
    // Reset all scanner states
    this.isCameraScanning = false;
    this.isScannerLoading = false;
    this.isScannerInputActive = false;
    this.lastScannedData = null;
    this.exportQuantity = 0;
    this.scannerBuffer = '';
    
    console.log('✅ All scanner states reset');
  }
  
  private onScanSuccess(decodedText: string): void {
    console.log('🔍 === ON SCAN SUCCESS START ===');
    console.log('🔍 Input decodedText:', decodedText);
    console.log('🔍 Input type:', typeof decodedText);
    console.log('🔍 Input length:', decodedText.length);
    console.log('🔍 Current scan step:', this.currentScanStep);
    console.log('🔍 Batch scanning mode:', this.isBatchScanningMode);
    console.log('🔍 Batch state:', {
      isProductionOrderScanned: this.isProductionOrderScanned,
      isEmployeeIdScanned: this.isEmployeeIdScanned,
      batchProductionOrder: this.batchProductionOrder,
      batchEmployeeId: this.batchEmployeeId
    });
    
    // Check if we're in batch mode
    if (this.isBatchScanningMode) {
      // Check if both LSX and Employee ID are already scanned
      if (this.isProductionOrderScanned && this.isEmployeeIdScanned) {
        console.log('🔍 Both LSX and Employee ID scanned, processing material scan');
        // Process as material scan via queue
        this.enqueueMaterialScan(decodedText);
        return;
      } else {
        console.log('🔍 Processing batch scan input for LSX/Employee ID');
        this.processBatchScanInput(decodedText);
        return;
      }
    }
    
    try {
      console.log('🔍 Processing scanned QR data:', decodedText);
      
      // Đơn giản: Parse QR data format "MaterialCode|PONumber|Quantity|BatchNumber"
      // Xử lý dấu cách và format không đúng
      let cleanText = decodedText.trim();
      
      // Loại bỏ dấu cách trước dấu |
      cleanText = cleanText.replace(/\s*\|\s*/g, '|');
      
      const parts = cleanText.split('|');
      if (parts.length >= 3) {
        this.lastScannedData = {
          materialCode: parts[0].trim(),
          poNumber: parts[1].trim(),
          quantity: parseInt(parts[2]) || 0,
          importDate: parts.length >= 4 ? parts[3].trim() : null // Bây giờ là batch number: 26082025
        };
        
        console.log('🔍 Original text:', decodedText);
        console.log('🔍 Cleaned text:', cleanText);
        console.log('🔍 Parsed data:', this.lastScannedData);
        
        // Set default export quantity to full quantity
        this.exportQuantity = this.lastScannedData.quantity;
        
      } else if (decodedText.includes(',')) {
        // Try comma-separated format: "MaterialCode,PONumber,Quantity"
        const commaParts = decodedText.split(',');
        if (commaParts.length >= 3) {
          this.lastScannedData = {
            materialCode: commaParts[0].trim(),
            poNumber: commaParts[1].trim(),
            quantity: parseInt(commaParts[1]) || 0
          };
          
          console.log('✅ Parsed QR data (comma format):', this.lastScannedData);
          this.exportQuantity = this.lastScannedData.quantity;
        } else {
          throw new Error('Invalid comma format');
        }
      } else {
        // Try JSON format as fallback
        try {
          const jsonData = JSON.parse(decodedText);
          if (jsonData.materialCode && jsonData.poNumber) {
            this.lastScannedData = {
              materialCode: jsonData.materialCode.toString().trim(),
              poNumber: jsonData.poNumber.toString().trim(),
              quantity: parseInt(jsonData.quantity) || parseInt(jsonData.unitNumber) || 0
            };
            
            console.log('✅ Parsed QR data (JSON format):', this.lastScannedData);
            this.exportQuantity = this.lastScannedData.quantity;
          } else {
            throw new Error('Missing required fields in JSON');
          }
        } catch (jsonError) {
          // If all parsing methods fail, try to extract any recognizable pattern
          console.log('🔍 Trying pattern extraction from:', decodedText);
          
          // Look for common patterns like "B018694" (material code)
          const materialCodeMatch = decodedText.match(/[A-Z]\d{6,}/);
          const poMatch = decodedText.match(/PO\d+|P\d+/i);
          const numberMatch = decodedText.match(/\d+/);
          
          if (materialCodeMatch && poMatch && numberMatch) {
            this.lastScannedData = {
              materialCode: materialCodeMatch[0],
              poNumber: poMatch[0],
              quantity: parseInt(numberMatch[0]) || 0
            };
            
            console.log('✅ Parsed QR data (pattern extraction):', this.lastScannedData);
            this.exportQuantity = this.lastScannedData.quantity;
          } else {
            throw new Error('Could not extract material information from QR code');
          }
        }
      }
      
      // Validate parsed data
      if (!this.lastScannedData.materialCode || !this.lastScannedData.poNumber || this.lastScannedData.quantity <= 0) {
        throw new Error('Invalid material data: missing code, PO, or quantity');
      }
      
      console.log('✅ Final parsed data:', this.lastScannedData);
      console.log('✅ Export quantity set to:', this.exportQuantity);
      
      // 🔧 SEPARATE LOGIC: Scanner auto-export, Camera chỉ thêm vào pending
      if (this.selectedScanMethod === 'scanner') {
        console.log('📱 SCANNER: Auto-exporting immediately...');
      this.autoExportScannedMaterial();
      } else if (this.selectedScanMethod === 'camera') {
        console.log('📱 CAMERA: Adding to pending data for batch processing...');
        // Camera chỉ parse và thêm vào pendingScanData, không auto-export
        // Sẽ được xử lý khi user bấm "Done" hoặc "Save"
      } else {
        console.log('📱 UNKNOWN METHOD: Defaulting to camera behavior...');
        // Default behavior - thêm vào pending data
      }
      
    } catch (error) {
      console.error('❌ Error parsing QR data:', error);
      console.error('❌ Raw QR data was:', decodedText);
      alert(`QR code không hợp lệ: ${error.message}\n\nDữ liệu quét được: ${decodedText}\n\nVui lòng quét QR code từ hệ thống hoặc kiểm tra format.`);
    }
    
    console.log('🔍 === ON SCAN SUCCESS END ===');
    console.log('🔍 Final pending data count:', this.pendingScanData.length);
    console.log('🔍 Final batch state:', {
      isProductionOrderScanned: this.isProductionOrderScanned,
      isEmployeeIdScanned: this.isEmployeeIdScanned,
      batchProductionOrder: this.batchProductionOrder,
      batchEmployeeId: this.batchEmployeeId
    });
  }

  onScanError(error: any): void {
    console.error('❌ QR scan error:', error);
    // Don't show error to user for scanning attempts - they're too frequent
  }

  // 🔧 CAMERA ONLY: Process camera scan result - chỉ thêm vào pending data
  processCameraScanResult(scannedText: string): void {
    console.log('📱 === CAMERA SCAN RESULT START ===');
    console.log('📱 Scanned text:', scannedText);
    console.log('📱 Text length:', scannedText.length);
    console.log('📱 Current scan step:', this.currentScanStep);
    console.log('📱 Batch scanning mode:', this.isBatchScanningMode);
    console.log('📱 LSX scanned:', this.isProductionOrderScanned);
    console.log('📱 Employee scanned:', this.isEmployeeIdScanned);
    console.log('📱 Pending data count:', this.pendingScanData.length);
    
    if (!this.isBatchScanningMode) {
      // If not in batch mode, start batch mode first (but don't reset existing data)
      console.log('📱 Starting batch mode for camera scan');
      this.isBatchScanningMode = true;
      this.currentScanStep = 'batch';
      // DON'T reset isProductionOrderScanned, isEmployeeIdScanned, batchProductionOrder, batchEmployeeId
    }
    
    // 🔧 SỬA LỖI: Xử lý đúng thứ tự - LSX → Employee ID → Material
    if (!this.isProductionOrderScanned) {
      // Scan LSX first
      console.log('📱 CAMERA: Processing LSX scan');
      this.onLSXScanned(scannedText);
    } else if (!this.isEmployeeIdScanned) {
      // Scan Employee ID second
      console.log('📱 CAMERA: Processing Employee ID scan');
      this.onEmployeeScanned(scannedText);
    } else {
      // Both LSX and Employee ID scanned - now scan materials
      console.log('📱 CAMERA: Processing material scan');
      this.enqueueMaterialScan(scannedText);
    }
    
    console.log('📱 === CAMERA SCAN RESULT END ===');
    console.log('📱 After processing - Pending data count:', this.pendingScanData.length);
  }

  
  // Consolidate outbound records by ALL 4 fields: material code + PO + employee ID + production order (LSX)
  private consolidateOutboundRecords(materials: OutboundMaterial[]): OutboundMaterial[] {
    const consolidatedMap = new Map<string, OutboundMaterial>();
    
    materials.forEach(material => {
      // Create key: materialCode + poNumber + employeeId + productionOrder
      // Chỉ gộp khi CẢ 4 thông tin giống hệt nhau
      const key = `${material.materialCode}_${material.poNumber}_${material.employeeId || 'NO_EMPLOYEE'}_${material.productionOrder || 'NO_LSX'}`;
      
      if (consolidatedMap.has(key)) {
        // Merge with existing record - chỉ khi 4 thông tin giống hệt
        const existing = consolidatedMap.get(key)!;
        existing.exportQuantity += material.exportQuantity;
        existing.quantity = Math.max(existing.quantity, material.quantity); // Keep max quantity
        existing.updatedAt = new Date(Math.max(existing.updatedAt.getTime(), material.updatedAt.getTime()));
        existing.createdAt = new Date(Math.min(existing.createdAt.getTime(), material.createdAt.getTime())); // Keep earliest creation
        
        // Ghi chú về việc gộp
        const oldQuantity = existing.exportQuantity - material.exportQuantity;
        existing.notes = `Gộp từ ${oldQuantity} + ${material.exportQuantity} = ${existing.exportQuantity} - ${material.notes || 'Auto-scanned export'}`;
        
        console.log(`🔄 Merged outbound record: ${material.materialCode} - PO: ${material.poNumber} - Employee: ${material.employeeId} - LSX: ${material.productionOrder}`);
        
      } else {
        // New record - tạo dòng mới khi có bất kỳ thông tin nào khác nhau
        consolidatedMap.set(key, { ...material });
        console.log(`➕ New outbound record: ${material.materialCode} - PO: ${material.poNumber} - Employee: ${material.employeeId} - LSX: ${material.productionOrder}`);
      }
    });
    
    console.log(`🔄 Consolidated ${materials.length} records into ${consolidatedMap.size} unique entries`);
    console.log(`📊 Consolidation rule: Only merge when ALL 4 fields match (Material + PO + Employee + LSX)`);
    
    return Array.from(consolidatedMap.values());
  }

  // Create new outbound record
  private async createNewOutboundRecord(exportedBy: string): Promise<void> {
    const outboundRecord: OutboundMaterial = {
      factory: this.selectedFactory,
      materialCode: this.lastScannedData.materialCode,
      poNumber: this.lastScannedData.poNumber,
      quantity: this.lastScannedData.quantity,
      unit: 'KG', // Default unit
      exportQuantity: this.exportQuantity,
      exportDate: new Date(),
      location: '',
      exportedBy: this.batchEmployeeId || exportedBy,
      employeeId: this.batchEmployeeId || exportedBy,
      productionOrder: this.batchProductionOrder || '',
      batchNumber: this.lastScannedData.importDate || null, // Lưu batch number từ QR code (ví dụ: 26082025)
      scanMethod: 'SCANNER', // 🔧 SCANNER ONLY: Đánh dấu rõ ràng là scanner
      notes: `Auto-scanned export - Original: ${this.lastScannedData.quantity}, Exported: ${this.exportQuantity}`,
      importDate: this.lastScannedData.importDate || null, // Lưu batch number từ QR code (ví dụ: 26082025)
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    console.log('🔍 Saving outbound record with importDate:', outboundRecord.importDate);
    
    console.log('📝 Creating new outbound record:', outboundRecord);
    console.log('📅 Import date in outbound record:', outboundRecord.importDate);
    console.log('📅 Import date type in outbound record:', typeof outboundRecord.importDate);
    
    // Add to outbound collection
    console.log('🔥 Adding to Firebase collection: outbound-materials');
    const docRef = await this.firestore.collection('outbound-materials').add(outboundRecord);
    console.log('✅ New outbound record created with ID:', docRef.id);
    
    // Verify data was saved correctly
    const savedDoc = await docRef.get();
    const savedData = savedDoc.data() as any;
    console.log('📅 Saved importDate in database:', savedData?.importDate);
    console.log('📅 Saved importDate type in database:', typeof savedData?.importDate);
  }

  // 🔧 SCANNER ONLY: Auto-export method that runs immediately after scanner scan
  private async autoExportScannedMaterial(): Promise<void> {
    if (!this.lastScannedData || !this.exportQuantity || this.exportQuantity <= 0) {
      console.log('❌ Scanner auto-export validation failed:', { lastScannedData: this.lastScannedData, exportQuantity: this.exportQuantity });
      return;
    }
    
    try {
      console.log('🚀 SCANNER: Auto-exporting scanned material...');
      console.log('📊 Scanned data:', this.lastScannedData);
      console.log('📊 Export quantity:', this.exportQuantity);
      
      // Get current user
      const user = await this.afAuth.currentUser;
      const exportedBy = user ? (user.email || user.uid) : 'SCANNER_USER';
      console.log('👤 Current user:', exportedBy);
      
      // 🔧 SCANNER LOGIC: Tạo record mới cho mỗi lần scan
      console.log('➕ SCANNER: Creating new record for each scan');
          await this.createNewOutboundRecord(exportedBy);
      
      // 🔧 UNIFIED: Cập nhật cột "đã xuất" trong inventory
      console.log('📦 Updating inventory exported quantity...');
      console.log(`🔍 Parameters: Material=${this.lastScannedData.materialCode}, PO=${this.lastScannedData.poNumber}, Qty=${this.exportQuantity}, Batch=${this.lastScannedData.importDate}`);
      await this.unifiedUpdateInventory(
        this.lastScannedData.materialCode, 
        this.lastScannedData.poNumber, 
        this.exportQuantity,
        this.lastScannedData.importDate,
        'AUTO_EXPORT' // Truyền batch number từ QR code (ví dụ: 26082025)
      );
      console.log('✅ Inventory exported quantity updated successfully');
      
      // Store data for success message
      const successData = {
        materialCode: this.lastScannedData.materialCode,
        exportQuantity: this.exportQuantity,
        unit: 'KG' // Default unit
      };
      
      // Reset scanner state
      this.lastScannedData = null;
      this.exportQuantity = 0;
      
      // Reload data with delay to ensure outbound data is committed
      console.log('🔄 Reloading materials data...');
      setTimeout(async () => {
        await this.loadMaterials();
        console.log('✅ Materials data reloaded');
      }, 2000); // 2 second delay to ensure inventory is updated properly
      
      // Success - no popup needed for normal export
      console.log(`✅ Auto-export completed: ${successData.exportQuantity} ${successData.unit} của ${successData.materialCode}`);
      
    } catch (error) {
      console.error('❌ Error in auto-export:', error);
      console.error('❌ Error details:', {
        message: error.message,
        stack: error.stack,
        lastScannedData: this.lastScannedData,
        exportQuantity: this.exportQuantity
      });
      // Bỏ alert - chỉ log console để scan liên tục
      console.error('❌ Lỗi tự động xuất:', error.message);
    }
  }
  
  // REMOVED: updateInventoryStock() - Không cần tính stock để scan nhanh
  
  // Physical Scanner methods
  activatePhysicalScanner(): void {
    console.log('🔌 Activating physical scanner input...');
    this.isScannerInputActive = !this.isScannerInputActive;
    
    if (this.isScannerInputActive) {
      this.scannerBuffer = '';
      this.focusScannerInput();
      console.log('✅ Physical scanner activated - Ready to receive input');
    } else {
      console.log('⏹️ Physical scanner deactivated');
    }
  }

  // 🔧 SỬA LỖI: Scan đơn giản - 1 lần bấm là scan và ghi luôn
  startBatchScanningMode(): void {
    console.log('🚀 Starting professional scanning setup...');
    
    // Reset tất cả trạng thái
    this.batchProductionOrder = '';
    this.batchEmployeeId = '';
    this.isProductionOrderScanned = false;
    this.isEmployeeIdScanned = false;
    this.isWaitingForMaterial = false;
    this.currentScanStep = 'batch';
    this.pendingScanData = [];
    
    // Show professional scanning setup modal
    this.showScanningSetupModal = true;
    this.scanningSetupStep = 'lsx';
    
    // 🔧 TỰ ĐỘNG FOCUS: Tự động focus vào scanner input để có thể scan ngay
    this.isScannerInputActive = true; // Enable scanner input
    setTimeout(() => {
    this.focusScannerInput();
    }, 500);
    
    console.log('✅ Professional scanning setup modal opened - Auto-focused for scanning');
  }

  async stopBatchScanningMode(): Promise<void> {
    console.log('🛑 Processing Done - Batch updating all scanned items...');
    console.log('📊 Current state:', {
      pendingScanDataLength: this.pendingScanData.length,
      isProductionOrderScanned: this.isProductionOrderScanned,
      isEmployeeIdScanned: this.isEmployeeIdScanned,
      batchProductionOrder: this.batchProductionOrder,
      batchEmployeeId: this.batchEmployeeId
    });
    
    const savedCount = this.pendingScanData.length;
    
    // 🔧 SIÊU TỐI ƯU: Batch update tất cả pending scan data
    if (savedCount > 0) {
      try {
        console.log(`📦 Batch updating ${savedCount} items...`);
        
        // Hiển thị loading và trạng thái saving
        this.isLoading = true;
        this.isSavingBatchData = true;
        this.cdr.detectChanges(); // Force UI update để hiển thị ngay
        console.log('🔄 UI updated - showing saving indicator');
        
        console.log('📦 Starting batch update...');
        await this.batchUpdateAllScanData();
        console.log('✅ Batch update completed successfully');
        
        console.log(`✅ Saved ${savedCount} items - Firebase listener will auto-sync data`);
        
      } catch (error) {
        console.error('❌ Error in batch update:', error);
        alert('Lỗi cập nhật dữ liệu: ' + error.message);
      } finally {
        console.log('🔄 Entering finally block - resetting states...');
        this.isLoading = false;
        this.isSavingBatchData = false;
        console.log('✅ Loading flags reset:', { isLoading: this.isLoading, isSavingBatchData: this.isSavingBatchData });
        
        // 🔧 SỬA LỖI: Reset trong finally block để đảm bảo luôn chạy
        console.log('🔄 Resetting all batch scanning states...');
        this.isBatchScanningMode = false;
        this.batchProductionOrder = '';
        this.batchEmployeeId = '';
        this.isProductionOrderScanned = false;
        this.isEmployeeIdScanned = false;
        this.isWaitingForMaterial = false;
        this.currentScanStep = 'batch';
        this.isScannerInputActive = false;
        this.scannerBuffer = '';
        this.pendingScanData = []; // Reset pending data
        this.savePendingToStorage();
        
        // Force UI update
        this.cdr.detectChanges();
        
        console.log('✅ Batch scanning mode completed and reset');
        console.log('📊 After reset:', {
          isBatchScanningMode: this.isBatchScanningMode,
          pendingScanDataLength: this.pendingScanData.length
        });
      }
    } else {
      console.log('⚠️ No pending scan data to save');
      alert('⚠️ Không có dữ liệu để lưu!');
      
      // Reset ngay cả khi không có data
      this.isBatchScanningMode = false;
      this.currentScanStep = 'batch';
      this.cdr.detectChanges();
    }
  }

  // 🔧 ĐƠN GIẢN HÓA: Chỉ lưu outbound records, BỎ inventory updates
  private async batchUpdateAllScanData(): Promise<void> {
    if (this.pendingScanData.length === 0) {
      console.log('⚠️ No pending data to save');
      return;
    }

    console.log(`📦 Saving ${this.pendingScanData.length} scanned items to outbound...`);
    
    const batch = this.firestore.firestore.batch();

    // 1. CỘNG DỒN - CHỈ KHI TRÙNG ĐẦY ĐỦ 6 TRƯỜNG
    // Nguyên tắc: Ngày xuất + Mã hàng + Số PO + IMD + Mã nhân viên + Lệnh sản xuất
    const consolidatedMap = new Map<string, any>();
    
    for (const scanItem of this.pendingScanData) {
      // 🔧 FIX: Key phải bao gồm ĐẦY ĐỦ các trường để tách dòng đúng
      // Ngày xuất (normalize về ngày, bỏ giờ phút giây)
      const exportDateStr = scanItem.scanTime instanceof Date 
        ? scanItem.scanTime.toISOString().split('T')[0] 
        : new Date(scanItem.scanTime).toISOString().split('T')[0];
      
      const key = `${exportDateStr}|${scanItem.materialCode}|${scanItem.poNumber}|${scanItem.importDate || 'NO_IMD'}|${scanItem.employeeId}|${scanItem.productionOrder}`;
      
      if (consolidatedMap.has(key)) {
        // ✅ TRÙNG ĐẦY ĐỦ 6 TRƯỜNG → Cộng dồn quantity
        const existing = consolidatedMap.get(key);
        existing.quantity += scanItem.quantity;
        existing.exportQuantity += scanItem.quantity;
        existing.updatedAt = scanItem.scanTime;
        console.log(`📊 Merged scan: ${scanItem.materialCode} (${scanItem.quantity}kg) into existing record`);
      } else {
        // ❌ KHÁC ÍT NHẤT 1 TRƯỜNG → Tạo dòng mới
        consolidatedMap.set(key, {
          factory: this.selectedFactory,
          materialCode: scanItem.materialCode,
          poNumber: scanItem.poNumber,
          location: scanItem.location,
          quantity: scanItem.quantity,
          unit: 'KG',
          exportQuantity: scanItem.quantity,
          exportDate: scanItem.scanTime,
          exportedBy: scanItem.employeeId,
          productionOrder: scanItem.productionOrder,
          employeeId: scanItem.employeeId,
          batchNumber: scanItem.importDate || null,
          scanMethod: 'CAMERA',
          notes: `Batch scan - ${scanItem.productionOrder}`,
          importDate: scanItem.importDate || null,
          createdAt: scanItem.scanTime,
          updatedAt: scanItem.scanTime
        });
        console.log(`📝 New record: ${scanItem.materialCode} | PO: ${scanItem.poNumber} | IMD: ${scanItem.importDate || 'N/A'}`);
      }
    }
    
    console.log(`📊 Consolidated ${this.pendingScanData.length} scans into ${consolidatedMap.size} outbound records`);
    
    // 2. Tạo consolidated outbound records trong batch
    for (const [key, record] of consolidatedMap) {
      const docRef = this.firestore.collection('outbound-materials').doc().ref;
      batch.set(docRef, record);
    }

    // 3. Commit batch outbound records
    console.log(`📦 Committing ${consolidatedMap.size} records to Firebase...`);
    await batch.commit();
    console.log(`✅ Successfully saved ${consolidatedMap.size} outbound records!`);
    
    // 4. Update inventory - Chạy SONG SONG không chờ để không làm chậm
    console.log(`📦 Updating inventory in background...`);
    this.updateInventoryInBackground(this.pendingScanData);
  }
  
  // Update inventory trong background, không block UI
  private updateInventoryInBackground(scanData: any[]): void {
    // Group theo materialCode + poNumber + importDate
    const groupedUpdates = new Map<string, any>();
    
    for (const scanItem of scanData) {
      const key = `${scanItem.materialCode}|${scanItem.poNumber}|${scanItem.importDate || 'NOBATCH'}`;
      if (groupedUpdates.has(key)) {
        const existing = groupedUpdates.get(key);
        existing.quantity += scanItem.quantity;
      } else {
        groupedUpdates.set(key, {
          materialCode: scanItem.materialCode,
          poNumber: scanItem.poNumber,
          quantity: scanItem.quantity,
          importDate: scanItem.importDate
        });
      }
    }
    
    console.log(`📊 Grouped ${scanData.length} items into ${groupedUpdates.size} inventory updates`);
    
    // Update từng item trong background (không await)
    groupedUpdates.forEach((update, key) => {
      this.updateInventoryExported(
        update.materialCode,
        update.poNumber,
        update.quantity,
        update.importDate
      ).catch(error => {
        console.error(`⚠️ Background inventory update failed for ${key}:`, error.message);
      });
    });
    
    console.log(`✅ Inventory updates queued in background`);
  }

  // 🔧 SCAN REVIEW MODAL: Xem danh sách scan trước khi lưu
  showScanReview(): void {
    if (this.pendingScanData.length === 0) {
      alert('Chưa có dữ liệu scan nào!');
      return;
    }
    this.showScanReviewModal = true;
    console.log(`📋 Showing scan review: ${this.pendingScanData.length} items`);
  }

  closeScanReview(): void {
    this.showScanReviewModal = false;
  }

  async confirmAndSave(): Promise<void> {
    this.showScanReviewModal = false;
    await this.stopBatchScanningMode();
  }

  // 🔧 SỬA LỖI: Scan đơn giản - 1 lần bấm là scan và ghi luôn
  private processBatchScanInput(scannedData: string): void {
    if (!scannedData.trim()) return;

    console.log('🔍 === SIMPLE SCAN PROCESS START ===');
    console.log('🔍 Scanned data:', scannedData);
    console.log('🔍 Data length:', scannedData.length);
    
    // Clear the input field after processing
    this.scannerBuffer = '';
    
    try {
      // 🔧 LOGIC ĐƠN GIẢN: Xử lý theo thứ tự ưu tiên
      
      // 1. Nếu chưa scan LSX, ưu tiên scan LSX
      if (!this.isProductionOrderScanned) {
        if (scannedData.includes('LSX') || scannedData.includes('KZLSX')) {
          this.batchProductionOrder = scannedData;
          this.isProductionOrderScanned = true;
          console.log('✅ LSX scanned:', this.batchProductionOrder);
          this.showScanStatus();
          return;
        }
      }
      
      // 2. Nếu chưa scan Employee ID, ưu tiên scan Employee ID
      if (!this.isEmployeeIdScanned) {
        if (scannedData.includes('ASP') || scannedData.length <= 10) {
          // 🔧 SỬA LỖI: Chỉ lấy 7 ký tự đầu tiên của mã nhân viên
          const extractedId = scannedData.substring(0, 7);
          console.log(`🔍 Auto-detect: Original "${scannedData}" → Extracted "${extractedId}"`);
          this.batchEmployeeId = extractedId;
          this.isEmployeeIdScanned = true;
          // 🔧 TỐI ƯU HÓA: Bỏ console.log để tăng tốc độ
          this.showScanStatus();
          
          // 🔧 SỬA LỖI: Cập nhật currentScanStep thành 'material' sau khi scan Employee ID
          if (this.isProductionOrderScanned && this.isEmployeeIdScanned) {
            this.currentScanStep = 'material';
            console.log('✅ Both LSX and Employee ID scanned, ready for material scanning');
          }
          return;
        }
      }
    
      // 3. Nếu đã scan cả LSX và Employee ID, xử lý mã hàng
    if (this.isProductionOrderScanned && this.isEmployeeIdScanned) {
        // 🔧 TỐI ƯU HÓA: Bỏ console.log để tăng tốc độ
      this.processBatchMaterialScan(scannedData);
        return;
      }
      
      // 4. Nếu không nhận diện được, thử xử lý theo độ dài
      if (!this.isProductionOrderScanned && !this.isEmployeeIdScanned) {
        if (scannedData.length > 10) {
          this.batchProductionOrder = scannedData;
          this.isProductionOrderScanned = true;
          console.log('✅ LSX detected by length:', this.batchProductionOrder);
          this.showScanStatus();
          
          // 🔧 SỬA LỖI: Cập nhật currentScanStep thành 'material' sau khi scan LSX
          if (this.isProductionOrderScanned && this.isEmployeeIdScanned) {
            this.currentScanStep = 'material';
            console.log('✅ Both LSX and Employee ID scanned, ready for material scanning');
          }
        } else {
          // 🔧 SỬA LỖI: Chỉ lấy 7 ký tự đầu tiên của mã nhân viên
          const extractedId = scannedData.substring(0, 7);
          console.log(`🔍 Auto-detect: Original "${scannedData}" → Extracted "${extractedId}"`);
          this.batchEmployeeId = extractedId;
          this.isEmployeeIdScanned = true;
          // 🔧 TỐI ƯU HÓA: Bỏ console.log để tăng tốc độ
          this.showScanStatus();
          
          // 🔧 SỬA LỖI: Cập nhật currentScanStep thành 'material' sau khi scan Employee ID
          if (this.isProductionOrderScanned && this.isEmployeeIdScanned) {
            this.currentScanStep = 'material';
            console.log('✅ Both LSX and Employee ID scanned, ready for material scanning');
          }
        }
        return;
      }
      
      // 5. Nếu không xử lý được, hiện thông báo lỗi
      console.log('❌ Không thể xử lý dữ liệu scan:', scannedData);
      this.showScanError('Không thể xử lý dữ liệu scan: ' + scannedData);
      
    } catch (error) {
      console.error('❌ Error processing scan:', error);
      this.showScanError('Lỗi xử lý scan: ' + error.message);
    }
    
    console.log('🔍 === SIMPLE SCAN PROCESS END ===');
  }

  // Helper methods for scan status
  private showScanStatus(): void {
    console.log('📊 Scan Status:', {
      LSX: this.isProductionOrderScanned ? this.batchProductionOrder : 'Chưa scan',
      Employee: this.isEmployeeIdScanned ? this.batchEmployeeId : 'Chưa scan',
      Ready: this.isProductionOrderScanned && this.isEmployeeIdScanned
    });
    
    // Hiển thị thông báo cho user
    if (this.isProductionOrderScanned && this.isEmployeeIdScanned) {
      this.errorMessage = `✅ Đã scan LSX: ${this.batchProductionOrder} và Employee: ${this.batchEmployeeId}. Bây giờ có thể scan mã hàng để xuất kho.`;
    } else if (this.isProductionOrderScanned) {
      this.errorMessage = `✅ Đã scan LSX: ${this.batchProductionOrder}. Tiếp tục scan mã nhân viên.`;
    } else if (this.isEmployeeIdScanned) {
      this.errorMessage = `✅ Đã scan Employee: ${this.batchEmployeeId}. Tiếp tục scan LSX.`;
    }
  }

  private showScanError(message: string): void {
    console.error('❌ Scan Error:', message);
    alert('Lỗi scan: ' + message);
    
    // 🔧 AUTO-FOCUS AFTER ERROR: Tự động focus lại scanner input sau khi bấm OK
    setTimeout(() => {
      this.focusScannerInput();
      console.log('📍 Auto-focused scanner input after error');
    }, 100);
  }

  // Process employee ID scan
  private processEmployeeIdScan(scannedData: string): void {
    try {
      console.log('🔍 Processing employee ID scan:', scannedData);
      // Lấy 7 ký tự đầu tiên làm mã nhân viên
      const extractedId = (scannedData || '').toString().substring(0, 7);
      this.batchEmployeeId = extractedId;
      this.isEmployeeIdScanned = !!extractedId;
      if (this.isProductionOrderScanned && this.isEmployeeIdScanned) {
        this.currentScanStep = 'material';
      }
      this.showScanStatus();
      setTimeout(() => this.focusScannerInput(), 0);
    } catch (error: any) {
      console.error('❌ Error processing employee ID scan:', error);
      this.showScanError('Lỗi xử lý mã nhân viên');
    }
  }

  // Scanner input handlers for template
  onScannerKeydown(event: KeyboardEvent): void {
    const input = event.target as HTMLInputElement;
    if (event.key === 'Enter') {
      const value = input.value || '';
      input.value = '';
      this.processScannerInput(value);
      event.preventDefault();
    }
  }

  onScannerInputBlur(): void {
    // Keep focus for continuous scanning
    setTimeout(() => this.focusScannerInput(), 0);
  }

  private focusScannerInput(): void {
    try {
      const el = document.querySelector<HTMLInputElement>('.scanner-input');
      if (el) el.focus();
    } catch {}
  }

  private processScannerInput(scannedData: string): void {
    // 🔧 SỬA LỖI: Nếu đang ở modal setup, xử lý riêng
    if (this.showScanningSetupModal) {
      if (this.scanningSetupStep === 'lsx') {
        this.onLSXScanned(scannedData);
      } else if (this.scanningSetupStep === 'employee') {
        this.onEmployeeScanned(scannedData);
      }
      return;
    }
    
    // Route to batch scan processor
    this.processBatchScanInput(scannedData);
  }

  // Persistence helpers safeguard
  private   restorePendingFromStorage(): void {
    try {
      const raw = localStorage.getItem('rm2OutboundPending');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          this.pendingScanData = arr;
          console.log(`♻️ Restored ${arr.length} pending scans from storage`);
        }
      }
    } catch {}
  }

  private   savePendingToStorage(): void {
    try {
      localStorage.setItem('rm2OutboundPending', JSON.stringify(this.pendingScanData));
    } catch {}
  }

  // Minimal fallback to avoid compile break if missing
  private async updateInventoryExported(materialCode: string, poNumber: string, exportQuantity: number, importDate?: string): Promise<void> {
    try {
      console.log(`📦 Updating inventory exported: ${materialCode}, PO: ${poNumber}, Qty: ${exportQuantity}, Batch: ${importDate}`);
      
      // 🔧 KHÔNG DÙNG where('importDate') vì format có thể khác nhau
      // Query tất cả records của materialCode + poNumber, sau đó filter client-side
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('materialCode', '==', materialCode)
           .where('poNumber', '==', poNumber)
           .where('factory', '==', this.selectedFactory)
      ).get().toPromise();
      
      if (snapshot && !snapshot.empty) {
        console.log(`📦 Found ${snapshot.docs.length} inventory records for ${materialCode} - PO ${poNumber}`);
        
        // Nếu có importDate từ scan, tìm record khớp batch
        let targetDoc = null;
        
        if (importDate) {
          // Chuẩn hóa importDate từ scan về format DDMMYYYY
          const normalizedScanDate = this.normalizeImportDate(importDate);
          console.log(`🔍 Looking for batch: ${normalizedScanDate}`);
          
          // Tìm record có importDate khớp
          for (const doc of snapshot.docs) {
            const data = doc.data() as any;
            const invImportDate = this.normalizeImportDate(data.importDate);
            console.log(`  - Checking doc ${doc.id}: importDate = ${data.importDate} → normalized = ${invImportDate}`);
            
            if (invImportDate === normalizedScanDate) {
              targetDoc = doc;
              console.log(`✅ Found matching batch: ${doc.id}`);
              break;
            }
          }
        }
        
        // Nếu không tìm thấy batch khớp, lấy record đầu tiên có quantity > exported
        if (!targetDoc) {
          console.log(`⚠️ No matching batch found, using first available record with stock`);
          for (const doc of snapshot.docs) {
            const data = doc.data() as any;
            const available = (data.quantity || 0) - (data.exported || 0);
            if (available > 0) {
              targetDoc = doc;
              console.log(`✅ Using doc ${doc.id} with available stock: ${available}`);
              break;
            }
          }
          
          // Nếu vẫn không có, lấy record đầu tiên
          if (!targetDoc) {
            targetDoc = snapshot.docs[0];
            console.log(`⚠️ No stock available, using first doc: ${targetDoc.id}`);
          }
        }
        
        // Update inventory
        const data = targetDoc.data() as any;
        const currentExported = data.exported || 0;
        const newExported = currentExported + exportQuantity;
        
        console.log(`🔄 Updating inventory doc ${targetDoc.id}: exported ${currentExported} → ${newExported}`);
        
        await this.firestore.collection('inventory-materials').doc(targetDoc.id).update({
          exported: newExported,
          updatedAt: new Date()
        });
        
        console.log(`✅ Inventory updated: ${materialCode} - PO ${poNumber}, exported: ${newExported}`);
      } else {
        console.log(`⚠️ No inventory record found for ${materialCode} - PO ${poNumber}`);
        console.log(`⚠️ Skipping inventory update (material may not exist in inventory)`);
      }
    } catch (error) {
      console.error(`❌ Error updating inventory exported:`, error);
      // Không throw error để không block batch update của các item khác
      console.log(`⚠️ Continuing batch update despite inventory update error`);
    }
  }
  
  // Chuẩn hóa importDate về format DDMMYYYY để so sánh
  private normalizeImportDate(importDate: any): string {
    if (!importDate) return '';
    
    // Nếu đã là string DDMMYYYY (8 ký tự số)
    if (typeof importDate === 'string' && /^\d{8}$/.test(importDate)) {
      return importDate;
    }
    
    // Nếu là Date object
    if (importDate instanceof Date || importDate.toDate) {
      const date = importDate.toDate ? importDate.toDate() : importDate;
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}${month}${year}`;
    }
    
    // Nếu là string format khác (YYYY-MM-DD, DD/MM/YYYY, etc.)
    if (typeof importDate === 'string') {
      // Thử parse các format phổ biến
      const formats = [
        /^(\d{2})\/(\d{2})\/(\d{4})$/,  // DD/MM/YYYY
        /^(\d{4})-(\d{2})-(\d{2})$/,    // YYYY-MM-DD
        /^(\d{2})-(\d{2})-(\d{4})$/     // DD-MM-YYYY
      ];
      
      for (const format of formats) {
        const match = importDate.match(format);
        if (match) {
          if (format.source.startsWith('^\\(\\d{4}')) {
            // YYYY-MM-DD
            return `${match[3]}${match[2]}${match[1]}`;
          } else {
            // DD/MM/YYYY or DD-MM-YYYY
            return `${match[1]}${match[2]}${match[3]}`;
          }
        }
      }
    }
    
    console.log(`⚠️ Cannot normalize importDate: ${importDate}`);
    return String(importDate);
  }

  // Queue for rapid scans
  // duplicate declarations removed here (already declared above)
  // private isProcessingMaterialScan: boolean = false;
  // private materialScanQueue: string[] = [];

  private enqueueMaterialScan(scannedData: string): void {
    if (!scannedData || !scannedData.trim()) return;
    this.materialScanQueue.push(scannedData);
    if (!this.isProcessingMaterialScan) {
      this.processMaterialScanQueue();
    }
  }

  private processMaterialScanQueue(): void {
    if (this.isProcessingMaterialScan) return;
    const next = this.materialScanQueue.shift();
    if (!next) return;
    this.isProcessingMaterialScan = true;
    try {
      this.processBatchMaterialScan(next);
    } finally {
      this.isProcessingMaterialScan = false;
      setTimeout(() => this.processMaterialScanQueue(), 0);
    }
  }

  // Parse and push a material scan to pending (no DB writes here)
  private processBatchMaterialScan(scannedData: string): void {
    if (!this.isProductionOrderScanned || !this.isEmployeeIdScanned) {
      this.showScanError('Phải scan LSX và mã nhân viên trước!');
      return;
    }
    let materialCode = '';
    let poNumber = '';
    let quantity = 1;
    let importDate: string | null = null;
    const text = (scannedData || '').trim();
    if (text.includes('|')) {
      const parts = text.replace(/\s*\|\s*/g, '|').split('|');
      if (parts.length >= 3) {
        materialCode = parts[0].trim();
        poNumber = parts[1].trim();
        quantity = parseInt(parts[2]) || 1;
        if (parts.length >= 4) importDate = parts[3].trim();
      }
    } else {
      materialCode = text;
      poNumber = 'Unknown';
      quantity = 1;
    }
    if (!materialCode) {
      this.showScanError('Không thể đọc mã hàng từ dữ liệu scan!');
      return;
    }
    const scanItem = {
      materialCode,
      poNumber,
      quantity,
      importDate,
      location: 'N/A',
      productionOrder: this.batchProductionOrder,
      employeeId: this.batchEmployeeId,
      scanTime: new Date(),
      scanMethod: 'CAMERA'
    };
    this.pendingScanData = [...this.pendingScanData, scanItem];
    this.savePendingToStorage();
  }
}