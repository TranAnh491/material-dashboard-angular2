import { Component, OnInit, OnDestroy, AfterViewInit, ChangeDetectorRef } from '@angular/core';
import { Subject, BehaviorSubject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import * as XLSX from 'xlsx';
import * as QRCode from 'qrcode';
import { TabPermissionService } from '../../services/tab-permission.service';
import { FactoryAccessService } from '../../services/factory-access.service';
import { QRScannerService, QRScanResult } from '../../services/qr-scanner.service';
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
  
  // QR Scanner properties
  isScanning = false;
  scannerState: 'idle' | 'starting' | 'scanning' | 'error' = 'idle';
  errorMessage = '';
  
  // Success notification
  showSuccessNotification = false;
  successMessage = '';
  
  private destroy$ = new Subject<void>();

  constructor(
    private firestore: AngularFirestore,
    private auth: AngularFireAuth,
    private tabPermissionService: TabPermissionService,
    private factoryAccessService: FactoryAccessService,
    private cdr: ChangeDetectorRef,
    private qrScannerService: QRScannerService
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
    
    // Stop scanner if active
    this.stopScanning();
    
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

  // Normalize location code for duplicate checking
  // Q1.1(L) -> Q11L, Q-1-1-L -> Q11L
  normalizeLocationCode(viTri: string): string {
    if (!viTri) return '';
    
    // Convert to uppercase and remove all special characters (dots, hyphens, parentheses)
    return viTri.toUpperCase().replace(/[.\-()]/g, '');
  }

  // Format and validate viTri input
  formatViTriInput(input: string): string {
    if (!input) return '';
    
    // Remove all spaces and convert to uppercase
    let formatted = input.replace(/\s/g, '').toUpperCase();
    
    // Only allow letters, numbers, dots, hyphens, and parentheses (escape parentheses)
    formatted = formatted.replace(/[^A-Z0-9.\-()]/g, '');
    
    return formatted;
  }

  // Validate viTri input
  validateViTriInput(input: string): boolean {
    if (!input) return false;
    
    // Check if contains only allowed characters: letters, numbers, dots, hyphens, and parentheses (escape parentheses)
    const allowedPattern = /^[A-Z0-9.\-()]+$/;
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
      alert('Vị Trí chỉ được chứa chữ cái, số, dấu chấm (.), dấu gạch ngang (-) và dấu ngoặc đơn ()');
      return;
    }

    // Check if Vị Trí already exists (exact match)
    if (this.locationItems.find(item => item.viTri === this.newItem.viTri)) {
      alert('Vị Trí đã tồn tại, vui lòng chọn Vị Trí khác');
      return;
    }

    // Check if normalized Vị Trí already exists (Q1.1(L) vs Q-1-1-L both become Q11L)
    const normalizedNewViTri = this.normalizeLocationCode(this.newItem.viTri);
    const duplicateItem = this.locationItems.find(item => {
      const normalizedExistingViTri = this.normalizeLocationCode(item.viTri);
      return normalizedExistingViTri === normalizedNewViTri;
    });

    if (duplicateItem) {
      alert(`Vị trí "${this.newItem.viTri}" trùng với vị trí đã có "${duplicateItem.viTri}" (cả hai đều đọc là "${normalizedNewViTri}")`);
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
      alert('Vị Trí chỉ được chứa chữ cái, số, dấu chấm (.), dấu gạch ngang (-) và dấu ngoặc đơn ()');
      return;
    }

    // Check if Vị Trí already exists (exact match, excluding current item)
    if (this.locationItems.find(item => 
      item.viTri === this.editingItem!.viTri && item.id !== this.editingItem!.id
    )) {
      alert('Vị Trí đã tồn tại, vui lòng chọn Vị Trí khác');
      return;
    }

    // Check if normalized Vị Trí already exists (Q1.1(L) vs Q-1-1-L both become Q11L)
    const normalizedNewViTri = this.normalizeLocationCode(this.editingItem.viTri);
    const duplicateItem = this.locationItems.find(item => {
      if (item.id === this.editingItem!.id) return false; // Skip current item
      const normalizedExistingViTri = this.normalizeLocationCode(item.viTri);
      return normalizedExistingViTri === normalizedNewViTri;
    });

    if (duplicateItem) {
      alert(`Vị trí "${this.editingItem.viTri}" trùng với vị trí đã có "${duplicateItem.viTri}" (cả hai đều đọc là "${normalizedNewViTri}")`);
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

  // Import locations from file
  importLocations() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.processImportFile(file);
      }
    };
    input.click();
  }

  // Process imported file
  // IMPORTANT: This function ADDS new data to existing data, does NOT replace/delete existing data
  private processImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        console.log('📋 Imported data:', jsonData);
        console.log('ℹ️ IMPORT MODE: Adding new data to existing data (not replacing)');
        
        // Skip header row (dòng 1) and process all data from row 2 onwards
        const locations = [];
        const normalizedCodes = new Set<string>(); // Track normalized codes to prevent duplicates
        
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i] as any[];
          if (row && row[0] && row[0].toString().trim()) {
            const viTri = row[0].toString().trim().toUpperCase();
            console.log(`📋 Processing row ${i + 1}: "${viTri}"`);
            
            if (this.validateViTriInput(viTri)) {
              const normalizedCode = this.normalizeLocationCode(viTri);
              
              // Check for duplicates within import data
              if (normalizedCodes.has(normalizedCode)) {
                console.log(`❌ Duplicate in import data: ${viTri} (normalized: ${normalizedCode})`);
                continue;
              }
              
              // Check for duplicates with existing data
              const existingDuplicate = this.locationItems.find(item => {
                const normalizedExistingViTri = this.normalizeLocationCode(item.viTri);
                return normalizedExistingViTri === normalizedCode;
              });
              
              if (existingDuplicate) {
                console.log(`❌ Duplicate with existing: ${viTri} vs ${existingDuplicate.viTri} (both normalized to: ${normalizedCode})`);
                continue;
              }
              
              normalizedCodes.add(normalizedCode);
              locations.push({
                stt: 0, // Will be auto-assigned
                viTri: viTri,
                qrCode: this.generateQRCode(viTri),
                createdAt: new Date()
              });
              console.log(`✅ Valid location added: ${viTri} (normalized: ${normalizedCode})`);
            } else {
              console.log(`❌ Invalid location format: ${viTri}`);
            }
          } else {
            console.log(`⚠️ Empty row ${i + 1}, skipping`);
          }
        }
        
        console.log(`📊 Total valid locations found: ${locations.length}`);
        
        if (locations.length > 0) {
          this.saveImportedLocations(locations);
        } else {
          alert('Không tìm thấy dữ liệu hợp lệ để import. Vui lòng kiểm tra:\n- Dòng 1 phải là tiêu đề "Vị trí"\n- Từ dòng 2 trở đi phải có dữ liệu vị trí\n- Định dạng vị trí chỉ được chứa chữ cái, số, dấu chấm (.), dấu gạch ngang (-) và dấu ngoặc đơn ()');
        }
      } catch (error) {
        console.error('Error processing file:', error);
        alert('Lỗi khi đọc file. Vui lòng kiểm tra định dạng file.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // Save imported locations to database
  // IMPORTANT: This function ADDS new locations to existing data, does NOT replace existing data
  private saveImportedLocations(locations: Omit<LocationItem, 'id'>[]) {
    const batch = this.firestore.firestore.batch();
    
    // Add each new location as a new document (preserves existing data)
    locations.forEach(location => {
      const docRef = this.firestore.collection('locations').doc().ref;
      batch.set(docRef, location); // This ADDS new data, doesn't replace
    });
    
    batch.commit().then(() => {
      console.log(`✅ Imported ${locations.length} new locations (added to existing data)`);
      this.refreshData();
      alert(`✅ Đã import thành công ${locations.length} vị trí mới!\n\n📝 Lưu ý: Dữ liệu mới được THÊM VÀO dữ liệu cũ, không thay thế dữ liệu cũ.`);
    }).catch(error => {
      console.error('Error importing locations:', error);
      alert('Lỗi khi import dữ liệu. Vui lòng thử lại.');
    });
  }

  // Download template file
  downloadTemplate() {
    try {
      const templateData = [
        ['Vị trí'], // Tiêu đề cột
        ['A1-01'],  // Dòng 2 - sẽ được import
        ['A1-02'],  // Dòng 3 - sẽ được import
        ['A2-01'],  // Dòng 4 - sẽ được import
        ['A2-02'],  // Dòng 5 - sẽ được import
        ['B1-01'],  // Dòng 6 - sẽ được import
        ['B1-02'],  // Dòng 7 - sẽ được import
        ['B2-01'],  // Dòng 8 - sẽ được import
        ['C1-01'],  // Dòng 9 - sẽ được import
        ['C1-02'],  // Dòng 10 - sẽ được import
        ['D1.01'],  // Dòng 11 - ví dụ với dấu chấm
        ['D1.02'],  // Dòng 12 - ví dụ với dấu chấm
        ['E1(01)'], // Dòng 13 - ví dụ với dấu ngoặc đơn
        ['E1(02)'], // Dòng 14 - ví dụ với dấu ngoặc đơn
        ['F1-01.02'], // Dòng 15 - ví dụ kết hợp dấu gạch ngang và chấm
        ['G1(01)-02'] // Dòng 16 - ví dụ kết hợp dấu ngoặc đơn và gạch ngang
      ];

      const ws: XLSX.WorkSheet = XLSX.utils.aoa_to_sheet(templateData);
      const wb: XLSX.WorkBook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Location Template');
      
      XLSX.writeFile(wb, 'Location_Template.xlsx');
    } catch (error) {
      console.error('Error creating template:', error);
      alert('Lỗi khi tạo template. Vui lòng thử lại.');
    }
  }

  // Delete all locations
  deleteAllLocations() {
    if (confirm('Bạn có chắc muốn xóa TẤT CẢ vị trí? Hành động này không thể hoàn tác!')) {
      this.firestore.collection('locations').get().subscribe(snapshot => {
        const batch = this.firestore.firestore.batch();
        snapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        
        batch.commit().then(() => {
          console.log('All locations deleted');
          this.refreshData();
          alert('Đã xóa tất cả vị trí');
        }).catch(error => {
          console.error('Error deleting all locations:', error);
          alert('Lỗi khi xóa dữ liệu. Vui lòng thử lại.');
        });
      });
    }
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
    
    // Stop scanner if active
    this.stopScanning();
  }

  selectScannerType(type: 'camera' | 'scanner'): void {
    this.selectedScannerType = type;
    this.changeLocationStep = 2;
    
    if (type === 'camera') {
      // Start QR scanner for material code
      this.startMaterialScanning();
    } else {
      // Focus on material input for scanner
    setTimeout(() => {
      const materialInput = document.querySelector('#materialInput') as HTMLInputElement;
      if (materialInput) {
        materialInput.focus();
      }
    }, 100);
    }
  }

  processMaterialCode(): void {
    if (!this.scannedMaterialCode.trim()) {
      alert('Vui lòng nhập mã hàng');
      return;
    }

    // Validate and parse the scanned code
    const parsedData = this.parseScannedCode(this.scannedMaterialCode.trim());
    
    // Check if parsing was successful
    if (!parsedData.materialCode) {
      alert('🏷️ TEM LỖI - Format mã QR không đúng');
      this.scannedMaterialCode = '';
      return;
    }

    // Search for material in RM1 inventory
    this.searchRM1Material(parsedData);
  }

  // Parse scanned code: B001639|KZPO0425/0114|150|13082025
  // Rules: 
  // - First 7 chars (0-6): Material Code
  // - Chars 9-21: PO Number  
  // - Last 8 chars: IMD (Import Date)
  private parseScannedCode(scannedCode: string): any {
    const cleanCode = scannedCode.replace(/\s/g, ''); // Remove spaces
    
    // Validate basic format
    if (cleanCode.length < 7) {
      console.log(`❌ Code too short: ${cleanCode}`);
      return {
        materialCode: null,
        poNumber: null,
        batch: null,
        quantity: null,
        originalCode: scannedCode,
        error: 'Code too short'
      };
    }
    
    if (cleanCode.includes('|') && cleanCode.length >= 25) {
      // Full format QR code validation
      const parts = cleanCode.split('|');
      if (parts.length < 4) {
        console.log(`❌ Invalid format - not enough parts: ${parts.length}`);
        return {
          materialCode: null,
          poNumber: null,
          batch: null,
          quantity: null,
          originalCode: scannedCode,
          error: 'Invalid format'
        };
      }
      
      // Parse by splitting and position
      const materialCode = parts[0]; // First part: B001639 (but take only 7 chars)
      const poNumber = parts[1]; // Second part: KZPO0425/0114
      const quantity = parts[2]; // Third part: 150
      const imd = parts[3]; // Fourth part: 13082025 or 08092025 (Import Date)
      
      // Ensure material code is exactly 7 characters
      const finalMaterialCode = materialCode.substring(0, 7);
      
      // Validate material code format (should be letters and numbers)
      if (!/^[A-Za-z0-9]{7}$/.test(finalMaterialCode)) {
        console.log(`❌ Invalid material code format: ${finalMaterialCode}`);
        return {
          materialCode: null,
          poNumber: null,
          batch: null,
          quantity: null,
          originalCode: scannedCode,
          error: 'Invalid material code format'
        };
      }
      
      // Validate IMD format (should be 8 digits)
      if (!/^\d{8}$/.test(imd)) {
        console.log(`❌ Invalid IMD format: ${imd}`);
        return {
          materialCode: null,
          poNumber: null,
          imd: null,
          quantity: null,
          originalCode: scannedCode,
          error: 'Invalid IMD format'
        };
      }
      
      console.log(`✅ Valid QR Code parsed:`, {
        originalCode: scannedCode,
        cleanCode: cleanCode,
        parts: parts,
        finalMaterialCode: finalMaterialCode,
        poNumber: poNumber,
        imd: imd,
        quantity: quantity,
        codeLength: cleanCode.length
      });
      
      return {
        materialCode: finalMaterialCode.toUpperCase(),
        poNumber: poNumber,
        imd: imd,
        quantity: quantity,
        originalCode: scannedCode
      };
    } else {
      // Fallback: treat as plain material code if length is reasonable
      if (cleanCode.length >= 7) {
        const materialCode = cleanCode.substring(0, 7);
        console.log(`📋 Fallback parsing - using as material code: ${materialCode}`);
        return {
          materialCode: materialCode.toUpperCase(),
          poNumber: null,
          imd: null,
          quantity: null,
          originalCode: scannedCode
        };
      } else {
        console.log(`❌ Code too short for fallback: ${cleanCode}`);
        return {
          materialCode: null,
          poNumber: null,
          imd: null,
          quantity: null,
          originalCode: scannedCode,
          error: 'Code too short'
        };
      }
    }
  }

  private async searchRM1Material(parsedData: any): Promise<void> {
    try {
      console.log(`🔍 Searching for material:`, parsedData);
      
      // Check multiple collections for the IMD (Import Date)
      console.log(`🔍 Checking multiple collections for IMD ${parsedData.imd}...`);
      
      // Skip inbound and outbound collections for IMD-based search
      // Focus only on inventory-materials since it has the actual Import Date field
      console.log(`🔍 Focusing on INVENTORY-MATERIALS for IMD-based search...`);
      
      // Check INVENTORY-MATERIALS with Import Date matching
      console.log(`🔍 Checking INVENTORY-MATERIALS with Import Date matching...`);
      
      // Convert IMD (DDMMYYYY) to Date for comparison
      const imdStr = parsedData.imd; // e.g., "13082024"
      const day = parseInt(imdStr.substring(0, 2));
      const month = parseInt(imdStr.substring(2, 4)) - 1; // Month is 0-indexed
      const year = parseInt(imdStr.substring(4, 8));
      const searchDate = new Date(year, month, day);
      
      console.log(`🔍 Searching for Import Date: ${searchDate.toLocaleDateString('vi-VN')} (from IMD: ${imdStr})`);
      
      // Query inventory-materials by materialCode, poNumber, and importDate
      const inventoryQuery = this.firestore.collection('inventory-materials', ref => 
        ref.where('materialCode', '==', parsedData.materialCode)
           .where('factory', '==', 'ASM1')
           .where('poNumber', '==', parsedData.poNumber)
      );
      
      const inventorySnapshot = await inventoryQuery.get().toPromise();
      console.log(`📋 INVENTORY-MATERIALS - Found ${inventorySnapshot?.docs.length || 0} records with Material + PO match`);
      
      // Filter by Import Date manually (since Firestore date queries can be tricky)
      const matchingInventoryDocs = inventorySnapshot?.docs.filter(doc => {
        const data = doc.data() as any;
        if (data.importDate) {
          const docDate = data.importDate.toDate();
          const docDateStr = docDate.toLocaleDateString('en-GB').split('/').join(''); // Convert to DDMMYYYY
          console.log(`📅 Comparing: IMD ${imdStr} vs Doc Date ${docDateStr}`);
          return docDateStr === imdStr;
        }
        return false;
      }) || [];
      
      console.log(`📋 INVENTORY-MATERIALS (with matching Import Date) - Found ${matchingInventoryDocs.length} records`);
      
      // Check if found in inventory-materials with matching IMD
      if (matchingInventoryDocs && matchingInventoryDocs.length > 0) {
        const foundDoc = matchingInventoryDocs[0];
        const foundRecord = foundDoc.data() as any;
        
        this.foundRM1Item = {
          id: foundDoc.id,
          ...foundRecord,
          parsedData: parsedData
        };
        
        this.currentLocation = this.foundRM1Item.location || 'N/A';
        
        console.log(`✅ Found in INVENTORY-MATERIALS with matching Import Date:`, this.foundRM1Item);
        
        // Move to next step
        this.changeLocationStep = 3;
        
        // Initialize location scanner if camera was selected
        setTimeout(() => {
          this.initializeLocationScannerForStep3();
          
          const locationInput = document.querySelector('#locationInput') as HTMLInputElement;
          if (locationInput) {
            locationInput.focus();
          }
        }, 100);
        
        return;
      }
      // If not found, show error
      console.log(`❌ Material not found in RM1 Inventory`);
      alert(`❌ Không tìm thấy mã hàng trong RM1 Inventory!\n\nMã hàng: ${parsedData.materialCode}\nPO: ${parsedData.poNumber}\nIMD: ${parsedData.imd}\n\nVui lòng kiểm tra lại thông tin.`);
      this.scannedMaterialCode = '';
      return;
    } catch (error) {
      console.error('❌ Error searching for material:', error);
      alert('❌ Lỗi khi tìm kiếm mã hàng. Vui lòng thử lại.');
      this.scannedMaterialCode = '';
    }
  }

  initializeLocationScannerForStep3(): void {
    console.log(`🔧 Initializing location scanner for step 3...`);
    
    if (this.selectedScannerTypes.step3 === 'camera') {
      // Start QR scanner for step 3
      setTimeout(() => {
        console.log(`📸 Starting QR scanner for location (step 3)...`);
        this.startQRScannerForStep(3);
      }, 200);
    }
  }

  confirmLocationChange(): void {
    if (!this.foundRM1Item || !this.newLocation) {
      alert('❌ Thiếu thông tin. Vui lòng scan lại.');
      return;
    }

    // Validate new location format
    if (!this.validateViTriInput(this.newLocation)) {
      alert('❌ Vị trí không hợp lệ. Chỉ cho phép chữ cái, số, dấu chấm (.), gạch ngang (-), và ngoặc đơn (()).');
      return;
    }

    const formattedLocation = this.formatViTriInput(this.newLocation);
    
    // Check if new location exists in location list
    const locationExists = this.locationItems.some(item => 
      this.normalizeLocationCode(item.viTri) === this.normalizeLocationCode(formattedLocation)
    );

    if (!locationExists) {
      alert(`❌ Vị trí "${formattedLocation}" không tồn tại trong danh sách vị trí.\n\nVui lòng chọn vị trí hợp lệ hoặc thêm vị trí mới trước.`);
      return;
    }

    // Show confirmation dialog
    const confirmMessage = `🔄 Xác nhận thay đổi vị trí:\n\n` +
      `Mã hàng: ${this.foundRM1Item.materialCode}\n` +
      `PO: ${this.foundRM1Item.poNumber}\n` +
      `IMD: ${this.foundRM1Item.parsedData.imd}\n\n` +
      `Từ: ${this.currentLocation}\n` +
      `Đến: ${formattedLocation}\n\n` +
      `Bạn có chắc chắn muốn thay đổi?`;

    if (confirm(confirmMessage)) {
      this.updateRM1LocationInFirebase(formattedLocation);
    }
  }

  async updateRM1LocationInFirebase(newLocation: string): Promise<void> {
    try {
      console.log(`🔄 Updating location in Firebase...`);
      
      const docRef = this.firestore.collection('inventory-materials').doc(this.foundRM1Item.id);
      
      await docRef.update({
        location: newLocation,
        lastModified: new Date(),
        modifiedBy: 'location-change-scanner'
      });

      console.log(`✅ Location updated successfully!`);
      
      alert(`✅ Đã cập nhật vị trí thành công!\n\n` +
        `Mã hàng: ${this.foundRM1Item.materialCode}\n` +
        `PO: ${this.foundRM1Item.poNumber}\n` +
        `IMD: ${this.foundRM1Item.parsedData.imd}\n` +
        `Vị trí mới: ${newLocation}`);

      // Reset and close modal
      this.resetChangeLocation();
      this.closeChangeLocationModal();

    } catch (error) {
      console.error('❌ Error updating location:', error);
      alert(`❌ Lỗi khi cập nhật vị trí: ${error}`);
    }
  }

  // Helper function to wait for element
  private waitForElement(selector: string): Promise<Element> {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver(() => {
        const element = document.querySelector(selector);
        if (element) {
          observer.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element ${selector} not found`));
      }, 5000);
    });
  }
}