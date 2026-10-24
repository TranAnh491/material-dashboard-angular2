import { Component, OnInit, OnDestroy, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { forkJoin, Subject } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import { TpCatalogFullService } from '../../services/tp-catalog-full.service';


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
  checkMode?: 'pn' | 'pn-qty' | 'pn-qty-axone'; // Lưu mode check của item
  shipmentCarton?: number; // Số thùng Shipment từ tab shipment
  shipmentQuantity?: number; // Lượng Shipment từ tab shipment
  poShip?: string; // PO Ship để phân biệt các dòng cùng materialCode
  factory?: string; // Nhà máy: ASM1, ASM2, ASM3 (từ tab Shipment)
  checkResult?: 'Đúng' | 'Sai'; // Kết quả check
  scannedCustomerCode?: boolean; // Đã scan mã hàng (highlight xanh)
  scannedQuantity?: boolean; // Đã scan số lượng (highlight xanh)
  isLocked?: boolean; // Lock dữ liệu
  palletNo?: string; // Số Pallet
  docIds?: string[]; // Nhiều doc Firebase gộp lại (cùng shipment + materialCode + palletNo)
  createdAt?: Date;
  updatedAt?: Date;
  /** Cache UI — gán trong applyFilters(), không gọi hàm format trong template. */
  display?: FGCheckItemDisplay;
}

export interface ShipmentData {
  shipmentCode: string;
  materialCode: string;
  quantity: number; // Lượng Xuất
  carton: number;
  qtyBox?: number; // Số lượng trong 1 thùng - dùng để tính số thùng = quantity / qtyBox
  poShip?: string; // PO Ship để phân biệt các dòng cùng materialCode
  factory?: string;
}

export interface ShipmentDisplayItem {
  materialCode: string;
  quantity: number; // Lượng Xuất từ shipment
  carton: number;
  customerCode?: string; // Mã khách hàng (nếu có mapping)
  factory?: string;
}

export interface FactoryItemGroup {
  factory: string;
  items: FGCheckItem[];
}

/** Trường hiển thị tính sẵn — tránh gọi hàm trong template mỗi change detection cycle. */
export interface FGCheckItemDisplay {
  time: string;
  carton: number;
  cartonText: string;
  quantityText: string;
  checkTypeLabel: 'Thùng' | 'Lượng' | 'Lượng Axone';
  checkNote: string;
  isDuplicate: boolean;
  isCartonOk: boolean;
}

export type FgCheckTableRow =
  | { kind: 'factory-header'; factory: string; count: number; key: string }
  | { kind: 'item'; item: FGCheckItem; rowNo: number; key: string };

export interface ShipmentCheckBoxItem {
  shipmentCode: string;
  status: string;
  palletCount: number;
}

@Component({
  selector: 'app-fg-check',
  templateUrl: './fg-check.component.html',
  styleUrls: ['./fg-check.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FGCheckComponent implements OnInit, OnDestroy {
  items: FGCheckItem[] = [];
  filteredItems: FGCheckItem[] = [];
  /** Cache của getFilteredItemsGroupedByFactory() — tính lại trong applyFilters(), KHÔNG gọi hàm
   * trực tiếp trong *ngFor (Angular re-chạy expression trong template mỗi change detection cycle,
   * gọi thẳng hàm group+sort ở đó khiến trang càng nhiều dữ liệu càng chậm). */
  groupedFilteredItems: FactoryItemGroup[] = [];
  /** Danh sách phẳng cho virtual scroll (header factory + dòng dữ liệu). */
  flatTableRows: FgCheckTableRow[] = [];
  tableColspan = 13;
  /** Cache "shipment|materialCode" bị trùng — tính 1 lần trong applyFilters() thay vì filter lại
   * toàn bộ this.items cho MỖI dòng mỗi lần render (isDuplicateMaterialCode cũ là O(n²)/cycle). */
  private duplicateShipmentMaterialKeys = new Set<string>();

  // Search
  searchTerm: string = '';
  
  // Scanner properties
  showCheckDialog: boolean = false;
  checkDialogStep: 'mode' | 'form' = 'mode'; // Trong dialog: chọn mode trước, sau đó nhập ID/Shipment/Pallet
  checkStep: number = 0; // 0 = select mode, 1 = shipment input, 2 = scan pallet, 3 = scan material+qty
  checkMode: 'pn' | 'pn-qty' | 'pn-qty-axone' = 'pn';
  /** Check Lượng Axone: mỗi thùng quét tem nội bộ rồi tem khách. */
  axonePhase: 'internal' | 'customer' = 'internal';
  axoneInternal: { materialCode: string; qty: number } | null = null;
  axoneStatus = '';
  axoneStatusOk: boolean | null = null;
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
  
  // Customer code mapping — 1 Mã KH có thể khớp nhiều Mã TP trong danh mục (nhiều dòng cùng
  // Mã S.Phẩm KH), nên lưu TẤT CẢ ứng viên rồi đối chiếu với shipment đang scan để chọn đúng mã.
  customerMappings: Map<string, string[]> = new Map(); // customerCode -> materialCode[]
  
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

  // Shipment Check – scan pallet
  showShipmentCheckDialog: boolean = false;
  shipmentCheckCode: string = '';          // Số shipment đang check
  shipmentCheckScanInput: string = '';     // Ô scan pallet
  shipmentCheckPallets: string[] = [];     // Danh sách mã pallet kỳ vọng
  shipmentCheckBoxes: ShipmentCheckBoxItem[] = [];
  shipmentCheckResults: Array<{
    palletCode: string;
    status: 'pending' | 'ok' | 'error';
  }> = [];
  shipmentCheckLoading: boolean = false;
  shipmentCheckLastResult: 'ok' | 'error' | null = null;
  shipmentCheckLastScanned: string = '';
  private shipmentCheckScanFirstChar: number = 0;

  /** Firestore: lịch sử quét Shipment Check (pallet) */
  private readonly SHIPMENT_CHECK_LOGS = 'shipment-check-logs';

  // Popup xóa: quét mã quản lý (chỉ scan)
  private readonly MANAGER_CODES = ['ASP0106', 'ASP0538', 'ASP0119', 'ASP1761'];
  showDeleteConfirmPopup: boolean = false;
  deleteConfirmItem: FGCheckItem | null = null;
  deleteManagerScanInput: string = '';
  private deleteScanFirstCharTime: number = 0;
  
  private destroy$ = new Subject<void>();
  private searchInput$ = new Subject<string>();
  isLoading: boolean = false;
  checkIdCounter: number = 1;
  /** Đã search nhưng không có trong dữ liệu gần đây. */
  olderFgOffer = false;
  olderFgSearching = false;
  shipmentCheckQuery = '';
  shipmentCheckOlderHint = false;

  /** Thứ tự hiển thị nhóm Factory trên bảng */
  private readonly factoryDisplayOrder = ['ASM1', 'ASM2', 'ASM3'];

  constructor(
    private firestore: AngularFirestore,
    private cdr: ChangeDetectorRef,
    private tpCatalogService: TpCatalogFullService,
    private router: Router,
    private location: Location
  ) {}

  /** trackBy: giữ DOM dòng khi danh sách đổi, tránh render lại toàn bảng. */
  trackById = (index: number, item: { id?: string } | null | undefined): string | number => item?.id ?? index;

  ngOnInit(): void {
    this.updateTableColspan();
    this.searchInput$
      .pipe(debounceTime(300), takeUntil(this.destroy$))
      .subscribe((term) => {
        this.searchTerm = term;
        this.applyFilters();
        this.olderFgOffer = !!String(term || '').trim() && this.filteredItems.length === 0 && !this.olderFgSearching;
        this.cdr.markForCheck();
      });
    this.loadItemsFromFirebase();
    this.loadCustomerMappings();
    this.loadLastCheckId();
    this.loadShipmentData();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  goBack(): void {
    this.location.back();
  }

  goToMenu(): void {
    this.router.navigate(['/menu']);
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

  private fgRecentCutoff(): Date {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    return cutoff;
  }

  // Load items from Firebase — 30 ngày gần nhất. Shipment cũ hơn: nhập số rồi bấm Tìm cũ hơn.
  loadItemsFromFirebase(): void {
    this.isLoading = true;
    const cutoff = this.fgRecentCutoff();

    void this.firestore.collection('fg-check', ref =>
      ref.where('updatedAt', '>=', cutoff).limit(3000)
    ).get().toPromise().then((snap) => {
        const merged = {
          docs: (snap?.docs || []).map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> }))
        };
        const firebaseItems = merged.docs.map((doc) => {
          const data = doc.data as any;
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
            factory: data.factory || '',
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
        
        // Gộp dòng: cùng shipment + materialCode + palletNo + factory thì cộng dồn
        this.items = this.mergeItemsByShipmentMaterialPallet(firebaseItems);
        this.enrichItemsFactory();
        this.itemsLoaded = true;
        this.isLoading = false;
        
        // Calculate check results if shipment data is already loaded
        if (this.shipmentDataLoaded) {
          this.calculateCheckResults();
        }
        this.applyFilters();
        this.cdr.markForCheck();
      }).catch((e) => {
        console.error('loadItemsFromFirebase failed', e);
        this.isLoading = false;
        this.cdr.markForCheck();
      });
  }

  /** Gộp các dòng cùng shipment + materialCode + palletNo: cộng dồn quantity và carton thành một dòng. */
  private mergeItemsByShipmentMaterialPallet(rawItems: FGCheckItem[]): FGCheckItem[] {
    const key = (item: FGCheckItem) => {
      const s = String(item.shipment || '').trim().toUpperCase();
      const m = String(item.materialCode || '').trim().toUpperCase();
      const p = String(item.palletNo || '').trim().toUpperCase();
      const f = this.normalizeFactory(item.factory || this.resolveItemFactory(item));
      return `${s}|${m}|${p}|${f}`;
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

  // Load customer code mappings — chỉ đọc Danh mục TP (`fg-catalog`) trên
  // /danh-muc-nvl-tp. Không dùng `fg-customer-mapping`.
  loadCustomerMappings(): void {
    this.tpCatalogService
      .getCatalogItemsCached()
      .then(items => {
        this.customerMappings.clear();
        items.forEach(item => {
          const key = String(item.customerCode || '').trim().toUpperCase();
          const materialCode = String(item.materialCode || '').trim();
          if (!key || !materialCode) return;
          const list = this.customerMappings.get(key) || [];
          if (!list.includes(materialCode)) list.push(materialCode);
          this.customerMappings.set(key, list);
        });
        this.cdr.detectChanges();
      })
      .catch(err => console.error('Load danh mục TP failed:', err));
  }

  loadShipmentData(): void {
    const cutoff = this.fgRecentCutoff();
    forkJoin([
      this.firestore.collection('shipments', ref =>
        ref.where('requestDate', '>=', cutoff).limit(5000)
      ).get(),
      this.firestore.collection('shipments', ref =>
        ref.where('requestDate', '==', null).limit(500)
      ).get()
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([recentSnap, nullDateSnap]) => {
        this.shipmentDataMap.clear();
        this.ingestShipmentOrderDocs([...recentSnap.docs, ...nullDateSnap.docs]);
        
        
        this.shipmentDataLoaded = true;
        
        if (this.itemsLoaded) {
          this.enrichItemsFactory();
          this.calculateCheckResults();
        }
        this.cdr.markForCheck();
      });
  }

  private ingestShipmentOrderDocs(docs: Array<{ data: () => any }>): void {
        docs.forEach(doc => {
          const data = doc.data() as any;
          // Normalize shipmentCode và materialCode: trim và uppercase cho shipmentCode
          // LƯU CẢ PO SHIP ĐỂ PHÂN BIỆT CÁC DÒNG CÙNG MATERIALCODE
          const shipmentCode = String(data.shipmentCode || '').trim().toUpperCase();
          const materialCode = String(data.materialCode || '').trim(); // Mã TP - không uppercase để giữ nguyên format
          const quantity = parseFloat(data.quantity) || 0; // Lượng Xuất
          const carton = parseFloat(data.carton) || 0;
          const qtyBox = parseFloat(data.qtyBox) || 0; // Số lượng trong 1 thùng (tab Shipment)
          const poShip = String(data.poShip || '').trim(); // PO Ship để phân biệt
          const factory = this.normalizeFactory(data.factory || 'ASM1');
          
          // CHỈ LƯU KHI CÓ ĐỦ shipmentCode VÀ materialCode
          if (shipmentCode && materialCode) {
            if (!this.shipmentDataMap.has(shipmentCode)) {
              this.shipmentDataMap.set(shipmentCode, []);
            }
            
            // Lưu theo shipmentCode, mỗi shipmentCode có thể có nhiều materialCode
            // VÀ mỗi materialCode có thể có nhiều PO Ship / Factory (nhiều dòng)
            this.shipmentDataMap.get(shipmentCode)!.push({
              shipmentCode: shipmentCode,
              materialCode: materialCode, // Mã TP
              quantity: quantity,
              carton: carton,
              qtyBox: qtyBox, // Để tính số thùng = quantity / qtyBox
              poShip: poShip, // PO Ship để phân biệt
              factory
            });
          }
        });
  }

  // Force reload shipment data and recalculate
  forceReloadShipmentData(): void {
    this.shipmentDataLoaded = false;
    this.loadShipmentData();
  }

  // Force save shipmentQuantity/shipmentCarton to Firebase for all items (không so sánh đúng/sai)
  forceSaveCheckResults(): void {
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
        }).catch(error => {
          errorCount++;
          console.error(`❌ Error saving ${item.checkId}:`, error);
        });
      }
      return Promise.resolve();
    });
    
    Promise.all(savePromises).then(() => {
      alert(`✅ Force Save hoàn tất!\n\n- Đã lưu: ${savedCount} items\n- Lỗi: ${errorCount} items`);
    });
  }

  // Debug shipment data - hiển thị thông tin chi tiết
  debugShipmentData(): void {
    
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
      const itemFactory = this.normalizeFactory(item.factory || this.resolveItemFactory(item));
      if (!item.factory) {
        item.factory = itemFactory;
      }
      const matchingShipment =
        shipmentDataList.find(
          s =>
            String(s.materialCode || '').trim() === materialCode &&
            this.normalizeFactory(s.factory) === itemFactory &&
            (!item.poShip || String(s.poShip || '').trim() === String(item.poShip || '').trim())
        ) ||
        shipmentDataList.find(
          s =>
            String(s.materialCode || '').trim() === materialCode &&
            this.normalizeFactory(s.factory) === itemFactory
        ) ||
        shipmentDataList.find(s => String(s.materialCode || '').trim() === materialCode);
      if (!matchingShipment) {
        item.shipmentQuantity = 0;
        return;
      }

      item.shipmentCarton = matchingShipment.carton;
      item.shipmentQuantity = matchingShipment.quantity;
      item.factory = this.normalizeFactory(matchingShipment.factory || itemFactory);
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

  /** Hiển thị Loại check: Thùng (pn), Lượng (pn-qty), Lượng Axone (pn-qty-axone). */
  getCheckTypeLabel(item: FGCheckItem): 'Thùng' | 'Lượng' | 'Lượng Axone' {
    const mode = item.checkMode || this.checkMode;
    if (mode === 'pn') return 'Thùng';
    if (mode === 'pn-qty-axone') return 'Lượng Axone';
    return 'Lượng';
  }

  /** Đổi loại check của item và lưu Firebase. */
  onCheckTypeChange(item: FGCheckItem, label: string): void {
    if (item.isLocked) return;
    const newMode: 'pn' | 'pn-qty' | 'pn-qty-axone' =
      label === 'Lượng Axone' ? 'pn-qty-axone' : label === 'Lượng' ? 'pn-qty' : 'pn';
    if ((item.checkMode || this.checkMode) === newMode) return;
    item.checkMode = newMode;
    if (!item.id) return;
    this.firestore.collection('fg-check').doc(item.id).update({
      checkMode: newMode,
      updatedAt: new Date()
    }).then(() => {
      this.calculateCheckResults();
      this.applyFilters();
      this.cdr.detectChanges();
    }).catch(err => {
      console.error('Lỗi cập nhật Loại check:', err);
      alert('Lỗi cập nhật Loại check: ' + (err?.message || err));
    });
  }

  /** Ghi chú cảnh báo: Mã TP đã scan không có trong tab Shipment (cùng shipment). */
  getCheckNote(item: FGCheckItem): string {
    const shipmentCode = String(item.shipment || '').trim().toUpperCase();
    const materialCode = String(item.materialCode || '').trim();
    if (!shipmentCode || !materialCode) return '';
    const list = this.shipmentDataMap.get(shipmentCode) || [];
    const hasInShipment = list.some(s => String(s.materialCode || '').trim() === materialCode);
    if (!hasInShipment) return 'Mã TP không có trong Shipment';
    return '';
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
    
    if (checkMode === 'pn-qty' || checkMode === 'pn-qty-axone') {
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

  // Get material code from customer code — 1 Mã KH có thể khớp nhiều Mã TP trong danh mục,
  // nên khi có nhiều ứng viên phải đối chiếu với shipment đang scan để chọn đúng mã. Không mã
  // nào khớp danh mục / khớp shipment → trả '' để nơi gọi báo "không có".
  getMaterialCodeFromCustomerCode(customerCode: string): string {
    // Normalize customerCode: uppercase and trim for lookup
    const normalizedCustomerCode = String(customerCode).trim().toUpperCase();
    const candidates = this.customerMappings.get(normalizedCustomerCode) || [];

    if (candidates.length === 0) {
      console.warn(`⚠️ No mapping found for customerCode: "${customerCode}" (normalized: "${normalizedCustomerCode}")`);
      return '';
    }

    if (candidates.length === 1) {
      return candidates[0];
    }

    // Nhiều Mã TP cùng Mã KH trong danh mục — chọn mã có mặt trong shipment đang scan
    const shipmentCode = String(this.scannedShipment || '').trim().toUpperCase();
    const shipmentMaterialCodes = new Set(
      (this.shipmentDataMap.get(shipmentCode) || []).map(item => String(item.materialCode || '').trim().toUpperCase())
    );
    const matched = candidates.find(mc => shipmentMaterialCodes.has(mc.trim().toUpperCase()));

    if (matched) {
      return matched;
    }

    console.warn(
      `⚠️ Mã KH "${normalizedCustomerCode}" có ${candidates.length} Mã TP trong danh mục (${candidates.join(', ')}) nhưng KHÔNG mã nào khớp shipment "${shipmentCode}"`
    );
    return '';
  }

  // Reload mapping and update material codes for existing items
  reloadMappingAndUpdate(): void {
    
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
  /** Chưa tìm kiếm và chưa chọn shipment để check → không tự hiện lô hàng nào. */
  private get hasActiveQuery(): boolean {
    return !!String(this.searchTerm || '').trim() || !!String(this.filterByShipment || '').trim();
  }

  applyFilters(): void {
    this.filteredItems = !this.hasActiveQuery ? [] : this.items.filter(item => {
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
        item.checkId,
        this.resolveItemFactory(item)
      ].filter(Boolean).join(' ').toUpperCase();
      return searchableText.includes(this.searchTerm.toUpperCase());
    });
    
    // Sắp xếp: 1) Factory, 2) Shipment, 3) Mã TP
    this.filteredItems.sort((a, b) => {
      const factoryCompare = this.resolveItemFactory(a).localeCompare(this.resolveItemFactory(b));
      if (factoryCompare !== 0) {
        return factoryCompare;
      }
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

    this.recomputeDuplicateMaterialCodeKeys();
    this.groupedFilteredItems = this.getFilteredItemsGroupedByFactory();
    for (const item of this.filteredItems) {
      this.computeItemDisplayFields(item);
    }
    this.rebuildFlatTableRows();
  }

  private computeItemDisplayFields(item: FGCheckItem): void {
    const carton = this.getDisplayCarton(item);
    item.display = {
      time: this.formatCheckTime(item.createdAt),
      carton,
      cartonText: this.formatNumber(carton),
      quantityText: this.formatNumber(item.quantity),
      checkTypeLabel: this.getCheckTypeLabel(item),
      checkNote: this.getCheckNote(item),
      isDuplicate: this.isDuplicateMaterialCode(item),
      isCartonOk: this.isCartonOk(item)
    };
  }

  private rebuildFlatTableRows(): void {
    const rows: FgCheckTableRow[] = [];
    for (const group of this.groupedFilteredItems) {
      rows.push({
        kind: 'factory-header',
        factory: group.factory,
        count: group.items.length,
        key: `header-${group.factory}`
      });
      group.items.forEach((item, index) => {
        rows.push({
          kind: 'item',
          item,
          rowNo: index + 1,
          key: item.id || `${group.factory}-${item.checkId || index}-${item.materialCode}`
        });
      });
    }
    this.flatTableRows = rows;
  }

  updateTableColspan(): void {
    this.tableColspan = this.checkMode === 'pn-qty' ? 12 : 13;
  }

  /** Tính 1 lần các cặp "shipment|materialCode" bị trùng (thay vì filter toàn bộ items mỗi dòng mỗi lần render). */
  private recomputeDuplicateMaterialCodeKeys(): void {
    const counts = new Map<string, number>();
    for (const item of this.items) {
      const s = String(item.shipment || '').trim().toUpperCase();
      const m = String(item.materialCode || '').trim();
      if (!s || !m) continue;
      const key = `${s}|${m}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    this.duplicateShipmentMaterialKeys = new Set(
      Array.from(counts.entries()).filter(([, c]) => c > 1).map(([k]) => k)
    );
  }

  normalizeFactory(factory: string | undefined): string {
    const f = String(factory || '').trim().toUpperCase();
    return f || 'ASM1';
  }

  /** Bổ sung factory từ tab Shipment nếu doc fg-check chưa có */
  private enrichItemsFactory(): void {
    this.items.forEach(item => {
      if (!item.factory) {
        item.factory = this.resolveItemFactory(item);
      } else {
        item.factory = this.normalizeFactory(item.factory);
      }
    });
  }

  resolveItemFactory(item: FGCheckItem): string {
    if (item.factory) {
      return this.normalizeFactory(item.factory);
    }
    return this.getFactoryForMaterialInShipment(
      String(item.shipment || '').trim().toUpperCase(),
      String(item.materialCode || '').trim(),
      String(item.poShip || '').trim()
    );
  }

  getFactoryForMaterialInShipment(shipmentCode: string, materialCode: string, poShip?: string): string {
    const list = this.shipmentDataMap.get(shipmentCode) || [];
    const mat = String(materialCode || '').trim();
    if (!shipmentCode || !mat) {
      return 'ASM1';
    }
    let matches = list.filter(s => String(s.materialCode || '').trim() === mat);
    const ps = String(poShip || '').trim();
    if (ps) {
      const byPo = matches.filter(s => String(s.poShip || '').trim() === ps);
      if (byPo.length) {
        matches = byPo;
      }
    }
    if (!matches.length) {
      return 'ASM1';
    }
    return this.normalizeFactory(matches[0].factory);
  }

  getTableColspan(): number {
    return this.tableColspan;
  }

  /** Chia bảng theo Factory (ASM1 / ASM2 / …) để dễ nhìn */
  getFilteredItemsGroupedByFactory(): FactoryItemGroup[] {
    const groups = new Map<string, FGCheckItem[]>();
    for (const item of this.filteredItems) {
      const factory = this.resolveItemFactory(item);
      if (!groups.has(factory)) {
        groups.set(factory, []);
      }
      groups.get(factory)!.push(item);
    }

    const orderIndex = (f: string): number => {
      const i = this.factoryDisplayOrder.indexOf(f);
      return i >= 0 ? i : this.factoryDisplayOrder.length + f.charCodeAt(0);
    };

    return Array.from(groups.entries())
      .map(([factory, items]) => ({ factory, items }))
      .sort((a, b) => orderIndex(a.factory) - orderIndex(b.factory) || a.factory.localeCompare(b.factory));
  }

  trackByFactoryGroup(_index: number, group: FactoryItemGroup): string {
    return group.factory;
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

    this.searchInput$.next(searchTerm);
  }

  /** Không có trong 30 ngày đã tải: đọc đúng số shipment trên Firestore. */
  searchOlderFgCheck(): void {
    const raw = String(this.searchTerm || '').trim();
    const code = raw.toUpperCase();
    if (!code || this.olderFgSearching) return;
    const values = Array.from(new Set([raw, code]));
    this.olderFgSearching = true;
    this.olderFgOffer = false;
    forkJoin([
      this.firestore.collection('fg-check', ref =>
        ref.where('shipment', 'in', values).limit(500)
      ).get(),
      this.firestore.collection('shipments', ref =>
        ref.where('shipmentCode', 'in', values).limit(200)
      ).get()
    ]).pipe(takeUntil(this.destroy$)).subscribe({
      next: ([checkSnap, shipSnap]) => {
        this.olderFgSearching = false;
        const checkDocs = checkSnap.docs || [];
        if (!this.shipmentDataMap.has(code) && (shipSnap.docs || []).length) {
          this.ingestShipmentOrderDocs(shipSnap.docs);
          this.shipmentDataLoaded = true;
        }
        if (!checkDocs.length) {
          alert('Không tìm thấy shipment này.');
          this.olderFgOffer = true;
          this.cdr.markForCheck();
          return;
        }
        const existingIds = new Set<string>();
        this.items.forEach((item) => {
          if (item.id) existingIds.add(item.id);
          (item.docIds || []).forEach((id) => existingIds.add(id));
        });
        const fresh = checkDocs
          .filter((doc) => !existingIds.has(doc.id))
          .map((doc) => this.mapFgCheckDoc(doc.id, doc.data() as any));
        if (fresh.length) {
          this.items = [...this.items, ...this.mergeItemsByShipmentMaterialPallet(fresh)];
          this.enrichItemsFactory();
          if (this.shipmentDataLoaded) this.calculateCheckResults();
        }
        this.unhiddenShipments.add(code);
        this.applyFilters();
        this.olderFgOffer = this.filteredItems.length === 0;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('searchOlderFgCheck', err);
        this.olderFgSearching = false;
        this.olderFgOffer = true;
        alert('Không tìm được shipment cũ. Vui lòng thử lại.');
        this.cdr.markForCheck();
      }
    });
  }

  private mapFgCheckDoc(id: string, data: any): FGCheckItem {
    return {
      id,
      shipment: data.shipment || '',
      materialCode: data.materialCode || '',
      customerCode: data.customerCode || '',
      carton: data.carton || 0,
      quantity: data.quantity || 0,
      isChecked: data.isChecked || false,
      checkId: data.checkId || '',
      scanId: data.scanId || undefined,
      checkMode: data.checkMode || 'pn',
      scannedCustomerCode: data.scannedCustomerCode || false,
      scannedQuantity: data.scannedQuantity || false,
      isLocked: data.isLocked || false,
      palletNo: data.palletNo || '',
      shipmentCarton: data.shipmentCarton || 0,
      shipmentQuantity: data.shipmentQuantity || 0,
      poShip: data.poShip || '',
      factory: data.factory || '',
      checkResult: data.checkResult || undefined,
      createdAt: data.createdAt ? new Date(data.createdAt.seconds * 1000) : new Date(),
      updatedAt: data.updatedAt ? new Date(data.updatedAt.seconds * 1000) : new Date()
    };
  }

  // Format number
  formatNumber(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '0';
    }
    return value.toLocaleString('vi-VN');
  }

  // Kiểm tra xem mã TP có trùng trong cùng shipment không (tra cache, không quét lại this.items).
  isDuplicateMaterialCode(item: FGCheckItem): boolean {
    const itemShipment = String(item.shipment || '').trim().toUpperCase();
    const itemMaterialCode = String(item.materialCode || '').trim();
    if (!itemShipment || !itemMaterialCode) {
      return false;
    }
    return this.duplicateShipmentMaterialKeys.has(`${itemShipment}|${itemMaterialCode}`);
  }

  // Check Methods
  openCheck(): void {
    this.resetCheck();
    this.checkDialogStep = 'mode';
    this.showCheckDialog = true;
    this.cdr.detectChanges();
  }

  /** Chọn mode Check Thùng, Check Số Lượng hoặc Check Lượng Axone. */
  selectCheckMode(mode: 'pn' | 'pn-qty' | 'pn-qty-axone'): void {
    this.checkMode = mode;
    this.updateTableColspan();
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
    
    
    // Đóng popup
    this.showCheckDialog = false;
    
    // Chuyển sang step 3 (scan mã TP; nếu Check Số Lượng thì thêm scan số lượng)
    this.checkStep = 3;
    // Giữ checkMode đã chọn (pn = Check Thùng, pn-qty = Check Số Lượng)
    
    this.cdr.detectChanges();
    
    // Focus vào input scan mã TP sau khi popup đóng
    setTimeout(() => {
      const selector = this.checkMode === 'pn-qty-axone' ? '.scan-axone-input' : '.scan-material-input';
      const input = document.querySelector(selector) as HTMLInputElement;
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
    this.axonePhase = 'internal';
    this.axoneInternal = null;
    this.axoneStatus = '';
    this.axoneStatusOk = null;
    this.isScanning = false;
    this.scannedItems = []; // Reset danh sách scan tạm thời
    this.currentShipmentItems = []; // Reset danh sách shipment items
    
    // Clear filter khi reset
    this.filterByShipment = '';
    this.applyFilters();
  }

  // Select check mode
  selectModeAndContinue(mode: 'pn' | 'pn-qty'): void {
    
    try {
      // Update values immediately
      this.checkMode = mode;
      this.scannedShipment = '0001'; // Default test shipment
      this.checkStep = 1;
      
      
      // Recalculate check results when mode changes
      this.calculateCheckResults();
      
      // Force change detection
      this.cdr.detectChanges();
      
      
      // Focus input after view updates
      setTimeout(() => {
        const input = document.querySelector('.check-shipment-input') as HTMLInputElement;
        if (input) {
          input.focus();
          input.select();
        } else {
        }
      }, 100);
    } catch (error) {
      console.error('❌ Error in selectModeAndContinue:', error);
    }
  }

  onShipmentEntered(): void {
    const shipmentCode = String(this.scannedShipment || '').trim().toUpperCase();
    if (!shipmentCode) return;
    
    
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
      this.scanAlert('⚠️ Vui lòng nhập mã hàng!');
      return;
    }
    const materialCode = this.getMaterialCodeFromCustomerCode(customerCode);
    if (!materialCode) {
      this.scanAlert(`⚠️ Không tìm thấy Mã TP cho mã hàng "${customerCode}". Vui lòng kiểm tra mapping!`);
      this.currentScanInput = '';
      return;
    }
    this.scannedItems.push({ materialCode, quantity: 1, customerCode } as any); // quantity 1 = 1 lần scan = 1 thùng
    this.scanOk(materialCode, customerCode, 1);
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
      this.scanAlert('⚠️ Vui lòng nhập mã hàng!');
      return;
    }
    
    const customerCode = String(this.currentScanInput.trim()).toUpperCase();
    const qtyValue = this.currentQtyInput.trim();
    
    // Parse số lượng
    const cleanQtyValue = qtyValue.replace(/[^\d]/g, '');
    const quantity = cleanQtyValue ? parseInt(cleanQtyValue, 10) : 0;
    
    if (!customerCode) {
      this.scanAlert('⚠️ Vui lòng nhập mã hàng!');
      return;
    }
    
    if (quantity <= 0) {
      this.scanAlert('⚠️ Số lượng phải lớn hơn 0!');
      return;
    }
    
    // Tìm mã TP từ mã hàng
    const materialCode = this.getMaterialCodeFromCustomerCode(customerCode);
    
    if (!materialCode) {
      this.scanAlert(`⚠️ Không tìm thấy Mã TP cho mã hàng "${customerCode}".\n\nVui lòng kiểm tra lại mapping trong danh mục!`);
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
    this.scanOk(materialCode, customerCode, quantity);
    
    
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

  /**
   * Tem nội bộ Axone: P030089_C|120|20261013M007|C
   * ô 1 = mã TP, ô 2 = số pcs.
   */
  /** Mã TP trong tem nội bộ: P/T/M/L + 6 số, có thể kèm _suffix. Bỏ phần đứng trước. */
  private extractAxoneMaterialCode(field: string): string {
    const text = String(field || '').trim().toUpperCase();
    const matches = text.match(/[PTML]\d{6}(?:_[A-Z0-9]+)?/g);
    if (matches && matches.length) return matches[matches.length - 1];
    return text;
  }

  private parseAxoneInternalQr(raw: string): { materialCode: string; qty: number } | null {
    const parts = String(raw || '').trim().split('|').map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const materialCode = this.extractAxoneMaterialCode(parts[0]);
    if (!/^\d+$/.test(parts[1])) return null;
    const qty = parseInt(parts[1], 10);
    if (!materialCode || !Number.isFinite(qty) || qty <= 0) return null;
    return { materialCode, qty };
  }

  /** Đang chờ tem khách mà quét lại tem nội bộ (MãTP|pcs|lot|...) thì nhận thùng mới. */
  private isAxoneInternalRescan(raw: string): boolean {
    const parts = String(raw || '').trim().split('|').map((p) => p.trim()).filter(Boolean);
    if (parts.length < 3 || !/^\d+$/.test(parts[1])) return false;
    return /[PTML]\d{6}/i.test(parts[0]);
  }

  /**
   * Tem khách Check Lượng Axone: chỉ lấy mã KH (bỏ phần trong ngoặc) để dò mã TP.
   * T01134 (H100X75) và T01134 (120X75) đều là mã KH T01134. Tem này không có lượng.
   */
  private parseAxoneCustomerCode(raw: string): string {
    const text = String(raw || '').trim().toUpperCase();
    if (!text) return '';
    const lead = (text.match(/^([A-Z0-9][A-Z0-9._-]*)/)?.[1] || '').trim();
    if (!lead) return '';
    for (const key of Array.from(this.customerMappings.keys())) {
      if (key === lead || key.startsWith(lead + ' ') || key.startsWith(lead + '(')) return lead;
    }
    return lead;
  }

  /** Mã KH khớp mã TP khi danh mục có key đúng mã KH, hoặc key bắt đầu bằng mã KH rồi tới kích thước. */
  private customerCodeMatchesMaterial(customerCode: string, materialCode: string): boolean {
    const code = String(customerCode || '').trim().toUpperCase();
    const target = String(materialCode || '').trim().toUpperCase();
    if (!code || !target) return false;
    const materials: string[] = [];
    this.customerMappings.forEach((list, key) => {
      if (key !== code && !key.startsWith(code + ' ') && !key.startsWith(code + '(')) return;
      for (const m of list) {
        const mc = String(m || '').trim().toUpperCase();
        if (mc && !materials.includes(mc)) materials.push(mc);
      }
    });
    return materials.some((c) => c === target || this.extractAxoneMaterialCode(c) === target);
  }

  private focusAxoneInput(): void {
    setTimeout(() => {
      const input = document.querySelector('.scan-axone-input') as HTMLInputElement;
      if (input) {
        input.focus();
        input.select();
      }
    }, 80);
  }

  /**
   * Check Lượng Axone, mỗi thùng:
   * tem nội bộ = mã TP + lượng; tem khách = mã KH để dò mã TP.
   * Khớp mã thì ghi lượng của tem nội bộ, rồi quét thùng mới.
   */
  // ===== Bảng scan máy tính (giống Outbound): báo màu + âm thanh, nhận diện mã, tiến độ shipment =====
  scanFlash: { kind: 'ok' | 'err'; text: string } | null = null;
  scanIdentity: { code: string; customer: string; qty: number; pallet: string; tags: Array<{ text: string; tone: 'red' | 'amber' | 'blue' | 'gray' }> } | null = null;
  private scanAudioCtx: AudioContext | null = null;

  private get isDesktopScan(): boolean {
    return typeof window !== 'undefined' && window.innerWidth >= 900;
  }

  /** Lỗi khi scan: máy tính báo đỏ + 2 tiếng bíp (không chặn); điện thoại vẫn hộp thoại như cũ. */
  private scanAlert(msg: string): void {
    this.playScanBeep(false);
    if (this.isDesktopScan) {
      this.scanFlash = { kind: 'err', text: String(msg || '').replace(/^⚠️\s*/, '') };
      this.cdr.detectChanges();
    } else {
      alert(msg);
    }
  }

  private scanOk(materialCode: string, customerCode: string, qty: number): void {
    this.playScanBeep(true);
    const code = String(materialCode || '').trim().toUpperCase();
    const row = this.fgScanProgress.find((r) => r.code === code);
    const tags: Array<{ text: string; tone: 'red' | 'amber' | 'blue' | 'gray' }> = [];
    if (this.currentShipmentItems.length && !row) tags.push({ text: 'KHÔNG CÓ TRONG SHIPMENT', tone: 'red' });
    if (row && row.remain < 0) tags.push({ text: `Vượt shipment ${Math.abs(row.remain)}`, tone: 'red' });
    else if (row && row.remain === 0) tags.push({ text: 'Đủ shipment', tone: 'blue' });
    this.scanIdentity = { code, customer: String(customerCode || ''), qty: Number(qty) || 0, pallet: String(this.currentPalletNo || ''), tags };
    this.scanFlash = { kind: tags.some((t) => t.tone === 'red') ? 'err' : 'ok', text: `✔ ${code} · ${customerCode} · ${qty}` };
  }

  /** Đúng: 1 tiếng bíp cao. Sai: 2 tiếng bíp trầm. */
  private playScanBeep(ok: boolean): void {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      this.scanAudioCtx ||= new Ctx();
      const ctx = this.scanAudioCtx!;
      const tone = (start: number, freq: number, dur: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        osc.type = 'square';
        gain.gain.value = 0.08;
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur);
      };
      if (ok) tone(0, 1400, 0.12);
      else { tone(0, 420, 0.18); tone(0.26, 420, 0.18); }
    } catch { /* trình duyệt chặn âm thanh */ }
  }

  /** Tiến độ theo shipment: lượng xuất trên shipment vs lượng đã check (mọi pallet của shipment). */
  get fgScanProgress(): Array<{ code: string; need: number; checked: number; carton: number; remain: number }> {
    const ship = String(this.scannedShipment || '').trim().toUpperCase();
    const checked = new Map<string, { qty: number; carton: number }>();
    for (const it of this.items) {
      if (String(it.shipment || '').trim().toUpperCase() !== ship) continue;
      const c = String(it.materialCode || '').trim().toUpperCase();
      const cur = checked.get(c) || { qty: 0, carton: 0 };
      cur.qty += Number(it.quantity) || 0;
      cur.carton += Number((it as any).carton) || 0;
      checked.set(c, cur);
    }
    const isCarton = this.checkMode === 'pn';
    return this.currentShipmentItems.map((s) => {
      const c = String(s.materialCode || '').trim().toUpperCase();
      const done = checked.get(c) || { qty: 0, carton: 0 };
      const need = isCarton ? (Number(s.carton) || 0) : (Number(s.quantity) || 0);
      const got = isCarton ? done.carton : done.qty;
      return { code: c, need, checked: got, carton: done.carton, remain: need - got };
    }).sort((a, b) => Number(a.remain <= 0) - Number(b.remain <= 0) || a.code.localeCompare(b.code));
  }

  get fgScanPercent(): number {
    const rows = this.fgScanProgress;
    const need = rows.reduce((n, r) => n + r.need, 0);
    if (!(need > 0)) return 0;
    const done = rows.reduce((n, r) => n + Math.min(r.need, Math.max(0, r.checked)), 0);
    return Math.min(100, Math.round((done / need) * 1000) / 10);
  }

  get scannedItemsNewestFirst(): any[] {
    return [...this.scannedItems].reverse();
  }

  /** Tải Excel log check của shipment đang scan (mọi pallet). */
  async downloadFgShipmentLog(): Promise<void> {
    const ship = String(this.scannedShipment || '').trim().toUpperCase();
    if (!ship) return;
    const rows = this.items
      .filter((it) => String(it.shipment || '').trim().toUpperCase() === ship)
      .map((it: any, i) => ({
        'STT': i + 1, 'Shipment': ship, 'Pallet': it.palletNo || '', 'Mã TP': it.materialCode || '',
        'Mã KH': it.customerCode || '', 'Số lượng': it.quantity || 0, 'Thùng': it.carton || 0,
        'Khóa': it.isLocked ? 'Có' : '', 'Người check': it.checkedBy || it.employeeId || '',
        'Thời gian': (it.updatedAt?.toDate ? it.updatedAt.toDate() : it.updatedAt instanceof Date ? it.updatedAt : '')?.toLocaleString?.('vi-VN', { hour12: false }) || ''
      }));
    const progress = this.fgScanProgress.map((r) => ({ 'Mã TP': r.code, 'Cần (shipment)': r.need, 'Đã check': r.checked, 'Còn': r.remain }));
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(progress.length ? progress : [{ 'Mã TP': '' }]), 'Tiến độ');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Shipment': ship }]), 'Log check');
    XLSX.writeFile(wb, `FG_Check_${ship.replace(/[\\/:*?"<>|]+/g, '_')}.xlsx`);
  }

  onAxoneScan(): void {
    const raw = String(this.currentScanInput || '').trim();
    if (!raw) return;

    if (this.axonePhase === 'internal' || this.isAxoneInternalRescan(raw)) {
      const parsed = this.parseAxoneInternalQr(raw);
      this.currentScanInput = '';
      if (!parsed) {
        this.axoneStatusOk = false;
        this.axoneStatus = 'Tem nội bộ không đúng. Cần dạng MãTP|SốPcs|... (vd P030089_C|120|...).';
        this.scanAlert(this.axoneStatus);
        this.focusAxoneInput();
        return;
      }
      this.axoneInternal = parsed;
      this.axonePhase = 'customer';
      this.axoneStatusOk = null;
      this.axoneStatus = `Tem nội bộ: ${parsed.materialCode} · ${parsed.qty} pcs. Quét tem khách của thùng này.`;
      this.cdr.detectChanges();
      this.focusAxoneInput();
      return;
    }

    const internal = this.axoneInternal;
    const customerCode = this.parseAxoneCustomerCode(raw);
    this.currentScanInput = '';
    if (!internal) {
      this.axonePhase = 'internal';
      this.axoneStatusOk = false;
      this.axoneStatus = 'Chưa có tem nội bộ. Quét tem nội bộ trước.';
      this.focusAxoneInput();
      return;
    }
    if (!customerCode) {
      this.axoneStatusOk = false;
      this.axoneStatus = 'Không đọc được mã KH trên tem khách. Quét lại tem khách.';
      this.scanAlert(this.axoneStatus);
      this.focusAxoneInput();
      return;
    }
    if (!this.customerCodeMatchesMaterial(customerCode, internal.materialCode)) {
      this.axoneStatusOk = false;
      this.axoneStatus = `Mã không khớp: tem khách "${customerCode}" không map tới mã TP ${internal.materialCode}. Quét lại tem khách.`;
      this.scanAlert(this.axoneStatus);
      this.cdr.detectChanges();
      this.focusAxoneInput();
      return;
    }

    this.scannedItems.push({
      materialCode: internal.materialCode,
      quantity: internal.qty,
      customerCode
    });
    this.scanOk(internal.materialCode, customerCode, internal.qty);
    this.saveSingleScannedItem(customerCode, internal.materialCode, internal.qty);
    this.axoneInternal = null;
    this.axonePhase = 'internal';
    this.axoneStatusOk = true;
    this.axoneStatus = `OK: ${internal.materialCode} · ${internal.qty} pcs (tem nội bộ) · mã KH ${customerCode}. Scan thùng mới — quét tem nội bộ.`;
    this.cdr.detectChanges();
    this.focusAxoneInput();
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
      const isCartonMode = this.checkMode === 'pn';
      const newQuantity = isCartonMode ? (existingItem.quantity || 0) : (existingItem.quantity || 0) + quantity;
      const newCarton = (existingItem.carton || 0) + 1; // Cả hai mode: 1 lần scan = 1 thùng
      if (isCartonMode) {
      } else {
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
        carton: 1, // Cả hai mode: 1 lần scan = 1 thùng
        quantity: isCartonMode ? 0 : quantity,
        isChecked: false,
        checkId: checkId,
        scanId: this.scannedCheckId || undefined,
        checkMode: this.checkMode,
        palletNo: palletNo,
        factory: this.getFactoryForMaterialInShipment(shipmentCode, materialCodeUpper),
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
    
    // Nhóm theo materialCode: cộng dồn số lượng + đếm số lần scan (1 scan = 1 thùng khi pn-qty)
    const groupedByMaterial: Map<string, { quantity: number; scanCount: number }> = new Map();
    
    this.scannedItems.forEach(item => {
      const materialCode = item.materialCode;
      const current = groupedByMaterial.get(materialCode) || { quantity: 0, scanCount: 0 };
      groupedByMaterial.set(materialCode, {
        quantity: current.quantity + item.quantity,
        scanCount: current.scanCount + 1
      });
    });
    
    
    // Lưu từng materialCode vào Firebase (cộng dồn nếu đã có)
    let savedCount = 0;
    let errorCount = 0;
    const savePromises: Promise<void>[] = [];
    
    groupedByMaterial.forEach(({ quantity: totalQuantity, scanCount }, materialCode) => {
      // Tìm item đã có trong Firebase (cùng shipment, materialCode, palletNo)
      const matUpper = materialCode.toUpperCase();
      const itemFactory = this.getFactoryForMaterialInShipment(shipmentCode, matUpper);
      const existingItem = this.items.find(item => {
        const itemShipment = String(item.shipment || '').trim().toUpperCase();
        const itemMaterialCode = String(item.materialCode || '').trim().toUpperCase();
        const itemPalletNo = String(item.palletNo || '').trim().toUpperCase();
        return itemShipment === shipmentCode &&
               itemMaterialCode === matUpper &&
               itemPalletNo === palletNo &&
               this.resolveItemFactory(item) === itemFactory &&
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
          carton: isCartonMode ? totalQuantity : scanCount, // pn: carton=totalQuantity; pn-qty: 1 scan = 1 thùng
          quantity: isCartonMode ? 0 : totalQuantity,
          isChecked: false,
          checkId: checkId,
          scanId: this.scannedCheckId || undefined,
          checkMode: this.checkMode,
          palletNo: palletNo,
          factory: itemFactory,
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
        if (materialCode.includes(shipmentData.materialCode)) {
          customerCode = custCode;
        }
      });
      
      return {
        materialCode: shipmentData.materialCode,
        quantity: shipmentData.quantity,
        carton: shipmentData.carton,
        customerCode: customerCode,
        factory: this.normalizeFactory(shipmentData.factory)
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
      } else {
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
    
    
    // Tự động tạo items trong bảng FG Check từ shipment data (chỉ tạo items mới)
    this.createItemsFromShipment(normalizedShipmentCode, shipmentDataList);
  }

  // Tự động tạo items trong bảng FG Check từ shipment data
  createItemsFromShipment(shipmentCode: string, shipmentDataList: ShipmentData[]): void {
    
    shipmentDataList.forEach((shipmentData, index) => {
      // QUAN TRỌNG: Kiểm tra xem item đã tồn tại chưa (dựa vào shipment + materialCode + poShip)
      // Nếu cùng materialCode nhưng khác PO Ship, tạo item mới
      const dataFactory = this.normalizeFactory(shipmentData.factory);
      const existingItem = this.items.find(item => {
        const itemShipment = String(item.shipment || '').trim().toUpperCase();
        const itemMaterialCode = String(item.materialCode || '').trim();
        const itemPoShip = String(item.poShip || '').trim();
        const dataPoShip = String(shipmentData.poShip || '').trim();
        const itemFactory = this.resolveItemFactory(item);
        return itemShipment === shipmentCode &&
               itemMaterialCode === shipmentData.materialCode &&
               itemPoShip === dataPoShip &&
               itemFactory === dataFactory;
      });
      
      if (existingItem) {
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
        if (materialCode.includes(shipmentData.materialCode)) {
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
        factory: dataFactory,
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
        this.waitingForQty = true;
        
        // Focus vào ô số lượng
        setTimeout(() => {
          const qtyInput = document.querySelector('.scan-qty-input') as HTMLInputElement;
          if (qtyInput) {
            qtyInput.focus();
            qtyInput.select();
          }
        }, 100);
      }
    }
  }

  onQuantityScanned(): void {
    if (!this.currentQtyInput.trim()) return;
    
    const qtyValue = this.currentQtyInput.trim();
    
    // Check if we have customer code from previous scan
    if (this.currentScanInput.trim()) {
      // We have both: customerCode from previous scan and quantity from this scan
      const customerCode = this.currentScanInput.trim().toUpperCase();
      // Parse quantity: loại bỏ các ký tự không phải số
      const cleanQtyValue = qtyValue.replace(/[^\d]/g, '');
      const quantity = cleanQtyValue ? parseInt(cleanQtyValue, 10) : 0;
      
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
      
      setTimeout(() => {
        const scanInput = document.querySelector('.scan-customer-input') as HTMLInputElement;
        if (scanInput) {
          scanInput.focus();
          scanInput.select();
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
    
    
    // QUAN TRỌNG: Kiểm tra shipmentDataMap TRƯỚC vì đây là nguồn dữ liệu chính xác nhất
    const shipmentDataList = this.shipmentDataMap.get(normalizedShipmentCode) || [];
    
    if (shipmentDataList.length === 0) {
      console.error(`❌ NO DATA FOUND for shipment "${normalizedShipmentCode}" in shipmentDataMap!`);
      console.error(`❌ Available shipments:`, Array.from(this.shipmentDataMap.keys()));
      console.error(`❌ Please check if shipment data was loaded correctly!`);
    }
    
    const foundInShipmentData = shipmentDataList.find(item => {
      const itemMaterialCode = String(item.materialCode || '').trim();
      const match = itemMaterialCode === normalizedMaterialCode;
      if (match) {
      }
      return match;
    });
    
    if (foundInShipmentData) {
      // Nếu tìm thấy trong shipmentDataMap nhưng không có trong currentShipmentItems, cập nhật lại
      if (this.currentShipmentItems.length === 0) {
        this.loadShipmentItems(normalizedShipmentCode);
      }
      return true;
    }
    
    // Kiểm tra trong currentShipmentItems (backup check)
    if (this.currentShipmentItems.length > 0) {
      const found = this.currentShipmentItems.find(item => {
        const itemMaterialCode = String(item.materialCode || '').trim();
        return itemMaterialCode === normalizedMaterialCode;
      });
      if (found) {
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
    
    // Bước 1: Tra cứu mã TP từ mapping (danh mục mã khách hàng → mã TP)
    const materialCode = this.getMaterialCodeFromCustomerCode(normalizedCustomerCode);
    
    if (!materialCode) {
      alert(`⚠️ Không tìm thấy Mã TP cho mã khách hàng "${normalizedCustomerCode}".\n\nVui lòng kiểm tra lại mapping trong danh mục!`);
      return;
    }
    
    // Normalize shipmentCode for comparison
    const normalizedShipmentCode = String(this.scannedShipment || '').trim().toUpperCase();
    
    // Bước 2: Kiểm tra mã TP có trong shipment hiện tại không (từ tab shipment)
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
    
    
    // Tự động lấy quantity từ shipment nếu chưa có hoặc trong chế độ PN
    if (normalizedShipmentCode && this.currentShipmentItems.length > 0) {
      const shipmentItem = this.currentShipmentItems.find(item => item.materialCode === materialCode);
      if (shipmentItem) {
        // Nếu là chế độ PN hoặc quantity = 1 (mặc định), dùng quantity từ shipment
        if (this.checkMode === 'pn' || quantity === 1) {
          quantity = shipmentItem.quantity;
        }
      }
    }
    
    // QUAN TRỌNG: Tìm item chưa đủ (chưa checked và chưa đủ số lượng/carton)
    // Nếu có nhiều dòng cùng materialCode (khác PO Ship), tìm dòng đầu tiên chưa đủ
    // Normalize materialCode để so sánh chính xác
    const normalizedMaterialCode = String(materialCode || '').trim();
    const targetFactory = this.getFactoryForMaterialInShipment(
      normalizedShipmentCode,
      normalizedMaterialCode
    );
    
    // Tìm tất cả items cùng shipment + materialCode + palletNo + factory
    const normalizedPalletNo = String(this.currentPalletNo || '').trim().toUpperCase();
    const matchingItems = this.items.filter(item => {
      const itemShipment = String(item.shipment || '').trim().toUpperCase();
      const itemMaterialCode = String(item.materialCode || '').trim();
      const itemPalletNo = String(item.palletNo || '').trim().toUpperCase();
      const itemFactory = this.resolveItemFactory(item);
      return itemShipment === normalizedShipmentCode &&
             itemMaterialCode === normalizedMaterialCode &&
             itemPalletNo === normalizedPalletNo &&
             itemFactory === targetFactory;
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
      // Update existing record
      let updatedQuantity: number;
      let updatedCarton: number;
      
      if (this.checkMode === 'pn-qty') {
        // Chế độ PN + QTY: Cộng dồn số lượng, 1 lần scan = 1 thùng
        updatedQuantity = (existingItem.quantity || 0) + quantity;
        updatedCarton = (existingItem.carton || 0) + 1;
      } else {
        // Chế độ PN: mỗi lần scan = 1 thùng, số lượng KHÔNG cập nhật (để 0)
        updatedQuantity = 0; // Không cập nhật số lượng, để trống
        updatedCarton = (existingItem.carton || 0) + 1; // Tăng số thùng
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
      
      const idsToUpdate = (existingItem.docIds && existingItem.docIds.length) ? existingItem.docIds : [existingItem.id!];
      const mainId = idsToUpdate[0];
      const restIds = idsToUpdate.slice(1);
      const deleteRest = (): Promise<void> => (restIds.length ? Promise.all(restIds.map(id => this.firestore.collection('fg-check').doc(id).delete())).then(() => undefined) : Promise.resolve()) as Promise<void>;
      this.firestore.collection('fg-check').doc(mainId).update(updateData)
        .then(deleteRest)
        .then(() => {
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
      
      // Tìm item chưa đủ từ danh sách đã tìm ở trên
      const availableItem = matchingItems.find(item => {
        if (item.isChecked) return false;
        return !this.isItemEnough(item);
      });
      
      if (availableItem) {
        // Tìm thấy item chưa đủ - cập nhật item này
        existingItem = availableItem;
        
        // Cập nhật item này (giống logic update ở trên)
        let updatedQuantity: number;
        let updatedCarton: number;
        
        if (this.checkMode === 'pn-qty') {
          updatedQuantity = (availableItem.quantity || 0) + quantity;
          updatedCarton = (availableItem.carton || 0) + 1; // 1 lần scan = 1 thùng
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
        const isScanningCustomerCode = !finalCheck.customerCode || finalCheck.customerCode !== normalizedCustomerCode;
        const newQty = this.checkMode === 'pn-qty' ? ((finalCheck.quantity || 0) + quantity) : (finalCheck.quantity || 0);
        const newCarton = (finalCheck.carton || 0) + 1; // Cả hai mode: 1 lần scan = 1 thùng
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
        carton: 1, // Cả hai mode: 1 lần scan = 1 thùng
        quantity: this.checkMode === 'pn-qty' ? quantity : 0, // PN: để 0, PN+QTY: ghi số lượng
        isChecked: false,
        checkId: checkId,
        scanId: this.scannedCheckId || undefined,
        checkMode: this.checkMode, // Lưu checkMode của item
        scannedCustomerCode: true, // Đã scan mã hàng
        scannedQuantity: this.checkMode === 'pn-qty' && quantity > 0, // Chỉ highlight khi mode PN+QTY
        isLocked: false, // Mặc định không lock
        palletNo: normalizedPalletNo || '', // Cùng shipment + materialCode + palletNo thì cộng dồn
        factory: targetFactory,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      this.firestore.collection('fg-check').add(newItem)
        .then((docRef) => {
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
        
        
        // Recalculate check results và cập nhật bảng
        this.calculateCheckResults();
        this.applyFilters();
        
        // Force change detection để cập nhật UI
        this.cdr.detectChanges();
        
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

    // Focus: chỉ hiển thị đúng Shipment người dùng nhập (các Shipment khác ẩn đi).
    // Đồng thời UNHIDE shipment này để các dòng đang Lock cũng được hiện ra.
    this.filterByShipment = shipment;
    this.searchTerm = '';
    this.unhiddenShipments = new Set([shipment]);

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

    // Focus ngay lập tức để bảng chỉ còn dữ liệu của Shipment này.
    // Tạm thời UNHIDE shipment để dữ liệu Lock cũng hiển thị cho tới khi cập nhật xong.
    this.filterByShipment = shipment;
    this.searchTerm = '';
    this.unhiddenShipments = new Set([shipment]);
    this.applyFilters();

    const itemsOfShipment = this.items.filter(item => {
      const s = String(item.shipment || '').trim().toUpperCase();
      return s === shipment && item.isLocked;
    });
    if (itemsOfShipment.length === 0) {
      this.unhiddenShipments.delete(shipment);
      this.applyFilters();
      this.closeUnhideDialog();
      this.cdr.detectChanges();
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
  async downloadCheckReportByMonth(): Promise<void> {
    const XLSX = await import('xlsx');
    const start = new Date(this.reportYear, this.reportMonth - 1, 1);
    const end = new Date(this.reportYear, this.reportMonth, 1);
    let itemsInMonth: FGCheckItem[] = [];
    try {
      const snap = await this.firestore.collection('fg-check', ref =>
        ref.where('createdAt', '>=', start).where('createdAt', '<', end).limit(5000)
      ).get().toPromise();
      itemsInMonth = (snap?.docs || []).map((doc) => this.mapFgCheckDoc(doc.id, doc.data() as any));
    } catch (e) {
      console.error('downloadCheckReportByMonth', e);
      itemsInMonth = this.items.filter(item => {
        const d = item.createdAt ? (item.createdAt instanceof Date ? item.createdAt : new Date(item.createdAt)) : null;
        if (!d || isNaN(d.getTime())) return false;
        return d.getMonth() + 1 === this.reportMonth && d.getFullYear() === this.reportYear;
      });
    }
    if (!itemsInMonth.length) {
      alert(`Không có dữ liệu check trong tháng ${this.reportMonth}/${this.reportYear}.`);
      return;
    }
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

  // ===================== SHIPMENT CHECK =====================

  openShipmentCheckDialog(): void {
    this.shipmentCheckCode = '';
    this.shipmentCheckScanInput = '';
    this.shipmentCheckPallets = [];
    this.shipmentCheckBoxes = [];
    this.shipmentCheckResults = [];
    this.shipmentCheckLastResult = null;
    this.shipmentCheckLastScanned = '';
    this.shipmentCheckQuery = '';
    this.shipmentCheckOlderHint = false;
    this.showShipmentCheckDialog = true;
  }

  closeShipmentCheckDialog(): void {
    this.showShipmentCheckDialog = false;
  }

  private isShipmentStatusAllowed(status: any): boolean {
    const s = String(status || '').trim().toUpperCase();
    return s === 'ĐÃ XONG' || s === 'ĐÃ CHECK';
  }

  /**
   * Đọc toàn bộ collection Firestore theo lô (tránh limit 500 mặc định).
   * Dùng orderBy documentId + startAfter — không cần composite index.
   */
  private async fetchAllCollectionDocs(
    collectionName: string,
    batchSize = 2500
  ): Promise<firebase.firestore.QueryDocumentSnapshot[]> {
    const col = this.firestore.firestore.collection(collectionName);
    const all: firebase.firestore.QueryDocumentSnapshot[] = [];
    let lastDoc: firebase.firestore.QueryDocumentSnapshot | null = null;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      let q: firebase.firestore.Query = col
        .orderBy(firebase.firestore.FieldPath.documentId())
        .limit(batchSize);
      if (lastDoc) {
        q = q.startAfter(lastDoc);
      }
      const snap = await q.get();
      if (snap.empty) {
        break;
      }
      all.push(...snap.docs);
      if (snap.docs.length < batchSize) {
        break;
      }
      lastDoc = snap.docs[snap.docs.length - 1];
    }
    return all;
  }

  async loadShipmentCheckBoxes(): Promise<void> {
    this.shipmentCheckLoading = true;
    this.shipmentCheckBoxes = [];
    try {
      const shipmentDocs = await this.fetchAllCollectionDocs('shipments');
      const statusByShipment = new Map<string, string>();
      shipmentDocs.forEach(doc => {
        const d = doc.data() as any;
        const shipmentCode = String(d?.shipmentCode || '').trim().toUpperCase();
        const status = String(d?.status || '').trim();
        if (!shipmentCode) return;
        if (!this.isShipmentStatusAllowed(status)) return;
        statusByShipment.set(shipmentCode, status);
      });

      if (statusByShipment.size === 0) {
        this.shipmentCheckLoading = false;
        this.cdr.detectChanges();
        return;
      }

      const fgOutDocs = await this.fetchAllCollectionDocs('fg-out');
      const palletsByShipment = new Map<string, Set<string>>();
      fgOutDocs.forEach(doc => {
        const d = doc.data() as any;
        const shipmentCode = String(d?.shipment || '').trim().toUpperCase();
        const pallet = String(d?.pallet || '').trim().toUpperCase();
        if (!shipmentCode || !pallet) return;
        if (!statusByShipment.has(shipmentCode)) return;
        if (!palletsByShipment.has(shipmentCode)) {
          palletsByShipment.set(shipmentCode, new Set<string>());
        }
        palletsByShipment.get(shipmentCode)!.add(pallet);
      });

      this.shipmentCheckBoxes = Array.from(statusByShipment.entries())
        .map(([shipmentCode, status]) => ({
          shipmentCode,
          status,
          palletCount: palletsByShipment.get(shipmentCode)?.size || 0
        }))
        .filter(x => x.palletCount > 0)
        .sort((a, b) => a.shipmentCode.localeCompare(b.shipmentCode));
    } catch (e) {
      alert('❌ Lỗi tải danh sách shipment check: ' + (e as any)?.message);
    }
    this.shipmentCheckLoading = false;
    this.cdr.detectChanges();
  }

  /** Shipment Check: tìm trong dữ liệu gần đây, không có thì mới đọc số cũ. */
  async searchShipmentForCheck(forceOlder = false): Promise<void> {
    const raw = String(this.shipmentCheckQuery || '').trim();
    const code = raw.toUpperCase();
    if (!code || this.shipmentCheckLoading) return;
    if (!this.shipmentDataMap.has(code) && !forceOlder) {
      this.shipmentCheckOlderHint = true;
      this.cdr.detectChanges();
      return;
    }
    this.shipmentCheckOlderHint = false;
    this.shipmentCheckLoading = true;
    try {
      const values = Array.from(new Set([raw, code]));
      const snap = await this.firestore.collection('shipments', ref =>
        ref.where('shipmentCode', 'in', values).limit(50)
      ).get().toPromise();
      const docs = snap?.docs || [];
      if (!docs.length) {
        alert('Không tìm thấy shipment này.');
        this.shipmentCheckOlderHint = true;
        return;
      }
      if (!this.shipmentDataMap.has(code)) {
        this.ingestShipmentOrderDocs(docs);
      }
      const allowed = docs.some((doc) => this.isShipmentStatusAllowed((doc.data() as any).status));
      if (!allowed) {
        alert('Shipment này chưa ở trạng thái Đã xong hoặc Đã check.');
        return;
      }
      await this.selectShipmentForCheck(code);
    } catch (e) {
      console.error('searchShipmentForCheck', e);
      alert('Không tìm được shipment. Vui lòng thử lại.');
    } finally {
      this.shipmentCheckLoading = false;
      this.cdr.detectChanges();
    }
  }

  async selectShipmentForCheck(shipmentCode: string): Promise<void> {
    this.shipmentCheckCode = String(shipmentCode || '').trim().toUpperCase();
    await this.loadShipmentPallets();
  }

  async loadShipmentPallets(): Promise<void> {
    const code = this.shipmentCheckCode.trim().toUpperCase();
    if (!code) return;
    this.shipmentCheckLoading = true;
    this.shipmentCheckPallets = [];
    this.shipmentCheckResults = [];
    this.shipmentCheckLastResult = null;
    try {
      const col = this.firestore.firestore.collection('fg-out');
      const seen = new Set<string>();
      const palletNames: string[] = [];
      let lastDoc: firebase.firestore.QueryDocumentSnapshot | null = null;
      const batchSize = 2500;
      let totalRows = 0;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        let q: firebase.firestore.Query = col.where('shipment', '==', code).limit(batchSize);
        if (lastDoc) {
          q = q.startAfter(lastDoc);
        }
        const snap = await q.get();
        if (snap.empty) {
          break;
        }
        totalRows += snap.docs.length;
        snap.docs.forEach(doc => {
          const p = ((doc.data() as any).pallet || '').trim();
          if (p && !seen.has(p)) {
            seen.add(p);
            palletNames.push(p);
          }
        });
        if (snap.docs.length < batchSize) {
          break;
        }
        lastDoc = snap.docs[snap.docs.length - 1];
      }

      if (totalRows === 0) {
        alert('❌ Không tìm thấy dữ liệu FG Out cho shipment này!');
        this.shipmentCheckLoading = false;
        return;
      }
      palletNames.sort((a, b) => {
        if (a === 'Không có Pallet') return 1;
        if (b === 'Không có Pallet') return -1;
        return a.localeCompare(b);
      });
      this.shipmentCheckPallets = palletNames;
      this.shipmentCheckResults = this.shipmentCheckPallets.map(p => ({
        palletCode: p,
        status: 'pending' as const
      }));
    } catch (e) {
      alert('❌ Lỗi: ' + (e as any)?.message);
    }
    this.shipmentCheckLoading = false;
    this.cdr.detectChanges();
    if (this.shipmentCheckResults.length > 0) {
      this.focusShipmentCheckScanInput();
    }
  }

  /** Đưa focus vào ô quét pallet để máy quét gửi ký tự ngay (sau khi ô đã có trong DOM). */
  private focusShipmentCheckScanInput(): void {
    setTimeout(() => {
      const el = document.getElementById('fg-shipment-check-scan-input') as HTMLInputElement | null;
      if (el) {
        el.focus();
        el.select();
      }
    }, 0);
  }

  /**
   * Tem pallet quét: {shipment}W{tuần}{2 số thứ tự pallet}
   * Ví dụ 5330W1301 → shipment 5330, tuần 13 (phần giữa W và 2 số cuối), pallet 01 → thứ tự 1
   */
  private parsePalletShipmentLabelScan(raw: string): { shipment: string; week: string; palletSeq: number } | null {
    const s = raw.trim().toUpperCase().replace(/\s/g, '');
    const w = s.indexOf('W');
    if (w <= 0) return null;
    if (s.length < w + 3) return null;
    const last2 = s.slice(-2);
    if (!/^\d{2}$/.test(last2)) return null;
    const shipment = s.slice(0, w);
    if (!/^\d+$/.test(shipment)) return null;
    const week = s.slice(w + 1, -2);
    if (!/^\d*$/.test(week)) return null;
    const palletSeq = parseInt(last2, 10);
    if (!Number.isFinite(palletSeq) || palletSeq < 1) return null;
    return { shipment, week, palletSeq };
  }

  /** Số thứ tự pallet trên mã FG Out (vd 1P/5P → 1, 12P/5P → 12) */
  private extractPalletOrderFromCode(palletCode: string): number | null {
    const m = String(palletCode || '').trim().match(/^(\d+)/);
    if (m) return parseInt(m[1], 10);
    return null;
  }

  /** Khớp thứ tự pallet từ tem (2 số cuối) với dòng trong danh sách check */
  private findShipmentCheckPalletIndexBySeq(palletSeq: number): number {
    const seq = Math.floor(palletSeq);
    if (seq < 1) return -1;
    const byLead = this.shipmentCheckResults.findIndex(r => {
      const n = this.extractPalletOrderFromCode(r.palletCode);
      return n !== null && n === seq;
    });
    if (byLead >= 0) return byLead;
    if (seq <= this.shipmentCheckResults.length) return seq - 1;
    return -1;
  }

  onShipmentCheckKeyEnter(): void {
    const scanned = (this.shipmentCheckScanInput || '').trim().toUpperCase();
    if (!scanned) return;
    this.shipmentCheckLastScanned = scanned;

    const expectedShipment = this.shipmentCheckCode.trim().toUpperCase();
    let idx = -1;

    const parsed = this.parsePalletShipmentLabelScan(scanned);
    if (parsed) {
      if (parsed.shipment === expectedShipment) {
        idx = this.findShipmentCheckPalletIndexBySeq(parsed.palletSeq);
      }
    } else {
      idx = this.shipmentCheckResults.findIndex(
        r => String(r.palletCode || '').trim().toUpperCase() === scanned
      );
    }

    if (idx > -1) {
      this.shipmentCheckResults[idx].status = 'ok';
      this.shipmentCheckLastResult = 'ok';
    } else {
      this.shipmentCheckLastResult = 'error';
    }
    const matchedPallet = idx > -1 ? this.shipmentCheckResults[idx].palletCode : null;
    this.persistShipmentCheckScanLog(expectedShipment, scanned, this.shipmentCheckLastResult === 'ok', matchedPallet);

    this.shipmentCheckScanInput = '';
    this.cdr.detectChanges();
    this.focusShipmentCheckScanInput();
  }

  /** Lưu từng lần quét Shipment Check lên Firebase. */
  private persistShipmentCheckScanLog(
    shipmentCode: string,
    scannedRaw: string,
    ok: boolean,
    matchedPalletCode: string | null
  ): void {
    const payload = {
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      shipmentCode: String(shipmentCode || '').trim().toUpperCase(),
      scannedRaw: String(scannedRaw || '').trim(),
      result: ok ? 'ok' : 'error',
      matchedPalletCode: matchedPalletCode != null && matchedPalletCode !== '' ? String(matchedPalletCode) : null
    };
    this.firestore
      .collection(this.SHIPMENT_CHECK_LOGS)
      .add(payload)
      .then(() => {})
      .catch((e: unknown) => console.error('persistShipmentCheckScanLog', e));
  }

  private formatShipmentCheckLogDate(val: unknown): string {
    if (val == null) return '';
    try {
      let d: Date;
      if (typeof val === 'object' && val !== null && typeof (val as { toDate?: () => Date }).toDate === 'function') {
        d = (val as { toDate: () => Date }).toDate();
      } else if (val instanceof Date) {
        d = val;
      } else {
        return '';
      }
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString('vi-VN', { hour12: false });
    } catch {
      return '';
    }
  }

  /** More: tải Excel lịch sử quét Shipment Check từ Firebase. */
  async downloadShipmentCheckHistoryExcel(): Promise<void> {
    const XLSX = await import('xlsx');
    try {
      const snap = await this.firestore
        .collection(this.SHIPMENT_CHECK_LOGS, ref => ref.orderBy('createdAt', 'desc').limit(20000))
        .get()
        .toPromise();
      if (!snap || snap.empty) {
        alert('Chưa có dữ liệu Shipment Check trên hệ thống.');
        return;
      }
      const rows: object[] = [];
      const chronological = [...snap.docs].reverse();
      chronological.forEach((doc, i) => {
        const d = doc.data() as any;
        const createdAt = d.createdAt;
        rows.push({
          No: i + 1,
          'Thời gian': this.formatShipmentCheckLogDate(createdAt),
          Shipment: d.shipmentCode ?? '',
          'Mã quét': d.scannedRaw ?? '',
          'Kết quả': d.result === 'ok' ? 'ĐÚNG' : 'SAI',
          'Pallet khớp': d.matchedPalletCode ?? ''
        });
      });
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Shipment Check');
      const stamp = new Date().toISOString().split('T')[0];
      XLSX.writeFile(wb, `Shipment_Check_Lich_su_${stamp}.xlsx`);
      alert(`Đã tải ${rows.length} dòng lịch sử Shipment Check.`);
    } catch (e: any) {
      console.error('downloadShipmentCheckHistoryExcel', e);
      const msg = e?.code === 'failed-precondition'
        ? 'Cần tạo index Firestore cho collection shipment-check-logs (createdAt). Xem Console.'
        : (e?.message || 'Lỗi không xác định');
      alert('Không tải được lịch sử: ' + msg);
    }
  }

  onShipmentCheckScanInput(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.onShipmentCheckKeyEnter();
    }
  }

  get shipmentCheckDoneCount(): number {
    return this.shipmentCheckResults.filter(r => r.status === 'ok').length;
  }

  resetShipmentCheckResults(): void {
    this.shipmentCheckResults = this.shipmentCheckResults.map(r => ({ ...r, status: 'pending' as const }));
    this.shipmentCheckLastResult = null;
    this.shipmentCheckLastScanned = '';
    this.cdr.detectChanges();
    this.focusShipmentCheckScanInput();
  }

  trackByIndex(index: number, _: any): number { return index; }

  trackByTableRow(_index: number, row: FgCheckTableRow): string {
    return row.key;
  }

  trackByItemId(_index: number, item: FGCheckItem): string {
    return item.id || item.checkId || String(_index);
  }
}