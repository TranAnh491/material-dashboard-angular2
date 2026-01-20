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
  shipmentQuantity?: number; // Lượng Shipment từ tab shipment
  checkResult?: 'Đúng' | 'Sai'; // Kết quả check
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ShipmentData {
  shipmentCode: string;
  materialCode: string;
  quantity: number; // Lượng Xuất
  carton: number;
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
  
  // Customer code mapping
  customerMappings: Map<string, string> = new Map(); // customerCode -> materialCode
  
  // Shipment data for checking
  shipmentDataMap: Map<string, ShipmentData[]> = new Map(); // shipmentCode -> ShipmentData[]
  
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
          
          return {
            id: id,
            shipment: data.shipment || '',
            materialCode: data.materialCode || '',
            customerCode: data.customerCode || '',
            carton: data.carton || 0,
            quantity: data.quantity || 0,
            isChecked: data.isChecked || false,
            checkId: data.checkId || '',
            createdAt: data.createdAt ? new Date(data.createdAt.seconds * 1000) : new Date(),
            updatedAt: data.updatedAt ? new Date(data.updatedAt.seconds * 1000) : new Date()
          };
        });
        
        this.items = firebaseItems;
        this.calculateCheckResults();
        this.applyFilters();
        this.isLoading = false;
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
            this.customerMappings.set(data.customerCode, data.materialCode);
          }
        });
        console.log('Loaded customer mappings:', this.customerMappings.size);
      });
  }

  // Load shipment data from Firestore
  loadShipmentData(): void {
    this.firestore.collection('shipments')
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe((querySnapshot) => {
        this.shipmentDataMap.clear();
        
        querySnapshot.docs.forEach(doc => {
          const data = doc.data() as any;
          const shipmentCode = data.shipmentCode || '';
          const materialCode = data.materialCode || '';
          const quantity = parseFloat(data.quantity) || 0; // Lượng Xuất
          const carton = parseFloat(data.carton) || 0;
          
          if (shipmentCode && materialCode) {
            if (!this.shipmentDataMap.has(shipmentCode)) {
              this.shipmentDataMap.set(shipmentCode, []);
            }
            
            this.shipmentDataMap.get(shipmentCode)!.push({
              shipmentCode: shipmentCode,
              materialCode: materialCode,
              quantity: quantity,
              carton: carton
            });
          }
        });
        
        console.log('Loaded shipment data for', this.shipmentDataMap.size, 'shipments');
        // Recalculate check results after loading shipment data
        this.calculateCheckResults();
      });
  }

  // Calculate check results for all items
  calculateCheckResults(): void {
    this.items.forEach(item => {
      const shipmentCode = item.shipment;
      const materialCode = item.materialCode;
      
      if (!shipmentCode || !materialCode) {
        item.shipmentQuantity = 0;
        item.checkResult = 'Sai';
        return;
      }
      
      const shipmentDataList = this.shipmentDataMap.get(shipmentCode) || [];
      const matchingShipment = shipmentDataList.find(s => s.materialCode === materialCode);
      
      if (!matchingShipment) {
        item.shipmentQuantity = 0;
        item.checkResult = 'Sai';
        return;
      }
      
      item.shipmentQuantity = matchingShipment.quantity;
      
      // Check based on checkMode
      if (this.checkMode === 'pn-qty') {
        // Check số lượng: so sánh Lượng Xuất (shipment) với Số Lượng (FG check)
        item.checkResult = (item.quantity === matchingShipment.quantity) ? 'Đúng' : 'Sai';
      } else {
        // Check số thùng: so sánh Carton (shipment) với Số Thùng (FG check)
        item.checkResult = (item.carton === matchingShipment.carton) ? 'Đúng' : 'Sai';
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
    return this.customerMappings.get(customerCode) || '';
  }

  // Apply search filters
  applyFilters(): void {
    this.filteredItems = this.items.filter(item => {
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
    const shipmentCode = this.scannedShipment.trim();
    if (!shipmentCode) return;
    
    console.log('🔵 onShipmentEntered called, shipmentCode:', shipmentCode);
    console.log('🔵 Before - isScanning:', this.isScanning);
    console.log('🔵 Before - scannedShipment:', this.scannedShipment);
    
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
        if (scanInput) scanInput.focus();
      }, 50);
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
            if (scanInput) scanInput.focus();
          }, 50);
        } else {
          alert('❌ Mã khách hàng không hợp lệ!');
        }
      } else {
        // Không có dấu +, đây là mã hàng (PN)
        // Lưu mã hàng và chuyển sang chế độ đợi scan số lượng
        this.waitingForQty = true;
        // currentScanInput đã có mã khách hàng từ scan, giữ nguyên
        setTimeout(() => {
          const qtyInput = document.querySelector('.scan-qty-input') as HTMLInputElement;
          if (qtyInput) {
            qtyInput.focus();
            qtyInput.select();
          }
        }, 50);
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
      console.log('🔵 onQuantityScanned - customerCode:', customerCode, 'cleanQtyValue:', cleanQtyValue, 'quantity:', quantity);
      
      if (quantity <= 0) {
        alert('❌ Số lượng không hợp lệ!');
        this.currentQtyInput = '';
        return;
      }
      
      this.saveCustomerCode(customerCode, quantity);
      
      // Reset for next scan
      this.currentScanInput = '';
      this.currentQtyInput = '';
      this.waitingForQty = false;
      
      setTimeout(() => {
        const scanInput = document.querySelector('.scan-customer-input') as HTMLInputElement;
        if (scanInput) scanInput.focus();
      }, 50);
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
            if (scanInput) scanInput.focus();
          }, 50);
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
          if (scanInput) scanInput.focus();
        }, 50);
      }
    }
  }

  // Save customer code to Firebase
  saveCustomerCode(customerCode: string, quantity: number): void {
    console.log('🔵 saveCustomerCode called - customerCode:', customerCode, 'quantity:', quantity, 'checkMode:', this.checkMode);
    const materialCode = this.getMaterialCodeFromCustomerCode(customerCode);
    console.log('🔵 materialCode:', materialCode);
    
    // Check if record already exists with same shipment + materialCode + customerCode
    const existingItem = this.items.find(item => 
      item.shipment === this.scannedShipment &&
      item.materialCode === materialCode &&
      item.customerCode === customerCode &&
      !item.isChecked
    );
    
    if (existingItem && existingItem.id) {
      console.log('🔵 Found existing record:', existingItem);
      // Update existing record
      let updatedQuantity: number;
      let updatedCarton: number;
      
      if (this.checkMode === 'pn-qty') {
        // Chế độ PN + QTY: QTY được ghi trực tiếp vào số lượng, không tăng số thùng
        updatedQuantity = quantity; // Ghi trực tiếp QTY vào số lượng
        updatedCarton = existingItem.carton || 0; // Giữ nguyên số thùng
        console.log('🔵 PN+QTY mode - updatedQuantity:', updatedQuantity, 'updatedCarton:', updatedCarton);
      } else {
        // Chế độ PN: mỗi lần scan = 1 thùng, số lượng cộng dồn
        updatedQuantity = (existingItem.quantity || 0) + quantity;
        updatedCarton = (existingItem.carton || 0) + 1;
        console.log('🔵 PN mode - updatedQuantity:', updatedQuantity, 'updatedCarton:', updatedCarton);
      }
      
      const updateData = {
        quantity: updatedQuantity,
        carton: updatedCarton,
        updatedAt: new Date()
      };
      
      console.log('🔵 Updating with data:', updateData);
      this.firestore.collection('fg-check').doc(existingItem.id).update(updateData)
        .then(() => {
          console.log('✅ Updated existing record:', customerCode, 'quantity:', updatedQuantity);
          existingItem.quantity = updatedQuantity;
          existingItem.carton = updatedCarton;
          existingItem.updatedAt = new Date();
          this.calculateCheckResults();
          this.applyFilters();
        })
        .catch(error => {
          console.error('❌ Error updating:', error);
          alert('❌ Lỗi khi cập nhật: ' + error.message);
        });
    } else {
      // Create new record
      console.log('🔵 Creating new record');
      const checkId = this.getNextCheckId();
      const newItem: FGCheckItem = {
        shipment: this.scannedShipment,
        materialCode: materialCode,
        customerCode: customerCode,
        carton: this.checkMode === 'pn-qty' ? 0 : 1, // PN+QTY: không tự động tăng số thùng
        quantity: quantity, // QTY được ghi trực tiếp vào số lượng
        isChecked: false,
        checkId: checkId,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      console.log('🔵 New item to save:', newItem);
      this.firestore.collection('fg-check').add(newItem)
        .then((docRef) => {
          console.log('✅ Customer code saved:', customerCode, `QTY: ${quantity}`, 'checkMode:', this.checkMode);
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

  // Complete scanning
  completeScanning(): void {
    this.isScanning = false;
    this.scannedShipment = '';
    this.currentScanInput = '';
    this.currentQtyInput = '';
    this.waitingForQty = false;
    alert('✅ Hoàn tất check!');
  }
}

