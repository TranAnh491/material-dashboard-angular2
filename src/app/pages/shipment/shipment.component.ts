import { Component, OnInit, OnDestroy, ChangeDetectorRef, NgZone } from '@angular/core';
import { Subject, combineLatest } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import * as QRCode from 'qrcode';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';

export interface ShipmentItem {
  id?: string;
  shipmentCode: string;
  importDate?: Date | null; // Ngày tháng import
  vehicleNumber?: string; // Biển số xe
  factory?: string; // Nhà máy: ASM1, ASM2, ASM3
  materialCode: string;
  customerCode: string;
  quantity: number;
  poShip: string;
  carton: number;
  qtyBox: number; // Số lượng hàng trong 1 carton
  odd: number;
  inventory?: number; // Thêm trường tồn kho
  shipMethod: string;
  packing: string; // Packing type: Pallet or Box
  qtyPallet: number; // Số lượng pallet
  push: boolean;
  pushNo: string; // Thêm PushNo - format: 001, 002, 003...
  status: string;
  document?: string; // Chứng từ: Đã có PX, Full, Thiếu, PKL
  requestDate: Date | null; // Cho phép null
  fullDate: Date | null; // Cho phép null
  actualShipDate: Date | null; // Cho phép null
  dayPre: number;
  notes: string;
  hidden?: boolean; // Ẩn shipment khỏi danh sách
  createdAt?: Date;
  updatedAt?: Date;
}

@Component({
  selector: 'app-shipment',
  templateUrl: './shipment.component.html',
  styleUrls: ['./shipment.component.css']
})
export class ShipmentComponent implements OnInit, OnDestroy {
  shipments: ShipmentItem[] = [];
  filteredShipments: ShipmentItem[] = [];
  
  // FG Inventory cache
  fgInventoryCache: Map<string, number> = new Map();
  
  // FG Check scanned quantity - tổng số lượng đã scan theo shipmentCode + materialCode (không so sánh đúng/sai)
  fgCheckScannedQty: Map<string, number> = new Map(); // key: shipmentCode|materialCode, value: total scanned qty
  
  // Push tracking to prevent duplicate
  private isPushing: Set<string> = new Set();
  
  // Time range filter
  showTimeRangeDialog: boolean = false;
  startDate: Date = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  endDate: Date = new Date();
  
  // Show/hide hidden shipments
  showHidden: boolean = false;
  
  // Schedule dialog
  showScheduleDialog: boolean = false;
  scheduleMonth: number = new Date().getMonth();
  scheduleYear: number = new Date().getFullYear();
  calendarDays: any[] = [];
  
  // Add shipment dialog
  showAddShipmentDialog: boolean = false;
  
  // Dropdown state
  isDropdownOpen: boolean = false;
  
  // Search term
  searchTerm: string = '';
  
  // Print Label dialog
  showPrintLabelDialog: boolean = false;
  selectedShipmentForPrint: ShipmentItem | null = null;
  
  newShipment: ShipmentItem = {
    shipmentCode: '',
    importDate: new Date(),
    vehicleNumber: '',
    factory: 'ASM1',
    materialCode: '',
    customerCode: '',
    quantity: 0,
    poShip: '',
    carton: 0,
    qtyBox: 0, // Khởi tạo QTYBOX = 0
    odd: 0,
    inventory: 0, // Khởi tạo tồn kho = 0
    shipMethod: '',
    packing: 'Pallet', // Mặc định là Pallet
    qtyPallet: 0, // Khởi tạo Qty Pallet = 0
    push: false,
    pushNo: '000', // Khởi tạo PushNo = 000
    status: 'Chờ soạn',
    document: 'Đã có PX',
    requestDate: new Date(),
    fullDate: new Date(),
    actualShipDate: new Date(),
    dayPre: 0,
    notes: '',
    hidden: false
  };
  
  private destroy$ = new Subject<void>();

  // Scroll position tracking
  private scrollPosition: number = 0;
  private shouldRestoreScroll: boolean = false;
  
  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    // Fix date format issues - use proper date initialization
    this.startDate = new Date('2020-01-01');
    this.endDate = new Date('2030-12-31');
    
    // Load dữ liệu - chỉ shipments dùng realtime, các collection khác load 1 lần
    this.loadShipmentsFromFirebase();
    this.loadFGInventoryCacheOnce();
    this.loadFGCheckStatusOnce();
    // applyFilters() sẽ được gọi tự động trong loadShipmentsFromFirebase
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.isPushing.clear();
  }

  // Load shipments from Firebase
  loadShipmentsFromFirebase(): void {
    this.firestore.collection('shipments')
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((actions) => {
        const firebaseShipments = actions.map(action => {
          const data = action.payload.doc.data() as any;
          const id = action.payload.doc.id;
          return {
            id: id,
            ...data,
            push: data.push === 'true' || data.push === true || data.push === 1,
            pushNo: data.pushNo || '000', // Default PushNo if not exists
            inventory: data.inventory || 0, // Default inventory if not exists
            packing: data.packing || 'Pallet', // Default packing if not exists
            qtyPallet: data.qtyPallet || 0, // Default qtyPallet if not exists
            hidden: data.hidden === true, // Load hidden status
            importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : null,
            vehicleNumber: data.vehicleNumber ? String(data.vehicleNumber).toUpperCase().trim() : '',
            factory: data.factory || 'ASM1',
            document: data.document || 'Đã có PX',
            requestDate: data.requestDate ? new Date(data.requestDate.seconds * 1000) : null,
            fullDate: data.fullDate ? new Date(data.fullDate.seconds * 1000) : null,
            actualShipDate: data.actualShipDate ? new Date(data.actualShipDate.seconds * 1000) : null
          };
        });
        
        this.shipments = firebaseShipments;
        this.applyFilters();
        
        // Restore scroll position if needed
        if (this.shouldRestoreScroll) {
          this.ngZone.runOutsideAngular(() => {
            setTimeout(() => {
              this.restoreScrollPosition();
              this.shouldRestoreScroll = false;
            }, 0);
          });
        }
      });
  }

  // Toggle dropdown
  toggleDropdown(): void {
    this.isDropdownOpen = !this.isDropdownOpen;
  }

  // Close dropdown when clicking outside
  closeDropdown(): void {
    this.isDropdownOpen = false;
  }

  // Get total shipments count (đếm số shipment duy nhất, bỏ dòng trùng)
  getTotalShipments(): number {
    const uniqueShipments = new Set(this.filteredShipments.map(s => String(s.shipmentCode || '').trim().toUpperCase()));
    return uniqueShipments.size;
  }

  // Get completed shipments count
  getCompletedShipments(): number {
    return this.filteredShipments.filter(s => s.status === 'Đã xong').length;
  }

  // Get missing items shipments count
  getMissingItemsShipments(): number {
    return this.filteredShipments.filter(s => {
      // Check if inventory is less than quantity needed
      const inventory = this.getInventory(s.materialCode);
      return inventory < s.quantity;
    }).length;
  }

  // Get in progress shipments count
  getInProgressShipments(): number {
    return this.filteredShipments.filter(s => s.status === 'Đang soạn').length;
  }

  // Get pending shipments count
  getPendingShipments(): number {
    return this.filteredShipments.filter(s => s.status === 'Chờ soạn').length;
  }

  // Get delay shipments count
  getDelayShipments(): number {
    return this.filteredShipments.filter(s => s.status === 'Delay').length;
  }

  // Apply filters
  applyFilters(): void {
    this.filteredShipments = this.shipments.filter(shipment => {
      // Filter ra các shipment đã ẩn (trừ khi showHidden = true)
      if (shipment.hidden === true && !this.showHidden) {
        return false;
      }
      
      // Filter by date range - QUAN TRỌNG: Nếu không có requestDate thì vẫn hiển thị
      let isInDateRange = true;
      if (shipment.requestDate) {
        const requestDate = new Date(shipment.requestDate);
        isInDateRange = requestDate >= this.startDate && requestDate <= this.endDate;
      }
      // Nếu requestDate = null/undefined, tự động pass filter (hiển thị luôn)
      
      // Filter by search term
      const matchesSearch = !this.searchTerm || 
        shipment.shipmentCode.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        shipment.materialCode.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        shipment.customerCode.toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        shipment.poShip.toLowerCase().includes(this.searchTerm.toLowerCase());
      
      return isInDateRange && matchesSearch;
    });
    
    // Sắp xếp: 1) Dispatch Date, 2) Shipment Code, 3) Mã TP (A,B,C)
    this.filteredShipments.sort((a, b) => {
      // Bước 1: So sánh Dispatch Date (actualShipDate) - ngày sớm nhất lên đầu
      const dispatchA = a.actualShipDate ? new Date(a.actualShipDate).getTime() : Number.MAX_SAFE_INTEGER;
      const dispatchB = b.actualShipDate ? new Date(b.actualShipDate).getTime() : Number.MAX_SAFE_INTEGER;
      if (dispatchA !== dispatchB) {
        return dispatchA - dispatchB;
      }
      
      // Bước 2: Nếu Dispatch Date giống nhau, so sánh Shipment Code - sắp theo A, B, C
      const shipmentA = String(a.shipmentCode || '').toUpperCase();
      const shipmentB = String(b.shipmentCode || '').toUpperCase();
      const shipmentCompare = shipmentA.localeCompare(shipmentB);
      if (shipmentCompare !== 0) {
        return shipmentCompare;
      }
      
      // Bước 3: Nếu Shipment giống nhau, so sánh Mã TP (materialCode) - sắp theo A, B, C
      const materialA = String(a.materialCode || '').toUpperCase();
      const materialB = String(b.materialCode || '').toUpperCase();
      return materialA.localeCompare(materialB);
    });
  }

  private normalizeShipmentCode(code: string | undefined | null): string {
    return (code ?? '').toString().trim().toUpperCase();
  }

  // Handle Vehicle Number change - sync to all rows with same shipmentCode and convert to uppercase
  onVehicleNumberChange(shipment: ShipmentItem): void {
    // Convert to uppercase
    if (shipment.vehicleNumber) {
      shipment.vehicleNumber = shipment.vehicleNumber.toUpperCase().trim();
    }
    
    const shipmentCode = this.normalizeShipmentCode(shipment.shipmentCode);
    const newVehicleNumber = shipment.vehicleNumber || '';
    
    if (!shipmentCode) {
      // If no shipment code, just update this one
      this.updateShipmentInFirebase(shipment);
      return;
    }
    
    // Find all shipments with the same shipmentCode
    const sameShipmentRows = this.shipments.filter(s => 
      this.normalizeShipmentCode(s.shipmentCode) === shipmentCode
    );
    
    // Update Vehicle Number for all rows with same shipmentCode
    sameShipmentRows.forEach(s => {
      s.vehicleNumber = newVehicleNumber;
      this.updateShipmentInFirebase(s);
    });
  }

  /** Định dạng số: hàng nghìn bằng dấu phẩy (ví dụ 1,000), không có số lẻ thập phân */
  formatNumber(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '0';
    }
    return value.toLocaleString('en-US', { maximumFractionDigits: 0, minimumFractionDigits: 0 });
  }

  // Get status class for styling
  getStatusClass(status: string): string {
    switch (status) {
      case 'Đã xong':
        return 'status-completed';
      case 'Đang soạn':
        return 'status-progress';
      case 'Chờ soạn':
        return 'status-pending';
      case 'Đã Ship':
        return 'status-shipped';
      case 'Delay':
        return 'status-delay';
      default:
        return 'status-pending';
    }
  }

  // Time range filter
  applyTimeRangeFilter(): void {
    this.applyFilters();
    this.showTimeRangeDialog = false;
  }

  // Add shipment
  canAddShipment(): boolean {
    return !!(this.newShipment.shipmentCode.trim() && 
              this.newShipment.materialCode.trim() && 
              this.newShipment.quantity > 0);
  }

  addShipment(): void {
    if (!this.canAddShipment()) {
      alert('❌ Vui lòng nhập đầy đủ thông tin bắt buộc');
      return;
    }

    // Tự động điền Dispatch Date khi Status = "Đã Ship"
    if (this.newShipment.status === 'Đã Ship' && !this.newShipment.actualShipDate) {
      this.newShipment.actualShipDate = new Date();
    }

    const shipmentData = {
      ...this.newShipment,
      requestDate: this.newShipment.requestDate,
      fullDate: this.newShipment.fullDate,
      actualShipDate: this.newShipment.actualShipDate,
      pushNo: this.newShipment.pushNo || '000', // Ensure PushNo is included
      inventory: this.newShipment.inventory || 0, // Ensure inventory is included
      packing: this.newShipment.packing || 'Pallet', // Ensure packing is included
      qtyPallet: this.newShipment.qtyPallet || 0, // Ensure qtyPallet is included
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    this.firestore.collection('shipments').add(shipmentData)
      .then((docRef) => {
        this.resetNewShipment();
        this.showAddShipmentDialog = false;
        alert('✅ Đã thêm shipment thành công!');
      })
      .catch(error => {
        console.error('Error adding shipment:', error);
        alert('❌ Lỗi khi thêm shipment: ' + error.message);
      });
  }

  // Load FG Check: realtime + cộng dồn toàn bộ số lượng đã check (tab FG check) theo shipmentCode + materialCode (không so sánh đúng/sai)
  // Load FG Check status - one-time load (tối ưu performance)
  loadFGCheckStatusOnce(): void {
    this.firestore.collection('fg-check')
      .get()
      .toPromise()
      .then((snapshot) => {
        this.fgCheckScannedQty.clear();
        
        if (snapshot) {
          snapshot.forEach(doc => {
            const data = doc.data() as any;
            const shipmentCode = String(data.shipment || '').trim().toUpperCase();
            const materialCode = String(data.materialCode || '').trim().toUpperCase();
            const quantity = Number(data.quantity) || 0;
            
            if (shipmentCode && materialCode) {
              const key = `${shipmentCode}|${materialCode}`;
              const current = this.fgCheckScannedQty.get(key) || 0;
              this.fgCheckScannedQty.set(key, current + quantity);
            }
          });
        }
      })
      .catch(error => {
        console.error('Error loading FG Check status:', error);
      });
  }
  
  // Load FG Check status - realtime (deprecated, giữ lại để tương thích)
  loadFGCheckStatus(): void {
    this.firestore.collection('fg-check')
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((actions) => {
        this.fgCheckScannedQty.clear();
        
        actions.forEach(action => {
          const data = action.payload.doc.data() as any;
          const shipmentCode = String(data.shipment || '').trim().toUpperCase();
          const materialCode = String(data.materialCode || '').trim().toUpperCase();
          const quantity = Number(data.quantity) || 0;
          
          if (shipmentCode && materialCode) {
            const key = `${shipmentCode}|${materialCode}`;
            const current = this.fgCheckScannedQty.get(key) || 0;
            this.fgCheckScannedQty.set(key, current + quantity);
          }
        });
      });
  }

  // Coi là đã check khi tổng lượng scan đủ (không so sánh đúng/sai nữa)
  isShipmentChecked(shipment: ShipmentItem): boolean {
    return this.getShipmentCheckDisplay(shipment).status === 'ok';
  }

  /** Tổng số lượng đã scan ở tab FG Check theo Shipment + Mã TP (hiển thị cột LƯỢNG KTRA). */
  getScannedQuantity(shipment: ShipmentItem): number {
    const shipmentCode = String(shipment.shipmentCode || '').trim().toUpperCase();
    const materialCode = String(shipment.materialCode || '').trim().toUpperCase();
    const key = `${shipmentCode}|${materialCode}`;
    return this.fgCheckScannedQty.get(key) || 0;
  }

  /** Kiểm tra xem dòng hiện tại có phải là dòng đầu tiên của shipment mới không (để vẽ đường kẻ phân biệt). */
  isFirstOfShipment(index: number): boolean {
    if (index === 0) return false; // Dòng đầu tiên không cần border
    const current = this.filteredShipments[index];
    const previous = this.filteredShipments[index - 1];
    return current.shipmentCode !== previous.shipmentCode;
  }

  /** Kiểm tra xem lượng kiểm tra có bằng với lượng xuất không (để tô nền xanh). */
  isQuantityMatched(shipment: ShipmentItem): boolean {
    const scannedQty = this.getScannedQuantity(shipment);
    const quantity = shipment.quantity || 0;
    return scannedQty > 0 && scannedQty === quantity;
  }

  /** Kiểm tra tổng lượng xuất = tổng lượng KTRA theo shipment + mã TP (cho cột CHECK). */
  isCheckOK(shipment: ShipmentItem): boolean {
    const shipmentCode = String(shipment.shipmentCode || '').trim().toUpperCase();
    const materialCode = String(shipment.materialCode || '').trim().toUpperCase();
    
    // Tính tổng lượng xuất của tất cả dòng có cùng shipmentCode + materialCode
    const totalQuantity = this.shipments
      .filter(s => {
        const sCode = String(s.shipmentCode || '').trim().toUpperCase();
        const mCode = String(s.materialCode || '').trim().toUpperCase();
        return sCode === shipmentCode && mCode === materialCode;
      })
      .reduce((sum, s) => sum + (Number(s.quantity) || 0), 0);
    
    // Lấy tổng lượng KTRA từ fgCheckScannedQty
    const key = `${shipmentCode}|${materialCode}`;
    const scannedQty = this.fgCheckScannedQty.get(key) || 0;
    
    // Return true nếu tổng lượng xuất = tổng lượng KTRA (và > 0)
    return totalQuantity > 0 && scannedQty > 0 && totalQuantity === scannedQty;
  }

  /** So sánh tổng lượng đã check (FG Check cộng dồn) với số lượng shipment theo mã TP. Trả về: ok / excess (Dư) / percentage (% đã check). */
  getShipmentCheckDisplay(shipment: ShipmentItem): { status: 'ok' | 'excess' | 'percentage'; value: number | null } {
    const shipmentCode = String(shipment.shipmentCode || '').trim().toUpperCase();
    const materialCode = String(shipment.materialCode || '').trim().toUpperCase();
    const key = `${shipmentCode}|${materialCode}`;
    const expected = Number(shipment.quantity) || 0;
    const scanned = this.fgCheckScannedQty.get(key) || 0;
    if (expected <= 0) {
      return scanned > 0 ? { status: 'excess', value: null } : { status: 'ok', value: null };
    }
    if (scanned > expected) return { status: 'excess', value: null };
    if (scanned === expected) return { status: 'ok', value: null };
    const pct = Math.round((scanned / expected) * 100);
    return { status: 'percentage', value: pct };
  }


  // Load FG Inventory cache - one-time load (tối ưu performance)
  async loadFGInventoryCacheOnce(): Promise<void> {
    try {
      // Load all three collections at once
      const [fgInventorySnapshot, fgInSnapshot, fgExportSnapshot] = await Promise.all([
        this.firestore.collection('fg-inventory').get().toPromise(),
        this.firestore.collection('fg-in').get().toPromise(),
        this.firestore.collection('fg-export').get().toPromise()
      ]);
      
      // Clear cache
      this.fgInventoryCache.clear();
      
      // Group by materialCode and get tonDau from fg-inventory
      const materialData: {[key: string]: {tonDau: number, nhap: number, xuat: number}} = {};
      
      // Process fg-inventory data
      if (fgInventorySnapshot) {
        fgInventorySnapshot.forEach(doc => {
          const data = doc.data() as any;
          const materialCode = data.materialCode || '';
          const tonDau = data.tonDau || 0;
          
          if (materialCode) {
            if (!materialData[materialCode]) {
              materialData[materialCode] = {tonDau: 0, nhap: 0, xuat: 0};
            }
            materialData[materialCode].tonDau += tonDau;
          }
        });
      }
      
      // Process fg-in data
      if (fgInSnapshot) {
        fgInSnapshot.forEach(doc => {
          const data = doc.data() as any;
          const materialCode = data.materialCode || '';
          const quantity = data.quantity || 0;
          
          if (materialCode) {
            if (!materialData[materialCode]) {
              materialData[materialCode] = {tonDau: 0, nhap: 0, xuat: 0};
            }
            materialData[materialCode].nhap += quantity;
          }
        });
      }
      
      // Process fg-export data
      if (fgExportSnapshot) {
        fgExportSnapshot.forEach(doc => {
          const data = doc.data() as any;
          const materialCode = data.materialCode || '';
          const quantity = data.quantity || 0;
          
          if (materialCode) {
            if (!materialData[materialCode]) {
              materialData[materialCode] = {tonDau: 0, nhap: 0, xuat: 0};
            }
            materialData[materialCode].xuat += quantity;
          }
        });
      }
      
      // Calculate final ton for each material
      Object.keys(materialData).forEach(materialCode => {
        const data = materialData[materialCode];
        const calculatedTon = data.tonDau + data.nhap - data.xuat;
        this.fgInventoryCache.set(materialCode, calculatedTon);
      });
    } catch (error) {
      console.error('Error loading FG Inventory cache:', error);
    }
  }
  
  // Load FG Inventory cache - realtime (deprecated, giữ lại để tương thích)
  loadFGInventoryCache(): void {
    // Use combineLatest to load data from all three collections
    const fgInventory$ = this.firestore.collection('fg-inventory').snapshotChanges();
    const fgIn$ = this.firestore.collection('fg-in').snapshotChanges();
    const fgExport$ = this.firestore.collection('fg-export').snapshotChanges();
    
    combineLatest([fgInventory$, fgIn$, fgExport$])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([fgInventoryActions, fgInActions, fgExportActions]) => {
        // Clear cache
        this.fgInventoryCache.clear();
        
        // Group by materialCode and get tonDau from fg-inventory
        const materialData: {[key: string]: {tonDau: number, nhap: number, xuat: number}} = {};
        
        // Process fg-inventory data
        fgInventoryActions.forEach(action => {
          const data = action.payload.doc.data() as any;
          const materialCode = data.materialCode || '';
          const tonDau = data.tonDau || 0;
          
          if (materialCode) {
            if (!materialData[materialCode]) {
              materialData[materialCode] = {tonDau: 0, nhap: 0, xuat: 0};
            }
            materialData[materialCode].tonDau += tonDau;
          }
        });
        
        // Process fg-in data
        fgInActions.forEach(action => {
          const data = action.payload.doc.data() as any;
          const materialCode = data.materialCode || '';
          const quantity = data.quantity || 0;
          
          if (materialCode) {
            if (!materialData[materialCode]) {
              materialData[materialCode] = {tonDau: 0, nhap: 0, xuat: 0};
            }
            materialData[materialCode].nhap += quantity;
          }
        });
        
        // Process fg-export data
        fgExportActions.forEach(action => {
          const data = action.payload.doc.data() as any;
          const materialCode = data.materialCode || '';
          const quantity = data.quantity || 0;
          
          if (materialCode) {
            if (!materialData[materialCode]) {
              materialData[materialCode] = {tonDau: 0, nhap: 0, xuat: 0};
            }
            materialData[materialCode].xuat += quantity;
          }
        });
        
        // Calculate final ton for each material
        Object.keys(materialData).forEach(materialCode => {
          const data = materialData[materialCode];
          const calculatedTon = data.tonDau + data.nhap - data.xuat;
          this.fgInventoryCache.set(materialCode, calculatedTon);
        });
      });
  }

  // Get inventory for material code from FG Inventory cache
  getInventory(materialCode: string): number {
    return this.fgInventoryCache.get(materialCode) || 0;
  }

  // Force refresh FG Inventory cache và FG Check status
  refreshFGInventoryCache(): void {
    this.loadFGInventoryCacheOnce();
    this.loadFGCheckStatusOnce();
    alert('✅ Đã refresh tồn kho và trạng thái Check!\n\nDữ liệu đã được cập nhật.');
  }


  // Handle quantity input change with formatting
  /** Cập nhật quantity khi gõ (chỉ đổi giá trị hiển thị, chưa lưu Firebase). */
  onQuantityInput(event: any, shipment: ShipmentItem): void {
    const inputValue = event.target.value;
    const numericValue = parseFloat(String(inputValue).replace(/,/g, '')) || 0;
    shipment.quantity = numericValue;
  }

  /** Lưu Lượng xuất vào Firebase khi click ra ngoài ô (blur). */
  onQuantityBlur(shipment: ShipmentItem): void {
    this.updateShipmentInFirebase(shipment);
  }

  resetNewShipment(): void {
    this.newShipment = {
      shipmentCode: '',
      importDate: new Date(),
      vehicleNumber: '',
      factory: 'ASM1',
      materialCode: '',
      customerCode: '',
      quantity: 0,
      poShip: '',
      carton: 0,
      qtyBox: 0, // Khởi tạo QTYBOX = 0
      odd: 0,
      inventory: 0,
      shipMethod: '',
      packing: 'Pallet', // Mặc định là Pallet
      qtyPallet: 0, // Khởi tạo Qty Pallet = 0
      push: false,
      pushNo: '000',
      status: 'Chờ soạn',
      document: 'Đã có PX',
      requestDate: new Date(), // CS Date = ngày tạo shipment
      fullDate: null,
      actualShipDate: null,
      dayPre: 0,
      notes: '',
      hidden: false
    };
  }

  // Update notes
  updateNotes(shipment: ShipmentItem): void {
    shipment.updatedAt = new Date();
    this.updateShipmentInFirebase(shipment);
  }

  // Handle status change - tự động điền Dispatch Date khi Status = "Đã Ship"
  onStatusChange(shipment: ShipmentItem): void {
    if (shipment.status === 'Đã Ship' && !shipment.actualShipDate) {
      shipment.actualShipDate = new Date();
    }
    this.updateShipmentInFirebase(shipment);
  }

  // Handle push checkbox change
  onPushChange(shipment: ShipmentItem): void {
    shipment.updatedAt = new Date();
    
    if (shipment.push) {
      // Check if already pushed to prevent duplicate
      if (shipment.pushNo && shipment.pushNo !== '000') {
        console.log(`⚠️ Shipment ${shipment.shipmentCode} already pushed with PushNo: ${shipment.pushNo}`);
        return;
      }
      
      // Always generate new PushNo when push is checked (mỗi lần push sẽ có số mới)
      this.generatePushNoSync(shipment);
      
      // Save PushNo to Firebase immediately to prevent duplicate
      this.updateShipmentInFirebase(shipment);
      
      // Check stock before auto-push
      this.checkStockAndPush(shipment);
    } else {
      // When unchecked, reset PushNo to 000
      shipment.pushNo = '000';
      this.updateShipmentInFirebase(shipment);
    }
  }

  // Check stock and push if available
  private checkStockAndPush(shipment: ShipmentItem): void {
    // Get FG Inventory data and check availability
    this.firestore.collection('fg-inventory').get().subscribe({
      next: (inventorySnapshot) => {
        // Get all inventory items for this material code
        const inventoryItems = inventorySnapshot.docs
          .map(doc => doc.data() as any)
          .filter(item => item.materialCode === shipment.materialCode)
          .sort((a, b) => this.compareBatchNumbers(a.batchNumber, b.batchNumber));
        
        if (inventoryItems.length === 0) {
          const message = `❌ KHÔNG TÌM THẤY TỒN KHO!\n\n` +
            `Mã hàng: ${shipment.materialCode}\n` +
            `Số lượng yêu cầu: ${shipment.quantity.toLocaleString('vi-VN')}\n\n` +
            `Vui lòng kiểm tra lại mã hàng trong FG Inventory!`;
          
          alert(message);
          shipment.push = false; // Uncheck the push checkbox
          shipment.pushNo = '000';
          this.updateShipmentInFirebase(shipment);
          return;
        }
        
        // Check stock availability
        const stockCheck = this.checkStockAvailability(shipment, inventoryItems);
        
        if (!stockCheck.hasEnoughStock) {
          const message = `⚠️ CẢNH BÁO: KHÔNG ĐỦ STOCK!\n\n` +
            `Mã hàng: ${shipment.materialCode}\n` +
            `Số lượng yêu cầu: ${shipment.quantity.toLocaleString('vi-VN')}\n` +
            `Tồn kho hiện có: ${stockCheck.totalAvailable.toLocaleString('vi-VN')}\n` +
            `Thiếu: ${stockCheck.shortage.toLocaleString('vi-VN')}\n\n` +
            `Hệ thống sẽ tạo FG Out với lượng hiện có (${stockCheck.totalAvailable.toLocaleString('vi-VN')}).\n` +
            `Lượng thiếu (${stockCheck.shortage.toLocaleString('vi-VN')}) sẽ được nhân viên điền tay sau.`;
          
          const confirmed = confirm(message + '\n\nBạn có muốn tiếp tục?');
          
          if (!confirmed) {
            shipment.push = false; // Uncheck the push checkbox
            shipment.pushNo = '000';
            this.updateShipmentInFirebase(shipment);
            return;
          }
          
          // Update shipment quantity to available stock
          shipment.quantity = stockCheck.totalAvailable;
          this.updateShipmentInFirebase(shipment);
          
          console.log(`⚠️ Stock insufficient for ${shipment.materialCode}: Required ${shipment.quantity}, Available ${stockCheck.totalAvailable}, will push with available stock`);
        }
        
        console.log(`✅ Stock check passed for ${shipment.materialCode}: Required ${shipment.quantity}, Available ${stockCheck.totalAvailable}`);
        
        // Auto-push if stock is available
        this.transferToFGOut(shipment);
      },
      error: (error) => {
        const message = `❌ LỖI KHI KIỂM TRA TỒN KHO!\n\n` +
          `Mã hàng: ${shipment.materialCode}\n` +
          `Lỗi: ${error.message}\n\n` +
          `Push đã bị hủy!`;
        
        alert(message);
        shipment.push = false; // Uncheck the push checkbox
        shipment.pushNo = '000';
        this.updateShipmentInFirebase(shipment);
        console.log(`⚠️ Error getting FG Inventory: ${error.message}`);
      }
    });
  }

  // Push final data to FG Out (manual trigger)
  pushFinalToFGOut(shipment: ShipmentItem): void {
    if (!shipment.push || !shipment.pushNo || shipment.pushNo === '000') {
      alert('❌ Vui lòng tick Push và đảm bảo có PushNo trước khi push!');
      return;
    }

    // Confirm before pushing
    const confirmed = confirm(`✅ Xác nhận push dữ liệu cuối cùng?\n\nShipment: ${shipment.shipmentCode}\nMaterial: ${shipment.materialCode}\nPushNo: ${shipment.pushNo}\n\nDữ liệu sẽ được đóng băng tại thời điểm này.`);
    
    if (confirmed) {
      console.log(`🚀 Manual push to FG Out: ${shipment.shipmentCode}, PushNo: ${shipment.pushNo}`);
      this.transferToFGOut(shipment);
    }
  }

  // Generate PushNo - format: DDMM+HHMM (8 số)
  private generatePushNoSync(shipment: ShipmentItem): void {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    
    // Format: DDMM+HHMM (8 số)
    const pushNo = day + month + hour + minute;
        shipment.pushNo = pushNo;
    console.log(`🔄 Generated PushNo: ${pushNo} (${day}/${month} ${hour}:${minute})`);
        
        // Update Firebase after generating PushNo
        this.updateShipmentInFirebase(shipment);
        
        // Transfer to FG Out after generating PushNo
        this.transferToFGOut(shipment);
  }


  // Transfer shipment data to FG Out - ADD NEW VERSION (không xóa dữ liệu cũ)
  private transferToFGOut(shipment: ShipmentItem): void {
    const pushKey = `${shipment.shipmentCode}-${shipment.materialCode}-${shipment.pushNo}`;
    
    // Check if already pushing this shipment
    if (this.isPushing.has(pushKey)) {
      console.log(`⚠️ Already pushing shipment: ${pushKey}`);
      return;
    }
    
    // Mark as pushing
    this.isPushing.add(pushKey);
    
    console.log(`🔄 Starting transfer to FG Out for shipment: ${shipment.shipmentCode}, material: ${shipment.materialCode}, PushNo: ${shipment.pushNo}`);
    
    // Get FG Inventory data and check availability
    this.firestore.collection('fg-inventory').get().subscribe({
      next: (inventorySnapshot) => {
        // Get all inventory items for this material code
        const inventoryItems = inventorySnapshot.docs
          .map(doc => doc.data() as any)
          .filter(item => item.materialCode === shipment.materialCode)
          .sort((a, b) => this.compareBatchNumbers(a.batchNumber, b.batchNumber));
        
        if (inventoryItems.length === 0) {
          const message = `❌ KHÔNG TÌM THẤY TỒN KHO!\n\n` +
            `Mã hàng: ${shipment.materialCode}\n` +
            `Số lượng yêu cầu: ${shipment.quantity.toLocaleString('vi-VN')}\n\n` +
            `Vui lòng kiểm tra lại mã hàng trong FG Inventory!`;
          
          alert(message);
          console.log(`⚠️ No FG Inventory found for material: ${shipment.materialCode}`);
          return;
        }
        
        // Check stock availability first
        const stockCheck = this.checkStockAvailability(shipment, inventoryItems);
        
        if (!stockCheck.hasEnoughStock) {
          const message = `⚠️ CẢNH BÁO: KHÔNG ĐỦ STOCK!\n\n` +
            `Mã hàng: ${shipment.materialCode}\n` +
            `Số lượng yêu cầu: ${shipment.quantity.toLocaleString('vi-VN')}\n` +
            `Tồn kho hiện có: ${stockCheck.totalAvailable.toLocaleString('vi-VN')}\n` +
            `Thiếu: ${stockCheck.shortage.toLocaleString('vi-VN')}\n\n` +
            `Hệ thống sẽ tạo FG Out với lượng hiện có (${stockCheck.totalAvailable.toLocaleString('vi-VN')}).\n` +
            `Lượng thiếu (${stockCheck.shortage.toLocaleString('vi-VN')}) sẽ được nhân viên điền tay sau.`;
          
          const confirmed = confirm(message + '\n\nBạn có muốn tiếp tục?');
          
          if (!confirmed) {
            console.log(`❌ User cancelled push for ${shipment.materialCode} due to insufficient stock`);
            return;
          }
          
          // Update shipment quantity to available stock
          shipment.quantity = stockCheck.totalAvailable;
          this.updateShipmentInFirebase(shipment);
          
          console.log(`⚠️ Stock insufficient for ${shipment.materialCode}: Required ${shipment.quantity}, Available ${stockCheck.totalAvailable}, will push with available stock`);
        }
        
        console.log(`✅ Stock check passed for ${shipment.materialCode}: Required ${shipment.quantity}, Available ${stockCheck.totalAvailable}`);
        
        // Check inventory availability and create records
        this.createFGOutRecordsWithInventoryCheck(shipment, inventoryItems);
      },
      error: (error) => {
        const message = `❌ LỖI KHI KIỂM TRA TỒN KHO!\n\n` +
          `Mã hàng: ${shipment.materialCode}\n` +
          `Lỗi: ${error.message}\n\n` +
          `Vui lòng thử lại sau!`;
        
        alert(message);
        console.log(`⚠️ Error getting FG Inventory: ${error.message}`);
      }
    });
  }

  // Compare batch numbers for sorting
  private compareBatchNumbers(batchA: string, batchB: string): number {
    // Extract week and sequence from batch format (WWXXXX)
    const parseBatch = (batch: string) => {
      if (!batch || batch.length < 6) return { week: 9999, sequence: 9999 };
      const week = parseInt(batch.substring(0, 2)) || 9999;
      const sequence = parseInt(batch.substring(2, 6)) || 9999;
      return { week, sequence };
    };
    
    const a = parseBatch(batchA);
    const b = parseBatch(batchB);
    
    if (a.week !== b.week) return a.week - b.week;
    return a.sequence - b.sequence;
  }

  // Check if there's enough stock for the shipment
  private checkStockAvailability(shipment: ShipmentItem, inventoryItems: any[]): { hasEnoughStock: boolean; totalAvailable: number; shortage: number } {
    const requiredQuantity = shipment.quantity;
    const totalAvailable = inventoryItems.reduce((sum, item) => sum + (item.ton || 0), 0);
    const shortage = Math.max(0, requiredQuantity - totalAvailable);
    
    return {
      hasEnoughStock: totalAvailable >= requiredQuantity,
      totalAvailable: totalAvailable,
      shortage: shortage
    };
  }

  // Create FG Out records with inventory availability check
  private createFGOutRecordsWithInventoryCheck(shipment: ShipmentItem, inventoryItems: any[]): void {
    // Stock check already performed in transferToFGOut method
    const requiredQuantity = shipment.quantity;
    let remainingQuantity = requiredQuantity;
    const fgOutRecords: any[] = [];
    
    console.log(`📊 Checking inventory for ${shipment.materialCode}, required: ${requiredQuantity}`);
    
    // Collect all quantities from different batches first - GROUP BY BATCH INFO
    const batchQuantities: {batch: any, quantity: number}[] = [];
    const batchMap = new Map<string, {batch: any, totalQuantity: number}>();
    
    // Group inventory items by batch info
    for (const inventoryItem of inventoryItems) {
      const availableQuantity = inventoryItem.ton || 0;
      if (availableQuantity <= 0) continue;
      
      const batchKey = `${inventoryItem.batchNumber}-${inventoryItem.lsx}-${inventoryItem.lot}`;
      
      if (batchMap.has(batchKey)) {
        // Add to existing batch
        const existing = batchMap.get(batchKey)!;
        existing.totalQuantity += availableQuantity;
      } else {
        // Create new batch
        batchMap.set(batchKey, {
          batch: inventoryItem,
          totalQuantity: availableQuantity
        });
      }
    }
    
    // Convert to array and process
    for (const [batchKey, batchData] of batchMap) {
      if (remainingQuantity <= 0) break;
      
      const quantityToTake = Math.min(remainingQuantity, batchData.totalQuantity);
      batchQuantities.push({
        batch: batchData.batch,
        quantity: quantityToTake
      });
      
      remainingQuantity -= quantityToTake;
      console.log(`✅ Using batch ${batchData.batch.batchNumber}: ${quantityToTake} units (${remainingQuantity} remaining)`);
    }
    
    if (remainingQuantity > 0) {
      console.log(`⚠️ Insufficient inventory: ${remainingQuantity} units short`);
      alert(`⚠️ Cảnh báo: Không đủ tồn kho!\n\nMã hàng: ${shipment.materialCode}\nCần: ${requiredQuantity}\nThiếu: ${remainingQuantity}\n\nSẽ tạo record với dữ liệu mặc định.`);
      
      batchQuantities.push({
        batch: {batchNumber: 'BATCH999', lsx: 'LSX999', lot: 'LOT999'},
        quantity: remainingQuantity
      });
    }
    
    console.log(`📊 Final batchQuantities count: ${batchQuantities.length}`);
    console.log(`📋 BatchQuantities:`, batchQuantities.map(b => `${b.batch.batchNumber}: ${b.quantity}`));
    
    // Now create FG Out records with proper carton distribution
    this.createFGOutRecordsWithCartonDistribution(shipment, batchQuantities, fgOutRecords);
    
    // Save all records
    this.saveFGOutRecords(fgOutRecords, shipment);
  }

  // Create FG Out records with proper carton distribution across batches
  private createFGOutRecordsWithCartonDistribution(shipment: ShipmentItem, batchQuantities: {batch: any, quantity: number}[], fgOutRecords: any[]): void {
    // Clear existing records to prevent duplicates
    fgOutRecords.length = 0;
    
    const qtyBox = shipment.qtyBox || 100; // Default QTYBOX = 100
    const totalQuantity = batchQuantities.reduce((sum, item) => sum + item.quantity, 0);
    
    console.log(`📦 Creating FG Out records for total quantity: ${totalQuantity}, QTYBOX: ${qtyBox}`);
    console.log(`📊 Batch quantities:`, batchQuantities.map(b => `${b.batch.batchNumber}: ${b.quantity}`));
    
    // Calculate total carton distribution
    const totalFullCartons = Math.floor(totalQuantity / qtyBox);
    const totalRemainingQuantity = totalQuantity % qtyBox;
    
    console.log(`📊 Total: ${totalQuantity}, Full cartons: ${totalFullCartons}, Remaining: ${totalRemainingQuantity}`);
    
    // Track how much has been allocated for full cartons from each batch
    const usedFromEachBatch: {[key: string]: number} = {};
    
    // Step 1: Create full carton records
    let remainingForFullCartons = totalFullCartons * qtyBox;
    
    for (const batchItem of batchQuantities) {
      if (remainingForFullCartons <= 0) break;
      
      const availableFromThisBatch = batchItem.quantity;
      const quantityFromThisBatch = Math.min(remainingForFullCartons, availableFromThisBatch);
      const fullCartonsFromThisBatch = Math.floor(quantityFromThisBatch / qtyBox);
      
      if (fullCartonsFromThisBatch > 0) {
        fgOutRecords.push(this.createFGOutRecord(
          shipment,
          batchItem.batch.batchNumber,
          batchItem.batch.lsx,
          batchItem.batch.lot,
          fullCartonsFromThisBatch * qtyBox,
          fullCartonsFromThisBatch,
          0,
          `Full cartons: ${fullCartonsFromThisBatch} x ${qtyBox} - Batch ${batchItem.batch.batchNumber}`,
          'FullCartons'
        ));
        
        const usedFromThisBatch = fullCartonsFromThisBatch * qtyBox;
        usedFromEachBatch[batchItem.batch.batchNumber] = usedFromThisBatch;
        remainingForFullCartons -= usedFromThisBatch;
        
        console.log(`✅ Created full carton record: ${usedFromThisBatch} from ${batchItem.batch.batchNumber}`);
        console.log(`📊 usedFromEachBatch:`, usedFromEachBatch);
      }
    }
    
    // Step 2: Create ODD records from remaining quantities in each batch
    for (const batchItem of batchQuantities) {
      const usedFromThisBatch = usedFromEachBatch[batchItem.batch.batchNumber] || 0;
      const remainingInThisBatch = batchItem.quantity - usedFromThisBatch;
      
      console.log(`🔍 Checking batch ${batchItem.batch.batchNumber}: quantity=${batchItem.quantity}, used=${usedFromThisBatch}, remaining=${remainingInThisBatch}`);
      console.log(`📊 Current usedFromEachBatch:`, usedFromEachBatch);
      
      if (remainingInThisBatch > 0) {
        fgOutRecords.push(this.createFGOutRecord(
          shipment,
          batchItem.batch.batchNumber,
          batchItem.batch.lsx,
          batchItem.batch.lot,
          remainingInThisBatch,
          0,
          remainingInThisBatch,
          `ODD: ${remainingInThisBatch} - Gộp thùng - Batch ${batchItem.batch.batchNumber}`,
          'ODD'
        ));
        
        console.log(`✅ Created ODD record: ${remainingInThisBatch} from ${batchItem.batch.batchNumber}`);
      } else {
        console.log(`⏭️ Skipping batch ${batchItem.batch.batchNumber}: no remaining quantity`);
      }
    }
    
    console.log(`✅ Created ${fgOutRecords.length} FG Out records total`);
    console.log(`📋 Records:`, fgOutRecords.map(r => `${r.quantity} (${r.recordType}) from ${r.batchNumber}`));
  }

  // Create single FG Out record
  private createFGOutRecord(shipment: ShipmentItem, batchNumber: string, lsx: string, lot: string, quantity: number, carton: number, odd: number, notes: string, recordType: string): any {
    return {
      // Original shipment info
      originalShipmentId: shipment.id,
      originalShipmentCode: shipment.shipmentCode,
      shipment: shipment.shipmentCode,
      
      // Snapshot data (frozen at push time)
      materialCode: shipment.materialCode,
      customerCode: shipment.customerCode,
      poShip: shipment.poShip,
      quantity: quantity,
      carton: carton,
      qtyBox: shipment.qtyBox || 100,
      odd: odd,
      shipMethod: shipment.shipMethod,
      notes: `${shipment.notes} - ${notes} - PushNo: ${shipment.pushNo}`,
      
      // Push info
      pushNo: shipment.pushNo,
      pushDate: new Date(),
      
      // FG Out specific
      batchNumber: batchNumber,
      lsx: lsx,
      lot: lot,
      exportDate: new Date(),
      
      // Metadata
      transferredFrom: 'Shipment',
      transferredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      
      // Status tracking
      status: 'Pushed',
      isSnapshot: true,
      recordType: recordType
    };
  }


  // Save FG Out records
  private saveFGOutRecords(fgOutRecords: any[], shipment: ShipmentItem): void {
    console.log(`💾 Saving ${fgOutRecords.length} FG Out records for shipment: ${shipment.shipmentCode}`);
    
    // Delete existing records first (only for this specific shipment and material)
    this.firestore.collection('fg-out', ref => 
      ref.where('shipment', '==', shipment.shipmentCode)
         .where('materialCode', '==', shipment.materialCode)
         .where('pushNo', '==', shipment.pushNo)
    ).get().subscribe(snapshot => {
      
      if (!snapshot.empty) {
        console.log(`🗑️ Found ${snapshot.docs.length} existing FG Out records to delete`);
        const deletePromises = snapshot.docs.map(doc => {
          console.log(`🗑️ Deleting record: ${doc.id}`);
          return doc.ref.delete();
        });
        
        Promise.all(deletePromises).then(() => {
          console.log(`✅ Deleted ${snapshot.docs.length} existing FG Out records`);
          this.createFGOutRecords(fgOutRecords, shipment);
        }).catch(error => {
          console.error('❌ Error deleting old FG Out records:', error);
          alert(`❌ Lỗi khi xóa bản ghi cũ: ${error.message}`);
        });
      } else {
        console.log(`ℹ️ No existing FG Out records found, creating new ones`);
        this.createFGOutRecords(fgOutRecords, shipment);
      }
    }, error => {
      console.error('❌ Error querying existing FG Out records:', error);
      // If query fails, still try to create new records
      this.createFGOutRecords(fgOutRecords, shipment);
    });
  }

  // Create FG Out records from array
  private createFGOutRecords(fgOutRecords: any[], shipment: ShipmentItem): void {
    const savePromises = fgOutRecords.map(record => 
      this.firestore.collection('fg-out').add(record)
    );

    Promise.all(savePromises)
      .then(() => {
        console.log('✅ Data transferred to FG Out successfully');
        const recordCount = fgOutRecords.length;
        const totalQuantity = fgOutRecords.reduce((sum, record) => sum + record.quantity, 0);
        const batchInfo = fgOutRecords.map(r => `${r.batchNumber}(${r.quantity})`).join(', ');
        
        // Mark as successfully pushed to prevent duplicate
        shipment.push = true;
        this.updateShipmentInFirebase(shipment);
        
        // Remove from pushing set
        const pushKey = `${shipment.shipmentCode}-${shipment.materialCode}-${shipment.pushNo}`;
        this.isPushing.delete(pushKey);
        
        alert(`✅ Đã cập nhật FG Out!\n📊 Tạo ${recordCount} bản ghi\n🔢 Tổng lượng: ${totalQuantity}\n📦 Batches: ${batchInfo}\n🔄 PushNo: ${shipment.pushNo}`);
      })
      .catch((error) => {
        console.error('❌ Error transferring to FG Out:', error);
        
        // Reset push flag on error to allow retry
        shipment.push = false;
        shipment.pushNo = '000';
        this.updateShipmentInFirebase(shipment);
        
        // Remove from pushing set
        const pushKey = `${shipment.shipmentCode}-${shipment.materialCode}-${shipment.pushNo}`;
        this.isPushing.delete(pushKey);
        
        alert(`❌ Lỗi khi chuyển dữ liệu: ${error.message}`);
      });
  }



  // Format date for input field (YYYY-MM-DD)
  formatDateForInput(date: Date): string {
    if (!date || date.getTime() === 0) return '';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Update date field
  updateDateField(shipment: ShipmentItem, field: string, dateString: string): void {
    if (dateString) {
      (shipment as any)[field] = new Date(dateString);
    } else {
      // Set to null instead of current date when empty
      (shipment as any)[field] = null;
    }
    shipment.updatedAt = new Date();
    this.updateShipmentInFirebase(shipment);
  }

  // Update shipment in Firebase
  // Handle document change - sync to all rows with same shipmentCode
  onDocumentChange(shipment: ShipmentItem): void {
    const shipmentCode = this.normalizeShipmentCode(shipment.shipmentCode);
    const newDocumentValue = shipment.document || 'Đã có PX';
    
    if (!shipmentCode) {
      // If no shipment code, just update this one
      this.updateShipmentInFirebase(shipment);
      return;
    }
    
    // Find all shipments with the same shipmentCode
    const sameShipmentRows = this.shipments.filter(s => 
      this.normalizeShipmentCode(s.shipmentCode) === shipmentCode
    );
    
    // Update document for all rows with same shipmentCode
    sameShipmentRows.forEach(s => {
      s.document = newDocumentValue;
      this.updateShipmentInFirebase(s);
    });
    
    console.log(`✅ Đã đồng bộ "Chứng từ" = "${newDocumentValue}" cho ${sameShipmentRows.length} dòng của shipment ${shipmentCode}`);
  }

  // Handle CS Date change - sync to all rows with same shipmentCode
  onCSDateChange(shipment: ShipmentItem, dateString: string): void {
    const shipmentCode = this.normalizeShipmentCode(shipment.shipmentCode);
    const newDate = dateString ? new Date(dateString) : null;
    
    // Update current shipment first
    shipment.requestDate = newDate;
    shipment.updatedAt = new Date();
    
    if (!shipmentCode) {
      // If no shipment code, just update this one
      this.updateShipmentInFirebase(shipment);
      return;
    }
    
    // Find all shipments with the same shipmentCode
    const sameShipmentRows = this.shipments.filter(s => 
      this.normalizeShipmentCode(s.shipmentCode) === shipmentCode
    );
    
    // Update CS Date for all rows with same shipmentCode
    sameShipmentRows.forEach(s => {
      s.requestDate = newDate;
      s.updatedAt = new Date();
      this.updateShipmentInFirebase(s);
    });
    
    console.log(`✅ Đã đồng bộ "CS Date" cho ${sameShipmentRows.length} dòng của shipment ${shipmentCode}`);
  }

  // Handle Dispatch Date change - sync to all rows with same shipmentCode
  onDispatchDateChange(shipment: ShipmentItem, dateString: string): void {
    const shipmentCode = this.normalizeShipmentCode(shipment.shipmentCode);
    const newDate = dateString ? new Date(dateString) : null;
    
    // Update current shipment first
    shipment.actualShipDate = newDate;
    shipment.updatedAt = new Date();
    
    if (!shipmentCode) {
      // If no shipment code, just update this one
      this.updateShipmentInFirebase(shipment);
      return;
    }
    
    // Find all shipments with the same shipmentCode
    const sameShipmentRows = this.shipments.filter(s => 
      this.normalizeShipmentCode(s.shipmentCode) === shipmentCode
    );
    
    // Update Dispatch Date for all rows with same shipmentCode
    sameShipmentRows.forEach(s => {
      s.actualShipDate = newDate;
      s.updatedAt = new Date();
      this.updateShipmentInFirebase(s);
    });
    
    console.log(`✅ Đã đồng bộ "Dispatch Date" cho ${sameShipmentRows.length} dòng của shipment ${shipmentCode}`);
  }

  // Handle FWD change - sync to all rows with same shipmentCode
  onFWDChange(shipment: ShipmentItem): void {
    const shipmentCode = this.normalizeShipmentCode(shipment.shipmentCode);
    const newFWDValue = shipment.shipMethod || '';
    
    if (!shipmentCode) {
      // If no shipment code, just update this one
      this.updateShipmentInFirebase(shipment);
      return;
    }
    
    // Find all shipments with the same shipmentCode
    const sameShipmentRows = this.shipments.filter(s => 
      this.normalizeShipmentCode(s.shipmentCode) === shipmentCode
    );
    
    // Update FWD for all rows with same shipmentCode
    sameShipmentRows.forEach(s => {
      s.shipMethod = newFWDValue;
      this.updateShipmentInFirebase(s);
    });
    
    console.log(`✅ Đã đồng bộ "FWD" = "${newFWDValue}" cho ${sameShipmentRows.length} dòng của shipment ${shipmentCode}`);
  }

  // Save scroll position before update
  private saveScrollPosition(): void {
    const tableContainer = document.querySelector('.table-responsive');
    if (tableContainer) {
      this.scrollPosition = tableContainer.scrollTop;
    }
  }
  
  // Restore scroll position after update
  private restoreScrollPosition(): void {
    const tableContainer = document.querySelector('.table-responsive');
    if (tableContainer && this.scrollPosition > 0) {
      tableContainer.scrollTop = this.scrollPosition;
    }
  }
  
  updateShipmentInFirebase(shipment: ShipmentItem): void {
    if (shipment.id) {
      // Save scroll position before update
      this.saveScrollPosition();
      this.shouldRestoreScroll = true;
      
      // Tự động điền Dispatch Date khi Status = "Đã Ship"
      if (shipment.status === 'Đã Ship' && !shipment.actualShipDate) {
        shipment.actualShipDate = new Date();
        console.log('✅ Auto-filled Dispatch Date:', shipment.actualShipDate);
      }
      
      const updateData = {
        ...shipment,
        requestDate: shipment.requestDate,
        fullDate: shipment.fullDate,
        actualShipDate: shipment.actualShipDate,
        pushNo: shipment.pushNo || '000', // Ensure PushNo is included
        inventory: shipment.inventory || 0, // Ensure inventory is included
        packing: shipment.packing || 'Pallet', // Ensure packing is included
        qtyPallet: shipment.qtyPallet || 0, // Ensure qtyPallet is included
        updatedAt: new Date()
      };
      
      delete updateData.id;
      
      this.firestore.collection('shipments').doc(shipment.id).update(updateData)
        .then(() => {
          console.log(`Shipment updated successfully with PushNo: ${shipment.pushNo}`);
        })
        .catch(error => {
          console.error('Error updating shipment:', error);
        });
    }
  }

  // Delete shipment
  deleteShipment(shipment: ShipmentItem): void {
    if (shipment.id) {
      this.firestore.collection('shipments').doc(shipment.id).delete()
        .then(() => {
          console.log('Shipment deleted successfully');
        })
        .catch(error => {
          console.error('Error deleting shipment:', error);
        });
    }
    
    // Remove from local array immediately
    const index = this.shipments.indexOf(shipment);
    if (index > -1) {
      this.shipments.splice(index, 1);
      this.applyFilters();
    }
  }

  // Toggle hidden status
  toggleHidden(shipment: ShipmentItem): void {
    shipment.hidden = !shipment.hidden;
    shipment.updatedAt = new Date();
    
    if (shipment.id) {
      this.firestore.collection('shipments').doc(shipment.id).update({
        hidden: shipment.hidden,
        updatedAt: new Date()
      })
      .then(() => {
        console.log(`Shipment ${shipment.shipmentCode} hidden status: ${shipment.hidden}`);
        this.applyFilters(); // Cập nhật danh sách
      })
      .catch(error => {
        console.error('Error updating hidden status:', error);
      });
    }
  }

  // Toggle show/hide hidden shipments
  toggleShowHidden(): void {
    this.showHidden = !this.showHidden;
    console.log(`Show hidden shipments: ${this.showHidden}`);
    this.applyFilters();
  }

  // Get count of hidden shipments
  getHiddenShipmentsCount(): number {
    return this.shipments.filter(s => s.hidden === true).length;
  }

  // Open schedule dialog
  openScheduleDialog(): void {
    this.scheduleMonth = new Date().getMonth();
    this.scheduleYear = new Date().getFullYear();
    this.generateCalendar();
    this.showScheduleDialog = true;
  }

  // Close schedule dialog
  closeScheduleDialog(): void {
    this.showScheduleDialog = false;
  }

  // Generate calendar for current month
  generateCalendar(): void {
    const firstDay = new Date(this.scheduleYear, this.scheduleMonth, 1);
    const lastDay = new Date(this.scheduleYear, this.scheduleMonth + 1, 0);
    const startingDayOfWeek = firstDay.getDay(); // 0 = Sunday
    const daysInMonth = lastDay.getDate();

    this.calendarDays = [];

    // Add empty cells for days before the first day of month
    for (let i = 0; i < startingDayOfWeek; i++) {
      this.calendarDays.push({ date: null, shipments: [] });
    }

    // Add all days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(this.scheduleYear, this.scheduleMonth, day);
      const shipments = this.getShipmentsByDate(date);
      this.calendarDays.push({ 
        date: date, 
        day: day,
        shipments: shipments 
      });
    }
  }

  // Get shipments for a specific date
  getShipmentsByDate(date: Date): ShipmentItem[] {
    return this.shipments.filter(shipment => {
      if (!shipment.actualShipDate) return false;
      const shipDate = new Date(shipment.actualShipDate);
      return shipDate.getDate() === date.getDate() &&
             shipDate.getMonth() === date.getMonth() &&
             shipDate.getFullYear() === date.getFullYear();
    });
  }

  // Navigate to previous month
  previousMonth(): void {
    if (this.scheduleMonth === 0) {
      this.scheduleMonth = 11;
      this.scheduleYear--;
    } else {
      this.scheduleMonth--;
    }
    this.generateCalendar();
  }

  // Navigate to next month
  nextMonth(): void {
    if (this.scheduleMonth === 11) {
      this.scheduleMonth = 0;
      this.scheduleYear++;
    } else {
      this.scheduleMonth++;
    }
    this.generateCalendar();
  }

  // Get month name in Vietnamese
  getMonthName(): string {
    const months = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6',
                    'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
    return months[this.scheduleMonth];
  }

  // Check if date is today
  isToday(date: Date | null): boolean {
    if (!date) return false;
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
  }

  // Export to Excel by month
  exportToExcelByMonth(): void {
    // Hiển thị dialog để chọn tháng
    const monthInput = prompt('Nhập tháng cần tải (format: MM/YYYY hoặc MM-YYYY):', 
      `${String(new Date().getMonth() + 1).padStart(2, '0')}/${new Date().getFullYear()}`);
    
    if (!monthInput) return;
    
    // Parse tháng
    const parts = monthInput.split(/[\/\-]/);
    if (parts.length !== 2) {
      alert('❌ Format tháng không đúng! Vui lòng nhập MM/YYYY hoặc MM-YYYY');
      return;
    }
    
    const month = parseInt(parts[0]);
    const year = parseInt(parts[1]);
    
    if (month < 1 || month > 12 || year < 2020 || year > 2100) {
      alert('❌ Tháng hoặc năm không hợp lệ!');
      return;
    }
    
    // Filter shipments theo tháng (dựa vào CS Date - requestDate)
    const shipmentsInMonth = this.shipments.filter(shipment => {
      if (!shipment.requestDate) return false;
      const date = new Date(shipment.requestDate);
      return date.getMonth() + 1 === month && date.getFullYear() === year;
    });
    
    if (shipmentsInMonth.length === 0) {
      alert(`ℹ️ Không có shipment nào trong tháng ${month}/${year}`);
      return;
    }
    
    try {
      const exportData = shipmentsInMonth.map((shipment, index) => ({
        'No': index + 1,
        'Ngày Import': this.formatDateForExport(shipment.importDate),
        'Biển số xe': shipment.vehicleNumber || '',
        'Nhà máy': shipment.factory || 'ASM1',
        'Shipment': shipment.shipmentCode,
        'Mã TP': shipment.materialCode,
        'Mã Khách': shipment.customerCode,
        'Lượng Xuất': shipment.quantity,
        'PO Ship': shipment.poShip,
        'Carton': shipment.carton,
        'QTYBOX': shipment.qtyBox,
        'Odd': shipment.odd,
        'Tồn kho': shipment.inventory || 0,
        'FWD': shipment.shipMethod,
        'Packing': shipment.packing || 'Pallet',
        'Qty Pallet': shipment.qtyPallet || 0,
        'Push': shipment.push ? 'Yes' : 'No',
        'PushNo': shipment.pushNo,
        'Status': shipment.status,
        'Chứng từ': shipment.document || 'Đã có PX',
        'CS Date': this.formatDateForExport(shipment.requestDate),
        'Full Date': this.formatDateForExport(shipment.fullDate),
        'Dispatch Date': this.formatDateForExport(shipment.actualShipDate),
        'Ngày chuẩn bị': shipment.dayPre,
        'Ghi chú': shipment.notes
      }));

      const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(exportData);
      const wb: XLSX.WorkBook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `Tháng ${month}-${year}`);
      
      XLSX.writeFile(wb, `Shipment_Thang${String(month).padStart(2, '0')}_${year}.xlsx`);
      alert(`✅ Đã tải xuống ${shipmentsInMonth.length} shipments của tháng ${month}/${year}!`);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      alert('❌ Lỗi khi export dữ liệu. Vui lòng thử lại.');
    }
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
      const parsedShipments = this.parseExcelData(data);
      
      // Kiểm tra trùng lặp: bỏ qua shipment có cùng shipmentCode + materialCode
      const toImport: ShipmentItem[] = [];
      const skipped: string[] = [];
      parsedShipments.forEach(imported => {
        const shipCode = String(imported.shipmentCode || '').trim().toUpperCase();
        const matCode = String(imported.materialCode || '').trim().toUpperCase();
        const isDuplicate = this.shipments.some(existing => {
          const exShip = String(existing.shipmentCode || '').trim().toUpperCase();
          const exMat = String(existing.materialCode || '').trim().toUpperCase();
          return exShip === shipCode && exMat === matCode;
        });
        if (isDuplicate) {
          skipped.push(`${shipCode} - ${matCode}`);
        } else {
          toImport.push(imported);
        }
      });
      
      this.shipments = [...this.shipments, ...toImport];
      this.applyFilters();
      
      // Save to Firebase (chỉ shipment không trùng)
      if (toImport.length > 0) {
        this.saveShipmentsToFirebase(toImport);
      }
      
      let message = `✅ Đã import thành công ${toImport.length} shipments từ file Excel!`;
      if (skipped.length > 0) {
        message += `\n\n⚠️ Bỏ qua ${skipped.length} shipment do trùng lặp:\n${skipped.join('\n')}`;
      }
      alert(message);
      
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

  private parseExcelData(data: any[]): ShipmentItem[] {
    return data.map((row: any, index: number) => {
      // Helper function to safely get value - return null/empty if cell is empty
      const getValue = (key: string, altKey?: string): string => {
        const value = row[key] || (altKey ? row[altKey] : null);
        if (value === null || value === undefined || value === '') return '';
        return String(value).trim();
      };

      // Helper function to safely parse number - return 0 only if truly empty
      const getNumber = (key: string, altKey?: string): number => {
        const value = row[key] || (altKey ? row[altKey] : null);
        if (value === null || value === undefined || value === '') return 0;
        const num = parseFloat(String(value));
        return isNaN(num) ? 0 : num;
      };

      // Helper function to safely parse date - return null if empty (GIỮ NGUYÊN TRỐNG)
      const getDate = (key: string, altKey?: string): Date | null => {
        const dateValue = row[key] || (altKey ? row[altKey] : null);
        if (!dateValue || dateValue === '' || dateValue === null || dateValue === undefined) {
          return null; // Giữ nguyên null nếu trống
        }
        // Handle Excel date serial numbers and various formats
        return this.parseDate(dateValue);
      };

      // Helper function to safely get boolean
      const getBoolean = (key: string): boolean => {
        const value = row[key];
        if (value === null || value === undefined || value === '') return false;
        return value === 'true' || value === true || value === 1;
      };

      // CS Date logic: Nếu file có CS Date thì dùng, nếu không thì set = ngày import (ngày hiện tại)
      const csDate = getDate('CS Date', 'Ngày CS Y/c');
      
      return {
        shipmentCode: getValue('Shipment'),
        importDate: getDate('Ngày Import') || new Date(), // Ngày import, default = ngày hiện tại
        vehicleNumber: getValue('Biển số xe'),
        factory: getValue('Nhà máy') || 'ASM1', // Default ASM1
        materialCode: getValue('Mã TP'),
        customerCode: getValue('Mã Khách'),
        quantity: getNumber('Lượng Xuất'),
        poShip: getValue('PO Ship'),
        carton: getNumber('Carton'),
        qtyBox: getNumber('QTYBOX'),
        odd: getNumber('Odd'),
        shipMethod: getValue('FWD'),
        packing: getValue('Packing'), // Giữ nguyên trống nếu không có
        qtyPallet: getNumber('Qty Pallet'),
        push: getBoolean('Push'),
        pushNo: getValue('PushNo'), // Giữ nguyên trống nếu không có
        inventory: getNumber('Tồn kho'),
        status: getValue('Status'), // Giữ nguyên trống nếu không có
        document: getValue('Chứng từ') || 'Đã có PX', // Default Đã có PX
        requestDate: csDate || new Date(), // CS Date = ngày import nếu file không có
        fullDate: getDate('Full Date', 'Ngày full hàng'),
        actualShipDate: getDate('Dispatch Date', 'Thực ship'),
        dayPre: getNumber('Ngày chuẩn bị', 'Day Pre'),
        notes: getValue('Ghi chú'),
        createdAt: new Date(),
        updatedAt: new Date()
      };
    });
  }

  private parseDate(dateStr: any): Date | null {
    if (!dateStr || dateStr === '' || dateStr === null || dateStr === undefined) {
      return null;
    }
    
    // If it's already a Date object
    if (dateStr instanceof Date) {
      return this.isValidDate(dateStr) ? dateStr : null;
    }
    
    // If it's a number (Excel serial number or timestamp)
    if (typeof dateStr === 'number') {
      // Excel serial number (days since 1899-12-30)
      // Excel serial numbers are typically between 1 and ~50000 (for dates 1900-2137)
      // Also handle decimal numbers (Excel date with time)
      if (dateStr >= 1 && dateStr < 100000) {
        // Excel serial number - convert to Date
        // Excel epoch is 1899-12-30 (not 1900-01-01 due to bug)
        const excelEpoch = new Date(1899, 11, 30); // December 30, 1899
        const days = Math.floor(dateStr);
        const milliseconds = (dateStr - days) * 24 * 60 * 60 * 1000; // Handle time portion
        const date = new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000 + milliseconds);
        return this.isValidDate(date) ? date : null;
      }
      // Timestamp in milliseconds (Unix timestamp)
      else if (dateStr > 946684800000 && dateStr < 4102444800000) {
        // Valid timestamp range (2000-01-01 to 2100-01-01)
        const date = new Date(dateStr);
        return this.isValidDate(date) ? date : null;
      }
      // Invalid timestamp - log warning and return null
      else {
        console.warn('⚠️ Invalid date value (out of range):', dateStr);
        return null;
      }
    }
    
    // If it's a string
    const str = String(dateStr).trim();
    if (str === '') return null;
    
    // Try parsing as DD/MM/YYYY or MM/DD/YYYY
    if (str.includes('/')) {
      const parts = str.split('/');
      if (parts.length === 3) {
        const day = parseInt(parts[0]);
        const month = parseInt(parts[1]) - 1;
        const year = parseInt(parts[2]);
        
        if (!isNaN(day) && !isNaN(month) && !isNaN(year) && year >= 1900 && year <= 2100) {
          const date = new Date(year, month, day);
          return this.isValidDate(date) ? date : null;
        }
      }
    }
    
    // Try parsing as ISO date string or other formats
    const date = new Date(str);
    return this.isValidDate(date) ? date : null;
  }

  // Validate if date is valid
  private isValidDate(date: Date): boolean {
    if (!(date instanceof Date)) return false;
    if (isNaN(date.getTime())) return false;
    
    // Check if date is in reasonable range (1900-2100)
    const year = date.getFullYear();
    return year >= 1900 && year <= 2100;
  }

  // Parse date for date range inputs (always return Date, not null)
  parseDateForRange(dateStr: string): Date {
    const parsed = this.parseDate(dateStr);
    return parsed || new Date();
  }

  // Save shipments to Firebase
  saveShipmentsToFirebase(shipments: ShipmentItem[]): void {
    shipments.forEach(shipment => {
      // Validate and sanitize dates before saving
      const validateDate = (date: Date | null): Date | null => {
        if (!date) return null;
        if (!(date instanceof Date)) return null;
        if (isNaN(date.getTime())) return null;
        
        // Check if date is in reasonable range (1900-2100)
        const year = date.getFullYear();
        if (year < 1900 || year > 2100) {
          console.warn('⚠️ Date out of range:', date, 'for shipment:', shipment.shipmentCode);
          return null;
        }
        
        return date;
      };
      
      const shipmentData: any = {
        shipmentCode: shipment.shipmentCode,
        importDate: validateDate(shipment.importDate) || new Date(), // Default to today if invalid
        vehicleNumber: shipment.vehicleNumber || '',
        factory: shipment.factory || 'ASM1',
        materialCode: shipment.materialCode,
        customerCode: shipment.customerCode,
        quantity: shipment.quantity,
        poShip: shipment.poShip,
        carton: shipment.carton,
        qtyBox: shipment.qtyBox,
        odd: shipment.odd,
        shipMethod: shipment.shipMethod,
        packing: shipment.packing || 'Pallet',
        qtyPallet: shipment.qtyPallet || 0,
        push: shipment.push,
        pushNo: shipment.pushNo || '000',
        inventory: shipment.inventory || 0,
        status: shipment.status || 'Chờ soạn',
        document: shipment.document || 'Đã có PX',
        requestDate: validateDate(shipment.requestDate) || new Date(),
        fullDate: validateDate(shipment.fullDate),
        actualShipDate: validateDate(shipment.actualShipDate),
        dayPre: shipment.dayPre || 0,
        notes: shipment.notes || '',
        hidden: shipment.hidden || false,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      this.firestore.collection('shipments').add(shipmentData)
        .then((docRef) => {
          console.log('Shipment saved to Firebase successfully with ID:', docRef.id);
        })
        .catch(error => {
          console.error('Error saving shipment to Firebase:', error);
          console.error('Shipment data:', shipmentData);
          alert(`❌ Lỗi khi lưu shipment ${shipment.shipmentCode}: ${error.message || error}`);
        });
    });
  }

  // Download template - cột trùng thứ tự với bảng Shipment (NO, Ngày Import ... Ghi chú)
  downloadTemplate(): void {
    const templateData = [
      {
        'NO': 1,
        'Ngày Import': '2026-01-26',
        'Biển số xe': '51K-75600',
        'Factory': 'ASM1',
        'Shipment': 'SHIP001',
        'Lượng KTRA': 0,
        'Mã TP': 'P001234',
        'Mã Khách': 'CUST001',
        'Lượng Xuất': 100,
        'PO Ship': 'PO2024001',
        'Carton': 10,
        'QTYBOX': 100,
        'Odd': 5,
        'Tồn kho': 500,
        'FWD': 'Sea',
        'Packing': 'Pallet',
        'Qty Pallet': 5,
        'Status': 'Chờ soạn',
        'Chứng từ': 'Đã có PX',
        'CS Date': '2024-01-15',
        'Full Date': '2024-01-20',
        'Dispatch Date': '2024-01-25',
        'Ngày chuẩn bị': 5,
        'Ghi chú': 'Standard shipment'
      },
      {
        'NO': 2,
        'Ngày Import': '2026-01-26',
        'Biển số xe': '29A-12345',
        'Factory': 'ASM2',
        'Shipment': 'SHIP002',
        'Lượng KTRA': 0,
        'Mã TP': 'P002345',
        'Mã Khách': 'CUST002',
        'Lượng Xuất': 200,
        'PO Ship': 'PO2024002',
        'Carton': 20,
        'QTYBOX': 100,
        'Odd': 8,
        'Tồn kho': 750,
        'FWD': 'Air',
        'Packing': 'Box',
        'Qty Pallet': 3,
        'Status': 'Đang soạn',
        'Chứng từ': 'Full',
        'CS Date': '2024-01-16',
        'Full Date': '2024-01-21',
        'Dispatch Date': '2024-01-26',
        'Ngày chuẩn bị': 3,
        'Ghi chú': 'Urgent shipment'
      }
    ];

    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(templateData);
    
    // Độ rộng cột theo thứ tự bảng: NO → Ghi chú (không có Print, Xóa, Ẩn)
    const colWidths = [
      { wch: 5 },  // NO
      { wch: 12 }, // Ngày Import
      { wch: 12 }, // Biển số xe
      { wch: 8 },  // Factory
      { wch: 12 }, // Shipment
      { wch: 12 }, // Lượng KTRA
      { wch: 12 }, // Mã TP
      { wch: 14 }, // Mã Khách
      { wch: 12 }, // Lượng Xuất
      { wch: 15 }, // PO Ship
      { wch: 8 },  // Carton
      { wch: 8 },  // QTYBOX
      { wch: 6 },  // Odd
      { wch: 10 }, // Tồn kho
      { wch: 8 },  // FWD
      { wch: 10 }, // Packing
      { wch: 10 }, // Qty Pallet
      { wch: 12 }, // Status
      { wch: 12 }, // Chứng từ
      { wch: 12 }, // CS Date
      { wch: 12 }, // Full Date
      { wch: 15 }, // Dispatch Date
      { wch: 12 }, // Ngày chuẩn bị
      { wch: 20 }  // Ghi chú
    ];
    ws['!cols'] = colWidths;
    
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'Shipment_Template.xlsx');
  }

  // Export to Excel
  exportToExcel(): void {
    try {
      const exportData = this.filteredShipments.map(shipment => ({
        'No': this.filteredShipments.indexOf(shipment) + 1,
        'Shipment': shipment.shipmentCode,
        'Mã TP': shipment.materialCode,
        'Mã Khách': shipment.customerCode,
        'Lượng Xuất': shipment.quantity,
        'PO Ship': shipment.poShip,
        'Carton': shipment.carton,
        'QTYBOX': shipment.qtyBox,
        'Odd': shipment.odd,
        'Tồn kho': shipment.inventory || 0,
        'FWD': shipment.shipMethod,
        'Packing': shipment.packing || 'Pallet',
        'Qty Pallet': shipment.qtyPallet || 0,
        'Push': shipment.push ? 'Yes' : 'No',
        'PushNo': shipment.pushNo,
        'Status': shipment.status,
        'CS Date': this.formatDateForExport(shipment.requestDate),
        'Full Date': this.formatDateForExport(shipment.fullDate),
        'Dispatch Date': this.formatDateForExport(shipment.actualShipDate),
        'Ngày chuẩn bị': shipment.dayPre,
        'Ghi chú': shipment.notes
      }));

      const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(exportData);
      const wb: XLSX.WorkBook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Shipment Data');
      
      XLSX.writeFile(wb, `Shipment_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
      alert('Lỗi khi export dữ liệu. Vui lòng thử lại.');
    }
  }

  // Format date for export
  private formatDateForExport(date: Date): string {
    if (!date) return '';
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  // Delete all shipments
  deleteAllShipments(): void {
    if (confirm('Bạn có chắc muốn xóa TẤT CẢ shipments? Hành động này không thể hoàn tác!')) {
      this.firestore.collection('shipments').get().subscribe(snapshot => {
        const batch = this.firestore.firestore.batch();
        snapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        
        batch.commit().then(() => {
          console.log('All shipments deleted');
          this.shipments = [];
          this.filteredShipments = [];
          alert('Đã xóa tất cả shipments');
        }).catch(error => {
          console.error('Error deleting all shipments:', error);
          alert('Lỗi khi xóa dữ liệu. Vui lòng thử lại.');
        });
      });
    }
  }

  // Print Label Methods
  openPrintLabelDialog(shipment: ShipmentItem): void {
    this.selectedShipmentForPrint = shipment;
    this.showPrintLabelDialog = true;
  }

  closePrintLabelDialog(): void {
    this.showPrintLabelDialog = false;
    this.selectedShipmentForPrint = null;
  }

  async printShipmentLabel(): Promise<void> {
    if (!this.selectedShipmentForPrint) {
      alert('❌ Không có shipment được chọn!');
      return;
    }
    
    const shipmentCode = String(this.selectedShipmentForPrint.shipmentCode || '');
    if (!shipmentCode || shipmentCode.trim() === '') {
      alert('❌ Mã Shipment không hợp lệ!');
      return;
    }
    
    console.log('🏷️ Printing Shipment Label:', shipmentCode);
    
    try {
      await this.generateAndPrintBarcode1D(shipmentCode, 'Shipment Label');
      this.closePrintLabelDialog();
    } catch (error) {
      console.error('❌ Error printing shipment label:', error);
      alert('❌ Lỗi: ' + (error?.message || String(error)));
    }
  }

  async printPalletLabels(): Promise<void> {
    if (!this.selectedShipmentForPrint) {
      alert('❌ Không có shipment được chọn!');
      return;
    }
    
    const shipmentCode = String(this.selectedShipmentForPrint.shipmentCode || '').trim();
    if (!shipmentCode) {
      alert('❌ Mã Shipment không hợp lệ!');
      return;
    }
    
    // Cộng dồn tổng số pallet: cùng shipmentCode có thể nhiều dòng (nhiều mã TP), mỗi dòng có qtyPallet riêng
    const normalizedCode = this.normalizeShipmentCode(shipmentCode);
    const sameShipmentRows = this.shipments.filter(s => this.normalizeShipmentCode(s.shipmentCode) === normalizedCode);
    const qtyPallet = sameShipmentRows.reduce((sum, s) => sum + (Number(s.qtyPallet) || 0), 0);
    
    if (qtyPallet <= 0) {
      alert('❌ Tổng Qty Pallet phải lớn hơn 0! (Cộng dồn ' + sameShipmentRows.length + ' dòng cùng shipment)');
      return;
    }
    
    if (qtyPallet > 100) {
      alert('❌ Số lượng pallet quá lớn (>100). Vui lòng kiểm tra lại!');
      return;
    }
    
    console.log('🏷️ Printing Pallet Labels:', shipmentCode, 'Tổng pallet (cộng dồn', sameShipmentRows.length, 'dòng):', qtyPallet);
    
    try {
      const palletCodes: string[] = [];
      for (let i = 1; i <= qtyPallet; i++) {
        const palletCode = `${normalizedCode}${String(i).padStart(2, '0')}`;
        palletCodes.push(palletCode);
      }
      
      console.log('📋 Pallet codes:', palletCodes);
      
      await this.generateAndPrintMultipleBarcodes1D(palletCodes, 'Pallet Labels');
      this.closePrintLabelDialog();
    } catch (error) {
      console.error('❌ Error printing pallet labels:', error);
      alert('❌ Lỗi khi in tem pallet: ' + error.message);
    }
  }

  /** In SHIPMENT ORDER: giấy A4, toàn bộ thông tin shipment + mã QR + ký tên soạn */
  async printShipmentOrder(): Promise<void> {
    if (!this.selectedShipmentForPrint) {
      alert('❌ Không có shipment được chọn!');
      return;
    }
    const s = this.selectedShipmentForPrint;
    const shipmentCode = String(s.shipmentCode || '').trim().toUpperCase();
    
    // Lấy tất cả các dòng có cùng shipmentCode
    const allItemsInShipment = this.shipments.filter(item => {
      const itemCode = String(item.shipmentCode || '').trim().toUpperCase();
      return itemCode === shipmentCode;
    });
    
    const fmtDate = (d: Date | null | undefined): string => {
      if (!d) return '—';
      const x = new Date(d);
      return isNaN(x.getTime()) ? '—' : `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`;
    };
    
    // QR code cho shipment
    const qrData = shipmentCode;
    let qrDataUrl = '';
    try {
      qrDataUrl = await QRCode.toDataURL(qrData, { width: 200, margin: 1 });
    } catch (e) {
      console.error('QR generate error:', e);
    }
    
    // Lấy ngày import và dispatch date (lấy từ item đầu tiên)
    const importDate = fmtDate(s.importDate);
    const dispatchDate = fmtDate(s.actualShipDate);
    
    // Tạo HTML cho từng mã TP (có ô tick Mã hàng, Số lượng khi đã soạn xong)
    const itemBoxes = allItemsInShipment.map(item => `
      <div class="item-box">
        <div class="item-row">
          <div class="item-cell item-cell-tick"><span class="tick-box">☐</span> <strong>Mã TP:</strong> ${this.escapeHtml(String(item.materialCode || ''))}</div>
          <div class="item-cell item-cell-tick"><span class="tick-box">☐</span> <strong>Số lượng:</strong> ${this.escapeHtml(String(item.quantity ?? ''))}</div>
        </div>
        <div class="item-row">
          <div class="item-cell"><strong>Carton:</strong> ${this.escapeHtml(String(item.carton ?? ''))}</div>
          <div class="item-cell"><strong>PO Ship:</strong> ${this.escapeHtml(String(item.poShip || ''))}</div>
        </div>
      </div>
    `).join('');
    
    // Tạo box ghi chú (tổng hợp tất cả ghi chú)
    const allNotes = allItemsInShipment
      .map(item => item.notes)
      .filter(note => note && note.trim())
      .join('\n');
    
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('❌ Không thể mở cửa sổ in. Vui lòng bật popup!');
      return;
    }
    
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>SHIPMENT ORDER - ${this.escapeHtml(shipmentCode)}</title>
  <style>
    @page { size: A4; margin: 15mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 13px; padding: 15mm; color: #000; }
    
    .header { text-align: center; margin-bottom: 20px; border-bottom: 3px solid #000; padding-bottom: 10px; }
    .header h1 { font-size: 24px; font-weight: bold; margin-bottom: 5px; }
    .header .shipment-code { font-size: 18px; color: #2196F3; font-weight: bold; }
    
    .top-section { display: flex; justify-content: space-between; margin-bottom: 20px; }
    .qr-section { flex: 0 0 220px; text-align: center; border: 2px solid #000; padding: 10px; }
    .qr-section img { width: 200px; height: 200px; }
    .qr-label { font-size: 12px; margin-top: 5px; font-weight: bold; }
    
    .dates-section { flex: 1; margin-left: 20px; display: flex; flex-direction: column; gap: 10px; }
    .date-box { border: 2px solid #000; padding: 15px; background: #f9f9f9; }
    .date-box strong { display: block; font-size: 14px; margin-bottom: 5px; color: #2196F3; }
    .date-box .date-value { font-size: 16px; font-weight: bold; }
    .notes-box-top { border: 2px solid #666; padding: 10px; margin-top: 10px; min-height: 50px; background: #fff; white-space: pre-wrap; font-size: 12px; }
    .notes-box-top-label { font-size: 12px; font-weight: bold; margin-bottom: 4px; color: #333; }
    
    .items-section { margin-bottom: 16px; }
    .items-title { font-size: 16px; font-weight: bold; margin-bottom: 10px; padding: 5px; background: #2196F3; color: white; }
    .item-box { border: 2px solid #000; padding: 10px; margin-bottom: 10px; background: #fff; }
    .item-row { display: flex; gap: 10px; margin-bottom: 5px; }
    .item-row:last-child { margin-bottom: 0; }
    .item-cell { flex: 1; padding: 8px; border: 1px solid #ddd; background: #f9f9f9; }
    .item-cell-tick .tick-box { font-size: 16px; margin-right: 6px; }
    
    .ship-by-section { margin-bottom: 16px; border: 2px solid #000; padding: 12px; background: #f5f5f5; }
    .ship-by-section h4 { font-size: 14px; margin-bottom: 10px; }
    .ship-by-options { display: flex; gap: 20px; margin-bottom: 8px; }
    .ship-by-options label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .ship-by-options input { width: 18px; height: 18px; }
    
    .part-divider { margin: 24px 0 16px 0; border-top: 3px solid #000; padding-top: 16px; }
    .part-title { font-size: 18px; font-weight: bold; margin-bottom: 12px; padding: 8px; background: #333; color: #fff; }
    
    .inspection-section { margin-bottom: 16px; border: 2px solid #000; padding: 12px; }
    .inspection-section h4 { font-size: 14px; margin-bottom: 10px; background: #333; color: #fff; padding: 6px; }
    .inspection-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 12px; }
    .inspection-table th, .inspection-table td { border: 1px solid #000; padding: 6px 8px; vertical-align: top; }
    .inspection-table th { background: #f0f0f0; font-weight: bold; text-align: center; }
    .inspection-table .col-no { width: 36px; text-align: center; }
    .inspection-table .col-content { min-width: 280px; }
    .inspection-table .col-pass { width: 70px; text-align: center; }
    .inspection-table .col-fail { width: 80px; text-align: center; }
    .inspection-table .cat-header { background: #e8e8e8; font-weight: bold; }
    .inspection-table .tick-cell { text-align: center; }
    .inspection-7 { margin-bottom: 12px; }
    .inspection-7-title { font-weight: bold; margin-bottom: 6px; font-size: 12px; }
    .inspection-truck { margin-bottom: 8px; }
    .inspection-truck-title { font-weight: bold; margin-bottom: 4px; font-size: 12px; }
    .inspection-truck-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 6px; }
    .inspection-truck-table th, .inspection-truck-table td { border: 1px solid #000; padding: 6px 8px; }
    .inspection-truck-table th { background: #f0f0f0; }
    .inspection-moto { font-size: 12px; color: #666; font-style: italic; margin-top: 8px; }
    
    .notes-section { margin-bottom: 20px; }
    .notes-title { font-size: 14px; font-weight: bold; margin-bottom: 5px; padding: 5px; background: #666; color: white; }
    .notes-box { border: 2px solid #666; padding: 10px; min-height: 60px; background: #fff; white-space: pre-wrap; }
    
    .goods-confirm-section { margin-top: 20px; margin-bottom: 20px; border: 2px solid #000; padding: 15px; background: #fafafa; }
    .goods-confirm-section h4 { font-size: 13px; margin-bottom: 10px; font-weight: bold; }
    .goods-confirm-statement { margin: 12px 0; padding: 10px; border: 1px solid #ccc; background: #fff; font-weight: bold; }
    .goods-confirm-signatures { display: flex; justify-content: space-between; gap: 20px; margin-top: 30px; }
    .goods-confirm-sig-block { flex: 1; text-align: center; }
    .goods-confirm-sig-label { font-size: 12px; font-weight: bold; margin-bottom: 4px; }
    .goods-confirm-sig-line { height: 50px; border-bottom: 2px solid #000; margin-bottom: 4px; }
    .goods-confirm-sig-hint { font-size: 11px; font-style: italic; color: #555; }
    
    .signature-section { margin-top: 30px; border: 2px solid #000; padding: 15px; }
    .signature-title { font-size: 14px; font-weight: bold; margin-bottom: 10px; text-align: center; }
    .signature-box { height: 80px; border-bottom: 2px solid #000; margin-top: 50px; }
    .signature-label { text-align: center; margin-top: 5px; font-size: 12px; font-style: italic; }
  </style>
</head>
<body>
  <div class="header">
    <h1>SHIPMENT ORDER</h1>
    <div class="shipment-code">${this.escapeHtml(shipmentCode)}</div>
  </div>
  
  <!-- PHẦN 1: THÔNG TIN SOẠN HÀNG -->
  <div class="part-title">PHẦN 1: THÔNG TIN SOẠN HÀNG / PART 1: PICKING INFORMATION</div>
  
  <div class="top-section">
    <div class="qr-section">
      ${qrDataUrl ? `<img src="${qrDataUrl}" alt="QR">` : '<p>—</p>'}
      <div class="qr-label">QR: ${this.escapeHtml(shipmentCode)}</div>
    </div>
    <div class="dates-section">
      <div class="date-box">
        <strong>NGÀY IMPORT:</strong>
        <div class="date-value">${importDate}</div>
      </div>
      <div class="date-box">
        <strong>NGÀY SHIP:</strong>
        <div class="date-value">${dispatchDate}</div>
      </div>
      <div class="notes-box-top-label">GHI CHÚ (dưới box Ngày Ship):</div>
      <div class="notes-box-top">${allNotes ? this.escapeHtml(allNotes) : ''}</div>
    </div>
  </div>
  
  <div class="items-section">
    <div class="items-title">CHI TIẾT SẢN PHẨM (${allItemsInShipment.length} mã TP) – Tick ☐ khi đã soạn xong</div>
    ${itemBoxes}
  </div>
  
  ${allNotes ? `
  <div class="notes-section">
    <div class="notes-title">GHI CHÚ (toàn bộ)</div>
    <div class="notes-box">${this.escapeHtml(allNotes)}</div>
  </div>
  ` : ''}
  
  <div class="signature-section">
    <div class="signature-title">KÝ TÊN NGƯỜI SOẠN / PREPARER SIGNATURE</div>
    <div class="signature-box"></div>
    <div class="signature-label">(Ký và ghi rõ họ tên) / (Sign and write full name)</div>
  </div>
  
  <!-- PHẦN 2: CÁC MỤC KIỂM TRA -->
  <div class="part-divider"></div>
  <div class="part-title">PHẦN 2: CÁC MỤC KIỂM TRA / PART 2: INSPECTION ITEMS</div>
  
  <div class="ship-by-section">
    <h4>Ship bằng (chọn một) / Ship by (choose one):</h4>
    <div class="ship-by-options">
      <label><input type="radio" name="shipBy" value="cont"> Cont (Container)</label>
      <label><input type="radio" name="shipBy" value="truck"> Xe tải / Truck</label>
      <label><input type="radio" name="shipBy" value="moto"> Xe máy / Motorbike</label>
    </div>
  </div>
  
  <div class="inspection-section">
    <h4>NỘI DUNG KIỂM TRA 7 ĐIỂM (Nếu Cont) / 7-POINT INSPECTION (If Container)</h4>
    <table class="inspection-table">
      <thead>
        <tr>
          <th class="col-no">STT</th>
          <th class="col-content">NỘI DUNG KIỂM TRA / Inspection Item</th>
          <th class="col-pass">ĐẠT / Passed</th>
          <th class="col-fail">KHÔNG ĐẠT / Failed</th>
        </tr>
      </thead>
      <tbody>
        <tr><td colspan="4" class="cat-header">1. Kiểm tra bên ngoài/ gầm/ khung dầm xe / Exterior/Undercarriage Inspection</td></tr>
        <tr>
          <td class="col-no">1</td>
          <td class="col-content">Kiểm tra xem xe có các vết rách, lỗ thủng, biến dạng hay không? / Check for tears, punctures, or deformations?</td>
          <td class="tick-cell">☐</td><td class="tick-cell">☐</td>
        </tr>
        <tr><td colspan="4" class="cat-header">2. Kiểm tra bên trong/ ngoài cửa xe / Interior/Exterior Door Inspection</td></tr>
        <tr>
          <td class="col-no">2.1</td>
          <td class="col-content">Kiểm tra bên trong/ ngoài xe có các lỗ thủng/ vết nứt hay không? / Check for holes or cracks?</td>
          <td class="tick-cell">☐</td><td class="tick-cell">☐</td>
        </tr>
        <tr>
          <td class="col-no">2.2</td>
          <td class="col-content">Kiểm tra các đinh tán, ri-vê tại các vị trí có gắn lỗ khóa niêm phong xem có bị hư hỏng, mức độ chắc chắn hay nhô lên không? / Check the rivets and screws at the sealing keyhole locations for damage, firmness or protruding.</td>
          <td class="tick-cell">☐</td><td class="tick-cell">☐</td>
        </tr>
        <tr>
          <td class="col-no">2.3</td>
          <td class="col-content">Kiểm tra hoạt động khi đóng mở cánh cửa và then cài có an toàn và kín không? / Check the operation when opening and closing the door—is it safe and tight?</td>
          <td class="tick-cell">☐</td><td class="tick-cell">☐</td>
        </tr>
        <tr><td colspan="4" class="cat-header">3. Kiểm tra mép hông, vách phải xe / The right side edge and wall Inspection</td></tr>
        <tr>
          <td class="col-no">3</td>
          <td class="col-content">Kiểm tra phần mép hông và phần vách bên phải, phần tiếp xúc với nền xem có bị gỉ sét, lâu ngày có thể hình thành lỗ hổng không? / Check the right side edge and wall, areas in contact with the floor for signs of rust. Can it cause holes to form over time?</td>
          <td class="tick-cell">☐</td><td class="tick-cell">☐</td>
        </tr>
        <tr><td colspan="4" class="cat-header">4. Kiểm tra mép hông, vách trái xe / The left side edge and wall Inspection</td></tr>
        <tr>
          <td class="col-no">4</td>
          <td class="col-content">Kiểm tra phần mép hông và phần vách bên trái, phần tiếp xúc với nền xem có bị gỉ sét, lâu ngày có thể hình thành lỗ hổng không? / Check the left side edge and wall, areas in contact with the floor for signs of rust. Can it cause holes to form over time?</td>
          <td class="tick-cell">☐</td><td class="tick-cell">☐</td>
        </tr>
        <tr><td colspan="4" class="cat-header">5. Kiểm tra vách trước / Front Wall Inspection</td></tr>
        <tr>
          <td class="col-no">5</td>
          <td class="col-content">Kiểm tra phần vách trước, phần tiếp xúc với nền xem có bị gỉ sét, lâu ngày có thể hình thành lỗ hổng không? / Check front wall, areas in contact with the floor for signs of rust. Can it cause holes to form over time?</td>
          <td class="tick-cell">☐</td><td class="tick-cell">☐</td>
        </tr>
        <tr><td colspan="4" class="cat-header">6. Kiểm tra trần/ nóc/ sàn ngoài / Roof/top/outer floor Inspection</td></tr>
        <tr>
          <td class="col-no">6.1</td>
          <td class="col-content">Kiểm tra trần, nóc, sàn có bị thủng hoặc vết nứt không? / Check roof/top/outer floor for holes or cracks.</td>
          <td class="tick-cell">☐</td><td class="tick-cell">☐</td>
        </tr>
        <tr>
          <td class="col-no">6.2</td>
          <td class="col-content">Kiểm tra các nhãn, mác hàng hóa của lần vận chuyển trước đó còn hay không? / Check for previous shipping labels.</td>
          <td class="tick-cell">☐</td><td class="tick-cell">☐</td>
        </tr>
        <tr>
          <td class="col-no">6.3</td>
          <td class="col-content">Các vách ngang cần được dựng lên và khóa cứng không? (check nếu xe có) / Are the crossbars erected and securely locked? (if applicable)</td>
          <td class="tick-cell">☐</td><td class="tick-cell">☐</td>
        </tr>
        <tr>
          <td class="col-no">6.4</td>
          <td class="col-content">Các thanh giằng cho mái cần phải được lắp vào đúng vị trí quy định. Các tấm bạt che không bị hư hại và có kích cỡ đúng để che phủ toàn bộ diện tích trần xe không? (check nếu xe có) / Are the roof braces installed correctly? Are the tarpaulins undamaged and of the correct size to cover the entire roof? (if applicable)</td>
          <td class="tick-cell">☐</td><td class="tick-cell">☐</td>
        </tr>
        <tr>
          <td class="col-no">6.5</td>
          <td class="col-content">Các dây thừng ở trong trạng thái tốt không? (check nếu xe có) / Are the ropes in good condition? (if applicable)</td>
          <td class="tick-cell">☐</td><td class="tick-cell">☐</td>
        </tr>
        <tr><td colspan="4" class="cat-header">7. Kiểm tra sàn trong / Interior Floor Inspection</td></tr>
        <tr>
          <td class="col-no">7.1</td>
          <td class="col-content">Sàn trong có được vệ sinh sạch sẽ, khô ráo, không bị mùi hôi, dơ bẩn, han, gỉ do ẩm ướt, bụi bẩn không? / Is the interior floor clean, dry, odorless, free from moisture-related rust, dirt, stains, or corrosion?</td>
          <td class="tick-cell">☐</td><td class="tick-cell">☐</td>
        </tr>
        <tr>
          <td class="col-no">7.2</td>
          <td class="col-content">Sàn xe có gập gềnh không bằng phẳng không? / Is the floor level, not uneven?</td>
          <td class="tick-cell">☐</td><td class="tick-cell">☐</td>
        </tr>
        <tr>
          <td class="col-no">7.3</td>
          <td class="col-content">Trong xe có vật sắc nhọn có thể làm hỏng hàng hóa trong quá trình vận chuyển không? / Are there sharp objects inside that could damage cargo during transport?</td>
          <td class="tick-cell">☐</td><td class="tick-cell">☐</td>
        </tr>
      </tbody>
    </table>
    
    <div class="inspection-truck">
      <div class="inspection-truck-title">Nếu Xe tải → Kiểm tra / If Truck → Inspect:</div>
      <table class="inspection-truck-table">
        <thead><tr><th>STT</th><th>NỘI DUNG KIỂM TRA / Inspection Item</th><th>ĐẠT / Passed</th><th>KHÔNG ĐẠT / Failed</th></tr></thead>
        <tbody>
          <tr><td>1</td><td>Thùng xe / Cargo body</td><td class="tick-cell">☐</td><td class="tick-cell">☐</td></tr>
          <tr><td>2</td><td>Sàn xe / Floor</td><td class="tick-cell">☐</td><td class="tick-cell">☐</td></tr>
          <tr><td>3</td><td>Nước / Water (rò rỉ, ẩm) / (leaks, moisture)</td><td class="tick-cell">☐</td><td class="tick-cell">☐</td></tr>
        </tbody>
      </table>
    </div>
    <div class="inspection-moto">Nếu Xe máy → Không kiểm tra về xe. / If Motorbike → No vehicle inspection required.</div>
  </div>
  
  <div class="goods-confirm-section">
    <h4>II. XÁC NHẬN TÌNH TRẠNG HÀNG HÓA (ĐƯỢC XÁC NHẬN SAU KHI ĐÃ HOÀN TẤT VIỆC NÂNG PALET LÊN XE) / GOODS CONDITION CONFIRMATION (TO BE CONFIRMED AFTER PALLET LIFTING IS COMPLETE)</h4>
    <div class="goods-confirm-statement">
      XÁC NHẬN: Hàng và pallet được nhận trong tình trạng không bị móp, rách, gãy, bể.<br>
      CONFIRMATION: Goods and pallets are received in a condition that is not dented, torn, broken.
    </div>
    <div class="goods-confirm-signatures">
      <div class="goods-confirm-sig-block">
        <div class="goods-confirm-sig-label">Người giao hàng / Deliverer</div>
        <div class="goods-confirm-sig-line"></div>
        <div class="goods-confirm-sig-hint">(Ký và ghi rõ họ tên) / (Sign and write full name)</div>
      </div>
      <div class="goods-confirm-sig-block">
        <div class="goods-confirm-sig-label">Tài xế vận chuyển / Transport driver</div>
        <div class="goods-confirm-sig-line"></div>
        <div class="goods-confirm-sig-hint">(Ký và ghi rõ họ tên) / (Sign and write full name)</div>
      </div>
    </div>
  </div>
</body>
</html>`;
    
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.focus();
        printWindow.print();
      }, 300);
    };
    setTimeout(() => {
      if (printWindow && !printWindow.closed) {
        printWindow.focus();
        printWindow.print();
      }
    }, 800);
    this.closePrintLabelDialog();
  }

  // Generate and print single 1D barcode label (Code128)
  private async generateAndPrintBarcode1D(code: string, title: string): Promise<void> {
    try {
      console.log('🔧 Generating 1D barcode for:', code);
      
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('❌ Không thể mở cửa sổ in. Vui lòng bật popup cho trang này!');
        return;
      }
      
      const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
  <style>
    @page { size: 57mm 32mm; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { margin: 0; padding: 4mm; font-family: Arial, sans-serif; background: white; }
    .label-container {
      width: 57mm; min-height: 32mm;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      border: 1px solid #000; background: white;
    }
    .barcode-wrap { margin: 2mm 0; }
    svg { max-width: 100%; height: auto; }
    .code-text { font-size: 10px; font-weight: bold; color: #000; margin-top: 2mm; }
  </style>
</head>
<body>
  <div class="label-container">
    <div class="barcode-wrap"><svg id="barcode"><\/svg></div>
    <div class="code-text">${this.escapeHtml(code)}</div>
  </div>
  <script>
    (function() {
      var code = ${JSON.stringify(code)};
      try {
        JsBarcode("#barcode", code, {
          format: "CODE128",
          width: 2,
          height: 50,
          displayValue: false,
          margin: 2
        });
      } catch (e) { console.error(e); }
    })();
  <\/script>
</body>
</html>`;

      printWindow.document.write(htmlContent);
      printWindow.document.close();
      
      printWindow.onload = () => {
        setTimeout(() => {
          printWindow.focus();
          printWindow.print();
        }, 400);
      };
      setTimeout(() => {
        if (printWindow && !printWindow.closed) {
          printWindow.focus();
          printWindow.print();
        }
      }, 1200);
      
    } catch (error) {
      console.error('❌ Error:', error);
      alert('❌ Lỗi: ' + (error?.message || String(error)));
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Generate and print multiple 1D barcode labels (Code128)
  private async generateAndPrintMultipleBarcodes1D(codes: string[], title: string): Promise<void> {
    try {
      console.log('🔧 Generating multiple 1D barcodes for:', codes.length, 'labels');
      
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('❌ Không thể mở cửa sổ in. Vui lòng bật popup cho trang này!');
        return;
      }
      
      let labelsHtml = '';
      codes.forEach((code, index) => {
        const pageBreak = index < codes.length - 1 ? 'page-break-after: always;' : '';
        const safeCode = code.replace(/\\/g, '\\\\').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        labelsHtml += `
  <div class="label-container" style="${pageBreak}">
    <div class="barcode-wrap"><svg id="barcode-${index}"></svg></div>
    <div class="code-text">${safeCode}</div>
  </div>`;
      });
      
      const codesJson = JSON.stringify(codes);
      const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
  <style>
    @page { size: 57mm 32mm; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { margin: 0; padding: 4mm; font-family: Arial, sans-serif; background: white; }
    .label-container {
      width: 57mm; min-height: 32mm;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      border: 1px solid #000; background: white;
    }
    .barcode-wrap { margin: 2mm 0; }
    svg { max-width: 100%; height: auto; }
    .code-text { font-size: 10px; font-weight: bold; color: #000; margin-top: 2mm; }
  </style>
</head>
<body>${labelsHtml}
  <script>
    (function() {
      var codes = ${codesJson};
      codes.forEach(function(code, i) {
        try {
          JsBarcode("#barcode-" + i, code, {
            format: "CODE128",
            width: 2,
            height: 50,
            displayValue: false,
            margin: 2
          });
        } catch (e) { console.error(e); }
      });
    })();
  <\/script>
</body>
</html>`;

      printWindow.document.write(htmlContent);
      printWindow.document.close();
      
      printWindow.onload = () => {
        setTimeout(() => {
          printWindow.focus();
          printWindow.print();
        }, 500);
      };
      setTimeout(() => {
        if (printWindow && !printWindow.closed) {
          printWindow.focus();
          printWindow.print();
        }
      }, 1500);
      
    } catch (error) {
      console.error('❌ Error:', error);
      alert('❌ Lỗi: ' + (error?.message || String(error)));
    }
  }
} 