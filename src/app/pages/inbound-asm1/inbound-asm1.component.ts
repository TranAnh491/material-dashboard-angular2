import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import * as QRCode from 'qrcode';
import { FactoryAccessService } from '../../services/factory-access.service';


export interface InboundMaterial {
  id?: string;
  factory?: string; // Factory identifier (ASM1, ASM2, etc.)
  importDate: Date;
  batchNumber: string;
  materialCode: string;
  poNumber: string;
  quantity: number;
  unit: string;
  location: string;
  type: string;
  expiryDate: Date | null;
  qualityCheck: boolean; // Changed to boolean for Tick/No
  isReceived: boolean;
  notes: string;
  rollsOrBags: number;
  supplier: string;
  remarks: string;
  isCompleted: boolean;
  hasQRGenerated?: boolean; // Track if QR code has been generated
  createdAt?: Date;
  updatedAt?: Date;
  
  // New fields for batch processing
  batchStartTime?: Date; // Thời gian bắt đầu kiểm lô hàng
  batchEndTime?: Date;   // Thời gian kết thúc kiểm lô hàng
  employeeIds?: string[]; // Danh sách mã nhân viên tham gia kiểm
  batchStatus?: 'idle' | 'active' | 'completed'; // Trạng thái lô hàng
  batchDuration?: number; // Thời gian hoàn thành (phút)
}

@Component({
  selector: 'app-inbound-asm1',
  templateUrl: './inbound-asm1.component.html',
  styleUrls: ['./inbound-asm1.component.scss']
})
export class InboundASM1Component implements OnInit, OnDestroy {
  materials: InboundMaterial[] = [];
  filteredMaterials: InboundMaterial[] = [];
  
  // Search and filter
  searchTerm: string = '';
  searchType: string = 'materialCode'; // Default to Mã Hàng
  
  // Factory filter - Fixed to ASM1
  selectedFactory: string = 'ASM1';
  availableFactories: string[] = ['ASM1'];
  
  // Time range filter
  startDate: string = '';
  endDate: string = '';
  
  // Status filter
  statusFilter: string = 'pending'; // Default to Chưa
  
  // Auto-hide received materials after next day (not 24 hours, but by calendar day)
  hideReceivedAfterNextDay: boolean = true;
  
  // Batch processing properties
  isBatchActive: boolean = false;
  currentBatchNumber: string = '';
  currentEmployeeIds: string[] = [];
  batchStartTime: Date | null = null;
  showBatchModal: boolean = false;
  scannedEmployeeId: string = '';
  
  // Physical Scanner properties (copy from outbound)
  isScannerInputActive: boolean = false;
  scannerBuffer: string = '';
  scannerTimeout: any = null;
  scanStartTime: number = 0;
  
  // Camera Mode properties
  isCameraModeActive: boolean = false;
  cameraScanner: any = null; // HTML5 QR Scanner instance
  
  // Loading state
  isLoading: boolean = false;
  
  // Error handling
  errorMessage: string = '';
  
  // Excel import
  selectedFile: File | null = null;
  
  // User permissions
  canAddMaterials: boolean = false;
  canEditMaterials: boolean = false;
  canDeleteMaterials: boolean = false;
  canGenerateQR: boolean = false;
  canExportData: boolean = false;
  
  // Lifecycle management
  private destroy$ = new Subject<void>();
  
  // Thêm properties mới cho giao diện input trực tiếp
  isEmployeeCodeSaved = false;
  selectedBatch: string = '';
  availableBatches: any[] = [];
  employeeCode: string = '';
  isBatchScanningMode: boolean = false;
  
  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private factoryAccessService: FactoryAccessService
  ) {}
  
  ngOnInit(): void {
    console.log('🏭 Inbound ASM1 component initialized');
    this.loadPermissions();
    this.loadMaterials();
    this.setupDateDefaults();
  }
  
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
  
  private loadPermissions(): void {
    this.afAuth.authState.pipe(takeUntil(this.destroy$)).subscribe(user => {
      if (user) {
        // Load user permissions for ASM1
        this.canAddMaterials = true;
        this.canEditMaterials = true;
        this.canDeleteMaterials = true;
        this.canGenerateQR = true;
        this.canExportData = true;
        console.log('✅ ASM1 Inbound permissions loaded');
      }
    });
  }
  
  private setupDateDefaults(): void {
    const today = new Date();
    // Cố định hiển thị 30 ngày, tính từ hôm nay quay ngược lại 30 ngày
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    this.startDate = thirtyDaysAgo.toISOString().split('T')[0];
    this.endDate = today.toISOString().split('T')[0];
  }
  
  loadMaterials(): void {
    this.isLoading = true;
    this.errorMessage = '';
    
    console.log('📦 Loading ASM1 inbound materials...');
    this.tryLoadFromCollection('inbound-materials');
  }
  
  private tryLoadFromCollection(collectionName: string): void {
    console.log(`🔍 Trying collection: ${collectionName}`);
    
    this.firestore.collection(collectionName, ref => 
      ref.limit(1000)
    ).snapshotChanges()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        console.log(`🔍 Raw snapshot from ${collectionName} contains ${snapshot.length} documents`);
        
        if (snapshot.length === 0) {
          console.log(`❌ No data in ${collectionName}, trying other collections...`);
          this.tryAlternativeCollections();
          return;
        }
        
        // Log first few documents to see structure
        if (snapshot.length > 0) {
          console.log('📄 Sample document:', snapshot[0].payload.doc.data());
        }
        
        // Filter for ASM1 factory and sort client-side
        const allMaterials = snapshot.map(doc => {
          const data = doc.payload.doc.data() as any;
          console.log(`📦 Processing doc ${doc.payload.doc.id}, factory: ${data.factory}, isReceived: ${data.isReceived}`);
          return {
            id: doc.payload.doc.id,
            factory: data.factory || 'ASM1',
            importDate: data.importDate?.toDate() || new Date(),
            batchNumber: data.batchNumber || '',
            materialCode: data.materialCode || '',
            poNumber: data.poNumber || '',
            quantity: data.quantity || 0,
            unit: data.unit || '',
            location: data.location || '',
            type: data.type || '',
            expiryDate: data.expiryDate?.toDate() || null,
            qualityCheck: data.qualityCheck || false,
            isReceived: data.isReceived || false,
            notes: data.notes || '',
            rollsOrBags: data.rollsOrBags || 0,
            supplier: data.supplier || '',
            remarks: data.remarks || '',
            isCompleted: data.isCompleted || false,
            hasQRGenerated: data.hasQRGenerated || false,
            createdAt: data.createdAt?.toDate() || data.createdDate?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || data.lastUpdated?.toDate() || new Date()
          } as InboundMaterial;
        });
        
        console.log(`🏭 All materials before filter: ${allMaterials.length}`);
        console.log(`🏭 Factory values found:`, allMaterials.map(m => m.factory));
        console.log(`🏭 Received status found:`, allMaterials.map(m => ({ materialCode: m.materialCode, isReceived: m.isReceived })));
        
        this.materials = allMaterials
          .filter(material => material.factory === 'ASM1')
          .sort((a, b) => {
            // Sort by import date first (oldest first)
            const dateCompare = a.importDate.getTime() - b.importDate.getTime();
            if (dateCompare !== 0) return dateCompare;
            
            // If same date, sort by creation time (import order)
            return a.createdAt.getTime() - b.createdAt.getTime();
          });
        
        console.log(`✅ ASM1 materials after filter: ${this.materials.length}`);
        
        this.applyFilters();
        this.isLoading = false;
        
        console.log(`✅ Final filtered materials: ${this.filteredMaterials.length}`);
      },
      error: (error) => {
        console.error(`❌ Error loading from ${collectionName}:`, error);
        this.tryAlternativeCollections();
      }
    });
  }
  
  private tryAlternativeCollections(): void {
    const alternativeCollections = ['inbound-materials', 'materials', 'inbound-asm1'];
    
    console.log('🔄 Trying alternative collections:', alternativeCollections);
    
    // Check each collection for data
    alternativeCollections.forEach(collection => {
      this.firestore.collection(collection, ref => ref.limit(5))
        .get().toPromise().then(snapshot => {
          if (snapshot && !snapshot.empty) {
            console.log(`✅ Found ${snapshot.size} documents in ${collection}`);
            console.log(`📄 Sample from ${collection}:`, snapshot.docs[0].data());
          } else {
            console.log(`❌ No data in ${collection}`);
          }
        }).catch(err => {
          console.log(`❌ Error accessing ${collection}:`, err);
        });
    });
    
    this.isLoading = false;
    this.errorMessage = 'Không tìm thấy dữ liệu trong các collection. Kiểm tra Firebase Console để xác nhận collection name và data structure.';
  }
  
  applyFilters(): void {
    let filtered = [...this.materials];
    
    // Auto-hide received materials after next day (not 24 hours, but by calendar day)
    if (this.hideReceivedAfterNextDay) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Start of today
      
      filtered = filtered.filter(material => {
        // If material is not received, always show it
        if (!material.isReceived) {
          return true;
        }
        
        // If material is received, check if it was received before today
        // We need to check when the material was marked as received
        // Since we don't have a specific "receivedAt" field, we'll use updatedAt
        // which gets updated when isReceived is set to true
        const receivedTime = material.updatedAt || material.createdAt;
        const receivedDate = new Date(receivedTime.getFullYear(), receivedTime.getMonth(), receivedTime.getDate()); // Start of received date
        
        // Hide if received before today (i.e., received yesterday or earlier)
        return receivedDate >= today;
      });
      
      console.log(`🕐 Auto-hide filter: ${this.materials.length - filtered.length} received materials from previous days will be hidden`);
    }
    
    // Search filter
    if (this.searchTerm.trim()) {
      const searchLower = this.searchTerm.toLowerCase().trim();
      
      switch (this.searchType) {
        case 'materialCode':
          filtered = filtered.filter(material => 
            material.materialCode.toLowerCase().includes(searchLower)
          );
          break;
        case 'batchNumber':
          filtered = filtered.filter(material => 
            material.batchNumber.toLowerCase().includes(searchLower)
          );
          break;
        case 'poNumber':
          filtered = filtered.filter(material => 
            material.poNumber.toLowerCase().includes(searchLower)
          );
          break;
        default: // 'all'
          filtered = filtered.filter(material => 
            material.materialCode.toLowerCase().includes(searchLower) ||
            material.poNumber.toLowerCase().includes(searchLower) ||
            material.batchNumber.toLowerCase().includes(searchLower) ||
            material.supplier.toLowerCase().includes(searchLower) ||
            material.location.toLowerCase().includes(searchLower)
          );
          break;
      }
    }
    
    // Date range filter
    if (this.startDate) {
      const start = new Date(this.startDate);
      filtered = filtered.filter(material => material.importDate >= start);
    }
    
    if (this.endDate) {
      const end = new Date(this.endDate);
      end.setHours(23, 59, 59, 999);
      filtered = filtered.filter(material => material.importDate <= end);
    }
    
    // Status filter
    if (this.statusFilter) {
      switch (this.statusFilter) {
        case 'completed':
          filtered = filtered.filter(material => material.isCompleted);
          break;
        case 'pending':
          filtered = filtered.filter(material => !material.isCompleted);
          break;
      }
    }
    
    // Filter by current batch when processing
    if (this.isBatchActive && this.currentBatchNumber && this.currentBatchNumber.trim() !== '') {
      filtered = filtered.filter(material => material.batchNumber === this.currentBatchNumber);
      console.log(`📦 Filtering by current batch: ${this.currentBatchNumber}`);
    }
    
    // Always maintain sort order by import date (oldest first) and creation time
    filtered.sort((a, b) => {
      // Sort by import date first (oldest first)
      const dateCompare = a.importDate.getTime() - b.importDate.getTime();
      if (dateCompare !== 0) return dateCompare;
      
      // If same date, sort by creation time (import order)
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    
    this.filteredMaterials = filtered;
    // this.updatePagination(); // Removed pagination update
    
    console.log(`🔍 ASM1 filtered: ${filtered.length}/${this.materials.length} materials`);
  }
  
  // updatePagination(): void { // Removed pagination update
  //   this.totalPages = Math.ceil(this.filteredMaterials.length / this.itemsPerPage);
  //   if (this.currentPage > this.totalPages) {
  //     this.currentPage = 1;
  //   }
  // }
  
  // getPaginatedMaterials(): InboundMaterial[] { // Removed pagination
  //   const startIndex = (this.currentPage - 1) * this.itemsPerPage;
  //   const endIndex = startIndex + this.itemsPerPage;
  //   return this.filteredMaterials.slice(startIndex, endIndex);
  // }
  
  onSearchChange(): void {
    // this.currentPage = 1; // Removed pagination
    this.applyFilters();
  }
  
  onDateFilterChange(): void {
    // this.currentPage = 1; // Removed pagination
    this.applyFilters();
  }
  
  onExpiryDateChange(event: any, material: any): void {
    const target = event.target as HTMLInputElement;
    material.expiryDate = target.value ? new Date(target.value) : null;
    this.updateMaterial(material);
  }
  

  
  onQualityCheckChange(event: any, material: InboundMaterial): void {
    const target = event.target as HTMLInputElement;
    material.qualityCheck = target.checked;
    this.updateMaterial(material);
  }
  
  // Add material to Inventory when received
  private addToInventory(material: InboundMaterial): void {
    console.log(`Adding ${material.materialCode} to Inventory ASM1...`);
    
    const inventoryMaterial = {
      factory: 'ASM1',
      importDate: material.importDate,
      receivedDate: new Date(), // When moved to inventory
      batchNumber: material.batchNumber,
      materialCode: material.materialCode,
      poNumber: material.poNumber,
      quantity: material.quantity,
      unit: material.unit,
      exported: 0, // Initially no exports
      stock: material.quantity, // Initial stock = quantity
      location: material.location,
      type: material.type,
      expiryDate: material.expiryDate,
      qualityCheck: material.qualityCheck,
      isReceived: true,
      notes: material.notes,
      rollsOrBags: material.rollsOrBags,
      supplier: material.supplier,
      remarks: material.remarks,
      isCompleted: material.isCompleted,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Add to inventory-materials collection (no notification)
    this.firestore.collection('inventory-materials').add(inventoryMaterial)
      .then(() => {
        console.log(`✅ ${material.materialCode} added to Inventory ASM1`);
        // No notification shown - silent operation
      })
      .catch((error) => {
        console.error('❌ Error adding to inventory:', error);
        // Revert the checkbox if failed
        material.isReceived = false;
        this.updateMaterial(material);
      });
  }
  
  onStatusFilterChange(): void {
    // this.currentPage = 1; // Removed pagination
    this.applyFilters();
  }
  
  onSearchTypeChange(): void {
    // this.currentPage = 1; // Removed pagination
    this.applyFilters();
  }
  
  getSearchPlaceholder(): string {
    switch (this.searchType) {
      case 'materialCode':
        return 'Tìm kiếm theo mã hàng...';
      case 'batchNumber':
        return 'Tìm kiếm theo lô hàng...';
      case 'poNumber':
        return 'Tìm kiếm theo PO...';
      default:
        return 'Tìm kiếm ASM1...';
    }
  }
  
  clearFilters(): void {
    this.searchTerm = '';
    this.searchType = 'materialCode';
    this.startDate = '';
    this.endDate = '';
    this.statusFilter = 'pending';
    this.setupDateDefaults();
    this.applyFilters();
  }
  
  // Navigation methods // Removed pagination
  // goToPage(page: number): void {
  //   if (page >= 1 && page <= this.totalPages) {
  //     this.currentPage = page;
  //   }
  // }
  
  // previousPage(): void {
  //   if (this.currentPage > 1) {
  //     this.currentPage--;
  //   }
  // }
  
  // nextPage(): void {
  //   if (this.currentPage < this.totalPages) {
  //     this.currentPage++;
  //   }
  // }
  
  // Dropdown functionality
  showDropdown: boolean = false;
  
  toggleDropdown(): void {
    this.showDropdown = !this.showDropdown;
    
    // Close dropdown when clicking outside
    if (this.showDropdown) {
      setTimeout(() => {
        document.addEventListener('click', this.onDocumentClick.bind(this), { once: true });
      }, 0);
    }
  }
  
  closeDropdown(): void {
    this.showDropdown = false;
  }
  
  onDocumentClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.dropdown')) {
      this.showDropdown = false;
    }
  }
  
  // Search functionality
  onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchTerm = target.value;
    this.applyFilters();
  }
  
  changeSearchType(type: string): void {
    this.searchType = type;
    this.applyFilters();
  }
  
  changeStatusFilter(status: string): void {
    this.statusFilter = status;
    this.applyFilters();
  }
  
  // Import functionality
  importFile(): void {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xlsx,.xls,.csv';
    fileInput.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.onFileSelect(file);
      }
    };
    fileInput.click();
  }
  
  onFileSelect(file: File): void {
    // Basic file validation
    if (!file) return;
    
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ];
    
    if (!allowedTypes.includes(file.type)) {
      alert('❌ Chỉ hỗ trợ file Excel (.xlsx, .xls) hoặc CSV');
      return;
    }
    
    console.log('📁 File selected:', file.name);
    
    // Show loading state
    this.isLoading = true;
    this.errorMessage = 'Đang import dữ liệu...';
    
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        if (jsonData.length < 2) {
          alert('❌ File không có dữ liệu hoặc format không đúng');
          this.isLoading = false;
          this.errorMessage = '';
          return;
        }
        
        // Get headers from first row
        const headers = jsonData[0] as string[];
        console.log('📋 Headers found:', headers);
        
        // Process data rows (skip header row)
        const materialsToAdd: InboundMaterial[] = [];
        
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i] as any[];
          if (row.length === 0 || !row.some(cell => cell !== null && cell !== undefined && cell !== '')) {
            continue; // Skip empty rows
          }
          
          try {
            const material = this.parseExcelRow(row, headers);
            if (material) {
              materialsToAdd.push(material);
            }
          } catch (error) {
            console.warn(`⚠️ Skipping row ${i + 1}:`, error);
          }
        }
        
        if (materialsToAdd.length === 0) {
          alert('❌ Không có dữ liệu hợp lệ để import');
          this.isLoading = false;
          this.errorMessage = '';
          return;
        }
        
        console.log(`📦 Found ${materialsToAdd.length} materials to import`);
        
        // Add materials to Firebase
        this.addMaterialsToFirebase(materialsToAdd);
        
      } catch (error) {
        console.error('❌ Error processing file:', error);
        alert(`❌ Lỗi xử lý file: ${error.message}`);
        this.isLoading = false;
        this.errorMessage = '';
      }
    };
    
    reader.onerror = () => {
      alert('❌ Lỗi đọc file');
      this.isLoading = false;
      this.errorMessage = '';
    };
    
    reader.readAsArrayBuffer(file);
  }
  
  private parseExcelRow(row: any[], headers: string[]): InboundMaterial | null {
    try {
      const getValue = (index: number): string => {
        return row[index] ? String(row[index]).trim() : '';
      };
      
      const getNumberValue = (index: number): number => {
        const value = row[index];
        if (value === null || value === undefined || value === '') return 0;
        // Parse as number and convert to integer (no decimal points)
        const num = Number(value);
        return isNaN(num) ? 0 : Math.floor(num);
      };

      // Map only the 6 essential columns from template
      const lotNumber = getValue(0);         // LÔ HÀNG/ DNNK
      const materialCode = getValue(1);      // MÃ HÀNG
      const poNumber = getValue(2);          // SỐ P.O
      const quantity = getNumberValue(3);    // LƯỢNG NHẬP (whole number only)
      const type = getValue(4);              // LOẠI HÌNH
      const supplier = getValue(5);          // NHÀ CUNG CẤP

      if (!lotNumber || !materialCode || !poNumber || quantity <= 0) {
        return null;
      }

      return {
        id: '',
        factory: 'ASM1', // Auto-filled
        importDate: new Date(), // Auto-filled
        batchNumber: lotNumber,
        materialCode: materialCode,
        poNumber: poNumber,
        quantity: quantity,
        unit: '', // No default value - leave empty
        location: 'IQC', // Default value
        type: type || 'Raw Material', // From import or default
        expiryDate: null, // Default value
        qualityCheck: false, // Default value
        isReceived: false, // Default value
        notes: '', // Default value
        rollsOrBags: 0, // Default value
        supplier: supplier, // From import
        remarks: '', // Default value
        isCompleted: false, // Default value
        hasQRGenerated: false, // Default value
        createdAt: new Date(),
        updatedAt: new Date()
      };
    } catch (error) {
      console.error('Error parsing row:', error);
      return null;
    }
  }
  
  private async addMaterialsToFirebase(materials: InboundMaterial[]): Promise<void> {
    try {
      let successCount = 0;
      let errorCount = 0;
      
      // Use batch operations for better performance
      const batchSize = 500; // Firestore batch limit
      
      for (let i = 0; i < materials.length; i += batchSize) {
        const batch = this.firestore.firestore.batch();
        const batchMaterials = materials.slice(i, i + batchSize);
        
        batchMaterials.forEach(material => {
          const docRef = this.firestore.collection('inbound-materials').doc().ref;
          batch.set(docRef, material);
        });
        
        try {
          await batch.commit();
          successCount += batchMaterials.length;
          console.log(`✅ Batch ${Math.floor(i / batchSize) + 1} completed: ${batchMaterials.length} materials`);
        } catch (error) {
          console.error(`❌ Batch ${Math.floor(i / batchSize) + 1} failed:`, error);
          errorCount += batchMaterials.length;
        }
      }
      
      // Show results
      if (successCount > 0) {
        alert(`✅ Import thành công ${successCount} materials!\n${errorCount > 0 ? `❌ ${errorCount} materials bị lỗi` : ''}`);
        
        // Reload materials to show new data
        this.loadMaterials();
      } else {
        alert(`❌ Import thất bại: ${errorCount} materials bị lỗi`);
      }
      
    } catch (error) {
      console.error('❌ Error adding materials to Firebase:', error);
      alert(`❌ Lỗi import: ${error.message}`);
    } finally {
      this.isLoading = false;
      this.errorMessage = '';
    }
  }
  
  // Material update methods
  updateMaterial(material: InboundMaterial): void {
    if (!this.canEditMaterials) return;
    
    // Allow updates even if material is received (since it's already in inventory)
    // But show a warning that the material is already in inventory
    if (material.isReceived) {
      console.log(`⚠️ Updating material ${material.materialCode} that is already in inventory`);
    }
    
    material.updatedAt = new Date();
    
    this.firestore.collection('inbound-materials').doc(material.id).update({
      batchNumber: material.batchNumber,
      materialCode: material.materialCode,
      poNumber: material.poNumber,
      quantity: material.quantity,
      unit: material.unit,
      location: material.location,
      type: material.type,
      expiryDate: material.expiryDate,
      qualityCheck: material.qualityCheck,
      isReceived: material.isReceived,
      notes: material.notes,
      rollsOrBags: material.rollsOrBags,
      supplier: material.supplier,
      remarks: material.remarks,
      isCompleted: material.isCompleted,
      updatedAt: material.updatedAt
    }).then(() => {
      console.log(`✅ Material ${material.materialCode} updated successfully`);
      if (material.isReceived) {
        console.log(`ℹ️ Note: ${material.materialCode} is already in inventory, changes here won't affect inventory data`);
      }
    }).catch((error) => {
      console.error(`❌ Error updating material ${material.materialCode}:`, error);
      this.errorMessage = `Lỗi cập nhật ${material.materialCode}: ${error.message}`;
    });
  }
  
  deleteMaterial(material: InboundMaterial): void {
    if (!this.canDeleteMaterials) return;
    
    // Allow deletion even if material is received (since it's already in inventory)
    // But show a warning that the material is already in inventory
    if (material.isReceived) {
      const confirmed = confirm(
        `⚠️ CẢNH BÁO: Material ${material.materialCode} đã được đưa vào Inventory!\n\n` +
        `Việc xóa ở đây sẽ:\n` +
        `• Xóa material khỏi tab Inbound\n` +
        `• KHÔNG ảnh hưởng đến dữ liệu trong Inventory\n` +
        `• Material vẫn tồn tại trong Inventory với trạng thái đã nhận\n\n` +
        `Bạn có chắc muốn xóa material này khỏi tab Inbound?`
      );
      
      if (!confirmed) return;
      
      console.log(`⚠️ Deleting material ${material.materialCode} that is already in inventory`);
    } else {
      if (!confirm(`Bạn có chắc muốn xóa material ${material.materialCode}?`)) {
        return;
      }
    }
    
    this.firestore.collection('inbound-materials').doc(material.id).delete()
      .then(() => {
        console.log(`✅ Material ${material.materialCode} deleted successfully from Inbound`);
        if (material.isReceived) {
          console.log(`ℹ️ Note: ${material.materialCode} remains in inventory with received status`);
        }
        this.loadMaterials(); // Reload the list
      }).catch((error) => {
        console.error(`❌ Error deleting material ${material.materialCode}:`, error);
        this.errorMessage = `Lỗi xóa ${material.materialCode}: ${error.message}`;
      });
  }
  
  // Delete all materials from inbound tab
  deleteAllMaterials(): void {
    if (!this.canDeleteMaterials) {
      this.errorMessage = 'Bạn không có quyền xóa materials';
      return;
    }
    
    const totalCount = this.materials.length;
    if (totalCount === 0) {
      alert('Không có dữ liệu nào để xóa');
      return;
    }
    
    // Check if there are materials already in inventory
    const materialsInInventory = this.materials.filter(m => m.isReceived);
    const materialsNotInInventory = this.materials.filter(m => !m.isReceived);
    
    let warningMessage = `⚠️ CẢNH BÁO: Bạn có chắc chắn muốn xóa TẤT CẢ ${totalCount} materials trong tab Inbound ASM1?\n\n`;
    
    if (materialsInInventory.length > 0) {
      const materialCodes = materialsInInventory.map(m => m.materialCode).join(', ');
      warningMessage += `📦 ${materialsInInventory.length} materials đã trong Inventory: ${materialCodes}\n`;
      warningMessage += `• Việc xóa ở đây sẽ KHÔNG ảnh hưởng đến dữ liệu trong Inventory\n`;
      warningMessage += `• Materials vẫn tồn tại trong Inventory với trạng thái đã nhận\n\n`;
    }
    
    if (materialsNotInInventory.length > 0) {
      warningMessage += `📋 ${materialsNotInInventory.length} materials chưa trong Inventory\n`;
      warningMessage += `• Sẽ bị xóa hoàn toàn khỏi hệ thống\n\n`;
    }
    
    warningMessage += `Hành động này sẽ xóa:\n`;
    warningMessage += `• Tất cả materials đã hoàn thành\n`;
    warningMessage += `• Tất cả materials chưa hoàn thành\n`;
    warningMessage += `• Không thể hoàn tác!\n\n`;
    warningMessage += `Nhập "DELETE" để xác nhận:`;
    
    const confirmed = confirm(warningMessage);
    
    if (!confirmed) return;
    
    // Show loading state
    this.isLoading = true;
    this.errorMessage = '';
    
    // Get all material IDs
    const materialIds = this.materials.map(m => m.id).filter(id => id);
    
    if (materialIds.length === 0) {
      this.isLoading = false;
      alert('Không có materials nào để xóa');
      return;
    }
    
    // Delete all materials in batches
    const batchSize = 500; // Firestore batch limit
    const batches = [];
    
    for (let i = 0; i < materialIds.length; i += batchSize) {
      const batch = this.firestore.firestore.batch();
      const batchIds = materialIds.slice(i, i + batchSize);
      
      batchIds.forEach(id => {
        const docRef = this.firestore.collection('inbound-materials').doc(id).ref;
        batch.delete(docRef);
      });
      
      batches.push(batch);
    }
    
    // Execute all batches
    const deletePromises = batches.map(batch => batch.commit());
    
    Promise.all(deletePromises)
      .then(() => {
        console.log(`✅ Successfully deleted ${materialIds.length} materials from Inbound ASM1`);
        if (materialsInInventory.length > 0) {
          console.log(`ℹ️ Note: ${materialsInInventory.length} materials remain in inventory with received status`);
        }
        
        this.materials = [];
        this.filteredMaterials = [];
        this.isLoading = false;
        
        // Show success message
        let successMessage = `✅ Đã xóa thành công ${materialIds.length} materials từ tab Inbound ASM1`;
        if (materialsInInventory.length > 0) {
          successMessage += `\n\n📦 ${materialsInInventory.length} materials đã trong Inventory vẫn tồn tại và không bị ảnh hưởng`;
        }
        alert(successMessage);
        
        // Close dropdown
        this.showDropdown = false;
        
        // Reload materials to refresh the view
        this.loadMaterials();
      })
      .catch((error) => {
        console.error('❌ Error deleting all materials:', error);
        this.errorMessage = `Lỗi xóa tất cả materials: ${error.message}`;
        this.isLoading = false;
        
        alert(`❌ Lỗi xóa materials: ${error.message}`);
      });
  }
  
  async printQRCode(material: InboundMaterial): Promise<void> {
    if (!this.canGenerateQR) {
      alert('Bạn không có quyền tạo QR code');
      return;
    }

    if (!material.rollsOrBags || material.rollsOrBags <= 0) {
      alert('Vui lòng nhập lượng đơn vị trước khi tạo QR code!');
      return;
    }

    try {
      // Calculate quantity per roll/bag
      const rollsOrBags = parseFloat(material.rollsOrBags.toString()) || 1;
      const totalQuantity = material.quantity;
      
      // Calculate how many full units we can make
      const fullUnits = Math.floor(totalQuantity / rollsOrBags);
      const remainingQuantity = totalQuantity % rollsOrBags;
      
      // Generate QR codes based on quantity per unit
      const qrCodes = [];
      
      // Add full units
      for (let i = 0; i < fullUnits; i++) {
        qrCodes.push({
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          unitNumber: rollsOrBags,
          qrData: `${material.materialCode}|${material.poNumber}|${rollsOrBags}`
        });
      }
      
      // Add remaining quantity if any
      if (remainingQuantity > 0) {
        qrCodes.push({
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          unitNumber: remainingQuantity,
          qrData: `${material.materialCode}|${material.poNumber}|${remainingQuantity}`
        });
      }

      if (qrCodes.length === 0) {
        alert('Vui lòng nhập số đơn vị trước khi tạo QR code!');
        return;
      }

      // Get current user info
      const user = await this.afAuth.currentUser;
      const currentUser = user ? user.email || user.uid : 'UNKNOWN';
      const printDate = new Date().toLocaleDateString('vi-VN');
      const totalPages = qrCodes.length;
      
      // Generate QR code images
      const qrImages = await Promise.all(
        qrCodes.map(async (qr, index) => {
          const qrData = qr.qrData;
          const qrImage = await QRCode.toDataURL(qrData, {
            width: 240, // 30mm = 240px (8px/mm)
            margin: 1,
            color: {
              dark: '#000000',
              light: '#FFFFFF'
            }
          });
          return {
            ...qr,
            qrImage,
            index: index + 1,
            pageNumber: index + 1,
            totalPages: totalPages,
            printDate: printDate,
            printedBy: currentUser
          };
        })
      );

      // Create print window with real QR codes
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        newWindow.document.write(`
          <html>
            <head>
              <title></title>
              <style>
                * {
                  margin: 0 !important;
                  padding: 0 !important;
                  box-sizing: border-box !important;
                }
                
                body { 
                  font-family: Arial, sans-serif; 
                  margin: 0 !important; 
                  padding: 0 !important;
                  background: white !important;
                  overflow: hidden !important;
                  width: 57mm !important;
                  height: 32mm !important;
                }
                
                .qr-container { 
                  display: flex !important; 
                  margin: 0 !important; 
                  padding: 0 !important; 
                  border: 1px solid #000 !important; 
                  width: 57mm !important; 
                  height: 32mm !important; 
                  page-break-inside: avoid !important;
                  background: white !important;
                  box-sizing: border-box !important;
                }
                
                .qr-section {
                  width: 30mm !important;
                  height: 30mm !important;
                  display: flex !important;
                  align-items: center !important;
                  justify-content: center !important;
                  border-right: 1px solid #ccc !important;
                  box-sizing: border-box !important;
                }
                
                .qr-image {
                  width: 28mm !important;
                  height: 28mm !important;
                  display: block !important;
                }
                
                .info-section {
                  flex: 1 !important;
                  padding: 1mm !important;
                  display: flex !important;
                  flex-direction: column !important;
                  justify-content: space-between !important;
                  font-size: 8px !important;
                  line-height: 1.1 !important;
                  box-sizing: border-box !important;
                }
                
                .info-row {
                  margin: 0.3mm 0 !important;
                  font-weight: bold !important;
                }
                
                .info-row.small {
                  font-size: 7px !important;
                  color: #666 !important;
                }
                
                .qr-grid {
                  text-align: center !important;
                  display: flex !important;
                  flex-direction: row !important;
                  flex-wrap: wrap !important;
                  align-items: flex-start !important;
                  justify-content: flex-start !important;
                  gap: 0 !important;
                  padding: 0 !important;
                  margin: 0 !important;
                  width: 57mm !important;
                  height: 32mm !important;
                }
                
                @media print {
                  body { 
                    margin: 0 !important; 
                    padding: 0 !important;
                    overflow: hidden !important;
                    width: 57mm !important;
                    height: 32mm !important;
                  }
                  
                  @page {
                    margin: 0 !important;
                    size: 57mm 32mm !important;
                    padding: 0 !important;
                  }
                  
                  .qr-container { 
                    margin: 0 !important; 
                    padding: 0 !important; 
                    width: 57mm !important; 
                    height: 32mm !important; 
                    page-break-inside: avoid !important;
                    border: 1px solid #000 !important;
                  }
                  
                  .qr-section {
                    width: 30mm !important;
                    height: 30mm !important;
                  }
                  
                  .qr-image {
                    width: 28mm !important;
                    height: 28mm !important;
                  }
                  
                  .info-section {
                    font-size: 8px !important;
                    padding: 1mm !important;
                  }
                  
                  .info-row.small {
                    font-size: 7px !important;
                  }
                  
                  .qr-grid {
                    gap: 0 !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    width: 57mm !important;
                    height: 32mm !important;
                  }
                  
                  /* Hide all browser elements */
                  @media screen {
                    body::before,
                    body::after,
                    header,
                    footer,
                    nav,
                    .browser-ui {
                      display: none !important;
                    }
                  }
                </style>
              </head>
              <body>
                <div class="qr-grid">
                  ${qrImages.map(qr => `
                    <div class="qr-container">
                      <div class="qr-section">
                        <img src="${qr.qrImage}" class="qr-image" alt="QR Code ${qr.index}">
                      </div>
                      <div class="info-section">
                        <div>
                          <div class="info-row">Mã: ${qr.materialCode}</div>
                          <div class="info-row">PO: ${qr.poNumber}</div>
                          <div class="info-row">Số ĐV: ${qr.unitNumber}</div>
                        </div>
                        <div>
                          <div class="info-row small">Ngày in: ${qr.printDate}</div>
                          <div class="info-row small">NV: ${qr.printedBy}</div>
                          <div class="info-row small">Trang: ${qr.pageNumber}/${qr.totalPages}</div>
                        </div>
                      </div>
                    </div>
                  `).join('')}
                </div>
                <script>
                  window.onload = function() {
                    // Remove all browser UI elements
                    document.title = '';
                    
                    // Hide browser elements
                    const style = document.createElement('style');
                    style.textContent = '@media print { body { margin: 0 !important; padding: 0 !important; width: 57mm !important; height: 32mm !important; } @page { margin: 0 !important; size: 57mm 32mm !important; padding: 0 !important; } body::before, body::after, header, footer, nav, .browser-ui { display: none !important; } }';
                    document.head.appendChild(style);
                    
                    // Remove any browser elements
                    const elementsToRemove = document.querySelectorAll('header, footer, nav, .browser-ui');
                    elementsToRemove.forEach(el => el.remove());
                    
                    setTimeout(() => {
                      window.print();
                    }, 500);
                  }
                </script>
              </body>
            </html>
          `);
        newWindow.document.close();
      }
    } catch (error) {
      console.error('Error generating QR codes:', error);
      alert('Có lỗi khi tạo QR codes. Vui lòng thử lại.');
    }
  }
  
  // Additional functionality methods
  importFromExcel(): void {
    // Trigger file input for Excel import
    this.importFile();
  }
  
  addMaterial(): void {
    if (!this.canAddMaterials) {
      alert('❌ Bạn không có quyền thêm material mới');
      return;
    }
    
    // Create a new empty material
    const newMaterial: InboundMaterial = {
      factory: 'ASM1',
      importDate: new Date(),
      batchNumber: '',
      materialCode: '',
      poNumber: '',
      quantity: 0,
      unit: '',
      location: '',
      type: '',
      expiryDate: null,
      qualityCheck: false,
      isReceived: false,
      notes: '',
      rollsOrBags: 0,
      supplier: '',
      remarks: '',
      isCompleted: false,
      hasQRGenerated: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Add to Firebase
    this.firestore.collection('inbound-materials').add(newMaterial)
      .then((docRef) => {
        newMaterial.id = docRef.id;
        console.log(`✅ New ASM1 material added with ID: ${docRef.id}`);
        
        // Add to local array and refresh
        this.materials.unshift(newMaterial);
        this.applyFilters();
        
        alert('✅ Material mới đã được thêm thành công!');
      })
      .catch((error) => {
        console.error('❌ Error adding new material:', error);
        this.errorMessage = 'Lỗi thêm material mới: ' + error.message;
        alert('❌ Lỗi thêm material mới: ' + error.message);
      });
  }
  
  // Export functionality
  exportToExcel(): void {
    if (!this.canExportData) return;
    
    try {
      console.log('📊 Exporting ASM1 inbound data to Excel...');
      
      // Optimize data for smaller file size
      const exportData = this.filteredMaterials.map(material => ({
        'Factory': material.factory || 'ASM1',
        'Date': material.importDate.toLocaleDateString('vi-VN', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit'
        }),
        'Batch': material.batchNumber || '',
        'Material': material.materialCode || '',
        'PO': material.poNumber || '',
        'Qty': material.quantity || 0,
        'Unit': material.unit || '',
        'Location': material.location || '',
        'Type': material.type || '',
        'Expiry': material.expiryDate?.toLocaleDateString('vi-VN', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit'
        }) || '',
        'QC': material.qualityCheck ? 'Yes' : 'No',
        'Received': material.isReceived ? 'Yes' : 'No',
        'Completed': material.isCompleted ? 'Yes' : 'No',
        'QR': material.hasQRGenerated ? 'Yes' : 'No'
      }));
      
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      
      // Set column widths for better readability
      const colWidths = [
        { wch: 8 },   // Factory
        { wch: 10 },  // Date
        { wch: 12 },  // Batch
        { wch: 15 },  // Material
        { wch: 12 },  // PO
        { wch: 8 },   // Qty
        { wch: 6 },   // Unit
        { wch: 12 },  // Location
        { wch: 8 },   // Type
        { wch: 10 },  // Expiry
        { wch: 6 },   // QC
        { wch: 8 },   // Received
        { wch: 8 },   // Completed
        { wch: 6 }    // QR
      ];
      worksheet['!cols'] = colWidths;
      
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'ASM1_Inbound');
      
      const fileName = `ASM1_Inbound_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      
      console.log('✅ ASM1 data exported to Excel');
      alert(`✅ Đã xuất ${exportData.length} records ra file Excel`);
      
    } catch (error) {
      console.error('❌ Export error:', error);
      this.errorMessage = 'Lỗi export: ' + error.message;
      alert('Lỗi export: ' + error.message);
    }
  }
  
  // Download Excel template for import
  downloadTemplate(): void {
    const templateData = [
      ['LÔ HÀNG/ DNNK', 'MÃ HÀNG', 'SỐ P.O', 'LƯỢNG NHẬP', 'LOẠI HÌNH', 'NHÀ CUNG CẤP'],
      ['RM1-B001', 'RM1-MAT001', 'RM1-PO001', 100, 'Raw Material', 'Supplier A'],
      ['RM1-B002', 'RM1-MAT002', 'RM1-PO002', 50, 'Raw Material', 'Supplier B']
    ];
    
    const worksheet = XLSX.utils.aoa_to_sheet(templateData);
    
    // Set column widths
    const colWidths = [
      { wch: 18 },  // LÔ HÀNG/ DNNK
      { wch: 15 },  // MÃ HÀNG
      { wch: 12 },  // SỐ P.O
      { wch: 15 },  // LƯỢNG NHẬP
      { wch: 15 },  // LOẠI HÌNH
      { wch: 20 }   // NHÀ CUNG CẤP
    ];
    worksheet['!cols'] = colWidths;
    
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Template');
    
    XLSX.writeFile(workbook, 'ASM1_Import_Template.xlsx');
  }

  // Download Inbound Report - Lịch sử kiểm lô hàng
  downloadInboundReport(): void {
    try {
      console.log('📊 Tạo report lịch sử kiểm lô hàng...');
      
      // Tạo dữ liệu report
      const reportData = this.generateInboundReportData();
      
      if (reportData.length === 0) {
        alert('Không có dữ liệu để tạo report!');
        return;
      }
      
      // Tạo worksheet
      const worksheet = XLSX.utils.aoa_to_sheet(reportData);
      
      // Set column widths
      const colWidths = [
        { wch: 20 },  // NGÀY KIỂM
        { wch: 18 },  // LÔ HÀNG/DNNK
        { wch: 15 },  // MÃ HÀNG
        { wch: 15 },  // MSNV
        { wch: 20 },  // THỜI GIAN BẮT ĐẦU
        { wch: 20 },  // THỜI GIAN KẾT THÚC
        { wch: 15 },  // THỜI GIAN HOÀN THÀNH (phút)
        { wch: 15 },  // TRẠNG THÁI
        { wch: 20 },  // NHÀ CUNG CẤP
        { wch: 15 },  // SỐ LƯỢNG
        { wch: 20 }   // GHI CHÚ
      ];
      worksheet['!cols'] = colWidths;
      
      // Tạo workbook
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Inbound_Report');
      
      // Tạo tên file với timestamp
      const timestamp = new Date().toISOString().split('T')[0];
      const fileName = `ASM1_Inbound_Report_${timestamp}.xlsx`;
      
      // Download file
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Inbound_Report');
      
      // Download file
      XLSX.writeFile(workbook, fileName);
      
      console.log('✅ Report đã được tải xuống:', fileName);
      alert(`Report đã được tải xuống: ${fileName}`);
      
    } catch (error: any) {
      console.error('❌ Lỗi tạo report:', error);
      this.errorMessage = 'Lỗi tạo report: ' + error.message;
      alert('Lỗi tạo report: ' + error.message);
    }
  }



  // Tạo dữ liệu cho report
  private generateInboundReportData(): (string | number)[][] {
    // Header của report
    const headers = [
      'NGÀY KIỂM',
      'LÔ HÀNG/DNNK', 
      'MÃ HÀNG',
      'MSNV',
      'THỜI GIAN BẮT ĐẦU',
      'THỜI GIAN KẾT THÚC',
      'THỜI GIAN HOÀN THÀNH (phút)',
      'TRẠNG THÁI',
      'NHÀ CUNG CẤP',
      'SỐ LƯỢNG',
      'GHI CHÚ'
    ];
    
    const reportData: (string | number)[][] = [headers];
    
    // Debug: Log số lượng materials
    console.log('🔍 Debug generateInboundReportData:');
    console.log('Tổng materials:', this.materials.length);
    console.log('Filtered materials:', this.filteredMaterials.length);
    
    // Lọc materials có thông tin batch
    const materialsWithBatch = this.materials.filter(material => 
      material.batchNumber && 
      material.batchNumber.trim() !== '' &&
      (material.batchStartTime || material.batchEndTime || material.employeeIds)
    );
    
    console.log('Materials có batch info:', materialsWithBatch.length);
    
    // Nếu không có materials với batch info, tạo report từ tất cả materials
    if (materialsWithBatch.length === 0) {
      console.log('⚠️ Không có materials với batch info, tạo report từ tất cả materials');
      
      this.materials.forEach(material => {
        const row = [
          this.formatDate(material.importDate),
          material.batchNumber || 'N/A',
          material.materialCode,
          material.employeeIds ? material.employeeIds.join(', ') : 'N/A',
          material.batchStartTime ? this.formatDateTime(material.batchStartTime) : 'N/A',
          material.batchEndTime ? this.formatDateTime(material.batchEndTime) : 'N/A',
          (material.batchStartTime && material.batchEndTime) ? 
            Math.round((material.batchEndTime.getTime() - material.batchStartTime.getTime()) / (1000 * 60)) + ' phút' : 'N/A',
          this.getStatusText(material),
          material.supplier || 'N/A',
          material.quantity || 0,
          material.remarks || 'N/A'
        ];
        
        reportData.push(row);
      });
    } else {
      // Nhóm materials theo batch
      const batchGroups = this.groupMaterialsByBatch(materialsWithBatch);
      
      // Tạo dữ liệu cho từng batch
      batchGroups.forEach(batchGroup => {
        const batchNumber = batchGroup.batchNumber;
        const batchMaterials = batchGroup.materials;
        const batchStartTime = batchGroup.batchStartTime;
        const batchEndTime = batchGroup.batchEndTime;
        const employeeIds = batchGroup.employeeIds;
        
        // Tính thời gian hoàn thành
        let duration = 0;
        if (batchStartTime && batchEndTime) {
          duration = Math.round((batchEndTime.getTime() - batchStartTime.getTime()) / (1000 * 60));
        }
        
        // Tạo dòng cho từng material trong batch
        batchMaterials.forEach(material => {
          const row = [
            this.formatDate(material.importDate),
            batchNumber,
            material.materialCode,
            employeeIds ? employeeIds.join(', ') : 'N/A',
            batchStartTime ? this.formatDateTime(batchStartTime) : 'N/A',
            batchEndTime ? this.formatDateTime(batchEndTime) : 'N/A',
            duration > 0 ? duration : 'N/A',
            this.getStatusText(material),
            material.supplier || 'N/A',
            material.quantity || 0,
            material.remarks || 'N/A'
          ];
          
          reportData.push(row);
        });
      });
    }
    
    console.log('📊 Dữ liệu report được tạo:', reportData.length - 1, 'dòng');
    return reportData;
  }

  // Nhóm materials theo batch
  private groupMaterialsByBatch(materials: InboundMaterial[]): any[] {
    const batchGroups: { [key: string]: any } = {};
    
    materials.forEach(material => {
      const batchKey = material.batchNumber;
      
      if (!batchGroups[batchKey]) {
        batchGroups[batchKey] = {
          batchNumber: batchKey,
          materials: [],
          batchStartTime: material.batchStartTime,
          batchEndTime: material.batchEndTime,
          employeeIds: material.employeeIds
        };
      }
      
      batchGroups[batchKey].materials.push(material);
      
      // Cập nhật thời gian batch nếu có
      if (material.batchStartTime && (!batchGroups[batchKey].batchStartTime || 
          material.batchStartTime < batchGroups[batchKey].batchStartTime)) {
        batchGroups[batchKey].batchStartTime = material.batchStartTime;
      }
      
      if (material.batchEndTime && (!batchGroups[batchKey].batchEndTime || 
          material.batchEndTime > batchGroups[batchKey].batchEndTime)) {
        batchGroups[batchKey].batchEndTime = material.batchEndTime;
      }
      
      // Cập nhật employee IDs
      if (material.employeeIds && material.employeeIds.length > 0) {
        if (!batchGroups[batchKey].employeeIds) {
          batchGroups[batchKey].employeeIds = [];
        }
        material.employeeIds.forEach(id => {
          if (!batchGroups[batchKey].employeeIds.includes(id)) {
            batchGroups[batchKey].employeeIds.push(id);
          }
        });
      }
    });
    
    return Object.values(batchGroups);
  }
  
  // Utility methods
  formatDate(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleDateString('vi-VN');
  }
  
  formatDateTime(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleString('vi-VN');
  }
  
  getStatusBadgeClass(material: InboundMaterial): string {
    if (material.isCompleted) return 'badge-success';
    if (material.isReceived && material.qualityCheck) return 'badge-info';
    if (material.isReceived) return 'badge-warning';
    return 'badge-secondary';
  }
  
  getStatusText(material: InboundMaterial): string {
    if (material.isCompleted) return 'Hoàn thành';
    if (material.isReceived && material.qualityCheck) return 'Đã kiểm tra';
    if (material.isReceived) return 'Đã nhận';
    return 'Chờ nhận';
  }
  
  // Physical Scanner methods (copy from outbound)
  activatePhysicalScanner(): void {
    console.log('🔌 Activating physical scanner input...');
    this.isScannerInputActive = !this.isScannerInputActive;
    
    if (this.isScannerInputActive) {
      this.scannerBuffer = '';
      this.focusEmployeeScanner();
      console.log('✅ Physical scanner activated - Ready to receive input');
    } else {
      console.log('⏹️ Physical scanner deactivated');
    }
  }
  
  // Batch processing methods
  canStartBatch(): boolean {
    const canStart = this.currentEmployeeIds.length > 0 && this.currentBatchNumber.trim() !== '';
    console.log('🔍 Kiểm tra canStartBatch:', {
      employeeCount: this.currentEmployeeIds.length,
      batchNumber: this.currentBatchNumber,
      batchNumberTrimmed: this.currentBatchNumber.trim(),
      canStart: canStart
    });
    return canStart;
  }
  
  startBatchProcessing(): void {
    console.log('🚀 Gọi startBatchProcessing()');
    console.log('📊 Kiểm tra điều kiện:', {
      currentEmployeeIds: this.currentEmployeeIds,
      currentBatchNumber: this.currentBatchNumber,
      canStartBatch: this.canStartBatch()
    });
    
    if (!this.canStartBatch()) {
      console.log('❌ Không thể bắt đầu batch - điều kiện không đủ');
      return;
    }
    
    this.isBatchActive = true;
    this.batchStartTime = new Date();
    this.showBatchModal = false;
    
    // Update all materials in the current batch
    this.updateBatchMaterials();
    
    console.log(`🚀 Bắt đầu kiểm lô hàng: ${this.currentBatchNumber} với ${this.currentEmployeeIds.length} nhân viên`);
    console.log('✅ Batch đã được kích hoạt:', {
      isBatchActive: this.isBatchActive,
      batchStartTime: this.batchStartTime,
      showBatchModal: this.showBatchModal
    });
  }
  
  stopBatchProcessing(): void {
    if (!this.isBatchActive) return;
    
    this.isBatchActive = false;
    this.batchStartTime = null;
    this.currentBatchNumber = '';
    this.currentEmployeeIds = [];
    
    console.log('⏹️ Dừng kiểm lô hàng');
  }
  
  private updateBatchMaterials(): void {
    const batchMaterials = this.materials.filter(m => m.batchNumber === this.currentBatchNumber);
    
    batchMaterials.forEach(material => {
      material.batchStatus = 'active';
      material.batchStartTime = this.batchStartTime;
      material.employeeIds = [...this.currentEmployeeIds];
      
      // Update in Firebase
      this.firestore.collection('inbound-materials').doc(material.id).update({
        batchStatus: 'active',
        batchStartTime: this.batchStartTime,
        employeeIds: this.currentEmployeeIds
      });
    });
  }
  
  onEmployeeScannerKeydown(event: KeyboardEvent): void {
    const input = event.target as HTMLInputElement;
    
    // Record scan start time on first character
    if (input.value.length === 0) {
      this.scanStartTime = Date.now();
    }
    
    // Clear existing timeout
    if (this.scannerTimeout) {
      clearTimeout(this.scannerTimeout);
    }
    
    // Handle Enter key (most scanners send Enter after scanning)
    if (event.key === 'Enter') {
      event.preventDefault();
      this.processEmployeeScannerInput(input.value);
      return;
    }
    
    // Set timeout to auto-process if no more input (for scanners without Enter)
    this.scannerTimeout = setTimeout(() => {
      if (input.value.trim().length > 5) { // Minimum barcode length
        const scanDuration = Date.now() - this.scanStartTime;
        // If input was typed very fast (< 500ms), likely from scanner
        if (scanDuration < 500) {
          this.processEmployeeScannerInput(input.value);
        }
      }
    }, 300);
  }
  
  private processEmployeeScannerInput(scannedData: string): void {
    if (!scannedData.trim()) return;
    
    console.log('🔌 Physical scanner input received:', scannedData);
    console.log('🔌 Input length:', scannedData.length);
    console.log('🔌 Input characters:', scannedData.split('').map(c => c.charCodeAt(0)));
    
    // Clear the input
    this.scannedEmployeeId = '';
    const inputElement = document.querySelector('.scanner-input') as HTMLInputElement;
    if (inputElement) {
      inputElement.value = '';
    }
    
    // Process the scanned employee ID
    this.addEmployee(scannedData);
    
    // Auto-focus for next scan
    setTimeout(() => {
      this.focusEmployeeScanner();
    }, 100);
  }
  
  addEmployee(employeeId: string): void {
    // Extract first 7 characters
    const shortId = employeeId.substring(0, 7);
    
    if (!this.currentEmployeeIds.includes(shortId)) {
      this.currentEmployeeIds.push(shortId);
      console.log(`✅ Thêm nhân viên: ${shortId}`);
      console.log('📊 Danh sách nhân viên hiện tại:', this.currentEmployeeIds);
    } else {
      console.log(`⚠️ Nhân viên ${shortId} đã tồn tại`);
    }
  }
  
  removeEmployee(employeeId: string): void {
    const index = this.currentEmployeeIds.indexOf(employeeId);
    if (index > -1) {
      this.currentEmployeeIds.splice(index, 1);
      console.log(`❌ Xóa nhân viên: ${employeeId}`);
    }
  }
  
  focusEmployeeScanner(): void {
    // Focus on employee scanner input
    setTimeout(() => {
      const input = document.querySelector('.scanner-input') as HTMLInputElement;
      if (input) {
        input.focus();
        input.select(); // Select all text for easy replacement
        console.log('🎯 Focus vào ô input scanner - sẵn sàng quét mã nhân viên');
      }
    }, 100);
  }
  
  closeBatchModal(): void {
    this.showBatchModal = false;
    this.isBatchScanningMode = false; // Reset the new input interface
    console.log('🔒 Modal đã đóng');
  }
  
  openBatchModal(): void {
    this.showBatchModal = true;
    this.isBatchScanningMode = true; // Enable the new input interface
    console.log('🚀 Mở modal batch processing với giao diện input trực tiếp');
    console.log('📊 Trạng thái hiện tại:', {
      isBatchActive: this.isBatchActive,
      currentEmployeeIds: this.currentEmployeeIds,
      currentBatchNumber: this.currentBatchNumber,
      showBatchModal: this.showBatchModal,
      isBatchScanningMode: this.isBatchScanningMode
    });
  }
  
  canEditInBatch(material: InboundMaterial): boolean {
    if (!this.isBatchActive) return false;
    return material.batchNumber === this.currentBatchNumber;
  }
  
  getEmployeeDisplay(material: InboundMaterial): string {
    if (material.employeeIds && material.employeeIds.length > 0) {
      // Show first employee in UI, but log all
      return material.employeeIds[0];
    }
    return '';
  }
  
  getTimeDisplay(material: InboundMaterial): string {
    if (material.batchStartTime && material.batchEndTime) {
      const duration = Math.round((material.batchEndTime.getTime() - material.batchStartTime.getTime()) / (1000 * 60));
      return `${duration} phút`;
    }
    return '';
  }
  
  getBatchDuration(): number {
    if (!this.batchStartTime) return 0;
    const now = new Date();
    return Math.round((now.getTime() - this.batchStartTime.getTime()) / (1000 * 60));
  }
  
  getCompleteButtonTitle(material: InboundMaterial): string {
    if (material.isCompleted) return 'Đã hoàn thành';
    if (!this.canEditInBatch(material)) return 'Chỉ có thể sửa trong lô hàng đang kiểm';
    return 'Đánh dấu hoàn thành';
  }
  
  getQualityCheckTitle(material: InboundMaterial): string {
    if (material.isReceived) return 'Không thể sửa - đã trong Inventory';
    if (!this.canEditInBatch(material)) return 'Chỉ có thể sửa trong lô hàng đang kiểm';
    return 'Kiểm tra chất lượng';
  }
  
  getReceivedTitle(material: InboundMaterial): string {
    if (material.isReceived) return 'Đã nhận - không thể thay đổi';
    if (!this.canEditInBatch(material)) return 'Chỉ có thể sửa trong lô hàng đang kiểm';
    return 'Đánh dấu đã nhận';
  }
  
  // Override onReceivedChange to handle batch completion
  onReceivedChange(event: any, material: InboundMaterial): void {
    const target = event.target as HTMLInputElement;
    const isReceived = target.checked;
    
    // Only allow ticking (true), not unticking (false)
    if (!isReceived) {
      console.log(`Cannot untick received status for ${material.materialCode}`);
      return;
    }
    
    console.log(`🔄 Đang tick "đã nhận" cho ${material.materialCode} trong lô hàng ${material.batchNumber}`);
    
    // Update local state first
    material.isReceived = isReceived;
    material.updatedAt = new Date();
    
    // Save to Firebase first to ensure persistence
    this.firestore.collection('inbound-materials').doc(material.id).update({
      isReceived: isReceived,
      updatedAt: material.updatedAt
    }).then(() => {
      console.log(`✅ Received status saved to Firebase for ${material.materialCode}`);
      
      // Now add to Inventory
      this.addToInventory(material);
      
      // Check batch completion only if we're in an active batch and this material belongs to it
      if (this.isBatchActive && material.batchNumber === this.currentBatchNumber) {
        console.log(`🔍 Kiểm tra hoàn thành lô hàng sau khi tick ${material.materialCode}`);
        this.checkBatchCompletion();
      } else {
        console.log(`ℹ️ Không kiểm tra hoàn thành lô hàng - không trong batch active hoặc material không thuộc lô hàng hiện tại`);
      }
      
    }).catch((error) => {
      console.error(`❌ Error saving received status to Firebase:`, error);
      // Revert local state if Firebase update failed
      material.isReceived = false;
      target.checked = false;
      alert(`Lỗi khi cập nhật trạng thái: ${error.message}`);
    });
  }
  
  private checkBatchCompletion(): void {
    // Lấy tất cả materials của lô hàng hiện tại (không chỉ những có batchStatus = 'active')
    const batchMaterials = this.materials.filter(m => m.batchNumber === this.currentBatchNumber);
    
    console.log(`🔍 Kiểm tra hoàn thành lô hàng ${this.currentBatchNumber}:`);
    console.log(`📦 Tổng materials trong lô: ${batchMaterials.length}`);
    console.log(`✅ Materials đã nhận: ${batchMaterials.filter(m => m.isReceived).length}`);
    
    // Chỉ hoàn thành khi TẤT CẢ materials trong lô hàng đã được tick "đã nhận"
    const allReceived = batchMaterials.every(m => m.isReceived);
    
    if (allReceived && batchMaterials.length > 0) {
      // Complete the batch
      const endTime = new Date();
      const duration = Math.round((endTime.getTime() - this.batchStartTime!.getTime()) / (1000 * 60));
      
      batchMaterials.forEach(material => {
        material.batchStatus = 'completed';
        material.batchEndTime = endTime;
        material.batchDuration = duration;
        
        // Update in Firebase
        this.firestore.collection('inbound-materials').doc(material.id).update({
          batchStatus: 'completed',
          batchEndTime: endTime,
          batchDuration: duration
        });
      });
      
      console.log(`🎉 Hoàn thành lô hàng ${this.currentBatchNumber} trong ${duration} phút`);
      alert(`🎉 Hoàn thành lô hàng ${this.currentBatchNumber} trong ${duration} phút!\n\n📊 Thống kê:\n📦 Tổng materials: ${batchMaterials.length}\n✅ Đã nhận: ${batchMaterials.length}\n⏱️ Thời gian: ${duration} phút`);
      
      // Reset batch state
      this.stopBatchProcessing();
    } else {
      console.log(`⏳ Lô hàng ${this.currentBatchNumber} chưa hoàn thành: ${batchMaterials.filter(m => m.isReceived).length}/${batchMaterials.length}`);
    }
  }
  
  // Scanner Mode Methods
  startScannerMode(): void {
    console.log('🔍 Starting scanner mode...');
    this.isScannerInputActive = true;
    this.isCameraModeActive = false;
    this.scannerBuffer = '';
    this.focusScannerInput();
  }
  
  stopScannerMode(): void {
    console.log('🛑 Stopping scanner mode...');
    this.isScannerInputActive = false;
    this.scannerBuffer = '';
    if (this.scannerTimeout) {
      clearTimeout(this.scannerTimeout);
      this.scannerTimeout = null;
    }
  }
  
  onScannerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.processScannedData(this.scannerBuffer);
      this.scannerBuffer = '';
    }
  }
  
  onScannerInputBlur(): void {
    // Keep scanner active for a short time to allow for rapid scanning
    this.scannerTimeout = setTimeout(() => {
      if (this.scannerBuffer.trim()) {
        this.processScannedData(this.scannerBuffer);
        this.scannerBuffer = '';
      }
    }, 100);
  }
  
  private processScannedData(scannedData: string): void {
    if (!scannedData.trim()) return;
    
    console.log('🔍 Processing scanned data:', scannedData);
    
    // Process the scanned data based on format
    // This can be material code, batch number, or other identifiers
    if (scannedData.startsWith('KZLSX')) {
      // Production order format
      this.currentBatchNumber = scannedData;
      console.log('✅ Production order scanned:', scannedData);
    } else if (scannedData.startsWith('ASP')) {
      // Employee ID format
      if (!this.currentEmployeeIds.includes(scannedData)) {
        this.currentEmployeeIds.push(scannedData);
        console.log('✅ Employee ID scanned:', scannedData);
      }
    } else {
      // Material code or other format
      console.log('📦 Material code scanned:', scannedData);
      // You can add logic here to auto-fill material fields
    }
  }
  
  private focusScannerInput(): void {
    setTimeout(() => {
      const scannerInput = document.querySelector('.scanner-input-field') as HTMLInputElement;
      if (scannerInput) {
        scannerInput.focus();
      }
    }, 100);
  }
  
  // Camera Mode Methods
  startCameraMode(): void {
    console.log('📱 Starting camera mode...');
    this.isCameraModeActive = true;
    this.isScannerInputActive = false;
    this.initializeCameraScanner();
  }
  
  stopCameraMode(): void {
    console.log('🛑 Stopping camera mode...');
    this.isCameraModeActive = false;
    if (this.cameraScanner) {
      this.cameraScanner.stop();
      this.cameraScanner = null;
    }
  }
  
  private async initializeCameraScanner(): Promise<void> {
    try {
      // Import HTML5 QR Scanner dynamically
      const { Html5Qrcode } = await import('html5-qrcode');
      
      this.cameraScanner = new Html5Qrcode("qr-reader");
      
      const cameras = await Html5Qrcode.getCameras();
      if (cameras && cameras.length > 0) {
        await this.cameraScanner.start(
          { deviceId: cameras[0].id },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 }
          },
          (decodedText: string) => {
            this.onCameraScanSuccess(decodedText);
          },
          (errorMessage: string) => {
            // Ignore errors during scanning
          }
        );
        console.log('✅ Camera scanner started successfully');
      } else {
        throw new Error('No cameras found');
      }
    } catch (error) {
      console.error('❌ Error starting camera scanner:', error);
      alert('Không thể khởi động camera. Vui lòng kiểm tra quyền truy cập camera.');
      this.stopCameraMode();
    }
  }
  
  private onCameraScanSuccess(decodedText: string): void {
    console.log('📱 Camera scan success:', decodedText);
    this.processScannedData(decodedText);
    
    // Stop camera after successful scan
    this.stopCameraMode();
  }

  // Lưu mã nhân viên
  saveEmployeeCode(): void {
    if (this.employeeCode && this.employeeCode.trim()) {
      this.isEmployeeCodeSaved = true;
      console.log('✅ Mã nhân viên đã được lưu:', this.employeeCode);
      console.log('🔄 Bắt đầu load danh sách lô hàng...');
      this.loadAvailableBatches(); // Load danh sách lô hàng
    } else {
      console.log('❌ Mã nhân viên không hợp lệ:', this.employeeCode);
    }
  }

  // Load danh sách lô hàng/DNNK chưa nhận
  private async loadAvailableBatches(): Promise<void> {
    try {
      console.log('📦 Loading available batches...');
      console.log('🔍 Factory filter:', this.selectedFactory);
      
      // Query để lấy tất cả lô hàng chờ nhận
      const snapshot = await this.firestore.collection('inbound-materials', ref => 
        ref.where('factory', '==', this.selectedFactory)
           .where('isReceived', '==', false)
           .limit(1000) // Tăng limit để lấy nhiều hơn
      ).get().toPromise();

      console.log('📊 Raw snapshot:', snapshot);
      console.log('📊 Snapshot empty?', snapshot?.empty);

      if (snapshot && !snapshot.empty) {
        // Lấy tất cả lô hàng chờ nhận
        this.availableBatches = snapshot.docs.map(doc => {
          const data = doc.data() as any;
          return {
            id: doc.id,
            batchNumber: data.batchNumber || '',
            supplier: data.supplier || '',
            materialCode: data.materialCode || '',
            importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : new Date()
          };
        }).sort((a, b) => b.importDate.getTime() - a.importDate.getTime()); // Sắp xếp theo ngày mới nhất
        
        console.log(`✅ Loaded ${this.availableBatches.length} available batches:`, this.availableBatches);
      } else {
        console.log('⚠️ No available batches found');
        this.availableBatches = [];
        
        // Thử load tất cả documents để debug
        console.log('🔍 Trying to load all documents for debugging...');
        const allSnapshot = await this.firestore.collection('inbound-materials').get().toPromise();
        if (allSnapshot && !allSnapshot.empty) {
          console.log(`📊 Total documents in collection: ${allSnapshot.docs.length}`);
          allSnapshot.docs.slice(0, 3).forEach((doc, index) => {
            const data = doc.data() as any;
            console.log(`📄 Sample doc ${index + 1}:`, {
              id: doc.id,
              factory: data.factory,
              isReceived: data.isReceived,
              batchNumber: data.batchNumber,
              supplier: data.supplier
            });
          });
        }
      }
    } catch (error) {
      console.error('❌ Error loading available batches:', error);
      this.availableBatches = [];
    }
  }

  // Xử lý khi chọn lô hàng
  onBatchSelectionChange(): void {
    console.log('🔄 Batch selection changed:', this.selectedBatch);
    console.log('📊 Available batches:', this.availableBatches);
    
    if (this.selectedBatch) {
      const selectedBatchData = this.availableBatches.find(batch => batch.id === this.selectedBatch);
      if (selectedBatchData) {
        console.log('✅ Selected batch:', selectedBatchData);
      } else {
        console.log('❌ Selected batch not found in available batches');
      }
    } else {
      console.log('ℹ️ No batch selected');
    }
  }

  // Bắt đầu kiểm tra
  startInspection(): void {
    if (this.employeeCode && this.selectedBatch) {
      console.log('🚀 Starting inspection with:', {
        employeeCode: this.employeeCode,
        batchId: this.selectedBatch
      });
      
      // TODO: Implement inspection logic here
      // Có thể mở modal kiểm tra hoặc chuyển sang chế độ kiểm tra
      
      alert(`Bắt đầu kiểm tra!\nMã nhân viên: ${this.employeeCode}\nLô hàng: ${this.selectedBatch}`);
    }
  }

  // Reset khi dừng
  stopBatchScanningMode(): void {
    this.isBatchScanningMode = false;
    this.employeeCode = '';
    this.selectedBatch = '';
    this.isEmployeeCodeSaved = false;
    this.availableBatches = [];
    console.log('🛑 Stopped batch scanning mode');
  }

  // Test method để debug
  testLoadBatches(): void {
    console.log('🧪 Testing batch loading...');
    this.loadAvailableBatches();
  }

  // Tự động viết hoa mã nhân viên
  onEmployeeCodeInput(event: any): void {
    const input = event.target;
    const value = input.value;
    if (value) {
      // Tự động viết hoa và cập nhật ngModel
      this.employeeCode = value.toUpperCase();
      // Cập nhật input value để hiển thị ngay lập tức
      input.value = this.employeeCode;
    }
  }

  onEmployeeCodeKeyup(event: any): void {
    const input = event.target;
    const value = input.value;
    if (value) {
      // Đảm bảo viết hoa khi nhập xong
      this.employeeCode = value.toUpperCase();
      input.value = this.employeeCode;
    }
  }
}