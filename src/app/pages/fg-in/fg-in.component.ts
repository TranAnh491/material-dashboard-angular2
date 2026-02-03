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
  customerCode: string; // Mã khách hàng
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CustomerCodeMappingItem {
  id?: string;
  customerCode: string; // Mã khách hàng
  materialCode: string; // Mã thành phẩm
  description?: string; // Mô tả
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
    customer: '',
    customerCode: ''
  };
  
  // Customer Code Mapping
  showMappingDialog: boolean = false;
  mappingItems: CustomerCodeMappingItem[] = [];
  filteredMappingItems: CustomerCodeMappingItem[] = [];
  mappingSearchTerm: string = '';
  
  // New mapping item for manual addition
  newMappingItem: CustomerCodeMappingItem = {
    customerCode: '',
    materialCode: '',
    description: ''
  };

  // Nhập Kho dialog
  showNhapKhoDialog: boolean = false;
  newNhapKhoItem: { materialCode: string; quantity: number | null; lot: string; lsx: string } = {
    materialCode: '',
    quantity: null,
    lot: '',
    lsx: ''
  };
  nhapKhoMaterialSuggestions: CustomerCodeMappingItem[] = [];
  showNhapKhoSuggestions: boolean = false;
  private nhapKhoSuggestionsBlurTimer: any;
  private readonly NHAP_KHO_MIN_CHARS = 4; // Chỉ lọc khi nhập đủ 4 ký tự để hạn chế lag
  
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
    // Load mapping immediately
    this.loadMappingFromFirebase();
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

  // Lock / Unlock (cột Lock): Tick = khóa (chuyển Inventory), Bỏ tick = mở khóa để sửa
  updateLockStatus(material: FgInItem, checked: boolean): void {
    material.isReceived = checked;
    material.updatedAt = new Date();
    this.updateMaterialInFirebase(material);
    if (checked) {
      this.addToInventory(material);
    }
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

  // Nhập Kho - open/close dialog
  openNhapKho(): void {
    this.newNhapKhoItem = { materialCode: '', quantity: null, lot: '', lsx: '' };
    this.showNhapKhoSuggestions = false;
    this.nhapKhoMaterialSuggestions = [];
    this.showNhapKhoDialog = true;
  }

  closeNhapKho(): void {
    this.showNhapKhoDialog = false;
    this.showNhapKhoSuggestions = false;
    this.newNhapKhoItem = { materialCode: '', quantity: null, lot: '', lsx: '' };
    this.nhapKhoMaterialSuggestions = [];
    if (this.nhapKhoSuggestionsBlurTimer) clearTimeout(this.nhapKhoSuggestionsBlurTimer);
  }

  filterNhapKhoMaterialSuggestions(): void {
    const term = (this.newNhapKhoItem.materialCode || '').trim().toUpperCase();
    if (term.length < this.NHAP_KHO_MIN_CHARS) {
      this.nhapKhoMaterialSuggestions = [];
      this.showNhapKhoSuggestions = false;
      return;
    }
    this.nhapKhoMaterialSuggestions = this.mappingItems
      .filter(item => (item.materialCode || '').toUpperCase().includes(term))
      .slice(0, 20);
    this.showNhapKhoSuggestions = this.nhapKhoMaterialSuggestions.length > 0;
  }

  onNhapKhoMaterialCodeFocus(): void {
    this.filterNhapKhoMaterialSuggestions();
  }

  onNhapKhoMaterialCodeInput(): void {
    this.filterNhapKhoMaterialSuggestions();
  }

  onNhapKhoMaterialCodeBlur(): void {
    this.nhapKhoSuggestionsBlurTimer = setTimeout(() => {
      this.showNhapKhoSuggestions = false;
    }, 200);
  }

  selectNhapKhoMaterialCode(item: CustomerCodeMappingItem): void {
    this.newNhapKhoItem.materialCode = item.materialCode || '';
    this.showNhapKhoSuggestions = false;
  }

  submitNhapKho(): void {
    const code = (this.newNhapKhoItem.materialCode || '').trim();
    const qty = this.newNhapKhoItem.quantity != null ? Number(this.newNhapKhoItem.quantity) : 0;
    if (!code) {
      alert('Vui lòng nhập Mã TP.');
      return;
    }
    if (!qty || qty <= 0) {
      alert('Vui lòng nhập Số lượng hợp lệ.');
      return;
    }
    const materialData = {
      factory: 'ASM1',
      importDate: new Date(),
      batchNumber: this.generateBatchNumber(0),
      materialCode: code,
      rev: '',
      lot: (this.newNhapKhoItem.lot || '').trim(),
      lsx: (this.newNhapKhoItem.lsx || '').trim(),
      quantity: qty,
      carton: 0,
      odd: 0,
      location: 'Temporary',
      notes: '',
      customer: '',
      isReceived: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.firestore.collection('fg-in').add(materialData)
      .then((docRef) => {
        const newMaterial = { ...materialData, id: docRef.id } as FgInItem;
        this.addToInventory(newMaterial);
        this.refreshData();
        this.closeNhapKho();
      })
      .catch(err => {
        console.error('Error adding FG In material:', err);
        alert('Lỗi khi lưu: ' + (err?.message || err));
      });
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

  // Lấy Tên khách hàng từ danh mục Mapping (cột Tên Khách Hàng = description)
  getCustomerNameFromMapping(materialCode: string): string {
    const mapping = this.mappingItems.find(item => item.materialCode === materialCode);
    return mapping ? (mapping.description || '') : '';
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
    return this.availableFactories.includes(materialFactory) && !material.isReceived;
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
      factory: 'ASM1',
      importDate: new Date(),
      batchNumber: this.generateBatchNumber(index),
      materialCode: row['Mã TP'] || '',
      rev: row['REV'] || '',
      lot: row['LOT'] || '',
      lsx: row['LSX'] || '',
      quantity: parseInt(row['Lượng Nhập']) || 0,
      carton: 0,
      odd: 0,
      location: 'Temporary',
      notes: row['Ghi chú'] || '',
      customer: '',
      isReceived: false,
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

  // Batch 8 số: DDMM + 4 số thứ tự (0001, 0002, ...). offset dùng khi import nhiều dòng cùng lúc.
  private generateBatchNumber(offset: number = 0): string {
    const now = new Date();
    const dd = ('0' + now.getDate()).slice(-2);
    const mm = ('0' + (now.getMonth() + 1)).slice(-2);
    const prefix = dd + mm;
    const todayBatchNumbers = this.materials.filter(m => {
      const d = m.importDate instanceof Date ? m.importDate : new Date(m.importDate);
      const md = ('0' + d.getDate()).slice(-2);
      const mMonth = ('0' + (d.getMonth() + 1)).slice(-2);
      return (md + mMonth) === prefix && (m.batchNumber || '').length >= 8;
    });
    let maxSeq = 0;
    todayBatchNumbers.forEach(m => {
      const seq = parseInt((m.batchNumber || '').slice(-4), 10);
      if (!isNaN(seq)) maxSeq = Math.max(maxSeq, seq);
    });
    const nextSeq = maxSeq + 1 + offset;
    return prefix + nextSeq.toString().padStart(4, '0');
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
      customer: '',
      customerCode: ''
    };
  }

  // Apply catalog filters
  applyCatalogFilters(): void {
    this.filteredCatalogItems = this.catalogItems.filter(item => {
      if (this.catalogSearchTerm) {
        const searchableText = [
          item.materialCode,
          item.standard,
          item.customer,
          item.customerCode
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
      customerCode: row['Mã khách hàng'] || row['Mã Khách Hàng'] || row['Customer Code'] || '',
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
          customer: '',
          customerCode: ''
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
        'Khách': 'Customer A',
        'Mã khách hàng': 'CUST001'
      },
      {
        'Mã TP': 'FG002',
        'Standard': 'STD002',
        'Khách': 'Customer B',
        'Mã khách hàng': 'CUST002'
      }
    ];

    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(templateData);
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'FG_Catalog_Template.xlsx');
  }

  // Sync customer code from mapping to catalog
  syncCustomerCodeFromMapping(): void {
    console.log('🔄 Starting sync customer code from mapping to catalog...');
    
    // Ensure mapping is loaded
    if (this.mappingItems.length === 0) {
      this.loadMappingFromFirebase();
      // Wait a bit for mapping to load
      setTimeout(() => {
        this.performSync();
      }, 500);
    } else {
      this.performSync();
    }
  }

  private performSync(): void {
    if (this.mappingItems.length === 0) {
      alert('❌ Không có dữ liệu mapping để đồng bộ!');
      return;
    }

    if (this.catalogItems.length === 0) {
      alert('❌ Không có dữ liệu catalog để đồng bộ!');
      return;
    }

    let updatedCount = 0;
    let createdCount = 0;
    const updatePromises: Promise<void>[] = [];

    // Create a map: materialCode -> customerCode from mapping
    const mappingMap = new Map<string, string>();
    this.mappingItems.forEach(mapping => {
      if (mapping.materialCode && mapping.customerCode) {
        // If multiple mappings for same materialCode, keep the first one
        if (!mappingMap.has(mapping.materialCode)) {
          mappingMap.set(mapping.materialCode, mapping.customerCode);
        }
      }
    });

    console.log(`📊 Found ${mappingMap.size} unique material codes in mapping`);

    // Update existing catalog items
    this.catalogItems.forEach(catalogItem => {
      if (catalogItem.materialCode && catalogItem.id) {
        const customerCodeFromMapping = mappingMap.get(catalogItem.materialCode);
        
        if (customerCodeFromMapping) {
          // Only update if customerCode is different or empty
          if (catalogItem.customerCode !== customerCodeFromMapping) {
            console.log(`🔄 Updating catalog item ${catalogItem.materialCode}: ${catalogItem.customerCode || '(empty)'} -> ${customerCodeFromMapping}`);
            updatedCount++;
            
            const updatePromise = this.firestore.collection('fg-catalog').doc(catalogItem.id).update({
              customerCode: customerCodeFromMapping,
              updatedAt: new Date()
            })
            .then(() => {
              // Update local item
              catalogItem.customerCode = customerCodeFromMapping;
              console.log(`✅ Updated catalog item ${catalogItem.materialCode}`);
            })
            .catch(error => {
              console.error(`❌ Error updating catalog item ${catalogItem.materialCode}:`, error);
            });
            
            updatePromises.push(updatePromise);
          }
        }
      }
    });

    // Wait for all updates to complete
    Promise.all(updatePromises).then(() => {
      // Refresh catalog data
      this.loadCatalogFromFirebase();
      
      if (updatedCount > 0) {
        alert(`✅ Đã đồng bộ ${updatedCount} items trong catalog với Mã khách hàng từ mapping!`);
      } else {
        alert('ℹ️ Tất cả items đã có Mã khách hàng đúng hoặc không có mapping tương ứng.');
      }
    }).catch(error => {
      console.error('❌ Error during sync:', error);
      alert(`❌ Lỗi khi đồng bộ: ${error.message || error}`);
    });
  }

  // ===== CUSTOMER CODE MAPPING METHODS =====

  // Load mapping from Firebase
  loadMappingFromFirebase(): void {
    this.firestore.collection('fg-customer-mapping')
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe((querySnapshot) => {
        const firebaseMapping = querySnapshot.docs.map(doc => {
          const data = doc.data() as any;
          const id = doc.id;
          return {
            id: id,
            ...data,
            createdAt: data.createdAt ? new Date(data.createdAt.seconds * 1000) : new Date(),
            updatedAt: data.updatedAt ? new Date(data.updatedAt.seconds * 1000) : new Date()
          };
        });
        
        this.mappingItems = firebaseMapping;
        this.applyMappingFilters();
        console.log('Loaded Customer Code Mapping from Firebase:', this.mappingItems.length);
      });
  }

  // Show mapping dialog
  showMapping(): void {
    this.showMappingDialog = true;
    if (this.mappingItems.length === 0) {
      this.loadMappingFromFirebase();
    } else {
      this.applyMappingFilters();
    }
  }

  // Close mapping dialog
  closeMapping(): void {
    this.showMappingDialog = false;
    this.mappingSearchTerm = '';
    this.newMappingItem = {
      customerCode: '',
      materialCode: '',
      description: ''
    };
  }

  // Apply mapping filters
  applyMappingFilters(): void {
    this.filteredMappingItems = this.mappingItems.filter(item => {
      if (this.mappingSearchTerm) {
        const searchableText = [
          item.customerCode,
          item.materialCode,
          item.description
        ].filter(Boolean).join(' ').toUpperCase();
        
        if (!searchableText.includes(this.mappingSearchTerm.toUpperCase())) {
          return false;
        }
      }
      return true;
    });
  }

  // Search mapping
  onMappingSearchChange(event: any): void {
    this.mappingSearchTerm = event.target.value;
    this.applyMappingFilters();
  }

  // Import mapping from Excel
  importMapping(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,.xls';
    fileInput.style.display = 'none';
    
    fileInput.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.processMappingExcelFile(file);
      }
    };
    
    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
  }

  private async processMappingExcelFile(file: File): Promise<void> {
    try {
      const data = await this.readExcelFile(file);
      const mappingItems = this.parseMappingExcelData(data);
      
      // Check for duplicates
      const duplicates = mappingItems.filter(newItem => 
        this.mappingItems.some(existingItem => 
          existingItem.customerCode === newItem.customerCode
        )
      );
      
      if (duplicates.length > 0) {
        const duplicateCodes = duplicates.map(d => d.customerCode).join(', ');
        const confirmed = confirm(`⚠️ Có ${duplicates.length} mã khách hàng trùng lặp: ${duplicateCodes}\n\nBạn có muốn tiếp tục import?`);
        if (!confirmed) return;
      }
      
      // Save to Firebase
      this.saveMappingItemsToFirebase(mappingItems);
      
      // Refresh mapping data
      this.loadMappingFromFirebase();
      
      alert(`✅ Đã import thành công ${mappingItems.length} items vào mapping!`);
      
    } catch (error) {
      console.error('Error processing mapping Excel file:', error);
      alert(`❌ Lỗi khi import file Excel: ${error.message || error}`);
    }
  }

  private parseMappingExcelData(data: any[]): CustomerCodeMappingItem[] {
    return data.map((row: any) => ({
      customerCode: row['Mã Khách Hàng'] || row['Customer Code'] || '',
      materialCode: row['Mã Thành Phẩm'] || row['Material Code'] || '',
      description: row['Mô Tả'] || row['Description'] || '',
      createdAt: new Date(),
      updatedAt: new Date()
    })).filter(item => item.customerCode.trim() !== '' && item.materialCode.trim() !== ''); // Filter out empty rows
  }

  // Save mapping items to Firebase
  saveMappingItemsToFirebase(mappingItems: CustomerCodeMappingItem[]): void {
    mappingItems.forEach(item => {
      const itemData = {
        ...item,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      delete itemData.id;
      
      this.firestore.collection('fg-customer-mapping').add(itemData)
        .then((docRef) => {
          console.log('Customer Code Mapping item saved to Firebase successfully with ID:', docRef.id);
        })
        .catch(error => {
          console.error('Error saving Customer Code Mapping item to Firebase:', error);
        });
    });
  }

  // Add new mapping item manually
  addMappingItem(): void {
    if (!this.newMappingItem.customerCode.trim() || !this.newMappingItem.materialCode.trim()) {
      alert('❌ Vui lòng nhập đầy đủ Mã Khách Hàng và Mã Thành Phẩm');
      return;
    }

    // Check for duplicate
    const isDuplicate = this.mappingItems.some(item => 
      item.customerCode === this.newMappingItem.customerCode
    );

    if (isDuplicate) {
      const confirmed = confirm(`⚠️ Mã Khách Hàng "${this.newMappingItem.customerCode}" đã tồn tại trong mapping.\n\nBạn có muốn thêm duplicate?`);
      if (!confirmed) return;
    }

    const newItem = {
      ...this.newMappingItem,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.firestore.collection('fg-customer-mapping').add(newItem)
      .then((docRef) => {
        console.log('Customer Code Mapping item added successfully with ID:', docRef.id);
        alert(`✅ Đã thêm mapping "${newItem.customerCode}" → "${newItem.materialCode}"`);
        
        // Refresh mapping data
        this.loadMappingFromFirebase();
        
        // Reset form
        this.newMappingItem = {
          customerCode: '',
          materialCode: '',
          description: ''
        };
      })
      .catch(error => {
        console.error('Error adding Customer Code Mapping item:', error);
        alert(`❌ Lỗi khi thêm item: ${error.message || error}`);
      });
  }

  // Delete mapping item
  deleteMappingItem(item: CustomerCodeMappingItem): void {
    if (confirm(`Xác nhận xóa mapping "${item.customerCode}" → "${item.materialCode}"?`)) {
      if (item.id) {
        this.firestore.collection('fg-customer-mapping').doc(item.id).get().subscribe(doc => {
          if (doc.exists) {
            doc.ref.delete().then(() => {
              console.log('Customer Code Mapping item deleted from Firebase successfully');
              alert(`✅ Đã xóa mapping "${item.customerCode}"`);
              // Refresh mapping data
              this.loadMappingFromFirebase();
            }).catch(error => {
              console.error('Error deleting Customer Code Mapping item from Firebase:', error);
              alert(`❌ Lỗi khi xóa item: ${error.message || error}`);
            });
          } else {
            console.error('❌ Mapping document does not exist in Firebase');
            alert('❌ Không tìm thấy item trong Firebase');
          }
        });
      }
    }
  }

  // Download mapping template
  downloadMappingTemplate(): void {
    const templateData = [
      {
        'Mã Khách Hàng': 'CUST001',
        'Mã Thành Phẩm': 'P001234',
        'Mô Tả': 'Customer 1 Product Mapping'
      },
      {
        'Mã Khách Hàng': 'CUST002',
        'Mã Thành Phẩm': 'P002345',
        'Mô Tả': 'Customer 2 Product Mapping'
      }
    ];

    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(templateData);
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'FG_Customer_Mapping_Template.xlsx');
  }

  // Get material code from customer code mapping
  getMaterialCodeFromCustomerCode(customerCode: string): string {
    const mapping = this.mappingItems.find(item => item.customerCode === customerCode);
    return mapping ? mapping.materialCode : '';
  }

}
