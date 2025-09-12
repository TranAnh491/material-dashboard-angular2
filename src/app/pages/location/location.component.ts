import { Component, OnInit, OnDestroy, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { Subject, BehaviorSubject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import * as XLSX from 'xlsx';
import * as QRCode from 'qrcode';
import { TabPermissionService } from '../../services/tab-permission.service';
import { FactoryAccessService } from '../../services/factory-access.service';
import { trigger, state, style, transition, animate } from '@angular/animations';

export interface LocationItem {
  id?: string;
  stt: number;
  viTri: string;
  qrCode: string;
  createdAt?: Date;
  updatedAt?: Date;
}

@Component({
  selector: 'app-location',
  templateUrl: './location.component.html',
  styleUrls: ['./location.component.scss'],
  animations: [
    trigger('slideIn', [
      transition(':enter', [
        style({ transform: 'translateX(100%)', opacity: 0 }),
        animate('300ms ease-out', style({ transform: 'translateX(0)', opacity: 1 }))
      ])
    ])
  ]
})
export class LocationComponent implements OnInit, OnDestroy, AfterViewInit {
  // Data properties
  locationItems: LocationItem[] = [];
  filteredItems: LocationItem[] = [];
  
  // Loading state
  isLoading = false;
  
  // Search and filter
  searchTerm = '';
  private searchSubject = new Subject<string>();
  
  // Total counter
  private totalCountSubject = new BehaviorSubject<number>(0);
  public totalCount$ = this.totalCountSubject.asObservable();
  
  // Permission
  canDelete = false;
  
  // Dropdown state
  isDropdownOpen = false;
  
  // New item form
  newItem: Partial<LocationItem> = {
    stt: 0,
    viTri: '',
    qrCode: ''
  };
  
  // Auto STT counter
  nextStt = 1;
  
  // Edit mode
  editingItem: LocationItem | null = null;
  
  // Change Location Modal
  showChangeLocationModal = false;
  changeLocationStep = 1; // 1: Choose scanner, 2: Scan material, 3: Scan location, 4: Confirm
  selectedScannerType: 'camera' | 'scanner' | null = null;
  scannedMaterialCode = '';
  scannedNewLocation = '';
  currentLocation = '';
  foundRM1Item: any = null;
  
  // Success notification
  showSuccessNotification = false;
  successMessage = '';
  
  private destroy$ = new Subject<void>();

  constructor(
    private firestore: AngularFirestore,
    private auth: AngularFireAuth,
    private tabPermissionService: TabPermissionService,
    private factoryAccessService: FactoryAccessService,
    private cdr: ChangeDetectorRef
  ) {
    // Setup search debouncing
    this.searchSubject.pipe(
      takeUntil(this.destroy$),
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(term => {
      this.performSearch(term);
    });
  }

  ngOnInit() {
    this.checkPermissions();
    this.loadLocationData();
    
    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      this.isDropdownOpen = false;
    });
  }

  ngAfterViewInit() {
    this.cdr.detectChanges();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    
    // Remove event listeners
    document.removeEventListener('click', () => {
      this.isDropdownOpen = false;
    });
  }

  private async checkPermissions() {
    try {
      this.tabPermissionService.canAccessTab('location')
        .pipe(takeUntil(this.destroy$))
        .subscribe(canAccess => {
          this.canDelete = canAccess;
        });
    } catch (error) {
      console.error('Error checking permissions:', error);
    }
  }

  private async loadLocationData() {
    this.isLoading = true;
    try {
      this.firestore.collection('locations', ref => ref.orderBy('stt', 'asc'))
        .valueChanges({ idField: 'id' })
        .pipe(takeUntil(this.destroy$))
        .subscribe((items: any[]) => {
          this.locationItems = items;
          
          // Sort by Vị Trí (A,B,C) then by STT
          this.locationItems.sort((a, b) => {
            // First sort by Vị Trí alphabetically
            const viTriComparison = a.viTri.localeCompare(b.viTri);
            if (viTriComparison !== 0) return viTriComparison;
            // If Vị Trí is same, sort by STT
            return a.stt - b.stt;
          });
          
          // Reassign STT automatically starting from 1
          this.locationItems.forEach((item, index) => {
            item.stt = index + 1;
          });
          
          this.filteredItems = [...this.locationItems];
          this.updateTotalCount();
          this.calculateNextStt();
          this.isLoading = false;
        });
    } catch (error) {
      console.error('Error loading location data:', error);
      this.isLoading = false;
    }
  }

  toggleDropdown(event: Event) {
    event.stopPropagation();
    this.isDropdownOpen = !this.isDropdownOpen;
  }

  private updateTotalCount() {
    this.totalCountSubject.next(this.filteredItems.length);
  }
  
  private calculateNextStt() {
    // STT sẽ luôn là số tiếp theo sau số cuối cùng
    this.nextStt = this.locationItems.length + 1;
  }

  onSearchInput(event: any) {
    const term = event.target.value;
    this.searchTerm = term;
    this.searchSubject.next(term);
  }

  onSearchKeyUp(event: any) {
    if (event.key === 'Enter') {
      this.performSearch(this.searchTerm);
    }
  }

  private performSearch(term: string) {
    if (!term || term.trim().length < 2) {
      this.filteredItems = [...this.locationItems];
    } else {
      this.filteredItems = this.locationItems.filter(item => {
        const searchLower = term.toLowerCase();
        return (
          item.stt.toString().includes(searchLower) ||
          item.viTri.toLowerCase().includes(searchLower) ||
          item.qrCode.toLowerCase().includes(searchLower)
        );
      });
    }
    this.updateTotalCount();
  }

  clearSearch() {
    this.searchTerm = '';
    this.filteredItems = [...this.locationItems];
    this.updateTotalCount();
  }

  refreshData() {
    this.loadLocationData();
  }

  // Generate QR code based on location
  generateQRCode(viTri: string): string {
    if (!viTri) return '';
    // QR code chỉ chứa nội dung vị trí
    return viTri.toUpperCase();
  }

  // Format and validate viTri input
  formatViTriInput(input: string): string {
    if (!input) return '';
    
    // Remove all spaces and convert to uppercase
    let formatted = input.replace(/\s/g, '').toUpperCase();
    
    // Only allow letters, numbers, dots, and hyphens
    formatted = formatted.replace(/[^A-Z0-9.-]/g, '');
    
    return formatted;
  }

  // Validate viTri input
  validateViTriInput(input: string): boolean {
    if (!input) return false;
    
    // Check if contains only allowed characters
    const allowedPattern = /^[A-Z0-9.-]+$/;
    return allowedPattern.test(input);
  }

  // Handle viTri input change
  onViTriInputChange(event: any, isEditing: boolean = false) {
    const input = event.target.value;
    const formatted = this.formatViTriInput(input);
    
    if (isEditing && this.editingItem) {
      this.editingItem.viTri = formatted;
    } else {
      this.newItem.viTri = formatted;
    }
    
    // Update the input value to show formatted result
    event.target.value = formatted;
  }

  // Add new location item
  addLocationItem() {
    if (!this.newItem.viTri) {
      alert('Vui lòng nhập Vị Trí');
      return;
    }

    // Validate viTri format
    if (!this.validateViTriInput(this.newItem.viTri)) {
      alert('Vị Trí chỉ được chứa chữ cái, số, dấu chấm (.) và dấu gạch ngang (-)');
      return;
    }

    // Check if Vị Trí already exists
    if (this.locationItems.find(item => item.viTri === this.newItem.viTri)) {
      alert('Vị Trí đã tồn tại, vui lòng chọn Vị Trí khác');
      return;
    }

    const newItem: Omit<LocationItem, 'id'> = {
      stt: this.nextStt, // Use auto-generated STT
      viTri: this.newItem.viTri!,
      qrCode: this.generateQRCode(this.newItem.viTri!),
      createdAt: new Date()
    };

    this.firestore.collection('locations').add(newItem).then(() => {
      console.log('Added new location item');
      this.resetNewItemForm();
      this.refreshData();
    }).catch(error => {
      console.error('Error adding location item:', error);
    });
  }

  // Edit location item
  editLocationItem(item: LocationItem) {
    this.editingItem = { ...item };
  }

  // Save edited item
  saveEditedItem() {
    if (!this.editingItem) return;

    if (!this.editingItem.viTri) {
      alert('Vui lòng nhập Vị Trí');
      return;
    }

    // Validate viTri format
    if (!this.validateViTriInput(this.editingItem.viTri)) {
      alert('Vị Trí chỉ được chứa chữ cái, số, dấu chấm (.) và dấu gạch ngang (-)');
      return;
    }

    // Check if Vị Trí already exists (excluding current item)
    if (this.locationItems.find(item => 
      item.viTri === this.editingItem!.viTri && item.id !== this.editingItem!.id
    )) {
      alert('Vị Trí đã tồn tại, vui lòng chọn Vị Trí khác');
      return;
    }

    const updatedItem = {
      stt: this.editingItem.stt,
      viTri: this.editingItem.viTri,
      qrCode: this.generateQRCode(this.editingItem.viTri),
      updatedAt: new Date()
    };

    this.firestore.collection('locations').doc(this.editingItem.id!).update(updatedItem).then(() => {
      console.log('Updated location item');
      this.cancelEdit();
      this.refreshData();
    }).catch(error => {
      console.error('Error updating location item:', error);
    });
  }

  // Cancel edit
  cancelEdit() {
    this.editingItem = null;
  }

  // Reset new item form
  resetNewItemForm() {
    this.newItem = {
      viTri: '',
      qrCode: ''
    };
  }

  // Delete location item
  deleteLocationItem(item: LocationItem) {
    if (confirm(`Bạn có chắc muốn xóa vị trí ${item.viTri}?`)) {
      this.firestore.collection('locations').doc(item.id!).delete().then(() => {
        console.log(`Deleted location item: ${item.viTri}`);
        this.refreshData();
      }).catch(error => {
        console.error('Error deleting location item:', error);
      });
    }
  }

  // Export to Excel
  exportToExcel() {
    try {
      const exportData = this.filteredItems.map(item => ({
        'STT': item.stt,
        'Vị Trí': item.viTri,
        'QR Code': item.qrCode
      }));

      const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(exportData);
      const wb: XLSX.WorkBook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Location Data');
      
      XLSX.writeFile(wb, `Location_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
    }
  }

  // Initialize sample data
  initializeSampleData() {
    const sampleData: Omit<LocationItem, 'id'>[] = [
      { stt: 0, viTri: 'A1-01', qrCode: this.generateQRCode('A1-01'), createdAt: new Date() },
      { stt: 0, viTri: 'A1-02', qrCode: this.generateQRCode('A1-02'), createdAt: new Date() },
      { stt: 0, viTri: 'A2-01', qrCode: this.generateQRCode('A2-01'), createdAt: new Date() },
      { stt: 0, viTri: 'A2-02', qrCode: this.generateQRCode('A2-02'), createdAt: new Date() },
      { stt: 0, viTri: 'B1-01', qrCode: this.generateQRCode('B1-01'), createdAt: new Date() }
    ];

    // Clear existing data first
    this.firestore.collection('locations').get().subscribe(snapshot => {
      const batch = this.firestore.firestore.batch();
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      batch.commit().then(() => {
        // Add sample data
        const addBatch = this.firestore.firestore.batch();
        sampleData.forEach(item => {
          const docRef = this.firestore.collection('locations').doc().ref;
          addBatch.set(docRef, item);
        });
        
        addBatch.commit().then(() => {
          console.log('Sample data initialized');
          this.refreshData();
        });
      });
    });
  }

    // Print QR Code - Tem 50mm x 30mm
  async printQRCode(item: LocationItem) {
    try {
      // Tạo mã QR thực sự từ vị trí
      const qrImage = await QRCode.toDataURL(item.viTri, {
        width: 200, // 200px để đảm bảo chất lượng khi in
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });

      // Tạo nội dung để in QR code với kích thước 50mm x 30mm
      const printContent = `
        <div class="qr-label" style="
          width: 50mm; 
          height: 30mm; 
          border: 1px solid #000; 
          display: flex; 
          align-items: center; 
          padding: 2mm;
          box-sizing: border-box;
          font-family: Arial, sans-serif;
          background: white;
        ">
          <!-- Phía trái: Mã QR 25mm x 25mm -->
          <div class="qr-section" style="
            width: 25mm; 
            height: 25mm; 
            display: flex; 
            align-items: center; 
            justify-content: center;
            border: 1px solid #ccc;
            background: #f8f9fa;
            overflow: hidden;
          ">
            <img src="${qrImage}" 
                 alt="QR Code for ${item.viTri}" 
                 style="
                   width: 100%; 
                   height: 100%; 
                   object-fit: contain;
                   max-width: 23mm;
                   max-height: 23mm;
                 "
                 title="QR Code: ${item.viTri}">
          </div>
          
          <!-- Phía phải: Tên vị trí -->
          <div class="location-section" style="
            width: 20mm; 
            height: 25mm; 
            display: flex; 
            align-items: center; 
            justify-content: center;
            padding-left: 2mm;
          ">
            <div style="
              font-size: 14px; 
              font-weight: bold; 
              color: #000;
              font-family: 'Arial', sans-serif;
              text-align: center;
              line-height: 1.2;
              word-break: break-word;
            ">
              ${item.viTri}
            </div>
          </div>
        </div>
      `;
    
          const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>Location QR Code - ${item.viTri}</title>
              <style>
                body { 
                  margin: 0; 
                  padding: 10mm; 
                  font-family: Arial, sans-serif; 
                  background: #f0f0f0;
                }
                
                .qr-label {
                  margin: 0 auto;
                  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }
                
                @media print {
                  body { 
                    margin: 0; 
                    padding: 0; 
                    background: white;
                  }
                  .no-print { display: none; }
                  .qr-label {
                    box-shadow: none;
                    border: 1px solid #000 !important;
                  }
                }
              </style>
            </head>
            <body>
              ${printContent}
              <div class="no-print" style="margin-top: 20px; text-align: center;">
                <button onclick="window.print()" style="
                  background: #007bff; 
                  color: white; 
                  border: none; 
                  padding: 10px 20px; 
                  border-radius: 5px; 
                  cursor: pointer;
                  margin-right: 10px;
                ">Print QR Code</button>
                <button onclick="window.close()" style="
                  background: #6c757d; 
                  color: white; 
                  border: none; 
                  padding: 10px 20px; 
                  border-radius: 5px; 
                  cursor: pointer;
                ">Close</button>
              </div>
            </body>
          </html>
        `);
        printWindow.document.close();
      }
    } catch (error) {
      console.error('Error generating QR code:', error);
      alert('Lỗi khi tạo mã QR. Vui lòng thử lại.');
    }
  }

  trackByFn(index: number, item: LocationItem): string {
    return item.id || index.toString();
  }

  // Change Location Modal Methods
  openChangeLocationModal(): void {
    this.showChangeLocationModal = true;
    this.resetChangeLocation();
  }

  closeChangeLocationModal(): void {
    this.showChangeLocationModal = false;
    this.resetChangeLocation();
  }

  resetChangeLocation(): void {
    this.changeLocationStep = 1;
    this.selectedScannerType = null;
    this.scannedMaterialCode = '';
    this.scannedNewLocation = '';
    this.currentLocation = '';
    this.foundRM1Item = null;
  }

  selectScannerType(type: 'camera' | 'scanner'): void {
    this.selectedScannerType = type;
    this.changeLocationStep = 2;
    
    // Focus on material input after a short delay
    setTimeout(() => {
      const materialInput = document.querySelector('#materialInput') as HTMLInputElement;
      if (materialInput) {
        materialInput.focus();
      }
    }, 100);
  }

  processMaterialCode(): void {
    if (!this.scannedMaterialCode.trim()) {
      alert('Vui lòng nhập mã hàng');
      return;
    }

    // Search for material in RM1 inventory
    this.searchRM1Material(this.scannedMaterialCode.trim().toUpperCase());
  }

  private async searchRM1Material(materialCode: string): Promise<void> {
    try {
      console.log(`🔍 Searching for material: ${materialCode}`);
      
      // Query RM1 inventory collection
      const querySnapshot = await this.firestore.collection('rm1-inventory', ref => 
        ref.where('itemCode', '==', materialCode)
      ).get().toPromise();

      if (querySnapshot && !querySnapshot.empty) {
        // Found material in RM1 inventory
        const doc = querySnapshot.docs[0];
        const docData = doc.data() as any;
        this.foundRM1Item = {
          id: doc.id,
          ...docData
        };
        this.currentLocation = this.foundRM1Item.location || 'N/A';
        
        console.log(`✅ Found RM1 item:`, this.foundRM1Item);
        
        // Move to next step
        this.changeLocationStep = 3;
        
        // Focus on location input
        setTimeout(() => {
          const locationInput = document.querySelector('#locationInput') as HTMLInputElement;
          if (locationInput) {
            locationInput.focus();
          }
        }, 100);
        
      } else {
        alert(`Không tìm thấy mã hàng "${materialCode}" trong RM1 inventory`);
        this.scannedMaterialCode = '';
      }
    } catch (error) {
      console.error('Error searching RM1 material:', error);
      alert('Lỗi khi tìm kiếm mã hàng. Vui lòng thử lại.');
    }
  }

  processNewLocation(): void {
    if (!this.scannedNewLocation.trim()) {
      alert('Vui lòng nhập vị trí mới');
      return;
    }

    // Validate location format
    if (!this.validateViTriInput(this.scannedNewLocation.trim())) {
      alert('Vị trí chỉ được chứa chữ cái, số, dấu chấm (.) và dấu gạch ngang (-)');
      return;
    }

    this.scannedNewLocation = this.scannedNewLocation.trim().toUpperCase();
    this.changeLocationStep = 4;
  }

  async confirmLocationChange(): Promise<void> {
    if (!this.foundRM1Item || !this.scannedNewLocation) {
      alert('Thiếu thông tin để thực hiện thay đổi');
      return;
    }

    try {
      console.log(`🔄 Updating location for ${this.scannedMaterialCode} from ${this.currentLocation} to ${this.scannedNewLocation}`);
      
      // Update location in RM1 inventory
      await this.firestore.collection('rm1-inventory')
        .doc(this.foundRM1Item.id)
        .update({
          location: this.scannedNewLocation,
          lastUpdated: new Date()
        });

      console.log(`✅ Location updated successfully`);
      
      // Show success notification
      this.successMessage = `Đã thay đổi vị trí của ${this.scannedMaterialCode} từ ${this.currentLocation} thành ${this.scannedNewLocation}`;
      this.showSuccessNotification = true;
      
      // Auto hide notification after 3 seconds
      setTimeout(() => {
        this.showSuccessNotification = false;
      }, 3000);
      
      // Close modal
      this.closeChangeLocationModal();
      
    } catch (error) {
      console.error('Error updating location:', error);
      alert('Lỗi khi cập nhật vị trí. Vui lòng thử lại.');
    }
  }
}
