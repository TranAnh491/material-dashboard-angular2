import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { FactoryAccessService } from '../../services/factory-access.service';
import { MatDialog } from '@angular/material/dialog';
import { QRScannerModalComponent, QRScannerData } from '../../components/qr-scanner-modal/qr-scanner-modal.component';

export interface FGInventoryItem {
  id?: string;
  factory?: string;
  importDate: Date;
  receivedDate: Date;
  batchNumber: string;
  materialCode: string;
  lot: string;
  lsx: string;
  quantity: number;
  standard: number; // Standard từ catalog
  carton: number;
  odd: number;
  tonDau: number; // Tồn đầu
  nhap: number;   // Nhập (từ FG In)
  xuat: number;   // Xuất
  ton: number;    // Tồn kho hiện tại
  location: string;
  notes: string;
  customer: string;
  isReceived: boolean;
  isCompleted: boolean;
  isDuplicate: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ProductCatalogItem {
  id?: string;
  materialCode: string; // Mã TP
  standard: string; // Standard
  customer: string; // Khách
  createdAt?: Date;
  updatedAt?: Date;
}

@Component({
  selector: 'app-fg-inventory',
  templateUrl: './fg-inventory.component.html',
  styleUrls: ['./fg-inventory.component.scss']
})
export class FGInventoryComponent implements OnInit, OnDestroy {
  materials: FGInventoryItem[] = [];
  filteredMaterials: FGInventoryItem[] = [];

  // Search and filter
  searchTerm: string = '';
  
  // Factory filter - FG Inventory is only for ASM1
  selectedFactory: string = 'ASM1';
  availableFactories: string[] = ['ASM1'];

  // Catalog data (loaded once)
  catalogItems: ProductCatalogItem[] = [];
  catalogLoaded: boolean = false;



  // Search optimization
  private searchSubject = new Subject<string>();
  
  // Loading state
  isLoading: boolean = false;
  
  // Time range filter
  showTimeRangeDialog: boolean = false;
  startDate: Date = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  endDate: Date = new Date();
  
  // Display options
  showCompleted: boolean = true;
  
  // Permissions
  hasDeletePermission: boolean = false;
  hasCompletePermission: boolean = false;
  
  private destroy$ = new Subject<void>();

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private factoryAccessService: FactoryAccessService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.setupDebouncedSearch();
    this.loadCatalogFromFirebase(); // Load catalog first
    this.loadMaterialsFromFirebase();
    this.startDate = new Date(2020, 0, 1);
    this.endDate = new Date(2030, 11, 31);
    this.applyFilters();
    this.loadPermissions();
    this.loadFactoryAccess();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Setup debounced search for better performance
  private setupDebouncedSearch(): void {
    this.searchSubject.pipe(
      debounceTime(1000), // Đợi 1 giây sau khi user ngừng gõ
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(searchTerm => {
      this.performSearch(searchTerm);
    });
  }

  // Load materials from Firebase - OPTIMIZED for performance
  loadMaterialsFromFirebase(): void {
    this.isLoading = true;
    
    // Use .get() instead of snapshotChanges() for better performance
    this.firestore.collection('fg-inventory')
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe((querySnapshot) => {
        const firebaseMaterials = querySnapshot.docs.map(doc => {
          const data = doc.data() as any;
          const id = doc.id;
          
          // Skip logging for performance
          
          return {
            id: id,
            factory: data.factory || 'ASM1',
            importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : new Date(),
            receivedDate: data.receivedDate ? new Date(data.receivedDate.seconds * 1000) : new Date(),
            batchNumber: data.batchNumber || '',
            materialCode: data.materialCode || data.maTP || '',
            lot: data.lot || data.Lot || '',
            lsx: data.lsx || data.LSX || '',
            quantity: data.quantity || 0,
            standard: data.standard || 0,
            carton: data.carton || 0,
            odd: data.odd || 0,
            tonDau: data.tonDau || 0,
            nhap: data.nhap || data.quantity || 0,
            xuat: data.xuat || data.exported || 0,
            ton: data.ton || data.stock || 0,
            location: data.location || data.viTri || 'Temporary',
            notes: data.notes || data.ghiChu || '',
            customer: data.customer || data.khach || '',
            isReceived: data.isReceived || false,
            isCompleted: data.isCompleted || false,
            isDuplicate: data.isDuplicate || false,
            createdAt: data.createdAt ? new Date(data.createdAt.seconds * 1000) : new Date(),
            updatedAt: data.updatedAt ? new Date(data.updatedAt.seconds * 1000) : new Date()
          };
        });
        
        this.materials = firebaseMaterials;
        
        // Calculate Tồn only for materials that need it (optimized)
        const materialsToUpdate: FGInventoryItem[] = [];
        this.materials.forEach(material => {
          // Only calculate if ton is missing or zero
          if (!material.ton || material.ton === 0) {
            const calculatedTon = this.calculateTon(material);
            if (calculatedTon > 0) {
              material.ton = calculatedTon;
              materialsToUpdate.push(material);
            }
          }
        });
        
        // Only update if there are changes (reduce Firebase calls)
        if (materialsToUpdate.length > 0) {
          console.log(`Updated Tồn for ${materialsToUpdate.length} materials`);
          // Batch update for better performance
          materialsToUpdate.forEach(material => {
            this.updateMaterialInFirebase(material);
          });
        }
        
        this.sortMaterials();
        this.applyFilters();
        this.isLoading = false;
      });
  }

  // Update material in Firebase
  updateMaterialInFirebase(material: FGInventoryItem): void {
    if (material.id) {
      const updateData = {
        ...material,
        importDate: material.importDate,
        receivedDate: material.receivedDate,
        updatedAt: new Date()
      };
      
      delete updateData.id;
      
      this.firestore.collection('fg-inventory').doc(material.id).update(updateData)
        .then(() => {
          console.log('FG Inventory material updated in Firebase successfully');
        })
        .catch(error => {
          console.error('Error updating FG Inventory material in Firebase:', error);
        });
    }
  }

  // Delete material
  deleteMaterial(material: FGInventoryItem): void {
    if (material.id) {
      this.firestore.collection('fg-inventory').doc(material.id).delete()
        .then(() => {
          console.log('FG Inventory material deleted from Firebase successfully');
        })
        .catch(error => {
          console.error('Error deleting FG Inventory material from Firebase:', error);
        });
    }
    
    // Remove from local array immediately
    const index = this.materials.indexOf(material);
    if (index > -1) {
      this.materials.splice(index, 1);
      console.log(`Deleted FG Inventory material: ${material.materialCode}`);
      this.applyFilters();
    }
  }

  // Delete item (alias for deleteMaterial)
  deleteItem(material: FGInventoryItem): void {
    this.deleteMaterial(material);
  }

  // Helper method to parse LSX for sorting
  private parseLSXForSorting(lsx: string): { year: number, month: number, sequence: number } {
    if (!lsx || lsx.length < 9) {
      return { year: 9999, month: 12, sequence: 9999 }; // Put invalid LSX at the end
    }
    
    // Get last 9 characters: mmyy/xxxx
    const last9Chars = lsx.slice(-9);
    const parts = last9Chars.split('/');
    
    if (parts.length !== 2) {
      return { year: 9999, month: 12, sequence: 9999 }; // Invalid format
    }
    
    const mmyy = parts[0]; // MMYY
    const xxxx = parts[1]; // XXXX
    
    if (mmyy.length !== 4 || xxxx.length !== 4) {
      return { year: 9999, month: 12, sequence: 9999 }; // Invalid format
    }
    
    const month = parseInt(mmyy.substring(0, 2));
    const year = parseInt(mmyy.substring(2, 4)) + 2000; // Convert YY to full year
    const sequence = parseInt(xxxx);
    
    return { year, month, sequence };
  }

  // Helper method to parse Batch for sorting
  private parseBatchForSorting(batch: string): { week: number, sequence: number } {
    if (!batch || batch.length < 6) {
      return { week: 9999, sequence: 9999 }; // Put invalid batch at the end
    }
    
    // Format: WWXXXX
    const week = parseInt(batch.substring(0, 2));
    const sequence = parseInt(batch.substring(2, 6));
    
    return { week, sequence };
  }

  // Sort materials by material code (A-Z), then LSX, then Batch
  sortMaterials(): void {
    console.log('🔄 Sorting FG Inventory materials by: Mã hàng (A-Z) → LSX (year, month, sequence) → Batch (week, sequence)');
    
    this.materials.sort((a, b) => {
      // First sort by material code (A-Z)
      const materialCodeA = a.materialCode.toUpperCase();
      const materialCodeB = b.materialCode.toUpperCase();
      
      if (materialCodeA < materialCodeB) {
        return -1;
      }
      if (materialCodeA > materialCodeB) {
        return 1;
      }
      
      // If material codes are the same, sort by LSX
      const lsxA = this.parseLSXForSorting(a.lsx);
      const lsxB = this.parseLSXForSorting(b.lsx);
      
      // Sort by year (oldest first)
      if (lsxA.year !== lsxB.year) {
        return lsxA.year - lsxB.year;
      }
      
      // Then by month
      if (lsxA.month !== lsxB.month) {
        return lsxA.month - lsxB.month;
      }
      
      // Finally by sequence number
      if (lsxA.sequence !== lsxB.sequence) {
        return lsxA.sequence - lsxB.sequence;
      }
      
      // If LSX are the same, sort by Batch
      const batchA = this.parseBatchForSorting(a.batchNumber);
      const batchB = this.parseBatchForSorting(b.batchNumber);
      
      // Sort by week (oldest first)
      if (batchA.week !== batchB.week) {
        return batchA.week - batchB.week;
      }
      
      // Then by sequence number (smallest first)
      return batchA.sequence - batchB.sequence;
    });
    
    console.log(`✅ Sorted ${this.materials.length} FG Inventory materials`);
  }

  // Apply search filters
  applyFilters(): void {
    this.filteredMaterials = this.materials.filter(material => {
      // Show all materials if no search term
      if (!this.searchTerm || this.searchTerm.trim() === '') {
        return true; // Show all materials when no search term
      }
      
      // Filter by search term - SIMPLIFIED (data comes from FG In)
      const searchableText = [
        material.materialCode,
        material.batchNumber,
        material.location,
        material.lsx,
        material.lot,
        material.ton?.toString(),
        material.notes,
        material.customer // Customer data comes from FG In
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
      
      // Filter by date range
      const importDate = new Date(material.importDate);
      const isInDateRange = importDate >= this.startDate && importDate <= this.endDate;
      
      // Filter by completed status
      const isCompletedVisible = this.showCompleted || !material.isCompleted;
      
      return isInDateRange && isCompletedVisible;
    });
    
    // Sort filtered materials using the same logic as sortMaterials()
    this.filteredMaterials.sort((a, b) => {
      // First sort by material code (A-Z)
      const materialCodeA = a.materialCode.toUpperCase();
      const materialCodeB = b.materialCode.toUpperCase();
      
      if (materialCodeA < materialCodeB) {
        return -1;
      }
      if (materialCodeA > materialCodeB) {
        return 1;
      }
      
      // If material codes are the same, sort by LSX
      const lsxA = this.parseLSXForSorting(a.lsx);
      const lsxB = this.parseLSXForSorting(b.lsx);
      
      // Sort by year (oldest first)
      if (lsxA.year !== lsxB.year) {
        return lsxA.year - lsxB.year;
      }
      
      // Then by month
      if (lsxA.month !== lsxB.month) {
        return lsxA.month - lsxB.month;
      }
      
      // Finally by sequence number
      if (lsxA.sequence !== lsxB.sequence) {
        return lsxA.sequence - lsxB.sequence;
      }
      
      // If LSX are the same, sort by Batch
      const batchA = this.parseBatchForSorting(a.batchNumber);
      const batchB = this.parseBatchForSorting(b.batchNumber);
      
      // Sort by week (oldest first)
      if (batchA.week !== batchB.week) {
        return batchA.week - batchB.week;
      }
      
      // Then by sequence number (smallest first)
      return batchA.sequence - batchB.sequence;
    });
    
    console.log('FG Inventory search results:', {
      searchTerm: this.searchTerm,
      totalMaterials: this.materials.length,
      filteredMaterials: this.filteredMaterials.length
    });
  }

  // Search functionality with debouncing
  onSearchChange(event: any): void {
    let searchTerm = event.target.value;
    
    // Auto-convert to uppercase
    if (searchTerm && searchTerm !== searchTerm.toUpperCase()) {
      searchTerm = searchTerm.toUpperCase();
      event.target.value = searchTerm;
    }
    
    // Clear results immediately if search is empty
    if (!searchTerm || searchTerm.trim() === '') {
      this.clearSearch();
      return;
    }
    
    // Send to debounced search
    this.searchSubject.next(searchTerm);
  }

  // Clear search and reset to initial state
  clearSearch(): void {
    this.searchTerm = '';
    this.applyFilters(); // Show all materials
    console.log('Cleared search - showing all materials');
  }

  // Perform search with minimum character requirement
  private performSearch(searchTerm: string): void {
    if (searchTerm.length < 3) {
      this.applyFilters(); // Show all materials if search too short
      console.log(`Search term "${searchTerm}" quá ngắn (cần ít nhất 3 ký tự) - showing all materials`);
      return;
    }
    
    this.searchTerm = searchTerm;
    this.applyFilters();
  }

  // Format number with commas for thousands
  formatNumber(value: number | null | undefined): string {
    if (value === null || value === undefined) {
      return '0';
    }
    
    // Format with commas for thousands
    return value.toLocaleString('vi-VN');
  }

  // Load user permissions
  loadPermissions(): void {
    this.hasDeletePermission = true;
    this.hasCompletePermission = true;
  }

  // Load factory access permissions - FG Inventory is only for ASM1
  private loadFactoryAccess(): void {
    // FG Inventory is only for ASM1, so no need to load factory access
    this.selectedFactory = 'ASM1';
    this.availableFactories = ['ASM1'];
    
    console.log('🏭 Factory access set for FG Inventory (ASM1 only):', {
      selectedFactory: this.selectedFactory,
      availableFactories: this.availableFactories
    });
  }

  // Check if user can edit material
  canEditMaterial(material: FGInventoryItem): boolean {
    const materialFactory = material.factory || 'ASM1';
    return this.availableFactories.includes(materialFactory);
  }

  // Check if user can view material
  canViewMaterial(material: FGInventoryItem): boolean {
    const materialFactory = material.factory || 'ASM1';
    return this.availableFactories.includes(materialFactory);
  }

  // Format date
  private formatDate(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  // Import file functionality
  importFile(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,.xls';
    fileInput.style.display = 'none';
    
    fileInput.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.processExcelFile(file);
      }
    };
    
    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
  }

  private async processExcelFile(file: File): Promise<void> {
    try {
      const data = await this.readExcelFile(file);
      const materials = this.parseExcelData(data);
      
      this.materials = [...this.materials, ...materials];
      this.applyFilters();
      
      // Save to Firebase
      this.saveMaterialsToFirebase(materials);
      
      alert(`✅ Đã import thành công ${materials.length} materials từ file Excel!`);
      
    } catch (error) {
      console.error('Error processing Excel file:', error);
      alert(`❌ Lỗi khi import file Excel: ${error.message || error}`);
    }
  }

  private async readExcelFile(file: File): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);
          resolve(jsonData);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  private parseExcelData(data: any[]): FGInventoryItem[] {
    return data.map((row: any, index: number) => ({
      factory: 'ASM1',
      importDate: new Date(),
      receivedDate: new Date(),
      batchNumber: row['Batch'] || '',
      materialCode: row['Mã TP'] || '',
      lot: row['LOT'] || '',
      lsx: row['LSX'] || '',
      quantity: 0, // Not used in FG Inventory
      standard: 0, // Will be calculated from catalog
      carton: 0, // Will be calculated
      odd: 0, // Will be calculated
      tonDau: parseInt(row['Tồn Đầu']) || 0,
      nhap: 0, // Not in new template - will be set to 0
      xuat: 0, // Not in new template - will be set to 0
      ton: parseInt(row['Tồn Đầu']) || 0, // Initial ton = tonDau
      location: row['Vị Trí'] || 'Temporary',
      notes: '', // Not in new template
      customer: row['Khách'] || '',
      isReceived: true,
      isCompleted: false,
      isDuplicate: false,
      createdAt: new Date(),
      updatedAt: new Date()
    }));
  }

  private parseDate(dateStr: string): Date | null {
    if (!dateStr || dateStr.trim() === '') return null;
    
    if (typeof dateStr === 'string' && dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      }
    }
    
    return new Date(dateStr);
  }

  // Save materials to Firebase
  saveMaterialsToFirebase(materials: FGInventoryItem[]): void {
    materials.forEach(material => {
      const materialData = {
        ...material,
        importDate: material.importDate,
        receivedDate: material.receivedDate,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      delete materialData.id;
      
      this.firestore.collection('fg-inventory').add(materialData)
        .then((docRef) => {
          console.log('FG Inventory material saved to Firebase successfully with ID:', docRef.id);
        })
        .catch(error => {
          console.error('Error saving FG Inventory material to Firebase:', error);
        });
    });
  }

  // Download template
  downloadTemplate(): void {
    const templateData = [
      {
        'Batch': '010001',
        'Mã TP': 'P001234',
        'LOT': 'LOT001',
        'LSX': '0124/0001',
        'Tồn Đầu': 100,
        'Vị Trí': 'A1-01',
        'Khách': 'Customer A'
      },
      {
        'Batch': '010002',
        'Mã TP': 'P002345',
        'LOT': 'LOT002',
        'LSX': '0124/0002',
        'Tồn Đầu': 200,
        'Vị Trí': 'A1-02',
        'Khách': 'Customer B'
      },
      {
        'Batch': '020001',
        'Mã TP': 'P003456',
        'LOT': 'LOT003',
        'LSX': '0224/0001',
        'Tồn Đầu': 150,
        'Vị Trí': 'B1-01',
        'Khách': 'Customer C'
      }
    ];

    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(templateData);
    
    // Set column widths for better readability
    const colWidths = [
      { wch: 10 }, // Batch
      { wch: 12 }, // Mã TP
      { wch: 10 }, // LOT
      { wch: 12 }, // LSX
      { wch: 12 }, // Tồn Đầu
      { wch: 10 }, // Vị Trí
      { wch: 15 }  // Khách
    ];
    ws['!cols'] = colWidths;
    
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'FG_Inventory_Template.xlsx');
  }

  // Additional methods needed for the component
  editLocation(material: FGInventoryItem): void {
    const newLocation = prompt('Nhập vị trí (sẽ tự động viết hoa):', material.location || '');
    if (newLocation !== null) {
      material.location = newLocation.toUpperCase();
      material.updatedAt = new Date();
      console.log(`Updated location for ${material.materialCode}: ${material.location}`);
      this.updateMaterialInFirebase(material);
    }
  }



  updateNotes(material: FGInventoryItem): void {
    console.log('Updating notes for material:', material.materialCode, 'to:', material.notes);
    this.updateMaterialInFirebase(material);
  }

  // Scan location using QR code
  scanLocation(material: FGInventoryItem): void {
    const dialogData: QRScannerData = {
      title: `Scan QR Code - Đổi vị trí cho ${material.materialCode}`,
      message: `Vị trí hiện tại: ${material.location || 'Temporary'}`,
      materialCode: material.materialCode
    };

    const dialogRef = this.dialog.open(QRScannerModalComponent, {
      width: '500px',
      maxWidth: '95vw',
      data: dialogData,
      disableClose: true,
      panelClass: 'qr-scanner-dialog'
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result && result.trim() !== '') {
        const oldLocation = material.location;
        material.location = result.toUpperCase();
        
        // Update in Firebase
        this.updateMaterialInFirebase(material);
        
        console.log(`Updated location for ${material.materialCode}: ${oldLocation} → ${result}`);
        alert(`✅ Đã cập nhật vị trí cho ${material.materialCode}: ${result}`);
      }
    });
  }

  // Load catalog from Firebase (only once)
  loadCatalogFromFirebase(): void {
    if (this.catalogLoaded) {
      return; // Already loaded
    }

    this.firestore.collection('fg-catalog')
      .get()
      .subscribe((querySnapshot) => {
        this.catalogItems = querySnapshot.docs.map(doc => {
          const data = doc.data() as any;
          return {
            id: doc.id,
            materialCode: data.materialCode || '',
            standard: data.standard || '',
            customer: data.customer || '',
            createdAt: data.createdAt ? new Date(data.createdAt.seconds * 1000) : new Date(),
            updatedAt: data.updatedAt ? new Date(data.updatedAt.seconds * 1000) : new Date()
          };
        });
        this.catalogLoaded = true;
        console.log('Catalog loaded once:', this.catalogItems.length, 'items');
        
        // Only calculate Tồn - other data comes from FG In
      });
  }

  // Get customer from material data (no catalog lookup needed)
  getCustomerFromCatalog(materialCode: string): string {
    // Customer data comes from FG In, no lookup needed
    return '';
  }

  // Calculate Carton and ODD - data comes from FG In
  calculateCartonAndOdd(material: FGInventoryItem): { carton: number, odd: number } {
    // Data already calculated in FG In, just return stored values
    return { 
      carton: material.carton || 0, 
      odd: material.odd || 0 
    };
  }

  // Calculate and save Standard/Carton/ODD for materials that don't have them
  calculateAndSaveCartonOdd(): void {
    if (!this.catalogLoaded) {
      console.log('Catalog not loaded yet, skipping calculation');
      return; // Wait for catalog to load
    }

    console.log('Starting Standard/Carton/ODD calculation for', this.materials.length, 'materials');
    const materialsToUpdate: FGInventoryItem[] = [];

    this.materials.forEach(material => {
      let needsUpdate = false;
      
      // Get standard from catalog
      const catalogItem = this.catalogItems.find(item => item.materialCode === material.materialCode);
      if (catalogItem && catalogItem.standard && !isNaN(parseFloat(catalogItem.standard))) {
        const standardValue = parseFloat(catalogItem.standard);
        if (material.standard !== standardValue) {
          material.standard = standardValue;
          needsUpdate = true;
        }
      }
      
      // Calculate Tồn: Tồn Đầu + Nhập - Xuất = Tồn
      const calculatedTon = (material.tonDau || 0) + (material.nhap || 0) - (material.xuat || 0);
      if (material.ton !== calculatedTon) {
        material.ton = calculatedTon;
        needsUpdate = true;
      }
      
      // Calculate Carton/ODD if standard is available
      if (material.standard > 0) {
        const tonToUse = material.ton || 0;
        const newCarton = Math.ceil(tonToUse / material.standard);
        const newOdd = tonToUse % material.standard;
        
        if (material.carton !== newCarton || material.odd !== newOdd) {
          material.carton = newCarton;
          material.odd = newOdd;
          needsUpdate = true;
        }
      }
      
      if (needsUpdate) {
        materialsToUpdate.push(material);
        console.log(`Will update ${material.materialCode}: Tồn=${material.ton}, Standard=${material.standard}, Carton=${material.carton}, ODD=${material.odd}`);
      }
    });

    // Save updated materials to Firebase
    if (materialsToUpdate.length > 0) {
      console.log(`Updating Tồn/Standard/Carton/ODD for ${materialsToUpdate.length} materials`);
      materialsToUpdate.forEach(material => {
        this.updateMaterialInFirebase(material);
      });
    } else {
      console.log('No materials need Tồn/Standard/Carton/ODD calculation');
    }
  }

  // Calculate Tồn for a specific material - SIMPLIFIED
  calculateTon(material: FGInventoryItem): number {
    const tonDau = material.tonDau || 0;
    const nhap = material.nhap || 0;
    const xuat = material.xuat || 0;
    return tonDau + nhap - xuat;
  }

  // Update Tồn when Tồn đầu, Nhập, or Xuất changes
  updateTon(material: FGInventoryItem): void {
    const newTon = this.calculateTon(material);
    if (material.ton !== newTon) {
      material.ton = newTon;
      
      // Recalculate Carton/ODD based on new Tồn
      if (material.standard > 0) {
        material.carton = Math.ceil(material.ton / material.standard);
        material.odd = material.ton % material.standard;
      }
      
      this.updateMaterialInFirebase(material);
      console.log(`Updated Tồn for ${material.materialCode}: ${material.ton}, Carton: ${material.carton}, ODD: ${material.odd}`);
    }
  }

  // Debug Carton/ODD calculation
  debugCartonOdd(): void {
    console.log('=== DEBUG CARTON/ODD ===');
    console.log('Catalog loaded:', this.catalogLoaded);
    console.log('Catalog items:', this.catalogItems.length);
    console.log('Total materials:', this.materials.length);
    console.log('Filtered materials:', this.filteredMaterials.length);
    
    this.catalogItems.forEach((item, index) => {
      console.log(`Catalog ${index + 1}:`, {
        materialCode: item.materialCode,
        standard: item.standard,
        customer: item.customer
      });
    });
    
    this.materials.forEach((material, index) => {
      const calculation = this.calculateCartonAndOdd(material);
      const calculatedTon = this.calculateTon(material);
      console.log(`Material ${index + 1}:`, {
        materialCode: material.materialCode,
        tonDau: material.tonDau,
        nhap: material.nhap,
        xuat: material.xuat,
        ton: material.ton,
        calculatedTon: calculatedTon,
        standard: material.standard,
        carton: material.carton,
        odd: material.odd,
        calculatedCarton: calculation.carton,
        calculatedOdd: calculation.odd
      });
    });
    console.log('=== END DEBUG ===');
  }

  // Force calculate Tồn for all materials
  forceCalculateTon(): void {
    console.log('Force calculating Tồn for all materials...');
    const materialsToUpdate: FGInventoryItem[] = [];

    this.materials.forEach(material => {
      const calculatedTon = this.calculateTon(material);
      if (material.ton !== calculatedTon) {
        material.ton = calculatedTon;
        
        // Recalculate Carton/ODD based on new Tồn
        if (material.standard > 0) {
          material.carton = Math.ceil(material.ton / material.standard);
          material.odd = material.ton % material.standard;
        }
        
        materialsToUpdate.push(material);
        console.log(`Updated ${material.materialCode}: Tồn=${material.ton}, Carton=${material.carton}, ODD=${material.odd}`);
      }
    });

    // Save updated materials to Firebase
    if (materialsToUpdate.length > 0) {
      console.log(`Updating Tồn for ${materialsToUpdate.length} materials`);
      materialsToUpdate.forEach(material => {
        this.updateMaterialInFirebase(material);
      });
      alert(`✅ Đã cập nhật Tồn cho ${materialsToUpdate.length} materials!`);
    } else {
      console.log('No materials need Tồn calculation');
      alert('ℹ️ Tất cả materials đã có Tồn chính xác!');
    }
  }

  // Check raw data from Firebase
  checkRawData(): void {
    console.log('=== CHECKING RAW DATA ===');
    console.log('Total materials:', this.materials.length);
    
    this.materials.forEach((material, index) => {
      console.log(`Material ${index + 1} (${material.materialCode}):`, {
        id: material.id,
        tonDau: material.tonDau,
        nhap: material.nhap,
        xuat: material.xuat,
        ton: material.ton,
        standard: material.standard,
        carton: material.carton,
        odd: material.odd,
        allProperties: Object.keys(material)
      });
    });
    
    // Check if materials have any data at all
    if (this.materials.length === 0) {
      console.log('❌ No materials found!');
      alert('❌ Không có dữ liệu materials nào!');
    } else {
      console.log('✅ Found materials, check console for details');
      alert(`✅ Tìm thấy ${this.materials.length} materials. Xem console để kiểm tra chi tiết.`);
    }
    console.log('=== END CHECKING RAW DATA ===');
  }

  // Reset all data to zero
  resetAllData(): void {
    if (this.materials.length === 0) {
      alert('✅ Không có dữ liệu để reset!');
      return;
    }

    const confirmMessage = `⚠️ CẢNH BÁO!\n\nBạn có chắc chắn muốn xóa TOÀN BỘ dữ liệu trong FG Inventory?\n\nSẽ xóa ${this.materials.length} materials.\n\nHành động này KHÔNG THỂ HOÀN TÁC!`;
    
    if (confirm(confirmMessage)) {
      this.isLoading = true;
      console.log('🗑️ Starting reset of all FG Inventory data...');
      
      // Delete all materials from Firebase
      const batch = this.firestore.firestore.batch();
      this.materials.forEach(material => {
        if (material.id) {
          const materialRef = this.firestore.collection('fg-inventory').doc(material.id).ref;
          batch.delete(materialRef);
        }
      });
      
      batch.commit()
        .then(() => {
          console.log('✅ All FG Inventory data deleted successfully');
          
          // Clear local data
          this.materials = [];
          this.filteredMaterials = [];
          
          this.isLoading = false;
          alert(`✅ Đã xóa thành công tất cả materials!\n\nFG Inventory đã được reset về 0.`);
        })
        .catch(error => {
          console.error('❌ Error deleting FG Inventory data:', error);
          this.isLoading = false;
          alert(`❌ Lỗi khi xóa dữ liệu: ${error.message}`);
        });
    }
  }



  viewAllMaterials(): void {
    // Clear search term to hide all materials (as per new requirement)
    this.searchTerm = '';
    this.startDate = new Date(2020, 0, 1);
    this.endDate = new Date(2030, 11, 31);
    this.showCompleted = true;
    this.selectedFactory = '';
    this.applyFilters();
    this.showTimeRangeDialog = false;
    
    console.log('Cleared search - all materials hidden:', {
      totalMaterials: this.materials.length,
      filteredMaterials: this.filteredMaterials.length
    });
  }

  applyTimeRangeFilter(): void {
    this.applyFilters();
    this.showTimeRangeDialog = false;
  }


}


