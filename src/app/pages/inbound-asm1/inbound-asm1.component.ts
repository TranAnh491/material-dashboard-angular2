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
  searchType: string = 'all';
  
  // Factory filter - Fixed to ASM1
  selectedFactory: string = 'ASM1';
  availableFactories: string[] = ['ASM1'];
  
  // Time range filter
  startDate: string = '';
  endDate: string = '';
  
  // Status filter
  statusFilter: string = '';
  
  // Pagination
  currentPage: number = 1;
  itemsPerPage: number = 50;
  totalPages: number = 1;
  
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
    const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    this.startDate = lastWeek.toISOString().split('T')[0];
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
          console.log(`📦 Processing doc ${doc.payload.doc.id}, factory: ${data.factory}`);
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
    const alternativeCollections = ['inbound-materials', 'materials', 'inbound-asm1', 'materials-inventory'];
    
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
    
    // Always maintain sort order by import date (oldest first) and creation time
    filtered.sort((a, b) => {
      // Sort by import date first (oldest first)
      const dateCompare = a.importDate.getTime() - b.importDate.getTime();
      if (dateCompare !== 0) return dateCompare;
      
      // If same date, sort by creation time (import order)
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    
    this.filteredMaterials = filtered;
    this.updatePagination();
    
    console.log(`🔍 ASM1 filtered: ${filtered.length}/${this.materials.length} materials`);
  }
  
  updatePagination(): void {
    this.totalPages = Math.ceil(this.filteredMaterials.length / this.itemsPerPage);
    if (this.currentPage > this.totalPages) {
      this.currentPage = 1;
    }
  }
  
  getPaginatedMaterials(): InboundMaterial[] {
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    return this.filteredMaterials.slice(startIndex, endIndex);
  }
  
  onSearchChange(): void {
    this.currentPage = 1;
    this.applyFilters();
  }
  
  onDateFilterChange(): void {
    this.currentPage = 1;
    this.applyFilters();
  }
  
  onExpiryDateChange(event: any, material: any): void {
    const target = event.target as HTMLInputElement;
    material.expiryDate = target.value ? new Date(target.value) : null;
    this.updateMaterial(material);
  }
  
  onReceivedChange(event: any, material: InboundMaterial): void {
    const target = event.target as HTMLInputElement;
    const isReceived = target.checked;
    
    // Only allow ticking (true), not unticking (false)
    if (!isReceived) {
      console.log(`Cannot untick received status for ${material.materialCode}`);
      return;
    }
    
    material.isReceived = isReceived;
    material.updatedAt = new Date();
    console.log(`Updated received status for ${material.materialCode}: ${isReceived}`);
    
    // Save to Firebase
    this.updateMaterial(material);
    
    // Auto-add to Inventory when marked as received
    this.addToInventory(material);
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
    
    // Add to inventory-materials collection
    this.firestore.collection('inventory-materials').add(inventoryMaterial)
      .then(() => {
        console.log(`✅ ${material.materialCode} added to Inventory ASM1`);
        // Show success message
        alert(`✅ Material ${material.materialCode} đã được chuyển vào Inventory ASM1!`);
      })
      .catch((error) => {
        console.error('❌ Error adding to inventory:', error);
        alert(`❌ Lỗi khi chuyển ${material.materialCode} vào Inventory: ${error.message}`);
        // Revert the checkbox if failed
        material.isReceived = false;
        this.updateMaterial(material);
      });
  }
  
  onStatusFilterChange(): void {
    this.currentPage = 1;
    this.applyFilters();
  }
  
  onSearchTypeChange(): void {
    this.currentPage = 1;
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
    this.searchType = 'all';
    this.startDate = '';
    this.endDate = '';
    this.statusFilter = '';
    this.currentPage = 1;
    this.setupDateDefaults();
    this.applyFilters();
  }
  
  // Navigation methods
  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
    }
  }
  
  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }
  
  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }
  
  // File handling methods
  onFileSelect(event: any): void {
    const file = event.target.files[0];
    if (file) {
      this.selectedFile = file;
      console.log('📁 ASM1 file selected:', file.name);
    }
  }
  
  async importFromExcel(): Promise<void> {
    if (!this.selectedFile) {
      this.errorMessage = 'Vui lòng chọn file Excel';
      return;
    }
    
    this.isLoading = true;
    this.errorMessage = '';
    
    try {
      console.log('📊 Importing ASM1 data from Excel...');
      
      const data = await this.readExcelFile(this.selectedFile);
      const materials = this.parseExcelData(data);
      
      if (materials.length === 0) {
        throw new Error('Không có dữ liệu hợp lệ trong file Excel');
      }
      
      // Save to Firestore with ASM1 factory
      let successCount = 0;
      let errorCount = 0;
      
      for (const material of materials) {
        try {
          material.factory = 'ASM1'; // Force ASM1
          material.createdAt = new Date();
          material.updatedAt = new Date();
          
          await this.firestore.collection('inbound-materials').add(material);
          successCount++;
        } catch (error) {
          console.error('❌ Error saving material:', error);
          errorCount++;
        }
      }
      
      console.log(`✅ ASM1 import completed: ${successCount} success, ${errorCount} errors`);
      alert(`Import hoàn thành!\n✅ Thành công: ${successCount}\n❌ Lỗi: ${errorCount}`);
      
      this.selectedFile = null;
      this.loadMaterials();
      
    } catch (error) {
      console.error('❌ ASM1 import error:', error);
      this.errorMessage = 'Lỗi import: ' + error.message;
    } finally {
      this.isLoading = false;
    }
  }
  
  private readExcelFile(file: File): Promise<any[]> {
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
      
      reader.onerror = () => reject(new Error('Lỗi đọc file'));
      reader.readAsArrayBuffer(file);
    });
  }
  
  private parseExcelData(data: any[]): InboundMaterial[] {
    return data.map((row, index) => {
      try {
        return {
          factory: 'ASM1',
          importDate: this.parseDate(row['Import Date'] || row['Ngày nhập'] || new Date()),
          batchNumber: String(row['Batch Number'] || row['Số lô'] || ''),
          materialCode: String(row['Material Code'] || row['Mã hàng'] || ''),
          poNumber: String(row['PO Number'] || row['Số PO'] || ''),
          quantity: Number(row['Quantity'] || row['Số lượng'] || 0),
          unit: String(row['Unit'] || row['Đơn vị'] || ''),
          location: String(row['Location'] || row['Vị trí'] || ''),
          type: String(row['Type'] || row['Loại'] || ''),
          expiryDate: this.parseDate(row['Expiry Date'] || row['Hạn sử dụng']),
          qualityCheck: Boolean(row['Quality Check'] || row['Kiểm tra chất lượng'] || false),
          isReceived: Boolean(row['Is Received'] || row['Đã nhận'] || false),
          notes: String(row['Notes'] || row['Ghi chú'] || ''),
          rollsOrBags: Number(row['Rolls/Bags'] || row['Cuộn/Túi'] || 0),
          supplier: String(row['Supplier'] || row['Nhà cung cấp'] || ''),
          remarks: String(row['Remarks'] || row['Nhận xét'] || ''),
          isCompleted: Boolean(row['Is Completed'] || row['Hoàn thành'] || false),
          hasQRGenerated: false
        } as InboundMaterial;
      } catch (error) {
        console.warn(`⚠️ Error parsing row ${index + 1}:`, error);
        return null;
      }
    }).filter(material => material !== null) as InboundMaterial[];
  }
  
  private parseDate(dateValue: any): Date | null {
    if (!dateValue) return null;
    
    if (dateValue instanceof Date) return dateValue;
    
    if (typeof dateValue === 'string') {
      const parsed = new Date(dateValue);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    
    if (typeof dateValue === 'number') {
      // Excel date serial number
      const excelEpoch = new Date(1900, 0, 1);
      const days = dateValue - 2; // Excel date adjustment
      return new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000);
    }
    
    return null;
  }
  
  // CRUD operations
  async addMaterial(): Promise<void> {
    if (!this.canAddMaterials) return;
    
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
    
    try {
      await this.firestore.collection('inbound-materials').add(newMaterial);
      console.log('✅ ASM1 material added');
      this.loadMaterials();
    } catch (error) {
      console.error('❌ Error adding ASM1 material:', error);
      this.errorMessage = 'Lỗi thêm material: ' + error.message;
    }
  }
  
  async updateMaterial(material: InboundMaterial): Promise<void> {
    if (!this.canEditMaterials || !material.id) return;
    
    try {
      material.updatedAt = new Date();
      material.factory = 'ASM1'; // Ensure ASM1
      
      await this.firestore.collection('inbound-materials').doc(material.id).update(material);
      console.log('✅ ASM1 material updated:', material.materialCode);
    } catch (error) {
      console.error('❌ Error updating ASM1 material:', error);
      this.errorMessage = 'Lỗi cập nhật: ' + error.message;
    }
  }
  
  async deleteMaterial(material: InboundMaterial): Promise<void> {
    if (!this.canDeleteMaterials || !material.id) return;
    
    if (!confirm(`Xóa material ${material.materialCode}?`)) return;
    
    try {
      await this.firestore.collection('inbound-materials').doc(material.id).delete();
      console.log('✅ ASM1 material deleted:', material.materialCode);
      this.loadMaterials();
    } catch (error) {
      console.error('❌ Error deleting ASM1 material:', error);
      this.errorMessage = 'Lỗi xóa: ' + error.message;
    }
  }
  
  // QR Code generation
  async generateQRCode(material: InboundMaterial): Promise<void> {
    if (!this.canGenerateQR) return;
    
    // Validate required fields
    if (!material.rollsOrBags || material.rollsOrBags <= 0) {
      alert('Vui lòng nhập số đơn vị trước khi tạo QR code!');
      return;
    }
    
    try {
      console.log('🏷️ Generating QR codes for ASM1 material:', material.materialCode);
      
      // Calculate quantities - FIXED LOGIC
      const totalQuantity = material.quantity; // Lượng nhập (ví dụ: 6740)
      const quantityPerUnit = material.rollsOrBags; // Số đơn vị (ví dụ: 100)
      
      // Calculate full labels and remainder
      const fullLabels = Math.floor(totalQuantity / quantityPerUnit); // 67 tem đầy đủ
      const remainderQuantity = totalQuantity % quantityPerUnit; // 40 còn lại
      const totalLabels = fullLabels + (remainderQuantity > 0 ? 1 : 0); // 67 + 1 = 68 tem
      
      console.log(`📊 Label calculation:`, {
        totalQuantity, // 6740
        quantityPerUnit, // 100
        fullLabels, // 67
        remainderQuantity, // 40
        totalLabels // 68
      });
      
      if (totalLabels === 0) {
        alert('Số lượng không đủ để tạo tem QR!');
        return;
      }
      
      // Generate QR codes
      const qrCodes = [];
      
      // Generate full labels (67 tem × 100)
      for (let i = 0; i < fullLabels; i++) {
        const qrDataString = `${material.materialCode}|${material.poNumber}|${quantityPerUnit}`;
        
        const qrCodeDataURL = await QRCode.toDataURL(qrDataString, {
          width: 240,
          margin: 1,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        });
        
        qrCodes.push({
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          unitNumber: quantityPerUnit,
          qrData: qrDataString,
          qrImage: qrCodeDataURL,
          index: i + 1,
          pageNumber: i + 1,
          totalPages: totalLabels
        });
      }
      
      // Generate remainder label if exists (1 tem × 40)
      if (remainderQuantity > 0) {
        const qrDataString = `${material.materialCode}|${material.poNumber}|${remainderQuantity}`;
        
        const qrCodeDataURL = await QRCode.toDataURL(qrDataString, {
          width: 240,
          margin: 1,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        });
        
        qrCodes.push({
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          unitNumber: remainderQuantity,
          qrData: qrDataString,
          qrImage: qrCodeDataURL,
          index: fullLabels + 1,
          pageNumber: fullLabels + 1,
          totalPages: totalLabels
        });
      }
      
      // Create print window with all labels (copy inventory format)
      await this.createQRPrintWindow(material, qrCodes);
      
      // Mark as QR generated
      if (material.id) {
        await this.firestore.collection('inbound-materials').doc(material.id).update({
          hasQRGenerated: true,
          updatedAt: new Date()
        });
      }
      
      console.log(`✅ Generated ${qrCodes.length} QR code labels for ASM1 material`);
      
    } catch (error) {
      console.error('❌ Error generating QR code:', error);
      alert('Lỗi tạo QR code: ' + error.message);
    }
  }
  
  private async createQRPrintWindow(material: InboundMaterial, qrCodes: any[]): Promise<void> {
    // Get current user info from auth
    const user = await this.afAuth.currentUser;
    const currentUser = user ? (user.email || user.uid) : 'UNKNOWN';
    const printDate = new Date().toLocaleDateString('vi-VN');
    
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Không thể mở cửa sổ in. Vui lòng cho phép popup!');
      return;
    }
    
    // Copy exact format from inventory
    printWindow.document.write(`
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
            }
          </style>
        </head>
        <body>
          <div class="qr-grid">
            ${qrCodes.map(qr => `
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
                    <div class="info-row small">Ngày in: ${printDate}</div>
                    <div class="info-row small">NV: ${currentUser}</div>
                    <div class="info-row small">Trang: ${qr.pageNumber}/${qr.totalPages}</div>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
          <script>
            window.onload = function() {
              setTimeout(() => {
                window.print();
                window.onafterprint = function() {
                  window.close();
                };
              }, 1000);
            };
          </script>
        </body>
      </html>
    `);
    
    printWindow.document.close();
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
}
