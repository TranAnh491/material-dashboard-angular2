import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Router } from '@angular/router';

export interface InventoryMaterial {
  id?: string;
  factory?: string;
  importDate: Date;
  receivedDate?: Date;
  batchNumber: string;
  materialCode: string;
  materialName?: string;
  poNumber: string;
  openingStock: number | null;
  quantity: number;
  unit: string;
  exported?: number;
  xt?: number;
  stock?: number;
  location: string;
  type: string;
  expiryDate: Date;
  qualityCheck: boolean;
  isReceived: boolean;
  notes: string;
  rollsOrBags: string;
  supplier: string;
  remarks: string;
  iqcStatus?: string; // IQC Status: PASS, NG, ĐẶC CÁCH, CHỜ XÁC NHẬN
  createdAt?: Date;
  updatedAt?: Date;
}

@Component({
  selector: 'app-qc',
  templateUrl: './qc.component.html',
  styleUrls: ['./qc.component.scss']
})
export class QCComponent implements OnInit, OnDestroy {
  materials: InventoryMaterial[] = [];
  filteredMaterials: InventoryMaterial[] = [];
  isLoading: boolean = false;
  errorMessage: string = '';
  
  // Search and filter
  searchTerm: string = '';
  statusFilter: string = 'all'; // all, PASS, NG, ĐẶC CÁCH, CHỜ XÁC NHẬN
  
  // IQC Modal properties
  showIQCModal: boolean = false;
  iqcScanInput: string = '';
  scannedMaterial: InventoryMaterial | null = null;
  selectedIQCStatus: string = 'CHỜ XÁC NHẬN'; // PASS, NG, ĐẶC CÁCH, CHỜ XÁC NHẬN
  
  // Pending QC count
  pendingQCCount: number = 0;
  todayCheckedCount: number = 0;
  pendingConfirmCount: number = 0; // Chờ Xác Nhận
  
  // Employee verification
  showEmployeeModal: boolean = true; // Block access until employee scanned
  employeeScanInput: string = '';
  currentEmployeeId: string = '';
  currentEmployeeName: string = '';
  isEmployeeVerified: boolean = false;
  
  // Recent checked materials
  recentCheckedMaterials: any[] = [];
  isLoadingRecent: boolean = false;
  
  // More menu
  showMoreMenu: boolean = false;
  showReportModal: boolean = false;
  showTodayCheckedModal: boolean = false;
  showPendingQCModal: boolean = false;
  showDownloadModal: boolean = false;
  selectedMonth: string = '';
  selectedYear: string = '';
  qcReports: any[] = [];
  todayCheckedMaterials: any[] = [];
  pendingQCMaterials: any[] = [];
  isLoadingReport: boolean = false;
  
  private destroy$ = new Subject<void>();
  
  constructor(
    private firestore: AngularFirestore,
    private router: Router
  ) {}
  
  getYearOptions(): number[] {
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let i = currentYear; i >= currentYear - 5; i--) {
      years.push(i);
    }
    return years;
  }
  
  ngOnInit(): void {
    // Không cần load materials ban đầu, chỉ load khi scan
    console.log('📦 QC Component initialized - ready for scanning');
    
    // Close more menu when clicking outside
    document.addEventListener('click', (event: any) => {
      if (this.showMoreMenu && !event.target.closest('.more-button-wrapper')) {
        this.showMoreMenu = false;
      }
    });
    
    // 🔧 FIX: Khôi phục currentEmployeeId từ localStorage nếu có
    const savedEmployeeId = localStorage.getItem('qc_currentEmployeeId');
    const savedEmployeeName = localStorage.getItem('qc_currentEmployeeName');
    if (savedEmployeeId && savedEmployeeName) {
      this.currentEmployeeId = savedEmployeeId;
      this.currentEmployeeName = savedEmployeeName;
      this.isEmployeeVerified = true;
      this.showEmployeeModal = false;
      console.log('✅ Restored employee from localStorage:', savedEmployeeId, savedEmployeeName);
      
      // Load counts and recent materials after employee verified
      this.loadPendingQCCount();
      this.loadTodayCheckedCount();
      this.loadPendingConfirmCount();
      this.loadRecentCheckedMaterials();
    } else {
      // Block access until employee is verified
      this.showEmployeeModal = true;
    }
  }
  
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
  
  loadMaterials(): void {
    this.isLoading = true;
    this.errorMessage = '';
    
    console.log('📦 Loading ASM1 inventory materials for QC...');
    
    // Thử query với orderBy trước, nếu lỗi thì query không có orderBy
    try {
      this.firestore.collection('inventory-materials', ref => 
        ref.where('factory', '==', 'ASM1')
           .orderBy('importDate', 'desc')
           .limit(1000)
      ).snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (snapshot) => {
          console.log(`📦 Received ${snapshot.length} documents from Firestore`);
          this.materials = snapshot.map(doc => {
            const data = doc.payload.doc.data() as any;
            return {
              id: doc.payload.doc.id,
              factory: data.factory || 'ASM1',
              importDate: this.parseImportDate(data.importDate),
              receivedDate: data.receivedDate?.toDate() || undefined,
              batchNumber: data.batchNumber || '',
              materialCode: data.materialCode || '',
              materialName: data.materialName || '',
              poNumber: data.poNumber || '',
              openingStock: data.openingStock || null,
              quantity: data.quantity || 0,
              unit: data.unit || '',
              exported: data.exported || 0,
              xt: data.xt || 0,
              stock: data.stock || 0,
              location: data.location || '',
              type: data.type || '',
              expiryDate: data.expiryDate?.toDate() || new Date(),
              qualityCheck: data.qualityCheck || false,
              isReceived: data.isReceived || false,
              notes: data.notes || '',
              rollsOrBags: data.rollsOrBags || '',
              supplier: data.supplier || '',
              remarks: data.remarks || '',
              iqcStatus: data.iqcStatus || 'CHỜ KIỂM',
              createdAt: data.createdAt?.toDate() || new Date(),
              updatedAt: data.updatedAt?.toDate() || new Date()
            } as InventoryMaterial;
          });
          
          console.log(`✅ Loaded ${this.materials.length} materials`);
          this.applyFilters();
          this.isLoading = false;
        },
        error: (error) => {
          console.error('❌ Error loading materials with orderBy:', error);
          // Thử query không có orderBy
          console.log('⚠️ Retrying without orderBy...');
          this.loadMaterialsWithoutOrderBy();
        }
      });
    } catch (error) {
      console.error('❌ Error setting up Firestore query:', error);
      this.loadMaterialsWithoutOrderBy();
    }
  }
  
  loadMaterialsWithoutOrderBy(): void {
    this.firestore.collection('inventory-materials', ref => 
      ref.where('factory', '==', 'ASM1')
         .limit(1000)
    ).snapshotChanges()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        console.log(`📦 Received ${snapshot.length} documents from Firestore (no orderBy)`);
        this.materials = snapshot.map(doc => {
          const data = doc.payload.doc.data() as any;
          return {
            id: doc.payload.doc.id,
            factory: data.factory || 'ASM1',
            importDate: this.parseImportDate(data.importDate),
            receivedDate: data.receivedDate?.toDate() || undefined,
            batchNumber: data.batchNumber || '',
            materialCode: data.materialCode || '',
            materialName: data.materialName || '',
            poNumber: data.poNumber || '',
            openingStock: data.openingStock || null,
            quantity: data.quantity || 0,
            unit: data.unit || '',
            exported: data.exported || 0,
            xt: data.xt || 0,
            stock: data.stock || 0,
            location: data.location || '',
            type: data.type || '',
            expiryDate: data.expiryDate?.toDate() || new Date(),
            qualityCheck: data.qualityCheck || false,
            isReceived: data.isReceived || false,
            notes: data.notes || '',
            rollsOrBags: data.rollsOrBags || '',
            supplier: data.supplier || '',
            remarks: data.remarks || '',
            iqcStatus: data.iqcStatus || 'CHỜ XÁC NHẬN',
            createdAt: data.createdAt?.toDate() || new Date(),
            updatedAt: data.updatedAt?.toDate() || new Date()
          } as InventoryMaterial;
        });
        
        // Sort manually by importDate
        this.materials.sort((a, b) => {
          const dateA = a.importDate?.getTime() || 0;
          const dateB = b.importDate?.getTime() || 0;
          return dateB - dateA; // Descending order
        });
        
        console.log(`✅ Loaded ${this.materials.length} materials (sorted manually)`);
        this.applyFilters();
        this.isLoading = false;
      },
      error: (error) => {
        console.error('❌ Error loading materials without orderBy:', error);
        this.errorMessage = `Lỗi khi tải dữ liệu: ${error.message || error}`;
        this.isLoading = false;
      }
    });
  }
  
  // Parse importDate from various formats
  private parseImportDate(importDate: any): Date {
    if (!importDate) {
      return new Date();
    }
    
    // If it's already a Date object
    if (importDate instanceof Date) {
      return importDate;
    }
    
    // If it's a Firestore Timestamp
    if (importDate.seconds) {
      return new Date(importDate.seconds * 1000);
    }
    
    // If it's a string in format "26082025" (DDMMYYYY)
    if (typeof importDate === 'string' && /^\d{8}$/.test(importDate)) {
      const day = importDate.substring(0, 2);
      const month = importDate.substring(2, 4);
      const year = importDate.substring(4, 8);
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }
    
    // If it's a string in format "DD/MM/YYYY" or "DD-MM-YYYY"
    if (typeof importDate === 'string' && (importDate.includes('/') || importDate.includes('-'))) {
      const parts = importDate.split(/[\/\-]/);
      if (parts.length === 3) {
        const day = parts[0];
        const month = parts[1];
        const year = parts[2];
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      }
    }
    
    // If it's a string that can be parsed as Date
    if (typeof importDate === 'string') {
      const parsed = new Date(importDate);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    
    // If it's a number (timestamp)
    if (typeof importDate === 'number') {
      return new Date(importDate);
    }
    
    // Fallback to current date
    console.warn('⚠️ Could not parse importDate:', importDate, 'using current date');
    return new Date();
  }
  
  // Get display IMD (importDate + sequence if any)
  getDisplayIMD(material: InventoryMaterial): string {
    if (!material.importDate) return 'N/A';
    
    const baseDate = material.importDate.toLocaleDateString('en-GB').split('/').join('');
    
    // Kiểm tra nếu batchNumber có format đúng (chỉ chứa số và có độ dài hợp lý)
    if (material.batchNumber && material.batchNumber !== baseDate) {
      // Chỉ xử lý nếu batchNumber bắt đầu bằng baseDate và chỉ có thêm số sequence
      if (material.batchNumber.startsWith(baseDate)) {
        const suffix = material.batchNumber.substring(baseDate.length);
        // Chỉ chấp nhận suffix nếu nó chỉ chứa số và có độ dài <= 2
        if (/^\d{1,2}$/.test(suffix)) {
          return baseDate + suffix;
        }
      }
    }
    
    return baseDate;
  }
  
  applyFilters(): void {
    let filtered = [...this.materials];
    
    // Search filter
    if (this.searchTerm.trim()) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(m => 
        m.materialCode.toLowerCase().includes(term) ||
        m.poNumber.toLowerCase().includes(term) ||
        m.batchNumber.toLowerCase().includes(term)
      );
    }
    
    // Status filter
    if (this.statusFilter !== 'all') {
      filtered = filtered.filter(m => m.iqcStatus === this.statusFilter);
    }
    
    this.filteredMaterials = filtered;
  }
  
  onSearchInput(): void {
    this.applyFilters();
  }
  
  changeStatusFilter(status: string): void {
    this.statusFilter = status;
    this.applyFilters();
  }
  
  // IQC Modal functions
  openIQCModal(): void {
    // 🔧 FIX: Kiểm tra currentEmployeeId khi mở modal
    if (!this.currentEmployeeId || this.currentEmployeeId.trim() === '') {
      // Khôi phục từ localStorage nếu có
      const savedEmployeeId = localStorage.getItem('qc_currentEmployeeId');
      const savedEmployeeName = localStorage.getItem('qc_currentEmployeeName');
      if (savedEmployeeId && savedEmployeeName) {
        this.currentEmployeeId = savedEmployeeId;
        this.currentEmployeeName = savedEmployeeName;
        this.isEmployeeVerified = true;
        console.log('✅ Restored employee from localStorage when opening IQC modal');
      } else {
        alert('⚠️ Vui lòng xác thực nhân viên trước khi kiểm!');
        this.showEmployeeModal = true;
        return;
      }
    }
    
    this.showIQCModal = true;
    this.iqcScanInput = '';
    this.scannedMaterial = null;
    this.selectedIQCStatus = 'CHỜ XÁC NHẬN'; // 🔧 FIX: Set default status
    
    // Auto-focus scan input after modal opens
    setTimeout(() => {
      const input = document.getElementById('iqc-scan-input');
      if (input) {
        input.focus();
      }
    }, 100);
  }
  
  closeIQCModal(): void {
    this.showIQCModal = false;
    this.iqcScanInput = '';
    this.scannedMaterial = null;
    this.selectedIQCStatus = 'CHỜ KIỂM';
  }
  
  async processIQCScan(): Promise<void> {
    if (!this.iqcScanInput.trim()) {
      return;
    }
    
    const scannedCode = this.iqcScanInput.trim();
    console.log('🔍 Scanning QR code:', scannedCode);
    
    // Parse QR code format: MaterialCode|PO|Quantity|IMD
    const parts = scannedCode.split('|');
    if (parts.length < 4) {
      alert('❌ Mã QR không hợp lệ. Định dạng: MaterialCode|PO|Quantity|IMD');
      this.iqcScanInput = '';
      return;
    }
    
    const materialCode = parts[0].trim();
    const poNumber = parts[1].trim();
    const scannedIMD = parts[3].trim(); // IMD (Import Date) - format: DDMMYYYY hoặc DDMMYYYY + sequence
    
    console.log('🔍 Parsed QR code:', {
      materialCode,
      poNumber,
      scannedIMD
    });
    
    // Kiểm tra nếu không có dữ liệu trong memory, tìm trực tiếp từ Firestore
    if (this.materials.length === 0) {
      console.log('⚠️ Materials array is empty, searching directly in Firestore...');
      await this.searchMaterialInFirestore(materialCode, poNumber, scannedIMD);
      return;
    }
    
    // Find material by comparing materialCode, PO, and IMD
    const foundMaterial = this.materials.find(m => {
      const materialIMD = this.getDisplayIMD(m);
      const materialMatch = m.materialCode === materialCode;
      
      // So sánh PO number - linh hoạt hơn với dấu "/" và khoảng trắng
      const normalizedMaterialPO = (m.poNumber || '').trim();
      const normalizedScannedPO = poNumber.trim();
      const poMatch = normalizedMaterialPO === normalizedScannedPO || 
                      normalizedMaterialPO.replace(/\s+/g, '') === normalizedScannedPO.replace(/\s+/g, '');
      
      // So sánh IMD - có thể match exact hoặc startsWith
      const imdMatch = materialIMD === scannedIMD || 
                       materialIMD.startsWith(scannedIMD) || 
                       scannedIMD.startsWith(materialIMD);
      
      console.log(`🔍 Comparing material ${m.materialCode}:`, {
        materialCode: m.materialCode,
        materialPO: normalizedMaterialPO,
        scannedPO: normalizedScannedPO,
        materialIMD,
        scannedIMD,
        materialMatch,
        poMatch,
        imdMatch
      });
      
      return materialMatch && poMatch && imdMatch;
    });
    
    if (foundMaterial) {
      this.scannedMaterial = foundMaterial;
      this.iqcScanInput = '';
      console.log('✅ Found material:', foundMaterial);
    } else {
      // Nếu không tìm thấy trong memory, thử tìm trong Firestore
      console.log('⚠️ Material not found in memory, trying Firestore search...');
      await this.searchMaterialInFirestore(materialCode, poNumber, scannedIMD);
    }
  }
  
  async searchMaterialInFirestore(materialCode: string, poNumber: string, scannedIMD: string): Promise<void> {
    try {
      console.log('🔍 Searching in Firestore:', { materialCode, poNumber, scannedIMD });
      
      // Query Firestore với materialCode và poNumber
      const querySnapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', 'ASM1')
           .where('materialCode', '==', materialCode)
           .where('poNumber', '==', poNumber)
           .limit(10)
      ).get().toPromise();
      
      if (!querySnapshot || querySnapshot.empty) {
        alert(`❌ Không tìm thấy mã hàng trong database\n\nMã QR: ${this.iqcScanInput}\n\nĐã tìm với:\n- Mã hàng: ${materialCode}\n- PO: ${poNumber}\n- IMD: ${scannedIMD}\n\nVui lòng kiểm tra lại mã QR code.`);
        this.iqcScanInput = '';
        this.scannedMaterial = null;
        return;
      }
      
      // Tìm material có IMD khớp
      let foundMaterial: InventoryMaterial | null = null;
      
      querySnapshot.forEach(doc => {
        const data = doc.data() as any;
        const material: InventoryMaterial = {
          id: doc.id,
          factory: data.factory || 'ASM1',
          importDate: this.parseImportDate(data.importDate),
          receivedDate: data.receivedDate?.toDate() || undefined,
          batchNumber: data.batchNumber || '',
          materialCode: data.materialCode || '',
          materialName: data.materialName || '',
          poNumber: data.poNumber || '',
          openingStock: data.openingStock || null,
          quantity: data.quantity || 0,
          unit: data.unit || '',
          exported: data.exported || 0,
          xt: data.xt || 0,
          stock: data.stock || 0,
          location: data.location || '',
          type: data.type || '',
          expiryDate: data.expiryDate?.toDate() || new Date(),
          qualityCheck: data.qualityCheck || false,
          isReceived: data.isReceived || false,
          notes: data.notes || '',
          rollsOrBags: data.rollsOrBags || '',
          supplier: data.supplier || '',
          remarks: data.remarks || '',
          iqcStatus: data.iqcStatus || 'CHỜ XÁC NHẬN',
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date()
        };
        
        const materialIMD = this.getDisplayIMD(material);
        const imdMatch = materialIMD === scannedIMD || 
                         materialIMD.startsWith(scannedIMD) || 
                         scannedIMD.startsWith(materialIMD);
        
        console.log(`🔍 Checking Firestore material ${material.materialCode}:`, {
          materialIMD,
          scannedIMD,
          imdMatch
        });
        
        if (imdMatch && !foundMaterial) {
          foundMaterial = material;
        }
      });
      
      if (foundMaterial) {
        this.scannedMaterial = foundMaterial;
        // Thêm vào materials array nếu chưa có
        const existingIndex = this.materials.findIndex(m => m.id === foundMaterial!.id);
        if (existingIndex < 0) {
          this.materials.push(foundMaterial);
          this.applyFilters();
        }
        this.iqcScanInput = '';
        console.log('✅ Found material in Firestore:', foundMaterial);
      } else {
        alert(`❌ Không tìm thấy mã hàng với IMD khớp\n\nMã QR: ${this.iqcScanInput}\n\nĐã tìm với:\n- Mã hàng: ${materialCode}\n- PO: ${poNumber}\n- IMD: ${scannedIMD}\n\nVui lòng kiểm tra lại mã QR code.`);
        this.iqcScanInput = '';
        this.scannedMaterial = null;
      }
    } catch (error) {
      console.error('❌ Error searching in Firestore:', error);
      alert(`❌ Lỗi khi tìm kiếm trong database\n\nLỗi: ${error}\n\nVui lòng thử lại hoặc kiểm tra kết nối Firestore.`);
      this.iqcScanInput = '';
      this.scannedMaterial = null;
    }
  }
  
  async updateIQCStatus(): Promise<void> {
    if (!this.scannedMaterial || !this.selectedIQCStatus) {
      return;
    }
    
    // 🔧 FIX: Kiểm tra currentEmployeeId trước khi update
    if (!this.currentEmployeeId || this.currentEmployeeId.trim() === '') {
      alert('❌ Lỗi: Không tìm thấy mã nhân viên!\n\nVui lòng xác thực lại nhân viên trước khi kiểm.');
      console.error('❌ currentEmployeeId is empty:', this.currentEmployeeId);
      return;
    }
    
    const materialId = this.scannedMaterial.id;
    if (!materialId) {
      alert('❌ Không tìm thấy ID của material');
      return;
    }
    
    // Lưu thông tin trước khi reset
    const statusToUpdate = this.selectedIQCStatus;
    const materialToUpdate = { ...this.scannedMaterial };
    const employeeIdToSave = this.currentEmployeeId.trim();
    
    // Update local data ngay lập tức để UI responsive
    const index = this.materials.findIndex(m => m.id === materialId);
    if (index >= 0) {
      this.materials[index].iqcStatus = statusToUpdate;
      this.materials[index].updatedAt = new Date();
    }
    
    // Update local counts immediately (optimistic update)
    this.updateLocalCounts(statusToUpdate, materialToUpdate);
    
    // ĐÓNG MODAL NGAY LẬP TỨC (trước khi await Firestore)
    this.scannedMaterial = null;
    this.iqcScanInput = '';
    this.selectedIQCStatus = 'CHỜ KIỂM';
    this.showIQCModal = false; // Đóng modal ngay lập tức
    
    // Update Firestore bất đồng bộ (không chờ)
    const now = new Date();
    console.log(`💾 Updating IQC status: Material=${materialId}, Status=${statusToUpdate}, Employee=${employeeIdToSave}, Time=${now.toISOString()}`);
    
    // Fire and forget - không chờ kết quả để UI responsive
    this.firestore.collection('inventory-materials').doc(materialId).update({
      iqcStatus: statusToUpdate,
      updatedAt: now,
      qcCheckedBy: employeeIdToSave,
      qcCheckedAt: now
    }).then(() => {
      console.log(`✅ Updated IQC status in Firestore: ${materialId} -> ${statusToUpdate} by ${employeeIdToSave} at ${now.toISOString()}`);
      
      // Refresh counts và recent materials sau khi update thành công (chạy background)
      setTimeout(() => {
        this.loadPendingQCCount();
        this.loadTodayCheckedCount();
        this.loadPendingConfirmCount();
        this.loadRecentCheckedMaterials();
      }, 500); // Delay lâu hơn để tránh query quá nhiều
    }).catch((error) => {
      console.error('❌ Error updating IQC status:', error);
      
      // Revert local change nếu Firestore update thất bại
      if (index >= 0) {
        this.materials[index].iqcStatus = materialToUpdate.iqcStatus;
        this.materials[index].updatedAt = materialToUpdate.updatedAt || new Date();
      }
      
      // Revert counts
      this.updateLocalCounts(materialToUpdate.iqcStatus || 'CHỜ KIỂM', materialToUpdate);
      
      // Hiển thị lỗi
      alert(`❌ Lỗi khi cập nhật trạng thái IQC!\n\nVui lòng thử lại.`);
    });
  }
  
  // Update local counts immediately (optimistic update)
  updateLocalCounts(newStatus: string, material: InventoryMaterial): void {
    const oldStatus = material.iqcStatus || 'CHỜ KIỂM';
    
    // Update pending QC count
    if (oldStatus === 'CHỜ KIỂM' && newStatus !== 'CHỜ KIỂM') {
      // Material is no longer pending, decrease count
      if (this.pendingQCCount > 0) {
        this.pendingQCCount--;
      }
    }
    
    // Update today checked count
    if (newStatus !== 'CHỜ KIỂM') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const now = new Date();
      if (now >= today) {
        this.todayCheckedCount++;
      }
    }
    
    // Update pending confirm count
    if (oldStatus === 'CHỜ XÁC NHẬN' && newStatus !== 'CHỜ XÁC NHẬN') {
      // If previous status was CHỜ XÁC NHẬN and now changed, decrease
      if (this.pendingConfirmCount > 0) {
        this.pendingConfirmCount--;
      }
    } else if (oldStatus !== 'CHỜ XÁC NHẬN' && newStatus === 'CHỜ XÁC NHẬN') {
      // If new status is CHỜ XÁC NHẬN, increase
      this.pendingConfirmCount++;
    }
    
    // Update recent checked materials (add to top)
    if (newStatus !== 'CHỜ KIỂM' && this.currentEmployeeId) {
      const recentItem = {
        materialCode: material.materialCode || '',
        poNumber: material.poNumber || '',
        batchNumber: material.batchNumber || '',
        iqcStatus: newStatus,
        checkedBy: this.currentEmployeeId,
        checkedAt: new Date()
      };
      
      // Add to beginning of array
      this.recentCheckedMaterials.unshift(recentItem);
      // Keep only last 20
      if (this.recentCheckedMaterials.length > 20) {
        this.recentCheckedMaterials = this.recentCheckedMaterials.slice(0, 20);
      }
    }
    
    // Apply filters to update displayed list
    this.applyFilters();
  }
  
  getIQCStatusClass(status: string): string {
    switch (status) {
      case 'PASS':
        return 'status-pass';
      case 'NG':
        return 'status-ng';
      case 'ĐẶC CÁCH':
        return 'status-special';
      case 'CHỜ XÁC NHẬN':
      case 'CHỜ KIỂM':
        return 'status-pending';
      default:
        return 'status-default';
    }
  }
  
  formatDate(date: Date | null): string {
    if (!date) return '';
    return new Date(date).toLocaleDateString('vi-VN');
  }
  
  getStatusLabel(status: string): string {
    if (!status || status === 'CHỜ KIỂM' || status === 'CHỜ XÁC NHẬN') {
      return status || 'CHỜ KIỂM';
    }
    return status;
  }
  
  // Close Employee Modal
  closeEmployeeModal(): void {
    this.showEmployeeModal = false;
    this.employeeScanInput = '';
  }

  // Verify employee before accessing QC tab
  async verifyEmployee(): Promise<void> {
    if (!this.employeeScanInput.trim()) {
      alert('⚠️ Vui lòng nhập mã nhân viên');
      return;
    }
    
    const scannedData = this.employeeScanInput.trim();
    
    // Parse employee ID and name from QR code format: ASP1752-NGUYEN THANH HUY-Bo Phan Chat Luong-19/06/2023
    const normalizedInput = scannedData.replace(/ÁP/gi, 'ASP');
    const employeeId = normalizedInput.substring(0, 7).toUpperCase();
    
    // Extract employee name from QR code (format: ASPXXXX-NAME-...)
    let employeeName = '';
    const parts = scannedData.split('-');
    if (parts.length >= 2) {
      employeeName = parts[1].trim();
    }
    
    // If name not found in QR code, try to get from users collection
    if (!employeeName) {
      employeeName = await this.getEmployeeNameFromFirestore(employeeId);
    }
    
    // Hardcoded list of allowed QA employee IDs
    const allowedEmployeeIds = ['ASP0106', 'ASP1752', 'ASP0028', 'ASP1747', 'ASP2083', 'ASP2137'];
    
    if (allowedEmployeeIds.includes(employeeId)) {
      this.currentEmployeeId = employeeId;
      this.currentEmployeeName = employeeName || employeeId; // Fallback to ID if no name
      this.isEmployeeVerified = true;
      this.showEmployeeModal = false;
      this.employeeScanInput = '';
      
      // 🔧 FIX: Lưu currentEmployeeId vào localStorage để khôi phục khi refresh
      localStorage.setItem('qc_currentEmployeeId', employeeId);
      localStorage.setItem('qc_currentEmployeeName', this.currentEmployeeName);
      
      console.log('✅ Employee verified:', employeeId, 'Name:', employeeName);
      console.log('💾 Saved to localStorage for persistence');
      
      // Load counts and recent materials after employee verified
      this.loadPendingQCCount();
      this.loadTodayCheckedCount();
      this.loadPendingConfirmCount();
      this.loadRecentCheckedMaterials();
    } else {
      alert(`❌ Nhân viên ${employeeId} không có quyền truy cập tab QC.\n\nChỉ nhân viên QA mới được phép.`);
      this.employeeScanInput = '';
    }
  }
  
  // Get employee name from Firestore
  async getEmployeeNameFromFirestore(employeeId: string): Promise<string> {
    try {
      // Try users collection first
      const usersSnapshot = await this.firestore.collection('users', ref =>
        ref.where('employeeId', '==', employeeId).limit(1)
      ).get().toPromise();
      
      if (usersSnapshot && !usersSnapshot.empty) {
        const userData = usersSnapshot.docs[0].data() as any;
        if (userData.displayName) {
          return userData.displayName;
        }
      }
      
      // Try user-permissions collection
      const permissionsSnapshot = await this.firestore.collection('user-permissions', ref =>
        ref.where('employeeId', '==', employeeId).limit(1)
      ).get().toPromise();
      
      if (permissionsSnapshot && !permissionsSnapshot.empty) {
        const permData = permissionsSnapshot.docs[0].data() as any;
        if (permData.displayName) {
          return permData.displayName;
        }
      }
      
      return '';
    } catch (error) {
      console.error('❌ Error getting employee name:', error);
      return '';
    }
  }
  
  // Load recent checked materials (one-time query, not subscription)
  loadRecentCheckedMaterials(): void {
    this.isLoadingRecent = true;
    
    // Use get() for one-time query (faster than subscription)
    this.firestore.collection('inventory-materials', ref =>
      ref.where('factory', '==', 'ASM1')
         .orderBy('qcCheckedAt', 'desc')
         .limit(100) // Get more to filter, then take top 20
    ).get()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        const recentMaterials = snapshot.docs
          .map(doc => {
            const data = doc.data() as any;
            const qcCheckedAt = data.qcCheckedAt?.toDate ? data.qcCheckedAt.toDate() : null;
            const iqcStatus = data.iqcStatus;
            const qcCheckedBy = data.qcCheckedBy || '';
            const location = (data.location || '').toUpperCase();
            
            // Chỉ hiển thị materials được người dùng kiểm
            const isAutoPass = (location === 'F62' || location === 'F62TRA') && iqcStatus === 'Pass' && !qcCheckedBy;
            const hasUserChecked = qcCheckedBy && qcCheckedBy.trim() !== '' && qcCheckedAt;
            
            if (iqcStatus && 
                iqcStatus !== 'CHỜ KIỂM' && 
                hasUserChecked && 
                !isAutoPass) {
              return {
                materialCode: data.materialCode || '',
                poNumber: data.poNumber || '',
                batchNumber: data.batchNumber || '',
                iqcStatus: iqcStatus,
                checkedBy: qcCheckedBy,
                checkedAt: qcCheckedAt
              };
            }
            return null;
          })
          .filter(material => material !== null)
          .slice(0, 20); // Get only last 20
        
        this.recentCheckedMaterials = recentMaterials;
        this.isLoadingRecent = false;
      },
      error: (error) => {
        console.error('❌ Error loading recent checked materials:', error);
        this.isLoadingRecent = false;
      }
    });
  }
  
  // Load pending QC count from Firestore (one-time query, not subscription)
  loadPendingQCCount(): void {
    // Use get() instead of snapshotChanges() for one-time query (faster)
    this.firestore.collection('inventory-materials', ref =>
      ref.where('factory', '==', 'ASM1')
         .where('iqcStatus', '==', 'CHỜ KIỂM')
         .where('location', '==', 'IQC')
    ).get()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        this.pendingQCCount = snapshot.size;
      },
      error: (error) => {
        console.error('❌ Error loading pending QC count:', error);
        // Fallback: calculate from local materials
        this.pendingQCCount = this.materials.filter(m => 
          m.iqcStatus === 'CHỜ KIỂM' && m.location === 'IQC'
        ).length;
      }
    });
  }
  
  // Load today's checked count (one-time query)
  loadTodayCheckedCount(): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Use get() for one-time query (faster than subscription)
    this.firestore.collection('inventory-materials', ref =>
      ref.where('factory', '==', 'ASM1')
         .where('qcCheckedAt', '>=', today)
         .where('qcCheckedAt', '<', tomorrow)
    ).get()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        // Count only materials with status != 'CHỜ KIỂM'
        this.todayCheckedCount = snapshot.docs.filter(doc => {
          const data = doc.data() as any;
          return data.iqcStatus && data.iqcStatus !== 'CHỜ KIỂM';
        }).length;
      },
      error: (error) => {
        console.error('❌ Error loading today checked count:', error);
        // Fallback: calculate from local materials
        this.todayCheckedCount = this.materials.filter(m => {
          if (!m.iqcStatus || m.iqcStatus === 'CHỜ KIỂM') return false;
          const checkDate = m.updatedAt || new Date();
          return checkDate >= today && checkDate < tomorrow;
        }).length;
      }
    });
  }
  
  // Load pending confirm count (one-time query)
  loadPendingConfirmCount(): void {
    // Use get() for one-time query (faster)
    this.firestore.collection('inventory-materials', ref =>
      ref.where('factory', '==', 'ASM1')
         .where('iqcStatus', '==', 'CHỜ XÁC NHẬN')
    ).get()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        this.pendingConfirmCount = snapshot.size;
      },
      error: (error) => {
        console.error('❌ Error loading pending confirm count:', error);
        // Fallback: calculate from local materials
        this.pendingConfirmCount = this.materials.filter(m => 
          m.iqcStatus === 'CHỜ XÁC NHẬN'
        ).length;
      }
    });
  }
  
  // Fallback: count manually
  loadPendingConfirmCountFallback(): void {
    this.firestore.collection('inventory-materials', ref =>
      ref.where('factory', '==', 'ASM1')
    ).snapshotChanges()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        this.pendingConfirmCount = snapshot.filter(doc => {
          const data = doc.payload.doc.data() as any;
          return data.iqcStatus === 'CHỜ XÁC NHẬN';
        }).length;
        console.log(`📊 Pending confirm count (fallback): ${this.pendingConfirmCount}`);
      },
      error: (error) => {
        console.error('❌ Error loading pending confirm count (fallback):', error);
        this.pendingConfirmCount = 0;
      }
    });
  }
  
  // Show today checked materials modal - chỉ hiển thị materials được user kiểm (có qcCheckedBy)
  async showTodayCheckedMaterials(): Promise<void> {
    this.showTodayCheckedModal = true;
    this.isLoadingReport = true;
    
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      // Query materials checked today with qcCheckedBy (user checked, not auto-pass)
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', 'ASM1')
           .where('qcCheckedAt', '>=', today)
           .where('qcCheckedAt', '<', tomorrow)
      ).get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        this.todayCheckedMaterials = [];
        this.isLoadingReport = false;
        return;
      }
      
      this.todayCheckedMaterials = snapshot.docs
        .map(doc => {
          const data = doc.data() as any;
          const qcCheckedAt = data.qcCheckedAt?.toDate ? data.qcCheckedAt.toDate() : null;
          const iqcStatus = data.iqcStatus;
          const qcCheckedBy = data.qcCheckedBy || '';
          const location = (data.location || '').toUpperCase();
          
          // Chỉ lấy materials:
          // 1. Có qcCheckedBy (được user kiểm, không phải auto-pass)
          // 2. Có iqcStatus và không phải 'CHỜ KIỂM'
          // 3. Không phải auto-pass (location F62/F62TRA với Pass và không có qcCheckedBy)
          const isAutoPass = (location === 'F62' || location === 'F62TRA') && iqcStatus === 'Pass' && !qcCheckedBy;
          const hasUserChecked = qcCheckedBy && qcCheckedBy.trim() !== '' && qcCheckedAt;
          
          if (iqcStatus && 
              iqcStatus !== 'CHỜ KIỂM' && 
              hasUserChecked && 
              !isAutoPass) {
            return {
              materialCode: data.materialCode || '',
              poNumber: data.poNumber || '',
              batchNumber: data.batchNumber || '',
              iqcStatus: iqcStatus,
              checkedBy: qcCheckedBy,
              checkedAt: qcCheckedAt
            };
          }
          return null;
        })
        .filter(material => material !== null)
        .sort((a, b) => {
          return b!.checkedAt.getTime() - a!.checkedAt.getTime();
        });
      
      console.log(`✅ Loaded ${this.todayCheckedMaterials.length} materials checked today by users`);
      this.isLoadingReport = false;
    } catch (error) {
      console.error('❌ Error loading today checked materials:', error);
      this.isLoadingReport = false;
    }
  }
  
  closeTodayCheckedModal(): void {
    this.showTodayCheckedModal = false;
    this.todayCheckedMaterials = [];
  }
  
  // Fallback: load all ASM1 materials and count manually
  loadPendingQCCountFallback(): void {
    this.firestore.collection('inventory-materials', ref =>
      ref.where('factory', '==', 'ASM1')
    ).snapshotChanges()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        this.pendingQCCount = snapshot.filter(doc => {
          const data = doc.payload.doc.data() as any;
          // Filter: iqcStatus === 'CHỜ KIỂM' AND location === 'IQC'
          return data.iqcStatus === 'CHỜ KIỂM' && data.location === 'IQC';
        }).length;
        console.log(`📊 Pending QC count (fallback, location = IQC): ${this.pendingQCCount}`);
      },
      error: (error) => {
        console.error('❌ Error loading pending QC count (fallback):', error);
        this.pendingQCCount = 0;
      }
    });
  }
  
  // More menu functions
  toggleMoreMenu(): void {
    this.showMoreMenu = !this.showMoreMenu;
  }
  
  closeMoreMenu(): void {
    this.showMoreMenu = false;
  }
  
  openDownloadModal(): void {
    this.showDownloadModal = true;
    this.closeMoreMenu();
    // Set default to current month
    const now = new Date();
    this.selectedYear = now.getFullYear().toString();
    this.selectedMonth = (now.getMonth() + 1).toString().padStart(2, '0');
  }
  
  closeDownloadModal(): void {
    this.showDownloadModal = false;
    this.selectedMonth = '';
    this.selectedYear = '';
  }
  
  async downloadMonthlyReport(): Promise<void> {
    if (!this.selectedMonth || !this.selectedYear) {
      alert('Vui lòng chọn tháng và năm');
      return;
    }
    
    this.isLoadingReport = true;
    
    try {
      // Calculate start and end of selected month
      const year = parseInt(this.selectedYear);
      const month = parseInt(this.selectedMonth);
      const startDate = new Date(year, month - 1, 1);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(year, month, 1);
      endDate.setHours(0, 0, 0, 0);
      
      // Query materials checked in selected month (only user checked, not auto-pass)
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', 'ASM1')
           .where('qcCheckedAt', '>=', startDate)
           .where('qcCheckedAt', '<', endDate)
           .orderBy('qcCheckedAt', 'desc')
      ).get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        alert('Không có dữ liệu kiểm trong tháng này');
        this.isLoadingReport = false;
        return;
      }
      
      // Filter only user-checked materials (not auto-pass)
      const reportData = snapshot.docs
        .map(doc => {
          const data = doc.data() as any;
          const qcCheckedAt = data.qcCheckedAt?.toDate ? data.qcCheckedAt.toDate() : null;
          const iqcStatus = data.iqcStatus;
          const qcCheckedBy = data.qcCheckedBy || '';
          const location = (data.location || '').toUpperCase();
          
          const isAutoPass = (location === 'F62' || location === 'F62TRA') && iqcStatus === 'Pass' && !qcCheckedBy;
          const hasUserChecked = qcCheckedBy && qcCheckedBy.trim() !== '' && qcCheckedAt;
          
          if (iqcStatus && 
              iqcStatus !== 'CHỜ KIỂM' && 
              hasUserChecked && 
              !isAutoPass) {
            return {
              materialCode: data.materialCode || '',
              poNumber: data.poNumber || '',
              batchNumber: data.batchNumber || '',
              materialName: data.materialName || '',
              quantity: data.quantity || 0,
              unit: data.unit || '',
              iqcStatus: iqcStatus,
              checkedBy: qcCheckedBy,
              checkedAt: qcCheckedAt
            };
          }
          return null;
        })
        .filter(item => item !== null);
      
      if (reportData.length === 0) {
        alert('Không có dữ liệu kiểm trong tháng này');
        this.isLoadingReport = false;
        return;
      }
      
      // Export to Excel
      import('xlsx').then(XLSX => {
        const wsData = [
          ['STT', 'Mã hàng', 'Tên hàng', 'Số P.O', 'Lô hàng', 'Số lượng', 'Đơn vị', 'Trạng thái', 'Người kiểm', 'Thời gian kiểm']
        ];
        
        reportData.forEach((item: any, index: number) => {
          wsData.push([
            index + 1,
            item.materialCode,
            item.materialName,
            item.poNumber,
            item.batchNumber,
            item.quantity,
            item.unit,
            item.iqcStatus,
            item.checkedBy,
            item.checkedAt.toLocaleString('vi-VN')
          ]);
        });
        
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'QC Report');
        
        const fileName = `QC_Report_${this.selectedMonth}_${this.selectedYear}.xlsx`;
        XLSX.writeFile(wb, fileName);
        
        console.log(`✅ Exported ${reportData.length} records to ${fileName}`);
        this.isLoadingReport = false;
        this.closeDownloadModal();
      }).catch(error => {
        console.error('❌ Error exporting Excel:', error);
        alert('Lỗi khi xuất file Excel');
        this.isLoadingReport = false;
      });
      
    } catch (error) {
      console.error('❌ Error loading monthly report:', error);
      alert('Lỗi khi tải dữ liệu');
      this.isLoadingReport = false;
    }
  }
  
  // Load QC Report
  async loadQCReport(): Promise<void> {
    this.isLoadingReport = true;
    this.showReportModal = true;
    this.showMoreMenu = false;
    
    try {
      console.log('📊 Loading QC Report...');
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', 'ASM1')
      ).get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        this.qcReports = [];
        this.isLoadingReport = false;
        return;
      }
      
      this.qcReports = snapshot.docs
        .map(doc => {
          const data = doc.data() as any;
          const updatedAt = data.updatedAt?.toDate ? data.updatedAt.toDate() : null;
          const qcCheckedAt = data.qcCheckedAt?.toDate ? data.qcCheckedAt.toDate() : null;
          const iqcStatus = data.iqcStatus;
          
          // Filter: Has iqcStatus, not 'CHỜ KIỂM', and was checked today
          if (iqcStatus && iqcStatus !== 'CHỜ KIỂM' && (updatedAt || qcCheckedAt)) {
            const checkDate = qcCheckedAt || updatedAt;
            if (checkDate >= today && checkDate < tomorrow) {
              return {
                materialCode: data.materialCode || '',
                poNumber: data.poNumber || '',
                batchNumber: data.batchNumber || '',
                iqcStatus: iqcStatus,
                checkedBy: data.qcCheckedBy || this.currentEmployeeId || 'N/A',
                checkedAt: checkDate
              };
            }
          }
          return null;
        })
        .filter(report => report !== null)
        .sort((a, b) => {
          // Sort by checked time (newest first)
          return b!.checkedAt.getTime() - a!.checkedAt.getTime();
        });
      
      console.log(`✅ Loaded ${this.qcReports.length} QC reports for today`);
      this.isLoadingReport = false;
    } catch (error) {
      console.error('❌ Error loading QC report:', error);
      alert('❌ Lỗi khi tải báo cáo kiểm');
      this.isLoadingReport = false;
    }
  }
  
  // Download QC Report as Excel
  downloadQCReport(): void {
    if (this.qcReports.length === 0) {
      alert('⚠️ Không có dữ liệu để xuất báo cáo');
      return;
    }
    
    try {
      // Import XLSX dynamically
      import('xlsx').then(XLSX => {
        const ws_data = [
          ['Mã nhân viên kiểm', 'Mã hàng', 'Số P.O', 'Lô hàng', 'Trạng thái', 'Thời gian kiểm']
        ];
        
        this.qcReports.forEach(report => {
          ws_data.push([
            report!.checkedBy,
            report!.materialCode,
            report!.poNumber,
            report!.batchNumber,
            report!.iqcStatus,
            report!.checkedAt.toLocaleString('vi-VN')
          ]);
        });
        
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(ws_data);
        
        // Set column widths
        ws['!cols'] = [
          { wch: 18 }, // Mã nhân viên
          { wch: 15 }, // Mã hàng
          { wch: 15 }, // P.O
          { wch: 15 }, // Lô hàng
          { wch: 15 }, // Trạng thái
          { wch: 25 }  // Thời gian
        ];
        
        XLSX.utils.book_append_sheet(wb, ws, 'Báo cáo kiểm QC');
        
        const fileName = `QC_Report_${new Date().toLocaleDateString('vi-VN').replace(/\//g, '_')}.xlsx`;
        XLSX.writeFile(wb, fileName);
        
        console.log(`✅ QC Report downloaded: ${fileName}`);
      }).catch(error => {
        console.error('❌ Error importing XLSX:', error);
        alert('❌ Lỗi khi xuất báo cáo Excel. Vui lòng thử lại.');
      });
    } catch (error) {
      console.error('❌ Error downloading QC report:', error);
      alert('❌ Lỗi khi tải báo cáo');
    }
  }
  
  closeReportModal(): void {
    this.showReportModal = false;
    this.qcReports = [];
  }

  // Show pending QC materials modal
  async showPendingQCMaterials(): Promise<void> {
    this.showPendingQCModal = true;
    this.isLoadingReport = true;
    
    try {
      console.log('📊 Loading pending QC materials...');
      
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', 'ASM1')
      ).get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        this.pendingQCMaterials = [];
        this.isLoadingReport = false;
        return;
      }
      
      this.pendingQCMaterials = snapshot.docs
        .map(doc => {
          const data = doc.data() as any;
          const iqcStatus = data.iqcStatus;
          const location = data.location || '';
          
          // Filter: Only materials with status 'CHỜ KIỂM' AND location === 'IQC'
          if (iqcStatus === 'CHỜ KIỂM' && location === 'IQC') {
            return {
              id: doc.id,
              materialCode: data.materialCode || '',
              materialName: data.materialName || '',
              poNumber: data.poNumber || '',
              batchNumber: data.batchNumber || '',
              quantity: data.quantity || 0,
              unit: data.unit || '',
              location: location,
              importDate: data.importDate?.toDate ? data.importDate.toDate() : null,
              receivedDate: data.receivedDate?.toDate ? data.receivedDate.toDate() : null,
              iqcStatus: iqcStatus
            };
          }
          return null;
        })
        .filter(material => material !== null)
        .sort((a, b) => {
          // Sort by import date (newest first)
          const dateA = a!.importDate || a!.receivedDate || new Date(0);
          const dateB = b!.importDate || b!.receivedDate || new Date(0);
          return dateB.getTime() - dateA.getTime();
        });
      
      console.log(`✅ Loaded ${this.pendingQCMaterials.length} pending QC materials`);
      this.isLoadingReport = false;
    } catch (error) {
      console.error('❌ Error loading pending QC materials:', error);
      alert('❌ Lỗi khi tải danh sách mã hàng chờ kiểm');
      this.isLoadingReport = false;
    }
  }

  closePendingQCModal(): void {
    this.showPendingQCModal = false;
    this.pendingQCMaterials = [];
  }

  // Logout method - chỉ đăng xuất khỏi tab QC, không đăng xuất khỏi web
  logout(): void {
    console.log('🚪 Đăng xuất khỏi tab QC...');
    
    // 1. Reset employee verification state
    this.isEmployeeVerified = false;
    this.currentEmployeeId = '';
    this.currentEmployeeName = '';
    this.employeeScanInput = '';
    this.showEmployeeModal = true; // Hiển thị lại modal xác nhận nhân viên
    
    // 2. Clear localStorage chỉ liên quan đến QC
    localStorage.removeItem('qc_currentEmployeeId');
    localStorage.removeItem('qc_currentEmployeeName');
    
    // 3. Reset các modal và state khác
    this.showMoreMenu = false;
    this.showIQCModal = false;
    this.showReportModal = false;
    this.showTodayCheckedModal = false;
    this.showPendingQCModal = false;
    this.iqcScanInput = '';
    this.scannedMaterial = null;
    
    // 4. Reset counts
    this.pendingQCCount = 0;
    this.todayCheckedCount = 0;
    this.pendingConfirmCount = 0;
    this.recentCheckedMaterials = [];
    
    console.log('✅ Đã đăng xuất khỏi tab QC. Vui lòng quét lại mã nhân viên để tiếp tục.');
  }

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }
}

