import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject, combineLatest } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import * as QRCode from 'qrcode';

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
  
  // FG Check status cache - track which shipments have been checked
  fgCheckStatusCache: Map<string, boolean> = new Map(); // key: shipmentCode+materialCode, value: isCheckedCorrectly
  
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

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth
  ) {}

  ngOnInit(): void {
    this.loadShipmentsFromFirebase();
    this.loadFGInventoryCache();
    this.loadFGCheckStatus(); // Load FG Check status
    // Fix date format issues - use proper date initialization
    this.startDate = new Date('2020-01-01');
    this.endDate = new Date('2030-12-31');
    this.applyFilters();
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
            vehicleNumber: data.vehicleNumber || '',
            factory: data.factory || 'ASM1',
            document: data.document || 'Đã có PX',
            requestDate: data.requestDate ? new Date(data.requestDate.seconds * 1000) : null,
            fullDate: data.fullDate ? new Date(data.fullDate.seconds * 1000) : null,
            actualShipDate: data.actualShipDate ? new Date(data.actualShipDate.seconds * 1000) : null
          };
        });
        
        this.shipments = firebaseShipments;
        this.applyFilters();
        console.log('Loaded shipments from Firebase:', this.shipments.length);
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

  // Get total shipments count
  getTotalShipments(): number {
    return this.filteredShipments.length;
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
    
    // Sắp xếp: 1) CS Date (requestDate), 2) Ngày Import (importDate), 3) Số lô (shipmentCode), 4) Mã TP (materialCode)
    this.filteredShipments.sort((a, b) => {
      // Bước 1: So sánh CS Date (requestDate) - ngày sớm nhất lên đầu
      const csDateA = a.requestDate ? new Date(a.requestDate).getTime() : Number.MAX_SAFE_INTEGER;
      const csDateB = b.requestDate ? new Date(b.requestDate).getTime() : Number.MAX_SAFE_INTEGER;
      
      // Null dates xuống cuối, ngày sớm nhất lên đầu
      if (csDateA !== csDateB) {
        return csDateA - csDateB;
      }
      
      // Bước 2: Nếu CS Date giống nhau, so sánh Ngày Import (importDate)
      const importDateA = a.importDate ? new Date(a.importDate).getTime() : Number.MAX_SAFE_INTEGER;
      const importDateB = b.importDate ? new Date(b.importDate).getTime() : Number.MAX_SAFE_INTEGER;
      
      if (importDateA !== importDateB) {
        return importDateA - importDateB;
      }
      
      // Bước 3: Nếu Ngày Import giống nhau, so sánh Số lô (shipmentCode) - sắp theo A, B, C
      const shipmentA = String(a.shipmentCode || '').toUpperCase();
      const shipmentB = String(b.shipmentCode || '').toUpperCase();
      const shipmentCompare = shipmentA.localeCompare(shipmentB);
      
      if (shipmentCompare !== 0) {
        return shipmentCompare;
      }
      
      // Bước 4: Nếu Số lô giống nhau, so sánh Mã TP (materialCode) - sắp theo A, B, C
      const materialA = String(a.materialCode || '').toUpperCase();
      const materialB = String(b.materialCode || '').toUpperCase();
      return materialA.localeCompare(materialB);
    });
  }

  // Format number with commas for thousands
  formatNumber(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '0';
    }
    
    return value.toLocaleString('vi-VN');
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
      console.log('✅ Auto-filled Dispatch Date for new shipment with status "Đã Ship"');
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
        console.log('Shipment added successfully with ID:', docRef.id);
        this.resetNewShipment();
        this.showAddShipmentDialog = false;
        alert('✅ Đã thêm shipment thành công!');
      })
      .catch(error => {
        console.error('Error adding shipment:', error);
        alert('❌ Lỗi khi thêm shipment: ' + error.message);
      });
  }

  // Load FG Check status - realtime
  loadFGCheckStatus(): void {
    this.firestore.collection('fg-check')
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((actions) => {
        this.fgCheckStatusCache.clear();
        
        actions.forEach(action => {
          const data = action.payload.doc.data() as any;
          const shipmentCode = String(data.shipment || '').trim().toUpperCase();
          const materialCode = String(data.materialCode || '').trim();
          const checkResult = data.checkResult || '';
          
          if (shipmentCode && materialCode) {
            const key = `${shipmentCode}|${materialCode}`;
            // Chỉ đánh dấu là checked nếu kết quả check là "Đúng"
            if (checkResult === 'Đúng') {
              this.fgCheckStatusCache.set(key, true);
              console.log(`✅ Cached check status: ${key} = Đúng`);
            }
          }
        });
        
        console.log('✅ Loaded FG Check status cache:', this.fgCheckStatusCache.size, 'checked items');
        console.log('📋 Cache entries:', Array.from(this.fgCheckStatusCache.keys()));
      });
  }

  // Check if shipment has been checked correctly
  isShipmentChecked(shipment: ShipmentItem): boolean {
    const shipmentCode = String(shipment.shipmentCode || '').trim().toUpperCase();
    const materialCode = String(shipment.materialCode || '').trim();
    const key = `${shipmentCode}|${materialCode}`;
    const isChecked = this.fgCheckStatusCache.get(key) === true;
    
    // Chỉ log khi checked (để không spam console)
    // Nếu cần debug hết, dùng nút "Debug Check Status"
    
    return isChecked;
  }

  // Debug method to show all cached check statuses
  debugCheckStatus(): void {
    console.log('🐛 === DEBUG CHECK STATUS ===');
    console.log('📊 Cache size:', this.fgCheckStatusCache.size);
    console.log('📋 All cached items:');
    Array.from(this.fgCheckStatusCache.entries()).forEach(([key, value]) => {
      console.log(`  ${key} = ${value ? 'Đúng' : 'Sai'}`);
    });
    
    let debugMessage = '🐛 DEBUG CHECK STATUS\n\n';
    debugMessage += `📊 Tổng số items đã check đúng: ${this.fgCheckStatusCache.size}\n\n`;
    
    if (this.fgCheckStatusCache.size === 0) {
      debugMessage += '❌ KHÔNG CÓ DỮ LIỆU CHECK!\n\n';
      debugMessage += 'Vui lòng kiểm tra:\n';
      debugMessage += '1. Tab FG Check có dữ liệu không?\n';
      debugMessage += '2. Đã check xong chưa?\n';
      debugMessage += '3. Thử nhấn "Force Save Check Results" trong FG Check';
    } else {
      debugMessage += '📋 Danh sách shipments đã check đúng:\n\n';
      Array.from(this.fgCheckStatusCache.entries()).forEach(([key, value]) => {
        const [shipCode, matCode] = key.split('|');
        debugMessage += `✅ ${shipCode} - ${matCode}\n`;
      });
    }
    
    alert(debugMessage);
  }

  // Load FG Inventory cache for better performance
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
          
          // Debug log for specific material
          if (materialCode.includes('P002123') || materialCode.includes('K003')) {
            console.log(`🔍 FG Inventory Debug for ${materialCode}:`, {
              tonDau: data.tonDau,
              nhap: data.nhap,
              xuat: data.xuat,
              calculated: calculatedTon
            });
          }
        });
        
        console.log('FG Inventory cache updated:', this.fgInventoryCache.size, 'materials');
        console.log('Cache contents:', Array.from(this.fgInventoryCache.entries()));
      });
  }

  // Get inventory for material code from FG Inventory cache
  getInventory(materialCode: string): number {
    // Lấy tổng tồn kho từ cache FG Inventory
    const inventory = this.fgInventoryCache.get(materialCode) || 0;
    
    // Debug log for specific material
    if (materialCode.includes('P002123') || materialCode.includes('K003')) {
      console.log(`🔍 Shipment getInventory for ${materialCode}:`, {
        inventory: inventory,
        cacheSize: this.fgInventoryCache.size,
        cacheKeys: Array.from(this.fgInventoryCache.keys())
      });
    }
    
    return inventory;
  }

  // Force refresh FG Inventory cache
  refreshFGInventoryCache(): void {
    console.log('🔄 Refreshing FG Inventory cache...');
    this.loadFGInventoryCache();
    alert('✅ Đã refresh tồn kho từ FG Inventory!\n\nDữ liệu sẽ được cập nhật trong vài giây.');
  }

  // Debug method to compare inventory data
  debugInventoryData(): void {
    console.log('🔍 === DEBUG INVENTORY DATA ===');
    console.log('Shipment cache:', Array.from(this.fgInventoryCache.entries()));
    
    // Get fresh data from FG Inventory
    this.firestore.collection('fg-inventory').get().subscribe(snapshot => {
      console.log('Fresh FG Inventory data:');
      let totalFromFGInventory = 0;
      let totalFromShipmentCache = 0;
      
      snapshot.docs.forEach(doc => {
        const data = doc.data() as any;
        const materialCode = data.materialCode || '';
        
        if (materialCode.includes('P002123') || materialCode.includes('K003')) {
          const ton = data.ton || 0;
          const tonDau = data.tonDau || 0;
          const nhap = data.nhap || 0;
          const xuat = data.xuat || 0;
          const calculated = tonDau + nhap - xuat;
          
          console.log(`📦 ${materialCode}:`, {
            ton: ton,
            tonDau: tonDau,
            nhap: nhap,
            xuat: xuat,
            calculated: calculated,
            batch: data.batchNumber,
            lsx: data.lsx,
            lot: data.lot,
            factory: data.factory
          });
          
          totalFromFGInventory += ton;
        }
      });
      
      totalFromShipmentCache = this.fgInventoryCache.get('P002123_K003') || 0;
      
      console.log('📊 SUMMARY:');
      console.log(`FG Inventory total: ${totalFromFGInventory}`);
      console.log(`Shipment cache total: ${totalFromShipmentCache}`);
      console.log(`Difference: ${totalFromFGInventory - totalFromShipmentCache}`);
    });
  }

  // Handle quantity input change with formatting
  onQuantityChange(event: any, shipment: ShipmentItem): void {
    const inputValue = event.target.value;
    // Remove commas and parse as number
    const numericValue = parseFloat(inputValue.replace(/,/g, '')) || 0;
    shipment.quantity = numericValue;
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
      console.log('✅ Auto-filled Dispatch Date when status changed to "Đã Ship"');
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
  updateShipmentInFirebase(shipment: ShipmentItem): void {
    if (shipment.id) {
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
      const shipments = this.parseExcelData(data);
      
      this.shipments = [...this.shipments, ...shipments];
      this.applyFilters();
      
      // Save to Firebase
      this.saveShipmentsToFirebase(shipments);
      
      alert(`✅ Đã import thành công ${shipments.length} shipments từ file Excel!`);
      
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

  // Download template
  downloadTemplate(): void {
    const templateData = [
      {
        'Ngày Import': '26/01/2026',
        'Biển số xe': '51K-75600',
        'Nhà máy': 'ASM1',
        'Shipment': 'SHIP001',
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
        'Push': true,
        'PushNo': '001',
        'Status': 'Chờ soạn',
        'Chứng từ': 'Đã có PX',
        'CS Date': '15/01/2024',
        'Full Date': '20/01/2024',
        'Dispatch Date': '25/01/2024',
        'Ngày chuẩn bị': 5,
        'Ghi chú': 'Standard shipment'
      },
      {
        'Ngày Import': '26/01/2026',
        'Biển số xe': '29A-12345',
        'Nhà máy': 'ASM2',
        'Shipment': 'SHIP002',
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
        'Push': false,
        'PushNo': '000',
        'Status': 'Đang soạn',
        'Chứng từ': 'Full',
        'CS Date': '16/01/2024',
        'Full Date': '21/01/2024',
        'Dispatch Date': '26/01/2024',
        'Ngày chuẩn bị': 3,
        'Ghi chú': 'Urgent shipment'
      }
    ];

    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(templateData);
    
    // Set column widths - updated with new columns
    const colWidths = [
      { wch: 12 }, // Ngày Import
      { wch: 12 }, // Biển số xe
      { wch: 10 }, // Nhà máy
      { wch: 12 }, // Shipment
      { wch: 12 }, // Mã TP
      { wch: 12 }, // Mã Khách
      { wch: 12 }, // Lượng Xuất
      { wch: 15 }, // PO Ship
      { wch: 10 }, // Carton
      { wch: 10 }, // QTYBOX
      { wch: 8 },  // Odd
      { wch: 10 }, // Tồn kho
      { wch: 8 },  // FWD
      { wch: 10 }, // Packing
      { wch: 10 }, // Qty Pallet
      { wch: 8 },  // Push
      { wch: 8 },  // PushNo
      { wch: 12 }, // Status
      { wch: 12 }, // Chứng từ
      { wch: 12 }, // CS Date
      { wch: 12 }, // Full Date
      { wch: 15 }, // Dispatch Date
      { wch: 15 }, // Ngày chuẩn bị
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
      await this.generateAndPrintQRCode(shipmentCode, 'Shipment Label');
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
    
    const shipmentCode = String(this.selectedShipmentForPrint.shipmentCode || '');
    if (!shipmentCode || shipmentCode.trim() === '') {
      alert('❌ Mã Shipment không hợp lệ!');
      return;
    }
    
    const qtyPallet = Number(this.selectedShipmentForPrint.qtyPallet) || 0;
    
    if (qtyPallet <= 0) {
      alert('❌ Qty Pallet phải lớn hơn 0!');
      return;
    }
    
    if (qtyPallet > 100) {
      alert('❌ Số lượng pallet quá lớn (>100). Vui lòng kiểm tra lại!');
      return;
    }
    
    console.log('🏷️ Printing Pallet Labels:', shipmentCode, 'Qty:', qtyPallet);
    
    try {
      // Generate QR codes for each pallet
      const palletCodes: string[] = [];
      for (let i = 1; i <= qtyPallet; i++) {
        const palletCode = `${shipmentCode}${String(i).padStart(2, '0')}`;
        palletCodes.push(palletCode);
      }
      
      console.log('📋 Pallet codes:', palletCodes);
      
      await this.generateAndPrintMultipleQRCodes(palletCodes, 'Pallet Labels');
      this.closePrintLabelDialog();
    } catch (error) {
      console.error('❌ Error printing pallet labels:', error);
      alert('❌ Lỗi khi in tem pallet: ' + error.message);
    }
  }

  // Generate and print single QR code
  private async generateAndPrintQRCode(code: string, title: string): Promise<void> {
    try {
      console.log('🔧 Generating QR code for:', code);
      
      // Generate QR code using qrcode library (same as materials)
      const qrCodeDataURL = await QRCode.toDataURL(code, {
        width: 240,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      
      console.log('✅ QR code generated, length:', qrCodeDataURL.length);
      
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('❌ Không thể mở cửa sổ in. Vui lòng bật popup cho trang này!');
        return;
      }
      
      console.log('✅ Print window opened');
      
      const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <style>
    @page { size: 57mm 32mm; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      margin: 0; 
      padding: 0; 
      font-family: Arial, sans-serif;
      background: white;
      width: 57mm;
      height: 32mm;
    }
    .label-container {
      width: 57mm;
      height: 32mm;
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: center;
      border: 1px solid #000;
      gap: 3mm;
      background: white;
    }
    .qr-code {
      width: 28mm;
      height: 28mm;
    }
    .code-text {
      font-size: 14px;
      font-weight: bold;
      color: #000;
    }
  </style>
</head>
<body>
  <div class="label-container">
    <img class="qr-code" src="${qrCodeDataURL}">
    <div class="code-text">${code}</div>
  </div>
</body>
</html>`;

      console.log('📝 Writing HTML to print window...');
      printWindow.document.write(htmlContent);
      
      printWindow.document.close();
      console.log('✅ Document closed');
      
      // Wait for content to load, then print
      printWindow.onload = () => {
        console.log('📄 Content loaded');
        setTimeout(() => {
          console.log('🖨️ Starting print...');
          printWindow.focus();
          printWindow.print();
        }, 300);
      };
      
      // Fallback if onload doesn't fire
      setTimeout(() => {
        if (printWindow && !printWindow.closed) {
          console.log('🖨️ Fallback print...');
          printWindow.focus();
          printWindow.print();
        }
      }, 1000);
      
    } catch (error) {
      console.error('❌ Error:', error);
      alert('❌ Lỗi: ' + (error?.message || String(error)));
    }
  }

  // Generate and print multiple QR codes
  private async generateAndPrintMultipleQRCodes(codes: string[], title: string): Promise<void> {
    try {
      console.log('🔧 Generating multiple QR codes for:', codes.length, 'labels');
      
      // Generate all QR codes first
      const qrCodeDataURLs = await Promise.all(
        codes.map(code => 
          QRCode.toDataURL(code, {
            width: 240, // 30mm = 240px (8px/mm) - same as materials inbound
            margin: 1,
            color: {
              dark: '#000000',
              light: '#FFFFFF'
            }
          })
        )
      );
      
      console.log('✅ All QR codes generated successfully:', qrCodeDataURLs.length);
      
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('❌ Không thể mở cửa sổ in. Vui lòng bật popup cho trang này!');
        return;
      }
      
      console.log('✅ Print window opened for multiple labels');
      
      let labelsHtml = '';
      codes.forEach((code, index) => {
        const qrCodeDataURL = qrCodeDataURLs[index];
        const pageBreak = index < codes.length - 1 ? 'page-break-after: always;' : '';
        labelsHtml += `
  <div class="label-container" style="${pageBreak}">
    <img class="qr-code" src="${qrCodeDataURL}">
    <div class="code-text">${code}</div>
  </div>`;
      });
      
      const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <style>
    @page { size: 57mm 32mm; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      margin: 0; 
      padding: 0; 
      font-family: Arial, sans-serif;
      background: white;
    }
    .label-container {
      width: 57mm;
      height: 32mm;
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: center;
      border: 1px solid #000;
      gap: 3mm;
      background: white;
    }
    .qr-code {
      width: 28mm;
      height: 28mm;
    }
    .code-text {
      font-size: 14px;
      font-weight: bold;
      color: #000;
    }
  </style>
</head>
<body>${labelsHtml}
</body>
</html>`;

      console.log('📝 Writing HTML for multiple labels...');
      printWindow.document.write(htmlContent);
      
      printWindow.document.close();
      console.log('✅ Document closed for multiple labels');
      
      // Wait for content to load, then print
      printWindow.onload = () => {
        console.log('📄 Multiple labels content loaded');
        setTimeout(() => {
          console.log('🖨️ Starting print for multiple labels...');
          printWindow.focus();
          printWindow.print();
        }, 300);
      };
      
      // Fallback if onload doesn't fire
      setTimeout(() => {
        if (printWindow && !printWindow.closed) {
          console.log('🖨️ Fallback print for multiple labels...');
          printWindow.focus();
          printWindow.print();
        }
      }, 1000);
      
    } catch (error) {
      console.error('❌ Error:', error);
      alert('❌ Lỗi: ' + (error?.message || String(error)));
    }
  }
} 