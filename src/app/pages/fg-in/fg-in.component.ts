import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import * as QRCode from 'qrcode';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { FactoryAccessService } from '../../services/factory-access.service';
import { MatDialog } from '@angular/material/dialog';
import { QRScannerModalComponent, QRScannerData } from '../../components/qr-scanner-modal/qr-scanner-modal.component';

export interface FgInItem {
  id?: string;
  factory?: string;
  importDate: Date;
  batchNumber: string; // Tạo theo tuần và số thứ tự 4 số (ví dụ: 390001)
  materialCode: string; // Mã TP
  poNumber?: string;   // Số PO (cột N)
  rev: string; // REV
  lot: string; // LOT
  lsx: string; // LSX
  quantity: number; // QTY
  carton: number; // Carton
  odd: number; // ODD
  location: string; // Vị Trí
  notes: string; // Ghi chú
  customer: string; // Khách
  isReceived: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ProductCatalogItem {
  id?: string;
  materialCode: string; // Mã TP
  standard: string; // Standard
  customer: string; // Khách
  customerCode: string; // Mã khách hàng
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CustomerCodeMappingItem {
  id?: string;
  customerCode: string; // Mã khách hàng
  materialCode: string; // Mã thành phẩm
  description?: string; // Mô tả
  createdAt?: Date;
  updatedAt?: Date;
}

/** Gộp Danh mục TP + Mapping KH-TP: một dòng = Mã TP + Standard + Mã KH + Tên KH, có thể có catalogId và/hoặc mappingId */
export interface MergedCatalogItem {
  catalogId?: string;
  mappingId?: string;
  materialCode: string;
  customerCode: string;
  description: string;
  standard: string;
}

@Component({
  selector: 'app-fg-in',
  templateUrl: './fg-in.component.html',
  styleUrls: ['./fg-in.component.scss']
})
export class FgInComponent implements OnInit, OnDestroy {
  materials: FgInItem[] = [];
  filteredMaterials: FgInItem[] = [];
  
  // Search and filter
  searchTerm: string = '';
  
  // Factory filter - hiển thị ASM1, ASM2 hoặc TOTAL
  selectedFactory: string = 'ASM1';
  availableFactories: string[] = ['ASM1', 'ASM2', 'TOTAL'];
  // Mobile: đã chọn factory hay chưa (để hiện popup chọn ASM1/ASM2 trước)
  mobileFactorySelected: boolean = false;
  
  // Time range filter
  showTimeRangeDialog: boolean = false;
  startDate: Date = new Date(); // Mặc định là hôm nay
  endDate: Date = new Date();   // Mặc định là hôm nay
  
  // Unhide Dialog
  showUnhideDialog: boolean = false;
  unhideMaterialCode: string = '';
  
  // Report Dialog
  showReportDialog: boolean = false;
  reportMonth: string = '';
  
  // Display options
  showCompleted: boolean = true;
  
  // Permissions
  hasDeletePermission: boolean = false;
  hasCompletePermission: boolean = false;
  
  // More menu popup
  showMoreMenu: boolean = false;
  
  // Import Factory Dialog
  showImportFactoryDialog: boolean = false;
  importSelectedFactory: string = 'ASM1';
  showImportHelp: boolean = false;
  
  // Product Catalog
  showCatalogDialog: boolean = false;
  showCatalogHelp: boolean = false;
  catalogItems: ProductCatalogItem[] = [];
  filteredCatalogItems: ProductCatalogItem[] = [];
  catalogSearchTerm: string = '';
  
  // New catalog item for manual addition
  newCatalogItem: ProductCatalogItem = {
    materialCode: '',
    standard: '',
    customer: '',
    customerCode: ''
  };
  
  // Customer Code Mapping
  showMappingDialog: boolean = false;
  mappingItems: CustomerCodeMappingItem[] = [];
  filteredMappingItems: CustomerCodeMappingItem[] = [];
  mappingSearchTerm: string = '';

  // Gộp Danh mục TP + Mapping: một danh sách, một dialog
  mergedCatalogItems: MergedCatalogItem[] = [];
  filteredMergedCatalogItems: MergedCatalogItem[] = [];
  mergedSearchTerm: string = '';
  newMergedItem: { materialCode: string; standard: string; customerCode: string; description: string } = {
    materialCode: '',
    standard: '',
    customerCode: '',
    description: ''
  };
  
  // New mapping item for manual addition (giữ cho tương thích)
  newMappingItem: CustomerCodeMappingItem = {
    customerCode: '',
    materialCode: '',
    description: ''
  };

  // Nhập Kho dialog
  showNhapKhoDialog: boolean = false;
  newNhapKhoItem: { factory: string; materialCode: string; quantity: number | null; lot: string; lsx: string } = {
    factory: 'ASM1',
    materialCode: '',
    quantity: null,
    lot: '',
    lsx: ''
  };
  nhapKhoMaterialSuggestions: CustomerCodeMappingItem[] = [];
  showNhapKhoSuggestions: boolean = false;
  private nhapKhoSuggestionsBlurTimer: any;
  private readonly NHAP_KHO_MIN_CHARS = 4; // Chỉ lọc khi nhập đủ 4 ký tự để hạn chế lag
  
  // Confirm Receipt Dialog (Xác nhận phiếu nhập kho)
  showConfirmReceiptDialog: boolean = false;
  selectedReceiptMaterial: FgInItem | null = null;
  // Nếu phiếu đã tick khóa nhưng location = 'Temporary'/rỗng => chỉ cập nhật vị trí
  locationUpdateOnlyMode: boolean = false;
  confirmReceiptData = {
    materialCodeConfirmed: false,
    poConfirmed: false,
    lsxConfirmed: false,
    lotConfirmed: false,
    quantityConfirmed: false,
    location: ''
  };
  
  // Scanner input for location
  locationScannerValue: string = '';
  @ViewChild('locationScannerInput') locationScannerInput: ElementRef;
  
  // Multiple pallet (partial confirmation)
  isMultiplePallet: boolean = false;
  confirmQuantity: number = 0;
  originalQuantity: number = 0;
  
  private destroy$ = new Subject<void>();

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private factoryAccessService: FactoryAccessService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    // Mặc định chỉ hiển thị hôm nay
    this.startDate = new Date();
    this.endDate = new Date();
    
    this.loadMaterialsFromFirebase();
    // Load catalog immediately so calculations work
    this.loadCatalogFromFirebase();
    // Load mapping immediately
    this.loadMappingFromFirebase();
    this.startDate = new Date(2020, 0, 1);
    this.endDate = new Date(2030, 11, 31);
    this.applyFilters();
    this.loadPermissions();
    this.loadFactoryAccess();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Load materials from Firebase - One-time load for better performance
  loadMaterialsFromFirebase(): void {
    this.firestore.collection('fg-in')
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe((querySnapshot) => {
        const firebaseMaterials = querySnapshot.docs.map(doc => {
          const data = doc.data() as any;
          const id = doc.id;
          
          // Map Firebase data structure to component interface
          const material = {
            id: id,
            factory: data.factory || 'ASM1',
            importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : new Date(),
            batchNumber: data.batchNumber || data.batch || '',
            materialCode: data.materialCode || data.maTP || '',
            poNumber: data.poNumber || data.soPO || '',
            rev: data.rev || '',
            lot: data.lot || data.Lot || '',
            lsx: data.lsx || data.Lsx || '',
            quantity: data.quantity || data.qty || 0,
            carton: data.carton || 0,
            odd: data.odd || 0,
            // Nếu phiếu đã khóa mà chưa có vị trí thì vẫn hiển thị placeholder để cột "Vị trí" không bị trống.
            location: data.location || data.viTri || (data.isReceived ? 'Temporary' : ''),
            notes: data.notes || data.ghiChu || '',
            customer: data.customer || data.khach || '',
            isReceived: data.isReceived || false,
            createdAt: data.createdAt ? new Date(data.createdAt.seconds * 1000) : new Date(),
            updatedAt: data.updatedAt ? new Date(data.updatedAt.seconds * 1000) : new Date()
          };
          
          console.log('Loaded material:', material);
          return material;
        });
        
        this.materials = firebaseMaterials;
        this.applyFilters();
        console.log('Loaded FG In materials from Firebase:', this.materials.length);
        console.log('All materials:', this.materials);
      });
  }

  // Lock / Unlock (cột Lock): Tick = khóa (chuyển Inventory), Bỏ tick = mở khóa để sửa
  updateLockStatus(material: FgInItem, checked: boolean): void {
    material.isReceived = checked;
    // Khi tick khóa trực tiếp (không scan vị trí), đảm bảo UI mobile không bị trống cột location.
    if (checked && (!material.location || String(material.location).trim() === '')) {
      material.location = 'Temporary';
    }
    material.updatedAt = new Date();
    this.updateMaterialInFirebase(material);
    if (checked) {
      this.addToInventory(material);
    }
  }

  // Add material to Inventory when received (supports partial quantity and custom batch)
  private addToInventory(material: FgInItem, customQuantity?: number, customBatch?: string): void {
    const quantity = customQuantity !== undefined ? customQuantity : material.quantity;
    const batchNumber = customBatch !== undefined ? customBatch : material.batchNumber;
    console.log(`Adding ${material.materialCode} to FG Inventory with quantity: ${quantity}, batch: ${batchNumber}...`);

    // Tìm thông tin từ catalog
    const catalogItem = this.catalogItems.find(item => item.materialCode === material.materialCode);
    const customerFromCatalog = catalogItem ? catalogItem.customer : '';
    const standardFromCatalog = catalogItem ? catalogItem.standard : '';

    // Tính toán Carton và ODD từ Standard
    let carton = 0;
    let odd = 0;

    if (standardFromCatalog && !isNaN(parseFloat(standardFromCatalog)) && parseFloat(standardFromCatalog) > 0) {
      const standard = parseFloat(standardFromCatalog);
      carton = Math.ceil(quantity / standard); // Làm tròn lên
      odd = quantity % standard; // Số lẻ
    }

    // Create inventory material from inbound material
    const inventoryMaterial = {
      factory: material.factory || 'ASM1',
      importDate: material.importDate,
      receivedDate: new Date(),
      batchNumber: batchNumber,
      materialCode: material.materialCode,
      poNumber: material.poNumber,
      rev: material.rev,
      lot: material.lot,
      lsx: material.lsx,
      quantity: quantity,
      carton: carton,
      odd: odd,
      // Các trường chuẩn FG Inventory: tonDau + nhap - xuat = ton
      tonDau: 0,
      nhap: quantity,
      xuat: 0,
      ton: quantity,
      exported: 0,
      stock: quantity,
      location: material.location || 'Temporary',
      notes: material.notes || '',
      customer: material.customer || customerFromCatalog || '',
      isReceived: true,
      isCompleted: false,
      isDuplicate: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.firestore.collection('fg-inventory').add(inventoryMaterial)
      .then((docRef) => {
        console.log(`Successfully added ${material.materialCode} to FG inventory with ID: ${docRef.id}`);
        console.log(`Carton: ${carton}, ODD: ${odd} (Standard: ${standardFromCatalog})`);
      })
      .catch(error => {
        console.error(`Error adding ${material.materialCode} to FG inventory:`, error);
      });
  }

  // Update material in Firebase
  updateMaterialInFirebase(material: FgInItem): void {
    if (material.id) {
      const updateData = {
        ...material,
        importDate: material.importDate,
        updatedAt: new Date()
      };
      
      delete updateData.id;
      
      this.firestore.collection('fg-in').doc(material.id).update(updateData)
        .then(() => {
          console.log('FG In material updated in Firebase successfully');
        })
        .catch(error => {
          console.error('Error updating FG In material in Firebase:', error);
        });
    }
  }

  // Delete material - Xóa ngay không cần xác nhận
  deleteMaterial(material: FgInItem): void {
    if (!material.id) {
      console.error('❌ Material has no ID - cannot delete');
      return;
    }
    
    const materialId = material.id;
    
    // Xóa khỏi local arrays ngay lập tức để UI cập nhật nhanh
    this.materials = this.materials.filter(m => m.id !== materialId);
    this.filteredMaterials = this.filteredMaterials.filter(m => m.id !== materialId);
    
    // Xóa từ Firebase
    this.firestore.collection('fg-in').doc(materialId).delete()
      .then(() => {
        console.log('✅ Deleted:', material.materialCode);
      })
      .catch(error => {
        console.error('❌ Error deleting:', error);
        // Nếu lỗi, refresh lại data
        this.refreshData();
      });
  }

  // Apply search filters - Optimized for performance
  applyFilters(): void {
    // Use setTimeout to debounce rapid filter changes
    setTimeout(() => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      this.filteredMaterials = this.materials.filter(material => {
        // Phiếu đã khóa: sau mỗi ngày sẽ ẩn đi (chỉ hiển thị phiếu chưa khóa hoặc phiếu đã khóa trong ngày)
        if (material.isReceived) {
          const importDate = new Date(material.importDate);
          importDate.setHours(0, 0, 0, 0);
          if (importDate < todayStart) return false;
        }

        // Filter by search term
        if (this.searchTerm) {
          const searchableText = [
            material.materialCode,
            material.batchNumber,
            material.rev,
            material.lot,
            material.lsx,
            material.location,
            material.customer,
            material.quantity?.toString(),
            material.carton?.toString(),
            material.odd?.toString(),
            material.notes
          ].filter(Boolean).join(' ').toUpperCase();
          
          if (!searchableText.includes(this.searchTerm)) {
            return false;
          }
        }
        
        // Filter by factory (TOTAL = hiển thị tất cả)
        if (this.selectedFactory && this.selectedFactory !== 'TOTAL') {
          const materialFactory = material.factory || 'ASM1';
          if (materialFactory !== this.selectedFactory) {
            return false;
          }
        }
        
        // Filter by date range
        const importDate = new Date(material.importDate);
        const isInDateRange = importDate >= this.startDate && importDate <= this.endDate;
        
        return isInDateRange;
      });
      
      console.log('FG In search results:', {
        searchTerm: this.searchTerm,
        totalMaterials: this.materials.length,
        filteredMaterials: this.filteredMaterials.length
      });
    }, 0);
  }

  // Nhập Kho - open/close dialog
  setFactoryFilter(factory: string): void {
    this.selectedFactory = factory;
    this.applyFilters();
    // Khi user chọn factory trên mobile popup, ghi nhận đã chọn để ẩn popup
    this.mobileFactorySelected = true;
  }

  openNhapKho(): void {
    this.newNhapKhoItem = { factory: this.selectedFactory === 'TOTAL' ? 'ASM1' : this.selectedFactory, materialCode: '', quantity: null, lot: '', lsx: '' };
    this.showNhapKhoSuggestions = false;
    this.nhapKhoMaterialSuggestions = [];
    this.showNhapKhoDialog = true;
  }

  closeNhapKho(): void {
    this.showNhapKhoDialog = false;
    this.showNhapKhoSuggestions = false;
    this.newNhapKhoItem = { factory: 'ASM1', materialCode: '', quantity: null, lot: '', lsx: '' };
    this.nhapKhoMaterialSuggestions = [];
    if (this.nhapKhoSuggestionsBlurTimer) clearTimeout(this.nhapKhoSuggestionsBlurTimer);
  }

  filterNhapKhoMaterialSuggestions(): void {
    const term = (this.newNhapKhoItem.materialCode || '').trim().toUpperCase();
    if (term.length < this.NHAP_KHO_MIN_CHARS) {
      this.nhapKhoMaterialSuggestions = [];
      this.showNhapKhoSuggestions = false;
      return;
    }
    this.nhapKhoMaterialSuggestions = this.mappingItems
      .filter(item => (item.materialCode || '').toUpperCase().includes(term))
      .slice(0, 20);
    this.showNhapKhoSuggestions = this.nhapKhoMaterialSuggestions.length > 0;
  }

  onNhapKhoMaterialCodeFocus(): void {
    this.filterNhapKhoMaterialSuggestions();
  }

  onNhapKhoMaterialCodeInput(): void {
    this.filterNhapKhoMaterialSuggestions();
  }

  onNhapKhoMaterialCodeBlur(): void {
    this.nhapKhoSuggestionsBlurTimer = setTimeout(() => {
      this.showNhapKhoSuggestions = false;
    }, 200);
  }

  selectNhapKhoMaterialCode(item: CustomerCodeMappingItem): void {
    this.newNhapKhoItem.materialCode = item.materialCode || '';
    this.showNhapKhoSuggestions = false;
  }

  /** In tem QR (57mm x 32mm, giống inbound-asm1): QR bên trái, thông tin bên phải */
  async printTem(material: FgInItem): Promise<void> {
    try {
      const mc = (material.materialCode || '').trim();
      const batch = (material.batchNumber || '').trim();
      const lsx = (material.lsx || '').trim();
      const lot = (material.lot || '').trim();
      const qty = material.quantity ?? 0;
      const importDateStr = material.importDate
        ? (material.importDate instanceof Date
          ? material.importDate.toLocaleDateString('vi-VN')
          : new Date((material.importDate as any)?.seconds * 1000).toLocaleDateString('vi-VN'))
        : new Date().toLocaleDateString('vi-VN');

      const qrData = `${mc}|${batch}|${lsx}|${lot}|${qty}`;

      const qrImage = await QRCode.toDataURL(qrData, {
        width: 240,
        margin: 1,
        color: { dark: '#000000', light: '#FFFFFF' }
      });

      const user = await this.afAuth.currentUser;
      const currentUser = user
        ? (user.email || user.uid).split('@')[0].toUpperCase()
        : 'UNKNOWN';
      const printDate = new Date().toLocaleDateString('vi-VN');

      const html = `
        <html>
          <head><title></title>
          <style>
            * { margin: 0 !important; padding: 0 !important; box-sizing: border-box !important; }
            body { font-family: Arial, sans-serif; margin: 0 !important; padding: 0 !important;
              background: white !important; overflow: hidden !important; width: 57mm !important; height: 32mm !important; }
            .qr-container { display: flex !important; margin: 0 !important; padding: 0 !important;
              border: 1px solid #000 !important; width: 57mm !important; height: 32mm !important;
              page-break-inside: avoid !important; background: white !important; box-sizing: border-box !important; }
            .qr-section { width: 30mm !important; height: 30mm !important; display: flex !important;
              align-items: center !important; justify-content: center !important; border-right: 1px solid #ccc !important;
              box-sizing: border-box !important; }
            .qr-image { width: 28mm !important; height: 28mm !important; display: block !important; }
            .info-section { flex: 1 !important; padding: 1mm !important; display: flex !important;
              flex-direction: column !important; justify-content: space-between !important;
              font-size: 9.6px !important; line-height: 1.2 !important; box-sizing: border-box !important;
              color: #000 !important; text-align: left !important; }
            .info-row { margin: 0.2mm 0 !important; font-weight: bold !important; color: #000 !important;
              text-align: left !important; display: block !important; white-space: nowrap !important;
              font-family: Arial, sans-serif !important; }
            .info-row.material-code { font-size: 18.43px !important; font-weight: bold !important; }
            .info-row.small { font-size: 8.4px !important; color: #000 !important; }
            @media print { body { margin: 0 !important; padding: 0 !important; width: 57mm !important; height: 32mm !important; overflow: hidden !important; }
              @page { margin: 0 !important; size: 57mm 32mm !important; padding: 0 !important; }
              .qr-container { margin: 0 !important; padding: 0 !important; width: 57mm !important; height: 32mm !important;
                page-break-inside: avoid !important; border: 1px solid #000 !important; }
              .qr-section { width: 30mm !important; height: 30mm !important; }
              .qr-image { width: 28mm !important; height: 28mm !important; } }
          </style>
          </head>
          <body>
            <div class="qr-container">
              <div class="qr-section"><img src="${qrImage}" class="qr-image" alt="QR"></div>
              <div class="info-section">
                <div>
                  <div class="info-row material-code">${mc}</div>
                  <div class="info-row">Batch: ${batch}</div>
                  <div class="info-row">LSX: ${lsx}</div>
                  <div class="info-row">LOT: ${lot}</div>
                  <div class="info-row">SL: ${qty}</div>
                  <div class="info-row">Ngày: ${importDateStr}</div>
                </div>
                <div>
                  <div class="info-row small">Date: ${printDate}</div>
                  <div class="info-row small">NV: ${currentUser}</div>
                </div>
              </div>
            </div>
            <script>
              window.onload = function() { document.title = ''; setTimeout(function() { window.print(); }, 300); };
            </script>
          </body>
        </html>`;

      const w = window.open('', '_blank');
      if (w) {
        w.document.write(html);
        w.document.close();
      }
    } catch (e) {
      console.error('Error printing tem:', e);
      alert('Có lỗi khi in tem. Vui lòng thử lại.');
    }
  }

  /** ASM1 → KZLSX, ASM2 → LHLSX. Chỉ thêm prefix nếu user chưa nhập sẵn. */
  private getLsxWithPrefix(lsx: string, factory: string): string {
    const raw = (lsx || '').trim().toUpperCase();
    if (!raw) return '';
    const prefix = factory === 'ASM2' ? 'LHLSX' : 'KZLSX';
    if (raw.startsWith(prefix)) return raw;
    return prefix + raw;
  }

  submitNhapKho(): void {
    const code = (this.newNhapKhoItem.materialCode || '').trim();
    const qty = this.newNhapKhoItem.quantity != null ? Number(this.newNhapKhoItem.quantity) : 0;
    if (!code) {
      alert('Vui lòng nhập Mã TP.');
      return;
    }
    if (!qty || qty <= 0) {
      alert('Vui lòng nhập Số lượng hợp lệ.');
      return;
    }
    const factory = (this.newNhapKhoItem.factory || 'ASM1').trim().toUpperCase();
    const validFactory = factory === 'ASM2' ? 'ASM2' : 'ASM1';
    const lsxRaw = (this.newNhapKhoItem.lsx || '').trim();
    const materialData = {
      factory: validFactory,
      importDate: new Date(),
      batchNumber: this.generateBatchNumber(0, validFactory),
      materialCode: code,
      rev: '',
      poNumber: '',
      lot: (this.newNhapKhoItem.lot || '').trim(),
      lsx: this.getLsxWithPrefix(lsxRaw, validFactory),
      quantity: qty,
      carton: 0,
      odd: 0,
      location: 'Temporary',
      notes: '',
      customer: '',
      isReceived: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.firestore.collection('fg-in').add(materialData)
      .then((docRef) => {
        const newMaterial = { ...materialData, id: docRef.id } as FgInItem;
        this.refreshData();
        this.closeNhapKho();
      })
      .catch(err => {
        console.error('Error adding FG In material:', err);
        alert('Lỗi khi lưu: ' + (err?.message || err));
      });
  }

  // Refresh data after operations (import, update, delete)
  refreshData(): void {
    console.log('Refreshing data...');
    this.loadMaterialsFromFirebase();
  }

  // Manual refresh for testing
  manualRefresh(): void {
    console.log('Manual refresh triggered');
    this.refreshData();
  }

  // Debug method to check materials
  debugMaterials(): void {
    console.log('=== DEBUG MATERIALS ===');
    console.log('Total materials:', this.materials.length);
    console.log('Filtered materials:', this.filteredMaterials.length);
    console.log('Catalog items:', this.catalogItems.length);
    
    this.materials.forEach((material, index) => {
      const calculation = this.calculateCartonAndOdd(material);
      console.log(`Material ${index + 1}:`, {
        id: material.id,
        materialCode: material.materialCode,
        batchNumber: material.batchNumber,
        quantity: material.quantity,
        hasId: !!material.id,
        calculatedCarton: calculation.carton,
        calculatedOdd: calculation.odd
      });
    });
    console.log('=== END DEBUG ===');
  }

  // Tính toán Carton và ODD cho material (để hiển thị trong bảng)
  calculateCartonAndOdd(material: FgInItem): { carton: number, odd: number } {
    const catalogItem = this.catalogItems.find(item => item.materialCode === material.materialCode);
    const standardFromCatalog = catalogItem ? catalogItem.standard : '';
    
    let carton = 0;
    let odd = 0;
    
    if (standardFromCatalog && !isNaN(parseFloat(standardFromCatalog)) && parseFloat(standardFromCatalog) > 0) {
      const standard = parseFloat(standardFromCatalog);
      carton = Math.ceil(material.quantity / standard); // Làm tròn lên
      odd = material.quantity % standard; // Số lẻ
    }
    
    return { carton, odd };
  }

  // Lấy thông tin khách hàng từ catalog
  getCustomerFromCatalog(materialCode: string): string {
    const catalogItem = this.catalogItems.find(item => item.materialCode === materialCode);
    return catalogItem ? catalogItem.customer : '';
  }

  // Lấy Tên khách hàng từ danh mục Mapping (cột Tên Khách Hàng = description)
  getCustomerNameFromMapping(materialCode: string): string {
    const mapping = this.mappingItems.find(item => item.materialCode === materialCode);
    return mapping ? (mapping.description || '') : '';
  }

  // Clear all data from Firebase (for testing)
  clearAllData(): void {
    if (confirm('⚠️ XÁC NHẬN XÓA TẤT CẢ DỮ LIỆU FG IN? Hành động này không thể hoàn tác!')) {
      console.log('Clearing all FG In data...');
      
      // Get all documents and delete them
      this.firestore.collection('fg-in').get().subscribe(querySnapshot => {
        const deletePromises = querySnapshot.docs.map(doc => doc.ref.delete());
        
        Promise.all(deletePromises).then(() => {
          console.log('All FG In data cleared successfully');
          alert('✅ Đã xóa tất cả dữ liệu FG In');
          this.refreshData();
        }).catch(error => {
          console.error('Error clearing data:', error);
          alert('❌ Lỗi khi xóa dữ liệu: ' + error.message);
        });
      });
    }
  }



  // Search functionality
  onSearchChange(event: any): void {
    this.searchTerm = event.target.value.toUpperCase();
    event.target.value = this.searchTerm;
    this.applyFilters();
  }

  // Load user permissions
  loadPermissions(): void {
    this.hasDeletePermission = true;
    this.hasCompletePermission = true;
  }

  // Load factory access - FG In có thể hiển thị ASM1, ASM2, TOTAL
  private loadFactoryAccess(): void {
    this.availableFactories = ['ASM1', 'ASM2', 'TOTAL'];
    if (!this.selectedFactory || !this.availableFactories.includes(this.selectedFactory)) {
      this.selectedFactory = 'ASM1';
    }
    console.log('🏭 Factory filter FG In:', {
      selectedFactory: this.selectedFactory,
      availableFactories: this.availableFactories
    });
  }

  // Check if user can edit material (ASM1, ASM2 đều cho phép sửa khi chưa lock)
  canEditMaterial(material: FgInItem): boolean {
    const materialFactory = material.factory || 'ASM1';
    return (materialFactory === 'ASM1' || materialFactory === 'ASM2') && !material.isReceived;
  }

  // Check if user can view material
  canViewMaterial(material: FgInItem): boolean {
    return true;
  }

  // Format date
  private formatDate(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  // Import file functionality
  importFile(): void {
    this.importSelectedFactory = 'ASM1';
    this.showImportFactoryDialog = true;
  }

  confirmImportFactory(): void {
    this.showImportFactoryDialog = false;
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,.xls';
    fileInput.style.display = 'none';
    
    fileInput.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.processImportFile(file);
      }
    };
      
    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
  }

  private async processImportFile(file: File): Promise<void> {
    try {
      const rows = await this.readExcelFileAsRows(file);
      const materials = this.parseBangKeNhap02Data(rows);
      if (materials.length === 0) {
        alert('Không có dòng nào hợp lệ (cần có Mã TP ở cột M).');
        return;
      }
      await this.saveMaterialsToFirebase(materials);
      this.refreshData();
      alert(`✅ Đã import bảng kê nhập 02: ${materials.length} dòng.`);
    } catch (e) {
      console.error('Import bảng kê nhập 02:', e);
      alert('❌ Lỗi import: ' + (e?.message || e));
    }
  }

  /** 
   * Parse Bảng kê nhập 02:
   * - Mã TP: cột M (index 12)
   * - LSX: cột N (index 13)
   * - Số lượng: cột S (index 18)
   * - Số PO: cột AL (index 37)
   * - Số LOT: cột AU (index 46) - nếu có chữ cái thì bỏ chữ cái và số sau nó
   * - Dữ liệu từ dòng 8 (bỏ 7 dòng header)
   */
  private parseBangKeNhap02Data(rows: any[][]): FgInItem[] {
    const factory = this.importSelectedFactory;
    const result: FgInItem[] = [];
    const colM = 12;   // Mã TP
    const colN = 13;   // LSX
    const colS = 18;   // Số lượng
    const colAL = 37;  // Số PO
    const colAU = 46;  // Số LOT
    
    const dataRows = rows.slice(7); // Bỏ 7 dòng header, lấy từ dòng 8
    
    dataRows.forEach((row) => {
      const maTP = row && (row[colM] != null) ? String(row[colM]).trim() : '';
      if (!maTP) return;
      
      const lsx = row && (row[colN] != null) ? String(row[colN]).trim() : '';
      const poNumber = row && (row[colAL] != null) ? String(row[colAL]).trim() : '';
      
      // Số lượng
      const soLuong = Number(row[colS]);
      const qty = isNaN(soLuong) || soLuong <= 0 ? 0 : Math.floor(soLuong);
      
      // LOT: nếu có chữ cái thì bỏ chữ cái và số sau nó
      let lotRaw = row && (row[colAU] != null) ? String(row[colAU]).trim() : '';
      let lot = this.extractLotNumber(lotRaw);
      
      result.push({
        factory,
        importDate: new Date(),
        batchNumber: this.generateBatchNumber(result.length, factory),
        materialCode: maTP,
        rev: '',
        poNumber: poNumber,
        lot,
        lsx,
        quantity: qty,
        carton: 0,
        odd: 0,
        location: 'Temporary',
        notes: '',
        customer: '',
        isReceived: false,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });
    return result;
  }

  /** Trích xuất số LOT: nếu có chữ cái thì bỏ chữ cái và tất cả ký tự sau nó */
  private extractLotNumber(lotRaw: string): string {
    if (!lotRaw) return '';
    // Tìm vị trí chữ cái đầu tiên
    const match = lotRaw.match(/[a-zA-Z]/);
    if (match && match.index !== undefined) {
      return lotRaw.substring(0, match.index);
    }
    return lotRaw;
  }

  /** Import phiếu nhập TP: cột F = Mã TP, J = Số lượng, M = LSX, U = LOT. Batch tự tạo. */
  importPhieuNhapTP(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,.xls';
    fileInput.style.display = 'none';
    fileInput.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) this.processPhiếuNhapTPFile(file);
    };
    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
  }

  private async processPhiếuNhapTPFile(file: File): Promise<void> {
    try {
      const rows = await this.readExcelFileAsRows(file);
      const materials = this.parsePhiếuNhapTPData(rows);
      if (materials.length === 0) {
        alert('Không có dòng nào hợp lệ (cần có Mã TP ở cột F).');
        return;
      }
      await this.saveMaterialsToFirebase(materials);
      this.refreshData();
      alert(`✅ Đã import phiếu nhập TP: ${materials.length} dòng.`);
    } catch (e) {
      console.error('Import phiếu nhập TP:', e);
      alert('❌ Lỗi import: ' + (e?.message || e));
    }
  }

  /** Đọc Excel trả về mảng dòng (header: 1) — cột A = index 0, F = 5, J = 9, M = 12, U = 20 */
  private readExcelFileAsRows(file: File): Promise<any[][]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
          resolve(rows);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  /** Parse theo cột: F=Mã TP, N=Số PO, J=Số lượng, M=LSX, U=LOT. Dữ liệu đọc từ dòng 8. LOT tối đa 8 ký tự. */
  private parsePhiếuNhapTPData(rows: any[][]): FgInItem[] {
    const factory = this.selectedFactory === 'TOTAL' ? 'ASM1' : (this.selectedFactory || 'ASM1');
    const result: FgInItem[] = [];
    const colF = 5, colJ = 9, colM = 12, colN = 13, colU = 20;
    const dataRows = rows.slice(7);
    dataRows.forEach((row) => {
      const maTP = row && (row[colF] != null) ? String(row[colF]).trim() : '';
      if (!maTP) return;
      const soLuong = Number(row[colJ]);
      const qty = isNaN(soLuong) || soLuong <= 0 ? 0 : Math.floor(soLuong);
      const lsx = row && (row[colM] != null) ? String(row[colM]).trim() : '';
      const poNumber = row && (row[colN] != null) ? String(row[colN]).trim() : '';
      let lot = row && (row[colU] != null) ? String(row[colU]).trim() : '';
      if (lot.length > 8) lot = lot.substring(0, 8);
      result.push({
        factory,
        importDate: new Date(),
        batchNumber: this.generateBatchNumber(result.length, factory),
        materialCode: maTP,
        rev: '',
        poNumber: poNumber || undefined,
        lot,
        lsx,
        quantity: qty,
        carton: 0,
        odd: 0,
        location: 'Temporary',
        notes: '',
        customer: '',
        isReceived: false,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });
    return result;
  }

  private async processExcelFile(file: File): Promise<void> {
    try {
      const data = await this.readExcelFile(file);
      const materials = this.parseExcelData(data);
      
      // Save to Firebase and wait for completion
      await this.saveMaterialsToFirebase(materials);
      
      // Refresh data from Firebase to get the latest state
      this.refreshData();
      
      alert(`✅ Đã import thành công ${materials.length} materials từ file Excel!`);
      
    } catch (error) {
      console.error('Error processing Excel file:', error);
      alert(`❌ Lỗi khi import file Excel: ${error.message || error}`);
    }
  }

  private async readExcelFile(file: File): Promise<any[]> {
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

  private parseExcelData(data: any[]): FgInItem[] {
    return data.map((row: any, index: number) => {
      const factoryRaw = (row['Factory'] || row['factory'] || 'ASM1').toString().trim().toUpperCase();
      const factory = factoryRaw === 'ASM2' ? 'ASM2' : 'ASM1';
      return {
        factory,
        importDate: new Date(),
        batchNumber: this.generateBatchNumber(index, factory),
        materialCode: row['Mã TP'] || '',
        rev: row['REV'] || '',
        lot: row['LOT'] || '',
        lsx: row['LSX'] || '',
        quantity: parseInt(row['Lượng Nhập'], 10) || 0,
        carton: 0,
        odd: 0,
        location: (row['Vị trí'] || row['Vi tri'] || 'Temporary').toString().trim() || 'Temporary',
        notes: row['Ghi chú'] || '',
        customer: '',
        isReceived: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };
    });
  }

  private parseDate(dateStr: string): Date | null {
    if (!dateStr || dateStr.trim() === '') return null;
    
    if (typeof dateStr === 'string' && dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      }
    }
    
    return new Date(dateStr);
  }

  // Save materials to Firebase
  saveMaterialsToFirebase(materials: FgInItem[]): Promise<void> {
    const savePromises = materials.map(material => {
      const materialData = {
        ...material,
        importDate: material.importDate,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      delete materialData.id;
      
      return this.firestore.collection('fg-in').add(materialData)
        .then((docRef) => {
          console.log('FG In material saved to Firebase successfully with ID:', docRef.id);
          return docRef.id;
        })
        .catch(error => {
          console.error('Error saving FG In material to Firebase:', error);
          throw error;
        });
    });
    
    return Promise.all(savePromises).then(() => {
      console.log('All materials saved to Firebase successfully');
    });
  }

  // Batch 9 số: Prefix Factory + DDMM + 4 số thứ tự
  // ASM1: A11030001, ASM2: B11030001
  private generateBatchNumber(offset: number = 0, factory: string = 'ASM1'): string {
    const now = new Date();
    const dd = ('0' + now.getDate()).slice(-2);
    const mm = ('0' + (now.getMonth() + 1)).slice(-2);
    const datePrefix = dd + mm;
    const factoryPrefix = factory === 'ASM2' ? 'B' : 'A';
    const fullPrefix = factoryPrefix + datePrefix; // A1103 hoặc B1103
    
    // Lọc materials cùng factory và cùng ngày
    const todayBatchNumbers = this.materials.filter(m => {
      if ((m.factory || 'ASM1') !== factory) return false;
      const batch = (m.batchNumber || '').toUpperCase();
      // Kiểm tra batch bắt đầu bằng đúng prefix (A1103 hoặc B1103)
      return batch.startsWith(fullPrefix) && batch.length >= 9;
    });
    
    let maxSeq = 0;
    todayBatchNumbers.forEach(m => {
      const batch = (m.batchNumber || '').toUpperCase();
      // Lấy 4 số cuối (bỏ qua suffix A, B, C nếu có)
      const seqPart = batch.slice(5, 9); // Ví dụ: A11030001 -> 0001
      const seq = parseInt(seqPart, 10);
      if (!isNaN(seq)) maxSeq = Math.max(maxSeq, seq);
    });
    
    const nextSeq = maxSeq + 1 + offset;
    return fullPrefix + nextSeq.toString().padStart(4, '0');
  }

    // Download template - khớp form Nhập kho: Factory, Mã TP, LOT, LSX, Lượng Nhập, Vị trí, Ghi chú
  downloadTemplate(): void {
      const templateData = [
        {
          'Factory': 'ASM1',
          'Mã TP': 'FG001',
          'LOT': 'LOT001',
          'LSX': 'LSX001',
          'Lượng Nhập': 100,
          'Vị trí': 'Temporary',
          'Ghi chú': 'All items received in good condition'
        },
        {
          'Factory': 'ASM2',
          'Mã TP': 'FG002',
          'LOT': 'LOT002',
          'LSX': 'LSX002',
          'Lượng Nhập': 200,
          'Vị trí': 'Temporary',
          'Ghi chú': 'Second batch items'
        }
      ];

    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(templateData);
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'FG_In_Template.xlsx');
  }

  // Additional methods needed for the component
  editLocation(material: FgInItem): void {
    const newLocation = prompt('Nhập vị trí (sẽ tự động viết hoa):', material.location || '');
    if (newLocation !== null) {
      material.location = newLocation.toUpperCase();
      material.updatedAt = new Date();
      console.log(`Updated location for ${material.materialCode}: ${material.location}`);
      this.updateMaterialInFirebase(material);
    }
  }

  updateNotes(material: FgInItem): void {
    console.log('Updating notes for material:', material.materialCode, 'to:', material.notes);
    this.updateMaterialInFirebase(material);
  }

  // UNHIDE Dialog Functions
  openUnhideDialog(): void {
    this.showUnhideDialog = true;
    this.unhideMaterialCode = '';
  }

  closeUnhideDialog(): void {
    this.showUnhideDialog = false;
    this.unhideMaterialCode = '';
  }

  onUnhideInput(): void {
    // Convert to uppercase
    this.unhideMaterialCode = this.unhideMaterialCode.toUpperCase();
  }

  applyUnhideFilter(): void {
    if (this.unhideMaterialCode.length < 7) {
      alert('⚠️ Vui lòng nhập ít nhất 7 ký tự');
      return;
    }

    const prefix = this.unhideMaterialCode.substring(0, 7);
    console.log('🔍 Unhiding materials with prefix:', prefix);

    // Mở rộng khoảng thời gian để tìm tất cả
    this.startDate = new Date(2020, 0, 1);
    this.endDate = new Date(2030, 11, 31);
    
    // Apply filters sẽ tự filter theo searchTerm
    this.searchTerm = prefix;
    this.applyFilters();
    
    this.closeUnhideDialog();
    console.log(`✅ Showing materials starting with ${prefix}:`, this.filteredMaterials.length);
  }

  // REPORT Dialog Functions
  openReportDialog(): void {
    this.showReportDialog = true;
    // Set default to current month
    const now = new Date();
    this.reportMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  closeReportDialog(): void {
    this.showReportDialog = false;
    this.reportMonth = '';
  }

  downloadReport(): void {
    if (!this.reportMonth) {
      alert('⚠️ Vui lòng chọn tháng');
      return;
    }

    const [year, month] = this.reportMonth.split('-');
    const startOfMonth = new Date(parseInt(year), parseInt(month) - 1, 1);
    const endOfMonth = new Date(parseInt(year), parseInt(month), 0);

    console.log('📊 Downloading report for:', this.reportMonth);
    console.log('Date range:', startOfMonth, 'to', endOfMonth);

    // Query materials within the month
    this.firestore.collection('fg-in', ref =>
      ref.where('importDate', '>=', startOfMonth)
         .where('importDate', '<=', endOfMonth)
         .orderBy('importDate', 'desc')
    ).get().subscribe(snapshot => {
      const reportData: any[] = [];
      
      snapshot.docs.forEach(doc => {
        const data = doc.data() as any;
        reportData.push({
          'Ngày': this.formatDate(data.importDate),
          'Batch': data.batchNumber || '',
          'Mã TP': data.materialCode || '',
          'LOT': data.lot || '',
          'LSX': data.lsx || '',
          'Số lượng': data.quantity || 0,
          'Vị trí': data.location || '',
          'Ghi chú': data.notes || '',
          'Khách': this.getCustomerNameFromMapping(data.materialCode),
          'Lock': data.isReceived ? 'Đã Lock' : 'Chưa Lock'
        });
      });

      if (reportData.length === 0) {
        alert('❌ Không có dữ liệu trong tháng này');
        return;
      }

      // Export to Excel
      const ws = XLSX.utils.json_to_sheet(reportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `FG In ${this.reportMonth}`);
      
      const fileName = `FG_In_Report_${this.reportMonth}.xlsx`;
      XLSX.writeFile(wb, fileName);
      
      console.log(`✅ Downloaded report: ${fileName}`);
      alert(`✅ Đã tải báo cáo: ${fileName} (${reportData.length} dòng)`);
      this.closeReportDialog();
    });
  }

  viewAllMaterials(): void {
    this.startDate = new Date(2020, 0, 1);
    this.endDate = new Date(2030, 11, 31);
    this.showCompleted = true;
    this.selectedFactory = 'TOTAL';
    this.applyFilters();
    this.showTimeRangeDialog = false;
    
    console.log('View all FG In materials:', {
      totalMaterials: this.materials.length,
      filteredMaterials: this.filteredMaterials.length,
      materials: this.materials
    });
  }

  applyTimeRangeFilter(): void {
    this.applyFilters();
    this.showTimeRangeDialog = false;
  }

  // ===== PRODUCT CATALOG METHODS =====

  // Load catalog from Firebase - One-time load when needed
  loadCatalogFromFirebase(): void {
    this.firestore.collection('fg-catalog')
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe((querySnapshot) => {
        const firebaseCatalog = querySnapshot.docs.map(doc => {
          const data = doc.data() as any;
          const id = doc.id;
          return {
            id: id,
            ...data,
            createdAt: data.createdAt ? new Date(data.createdAt.seconds * 1000) : new Date(),
            updatedAt: data.updatedAt ? new Date(data.updatedAt.seconds * 1000) : new Date()
          };
        });
        
        this.catalogItems = firebaseCatalog;
        this.applyCatalogFilters();
        this.buildMergedCatalogItems();
        console.log('Loaded FG Catalog from Firebase:', this.catalogItems.length);
      });
  }

  // Show catalog dialog (dùng chung cho cả Danh mục TP và Mapping KH-TP)
  showCatalog(): void {
    this.showCatalogDialog = true;
    if (this.catalogItems.length === 0) this.loadCatalogFromFirebase();
    if (this.mappingItems.length === 0) this.loadMappingFromFirebase();
    this.buildMergedCatalogItems();
    this.applyMergedCatalogFilters();
  }

  // Mapping mở cùng dialog gộp
  showMapping(): void {
    this.showCatalogDialog = true;
    if (this.catalogItems.length === 0) this.loadCatalogFromFirebase();
    if (this.mappingItems.length === 0) this.loadMappingFromFirebase();
    this.buildMergedCatalogItems();
    this.applyMergedCatalogFilters();
  }

  // Close catalog dialog
  closeCatalog(): void {
    this.showCatalogDialog = false;
    this.catalogSearchTerm = '';
    this.mergedSearchTerm = '';
    this.newCatalogItem = { materialCode: '', standard: '', customer: '', customerCode: '' };
    this.newMergedItem = { materialCode: '', standard: '', customerCode: '', description: '' };
  }

  onMergedSearchChange(event: any): void {
    this.mergedSearchTerm = event.target.value;
    this.applyMergedCatalogFilters();
  }

  // Thêm một dòng gộp: ghi vào cả fg-catalog và fg-customer-mapping
  addMergedCatalogItem(): void {
    const mc = (this.newMergedItem.materialCode || '').trim();
    const cc = (this.newMergedItem.customerCode || '').trim();
    const desc = (this.newMergedItem.description || '').trim();
    const std = (this.newMergedItem.standard || '').trim();
    if (!mc && !cc) {
      alert('❌ Vui lòng nhập ít nhất Mã TP hoặc Mã KH');
      return;
    }
    const key = `${mc.toUpperCase()}|${cc.toUpperCase()}`;
    const exists = this.mergedCatalogItems.some(
      m => `${(m.materialCode || '').toUpperCase()}|${(m.customerCode || '').toUpperCase()}` === key
    );
    if (exists) {
      alert(`❌ Cặp Mã TP "${mc}" + Mã KH "${cc}" đã tồn tại`);
      return;
    }
    const catalogData = {
      materialCode: mc,
      standard: std,
      customer: desc,
      customerCode: cc,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const mappingData = {
      customerCode: cc,
      materialCode: mc,
      description: desc,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.firestore.collection('fg-catalog').add(catalogData).then(docCatalog => {
      this.firestore.collection('fg-customer-mapping').add(mappingData).then(() => {
        this.loadCatalogFromFirebase();
        this.loadMappingFromFirebase();
        this.newMergedItem = { materialCode: '', standard: '', customerCode: '', description: '' };
        alert('✅ Đã thêm vào danh mục & mapping');
      }).catch(err => {
        console.error('Error adding mapping:', err);
        alert('❌ Lỗi khi thêm mapping: ' + (err?.message || err));
      });
    }).catch(err => {
      console.error('Error adding catalog:', err);
      alert('❌ Lỗi khi thêm danh mục: ' + (err?.message || err));
    });
  }

  // Xóa một dòng gộp: xóa cả catalog và mapping (nếu có)
  deleteMergedCatalogItem(item: MergedCatalogItem): void {
    const label = `Mã TP "${item.materialCode}" / Mã KH "${item.customerCode}"`;
    if (!confirm(`Xác nhận xóa ${label}?`)) return;
    const done = () => {
      this.loadCatalogFromFirebase();
      this.loadMappingFromFirebase();
      alert('✅ Đã xóa');
    };
    let pending = 0;
    if (item.catalogId) {
      pending++;
      this.firestore.collection('fg-catalog').doc(item.catalogId).delete().then(() => { pending--; if (pending === 0) done(); }).catch(() => { pending--; if (pending === 0) done(); });
    }
    if (item.mappingId) {
      pending++;
      this.firestore.collection('fg-customer-mapping').doc(item.mappingId).delete().then(() => { pending--; if (pending === 0) done(); }).catch(() => { pending--; if (pending === 0) done(); });
    }
    if (pending === 0) done();
  }

  // Import Excel gộp: cột Mã TP, Standard, Mã KH, Tên KH -> ghi cả catalog + mapping
  // Nếu trùng Mã TP + Mã KH → ghi đè Standard và Tên KH
  // Nếu không trùng → thêm mới
  importMergedCatalog(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,.xls';
    fileInput.style.display = 'none';
    fileInput.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data: any[] = await this.readExcelFile(file);
        const rows = (data || []).map((row: any) => ({
          materialCode: (row['Mã TP'] || '').toString().trim(),
          standard: (row['Standard'] || '').toString().trim(),
          customerCode: (row['Mã KH'] || row['Mã khách hàng'] || row['Mã Khách Hàng'] || '').toString().trim(),
          description: (row['Tên KH'] || row['Khách'] || row['Mô Tả'] || '').toString().trim()
        })).filter(r => r.materialCode || r.customerCode);
        
        if (rows.length === 0) {
          alert('❌ Không có dòng hợp lệ (cần Mã TP hoặc Mã KH)');
          return;
        }
        
        const key = (mc: string, cc: string) => `${mc.toUpperCase()}|${cc.toUpperCase()}`;
        let addedCount = 0;
        let updatedCount = 0;
        
        for (const r of rows) {
          const rowKey = key(r.materialCode, r.customerCode);
          const existing = this.mergedCatalogItems.find(m => key(m.materialCode, m.customerCode) === rowKey);
          
          if (existing && existing.catalogId) {
            // Trùng → ghi đè Standard và Tên KH
            await this.firestore.collection('fg-catalog').doc(existing.catalogId).update({
              standard: r.standard,
              customer: r.description,
              updatedAt: new Date()
            });
            // Cập nhật mapping nếu có
            if (existing.mappingId) {
              await this.firestore.collection('fg-customer-mapping').doc(existing.mappingId).update({
                description: r.description,
                updatedAt: new Date()
              });
            }
            updatedCount++;
          } else {
            // Không trùng → thêm mới
            await this.firestore.collection('fg-catalog').add({
              materialCode: r.materialCode,
              standard: r.standard,
              customer: r.description,
              customerCode: r.customerCode,
              createdAt: new Date(),
              updatedAt: new Date()
            });
            await this.firestore.collection('fg-customer-mapping').add({
              customerCode: r.customerCode,
              materialCode: r.materialCode,
              description: r.description,
              createdAt: new Date(),
              updatedAt: new Date()
            });
            addedCount++;
          }
        }
        
        this.loadCatalogFromFirebase();
        this.loadMappingFromFirebase();
        alert(`✅ Import hoàn tất!\n- Thêm mới: ${addedCount} dòng\n- Ghi đè: ${updatedCount} dòng`);
      } catch (err: any) {
        alert('❌ Lỗi đọc file: ' + (err?.message || err));
      }
    };
    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
  }

  // Xóa toàn bộ danh mục để import lại từ đầu
  async deleteAllCatalog(): Promise<void> {
    const count = this.mergedCatalogItems.length;
    if (count === 0) {
      alert('❌ Danh mục đang trống!');
      return;
    }
    
    if (!confirm(`⚠️ Bạn có chắc muốn xóa TẤT CẢ ${count} dòng danh mục?\n\nHành động này không thể hoàn tác!`)) {
      return;
    }
    
    // Yêu cầu nhập mật khẩu
    const password = prompt('Nhập mật khẩu để xác nhận xóa:');
    if (password !== '111') {
      alert('❌ Mật khẩu không đúng!');
      return;
    }
    
    try {
      let deletedCount = 0;
      
      for (const item of this.mergedCatalogItems) {
        if (item.catalogId) {
          await this.firestore.collection('fg-catalog').doc(item.catalogId).delete();
        }
        if (item.mappingId) {
          await this.firestore.collection('fg-customer-mapping').doc(item.mappingId).delete();
        }
        deletedCount++;
      }
      
      this.loadCatalogFromFirebase();
      this.loadMappingFromFirebase();
      alert(`✅ Đã xóa ${deletedCount} dòng danh mục!`);
    } catch (err: any) {
      console.error('Error deleting catalog:', err);
      alert('❌ Lỗi khi xóa: ' + (err?.message || err));
    }
  }

  downloadMergedCatalogTemplate(): void {
    const templateData = [
      { 'Mã TP': 'FG001', 'Standard': '100', 'Mã KH': 'CUST001', 'Tên KH': 'Khách hàng A' },
      { 'Mã TP': 'FG002', 'Standard': '200', 'Mã KH': 'CUST002', 'Tên KH': 'Khách hàng B' }
    ];
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(templateData);
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'FG_DanhMuc_Mapping_Template.xlsx');
  }

  /** Tải về danh mục đang hiển thị (theo ô tìm kiếm hiện tại) */
  downloadMergedCatalogCurrent(): void {
    const rows = (this.filteredMergedCatalogItems || []).map(item => ({
      'Mã TP': item.materialCode || '',
      'Standard': item.standard || '',
      'Mã KH': item.customerCode || '',
      'Tên KH': item.description || ''
    }));

    if (rows.length === 0) {
      alert('❌ Không có dữ liệu để tải');
      return;
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Danh mục');

    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    XLSX.writeFile(wb, `FG_DanhMuc_${stamp}.xlsx`);
  }

  // Apply catalog filters
  applyCatalogFilters(): void {
    this.filteredCatalogItems = this.catalogItems.filter(item => {
      if (this.catalogSearchTerm) {
        const searchableText = [
          item.materialCode,
          item.standard,
          item.customer,
          item.customerCode
        ].filter(Boolean).join(' ').toUpperCase();
        
        if (!searchableText.includes(this.catalogSearchTerm.toUpperCase())) {
    return false;
  }
      }
      return true;
    });
  }

  // Search catalog
  onCatalogSearchChange(event: any): void {
    this.catalogSearchTerm = event.target.value;
    this.applyCatalogFilters();
  }

  // Import catalog from Excel
  importCatalog(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,.xls';
    fileInput.style.display = 'none';
    
    fileInput.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.processCatalogExcelFile(file);
      }
    };
    
    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
  }

  private async processCatalogExcelFile(file: File): Promise<void> {
    try {
      const data = await this.readExcelFile(file);
      const catalogItems = this.parseCatalogExcelData(data);
      
      // Check for duplicates
      const duplicates = catalogItems.filter(newItem => 
        this.catalogItems.some(existingItem => 
          existingItem.materialCode === newItem.materialCode
        )
      );
      
      if (duplicates.length > 0) {
        const duplicateCodes = duplicates.map(d => d.materialCode).join(', ');
        alert(`❌ Có ${duplicates.length} mã TP trùng lặp: ${duplicateCodes}`);
        return;
      }
      
      // Save to Firebase
      this.saveCatalogItemsToFirebase(catalogItems);
      
      // Refresh catalog data
      this.loadCatalogFromFirebase();
      
      alert(`✅ Đã import thành công ${catalogItems.length} items vào danh mục!`);
      
    } catch (error) {
      console.error('Error processing catalog Excel file:', error);
      alert(`❌ Lỗi khi import file Excel: ${error.message || error}`);
    }
  }

  private parseCatalogExcelData(data: any[]): ProductCatalogItem[] {
    return data.map((row: any, index: number) => ({
      materialCode: row['Mã TP'] || '',
      standard: row['Standard'] || '',
      customer: row['Khách'] || '',
      customerCode: row['Mã khách hàng'] || row['Mã Khách Hàng'] || row['Customer Code'] || '',
      createdAt: new Date(),
      updatedAt: new Date()
    })).filter(item => item.materialCode.trim() !== ''); // Filter out empty rows
  }

  // Save catalog items to Firebase
  saveCatalogItemsToFirebase(catalogItems: ProductCatalogItem[]): void {
    catalogItems.forEach(item => {
      const itemData = {
        ...item,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      delete itemData.id;
      
      this.firestore.collection('fg-catalog').add(itemData)
        .then((docRef) => {
          console.log('FG Catalog item saved to Firebase successfully with ID:', docRef.id);
        })
        .catch(error => {
          console.error('Error saving FG Catalog item to Firebase:', error);
        });
    });
  }

  // Add new catalog item manually
  addCatalogItem(): void {
    if (!this.newCatalogItem.materialCode.trim()) {
      alert('❌ Vui lòng nhập Mã TP');
      return;
    }

    // Check for duplicate
    const isDuplicate = this.catalogItems.some(item => 
      item.materialCode === this.newCatalogItem.materialCode
    );

    if (isDuplicate) {
      alert(`❌ Mã TP "${this.newCatalogItem.materialCode}" đã tồn tại trong danh mục`);
      return;
    }

    const newItem = {
      ...this.newCatalogItem,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.firestore.collection('fg-catalog').add(newItem)
      .then((docRef) => {
        console.log('FG Catalog item added successfully with ID:', docRef.id);
        alert(`✅ Đã thêm "${newItem.materialCode}" vào danh mục`);
        
        // Refresh catalog data
        this.loadCatalogFromFirebase();
        
        // Reset form
        this.newCatalogItem = {
          materialCode: '',
          standard: '',
          customer: '',
          customerCode: ''
        };
      })
      .catch(error => {
        console.error('Error adding FG Catalog item:', error);
        alert(`❌ Lỗi khi thêm item: ${error.message || error}`);
      });
  }

  // Delete catalog item - Using same approach as clearAllData
  deleteCatalogItem(item: ProductCatalogItem): void {
    if (confirm(`Xác nhận xóa "${item.materialCode}" khỏi danh mục?`)) {
      if (item.id) {
        // Use the same approach as clearAllData - get document reference and delete
        this.firestore.collection('fg-catalog').doc(item.id).get().subscribe(doc => {
          if (doc.exists) {
            doc.ref.delete().then(() => {
              console.log('FG Catalog item deleted from Firebase successfully');
              alert(`✅ Đã xóa "${item.materialCode}" khỏi danh mục`);
              // Refresh catalog data
              this.loadCatalogFromFirebase();
            }).catch(error => {
              console.error('Error deleting FG Catalog item from Firebase:', error);
              alert(`❌ Lỗi khi xóa item: ${error.message || error}`);
            });
          } else {
            console.error('❌ Catalog document does not exist in Firebase');
            alert('❌ Không tìm thấy item trong Firebase');
          }
        });
      }
    }
  }

  // Download catalog template
  downloadCatalogTemplate(): void {
    const templateData = [
      {
        'Mã TP': 'FG001',
        'Standard': 'STD001',
        'Khách': 'Customer A',
        'Mã khách hàng': 'CUST001'
      },
      {
        'Mã TP': 'FG002',
        'Standard': 'STD002',
        'Khách': 'Customer B',
        'Mã khách hàng': 'CUST002'
      }
    ];

    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(templateData);
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'FG_Catalog_Template.xlsx');
  }

  // Sync customer code from mapping to catalog
  syncCustomerCodeFromMapping(): void {
    console.log('🔄 Starting sync customer code from mapping to catalog...');
    
    // Ensure mapping is loaded
    if (this.mappingItems.length === 0) {
      this.loadMappingFromFirebase();
      // Wait a bit for mapping to load
      setTimeout(() => {
        this.performSync();
      }, 500);
    } else {
      this.performSync();
    }
  }

  private performSync(): void {
    if (this.mappingItems.length === 0) {
      alert('❌ Không có dữ liệu mapping để đồng bộ!');
      return;
    }

    if (this.catalogItems.length === 0) {
      alert('❌ Không có dữ liệu catalog để đồng bộ!');
      return;
    }

    let updatedCount = 0;
    let createdCount = 0;
    const updatePromises: Promise<void>[] = [];

    // Create a map: materialCode -> customerCode from mapping
    const mappingMap = new Map<string, string>();
    this.mappingItems.forEach(mapping => {
      if (mapping.materialCode && mapping.customerCode) {
        // If multiple mappings for same materialCode, keep the first one
        if (!mappingMap.has(mapping.materialCode)) {
          mappingMap.set(mapping.materialCode, mapping.customerCode);
        }
      }
    });

    console.log(`📊 Found ${mappingMap.size} unique material codes in mapping`);

    // Update existing catalog items
    this.catalogItems.forEach(catalogItem => {
      if (catalogItem.materialCode && catalogItem.id) {
        const customerCodeFromMapping = mappingMap.get(catalogItem.materialCode);
        
        if (customerCodeFromMapping) {
          // Only update if customerCode is different or empty
          if (catalogItem.customerCode !== customerCodeFromMapping) {
            console.log(`🔄 Updating catalog item ${catalogItem.materialCode}: ${catalogItem.customerCode || '(empty)'} -> ${customerCodeFromMapping}`);
            updatedCount++;
            
            const updatePromise = this.firestore.collection('fg-catalog').doc(catalogItem.id).update({
              customerCode: customerCodeFromMapping,
              updatedAt: new Date()
            })
            .then(() => {
              // Update local item
              catalogItem.customerCode = customerCodeFromMapping;
              console.log(`✅ Updated catalog item ${catalogItem.materialCode}`);
            })
            .catch(error => {
              console.error(`❌ Error updating catalog item ${catalogItem.materialCode}:`, error);
            });
            
            updatePromises.push(updatePromise);
          }
        }
      }
    });

    // Wait for all updates to complete
    Promise.all(updatePromises).then(() => {
      // Refresh catalog data
      this.loadCatalogFromFirebase();
      
      if (updatedCount > 0) {
        alert(`✅ Đã đồng bộ ${updatedCount} items trong catalog với Mã khách hàng từ mapping!`);
      } else {
        alert('ℹ️ Tất cả items đã có Mã khách hàng đúng hoặc không có mapping tương ứng.');
      }
    }).catch(error => {
      console.error('❌ Error during sync:', error);
      alert(`❌ Lỗi khi đồng bộ: ${error.message || error}`);
    });
  }

  // ===== CUSTOMER CODE MAPPING METHODS =====

  // Load mapping from Firebase
  loadMappingFromFirebase(): void {
    this.firestore.collection('fg-customer-mapping')
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe((querySnapshot) => {
        const firebaseMapping = querySnapshot.docs.map(doc => {
          const data = doc.data() as any;
          const id = doc.id;
          return {
            id: id,
            ...data,
            createdAt: data.createdAt ? new Date(data.createdAt.seconds * 1000) : new Date(),
            updatedAt: data.updatedAt ? new Date(data.updatedAt.seconds * 1000) : new Date()
          };
        });
        
        this.mappingItems = firebaseMapping;
        this.applyMappingFilters();
        this.buildMergedCatalogItems();
        console.log('Loaded Customer Code Mapping from Firebase:', this.mappingItems.length);
      });
  }

  /** Gộp catalog + mapping theo key (materialCode, customerCode) */
  buildMergedCatalogItems(): void {
    const map = new Map<string, MergedCatalogItem>();
    const norm = (v: any) => String(v ?? '').trim();
    const key = (mc: any, cc: any) => `${norm(mc).toUpperCase()}|${norm(cc).toUpperCase()}`;
    this.catalogItems.forEach(c => {
      const k = key(c.materialCode, c.customerCode);
      map.set(k, {
        catalogId: c.id,
        materialCode: norm(c.materialCode),
        customerCode: norm(c.customerCode),
        description: norm(c.customer),
        standard: norm(c.standard)
      });
    });
    this.mappingItems.forEach(m => {
      const k = key(m.materialCode, m.customerCode);
      const existing = map.get(k);
      if (existing) {
        existing.mappingId = m.id;
        const desc = norm(m.description);
        if (desc) existing.description = desc;
      } else {
        map.set(k, {
          mappingId: m.id,
          materialCode: norm(m.materialCode),
          customerCode: norm(m.customerCode),
          description: norm(m.description),
          standard: ''
        });
      }
    });
    this.mergedCatalogItems = Array.from(map.values()).filter(m => m.materialCode || m.customerCode);
    this.applyMergedCatalogFilters();
  }

  applyMergedCatalogFilters(): void {
    const term = (this.mergedSearchTerm || '').toUpperCase();
    this.filteredMergedCatalogItems = term
      ? this.mergedCatalogItems.filter(item => {
          const s = [item.materialCode, item.customerCode, item.description, item.standard].filter(Boolean).join(' ').toUpperCase();
          return s.includes(term);
        })
      : [...this.mergedCatalogItems];
  }

  // Show mapping dialog
  // Close mapping dialog (giữ để tương thích nếu có gọi)
  closeMapping(): void {
    this.showMappingDialog = false;
    this.mappingSearchTerm = '';
    this.newMappingItem = {
      customerCode: '',
      materialCode: '',
      description: ''
    };
  }

  // Apply mapping filters
  applyMappingFilters(): void {
    this.filteredMappingItems = this.mappingItems.filter(item => {
      if (this.mappingSearchTerm) {
        const searchableText = [
          item.customerCode,
          item.materialCode,
          item.description
        ].filter(Boolean).join(' ').toUpperCase();
        
        if (!searchableText.includes(this.mappingSearchTerm.toUpperCase())) {
          return false;
        }
      }
      return true;
    });
  }

  // Search mapping
  onMappingSearchChange(event: any): void {
    this.mappingSearchTerm = event.target.value;
    this.applyMappingFilters();
  }

  // Import mapping from Excel
  importMapping(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,.xls';
    fileInput.style.display = 'none';
    
    fileInput.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.processMappingExcelFile(file);
      }
    };
    
    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
  }

  private async processMappingExcelFile(file: File): Promise<void> {
    try {
      const data = await this.readExcelFile(file);
      const mappingItems = this.parseMappingExcelData(data);
      
      // Check for duplicates
      const duplicates = mappingItems.filter(newItem => 
        this.mappingItems.some(existingItem => 
          existingItem.customerCode === newItem.customerCode
        )
      );
      
      if (duplicates.length > 0) {
        const duplicateCodes = duplicates.map(d => d.customerCode).join(', ');
        const confirmed = confirm(`⚠️ Có ${duplicates.length} mã khách hàng trùng lặp: ${duplicateCodes}\n\nBạn có muốn tiếp tục import?`);
        if (!confirmed) return;
      }
      
      // Save to Firebase
      this.saveMappingItemsToFirebase(mappingItems);
      
      // Refresh mapping data
      this.loadMappingFromFirebase();
      
      alert(`✅ Đã import thành công ${mappingItems.length} items vào mapping!`);
      
    } catch (error) {
      console.error('Error processing mapping Excel file:', error);
      alert(`❌ Lỗi khi import file Excel: ${error.message || error}`);
    }
  }

  private parseMappingExcelData(data: any[]): CustomerCodeMappingItem[] {
    return data.map((row: any) => ({
      customerCode: row['Mã Khách Hàng'] || row['Customer Code'] || '',
      materialCode: row['Mã Thành Phẩm'] || row['Material Code'] || '',
      description: row['Mô Tả'] || row['Description'] || '',
      createdAt: new Date(),
      updatedAt: new Date()
    })).filter(item => item.customerCode.trim() !== '' && item.materialCode.trim() !== ''); // Filter out empty rows
  }

  // Save mapping items to Firebase
  saveMappingItemsToFirebase(mappingItems: CustomerCodeMappingItem[]): void {
    mappingItems.forEach(item => {
      const itemData = {
        ...item,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      delete itemData.id;
      
      this.firestore.collection('fg-customer-mapping').add(itemData)
        .then((docRef) => {
          console.log('Customer Code Mapping item saved to Firebase successfully with ID:', docRef.id);
        })
        .catch(error => {
          console.error('Error saving Customer Code Mapping item to Firebase:', error);
        });
    });
  }

  // Add new mapping item manually
  addMappingItem(): void {
    if (!this.newMappingItem.customerCode.trim() || !this.newMappingItem.materialCode.trim()) {
      alert('❌ Vui lòng nhập đầy đủ Mã Khách Hàng và Mã Thành Phẩm');
      return;
    }

    // Check for duplicate
    const isDuplicate = this.mappingItems.some(item => 
      item.customerCode === this.newMappingItem.customerCode
    );

    if (isDuplicate) {
      const confirmed = confirm(`⚠️ Mã Khách Hàng "${this.newMappingItem.customerCode}" đã tồn tại trong mapping.\n\nBạn có muốn thêm duplicate?`);
      if (!confirmed) return;
    }

    const newItem = {
      ...this.newMappingItem,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.firestore.collection('fg-customer-mapping').add(newItem)
      .then((docRef) => {
        console.log('Customer Code Mapping item added successfully with ID:', docRef.id);
        alert(`✅ Đã thêm mapping "${newItem.customerCode}" → "${newItem.materialCode}"`);
        
        // Refresh mapping data
        this.loadMappingFromFirebase();
        
        // Reset form
        this.newMappingItem = {
          customerCode: '',
          materialCode: '',
          description: ''
        };
      })
      .catch(error => {
        console.error('Error adding Customer Code Mapping item:', error);
        alert(`❌ Lỗi khi thêm item: ${error.message || error}`);
      });
  }

  // Delete mapping item
  deleteMappingItem(item: CustomerCodeMappingItem): void {
    if (confirm(`Xác nhận xóa mapping "${item.customerCode}" → "${item.materialCode}"?`)) {
      if (item.id) {
        this.firestore.collection('fg-customer-mapping').doc(item.id).get().subscribe(doc => {
          if (doc.exists) {
            doc.ref.delete().then(() => {
              console.log('Customer Code Mapping item deleted from Firebase successfully');
              alert(`✅ Đã xóa mapping "${item.customerCode}"`);
              // Refresh mapping data
              this.loadMappingFromFirebase();
            }).catch(error => {
              console.error('Error deleting Customer Code Mapping item from Firebase:', error);
              alert(`❌ Lỗi khi xóa item: ${error.message || error}`);
            });
          } else {
            console.error('❌ Mapping document does not exist in Firebase');
            alert('❌ Không tìm thấy item trong Firebase');
          }
        });
      }
    }
  }

  // Download mapping template
  downloadMappingTemplate(): void {
    const templateData = [
      {
        'Mã Khách Hàng': 'CUST001',
        'Mã Thành Phẩm': 'P001234',
        'Mô Tả': 'Customer 1 Product Mapping'
      },
      {
        'Mã Khách Hàng': 'CUST002',
        'Mã Thành Phẩm': 'P002345',
        'Mô Tả': 'Customer 2 Product Mapping'
      }
    ];

    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(templateData);
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'FG_Customer_Mapping_Template.xlsx');
  }

  // Get material code from customer code mapping
  getMaterialCodeFromCustomerCode(customerCode: string): string {
    const mapping = this.mappingItems.find(item => item.customerCode === customerCode);
    return mapping ? mapping.materialCode : '';
  }

  // ===== CONFIRM RECEIPT DIALOG METHODS =====

  // Open confirm receipt dialog when clicking on a pending receipt
  openConfirmReceiptDialog(material: FgInItem): void {
    const needsLocationUpdate =
      material.isReceived === true && this.isTemporaryLocation(material.location);

    // Đã khóa nhưng đã có vị trí thật thì không mở dialog
    if (material.isReceived && !needsLocationUpdate) {
      return;
    }

    this.selectedReceiptMaterial = material;
    this.locationUpdateOnlyMode = needsLocationUpdate;

    this.confirmReceiptData = {
      materialCodeConfirmed: false,
      poConfirmed: false,
      lsxConfirmed: false,
      lotConfirmed: false,
      quantityConfirmed: false,
      location: ''  // Always empty - requires scanning
    };
    this.locationScannerValue = '';  // Clear scanner input
    
    // Multiple pallet - initialize
    this.isMultiplePallet = false;
    this.originalQuantity = material.quantity || 0;
    this.confirmQuantity = this.originalQuantity;
    
    this.showConfirmReceiptDialog = true;
    
    // Auto focus scanner input
    this.focusLocationScanner();
  }

  // Close confirm receipt dialog
  closeConfirmReceiptDialog(): void {
    this.showConfirmReceiptDialog = false;
    this.selectedReceiptMaterial = null;
    this.locationUpdateOnlyMode = false;
    this.confirmReceiptData = {
      materialCodeConfirmed: false,
      poConfirmed: false,
      lsxConfirmed: false,
      lotConfirmed: false,
      quantityConfirmed: false,
      location: ''
    };
    this.locationScannerValue = '';
    
    // Reset multiple pallet
    this.isMultiplePallet = false;
    this.confirmQuantity = 0;
    this.originalQuantity = 0;
  }

  // Toggle confirmation for a field
  toggleFieldConfirmation(field: 'materialCodeConfirmed' | 'poConfirmed' | 'lsxConfirmed' | 'lotConfirmed' | 'quantityConfirmed'): void {
    this.confirmReceiptData[field] = !this.confirmReceiptData[field];
  }

  // Check if all fields are confirmed
  isAllFieldsConfirmed(): boolean {
    // Update-only mode: chỉ cần location được scan/nhập
    if (this.locationUpdateOnlyMode) return true;
    return this.confirmReceiptData.materialCodeConfirmed &&
           this.confirmReceiptData.poConfirmed &&
           this.confirmReceiptData.lsxConfirmed &&
           this.confirmReceiptData.lotConfirmed &&
           this.confirmReceiptData.quantityConfirmed;
  }

  // Get count of remaining unconfirmed fields
  getRemainingConfirmCount(): number {
    let count = 0;
    if (!this.confirmReceiptData.materialCodeConfirmed) count++;
    if (!this.confirmReceiptData.poConfirmed) count++;
    if (!this.confirmReceiptData.lsxConfirmed) count++;
    if (!this.confirmReceiptData.lotConfirmed) count++;
    if (!this.confirmReceiptData.quantityConfirmed) count++;
    return count;
  }

  // Get pending materials (not yet locked)
  getPendingMaterials(): FgInItem[] {
    return this.filteredMaterials.filter(m => !m.isReceived);
  }

  // Get pending count
  getPendingCount(): number {
    return this.filteredMaterials.filter(m => !m.isReceived).length;
  }

  private isTemporaryLocation(location: string): boolean {
    const s = String(location ?? '').trim();
    if (!s) return true;
    return s.toUpperCase() === 'TEMPORARY';
  }

  // Mobile: đã tick khóa nhưng vẫn ở trạng thái Temporary (chưa có vị trí thật)
  getLockedWithoutLocationMaterials(): FgInItem[] {
    return this.filteredMaterials.filter(m => m.isReceived && this.isTemporaryLocation(m.location));
  }

  getLockedWithoutLocationCount(): number {
    return this.getLockedWithoutLocationMaterials().length;
  }

  // Handle scanner input - auto uppercase
  onLocationScannerInput(): void {
    if (this.locationScannerValue) {
      this.locationScannerValue = this.locationScannerValue.toUpperCase();
      // Keep confirmation state in sync so the button can be enabled
      this.confirmReceiptData.location = this.locationScannerValue.trim().toUpperCase();
    } else {
      this.confirmReceiptData.location = '';
    }
  }

  // Handle Enter key from scanner
  onLocationScannerKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      this.saveScannedLocation();
    }
  }

  // Save the scanned location
  saveScannedLocation(): void {
    if (this.locationScannerValue && this.locationScannerValue.trim() !== '') {
      this.confirmReceiptData.location = this.locationScannerValue.trim().toUpperCase();
      console.log(`✅ Location saved: ${this.confirmReceiptData.location}`);
    }
  }

  // Clear scanner input
  clearLocationScanner(): void {
    this.locationScannerValue = '';
    this.confirmReceiptData.location = '';
    // Focus back to input
    setTimeout(() => {
      if (this.locationScannerInput) {
        this.locationScannerInput.nativeElement.focus();
      }
    }, 100);
  }

  // Focus scanner input when dialog opens
  focusLocationScanner(): void {
    setTimeout(() => {
      if (this.locationScannerInput) {
        this.locationScannerInput.nativeElement.focus();
      }
    }, 300);
  }

  // Parse batch number to get base and suffix (e.g. 11030001A -> base: 11030001, suffix: A)
  private getBatchBaseAndSuffix(batchNumber: string): { base: string; suffix: string } {
    if (!batchNumber || batchNumber.trim() === '') {
      return { base: '', suffix: '' };
    }
    const batch = batchNumber.trim();
    const lastChar = batch.slice(-1).toUpperCase();
    if (lastChar >= 'A' && lastChar <= 'Z') {
      return { base: batch.slice(0, -1), suffix: lastChar };
    }
    return { base: batch, suffix: '' };
  }

  // Get next suffix: '' -> A, A -> B, ..., Z -> AA
  private getNextSuffix(suffix: string): string {
    if (!suffix) return 'A';
    const chars = suffix.toUpperCase().split('');
    for (let i = chars.length - 1; i >= 0; i--) {
      if (chars[i] < 'Z') {
        chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
        return chars.join('');
      }
      chars[i] = 'A';
      if (i === 0) return 'A' + chars.join('');
    }
    return 'A';
  }

  // Get batch with suffix (e.g. 11030001 + A -> 11030001A)
  private getBatchWithSuffix(base: string, suffix: string): string {
    return base + suffix;
  }

  // Toggle multiple pallet checkbox
  toggleMultiplePallet(): void {
    this.isMultiplePallet = !this.isMultiplePallet;
    if (!this.isMultiplePallet) {
      // Reset to original quantity when unchecked
      this.confirmQuantity = this.originalQuantity;
    }
  }

  // Validate confirm quantity input
  onConfirmQuantityChange(): void {
    if (this.confirmQuantity < 0) {
      this.confirmQuantity = 0;
    }
    if (this.confirmQuantity > this.originalQuantity) {
      this.confirmQuantity = this.originalQuantity;
    }
  }

  // Confirm and lock the receipt
  confirmAndLockReceipt(): void {
    if (!this.selectedReceiptMaterial) {
      alert('❌ Không có phiếu được chọn');
      return;
    }

    if (!this.isAllFieldsConfirmed()) {
      alert('❌ Vui lòng xác nhận tất cả các thông tin trước khi khóa phiếu');
      return;
    }

    if (!this.confirmReceiptData.location || this.confirmReceiptData.location.trim() === '') {
      alert('❌ Vui lòng scan hoặc nhập vị trí trước khi khóa phiếu');
      return;
    }

    // ===== Chỉ cập nhật vị trí (phiếu đã tick khóa nhưng đang Temporary) =====
    if (this.locationUpdateOnlyMode) {
      const newLocation = this.confirmReceiptData.location.trim().toUpperCase();

      // Update fg-in (phiếu) location
      this.selectedReceiptMaterial.location = newLocation;
      this.selectedReceiptMaterial.updatedAt = new Date();
      this.updateMaterialInFirebase(this.selectedReceiptMaterial);

      // Update fg-inventory location (chỉ update trường location)
      this.updateInventoryLocationOnly(this.selectedReceiptMaterial, newLocation)
        .then(() => {
          this.closeConfirmReceiptDialog();
          this.refreshData();
          alert(`✅ Đã cập nhật vị trí cho batch: ${newLocation}`);
        })
        .catch(err => {
          console.error('Location update error:', err);
          alert(`❌ Lỗi cập nhật vị trí: ${err?.message || err}`);
        });
      return;
    }

    // Validate confirm quantity for multiple pallet
    if (this.isMultiplePallet) {
      if (this.confirmQuantity <= 0) {
        alert('❌ Số lượng xác nhận phải lớn hơn 0');
        return;
      }
      if (this.confirmQuantity > this.originalQuantity) {
        alert('❌ Số lượng xác nhận không được lớn hơn số lượng gốc');
        return;
      }
    }

    const quantityToConfirm = this.isMultiplePallet ? this.confirmQuantity : this.originalQuantity;
    const remainingQuantity = this.originalQuantity - quantityToConfirm;
    const isPartialConfirm = this.isMultiplePallet && remainingQuantity > 0;

    // Batch suffix for multiple pallet: A, B, C...
    let batchForInventory = this.selectedReceiptMaterial.batchNumber || '';
    let batchForRemaining = '';
    if (isPartialConfirm) {
      const { base, suffix } = this.getBatchBaseAndSuffix(this.selectedReceiptMaterial.batchNumber || '');
      const currentSuffix = suffix || 'A';
      batchForInventory = this.getBatchWithSuffix(base, currentSuffix);
      batchForRemaining = this.getBatchWithSuffix(base, this.getNextSuffix(currentSuffix));
    }

    let confirmMsg = `✅ Xác nhận khóa phiếu?\n\n` +
      `Mã TP: ${this.selectedReceiptMaterial.materialCode}\n` +
      `PO: ${this.selectedReceiptMaterial.poNumber || 'N/A'}\n` +
      `LSX: ${this.selectedReceiptMaterial.lsx}\n` +
      `LOT: ${this.selectedReceiptMaterial.lot}\n`;

    if (isPartialConfirm) {
      confirmMsg += `\n📦 NHẬP NHIỀU PALLET:\n` +
        `Batch vào kho: ${batchForInventory}\n` +
        `Số lượng: ${quantityToConfirm.toLocaleString()}\n` +
        `Batch còn lại: ${batchForRemaining}\n` +
        `Số lượng còn lại: ${remainingQuantity.toLocaleString()}\n`;
    } else {
      confirmMsg += `Batch: ${batchForInventory}\n` +
        `Số lượng: ${quantityToConfirm.toLocaleString()}\n`;
    }

    confirmMsg += `Vị trí: ${this.confirmReceiptData.location}\n\n` +
      `Dữ liệu sẽ được chuyển vào FG Inventory.`;

    if (!confirm(confirmMsg)) {
      return;
    }

    // Update location
    this.selectedReceiptMaterial.location = this.confirmReceiptData.location;
    this.selectedReceiptMaterial.updatedAt = new Date();

    if (isPartialConfirm) {
      // PARTIAL CONFIRMATION: Add suffix A, B, C... to batch
      console.log(`📦 Partial confirmation: ${quantityToConfirm} of ${this.originalQuantity}, batch ${batchForInventory} -> FG, ${batchForRemaining} remaining`);
      
      // Add confirmed quantity to FG Inventory with batch suffix (e.g. 11030001A)
      this.addToInventory(this.selectedReceiptMaterial, quantityToConfirm, batchForInventory);
      
      // Update fg-in record: remaining quantity with next batch suffix (e.g. 11030001B)
      this.selectedReceiptMaterial.quantity = remainingQuantity;
      this.selectedReceiptMaterial.batchNumber = batchForRemaining;
      this.selectedReceiptMaterial.isReceived = false;
      this.updateMaterialInFirebase(this.selectedReceiptMaterial);
      
      // Close dialog
      this.closeConfirmReceiptDialog();
      
      // Show success message
      alert(`✅ Đã xác nhận ${quantityToConfirm.toLocaleString()} sản phẩm!\n\n` +
        `Batch vào kho: ${batchForInventory}\n` +
        `Vị trí: ${this.confirmReceiptData.location}\n` +
        `Batch còn lại: ${batchForRemaining}\n` +
        `Số lượng còn lại: ${remainingQuantity.toLocaleString()} sản phẩm chờ xác nhận`);
    } else {
      // FULL CONFIRMATION: Confirm entire quantity
      this.selectedReceiptMaterial.isReceived = true;
      
      // Update in Firebase
      this.updateMaterialInFirebase(this.selectedReceiptMaterial);
      
      // Add to FG Inventory
      this.addToInventory(this.selectedReceiptMaterial);
      
      // Close dialog
      this.closeConfirmReceiptDialog();
      
      // Show success message
      alert(`✅ Đã khóa phiếu và chuyển vào FG Inventory!\n\nVị trí: ${this.selectedReceiptMaterial.location}`);
    }

    // Refresh data
    this.refreshData();
  }

  /**
   * Cập nhật CHỈ `location` trong FG Inventory cho batch tương ứng.
   * Không cộng/trừ tồn, không tạo doc mới.
   */
  private async updateInventoryLocationOnly(material: FgInItem, newLocation: string): Promise<void> {
    const factory = String(material.factory || this.selectedFactory || 'ASM1').trim().toUpperCase();
    const materialCodeNorm = String(material.materialCode || '').trim().toUpperCase();
    const batchNorm = String(material.batchNumber || '').trim().toUpperCase();
    const lsxNorm = String(material.lsx || '').trim().toUpperCase();
    const lotNorm = String(material.lot || '').trim().toUpperCase();

    if (!materialCodeNorm || !batchNorm) {
      throw new Error('Thiếu materialCode hoặc batchNumber để cập nhật vị trí.');
    }

    const invSnap = await this.firestore
      .collection('fg-inventory', ref => ref.where('factory', '==', factory))
      .get()
      .toPromise();

    const docs = invSnap?.docs || [];

    const matched = docs.filter(doc => {
      const d = doc.data() as any;
      const invCode = String(d.materialCode || d.maTP || '').trim().toUpperCase();
      const invBatch = String(d.batchNumber || d.batch || '').trim().toUpperCase();
      const invLsx = String(d.lsx || d.LSX || '').trim().toUpperCase();
      const invLot = String(d.lot || d.Lot || '').trim().toUpperCase();

      return invCode === materialCodeNorm &&
        invBatch === batchNorm &&
        (!lsxNorm || invLsx === lsxNorm) &&
        (!lotNorm || invLot === lotNorm);
    });

    if (!matched.length) {
      throw new Error(`Không tìm thấy FG Inventory tương ứng để cập nhật vị trí (batch: ${material.batchNumber}).`);
    }

    const firestoreBatch = this.firestore.firestore.batch();
    matched.forEach(doc => {
      firestoreBatch.update(doc.ref, {
        location: newLocation.toUpperCase(),
        updatedAt: new Date()
      });
    });
    await firestoreBatch.commit();
  }

}
