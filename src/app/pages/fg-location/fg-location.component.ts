import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

interface ScanResult {
  id: string;
  factory: string;
  materialCode: string;
  batchNumber: string;
  lot: string;
  lsx: string;
  location: string;
  ton: number;
}

@Component({
  selector: 'app-fg-location',
  templateUrl: './fg-location.component.html',
  styleUrls: ['./fg-location.component.scss']
})
export class FgLocationComponent implements OnInit, OnDestroy {
  // Factory selection
  selectedFactory: string = '';
  availableFactories: string[] = ['ASM1', 'ASM2'];
  
  // Steps: 'select-factory' | 'scan-product' | 'show-current' | 'scan-location' | 'success'
  currentStep: string = 'select-factory';
  
  // Scan inputs
  productScanInput: string = '';
  locationScanInput: string = '';
  
  // Current scanned product
  scannedProduct: ScanResult | null = null;
  
  // New location
  newLocation: string = '';
  
  // Loading and error states
  isLoading: boolean = false;
  errorMessage: string = '';
  successMessage: string = '';
  
  // Focus input references
  @ViewChild('productInput') productInput: ElementRef;
  @ViewChild('locationInput') locationInput: ElementRef;
  
  private destroy$ = new Subject<void>();

  constructor(private firestore: AngularFirestore) {}

  ngOnInit(): void {
    console.log('🚀 FG Location component initialized');
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Step 1: Select factory
  selectFactory(factory: string): void {
    this.selectedFactory = factory;
    this.currentStep = 'scan-product';
    this.errorMessage = '';
    this.successMessage = '';
    console.log(`🏭 Selected factory: ${factory}`);
    
    setTimeout(() => {
      if (this.productInput) {
        this.productInput.nativeElement.focus();
      }
    }, 100);
  }

  // Back to factory selection
  backToFactorySelection(): void {
    this.resetAll();
  }

  // Step 2: Scan product (Batch number)
  async scanProduct(): Promise<void> {
    if (!this.productScanInput || this.productScanInput.trim() === '') {
      this.errorMessage = 'Vui lòng scan hoặc nhập mã hàng (Batch)';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    
    const searchTerm = this.productScanInput.trim().toUpperCase();
    console.log(`🔍 Searching for batch: ${searchTerm} in factory: ${this.selectedFactory}`);

    try {
      // Search in fg-inventory by batch number
      const snapshot = await this.firestore.collection('fg-inventory', ref =>
        ref.where('factory', '==', this.selectedFactory)
           .where('batchNumber', '==', searchTerm)
      ).get().toPromise();

      if (snapshot && !snapshot.empty) {
        const doc = snapshot.docs[0];
        const data = doc.data() as any;
        
        // Calculate current stock
        const tonDau = data.tonDau || 0;
        const nhap = data.nhap || data.quantity || 0;
        const xuat = data.xuat || data.exported || 0;
        const ton = data.ton != null ? data.ton : (tonDau + nhap - xuat);
        
        this.scannedProduct = {
          id: doc.id,
          factory: data.factory || this.selectedFactory,
          materialCode: data.materialCode || '',
          batchNumber: data.batchNumber || '',
          lot: data.lot || '',
          lsx: data.lsx || '',
          location: data.location || 'Chưa có',
          ton: ton
        };
        
        this.currentStep = 'show-current';
        console.log('✅ Found product:', this.scannedProduct);
      } else {
        this.errorMessage = `Không tìm thấy mã hàng "${searchTerm}" trong nhà máy ${this.selectedFactory}`;
        console.log('❌ Product not found');
      }
    } catch (error) {
      console.error('❌ Error searching product:', error);
      this.errorMessage = `Lỗi khi tìm kiếm: ${error.message}`;
    } finally {
      this.isLoading = false;
    }
  }

  // Handle Enter key on product scan
  onProductScanKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.scanProduct();
    }
  }

  // Step 3: Proceed to scan new location
  proceedToScanLocation(): void {
    this.currentStep = 'scan-location';
    this.locationScanInput = '';
    this.errorMessage = '';
    
    setTimeout(() => {
      if (this.locationInput) {
        this.locationInput.nativeElement.focus();
      }
    }, 100);
  }

  // Back to product scan
  backToProductScan(): void {
    this.currentStep = 'scan-product';
    this.scannedProduct = null;
    this.productScanInput = '';
    this.errorMessage = '';
    
    setTimeout(() => {
      if (this.productInput) {
        this.productInput.nativeElement.focus();
      }
    }, 100);
  }

  // Step 4: Scan new location and save
  async saveNewLocation(): Promise<void> {
    if (!this.locationScanInput || this.locationScanInput.trim() === '') {
      this.errorMessage = 'Vui lòng scan hoặc nhập vị trí mới';
      return;
    }

    if (!this.scannedProduct) {
      this.errorMessage = 'Không có thông tin sản phẩm';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    
    this.newLocation = this.locationScanInput.trim().toUpperCase();
    const oldLocation = this.scannedProduct.location;
    
    console.log(`📍 Updating location: ${oldLocation} → ${this.newLocation}`);

    try {
      // Update location in fg-inventory
      await this.firestore.collection('fg-inventory').doc(this.scannedProduct.id).update({
        location: this.newLocation,
        updatedAt: new Date(),
        lastModified: new Date(),
        modifiedBy: 'fg-location-scanner'
      });

      this.successMessage = `Đã cập nhật vị trí thành công!\n${this.scannedProduct.materialCode} (${this.scannedProduct.batchNumber})\n${oldLocation} → ${this.newLocation}`;
      this.currentStep = 'success';
      
      console.log('✅ Location updated successfully');
    } catch (error) {
      console.error('❌ Error updating location:', error);
      this.errorMessage = `Lỗi khi cập nhật vị trí: ${error.message}`;
    } finally {
      this.isLoading = false;
    }
  }

  // Handle Enter key on location scan
  onLocationScanKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.saveNewLocation();
    }
  }

  // Back to scan location
  backToScanLocation(): void {
    this.currentStep = 'scan-location';
    this.locationScanInput = '';
    this.errorMessage = '';
    this.successMessage = '';
    
    setTimeout(() => {
      if (this.locationInput) {
        this.locationInput.nativeElement.focus();
      }
    }, 100);
  }

  // Continue scanning more products
  scanAnotherProduct(): void {
    this.scannedProduct = null;
    this.productScanInput = '';
    this.locationScanInput = '';
    this.newLocation = '';
    this.errorMessage = '';
    this.successMessage = '';
    this.currentStep = 'scan-product';
    
    setTimeout(() => {
      if (this.productInput) {
        this.productInput.nativeElement.focus();
      }
    }, 100);
  }

  // Reset all and go back to factory selection
  resetAll(): void {
    this.selectedFactory = '';
    this.currentStep = 'select-factory';
    this.productScanInput = '';
    this.locationScanInput = '';
    this.scannedProduct = null;
    this.newLocation = '';
    this.errorMessage = '';
    this.successMessage = '';
  }

  // Auto uppercase for inputs
  onProductInputChange(): void {
    if (this.productScanInput) {
      this.productScanInput = this.productScanInput.toUpperCase();
    }
  }

  onLocationInputChange(): void {
    if (this.locationScanInput) {
      this.locationScanInput = this.locationScanInput.toUpperCase();
    }
  }
}
