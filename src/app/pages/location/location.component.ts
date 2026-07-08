import { Component, OnInit, OnDestroy, AfterViewInit, ChangeDetectorRef, HostListener, ViewChild, ElementRef } from '@angular/core';
import { Router } from '@angular/router';
import firebase from 'firebase/compat/app';
import { Subject, BehaviorSubject, Subscription } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged, take } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import * as XLSX from 'xlsx';
import * as QRCode from 'qrcode';
import { TabPermissionService } from '../../services/tab-permission.service';
import { FactoryAccessService } from '../../services/factory-access.service';
import { LocationAddUnlockService } from '../../services/location-add-unlock.service';
import {
  blocksSingleLetterPrefixMatch,
  getDefaultLocationsForWarehouse,
  mergeWarehouseMapsFromFirestore
} from '../../services/location-warehouse-defaults.util';
import { trigger, state, style, transition, animate } from '@angular/animations';

export interface LocationItem {
  id?: string;
  stt: number;
  viTri: string;
  qrCode: string;
  printCount?: number; // Số lần in (Lần in)
  createdBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CustomerCode {
  id?: string;
  no: number;
  customer: string;
  group: string;
  code: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface FGLocation {
  id?: string;
  stt: number;
  viTri: string;
  qrCode: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface LocationRule {
  id?: string;
  factory: 'ASM1' | 'ASM2';
  materialCode: string;
  destinationLocationPrefixes: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

type WarehouseType = 'Kho Thường' | 'Kho Mát';

interface LocationWarehouseRow {
  viTri: string;
  warehouseType: WarehouseType | '';
}

interface MaterialPrefixWarehouseRow {
  materialPrefix: string;
  warehouseType: WarehouseType;
}

interface LocationRuleParentGroup {
  parentKey: string;
  children: LocationWarehouseRow[];
  totalCount: number;
  assignedCount: number;
}

/** Hiển thị tổng hợp mọi rule áp cho mã hàng (B+6/B+3 → kho + rule cũ theo mã/prefix). */
interface MaterialLocationRuleDisplayRow {
  materialCode: string;
  ruleKind: 'b-prefix-warehouse' | 'legacy-code';
  warehouseType?: WarehouseType;
  allowedLocations: string[];
  allowedLocationsLabel: string;
  legacyRuleId?: string;
}

interface LocationWarehouseRulesDoc {
  factory: 'ASM1' | 'ASM2';
  locationByViTri?: Record<string, WarehouseType>;
  locationByFirstChar?: Record<string, WarehouseType>;
  materialByPrefix?: Record<string, WarehouseType>;
  updatedAt?: Date;
}

export interface MaterialLocationHistoryRow {
  id?: string;
  factory: string;
  materialId: string;
  materialCode: string;
  poNumber?: string;
  fromLocation: string;
  toLocation: string;
  changedBy: string;
  changedAt: Date;
  changeType: 'store' | 'bulk';
}

@Component({
  selector: 'app-location',
  templateUrl: './location.component.html',
  styleUrls: ['./location.component.scss'],
  animations: [
    trigger('slideIn', [
      transition(':enter', [
        style({ transform: 'translateX(100%)', opacity: 0 }),
        animate('300ms ease-out', style({ transform: 'translateX(0)', opacity: 1 }))
      ])
    ])
  ]
})
export class LocationComponent implements OnInit, OnDestroy, AfterViewInit {
  // Data properties
  locationItems: LocationItem[] = [];
  filteredItems: LocationItem[] = [];
  /** Lookup inventory items by scanned/typed location */
  locationLookupLocation = '';
  locationLookupItems: { id: string; materialCode: string; poNumber?: string; stock?: number }[] = [];
  isLocationLookupLoading = false;
  private locationLookupSeq = 0;
  
  // Loading state
  isLoading = false;
  
  // Search and filter
  searchTerm = '';
  /** Lọc theo từng cột */
  filterByStt = '';
  filterByViTri = '';
  filterByCreatedBy = '';
  filterByPrintCount = '';
  /** Kích thước tem QR vị trí: 57×32mm hoặc 130×100mm */
  selectedQrLabelSize: '57x32' | '130x100' = '57x32';
  private searchSubject = new Subject<string>();
  
  // Total counter
  private totalCountSubject = new BehaviorSubject<number>(0);
  public totalCount$ = this.totalCountSubject.asObservable();
  
  // Permission
  canDelete = false;
  
  // Dropdown state
  isDropdownOpen = false;

  // ── Employee scan (step before factory select) ──────────────────────────
  private readonly EMP_STORAGE_KEY = 'loc_employee_id';
  private readonly EMP_LOGIN_TIME_KEY = 'loc_employee_login_at';
  private readonly SESSION_TIMEOUT_MS = 30 * 60 * 1000;
  private readonly EMP_PATTERN = /^ASP\d{4}$/i;
  private autoLogoutTimer: ReturnType<typeof setTimeout> | null = null;
  showEmployeeScan = true;
  employeeScanInput = '';
  employeeScanError = '';
  /** Mã nhân viên đang dùng tab (ASP + 4 số) */
  activeEmployeeId = '';
  /** Thời điểm ký tự cuối được nhập — dùng để phân biệt scan vs gõ tay */
  private lastEmpKeyTime = 0;

  @ViewChild('empScanInputRef') empScanInputRef?: ElementRef<HTMLInputElement>;

  // Factory selection (ASM1/ASM2) - required before using Location tab features
  showFactorySelect = false;   // mở sau khi employee đã xác nhận
  selectedFactory: 'ASM1' | 'ASM2' | null = null;
  
  // New item form
  newItem: Partial<LocationItem> = {
    stt: 0,
    viTri: '',
    qrCode: ''
  };
  
  // Auto STT counter
  nextStt = 1;

  /**
   * Phân biệt scan vs gõ tay:
   * Scanner gửi toàn bộ ký tự liên tiếp nhanh (< 100ms/ký tự).
   * Nếu ký tự tiếp theo đến sau > 150ms khi input đã có dữ liệu
   * → gõ tay → xoá input và báo lỗi.
   */
  onEmpScanKeydown(event: KeyboardEvent): void {
    const SCAN_SPEED_MS = 150;
    const now = Date.now();
    const gap = now - this.lastEmpKeyTime;

    // Phím hệ thống: luôn cho phép
    if (['Backspace', 'Delete', 'Enter', 'Tab', 'Shift',
         'Control', 'Alt', 'Meta', 'CapsLock'].includes(event.key)) {
      this.lastEmpKeyTime = now;
      return;
    }

    // Nếu input đang có dữ liệu VÀ gap quá chậm → gõ tay → chặn + reset
    if (this.employeeScanInput.length > 0 && gap > SCAN_SPEED_MS) {
      event.preventDefault();
      this.employeeScanInput = '';
      this.employeeScanError = 'Vui lòng sử dụng máy scan thẻ nhân viên.';
      this.lastEmpKeyTime = 0;
      return;
    }

    this.lastEmpKeyTime = now;
  }

  /** Gọi mỗi khi scanner ghi vào input — tự confirm khi đủ 7 ký tự hợp lệ */
  onEmployeeScanChange(value: string): void {
    const raw = (value || '').trim().toUpperCase();
    this.employeeScanInput = raw;
    if (raw.length === 7) {
      this.confirmEmployee();
    }
  }

  confirmEmployee(): void {
    const raw = this.employeeScanInput.trim().toUpperCase();
    if (!this.EMP_PATTERN.test(raw)) {
      this.employeeScanError = 'Mã không hợp lệ. Định dạng: ASP + 4 số (VD: ASP0106)';
      this.employeeScanInput = '';
      return;
    }
    this.activeEmployeeId = raw;
    localStorage.setItem(this.EMP_STORAGE_KEY, raw);
    localStorage.setItem(this.EMP_LOGIN_TIME_KEY, String(Date.now()));
    this.employeeScanInput = '';
    this.employeeScanError = '';
    this.showEmployeeScan = false;
    this.showFactorySelect = true;
    this.scheduleAutoLogout();
  }

  changeEmployee(): void {
    this.employeeScanInput = '';
    this.employeeScanError = '';
    this.showEmployeeScan = true;
    this.showFactorySelect = false;
    this.selectedFactory = null;
    this.cdr.markForCheck();
    this.focusEmployeeScanInput();
  }

  logout(): void {
    this.clearAutoLogoutTimer();
    this.activeEmployeeId = '';
    localStorage.removeItem(this.EMP_STORAGE_KEY);
    localStorage.removeItem(this.EMP_LOGIN_TIME_KEY);
    this.employeeScanInput = '';
    this.employeeScanError = '';
    this.showEmployeeScan = true;
    this.showFactorySelect = false;
    this.selectedFactory = null;
    this.cdr.markForCheck();
    this.focusEmployeeScanInput();
  }

  /** Tự focus ô scan nhân viên để quét thẻ ngay khi mở tab / mở lại modal. */
  private focusEmployeeScanInput(retry = 0): void {
    if (!this.showEmployeeScan) return;
    setTimeout(() => {
      const el = this.empScanInputRef?.nativeElement;
      if (el) {
        el.focus();
        this.lastEmpKeyTime = 0;
        return;
      }
      if (retry < 8) {
        this.focusEmployeeScanInput(retry + 1);
      }
    }, retry === 0 ? 0 : 80);
  }

  /** Giữ focus ô scan vị trí mới (Cất NVL) sau tick ASM3 / thao tác khác. */
  private focusStoreTargetLocationInput(retry = 0): void {
    if (this.storeMaterialStep !== 'choose-location') return;
    setTimeout(() => {
      const el = document.getElementById('targetLocationInput') as HTMLInputElement | null;
      if (el && !el.disabled) {
        el.focus();
        return;
      }
      if (retry < 8) {
        this.focusStoreTargetLocationInput(retry + 1);
      }
    }, retry === 0 ? 0 : 50);
  }

  onStoreMaterialAsm3Change(): void {
    this.cdr.markForCheck();
    this.focusStoreTargetLocationInput();
  }

  /** Giữ focus ô scan vị trí mới (đổi vị trí hàng loạt) sau tick ASM3. */
  private focusBulkNewLocationInput(retry = 0): void {
    if (this.bulkStep !== 'scan-targets' || this.skipBulkNewLocation) return;
    setTimeout(() => {
      const el = document.getElementById('bulkAsm1NewLocationInput') as HTMLInputElement | null;
      if (el && !el.disabled) {
        el.focus();
        return;
      }
      if (retry < 8) {
        this.focusBulkNewLocationInput(retry + 1);
      }
    }, retry === 0 ? 0 : 50);
  }

  onBulkAsm3Change(): void {
    this.cdr.markForCheck();
    this.focusBulkNewLocationInput();
  }

  private clearAutoLogoutTimer(): void {
    if (this.autoLogoutTimer) {
      clearTimeout(this.autoLogoutTimer);
      this.autoLogoutTimer = null;
    }
  }

  /** Tự đăng xuất sau 30 phút kể từ lúc quét thẻ nhân viên. */
  private scheduleAutoLogout(): void {
    this.clearAutoLogoutTimer();
    if (!this.activeEmployeeId) return;

    const loginAt = Number(localStorage.getItem(this.EMP_LOGIN_TIME_KEY) || '0');
    const elapsed = Date.now() - loginAt;
    const remaining = this.SESSION_TIMEOUT_MS - elapsed;

    if (!loginAt || remaining <= 0) {
      this.logout();
      return;
    }

    this.autoLogoutTimer = setTimeout(() => this.logout(), remaining);
  }

  selectFactory(factory: 'ASM1' | 'ASM2') {
    this.selectedFactory = factory;
    this.showFactorySelect = false;
    // Clear lookup state when switching factory
    this.clearLocationLookup();
    this.setupRulesListener();
    void this.loadWarehouseRulesFromFirestore();
    this.applyFilters();
  }
  
  // Edit mode
  editingItem: LocationItem | null = null;

  // Multi-select for batch delete
  selectedLocationIds = new Set<string>();
  
  // Store Material Modal (Cất NVL)
  showStoreMaterialModal = false;
  storeMaterialQRInput = '';
  scannedMaterialCodeForStore = '';
  /** IMD lấy từ QR (DDMMYYYY) để phân biệt PO trùng */
  scannedIMDForStore = '';
  foundMaterialsForStore: any[] = []; // Các materials tìm được theo materialCode
  selectedMaterialForStore: any = null; // Material được chọn để cất
  suggestedLocations: string[] = []; // Danh sách vị trí hiện tại của material
  selectedTargetLocation = ''; // Vị trí đích được chọn
  /** Bước 2: scan nhiều mã (tối đa 10), cùng chuyển sang vị trí mới một lần. */
  storeMaterialMultiCode = false;
  /** Tick ASM3: ghép ASM3+ + vị trí scan; không áp rule kệ. */
  storeMaterialUseAsm3 = false;
  storeMaterialBatchItems: any[] = [];
  storeMaterialBatchQRInput = '';
  readonly STORE_MATERIAL_BATCH_MAX = 10;
  isSearchingMaterial = false;
  storeMaterialStep: 'scan' | 'select' | 'choose-location' | 'confirm' = 'scan';
  /** Tồn kho của PO được scan (cùng materialCode + poNumber) */
  storeMaterialPOStock: number = 0;
  /** Tồn kho theo từng vị trí (cùng materialCode), dùng để hiển thị khi scan */
  storeMaterialStockByLocation: { location: string; stock: number }[] = [];

  getIQCStatusClass(status?: string): string {
    const s = (status || '').toString().trim().toUpperCase();
    if (!s) return 'iqc-none';
    if (s === 'PASS' || s === 'PASSED') return 'iqc-pass';
    if (s === 'NG') return 'iqc-ng';
    if (s === 'ĐẶC CÁCH' || s === 'DAC CACH' || s === 'SPECIAL') return 'iqc-special';
    if (s === 'CHỜ XÁC NHẬN' || s === 'CHO XAC NHAN' || s === 'PENDING' || s === 'PENDING JUDGMENT') return 'iqc-pending';
    if (s === 'CHỜ KIỂM' || s === 'CHO KIEM' || s === 'WAITING') return 'iqc-waiting';
    return 'iqc-default';
  }

  getIQCStatusText(status?: string): string {
    const s = (status || '').toString().trim();
    return s || '—';
  }
  
  // FG Location Modal
  showFGModal = false;
  fgLocations: FGLocation[] = [];
  filteredFGLocations: FGLocation[] = [];
  fgSearchTerm = '';
  
  // Customer Codes
  customerCodes: CustomerCode[] = [];
  filteredCustomerCodes: CustomerCode[] = [];
  customerSearchTerm = '';
  showCustomerModal = false;

  // Rule ép vị trí: ký tự đầu vị trí → loại kho; đầu mã B+6 (ưu tiên) / B+3 → loại kho
  readonly warehouseTypeOptions: WarehouseType[] = ['Kho Thường', 'Kho Mát'];
  showRuleModal = false;
  rules: LocationRule[] = [];
  rulesLoadError = '';
  isTargetLocationForced = false;
  forcedAllowedDestinationPrefixes: string[] = [];
  forcedWarehouseType: WarehouseType | '' = '';
  forcedAllowedLocations: string[] = [];
  locationWarehouseRows: LocationWarehouseRow[] = [];
  locationRuleParentGroups: LocationRuleParentGroup[] = [];
  expandedLocationRuleParent: string | null = null;
  locationRuleFilter = '';
  materialPrefixRows: MaterialPrefixWarehouseRow[] = [];
  materialLocationRuleRows: MaterialLocationRuleDisplayRow[] = [];
  newMaterialPrefixInput = '';
  newMaterialPrefixWarehouse: WarehouseType = 'Kho Thường';
  /** Rule cũ: mã 4/7 ký tự → prefix vị trí (collection location-rules). */
  ruleMaterialCodeInput = '';
  ruleDestinationLocationInput = '';
  editingLegacyRuleId: string | null = null;
  isWarehouseRulesSaving = false;
  isWarehouseRulesLoading = false;
  isMaterialPrefixRulesSaving = false;
  isLegacyRulesSaving = false;
  warehouseRulesLoadError = '';
  private locationByViTriMap: Record<string, WarehouseType> = {};
  private materialPrefixWarehouseMap: Record<string, WarehouseType> = {};
  private rulesSub?: Subscription;

  /**
   * Chuẩn hoá mã nguyên liệu:
   * - Xoá whitespace, uppercase
   * - Cắt tối đa 7 ký tự (scanner/QR đang lấy 7 ký tự đầu)
   *
   * Lưu ý: matching rule sẽ dựa trên độ dài key (4 hoặc 7).
   */
  private normalizeMaterialCodeForRule(code: string): string {
    return (code || '').replace(/\s/g, '').toUpperCase().substring(0, 7);
  }

  async openRuleModal(): Promise<void> {
    if (!this.selectedFactory) {
      this.showFactorySelect = true;
      alert('Vui lòng chọn ASM1 hoặc ASM2 trước');
      return;
    }
    this.expandedLocationRuleParent = null;
    this.locationRuleFilter = '';
    this.showRuleModal = true;
    await Promise.all([
      this.loadWarehouseRulesFromFirestore(),
      this.reloadLocationRulesFromFirestore()
    ]);
    this.rebuildRuleModalRows();
    this.cdr.markForCheck();
  }

  closeRuleModal(): void {
    this.showRuleModal = false;
    this.expandedLocationRuleParent = null;
    this.clearLegacyRuleForm();
  }

  clearLegacyRuleForm(): void {
    this.ruleMaterialCodeInput = '';
    this.ruleDestinationLocationInput = '';
    this.editingLegacyRuleId = null;
  }

  startEditLegacyRule(rule: LocationRule): void {
    this.editingLegacyRuleId = rule.id || null;
    this.ruleMaterialCodeInput = rule.materialCode || '';
    this.ruleDestinationLocationInput = (rule.destinationLocationPrefixes || []).join(', ');
    this.cdr.markForCheck();
  }

  private parseLegacyRuleDestinationInput(raw: string): string[] {
    return String(raw || '')
      .split(',')
      .map(s => this.normalizeRuleDestinationPrefix(s))
      .filter(s => !!s);
  }

  async upsertLegacyRuleFromInputs(): Promise<void> {
    if (!this.selectedFactory) {
      alert('Vui lòng chọn ASM1 hoặc ASM2 trước');
      return;
    }
    const materialCode = this.normalizeMaterialCodeForRule(this.ruleMaterialCodeInput);
    const keyLen = materialCode.length;
    const destinationPrefixes = this.parseLegacyRuleDestinationInput(this.ruleDestinationLocationInput);

    if (!materialCode || (keyLen !== 4 && keyLen !== 7)) {
      alert('Mã nguyên liệu phải đúng 4 ký tự (prefix) hoặc 7 ký tự (mã đầy đủ), VD: B034 hoặc B037005');
      return;
    }
    if (!destinationPrefixes.length) {
      alert('Vui lòng nhập ít nhất một prefix vị trí đích (cách nhau bởi dấu phẩy), VD: Z, K hoặc FRIDGE hoặc IQC+F7');
      return;
    }

    const payload = {
      factory: this.selectedFactory,
      materialCode,
      destinationLocationPrefixes: destinationPrefixes,
      updatedAt: new Date()
    };

    this.isLegacyRulesSaving = true;
    this.cdr.markForCheck();
    try {
      if (this.editingLegacyRuleId) {
        await this.firestore.collection('location-rules').doc(this.editingLegacyRuleId).update(payload);
      } else {
        const existing = this.rules.find(r => r.materialCode === materialCode);
        if (existing?.id) {
          await this.firestore.collection('location-rules').doc(existing.id).update(payload);
        } else {
          await this.firestore.collection('location-rules').add({
            ...payload,
            createdAt: new Date()
          });
        }
      }
      await this.reloadLocationRulesFromFirestore();
      this.buildMaterialLocationRuleDisplayRows();
      this.applyLocationRuleToSelectedMaterial();
      alert('✅ Đã lưu rule cũ');
      this.clearLegacyRuleForm();
    } catch (e: unknown) {
      console.error('❌ upsertLegacyRuleFromInputs:', e);
      alert(`❌ Không lưu được rule cũ: ${(e as Error)?.message || e}`);
    } finally {
      this.isLegacyRulesSaving = false;
      this.cdr.markForCheck();
    }
  }

  async deleteLegacyRule(rule: LocationRule): Promise<void> {
    if (!rule?.materialCode) return;
    if (!confirm(`Xóa rule cũ cho mã ${rule.materialCode}?`)) return;
    this.isLegacyRulesSaving = true;
    this.cdr.markForCheck();
    try {
      if (rule.id) {
        await this.firestore.collection('location-rules').doc(rule.id).delete();
      }
      if (this.editingLegacyRuleId === rule.id) {
        this.clearLegacyRuleForm();
      }
      await this.reloadLocationRulesFromFirestore();
      this.buildMaterialLocationRuleDisplayRows();
      this.applyLocationRuleToSelectedMaterial();
    } catch (e: unknown) {
      console.error('❌ deleteLegacyRule:', e);
      alert(`❌ Không xóa được rule: ${(e as Error)?.message || e}`);
    } finally {
      this.isLegacyRulesSaving = false;
      this.cdr.markForCheck();
    }
  }

  trackByLegacyRule(_index: number, rule: LocationRule): string {
    return rule.id || rule.materialCode;
  }

  private rebuildRuleModalRows(): void {
    this.buildLocationWarehouseRows();
    this.buildLocationRuleParentGroups();
    this.syncMaterialPrefixRowsFromMap();
    this.buildMaterialLocationRuleDisplayRows();
  }

  private buildMaterialLocationRuleDisplayRows(): void {
    const rows: MaterialLocationRuleDisplayRow[] = [];

    for (const row of this.materialPrefixRows) {
      const locations = this.getLocationsForWarehouse(row.warehouseType);
      rows.push({
        materialCode: row.materialPrefix,
        ruleKind: 'b-prefix-warehouse',
        warehouseType: row.warehouseType,
        allowedLocations: locations,
        allowedLocationsLabel: locations.length
          ? locations.join(', ')
          : '(chưa gán vị trí thuộc loại kho này)'
      });
    }

    for (const rule of this.rules) {
      const prefixes = rule.destinationLocationPrefixes || [];
      rows.push({
        materialCode: rule.materialCode,
        ruleKind: 'legacy-code',
        allowedLocations: prefixes,
        allowedLocationsLabel: prefixes.length ? prefixes.join(', ') : '—',
        legacyRuleId: rule.id
      });
    }

    this.materialLocationRuleRows = rows.sort((a, b) => {
      const codeCmp = a.materialCode.localeCompare(b.materialCode, 'vi', { numeric: true });
      if (codeCmp !== 0) return codeCmp;
      return a.ruleKind === b.ruleKind ? 0 : a.ruleKind === 'b-prefix-warehouse' ? -1 : 1;
    });
  }

  getMaterialRuleKindLabel(row: MaterialLocationRuleDisplayRow): string {
    if (row.ruleKind === 'b-prefix-warehouse') {
      const kind = row.materialCode.length === 7 ? 'B+6' : 'B+3';
      return row.warehouseType ? `${kind} → ${row.warehouseType}` : `${kind} → Loại kho`;
    }
    return row.materialCode.length >= 7 ? 'Mã đầy đủ (cũ)' : 'Prefix mã (cũ)';
  }

  trackByMaterialLocationRuleRow(_index: number, row: MaterialLocationRuleDisplayRow): string {
    return `${row.ruleKind}:${row.materialCode}:${row.legacyRuleId || ''}`;
  }

  private getLocationParentKey(viTri: string): string {
    const s = String(viTri || '').trim().toUpperCase();
    if (/^BOX-\d/i.test(s)) return 'BOX';
    return s.charAt(0) || '';
  }

  private buildLocationRuleParentGroups(): void {
    const map = new Map<string, LocationWarehouseRow[]>();
    for (const row of this.locationWarehouseRows) {
      const parentKey = this.getLocationParentKey(row.viTri);
      if (!parentKey) continue;
      if (!map.has(parentKey)) map.set(parentKey, []);
      map.get(parentKey)!.push(row);
    }
    this.locationRuleParentGroups = Array.from(map.entries())
      .map(([parentKey, children]) => {
        const sorted = [...children].sort((a, b) =>
          a.viTri.localeCompare(b.viTri, 'vi', { numeric: true })
        );
        return {
          parentKey,
          children: sorted,
          totalCount: sorted.length,
          assignedCount: sorted.filter(c => !!c.warehouseType).length
        };
      })
      .sort((a, b) => a.parentKey.localeCompare(b.parentKey, 'vi', { numeric: true }));
  }

  get expandedLocationRuleChildren(): LocationWarehouseRow[] {
    const parent = (this.expandedLocationRuleParent || '').trim().toUpperCase();
    if (!parent) return [];
    const group = this.locationRuleParentGroups.find(g => g.parentKey === parent);
    return group?.children || [];
  }

  get filteredLocationWarehouseRows(): LocationWarehouseRow[] {
    const q = this.locationRuleFilter.trim().toUpperCase();
    if (!q) return this.locationWarehouseRows;
    return this.locationWarehouseRows.filter(r =>
      String(r.viTri || '').toUpperCase().includes(q)
    );
  }

  openLocationRuleParent(parentKey: string): void {
    const key = String(parentKey || '').trim().toUpperCase();
    if (!key) return;
    this.expandedLocationRuleParent = key;
    this.cdr.markForCheck();
  }

  backFromLocationRuleParent(): void {
    this.expandedLocationRuleParent = null;
    this.cdr.markForCheck();
  }

  onMaterialPrefixWarehouseChange(prefix: string, warehouseType: WarehouseType): void {
    this.materialPrefixWarehouseMap[prefix] = warehouseType;
    void this.persistMaterialPrefixRules();
  }

  trackByLocationRuleParentGroup(_index: number, group: LocationRuleParentGroup): string {
    return group.parentKey;
  }

  /** Vị trí IQC (VD: IQC, IQC+F1-0001): không áp rule Kho Thường/Mát — mọi mã đều được cất. */
  isIqcExemptLocation(location: string): boolean {
    const raw = String(location || '').replace(/\s/g, '').toUpperCase();
    return raw.startsWith('IQC');
  }

  /** Vị trí BOX (VD: BOX-0001): không áp rule — mọi mã đều được cất. */
  isBoxExemptLocation(location: string): boolean {
    const raw = String(location || '').replace(/\s/g, '').toUpperCase();
    return /^BOX-\d/.test(raw);
  }

  /** Mã pallet F1-xxxx / F2-xxxx — luôn cho phép, không áp rule kệ. */
  private isPalletCodeLocation(location: string): boolean {
    const raw = String(location || '').replace(/\s/g, '').toUpperCase();
    return /^F[12]-/.test(raw);
  }

  private buildAsm3PrefixedLocation(raw: string): string {
    const s = String(raw || '')
      .replace(/\s/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9.\-()+]/g, '');
    const body = s.replace(/^ASM3[+_-]?/, '');
    return body ? `ASM3+${body}` : '';
  }

  private normalizeTargetLocationInput(raw: string, useAsm3: boolean): string {
    const compact = String(raw || '')
      .trim()
      .replace(/\s+/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9.\-()+]/g, '');
    if (!compact) return '';
    if (useAsm3) return this.buildAsm3PrefixedLocation(compact);
    if (this.isPalletCodeLocation(compact)) return compact;
    return this.formatViTriInput(compact);
  }

  private isTargetRuleExempt(targetLocation: string, useAsm3: boolean): boolean {
    const raw = String(targetLocation || '').replace(/\s/g, '').toUpperCase();
    if (useAsm3 || raw.startsWith('ASM3')) return true;
    if (this.isIqcExemptLocation(raw)) return true;
    if (this.isBoxExemptLocation(raw)) return true;
    if (this.isPalletCodeLocation(raw)) return true;
    return false;
  }

  private materialLocationPassesRules(
    materialCode: string,
    targetLocation: string,
    options: { ruleExempt?: boolean; useAsm3?: boolean } = {}
  ): boolean {
    const { ruleExempt = false, useAsm3 = false } = options;
    if (ruleExempt || this.isTargetRuleExempt(targetLocation, useAsm3)) return true;
    const resolved = this.resolveAllowedDestinationsForMaterial(materialCode);
    if (resolved.locations.length === 0) return true;
    return this.locationMatchesAllowedDestinations(targetLocation, resolved.locations);
  }

  /** Chuẩn hoá prefix vị trí trong rule cũ — giữ nguyên IQC+ (không qua formatViTriInput). */
  private normalizeRuleDestinationPrefix(raw: string): string {
    const s = String(raw || '').replace(/\s/g, '').toUpperCase();
    if (!s) return '';
    if (this.isIqcExemptLocation(s)) return s;
    const formatted = this.formatViTriInput(s);
    return formatted && this.validateViTriInput(formatted) ? formatted : '';
  }

  private parseLocationRulesFromDocs(docs: { id: string; data: () => any }[]): LocationRule[] {
    return docs
      .map(doc => ({ id: doc.id, raw: doc.data() || {} }))
      .filter(({ raw }) => !raw.factory || raw.factory === this.selectedFactory)
      .map(({ id, raw }) => ({
        id,
        factory: (raw.factory || this.selectedFactory) as 'ASM1' | 'ASM2',
        materialCode: this.normalizeMaterialCodeForRule(raw.materialCode || ''),
        destinationLocationPrefixes: Array.isArray(raw.destinationLocationPrefixes)
          ? raw.destinationLocationPrefixes
              .map((p: any) => this.normalizeRuleDestinationPrefix(String(p || '')))
              .filter((p: string) => !!p)
          : []
      }))
      .filter(r => r.materialCode && r.destinationLocationPrefixes.length > 0)
      .sort((a, b) => (a.materialCode || '').localeCompare(b.materialCode || ''));
  }

  private normalizeLocationWarehouseKey(viTri: string): string {
    const formatted = this.formatViTriInput(String(viTri || '').trim());
    return formatted || this.normalizeLocationCode(viTri) || String(viTri || '').trim().toUpperCase();
  }

  private buildLocationWarehouseRows(): void {
    const seen = new Set<string>();
    const rows: LocationWarehouseRow[] = [];
    const legacyByChar = this.getLegacyLocationByFirstCharMap();

    for (const item of this.locationItems) {
      const viTri = String(item.viTri || '').trim();
      if (!viTri || this.isIqcExemptLocation(viTri) || this.isBoxExemptLocation(viTri)) continue;
      const key = this.normalizeLocationWarehouseKey(viTri);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        viTri,
        warehouseType:
          this.locationByViTriMap[key] ||
          this.locationByViTriMap[viTri.toUpperCase()] ||
          legacyByChar[this.getLocationFirstChar(viTri)] ||
          ''
      });
    }

    for (const [locKey, wh] of Object.entries(this.locationByViTriMap)) {
      if (this.isIqcExemptLocation(locKey) || this.isBoxExemptLocation(locKey)) continue;
      if (!seen.has(locKey)) {
        seen.add(locKey);
        rows.push({ viTri: locKey, warehouseType: wh });
      }
    }

    this.locationWarehouseRows = rows.sort((a, b) => a.viTri.localeCompare(b.viTri, 'vi', { numeric: true }));
    if (this.showRuleModal) {
      this.buildLocationRuleParentGroups();
    }
  }

  private getLocationFirstChar(viTri: string): string {
    return String(viTri || '').trim().toUpperCase().charAt(0);
  }

  private syncMaterialPrefixRowsFromMap(): void {
    const seen = new Set<string>();
    const rows: MaterialPrefixWarehouseRow[] = [];
    for (const [materialPrefix, warehouseType] of Object.entries(this.materialPrefixWarehouseMap)) {
      const prefix = this.normalizeMaterialPrefixKey(materialPrefix);
      const wh = this.normalizeWarehouseType(warehouseType);
      if (!prefix || !wh || seen.has(prefix)) continue;
      seen.add(prefix);
      rows.push({ materialPrefix: prefix, warehouseType: wh });
    }
    this.materialPrefixRows = rows.sort((a, b) => a.materialPrefix.localeCompare(b.materialPrefix));
  }

  private normalizeWarehouseType(value: unknown): WarehouseType | '' {
    const s = String(value || '').trim();
    if (!s) return '';
    const lower = s.toLowerCase();
    if (lower === 'kho thường' || lower === 'kho thuong') return 'Kho Thường';
    if (lower === 'kho mát' || lower === 'kho mat') return 'Kho Mát';
    return this.warehouseTypeOptions.includes(s as WarehouseType) ? (s as WarehouseType) : '';
  }

  private legacyFirstCharMap: Record<string, WarehouseType> = {};

  private applyWarehouseMapsFromDoc(data: LocationWarehouseRulesDoc | null | undefined): void {
    const locMap: Record<string, WarehouseType> = {};
    const legacyMap: Record<string, WarehouseType> = {};
    const matMap: Record<string, WarehouseType> = {};
    const rawByViTri = data?.locationByViTri || {};
    const rawByChar = data?.locationByFirstChar || {};
    const rawMat = data?.materialByPrefix || {};

    for (const [k, v] of Object.entries(rawByViTri)) {
      const key = this.normalizeLocationWarehouseKey(k);
      const wh = this.normalizeWarehouseType(v);
      if (key && wh) {
        locMap[key] = wh;
      }
    }
    for (const [k, v] of Object.entries(rawByChar)) {
      const c = String(k || '').trim().toUpperCase().charAt(0);
      const wh = this.normalizeWarehouseType(v);
      if (c && wh) {
        legacyMap[c] = wh;
      }
    }
    for (const [k, v] of Object.entries(rawMat)) {
      const p = this.normalizeMaterialPrefixKey(k);
      const wh = this.normalizeWarehouseType(v);
      if (p && wh) {
        matMap[p] = wh;
      }
    }
    const merged = mergeWarehouseMapsFromFirestore(locMap, legacyMap);
    this.locationByViTriMap = merged.locationByViTriMap;
    this.legacyFirstCharMap = merged.legacyFirstCharMap;
    this.materialPrefixWarehouseMap = matMap;
    this.syncMaterialPrefixRowsFromMap();
    if (this.showRuleModal) {
      this.buildMaterialLocationRuleDisplayRows();
    }
  }

  private async reloadLocationRulesFromFirestore(): Promise<void> {
    if (!this.selectedFactory) return;
    try {
      const snap = await this.firestore.collection('location-rules').get().toPromise();
      const docs = (snap?.docs || []).map(doc => ({ id: doc.id, data: () => doc.data() }));
      this.rules = this.parseLocationRulesFromDocs(docs);
      if (this.showRuleModal) {
        this.buildMaterialLocationRuleDisplayRows();
      }
    } catch (e: unknown) {
      console.error('❌ reloadLocationRulesFromFirestore:', e);
      this.rulesLoadError = (e as Error)?.message || String(e);
    }
  }

  private getLegacyLocationByFirstCharMap(): Record<string, WarehouseType> {
    return this.legacyFirstCharMap;
  }

  private async loadWarehouseRulesFromFirestore(): Promise<void> {
    if (!this.selectedFactory) return;
    this.isWarehouseRulesLoading = true;
    this.warehouseRulesLoadError = '';
    try {
      const snap = await this.firestore
        .collection<LocationWarehouseRulesDoc>('location-warehouse-rules')
        .doc(this.selectedFactory)
        .get()
        .toPromise();
      this.applyWarehouseMapsFromDoc(snap?.exists ? (snap.data() as LocationWarehouseRulesDoc) : null);
      if (this.showRuleModal) {
        this.rebuildRuleModalRows();
      }
    } catch (e: unknown) {
      this.warehouseRulesLoadError = (e as Error)?.message || String(e);
      console.error('❌ loadWarehouseRulesFromFirestore:', e);
    } finally {
      this.isWarehouseRulesLoading = false;
      this.cdr.markForCheck();
    }
  }

  /** Chuẩn hoá key rule đầu mã: B+3 (B034) hoặc B+6 (B034567). */
  private normalizeMaterialPrefixKey(raw: string): string {
    const compact = String(raw || '').replace(/\s/g, '').toUpperCase();
    if (/^B\d{6}$/.test(compact)) return compact;
    if (/^B\d{3}$/.test(compact)) return compact;
    const m6 = /^B(\d{6})/.exec(compact);
    if (m6) return `B${m6[1]}`;
    const m3 = /^B(\d{3})/.exec(compact);
    if (m3) return `B${m3[1]}`;
    return '';
  }

  private getMaterialB6Prefix(materialCode: string): string {
    const compact = this.normalizeMaterialCodeForRule(materialCode);
    const m = /^B(\d{6})/.exec(compact);
    return m ? `B${m[1]}` : '';
  }

  private getMaterialB3Prefix(materialCode: string): string {
    const compact = this.normalizeMaterialCodeForRule(materialCode);
    const m = /^B(\d{3})/.exec(compact);
    return m ? `B${m[1]}` : '';
  }

  private getWarehouseTypeForMaterial(materialCode: string): WarehouseType | '' {
    const b6 = this.getMaterialB6Prefix(materialCode);
    if (b6 && this.materialPrefixWarehouseMap[b6]) {
      return this.materialPrefixWarehouseMap[b6];
    }
    const b3 = this.getMaterialB3Prefix(materialCode);
    if (b3 && this.materialPrefixWarehouseMap[b3]) {
      return this.materialPrefixWarehouseMap[b3];
    }
    return '';
  }

  private getLocationsForWarehouse(warehouseType: WarehouseType): string[] {
    const locs = new Set<string>(getDefaultLocationsForWarehouse(warehouseType));
    for (const [loc, wh] of Object.entries(this.locationByViTriMap)) {
      if (wh === warehouseType && !this.isIqcExemptLocation(loc) && !this.isBoxExemptLocation(loc)) {
        locs.add(loc);
      }
    }
    for (const [c, wh] of Object.entries(this.legacyFirstCharMap)) {
      if (wh === warehouseType) {
        locs.add(c);
      }
    }
    return Array.from(locs).sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  }


  private resolveAllowedDestinationsForMaterial(materialCode: string): { warehouseType: WarehouseType | ''; locations: string[] } {
    const warehouseType = this.getWarehouseTypeForMaterial(materialCode);
    if (warehouseType) {
      return { warehouseType, locations: this.getLocationsForWarehouse(warehouseType) };
    }
    const legacy = this.findMatchedRuleFromList(materialCode);
    return { warehouseType: '', locations: legacy?.destinationLocationPrefixes || [] };
  }

  private locationMatchesAllowedDestinations(target: string, allowed: string[]): boolean {
    if (this.isIqcExemptLocation(target) || this.isBoxExemptLocation(target)) return true;
    const targetRaw = String(target || '').replace(/\s/g, '').toUpperCase();
    const formatted = this.formatViTriInput(target || '');
    if (!allowed.length) return false;
    const normalized = formatted ? this.normalizeLocationWarehouseKey(formatted) : targetRaw;
    const sorted = [...allowed].sort((a, b) => b.length - a.length);
    for (const allowedLoc of sorted) {
      const allowedRaw = String(allowedLoc || '').replace(/\s/g, '').toUpperCase();
      if (this.isIqcExemptLocation(allowedRaw)) {
        if (targetRaw.startsWith(allowedRaw)) return true;
        continue;
      }
      const key = this.normalizeLocationWarehouseKey(allowedLoc);
      if (!key) continue;
      if (normalized === key) return true;
      if (key.length >= 2 && normalized.startsWith(key)) return true;
      if (
        key.length === 1 &&
        !blocksSingleLetterPrefixMatch(normalized, key) &&
        normalized.startsWith(key)
      ) {
        return true;
      }
    }
    return false;
  }

  addMaterialPrefixRuleRow(): void {
    const prefix = this.normalizeMaterialPrefixKey(this.newMaterialPrefixInput);
    if (!prefix) {
      alert('Đầu mã phải đúng định dạng B+3 số (VD: B034) hoặc B+6 số (VD: B034567).');
      return;
    }
    if (this.materialPrefixRows.some(r => r.materialPrefix === prefix)) {
      alert(`Đầu mã ${prefix} đã có trong danh sách.`);
      return;
    }
    this.materialPrefixRows = [
      ...this.materialPrefixRows,
      { materialPrefix: prefix, warehouseType: this.newMaterialPrefixWarehouse }
    ].sort((a, b) => a.materialPrefix.localeCompare(b.materialPrefix));
    this.materialPrefixWarehouseMap[prefix] = this.newMaterialPrefixWarehouse;
    this.newMaterialPrefixInput = '';
    this.cdr.markForCheck();
    void this.persistMaterialPrefixRules();
  }

  removeMaterialPrefixRuleRow(prefix: string): void {
    this.materialPrefixRows = this.materialPrefixRows.filter(r => r.materialPrefix !== prefix);
    delete this.materialPrefixWarehouseMap[prefix];
    this.cdr.markForCheck();
    void this.persistMaterialPrefixRules();
  }

  private buildMaterialByPrefixForSave(): Record<string, WarehouseType> {
    const materialByPrefix: Record<string, WarehouseType> = {};
    for (const row of this.materialPrefixRows) {
      const prefix = this.normalizeMaterialPrefixKey(row.materialPrefix);
      const wh = this.normalizeWarehouseType(row.warehouseType);
      if (prefix && wh) {
        materialByPrefix[prefix] = wh;
      }
    }
    return materialByPrefix;
  }

  /** Lưu ngay rule đầu mã B — không cần chờ bấm Lưu rule toàn bộ. */
  private async persistMaterialPrefixRules(): Promise<void> {
    if (!this.selectedFactory) {
      alert('Vui lòng chọn ASM1 hoặc ASM2 trước');
      return;
    }
    const materialByPrefix = this.buildMaterialByPrefixForSave();
    this.isMaterialPrefixRulesSaving = true;
    this.cdr.markForCheck();
    try {
      await this.firestore.collection('location-warehouse-rules').doc(this.selectedFactory).set(
        {
          factory: this.selectedFactory,
          materialByPrefix,
          updatedAt: new Date()
        },
        { merge: true }
      );
      this.materialPrefixWarehouseMap = { ...materialByPrefix };
      this.syncMaterialPrefixRowsFromMap();
      this.buildMaterialLocationRuleDisplayRows();
      this.applyLocationRuleToSelectedMaterial();
    } catch (e: unknown) {
      console.error('❌ persistMaterialPrefixRules:', e);
      alert(`❌ Không lưu được rule đầu mã: ${(e as Error)?.message || e}`);
    } finally {
      this.isMaterialPrefixRulesSaving = false;
      this.cdr.markForCheck();
    }
  }

  async saveWarehouseRules(): Promise<void> {
    if (!this.selectedFactory) {
      alert('Vui lòng chọn ASM1 hoặc ASM2 trước');
      return;
    }
    const locationByViTri: Record<string, WarehouseType> = {};
    for (const row of this.locationWarehouseRows) {
      if (row.viTri && row.warehouseType && !this.isIqcExemptLocation(row.viTri) && !this.isBoxExemptLocation(row.viTri)) {
        locationByViTri[this.normalizeLocationWarehouseKey(row.viTri)] = row.warehouseType;
      }
    }
    const materialByPrefix = this.buildMaterialByPrefixForSave();

    this.isWarehouseRulesSaving = true;
    try {
      await this.firestore.collection('location-warehouse-rules').doc(this.selectedFactory).set(
        {
          factory: this.selectedFactory,
          locationByViTri,
          materialByPrefix,
          updatedAt: new Date()
        },
        { merge: true }
      );
      this.locationByViTriMap = { ...locationByViTri };
      this.materialPrefixWarehouseMap = { ...materialByPrefix };
      this.rebuildRuleModalRows();
      this.applyLocationRuleToSelectedMaterial();
      alert('✅ Đã lưu rule ép vị trí');
    } catch (e: unknown) {
      console.error('❌ saveWarehouseRules:', e);
      alert(`❌ Không lưu được rule: ${(e as Error)?.message || e}`);
    } finally {
      this.isWarehouseRulesSaving = false;
      this.cdr.markForCheck();
    }
  }

  trackByLocationWarehouseRow(_index: number, row: LocationWarehouseRow): string {
    return row.viTri;
  }

  trackByMaterialPrefixRow(_index: number, row: MaterialPrefixWarehouseRow): string {
    return row.materialPrefix;
  }

  private setupRulesListener(): void {
    if (!this.selectedFactory) {
      this.rules = [];
      this.rulesLoadError = '';
      return;
    }
    this.rulesSub?.unsubscribe();
    this.rulesLoadError = '';
    this.rulesSub = this.firestore
      // Read all rules, then filter in memory:
      // - current factory rules
      // - legacy rules without factory (created before factory field existed)
      .collection<LocationRule>('location-rules')
      .valueChanges({ idField: 'id' })
      .pipe(takeUntil(this.destroy$))
      .subscribe((items: any[]) => {
        const docs = (items || [])
          .filter(r => r && typeof r.materialCode === 'string')
          .map((r: any) => ({ id: r.id, data: () => r }));
        this.rules = this.parseLocationRulesFromDocs(docs);
        if (this.showRuleModal) {
          this.buildMaterialLocationRuleDisplayRows();
        }
        this.cdr.markForCheck();
      }, (err: any) => {
        console.error('❌ Cannot load location-rules:', err);
        this.rules = [];
        this.rulesLoadError = err?.message || String(err || 'Cannot load rules');
      });
  }

  private applyLocationRuleToSelectedMaterial(): void {
    if (!this.selectedMaterialForStore) {
      this.isTargetLocationForced = false;
      this.forcedAllowedDestinationPrefixes = [];
      this.forcedAllowedLocations = [];
      this.forcedWarehouseType = '';
      return;
    }

    const code = this.selectedMaterialForStore.materialCode || '';
    const resolved = this.resolveAllowedDestinationsForMaterial(code);
    this.forcedWarehouseType = resolved.warehouseType;
    this.forcedAllowedLocations = resolved.locations;
    this.forcedAllowedDestinationPrefixes = resolved.locations;
    this.isTargetLocationForced = resolved.locations.length > 0;
  }

  /** Gợi ý rule ngắn gọn — không liệt kê toàn bộ tên vị trí. */
  get storeMaterialForcedRuleLabel(): string {
    if (!this.isTargetLocationForced) return '';
    if (this.forcedWarehouseType === 'Kho Mát') {
      return 'Nguyên liệu này cần lưu trữ tại kho mát';
    }
    if (this.forcedWarehouseType === 'Kho Thường') {
      return 'Nguyên liệu này cần lưu trữ tại kho thường';
    }
    const racks = [
      ...new Set(
        this.forcedAllowedLocations.map(loc => this.getLocationFirstChar(loc)).filter(Boolean)
      )
    ].sort((a, b) => a.localeCompare(b, 'vi'));
    return racks.length ? `Rule ép vị trí — kệ: ${racks.join(', ')}` : 'Rule ép vị trí';
  }

  private findMatchedRuleFromList(materialCode: string): LocationRule | null {
    const scannedCode7 = this.normalizeMaterialCodeForRule(materialCode);
    const exactRule = this.rules.find(
      r => r.materialCode.length === 7 && r.materialCode === scannedCode7
    );
    if (exactRule) return exactRule;

    const prefixRules = this.rules
      .filter(r => r.materialCode.length < 7)
      .filter(r => scannedCode7.startsWith(r.materialCode))
      .sort((a, b) => b.materialCode.length - a.materialCode.length);

    return prefixRules[0] || null;
  }

  private async resolveMatchedRule(materialCode: string): Promise<LocationRule | null> {
    // 1) Try in-memory rules first
    const fromMemory = this.findMatchedRuleFromList(materialCode);
    if (fromMemory) return fromMemory;

    // 2) Fallback query from Firestore (avoid stale/late listener state)
    if (!this.selectedFactory) return null;
    const scannedCode7 = this.normalizeMaterialCodeForRule(materialCode);
    const prefix4 = scannedCode7.substring(0, 4);

    try {
      const snap = await this.firestore
        .collection<LocationRule>('location-rules', ref =>
          ref.where('factory', '==', this.selectedFactory)
             .where('materialCode', 'in', [scannedCode7, prefix4])
        )
        .get()
        .toPromise();

      const fetched: LocationRule[] = [];
      snap?.forEach(doc => {
        const parsed = this.parseLocationRulesFromDocs([{ id: doc.id, data: () => doc.data() }]);
        if (parsed[0]) {
          const d = doc.data() as any;
          fetched.push({
            ...parsed[0],
            createdAt: d.createdAt,
            updatedAt: d.updatedAt
          });
        }
      });

      if (fetched.length > 0) {
        // merge lightweight cache update
        const map = new Map<string, LocationRule>();
        [...this.rules, ...fetched].forEach(r => map.set(`${r.factory}:${r.materialCode}`, r));
        this.rules = Array.from(map.values())
          .filter(r => r.factory === this.selectedFactory)
          .sort((a, b) => (a.materialCode || '').localeCompare(b.materialCode || ''));
      }

      return this.findMatchedRuleFromList(materialCode);
    } catch (e) {
      console.warn('resolveMatchedRule fallback failed:', e);
      return null;
    }
  }

  isDestinationAllowed(location: string): boolean {
    if (this.isIqcExemptLocation(location) || this.isBoxExemptLocation(location)) return true;
    const formatted = this.formatViTriInput(location || '');
    if (!formatted) return false;
    if (!this.isTargetLocationForced) return true;
    return this.locationMatchesAllowedDestinations(formatted, this.forcedAllowedLocations);
  }

  // Dời Kệ (Move Shelf) Modal
  showMoveShelfModal = false;
  moveShelfStep: 'scan-location' | 'select-items' | 'scan-new-location' | 'complete' = 'scan-location';
  moveShelfCurrentLocation = '';
  moveShelfNewLocation = '';
  moveShelfItems: any[] = [];
  moveShelfSelectedItems: Set<string> = new Set();
  isMoveShelfLoading = false;
  
  // ==================== BULK CHANGE LOCATION (ASM1) ====================
  showBulkChangeLocationModal = false;
  bulkStep: 'scan-location' | 'select-items' | 'scan-targets' | 'complete' = 'scan-location';
  bulkScanLocationInput = '';
  bulkCurrentLocation = '';
  bulkItems: any[] = [];
  bulkSelectedItems: Set<string> = new Set();
  isBulkLoading = false;
  bulkNewLocationInput = '';
  bulkNewPalletInput = '';
  skipBulkNewLocation = false;
  skipBulkNewPallet = false;
  /** Tick ASM3: ghép ASM3+ + vị trí scan; mọi vị trí ASM3 đều hợp lệ (không check rule). */
  bulkUseAsm3 = false;

  private readonly LOCATION_RULE_ERROR = '⚠️ Sai rule vị trí';

  /** OTP thêm vị trí mới — mã gửi Zalo tới ASP0106 */
  showLocationAddOtpModal = false;
  locationAddOtpStep: 1 | 2 = 1;
  locationAddOtpCode = '';
  locationAddOtpSending = false;
  locationAddOtpVerifying = false;
  locationAddOtpError = '';
  locationAddOtpInfo = '';
  private pendingLocationAddAction: 'add' | 'import' | null = null;
  /** Vị trí đang chờ OTP (hiển thị trên Zalo + modal). */
  locationAddOtpTargetName = '';
  locationAddUnlocked = false;

  /** Mobile shell (≤768px) */
  isMobile = false;
  mobileBottomTab: 'location' | 'history' = 'location';
  private readonly locationMobileBodyClass = 'location-mobile-tab';

  /** Mã hàng vừa scan (Theo mã hàng) — dùng cho tab History */
  lastScannedMaterialForMobile: {
    id: string;
    materialCode: string;
    poNumber?: string;
    location?: string;
    importDateStr?: string;
  } | null = null;

  locationHistoryRows: MaterialLocationHistoryRow[] = [];
  isLoadingLocationHistory = false;

  private readonly materialLocationHistoryCol = 'material-location-history';

  private destroy$ = new Subject<void>();

  constructor(
    private firestore: AngularFirestore,
    private auth: AngularFireAuth,
    private tabPermissionService: TabPermissionService,
    private factoryAccessService: FactoryAccessService,
    private locationAddUnlock: LocationAddUnlockService,
    private cdr: ChangeDetectorRef,
    private router: Router
  ) {
    // Setup search debouncing
    this.searchSubject.pipe(
      takeUntil(this.destroy$),
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(term => {
      this.performSearch(term);
    });
  }

  ngOnInit() {
    // Restore saved employee ID (localStorage)
    const saved = localStorage.getItem(this.EMP_STORAGE_KEY) || '';
    if (this.EMP_PATTERN.test(saved)) {
      this.activeEmployeeId = saved.toUpperCase();
      this.showEmployeeScan = false;
      this.showFactorySelect = true;   // đã có employee → chọn factory
      this.scheduleAutoLogout();
    } else {
      this.showEmployeeScan = true;
      this.showFactorySelect = false;
    }
    this.selectedFactory = null;

    this.locationAddUnlocked = this.locationAddUnlock.isUnlocked();
    this.locationAddUnlock.unlocked$
      .pipe(takeUntil(this.destroy$))
      .subscribe(unlocked => {
        this.locationAddUnlocked = unlocked;
        this.cdr.markForCheck();
      });

    this.updateMobileLayout();
    this.checkPermissions();
    this.loadLocationData();
    this.loadCustomerCodes();
    
    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      this.isDropdownOpen = false;
    });
  }

  ngAfterViewInit() {
    this.cdr.detectChanges();
    this.focusEmployeeScanInput();
  }

  ngOnDestroy() {
    this.clearAutoLogoutTimer();
    this.locationAddUnlock.lock();
    this.destroy$.next();
    this.destroy$.complete();
    this.rulesSub?.unsubscribe();
    document.body.classList.remove(this.locationMobileBodyClass);
    
    // Remove event listeners
    document.removeEventListener('click', () => {
      this.isDropdownOpen = false;
    });
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.updateMobileLayout();
  }

  private updateMobileLayout(): void {
    const next =
      window.innerWidth <= 768 ||
      /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
        (navigator.userAgent || '').toLowerCase()
      );
    if (next === this.isMobile) return;
    this.isMobile = next;
    if (this.isMobile) {
      document.body.classList.add(this.locationMobileBodyClass);
    } else {
      document.body.classList.remove(this.locationMobileBodyClass);
    }
    this.cdr.markForCheck();
  }

  goMobileMenu(): void {
    this.router.navigate(['/menu']);
  }

  setMobileBottomTab(tab: 'location' | 'history'): void {
    this.mobileBottomTab = tab;
    if (tab === 'history') {
      this.loadLocationHistoryForScannedMaterial();
    }
    this.cdr.markForCheck();
  }

  get hasScannedMaterialForMobile(): boolean {
    return !!this.lastScannedMaterialForMobile?.id;
  }

  private setLastScannedMaterialForMobile(material: any): void {
    if (!material?.id) return;
    this.lastScannedMaterialForMobile = {
      id: material.id,
      materialCode: material.materialCode || '',
      poNumber: material.poNumber || '',
      location: material.location || '',
      importDateStr: material.importDateStr || ''
    };
  }

  private async resolveOperatorId(): Promise<string> {
    const user = await this.auth.currentUser;
    if (!user) return 'UNKNOWN';
    const email = String(user.email || '').trim().toUpperCase();
    const asp = email.match(/ASP\d{4}/);
    if (asp) return asp[0];
    const name = String(user.displayName || '').trim();
    if (name) return name.substring(0, 24);
    return email.substring(0, 24) || 'UNKNOWN';
  }

  private async logMaterialLocationChange(params: {
    materialId: string;
    materialCode: string;
    poNumber?: string;
    fromLocation: string;
    toLocation: string;
    changeType: 'store' | 'bulk';
  }): Promise<void> {
    if (!this.selectedFactory) return;
    const changedBy = await this.resolveOperatorId();
    await this.firestore.collection(this.materialLocationHistoryCol).add({
      factory: this.selectedFactory,
      materialId: params.materialId,
      materialCode: params.materialCode,
      poNumber: params.poNumber || '',
      fromLocation: params.fromLocation || '',
      toLocation: params.toLocation || '',
      changedBy,
      changeType: params.changeType,
      changedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  async loadLocationHistoryForScannedMaterial(): Promise<void> {
    const m = this.lastScannedMaterialForMobile;
    if (!m?.id) {
      this.locationHistoryRows = [];
      return;
    }
    this.isLoadingLocationHistory = true;
    try {
      const snap = await this.firestore
        .collection(this.materialLocationHistoryCol, ref =>
          ref.where('materialId', '==', m.id).limit(40)
        )
        .get()
        .toPromise();
      const rows: MaterialLocationHistoryRow[] = [];
      snap?.docs.forEach(doc => {
        const d = doc.data() as any;
        const changedAt = d.changedAt?.toDate?.() || new Date();
        rows.push({
          id: doc.id,
          factory: d.factory || '',
          materialId: d.materialId || m.id,
          materialCode: d.materialCode || m.materialCode,
          poNumber: d.poNumber || '',
          fromLocation: d.fromLocation || '',
          toLocation: d.toLocation || '',
          changedBy: d.changedBy || '',
          changedAt,
          changeType: d.changeType === 'bulk' ? 'bulk' : 'store'
        });
      });
      rows.sort((a, b) => b.changedAt.getTime() - a.changedAt.getTime());
      this.locationHistoryRows = rows;
    } catch (e) {
      console.error('loadLocationHistoryForScannedMaterial', e);
      this.locationHistoryRows = [];
    } finally {
      this.isLoadingLocationHistory = false;
      this.cdr.markForCheck();
    }
  }

  formatHistoryTime(d: Date): string {
    if (!d || Number.isNaN(d.getTime())) return '—';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private async checkPermissions() {
    try {
      this.tabPermissionService.canAccessTab('location')
        .pipe(takeUntil(this.destroy$))
        .subscribe(canAccess => {
          this.canDelete = canAccess;
        });
    } catch (error) {
      console.error('Error checking permissions:', error);
    }
  }

  private async loadLocationData() {
    this.isLoading = true;
    try {
      this.firestore.collection('locations', ref => ref.orderBy('stt', 'asc'))
        .valueChanges({ idField: 'id' })
        .pipe(takeUntil(this.destroy$))
        .subscribe((items: any[]) => {
          // Convert Firestore Timestamp → Date để date pipe hiển thị được
          const toDate = (v: any): Date | undefined => {
            if (!v) return undefined;
            if (v instanceof Date) return v;
            if (typeof v.toDate === 'function') return v.toDate();
            if (typeof v.seconds === 'number') return new Date(v.seconds * 1000);
            const d = new Date(v);
            return isNaN(d.getTime()) ? undefined : d;
          };

          this.locationItems = items.map((item: any) => ({
            ...item,
            createdAt: toDate(item.createdAt)
          }));

          // Mới nhất lên trên: sort theo createdAt giảm dần
          this.locationItems.sort((a, b) => {
            const ta = a.createdAt ? (a.createdAt as Date).getTime() : 0;
            const tb = b.createdAt ? (b.createdAt as Date).getTime() : 0;
            return tb - ta;
          });
          
          // Reassign STT theo thứ tự hiển thị
          this.locationItems.forEach((item, index) => {
            item.stt = index + 1;
          });
          
          this.applyFilters();
          this.calculateNextStt();
          this.isLoading = false;
        });
    } catch (error) {
      console.error('Error loading location data:', error);
      this.isLoading = false;
    }
  }

  toggleDropdown(event: Event) {
    event.stopPropagation();
    this.isDropdownOpen = !this.isDropdownOpen;
  }

  private updateTotalCount() {
    this.totalCountSubject.next(this.filteredItems.length);
  }
  
  private calculateNextStt() {
    // STT sẽ luôn là số tiếp theo sau số cuối cùng
    this.nextStt = this.locationItems.length + 1;
  }

  onSearchInput(event: any) {
    const term = event.target.value;
    this.searchTerm = term;
    this.searchSubject.next(term);
  }

  onSearchKeyUp(event: any) {
    if (event.key === 'Enter') {
      this.performSearch(this.searchTerm);
    }
  }

  private applyFilters() {
    let items = [...this.locationItems];
    // Search filter (ô tìm kiếm chung - Vị Trí)
    if (this.searchTerm && this.searchTerm.trim().length >= 2) {
      const formattedTerm = this.formatViTriInput(this.searchTerm.trim());
      const searchLower = formattedTerm.toLowerCase();
      items = items.filter(item => item.viTri.toLowerCase().includes(searchLower));
      // Only lookup inventory after factory is chosen
      if (this.selectedFactory) this.lookupInventoryByLocation(formattedTerm);
    } else {
      this.clearLocationLookup();
    }
    // Lọc theo cột STT
    if (this.filterByStt.trim()) {
      const term = this.filterByStt.trim().toLowerCase();
      items = items.filter(item => String(item.stt).toLowerCase().includes(term));
    }
    // Lọc theo cột Vị Trí
    if (this.filterByViTri.trim()) {
      const term = this.filterByViTri.trim().toLowerCase();
      items = items.filter(item => item.viTri.toLowerCase().includes(term));
    }
    // Lọc theo cột ID Tạo
    if (this.filterByCreatedBy.trim()) {
      const term = this.filterByCreatedBy.trim().toLowerCase();
      items = items.filter(item => (item.createdBy || '').toLowerCase().includes(term));
    }
    // Lọc theo cột Lần in
    if (this.filterByPrintCount.trim()) {
      const term = this.filterByPrintCount.trim();
      if (term === '>0' || term === '> 0') {
        items = items.filter(item => (item.printCount ?? 0) > 0);
      } else {
        const numStr = String(term);
        items = items.filter(item => String(item.printCount ?? 0).includes(numStr));
      }
    }
    this.filteredItems = items;
    this.updateTotalCount();
  }

  private performSearch(term: string) {
    this.applyFilters();
  }

  onColumnFilterChange() {
    this.applyFilters();
  }

  clearColumnFilters() {
    this.filterByStt = '';
    this.filterByViTri = '';
    this.filterByCreatedBy = '';
    this.filterByPrintCount = '';
    this.applyFilters();
  }

  clearSearch() {
    this.searchTerm = '';
    this.applyFilters();
  }

  private clearLocationLookup(): void {
    this.locationLookupLocation = '';
    this.locationLookupItems = [];
    this.isLocationLookupLoading = false;
  }

  private async lookupInventoryByLocation(locationTerm: string): Promise<void> {
    if (!this.selectedFactory) {
      this.clearLocationLookup();
      return;
    }
    // Only lookup when the location exists (avoid unnecessary queries on partial typing)
    const normalized = this.normalizeLocationCode(locationTerm);
    const matchedLocation = this.locationItems.find(
      l => this.normalizeLocationCode(l.viTri) === normalized
    )?.viTri;

    if (!matchedLocation) {
      this.clearLocationLookup();
      return;
    }

    const seq = ++this.locationLookupSeq;
    this.isLocationLookupLoading = true;
    this.locationLookupLocation = matchedLocation;
    this.locationLookupItems = [];

    try {
      const snapshot = await this.firestore
        .collection('inventory-materials', ref =>
          ref.where('factory', '==', this.selectedFactory).where('location', '==', matchedLocation)
        )
        .get()
        .toPromise();

      // If a newer lookup started, ignore this result
      if (seq !== this.locationLookupSeq) return;

      const items: { id: string; materialCode: string; poNumber?: string; stock?: number }[] = [];
      snapshot?.forEach(doc => {
        const data = doc.data() as any;
        const openingStock = Number(data.openingStock) || 0;
        const quantity = Number(data.quantity) || 0;
        const exported = Number(data.exported) || 0;
        const xt = Number(data.xt) || 0;
        const stock = openingStock + quantity - exported - xt;

        items.push({
          id: doc.id,
          materialCode: data.materialCode || '',
          poNumber: data.poNumber || '',
          stock
        });
      });

      items.sort((a, b) => (a.materialCode || '').localeCompare(b.materialCode || ''));
      this.locationLookupItems = items.filter(i => !!i.materialCode);
    } catch (error) {
      // Keep silent UI; do not alert on every keystroke
      console.error('❌ Error lookup inventory by location:', error);
      if (seq !== this.locationLookupSeq) return;
      this.locationLookupItems = [];
    } finally {
      if (seq === this.locationLookupSeq) {
        this.isLocationLookupLoading = false;
      }
    }
  }

  refreshData() {
    this.loadLocationData();
  }

  // Generate QR code based on location
  generateQRCode(viTri: string): string {
    if (!viTri) return '';
    // QR code chỉ chứa nội dung vị trí
    return viTri.toUpperCase();
  }

  // Normalize location code for duplicate checking
  // Q1.1(L) -> Q11L, Q-1-1-L -> Q11L
  normalizeLocationCode(viTri: string): string {
    if (!viTri) return '';
    
    // Convert to uppercase and remove all special characters (dots, hyphens, parentheses)
    return viTri.toUpperCase().replace(/[.\-()]/g, '');
  }

  // Format and validate viTri input
  formatViTriInput(input: string): string {
    if (!input) return '';
    
    // Remove all spaces and convert to uppercase
    let formatted = input.replace(/\s/g, '').toUpperCase();
    
    // Only allow letters, numbers, dots, hyphens, and parentheses (escape parentheses)
    formatted = formatted.replace(/[^A-Z0-9.\-()]/g, '');
    
    return formatted;
  }

  // Validate viTri input
  validateViTriInput(input: string): boolean {
    if (!input) return false;
    
    // Check if contains only allowed characters: letters, numbers, dots, hyphens, and parentheses (escape parentheses)
    const allowedPattern = /^[A-Z0-9.\-()]+$/;
    return allowedPattern.test(input);
  }

  // Handle viTri input change
  onViTriInputChange(event: any, isEditing: boolean = false) {
    const input = event.target.value;
    const formatted = this.formatViTriInput(input);
    
    if (isEditing && this.editingItem) {
      this.editingItem.viTri = formatted;
    } else {
      this.newItem.viTri = formatted;
    }
    
    // Update the input value to show formatted result
    event.target.value = formatted;
  }

  // Add new location item — cần OTP Zalo (gửi tới ASP0106)
  onAddLocationClick(): void {
    if (this.locationAddUnlock.isUnlocked()) {
      this.addLocationItem();
      return;
    }
    if (!this.newItem.viTri?.trim()) {
      alert('Vui lòng nhập Vị Trí trước khi thêm');
      return;
    }
    if (!this.validateViTriInput(this.newItem.viTri)) {
      alert('Vị Trí không hợp lệ');
      return;
    }
    this.pendingLocationAddAction = 'add';
    this.locationAddOtpTargetName = this.formatViTriInput(this.newItem.viTri.trim());
    this.openLocationAddOtpModal();
  }

  private openLocationAddOtpModal(): void {
    this.showLocationAddOtpModal = true;
    this.locationAddOtpStep = 1;
    this.locationAddOtpCode = '';
    this.locationAddOtpError = '';
    this.locationAddOtpInfo = '';
    this.cdr.markForCheck();
  }

  closeLocationAddOtpModal(): void {
    this.showLocationAddOtpModal = false;
    this.pendingLocationAddAction = null;
    this.locationAddOtpTargetName = '';
    this.locationAddOtpCode = '';
    this.locationAddOtpError = '';
    this.locationAddOtpInfo = '';
    this.cdr.markForCheck();
  }

  async sendLocationAddOtp(): Promise<void> {
    this.locationAddOtpError = '';
    this.locationAddOtpInfo = '';
    this.locationAddOtpSending = true;
    try {
      await this.locationAddUnlock.requestOtp(this.activeEmployeeId, this.locationAddOtpTargetName);
      this.locationAddOtpStep = 2;
      this.locationAddOtpInfo = `Đã gửi mã 4 số qua Zalo tới ASP0106 (vị trí: ${this.locationAddOtpTargetName}).`;
    } catch (e: unknown) {
      this.locationAddOtpError = this.extractCallableError(e);
    } finally {
      this.locationAddOtpSending = false;
      this.cdr.markForCheck();
    }
  }

  async verifyLocationAddOtp(): Promise<void> {
    this.locationAddOtpError = '';
    if (this.locationAddOtpCode.trim().length !== 4) {
      this.locationAddOtpError = 'Mã OTP phải gồm 4 chữ số.';
      return;
    }
    this.locationAddOtpVerifying = true;
    try {
      const ok = await this.locationAddUnlock.verifyOtp(this.locationAddOtpCode);
      if (!ok) {
        this.locationAddOtpError = 'Mã OTP không đúng.';
        return;
      }
      const action = this.pendingLocationAddAction;
      this.closeLocationAddOtpModal();
      if (action === 'add') {
        this.addLocationItem();
      } else if (action === 'import') {
        this.openImportLocationsFilePicker();
      }
    } catch (e: unknown) {
      this.locationAddOtpError = this.extractCallableError(e);
    } finally {
      this.locationAddOtpVerifying = false;
      this.cdr.markForCheck();
    }
  }

  private extractCallableError(e: unknown): string {
    const err = e as { message?: string; details?: string; code?: string };
    const raw = String(err?.message || err?.details || e || 'Có lỗi xảy ra.')
      .replace(/^FirebaseError:\s*/i, '');
    if (/cors|failed to fetch|network|internal/i.test(raw) || err?.code === 'internal') {
      return 'Không gửi được mã OTP. Kiểm tra đăng nhập Firebase và kết nối mạng.';
    }
    return raw;
  }

  addLocationItem() {
    if (!this.newItem.viTri) {
      alert('Vui lòng nhập Vị Trí');
      return;
    }

    // Validate viTri format
    if (!this.validateViTriInput(this.newItem.viTri)) {
      alert('Vị Trí chỉ được chứa chữ cái, số, dấu chấm (.), dấu gạch ngang (-) và dấu ngoặc đơn ()');
      return;
    }

    // Check if Vị Trí already exists (exact match)
    if (this.locationItems.find(item => item.viTri === this.newItem.viTri)) {
      alert('Vị Trí đã tồn tại, vui lòng chọn Vị Trí khác');
      return;
    }

    // Check if normalized Vị Trí already exists (Q1.1(L) vs Q-1-1-L both become Q11L)
    const normalizedNewViTri = this.normalizeLocationCode(this.newItem.viTri);
    const duplicateItem = this.locationItems.find(item => {
      const normalizedExistingViTri = this.normalizeLocationCode(item.viTri);
      return normalizedExistingViTri === normalizedNewViTri;
    });

    if (duplicateItem) {
      alert(`Vị trí "${this.newItem.viTri}" trùng với vị trí đã có "${duplicateItem.viTri}" (cả hai đều đọc là "${normalizedNewViTri}")`);
      return;
    }

    const newItem: Omit<LocationItem, 'id'> = {
      stt: this.nextStt,
      viTri: this.newItem.viTri!,
      qrCode: this.generateQRCode(this.newItem.viTri!),
      printCount: 0,
      createdBy: this.activeEmployeeId || '',
      createdAt: new Date()
    };

    this.firestore.collection('locations').add(newItem).then(() => {
      console.log('Added new location item');
      this.resetNewItemForm();
      this.refreshData();
    }).catch(error => {
      console.error('Error adding location item:', error);
    });
  }

  // Edit location item
  editLocationItem(item: LocationItem) {
    this.editingItem = { ...item };
  }

  // Save edited item
  saveEditedItem() {
    if (!this.editingItem) return;

    if (!this.editingItem.viTri) {
      alert('Vui lòng nhập Vị Trí');
      return;
    }

    // Validate viTri format
    if (!this.validateViTriInput(this.editingItem.viTri)) {
      alert('Vị Trí chỉ được chứa chữ cái, số, dấu chấm (.), dấu gạch ngang (-) và dấu ngoặc đơn ()');
      return;
    }

    // Check if Vị Trí already exists (exact match, excluding current item)
    if (this.locationItems.find(item => 
      item.viTri === this.editingItem!.viTri && item.id !== this.editingItem!.id
    )) {
      alert('Vị Trí đã tồn tại, vui lòng chọn Vị Trí khác');
      return;
    }

    // Check if normalized Vị Trí already exists (Q1.1(L) vs Q-1-1-L both become Q11L)
    const normalizedNewViTri = this.normalizeLocationCode(this.editingItem.viTri);
    const duplicateItem = this.locationItems.find(item => {
      if (item.id === this.editingItem!.id) return false; // Skip current item
      const normalizedExistingViTri = this.normalizeLocationCode(item.viTri);
      return normalizedExistingViTri === normalizedNewViTri;
    });

    if (duplicateItem) {
      alert(`Vị trí "${this.editingItem.viTri}" trùng với vị trí đã có "${duplicateItem.viTri}" (cả hai đều đọc là "${normalizedNewViTri}")`);
      return;
    }

    const updatedItem = {
      stt: this.editingItem.stt,
      viTri: this.editingItem.viTri,
      qrCode: this.generateQRCode(this.editingItem.viTri),
      updatedAt: new Date()
    };

    this.firestore.collection('locations').doc(this.editingItem.id!).update(updatedItem).then(() => {
      console.log('Updated location item');
      this.cancelEdit();
      this.refreshData();
    }).catch(error => {
      console.error('Error updating location item:', error);
    });
  }

  // Cancel edit
  cancelEdit() {
    this.editingItem = null;
  }

  // Reset new item form
  resetNewItemForm() {
    this.newItem = {
      viTri: '',
      qrCode: ''
    };
  }

  /** Lấy số box tiếp theo: BOX-0001 .. BOX-9999 */
  private getNextBoxNumber(): string {
    const boxRegex = /^BOX-(\d{1,4})$/i;
    let maxNum = 0;
    this.locationItems.forEach(item => {
      const m = item.viTri.match(boxRegex);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n >= 1 && n <= 9999) maxNum = Math.max(maxNum, n);
      }
    });
    const next = Math.min(maxNum + 1, 9999);
    return `BOX-${String(next).padStart(4, '0')}`;
  }

  /** Thêm BOX: tự tạo BOX-0001, BOX-0002, ... */
  addBoxItem() {
    const boxCode = this.getNextBoxNumber();

    if (this.locationItems.find(item => item.viTri === boxCode)) {
      alert(`Box ${boxCode} đã tồn tại. Vui lòng thử lại.`);
      return;
    }

    const newItem: Omit<LocationItem, 'id'> = {
      stt: this.nextStt,
      viTri: boxCode,
      qrCode: this.generateQRCode(boxCode),
      printCount: 0,
      createdAt: new Date(),
      createdBy: this.activeEmployeeId || ''
    };

    this.firestore.collection('locations').add(newItem).then(() => {
      console.log('Added new box:', boxCode);
      this.refreshData();
    }).catch(error => {
      console.error('Error adding box:', error);
    });
  }

  // Delete location item
  deleteLocationItem(item: LocationItem) {
    if (confirm(`Bạn có chắc muốn xóa vị trí ${item.viTri}?`)) {
      this.firestore.collection('locations').doc(item.id!).delete().then(() => {
        console.log(`Deleted location item: ${item.viTri}`);
        this.refreshData();
      }).catch(error => {
        console.error('Error deleting location item:', error);
      });
    }
  }

  // Multi-select for batch delete
  isItemSelected(item: LocationItem): boolean {
    return item.id ? this.selectedLocationIds.has(item.id) : false;
  }

  isAllSelected(): boolean {
    if (this.filteredItems.length === 0) return false;
    return this.filteredItems.every(item => item.id && this.selectedLocationIds.has(item.id));
  }

  toggleSelectItem(item: LocationItem) {
    if (!item.id) return;
    if (this.selectedLocationIds.has(item.id)) {
      this.selectedLocationIds.delete(item.id);
    } else {
      this.selectedLocationIds.add(item.id);
    }
    this.selectedLocationIds = new Set(this.selectedLocationIds);
  }

  toggleSelectAll() {
    if (this.isAllSelected()) {
      this.filteredItems.forEach(item => {
        if (item.id) this.selectedLocationIds.delete(item.id);
      });
    } else {
      this.filteredItems.forEach(item => {
        if (item.id) this.selectedLocationIds.add(item.id);
      });
    }
    this.selectedLocationIds = new Set(this.selectedLocationIds);
  }

  deleteSelectedItems() {
    const ids = Array.from(this.selectedLocationIds);
    if (ids.length === 0) {
      alert('Chưa chọn dòng nào để xóa');
      return;
    }
    if (!confirm(`Bạn có chắc muốn xóa ${ids.length} vị trí đã chọn?`)) return;
    const batch = this.firestore.firestore.batch();
    ids.forEach(id => {
      batch.delete(this.firestore.collection('locations').doc(id).ref);
    });
    batch.commit().then(() => {
      this.selectedLocationIds = new Set();
      this.refreshData();
    }).catch(error => {
      console.error('Error deleting selected items:', error);
    });
  }

  // Export to Excel
  exportToExcel() {
    try {
      const exportData = this.filteredItems.map(item => ({
        'STT': item.stt,
        'Vị Trí': item.viTri,
        'QR Code': item.qrCode
      }));

      const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(exportData);
      const wb: XLSX.WorkBook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Location Data');
      
      XLSX.writeFile(wb, `Location_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (error) {
      console.error('Error exporting to Excel:', error);
    }
  }

  // Initialize sample data
  initializeSampleData() {
    const sampleData: Omit<LocationItem, 'id'>[] = [
      { stt: 0, viTri: 'A1-01', qrCode: this.generateQRCode('A1-01'), printCount: 0, createdAt: new Date() },
      { stt: 0, viTri: 'A1-02', qrCode: this.generateQRCode('A1-02'), printCount: 0, createdAt: new Date() },
      { stt: 0, viTri: 'A2-01', qrCode: this.generateQRCode('A2-01'), printCount: 0, createdAt: new Date() },
      { stt: 0, viTri: 'A2-02', qrCode: this.generateQRCode('A2-02'), printCount: 0, createdAt: new Date() },
      { stt: 0, viTri: 'B1-01', qrCode: this.generateQRCode('B1-01'), printCount: 0, createdAt: new Date() }
    ];

    // Clear existing data first
    this.firestore.collection('locations').get().subscribe(snapshot => {
      const batch = this.firestore.firestore.batch();
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      batch.commit().then(() => {
        // Add sample data
        const addBatch = this.firestore.firestore.batch();
        sampleData.forEach(item => {
          const docRef = this.firestore.collection('locations').doc().ref;
          addBatch.set(docRef, item);
        });
        
        addBatch.commit().then(() => {
          console.log('Sample data initialized');
          this.refreshData();
        });
      });
    });
  }

  // Import locations from file — cần OTP (chỉ Thêm BOX được phép không OTP)
  importLocations() {
    if (!this.locationAddUnlock.isUnlocked()) {
      this.pendingLocationAddAction = 'import';
      this.locationAddOtpTargetName = 'Import danh sách vị trí';
      this.openLocationAddOtpModal();
      return;
    }
    this.openImportLocationsFilePicker();
  }

  private openImportLocationsFilePicker(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.processImportFile(file);
      }
    };
    input.click();
  }

  // Process imported file
  // IMPORTANT: This function ADDS new data to existing data, does NOT replace/delete existing data
  private processImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        console.log('📋 Imported data:', jsonData);
        console.log('ℹ️ IMPORT MODE: Adding new data to existing data (not replacing)');
        
        // Skip header row (dòng 1) and process all data from row 2 onwards
        const locations = [];
        const normalizedCodes = new Set<string>(); // Track normalized codes to prevent duplicates
        
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i] as any[];
          if (row && row[0] && row[0].toString().trim()) {
            const viTri = row[0].toString().trim().toUpperCase();
            console.log(`📋 Processing row ${i + 1}: "${viTri}"`);
            
            if (this.validateViTriInput(viTri)) {
              const normalizedCode = this.normalizeLocationCode(viTri);
              
              // Check for duplicates within import data
              if (normalizedCodes.has(normalizedCode)) {
                console.log(`❌ Duplicate in import data: ${viTri} (normalized: ${normalizedCode})`);
                continue;
              }
              
              // Check for duplicates with existing data
              const existingDuplicate = this.locationItems.find(item => {
                const normalizedExistingViTri = this.normalizeLocationCode(item.viTri);
                return normalizedExistingViTri === normalizedCode;
              });
              
              if (existingDuplicate) {
                console.log(`❌ Duplicate with existing: ${viTri} vs ${existingDuplicate.viTri} (both normalized to: ${normalizedCode})`);
                continue;
              }
              
              normalizedCodes.add(normalizedCode);
              locations.push({
                stt: 0, // Will be auto-assigned
                viTri: viTri,
                qrCode: this.generateQRCode(viTri),
                printCount: 0,
                createdAt: new Date()
              });
              console.log(`✅ Valid location added: ${viTri} (normalized: ${normalizedCode})`);
            } else {
              console.log(`❌ Invalid location format: ${viTri}`);
            }
          } else {
            console.log(`⚠️ Empty row ${i + 1}, skipping`);
          }
        }
        
        console.log(`📊 Total valid locations found: ${locations.length}`);
        
        if (locations.length > 0) {
          this.saveImportedLocations(locations);
        } else {
          alert('Không tìm thấy dữ liệu hợp lệ để import. Vui lòng kiểm tra:\n- Dòng 1 phải là tiêu đề "Vị trí"\n- Từ dòng 2 trở đi phải có dữ liệu vị trí\n- Định dạng vị trí chỉ được chứa chữ cái, số, dấu chấm (.), dấu gạch ngang (-) và dấu ngoặc đơn ()');
        }
      } catch (error) {
        console.error('Error processing file:', error);
        alert('Lỗi khi đọc file. Vui lòng kiểm tra định dạng file.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // Save imported locations to database
  // IMPORTANT: This function ADDS new locations to existing data, does NOT replace existing data
  private saveImportedLocations(locations: Omit<LocationItem, 'id'>[]) {
    const batch = this.firestore.firestore.batch();
    
    // Add each new location as a new document (preserves existing data)
    locations.forEach(location => {
      const docRef = this.firestore.collection('locations').doc().ref;
      batch.set(docRef, location); // This ADDS new data, doesn't replace
    });
    
    batch.commit().then(() => {
      console.log(`✅ Imported ${locations.length} new locations (added to existing data)`);
      this.refreshData();
      alert(`✅ Đã import thành công ${locations.length} vị trí mới!\n\n📝 Lưu ý: Dữ liệu mới được THÊM VÀO dữ liệu cũ, không thay thế dữ liệu cũ.`);
    }).catch(error => {
      console.error('Error importing locations:', error);
      alert('Lỗi khi import dữ liệu. Vui lòng thử lại.');
    });
  }

  // Download template file
  downloadTemplate() {
    try {
      const templateData = [
        ['Vị trí'], // Tiêu đề cột
        ['A1-01'],  // Dòng 2 - sẽ được import
        ['A1-02'],  // Dòng 3 - sẽ được import
        ['A2-01'],  // Dòng 4 - sẽ được import
        ['A2-02'],  // Dòng 5 - sẽ được import
        ['B1-01'],  // Dòng 6 - sẽ được import
        ['B1-02'],  // Dòng 7 - sẽ được import
        ['B2-01'],  // Dòng 8 - sẽ được import
        ['C1-01'],  // Dòng 9 - sẽ được import
        ['C1-02'],  // Dòng 10 - sẽ được import
        ['D1.01'],  // Dòng 11 - ví dụ với dấu chấm
        ['D1.02'],  // Dòng 12 - ví dụ với dấu chấm
        ['E1(01)'], // Dòng 13 - ví dụ với dấu ngoặc đơn
        ['E1(02)'], // Dòng 14 - ví dụ với dấu ngoặc đơn
        ['F1-01.02'], // Dòng 15 - ví dụ kết hợp dấu gạch ngang và chấm
        ['G1(01)-02'] // Dòng 16 - ví dụ kết hợp dấu ngoặc đơn và gạch ngang
      ];

      const ws: XLSX.WorkSheet = XLSX.utils.aoa_to_sheet(templateData);
      const wb: XLSX.WorkBook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Location Template');
      
      XLSX.writeFile(wb, 'Location_Template.xlsx');
    } catch (error) {
      console.error('Error creating template:', error);
      alert('Lỗi khi tạo template. Vui lòng thử lại.');
    }
  }

  // Delete all locations
  deleteAllLocations() {
    if (confirm('Bạn có chắc muốn xóa TẤT CẢ vị trí? Hành động này không thể hoàn tác!')) {
      this.firestore.collection('locations').get().subscribe(snapshot => {
        const batch = this.firestore.firestore.batch();
        snapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });
        
        batch.commit().then(() => {
          console.log('All locations deleted');
          this.refreshData();
          alert('Đã xóa tất cả vị trí');
        }).catch(error => {
          console.error('Error deleting all locations:', error);
          alert('Lỗi khi xóa dữ liệu. Vui lòng thử lại.');
        });
      });
    }
  }

    // Print QR Code — tem 57×32mm hoặc 130×100mm
  async printQRCode(item: LocationItem, labelSize?: '57x32' | '130x100'): Promise<void> {
    const size = labelSize || this.selectedQrLabelSize;
    try {
      const newPrintCount = (item.printCount ?? 0) + 1;
      if (item.id) {
        this.firestore.collection('locations').doc(item.id).update({ printCount: newPrintCount }).catch(err => console.error('Error updating printCount:', err));
      }
      item.printCount = newPrintCount;

      const qrImage = await QRCode.toDataURL(item.viTri, {
        width: size === '130x100' ? 600 : 280,
        margin: 1,
        color: { dark: '#000000', light: '#FFFFFF' }
      });

      const locationHtml = this.formatLocationLabelHtml(item.viTri);
      const dateStr = this.formatLocationLabelDate(item);
      const printContent = size === '130x100'
        ? this.buildLocationQrLabel130x100(qrImage, locationHtml, dateStr, item.viTri)
        : this.buildLocationQrLabel57x32(qrImage, locationHtml, dateStr, item.viTri);

      const pageCss = size === '130x100'
        ? this.getLocationQrPrintPageCss130x100()
        : this.getLocationQrPrintPageCss57x32();

      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('Không thể mở cửa sổ in. Vui lòng cho phép popup.');
        return;
      }

      printWindow.document.write(`
        <html>
          <head>
            <title>Location QR - ${item.viTri} (${size})</title>
            <style>${pageCss}</style>
          </head>
          <body>
            ${printContent}
            <div class="no-print loc-qr-print-actions">
              <button type="button" onclick="window.print()">In tem QR</button>
              <button type="button" onclick="window.close()">Đóng</button>
            </div>
          </body>
        </html>
      `);
      printWindow.document.close();
    } catch (error) {
      console.error('Error generating QR code:', error);
      alert('Lỗi khi tạo mã QR. Vui lòng thử lại.');
    }
  }

  setQrLabelSize(size: '57x32' | '130x100'): void {
    this.selectedQrLabelSize = size;
  }

  private formatLocationLabelHtml(viTri: string): string {
    const m = viTri.match(/^(LOCKER)\s*(\d+)$/i);
    return m ? `${m[1].toUpperCase()}<br>${m[2]}` : viTri;
  }

  private formatLocationLabelDate(item: LocationItem): string {
    const d = item.createdAt ? new Date(item.createdAt) : new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}${mm}${yy}`;
  }

  private buildLocationQrLabel57x32(qrImage: string, locationHtml: string, dateStr: string, viTri: string): string {
    return `
      <div class="qr-label qr-label--57">
        <div class="qr-section">
          <img src="${qrImage}" alt="QR ${viTri}" class="qr-image" title="QR: ${viTri}">
        </div>
        <div class="location-section">
          <div class="location-text">${locationHtml}</div>
          <div class="location-date">${dateStr}</div>
        </div>
      </div>
    `;
  }

  private buildLocationQrLabel130x100(qrImage: string, locationHtml: string, dateStr: string, viTri: string): string {
    return `
      <div class="qr-label qr-label--130">
        <div class="location-section">
          <div class="location-text">${locationHtml}</div>
          <div class="location-date">${dateStr}</div>
        </div>
        <div class="qr-section">
          <img src="${qrImage}" alt="QR ${viTri}" class="qr-image" title="QR: ${viTri}">
        </div>
      </div>
    `;
  }

  private getLocationQrPrintPageCss57x32(): string {
    return `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        margin: 0;
        padding: 0;
        font-family: Arial, sans-serif;
        background: #f0f0f0;
        width: 57mm;
        height: 32mm;
      }
      .qr-label--57 {
        width: 57mm;
        height: 32mm;
        border: 1px solid #000;
        display: flex;
        align-items: stretch;
        background: #fff;
        overflow: hidden;
      }
      .qr-label--57 .qr-section {
        width: 30mm;
        height: 32mm;
        display: flex;
        align-items: center;
        justify-content: center;
        border-right: 1px solid #ccc;
        flex-shrink: 0;
      }
      .qr-label--57 .qr-image {
        width: 28mm;
        height: 28mm;
        object-fit: contain;
        display: block;
      }
      .qr-label--57 .location-section {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 1mm 2mm;
        gap: 1mm;
        text-align: center;
      }
      .qr-label--57 .location-text {
        font-size: 16px;
        font-weight: bold;
        line-height: 1.15;
        word-break: break-word;
        color: #000;
      }
      .qr-label--57 .location-date {
        font-size: 10px;
        color: #000;
      }
      .loc-qr-print-actions {
        margin-top: 12px;
        text-align: center;
      }
      .loc-qr-print-actions button {
        margin: 0 6px;
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        background: #007bff;
        color: #fff;
      }
      .loc-qr-print-actions button:last-child { background: #6c757d; }
      @media print {
        body { margin: 0 !important; padding: 0 !important; background: #fff !important; width: 57mm !important; height: 32mm !important; }
        @page { margin: 0; size: 57mm 32mm; }
        .no-print { display: none !important; }
        .qr-label--57 { box-shadow: none; border: 1px solid #000 !important; }
      }
    `;
  }

  private getLocationQrPrintPageCss130x100(): string {
    return `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: 130mm;
        height: 100mm;
        margin: 0;
        padding: 0;
        font-family: Arial, sans-serif;
        background: #fff;
      }
      .qr-label--130 {
        width: 130mm;
        height: 100mm;
        border: 1px solid #000;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 5mm;
        padding: 4mm;
        background: #fff;
        overflow: hidden;
        box-sizing: border-box;
      }
      .qr-label--130 .location-section {
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        flex-shrink: 0;
      }
      .qr-label--130 .location-text {
        font-size: 42px;
        font-weight: bold;
        line-height: 1.1;
        word-break: break-word;
        color: #000;
      }
      .qr-label--130 .location-date {
        margin-top: 2mm;
        font-size: 20px;
        color: #000;
      }
      .qr-label--130 .qr-section {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .qr-label--130 .qr-image {
        width: 62mm;
        height: 62mm;
        object-fit: contain;
        display: block;
      }
      .loc-qr-print-actions {
        margin-top: 12px;
        text-align: center;
      }
      .loc-qr-print-actions button {
        margin: 0 6px;
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        background: #007bff;
        color: #fff;
      }
      .loc-qr-print-actions button:last-child { background: #6c757d; }
      @media print {
        body { margin: 0 !important; padding: 0 !important; overflow: hidden; }
        @page { margin: 0; size: 130mm 100mm; }
        .no-print { display: none !important; }
        .qr-label--130 {
          width: 130mm !important;
          height: 100mm !important;
          page-break-inside: avoid;
        }
      }
    `;
  }

  trackByFn(index: number, item: LocationItem): string {
    return item.id || index.toString();
  }

  trackByFG(index: number, item: FGLocation): string {
    return item.id || index.toString();
  }

  // Store Material (Cất NVL) Functions

  /** Parse importDate từ Firestore (Date, Timestamp, chuỗi DDMMYYYY…). */
  private parseImportDateForStore(importDate: unknown): Date | null {
    if (!importDate) return null;
    if (importDate instanceof Date) {
      return Number.isNaN(importDate.getTime()) ? null : importDate;
    }
    if (typeof importDate === 'object' && importDate !== null && 'toDate' in importDate) {
      try {
        const d = (importDate as { toDate: () => Date }).toDate();
        return Number.isNaN(d.getTime()) ? null : d;
      } catch {
        return null;
      }
    }
    if (typeof importDate === 'object' && importDate !== null && 'seconds' in importDate) {
      const d = new Date(Number((importDate as { seconds: number }).seconds) * 1000);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof importDate === 'string') {
      const t = importDate.trim();
      if (/^\d{8,10}$/.test(t)) {
        const day = t.substring(0, 2);
        const month = t.substring(2, 4);
        const year = t.substring(4, 8);
        const d = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
        return Number.isNaN(d.getTime()) ? null : d;
      }
      if (t.includes('/') || t.includes('-')) {
        const parts = t.split(/[/-]/);
        if (parts.length === 3) {
          const d = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
          return Number.isNaN(d.getTime()) ? null : d;
        }
      }
      const parsed = new Date(t);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    if (typeof importDate === 'number') {
      const d = new Date(importDate);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  /** Trích IMD key từ part4 QR — bỏ phần bịch "-x/y" nếu có. */
  private extractImdKeyFromPart4(part4: string): string {
    const t = (part4 || '').trim();
    const di = t.indexOf('-');
    return di >= 0 ? t.slice(0, di).trim() : t;
  }

  /** IMD hiển thị/khớp tồn kho — đồng bộ logic QC/Materials (batchNumber 10 số). */
  private getInventoryImdKeyForStore(data: Record<string, unknown>): string {
    const batchNumber = String(data?.batchNumber ?? '').trim();
    const rawImport = String(data?.importDate ?? '').trim();

    if (/^\d{10}$/.test(rawImport)) return rawImport;
    if (/^\d{10}$/.test(batchNumber)) return batchNumber;

    const importDate = this.parseImportDateForStore(data?.importDate);
    const baseDate = importDate
      ? importDate.toLocaleDateString('en-GB').split('/').join('')
      : (/^\d{8}$/.test(rawImport) ? rawImport : '');

    if (!baseDate) {
      const m = /^(\d{8,10})/.exec(batchNumber);
      return m?.[1] || '';
    }

    if (batchNumber && batchNumber !== baseDate) {
      if (/^\d{10}$/.test(batchNumber) && batchNumber.startsWith(baseDate)) {
        return batchNumber;
      }
      if (batchNumber.startsWith(baseDate)) {
        const suffix = batchNumber.substring(baseDate.length);
        if (/^\d{1,2}$/.test(suffix)) {
          return baseDate + suffix;
        }
      }
      const m = /^(\d{8,10})/.exec(batchNumber);
      if (m) return m[1];
    }

    return baseDate;
  }

  private imdKeysMatch(scannedKey: string, inventoryKey: string): boolean {
    if (!scannedKey) return true;
    if (!inventoryKey) return false;
    if (scannedKey === inventoryKey) return true;
    return scannedKey.startsWith(inventoryKey) || inventoryKey.startsWith(scannedKey);
  }

  private poNumbersMatch(materialPo: string, scannedPo: string): boolean {
    const a = (materialPo || '').trim();
    const b = (scannedPo || '').trim();
    if (!b) return true;
    if (a === b) return true;
    return a.replace(/\s+/g, '') === b.replace(/\s+/g, '');
  }

  openStoreMaterialModal(): void {
    if (!this.selectedFactory) {
      this.showFactorySelect = true;
      return;
    }
    this.showStoreMaterialModal = true;
    this.storeMaterialStep = 'scan';
    this.storeMaterialQRInput = '';
    this.scannedMaterialCodeForStore = '';
    this.foundMaterialsForStore = [];
    this.selectedMaterialForStore = null;
    this.suggestedLocations = [];
    this.selectedTargetLocation = '';
    this.isTargetLocationForced = false;
    this.forcedAllowedDestinationPrefixes = [];
    this.isSearchingMaterial = false;
    this.storeMaterialPOStock = 0;
    this.storeMaterialStockByLocation = [];
    this.storeMaterialMultiCode = false;
    this.storeMaterialUseAsm3 = false;
    this.storeMaterialBatchItems = [];
    this.storeMaterialBatchQRInput = '';
    
    // Force change detection để đảm bảo modal đã render
    this.cdr.detectChanges();
    
    // Auto focus vào input sau khi modal mở
    setTimeout(() => {
      const input = document.getElementById('storeMaterialQRInput') as HTMLInputElement;
      if (input) {
        input.focus();
        // Không select() để người dùng có thể scan ngay
        console.log('✅ Input focused for store material');
      } else {
        console.log('⚠️ Input not found, retrying...');
        // Retry sau 200ms nếu chưa tìm thấy
        setTimeout(() => {
          const retryInput = document.getElementById('storeMaterialQRInput') as HTMLInputElement;
          if (retryInput) {
            retryInput.focus();
            console.log('✅ Input focused on retry');
          }
        }, 200);
      }
    }, 150);
  }

  closeStoreMaterialModal(): void {
    this.showStoreMaterialModal = false;
    this.storeMaterialStep = 'scan';
    this.storeMaterialQRInput = '';
    this.scannedMaterialCodeForStore = '';
    this.foundMaterialsForStore = [];
    this.selectedMaterialForStore = null;
    this.suggestedLocations = [];
    this.selectedTargetLocation = '';
    this.isTargetLocationForced = false;
    this.forcedAllowedDestinationPrefixes = [];
    this.isSearchingMaterial = false;
    this.storeMaterialPOStock = 0;
    this.storeMaterialStockByLocation = [];
    this.storeMaterialMultiCode = false;
    this.storeMaterialUseAsm3 = false;
    this.storeMaterialBatchItems = [];
    this.storeMaterialBatchQRInput = '';
  }

  get storeMaterialBatchCount(): number {
    return this.storeMaterialBatchItems.length;
  }

  get storeMaterialBatchCanAddMore(): boolean {
    return this.storeMaterialBatchCount < this.STORE_MATERIAL_BATCH_MAX;
  }

  /** Parse QR và tra inventory-materials — dùng bước 1 và thêm mã ở bước 2. */
  private async lookupStoreMaterialFromQR(qrCode: string): Promise<{
    matchedMaterial: any;
    relevantMaterials: any[];
    suggestedLocations: string[];
    imd: string;
  } | null> {
    const parts = qrCode.split('|');
      let materialCode = '';
      let poNumber = '';
      let imdKey = '';

      if (parts.length >= 2) {
        materialCode = parts[0].trim().substring(0, 7);
        poNumber = parts[1].trim();
        if (parts.length >= 4) {
          imdKey = this.extractImdKeyFromPart4(parts[3]);
        }
      } else if (parts.length >= 1) {
        materialCode = parts[0].trim().substring(0, 7);
        if (parts.length >= 4) {
          imdKey = this.extractImdKeyFromPart4(parts[3]);
        }
      } else {
        materialCode = qrCode.trim().substring(0, 7);
      }

    if (!materialCode) {
      alert('❌ Không thể đọc mã hàng từ QR code');
      return null;
    }

      // Tìm tất cả materials có materialCode này trong inventory-materials (để lấy các vị trí khác)
      const allMaterialsSnapshot = await this.firestore
        .collection('inventory-materials', ref =>
          ref.where('factory', '==', this.selectedFactory)
             .where('materialCode', '==', materialCode)
        )
        .get()
        .toPromise();

    if (!allMaterialsSnapshot || allMaterialsSnapshot.empty) {
      alert(`❌ Không tìm thấy material với mã: ${materialCode}`);
      return null;
    }

    const relevantMaterials: any[] = [];
      const locationSet = new Set<string>();
      let matchedMaterial: any = null;

      allMaterialsSnapshot.forEach(doc => {
        const data = doc.data() as Record<string, unknown>;
        
        // Tính stock đúng cách: openingStock + quantity - exported - xt
        const openingStockValue = data.openingStock !== null && data.openingStock !== undefined ? Number(data.openingStock) : 0;
        const quantity = Number(data.quantity) || 0;
        const exported = Number(data.exported) || 0;
        const xt = Number(data.xt) || 0;
        const calculatedStock = openingStockValue + quantity - exported - xt;
        
        const importDateStr = this.getInventoryImdKeyForStore(data);
        const material = {
          id: doc.id,
          materialCode: String(data.materialCode || ''),
          poNumber: String(data.poNumber || ''),
          location: String(data.location || ''),
          stock: calculatedStock,
          openingStock: data.openingStock,
          quantity: quantity,
          exported: exported,
          xt: xt,
          batchNumber: String(data.batchNumber || ''),
          importDate: data.importDate,
          importDateStr,
          iqcStatus: String(data.iqcStatus || '')
        };

        const matchesMaterialCode = material.materialCode === materialCode;
        const matchesPO = this.poNumbersMatch(material.poNumber, poNumber);
        const matchesIMD = this.imdKeysMatch(imdKey, importDateStr);

        if (matchesMaterialCode && matchesPO && matchesIMD) {
          relevantMaterials.push(material);

          if (material.location && material.location.trim() !== '') {
            locationSet.add(material.location);
          }

          if (!matchedMaterial) {
            matchedMaterial = material;
          }
        }
      });

    if (!matchedMaterial) {
      if (!poNumber) {
        alert(`❌ Không tìm thấy material khớp với QR code (Mã: ${materialCode})`);
      } else {
        const imdLine = imdKey ? `\nIMD: ${imdKey}` : '';
        alert(
          `❌ Không tìm thấy material đúng theo Mã + PO${imdKey ? ' + IMD' : ''}.\n\nMã: ${materialCode}\nPO: ${poNumber}${imdLine}`
        );
      }
      return null;
    }

    const suggestedLocations = Array.from(locationSet)
      .filter(loc => loc && loc.trim() !== '')
      .sort();

    return { matchedMaterial, relevantMaterials, suggestedLocations, imd: imdKey };
  }

  private applyStoreMaterialSelection(
    matchedMaterial: any,
    relevantMaterials: any[],
    suggestedLocations: string[],
    imd: string
  ): void {
    this.foundMaterialsForStore = [matchedMaterial];
    this.selectedMaterialForStore = matchedMaterial;
    this.setLastScannedMaterialForMobile(matchedMaterial);
    this.scannedIMDForStore = imd || '';
    this.storeMaterialPOStock = matchedMaterial.stock ?? 0;

    const stockByLoc = new Map<string, number>();
    relevantMaterials.forEach(m => {
      const loc = (m.location || '').trim();
      if (!loc) return;
      const current = stockByLoc.get(loc) ?? 0;
      stockByLoc.set(loc, current + (m.stock ?? 0));
    });
    this.storeMaterialStockByLocation = Array.from(stockByLoc.entries())
      .map(([location, stock]) => ({ location, stock }))
      .sort((a, b) => a.location.localeCompare(b.location));

    this.suggestedLocations = suggestedLocations;
  }

  onStoreMaterialMultiCodeChange(): void {
    if (this.storeMaterialMultiCode) {
      this.initStoreMaterialBatchFromSelection();
      setTimeout(() => this.focusStoreMaterialBatchInput(), 150);
    } else {
      this.storeMaterialBatchItems = [];
      this.storeMaterialBatchQRInput = '';
      setTimeout(() => {
        const locationInput = document.querySelector('.location-input') as HTMLInputElement;
        locationInput?.focus();
      }, 150);
    }
  }

  private initStoreMaterialBatchFromSelection(): void {
    if (!this.selectedMaterialForStore?.id) {
      this.storeMaterialBatchItems = [];
      return;
    }
    const id = this.selectedMaterialForStore.id;
    if (!this.storeMaterialBatchItems.some(m => m.id === id)) {
      this.storeMaterialBatchItems = [{ ...this.selectedMaterialForStore }];
    }
  }

  removeStoreMaterialBatchItem(materialId: string): void {
    if (!this.storeMaterialMultiCode) return;
    const next = this.storeMaterialBatchItems.filter(m => m.id !== materialId);
    if (next.length === 0) {
      alert('⚠️ Cần ít nhất 1 mã trong danh sách. Tắt "Nhiều mã" nếu chỉ đổi một mã.');
      return;
    }
    this.storeMaterialBatchItems = next;
    if (this.selectedMaterialForStore?.id === materialId) {
      this.selectedMaterialForStore = next[0];
      this.applyStoreMaterialSelection(next[0], [next[0]], this.suggestedLocations, this.scannedIMDForStore);
      this.applyLocationRuleToSelectedMaterial();
    }
  }

  private focusStoreMaterialBatchInput(): void {
    const input = document.getElementById('storeMaterialBatchQRInput') as HTMLInputElement;
    input?.focus();
  }

  async processStoreMaterialBatchQR(): Promise<void> {
    if (!this.storeMaterialMultiCode) return;
    if (!this.storeMaterialBatchCanAddMore) {
      alert(`⚠️ Đã đủ ${this.STORE_MATERIAL_BATCH_MAX} mã. Scan vị trí mới rồi xác nhận.`);
      return;
    }
    const qrCode = this.storeMaterialBatchQRInput.trim();
    if (!qrCode) {
      alert('⚠️ Vui lòng scan mã QR tiếp theo');
      return;
    }

    this.isSearchingMaterial = true;
    try {
      const result = await this.lookupStoreMaterialFromQR(qrCode);
      if (!result) return;

      const { matchedMaterial } = result;
      if (this.storeMaterialBatchItems.some(m => m.id === matchedMaterial.id)) {
        alert(`⚠️ Mã đã có trong danh sách: ${matchedMaterial.materialCode} (PO: ${matchedMaterial.poNumber})`);
        this.storeMaterialBatchQRInput = '';
        this.focusStoreMaterialBatchInput();
        return;
      }
      this.storeMaterialBatchItems = [...this.storeMaterialBatchItems, matchedMaterial];
      this.storeMaterialBatchQRInput = '';
      if (!this.storeMaterialBatchCanAddMore) {
        setTimeout(() => {
          const locationInput = document.querySelector('.location-input') as HTMLInputElement;
          locationInput?.focus();
        }, 150);
      } else {
        this.focusStoreMaterialBatchInput();
      }
    } catch (error) {
      console.error('❌ Error adding batch material:', error);
      alert(`❌ Lỗi khi thêm mã: ${error}`);
    } finally {
      this.isSearchingMaterial = false;
    }
  }

  async processStoreMaterialQR(): Promise<void> {
    if (!this.selectedFactory) {
      this.showFactorySelect = true;
      alert('Vui lòng chọn ASM1 hoặc ASM2 trước');
      return;
    }
    const qrCode = this.storeMaterialQRInput.trim();
    if (!qrCode) {
      alert('⚠️ Vui lòng nhập hoặc scan mã QR');
      return;
    }

    this.isSearchingMaterial = true;
    this.scannedMaterialCodeForStore = qrCode;
    this.scannedIMDForStore = '';

    try {
      const result = await this.lookupStoreMaterialFromQR(qrCode);
      if (!result) return;

      const { matchedMaterial, relevantMaterials, suggestedLocations, imd } = result;
      this.applyStoreMaterialSelection(matchedMaterial, relevantMaterials, suggestedLocations, imd);

      this.storeMaterialStep = 'choose-location';
      this.selectedTargetLocation = '';
      this.storeMaterialMultiCode = false;
      this.storeMaterialUseAsm3 = false;
      this.storeMaterialBatchItems = [];
      this.storeMaterialBatchQRInput = '';
      this.applyLocationRuleToSelectedMaterial();
      this.storeMaterialQRInput = '';

      setTimeout(() => {
        const locationInput = document.querySelector('.location-input') as HTMLInputElement;
        locationInput?.focus();
      }, 200);
    } catch (error) {
      console.error('❌ Error searching material:', error);
      alert(`❌ Lỗi khi tìm kiếm material: ${error}`);
    } finally {
      this.isSearchingMaterial = false;
    }
  }

  selectMaterialForStore(material: any): void {
    this.selectedMaterialForStore = material;
    this.storeMaterialStep = 'choose-location';
  }

  async confirmStoreMaterial(): Promise<void> {
    const items =
      this.storeMaterialMultiCode && this.storeMaterialBatchItems.length > 0
        ? [...this.storeMaterialBatchItems]
        : this.selectedMaterialForStore
          ? [this.selectedMaterialForStore]
          : [];

    if (items.length === 0 || !this.selectedTargetLocation.trim()) {
      alert('⚠️ Vui lòng chọn material và vị trí đích');
      return;
    }

    try {
      const targetFormatted = this.normalizeTargetLocationInput(
        this.selectedTargetLocation,
        this.storeMaterialUseAsm3
      );
      if (!targetFormatted) {
        alert('⚠️ Vị trí đích không hợp lệ');
        return;
      }

      const ruleExempt = this.isTargetRuleExempt(targetFormatted, this.storeMaterialUseAsm3);
      if (!ruleExempt && !this.validateViTriInput(targetFormatted)) {
        alert('⚠️ Vị trí đích không hợp lệ');
        return;
      }

      const updates: { item: any; fromLocation: string; targetFormatted: string }[] = [];

      for (const item of items) {
        const fromLocation = String(item.location ?? '').trim();

        if (
          !this.materialLocationPassesRules(item.materialCode || '', targetFormatted, {
            ruleExempt,
            useAsm3: this.storeMaterialUseAsm3
          })
        ) {
          alert(this.LOCATION_RULE_ERROR);
          return;
        }

        updates.push({ item, fromLocation, targetFormatted });
      }

      for (const { item, fromLocation, targetFormatted } of updates) {
        await this.firestore.collection('inventory-materials').doc(item.id).update({
          location: targetFormatted,
          lastModified: new Date(),
          modifiedBy: 'store-material-scanner'
        });

        await this.logMaterialLocationChange({
          materialId: item.id,
          materialCode: item.materialCode || '',
          poNumber: item.poNumber || '',
          fromLocation,
          toLocation: targetFormatted,
          changeType: 'store'
        });
      }

      const last = updates[updates.length - 1];
      this.setLastScannedMaterialForMobile({
        ...last.item,
        location: last.targetFormatted
      });

      if (updates.length === 1) {
        const u = updates[0];
        alert(
          `✅ Đã cất material thành công!\n\n` +
            `Mã hàng: ${u.item.materialCode}\n` +
            `PO: ${u.item.poNumber}\n` +
            `Vị trí mới: ${u.targetFormatted}`
        );
      } else {
        alert(
          `✅ Đã chuyển ${updates.length} mã sang vị trí mới!\n\n` +
            `Vị trí: ${targetFormatted}\n` +
            updates.map(u => `• ${u.item.materialCode} (PO: ${u.item.poNumber})`).join('\n')
        );
      }

      this.closeStoreMaterialModal();
    } catch (error) {
      console.error('❌ Error storing material:', error);
      alert(`❌ Lỗi khi cất material: ${error}`);
    }
  }

  // ==================== CUSTOMER CODE METHODS ====================

  // Import Customer Codes
  importCustomerCodes() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = (event: any) => {
      const file = event.target.files[0];
      if (file) {
        this.processImportCustomerFile(file);
      }
    };
    input.click();
  }

  // Process imported customer file
  private processImportCustomerFile(file: File) {
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        console.log('📋 Imported customer data:', jsonData);
        console.log('ℹ️ IMPORT MODE: New codes will OVERWRITE existing codes');
        
        // Skip header row (row 1) and process all data from row 2 onwards
        const customers = [];
        const codes = new Set<string>(); // Track codes to prevent duplicates within import file
        
        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i] as any[];
          if (row && row.length >= 4 && row[0] && row[0].toString().trim()) {
            const no = parseInt(row[0].toString().trim()) || i;
            const customer = row[1] ? row[1].toString().trim() : '';
            const group = row[2] ? row[2].toString().trim() : '';
            const code = row[3] ? row[3].toString().trim() : '';
            
            if (customer && code) {
              // Check for duplicates within import data only (use last occurrence)
              if (codes.has(code)) {
                console.log(`⚠️ Duplicate in import file: ${code} - Will use last occurrence`);
                // Remove previous entry with same code
                const existingIndex = customers.findIndex(c => c.code === code);
                if (existingIndex >= 0) {
                  customers.splice(existingIndex, 1);
                }
              }
              
              // Check if code exists in database
              const existingItem = this.customerCodes.find(item => item.code === code);
              if (existingItem) {
                console.log(`🔄 Code exists in database: ${code} - Will UPDATE`);
                customers.push({
                  id: existingItem.id, // Keep existing ID to update
                  no: no,
                  customer: customer,
                  group: group || '',
                  code: code,
                  updatedAt: new Date()
                });
              } else {
                console.log(`✅ New code: ${code} - Will ADD`);
                customers.push({
                  no: no,
                  customer: customer,
                  group: group || '',
                  code: code,
                  createdAt: new Date()
                });
              }
              
              codes.add(code);
            }
          }
        }
        
        console.log(`📊 Total valid customers: ${customers.length} (includes both new and updates)`);
        
        if (customers.length > 0) {
          this.saveImportedCustomerCodes(customers);
        } else {
          alert('Không tìm thấy dữ liệu hợp lệ để import. Vui lòng kiểm tra:\n- Dòng 1 phải là tiêu đề: No, Customer, Group, Code\n- Từ dòng 2 trở đi phải có dữ liệu đầy đủ');
        }
      } catch (error) {
        console.error('Error processing customer file:', error);
        alert('Lỗi khi đọc file. Vui lòng kiểm tra định dạng file.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // Save imported customer codes to database (ADD new or UPDATE existing)
  private saveImportedCustomerCodes(customers: any[]) {
    const batch = this.firestore.firestore.batch();
    let addCount = 0;
    let updateCount = 0;
    
    customers.forEach(customer => {
      if (customer.id) {
        // UPDATE existing document
        const docRef = this.firestore.collection('customer-codes').doc(customer.id).ref;
        const updateData = {
          no: customer.no,
          customer: customer.customer,
          group: customer.group,
          code: customer.code,
          updatedAt: new Date()
        };
        batch.update(docRef, updateData);
        updateCount++;
        console.log(`🔄 Updating: ${customer.code}`);
      } else {
        // ADD new document
        const docRef = this.firestore.collection('customer-codes').doc().ref;
        const newData = {
          no: customer.no,
          customer: customer.customer,
          group: customer.group,
          code: customer.code,
          createdAt: new Date()
        };
        batch.set(docRef, newData);
        addCount++;
        console.log(`➕ Adding: ${customer.code}`);
      }
    });
    
    batch.commit().then(() => {
      console.log(`✅ Import complete: ${addCount} added, ${updateCount} updated`);
      alert(`✅ Import thành công!\n- Thêm mới: ${addCount} mã\n- Cập nhật: ${updateCount} mã\n- Tổng: ${customers.length} mã`);
      this.loadCustomerCodes();
    }).catch(error => {
      console.error('Error importing customer codes:', error);
      alert('Lỗi khi import dữ liệu. Vui lòng thử lại.');
    });
  }

  // Delete single customer code
  deleteCustomerCode(customer: CustomerCode) {
    if (!confirm(`⚠️ Xóa mã khách hàng?\n\nCustomer: ${customer.customer}\nCode: ${customer.code}\n\nBạn có chắc muốn xóa?`)) {
      return;
    }

    if (!customer.id) {
      alert('❌ Không tìm thấy ID của mã khách hàng!');
      return;
    }

    this.firestore.collection('customer-codes').doc(customer.id).delete()
      .then(() => {
        console.log(`✅ Deleted customer code: ${customer.code}`);
        alert(`✅ Đã xóa mã khách hàng: ${customer.code}`);
        // Data will auto-reload via subscription in loadCustomerCodes()
      })
      .catch(error => {
        console.error('❌ Error deleting customer code:', error);
        alert('Lỗi khi xóa. Vui lòng thử lại.');
      });
  }

  // Load customer codes from database
  loadCustomerCodes() {
    this.firestore.collection('customer-codes', ref => ref.orderBy('no', 'asc'))
      .get()
      .pipe(take(1), takeUntil(this.destroy$))
      .subscribe(snapshot => {
        this.customerCodes = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data() as CustomerCode
        }));
        this.filteredCustomerCodes = [...this.customerCodes];
      });
  }

  // Download customer code template
  downloadCustomerTemplate() {
    try {
      const templateData = [
        ['No', 'Customer', 'Group', 'Code'], // Header row
        [1, 'Customer A', 'Group 1', 'CUST001'],
        [2, 'Customer B', 'Group 1', 'CUST002'],
        [3, 'Customer C', 'Group 2', 'CUST003'],
        [4, 'Customer D', 'Group 2', 'CUST004'],
        [5, 'Customer E', 'Group 3', 'CUST005']
      ];

      const ws: XLSX.WorkSheet = XLSX.utils.aoa_to_sheet(templateData);
      const wb: XLSX.WorkBook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Customer Code Template');
      
      XLSX.writeFile(wb, 'Customer_Code_Template.xlsx');
    } catch (error) {
      console.error('Error creating customer template:', error);
      alert('Lỗi khi tạo template. Vui lòng thử lại.');
    }
  }

  // ==================== FG LOCATION METHODS ====================

  // Open FG Location Modal
  openFGModal() {
    this.showFGModal = true;
    this.loadFGLocations();
    this.isDropdownOpen = false;
  }

  // Close FG Location Modal
  closeFGModal() {
    this.showFGModal = false;
    this.fgSearchTerm = '';
    this.filteredFGLocations = [...this.fgLocations];
  }

  // Load FG Locations from database
  loadFGLocations() {
    this.firestore.collection('fg-locations', ref => ref.orderBy('stt', 'asc'))
      .get()
      .pipe(take(1), takeUntil(this.destroy$))
      .subscribe(snapshot => {
        this.fgLocations = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data() as FGLocation
        }));
        this.filteredFGLocations = [...this.fgLocations];
      });
  }

  // Search FG Locations
  onFGSearchInput(event: any) {
    const term = event.target.value.toLowerCase();
    this.fgSearchTerm = term;
    
    if (!term || term.trim().length < 1) {
      this.filteredFGLocations = [...this.fgLocations];
    } else {
      this.filteredFGLocations = this.fgLocations.filter(item => {
        return (
          item.stt.toString().includes(term) ||
          item.viTri.toLowerCase().includes(term) ||
          item.qrCode.toLowerCase().includes(term)
        );
      });
    }
  }

  // Clear FG Search
  clearFGSearch() {
    this.fgSearchTerm = '';
    this.filteredFGLocations = [...this.fgLocations];
  }

  // ==================== CUSTOMER MODAL METHODS ====================

  // Open Customer Modal
  openCustomerModal() {
    this.showCustomerModal = true;
    this.loadCustomerCodes();
  }

  // Close Customer Modal
  closeCustomerModal() {
    this.showCustomerModal = false;
    this.customerSearchTerm = '';
    this.filteredCustomerCodes = [...this.customerCodes];
  }

  // Search Customer Codes
  onCustomerSearchInput(event: any) {
    const term = event.target.value.toLowerCase();
    this.customerSearchTerm = term;
    
    if (!term || term.trim().length < 1) {
      this.filteredCustomerCodes = [...this.customerCodes];
    } else {
      this.filteredCustomerCodes = this.customerCodes.filter(item => {
        return (
          item.no.toString().includes(term) ||
          item.customer.toLowerCase().includes(term) ||
          item.group.toLowerCase().includes(term) ||
          item.code.toLowerCase().includes(term)
        );
      });
    }
  }

  // Clear Customer Search
  clearCustomerSearch() {
    this.customerSearchTerm = '';
    this.filteredCustomerCodes = [...this.customerCodes];
  }

  // ==================== MOVE SHELF (DỜI KỆ) METHODS ====================

  openMoveShelfModal(): void {
    this.showMoveShelfModal = true;
    this.moveShelfStep = 'scan-location';
    this.moveShelfCurrentLocation = '';
    this.moveShelfNewLocation = '';
    this.moveShelfItems = [];
    this.moveShelfSelectedItems = new Set();
    this.isMoveShelfLoading = false;
    
    // Auto focus input
    setTimeout(() => {
      const input = document.getElementById('moveShelfLocationInput') as HTMLInputElement;
      if (input) input.focus();
    }, 150);
  }

  closeMoveShelfModal(): void {
    this.showMoveShelfModal = false;
    this.moveShelfStep = 'scan-location';
    this.moveShelfCurrentLocation = '';
    this.moveShelfNewLocation = '';
    this.moveShelfItems = [];
    this.moveShelfSelectedItems = new Set();
    this.isMoveShelfLoading = false;
  }

  // ==================== BULK CHANGE LOCATION (ASM1) METHODS ====================
  openBulkChangeLocationModal(): void {
    if (!this.selectedFactory) {
      this.showFactorySelect = true;
      return;
    }
    this.showBulkChangeLocationModal = true;
    this.bulkStep = 'scan-location';
    this.bulkScanLocationInput = '';
    this.bulkCurrentLocation = '';
    this.bulkItems = [];
    this.bulkSelectedItems = new Set();
    this.isBulkLoading = false;
    this.bulkNewLocationInput = '';
    this.bulkNewPalletInput = '';
    this.skipBulkNewLocation = false;
    this.skipBulkNewPallet = false;
    this.bulkUseAsm3 = false;

    setTimeout(() => {
      const input = document.getElementById('bulkAsm1LocationInput') as HTMLInputElement;
      if (input) input.focus();
    }, 150);
  }

  closeBulkChangeLocationModal(): void {
    this.showBulkChangeLocationModal = false;
    this.bulkStep = 'scan-location';
    this.bulkScanLocationInput = '';
    this.bulkCurrentLocation = '';
    this.bulkItems = [];
    this.bulkSelectedItems = new Set();
    this.isBulkLoading = false;
    this.bulkNewLocationInput = '';
    this.bulkNewPalletInput = '';
    this.skipBulkNewLocation = false;
    this.skipBulkNewPallet = false;
    this.bulkUseAsm3 = false;
  }

  async processBulkAsm1Location(): Promise<void> {
    if (!this.selectedFactory) {
      this.showFactorySelect = true;
      alert('Vui lòng chọn ASM1 hoặc ASM2 trước');
      return;
    }
    // Bulk ASM1: location có thể chứa prefix "IQC+" nên không dùng formatViTriInput (vì hàm đó loại bỏ dấu '+')
    const raw = (this.bulkScanLocationInput || '').trim();
    const loc = raw
      .replace(/\s+/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9.\-()+]/g, '');
    if (!loc) {
      alert(`⚠️ Vui lòng scan vị trí (${this.selectedFactory})`);
      return;
    }

    this.isBulkLoading = true;
    this.bulkCurrentLocation = loc;
    this.bulkItems = [];
    this.bulkSelectedItems.clear();

    try {
      const toDDMMYYYY = (dateValue: any): string => {
        if (!dateValue) return '';
        try {
          const d: Date =
            typeof dateValue?.toDate === 'function' ? dateValue.toDate() : new Date(dateValue);
          if (Number.isNaN(d.getTime())) return '';
          return d.toLocaleDateString('en-GB').split('/').join('');
        } catch {
          return '';
        }
      };

      const queryByLocation = async (location: string) => {
        return await this.firestore
          .collection('inventory-materials', ref =>
            ref.where('factory', '==', this.selectedFactory).where('location', '==', location)
          )
          .get()
          .toPromise();
      };

      let snapshot = await queryByLocation(loc);
      let usedLoc = loc;

      // Nếu scan dạng F1-0001..F1-9999 mà không có -> tự thử với IQC+F1-xxxx
      const f1Match = loc.match(/^F1-(\d{4})$/);
      if ((!snapshot || snapshot.empty) && f1Match) {
        const num = parseInt(f1Match[1], 10);
        if (num >= 1 && num <= 9999) {
          const iqcLoc = `IQC+${loc}`;
          const s2 = await queryByLocation(iqcLoc);
          if (s2 && !s2.empty) {
            snapshot = s2;
            usedLoc = iqcLoc;
          }
        }
      }

      if (!snapshot || snapshot.empty) {
        alert(`❌ Không tìm thấy mã hàng nào ở vị trí: ${loc}`);
        this.isBulkLoading = false;
        return;
      }

      // Nếu tìm thấy theo IQC+ thì hiển thị đúng vị trí đang dùng
      this.bulkCurrentLocation = usedLoc;

      const items: any[] = [];
      snapshot.forEach(doc => {
        const data = doc.data() as any;
        const openingStock = Number(data.openingStock) || 0;
        const quantity = Number(data.quantity) || 0;
        const exported = Number(data.exported) || 0;
        const xt = Number(data.xt) || 0;
        const stock = openingStock + quantity - exported - xt;
        const importDateStr = toDDMMYYYY(data.importDate);
        items.push({
          id: doc.id,
          materialCode: data.materialCode || '',
          poNumber: data.poNumber || '',
          importDateStr,
          iqcStatus: data.iqcStatus || '',
          stock,
          location: data.location || '',
          palletId: (data.palletId || '').toString().toUpperCase()
        });
      });

      items.sort((a, b) => (a.materialCode || '').localeCompare(b.materialCode || ''));
      this.bulkItems = items;
      this.bulkStep = 'select-items';
    } catch (error) {
      console.error(`❌ Error loading ${this.selectedFactory} items by location:`, error);
      alert('❌ Lỗi khi tải mã hàng theo vị trí. Vui lòng thử lại.');
    } finally {
      this.isBulkLoading = false;
    }
  }

  toggleBulkItem(itemId: string): void {
    if (this.bulkSelectedItems.has(itemId)) this.bulkSelectedItems.delete(itemId);
    else this.bulkSelectedItems.add(itemId);
  }

  bulkSelectAll(): void {
    if (this.bulkSelectedItems.size === this.bulkItems.length) {
      this.bulkSelectedItems.clear();
      return;
    }
    this.bulkItems.forEach(i => this.bulkSelectedItems.add(i.id));
  }

  isBulkItemSelected(itemId: string): boolean {
    return this.bulkSelectedItems.has(itemId);
  }

  proceedToBulkTargets(): void {
    if (this.bulkSelectedItems.size === 0) {
      alert('⚠️ Vui lòng chọn ít nhất 1 mã hàng');
      return;
    }
    this.bulkStep = 'scan-targets';
    this.bulkNewLocationInput = '';
    this.bulkNewPalletInput = '';
    this.skipBulkNewLocation = false;
    this.skipBulkNewPallet = false;
    this.bulkUseAsm3 = false;

    setTimeout(() => {
      const input = document.getElementById('bulkAsm1NewLocationInput') as HTMLInputElement;
      if (input) input.focus();
    }, 150);
  }

  canConfirmBulkTargets(): boolean {
    const locOk = this.skipBulkNewLocation || (this.bulkNewLocationInput || '').trim().length > 0;
    const palletOk = this.skipBulkNewPallet || (this.bulkNewPalletInput || '').trim().length > 0;
    const bothSkipped = this.skipBulkNewLocation && this.skipBulkNewPallet;
    return locOk && palletOk && !bothSkipped; // Ít nhất phải có vị trí hoặc pallet (không bỏ qua cả hai)
  }

  /** Focus vào ô scan pallet mới (sau khi scan xong vị trí hoặc bỏ qua vị trí). */
  focusBulkPalletInput(): void {
    this.cdr.detectChanges();
    setTimeout(() => {
      const el = document.getElementById('bulkAsm1NewPalletInput') as HTMLInputElement;
      if (el) el.focus();
    }, 50);
  }

  /** Enter ở ô vị trí mới: nhảy sang ô scan pallet mới (không confirm ngay). */
  onBulkLocationEnter(): void {
    if (this.skipBulkNewPallet) {
      this.confirmBulkChange();
      return;
    }
    this.focusBulkPalletInput();
  }

  /** Bỏ qua vị trí mới được tick: nhảy focus sang ô pallet. */
  onSkipBulkLocationChange(): void {
    if (this.skipBulkNewLocation) {
      this.bulkUseAsm3 = false;
      this.focusBulkPalletInput();
    }
  }

  async confirmBulkChange(): Promise<void> {
    if (!this.canConfirmBulkTargets()) {
      alert('⚠️ Vui lòng scan đủ thông tin hoặc tick bỏ qua.');
      return;
    }

    const newLocationRaw = this.skipBulkNewLocation
      ? ''
      : this.normalizeTargetLocationInput(this.bulkNewLocationInput, this.bulkUseAsm3);
    const newPalletId = this.skipBulkNewPallet ? '' : (this.bulkNewPalletInput || '').trim().toUpperCase();

    if (!this.skipBulkNewLocation) {
      if (!newLocationRaw) {
        alert('❌ Vị trí mới không hợp lệ');
        return;
      }

      const ruleExempt = this.isTargetRuleExempt(newLocationRaw, this.bulkUseAsm3);
      if (!ruleExempt) {
        if (!this.validateViTriInput(newLocationRaw)) {
          alert('❌ Vị trí mới không hợp lệ');
          return;
        }
        const locationExists = this.locationItems.some(item =>
          this.normalizeLocationCode(item.viTri) === this.normalizeLocationCode(newLocationRaw)
        );
        if (!locationExists) {
          alert(`❌ Vị trí "${newLocationRaw}" không tồn tại trong danh sách vị trí`);
          return;
        }
      }

      const selectedIds = Array.from(this.bulkSelectedItems);
      for (const id of selectedIds) {
        const bulkItem = this.bulkItems.find(i => i.id === id);
        if (!bulkItem) continue;
        if (
          !this.materialLocationPassesRules(bulkItem.materialCode || '', newLocationRaw, {
            ruleExempt,
            useAsm3: this.bulkUseAsm3
          })
        ) {
          alert(this.LOCATION_RULE_ERROR);
          return;
        }
      }
    }

    // Khi scan cả vị trí và pallet: lưu location = "vị trí + pallet"
    const locationToSave = !this.skipBulkNewLocation && !this.skipBulkNewPallet && newLocationRaw && newPalletId
      ? `${newLocationRaw}-${newPalletId}`
      : !this.skipBulkNewLocation
        ? newLocationRaw
        : newPalletId;

    this.isBulkLoading = true;
    try {
      const batch = this.firestore.firestore.batch();
      const selectedIds = Array.from(this.bulkSelectedItems);

      const historyLogs: Array<{
        materialId: string;
        materialCode: string;
        poNumber?: string;
        fromLocation: string;
        toLocation: string;
      }> = [];

      for (const id of selectedIds) {
        const bulkItem = this.bulkItems.find(i => i.id === id);
        const fromLocation = bulkItem?.location || this.bulkCurrentLocation || '';
        const docRef = this.firestore.collection('inventory-materials').doc(id).ref;
        const updateData: any = {
          lastModified: new Date(),
          modifiedBy: `bulk-change-location-${(this.selectedFactory || 'unknown').toLowerCase()}`
        };
        if (!this.skipBulkNewLocation || !this.skipBulkNewPallet) {
          updateData.location = locationToSave;
          if (!this.skipBulkNewPallet) updateData.palletId = newPalletId;
        }
        batch.update(docRef, updateData);
        if (bulkItem && (!this.skipBulkNewLocation || !this.skipBulkNewPallet)) {
          historyLogs.push({
            materialId: id,
            materialCode: bulkItem.materialCode || '',
            poNumber: bulkItem.poNumber || '',
            fromLocation,
            toLocation: locationToSave
          });
        }
      }

      await batch.commit();

      for (const log of historyLogs) {
        await this.logMaterialLocationChange({
          ...log,
          changeType: 'bulk'
        });
      }
      this.bulkStep = 'complete';
    } catch (error) {
      console.error('❌ Error bulk updating items:', error);
      alert('❌ Lỗi cập nhật vị trí/pallet. Vui lòng thử lại.');
    } finally {
      this.isBulkLoading = false;
    }
  }

  async processMoveShelfLocation(): Promise<void> {
    const location = this.moveShelfCurrentLocation.trim().toUpperCase();
    if (!location) {
      alert('⚠️ Vui lòng nhập hoặc scan vị trí');
      return;
    }

    this.isMoveShelfLoading = true;

    try {
      // Load all materials at this location from inventory-materials
      const snapshot = await this.firestore
        .collection('inventory-materials', ref =>
          ref.where('location', '==', location)
        )
        .get()
        .toPromise();

      if (!snapshot || snapshot.empty) {
        alert(`❌ Không tìm thấy mã hàng nào ở vị trí: ${location}`);
        this.isMoveShelfLoading = false;
        return;
      }

      this.moveShelfItems = [];
      snapshot.forEach(doc => {
        const data = doc.data() as any;
        // Calculate stock
        const openingStock = Number(data.openingStock) || 0;
        const quantity = Number(data.quantity) || 0;
        const exported = Number(data.exported) || 0;
        const xt = Number(data.xt) || 0;
        const stock = openingStock + quantity - exported - xt;

        this.moveShelfItems.push({
          id: doc.id,
          materialCode: data.materialCode || '',
          poNumber: data.poNumber || '',
          location: data.location || '',
          stock: stock,
          batchNumber: data.batchNumber || ''
        });
      });

      // Sort by materialCode
      this.moveShelfItems.sort((a, b) => a.materialCode.localeCompare(b.materialCode));

      console.log(`✅ Found ${this.moveShelfItems.length} items at location: ${location}`);
      
      // Move to next step
      this.moveShelfStep = 'select-items';
      this.isMoveShelfLoading = false;

    } catch (error) {
      console.error('❌ Error loading items:', error);
      alert(`❌ Lỗi khi tải dữ liệu: ${error}`);
      this.isMoveShelfLoading = false;
    }
  }

  toggleMoveShelfItem(itemId: string): void {
    if (this.moveShelfSelectedItems.has(itemId)) {
      this.moveShelfSelectedItems.delete(itemId);
    } else {
      this.moveShelfSelectedItems.add(itemId);
    }
  }

  selectAllMoveShelfItems(): void {
    if (this.moveShelfSelectedItems.size === this.moveShelfItems.length) {
      // Deselect all
      this.moveShelfSelectedItems.clear();
    } else {
      // Select all
      this.moveShelfItems.forEach(item => {
        this.moveShelfSelectedItems.add(item.id);
      });
    }
  }

  isMoveShelfItemSelected(itemId: string): boolean {
    return this.moveShelfSelectedItems.has(itemId);
  }

  proceedToNewLocationScan(): void {
    if (this.moveShelfSelectedItems.size === 0) {
      alert('⚠️ Vui lòng chọn ít nhất 1 mã hàng');
      return;
    }
    
    this.moveShelfStep = 'scan-new-location';
    this.moveShelfNewLocation = '';
    
    // Auto focus input
    setTimeout(() => {
      const input = document.getElementById('moveShelfNewLocationInput') as HTMLInputElement;
      if (input) input.focus();
    }, 150);
  }

  async confirmMoveShelf(): Promise<void> {
    const newLocation = this.moveShelfNewLocation.trim().toUpperCase();
    if (!newLocation) {
      alert('⚠️ Vui lòng nhập hoặc scan vị trí mới');
      return;
    }

    // Validate location format
    if (!this.validateViTriInput(newLocation)) {
      alert('❌ Vị trí không hợp lệ');
      return;
    }

    // Check if location exists
    const locationExists = this.locationItems.some(item =>
      this.normalizeLocationCode(item.viTri) === this.normalizeLocationCode(newLocation)
    );

    if (!locationExists) {
      alert(`❌ Vị trí "${newLocation}" không tồn tại trong danh sách vị trí`);
      return;
    }

    this.isMoveShelfLoading = true;

    try {
      const batch = this.firestore.firestore.batch();
      const selectedItemIds = Array.from(this.moveShelfSelectedItems);
      
      for (const itemId of selectedItemIds) {
        const docRef = this.firestore.collection('inventory-materials').doc(itemId).ref;
        batch.update(docRef, {
          location: newLocation,
          lastModified: new Date(),
          modifiedBy: 'move-shelf-scanner'
        });
      }

      await batch.commit();

      console.log(`✅ Moved ${selectedItemIds.length} items to ${newLocation}`);
      
      // Show success
      this.moveShelfStep = 'complete';
      this.isMoveShelfLoading = false;

      alert(`✅ Đã dời ${selectedItemIds.length} mã hàng từ ${this.moveShelfCurrentLocation} đến ${newLocation}`);
      
      // Close modal after short delay
      setTimeout(() => {
        this.closeMoveShelfModal();
      }, 500);

    } catch (error) {
      console.error('❌ Error moving items:', error);
      alert(`❌ Lỗi khi dời kệ: ${error}`);
      this.isMoveShelfLoading = false;
    }
  }

  goBackToSelectItems(): void {
    this.moveShelfStep = 'select-items';
    this.moveShelfNewLocation = '';
  }

  // Print Customer Label
  async printCustomerLabel(customer: CustomerCode) {
    try {
      // Tạo mã QR từ customer code với độ phân giải cao
      const qrImage = await QRCode.toDataURL(customer.code, {
        width: 800,
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });

      // Tạo nội dung để in label với kích thước 100mm x 130mm
      // Code text ở trên, QR code ở dưới, mỗi phần chiếm 50% chiều cao
      // Cả tem quay 90 độ để hiển thị dọc
      const printContent = `
        <div class="customer-label" style="
          width: 100mm; 
          height: 130mm; 
          border: none; 
          display: flex; 
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
          padding: 5mm;
          margin: 0;
          box-sizing: border-box;
          font-family: Arial, sans-serif;
          background: white;
          position: relative;
        ">
          <!-- Code text - Flexible height -->
          <div class="code-section" style="
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            border: none;
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            overflow: visible;
          ">
            <div style="
              font-size: 96px; 
              font-weight: bold; 
              color: #000;
              font-family: 'Arial', sans-serif;
              letter-spacing: 6px;
              display: inline-block;
              writing-mode: vertical-rl;
              text-orientation: mixed;
              transform: rotate(180deg);
              white-space: nowrap;
            ">
              ${customer.code}
            </div>
          </div>
          
          <!-- Spacer - Fixed gap -->
          <div style="height: 10mm; flex-shrink: 0;"></div>
          
          <!-- QR Code - Fixed size -->
          <div class="qr-section" style="
            flex-shrink: 0;
            display: flex; 
            align-items: center; 
            justify-content: center;
            overflow: visible;
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          ">
            <img src="${qrImage}" 
                 alt="QR Code for ${customer.code}" 
                 style="
                   width: 60mm !important; 
                   height: 60mm !important;
                   min-width: 60mm;
                   min-height: 60mm;
                   max-width: 60mm;
                   max-height: 60mm;
                   object-fit: contain;
                   display: block;
                   border: none;
                 "
                 title="QR Code: ${customer.code}">
          </div>
        </div>
      `;
    
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Customer Label</title>
              <style>
                @page {
                  size: 100mm 130mm;
                  margin: 0mm;
                  padding: 0mm;
                }
                
                * {
                  margin: 0;
                  padding: 0;
                  box-sizing: border-box;
                  -webkit-print-color-adjust: exact;
                  print-color-adjust: exact;
                  color-adjust: exact;
                }
                
                html {
                  width: 100mm;
                  height: 130mm;
                  margin: 0;
                  padding: 0;
                }
                
                body {
                  width: 100mm;
                  height: 130mm;
                  margin: 0 !important;
                  padding: 0 !important;
                  overflow: hidden;
                  font-family: Arial, sans-serif;
                  background: white;
                  transform-origin: top left;
                  transform: scale(1);
                }
                
                .customer-label {
                  width: 100mm !important;
                  height: 130mm !important;
                  margin: 0 !important;
                  padding: 0 !important;
                  box-shadow: none;
                  border: none;
                  position: absolute;
                  top: 0;
                  left: 0;
                }
                
                @media print {
                  @page {
                    size: 100mm 130mm;
                    margin: 0mm;
                  }
                  
                  html, body {
                    width: 100mm;
                    height: 130mm;
                    margin: 0 !important;
                    padding: 0 !important;
                    overflow: visible;
                  }
                  
                  .customer-label {
                    width: 100mm !important;
                    height: 130mm !important;
                    page-break-after: avoid;
                    page-break-inside: avoid;
                  }
                }
              </style>
            </head>
            <body>
              ${printContent}
              <script>
                window.onload = function() {
                  // Show instruction alert before printing
                  alert('⚠️ QUAN TRỌNG:\\n\\nTrong hộp thoại Print:\\n1. Mở "More settings"\\n2. TẮT "Headers and footers"\\n3. Đặt Scale = 100% (Default)\\n4. Margins = None\\n5. Nhấn Print');
                  
                  setTimeout(function() {
                    window.print();
                    window.onafterprint = function() {
                      window.close();
                    };
                  }, 100);
                };
              </script>
            </body>
          </html>
        `);
        printWindow.document.close();
      }
    } catch (error) {
      console.error('Error printing customer label:', error);
      alert('❌ Lỗi khi in tem khách hàng');
    }
  }
}

