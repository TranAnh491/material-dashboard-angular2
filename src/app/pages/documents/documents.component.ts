import { Component, OnInit, OnDestroy } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, updateDoc, doc, onSnapshot, query, orderBy, Timestamp } from 'firebase/firestore';
import { environment } from '../../../environments/environment';
import { GoogleSheetService } from '../../services/google-sheet.service';
import { AuditService, AuditData, PhaseScore } from '../../services/audit.service';
import { Subscription, Subject, takeUntil } from 'rxjs';
import { HttpClient } from '@angular/common/http';

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
  dayOfWeek: string;
  isSunday: boolean;
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

  // Auto-save timer
  private autoSaveTimer: any = null;

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

  // Modern checklist interface properties
  checklists: any[] = [
    {
      id: 'daily-shelves',
      title: 'Daily Checklist Shelves',
      description: 'Daily warehouse shelf safety inspection',
      icon: 'checklist',
      status: 'ready',
      completionPercentage: 0,
      itemCount: 10,
      assignedUser: 'Hoàng Tuấn',
      lastUpdated: new Date(),
      priority: 'high',
      url: null,
      loading: false
    },
    {
      id: 'secured-checklist',
      title: 'Daily Secured Checklist',
      description: 'Checklist kiểm tra an toàn và thiết bị kho hàng ngày',
      icon: 'security',
      status: 'ready',
      completionPercentage: 0,
      itemCount: 20,
      assignedUser: 'Hoàng Tuấn',
      lastUpdated: new Date(),
      priority: 'high',
      url: null,
      loading: false
    }
  ];

  // Search and filter properties
  searchQuery: string = '';
  statusFilter: string = '';
  sortBy: string = 'name';
  filteredChecklists: any[] = [];



  // Sync state
  isSyncing = false;
  lastSyncTime: Date | null = null;
  syncStatus: any = null;

  // 5S Audit properties
  private destroy$ = new Subject<void>();
  auditData: AuditData = {
    sort: {},
    setInOrder: {},
    shine: {},
    standardize: {},
    sustain: {}
  };
  currentPhase: string = 'sort';
  showAuditResults: boolean = false;
  show5SAudit: boolean = false;

  constructor(
    private sanitizer: DomSanitizer, 
    private googleSheetService: GoogleSheetService, 
    private http: HttpClient,
    public auditService: AuditService
  ) { }

  async ngOnInit(): Promise<void> {
    await this.initializeFirebase();
    this.initializeChecklists();
    await this.loadHistory();
    // Update checklist with recent data after loading history
    this.updateChecklistWithRecentData();
    
    // Subscribe to audit data
    this.auditService.auditData$
      .pipe(takeUntil(this.destroy$))
      .subscribe(data => {
        this.auditData = data;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    
    // Clear auto-save timer to prevent memory leaks
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
      console.log('🧹 Cleared auto-save timer on component destroy');
    }


  }

  selectDocument(doc: DocumentFile): void {
    const embedUrl = doc.url.includes('?') ? `${doc.url}&rm=minimal` : `${doc.url}?rm=minimal`;
    this.selectedDocumentUrl = this.sanitizer.bypassSecurityTrustResourceUrl(embedUrl);
  }

  closeDocument(): void {
    this.selectedDocumentUrl = null;
  }

  // Checklist state
  showSecuredChecklist: boolean = false;
  securedChecklistData: ChecklistData = {
    nguoiKiem: '',
    ngayKiem: new Date().toISOString().split('T')[0],
    items: [
      // Điện và an toàn
      { category: 'Điện và an toàn', item: 'Kiểm tra ổ điện số 1-17 (kho D1 ngoài)', isOK: false, isNG: false, notes: '' },
      { category: 'Điện và an toàn', item: 'Kiểm tra ổ điện số 18-24 (VP kho D1)', isOK: false, isNG: false, notes: '' },
      { category: 'Điện và an toàn', item: 'Kiểm tra ổ điện số 25-30 (Kho lạnh D1)', isOK: false, isNG: false, notes: '' },
      { category: 'Điện và an toàn', item: 'Khóa cửa trước D1', isOK: false, isNG: false, notes: '' },
      { category: 'Điện và an toàn', item: 'Tắt đèn kho D1 / đèn Tolet', isOK: false, isNG: false, notes: '' },
      { category: 'Điện và an toàn', item: 'Tắt máy hút ẩm/ máy lạnh/ máy tính kho lạnh', isOK: false, isNG: false, notes: '' },
      { category: 'Điện và an toàn', item: 'Tắt máy tính / quạt kho D1 bên ngoài', isOK: false, isNG: false, notes: '' },
      { category: 'Điện và an toàn', item: 'Tắt điện Kho lạnh', isOK: false, isNG: false, notes: '' },
      { category: 'Điện và an toàn', item: 'Tắt đèn/ máy lạnh văn phòng kho', isOK: false, isNG: false, notes: '' },
      
      // Thiết bị và vật dụng
      { category: 'Thiết bị và vật dụng', item: 'Đưa xe nâng vào vị trí', isOK: false, isNG: false, notes: '' },
      { category: 'Thiết bị và vật dụng', item: 'Tắt nguồn máy tính băng, điện thoại, bộ đàm để vào thùng nhựa mang ra vị trí đã quy định', isOK: false, isNG: false, notes: '' },
      { category: 'Thiết bị và vật dụng', item: 'Đưa pin xe nâng vào khu vực lưu trữ pin', isOK: false, isNG: false, notes: '' },
      
      // Kiểm tra cửa và lối thoát
      { category: 'Kiểm tra cửa và lối thoát', item: 'Kiểm tra các cửa thoát hiểm đã được đóng chưa', isOK: false, isNG: false, notes: '' },
      { category: 'Kiểm tra cửa và lối thoát', item: 'Kiểm tra và đóng tất cả các cửa sổ', isOK: false, isNG: false, notes: '' },
      
      // Vệ sinh và sắp xếp
      { category: 'Vệ sinh và sắp xếp', item: 'Dọn dẹp gọn gàng, 5S khu vực bán soạn NVL, soạn Thành phẩm', isOK: false, isNG: false, notes: '' },
      
      // Kiểm tra dấu hiệu bất thường
      { category: 'Kiểm tra dấu hiệu bất thường', item: 'Có dấu hiệu có tố kiến, tồ côn trùng không?', isOK: false, isNG: false, notes: '' },
      { category: 'Kiểm tra dấu hiệu bất thường', item: 'Có phát hiện mùi ở khu vực pallet gỗ, bao bì carton không?', isOK: false, isNG: false, notes: '' },
      
      // Kiểm tra kết cấu kệ hàng
      { category: 'Kiểm tra kết cấu kệ hàng', item: 'Kiểm tra các kệ hàng có cong vênh, các thanh ngang, thanh dọc có bị biến dạng hay không?', isOK: false, isNG: false, notes: '' },
      { category: 'Kiểm tra kết cấu kệ hàng', item: 'Kiểm tra để chân kệ có được bắt ốc có định xướng nên xướng hay không?', isOK: false, isNG: false, notes: '' },
      { category: 'Kiểm tra kết cấu kệ hàng', item: 'Kiểm tra thanh beam kệ Kho có bị cong, móp. Kệ Kho có bị nghiêng ngã hay không. Chân kệ có hở hay không?', isOK: false, isNG: false, notes: '' }
    ],
    createdAt: Timestamp.now(),
    status: 'pending'
  };

  // Daily Checklist Methods
  openDailyChecklist(): void {
    this.showDailyChecklist = true;
    // Load history immediately when opening checklist to populate calendar
    this.loadHistory();
  }

  // Secured Checklist Methods
  openSecuredChecklist(): void {
    this.showSecuredChecklist = true;
    this.loadSecuredHistory();
  }

  closeSecuredChecklist(): void {
    this.showSecuredChecklist = false;
  }

  async loadSecuredHistory() {
    if (this.connectionStatus !== 'connected') return;

    try {
      this.isLoading = true;
      const q = query(collection(this.db, 'secured-checklist'), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      
      const securedHistoryData: ChecklistData[] = [];
      
      querySnapshot.forEach((doc) => {
        const data = doc.data() as ChecklistData;
        
        // Skip deleted records
        if ((data as any).deleted) {
          return;
        }
        
        securedHistoryData.push({
          id: doc.id,
          ...data
        });
      });
      
      console.log(`📊 Loaded ${securedHistoryData.length} secured checklist records`);
      
      // You could store this in a separate property if needed for secured checklist history view
      // For now, we'll just log it
      console.log('Secured checklist history:', securedHistoryData);
      
    } catch (error) {
      console.error('Load secured history error:', error);
    } finally {
      this.isLoading = false;
    }
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

  // Secured checklist helper methods
  getSecuredTotalItems(): number {
    return this.securedChecklistData.items.length;
  }

  getSecuredCheckedItems(): number {
    return this.securedChecklistData.items.filter(item => item.isOK).length;
  }

  getSecuredUncheckedItems(): number {
    return this.securedChecklistData.items.filter(item => !item.isOK && !item.isNG).length;
  }

  getSecuredNGItems(): number {
    return this.securedChecklistData.items.filter(item => item.isNG).length;
  }

  getPreviousCategory(index: number): string {
    return index > 0 ? this.currentData.items[index - 1].category : '';
  }

  updateItemStatus(index: number) {
    // Determine which checklist is currently active
    const isSecuredChecklist = this.showSecuredChecklist;
    const item = isSecuredChecklist ? this.securedChecklistData.items[index] : this.currentData.items[index];
    const nguoiKiem = isSecuredChecklist ? this.securedChecklistData.nguoiKiem : this.currentData.nguoiKiem;
    
    // Ensure only one checkbox can be selected at a time
    if (item.isOK && item.isNG) {
      // If both are somehow true, prioritize the last action
      // This prevents both checkboxes from being checked simultaneously
      item.isNG = false;
    }
    
    this.hasUnsavedChanges = true;
    console.log('🔄 Checkbox changed, setting up auto-save...');
    
    // Clear previous auto-save timer to prevent multiple saves
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      console.log('⏹️ Cleared previous auto-save timer');
    }
    
    // Auto-save after 2 seconds with validation
    this.autoSaveTimer = setTimeout(() => {
      if (this.hasUnsavedChanges && nguoiKiem) {
        console.log('⏰ Auto-save triggered by checkbox change');
        this.saveData();
      } else if (!nguoiKiem) {
        console.log('⚠️ Auto-save skipped: No nguoiKiem selected');
        this.showNotification = true;
        this.notificationMessage = '⚠️ Vui lòng chọn người kiểm trước khi tick checkbox';
        this.notificationClass = 'warning';
        setTimeout(() => { this.showNotification = false; }, 3000);
      }
      this.autoSaveTimer = null;
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
    
    // Determine which checklist is currently active
    const isSecuredChecklist = this.showSecuredChecklist;
    const activeData = isSecuredChecklist ? this.securedChecklistData : this.currentData;
    const collectionName = isSecuredChecklist ? 'secured-checklist' : 'warehouse-checklist';
    
    console.log('Active data:', activeData);
    console.log('Collection:', collectionName);
    
    // Clear auto-save timer if exists
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
      console.log('⏹️ Cleared auto-save timer due to manual save');
    }
    
    if (this.connectionStatus !== 'connected') {
      console.log('❌ No Firebase connection');
      this.showNotification = true;
      this.notificationMessage = '❌ Không có kết nối cơ sở dữ liệu';
      this.notificationClass = 'error';
      setTimeout(() => { this.showNotification = false; }, 3000);
      return;
    }

    if (!activeData.nguoiKiem) {
      console.log('❌ Missing required fields');
      this.showNotification = true;
      this.notificationMessage = '⚠️ Vui lòng chọn người kiểm';
      this.notificationClass = 'error';
      setTimeout(() => { this.showNotification = false; }, 3000);
      return;
    }

    this.isLoading = true;

    try {
      const completedItems = activeData.items.filter(item => item.isOK || item.isNG).length;
      const totalItems = activeData.items.length;
      const calculatedStatus = completedItems === totalItems ? 'completed' : 'pending';
      
      const dataToSave = {
        ...activeData,
        createdAt: Timestamp.now(),
        status: calculatedStatus
      };

      console.log('📝 Status calculation:', {
        completedItems,
        totalItems,
        calculatedStatus,
        checkedItems: activeData.items.filter(item => item.isOK).length,
        ngItems: activeData.items.filter(item => item.isNG).length
      });
      console.log('📝 Data to save:', dataToSave);
      console.log('📅 Date being saved:', dataToSave.ngayKiem);

      if (activeData.id) {
        // Update existing record
        console.log('📝 Updating existing record with ID:', activeData.id);
        await updateDoc(doc(this.db, collectionName, activeData.id), dataToSave);
      } else {
        // Create new record
        console.log('📝 Creating new record');
        const docRef = await addDoc(collection(this.db, collectionName), dataToSave);
        activeData.id = docRef.id;
        console.log('✅ New record created with ID:', docRef.id);
      }

      this.hasUnsavedChanges = false;
      this.lastUpdate = new Date();
      
      console.log('✅ Save operation completed successfully');
      
      this.showNotification = true;
      this.notificationMessage = calculatedStatus === 'completed' 
        ? '✅ Đã lưu và hoàn thành checklist!' 
        : '✅ Đã lưu dữ liệu thành công!';
      this.notificationClass = 'success';
      setTimeout(() => { this.showNotification = false; }, 3000);
      
      await this.loadHistory();
      
      // Force calendar refresh if showing
      if (this.showCalendar) {
        console.log('🔄 Refreshing calendar view...');
        console.log('Current checklistDates:', Array.from(this.checklistDates));
      }
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
      
      // Load from both collections for calendar
      const wareouseQ = query(collection(this.db, 'warehouse-checklist'), orderBy('createdAt', 'desc'));
      const securedQ = query(collection(this.db, 'secured-checklist'), orderBy('createdAt', 'desc'));
      
      const [warehouseSnapshot, securedSnapshot] = await Promise.all([
        getDocs(wareouseQ),
        getDocs(securedQ)
      ]);
      
      this.historyData = [];
      this.checklistDates.clear();
      
      // Process warehouse checklist data
      warehouseSnapshot.forEach((doc) => {
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
          console.log('📅 Added to checklistDates (warehouse):', data.ngayKiem, 'from record:', doc.id);
        }
      });
      
      // Process secured checklist data for calendar only
      securedSnapshot.forEach((doc) => {
        const data = doc.data() as ChecklistData;
        
        // Skip deleted records
        if ((data as any).deleted) {
          return;
        }
        
        // Add to checklist dates for calendar
        if (data.ngayKiem) {
          this.checklistDates.add(data.ngayKiem);
          console.log('📅 Added to checklistDates (secured):', data.ngayKiem, 'from record:', doc.id);
        }
      });
      
      this.totalRecords = this.historyData.length;
      console.log(`📊 Loaded ${this.historyData.length} warehouse records, ${this.checklistDates.size} unique dates for calendar`);
      console.log('📅 Calendar dates:', Array.from(this.checklistDates).sort());
      
      // Debug: Compare current date format
      const todayLocal = this.formatDateToLocal(new Date());
      const todayISO = new Date().toISOString().split('T')[0];
      console.log('🕐 Today comparison - Local format:', todayLocal, 'vs ISO format:', todayISO);

      // Update checklist with most recent data
      this.updateChecklistWithRecentData();
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

    // Determine which checklist is currently active
    const isSecuredChecklist = this.showSecuredChecklist;
    
    if (isSecuredChecklist) {
      this.securedChecklistData = {
        nguoiKiem: '',
        ngayKiem: this.formatDateToLocal(new Date()),
        items: [
          // Điện và an toàn
          { category: 'Điện và an toàn', item: 'Kiểm tra ổ điện số 1-17 (kho D1 ngoài)', isOK: false, isNG: false, notes: '' },
          { category: 'Điện và an toàn', item: 'Kiểm tra ổ điện số 18-24 (VP kho D1)', isOK: false, isNG: false, notes: '' },
          { category: 'Điện và an toàn', item: 'Kiểm tra ổ điện số 25-30 (Kho lạnh D1)', isOK: false, isNG: false, notes: '' },
          { category: 'Điện và an toàn', item: 'Khóa cửa trước D1', isOK: false, isNG: false, notes: '' },
          { category: 'Điện và an toàn', item: 'Tắt đèn kho D1 / đèn Tolet', isOK: false, isNG: false, notes: '' },
          { category: 'Điện và an toàn', item: 'Tắt máy hút ẩm/ máy lạnh/ máy tính kho lạnh', isOK: false, isNG: false, notes: '' },
          { category: 'Điện và an toàn', item: 'Tắt máy tính / quạt kho D1 bên ngoài', isOK: false, isNG: false, notes: '' },
          { category: 'Điện và an toàn', item: 'Tắt điện Kho lạnh', isOK: false, isNG: false, notes: '' },
          { category: 'Điện và an toàn', item: 'Tắt đèn/ máy lạnh văn phòng kho', isOK: false, isNG: false, notes: '' },
          
          // Thiết bị và vật dụng
          { category: 'Thiết bị và vật dụng', item: 'Đưa xe nâng vào vị trí', isOK: false, isNG: false, notes: '' },
          { category: 'Thiết bị và vật dụng', item: 'Tắt nguồn máy tính băng, điện thoại, bộ đàm để vào thùng nhựa mang ra vị trí đã quy định', isOK: false, isNG: false, notes: '' },
          { category: 'Thiết bị và vật dụng', item: 'Đưa pin xe nâng vào khu vực lưu trữ pin', isOK: false, isNG: false, notes: '' },
          
          // Kiểm tra cửa và lối thoát
          { category: 'Kiểm tra cửa và lối thoát', item: 'Kiểm tra các cửa thoát hiểm đã được đóng chưa', isOK: false, isNG: false, notes: '' },
          { category: 'Kiểm tra cửa và lối thoát', item: 'Kiểm tra và đóng tất cả các cửa sổ', isOK: false, isNG: false, notes: '' },
          
          // Vệ sinh và sắp xếp
          { category: 'Vệ sinh và sắp xếp', item: 'Dọn dẹp gọn gàng, 5S khu vực bán soạn NVL, soạn Thành phẩm', isOK: false, isNG: false, notes: '' },
          
          // Kiểm tra dấu hiệu bất thường
          { category: 'Kiểm tra dấu hiệu bất thường', item: 'Có dấu hiệu có tố kiến, tồ côn trùng không?', isOK: false, isNG: false, notes: '' },
          { category: 'Kiểm tra dấu hiệu bất thường', item: 'Có phát hiện mùi ở khu vực pallet gỗ, bao bì carton không?', isOK: false, isNG: false, notes: '' },
          
          // Kiểm tra kết cấu kệ hàng
          { category: 'Kiểm tra kết cấu kệ hàng', item: 'Kiểm tra các kệ hàng có cong vênh, các thanh ngang, thanh dọc có bị biến dạng hay không?', isOK: false, isNG: false, notes: '' },
          { category: 'Kiểm tra kết cấu kệ hàng', item: 'Kiểm tra để chân kệ có được bắt ốc có định xướng nên xướng hay không?', isOK: false, isNG: false, notes: '' },
          { category: 'Kiểm tra kết cấu kệ hàng', item: 'Kiểm tra thanh beam kệ Kho có bị cong, móp. Kệ Kho có bị nghiêng ngã hay không. Chân kệ có hở hay không?', isOK: false, isNG: false, notes: '' }
        ],
        createdAt: Timestamp.now(),
        status: 'pending'
      };
    } else {
      this.currentData = {
        nguoiKiem: '',
        ngayKiem: this.formatDateToLocal(new Date()),
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
    }
    
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
      // Refresh data when opening calendar to ensure latest dates are shown
      console.log('📅 Opening calendar, refreshing data...');
      this.loadHistory().then(() => {
        // Debug calendar after data is loaded
        setTimeout(() => this.debugCalendarDates(), 100);
      });
    }
  }

  // Debug method to compare calendar dates with saved dates
  debugCalendarDates() {
    console.log('🐛 Debug Calendar Dates:');
    console.log('Current checklistDates:', Array.from(this.checklistDates));
    console.log('History data count:', this.historyData.length);
    console.log('History data:', this.historyData.map(h => ({
      date: h.ngayKiem,
      user: h.nguoiKiem,
      status: h.status,
      completedItems: this.getCompletedCount(h.items),
      totalItems: h.items.length
    })));
    
    // Check current checklist status
    const dailyChecklist = this.checklists.find(c => c.id === 'daily-shelves');
    console.log('Daily checklist status:', dailyChecklist?.status);
    
    // Check if today's record exists and its status
    const today = new Date().toISOString().split('T')[0];
    const todayRecord = this.historyData.find(h => h.ngayKiem === today);
    if (todayRecord) {
      console.log('Today\'s record:', {
        date: todayRecord.ngayKiem,
        status: todayRecord.status,
        completed: this.getCompletedCount(todayRecord.items),
        total: todayRecord.items.length,
        shouldBeCompleted: this.getCompletedCount(todayRecord.items) === todayRecord.items.length
      });
    } else {
      console.log('No record found for today:', today);
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
      // Fix timezone issue: use local date format instead of ISO
      const dateStr = this.formatDateToLocal(currentDate);
      const isCurrentMonth = currentDate.getMonth() === month;
      const isToday = currentDate.toDateString() === today.toDateString();
      const hasChecklist = this.checklistDates.has(dateStr);
      
      // Debug logging for calendar generation
      if (isCurrentMonth && hasChecklist) {
        console.log(`📅 Calendar day ${currentDate.getDate()}: dateStr='${dateStr}', hasChecklist=${hasChecklist}`);
      }
      
      const dayOfWeek = this.getDayOfWeek(currentDate);
      
      const isSunday = currentDate.getDay() === 0;
      
      days.push({
        day: currentDate.getDate(),
        date: new Date(currentDate),
        isCurrentMonth,
        isToday,
        hasChecklist,
        dayOfWeek,
        isSunday
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return days;
  }

  // Helper method to format date consistently
  private formatDateToLocal(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  onDayClick(day: CalendarDay) {
    if (!day.isCurrentMonth) return;
    
    // Prevent creating checklist on Sunday
    if (day.isSunday) {
      this.showNotification = true;
      this.notificationMessage = '🚫 Không thể tạo checklist vào ngày Chủ Nhật (ngày nghỉ)';
      this.notificationClass = 'warning';
      setTimeout(() => { this.showNotification = false; }, 3000);
      return;
    }
    
    const dateStr = this.formatDateToLocal(day.date);
    console.log(`🖱️ Day clicked: ${day.day}, dateStr='${dateStr}', hasChecklist=${day.hasChecklist}`);
    
    if (day.hasChecklist) {
      // Find and load the checklist for this day
      const record = this.historyData.find(r => r.ngayKiem === dateStr);
      console.log(`🔍 Looking for record with ngayKiem='${dateStr}', found:`, !!record);
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
    
    const dateStr = this.formatDateToLocal(day.date);
    const record = this.historyData.find(r => r.ngayKiem === dateStr);
    
    if (day.isSunday) {
      return 'Chủ Nhật - Ngày nghỉ (không kiểm tra)';
    }
    
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
        const dateStr = this.formatDateToLocal(date);
        
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

  // Modern checklist interface methods
  initializeChecklists() {
    this.filteredChecklists = [...this.checklists];
  }

  // Stats calculations
  getTotalChecklists(): number {
    return this.checklists.length;
  }

  getCompletedToday(): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.checklists.filter(checklist => 
      checklist.completionPercentage === 100 && 
      checklist.lastUpdated >= today
    ).length;
  }

  getInProgressCount(): number {
    return this.checklists.filter(checklist => checklist.status === 'in-progress').length;
  }

  getOverdueCount(): number {
    return this.checklists.filter(checklist => checklist.status === 'overdue').length;
  }

  // Search and filter functionality
  filterChecklists() {
    let filtered = [...this.checklists];

    // Apply search query
    if (this.searchQuery) {
      const query = this.searchQuery.toLowerCase();
      filtered = filtered.filter(checklist => 
        checklist.title.toLowerCase().includes(query) ||
        checklist.description.toLowerCase().includes(query) ||
        checklist.assignedUser.toLowerCase().includes(query)
      );
    }

    // Apply status filter
    if (this.statusFilter) {
      filtered = filtered.filter(checklist => checklist.status === this.statusFilter);
    }

    this.filteredChecklists = filtered;
    this.sortChecklists();
  }

  // Sorting functionality
  sortChecklists() {
    this.filteredChecklists.sort((a, b) => {
      switch (this.sortBy) {
        case 'name':
          return a.title.localeCompare(b.title);
        case 'status':
          return a.status.localeCompare(b.status);
        case 'priority':
          const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
          return priorityOrder[b.priority] - priorityOrder[a.priority];
        case 'date':
          return new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime();
        default:
          return 0;
      }
    });
  }

  // Status label helper
  getStatusLabel(status: string): string {
    const statusLabels = {
      'ready': 'Ready',
      'in-progress': 'In Progress',
      'pending': 'Pending',
      'overdue': 'Overdue',
      'completed': 'Completed'
    };
    return statusLabels[status] || 'Unknown';
  }

  // Action handlers
  openChecklist(checklist: any) {
    checklist.loading = true;
    
    setTimeout(() => {
      if (checklist.id === 'daily-shelves') {
        this.openDailyChecklist();
      } else if (checklist.id === 'secured-checklist') {
        this.openSecuredChecklist();
      } else {
        this.selectDocument({ 
          title: checklist.title, 
          url: checklist.url, 
          category: 'Checklist Kho' 
        });
      }
      checklist.loading = false;
    }, 500);
  }

  viewDetails(checklist: any) {
    // Implementation for viewing checklist details
    console.log('Viewing details for:', checklist.title);
    // You can add a modal or detailed view here
  }

  editChecklist(checklist: any) {
    // Implementation for editing checklist
    console.log('Editing checklist:', checklist.title);
    // You can add edit functionality here
  }

  loadChecklistDates() {
    // Implementation for loading checklist dates
    console.log('Loading checklist dates');
  }

  generateSampleHistoryData() {
    // Implementation for generating sample history data
    console.log('Generating sample history data');
  }

  private getDayOfWeek(date: Date): string {
    const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    return days[date.getDay()];
  }

  // Update checklist with most recent data
  private updateChecklistWithRecentData(): void {
    const checklistIndex = this.checklists.findIndex(c => c.id === 'daily-shelves');
    if (checklistIndex === -1) return;
    
    if (this.historyData.length > 0) {
      // Sort history by date (most recent first)
      const sortedHistory = this.historyData.sort((a, b) => {
        const dateA = new Date(a.ngayKiem);
        const dateB = new Date(b.ngayKiem);
        return dateB.getTime() - dateA.getTime();
      });
      
      const mostRecent = sortedHistory[0];
      
      // Update with most recent data
      this.checklists[checklistIndex].lastUpdated = new Date(mostRecent.ngayKiem);
      this.checklists[checklistIndex].assignedUser = mostRecent.nguoiKiem;
      
      // Check if all items are completed (OK or NG)
      const completedItems = this.getCompletedCount(mostRecent.items);
      const totalItems = mostRecent.items.length;
      const isFullyCompleted = completedItems === totalItems;
      
      // Set status based on completion
      if (isFullyCompleted) {
        this.checklists[checklistIndex].status = 'completed';
      } else {
        // If not completed, determine status based on how recent the last checklist was
        const daysSinceLastCheck = Math.floor((new Date().getTime() - new Date(mostRecent.ngayKiem).getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysSinceLastCheck === 0) {
          this.checklists[checklistIndex].status = 'pending';
        } else if (daysSinceLastCheck <= 1) {
          this.checklists[checklistIndex].status = 'ready';
        } else if (daysSinceLastCheck <= 3) {
          this.checklists[checklistIndex].status = 'pending';
        } else {
          this.checklists[checklistIndex].status = 'overdue';
        }
      }
      
      console.log('✅ Updated checklist status:', {
        date: mostRecent.ngayKiem,
        user: mostRecent.nguoiKiem,
        completedItems: completedItems,
        totalItems: totalItems,
        isFullyCompleted: isFullyCompleted,
        finalStatus: this.checklists[checklistIndex].status
      });
    } else {
      // No history data - set to overdue status
      this.checklists[checklistIndex].status = 'overdue';
      this.checklists[checklistIndex].lastUpdated = new Date(2025, 6, 1); // July 1, 2025 as fallback
      console.log('No history data found, using default status');
    }
    
    // Update filtered checklists as well
    this.filteredChecklists = [...this.checklists];
  }





  async syncToFirebase() {
    if (this.isSyncing) return;
    
    this.isSyncing = true;
    console.log('🔄 Starting sync to Firebase...');
    
    try {
      const result = await this.googleSheetService.syncToFirebase();
      
      if (result.success) {
        this.lastSyncTime = new Date();
        this.syncStatus = result.data;
        alert(`✅ Sync thành công!\n\n${result.message}`);
      } else {
        alert(`❌ Sync thất bại!\n\n${result.message}`);
      }
      
    } catch (error) {
      console.error('❌ Sync error:', error);
      alert(`❌ Sync thất bại!\n\nLỗi: ${error.message || error}`);
    } finally {
      this.isSyncing = false;
    }
  }

  async getSyncStatus() {
    try {
      this.syncStatus = await this.googleSheetService.getSyncStatus();
      console.log('📊 Sync status:', this.syncStatus);
    } catch (error) {
      console.error('❌ Error getting sync status:', error);
    }
  }

  async getFirebaseInventory() {
    try {
      const inventory = await this.googleSheetService.getFirebaseInventory();
      console.log('📦 Firebase inventory:', inventory.length, 'items');
      return inventory;
    } catch (error) {
      console.error('❌ Error getting Firebase inventory:', error);
      return [];
    }
  }

  // Commented out - moved to Utilization component
  /*
  async checkD44Data() {
    console.log('🔍 Checking D44 data from Google Sheets...');
    
    try {
      // Get raw data from Google Sheets service
      const data = await this.googleSheetService.fetchInventoryData().toPromise();
      
      if (!data || data.length === 0) {
        alert('❌ Không có dữ liệu từ Google Sheets');
        return;
      }
      
      // Filter for D44 positions
      const d44Items = data.filter(item => 
        item.location && item.location.toString().substring(0, 3).toUpperCase() === 'D44'
      );
      
      console.log('📊 D44 items found:', d44Items);
      
      // Calculate total quantity and weight for D44
      let totalQuantity = 0;
      let totalWeight = 0;
      let itemsWithUnitWeight = 0;
      let itemsWithoutUnitWeight = 0;
      
      d44Items.forEach(item => {
        const qty = parseFloat(item.qty?.toString()) || 0;
        const code = item.code || '';
        
        // Look up unit weight by code from imported data
        const unitWeight = this.googleSheetService.getUnitWeight(code);
        
        totalQuantity += qty;
        
        if (unitWeight > 0) {
          const itemWeight = (qty * unitWeight) / 1000; // Convert grams to kg
          totalWeight += itemWeight;
          itemsWithUnitWeight++;
          console.log(`✅ Location: ${item.location}, Code: ${code}, Qty: ${qty} pcs × ${unitWeight}g = ${itemWeight.toFixed(3)}kg`);
        } else {
          itemsWithoutUnitWeight++;
          console.log(`❌ Location: ${item.location}, Code: ${code}, Qty: ${qty} pcs - NO UNIT WEIGHT`);
        }
      });
      
      console.log(`📊 D44 Summary:
        - Total Quantity: ${totalQuantity} pcs
        - Total Weight: ${totalWeight.toFixed(2)} kg
        - Items with unit weight: ${itemsWithUnitWeight}
        - Items without unit weight: ${itemsWithoutUnitWeight}
        - Total items: ${d44Items.length}`);
      
      // Check current rack data for comparison
      // const d44Racks = this.rackLoadingData.filter(rack => rack.position.startsWith('D44'));
      const rackTotalWeight = d44Racks.reduce((sum, rack) => sum + rack.currentLoad, 0);
      const rackTotalItems = d44Racks.reduce((sum, rack) => sum + rack.itemCount, 0);
      
      // Show detailed alert with results
      const alertMessage = `📊 D44 Data Analysis:

🔢 GOOGLE SHEETS DATA:
• Total Quantity: ${totalQuantity} pcs
• Total Weight: ${totalWeight.toFixed(2)} kg
• Number of items: ${d44Items.length}
• With unit weight: ${itemsWithUnitWeight}
• Without unit weight: ${itemsWithoutUnitWeight}

📋 RACK DISPLAY DATA:
• Rack Weight: ${rackTotalWeight.toFixed(2)} kg
• Rack Items: ${rackTotalItems}
• D44 Positions: ${d44Racks.length}

⚖️ CALCULATION METHOD:
Location → Code → Unit Weight
Qty × Unit Weight (grams) ÷ 1000 = kg

${Math.abs(totalWeight - rackTotalWeight) > 0.1 ? '⚠️ MISMATCH DETECTED!' : '✅ Data matches!'}`;
      
      alert(alertMessage);
      
    } catch (error) {
      console.error('❌ Error checking D44 data:', error);
      alert(`❌ Lỗi khi kiểm tra dữ liệu D44:\n\n${error.message || error}`);
    }
  }
  */

  // Commented out - moved to Utilization component
  /*
  private calculateRackLoading(): void {
    this.isRefreshing = true;
    
    // Fetch pre-calculated rack loading weights directly
    this.googleSheetService.fetchRackLoadingWeights().subscribe(
      (rackWeights) => {
        console.log('📊 Using pre-calculated rack loading weights:', rackWeights.length, 'positions');
        
        // Auto-sync to Firebase in background (temporarily disabled for debugging)
        // this.googleSheetService.fetchInventoryData().subscribe(inventoryData => {
        //   this.autoSyncToFirebase(inventoryData);
        // });
        
        // Create a map of position -> weight for quick lookup
        const weightMap = new Map<string, number>();
        rackWeights.forEach(item => {
          weightMap.set(item.position, item.weight);
        });
        
        console.log('🗺️ Weight map created with', weightMap.size, 'entries');
        console.log('🔍 Sample weight map entries:', Array.from(weightMap.entries()).slice(0, 10));
        console.log('🔍 D44 in weight map:', weightMap.get('D44'));
        
        // Convert to RackLoading format using pre-calculated weights
        this.rackLoadingData = this.googleSheetService.generateAllRackPositions().map(position => {
          // Match position with weight data by taking first 3 characters
          const positionKey = position.substring(0, 3);
          const weight = weightMap.get(positionKey) || 0;
          
          // Determine max capacity based on position
          // Ground level positions (ending with 1) have 10,000kg capacity
          // Other positions have 1,300kg capacity
          const isGroundLevel = position.endsWith('1');
          const maxCapacity = isGroundLevel ? 10000 : 1300;
          const usage = (weight / maxCapacity) * 100;
          
          // Debug specific positions
          if (positionKey === 'D44') {
            console.log(`🔍 D44 Position: ${position}, Key: ${positionKey}, Weight: ${weight}kg, Max: ${maxCapacity}kg`);
          }
          
          return {
            position: position,
            maxCapacity: maxCapacity,
            currentLoad: Math.round(weight * 100) / 100, // Round to 2 decimal places
            usage: Math.round(usage * 10) / 10, // Round to 1 decimal place
            status: this.calculateRackStatus(usage),
            itemCount: 0 // Not available from pre-calculated data
          };
        });
        
        // Debug D44 specifically
        const d44Racks = this.rackLoadingData.filter(rack => rack.position.startsWith('D44'));
        if (d44Racks.length > 0) {
          console.log(`📊 All D44 Racks:`, d44Racks);
          const totalD44Weight = d44Racks.reduce((sum, rack) => sum + rack.currentLoad, 0);
          console.log(`📊 D44 Total: ${totalD44Weight.toFixed(2)}kg from pre-calculated data`);
        }
        
        this.lastRackDataUpdate = new Date();
        this.isRefreshing = false;
        
        console.log('✅ Rack loading calculation completed using pre-calculated weights');
      },
      (error) => {
        console.error('❌ Error fetching rack loading weights:', error);
        this.isRefreshing = false;
      }
    );
  }
  */

  // Auto-sync to Firebase in background
  private async autoSyncToFirebase(data: any[]) {
    try {
      console.log('🔄 Auto-syncing to Firebase in background...');
      
      // Don't show loading states to user - run silently
      const result = await this.googleSheetService.syncToFirebase();
      
      if (result.success) {
        this.lastSyncTime = new Date();
        this.syncStatus = result.data;
        console.log('✅ Auto-sync to Firebase completed successfully');
      } else {
        console.warn('⚠️ Auto-sync to Firebase failed:', result.message);
      }
      
    } catch (error) {
      console.error('❌ Auto-sync to Firebase error:', error);
      // Don't show error to user - just log it
    }
  }

  // Removed unused test method: testRackLoadingURL

  // Removed unused debug method: debugWeightCalculation

  // Removed unused method: checkFirebaseData

  // Commented out - moved to Utilization component
  /*
  testFullFlow() {
    console.clear();
    console.log('🚀 Testing full flow: CSV → Parsing → Weight Map → Display');
    
    const url = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vR-af8JLCtXJ973WV7B6VzgkUQ3BPtqRdBADNWdZkNNVbJdLTBGLQJ1xvcO58w7HNVC7j8lGXQmVA-O/pub?gid=315193175&single=true&output=csv';
    
    this.http.get(url, { responseType: 'text' }).subscribe(csvData => {
      console.log('✅ Step 1: CSV fetched successfully');
      
      // Step 2: Parse CSV data
      const lines = csvData.split('\n');
      const rackWeights: {position: string, weight: number}[] = [];
      
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line) {
          const columns = line.split(',');
          if (columns.length >= 3) {
            const position = columns[1]?.replace(/"/g, '').trim();
            const weightStr = columns[2]?.replace(/"/g, '').trim();
            
            if (position && weightStr) {
              const normalizedWeight = weightStr.replace(',', '.');
              const weight = parseFloat(normalizedWeight);
              
              if (!isNaN(weight)) {
                rackWeights.push({
                  position: position.toUpperCase(),
                  weight: weight
                });
              }
            }
          }
        }
      }
      
      console.log('✅ Step 2: CSV parsed -', rackWeights.length, 'positions');
      console.log('📋 Sample parsed data:', rackWeights.slice(0, 5));
      
      // Step 3: Check D44 specifically
      const d44Data = rackWeights.find(item => item.position === 'D44');
      console.log('✅ Step 3: D44 found:', d44Data);
      
      // Step 4: Create weight map
      const weightMap = new Map<string, number>();
      rackWeights.forEach(item => {
        weightMap.set(item.position, item.weight);
      });
      
      console.log('✅ Step 4: Weight map created with', weightMap.size, 'entries');
      console.log('🔍 D44 in weight map:', weightMap.get('D44'));
      
      // Step 5: Test position matching
      const testPositions = ['D44', 'D41', 'D42', 'F64', 'IQC'];
      console.log('✅ Step 5: Testing position matching:');
      testPositions.forEach(pos => {
        const weight = weightMap.get(pos) || 0;
        console.log(`  ${pos}: ${weight}kg`);
      });
      
      // Step 6: Apply to actual rack loading data
      console.log('✅ Step 6: Applying to rack loading data...');
      
      // Generate a few test rack positions
      const testRackPositions = ['D41', 'D42', 'D43', 'D44', 'D45'];
      const updatedRacks = testRackPositions.map(position => {
        const positionKey = position.substring(0, 3); // D44 -> D44, D41 -> D41
        const weight = weightMap.get(positionKey) || 0;
        const usage = (weight / 1300) * 100;
        
        return {
          position: position,
          maxCapacity: 1300,
          currentLoad: Math.round(weight * 100) / 100,
          usage: Math.round(usage * 10) / 10,
          status: weight > 0 ? 'normal' : 'available',
          itemCount: 0
        };
      });
      
      console.log('✅ Step 7: Sample rack data with weights:');
      updatedRacks.forEach(rack => {
        console.log(`  ${rack.position}: ${rack.currentLoad}kg (${rack.usage}%)`);
      });
      
      // Step 8: Update actual display (just for D44 positions)
      const d44Racks = this.rackLoadingData.filter(rack => rack.position.startsWith('D4'));
      d44Racks.forEach(rack => {
        const positionKey = rack.position.substring(0, 3);
        const weight = weightMap.get(positionKey) || 0;
        const usage = (weight / 1300) * 100;
        
        rack.currentLoad = Math.round(weight * 100) / 100;
        rack.usage = Math.round(usage * 10) / 10;
        rack.status = this.calculateRackStatus(usage);
      });
      
      console.log('✅ Step 8: Updated D4x racks in display');
      
      alert(`🎉 Test completed!
      
📊 Results:
• CSV lines: ${lines.length}
• Parsed positions: ${rackWeights.length}
• D44 weight: ${d44Data?.weight || 'NOT FOUND'}kg
• Weight map size: ${weightMap.size}

Check console for detailed logs!`);
    });
  }
  */

  /*
  debugCSVFormat() {
    console.log('🔍 Checking multiple rack positions...');
    
    this.googleSheetService.fetchRackLoadingWeights().subscribe(weights => {
      console.log(`📊 Total weights loaded: ${weights.length} positions`);
      
      // Check specific positions from the CSV
      const testPositions = ['D44', 'F64', 'IQC', 'E63', 'D34', 'F22', 'VP'];
      
      console.log('🔍 Testing specific positions:');
      testPositions.forEach(pos => {
        const found = weights.find(w => w.position === pos);
        const rackDisplay = this.rackLoadingData.find(r => r.position === pos);
        
        if (found) {
          console.log(`✅ ${pos}: CSV=${found.weight}kg, Display=${rackDisplay?.currentLoad || 'N/A'}kg`);
        } else {
          console.log(`❌ ${pos}: NOT FOUND in CSV`);
        }
      });
      
      // Check how many positions have weight > 0
      const withWeight = weights.filter(w => w.weight > 0);
      const displayWithWeight = this.rackLoadingData.filter(r => r.currentLoad > 0);
      
      console.log(`📊 Positions with weight: CSV=${withWeight.length}, Display=${displayWithWeight.length}`);
      
      // Show sample of positions with weight
      console.log('📋 Sample positions with weight:');
      withWeight.slice(0, 10).forEach(w => {
        const display = this.rackLoadingData.find(r => r.position === w.position);
        console.log(`  ${w.position}: ${w.weight}kg → ${display?.currentLoad || 'N/A'}kg`);
      });
      
      alert(`✅ Position Check Results:
      
📊 Total positions: ${weights.length}
📊 With weight: ${withWeight.length}
📊 Display with weight: ${displayWithWeight.length}

🔍 Test positions:
${testPositions.map(pos => {
  const found = weights.find(w => w.position === pos);
  const display = this.rackLoadingData.find(r => r.position === pos);
  return `${pos}: ${found?.weight || 'N/A'}kg → ${display?.currentLoad || 'N/A'}kg`;
}).join('\n')}

Check console for detailed info.`);
    });
  }
  */

  // Helper method to parse CSV line with proper quote handling
  private parseCSVLine(line: string): string[] {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    
    // Add the last field
    if (current) {
      result.push(current);
    }
    
    return result;
  }

  async forceUpdateStatus() {
    if (this.connectionStatus !== 'connected') {
      console.log('Not connected to Firebase');
      return;
    }

    try {
      // Find the record for 2025-07-07
      const targetDate = '2025-07-07';
      const targetRecord = this.historyData.find(h => h.ngayKiem === targetDate);
      
      if (!targetRecord || !targetRecord.id) {
        console.log('No record found for', targetDate);
        return;
      }

      // Check if all items are completed
      const completedItems = this.getCompletedCount(targetRecord.items);
      const totalItems = targetRecord.items.length;
      const shouldBeCompleted = completedItems === totalItems;

      console.log('Force updating status for', targetDate, {
        completedItems,
        totalItems,
        shouldBeCompleted,
        currentStatus: targetRecord.status
      });

      if (shouldBeCompleted && targetRecord.status !== 'completed') {
        // Update the record to completed
        await updateDoc(doc(this.db, 'warehouse-checklist', targetRecord.id), {
          status: 'completed'
        });
        
        console.log('✅ Updated status to completed for', targetDate);
        
        // Reload history to reflect changes
        await this.loadHistory();
        
        this.showNotification = true;
        this.notificationMessage = '✅ Đã cập nhật trạng thái thành công!';
        this.notificationClass = 'success';
        setTimeout(() => { this.showNotification = false; }, 3000);
      } else {
        console.log('Record is already completed or not all items are done');
      }
    } catch (error) {
      console.error('Error updating status:', error);
    }
  }

  // 5S Audit Methods
  open5SAudit() {
    this.show5SAudit = true;
  }

  close5SAudit() {
    this.show5SAudit = false;
    this.showAuditResults = false;
  }

  setCurrentPhase(phase: string) {
    this.currentPhase = phase;
    this.showAuditResults = false;
  }

  toggleAuditResults() {
    this.showAuditResults = !this.showAuditResults;
  }

  handleItemCheck(phase: string, itemIndex: number, value: 'good' | 'marginal' | 'poor') {
    this.auditService.updateAuditData(phase, itemIndex, value);
  }

  calculatePhaseScore(phase: string): PhaseScore {
    return this.auditService.calculatePhaseScore(phase, this.auditData);
  }

  getTotalScore(): PhaseScore {
    return this.auditService.getTotalScore(this.auditData);
  }

  exportAuditResults() {
    this.auditService.exportResults(this.auditData);
  }

  getPhaseKeys(): string[] {
    return Object.keys(this.auditService.auditCriteria);
  }

  getItemStatus(phase: string, itemIndex: number): string {
    return this.auditData[phase][itemIndex] || '';
  }

  // Language toggle for 5S Audit
  toggleAuditLanguage() {
    this.auditService.toggleLanguage();
  }
}
