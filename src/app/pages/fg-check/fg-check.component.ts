import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import * as XLSX from 'xlsx';

export interface FGCheckItem {
  id?: string;
  shipment: string;
  materialCode: string;
  customerCode: string;
  carton: number;
  quantity: number;
  isChecked: boolean;
  checkId: string;
  scanId?: string; // ID scan khi bắt đầu check (ASP+4 số), dùng hiển thị trong cột ID Check
  checkMode?: 'pn' | 'pn-qty'; // Lưu mode check của item
  shipmentCarton?: number; // Số thùng Shipment từ tab shipment
  shipmentQuantity?: number; // Lượng Shipment từ tab shipment
  poShip?: string; // PO Ship để phân biệt các dòng cùng materialCode
  checkResult?: 'Đúng' | 'Sai'; // Kết quả check
  scannedCustomerCode?: boolean; // Đã scan mã hàng (highlight xanh)
  scannedQuantity?: boolean; // Đã scan số lượng (highlight xanh)
  isLocked?: boolean; // Lock dữ liệu
  palletNo?: string; // Số Pallet
  docIds?: string[]; // Nhiều doc Firebase gộp lại (cùng shipment + materialCode + palletNo)
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ShipmentData {
  shipmentCode: string;
  materialCode: string;
  quantity: number; // Lượng Xuất
  carton: number;
  qtyBox?: number; // Số lượng trong 1 thùng - dùng để tính số thùng = quantity / qtyBox
  poShip?: string; // PO Ship để phân biệt các dòng cùng materialCode
}

export interface ShipmentDisplayItem {
  materialCode: string;
  quantity: number; // Lượng Xuất từ shipment
  carton: number;
  customerCode?: string; // Mã khách hàng (nếu có mapping)
}

@Component({
  selector: 'app-fg-check',
  templateUrl: './fg-check.component.html',
  styleUrls: ['./fg-check.component.scss']
})
export class FGCheckComponent implements OnInit, OnDestroy {
  items: FGCheckItem[] = [];
  filteredItems: FGCheckItem[] = [];
  
  // Search
  searchTerm: string = '';
  
  // Scanner properties
  showCheckDialog: boolean = false;
  checkDialogStep: 'mode' | 'form' = 'mode'; // Trong dialog: chọn mode trước, sau đó nhập ID/Shipment/Pallet
  checkStep: number = 0; // 0 = select mode, 1 = shipment input, 2 = scan pallet, 3 = scan material+qty
  checkMode: 'pn' | 'pn-qty' = 'pn';
  /** ID khi quét: lấy 7 ký tự đầu, định dạng ASP + 4 số (VD: ASP1234) */
  scannedCheckId: string = '';
  scannedShipment: string = '';
  currentPalletNo: string = ''; // Pallet đang scan
  currentScanInput: string = ''; // Mã hàng đang scan
  currentQtyInput: string = ''; // Số lượng đang scan
  waitingForQty: boolean = false;
  isScanning: boolean = false;
  
  // Danh sách các mã hàng đã scan (tạm thời, để hiển thị)
  scannedItems: Array<{materialCode: string, quantity: number, customerCode?: string}> = [];
  
  // Filter by shipment - để lọc theo shipment đang check
  filterByShipment: string = ''; // Shipment đang được filter
  
  // Customer code mapping
  customerMappings: Map<string, string> = new Map(); // customerCode -> materialCode
  
  // Shipment data for checking
  shipmentDataMap: Map<string, ShipmentData[]> = new Map(); // shipmentCode -> ShipmentData[]
  private itemsLoaded: boolean = false;
  private shipmentDataLoaded: boolean = false;
  
  // Shipment display items - hiển thị danh sách mã TP của shipment hiện tại
  currentShipmentItems: ShipmentDisplayItem[] = [];
  
  // Đổi số shipment
  showChangeShipmentDialog: boolean = false;
  oldShipmentCode: string = '';
  newShipmentCode: string = '';

  // Lock = ẩn dữ liệu; UNHIDE = nhập Shipment để hiển thị lại
  unhiddenShipments: Set<string> = new Set();
  showUnhideDialog: boolean = false;
  unhideShipmentInput: string = '';

  // Popup More
  showMorePopup: boolean = false;
  // Tải báo cáo Check theo tháng
  showReportMonthDialog: boolean = false;
  reportMonth: number = new Date().getMonth() + 1;
  reportYear: number = new Date().getFullYear();

  // Popup xóa: quét mã quản lý (chỉ scan)
  private readonly MANAGER_CODES = ['ASP0106', 'ASP0538', 'ASP0119', 'ASP1761'];
  showDeleteConfirmPopup: boolean = false;
  deleteConfirmItem: FGCheckItem | null = null;
  deleteManagerScanInput: string = '';
  private deleteScanFirstCharTime: number = 0;
  
  private destroy$ = new Subject<void>();
  isLoading: boolean = false;
  checkIdCounter: number = 1;

  constructor(
    private firestore: AngularFirestore,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadItemsFromFirebase();
    this.loadCustomerMappings();
    this.loadLastCheckId();
    this.loadShipmentData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Mở dialog đổi số shipment
  openChangeShipmentDialog(): void {
    this.oldShipmentCode = '';
    this.newShipmentCode = '';
    this.showChangeShipmentDialog = true;
  }

  // Đóng dialog đổi số shipment
  closeChangeShipmentDialog(): void {
    this.showChangeShipmentDialog = false;
    this.oldShipmentCode = '';
    this.newShipmentCode = '';
  }

  // Đổi số shipment cho tất cả items
  changeShipmentCode(): void {
    const oldShipment = String(this.oldShipmentCode || '').trim().toUpperCase();
    const newShipment = String(this.newShipmentCode || '').trim().toUpperCase();

    if (!oldShipment || !newShipment) {
      alert('❌ Vui lòng nhập đầy đủ số shipment cũ và mới!');
      return;
    }

    if (oldShipment === newShipment) {
      alert('❌ Số shipment mới phải khác số shipment cũ!');
      return;
    }

    // Tìm tất cả items có shipment = oldShipment
    const itemsToUpdate = this.items.filter(item => {
      const itemShipment = String(item.shipment || '').trim().toUpperCase();
      return itemShipment === oldShipment;
    });

    if (itemsToUpdate.length === 0) {
      alert(`⚠️ Không tìm thấy items nào có shipment "${oldShipment}"!`);
      return;
    }

    // Xác nhận trước khi đổi
    const confirmMessage = `Bạn có chắc chắn muốn đổi shipment "${oldShipment}" thành "${newShipment}"?\n\n` +
                          `Số lượng items sẽ được đổi: ${itemsToUpdate.length}`;
    
    if (!confirm(confirmMessage)) {
      return;
    }

    // Đổi shipment cho tất cả items
    let successCount = 0;
    let errorCount = 0;
    const updatePromises: Promise<void>[] = [];

    itemsToUpdate.forEach(item => {
      if (item.id) {
        const updatePromise = this.firestore.collection('fg-check').doc(item.id).update({
          shipment: newShipment,
          updatedAt: new Date()
        })
        .then(() => {
          // Cập nhật local item
          item.shipment = newShipment;
          successCount++;
          console.log(`✅ Updated item ${item.checkId}: ${oldShipment} -> ${newShipment}`);
        })
        .catch(error => {
          errorCount++;
          console.error(`❌ Error updating item ${item.checkId}:`, error);
        });
        
        updatePromises.push(updatePromise);
      }
    });

    // Chờ tất cả updates hoàn thành
    Promise.all(updatePromises).then(() => {
      // Cập nhật filter nếu đang filter theo shipment cũ
      if (this.filterByShipment && this.filterByShipment.toUpperCase() === oldShipment) {
        this.filterByShipment = newShipment;
      }

      // Recalculate check results và apply filters
      this.calculateCheckResults();
      this.applyFilters();

      // Đóng dialog
      this.closeChangeShipmentDialog();

      // Hiển thị kết quả
      alert(`✅ Đổi shipment hoàn tất!\n\n` +
            `- Đã đổi: ${successCount} items\n` +
            `- Lỗi: ${errorCount} items\n\n` +
            `Shipment "${oldShipment}" -> "${newShipment}"`);
    });
  }

  // Load items from Firebase
  loadItemsFromFirebase(): void {
    this.isLoading = true;
    
    this.firestore.collection('fg-check')
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe((querySnapshot) => {
        const firebaseItems = querySnapshot.docs.map(doc => {
          const data = doc.data() as any;
          const id = doc.id;
          
          const item = {
            id: id,
            shipment: data.shipment || '',
            materialCode: data.materialCode || '',
            customerCode: data.customerCode || '',
            carton: data.carton || 0,
            quantity: data.quantity || 0,
            isChecked: data.isChecked || false,
            checkId: data.checkId || '',
            scanId: data.scanId || undefined,
            checkMode: data.checkMode || 'pn', // Load checkMode từ Firebase
            scannedCustomerCode: data.scannedCustomerCode || false,
            scannedQuantity: data.scannedQuantity || false,
            isLocked: data.isLocked || false, // Load lock status
            palletNo: data.palletNo || '', // Load pallet number
            shipmentCarton: data.shipmentCarton || 0,
            shipmentQuantity: data.shipmentQuantity || 0,
            poShip: data.poShip || '',
            checkResult: data.checkResult || undefined,
            createdAt: data.createdAt ? new Date(data.createdAt.seconds * 1000) : new Date(),
            updatedAt: data.updatedAt ? new Date(data.updatedAt.seconds * 1000) : new Date()
          };
          
          // Auto-fill materialCode from mapping if empty but customerCode exists
          if (!item.materialCode && item.customerCode && this.customerMappings.size > 0) {
            const materialCode = this.getMaterialCodeFromCustomerCode(item.customerCode);
            if (materialCode) {
              item.materialCode = materialCode;
              // Update in Firebase asynchronously
              this.firestore.collection('fg-check').doc(id).update({
                materialCode: materialCode,
                updatedAt: new Date()
              }).catch(error => {
                console.error(`❌ Error auto-updating materialCode for item ${id}:`, error);
              });
            }
          }
          
          return item;
        });
        
        // Gộp dòng: cùng shipment + materialCode + palletNo thì cộng dồn quantity và carton thành một dòng
        this.items = this.mergeItemsByShipmentMaterialPallet(firebaseItems);
        this.itemsLoaded = true;
        this.isLoading = false;
        
        // Calculate check results if shipment data is already loaded
        if (this.shipmentDataLoaded) {
          this.calculateCheckResults();
        }
        this.applyFilters();
      });
  }

  /** Gộp các dòng cùng shipment + materialCode + palletNo: cộng dồn quantity và carton thành một dòng. */
  private mergeItemsByShipmentMaterialPallet(rawItems: FGCheckItem[]): FGCheckItem[] {
    const key = (item: FGCheckItem) => {
      const s = String(item.shipment || '').trim().toUpperCase();
      const m = String(item.materialCode || '').trim().toUpperCase();
      const p = String(item.palletNo || '').trim().toUpperCase();
      return `${s}|${m}|${p}`;
    };
    const map = new Map<string, FGCheckItem[]>();
    rawItems.forEach(item => {
      const k = key(item);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(item);
    });
    const merged: FGCheckItem[] = [];
    map.forEach((group) => {
      const first = group[0];
      const quantity = group.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0);
      const carton = group.reduce((sum, i) => sum + (Number(i.carton) || 0), 0);
      const docIds = group.map(i => i.id).filter((id): id is string => !!id);
      merged.push({
        ...first,
        id: first.id,
        quantity,
        carton,
        docIds: docIds.length > 1 ? docIds : undefined
      });
    });
    return merged;
  }

  // Load customer code mappings
  loadCustomerMappings(): void {
    this.firestore.collection('fg-customer-mapping')
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe((querySnapshot) => {
        this.customerMappings.clear();
        querySnapshot.docs.forEach(doc => {
          const data = doc.data() as any;
          if (data.customerCode && data.materialCode) {
            // Normalize customerCode: uppercase and trim
            const normalizedCustomerCode = String(data.customerCode).trim().toUpperCase();
            const materialCode = String(data.materialCode).trim();
            this.customerMappings.set(normalizedCustomerCode, materialCode);
            console.log(`📋 Mapping loaded: ${normalizedCustomerCode} -> ${materialCode}`);
          }
        });
        console.log('✅ Loaded customer mappings:', this.customerMappings.size);
      });
  }

  // Load shipment data from Firestore - REALTIME với snapshotChanges()
  // Lưu ý: Chỉ dựa vào shipmentCode và materialCode để lưu và so sánh
  loadShipmentData(): void {
    this.firestore.collection('shipments')
      .snapshotChanges() // Thay đổi từ get() sang snapshotChanges() để realtime
      .pipe(takeUntil(this.destroy$))
      .subscribe((actions) => {
        this.shipmentDataMap.clear();
        
        actions.forEach(action => {
          const data = action.payload.doc.data() as any;
          // Normalize shipmentCode và materialCode: trim và uppercase cho shipmentCode
          // LƯU CẢ PO SHIP ĐỂ PHÂN BIỆT CÁC DÒNG CÙNG MATERIALCODE
          const shipmentCode = String(data.shipmentCode || '').trim().toUpperCase();
          const materialCode = String(data.materialCode || '').trim(); // Mã TP - không uppercase để giữ nguyên format
          const quantity = parseFloat(data.quantity) || 0; // Lượng Xuất
          const carton = parseFloat(data.carton) || 0;
          const qtyBox = parseFloat(data.qtyBox) || 0; // Số lượng trong 1 thùng (tab Shipment)
          const poShip = String(data.poShip || '').trim(); // PO Ship để phân biệt
          
          // CHỈ LƯU KHI CÓ ĐỦ shipmentCode VÀ materialCode
          if (shipmentCode && materialCode) {
            if (!this.shipmentDataMap.has(shipmentCode)) {
              this.shipmentDataMap.set(shipmentCode, []);
            }
            
            // Lưu theo shipmentCode, mỗi shipmentCode có thể có nhiều materialCode
            // VÀ mỗi materialCode có thể có nhiều PO Ship (nhiều dòng)
            this.shipmentDataMap.get(shipmentCode)!.push({
              shipmentCode: shipmentCode,
              materialCode: materialCode, // Mã TP
              quantity: quantity,
              carton: carton,
              qtyBox: qtyBox, // Để tính số thùng = quantity / qtyBox
              poShip: poShip // PO Ship để phân biệt
            });
          }
        });
        
        console.log('✅ Loaded shipment data (REALTIME) for', this.shipmentDataMap.size, 'shipments');
        
        // Log all shipment codes and their data
        this.shipmentDataMap.forEach((dataList, shipmentCode) => {
          console.log(`📦 Shipment ${shipmentCode} has ${dataList.length} items:`, 
            dataList.map(d => `materialCode=${d.materialCode}, quantity=${d.quantity}`));
        });
        
        this.shipmentDataLoaded = true;
        
        // Recalculate check results after loading shipment data (only if items are already loaded)
        if (this.itemsLoaded) {
          console.log('🔄 Recalculating check results after shipment data update...');
          this.calculateCheckResults();
        }
      });
  }

  // Force reload shipment data and recalculate
  forceReloadShipmentData(): void {
    console.log('🔄 Force reloading shipment data...');
    this.shipmentDataLoaded = false;
    this.loadShipmentData();
  }

  // Force save shipmentQuantity/shipmentCarton to Firebase for all items (không so sánh đúng/sai)
  forceSaveCheckResults(): void {
    console.log('💾 Force saving shipmentQuantity/shipmentCarton for all items...');
    let savedCount = 0;
    let errorCount = 0;
    
    const savePromises = this.items.map(item => {
      if (item.id) {
        return this.firestore.collection('fg-check').doc(item.id).update({
          shipmentQuantity: item.shipmentQuantity || 0,
          shipmentCarton: item.shipmentCarton || 0,
          updatedAt: new Date()
        }).then(() => {
          savedCount++;
          console.log(`✅ Saved for ${item.checkId}`);
        }).catch(error => {
          errorCount++;
          console.error(`❌ Error saving ${item.checkId}:`, error);
        });
      }
      return Promise.resolve();
    });
    
    Promise.all(savePromises).then(() => {
      alert(`✅ Force Save hoàn tất!\n\n- Đã lưu: ${savedCount} items\n- Lỗi: ${errorCount} items`);
      console.log(`✅ Force save complete: ${savedCount} saved, ${errorCount} errors`);
    });
  }

  // Debug shipment data - hiển thị thông tin chi tiết
  debugShipmentData(): void {
    console.log('🐛 === DEBUG SHIPMENT DATA ===');
    console.log('📊 shipmentDataMap size:', this.shipmentDataMap.size);
    console.log('📊 All shipment codes:', Array.from(this.shipmentDataMap.keys()));
    
    let debugMessage = '🐛 DEBUG SHIPMENT DATA\n\n';
    debugMessage += `📊 Tổng số shipments: ${this.shipmentDataMap.size}\n\n`;
    
    if (this.shipmentDataMap.size === 0) {
      debugMessage += '❌ KHÔNG CÓ DỮ LIỆU SHIPMENT!\n\n';
      debugMessage += 'Vui lòng kiểm tra:\n';
      debugMessage += '1. Tab Shipment có dữ liệu không?\n';
      debugMessage += '2. Collection "shipments" trong Firebase có dữ liệu không?\n';
      debugMessage += '3. Thử nhấn "Reload Shipment Data & Tính lại"';
    } else {
      debugMessage += '📋 Danh sách shipments:\n\n';
      this.shipmentDataMap.forEach((dataList, shipmentCode) => {
        debugMessage += `📦 Shipment: ${shipmentCode} (${dataList.length} items)\n`;
        dataList.forEach(data => {
          debugMessage += `   - Mã TP: ${data.materialCode}, Số lượng: ${data.quantity}, Carton: ${data.carton}\n`;
        });
        debugMessage += '\n';
      });
    }
    
    alert(debugMessage);
    console.log('🐛 Debug complete');
  }

  // Tính shipmentQuantity/shipmentCarton trong bộ nhớ (không ghi Firebase để tránh chậm)
  calculateCheckResults(): void {
    if (!this.itemsLoaded || !this.shipmentDataLoaded) return;

    this.items.forEach(item => {
      const shipmentCode = String(item.shipment || '').trim().toUpperCase();
      const materialCode = String(item.materialCode || '').trim();
      if (!shipmentCode || !materialCode) {
        item.shipmentQuantity = 0;
        return;
      }

      const shipmentDataList = this.shipmentDataMap.get(shipmentCode) || [];
      const matchingShipment = shipmentDataList.find(s => String(s.materialCode || '').trim() === materialCode);
      if (!matchingShipment) {
        item.shipmentQuantity = 0;
        return;
      }

      item.shipmentCarton = matchingShipment.carton;
      item.shipmentQuantity = matchingShipment.quantity;
    });

    this.applyFilters();
  }

  // Load last check ID
  loadLastCheckId(): void {
    this.firestore.collection('fg-check', ref => ref.orderBy('checkId', 'desc').limit(1))
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe((querySnapshot) => {
        if (!querySnapshot.empty) {
          const lastItem = querySnapshot.docs[0].data() as any;
          const lastCheckId = lastItem.checkId || '';
          // Extract number from checkId (e.g., "CHK001" -> 1)
          const match = lastCheckId.match(/\d+/);
          if (match) {
            this.checkIdCounter = parseInt(match[0]) + 1;
          }
        }
      });
  }

  // Get next check ID
  getNextCheckId(): string {
    const checkId = `CHK${String(this.checkIdCounter).padStart(3, '0')}`;
    this.checkIdCounter++;
    return checkId;
  }

  /** Số thùng hiển thị: Check Thùng (pn) = số thùng đã scan (item.carton); Check Số Lượng (pn-qty) = quantity/qtyBox hoặc item.carton. */
  getDisplayCarton(item: FGCheckItem): number {
    const checkMode = item.checkMode || this.checkMode;
    // Check Thùng: mỗi lần scan = 1 thùng → ghi nhận trực tiếp vào cột Số Thùng
    if (checkMode === 'pn') {
      return Number(item.carton) || 0;
    }
    // Check Số Lượng: có thể tính từ quantity/qtyBox
    const shipmentCode = String(item.shipment || '').trim().toUpperCase();
    const materialCode = String(item.materialCode || '').trim();
    const list = this.shipmentDataMap.get(shipmentCode) || [];
    const match = list.find(s => String(s.materialCode || '').trim() === materialCode);
    const qtyBox = match?.qtyBox ? Number(match.qtyBox) : 0;
    const quantity = Number(item.quantity) || 0;
    if (qtyBox > 0) {
      return Math.floor(quantity / qtyBox);
    }
    return Number(item.carton) || 0;
  }

  /** Định dạng thời gian check để hiển thị (dd/MM/yyyy HH:mm:ss). */
  formatCheckTime(date: Date | undefined): string {
    if (!date) return '—';
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '—';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${day}/${month}/${year} ${h}:${m}:${s}`;
  }

  /** Click vào ID Check: hiển thị thời gian check. */
  showCheckTime(item: FGCheckItem): void {
    const timeStr = this.formatCheckTime(item.createdAt);
    alert(`Thời gian check: ${timeStr}`);
  }

  // Kiểm tra xem item đã đủ số lượng/carton chưa
  isItemEnough(item: FGCheckItem): boolean {
    if (!item.shipmentCarton && !item.shipmentQuantity) {
      return false; // Chưa có dữ liệu shipment
    }
    
    const checkMode = item.checkMode || this.checkMode;
    
    if (checkMode === 'pn-qty') {
      // Check số lượng: so sánh quantity với shipmentQuantity
      return (item.quantity || 0) >= (item.shipmentQuantity || 0);
    } else {
      // Check số thùng: so sánh carton với shipmentCarton
      return (item.carton || 0) >= (item.shipmentCarton || 0);
    }
  }

  /** Check Thùng: tổng số thùng đã scan >= số thùng shipment → hiển thị OK */
  isCartonOk(item: FGCheckItem): boolean {
    const checkMode = item.checkMode || this.checkMode;
    if (checkMode !== 'pn') return false;
    const expected = Number(item.shipmentCarton) || 0;
    if (expected <= 0) return false;
    return (Number(item.carton) || 0) >= expected;
  }

  // Get material code from customer code
  getMaterialCodeFromCustomerCode(customerCode: string): string {
    // Normalize customerCode: uppercase and trim for lookup
    const normalizedCustomerCode = String(customerCode).trim().toUpperCase();
    const materialCode = this.customerMappings.get(normalizedCustomerCode) || '';
    
    if (!materialCode) {
      console.warn(`⚠️ No mapping found for customerCode: "${customerCode}" (normalized: "${normalizedCustomerCode}")`);
      console.log('📋 Available mappings:', Array.from(this.customerMappings.keys()));
    } else {
      console.log(`✅ Found mapping: ${normalizedCustomerCode} -> ${materialCode}`);
    }
    
    return materialCode;
  }

  // Reload mapping and update material codes for existing items
  reloadMappingAndUpdate(): void {
    console.log('🔄 Reloading mapping and updating material codes...');
    
    // Reload mapping first
    this.loadCustomerMappings();
    
    // Wait a bit for mapping to load, then update items
    setTimeout(() => {
      let updatedCount = 0;
      let skippedCount = 0;
      const updatePromises: Promise<void>[] = [];
      
      this.items.forEach(item => {
        if (item.customerCode && item.id) {
          const normalizedCustomerCode = String(item.customerCode).trim().toUpperCase();
          const newMaterialCode = this.getMaterialCodeFromCustomerCode(normalizedCustomerCode);
          
          // Update if material code is empty or different
          if (newMaterialCode) {
            if (newMaterialCode !== item.materialCode) {
              console.log(`🔄 Updating item ${item.checkId}: customerCode="${normalizedCustomerCode}", materialCode: "${item.materialCode || '(empty)'}" -> "${newMaterialCode}"`);
              updatedCount++;
              
              // Update in Firebase
              const updatePromise = this.firestore.collection('fg-check').doc(item.id).update({
                materialCode: newMaterialCode,
                customerCode: normalizedCustomerCode, // Also normalize customerCode
                updatedAt: new Date()
              })
              .then(() => {
                // Update local item
                item.materialCode = newMaterialCode;
                item.customerCode = normalizedCustomerCode;
                console.log(`✅ Updated item ${item.checkId}`);
              })
              .catch(error => {
                console.error(`❌ Error updating item ${item.checkId}:`, error);
              });
              
              updatePromises.push(updatePromise);
            } else {
              skippedCount++;
            }
          } else {
            console.warn(`⚠️ No mapping found for item ${item.checkId}, customerCode: "${normalizedCustomerCode}"`);
          }
        } else {
          if (!item.customerCode) {
            console.warn(`⚠️ Item ${item.checkId} has no customerCode`);
          }
        }
      });
      
      // Wait for all updates to complete
      Promise.all(updatePromises).then(() => {
        if (updatedCount > 0) {
          this.calculateCheckResults();
          this.applyFilters();
          alert(`✅ Đã cập nhật ${updatedCount} items với Mã TP mới!\n\n${skippedCount > 0 ? `(${skippedCount} items đã có Mã TP đúng)` : ''}`);
        } else {
          alert(`ℹ️ Không có items nào cần cập nhật.\n\n${skippedCount > 0 ? `(${skippedCount} items đã có Mã TP)` : 'Vui lòng kiểm tra lại mapping!'}`);
        }
      });
    }, 1000); // Wait 1000ms for mapping to load
  }

  // Apply search filters: dòng đã lock luôn ẩn (muốn thấy thì dùng UNHIDE shipment)
  applyFilters(): void {
    this.filteredItems = this.items.filter(item => {
      const itemShipment = String(item.shipment || '').trim().toUpperCase();
      // Ẩn dòng đã Lock; chỉ hiện nếu Shipment đã được UNHIDE
      if (item.isLocked) {
        if (!this.unhiddenShipments.has(itemShipment)) return false;
      }
      // Filter by shipment nếu đang check một shipment cụ thể
      if (this.filterByShipment && this.filterByShipment.trim() !== '') {
        const filterShipment = this.filterByShipment.trim().toUpperCase();
        if (itemShipment !== filterShipment) {
          return false;
        }
      }
      // Filter by search term
      if (!this.searchTerm || this.searchTerm.trim() === '') {
        return true;
      }
      const searchableText = [
        item.shipment,
        item.materialCode,
        item.customerCode,
        item.checkId
      ].filter(Boolean).join(' ').toUpperCase();
      return searchableText.includes(this.searchTerm.toUpperCase());
    });
    
    // Sắp xếp: 1) Shipment (theo ABC), 2) Mã TP (theo ABC)
    this.filteredItems.sort((a, b) => {
      // Bước 1: So sánh Shipment (theo ABC)
      const shipmentA = String(a.shipment || '').trim().toUpperCase();
      const shipmentB = String(b.shipment || '').trim().toUpperCase();
      const shipmentCompare = shipmentA.localeCompare(shipmentB);
      
      if (shipmentCompare !== 0) {
        return shipmentCompare;
      }
      
      // Bước 2: Nếu Shipment giống nhau, so sánh Mã TP (theo ABC)
      const materialA = String(a.materialCode || '').trim().toUpperCase();
      const materialB = String(b.materialCode || '').trim().toUpperCase();
      return materialA.localeCompare(materialB);
    });
  }

  /** Số dòng đã scan của pallet hiện tại (shipment + pallet đang check). Chưa scan gì = 0. */
  getCurrentPalletScannedCount(): number {
    const shipment = String(this.scannedShipment || '').trim().toUpperCase();
    const pallet = String(this.currentPalletNo || '').trim().toUpperCase();
    if (!shipment || !pallet) return 0;
    return this.items.filter(item => {
      const itemShipment = String(item.shipment || '').trim().toUpperCase();
      const itemPallet = String(item.palletNo || '').trim().toUpperCase();
      return itemShipment === shipment && itemPallet === pallet;
    }).length;
  }

  /** Tổng số lượng (quantity) đã scan của pallet hiện tại – dùng để hiển thị "Đã scan: 160". */
  getCurrentPalletScannedQuantity(): number {
    const shipment = String(this.scannedShipment || '').trim().toUpperCase();
    const pallet = String(this.currentPalletNo || '').trim().toUpperCase();
    if (!shipment || !pallet) return 0;
    return this.items
      .filter(item => {
        const itemShipment = String(item.shipment || '').trim().toUpperCase();
        const itemPallet = String(item.palletNo || '').trim().toUpperCase();
        return itemShipment === shipment && itemPallet === pallet;
      })
      .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  }

  /** Tổng số thùng (carton) đã scan của pallet hiện tại – dùng khi Check Thùng. */
  getCurrentPalletScannedCarton(): number {
    const shipment = String(this.scannedShipment || '').trim().toUpperCase();
    const pallet = String(this.currentPalletNo || '').trim().toUpperCase();
    if (!shipment || !pallet) return 0;
    return this.items
      .filter(item => {
        const itemShipment = String(item.shipment || '').trim().toUpperCase();
        const itemPallet = String(item.palletNo || '').trim().toUpperCase();
        return itemShipment === shipment && itemPallet === pallet;
      })
      .reduce((sum, item) => sum + (Number(item.carton) || 0), 0);
  }

  onSearchChange(event: any): void {
    let searchTerm = event.target.value;
    
    if (searchTerm && searchTerm !== searchTerm.toUpperCase()) {
      searchTerm = searchTerm.toUpperCase();
      event.target.value = searchTerm;
    }
    
    this.searchTerm = searchTerm;
    this.applyFilters();
  }

  // Format number
  formatNumber(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '0';
    }
    return value.toLocaleString('vi-VN');
  }

  // Kiểm tra xem mã TP có trùng trong cùng shipment không
  isDuplicateMaterialCode(item: FGCheckItem): boolean {
    const itemShipment = String(item.shipment || '').trim().toUpperCase();
    const itemMaterialCode = String(item.materialCode || '').trim();
    
    if (!itemShipment || !itemMaterialCode) {
      return false;
    }
    
    // Đếm số lượng items có cùng shipment và materialCode (kiểm tra trong toàn bộ items, không chỉ filteredItems)
    const duplicateCount = this.items.filter(i => {
      const iShipment = String(i.shipment || '').trim().toUpperCase();
      const iMaterialCode = String(i.materialCode || '').trim();
      return iShipment === itemShipment && iMaterialCode === itemMaterialCode;
    }).length;
    
    // Trả về true nếu có nhiều hơn 1 item (tức là có trùng)
    return duplicateCount > 1;
  }

  // Check Methods
  openCheck(): void {
    this.resetCheck();
    this.checkDialogStep = 'mode';
    this.showCheckDialog = true;
    this.cdr.detectChanges();
  }

  /** Chọn mode Check Thùng hoặc Check Số Lượng, chuyển sang form nhập ID/Shipment/Pallet */
  selectCheckMode(mode: 'pn' | 'pn-qty'): void {
    this.checkMode = mode;
    this.checkDialogStep = 'form';
    this.cdr.detectChanges();
    setTimeout(() => {
      const input = document.querySelector('.check-id-input') as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    }, 100);
  }

  /** Nút Ship Lẻ: đặt Pallet = "Ship lẻ" thay vì nhập số */
  setPalletToShipLe(): void {
    this.currentPalletNo = 'Ship lẻ';
    this.cdr.detectChanges();
  }

  closeCheckDialog(): void {
    this.showCheckDialog = false;
    this.checkDialogStep = 'mode';
    this.cdr.detectChanges();
  }

  /** Lấy 7 ký tự đầu từ chuỗi quét ID; định dạng ASP + 4 số. Trả về chuỗi đã chuẩn hóa hoặc rỗng nếu không hợp lệ. */
  normalizeCheckId(raw: string): string {
    const s = String(raw || '').trim().toUpperCase();
    const id7 = s.substring(0, 7);
    if (id7.length < 7) return id7; // Chưa đủ 7 ký tự thì trả về như cũ để user nhập tiếp
    const match = /^ASP\d{4}$/.test(id7);
    return match ? id7 : '';
  }

  /** Kiểm tra ID đã đúng định dạng ASP + 4 số chưa */
  isCheckIdValid(): boolean {
    const id = this.normalizeCheckId(this.scannedCheckId);
    return id.length === 7 && /^ASP\d{4}$/.test(id);
  }

  /** Sau khi nhập/quét ID và nhấn Enter → validate, lấy 7 ký tự đầu, nhảy focus sang ô Shipment */
  onIdEnterMoveToShipment(): void {
    const raw = String(this.scannedCheckId || '').trim().toUpperCase();
    const id7 = raw.substring(0, 7);
    this.scannedCheckId = id7;
    if (id7.length < 7) {
      alert('ID phải đủ 7 ký tự, định dạng ASP + 4 số (VD: ASP1234)');
      return;
    }
    if (!/^ASP\d{4}$/.test(id7)) {
      alert('ID không đúng định dạng. Yêu cầu: ASP + 4 số (VD: ASP1234)');
      return;
    }
    this.cdr.detectChanges();
    setTimeout(() => {
      const shipmentInput = document.querySelector('.check-shipment-input') as HTMLInputElement;
      if (shipmentInput) {
        shipmentInput.focus();
        shipmentInput.select();
      }
    }, 50);
  }

  /** Sau khi nhập/quét xong Số Shipment và nhấn Enter → tự nhảy focus sang ô Số Pallet */
  onShipmentEnterMoveToPallet(): void {
    this.scannedShipment = String(this.scannedShipment || '').trim().toUpperCase();
    if (!this.scannedShipment) return;
    this.cdr.detectChanges();
    setTimeout(() => {
      const palletInput = document.querySelector('.check-pallet-input') as HTMLInputElement;
      if (palletInput) {
        palletInput.focus();
        palletInput.select();
      }
    }, 50);
  }

  /** Nhấn Enter ở ô Số Pallet → xác nhận (confirm) nếu đã có đủ ID + Shipment + Pallet */
  onPalletEnterConfirm(): void {
    this.currentPalletNo = String(this.currentPalletNo || '').trim().toUpperCase();
    if (this.isCheckIdValid() && this.scannedShipment && this.currentPalletNo) {
      this.confirmCheckInfo();
    }
  }

  confirmCheckInfo(): void {
    // Bắt buộc: ID (7 ký tự ASP+4 số), Shipment, Pallet
    if (!this.scannedCheckId || !this.scannedShipment || !this.currentPalletNo) {
      alert('Vui lòng nhập đầy đủ ID, Số Shipment và Số Pallet!');
      return;
    }
    const id7 = this.normalizeCheckId(this.scannedCheckId);
    if (id7.length !== 7 || !/^ASP\d{4}$/.test(id7)) {
      alert('ID không đúng định dạng. Yêu cầu: 7 ký tự, ASP + 4 số (VD: ASP1234)');
      return;
    }
    
    // Chuẩn hóa dữ liệu
    this.scannedCheckId = id7;
    this.scannedShipment = String(this.scannedShipment).trim().toUpperCase();
    this.currentPalletNo = String(this.currentPalletNo).trim().toUpperCase();
    
    console.log('✅ Confirm check info:', {
      id: this.scannedCheckId,
      shipment: this.scannedShipment,
      pallet: this.currentPalletNo
    });
    
    // Đóng popup
    this.showCheckDialog = false;
    
    // Chuyển sang step 3 (scan mã TP; nếu Check Số Lượng thì thêm scan số lượng)
    this.checkStep = 3;
    // Giữ checkMode đã chọn (pn = Check Thùng, pn-qty = Check Số Lượng)
    
    this.cdr.detectChanges();
    
    // Focus vào input scan mã TP sau khi popup đóng
    setTimeout(() => {
      const input = document.querySelector('.scan-material-input') as HTMLInputElement;
      if (input) {
        input.focus();
      }
    }, 200);
  }

  resetCheck(): void {
    this.checkStep = 0;
    this.checkMode = 'pn-qty'; // Mặc định là PN+QTY
    this.scannedCheckId = '';
    this.scannedShipment = '';
    this.currentPalletNo = '';
    this.currentScanInput = '';
    this.currentQtyInput = '';
    this.waitingForQty = false;
    this.isScanning = false;
    this.scannedItems = []; // Reset danh sách scan tạm thời
    this.currentShipmentItems = []; // Reset danh sách shipment items
    
    // Clear filter khi reset
    this.filterByShipment = '';
    this.applyFilters();
  }

  // Select check mode
  selectModeAndContinue(mode: 'pn' | 'pn-qty'): void {
    console.log('🔵 selectModeAndContinue called with mode:', mode);
    console.log('🔵 Current checkStep:', this.checkStep);
    console.log('🔵 Current showCheckDialog:', this.showCheckDialog);
    
    try {
      // Update values immediately
      this.checkMode = mode;
      this.scannedShipment = '0001'; // Default test shipment
      this.checkStep = 1;
      
      console.log('✅ After update - checkStep:', this.checkStep);
      console.log('✅ After update - checkMode:', this.checkMode);
      console.log('✅ After update - scannedShipment:', this.scannedShipment);
      
      // Recalculate check results when mode changes
      this.calculateCheckResults();
      
      // Force change detection
      this.cdr.detectChanges();
      
      console.log('✅ Change detection called');
      
      // Focus input after view updates
      setTimeout(() => {
        const input = document.querySelector('.check-shipment-input') as HTMLInputElement;
        console.log('🔍 Looking for input:', input);
        if (input) {
          console.log('✅ Input found, focusing...');
          input.focus();
          input.select();
        } else {
          console.log('❌ Input not found');
        }
      }, 100);
    } catch (error) {
      console.error('❌ Error in selectModeAndContinue:', error);
    }
  }

  onShipmentEntered(): void {
    const shipmentCode = String(this.scannedShipment || '').trim().toUpperCase();
    if (!shipmentCode) return;
    
    console.log('🔵 onShipmentEntered called, shipmentCode:', shipmentCode);
    
    // KHÔNG load dữ liệu gì ra nữa - chỉ chuyển sang step scan Pallet
    this.checkStep = 2; // Chuyển sang step scan Pallet
    this.cdr.detectChanges();
    
    // Auto focus on pallet input
    setTimeout(() => {
      const palletInput = document.querySelector('.scan-pallet-input') as HTMLInputElement;
      if (palletInput) {
        palletInput.focus();
      }
    }, 200);
  }

  // Chỉ cho phép chọn Check P/N + QTY (không cho chọn Check P/N)
  selectModeAndContinueNew(mode: 'pn-qty'): void {
    console.log('🔵 selectModeAndContinueNew called with mode:', mode);
    this.checkMode = mode;
    this.checkStep = 1; // Chuyển sang step nhập shipment
    this.cdr.detectChanges();
    
    // Focus vào input shipment
    setTimeout(() => {
      const input = document.querySelector('.custom-input') as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    }, 100);
  }

  // Scan Pallet No
  onPalletScanned(): void {
    const palletNo = String(this.currentPalletNo || '').trim().toUpperCase();
    if (!palletNo) {
      alert('⚠️ Vui lòng nhập số Pallet!');
      return;
    }
    
    console.log('🔵 Pallet scanned:', palletNo);
    
    // Chuyển sang step scan mã hàng + số lượng
    this.checkStep = 3;
    this.cdr.detectChanges();
    
    // Auto focus on customer code input
    setTimeout(() => {
      const scanInput = document.querySelector('.scan-customer-input') as HTMLInputElement;
      if (scanInput) {
        scanInput.focus();
      }
    }, 200);
  }

  // Khi nhập mã TP và nhấn Enter → tự động focus vào ô số lượng
  onMaterialCodeEntered(): void {
    const materialCode = String(this.currentScanInput.trim()).toUpperCase();
    if (!materialCode) {
      return;
    }
    
    // Check Số Lượng: tự động focus vào ô số lượng
    setTimeout(() => {
      const qtyInput = document.querySelector('.scan-qty-input') as HTMLInputElement;
      if (qtyInput) {
        qtyInput.focus();
        qtyInput.select();
      }
    }, 100);
  }

  /** Check Thùng: mỗi lần scan mã hàng = 1 thùng. Lưu ngay, không cần nhập số lượng. */
  onMaterialScannedForCarton(): void {
    const customerCode = String(this.currentScanInput.trim()).toUpperCase();
    if (!customerCode) {
      alert('⚠️ Vui lòng nhập mã hàng!');
      return;
    }
    const materialCode = this.getMaterialCodeFromCustomerCode(customerCode);
    if (!materialCode) {
      alert(`⚠️ Không tìm thấy Mã TP cho mã hàng "${customerCode}". Vui lòng kiểm tra mapping!`);
      this.currentScanInput = '';
      return;
    }
    this.scannedItems.push({ materialCode, quantity: 1, customerCode } as any); // quantity 1 = 1 lần scan = 1 thùng
    this.saveSingleScannedItem(customerCode, materialCode, 0); // Check Thùng: mỗi lần scan = 1 thùng (quantity không dùng)
    this.currentScanInput = '';
    this.cdr.detectChanges();
    setTimeout(() => {
      const input = document.querySelector('.scan-material-input') as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    }, 100);
  }

  // Scan mã hàng + số lượng (có thể scan nhiều lần) - Tự động lưu ngay vào Firebase
  // Từ mã hàng sẽ tự động tìm ra mã TP
  onMaterialAndQtyScanned(): void {
    if (!this.currentScanInput.trim()) {
      alert('⚠️ Vui lòng nhập mã hàng!');
      return;
    }
    
    const customerCode = String(this.currentScanInput.trim()).toUpperCase();
    const qtyValue = this.currentQtyInput.trim();
    
    // Parse số lượng
    const cleanQtyValue = qtyValue.replace(/[^\d]/g, '');
    const quantity = cleanQtyValue ? parseInt(cleanQtyValue, 10) : 0;
    
    if (!customerCode) {
      alert('⚠️ Vui lòng nhập mã hàng!');
      return;
    }
    
    if (quantity <= 0) {
      alert('⚠️ Số lượng phải lớn hơn 0!');
      return;
    }
    
    // Tìm mã TP từ mã hàng
    const materialCode = this.getMaterialCodeFromCustomerCode(customerCode);
    
    if (!materialCode) {
      alert(`⚠️ Không tìm thấy Mã TP cho mã hàng "${customerCode}".\n\nVui lòng kiểm tra lại mapping trong danh mục!`);
      // Reset input để scan lại
      this.currentScanInput = '';
      this.currentQtyInput = '';
      setTimeout(() => {
        const scanInput = document.querySelector('.scan-material-input') as HTMLInputElement;
        if (scanInput) {
          scanInput.focus();
          scanInput.select();
        }
      }, 100);
      return;
    }
    
    // Thêm vào danh sách scan tạm thời để hiển thị (hiển thị cả mã hàng và mã TP)
    this.scannedItems.push({
      materialCode: materialCode,
      quantity: quantity,
      customerCode: customerCode // Thêm customerCode để hiển thị
    } as any);
    
    console.log(`✅ Đã scan: Mã hàng=${customerCode} -> Mã TP=${materialCode}, Số lượng=${quantity}`);
    console.log(`📋 Tổng số items đã scan: ${this.scannedItems.length}`);
    
    // Tự động lưu ngay vào Firebase và cập nhật bảng
    this.saveSingleScannedItem(customerCode, materialCode, quantity);
    
    // Reset input để scan tiếp
    this.currentScanInput = '';
    this.currentQtyInput = '';
    
    // Auto focus lại vào input mã hàng để tiếp tục scan
    setTimeout(() => {
      const scanInput = document.querySelector('.scan-material-input') as HTMLInputElement;
      if (scanInput) {
        scanInput.focus();
        scanInput.select();
      }
    }, 100);
    
    this.cdr.detectChanges();
  }

  /** Lưu một item đơn lẻ vào Firebase. Check Thùng (pn): mỗi lần scan = cộng đúng 1 thùng (carton+1), không cộng quantity. */
  saveSingleScannedItem(customerCode: string, materialCode: string, quantity: number): void {
    if (!this.scannedShipment || !this.currentPalletNo) {
      console.warn('⚠️ Chưa có Shipment hoặc Pallet No!');
      return;
    }
    
    const shipmentCode = String(this.scannedShipment).trim().toUpperCase();
    const palletNo = String(this.currentPalletNo).trim().toUpperCase();
    const materialCodeUpper = materialCode.toUpperCase();
    const customerCodeUpper = String(customerCode).trim().toUpperCase();
    
    // Tìm item đã có trong Firebase (cùng shipment, materialCode, palletNo, chưa lock)
    const existingItem = this.items.find(item => {
      const itemShipment = String(item.shipment || '').trim().toUpperCase();
      const itemMaterialCode = String(item.materialCode || '').trim().toUpperCase();
      const itemPalletNo = String(item.palletNo || '').trim().toUpperCase();
      const itemCustomerCode = String(item.customerCode || '').trim().toUpperCase();
      return itemShipment === shipmentCode && 
             itemMaterialCode === materialCodeUpper &&
             itemPalletNo === palletNo &&
             !item.isLocked; // Chỉ cập nhật item chưa lock
    });
    
    if (existingItem && existingItem.id) {
      const isCartonMode = this.checkMode === 'pn'; // Check Thùng: mỗi lần scan = 1 thùng
      const newQuantity = isCartonMode ? (existingItem.quantity || 0) : (existingItem.quantity || 0) + quantity;
      const newCarton = isCartonMode ? (existingItem.carton || 0) + 1 : (existingItem.carton || 0); // pn: mỗi scan +1 thùng
      if (isCartonMode) {
        console.log(`✅ Check Thùng - Mỗi scan = 1 thùng: Mã hàng=${customerCodeUpper} -> Mã TP=${materialCodeUpper}, Thùng: ${existingItem.carton || 0} + 1 = ${newCarton}`);
      } else {
        console.log(`✅ Cộng dồn: Mã hàng=${customerCodeUpper} -> Mã TP=${materialCodeUpper}, Số lượng: ${existingItem.quantity} + ${quantity} = ${newQuantity}`);
      }
      const idsToUpdate = (existingItem.docIds && existingItem.docIds.length) ? existingItem.docIds : [existingItem.id!];
      const mainId = idsToUpdate[0];
      const restIds = idsToUpdate.slice(1);
      const updatePayload = {
        quantity: newQuantity,
        carton: newCarton,
        customerCode: customerCodeUpper,
        scannedCustomerCode: true,
        scannedQuantity: !isCartonMode,
        ...(this.scannedCheckId ? { scanId: this.scannedCheckId } : {}),
        updatedAt: new Date()
      };
      this.firestore.collection('fg-check').doc(mainId).update(updatePayload)
      .then(() => {
        if (restIds.length) {
          return Promise.all(restIds.map(id => this.firestore.collection('fg-check').doc(id).delete()));
        }
      })
      .then(() => {
        existingItem.quantity = newQuantity;
        existingItem.carton = newCarton;
        existingItem.customerCode = customerCodeUpper;
        existingItem.scannedCustomerCode = true;
        existingItem.scannedQuantity = !isCartonMode;
        if (this.scannedCheckId) existingItem.scanId = this.scannedCheckId;
        existingItem.updatedAt = new Date();
        existingItem.id = mainId;
        (existingItem as any).docIds = undefined;
        this.calculateCheckResults();
        this.applyFilters();
        this.cdr.detectChanges();
      })
      .catch(error => {
        console.error(`❌ Error updating ${materialCodeUpper}:`, error);
        alert(`❌ Lỗi khi cập nhật ${materialCodeUpper}: ${error.message}`);
      });
    } else {
      // Tạo item mới
      const isCartonMode = this.checkMode === 'pn';
      const checkId = this.getNextCheckId();
      const newItem: FGCheckItem = {
        shipment: shipmentCode,
        materialCode: materialCodeUpper,
        customerCode: customerCodeUpper,
        carton: isCartonMode ? 1 : 0,
        quantity: isCartonMode ? 0 : quantity,
        isChecked: false,
        checkId: checkId,
        scanId: this.scannedCheckId || undefined,
        checkMode: this.checkMode,
        palletNo: palletNo,
        isLocked: false,
        scannedCustomerCode: true,
        scannedQuantity: !isCartonMode,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      this.firestore.collection('fg-check').add(newItem)
        .then((docRef) => {
          newItem.id = docRef.id;
          this.items.push(newItem);
          console.log(`✅ Tạo mới: Mã hàng=${customerCodeUpper} -> Mã TP=${materialCodeUpper} = ${quantity}`);
          
          // Recalculate và cập nhật bảng
          this.calculateCheckResults();
          this.applyFilters();
          this.cdr.detectChanges();
        })
        .catch(error => {
          console.error(`❌ Error creating ${materialCodeUpper}:`, error);
          alert(`❌ Lỗi khi tạo mới ${materialCodeUpper}: ${error.message}`);
        });
    }
  }

  // Lưu dữ liệu đã scan vào Firebase (cộng dồn theo mã TP)
  saveScannedData(): void {
    if (!this.scannedShipment || !this.currentPalletNo) {
      alert('⚠️ Vui lòng nhập đầy đủ Shipment và Pallet No!');
      return;
    }
    
    if (this.scannedItems.length === 0) {
      alert('⚠️ Chưa có dữ liệu nào được scan!');
      return;
    }
    
    const shipmentCode = String(this.scannedShipment).trim().toUpperCase();
    const palletNo = String(this.currentPalletNo).trim().toUpperCase();
    
    // Nhóm theo materialCode và cộng dồn số lượng
    const groupedByMaterial: Map<string, number> = new Map();
    
    this.scannedItems.forEach(item => {
      const materialCode = item.materialCode;
      const currentQty = groupedByMaterial.get(materialCode) || 0;
      groupedByMaterial.set(materialCode, currentQty + item.quantity);
    });
    
    console.log('📊 Dữ liệu đã nhóm theo mã TP:', Array.from(groupedByMaterial.entries()));
    
    // Lưu từng materialCode vào Firebase (cộng dồn nếu đã có)
    let savedCount = 0;
    let errorCount = 0;
    const savePromises: Promise<void>[] = [];
    
    groupedByMaterial.forEach((totalQuantity, materialCode) => {
      // Tìm item đã có trong Firebase (cùng shipment, materialCode, palletNo)
      const existingItem = this.items.find(item => {
        const itemShipment = String(item.shipment || '').trim().toUpperCase();
        const itemMaterialCode = String(item.materialCode || '').trim().toUpperCase();
        const itemPalletNo = String(item.palletNo || '').trim().toUpperCase();
        return itemShipment === shipmentCode && 
               itemMaterialCode === materialCode.toUpperCase() &&
               itemPalletNo === palletNo &&
               !item.isLocked;
      });
      
      // Đã có dòng: mỗi lần scan Enter đã gọi saveSingleScannedItem và cập nhật Firebase rồi → KHÔNG cộng thêm (tránh double)
      if (existingItem && existingItem.id) {
        savedCount++;
        // Không gọi Firebase update ở đây - số lượng đã được lưu từng lần khi user nhấn Enter
        this.cdr.detectChanges();
        return;
      }
      // Chưa có dòng: tạo mới
      {
        const isCartonMode = this.checkMode === 'pn';
        const checkId = this.getNextCheckId();
        const newItem: FGCheckItem = {
          shipment: shipmentCode,
          materialCode: materialCode.toUpperCase(),
          customerCode: '',
          carton: isCartonMode ? totalQuantity : 0,
          quantity: isCartonMode ? 0 : totalQuantity,
          isChecked: false,
          checkId: checkId,
          scanId: this.scannedCheckId || undefined,
          checkMode: this.checkMode,
          palletNo: palletNo,
          isLocked: false,
          scannedCustomerCode: false,
          scannedQuantity: !isCartonMode,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        const createPromise = this.firestore.collection('fg-check').add(newItem)
          .then((docRef) => {
            newItem.id = docRef.id;
            this.items.push(newItem);
            savedCount++;
            console.log(`✅ Tạo mới: ${materialCode} = ${totalQuantity}`);
          })
          .catch(error => {
            errorCount++;
            console.error(`❌ Error creating ${materialCode}:`, error);
          });
        
        savePromises.push(createPromise);
      }
    });
    
    // Chờ tất cả saves hoàn thành
    Promise.all(savePromises).then(() => {
      // Recalculate check results và apply filters
      this.calculateCheckResults();
      this.applyFilters();
      
      // Reset scanning state
      this.scannedItems = [];
      this.currentPalletNo = '';
      this.currentScanInput = '';
      this.currentQtyInput = '';
      this.isScanning = false;
      this.checkStep = 0;
      this.showCheckDialog = false;
      
      // Clear filter
      this.filterByShipment = '';
      this.applyFilters();
      
      alert(`✅ Đã lưu thành công!\n\n` +
            `- Shipment: ${shipmentCode}\n` +
            `- Pallet No: ${palletNo}\n` +
            `- Số mã TP: ${groupedByMaterial.size}\n` +
            `- Đã lưu: ${savedCount} items\n` +
            `- Lỗi: ${errorCount} items`);
      
      this.cdr.detectChanges();
    });
  }

  // Load danh sách materialCode của shipment để hiển thị và tự động tạo items trong bảng
  loadShipmentItems(shipmentCode: string): void {
    const normalizedShipmentCode = String(shipmentCode).trim().toUpperCase();
    console.log('📦 Loading shipment items for:', normalizedShipmentCode);
    
    // Lấy từ shipmentDataMap đã load
    const shipmentDataList = this.shipmentDataMap.get(normalizedShipmentCode) || [];
    
    if (shipmentDataList.length === 0) {
      alert(`⚠️ Không tìm thấy dữ liệu cho shipment "${normalizedShipmentCode}". Vui lòng kiểm tra lại!`);
      return;
    }
    
    // Tạo danh sách mới từ shipment data với customerCode (nếu có mapping)
    const newShipmentItems: ShipmentDisplayItem[] = shipmentDataList.map(shipmentData => {
      // Tìm customerCode từ mapping (reverse lookup)
      let customerCode = '';
      this.customerMappings.forEach((materialCode, custCode) => {
        if (materialCode === shipmentData.materialCode) {
          customerCode = custCode;
        }
      });
      
      return {
        materialCode: shipmentData.materialCode,
        quantity: shipmentData.quantity,
        carton: shipmentData.carton,
        customerCode: customerCode
      };
    });
    
    // QUAN TRỌNG: Merge với danh sách cũ - chỉ thêm các mã TP mới (chưa có)
    // Tạo Set để track các materialCode đã có
    const existingMaterialCodes = new Set(
      this.currentShipmentItems.map(item => String(item.materialCode || '').trim())
    );
    
    // Chỉ thêm các mã TP mới vào danh sách
    const newItemsToAdd = newShipmentItems.filter(item => {
      const materialCode = String(item.materialCode || '').trim();
      const isNew = !existingMaterialCodes.has(materialCode);
      if (isNew) {
        console.log(`➕ Adding new materialCode: ${materialCode}`);
      } else {
        console.log(`⏭️ Skipping existing materialCode: ${materialCode}`);
      }
      return isNew;
    });
    
    // Merge: thêm các mã mới vào danh sách cũ
    this.currentShipmentItems = [...this.currentShipmentItems, ...newItemsToAdd];
    
    // Sắp xếp lại theo materialCode A, B, C
    this.currentShipmentItems.sort((a, b) => {
      const materialA = String(a.materialCode || '').toUpperCase();
      const materialB = String(b.materialCode || '').toUpperCase();
      return materialA.localeCompare(materialB);
    });
    
    console.log(`✅ Updated shipment items list: ${this.currentShipmentItems.length} total items (${newItemsToAdd.length} new items added)`);
    console.log(`📋 Current items:`, 
      this.currentShipmentItems.map(item => `materialCode=${item.materialCode}, quantity=${item.quantity}`));
    
    // Tự động tạo items trong bảng FG Check từ shipment data (chỉ tạo items mới)
    this.createItemsFromShipment(normalizedShipmentCode, shipmentDataList);
  }

  // Tự động tạo items trong bảng FG Check từ shipment data
  createItemsFromShipment(shipmentCode: string, shipmentDataList: ShipmentData[]): void {
    console.log('📝 Creating FG Check items from shipment data...');
    
    shipmentDataList.forEach((shipmentData, index) => {
      // QUAN TRỌNG: Kiểm tra xem item đã tồn tại chưa (dựa vào shipment + materialCode + poShip)
      // Nếu cùng materialCode nhưng khác PO Ship, tạo item mới
      const existingItem = this.items.find(item => {
        const itemShipment = String(item.shipment || '').trim().toUpperCase();
        const itemMaterialCode = String(item.materialCode || '').trim();
        const itemPoShip = String(item.poShip || '').trim();
        const dataPoShip = String(shipmentData.poShip || '').trim();
        return itemShipment === shipmentCode && 
               itemMaterialCode === shipmentData.materialCode &&
               itemPoShip === dataPoShip; // Phải khớp cả PO Ship
      });
      
      if (existingItem) {
        console.log(`⏭️ Item already exists for shipment ${shipmentCode}, materialCode ${shipmentData.materialCode}, poShip ${shipmentData.poShip} - SKIP creating duplicate`);
        // Cập nhật shipmentCarton và shipmentQuantity nếu chưa có
        if (!existingItem.shipmentCarton || !existingItem.shipmentQuantity) {
          existingItem.shipmentCarton = shipmentData.carton;
          existingItem.shipmentQuantity = shipmentData.quantity;
          existingItem.poShip = shipmentData.poShip;
          // Cập nhật vào Firebase
          if (existingItem.id) {
            this.firestore.collection('fg-check').doc(existingItem.id).update({
              shipmentCarton: shipmentData.carton,
              shipmentQuantity: shipmentData.quantity,
              poShip: shipmentData.poShip
            }).catch(error => {
              console.error('❌ Error updating shipment data:', error);
            });
          }
        }
        return; // KHÔNG TẠO TRÙNG
      }
      
      // Tìm customerCode từ mapping
      let customerCode = '';
      this.customerMappings.forEach((materialCode, custCode) => {
        if (materialCode === shipmentData.materialCode) {
          customerCode = custCode;
        }
      });
      
      // Tạo item mới (mỗi PO Ship = 1 item riêng)
      const checkId = this.getNextCheckId();
      const newItem: FGCheckItem = {
        shipment: shipmentCode,
        materialCode: shipmentData.materialCode,
        customerCode: customerCode,
        carton: 0,
        quantity: 0,
        isChecked: false,
        checkId: checkId,
        scanId: this.scannedCheckId || undefined,
        checkMode: this.checkMode,
        shipmentCarton: shipmentData.carton, // Lưu số thùng từ shipment
        shipmentQuantity: shipmentData.quantity, // Lưu số lượng từ shipment
        poShip: shipmentData.poShip, // Lưu PO Ship để phân biệt
        scannedCustomerCode: false,
        scannedQuantity: false,
        isLocked: false, // Mặc định không lock
        palletNo: '', // Mặc định không có pallet number
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      // Lưu vào Firebase
      this.firestore.collection('fg-check').add(newItem)
        .then((docRef) => {
          console.log(`✅ Created item for shipment ${shipmentCode}, materialCode ${shipmentData.materialCode}, poShip ${shipmentData.poShip}`);
          newItem.id = docRef.id;
          this.items.push(newItem);
          this.calculateCheckResults();
          this.applyFilters();
        })
        .catch(error => {
          console.error('❌ Error creating item:', error);
        });
    });
  }

  onCustomerCodeScanned(): void {
    if (!this.currentScanInput.trim()) return;
    if (!this.scannedShipment.trim()) {
      alert('❌ Vui lòng nhập Shipment trước!');
      return;
    }
    
    const scanValue = this.currentScanInput.trim().toUpperCase();
    
    if (this.checkMode === 'pn') {
      // Mode Check P/N: mỗi lần scan = 1
      this.saveCustomerCode(scanValue, 1);
      this.currentScanInput = '';
      setTimeout(() => {
        const scanInput = document.querySelector('.scan-customer-input') as HTMLInputElement;
        if (scanInput) {
          scanInput.focus();
          scanInput.select();
        }
      }, 100);
    } else if (this.checkMode === 'pn-qty') {
      // Mode Check P/N + QTY: scan PN trước, sau đó scan QTY
      // Có thể scan format "300+PCS" (cùng lúc) hoặc scan riêng (PN trước, QTY sau)
      const plusIndex = scanValue.indexOf('+');
      
      if (plusIndex > 0) {
        // Format: "300+PCS" hoặc "300+P+C+S" -> quantity=300, customerCode (bỏ PCS)
        const quantityStr = scanValue.substring(0, plusIndex);
        let customerCode = scanValue.substring(plusIndex + 1);
        const quantity = parseInt(quantityStr) || 1;
        
        // Bỏ "PCS" khỏi mã khách hàng
        customerCode = customerCode.replace(/PCS/gi, '');
        customerCode = customerCode.replace(/P\+C\+S/gi, '');
        customerCode = customerCode.replace(/\+/g, '');
        customerCode = customerCode.trim();
        
        if (customerCode) {
          this.saveCustomerCode(customerCode, quantity);
          this.currentScanInput = '';
          this.currentQtyInput = '';
          this.waitingForQty = false;
          setTimeout(() => {
            const scanInput = document.querySelector('.scan-customer-input') as HTMLInputElement;
            if (scanInput) {
              scanInput.focus();
              scanInput.select();
            }
          }, 100);
        } else {
          alert('❌ Mã khách hàng không hợp lệ!');
        }
      } else {
        // Không có dấu +, đây là mã hàng (PN)
        // Chuyển sang chế độ đợi scan số lượng
        console.log('✅ Đã scan mã hàng:', scanValue);
        console.log('✅ Chuyển sang bước 2: Scan số lượng');
        this.waitingForQty = true;
        
        // Focus vào ô số lượng
        setTimeout(() => {
          const qtyInput = document.querySelector('.scan-qty-input') as HTMLInputElement;
          if (qtyInput) {
            qtyInput.focus();
            qtyInput.select();
            console.log('✅ Đã focus vào ô số lượng');
          }
        }, 100);
      }
    }
  }

  onQuantityScanned(): void {
    if (!this.currentQtyInput.trim()) return;
    
    const qtyValue = this.currentQtyInput.trim();
    console.log('🔵 onQuantityScanned - qtyValue:', qtyValue);
    
    // Check if we have customer code from previous scan
    if (this.currentScanInput.trim()) {
      // We have both: customerCode from previous scan and quantity from this scan
      const customerCode = this.currentScanInput.trim().toUpperCase();
      // Parse quantity: loại bỏ các ký tự không phải số
      const cleanQtyValue = qtyValue.replace(/[^\d]/g, '');
      const quantity = cleanQtyValue ? parseInt(cleanQtyValue, 10) : 0;
      console.log('✅ Đã scan xong: Mã hàng:', customerCode, 'Số lượng:', quantity);
      
      if (quantity <= 0) {
        alert('❌ Số lượng không hợp lệ!');
        this.currentQtyInput = '';
        return;
      }
      
      this.saveCustomerCode(customerCode, quantity);
      
      // Reset for next scan và quay về bước 1
      this.currentScanInput = '';
      this.currentQtyInput = '';
      this.waitingForQty = false;
      console.log('✅ Reset về bước 1: Scan mã hàng');
      
      setTimeout(() => {
        const scanInput = document.querySelector('.scan-customer-input') as HTMLInputElement;
        if (scanInput) {
          scanInput.focus();
          scanInput.select();
          console.log('✅ Đã focus vào ô mã hàng');
        }
      }, 100);
    } else {
      // No customer code yet, check if qtyValue contains format "300+PCS"
      const plusIndex = qtyValue.indexOf('+');
      
      if (plusIndex > 0) {
        // Format: "300+PCS" - parse and save
        const quantityStr = qtyValue.substring(0, plusIndex);
        let customerCode = qtyValue.substring(plusIndex + 1);
        const quantity = parseInt(quantityStr) || 1;
        
        // Bỏ "PCS" khỏi mã khách hàng
        customerCode = customerCode.replace(/PCS/gi, '');
        customerCode = customerCode.replace(/P\+C\+S/gi, '');
        customerCode = customerCode.replace(/\+/g, '');
        customerCode = customerCode.trim();
        
        if (customerCode) {
          this.saveCustomerCode(customerCode, quantity);
          this.currentScanInput = '';
          this.currentQtyInput = '';
          this.waitingForQty = false;
          
          setTimeout(() => {
            const scanInput = document.querySelector('.scan-customer-input') as HTMLInputElement;
            if (scanInput) {
              scanInput.focus();
              scanInput.select();
            }
          }, 100);
        } else {
          alert('❌ Mã khách hàng không hợp lệ!');
        }
      } else {
        // Just a number, but no customer code - this shouldn't happen in normal flow
        // Reset and go back to customer code input
        this.currentQtyInput = '';
        this.waitingForQty = false;
        alert('❌ Vui lòng quét mã hàng trước!');
        setTimeout(() => {
          const scanInput = document.querySelector('.scan-customer-input') as HTMLInputElement;
          if (scanInput) {
            scanInput.focus();
            scanInput.select();
          }
        }, 100);
      }
    }
  }

  // Kiểm tra xem materialCode có trong shipment hiện tại không
  isMaterialCodeInCurrentShipment(materialCode: string, shipmentCode: string): boolean {
    // Normalize để so sánh
    const normalizedMaterialCode = String(materialCode || '').trim();
    const normalizedShipmentCode = String(shipmentCode || '').trim().toUpperCase();
    
    console.log(`🔍 Checking if materialCode "${normalizedMaterialCode}" exists in shipment "${normalizedShipmentCode}"`);
    console.log(`🔍 shipmentDataMap total size: ${this.shipmentDataMap.size}`);
    console.log(`🔍 All shipment codes in map:`, Array.from(this.shipmentDataMap.keys()));
    
    // QUAN TRỌNG: Kiểm tra shipmentDataMap TRƯỚC vì đây là nguồn dữ liệu chính xác nhất
    const shipmentDataList = this.shipmentDataMap.get(normalizedShipmentCode) || [];
    console.log(`🔍 shipmentDataMap for "${normalizedShipmentCode}" has ${shipmentDataList.length} items:`, shipmentDataList.map(item => `${item.materialCode} (qty: ${item.quantity})`));
    
    if (shipmentDataList.length === 0) {
      console.error(`❌ NO DATA FOUND for shipment "${normalizedShipmentCode}" in shipmentDataMap!`);
      console.error(`❌ Available shipments:`, Array.from(this.shipmentDataMap.keys()));
      console.error(`❌ Please check if shipment data was loaded correctly!`);
    }
    
    const foundInShipmentData = shipmentDataList.find(item => {
      const itemMaterialCode = String(item.materialCode || '').trim();
      const match = itemMaterialCode === normalizedMaterialCode;
      console.log(`  🔍 Comparing: "${itemMaterialCode}" === "${normalizedMaterialCode}" ? ${match}`);
      if (match) {
        console.log(`✅ Found match: "${itemMaterialCode}" === "${normalizedMaterialCode}"`);
      }
      return match;
    });
    
    if (foundInShipmentData) {
      console.log(`✅ MaterialCode ${normalizedMaterialCode} found in shipmentDataMap for shipment ${normalizedShipmentCode}`);
      // Nếu tìm thấy trong shipmentDataMap nhưng không có trong currentShipmentItems, cập nhật lại
      if (this.currentShipmentItems.length === 0) {
        console.log(`⚠️ currentShipmentItems is empty, reloading...`);
        this.loadShipmentItems(normalizedShipmentCode);
      }
      return true;
    }
    
    // Kiểm tra trong currentShipmentItems (backup check)
    if (this.currentShipmentItems.length > 0) {
      console.log(`🔍 Checking currentShipmentItems:`, this.currentShipmentItems.map(item => item.materialCode));
      const found = this.currentShipmentItems.find(item => {
        const itemMaterialCode = String(item.materialCode || '').trim();
        return itemMaterialCode === normalizedMaterialCode;
      });
      if (found) {
        console.log(`✅ MaterialCode ${normalizedMaterialCode} found in currentShipmentItems`);
        return true;
      }
    }
    
    console.error(`❌ MaterialCode ${normalizedMaterialCode} NOT found in shipment ${normalizedShipmentCode}`);
    console.error(`❌ Available materialCodes in shipment:`, shipmentDataList.map(item => item.materialCode));
    console.error(`❌ DEBUG INFO:`);
    console.error(`   - shipmentDataMap size: ${this.shipmentDataMap.size}`);
    console.error(`   - All shipments:`, Array.from(this.shipmentDataMap.keys()));
    console.error(`   - Current shipment data:`, shipmentDataList);
    return false;
  }

  // Save customer code to Firebase
  // Logic: Scan mã hàng → Tra cứu mã TP từ mapping → Kiểm tra mã TP có trong shipment không
  saveCustomerCode(customerCode: string, quantity: number): void {
    // Normalize customerCode
    const normalizedCustomerCode = String(customerCode).trim().toUpperCase();
    console.log('🔵 saveCustomerCode called - customerCode:', customerCode, 'normalized:', normalizedCustomerCode, 'quantity:', quantity, 'checkMode:', this.checkMode);
    
    // Bước 1: Tra cứu mã TP từ mapping (danh mục mã khách hàng → mã TP)
    const materialCode = this.getMaterialCodeFromCustomerCode(normalizedCustomerCode);
    console.log('🔵 Bước 1 - Tra cứu mã TP từ mapping:', materialCode);
    
    if (!materialCode) {
      alert(`⚠️ Không tìm thấy Mã TP cho mã khách hàng "${normalizedCustomerCode}".\n\nVui lòng kiểm tra lại mapping trong danh mục!`);
      return;
    }
    
    // Normalize shipmentCode for comparison
    const normalizedShipmentCode = String(this.scannedShipment || '').trim().toUpperCase();
    
    // Bước 2: Kiểm tra mã TP có trong shipment hiện tại không (từ tab shipment)
    console.log('🔵 Bước 2 - Kiểm tra mã TP có trong shipment không...');
    const isInShipment = this.isMaterialCodeInCurrentShipment(materialCode, normalizedShipmentCode);
    
    if (!isInShipment) {
      // Lấy danh sách mã TP có trong shipment để hiển thị
      const shipmentDataList = this.shipmentDataMap.get(normalizedShipmentCode) || [];
      const availableMaterialCodes = shipmentDataList.map(item => item.materialCode).join(', ');
      
      alert(`⚠️ Mã TP "${materialCode}" (từ mã hàng "${normalizedCustomerCode}") không có trong shipment "${normalizedShipmentCode}".\n\n` +
            `Mã TP có trong shipment này: ${availableMaterialCodes || '(không có)'}\n\n` +
            `Vui lòng kiểm tra lại:\n` +
            `1. Mapping mã hàng → mã TP có đúng không?\n` +
            `2. Shipment có đúng mã TP này không?`);
      return;
    }
    
    console.log('✅ Mã TP khớp với shipment - tiếp tục lưu dữ liệu...');
    
    // Tự động lấy quantity từ shipment nếu chưa có hoặc trong chế độ PN
    if (normalizedShipmentCode && this.currentShipmentItems.length > 0) {
      const shipmentItem = this.currentShipmentItems.find(item => item.materialCode === materialCode);
      if (shipmentItem) {
        // Nếu là chế độ PN hoặc quantity = 1 (mặc định), dùng quantity từ shipment
        if (this.checkMode === 'pn' || quantity === 1) {
          quantity = shipmentItem.quantity;
          console.log(`✅ Auto-filled quantity from shipment: ${quantity}`);
        }
      }
    }
    
    // QUAN TRỌNG: Tìm item chưa đủ (chưa checked và chưa đủ số lượng/carton)
    // Nếu có nhiều dòng cùng materialCode (khác PO Ship), tìm dòng đầu tiên chưa đủ
    // Normalize materialCode để so sánh chính xác
    const normalizedMaterialCode = String(materialCode || '').trim();
    
    // Tìm tất cả items cùng shipment + materialCode + palletNo, sắp xếp theo PO Ship
    const normalizedPalletNo = String(this.currentPalletNo || '').trim().toUpperCase();
    const matchingItems = this.items.filter(item => {
      const itemShipment = String(item.shipment || '').trim().toUpperCase();
      const itemMaterialCode = String(item.materialCode || '').trim();
      const itemPalletNo = String(item.palletNo || '').trim().toUpperCase();
      return itemShipment === normalizedShipmentCode &&
             itemMaterialCode === normalizedMaterialCode &&
             itemPalletNo === normalizedPalletNo;
    });
    
    // Sắp xếp theo PO Ship để đảm bảo thứ tự
    matchingItems.sort((a, b) => {
      const poShipA = String(a.poShip || '').trim();
      const poShipB = String(b.poShip || '').trim();
      return poShipA.localeCompare(poShipB);
    });
    
    // Tìm item đầu tiên chưa đủ (chưa checked và chưa đủ số lượng/carton)
    let existingItem = matchingItems.find(item => {
      if (item.isChecked) return false; // Đã checked thì bỏ qua
      
      // Kiểm tra xem đã đủ chưa
      const isEnough = this.isItemEnough(item);
      return !isEnough; // Chỉ lấy item chưa đủ
    });
    
    // Nếu không tìm thấy item chưa đủ, kiểm tra xem có item nào chưa checked và chưa lock không (để cảnh báo)
    if (!existingItem) {
      const uncheckedUnlockedItem = matchingItems.find(item => !item.isChecked && !item.isLocked);
      if (uncheckedUnlockedItem) {
        // Tất cả items đã đủ nhưng chưa checked - có thể do logic check chưa chạy
        console.log(`ℹ️ All items for materialCode ${normalizedMaterialCode} are already enough, but not checked yet`);
        existingItem = uncheckedUnlockedItem; // Vẫn cập nhật item này
      } else {
        // Kiểm tra xem có item nào bị lock không
        const lockedItems = matchingItems.filter(item => item.isLocked);
        if (lockedItems.length > 0) {
          alert(`⚠️ Các dòng của mã TP "${normalizedMaterialCode}" đã bị lock. Không thể cập nhật!`);
          return;
        }
        
        // Tất cả items đã checked
        const checkedItems = matchingItems.filter(item => item.isChecked);
        if (checkedItems.length > 0) {
          alert(`⚠️ Tất cả các dòng của mã TP "${normalizedMaterialCode}" đã được checked. Không thể cập nhật!`);
          return;
        }
      }
    }
    
    if (existingItem && existingItem.id) {
      console.log('🔵 Found existing record:', existingItem);
      // Update existing record
      let updatedQuantity: number;
      let updatedCarton: number;
      
      if (this.checkMode === 'pn-qty') {
        // Chế độ PN + QTY: Cộng dồn số lượng, không tăng số thùng
        updatedQuantity = (existingItem.quantity || 0) + quantity; // Cộng dồn QTY vào số lượng
        updatedCarton = existingItem.carton || 0; // Giữ nguyên số thùng
        console.log(`📦 PN+QTY mode - Số lượng: ${existingItem.quantity} + ${quantity} = ${updatedQuantity}, Số thùng: ${updatedCarton}`);
      } else {
        // Chế độ PN: mỗi lần scan = 1 thùng, số lượng KHÔNG cập nhật (để 0)
        updatedQuantity = 0; // Không cập nhật số lượng, để trống
        updatedCarton = (existingItem.carton || 0) + 1; // Tăng số thùng
        console.log(`📦 PN mode - Số thùng: ${existingItem.carton} + 1 = ${updatedCarton} / ${existingItem.shipmentCarton || '?'} (Shipment), Số lượng: để trống`);
      }
      
      // Xác định trạng thái scan
      const isScanningCustomerCode = !existingItem.customerCode || existingItem.customerCode !== normalizedCustomerCode;
      const isScanningQuantity = existingItem.quantity !== updatedQuantity;
      
      const updateData = {
        quantity: updatedQuantity,
        carton: updatedCarton,
        shipment: normalizedShipmentCode, // Ensure shipmentCode is normalized
        materialCode: materialCode, // Ensure materialCode is updated
        customerCode: normalizedCustomerCode, // Ensure customerCode is normalized
        checkMode: this.checkMode, // Ensure checkMode is saved
        scannedCustomerCode: isScanningCustomerCode ? true : (existingItem.scannedCustomerCode || false),
        scannedQuantity: isScanningQuantity ? true : (existingItem.scannedQuantity || false),
        updatedAt: new Date()
      };
      
      console.log('🔵 Updating with data:', updateData);
      const idsToUpdate = (existingItem.docIds && existingItem.docIds.length) ? existingItem.docIds : [existingItem.id!];
      const mainId = idsToUpdate[0];
      const restIds = idsToUpdate.slice(1);
      const deleteRest = (): Promise<void> => (restIds.length ? Promise.all(restIds.map(id => this.firestore.collection('fg-check').doc(id).delete())).then(() => undefined) : Promise.resolve()) as Promise<void>;
      this.firestore.collection('fg-check').doc(mainId).update(updateData)
        .then(deleteRest)
        .then(() => {
          console.log('✅ Updated existing record:', normalizedCustomerCode, 'materialCode:', materialCode, 'quantity:', updatedQuantity);
          existingItem.quantity = updatedQuantity;
          existingItem.carton = updatedCarton;
          existingItem.shipment = normalizedShipmentCode;
          existingItem.materialCode = materialCode;
          existingItem.customerCode = normalizedCustomerCode;
          existingItem.checkMode = this.checkMode;
          existingItem.scannedCustomerCode = updateData.scannedCustomerCode;
          existingItem.scannedQuantity = updateData.scannedQuantity;
          existingItem.updatedAt = new Date();
          existingItem.id = mainId;
          (existingItem as any).docIds = undefined;
          this.calculateCheckResults();
          this.applyFilters();
        })
        .catch(error => {
          console.error('❌ Error updating:', error);
          alert('❌ Lỗi khi cập nhật: ' + error.message);
        });
    } else {
      // Create new record - Tìm item chưa đủ từ danh sách matchingItems
      console.log('🔵 Creating new record - checking for available item from matching items...');
      
      // Tìm item chưa đủ từ danh sách đã tìm ở trên
      const availableItem = matchingItems.find(item => {
        if (item.isChecked) return false;
        return !this.isItemEnough(item);
      });
      
      if (availableItem) {
        // Tìm thấy item chưa đủ - cập nhật item này
        console.log('✅ Found available item to update:', availableItem.checkId);
        existingItem = availableItem;
        
        // Cập nhật item này (giống logic update ở trên)
        let updatedQuantity: number;
        let updatedCarton: number;
        
        if (this.checkMode === 'pn-qty') {
          updatedQuantity = (availableItem.quantity || 0) + quantity;
          updatedCarton = availableItem.carton || 0;
        } else {
          updatedQuantity = 0;
          updatedCarton = (availableItem.carton || 0) + 1;
        }
        
        const isScanningCustomerCode = !availableItem.customerCode || availableItem.customerCode !== normalizedCustomerCode;
        const isScanningQuantity = availableItem.quantity !== updatedQuantity;
        
        const updateData = {
          quantity: updatedQuantity,
          carton: updatedCarton,
          shipment: normalizedShipmentCode,
          materialCode: materialCode,
          customerCode: normalizedCustomerCode,
          checkMode: this.checkMode,
          scannedCustomerCode: isScanningCustomerCode ? true : (availableItem.scannedCustomerCode || false),
          scannedQuantity: isScanningQuantity ? true : (availableItem.scannedQuantity || false),
          updatedAt: new Date()
        };
        
        if (availableItem.id) {
          this.firestore.collection('fg-check').doc(availableItem.id).update(updateData)
            .then(() => {
              console.log('✅ Updated available item:', normalizedCustomerCode, 'materialCode:', materialCode);
              availableItem.quantity = updatedQuantity;
              availableItem.carton = updatedCarton;
              availableItem.shipment = normalizedShipmentCode;
              availableItem.materialCode = materialCode;
              availableItem.customerCode = normalizedCustomerCode;
              availableItem.checkMode = this.checkMode;
              availableItem.scannedCustomerCode = updateData.scannedCustomerCode;
              availableItem.scannedQuantity = updateData.scannedQuantity;
              availableItem.updatedAt = new Date();
              this.calculateCheckResults();
              this.applyFilters();
            })
            .catch(error => {
              console.error('❌ Error updating:', error);
              alert('❌ Lỗi khi cập nhật: ' + error.message);
            });
        }
        return; // Đã xử lý xong
      }
      
      // Nếu không tìm thấy item chưa đủ, kiểm tra lại lần cuối (cùng shipment + materialCode + palletNo)
      const finalCheck = this.items.find(item => {
        const itemShipment = String(item.shipment || '').trim().toUpperCase();
        const itemMaterialCode = String(item.materialCode || '').trim();
        const itemPalletNo = String(item.palletNo || '').trim().toUpperCase();
        return itemShipment === normalizedShipmentCode &&
               itemMaterialCode === normalizedMaterialCode &&
               itemPalletNo === normalizedPalletNo &&
               !item.isChecked;
      });
      
      if (finalCheck && finalCheck.id) {
        console.log('⚠️ Found existing item in final check - cộng dồn thay vì tạo mới');
        const isScanningCustomerCode = !finalCheck.customerCode || finalCheck.customerCode !== normalizedCustomerCode;
        const newQty = this.checkMode === 'pn-qty' ? ((finalCheck.quantity || 0) + quantity) : (finalCheck.quantity || 0);
        const newCarton = this.checkMode === 'pn-qty' ? (finalCheck.carton || 0) : ((finalCheck.carton || 0) + 1);
        const updateData = {
          quantity: newQty,
          carton: newCarton,
          shipment: normalizedShipmentCode,
          materialCode: materialCode,
          customerCode: normalizedCustomerCode,
          checkMode: this.checkMode,
          scannedCustomerCode: isScanningCustomerCode ? true : (finalCheck.scannedCustomerCode || false),
          scannedQuantity: this.checkMode === 'pn-qty' && quantity > 0, // Chỉ highlight khi mode PN+QTY
          updatedAt: new Date()
        };
        
        const idsToUpdate = (finalCheck.docIds && finalCheck.docIds.length) ? finalCheck.docIds : [finalCheck.id!];
        const mainId = idsToUpdate[0];
        const restIds = idsToUpdate.slice(1);
      const deleteRest = (): Promise<void> => (restIds.length ? Promise.all(restIds.map(id => this.firestore.collection('fg-check').doc(id).delete())).then(() => undefined) : Promise.resolve()) as Promise<void>;
      this.firestore.collection('fg-check').doc(mainId).update(updateData)
        .then(deleteRest)
        .then(() => {
            console.log('✅ Updated existing item instead of creating duplicate');
            finalCheck.quantity = updateData.quantity;
            finalCheck.carton = updateData.carton;
            finalCheck.customerCode = normalizedCustomerCode;
            finalCheck.scannedCustomerCode = updateData.scannedCustomerCode;
            finalCheck.scannedQuantity = updateData.scannedQuantity;
            finalCheck.id = mainId;
            (finalCheck as any).docIds = undefined;
            this.calculateCheckResults();
            this.applyFilters();
          })
          .catch(error => {
            console.error('❌ Error updating:', error);
          });
        return; // KHÔNG TẠO MỚI NẾU ĐÃ TỒN TẠI
      }
      
      // Thực sự tạo item mới (chỉ khi chắc chắn không trùng)
      const checkId = this.getNextCheckId();
      
      const newItem: FGCheckItem = {
        shipment: normalizedShipmentCode,
        materialCode: materialCode,
        customerCode: normalizedCustomerCode,
        carton: this.checkMode === 'pn-qty' ? 0 : 1, // PN: 1 thùng, PN+QTY: 0
        quantity: this.checkMode === 'pn-qty' ? quantity : 0, // PN: để 0, PN+QTY: ghi số lượng
        isChecked: false,
        checkId: checkId,
        scanId: this.scannedCheckId || undefined,
        checkMode: this.checkMode, // Lưu checkMode của item
        scannedCustomerCode: true, // Đã scan mã hàng
        scannedQuantity: this.checkMode === 'pn-qty' && quantity > 0, // Chỉ highlight khi mode PN+QTY
        isLocked: false, // Mặc định không lock
        palletNo: normalizedPalletNo || '', // Cùng shipment + materialCode + palletNo thì cộng dồn
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      console.log('🔵 New item to save:', newItem);
      this.firestore.collection('fg-check').add(newItem)
        .then((docRef) => {
          console.log('✅ Customer code saved:', normalizedCustomerCode, 'materialCode:', materialCode, `QTY: ${quantity}`, 'checkMode:', this.checkMode);
          newItem.id = docRef.id;
          this.items.push(newItem);
          this.calculateCheckResults();
          this.applyFilters();
        })
        .catch(error => {
          console.error('❌ Error saving:', error);
          alert('❌ Lỗi khi lưu: ' + error.message);
        });
    }
  }

  // Toggle check status
  toggleCheck(item: FGCheckItem): void {
    item.isChecked = !item.isChecked;
    item.updatedAt = new Date();
    
    if (item.id) {
      this.firestore.collection('fg-check').doc(item.id).update({
        isChecked: item.isChecked,
        updatedAt: new Date()
      })
      .then(() => {
        console.log('✅ Check status updated');
      })
      .catch(error => {
        console.error('❌ Error updating check status:', error);
      });
    }
  }

  // Reset dữ liệu đã scan của item về 0 để scan lại
  resetItem(item: FGCheckItem): void {
    if (item.isLocked) {
      alert('⚠️ Không thể reset: Item đã bị lock!');
      return;
    }

    if (!confirm(`Xác nhận reset dữ liệu đã scan?\n\nShipment: ${item.shipment}\nMã TP: ${item.materialCode}\nMã Hàng: ${item.customerCode || '(chưa có)'}\nSố lượng hiện tại: ${item.quantity}\nID Check: ${item.checkId}\n\nDữ liệu sẽ được reset về 0 để scan lại.`)) {
      return;
    }

    const ids = (item.docIds && item.docIds.length) ? item.docIds : (item.id ? [item.id] : []);
    if (ids.length === 0) {
      alert('❌ Không thể reset: Không tìm thấy ID');
      return;
    }

    // Reset tất cả dữ liệu đã scan về 0 (nếu dòng gộp nhiều doc thì reset tất cả)
    const updateData = {
      carton: 0,
      quantity: 0,
      customerCode: '', // Xóa mã hàng đã scan
      scannedCustomerCode: false, // Reset flag đã scan mã hàng
      scannedQuantity: false, // Reset flag đã scan số lượng
      checkResult: null, // Xóa kết quả check
      updatedAt: new Date()
    };

    console.log('🔄 Resetting item:', {
      ids,
      shipment: item.shipment,
      materialCode: item.materialCode,
      currentQuantity: item.quantity,
      currentCustomerCode: item.customerCode
    });

    Promise.all(ids.map(id => this.firestore.collection('fg-check').doc(id).update(updateData)))
      .then(() => {
        // Cập nhật local item
        item.carton = 0;
        item.quantity = 0;
        item.customerCode = '';
        item.scannedCustomerCode = false;
        item.scannedQuantity = false;
        item.checkResult = undefined;
        item.updatedAt = new Date();
        
        console.log('✅ Item reset successfully - all scanned data cleared to 0');
        
        // Recalculate check results và cập nhật bảng
        this.calculateCheckResults();
        this.applyFilters();
        
        // Force change detection để cập nhật UI
        this.cdr.detectChanges();
        
        console.log('✅ Item reset complete - ready to rescan');
      })
      .catch(error => {
        console.error('❌ Error resetting item:', error);
        alert('❌ Lỗi khi reset: ' + error.message);
      });
  }

  // Toggle lock/unlock item (nếu dòng gộp nhiều doc thì cập nhật tất cả)
  toggleLockItem(item: FGCheckItem): void {
    const ids = (item.docIds && item.docIds.length) ? item.docIds : (item.id ? [item.id] : []);
    if (ids.length === 0) {
      alert('❌ Không thể lock: Không tìm thấy ID');
      return;
    }

    const newLockStatus = !item.isLocked;
    const updateData = {
      isLocked: newLockStatus,
      updatedAt: new Date()
    };

    Promise.all(ids.map(id => this.firestore.collection('fg-check').doc(id).update(updateData)))
      .then(() => {
        item.isLocked = newLockStatus;
        item.updatedAt = new Date();
        this.applyFilters();
        this.cdr.detectChanges();
      })
      .catch(error => {
        console.error('❌ Error toggling lock:', error);
        alert('❌ Lỗi khi lock/unlock: ' + error.message);
        item.isLocked = !newLockStatus;
      });
  }

  openUnhideDialog(): void {
    this.unhideShipmentInput = '';
    this.showUnhideDialog = true;
    this.cdr.detectChanges();
    setTimeout(() => {
      const input = document.querySelector('.unhide-shipment-input') as HTMLInputElement;
      if (input) input.focus();
    }, 100);
  }

  closeUnhideDialog(): void {
    this.showUnhideDialog = false;
    this.unhideShipmentInput = '';
    this.cdr.detectChanges();
  }

  confirmUnhideShipment(): void {
    const shipment = String(this.unhideShipmentInput || '').trim().toUpperCase();
    if (!shipment) {
      alert('Vui lòng nhập số Shipment!');
      return;
    }
    this.unhiddenShipments.add(shipment);
    this.applyFilters();
    this.closeUnhideDialog();
    this.cdr.detectChanges();
    alert(`Đã hiển thị Shipment: ${shipment}`);
  }

  unlockShipmentAndClose(): void {
    const shipment = String(this.unhideShipmentInput || '').trim().toUpperCase();
    if (!shipment) {
      alert('Vui lòng nhập số Shipment!');
      return;
    }
    const itemsOfShipment = this.items.filter(item => {
      const s = String(item.shipment || '').trim().toUpperCase();
      return s === shipment && item.isLocked;
    });
    if (itemsOfShipment.length === 0) {
      alert(`Shipment ${shipment} không có dòng nào đang Lock.`);
      return;
    }
    const idsToUpdate: string[] = [];
    itemsOfShipment.forEach(item => {
      const ids = (item.docIds && item.docIds.length) ? item.docIds : (item.id ? [item.id] : []);
      idsToUpdate.push(...ids);
    });
    const uniqueIds = [...new Set(idsToUpdate)];
    Promise.all(uniqueIds.map(id => this.firestore.collection('fg-check').doc(id).update({ isLocked: false, updatedAt: new Date() })))
      .then(() => {
        itemsOfShipment.forEach(item => {
          item.isLocked = false;
          item.updatedAt = new Date();
        });
        this.unhiddenShipments.delete(shipment);
        this.applyFilters();
        this.closeUnhideDialog();
        this.cdr.detectChanges();
        alert(`Đã bỏ Lock cho Shipment ${shipment} (${itemsOfShipment.length} dòng). Shipment sẽ luôn hiển thị.`);
      })
      .catch(error => {
        console.error('❌ Error unlocking shipment:', error);
        alert('❌ Lỗi khi bỏ Lock: ' + (error?.message || error));
      });
  }

  // Update item in Firebase (for Pallet No and other fields)
  updateItemInFirebase(item: FGCheckItem): void {
    if (!item.id) {
      return;
    }

    if (item.isLocked) {
      alert('⚠️ Không thể cập nhật: Item đã bị lock!');
      return;
    }

    const updateData = {
      palletNo: item.palletNo || '',
      updatedAt: new Date()
    };

    this.firestore.collection('fg-check').doc(item.id).update(updateData)
      .then(() => {
        item.updatedAt = new Date();
        console.log('✅ Item updated successfully');
      })
      .catch(error => {
        console.error('❌ Error updating item:', error);
        alert('❌ Lỗi khi cập nhật: ' + error.message);
      });
  }

  /** Mở xóa: chưa lock → confirm rồi xóa; đã lock → mở popup quét mã quản lý. */
  openDeleteConfirm(item: FGCheckItem): void {
    if (!item.isLocked) {
      if (confirm(`Xóa item?\n\nShipment: ${item.shipment} | Mã TP: ${item.materialCode}`)) {
        this.doDeleteItem(item);
      }
      return;
    }
    this.deleteConfirmItem = item;
    this.deleteManagerScanInput = '';
    this.deleteScanFirstCharTime = 0;
    this.showDeleteConfirmPopup = true;
    this.cdr.detectChanges();
    setTimeout(() => {
      const input = document.querySelector('.delete-manager-scan-input') as HTMLInputElement;
      if (input) {
        input.focus();
      }
    }, 100);
  }

  closeDeleteConfirm(): void {
    this.showDeleteConfirmPopup = false;
    this.deleteConfirmItem = null;
    this.deleteManagerScanInput = '';
    this.deleteScanFirstCharTime = 0;
    this.cdr.detectChanges();
  }

  /** Xử lý input quét mã quản lý: chỉ chấp nhận khi quét nhanh (7 ký tự trong < 200ms), không nhập tay. */
  onDeleteManagerScanInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    let raw = (input.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const id7 = raw.substring(0, 7);
    this.deleteManagerScanInput = id7;
    input.value = id7;

    if (id7.length === 1 && this.deleteScanFirstCharTime === 0) {
      this.deleteScanFirstCharTime = Date.now();
    }
    if (id7.length < 7) {
      this.cdr.detectChanges();
      return;
    }

    const elapsed = Date.now() - this.deleteScanFirstCharTime;
    if (elapsed > 200) {
      alert('Chỉ được quét mã, không nhập tay. Vui lòng quét lại.');
      this.deleteManagerScanInput = '';
      this.deleteScanFirstCharTime = 0;
      input.value = '';
      input.focus();
      this.cdr.detectChanges();
      return;
    }

    const valid = this.MANAGER_CODES.includes(id7);
    if (valid && this.deleteConfirmItem) {
      this.doDeleteItem(this.deleteConfirmItem);
      this.closeDeleteConfirm();
    } else {
      alert('Mã quản lý không hợp lệ. Chỉ chấp nhận: ASP0106, ASP0538, ASP0119, ASP1761');
      this.deleteManagerScanInput = '';
      this.deleteScanFirstCharTime = 0;
      input.value = '';
      input.focus();
    }
    this.cdr.detectChanges();
  }

  /** Thực hiện xóa item sau khi đã xác thực mã quản lý. */
  doDeleteItem(item: FGCheckItem): void {
    const ids = (item.docIds && item.docIds.length) ? item.docIds : (item.id ? [item.id] : []);
    if (ids.length === 0) {
      alert('❌ Không thể xóa: Không tìm thấy ID');
      return;
    }
    Promise.all(ids.map(id => this.firestore.collection('fg-check').doc(id).delete()))
      .then(() => {
        const index = this.items.findIndex(i => i.id === item.id || (i.docIds && i.docIds[0] === item.id));
        if (index > -1) {
          this.items.splice(index, 1);
        }
        this.calculateCheckResults();
        this.applyFilters();
        this.cdr.detectChanges();
      })
      .catch(error => {
        console.error('❌ Error deleting item:', error);
        alert('❌ Lỗi khi xóa: ' + error.message);
      });
  }

  deleteItem(item: FGCheckItem): void {
    this.openDeleteConfirm(item);
  }

  // Complete scanning
  completeScanning(): void {
    this.isScanning = false;
    this.scannedShipment = '';
    this.currentScanInput = '';
    this.currentQtyInput = '';
    this.waitingForQty = false;
    
    // Clear filter để hiển thị lại tất cả items
    this.filterByShipment = '';
    this.applyFilters();
    
    alert('✅ Hoàn tất check!');
  }

  // Clear shipment filter - xóa bộ lọc shipment
  clearShipmentFilter(): void {
    this.filterByShipment = '';
    this.applyFilters();
    console.log('✅ Cleared shipment filter - showing all items');
  }

  // Popup More
  openMorePopup(): void {
    this.showMorePopup = true;
    this.cdr.detectChanges();
  }

  closeMorePopup(): void {
    this.showMorePopup = false;
    this.cdr.detectChanges();
  }

  /** Mở dialog chọn tháng/năm để tải báo cáo Check */
  openReportMonthDialog(): void {
    this.closeMorePopup();
    this.reportMonth = new Date().getMonth() + 1;
    this.reportYear = new Date().getFullYear();
    this.showReportMonthDialog = true;
    this.cdr.detectChanges();
  }

  closeReportMonthDialog(): void {
    this.showReportMonthDialog = false;
    this.cdr.detectChanges();
  }

  /** Tải báo cáo Check theo tháng đã chọn (Excel) */
  downloadCheckReportByMonth(): void {
    const itemsInMonth = this.items.filter(item => {
      const d = item.createdAt ? (item.createdAt instanceof Date ? item.createdAt : new Date(item.createdAt)) : null;
      if (!d || isNaN(d.getTime())) return false;
      return d.getMonth() + 1 === this.reportMonth && d.getFullYear() === this.reportYear;
    });
    const rows = itemsInMonth.map((item, i) => ({
      'STT': i + 1,
      'Shipment': item.shipment || '',
      'Mã TP': item.materialCode || '',
      'Mã Hàng': item.customerCode || '',
      'Số Thùng': item.carton ?? 0,
      'Số Lượng': item.quantity ?? 0,
      'ID Check': item.scanId || item.checkId || '',
      'Pallet No': item.palletNo || '',
      'Thời gian': item.createdAt ? this.formatCheckTime(item.createdAt) : '',
      'Lock': item.isLocked ? 'Có' : 'Không'
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'FG Check');
    const fileName = `Bao_cao_Check_${this.reportYear}_${String(this.reportMonth).padStart(2, '0')}.xlsx`;
    XLSX.writeFile(wb, fileName);
    this.closeReportMonthDialog();
    alert(`✅ Đã tải báo cáo: ${itemsInMonth.length} dòng (Tháng ${this.reportMonth}/${this.reportYear})`);
    this.cdr.detectChanges();
  }
}