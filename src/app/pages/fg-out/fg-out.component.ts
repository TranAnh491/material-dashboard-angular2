import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { Subject, forkJoin, firstValueFrom } from 'rxjs';
import { takeUntil, debounceTime, take } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { FactoryAccessService } from '../../services/factory-access.service';
import { FGInventoryLocationService } from '../../services/fg-inventory-location.service';

export interface FgOutItem {
  id?: string;
  factory?: string;
  exportDate: Date;
  shipment: string;
  pallet?: string; // Cột Pallet (sau Shipment)
  xp?: string; // Cột XP (phiếu xuất / mã XP)
  materialCode: string;
  customerCode: string;
  batchNumber: string;
  lsx: string;
  lot: string;
  quantity: number;
  poShip: string;
  carton: number;
  qtyBox: number; // Số lượng hàng trong 1 carton
  odd: number;
  location: string; // Thêm trường vị trí
  productType?: string; // Loại hàng: Mass, ĐL, SAMPLE
  notes: string;
  updateCount: number;
  pushNo: string; // Thêm PushNo
  approved: boolean; // Thêm trường duyệt xuất
  transferredFrom?: string;
  transferredAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CustomerCodeMappingItem {
  id?: string;
  customerCode: string;
  materialCode: string;
  description?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Danh mục (fg-catalog): Mã TP + Standard để tính Carton/ODD */
export interface FgCatalogItem {
  id?: string;
  materialCode: string;
  standard: string;
  customer?: string;
  customerCode?: string;
}

export interface XuatKhoPreviewItem {
  materialCode: string;
  batchNumber: string;
  lot: string;
  lsx: string;
  quantity: number;
  availableStock: number;
  location: string;
  notes: string;
  inventoryId?: string; // ID của record trong FG Inventory
  selected: boolean; // Checkbox để chọn item
}

/** Dòng hiển thị: chi tiết, dòng cộng tổng theo Mã TP, hoặc tổng carton theo pallet */
export type FgOutDisplayRow =
  | { type: 'detail'; material: FgOutItem; matIdx: number; renderShipmentCell?: boolean; palletGroup?: number }
  | { type: 'subtotal'; shipment: string; materialCode: string; totalQty: number; pallet?: string; palletGroup?: number }
  | { type: 'palletTotal'; pallet: string; totalCarton: number; shipment?: string; palletGroup?: number };

@Component({
  selector: 'app-fg-out',
  templateUrl: './fg-out.component.html',
  styleUrls: ['./fg-out.component.scss']
})
export class FgOutComponent implements OnInit, OnDestroy {
  materials: FgOutItem[] = [];
  filteredMaterials: FgOutItem[] = [];
  displayRows: FgOutDisplayRow[] = [];
  
  // Search and filter
  searchTerm: string = '';
  
  // Factory filter
  selectedFactory: string = 'ASM1';
  availableFactories: string[] = ['ASM1'];
  
  
  // XTP Import
  showXTPDialog: boolean = false;
  xtpShipment: string = '';
  xtpPXNumber: string = '';
  xtpFile: File | null = null;
  xtpPreviewData: any[] = [];
  
  // Display options
  showCompleted: boolean = true;
  
  selectedShipment: string = '';
  availableShipments: string[] = [];
  
  // Time filter for old shipments
  showTimeRangeDialog: boolean = false;
  startDate: Date = new Date();
  endDate: Date = new Date();
  
  // Print dialog
  showPrintDialog: boolean = false;
  printMaterials: FgOutItem[] = [];
  
  // Permissions
  hasDeletePermission: boolean = false;
  hasCompletePermission: boolean = false;
  
  private destroy$ = new Subject<void>();
  private locationCache = new Map<string, string>(); // Cache for locations
  private loadLocationsSubject = new Subject<void>(); // Subject for debouncing location loading
  
  // Customer Code Mapping (Tên Khách Hàng = description)
  mappingItems: CustomerCodeMappingItem[] = [];
  // Danh mục (fg-catalog) – Standard theo Mã TP để tính Carton/ODD
  catalogItems: FgCatalogItem[] = [];
  
  // Product types for dropdown
  productTypes: string[] = ['MASS', 'ĐL', 'SAMPLE'];
  
  // Xuất Kho Dialog
  showXuatKhoDialog: boolean = false;
  xuatKhoInputText: string = '';
  xuatKhoChecked: boolean = false;
  xuatKhoPreviewItems: XuatKhoPreviewItem[] = [];
  xuatKhoSelectedShipment: string = '';
  /** Factory của shipment đang xuất (từ tab Shipment: ASM1/ASM2) – dùng lọc tồn và ghi FG Out */
  xuatKhoShipmentFactory: string = 'ASM1';
  xuatKhoAvailableShipments: { code: string; factory: string }[] = [];
  xuatKhoStep: number = 1; // 1: Chọn shipment, 2: Preview items
  /** Trạng thái tồn cho shipment đã chọn: đủ stock (xanh), thiếu stock (cam) */
  shipmentStockStatus: 'unknown' | 'loading' | 'enough' | 'insufficient' = 'unknown';
  
  @ViewChild('xtpFileInput') xtpFileInput!: ElementRef;

  // Drag-and-drop state — bảng chính
  dragMainIndex: number | null = null;
  dragMainOverIndex: number | null = null;
  // Drag-and-drop state — bảng xuất kho dialog
  dragXkIndex: number | null = null;
  dragXkOverIndex: number | null = null;

  // Dropdown chọn Batch / LOT / LSX từ FG Inventory (mỗi cột xổ danh sách tương ứng)
  inventoryDropdownMaterial: FgOutItem | null = null;
  inventoryDropdownXKItem: XuatKhoPreviewItem | null = null;
  inventoryDropdownField: 'batch' | 'lot' | 'lsx' = 'batch';
  inventoryDropdownOptions: string[] = [];
  showInventoryDropdown: boolean = false;
  inventoryDropdownPos: { top: number; left: number } = { top: 0, left: 0 };
  private inventoryDropdownBlurTimer: any;

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private factoryAccessService: FactoryAccessService,
    private fgInventoryLocationService: FGInventoryLocationService
  ) {}

  ngOnInit(): void {
    this.loadMaterialsFromFirebase();
    this.loadMappingFromFirebase();
    this.loadCatalogFromFirebase();
    // Mặc định lọc 1 tuần gần đây
    const today = new Date();
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(today.getDate() - 7);
    oneWeekAgo.setHours(0, 0, 0, 0);
    today.setHours(23, 59, 59, 999);
    this.startDate = oneWeekAgo;
    this.endDate = today;
    this.applyFilters();
    this.loadPermissions();
    this.loadFactoryAccess();
    
    // Setup debounced location loading
    this.loadLocationsSubject.pipe(
      debounceTime(500),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.loadLocationsForMaterials();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.loadLocationsSubject.complete();
    this.locationCache.clear();
  }

  // Load materials from Firebase - Only last 10 days
  loadMaterialsFromFirebase(): void {
    // Calculate date 10 days ago
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    
    this.firestore.collection('fg-out', ref => 
      ref.where('exportDate', '>=', tenDaysAgo)
         .orderBy('exportDate', 'desc')
    )
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((actions) => {
        const firebaseMaterials = actions.map(action => {
          const data = action.payload.doc.data() as any;
          const id = action.payload.doc.id;
          return {
            id: id,
            ...data,
            factory: data.factory || 'ASM1',
            shipment: data.shipment || '',
            pallet: data.pallet || '',
            xp: data.xp || '',
            batchNumber: data.batchNumber || '',
            lsx: data.lsx || '',
            lot: data.lot || '',
            location: data.location || '',
            updateCount: data.updateCount || 1,
            pushNo: data.pushNo || '000',
            approved: data.approved || false,
            exportDate: data.exportDate ? new Date(data.exportDate.seconds * 1000) : new Date()
          };
        });
        
        this.materials = firebaseMaterials;
        this.sortMaterials(); // Sắp xếp trước khi apply filters
        this.applyFilters();
        this.loadAvailableShipments(); // Load available shipments
        this.loadLocationsSubject.next(); // Trigger debounced location loading
        console.log('Loaded FG Out materials from Firebase:', this.materials.length);
      });
  }

  // Load Customer Code Mapping từ Firebase (Tên Khách Hàng = description)
  loadMappingFromFirebase(): void {
    this.firestore.collection('fg-customer-mapping')
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe(actions => {
        const firebaseMapping = actions.map(action => {
          const data = action.payload.doc.data() as any;
          return {
            id: action.payload.doc.id,
            customerCode: data.customerCode || '',
            materialCode: data.materialCode || '',
            description: data.description || ''
          };
        });
        this.mappingItems = firebaseMapping;
      });
  }

  // Load danh mục (fg-catalog) – có cột Standard để tính Carton/ODD
  loadCatalogFromFirebase(): void {
    this.firestore.collection('fg-catalog')
      .snapshotChanges()
      .pipe(take(1), takeUntil(this.destroy$))
      .subscribe(actions => {
        this.catalogItems = actions.map(action => {
          const data = action.payload.doc.data() as any;
          return {
            id: action.payload.doc.id,
            materialCode: (data.materialCode || '').toString().trim(),
            standard: (data.standard != null && data.standard !== '') ? String(data.standard).trim() : '',
            customer: data.customer || '',
            customerCode: data.customerCode || ''
          };
        });
      });
  }

  /** Lấy Standard (số) theo Mã TP từ danh mục. Trả về null nếu không có hoặc không hợp lệ. */
  getStandardForMaterial(materialCode: string): number | null {
    if (!materialCode || !this.catalogItems.length) return null;
    const code = (materialCode || '').toString().trim().toUpperCase();
    const item = this.catalogItems.find(c => (c.materialCode || '').trim().toUpperCase() === code);
    if (!item || !item.standard) return null;
    const num = parseFloat(item.standard);
    return !isNaN(num) && num > 0 ? num : null;
  }

  /** Tính Carton (số thùng chẵn) và ODD (số lẻ) từ QTY xuất / Standard. */
  getCartonOdd(material: FgOutItem): { carton: number; odd: number; hasStandard: boolean } {
    const qty = Number(material.quantity) || 0;
    const standard = this.getStandardForMaterial(material.materialCode || '');
    if (standard == null || standard <= 0) {
      return { carton: 0, odd: 0, hasStandard: false };
    }
    const carton = Math.floor(qty / standard);
    const odd = qty % standard;
    return { carton, odd, hasStandard: true };
  }

  /** Khi đổi QTY xuất: cập nhật Carton và ODD từ Standard rồi lưu. */
  onQuantityChange(material: FgOutItem): void {
    const { carton, odd, hasStandard } = this.getCartonOdd(material);
    if (hasStandard) {
      material.carton = carton;
      material.odd = odd;
    }
    this.updateMaterialInFirebase(material);
  }

  /** Số carton để tính tổng (từ Standard nếu có, ngược lại dùng material.carton). */
  getCartonForMaterial(material: FgOutItem): number {
    const { carton, hasStandard } = this.getCartonOdd(material);
    return hasStandard ? carton : (Number(material.carton) || 0);
  }

  /** Danh sách shipment đang hiển thị (từ filteredMaterials), dạng chuỗi. */
  get displayedShipmentsText(): string {
    const set = new Set<string>();
    this.filteredMaterials.forEach(m => {
      const s = (m.shipment || '').toString().trim();
      if (s) set.add(s);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b)).join(', ') || '—';
  }

  /** Shipment mặc định khi thêm dòng mới (giống shipment đang hiển thị). */
  get displayedShipmentForNewRow(): string {
    const set = new Set<string>();
    this.filteredMaterials.forEach(m => {
      const s = (m.shipment || '').toString().trim();
      if (s) set.add(s);
    });
    const arr = Array.from(set).sort((a, b) => a.localeCompare(b));
    if (arr.length > 0) return arr[0];
    return (this.searchTerm || '').toString().trim();
  }

  /** Class nền theo nhóm Pallet (lẻ: hồng nhạt, chẵn: xanh nhạt). */
  getPalletRowClass(row: FgOutDisplayRow): { [klass: string]: boolean } {
    const group = (row as { palletGroup?: number }).palletGroup || 0;
    return {
      'pallet-odd': group > 0 && group % 2 === 1,
      'pallet-even': group > 0 && group % 2 === 0
    };
  }

  /** Định dạng số có dấu phẩy (ví dụ 1,000). */
  formatNumber(value: number | undefined | null): string {
    if (value == null || isNaN(value)) return '';
    return value.toLocaleString('en-US');
  }

  /** Xử lý nhập QTY (parse số, cập nhật model). */
  onQtyInput(event: Event, material: FgOutItem): void {
    const input = event.target as HTMLInputElement;
    const raw = (input.value || '').replace(/,/g, '').trim();
    const num = parseInt(raw, 10);
    material.quantity = isNaN(num) ? 0 : num;
    this.onQuantityChange(material);
  }

  /** Sau khi blur ô QTY: hiển thị lại có dấu phẩy. */
  onQtyBlur(event: Event, material: FgOutItem): void {
    const input = event.target as HTMLInputElement;
    input.value = this.formatNumber(material.quantity);
  }

  // Lấy Tên khách hàng từ Mapping (cột Tên Khách Hàng = description)
  getCustomerNameFromMapping(materialCode: string): string {
    const mapping = this.mappingItems.find(item => item.materialCode === materialCode);
    return mapping ? (mapping.description || '') : '';
  }

  // Sort materials: Pallet → Mã TP → LSX (thứ tự ưu tiên), sau đó Shipment, Date, Batch
  sortMaterials(): void {
    console.log('🔄 Sorting FG Out materials by: Pallet → Mã TP → LSX');
    this.materials.sort((a, b) => {
      const palletA = (a.pallet || '').toString().toUpperCase();
      const palletB = (b.pallet || '').toString().toUpperCase();
      if (palletA !== palletB) return palletA.localeCompare(palletB);
      const materialA = (a.materialCode || '').toString().toUpperCase();
      const materialB = (b.materialCode || '').toString().toUpperCase();
      if (materialA !== materialB) return materialA.localeCompare(materialB);
      const lsxA = (a.lsx || '').toString().toUpperCase();
      const lsxB = (b.lsx || '').toString().toUpperCase();
      if (lsxA !== lsxB) return lsxA.localeCompare(lsxB);
      const shipmentA = (a.shipment || '').toString().toUpperCase();
      const shipmentB = (b.shipment || '').toString().toUpperCase();
      if (shipmentA !== shipmentB) return shipmentA.localeCompare(shipmentB);
      const dateA = new Date(a.exportDate).getTime();
      const dateB = new Date(b.exportDate).getTime();
      if (dateA !== dateB) return dateB - dateA;
      const batchA = (a.batchNumber || '').toString().toUpperCase();
      const batchB = (b.batchNumber || '').toString().toUpperCase();
      return batchA.localeCompare(batchB);
    });
    console.log(`✅ Sorted ${this.materials.length} FG Out materials`);
  }

  /** Cập nhật Firebase và sắp xếp lại (dòng nhảy tới vị trí theo Shipment, Pallet, Mã TP) */
  onMaterialFieldChange(material: FgOutItem): void {
    this.updateMaterialInFirebase(material);
    this.sortMaterials();
    this.applyFilters();
  }

  // Update material in Firebase
  updateMaterialInFirebase(material: FgOutItem): void {
    if (material.id) {
      // Update existing record
      const updateData = {
        ...material,
        exportDate: material.exportDate,
        pushNo: material.pushNo || '000', // Đảm bảo pushNo được lưu
        updatedAt: new Date()
      };
      
      delete updateData.id;
      
      this.firestore.collection('fg-out').doc(material.id).update(updateData)
        .then(() => {
          console.log('FG Out material updated in Firebase successfully');
        })
        .catch(error => {
          console.error('Error updating FG Out material in Firebase:', error);
        });
    } else {
      // Create new record
      const newData = {
        ...material,
        exportDate: material.exportDate,
        pushNo: material.pushNo || '000',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      delete newData.id;
      
      this.firestore.collection('fg-out').add(newData)
        .then(docRef => {
          material.id = docRef.id;
          console.log('FG Out material created in Firebase successfully with ID:', docRef.id);
        })
        .catch(error => {
          console.error('Error creating FG Out material in Firebase:', error);
        });
    }
  }

  /** Load FG Inventory theo Mã TP, lấy danh sách unique Batch / LOT / LSX */
  async loadInventoryOptionsForMaterial(
    materialCode: string,
    factory: string,
    field: 'batch' | 'lot' | 'lsx'
  ): Promise<string[]> {
    const code = (materialCode || '').trim().toUpperCase();
    const fact = (factory || 'ASM1').trim().toUpperCase();
    if (!code) return [];
    const snapshot = await firstValueFrom(
      this.firestore.collection('fg-inventory', ref =>
        ref.where('materialCode', '==', code).where('factory', '==', fact)
      ).get()
    );
    const set = new Set<string>();
    snapshot.docs.forEach(doc => {
      const d = doc.data() as any;
      const ton = d.ton ?? d.stock ?? (d.quantity ?? 0) - (d.exported ?? 0);
      if (ton > 0) {
        const v = field === 'batch' ? (d.batchNumber || '') : field === 'lot' ? (d.lot || d.Lot || '') : (d.lsx || d.LSX || '');
        if (String(v).trim()) set.add(String(v).trim());
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  /** Bấm ô Batch/LOT/LSX (bảng chính) → xổ danh sách tương ứng */
  async onInventoryFieldFocus(event: Event, material: FgOutItem, field: 'batch' | 'lot' | 'lsx'): Promise<void> {
    if (this.inventoryDropdownBlurTimer) clearTimeout(this.inventoryDropdownBlurTimer);
    const mc = (material.materialCode || '').trim();
    if (!mc) return;
    const factory = (material.factory || this.selectedFactory || 'ASM1').trim();
    const opts = await this.loadInventoryOptionsForMaterial(mc, factory, field);
    this.inventoryDropdownMaterial = material;
    this.inventoryDropdownXKItem = null;
    this.inventoryDropdownField = field;
    this.inventoryDropdownOptions = opts;
    this.showInventoryDropdown = true;
    const el = event.target as HTMLElement;
    const rect = el.getBoundingClientRect();
    this.inventoryDropdownPos = { top: rect.bottom + 2, left: rect.left };
  }

  /** Bấm ô Batch/LOT/LSX (dialog Xuất Kho) → xổ danh sách tương ứng */
  async onInventoryFieldFocusXK(event: Event, item: XuatKhoPreviewItem, field: 'batch' | 'lot' | 'lsx'): Promise<void> {
    if (this.inventoryDropdownBlurTimer) clearTimeout(this.inventoryDropdownBlurTimer);
    const mc = (item.materialCode || '').trim();
    if (!mc) return;
    const factory = (this.xuatKhoShipmentFactory || 'ASM1').trim();
    const opts = await this.loadInventoryOptionsForMaterial(mc, factory, field);
    this.inventoryDropdownMaterial = null;
    this.inventoryDropdownXKItem = item;
    this.inventoryDropdownField = field;
    this.inventoryDropdownOptions = opts;
    this.showInventoryDropdown = true;
    const el = event.target as HTMLElement;
    const rect = el.getBoundingClientRect();
    this.inventoryDropdownPos = { top: rect.bottom + 2, left: rect.left };
  }

  onInventoryFieldBlur(): void {
    this.inventoryDropdownBlurTimer = setTimeout(() => this.closeInventoryDropdown(), 250);
  }

  closeInventoryDropdown(): void {
    this.showInventoryDropdown = false;
    this.inventoryDropdownMaterial = null;
    this.inventoryDropdownXKItem = null;
    this.inventoryDropdownOptions = [];
  }

  selectInventoryOption(value: string): void {
    if (this.inventoryDropdownMaterial) {
      if (this.inventoryDropdownField === 'batch') this.inventoryDropdownMaterial.batchNumber = value;
      else if (this.inventoryDropdownField === 'lot') this.inventoryDropdownMaterial.lot = value;
      else this.inventoryDropdownMaterial.lsx = value;
      this.updateMaterialInFirebase(this.inventoryDropdownMaterial);
    } else if (this.inventoryDropdownXKItem) {
      if (this.inventoryDropdownField === 'batch') this.inventoryDropdownXKItem.batchNumber = value;
      else if (this.inventoryDropdownField === 'lot') this.inventoryDropdownXKItem.lot = value;
      else this.inventoryDropdownXKItem.lsx = value;
    }
    this.closeInventoryDropdown();
  }

  // Delete material
  deleteMaterial(material: FgOutItem): void {
    if (material.id) {
      this.firestore.collection('fg-out').doc(material.id).delete()
        .then(() => {
          console.log('FG Out material deleted from Firebase successfully');
        })
        .catch(error => {
          console.error('Error deleting FG Out material from Firebase:', error);
        });
    }
    
    // Remove from local array immediately
    const index = this.materials.indexOf(material);
    if (index > -1) {
      this.materials.splice(index, 1);
      console.log(`Deleted FG Out material: ${material.materialCode}`);
      this.applyFilters();
    }
  }

  // Apply search filters
  applyFilters(): void {
    this.filteredMaterials = this.materials.filter(material => {
      // Search theo Shipment hoặc Mã TP (contains, không phân biệt hoa thường)
      if (this.searchTerm && this.searchTerm.trim()) {
        const term = this.searchTerm.trim().toUpperCase();
        const ship = (material.shipment || '').toUpperCase();
        const code = (material.materialCode || '').toUpperCase();
        if (!ship.includes(term) && !code.includes(term)) {
          return false;
        }
      }
      
      // Filter by factory
      if (this.selectedFactory) {
        const materialFactory = material.factory || 'ASM1';
        if (materialFactory !== this.selectedFactory) {
          return false;
        }
      }
      
      // Filter by date range
      const exportDate = new Date(material.exportDate);
      const isInDateRange = exportDate >= this.startDate && exportDate <= this.endDate;
      
      return isInDateRange;
    });
    
    // Sắp xếp: Pallet → Mã TP → LSX → Shipment → Ngày → Batch
    this.filteredMaterials.sort((a, b) => {
      const palletA = (a.pallet || '').toUpperCase();
      const palletB = (b.pallet || '').toUpperCase();
      if (palletA !== palletB) return palletA.localeCompare(palletB);
      const codeA = (a.materialCode || '').toUpperCase();
      const codeB = (b.materialCode || '').toUpperCase();
      if (codeA !== codeB) return codeA.localeCompare(codeB);
      const lsxA = (a.lsx || '').toUpperCase();
      const lsxB = (b.lsx || '').toUpperCase();
      if (lsxA !== lsxB) return lsxA.localeCompare(lsxB);
      const shipA = (a.shipment || '').toUpperCase();
      const shipB = (b.shipment || '').toUpperCase();
      if (shipA !== shipB) return shipA.localeCompare(shipB);
      const dateA = new Date(a.exportDate).getTime();
      const dateB = new Date(b.exportDate).getTime();
      if (dateA !== dateB) return dateB - dateA;
      const batchA = (a.batchNumber || '').toUpperCase();
      const batchB = (b.batchNumber || '').toUpperCase();
      return batchA.localeCompare(batchB);
    });

    // Build display rows: chỉ chi tiết (không có dòng tổng theo Mã TP)
    this.displayRows = this.filteredMaterials.map((m, i) =>
      ({ type: 'detail', material: m, matIdx: i } as FgOutDisplayRow));

    // Chèn dòng tổng carton theo pallet (chỉ khi có pallet)
    const withPalletTotals: FgOutDisplayRow[] = [];
    let prevPallet = '';
    let cartonAccum = 0;
    let lastShipment = '';
    for (const r of this.displayRows) {
      if (r.type === 'detail') {
        lastShipment = r.material?.shipment ?? '';
        const pallet = (r.material?.pallet ?? '').toString().trim();
        if (pallet) {
          if (pallet !== prevPallet && prevPallet) {
            withPalletTotals.push({ type: 'palletTotal', pallet: prevPallet, totalCarton: cartonAccum, shipment: lastShipment });
            cartonAccum = 0;
          }
          prevPallet = pallet;
          cartonAccum += this.getCartonForMaterial(r.material);
        }
      }
      withPalletTotals.push(r);
    }
    if (prevPallet && cartonAccum > 0) {
      withPalletTotals.push({ type: 'palletTotal', pallet: prevPallet, totalCarton: cartonAccum, shipment: lastShipment });
    }
    this.displayRows = withPalletTotals;

    // Tô màu theo nhóm pallet (cùng pallet = cùng màu; pallet tiếp theo đổi màu)
    let palletGroup = 0;
    let currentPallet = '';
    this.displayRows.forEach(r => {
      const pallet =
        r.type === 'detail' ? ((r.material?.pallet ?? '').toString().trim())
        : ((r as { pallet?: string }).pallet ?? '').toString().trim();
      if (!pallet) return;
      if (pallet !== currentPallet) {
        palletGroup += 1;
        currentPallet = pallet;
      }
      (r as { palletGroup?: number }).palletGroup = palletGroup;
    });

    // Dòng đầu mỗi shipment hiển thị ô Shipment có input, các dòng sau chỉ hiển thị text (để cột luôn đồng đều)
    const seenShipment = new Set<string>();
    this.displayRows.forEach(r => {
      const ship = r.type === 'detail' ? (r.material?.shipment ?? '') : ((r as { shipment?: string }).shipment ?? '');
      const key = ship === '' ? '__empty__' : ship;
      if (seenShipment.has(key)) return;
      seenShipment.add(key);
      if (r.type === 'detail') {
        (r as { renderShipmentCell?: boolean }).renderShipmentCell = true;
      }
    });
    
    console.log('FG Out search results:', {
      searchTerm: this.searchTerm,
      totalMaterials: this.materials.length,
      filteredMaterials: this.filteredMaterials.length
    });
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

  // Load factory access permissions - FG Out is only for ASM1
  private loadFactoryAccess(): void {
    // FG Out is only for ASM1, so no need to load factory access
    this.selectedFactory = 'ASM1';
    this.availableFactories = ['ASM1'];
    
    console.log('🏭 Factory access set for FG Out (ASM1 only):', {
      selectedFactory: this.selectedFactory,
      availableFactories: this.availableFactories
    });
  }

  // Check if user can edit material
  canEditMaterial(material: FgOutItem): boolean {
    const materialFactory = material.factory || 'ASM1';
    return this.availableFactories.includes(materialFactory);
  }

  // Check if user can view material
  canViewMaterial(material: FgOutItem): boolean {
    const materialFactory = material.factory || 'ASM1';
    return this.availableFactories.includes(materialFactory);
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

  // Update date field
  updateDateField(material: FgOutItem, field: string, dateString: string): void {
    if (dateString) {
      (material as any)[field] = new Date(dateString);
    } else {
      (material as any)[field] = new Date();
    }
    material.updatedAt = new Date();
    this.updateMaterialInFirebase(material);
  }

  // Import file functionality
  importFile(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,.xls';
    fileInput.style.display = 'none';
    
    fileInput.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.processExcelFile(file);
      }
    };
    
    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
  }

  private async processExcelFile(file: File): Promise<void> {
    try {
      const data = await this.readExcelFile(file);
      const materials = this.parseExcelData(data);
      
      this.materials = [...this.materials, ...materials];
      this.applyFilters();
      
      // Save to Firebase
      this.saveMaterialsToFirebase(materials);
      
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

  private parseExcelData(data: any[]): FgOutItem[] {
    return data.map((row: any, index: number) => ({
      factory: row['Factory'] || 'ASM1',
      exportDate: this.parseDate(row['Ngày xuất']) || new Date(),
      shipment: row['Shipment'] || '',
      pallet: row['Pallet'] || '',
      materialCode: row['Mã TP'] || '',
      customerCode: row['Mã Khách'] || '',
      batchNumber: row['Batch'] || '',
      lsx: row['LSX'] || '',
      lot: row['LOT'] || '',
      quantity: parseInt(row['Lượng Xuất']) || 0,
      poShip: row['PO Ship'] || '',
      carton: parseInt(row['Carton']) || 0,
      qtyBox: parseInt(row['QTYBOX']) || 100, // Thêm QTYBOX với default = 100
      odd: parseInt(row['Odd']) || 0,
      location: '', // Thêm trường location (sẽ được load từ FG Inventory)
      notes: '', // Để trống để điền tay
      updateCount: 1, // Default update count for imported data
      pushNo: '000', // Default pushNo for imported data
      approved: false, // Thêm trường approved với default = false
      createdAt: new Date(),
      updatedAt: new Date()
    }));
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
  saveMaterialsToFirebase(materials: FgOutItem[]): void {
    materials.forEach(material => {
      const materialData = {
        ...material,
        exportDate: material.exportDate,
        pushNo: material.pushNo || '000', // Đảm bảo pushNo được lưu
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      delete materialData.id;
      
      this.firestore.collection('fg-out').add(materialData)
        .then((docRef) => {
          console.log('FG Out material saved to Firebase successfully with ID:', docRef.id);
        })
        .catch(error => {
          console.error('Error saving FG Out material to Firebase:', error);
        });
    });
  }

  // Download template
  downloadTemplate(): void {
    const templateData = [
      {
        'Shipment': 'SHIP001',
        'Mã TP': 'P001234',
        'Mã Khách': 'CUST001',
        'Batch': '010001',
        'LSX': '0124/0001',
        'LOT': 'LOT001',
        'Lượng Xuất': 100,
        'PO Ship': 'PO2024001',
        'Carton': 10,
        'Odd': 5,
        'Ghi chú': 'Standard shipment'
      },
      {
        'Shipment': 'SHIP002',
        'Mã TP': 'P002345',
        'Mã Khách': 'CUST002',
        'Batch': '010002',
        'LSX': '0124/0002',
        'LOT': 'LOT002',
        'Lượng Xuất': 200,
        'PO Ship': 'PO2024002',
        'Carton': 20,
        'Odd': 8,
        'Ghi chú': 'Urgent shipment'
      }
    ];

    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(templateData);
    
    // Set column widths
    const colWidths = [
      { wch: 12 }, // Shipment
      { wch: 12 }, // Mã TP
      { wch: 12 }, // Mã Khách
      { wch: 10 }, // Batch
      { wch: 12 }, // LSX
      { wch: 10 }, // LOT
      { wch: 12 }, // Lượng Xuất
      { wch: 12 }, // PO Ship
      { wch: 10 }, // Carton
      { wch: 8 },  // Odd
      { wch: 20 }  // Ghi chú
    ];
    ws['!cols'] = colWidths;
    
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'FG_Out_Template.xlsx');
  }



  updateNotes(material: FgOutItem): void {
    console.log('Updating notes for material:', material.materialCode, 'to:', material.notes);
    this.updateMaterialInFirebase(material);
  }

  viewAllMaterials(): void {
    this.startDate = new Date(2020, 0, 1);
    this.endDate = new Date(2030, 11, 31);
    this.showCompleted = true;
    this.selectedFactory = '';
    this.applyFilters();
    this.showTimeRangeDialog = false;
    
    console.log('View all FG Out materials:', {
      totalMaterials: this.materials.length,
      filteredMaterials: this.filteredMaterials.length,
      materials: this.materials
    });
  }


  // XTP Import Methods
  selectXTPFile(): void {
    if (this.xtpFileInput) {
      this.xtpFileInput.nativeElement.click();
    }
  }

  onXTPFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      this.xtpFile = file;
      this.processXTPFile(file);
    }
  }

  removeXTPFile(): void {
    this.xtpFile = null;
    this.xtpPreviewData = [];
  }

  private async processXTPFile(file: File): Promise<void> {
    try {
      const data = await this.readExcelFile(file);
      this.xtpPreviewData = this.parseXTPData(data);
      console.log('XTP Preview data:', this.xtpPreviewData);
    } catch (error) {
      console.error('Error processing XTP file:', error);
      alert(`❌ Lỗi khi đọc file XTP: ${error.message || error}`);
    }
  }

  private parseXTPData(data: any[]): any[] {
    const results: any[] = [];
    
    // Tìm các cột cần thiết
    let materialCodeCol = '';
    let quantityCol = '';
    let lotCol = '';
    
    // Tìm header row
    const headerRow = data[0];
    if (headerRow) {
      Object.keys(headerRow).forEach(key => {
        const value = String(headerRow[key]).toLowerCase();
        if (value.includes('mã vật tư') || value.includes('mã tp')) {
          materialCodeCol = key;
        }
        if (value.includes('số lượng') || value.includes('xuất')) {
          quantityCol = key;
        }
        if (value.includes('mã lô') || value.includes('lot')) {
          lotCol = key;
        }
      });
    }
    
    console.log('XTP Column mapping:', { materialCodeCol, quantityCol, lotCol });
    
    // Parse data rows
    data.forEach((row: any, index: number) => {
      if (index === 0) return; // Skip header
      
      const materialCode = String(row[materialCodeCol] || '').trim();
      const quantity = parseFloat(row[quantityCol] || 0);
      const lot = String(row[lotCol] || '').trim();
      
      if (materialCode && quantity > 0) {
        // Parse material code: P + 6 digits (7 characters from left)
        const materialCodeParsed = materialCode.substring(0, 7);
        
        // Parse REV: everything after _ in material code
        let rev = '';
        const underscoreIndex = materialCode.indexOf('_');
        if (underscoreIndex > -1) {
          rev = materialCode.substring(underscoreIndex + 1);
        }
        
        results.push({
          materialCode: materialCodeParsed,
          rev: rev,
          lot: lot,
          quantity: quantity
        });
      }
    });
    
    return results;
  }

  canImportXTP(): boolean {
    return !!(this.xtpShipment.trim() && this.xtpPXNumber.trim() && this.xtpFile && this.xtpPreviewData.length > 0);
  }

  importXTPData(): void {
    if (!this.canImportXTP()) {
      alert('❌ Vui lòng nhập đầy đủ thông tin và chọn file XTP');
      return;
    }

    const newMaterials: FgOutItem[] = this.xtpPreviewData.map(item => ({
      factory: 'ASM1',
      exportDate: new Date(),
      shipment: this.xtpShipment.trim(),
      pallet: '',
      xp: '',
      materialCode: item.materialCode,
      customerCode: '',
      batchNumber: '',
      lsx: '',
      lot: item.lot || '',
      quantity: item.quantity,
      poShip: this.xtpPXNumber.trim(),
      carton: 0,
      qtyBox: 100, // Default QTYBOX = 100 for XTP import
      odd: 0,
      location: '', // Thêm trường location (sẽ được load từ FG Inventory)
      notes: '', // Để trống để điền tay
      updateCount: 1, // Default update count for XTP imported data
      pushNo: '000', // Default pushNo for XTP imported data
      approved: false, // Thêm trường approved với default = false
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    // Tính Carton/ODD từ Standard (danh mục) cho từng dòng
    newMaterials.forEach(m => {
      const { carton, odd, hasStandard } = this.getCartonOdd(m);
      if (hasStandard) {
        m.carton = carton;
        m.odd = odd;
      }
    });

    // Add to local array
    this.materials = [...this.materials, ...newMaterials];
    this.applyFilters();

    // Save to Firebase
    this.saveMaterialsToFirebase(newMaterials);

    // Reset form
    this.xtpShipment = '';
    this.xtpPXNumber = '';
    this.xtpFile = null;
    this.xtpPreviewData = [];
    this.showXTPDialog = false;

    alert(`✅ Đã import thành công ${newMaterials.length} items từ phiếu XTP!`);
  }

  // Load available shipments for filter
  loadAvailableShipments(): void {
    this.firestore.collection('fg-out')
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe(snapshot => {
        const shipments = new Set<string>();
        snapshot.docs.forEach(doc => {
          const data = doc.data() as any;
          if (data.shipment) {
            shipments.add(data.shipment);
          }
        });
        this.availableShipments = Array.from(shipments).sort();
        console.log('Available shipments:', this.availableShipments);
      });
  }

  // Handle shipment input change
  onShipmentInputChange(): void {
    console.log('Shipment input changed to:', this.selectedShipment);
    this.applyFilters();
  }

  // Lọc theo nhà máy: ASM1, ASM2, TOTAL ('' = tất cả)
  setFactoryFilter(factory: string): void {
    this.selectedFactory = factory;
    this.applyFilters();
  }

  // Handle approval change
  onApprovalChange(material: FgOutItem): void {
    console.log('Approval changed for material:', material.id, 'approved:', material.approved);
    
    if (material.approved) {
      // Tick duyệt xuất: ghi nhận xuất kho ở FG Inventory (theo Mã TP, batch)
      this.subtractFromFGInventory(material);
    }
    // Bỏ tick duyệt xuất: không thay đổi FG Inventory, chỉ lưu trạng thái FG Out
    this.updateMaterialInFirebase(material);
  }

  // Subtract quantity from FG Inventory (theo Mã TP, nhà máy, batch) và cập nhật fg-export
  private subtractFromFGInventory(material: FgOutItem): void {
    console.log(`📉 Processing export for ${material.quantity} units of ${material.materialCode}`);
    const factory = (material.factory || 'ASM1').toString().trim();
    const materialCodeNorm = (material.materialCode || '').toString().trim().toUpperCase();
    const batchNorm = (material.batchNumber || '').toString().trim();

    // Tìm tồn theo nhà máy + batch, rồi lọc theo mã TP (FG Inventory có thể lưu materialCode hoặc maTP)
    this.firestore.collection('fg-inventory', ref =>
      ref.where('factory', '==', factory)
         .where('batchNumber', '==', batchNorm)
    ).get().subscribe(snapshot => {
      const matchingDocs = snapshot.docs.filter(doc => {
        const d = doc.data() as any;
        const invCode = (d.materialCode || d.maTP || '').toString().trim().toUpperCase();
        return invCode === materialCodeNorm;
      });

      if (matchingDocs.length === 0) {
        console.log('⚠️ No matching FG Inventory found (factory, materialCode, batch)');
        alert(`⚠️ Cảnh báo: Không tìm thấy tồn kho cho ${material.materialCode}! (Nhà máy: ${factory}, Batch: ${batchNorm})`);
        return;
      }

      // Tổng tồn có sẵn (ton hoặc stock)
      let totalAvailable = 0;
      matchingDocs.forEach(doc => {
        const d = doc.data() as any;
        totalAvailable += Number(d.ton ?? d.stock ?? 0) || 0;
      });

      if (totalAvailable < material.quantity) {
        console.log(`⚠️ Insufficient inventory: available=${totalAvailable}, required=${material.quantity}`);
        alert(`⚠️ Cảnh báo: Không đủ tồn kho!\nCó: ${totalAvailable}\nCần: ${material.quantity}`);
        return;
      }

      // Trừ tồn theo thứ tự (FIFO)
      this.subtractFromInventoryDocs(matchingDocs, material.quantity);
      this.addToExportCollection(material);
    });
  }

  // Trừ tồn từ danh sách doc FG Inventory (FIFO)
  private subtractFromInventoryDocs(docs: any[], totalQuantity: number): void {
    let remainingQuantity = totalQuantity;
    docs.forEach(doc => {
      if (remainingQuantity <= 0) return;
      const d = doc.data() as any;
      const availableQuantity = Number(d.ton ?? d.stock ?? 0) || 0;
      const quantityToSubtract = Math.min(remainingQuantity, availableQuantity);
      if (quantityToSubtract > 0) {
        const newQuantity = availableQuantity - quantityToSubtract;
        doc.ref.update({
          ton: newQuantity,
          updatedAt: new Date()
        }).then(() => {
          console.log(`✅ Updated inventory ${doc.id}: ton=${newQuantity} (subtracted ${quantityToSubtract})`);
        }).catch(error => {
          console.error('❌ Error updating inventory:', error);
        });
        remainingQuantity -= quantityToSubtract;
      }
    });
  }

  // Add export record to fg-export collection
  private addToExportCollection(material: FgOutItem): void {
    const exportRecord = {
      materialCode: material.materialCode,
      batchNumber: material.batchNumber,
      lsx: material.lsx,
      lot: material.lot,
      quantity: material.quantity,
      shipment: material.shipment,
      pushNo: material.pushNo,
      approvedBy: 'Current User', // TODO: Get from auth service
      approvedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.firestore.collection('fg-export').add(exportRecord)
      .then(docRef => {
        console.log(`✅ Added export record: ${docRef.id} for ${material.materialCode}`);
      })
      .catch(error => {
        console.error('❌ Error adding export record:', error);
        alert(`❌ Lỗi khi lưu bản ghi xuất: ${error.message}`);
      });
  }

  // Add back quantity to FG Inventory and remove from export collection (hoàn tác duyệt xuất)
  private addBackToFGInventory(material: FgOutItem): void {
    console.log(`📈 Reversing export for ${material.quantity} units of ${material.materialCode}`);
    
    // First, remove from export collection
    this.removeFromExportCollection(material);
    
    // Then add back to inventory
    this.addBackToInventory(material);
  }

  // Remove export record from fg-export collection
  private removeFromExportCollection(material: FgOutItem): void {
    this.firestore.collection('fg-export', ref => 
      ref.where('materialCode', '==', material.materialCode)
         .where('batchNumber', '==', material.batchNumber)
         .where('lsx', '==', material.lsx)
         .where('lot', '==', material.lot)
         .where('shipment', '==', material.shipment)
         .where('pushNo', '==', material.pushNo)
         .limit(1)
    ).get().subscribe(snapshot => {
      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        doc.ref.delete()
          .then(() => {
            console.log(`✅ Removed export record: ${doc.id} for ${material.materialCode}`);
          })
          .catch(error => {
            console.error('❌ Error removing export record:', error);
          });
      } else {
        console.log('⚠️ No matching export record found to remove');
      }
    });
  }

  // Add back quantity to inventory items
  private addBackToInventory(material: FgOutItem): void {
    this.firestore.collection('fg-inventory', ref => 
      ref.where('materialCode', '==', material.materialCode)
         .where('batchNumber', '==', material.batchNumber)
         .where('lsx', '==', material.lsx)
         .where('lot', '==', material.lot)
    ).get().subscribe(snapshot => {
      if (snapshot.empty) {
        console.log('⚠️ No matching FG Inventory found for adding back');
        return;
      }

      let remainingQuantity = material.quantity;
      
      snapshot.docs.forEach(doc => {
        if (remainingQuantity <= 0) return;
        
        const inventoryData = doc.data() as any;
        const currentQuantity = inventoryData.ton || 0;
        const quantityToAddBack = Math.min(remainingQuantity, material.quantity);
        
        if (quantityToAddBack > 0) {
          const newQuantity = currentQuantity + quantityToAddBack;
          
          doc.ref.update({
            ton: newQuantity,
            updatedAt: new Date()
          }).then(() => {
            console.log(`✅ Added back to inventory ${doc.id}: ton=${newQuantity} (added ${quantityToAddBack})`);
          }).catch(error => {
            console.error('❌ Error updating inventory:', error);
          });
          
          remainingQuantity -= quantityToAddBack;
        }
      });
    });
  }

  // Print selected shipment
  printSelectedShipment(): void {
    if (!this.selectedShipment) {
      alert('Vui lòng chọn Shipment để in!');
      return;
    }
    
    this.printMaterials = this.materials.filter(m => m.shipment === this.selectedShipment);
    this.showPrintDialog = true;
  }

  // Open print dialog by shipment - get available shipments from filtered materials
  openPrintByShipment(): void {
    // Get unique shipments from filtered materials
    const shipments = [...new Set(this.filteredMaterials.map(m => m.shipment).filter(s => s && s.trim()))];
    
    if (shipments.length === 0) {
      alert('Không có shipment nào để in. Vui lòng tìm kiếm hoặc xem tất cả dữ liệu trước.');
      return;
    }
    
    if (shipments.length === 1) {
      // Only one shipment, print directly
      this.selectedShipment = shipments[0];
      this.printMaterials = this.filteredMaterials.filter(m => m.shipment === this.selectedShipment);
      this.showPrintDialog = true;
    } else {
      // Multiple shipments, ask user to select
      const shipmentList = shipments.join('\n');
      const selected = prompt(`Chọn Shipment để in:\n\n${shipmentList}\n\nNhập mã Shipment:`, shipments[0]);
      
      if (selected && shipments.includes(selected.trim())) {
        this.selectedShipment = selected.trim();
        this.printMaterials = this.filteredMaterials.filter(m => m.shipment === this.selectedShipment);
        this.showPrintDialog = true;
      } else if (selected) {
        alert('Shipment không hợp lệ!');
      }
    }
  }

  // Print document
  printDocument(): void {
    const printContent = document.getElementById('printContent');
    if (printContent) {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>Phiếu xuất hàng - ${this.selectedShipment}</title>
              <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .print-header { text-align: center; margin-bottom: 20px; }
                .print-header h2 { color: #333; margin-bottom: 10px; }
                .print-info { text-align: left; margin-bottom: 20px; }
                .print-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
                .print-table th, .print-table td { border: 1px solid #333; padding: 8px; text-align: center; }
                .print-table th { background-color: #f5f5f5; font-weight: bold; }
                .print-footer { margin-top: 30px; }
                .signature-section { display: flex; justify-content: space-around; }
                .signature-box { text-align: center; }
                .signature-line { border-bottom: 1px solid #333; width: 150px; height: 40px; margin: 10px auto; }
                @media print { body { margin: 0; } }
              </style>
            </head>
            <body>
              ${printContent.innerHTML}
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.print();
      }
    }
  }

  // Get current date
  getCurrentDate(): string {
    return new Date().toLocaleDateString('vi-VN');
  }

  // Get current user
  getCurrentUser(): string {
    return 'Người dùng hiện tại'; // TODO: Get from auth service
  }

  // Format date for input field (YYYY-MM-DD)
  formatDateForInput(date: Date): string {
    if (!date) return '';
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Handle date input change
  onDateChange(event: any, material: FgOutItem): void {
    const dateValue = event.target.value;
    if (dateValue) {
      material.exportDate = new Date(dateValue);
      this.updateMaterialInFirebase(material);
    }
  }

  // Load materials by time range (for old shipments)
  loadMaterialsByTimeRange(): void {
    console.log('Loading materials by time range:', this.startDate, 'to', this.endDate);
    
    this.firestore.collection('fg-out', ref => 
      ref.where('exportDate', '>=', this.startDate)
         .where('exportDate', '<=', this.endDate)
         .orderBy('exportDate', 'desc')
    )
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((actions) => {
        const firebaseMaterials = actions.map(action => {
          const data = action.payload.doc.data() as any;
          const id = action.payload.doc.id;
          return {
            id: id,
            ...data,
            factory: data.factory || 'ASM1',
            shipment: data.shipment || '',
            pallet: data.pallet || '',
            xp: data.xp || '',
            batchNumber: data.batchNumber || '',
            lsx: data.lsx || '',
            lot: data.lot || '',
            location: data.location || '',
            updateCount: data.updateCount || 1,
            pushNo: data.pushNo || '000',
            approved: data.approved || false,
            exportDate: data.exportDate ? new Date(data.exportDate.seconds * 1000) : new Date()
          };
        });
        
        this.materials = firebaseMaterials;
        this.sortMaterials();
        this.applyFilters();
        this.loadAvailableShipments();
        this.loadLocationsSubject.next();
        console.log('Loaded FG Out materials by time range:', this.materials.length);
      });
  }

  // Apply time range filter
  applyTimeRangeFilter(): void {
    this.loadMaterialsByTimeRange();
    this.showTimeRangeDialog = false;
  }

  // Chọn nhanh khoảng thời gian (days = 0 → tất cả)
  setQuickRange(days: number): void {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    this.endDate = today;
    if (days === 0) {
      const all = new Date(2020, 0, 1);
      this.startDate = all;
    } else {
      const from = new Date();
      from.setDate(from.getDate() - days);
      from.setHours(0, 0, 0, 0);
      this.startDate = from;
    }
  }

  // ==================== DRAG & DROP — BẢNG CHÍNH ====================

  onMainDragStart(matIdx: number): void {
    this.dragMainIndex = matIdx;
  }

  onMainDragOver(event: DragEvent, matIdx: number): void {
    event.preventDefault();
    this.dragMainOverIndex = matIdx;
  }

  onMainDrop(matIdx: number): void {
    if (this.dragMainIndex === null || this.dragMainIndex === matIdx) {
      this.dragMainIndex = null;
      this.dragMainOverIndex = null;
      return;
    }
    // Reorder filteredMaterials
    const [moved] = this.filteredMaterials.splice(this.dragMainIndex, 1);
    this.filteredMaterials.splice(matIdx, 0, moved);
    // Rebuild displayRows without resorting
    this.rebuildDisplayRows();
    this.dragMainIndex = null;
    this.dragMainOverIndex = null;
  }

  onMainDragEnd(): void {
    this.dragMainIndex = null;
    this.dragMainOverIndex = null;
  }

  // Rebuild displayRows từ filteredMaterials (chỉ chi tiết + dòng tổng carton theo pallet)
  private rebuildDisplayRows(): void {
    this.displayRows = this.filteredMaterials.map((m, i) =>
      ({ type: 'detail', material: m, matIdx: i } as FgOutDisplayRow));

    const withPalletTotals: FgOutDisplayRow[] = [];
    let prevPallet = '';
    let cartonAccum = 0;
    let lastShipment = '';
    for (const r of this.displayRows) {
      if (r.type === 'detail') {
        lastShipment = r.material?.shipment ?? '';
        const pallet = (r.material?.pallet ?? '').toString().trim();
        if (pallet) {
          if (pallet !== prevPallet && prevPallet) {
            withPalletTotals.push({ type: 'palletTotal', pallet: prevPallet, totalCarton: cartonAccum, shipment: lastShipment });
            cartonAccum = 0;
          }
          prevPallet = pallet;
          cartonAccum += this.getCartonForMaterial(r.material);
        }
      }
      withPalletTotals.push(r);
    }
    if (prevPallet && cartonAccum > 0) {
      withPalletTotals.push({ type: 'palletTotal', pallet: prevPallet, totalCarton: cartonAccum, shipment: lastShipment });
    }
    this.displayRows = withPalletTotals;

    // Tô màu theo nhóm pallet (cùng pallet = cùng màu; pallet tiếp theo đổi màu)
    let palletGroup = 0;
    let currentPallet = '';
    this.displayRows.forEach(r => {
      const pallet =
        r.type === 'detail' ? ((r.material?.pallet ?? '').toString().trim())
        : ((r as { pallet?: string }).pallet ?? '').toString().trim();
      if (!pallet) return;
      if (pallet !== currentPallet) {
        palletGroup += 1;
        currentPallet = pallet;
      }
      (r as { palletGroup?: number }).palletGroup = palletGroup;
    });

    const seenShipment = new Set<string>();
    this.displayRows.forEach(r => {
      const ship = r.type === 'detail' ? (r.material?.shipment ?? '') : (r.shipment ?? '');
      const key = ship === '' ? '__empty__' : ship;
      if (seenShipment.has(key)) return;
      seenShipment.add(key);
      if (r.type === 'detail') {
        (r as { renderShipmentCell?: boolean }).renderShipmentCell = true;
      }
    });
  }

  // ==================== DRAG & DROP — DIALOG XUẤT KHO ====================

  onXkDragStart(index: number): void {
    this.dragXkIndex = index;
  }

  onXkDragOver(event: DragEvent, index: number): void {
    event.preventDefault();
    this.dragXkOverIndex = index;
  }

  onXkDrop(index: number): void {
    if (this.dragXkIndex === null || this.dragXkIndex === index) {
      this.dragXkIndex = null;
      this.dragXkOverIndex = null;
      return;
    }
    const [moved] = this.xuatKhoPreviewItems.splice(this.dragXkIndex, 1);
    this.xuatKhoPreviewItems.splice(index, 0, moved);
    this.dragXkIndex = null;
    this.dragXkOverIndex = null;
  }

  onXkDragEnd(): void {
    this.dragXkIndex = null;
    this.dragXkOverIndex = null;
  }

  // Add new row manually
  addNewRow(): void {
    const factory = this.selectedFactory === 'ASM2' ? 'ASM2' : 'ASM1';
    const newMaterial: FgOutItem = {
      id: '', // Will be set when saved to Firebase
      factory,
      exportDate: new Date(),
      shipment: this.displayedShipmentForNewRow || '',
      pallet: '',
      xp: '',
      materialCode: '',
      customerCode: '',
      batchNumber: '',
      lsx: '',
      lot: '',
      quantity: 0,
      poShip: '',
      carton: 0,
      qtyBox: 100,
      odd: 0,
      location: '',
      notes: '',
      approved: false,
      updateCount: 0,
      pushNo: '000',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Add to materials array
    this.materials.unshift(newMaterial); // Add to beginning of array
    
    // Update filtered materials
    this.applyFilters();
    
    console.log('✅ Added new row manually');
  }

  // Get location from FG Inventory - SIMPLIFIED to avoid infinite loop
  getLocation(material: FgOutItem): string {
    // Return cached location if available
    if (material.location) {
      return material.location;
    }
    
    // Check cache
    const cacheKey = `${material.materialCode}-${material.batchNumber}-${material.lsx}-${material.lot}`;
    if (this.locationCache.has(cacheKey)) {
      material.location = this.locationCache.get(cacheKey)!;
      return material.location;
    }
    
    // Return loading state without triggering API call
    return 'Đang tải...';
  }

  // Load locations for all materials - OPTIMIZED with caching
  private loadLocationsForMaterials(): void {
    // Only load locations for materials that don't have location yet
    const materialsNeedingLocation = this.materials.filter(material => !material.location);
    
    if (materialsNeedingLocation.length === 0) {
      return; // No need to load if all have locations
    }
    
    console.log(`Loading locations for ${materialsNeedingLocation.length} materials`);
    
    materialsNeedingLocation.forEach(material => {
      const cacheKey = `${material.materialCode}-${material.batchNumber}-${material.lsx}-${material.lot}`;
      
      // Check cache first
      if (this.locationCache.has(cacheKey)) {
        material.location = this.locationCache.get(cacheKey)!;
        return;
      }
      
      // Load from API if not in cache
      this.fgInventoryLocationService.getLocation(
        material.materialCode,
        material.batchNumber,
        material.lsx,
        material.lot
      ).pipe(takeUntil(this.destroy$))
      .subscribe(location => {
        material.location = location;
        this.locationCache.set(cacheKey, location); // Cache the result
        console.log(`Loaded location for ${material.materialCode}: ${location}`);
      });
    });
  }

  // ==================== XUẤT KHO FUNCTIONS ====================
  
  // Open Xuất Kho Dialog
  openXuatKhoDialog(): void {
    this.showXuatKhoDialog = true;
    this.xuatKhoInputText = '';
    this.xuatKhoChecked = false;
    this.xuatKhoPreviewItems = [];
    this.xuatKhoStep = 1;
    this.xuatKhoSelectedShipment = '';
    this.shipmentStockStatus = 'unknown';
    this.loadAvailableShipmentsForXuatKho();
  }

  // Close Xuất Kho Dialog
  closeXuatKhoDialog(): void {
    this.showXuatKhoDialog = false;
    this.xuatKhoInputText = '';
    this.xuatKhoChecked = false;
    this.xuatKhoPreviewItems = [];
    this.xuatKhoStep = 1;
    this.xuatKhoSelectedShipment = '';
    this.shipmentStockStatus = 'unknown';
  }

  // Back to shipment selection
  backToInput(): void {
    this.xuatKhoStep = 1;
    this.xuatKhoChecked = false;
    this.xuatKhoPreviewItems = [];
    this.xuatKhoSelectedShipment = '';
  }

  // Thêm dòng mới vào danh sách xuất kho (dòng trống để nhập tay)
  addXuatKhoRow(): void {
    this.xuatKhoPreviewItems.push({
      materialCode: '',
      batchNumber: '',
      lot: '',
      lsx: '',
      quantity: 0,
      availableStock: 0,
      location: 'Temporary',
      notes: '',
      selected: true
    });
  }

  // Xóa dòng khỏi danh sách xuất kho
  removeXuatKhoItem(index: number): void {
    this.xuatKhoPreviewItems.splice(index, 1);
  }

  // Check if all items are selected
  isAllSelected(): boolean {
    return this.xuatKhoPreviewItems.length > 0 && 
           this.xuatKhoPreviewItems.every(item => item.selected);
  }

  // Toggle select all items
  toggleSelectAll(checked: boolean): void {
    this.xuatKhoPreviewItems.forEach(item => {
      item.selected = checked;
    });
  }

  // Get count of selected items
  getSelectedItemsCount(): number {
    return this.xuatKhoPreviewItems.filter(item => item.selected).length;
  }

  // Load available shipments cho Xuất Kho – chỉ lấy shipment có status "Chờ soạn"
  loadAvailableShipmentsForXuatKho(): void {
    console.log('🔍 Loading available shipments (status Chờ soạn)...');
    
    this.firestore.collection('shipments', ref =>
      ref.where('status', '==', 'Chờ soạn').limit(500)
    ).get().subscribe(snapshot => {
      const shipmentMap = new Map<string, string>(); // code -> factory
      snapshot.docs.forEach(doc => {
        const data = doc.data() as any;
        if (data.shipmentCode) {
          const code = data.shipmentCode;
          const factory = (data.factory || 'ASM1').toString().trim().toUpperCase();
          // Nếu đã có thì không ghi đè (giữ factory đầu tiên)
          if (!shipmentMap.has(code)) {
            shipmentMap.set(code, factory);
          }
        }
      });
      // Convert map to array of objects
      this.xuatKhoAvailableShipments = Array.from(shipmentMap.entries())
        .map(([code, factory]) => ({ code, factory }))
        .sort((a, b) => a.code.localeCompare(b.code));
      console.log('✅ Loaded', this.xuatKhoAvailableShipments.length, 'shipments (Chờ soạn)');
    });
  }

  /** Parse Batch để sắp FIFO (giống FG Inventory): WWMMSSSS */
  private parseBatchForSorting(batch: string): { week: number; middle: number; sequence: number } {
    const def = { week: 9999, middle: 99, sequence: 9999 };
    if (!batch || batch.length < 6) return def;
    const week = parseInt(batch.substring(0, 2), 10) || 0;
    if (batch.length >= 8) {
      const middle = parseInt(batch.substring(2, 4), 10) || 0;
      const sequence = parseInt(batch.substring(4, 8), 10) ?? 9999;
      return { week, middle, sequence };
    }
    const sequence = parseInt(batch.substring(2, 6), 10) ?? 9999;
    return { week, middle: 0, sequence };
  }

  /** So sánh FIFO: Mã TP rồi Batch (batch cũ trước) */
  private compareFIFO(a: { materialCode: string; batchNumber: string }, b: { materialCode: string; batchNumber: string }): number {
    const codeA = (a.materialCode || '').toString().toUpperCase();
    const codeB = (b.materialCode || '').toString().toUpperCase();
    const c = codeA.localeCompare(codeB);
    if (c !== 0) return c;
    const ba = this.parseBatchForSorting(a.batchNumber);
    const bb = this.parseBatchForSorting(b.batchNumber);
    if (ba.week !== bb.week) return ba.week - bb.week;
    if (ba.middle !== bb.middle) return ba.middle - bb.middle;
    return ba.sequence - bb.sequence;
  }

  // Khi đổi shipment ở dropdown → kiểm tra tồn để đổi màu nút Load
  onXuatKhoShipmentChange(shipmentCode: string): void {
    this.xuatKhoSelectedShipment = shipmentCode || '';
    if (!this.xuatKhoSelectedShipment.trim()) {
      this.shipmentStockStatus = 'unknown';
      return;
    }
    this.shipmentStockStatus = 'loading';
    this.checkStockForSelectedShipment(this.xuatKhoSelectedShipment.trim());
  }

  // Chọn shipment từ grid (popup)
  selectShipmentFromGrid(shipment: { code: string; factory: string }): void {
    this.xuatKhoSelectedShipment = shipment.code;
    this.xuatKhoShipmentFactory = shipment.factory;
    this.shipmentStockStatus = 'loading';
    this.checkStockForSelectedShipment(shipment.code);
    console.log('✅ Selected shipment from grid:', shipment.code, 'Factory:', shipment.factory);
  }

  // Xóa selection shipment
  clearShipmentSelection(): void {
    this.xuatKhoSelectedShipment = '';
    this.shipmentStockStatus = 'unknown';
  }

  // Kiểm tra đủ/thiếu tồn cho shipment (chỉ set shipmentStockStatus, không load danh sách)
  private checkStockForSelectedShipment(shipmentCode: string): void {
    this.firestore.collection('shipments', ref =>
      ref.where('shipmentCode', '==', shipmentCode)
    ).get().subscribe(shipmentSnapshot => {
      const demandByMaterial = new Map<string, number>();
      shipmentSnapshot.docs.forEach(doc => {
        const data = doc.data() as any;
        const code = String(data.materialCode || '').trim().toUpperCase();
        const qty = Number(data.quantity) || 0;
        if (code && qty > 0) {
          demandByMaterial.set(code, (demandByMaterial.get(code) || 0) + qty);
        }
      });
      if (demandByMaterial.size === 0) {
        this.shipmentStockStatus = 'unknown';
        return;
      }
      this.firestore.collection('fg-inventory').get().subscribe(invSnapshot => {
        const inventoryRows: Array<{ materialCode: string; batchNumber: string; ton: number }> = [];
        invSnapshot.docs.forEach(doc => {
          const d = doc.data() as any;
          const ton = Number(d.ton ?? d.stock ?? 0) || 0;
          if (ton > 0) {
            inventoryRows.push({
              materialCode: String(d.materialCode || d.maTP || '').trim(),
              batchNumber: String(d.batchNumber || ''),
              ton
            });
          }
        });
        inventoryRows.sort((a, b) => this.compareFIFO(a, b));
        let hasShortage = false;
        demandByMaterial.forEach((qtyNeeded, materialCodeNorm) => {
          const rows = inventoryRows.filter(r => {
            const invCode = (r.materialCode || '').trim().toUpperCase();
            if (invCode === materialCodeNorm) return true;
            if (materialCodeNorm.startsWith(invCode) && invCode.length >= 6) return true;
            if (invCode.startsWith(materialCodeNorm) && materialCodeNorm.length >= 6) return true;
            return false;
          });
          let remaining = qtyNeeded;
          for (const row of rows) {
            if (remaining <= 0) break;
            const take = Math.min(row.ton, remaining);
            if (take > 0) remaining -= take;
          }
          if (remaining > 0) hasShortage = true;
        });
        this.shipmentStockStatus = hasShortage ? 'insufficient' : 'enough';
      });
    });
  }

  // Load danh sách hàng: lọc shipment từ tab Shipment + phân bổ FIFO từ FG Inventory
  loadInventoryForShipment(): void {
    if (!this.xuatKhoSelectedShipment) {
      alert('⚠️ Vui lòng chọn shipment');
      return;
    }

    const shipmentCode = this.xuatKhoSelectedShipment.trim();
    if (!shipmentCode) {
      alert('⚠️ Vui lòng chọn shipment');
      return;
    }

    console.log('🔍 Loading inventory for shipment:', shipmentCode);

    // Bước 1: Lọc shipment đó từ tab Shipment (collection shipments), lấy factory
    this.firestore.collection('shipments', ref =>
      ref.where('shipmentCode', '==', shipmentCode)
    ).get().subscribe(shipmentSnapshot => {
      const demandByMaterial = new Map<string, number>();
      let shipmentFactory = 'ASM1';
      shipmentSnapshot.docs.forEach((doc, idx) => {
        const data = doc.data() as any;
        if (idx === 0) shipmentFactory = (data.factory || 'ASM1').toString().trim().toUpperCase();
        if (shipmentFactory !== 'ASM1' && shipmentFactory !== 'ASM2') shipmentFactory = 'ASM1';
        const code = String(data.materialCode || '').trim().toUpperCase();
        const qty = Number(data.quantity) || 0;
        if (code && qty > 0) {
          demandByMaterial.set(code, (demandByMaterial.get(code) || 0) + qty);
        }
      });
      this.xuatKhoShipmentFactory = shipmentFactory;

      const materialCodesNeeded = Array.from(demandByMaterial.keys());
      if (materialCodesNeeded.length === 0) {
        alert('❌ Không tìm thấy dòng nào của shipment "' + shipmentCode + '" trong tab Shipment. Kiểm tra lại mã shipment.');
        return;
      }

      console.log('📦 Shipment cần xuất (từ tab Shipment):', Object.fromEntries(demandByMaterial), ', factory:', this.xuatKhoShipmentFactory);

      // Bước 2: Load FG Inventory (chỉ nhà máy của shipment) + fg-in + fg-export, tính tồn
      const invGet = this.firestore.collection('fg-inventory').get();
      const fgInGet = this.firestore.collection('fg-in').get();
      const fgExportGet = this.firestore.collection('fg-export').get();

      forkJoin([invGet, fgInGet, fgExportGet]).pipe(take(1)).subscribe(([invSnapshot, fgInSnapshot, fgExportSnapshot]) => {
        const key = (mc: string, batch: string, lsx: string, lot: string) =>
          [String(mc || '').trim(), String(batch || '').trim(), String(lsx || '').trim(), String(lot || '').trim()].join('|');

        const nhapByKey = new Map<string, number>();
        fgInSnapshot.docs.forEach(doc => {
          const data = doc.data() as any;
          const k = key(data.materialCode, data.batchNumber, data.lsx, data.lot);
          const q = Number(data.quantity) || 0;
          nhapByKey.set(k, (nhapByKey.get(k) || 0) + q);
        });
        const xuatByKey = new Map<string, number>();
        fgExportSnapshot.docs.forEach(doc => {
          const data = doc.data() as any;
          const k = key(data.materialCode, data.batchNumber, data.lsx, data.lot);
          const q = Number(data.quantity) || 0;
          xuatByKey.set(k, (xuatByKey.get(k) || 0) + q);
        });

        const inventoryRows: Array<{
          id: string;
          materialCode: string;
          batchNumber: string;
          lot: string;
          lsx: string;
          ton: number;
          location: string;
        }> = [];
        invSnapshot.docs.forEach(doc => {
          const d = doc.data() as any;
          const docFactory = (d.factory || 'ASM1').toString().trim().toUpperCase();
          if (docFactory !== this.xuatKhoShipmentFactory) return; // Chỉ lấy tồn kho đúng nhà máy
          const tonDau = Number(d.tonDau ?? 0) || 0;
          const k = key(d.materialCode || d.maTP, d.batchNumber, d.lsx, d.lot);
          const nhap = nhapByKey.get(k) ?? 0;
          const xuat = xuatByKey.get(k) ?? 0;
          const ton = tonDau + nhap - xuat;
          if (ton > 0) {
            inventoryRows.push({
              id: doc.id,
              materialCode: String(d.materialCode || d.maTP || '').trim(),
              batchNumber: String(d.batchNumber || ''),
              lot: String(d.lot || ''),
              lsx: String(d.lsx || ''),
              ton,
              location: String(d.location || '') || 'Temporary'
            });
          }
        });

        // Sắp FIFO: Mã TP (A,B,C) rồi Batch (cũ trước)
        inventoryRows.sort((a, b) => this.compareFIFO(a, b));

        // Bước 3: Phân bổ FIFO – ví dụ cần 2000, tồn 2 batch 1500 mỗi batch → lấy 1500 + 500
        // Khớp mã TP: exact hoặc base code (P030105_B khớp P030105 và ngược lại)
        this.xuatKhoPreviewItems = [];
        demandByMaterial.forEach((qtyNeeded, materialCodeNorm) => {
          const rows = inventoryRows.filter(r => {
            const invCode = (r.materialCode || '').trim().toUpperCase();
            if (invCode === materialCodeNorm) return true;
            // Mã có thể lưu không hậu tố _B ở kho: P030105 khớp P030105_B
            if (materialCodeNorm.startsWith(invCode) && invCode.length >= 6) return true;
            if (invCode.startsWith(materialCodeNorm) && materialCodeNorm.length >= 6) return true;
            return false;
          });
          let remaining = qtyNeeded;
          for (const row of rows) {
            if (remaining <= 0) break;
            const take = Math.min(row.ton, remaining);
            if (take <= 0) continue;
            this.xuatKhoPreviewItems.push({
              materialCode: row.materialCode,
              batchNumber: row.batchNumber,
              lot: row.lot,
              lsx: row.lsx,
              quantity: take,
              availableStock: row.ton,
              location: row.location,
              notes: '',
              inventoryId: row.id,
              selected: true
            });
            remaining -= take;
          }
          // Không đủ tồn hoặc không có tồn: vẫn thêm dòng với Mã TP, để trống Batch/LOT/LSX
          if (remaining > 0) {
            console.warn(`⚠️ Thiếu tồn cho mã TP ${materialCodeNorm}: cần ${qtyNeeded}, đã phân bổ ${qtyNeeded - remaining}`);
            this.xuatKhoPreviewItems.push({
              materialCode: materialCodeNorm,
              batchNumber: '',
              lot: '',
              lsx: '',
              quantity: remaining,
              availableStock: 0,
              location: '',
              notes: 'Không có tồn kho',
              inventoryId: undefined,
              selected: true
            });
          }
        });

        if (this.xuatKhoPreviewItems.length > 0) {
          this.xuatKhoStep = 2;
          this.xuatKhoChecked = true;
          console.log('✅ Loaded', this.xuatKhoPreviewItems.length, 'dòng xuất (FIFO) cho shipment', shipmentCode);
        } else if (materialCodesNeeded.length > 0) {
          // Không có tồn kho nào → vẫn list ra các mã TP với dòng trống
          materialCodesNeeded.forEach(code => {
            const qty = demandByMaterial.get(code) || 0;
            this.xuatKhoPreviewItems.push({
              materialCode: code,
              batchNumber: '',
              lot: '',
              lsx: '',
              quantity: qty,
              availableStock: 0,
              location: '',
              notes: 'Không có tồn kho',
              inventoryId: undefined,
              selected: true
            });
          });
          this.xuatKhoStep = 2;
          this.xuatKhoChecked = true;
        } else {
          alert('❌ Không tìm thấy dòng hàng nào của shipment này.');
        }
      });
    });
  }

  // Check tồn kho từ FG Inventory (giữ lại để backward compatible)
  checkXuatKho(): void {
    this.loadInventoryForShipment();
  }

  // Approve và lưu vào FG Out + cập nhật FG Inventory
  approveXuatKho(): void {
    // Lọc chỉ những items được chọn
    const selectedItems = this.xuatKhoPreviewItems.filter(item => item.selected);
    
    if (selectedItems.length === 0) {
      alert('⚠️ Vui lòng chọn ít nhất một item để xuất kho');
      return;
    }

    // Kiểm tra số lượng xuất không vượt quá tồn (chỉ với dòng có inventoryId từ kho)
    const hasError = selectedItems.some(item => item.inventoryId && item.quantity > item.availableStock);
    if (hasError) {
      alert('❌ Có mã TP có số lượng xuất vượt quá tồn kho. Vui lòng kiểm tra lại!');
      return;
    }

    const confirmed = confirm(`✅ Xác nhận xuất kho ${selectedItems.length} items đã chọn?`);
    if (!confirmed) return;

    console.log('🚀 Approving export for', selectedItems.length, 'selected items...');
    let savedCount = 0;

    selectedItems.forEach(item => {
      // Tính Carton/ODD từ Standard (danh mục)
      const standard = this.getStandardForMaterial(item.materialCode);
      const carton = (standard != null && standard > 0) ? Math.floor(item.quantity / standard) : 0;
      const odd = (standard != null && standard > 0) ? item.quantity % standard : 0;

      // 1. Tạo record trong FG Out – factory theo shipment (ASM1/ASM2)
      const fgOutRecord: any = {
        factory: this.xuatKhoShipmentFactory,
        exportDate: new Date(),
        shipment: this.xuatKhoSelectedShipment || '',
        pallet: '',
        xp: '',
        materialCode: item.materialCode,
        batchNumber: item.batchNumber,
        lsx: item.lsx,
        lot: item.lot,
        quantity: item.quantity,
        carton,
        qtyBox: 0,
        odd,
        location: item.location,
        notes: item.notes,
        approved: false,
        updateCount: 0,
        pushNo: '000',
        customerCode: '',
        poShip: '',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      fgOutRecord.shipment = this.xuatKhoSelectedShipment; // Gán shipment đã chọn
      
      this.firestore.collection('fg-out').add(fgOutRecord).then(() => {
        console.log(`✅ Created FG Out record for ${item.materialCode}`);
        savedCount++;

        // 2. Cập nhật cột Xuất trong FG Inventory
        if (item.inventoryId) {
          this.firestore.collection('fg-inventory').doc(item.inventoryId).get().subscribe(doc => {
            if (doc.exists) {
              const currentData = doc.data() as any;
              const currentXuat = currentData.xuat || 0;
              const newXuat = currentXuat + item.quantity;
              const currentTon = currentData.ton || 0;
              const newTon = currentTon - item.quantity;

              doc.ref.update({
                xuat: newXuat,
                ton: newTon,
                updatedAt: new Date()
              }).then(() => {
                console.log(`✅ Updated FG Inventory xuat: ${currentXuat} → ${newXuat}, ton: ${currentTon} → ${newTon}`);
              }).catch(error => {
                console.error('❌ Error updating FG Inventory:', error);
              });
            }
          });
        }

        // Khi đã lưu hết
        if (savedCount === selectedItems.length) {
          alert(`✅ Đã duyệt xuất kho thành công ${savedCount} items cho shipment ${this.xuatKhoSelectedShipment}!`);
          this.closeXuatKhoDialog();
          this.loadMaterialsFromFirebase(); // Refresh data
        }
      }).catch(error => {
        console.error('❌ Error creating FG Out record:', error);
        alert('❌ Lỗi khi lưu dữ liệu: ' + error.message);
      });
    });
  }

}
