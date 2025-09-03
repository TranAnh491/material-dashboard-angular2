import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { FactoryAccessService } from '../../services/factory-access.service';

export interface FgInItem {
  id?: string;
  factory?: string;
  importDate: Date;
  batchNumber: string; // Tạo theo tuần và số thứ tự 4 số (ví dụ: 390001)
  materialCode: string; // Mã TP
  rev: string; // REV
  lot: string; // LOT
  lsx: string; // LSX
  quantity: number; // QTY
  carton: number; // Carton
  odd: number; // ODD
  location: string; // Vị Trí
  notes: string; // Ghi chú
  customer: string; // Khách
  isReceived: boolean;
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
  selector: 'app-fg-in',
  templateUrl: './fg-in.component.html',
  styleUrls: ['./fg-in.component.scss']
})
export class FgInComponent implements OnInit, OnDestroy {
  materials: FgInItem[] = [];
  filteredMaterials: FgInItem[] = [];
  
  // Search and filter
  searchTerm: string = '';
  
  // Factory filter - FG In is only for ASM1
  selectedFactory: string = 'ASM1';
  availableFactories: string[] = ['ASM1'];
  
  // Time range filter
  showTimeRangeDialog: boolean = false;
  startDate: Date = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  endDate: Date = new Date();
  
  // Display options
  showCompleted: boolean = true;
  
  // Permissions
  hasDeletePermission: boolean = false;
  hasCompletePermission: boolean = false;
  
  // Product Catalog
  showCatalogDialog: boolean = false;
  catalogItems: ProductCatalogItem[] = [];
  filteredCatalogItems: ProductCatalogItem[] = [];
  catalogSearchTerm: string = '';
  
  // New catalog item for manual addition
  newCatalogItem: ProductCatalogItem = {
    materialCode: '',
    standard: '',
    customer: ''
  };
  
  private destroy$ = new Subject<void>();

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private factoryAccessService: FactoryAccessService
  ) {}

  ngOnInit(): void {
    this.loadMaterialsFromFirebase();
    // Load catalog immediately so calculations work
    this.loadCatalogFromFirebase();
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

  // Load materials from Firebase - One-time load for better performance
  loadMaterialsFromFirebase(): void {
    this.firestore.collection('fg-in')
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe((querySnapshot) => {
        const firebaseMaterials = querySnapshot.docs.map(doc => {
          const data = doc.data() as any;
          const id = doc.id;
          
          // Map Firebase data structure to component interface
          const material = {
            id: id,
            factory: data.factory || 'ASM1',
            importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : new Date(),
            batchNumber: data.batchNumber || data.batch || '',
            materialCode: data.materialCode || data.maTP || '',
            rev: data.rev || '',
            lot: data.lot || data.Lot || '',
            lsx: data.lsx || data.Lsx || '',
            quantity: data.quantity || data.qty || 0,
            carton: data.carton || 0,
            odd: data.odd || 0,
            location: data.location || data.viTri || '',
            notes: data.notes || data.ghiChu || '',
            customer: data.customer || data.khach || '',
            isReceived: data.isReceived || false,
            createdAt: data.createdAt ? new Date(data.createdAt.seconds * 1000) : new Date(),
            updatedAt: data.updatedAt ? new Date(data.updatedAt.seconds * 1000) : new Date()
          };
          
          console.log('Loaded material:', material);
          return material;
        });
        
        this.materials = firebaseMaterials;
        this.applyFilters();
        console.log('Loaded FG In materials from Firebase:', this.materials.length);
        console.log('All materials:', this.materials);
      });
  }

  // Update received status (Đã nhận) - Only allow ticking, not unticking
  updateReceivedStatus(material: FgInItem, checked: boolean): void {
    // Only allow ticking (true), not unticking (false)
    if (!checked) {
      console.log(`Cannot untick received status for ${material.materialCode}`);
      return;
    }
    
    material.isReceived = checked;
    material.updatedAt = new Date();
    console.log(`Updated received status for ${material.materialCode}: ${checked}`);
    
    // Save to Firebase
    this.updateMaterialInFirebase(material);
    
    // Auto-add to Inventory when marked as received
    this.addToInventory(material);
  }

  // Add material to Inventory when received
  private addToInventory(material: FgInItem): void {
    console.log(`Adding ${material.materialCode} to FG Inventory...`);
    
    // Tìm thông tin từ catalog
    const catalogItem = this.catalogItems.find(item => item.materialCode === material.materialCode);
    const customerFromCatalog = catalogItem ? catalogItem.customer : '';
    const standardFromCatalog = catalogItem ? catalogItem.standard : '';
    
    // Tính toán Carton và ODD từ Standard
    let carton = 0;
    let odd = 0;
    
    if (standardFromCatalog && !isNaN(parseFloat(standardFromCatalog)) && parseFloat(standardFromCatalog) > 0) {
      const standard = parseFloat(standardFromCatalog);
      carton = Math.ceil(material.quantity / standard); // Làm tròn lên
      odd = material.quantity % standard; // Số lẻ
    }
    
    // Create inventory material from inbound material
    const inventoryMaterial = {
      factory: material.factory || 'ASM1',
      importDate: material.importDate,
      receivedDate: new Date(),
      batchNumber: material.batchNumber,
      materialCode: material.materialCode,
      rev: material.rev,
      lot: material.lot,
      lsx: material.lsx,
      quantity: material.quantity,
      carton: carton,
      odd: odd,
      exported: 0,
      stock: material.quantity,
                   location: material.location || 'Temporary',
      notes: material.notes || '',
      customer: material.customer || customerFromCatalog || '',
      isReceived: true,
      isCompleted: false,
      isDuplicate: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    this.firestore.collection('fg-inventory').add(inventoryMaterial)
      .then((docRef) => {
        console.log(`Successfully added ${material.materialCode} to FG inventory with ID: ${docRef.id}`);
        console.log(`Carton: ${carton}, ODD: ${odd} (Standard: ${standardFromCatalog})`);
      })
      .catch(error => {
        console.error(`Error adding ${material.materialCode} to FG inventory:`, error);
      });
  }

  // Update material in Firebase
  updateMaterialInFirebase(material: FgInItem): void {
    if (material.id) {
      const updateData = {
        ...material,
        importDate: material.importDate,
        updatedAt: new Date()
      };
      
      delete updateData.id;
      
      this.firestore.collection('fg-in').doc(material.id).update(updateData)
        .then(() => {
          console.log('FG In material updated in Firebase successfully');
        })
        .catch(error => {
          console.error('Error updating FG In material in Firebase:', error);
        });
    }
  }

  // Delete material - Using same approach as clearAllData
  deleteMaterial(material: FgInItem): void {
    console.log('=== DELETE MATERIAL CALLED ===');
    console.log('Material object:', material);
    console.log('Material ID:', material.id);
    console.log('Material Code:', material.materialCode);
    console.log('Material has ID:', !!material.id);
    
    // Check if material has ID
    if (!material.id) {
      console.error('❌ Material has no ID - cannot delete');
      alert('❌ Không thể xóa: Material không có ID. Vui lòng refresh và thử lại.');
      return;
    }
    
    // Simple confirmation
    const confirmMessage = `Xác nhận xóa material "${material.materialCode || 'Unknown'}"?`;
    console.log('Confirmation message:', confirmMessage);
    
    if (confirm(confirmMessage)) {
      console.log('✅ User confirmed deletion');
      console.log('Attempting to delete from Firebase with ID:', material.id);
      
      // Use the same approach as clearAllData - get document reference and delete
      this.firestore.collection('fg-in').doc(material.id).get().subscribe(doc => {
        if (doc.exists) {
          doc.ref.delete().then(() => {
            console.log('✅ FG In material deleted from Firebase successfully');
            alert(`✅ Đã xóa material "${material.materialCode}" thành công!`);
            // Refresh data after successful deletion
            this.refreshData();
          }).catch(error => {
            console.error('❌ Error deleting FG In material from Firebase:', error);
            alert(`❌ Lỗi khi xóa material: ${error.message || error}`);
          });
        } else {
          console.error('❌ Document does not exist in Firebase');
          alert('❌ Không tìm thấy material trong Firebase');
        }
      });
    } else {
      console.log('❌ User cancelled deletion');
    }
  }

  // Apply search filters - Optimized for performance
  applyFilters(): void {
    // Use setTimeout to debounce rapid filter changes
    setTimeout(() => {
      this.filteredMaterials = this.materials.filter(material => {
        // Filter by search term
        if (this.searchTerm) {
          const searchableText = [
            material.materialCode,
            material.batchNumber,
            material.rev,
            material.lot,
            material.lsx,
            material.location,
            material.customer,
            material.quantity?.toString(),
            material.carton?.toString(),
            material.odd?.toString(),
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
        
        // Filter by date range
        const importDate = new Date(material.importDate);
        const isInDateRange = importDate >= this.startDate && importDate <= this.endDate;
        
        return isInDateRange;
      });
      
      console.log('FG In search results:', {
        searchTerm: this.searchTerm,
        totalMaterials: this.materials.length,
        filteredMaterials: this.filteredMaterials.length
      });
    }, 0);
  }

  // Refresh data after operations (import, update, delete)
  refreshData(): void {
    console.log('Refreshing data...');
    this.loadMaterialsFromFirebase();
  }

  // Manual refresh for testing
  manualRefresh(): void {
    console.log('Manual refresh triggered');
    this.refreshData();
  }

  // Debug method to check materials
  debugMaterials(): void {
    console.log('=== DEBUG MATERIALS ===');
    console.log('Total materials:', this.materials.length);
    console.log('Filtered materials:', this.filteredMaterials.length);
    console.log('Catalog items:', this.catalogItems.length);
    
    this.materials.forEach((material, index) => {
      const calculation = this.calculateCartonAndOdd(material);
      console.log(`Material ${index + 1}:`, {
        id: material.id,
        materialCode: material.materialCode,
        batchNumber: material.batchNumber,
        quantity: material.quantity,
        hasId: !!material.id,
        calculatedCarton: calculation.carton,
        calculatedOdd: calculation.odd
      });
    });
    console.log('=== END DEBUG ===');
  }

  // Tính toán Carton và ODD cho material (để hiển thị trong bảng)
  calculateCartonAndOdd(material: FgInItem): { carton: number, odd: number } {
    const catalogItem = this.catalogItems.find(item => item.materialCode === material.materialCode);
    const standardFromCatalog = catalogItem ? catalogItem.standard : '';
    
    let carton = 0;
    let odd = 0;
    
    if (standardFromCatalog && !isNaN(parseFloat(standardFromCatalog)) && parseFloat(standardFromCatalog) > 0) {
      const standard = parseFloat(standardFromCatalog);
      carton = Math.ceil(material.quantity / standard); // Làm tròn lên
      odd = material.quantity % standard; // Số lẻ
    }
    
    return { carton, odd };
  }

  // Lấy thông tin khách hàng từ catalog
  getCustomerFromCatalog(materialCode: string): string {
    const catalogItem = this.catalogItems.find(item => item.materialCode === materialCode);
    return catalogItem ? catalogItem.customer : '';
  }

  // Clear all data from Firebase (for testing)
  clearAllData(): void {
    if (confirm('⚠️ XÁC NHẬN XÓA TẤT CẢ DỮ LIỆU FG IN? Hành động này không thể hoàn tác!')) {
      console.log('Clearing all FG In data...');
      
      // Get all documents and delete them
      this.firestore.collection('fg-in').get().subscribe(querySnapshot => {
        const deletePromises = querySnapshot.docs.map(doc => doc.ref.delete());
        
        Promise.all(deletePromises).then(() => {
          console.log('All FG In data cleared successfully');
          alert('✅ Đã xóa tất cả dữ liệu FG In');
          this.refreshData();
        }).catch(error => {
          console.error('Error clearing data:', error);
          alert('❌ Lỗi khi xóa dữ liệu: ' + error.message);
        });
      });
    }
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

  // Load factory access permissions - FG In is only for ASM1
  private loadFactoryAccess(): void {
    // FG In is only for ASM1, so no need to load factory access
    this.selectedFactory = 'ASM1';
    this.availableFactories = ['ASM1'];
    
    console.log('🏭 Factory access set for FG In (ASM1 only):', {
      selectedFactory: this.selectedFactory,
      availableFactories: this.availableFactories
    });
  }

  // Check if user can edit material
  canEditMaterial(material: FgInItem): boolean {
    const materialFactory = material.factory || 'ASM1';
    return this.availableFactories.includes(materialFactory);
  }

  // Check if user can view material
  canViewMaterial(material: FgInItem): boolean {
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
      
      // Save to Firebase and wait for completion
      await this.saveMaterialsToFirebase(materials);
      
      // Refresh data from Firebase to get the latest state
      this.refreshData();
      
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

  private parseExcelData(data: any[]): FgInItem[] {
    return data.map((row: any, index: number) => ({
      factory: 'ASM1', // FG In chỉ dành cho ASM1
      importDate: new Date(), // Ngày hiện tại
      batchNumber: this.generateBatchNumber(), // Tự động tạo batch number
      materialCode: row['Mã TP'] || '',
      rev: row['REV'] || '',
      lot: row['LOT'] || '',
      lsx: row['LSX'] || '',
      quantity: parseInt(row['Lượng Nhập']) || 0,
      carton: 0, // Sẽ được tính toán khi tick "Đã nhận"
      odd: 0, // Sẽ được tính toán khi tick "Đã nhận"
      location: 'Temporary', // Mặc định là Temporary
      notes: row['Ghi chú'] || '',
      customer: '', // Sẽ lấy từ catalog khi tick "Đã nhận"
      isReceived: false, // Mặc định chưa nhận
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
  saveMaterialsToFirebase(materials: FgInItem[]): Promise<void> {
    const savePromises = materials.map(material => {
      const materialData = {
        ...material,
        importDate: material.importDate,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      delete materialData.id;
      
      return this.firestore.collection('fg-in').add(materialData)
        .then((docRef) => {
          console.log('FG In material saved to Firebase successfully with ID:', docRef.id);
          return docRef.id;
        })
        .catch(error => {
          console.error('Error saving FG In material to Firebase:', error);
          throw error;
        });
    });
    
    return Promise.all(savePromises).then(() => {
      console.log('All materials saved to Firebase successfully');
    });
  }

  // Generate batch number based on week and sequence
  private generateBatchNumber(): string {
    const now = new Date();
    const weekNumber = this.getWeekNumber(now);
    const sequence = Math.floor(Math.random() * 9999) + 1; // Random 4-digit sequence for demo
    return `${weekNumber}${sequence.toString().padStart(4, '0')}`;
  }

  // Get week number of the year
  private getWeekNumber(date: Date): number {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

    // Download template
  downloadTemplate(): void {
      const templateData = [
        {
        'Mã TP': 'FG001',
        'REV': 'REV001',
        'LSX': 'LSX001',
        'LOT': 'LOT001',
        'Lượng Nhập': 100,
        'Ghi chú': 'All items received in good condition'
      },
      {
        'Mã TP': 'FG002',
        'REV': 'REV002',
        'LSX': 'LSX002',
        'LOT': 'LOT002',
        'Lượng Nhập': 200,
        'Ghi chú': 'Second batch items'
      }
    ];

    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(templateData);
      XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'FG_In_Template.xlsx');
  }

  // Additional methods needed for the component
  editLocation(material: FgInItem): void {
    const newLocation = prompt('Nhập vị trí (sẽ tự động viết hoa):', material.location || '');
    if (newLocation !== null) {
      material.location = newLocation.toUpperCase();
      material.updatedAt = new Date();
      console.log(`Updated location for ${material.materialCode}: ${material.location}`);
      this.updateMaterialInFirebase(material);
    }
  }

  updateNotes(material: FgInItem): void {
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
    
    console.log('View all FG In materials:', {
      totalMaterials: this.materials.length,
      filteredMaterials: this.filteredMaterials.length,
      materials: this.materials
    });
  }

  applyTimeRangeFilter(): void {
    this.applyFilters();
    this.showTimeRangeDialog = false;
  }

  // ===== PRODUCT CATALOG METHODS =====

  // Load catalog from Firebase - One-time load when needed
  loadCatalogFromFirebase(): void {
    this.firestore.collection('fg-catalog')
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe((querySnapshot) => {
        const firebaseCatalog = querySnapshot.docs.map(doc => {
          const data = doc.data() as any;
          const id = doc.id;
          return {
            id: id,
            ...data,
            createdAt: data.createdAt ? new Date(data.createdAt.seconds * 1000) : new Date(),
            updatedAt: data.updatedAt ? new Date(data.updatedAt.seconds * 1000) : new Date()
          };
        });
        
        this.catalogItems = firebaseCatalog;
        this.applyCatalogFilters();
        console.log('Loaded FG Catalog from Firebase:', this.catalogItems.length);
      });
  }

  // Show catalog dialog
  showCatalog(): void {
    this.showCatalogDialog = true;
    // Load catalog data only when dialog is opened
    if (this.catalogItems.length === 0) {
      this.loadCatalogFromFirebase();
    } else {
      this.applyCatalogFilters();
    }
  }

  // Close catalog dialog
  closeCatalog(): void {
    this.showCatalogDialog = false;
    this.catalogSearchTerm = '';
    this.newCatalogItem = {
      materialCode: '',
      standard: '',
      customer: ''
    };
  }

  // Apply catalog filters
  applyCatalogFilters(): void {
    this.filteredCatalogItems = this.catalogItems.filter(item => {
      if (this.catalogSearchTerm) {
        const searchableText = [
          item.materialCode,
          item.standard,
          item.customer
        ].filter(Boolean).join(' ').toUpperCase();
        
        if (!searchableText.includes(this.catalogSearchTerm.toUpperCase())) {
    return false;
  }
      }
      return true;
    });
  }

  // Search catalog
  onCatalogSearchChange(event: any): void {
    this.catalogSearchTerm = event.target.value;
    this.applyCatalogFilters();
  }

  // Import catalog from Excel
  importCatalog(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,.xls';
    fileInput.style.display = 'none';
    
    fileInput.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.processCatalogExcelFile(file);
      }
    };
    
    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
  }

  private async processCatalogExcelFile(file: File): Promise<void> {
    try {
      const data = await this.readExcelFile(file);
      const catalogItems = this.parseCatalogExcelData(data);
      
      // Check for duplicates
      const duplicates = catalogItems.filter(newItem => 
        this.catalogItems.some(existingItem => 
          existingItem.materialCode === newItem.materialCode
        )
      );
      
      if (duplicates.length > 0) {
        const duplicateCodes = duplicates.map(d => d.materialCode).join(', ');
        alert(`❌ Có ${duplicates.length} mã TP trùng lặp: ${duplicateCodes}`);
        return;
      }
      
      // Save to Firebase
      this.saveCatalogItemsToFirebase(catalogItems);
      
      // Refresh catalog data
      this.loadCatalogFromFirebase();
      
      alert(`✅ Đã import thành công ${catalogItems.length} items vào danh mục!`);
      
    } catch (error) {
      console.error('Error processing catalog Excel file:', error);
      alert(`❌ Lỗi khi import file Excel: ${error.message || error}`);
    }
  }

  private parseCatalogExcelData(data: any[]): ProductCatalogItem[] {
    return data.map((row: any, index: number) => ({
      materialCode: row['Mã TP'] || '',
      standard: row['Standard'] || '',
      customer: row['Khách'] || '',
      createdAt: new Date(),
      updatedAt: new Date()
    })).filter(item => item.materialCode.trim() !== ''); // Filter out empty rows
  }

  // Save catalog items to Firebase
  saveCatalogItemsToFirebase(catalogItems: ProductCatalogItem[]): void {
    catalogItems.forEach(item => {
      const itemData = {
        ...item,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      delete itemData.id;
      
      this.firestore.collection('fg-catalog').add(itemData)
        .then((docRef) => {
          console.log('FG Catalog item saved to Firebase successfully with ID:', docRef.id);
        })
        .catch(error => {
          console.error('Error saving FG Catalog item to Firebase:', error);
        });
    });
  }

  // Add new catalog item manually
  addCatalogItem(): void {
    if (!this.newCatalogItem.materialCode.trim()) {
      alert('❌ Vui lòng nhập Mã TP');
      return;
    }

    // Check for duplicate
    const isDuplicate = this.catalogItems.some(item => 
      item.materialCode === this.newCatalogItem.materialCode
    );

    if (isDuplicate) {
      alert(`❌ Mã TP "${this.newCatalogItem.materialCode}" đã tồn tại trong danh mục`);
      return;
    }

    const newItem = {
      ...this.newCatalogItem,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.firestore.collection('fg-catalog').add(newItem)
      .then((docRef) => {
        console.log('FG Catalog item added successfully with ID:', docRef.id);
        alert(`✅ Đã thêm "${newItem.materialCode}" vào danh mục`);
        
        // Refresh catalog data
        this.loadCatalogFromFirebase();
        
        // Reset form
        this.newCatalogItem = {
          materialCode: '',
          standard: '',
          customer: ''
        };
      })
      .catch(error => {
        console.error('Error adding FG Catalog item:', error);
        alert(`❌ Lỗi khi thêm item: ${error.message || error}`);
      });
  }

  // Delete catalog item - Using same approach as clearAllData
  deleteCatalogItem(item: ProductCatalogItem): void {
    if (confirm(`Xác nhận xóa "${item.materialCode}" khỏi danh mục?`)) {
      if (item.id) {
        // Use the same approach as clearAllData - get document reference and delete
        this.firestore.collection('fg-catalog').doc(item.id).get().subscribe(doc => {
          if (doc.exists) {
            doc.ref.delete().then(() => {
              console.log('FG Catalog item deleted from Firebase successfully');
              alert(`✅ Đã xóa "${item.materialCode}" khỏi danh mục`);
              // Refresh catalog data
              this.loadCatalogFromFirebase();
            }).catch(error => {
              console.error('Error deleting FG Catalog item from Firebase:', error);
              alert(`❌ Lỗi khi xóa item: ${error.message || error}`);
            });
          } else {
            console.error('❌ Catalog document does not exist in Firebase');
            alert('❌ Không tìm thấy item trong Firebase');
          }
        });
      }
    }
  }

  // Download catalog template
  downloadCatalogTemplate(): void {
    const templateData = [
      {
        'Mã TP': 'FG001',
        'Standard': 'STD001',
        'Khách': 'Customer A'
      },
      {
        'Mã TP': 'FG002',
        'Standard': 'STD002',
        'Khách': 'Customer B'
      }
    ];

    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(templateData);
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'FG_Catalog_Template.xlsx');
  }


}
