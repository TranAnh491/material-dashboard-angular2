import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import * as XLSX from 'xlsx';

interface NVLData {
  id?: string;
  materialCode: string;
  openingStockE31: number;
  openingStockND: number;
  importE31: number;
  importND: number;
  receiptE31: number;
  receiptND: number;
  issueE31: number;
  issueND: number;
  closingStockE31: number;
  closingStockND: number;
  reportStock: number;
  reportDifference: number;
  year?: number;
  month?: number;
  status?: string;
  createdBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ImportedFile {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  importDate: Date;
  importedBy: string;
  recordCount: number;
  status: 'success' | 'error' | 'processing';
  errorMessage?: string;
}

@Component({
  selector: 'app-index',
  templateUrl: './index.component.html',
  styleUrls: ['./index.component.scss']
})
export class IndexComponent implements OnInit {
  // Properties
  totalRecords = 0;
  activeRecords = 0;
  pendingRecords = 0;
  completedRecords = 0;
  overdueRecords = 0;
  delayRecords = 0;
  
  selectedFactory = 'ASM1';
  selectedFunction = 'view';
  selectedFileType = '';
  searchTerm = '';
  yearFilter = '';
  monthFilter = '';
  statusFilter = '';
  
  years = [2023, 2024, 2025];
  months = [
    { value: 1, name: 'Tháng 1' },
    { value: 2, name: 'Tháng 2' },
    { value: 3, name: 'Tháng 3' },
    { value: 4, name: 'Tháng 4' },
    { value: 5, name: 'Tháng 5' },
    { value: 6, name: 'Tháng 6' },
    { value: 7, name: 'Tháng 7' },
    { value: 8, name: 'Tháng 8' },
    { value: 9, name: 'Tháng 9' },
    { value: 10, name: 'Tháng 10' },
    { value: 11, name: 'Tháng 11' },
    { value: 12, name: 'Tháng 12' }
  ];
  
  availableLines = ['Line 1', 'Line 2', 'Line 3', 'Line 4', 'Line 5'];
  availablePersons = ['Tuấn', 'Tình', 'Vũ', 'Phúc', 'Tú', 'Hưng', 'Toàn', 'Ninh'];
  
  isAddingIndexData = false;
  newIndexData: NVLData = {
    materialCode: '',
    openingStockE31: 0,
    openingStockND: 0,
    importE31: 0,
    importND: 0,
    receiptE31: 0,
    receiptND: 0,
    issueE31: 0,
    issueND: 0,
    closingStockE31: 0,
    closingStockND: 0,
    reportStock: 0,
    reportDifference: 0
  };
  
  indexData: NVLData[] = [];
  filteredIndexData: NVLData[] = [];
  
  showTimeRangeDialog = false;
  showDeleteDialog = false;
  showImportDialog = false;
  
  startDate: Date = new Date();
  endDate: Date = new Date();
  deleteStartDate: Date = new Date();
  deleteEndDate: Date = new Date();
  deleteFactoryFilter = '';
  deletePreviewItems: NVLData[] = [];
  isDeleting = false;
  
  firebaseSaved = false;
  isSaving = false;
  isLoading = false;
  
  // Imported files management
  importedFiles: ImportedFile[] = [];
  isLoadingFiles = false;

  constructor(
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadIndexData();
    this.calculateSummaryStats();
  }

  selectFactory(factory: string): void {
    this.selectedFactory = factory;
    this.filterData();
  }

  selectFunction(functionName: string): void {
    this.selectedFunction = functionName;
    if (functionName === 'add') {
      this.isAddingIndexData = true;
    } else {
      this.isAddingIndexData = false;
    }
    // Reset file type when switching functions
    if (functionName !== 'import') {
      this.selectedFileType = '';
    }
  }

  selectFileType(fileType: string): void {
    this.selectedFileType = fileType;
    this.loadImportedFiles(fileType);
  }

  loadImportedFiles(fileType: string): void {
    this.isLoadingFiles = true;
    // Mock data - replace with Firebase call
    setTimeout(() => {
      this.importedFiles = [
        {
          id: '1',
          fileName: 'TonDau_SXXK_Thang1_2024.xlsx',
          fileType: fileType,
          fileSize: 245760,
          importDate: new Date('2024-01-15'),
          importedBy: 'Tuấn',
          recordCount: 150,
          status: 'success'
        },
        {
          id: '2',
          fileName: 'TonDau_SXXK_Thang2_2024.xlsx',
          fileType: fileType,
          fileSize: 198432,
          importDate: new Date('2024-02-10'),
          importedBy: 'Tình',
          recordCount: 120,
          status: 'success'
        },
        {
          id: '3',
          fileName: 'TonDau_SXXK_Thang3_2024.xlsx',
          fileType: fileType,
          fileSize: 312000,
          importDate: new Date('2024-03-05'),
          importedBy: 'Vũ',
          recordCount: 200,
          status: 'error',
          errorMessage: 'Lỗi định dạng file'
        }
      ];
      this.isLoadingFiles = false;
    }, 500);
  }

  deleteImportedFile(fileId: string): void {
    if (confirm('Bạn có chắc chắn muốn xóa file này?')) {
      this.importedFiles = this.importedFiles.filter(file => file.id !== fileId);
      this.snackBar.open('Đã xóa file thành công', 'Đóng', { duration: 3000 });
      // TODO: Delete from Firebase
    }
  }

  getFileSizeDisplay(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'success': return '#4caf50';
      case 'error': return '#f44336';
      case 'processing': return '#ff9800';
      default: return '#666';
    }
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'success': return 'check_circle';
      case 'error': return 'error';
      case 'processing': return 'hourglass_empty';
      default: return 'help';
    }
  }

  getFileTypeName(fileType: string): string {
    const fileTypeNames: { [key: string]: string } = {
      'ton-dau-sxxk': 'File Tồn đầu SXXK',
      'bang-ke-xuat': 'File Bảng Kê Xuất',
      'bang-ke-nhap': 'File Bảng Kê Nhập',
      'bao-cao-ton-hien-tai': 'File Báo Cáo Tồn Kho Hiện Tại',
      'bao-cao-ton-2024': 'File Báo Cáo Tồn Kho 2024',
      'tieu-huy': 'File Tiêu Hủy',
      'cnvn': 'File CNVN'
    };
    return fileTypeNames[fileType] || 'File không xác định';
  }

  onSearchChange(): void {
    this.filterData();
  }

  onYearFilterChange(): void {
    this.filterData();
  }

  onMonthFilterChange(): void {
    this.filterData();
  }

  onStatusFilterChange(): void {
    this.filterData();
  }

  filterData(): void {
    this.filteredIndexData = this.indexData.filter(data => {
      const matchesSearch = !this.searchTerm || 
        data.materialCode.toLowerCase().includes(this.searchTerm.toLowerCase());
      
      const matchesYear = !this.yearFilter || data.year === parseInt(this.yearFilter);
      const matchesMonth = !this.monthFilter || data.month === parseInt(this.monthFilter);
      const matchesStatus = !this.statusFilter || data.status === this.statusFilter;
      
      return matchesSearch && matchesYear && matchesMonth && matchesStatus;
    });
  }

  loadIndexData(): void {
    // Mock data for NVL
    this.indexData = [
      {
        id: '1',
        materialCode: 'NVL001',
        openingStockE31: 100,
        openingStockND: 50,
        importE31: 200,
        importND: 100,
        receiptE31: 150,
        receiptND: 75,
        issueE31: 80,
        issueND: 40,
        closingStockE31: 370,
        closingStockND: 185,
        reportStock: 555,
        reportDifference: 0,
        year: 2024,
        month: 1,
        status: 'active',
        createdBy: 'Tuấn',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: '2',
        materialCode: 'NVL002',
        openingStockE31: 200,
        openingStockND: 100,
        importE31: 300,
        importND: 150,
        receiptE31: 250,
        receiptND: 125,
        issueE31: 120,
        issueND: 60,
        closingStockE31: 630,
        closingStockND: 315,
        reportStock: 945,
        reportDifference: 0,
        year: 2024,
        month: 2,
        status: 'active',
        createdBy: 'Tình',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];
    
    this.filteredIndexData = [...this.indexData];
    this.calculateSummaryStats();
  }

  calculateSummaryStats(): void {
    this.totalRecords = this.indexData.length;
    this.activeRecords = this.indexData.filter(d => d.status === 'active').length;
    this.pendingRecords = this.indexData.filter(d => d.status === 'pending').length;
    this.completedRecords = this.indexData.filter(d => d.status === 'completed').length;
    this.overdueRecords = this.indexData.filter(d => d.status === 'overdue').length;
    this.delayRecords = this.indexData.filter(d => d.status === 'delay').length;
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'active': return 'status-active';
      case 'pending': return 'status-pending';
      case 'completed': return 'status-completed';
      case 'overdue': return 'status-overdue';
      case 'delay': return 'status-delay';
      default: return 'status-active';
    }
  }

  getPriorityClass(deliveryDate: Date): string {
    if (!deliveryDate) return '';
    const today = new Date();
    const delivery = new Date(deliveryDate);
    const diffTime = delivery.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return 'priority-overdue';
    if (diffDays <= 3) return 'priority-urgent';
    if (diffDays <= 7) return 'priority-warning';
    return '';
  }

  isSelected(data: NVLData): boolean {
    return false; // Implement selection logic if needed
  }

  canEdit(): boolean {
    return true; // Implement permission logic
  }

  hasDeletePermission(): boolean {
    return true; // Implement permission logic
  }

  completeIndexData(data: NVLData): void {
    data.status = 'completed';
    data.updatedAt = new Date();
    this.updateIndexData(data, 'status', 'completed');
  }

  toggleUrgent(data: NVLData): void {
    // Implement urgent toggle logic
  }

  updateIndexData(data: NVLData, field: string, value: any): void {
    (data as any)[field] = value;
    data.updatedAt = new Date();
    // Save to Firebase here
  }

  updateIndexDataStatus(data: NVLData, status: string): void {
    this.updateIndexData(data, 'status', status);
  }

  editIndexData(data: NVLData): void {
    // Implement edit logic
    console.log('Edit data:', data);
  }

  deleteIndexData(data: NVLData): void {
    if (confirm('Bạn có chắc chắn muốn xóa dữ liệu này?')) {
      this.indexData = this.indexData.filter(d => d.id !== data.id);
      this.filteredIndexData = this.filteredIndexData.filter(d => d.id !== data.id);
      this.calculateSummaryStats();
      this.snackBar.open('Đã xóa dữ liệu thành công', 'Đóng', { duration: 3000 });
    }
  }

  addNewIndexData(): void {
    if (this.isValidIndexData()) {
      const newData: NVLData = {
        ...this.newIndexData,
        id: Date.now().toString(),
        year: new Date().getFullYear(),
        month: new Date().getMonth() + 1,
        status: 'active',
        createdBy: 'Current User',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      this.indexData.push(newData);
      this.filteredIndexData.push(newData);
      this.calculateSummaryStats();
      
      this.isAddingIndexData = false;
      this.resetForm();
      this.snackBar.open('Đã thêm dữ liệu NVL thành công', 'Đóng', { duration: 3000 });
    }
  }

  isValidIndexData(): boolean {
    return !!(
      this.newIndexData.materialCode &&
      this.newIndexData.openingStockE31 >= 0 &&
      this.newIndexData.openingStockND >= 0 &&
      this.newIndexData.importE31 >= 0 &&
      this.newIndexData.importND >= 0 &&
      this.newIndexData.receiptE31 >= 0 &&
      this.newIndexData.receiptND >= 0 &&
      this.newIndexData.issueE31 >= 0 &&
      this.newIndexData.issueND >= 0 &&
      this.newIndexData.closingStockE31 >= 0 &&
      this.newIndexData.closingStockND >= 0 &&
      this.newIndexData.reportStock >= 0 &&
      this.newIndexData.reportDifference >= 0
    );
  }

  resetForm(): void {
    this.newIndexData = {
      materialCode: '',
      openingStockE31: 0,
      openingStockND: 0,
      importE31: 0,
      importND: 0,
      receiptE31: 0,
      receiptND: 0,
      issueE31: 0,
      issueND: 0,
      closingStockE31: 0,
      closingStockND: 0,
      reportStock: 0,
      reportDifference: 0
    };
  }

  exportIndexDataByTimeRange(): void {
    // Implement export logic
    console.log('Export data by time range');
  }

  downloadTemplate(): void {
    const template = [
      ['Mã NVL', 'Tồn đầu E31', 'Tồn đầu ND', 'NK E31', 'NK ND', 'PN E31', 'PN ND', 'PX E31', 'PX ND', 'Tồn cuối E31', 'Tồn cuối ND', 'Tồn BCTK', 'SS BCTK'],
      ['NVL001', 100, 50, 200, 100, 150, 75, 80, 40, 370, 185, 555, 0],
      ['NVL002', 200, 100, 300, 150, 250, 125, 120, 60, 630, 315, 945, 0]
    ];
    
    const ws: XLSX.WorkSheet = XLSX.utils.aoa_to_sheet(template);
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'NVL_Template.xlsx');
  }

  downloadReport(): void {
    // Implement report download logic
    console.log('Download report');
  }

  showAllIndexData(): void {
    this.filteredIndexData = [...this.indexData];
  }

  goBack(): void {
    // Quay lại function view thay vì navigation
    this.selectedFunction = 'view';
    this.selectedFileType = '';
    this.isAddingIndexData = false;
  }

  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      this.isLoading = true;
      const reader = new FileReader();
      reader.onload = (e: any) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          
          // Process the data
          this.processExcelData(jsonData);
          this.isLoading = false;
        } catch (error) {
          console.error('Error reading file:', error);
          this.isLoading = false;
          this.snackBar.open('Lỗi khi đọc file Excel', 'Đóng', { duration: 3000 });
        }
      };
      reader.readAsArrayBuffer(file);
    }
  }

  processExcelData(data: any[]): void {
    if (data.length < 2) {
      this.snackBar.open('File không có dữ liệu hợp lệ', 'Đóng', { duration: 3000 });
      return;
    }

    const headers = data[0];
    const rows = data.slice(1);
    
    const newData: NVLData[] = rows.map((row: any, index: number) => ({
      id: Date.now().toString() + index,
      materialCode: row[0] || '',
      openingStockE31: Number(row[1]) || 0,
      openingStockND: Number(row[2]) || 0,
      importE31: Number(row[3]) || 0,
      importND: Number(row[4]) || 0,
      receiptE31: Number(row[5]) || 0,
      receiptND: Number(row[6]) || 0,
      issueE31: Number(row[7]) || 0,
      issueND: Number(row[8]) || 0,
      closingStockE31: Number(row[9]) || 0,
      closingStockND: Number(row[10]) || 0,
      reportStock: Number(row[11]) || 0,
      reportDifference: Number(row[12]) || 0,
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
      status: 'active',
      createdBy: 'Imported',
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    this.indexData.push(...newData);
    this.filteredIndexData.push(...newData);
    this.calculateSummaryStats();
    
    // Add imported file to the list
    const importedFile: ImportedFile = {
      id: Date.now().toString(),
      fileName: `Imported_${this.selectedFileType}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      fileType: this.selectedFileType,
      fileSize: 245760, // Mock size
      importDate: new Date(),
      importedBy: 'Current User',
      recordCount: newData.length,
      status: 'success'
    };
    
    this.importedFiles.unshift(importedFile); // Add to beginning of list
    
    this.firebaseSaved = true;
    setTimeout(() => {
      this.firebaseSaved = false;
    }, 3000);
    
    this.snackBar.open(`Đã import ${newData.length} dòng dữ liệu thành công`, 'Đóng', { duration: 3000 });
  }

  closeImportDialog(): void {
    this.showImportDialog = false;
  }

  previewDeleteItems(): void {
    // Implement delete preview logic
    console.log('Preview delete items');
  }

  deleteIndexDataByTimeRange(): void {
    // Implement delete by time range logic
    console.log('Delete data by time range');
  }
} 