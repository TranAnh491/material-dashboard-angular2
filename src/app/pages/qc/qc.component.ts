import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';

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
  qcReports: any[] = [];
  todayCheckedMaterials: any[] = [];
  isLoadingReport: boolean = false;
  
  private destroy$ = new Subject<void>();
  
  constructor(private firestore: AngularFirestore) {}
  
  ngOnInit(): void {
    // Không cần load materials ban đầu, chỉ load khi scan
    console.log('📦 QC Component initialized - ready for scanning');
    // Block access until employee is verified
    // Load pending QC count and today's checked count after employee verified
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
    this.showIQCModal = true;
    this.iqcScanInput = '';
    this.scannedMaterial = null;
    this.selectedIQCStatus = 'CHỜ KIỂM';
    
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
    
    const materialId = this.scannedMaterial.id;
    if (!materialId) {
      alert('❌ Không tìm thấy ID của material');
      return;
    }
    
    // Lưu thông tin trước khi reset
    const statusToUpdate = this.selectedIQCStatus;
    const materialToUpdate = { ...this.scannedMaterial };
    
    // Update local data ngay lập tức để UI responsive
    const index = this.materials.findIndex(m => m.id === materialId);
    if (index >= 0) {
      this.materials[index].iqcStatus = statusToUpdate;
      this.materials[index].updatedAt = new Date();
    }
    
    // Đóng modal ngay lập tức (không chờ Firestore)
    this.scannedMaterial = null;
    this.iqcScanInput = '';
    this.selectedIQCStatus = 'CHỜ KIỂM';
    this.closeIQCModal();
    
    // Update Firestore ở background (không chờ)
    const now = new Date();
    this.firestore.collection('inventory-materials').doc(materialId).update({
      iqcStatus: statusToUpdate,
      updatedAt: now,
      qcCheckedBy: this.currentEmployeeId,
      qcCheckedAt: now
    }).then(() => {
      console.log(`✅ Updated IQC status in Firestore: ${materialId} -> ${statusToUpdate} at ${now.toISOString()}`);
      // Real-time listeners sẽ tự động cập nhật danh sách và counts
    }).catch((error) => {
      console.error('❌ Error updating IQC status:', error);
      // Revert local change nếu Firestore update thất bại
      if (index >= 0) {
        this.materials[index].iqcStatus = materialToUpdate.iqcStatus;
        this.materials[index].updatedAt = materialToUpdate.updatedAt || new Date();
      }
      alert('❌ Lỗi khi cập nhật trạng thái IQC. Vui lòng thử lại.');
    });
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
      
      console.log('✅ Employee verified:', employeeId, 'Name:', employeeName);
      
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
  
  // Load recent checked materials (last 20)
  loadRecentCheckedMaterials(): void {
    this.isLoadingRecent = true;
    console.log('📊 Loading recent checked materials...');
    
    this.firestore.collection('inventory-materials', ref =>
      ref.where('factory', '==', 'ASM1')
    ).snapshotChanges()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        const recentMaterials = snapshot
          .map(doc => {
            const data = doc.payload.doc.data() as any;
            const qcCheckedAt = data.qcCheckedAt?.toDate ? data.qcCheckedAt.toDate() : null;
            const updatedAt = data.updatedAt?.toDate ? data.updatedAt.toDate() : null;
            const iqcStatus = data.iqcStatus;
            
            // Only include materials that have been checked (not 'CHỜ KIỂM')
            if (iqcStatus && iqcStatus !== 'CHỜ KIỂM' && (qcCheckedAt || updatedAt)) {
              return {
                materialCode: data.materialCode || '',
                poNumber: data.poNumber || '',
                batchNumber: data.batchNumber || '',
                iqcStatus: iqcStatus,
                checkedBy: data.qcCheckedBy || 'N/A',
                checkedAt: qcCheckedAt || updatedAt
              };
            }
            return null;
          })
          .filter(material => material !== null)
          .sort((a, b) => {
            // Sort by checked time (newest first)
            return b!.checkedAt.getTime() - a!.checkedAt.getTime();
          })
          .slice(0, 20); // Get only last 20
        
        this.recentCheckedMaterials = recentMaterials;
        this.isLoadingRecent = false;
        console.log(`✅ Loaded ${this.recentCheckedMaterials.length} recent checked materials`);
      },
      error: (error) => {
        console.error('❌ Error loading recent checked materials:', error);
        this.isLoadingRecent = false;
      }
    });
  }
  
  // Load pending QC count from Firestore (real-time)
  loadPendingQCCount(): void {
    console.log('📊 Loading pending QC count...');
    
    this.firestore.collection('inventory-materials', ref =>
      ref.where('factory', '==', 'ASM1')
         .where('iqcStatus', '==', 'CHỜ KIỂM')
    ).snapshotChanges()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        this.pendingQCCount = snapshot.length;
        console.log(`📊 Pending QC count: ${this.pendingQCCount}`);
      },
      error: (error) => {
        console.error('❌ Error loading pending QC count:', error);
        // Fallback: try without where clause and count manually
        this.loadPendingQCCountFallback();
      }
    });
  }
  
  // Load today's checked count
  loadTodayCheckedCount(): void {
    console.log('📊 Loading today checked count...');
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Load all ASM1 materials and filter those checked today
    this.firestore.collection('inventory-materials', ref =>
      ref.where('factory', '==', 'ASM1')
    ).snapshotChanges()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        this.todayCheckedCount = snapshot.filter(doc => {
          const data = doc.payload.doc.data() as any;
          const updatedAt = data.updatedAt?.toDate ? data.updatedAt.toDate() : null;
          const qcCheckedAt = data.qcCheckedAt?.toDate ? data.qcCheckedAt.toDate() : null;
          const iqcStatus = data.iqcStatus;
          
          // Material is checked today if:
          // 1. Has iqcStatus and it's not 'CHỜ KIỂM'
          // 2. Was updated today
          if (iqcStatus && iqcStatus !== 'CHỜ KIỂM' && (updatedAt || qcCheckedAt)) {
            const checkDate = qcCheckedAt || updatedAt;
            return checkDate >= today && checkDate < tomorrow;
          }
          return false;
        }).length;
        
        console.log(`📊 Today checked count: ${this.todayCheckedCount}`);
      },
      error: (error) => {
        console.error('❌ Error loading today checked count:', error);
        this.todayCheckedCount = 0;
      }
    });
  }
  
  // Load pending confirm count (CHỜ XÁC NHẬN)
  loadPendingConfirmCount(): void {
    console.log('📊 Loading pending confirm count...');
    
    this.firestore.collection('inventory-materials', ref =>
      ref.where('factory', '==', 'ASM1')
         .where('iqcStatus', '==', 'CHỜ XÁC NHẬN')
    ).snapshotChanges()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        this.pendingConfirmCount = snapshot.length;
        console.log(`📊 Pending confirm count: ${this.pendingConfirmCount}`);
      },
      error: (error) => {
        console.error('❌ Error loading pending confirm count:', error);
        // Fallback: count manually
        this.loadPendingConfirmCountFallback();
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
  
  // Show today checked materials modal
  async showTodayCheckedMaterials(): Promise<void> {
    this.showTodayCheckedModal = true;
    this.isLoadingReport = true;
    
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', 'ASM1')
      ).get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        this.todayCheckedMaterials = [];
        this.isLoadingReport = false;
        return;
      }
      
      this.todayCheckedMaterials = snapshot.docs
        .map(doc => {
          const data = doc.data() as any;
          const updatedAt = data.updatedAt?.toDate ? data.updatedAt.toDate() : null;
          const qcCheckedAt = data.qcCheckedAt?.toDate ? data.qcCheckedAt.toDate() : null;
          const iqcStatus = data.iqcStatus;
          
          if (iqcStatus && iqcStatus !== 'CHỜ KIỂM' && (updatedAt || qcCheckedAt)) {
            const checkDate = qcCheckedAt || updatedAt;
            if (checkDate >= today && checkDate < tomorrow) {
              return {
                materialCode: data.materialCode || '',
                poNumber: data.poNumber || '',
                batchNumber: data.batchNumber || '',
                iqcStatus: iqcStatus,
                checkedBy: data.qcCheckedBy || 'N/A',
                checkedAt: checkDate
              };
            }
          }
          return null;
        })
        .filter(material => material !== null)
        .sort((a, b) => {
          return b!.checkedAt.getTime() - a!.checkedAt.getTime();
        });
      
      console.log(`✅ Loaded ${this.todayCheckedMaterials.length} materials checked today`);
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
          return data.iqcStatus === 'CHỜ KIỂM';
        }).length;
        console.log(`📊 Pending QC count (fallback): ${this.pendingQCCount}`);
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
}

