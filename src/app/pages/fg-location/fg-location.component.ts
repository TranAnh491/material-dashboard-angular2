import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

interface LocationItem {
  id: string;
  factory: string;
  materialCode: string;
  batchNumber: string;
  lot: string;
  lsx: string;
  location: string;
  ton: number;
  selected: boolean;
  palletId?: string;
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
  
  // Steps: 'select-factory' | 'scan-location' | 'show-items' | 'scan-new-location' | 'success'
  currentStep: string = 'select-factory';
  
  // Scan inputs
  locationScanInput: string = '';
  newLocationScanInput: string = '';
  palletIdScanInput: string = '';
  
  // Bước 4: tick "Bỏ qua" cho từng mục (không bắt buộc scan mục đó)
  skipNewLocation: boolean = false;
  skipPalletId: boolean = false;
  
  // Current location and items
  currentLocation: string = '';
  itemsAtLocation: LocationItem[] = [];
  
  // New location
  newLocation: string = '';
  
  // Selection
  selectAll: boolean = false;
  
  // Loading and error states
  isLoading: boolean = false;
  errorMessage: string = '';
  successMessage: string = '';
  movedCount: number = 0;
  
  // Focus input references
  @ViewChild('locationInput') locationInput: ElementRef;
  @ViewChild('newLocationInput') newLocationInput: ElementRef;
  @ViewChild('palletIdInput') palletIdInput: ElementRef;
  
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
    this.currentStep = 'scan-location';
    this.errorMessage = '';
    this.successMessage = '';
    console.log(`🏭 Selected factory: ${factory}`);
    
    setTimeout(() => {
      if (this.locationInput) {
        this.locationInput.nativeElement.focus();
      }
    }, 100);
  }

  // Back to factory selection
  backToFactorySelection(): void {
    this.resetAll();
  }

  // Step 2: Scan current location (tự nhận biết theo vị trí hoặc Pallet ID)
  async scanLocation(): Promise<void> {
    if (!this.locationScanInput || this.locationScanInput.trim() === '') {
      this.errorMessage = 'Vui lòng scan hoặc nhập vị trí';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    const rawInput = this.locationScanInput.trim().toUpperCase();

    try {
      // Lấy toàn bộ hàng của factory, sau đó lọc theo:
      // 1) location == input (scan vị trí thuần)
      // 2) hoặc palletId == input / location == input / location kết thúc bằng "-input" (scan Pallet ID)
      console.log(`🔍 Searching items in factory ${this.selectedFactory} for key: ${rawInput}`);
      const snapshot = await this.firestore.collection('fg-inventory', ref =>
        ref.where('factory', '==', this.selectedFactory)
      ).get().toPromise();

      if (snapshot && !snapshot.empty) {
        const allDocs = snapshot.docs;

        const byExactLocation = allDocs.filter(d => {
          const data: any = d.data();
          const loc: string = (data.location || '').toString().toUpperCase();
          return loc === rawInput;
        });

        const byPalletIdOrComposite = allDocs.filter(d => {
          const data: any = d.data();
          const loc: string = (data.location || '').toString().toUpperCase();
          const pid: string = (data.palletId || '').toString().toUpperCase();
          if (pid) {
            return pid === rawInput;
          }
          if (!loc) return false;
          if (loc === rawInput) return true;
          return loc.endsWith('-' + rawInput);
        });

        let docs = byExactLocation.length > 0 ? byExactLocation : byPalletIdOrComposite;

        if (docs.length === 0) {
          this.itemsAtLocation = [];
          this.errorMessage = `Không tìm thấy hàng tại vị trí hoặc Pallet "${rawInput}" trong nhà máy ${this.selectedFactory}`;
          console.log('❌ No items found for location/pallet key');
          this.isLoading = false;
          return;
        }

        this.itemsAtLocation = docs.map(doc => {
          const data = doc.data() as any;
          
          // Calculate current stock
          const tonDau = data.tonDau || 0;
          const nhap = data.nhap || data.quantity || 0;
          const xuat = data.xuat || data.exported || 0;
          const ton = data.ton != null ? data.ton : (tonDau + nhap - xuat);
          
          return {
            id: doc.id,
            factory: data.factory || this.selectedFactory,
            materialCode: data.materialCode || '',
            batchNumber: data.batchNumber || '',
            lot: data.lot || '',
            lsx: data.lsx || '',
            location: data.location || '',
            ton: ton,
            selected: false,
            palletId: (data.palletId || '').toString().toUpperCase()
          };
        });

        // Ẩn mã thành phẩm có tồn = 0 khi scan đổi vị trí
        this.itemsAtLocation = this.itemsAtLocation.filter(item => item.ton > 0);

        if (this.itemsAtLocation.length === 0) {
          this.errorMessage = `Không có mã hàng nào có tồn > 0 tại vị trí "${rawInput}" trong nhà máy ${this.selectedFactory}`;
          console.log('❌ No items with ton > 0 at location');
          this.isLoading = false;
          return;
        }

        // currentLocation:
        // - nếu khớp theo vị trí: dùng đúng input
        // - nếu khớp theo Pallet: lấy location thực tế từ dòng đầu tiên (kệ + Pallet ID)
        if (byExactLocation.length > 0) {
          this.currentLocation = rawInput;
        } else {
          const first = this.itemsAtLocation[0];
          this.currentLocation = first?.location || rawInput;
        }
        
        // Sort by materialCode
        this.itemsAtLocation.sort((a, b) => a.materialCode.localeCompare(b.materialCode));
        
        this.currentStep = 'show-items';
        this.selectAll = false;
        console.log(`✅ Found ${this.itemsAtLocation.length} items for key ${rawInput}, currentLocation = ${this.currentLocation}`);
      } else {
        this.errorMessage = `Không tìm thấy hàng tại vị trí hoặc Pallet "${rawInput}" trong nhà máy ${this.selectedFactory}`;
        console.log('❌ No items found in snapshot');
      }
    } catch (error) {
      console.error('❌ Error searching location:', error);
      this.errorMessage = `Lỗi khi tìm kiếm: ${error.message}`;
    } finally {
      this.isLoading = false;
    }
  }

  // Handle Enter key on location scan
  onLocationScanKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.scanLocation();
    }
  }

  onNewLocationScanKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      if (this.isNewLocationValid()) {
        this.moveToNewLocation();
      } else if (this.palletIdInput) {
        this.palletIdInput.nativeElement.focus();
      }
    }
  }

  onPalletIdScanKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter' && this.isNewLocationValid()) {
      this.moveToNewLocation();
    }
  }

  // Toggle select all
  toggleSelectAll(): void {
    this.selectAll = !this.selectAll;
    this.itemsAtLocation.forEach(item => item.selected = this.selectAll);
  }

  // Toggle individual item selection
  toggleItemSelection(item: LocationItem): void {
    item.selected = !item.selected;
    this.updateSelectAllState();
  }

  // Update select all checkbox state
  updateSelectAllState(): void {
    this.selectAll = this.itemsAtLocation.length > 0 && 
                     this.itemsAtLocation.every(item => item.selected);
  }

  // Get selected items count
  getSelectedCount(): number {
    return this.itemsAtLocation.filter(item => item.selected).length;
  }

  // Check if any item is selected
  hasSelectedItems(): boolean {
    return this.itemsAtLocation.some(item => item.selected);
  }

  // Step 3: Proceed to scan new location
  proceedToScanNewLocation(): void {
    if (!this.hasSelectedItems()) {
      this.errorMessage = 'Vui lòng chọn ít nhất một mã hàng để di chuyển';
      return;
    }
    
    this.currentStep = 'scan-new-location';
    this.newLocationScanInput = '';
    this.palletIdScanInput = '';
    this.skipNewLocation = false;
    this.skipPalletId = false;
    this.errorMessage = '';
    
    setTimeout(() => {
      if (this.newLocationInput) {
        this.newLocationInput.nativeElement.focus();
      }
    }, 100);
  }

  getDisplayNewLocation(): string {
    const loc = this.skipNewLocation ? '' : (this.newLocationScanInput || '').trim().toUpperCase();
    const pallet = this.skipPalletId ? '' : (this.palletIdScanInput || '').trim().toUpperCase();
    if (loc && pallet) return `${loc}-${pallet}`;
    if (loc) return loc;
    if (pallet) return pallet;
    return '?';
  }

  getEffectiveNewLocation(): string {
    const loc = this.skipNewLocation ? '' : (this.newLocationScanInput || '').trim().toUpperCase();
    const pallet = this.skipPalletId ? '' : (this.palletIdScanInput || '').trim().toUpperCase();
    if (loc && pallet) return `${loc}-${pallet}`;
    if (loc) return loc;
    return pallet;
  }

  isNewLocationValid(): boolean {
    const loc = this.skipNewLocation ? '' : (this.newLocationScanInput || '').trim();
    const pallet = this.skipPalletId ? '' : (this.palletIdScanInput || '').trim();

    // Nếu KHÔNG bỏ qua cả 2 → bắt buộc nhập cả 2 ô
    if (!this.skipNewLocation && !this.skipPalletId) {
      return loc.length > 0 && pallet.length > 0;
    }

    // Ngược lại: chỉ yêu cầu ô không bị bỏ qua có giá trị
    if (!this.skipNewLocation && loc.length === 0) return false;
    if (!this.skipPalletId && pallet.length === 0) return false;
    return true;
  }

  // Back to location scan
  backToLocationScan(): void {
    this.currentStep = 'scan-location';
    this.locationScanInput = '';
    this.currentLocation = '';
    this.itemsAtLocation = [];
    this.selectAll = false;
    this.errorMessage = '';
    
    setTimeout(() => {
      if (this.locationInput) {
        this.locationInput.nativeElement.focus();
      }
    }, 100);
  }

  // Back to item selection
  backToItemSelection(): void {
    this.currentStep = 'show-items';
    this.newLocationScanInput = '';
    this.errorMessage = '';
  }

  // Step 4: Move selected items to new location
  async moveToNewLocation(): Promise<void> {
    if (!this.isNewLocationValid()) {
      this.errorMessage = 'Vui lòng nhập ít nhất một mục: Vị trí mới hoặc Pallet ID (hoặc bỏ tick Bỏ qua để nhập)';
      return;
    }

    const selectedItems = this.itemsAtLocation.filter(item => item.selected);
    if (selectedItems.length === 0) {
      this.errorMessage = 'Không có hàng nào được chọn';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';
    
    const rackLocation = this.skipNewLocation ? '' : (this.newLocationScanInput || '').trim().toUpperCase();
    const palletId = this.skipPalletId ? '' : (this.palletIdScanInput || '').trim().toUpperCase();

    this.newLocation = this.getEffectiveNewLocation();
    
    // Check if new location is same as current
    if (this.newLocation === this.currentLocation) {
      this.errorMessage = 'Vị trí mới phải khác vị trí hiện tại';
      this.isLoading = false;
      return;
    }
    
    console.log(`📍 Moving ${selectedItems.length} items: ${this.currentLocation} → ${this.newLocation}`);

    try {
      // Update location for all selected items
      const batch = this.firestore.firestore.batch();
      
      selectedItems.forEach(item => {
        const docRef = this.firestore.collection('fg-inventory').doc(item.id).ref;

        const updateData: any = {
          location: this.newLocation,
          updatedAt: new Date(),
          lastModified: new Date(),
          modifiedBy: 'fg-location-scanner'
        };

        updateData.palletId = palletId || '';
        updateData.rackLocation = rackLocation || (this.newLocation || '');

        batch.update(docRef, updateData);
      });
      
      await batch.commit();
      
      this.movedCount = selectedItems.length;
      this.successMessage = `Đã di chuyển ${this.movedCount} mã hàng thành công!\n${this.currentLocation} → ${this.newLocation}`;
      this.currentStep = 'success';
      
      console.log(`✅ Successfully moved ${this.movedCount} items`);
    } catch (error) {
      console.error('❌ Error moving items:', error);
      this.errorMessage = `Lỗi khi di chuyển: ${error.message}`;
    } finally {
      this.isLoading = false;
    }
  }

  // Continue scanning another location
  scanAnotherLocation(): void {
    this.locationScanInput = '';
    this.newLocationScanInput = '';
    this.palletIdScanInput = '';
    this.skipNewLocation = false;
    this.skipPalletId = false;
    this.currentLocation = '';
    this.newLocation = '';
    this.itemsAtLocation = [];
    this.selectAll = false;
    this.errorMessage = '';
    this.successMessage = '';
    this.movedCount = 0;
    this.currentStep = 'scan-location';
    
    setTimeout(() => {
      if (this.locationInput) {
        this.locationInput.nativeElement.focus();
      }
    }, 100);
  }

  // Reset all and go back to factory selection
  resetAll(): void {
    this.selectedFactory = '';
    this.currentStep = 'select-factory';
    this.locationScanInput = '';
    this.newLocationScanInput = '';
    this.palletIdScanInput = '';
    this.skipNewLocation = false;
    this.skipPalletId = false;
    this.currentLocation = '';
    this.newLocation = '';
    this.itemsAtLocation = [];
    this.selectAll = false;
    this.errorMessage = '';
    this.successMessage = '';
    this.movedCount = 0;
  }

  // Auto uppercase for inputs
  onLocationInputChange(): void {
    if (this.locationScanInput) {
      this.locationScanInput = this.locationScanInput.toUpperCase();
    }
  }

  onNewLocationInputChange(): void {
    if (this.newLocationScanInput) {
      this.newLocationScanInput = this.newLocationScanInput.toUpperCase();
    }
  }

  onPalletIdInputChange(): void {
    if (this.palletIdScanInput) {
      this.palletIdScanInput = this.palletIdScanInput.toUpperCase();
    }
  }
}
