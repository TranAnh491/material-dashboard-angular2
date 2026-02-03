import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { FactoryAccessService } from '../../services/factory-access.service';
import { FGInventoryLocationService } from '../../services/fg-inventory-location.service';

export interface FgOutItem {
  id?: string;
  factory?: string;
  exportDate: Date;
  shipment: string;
  materialCode: string;
  customerCode: string;
  batchNumber: string;
  lsx: string;
  lot: string;
  quantity: number;
  poShip: string;
  carton: number;
  qtyBox: number; // Số lượng hàng trong 1 carton
  odd: number;
  location: string; // Thêm trường vị trí
  notes: string;
  updateCount: number;
  pushNo: string; // Thêm PushNo
  approved: boolean; // Thêm trường duyệt xuất
  transferredFrom?: string;
  transferredAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CustomerCodeMappingItem {
  id?: string;
  customerCode: string;
  materialCode: string;
  description?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface XuatKhoPreviewItem {
  materialCode: string;
  batchNumber: string;
  lot: string;
  lsx: string;
  quantity: number;
  availableStock: number;
  location: string;
  notes: string;
  inventoryId?: string; // ID của record trong FG Inventory
  selected: boolean; // Checkbox để chọn item
}

@Component({
  selector: 'app-fg-out',
  templateUrl: './fg-out.component.html',
  styleUrls: ['./fg-out.component.scss']
})
export class FgOutComponent implements OnInit, OnDestroy {
  materials: FgOutItem[] = [];
  filteredMaterials: FgOutItem[] = [];
  
  // Search and filter
  searchTerm: string = '';
  
  // Factory filter - FG Out is only for ASM1
  selectedFactory: string = 'ASM1';
  availableFactories: string[] = ['ASM1'];
  
  
  // XTP Import
  showXTPDialog: boolean = false;
  xtpShipment: string = '';
  xtpPXNumber: string = '';
  xtpFile: File | null = null;
  xtpPreviewData: any[] = [];
  
  // Display options
  showCompleted: boolean = true;
  
  // Shipment filter
  selectedShipment: string = '';
  availableShipments: string[] = [];
  
  // Time filter for old shipments
  showTimeRangeDialog: boolean = false;
  startDate: Date = new Date();
  endDate: Date = new Date();
  
  // Print dialog
  showPrintDialog: boolean = false;
  printMaterials: FgOutItem[] = [];
  
  // Permissions
  hasDeletePermission: boolean = false;
  hasCompletePermission: boolean = false;
  
  private destroy$ = new Subject<void>();
  private locationCache = new Map<string, string>(); // Cache for locations
  private loadLocationsSubject = new Subject<void>(); // Subject for debouncing location loading
  
  // Customer Code Mapping (Tên Khách Hàng = description)
  mappingItems: CustomerCodeMappingItem[] = [];
  
  // Xuất Kho Dialog
  showXuatKhoDialog: boolean = false;
  xuatKhoInputText: string = '';
  xuatKhoChecked: boolean = false;
  xuatKhoPreviewItems: XuatKhoPreviewItem[] = [];
  xuatKhoSelectedShipment: string = '';
  xuatKhoAvailableShipments: string[] = [];
  xuatKhoStep: number = 1; // 1: Chọn shipment, 2: Preview items
  
  @ViewChild('xtpFileInput') xtpFileInput!: ElementRef;

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private factoryAccessService: FactoryAccessService,
    private fgInventoryLocationService: FGInventoryLocationService
  ) {}

  ngOnInit(): void {
    this.loadMaterialsFromFirebase();
    this.loadMappingFromFirebase();
    this.startDate = new Date(2020, 0, 1);
    this.endDate = new Date(2030, 11, 31);
    this.applyFilters();
    this.loadPermissions();
    this.loadFactoryAccess();
    
    // Setup debounced location loading
    this.loadLocationsSubject.pipe(
      debounceTime(500),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.loadLocationsForMaterials();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.loadLocationsSubject.complete();
    this.locationCache.clear();
  }

  // Load materials from Firebase - Only last 10 days
  loadMaterialsFromFirebase(): void {
    // Calculate date 10 days ago
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    
    this.firestore.collection('fg-out', ref => 
      ref.where('exportDate', '>=', tenDaysAgo)
         .orderBy('exportDate', 'desc')
    )
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((actions) => {
        const firebaseMaterials = actions.map(action => {
          const data = action.payload.doc.data() as any;
          const id = action.payload.doc.id;
          return {
            id: id,
            ...data,
            shipment: data.shipment || '', // Đảm bảo shipment có giá trị
            batchNumber: data.batchNumber || '',
            lsx: data.lsx || '',
            lot: data.lot || '',
            location: data.location || '', // Thêm trường location
            updateCount: data.updateCount || 1,
            pushNo: data.pushNo || '000', // Thêm pushNo với default value
            approved: data.approved || false, // Thêm trường approved với default = false
            exportDate: data.exportDate ? new Date(data.exportDate.seconds * 1000) : new Date()
          };
        });
        
        this.materials = firebaseMaterials;
        this.sortMaterials(); // Sắp xếp trước khi apply filters
        this.applyFilters();
        this.loadAvailableShipments(); // Load available shipments
        this.loadLocationsSubject.next(); // Trigger debounced location loading
        console.log('Loaded FG Out materials from Firebase:', this.materials.length);
      });
  }

  // Load Customer Code Mapping từ Firebase (Tên Khách Hàng = description)
  loadMappingFromFirebase(): void {
    this.firestore.collection('fg-customer-mapping')
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe(actions => {
        const firebaseMapping = actions.map(action => {
          const data = action.payload.doc.data() as any;
          return {
            id: action.payload.doc.id,
            customerCode: data.customerCode || '',
            materialCode: data.materialCode || '',
            description: data.description || ''
          };
        });
        this.mappingItems = firebaseMapping;
      });
  }

  // Lấy Tên khách hàng từ Mapping (cột Tên Khách Hàng = description)
  getCustomerNameFromMapping(materialCode: string): string {
    const mapping = this.mappingItems.find(item => item.materialCode === materialCode);
    return mapping ? (mapping.description || '') : '';
  }

  // Sort materials by date, shipment, materialCode, LSX, Batch
  sortMaterials(): void {
    console.log('🔄 Sorting FG Out materials by: Date → Shipment → MaterialCode → LSX → Batch');
    
    this.materials.sort((a, b) => {
      // 1. Sort by date (newest first)
      const dateA = new Date(a.exportDate).getTime();
      const dateB = new Date(b.exportDate).getTime();
      if (dateA !== dateB) {
        return dateB - dateA; // Newest first
      }
      
      // 2. Sort by shipment (A-Z)
      const shipmentA = (a.shipment || '').toString().toUpperCase();
      const shipmentB = (b.shipment || '').toString().toUpperCase();
      if (shipmentA !== shipmentB) {
        return shipmentA.localeCompare(shipmentB);
      }
      
      // 3. Sort by materialCode (A-Z)
      const materialA = (a.materialCode || '').toString().toUpperCase();
      const materialB = (b.materialCode || '').toString().toUpperCase();
      if (materialA !== materialB) {
        return materialA.localeCompare(materialB);
      }
      
      // 4. Sort by LSX (A-Z)
      const lsxA = (a.lsx || '').toString().toUpperCase();
      const lsxB = (b.lsx || '').toString().toUpperCase();
      if (lsxA !== lsxB) {
        return lsxA.localeCompare(lsxB);
      }
      
      // 5. Sort by Batch (A-Z)
      const batchA = (a.batchNumber || '').toString().toUpperCase();
      const batchB = (b.batchNumber || '').toString().toUpperCase();
      return batchA.localeCompare(batchB);
    });
    
    console.log(`✅ Sorted ${this.materials.length} FG Out materials`);
  }

  // Update material in Firebase
  updateMaterialInFirebase(material: FgOutItem): void {
    if (material.id) {
      // Update existing record
      const updateData = {
        ...material,
        exportDate: material.exportDate,
        pushNo: material.pushNo || '000', // Đảm bảo pushNo được lưu
        updatedAt: new Date()
      };
      
      delete updateData.id;
      
      this.firestore.collection('fg-out').doc(material.id).update(updateData)
        .then(() => {
          console.log('FG Out material updated in Firebase successfully');
        })
        .catch(error => {
          console.error('Error updating FG Out material in Firebase:', error);
        });
    } else {
      // Create new record
      const newData = {
        ...material,
        exportDate: material.exportDate,
        pushNo: material.pushNo || '000',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      delete newData.id;
      
      this.firestore.collection('fg-out').add(newData)
        .then(docRef => {
          material.id = docRef.id;
          console.log('FG Out material created in Firebase successfully with ID:', docRef.id);
        })
        .catch(error => {
          console.error('Error creating FG Out material in Firebase:', error);
        });
    }
  }

  // Delete material
  deleteMaterial(material: FgOutItem): void {
    if (material.id) {
      this.firestore.collection('fg-out').doc(material.id).delete()
        .then(() => {
          console.log('FG Out material deleted from Firebase successfully');
        })
        .catch(error => {
          console.error('Error deleting FG Out material from Firebase:', error);
        });
    }
    
    // Remove from local array immediately
    const index = this.materials.indexOf(material);
    if (index > -1) {
      this.materials.splice(index, 1);
      console.log(`Deleted FG Out material: ${material.materialCode}`);
      this.applyFilters();
    }
  }

  // Apply search filters
  applyFilters(): void {
    this.filteredMaterials = this.materials.filter(material => {
      // Filter by search term
      if (this.searchTerm) {
        const searchableText = [
          material.materialCode,
          material.shipment,
          material.customerCode,
          material.batchNumber,
          material.lsx,
          material.lot,
          material.poShip,
          material.quantity?.toString(),
          material.notes
        ].filter(Boolean).join(' ').toUpperCase();
        
        if (!searchableText.includes(this.searchTerm)) {
          return false;
        }
      }
      
      // Filter by factory
      if (this.selectedFactory) {
        const materialFactory = material.factory || 'ASM1';
        if (materialFactory !== this.selectedFactory) {
          return false;
        }
      }
      
      // Filter by shipment
      if (this.selectedShipment) {
        if (material.shipment !== this.selectedShipment) {
          return false;
        }
      }
      
      // Filter by date range
      const exportDate = new Date(material.exportDate);
      const isInDateRange = exportDate >= this.startDate && exportDate <= this.endDate;
      
      return isInDateRange;
    });
    
    // Sort filtered materials using the same logic
    this.filteredMaterials.sort((a, b) => {
      // 1. Sort by date (newest first)
      const dateA = new Date(a.exportDate).getTime();
      const dateB = new Date(b.exportDate).getTime();
      if (dateA !== dateB) {
        return dateB - dateA; // Newest first
      }
      
      // 2. Sort by shipment (A-Z)
      const shipmentA = a.shipment.toUpperCase();
      const shipmentB = b.shipment.toUpperCase();
      if (shipmentA !== shipmentB) {
        return shipmentA.localeCompare(shipmentB);
      }
      
      // 3. Sort by materialCode (A-Z)
      const materialA = a.materialCode.toUpperCase();
      const materialB = b.materialCode.toUpperCase();
      if (materialA !== materialB) {
        return materialA.localeCompare(materialB);
      }
      
      // 4. Sort by LSX (A-Z)
      const lsxA = a.lsx.toUpperCase();
      const lsxB = b.lsx.toUpperCase();
      if (lsxA !== lsxB) {
        return lsxA.localeCompare(lsxB);
      }
      
      // 5. Sort by Batch (A-Z)
      const batchA = a.batchNumber.toUpperCase();
      const batchB = b.batchNumber.toUpperCase();
      return batchA.localeCompare(batchB);
    });
    
    console.log('FG Out search results:', {
      searchTerm: this.searchTerm,
      totalMaterials: this.materials.length,
      filteredMaterials: this.filteredMaterials.length
    });
  }

  // Search functionality
  onSearchChange(event: any): void {
    this.searchTerm = event.target.value.toUpperCase();
    event.target.value = this.searchTerm;
    this.applyFilters();
  }

  // Load user permissions
  loadPermissions(): void {
    this.hasDeletePermission = true;
    this.hasCompletePermission = true;
  }

  // Load factory access permissions - FG Out is only for ASM1
  private loadFactoryAccess(): void {
    // FG Out is only for ASM1, so no need to load factory access
    this.selectedFactory = 'ASM1';
    this.availableFactories = ['ASM1'];
    
    console.log('🏭 Factory access set for FG Out (ASM1 only):', {
      selectedFactory: this.selectedFactory,
      availableFactories: this.availableFactories
    });
  }

  // Check if user can edit material
  canEditMaterial(material: FgOutItem): boolean {
    const materialFactory = material.factory || 'ASM1';
    return this.availableFactories.includes(materialFactory);
  }

  // Check if user can view material
  canViewMaterial(material: FgOutItem): boolean {
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

  // Update date field
  updateDateField(material: FgOutItem, field: string, dateString: string): void {
    if (dateString) {
      (material as any)[field] = new Date(dateString);
    } else {
      (material as any)[field] = new Date();
    }
    material.updatedAt = new Date();
    this.updateMaterialInFirebase(material);
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

  private parseExcelData(data: any[]): FgOutItem[] {
    return data.map((row: any, index: number) => ({
      factory: row['Factory'] || 'ASM1',
      exportDate: this.parseDate(row['Ngày xuất']) || new Date(),
      shipment: row['Shipment'] || '',
      materialCode: row['Mã TP'] || '',
      customerCode: row['Mã Khách'] || '',
      batchNumber: row['Batch'] || '',
      lsx: row['LSX'] || '',
      lot: row['LOT'] || '',
      quantity: parseInt(row['Lượng Xuất']) || 0,
      poShip: row['PO Ship'] || '',
      carton: parseInt(row['Carton']) || 0,
      qtyBox: parseInt(row['QTYBOX']) || 100, // Thêm QTYBOX với default = 100
      odd: parseInt(row['Odd']) || 0,
      location: '', // Thêm trường location (sẽ được load từ FG Inventory)
      notes: '', // Để trống để điền tay
      updateCount: 1, // Default update count for imported data
      pushNo: '000', // Default pushNo for imported data
      approved: false, // Thêm trường approved với default = false
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
  saveMaterialsToFirebase(materials: FgOutItem[]): void {
    materials.forEach(material => {
      const materialData = {
        ...material,
        exportDate: material.exportDate,
        pushNo: material.pushNo || '000', // Đảm bảo pushNo được lưu
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      delete materialData.id;
      
      this.firestore.collection('fg-out').add(materialData)
        .then((docRef) => {
          console.log('FG Out material saved to Firebase successfully with ID:', docRef.id);
        })
        .catch(error => {
          console.error('Error saving FG Out material to Firebase:', error);
        });
    });
  }

  // Download template
  downloadTemplate(): void {
    const templateData = [
      {
        'Shipment': 'SHIP001',
        'Mã TP': 'P001234',
        'Mã Khách': 'CUST001',
        'Batch': '010001',
        'LSX': '0124/0001',
        'LOT': 'LOT001',
        'Lượng Xuất': 100,
        'PO Ship': 'PO2024001',
        'Carton': 10,
        'Odd': 5,
        'Ghi chú': 'Standard shipment'
      },
      {
        'Shipment': 'SHIP002',
        'Mã TP': 'P002345',
        'Mã Khách': 'CUST002',
        'Batch': '010002',
        'LSX': '0124/0002',
        'LOT': 'LOT002',
        'Lượng Xuất': 200,
        'PO Ship': 'PO2024002',
        'Carton': 20,
        'Odd': 8,
        'Ghi chú': 'Urgent shipment'
      }
    ];

    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(templateData);
    
    // Set column widths
    const colWidths = [
      { wch: 12 }, // Shipment
      { wch: 12 }, // Mã TP
      { wch: 12 }, // Mã Khách
      { wch: 10 }, // Batch
      { wch: 12 }, // LSX
      { wch: 10 }, // LOT
      { wch: 12 }, // Lượng Xuất
      { wch: 12 }, // PO Ship
      { wch: 10 }, // Carton
      { wch: 8 },  // Odd
      { wch: 20 }  // Ghi chú
    ];
    ws['!cols'] = colWidths;
    
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'FG_Out_Template.xlsx');
  }



  updateNotes(material: FgOutItem): void {
    console.log('Updating notes for material:', material.materialCode, 'to:', material.notes);
    this.updateMaterialInFirebase(material);
  }

  viewAllMaterials(): void {
    this.startDate = new Date(2020, 0, 1);
    this.endDate = new Date(2030, 11, 31);
    this.showCompleted = true;
    this.selectedFactory = '';
    this.applyFilters();
    this.showTimeRangeDialog = false;
    
    console.log('View all FG Out materials:', {
      totalMaterials: this.materials.length,
      filteredMaterials: this.filteredMaterials.length,
      materials: this.materials
    });
  }


  // XTP Import Methods
  selectXTPFile(): void {
    if (this.xtpFileInput) {
      this.xtpFileInput.nativeElement.click();
    }
  }

  onXTPFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      this.xtpFile = file;
      this.processXTPFile(file);
    }
  }

  removeXTPFile(): void {
    this.xtpFile = null;
    this.xtpPreviewData = [];
  }

  private async processXTPFile(file: File): Promise<void> {
    try {
      const data = await this.readExcelFile(file);
      this.xtpPreviewData = this.parseXTPData(data);
      console.log('XTP Preview data:', this.xtpPreviewData);
    } catch (error) {
      console.error('Error processing XTP file:', error);
      alert(`❌ Lỗi khi đọc file XTP: ${error.message || error}`);
    }
  }

  private parseXTPData(data: any[]): any[] {
    const results: any[] = [];
    
    // Tìm các cột cần thiết
    let materialCodeCol = '';
    let quantityCol = '';
    let lotCol = '';
    
    // Tìm header row
    const headerRow = data[0];
    if (headerRow) {
      Object.keys(headerRow).forEach(key => {
        const value = String(headerRow[key]).toLowerCase();
        if (value.includes('mã vật tư') || value.includes('mã tp')) {
          materialCodeCol = key;
        }
        if (value.includes('số lượng') || value.includes('xuất')) {
          quantityCol = key;
        }
        if (value.includes('mã lô') || value.includes('lot')) {
          lotCol = key;
        }
      });
    }
    
    console.log('XTP Column mapping:', { materialCodeCol, quantityCol, lotCol });
    
    // Parse data rows
    data.forEach((row: any, index: number) => {
      if (index === 0) return; // Skip header
      
      const materialCode = String(row[materialCodeCol] || '').trim();
      const quantity = parseFloat(row[quantityCol] || 0);
      const lot = String(row[lotCol] || '').trim();
      
      if (materialCode && quantity > 0) {
        // Parse material code: P + 6 digits (7 characters from left)
        const materialCodeParsed = materialCode.substring(0, 7);
        
        // Parse REV: everything after _ in material code
        let rev = '';
        const underscoreIndex = materialCode.indexOf('_');
        if (underscoreIndex > -1) {
          rev = materialCode.substring(underscoreIndex + 1);
        }
        
        results.push({
          materialCode: materialCodeParsed,
          rev: rev,
          lot: lot,
          quantity: quantity
        });
      }
    });
    
    return results;
  }

  canImportXTP(): boolean {
    return !!(this.xtpShipment.trim() && this.xtpPXNumber.trim() && this.xtpFile && this.xtpPreviewData.length > 0);
  }

  importXTPData(): void {
    if (!this.canImportXTP()) {
      alert('❌ Vui lòng nhập đầy đủ thông tin và chọn file XTP');
      return;
    }

    const newMaterials: FgOutItem[] = this.xtpPreviewData.map(item => ({
      factory: 'ASM1',
      exportDate: new Date(),
      shipment: this.xtpShipment.trim(),
      materialCode: item.materialCode,
      customerCode: '',
      batchNumber: '',
      lsx: '',
      lot: item.lot || '',
      quantity: item.quantity,
      poShip: this.xtpPXNumber.trim(),
      carton: 0,
      qtyBox: 100, // Default QTYBOX = 100 for XTP import
      odd: 0,
      location: '', // Thêm trường location (sẽ được load từ FG Inventory)
      notes: '', // Để trống để điền tay
      updateCount: 1, // Default update count for XTP imported data
      pushNo: '000', // Default pushNo for XTP imported data
      approved: false, // Thêm trường approved với default = false
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    // Add to local array
    this.materials = [...this.materials, ...newMaterials];
    this.applyFilters();

    // Save to Firebase
    this.saveMaterialsToFirebase(newMaterials);

    // Reset form
    this.xtpShipment = '';
    this.xtpPXNumber = '';
    this.xtpFile = null;
    this.xtpPreviewData = [];
    this.showXTPDialog = false;

    alert(`✅ Đã import thành công ${newMaterials.length} items từ phiếu XTP!`);
  }

  // Load available shipments for filter
  loadAvailableShipments(): void {
    this.firestore.collection('fg-out')
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe(snapshot => {
        const shipments = new Set<string>();
        snapshot.docs.forEach(doc => {
          const data = doc.data() as any;
          if (data.shipment) {
            shipments.add(data.shipment);
          }
        });
        this.availableShipments = Array.from(shipments).sort();
        console.log('Available shipments:', this.availableShipments);
      });
  }

  // Handle shipment input change
  onShipmentInputChange(): void {
    console.log('Shipment input changed to:', this.selectedShipment);
    this.applyFilters();
  }

  // Handle approval change
  onApprovalChange(material: FgOutItem): void {
    console.log('Approval changed for material:', material.id, 'approved:', material.approved);
    
    if (material.approved) {
      // Subtract from FG Inventory when approved
      this.subtractFromFGInventory(material);
    } else {
      // Add back to FG Inventory when unapproved (hoàn tác)
      this.addBackToFGInventory(material);
    }
    
    this.updateMaterialInFirebase(material);
  }

  // Subtract quantity from FG Inventory and update export collection
  private subtractFromFGInventory(material: FgOutItem): void {
    console.log(`📉 Processing export for ${material.quantity} units of ${material.materialCode}`);
    
    // First, check if there's enough inventory
    this.firestore.collection('fg-inventory', ref => 
      ref.where('materialCode', '==', material.materialCode)
         .where('batchNumber', '==', material.batchNumber)
         .where('lsx', '==', material.lsx)
         .where('lot', '==', material.lot)
    ).get().subscribe(snapshot => {
      if (snapshot.empty) {
        console.log('⚠️ No matching FG Inventory found');
        alert(`⚠️ Cảnh báo: Không tìm thấy tồn kho cho ${material.materialCode}!`);
        return;
      }

      // Calculate total available inventory
      let totalAvailable = 0;
      snapshot.docs.forEach(doc => {
        const inventoryData = doc.data() as any;
        totalAvailable += inventoryData.ton || 0;
      });

      if (totalAvailable < material.quantity) {
        console.log(`⚠️ Insufficient inventory: available=${totalAvailable}, required=${material.quantity}`);
        alert(`⚠️ Cảnh báo: Không đủ tồn kho!\nCó: ${totalAvailable}\nCần: ${material.quantity}`);
        return;
      }

      // Subtract from inventory
      this.subtractFromInventory(snapshot, material.quantity);
      
      // Add to export collection
      this.addToExportCollection(material);
    });
  }

  // Subtract quantity from inventory items
  private subtractFromInventory(snapshot: any, totalQuantity: number): void {
    let remainingQuantity = totalQuantity;
    
    snapshot.docs.forEach(doc => {
      if (remainingQuantity <= 0) return;
      
      const inventoryData = doc.data() as any;
      const availableQuantity = inventoryData.ton || 0;
      const quantityToSubtract = Math.min(remainingQuantity, availableQuantity);
      
      if (quantityToSubtract > 0) {
        const newQuantity = availableQuantity - quantityToSubtract;
        
        doc.ref.update({
          ton: newQuantity,
          updatedAt: new Date()
        }).then(() => {
          console.log(`✅ Updated inventory ${doc.id}: ton=${newQuantity} (subtracted ${quantityToSubtract})`);
        }).catch(error => {
          console.error('❌ Error updating inventory:', error);
        });
        
        remainingQuantity -= quantityToSubtract;
      }
    });
  }

  // Add export record to fg-export collection
  private addToExportCollection(material: FgOutItem): void {
    const exportRecord = {
      materialCode: material.materialCode,
      batchNumber: material.batchNumber,
      lsx: material.lsx,
      lot: material.lot,
      quantity: material.quantity,
      shipment: material.shipment,
      pushNo: material.pushNo,
      approvedBy: 'Current User', // TODO: Get from auth service
      approvedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.firestore.collection('fg-export').add(exportRecord)
      .then(docRef => {
        console.log(`✅ Added export record: ${docRef.id} for ${material.materialCode}`);
      })
      .catch(error => {
        console.error('❌ Error adding export record:', error);
        alert(`❌ Lỗi khi lưu bản ghi xuất: ${error.message}`);
      });
  }

  // Add back quantity to FG Inventory and remove from export collection (hoàn tác duyệt xuất)
  private addBackToFGInventory(material: FgOutItem): void {
    console.log(`📈 Reversing export for ${material.quantity} units of ${material.materialCode}`);
    
    // First, remove from export collection
    this.removeFromExportCollection(material);
    
    // Then add back to inventory
    this.addBackToInventory(material);
  }

  // Remove export record from fg-export collection
  private removeFromExportCollection(material: FgOutItem): void {
    this.firestore.collection('fg-export', ref => 
      ref.where('materialCode', '==', material.materialCode)
         .where('batchNumber', '==', material.batchNumber)
         .where('lsx', '==', material.lsx)
         .where('lot', '==', material.lot)
         .where('shipment', '==', material.shipment)
         .where('pushNo', '==', material.pushNo)
         .limit(1)
    ).get().subscribe(snapshot => {
      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        doc.ref.delete()
          .then(() => {
            console.log(`✅ Removed export record: ${doc.id} for ${material.materialCode}`);
          })
          .catch(error => {
            console.error('❌ Error removing export record:', error);
          });
      } else {
        console.log('⚠️ No matching export record found to remove');
      }
    });
  }

  // Add back quantity to inventory items
  private addBackToInventory(material: FgOutItem): void {
    this.firestore.collection('fg-inventory', ref => 
      ref.where('materialCode', '==', material.materialCode)
         .where('batchNumber', '==', material.batchNumber)
         .where('lsx', '==', material.lsx)
         .where('lot', '==', material.lot)
    ).get().subscribe(snapshot => {
      if (snapshot.empty) {
        console.log('⚠️ No matching FG Inventory found for adding back');
        return;
      }

      let remainingQuantity = material.quantity;
      
      snapshot.docs.forEach(doc => {
        if (remainingQuantity <= 0) return;
        
        const inventoryData = doc.data() as any;
        const currentQuantity = inventoryData.ton || 0;
        const quantityToAddBack = Math.min(remainingQuantity, material.quantity);
        
        if (quantityToAddBack > 0) {
          const newQuantity = currentQuantity + quantityToAddBack;
          
          doc.ref.update({
            ton: newQuantity,
            updatedAt: new Date()
          }).then(() => {
            console.log(`✅ Added back to inventory ${doc.id}: ton=${newQuantity} (added ${quantityToAddBack})`);
          }).catch(error => {
            console.error('❌ Error updating inventory:', error);
          });
          
          remainingQuantity -= quantityToAddBack;
        }
      });
    });
  }

  // Print selected shipment
  printSelectedShipment(): void {
    if (!this.selectedShipment) {
      alert('Vui lòng chọn Shipment để in!');
      return;
    }
    
    this.printMaterials = this.materials.filter(m => m.shipment === this.selectedShipment);
    this.showPrintDialog = true;
  }

  // Print document
  printDocument(): void {
    const printContent = document.getElementById('printContent');
    if (printContent) {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>Phiếu xuất hàng - ${this.selectedShipment}</title>
              <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                .print-header { text-align: center; margin-bottom: 20px; }
                .print-header h2 { color: #333; margin-bottom: 10px; }
                .print-info { text-align: left; margin-bottom: 20px; }
                .print-table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
                .print-table th, .print-table td { border: 1px solid #333; padding: 8px; text-align: center; }
                .print-table th { background-color: #f5f5f5; font-weight: bold; }
                .print-footer { margin-top: 30px; }
                .signature-section { display: flex; justify-content: space-around; }
                .signature-box { text-align: center; }
                .signature-line { border-bottom: 1px solid #333; width: 150px; height: 40px; margin: 10px auto; }
                @media print { body { margin: 0; } }
              </style>
            </head>
            <body>
              ${printContent.innerHTML}
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.print();
      }
    }
  }

  // Get current date
  getCurrentDate(): string {
    return new Date().toLocaleDateString('vi-VN');
  }

  // Get current user
  getCurrentUser(): string {
    return 'Người dùng hiện tại'; // TODO: Get from auth service
  }

  // Format date for input field (YYYY-MM-DD)
  formatDateForInput(date: Date): string {
    if (!date) return '';
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Handle date input change
  onDateChange(event: any, material: FgOutItem): void {
    const dateValue = event.target.value;
    if (dateValue) {
      material.exportDate = new Date(dateValue);
      this.updateMaterialInFirebase(material);
    }
  }

  // Load materials by time range (for old shipments)
  loadMaterialsByTimeRange(): void {
    console.log('Loading materials by time range:', this.startDate, 'to', this.endDate);
    
    this.firestore.collection('fg-out', ref => 
      ref.where('exportDate', '>=', this.startDate)
         .where('exportDate', '<=', this.endDate)
         .orderBy('exportDate', 'desc')
    )
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((actions) => {
        const firebaseMaterials = actions.map(action => {
          const data = action.payload.doc.data() as any;
          const id = action.payload.doc.id;
          return {
            id: id,
            ...data,
            shipment: data.shipment || '',
            batchNumber: data.batchNumber || '',
            lsx: data.lsx || '',
            lot: data.lot || '',
            location: data.location || '',
            updateCount: data.updateCount || 1,
            pushNo: data.pushNo || '000',
            approved: data.approved || false,
            exportDate: data.exportDate ? new Date(data.exportDate.seconds * 1000) : new Date()
          };
        });
        
        this.materials = firebaseMaterials;
        this.sortMaterials();
        this.applyFilters();
        this.loadAvailableShipments();
        this.loadLocationsSubject.next();
        console.log('Loaded FG Out materials by time range:', this.materials.length);
      });
  }

  // Apply time range filter
  applyTimeRangeFilter(): void {
    this.loadMaterialsByTimeRange();
    this.showTimeRangeDialog = false;
  }

  // Add new row manually
  addNewRow(): void {
    const newMaterial: FgOutItem = {
      id: '', // Will be set when saved to Firebase
      factory: 'ASM1',
      exportDate: new Date(),
      shipment: this.selectedShipment || '',
      materialCode: '',
      customerCode: '',
      batchNumber: '',
      lsx: '',
      lot: '',
      quantity: 0,
      poShip: '',
      carton: 0,
      qtyBox: 100,
      odd: 0,
      location: '',
      notes: '',
      approved: false,
      updateCount: 0,
      pushNo: '000',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Add to materials array
    this.materials.unshift(newMaterial); // Add to beginning of array
    
    // Update filtered materials
    this.applyFilters();
    
    console.log('✅ Added new row manually');
  }

  // Get location from FG Inventory - SIMPLIFIED to avoid infinite loop
  getLocation(material: FgOutItem): string {
    // Return cached location if available
    if (material.location) {
      return material.location;
    }
    
    // Check cache
    const cacheKey = `${material.materialCode}-${material.batchNumber}-${material.lsx}-${material.lot}`;
    if (this.locationCache.has(cacheKey)) {
      material.location = this.locationCache.get(cacheKey)!;
      return material.location;
    }
    
    // Return loading state without triggering API call
    return 'Đang tải...';
  }

  // Load locations for all materials - OPTIMIZED with caching
  private loadLocationsForMaterials(): void {
    // Only load locations for materials that don't have location yet
    const materialsNeedingLocation = this.materials.filter(material => !material.location);
    
    if (materialsNeedingLocation.length === 0) {
      return; // No need to load if all have locations
    }
    
    console.log(`Loading locations for ${materialsNeedingLocation.length} materials`);
    
    materialsNeedingLocation.forEach(material => {
      const cacheKey = `${material.materialCode}-${material.batchNumber}-${material.lsx}-${material.lot}`;
      
      // Check cache first
      if (this.locationCache.has(cacheKey)) {
        material.location = this.locationCache.get(cacheKey)!;
        return;
      }
      
      // Load from API if not in cache
      this.fgInventoryLocationService.getLocation(
        material.materialCode,
        material.batchNumber,
        material.lsx,
        material.lot
      ).pipe(takeUntil(this.destroy$))
      .subscribe(location => {
        material.location = location;
        this.locationCache.set(cacheKey, location); // Cache the result
        console.log(`Loaded location for ${material.materialCode}: ${location}`);
      });
    });
  }

  // ==================== XUẤT KHO FUNCTIONS ====================
  
  // Open Xuất Kho Dialog
  openXuatKhoDialog(): void {
    this.showXuatKhoDialog = true;
    this.xuatKhoInputText = '';
    this.xuatKhoChecked = false;
    this.xuatKhoPreviewItems = [];
    this.xuatKhoStep = 1;
    this.xuatKhoSelectedShipment = '';
    this.loadAvailableShipmentsForXuatKho();
  }

  // Close Xuất Kho Dialog
  closeXuatKhoDialog(): void {
    this.showXuatKhoDialog = false;
    this.xuatKhoInputText = '';
    this.xuatKhoChecked = false;
    this.xuatKhoPreviewItems = [];
    this.xuatKhoStep = 1;
    this.xuatKhoSelectedShipment = '';
  }

  // Back to shipment selection
  backToInput(): void {
    this.xuatKhoStep = 1;
    this.xuatKhoChecked = false;
    this.xuatKhoPreviewItems = [];
    this.xuatKhoSelectedShipment = '';
  }

  // Remove item from preview list
  removeXuatKhoItem(index: number): void {
    this.xuatKhoPreviewItems.splice(index, 1);
  }

  // Check if all items are selected
  isAllSelected(): boolean {
    return this.xuatKhoPreviewItems.length > 0 && 
           this.xuatKhoPreviewItems.every(item => item.selected);
  }

  // Toggle select all items
  toggleSelectAll(checked: boolean): void {
    this.xuatKhoPreviewItems.forEach(item => {
      item.selected = checked;
    });
  }

  // Get count of selected items
  getSelectedItemsCount(): number {
    return this.xuatKhoPreviewItems.filter(item => item.selected).length;
  }

  // Load available shipments cho Xuất Kho
  loadAvailableShipmentsForXuatKho(): void {
    console.log('🔍 Loading available shipments...');
    
    // Load từ collection shipments
    this.firestore.collection('shipments', ref => 
      ref.orderBy('createdAt', 'desc')
         .limit(50)
    ).get().subscribe(snapshot => {
      const shipments = new Set<string>();
      
      snapshot.docs.forEach(doc => {
        const data = doc.data() as any;
        if (data.shipmentCode) {
          shipments.add(data.shipmentCode);
        }
      });
      
      this.xuatKhoAvailableShipments = Array.from(shipments).sort();
      console.log('✅ Loaded', this.xuatKhoAvailableShipments.length, 'shipments');
    });
  }

  // Load inventory items theo shipment đã chọn
  loadInventoryForShipment(): void {
    if (!this.xuatKhoSelectedShipment) {
      alert('⚠️ Vui lòng chọn shipment');
      return;
    }

    console.log('🔍 Loading inventory for shipment:', this.xuatKhoSelectedShipment);
    
    // Load trực tiếp từ FG Inventory
    this.firestore.collection('fg-inventory', ref => 
      ref.where('ton', '>', 0)
    ).get().subscribe(snapshot => {
      this.xuatKhoPreviewItems = [];

      if (!snapshot.empty) {
        snapshot.docs.forEach(doc => {
          const data = doc.data() as any;
          const availableStock = data.ton || 0;

          if (availableStock > 0) {
            this.xuatKhoPreviewItems.push({
              materialCode: data.materialCode || '',
              batchNumber: data.batchNumber || '',
              lot: data.lot || '',
              lsx: data.lsx || '',
              quantity: availableStock, // Mặc định xuất hết tồn
              availableStock: availableStock,
              location: data.location || '',
              notes: '',
              inventoryId: doc.id,
              selected: false // Mặc định không chọn, để user tự chọn
            });
          }
        });

        if (this.xuatKhoPreviewItems.length > 0) {
          this.xuatKhoStep = 2;
          this.xuatKhoChecked = true;
          console.log('✅ Loaded', this.xuatKhoPreviewItems.length, 'items from FG Inventory');
        } else {
          alert('❌ Không có hàng tồn kho');
        }
      } else {
        alert('❌ Không tìm thấy hàng tồn kho');
      }
    });
  }

  // Check tồn kho từ FG Inventory (giữ lại để backward compatible)
  checkXuatKho(): void {
    this.loadInventoryForShipment();
  }

  // Approve và lưu vào FG Out + cập nhật FG Inventory
  approveXuatKho(): void {
    // Lọc chỉ những items được chọn
    const selectedItems = this.xuatKhoPreviewItems.filter(item => item.selected);
    
    if (selectedItems.length === 0) {
      alert('⚠️ Vui lòng chọn ít nhất một item để xuất kho');
      return;
    }

    // Kiểm tra số lượng xuất không vượt quá tồn
    const hasError = selectedItems.some(item => item.quantity > item.availableStock);
    if (hasError) {
      alert('❌ Có mã TP có số lượng xuất vượt quá tồn kho. Vui lòng kiểm tra lại!');
      return;
    }

    const confirmed = confirm(`✅ Xác nhận xuất kho ${selectedItems.length} items đã chọn?`);
    if (!confirmed) return;

    console.log('🚀 Approving export for', selectedItems.length, 'selected items...');
    let savedCount = 0;

    selectedItems.forEach(item => {
      // 1. Tạo record trong FG Out
      const fgOutRecord: any = {
        factory: 'ASM1',
        exportDate: new Date(),
        shipment: this.selectedShipment || '',
        materialCode: item.materialCode,
        batchNumber: item.batchNumber,
        lsx: item.lsx,
        lot: item.lot,
        quantity: item.quantity,
        carton: 0,
        qtyBox: 0,
        odd: 0,
        location: item.location,
        notes: item.notes,
        approved: false,
        updateCount: 0,
        pushNo: '000',
        customerCode: '',
        poShip: '',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      fgOutRecord.shipment = this.xuatKhoSelectedShipment; // Gán shipment đã chọn
      
      this.firestore.collection('fg-out').add(fgOutRecord).then(() => {
        console.log(`✅ Created FG Out record for ${item.materialCode}`);
        savedCount++;

        // 2. Cập nhật cột Xuất trong FG Inventory
        if (item.inventoryId) {
          this.firestore.collection('fg-inventory').doc(item.inventoryId).get().subscribe(doc => {
            if (doc.exists) {
              const currentData = doc.data() as any;
              const currentXuat = currentData.xuat || 0;
              const newXuat = currentXuat + item.quantity;
              const currentTon = currentData.ton || 0;
              const newTon = currentTon - item.quantity;

              doc.ref.update({
                xuat: newXuat,
                ton: newTon,
                updatedAt: new Date()
              }).then(() => {
                console.log(`✅ Updated FG Inventory xuat: ${currentXuat} → ${newXuat}, ton: ${currentTon} → ${newTon}`);
              }).catch(error => {
                console.error('❌ Error updating FG Inventory:', error);
              });
            }
          });
        }

        // Khi đã lưu hết
        if (savedCount === selectedItems.length) {
          alert(`✅ Đã duyệt xuất kho thành công ${savedCount} items cho shipment ${this.xuatKhoSelectedShipment}!`);
          this.closeXuatKhoDialog();
          this.loadMaterialsFromFirebase(); // Refresh data
        }
      }).catch(error => {
        console.error('❌ Error creating FG Out record:', error);
        alert('❌ Lỗi khi lưu dữ liệu: ' + error.message);
      });
    });
  }

}
