import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { MatDialog } from '@angular/material/dialog';
import { QRScannerModalComponent, QRScannerData } from '../../components/qr-scanner-modal/qr-scanner-modal.component';
import * as XLSX from 'xlsx';

export interface WarehouseAccess {
  id?: string;
  employeeId: string;
  employeeName: string;
  department: string;
  accessDate: Date;
  type: 'IN' | 'OUT'; // IN: vào kho, OUT: ra khỏi kho
  scannedBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

@Component({
  selector: 'app-wh-security',
  templateUrl: './wh-security.component.html',
  styleUrls: ['./wh-security.component.scss']
})
export class WhSecurityComponent implements OnInit, OnDestroy {
  accessList: WarehouseAccess[] = [];
  filteredAccessList: WarehouseAccess[] = [];
  isLoading: boolean = false;
  errorMessage: string = '';
  
  // Search and filter
  searchTerm: string = '';
  typeFilter: string = 'all'; // all, IN, OUT
  dateFilter: string = 'today'; // today, week, month, all
  
  // Scan modal
  showScanModal: boolean = false;
  scanInput: string = '';
  scanType: 'IN' | 'OUT' = 'IN';
  
  // Import modal
  showImportModal: boolean = false;
  importText: string = '';
  importFile: File | null = null;
  importPreview: WarehouseAccess[] = [];
  importMode: 'text' | 'file' = 'text';
  
  // More menu
  showMoreMenu: boolean = false;
  
  private destroy$ = new Subject<void>();
  
  constructor(
    private firestore: AngularFirestore,
    private dialog: MatDialog
  ) {}
  
  ngOnInit(): void {
    this.loadAccessList();
    // Close more menu when clicking outside
    document.addEventListener('click', (event: any) => {
      if (this.showMoreMenu && !event.target.closest('.header-actions')) {
        this.showMoreMenu = false;
      }
    });
  }
  
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
  
  loadAccessList(): void {
    this.isLoading = true;
    this.errorMessage = '';
    
    try {
      this.firestore.collection('warehouse-access', ref => 
        ref.orderBy('accessDate', 'desc').limit(1000)
      ).snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (snapshot) => {
          try {
            this.accessList = snapshot.map(doc => {
              const data = doc.payload.doc.data() as any;
              return {
                id: doc.payload.doc.id,
                employeeId: data.employeeId || '',
                employeeName: data.employeeName || '',
                department: data.department || '',
                accessDate: data.accessDate?.toDate() || new Date(),
                type: data.type || 'IN',
                scannedBy: data.scannedBy || '',
                createdAt: data.createdAt?.toDate() || new Date(),
                updatedAt: data.updatedAt?.toDate() || new Date()
              };
            });
            this.applyFilters();
            this.isLoading = false;
          } catch (error) {
            console.error('❌ Error processing access list:', error);
            this.errorMessage = 'Lỗi khi xử lý dữ liệu';
            this.isLoading = false;
          }
        },
        error: (error) => {
          console.error('❌ Error loading access list:', error);
          // Nếu collection chưa tồn tại, khởi tạo với danh sách rỗng
          this.accessList = [];
          this.filteredAccessList = [];
          this.isLoading = false;
        }
      });
    } catch (error) {
      console.error('❌ Error initializing access list:', error);
      this.accessList = [];
      this.filteredAccessList = [];
      this.isLoading = false;
    }
  }
  
  toggleMoreMenu(): void {
    this.showMoreMenu = !this.showMoreMenu;
  }
  
  closeMoreMenu(): void {
    this.showMoreMenu = false;
  }
  
  applyFilters(): void {
    let filtered = [...this.accessList];
    
    // Search filter
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(item => 
        item.employeeId.toLowerCase().includes(term) ||
        item.employeeName.toLowerCase().includes(term) ||
        item.department.toLowerCase().includes(term)
      );
    }
    
    // Type filter
    if (this.typeFilter !== 'all') {
      filtered = filtered.filter(item => item.type === this.typeFilter);
    }
    
    // Date filter
    if (this.dateFilter !== 'all') {
      const now = new Date();
      let startDate = new Date();
      
      switch (this.dateFilter) {
        case 'today':
          startDate.setHours(0, 0, 0, 0);
          break;
        case 'week':
          startDate.setDate(now.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(now.getMonth() - 1);
          break;
      }
      
      filtered = filtered.filter(item => item.accessDate >= startDate);
    }
    
    this.filteredAccessList = filtered;
  }
  
  onSearchChange(): void {
    this.applyFilters();
  }
  
  onFilterChange(): void {
    this.applyFilters();
  }
  
  openScanModal(type: 'IN' | 'OUT'): void {
    this.scanType = type;
    this.scanInput = '';
    this.showScanModal = true;
  }
  
  closeScanModal(): void {
    this.showScanModal = false;
    this.scanInput = '';
  }
  
  startCameraScan(): void {
    const dialogData: QRScannerData = {
      title: `Quét mã nhân viên - ${this.scanType === 'IN' ? 'Vào kho' : 'Ra khỏi kho'}`,
      message: 'Quét mã QR hoặc barcode của nhân viên'
    };
    
    const dialogRef = this.dialog.open(QRScannerModalComponent, {
      width: '100vw',
      maxWidth: '100vw',
      height: '80vh',
      maxHeight: '80vh',
      data: dialogData,
      panelClass: 'qr-scanner-modal'
    });
    
    dialogRef.afterClosed().subscribe(result => {
      if (result && result.text) {
        this.scanInput = result.text;
        this.processScan();
      }
    });
  }
  
  processScan(): void {
    if (!this.scanInput.trim()) {
      alert('Vui lòng nhập hoặc quét mã nhân viên');
      return;
    }
    
    // Parse scan input: ASP0106-TRAN TUAN ANH-Bo Phan Kho-24/12/2018
    const parts = this.scanInput.split('-');
    if (parts.length < 4) {
      alert('Định dạng không đúng. Vui lòng quét lại mã nhân viên');
      return;
    }
    
    const employeeId = parts[0].trim();
    const employeeName = parts[1].trim();
    const department = parts[2].trim();
    const dateStr = parts[3].trim();
    
    // Parse date: 24/12/2018
    const dateParts = dateStr.split('/');
    if (dateParts.length !== 3) {
      alert('Định dạng ngày không đúng');
      return;
    }
    
    const accessDate = new Date(
      parseInt(dateParts[2]),
      parseInt(dateParts[1]) - 1,
      parseInt(dateParts[0])
    );
    
    // Create access record
    const accessRecord: WarehouseAccess = {
      employeeId,
      employeeName,
      department,
      accessDate,
      type: this.scanType,
      scannedBy: 'system',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Save to Firebase
    this.saveAccessRecord(accessRecord);
  }
  
  saveAccessRecord(record: WarehouseAccess): void {
    this.firestore.collection('warehouse-access').add({
      employeeId: record.employeeId,
      employeeName: record.employeeName,
      department: record.department,
      accessDate: record.accessDate,
      type: record.type,
      scannedBy: record.scannedBy || 'system',
      createdAt: new Date(),
      updatedAt: new Date()
    }).then(() => {
      console.log('✅ Access record saved');
      this.closeScanModal();
      alert(`${record.type === 'IN' ? 'Vào kho' : 'Ra khỏi kho'} thành công: ${record.employeeName} (${record.employeeId})`);
    }).catch(error => {
      console.error('❌ Error saving access record:', error);
      alert('Lỗi khi lưu dữ liệu');
    });
  }
  
  openImportModal(): void {
    this.showImportModal = true;
    this.importText = '';
    this.importFile = null;
    this.importPreview = [];
    this.importMode = 'text';
  }
  
  closeImportModal(): void {
    this.showImportModal = false;
    this.importText = '';
    this.importFile = null;
    this.importPreview = [];
  }
  
  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (!file) return;
    
    this.importFile = file;
    
    if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      this.parseExcelFile(file);
    } else if (file.name.endsWith('.txt') || file.name.endsWith('.csv')) {
      this.parseTextFile(file);
    } else {
      alert('Chỉ hỗ trợ file Excel (.xlsx, .xls) hoặc Text (.txt, .csv)');
    }
  }
  
  parseExcelFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
        
        this.importPreview = this.parseImportData(jsonData);
      } catch (error) {
        console.error('Error parsing Excel:', error);
        alert('Lỗi khi đọc file Excel');
      }
    };
    reader.readAsArrayBuffer(file);
  }
  
  parseTextFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const text = e.target.result;
        const lines = text.split('\n').filter((line: string) => line.trim());
        const jsonData = lines.map((line: string) => line.split('\t').length > 1 ? line.split('\t') : [line]);
        
        this.importPreview = this.parseImportData(jsonData);
      } catch (error) {
        console.error('Error parsing text file:', error);
        alert('Lỗi khi đọc file text');
      }
    };
    reader.readAsText(file);
  }
  
  parseImportData(data: any[]): WarehouseAccess[] {
    const preview: WarehouseAccess[] = [];
    
    for (const row of data) {
      if (!row || row.length === 0) continue;
      
      const line = Array.isArray(row) ? row.join('-') : row.toString();
      const parts = line.split('-');
      
      if (parts.length < 4) continue;
      
      const employeeId = parts[0].trim();
      const employeeName = parts[1].trim();
      const department = parts[2].trim();
      const dateStr = parts[3].trim();
      
      const dateParts = dateStr.split('/');
      if (dateParts.length !== 3) continue;
      
      try {
        const accessDate = new Date(
          parseInt(dateParts[2]),
          parseInt(dateParts[1]) - 1,
          parseInt(dateParts[0])
        );
        
        // Default to IN if not specified
        const type = parts[4]?.trim().toUpperCase() === 'OUT' ? 'OUT' : 'IN';
        
        preview.push({
          employeeId,
          employeeName,
          department,
          accessDate,
          type,
          scannedBy: 'import',
          createdAt: new Date(),
          updatedAt: new Date()
        });
      } catch (error) {
        console.error('Error parsing row:', row, error);
      }
    }
    
    return preview;
  }
  
  processTextImport(): void {
    if (!this.importText.trim()) {
      alert('Vui lòng nhập dữ liệu');
      return;
    }
    
    const lines = this.importText.split('\n').filter(line => line.trim());
    const jsonData = lines.map(line => line.split('\t').length > 1 ? line.split('\t') : [line]);
    
    this.importPreview = this.parseImportData(jsonData);
  }
  
  confirmImport(): void {
    if (this.importPreview.length === 0) {
      alert('Không có dữ liệu để import');
      return;
    }
    
    const batch = this.firestore.firestore.batch();
    const collectionRef = this.firestore.collection('warehouse-access');
    
    this.importPreview.forEach(record => {
      const docRef = collectionRef.ref.doc();
      batch.set(docRef, {
        employeeId: record.employeeId,
        employeeName: record.employeeName,
        department: record.department,
        accessDate: record.accessDate,
        type: record.type,
        scannedBy: 'import',
        createdAt: new Date(),
        updatedAt: new Date()
      });
    });
    
    batch.commit().then(() => {
      alert(`Đã import thành công ${this.importPreview.length} bản ghi`);
      this.closeImportModal();
      this.loadAccessList();
    }).catch(error => {
      console.error('Error importing:', error);
      alert('Lỗi khi import dữ liệu');
    });
  }
  
  exportToExcel(): void {
    const data = this.filteredAccessList.map(item => ({
      'Mã NV': item.employeeId,
      'Tên': item.employeeName,
      'Bộ phận': item.department,
      'Ngày': this.formatDate(item.accessDate),
      'Loại': item.type === 'IN' ? 'Vào kho' : 'Ra khỏi kho',
      'Thời gian': this.formatDateTime(item.createdAt || new Date())
    }));
    
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Danh sách ra vào kho');
    
    const fileName = `warehouse-access-${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }
  
  formatDate(date: Date): string {
    if (!date) return '';
    const d = new Date(date);
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
  }
  
  formatDateTime(date: Date | undefined): string {
    if (!date) {
      const now = new Date();
      return `${this.formatDate(now)} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    }
    const d = new Date(date);
    return `${this.formatDate(d)} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }
}

