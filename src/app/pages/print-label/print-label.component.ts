import { Component, OnInit } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { PermissionService } from '../../services/permission.service';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import * as XLSX from 'xlsx';
import * as QRCode from 'qrcode';

interface ScheduleItem {
  importDate?: Date; // Import Date để theo dõi các mã hàng import cùng lúc
  batch?: string; // Batch ID để theo dõi các lần import (giữ lại cho backward compatibility)
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

  morePopupView: 'menu' | 'printers' | 'tinhTrang' | 'lateMails' = 'menu';

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
  showCompletedItems: boolean = false; // Mặc định TẮT
  currentStatusFilter: string = '';

  // Pagination (danh sách tem in)
  pageIndex: number = 1; // 1-based
  pageSize: number = 10;
  readonly pageSizeOptions: number[] = [10];
  
  // Done items properties
  doneItems: ScheduleItem[] = [];
  doneItemsLoaded: boolean = false;

  // Delete dialog properties
  showDeleteDialog: boolean = false;
  deleteDialogMessage: string = '';
  deleteCode: string = '';
  deletePassword: string = '';
  currentDeleteAction: 'clearData' | 'deleteCompleted' | 'freshImport' | 'deleteOldData' | 'deleteCurrentData' = 'clearData';

  // Cleanup properties
  private subscriptions: any[] = [];
  private timers: any[] = [];

  // IQC properties
  showIQCModal: boolean = false;
  iqcScanInput: string = '';
  scannedLabel: ScheduleItem | null = null;
  iqcEmployeeId: string = '';
  iqcEmployeeVerified: boolean = false;
  iqcStep: number = 1;

  // Download modal properties
  showDownloadModal: boolean = false;

  // More popup + danh mục Người in
  showMorePopup = false;
  printerCatalog: string[] = [];
  printerNewName = '';
  printerCatalogSaving = false;
  private readonly PRINTER_CATALOG_DOC = 'print-label-settings/printers';

  /** Danh mục tình trạng cho cột "Tình trạng" (cấu hình trong More → Tình trạng) */
  tinhTrangCatalog: string[] = [];
  tinhTrangNewName = '';
  tinhTrangCatalogSaving = false;
  private readonly TINH_TRANG_CATALOG_DOC = 'print-label-settings/tinh-trang';
  /** Người nhận mail cảnh báo tem trễ kế hoạch (Cloud Function đọc doc này) */
  private readonly LATE_NOTIFICATION_EMAILS_DOC = 'print-label-settings/late-notification-emails';
  lateEmailText = '';
  lateEmailsSaving = false;
  lateNotifyManualRunning = false;
  /** Giá trị mặc định khi Firestore chưa có cấu hình */
  private readonly DEFAULT_TINH_TRANG: string[] = [
    'IQC',
    'Late',
    'Chờ in',
    'Chờ bản vẽ',
    'Chờ Template',
    'Đã in',
    'Done'
  ];

  constructor(
    private firestore: AngularFirestore,
    private permissionService: PermissionService,
    private auth: AngularFireAuth,
    private fns: AngularFireFunctions
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
        void this.loadPrinterCatalog();
        void this.loadTinhTrangCatalog();
      }, 1000);
    } else {
      // Desktop loading
      this.loadDataFromFirebase();
      this.refreshStorageInfo();
      this.autoHandleDocumentSizeLimit();
      void this.loadPrinterCatalog();
      void this.loadTinhTrangCatalog();
    }
  }

  openMorePopup(): void {
    this.showMorePopup = true;
    this.morePopupView = 'menu';
    this.printerNewName = '';
    this.tinhTrangNewName = '';
  }

  closeMorePopup(): void {
    this.showMorePopup = false;
    this.morePopupView = 'menu';
    this.tinhTrangNewName = '';
    this.lateEmailText = '';
  }

  openMorePrinters(): void {
    this.morePopupView = 'printers';
    this.printerNewName = '';
  }

  openMoreTinhTrang(): void {
    this.morePopupView = 'tinhTrang';
    this.tinhTrangNewName = '';
    void this.loadTinhTrangCatalog();
  }

  backToMoreMenu(): void {
    this.morePopupView = 'menu';
    this.printerNewName = '';
    this.tinhTrangNewName = '';
    this.lateEmailText = '';
  }

  openMoreLateMails(): void {
    this.morePopupView = 'lateMails';
    void this.loadLateNotificationEmails();
  }

  private parseLateEmailsFromTextarea(): string[] {
    return this.lateEmailText
      .split(/[\n,;\s]+/)
      .map(s => s.trim())
      .filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  }

  async loadLateNotificationEmails(): Promise<void> {
    try {
      const snap = await this.firestore.doc(this.LATE_NOTIFICATION_EMAILS_DOC).get().toPromise();
      const d = (snap && snap.exists ? snap.data() : null) as { emails?: unknown } | null;
      const arr = Array.isArray(d?.emails) ? d.emails : [];
      const list = arr.map((x: unknown) => String(x ?? '').trim()).filter(Boolean);
      this.lateEmailText = list.join('\n');
    } catch (e) {
      console.error('loadLateNotificationEmails:', e);
      this.lateEmailText = '';
    }
  }

  async saveLateNotificationEmails(): Promise<void> {
    if (this.lateEmailsSaving) {
      return;
    }
    this.lateEmailsSaving = true;
    try {
      const emails = Array.from(new Set(this.parseLateEmailsFromTextarea())).sort((a, b) =>
        a.localeCompare(b, 'vi')
      );
      await this.firestore.doc(this.LATE_NOTIFICATION_EMAILS_DOC).set(
        { emails, updatedAt: new Date() },
        { merge: true }
      );
      this.lateEmailText = emails.join('\n');
      alert('Đã lưu danh sách mail.');
    } catch (e) {
      console.error('saveLateNotificationEmails:', e);
      alert('Không lưu được danh sách mail.');
    } finally {
      this.lateEmailsSaving = false;
    }
  }

  async triggerPrintLabelLateNotifyManual(): Promise<void> {
    if (this.lateNotifyManualRunning) {
      return;
    }
    this.lateNotifyManualRunning = true;
    try {
      const fn = this.fns.httpsCallable<
        object,
        { ok: boolean; sent: boolean; lateCount: number; recipientCount: number }
      >('sendPrintLabelLateNotifyManualFn');
      const data = await firstValueFrom(fn({}));
      if (!data?.ok) {
        alert('Không xác định được kết quả từ server.');
        return;
      }
      if (data.recipientCount === 0) {
        alert('Chưa cấu hình email nhận (lưu danh sách mail trước).');
        return;
      }
      if (data.sent) {
        alert(`Đã gửi mail cảnh báo. Số mã trễ: ${data.lateCount}, số người nhận: ${data.recipientCount}.`);
      } else if (data.lateCount === 0) {
        alert(`Không có mã trễ kế hoạch (chưa Done + quá ngày nhận KH). Đã cấu hình ${data.recipientCount} email.`);
      } else {
        alert(`Đã xử lý. sent=${data.sent}, lateCount=${data.lateCount}, recipientCount=${data.recipientCount}.`);
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      alert(`Lỗi: ${msg}`);
    } finally {
      this.lateNotifyManualRunning = false;
    }
  }

  private normalizePrinterName(v: string): string {
    return String(v ?? '').trim();
  }

  async loadPrinterCatalog(): Promise<void> {
    try {
      const snap = await this.firestore.doc(this.PRINTER_CATALOG_DOC).get().toPromise();
      const d = (snap && snap.exists ? snap.data() : null) as any;
      const arr = Array.isArray(d?.printers) ? d.printers : [];
      const list: string[] = arr
        .map((x: any) => this.normalizePrinterName(String(x ?? '')))
        .filter((x: string) => Boolean(x));
      // unique, giữ thứ tự alpha theo vi
      this.printerCatalog = Array.from(new Set<string>(list)).sort((a, b) => a.localeCompare(b, 'vi'));

      // Nếu chưa có danh mục, seed từ các giá trị đang có trong dữ liệu (để không mất trải nghiệm)
      if (this.printerCatalog.length === 0 && this.scheduleData.length > 0) {
        const fromData = this.scheduleData
          .map(it => this.normalizePrinterName(String(it.nguoiIn ?? '')))
          .filter(Boolean);
        this.printerCatalog = Array.from(new Set(fromData)).sort((a, b) => a.localeCompare(b, 'vi'));
      }
    } catch (e) {
      console.error('❌ loadPrinterCatalog:', e);
      this.printerCatalog = [];
    }
  }

  async addPrinterToCatalog(): Promise<void> {
    const name = this.normalizePrinterName(this.printerNewName);
    if (!name) return;
    const next = Array.from(new Set([...this.printerCatalog, name])).sort((a, b) => a.localeCompare(b, 'vi'));
    await this.savePrinterCatalog(next);
    this.printerNewName = '';
  }

  async removePrinterFromCatalog(name: string): Promise<void> {
    const n = this.normalizePrinterName(name);
    if (!n) return;
    const next = this.printerCatalog.filter(x => x !== n);
    await this.savePrinterCatalog(next);
  }

  private async savePrinterCatalog(next: string[]): Promise<void> {
    if (this.printerCatalogSaving) return;
    this.printerCatalogSaving = true;
    try {
      const cleaned = next
        .map(x => this.normalizePrinterName(x))
        .filter(Boolean);
      const unique = Array.from(new Set(cleaned)).sort((a, b) => a.localeCompare(b, 'vi'));
      await this.firestore.doc(this.PRINTER_CATALOG_DOC).set(
        { printers: unique, updatedAt: new Date() },
        { merge: true }
      );
      this.printerCatalog = unique;
    } catch (e: any) {
      console.error('❌ savePrinterCatalog:', e);
      alert('❌ Không lưu được danh mục Người in.');
    } finally {
      this.printerCatalogSaving = false;
    }
  }

  private normalizeTinhTrangName(v: string): string {
    return String(v ?? '').trim();
  }

  /** Pass / NG / Done: luồng IQC — không nằm trong danh mục dropdown thường */
  private isLockedTinhTrang(value: string): boolean {
    const v = this.normalizeTinhTrangName(value);
    return v === 'Pass' || v === 'NG' || v === 'Done';
  }

  shouldShowOrphanTinhTrangOption(item: ScheduleItem): boolean {
    const v = this.normalizeTinhTrangName(String(item.tinhTrang ?? ''));
    if (!v) {
      return false;
    }
    if (this.isLockedTinhTrang(v)) {
      return false;
    }
    return !this.tinhTrangCatalog.includes(v);
  }

  async loadTinhTrangCatalog(): Promise<void> {
    try {
      const snap = await this.firestore.doc(this.TINH_TRANG_CATALOG_DOC).get().toPromise();
      const d = (snap && snap.exists ? snap.data() : null) as any;
      const arr = Array.isArray(d?.statuses) ? d.statuses : [];
      let list: string[] = arr
        .map((x: any) => this.normalizeTinhTrangName(String(x ?? '')))
        .filter((x: string) => Boolean(x));
      if (list.length === 0) {
        list = [...this.DEFAULT_TINH_TRANG];
      }
      this.tinhTrangCatalog = Array.from(new Set<string>(list)).sort((a, b) => a.localeCompare(b, 'vi'));
    } catch (e) {
      console.error('❌ loadTinhTrangCatalog:', e);
      this.tinhTrangCatalog = [...this.DEFAULT_TINH_TRANG];
    }
  }

  async addTinhTrangToCatalog(): Promise<void> {
    const name = this.normalizeTinhTrangName(this.tinhTrangNewName);
    if (!name) {
      return;
    }
    if (this.isLockedTinhTrang(name)) {
      alert('Không thêm được "Pass", "NG", "Done" — các trạng thái này do IQC quản lý.');
      return;
    }
    const next = Array.from(new Set([...this.tinhTrangCatalog, name])).sort((a, b) => a.localeCompare(b, 'vi'));
    await this.saveTinhTrangCatalog(next);
    this.tinhTrangNewName = '';
  }

  async removeTinhTrangFromCatalog(name: string): Promise<void> {
    const n = this.normalizeTinhTrangName(name);
    if (!n) {
      return;
    }
    const next = this.tinhTrangCatalog.filter(x => x !== n);
    if (next.length === 0) {
      alert('Phải giữ ít nhất một tình trạng trong danh mục.');
      return;
    }
    await this.saveTinhTrangCatalog(next);
  }

  private async saveTinhTrangCatalog(next: string[]): Promise<void> {
    if (this.tinhTrangCatalogSaving) {
      return;
    }
    this.tinhTrangCatalogSaving = true;
    try {
      const cleaned = next.map(x => this.normalizeTinhTrangName(x)).filter(Boolean);
      const unique = Array.from(new Set(cleaned)).sort((a, b) => a.localeCompare(b, 'vi'));
      if (unique.length === 0) {
        alert('Phải có ít nhất một tình trạng.');
        return;
      }
      await this.firestore.doc(this.TINH_TRANG_CATALOG_DOC).set(
        { statuses: unique, updatedAt: new Date() },
        { merge: true }
      );
      this.tinhTrangCatalog = unique;
    } catch (e: any) {
      console.error('❌ saveTinhTrangCatalog:', e);
      alert('❌ Không lưu được danh mục Tình trạng.');
    } finally {
      this.tinhTrangCatalogSaving = false;
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
    // Reset file input để cho phép import cùng file nhiều lần
    event.target.value = '';
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
        const cleanedData = await this.cleanExcelData(jsonData);
        console.log('📊 Cleaned Excel data:', cleanedData);
        
        if (cleanedData.length === 0) {
          alert('❌ Không có dữ liệu hợp lệ trong file Excel!\n\nVui lòng kiểm tra:\n- File có đúng format không\n- Có dữ liệu trong các dòng không\n- Cột "MaTem" có dữ liệu không');
          return;
        }
        
        // Save to Firebase (this will append new data automatically)
        await this.saveToFirebase(cleanedData);
        
        const message = `✅ Successfully imported ${cleanedData.length} new records from ${file.name}!\n\n📊 New: ${cleanedData.length} records\n📊 Total: ${this.scheduleData.length} records`;
        alert(message);
        
      } catch (error) {
        console.error('❌ Error importing file:', error);
        alert('❌ Error importing file: ' + error.message);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // Helper method to format date values from Excel
  private formatDateValue(value: any): string {
    if (!value) return '';
    
    console.log('📅 Formatting date value:', { value, type: typeof value, isDate: value instanceof Date });
    
    // If it's already a string, return as is
    if (typeof value === 'string') {
      const trimmed = value.trim();
      console.log('📅 String date:', trimmed);
      return trimmed;
    }
    
    // If it's a number (Excel serial date), convert to Date
    if (typeof value === 'number') {
      // Excel serial date starts from 1900-01-01, but Excel has a bug where 1900 is considered a leap year
      // So we need to adjust for dates after 1900-02-28
      const excelEpoch = new Date(1900, 0, 1);
      const date = new Date(excelEpoch.getTime() + (value - 2) * 24 * 60 * 60 * 1000);
      const formatted = this.formatDateToString(date);
      console.log('📅 Excel serial date converted:', { serial: value, date: formatted });
      return formatted;
    }
    
    // If it's a Date object
    if (value instanceof Date) {
      const formatted = this.formatDateToString(value);
      console.log('📅 Date object converted:', formatted);
      return formatted;
    }
    
    // Try to parse as date string
    try {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        const formatted = this.formatDateToString(date);
        console.log('📅 Parsed date string:', { original: value, formatted });
        return formatted;
      }
    } catch (error) {
      console.warn('Could not parse date value:', value, error);
    }
    
    // Fallback to string conversion
    const fallback = value.toString();
    console.log('📅 Fallback to string:', fallback);
    return fallback;
  }
  
  // Helper method to format Date to DD/MM/YYYY string
  private formatDateToString(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${day}/${month}/${year}`;
  }

  // Generate import date ID dựa trên số lần import (tăng dần mỗi lần bấm import)
  private async generateBatchId(fileContent: any[]): Promise<string> {
    try {
      // Lấy batch number cao nhất từ tất cả documents
      const snapshot = await this.firestore.collection('print-schedules').get().toPromise();
      
      let maxBatchNumber = 0;
      
      if (snapshot && !snapshot.empty) {
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          const batchNumber = data['batchNumber'] || 0;
          if (batchNumber > maxBatchNumber) {
            maxBatchNumber = batchNumber;
          }
        });
      }
      
      // Tăng lên 1 cho lần import mới
      const nextBatchNumber = maxBatchNumber + 1;
      
      // Reset to 1 if we reach 999
      const finalBatchNumber = nextBatchNumber > 999 ? 1 : nextBatchNumber;
      
      const batchId = String(finalBatchNumber).padStart(3, '0');
      console.log(`🆔 Generated batch ID: ${batchId} (import #${finalBatchNumber})`);
      return batchId;
      
    } catch (error) {
      console.error('❌ Error generating batch ID:', error);
      return '001'; // Fallback
    }
  }

  // Helper function to round to integer then make even
  private roundToEven(value: string | number | undefined): string {
    if (!value) return '';
    
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(numValue)) return value.toString();
    
    // Bước 1: Làm tròn thành số nguyên (21.9999999999 -> 22)
    const rounded = Math.round(numValue);
    
    // Bước 2: Làm chẵn - nếu là số lẻ thì cộng thêm 1
    const evenNumber = rounded % 2 === 0 ? rounded : rounded + 1;
    
    return evenNumber.toString();
  }

  private async cleanExcelData(data: any[]): Promise<ScheduleItem[]> {
    const headers = data[0];
    const rows = data.slice(1);
    
    // Tạo batch ID duy nhất cho lần import này
    const batchId = await this.generateBatchId(data);
    console.log(`🆔 Generated batch ID for this import: ${batchId}`);
    
    return rows.map((row: any[], index: number) => {
      const item: ScheduleItem = {};
      
      // Gán batch ID cho tất cả các record trong lần import này
      item.batch = batchId;
      
      headers.forEach((header: string, colIndex: number) => {
        const value = row[colIndex];
        const cleanHeader = header?.toString().trim().toLowerCase();
        
        switch (cleanHeader) {
          case 'batch': item.batch = value?.toString() || batchId; break; // Nếu có cột batch trong Excel thì dùng, không thì dùng auto-generated
          case 'nam': item.nam = value?.toString() || ''; break;
          case 'thang': item.thang = value?.toString() || ''; break;
          case 'stt': item.stt = value?.toString() || ''; break;
          case 'sizephoi': item.sizePhoi = value?.toString() || ''; break;
          case 'matem': item.maTem = value?.toString() || ''; break;
          case 'soluongyeucau': item.soLuongYeuCau = value?.toString() || ''; break;
          case 'soluongphoi': 
            // Tự động làm chẵn số lượng phôi
            item.soLuongPhoi = this.roundToEven(value); 
            break;
          case 'mahang': item.maHang = value?.toString() || ''; break;
          case 'lenhsanxuat': item.lenhSanXuat = value?.toString() || ''; break;
          case 'khachhang': item.khachHang = value?.toString() || ''; break;
          case 'ngaynhan': item.ngayNhanKeHoach = this.formatDateValue(value); break;
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
      // Load existing data first to merge with new data
      console.log('📥 Loading existing data to merge...');
      const existingSnapshot = await this.firestore.collection('print-schedules').get().toPromise();
      
      let existingData: ScheduleItem[] = [];
      let existingDocId: string | null = null;
      
      if (existingSnapshot && !existingSnapshot.empty) {
        // Get the most recent document
        const latestDoc = existingSnapshot.docs[0];
        const docData = latestDoc.data() as any;
        existingDocId = latestDoc.id;
        
        if (docData.data && Array.isArray(docData.data)) {
          existingData = docData.data;
          console.log(`📊 Found ${existingData.length} existing records to merge with`);
        }
      }

      // APPEND new data to existing data (merge approach)
      console.log('🔄 Merging new data with existing data...');

      // Merge existing data with new data
      const mergedData = [...existingData, ...data];
      console.log(`✅ Merged data: ${existingData.length} existing + ${data.length} new = ${mergedData.length} total records`);
      
      // Log details about the merge
      console.log('📊 Merge details:', {
        existingCount: existingData.length,
        newCount: data.length,
        totalCount: mergedData.length,
        newItems: data.map(item => ({
          maTem: item.maTem,
          batch: item.batch,
          tinhTrang: item.tinhTrang
        }))
      });
      
      // TÁCH MÃ DONE RA TRƯỚC KHI LƯU
      const doneItems = mergedData.filter(item => {
        const status = item.tinhTrang?.toLowerCase()?.trim();
        return status === 'done' || status === 'completed' || status === 'hoàn thành';
      });
      
      const notDoneItems = mergedData.filter(item => {
        const status = item.tinhTrang?.toLowerCase()?.trim();
        return status !== 'done' && status !== 'completed' && status !== 'hoàn thành';
      });
      
      console.log(`📊 Separated: ${doneItems.length} Done items, ${notDoneItems.length} not done items`);
      
      // Lưu mã Done vào collection riêng
      if (doneItems.length > 0) {
        await this.saveDoneItemsToSeparateCollection(doneItems);
      }
      
      // Chỉ lưu mã chưa Done vào collection chính
      const dataToSave = notDoneItems;
      
      // Get batch number from the first new item
      const batchNumber = data.length > 0 && data[0].batch ? parseInt(data[0].batch) : 1;
      
      // Create the document with merged data (only not done items)
      const labelScheduleDoc = {
        data: dataToSave,
        batchNumber: batchNumber, // Store batch number for sequential tracking
        importedAt: new Date(),
        month: this.getCurrentMonth(),
        year: new Date().getFullYear(),
        recordCount: dataToSave.length,
        lastUpdated: new Date(),
        importHistory: [
          {
            importedAt: new Date(),
            recordCount: data.length,
            batchNumber: batchNumber,
            month: this.getCurrentMonth(),
            year: new Date().getFullYear(),
            description: `Import ${data.length} new label schedules (batch ${String(batchNumber).padStart(3, '0')}) - merged with ${existingData.length} existing`
          }
        ],
        // Additional metadata for clarity
        collectionType: 'print-schedules',
        version: '1.0',
        status: 'active'
      };

      console.log('📤 Attempting to save merged label schedule data:', {
        totalRecords: labelScheduleDoc.recordCount,
        newRecords: data.length,
        existingRecords: existingData.length,
        doneItemsMoved: doneItems.length,
        month: labelScheduleDoc.month,
        year: labelScheduleDoc.year,
        timestamp: labelScheduleDoc.importedAt
      });

      // Save or update the document
      if (existingDocId) {
        // Update existing document
        await this.firestore.collection('print-schedules').doc(existingDocId).update(labelScheduleDoc);
        console.log(`✅ Updated existing document with ${mergedData.length} total records`);
      } else {
        // Create new document
        await this.firestore.collection('print-schedules').add(labelScheduleDoc);
        console.log(`✅ Created new document with ${mergedData.length} total records`);
      }
      
      this.firebaseSaved = true;
      console.log(`✅ Saved ${dataToSave.length} records to Firebase (${doneItems.length} Done items moved to separate collection) - Batch: ${String(batchNumber).padStart(3, '0')}`);
      
      alert(`✅ Đã lưu thành công!\n\n📊 Tổng cộng: ${dataToSave.length} bản ghi (Batch: ${String(batchNumber).padStart(3, '0')})\n📦 Mã Done: ${doneItems.length} đã chuyển sang collection riêng\n🔄 Đã thêm: ${data.length} bản ghi mới vào ${existingData.length} bản ghi cũ`);
      
      // Reload data from Firebase to display all merged records
      console.log('🔄 Reloading data from Firebase to display all records...');
      this.loadDataFromFirebase();
      
    } catch (error) {
      console.error('❌ Error saving to Firebase:', error);
    }
  }

  // Save to Firebase with REPLACE mode (for delete operations)
  async saveToFirebaseReplace(data: ScheduleItem[]): Promise<void> {
    console.log('🔥 Saving label data to Firebase (REPLACE mode)...');
    
    if (data.length === 0) {
      console.log('No data to save');
      return;
    }

    try {
      // TÁCH MÃ DONE RA TRƯỚC KHI LƯU
      const doneItems = data.filter(item => {
        const status = item.tinhTrang?.toLowerCase()?.trim();
        return status === 'done' || status === 'completed' || status === 'hoàn thành';
      });
      
      const notDoneItems = data.filter(item => {
        const status = item.tinhTrang?.toLowerCase()?.trim();
        return status !== 'done' && status !== 'completed' && status !== 'hoàn thành';
      });
      
      console.log(`📊 Separated: ${doneItems.length} Done items, ${notDoneItems.length} not done items`);
      
      // Lưu mã Done vào collection riêng
      if (doneItems.length > 0) {
        await this.saveDoneItemsToSeparateCollection(doneItems);
      }
      
      // Chỉ lưu mã chưa Done vào collection chính
      const dataToSave = notDoneItems;
      
      // Get the latest document ID to update
      const snapshot = await this.firestore.collection('print-schedules', ref => 
        ref.orderBy('importedAt', 'desc').limit(1)
      ).get().toPromise();
      
      if (snapshot && !snapshot.empty) {
        const latestDoc = snapshot.docs[0];
        const docId = latestDoc.id;
        
        // Get batch number from existing data
        const existingData = latestDoc.data() as any;
        const batchNumber = existingData.batchNumber || 1;
        
        // Create the document with replaced data (only not done items)
        const labelScheduleDoc = {
          data: dataToSave,
          batchNumber: batchNumber,
          importedAt: new Date(),
          month: this.getCurrentMonth(),
          year: new Date().getFullYear(),
          recordCount: dataToSave.length,
          lastUpdated: new Date(),
          importHistory: [
            {
              importedAt: new Date(),
              recordCount: dataToSave.length,
              batchNumber: batchNumber,
              month: this.getCurrentMonth(),
              year: new Date().getFullYear(),
              description: `Updated data (${dataToSave.length} records remaining, ${doneItems.length} Done items moved to separate collection)`
            }
          ],
          collectionType: 'print-schedules',
          version: '1.0',
          status: 'active'
        };

        // Update existing document
        await this.firestore.collection('print-schedules').doc(docId).update(labelScheduleDoc);
        console.log(`✅ Updated document with ${dataToSave.length} records (Done items moved to separate collection)`);
        
        this.firebaseSaved = true;
        console.log(`✅ Saved ${dataToSave.length} records to Firebase (REPLACE mode) - Batch: ${String(batchNumber).padStart(3, '0')}`);
        
        // Reload data from Firebase
        this.loadDataFromFirebase();
      } else {
        console.log('No existing document found to update');
      }
      
    } catch (error) {
      console.error('❌ Error saving to Firebase (REPLACE mode):', error);
    }
  }

  // Debug function to check raw Firebase data
  async debugFirebaseData(): Promise<void> {
    console.log('🔍 DEBUG: Checking raw Firebase data...');
    
    try {
      const snapshot = await this.firestore.collection('print-schedules').get().toPromise();
      console.log(`📊 Found ${snapshot.docs.length} documents in Firebase`);
      
      snapshot.docs.forEach((doc, docIndex) => {
        const data = doc.data() as any;
        console.log(`📄 Document ${docIndex + 1} (${doc.id}):`, {
          recordCount: data.recordCount,
          batchNumber: data.batchNumber,
          importedAt: data.importedAt,
          month: data.month,
          year: data.year,
          totalItems: data.data ? data.data.length : 0
        });
        
        if (data.data && Array.isArray(data.data)) {
          console.log(`📋 Raw data sample (first 3 items):`, data.data.slice(0, 3));
          console.log(`📋 Raw data sample (last 3 items):`, data.data.slice(-3));
          
          // Check for recent items (last 5)
          const recentItems = data.data.slice(-5);
          console.log(`🆕 Recent items (last 5):`, recentItems.map((item: any) => ({
            maTem: item.maTem,
            batch: item.batch,
            tinhTrang: item.tinhTrang,
            importedAt: item.importedAt || 'no timestamp'
          })));
        }
      });
    } catch (error) {
      console.error('❌ Error checking Firebase data:', error);
    }
  }

  // Tìm và khôi phục dữ liệu cũ
  async findLostData(): Promise<void> {
    console.log('🔍 Tìm kiếm dữ liệu cũ đã mất...');
    
    try {
      // Kiểm tra tất cả documents trong collection
      const snapshot = await this.firestore.collection('print-schedules', ref => 
        ref.orderBy('importedAt', 'desc')
      ).get().toPromise();
      
      console.log(`📊 Tìm thấy ${snapshot.docs.length} documents trong Firebase`);
      
      let totalItems = 0;
      let allItems: ScheduleItem[] = [];
      let allNotDoneItems: ScheduleItem[] = [];
      
      snapshot.docs.forEach((doc, docIndex) => {
        const data = doc.data() as any;
        console.log(`📄 Document ${docIndex + 1} (${doc.id}):`, {
          recordCount: data.recordCount,
          batchNumber: data.batchNumber,
          importedAt: data.importedAt,
          month: data.month,
          year: data.year,
          totalItems: data.data ? data.data.length : 0
        });
        
        if (data.data && Array.isArray(data.data)) {
          totalItems += data.data.length;
          allItems.push(...data.data);
          
          // Lọc mã chưa Done từ tất cả documents
          const notDoneItems = data.data.filter((item: any) => {
              const status = item.tinhTrang?.toLowerCase()?.trim();
              return status !== 'done' && status !== 'completed' && status !== 'hoàn thành';
          });
          
          allNotDoneItems.push(...notDoneItems);
          console.log(`📊 Document ${docIndex + 1}: ${data.data.length} total → ${notDoneItems.length} not done`);
        }
      });
      
      console.log(`📊 Tổng cộng: ${totalItems} items trong tất cả documents`);
      console.log(`📊 Mã chưa Done: ${allNotDoneItems.length} items`);
      console.log(`📊 Dữ liệu hiện tại: ${this.scheduleData.length} items`);
      
      // So sánh với dữ liệu hiện tại (chỉ mã chưa Done)
      if (allNotDoneItems.length > this.scheduleData.length) {
        const lostCount = allNotDoneItems.length - this.scheduleData.length;
        console.log(`⚠️ PHÁT HIỆN: Có ${lostCount} mã chưa Done bị mất!`);
        
        // Hiển thị dữ liệu bị mất
        const lostItems = allNotDoneItems.filter(item => 
          !this.scheduleData.some(current => 
            current.maTem === item.maTem && current.batch === item.batch
          )
        );
        
        console.log(`🔍 Dữ liệu bị mất (${lostItems.length} items):`, lostItems.map(item => ({
          maTem: item.maTem,
          batch: item.batch,
          tinhTrang: item.tinhTrang,
          khachHang: item.khachHang
        })));
        
        // Hỏi có muốn khôi phục không
        const confirmRestore = confirm(`🔍 Tìm thấy ${lostCount} mã chưa Done bị mất!\n\n` +
          `📊 Hiện tại: ${this.scheduleData.length} mã\n` +
          `📊 Tổng cộng: ${allNotDoneItems.length} mã chưa Done\n` +
          `📊 Tổng tất cả: ${totalItems} mã (bao gồm Done)\n\n` +
          `Bạn có muốn khôi phục dữ liệu bị mất không?`);
        
        if (confirmRestore) {
          // Khôi phục dữ liệu (chỉ mã chưa Done)
          this.scheduleData = allNotDoneItems;
          await this.saveToFirebaseDirect(this.scheduleData);
          
          alert(`✅ Đã khôi phục ${lostCount} mã bị mất!\n\n` +
                `📊 Tổng cộng: ${this.scheduleData.length} mã chưa Done`);
        }
      } else {
        console.log('✅ Không có dữ liệu chưa Done bị mất');
        alert(`✅ Không có dữ liệu chưa Done bị mất!\n\n` +
              `📊 Hiện tại: ${this.scheduleData.length} mã\n` +
              `📊 Tổng cộng: ${allNotDoneItems.length} mã chưa Done\n` +
              `📊 Tổng tất cả: ${totalItems} mã (bao gồm Done)`);
      }
      
    } catch (error) {
      console.error('❌ Lỗi khi tìm kiếm dữ liệu:', error);
      alert('❌ Lỗi khi tìm kiếm dữ liệu!');
    }
  }

  // Hiển thị tất cả mã trong Firebase (bao gồm cả Done)
  async showAllFirebaseData(): Promise<void> {
    console.log('🔍 Hiển thị TẤT CẢ mã trong Firebase...');
    
    try {
      // Kiểm tra tất cả documents trong collection
      const snapshot = await this.firestore.collection('print-schedules', ref => 
        ref.orderBy('importedAt', 'desc')
      ).get().toPromise();
      
      console.log(`📊 Tìm thấy ${snapshot.docs.length} documents trong Firebase`);
      
      let totalItems = 0;
      let allItems: ScheduleItem[] = [];
      let doneItems: ScheduleItem[] = [];
      let notDoneItems: ScheduleItem[] = [];
      
      snapshot.docs.forEach((doc, docIndex) => {
        const data = doc.data() as any;
        console.log(`📄 Document ${docIndex + 1} (${doc.id}):`, {
          recordCount: data.recordCount,
          batchNumber: data.batchNumber,
              importedAt: data.importedAt,
              month: data.month,
          year: data.year,
          totalItems: data.data ? data.data.length : 0
        });
        
        if (data.data && Array.isArray(data.data)) {
          totalItems += data.data.length;
          allItems.push(...data.data);
          
          // Phân loại Done và chưa Done
          data.data.forEach((item: any) => {
            const status = item.tinhTrang?.toLowerCase()?.trim();
            if (status === 'done' || status === 'completed' || status === 'hoàn thành') {
              doneItems.push(item);
            } else {
              notDoneItems.push(item);
            }
          });
        }
      });
      
      // Thống kê theo tình trạng
      const statusCounts = allItems.reduce((acc: any, item: any) => {
        const status = item.tinhTrang || 'Chưa xác định';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {});
      
      console.log('📊 THỐNG KÊ TỔNG QUAN:');
      console.log(`📊 Tổng cộng: ${totalItems} mã`);
      console.log(`📊 Mã Done: ${doneItems.length} mã`);
      console.log(`📊 Mã chưa Done: ${notDoneItems.length} mã`);
      console.log(`📊 Hiện tại hiển thị: ${this.scheduleData.length} mã`);
      
      console.log('📊 THỐNG KÊ THEO TÌNH TRẠNG:');
      Object.entries(statusCounts).forEach(([status, count]) => {
        console.log(`📊 ${status}: ${count} mã`);
      });
      
      console.log('📋 DANH SÁCH TẤT CẢ MÃ:');
      allItems.forEach((item, index) => {
        console.log(`${index + 1}. ${item.maTem} | ${item.tinhTrang} | ${item.khachHang} | Batch: ${item.batch}`);
      });
      
      // Hiển thị alert với thống kê
      const statusList = Object.entries(statusCounts)
        .map(([status, count]) => `${status}: ${count}`)
        .join('\n');
      
      alert(`📊 TẤT CẢ MÃ TRONG FIREBASE:\n\n` +
            `📊 Tổng cộng: ${totalItems} mã\n` +
            `📊 Mã Done: ${doneItems.length} mã\n` +
            `📊 Mã chưa Done: ${notDoneItems.length} mã\n` +
            `📊 Hiện tại hiển thị: ${this.scheduleData.length} mã\n\n` +
            `📊 CHI TIẾT THEO TÌNH TRẠNG:\n${statusList}\n\n` +
            `💡 Xem Console (F12) để xem danh sách chi tiết!`);
      
    } catch (error) {
      console.error('❌ Lỗi khi tìm kiếm dữ liệu:', error);
      alert('❌ Lỗi khi tìm kiếm dữ liệu!');
    }
  }

  loadDataFromFirebase(): void {
    console.log('🔥 Loading data from Firebase...');
    
    this.firestore.collection('print-schedules', ref => 
      ref.orderBy('importedAt', 'desc').limit(1)
    ).get().subscribe((querySnapshot) => {
      const allData: ScheduleItem[] = [];
      
      if (querySnapshot.docs.length > 0) {
        const latestDoc = querySnapshot.docs[0];
        const data = latestDoc.data() as any;
        
        if (data.data && Array.isArray(data.data)) {
          // CHỈ LOAD MÃ CHƯA DONE
          const notDoneItems = data.data.filter((item: any) => {
            const status = item.tinhTrang?.toLowerCase()?.trim();
            return status !== 'done' && status !== 'completed' && status !== 'hoàn thành';
          }).map((item: any) => {
            // Convert Firestore timestamp to Date
            if (item.statusUpdateTime && item.statusUpdateTime.toDate) {
              item.statusUpdateTime = item.statusUpdateTime.toDate();
            } else if (item.statusUpdateTime && typeof item.statusUpdateTime === 'string') {
              item.statusUpdateTime = new Date(item.statusUpdateTime);
            } else if (!item.statusUpdateTime) {
              // Nếu chưa có thời gian, tạo mới
              item.statusUpdateTime = new Date();
            }
            return item;
          });
          
          allData.push(...notDoneItems);
          console.log(`📊 Filtered: ${data.data.length} total → ${notDoneItems.length} not done items`);
        }
      }
      
      this.scheduleData = allData;
      this.firebaseSaved = this.scheduleData.length > 0;
      console.log(`🔥 Loaded ${this.scheduleData.length} records from Firebase (Done items excluded)`);
      
      // Log status update times for debugging
      this.scheduleData.forEach((item, index) => {
        console.log(`Item ${index + 1} (${item.maTem}): statusUpdateTime =`, item.statusUpdateTime);
      });
    }, error => {
      console.error('❌ Error loading from Firebase:', error);
    });
  }

  // Lưu mã Done vào Firebase riêng
  async saveDoneItemsToSeparateCollection(doneItems: ScheduleItem[]): Promise<void> {
    if (doneItems.length === 0) return;
    
    try {
      console.log(`💾 Saving ${doneItems.length} Done items to separate collection...`);
      
      const doneData = {
        data: doneItems,
        savedAt: new Date(),
        count: doneItems.length,
        type: 'completed_items'
      };
      
      await this.firestore.collection('completed-schedules').add(doneData);
      console.log(`✅ Saved ${doneItems.length} Done items to completed-schedules collection`);
    } catch (error) {
      console.error('❌ Error saving Done items:', error);
    }
  }

  // Xóa các mã trùng lặp
  async removeDuplicateItems(): Promise<void> {
    if (this.scheduleData.length === 0) {
      alert('Không có dữ liệu để kiểm tra trùng lặp!');
      return;
    }

    console.log('🔍 Đang kiểm tra mã trùng lặp...');
    
    // Tạo key để so sánh dựa trên các cột được chỉ định
    const createComparisonKey = (item: ScheduleItem): string => {
      return [
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
        item.lineNhan || ''
      ].join('|');
    };

    // Tìm các mã trùng lặp và giữ lại bản có Batch nhỏ nhất
    const seen = new Map<string, ScheduleItem>();
    const duplicates: ScheduleItem[] = [];
    const uniqueItems: ScheduleItem[] = [];

    this.scheduleData.forEach(item => {
      const key = createComparisonKey(item);
      
      if (seen.has(key)) {
        // Đây là mã trùng - so sánh Batch number
        const existingItem = seen.get(key)!;
        const existingBatch = parseInt(existingItem.batch || '999');
        const currentBatch = parseInt(item.batch || '999');
        
        if (currentBatch < existingBatch) {
          // Bản hiện tại có Batch nhỏ hơn - thay thế
          duplicates.push(existingItem);
          seen.set(key, item);
          uniqueItems[uniqueItems.indexOf(existingItem)] = item;
          console.log(`🔄 Thay thế mã trùng: ${item.maTem} (Batch ${existingBatch} → ${currentBatch})`);
        } else {
          // Bản hiện tại có Batch lớn hơn - giữ bản cũ
          duplicates.push(item);
          console.log(`🔄 Giữ bản cũ: ${item.maTem} (Batch ${currentBatch} > ${existingBatch})`);
        }
      } else {
        // Đây là mã duy nhất
        seen.set(key, item);
        uniqueItems.push(item);
      }
    });

    if (duplicates.length === 0) {
      alert('✅ Không có mã trùng lặp nào được tìm thấy!');
      return;
    }

    // Xác nhận xóa
    const confirmMessage = `🔍 Tìm thấy ${duplicates.length} mã trùng lặp!\n\n` +
      `📊 Tổng mã hiện tại: ${this.scheduleData.length}\n` +
      `📊 Sau khi xóa: ${uniqueItems.length}\n\n` +
      `Bạn có chắc chắn muốn xóa các mã trùng lặp?`;
    
    if (confirm(confirmMessage)) {
      // Cập nhật dữ liệu
      this.scheduleData = uniqueItems;
      
      // Lưu vào Firebase (không tách mã Done khi xóa trùng)
      await this.saveToFirebaseDirect(this.scheduleData);
      
      alert(`✅ Đã xóa ${duplicates.length} mã trùng lặp!\n\n` +
            `📊 Trước: ${this.scheduleData.length + duplicates.length} mã\n` +
            `📊 Sau: ${this.scheduleData.length} mã`);
      
      console.log(`✅ Đã xóa ${duplicates.length} mã trùng lặp, còn lại ${uniqueItems.length} mã duy nhất`);
    }
  }

  // Lưu trực tiếp vào Firebase (không tách mã Done)
  async saveToFirebaseDirect(data: ScheduleItem[]): Promise<void> {
    console.log('🔥 Saving data directly to Firebase (no Done separation)...');
    
    if (data.length === 0) {
      console.log('No data to save');
      return;
    }

    try {
      // Get the latest document ID to update
      const snapshot = await this.firestore.collection('print-schedules', ref => 
        ref.orderBy('importedAt', 'desc').limit(1)
      ).get().toPromise();
      
      if (snapshot && !snapshot.empty) {
        const latestDoc = snapshot.docs[0];
        const docId = latestDoc.id;
        
        // Get batch number from existing data
        const existingData = latestDoc.data() as any;
        const batchNumber = existingData.batchNumber || 1;
        
        // Create the document with direct data (no Done separation)
        const labelScheduleDoc = {
          data: data,
          batchNumber: batchNumber,
          importedAt: new Date(),
          month: this.getCurrentMonth(),
          year: new Date().getFullYear(),
          recordCount: data.length,
          lastUpdated: new Date(),
          importHistory: [
            {
              importedAt: new Date(),
              recordCount: data.length,
              batchNumber: batchNumber,
              month: this.getCurrentMonth(),
              year: new Date().getFullYear(),
              description: `Direct update (${data.length} records after duplicate removal)`
            }
          ],
          collectionType: 'print-schedules',
          version: '1.0',
          status: 'active'
        };

        // Update existing document
        await this.firestore.collection('print-schedules').doc(docId).update(labelScheduleDoc);
        console.log(`✅ Updated document with ${data.length} records (direct save)`);
        
        this.firebaseSaved = true;
        console.log(`✅ Saved ${data.length} records to Firebase (direct save) - Batch: ${String(batchNumber).padStart(3, '0')}`);
        
        // Reload data from Firebase
        this.loadDataFromFirebase();
      } else {
        console.log('No existing document found to update');
      }
      
    } catch (error) {
      console.error('❌ Error saving to Firebase (direct):', error);
    }
  }

  // Test nguyên tắc tạo batch ID
  async testBatchGeneration(): Promise<void> {
    console.log('🧪 Testing batch generation logic...');
    
    try {
      // Lấy batch number cao nhất hiện tại
      const snapshot = await this.firestore.collection('print-schedules').get().toPromise();
      
      let maxBatchNumber = 0;
      let batchCounts: { [key: number]: number } = {};
      
      if (snapshot && !snapshot.empty) {
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          const batchNumber = data['batchNumber'] || 0;
          if (batchNumber > maxBatchNumber) {
            maxBatchNumber = batchNumber;
          }
          batchCounts[batchNumber] = (batchCounts[batchNumber] || 0) + 1;
        });
      }
      
      const nextBatchNumber = maxBatchNumber + 1;
      const finalBatchNumber = nextBatchNumber > 999 ? 1 : nextBatchNumber;
      
      console.log('📊 BATCH GENERATION TEST RESULTS:');
      console.log(`📊 Current max batch: ${maxBatchNumber}`);
      console.log(`📊 Next batch will be: ${finalBatchNumber}`);
      console.log(`📊 Total documents: ${snapshot?.docs.length || 0}`);
      
      console.log('📊 Batch distribution:');
      Object.entries(batchCounts).forEach(([batch, count]) => {
        console.log(`📊 Batch ${batch}: ${count} documents`);
      });
      
      // Test với dữ liệu giả
      const testData = [
        ['Nam', 'Thang', 'MaTem'],
        ['2025', '9', 'TEST001']
      ];
      
      const testBatch1 = await this.generateBatchId(testData);
      const testBatch2 = await this.generateBatchId(testData); // Cùng file
      const testBatch3 = await this.generateBatchId(testData); // Cùng file
      
      console.log('🧪 TEST RESULTS:');
      console.log(`🧪 Same file import 1: Batch ${testBatch1}`);
      console.log(`🧪 Same file import 2: Batch ${testBatch2}`);
      console.log(`🧪 Same file import 3: Batch ${testBatch3}`);
      
      const isCorrect = testBatch1 !== testBatch2 && testBatch2 !== testBatch3;
      console.log(`🧪 Logic correct: ${isCorrect ? '✅ YES' : '❌ NO'}`);
      
      alert(`🧪 BATCH GENERATION TEST:\n\n` +
            `📊 Current max batch: ${maxBatchNumber}\n` +
            `📊 Next batch: ${finalBatchNumber}\n` +
            `📊 Same file test:\n` +
            `   - Import 1: ${testBatch1}\n` +
            `   - Import 2: ${testBatch2}\n` +
            `   - Import 3: ${testBatch3}\n\n` +
            `✅ Logic: ${isCorrect ? 'CORRECT' : 'INCORRECT'}\n\n` +
            `💡 Xem Console (F12) để xem chi tiết!`);
      
    } catch (error) {
      console.error('❌ Error testing batch generation:', error);
      alert('❌ Lỗi khi test batch generation!');
    }
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

  /**
   * Chuẩn hóa "Ngày nhận kế hoạch" để sắp xếp (DD/MM/YYYY phổ biến trong sheet / Firebase).
   * Trả về timestamp; không có ngày hoặc không đọc được → cuối danh sách.
   */
  private parseNgayNhanKeHoachToTime(raw?: string): number {
    const s = String(raw ?? '').trim();
    if (!s) {
      return Number.MAX_SAFE_INTEGER;
    }
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) {
      const d = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      const y = parseInt(m[3], 10);
      const dt = new Date(y, mo, d);
      if (!isNaN(dt.getTime())) {
        return dt.getTime();
      }
    }
    const m2 = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m2) {
      const dt = new Date(parseInt(m2[1], 10), parseInt(m2[2], 10) - 1, parseInt(m2[3], 10));
      if (!isNaN(dt.getTime())) {
        return dt.getTime();
      }
    }
    const t = Date.parse(s);
    if (!isNaN(t)) {
      return t;
    }
    return Number.MAX_SAFE_INTEGER - 1;
  }

  getFilteredData(): ScheduleItem[] {
    let filtered = [...this.scheduleData];
    console.log('🔍 Initial data count:', this.scheduleData.length);
    
    if (this.searchTerm) {
      const term = this.searchTerm.toLowerCase().trim();
      filtered = filtered.filter(item => {
        // Tìm kiếm theo batch (3 chữ số) - ưu tiên cao nhất
        const batchMatch = item.batch?.toLowerCase().includes(term) || 
                          item.batch?.padStart(3, '0').includes(term) ||
                          item.batch === term;
        
        // Tìm kiếm theo mã tem - ưu tiên cao
        const maTemMatch = item.maTem?.toLowerCase().includes(term);
        
        // Tìm kiếm theo khách hàng - ưu tiên cao
        const khachHangMatch = item.khachHang?.toLowerCase().includes(term);
        
        // Chỉ tìm kiếm theo 3 trường chính: Batch, Mã tem, Khách hàng
        return batchMatch || maTemMatch || khachHangMatch;
      });
      console.log('🔍 After search filter (Batch/Mã tem/Khách hàng):', filtered.length);
    }
    
    if (this.currentStatusFilter) {
      const f = this.normalizeTinhTrangName(this.currentStatusFilter);
      filtered = filtered.filter(
        item => this.normalizeTinhTrangName(String(item.tinhTrang ?? '')) === f
      );
      console.log('🔍 After status filter:', filtered.length);
    }
    
    // Note: Done items are already filtered out at Firebase level
    // No need to filter again here

    filtered.sort((a, b) => {
      const ta = this.parseNgayNhanKeHoachToTime(a.ngayNhanKeHoach);
      const tb = this.parseNgayNhanKeHoachToTime(b.ngayNhanKeHoach);
      if (ta !== tb) {
        return ta - tb;
      }
      return String(a.maTem ?? '').localeCompare(String(b.maTem ?? ''), 'vi', { sensitivity: 'base' });
    });

    console.log('🔍 Final filtered count:', filtered.length);
    return filtered;
  }

  getDisplayScheduleData(): ScheduleItem[] {
    // Return filtered data for display
    return this.getFilteredData();
  }

  private formatQtyPcs(qty: unknown): string {
    const s = String(qty ?? '').trim();
    if (!s) return '';
    return /pcs$/i.test(s) ? s : `${s}pcs`;
  }

  private formatEmployeeCode(emailOrUid: unknown): string {
    const s = String(emailOrUid ?? '').trim();
    if (!s) return 'UNKNOWN';
    const code = s.includes('@') ? s.split('@')[0] : s;
    return code.toUpperCase();
  }

  /**
   * Màu theo hạn Ngày nhận kế hoạch:
   * - future: chưa tới ngày (xanh)
   * - today: đúng ngày nhận (cam)
   * - overdue: quá hạn (đỏ)
   */
  getDueState(item: ScheduleItem): 'future' | 'today' | 'overdue' | '' {
    const t = this.parseNgayNhanKeHoachToTime(item.ngayNhanKeHoach);
    if (!t) return '';

    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startTomorrow = startToday + 24 * 60 * 60 * 1000;

    if (t < startToday) return 'overdue';
    if (t >= startToday && t < startTomorrow) return 'today';
    return 'future';
  }

  getTotalDisplayCount(): number {
    return this.getDisplayScheduleData().length;
  }

  getTotalPages(): number {
    const total = this.getTotalDisplayCount();
    return Math.max(1, Math.ceil(total / this.pageSize));
  }

  getPagedDisplayScheduleData(): ScheduleItem[] {
    const all = this.getDisplayScheduleData();
    const totalPages = Math.max(1, Math.ceil(all.length / this.pageSize));
    if (this.pageIndex > totalPages) this.pageIndex = totalPages;
    if (this.pageIndex < 1) this.pageIndex = 1;
    const start = (this.pageIndex - 1) * this.pageSize;
    return all.slice(start, start + this.pageSize);
  }

  goToPage(page: number): void {
    const total = this.getTotalPages();
    this.pageIndex = Math.min(Math.max(1, page), total);
  }

  prevPage(): void {
    this.goToPage(this.pageIndex - 1);
  }

  nextPage(): void {
    this.goToPage(this.pageIndex + 1);
  }

  onPageSizeChange(next: number | string): void {
    const v = typeof next === 'string' ? parseInt(next, 10) : next;
    if (!Number.isFinite(v) || v <= 0) return;
    this.pageSize = Math.min(10, v);
    this.pageIndex = 1;
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
    
    // Làm tròn thành số nguyên (21.9999999999 -> 22)
    const rounded = Math.round(num);
    
    return rounded.toString();
  }

  /** Các chip đếm theo danh mục Tình trạng (More → Tình trạng) + Pass (luôn có để lọc IQC) */
  getStatusChipsForDisplay(): string[] {
    const src = this.tinhTrangCatalog.length > 0 ? this.tinhTrangCatalog : [...this.DEFAULT_TINH_TRANG];
    const out = [...src];
    if (!out.includes('Pass')) {
      out.push('Pass');
    }
    return out;
  }

  getTinhTrangCount(status: string): number {
    const s = this.normalizeTinhTrangName(status);
    return this.scheduleData.filter(item => this.normalizeTinhTrangName(String(item.tinhTrang ?? '')) === s).length;
  }

  getStatusChipLabel(status: string): string {
    return this.normalizeTinhTrangName(status).toLocaleUpperCase('vi-VN');
  }

  getNotDoneItemsCount(): number {
    return this.scheduleData.filter(item => item.tinhTrang !== 'Done').length;
  }

  // Filter methods
  filterByStatus(status: string): void {
    this.currentStatusFilter = this.currentStatusFilter === status ? '' : status;
    this.pageIndex = 1;
  }

  clearStatusFilter(): void {
    this.currentStatusFilter = '';
    this.pageIndex = 1;
  }

  onSearchChange(event: any): void {
    this.searchTerm = event.target.value;
    this.pageIndex = 1;
  }

  async toggleShowCompletedItems(): Promise<void> {
    this.showCompletedItems = !this.showCompletedItems;
    
    // Nếu đang bật hiển thị Done và chưa load Done items
    if (this.showCompletedItems && !this.doneItemsLoaded) {
      await this.loadDoneItems();
    }
  }

  // Load Done items từ collection riêng
  async loadDoneItems(): Promise<void> {
    try {
      console.log('📦 Loading Done items from completed-schedules collection...');
      
      // Load 100 mã Done gần nhất
      const snapshot = await this.firestore.collection('completed-schedules', ref => 
        ref.orderBy('savedAt', 'desc').limit(100)
      ).get().toPromise();
      
      const allDoneItems: ScheduleItem[] = [];
      
      if (snapshot && !snapshot.empty) {
        snapshot.docs.forEach(doc => {
          const data = doc.data() as any;
          if (data.data && Array.isArray(data.data)) {
            allDoneItems.push(...data.data);
          }
        });
      }
      
      // Sắp xếp theo thời gian lưu gần nhất
      allDoneItems.sort((a, b) => {
        const timeA = a.statusUpdateTime || new Date(0);
        const timeB = b.statusUpdateTime || new Date(0);
        return timeB.getTime() - timeA.getTime();
      });
      
      // Chỉ lấy 100 mã gần nhất
      this.doneItems = allDoneItems.slice(0, 100);
      this.doneItemsLoaded = true;
      
      console.log(`📦 Loaded ${this.doneItems.length} Done items (latest 100)`);
      
      // Nếu có nhiều hơn 100 mã Done, thông báo
      if (allDoneItems.length > 100) {
        const remainingCount = allDoneItems.length - 100;
        alert(`📦 Đã load 100 mã Done gần nhất!\n\n` +
              `⚠️ Còn ${remainingCount} mã Done khác.\n` +
              `💡 Sử dụng nút Download để tải xuống tất cả mã Done (Excel)`);
      }
      
    } catch (error) {
      console.error('❌ Error loading Done items:', error);
      alert('❌ Lỗi khi load mã Done!');
    }
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
  async showDoneItemsList(): Promise<void> {
    console.log('Show done items list clicked');
    
    try {
      // Load tất cả mã Done từ collection riêng
      const snapshot = await this.firestore.collection('completed-schedules', ref => 
        ref.orderBy('savedAt', 'desc')
      ).get().toPromise();
      
      const allDoneItems: ScheduleItem[] = [];
      
      if (snapshot && !snapshot.empty) {
        snapshot.docs.forEach(doc => {
          const data = doc.data() as any;
          if (data.data && Array.isArray(data.data)) {
            allDoneItems.push(...data.data);
          }
        });
      }
      
      if (allDoneItems.length === 0) {
        alert('Không có mã Done nào để tải xuống!');
      return;
    }
      
      const doneItems = allDoneItems;
    
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
      
    } catch (error) {
      console.error('❌ Error loading Done items for export:', error);
      alert('❌ Lỗi khi tải xuống mã Done!');
    }
  }

  // Table interaction methods
  canEditField(fieldName: string): boolean {
    // Allow editing for all fields
    return true;
  }

  onFieldChange(item: ScheduleItem, fieldName: string): void {
    console.log(`Field ${fieldName} changed for item:`, item.maTem);
    
    // Cập nhật thời gian khi thay đổi tình trạng
    if (fieldName === 'tinhTrang') {
      item.statusUpdateTime = new Date();
      console.log('Status update time set to:', item.statusUpdateTime);
      
      // Trigger change detection
      this.scheduleData = [...this.scheduleData];
    }
    
    // Save to Firebase
    this.saveToFirebaseReplace(this.scheduleData);
  }

  deleteItem(item: ScheduleItem): void {
    if (confirm(`Bạn có chắc chắn muốn xóa mã tem "${item.maTem}"?`)) {
      const index = this.scheduleData.indexOf(item);
      if (index > -1) {
        this.scheduleData.splice(index, 1);
        // Sử dụng saveToFirebaseReplace để xóa thật khỏi Firebase
        this.saveToFirebaseReplace(this.scheduleData);
        console.log(`🗑️ Deleted item: ${item.maTem} from Firebase`);
      }
    }
  }

  onNoteBlur(item: ScheduleItem, event: any): void {
    console.log('Note blur for item:', item.maTem);
    item.statusUpdateTime = new Date();
    // Sử dụng saveToFirebaseReplace để cập nhật thật vào Firebase
    this.saveToFirebaseReplace(this.scheduleData);
  }

  onNoteKeyPress(event: KeyboardEvent, item: ScheduleItem): void {
    if (event.key === 'Enter') {
      console.log('Note saved on Enter for item:', item.maTem);
      item.statusUpdateTime = new Date();
      // Sử dụng saveToFirebaseReplace để cập nhật thật vào Firebase
      this.saveToFirebaseReplace(this.scheduleData);
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

  // ==================== QR LABEL PRINTING ====================

  private getScheduleItemQrData(item: ScheduleItem): { maTem: string; soLuongTem: string; lenhSanXuat: string } | null {
    const maTem = (item.maTem || '').trim();
    if (!maTem) return null;
    const soLuongTem = (item.soLuongYeuCau || item.soLuongPhoi || '').toString().trim();
    const lenhSanXuat = (item.lenhSanXuat || '').toString().trim();
    return { maTem, soLuongTem, lenhSanXuat };
  }

  async printBatchPrintedQrLabels(): Promise<void> {
    try {
      const items = this.getDisplayScheduleData()
        .filter(item => (item.tinhTrang || '').toString().trim() === 'Chờ in');

      if (!items.length) {
        alert('⚠️ Không có dòng nào có tình trạng "Chờ in" để in.');
        return;
      }

      const user = await this.auth.currentUser;
      const currentUser = user ? user.email || user.uid : 'UNKNOWN';
      const employeeCode = this.formatEmployeeCode(currentUser);

      const labelHtmlParts: string[] = [];

      for (const item of items) {
        const d = this.getScheduleItemQrData(item);
        if (!d) continue;
        const qrData = `${d.maTem}|${d.soLuongTem}|${d.lenhSanXuat}`;
        const qtyPcs = this.formatQtyPcs(d.soLuongTem);
        const lineNhan = (item.lineNhan || '').toString().trim();

        const qrImage = await QRCode.toDataURL(qrData, {
          width: 240,
          margin: 1,
          color: { dark: '#000000', light: '#FFFFFF' }
        });

        labelHtmlParts.push(`
          <div class="qr-container">
            <div class="qr-section">
              <img src="${qrImage}" class="qr-image" alt="QR Code">
            </div>
            <div class="info-section">
              <div>
                <div class="info-row big">${d.maTem}</div>
                <div class="info-row big">${qtyPcs}</div>
                <div class="info-row">LSX: ${d.lenhSanXuat}</div>
                <div class="info-row">LINE: ${lineNhan || '-'}</div>
              </div>
              <div>
                <div class="info-row small">NV: ${employeeCode}</div>
              </div>
            </div>
          </div>
        `);
      }

      if (!labelHtmlParts.length) {
        alert('⚠️ Không có dữ liệu tem hợp lệ để in.');
        return;
      }

      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('❌ Không thể mở cửa sổ in. Vui lòng kiểm tra popup blocker.');
        return;
      }

      printWindow.document.write(`
        <html>
          <head>
            <title></title>
            <style>
              * { margin: 0 !important; padding: 0 !important; box-sizing: border-box !important; }
              body {
                font-family: Arial, sans-serif;
                margin: 0 !important;
                padding: 0 !important;
                background: white !important;
              }
              .qr-container {
                display: flex !important;
                margin: 0 !important;
                padding: 0 !important;
                border: 1px solid #000 !important;
                width: 57mm !important;
                height: 32mm !important;
                page-break-after: always !important;
                page-break-inside: avoid !important;
                background: white !important;
                box-sizing: border-box !important;
              }
              .qr-container:last-child { page-break-after: auto !important; }
              .qr-section {
                width: 30mm !important;
                height: 30mm !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                border-right: 1px solid #ccc !important;
              }
              .qr-image { width: 28mm !important; height: 28mm !important; display: block !important; }
              .info-section {
                flex: 1 !important;
                padding: 1mm !important;
                display: flex !important;
                flex-direction: column !important;
                justify-content: space-between !important;
                font-size: 9.6px !important;
                line-height: 1.1 !important;
                color: #000000 !important;
              }
              .info-row { margin: 0.3mm 0 !important; font-weight: bold !important; color: #000000 !important; }
              .info-row.big { font-size: 18px !important; line-height: 1.0 !important; letter-spacing: 0.02em !important; }
              .info-row.small { font-size: 8.4px !important; color: #000000 !important; }
              @media print {
                @page { margin: 0 !important; size: 57mm 32mm !important; }
                html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              }
            </style>
          </head>
          <body>
            ${labelHtmlParts.join('')}
            <script>
              window.onload = function() {
                document.title = '';
                setTimeout(() => { window.print(); }, 300);
              }
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();

    } catch (error: any) {
      console.error('❌ Error batch printing QR labels:', error);
      alert(`❌ Lỗi khi in hàng loạt: ${error?.message || error}`);
    }
  }
  
  async printQRLabel(item: ScheduleItem): Promise<void> {
    console.log('🖨️ Printing QR label for:', item);

    if (!item.maTem) {
      alert('⚠️ Mã tem không tồn tại!');
      return;
    }
    
    // Show print instructions
    console.log('💡 Lưu ý: Trong Print Settings, bỏ tick "Headers and footers" để ẩn thông tin ngoài lề');
    console.log('💡 Note: In Print Settings, uncheck "Headers and footers" to hide margins')

    try {
      // Prepare QR data: maTem|soLuongTem|lenhSanXuat
      const maTem = item.maTem || '';
      const soLuongTem = item.soLuongYeuCau || item.soLuongPhoi || '';
      const lenhSanXuat = item.lenhSanXuat || '';
      const qtyPcs = this.formatQtyPcs(soLuongTem);
      const lineNhan = (item.lineNhan || '').toString().trim();
      
      const qrData = `${maTem}|${soLuongTem}|${lenhSanXuat}`;
      console.log('📝 QR Data:', qrData);

      // Generate QR code image
      const qrImage = await QRCode.toDataURL(qrData, {
        width: 240, // 30mm = 240px (8px/mm)
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });

      // Get current user info
      const user = await this.auth.currentUser;
      const currentUser = user ? user.email || user.uid : 'UNKNOWN';
      const employeeCode = this.formatEmployeeCode(currentUser);

      // Create print window
      const printWindow = window.open('', '_blank');
      if (printWindow) {
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
                  font-size: 9.6px !important;
                  line-height: 1.1 !important;
                  box-sizing: border-box !important;
                  color: #000000 !important;
                }
                
                .info-row {
                  margin: 0.3mm 0 !important;
                  font-weight: bold !important;
                  color: #000000 !important;
                }
                
                .info-row.small {
                  font-size: 8.4px !important;
                  color: #000000 !important;
                }
                
                .info-row.big {
                  font-size: 18px !important;
                  line-height: 1.0 !important;
                  letter-spacing: 0.02em !important;
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
                  
                  /* Hide browser headers and footers */
                  @page {
                    margin: 0;
                  }
                  
                  html, body {
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
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
                    font-size: 9.6px !important;
                    padding: 1mm !important;
                    color: #000000 !important;
                  }
                  
                  .info-row.small {
                    font-size: 8.4px !important;
                    color: #000000 !important;
                  }
                }
              </style>
            </head>
            <body>
              <div class="qr-container">
                <div class="qr-section">
                  <img src="${qrImage}" class="qr-image" alt="QR Code">
                </div>
                <div class="info-section">
                  <div>
                    <div class="info-row big">${maTem}</div>
                    <div class="info-row big">${qtyPcs}</div>
                    <div class="info-row">LSX: ${lenhSanXuat}</div>
                    <div class="info-row">LINE: ${lineNhan || '-'}</div>
                  </div>
                  <div>
                    <div class="info-row small">NV: ${employeeCode}</div>
                  </div>
                </div>
              </div>
              <script>
                window.onload = function() {
                  document.title = '';
                  setTimeout(() => {
                    window.print();
                  }, 500);
                }
              </script>
            </body>
          </html>
        `);
        printWindow.document.close();
        
        console.log('✅ QR label printed successfully');
      } else {
        alert('❌ Không thể mở cửa sổ in. Vui lòng kiểm tra popup blocker.');
      }
    } catch (error) {
      console.error('❌ Error printing QR label:', error);
      alert(`❌ Lỗi khi in tem QR: ${error.message}`);
    }
  }

  // ==================== IQC METHODS ====================

  openIQCModal(): void {
    console.log('🔬 Opening IQC modal');
    this.showIQCModal = true;
    this.iqcStep = 1;
    this.iqcScanInput = '';
    this.scannedLabel = null;
    this.iqcEmployeeId = '';
    this.iqcEmployeeVerified = false;
    
    // Focus input after modal opens
    setTimeout(() => {
      const input = document.getElementById('iqcScanInput') as HTMLInputElement;
      if (input) {
        input.focus();
      }
    }, 300);
  }

  closeIQCModal(): void {
    console.log('🔬 Closing IQC modal');
    this.showIQCModal = false;
    this.iqcStep = 1;
    this.iqcScanInput = '';
    this.scannedLabel = null;
    this.iqcEmployeeId = '';
    this.iqcEmployeeVerified = false;
  }

  async verifyQAEmployee(): Promise<void> {
    console.log('🔬 Verifying QA employee');
    
    if (!this.iqcScanInput || this.iqcScanInput.trim() === '') {
      alert('⚠️ Vui lòng nhập mã nhân viên!');
      return;
    }

    // Extract first 7 characters and convert to uppercase
    // Normalize "ÁP" to "ASP" in case of character encoding issues
    let normalizedInput = this.iqcScanInput.trim().replace(/ÁP/gi, 'ASP');
    const scannedEmployeeId = normalizedInput.substring(0, 7).toUpperCase();
    console.log('🔍 Extracted employee ID:', scannedEmployeeId);

    // Hardcoded list of allowed QA employee IDs
    const allowedEmployeeIds = ['ASP0106', 'ASP1752', 'ASP0028', 'ASP1747', 'ASP2083', 'ASP2137'];

    if (allowedEmployeeIds.includes(scannedEmployeeId)) {
      console.log('✅ Employee verified:', scannedEmployeeId);
      this.iqcEmployeeId = scannedEmployeeId;
      this.iqcEmployeeVerified = true;
      this.iqcStep = 2;
      this.iqcScanInput = '';
      
      // Focus input for next step
      setTimeout(() => {
        const input = document.getElementById('iqcScanInput') as HTMLInputElement;
        if (input) {
          input.focus();
        }
      }, 300);
    } else {
      console.log('❌ Employee not authorized:', scannedEmployeeId);
      alert(`❌ Nhân viên ${scannedEmployeeId} không có quyền thực hiện IQC. Chỉ nhân viên QA mới được phép.`);
      this.iqcScanInput = '';
    }
  }

  async processIQCScan(): Promise<void> {
    console.log('🔬 Processing IQC scan');
    
    if (!this.iqcScanInput || this.iqcScanInput.trim() === '') {
      alert('⚠️ Vui lòng quét mã QR!');
      return;
    }

    const scannedData = this.iqcScanInput.trim();
    console.log('📊 Scanned QR data:', scannedData);

    // Parse QR code format: MaTem|SoLuongTem|LenhSanXuat
    let maTem: string;
    let soLuongTem: string;
    let lenhSanXuat: string;

    if (scannedData.includes('|')) {
      const parts = scannedData.split('|');
      maTem = parts[0] || '';
      soLuongTem = parts[1] || '';
      lenhSanXuat = parts[2] || '';
      console.log('🔍 Parsed QR:', { maTem, soLuongTem, lenhSanXuat });
    } else {
      // If no separator, treat as maTem only
      maTem = scannedData;
      soLuongTem = '';
      lenhSanXuat = '';
      console.log('🔍 Single value QR:', maTem);
    }

    // Search for the label in scheduleData
    const foundLabel = this.scheduleData.find(item => {
      const matchMaTem = item.maTem && item.maTem.trim() === maTem;
      
      // If we have all 3 fields, match all
      if (soLuongTem && lenhSanXuat) {
        const matchSoLuong = (item.soLuongYeuCau === soLuongTem || item.soLuongPhoi === soLuongTem);
        const matchLSX = item.lenhSanXuat && item.lenhSanXuat.trim() === lenhSanXuat;
        return matchMaTem && matchSoLuong && matchLSX;
      }
      
      // Otherwise just match maTem
      return matchMaTem;
    });

    if (foundLabel) {
      console.log('✅ Label found:', foundLabel);
      this.scannedLabel = foundLabel;
      this.iqcScanInput = '';
    } else {
      console.log('❌ Label not found');
      alert(`❌ Không tìm thấy tem với mã: ${maTem}`);
      this.iqcScanInput = '';
    }
  }

  async updateIQCStatus(status: string): Promise<void> {
    console.log('🔬 Updating IQC status to:', status);
    
    if (!this.scannedLabel) {
      alert('⚠️ Không có tem nào được quét!');
      return;
    }

    try {
      // Update local data
      const labelIndex = this.scheduleData.findIndex(item => 
        item.maTem === this.scannedLabel.maTem &&
        item.lenhSanXuat === this.scannedLabel.lenhSanXuat
      );

      if (labelIndex !== -1) {
        this.scheduleData[labelIndex].tinhTrang = status;
        this.scheduleData[labelIndex].statusUpdateTime = new Date();

        // 🔧 FIX: Update in Firebase collection 'print-schedules' (not 'schedule')
        const snapshot = await this.firestore.collection('print-schedules', ref => 
          ref.orderBy('importedAt', 'desc').limit(1)
        ).get().toPromise();

        if (snapshot && !snapshot.empty) {
          const latestDoc = snapshot.docs[0];
          const docId = latestDoc.id;
          const docData = latestDoc.data() as any;
          
          if (docData.data && Array.isArray(docData.data)) {
            // Tìm và update item trong array
            const dataArray = docData.data as any[];
            const itemIndex = dataArray.findIndex((item: any) => 
              item.maTem === this.scannedLabel!.maTem &&
              item.lenhSanXuat === this.scannedLabel!.lenhSanXuat
            );

            if (itemIndex !== -1) {
              // Update item trong array
              dataArray[itemIndex].tinhTrang = status;
              dataArray[itemIndex].statusUpdateTime = new Date();
              
              // Update document trong Firebase
              await this.firestore.collection('print-schedules').doc(docId).update({
                data: dataArray,
                lastUpdated: new Date()
          });
              
              console.log(`✅ Firebase updated successfully: ${this.scannedLabel.maTem} -> ${status}`);
            } else {
              console.warn(`⚠️ Item not found in Firebase array: ${this.scannedLabel.maTem}`);
            }
          }
        } else {
          console.warn('⚠️ No print-schedules document found');
        }

        alert(`✅ Đã cập nhật trạng thái "${status}" cho tem ${this.scannedLabel.maTem}`);
        
        // Reset for next scan
        this.scannedLabel = null;
        this.iqcScanInput = '';
        
        // 🔧 FIX: Reload data from Firebase để đảm bảo sync sau khi update
        this.loadDataFromFirebase();
        
        // Focus input for next scan
        setTimeout(() => {
          const input = document.getElementById('iqcScanInput') as HTMLInputElement;
          if (input) {
            input.focus();
          }
        }, 300);
      } else {
        alert('❌ Không tìm thấy tem trong danh sách!');
      }
    } catch (error) {
      console.error('❌ Error updating IQC status:', error);
      alert(`❌ Lỗi khi cập nhật trạng thái: ${error.message}`);
    }
  }

  /**
   * Open download modal
   */
  openDownloadModal(): void {
    console.log('📥 Opening download modal...');
    this.showDownloadModal = true;
    console.log('📥 showDownloadModal:', this.showDownloadModal);
  }

  /**
   * Close download modal
   */
  closeDownloadModal(): void {
    this.showDownloadModal = false;
  }

  /**
   * Download all history
   */
  downloadAllHistory(): void {
    this.closeDownloadModal();
    this.exportToExcel(this.scheduleData, 'ToanBoLichSu');
  }

  /**
   * Download filtered history (based on current filters)
   */
  downloadFilteredHistory(): void {
    this.closeDownloadModal();
    const filteredData = this.getFilteredData();
    const filterInfo = this.currentStatusFilter ? `_${this.currentStatusFilter}` : '';
    this.exportToExcel(filteredData, `LocHienTai${filterInfo}`);
  }

  /**
   * Export data to Excel
   */
  exportToExcel(data: ScheduleItem[], fileNamePrefix: string): void {
    if (!data || data.length === 0) {
      alert('⚠️ Không có dữ liệu để xuất!');
      return;
    }

    try {
      const headers = [
        'Năm', 'Tháng', 'STT', 'Size Phôi', 'Mã Tem', 'Số Lượng Yêu Cầu', 'Số Lượng Phôi',
        'Mã Hàng', 'Lệnh Sản Xuất', 'Khách Hàng', 'Ngày Nhận Kế Hoạch', 'YY', 'WW',
        'Line Nhận', 'Người In', 'Tình Trạng', 'Bản Vẽ', 'Ghi Chú'
      ];

      const excelData = data.map(item => [
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
      ]);

      const worksheet = XLSX.utils.aoa_to_sheet([headers, ...excelData]);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Lịch sử');

      // Set column widths
      const colWidths = [
        { wch: 8 }, { wch: 8 }, { wch: 6 }, { wch: 12 }, { wch: 15 },
        { wch: 18 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 20 },
        { wch: 18 }, { wch: 6 }, { wch: 6 }, { wch: 12 }, { wch: 15 },
        { wch: 15 }, { wch: 15 }, { wch: 30 }
      ];
      worksheet['!cols'] = colWidths;

      const fileName = `${fileNamePrefix}_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, fileName);

      console.log(`✅ Exported ${data.length} items to ${fileName}`);
      alert(`✅ Đã xuất ${data.length} dòng dữ liệu!\n\nFile: ${fileName}`);
    } catch (error) {
      console.error('❌ Error exporting to Excel:', error);
      alert('❌ Lỗi khi xuất file Excel!');
    }
  }

  /**
   * Update status from Pass to Done
   */
  async updateStatusToDone(item: ScheduleItem): Promise<void> {
    if (item.tinhTrang !== 'Pass') {
      alert('⚠️ Chỉ có thể chuyển từ Pass sang Done!');
      return;
    }

    if (!confirm(`Bạn có chắc muốn chuyển tem ${item.maTem} từ Pass sang Done?`)) {
      return;
    }

    try {
      // Update local data
      item.tinhTrang = 'Done';
      item.statusUpdateTime = new Date();

      // Update in Firebase
      const querySnapshot = await this.firestore.collection('schedule')
        .ref
        .where('maTem', '==', item.maTem)
        .where('lenhSanXuat', '==', item.lenhSanXuat)
        .get();

      if (!querySnapshot.empty) {
        const doc = querySnapshot.docs[0];
        await doc.ref.update({
          tinhTrang: 'Done',
          statusUpdateTime: new Date()
        });
        console.log('✅ Firebase updated successfully: Pass -> Done');
      }

      // Call onFieldChange to trigger save if needed
      this.onFieldChange(item, 'tinhTrang');
      
      console.log(`✅ Đã chuyển tem ${item.maTem} từ Pass sang Done`);
    } catch (error) {
      console.error('❌ Error updating status to Done:', error);
      alert(`❌ Lỗi khi cập nhật trạng thái: ${error.message}`);
      // Revert local change on error
      item.tinhTrang = 'Pass';
    }
  }
}
