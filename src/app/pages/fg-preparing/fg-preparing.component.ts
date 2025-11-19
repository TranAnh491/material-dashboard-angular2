import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { FactoryAccessService } from '../../services/factory-access.service';

export interface CustomerCodeMapping {
  customerCode: string;
  materialCode: string;
}

export interface FGPreparingItem {
  id?: string;
  factory?: string;
  importDate: Date;
  batchNumber: string;
  materialCode: string;
  rev: string;
  lot: string;
  lsx: string;
  quantity: number;
  location: string;
  notes: string;
  standard: number;
  carton: number;
  odd: number;
  customer: string;
  customerCode: string;
  shipment: string;
  pallet: string;
  isPrepared: boolean;
  preparedDate?: Date;
  preparedBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

@Component({
  selector: 'app-fg-preparing',
  templateUrl: './fg-preparing.component.html',
  styleUrls: ['./fg-preparing.component.scss']
})
export class FGPreparingComponent implements OnInit, OnDestroy {
  materials: FGPreparingItem[] = [];
  filteredMaterials: FGPreparingItem[] = [];
  
  // Search and filter
  searchTerm = '';
  
  // Factory filter - FG Preparing is only for ASM1
  selectedFactory: string = 'ASM1';
  availableFactories: string[] = ['ASM1'];
  
  // Permissions
  hasDeletePermission: boolean = false;
  hasCompletePermission: boolean = false;
  
  // Scanner properties
  showScannerDialog: boolean = false;
  scannerStep: number = 0; // Start with mode selection
  scanMode: 'carton' | 'carton-qty' = 'carton'; // Mode selection
  scannedShipment: string = '';
  scannedEmployee: string = '';
  scannedPallet: string = '';
  currentScanInput: string = '';
  currentQtyInput: string = '';
  scannedItems: Array<{customerCode: string, quantity: number}> = [];
  waitingForQty: boolean = false; // For carton-qty mode
  currentShipmentData: any = null; // Store shipment data to check packing type
  needPalletScan: boolean = false; // Flag to determine if pallet scan is needed
  
  // Customer code mapping
  customerMappings: Map<string, string> = new Map(); // customerCode -> materialCode
  
  // Shipments data
  shipments: any[] = [];
  
  private destroy$ = new Subject<void>();
  
  // Loading state
  isLoading: boolean = false;

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private factoryAccessService: FactoryAccessService
  ) {}

  ngOnInit(): void {
    this.loadMaterialsFromFirebase();
    this.loadPermissions();
    this.loadFactoryAccess();
    this.loadCustomerMappings();
    this.loadShipments();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Load materials from Firebase
  loadMaterialsFromFirebase(): void {
    this.isLoading = true;
    
    this.firestore.collection('fg-preparing')
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe((querySnapshot) => {
        const firebaseMaterials = querySnapshot.docs.map(doc => {
          const data = doc.data() as any;
          const id = doc.id;
          
          return {
            id: id,
            factory: data.factory || 'ASM1',
            importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : new Date(),
            batchNumber: data.batchNumber || data.batch || '',
            materialCode: data.materialCode || data.maTP || '',
            rev: data.rev || '',
            lot: data.lot || data.Lot || '',
            lsx: data.lsx || data.LSX || '',
            quantity: data.quantity || 0,
            location: data.location || data.viTri || 'Temporary',
            notes: data.notes || data.ghiChu || '',
            standard: data.standard || 0,
            carton: data.carton || 0,
            odd: data.odd || 0,
            customer: data.customer || data.khach || '',
            customerCode: data.customerCode || '',
            shipment: data.shipment || '',
            pallet: data.pallet || '',
            isPrepared: data.isPrepared || false,
            preparedDate: data.preparedDate ? new Date(data.preparedDate.seconds * 1000) : undefined,
            preparedBy: data.preparedBy || '',
            createdAt: data.createdAt ? new Date(data.createdAt.seconds * 1000) : new Date(),
            updatedAt: data.updatedAt ? new Date(data.updatedAt.seconds * 1000) : new Date()
          };
        });
        
        this.materials = firebaseMaterials;
        this.sortMaterials();
        this.applyFilters();
        this.isLoading = false;
      });
  }

  // Sort materials by material code and batch
  sortMaterials(): void {
    this.materials.sort((a, b) => {
      // First sort by material code (A-Z)
      const materialCompare = a.materialCode.localeCompare(b.materialCode);
      if (materialCompare !== 0) {
        return materialCompare;
      }
      
      // Then sort by batch number
      return a.batchNumber.localeCompare(b.batchNumber);
    });
  }

  // Apply search filters
  applyFilters(): void {
    this.filteredMaterials = this.materials.filter(material => {
      // Show all materials if no search term
      if (!this.searchTerm || this.searchTerm.trim() === '') {
        return true;
      }
      
      // Filter by search term
      const searchableText = [
        material.materialCode,
        material.shipment,
        material.customerCode,
        material.pallet
      ].filter(Boolean).join(' ').toUpperCase();
      
      if (!searchableText.includes(this.searchTerm)) {
        return false;
      }

      // Filter by factory
      if (this.selectedFactory) {
        const materialFactory = material.factory || 'ASM1';
        if (materialFactory !== this.selectedFactory) {
          return false;
        }
      }

      return true;
    });
  }

  // Search functionality
  onSearchChange(event: any): void {
    let searchTerm = event.target.value;
    
    // Auto-convert to uppercase
    if (searchTerm && searchTerm !== searchTerm.toUpperCase()) {
      searchTerm = searchTerm.toUpperCase();
      event.target.value = searchTerm;
    }
    
    this.searchTerm = searchTerm;
    this.applyFilters();
  }

  // Format number with commas for thousands
  formatNumber(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '0';
    }
    
    return value.toLocaleString('vi-VN');
  }

  // Load user permissions
  loadPermissions(): void {
    this.hasDeletePermission = true;
    this.hasCompletePermission = true;
  }

  // Load factory access
  loadFactoryAccess(): void {
    this.factoryAccessService.getAvailableFactories().subscribe(access => {
      if (access && access.length > 0) {
        this.availableFactories = access;
        this.selectedFactory = access[0];
      }
    });
  }

  // Check if material can be edited
  canEditMaterial(material: FGPreparingItem): boolean {
    return !material.isPrepared;
  }

  // Mark material as prepared
  markAsPrepared(material: FGPreparingItem): void {
    if (material.isPrepared) {
      return;
    }

    material.isPrepared = true;
    material.preparedDate = new Date();
    material.preparedBy = 'Current User'; // TODO: Get actual user
    material.updatedAt = new Date();

    this.updateMaterialInFirebase(material);
  }

  // Update material in Firebase
  updateMaterialInFirebase(material: FGPreparingItem): void {
    if (!material.id) {
      console.error('Cannot update material without ID');
      return;
    }

    const updateData = {
      ...material,
      importDate: material.importDate,
      preparedDate: material.preparedDate,
      updatedAt: new Date()
    };
    
    delete updateData.id;
    
    this.firestore.collection('fg-preparing').doc(material.id).update(updateData)
      .then(() => {
        console.log('FG Preparing material updated successfully');
      })
      .catch(error => {
        console.error('Error updating FG Preparing material:', error);
      });
  }

  // Delete material
  deleteItem(material: FGPreparingItem): void {
    if (!material.id) {
      console.error('Cannot delete material without ID');
      return;
    }

    this.firestore.collection('fg-preparing').doc(material.id).delete()
      .then(() => {
        const index = this.materials.findIndex(m => m.id === material.id);
        if (index > -1) {
          this.materials.splice(index, 1);
          this.applyFilters();
        }
        console.log('FG Preparing material deleted successfully');
      })
      .catch(error => {
        console.error('Error deleting FG Preparing material:', error);
      });
  }

  // Update notes
  updateNotes(material: FGPreparingItem): void {
    material.updatedAt = new Date();
    this.updateMaterialInFirebase(material);
  }

  // Update location
  updateLocation(material: FGPreparingItem, newLocation: string): void {
    material.location = newLocation;
    material.updatedAt = new Date();
    this.updateMaterialInFirebase(material);
  }

  // Edit location (placeholder for future implementation)
  editLocation(material: FGPreparingItem): void {
    const newLocation = prompt('Nhập vị trí mới:', material.location || '');
    if (newLocation !== null && newLocation.trim() !== '') {
      this.updateLocation(material, newLocation.trim());
    }
  }

  // Update customer code
  updateCustomerCode(material: FGPreparingItem): void {
    material.customerCode = material.customerCode || '';
    material.updatedAt = new Date();
    this.updateMaterialInFirebase(material);
  }

  // Update pallet
  updatePallet(material: FGPreparingItem): void {
    material.pallet = material.pallet || '';
    material.updatedAt = new Date();
    this.updateMaterialInFirebase(material);
  }

  // Scanner Methods
  openScanner(): void {
    this.showScannerDialog = true;
    this.resetScanner();
  }
  
  // Select mode and continue to step 1
  selectModeAndContinue(mode: 'carton' | 'carton-qty'): void {
    console.log('🔵 selectModeAndContinue called with mode:', mode);
    this.scanMode = mode;
    this.scannerStep = 1;
    console.log('✅ Mode selected:', mode, '| scannerStep:', this.scannerStep);
    // Auto focus on shipment input after a short delay
    setTimeout(() => {
      const input = document.querySelector('.scanner-input') as HTMLInputElement;
      if (input) {
        input.focus();
        console.log('✅ Input focused');
      } else {
        console.log('❌ Input not found');
      }
    }, 100);
  }

  closeScanner(): void {
    this.showScannerDialog = false;
    this.resetScanner();
  }

  resetScanner(): void {
    this.scannerStep = 0; // Start with mode selection
    this.scanMode = 'carton';
    this.scannedShipment = '';
    this.scannedEmployee = '';
    this.scannedPallet = '';
    this.currentScanInput = '';
    this.currentQtyInput = '';
    this.scannedItems = [];
    this.waitingForQty = false;
    this.currentShipmentData = null;
    this.needPalletScan = false;
  }

  onShipmentScanned(): void {
    const shipmentCode = this.scannedShipment.trim();
    if (!shipmentCode) return;
    
    // Find shipment data
    this.currentShipmentData = this.shipments.find(s => 
      String(s.shipmentCode).trim().toUpperCase() === shipmentCode.toUpperCase()
    );
    
    if (!this.currentShipmentData) {
      alert('❌ Không tìm thấy Shipment: ' + shipmentCode);
      console.log('Shipment not found:', shipmentCode);
      return;
    }
    
    console.log('Shipment found:', this.currentShipmentData);
    console.log('Packing type:', this.currentShipmentData.packing);
    
    // Check if pallet scan is needed
    const packing = String(this.currentShipmentData.packing || '').toUpperCase();
    this.needPalletScan = (packing === 'PALLET');
    
    if (this.needPalletScan) {
      // Packing = Pallet → go to step 2 (scan pallet)
      this.scannerStep = 2;
      console.log('→ Need pallet scan, moving to step 2');
    } else {
      // Packing = Box → skip pallet, go to step 3 (scan employee)
      this.scannerStep = 3;
      console.log('→ Box packing, skipping pallet scan, moving to step 3');
    }
  }

  onPalletScanned(): void {
    if (this.scannedPallet.trim()) {
      // After pallet scan, go to step 3 (employee scan)
      this.scannerStep = 3;
      console.log('Pallet scanned:', this.scannedPallet);
    }
  }

  onEmployeeScanned(): void {
    if (this.scannedEmployee.trim()) {
      // After employee scan, go to step 4 (material scan)
      this.scannerStep = 4;
      console.log('Employee scanned:', this.scannedEmployee);
      // Auto focus on scan input for continuous scanning
      setTimeout(() => {
        const scanInput = document.querySelector('.scanner-input-continuous') as HTMLInputElement;
        if (scanInput) scanInput.focus();
      }, 100);
    }
  }

  onCustomerCodeScanned(): void {
    if (!this.currentScanInput.trim()) return;
    
    const customerCode = this.currentScanInput.trim();
    
    if (this.scanMode === 'carton') {
      // Mode Carton: mỗi lần scan = 1 carton (quantity = 1)
      this.scannedItems.push({ customerCode, quantity: 1 });
      console.log('Customer code scanned (Carton mode):', customerCode);
      this.currentScanInput = '';
    } else if (this.scanMode === 'carton-qty') {
      // Mode Carton & Qty: sau khi scan customerCode, đợi scan quantity
      if (!this.waitingForQty) {
        // Đang chờ scan quantity cho customerCode này
        this.waitingForQty = true;
        console.log('Customer code scanned (Carton & Qty mode), waiting for quantity:', customerCode);
      }
    }
  }

  onQuantityScanned(): void {
    if (!this.currentQtyInput.trim() || !this.currentScanInput.trim()) return;
    
    const customerCode = this.currentScanInput.trim();
    const quantity = parseInt(this.currentQtyInput.trim()) || 1;
    
    this.scannedItems.push({ customerCode, quantity });
    console.log('Quantity scanned:', quantity, 'for customer code:', customerCode);
    
    // Reset for next scan
    this.currentScanInput = '';
    this.currentQtyInput = '';
    this.waitingForQty = false;
    
    // Auto focus back to customer code input
    setTimeout(() => {
      const scanInput = document.querySelector('.scanner-input-continuous') as HTMLInputElement;
      if (scanInput) scanInput.focus();
    }, 100);
  }

  removeScannedItem(index: number): void {
    this.scannedItems.splice(index, 1);
  }
  
  // Get total cartons (for display)
  getTotalCartons(): number {
    return this.scannedItems.length;
  }
  
  // Get total quantity (for display)
  getTotalQuantity(): number {
    return this.scannedItems.reduce((sum, item) => sum + item.quantity, 0);
  }
  
  // Group scanned items by customerCode with count
  getGroupedItems(): Array<{customerCode: string, count: number, totalQty: number}> {
    const grouped = new Map<string, {count: number, totalQty: number}>();
    
    this.scannedItems.forEach(item => {
      if (grouped.has(item.customerCode)) {
        const existing = grouped.get(item.customerCode)!;
        existing.count += 1;
        existing.totalQty += item.quantity;
      } else {
        grouped.set(item.customerCode, { count: 1, totalQty: item.quantity });
      }
    });
    
    return Array.from(grouped.entries()).map(([customerCode, data]) => ({
      customerCode,
      count: data.count,
      totalQty: data.totalQty
    }));
  }

  // Load customer code mappings from Firebase
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

  // Get material code from customer code
  getMaterialCodeFromCustomerCode(customerCode: string): string {
    return this.customerMappings.get(customerCode) || '';
  }

  // Load shipments from Firebase to check packing type
  loadShipments(): void {
    this.firestore.collection('shipments')
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe((querySnapshot) => {
        this.shipments = querySnapshot.docs.map(doc => {
          const data = doc.data() as any;
          return {
            id: doc.id,
            shipmentCode: data.shipmentCode,
            packing: data.packing || 'Pallet', // Default to Pallet if not specified
            ...data
          };
        });
        console.log('Loaded shipments for FG Check:', this.shipments.length);
      });
  }

  saveScannedData(): void {
    if (this.scannedItems.length === 0) {
      alert('Vui lòng quét ít nhất một mã hàng!');
      return;
    }

    // Group scanned items by customerCode
    const grouped = this.getGroupedItems();
    
    // Create FG Preparing items for each unique customerCode
    const newItems: FGPreparingItem[] = grouped.map(group => {
      // Try to get materialCode from mapping
      const materialCode = this.getMaterialCodeFromCustomerCode(group.customerCode);
      
      return {
        factory: 'ASM1',
        importDate: new Date(),
        batchNumber: '',
        materialCode: materialCode, // Auto-filled from mapping if available
        rev: '',
        lot: '',
        lsx: '',
        quantity: group.totalQty,
        location: '',
        notes: `Scanned: Shipment: ${this.scannedShipment}, Employee: ${this.scannedEmployee}, Pallet: ${this.scannedPallet}`,
        standard: 0,
        carton: group.count, // Number of times scanned = number of cartons
        odd: 0,
        customer: '',
        customerCode: group.customerCode,
        shipment: this.scannedShipment,
        pallet: this.scannedPallet,
        isPrepared: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };
    });

    // Save to Firebase
    const savePromises = newItems.map(item => 
      this.firestore.collection('fg-preparing').add(item)
    );

    Promise.all(savePromises)
      .then(() => {
        console.log('Scanned data saved successfully');
        alert(`✅ Đã lưu ${newItems.length} mã khách hàng vào FG Check!\n\nTổng ${this.getTotalCartons()} lần scan, Tổng quantity: ${this.getTotalQuantity()}`);
        this.closeScanner();
        this.loadMaterialsFromFirebase(); // Refresh the list
      })
      .catch(error => {
        console.error('Error saving scanned data:', error);
        alert('❌ Lỗi khi lưu dữ liệu: ' + error.message);
      });
  }
}
