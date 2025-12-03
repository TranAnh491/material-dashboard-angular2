import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import * as QRCode from 'qrcode';
import { FactoryAccessService } from '../../services/factory-access.service';


export interface InboundMaterial {
  id?: string;
  factory?: string; // Factory identifier (ASM1, ASM2, etc.)
  importDate: Date;
  internalBatch?: string; // Auto-generated batch (tuần + số thứ tự)
  batchNumber: string; // Lô hàng từ file import
  materialCode: string;
  poNumber: string;
  quantity: number;
  unit: string;
  location: string;
  type: string;
  iqcStatus?: string; // IQC Status: Chờ kiểm, Pass, NG, Đặc Cách, Chờ phán định
  expiryDate: Date | null;
  qualityCheck: boolean; // Changed to boolean for Tick/No
  isReceived: boolean;
  notes: string;
  rollsOrBags: number;
  supplier: string;
  unitWeight?: number; // Trọng lượng đơn vị (gram) - max 2 decimals
  remarks: string;
  hasQRGenerated?: boolean; // Track if QR code has been generated
  createdAt?: Date;
  updatedAt?: Date;
  
  // New fields for batch processing
  batchStartTime?: Date; // Thời gian bắt đầu kiểm lô hàng
  batchEndTime?: Date;   // Thời gian kết thúc kiểm lô hàng
  employeeIds?: string[]; // Danh sách mã nhân viên tham gia kiểm
  batchStatus?: 'idle' | 'active' | 'completed'; // Trạng thái lô hàng
  batchDuration?: number; // Thời gian hoàn thành (phút)
}

@Component({
  selector: 'app-inbound-asm1',
  templateUrl: './inbound-asm1.component.html',
  styleUrls: ['./inbound-asm1.component.scss']
})
export class InboundASM1Component implements OnInit, OnDestroy {
  private batchCounter = 1; // Counter cho batch
  
  // Tạo batch tự động theo format tuần + số thứ tự
  private generateInternalBatch(): string {
    const now = new Date();
    const year = now.getFullYear();
    
    // Tính tuần trong năm
    const startOfYear = new Date(year, 0, 1);
    const pastDaysOfYear = (now.getTime() - startOfYear.getTime()) / 86400000;
    const weekNumber = Math.ceil((pastDaysOfYear + startOfYear.getDay() + 1) / 7);
    
    // Format: TTSSSS (TT = tuần, SSSS = số thứ tự 4 chữ số)
    const batch = `${weekNumber.toString().padStart(2, '0')}${this.batchCounter.toString().padStart(4, '0')}`;
    this.batchCounter++;
    
    return batch;
  }
  materials: InboundMaterial[] = [];
  filteredMaterials: InboundMaterial[] = [];
  
  // Search and filter
  searchTerm: string = '';
  searchType: string = 'materialCode'; // Default to Mã Hàng
  
  // Factory filter - Fixed to ASM1
  selectedFactory: string = 'ASM1';
  availableFactories: string[] = ['ASM1'];
  
  // Time range filter
  startDate: string = '';
  endDate: string = '';
  
  // Status filter - 3 trạng thái: Đã nhận, Chưa, Toàn bộ
  statusFilter: string = 'all'; // Default to Tất cả
  
  // Batch type filters - Hàng Trả / Hàng Nhập
  filterReturnGoods: boolean = false; // Lọc hàng trả (batchNumber bắt đầu bằng TRA)
  filterNormalGoods: boolean = false; // Lọc hàng nhập (không phải TRA)
  
  // Sort filter
  sortBy: string = 'importDate'; // Default to Ngày nhập
  
  // Auto-hide received materials after next day (not 24 hours, but by calendar day)
  hideReceivedAfterNextDay: boolean = true;
  
  // Batch processing properties
  isBatchActive: boolean = false;
  currentBatchNumber: string = '';
  currentEmployeeIds: string[] = [];
  batchStartTime: Date | null = null;
  showBatchModal: boolean = false;
  scannedEmployeeId: string = '';
  
  // IQC Modal properties
  showIQCModal: boolean = false;
  iqcScanInput: string = '';
  scannedMaterial: InboundMaterial | null = null;
  iqcEmployeeId: string = '';
  iqcEmployeeVerified: boolean = false;
  iqcStep: number = 1; // 1: Scan employee, 2: Scan material
  
  // Nhận hàng trả Modal properties
  showReturnGoodsModal: boolean = false;
  returnGoodsEmployeeInput: string = '';
  returnGoodsEmployeeId: string = '';
  returnGoodsEmployeeVerified: boolean = false;
  returnGoodsStep: number = 1; // 1: Scan employee, 2: Scan QR code
  returnGoodsQRInput: string = '';
  returnGoodsScanResult: { success: boolean, message: string, material?: InboundMaterial } | null = null;
  
  // Physical Scanner properties (copy from outbound)
  isScannerInputActive: boolean = false;
  scannerBuffer: string = '';
  scannerTimeout: any = null;
  scanStartTime: number = 0;
  
  // Camera Mode properties
  isCameraModeActive: boolean = false;
  cameraScanner: any = null; // HTML5 QR Scanner instance
  
  // Loading state
  isLoading: boolean = false;
  
  // Error handling
  errorMessage: string = '';
  
  // Excel import
  selectedFile: File | null = null;
  
  // User permissions
  canAddMaterials: boolean = false;
  canEditMaterials: boolean = false;
  canDeleteMaterials: boolean = false;
  canGenerateQR: boolean = false;
  canExportData: boolean = false;
  
  // Lifecycle management
  private destroy$ = new Subject<void>();
  
  // Thêm properties mới cho giao diện input trực tiếp
  isEmployeeCodeSaved = false;
  selectedBatch: string = '';
  availableBatches: any[] = [];
  employeeCode: string = '';
  isBatchScanningMode: boolean = false;
  
  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private factoryAccessService: FactoryAccessService
  ) {}
  
  ngOnInit(): void {
    this.loadPermissions();
    
    // Thiết lập khung thời gian mặc định: 30 ngày gần nhất
    this.setupDateDefaults();
    console.log(`📅 Khung thời gian mặc định: ${this.startDate} đến ${this.endDate} (30 ngày gần nhất)`);
    
    // Mặc định hiển thị tất cả materials (không filter)
    this.statusFilter = 'all';
    
    this.loadMaterials();
  }
  
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
  
  private loadPermissions(): void {
    this.afAuth.authState.pipe(takeUntil(this.destroy$)).subscribe(user => {
      if (user) {
        // Load user permissions for ASM1
        this.canAddMaterials = true;
        this.canEditMaterials = true;
        this.canDeleteMaterials = true;
        this.canGenerateQR = true;
        this.canExportData = true;
        console.log('✅ ASM1 Inbound permissions loaded');
      }
    });
  }
  
  private setupDateDefaults(): void {
    const today = new Date();
    // Cố định hiển thị 30 ngày, tính từ hôm nay quay ngược lại 30 ngày
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    this.startDate = thirtyDaysAgo.toISOString().split('T')[0];
    this.endDate = today.toISOString().split('T')[0];
    
    console.log(`📅 Thiết lập khung thời gian mặc định:`);
    console.log(`  - Từ ngày: ${this.startDate} (${thirtyDaysAgo.toLocaleDateString('vi-VN')})`);
    console.log(`  - Đến ngày: ${this.endDate} (${today.toLocaleDateString('vi-VN')})`);
    console.log(`  - Tổng cộng: 30 ngày gần nhất`);
  }
  
  loadMaterials(): void {
    this.isLoading = true;
    this.errorMessage = '';
    
    console.log('📦 Loading ASM1 inbound materials (pending only)...');
    this.tryLoadFromCollection('inbound-materials');
  }
  
  private tryLoadFromCollection(collectionName: string): void {
    console.log(`🔍 Trying collection: ${collectionName}`);
    
    this.firestore.collection(collectionName, ref => 
      ref.where('isReceived', '==', false)
         .limit(1000)
    ).snapshotChanges()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        console.log(`🔍 Raw snapshot from ${collectionName} contains ${snapshot.length} documents`);
        
        if (snapshot.length === 0) {
          console.log(`❌ No data in ${collectionName}, trying other collections...`);
          this.tryAlternativeCollections();
          return;
        }
        
        // Log first few documents to see structure
        if (snapshot.length > 0) {
          console.log('📄 Sample document:', snapshot[0].payload.doc.data());
        }
        
        // Filter for ASM1 factory and sort client-side
        const allMaterials = snapshot.map(doc => {
          const data = doc.payload.doc.data() as any;
          console.log(`📦 Processing doc ${doc.payload.doc.id}, factory: ${data.factory}, isReceived: ${data.isReceived}, batch: ${data.batchNumber}, material: ${data.materialCode}`);
          return {
            id: doc.payload.doc.id,
            factory: data.factory || 'ASM1',
            importDate: data.importDate?.toDate() || new Date(),
            internalBatch: data.internalBatch || '', // Load internalBatch từ database
            batchNumber: data.batchNumber || '',
            materialCode: data.materialCode || '',
            poNumber: data.poNumber || '',
            quantity: data.quantity || 0,
            unit: data.unit || '',
            location: data.location || '',
            type: data.type || '',
            iqcStatus: data.iqcStatus || 'Chờ kiểm', // Default IQC status
            expiryDate: data.expiryDate?.toDate() || null,
            qualityCheck: data.qualityCheck || false,
            isReceived: data.isReceived || false,
            notes: data.notes || '',
            rollsOrBags: data.rollsOrBags || 0,
            supplier: data.supplier || '',
            remarks: data.remarks || '',
            hasQRGenerated: data.hasQRGenerated || false,
            createdAt: data.createdAt?.toDate() || data.createdDate?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || data.lastUpdated?.toDate() || new Date()
          } as InboundMaterial;
        });
        
        console.log(`🏭 All materials before filter: ${allMaterials.length}`);
        console.log(`🏭 Factory values found:`, allMaterials.map(m => m.factory));
        console.log(`🏭 Received status found:`, allMaterials.map(m => ({ materialCode: m.materialCode, isReceived: m.isReceived })));
        
        // Filter ASM1 materials
        const asm1Materials = allMaterials.filter(material => material.factory === 'ASM1');
        console.log(`🏭 ASM1 materials after factory filter: ${asm1Materials.length}`);
        console.log(`🏭 ASM1 materials:`, asm1Materials.map(m => ({ 
          materialCode: m.materialCode, 
          batchNumber: m.batchNumber, 
          internalBatch: m.internalBatch,
          isReceived: m.isReceived,
          importDate: m.importDate
        })));
        
        this.materials = asm1Materials.sort((a, b) => {
            // Sort by import date first (oldest first)
            const dateCompare = a.importDate.getTime() - b.importDate.getTime();
            if (dateCompare !== 0) return dateCompare;
            
            // If same date, sort by creation time (import order)
            return a.createdAt.getTime() - b.createdAt.getTime();
          });
        
        console.log(`✅ ASM1 materials after filter: ${this.materials.length}`);
        
        // Load unitWeight từ danh mục materials nếu chưa có
        this.loadUnitWeightsFromCatalog();
        
        // Log materials by batch for debugging
        const materialsByBatch = this.materials.reduce((acc, material) => {
          const batch = material.batchNumber;
          if (!acc[batch]) acc[batch] = [];
          acc[batch].push(material);
          return acc;
        }, {} as {[key: string]: InboundMaterial[]});
        
        // Show batch info in UI instead of console
        const batchInfo = Object.keys(materialsByBatch).map(batch => ({
          batch,
          count: materialsByBatch[batch].length,
          materials: materialsByBatch[batch].map(m => m.materialCode)
        }));
        
        // Debug info removed - no more popups
        
        this.applyFilters();
        this.isLoading = false;
        
        console.log(`✅ Final filtered materials: ${this.filteredMaterials.length}`);
      },
      error: (error) => {
        console.error(`❌ Error loading from ${collectionName}:`, error);
        this.tryAlternativeCollections();
      }
    });
  }
  
  private tryAlternativeCollections(): void {
    const alternativeCollections = ['inbound-materials', 'materials', 'inbound-asm1'];
    
    console.log('🔄 Trying alternative collections:', alternativeCollections);
    
    // Check each collection for data
    alternativeCollections.forEach(collection => {
      this.firestore.collection(collection, ref => ref.limit(5))
        .get().toPromise().then(snapshot => {
          if (snapshot && !snapshot.empty) {
            console.log(`✅ Found ${snapshot.size} documents in ${collection}`);
            console.log(`📄 Sample from ${collection}:`, snapshot.docs[0].data());
          } else {
            console.log(`❌ No data in ${collection}`);
          }
        }).catch(err => {
          console.log(`❌ Error accessing ${collection}:`, err);
        });
    });
    
    this.isLoading = false;
    this.errorMessage = 'Không tìm thấy dữ liệu trong các collection. Kiểm tra Firebase Console để xác nhận collection name và data structure.';
  }
  
  applyFilters(): void {
    let filtered = [...this.materials];
    
    // Always filter by ASM1 only
    filtered = filtered.filter(material => material.factory === this.selectedFactory);
    
    // Apply search filter based on search type
    if (this.searchTerm) {
      const searchTermLower = this.searchTerm.toLowerCase();
      
      switch (this.searchType) {
        case 'materialCode':
          // Search by material code
          filtered = filtered.filter(material => 
            material.materialCode.toLowerCase().includes(searchTermLower)
          );
          break;
        case 'batchNumber':
          filtered = filtered.filter(material => 
            material.batchNumber.toLowerCase().includes(searchTermLower)
          );
          break;
        case 'location':
          // Search by location
          filtered = filtered.filter(material => 
            material.location && material.location.toLowerCase().includes(searchTermLower)
          );
          break;
        case 'poNumber':
          filtered = filtered.filter(material => 
            material.poNumber.toLowerCase().includes(searchTermLower)
          );
          break;
        default: // 'all'
          filtered = filtered.filter(material => 
            material.materialCode.toLowerCase().includes(searchTermLower) ||
            material.poNumber.toLowerCase().includes(searchTermLower) ||
            material.batchNumber.toLowerCase().includes(searchTermLower) ||
            material.supplier.toLowerCase().includes(searchTermLower) ||
            material.location.toLowerCase().includes(searchTermLower)
          );
          break;
      }
    }
    
    // Date range filter
    if (this.startDate && this.endDate) {
      const start = new Date(this.startDate);
      const end = new Date(this.endDate);
      end.setHours(23, 59, 59, 999); // End of day
      
      const beforeCount = filtered.length;
      const filteredOut = [];
      filtered = filtered.filter(material => {
        const materialDate = new Date(material.importDate);
        // Reset time to start of day for accurate comparison
        materialDate.setHours(0, 0, 0, 0);
        const startDate = new Date(start);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(end);
        endDate.setHours(23, 59, 59, 999);
        
        const isInRange = materialDate >= startDate && materialDate <= endDate;
        if (!isInRange) {
          console.log(`❌ Material ${material.materialCode} bị ẩn do date filter:`, {
            materialDate: materialDate.toLocaleDateString('vi-VN'),
            startDate: startDate.toLocaleDateString('vi-VN'),
            endDate: endDate.toLocaleDateString('vi-VN'),
            isInRange: isInRange
          });
          filteredOut.push({
            materialCode: material.materialCode,
            importDate: material.importDate ? (typeof material.importDate === 'string' ? material.importDate : material.importDate.toLocaleDateString('vi-VN')) : 'N/A',
            internalBatch: material.internalBatch
          });
        } else {
          console.log(`✅ Material ${material.materialCode} pass date filter:`, {
            materialDate: materialDate.toLocaleDateString('vi-VN'),
            startDate: startDate.toLocaleDateString('vi-VN'),
            endDate: endDate.toLocaleDateString('vi-VN')
          });
        }
        return isInRange;
      });
      const afterCount = filtered.length;
      
      console.log(`📅 Lọc theo khung thời gian: ${this.startDate} đến ${this.endDate}`);
      console.log(`  - Trước khi lọc: ${beforeCount} materials`);
      console.log(`  - Sau khi lọc: ${afterCount} materials`);
      console.log(`  - Bị lọc ra: ${beforeCount - afterCount} materials`);
      if (filteredOut.length > 0) {
        console.log(`  - Materials bị ẩn do date filter:`, filteredOut);
      }
      console.log(`  - Khung thời gian: ${this.startDate} đến ${this.endDate} (${Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))} ngày)`);
      console.log(`  - Ngày bắt đầu: ${start.toLocaleDateString('vi-VN')}`);
      console.log(`  - Ngày kết thúc: ${end.toLocaleDateString('vi-VN')}`);
    } else if (this.startDate) {
      const start = new Date(this.startDate);
      const beforeCount = filtered.length;
      filtered = filtered.filter(material => material.importDate >= start);
      const afterCount = filtered.length;
      
      console.log(`📅 Lọc từ ngày: ${this.startDate}`);
      console.log(`  - Trước khi lọc: ${beforeCount} materials`);
      console.log(`  - Sau khi lọc: ${afterCount} materials`);
      console.log(`  - Bị lọc ra: ${beforeCount - afterCount} materials`);
      console.log(`  - Ngày bắt đầu: ${start.toLocaleDateString('vi-VN')}`);
    } else if (this.endDate) {
      const end = new Date(this.endDate);
      end.setHours(23, 59, 59, 999);
      const beforeCount = filtered.length;
      filtered = filtered.filter(material => material.importDate <= end);
      const afterCount = filtered.length;
      
      console.log(`📅 Lọc đến ngày: ${this.endDate}`);
      console.log(`  - Trước khi lọc: ${beforeCount} materials`);
      console.log(`  - Sau khi lọc: ${afterCount} materials`);
      console.log(`  - Bị lọc ra: ${beforeCount - afterCount} materials`);
      console.log(`  - Ngày kết thúc: ${end.toLocaleDateString('vi-VN')}`);
    } else {
      console.log(`⚠️ Không có khung thời gian lọc, hiển thị tất cả materials`);
    }
    
    // Batch type filter - Hàng Trả / Hàng Nhập
    if (this.filterReturnGoods || this.filterNormalGoods) {
      const beforeBatchTypeFilter = filtered.length;
      if (this.filterReturnGoods && !this.filterNormalGoods) {
        // Chỉ lọc hàng trả (batchNumber bắt đầu bằng TRA)
        filtered = filtered.filter(material => 
          material.batchNumber && material.batchNumber.toUpperCase().startsWith('TRA')
        );
      } else if (this.filterNormalGoods && !this.filterReturnGoods) {
        // Chỉ lọc hàng nhập (không phải TRA)
        filtered = filtered.filter(material => 
          !material.batchNumber || !material.batchNumber.toUpperCase().startsWith('TRA')
        );
      }
      // Nếu cả 2 đều được tick, hiển thị tất cả (không lọc)
      console.log(`📦 Batch type filter: Return=${this.filterReturnGoods}, Normal=${this.filterNormalGoods}, Before=${beforeBatchTypeFilter}, After=${filtered.length}`);
    }
    
    // Status filter - 3 trạng thái: Đã nhận, Chưa, Toàn bộ
    const beforeStatusFilter = filtered.length;
    if (this.statusFilter) {
      switch (this.statusFilter) {
        case 'received':
          // Đã nhận: Chỉ hiển thị các mã hàng đã được tick "đã nhận"
          filtered = filtered.filter(material => material.isReceived);
          break;
        case 'pending':
          // Chưa: Chỉ hiển thị các mã hàng chưa được tick "đã nhận"
          filtered = filtered.filter(material => !material.isReceived);
          break;
        case 'all':
          // Toàn bộ: Hiển thị tất cả mã hàng (không lọc theo isReceived)
          break;
      }
    } else {
      // Mặc định: Hiển thị tất cả materials (không filter theo isReceived)
      // Để materials mới import luôn hiển thị
    }
    const afterStatusFilter = filtered.length;
    
    if (beforeStatusFilter !== afterStatusFilter) {
      console.log(`🔍 Status filter (${this.statusFilter || 'pending'}): ${beforeStatusFilter} → ${afterStatusFilter} (ẩn ${beforeStatusFilter - afterStatusFilter} materials)`);
    }
    
    // Filter by current batch when processing
    if (this.currentBatchNumber && this.currentBatchNumber.trim() !== '') {
      filtered = filtered.filter(material => material.batchNumber === this.currentBatchNumber);
      console.log(`📦 Filtering by current batch: ${this.currentBatchNumber}`);
    }
    
    // Sort based on selected sort option
    filtered.sort((a, b) => {
      switch (this.sortBy) {
        case 'batchNumber':
          // Sort by batch number (A-Z)
          return a.batchNumber.localeCompare(b.batchNumber);
        case 'materialCode':
          // Sort by material code (A-Z)
          return a.materialCode.localeCompare(b.materialCode);
        case 'createdAt':
          // Sort by creation time (oldest first)
          return a.createdAt.getTime() - b.createdAt.getTime();
        case 'importDate':
        default:
          // Sort by import date first (oldest first)
          const dateCompare = a.importDate.getTime() - b.importDate.getTime();
          if (dateCompare !== 0) return dateCompare;
          
          // If same date, sort by creation time (import order)
          return a.createdAt.getTime() - b.createdAt.getTime();
      }
    });
    
    this.filteredMaterials = filtered;
    // this.updatePagination(); // Removed pagination update
    
    // Log thông tin về bộ lọc
    let filterDescription = '';
    switch (this.statusFilter) {
      case 'received':
        filterDescription = 'Chỉ hiển thị các mã hàng đã được tick "đã nhận"';
        break;
      case 'pending':
        filterDescription = 'Chỉ hiển thị các mã hàng chưa được tick "đã nhận"';
        break;
      case 'all':
        filterDescription = 'Hiển thị tất cả mã hàng (đã nhận và chưa nhận)';
        break;
      default:
        filterDescription = 'Chỉ hiển thị các mã hàng chưa được tick "đã nhận"';
    }
    
    console.log(`🔍 ASM1 filtered: ${filtered.length}/${this.materials.length} materials`);
    console.log('🔍 Final filtering result:');
    console.log('  - Total materials:', this.materials.length);
    console.log('  - Filtered materials:', this.filteredMaterials.length);
    console.log('  - Bộ lọc trạng thái:', this.statusFilter);
    console.log('  - Mô tả bộ lọc:', filterDescription);
    console.log('  - Materials đã nhận:', this.materials.filter(m => m.isReceived).length);
    console.log('  - Materials chưa nhận:', this.materials.filter(m => !m.isReceived).length);
    console.log('  - Khung thời gian:', this.startDate && this.endDate ? `${this.startDate} đến ${this.endDate}` : 'Không có');
    console.log('  - Tìm kiếm:', this.searchTerm || 'Không có');
    console.log('  - Loại tìm kiếm:', this.searchType);
    
    // Log thông tin chi tiết về bộ lọc
    console.log(`📊 Chi tiết bộ lọc:`);
    console.log(`  - Bộ lọc trạng thái: ${this.statusFilter}`);
    console.log(`  - Mô tả bộ lọc: ${filterDescription}`);
    console.log(`  - Khung thời gian: ${this.startDate && this.endDate ? `${this.startDate} đến ${this.endDate}` : 'Không có'}`);
    console.log(`  - Tìm kiếm: ${this.searchTerm || 'Không có'}`);
    console.log(`  - Loại tìm kiếm: ${this.searchType}`);
    console.log(`  - Số materials sẽ hiển thị: ${filtered.length}`);
    console.log(`  - Số materials bị ẩn: ${this.materials.length - filtered.length}`);
    
    // Log thông tin về từng loại materials
    const receivedMaterials = this.materials.filter(m => m.isReceived);
    const pendingMaterials = this.materials.filter(m => !m.isReceived);
    
    console.log(`📊 Chi tiết từng loại materials:`);
    console.log(`  - Materials đã nhận: ${receivedMaterials.length}`);
    console.log(`  - Materials chưa nhận: ${pendingMaterials.length}`);
    console.log(`  - Materials sẽ hiển thị: ${filtered.length}`);
    console.log(`  - Materials bị ẩn: ${this.materials.length - filtered.length}`);
    
    // Log thông tin về khung thời gian
    if (this.startDate && this.endDate) {
      const start = new Date(this.startDate);
      const end = new Date(this.endDate);
      const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      console.log(`📅 Thông tin khung thời gian:`);
      console.log(`  - Từ ngày: ${this.startDate} (${start.toLocaleDateString('vi-VN')})`);
      console.log(`  - Đến ngày: ${this.endDate} (${end.toLocaleDateString('vi-VN')})`);
      console.log(`  - Tổng cộng: ${daysDiff} ngày`);
    }

  }
  
  // updatePagination(): void { // Removed pagination update
  //   this.totalPages = Math.ceil(this.filteredMaterials.length / this.itemsPerPage);
  //   if (this.currentPage > this.totalPages) {
  //     this.currentPage = 1;
  //   }
  // }
  
  // getPaginatedMaterials(): InboundMaterial[] { // Removed pagination
  //   const startIndex = (this.currentPage - 1) * this.itemsPerPage;
  //   const endIndex = startIndex + this.itemsPerPage;
  //   return this.filteredMaterials.slice(startIndex, endIndex);
  // }
  
  onSearchChange(): void {
    // this.currentPage = 1; // Removed pagination
    this.applyFilters();
  }
  
  onDateFilterChange(): void {
    // this.currentPage = 1; // Removed pagination
    this.applyFilters();
  }
  
  onExpiryDateChange(event: any, material: any): void {
    const target = event.target as HTMLInputElement;
    material.expiryDate = target.value ? new Date(target.value) : null;
    this.updateMaterial(material);
  }
  

  
  onQualityCheckChange(event: any, material: InboundMaterial): void {
    const target = event.target as HTMLInputElement;
    material.qualityCheck = target.checked;
    this.updateMaterial(material);
  }
  
  // Add material to Inventory when received
  private addToInventory(material: InboundMaterial): void {
    console.log(`Adding ${material.materialCode} to Inventory ASM1...`);
    
    // 🔧 SỬA LỖI: batchNumber trong inventory chỉ là ngày nhập, không có số lô hàng
    // Chuyển ngày thành batch number: 26/08/2025 -> 26082025
    const inventoryBatchNumber = material.importDate ? (typeof material.importDate === 'string' ? material.importDate : material.importDate.toLocaleDateString('en-GB').split('/').join('')) : new Date().toLocaleDateString('en-GB').split('/').join('');
    
    // 🔧 SỬA LỖI: Kiểm tra duplicate trước khi add và lấy batchNumber với sequence
    // Duplicate = cùng materialCode + poNumber + batchNumber (ngày nhập) + source = 'inbound'
    // Nếu duplicate, thêm số thứ tự vào cuối batchNumber (01, 02, 03...)
    this.checkForDuplicateInInventory(material, inventoryBatchNumber).then(result => {
      const finalBatchNumber = result.sequenceNumber;
      
      if (result.isDuplicate) {
        console.log(`⚠️ Duplicate detected for ${material.materialCode} - ${material.poNumber} - ${inventoryBatchNumber}`);
        console.log(`  - Using new batch number with sequence: ${finalBatchNumber}`);
      } else {
        console.log(`✅ No duplicate found, using original batch number: ${finalBatchNumber}`);
      }
    
    // Xử lý location đặc biệt cho hàng trả (TRA)
    // Nếu location là TRA hoặc batchNumber bắt đầu bằng TRA, đổi thành F62 khi thêm vào inventory
    let inventoryLocation = material.location;
    if (material.location === 'TRA' || material.batchNumber?.toUpperCase().startsWith('TRA')) {
      inventoryLocation = 'F62';
      console.log(`🔄 Đổi location từ TRA sang F62 cho material ${material.materialCode} (lô hàng: ${material.batchNumber})`);
    }
    
    const inventoryMaterial = {
      factory: 'ASM1',
      importDate: material.importDate,
      receivedDate: new Date(), // When moved to inventory
      batchNumber: finalBatchNumber, // Ngày nhập + sequence number nếu duplicate
      materialCode: material.materialCode,
      poNumber: material.poNumber,
      quantity: material.quantity,
      unit: material.unit,
      exported: 0, // Initially no exports
      stock: material.quantity, // Initial stock = quantity
      location: inventoryLocation, // Đã xử lý đặc biệt cho hàng trả
      type: material.type,
      expiryDate: material.expiryDate,
      qualityCheck: material.qualityCheck,
      isReceived: true,
      notes: material.notes,
      rollsOrBags: material.rollsOrBags,
      supplier: material.supplier,
      remarks: material.remarks,
      source: 'inbound', // 🔧 SỬA LỖI: Đánh dấu nguồn gốc từ inbound
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Add to inventory-materials collection (no notification)
    this.firestore.collection('inventory-materials').add(inventoryMaterial)
      .then(() => {
        console.log(`✅ ${material.materialCode} added to Inventory ASM1 with batch number: ${finalBatchNumber}`);
          
          // 🆕 Cập nhật Standard Packing từ dữ liệu Inbound
          this.updateStandardPackingFromInbound(material);
          
          // 🆕 Cập nhật Unit Weight vào danh mục materials
          this.updateUnitWeightFromInbound(material);
          
        // No notification shown - silent operation
      })
      .catch((error) => {
        console.error('❌ Error adding to inventory:', error);
        // Revert the checkbox if failed
        material.isReceived = false;
        this.updateMaterial(material);
        });
    });
  }

  // 🔧 SỬA LỖI: Kiểm tra duplicate trong inventory và trả về số thứ tự cần thêm
  // Duplicate = cùng materialCode + poNumber + batchNumber (ngày nhập) + source = 'inbound'
  // Trả về số thứ tự cần thêm vào cuối batchNumber (01, 02, 03...)
  private async checkForDuplicateInInventory(material: InboundMaterial, inventoryBatchNumber: string): Promise<{ isDuplicate: boolean, sequenceNumber: string }> {
    try {
      console.log(`🔍 Checking for duplicate in inventory: ${material.materialCode} - ${material.poNumber} - ${inventoryBatchNumber}`);
      console.log(`  - Inbound batchNumber: ${material.batchNumber} (có số lô hàng)`);
      console.log(`  - Inventory batchNumber: ${inventoryBatchNumber} (chỉ ngày nhập)`);
      
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', 'ASM1')
           .where('materialCode', '==', material.materialCode)
           .where('poNumber', '==', material.poNumber)
           .where('source', '==', 'inbound')
      ).get().toPromise();
      
      if (snapshot && !snapshot.empty) {
        console.log(`🔍 Found ${snapshot.size} existing records for ${material.materialCode} - ${material.poNumber}`);
        
        // Tìm các batchNumber có cùng prefix (cùng ngày)
        const existingBatchNumbers: string[] = [];
        snapshot.forEach(doc => {
          const data = doc.data();
          const batchNum = data['batchNumber'];
          if (batchNum && batchNum.startsWith(inventoryBatchNumber)) {
            existingBatchNumbers.push(batchNum);
          }
        });
        
        console.log(`📊 Existing batch numbers with same prefix:`, existingBatchNumbers);
        
        if (existingBatchNumbers.length > 0) {
          // Tìm số thứ tự tiếp theo
          const sequenceNumbers: number[] = [];
          
          existingBatchNumbers.forEach(batchNum => {
            if (batchNum === inventoryBatchNumber) {
              sequenceNumbers.push(0); // Dòng gốc không có suffix
            } else {
              const suffix = batchNum.substring(inventoryBatchNumber.length);
              const sequenceNum = parseInt(suffix);
              if (!isNaN(sequenceNum)) {
                sequenceNumbers.push(sequenceNum);
              }
            }
          });
          
          // Tìm số thứ tự tiếp theo (bắt đầu từ 01)
          let nextSequence = 1;
          sequenceNumbers.sort((a, b) => a - b);
          
          // Tìm số đầu tiên chưa được sử dụng (bắt đầu từ 1)
          for (let i = 1; i <= 99; i++) {
            if (!sequenceNumbers.includes(i)) {
              nextSequence = i;
              break;
            }
          }
          
          const sequenceString = nextSequence.toString().padStart(2, '0');
          const newBatchNumber = inventoryBatchNumber + sequenceString;
          
          console.log(`⚠️ Duplicate detected for ${material.materialCode} - ${material.poNumber} - ${inventoryBatchNumber}`);
          console.log(`  - Existing sequences: ${sequenceNumbers.join(', ')}`);
          console.log(`  - Next sequence: ${nextSequence} -> ${sequenceString}`);
          console.log(`  - New batch number: ${newBatchNumber}`);
          
          return { isDuplicate: true, sequenceNumber: newBatchNumber };
        }
      }
      
      console.log(`✅ No duplicate found for ${material.materialCode} - ${material.poNumber} - ${inventoryBatchNumber}`);
      console.log(`  - Safe to add to inventory with original batch number`);
      return { isDuplicate: false, sequenceNumber: inventoryBatchNumber };
      
    } catch (error) {
      console.error('❌ Error checking for duplicate:', error);
      return { isDuplicate: false, sequenceNumber: inventoryBatchNumber }; // Allow add if check fails
    }
  }

  // 🆕 Cập nhật Standard Packing từ dữ liệu Inbound ASM1
  private async updateStandardPackingFromInbound(material: InboundMaterial): Promise<void> {
    try {
      console.log(`📦 Updating Standard Packing for ${material.materialCode} from Inbound data...`);
      
      // Kiểm tra có rollsOrBags hợp lệ không
      if (!material.rollsOrBags || material.rollsOrBags <= 0) {
        console.log(`⚠️ Skipping Standard Packing update - invalid rollsOrBags: ${material.rollsOrBags}`);
        return;
      }
      
      const standardPackingValue = material.rollsOrBags;
      console.log(`📊 Standard Packing value: ${standardPackingValue} for ${material.materialCode}`);
      
      // Cập nhật vào collection 'materials' (chính)
      const materialsDocRef = this.firestore.collection('materials').doc(material.materialCode).ref;
      await materialsDocRef.update({
        standardPacking: standardPackingValue,
        updatedAt: new Date()
      });
      console.log(`✅ Updated materials collection: ${material.materialCode} = ${standardPackingValue}`);
      
      // Cập nhật vào collection 'catalog' (đồng bộ)
      const catalogDocRef = this.firestore.collection('catalog').doc(material.materialCode).ref;
      await catalogDocRef.update({
        standardPacking: standardPackingValue,
        updatedAt: new Date()
      });
      console.log(`✅ Updated catalog collection: ${material.materialCode} = ${standardPackingValue}`);
      
      console.log(`🎯 Standard Packing updated successfully for ${material.materialCode}: ${standardPackingValue}`);
      
    } catch (error) {
      console.error(`❌ Error updating Standard Packing for ${material.materialCode}:`, error);
      // Không throw error để không ảnh hưởng đến việc add vào inventory
    }
  }
  
  private async updateUnitWeightFromInbound(material: InboundMaterial): Promise<void> {
    try {
      // Kiểm tra có unitWeight hợp lệ không
      if (!material.unitWeight || material.unitWeight <= 0) {
        console.log(`⚠️ Skipping Unit Weight update - no valid value: ${material.unitWeight}`);
        return;
      }
      
      // Làm tròn 2 chữ số thập phân
      const unitWeightValue = Math.round(material.unitWeight * 100) / 100;
      console.log(`⚖️ Updating Unit Weight for ${material.materialCode}: ${unitWeightValue}g`);
      
      // Cập nhật vào collection 'materials' (danh mục chính - dùng cho utilization)
      const materialsDocRef = this.firestore.collection('materials').doc(material.materialCode).ref;
      
      // Kiểm tra document có tồn tại không
      const docSnapshot = await materialsDocRef.get();
      
      if (docSnapshot.exists) {
        // Update nếu đã tồn tại
        await materialsDocRef.update({
          unitWeight: unitWeightValue,
          updatedAt: new Date()
        });
        console.log(`✅ Updated materials collection: ${material.materialCode} = ${unitWeightValue}g`);
      } else {
        // Tạo mới nếu chưa tồn tại
        await materialsDocRef.set({
          materialCode: material.materialCode,
          unitWeight: unitWeightValue,
          createdAt: new Date(),
          updatedAt: new Date()
        }, { merge: true });
        console.log(`✅ Created materials document: ${material.materialCode} = ${unitWeightValue}g`);
      }
      
      console.log(`🎯 Unit Weight updated successfully for ${material.materialCode}: ${unitWeightValue}g`);
      
    } catch (error) {
      console.error(`❌ Error updating Unit Weight for ${material.materialCode}:`, error);
      // Không throw error để không ảnh hưởng đến việc add vào inventory
    }
  }
  
  // Validate Unit Weight: chỉ cho phép số với tối đa 2 chữ số thập phân
  validateUnitWeight(material: InboundMaterial): void {
    if (material.unitWeight !== null && material.unitWeight !== undefined) {
      // Làm tròn về 2 chữ số thập phân
      material.unitWeight = Math.round(material.unitWeight * 100) / 100;
      
      // Giới hạn giá trị
      if (material.unitWeight < 0) {
        material.unitWeight = 0;
      }
      if (material.unitWeight > 99999.99) {
        material.unitWeight = 99999.99;
      }
    }
  }
  
  // Validate Type: chỉ chấp nhận A12, H11, ND, E31
  validateType(material: InboundMaterial): void {
    const allowedTypes = ['A12', 'H11', 'ND', 'E31'];
    
    if (material.type) {
      // Trim và uppercase
      const typeValue = material.type.trim().toUpperCase();
      
      // Kiểm tra có trong danh sách không
      if (allowedTypes.includes(typeValue)) {
        material.type = typeValue;
      } else {
        // Không hợp lệ - set về rỗng
        material.type = '';
        console.log(`⚠️ Loại hình không hợp lệ. Chỉ chấp nhận: ${allowedTypes.join(', ')}`);
      }
    }
  }
  
  // Load unit weights từ danh mục materials collection
  private async loadUnitWeightsFromCatalog(): Promise<void> {
    try {
      console.log('⚖️ Loading unit weights from materials catalog...');
      
      // Lấy unique material codes
      const materialCodes = [...new Set(this.materials.map(m => m.materialCode))];
      
      if (materialCodes.length === 0) return;
      
      // Load từ materials collection (danh mục chính)
      const snapshot = await this.firestore.collection('materials').get().toPromise();
      
      const catalogMap = new Map<string, number>();
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data && data['unitWeight']) {
          catalogMap.set(doc.id, data['unitWeight']);
        }
      });
      
      console.log(`📚 Loaded ${catalogMap.size} unit weights from catalog`);
      
      // Fill unitWeight vào materials nếu chưa có
      let filledCount = 0;
      this.materials.forEach(material => {
        if (!material.unitWeight && catalogMap.has(material.materialCode)) {
          material.unitWeight = catalogMap.get(material.materialCode);
          filledCount++;
        }
      });
      
      if (filledCount > 0) {
        console.log(`✅ Filled ${filledCount} unit weights from catalog`);
      }
      
    } catch (error) {
      console.error('❌ Error loading unit weights from catalog:', error);
    }
  }
  
  onStatusFilterChange(): void {
    // this.currentPage = 1; // Removed pagination
    this.applyFilters();
  }
  
  onSearchTypeChange(): void {
    // this.currentPage = 1; // Removed pagination
    this.applyFilters();
  }
  
  getSearchPlaceholder(): string {
    switch (this.searchType) {
      case 'materialCode':
        return 'Tìm kiếm theo mã hàng...';
      case 'batchNumber':
        return 'Tìm kiếm theo lô hàng...';
      case 'location':
        return 'Tìm kiếm theo vị trí...';
      case 'poNumber':
        return 'Tìm kiếm theo PO...';
      default:
        return 'Tìm kiếm ASM1...';
    }
  }
  
  clearFilters(): void {
    this.searchTerm = '';
    this.searchType = 'materialCode';
    this.startDate = '';
    this.endDate = '';
    this.statusFilter = 'all'; // Mặc định về "Tất cả"
    
    // Reset về khung thời gian 30 ngày gần nhất
    this.setupDateDefaults();
    
    console.log(`🔄 Đã reset bộ lọc về mặc định:`);
    console.log(`  - Khung thời gian: ${this.startDate} đến ${this.endDate} (30 ngày gần nhất)`);
    console.log(`  - Trạng thái: ${this.statusFilter}`);
    console.log(`  - Tìm kiếm: ${this.searchTerm || 'Không có'}`);
    console.log(`  - Loại tìm kiếm: ${this.searchType}`);
    
    this.applyFilters();
  }

  
  // Navigation methods // Removed pagination
  // goToPage(page: number): void {
  //   if (page >= 1 && page <= this.totalPages) {
  //     this.currentPage = page;
  //   }
  // }
  
  // previousPage(): void {
  //   if (this.currentPage > 1) {
  //     this.currentPage--;
  //   }
  // }
  
  // nextPage(): void {
  //   if (this.currentPage < this.totalPages) {
  //     this.currentPage++;
  //   }
  // }
  
  // Dropdown functionality
  // More popup modal
  showMorePopup: boolean = false;
  
  // Delete by batch modal
  showDeleteByBatchModal: boolean = false;
  batchToDelete: string = '';
  
  openMorePopup(): void {
    this.showMorePopup = true;
  }
  
  closeMorePopup(): void {
    this.showMorePopup = false;
  }
  
  // Search functionality
  onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchTerm = target.value;
    this.applyFilters();
  }
  
  changeSearchType(type: string): void {
    this.searchType = type;
    this.applyFilters();
  }

  // Batch type filter change handler
  onBatchTypeFilterChange(): void {
    console.log('📦 Batch type filter changed:', {
      filterReturnGoods: this.filterReturnGoods,
      filterNormalGoods: this.filterNormalGoods
    });
    this.applyFilters();
  }

  // Getter: Đếm số hàng trả đang chờ nhập (chưa isReceived)
  get pendingReturnGoodsCount(): number {
    return this.materials.filter(material => 
      material.batchNumber && 
      material.batchNumber.toUpperCase().startsWith('TRA') &&
      !material.isReceived
    ).length;
  }
  
  changeStatusFilter(status: string): void {
    this.statusFilter = status;
    console.log(`🔄 Thay đổi bộ lọc trạng thái: ${status}`);
    
    // Log thông tin về số lượng materials trước và sau khi lọc
    const beforeCount = this.materials.length;
    const receivedCount = this.materials.filter(m => m.isReceived).length;
    const pendingCount = this.materials.filter(m => !m.isReceived).length;
    
    console.log(`📊 Thống kê materials:`);
    console.log(`  - Tổng: ${beforeCount}`);
    console.log(`  - Đã nhận: ${receivedCount}`);
    console.log(`  - Chưa nhận: ${pendingCount}`);
    console.log(`  - Khung thời gian: ${this.startDate && this.endDate ? `${this.startDate} đến ${this.endDate}` : 'Không có'}`);
    console.log(`  - Tìm kiếm: ${this.searchTerm || 'Không có'}`);
    console.log(`  - Loại tìm kiếm: ${this.searchType}`);
    
    // Log mô tả bộ lọc
    let filterDescription = '';
    switch (status) {
      case 'received':
        filterDescription = 'Chỉ hiển thị các mã hàng đã được tick "đã nhận"';
        break;
      case 'pending':
        filterDescription = 'Chỉ hiển thị các mã hàng chưa được tick "đã nhận"';
        break;
      case 'all':
        filterDescription = 'Hiển thị tất cả mã hàng (đã nhận và chưa nhận)';
        break;
      default:
        filterDescription = 'Chỉ hiển thị các mã hàng chưa được tick "đã nhận"';
    }
    console.log(`📝 Mô tả bộ lọc: ${filterDescription}`);
    
    // Log thông tin về số lượng materials sau khi lọc
    console.log(`📊 Thống kê materials sau khi lọc:`);
    console.log(`  - Bộ lọc: ${status}`);
    console.log(`  - Mô tả: ${filterDescription}`);
    console.log(`  - Số materials sẽ hiển thị: ${status === 'received' ? receivedCount : status === 'pending' ? pendingCount : beforeCount}`);
    
    // Log thông tin chi tiết về bộ lọc
    console.log(`📊 Chi tiết bộ lọc:`);
    console.log(`  - Bộ lọc trạng thái: ${status}`);
    console.log(`  - Mô tả bộ lọc: ${filterDescription}`);
    console.log(`  - Khung thời gian: ${this.startDate && this.endDate ? `${this.startDate} đến ${this.endDate}` : 'Không có'}`);
    console.log(`  - Tìm kiếm: ${this.searchTerm || 'Không có'}`);
    console.log(`  - Loại tìm kiếm: ${this.searchType}`);
    console.log(`  - Số materials sẽ hiển thị: ${status === 'received' ? receivedCount : status === 'pending' ? pendingCount : beforeCount}`);
    console.log(`  - Số materials sẽ bị ẩn: ${status === 'received' ? pendingCount : status === 'pending' ? receivedCount : 0}`);
    
    this.applyFilters();
  }
  
  changeSortBy(sortBy: string): void {
    this.sortBy = sortBy;
    console.log(`🔄 Thay đổi sắp xếp: ${sortBy}`);
    
    // Log mô tả sắp xếp
    let sortDescription = '';
    switch (sortBy) {
      case 'importDate':
        sortDescription = 'Sắp xếp theo ngày nhập (cũ nhất trước)';
        break;
      case 'batchNumber':
        sortDescription = 'Sắp xếp theo lô hàng (A-Z)';
        break;
      case 'materialCode':
        sortDescription = 'Sắp xếp theo mã hàng (A-Z)';
        break;
      case 'createdAt':
        sortDescription = 'Sắp xếp theo thời gian tạo (cũ nhất trước)';
        break;
      default:
        sortDescription = 'Sắp xếp theo ngày nhập (cũ nhất trước)';
    }
    console.log(`📝 Mô tả sắp xếp: ${sortDescription}`);
    
    this.applyFilters();
  }
  
  // Import functionality
  importFile(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,.xls,.csv';
    fileInput.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.onFileSelect(file);
      }
    };
    fileInput.click();
  }
  
  importFileFromPopup(): void {
    // Close popup first
    this.closeMorePopup();
    
    // Wait a bit for popup to close, then open file dialog
    setTimeout(() => {
      this.importFile();
    }, 100);
  }
  
  onFileSelect(file: File): void {
    // Basic file validation
    if (!file) return;
    
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ];
    
    if (!allowedTypes.includes(file.type)) {
      alert('❌ Chỉ hỗ trợ file Excel (.xlsx, .xls) hoặc CSV');
      return;
    }
    
    console.log('📁 File selected:', file.name);
    
    // Show loading state
    this.isLoading = true;
    this.errorMessage = 'Đang import dữ liệu...';
    
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        if (jsonData.length < 2) {
          alert('❌ File không có dữ liệu hoặc format không đúng');
          this.isLoading = false;
          this.errorMessage = '';
          return;
        }
        
        // Get headers from first row
        const headers = jsonData[0] as string[];
        console.log('📋 Headers found:', headers);
        
        // Process data rows (skip header row)
        const materialsToAdd: InboundMaterial[] = [];
        const skippedRows: {row: number, reason: string}[] = [];
        
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i] as any[];
          if (row.length === 0 || !row.some(cell => cell !== null && cell !== undefined && cell !== '')) {
            continue; // Skip empty rows
          }
          
          try {
            const material = this.parseExcelRow(row, headers);
            if (material) {
              materialsToAdd.push(material);
            } else {
              // Check why material was skipped
              const lotNumber = row[0] ? String(row[0]).trim() : '';
              const materialCode = row[1] ? String(row[1]).trim() : '';
              const poNumber = row[2] ? String(row[2]).trim() : '';
              const quantity = row[3] ? Number(row[3]) : 0;
              
              let reason = '';
              if (!lotNumber) reason += 'Thiếu LÔ HÀNG/DNNK; ';
              if (!materialCode) reason += 'Thiếu MÃ HÀNG; ';
              if (!poNumber) reason += 'Thiếu SỐ P.O; ';
              if (quantity <= 0) reason += 'LƯỢNG NHẬP ≤ 0; ';
              
              skippedRows.push({
                row: i + 1,
                reason: reason.trim().replace(/; $/, '')
              });
            }
          } catch (error) {
            console.warn(`⚠️ Skipping row ${i + 1}:`, error);
            skippedRows.push({
              row: i + 1,
              reason: `Lỗi parse: ${error.message}`
            });
          }
        }
        
        if (materialsToAdd.length === 0) {
          alert('❌ Không có dữ liệu hợp lệ để import');
          this.isLoading = false;
          this.errorMessage = '';
          return;
        }
        
    // Reset batch counter cho lần import mới
    this.batchCounter = 1;
    
    console.log(`📦 Found ${materialsToAdd.length} materials to import`);
    console.log(`⚠️ Skipped ${skippedRows.length} rows:`, skippedRows);
        console.log(`📊 Tổng dòng trong file: ${jsonData.length - 1} (trừ header)`);
        console.log(`📊 Dòng được xử lý: ${materialsToAdd.length + skippedRows.length}`);
        console.log(`📊 Dòng bị bỏ qua (empty): ${(jsonData.length - 1) - (materialsToAdd.length + skippedRows.length)}`);
        
        // Show detailed import results
        let message = `📊 Kết quả import:\n`;
        message += `📂 File có: ${jsonData.length - 1} dòng (trừ header)\n`;
        message += `✅ Parse thành công: ${materialsToAdd.length} materials\n`;
        
        // Log chi tiết materials được import
        console.log(`📋 Materials được import:`, materialsToAdd.map(m => `${m.materialCode} (batch: ${m.internalBatch})`));
        console.log(`📋 Materials được import (chi tiết):`, materialsToAdd.map(m => ({
          materialCode: m.materialCode,
          batchNumber: m.batchNumber,
          internalBatch: m.internalBatch,
          isReceived: m.isReceived,
          importDate: m.importDate,
          importDateString: m.importDate ? (typeof m.importDate === 'string' ? m.importDate : m.importDate.toLocaleDateString('vi-VN')) : 'N/A',
          importDateISO: m.importDate.toISOString()
        })));
        
        if (skippedRows.length > 0) {
          message += `⚠️ Bỏ qua: ${skippedRows.length} dòng\n\n`;
          message += `📋 Chi tiết dòng bị bỏ qua:\n`;
          skippedRows.forEach(skip => {
            message += `• Dòng ${skip.row}: ${skip.reason}\n`;
          });
        }
        
        // Check tổng số dòng
        const totalFileRows = jsonData.length - 1; // Trừ header
        const processedRows = materialsToAdd.length + skippedRows.length;
        const emptyRows = totalFileRows - processedRows;
        
        if (emptyRows > 0) {
          message += `\n📊 Thống kê:\n`;
          message += `• Tổng dòng trong file: ${totalFileRows}\n`;
          message += `• Dòng được xử lý: ${processedRows}\n`;
          message += `• Dòng trống/bỏ qua: ${emptyRows}\n`;
        }
        
        // Log chi tiết materials sẽ được import
        console.log(`📋 Danh sách materials sẽ import:`);
        materialsToAdd.forEach((material, index) => {
          console.log(`  ${index + 1}. ${material.materialCode} - ${material.batchNumber} - ${material.poNumber} - Qty: ${material.quantity}`);
        });
        
        // Add materials to Firebase
        this.addMaterialsToFirebase(materialsToAdd, skippedRows);
        
      } catch (error) {
        console.error('❌ Error processing file:', error);
        alert(`❌ Lỗi xử lý file: ${error.message}`);
        this.isLoading = false;
        this.errorMessage = '';
      }
    };
    
    reader.onerror = () => {
      alert('❌ Lỗi đọc file');
      this.isLoading = false;
      this.errorMessage = '';
    };
    
    reader.readAsArrayBuffer(file);
  }
  
  private parseExcelRow(row: any[], headers: string[]): InboundMaterial | null {
    try {
      const getValue = (index: number): string => {
        return row[index] ? String(row[index]).trim() : '';
      };
      
      const getNumberValue = (index: number): number => {
        const value = row[index];
        if (value === null || value === undefined || value === '') return 0;
        
        // Convert to string first
        let valueStr = String(value).trim();
        if (!valueStr) return 0;
        
        // Replace comma with dot for decimal separator (handle Vietnamese format like "35,64")
        valueStr = valueStr.replace(/,/g, '.');
        
        // Remove any non-numeric characters except decimal point and negative sign
        valueStr = valueStr.replace(/[^\d.-]/g, '');
        
        // Parse as number
        const num = parseFloat(valueStr);
        return isNaN(num) ? 0 : num;
      };

      // Map columns from template (now supports 10 columns)
      const lotNumber = getValue(0);         // LÔ HÀNG/ DNNK
      const materialCode = getValue(1);      // MÃ HÀNG
      const poNumber = getValue(2);          // SỐ P.O
      const quantity = getNumberValue(3);    // LƯỢNG NHẬP (allows decimal numbers)
      const type = getValue(4);              // LOẠI HÌNH
      const supplier = getValue(5);          // NHÀ CUNG CẤP
      const location = getValue(6) || 'IQC'; // VỊ TRÍ (default: IQC)
      const expiryDateStr = getValue(7);     // HSD (dd/mm/yyyy)
      const rollsOrBags = getNumberValue(8); // LƯỢNG ĐƠN VỊ
      const remarks = getValue(9);           // LƯU Ý

      if (!lotNumber || !materialCode || !poNumber || quantity <= 0) {
        // Log materials bị skip với thông tin chi tiết
        const missing = [];
        if (!lotNumber) missing.push('LÔ HÀNG/DNNK');
        if (!materialCode) missing.push('MÃ HÀNG');
        if (!poNumber) missing.push('SỐ P.O');
        if (quantity <= 0) missing.push('LƯỢNG NHẬP');
        console.warn(`⚠️ SKIPPED: ${materialCode || '(không có mã)'} - Missing: ${missing.join(', ')}`);
        return null;
      }

      // Parse expiry date from dd/mm/yyyy format
      let expiryDate: Date | null = null;
      if (expiryDateStr) {
        try {
          const [day, month, year] = expiryDateStr.split('/');
          if (day && month && year) {
            expiryDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
          }
        } catch (error) {
          console.warn('Invalid expiry date format:', expiryDateStr);
        }
      }

      // Tạo internal batch tự động
      const internalBatch = this.generateInternalBatch();
      
      return {
        id: '',
        factory: 'ASM1', // Auto-filled
        importDate: new Date(), // Auto-filled
        internalBatch: internalBatch, // Auto-generated batch (tuần + số thứ tự)
        batchNumber: lotNumber, // Lô hàng từ file import
        materialCode: materialCode,
        poNumber: poNumber,
        quantity: quantity,
        unit: '', // No default value - leave empty
        location: location, // From import or default IQC
        type: type || 'Raw Material', // From import or default
        expiryDate: expiryDate, // Parsed from import
        qualityCheck: false, // Default value
        isReceived: false, // Default value - Mặc định luôn là chờ kiểm tra
        notes: '', // Default value
        rollsOrBags: rollsOrBags || 0.00, // From import or default
        supplier: supplier, // From import
        remarks: remarks || '', // From import or default
        hasQRGenerated: false, // Default value
        createdAt: new Date(),
        updatedAt: new Date()
      };
    } catch (error) {
      console.error('Error parsing row:', error);
      return null;
    }
  }
  
  private addNewMaterialsToList(newMaterials: InboundMaterial[]): void {
    console.log(`➕ Adding ${newMaterials.length} new materials to current list...`);
    
    // Add new materials to the beginning of the list (newest first)
    this.materials = [...newMaterials, ...this.materials];
    
    // Apply current filters to update filteredMaterials
    this.applyFilters();
    
    console.log(`✅ Added new materials. Total materials: ${this.materials.length}, Filtered: ${this.filteredMaterials.length}`);
  }
  
  private async addMaterialsToFirebase(materials: InboundMaterial[], skippedRows?: {row: number, reason: string}[]): Promise<void> {
    try {
      let successCount = 0;
      let errorCount = 0;
      let duplicateCount = 0;
      
      // Log để debug tại sao thiếu materials
      console.log(`🚀 Starting Firebase import for ${materials.length} materials`);
      console.log(`📋 Materials to save:`, materials.map(m => `${m.materialCode}-${m.batchNumber}-${m.poNumber}`));
      
      // Store materials that were actually saved for verification
      const savedMaterials: string[] = [];
      
      // Use batch operations for better performance
      const batchSize = 500; // Firestore batch limit
      
      for (let i = 0; i < materials.length; i += batchSize) {
        const batch = this.firestore.firestore.batch();
        const batchMaterials = materials.slice(i, i + batchSize);
        
        batchMaterials.forEach((material, index) => {
          const docRef = this.firestore.collection('inbound-materials').doc().ref;
          console.log(`📝 Adding material ${index + 1}/${batchMaterials.length}: ${material.materialCode} (${material.internalBatch}) to batch`);
          batch.set(docRef, material);
        });
        
        try {
          console.log(`💾 Committing batch ${Math.floor(i / batchSize) + 1} with ${batchMaterials.length} materials...`);
          await batch.commit();
          successCount += batchMaterials.length;
          console.log(`✅ Batch ${Math.floor(i / batchSize) + 1} completed: ${batchMaterials.length} materials`);
          
          // Log chi tiết materials đã lưu thành công
          batchMaterials.forEach((material, index) => {
            const materialKey = `${material.materialCode}-${material.batchNumber}-${material.poNumber}`;
            savedMaterials.push(materialKey);
            console.log(`  ✅ Saved: ${materialKey}`);
          });
        } catch (error) {
          console.error(`❌ Batch ${Math.floor(i / batchSize) + 1} failed:`, error);
          errorCount += batchMaterials.length;
          
          // Log chi tiết materials bị lỗi
          batchMaterials.forEach((material, index) => {
            console.log(`  ❌ Failed: ${material.materialCode} - ${material.batchNumber} - ${material.poNumber}`);
          });
        }
      }
      
      // Verification removed - no more popups
      
      // Show results
      if (successCount > 0) {
        let message = `📊 KẾT QUẢ CUỐI CÙNG:\n`;
        message += `📂 File gốc: ${materials.length} materials\n`;
        message += `✅ Lưu thành công: ${successCount} materials\n`;
        message += `❌ Lưu thất bại: ${errorCount} materials\n`;
        
        // Log chi tiết materials được lưu
        console.log(`💾 Materials đã lưu vào Firebase:`, savedMaterials);
        console.log(`📤 Materials gửi lên Firebase:`, materials.map(m => `${m.materialCode}-${m.internalBatch}`));
        
        if (materials.length !== successCount) {
          const missingCount = materials.length - successCount;
          message += `\n⚠️ BỊ MẤT: ${missingCount} materials!\n`;
          
          // Tìm materials bị mất
          const savedMaterialCodes = savedMaterials.map(sm => {
            const parts = sm.split('-');
            return parts[0]; // materialCode
          });
          
          const sentMaterialCodes = materials.map(m => m.materialCode);
          const missingMaterials = sentMaterialCodes.filter(code => !savedMaterialCodes.includes(code));
          
          if (missingMaterials.length > 0) {
            message += `💀 Materials bị mất: ${missingMaterials.join(', ')}\n`;
            console.log(`💀 Materials bị mất chi tiết:`, missingMaterials);
          }
        }
        
        if (skippedRows && skippedRows.length > 0) {
          message += `\n⚠️ ${skippedRows.length} dòng bị bỏ qua (thiếu thông tin bắt buộc)`;
        }
        
        console.log(`📊 Final import summary:`);
        console.log(`  - Materials gửi lên Firebase: ${materials.length}`);
        console.log(`  - Materials lưu thành công: ${successCount}`);
        console.log(`  - Materials bị lỗi: ${errorCount}`);
        console.log(`  - Dòng bị skip (thiếu data): ${skippedRows ? skippedRows.length : 0}`);
        
        alert(message);
        
        // Add new materials to current list instead of reloading all
        console.log(`➕ Adding new materials to current list...`);
        this.addNewMaterialsToList(materials);
      } else {
        alert(`❌ Import thất bại: ${errorCount} materials bị lỗi`);
      }
      
    } catch (error) {
      console.error('❌ Error adding materials to Firebase:', error);
      alert(`❌ Lỗi import: ${error.message}`);
    } finally {
      this.isLoading = false;
      this.errorMessage = '';
    }
  }
  
  // Material update methods
  updateMaterial(material: InboundMaterial): void {
    if (!this.canEditMaterials) return;
    
    // Allow updates even if material is received (since it's already in inventory)
    // But show a warning that the material is already in inventory
    if (material.isReceived) {
      console.log(`⚠️ Updating material ${material.materialCode} that is already in inventory`);
    }
    
    material.updatedAt = new Date();
    
    this.firestore.collection('inbound-materials').doc(material.id).update({
      batchNumber: material.batchNumber,
      materialCode: material.materialCode,
      poNumber: material.poNumber,
      quantity: material.quantity,
      unit: material.unit,
      location: material.location,
      type: material.type,
      expiryDate: material.expiryDate,
      qualityCheck: material.qualityCheck,
      isReceived: material.isReceived,
      notes: material.notes,
      rollsOrBags: material.rollsOrBags,
      supplier: material.supplier,
      unitWeight: material.unitWeight || null,
      remarks: material.remarks,
      updatedAt: material.updatedAt
    }).then(() => {
      console.log(`✅ Material ${material.materialCode} updated successfully`);
      if (material.isReceived) {
        console.log(`ℹ️ Note: ${material.materialCode} is already in inventory, changes here won't affect inventory data`);
      }
    }).catch((error) => {
      console.error(`❌ Error updating material ${material.materialCode}:`, error);
      this.errorMessage = `Lỗi cập nhật ${material.materialCode}: ${error.message}`;
    });
  }
  
  deleteMaterial(material: InboundMaterial): void {
    if (!this.canDeleteMaterials) return;
    
    // Allow deletion even if material is received (since it's already in inventory)
    // But show a warning that the material is already in inventory
    if (material.isReceived) {
      const confirmed = confirm(
        `⚠️ CẢNH BÁO: Material ${material.materialCode} đã được đưa vào Inventory!\n\n` +
        `Việc xóa ở đây sẽ:\n` +
        `• Xóa material khỏi tab Inbound\n` +
        `• KHÔNG ảnh hưởng đến dữ liệu trong Inventory\n` +
        `• Material vẫn tồn tại trong Inventory với trạng thái đã nhận\n\n` +
        `Bạn có chắc muốn xóa material này khỏi tab Inbound?`
      );
      
      if (!confirmed) return;
      
      console.log(`⚠️ Deleting material ${material.materialCode} that is already in inventory`);
    } else {
      if (!confirm(`Bạn có chắc muốn xóa material ${material.materialCode}?`)) {
        return;
      }
    }
    
    this.firestore.collection('inbound-materials').doc(material.id).delete()
      .then(() => {
        console.log(`✅ Material ${material.materialCode} deleted successfully from Inbound`);
        if (material.isReceived) {
          console.log(`ℹ️ Note: ${material.materialCode} remains in inventory with received status`);
        }
        this.loadMaterials(); // Reload the list
      }).catch((error) => {
        console.error(`❌ Error deleting material ${material.materialCode}:`, error);
        this.errorMessage = `Lỗi xóa ${material.materialCode}: ${error.message}`;
      });
  }
  
  // Delete all materials from inbound tab
  deleteAllMaterials(): void {
    if (!this.canDeleteMaterials) {
      this.errorMessage = 'Bạn không có quyền xóa materials';
      return;
    }
    
    const totalCount = this.materials.length;
    if (totalCount === 0) {
      alert('Không có dữ liệu nào để xóa');
      return;
    }
    
    // Check if there are materials already in inventory
    const materialsInInventory = this.materials.filter(m => m.isReceived);
    const materialsNotInInventory = this.materials.filter(m => !m.isReceived);
    
    let warningMessage = `⚠️ CẢNH BÁO: Bạn có chắc chắn muốn xóa TẤT CẢ ${totalCount} materials trong tab Inbound ASM1?\n\n`;
    
    if (materialsInInventory.length > 0) {
      const materialCodes = materialsInInventory.map(m => m.materialCode).join(', ');
      warningMessage += `📦 ${materialsInInventory.length} materials đã trong Inventory: ${materialCodes}\n`;
      warningMessage += `• Việc xóa ở đây sẽ KHÔNG ảnh hưởng đến dữ liệu trong Inventory\n`;
      warningMessage += `• Materials vẫn tồn tại trong Inventory với trạng thái đã nhận\n\n`;
    }
    
    if (materialsNotInInventory.length > 0) {
      warningMessage += `📋 ${materialsNotInInventory.length} materials chưa trong Inventory\n`;
      warningMessage += `• Sẽ bị xóa hoàn toàn khỏi hệ thống\n\n`;
    }
    
    warningMessage += `Hành động này sẽ xóa:\n`;
    warningMessage += `• Tất cả materials đã hoàn thành\n`;
    warningMessage += `• Tất cả materials chưa hoàn thành\n`;
    warningMessage += `• Không thể hoàn tác!\n\n`;
    warningMessage += `Nhập "DELETE" để xác nhận:`;
    
    const confirmed = confirm(warningMessage);
    
    if (!confirmed) return;
    
    // Show loading state
    this.isLoading = true;
    this.errorMessage = '';
    
    // Get all material IDs
    const materialIds = this.materials.map(m => m.id).filter(id => id);
    
    if (materialIds.length === 0) {
      this.isLoading = false;
      alert('Không có materials nào để xóa');
      return;
    }
    
    // Delete all materials in batches
    const batchSize = 500; // Firestore batch limit
    const batches = [];
    
    for (let i = 0; i < materialIds.length; i += batchSize) {
      const batch = this.firestore.firestore.batch();
      const batchIds = materialIds.slice(i, i + batchSize);
      
      batchIds.forEach(id => {
        const docRef = this.firestore.collection('inbound-materials').doc(id).ref;
        batch.delete(docRef);
      });
      
      batches.push(batch);
    }
    
    // Execute all batches
    const deletePromises = batches.map(batch => batch.commit());
    
    Promise.all(deletePromises)
      .then(() => {
        console.log(`✅ Successfully deleted ${materialIds.length} materials from Inbound ASM1`);
        if (materialsInInventory.length > 0) {
          console.log(`ℹ️ Note: ${materialsInInventory.length} materials remain in inventory with received status`);
        }
        
        this.materials = [];
        this.filteredMaterials = [];
        this.isLoading = false;
        
        // Show success message
        let successMessage = `✅ Đã xóa thành công ${materialIds.length} materials từ tab Inbound ASM1`;
        if (materialsInInventory.length > 0) {
          successMessage += `\n\n📦 ${materialsInInventory.length} materials đã trong Inventory vẫn tồn tại và không bị ảnh hưởng`;
        }
        alert(successMessage);
        
        // Close dropdown
        this.showMorePopup = false;
        
        // Reload materials to refresh the view
        this.loadMaterials();
      })
      .catch((error) => {
        console.error('❌ Error deleting all materials:', error);
        this.errorMessage = `Lỗi xóa tất cả materials: ${error.message}`;
        this.isLoading = false;
        
        alert(`❌ Lỗi xóa materials: ${error.message}`);
      });
  }
  
  async printQRCode(material: InboundMaterial): Promise<void> {
    if (!this.canGenerateQR) {
      alert('Bạn không có quyền tạo QR code');
      return;
    }

    if (!material.rollsOrBags || material.rollsOrBags <= 0) {
      alert('Vui lòng nhập lượng đơn vị trước khi tạo QR code!');
      return;
    }

    try {
      // Calculate quantity per roll/bag
      const rollsOrBags = parseFloat(material.rollsOrBags.toString()) || 1;
      const totalQuantity = material.quantity;
      
      // Calculate how many full units we can make
      const fullUnits = Math.floor(totalQuantity / rollsOrBags);
      const remainingQuantity = totalQuantity % rollsOrBags;
      
              // Generate QR codes based on quantity per unit
        // QR code format: Mã hàng|PO|Số đơn vị|Ngày nhập (DD/MM/YYYY)
        const qrCodes = [];
      
      // Add full units
      // Chuyển ngày thành batch number: 26/08/2025 -> 26082025
      const batchNumber = material.importDate ? (typeof material.importDate === 'string' ? material.importDate : material.importDate.toLocaleDateString('en-GB').split('/').join('')) : new Date().toLocaleDateString('en-GB').split('/').join('');
      
      for (let i = 0; i < fullUnits; i++) {
        qrCodes.push({
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          unitNumber: rollsOrBags,
          qrData: `${material.materialCode}|${material.poNumber}|${rollsOrBags}|${batchNumber}`
        });
      }
      
      // Add remaining quantity if any
      if (remainingQuantity > 0) {
        qrCodes.push({
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          unitNumber: remainingQuantity,
          qrData: `${material.materialCode}|${material.poNumber}|${remainingQuantity}|${batchNumber}`
        });
      }

      if (qrCodes.length === 0) {
        alert('Vui lòng nhập số đơn vị trước khi tạo QR code!');
        return;
      }

      // Get current user info
      const user = await this.afAuth.currentUser;
      const currentUser = user ? user.email || user.uid : 'UNKNOWN';
      const printDate = new Date().toLocaleDateString('vi-VN');
      const totalPages = qrCodes.length;
      
      // Generate QR code images
      const qrImages = await Promise.all(
        qrCodes.map(async (qr, index) => {
          const qrData = qr.qrData;
          const qrImage = await QRCode.toDataURL(qrData, {
            width: 240, // 30mm = 240px (8px/mm)
            margin: 1,
            color: {
              dark: '#000000',
              light: '#FFFFFF'
            }
          });
          return {
            ...qr,
            qrImage,
            index: index + 1,
            pageNumber: index + 1,
            totalPages: totalPages,
            printDate: printDate,
            printedBy: currentUser
          };
        })
      );

      // Create print window with real QR codes
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        newWindow.document.write(`
          <html>
            <head>
              <title></title>
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
                
                .info-row.small.page-number {
                  font-size: 10.08px !important; /* Tăng thêm 20% từ 8.4px */
                  color: #000000 !important; /* Màu đen */
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
                  
                  .info-row.small.page-number {
                    font-size: 10.08px !important; /* Tăng thêm 20% từ 8.4px */
                    color: #000000 !important; /* Màu đen */
                  }
                  
                  .qr-grid {
                    gap: 0 !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    width: 57mm !important;
                    height: 32mm !important;
                  }
                  
                  /* Hide all browser elements */
                  @media screen {
                    body::before,
                    body::after,
                    header,
                    footer,
                    nav,
                    .browser-ui {
                      display: none !important;
                    }
                  }
                </style>
              </head>
              <body>
                <div class="qr-grid">
                  ${qrImages.map(qr => `
                    <div class="qr-container">
                      <div class="qr-section">
                        <img src="${qr.qrImage}" class="qr-image" alt="QR Code ${qr.index}">
                      </div>
                      <div class="info-section">
                        <div>
                          <div class="info-row">Mã: ${qr.materialCode}</div>
                          <div class="info-row">PO: ${qr.poNumber}</div>
                          <div class="info-row">Ngày: ${qr.qrData.split('|')[3]}</div>
                          <div class="info-row">Số ĐV: ${qr.unitNumber}</div>
                        </div>
                        <div>
                          <div class="info-row small">Ngày in: ${qr.printDate}</div>
                          <div class="info-row small">NV: ${qr.printedBy}</div>
                          <div class="info-row small page-number">Số: ${qr.pageNumber}/${qr.totalPages}</div>
                        </div>
                      </div>
                    </div>
                  `).join('')}
                </div>
                <script>
                  window.onload = function() {
                    // Remove all browser UI elements
                    document.title = '';
                    
                    // Hide browser elements
                    const style = document.createElement('style');
                    style.textContent = '@media print { body { margin: 0 !important; padding: 0 !important; width: 57mm !important; height: 32mm !important; } @page { margin: 0 !important; size: 57mm 32mm !important; padding: 0 !important; } body::before, body::after, header, footer, nav, .browser-ui { display: none !important; } }';
                    document.head.appendChild(style);
                    
                    // Remove any browser elements
                    const elementsToRemove = document.querySelectorAll('header, footer, nav, .browser-ui');
                    elementsToRemove.forEach(el => el.remove());
                    
                    setTimeout(() => {
                      window.print();
                    }, 500);
                  }
                </script>
              </body>
            </html>
          `);
        newWindow.document.close();
      }
    } catch (error) {
      console.error('Error generating QR codes:', error);
      alert('Có lỗi khi tạo QR codes. Vui lòng thử lại.');
    }
  }

  getPrintableMaterialsCount(): number {
    return this.filteredMaterials.filter(m => 
      m.rollsOrBags && m.rollsOrBags > 0
    ).length;
  }

  async printAllQRCodes(): Promise<void> {
    if (!this.canGenerateQR) {
      alert('Bạn không có quyền tạo QR code');
      return;
    }

    // Lọc các materials có thể in (có rollsOrBags > 0)
    const printableMaterials = this.filteredMaterials.filter(m => 
      m.rollsOrBags && m.rollsOrBags > 0
    );

    if (printableMaterials.length === 0) {
      alert('Không có material nào có thể in QR code! Vui lòng nhập lượng đơn vị trước.');
      return;
    }

    // Xác nhận trước khi in
    const confirmMessage = `Bạn muốn in tất cả QR codes?\n\nSố lượng materials: ${printableMaterials.length}\n\nBạn có chắc chắn muốn tiếp tục?`;
    if (!confirm(confirmMessage)) {
      return;
    }

    try {
      // Thu thập tất cả QR codes từ tất cả materials
      const allQRCodes: Array<{
        materialCode: string;
        poNumber: string;
        unitNumber: number;
        qrData: string;
        batchNumber: string;
      }> = [];

      for (const material of printableMaterials) {
        const rollsOrBags = parseFloat(material.rollsOrBags.toString()) || 1;
        const totalQuantity = material.quantity;
        
        const fullUnits = Math.floor(totalQuantity / rollsOrBags);
        const remainingQuantity = totalQuantity % rollsOrBags;
        
        const batchNumber = material.importDate ? 
          (typeof material.importDate === 'string' ? material.importDate : material.importDate.toLocaleDateString('en-GB').split('/').join('')) : 
          new Date().toLocaleDateString('en-GB').split('/').join('');
        
        // Thêm full units
        for (let i = 0; i < fullUnits; i++) {
          allQRCodes.push({
            materialCode: material.materialCode,
            poNumber: material.poNumber,
            unitNumber: rollsOrBags,
            qrData: `${material.materialCode}|${material.poNumber}|${rollsOrBags}|${batchNumber}`,
            batchNumber: batchNumber
          });
        }
        
        // Thêm remaining quantity nếu có
        if (remainingQuantity > 0) {
          allQRCodes.push({
            materialCode: material.materialCode,
            poNumber: material.poNumber,
            unitNumber: remainingQuantity,
            qrData: `${material.materialCode}|${material.poNumber}|${remainingQuantity}|${batchNumber}`,
            batchNumber: batchNumber
          });
        }
      }

      if (allQRCodes.length === 0) {
        alert('Không có QR code nào để in!');
        return;
      }

      // Get current user info
      const user = await this.afAuth.currentUser;
      const currentUser = user ? user.email || user.uid : 'UNKNOWN';
      const printDate = new Date().toLocaleDateString('vi-VN');
      const totalPages = allQRCodes.length;
      
      // Generate QR code images
      const qrImages = await Promise.all(
        allQRCodes.map(async (qr, index) => {
          const qrData = qr.qrData;
          const qrImage = await QRCode.toDataURL(qrData, {
            width: 240, // 30mm = 240px (8px/mm)
            margin: 1,
            color: {
              dark: '#000000',
              light: '#FFFFFF'
            }
          });
          return {
            ...qr,
            qrImage,
            index: index + 1,
            pageNumber: index + 1,
            totalPages: totalPages,
            printDate: printDate,
            printedBy: currentUser
          };
        })
      );

      // Create print window with all QR codes
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        newWindow.document.write(`
          <html>
            <head>
              <title>In tất cả QR codes</title>
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
                  font-size: 9.6px !important;
                  line-height: 1.1 !important;
                  box-sizing: border-box !important;
                  color: #000000 !important;
                }
                
                .info-row {
                  margin: 0.3mm 0 !important;
                  font-weight: bold !important;
                  color: #000000 !important;
                }
                
                .info-row.small {
                  font-size: 8.4px !important;
                  color: #000000 !important;
                }
                
                .info-row.small.page-number {
                  font-size: 10.08px !important;
                  color: #000000 !important;
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
                    font-size: 9.6px !important;
                    padding: 1mm !important;
                    color: #000000 !important;
                  }
                  
                  .info-row.small {
                    font-size: 8.4px !important;
                    color: #000000 !important;
                  }
                  
                  .info-row.small.page-number {
                    font-size: 10.08px !important;
                    color: #000000 !important;
                  }
                  
                  .qr-grid {
                    gap: 0 !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    width: 57mm !important;
                    height: 32mm !important;
                  }
                  
                  @media screen {
                    body::before,
                    body::after,
                    header,
                    footer,
                    nav,
                    .browser-ui {
                      display: none !important;
                    }
                  }
                }
              </style>
            </head>
            <body>
              <div class="qr-grid">
                ${qrImages.map(qr => `
                  <div class="qr-container">
                    <div class="qr-section">
                      <img src="${qr.qrImage}" class="qr-image" alt="QR Code ${qr.index}">
                    </div>
                    <div class="info-section">
                      <div>
                        <div class="info-row">Mã: ${qr.materialCode}</div>
                        <div class="info-row">PO: ${qr.poNumber}</div>
                        <div class="info-row">Ngày: ${qr.batchNumber}</div>
                        <div class="info-row">Số ĐV: ${qr.unitNumber}</div>
                      </div>
                      <div>
                        <div class="info-row small">Ngày in: ${qr.printDate}</div>
                        <div class="info-row small">NV: ${qr.printedBy}</div>
                        <div class="info-row small page-number">Số: ${qr.pageNumber}/${qr.totalPages}</div>
                      </div>
                    </div>
                  </div>
                `).join('')}
              </div>
              <script>
                window.onload = function() {
                  document.title = '';
                  
                  const style = document.createElement('style');
                  style.textContent = '@media print { body { margin: 0 !important; padding: 0 !important; width: 57mm !important; height: 32mm !important; } @page { margin: 0 !important; size: 57mm 32mm !important; padding: 0 !important; } body::before, body::after, header, footer, nav, .browser-ui { display: none !important; } }';
                  document.head.appendChild(style);
                  
                  const elementsToRemove = document.querySelectorAll('header, footer, nav, .browser-ui');
                  elementsToRemove.forEach(el => el.remove());
                  
                  setTimeout(() => {
                    window.print();
                  }, 500);
                }
              </script>
            </body>
          </html>
        `);
        newWindow.document.close();
        
        console.log(`✅ Đã tạo ${allQRCodes.length} QR codes để in`);
        alert(`✅ Đã tạo ${allQRCodes.length} QR codes để in từ ${printableMaterials.length} materials!\n\nCửa sổ in sẽ tự động mở.`);
      }
    } catch (error) {
      console.error('Error generating all QR codes:', error);
      alert('Có lỗi khi tạo QR codes. Vui lòng thử lại.');
    }
  }
  
  // Additional functionality methods
  importFromExcel(): void {
    // Trigger file input for Excel import
    this.importFile();
  }
  
  addMaterial(): void {
    if (!this.canAddMaterials) {
      alert('❌ Bạn không có quyền thêm material mới');
      return;
    }
    
    // Create a new empty material
    const newMaterial: InboundMaterial = {
      factory: 'ASM1',
      importDate: new Date(),
      batchNumber: '',
      materialCode: '',
      poNumber: '',
      quantity: 0.00,
      unit: '',
      location: '',
      type: '',
      expiryDate: null,
      qualityCheck: false,
      isReceived: false,
      notes: '',
      rollsOrBags: 0.00,
      supplier: '',
      remarks: '',
      hasQRGenerated: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Add to Firebase
    this.firestore.collection('inbound-materials').add(newMaterial)
      .then((docRef) => {
        newMaterial.id = docRef.id;
        console.log(`✅ New ASM1 material added with ID: ${docRef.id}`);
        
        // Add to local array and refresh
        this.materials.unshift(newMaterial);
        this.applyFilters();
        
        alert('✅ Material mới đã được thêm thành công!');
      })
      .catch((error) => {
        console.error('❌ Error adding new material:', error);
        this.errorMessage = 'Lỗi thêm material mới: ' + error.message;
        alert('❌ Lỗi thêm material mới: ' + error.message);
      });
  }
  
  // Export functionality
  exportToExcel(): void {
    if (!this.canExportData) return;
    
    try {
      console.log('📊 Exporting ASM1 inbound data to Excel...');
      
      // Optimize data for smaller file size
      const exportData = this.filteredMaterials.map(material => ({
        'Factory': material.factory || 'ASM1',
        'Date': material.importDate ? (typeof material.importDate === 'string' ? material.importDate : material.importDate.toLocaleDateString('vi-VN', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit'
        })) : 'N/A',
        'Batch': material.batchNumber || '',
        'Material': material.materialCode || '',
        'PO': material.poNumber || '',
        'Qty': Number(material.quantity || 0).toFixed(2),
        'Unit': material.unit || '',
        'Location': material.location || '',
        'Type': material.type || '',
        'Expiry': material.expiryDate?.toLocaleDateString('vi-VN', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit'
        }) || '',
        'QC': material.qualityCheck ? 'Yes' : 'No',
        'Received': material.isReceived ? 'Yes' : 'No',
        'QR': material.hasQRGenerated ? 'Yes' : 'No'
      }));
      
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      
      // Set column widths for better readability
      const colWidths = [
        { wch: 8 },   // Factory
        { wch: 10 },  // Date
        { wch: 12 },  // Batch
        { wch: 15 },  // Material
        { wch: 12 },  // PO
        { wch: 8 },   // Qty
        { wch: 6 },   // Unit
        { wch: 12 },  // Location
        { wch: 8 },   // Type
        { wch: 10 },  // Expiry
        { wch: 6 },   // QC
        { wch: 8 },   // Received
        { wch: 6 }    // QR
      ];
      worksheet['!cols'] = colWidths;
      
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'ASM1_Inbound');
      
      const fileName = `ASM1_Inbound_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      
      console.log('✅ ASM1 data exported to Excel');
      console.log(`📊 Thống kê export:`);
      console.log(`  - Bộ lọc hiện tại: ${this.statusFilter}`);
      console.log(`  - Số records xuất: ${exportData.length}`);
      console.log(`  - Tổng materials: ${this.materials.length}`);
      console.log(`  - Materials đã nhận: ${this.materials.filter(m => m.isReceived).length}`);
      console.log(`  - Materials chưa nhận: ${this.materials.filter(m => !m.isReceived).length}`);
      
      let statusText = '';
      let description = '';
      switch (this.statusFilter) {
        case 'received':
          statusText = 'Đã Nhận';
          description = 'Chỉ các mã hàng đã được tick "đã nhận"';
          break;
        case 'pending':
          statusText = 'Chưa Nhận';
          description = 'Chỉ các mã hàng chưa được tick "đã nhận"';
          break;
        case 'all':
          statusText = 'Toàn Bộ';
          description = 'Tất cả mã hàng (đã nhận và chưa nhận)';
          break;
        default:
          statusText = 'Chưa Nhận';
          description = 'Chỉ các mã hàng chưa được tick "đã nhận"';
      }
      
      // Log thông tin về export
      console.log(`📊 Thông tin export:`);
      console.log(`  - Bộ lọc trạng thái: ${this.statusFilter}`);
      console.log(`  - Mô tả bộ lọc: ${description}`);
      console.log(`  - Khung thời gian: ${this.startDate && this.endDate ? `${this.startDate} đến ${this.endDate}` : 'Không có'}`);
      console.log(`  - Tìm kiếm: ${this.searchTerm || 'Không có'}`);
      console.log(`  - Loại tìm kiếm: ${this.searchType}`);
      console.log(`  - Số records xuất: ${exportData.length}`);
      console.log(`  - Tổng materials: ${this.materials.length}`);
      console.log(`  - Materials đã nhận: ${this.materials.filter(m => m.isReceived).length}`);
      console.log(`  - Materials chưa nhận: ${this.materials.filter(m => !m.isReceived).length}`);
      
      // Tạo thông tin chi tiết về export
      let timeRangeInfo = '';
      if (this.startDate && this.endDate) {
        const start = new Date(this.startDate);
        const end = new Date(this.endDate);
        const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        timeRangeInfo = `\n📅 Khung thời gian: ${this.startDate} đến ${this.endDate} (${daysDiff} ngày)`;
      }
      
      let searchInfo = '';
      if (this.searchTerm) {
        searchInfo = `\n🔍 Tìm kiếm: ${this.searchTerm} (${this.searchType})`;
      }
      
      alert(`✅ Đã xuất ${exportData.length} records ra file Excel\n📊 Bộ lọc: ${statusText}\n📝 Mô tả: ${description}${timeRangeInfo}${searchInfo}`);
      
    } catch (error) {
      console.error('❌ Export error:', error);
      this.errorMessage = 'Lỗi export: ' + error.message;
      alert('Lỗi export: ' + error.message);
    }
  }
  
  // Download Excel template for import
  downloadTemplate(): void {
    const templateData = [
      ['LÔ HÀNG/ DNNK', 'MÃ HÀNG', 'SỐ P.O', 'LƯỢNG NHẬP', 'LOẠI HÌNH', 'NHÀ CUNG CẤP', 'VỊ TRÍ', 'HSD (dd/mm/yyyy)', 'LƯỢNG ĐƠN VỊ', 'LƯU Ý'],
      ['RM1-B001', 'RM1-MAT001', 'RM1-PO001', 100.5, 'Raw Material', 'Supplier A', 'IQC', '31/12/2025', 10.5, 'Ghi chú mẫu'],
      ['RM1-B002', 'RM1-MAT002', 'RM1-PO002', 50.25, 'Raw Material', 'Supplier B', 'IQC', '30/11/2025', 5.25, 'Ghi chú mẫu']
    ];
    
    const worksheet = XLSX.utils.aoa_to_sheet(templateData);
    
    // Set column widths
    const colWidths = [
      { wch: 18 },  // LÔ HÀNG/ DNNK
      { wch: 15 },  // MÃ HÀNG
      { wch: 12 },  // SỐ P.O
      { wch: 15 },  // LƯỢNG NHẬP
      { wch: 15 },  // LOẠI HÌNH
      { wch: 20 },  // NHÀ CUNG CẤP
      { wch: 12 },  // VỊ TRÍ
      { wch: 15 },  // HSD
      { wch: 15 },  // LƯỢNG ĐƠN VỊ
      { wch: 20 }   // LƯU Ý
    ];
    worksheet['!cols'] = colWidths;
    
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Template');
    
    XLSX.writeFile(workbook, 'ASM1_Import_Template.xlsx');
  }

  // Download Inbound Report - Lịch sử kiểm lô hàng
  downloadInboundReport(): void {
    try {
      console.log('📊 Tạo report lịch sử kiểm lô hàng...');
      
      // Tạo dữ liệu report
      const reportData = this.generateInboundReportData();
      
      if (reportData.length === 0) {
        alert('Không có dữ liệu để tạo report!');
        return;
      }
      
      // Tạo worksheet
      const worksheet = XLSX.utils.aoa_to_sheet(reportData);
      
      // Set column widths
      const colWidths = [
        { wch: 20 },  // NGÀY KIỂM
        { wch: 18 },  // LÔ HÀNG/DNNK
        { wch: 15 },  // MÃ HÀNG
        { wch: 15 },  // MSNV
        { wch: 20 },  // THỜI GIAN BẮT ĐẦU
        { wch: 20 },  // THỜI GIAN KẾT THÚC
        { wch: 15 },  // THỜI GIAN HOÀN THÀNH (phút)
        { wch: 15 },  // TRẠNG THÁI
        { wch: 20 },  // NHÀ CUNG CẤP
        { wch: 15 },  // SỐ LƯỢNG
        { wch: 20 }   // GHI CHÚ
      ];
      worksheet['!cols'] = colWidths;
      
      // Tạo workbook
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Inbound_Report');
      
      // Tạo tên file với timestamp
      const timestamp = new Date().toISOString().split('T')[0];
      const fileName = `ASM1_Inbound_Report_${timestamp}.xlsx`;
      
      // Download file
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Inbound_Report');
      
      // Download file
      XLSX.writeFile(workbook, fileName);
      
      console.log('✅ Report đã được tải xuống:', fileName);
      alert(`Report đã được tải xuống: ${fileName}`);
      
    } catch (error: any) {
      console.error('❌ Lỗi tạo report:', error);
      this.errorMessage = 'Lỗi tạo report: ' + error.message;
      alert('Lỗi tạo report: ' + error.message);
    }
  }



  // Tạo dữ liệu cho report
  private generateInboundReportData(): (string | number)[][] {
    // Header của report
    const headers = [
      'NGÀY KIỂM',
      'LÔ HÀNG/DNNK', 
      'MÃ HÀNG',
      'MSNV',
      'THỜI GIAN BẮT ĐẦU',
      'THỜI GIAN KẾT THÚC',
      'THỜI GIAN HOÀN THÀNH (phút)',
      'TRẠNG THÁI',
      'NHÀ CUNG CẤP',
      'SỐ LƯỢNG',
      'GHI CHÚ'
    ];
    
    const reportData: (string | number)[][] = [headers];
    
    // Debug: Log số lượng materials
    console.log('🔍 Debug generateInboundReportData:');
    console.log('Tổng materials:', this.materials.length);
    console.log('Filtered materials:', this.filteredMaterials.length);
    
    // Lọc materials có thông tin batch
    const materialsWithBatch = this.materials.filter(material => 
      material.batchNumber && 
      material.batchNumber.trim() !== '' &&
      (material.batchStartTime || material.batchEndTime || material.employeeIds)
    );
    
    console.log('Materials có batch info:', materialsWithBatch.length);
    
    // Nếu không có materials với batch info, tạo report từ tất cả materials
    if (materialsWithBatch.length === 0) {
      console.log('⚠️ Không có materials với batch info, tạo report từ tất cả materials');
      
      this.materials.forEach(material => {
        const row = [
          this.formatDate(material.importDate),
          material.batchNumber || 'N/A',
          material.materialCode,
          material.employeeIds ? material.employeeIds.join(', ') : 'N/A',
          material.batchStartTime ? this.formatDateTime(material.batchStartTime) : 'N/A',
          material.batchEndTime ? this.formatDateTime(material.batchEndTime) : 'N/A',
          (material.batchStartTime && material.batchEndTime) ? 
            Math.round((material.batchEndTime.getTime() - material.batchStartTime.getTime()) / (1000 * 60)) + ' phút' : 'N/A',
          this.getStatusText(material),
          material.supplier || 'N/A',
          Number(material.quantity || 0).toFixed(2),
          material.remarks || 'N/A'
        ];
        
        reportData.push(row);
      });
    } else {
      // Nhóm materials theo batch
      const batchGroups = this.groupMaterialsByBatch(materialsWithBatch);
      
      // Tạo dữ liệu cho từng batch
      batchGroups.forEach(batchGroup => {
        const batchNumber = batchGroup.batchNumber;
        const batchMaterials = batchGroup.materials;
        const batchStartTime = batchGroup.batchStartTime;
        const batchEndTime = batchGroup.batchEndTime;
        const employeeIds = batchGroup.employeeIds;
        
        // Tính thời gian hoàn thành
        let duration = 0;
        if (batchStartTime && batchEndTime) {
          duration = Math.round((batchEndTime.getTime() - batchStartTime.getTime()) / (1000 * 60));
        }
        
        // Tạo dòng cho từng material trong batch
        batchMaterials.forEach(material => {
          const row = [
            this.formatDate(material.importDate),
            batchNumber,
            material.materialCode,
            employeeIds ? employeeIds.join(', ') : 'N/A',
            batchStartTime ? this.formatDateTime(batchStartTime) : 'N/A',
            batchEndTime ? this.formatDateTime(batchEndTime) : 'N/A',
            duration > 0 ? duration : 'N/A',
            this.getStatusText(material),
            material.supplier || 'N/A',
            Number(material.quantity || 0).toFixed(2),
            material.remarks || 'N/A'
          ];
          
          reportData.push(row);
        });
      });
    }
    
    console.log('📊 Dữ liệu report được tạo:', reportData.length - 1, 'dòng');
    return reportData;
  }

  // Nhóm materials theo batch
  private groupMaterialsByBatch(materials: InboundMaterial[]): any[] {
    const batchGroups: { [key: string]: any } = {};
    
    materials.forEach(material => {
      const batchKey = material.batchNumber;
      
      if (!batchGroups[batchKey]) {
        batchGroups[batchKey] = {
          batchNumber: batchKey,
          materials: [],
          batchStartTime: material.batchStartTime,
          batchEndTime: material.batchEndTime,
          employeeIds: material.employeeIds
        };
      }
      
      batchGroups[batchKey].materials.push(material);
      
      // Cập nhật thời gian batch nếu có
      if (material.batchStartTime && (!batchGroups[batchKey].batchStartTime || 
          material.batchStartTime < batchGroups[batchKey].batchStartTime)) {
        batchGroups[batchKey].batchStartTime = material.batchStartTime;
      }
      
      if (material.batchEndTime && (!batchGroups[batchKey].batchEndTime || 
          material.batchEndTime > batchGroups[batchKey].batchEndTime)) {
        batchGroups[batchKey].batchEndTime = material.batchEndTime;
      }
      
      // Cập nhật employee IDs
      if (material.employeeIds && material.employeeIds.length > 0) {
        if (!batchGroups[batchKey].employeeIds) {
          batchGroups[batchKey].employeeIds = [];
        }
        material.employeeIds.forEach(id => {
          if (!batchGroups[batchKey].employeeIds.includes(id)) {
            batchGroups[batchKey].employeeIds.push(id);
          }
        });
      }
    });
    
    return Object.values(batchGroups);
  }
  
  // Utility methods
  formatDate(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleDateString('vi-VN');
  }
  
  formatDateTime(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleString('vi-VN');
  }
  
  // Format number with commas for thousands
  formatNumber(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '0';
    }
    
    return value.toLocaleString('vi-VN');
  }
  
  getStatusBadgeClass(material: InboundMaterial): string {
    if (material.isReceived) {
      if (material.qualityCheck) {
        return 'badge-success'; // Đã kiểm tra & Nhận
      } else {
        return 'badge-warning'; // Đã nhận
      }
    } else {
      if (material.qualityCheck) {
        return 'badge-info'; // Đã kiểm tra
      } else {
        return 'badge-secondary'; // Chờ kiểm tra
      }
    }
  }
  
  getStatusText(material: InboundMaterial): string {
    if (material.isReceived) {
      if (material.qualityCheck) {
        return 'Đã kiểm tra & Nhận';
      } else {
        return 'Đã nhận';
      }
    } else {
      if (material.qualityCheck) {
        return 'Đã kiểm tra';
      } else {
        return 'Chờ kiểm tra';
      }
    }
  }
  
  // Physical Scanner methods (copy from outbound)
  activatePhysicalScanner(): void {
    console.log('🔌 Activating physical scanner input...');
    this.isScannerInputActive = !this.isScannerInputActive;
    
    if (this.isScannerInputActive) {
      this.scannerBuffer = '';
      this.focusEmployeeScanner();
      console.log('✅ Physical scanner activated - Ready to receive input');
    } else {
      console.log('⏹️ Physical scanner deactivated');
    }
  }
  
  // Batch processing methods
  canStartBatch(): boolean {
    const canStart = this.currentEmployeeIds.length > 0 && this.currentBatchNumber.trim() !== '';
    console.log('🔍 Kiểm tra canStartBatch:', {
      employeeCount: this.currentEmployeeIds.length,
      batchNumber: this.currentBatchNumber,
      batchNumberTrimmed: this.currentBatchNumber.trim(),
      canStart: canStart
    });
    return canStart;
  }
  
  startBatchProcessing(): void {
    console.log('🚀 Gọi startBatchProcessing()');
    console.log('📊 Kiểm tra điều kiện:', {
      currentEmployeeIds: this.currentEmployeeIds,
      currentBatchNumber: this.currentBatchNumber,
      canStartBatch: this.canStartBatch()
    });
    
    if (!this.canStartBatch()) {
      console.log('❌ Không thể bắt đầu batch - điều kiện không đủ');
      return;
    }
    
    this.isBatchActive = true;
    this.batchStartTime = new Date();
    this.showBatchModal = false;
    
    // Update all materials in the current batch
    this.updateBatchMaterials();
    
    console.log(`🚀 Bắt đầu kiểm lô hàng: ${this.currentBatchNumber} với ${this.currentEmployeeIds.length} nhân viên`);
    console.log('✅ Batch đã được kích hoạt:', {
      isBatchActive: this.isBatchActive,
      batchStartTime: this.batchStartTime,
      showBatchModal: this.showBatchModal
    });
  }
  
  stopBatchProcessing(): void {
    if (!this.isBatchActive) return;
    
    this.isBatchActive = false;
    this.batchStartTime = null;
    this.currentBatchNumber = '';
    this.currentEmployeeIds = [];
    
    console.log('⏹️ Dừng kiểm lô hàng');
  }
  
  private updateBatchMaterials(): void {
    const batchMaterials = this.materials.filter(m => m.batchNumber === this.currentBatchNumber);
    
    batchMaterials.forEach(material => {
      material.batchStatus = 'active';
      material.batchStartTime = this.batchStartTime;
      material.employeeIds = [...this.currentEmployeeIds];
      
      // Update in Firebase
      this.firestore.collection('inbound-materials').doc(material.id).update({
        batchStatus: 'active',
        batchStartTime: this.batchStartTime,
        employeeIds: this.currentEmployeeIds
      });
    });
  }
  
  onEmployeeScannerKeydown(event: KeyboardEvent): void {
    const input = event.target as HTMLInputElement;
    
    // Record scan start time on first character
    if (input.value.length === 0) {
      this.scanStartTime = Date.now();
    }
    
    // Clear existing timeout
    if (this.scannerTimeout) {
      clearTimeout(this.scannerTimeout);
    }
    
    // Handle Enter key (most scanners send Enter after scanning)
    if (event.key === 'Enter') {
      event.preventDefault();
      this.processEmployeeScannerInput(input.value);
      return;
    }
    
    // Set timeout to auto-process if no more input (for scanners without Enter)
    this.scannerTimeout = setTimeout(() => {
      if (input.value.trim().length > 5) { // Minimum barcode length
        const scanDuration = Date.now() - this.scanStartTime;
        // If input was typed very fast (< 500ms), likely from scanner
        if (scanDuration < 500) {
          this.processEmployeeScannerInput(input.value);
        }
      }
    }, 300);
  }
  
  private processEmployeeScannerInput(scannedData: string): void {
    if (!scannedData.trim()) return;
    
    console.log('🔌 Physical scanner input received:', scannedData);
    console.log('🔌 Input length:', scannedData.length);
    console.log('🔌 Input characters:', scannedData.split('').map(c => c.charCodeAt(0)));
    
    // Clear the input
    this.scannedEmployeeId = '';
    const inputElement = document.querySelector('.scanner-input') as HTMLInputElement;
    if (inputElement) {
      inputElement.value = '';
    }
    
    // Process the scanned employee ID
    this.addEmployee(scannedData);
    
    // Auto-focus for next scan
    setTimeout(() => {
      this.focusEmployeeScanner();
    }, 100);
  }
  
  addEmployee(employeeId: string): void {
    // Extract first 7 characters
    const shortId = employeeId.substring(0, 7);
    
    if (!this.currentEmployeeIds.includes(shortId)) {
      this.currentEmployeeIds.push(shortId);
      console.log(`✅ Thêm nhân viên: ${shortId}`);
      console.log('📊 Danh sách nhân viên hiện tại:', this.currentEmployeeIds);
    } else {
      console.log(`⚠️ Nhân viên ${shortId} đã tồn tại`);
    }
  }
  
  removeEmployee(employeeId: string): void {
    const index = this.currentEmployeeIds.indexOf(employeeId);
    if (index > -1) {
      this.currentEmployeeIds.splice(index, 1);
      console.log(`❌ Xóa nhân viên: ${employeeId}`);
    }
  }
  
  focusEmployeeScanner(): void {
    // Focus on employee scanner input
    setTimeout(() => {
      const input = document.querySelector('.scanner-input') as HTMLInputElement;
      if (input) {
        input.focus();
        input.select(); // Select all text for easy replacement
        console.log('🎯 Focus vào ô input scanner - sẵn sàng quét mã nhân viên');
      }
    }, 100);
  }
  
  closeBatchModal(): void {
    this.showBatchModal = false;
    this.isBatchScanningMode = false; // Reset the new input interface
    console.log('🔒 Modal đã đóng');
  }
  
  openBatchModal(): void {
    this.showBatchModal = true;
    this.isBatchScanningMode = true; // Enable the new input interface
    console.log('🚀 Mở modal batch processing với giao diện input trực tiếp');
    console.log('📊 Trạng thái hiện tại:', {
      isBatchActive: this.isBatchActive,
      currentEmployeeIds: this.currentEmployeeIds,
      currentBatchNumber: this.currentBatchNumber,
      showBatchModal: this.showBatchModal,
      isBatchScanningMode: this.isBatchScanningMode
    });
  }
  
  canEditInBatch(material: InboundMaterial): boolean {
    // Allow editing if we have a selected batch and material belongs to it
    if (this.currentBatchNumber && material.batchNumber === this.currentBatchNumber) {
      return true;
    }
    // Also allow if batch is active (for backward compatibility)
    if (this.isBatchActive && material.batchNumber === this.currentBatchNumber) {
      return true;
    }
    return false;
  }
  
  getEmployeeDisplay(material: InboundMaterial): string {
    if (material.employeeIds && material.employeeIds.length > 0) {
      // Show first employee in UI, but log all
      return material.employeeIds[0];
    }
    return '';
  }
  
  getTimeDisplay(material: InboundMaterial): string {
    if (material.batchStartTime && material.batchEndTime) {
      const duration = Math.round((material.batchEndTime.getTime() - material.batchStartTime.getTime()) / (1000 * 60));
      return `${duration} phút`;
    }
    return '';
  }
  
  getBatchDuration(): number {
    if (!this.batchStartTime) return 0;
    const now = new Date();
    return Math.round((now.getTime() - this.batchStartTime.getTime()) / (1000 * 60));
  }
  
  // Method getCompleteButtonTitle đã được xóa vì không còn cần thiết
  
  getQualityCheckTitle(material: InboundMaterial): string {
    if (material.isReceived) return 'Không thể sửa - đã trong Inventory';
    if (!this.canEditInBatch(material)) return 'Chỉ có thể sửa trong lô hàng đang kiểm';
    return 'Kiểm tra chất lượng';
  }
  
  getReceivedTitle(material: InboundMaterial): string {
    if (material.isReceived) return 'Đã nhận - không thể thay đổi';
    if (!this.canEditInBatch(material)) return 'Chỉ có thể sửa trong lô hàng đang kiểm';
    return 'Đánh dấu đã nhận';
  }
  
  // Override onReceivedChange to handle batch completion
  onReceivedChange(event: any, material: InboundMaterial): void {
    const startTime = Date.now();
    console.log(`🔄 Bắt đầu xử lý onReceivedChange...`);
    console.log(`  - Material: ${material.materialCode}`);
    console.log(`  - Lô hàng: ${material.batchNumber}`);
    console.log(`  - Thời gian bắt đầu: ${new Date().toLocaleString('vi-VN')}`);
    console.log(`  - Timestamp bắt đầu: ${startTime}`);
    
    const target = event.target as HTMLInputElement;
    const isReceived = target.checked;
    
    console.log(`🔄 onReceivedChange được gọi cho ${material.materialCode}`);
    console.log(`  - Event target checked: ${isReceived}`);
    console.log(`  - Material: ${material.materialCode}`);
    console.log(`  - Lô hàng: ${material.batchNumber}`);
    console.log(`  - Trạng thái hiện tại: isReceived = ${material.isReceived}`);
    
    // Only allow ticking (true), not unticking (false)
    if (!isReceived) {
      const endTime = Date.now();
      const duration = endTime - startTime;
      console.log(`❌ Không thể untick trạng thái "đã nhận" cho ${material.materialCode}`);
      console.log(`  - Lý do: Chỉ cho phép tick (true), không cho phép untick (false)`);
      console.log(`  - Material: ${material.materialCode}`);
      console.log(`  - Lô hàng: ${material.batchNumber}`);
      console.log(`  - Kết thúc xử lý do validation thất bại`);
      console.log(`  - Thời gian xử lý: ${duration}ms`);
      return;
    }
    
    // 🔧 SỬA LỖI: Kiểm tra xem đã tick rồi chưa để tránh duplicate
    if (material.isReceived) {
      console.log(`⚠️ Material ${material.materialCode} đã được tick "đã nhận" rồi, bỏ qua`);
      return;
    }
    
    console.log(`🔄 Đang tick "đã nhận" cho ${material.materialCode} trong lô hàng ${material.batchNumber}`);
    console.log(`📊 Thông tin material:`, {
      materialCode: material.materialCode,
      poNumber: material.poNumber,
      importDate: material.importDate,
      batchNumber: material.batchNumber
    });
    console.log(`  - Trạng thái trước: isReceived = ${material.isReceived}`);
    console.log(`  - Trạng thái sau: isReceived = ${isReceived}`);
    console.log(`  - Thời gian cập nhật: ${new Date().toLocaleString('vi-VN')}`);
    console.log(`  - Bắt đầu cập nhật trạng thái local...`);
    
    // Update local state first
    material.isReceived = isReceived;
    material.updatedAt = new Date();
    
    console.log(`✅ Đã cập nhật trạng thái local cho ${material.materialCode}`);
    console.log(`  - isReceived: ${material.isReceived}`);
    console.log(`  - updatedAt: ${material.updatedAt.toLocaleString('vi-VN')}`);
    
    // Save to Firebase first to ensure persistence
      console.log(`💾 Đang lưu trạng thái vào Firebase: ${material.materialCode}`);
      console.log(`  - Collection: inbound-materials`);
      console.log(`  - Document ID: ${material.id}`);
      console.log(`  - isReceived: ${isReceived}`);
      console.log(`  - updatedAt: ${material.updatedAt.toLocaleString('vi-VN')}`);
      console.log(`  - Bắt đầu gọi Firebase update...`);
      
    this.firestore.collection('inbound-materials').doc(material.id).update({
      isReceived: isReceived,
      updatedAt: material.updatedAt
    }).then(() => {
      console.log(`✅ Received status saved to Firebase for ${material.materialCode}`);
        console.log(`  - Firebase update thành công`);
        console.log(`  - Bắt đầu xử lý tiếp theo...`);
      
      // Now add to Inventory
      console.log(`📦 Thêm material vào Inventory: ${material.materialCode}`);
      console.log(`  - Lô hàng: ${material.batchNumber}`);
      console.log(`  - Nhà cung cấp: ${material.supplier || 'Không có'}`);
      console.log(`  - Số lượng: ${material.quantity} ${material.unit}`);
      console.log(`  - Bắt đầu gọi addToInventory...`);
      this.addToInventory(material);
      console.log(`✅ Đã gọi addToInventory cho ${material.materialCode}`);
      
      // Check batch completion only if we're in an active batch and this material belongs to it
      if (this.currentBatchNumber && material.batchNumber === this.currentBatchNumber) {
        console.log(`🔍 Kiểm tra hoàn thành lô hàng sau khi tick ${material.materialCode}`);
        console.log(`  - Lô hàng hiện tại: ${this.currentBatchNumber}`);
        console.log(`  - Material thuộc lô hàng: ${material.batchNumber}`);
        console.log(`  - Bắt đầu gọi checkBatchCompletion...`);
        this.checkBatchCompletion();
        console.log(`✅ Đã gọi checkBatchCompletion cho lô hàng ${this.currentBatchNumber}`);
      } else {
        console.log(`ℹ️ Không kiểm tra hoàn thành lô hàng - material không thuộc lô hàng hiện tại`);
        console.log(`  - Lô hàng hiện tại: ${this.currentBatchNumber || 'Không có'}`);
        console.log(`  - Material thuộc lô hàng: ${material.batchNumber || 'Không có'}`);
        console.log(`  - Bỏ qua kiểm tra hoàn thành lô hàng`);
      }
      
      // Log thông tin về trạng thái sau khi cập nhật
      console.log(`📊 Trạng thái sau khi tick "đã nhận":`);
      console.log(`  - Material: ${material.materialCode}`);
      console.log(`  - isReceived: ${material.isReceived}`);
      console.log(`  - Bộ lọc trạng thái hiện tại: ${this.statusFilter}`);
      console.log(`  - Khung thời gian: ${this.startDate && this.endDate ? `${this.startDate} đến ${this.endDate}` : 'Không có'}`);
      console.log(`  - Tìm kiếm: ${this.searchTerm || 'Không có'}`);
      console.log(`  - Loại tìm kiếm: ${this.searchType}`);
      console.log(`  - Số materials đã nhận: ${this.materials.filter(m => m.isReceived).length}`);
      console.log(`  - Số materials chưa nhận: ${this.materials.filter(m => !m.isReceived).length}`);
      
      // Log thông tin tổng quan về materials
      console.log(`📊 Tổng quan materials sau khi cập nhật:`);
      console.log(`  - Tổng materials: ${this.materials.length}`);
      console.log(`  - Materials đã nhận: ${this.materials.filter(m => m.isReceived).length}`);
      console.log(`  - Materials chưa nhận: ${this.materials.filter(m => !m.isReceived).length}`);
      console.log(`  - Tỷ lệ đã nhận: ${Math.round((this.materials.filter(m => m.isReceived).length / this.materials.length) * 100)}%`);
      
      // Log thông tin về kết quả xử lý
      console.log(`✅ Hoàn thành xử lý tick "đã nhận" cho ${material.materialCode}`);
      console.log(`  - Material: ${material.materialCode}`);
      console.log(`  - Lô hàng: ${material.batchNumber}`);
      console.log(`  - Trạng thái cuối: isReceived = ${material.isReceived}`);
      console.log(`  - Thời gian cập nhật: ${material.updatedAt.toLocaleString('vi-VN')}`);
      
      // Log thông tin về kết thúc process
      const endTime = Date.now();
      const duration = endTime - startTime;
              console.log(`🎯 Kết thúc xử lý onReceivedChange thành công cho ${material.materialCode}`);
        console.log(`  - Material: ${material.materialCode}`);
        console.log(`  - Lô hàng: ${material.batchNumber}`);
        console.log(`  - Trạng thái cuối: isReceived = ${material.isReceived}`);
        console.log(`  - Thời gian kết thúc: ${new Date().toLocaleString('vi-VN')}`);
      console.log(`  - Timestamp kết thúc: ${endTime}`);
      console.log(`  - Tổng thời gian xử lý: ${duration}ms`);
      console.log(`  - Hiệu suất: ${duration < 1000 ? 'Tốt' : duration < 3000 ? 'Trung bình' : 'Chậm'}`);
      
      // Refresh display để cập nhật theo bộ lọc hiện tại
      console.log(`🔄 Đang refresh display sau khi cập nhật trạng thái...`);
      console.log(`  - Bộ lọc trạng thái: ${this.statusFilter}`);
      console.log(`  - Khung thời gian: ${this.startDate && this.endDate ? `${this.startDate} đến ${this.endDate}` : 'Không có'}`);
      console.log(`  - Tìm kiếm: ${this.searchTerm || 'Không có'}`);
      console.log(`  - Bắt đầu gọi applyFilters...`);
      this.applyFilters();
      console.log(`✅ Đã gọi applyFilters để refresh display`);
      
    }).catch((error) => {
        const endTime = Date.now();
        const duration = endTime - startTime;
      console.error(`❌ Error saving received status to Firebase:`, error);
        console.log(`🔄 Reverting local state due to Firebase error: ${material.materialCode}`);
        console.log(`  - Error message: ${error.message}`);
        console.log(`  - Error code: ${error.code || 'Không có'}`);
        console.log(`  - Error details: ${JSON.stringify(error)}`);
        console.log(`  - Bắt đầu revert trạng thái local...`);
        
      // Revert local state if Firebase update failed
      material.isReceived = false;
      target.checked = false;
        
        console.log(`✅ Đã revert trạng thái local cho ${material.materialCode}`);
        console.log(`  - isReceived: false (reverted)`);
        console.log(`  - target.checked: false (reverted)`);
        
      alert(`Lỗi khi cập nhật trạng thái: ${error.message}`);
        console.log(`📢 Đã hiển thị alert lỗi cho người dùng`);
        console.log(`❌ Kết thúc xử lý onReceivedChange với lỗi cho ${material.materialCode}`);
        console.log(`  - Thời gian xử lý: ${duration}ms`);
        console.log(`  - Hiệu suất: ${duration < 1000 ? 'Tốt' : duration < 3000 ? 'Trung bình' : 'Chậm'}`);
        console.log(`  - Đánh giá: ${duration < 1000 ? '🟢 Tốt' : duration < 3000 ? '🟡 Trung bình' : '🔴 Chậm'}`);
        
        // Log thông tin về kết thúc process với lỗi
        console.log(`🏁 Kết thúc hoàn toàn onReceivedChange với lỗi cho ${material.materialCode}`);
        console.log(`  - Material: ${material.materialCode}`);
        console.log(`  - Lô hàng: ${material.batchNumber}`);
        console.log(`  - Trạng thái cuối: isReceived = ${material.isReceived}`);
        console.log(`  - Thời gian xử lý: ${duration}ms`);
        console.log(`  - Kết quả: ❌ Thất bại`);
        console.log(`  - Lý do: ${error.message}`);
      });
      
      console.log(`✅ Hoàn thành xử lý onReceivedChange cho ${material.materialCode}`);
      console.log(`  - Material: ${material.materialCode}`);
      console.log(`  - Lô hàng: ${material.batchNumber}`);
      console.log(`  - Trạng thái cuối: isReceived = ${material.isReceived}`);
      console.log(`  - Thời gian kết thúc: ${new Date().toLocaleString('vi-VN')}`);
      console.log(`  - Tổng thời gian xử lý: ${Date.now() - startTime}ms`);
      console.log(`  - Hiệu suất: ${(Date.now() - startTime) < 1000 ? 'Tốt' : (Date.now() - startTime) < 3000 ? 'Trung bình' : 'Chậm'}`);
      
      // Log thông tin tổng quan về process
      console.log(`📊 Tổng quan process onReceivedChange:`);
      console.log(`  - Material: ${material.materialCode}`);
      console.log(`  - Lô hàng: ${material.batchNumber}`);
      console.log(`  - Trạng thái cuối: isReceived = ${material.isReceived}`);
      console.log(`  - Thời gian bắt đầu: ${new Date(startTime).toLocaleString('vi-VN')}`);
      console.log(`  - Thời gian kết thúc: ${new Date().toLocaleString('vi-VN')}`);
      console.log(`  - Tổng thời gian xử lý: ${Date.now() - startTime}ms`);
      console.log(`  - Hiệu suất: ${(Date.now() - startTime) < 1000 ? 'Tốt' : (Date.now() - startTime) < 3000 ? 'Trung bình' : 'Chậm'}`);
      
      // Log thông tin về kết quả cuối cùng
      console.log(`🎯 Kết quả cuối cùng của onReceivedChange:`);
      console.log(`  - Material: ${material.materialCode}`);
      console.log(`  - Lô hàng: ${material.batchNumber}`);
      console.log(`  - Trạng thái cuối: isReceived = ${material.isReceived}`);
      console.log(`  - Bộ lọc trạng thái: ${this.statusFilter}`);
      console.log(`  - Khung thời gian: ${this.startDate && this.endDate ? `${this.startDate} đến ${this.endDate}` : 'Không có'}`);
      console.log(`  - Tìm kiếm: ${this.searchTerm || 'Không có'}`);
      console.log(`  - Loại tìm kiếm: ${this.searchType}`);
      console.log(`  - Số materials đã nhận: ${this.materials.filter(m => m.isReceived).length}`);
      console.log(`  - Số materials chưa nhận: ${this.materials.filter(m => !m.isReceived).length}`);
      console.log(`  - Tổng materials: ${this.materials.length}`);
      console.log(`  - Tỷ lệ đã nhận: ${Math.round((this.materials.filter(m => m.isReceived).length / this.materials.length) * 100)}%`);
      
      // Log thông tin về performance
      console.log(`⚡ Performance của onReceivedChange:`);
      console.log(`  - Thời gian bắt đầu: ${new Date(startTime).toLocaleString('vi-VN')}`);
      console.log(`  - Thời gian kết thúc: ${new Date().toLocaleString('vi-VN')}`);
      console.log(`  - Tổng thời gian xử lý: ${Date.now() - startTime}ms`);
      console.log(`  - Hiệu suất: ${(Date.now() - startTime) < 1000 ? 'Tốt' : (Date.now() - startTime) < 3000 ? 'Trung bình' : 'Chậm'}`);
      console.log(`  - Đánh giá: ${(Date.now() - startTime) < 1000 ? '🟢 Tốt' : (Date.now() - startTime) < 3000 ? '🟡 Trung bình' : '🔴 Chậm'}`);
      
      // Log thông tin về kết thúc process
      console.log(`🏁 Kết thúc hoàn toàn onReceivedChange cho ${material.materialCode}`);
      console.log(`  - Material: ${material.materialCode}`);
      console.log(`  - Lô hàng: ${material.batchNumber}`);
      console.log(`  - Trạng thái cuối: isReceived = ${material.isReceived}`);
      console.log(`  - Thời gian xử lý: ${Date.now() - startTime}ms`);
      console.log(`  - Kết quả: ✅ Thành công`);
      
      // Log thông tin về summary
      console.log(`📋 Summary của onReceivedChange:`);
      console.log(`  - Material: ${material.materialCode}`);
      console.log(`  - Lô hàng: ${material.batchNumber}`);
      console.log(`  - Trạng thái cuối: isReceived = ${material.isReceived}`);
      console.log(`  - Thời gian xử lý: ${Date.now() - startTime}ms`);
      console.log(`  - Kết quả: ✅ Thành công`);
      console.log(`  - Bộ lọc trạng thái: ${this.statusFilter}`);
      console.log(`  - Khung thời gian: ${this.startDate && this.endDate ? `${this.startDate} đến ${this.endDate}` : 'Không có'}`);
      console.log(`  - Tìm kiếm: ${this.searchTerm || 'Không có'}`);
      console.log(`  - Loại tìm kiếm: ${this.searchType}`);
      console.log(`  - Số materials đã nhận: ${this.materials.filter(m => m.isReceived).length}`);
      console.log(`  - Số materials chưa nhận: ${this.materials.filter(m => !m.isReceived).length}`);
      console.log(`  - Tổng materials: ${this.materials.length}`);
      console.log(`  - Tỷ lệ đã nhận: ${Math.round((this.materials.filter(m => m.isReceived).length / this.materials.length) * 100)}%`);
      
      // Log thông tin về kết thúc process
      console.log(`🏁 Kết thúc hoàn toàn onReceivedChange cho ${material.materialCode}`);
      console.log(`  - Material: ${material.materialCode}`);
      console.log(`  - Lô hàng: ${material.batchNumber}`);
      console.log(`  - Trạng thái cuối: isReceived = ${material.isReceived}`);
      console.log(`  - Thời gian xử lý: ${Date.now() - startTime}ms`);
      console.log(`  - Kết quả: ✅ Thành công`);
      console.log(`  - Bộ lọc trạng thái: ${this.statusFilter}`);
      console.log(`  - Khung thời gian: ${this.startDate && this.endDate ? `${this.startDate} đến ${this.endDate}` : 'Không có'}`);
      console.log(`  - Tìm kiếm: ${this.searchTerm || 'Không có'}`);
      console.log(`  - Loại tìm kiếm: ${this.searchType}`);
      console.log(`  - Số materials đã nhận: ${this.materials.filter(m => m.isReceived).length}`);
      console.log(`  - Số materials chưa nhận: ${this.materials.filter(m => !m.isReceived).length}`);
      console.log(`  - Tổng materials: ${this.materials.length}`);
      console.log(`  - Tỷ lệ đã nhận: ${Math.round((this.materials.filter(m => m.isReceived).length / this.materials.length) * 100)}%`);
      
      // Log thông tin về kết thúc process
      console.log(`🏁 Kết thúc hoàn toàn onReceivedChange cho ${material.materialCode}`);
      console.log(`  - Material: ${material.materialCode}`);
      console.log(`  - Lô hàng: ${material.batchNumber}`);
      console.log(`  - Trạng thái cuối: isReceived = ${material.isReceived}`);
      console.log(`  - Thời gian xử lý: ${Date.now() - startTime}ms`);
      console.log(`  - Kết quả: ✅ Thành công`);
      console.log(`  - Bộ lọc trạng thái: ${this.statusFilter}`);
      console.log(`  - Khung thời gian: ${this.startDate && this.endDate ? `${this.startDate} đến ${this.endDate}` : 'Không có'}`);
      console.log(`  - Tìm kiếm: ${this.searchTerm || 'Không có'}`);
      console.log(`  - Loại tìm kiếm: ${this.searchType}`);
      console.log(`  - Số materials đã nhận: ${this.materials.filter(m => m.isReceived).length}`);
      console.log(`  - Số materials chưa nhận: ${this.materials.filter(m => !m.isReceived).length}`);
      console.log(`  - Tổng materials: ${this.materials.length}`);
      console.log(`  - Tỷ lệ đã nhận: ${Math.round((this.materials.filter(m => m.isReceived).length / this.materials.length) * 100)}%`);
  }
  
  private checkBatchCompletion(): void {
    console.log(`🔍 Bắt đầu kiểm tra hoàn thành lô hàng...`);
    console.log(`  - Lô hàng hiện tại: ${this.currentBatchNumber}`);
    console.log(`  - Bộ lọc trạng thái: ${this.statusFilter}`);
    console.log(`  - Khung thời gian: ${this.startDate && this.endDate ? `${this.startDate} đến ${this.endDate}` : 'Không có'}`);
    console.log(`  - Tìm kiếm: ${this.searchTerm || 'Không có'}`);
    console.log(`  - Loại tìm kiếm: ${this.searchType}`);
    
    // Lấy tất cả materials của lô hàng hiện tại
    const batchMaterials = this.materials.filter(m => m.batchNumber === this.currentBatchNumber);
    
    console.log(`🔍 Kiểm tra hoàn thành lô hàng ${this.currentBatchNumber}:`);
    console.log(`  - Lô hàng: ${this.currentBatchNumber}`);
    console.log(`  - Tổng materials trong lô: ${batchMaterials.length}`);
    console.log(`  - Materials đã nhận: ${batchMaterials.filter(m => m.isReceived).length}`);
    console.log(`  - Materials chưa nhận: ${batchMaterials.filter(m => !m.isReceived).length}`);
    console.log(`  - Bộ lọc trạng thái hiện tại: ${this.statusFilter}`);
    console.log(`  - Khung thời gian: ${this.startDate && this.endDate ? `${this.startDate} đến ${this.endDate}` : 'Không có'}`);
    console.log(`  - Tìm kiếm: ${this.searchTerm || 'Không có'}`);
    console.log(`  - Loại tìm kiếm: ${this.searchType}`);
    
    // Chỉ hoàn thành khi TẤT CẢ materials trong lô hàng đã được tick "đã nhận"
    const allReceived = batchMaterials.every(m => m.isReceived);
    
    console.log(`🔍 Logic kiểm tra hoàn thành:`);
    console.log(`  - Tất cả materials đã nhận: ${allReceived}`);
    console.log(`  - Số materials cần kiểm tra: ${batchMaterials.length}`);
    console.log(`  - Số materials đã nhận: ${batchMaterials.filter(m => m.isReceived).length}`);
    console.log(`  - Số materials chưa nhận: ${batchMaterials.filter(m => !m.isReceived).length}`);
    console.log(`  - Điều kiện hoàn thành: allReceived = ${allReceived} && batchMaterials.length > 0 = ${batchMaterials.length > 0}`);
    console.log(`  - Kết quả kiểm tra: ${allReceived && batchMaterials.length > 0}`);
    
    if (allReceived && batchMaterials.length > 0) {
      console.log(`🎉 Lô hàng ${this.currentBatchNumber} đã hoàn thành!`);
      console.log(`  - Tất cả materials đã được tick "đã nhận"`);
      console.log(`  - Bắt đầu xử lý hoàn thành lô hàng...`);
      
      // Tạo thông tin chi tiết về hoàn thành lô hàng
      console.log(`📝 Tạo thông tin chi tiết cho alert hoàn thành lô hàng...`);
      
      let timeRangeInfo = '';
      if (this.startDate && this.endDate) {
        const start = new Date(this.startDate);
        const end = new Date(this.endDate);
        const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        timeRangeInfo = `\n📅 Khung thời gian hiện tại: ${this.startDate} đến ${this.endDate} (${daysDiff} ngày)`;
        console.log(`  - Khung thời gian: ${this.startDate} đến ${this.endDate} (${daysDiff} ngày)`);
      } else {
        console.log(`  - Không có khung thời gian lọc`);
      }
      
      let filterInfo = '';
      switch (this.statusFilter) {
        case 'received':
          filterInfo = '\n🔍 Bộ lọc hiện tại: Đã Nhận (chỉ hiển thị materials đã nhận)';
          break;
        case 'pending':
          filterInfo = '\n🔍 Bộ lọc hiện tại: Chưa Nhận (materials đã nhận sẽ bị ẩn)';
          break;
        case 'all':
          filterInfo = '\n🔍 Bộ lọc hiện tại: Toàn Bộ (hiển thị tất cả materials)';
          break;
        default:
          filterInfo = '\n🔍 Bộ lọc hiện tại: Chưa Nhận (materials đã nhận sẽ bị ẩn)';
      }
      
      console.log(`  - Bộ lọc trạng thái: ${this.statusFilter}`);
      console.log(`  - Thông tin bộ lọc: ${filterInfo.replace('\n', '')}`);
      
      // Show completion message
      console.log(`📢 Hiển thị alert hoàn thành lô hàng...`);
      console.log(`  - Lô hàng: ${this.currentBatchNumber}`);
      console.log(`  - Tổng materials: ${batchMaterials.length}`);
      console.log(`  - Materials đã nhận: ${batchMaterials.length}`);
      
      alert(`🎉 Hoàn thành lô hàng ${this.currentBatchNumber}!\n\n📊 Thống kê:\n📦 Tổng materials: ${batchMaterials.length}\n✅ Đã nhận: ${batchMaterials.length}${timeRangeInfo}${filterInfo}\n\n💡 Lưu ý: Materials đã nhận sẽ được ẩn khỏi bảng khi bộ lọc là "Chưa"`);
      
      // Refresh the display để cập nhật theo bộ lọc hiện tại
      console.log(`🔄 Đang refresh display sau khi hoàn thành lô hàng...`);
      console.log(`  - Bộ lọc trạng thái: ${this.statusFilter}`);
      console.log(`  - Khung thời gian: ${this.startDate && this.endDate ? `${this.startDate} đến ${this.endDate}` : 'Không có'}`);
      console.log(`  - Tìm kiếm: ${this.searchTerm || 'Không có'}`);
      this.applyFilters();
      
      // Log thông tin về trạng thái sau khi hoàn thành lô hàng
      console.log(`📊 Trạng thái sau khi hoàn thành lô hàng ${this.currentBatchNumber}:`);
      console.log(`  - Bộ lọc trạng thái hiện tại: ${this.statusFilter}`);
      console.log(`  - Khung thời gian: ${this.startDate && this.endDate ? `${this.startDate} đến ${this.endDate}` : 'Không có'}`);
      console.log(`  - Tìm kiếm: ${this.searchTerm || 'Không có'}`);
      console.log(`  - Loại tìm kiếm: ${this.searchType}`);
      console.log(`  - Số materials đã nhận: ${batchMaterials.filter(m => m.isReceived).length}`);
      console.log(`  - Số materials chưa nhận: ${batchMaterials.filter(m => !m.isReceived).length}`);
      
      // Log mô tả bộ lọc
      let filterDescription = '';
      switch (this.statusFilter) {
        case 'received':
          filterDescription = 'Chỉ hiển thị các mã hàng đã được tick "đã nhận"';
          break;
        case 'pending':
          filterDescription = 'Chỉ hiển thị các mã hàng chưa được tick "đã nhận"';
          break;
        case 'all':
          filterDescription = 'Hiển thị tất cả mã hàng (đã nhận và chưa nhận)';
          break;
        default:
          filterDescription = 'Chỉ hiển thị các mã hàng chưa được tick "đã nhận"';
      }
      console.log(`📝 Mô tả bộ lọc: ${filterDescription}`);
      console.log(`  - Bộ lọc trạng thái: ${this.statusFilter}`);
      console.log(`  - Mô tả: ${filterDescription}`);
      
      // Log thông tin về số lượng materials sau khi hoàn thành lô hàng
      console.log(`📊 Thống kê materials sau khi hoàn thành lô hàng:`);
      console.log(`  - Bộ lọc trạng thái: ${this.statusFilter}`);
      console.log(`  - Mô tả bộ lọc: ${filterDescription}`);
      console.log(`  - Khung thời gian: ${this.startDate && this.endDate ? `${this.startDate} đến ${this.endDate}` : 'Không có'}`);
      console.log(`  - Tìm kiếm: ${this.searchTerm || 'Không có'}`);
      console.log(`  - Loại tìm kiếm: ${this.searchType}`);
      console.log(`  - Số materials sẽ hiển thị: ${this.statusFilter === 'received' ? batchMaterials.filter(m => m.isReceived).length : this.statusFilter === 'pending' ? batchMaterials.filter(m => !m.isReceived).length : batchMaterials.length}`);
      console.log(`  - Số materials sẽ bị ẩn: ${this.statusFilter === 'received' ? batchMaterials.filter(m => !m.isReceived).length : this.statusFilter === 'pending' ? batchMaterials.filter(m => m.isReceived).length : 0}`);
      
      // Log thông tin tổng quan về lô hàng
      console.log(`📊 Tổng quan lô hàng ${this.currentBatchNumber}:`);
      console.log(`  - Tổng materials: ${batchMaterials.length}`);
      console.log(`  - Materials đã nhận: ${batchMaterials.filter(m => m.isReceived).length}`);
      console.log(`  - Materials chưa nhận: ${batchMaterials.filter(m => !m.isReceived).length}`);
      console.log(`  - Tỷ lệ hoàn thành: ${Math.round((batchMaterials.filter(m => m.isReceived).length / batchMaterials.length) * 100)}%`);
      
      // Log thông tin về bộ lọc hiện tại
      console.log(`🔍 Thông tin bộ lọc hiện tại:`);
      console.log(`  - Bộ lọc trạng thái: ${this.statusFilter}`);
      console.log(`  - Khung thời gian: ${this.startDate && this.endDate ? `${this.startDate} đến ${this.endDate}` : 'Không có'}`);
      console.log(`  - Tìm kiếm: ${this.searchTerm || 'Không có'}`);
      console.log(`  - Loại tìm kiếm: ${this.searchType}`);
    } else {
      console.log(`⏳ Lô hàng ${this.currentBatchNumber} chưa hoàn thành: ${batchMaterials.filter(m => m.isReceived).length}/${batchMaterials.length}`);
        console.log(`  - Cần tick thêm ${batchMaterials.filter(m => !m.isReceived).length} materials nữa để hoàn thành lô hàng`);
        console.log(`  - Materials chưa nhận: ${batchMaterials.filter(m => !m.isReceived).map(m => m.materialCode).join(', ')}`);
        console.log(`  - Bộ lọc trạng thái hiện tại: ${this.statusFilter}`);
        console.log(`  - Khung thời gian: ${this.startDate && this.endDate ? `${this.startDate} đến ${this.endDate}` : 'Không có'}`);
        
                // Log thông tin tổng quan về lô hàng chưa hoàn thành
        console.log(`📊 Tổng quan lô hàng ${this.currentBatchNumber} (chưa hoàn thành):`);
        console.log(`  - Tổng materials: ${batchMaterials.length}`);
        console.log(`  - Materials đã nhận: ${batchMaterials.filter(m => m.isReceived).length}`);
        console.log(`  - Materials chưa nhận: ${batchMaterials.filter(m => !m.isReceived).length}`);
        console.log(`  - Tỷ lệ hoàn thành: ${Math.round((batchMaterials.filter(m => m.isReceived).length / batchMaterials.length) * 100)}%`);
      }
      
      console.log(`✅ Hoàn thành kiểm tra lô hàng ${this.currentBatchNumber}`);
      console.log(`  - Kết quả: ${allReceived ? 'Hoàn thành' : 'Chưa hoàn thành'}`);
      console.log(`  - Tổng materials: ${batchMaterials.length}`);
      console.log(`  - Materials đã nhận: ${batchMaterials.filter(m => m.isReceived).length}`);
      console.log(`  - Materials chưa nhận: ${batchMaterials.filter(m => !m.isReceived).length}`);
  }
  
  // Scanner Mode Methods
  startScannerMode(): void {
    console.log('🔍 Starting scanner mode...');
    this.isScannerInputActive = true;
    this.isCameraModeActive = false;
    this.scannerBuffer = '';
    this.focusScannerInput();
  }
  
  stopScannerMode(): void {
    console.log('🛑 Stopping scanner mode...');
    this.isScannerInputActive = false;
    this.scannerBuffer = '';
    if (this.scannerTimeout) {
      clearTimeout(this.scannerTimeout);
      this.scannerTimeout = null;
    }
  }
  
  onScannerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.processScannedData(this.scannerBuffer);
      this.scannerBuffer = '';
    }
  }
  
  onScannerInputBlur(): void {
    // Keep scanner active for a short time to allow for rapid scanning
    this.scannerTimeout = setTimeout(() => {
      if (this.scannerBuffer.trim()) {
        this.processScannedData(this.scannerBuffer);
        this.scannerBuffer = '';
      }
    }, 100);
  }
  
  private processScannedData(scannedData: string): void {
    if (!scannedData.trim()) return;
    
    console.log('🔍 Processing scanned data:', scannedData);
    
    // Process the scanned data based on format
    // This can be material code, batch number, or other identifiers
    if (scannedData.startsWith('KZLSX')) {
      // Production order format
      this.currentBatchNumber = scannedData;
      console.log('✅ Production order scanned:', scannedData);
    } else if (scannedData.startsWith('ASP')) {
      // Employee ID format
      if (!this.currentEmployeeIds.includes(scannedData)) {
        this.currentEmployeeIds.push(scannedData);
        console.log('✅ Employee ID scanned:', scannedData);
      }
    } else {
      // Material code or other format
      console.log('📦 Material code scanned:', scannedData);
      // You can add logic here to auto-fill material fields
    }
  }
  
  private focusScannerInput(): void {
    setTimeout(() => {
      const scannerInput = document.querySelector('.scanner-input-field') as HTMLInputElement;
      if (scannerInput) {
        scannerInput.focus();
      }
    }, 100);
  }
  
  // Camera Mode Methods
  startCameraMode(): void {
    console.log('📱 Starting camera mode...');
    this.isCameraModeActive = true;
    this.isScannerInputActive = false;
    this.initializeCameraScanner();
  }
  
  stopCameraMode(): void {
    console.log('🛑 Stopping camera mode...');
    this.isCameraModeActive = false;
    if (this.cameraScanner) {
      this.cameraScanner.stop();
      this.cameraScanner = null;
    }
  }
  
  private async initializeCameraScanner(): Promise<void> {
    try {
      // Import HTML5 QR Scanner dynamically
      const { Html5Qrcode } = await import('html5-qrcode');
      
      this.cameraScanner = new Html5Qrcode("qr-reader");
      
      const cameras = await Html5Qrcode.getCameras();
      if (cameras && cameras.length > 0) {
        await this.cameraScanner.start(
          { deviceId: cameras[0].id },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 }
          },
          (decodedText: string) => {
            this.onCameraScanSuccess(decodedText);
          },
          (errorMessage: string) => {
            // Ignore errors during scanning
          }
        );
        console.log('✅ Camera scanner started successfully');
      } else {
        throw new Error('No cameras found');
      }
    } catch (error) {
      console.error('❌ Error starting camera scanner:', error);
      alert('Không thể khởi động camera. Vui lòng kiểm tra quyền truy cập camera.');
      this.stopCameraMode();
    }
  }
  
  private onCameraScanSuccess(decodedText: string): void {
    console.log('📱 Camera scan success:', decodedText);
    this.processScannedData(decodedText);
    
    // Stop camera after successful scan
    this.stopCameraMode();
  }

  // Lưu mã nhân viên
  saveEmployeeCode(): void {
    if (this.employeeCode && this.employeeCode.trim()) {
      this.isEmployeeCodeSaved = true;
      console.log('✅ Mã nhân viên đã được lưu:', this.employeeCode);
      console.log('🔄 Bắt đầu load danh sách lô hàng...');
      this.loadAvailableBatches(); // Load danh sách lô hàng
    } else {
      console.log('❌ Mã nhân viên không hợp lệ:', this.employeeCode);
    }
  }

  // Load danh sách lô hàng/DNNK chưa nhận
  private async loadAvailableBatches(): Promise<void> {
    try {
      console.log('📦 Loading available batches...');
      console.log('🔍 Factory filter:', this.selectedFactory);
      
      // Query để lấy tất cả lô hàng chờ nhận
      const snapshot = await this.firestore.collection('inbound-materials', ref => 
        ref.where('factory', '==', this.selectedFactory)
           .where('isReceived', '==', false)
           .limit(1000) // Tăng limit để lấy nhiều hơn
      ).get().toPromise();

      console.log('📊 Raw snapshot:', snapshot);
      console.log('📊 Snapshot empty?', snapshot?.empty);

      if (snapshot && !snapshot.empty) {
        // Lấy tất cả lô hàng chờ nhận
        this.availableBatches = snapshot.docs.map(doc => {
          const data = doc.data() as any;
          return {
            batchNumber: data.batchNumber || '',
            materialCode: data.materialCode || '',
            importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : new Date()
          };
        }).sort((a, b) => b.importDate.getTime() - a.importDate.getTime()); // Sắp xếp theo ngày mới nhất
        
        console.log(`✅ Loaded ${this.availableBatches.length} available batches:`, this.availableBatches);
      } else {
        console.log('⚠️ No available batches found');
        this.availableBatches = [];
        
        // Thử load tất cả documents để debug
        console.log('🔍 Trying to load all documents for debugging...');
        const allSnapshot = await this.firestore.collection('inbound-materials').get().toPromise();
        if (allSnapshot && !allSnapshot.empty) {
          console.log(`📊 Total documents in collection: ${allSnapshot.docs.length}`);
          allSnapshot.docs.slice(0, 3).forEach((doc, index) => {
            const data = doc.data() as any;
            console.log(`📄 Sample doc ${index + 1}:`, {
              factory: data.factory,
              isReceived: data.isReceived,
              batchNumber: data.batchNumber,
              materialCode: data.materialCode
            });
          });
        }
      }
    } catch (error) {
      console.error('❌ Error loading available batches:', error);
      this.availableBatches = [];
    }
  }

  // Xử lý khi chọn lô hàng
  onBatchSelectionChange(): void {
    console.log('🔄 Batch selection changed:', this.selectedBatch);
    
    if (this.selectedBatch) {
      const selectedBatchData = this.availableBatches.find(batch => batch.batchNumber === this.selectedBatch);
      if (selectedBatchData) {
        console.log('✅ Selected batch:', selectedBatchData);
        // Cập nhật currentBatchNumber để kích hoạt lọc
        this.currentBatchNumber = this.selectedBatch;
        // Áp dụng lọc để chỉ hiển thị materials của lô hàng này
        this.applyFilters();
        console.log(`📦 Đã lọc để hiển thị materials của lô hàng: ${this.selectedBatch}`);
      } else {
        console.log('❌ Selected batch not found in available batches');
      }
    } else {
      console.log('ℹ️ No batch selected');
      // Reset lọc khi không chọn lô hàng
      this.currentBatchNumber = '';
      this.applyFilters();
    }
  }

  // Bắt đầu kiểm tra
  startInspection(): void {
    if (this.employeeCode && this.selectedBatch) {
      console.log('🚀 Starting inspection with:', {
        employeeCode: this.employeeCode,
        batchNumber: this.selectedBatch
      });
      
      // Đóng modal và hiển thị giao diện đã lọc
      this.isBatchScanningMode = false;
      
      // Hiển thị thông báo thành công
      alert(`✅ Bắt đầu kiểm tra!\nMã nhân viên: ${this.employeeCode}\nLô hàng: ${this.selectedBatch}\n\nGiao diện đã được lọc để hiển thị materials của lô hàng này.`);
      
      console.log(`🎯 Đã chuyển sang chế độ kiểm tra lô hàng: ${this.selectedBatch}`);
    }
  }

  // Reset khi dừng
  stopBatchScanningMode(): void {
    this.isBatchScanningMode = false;
    this.employeeCode = '';
    this.selectedBatch = '';
    this.isEmployeeCodeSaved = false;
    this.availableBatches = [];
    
    // Reset lọc để hiển thị tất cả materials
    this.currentBatchNumber = '';
    this.applyFilters();
    
    console.log('🛑 Stopped batch scanning mode and reset filters');
  }



  // Tự động viết hoa mã nhân viên
  onEmployeeCodeInput(event: any): void {
    const input = event.target;
    const value = input.value;
    if (value) {
      // Tự động viết hoa và cập nhật ngModel
      this.employeeCode = value.toUpperCase();
      // Cập nhật input value để hiển thị ngay lập tức
      input.value = this.employeeCode;
    }
  }

  onEmployeeCodeKeyup(event: any): void {
    const input = event.target;
    const value = input.value;
    if (value) {
      // Đảm bảo viết hoa khi nhập xong
      this.employeeCode = value.toUpperCase();
      input.value = this.employeeCode;
    }
  }

  // Xóa bộ lọc lô hàng
  clearBatchFilter(): void {
    console.log('🧹 Clearing batch filter...');
    this.currentBatchNumber = '';
    this.selectedBatch = '';
    this.applyFilters();
    console.log('✅ Batch filter cleared');
  }
  
  // Delete by batch functionality
  openDeleteByBatchModal(): void {
    this.showDeleteByBatchModal = true;
    this.batchToDelete = '';
    this.showMorePopup = false; // Close popup when opening modal
  }
  
  closeDeleteByBatchModal(): void {
    this.showDeleteByBatchModal = false;
    this.batchToDelete = '';
  }
  
  async deleteByBatch(): Promise<void> {
    if (!this.batchToDelete || this.batchToDelete.trim() === '') {
      alert('❌ Vui lòng nhập mã lô hàng');
      return;
    }
    
    if (!this.canDeleteMaterials) {
      alert('❌ Bạn không có quyền xóa materials');
      return;
    }
    
    const batchNumber = this.batchToDelete.trim();
    
    // Find materials with the specified batch number
    const materialsToDelete = this.materials.filter(m => 
      m.batchNumber === batchNumber && m.factory === 'ASM1'
    );
    
    if (materialsToDelete.length === 0) {
      alert(`❌ Không tìm thấy materials nào với lô hàng "${batchNumber}"`);
      return;
    }
    
    // Check for materials already in inventory
    const materialsInInventory = materialsToDelete.filter(m => m.isReceived);
    const materialsNotInInventory = materialsToDelete.filter(m => !m.isReceived);
    
    let confirmMessage = `🗑️ Xác nhận xóa lô hàng "${batchNumber}"?\n\n`;
    confirmMessage += `📊 Tìm thấy ${materialsToDelete.length} materials:\n`;
    confirmMessage += `  • ${materialsNotInInventory.length} materials chưa nhận\n`;
    confirmMessage += `  • ${materialsInInventory.length} materials đã nhận (trong Inventory)\n\n`;
    
    if (materialsInInventory.length > 0) {
      confirmMessage += `⚠️ LƯU Ý: ${materialsInInventory.length} materials đã trong Inventory sẽ chỉ bị xóa khỏi tab Inbound, không ảnh hưởng đến Inventory.\n\n`;
    }
    
    confirmMessage += `❌ Hành động này không thể hoàn tác!`;
    
    if (!confirm(confirmMessage)) {
      return;
    }
    
    try {
      this.isLoading = true;
      console.log(`🗑️ Deleting batch: ${batchNumber} (${materialsToDelete.length} materials)`);
      
      // Get material IDs to delete
      const materialIds = materialsToDelete.map(m => m.id);
      
      // Use batch operations for better performance
      const batchSize = 500; // Firestore batch limit
      const batches = [];
      
      for (let i = 0; i < materialIds.length; i += batchSize) {
        const batch = this.firestore.firestore.batch();
        const batchIds = materialIds.slice(i, i + batchSize);
        
        batchIds.forEach(id => {
          const docRef = this.firestore.collection('inbound-materials').doc(id).ref;
          batch.delete(docRef);
        });
        
        batches.push(batch);
      }
      
      // Execute all batches
      const deletePromises = batches.map(batch => batch.commit());
      
      await Promise.all(deletePromises);
      
      console.log(`✅ Successfully deleted batch ${batchNumber}: ${materialIds.length} materials`);
      if (materialsInInventory.length > 0) {
        console.log(`ℹ️ Note: ${materialsInInventory.length} materials remain in inventory`);
      }
      
      // Show success message
      let successMessage = `✅ Đã xóa thành công lô hàng "${batchNumber}"\n`;
      successMessage += `📊 Xóa ${materialIds.length} materials từ tab Inbound ASM1`;
      if (materialsInInventory.length > 0) {
        successMessage += `\n\n📦 ${materialsInInventory.length} materials đã trong Inventory vẫn tồn tại`;
      }
      alert(successMessage);
      
      // Close modal and reload data
      this.closeDeleteByBatchModal();
      this.loadMaterials();
      
    } catch (error) {
      console.error(`❌ Error deleting batch ${batchNumber}:`, error);
      alert(`❌ Lỗi xóa lô hàng: ${error.message}`);
    } finally {
      this.isLoading = false;
    }
  }

  // ==================== IQC FUNCTIONS ====================

  openIQCModal(): void {
    console.log('🔬 Opening IQC modal');
    this.showIQCModal = true;
    this.iqcScanInput = '';
    this.scannedMaterial = null;
    this.iqcEmployeeId = '';
    this.iqcEmployeeVerified = false;
    this.iqcStep = 1; // Reset to employee scan step
    this.showMorePopup = false;
    
    // Auto-focus on input after modal opens
    setTimeout(() => {
      const input = document.getElementById('iqcScanInput') as HTMLInputElement;
      if (input) {
        input.focus();
      }
    }, 100);
  }

  closeIQCModal(): void {
    console.log('🔬 Closing IQC modal');
    this.showIQCModal = false;
    this.iqcScanInput = '';
    this.scannedMaterial = null;
    this.iqcEmployeeId = '';
    this.iqcEmployeeVerified = false;
    this.iqcStep = 1;
  }

  onIQCScanKeyup(event: KeyboardEvent): void {
    if (event.key === 'Enter' && this.iqcScanInput.trim()) {
      if (this.iqcStep === 1) {
        this.verifyQAEmployee();
      } else {
        this.processIQCScan();
      }
    }
  }

  async verifyQAEmployee(): Promise<void> {
    const scannedData = this.iqcScanInput.trim();
    console.log('👤 Verifying QA employee - raw input:', scannedData);

    if (!scannedData) {
      alert('⚠️ Vui lòng nhập mã nhân viên');
      return;
    }

    // Parse employee ID from format: ASP1752-NGUYEN THANH HUY-Bo Phan Chat Luong-19/06/2023
    // Extract first 7 characters
    // Normalize "ÁP" to "ASP" in case of character encoding issues
    const normalizedData = scannedData.replace(/ÁP/gi, 'ASP');
    const employeeId = normalizedData.substring(0, 7).toUpperCase();
    console.log('🔍 Extracted employee ID (first 7 chars):', employeeId);

    // Allowed QA employee IDs (hardcoded list)
    const allowedQAEmployees = ['ASP0106', 'ASP1752', 'ASP0028', 'ASP1747', 'ASP2083', 'ASP2137'];

    if (allowedQAEmployees.includes(employeeId)) {
      // Employee is authorized for IQC
      this.iqcEmployeeId = employeeId;
      this.iqcEmployeeVerified = true;
      this.iqcStep = 2;
      this.iqcScanInput = '';
      
      console.log('✅ QA employee verified:', employeeId);
      
      // Auto-focus for material scan
      setTimeout(() => {
        const input = document.getElementById('iqcScanInput') as HTMLInputElement;
        if (input) {
          input.focus();
        }
      }, 100);
    } else {
      // Employee is not authorized
      console.log('❌ Employee not authorized for IQC:', employeeId);
      alert(`❌ Nhân viên không có quyền thực hiện IQC!\n\nMã nhân viên: ${employeeId}\n\nChỉ các mã sau được phép:\n- ASP0106\n- ASP1752`);
      this.iqcScanInput = '';
    }
  }

  processIQCScan(): void {
    const scannedCode = this.iqcScanInput.trim();
    console.log('🔬 Processing IQC scan:', scannedCode);

    if (!scannedCode) {
      alert('⚠️ Vui lòng nhập mã QR');
      return;
    }

    // Parse QR code format: MaterialCode|PO|Quantity|BatchDate
    // Example: B017431|KZPO1025/0194|100|19112025
    const parts = scannedCode.split('|');
    console.log('🔍 QR code parts:', parts);

    let foundMaterial: InboundMaterial | undefined;

    if (parts.length >= 2) {
      // QR code format from print: materialCode|poNumber|quantity|date
      const materialCode = parts[0];
      const poNumber = parts[1];
      
      console.log('🔍 Searching for material:', { materialCode, poNumber });
      
      // Find material by materialCode and poNumber
      foundMaterial = this.materials.find(m => 
        m.materialCode === materialCode && m.poNumber === poNumber
      );
    } else {
      // Try direct search by materialCode, poNumber, or internalBatch
      foundMaterial = this.materials.find(m => 
        m.materialCode === scannedCode || 
        m.poNumber === scannedCode || 
        m.internalBatch === scannedCode
      );
    }

    if (foundMaterial) {
      console.log('✅ Found material:', foundMaterial);
      this.scannedMaterial = foundMaterial;
      this.iqcScanInput = ''; // Clear input for next scan
    } else {
      console.log('❌ Material not found for code:', scannedCode);
      console.log('📊 Available materials:', this.materials.map(m => ({ 
        materialCode: m.materialCode, 
        poNumber: m.poNumber,
        internalBatch: m.internalBatch 
      })));
      alert(`❌ Không tìm thấy material với mã: ${scannedCode}`);
      this.iqcScanInput = '';
    }
  }

  async updateIQCStatus(status: string): Promise<void> {
    if (!this.scannedMaterial) {
      alert('⚠️ Chưa scan material');
      return;
    }

    console.log(`🔬 Updating IQC status to: ${status} for material:`, this.scannedMaterial.materialCode);

    try {
      const materialId = this.scannedMaterial.id;
      if (!materialId) {
        alert('❌ Material không có ID');
        return;
      }

      // Update in Firestore
      await this.firestore.collection('inbound-materials').doc(materialId).update({
        iqcStatus: status,
        updatedAt: new Date()
      });

      // Update local data
      const materialIndex = this.materials.findIndex(m => m.id === materialId);
      if (materialIndex !== -1) {
        this.materials[materialIndex].iqcStatus = status;
      }

      console.log(`✅ IQC status updated to: ${status}`);
      alert(`✅ Đã cập nhật trạng thái IQC: ${status}`);

      // Reset for next scan
      this.scannedMaterial = null;
      this.iqcScanInput = '';
      
      // Refocus input
      setTimeout(() => {
        const input = document.getElementById('iqcScanInput') as HTMLInputElement;
        if (input) {
          input.focus();
        }
      }, 100);

      // Refresh filtered materials to show updated status
      this.applyFilters();

    } catch (error) {
      console.error('❌ Error updating IQC status:', error);
      alert(`❌ Lỗi cập nhật trạng thái: ${error.message}`);
    }
  }

  getIQCStatusClass(status: string): string {
    switch (status) {
      case 'Pass':
        return 'iqc-pass';
      case 'NG':
        return 'iqc-ng';
      case 'Đặc Cách':
        return 'iqc-special';
      case 'Chờ phán định':
        return 'iqc-pending-judgment';
      case 'Chờ kiểm':
      default:
        return 'iqc-waiting';
    }
  }

  // Nhận hàng trả Modal methods
  openReturnGoodsModal(): void {
    console.log('📦 Opening Return Goods modal');
    this.showReturnGoodsModal = true;
    this.returnGoodsEmployeeInput = '';
    this.returnGoodsQRInput = '';
    this.returnGoodsEmployeeId = '';
    this.returnGoodsEmployeeVerified = false;
    this.returnGoodsStep = 1;
    this.returnGoodsScanResult = null;
    this.showMorePopup = false;
    
    // Auto-focus on input after modal opens
    setTimeout(() => {
      const input = document.getElementById('returnGoodsEmployeeInput') as HTMLInputElement;
      if (input) {
        input.focus();
      }
    }, 100);
  }

  closeReturnGoodsModal(): void {
    console.log('📦 Closing Return Goods modal');
    this.showReturnGoodsModal = false;
    this.returnGoodsEmployeeInput = '';
    this.returnGoodsQRInput = '';
    this.returnGoodsEmployeeId = '';
    this.returnGoodsEmployeeVerified = false;
    this.returnGoodsStep = 1;
    this.returnGoodsScanResult = null;
  }

  onReturnGoodsEmployeeInput(event: any): void {
    const input = event.target;
    const value = input.value;
    if (value) {
      // Tự động viết hoa và giới hạn 7 ký tự
      this.returnGoodsEmployeeInput = value.toUpperCase().substring(0, 7);
      input.value = this.returnGoodsEmployeeInput;
    }
  }

  onReturnGoodsEmployeeKeyup(event: KeyboardEvent): void {
    if (event.key === 'Enter' && this.returnGoodsEmployeeInput.trim()) {
      this.verifyReturnGoodsEmployee();
    }
  }

  verifyReturnGoodsEmployee(): void {
    const scannedData = this.returnGoodsEmployeeInput.trim();
    console.log('👤 Verifying Return Goods employee - raw input:', scannedData);

    if (!scannedData) {
      alert('⚠️ Vui lòng nhập mã nhân viên');
      return;
    }

    // Đọc 7 ký tự đầu tiên
    const employeeId = scannedData.substring(0, 7).toUpperCase();
    console.log('🔍 Extracted employee ID (first 7 chars):', employeeId);

    if (employeeId.length >= 7) {
      // Employee ID hợp lệ
      this.returnGoodsEmployeeId = employeeId;
      this.returnGoodsEmployeeVerified = true;
      this.returnGoodsStep = 2;
      this.returnGoodsEmployeeInput = '';
      
      console.log('✅ Return Goods employee verified:', employeeId);
      
      // Auto-focus for QR scan
      setTimeout(() => {
        const input = document.getElementById('returnGoodsQRInput') as HTMLInputElement;
        if (input) {
          input.focus();
        }
      }, 100);
    } else {
      alert('⚠️ Mã nhân viên phải có ít nhất 7 ký tự');
      this.returnGoodsEmployeeInput = '';
    }
  }

  onReturnGoodsQRKeyup(event: KeyboardEvent): void {
    if (event.key === 'Enter' && this.returnGoodsQRInput.trim()) {
      this.processReturnGoodsScan();
    }
  }

  async processReturnGoodsScan(): Promise<void> {
    const scannedCode = this.returnGoodsQRInput.trim();
    console.log('📦 Processing Return Goods scan:', scannedCode);

    if (!scannedCode) {
      alert('⚠️ Vui lòng nhập mã QR');
      return;
    }

    // Parse QR code format: MaterialCode|PO|Quantity|BatchDate
    // Example: B017431|KZPO1025/0194|100|19112025
    const parts = scannedCode.split('|');
    console.log('🔍 QR code parts:', parts);

    if (parts.length < 3) {
      this.returnGoodsScanResult = {
        success: false,
        message: '❌ Mã QR không đúng định dạng. Format: MaterialCode|PO|Quantity|Date'
      };
      this.returnGoodsQRInput = '';
      return;
    }

    const materialCode = parts[0].trim();
    const poNumber = parts[1].trim();
    const quantity = parseFloat(parts[2].trim()) || 0;

    console.log('🔍 Searching for TRA material:', { materialCode, poNumber, quantity });

    // Tìm materials có batchNumber bắt đầu bằng "TRA"
    const traMaterials = this.materials.filter(m => 
      m.batchNumber && m.batchNumber.toUpperCase().startsWith('TRA')
    );

    console.log(`📊 Found ${traMaterials.length} TRA materials`);

    // Tìm material khớp với mã, PO, và lượng
    const foundMaterial = traMaterials.find(m => 
      m.materialCode.toUpperCase().trim() === materialCode.toUpperCase().trim() &&
      m.poNumber.trim() === poNumber.trim() &&
      Math.abs(m.quantity - quantity) < 0.01 // So sánh số lượng (cho phép sai số nhỏ)
    );

    if (foundMaterial) {
      console.log('✅ Found matching TRA material:', foundMaterial);

      // Kiểm tra xem đã nhận chưa
      if (foundMaterial.isReceived) {
        this.returnGoodsScanResult = {
          success: false,
          message: '⚠️ Mã hàng này đã được nhận rồi',
          material: foundMaterial
        };
      } else {
        // Tự động check đã nhận
        try {
          const materialId = foundMaterial.id;
          if (!materialId) {
            throw new Error('Material không có ID');
          }

          // Update in Firestore
          await this.firestore.collection('inbound-materials').doc(materialId).update({
            isReceived: true,
            updatedAt: new Date()
          });

          // Update local data
          const materialIndex = this.materials.findIndex(m => m.id === materialId);
          if (materialIndex !== -1) {
            this.materials[materialIndex].isReceived = true;
          }

          console.log('✅ Material marked as received:', foundMaterial.materialCode);
          
          // Thêm vào inventory-materials collection (giống như onReceivedChange)
          console.log('📦 Adding return goods material to inventory:', foundMaterial.materialCode);
          this.addToInventory(foundMaterial);
          
          this.returnGoodsScanResult = {
            success: true,
            message: '✅ Đã nhận hàng thành công và đã thêm vào inventory!',
            material: foundMaterial
          };

          // Refresh filtered materials
          this.applyFilters();

        } catch (error) {
          console.error('❌ Error updating material:', error);
          this.returnGoodsScanResult = {
            success: false,
            message: `❌ Lỗi cập nhật: ${error.message}`,
            material: foundMaterial
          };
        }
      }
    } else {
      console.log('❌ TRA material not found for:', { materialCode, poNumber, quantity });
      console.log('📊 Available TRA materials:', traMaterials.map(m => ({
        materialCode: m.materialCode,
        poNumber: m.poNumber,
        quantity: m.quantity,
        batchNumber: m.batchNumber
      })));
      
      this.returnGoodsScanResult = {
        success: false,
        message: '❌ Không tìm thấy mã hàng trong lô hàng TRA. Vui lòng kiểm tra lại mã QR.'
      };
    }

    // Clear input for next scan
    this.returnGoodsQRInput = '';
    
    // Auto-focus for next scan after a delay
    setTimeout(() => {
      const input = document.getElementById('returnGoodsQRInput') as HTMLInputElement;
      if (input) {
        input.focus();
      }
    }, 500);
  }
}