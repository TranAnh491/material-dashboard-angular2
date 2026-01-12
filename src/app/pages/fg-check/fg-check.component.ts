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
  createdAt?: Date;
  updatedAt?: Date;
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
    this.showCheckDialog = true;
    this.resetCheck();
    console.log('✅ showCheckDialog set to:', this.showCheckDialog);
    this.cdr.detectChanges();
  }

  closeCheck(): void {
    this.showCheckDialog = false;
    this.resetCheck();
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
    console.log('🔵 Current checkStep before:', this.checkStep);
    
    // Update values
    this.checkMode = mode;
    this.scannedShipment = '0001'; // Default test shipment
    
    // Force change detection first
    this.cdr.detectChanges();
    
    // Then update step
    setTimeout(() => {
      this.checkStep = 1;
      console.log('✅ Mode selected:', mode);
      console.log('✅ checkStep set to:', this.checkStep);
      console.log('✅ shipment set to:', this.scannedShipment);
      console.log('✅ showCheckDialog:', this.showCheckDialog);
      
      // Force change detection again
      this.cdr.detectChanges();
      
      // Check if step 1 element exists
      setTimeout(() => {
        const step1 = document.querySelector('.scanner-step[ng-reflect-ng-if="true"]');
        const allSteps = document.querySelectorAll('.scanner-step');
        console.log('🔍 Total steps in DOM:', allSteps.length);
        console.log('🔍 Step 1 element:', step1);
        
        const input = document.querySelector('.check-shipment-input') as HTMLInputElement;
        if (input) {
          console.log('✅ Input found, focusing...');
          input.focus();
          input.select();
        } else {
          console.log('❌ Input not found');
        }
      }, 100);
    }, 50);
  }

  onShipmentEntered(): void {
    const shipmentCode = this.scannedShipment.trim();
    if (!shipmentCode) return;
    
    // Close popup and start scanning mode
    this.isScanning = true;
    this.closeCheck();
    
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
    
    const customerCode = this.currentScanInput.trim().toUpperCase();
    
    if (this.checkMode === 'pn') {
      // Mode Check P/N: mỗi lần scan = 1
      this.saveCustomerCode(customerCode, 1);
      this.currentScanInput = '';
      setTimeout(() => {
        const scanInput = document.querySelector('.scan-customer-input') as HTMLInputElement;
        if (scanInput) scanInput.focus();
      }, 50);
    } else if (this.checkMode === 'pn-qty') {
      // Mode Check P/N + QTY: sau khi scan customerCode, đợi scan quantity
      if (!this.waitingForQty) {
        this.waitingForQty = true;
        setTimeout(() => {
          const qtyInput = document.querySelector('.scan-qty-input') as HTMLInputElement;
          if (qtyInput) qtyInput.focus();
        }, 50);
      }
    }
  }

  onQuantityScanned(): void {
    if (!this.currentQtyInput.trim() || !this.currentScanInput.trim()) return;
    
    const customerCode = this.currentScanInput.trim().toUpperCase();
    const quantity = parseInt(this.currentQtyInput.trim()) || 1;
    
    this.saveCustomerCode(customerCode, quantity);
    
    // Reset for next scan
    this.currentScanInput = '';
    this.currentQtyInput = '';
    this.waitingForQty = false;
    
    setTimeout(() => {
      const scanInput = document.querySelector('.scan-customer-input') as HTMLInputElement;
      if (scanInput) scanInput.focus();
    }, 50);
  }

  // Save customer code to Firebase
  saveCustomerCode(customerCode: string, quantity: number): void {
    const materialCode = this.getMaterialCodeFromCustomerCode(customerCode);
    
    // Check if record already exists with same shipment + materialCode + customerCode
    const existingItem = this.items.find(item => 
      item.shipment === this.scannedShipment &&
      item.materialCode === materialCode &&
      item.customerCode === customerCode &&
      !item.isChecked
    );
    
    if (existingItem && existingItem.id) {
      // Update existing record: add quantity and carton
      const updatedQuantity = (existingItem.quantity || 0) + quantity;
      const updatedCarton = (existingItem.carton || 0) + 1;
      
      const updateData = {
        quantity: updatedQuantity,
        carton: updatedCarton,
        updatedAt: new Date()
      };
      
      this.firestore.collection('fg-check').doc(existingItem.id).update(updateData)
        .then(() => {
          console.log('✅ Updated existing record:', customerCode);
          existingItem.quantity = updatedQuantity;
          existingItem.carton = updatedCarton;
          existingItem.updatedAt = new Date();
          this.applyFilters();
        })
        .catch(error => {
          console.error('❌ Error updating:', error);
          alert('❌ Lỗi khi cập nhật: ' + error.message);
        });
    } else {
      // Create new record
      const checkId = this.getNextCheckId();
      const newItem: FGCheckItem = {
        shipment: this.scannedShipment,
        materialCode: materialCode,
        customerCode: customerCode,
        carton: 1,
        quantity: quantity,
        isChecked: false,
        checkId: checkId,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      this.firestore.collection('fg-check').add(newItem)
        .then((docRef) => {
          console.log('✅ Customer code saved:', customerCode, `QTY: ${quantity}`);
          newItem.id = docRef.id;
          this.items.push(newItem);
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

