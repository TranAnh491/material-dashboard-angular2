import { Component, OnInit } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { PermissionService } from '../../services/permission.service';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import * as XLSX from 'xlsx';

interface ScheduleItem {
  nam?: string;
  thang?: string;
  stt?: string;
  sizePhoi?: string;
  maTem?: string;
  soLuongYeuCau?: string;
  soLuongPhoi?: string;
  maHang?: string;
  lenhSanXuat?: string;
  khachHang?: string;
  ngayNhanKeHoach?: string;
  yy?: string;
  ww?: string;
  lineNhan?: string;
  nguoiIn?: string;
  tinhTrang?: string;
  statusUpdateTime?: Date;
  banVe?: string;
  ghiChu?: string;
  isUrgent?: boolean;
  isCompleted?: boolean;
  labelComparison?: {
    comparisonResult?: 'Pass' | 'Fail' | 'Chờ in' | 'Completed';
    comparedAt?: Date;
    matchPercentage?: number;
    mismatchDetails?: string[];
  };
}

@Component({
  selector: 'app-print-label',
  templateUrl: './print-label.component.html',
  styleUrls: ['./print-label.component.scss']
})
export class PrintLabelComponent implements OnInit {

  selectedFunction: string | null = null;
  scheduleData: ScheduleItem[] = [];
  firebaseSaved: boolean = false;
  isSaving: boolean = false;
  isLoading: boolean = false;

  // Authentication properties
  isAuthenticated: boolean = false;
  currentEmployeeId: string = '';
  currentPassword: string = '';
  loginError: string = '';

  // Additional properties for HTML template
  showLoginDialog: boolean = false;
  currentUserDepartment: string = '';
  currentUserId: string = '';

  // Time range properties
  selectedDays: number = 30;
  customStartDate: Date | null = null;
  customEndDate: Date | null = null;
  showTimeDialog: boolean = false;

  // Search and filter properties
  searchTerm: string = '';
  showCompletedItems: boolean = true;
  currentStatusFilter: string = '';

  // Delete dialog properties
  showDeleteDialog: boolean = false;
  deleteDialogMessage: string = '';
  deleteCode: string = '';
  deletePassword: string = '';
  currentDeleteAction: 'clearData' | 'deleteCompleted' | 'freshImport' | 'deleteOldData' | 'deleteCurrentData' = 'clearData';

  // Cleanup properties
  private subscriptions: any[] = [];
  private timers: any[] = [];

  constructor(
    private firestore: AngularFirestore,
    private permissionService: PermissionService,
    private auth: AngularFireAuth
  ) { }

  ngOnInit(): void {
    console.log('🚀 PrintLabelComponent initialized');
    
    // Auto-select print function
    this.selectedFunction = 'print';
    
    // Check if mobile device
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (isMobile) {
      // Mobile loading with delay
      setTimeout(() => {
        this.loadDataFromFirebase();
        this.refreshStorageInfo();
        this.autoHandleDocumentSizeLimit();
      }, 1000);
    } else {
      // Desktop loading
      this.loadDataFromFirebase();
      this.refreshStorageInfo();
      this.autoHandleDocumentSizeLimit();
    }
  }

  ngOnDestroy(): void {
    // Cleanup subscriptions and timers
    this.cleanupSubscriptions();
    this.cleanupTimers();
  }

  // Cleanup methods
  private cleanupSubscriptions(): void {
    this.subscriptions.forEach(sub => {
      if (sub && typeof sub.unsubscribe === 'function') {
        sub.unsubscribe();
      }
    });
    this.subscriptions = [];
  }

  private cleanupTimers(): void {
    this.timers.forEach(timer => {
      if (timer) {
        clearTimeout(timer);
        clearInterval(timer);
      }
    });
    this.timers = [];
  }

  // File import functionality
  triggerFileImport(): void {
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) {
      fileInput.click();
    }
  }

  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      this.importExcelFile(file);
    }
  }

  async importExcelFile(file: File): Promise<void> {
    console.log('📁 Importing Excel file:', file.name);
    
    const reader = new FileReader();
    reader.onload = async (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        // Process data
        const cleanedData = this.cleanExcelData(jsonData);
        console.log('📊 Cleaned Excel data:', cleanedData);
        
        if (cleanedData.length === 0) {
          alert('❌ Không có dữ liệu hợp lệ trong file Excel!\n\nVui lòng kiểm tra:\n- File có đúng format không\n- Có dữ liệu trong các dòng không\n- Cột "MaTem" có dữ liệu không');
          return;
        }
        
        // REPLACE all data (clear existing and add new)
        this.scheduleData = cleanedData;
        
        // Save to Firebase (this will replace all data)
        await this.saveToFirebase(this.scheduleData);
        
        const message = `✅ Successfully imported ${cleanedData.length} records from ${file.name} and REPLACED all existing data. Total: ${this.scheduleData.length} records 🔥`;
        alert(message);
        
      } catch (error) {
        console.error('❌ Error importing file:', error);
        alert('❌ Error importing file: ' + error.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  private cleanExcelData(data: any[]): ScheduleItem[] {
    const headers = data[0];
    const rows = data.slice(1);
    
    return rows.map((row: any[], index: number) => {
      const item: ScheduleItem = {};
      headers.forEach((header: string, colIndex: number) => {
        const value = row[colIndex];
        const cleanHeader = header?.toString().trim().toLowerCase();
        
        switch (cleanHeader) {
          case 'nam': item.nam = value?.toString() || ''; break;
          case 'thang': item.thang = value?.toString() || ''; break;
          case 'stt': item.stt = value?.toString() || ''; break;
          case 'sizephoi': item.sizePhoi = value?.toString() || ''; break;
          case 'matem': item.maTem = value?.toString() || ''; break;
          case 'soluongyeucau': item.soLuongYeuCau = value?.toString() || ''; break;
          case 'soluongphoi': item.soLuongPhoi = value?.toString() || ''; break;
          case 'mahang': item.maHang = value?.toString() || ''; break;
          case 'lenhsanxuat': item.lenhSanXuat = value?.toString() || ''; break;
          case 'khachhang': item.khachHang = value?.toString() || ''; break;
          case 'ngaynhan': item.ngayNhanKeHoach = value?.toString() || ''; break;
          case 'yy': item.yy = value?.toString() || ''; break;
          case 'ww': item.ww = value?.toString() || ''; break;
          case 'linenhan': item.lineNhan = value?.toString() || ''; break;
          case 'nguoiin': item.nguoiIn = value?.toString() || ''; break;
          case 'tinhtrang': item.tinhTrang = value?.toString() || 'Chờ in'; break;
          case 'banve': item.banVe = value?.toString() || ''; break;
          case 'ghichu': item.ghiChu = value?.toString() || ''; break;
        }
      });
      
      item.statusUpdateTime = new Date();
      return item;
    }).filter(item => item.maTem && item.maTem.trim() !== '');
  }

  // Firebase operations - Improved structure like work orders
  async saveToFirebase(data: ScheduleItem[]): Promise<void> {
    console.log('🔥 Saving label data to Firebase...');
    
    if (data.length === 0) {
      console.log('No data to save');
      return;
    }

    try {
      // FIRST: Delete all existing data
      console.log('🗑️ Deleting all existing data first...');
      const existingSnapshot = await this.firestore.collection('print-schedules').get().toPromise();
      
      if (existingSnapshot && !existingSnapshot.empty) {
        const deleteBatch = this.firestore.firestore.batch();
        existingSnapshot.docs.forEach(doc => {
          deleteBatch.delete(doc.ref);
        });
        await deleteBatch.commit();
        console.log(`🗑️ Deleted ${existingSnapshot.docs.length} existing documents`);
      }

      // THEN: Add new data with clear structure like work orders
      console.log('➕ Adding new data with clear structure...');
      
      const labelScheduleDoc = {
        data: data,
        importedAt: new Date(),
        month: this.getCurrentMonth(),
        year: new Date().getFullYear(),
        recordCount: data.length,
        lastUpdated: new Date(),
        importHistory: [
          {
            importedAt: new Date(),
            recordCount: data.length,
            month: this.getCurrentMonth(),
            year: new Date().getFullYear(),
            description: `Import ${data.length} label schedules`
          }
        ],
        // Additional metadata for clarity
        collectionType: 'print-schedules',
        version: '1.0',
        status: 'active'
      };

      console.log('📤 Attempting to save label schedule data:', {
        recordCount: labelScheduleDoc.recordCount,
        month: labelScheduleDoc.month,
        year: labelScheduleDoc.year,
        timestamp: labelScheduleDoc.importedAt
      });

      // Add timeout to Firebase save
      const savePromise = this.firestore.collection('print-schedules').add(labelScheduleDoc);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Firebase save timeout after 15 seconds')), 15000)
      );

      await Promise.race([savePromise, timeoutPromise]);
      
      this.firebaseSaved = true;
      console.log(`✅ Saved ${data.length} records to Firebase with clear structure`);
      alert(`✅ Đã lưu thành công ${data.length} bản ghi vào Firebase!\n\nCấu trúc dữ liệu rõ ràng như work orders.`);
      
    } catch (error) {
      console.error('❌ Error saving to Firebase:', error);
      alert('❌ Error saving to Firebase: ' + error.message);
    }
  }

  loadDataFromFirebase(): void {
    console.log('🔥 Loading data from Firebase...');
    
    // Use the new collection name with clear structure
    this.firestore.collection('print-schedules', ref => 
      ref.orderBy('importedAt', 'desc')
    ).get().subscribe((querySnapshot) => {
      const allData: ScheduleItem[] = [];
      
      console.log(`🔍 Found ${querySnapshot.docs.length} documents in print-schedules collection`);
      
      querySnapshot.forEach((doc) => {
        const data = doc.data() as any;
        console.log(`📄 Document ${doc.id}:`, {
          hasData: !!data.data,
          dataLength: data.data ? data.data.length : 0,
          month: data.month,
          year: data.year,
          importedAt: data.importedAt,
          recordCount: data.recordCount,
          collectionType: data.collectionType
        });
        
        // New clear structure: { data: [...], metadata }
        if (data.data && Array.isArray(data.data)) {
          const items = data.data
            .filter((item: any) => {
              // Filter out Done items
              const status = item.tinhTrang?.toLowerCase();
              return status !== 'done' && status !== 'completed';
            })
            .map((item: any) => ({
              ...item,
              isCompleted: false, // Since we filtered out Done items
              // Add document metadata for tracking
              documentId: doc.id,
              importedAt: data.importedAt,
              month: data.month,
              year: data.year
            }));
          allData.push(...items);
        }
      });
      
      this.scheduleData = allData;
      this.firebaseSaved = this.scheduleData.length > 0;
      console.log(`🔥 Loaded ${this.scheduleData.length} records from Firebase (Done items filtered out)`);
      console.log('📊 Schedule data sample:', this.scheduleData.slice(0, 3));
      
      if (this.scheduleData.length > 0) {
        const uniqueMaTem = [...new Set(this.scheduleData.map(item => item.maTem))];
        console.log(`📊 Summary: ${this.scheduleData.length} total items (Done items excluded), ${uniqueMaTem.length} unique mã tem`);
      } else {
        console.log('⚠️ No data found in Firebase collection "print-schedules" (after filtering Done items)');
        console.log('🔍 Available documents:', querySnapshot.docs.length);
      }
    }, error => {
      console.error('❌ Error loading from Firebase:', error);
    });
  }

  // Template download
  downloadTemplate(): void {
    console.log('Download Template clicked');
    
    const templateData = [
      ['Nam', 'Thang', 'STT', 'SizePhoi', 'MaTem', 'SoLuongYeuCau', 'SoLuongPhoi', 'MaHang', 'LenhSanXuat', 'KhachHang', 'NgayNhan', 'YY', 'WW', 'LineNhan', 'NguoiIn', 'TinhTrang', 'BanVe', 'GhiChu'],
      ['2025', '7', '1', 'A4', 'TEMP001', '100', '100', 'HANG001', 'LSX001', 'Khach Hang A', '2025-07-18', '25', '29', 'Line1', 'Nguoi In A', 'Chờ in', 'Ban ve A', 'Ghi chu mau']
    ];

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(templateData);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Template');

    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'template-lich-in-tem-2025-07-18.xlsx';
    link.click();
    URL.revokeObjectURL(url);
    
    alert('Excel template file downloaded successfully!');
  }

  // Export functionality
  exportExcel(): void {
    if (this.scheduleData.length === 0) {
      alert('No data to export');
      return;
    }

    const currentData = this.getFilteredData();
    const currentMonth = new Date().getMonth() + 1;
    const monthName = this.getMonthName(currentMonth.toString().padStart(2, '0'));
    
    const exportData = [
      ['Nam', 'Thang', 'STT', 'SizePhoi', 'MaTem', 'SoLuongYeuCau', 'SoLuongPhoi', 'MaHang', 'LenhSanXuat', 'KhachHang', 'NgayNhan', 'YY', 'WW', 'LineNhan', 'NguoiIn', 'TinhTrang', 'BanVe', 'GhiChu'],
      ...currentData.map(item => [
        item.nam || '',
        item.thang || '',
        item.stt || '',
        item.sizePhoi || '',
        item.maTem || '',
        item.soLuongYeuCau || '',
        item.soLuongPhoi || '',
        item.maHang || '',
        item.lenhSanXuat || '',
        item.khachHang || '',
        item.ngayNhanKeHoach || '',
        item.yy || '',
        item.ww || '',
        item.lineNhan || '',
        item.nguoiIn || '',
        item.tinhTrang || '',
        item.banVe || '',
        item.ghiChu || ''
      ])
    ];

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(exportData);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Print Schedule');

    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `print_schedule_${currentMonth}_${monthName}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
    
    alert(`Exported ${currentData.length} records for ${monthName} successfully!`);
  }

  // Delete functionality
  showDeleteOldDataDialog(): void {
    const currentYear = new Date().getFullYear();
    
    let monthOptions = '';
    for (let i = 1; i <= 12; i++) {
      const monthName = this.getMonthName(i.toString().padStart(2, '0'));
      monthOptions += `${i}. ${monthName} ${currentYear}\n`;
    }
    
    const selectedMonth = prompt(`Chọn tháng để xóa dữ liệu cũ:\n\n${monthOptions}\nNhập số tháng (1-12):`);
    
    if (selectedMonth && !isNaN(Number(selectedMonth))) {
      const month = parseInt(selectedMonth);
      if (month >= 1 && month <= 12) {
        const monthName = this.getMonthName(month.toString().padStart(2, '0'));
        const confirmMessage = `Bạn có chắc chắn muốn xóa dữ liệu của tháng ${monthName} ${currentYear}?\n\nHành động này không thể hoàn tác!`;
        
        if (confirm(confirmMessage)) {
          this.deleteDataByMonth(month, currentYear);
        }
      } else {
        alert('Vui lòng chọn tháng từ 1 đến 12!');
      }
    }
  }

  showDeleteCurrentDataDialog(): void {
    const confirmMessage = 'Bạn có chắc chắn muốn xóa dữ liệu hiện tại để import lại mới?\n\nTất cả dữ liệu hiện tại sẽ bị mất và bạn cần import lại từ đầu!';
    
    if (confirm(confirmMessage)) {
      this.deleteCurrentDataAndPrepareForImport();
    }
  }

  async deleteDataByMonth(month: number, year: number): Promise<void> {
    try {
      console.log(`🗑️ Deleting data for month ${month}/${year}...`);
      
      // Use new collection name
      const snapshot = await this.firestore.collection('print-schedules').get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        alert(`ℹ️ Không tìm thấy dữ liệu nào của tháng ${month}/${year}!`);
        return;
      }
      
      let deletedCount = 0;
      let totalItemsDeleted = 0;
      const batch = this.firestore.firestore.batch();
      const documentsToDelete: any[] = [];
      
      snapshot.forEach((doc: any) => {
        const data = doc.data();
        console.log(`🔍 Checking document ${doc.id}:`, {
          month: data.month,
          year: data.year,
          recordCount: data.recordCount
        });
        
        // Check both month/year fields and importedAt field for compatibility
        if ((data.month === month && data.year === year) || 
            (data['importedAt'] && data['importedAt'].toDate)) {
          
          if (data['importedAt'] && data['importedAt'].toDate) {
            const importedAt = data['importedAt'].toDate();
            const docMonthPattern = `${importedAt.getFullYear()}-${(importedAt.getMonth() + 1).toString().padStart(2, '0')}`;
            const targetPattern = `${year}-${month.toString().padStart(2, '0')}`;
            
            if (docMonthPattern === targetPattern) {
              batch.delete(doc.ref);
              deletedCount++;
              totalItemsDeleted += data.recordCount || 0;
              documentsToDelete.push({
                id: doc.id,
                recordCount: data.recordCount,
                month: data.month,
                year: data.year
              });
            }
          } else if (data.month === month && data.year === year) {
            batch.delete(doc.ref);
            deletedCount++;
            totalItemsDeleted += data.recordCount || 0;
            documentsToDelete.push({
              id: doc.id,
              recordCount: data.recordCount,
              month: data.month,
              year: data.year
            });
          }
        }
      });
      
      if (deletedCount > 0) {
        await batch.commit();
        console.log(`✅ Deleted ${deletedCount} documents with ${totalItemsDeleted} total items for ${month}/${year}`);
        console.log('📄 Deleted documents:', documentsToDelete);
        alert(`✅ Đã xóa thành công!\n\n- ${deletedCount} documents\n- ${totalItemsDeleted} bản ghi\n- Tháng ${month}/${year}`);
        this.loadDataFromFirebase();
      } else {
        alert(`ℹ️ Không tìm thấy dữ liệu nào của tháng ${month}/${year}!`);
      }
      
    } catch (error) {
      console.error('❌ Error deleting data by month:', error);
      alert(`❌ Lỗi khi xóa dữ liệu: ${error.message}`);
    }
  }

  async deleteCurrentDataAndPrepareForImport(): Promise<void> {
    try {
      console.log('🗑️ Deleting current data and preparing for fresh import...');
      
      // Use new collection name
      const snapshot = await this.firestore.collection('print-schedules').get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        alert('ℹ️ Không có dữ liệu nào để xóa!');
        return;
      }
      
      let totalItems = 0;
      const documentsToDelete: any[] = [];
      
      // Count total items before deletion
      snapshot.forEach((doc: any) => {
        const data = doc.data();
        totalItems += data.recordCount || 0;
        documentsToDelete.push({
          id: doc.id,
          recordCount: data.recordCount,
          month: data.month,
          year: data.year
        });
      });
      
      const batch = this.firestore.firestore.batch();
      snapshot.forEach((doc: any) => {
        batch.delete(doc.ref);
      });
      
      await batch.commit();
      
      console.log(`✅ Deleted ${snapshot.docs.length} documents with ${totalItems} total items`);
      console.log('📄 Deleted documents:', documentsToDelete);
      alert(`✅ Đã xóa thành công!\n\n- ${snapshot.docs.length} documents\n- ${totalItems} bản ghi\n\nBây giờ bạn có thể import dữ liệu mới.`);
      
      this.scheduleData = [];
      
      setTimeout(() => {
        this.triggerFileImport();
      }, 1000);
      
    } catch (error) {
      console.error('❌ Error deleting current data:', error);
      alert(`❌ Lỗi khi xóa dữ liệu hiện tại: ${error.message}`);
    }
  }

  // Utility methods
  getCurrentMonth(): string {
    const now = new Date();
    return (now.getMonth() + 1).toString().padStart(2, '0');
  }

  getMonthName(monthKey: string): string {
    const months = {
      '01': 'January', '02': 'February', '03': 'March', '04': 'April',
      '05': 'May', '06': 'June', '07': 'July', '08': 'August',
      '09': 'September', '10': 'October', '11': 'November', '12': 'December'
    };
    const monthNumber = monthKey.split('-')[1];
    return months[monthNumber as keyof typeof months] || 'Unknown';
  }

  getFilteredData(): ScheduleItem[] {
    let filtered = [...this.scheduleData];
    console.log('🔍 Initial data count:', this.scheduleData.length);
    
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(item => 
        item.maTem?.toLowerCase().includes(term) ||
        item.maHang?.toLowerCase().includes(term) ||
        item.khachHang?.toLowerCase().includes(term) ||
        item.nguoiIn?.toLowerCase().includes(term)
      );
      console.log('🔍 After search filter:', filtered.length);
    }
    
    if (this.currentStatusFilter) {
      filtered = filtered.filter(item => item.tinhTrang === this.currentStatusFilter);
      console.log('🔍 After status filter:', filtered.length);
    }
    
    // Note: Done items are already filtered out at Firebase level
    // No need to filter again here
    
    console.log('🔍 Final filtered count:', filtered.length);
    return filtered;
  }

  getDisplayScheduleData(): ScheduleItem[] {
    // Return filtered data for display
    return this.getFilteredData();
  }

  formatNumberForDisplay(value: any): string {
    if (value === null || value === undefined || value === '') {
      return '';
    }
    
    // Convert to number if it's a string
    const num = typeof value === 'string' ? parseFloat(value) : value;
    
    // Check if it's a valid number
    if (isNaN(num)) {
      return value.toString();
    }
    
    // Format as integer if it's a whole number, otherwise keep as is
    return num % 1 === 0 ? num.toString() : num.toString();
  }

  // Status count methods
  getIQCItemsCount(): number {
    return this.scheduleData.filter(item => item.tinhTrang === 'IQC').length;
  }

  getLateItemsCount(): number {
    return this.scheduleData.filter(item => item.tinhTrang === 'Late').length;
  }

  getPassItemsCount(): number {
    return this.scheduleData.filter(item => item.tinhTrang === 'Pass').length;
  }

  getNGItemsCount(): number {
    return this.scheduleData.filter(item => item.tinhTrang === 'NG').length;
  }

  getPendingItemsCount(): number {
    return this.scheduleData.filter(item => item.tinhTrang === 'Chờ in').length;
  }

  getChoBanVeItemsCount(): number {
    return this.scheduleData.filter(item => item.tinhTrang === 'Chờ bản vẽ').length;
  }

  getChoTemplateItemsCount(): number {
    return this.scheduleData.filter(item => item.tinhTrang === 'Chờ Template').length;
  }

  getNotDoneItemsCount(): number {
    return this.scheduleData.filter(item => item.tinhTrang !== 'Done').length;
  }

  // Filter methods
  filterByStatus(status: string): void {
    this.currentStatusFilter = this.currentStatusFilter === status ? '' : status;
  }

  clearStatusFilter(): void {
    this.currentStatusFilter = '';
  }

  onSearchChange(event: any): void {
    this.searchTerm = event.target.value;
  }

  toggleShowCompletedItems(): void {
    this.showCompletedItems = !this.showCompletedItems;
  }

  refreshDisplay(): void {
    this.loadDataFromFirebase();
  }

  // Placeholder methods for compatibility
  refreshStorageInfo(): void {
    // Placeholder for storage info
  }

  autoHandleDocumentSizeLimit(): void {
    // Placeholder for document size handling
  }

  // Missing methods for HTML template
  showDoneItemsList(): void {
    console.log('Show done items list clicked');
    
    const doneItems = this.scheduleData.filter(item => item.tinhTrang === 'Done');
    
    if (doneItems.length === 0) {
      alert('Không có mã nào đã hoàn thành (Done) để tải xuống!\n\nLưu ý: Tất cả mã có tình trạng "Done" đã được ẩn khỏi danh sách.');
      return;
    }
    
    const currentMonth = new Date().getMonth() + 1;
    const monthName = this.getMonthName(currentMonth.toString().padStart(2, '0'));
    
    const exportData = [
      ['Nam', 'Thang', 'STT', 'SizePhoi', 'MaTem', 'SoLuongYeuCau', 'SoLuongPhoi', 'MaHang', 'LenhSanXuat', 'KhachHang', 'NgayNhan', 'YY', 'WW', 'LineNhan', 'NguoiIn', 'TinhTrang', 'BanVe', 'GhiChu'],
      ...doneItems.map(item => [
        item.nam || '',
        item.thang || '',
        item.stt || '',
        item.sizePhoi || '',
        item.maTem || '',
        item.soLuongYeuCau || '',
        item.soLuongPhoi || '',
        item.maHang || '',
        item.lenhSanXuat || '',
        item.khachHang || '',
        item.ngayNhanKeHoach || '',
        item.yy || '',
        item.ww || '',
        item.lineNhan || '',
        item.nguoiIn || '',
        item.tinhTrang || '',
        item.banVe || '',
        item.ghiChu || ''
      ])
    ];

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(exportData);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Done Items');

    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `done_items_${currentMonth}_${monthName}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
    
    alert(`Đã tải xuống ${doneItems.length} mã đã hoàn thành (Done) thành công!`);
  }

  // Table interaction methods
  canEditField(fieldName: string): boolean {
    // Allow editing for all fields
    return true;
  }

  onFieldChange(item: ScheduleItem, fieldName: string): void {
    console.log(`Field ${fieldName} changed for item:`, item.maTem);
    item.statusUpdateTime = new Date();
    
    // Save to Firebase
    this.saveToFirebase(this.scheduleData);
  }

  deleteItem(item: ScheduleItem): void {
    if (confirm(`Bạn có chắc chắn muốn xóa mã tem "${item.maTem}"?`)) {
      const index = this.scheduleData.indexOf(item);
      if (index > -1) {
        this.scheduleData.splice(index, 1);
        this.saveToFirebase(this.scheduleData);
        console.log(`Deleted item: ${item.maTem}`);
      }
    }
  }

  onNoteBlur(item: ScheduleItem, event: any): void {
    console.log('Note blur for item:', item.maTem);
    item.statusUpdateTime = new Date();
    this.saveToFirebase(this.scheduleData);
  }

  onNoteKeyPress(event: KeyboardEvent, item: ScheduleItem): void {
    if (event.key === 'Enter') {
      console.log('Note saved on Enter for item:', item.maTem);
      item.statusUpdateTime = new Date();
      this.saveToFirebase(this.scheduleData);
      (event.target as HTMLInputElement).blur();
    }
  }

  onNoteChange(item: ScheduleItem): void {
    // Real-time update
    item.statusUpdateTime = new Date();
  }

  // Additional missing methods
  toggleUrgent(item: ScheduleItem): void {
    console.log('Toggle urgent for item:', item.maTem);
    // Toggle urgent status
  }

  closeDeleteDialog(): void {
    console.log('Close delete dialog');
    // Close delete dialog logic
  }

  confirmDelete(): void {
    console.log('Confirm delete');
    // Confirm delete logic
  }

  cancelLogin(): void {
    console.log('Cancel login');
    this.showLoginDialog = false;
  }

  authenticateUser(): void {
    console.log('Authenticate user');
    // Authentication logic
    this.showLoginDialog = false;
  }

  // Method to test delete old data functionality
  testDeleteOldData(): void {
    console.log('🧪 Testing delete old data functionality...');
    
    // First, let's check what data structure we have
    this.firestore.collection('print-schedules').get().subscribe((querySnapshot) => {
      console.log('🔍 Current Firebase data structure:');
      console.log(`   - Total documents: ${querySnapshot.docs.length}`);
      
      querySnapshot.docs.forEach((doc, index) => {
        if (index < 3) { // Only show first 3 documents
          const data = doc.data() as any;
          console.log(`   - Document ${index + 1}:`, {
            id: doc.id,
            hasImportedAt: !!data['importedAt'],
            importedAt: data['importedAt'],
            hasData: !!data['data'],
            dataLength: data['data'] ? data['data'].length : 0,
            month: data.month,
            year: data.year,
            recordCount: data.recordCount,
            collectionType: data.collectionType,
            keys: Object.keys(data)
          });
        }
      });
      
      // Test delete for current month
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth() + 1;
      const currentYear = currentDate.getFullYear();
      
      console.log(`🧪 Testing delete for current month: ${currentMonth}/${currentYear}`);
      
      // Ask user if they want to proceed with test delete
      const confirmTest = confirm(`🧪 Test Delete Old Data\n\n` +
        `Found ${querySnapshot.docs.length} documents in Firebase.\n\n` +
        `Do you want to test delete data for current month ${currentMonth}/${currentYear}?\n\n` +
        `This will show you what would be deleted without actually deleting.`);
      
      if (confirmTest) {
        this.testDeleteByMonth(currentMonth, currentYear);
      }
    });
  }

  async testDeleteByMonth(month: number, year: number): Promise<void> {
    try {
      console.log(`🧪 Testing delete for month ${month}/${year}...`);
      
      const snapshot = await this.firestore.collection('print-schedules').get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        console.log('🧪 No documents found in Firebase');
        alert('🧪 No documents found in Firebase');
        return;
      }
      
      let wouldDeleteCount = 0;
      let totalItemsToDelete = 0;
      const wouldDeleteDocs: any[] = [];
      
      snapshot.forEach((doc: any) => {
        const data = doc.data();
        console.log(`🧪 Checking document:`, {
          id: doc.id,
          month: data.month,
          year: data.year,
          recordCount: data.recordCount,
          importedAt: data['importedAt'],
          hasImportedAt: !!data['importedAt']
        });
        
        // Check both new structure (month/year fields) and old structure (importedAt)
        let shouldDelete = false;
        
        if (data.month === month && data.year === year) {
          shouldDelete = true;
        } else if (data['importedAt'] && data['importedAt'].toDate) {
          const importedAt = data['importedAt'].toDate();
          const docMonthPattern = `${importedAt.getFullYear()}-${(importedAt.getMonth() + 1).toString().padStart(2, '0')}`;
          const targetPattern = `${year}-${month.toString().padStart(2, '0')}`;
          
          console.log(`🧪 Document ${doc.id}: ${docMonthPattern} vs ${targetPattern}`);
          
          if (docMonthPattern === targetPattern) {
            shouldDelete = true;
          }
        }
        
        if (shouldDelete) {
          wouldDeleteCount++;
          totalItemsToDelete += data.recordCount || 0;
          wouldDeleteDocs.push({
            id: doc.id,
            month: data.month,
            year: data.year,
            recordCount: data.recordCount,
            importedAt: data['importedAt']
          });
        }
      });
      
      console.log(`🧪 Test Results:`);
      console.log(`   - Would delete ${wouldDeleteCount} documents`);
      console.log(`   - Would delete ${totalItemsToDelete} total items`);
      console.log(`   - Documents to delete:`, wouldDeleteDocs);
      
      if (wouldDeleteCount > 0) {
        const confirmDelete = confirm(`🧪 Test Delete Results\n\n` +
          `Would delete ${wouldDeleteCount} documents with ${totalItemsToDelete} total items for ${month}/${year}:\n\n` +
          wouldDeleteDocs.map(doc => 
            `- ${doc.id}: ${doc.recordCount} items (${doc.month}/${doc.year})`
          ).join('\n') + '\n\n' +
          `Do you want to actually delete these documents?`);
        
        if (confirmDelete) {
          // Actually delete
          const batch = this.firestore.firestore.batch();
          wouldDeleteDocs.forEach(docInfo => {
            const docRef = this.firestore.collection('print-schedules').doc(docInfo.id).ref;
            batch.delete(docRef);
          });
          
          await batch.commit();
          console.log(`✅ Actually deleted ${wouldDeleteCount} documents with ${totalItemsToDelete} items`);
          alert(`✅ Actually deleted ${wouldDeleteCount} documents with ${totalItemsToDelete} items for ${month}/${year}!`);
          
          // Reload data
          this.loadDataFromFirebase();
        } else {
          console.log('🧪 Test delete cancelled by user');
          alert('🧪 Test delete cancelled - no data was actually deleted');
        }
      } else {
        console.log('🧪 No documents would be deleted for this month');
        alert(`🧪 No documents would be deleted for ${month}/${year}\n\n` +
              `This could mean:\n` +
              `- No data exists for this month\n` +
              `- Data doesn't have month/year or importedAt fields\n` +
              `- Field format is different`);
      }
      
    } catch (error) {
      console.error('❌ Error in test delete:', error);
      alert(`❌ Error in test delete: ${error.message}`);
    }
  }

  // Method to test Done items hiding functionality
  testDoneItemsHiding(): void {
    console.log('🧪 Testing Done items hiding functionality...');
    
    // Create test data with different statuses
    const testData: ScheduleItem[] = [
      {
        nam: '2025',
        thang: '1',
        stt: '1',
        sizePhoi: '40x25',
        maTem: 'DONE001',
        soLuongYeuCau: '100',
        soLuongPhoi: '100',
        maHang: 'DONE-HANG',
        lenhSanXuat: 'LSX001',
        khachHang: 'Test Customer',
        ngayNhanKeHoach: '2025-01-15',
        yy: '25',
        ww: '03',
        lineNhan: 'L1',
        nguoiIn: 'Test User',
        tinhTrang: 'Done', // This should be hidden
        statusUpdateTime: new Date(),
        banVe: 'BV001',
        ghiChu: 'Done item - should be hidden',
        isUrgent: false,
        isCompleted: true
      },
      {
        nam: '2025',
        thang: '1',
        stt: '2',
        sizePhoi: '50x30',
        maTem: 'PENDING001',
        soLuongYeuCau: '200',
        soLuongPhoi: '200',
        maHang: 'PENDING-HANG',
        lenhSanXuat: 'LSX002',
        khachHang: 'Test Customer 2',
        ngayNhanKeHoach: '2025-01-16',
        yy: '25',
        ww: '03',
        lineNhan: 'L2',
        nguoiIn: 'Test User 2',
        tinhTrang: 'Chờ in', // This should be visible
        statusUpdateTime: new Date(),
        banVe: 'BV002',
        ghiChu: 'Pending item - should be visible',
        isUrgent: false,
        isCompleted: false
      },
      {
        nam: '2025',
        thang: '1',
        stt: '3',
        sizePhoi: '60x35',
        maTem: 'IQC001',
        soLuongYeuCau: '300',
        soLuongPhoi: '300',
        maHang: 'IQC-HANG',
        lenhSanXuat: 'LSX003',
        khachHang: 'Test Customer 3',
        ngayNhanKeHoach: '2025-01-17',
        yy: '25',
        ww: '03',
        lineNhan: 'L3',
        nguoiIn: 'Test User 3',
        tinhTrang: 'IQC', // This should be visible
        statusUpdateTime: new Date(),
        banVe: 'BV003',
        ghiChu: 'IQC item - should be visible',
        isUrgent: false,
        isCompleted: false
      },
      {
        nam: '2025',
        thang: '1',
        stt: '4',
        sizePhoi: '70x40',
        maTem: 'DONE002',
        soLuongYeuCau: '400',
        soLuongPhoi: '400',
        maHang: 'DONE-HANG2',
        lenhSanXuat: 'LSX004',
        khachHang: 'Test Customer 4',
        ngayNhanKeHoach: '2025-01-18',
        yy: '25',
        ww: '03',
        lineNhan: 'L4',
        nguoiIn: 'Test User 4',
        tinhTrang: 'done', // This should be hidden (lowercase)
        statusUpdateTime: new Date(),
        banVe: 'BV004',
        ghiChu: 'Done item (lowercase) - should be hidden',
        isUrgent: false,
        isCompleted: true
      }
    ];

    console.log('🧪 Test data created:', testData);
    console.log('🧪 Expected behavior:');
    console.log('   - DONE001 (Done) - should be HIDDEN');
    console.log('   - PENDING001 (Chờ in) - should be VISIBLE');
    console.log('   - IQC001 (IQC) - should be VISIBLE');
    console.log('   - DONE002 (done) - should be HIDDEN');
    
    // Save test data to Firebase
    this.saveToFirebase(testData);
    
    // Test load from Firebase after a delay
    setTimeout(() => {
      console.log('🧪 Testing load after save...');
      this.loadDataFromFirebase();
      
      // Check results after another delay
      setTimeout(() => {
        console.log('🧪 Final check - scheduleData after filtering:');
        console.log('   - Total items loaded:', this.scheduleData.length);
        console.log('   - Items that should be visible:', this.scheduleData.map(item => `${item.maTem} (${item.tinhTrang})`));
        
        const expectedVisible = ['PENDING001', 'IQC001'];
        const actualVisible = this.scheduleData.map(item => item.maTem);
        
        const allExpectedVisible = expectedVisible.every(expected => actualVisible.includes(expected));
        const noDoneItems = !this.scheduleData.some(item => 
          item.tinhTrang?.toLowerCase() === 'done' || item.tinhTrang?.toLowerCase() === 'completed'
        );
        
        if (allExpectedVisible && noDoneItems) {
          console.log('✅ SUCCESS: Done items hiding is working correctly!');
          alert('✅ SUCCESS: Done items hiding is working correctly!\n\n' +
                `Visible items: ${actualVisible.join(', ')}\n` +
                'Done items are properly hidden from the list.');
        } else {
          console.log('❌ FAILED: Done items hiding is not working correctly!');
          alert('❌ FAILED: Done items hiding is not working correctly!\n\n' +
                `Expected visible: ${expectedVisible.join(', ')}\n` +
                `Actual visible: ${actualVisible.join(', ')}\n` +
                `Contains Done items: ${!noDoneItems}`);
        }
      }, 1000);
    }, 2000);
    
    alert('🧪 Test Done items hiding started!\n\n' +
          'Created 4 test records:\n' +
          '- DONE001 (Done) - should be HIDDEN\n' +
          '- PENDING001 (Chờ in) - should be VISIBLE\n' +
          '- IQC001 (IQC) - should be VISIBLE\n' +
          '- DONE002 (done) - should be HIDDEN\n\n' +
          'Check console for detailed results.');
  }

  // Method to test import functionality
  testImportFunctionality(): void {
    console.log('🧪 Testing import functionality...');
    
    // Create sample data for testing
    const sampleData: ScheduleItem[] = [
      {
        nam: '2025',
        thang: '1',
        stt: '1',
        sizePhoi: '40x25',
        maTem: 'TEST001',
        soLuongYeuCau: '100',
        soLuongPhoi: '100',
        maHang: 'TEST-HANG',
        lenhSanXuat: 'LSX001',
        khachHang: 'Test Customer',
        ngayNhanKeHoach: '2025-01-15',
        yy: '25',
        ww: '03',
        lineNhan: 'L1',
        nguoiIn: 'Test User',
        tinhTrang: 'Chờ in',
        statusUpdateTime: new Date(),
        banVe: 'BV001',
        ghiChu: 'Test import',
        isUrgent: false,
        isCompleted: false
      },
      {
        nam: '2025',
        thang: '1',
        stt: '2',
        sizePhoi: '50x30',
        maTem: 'TEST002',
        soLuongYeuCau: '200',
        soLuongPhoi: '200',
        maHang: 'TEST-HANG2',
        lenhSanXuat: 'LSX002',
        khachHang: 'Test Customer 2',
        ngayNhanKeHoach: '2025-01-16',
        yy: '25',
        ww: '03',
        lineNhan: 'L2',
        nguoiIn: 'Test User 2',
        tinhTrang: 'IQC',
        statusUpdateTime: new Date(),
        banVe: 'BV002',
        ghiChu: 'Test import 2',
        isUrgent: false,
        isCompleted: false
      }
    ];

    console.log('🧪 Sample data created:', sampleData);
    
    // Test save to Firebase
    this.saveToFirebase(sampleData);
    
    // Test load from Firebase after a delay
    setTimeout(() => {
      console.log('🧪 Testing load after save...');
      this.loadDataFromFirebase();
    }, 2000);
    
    alert('🧪 Test import functionality started!\n\n- Created 2 sample records\n- Saving to Firebase...\n- Will load data in 2 seconds\n\nCheck console for details.');
  }

  // Method to check Firebase data and clear all data
  async checkAndClearFirebaseData(): Promise<void> {
    try {
      console.log('🔍 Checking Firebase data...');
      
      // Get all documents from print-schedules collection (new structure)
      const snapshot = await this.firestore.collection('print-schedules').get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        console.log('📊 Firebase collection "print-schedules" is empty');
        alert('📊 Firebase collection "print-schedules" is empty - No data to clear');
        return;
      }

      console.log(`📊 Found ${snapshot.docs.length} documents in Firebase`);
      
      // Count total items across all documents with clear structure
      let totalItems = 0;
      let doneItems = 0;
      let notDoneItems = 0;
      const documentDetails: any[] = [];
      
      snapshot.forEach((doc) => {
        const data = doc.data() as any;
        const docInfo = {
          id: doc.id,
          recordCount: data.recordCount || 0,
          month: data.month,
          year: data.year,
          importedAt: data.importedAt,
          collectionType: data.collectionType
        };
        documentDetails.push(docInfo);
        
        if (data.data && Array.isArray(data.data)) {
          totalItems += data.data.length;
          data.data.forEach((item: any) => {
            const status = item.tinhTrang?.toLowerCase();
            if (status === 'done' || status === 'completed') {
              doneItems++;
            } else {
              notDoneItems++;
            }
          });
        }
      });

      console.log(`📊 Firebase Data Summary:`);
      console.log(`   - Total documents: ${snapshot.docs.length}`);
      console.log(`   - Total items: ${totalItems}`);
      console.log(`   - Done items: ${doneItems}`);
      console.log(`   - Not Done items: ${notDoneItems}`);
      console.log('📄 Document details:', documentDetails);

      // Ask for confirmation to clear all data
      const confirmMessage = `📊 Firebase Data Summary (Clear Structure):
- Total documents: ${snapshot.docs.length}
- Total items: ${totalItems}
- Done items: ${doneItems}
- Not Done items: ${notDoneItems}

📄 Documents to delete:
${documentDetails.map(doc => `- ${doc.id}: ${doc.recordCount} items (${doc.month}/${doc.year})`).join('\n')}

⚠️ Bạn có chắc chắn muốn XÓA HẾT tất cả dữ liệu này không?
Hành động này KHÔNG THỂ HOÀN TÁC!`;

      if (confirm(confirmMessage)) {
        console.log('🗑️ Starting to clear all Firebase data...');
        
        // Delete all documents in batch
        const batch = this.firestore.firestore.batch();
        snapshot.docs.forEach((doc) => {
          batch.delete(doc.ref);
        });
        
        await batch.commit();
        
        console.log('✅ Successfully cleared all Firebase data');
        alert(`✅ Đã xóa thành công tất cả dữ liệu Firebase!\n\n- Đã xóa ${snapshot.docs.length} documents\n- Đã xóa ${totalItems} items\n\nBây giờ bạn có thể import dữ liệu mới.`);
        
        // Clear local data
        this.scheduleData = [];
        this.firebaseSaved = false;
        
        // Refresh display
        this.loadDataFromFirebase();
        
      } else {
        console.log('❌ User cancelled data clearing');
        alert('❌ Đã hủy việc xóa dữ liệu');
      }
      
    } catch (error) {
      console.error('❌ Error checking/clearing Firebase data:', error);
      alert(`❌ Lỗi khi kiểm tra/xóa dữ liệu Firebase: ${error.message}`);
    }
  }
}
