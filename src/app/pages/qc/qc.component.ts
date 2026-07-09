import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireFunctions } from '@angular/fire/compat/functions';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { RmBagHistoryService } from '../../services/rm-bag-history.service';
import { OutboundQcRuleService } from '../../services/outbound-qc-rule.service';
import { WorkOrder, WorkOrderStatus } from '../../models/material-lifecycle.model';

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
  /** Tổng số bịch (BAG) trên kho — dùng cho Pass lẻ / QR bịch. */
  totalBags?: number;
}

export interface MaterialCheckRow {
  id: string;
  materialCode: string;
  materialName?: string;
  poNumber: string;
  batchNumber: string;
  location: string;
  imdLabel: string;
  iqcStatus: string;
  qcCheckedBy: string;
  qcCheckedAt: Date | null;
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

  /** Chọn nhà máy để lọc dữ liệu QC. */
  selectedFactory: 'ASM1' | 'ASM2' = 'ASM1';
  
  // Search and filter
  searchTerm: string = '';
  statusFilter: string = 'all'; // all, PASS, NG, ĐẶC CÁCH, CHỜ XÁC NHẬN

  // Search material + IQC status history
  iqcSearchCode: string = '';
  iqcSearchFromDate: string = ''; // YYYY-MM-DD
  iqcSearchToDate: string = '';   // YYYY-MM-DD
  showIqcDateRangeModal: boolean = false;
  showIqcSearchResults: boolean = false;
  isSearchingIqcHistory: boolean = false;
  iqcHistoryError: string = '';
  iqcHistoryResults: Array<{
    id?: string;
    materialCode: string;
    materialName?: string;
    poNumber?: string;
    batchNumber?: string;
    supplier?: string;
    quantity?: number;
    unit?: string;
    type?: string;
    iqcStatus?: string;
    location?: string;
    qcCheckedBy?: string;
    qcCheckedAt?: Date | null;
    updatedAt?: Date | null;
    eventTime?: Date | null;
  }> = [];

  iqcResultsTitle: string = 'Lịch sử tình trạng theo mã nguyên liệu';

  iqcHistoryContext:
    | 'search'
    | 'pendingQC'
    | 'todayChecked'
    | 'pendingConfirm'
    | 'monthlyPass'
    | 'monthlyNg'
    | 'monthlyLock'
    | null = null;

  // Priority: show one item at top (for pending confirm list)
  priorityMaterialId: string | null = null;

  // Priority for "Pending QC" list (can be multiple)
  priorityPendingQcIds: string[] = [];

  /** Mã NVL trên PXK của WO chưa Done — dùng auto ưu tiên Chờ kiểm */
  private pxkNeededMaterialCodes = new Set<string>();

  // Monthly counts (current month)
  monthlyPassCount: number = 0;
  monthlyNgCount: number = 0;
  monthlyLockCount: number = 0;

  get pendingQcPriorityCount(): number {
    return this.priorityPendingQcIds.length;
  }
  
  // IQC Modal properties
  showIQCModal: boolean = false;
  iqcScanInput: string = '';
  scannedMaterial: InventoryMaterial | null = null;
  selectedIQCStatus: string = 'CHỜ XÁC NHẬN'; // PASS, NG, ĐẶC CÁCH, CHỜ XÁC NHẬN

  // IQC extra fields by status
  ngErrorText: string = '';
  lockReasonText: string = '';
  pendingNoteText: string = '';

  /** Pass lẻ: PASS nhưng chỉ ghi nhận từng bịch đã quét; lưu trạng thái CHƯA XONG. */
  iqcPassLe: boolean = false;
  iqcPassLeScanInput: string = '';
  iqcPassLeBagEntries: Array<{
    displayKey: string;
    numerator: number;
    denominator: number;
    hasSplit: boolean;
  }> = [];
  
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
  showRecentChecked: boolean = false;
  
  // More menu (popup modal)
  showMoreMenu: boolean = false;
  /** More → Mail Hold Putaway (Cloud Function đọc doc này, gửi mail thứ 2 hằng tuần 08:00 VN) */
  private readonly HOLD_NOTIFICATION_EMAILS_DOC = 'qc-settings/hold-notification-emails';
  showHoldNotificationEmailsModal = false;
  holdEmailText = '';
  holdEmailsSaving = false;
  holdNotifyManualRunning = false;
  /** More → QC rule: chặn xuất RM khi IQC Status trùng danh sách (outbound-qc-rules / ASM1|ASM2). */
  showOutboundQcRuleModal = false;
  outboundQcRuleModalEnabled = false;
  outboundQcRuleModalText = '';
  outboundQcRuleSaving = false;
  showReportModal: boolean = false;
  showIqcPermissionModal: boolean = false;
  showSendReportStatusModal: boolean = false;
  showTodayCheckedModal: boolean = false;
  showPendingQCModal: boolean = false;
  showPendingConfirmModal: boolean = false;
  showDownloadModal: boolean = false;
  selectedMonth: string = '';
  selectedYear: string = '';
  qcReports: any[] = [];
  todayCheckedMaterials: any[] = [];
  pendingQCMaterials: any[] = [];
  /** Mã hàng xuất hiện ≥2 P.O khác nhau trong danh sách chờ kiểm — gạch chân xanh. */
  pendingQcDuplicateMaterialCodes = new Set<string>();
  pendingConfirmMaterials: any[] = [];
  isLoadingReport: boolean = false;

  // Lấy mẫu (chuột phải ở danh sách chờ kiểm)
  private readonly QC_SAMPLE_COLLECTION = 'qc-sample-takings';
  /** Khóa duy nhất: Mã + PO + Lô hàng theo từng xưởng (ASM1/ASM2). */
  private readonly QC_SAMPLE_TAKEN_KEYS = 'qc-sample-taken-keys';
  showSampleTakeModal = false;
  isSavingSampleTake = false;
  sampleTakeError = '';
  sampleTakePcsInput: string = '';
  sampleTakeSelected: null | {
    id?: string;
    factory: 'ASM1' | 'ASM2';
    materialCode: string;
    poNumber: string;
    imd: string;
  } = null;
  sampleTakeYear = 0;
  sampleTakeMonth = 0;
  sampleTakeStt = 0;
  sampleTakeIqcTestRosh = false;
  sampleTakeLayMauHangVe = false;
  sampleTakeEngLuuMau = false;
  sampleTakeMuonTest = false;
  sampleTakeLabelCountInput = '1';
  sampleTakeTotalQty = 0;
  sampleTakeMaKho: '00' | 'NVL_KE31' | 'NVL_E31' | 'NVL_KS' = '00';
  sampleTakeLoaiHinh = '';
  sampleTakeNganhNghe: 'NNGHE_A' | 'NNGHE_B' = 'NNGHE_A';
  sampleTakeMonthKey = 0;

  // Danh mục lấy mẫu theo tháng
  showSampleCatalogModal = false;
  sampleCatalogYear = '';
  sampleCatalogMonth = '';
  isLoadingSampleCatalog = false;
  sampleCatalogRows: any[] = [];

  /** Set key: factory|material|po|imd đã lấy mẫu (theo xưởng ASM1/ASM2). */
  private sampleTakenKeySet = new Set<string>();

  private buildSampleKey(
    factory: string,
    materialCode: string,
    poNumber: string,
    imd: string
  ): string {
    const f = String(factory || '').trim().toUpperCase();
    const m = String(materialCode || '').trim().toUpperCase();
    const p = String(poNumber || '').trim();
    const l = String(imd || '').trim();
    if (!f || !m || !p || !l) return '';
    return `${f}|${m}|${p}|${l}`;
  }

  private buildSampleTakenKeyDocId(
    factory: string,
    materialCode: string,
    poNumber: string,
    imd: string
  ): string {
    const key = this.buildSampleKey(factory, materialCode, poNumber, imd);
    return key.replace(/\|/g, '--').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 450);
  }

  isSampleTakenRow(item: any): boolean {
    const key = this.buildSampleKey(
      this.selectedFactory,
      item?.materialCode,
      item?.poNumber,
      item?.batchNumber
    );
    return !!key && this.sampleTakenKeySet.has(key);
  }

  isSampleTakeEnabledForCurrentList(): boolean {
    return (
      this.iqcHistoryContext === 'pendingQC' ||
      this.iqcHistoryContext === 'pendingConfirm' ||
      this.iqcHistoryContext === 'monthlyNg'
    );
  }

  // IQC button permission (separate from QC tab access)
  iqcButtonEnabledForCurrentEmployee: boolean = false;

  // IQC Permission modal state
  iqcPermInputEmployeeId: string = '';
  iqcPermToggleValue: boolean = true; // ON/OFF for entered employee id
  iqcPermBusy: boolean = false;
  iqcPermLoadingList: boolean = false;
  iqcPermShowAddRow: boolean = false;
  iqcPermissions: Array<{
    employeeId: string;
    enabled: boolean;
    updatedAt?: Date | null;
  }> = [];

  // Send report UI state
  isSendingReport: boolean = false;
  sendReportStatusText: string = '';

  /** Popup tra cứu nhanh: tình trạng IQC / ai kiểm / thời gian (chỉ đọc). */
  showMaterialCheckModal: boolean = false;
  materialCheckScanInput: string = '';
  materialCheckBusy: boolean = false;
  materialCheckError: string = '';
  materialCheckRows: MaterialCheckRow[] = [];

  // Per-box date ranges
  boxDateRanges: Record<string, { from: Date | null; to: Date | null }> = {};
  showBoxDateModal: boolean = false;
  editingBoxKey: string = '';
  boxModalTitle: string = '';
  boxModalFromStr: string = '';
  boxModalToStr: string = '';

  private destroy$ = new Subject<void>();
  
  constructor(
    private firestore: AngularFirestore,
    private router: Router,
    private fns: AngularFireFunctions,
    private rmBagHistory: RmBagHistoryService,
    private outboundQcRule: OutboundQcRuleService
  ) {}
  
  get monthlyTotal(): number {
    return this.monthlyPassCount + this.monthlyNgCount + this.monthlyLockCount;
  }

  get monthlyPassRate(): number {
    if (!this.monthlyTotal) return 0;
    return Math.round(this.monthlyPassCount / this.monthlyTotal * 1000) / 10;
  }

  get monthlyNgRate(): number {
    if (!this.monthlyTotal) return 0;
    return Math.round(this.monthlyNgCount / this.monthlyTotal * 1000) / 10;
  }

  get monthlyLockRate(): number {
    if (!this.monthlyTotal) return 0;
    return Math.round(this.monthlyLockCount / this.monthlyTotal * 1000) / 10;
  }

  get todayStr(): string {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  get lastUpdatedTime(): string {
    const d = new Date();
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }

  private startOfDay(d: Date): Date {
    const r = new Date(d); r.setHours(0, 0, 0, 0); return r;
  }

  private endOfDay(d: Date): Date {
    const r = new Date(d); r.setHours(23, 59, 59, 999); return r;
  }

  private dateToInputStr(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  private initBoxDateRanges(): void {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const jan2026    = new Date(2026, 0, 1);
    this.boxDateRanges = {
      pendingQC:      { from: jan2026,    to: null },
      todayChecked:   { from: this.startOfDay(now), to: this.endOfDay(now) },
      pendingConfirm: { from: jan2026,    to: null },
      pass:           { from: monthStart, to: monthEnd },
      ng:             { from: monthStart, to: monthEnd },
      lock:           { from: jan2026,    to: null },
    };
  }

  formatBoxDateLabel(key: string): string {
    const r = this.boxDateRanges[key];
    if (!r) return '';
    const fmt = (d: Date | null) => d
      ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
      : 'nay';
    if (!r.from && !r.to) return 'Tất cả';
    if (!r.from) return `≤ ${fmt(r.to)}`;
    if (!r.to)   return `≥ ${fmt(r.from)}`;
    // If from == to (same day), show single date
    const sameDay = r.from.toDateString() === r.to?.toDateString();
    if (sameDay) return fmt(r.from);
    return `${fmt(r.from)} – ${fmt(r.to)}`;
  }

  openBoxDateModal(key: string, title: string): void {
    this.editingBoxKey  = key;
    this.boxModalTitle  = title;
    const r = this.boxDateRanges[key];
    this.boxModalFromStr = r?.from ? this.dateToInputStr(r.from) : '';
    this.boxModalToStr   = r?.to   ? this.dateToInputStr(r.to)   : '';
    this.showBoxDateModal = true;
  }

  applyBoxDateModal(): void {
    if (!this.editingBoxKey) return;
    const from = this.boxModalFromStr ? new Date(this.boxModalFromStr + 'T00:00:00') : null;
    const to   = this.boxModalToStr   ? new Date(this.boxModalToStr   + 'T23:59:59') : null;
    this.boxDateRanges[this.editingBoxKey] = { from, to };
    this.showBoxDateModal = false;
    this.reloadBoxCounts();
  }

  resetBoxDateModal(): void {
    const now        = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const jan2026    = new Date(2026, 0, 1);
    const defaults: Record<string, { from: Date | null; to: Date | null }> = {
      pendingQC:      { from: jan2026,    to: null },
      todayChecked:   { from: this.startOfDay(now), to: this.endOfDay(now) },
      pendingConfirm: { from: jan2026,    to: null },
      pass:           { from: monthStart, to: monthEnd },
      ng:             { from: monthStart, to: monthEnd },
      lock:           { from: jan2026,    to: null },
    };
    if (this.editingBoxKey && defaults[this.editingBoxKey]) {
      this.boxDateRanges[this.editingBoxKey] = defaults[this.editingBoxKey];
      const r = this.boxDateRanges[this.editingBoxKey];
      this.boxModalFromStr = r.from ? this.dateToInputStr(r.from) : '';
      this.boxModalToStr   = r.to   ? this.dateToInputStr(r.to)   : '';
    }
  }

  private reloadBoxCounts(): void {
    this.loadPendingQCCount();
    this.loadTodayCheckedCount();
    this.loadPendingConfirmCount();
    this.loadMonthlyStatusCounts();
  }

  getYearOptions(): number[] {
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let i = currentYear; i >= currentYear - 5; i--) {
      years.push(i);
    }
    return years;
  }
  
  ngOnInit(): void {
    console.log('📦 QC Component initialized - ready for scanning');
    this.initBoxDateRanges();
    
    // 🔧 FIX: Khôi phục currentEmployeeId từ localStorage nếu có
    const savedEmployeeId = localStorage.getItem('qc_currentEmployeeId');
    const savedEmployeeName = localStorage.getItem('qc_currentEmployeeName');
    if (savedEmployeeId && savedEmployeeName) {
      this.validateAndRestoreEmployee(savedEmployeeId, savedEmployeeName);
    } else {
      // Block access until employee is verified
      this.showEmployeeModal = true;
    }
  }

  private async validateAndRestoreEmployee(employeeId: string, fallbackName: string): Promise<void> {
    try {
      const allowed = await this.hasQcTabAccess(employeeId);
      if (!allowed) {
        console.warn(`⛔ Employee ${employeeId} no longer has QC tab access`);
        localStorage.removeItem('qc_currentEmployeeId');
        localStorage.removeItem('qc_currentEmployeeName');
        this.showEmployeeModal = true;
        this.isEmployeeVerified = false;
        return;
      }

      this.currentEmployeeId = employeeId;
      this.currentEmployeeName = fallbackName || employeeId;
      this.isEmployeeVerified = true;
      this.showEmployeeModal = false;
      console.log('✅ Restored employee from localStorage:', employeeId, fallbackName);

      // Load IQC permission for this employee
      this.iqcButtonEnabledForCurrentEmployee = await this.hasIqcButtonPermission(employeeId);

      // Load counts and recent materials after employee verified
      this.loadPendingQCCount();
      this.loadTodayCheckedCount();
      this.loadPendingConfirmCount();
      this.loadMonthlyStatusCounts();
      this.loadRecentCheckedMaterials();

      // Auto ưu tiên từ PXK (WO chưa Done) rồi load cờ ưu tiên
      await this.syncAutoPriorityAndReloadPriority();
    } catch (error) {
      console.error('❌ Error validating saved employee access:', error);
      this.showEmployeeModal = true;
      this.isEmployeeVerified = false;
    }
  }

  private async syncAutoPriorityAndReloadPriority(): Promise<void> {
    await this.syncAutoPriorityFromPxk();
    await this.loadQcPriorityFromBackend();
  }

  /**
   * Load priority flags từ Firestore:
   * - `qcPriorityPendingConfirm`: 1 item (pending confirm) được ưu tiên
   * - `qcPriorityPendingQC`: nhiều item (pending QC) được ưu tiên
   */
  private async loadQcPriorityFromBackend(): Promise<void> {
    try {
      // Pending QC (can be multiple)
      const pendingQcSnap = await this.firestore.collection('inventory-materials', ref =>
        ref.where('qcPriorityPendingQC', '==', true)
           .limit(200)
      ).get().toPromise();

      const pendingQcIds: string[] = (pendingQcSnap?.docs || [])
        .map(doc => ({ id: doc.id, data: doc.data() as any }))
        .filter(x => x.data?.factory === this.selectedFactory && this.isPendingQcAtIqc(x.data))
        .map(x => x.id);

      this.priorityPendingQcIds = pendingQcIds;

      // Pending Confirm (choose best candidate, if multiple)
      const pendingConfirmSnap = await this.firestore.collection('inventory-materials', ref =>
        ref.where('qcPriorityPendingConfirm', '==', true)
           .limit(50)
      ).get().toPromise();

      let bestId: string | null = null;
      let bestTime = 0;
      (pendingConfirmSnap?.docs || []).forEach(doc => {
        const data = doc.data() as any;
        if (data?.factory !== this.selectedFactory) return;
        const status = (data?.iqcStatus ?? '').toString().trim();
        if (status !== 'CHỜ XÁC NHẬN') return;

        // Use qcCheckedAt/updatedAt for "most recent" priority
        const t =
          this.parseFirestoreDate(data?.qcCheckedAt)?.getTime() ||
          this.parseFirestoreDate(data?.updatedAt)?.getTime() ||
          0;

        if (!bestId || t > bestTime) {
          bestId = doc.id;
          bestTime = t;
        }
      });

      this.priorityMaterialId = bestId;
    } catch (error) {
      console.warn('⚠️ Failed to load QC priority from backend:', error);
      // Fallback: keep whatever current UI has
    }
  }

  private normalizeMaterialCodeKey(code: string): string {
    return (code || '').replace(/\s/g, '').toUpperCase().trim();
  }

  private rebuildPendingQcDuplicateMaterialCodes(
    items?: Array<{ materialCode?: string; poNumber?: string }>
  ): void {
    const list = items ?? [];
    const posByCode = new Map<string, Set<string>>();
    for (const item of list) {
      const code = this.normalizeMaterialCodeKey(item.materialCode || '');
      if (!code) continue;
      const po = String(item.poNumber || '').trim().toUpperCase();
      const set = posByCode.get(code) || new Set<string>();
      set.add(po);
      posByCode.set(code, set);
    }
    this.pendingQcDuplicateMaterialCodes = new Set(
      Array.from(posByCode.entries())
        .filter(([, pos]) => pos.size > 1)
        .map(([code]) => code)
    );
  }

  /** Mã hàng có nhiều P.O khác nhau trong danh sách chờ kiểm hiện tại. */
  isPendingQcDuplicateMaterialCode(materialCode: string | undefined | null): boolean {
    const key = this.normalizeMaterialCodeKey(materialCode || '');
    return !!key && this.pendingQcDuplicateMaterialCodes.has(key);
  }

  private getPendingQcRowTime(item: {
    eventTime?: Date | null;
    importDate?: any;
    receivedDate?: any;
  }): number {
    const t = item.eventTime || item.importDate || item.receivedDate;
    if (t instanceof Date) return t.getTime();
    if (t?.toDate) return t.toDate().getTime();
    return 0;
  }

  /** Ưu tiên giữ trên cùng; mã trùng nhau (không ưu tiên) xếp sát nhau theo thứ tự ngày nhập. */
  private sortPendingQcListByPriorityAndMaterialCode<T extends {
    id?: string;
    materialCode?: string;
    eventTime?: Date | null;
    importDate?: any;
    receivedDate?: any;
  }>(items: T[]): T[] {
    const pset = new Set(this.priorityPendingQcIds || []);
    const priority = items
      .filter(x => x?.id && pset.has(x.id))
      .sort((a, b) => this.getPendingQcRowTime(b) - this.getPendingQcRowTime(a));
    const nonPriority = items.filter(x => !x?.id || !pset.has(x.id));
    return [...priority, ...this.groupPendingQcDuplicateMaterialCodes(nonPriority)];
  }

  private groupPendingQcDuplicateMaterialCodes<T extends {
    materialCode?: string;
    eventTime?: Date | null;
    importDate?: any;
    receivedDate?: any;
  }>(items: T[]): T[] {
    const byEvent = [...items].sort(
      (a, b) => this.getPendingQcRowTime(b) - this.getPendingQcRowTime(a)
    );
    const codeCount = new Map<string, number>();
    for (const item of byEvent) {
      const key = this.normalizeMaterialCodeKey(item.materialCode || '');
      codeCount.set(key, (codeCount.get(key) || 0) + 1);
    }

    const result: T[] = [];
    const inserted = new Set<string>();
    for (const item of byEvent) {
      const key = this.normalizeMaterialCodeKey(item.materialCode || '');
      if ((codeCount.get(key) || 0) <= 1) {
        result.push(item);
        continue;
      }
      if (inserted.has(key)) continue;
      inserted.add(key);
      const group = byEvent
        .filter(x => this.normalizeMaterialCodeKey(x.materialCode || '') === key)
        .sort((a, b) => this.getPendingQcRowTime(b) - this.getPendingQcRowTime(a));
      result.push(...group);
    }
    return result;
  }

  private resolveWorkOrderFactory(wo: WorkOrder): 'ASM1' | 'ASM2' {
    const fac = String(wo?.factory || '').trim().toUpperCase();
    if (fac.includes('ASM2') || fac === 'SAMPLE 2') return 'ASM2';
    if (fac.includes('ASM1') || fac === 'SAMPLE 1') return 'ASM1';

    const lsx = String(wo?.productionOrder || '').trim().toUpperCase().replace(/\s/g, '');
    if (lsx.startsWith('LH')) return 'ASM2';
    if (lsx.startsWith('KZ')) return 'ASM1';
    return this.selectedFactory;
  }

  private isWorkOrderActiveForPxk(wo: WorkOrder): boolean {
    if (wo.status === WorkOrderStatus.DONE) return false;
    if (wo.isCompleted === true) return false;
    return true;
  }

  private collectLsxFromActiveWorkOrders(workOrders: WorkOrder[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const addVariant = (raw: string) => {
      const t = String(raw || '').trim();
      if (!t) return;
      if (!seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
      const u = t.toUpperCase();
      if (u !== t && !seen.has(u)) {
        seen.add(u);
        out.push(u);
      }
    };

    for (const wo of workOrders) {
      if (!this.isWorkOrderActiveForPxk(wo)) continue;
      if (this.resolveWorkOrderFactory(wo) !== this.selectedFactory) continue;
      addVariant(wo.productionOrder || '');
    }
    return out;
  }

  private pxkDocMatchesSelectedFactory(docData: any): boolean {
    const docFactory = String(docData?.factory || '').trim().toUpperCase();
    if (docFactory) return docFactory === this.selectedFactory;

    const lsx = String(docData?.lsx || '').trim().toUpperCase().replace(/\s/g, '');
    if (this.selectedFactory === 'ASM2' && lsx.startsWith('KZ')) return false;
    if (this.selectedFactory === 'ASM1' && lsx.startsWith('LH')) return false;
    return true;
  }

  /** Mã NVL trên phiếu PXK của WO chưa Done (khớp mã, không theo PO). */
  private async fetchPxkMaterialCodesForActiveWorkOrders(): Promise<Set<string>> {
    const codes = new Set<string>();
    try {
      const woSnap = await this.firestore.collection('work-orders', ref => ref.limit(3000)).get().toPromise();
      const workOrders = (woSnap?.docs || []).map(d => ({ id: d.id, ...(d.data() as WorkOrder) }));
      const lsxList = this.collectLsxFromActiveWorkOrders(workOrders);
      if (lsxList.length === 0) {
        return codes;
      }

      const FIRESTORE_IN_MAX = 30;
      for (let i = 0; i < lsxList.length; i += FIRESTORE_IN_MAX) {
        const chunk = lsxList.slice(i, i + FIRESTORE_IN_MAX);
        const pxkSnap = await this.firestore
          .collection('pxk-import-data', ref => ref.where('lsx', 'in', chunk))
          .get()
          .toPromise();

        (pxkSnap?.docs || []).forEach(doc => {
          const d = doc.data() as any;
          if (!this.pxkDocMatchesSelectedFactory(d)) return;

          const lines = Array.isArray(d?.lines) ? d.lines : [];
          lines.forEach((line: any) => {
            const mc = this.normalizeMaterialCodeKey(line?.materialCode || '');
            const qty = Number(line?.quantity) || 0;
            if (mc && qty > 0) {
              codes.add(mc);
            }
          });
        });
      }
    } catch (error) {
      console.warn('⚠️ Failed to load PXK material codes for QC auto-priority:', error);
    }
    return codes;
  }

  /**
   * Tự bật ưu tiên Chờ kiểm khi mã nằm trên PXK (WO chưa Done, đúng factory).
   * Chỉ auto-clear khi ưu tiên được bật tự động (`qcPriorityAutoPendingQC`).
   */
  private async syncAutoPriorityFromPxk(): Promise<void> {
    if (!this.selectedFactory) return;

    const pxkCodes = await this.fetchPxkMaterialCodesForActiveWorkOrders();
    this.pxkNeededMaterialCodes = pxkCodes;

    const pendingSnap = await this.firestore
      .collection('inventory-materials', ref =>
        ref.where('factory', '==', this.selectedFactory).where('iqcStatus', '==', 'CHỜ KIỂM')
      )
      .get()
      .toPromise();

    const now = new Date();
    const toSetPriority: string[] = [];
    const toClearPriority: string[] = [];

    (pendingSnap?.docs || []).forEach(doc => {
      const data = doc.data() as any;
      if (!this.isPendingQcAtIqc(data)) return;

      const mc = this.normalizeMaterialCodeKey(data?.materialCode || '');
      if (!mc) return;

      const inPxk = pxkCodes.has(mc);
      const hasPriority = !!data.qcPriorityPendingQC;
      const isAuto = !!data.qcPriorityAutoPendingQC;

      if (inPxk && !hasPriority) {
        toSetPriority.push(doc.id);
      } else if (!inPxk && hasPriority && isAuto) {
        toClearPriority.push(doc.id);
      }
    });

    const writeChunk = async (ids: string[], payload: Record<string, unknown>) => {
      const CHUNK = 20;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        await Promise.all(
          slice.map(id => this.firestore.collection('inventory-materials').doc(id).update(payload))
        );
      }
    };

    if (toSetPriority.length > 0) {
      await writeChunk(toSetPriority, {
        qcPriorityPendingQC: true,
        qcPriorityAutoPendingQC: true,
        qcPriorityUpdatedAt: now,
      });
    }
    if (toClearPriority.length > 0) {
      await writeChunk(toClearPriority, {
        qcPriorityPendingQC: false,
        qcPriorityAutoPendingQC: false,
        qcPriorityUpdatedAt: now,
      });
    }

    if (toSetPriority.length > 0 || toClearPriority.length > 0) {
      console.log(
        `✅ QC auto-priority PXK sync (${this.selectedFactory}): +${toSetPriority.length}, -${toClearPriority.length}, PXK codes=${pxkCodes.size}`
      );
    }
  }
  
  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
  
  loadMaterials(): void {
    this.isLoading = true;
    this.errorMessage = '';
    
    console.log(`📦 Loading ${this.selectedFactory} inventory materials for QC...`);
    
    void this.fetchMaterialsFromFirestore();
  }

  private async fetchMaterialsFromFirestore(): Promise<void> {
    try {
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
           .where('iqcStatus', '!=', 'PASS')
           .limit(1000)
      ).get().toPromise();
      this.applyMaterialsFromDocs(snapshot?.docs || []);
    } catch (error) {
      console.error('❌ Error loading materials with iqcStatus filter:', error);
      await this.loadMaterialsWithoutOrderBy();
    }
  }

  private applyMaterialsFromDocs(docs: any[]): void {
    console.log(`📦 Received ${docs.length} documents from Firestore`);
    this.materials = docs.map(doc => {
      const data = doc.data() as any;
      return {
        id: doc.id,
        factory: data.factory || this.selectedFactory,
        importDate: this.parseImportDate(data.importDate),
        receivedDate: data.receivedDate?.toDate() || undefined,
        batchNumber: this.resolveImdBatchNumber(data),
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
        totalBags: Math.max(0, Math.floor(Number(data.totalBags ?? 0))),
        createdAt: data.createdAt?.toDate() || new Date(),
        updatedAt: data.updatedAt?.toDate() || new Date()
      } as InventoryMaterial;
    });
    this.materials.sort((a, b) => (b.importDate?.getTime() || 0) - (a.importDate?.getTime() || 0));
    console.log(`✅ Loaded ${this.materials.length} materials`);
    this.applyFilters();
    this.isLoading = false;
  }
  
  async loadMaterialsWithoutOrderBy(): Promise<void> {
    try {
      const snapshot = await this.firestore.collection('inventory-materials', ref => 
        ref.where('factory', '==', this.selectedFactory)
           .limit(1000)
      ).get().toPromise();

      const docs = (snapshot?.docs || []).filter(doc => {
        const data = doc.data() as any;
        return String(data.iqcStatus || '').trim().toUpperCase() !== 'PASS';
      });
      console.log(`📦 Received ${docs.length} documents from Firestore (no orderBy)`);
      this.materials = docs.map(doc => {
        const data = doc.data() as any;
        return {
          id: doc.id,
          factory: data.factory || this.selectedFactory,
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
          totalBags: Math.max(0, Math.floor(Number(data.totalBags ?? 0))),
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date()
        } as InventoryMaterial;
      });
      this.materials.sort((a, b) => (b.importDate?.getTime() || 0) - (a.importDate?.getTime() || 0));
      console.log(`✅ Loaded ${this.materials.length} materials (sorted manually)`);
      this.applyFilters();
      this.isLoading = false;
    } catch (error: any) {
      console.error('❌ Error loading materials without orderBy:', error);
      this.errorMessage = `Lỗi khi tải dữ liệu: ${error.message || error}`;
      this.isLoading = false;
    }
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
    
    // If it's a string in format "26082025" (DDMMYYYY) or "2608202501" (DDMMYYYYxx)
    if (typeof importDate === 'string' && /^\d{8,10}$/.test(importDate)) {
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
  
  /**
   * Trích IMD key (phần số trước dấu '-') từ part4 QR.
   * VD: "2805202601-1/1" → "2805202601"
   *     "28052026-1/1"   → "28052026"
   *     "2805202601"     → "2805202601"
   */
  private extractImdKeyFromPart4(part4: string): string {
    const t = (part4 || '').trim();
    const di = t.indexOf('-');
    return di >= 0 ? t.slice(0, di).trim() : t;
  }

  /**
   * Nếu scannedImdKey dài hơn batchNumber hiện tại và là 10 số hợp lệ
   * → cập nhật batchNumber (trong bộ nhớ) để getDisplayIMD hiển thị đúng.
   */
  private applyScannedImdToBatchNumber(material: InventoryMaterial, scannedPart4: string): void {
    const key = this.extractImdKeyFromPart4(scannedPart4);
    if (!/^\d{10}$/.test(key)) return;
    const current = String(material.batchNumber || '').trim();
    if (current.length < 10) {
      material.batchNumber = key;
    }
  }

  /**
   * Lấy IMD key chuẩn từ raw Firestore data.
   * Ưu tiên: batchNumber (10 số) > importDate (10 số) > batchNumber (8 số) > importDate (8 số)
   */
  private resolveImdBatchNumber(data: any): string {
    const bn = String(data.batchNumber || '').trim();
    let rawDate = '';
    const parsedDate = this.parseFirestoreDate(data?.importDate);
    if (parsedDate) {
      rawDate = parsedDate.toLocaleDateString('en-GB').split('/').join('');
    } else {
      rawDate = String(data.importDate || '').trim();
    }
    // batchNumber đã là 10 chữ số → dùng luôn
    if (/^\d{10}$/.test(bn)) return bn;
    // importDate là 10 chữ số → dùng làm IMD key
    if (/^\d{10}$/.test(rawDate)) return rawDate;
    // batchNumber là 8 chữ số → dùng
    if (/^\d{8}$/.test(bn)) return bn;
    // importDate là 8 chữ số → dùng
    if (/^\d{8}$/.test(rawDate)) return rawDate;
    // Fallback: trả về batchNumber gốc hoặc rawDate
    return bn || rawDate;
  }

  /** Khóa nhóm lô: mã hàng + PO + 8 ký tự đầu của lô hàng (lô 10 ký tự = mở rộng cùng ngày). */
  getLotPrefix8(batchNumber: any): string {
    const lot = String(batchNumber || '').trim().toUpperCase();
    if (!lot) return '';
    return lot.length <= 8 ? lot : lot.substring(0, 8);
  }

  /** Hiển thị lô gốc (8 ký tự) trên bảng QC. */
  getDisplayLotBatch(batchNumber: any): string {
    const prefix = this.getLotPrefix8(batchNumber);
    return prefix || String(batchNumber || '').trim();
  }

  private getInventoryLotKey(data: any): string {
    const mc = String(data?.materialCode || '').trim().toUpperCase();
    const po = String(data?.poNumber || '').trim().toUpperCase();
    const lotPrefix = this.getLotPrefix8(data?.batchNumber);
    return `${mc}|${po}|${lotPrefix}`;
  }

  // Get display IMD (importDate + sequence if any)
  getDisplayIMD(material: InventoryMaterial): string {
    if (!material.importDate) return 'N/A';

    const baseDate = material.importDate.toLocaleDateString('en-GB').split('/').join(''); // DDMMYYYY

    if (material.batchNumber && material.batchNumber !== baseDate) {
      // batchNumber là 10 số thuần (DDMMYYYY + 2 suffix) → trả về toàn bộ
      if (/^\d{10}$/.test(material.batchNumber) && material.batchNumber.startsWith(baseDate)) {
        return material.batchNumber;
      }
      // batchNumber bắt đầu bằng baseDate + 1-2 số suffix
      if (material.batchNumber.startsWith(baseDate)) {
        const suffix = material.batchNumber.substring(baseDate.length);
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
    // Gate IQC button by "Quyền" rule
    if (!this.iqcButtonEnabledForCurrentEmployee) {
      alert('⛔ Bạn chưa được bật quyền IQC. Vào More → Quyền để bật/tắt theo mã nhân viên.');
      return;
    }
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

    // Reset extra fields
    this.ngErrorText = '';
    this.lockReasonText = '';
    this.pendingNoteText = '';
    this.resetIqcPassLeUi();
    
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

    this.ngErrorText = '';
    this.lockReasonText = '';
    this.pendingNoteText = '';
    this.resetIqcPassLeUi();
  }

  private resetIqcPassLeUi(): void {
    this.iqcPassLe = false;
    this.iqcPassLeScanInput = '';
    this.iqcPassLeBagEntries = [];
  }

  private clearIqcPassLeEntriesOnly(): void {
    this.iqcPassLeScanInput = '';
    this.iqcPassLeBagEntries = [];
  }

  onSelectIqcStatus(status: string): void {
    this.selectedIQCStatus = status;
    if (status !== 'PASS') {
      this.resetIqcPassLeUi();
    }
  }

  onIqcPassLeCheckboxChange(checked: boolean): void {
    this.iqcPassLe = checked;
    if (!checked) {
      this.iqcPassLeScanInput = '';
      this.iqcPassLeBagEntries = [];
    } else {
      setTimeout(() => {
        const el = document.getElementById('iqc-pass-le-scan-input');
        if (el) {
          el.focus();
        }
      }, 80);
    }
  }

  get passLeHasSplit(): boolean {
    return this.iqcPassLeBagEntries.some(e => e.hasSplit);
  }

  get passLeNotPassedLabels(): string[] {
    if (!this.iqcPassLeBagEntries.length) {
      return [];
    }
    if (this.passLeHasSplit) {
      return [];
    }
    const T = this.getPassLeExpectedTotalBags();
    if (T <= 0) {
      return [];
    }
    const passed = new Set(this.iqcPassLeBagEntries.map(e => e.numerator));
    const out: string[] = [];
    for (let i = 1; i <= T; i++) {
      if (!passed.has(i)) {
        out.push(`${i}/${T}`);
      }
    }
    return out;
  }

  getPassLeExpectedTotalBags(): number {
    const fromDoc = Math.max(0, Math.floor(Number(this.scannedMaterial?.totalBags ?? 0)));
    if (!this.iqcPassLeBagEntries.length) {
      return fromDoc;
    }
    const d = this.iqcPassLeBagEntries[0].denominator;
    return Math.max(d, fromDoc);
  }

  /** QR cùng dòng kho (mã + PO + IMD) với material đang mở IQC. */
  private materialQrMatchesScannedLine(
    material: InventoryMaterial,
    materialCode: string,
    poNumber: string,
    part4ImdKey: string
  ): boolean {
    const mc = (material.materialCode || '').trim();
    if (mc !== (materialCode || '').trim()) {
      return false;
    }
    const poMat = (material.poNumber || '').trim();
    const poScan = (poNumber || '').trim();
    const poMatch =
      poMat === poScan || poMat.replace(/\s+/g, '') === poScan.replace(/\s+/g, '');
    if (!poMatch) {
      return false;
    }
    const matImd = this.getDisplayIMD(material);
    const k = (part4ImdKey || '').trim();
    if (!k) {
      return false;
    }
    return matImd === k || matImd.startsWith(k) || k.startsWith(matImd);
  }

  processIqcPassLeScan(): void {
    const raw = (this.iqcPassLeScanInput || '').trim();
    if (!raw || !this.scannedMaterial || !this.iqcPassLe) {
      return;
    }
    const parts = raw.split('|');
    if (parts.length < 4) {
      alert('❌ Pass lẻ: QR cần đúng định dạng MaterialCode|PO|Quantity|IMD (có số bịch).');
      this.iqcPassLeScanInput = '';
      return;
    }
    const materialCode = parts[0].trim();
    const poNumber = parts[1].trim();
    const part4 = parts[3].trim();
    const parsed = this.rmBagHistory.parseQrPart4(part4);
    if (!parsed.bagFractionLabel) {
      alert(
        '❌ Pass lẻ: phần IMD phải có số bịch dạng DDMMYYYY-số/tổng (VD: 01012026-3/10).'
      );
      this.iqcPassLeScanInput = '';
      return;
    }
    if (!this.materialQrMatchesScannedLine(this.scannedMaterial, materialCode, poNumber, parsed.imdKey)) {
      alert('❌ QR không khớp mã hàng / PO / IMD của dòng đang mở trong IQC.');
      this.iqcPassLeScanInput = '';
      return;
    }
    const fracParts = parsed.bagFractionLabel.split('/');
    const numerator = parseInt(fracParts[0], 10);
    const denominator = parseInt(fracParts[1], 10);
    if (
      !Number.isFinite(numerator) ||
      !Number.isFinite(denominator) ||
      numerator < 1 ||
      denominator < 1
    ) {
      alert('❌ Không đọc được số bịch từ tem.');
      this.iqcPassLeScanInput = '';
      return;
    }
    if (this.iqcPassLeBagEntries.length > 0) {
      const d0 = this.iqcPassLeBagEntries[0].denominator;
      if (denominator !== d0) {
        alert(`❌ Các tem phải cùng tổng bịch (đang dùng /${d0}).`);
        this.iqcPassLeScanInput = '';
        return;
      }
    }
    const displayKey =
      parsed.bagNumberDisplay && String(parsed.bagNumberDisplay).trim()
        ? String(parsed.bagNumberDisplay).trim()
        : parsed.bagFractionLabel;
    if (this.iqcPassLeBagEntries.some(e => e.displayKey === displayKey)) {
      alert('⚠️ Bịch này đã có trong danh sách đã pass.');
      this.iqcPassLeScanInput = '';
      return;
    }
    const hasSplit = String(parsed.bagNumberDisplay || '').includes('(');
    this.iqcPassLeBagEntries.push({
      displayKey,
      numerator,
      denominator,
      hasSplit
    });
    this.iqcPassLeScanInput = '';
    setTimeout(() => {
      const el = document.getElementById('iqc-pass-le-scan-input');
      if (el) {
        el.focus();
      }
    }, 50);
  }

  openMaterialCheckModal(): void {
    if (!this.currentEmployeeId || this.currentEmployeeId.trim() === '') {
      const savedEmployeeId = localStorage.getItem('qc_currentEmployeeId');
      const savedEmployeeName = localStorage.getItem('qc_currentEmployeeName');
      if (savedEmployeeId && savedEmployeeName) {
        this.currentEmployeeId = savedEmployeeId;
        this.currentEmployeeName = savedEmployeeName;
        this.isEmployeeVerified = true;
      } else {
        alert('⚠️ Vui lòng xác thực nhân viên trước khi tra cứu.');
        this.showEmployeeModal = true;
        return;
      }
    }

    this.showMaterialCheckModal = true;
    this.materialCheckScanInput = '';
    this.materialCheckRows = [];
    this.materialCheckError = '';
    this.materialCheckBusy = false;

    setTimeout(() => {
      const input = document.getElementById('material-check-scan-input');
      if (input) {
        input.focus();
      }
    }, 100);
  }

  closeMaterialCheckModal(): void {
    this.showMaterialCheckModal = false;
    this.materialCheckScanInput = '';
    this.materialCheckRows = [];
    this.materialCheckError = '';
    this.materialCheckBusy = false;
  }

  private mapDocToMaterialCheckRow(doc: any): MaterialCheckRow {
    const data = doc.data() as any;
    const mat: InventoryMaterial = {
      id: doc.id,
      factory: data.factory || this.selectedFactory,
      importDate: this.parseImportDate(data.importDate),
      receivedDate: data.receivedDate?.toDate() || undefined,
      batchNumber: this.resolveImdBatchNumber(data),
      materialCode: data.materialCode || '',
      materialName: data.materialName || '',
      poNumber: data.poNumber || '',
      openingStock: data.openingStock ?? null,
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
      iqcStatus: data.iqcStatus || '',
      totalBags: Math.max(0, Math.floor(Number(data.totalBags ?? 0))),
      createdAt: data.createdAt?.toDate() || new Date(),
      updatedAt: data.updatedAt?.toDate() || new Date()
    };

    return {
      id: doc.id,
      materialCode: mat.materialCode,
      materialName: mat.materialName,
      poNumber: mat.poNumber,
      batchNumber: mat.batchNumber,
      location: mat.location,
      imdLabel: this.getDisplayIMD(mat),
      iqcStatus: (data.iqcStatus || '').toString(),
      qcCheckedBy: (data.qcCheckedBy || '').toString(),
      qcCheckedAt: this.parseFirestoreDate(data.qcCheckedAt)
    };
  }

  async processMaterialCheckScan(): Promise<void> {
    const raw = (this.materialCheckScanInput || '').trim();
    if (!raw || this.materialCheckBusy) {
      return;
    }

    this.materialCheckBusy = true;
    this.materialCheckError = '';
    this.materialCheckRows = [];

    try {
      const parts = raw.split('|');

      if (parts.length >= 4) {
        const materialCode = parts[0].trim();
        const poNumber = parts[1].trim();
        const scannedIMD = parts[3].trim();

        const querySnapshot = await this.firestore.collection('inventory-materials', ref =>
          ref.where('factory', '==', this.selectedFactory)
             .where('materialCode', '==', materialCode)
             .where('poNumber', '==', poNumber)
             .limit(25)
        ).get().toPromise();

        if (!querySnapshot || querySnapshot.empty) {
          this.materialCheckError =
            `Không tìm thấy dòng kho (${this.selectedFactory}) cho mã ${materialCode}, PO ${poNumber}.`;
          this.materialCheckScanInput = '';
          return;
        }

        let matched: MaterialCheckRow | null = null;
        querySnapshot.forEach((doc: any) => {
          if (matched) return;
          const row = this.mapDocToMaterialCheckRow(doc);
          const imdMatch =
            row.imdLabel === scannedIMD ||
            row.imdLabel.startsWith(scannedIMD) ||
            scannedIMD.startsWith(row.imdLabel);
          if (imdMatch) {
            matched = row;
          }
        });

        if (!matched) {
          this.materialCheckError =
            `Không khớp IMD với dữ liệu kho. Đã quét IMD: ${scannedIMD}.`;
          this.materialCheckScanInput = '';
          return;
        }

        this.materialCheckRows = [matched];
      } else {
        const materialCode = (parts[0] || raw).trim().toUpperCase();
        if (!materialCode) {
          this.materialCheckError = 'Vui lòng quét hoặc nhập mã nguyên liệu.';
          return;
        }

        let snapshot: any = null;
        try {
          snapshot = await this.firestore.collection('inventory-materials', ref =>
            ref.where('factory', '==', this.selectedFactory)
               .where('materialCode', '==', materialCode)
               .limit(200)
          ).get().toPromise();
        } catch (e) {
          // 🔧 FIX: Trước đây fallback đọc TOÀN BỘ inventory-materials của factory (2000 doc)
          // khi query lỗi — quá tốn kém cho 1 lỗi (thường là mạng tạm thời), và query trên chỉ
          // dùng 2 điều kiện == nên không cần composite index. Báo lỗi để user thử lại thay vì quét cả factory.
          console.error('[QC] materialCheckScan query failed:', e);
          this.materialCheckError = `Lỗi tải dữ liệu kho, vui lòng thử lại. (${materialCode})`;
          this.materialCheckScanInput = '';
          return;
        }

        if (!snapshot || snapshot.empty) {
          this.materialCheckError = `Không tìm thấy mã ${materialCode} tại ${this.selectedFactory}.`;
          this.materialCheckScanInput = '';
          return;
        }

        const rows = snapshot.docs
          .map((doc: any) => this.mapDocToMaterialCheckRow(doc))
          .filter((row: any) => (row.materialCode || '').toUpperCase() === materialCode)
          .sort((a: any, b: any) => {
            const ta = a.qcCheckedAt ? a.qcCheckedAt.getTime() : 0;
            const tb = b.qcCheckedAt ? b.qcCheckedAt.getTime() : 0;
            return tb - ta;
          });

        if (rows.length === 0) {
          this.materialCheckError = `Không tìm thấy mã ${materialCode} tại ${this.selectedFactory}.`;
        } else {
          this.materialCheckRows = rows;
        }
      }

      this.materialCheckScanInput = '';
    } catch (error: any) {
      console.error('Error material check scan:', error);
      this.materialCheckError = `Lỗi tra cứu: ${error?.message || error}`;
      this.materialCheckScanInput = '';
    } finally {
      this.materialCheckBusy = false;
    }
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
    
    // Trích IMD key từ part4 QR (bỏ phần bag fraction "-x/y")
    const scannedImdKey = this.extractImdKeyFromPart4(scannedIMD);

    const isMaterialAndPoMatch = (m: InventoryMaterial) => {
      if (m.materialCode !== materialCode) return false;
      const normalizedMaterialPO = (m.poNumber || '').trim();
      const normalizedScannedPO = poNumber.trim();
      return normalizedMaterialPO === normalizedScannedPO ||
             normalizedMaterialPO.replace(/\s+/g, '') === normalizedScannedPO.replace(/\s+/g, '');
    };

    // Ưu tiên exact match IMD key trước, sau đó mới dùng prefix match
    let foundMaterial: InventoryMaterial | undefined =
      this.materials.find(m => {
        if (!isMaterialAndPoMatch(m)) return false;
        const materialIMD = this.getDisplayIMD(m);
        return materialIMD === scannedImdKey;
      });

    if (!foundMaterial) {
      foundMaterial = this.materials.find(m => {
        if (!isMaterialAndPoMatch(m)) return false;
        const materialIMD = this.getDisplayIMD(m);
        return scannedImdKey.startsWith(materialIMD) || materialIMD.startsWith(scannedImdKey);
      });
    }

    console.log('🔍 Match result:', { scannedImdKey, scannedIMD, foundMaterial: foundMaterial?.materialCode });
    
    if (foundMaterial) {
      this.applyScannedImdToBatchNumber(foundMaterial, scannedIMD);
      this.scannedMaterial = foundMaterial;
      this.clearIqcPassLeEntriesOnly();
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
        ref.where('factory', '==', this.selectedFactory)
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
      
      // Trích IMD key từ part4 QR (bỏ bag fraction "-x/y")
      const scannedImdKey = this.extractImdKeyFromPart4(scannedIMD);

      const allCandidates: InventoryMaterial[] = [];
      querySnapshot.forEach(doc => {
        const data = doc.data() as any;
        const material: InventoryMaterial = {
          id: doc.id,
          factory: data.factory || this.selectedFactory,
          importDate: this.parseImportDate(data.importDate),
          receivedDate: data.receivedDate?.toDate() || undefined,
          batchNumber: this.resolveImdBatchNumber(data),
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
          totalBags: Math.max(0, Math.floor(Number(data.totalBags ?? 0))),
          createdAt: data.createdAt?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || new Date()
        };

        const materialIMD = this.getDisplayIMD(material);
        const isExact = materialIMD === scannedImdKey;
        const isPrefix = scannedImdKey.startsWith(materialIMD) || materialIMD.startsWith(scannedImdKey);

        console.log(`🔍 Checking Firestore material ${material.materialCode}:`, {
          materialIMD, scannedImdKey, isExact, isPrefix
        });

        if (isExact || isPrefix) {
          allCandidates.push(material);
        }
      });

      // Ưu tiên exact match trước
      foundMaterial = allCandidates.find(m => this.getDisplayIMD(m) === scannedImdKey)
                   || allCandidates[0]
                   || null;
      
      if (foundMaterial) {
        this.applyScannedImdToBatchNumber(foundMaterial, scannedIMD);
        this.scannedMaterial = foundMaterial;
        this.clearIqcPassLeEntriesOnly();
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
    const wantsPassLePartial = this.selectedIQCStatus === 'PASS' && this.iqcPassLe;
    let statusToUpdate = this.selectedIQCStatus;
    if (wantsPassLePartial) {
      if (this.iqcPassLeBagEntries.length === 0) {
        alert(
          'Pass lẻ: vui lòng quét ít nhất một tem bịch.\nTem phải có phần IMD dạng DDMMYYYY-số/tổng (VD: 01012026-2/10).'
        );
        return;
      }
      statusToUpdate = 'CHƯA XONG';
    }
    const materialToUpdate = { ...this.scannedMaterial };
    const employeeIdToSave = this.currentEmployeeId.trim();

    const oldIqcStatus = (materialToUpdate.iqcStatus || '').trim();
    const wasPendingQcPriority = (this.priorityPendingQcIds || []).includes(materialId);
    const wasPendingConfirmPriority = this.priorityMaterialId === materialId;
    const shouldTransferQcPriorityToConfirm =
      wasPendingQcPriority &&
      oldIqcStatus === 'CHỜ KIỂM' &&
      statusToUpdate === 'CHỜ XÁC NHẬN';
    const shouldNotifyPriorityResolved =
      wasPendingQcPriority &&
      oldIqcStatus === 'CHỜ KIỂM' &&
      this.isQcPriorityTerminalStatus(statusToUpdate);

    const shouldClearPendingConfirmPriority =
      wasPendingConfirmPriority && this.isQcPriorityTerminalStatus(statusToUpdate);
    const shouldClearPendingQcPriority =
      wasPendingQcPriority && this.isQcPriorityTerminalStatus(statusToUpdate);

    if (shouldTransferQcPriorityToConfirm) {
      this.priorityPendingQcIds = (this.priorityPendingQcIds || []).filter(id => id !== materialId);
      this.priorityMaterialId = materialId;
    } else if (this.isQcPriorityTerminalStatus(statusToUpdate)) {
      if (this.priorityMaterialId === materialId) {
        this.priorityMaterialId = null;
      }
      this.priorityPendingQcIds = (this.priorityPendingQcIds || []).filter(id => id !== materialId);
    }
    
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
    const updatePayload: any = {
      iqcStatus: statusToUpdate,
      updatedAt: now,
      qcCheckedBy: employeeIdToSave,
      qcCheckedAt: now
    };

    // Clear backend priority flags — giữ ưu tiên khi chuyển CHỜ KIỂM → CHỜ XÁC NHẬN; chỉ xóa khi Pass/NG
    if (shouldTransferQcPriorityToConfirm) {
      updatePayload.qcPriorityPendingQC = false;
      updatePayload.qcPriorityAutoPendingQC = false;
      updatePayload.qcPriorityPendingConfirm = true;
      updatePayload.qcPriorityUpdatedAt = now;
    }
    if (shouldClearPendingConfirmPriority) {
      updatePayload.qcPriorityPendingConfirm = false;
      updatePayload.qcPriorityUpdatedAt = now;
    }
    if (shouldClearPendingQcPriority) {
      updatePayload.qcPriorityPendingQC = false;
      updatePayload.qcPriorityAutoPendingQC = false;
      updatePayload.qcPriorityUpdatedAt = now;
    }

    // Save extra fields by selected status
    if (statusToUpdate === 'NG') {
      updatePayload.iqcNgError = (this.ngErrorText || '').trim();
    } else if (statusToUpdate === 'LOCK') {
      updatePayload.iqcLockReason = (this.lockReasonText || '').trim();
    } else if (statusToUpdate === 'ĐẶC CÁCH') {
      // Use NG error as special-case note
      updatePayload.iqcNgError = (this.ngErrorText || '').trim();
    } else if (statusToUpdate === 'CHỜ KIỂM') {
      updatePayload.iqcPendingNote = (this.pendingNoteText || '').trim();
    }

    const del = firebase.firestore.FieldValue.delete();
    if (statusToUpdate === 'CHƯA XONG') {
      updatePayload.iqcPassLeBagKeys = this.iqcPassLeBagEntries.map(e => e.displayKey);
      updatePayload.iqcPassLeTotalBags = this.getPassLeExpectedTotalBags();
      updatePayload.iqcPassLeNotPassedBags = this.passLeNotPassedLabels;
    } else {
      updatePayload.iqcPassLeBagKeys = del;
      updatePayload.iqcPassLeTotalBags = del;
      updatePayload.iqcPassLeNotPassedBags = del;
    }

    this.resetIqcPassLeUi();

    this.firestore.collection('inventory-materials').doc(materialId).update(updatePayload).then(async () => {
      console.log(`✅ Updated IQC status in Firestore: ${materialId} -> ${statusToUpdate} by ${employeeIdToSave} at ${now.toISOString()}`);

      if (this.isQcPassStatus(statusToUpdate)) {
        try {
          await this.propagatePassToSiblingLots(materialToUpdate, {
            qcCheckedBy: employeeIdToSave,
            qcCheckedAt: now
          });
        } catch (e) {
          console.warn('⚠️ Propagate PASS to sibling lots:', e);
        }
      }

      this.notifyQcPriorityResolvedIfNeeded(
        shouldNotifyPriorityResolved,
        materialToUpdate,
        oldIqcStatus,
        statusToUpdate,
        employeeIdToSave
      );

      // Refresh counts và recent materials sau khi update thành công (chạy background)
      setTimeout(() => {
        this.loadPendingQCCount();
        this.loadTodayCheckedCount();
        this.loadPendingConfirmCount();
        this.loadMonthlyStatusCounts();

        // Reload inline list if user is viewing it
        if (this.iqcHistoryContext === 'pendingConfirm' && this.showIqcSearchResults) {
          this.showPendingConfirmMaterials(false);
        } else if (this.iqcHistoryContext === 'todayChecked' && this.showIqcSearchResults) {
          this.showTodayCheckedMaterials(false);
        } else if (this.iqcHistoryContext === 'pendingQC' && this.showIqcSearchResults) {
          this.showPendingQCMaterials(false);
        } else if (this.iqcHistoryContext === 'monthlyPass' && this.showIqcSearchResults) {
          this.showMonthlyStatusMaterials('PASS');
        } else if (this.iqcHistoryContext === 'monthlyNg' && this.showIqcSearchResults) {
          this.showMonthlyStatusMaterials('NG');
        } else if (this.iqcHistoryContext === 'monthlyLock' && this.showIqcSearchResults) {
          this.showMonthlyStatusMaterials('LOCK');
        } else {
          this.loadRecentCheckedMaterials();
        }
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

  /** Gửi mail khi mã ưu tiên ở danh sách Chờ kiểm đổi từ CHỜ KIỂM sang trạng thái khác — không chặn UI. */
  private notifyQcPriorityResolvedIfNeeded(
    shouldNotify: boolean,
    material: InventoryMaterial,
    oldStatus: string,
    newStatus: string,
    checkedBy: string
  ): void {
    if (!shouldNotify) {
      return;
    }
    const payload = {
      materialCode: String(material.materialCode || '').slice(0, 120),
      poNumber: String(material.poNumber || '').slice(0, 120),
      imd: String(this.getDisplayIMD(material) || '').slice(0, 120),
      location: String(material.location || '').slice(0, 120),
      factory: String(material.factory || this.selectedFactory).slice(0, 40),
      oldStatus: String(oldStatus || '').slice(0, 80),
      newStatus: String(newStatus || '').slice(0, 80),
      checkedBy: String(checkedBy || '').slice(0, 80)
    };
    const callable = this.fns.httpsCallable('sendQcPriorityResolvedEmailFn');
    firstValueFrom(callable(payload))
      .then(() => console.log('📧 QC ưu tiên: đã gửi thông báo email'))
      .catch((e) => console.warn('📧 QC ưu tiên: gửi email thất bại', e));
  }

  // Update local counts immediately (optimistic update)
  updateLocalCounts(newStatus: string, material: InventoryMaterial): void {
    const oldStatus = material.iqcStatus || 'CHỜ KIỂM';
    
    // Update pending QC count
    if (oldStatus === 'CHỜ KIỂM' && newStatus !== 'CHỜ KIỂM') {
      if (this.pendingQCCount > 0) {
        this.pendingQCCount--;
      }
      const lotKey = this.getInventoryLotKey(material);
      this.pendingQCMaterials = (this.pendingQCMaterials || []).filter(
        m => this.getInventoryLotKey(m) !== lotKey
      );
      if (this.iqcHistoryContext === 'pendingQC') {
        this.iqcHistoryResults = this.sortPendingQcListByPriorityAndMaterialCode(
          (this.iqcHistoryResults || []).filter(m => this.getInventoryLotKey(m) !== lotKey)
        );
        this.pendingQCMaterials = this.sortPendingQcListByPriorityAndMaterialCode(
          (this.pendingQCMaterials || []).filter(m => this.getInventoryLotKey(m) !== lotKey)
        );
        this.rebuildPendingQcDuplicateMaterialCodes(this.iqcHistoryResults);
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
      case 'LOCK':
        return 'status-lock';
      case 'ĐẶC CÁCH':
        return 'status-special';
      case 'CHƯA XONG':
        return 'status-chua-xong';
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
    if (status === 'CHƯA XONG') {
      return 'Chưa xong';
    }
    if (!status || status === 'CHỜ KIỂM' || status === 'CHỜ XÁC NHẬN') {
      return status || 'CHỜ KIỂM';
    }
    return status;
  }

  /** Ưu tiên QC chỉ kết thúc khi Pass hoặc NG. */
  private isQcPriorityTerminalStatus(status: string): boolean {
    const s = String(status || '').trim().toUpperCase();
    return s === 'PASS' || s === 'NG';
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
    const normalizedInput = scannedData.replace(/ÁP/gi, 'ASP');

    // Rule: 7 ký tự đầu là mã NV, giữa dấu - đầu và dấu - thứ 2 là tên NV
    const employeeId = normalizedInput.substring(0, 7).toUpperCase();
    let employeeName = '';
    const firstDash = normalizedInput.indexOf('-');
    const secondDash = firstDash >= 0 ? normalizedInput.indexOf('-', firstDash + 1) : -1;
    if (firstDash >= 0 && secondDash > firstDash) {
      employeeName = normalizedInput.substring(firstDash + 1, secondDash).trim();
    }
    
    // If name not found in QR code, try to get from users collection
    if (!employeeName) {
      employeeName = await this.getEmployeeNameFromFirestore(employeeId);
    }
    
    const hasAccess = await this.hasQcTabAccess(employeeId);

    if (hasAccess) {
      this.currentEmployeeId = employeeId;
      this.currentEmployeeName = employeeName || employeeId; // Fallback to ID if no name
      this.isEmployeeVerified = true;
      this.showEmployeeModal = false;
      this.employeeScanInput = '';

      // Load IQC permission for this employee
      this.iqcButtonEnabledForCurrentEmployee = await this.hasIqcButtonPermission(employeeId);
      
      // 🔧 FIX: Lưu currentEmployeeId vào localStorage để khôi phục khi refresh
      localStorage.setItem('qc_currentEmployeeId', employeeId);
      localStorage.setItem('qc_currentEmployeeName', this.currentEmployeeName);
      
      console.log('✅ Employee verified:', employeeId, 'Name:', employeeName);
      console.log('💾 Saved to localStorage for persistence');
      
      // Load counts and recent materials after employee verified
      this.loadPendingQCCount();
      this.loadTodayCheckedCount();
      this.loadPendingConfirmCount();
      this.loadMonthlyStatusCounts();
      this.loadRecentCheckedMaterials();

      // Load priority state from backend so icons/count are correct ngay sau khi xác thực
      this.loadQcPriorityFromBackend();
    } else {
      alert(`❌ Nhân viên ${employeeId} không có quyền truy cập tab QC.\n\nVui lòng cấp quyền tab Quality trong Settings.`);
      this.employeeScanInput = '';
    }
  }

  /** Mã nhân viên được phép quét đăng nhập tab QC (bổ sung ngoài quyền Settings). */
  private static readonly QC_SCAN_LOGIN_ALLOWLIST = new Set<string>(['ASP2137', 'ASP1747']);

  /** Quyền quét tem QC: allowlist cố định, hoặc tài khoản Firebase có tab Quality trong Settings (user-tab-permissions.qc). */
  private async hasQcTabAccess(employeeId: string): Promise<boolean> {
    const normalizedId = (employeeId || '').trim().toUpperCase();
    if (!normalizedId) return false;

    if (QCComponent.QC_SCAN_LOGIN_ALLOWLIST.has(normalizedId)) {
      return true;
    }

    // 1) Find UID in users collection by employeeId, then by email convention
    let candidateUids: string[] = [];

    try {
      const usersByEmp = await this.firestore.collection('users', ref =>
        ref.where('employeeId', '==', normalizedId).limit(5)
      ).get().toPromise();

      if (usersByEmp && !usersByEmp.empty) {
        candidateUids.push(...usersByEmp.docs.map(doc => doc.id));
      }
    } catch (e) {
      console.warn('⚠️ users(employeeId) lookup failed:', e);
    }

    const emailCandidates = [
      `${normalizedId.toLowerCase()}@asp.com`,
      `${normalizedId.toLowerCase()}@gmail.com`
    ];

    for (const email of emailCandidates) {
      try {
        const usersByEmail = await this.firestore.collection('users', ref =>
          ref.where('email', '==', email).limit(5)
        ).get().toPromise();
        if (usersByEmail && !usersByEmail.empty) {
          candidateUids.push(...usersByEmail.docs.map(doc => doc.id));
        }
      } catch (e) {
        console.warn('⚠️ users(email) lookup failed:', e);
      }
    }

    // 2) Fallback from user-permissions (sometimes this collection has extra user records)
    try {
      const permsByEmp = await this.firestore.collection('user-permissions', ref =>
        ref.where('employeeId', '==', normalizedId).limit(5)
      ).get().toPromise();
      if (permsByEmp && !permsByEmp.empty) {
        candidateUids.push(...permsByEmp.docs.map(doc => doc.id));
      }
    } catch (e) {
      console.warn('⚠️ user-permissions(employeeId) lookup failed:', e);
    }

    for (const email of emailCandidates) {
      try {
        const permsByEmail = await this.firestore.collection('user-permissions', ref =>
          ref.where('email', '==', email).limit(5)
        ).get().toPromise();
        if (permsByEmail && !permsByEmail.empty) {
          candidateUids.push(...permsByEmail.docs.map(doc => doc.id));
        }
      } catch (e) {
        console.warn('⚠️ user-permissions(email) lookup failed:', e);
      }
    }

    // Deduplicate
    candidateUids = Array.from(new Set(candidateUids.filter(Boolean)));
    if (candidateUids.length === 0) return false;

    // 3) Check tab permission qc = true in user-tab-permissions
    for (const uid of candidateUids) {
      try {
        const tabDoc = await this.firestore.collection('user-tab-permissions').doc(uid).get().toPromise();
        if (!tabDoc?.exists) continue;

        const data = tabDoc.data() as any;
        const tabPermissions = data?.tabPermissions || {};
        if (tabPermissions?.qc === true) {
          return true;
        }
      } catch (e) {
        console.warn(`⚠️ user-tab-permissions lookup failed for uid=${uid}:`, e);
      }
    }

    return false;
  }

  /**
   * Quyền bấm nút IQC:
   * - Collection: qc-iqc-permissions/{EMPLOYEE_ID}
   * - enabled: boolean (default false nếu không có doc)
   */
  private async hasIqcButtonPermission(employeeId: string): Promise<boolean> {
    const emp = (employeeId || '').trim().toUpperCase();
    if (!emp) return false;
    try {
      const snap = await this.firestore.collection('qc-iqc-permissions').doc(emp).get().toPromise();
      if (!snap?.exists) return false;
      const d = snap.data() as any;
      return d?.enabled === true;
    } catch (e) {
      console.warn('⚠️ Failed to read IQC permission (default OFF):', e);
      return false;
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
  
  // Load recent checked materials — Firestore sort + limit, filter autoPass in memory
  loadRecentCheckedMaterials(): void {
    this.isLoadingRecent = true;

    // Dùng qcCheckedAt >= 2020 để Firestore chỉ trả doc đã có checkedAt,
    // đồng thời orderBy + limit ở server → không cần sort/slice client nữa.
    // Index cần: factory ASC + qcCheckedAt DESC  (xem firestore.indexes.json)
    const baseTs = firebase.firestore.Timestamp.fromDate(new Date(2020, 0, 1));

    this.firestore.collection('inventory-materials', ref =>
      ref.where('factory', '==', this.selectedFactory)
         .where('qcCheckedAt', '>=', baseTs)   // lọc tại Firestore: chỉ doc đã kiểm
         .orderBy('qcCheckedAt', 'desc')        // sort tại Firestore
         .limit(60)                             // 60 thay vì 500; đủ dư để lọc autoPass
    ).get()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        const recentMaterials = snapshot.docs
          .map(doc => {
            const data = doc.data() as any;
            const qcCheckedAt = data.qcCheckedAt?.toDate ? data.qcCheckedAt.toDate() : null;
            const iqcStatus   = data.iqcStatus;
            const qcCheckedBy = data.qcCheckedBy || '';
            const location    = (data.location || '').toUpperCase();

            const isAutoPass     = (location === 'F62' || location === 'F62TRA') && iqcStatus === 'Pass' && !qcCheckedBy;
            const hasUserChecked = qcCheckedBy && qcCheckedBy.trim() !== '' && qcCheckedAt;

            if (iqcStatus && iqcStatus !== 'CHỜ KIỂM' && hasUserChecked && !isAutoPass) {
              return {
                materialCode: data.materialCode || '',
                poNumber:     data.poNumber     || '',
                batchNumber:  data.batchNumber  || '',
                iqcStatus,
                checkedBy: qcCheckedBy,
                checkedAt: qcCheckedAt
              };
            }
            return null;
          })
          .filter((m): m is NonNullable<typeof m> => m !== null)
          .slice(0, 20); // tối đa 20 hiển thị

        this.recentCheckedMaterials = recentMaterials;
        this.isLoadingRecent = false;
      },
      error: (error) => {
        console.error('❌ Error loading recent checked materials:', error);
        this.isLoadingRecent = false;
        this.recentCheckedMaterials = [];
      }
    });
  }
  
  // Load pending QC count from Firestore (one-time query, not subscription)
  loadPendingQCCount(): void {
    const range = this.boxDateRanges['pendingQC'];
    this.firestore.collection('inventory-materials', ref =>
      ref.where('factory', '==', this.selectedFactory)
         .where('iqcStatus', '!=', 'PASS')
         .limit(2000)
    ).get()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: async (snapshot) => {
        try {
          let docs = snapshot.docs;
          if (docs.length) {
            const syncedCount = await this.syncAutoPassPendingDuplicates(docs);
            if (syncedCount > 0) {
              const refreshed = await this.firestore
                .collection('inventory-materials', ref => ref.where('factory', '==', this.selectedFactory))
                .get()
                .toPromise();
              if (refreshed) docs = refreshed.docs;
            }
          }
          this.pendingQCCount = this.countPendingQcLotGroups(docs, range);
        } catch (e) {
          console.warn('⚠️ Auto-pass pending duplicates:', e);
          this.pendingQCCount = this.countPendingQcLotGroups(snapshot.docs, range);
        }
      },
      error: (error) => {
        console.error('❌ Error loading pending QC count:', error);
        this.pendingQCCount = this.materials.filter(m =>
          this.isPendingQcAtIqc({ iqcStatus: m.iqcStatus, location: m.location })
        ).length;
      }
    });
  }
  
  // Load checked count cho khoảng date của box "todayChecked"
  // Index cần: factory ASC + qcCheckedAt ASC  (xem firestore.indexes.json)
  loadTodayCheckedCount(): void {
    const range = this.boxDateRanges['todayChecked'];
    const from  = range?.from ?? this.startOfDay(new Date());
    const to    = range?.to   ?? this.endOfDay(new Date());

    const fromTs = firebase.firestore.Timestamp.fromDate(from);
    const toTs   = firebase.firestore.Timestamp.fromDate(to);

    this.firestore.collection('inventory-materials', ref =>
      ref.where('factory',    '==', this.selectedFactory)
         .where('qcCheckedAt', '>=', fromTs)   // ← lọc tại Firestore
         .where('qcCheckedAt', '<=', toTs)     // ← lọc tại Firestore
    ).get()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        // Server đã lọc theo ngày; chỉ còn check autoPass + hasUserChecked
        this.todayCheckedCount = snapshot.docs.filter(doc => {
          const data        = doc.data() as any;
          const qcCheckedAt = data.qcCheckedAt?.toDate ? data.qcCheckedAt.toDate() : null;
          const iqcStatus   = data.iqcStatus;
          const qcCheckedBy = data.qcCheckedBy || '';
          const location    = (data.location || '').toUpperCase();

          const isAutoPass     = (location === 'F62' || location === 'F62TRA') && iqcStatus === 'Pass' && !qcCheckedBy;
          const hasUserChecked = qcCheckedBy && qcCheckedBy.trim() !== '' && qcCheckedAt;

          return iqcStatus && iqcStatus !== 'CHỜ KIỂM' && hasUserChecked && !isAutoPass;
        }).length;
      },
      error: (error) => {
        console.error('❌ Error loading today checked count:', error);
        this.todayCheckedCount = this.materials.filter(m => {
          if (!m.iqcStatus || m.iqcStatus === 'CHỜ KIỂM') return false;
          const checkDate = m.updatedAt || new Date();
          return checkDate >= from && checkDate <= to;
        }).length;
      }
    });
  }
  
  // Load pending confirm count (one-time query)
  loadPendingConfirmCount(): void {
    const range = this.boxDateRanges['pendingConfirm'];
    this.firestore.collection('inventory-materials', ref =>
      ref.where('factory', '==', this.selectedFactory)
         .where('iqcStatus', '==', 'CHỜ XÁC NHẬN')
    ).get()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        this.pendingConfirmCount = snapshot.docs.filter(doc => {
          if (!range?.from && !range?.to) return true;
          const data = doc.data() as any;
          const dt = this.parseFirestoreDate(data.importDate) || this.parseFirestoreDate(data.createdAt);
          if (!dt) return true;
          if (range.from && dt < range.from) return false;
          if (range.to   && dt > range.to)   return false;
          return true;
        }).length;
      },
      error: (error) => {
        console.error('❌ Error loading pending confirm count:', error);
        this.pendingConfirmCount = this.materials.filter(m =>
          m.iqcStatus === 'CHỜ XÁC NHẬN'
        ).length;
      }
    });
  }

  private getCurrentMonthRange(): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { start, end };
  }

  // Load PASS / NG / LOCK counts với per-box date ranges
  // Tính broadest range → filter tại Firestore; sau đó lọc per-status trong memory (dataset nhỏ hơn nhiều)
  // Index cần: factory ASC + qcCheckedAt ASC  (xem firestore.indexes.json)
  loadMonthlyStatusCounts(): void {
    const passRange = this.boxDateRanges['pass'];
    const ngRange   = this.boxDateRanges['ng'];
    const lockRange = this.boxDateRanges['lock'];

    // Tính khoảng rộng nhất của 3 box để dùng làm server-side filter
    const allFroms = [passRange?.from, ngRange?.from, lockRange?.from]
                       .filter((d): d is Date => !!d);
    const allTos   = [passRange?.to,   ngRange?.to,   lockRange?.to  ]
                       .filter((d): d is Date => !!d);
    const broadFrom = allFroms.length
      ? new Date(Math.min(...allFroms.map(d => d.getTime()))) : null;
    const broadTo   = allTos.length
      ? new Date(Math.max(...allTos.map(d => d.getTime())))   : null;

    const inRange = (dt: Date | null, range: { from: Date | null; to: Date | null } | undefined): boolean => {
      if (!dt || !range) return !!dt;
      if (range.from && dt < range.from) return false;
      if (range.to   && dt > range.to)   return false;
      return true;
    };

    this.firestore.collection('inventory-materials', ref => {
      let q: firebase.firestore.Query = ref.where('factory', '==', this.selectedFactory);
      // Push date range xuống Firestore — giảm số docs trả về đáng kể
      if (broadFrom) q = q.where('qcCheckedAt', '>=', firebase.firestore.Timestamp.fromDate(broadFrom));
      if (broadTo)   q = q.where('qcCheckedAt', '<=', firebase.firestore.Timestamp.fromDate(broadTo));
      return q;
    }).get()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        let pass = 0, ng = 0, lock = 0;

        snapshot.docs.forEach((doc: any) => {
          const data        = doc.data() as any;
          const eventTime   = this.parseFirestoreDate(data?.qcCheckedAt) ||
                              this.parseFirestoreDate(data?.updatedAt)   || null;
          const statusNorm  = (data?.iqcStatus  || '').toString().trim().toUpperCase();
          const qcCheckedBy = (data?.qcCheckedBy || '').toString();
          const location    = (data?.location    || '').toString().trim().toUpperCase();

          const isAutoPass =
            (location === 'F62' || location === 'F62TRA') &&
            statusNorm === 'PASS' &&
            (!qcCheckedBy || !qcCheckedBy.trim());
          if (isAutoPass) return;

          if      (statusNorm === 'PASS' && inRange(eventTime, passRange)) pass++;
          else if (statusNorm === 'NG'   && inRange(eventTime, ngRange))   ng++;
          else if (statusNorm === 'LOCK' && inRange(eventTime, lockRange)) lock++;
        });

        this.monthlyPassCount = pass;
        this.monthlyNgCount   = ng;
        this.monthlyLockCount = lock;
      },
      error: (error) => {
        console.error('❌ Error loading PASS/NG/LOCK counts:', error);
        const now    = new Date();
        const startF = new Date(now.getFullYear(), now.getMonth(), 1);
        const endF   = new Date(now.getFullYear(), now.getMonth() + 1, 1);

        const countBy = (status: string) =>
          this.materials.filter(m => {
            const checkDate = (m as any)?.qcCheckedAt || m.updatedAt || new Date();
            const et = checkDate instanceof Date ? checkDate : new Date(checkDate);
            if (!et || et < startF || et >= endF) return false;
            return (m?.iqcStatus || '').toString().trim().toUpperCase() === status.toUpperCase();
          }).length;

        this.monthlyPassCount = countBy('PASS');
        this.monthlyNgCount   = countBy('NG');
        this.monthlyLockCount = countBy('LOCK');
      }
    });
  }

  // Show inline monthly list (no popup)
  async showMonthlyStatusMaterials(status: 'PASS' | 'NG' | 'LOCK'): Promise<void> {
    this.showTodayCheckedModal = false;
    this.showPendingQCModal = false;
    this.showPendingConfirmModal = false;
    this.priorityMaterialId = null; // avoid stale priority from another list

    this.iqcResultsTitle = `${status} (tháng hiện tại)`;
    this.showIqcSearchResults = true;
    this.isSearchingIqcHistory = true;
    this.iqcHistoryError = '';
    this.iqcHistoryResults = [];

    this.iqcHistoryContext =
      status === 'PASS' ? 'monthlyPass' :
      status === 'NG' ? 'monthlyNg' :
      'monthlyLock';

    const { start, end } = this.getCurrentMonthRange();

    try {
      // Try more selective query first
      let snapshot: any = null;
      try {
        snapshot = await this.firestore.collection('inventory-materials', ref =>
          ref.where('factory', '==', this.selectedFactory)
             .where('iqcStatus', '==', status)
             .limit(2000)
        ).get().toPromise();
      } catch (e) {
        // Fallback: filter in memory (avoid index issues)
        snapshot = await this.firestore.collection('inventory-materials', ref =>
          ref.where('factory', '==', this.selectedFactory)
             .limit(5000)
        ).get().toPromise();
      }

      if (!snapshot || snapshot.empty) {
        this.iqcHistoryResults = [];
        this.isSearchingIqcHistory = false;
        this.iqcHistoryError = '';
        return;
      }

      const results = snapshot.docs
        .map((doc: any) => {
          const data = doc.data() as any;
          const eventTime =
            this.parseFirestoreDate(data?.qcCheckedAt) ||
            this.parseFirestoreDate(data?.updatedAt);
          if (!eventTime || eventTime < start || eventTime >= end) return null;

          const statusNorm = (data?.iqcStatus || '').toString().trim().toUpperCase();
          const qcCheckedBy = (data?.qcCheckedBy || '').toString();
          const location = (data?.location || '').toString().trim().toUpperCase();

          // Exclude auto-pass like today logic
          const isAutoPass =
            (location === 'F62' || location === 'F62TRA') &&
            statusNorm === 'PASS' &&
            (!qcCheckedBy || qcCheckedBy.trim() === '');

          if (isAutoPass) return null;

          if (statusNorm !== status) return null;

          return {
            id: doc?.id,
            materialCode: data.materialCode || '',
            poNumber: data.poNumber || '',
            batchNumber: data.batchNumber || '',
            location: data.location || '',
            iqcStatus: statusNorm,
            qcCheckedBy,
            eventTime
          };
        })
        .filter((x: any) => x !== null)
        .sort((a: any, b: any) => (b.eventTime?.getTime?.() || 0) - (a.eventTime?.getTime?.() || 0));

      this.iqcHistoryResults = results;
      this.isSearchingIqcHistory = false;
      this.iqcHistoryError = results.length === 0 ? `Không có dữ liệu ${status} trong tháng hiện tại` : '';

      if (this.isSampleTakeEnabledForCurrentList()) {
        void this.refreshSampleTakenMarkersForPendingQc(this.iqcHistoryResults);
      }
    } catch (error) {
      console.error(`❌ Error loading monthly ${status} list:`, error);
      this.isSearchingIqcHistory = false;
      this.iqcHistoryError = `Lỗi khi tải danh sách ${status} theo tháng`;
      this.iqcHistoryResults = [];
    }
  }
  
  // Show today checked materials modal - chỉ hiển thị materials được user kiểm (có qcCheckedBy)
  async showTodayCheckedMaterials(showPopup: boolean = true): Promise<void> {
    if (showPopup) {
      this.showTodayCheckedModal = true;
      this.isLoadingReport = true;
    } else {
      // Inline display (no popup)
      this.showTodayCheckedModal = false;
      this.showPendingQCModal = false;
      this.showPendingConfirmModal = false;

      this.iqcResultsTitle = 'Đã kiểm hôm nay';
      this.showIqcSearchResults = true;
      this.isSearchingIqcHistory = true;
      this.iqcHistoryError = '';
      this.iqcHistoryResults = [];
      this.iqcHistoryContext = 'todayChecked';
    }
    
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      // Chỉ dùng factory filter, filter date range trong memory để tránh cần index
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
      ).get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        this.todayCheckedMaterials = [];
        if (showPopup) {
          this.isLoadingReport = false;
        } else {
          this.isSearchingIqcHistory = false;
          this.iqcHistoryError = '';
        }
        return;
      }
      
      // Filter by date range, user-checked materials (not auto-pass) in memory
      this.todayCheckedMaterials = snapshot.docs
        .map(doc => {
          const data = doc.data() as any;
          const qcCheckedAt = data.qcCheckedAt?.toDate ? data.qcCheckedAt.toDate() : null;
          const iqcStatus = data.iqcStatus;
          const qcCheckedBy = data.qcCheckedBy || '';
          const location = (data.location || '').toUpperCase();
          
          // Filter by date range in memory
          if (!qcCheckedAt || qcCheckedAt < today || qcCheckedAt >= tomorrow) {
            return null;
          }
          
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
              checkedAt: qcCheckedAt,
              location: data.location || ''
            };
          }
          return null;
        })
        .filter(material => material !== null)
        .sort((a, b) => {
          return b!.checkedAt.getTime() - a!.checkedAt.getTime();
        });
      
      console.log(`✅ Loaded ${this.todayCheckedMaterials.length} materials checked today by users`);
      if (showPopup) {
        this.isLoadingReport = false;
      } else {
        this.iqcHistoryResults = (this.todayCheckedMaterials || []).map(m => ({
          materialCode: m.materialCode,
          poNumber: m.poNumber,
          batchNumber: m.batchNumber,
          location: (m as any).location || '',
          iqcStatus: m.iqcStatus,
          qcCheckedBy: m.checkedBy,
          eventTime: m.checkedAt
        }));
        this.isSearchingIqcHistory = false;
        this.iqcHistoryError = '';
      }
    } catch (error) {
      console.error('❌ Error loading today checked materials:', error);
      if (showPopup) {
        this.isLoadingReport = false;
      } else {
        this.isSearchingIqcHistory = false;
        this.iqcHistoryError = 'Lỗi khi tải danh sách đã kiểm hôm nay';
      }
    }
  }
  
  closeTodayCheckedModal(): void {
    this.showTodayCheckedModal = false;
    this.todayCheckedMaterials = [];
  }
  
  // More menu functions (popup modal)
  openMoreMenu(): void {
    this.showMoreMenu = true;
  }
  
  closeMoreMenu(): void {
    this.showMoreMenu = false;
  }

  openHoldNotificationEmailsModal(): void {
    this.showMoreMenu = false;
    this.showHoldNotificationEmailsModal = true;
    void this.loadHoldNotificationEmails();
  }

  closeHoldNotificationEmailsModal(): void {
    this.showHoldNotificationEmailsModal = false;
    this.holdEmailText = '';
  }

  private parseHoldEmailsFromTextarea(): string[] {
    return this.holdEmailText
      .split(/[\n,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  }

  async loadHoldNotificationEmails(): Promise<void> {
    try {
      const snap = await this.firestore.doc(this.HOLD_NOTIFICATION_EMAILS_DOC).get().toPromise();
      const d = (snap && snap.exists ? snap.data() : null) as { emails?: unknown } | null;
      const arr = Array.isArray(d?.emails) ? d.emails : [];
      const list = arr.map((x: unknown) => String(x ?? '').trim()).filter(Boolean);
      this.holdEmailText = list.join('\n');
    } catch (e) {
      console.error('loadHoldNotificationEmails:', e);
      this.holdEmailText = '';
    }
  }

  async saveHoldNotificationEmails(): Promise<void> {
    if (this.holdEmailsSaving) {
      return;
    }
    this.holdEmailsSaving = true;
    try {
      const emails = Array.from(new Set(this.parseHoldEmailsFromTextarea())).sort((a, b) =>
        a.localeCompare(b, 'vi')
      );
      await this.firestore.doc(this.HOLD_NOTIFICATION_EMAILS_DOC).set(
        { emails, updatedAt: new Date() },
        { merge: true }
      );
      this.holdEmailText = emails.join('\n');
      alert('Đã lưu danh sách mail.');
    } catch (e) {
      console.error('saveHoldNotificationEmails:', e);
      alert('Không lưu được danh sách mail.');
    } finally {
      this.holdEmailsSaving = false;
    }
  }

  async triggerPutawayHoldWeeklyEmailManual(): Promise<void> {
    if (this.holdNotifyManualRunning) {
      return;
    }
    this.holdNotifyManualRunning = true;
    try {
      const fn = this.fns.httpsCallable<
        object,
        {
          ok: boolean;
          sent: boolean;
          holdMaterialCount: number;
          holdSkuCount: number;
          recipientCount: number;
        }
      >('sendPutawayHoldWeeklyEmailManualFn');
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
        alert(
          `Đã gửi mail báo cáo Hold.\nMã hàng Hold: ${data.holdMaterialCount}\nSKU Hold: ${data.holdSkuCount}\nNgười nhận: ${data.recipientCount}`
        );
      } else {
        alert(`Đã xử lý. sent=${data.sent}, recipientCount=${data.recipientCount}.`);
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      alert(`Lỗi: ${msg}`);
    } finally {
      this.holdNotifyManualRunning = false;
    }
  }

  async openOutboundQcRuleModal(): Promise<void> {
    this.showMoreMenu = false;
    const factory = this.selectedFactory;
    try {
      const doc = await this.outboundQcRule.loadRule(factory);
      this.outboundQcRuleModalEnabled = doc.enabled === true;
      this.outboundQcRuleModalText = doc.blockedStatusesText || '';
    } catch (e) {
      console.error(e);
      this.outboundQcRuleModalEnabled = false;
      this.outboundQcRuleModalText = '';
    }
    this.showOutboundQcRuleModal = true;
  }

  closeOutboundQcRuleModal(): void {
    this.showOutboundQcRuleModal = false;
  }

  async saveOutboundQcRuleFromModal(): Promise<void> {
    this.outboundQcRuleSaving = true;
    try {
      await this.outboundQcRule.saveRule(this.selectedFactory, {
        enabled: this.outboundQcRuleModalEnabled,
        blockedStatusesText: this.outboundQcRuleModalText
      });
      this.showOutboundQcRuleModal = false;
    } catch (e) {
      console.error(e);
      alert('❌ Không lưu được QC rule.');
    } finally {
      this.outboundQcRuleSaving = false;
    }
  }

  openIqcPermissionModal(): void {
    this.showIqcPermissionModal = true;
    this.showMoreMenu = false;
    this.iqcPermInputEmployeeId = '';
    this.iqcPermToggleValue = true;
    this.iqcPermBusy = false;
    this.iqcPermShowAddRow = false;
    this.loadIqcPermissionList();
    setTimeout(() => {
      const input = document.getElementById('iqc-perm-employee-input');
      if (input) input.focus();
    }, 50);
  }

  closeIqcPermissionModal(): void {
    this.showIqcPermissionModal = false;
    this.iqcPermBusy = false;
    this.iqcPermLoadingList = false;
  }

  private normalizeAspEmployeeId(raw: string): string {
    const s = (raw || '').trim().toUpperCase();
    if (!s) return '';
    if (/^\d{4}$/.test(s)) return `ASP${s}`;
    return s;
  }

  async submitIqcPermissionToggle(): Promise<void> {
    const emp = this.normalizeAspEmployeeId(this.iqcPermInputEmployeeId);
    if (!/^ASP\d{4}$/.test(emp)) {
      alert('❌ Mã nhân viên không đúng. Nhập dạng ASP + 4 số (VD: ASP0106) hoặc chỉ 4 số.');
      return;
    }
    this.iqcPermBusy = true;
    try {
      const now = new Date();
      await this.firestore.collection('qc-iqc-permissions').doc(emp).set(
        {
          employeeId: emp,
          enabled: this.iqcPermToggleValue === true,
          updatedAt: now
        },
        { merge: true }
      );
      if ((this.currentEmployeeId || '').trim().toUpperCase() === emp) {
        this.iqcButtonEnabledForCurrentEmployee = this.iqcPermToggleValue === true;
      }
      alert(`✅ Đã ${this.iqcPermToggleValue ? 'BẬT' : 'TẮT'} quyền IQC cho ${emp}`);
      // Refresh list
      await this.loadIqcPermissionList();
      this.iqcPermShowAddRow = false;
      this.iqcPermInputEmployeeId = '';
    } catch (e) {
      console.error('❌ Failed to set IQC permission:', e);
      alert('❌ Không lưu được quyền IQC. Kiểm tra kết nối hoặc Firestore Rules.');
    } finally {
      this.iqcPermBusy = false;
    }
  }

  openAddIqcPermissionRow(): void {
    this.iqcPermShowAddRow = true;
    this.iqcPermInputEmployeeId = (this.currentEmployeeId || '').trim().toUpperCase();
    this.iqcPermToggleValue = true;
    setTimeout(() => {
      const input = document.getElementById('iqc-perm-employee-input');
      if (input) input.focus();
    }, 50);
  }

  private parseFirestoreDateToDate(value: any): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (value?.toDate) return value.toDate();
    if (value?.seconds) return new Date(value.seconds * 1000);
    if (typeof value === 'number') return new Date(value);
    if (typeof value === 'string') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  async loadIqcPermissionList(): Promise<void> {
    this.iqcPermLoadingList = true;
    try {
      const snap = await this.firestore.collection('qc-iqc-permissions', ref => ref.limit(500)).get().toPromise();
      const list =
        (snap?.docs || [])
          .map(doc => {
            const d = doc.data() as any;
            const employeeId = (d?.employeeId || doc.id || '').toString().trim().toUpperCase();
            const enabled = d?.enabled === true;
            const updatedAt = this.parseFirestoreDateToDate(d?.updatedAt);
            if (!employeeId) return null;
            return { employeeId, enabled, updatedAt };
          })
          .filter((x: any) => x !== null) as Array<{ employeeId: string; enabled: boolean; updatedAt?: Date | null }>;

      list.sort((a, b) => {
        const at = a.updatedAt?.getTime?.() ?? 0;
        const bt = b.updatedAt?.getTime?.() ?? 0;
        if (bt !== at) return bt - at;
        return (a.employeeId || '').localeCompare(b.employeeId || '');
      });
      this.iqcPermissions = list;
    } catch (e) {
      console.warn('⚠️ Failed to load IQC permission list:', e);
      this.iqcPermissions = [];
    } finally {
      this.iqcPermLoadingList = false;
    }
  }

  async toggleIqcPermissionFromList(row: { employeeId: string; enabled: boolean }): Promise<void> {
    const emp = this.normalizeAspEmployeeId(row.employeeId);
    if (!/^ASP\d{4}$/.test(emp)) return;
    const next = !row.enabled;
    row.enabled = next; // optimistic
    try {
      const now = new Date();
      await this.firestore.collection('qc-iqc-permissions').doc(emp).set(
        { employeeId: emp, enabled: next, updatedAt: now },
        { merge: true }
      );
      if ((this.currentEmployeeId || '').trim().toUpperCase() === emp) {
        this.iqcButtonEnabledForCurrentEmployee = next;
      }
    } catch (e) {
      row.enabled = !next; // revert
      console.warn('❌ Failed to toggle IQC permission:', e);
      alert('❌ Không cập nhật được quyền IQC. Vui lòng thử lại.');
    }
  }

  /** More → Gửi Report: gửi report từ đầu tháng hiện tại tới thời điểm bấm (ASM1). */
  async sendQcReportNow(): Promise<void> {
    if (this.isSendingReport) {
      return;
    }
    try {
      this.isSendingReport = true;
      this.sendReportStatusText = 'Đang gửi report...';
      this.showSendReportStatusModal = true;
      const callable = this.fns.httpsCallable('sendQcMonthlyReportManualFn');
      await firstValueFrom(callable({ factory: this.selectedFactory, mode: 'currentMonthToDate' }));
      this.sendReportStatusText = '✅ Đã gửi report.';
      setTimeout(() => {
        // Auto-close after success
        if (this.showSendReportStatusModal) {
          this.showSendReportStatusModal = false;
        }
      }, 1500);
    } catch (e) {
      console.warn('❌ sendQcReportNow failed:', e);
      this.sendReportStatusText = '❌ Gửi report thất bại. Vui lòng thử lại.';
    } finally {
      this.isSendingReport = false;
      this.closeMoreMenu();
    }
  }

  closeSendReportStatusModal(): void {
    this.showSendReportStatusModal = false;
  }

  openIqcDateRangeModal(): void {
    this.showIqcDateRangeModal = true;
  }

  closeIqcDateRangeModal(): void {
    this.showIqcDateRangeModal = false;
  }

  clearIqcSearch(): void {
    this.iqcSearchCode = '';
    this.iqcHistoryResults = [];
    this.iqcHistoryError = '';
    this.showIqcSearchResults = false;
  }

  /** Chuỗi vị trí sau trim + chữ hoa (so khớp prefix khu IQC / pallet). */
  private normalizeLocationUpper(location: any): string {
    return (location ?? '').toString().trim().toUpperCase();
  }

  /**
   * Khu IQC: vị trí bắt đầu bằng IQC (ví dụ IQC, IQC-P01, IQC PLT01 — có thêm pallet sau IQC).
   */
  private isLocationAtIqcArea(location: any): boolean {
    const loc = this.normalizeLocationUpper(location);
    return loc.length > 0 && loc.startsWith('IQC');
  }

  /** Cùng rule với box "Mã hàng chờ kiểm": CHỜ KIỂM tại khu IQC (prefix IQC) */
  private isPendingQcAtIqc(data: any): boolean {
    const status = (data?.iqcStatus ?? '').toString().trim();
    return status === 'CHỜ KIỂM' && this.isLocationAtIqcArea(data?.location);
  }

  private parseFirestoreDate(value: any): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (value?.toDate) return value.toDate();
    if (value?.seconds) return new Date(value.seconds * 1000);
    if (typeof value === 'number') return new Date(value);
    if (typeof value === 'string') {
      const parsed = new Date(value);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  private getIqcEventTime(data: any): Date | null {
    // Prefer explicit QC check time, then updatedAt, then import/receive date
    return (
      this.parseFirestoreDate(data?.qcCheckedAt) ||
      this.parseFirestoreDate(data?.updatedAt) ||
      this.parseFirestoreDate(data?.importDate) ||
      this.parseFirestoreDate(data?.receivedDate) ||
      null
    );
  }

  private getIqcHistoryGroupKey(item: {
    materialCode?: string;
    poNumber?: string;
    batchNumber?: string;
    importDate?: any;
  }): string {
    return this.getInventoryLotKey(item);
  }

  /** Đếm nhóm chờ kiểm (mã + PO + 8 ký tự lô) — khớp số dòng hiển thị. */
  private countPendingQcLotGroups(
    docs: Array<{ data?: () => any } | any>,
    dateRange?: { from?: Date | null; to?: Date | null }
  ): number {
    const keys = new Set<string>();
    for (const doc of docs) {
      const data = typeof (doc as any)?.data === 'function' ? (doc as any).data() : doc;
      if (!this.isPendingQcAtIqc(data)) continue;
      if (dateRange?.from || dateRange?.to) {
        const dt = this.parseFirestoreDate(data.importDate) || this.parseFirestoreDate(data.createdAt);
        if (dt) {
          if (dateRange.from && dt < dateRange.from) continue;
          if (dateRange.to && dt > dateRange.to) continue;
        }
      }
      const key = this.getInventoryLotKey(data);
      if (!key.split('|')[0]) continue;
      keys.add(key);
    }
    return keys.size;
  }

  private pickRepresentativeLotRow<T extends {
    id?: string;
    batchNumber?: string;
    importDate?: any;
    receivedDate?: any;
    quantity?: number;
  }>(group: T[], priorityIds?: Set<string>): T {
    let pool = [...group];
    if (priorityIds?.size) {
      const prioRows = pool.filter(x => x.id && priorityIds.has(x.id));
      if (prioRows.length) pool = prioRows;
    }
    pool.sort((a, b) => {
      const lenA = String(a.batchNumber || '').trim().length;
      const lenB = String(b.batchNumber || '').trim().length;
      if (lenA !== lenB) return lenA - lenB;
      const dateA = this.parseFirestoreDate(a.importDate) || this.parseFirestoreDate(a.receivedDate) || new Date(0);
      const dateB = this.parseFirestoreDate(b.importDate) || this.parseFirestoreDate(b.receivedDate) || new Date(0);
      return dateB.getTime() - dateA.getTime();
    });
    const rep = { ...pool[0] };
    rep.batchNumber = this.getDisplayLotBatch(rep.batchNumber);
    if (group.length > 1) {
      const totalQty = group.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
      if (totalQty > 0) {
        rep.quantity = totalQty;
      }
    }
    return rep;
  }

  /** Gộp hiển thị: 1 dòng / mã + PO + lô 8 ký tự (ưu tiên lô gốc 8 ký tự). */
  private deduplicateIqcLotDisplayRows<T extends {
    id?: string;
    materialCode?: string;
    poNumber?: string;
    batchNumber?: string;
    importDate?: any;
    receivedDate?: any;
    quantity?: number;
  }>(items: T[], priorityIds?: Set<string>): T[] {
    if (!items?.length) return items;
    const groups = new Map<string, T[]>();
    for (const item of items) {
      const key = this.getInventoryLotKey(item);
      const list = groups.get(key) || [];
      list.push(item);
      groups.set(key, list);
    }
    const result: T[] = [];
    groups.forEach(group => result.push(this.pickRepresentativeLotRow(group, priorityIds)));
    return result;
  }

  private applyLotGroupDisplayRules<T extends {
    materialCode?: string;
    poNumber?: string;
    batchNumber?: string;
    iqcStatus?: string;
    qcCheckedBy?: string;
    qcCheckedAt?: Date | null;
    eventTime?: Date | null;
    id?: string;
    importDate?: any;
    receivedDate?: any;
    quantity?: number;
  }>(items: T[], priorityIds?: Set<string>): T[] {
    return this.deduplicateIqcLotDisplayRows(this.propagateIqcPassAcrossSameLot(items), priorityIds);
  }

  private isQcPassStatus(status: string | undefined | null): boolean {
    return String(status || '').trim().toUpperCase() === 'PASS';
  }

  /** Lô đã PASS ở ít nhất một dòng inventory (mã + PO + IMD). */
  private buildPassedLotMap(
    docs: firebase.firestore.QueryDocumentSnapshot[]
  ): Map<string, { iqcStatus: string; qcCheckedBy: string; qcCheckedAt: Date }> {
    const map = new Map<string, { iqcStatus: string; qcCheckedBy: string; qcCheckedAt: Date }>();
    for (const doc of docs) {
      const data = doc.data() as any;
      if (!this.isQcPassStatus(data?.iqcStatus)) continue;
      const key = this.getInventoryLotKey(data);
      const parts = key.split('|');
      if (!parts[0] || !parts[2]) continue;

      const qcCheckedAt =
        this.parseFirestoreDate(data?.qcCheckedAt) ||
        this.parseFirestoreDate(data?.updatedAt) ||
        new Date();
      const time = qcCheckedAt.getTime();
      const existing = map.get(key);
      if (!existing || time >= existing.qcCheckedAt.getTime()) {
        map.set(key, {
          iqcStatus: 'PASS',
          qcCheckedBy: String(data?.qcCheckedBy || '').trim() || 'INVENTORY-SYNC',
          qcCheckedAt
        });
      }
    }
    return map;
  }

  /**
   * CHỜ KIỂM@IQC nhưng cùng mã+PO+IMD đã PASS ở dòng khác → tự PASS (đồng bộ Firestore).
   */
  private async syncAutoPassPendingDuplicates(
    docs: firebase.firestore.QueryDocumentSnapshot[]
  ): Promise<number> {
    const passByLot = this.buildPassedLotMap(docs);
    if (passByLot.size === 0) return 0;

    const batch = firebase.firestore().batch();
    const now = new Date();
    let count = 0;

    for (const doc of docs) {
      const data = doc.data() as any;
      if (!this.isPendingQcAtIqc(data)) continue;
      const pass = passByLot.get(this.getInventoryLotKey(data));
      if (!pass) continue;

      const docRef = this.firestore.collection('inventory-materials').doc(doc.id).ref;
      batch.update(docRef, {
        iqcStatus: pass.iqcStatus,
        qcCheckedBy: pass.qcCheckedBy,
        qcCheckedAt: pass.qcCheckedAt,
        updatedAt: now
      });
      count++;
    }

    if (count > 0) {
      await batch.commit();
      console.log(`✅ Auto-pass ${count} dòng chờ kiểm trùng lô đã PASS ở inventory`);
    }
    return count;
  }

  /** Sau khi PASS một dòng, áp dụng PASS cho các dòng CHỜ KIỂM@IQC cùng mã+PO+IMD. */
  private async propagatePassToSiblingLots(
    source: { id?: string; materialCode?: string; poNumber?: string; batchNumber?: string; importDate?: any },
    passMeta: { qcCheckedBy: string; qcCheckedAt: Date }
  ): Promise<void> {
    const lotKey = this.getInventoryLotKey(source);
    if (!lotKey.split('|')[0]) return;

    const snapshot = await this.firestore
      .collection('inventory-materials', ref => ref.where('factory', '==', this.selectedFactory))
      .get()
      .toPromise();
    if (!snapshot) return;

    const batch = firebase.firestore().batch();
    const now = new Date();
    let count = 0;

    for (const doc of snapshot.docs) {
      if (doc.id === source.id) continue;
      const data = doc.data() as any;
      const status = String(data?.iqcStatus || '').trim();
      if (status !== 'CHỜ KIỂM') continue;
      if (this.getInventoryLotKey(data) !== lotKey) continue;

      const docRef = this.firestore.collection('inventory-materials').doc(doc.id).ref;
      batch.update(docRef, {
        iqcStatus: 'PASS',
        qcCheckedBy: passMeta.qcCheckedBy,
        qcCheckedAt: passMeta.qcCheckedAt,
        updatedAt: now
      });
      count++;
    }

    if (count > 0) {
      await batch.commit();
      console.log(`✅ Propagated PASS to ${count} sibling lot row(s) for ${lotKey}`);
    }
  }

  /** Cùng mã + PO + lô: nếu đã PASS thì hiển thị PASS cho tất cả dòng. */
  private propagateIqcPassAcrossSameLot<T extends {
    materialCode?: string;
    poNumber?: string;
    batchNumber?: string;
    iqcStatus?: string;
    qcCheckedBy?: string;
    qcCheckedAt?: Date | null;
    eventTime?: Date | null;
  }>(results: T[]): T[] {
    if (!results?.length) return results;

    const passByGroup = new Map<
      string,
      { iqcStatus: string; qcCheckedBy?: string; qcCheckedAt?: Date | null; eventTime?: Date | null }
    >();

    for (const item of results) {
      if (!this.isQcPassStatus(item.iqcStatus)) continue;
      const key = this.getIqcHistoryGroupKey(item);
      const time =
        item.eventTime?.getTime?.() ||
        item.qcCheckedAt?.getTime?.() ||
        0;
      const existing = passByGroup.get(key);
      const existingTime =
        existing?.eventTime?.getTime?.() ||
        existing?.qcCheckedAt?.getTime?.() ||
        0;
      if (!existing || time >= existingTime) {
        passByGroup.set(key, {
          iqcStatus: String(item.iqcStatus || 'PASS').trim(),
          qcCheckedBy: item.qcCheckedBy,
          qcCheckedAt: item.qcCheckedAt,
          eventTime: item.eventTime,
        });
      }
    }

    if (passByGroup.size === 0) return results;

    return results.map(item => {
      const pass = passByGroup.get(this.getIqcHistoryGroupKey(item));
      if (!pass) return item;
      return {
        ...item,
        iqcStatus: pass.iqcStatus,
        qcCheckedBy: pass.qcCheckedBy || item.qcCheckedBy,
        qcCheckedAt: pass.qcCheckedAt || item.qcCheckedAt,
      };
    });
  }

  async searchIqcHistory(): Promise<void> {
    const code = (this.iqcSearchCode || '').trim();
    if (!code) {
      this.iqcHistoryError = 'Vui lòng nhập mã nguyên liệu để tìm kiếm';
      this.showIqcSearchResults = true;
      return;
    }

    this.isSearchingIqcHistory = true;
    this.iqcHistoryError = '';
    this.showIqcSearchResults = true;
    this.iqcHistoryResults = [];
    this.iqcResultsTitle = 'Lịch sử tình trạng theo mã nguyên liệu';
    this.iqcHistoryContext = 'search';

    const fromDate = this.iqcSearchFromDate ? new Date(this.iqcSearchFromDate) : null;
    const toDate = this.iqcSearchToDate ? new Date(this.iqcSearchToDate) : null;
    if (fromDate) fromDate.setHours(0, 0, 0, 0);
    if (toDate) toDate.setHours(0, 0, 0, 0);
    const toExclusive = toDate ? new Date(toDate.getTime() + 24 * 60 * 60 * 1000) : null;

    try {
      // Try efficient query first
      let snapshot: any = null;
      try {
        snapshot = await this.firestore.collection('inventory-materials', ref =>
          ref.where('factory', '==', this.selectedFactory)
             .where('materialCode', '==', code)
             .limit(200)
        ).get().toPromise();
      } catch (e) {
        // Fallback: query by factory only, filter in memory (avoid index issues)
        snapshot = await this.firestore.collection('inventory-materials', ref =>
          ref.where('factory', '==', this.selectedFactory)
             .limit(2000)
        ).get().toPromise();
      }

      if (!snapshot || snapshot.empty) {
        this.iqcHistoryError = `Không tìm thấy dữ liệu cho mã nguyên liệu: ${code}`;
        this.isSearchingIqcHistory = false;
        return;
      }

      const results = snapshot.docs
        .map(doc => {
          const data = doc.data() as any;
          if ((data?.materialCode || '') !== code) return null;

          const qcCheckedAt = this.parseFirestoreDate(data?.qcCheckedAt);
          const updatedAt = this.parseFirestoreDate(data?.updatedAt);
          const eventTime = this.getIqcEventTime(data);

          return {
            id: doc.id,
            materialCode: data?.materialCode || '',
            materialName: data?.materialName || '',
            poNumber: data?.poNumber || '',
            batchNumber: data?.batchNumber || '',
            iqcStatus: data?.iqcStatus || '',
            location: data?.location || '',
            qcCheckedBy: (data?.qcCheckedBy || '').toString(),
            qcCheckedAt,
            updatedAt,
            eventTime
          };
        })
        .filter(item => item !== null)
        .filter((item: any) => {
          if (!item.eventTime) return false;
          if (fromDate && item.eventTime < fromDate) return false;
          if (toExclusive && item.eventTime >= toExclusive) return false;
          return true;
        })
        .sort((a: any, b: any) => {
          const ta = a.eventTime ? a.eventTime.getTime() : 0;
          const tb = b.eventTime ? b.eventTime.getTime() : 0;
          return tb - ta;
        });

      this.iqcHistoryResults = this.applyLotGroupDisplayRules(results as any[]);

      if (this.iqcHistoryResults.length === 0) {
        const rangeText = (fromDate || toDate)
          ? ` trong khoảng ${this.iqcSearchFromDate || '...'} đến ${this.iqcSearchToDate || '...'}`
          : '';
        this.iqcHistoryError = `Không có lịch sử tình trạng cho mã ${code}${rangeText}`;
      }
    } catch (error: any) {
      console.error('❌ Error searching IQC history:', error);
      this.iqcHistoryError = `Lỗi khi tìm kiếm: ${error?.message || error}`;
    } finally {
      this.isSearchingIqcHistory = false;
    }
  }
  
  // When user clicks a row in inline list of "Chờ xác nhận", open IQC popup to update that material
  openIQCFromHistory(item: any): void {
    if (this.iqcHistoryContext !== 'pendingConfirm') return;
    if (!item?.id) return;

    const found = this.pendingConfirmMaterials.find(m => m.id === item.id);
    if (!found) {
      alert('Không tìm thấy mã để cập nhật trạng thái.');
      return;
    }

    // Open IQC modal, then bind scannedMaterial and status
    this.openIQCModal();
    this.scannedMaterial = found as any;
    this.selectedIQCStatus = found.iqcStatus || 'CHỜ XÁC NHẬN';

    // Start with empty extra fields (user will fill if needed)
    this.ngErrorText = '';
    this.lockReasonText = '';
    this.pendingNoteText = '';
  }

  toggleIqcPriority(item: any): void {
    if (this.iqcHistoryContext !== 'pendingConfirm') return;
    if (!item?.id) return;

    const id = item.id as string;
    const prevId = this.priorityMaterialId;

    if (prevId === id) {
      // Optimistic update UI
      this.priorityMaterialId = null;
      this.reorderIqcHistoryResults();

      // Persist to backend
      const now = new Date();
      this.firestore.collection('inventory-materials').doc(id).update({
        qcPriorityPendingConfirm: false,
        qcPriorityUpdatedAt: now
      }).catch(() => {
        // Revert on failure
        this.priorityMaterialId = id;
        this.reorderIqcHistoryResults();
      });
      return;
    }

    // Optimistic update UI
    this.priorityMaterialId = id;
    this.reorderIqcHistoryResults();

    // Persist to backend (ensure only one item is prioritized)
    const now = new Date();
    const updates: Promise<void>[] = [];
    if (prevId) {
      updates.push(
        this.firestore.collection('inventory-materials').doc(prevId).update({
          qcPriorityPendingConfirm: false,
          qcPriorityUpdatedAt: now
        })
      );
    }
    updates.push(
      this.firestore.collection('inventory-materials').doc(id).update({
        qcPriorityPendingConfirm: true,
        qcPriorityUpdatedAt: now
      })
    );

    Promise.all(updates).catch(() => {
      // Revert on failure
      this.priorityMaterialId = prevId;
      this.reorderIqcHistoryResults();
    });
  }

  togglePendingQcPriority(item: any): void {
    if (this.iqcHistoryContext !== 'pendingQC') return;
    if (!item?.id) return;

    const id = item.id as string;
    const set = new Set(this.priorityPendingQcIds || []);
    const wasPriority = set.has(id);

    if (wasPriority) set.delete(id);
    else set.add(id);

    // Optimistic update UI
    this.priorityPendingQcIds = Array.from(set);
    this.reorderIqcHistoryResults();

    const now = new Date();
    this.firestore.collection('inventory-materials').doc(id).update({
      qcPriorityPendingQC: !wasPriority,
      qcPriorityAutoPendingQC: false,
      qcPriorityUpdatedAt: now
    }).catch(() => {
      // Revert on failure
      if (wasPriority) {
        // Make it prioritized again
        if (!this.priorityPendingQcIds.includes(id)) {
          this.priorityPendingQcIds = Array.from(new Set([...(this.priorityPendingQcIds || []), id]));
        }
      } else {
        // Remove priority again
        this.priorityPendingQcIds = (this.priorityPendingQcIds || []).filter(x => x !== id);
      }
      this.reorderIqcHistoryResults();
    });
  }

  private reorderIqcHistoryResults(): void {
    if (!this.iqcHistoryResults) return;

    const pid = this.priorityMaterialId;
    const list = [...this.iqcHistoryResults];

    // Pending QC: ưu tiên trước, còn lại gom mã trùng nhau sát nhau
    if (this.iqcHistoryContext === 'pendingQC') {
      this.iqcHistoryResults = this.sortPendingQcListByPriorityAndMaterialCode(list);
      return;
    }

    if (!pid) {
      // default sort by eventTime desc (matches current "history" behavior)
      this.iqcHistoryResults = list.sort((a: any, b: any) => {
        const ta = a?.eventTime ? a.eventTime.getTime?.() ?? 0 : 0;
        const tb = b?.eventTime ? b.eventTime.getTime?.() ?? 0 : 0;
        return tb - ta;
      });
      return;
    }

    this.iqcHistoryResults = list.sort((a: any, b: any) => {
      const aTop = a?.id === pid ? 1 : 0;
      const bTop = b?.id === pid ? 1 : 0;
      return bTop - aTop;
    });
  }

  toggleRecentChecked(): void {
    this.showRecentChecked = !this.showRecentChecked;
    // Load data when showing for the first time
    if (this.showRecentChecked && this.recentCheckedMaterials.length === 0) {
      this.loadRecentCheckedMaterials();
    }
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
      // Chỉ dùng factory filter, filter date range trong memory để tránh cần index
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
      ).get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        alert('Không có dữ liệu kiểm trong tháng này');
        this.isLoadingReport = false;
        return;
      }
      
      // Filter by date range, user-checked materials (not auto-pass) and sort in memory
      const reportData = snapshot.docs
        .map(doc => {
          const data = doc.data() as any;
          const qcCheckedAt = data.qcCheckedAt?.toDate ? data.qcCheckedAt.toDate() : null;
          const iqcStatus = data.iqcStatus;
          const qcCheckedBy = data.qcCheckedBy || '';
          const location = (data.location || '').toUpperCase();
          
          // Filter by date range in memory
          if (!qcCheckedAt || qcCheckedAt < startDate || qcCheckedAt >= endDate) {
            return null;
          }
          
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
        .filter(item => item !== null)
        .sort((a, b) => {
          // Sort by checked time (newest first) in memory
          return b!.checkedAt.getTime() - a!.checkedAt.getTime();
        });
      
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
        ref.where('factory', '==', this.selectedFactory)
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
  private buildInboundSupplierMap(snapshot: firebase.firestore.QuerySnapshot): Map<string, string> {
    const map = new Map<string, string>();
    snapshot.docs.forEach(doc => {
      const d = doc.data() as any;
      const sup = String(d.supplier || '').trim();
      if (!sup) return;
      const code = String(d.materialCode || '').trim();
      const po = String(d.poNumber || '').trim();
      const lot = String(d.batchNumber || '').trim();
      if (!code || !po) return;
      map.set(`${code}|${po}`, sup);
      if (lot) map.set(`${code}|${po}|${lot}`, sup);
    });
    return map;
  }

  private resolveSupplierForPendingQc(material: any, inboundMap: Map<string, string>): string {
    const fromInventory = String(material?.supplier || '').trim();
    if (fromInventory) return fromInventory;
    const code = String(material?.materialCode || '').trim();
    const po = String(material?.poNumber || '').trim();
    const lot = String(material?.batchNumber || '').trim();
    return inboundMap.get(`${code}|${po}|${lot}`) || inboundMap.get(`${code}|${po}`) || '';
  }

  formatPendingQcQuantity(item: { quantity?: number; unit?: string }): string {
    const qty = Number(item?.quantity);
    if (!Number.isFinite(qty)) return '—';
    const unit = String(item?.unit || '').trim();
    const formatted = qty.toLocaleString('vi-VN');
    return unit ? `${formatted} ${unit}` : formatted;
  }

  async showPendingQCMaterials(showPopup: boolean = true): Promise<void> {
    if (showPopup) {
      this.showPendingQCModal = true;
      this.isLoadingReport = true;
    } else {
      // Inline display (no popup)
      this.showPendingQCModal = false;
      this.showTodayCheckedModal = false;
      this.showPendingConfirmModal = false;

      this.iqcResultsTitle = 'Mã hàng chờ kiểm';
      this.showIqcSearchResults = true;
      this.isSearchingIqcHistory = true;
      this.iqcHistoryError = '';
      this.iqcHistoryResults = [];
      this.iqcHistoryContext = 'pendingQC';
    }
    
    try {
      console.log('📊 Loading pending QC materials...');

      await this.syncAutoPriorityFromPxk();
      
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
      ).get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        this.pendingQCMaterials = [];
        this.pendingQCCount = 0;
        this.pendingQcDuplicateMaterialCodes = new Set();
        if (showPopup) {
          this.isLoadingReport = false;
        } else {
          this.iqcHistoryResults = [];
          this.isSearchingIqcHistory = false;
          this.iqcHistoryError = '';
        }
        return;
      }

      const syncedCount = await this.syncAutoPassPendingDuplicates(snapshot.docs);
      let docs = snapshot.docs;
      if (syncedCount > 0) {
        const refreshed = await this.firestore
          .collection('inventory-materials', ref => ref.where('factory', '==', this.selectedFactory))
          .get()
          .toPromise();
        if (refreshed) docs = refreshed.docs;
      }
      
      const pendingQcPrioritySet = new Set<string>();
      this.pendingQCMaterials = docs
        .map(doc => {
          const data = doc.data() as any;
          const iqcStatus = data.iqcStatus;
          const location = data.location || '';
          
          // Cùng rule đếm: CHỜ KIỂM tại khu IQC (vị trí bắt đầu bằng IQC, có thể kèm pallet)
          if (this.isPendingQcAtIqc(data)) {
            // Read backend priority flag
            if (!!data.qcPriorityPendingQC) {
              pendingQcPrioritySet.add(doc.id);
            }
            return {
              id: doc.id,
              materialCode: data.materialCode || '',
              materialName: data.materialName || '',
              poNumber: data.poNumber || '',
              batchNumber: data.batchNumber || '',
              quantity: data.quantity || 0,
              unit: data.unit || '',
              supplier: data.supplier || '',
              type: data.type || '',
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
      
      let inboundSupplierMap = new Map<string, string>();
      try {
        const inboundSnap = await this.firestore
          .collection('inbound-materials', ref => ref.where('factory', '==', this.selectedFactory))
          .get()
          .toPromise();
        if (inboundSnap) {
          inboundSupplierMap = this.buildInboundSupplierMap(inboundSnap);
        }
      } catch (e) {
        console.warn('⚠️ Không tải được NCC từ inbound:', e);
      }

      this.pendingQCMaterials = (this.pendingQCMaterials || []).map(m => ({
        ...m,
        supplier: this.resolveSupplierForPendingQc(m, inboundSupplierMap),
      }));

      // Sync priority ids with backend (used by cột "Ưu tiên" và stats)
      this.priorityPendingQcIds = Array.from(pendingQcPrioritySet);
      this.pendingQCMaterials = this.deduplicateIqcLotDisplayRows(
        this.pendingQCMaterials || [],
        pendingQcPrioritySet
      );
      this.pendingQCMaterials = this.sortPendingQcListByPriorityAndMaterialCode(this.pendingQCMaterials);
      this.pendingQCCount = this.pendingQCMaterials.length;
      this.rebuildPendingQcDuplicateMaterialCodes(this.pendingQCMaterials);

      console.log(`✅ Loaded ${this.pendingQCMaterials.length} pending QC lot group(s)`);
      if (showPopup) {
        this.isLoadingReport = false;
      } else {
        this.iqcHistoryResults = this.applyLotGroupDisplayRules(
          (this.pendingQCMaterials || []).map(m => ({
            id: m.id,
            materialCode: m.materialCode,
            poNumber: m.poNumber,
            batchNumber: m.batchNumber,
            supplier: m.supplier || '',
            quantity: m.quantity || 0,
            unit: m.unit || '',
            type: m.type || '',
            location: m.location || '',
            iqcStatus: m.iqcStatus,
            qcCheckedBy: '—',
            eventTime: m.importDate || m.receivedDate || null,
            importDate: m.importDate,
            receivedDate: m.receivedDate
          })),
          pendingQcPrioritySet
        );
        this.isSearchingIqcHistory = false;
        this.iqcHistoryError = '';

        // Load sample-taken markers for this list (tháng hiện tại + tháng trước)
        void this.refreshSampleTakenMarkersForPendingQc(this.iqcHistoryResults);

        // Drop priorities that are no longer in current pending QC list
        const idsInList = new Set((this.pendingQCMaterials || []).map((x: any) => x?.id).filter((x: any) => !!x));
        this.priorityPendingQcIds = (this.priorityPendingQcIds || []).filter(id => idsInList.has(id));
        this.reorderIqcHistoryResults();
      }
    } catch (error) {
      console.error('❌ Error loading pending QC materials:', error);
      alert('❌ Lỗi khi tải danh sách mã hàng chờ kiểm');
      if (showPopup) {
        this.isLoadingReport = false;
      } else {
        this.isSearchingIqcHistory = false;
        this.iqcHistoryError = 'Lỗi khi tải mã hàng chờ kiểm';
      }
    }
  }

  private async refreshSampleTakenMarkersForPendingQc(items: any[]): Promise<void> {
    try {
      this.sampleTakenKeySet = new Set<string>();
      const factory = this.selectedFactory;

      const keysSnap = await this.firestore
        .collection(this.QC_SAMPLE_TAKEN_KEYS, (ref) =>
          ref.where('factory', '==', factory).limit(5000)
        )
        .get()
        .toPromise()
        .catch(() => null);

      (keysSnap?.docs || []).forEach((d) => {
        const data = d.data() as any;
        const key = this.buildSampleKey(
          data?.factory || factory,
          data?.materialCode,
          data?.poNumber,
          data?.imd
        );
        if (key) this.sampleTakenKeySet.add(key);
      });

      const now = new Date();
      const currentKey = now.getFullYear() * 100 + (now.getMonth() + 1);
      const prevKey = this.monthKeyToPrevMonthKey(currentKey);

      // Bản ghi cũ (trước khi có qc-sample-taken-keys): tháng hiện tại + tháng trước
      const [snap1, snap2] = await Promise.all([
        this.firestore
          .collection(this.QC_SAMPLE_COLLECTION, (ref) =>
            ref.where('factory', '==', factory).where('monthKey', '==', currentKey).limit(2000)
          )
          .get()
          .toPromise()
          .catch(() => null),
        this.firestore
          .collection(this.QC_SAMPLE_COLLECTION, (ref) =>
            ref.where('factory', '==', factory).where('monthKey', '==', prevKey).limit(2000)
          )
          .get()
          .toPromise()
          .catch(() => null)
      ]);

      const docs = [...(snap1?.docs || []), ...(snap2?.docs || [])];
      docs.forEach((d) => {
        const data = d.data() as any;
        if (data?.muonTest) return;
        const key = this.buildSampleKey(factory, data?.materialCode, data?.poNumber, data?.imd);
        if (key) this.sampleTakenKeySet.add(key);
      });
    } catch (e) {
      console.warn('refreshSampleTakenMarkersForPendingQc failed', e);
      this.sampleTakenKeySet = new Set<string>();
    }
  }

  printPendingQcList(): void {
    if (this.iqcHistoryContext !== 'pendingQC') {
      return;
    }

    const items = this.iqcHistoryResults || [];
    if (!items.length) {
      alert('Không có dữ liệu để in');
      return;
    }

    const esc = (value: unknown) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const prioritySet = new Set(this.priorityPendingQcIds || []);
    const formatQty = (item: typeof items[number]) => {
      const qty = Number(item.quantity);
      if (!Number.isFinite(qty)) return '—';
      const unit = String(item.unit || '').trim();
      const formatted = qty.toLocaleString('vi-VN');
      return unit ? `${formatted} ${unit}` : formatted;
    };
    const tableRows = items
      .map((item, index) => {
        const isPriority = !!(item.id && prioritySet.has(item.id));
        return `<tr>
          <td>${index + 1}</td>
          <td>${esc(item.materialCode)}</td>
          <td>${esc(item.poNumber)}</td>
          <td>${esc(this.getDisplayLotBatch(item.batchNumber))}</td>
          <td>${esc(item.supplier || '—')}</td>
          <td>${esc(formatQty(item))}</td>
          <td>${esc(item.location || '—')}</td>
          <td>${esc(item.type || '—')}</td>
          <td>${esc(item.iqcStatus || '—')}</td>
          <td>${isPriority ? 'Có' : '—'}</td>
        </tr>`;
      })
      .join('');

    const printedAt = new Date().toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour12: false,
    });

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Trình duyệt chặn cửa sổ in. Cho phép popup và thử lại.');
      return;
    }

    printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Danh sách NVL chờ kiểm tra</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, sans-serif;
      font-size: 11px;
      color: #000;
      background: #fff;
    }
    .doc-title {
      text-align: center;
      font-size: 18px;
      font-weight: bold;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .doc-meta {
      text-align: center;
      font-size: 11px;
      margin-bottom: 12px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      border: 1px solid #000;
      padding: 6px 8px;
      text-align: center;
      vertical-align: middle;
      word-wrap: break-word;
    }
    th {
      font-weight: bold;
      background: #fff;
    }
    th:first-child,
    td:first-child { width: 40px; }
    th:last-child,
    td:last-child { width: 70px; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="doc-title">Danh sách NVL chờ kiểm tra</div>
  <div class="doc-meta">Xưởng: ${esc(this.selectedFactory)} &nbsp;|&nbsp; Tổng: ${items.length} mã &nbsp;|&nbsp; In lúc: ${esc(printedAt)}</div>
  <table>
    <thead>
      <tr>
        <th>STT</th>
        <th>Mã hàng</th>
        <th>Số P.O</th>
        <th>Lô hàng</th>
        <th>NCC</th>
        <th>Số lượng</th>
        <th>Vị trí</th>
        <th>Loại hình</th>
        <th>Trạng thái</th>
        <th>Ưu tiên</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
</body>
</html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 300);
  }

  // ===== Lấy mẫu (chuột phải ở danh sách chờ kiểm / chờ xác nhận / NG) =====
  onSampleTakeRightClick(event: MouseEvent, item: any): void {
    if (!this.isSampleTakeEnabledForCurrentList()) return;
    event.preventDefault();
    event.stopPropagation();

    const materialCode = String(item?.materialCode || '').trim().toUpperCase();
    const poNumber = String(item?.poNumber || '').trim();
    const imd = String(item?.batchNumber || '').trim();
    if (!materialCode || !poNumber || !imd) {
      alert('Thiếu dữ liệu (Mã hàng / PO / Lô hàng) — không mở được popup Lấy Mẫu.');
      return;
    }
    if (this.isSampleTakenRow(item)) {
      alert(`Mã ${materialCode} / PO ${poNumber} / Lô ${imd} đã lấy mẫu tại ${this.selectedFactory} — không nhập lại.`);
      return;
    }

    this.sampleTakeSelected = {
      id: item?.id ? String(item.id) : undefined,
      factory: this.selectedFactory,
      materialCode,
      poNumber,
      imd
    };
    const now = new Date();
    this.sampleTakeYear = now.getFullYear();
    this.sampleTakeMonth = now.getMonth() + 1;
    this.sampleTakeMonthKey = this.sampleTakeYear * 100 + this.sampleTakeMonth;
    this.sampleTakeTotalQty = Number(item?.quantity ?? 0) || 0;
    this.sampleTakeLoaiHinh = String(item?.type || '').trim();
    this.sampleTakeIqcTestRosh = false;
    this.sampleTakeLayMauHangVe = false;
    this.sampleTakeEngLuuMau = false;
    this.sampleTakeMuonTest = false;
    this.sampleTakeLabelCountInput = '1';
    this.sampleTakeMaKho = '00';
    this.sampleTakeNganhNghe = 'NNGHE_A';
    this.sampleTakePcsInput = '';
    this.sampleTakeError = '';
    this.sampleTakeStt = 0;
    this.showSampleTakeModal = true;
  }

  private async allocateNextSampleTakeStt(year: number, month: number): Promise<void> {
    try {
      const mm = String(month).padStart(2, '0');
      const docId = `${year}-${mm}`;
      const ref = this.firestore.firestore.collection('qc-sample-taking-counters').doc(docId);
      const next = await this.firestore.firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists ? Number((snap.data() as any)?.current || 0) : 0;
        const n = (Number.isFinite(current) ? current : 0) + 1;
        tx.set(
          ref,
          { year, month, current: n, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        return n;
      });
      this.sampleTakeStt = next;
    } catch (e) {
      console.warn('allocateNextSampleTakeStt failed', e);
      // Fallback: vẫn cho lưu, nhưng STT = 0 để nhận biết cần kiểm tra
      this.sampleTakeStt = 0;
    }
  }

  closeSampleTakeModal(): void {
    if (this.isSavingSampleTake) return;
    this.showSampleTakeModal = false;
    this.sampleTakeSelected = null;
    this.sampleTakePcsInput = '';
    this.sampleTakeLabelCountInput = '1';
    this.sampleTakeMuonTest = false;
    this.sampleTakeError = '';
    this.sampleTakeYear = 0;
    this.sampleTakeMonth = 0;
    this.sampleTakeStt = 0;
  }

  private parseSampleLabelCount(): number | null {
    const raw = String(this.sampleTakeLabelCountInput || '').trim().replace(/,/g, '');
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n <= 0 || n > 99) return null;
    return n;
  }

  private async ensureSampleTakeStt(): Promise<void> {
    if (this.sampleTakeStt > 0) return;
    await this.allocateNextSampleTakeStt(this.sampleTakeYear, this.sampleTakeMonth);
  }

  private parseSamplePcs(): number | null {
    const raw = String(this.sampleTakePcsInput || '').trim().replace(/,/g, '');
    const pcs = Math.floor(Number(raw));
    if (!Number.isFinite(pcs) || pcs <= 0) return null;
    return pcs;
  }

  private async persistSampleTakeRecord(record: Record<string, any>): Promise<void> {
    const factory = String(record.factory || '').trim().toUpperCase();
    const materialCode = String(record.materialCode || '').trim().toUpperCase();
    const poNumber = String(record.poNumber || '').trim();
    const imd = String(record.imd || '').trim();
    const key = this.buildSampleKey(factory, materialCode, poNumber, imd);
    if (!key) {
      throw new Error('INVALID_SAMPLE_KEY');
    }

    const keyDocId = this.buildSampleTakenKeyDocId(factory, materialCode, poNumber, imd);
    const keyRef = this.firestore.firestore.collection(this.QC_SAMPLE_TAKEN_KEYS).doc(keyDocId);
    const catalogRef = this.firestore.firestore.collection(this.QC_SAMPLE_COLLECTION).doc();

    await this.firestore.firestore.runTransaction(async (tx) => {
      const keySnap = await tx.get(keyRef);
      if (keySnap.exists) {
        throw new Error('ALREADY_TAKEN');
      }
      tx.set(keyRef, {
        factory,
        materialCode,
        poNumber,
        imd,
        monthKey: record.monthKey,
        takenAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      tx.set(catalogRef, record);
    });

    this.sampleTakenKeySet.add(key);
  }

  async saveSampleTakeOnly(): Promise<void> {
    if (!this.sampleTakeSelected) return;
    if (this.sampleTakeMuonTest) {
      this.sampleTakeError = 'Mượn Test không lưu vào danh mục lấy mẫu. Dùng In QR nếu chỉ cần in tem.';
      return;
    }
    const pcs = this.parseSamplePcs();
    if (!pcs) {
      this.sampleTakeError = 'Số pcs phải là số nguyên > 0.';
      return;
    }
    const labelCount = this.parseSampleLabelCount();
    if (!labelCount) {
      this.sampleTakeError = 'Số tem cần in phải là số nguyên từ 1 đến 99.';
      return;
    }

    this.isSavingSampleTake = true;
    this.sampleTakeError = '';
    try {
      await this.ensureSampleTakeStt();
      const monthKey = this.sampleTakeMonthKey || (this.sampleTakeYear * 100 + this.sampleTakeMonth);
      await this.persistSampleTakeRecord({
        year: this.sampleTakeYear,
        month: this.sampleTakeMonth,
        monthKey,
        stt: this.sampleTakeStt,
        factory: this.sampleTakeSelected.factory,
        materialCode: this.sampleTakeSelected.materialCode,
        iqcTestRosh: this.sampleTakeIqcTestRosh,
        layMauHangVe: this.sampleTakeLayMauHangVe,
        engLuuMau: this.sampleTakeEngLuuMau,
        muonTest: false,
        labelCount,
        // Theo yêu cầu: Tổng Số Lượng = số lượng nhập popup (pcs)
        totalQuantity: pcs,
        // Lưu thêm để tham chiếu (tồn kho/inventory qty)
        inventoryTotalQuantity: this.sampleTakeTotalQty,
        poNumber: this.sampleTakeSelected.poNumber,
        maKho: this.sampleTakeMaKho,
        loaiHinh: this.sampleTakeLoaiHinh,
        nganhNghe: this.sampleTakeNganhNghe,
        imd: this.sampleTakeSelected.imd,
        pcs,
        takenBy: this.currentEmployeeId || '',
        takenAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      await this.cleanupOldSampleTakings(monthKey);
      this.closeSampleTakeModal();
    } catch (e: any) {
      console.error('saveSampleTakeOnly error', e);
      if (e?.message === 'ALREADY_TAKEN') {
        this.sampleTakeError = `Mã / PO / Lô này đã lấy mẫu tại ${this.sampleTakeSelected?.factory || this.selectedFactory}.`;
      } else {
        this.sampleTakeError = 'Không lưu được. Vui lòng thử lại.';
      }
    } finally {
      this.isSavingSampleTake = false;
    }
  }

  async printSampleTakeQr(): Promise<void> {
    if (!this.sampleTakeSelected) return;
    const pcs = this.parseSamplePcs();
    if (!pcs) {
      this.sampleTakeError = 'Số pcs phải là số nguyên > 0.';
      return;
    }
    const labelCount = this.parseSampleLabelCount();
    if (!labelCount) {
      this.sampleTakeError = 'Số tem cần in phải là số nguyên từ 1 đến 99.';
      return;
    }

    this.isSavingSampleTake = true;
    this.sampleTakeError = '';
    try {
      const QRCode = (await import('qrcode')) as any;
      const mat = this.sampleTakeSelected.materialCode;
      const po = this.sampleTakeSelected.poNumber;
      const imd = this.sampleTakeSelected.imd;
      const printedDate = new Date();
      const dd = String(printedDate.getDate()).padStart(2, '0');
      const mm = String(printedDate.getMonth() + 1).padStart(2, '0');
      const yyyy = printedDate.getFullYear();
      const printedDateLabel = `${dd}/${mm}/${yyyy}`;

      // Theo yêu cầu: QR = Mã hàng + PO + IMD + Số lượng
      const qrData = `${mat}|${po}|${imd}|${pcs}`;
      const qrImage = await QRCode.toDataURL(qrData, {
        width: 240,
        margin: 1,
        color: { dark: '#000000', light: '#FFFFFF' }
      });

      if (!this.sampleTakeMuonTest) {
        const monthKey = this.sampleTakeMonthKey || (this.sampleTakeYear * 100 + this.sampleTakeMonth);
        await this.ensureSampleTakeStt();
        await this.persistSampleTakeRecord({
          year: this.sampleTakeYear,
          month: this.sampleTakeMonth,
          monthKey,
          stt: this.sampleTakeStt,
          factory: this.sampleTakeSelected.factory,
          materialCode: mat,
          iqcTestRosh: this.sampleTakeIqcTestRosh,
          layMauHangVe: this.sampleTakeLayMauHangVe,
          engLuuMau: this.sampleTakeEngLuuMau,
          muonTest: false,
          labelCount,
          totalQuantity: pcs,
          inventoryTotalQuantity: this.sampleTakeTotalQty,
          poNumber: po,
          maKho: this.sampleTakeMaKho,
          loaiHinh: this.sampleTakeLoaiHinh,
          nganhNghe: this.sampleTakeNganhNghe,
          imd,
          pcs,
          takenBy: this.currentEmployeeId || '',
          takenAt: firebase.firestore.FieldValue.serverTimestamp(),
          printedAt: firebase.firestore.FieldValue.serverTimestamp(),
          printedDate: printedDateLabel,
          qrData
        });
        await this.cleanupOldSampleTakings(monthKey);
      }

      this.openSampleQrPrintWindow({
        qrImage,
        materialCode: mat,
        pcs,
        printedDateLabel,
        labelCount,
        muonTest: this.sampleTakeMuonTest
      });
      this.closeSampleTakeModal();
    } catch (e: any) {
      console.error('printSampleTakeQr error', e);
      if (e?.message === 'ALREADY_TAKEN') {
        this.sampleTakeError = `Mã / PO / Lô này đã lấy mẫu tại ${this.sampleTakeSelected?.factory || this.selectedFactory}.`;
      } else {
        this.sampleTakeError = 'Không in được QR. Vui lòng thử lại.';
      }
    } finally {
      this.isSavingSampleTake = false;
    }
  }

  private openSampleQrPrintWindow(payload: {
    qrImage: string;
    materialCode: string;
    pcs: number;
    printedDateLabel: string;
    labelCount: number;
    muonTest: boolean;
  }): void {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('❌ Không thể mở cửa sổ in. Vui lòng cho phép popup!');
      return;
    }

    const esc = (value: unknown) =>
      String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const totalLabels = Math.max(1, payload.labelCount || 1);
    const noteText = payload.muonTest
      ? `Mượn test ngày ${esc(payload.printedDateLabel)}`
      : `Nguyên liệu lấy test và lưu mẫu ngày ${esc(payload.printedDateLabel)}`;

    const materialCodeHtml = (() => {
      const code = String(payload.materialCode || '').trim();
      if (code.length <= 7) {
        return `<div class="material-line">${esc(code)}</div>`;
      }
      return `<div class="material-line">${esc(code.slice(0, 7))}</div><div class="material-line material-line-wrap">${esc(code.slice(7))}</div>`;
    })();

    const labelHtml = Array.from({ length: totalLabels }, (_, i) => {
      const index = i + 1;
      const fraction = `${index}/${totalLabels}`;
      return `
      <div class="qr-container${i < totalLabels - 1 ? ' page-break' : ''}">
        <div class="qr-section">
          <img class="qr-image" src="${payload.qrImage}" alt="QR"/>
        </div>
        <div class="info-section">
          <div class="info-row material-code material-code-main">${materialCodeHtml}</div>
          <div class="info-row">${esc(payload.pcs)} pcs <span class="label-fraction">${esc(fraction)}</span></div>
          <div class="info-row note">${noteText}</div>
        </div>
        <div class="iqc-badge">IQC</div>
      </div>`;
    }).join('');

    printWindow.document.write(`
      <html>
        <head>
          <meta charset="utf-8">
          <title></title>
          <style>
            * { margin:0 !important; padding:0 !important; box-sizing:border-box !important; }
            body { font-family: Arial, sans-serif; background:#fff; overflow:hidden; width:57mm !important; height:32mm !important; }
            .qr-container {
              display:flex !important;
              position:relative !important;
              border:1px solid #000 !important;
              width:57mm !important;
              height:32mm !important;
              background:#fff !important;
            }
            .qr-section {
              width:30mm !important;
              height:30mm !important;
              display:flex !important;
              align-items:center !important;
              justify-content:center !important;
              border-right:1px solid #ccc !important;
            }
            .qr-image { width:28mm !important; height:28mm !important; display:block !important; }
            .info-section {
              flex:1 !important;
              padding:1mm !important;
              display:flex !important;
              flex-direction:column !important;
              justify-content:flex-start !important;
              align-items:flex-start !important;
              color:#000 !important;
              font-weight:bold !important;
            }
            .info-row { margin:0.8mm 0 !important; white-space:nowrap !important; line-height:1.1 !important; }
            .info-row.material-code.material-code-main {
              font-size:21.356368px !important;
              line-height:1.05 !important;
              white-space:normal !important;
            }
            .material-line { display:block !important; white-space:nowrap !important; line-height:1.05 !important; }
            .material-line-wrap { font-size:18px !important; }
            .info-row.note { font-size:8.8px !important; white-space:normal !important; line-height:1.1 !important; padding-right:7mm !important; }
            .label-fraction { font-size:10px !important; margin-left:1mm !important; }
            .iqc-badge {
              position:absolute !important;
              right:1mm !important;
              bottom:0.5mm !important;
              font-size:9px !important;
              font-weight:bold !important;
              color:#000 !important;
              line-height:1 !important;
            }
            .page-break { page-break-after: always !important; break-after: page !important; }
            @media print {
              @page { margin:0 !important; size:57mm 32mm !important; }
              body { margin:0 !important; width:57mm !important; height:32mm !important; }
            }
          </style>
        </head>
        <body>
          ${labelHtml}
          <script>
            document.title = '';
            window.onload = function() {
              setTimeout(function(){ window.print(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  private monthKeyToPrevMonthKey(monthKey: number): number {
    const y = Math.floor(monthKey / 100);
    const m = monthKey % 100;
    if (m <= 1) return (y - 1) * 100 + 12;
    return y * 100 + (m - 1);
  }

  /** Chỉ giữ dữ liệu: tháng hiện tại + tháng trước; cũ hơn tự xóa. */
  private async cleanupOldSampleTakings(currentMonthKey: number): Promise<void> {
    try {
      const prevMonthKey = this.monthKeyToPrevMonthKey(currentMonthKey);
      const threshold = prevMonthKey; // delete < prevMonthKey
      const chunk = 400;
      while (true) {
        const snap = await this.firestore.firestore
          .collection(this.QC_SAMPLE_COLLECTION)
          .where('monthKey', '<', threshold)
          .orderBy('monthKey', 'asc')
          .limit(chunk)
          .get();
        if (snap.empty) break;
        const batch = this.firestore.firestore.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        if (snap.size < chunk) break;
      }
    } catch (e) {
      console.warn('cleanupOldSampleTakings failed (non-blocking)', e);
    }
  }

  // ===== Danh mục Lấy Mẫu (More) =====
  openSampleCatalogModal(): void {
    this.showSampleCatalogModal = true;
    this.closeMoreMenu();
    const now = new Date();
    this.sampleCatalogYear = String(now.getFullYear());
    this.sampleCatalogMonth = String(now.getMonth() + 1).padStart(2, '0');
    void this.loadSampleCatalogByMonth();
  }

  closeSampleCatalogModal(): void {
    this.showSampleCatalogModal = false;
    this.sampleCatalogRows = [];
    this.isLoadingSampleCatalog = false;
  }

  async loadSampleCatalogByMonth(): Promise<void> {
    if (!this.sampleCatalogYear || !this.sampleCatalogMonth) {
      alert('Vui lòng chọn tháng và năm');
      return;
    }
    const y = parseInt(this.sampleCatalogYear, 10);
    const m = parseInt(this.sampleCatalogMonth, 10);
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
      alert('Tháng/năm không hợp lệ');
      return;
    }
    const monthKey = y * 100 + m;
    const factory = this.selectedFactory;
    this.isLoadingSampleCatalog = true;
    try {
      const snap = await this.firestore
        .collection(this.QC_SAMPLE_COLLECTION, (ref) =>
          ref.where('monthKey', '==', monthKey).where('factory', '==', factory).limit(2000)
        )
        .get()
        .toPromise()
        .catch(async () => {
          const fallback = await this.firestore
            .collection(this.QC_SAMPLE_COLLECTION, (ref) => ref.where('monthKey', '==', monthKey).limit(2000))
            .get()
            .toPromise();
          return fallback;
        });
      const rows = (snap?.docs || [])
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((r: any) => String(r?.factory || 'ASM1').trim().toUpperCase() === factory);
      const seen = new Set<string>();
      this.sampleCatalogRows = rows
        .filter((r: any) => {
          if (r?.muonTest) return false;
          const key = this.buildSampleKey(factory, r?.materialCode, r?.poNumber, r?.imd);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a: any, b: any) => (Number(a?.stt || 0) || 0) - (Number(b?.stt || 0) || 0));
    } catch (e) {
      console.error('loadSampleCatalogByMonth error', e);
      alert('Không tải được danh mục Lấy Mẫu.');
      this.sampleCatalogRows = [];
    } finally {
      this.isLoadingSampleCatalog = false;
    }
  }

  downloadSampleCatalogExcel(): void {
    if (!this.sampleCatalogYear || !this.sampleCatalogMonth) {
      alert('Vui lòng chọn tháng và năm');
      return;
    }
    const rows = this.sampleCatalogRows || [];
    if (!rows.length) {
      alert('Không có dữ liệu để tải');
      return;
    }

    import('xlsx')
      .then((XLSX) => {
        const wsData: any[][] = [
          [
            'Năm',
            'Tháng',
            'STT',
            'Xưởng',
            'Mã',
            'Số PO',
            'Lô hàng',
            'IQC Test Rosh',
            'Lấy mẫu hàng về',
            'ENG lưu mẫu',
            'Tổng Số Lượng',
            'Mã Kho (LINKQ)',
            'Loại Hình (LINKQ)',
            'Mã ngành nghề',
            'PXK'
          ]
        ];

        rows.forEach((r: any) => {
          wsData.push([
            r.year || '',
            r.month || '',
            r.stt || '',
            r.factory || this.selectedFactory,
            r.materialCode || '',
            r.poNumber || '',
            r.imd || '',
            r.iqcTestRosh ? '✔' : '',
            r.layMauHangVe ? '✔' : '',
            r.engLuuMau ? '✔' : '',
            // Tổng Số Lượng = số lượng nhập popup
            (r.pcs ?? r.totalQuantity ?? ''),
            r.maKho || '',
            r.loaiHinh || '',
            r.nganhNghe || '',
            r.pxk || ''
          ]);
        });

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'LayMau');
        const fileName = `Lay_Mau_${this.selectedFactory}_${this.sampleCatalogMonth}_${this.sampleCatalogYear}.xlsx`;
        XLSX.writeFile(wb, fileName);
      })
      .catch((e) => {
        console.error('downloadSampleCatalogExcel error', e);
        alert('Lỗi khi xuất Excel.');
      });
  }

  async saveSampleCatalogPxk(row: any): Promise<void> {
    const id = String(row?.id || '').trim();
    if (!id) return;
    const pxk = String(row?.pxk || '').trim();
    try {
      await this.firestore.collection(this.QC_SAMPLE_COLLECTION).doc(id).set(
        {
          pxk,
          pxkUpdatedAt: new Date()
        },
        { merge: true }
      );
    } catch (e) {
      console.error('saveSampleCatalogPxk error', e);
      alert('Không lưu được PXK. Vui lòng thử lại.');
    }
  }

  closePendingQCModal(): void {
    this.showPendingQCModal = false;
    this.pendingQCMaterials = [];
  }

  // Show pending confirm materials modal
  async showPendingConfirmMaterials(showPopup: boolean = true): Promise<void> {
    if (showPopup) {
      this.showPendingConfirmModal = true;
      this.isLoadingReport = true;
    } else {
      // Inline display (no popup)
      this.showPendingConfirmModal = false;
      this.showTodayCheckedModal = false;
      this.showPendingQCModal = false;

      this.iqcResultsTitle = 'Mã hàng chờ xác nhận';
      this.showIqcSearchResults = true;
      this.isSearchingIqcHistory = true;
      this.iqcHistoryError = '';
      this.iqcHistoryResults = [];
      this.iqcHistoryContext = 'pendingConfirm';
    }
    
    try {
      console.log('📊 Loading pending confirm materials...');
      
      // Chỉ dùng factory filter, filter status trong memory để tránh cần index
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
      ).get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        this.pendingConfirmMaterials = [];
        if (showPopup) {
          this.isLoadingReport = false;
        } else {
          this.isSearchingIqcHistory = false;
          this.iqcHistoryError = '';
        }
        return;
      }
      
      let pendingConfirmPriorityId: string | null = null;
      let pendingConfirmBestTime = 0;

      // Filter materials with status 'CHỜ XÁC NHẬN' in memory
      this.pendingConfirmMaterials = snapshot.docs
        .map(doc => {
          const data = doc.data() as any;
          const iqcStatus = data.iqcStatus;
          
          // Filter: Only materials with status 'CHỜ XÁC NHẬN'
          if (iqcStatus === 'CHỜ XÁC NHẬN') {
            const qcCheckedAt = data.qcCheckedAt?.toDate ? data.qcCheckedAt.toDate() : null;
            const updatedAt = data.updatedAt?.toDate ? data.updatedAt.toDate() : null;

            // Read backend priority flag
            if (!!data.qcPriorityPendingConfirm) {
              const t =
                (qcCheckedAt?.getTime?.() ?? 0) ||
                (updatedAt?.getTime?.() ?? 0);
              if (!pendingConfirmPriorityId || t > pendingConfirmBestTime) {
                pendingConfirmPriorityId = doc.id;
                pendingConfirmBestTime = t;
              }
            }
            
            return {
              id: doc.id,
              materialCode: data.materialCode || '',
              materialName: data.materialName || '',
              poNumber: data.poNumber || '',
              batchNumber: data.batchNumber || '',
              quantity: data.quantity || 0,
              unit: data.unit || '',
              location: data.location || '',
              iqcStatus: iqcStatus,
              qcCheckedBy: data.qcCheckedBy || '',
              qcCheckedAt: qcCheckedAt,
              updatedAt: updatedAt
            };
          }
          return null;
        })
        .filter(material => material !== null)
        .sort((a, b) => {
          // Sort by updated date (newest first)
          const dateA = a!.updatedAt || a!.qcCheckedAt || new Date(0);
          const dateB = b!.updatedAt || b!.qcCheckedAt || new Date(0);
          return dateB.getTime() - dateA.getTime();
        });
      
      // Sync priority id with backend
      this.priorityMaterialId = pendingConfirmPriorityId;
      
      console.log(`✅ Loaded ${this.pendingConfirmMaterials.length} pending confirm materials`);
      if (showPopup) {
        this.isLoadingReport = false;
      } else {
        this.iqcHistoryResults = (this.pendingConfirmMaterials || []).map(m => ({
          id: m.id,
          materialCode: m.materialCode,
          poNumber: m.poNumber,
          batchNumber: m.batchNumber,
          location: m.location || '',
          iqcStatus: m.iqcStatus,
          qcCheckedBy: m.qcCheckedBy,
          eventTime: m.qcCheckedAt || m.updatedAt || null
        }));
        this.isSearchingIqcHistory = false;
        this.iqcHistoryError = '';

        if (this.isSampleTakeEnabledForCurrentList()) {
          void this.refreshSampleTakenMarkersForPendingQc(this.iqcHistoryResults);
        }

        // If current priority is not in the list anymore, drop it
        if (this.priorityMaterialId && !this.iqcHistoryResults.some(r => r.id === this.priorityMaterialId)) {
          this.priorityMaterialId = null;
        }
        this.reorderIqcHistoryResults();
      }
    } catch (error) {
      console.error('❌ Error loading pending confirm materials:', error);
      alert('❌ Lỗi khi tải danh sách mã hàng chờ xác nhận');
      if (showPopup) {
        this.isLoadingReport = false;
      } else {
        this.isSearchingIqcHistory = false;
        this.iqcHistoryError = 'Lỗi khi tải mã hàng chờ xác nhận';
      }
    }
  }

  closePendingConfirmModal(): void {
    this.showPendingConfirmModal = false;
    this.pendingConfirmMaterials = [];
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
    this.showPendingConfirmModal = false;
    this.showIqcPermissionModal = false;
    this.showSendReportStatusModal = false;
    this.iqcScanInput = '';
    this.scannedMaterial = null;
    
    // 4. Reset counts
    this.pendingQCCount = 0;
    this.todayCheckedCount = 0;
    this.pendingConfirmCount = 0;
    this.recentCheckedMaterials = [];

    this.iqcButtonEnabledForCurrentEmployee = false;
    this.isSendingReport = false;
    this.sendReportStatusText = '';
    
    console.log('✅ Đã đăng xuất khỏi tab QC. Vui lòng quét lại mã nhân viên để tiếp tục.');
  }

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  onFactoryChange(factory: 'ASM1' | 'ASM2'): void {
    if (this.selectedFactory === factory) {
      return;
    }
    this.selectedFactory = factory;

    // Reset scan state to avoid mixing factories
    this.scannedMaterial = null;
    this.iqcScanInput = '';

    // Refresh summary panels
    this.loadPendingQCCount();
    this.loadTodayCheckedCount();
    this.loadPendingConfirmCount();
    this.loadMonthlyStatusCounts();
    this.loadRecentCheckedMaterials();
    void this.syncAutoPriorityAndReloadPriority();

    // Refresh current inline list (if any)
    if (this.iqcHistoryContext === 'pendingConfirm' && this.showIqcSearchResults) {
      this.showPendingConfirmMaterials(false);
    } else if (this.iqcHistoryContext === 'todayChecked' && this.showIqcSearchResults) {
      this.showTodayCheckedMaterials(false);
    } else if (this.iqcHistoryContext === 'pendingQC' && this.showIqcSearchResults) {
      this.showPendingQCMaterials(false);
    } else if (this.iqcHistoryContext === 'monthlyPass' && this.showIqcSearchResults) {
      this.showMonthlyStatusMaterials('PASS');
    } else if (this.iqcHistoryContext === 'monthlyNg' && this.showIqcSearchResults) {
      this.showMonthlyStatusMaterials('NG');
    } else if (this.iqcHistoryContext === 'monthlyLock' && this.showIqcSearchResults) {
      this.showMonthlyStatusMaterials('LOCK');
    }

    if (this.showSampleCatalogModal) {
      void this.loadSampleCatalogByMonth();
    }
  }
}

