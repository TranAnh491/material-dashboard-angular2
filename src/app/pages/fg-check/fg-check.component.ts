import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';

export interface FGCheckItem {
  id?: string;
  shipment: string;
  materialCode: string;
  customerCode: string;
  carton: number;
  quantity: number;
  isChecked: boolean;
  checkId: string;
  checkMode?: 'pn' | 'pn-qty'; // Lưu mode check của item
  shipmentCarton?: number; // Số thùng Shipment từ tab shipment
  shipmentQuantity?: number; // Lượng Shipment từ tab shipment
  checkResult?: 'Đúng' | 'Sai'; // Kết quả check
  scannedCustomerCode?: boolean; // Đã scan mã hàng (highlight xanh)
  scannedQuantity?: boolean; // Đã scan số lượng (highlight xanh)
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ShipmentData {
  shipmentCode: string;
  materialCode: string;
  quantity: number; // Lượng Xuất
  carton: number;
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
  checkStep: number = 0; // 0 = select mode, 1 = shipment input, 2 = scanning
  checkMode: 'pn' | 'pn-qty' = 'pn';
  scannedShipment: string = '';
  currentScanInput: string = '';
  currentQtyInput: string = '';
  waitingForQty: boolean = false;
  isScanning: boolean = false;
  
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
            checkMode: data.checkMode || 'pn', // Load checkMode từ Firebase
            scannedCustomerCode: data.scannedCustomerCode || false,
            scannedQuantity: data.scannedQuantity || false,
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
        
        this.items = firebaseItems;
        this.itemsLoaded = true;
        this.isLoading = false;
        
        // Calculate check results if shipment data is already loaded
        if (this.shipmentDataLoaded) {
          this.calculateCheckResults();
        }
        this.applyFilters();
      });
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
          // CHỈ DÙNG 2 TRƯỜNG NÀY ĐỂ LƯU VÀ SO SÁNH
          const shipmentCode = String(data.shipmentCode || '').trim().toUpperCase();
          const materialCode = String(data.materialCode || '').trim(); // Mã TP - không uppercase để giữ nguyên format
          const quantity = parseFloat(data.quantity) || 0; // Lượng Xuất
          const carton = parseFloat(data.carton) || 0;
          
          // CHỈ LƯU KHI CÓ ĐỦ shipmentCode VÀ materialCode
          if (shipmentCode && materialCode) {
            if (!this.shipmentDataMap.has(shipmentCode)) {
              this.shipmentDataMap.set(shipmentCode, []);
            }
            
            // Lưu theo shipmentCode, mỗi shipmentCode có thể có nhiều materialCode
            this.shipmentDataMap.get(shipmentCode)!.push({
              shipmentCode: shipmentCode,
              materialCode: materialCode, // Mã TP
              quantity: quantity,
              carton: carton
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

  // Force save check results to Firebase for all items
  forceSaveCheckResults(): void {
    console.log('💾 Force saving check results for all items...');
    let savedCount = 0;
    let errorCount = 0;
    
    const savePromises = this.items.map(item => {
      if (item.id && item.checkResult) {
        return this.firestore.collection('fg-check').doc(item.id).update({
          checkResult: item.checkResult,
          shipmentQuantity: item.shipmentQuantity || 0,
          shipmentCarton: item.shipmentCarton || 0,
          updatedAt: new Date()
        }).then(() => {
          savedCount++;
          console.log(`✅ Saved checkResult for ${item.checkId}: ${item.checkResult}`);
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

  // Calculate check results for all items
  calculateCheckResults(): void {
    console.log('🔍 calculateCheckResults - Total items:', this.items.length);
    console.log('🔍 calculateCheckResults - Shipment data map size:', this.shipmentDataMap.size);
    
    if (!this.itemsLoaded || !this.shipmentDataLoaded) {
      console.warn('⚠️ Cannot calculate check results: itemsLoaded=', this.itemsLoaded, 'shipmentDataLoaded=', this.shipmentDataLoaded);
      return;
    }
    
    this.items.forEach(item => {
      // QUAN TRỌNG: CHỈ DÙNG shipmentCode VÀ materialCode ĐỂ SO SÁNH
      // Normalize shipmentCode và materialCode để so sánh chính xác
      const shipmentCode = String(item.shipment || '').trim().toUpperCase();
      const materialCode = String(item.materialCode || '').trim(); // Mã TP - không uppercase
      
      console.log(`🔍 Processing item ${item.checkId}: shipmentCode="${shipmentCode}", materialCode="${materialCode}"`);
      
      // Kiểm tra có đủ 2 thông tin bắt buộc: shipmentCode và materialCode
      if (!shipmentCode || !materialCode) {
        console.warn(`⚠️ Item ${item.checkId} missing shipmentCode or materialCode - shipmentCode="${shipmentCode}", materialCode="${materialCode}"`);
        item.shipmentQuantity = 0;
        item.checkResult = 'Sai';
        return;
      }
      
      // Bước 1: Tìm danh sách shipment records theo shipmentCode
      const shipmentDataList = this.shipmentDataMap.get(shipmentCode) || [];
      console.log(`🔍 Found ${shipmentDataList.length} shipment records for shipmentCode="${shipmentCode}"`);
      
      if (shipmentDataList.length > 0) {
        console.log(`🔍 Shipment records for ${shipmentCode}:`, shipmentDataList.map(s => `materialCode=${s.materialCode}, quantity=${s.quantity}`));
      } else {
        console.warn(`⚠️ No shipment records found for shipmentCode="${shipmentCode}"`);
      }
      
      // Bước 2: Tìm matching shipment bằng materialCode (so sánh chính xác)
      // CHỈ SO SÁNH DỰA VÀO materialCode, KHÔNG DÙNG BẤT KỲ TRƯỜNG NÀO KHÁC
      const matchingShipment = shipmentDataList.find(s => {
        const sMaterialCode = String(s.materialCode || '').trim();
        const match = sMaterialCode === materialCode;
        if (!match) {
          console.log(`  ⚠️ MaterialCode mismatch: "${sMaterialCode}" !== "${materialCode}"`);
        }
        return match;
      });
      
      if (!matchingShipment) {
        console.warn(`⚠️ No matching shipment found for item ${item.checkId}`);
        console.warn(`  - Looking for: shipmentCode="${shipmentCode}", materialCode="${materialCode}"`);
        console.warn(`  - Available in shipment ${shipmentCode}:`, shipmentDataList.map(s => s.materialCode));
        item.shipmentQuantity = 0;
        item.checkResult = 'Sai';
        return;
      }
      
      // Tìm thấy matching shipment dựa vào shipmentCode và materialCode
      console.log(`✅ Found matching shipment for item ${item.checkId}: shipmentCode="${shipmentCode}", materialCode="${materialCode}", carton=${matchingShipment.carton}, quantity=${matchingShipment.quantity}`);
      item.shipmentCarton = matchingShipment.carton; // Lưu số thùng từ shipment
      item.shipmentQuantity = matchingShipment.quantity; // Lưu số lượng từ shipment
      
      // Check based on item's checkMode (or current checkMode as fallback)
      const itemCheckMode = item.checkMode || this.checkMode;
      
      if (itemCheckMode === 'pn-qty') {
        // Check số lượng: so sánh Lượng Xuất (shipment) với Số Lượng quét (FG check)
        item.checkResult = (item.quantity === matchingShipment.quantity) ? 'Đúng' : 'Sai';
        console.log(`🔍 Check PN+QTY - Item ${item.checkId}: Quét=${item.quantity}, Shipment=${matchingShipment.quantity}, Result=${item.checkResult}`);
      } else {
        // Check số thùng: so sánh Số Thùng quét (FG check) với Số Thùng Shipment
        item.checkResult = (item.carton === matchingShipment.carton) ? 'Đúng' : 'Sai';
        console.log(`🔍 Check PN - Item ${item.checkId}: Thùng quét=${item.carton}, Thùng Shipment=${matchingShipment.carton}, Result=${item.checkResult}`);
      }
      
      // LƯU checkResult vào Firebase ngay lập tức
      if (item.id) {
        this.firestore.collection('fg-check').doc(item.id).update({
          checkResult: item.checkResult,
          shipmentQuantity: item.shipmentQuantity,
          shipmentCarton: item.shipmentCarton,
          updatedAt: new Date()
        }).then(() => {
          console.log(`💾 Saved checkResult to Firebase: ${item.checkId} = ${item.checkResult}`);
        }).catch(error => {
          console.error(`❌ Error saving checkResult for ${item.checkId}:`, error);
        });
      }
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

  // Apply search filters
  applyFilters(): void {
    this.filteredItems = this.items.filter(item => {
      // Filter by shipment nếu đang check một shipment cụ thể
      if (this.filterByShipment && this.filterByShipment.trim() !== '') {
        const itemShipment = String(item.shipment || '').trim().toUpperCase();
        const filterShipment = this.filterByShipment.trim().toUpperCase();
        if (itemShipment !== filterShipment) {
          return false; // Loại bỏ items không thuộc shipment đang check
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

  // Check Methods
  openCheck(): void {
    console.log('🔵 openCheck called');
    this.resetCheck();
    this.showCheckDialog = true;
    console.log('✅ showCheckDialog set to:', this.showCheckDialog);
    console.log('✅ checkStep:', this.checkStep);
    console.log('✅ checkMode:', this.checkMode);
    this.cdr.detectChanges();
    
    // Verify modal is in DOM
    setTimeout(() => {
      const modal = document.querySelector('.modal-overlay');
      const step0 = document.querySelector('.scanner-step');
      console.log('🔍 Modal in DOM:', modal !== null);
      console.log('🔍 Step 0 in DOM:', step0 !== null);
      console.log('🔍 All buttons:', document.querySelectorAll('.mode-btn-large').length);
    }, 100);
  }

  closeCheck(): void {
    this.showCheckDialog = false;
    // Don't reset if we're starting scanning mode
    if (!this.isScanning) {
      this.resetCheck();
    } else {
      // Only reset dialog-related properties
      this.checkStep = 0;
    }
  }

  resetCheck(): void {
    this.checkStep = 0;
    this.checkMode = 'pn';
    this.scannedShipment = '';
    this.currentScanInput = '';
    this.currentQtyInput = '';
    this.waitingForQty = false;
    this.isScanning = false;
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
    
    // Load danh sách materialCode của shipment này
    this.loadShipmentItems(shipmentCode);
    
    // Set filter để chỉ hiển thị items của shipment này
    this.filterByShipment = shipmentCode;
    console.log('✅ Set filterByShipment:', this.filterByShipment);
    
    // Apply filters để cập nhật bảng
    this.applyFilters();
    
    // Close popup first
    this.showCheckDialog = false;
    this.checkStep = 0;
    
    // Then start scanning mode (keep scannedShipment value)
    this.isScanning = true;
    
    console.log('✅ After - isScanning:', this.isScanning);
    console.log('✅ After - scannedShipment:', this.scannedShipment);
    
    this.cdr.detectChanges();
    
    // Auto focus on customer code input
    setTimeout(() => {
      const scanInput = document.querySelector('.scan-customer-input') as HTMLInputElement;
      if (scanInput) {
        scanInput.focus();
      }
    }, 200);
  }

  // Load danh sách materialCode của shipment để hiển thị và tự động tạo items trong bảng
  loadShipmentItems(shipmentCode: string): void {
    const normalizedShipmentCode = String(shipmentCode).trim().toUpperCase();
    console.log('📦 Loading shipment items for:', normalizedShipmentCode);
    
    // Lấy từ shipmentDataMap đã load
    const shipmentDataList = this.shipmentDataMap.get(normalizedShipmentCode) || [];
    
    // Tạo danh sách hiển thị với customerCode (nếu có mapping)
    this.currentShipmentItems = shipmentDataList.map(shipmentData => {
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
    
    console.log(`✅ Loaded ${this.currentShipmentItems.length} items for shipment ${normalizedShipmentCode}:`, 
      this.currentShipmentItems.map(item => `materialCode=${item.materialCode}, quantity=${item.quantity}`));
    
    if (this.currentShipmentItems.length === 0) {
      alert(`⚠️ Không tìm thấy dữ liệu cho shipment "${normalizedShipmentCode}". Vui lòng kiểm tra lại!`);
      return;
    }
    
    // Tự động tạo items trong bảng FG Check từ shipment data
    this.createItemsFromShipment(normalizedShipmentCode, shipmentDataList);
  }

  // Tự động tạo items trong bảng FG Check từ shipment data
  createItemsFromShipment(shipmentCode: string, shipmentDataList: ShipmentData[]): void {
    console.log('📝 Creating FG Check items from shipment data...');
    
    shipmentDataList.forEach((shipmentData, index) => {
      // Kiểm tra xem item đã tồn tại chưa (dựa vào shipment + materialCode) - QUAN TRỌNG: chỉ 1 dòng cho mỗi materialCode
      const existingItem = this.items.find(item => {
        const itemShipment = String(item.shipment || '').trim().toUpperCase();
        const itemMaterialCode = String(item.materialCode || '').trim();
        return itemShipment === shipmentCode && itemMaterialCode === shipmentData.materialCode;
      });
      
      if (existingItem) {
        console.log(`⏭️ Item already exists for shipment ${shipmentCode}, materialCode ${shipmentData.materialCode} - SKIP creating duplicate`);
        // Cập nhật shipmentCarton và shipmentQuantity nếu chưa có
        if (!existingItem.shipmentCarton || !existingItem.shipmentQuantity) {
          existingItem.shipmentCarton = shipmentData.carton;
          existingItem.shipmentQuantity = shipmentData.quantity;
          // Cập nhật vào Firebase
          if (existingItem.id) {
            this.firestore.collection('fg-check').doc(existingItem.id).update({
              shipmentCarton: shipmentData.carton,
              shipmentQuantity: shipmentData.quantity
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
      
      // Tạo item mới
      const checkId = this.getNextCheckId();
      const newItem: FGCheckItem = {
        shipment: shipmentCode,
        materialCode: shipmentData.materialCode,
        customerCode: customerCode,
        carton: 0,
        quantity: 0,
        isChecked: false,
        checkId: checkId,
        checkMode: this.checkMode,
        shipmentCarton: shipmentData.carton, // Lưu số thùng từ shipment
        shipmentQuantity: shipmentData.quantity, // Lưu số lượng từ shipment
        scannedCustomerCode: false,
        scannedQuantity: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      // Lưu vào Firebase
      this.firestore.collection('fg-check').add(newItem)
        .then((docRef) => {
          console.log(`✅ Created item for shipment ${shipmentCode}, materialCode ${shipmentData.materialCode}`);
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
    
    // Tìm item dựa vào shipment + materialCode (QUAN TRỌNG: chỉ 1 item cho mỗi materialCode)
    // Không cần customerCode vì có thể chưa scan hoặc đang cập nhật
    // Normalize materialCode để so sánh chính xác
    const normalizedMaterialCode = String(materialCode || '').trim();
    
    let existingItem = this.items.find(item => {
      const itemShipment = String(item.shipment || '').trim().toUpperCase();
      const itemMaterialCode = String(item.materialCode || '').trim();
      return itemShipment === normalizedShipmentCode &&
             itemMaterialCode === normalizedMaterialCode &&
             !item.isChecked;
    });
    
    // Nếu không tìm thấy, kiểm tra lại với tất cả items (kể cả đã checked) để đảm bảo không trùng
    if (!existingItem) {
      const duplicateItem = this.items.find(item => {
        const itemShipment = String(item.shipment || '').trim().toUpperCase();
        const itemMaterialCode = String(item.materialCode || '').trim();
        return itemShipment === normalizedShipmentCode &&
               itemMaterialCode === normalizedMaterialCode;
      });
      
      if (duplicateItem) {
        console.warn(`⚠️ Found duplicate item for shipment ${normalizedShipmentCode}, materialCode ${normalizedMaterialCode} - will update instead of creating new`);
        // Nếu item đã checked, không cập nhật, chỉ cảnh báo
        if (duplicateItem.isChecked) {
          alert(`⚠️ Item với mã TP "${normalizedMaterialCode}" đã được checked. Không thể cập nhật!`);
          return;
        }
        existingItem = duplicateItem;
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
      this.firestore.collection('fg-check').doc(existingItem.id).update(updateData)
        .then(() => {
          console.log('✅ Updated existing record:', normalizedCustomerCode, 'materialCode:', materialCode, 'quantity:', updatedQuantity);
          existingItem.quantity = updatedQuantity;
          existingItem.carton = updatedCarton;
          existingItem.shipment = normalizedShipmentCode; // Ensure shipmentCode is normalized
          existingItem.materialCode = materialCode; // Ensure materialCode is updated
          existingItem.customerCode = normalizedCustomerCode; // Ensure customerCode is normalized
          existingItem.checkMode = this.checkMode; // Ensure checkMode is updated
          existingItem.scannedCustomerCode = updateData.scannedCustomerCode;
          existingItem.scannedQuantity = updateData.scannedQuantity;
          existingItem.updatedAt = new Date();
          this.calculateCheckResults();
          this.applyFilters();
        })
        .catch(error => {
          console.error('❌ Error updating:', error);
          alert('❌ Lỗi khi cập nhật: ' + error.message);
        });
    } else {
      // Create new record - KIỂM TRA LẠI LẦN CUỐI để chắc chắn không trùng
      console.log('🔵 Creating new record - checking for duplicates one more time...');
      
      // KIỂM TRA LẠI LẦN CUỐI - normalize materialCode để so sánh chính xác
      const normalizedMaterialCode = String(materialCode || '').trim();
      const finalCheck = this.items.find(item => {
        const itemShipment = String(item.shipment || '').trim().toUpperCase();
        const itemMaterialCode = String(item.materialCode || '').trim();
        return itemShipment === normalizedShipmentCode &&
               itemMaterialCode === normalizedMaterialCode &&
               !item.isChecked;
      });
      
      if (finalCheck && finalCheck.id) {
        console.log('⚠️ Found existing item in final check - updating instead of creating duplicate');
          // Cập nhật item đã có thay vì tạo mới
        const isScanningCustomerCode = !finalCheck.customerCode || finalCheck.customerCode !== normalizedCustomerCode;
        
        const updateData = {
          quantity: this.checkMode === 'pn-qty' ? quantity : 0, // PN: để 0, PN+QTY: ghi số lượng
          carton: this.checkMode === 'pn-qty' ? (finalCheck.carton || 0) : ((finalCheck.carton || 0) + 1), // PN: tăng thùng, PN+QTY: giữ nguyên
          shipment: normalizedShipmentCode,
          materialCode: materialCode,
          customerCode: normalizedCustomerCode,
          checkMode: this.checkMode,
          scannedCustomerCode: isScanningCustomerCode ? true : (finalCheck.scannedCustomerCode || false),
          scannedQuantity: this.checkMode === 'pn-qty' && quantity > 0, // Chỉ highlight khi mode PN+QTY
          updatedAt: new Date()
        };
        
        this.firestore.collection('fg-check').doc(finalCheck.id).update(updateData)
          .then(() => {
            console.log('✅ Updated existing item instead of creating duplicate');
            finalCheck.quantity = updateData.quantity;
            finalCheck.carton = updateData.carton;
            finalCheck.customerCode = normalizedCustomerCode;
            finalCheck.scannedCustomerCode = updateData.scannedCustomerCode;
            finalCheck.scannedQuantity = updateData.scannedQuantity;
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
        checkMode: this.checkMode, // Lưu checkMode của item
        scannedCustomerCode: true, // Đã scan mã hàng
        scannedQuantity: this.checkMode === 'pn-qty' && quantity > 0, // Chỉ highlight khi mode PN+QTY
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

  // Delete item
  deleteItem(item: FGCheckItem): void {
    if (!item.id) {
      alert('❌ Không thể xóa: Không tìm thấy ID');
      return;
    }

    if (confirm(`Xác nhận xóa item?\n\nShipment: ${item.shipment}\nMã TP: ${item.materialCode}\nMã Hàng: ${item.customerCode}\nID Check: ${item.checkId}`)) {
      // Delete from Firebase
      this.firestore.collection('fg-check').doc(item.id).delete()
        .then(() => {
          console.log('✅ Item deleted successfully');
          // Remove from local array
          const index = this.items.indexOf(item);
          if (index > -1) {
            this.items.splice(index, 1);
            this.applyFilters();
            alert('✅ Đã xóa thành công!');
          }
        })
        .catch(error => {
          console.error('❌ Error deleting item:', error);
          alert('❌ Lỗi khi xóa: ' + error.message);
        });
    }
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
}

