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
  selector: 'app-inbound-materials',
  templateUrl: './inbound-materials.component.html',
  styleUrls: ['./inbound-materials.component.scss']
})
export class InboundMaterialsComponent implements OnInit, OnDestroy {
  materials: InboundMaterial[] = [];
  filteredMaterials: InboundMaterial[] = [];
  
  // Search and filter
  searchTerm: string = '';
  
  // Factory filter
  selectedFactory: string = '';
  availableFactories: string[] = ['ASM1', 'ASM2'];
  
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
    private factoryAccessService: FactoryAccessService
  ) {}

  ngOnInit(): void {
    // Comment out mock data loading - user can import real data instead
    // this.loadMockData();
    // Enable Firebase loading to sync with imported data
    this.loadMaterialsFromFirebase();
    // Set default date range to include all data
    this.startDate = new Date(2020, 0, 1);
    this.endDate = new Date(2030, 11, 31);
    this.applyFilters();
    this.loadPermissions();
    
    // Load factory access and set default factory
    this.loadFactoryAccess();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadMockData(): void {
    // Mock data for demonstration
    this.materials = [
      {
        factory: 'ASM1',
        importDate: new Date('2024-01-15'),
        batchNumber: 'BATCH001',
        materialCode: 'MAT001',
        poNumber: 'PO2024001',
        quantity: 100,
        unit: 'kg',
        location: 'A1',
        type: 'Raw Material',
        expiryDate: new Date('2025-01-15'),
        qualityCheck: true,
        isReceived: true,
        notes: 'All items received in good condition',
        rollsOrBags: 10,
        supplier: 'Supplier A',
        remarks: 'Standard delivery',
        isCompleted: true
      },
      {
        factory: 'ASM2',
        importDate: new Date('2024-01-16'),
        batchNumber: 'BATCH002',
        materialCode: 'MAT002',
        poNumber: 'PO2024002',
        quantity: 50,
        unit: 'pcs',
        location: 'B2',
        type: 'Component',
        expiryDate: new Date('2024-12-31'),
        qualityCheck: false,
        isReceived: false,
        notes: 'Missing 2 items',
        rollsOrBags: 25,
        supplier: 'Supplier B',
        remarks: 'Check quality before acceptance',
        isCompleted: false
      },
      {
        factory: 'ASM1',
        importDate: new Date('2024-01-17'),
        batchNumber: 'BATCH003',
        materialCode: 'MAT003',
        poNumber: 'PO2024003',
        quantity: 200,
        unit: 'm',
        location: 'C3',
        type: 'Fabric',
        expiryDate: new Date('2026-01-17'),
        qualityCheck: true,
        isReceived: true,
        notes: 'Quality check completed',
        rollsOrBags: 5,
        supplier: 'Supplier C',
        remarks: 'Premium quality material',
        isCompleted: true
      },
      {
        factory: 'ASM2',
        importDate: new Date('2024-01-18'),
        batchNumber: 'BATCH004',
        materialCode: 'MAT004',
        poNumber: 'PO2024004',
        quantity: 150,
        unit: 'm',
        location: 'D4',
        type: 'Fabric',
        expiryDate: new Date('2025-06-18'),
        qualityCheck: false,
        isReceived: false,
        notes: 'Pending quality inspection',
        rollsOrBags: 15,
        supplier: 'Supplier D',
        remarks: 'New supplier - need verification',
        isCompleted: false
      },
      {
        factory: 'ASM1',
        importDate: new Date('2024-01-19'),
        batchNumber: 'BATCH005',
        materialCode: 'MAT005',
        poNumber: 'PO2024005',
        quantity: 75,
        unit: 'pcs',
        location: 'E5',
        type: 'Component',
        expiryDate: new Date('2024-08-19'),
        qualityCheck: true,
        isReceived: true,
        notes: 'All items received and checked',
        rollsOrBags: 30,
        supplier: 'Supplier E',
        remarks: 'Standard delivery - good quality',
        isCompleted: true
      }
    ];
  }

  importFile(): void {
    console.log('Import file functionality');
    
    // Create file input element
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
    console.log('Processing Excel file:', file.name);
    
    try {
      // Read Excel file
      const data = await this.readExcelFile(file);
      console.log('Excel data:', data);
      
      // Parse data to InboundMaterial objects
      const materials = this.parseExcelData(data);
      console.log('Parsed materials:', materials);
      
      // Add to local materials array immediately for UI update
      this.materials = [...this.materials, ...materials];
      console.log('Updated local materials:', this.materials.length);
      
      // Apply filters to refresh UI
      this.applyFilters();
      
      // Save to Firebase (placeholder)
      await this.saveToFirebase(materials);
      
      // Save to Firebase
      this.saveMaterialsToFirebase(materials);
      
      console.log('Import completed:', {
        importedCount: materials.length,
        totalMaterials: this.materials.length,
        filteredMaterials: this.filteredMaterials.length
      });
      
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

  private parseExcelData(data: any[]): InboundMaterial[] {
    return data.map((row: any, index: number) => ({
      factory: row['Factory'] || 'ASM1', // Default to ASM1 if not specified
      importDate: this.parseDate(row['Ngày nhập']),
      batchNumber: row['Lô Hàng/ DNNK'] || '',
      materialCode: row['Mã hàng'] || '',
      poNumber: row['Số P.O'] || '',
      quantity: parseInt(row['Lượng Nhập']) || 0,
      unit: row['Đơn vị'] || '',
      location: row['Vị trí'] || '',
      type: row['Loại hình'] || '',
      expiryDate: this.parseDate(row['HSD']),
      qualityCheck: row['KK'] === 'Yes' || row['KK'] === true,
      isReceived: row['Đã nhận'] === 'Yes' || row['Đã nhận'] === true,
      notes: row['Ghi chú'] || '',
      rollsOrBags: row['Số cuộn/ bịch'] || '',
      supplier: row['Nhà cung cấp'] || '',
      remarks: row['Lưu ý'] || '',
      isCompleted: row['Trạng thái'] === 'Rồi',
      createdAt: new Date(),
      updatedAt: new Date()
    }));
  }

  private parseDate(dateStr: string): Date | null {
    if (!dateStr || dateStr.trim() === '') return null;
    
    // Handle DD/MM/YYYY format
    if (typeof dateStr === 'string' && dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      }
    }
    
    return new Date(dateStr);
  }

  private async saveToFirebase(materials: InboundMaterial[]): Promise<void> {
    console.log('Saving materials to Firebase:', materials.length);
    
    // TODO: Implement Firebase save
    // For now, just simulate saving
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('✅ Materials saved to Firebase');
  }

  downloadTemplate(): void {
    console.log('Download template');
    
    // Create template data with proper headers (including Factory)
    const templateData = [
      {
        'Factory': 'ASM1',
        'Ngày nhập': '15/01/2024',
        'Lô Hàng/ DNNK': 'BATCH001',
        'Mã hàng': 'MAT001',
        'Số P.O': 'PO2024001',
        'Lượng Nhập': 100,
        'Đơn vị': 'kg',
        'Vị trí': 'A1',
        'Loại hình': 'Raw Material',
        'HSD': '15/01/2025',
        'KK': 'Yes', // Changed to Yes/No for checkbox
        'Đã nhận': 'Yes',
        'Ghi chú': 'All items received in good condition',
        'Số cuộn/ bịch': '10 rolls',
        'Nhà cung cấp': 'Supplier A',
        'Lưu ý': 'Standard delivery - check quality before acceptance',
        'Trạng thái': 'Rồi'
      },
      {
        'Factory': 'ASM2',
        'Ngày nhập': '16/01/2024',
        'Lô Hàng/ DNNK': 'BATCH002',
        'Mã hàng': 'MAT002',
        'Số P.O': 'PO2024002',
        'Lượng Nhập': 50,
        'Đơn vị': 'pcs',
        'Vị trí': 'B2',
        'Loại hình': 'Component',
        'HSD': '', // Có thể để trống
        'KK': 'No', // Example of No
        'Đã nhận': 'No',
        'Ghi chú': 'Missing 2 items - need replacement',
        'Số cuộn/ bịch': '25 bags',
        'Nhà cung cấp': 'Supplier B',
        'Lưu ý': 'Check quality before acceptance - some items damaged',
        'Trạng thái': 'Chưa'
      },
      {
        'Factory': 'ASM1',
        'Ngày nhập': '17/01/2024',
        'Lô Hàng/ DNNK': 'BATCH003',
        'Mã hàng': 'MAT003',
        'Số P.O': 'PO2024003',
        'Lượng Nhập': 75,
        'Đơn vị': 'kg',
        'Vị trí': 'C3',
        'Loại hình': 'Raw Material',
        'HSD': '', // HSD để trống - không có hạn sử dụng
        'KK': 'Yes',
        'Đã nhận': 'No',
        'Ghi chú': 'Material không có HSD',
        'Số cuộn/ bịch': '15',
        'Nhà cung cấp': 'Supplier C',
        'Lưu ý': 'Material không có hạn sử dụng',
        'Trạng thái': 'Chưa'
      }
    ];

    // Create workbook and worksheet
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(templateData);

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Template');

    // Generate file and download
    XLSX.writeFile(wb, 'Inbound_Materials_Template.xlsx');
  }

  downloadReport(): void {
    console.log('Download report');
    
    // Create report data from current materials
    const reportData = this.materials.map(material => ({
      'Ngày nhập': this.formatDate(material.importDate),
      'Lô Hàng/ DNNK': material.batchNumber,
      'Mã hàng': material.materialCode,
      'Số P.O': material.poNumber,
      'Lượng Nhập': material.quantity,
      'Đơn vị': material.unit,
      'Vị trí': material.location,
      'Loại hình': material.type,
      'HSD': this.formatDate(material.expiryDate),
      'KK': material.qualityCheck,
      'Đã nhận': material.isReceived ? 'Yes' : 'No',
      'Ghi chú': material.notes,
      'Số cuộn/ bịch': material.rollsOrBags,
      'Nhà cung cấp': material.supplier,
      'Lưu ý': material.remarks,
      'Rồi/Chưa': material.isCompleted ? 'Rồi' : 'Chưa'
    }));

    // Create workbook and worksheet
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(reportData);

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, 'Inbound Materials Report');

    // Generate file and download
    XLSX.writeFile(wb, `Inbound_Materials_Report_${this.formatDate(new Date())}.xlsx`);
  }

  // Old updateReceivedStatus method - replaced by new one below

  // Old updateQualityCheck method - replaced by new one below

  editNotes(material: InboundMaterial): void {
    const newNotes = prompt('Nhập ghi chú:', material.notes || '');
    if (newNotes !== null) {
      material.notes = newNotes;
      material.updatedAt = new Date();
      console.log(`Updated notes for ${material.materialCode}: ${newNotes}`);
      
      // Save to Firebase
      this.updateMaterialInFirebase(material);
    }
  }

  editRemarks(material: InboundMaterial): void {
    const newRemarks = prompt('Nhập lưu ý:', material.remarks || '');
    if (newRemarks !== null) {
      material.remarks = newRemarks;
      material.updatedAt = new Date();
      console.log(`Updated remarks for ${material.materialCode}: ${newRemarks}`);
      
      // Save to Firebase
      this.updateMaterialInFirebase(material);
    }
  }

  // Search functionality (copied from inventory)
  onSearchChange(event: any): void {
    // Convert to uppercase for consistent search
    this.searchTerm = event.target.value.toUpperCase();
    // Update the input field to show uppercase
    event.target.value = this.searchTerm;
    this.applyFilters();
  }

  // Apply search filters (simplified like inventory)
  applyFilters(): void {
    this.filteredMaterials = this.materials.filter(material => {
      // Filter by search term
      if (this.searchTerm) {
        const searchableText = [
          material.materialCode,
          material.poNumber,
          material.batchNumber,
          material.location,
          material.supplier,
          material.quantity?.toString(),
          material.notes,
          material.remarks
        ].filter(Boolean).join(' ').toUpperCase();
        
        if (!searchableText.includes(this.searchTerm)) {
          return false;
        }
      }
      
      // Filter by factory
      if (this.selectedFactory) {
        const materialFactory = material.factory || 'ASM1'; // Default to ASM1 if not set
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
    
    console.log('Search results:', {
      searchTerm: this.searchTerm,
      totalMaterials: this.materials.length,
      filteredMaterials: this.filteredMaterials.length
    });
  }

  viewAllMaterials(): void {
    this.startDate = new Date(2020, 0, 1); // From 2020
    this.endDate = new Date(2030, 11, 31); // To 2030
    this.showCompleted = true;
    this.selectedFactory = ''; // Reset factory filter to show all
    this.applyFilters();
    this.showTimeRangeDialog = false;
    
    console.log('View all materials:', {
      totalMaterials: this.materials.length,
      filteredMaterials: this.filteredMaterials.length,
      materials: this.materials
    });
  }

  applyTimeRangeFilter(): void {
    this.applyFilters();
    this.showTimeRangeDialog = false;
  }

  // Old completeMaterial method - replaced by new one below

  // Old delete method - replaced by new one below

  // Debug method to force refresh display
  refreshDisplay(): void {
    console.log('Refreshing display...');
    console.log('Current materials:', this.materials);
    console.log('Current filtered materials:', this.filteredMaterials);
    this.applyFilters();
  }

  // Filter by ASM1
  filterByASM1(): void {
    console.log('Filtering by ASM1...');
    this.selectedFactory = 'ASM1';
    this.applyFilters();
  }

  // Filter by ASM2
  filterByASM2(): void {
    console.log('Filtering by ASM2...');
    this.selectedFactory = 'ASM2';
    this.applyFilters();
  }

  // Clear all data
  clearAllData(): void {
    if (confirm('⚠️ Bạn có chắc chắn muốn xóa tất cả dữ liệu? Hành động này không thể hoàn tác!')) {
      this.materials = [];
      this.filteredMaterials = [];
      console.log('All data cleared');
      alert('✅ Đã xóa tất cả dữ liệu thành công!');
    }
  }

  // Clear only mock data (keep Firebase/imported data)
  clearMockData(): void {
    const mockMaterialCodes = ['MAT001', 'MAT002', 'MAT003', 'MAT004', 'MAT005'];
    const beforeCount = this.materials.length;
    
    this.materials = this.materials.filter(material => 
      !mockMaterialCodes.includes(material.materialCode)
    );
    
    this.applyFilters();
    const removedCount = beforeCount - this.materials.length;
    
    if (removedCount > 0) {
      console.log(`Removed ${removedCount} mock materials`);
      alert(`✅ Đã xóa ${removedCount} mẫu dữ liệu thành công!`);
    } else {
      alert('ℹ️ Không tìm thấy dữ liệu mẫu để xóa.');
    }
  }

  // Load user permissions
  loadPermissions(): void {
    // TODO: Load from UserPermissionService
    // For now, set default permissions
    this.hasDeletePermission = true;
    this.hasCompletePermission = true;
  }

  // Load factory access permissions and set default factory
  private loadFactoryAccess(): void {
    this.factoryAccessService.getCurrentUserFactoryAccess()
      .pipe(takeUntil(this.destroy$))
      .subscribe((access) => {
        // Update available factories based on user permissions
        this.availableFactories = access.availableFactories;
        
        // Set default factory if user has access
        if (access.defaultFactory && access.availableFactories.includes(access.defaultFactory)) {
          this.selectedFactory = access.defaultFactory;
        } else if (access.availableFactories.length > 0) {
          this.selectedFactory = access.availableFactories[0];
        }
        
        console.log('🏭 Factory access loaded for Inbound Materials:', {
          selectedFactory: this.selectedFactory,
          availableFactories: this.availableFactories
        });
      });
  }

  // Kiểm tra user có thể chỉnh sửa material của nhà máy cụ thể không
  canEditMaterial(material: InboundMaterial): boolean {
    const materialFactory = material.factory || 'ASM1';
    return this.availableFactories.includes(materialFactory);
  }

  // Kiểm tra user có thể xem material của nhà máy cụ thể không
  canViewMaterial(material: InboundMaterial): boolean {
    const materialFactory = material.factory || 'ASM1';
    return this.availableFactories.includes(materialFactory);
  }

  // Load materials from Firebase
  loadMaterialsFromFirebase(): void {
    this.firestore.collection('inbound-materials')
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((actions) => {
        const firebaseMaterials = actions.map(action => {
          const data = action.payload.doc.data() as any;
          const id = action.payload.doc.id;
          return {
            id: id,
            ...data,
            importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : new Date(),
            expiryDate: data.expiryDate ? new Date(data.expiryDate.seconds * 1000) : null
          };
        });
        
        // Merge Firebase data with existing materials (don't replace mock data)
        if (firebaseMaterials.length > 0) {
          // Filter out duplicates based on materialCode and poNumber
          const existingKeys = new Set(this.materials.map(m => `${m.materialCode}-${m.poNumber}`));
          const newMaterials = firebaseMaterials.filter(fm => 
            !existingKeys.has(`${fm.materialCode}-${fm.poNumber}`)
          );
          
          this.materials = [...this.materials, ...newMaterials];
          console.log('Firebase data merged:', {
            existing: this.materials.length - newMaterials.length,
            new: newMaterials.length,
            total: this.materials.length
          });
        } else {
          console.log('No Firebase data, keeping existing materials');
        }
        
        this.applyFilters();
        console.log('Loaded materials from Firebase:', this.materials.length);
      });
  }

  // Update quality check (KK) - Updated version
  updateQualityCheck(material: InboundMaterial, checked: boolean): void {
    material.qualityCheck = checked;
    material.updatedAt = new Date();
    console.log(`Updated quality check for ${material.materialCode}: ${checked}`);
    
    // Save to Firebase
    this.updateMaterialInFirebase(material);
  }

  // Update received status (Đã nhận) - Only allow ticking, not unticking
  updateReceivedStatus(material: InboundMaterial, checked: boolean): void {
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
  private addToInventory(material: InboundMaterial): void {
    console.log(`Adding ${material.materialCode} to Inventory...`);
    
    // Create inventory material from inbound material
    const inventoryMaterial = {
      factory: material.factory || 'ASM1', // Include factory from inbound material
      importDate: material.importDate,
      receivedDate: new Date(), // Ngày nhập vào inventory (khi tick đã nhận)
      batchNumber: material.batchNumber,
      materialCode: material.materialCode,
      poNumber: material.poNumber,
      quantity: material.quantity,
      unit: material.unit,
      exported: 0, // Start with 0 exported
      stock: material.quantity, // Start with full stock
      location: material.location || '',
      type: material.type,
      expiryDate: material.expiryDate,
      qualityCheck: material.qualityCheck,
      isReceived: true,
      notes: material.notes || '',
      rollsOrBags: material.rollsOrBags?.toString() || '',
      supplier: material.supplier || '',
      remarks: material.remarks || '',
      isCompleted: false,
      isDuplicate: false, // Will be checked later
      source: 'inbound' as const, // Đánh dấu dòng này đến từ inbound
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Always add new entry to inventory (no merging)
    console.log(`Adding new material ${material.materialCode} to inventory with received date: ${inventoryMaterial.receivedDate}`);
    
    this.firestore.collection('inventory-materials').add(inventoryMaterial)
      .then((docRef) => {
        console.log(`Successfully added ${material.materialCode} to inventory with ID: ${docRef.id}`);
        
        // Check for duplicates after adding
        this.checkAndMarkDuplicates();
      })
      .catch(error => {
        console.error(`Error adding ${material.materialCode} to inventory:`, error);
      });
  }

  // Check and mark duplicates in inventory
  private checkAndMarkDuplicates(): void {
    this.firestore.collection('inventory-materials').get().toPromise().then(snapshot => {
      if (snapshot) {
        const materials = snapshot.docs.map(doc => {
          const data = doc.data() as any;
          return {
            id: doc.id,
            ...data
          };
        });
        
        // Group by materialCode + poNumber + quantity
        const groups = new Map<string, any[]>();
        
        materials.forEach(material => {
          const key = `${material.materialCode}|${material.poNumber}|${material.quantity}`;
          if (!groups.has(key)) {
            groups.set(key, []);
          }
          groups.get(key)!.push(material);
        });
        
        // Mark duplicates
        groups.forEach((group, key) => {
          if (group.length > 1) {
            console.log(`Found ${group.length} duplicates for key: ${key}`);
            
            // Mark all items in group as duplicates
            group.forEach(material => {
              this.firestore.collection('inventory-materials').doc(material.id).update({
                isDuplicate: true,
                updatedAt: new Date()
              }).then(() => {
                console.log(`Marked ${material.materialCode} as duplicate`);
              }).catch(error => {
                console.error(`Error marking ${material.materialCode} as duplicate:`, error);
              });
            });
          }
        });
      }
    }).catch(error => {
      console.error('Error checking duplicates:', error);
    });
  }

  // Edit location with uppercase
  editLocation(material: InboundMaterial): void {
    const newLocation = prompt('Nhập vị trí (sẽ tự động viết hoa):', material.location || '');
    if (newLocation !== null) {
      material.location = newLocation.toUpperCase();
      material.updatedAt = new Date();
      console.log(`Updated location for ${material.materialCode}: ${material.location}`);
      
      // Save to Firebase
      this.updateMaterialInFirebase(material);
    }
  }

  // Handle expiry date change event
  onExpiryDateChange(material: InboundMaterial, event: any): void {
    const selectedDate = event.target.value;
    console.log(`Date input changed for ${material.materialCode}: ${selectedDate}`);
    
    if (selectedDate) {
      material.expiryDate = new Date(selectedDate);
    } else {
      material.expiryDate = null;
    }
    
    this.updateExpiryDate(material);
  }

  // Update expiry date
  updateExpiryDate(material: InboundMaterial): void {
    material.updatedAt = new Date();
    console.log(`Updated expiry date for ${material.materialCode}: ${material.expiryDate}`);
    
    // Save to Firebase
    this.updateMaterialInFirebase(material);
  }

  // Save materials to Firebase
  saveMaterialsToFirebase(materials: InboundMaterial[]): void {
    materials.forEach(material => {
      const materialData = {
        ...material,
        importDate: material.importDate,
        expiryDate: material.expiryDate,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      // Remove id field before saving to Firebase
      delete materialData.id;
      
      this.firestore.collection('inbound-materials').add(materialData)
        .then((docRef) => {
          console.log('Material saved to Firebase successfully with ID:', docRef.id);
        })
        .catch(error => {
          console.error('Error saving material to Firebase:', error);
        });
    });
  }

  // Update material in Firebase
  updateMaterialInFirebase(material: InboundMaterial): void {
    if (material.id) {
      const updateData = {
        ...material,
        importDate: material.importDate,
        expiryDate: material.expiryDate,
        updatedAt: new Date()
      };
      
      // Remove id field before updating Firebase
      delete updateData.id;
      
      this.firestore.collection('inbound-materials').doc(material.id).update(updateData)
        .then(() => {
          console.log('Material updated in Firebase successfully');
        })
        .catch(error => {
          console.error('Error updating material in Firebase:', error);
        });
    }
  }

  // Delete material from Firebase
  deleteMaterialFromFirebase(materialId: string): void {
    this.firestore.collection('inbound-materials').doc(materialId).delete()
      .then(() => {
        console.log('Material deleted from Firebase successfully');
      }).catch(error => {
        console.error('Error deleting material from Firebase:', error);
      });
  }

  // Delete material (updated to use Firebase)
  deleteMaterial(material: InboundMaterial): void {
    if (confirm(`Xác nhận xóa material ${material.materialCode}?`)) {
      if (material.id) {
        this.deleteMaterialFromFirebase(material.id);
      }
      // Remove from local array immediately
      const index = this.materials.indexOf(material);
      if (index > -1) {
        this.materials.splice(index, 1);
        console.log(`Deleted material: ${material.materialCode}`);
        this.applyFilters();
      }
    }
  }

  // Complete material (updated to hide completed items)
  completeMaterial(material: InboundMaterial): void {
    if (confirm(`Xác nhận hoàn thành material ${material.materialCode}?`)) {
      material.isCompleted = true;
      material.updatedAt = new Date();
      console.log(`Completed material: ${material.materialCode}`);
      
      // Save to Firebase
      this.updateMaterialInFirebase(material);
      
      // Apply filters to hide completed items
      this.applyFilters();
    }
  }

  private formatDate(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  // Debug method to check Firebase data
  debugFirebaseData(): void {
    console.log('=== DEBUG FIREBASE DATA ===');
    console.log('Current materials array:', this.materials);
    console.log('Filtered materials:', this.filteredMaterials);
    console.log('Start date:', this.startDate);
    console.log('End date:', this.endDate);
    console.log('Show completed:', this.showCompleted);
    
    // Check Firebase directly
    this.firestore.collection('inbound-materials').get().subscribe(snapshot => {
      console.log('Raw Firebase data:', snapshot.docs.map(doc => ({
        id: doc.id,
        data: doc.data()
      })));
    });
  }

  // Calculate quantity per unit
  calculateQuantityPerUnit(material: InboundMaterial): number {
    if (!material.rollsOrBags || material.rollsOrBags <= 0) {
      return 0;
    }
    return Math.round((material.quantity / material.rollsOrBags) * 100) / 100;
  }

  // Get CSS class for batch number based on duplicate logic
  getBatchNumberClass(material: InboundMaterial, index: number): string {
    const batchNumber = material.batchNumber;
    
    // Find all materials with the same batch number
    const duplicateMaterials = this.filteredMaterials.filter(m => m.batchNumber === batchNumber);
    
    // If not duplicate, return default class
    if (duplicateMaterials.length === 1) {
      return '';
    }
    
    // Find the index of this material among duplicates
    const currentMaterialIndex = duplicateMaterials.findIndex(m => 
      m.materialCode === material.materialCode && 
      m.poNumber === material.poNumber && 
      m.importDate === material.importDate
    );
    
    // Check if this material and previous one in the list have the same batch number
    const previousMaterial = index > 0 ? this.filteredMaterials[index - 1] : null;
    const isPreviousSameBatch = previousMaterial && previousMaterial.batchNumber === batchNumber;
    
    // Logic for alternating colors when duplicates are adjacent
    if (isPreviousSameBatch) {
      // If previous is same batch, alternate color
      return 'batch-duplicate-blue'; // Only use blue for all duplicates
    } else {
      // First occurrence or not adjacent, use blue
      return 'batch-duplicate-blue';
    }
  }

  // Update rolls or bags
  updateRollsOrBags(material: InboundMaterial): void {
    console.log('Updating rolls/bags for material:', material.materialCode, 'to:', material.rollsOrBags);
    this.updateMaterialInFirebase(material);
  }

  // Update notes
  updateNotes(material: InboundMaterial): void {
    console.log('Updating notes for material:', material.materialCode, 'to:', material.notes);
    this.updateMaterialInFirebase(material);
  }

  // Update remarks
  updateRemarks(material: InboundMaterial): void {
    console.log('Updating remarks for material:', material.materialCode, 'to:', material.remarks);
    this.updateMaterialInFirebase(material);
  }

  // Generate QR Code
  generateQRCode(material: InboundMaterial): void {
    console.log('Generating QR code for material:', material.materialCode);
    
    // Get quantity per unit (Lượng Hàng)
    const quantityPerUnit = this.calculateQuantityPerUnit(material);
    
    if (quantityPerUnit <= 0) {
      alert('Vui lòng nhập số đơn vị trước khi tạo QR code!');
      return;
    }

    console.log('QR Code breakdown:');
    console.log('- Material code:', material.materialCode);
    console.log('- PO Number:', material.poNumber);
    console.log('- Quantity per unit:', quantityPerUnit);
    console.log('- Number of QR codes to generate:', quantityPerUnit);

    // Generate QR codes based on quantity per unit
    const qrCodes = [];
    const totalQuantity = material.quantity;
    const unitSize = material.rollsOrBags;
    
    // Calculate how many full units we can make
    const fullUnits = Math.floor(totalQuantity / unitSize);
    const remainingQuantity = totalQuantity % unitSize;
    
    console.log('QR Code calculation:');
    console.log('- Total quantity:', totalQuantity);
    console.log('- Unit size:', unitSize);
    console.log('- Full units:', fullUnits);
    console.log('- Remaining:', remainingQuantity);
    
    // Add full units
    for (let i = 0; i < fullUnits; i++) {
      qrCodes.push({
        materialCode: material.materialCode,
        poNumber: material.poNumber,
        unitNumber: unitSize,
        qrData: `${material.materialCode}|${material.poNumber}|${unitSize}`
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

    console.log('Generated QR codes:', qrCodes);
    
    // Mark material as having QR generated
    material.hasQRGenerated = true;
    this.updateMaterialInFirebase(material);
    
    // Show QR code dialog
    this.showQRCodeDialog(qrCodes, material);
  }

  // Show QR code dialog with real QR codes
  async showQRCodeDialog(qrCodes: any[], material: InboundMaterial): Promise<void> {
    try {
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
}
