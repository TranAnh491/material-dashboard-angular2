import { Component, OnInit, OnDestroy } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, updateDoc, doc, onSnapshot, query, orderBy, Timestamp } from 'firebase/firestore';
import { environment } from '../../../environments/environment';

interface DocumentFile {
  title: string;
  url: string;
  category: string;
}

interface ChecklistItem {
  id?: string;
  category: string;
  item: string;
  isOK: boolean;
  isNG: boolean;
  notes: string;
}

interface ChecklistData {
  id?: string;
  nguoiKiem: string;
  ngayKiem: string;
  items: ChecklistItem[];
  createdAt: any;
  status: 'pending' | 'completed';
}

interface CalendarDay {
  day: number;
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  hasChecklist: boolean;
}

@Component({
  selector: 'app-documents',
  templateUrl: './documents.component.html',
  styleUrls: ['./documents.component.scss']
})
export class DocumentsComponent implements OnInit, OnDestroy {

  documentList: DocumentFile[] = [
    {
      title: 'Checklist ASM1',
      url: 'https://docs.google.com/spreadsheets/d/1otX4VegyT7fdHMZqRLulBGoc-zmdP1bJLSuYHZAstEc/edit?gid=1531087093',
      category: 'Checklist Kho'
    },
    {
      title: 'Checklist ASM2',
      url: 'https://docs.google.com/spreadsheets/d/1dSSE2Wu_hWntnmm0BM4NXxySOVGR6Nd9wTJECtkIdao/edit?gid=1427962301',
      category: 'Checklist Kho'
    }
    // Thêm các file khác vào đây
  ];

  selectedDocumentUrl: SafeResourceUrl | null = null;

  // Daily Checklist functionality
  showDailyChecklist: boolean = false;
  
  // Firebase configuration from environment
  private firebaseConfig = environment.firebase;

  // Component state
  connectionStatus: 'connecting' | 'connected' | 'offline' = 'connecting';
  isLoading = false;
  hasUnsavedChanges = false;
  showHistory = false;
  showCalendar = false;
  showNotification = false;
  notificationMessage = '';
  notificationClass = '';
  totalRecords = 0;
  lastUpdate = new Date();

  // Firebase
  private db: any;
  private unsubscribe: any;

  // Data
  currentData: ChecklistData = {
    nguoiKiem: '',
    ngayKiem: new Date().toISOString().split('T')[0],
    items: [
      // Kiểm tra kết cấu kệ
      { category: 'Kết cấu kệ', item: 'Kiểm tra nhãn tải trọng và không vượt giới hạn', isOK: false, isNG: false, notes: '' },
      { category: 'Kết cấu kệ', item: 'Kiểm tra độ thẳng đứng (lệch <1 độ)', isOK: false, isNG: false, notes: '' },
      { category: 'Kết cấu kệ', item: 'Kiểm tra vết nứt, biến dạng, lỏng lẻo của thanh mâm kệ với thanh kệ', isOK: false, isNG: false, notes: '' },
      { category: 'Kết cấu kệ', item: 'Kiểm tra chốt khóa và bu-lông', isOK: false, isNG: false, notes: '' },
      { category: 'Kết cấu kệ', item: 'Kiểm tra beam ngang không móp, cong', isOK: false, isNG: false, notes: '' },
      { category: 'Kết cấu kệ', item: 'Đứng nhìn tổng thể từ xa xem kệ có nghiêng hay không', isOK: false, isNG: false, notes: '' },
      
      // Kiểm tra hàng hóa
      { category: 'Hàng hóa', item: 'Hàng nặng ở tầng thấp, không nhô ra ngoài mép', isOK: false, isNG: false, notes: '' },
      
      // An toàn PCCC
      { category: 'An toàn PCCC', item: 'Khoảng cách sprinkler-hàng hóa ≥45cm', isOK: false, isNG: false, notes: '' },
      { category: 'An toàn PCCC', item: 'Lối thoát hiểm không bị chắn', isOK: false, isNG: false, notes: '' },
      { category: 'An toàn PCCC', item: 'Lối đi giữa các kệ thông thoáng', isOK: false, isNG: false, notes: '' }
    ],
    createdAt: Timestamp.now(),
    status: 'pending'
  };

  historyData: ChecklistData[] = [];

  // Calendar properties
  currentCalendarDate = new Date();
  checklistDates: Set<string> = new Set();

  constructor(private sanitizer: DomSanitizer) { }

  async ngOnInit(): Promise<void> {
    await this.initializeFirebase();
    await this.loadHistory();
  }

  ngOnDestroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }

  selectDocument(doc: DocumentFile): void {
    const embedUrl = doc.url.includes('?') ? `${doc.url}&rm=minimal` : `${doc.url}?rm=minimal`;
    this.selectedDocumentUrl = this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl);
  }

  closeDocument(): void {
    this.selectedDocumentUrl = null;
  }

  // Daily Checklist Methods
  openDailyChecklist(): void {
    this.showDailyChecklist = true;
  }

  closeDailyChecklist(): void {
    this.showDailyChecklist = false;
    this.showHistory = false;
    this.showCalendar = false;
  }

  private async initializeFirebase() {
    try {
      console.log('Initializing Firebase with config:', this.firebaseConfig);
      const app = initializeApp(this.firebaseConfig);
      this.db = getFirestore(app);
      this.connectionStatus = 'connected';
      console.log('Firebase initialized successfully');
    } catch (error) {
      console.error('Firebase initialization error:', error);
      this.connectionStatus = 'offline';
    }
  }

  getTotalItems(): number {
    return this.currentData.items.length;
  }

  getCheckedItems(): number {
    return this.currentData.items.filter(item => item.isOK).length;
  }

  getUncheckedItems(): number {
    return this.currentData.items.filter(item => !item.isOK && !item.isNG).length;
  }

  getNGItems(): number {
    return this.currentData.items.filter(item => item.isNG).length;
  }

  getPreviousCategory(index: number): string {
    return index > 0 ? this.currentData.items[index - 1].category : '';
  }

  updateItemStatus(index: number) {
    const item = this.currentData.items[index];
    
    // Ensure only one checkbox can be selected at a time
    if (item.isOK && item.isNG) {
      // If both are somehow true, prioritize the last action
      // This prevents both checkboxes from being checked simultaneously
      item.isNG = false;
    }
    
    this.hasUnsavedChanges = true;
    // Auto-save after 2 seconds
    setTimeout(() => {
      if (this.hasUnsavedChanges) {
        this.saveData();
      }
    }, 2000);
  }

  updateItemNotes(index: number) {
    this.hasUnsavedChanges = true;
  }

  // Removed updateItemPriority as priority field no longer exists

  removeItem(index: number) {
    if (confirm('Bạn có chắc muốn xóa mục này?')) {
      this.currentData.items.splice(index, 1);
      this.hasUnsavedChanges = true;
    }
  }

  async saveData() {
    console.log('🔄 Starting save operation...');
    console.log('Connection status:', this.connectionStatus);
    console.log('Current data:', this.currentData);
    
    if (this.connectionStatus !== 'connected') {
      console.log('❌ No Firebase connection');
      this.showNotification = true;
      this.notificationMessage = '❌ Không có kết nối cơ sở dữ liệu';
      this.notificationClass = 'error';
      setTimeout(() => { this.showNotification = false; }, 3000);
      return;
    }

    if (!this.currentData.nguoiKiem) {
      console.log('❌ Missing required fields');
      this.showNotification = true;
      this.notificationMessage = '⚠️ Vui lòng chọn người kiểm';
      this.notificationClass = 'error';
      setTimeout(() => { this.showNotification = false; }, 3000);
      return;
    }

    this.isLoading = true;

    try {
      const dataToSave = {
        ...this.currentData,
        createdAt: Timestamp.now(),
        status: (this.getCheckedItems() + this.getNGItems()) === this.getTotalItems() ? 'completed' : 'pending'
      };

      console.log('📝 Data to save:', dataToSave);

      if (this.currentData.id) {
        // Update existing record
        console.log('📝 Updating existing record with ID:', this.currentData.id);
        await updateDoc(doc(this.db, 'warehouse-checklist', this.currentData.id), dataToSave);
      } else {
        // Create new record
        console.log('📝 Creating new record');
        const docRef = await addDoc(collection(this.db, 'warehouse-checklist'), dataToSave);
        this.currentData.id = docRef.id;
        console.log('✅ New record created with ID:', docRef.id);
      }

      this.hasUnsavedChanges = false;
      this.lastUpdate = new Date();
      
      console.log('✅ Save operation completed successfully');
      
      this.showNotification = true;
      this.notificationMessage = '✅ Đã lưu dữ liệu thành công!';
      this.notificationClass = 'success';
      setTimeout(() => { this.showNotification = false; }, 3000);
      
      await this.loadHistory();
    } catch (error) {
      console.error('❌ Save error details:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);
      this.showNotification = true;
      this.notificationMessage = '❌ Lỗi khi lưu dữ liệu: ' + error.message;
      this.notificationClass = 'error';
      setTimeout(() => { this.showNotification = false; }, 5000);
    } finally {
      this.isLoading = false;
    }
  }

  async loadHistory() {
    if (this.connectionStatus !== 'connected') return;

    try {
      this.isLoading = true;
      const q = query(collection(this.db, 'warehouse-checklist'), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      this.historyData = [];
      this.checklistDates.clear();
      
      querySnapshot.forEach((doc) => {
        const data = doc.data() as ChecklistData;
        
        // Skip deleted records
        if ((data as any).deleted) {
          return;
        }
        
        this.historyData.push({
          id: doc.id,
          ...data
        });
        
        // Add to checklist dates for calendar
        if (data.ngayKiem) {
          this.checklistDates.add(data.ngayKiem);
        }
      });
      
      this.totalRecords = this.historyData.length;
    } catch (error) {
      console.error('Load history error:', error);
    } finally {
      this.isLoading = false;
    }
  }

  startNewChecklist() {
    if (this.hasUnsavedChanges) {
      if (!confirm('Bạn có thay đổi chưa lưu. Bạn có muốn tạo checklist mới?')) {
        return;
      }
    }

    this.currentData = {
      nguoiKiem: '',
      ngayKiem: new Date().toISOString().split('T')[0],
      items: [
        // Kiểm tra kết cấu kệ
        { category: 'Kết cấu kệ', item: 'Kiểm tra nhãn tải trọng và không vượt giới hạn', isOK: false, isNG: false, notes: '' },
        { category: 'Kết cấu kệ', item: 'Kiểm tra độ thẳng đứng (lệch <1 độ)', isOK: false, isNG: false, notes: '' },
        { category: 'Kết cấu kệ', item: 'Kiểm tra vết nứt, biến dạng, lỏng lẻo của thanh mâm kệ với thanh kệ', isOK: false, isNG: false, notes: '' },
        { category: 'Kết cấu kệ', item: 'Kiểm tra chốt khóa và bu-lông', isOK: false, isNG: false, notes: '' },
        { category: 'Kết cấu kệ', item: 'Kiểm tra beam ngang không móp, cong', isOK: false, isNG: false, notes: '' },
        { category: 'Kết cấu kệ', item: 'Đứng nhìn tổng thể từ xa xem kệ có nghiêng hay không', isOK: false, isNG: false, notes: '' },
        
        // Kiểm tra hàng hóa
        { category: 'Hàng hóa', item: 'Hàng nặng ở tầng thấp, không nhô ra ngoài mép', isOK: false, isNG: false, notes: '' },
        
        // An toàn PCCC
        { category: 'An toàn PCCC', item: 'Khoảng cách sprinkler-hàng hóa ≥45cm', isOK: false, isNG: false, notes: '' },
        { category: 'An toàn PCCC', item: 'Lối thoát hiểm không bị chắn', isOK: false, isNG: false, notes: '' },
        { category: 'An toàn PCCC', item: 'Lối đi giữa các kệ thông thoáng', isOK: false, isNG: false, notes: '' }
      ],
      createdAt: Timestamp.now(),
      status: 'pending'
    };
    
    this.hasUnsavedChanges = false;
    this.showHistory = false;
  }

  loadRecord(record: ChecklistData) {
    if (this.hasUnsavedChanges) {
      if (!confirm('Bạn có thay đổi chưa lưu. Bạn có muốn tải bản ghi này?')) {
        return;
      }
    }

    this.currentData = { ...record };
    this.hasUnsavedChanges = false;
    this.showHistory = false;
    
    this.showNotification = true;
    this.notificationMessage = '📋 Đã tải bản ghi thành công!';
    this.notificationClass = 'info';
    setTimeout(() => { this.showNotification = false; }, 3000);
  }

  async deleteRecord(recordId: string | undefined) {
    if (!recordId) return;
    
    if (!confirm('Bạn có chắc muốn xóa bản ghi này?')) {
      return;
    }

    try {
      this.isLoading = true;
      await updateDoc(doc(this.db, 'warehouse-checklist', recordId), { deleted: true });
      await this.loadHistory();
      
      this.showNotification = true;
      this.notificationMessage = '🗑️ Đã xóa bản ghi!';
      this.notificationClass = 'success';
      setTimeout(() => { this.showNotification = false; }, 3000);
    } catch (error) {
      console.error('Delete error:', error);
      this.showNotification = true;
      this.notificationMessage = '❌ Lỗi khi xóa bản ghi';
      this.notificationClass = 'error';
      setTimeout(() => { this.showNotification = false; }, 3000);
    } finally {
      this.isLoading = false;
    }
  }

  getCompletedCount(items: ChecklistItem[]): number {
    return items.filter(item => item.isOK || item.isNG).length;
  }

  exportData() {
    if (this.historyData.length === 0) {
      this.showNotification = true;
      this.notificationMessage = '❌ Không có dữ liệu để xuất';
      this.notificationClass = 'error';
      setTimeout(() => { this.showNotification = false; }, 3000);
      return;
    }

    // Create CSV content
    let csvContent = 'Ngày kiểm,Người kiểm,Trạng thái,Tổng mục,Hoàn thành,Ghi chú\n';
    
    this.historyData.forEach(record => {
      const completedCount = this.getCompletedCount(record.items);
      const notes = record.items.map(item => item.notes).filter(note => note).join('; ');
      
      csvContent += `${record.ngayKiem},${record.nguoiKiem},${record.status === 'completed' ? 'Hoàn thành' : 'Đang thực hiện'},${record.items.length},${completedCount},"${notes}"\n`;
    });

    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `warehouse-checklist-${new Date().getTime()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    this.showNotification = true;
    this.notificationMessage = '📊 Đã xuất dữ liệu Excel!';
    this.notificationClass = 'success';
    setTimeout(() => { this.showNotification = false; }, 3000);
  }

  // Calendar methods
  toggleCalendar() {
    this.showCalendar = !this.showCalendar;
    if (this.showCalendar) {
      this.currentCalendarDate = new Date();
      this.showHistory = false;
    }
  }

  getCurrentMonthYear(): string {
    return this.currentCalendarDate.toLocaleDateString('vi-VN', { 
      month: 'long', 
      year: 'numeric' 
    });
  }

  previousMonth() {
    this.currentCalendarDate = new Date(
      this.currentCalendarDate.getFullYear(),
      this.currentCalendarDate.getMonth() - 1,
      1
    );
  }

  nextMonth() {
    this.currentCalendarDate = new Date(
      this.currentCalendarDate.getFullYear(),
      this.currentCalendarDate.getMonth() + 1,
      1
    );
  }

  getCalendarDays(): CalendarDay[] {
    const year = this.currentCalendarDate.getFullYear();
    const month = this.currentCalendarDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const today = new Date();
    
    // Get first day of week (Monday = 1, Sunday = 0)
    const firstDayOfWeek = firstDay.getDay();
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - (firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1));
    
    const days: CalendarDay[] = [];
    const currentDate = new Date(startDate);
    
    // Generate 6 weeks (42 days)
    for (let i = 0; i < 42; i++) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const isCurrentMonth = currentDate.getMonth() === month;
      const isToday = currentDate.toDateString() === today.toDateString();
      const hasChecklist = this.checklistDates.has(dateStr);
      
      days.push({
        day: currentDate.getDate(),
        date: new Date(currentDate),
        isCurrentMonth,
        isToday,
        hasChecklist
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return days;
  }

  onDayClick(day: CalendarDay) {
    if (!day.isCurrentMonth) return;
    
    const dateStr = day.date.toISOString().split('T')[0];
    
    if (day.hasChecklist) {
      // Find and load the checklist for this day
      const record = this.historyData.find(r => r.ngayKiem === dateStr);
      if (record) {
        this.loadRecord(record);
        this.showCalendar = false;
      }
    } else {
      // Create new checklist for this day
      this.currentData.ngayKiem = dateStr;
      this.showCalendar = false;
      this.showNotification = true;
      this.notificationMessage = `📅 Đã chọn ngày ${day.day}/${day.date.getMonth() + 1}/${day.date.getFullYear()} để tạo checklist mới`;
      this.notificationClass = 'info';
      setTimeout(() => { this.showNotification = false; }, 3000);
    }
  }

  getDayTooltip(day: CalendarDay): string {
    if (!day.isCurrentMonth) return '';
    
    const dateStr = day.date.toISOString().split('T')[0];
    const record = this.historyData.find(r => r.ngayKiem === dateStr);
    
    if (record) {
      return `Đã kiểm tra - ${record.nguoiKiem}`;
    } else if (day.isToday) {
      return 'Hôm nay - Chưa kiểm tra';
    } else {
      return 'Chưa kiểm tra - Click để tạo checklist';
    }
  }

  // Generate June 2025 history
  async generateJuneHistory() {
    if (!confirm('Bạn có chắc muốn tạo lịch sử kiểm tra cho tháng 6/2025? Bỏ qua các ngày 1,8,15,22,29.')) {
      return;
    }

    this.isLoading = true;
    
    try {
      // Days to skip in June
      const skipDays = [1, 8, 15, 22, 29];
      
      // Inspector rotation
      const inspectors = ['Hoàng Tuấn', 'Hữu Tình', 'Hoàng Vũ'];
      let inspectorIndex = 0;
      
      let recordsCreated = 0;
      let daysSkipped = 0;
      
      console.log('=== TẠO LỊCH SỬ THÁNG 6/2025 ===');
      console.log('Bỏ qua các ngày: 1,8,15,22,29');
      
      // Loop through all days in June 2025
      for (let day = 1; day <= 30; day++) {
        const date = new Date(2025, 5, day); // June is month 5 (0-indexed)
        const dateStr = date.toISOString().split('T')[0];
        
        // Skip specified days
        if (skipDays.includes(day)) {
          console.log(`🚫 SKIP: ${dateStr} (ngày ${day})`);
          daysSkipped++;
          continue;
        }
        
        // Create checklist items with all marked as OK
        const items = [
          { category: 'Kết cấu kệ', item: 'Kiểm tra nhãn tải trọng và không vượt giới hạn', isOK: true, isNG: false, notes: 'Đã kiểm tra - OK' },
          { category: 'Kết cấu kệ', item: 'Kiểm tra độ thẳng đứng (lệch <1 độ)', isOK: true, isNG: false, notes: 'Đã kiểm tra - OK' },
          { category: 'Kết cấu kệ', item: 'Kiểm tra vết nứt, biến dạng, lỏng lẻo của thanh mâm kệ với thanh kệ', isOK: true, isNG: false, notes: 'Đã kiểm tra - OK' },
          { category: 'Kết cấu kệ', item: 'Kiểm tra chốt khóa và bu-lông', isOK: true, isNG: false, notes: 'Đã kiểm tra - OK' },
          { category: 'Kết cấu kệ', item: 'Kiểm tra beam ngang không móp, cong', isOK: true, isNG: false, notes: 'Đã kiểm tra - OK' },
          { category: 'Kết cấu kệ', item: 'Đứng nhìn tổng thể từ xa xem kệ có nghiêng hay không', isOK: true, isNG: false, notes: 'Đã kiểm tra - OK' },
          { category: 'Hàng hóa', item: 'Hàng nặng ở tầng thấp, không nhô ra ngoài mép', isOK: true, isNG: false, notes: 'Đã kiểm tra - OK' },
          { category: 'An toàn PCCC', item: 'Khoảng cách sprinkler-hàng hóa ≥45cm', isOK: true, isNG: false, notes: 'Đã kiểm tra - OK' },
          { category: 'An toàn PCCC', item: 'Lối thoát hiểm không bị chắn', isOK: true, isNG: false, notes: 'Đã kiểm tra - OK' },
          { category: 'An toàn PCCC', item: 'Lối đi giữa các kệ thông thoáng', isOK: true, isNG: false, notes: 'Đã kiểm tra - OK' }
        ];
        
        // Assign inspector (rotate through the list)
        const assignedInspector = inspectors[inspectorIndex];
        inspectorIndex = (inspectorIndex + 1) % inspectors.length;
        
        const checklistData: ChecklistData = {
          nguoiKiem: assignedInspector,
          ngayKiem: dateStr,
          items: items,
          createdAt: Timestamp.now(),
          status: 'completed'
        };
        
        // Save to Firebase
        await addDoc(collection(this.db, 'warehouse-checklist'), checklistData);
        recordsCreated++;
        console.log(`✅ Ngày ${day}/6: ${assignedInspector} - Record ${recordsCreated}`);
      }
      
      console.log(`\n=== KẾT QUẢ THÁNG 6/2025 ===`);
      console.log(`📋 Records created: ${recordsCreated}`);
      console.log(`🚫 Days skipped: ${daysSkipped}`);
      console.log(`📊 Total days in June: 30`);
      console.log(`✅ Tất cả mục kiểm đều OK`);
      
      this.showNotification = true;
      this.notificationMessage = `✅ Đã tạo ${recordsCreated} bản ghi cho tháng 6/2025! Bỏ qua ${daysSkipped} ngày theo yêu cầu.`;
      this.notificationClass = 'success';
      setTimeout(() => { this.showNotification = false; }, 5000);
      
      // Reload history to show new data
      await this.loadHistory();
      
    } catch (error) {
      console.error('Error generating June history:', error);
      this.showNotification = true;
      this.notificationMessage = '❌ Lỗi khi tạo lịch sử tháng 6: ' + error.message;
      this.notificationClass = 'error';
      setTimeout(() => { this.showNotification = false; }, 5000);
    } finally {
      this.isLoading = false;
    }
  }

  toggleHistory() {
    this.showHistory = !this.showHistory;
    if (this.showHistory) {
      this.showCalendar = false;
      this.loadHistory();
    }
  }
}
