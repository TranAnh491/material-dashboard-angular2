import { Component, OnInit, OnDestroy, AfterViewInit, HostListener, ChangeDetectorRef } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { Subject, BehaviorSubject, Subscription, firstValueFrom } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged, timeout } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { Html5Qrcode } from 'html5-qrcode';
import { MatDialog } from '@angular/material/dialog';
import { TabPermissionService } from '../../services/tab-permission.service';
import { FactoryAccessService } from '../../services/factory-access.service';
import { ExcelImportService } from '../../services/excel-import.service';
import { RmBagHistoryService } from '../../services/rm-bag-history.service';
import { TemXuatKhoService, PxkLineExport } from '../../services/tem-xuat-kho.service';
import { LabelReprintFlagService } from '../../services/label-reprint-flag.service';
import { FirebaseAuthService } from '../../services/firebase-auth.service';
import { getDefaultRmFactory } from '../../services/rm-factory-preference.util';
import { MaterialsDashboardService } from '../../services/materials-dashboard.service';
import { LocationUnlockService } from '../../services/location-unlock.service';
import { LocationUnlockDialogComponent } from '../../components/location-unlock-dialog/location-unlock-dialog.component';
import { MaterialsInventoryUnlockService } from '../../services/materials-inventory-unlock.service';
import {
  isAsm3OrWh3PrefixLocation,
  isIqcPrefixLocation,
  isLockerPrefixLocation,
  isNgPrefixLocation,
  splitMultiLocations,
  joinMultiLocations
} from '../layout-warehouse/layout-warehouse-location.util';
import {
  LayoutWhPick,
  LayoutLocGroup,
  getLayoutLocationGroups,
  normalizeLayoutLocToken,
  isJWarehouseLocation,
  jKhoMatSRuleLabel,
  jKhoMatSRuleOfRow,
  jKhoMatSFirstRowForPrefix,
  jKhoMatSRowIdFromSlot
} from './layout-location-catalog';
import { DvLuuTruCatalogService } from '../../services/dv-luu-tru-catalog.service';
import { NvlkhCatalogService } from '../../services/nvlkh-catalog.service';
import { NvlCatalogFullService } from '../../services/nvl-catalog-full.service';
import { KkCatalogService, KkCatalogEntry } from '../../services/kk-catalog.service';
import * as XLSX from 'xlsx';
import { ReadTrackerService } from '../../services/read-tracker.service';
import { StorageUnitSize } from '../../models/storage-unit.model';
import { ImportProgressDialogComponent } from '../../components/import-progress-dialog/import-progress-dialog.component';
import { QRScannerModalComponent, QRScannerData } from '../../components/qr-scanner-modal/qr-scanner-modal.component';
import { buildTemThungQrData, stripTemThungMarker } from '../../services/tem-thung-qr.util';
import * as firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

export interface InventoryMaterial {
  id?: string;
  factory?: string;
  importDate: Date;
  receivedDate?: Date;
  batchNumber: string;
  materialCode: string;
  materialName?: string;
  poNumber: string;
  openingStock: number | null; // Tồn đầu - nhập tay được, có thể null
  quantity: number;
  unit: string;
  exported?: number;
  xt?: number; // Số lượng cần xuất (nhập tay)
  stock?: number;
  location: string;
  /** Mã pallet (đồng bộ từ Layout ASM3 khi gán pallet vào vị trí). */
  palletId?: string;
  type: string;
  expiryDate: Date;
  qualityCheck: boolean;
  isReceived: boolean;
  notes: string;
  rollsOrBags: string;
  supplier: string;
  remarks: string;
  standardPacking?: number;
  /** Đã kiểm kê (đếm tồn kho) — tick tay ở cột KK, riêng theo dòng (Mã + PO + IMD). */
  kkChecked?: boolean;
  /** Số lượng cộng dồn từ tem Scan KK — so sánh với tồn kho. */
  kkScanCount?: number;
  /** Tài khoản đã tick/bỏ tick KK gần nhất. */
  kkBy?: string;
  /** Thời điểm tick/bỏ tick KK gần nhất. */
  kkAt?: Date | null;
  isCompleted: boolean;
  isDuplicate?: boolean;
  importStatus?: string;
  source?: 'inbound' | 'manual' | 'import'; // Nguồn gốc của dòng dữ liệu
  iqcStatus?: string; // IQC Status: PASS, NG, ĐẶC CÁCH, CHỜ XÁC NHẬN
  lastStatusAt?: Date | null;
  lastStatusKind?: 'Outbound' | 'Change location' | 'Inbound' | '';
  lastStatusBy?: string;
  lastStatusLoading?: boolean;
  /** DV Lưu trữ — đồng bộ danh mục chung theo mã NVL */
  storageUnitSize?: StorageUnitSize | '';
  /** Tổng số bịch (Inbound gwLdv) */
  totalBags?: number;
  /** Số bag tồn đầu (lấy từ Inbound "số bịch") */
  openingBagsAtInit?: number;
  /** Số bịch đã xuất (Outbound QR dạng DDMMYYYY-i/n) */
  exportedBags?: number;
  /** String input để edit BAG (totalBags) an toàn với dấu phẩy. */
  bagInput?: string;
  /** Đã khởi tạo bịch theo tồn kho ÷ Standard Packing — sau đó hệ thống tự tính. */
  bagTrackingInitialized?: boolean;
  /** Tồn kho tại lần nhập bịch đầu tiên (tồn đầu kỳ bịch). */
  openingStockAtBagInit?: number;
  
  // Edit states
  isEditingOpeningStock?: boolean;
  isEditingXT?: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

type ResetLowStockRow = {
  id: string;
  materialCode: string;
  poNumber: string;
  imd: string;
  location: string;
  stock: number;
  selected: boolean;
};

/** Dòng tổng hợp Kiểm tra KK theo mã hàng. */
type KkWarehouse = 'D1' | '00' | 'J5' | 'ASM3';
type KkLocMaterialRow = {
  materialCode: string;
  warehouse: KkWarehouse;
  stock: number;
  checked: number;
  totalLines: number;
  remaining: number;
  palletId: string;
  palletMixed: boolean;
  palletSaved: string;
  location: string;
  locationSaved: string;
};

/** Dòng tổng hợp Kiểm tra KK theo loại hàng (trong 1 Zone). */
type KkTypeRow = {
  productType: string;
  groupCodes: string[];
  warehouse: KkWarehouse;
  stock: number;
  checked: number;
  totalLines: number;
  remaining: number;
  location: string;
  locationSaved: string;
};

/** Dòng kết quả tìm trong popup Dời kho (search theo mã pallet hoặc vị trí). */
type DoiKhoRow = {
  id: string;
  materialCode: string;
  poNumber: string;
  location: string;
  palletId: string;
  stock: number;
  selected: boolean;
};

/** Kho đích khi Dời kho — tiền tố gắn vào đầu Vị trí. */
type DoiKhoWh = 'J5' | 'ASM3';

type InventoryHideReason = 'manual' | 'reset-zero' | 'reset-low-stock';

type MaterialsOtpAction =
  | 'import'
  | 'consolidate'
  | 'reset-all'
  | 'fix-batch'
  | 'snapshot'
  | 'hidden-list'
  | 'manual-on';

type HiddenInventoryRow = {
  id: string;
  factory: string;
  materialCode: string;
  poNumber: string;
  location: string;
  stock: number;
  unit: string;
  hideReason: InventoryHideReason | string;
  hiddenBy: string;
  hiddenAt: Date | null;
  deleteAfterAt: Date | null;
  daysLeft: number;
};

@Component({
  selector: 'app-materials',
  templateUrl: './materials.component.html',
  styleUrls: ['./materials.component.scss', './materials-mobile.scss']
})
export class MaterialsComponent implements OnInit, OnDestroy, AfterViewInit {
  /** Nhà máy đang xem (ASM1 ⇄ ASM2) — đổi qua factory-switcher trên UI, đồng bộ với query param `factory`. */
  selectedFactory: 'ASM1' | 'ASM2' = 'ASM1';
  readonly factoryOptions: Array<'ASM1' | 'ASM2'> = ['ASM1', 'ASM2'];

  /** Mobile / PDA: giao diện chỉ xem tồn kho (không sửa bảng). */
  isMobile = false;

  // 🔧 LOGIC MỚI: Cập nhật số lượng xuất từ Outbound theo Material + PO
  // - Mỗi dòng Inventory được cập nhật số lượng xuất DỰA TRÊN Material + PO
  // - Outbound RM1 scan/nhập: Material + PO (không còn vị trí)
  // - Hệ thống sẽ tìm tất cả outbound records có cùng Material + PO và cộng dồn
  // - KHÔNG còn bị lỗi số âm sai khi search
  
  // Data properties
  inventoryMaterials: InventoryMaterial[] = [];
  filteredInventory: InventoryMaterial[] = [];
  displayedInventory: InventoryMaterial[] = []; // Items to display on current page
  
  // Pagination
  currentPage: number = 1;
  itemsPerPage: number = 20;
  totalPages: number = 1;
  
  // Loading state
  isLoading = false;
  showStorageUnitPicker = false;
  storageUnitPickerMaterialCode = '';
  isSavingStorageUnit = false;
  private storageUnitCatalogMap = new Map<string, StorageUnitSize>();
  /** Danh mục NVLKH: mã NVL (đã chuẩn hóa) → khách hàng (hoặc "Shared"). */
  private nvlkhCustomerMap = new Map<string, string>();
  isCatalogLoading = false;
  isResetting = false; // Loading state for reset operation
  isDownloadingSearch = false;
  showResetLowStockPopup = false;
  resetLowStockRows: ResetLowStockRow[] = [];
  isDeletingResetLowStock = false;
  resetZeroDeletedCount = 0;
  /** Popup sơ đồ KK theo vị trí (More → Kiểm tra KK). */
  showKkLocMap = false;
  kkLocMapLoading = false;
  kkLocMapStatus = '';
  kkLocMapQuery = '';
  kkLocMapView: 'location' | 'material' | 'type' | null = null;
  kkLocMapWarehouseFilter: '' | KkWarehouse = '';
  kkLocMapBoxes: Array<{ loc: string; checked: number; total: number }> = [];
  kkLocMapByMaterial: KkLocMaterialRow[] = [];
  kkLocMapByType: KkTypeRow[] = [];
  private kkLocMapRowCache = new Map<string, InventoryMaterial[]>();
  private kkLocMapMaterialCache = new Map<string, InventoryMaterial[]>();
  private kkLocMapTypeCache = new Map<string, InventoryMaterial[]>();
  private kkLocMapLoadId = 0;
  kkLocMapBusy = false;
  /** warehouse|mã — dòng tổng đang xổ chi tiết PO/IMD trong popup. */
  kkLocMapExpandedKey: string | null = null;
  showKkCatalogPopup = false;
  showTieuHuyPopup = false;
  tieuHuyImporting = false;
  tieuHuyBusy = false;
  tieuHuyFileName = '';
  tieuHuyImportedCount = 0;
  tieuHuyMatchedCount = 0;
  tieuHuyUpdatedCount = 0;
  tieuHuyQuery = '';
  tieuHuyRows: Array<{
    px: string;
    materialCode: string;
    poNumber: string;
    fileQty: number | null;
    currentStock: number;
    linkQStock: number | null;
    matched: boolean;
    location: string;
    palletId: string;
    inventoryIds: string[];
    selected: boolean;
    done: '' | 'tieu-huy' | 'hidden';
  }> = [];
  private tieuHuyStockLines: InventoryMaterial[] = [];
  private tieuHuyLinkQMap = new Map<string, number>();
  private readonly tieuHuyWarehouseValue = 'TIEUHUY';
  kkCatalogEntries: KkCatalogEntry[] = [];
  kkCatalogQuery = '';
  kkCatalogLoading = false;
  kkCatalogImporting = false;
  private kkCatalogTypeMap = new Map<string, string>();
  kkActiveProductType: string | null = null;
  private kkActiveTypeDraft: KkTypeRow | null = null;
  kkTypePage = 1;
  kkTypePageSize = 20;
  readonly kkTypePageSizeOptions = [20, 50, 100];
  /** Ô search mã / tên / pallet trong bảng chi tiết KK theo loại hàng. */
  kkTypeDetailQuery = '';
  kkTypeSearchDraft = '';
  kkTypeFilterLoc = '';
  kkTypeFilterWh: '' | KkWarehouse = '';
  kkTypeFilterRolls = '';
  kkTypeSortQtyDesc = false;
  kkTypeShowExtraFilter = false;
  private kkTypeCacheRev = 0;
  private kkTypeBoxesSig = '';
  private kkTypeBoxesCached: Array<{
    productType: string;
    sourceProductType?: string;
    sourceProductTypes?: string[];
    pinSplit?: '1-4' | '5-10';
    groupCodes: string[];
    sharedPrefix: string;
    stock: number;
    checked: number;
    totalLines: number;
    remaining: number;
  }> = [];
  kkTypeMucCollapsed: Record<string, boolean> = {};
  kkActivePinSplit: '1-4' | '5-10' | null = null;
  kkActiveSourceProductType: string | null = null;
  private kkTypeDetailSig = '';
  private kkTypeDetailAllCached: InventoryMaterial[] = [];
  private kkTypeDetailFilteredCached: InventoryMaterial[] = [];
  private kkTypeFilteredRollsCached = 0;
  private kkTypePalletNotesSig = '';
  private kkTypePalletNotesCached = new Map<string, string>();
  showKkTypeScanModal = false;
  kkTypeScanStep: 'operator' | 'pallet' | 'codes' = 'pallet';
  kkTypeScanOperator = '';
  kkTypeScanOperatorInput = '';
  kkTypeScanPallet = '';
  kkTypeScanPalletInput = '';
  kkTypeScanQrInput = '';
  kkTypeScanBusy = false;
  kkTypeScanMaterialCode = '';
  kkTypeScanStandardDraft: number | '' = '';
  kkTypeScanOkCount = 0;
  kkTypeScanSkipCount = 0;
  kkTypeScanMissCount = 0;
  kkTypeScanLogs: Array<{ ok: boolean; skip?: boolean; text: string }> = [];
  kkTypePrintBusy = false;
  showKkTypeReportMenu = false;
  showKkCodeLookup = false;
  showKkPalletCheck = false;
  kkPalletCheckBusy = false;
  kkPalletCheckRows: Array<{ warehouse: KkWarehouse; label: string; pallets: number; lines: number; noPallet: number }> = [];
  kkPalletCheckTotal = 0;
  kkCodeLookupInput = '';
  kkCodeLookupBusy = false;
  kkCodeLookupResult: {
    code: string;
    productType: string;
    stock: number;
    lines: number;
    found: boolean;
  } | null = null;
  kkTypeReportBusy = false;
  /** Tick: cộng các mã đang ở kho WH3/ASM3 vào số liệu KK. Bỏ tick thì không tính. */
  kkCountWh3 = true;
  /** Khi Tính WH3/ASM3: chỉ hiện dòng kho ASM3 / WH3. */
  kkWh3Only = false;
  /** Lọc chỉ các dòng / loại còn chưa tick KK. */
  kkFilterUncheckedOnly = false;
  private inboundNameCache = new Map<string, string>();
  readonly kkLocMapWarehouseOptions: Array<{ id: KkWarehouse; label: string }> = [
    { id: 'D1', label: 'D1' },
    { id: '00', label: '00' },
    { id: 'J5', label: 'J5' },
    { id: 'ASM3', label: 'ASM3 / WH3' }
  ];
  readonly kkWhSelectOptions: Array<{ id: '' | '00' | 'J5' | 'ASM3'; label: string }> = [
    { id: '', label: 'D1' },
    { id: '00', label: '00' },
    { id: 'J5', label: 'J5' },
    { id: 'ASM3', label: 'ASM3 / WH3' }
  ];

  /**
   * Popup Dời kho: scan pallet → chọn J5/ASM3 → Done.
   * Đổi tiền tố vị trí sang kho mới, giữ nguyên mã pallet.
   */
  showDoiKho = false;
  doiKhoBusy = false;
  doiKhoLoading = false;
  doiKhoScanInput = '';
  doiKhoPallet = '';
  doiKhoWh: DoiKhoWh | null = null;
  doiKhoRows: DoiKhoRow[] = [];
  doiKhoError = '';

  /** Popup Gán pallet: scan pallet → kho → vị trí → mã (+ lượng) → Gán tiếp / Dừng. */
  showGanPallet = false;
  ganPalletBusy = false;
  ganPalletLookupBusy = false;
  ganPalletStep: 1 | 2 | 3 | 4 | 5 = 1;
  ganPalletCode = '';
  ganPalletWh: 'ASM1' | 'ASM3' | null = null;
  ganPalletLoc = '';
  ganPalletMaterial = '';
  ganPalletQty = '';
  ganPalletError = '';
  ganPalletHit: InventoryMaterial | null = null;
  ganPalletPending: Array<{
    material: InventoryMaterial;
    qty: number | null;
    location: string;
    palletId: string;
  }> = [];

  /** Popup Kiểm Kê: tiến độ tick KK toàn bộ tồn kho + theo từng mã B (B + 6 số) */
  showKkCheckPopup = false;
  kkCheckRunning = false;
  kkCheckRan = false;
  kkCheckTotalRows = 0;
  kkCheckCheckedRows = 0;
  kkCheckByMaterial: Array<{ materialCode: string; total: number; checked: number; remaining: number; locations: string }> = [];
  kkCheckFilterMode: 'all' | 'checked' | 'unchecked' = 'all';
  kkCheckSelectedFactory: 'ASM1' | 'ASM2' | 'ASM3' = 'ASM1';
  kkCheckSearchCode = '';
  kkCheckSearchLocation = '';
  /** Tăng khi hủy/đổi factory — bỏ kết quả Run cũ. */
  private kkCheckRunId = 0;

  /**
   * Cache snapshot `inventory-materials` theo từng factory cho các thao tác Kiểm Kê
   * (Run KK, Sơ đồ KK theo vị trí / mã / loại, danh sách đã KK). Trước đây mỗi lần đổi
   * nhà máy hoặc đổi view đều quét lại tới 10k doc từ mạng — đây là nguyên nhân chính
   * khiến phần Kiểm tra KK load chậm.
   */
  private kkInvSnapCache = new Map<string, { docs: any[]; ts: number }>();
  private static readonly KK_INV_SNAP_TTL_MS = 90_000;

  /** Đọc `inventory-materials` theo 1 factory, ưu tiên cache TTL. `force` = bỏ qua cache. */
  private async getKkFactoryDocs(factory: string, force = false): Promise<any[]> {
    const key = String(factory || '').trim().toUpperCase();
    if (!key) return [];
    const now = Date.now();
    const hit = this.kkInvSnapCache.get(key);
    if (!force && hit && now - hit.ts < MaterialsComponent.KK_INV_SNAP_TTL_MS) {
      return hit.docs;
    }
    const snap = await firstValueFrom(
      this.firestore
        .collection('inventory-materials', (ref) => ref.where('factory', '==', key).limit(10000))
        .get()
        .pipe(timeout(60000))
    );
    const docs = snap?.docs || [];
    this.kkInvSnapCache.set(key, { docs, ts: now });
    return docs;
  }

  /** Bỏ cache KK — gọi sau khi tick/bỏ tick KK hoặc khi người dùng bấm "Làm mới". */
  private invalidateKkInvSnapCache(factory?: string): void {
    if (factory) {
      this.kkInvSnapCache.delete(String(factory).trim().toUpperCase());
    } else {
      this.kkInvSnapCache.clear();
    }
  }

  /** Mobile KK: draft lượng chẵn (SP) theo id dòng. */
  mobileKkSpDraft: Record<string, string> = {};
  showMobileKkConfirm = false;
  mobileKkConfirmBusy = false;
  mobileKkConfirmMaterial: InventoryMaterial | null = null;
  mobileKkConfirmSp = 0;

  /** Mobile: đổi vị trí bằng scanner. */
  showMobileLocScan = false;
  mobileLocScanBusy = false;
  mobileLocScanBuffer = '';
  mobileLocScanMaterial: InventoryMaterial | null = null;

  /** Mobile: sheet Chi tiết dòng tồn. */
  showMobileDetail = false;
  mobileDetailMaterial: InventoryMaterial | null = null;
  kkCatalogDate = new Date().toISOString().slice(0, 10);
  kkCatalogExporting = false;
  /** Ghi snapshot TỒN từ kho → rm-bag-history */
  isSnapshottingBagHistory = false;
  /** Popup nhập danh sách mã trước khi snapshot (tránh quá tải) */
  showSnapshotCodesModal = false;
  snapshotMaterialCodesText = '';
  
  // Consolidation status
  consolidationMessage = '';
  showConsolidationMessage = false;
  
  // Catalog cache for faster access
  private catalogCache = new Map<string, any>();
  public catalogLoaded = false;
  /** Ngày (YYYY-MM-DD) lần tải danh mục NVL gần nhất — sang ngày mới thì đọc lại. */
  private catalogLoadedDateKey = '';
  /** Tránh gọi song song loadCatalogFromFirebase + loadCatalogOnce (đọc ~9K doc 2 lần). */
  private catalogLoadPromise: Promise<void> | null = null;
  /** Cache danh mục sống sót khi Angular hủy component (rời tab). */
  private static sharedCatalogCache = new Map<string, any>();
  private static sharedCatalogDateKey = '';
  
  // Search and filter — mã hàng hoặc vị trí (tick Location)
  searchTerm = '';
  searchType: 'material' | 'po' | 'location' = 'material';
  searchByLocation = false;
  /** Tìm theo khách hàng (Danh mục NVLKH) — loại trừ lẫn nhau với searchByLocation. */
  searchByCustomer = false;
  /** Chỉ hiện dòng đang tick KK. */
  searchByKk = false;
  /** Cache dòng đã tick KK từ lần quét Kiểm Kê / lọc KK gần nhất. */
  private kkTickedMaterialsCache: InventoryMaterial[] = [];
  /** Popup chọn khách hàng / vị trí */
  showCustomerFilterPopup = false;
  showLocationFilterPopup = false;
  customerFilterQuery = '';
  locationFilterQuery = '';
  customerFilterOptions: string[] = [];
  locationFilterOptions: string[] = [];
  isLoadingCustomerFilterOptions = false;
  isLoadingLocationFilterOptions = false;
  /** Hiện cột KH — mặc định tắt để không tải Danh mục NVLKH nếu không cần. */
  showKhColumn = false;
  /** Lọc xem theo kho (J / ASM3 / 00 / NG). '' = Tất cả, không lọc. */
  viewWarehouseFilter: '' | 'J' | 'ASM3' | '00' | 'NG' = '';
  showKhoPopup = false;
  readonly viewWarehouseOptions: Array<{ id: '' | 'J' | 'ASM3' | '00' | 'NG'; label: string; icon: string }> = [
    { id: '', label: 'Tất cả', icon: 'apps' },
    { id: 'J', label: 'Kho J', icon: 'warehouse' },
    { id: 'ASM3', label: 'Kho ASM3', icon: 'domain' },
    { id: '00', label: 'Kho 00', icon: 'inventory_2' },
    { id: 'NG', label: 'Kho NG', icon: 'report' }
  ];
  private searchSubject = new Subject<string>();
  
  // 🚀 OPTIMIZATION: Add loading states
  isSearching = false;
  searchProgress = 0;
  // Negative stock tracking
  private negativeStockSubject = new BehaviorSubject<number>(0);
  public negativeStockCount$ = this.negativeStockSubject.asObservable();
  
  // Total stock tracking
  private totalStockSubject = new BehaviorSubject<number>(0);
  public totalStockCount$ = this.totalStockSubject.asObservable();

  // Total bag tracking (tổng số bịch của các mã đang search)
  private totalBagSubject = new BehaviorSubject<number>(0);
  public totalBagCount$ = this.totalBagSubject.asObservable();
  
  // Negative stock filter state
  showOnlyNegativeStock = false;
  
  
  /** More — mở popup (giống ASM2) */
  showMorePopup = false;

  /** Danh mục Ẩn (More) — các dòng đã ẩn, giữ 30 ngày rồi backup mail + tự xóa */
  private readonly hiddenInventoryCollection = 'inventory-materials-hidden';
  private readonly hiddenRetentionDays = 30;
  showHiddenInventoryPopup = false;
  isLoadingHiddenInventory = false;
  hiddenInventoryRows: HiddenInventoryRow[] = [];
  hiddenSearchQuery = '';
  pushbackHiddenId: string | null = null;
  isHidingInventory = false;

  /** OTP More — thao tác đổi tồn / import / xóa (Zalo → ASP0106) */
  showMaterialsOtpModal = false;
  materialsOtpStep: 1 | 2 = 1;
  materialsOtpCode = '';
  materialsOtpError = '';
  materialsOtpInfo = '';
  materialsOtpSending = false;
  materialsOtpVerifying = false;
  materialsOtpActionLabel = '';
  materialsInventoryUnlocked = false;
  private pendingMaterialsOtpAction: MaterialsOtpAction | null = null;
  /** More → Manual ON/OFF: nhập tồn đầu / xuất tay. Mặc định OFF, mỗi nhà máy riêng. */
  private manualStockEditByFactory: Record<'ASM1' | 'ASM2', boolean> = {
    ASM1: false,
    ASM2: false
  };

  /** In Tùy Chỉnh dialog */
  showCustomPrintDialog = false;
  customPrintCode = '';
  customPrintPo = '';
  customPrintQty = '';
  customPrintImd = '';
  customPrintNumLabels = 1;
  customPrintBusy = false;

  /** QTY BAG rule: ON = multiple of Standard Packing; OFF = legacy free input */
  qtyBagRuleEnabled = true;
  /** localStorage key theo factory đang chọn — mỗi nhà máy có Rule Bag riêng (nguồn thật ở Firestore, đây chỉ là cache). */
  private get QTY_BAG_RULE_KEY(): string {
    return `materials-${this.selectedFactory}:qty-bag-rule-enabled:v1`;
  }

  /** Rule Bag: 4 ký tự đầu mã — khi master QTY BAG rule ON, chỉ nhóm prefix ON mới bắt bội số SP */
  showRuleBagPopup = false;
  ruleBagPrefixes: string[] = [];
  private qtyBagRuleByPrefix: Record<string, boolean> = {};
  private get QTY_BAG_RULE_BY_PREFIX_KEY(): string {
    return `materials-${this.selectedFactory}:qty-bag-rule-by-prefix:v1`;
  }

  /** Đầu mã thêm tay (không cần load inventory), lưu localStorage */
  ruleBagManualPrefixes: string[] = [];
  ruleBagNewPrefixInput = '';
  private get RULE_BAG_MANUAL_PREFIXES_KEY(): string {
    return `materials-${this.selectedFactory}:rule-bag-manual-prefixes:v1`;
  }

  /** Đồng bộ QTY BAG + Rule Bag cho mọi máy qua Firestore */
  private readonly QTY_BAG_FIRESTORE_COLLECTION = 'materials-qty-bag-rules';

  // ===== Tem Lẽ (tách tem từ QR hiện tại) =====
  showTemLePopup = false;
  temLeQrText: string = '';
  temLeSplitQty: number | null = null;
  temLeError: string = '';
  temLeParsed: { materialCode: string; po: string; quantity: number; p4: string } | null = null;
  private temLeSuffixPool: string[] = [];

  // ===== Tem Xuất Kho (PXK + FIFO tồn → in loạt tem QR) =====
  showTemXuatKhoPopup = false;
  temXuatLsxInput = '';
  temXuatError = '';
  temXuatBusy = false;
  /** Cutoff: từ ngày này trở đi là tem mẫu mới, không cần in lại. */
  private readonly TEM_MOI_CUTOFF = new Date(2026, 3, 1); // 01/04/2026 (month is 0-based)
  /** Rule "đã in lại tem mẫu mới" (label-reprint-flags). Tạm thời TẮT theo yêu cầu. */
  private readonly REPRINT_FLAG_RULE_ENABLED = true;

  // ===== In Lại Tem (theo LSX -> in toàn bộ tem theo mã hàng, chỉ IMD trước cutoff) =====
  showTemInLaiPopup = false;
  temInLaiLsxInput = '';
  temInLaiError = '';
  temInLaiBusy = false;
  temInLaiItems: Array<{
    materialCode: string;
    eligibleRowCount: number;
    alreadyPrinted: boolean;
    blockedByRuleBag: boolean;
  }> = [];
  private temInLaiPrintedCodes = new Set<string>();
  temInLaiShowAdd = false;
  temInLaiAddCodeInput = '';
  temInLaiImportBusy = false;
  private readonly TEM_INLAI_PRINTED_COLLECTION = 'tem-inlai-printed-codes';

  // ===== In Tem Thùng (mã + PO + IMD, không QTY) =====
  showTemThungPopup = false;
  temThungCodeInput = '';
  temThungError = '';
  temThungBusy = false;
  temThungSearching = false;
  temThungLabelCount = 1;
  temThungCandidates: Array<{
    rowKey: string;
    material: InventoryMaterial;
    materialCode: string;
    poNumber: string;
    imd: string;
    stock: number;
  }> = [];
  temThungSelectedKey: string | null = null;

  // ===== Tem Thùng theo cột (mới): mã đã chọn sẵn từ dòng bảng, chỉ nhập lượng tem thùng =====
  showTemThungColumnPopup = false;
  temThungColumnMaterial: InventoryMaterial | null = null;
  temThungColumnQtyInput: number | null = null;
  temThungColumnError = '';
  temThungColumnBusy = false;

  // Mobile menu state
  showMobileMenu = false;
  showMobileStats = false;
  
  // Show completed items
  // showCompleted = true; // Removed - replaced with Reset function
  
  // Lifecycle
  private destroy$ = new Subject<void>();
  
  // QR Scanner
  private html5QrCode: Html5Qrcode | null = null;
  isScanning = false;
  
  // Permissions
  canView = false;
  canEdit = false;
  canExport = false;
  canDelete = false;

  /**
   * Tạm: luôn mở sửa tay cột Vị trí / WH / Pallet (không OTP).
   * Đặt `false` khi user báo lock lại như cũ.
   */
  readonly TEMP_UNLOCK_LOCATION_WH_PALLET = true;
  /** Dropdown cột WH — chọn kho đích. */
  readonly WH_SELECT_OPTIONS = ['ASM3', 'J5'] as const;
  /** Cột Vị trí: sửa tay sau khi xác thực OTP Zalo (4 tiếng, hết khi F5). */
  isLocationColumnUnlocked = false;
  showLayoutLocPicker = false;
  layoutLocMaterial: InventoryMaterial | null = null;
  layoutLocWh: LayoutWhPick = 'J';
  layoutLocGroupId = '';
  layoutLocFamily: 'R' | 'S' = 'R';
  layoutLocQuery = '';
  layoutLocSelected = new Set<string>();
  layoutLocPalletDraft = '';
  /** Ô nhập tay vị trí mới trong popup (phân tách bằng dấu phẩy / xuống dòng). */
  layoutLocManualDraft = '';
  /** Phần popup đang mở từ cột nào — để focus đúng ô. */
  layoutLocFocus: 'location' | 'pallet' = 'location';
  /** Block kệ đang mở để chọn mâm. Null = đang xem danh sách kệ. */
  layoutJFocusBlock: number | null = null;
  /** Gán vị trí cất hàng cho box loại (chuột phải). */
  layoutLocTypeAssign: string | null = null;
  private layoutLocTypeAssignGroups: string[] = [];
  kkTypeHomeLocs = new Map<string, string>();
  // canEditHSD = false; // Removed - HSD column deleted

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private cdr: ChangeDetectorRef,
    private tabPermissionService: TabPermissionService,
    private factoryAccessService: FactoryAccessService,
    private excelImportService: ExcelImportService,
    private dialog: MatDialog,
    private router: Router,
    private route: ActivatedRoute,
    private rmBagHistory: RmBagHistoryService,
    private temXuatKho: TemXuatKhoService,
    private labelReprintFlags: LabelReprintFlagService,
    private materialsDashboard: MaterialsDashboardService,
    private locationUnlock: LocationUnlockService,
    private materialsInventoryUnlock: MaterialsInventoryUnlockService,
    private dvLuuTruCatalog: DvLuuTruCatalogService,
    private nvlkhCatalog: NvlkhCatalogService,
    private nvlCatalogFull: NvlCatalogFullService,
    private kkCatalog: KkCatalogService,
    private readTracker: ReadTrackerService,
    private location: Location,
    private authService: FirebaseAuthService
  ) {}

  getStorageUnitLabel(material: InventoryMaterial): string {
    const code = this.dvLuuTruCatalog.normalizeMaterialCode(material.materialCode);
    return material.storageUnitSize || this.storageUnitCatalogMap.get(code) || '';
  }

  /** Khách hàng của mã NVL (từ Danh mục NVLKH) — trống nếu chưa có trong danh mục. */
  getCustomerForMaterial(material: InventoryMaterial): string {
    const code = this.nvlkhCatalog.normalizeMaterialCode(material.materialCode);
    return this.nvlkhCustomerMap.get(code) || '';
  }

  private async applyNvlkhFromCatalog(): Promise<void> {
    try {
      this.nvlkhCustomerMap = await this.nvlkhCatalog.loadAllAsMap();
      this.cdr.markForCheck();
    } catch (e) {
      console.error('Load Danh mục NVLKH error:', e);
    }
  }

  hasStorageUnit(material: InventoryMaterial): boolean {
    return !!this.getStorageUnitLabel(material);
  }

  private getStorageMaterialKey(material: InventoryMaterial): string {
    return this.dvLuuTruCatalog.normalizeMaterialCode(material.materialCode);
  }

  onStorageUnitCellClick(material: InventoryMaterial): void {
    if (this.hasStorageUnit(material)) {
      alert('Mã NVL đã có DV Lưu trữ. Sửa tại Danh mục DV Lưu trữ.');
      return;
    }
    const code = this.getStorageMaterialKey(material);
    if (!code) {
      alert('Vui lòng nhập mã NVL trước khi chọn DV Lưu trữ.');
      return;
    }
    this.storageUnitPickerMaterialCode = code;
    this.showStorageUnitPicker = true;
  }

  closeStorageUnitPicker(): void {
    if (this.isSavingStorageUnit) return;
    this.showStorageUnitPicker = false;
    this.storageUnitPickerMaterialCode = '';
  }

  async onStorageUnitConfirmed(size: StorageUnitSize): Promise<void> {
    const materialCode = this.storageUnitPickerMaterialCode;
    if (!materialCode) return;
    this.isSavingStorageUnit = true;
    try {
      await this.dvLuuTruCatalog.assignStorageUnit(materialCode, size, this.selectedFactory);
      this.storageUnitCatalogMap.set(materialCode, size);
      const applySize = (list: InventoryMaterial[]) => {
        list.forEach(m => {
          if (this.getStorageMaterialKey(m) === materialCode) {
            m.storageUnitSize = size;
          }
        });
      };
      applySize(this.inventoryMaterials);
      applySize(this.filteredInventory);
      applySize(this.displayedInventory);
      this.cdr.markForCheck();
      this.closeStorageUnitPicker();
    } catch (e) {
      console.error(e);
      alert('Không lưu được DV Lưu trữ. Vui lòng thử lại.');
    } finally {
      this.isSavingStorageUnit = false;
    }
  }

  private async applyStorageUnitsFromCatalog(): Promise<void> {
    try {
      const codes = [
        ...new Set(this.inventoryMaterials.map(m => this.getStorageMaterialKey(m)).filter(Boolean))
      ];
      const map = await this.dvLuuTruCatalog.loadMapForMaterialCodes(codes);
      this.storageUnitCatalogMap = map;
      let changed = false;
      this.inventoryMaterials.forEach(m => {
        const code = this.getStorageMaterialKey(m);
        const fromCatalog = map.get(code);
        if (fromCatalog && m.storageUnitSize !== fromCatalog) {
          m.storageUnitSize = fromCatalog;
          changed = true;
        }
      });
      if (changed) {
        this.filteredInventory = [...this.inventoryMaterials];
        this.updateDisplayedInventory();
        this.cdr.markForCheck();
      }
    } catch (e) {
      console.error('Load DV Lưu trữ catalog error:', e);
    }
  }

  /**
   * Nếu rawImportDate là chuỗi 10 số (DDMMYYYY + 2 suffix) và batchNumber trống/8 số,
   * ưu tiên dùng rawImportDate làm batchNumber để giữ đủ 10 số.
   */
  private resolveRawImd(data: any): string {
    const bn = String(data?.batchNumber ?? '').trim();
    const raw = String(data?.importDate ?? '').trim();
    if (/^\d{10}$/.test(bn)) return bn;   // batchNumber đã là 10 số → dùng
    if (/^\d{10}$/.test(raw)) return raw; // importDate là 10 số → dùng thay batchNumber
    if (/^\d{8,9}$/.test(bn)) return bn;  // batchNumber 8-9 số → dùng
    if (/^\d{8}$/.test(raw)) return raw;  // importDate 8 số → dùng
    return bn;                             // fallback
  }

  private getImdKeyFromImportDate(d: Date | null | undefined): string {
    return d ? d.toLocaleDateString('en-GB').split('/').join('') : new Date().toLocaleDateString('en-GB').split('/').join('');
  }

  /**
   * IMD dùng để so khớp/in QR.
   * - Nếu có `batchNumber` dạng chữ số (vd 20042026 hoặc 2004202601) thì dùng toàn bộ phần số đó.
   * - Nếu không có thì fallback về `importDate` (8 số DDMMYYYY).
   */
  private getImdKeyForMaterial(material: InventoryMaterial): string {
    const b = String((material as any)?.batchNumber ?? '').trim();
    if (b) {
      const m = /^(\d{8,})/.exec(b);
      if (m) return m[1];
    }
    return this.getImdKeyFromImportDate(material?.importDate);
  }

  private buildReprintFlagItemFromInventoryRow(m: InventoryMaterial): { docId: string; factory: 'ASM1' | 'ASM2'; materialCode: string; poNumber: string; imdKey: string } {
    const imdKey = this.getImdKeyForMaterial(m);
    const factory = this.selectedFactory as 'ASM1' | 'ASM2';
    const docId = this.labelReprintFlags.buildDocId(factory, m.materialCode, m.poNumber || '', imdKey);
    return { docId, factory, materialCode: m.materialCode, poNumber: m.poNumber || '', imdKey };
  }

  openTemLePopup(): void {
    this.showTemLePopup = true;
    this.temLeQrText = '';
    this.temLeSplitQty = null;
    this.temLeError = '';
    this.temLeParsed = null;
    this.ensureTemLeSuffixPool();

    // Scanner (keyboard wedge) will type into focused input
    setTimeout(() => {
      const el = document.getElementById('tem-le-scan-input-asm1') as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 50);
  }

  closeTemLePopup(): void {
    this.showTemLePopup = false;
    this.temLeQrText = '';
    this.temLeSplitQty = null;
    this.temLeError = '';
    this.temLeParsed = null;
  }

  private normalizeMaterialCodeUpper(raw: string): string {
    return (raw || '').toString().trim().toUpperCase();
  }

  private buildTemInLaiPrintedDocId(materialCode: string): string {
    const mc = this.normalizeMaterialCodeUpper(materialCode);
    return `${this.selectedFactory}__${mc}`.replace(/[\/\\\s]+/g, '_').slice(0, 200);
  }

  private async loadTemInLaiPrintedCodes(): Promise<void> {
    try {
      const snap = await this.firestore.collection(this.TEM_INLAI_PRINTED_COLLECTION, (ref) =>
        ref.where('factory', '==', this.selectedFactory).limit(5000)
      ).get().toPromise();
      this.temInLaiPrintedCodes.clear();
      if (snap && !snap.empty) {
        for (const doc of snap.docs) {
          const d = doc.data() as any;
          const mc = this.normalizeMaterialCodeUpper(d?.materialCode || doc.id);
          if (mc) this.temInLaiPrintedCodes.add(mc);
        }
      }
    } catch (e) {
      console.warn('[TemInLai] load printed codes failed', e);
    }
  }

  openTemInLaiPopup(): void {
    this.showTemInLaiPopup = true;
    this.temInLaiLsxInput = '';
    this.temInLaiError = '';
    this.temInLaiBusy = false;
    this.temInLaiItems = [];
    this.temInLaiShowAdd = false;
    this.temInLaiAddCodeInput = '';
    void this.loadTemInLaiPrintedCodes();
    setTimeout(() => {
      const el = document.getElementById('tem-inlai-lsx-input-asm1') as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 50);
  }

  closeTemInLaiPopup(): void {
    this.showTemInLaiPopup = false;
    this.temInLaiLsxInput = '';
    this.temInLaiError = '';
    this.temInLaiBusy = false;
    this.temInLaiItems = [];
    this.temInLaiShowAdd = false;
    this.temInLaiAddCodeInput = '';
  }

  openTemThungPopup(): void {
    this.showTemThungPopup = true;
    this.temThungCodeInput = '';
    this.temThungError = '';
    this.temThungBusy = false;
    this.temThungSearching = false;
    this.temThungLabelCount = 1;
    this.temThungCandidates = [];
    this.temThungSelectedKey = null;
    setTimeout(() => {
      const el = document.getElementById('tem-thung-code-input-asm1') as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 50);
  }

  closeTemThungPopup(): void {
    this.showTemThungPopup = false;
    this.temThungCodeInput = '';
    this.temThungError = '';
    this.temThungBusy = false;
    this.temThungSearching = false;
    this.temThungLabelCount = 1;
    this.temThungCandidates = [];
    this.temThungSelectedKey = null;
  }

  /** Mã tem thùng: B + đúng 6 chữ số (vd B001680). */
  private parseTemThungMaterialCode(raw: string): string | null {
    const s = this.normalizeMaterialCodeUpper(raw);
    const m = /^B(\d{6})$/.exec(s);
    return m ? `B${m[1]}` : null;
  }

  onTemThungCodeInputChange(): void {
    const code = this.parseTemThungMaterialCode(this.temThungCodeInput);
    if (!code) {
      if (!this.temThungCodeInput.trim()) {
        this.temThungCandidates = [];
        this.temThungError = '';
        this.temThungSelectedKey = null;
      }
      return;
    }
    void this.loadTemThungCandidatesFromCode(code);
  }

  onTemThungCodeEnter(): void {
    const code = this.parseTemThungMaterialCode(this.temThungCodeInput);
    if (!code) {
      this.temThungError = 'Mã phải dạng B + 6 số (vd: B001680).';
      this.temThungCandidates = [];
      this.temThungSelectedKey = null;
      return;
    }
    void this.loadTemThungCandidatesFromCode(code);
  }

  selectTemThungRow(rowKey: string): void {
    this.temThungSelectedKey = rowKey;
    this.temThungError = '';
  }

  private async loadTemThungCandidatesFromCode(code: string): Promise<void> {
    this.temThungSearching = true;
    this.temThungError = '';
    this.temThungCandidates = [];
    this.temThungSelectedKey = null;
    try {
      const allRows = await this.fetchInventoryRowsByMaterialCodes([code]);
      const rows = allRows.filter((m) => this.calculateCurrentStock(m) > 0);
      if (rows.length === 0) {
        this.temThungError = `Không có dòng tồn kho > 0 cho mã ${code}.`;
        return;
      }
      this.temThungCandidates = rows
        .map((m) => ({
          rowKey: String(m.id || `${m.materialCode}|${m.poNumber}|${this.getDisplayIMD(m)}`),
          material: m,
          materialCode: m.materialCode,
          poNumber: m.poNumber || '',
          imd: this.getDisplayIMD(m),
          stock: this.calculateCurrentStock(m)
        }))
        .sort((a, b) => {
          const po = a.poNumber.localeCompare(b.poNumber);
          if (po !== 0) return po;
          return a.imd.localeCompare(b.imd);
        });
    } catch (e: any) {
      console.error('[TemThung] load candidates failed', e);
      this.temThungError = e?.message || 'Lỗi khi tải tồn kho.';
    } finally {
      this.temThungSearching = false;
    }
  }

  async printTemThungLabels(): Promise<void> {
    const selected = this.temThungCandidates.find((c) => c.rowKey === this.temThungSelectedKey);
    if (!selected) {
      this.temThungError = 'Chọn một dòng (Mã + PO + IMD) cần in.';
      return;
    }
    const n = Math.max(1, Math.floor(Number(this.temThungLabelCount) || 0));
    if (!Number.isFinite(n) || n < 1) {
      this.temThungError = 'Số tem phải ≥ 1.';
      return;
    }
    this.temThungBusy = true;
    this.temThungError = '';
    try {
      const QRCode = await import('qrcode') as any;
      const mat = selected.materialCode.trim();
      const po = selected.poNumber.trim();
      const imd = selected.imd.trim();
      const qrImages: Array<{ image: string; qrData: string; index: number }> = [];
      for (let i = 1; i <= n; i++) {
        const qrData =
          n === 1 ? `${mat}|${po}||${imd}` : `${mat}|${po}||${imd}-${i}/${n}`;
        const qrImage = await QRCode.toDataURL(qrData, {
          width: 240,
          margin: 1,
          color: { dark: '#000000', light: '#FFFFFF' }
        });
        qrImages.push({ image: qrImage, qrData, index: i });
      }
      this.createQRPrintWindow(qrImages, selected.material, false, true);
      this.closeTemThungPopup();
    } catch (e: any) {
      console.error('[TemThung] print failed', e);
      this.temThungError = e?.message || 'Lỗi khi in tem thùng.';
    } finally {
      this.temThungBusy = false;
    }
  }

  /** Mở popup Tem Thùng cho 1 dòng đã chọn sẵn trong bảng (cột Tem Thùng). */
  openTemThungColumnPopup(material: InventoryMaterial): void {
    this.temThungColumnMaterial = material;
    this.temThungColumnQtyInput = null;
    this.temThungColumnError = '';
    this.temThungColumnBusy = false;
    this.showTemThungColumnPopup = true;
    setTimeout(() => {
      const el = document.getElementById('tem-thung-column-qty-input-asm1') as HTMLInputElement | null;
      el?.focus();
    }, 50);
  }

  closeTemThungColumnPopup(): void {
    this.showTemThungColumnPopup = false;
    this.temThungColumnMaterial = null;
    this.temThungColumnQtyInput = null;
    this.temThungColumnError = '';
    this.temThungColumnBusy = false;
  }

  /**
   * In Tem Thùng cho dòng đã chọn: số tem = tồn kho hiện tại ÷ lượng tem thùng nhập vào.
   * Nội dung QR gắn tiền tố ẩn `TT:` (không hiện trên tem in) để Outbound nhận diện và áp dụng
   * luật Xuất thùng — không tạo thêm lượt đọc Firestore (chỉ dùng dữ liệu dòng đã có sẵn).
   */
  async printTemThungColumnLabels(): Promise<void> {
    const material = this.temThungColumnMaterial;
    if (!material) return;
    const qtyPerLabel = Number(this.temThungColumnQtyInput);
    if (!Number.isFinite(qtyPerLabel) || qtyPerLabel <= 0) {
      this.temThungColumnError = 'Vui lòng nhập lượng tem thùng > 0.';
      return;
    }
    const stock = this.calculateCurrentStock(material);
    if (!stock || stock <= 0) {
      this.temThungColumnError = 'Mã này không có tồn kho > 0.';
      return;
    }
    this.temThungColumnBusy = true;
    this.temThungColumnError = '';
    try {
      const QRCode = await import('qrcode') as any;
      const fullCount = Math.floor(stock / qtyPerLabel + 1e-9);
      let remainder = stock - fullCount * qtyPerLabel;
      remainder = Math.round(remainder * 10000) / 10000;
      if (remainder < 1e-9) remainder = 0;
      const n = fullCount + (remainder > 0 ? 1 : 0);
      if (n < 1) {
        this.temThungColumnError = 'Không tính được số tem — kiểm tra lại lượng tem thùng.';
        return;
      }
      const importDateStr = this.getImdKeyForMaterial(material);
      const qrImages: Array<{ image: string; qrData: string; index: number }> = [];
      for (let i = 1; i <= n; i++) {
        const qty = i <= fullCount ? qtyPerLabel : remainder;
        const qrData = buildTemThungQrData(material.materialCode, material.poNumber || '', qty, `${importDateStr}-${i}/${n}`);
        const image = await QRCode.toDataURL(qrData, {
          width: 240,
          margin: 1,
          color: { dark: '#000000', light: '#FFFFFF' }
        });
        qrImages.push({ image, qrData, index: i });
      }
      this.createQRPrintWindow(qrImages, material, false, false);
      this.closeTemThungColumnPopup();
    } catch (e: any) {
      console.error('[TemThungColumn] print failed', e);
      this.temThungColumnError = e?.message || 'Lỗi khi in tem thùng.';
    } finally {
      this.temThungColumnBusy = false;
    }
  }

  onTemInLaiLsxEnter(): void {
    void this.loadTemInLaiListFromLsx();
  }

  private async fetchInventoryRowsByMaterialCodes(materialCodes: string[]): Promise<InventoryMaterial[]> {
    const out: InventoryMaterial[] = [];
    const uniq = Array.from(new Set(materialCodes.map((x) => this.normalizeMaterialCodeUpper(x)).filter(Boolean)));
    for (const code of uniq) {
      try {
        const snap = await this.firestore.collection('inventory-materials', (ref) =>
          ref.where('factory', '==', this.selectedFactory).where('materialCode', '==', code).limit(2000)
        ).get().toPromise();
        if (!snap || snap.empty) continue;
        for (const doc of snap.docs) {
          const d = doc.data() as any;
          out.push({
            id: doc.id,
            factory: d.factory || this.selectedFactory,
            importDate: this.parseImportDate(d.importDate),
            receivedDate: d.receivedDate?.toDate?.() || undefined,
            batchNumber: this.resolveRawImd(d),
            materialCode: d.materialCode || '',
            materialName: d.materialName || '',
            poNumber: d.poNumber || '',
            openingStock: d.openingStock || null,
            quantity: d.quantity || 0,
            unit: d.unit || '',
            exported: d.exported || 0,
            xt: d.xt || 0,
            stock: d.stock || 0,
            location: this.locationFromInventoryDoc(d) || d.location || '',
            palletId: d.palletId || '',
            type: d.type || '',
            expiryDate: d.expiryDate?.toDate?.() || new Date(),
            qualityCheck: d.qualityCheck || false,
            isReceived: d.isReceived || false,
            notes: d.notes || '',
            rollsOrBags: d.rollsOrBags || '',
            supplier: d.supplier || '',
            remarks: d.remarks || '',
            isCompleted: !!d.isCompleted,
            totalBags: Math.floor(Number(d.totalBags ?? 0)),
            bagTrackingInitialized: !!d.bagTrackingInitialized
          } as any);
        }
      } catch (e) {
        console.warn('[TemInLai] fetch inventory rows for', code, e);
      }
    }
    return out;
  }

  private async loadTemInLaiListFromLsx(): Promise<void> {
    this.temInLaiError = '';
    const raw = this.temInLaiLsxInput.trim();
    if (!raw) {
      this.temInLaiError = 'Vui lòng scan hoặc nhập lệnh sản xuất (LSX).';
      return;
    }
    if (this.temInLaiBusy) return;
    this.temInLaiBusy = true;
    this.temInLaiItems = [];
    try {
      await this.loadTemInLaiPrintedCodes();
      const pxkRaw = await this.temXuatKho.loadPxkLinesForLsx(this.selectedFactory, raw);
      if (!pxkRaw.length) {
        this.temInLaiError = 'Không tìm thấy PXK cho LSX này. Kiểm tra đã import PXK.';
        return;
      }
      const merged = this.mergePxkLinesForTem(pxkRaw);
      const codes = Array.from(new Set(merged.map((l) => this.normalizeMaterialCodeUpper(l.materialCode)).filter(Boolean)));
      if (!codes.length) {
        this.temInLaiError = 'Không có mã hàng trong PXK của LSX này.';
        return;
      }
      const invRows = await this.fetchInventoryRowsByMaterialCodes(codes);
      const cutoffMs = this.TEM_MOI_CUTOFF.getTime();
      const eligibleByCode = new Map<string, number>();
      for (const r of invRows) {
        const mc = this.normalizeMaterialCodeUpper(r.materialCode);
        const t = r.importDate?.getTime?.() || 0;
        if (mc && t > 0 && t < cutoffMs) {
          eligibleByCode.set(mc, (eligibleByCode.get(mc) || 0) + 1);
        }
      }
      this.temInLaiItems = codes
        .sort((a, b) => a.localeCompare(b, 'vi'))
        .map((mc) => ({
          materialCode: mc,
          eligibleRowCount: eligibleByCode.get(mc) || 0,
          alreadyPrinted: this.temInLaiPrintedCodes.has(mc),
          blockedByRuleBag: this.shouldSkipMaterialForTemXuatKhoExport(mc)
        }));
      if (this.temInLaiItems.every((x) => x.eligibleRowCount === 0)) {
        this.temInLaiError = 'Không có dòng kho IMD trước 01/04/2026 cho các mã trong LSX này.';
      }
    } catch (e) {
      console.error('Tem In Lại error:', e);
      this.temInLaiError = (e as Error)?.message || 'Lỗi khi đọc LSX.';
    } finally {
      this.temInLaiBusy = false;
    }
  }

  async addPrintedCodeManual(): Promise<void> {
    const mc = this.normalizeMaterialCodeUpper(this.temInLaiAddCodeInput);
    if (!mc) return;
    try {
      await this.firestore.collection(this.TEM_INLAI_PRINTED_COLLECTION).doc(this.buildTemInLaiPrintedDocId(mc)).set(
        {
          factory: this.selectedFactory,
          materialCode: mc,
          source: 'manual',
          updatedAt: firebase.default.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      this.temInLaiPrintedCodes.add(mc);
      this.temInLaiAddCodeInput = '';
      this.temInLaiItems = this.temInLaiItems.map((it) =>
        it.materialCode === mc ? { ...it, alreadyPrinted: true } : it
      );
    } catch (e) {
      console.warn('[TemInLai] manual add failed', e);
    }
  }

  triggerPrintedCodesImport(): void {
    const el = document.getElementById('tem-inlai-import-file-asm1') as HTMLInputElement | null;
    if (!el) return;
    el.value = '';
    el.click();
  }

  async onPrintedCodesFileSelected(event: Event): Promise<void> {
    const XLSX = await import('xlsx');
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;
    if (this.temInLaiImportBusy) return;
    this.temInLaiImportBusy = true;
    this.temInLaiError = '';
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheetName = wb.SheetNames?.[0];
      if (!sheetName) {
        this.temInLaiError = 'File không có sheet.';
        return;
      }
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as any[][];
      const codes: string[] = [];
      for (const r of rows) {
        const v = r?.[0];
        const mc = this.normalizeMaterialCodeUpper(String(v ?? ''));
        if (mc) codes.push(mc);
      }
      const uniq = Array.from(new Set(codes)).filter(Boolean);
      if (uniq.length === 0) {
        this.temInLaiError = 'Không đọc được mã nào ở cột A.';
        return;
      }

      // Write to Firestore in batches (<=500 ops/batch)
      const chunks: string[][] = [];
      for (let i = 0; i < uniq.length; i += 450) {
        chunks.push(uniq.slice(i, i + 450));
      }
      for (const ch of chunks) {
        const batch = this.firestore.firestore.batch();
        for (const mc of ch) {
          const docId = this.buildTemInLaiPrintedDocId(mc);
          const ref = this.firestore.collection(this.TEM_INLAI_PRINTED_COLLECTION).doc(docId).ref;
          batch.set(
            ref,
            {
              factory: this.selectedFactory,
              materialCode: mc,
              source: 'import',
              updatedAt: firebase.default.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
          );
        }
        await batch.commit();
      }

      for (const mc of uniq) this.temInLaiPrintedCodes.add(mc);
      this.temInLaiItems = this.temInLaiItems.map((it) =>
        this.temInLaiPrintedCodes.has(it.materialCode) ? { ...it, alreadyPrinted: true } : it
      );
      this.temInLaiError = `✅ Đã import ${uniq.length} mã đã in.`;
    } catch (e) {
      console.warn('[TemInLai] import failed', e);
      this.temInLaiError = 'Lỗi import file (chỉ nhận Excel/CSV, mã nằm ở cột A).';
    } finally {
      this.temInLaiImportBusy = false;
    }
  }

  async printTemInLaiAll(): Promise<void> {
    const QRCode = await import('qrcode') as any;
    this.temInLaiError = '';
    if (this.temInLaiBusy) return;
    const lsx = this.temInLaiLsxInput.trim();
    const codesToPrint = this.temInLaiItems
      .filter((x) => x.eligibleRowCount > 0 && !x.alreadyPrinted && !x.blockedByRuleBag)
      .map((x) => x.materialCode);
    if (!codesToPrint.length) {
      this.temInLaiError = 'Không có mã nào cần in (hoặc tất cả đã in / không có IMD cũ).';
      return;
    }
    this.temInLaiBusy = true;
    try {
      const invRowsAll = await this.fetchInventoryRowsByMaterialCodes(codesToPrint);
      const cutoffMs = this.TEM_MOI_CUTOFF.getTime();
      const invRows = invRowsAll.filter((r) => {
        const t = r.importDate?.getTime?.() || 0;
        return t > 0 && t < cutoffMs;
      });
      const payloads: { qrData: string }[] = [];
      for (const r of invRows) {
        const mat = this.normalizeMaterialCodeUpper(r.materialCode);
        const po = (r.poNumber || '').trim();
        const sp = this.getEffectiveStandardPacking(r);
        if (!sp || sp <= 0) continue;
        const rowStock = Math.max(0, this.calculateCurrentStock(r));
        if (rowStock <= 0) continue;
        const bagTotal = this.effectiveTotalBags(r);
        if (!bagTotal || bagTotal < 1) continue;
        const imdKey = this.getImdKeyForMaterial(r);
        const lastBagCapacity = Math.max(0, Math.round((rowStock - sp * (bagTotal - 1)) * 10000) / 10000);
        const capOfBag = (i: number) => (i >= bagTotal ? (lastBagCapacity > 0 ? lastBagCapacity : sp) : sp);
        for (let i = 1; i <= bagTotal; i++) {
          const qty = capOfBag(i);
          if (qty <= 1e-9) continue;
          const p4 = `${imdKey}-${i}/${bagTotal}`;
          payloads.push({ qrData: `${mat}|${po}|${qty}|${p4}` });
        }
      }
      if (!payloads.length) {
        this.temInLaiError = 'Không tạo được tem nào để in (kiểm tra Standard Packing / BAG / tồn kho).';
        return;
      }

      const printSequence: any[] = [{ kind: 'lsxHeader', lsxText: `IN LẠI TEM — ${lsx}`, qrData: '' }];
      const byMat = new Map<string, { qrData: string }[]>();
      for (const p of payloads) {
        const parts = p.qrData.split('|');
        const mat = (parts[0] || '').trim();
        if (!byMat.has(mat)) byMat.set(mat, []);
        byMat.get(mat)!.push(p);
      }
      const orderedMats = Array.from(byMat.keys()).sort((a, b) => a.localeCompare(b, 'vi'));
      for (const mat of orderedMats) {
        printSequence.push({ kind: 'lsxHeader', lsxText: mat, qrData: '' });
        for (const p of byMat.get(mat) || []) {
          printSequence.push(p);
        }
        printSequence.push({ kind: 'spacer', qrData: '' });
      }

      const qrImages: any[] = [];
      let idx = 1;
      for (const it of printSequence) {
        if (it?.kind === 'lsxHeader' || it?.kind === 'spacer') {
          qrImages.push(it);
          continue;
        }
        const qrImage = await QRCode.toDataURL(it.qrData, {
          width: 240,
          margin: 1,
          color: { dark: '#000000', light: '#FFFFFF' }
        });
        const parts = String(it.qrData || '').split('|');
        qrImages.push({
          image: qrImage,
          qrData: it.qrData,
          index: idx++,
          materialCode: parts[0] || '',
          poNumber: parts[1] || '',
          unitNumber: Number(parts[2]) || 0
        });
      }

      const fakeMaterial: InventoryMaterial = {
        factory: this.selectedFactory,
        importDate: new Date(),
        batchNumber: '',
        materialCode: 'REPRINT',
        poNumber: '',
        openingStock: null,
        quantity: 0,
        unit: '',
        location: '',
        type: '',
        expiryDate: new Date(),
        qualityCheck: false,
        isReceived: false,
        notes: '',
        rollsOrBags: '',
        supplier: '',
        remarks: '',
        isCompleted: false
      } as any;
      this.createQRPrintWindow(qrImages, fakeMaterial, true);

      const batch = this.firestore.firestore.batch();
      for (const mc of orderedMats) {
        const docId = this.buildTemInLaiPrintedDocId(mc);
        const ref = this.firestore.collection(this.TEM_INLAI_PRINTED_COLLECTION).doc(docId).ref;
        batch.set(
          ref,
          {
            factory: this.selectedFactory,
            materialCode: mc,
            source: 'print',
            lastLsx: lsx || null,
            updatedAt: firebase.default.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      }
      await batch.commit();
      for (const mc of orderedMats) this.temInLaiPrintedCodes.add(mc);
      this.temInLaiItems = this.temInLaiItems.map((it) =>
        orderedMats.includes(it.materialCode) ? { ...it, alreadyPrinted: true } : it
      );
    } catch (e) {
      console.error('[TemInLai] print failed', e);
      this.temInLaiError = (e as Error)?.message || 'Lỗi khi in tem.';
    } finally {
      this.temInLaiBusy = false;
    }
  }

  onTemLeQrTextChanged(): void {
    this.temLeError = '';
    this.temLeParsed = this.parseTemLeQrText(this.temLeQrText);
  }

  onTemLeQrEnter(): void {
    // Ensure latest parse, then move focus to split qty
    this.onTemLeQrTextChanged();
    if (!this.temLeParsed || this.temLeError) return;
    setTimeout(() => {
      const el = document.getElementById('tem-le-split-qty-asm1') as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 0);
  }

  private parseTemLeQrText(qrText: string): { materialCode: string; po: string; quantity: number; p4: string } | null {
    const raw = String(qrText || '').trim();
    if (!raw) return null;
    const parts = raw.split('|').map(x => (x ?? '').toString().trim());
    if (parts.length < 4) {
      this.temLeError = 'QR không hợp lệ. Định dạng: Mã|PO|Số lượng|IMD-bịch/tổng';
      return null;
    }
    const materialCode = parts[0] || '';
    const po = parts[1] || '';
    const qty = Number(String(parts[2] || '').replace(/,/g, '').trim());
    const p4 = parts[3] || '';
    if (!materialCode || !po || !Number.isFinite(qty) || qty <= 0 || !p4) {
      this.temLeError = 'QR không hợp lệ. Vui lòng scan lại tem.';
      return null;
    }
    return { materialCode, po, quantity: qty, p4 };
  }

  async confirmTemLeSplitAndPrint(): Promise<void> {
    const QRCode = await import('qrcode') as any;
    this.temLeError = '';

    const parsed = this.temLeParsed || this.parseTemLeQrText(this.temLeQrText);
    if (!parsed) return;

    const splitQty = Number(this.temLeSplitQty);
    if (!Number.isFinite(splitQty) || splitQty <= 0) {
      this.temLeError = 'Vui lòng nhập số lượng cần tách > 0';
      return;
    }
    if (splitQty >= parsed.quantity) {
      this.temLeError = 'Số lượng tách phải nhỏ hơn số lượng trên tem';
      return;
    }

    // Round to 4 decimals to avoid float noise
    const round4 = (n: number) => Math.round(n * 10000) / 10000;
    const remainingQty = round4(parsed.quantity - splitQty);
    const splitQtyR = round4(splitQty);

    const baseP4 = String(parsed.p4 || '').trim().replace(/\(T\d+\)\s*$/i, '');
    const splitP4 = `${baseP4}(T1${this.nextTemLeSuffix6()})`; // Tem tách có đuôi lẽ (6 số)
    const remainP4 = baseP4;         // Tem gốc còn lại giữ nguyên

    const splitQrData = `${parsed.materialCode}|${parsed.po}|${splitQtyR}|${splitP4}`;
    const remainQrData = `${parsed.materialCode}|${parsed.po}|${remainingQty}|${remainP4}`;

    try {
      const [splitImg, remainImg] = await Promise.all([
        QRCode.toDataURL(splitQrData, { width: 240, margin: 1, color: { dark: '#000000', light: '#FFFFFF' } }),
        QRCode.toDataURL(remainQrData, { width: 240, margin: 1, color: { dark: '#000000', light: '#FFFFFF' } })
      ]);

      const qrImages = [
        { image: splitImg, qrData: splitQrData, index: 1 },
        { image: remainImg, qrData: remainQrData, index: 2 }
      ];

      const fakeMaterial: InventoryMaterial = {
        factory: this.selectedFactory,
        importDate: new Date(),
        batchNumber: '',
        materialCode: parsed.materialCode,
        poNumber: parsed.po,
        openingStock: null,
        quantity: 0,
        unit: '',
        location: '',
        type: '',
        expiryDate: new Date(),
        qualityCheck: false,
        isReceived: false,
        notes: '',
        rollsOrBags: '',
        supplier: '',
        remarks: '',
        isCompleted: false
      };

      this.createQRPrintWindow(qrImages, fakeMaterial, true);
      this.closeTemLePopup();
    } catch (e) {
      console.error('❌ Tem Lẽ print error:', e);
      this.temLeError = 'Lỗi khi tạo/in tem. Vui lòng thử lại.';
    }
  }

  openTemXuatKhoPopup(): void {
    this.showTemXuatKhoPopup = true;
    this.temXuatLsxInput = '';
    this.temXuatError = '';
    setTimeout(() => {
      const el = document.getElementById('tem-xuat-lsx-input-asm1') as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 50);
  }

  closeTemXuatKhoPopup(): void {
    this.showTemXuatKhoPopup = false;
    this.temXuatLsxInput = '';
    this.temXuatError = '';
  }

  onTemXuatLsxEnter(): void {
    void this.confirmTemXuatKhoPrint();
  }

  private normPoForPxk(po: string): string {
    return String(po || '')
      .trim()
      .toUpperCase()
      .replace(/\s/g, '');
  }

  private normMatForPxk(m: string): string {
    return String(m || '')
      .trim()
      .toUpperCase();
  }

  /**
   * Tem Xuất Kho: không in — mã bắt đầu bằng R; mã thuộc nhóm Rule Bag đang OFF (4 ký tự đầu, `qtyBagRuleByPrefix[prefix] === false`).
   */
  private shouldSkipMaterialForTemXuatKhoExport(materialCode: string): boolean {
    const c = String(materialCode || '').trim().toUpperCase();
    if (!c) {
      return true;
    }
    if (c.startsWith('R')) {
      return true;
    }
    const p = this.getMaterialCodePrefix4(c);
    return !!(p && this.qtyBagRuleByPrefix[p] === false);
  }

  /** Gộp các dòng PXK trùng Mã+PO (cộng lượng). */
  private mergePxkLinesForTem(lines: PxkLineExport[]): { materialCode: string; po: string; quantity: number }[] {
    const map = new Map<string, { materialCode: string; po: string; q: number }>();
    for (const ln of lines) {
      const mk = this.normMatForPxk(ln.materialCode);
      const pk = this.normPoForPxk(ln.po);
      const key = `${mk}\0${pk}`;
      const add = Math.floor(Number(ln.quantity) || 0);
      if (add <= 0 || !mk) {
        continue;
      }
      const cur = map.get(key);
      if (!cur) {
        map.set(key, { materialCode: ln.materialCode.trim(), po: (ln.po || '').trim(), q: add });
      } else {
        cur.q += add;
      }
    }
    return Array.from(map.values()).map((x) => ({
      materialCode: x.materialCode,
      po: x.po,
      quantity: x.q
    }));
  }

  /**
   * Tải tồn kho từ Firebase theo mọi mã hàng xuất hiện trong PXK (không dùng ô tìm kiếm trên màn hình).
   */
  private async fetchInventoryRowsForPxkMerged(
    pxkLines: { materialCode: string; po: string; quantity: number }[]
  ): Promise<InventoryMaterial[]> {
    const codes = [...new Set(pxkLines.map((l) => this.normMatForPxk(l.materialCode)).filter(Boolean))];
    const merged: InventoryMaterial[] = [];
    for (const code of codes) {
      try {
        const querySnapshot = await this.firestore
          .collection('inventory-materials', (ref) =>
            ref.where('factory', '==', this.selectedFactory).where('materialCode', '==', code).limit(150)
          )
          .get()
          .toPromise();
        if (!querySnapshot?.docs?.length) {
          continue;
        }
        for (const doc of querySnapshot.docs) {
          merged.push(this.mapFirestoreDocToInventoryMaterialForPxk(doc));
        }
      } catch (e) {
        console.warn('[Tem Xuất Kho] fetch inventory for', code, e);
      }
    }
    return merged;
  }

  private mapFirestoreDocToInventoryMaterialForPxk(doc: { id: string; data: () => any }): InventoryMaterial {
    const data = doc.data() as any;
    const material = {
      id: doc.id,
      ...data,
      factory: this.selectedFactory,
      importDate: this.parseImportDate(data.importDate),
      batchNumber: this.resolveRawImd(data),
      receivedDate: data.receivedDate ? new Date(data.receivedDate.seconds * 1000) : new Date(),
      expiryDate: data.expiryDate ? new Date(data.expiryDate.seconds * 1000) : new Date(),
      openingStock: data.openingStock || null,
      xt: data.xt || 0,
      source: data.source || 'manual'
    } as InventoryMaterial;
    if (this.catalogLoaded && this.catalogCache.has(material.materialCode)) {
      const catalogItem = this.catalogCache.get(material.materialCode)!;
      material.materialName = catalogItem.materialName;
      material.unit = catalogItem.unit;
      if (!material.rollsOrBags || material.rollsOrBags === '' || material.rollsOrBags === '0') {
        const spCat = catalogItem.standardPacking;
        if (spCat && spCat > 0) {
          material.rollsOrBags = spCat.toString();
        }
      }
    }
    material.bagTrackingInitialized = !!data.bagTrackingInitialized;
    material.openingStockAtBagInit =
      typeof data.openingStockAtBagInit === 'number' ? data.openingStockAtBagInit : undefined;
    material.bagInput =
      material.bagTrackingInitialized
        ? ''
        : material.totalBags != null && Number(material.totalBags) > 0
          ? String(Math.floor(Number(material.totalBags)))
          : '';
    this.applyLocalDerivedBags(material);
    return material;
  }

  /**
   * Theo lượng xuất PXK: FIFO theo IMD (importDate), chia tem = Standard Packing,
   * phần lẻ một tem (giống logic in tem trên dòng tồn).
   * `inventoryRows` — từ Firebase theo mã PXK, không phải `inventoryMaterials` đang lọc theo search.
   */
  /** Khóa ổn định cho map lượng đã giả lập xuất theo dòng inventory (Tem Xuất Kho). */
  private pxkInventoryRowKey(m: InventoryMaterial): string {
    const id = m.id != null && String(m.id).trim() !== '' ? String(m.id).trim() : '';
    if (id) {
      return id;
    }
    const t = m.importDate?.getTime() ?? 0;
    return `${this.normMatForPxk(m.materialCode)}\0${this.normPoForPxk(m.poNumber)}\0${t}\0${String(m.batchNumber ?? '')}`;
  }

  /**
   * Tem xuất theo PXK (FIFO) + gom lượng đã lấy trên từng dòng để sau đó in thêm tem TỒN nếu còn kho.
   */
  private buildQrPayloadsForPxkLine(
    line: {
      materialCode: string;
      po: string;
      quantity: number;
    },
    inventoryRows: InventoryMaterial[],
    reprintedDocIds: Set<string>,
    printedFlagItemsOut: Map<
      string,
      { docId: string; factory: 'ASM1' | 'ASM2'; materialCode: string; poNumber: string; imdKey: string }
    >,
    usedBagsByRowKeyOut: Map<string, number>,
    exportedQtyByBagOut: Map<string, Map<number, number>>
  ): { payloads: { qrData: string }[]; consumed: Map<string, number> } {
    const consumed = new Map<string, number>();
    const mat = line.materialCode.trim();
    const po = (line.po || '').trim();
    const Q = Math.floor(Number(line.quantity) || 0);
    if (Q <= 0 || !mat) {
      return { payloads: [], consumed };
    }
    const matN = this.normMatForPxk(mat);
    const poN = this.normPoForPxk(po);
    const rows = inventoryRows
      .filter(
        (m) =>
          this.normMatForPxk(m.materialCode) === matN &&
          this.normPoForPxk(m.poNumber || '') === poN
      )
      .sort((a, b) => (a.importDate?.getTime() || 0) - (b.importDate?.getTime() || 0));

    let totalAvail = rows.reduce((s, m) => s + this.calculateCurrentStock(m), 0);
    if (totalAvail < Q) {
      throw new Error(
        `Không đủ tồn: ${mat} / PO ${po}. PXK cần ${Q}, tồn khả dụng ${totalAvail}.`
      );
    }

    let remaining = Q;
    const out: { qrData: string }[] = [];
    for (const m of rows) {
      if (remaining <= 0) {
        break;
      }
      let rowAvail = Math.min(this.calculateCurrentStock(m), remaining);
      if (rowAvail <= 0) {
        continue;
      }
      const sp = this.getEffectiveStandardPacking(m);
      if (!sp || sp <= 0) {
        throw new Error(`Thiếu Standard Packing (hoặc catalog) cho mã ${mat}.`);
      }
      const bagTotal = this.effectiveTotalBags(m);
      if (bagTotal <= 0) {
        const imdKey = this.getImdKeyForMaterial(m);
        throw new Error(`Thiếu BAG: ${mat} / PO ${po} / IMD ${imdKey}. Vui lòng nhập đủ cột BAG trước khi in.`);
      }
      const expectedBagsFromStock = this.computeTotalBagsFromStock(m);
      if (expectedBagsFromStock > 0 && bagTotal < expectedBagsFromStock) {
        const imdKey = this.getImdKeyForMaterial(m);
        throw new Error(
          `BAG không đủ: ${mat} / PO ${po} / IMD ${imdKey}. BAG=${bagTotal} nhưng tồn/SP cần tối thiểu ${expectedBagsFromStock}.`
        );
      }
      const importDateStr = this.getImdKeyForMaterial(m);
      const rowFlag = this.buildReprintFlagItemFromInventoryRow(m);
      const isTemMoi = !!m.importDate && m.importDate.getTime() >= this.TEM_MOI_CUTOFF.getTime();
      const isAlreadyReprinted = reprintedDocIds.has(rowFlag.docId);
      let bagIdx = 1;
      const rowKey = this.pxkInventoryRowKey(m);
      const rowStock = Math.max(0, this.calculateCurrentStock(m));
      const lastBagCapacity = Math.max(0, Math.round((rowStock - sp * (bagTotal - 1)) * 10000) / 10000);
      const capOfBag = (i: number) => (i >= bagTotal ? (lastBagCapacity > 0 ? lastBagCapacity : sp) : sp);
      const expMap = exportedQtyByBagOut.get(rowKey) || new Map<number, number>();
      if (!exportedQtyByBagOut.has(rowKey)) exportedQtyByBagOut.set(rowKey, expMap);
      while (rowAvail > 0 && remaining > 0) {
        if (bagIdx > bagTotal) {
          throw new Error(`BAG vượt quá tổng: ${mat} / PO ${po} / IMD ${importDateStr} (${bagIdx}/${bagTotal}).`);
        }
        const chunk = rowAvail >= sp ? sp : rowAvail;
        const p4Base = `${importDateStr}-${bagIdx}/${bagTotal}`;
        const p4 = chunk < sp ? `${p4Base}(T1${this.nextTemLeSuffix6()})` : p4Base;
        const qrData = `${mat}|${po}|${chunk}|${p4}`;
        // Chỉ in lại tem cho hàng nhập trước cutoff và chưa được in lại tem mẫu mới.
        if (!isTemMoi && !isAlreadyReprinted) {
          out.push({ qrData });
          printedFlagItemsOut.set(rowFlag.docId, rowFlag);
        }
        consumed.set(rowKey, (consumed.get(rowKey) || 0) + chunk);
        expMap.set(bagIdx, Math.round(((expMap.get(bagIdx) || 0) + chunk) * 10000) / 10000);
        rowAvail -= chunk;
        remaining -= chunk;
        bagIdx++;
      }
      // số bag đã dùng (để in tem tồn tiếp từ bag kế tiếp)
      usedBagsByRowKeyOut.set(rowKey, Math.max(usedBagsByRowKeyOut.get(rowKey) || 0, bagIdx - 1));
    }
    return { payloads: out, consumed };
  }

  private ensureTemLeSuffixPool(): void {
    if (this.temLeSuffixPool.length > 0) return;
    this.temLeSuffixPool = this.generateTemLeSuffixPool6(6);
  }

  private nextTemLeSuffix6(): string {
    this.ensureTemLeSuffixPool();
    const v = this.temLeSuffixPool.shift();
    if (v) return v;
    this.temLeSuffixPool = this.generateTemLeSuffixPool6(6);
    return this.temLeSuffixPool.shift() || this.random6Digits();
  }

  private generateTemLeSuffixPool6(count: number): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    while (out.length < count) {
      const v = this.random6Digits();
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }

  private random6Digits(): string {
    try {
      const a = new Uint32Array(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c: Crypto | undefined = (globalThis as any)?.crypto as Crypto | undefined;
      if (c?.getRandomValues) {
        c.getRandomValues(a);
        return String(a[0] % 1_000_000).padStart(6, '0');
      }
    } catch {
      // fallback below
    }
    return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  }

  /**
   * Sau khi phân bổ lượng xuất PXK (FIFO), mỗi dòng tồn thuộc mã+PO trong PXK còn dư → 1 tem TỒN (cùng format như in trên dòng).
   */
  private buildTonQrPayloadsAfterPxkExport(
    pxkLines: { materialCode: string; po: string; quantity: number }[],
    inventoryRows: InventoryMaterial[],
    consumedByRowKey: Map<string, number>,
    reprintedDocIds: Set<string>,
    printedFlagItemsOut: Map<
      string,
      { docId: string; factory: 'ASM1' | 'ASM2'; materialCode: string; poNumber: string; imdKey: string }
    >,
    usedBagsByRowKey: Map<string, number>,
    exportedQtyByBag: Map<string, Map<number, number>>
  ): { qrData: string }[] {
    const pxkKeys = new Set(
      pxkLines.map((l) => `${this.normMatForPxk(l.materialCode)}\0${this.normPoForPxk(l.po)}`)
    );
    const rows = inventoryRows
      .filter(
        (m) =>
          pxkKeys.has(`${this.normMatForPxk(m.materialCode)}\0${this.normPoForPxk(m.poNumber || '')}`)
      )
      .sort((a, b) => {
        const mc = this.normMatForPxk(a.materialCode).localeCompare(this.normMatForPxk(b.materialCode));
        if (mc !== 0) {
          return mc;
        }
        const po = this.normPoForPxk(a.poNumber || '').localeCompare(this.normPoForPxk(b.poNumber || ''));
        if (po !== 0) {
          return po;
        }
        return (a.importDate?.getTime() || 0) - (b.importDate?.getTime() || 0);
      });
    const out: { qrData: string }[] = [];
    for (const m of rows) {
      const key = this.pxkInventoryRowKey(m);
      const taken = consumedByRowKey.get(key) || 0;
      const rem = Math.max(
        0,
        Math.round((this.calculateCurrentStock(m) - taken) * 10000) / 10000
      );
      if (rem <= 1e-6) {
        continue;
      }
      const bagTotal = this.effectiveTotalBags(m);
      if (bagTotal <= 0) {
        continue;
      }
      const importDateStr = this.getImdKeyForMaterial(m);
      const rowFlag = this.buildReprintFlagItemFromInventoryRow(m);
      const isTemMoi = !!m.importDate && m.importDate.getTime() >= this.TEM_MOI_CUTOFF.getTime();
      const isAlreadyReprinted = reprintedDocIds.has(rowFlag.docId);
      const mat = m.materialCode.trim();
      const po = (m.poNumber || '').trim();
      const sp = this.getEffectiveStandardPacking(m);
      if (!sp || sp <= 0) {
        continue;
      }
      if (!isTemMoi && !isAlreadyReprinted) {
        const expMap = exportedQtyByBag.get(key) || new Map<number, number>();
        const rowStock = Math.max(0, this.calculateCurrentStock(m));
        const lastBagCapacity = Math.max(0, Math.round((rowStock - sp * (bagTotal - 1)) * 10000) / 10000);
        const capOfBag = (i: number) => (i >= bagTotal ? (lastBagCapacity > 0 ? lastBagCapacity : sp) : sp);
        for (let i = 1; i <= bagTotal; i++) {
          const cap = capOfBag(i);
          const exportedInBag = Math.round((Number(expMap.get(i) || 0)) * 10000) / 10000;
          const remainInBag = Math.round((cap - exportedInBag) * 10000) / 10000;
          if (remainInBag <= 1e-9) continue;
          const p4Base = `${importDateStr}-${i}/${bagTotal}`;
          const p4 = remainInBag < sp ? `${p4Base}(T1${this.nextTemLeSuffix6()})` : p4Base;
          // NOTE: nếu bag bị tách (exportedInBag > 0) thì tem tồn của bag này vẫn in cùng số i/tổng.
          // remainInBag < sp có thể xảy ra ở bag cuối hoặc bag bị tách.
          const qrData = `${mat}|${po}|${remainInBag}|${p4}`;
          out.push({ qrData });
          printedFlagItemsOut.set(rowFlag.docId, rowFlag);
        }
      }
    }
    return out;
  }

  async confirmTemXuatKhoPrint(): Promise<void> {
    const QRCode = await import('qrcode') as any;
    this.temXuatError = '';
    const raw = this.temXuatLsxInput.trim();
    if (!raw) {
      this.temXuatError = 'Vui lòng scan hoặc nhập lệnh sản xuất (LSX).';
      return;
    }
    if (this.temXuatBusy) {
      return;
    }
    this.temXuatBusy = true;
    try {
      const pxkRaw = await this.temXuatKho.loadPxkLinesForLsx(this.selectedFactory, raw);
      if (!pxkRaw.length) {
        this.temXuatError =
          'Không tìm thấy PXK cho LSX này. Kiểm tra đã import PXK (Work Order / pxk-import-data).';
        return;
      }
      const pxkMerged = this.mergePxkLinesForTem(pxkRaw);
      const pxkLines = pxkMerged.filter((l) => !this.shouldSkipMaterialForTemXuatKhoExport(l.materialCode));
      if (!pxkLines.length) {
        this.temXuatError =
          'Không còn dòng PXK nào đủ điều kiện in tem (đã loại mã R và nhóm Rule Bag đang OFF).';
        return;
      }
      const inventoryRows = await this.fetchInventoryRowsForPxkMerged(pxkLines);

      // 1) Load cờ "đã in lại tem mẫu mới" cho các dòng tồn liên quan (theo Mã + PO + IMD).
      const pxkKeys = new Set(
        pxkLines.map((l) => `${this.normMatForPxk(l.materialCode)}\0${this.normPoForPxk(l.po)}`)
      );
      const flagItems = inventoryRows
        .filter((m) =>
          pxkKeys.has(`${this.normMatForPxk(m.materialCode)}\0${this.normPoForPxk(m.poNumber || '')}`)
        )
        .map((m) => this.buildReprintFlagItemFromInventoryRow(m));
      const preCutoffFlagItems = inventoryRows.filter((m) => {
        if (!pxkKeys.has(`${this.normMatForPxk(m.materialCode)}\0${this.normPoForPxk(m.poNumber || '')}`)) return false;
        const t = m.importDate?.getTime?.() || 0;
        return t > 0 && t < this.TEM_MOI_CUTOFF.getTime();
      });
      const postCutoffCount = inventoryRows.filter((m) => {
        if (!pxkKeys.has(`${this.normMatForPxk(m.materialCode)}\0${this.normPoForPxk(m.poNumber || '')}`)) return false;
        const t = m.importDate?.getTime?.() || 0;
        return t >= this.TEM_MOI_CUTOFF.getTime();
      }).length;
      const reprintedDocIds = this.REPRINT_FLAG_RULE_ENABLED
        ? await this.labelReprintFlags.getExistingFlagsByDocId(flagItems.map((x) => x.docId))
        : new Set<string>();

      const exportPayloads: { qrData: string }[] = [];
      const consumedByRowKey = new Map<string, number>();
      const printedFlagItems = new Map<string, { docId: string; factory: 'ASM1' | 'ASM2'; materialCode: string; poNumber: string; imdKey: string }>();
      const usedBagsByRowKey = new Map<string, number>();
      const exportedQtyByBag = new Map<string, Map<number, number>>();
      const notEnoughLines: string[] = [];
      for (const ln of pxkLines) {
        try {
          const { payloads, consumed } = this.buildQrPayloadsForPxkLine(
            ln,
            inventoryRows,
            reprintedDocIds,
            printedFlagItems
            , usedBagsByRowKey
            , exportedQtyByBag
          );
          exportPayloads.push(...payloads);
          for (const [k, v] of consumed) {
            consumedByRowKey.set(k, (consumedByRowKey.get(k) || 0) + v);
          }
        } catch (e) {
          // Không đủ tồn / thiếu Standard Packing... → vẫn tiếp tục in các mã khác
          const msg = (e as Error)?.message || '';
          const mat = (ln.materialCode || '').trim();
          const po = (ln.po || '').trim();
          notEnoughLines.push(msg || `Không xử lý được: ${mat} / PO ${po}`);
          continue;
        }
      }
      const tonPayloads = this.buildTonQrPayloadsAfterPxkExport(
        pxkLines,
        inventoryRows,
        consumedByRowKey,
        reprintedDocIds,
        printedFlagItems,
        usedBagsByRowKey,
        exportedQtyByBag
      );
      if (exportPayloads.length === 0 && tonPayloads.length === 0) {
        if (notEnoughLines.length) {
          this.temXuatError = notEnoughLines.join('\n');
        } else if (this.REPRINT_FLAG_RULE_ENABLED && preCutoffFlagItems.length > 0 && reprintedDocIds.size > 0) {
          this.temXuatError = 'Đã in tem mẫu mới (tem cũ trước 01/04/2026) nên không in lại.';
        } else if (postCutoffCount > 0 && preCutoffFlagItems.length === 0) {
          this.temXuatError = 'Tem mới (sau 01/04/2026), không cần in';
        } else {
          this.temXuatError = 'Không có tem cần in trong LSX này.';
        }
        return;
      }
      if (notEnoughLines.length) {
        this.temXuatError = `⚠️ Một số mã không đủ điều kiện in:\n${notEnoughLines.join('\n')}`;
      } else {
        this.temXuatError = '';
      }

      const exportByKey = new Map<string, { qrData: string }[]>();
      for (const p of exportPayloads) {
        const parts = p.qrData.split('|');
        const k = `${(parts[0] || '').trim()}\0${(parts[1] || '').trim()}`;
        if (!exportByKey.has(k)) exportByKey.set(k, []);
        exportByKey.get(k)!.push(p);
      }
      const tonByKey = new Map<string, { qrData: string }[]>();
      for (const p of tonPayloads) {
        const parts = p.qrData.split('|');
        const k = `${(parts[0] || '').trim()}\0${(parts[1] || '').trim()}`;
        if (!tonByKey.has(k)) tonByKey.set(k, []);
        tonByKey.get(k)!.push(p);
      }

      const displayLsx = raw.trim();
      const orderedKeys: string[] = [];
      for (const ln of pxkLines) {
        const k = `${(ln.materialCode || '').trim()}\0${(ln.po || '').trim()}`;
        if (!orderedKeys.includes(k)) orderedKeys.push(k);
      }

      const printSequence: any[] = [{ kind: 'lsxHeader', lsxText: displayLsx, qrData: '' }];
      for (const k of orderedKeys) {
        const [mat, po] = k.split('\0');
        const exp = exportByKey.get(k) || [];
        const ton = tonByKey.get(k) || [];
        if (exp.length === 0 && ton.length === 0) continue;
        printSequence.push({ kind: 'lsxHeader', lsxText: `${mat}`, qrData: '' });
        if (exp.length) {
          printSequence.push({ kind: 'lsxHeader', lsxText: 'XUẤT', qrData: '' });
          for (const p of exp) printSequence.push(p);
        }
        if (ton.length) {
          printSequence.push({ kind: 'lsxHeader', lsxText: 'TỒN', qrData: '' });
          for (const p of ton) printSequence.push(p);
        }
        printSequence.push({ kind: 'spacer', qrData: '' });
      }

      const qrImages: any[] = [];
      let idx = 1;
      for (const it of printSequence) {
        if (it?.kind === 'lsxHeader' || it?.kind === 'spacer') {
          qrImages.push(it);
          continue;
        }
        const qrImage = await QRCode.toDataURL(it.qrData, {
          width: 240,
          margin: 1,
          color: { dark: '#000000', light: '#FFFFFF' }
        });
        const parts = String(it.qrData || '').split('|');
        qrImages.push({
          image: qrImage,
          qrData: it.qrData,
          index: idx++,
          materialCode: parts[0] || '',
          poNumber: parts[1] || '',
          unitNumber: Number(parts[2]) || 0
        });
      }

      // qrImages đã là thứ tự in cuối cùng (LSX -> Mã -> XUẤT -> tem -> TỒN -> tem)

      const fakeMaterial: InventoryMaterial = {
        factory: this.selectedFactory,
        importDate: new Date(),
        batchNumber: '',
        materialCode: 'PXK-EXPORT',
        poNumber: '',
        openingStock: null,
        quantity: 0,
        unit: '',
        location: '',
        type: '',
        expiryDate: new Date(),
        qualityCheck: false,
        isReceived: false,
        notes: '',
        rollsOrBags: '',
        supplier: '',
        remarks: '',
        isCompleted: false
      };

      this.createQRPrintWindow(qrImages, fakeMaterial, true);

      // 2) Lưu cờ: các dòng tồn đã được in lại tem mẫu mới
      if (this.REPRINT_FLAG_RULE_ENABLED) {
        try {
          const userEmail = (await this.afAuth.currentUser)?.email || '';
          await this.labelReprintFlags.markReprintedByDocId(
            Array.from(printedFlagItems.values()),
            { reprintedBy: userEmail, source: `TEM_XUAT_KHO_REPRINT:${this.selectedFactory}` }
          );
        } catch (e) {
          console.warn('⚠️ Không lưu được cờ in lại tem (bỏ qua):', e);
        }
      }

      this.closeTemXuatKhoPopup();
    } catch (e) {
      console.error('❌ Tem Xuất Kho:', e);
      this.temXuatError = (e as Error)?.message || 'Lỗi khi tạo/in tem.';
    } finally {
      this.temXuatBusy = false;
    }
  }

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  goBack(): void {
    this.location.back();
  }

  /** Bottom nav mobile Materials. */
  goMobileTab(path: '/materials' | '/inbound' | '/outbound' | '/bag-history'): void {
    if (path === '/materials') return;
    this.router.navigate([path], {
      queryParams: { factory: this.selectedFactory },
      queryParamsHandling: 'merge'
    });
  }

  focusMobileSearchForScan(): void {
    const el = document.querySelector('.mat-m-search__input') as HTMLInputElement | null;
    if (!el) return;
    el.focus();
    el.select();
  }

  openMobileDetail(material: InventoryMaterial): void {
    this.mobileDetailMaterial = material;
    this.showMobileDetail = true;
  }

  closeMobileDetail(): void {
    this.showMobileDetail = false;
    this.mobileDetailMaterial = null;
  }

  getMobileStatusLabel(material: InventoryMaterial): string {
    if (this.calculateCurrentStock(material) < 0) return 'Tồn âm';
    if (material.kkChecked) return 'Đã KK';
    return 'Đang hoạt động';
  }

  getMobileStatusClass(material: InventoryMaterial): string {
    if (this.calculateCurrentStock(material) < 0) return 'mat-m-status--neg';
    if (material.kkChecked) return 'mat-m-status--kk';
    return 'mat-m-status--ok';
  }

  ngOnInit(): void {
    console.log('🔍 DEBUG: ngOnInit - Starting component initialization');
    this.detectMobileDevice();

    const factoryParam = this.route.snapshot.queryParamMap.get('factory');
    if (this.isValidFactory(factoryParam)) {
      this.selectedFactory = factoryParam;
    } else {
      // Không có ?factory= trên URL — mặc định theo nhân viên đang đăng nhập
      // (1 số NV ưu tiên ASM2, còn lại mặc định ASM1).
      firstValueFrom(this.authService.currentUser)
        .then(user => {
          this.selectedFactory = getDefaultRmFactory(user?.employeeId);
        })
        .catch(() => {});
    }
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const f = params.get('factory');
      if (this.isValidFactory(f) && f !== this.selectedFactory) {
        this.selectedFactory = f;
        this.onFactoryChanged();
      }
    });

    this.loadPermissions();
    this.isLocationColumnUnlocked = this.TEMP_UNLOCK_LOCATION_WH_PALLET || this.locationUnlock.isUnlocked();
    this.locationUnlock.unlocked$.pipe(takeUntil(this.destroy$)).subscribe(unlocked => {
      this.isLocationColumnUnlocked = this.TEMP_UNLOCK_LOCATION_WH_PALLET || unlocked;
      if (!this.isLocationColumnUnlocked) this.closeLayoutLocPicker();
      this.cdr.markForCheck();
    });
    this.materialsInventoryUnlocked = this.materialsInventoryUnlock.isUnlocked();
    this.materialsInventoryUnlock.unlocked$.pipe(takeUntil(this.destroy$)).subscribe(unlocked => {
      this.materialsInventoryUnlocked = unlocked;
      this.cdr.markForCheck();
    });

    // Chỉ setup search — không chặn UI để đọc danh mục / tồn kho.
    this.restoreCatalogMemoryFast();
    setTimeout(() => {
      void this.hydrateCatalogFromDisk().then((ok) => {
        if (ok) this.rememberSharedCatalog();
      });
    }, 0);

    console.log('🔍 Setting up search mechanism (search-first, no auto load)...');
    this.setupDebouncedSearch();
    this.inventoryMaterials = [];
    this.filteredInventory = [];

    // Đến từ tab khác (VD: Layout Warehouse ASM3 → "Xem chi tiết") kèm ?location=... → tự tìm theo vị trí đó.
    const locationParam = this.route.snapshot.queryParamMap.get('location');
    if (locationParam) {
      this.searchByLocation = true;
      this.searchTerm = locationParam;
      void this.performSearch(locationParam);
    }

    this.updateNegativeStockCount();

    const savedRule = localStorage.getItem(this.QTY_BAG_RULE_KEY);
    if (savedRule === '0' || savedRule === '1') {
      this.qtyBagRuleEnabled = savedRule === '1';
    }
    this.loadQtyBagRuleByPrefixFromStorage();
    this.loadRuleBagManualPrefixesFromStorage();
    this.subscribeQtyBagRulesFromFirestore();

    console.log('✅ Materials component initialized - Waiting for user search');
    console.log('🔍 DEBUG: ngOnInit - Component initialization completed (NO AUTO LOAD)');
  }

  /** Đổi nhà máy đang xem (ASM1 ⇄ ASM2) — đồng bộ URL query param rồi tải lại data. */
  setFactory(factory: 'ASM1' | 'ASM2'): void {
    if (this.selectedFactory === factory) return;
    this.selectedFactory = factory;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { factory },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
    this.onFactoryChanged();
  }

  /** Click 1 nút để đổi qua lại ASM1 ⇄ ASM2. */
  toggleFactory(): void {
    this.setFactory(this.selectedFactory === 'ASM1' ? 'ASM2' : 'ASM1');
  }

  private isValidFactory(f: string | null | undefined): f is 'ASM1' | 'ASM2' {
    return f === 'ASM1' || f === 'ASM2';
  }

  /** Reset state gắn với factory cũ (kết quả search, popup đang mở) khi đổi nhà máy — dữ liệu inventory là theo factory,
   *  không được âm thầm hiển thị dữ liệu factory cũ dưới tên factory mới. */
  private onFactoryChanged(): void {
    this.viewWarehouseFilter = '';
    this.showKhoPopup = false;
    this.clearSearch();
    this.showMorePopup = false;
    this.showResetLowStockPopup = false;
    this.resetLowStockRows = [];
    this.showConsolidationMessage = false;
    this.kkTickedMaterialsCache = [];
    this.clearKkInlineBanner(true);
    this.showKkCheckPopup = false;
    this.closeKkLocMap();
    this.closeGanPallet();
    this.cancelMobileLocationScan(true);
    this.cancelMobileKkConfirm();
    this.closeMobileDetail();

    // Rule Bag / QTY BAG rule là cấu hình riêng theo factory (key localStorage + doc Firestore
    // đều bao gồm selectedFactory) — xoá state cũ trước để tránh lộ rule của factory vừa rời đi,
    // rồi nạp lại + resubscribe cho đúng factory vừa chọn.
    this.qtyBagRuleByPrefix = {};
    this.ruleBagManualPrefixes = [];
    this.rebuildRuleBagPrefixList();
    const savedRule = localStorage.getItem(this.QTY_BAG_RULE_KEY);
    this.qtyBagRuleEnabled = savedRule === '0' || savedRule === '1' ? savedRule === '1' : true;
    this.loadQtyBagRuleByPrefixFromStorage();
    this.loadRuleBagManualPrefixesFromStorage();
    this.rebuildRuleBagPrefixList();
    this.subscribeQtyBagRulesFromFirestore();

    this.cdr.markForCheck();
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.autoResizeNotesColumn();
    }, 1000);
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.detectMobileDevice();
  }

  /** Detect mobile / PDA — dùng giao diện xem tồn đơn giản. */
  private detectMobileDevice(): void {
    const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera || '';
    const ua = userAgent.toLowerCase();
    const isMobileUserAgent = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|pda|handheld/i.test(ua);
    const isMobileScreen = typeof window !== 'undefined' && window.innerWidth <= 768;
    const isSmallScreen = typeof window !== 'undefined' && window.innerWidth <= 1024;
    this.isMobile = isMobileUserAgent || isMobileScreen || isSmallScreen;
  }

  ngOnDestroy(): void {
    this.stopScanning();
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Setup debounced search for better performance
  private setupDebouncedSearch(): void {
    this.searchSubject.pipe(
      debounceTime(2000), // Đợi 2 giây sau khi user ngừng gõ
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(searchTerm => {
      this.performSearch(searchTerm);
    });
  }

  // Download inventory stock data from Firebase as Excel file
  async loadInventoryStockFromFirebase(): Promise<void> {
    const XLSX = await import('xlsx');
    console.log('📦 Downloading ASM1 inventory stock from Firebase as Excel...');
    this.isLoading = true;

    try {
      // Get all inventory materials from Firebase
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
      ).get().toPromise();

      if (!snapshot || snapshot.empty) {
        console.log('ℹ️ No inventory stock data found in Firebase');
        alert('Không tìm thấy dữ liệu tồn kho trong Firebase');
        this.isLoading = false;
        return;
      }

      console.log(`📊 Found ${snapshot.docs.length} inventory records in Firebase`);

      const inventoryData: any[] = [];

      snapshot.docs.forEach(doc => {
        const data = doc.data() as any;

        // Create Excel row with all Firebase fields
        const excelRow = {
          'STT': inventoryData.length + 1,
          'ID': doc.id,
          'Factory': data.factory || this.selectedFactory,
          'Mã hàng': data.materialCode || '',
          'Tên hàng': data.materialName || '',
          'PO': data.poNumber || '',
          'Import Date': data.importDate ? (data.importDate.toDate ? data.importDate.toDate().toLocaleDateString('en-GB').split('/').join('') : data.importDate) : '',
          'Received Date': data.receivedDate ? data.receivedDate.toDate().toLocaleDateString('vi-VN') : '',
          'Tồn đầu': data.openingStock || 0,
          'Số lượng': data.quantity || 0,
          'Đã xuất': data.exported || 0,
          'XT': data.xt || 0,
          'Tồn kho': (data.openingStock || 0) + (data.quantity || 0) - (data.exported || 0) - (data.xt || 0),
          'Đơn vị': data.unit || '',
          'Vị trí': data.location || '',
          'Pallet': data.palletId || '',
          'Loại hình': data.type || '',
          'Expiry Date': data.expiryDate ? data.expiryDate.toDate().toLocaleDateString('vi-VN') : '',
          'Quality Check': data.qualityCheck ? 'Yes' : 'No',
          'Is Received': data.isReceived ? 'Yes' : 'No',
          'Notes': data.notes || '',
          'Rolls/Bags': data.rollsOrBags || '',
          'Supplier': data.supplier || '',
          'Remarks': data.remarks || '',
          'Standard Packing': data.standardPacking || 0,
          'Is Completed': data.isCompleted ? 'Yes' : 'No',
          'Import Status': data.importStatus || '',
          'Source': data.source || '',
          'Updated At': data.updatedAt ? data.updatedAt.toDate().toLocaleString('vi-VN') : '',
          'Created At': data.createdAt ? data.createdAt.toDate().toLocaleString('vi-VN') : ''
        };
        
        inventoryData.push(excelRow);
      });
      
      // Create Excel file
      const worksheet = XLSX.utils.json_to_sheet(inventoryData);
      
      // Set column widths
      const columnWidths = [
        { wch: 5 },   // STT
        { wch: 20 },  // ID
        { wch: 8 },   // Factory
        { wch: 15 },  // Mã hàng
        { wch: 25 },  // Tên hàng
        { wch: 15 },  // PO
        { wch: 12 },  // Import Date
        { wch: 12 },  // Received Date
        { wch: 10 },  // Tồn đầu
        { wch: 10 },  // Số lượng
        { wch: 10 },  // Đã xuất
        { wch: 8 },   // XT
        { wch: 10 },  // Tồn kho
        { wch: 8 },   // Đơn vị
        { wch: 12 },  // Vị trí
        { wch: 12 },  // Loại hình
        { wch: 12 },  // Expiry Date
        { wch: 12 },  // Quality Check
        { wch: 12 },  // Is Received
        { wch: 20 },  // Notes
        { wch: 12 },  // Rolls/Bags
        { wch: 15 },  // Supplier
        { wch: 20 },  // Remarks
        { wch: 12 },  // Standard Packing
        { wch: 12 },  // Is Completed
        { wch: 12 },  // Import Status
        { wch: 10 },  // Source
        { wch: 18 },  // Updated At
        { wch: 18 }   // Created At
      ];
      worksheet['!cols'] = columnWidths;
      
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, `${this.selectedFactory}_Inventory_Firebase`);

      // Generate filename with current date
      const currentDate = new Date().toISOString().split('T')[0];
      const fileName = `${this.selectedFactory}_Inventory_Firebase_${currentDate}.xlsx`;
      
      XLSX.writeFile(workbook, fileName);
      
      console.log(`✅ Successfully exported ${inventoryData.length} inventory items to Excel`);
      alert(`✅ Đã tải thành công file Excel với ${inventoryData.length} mặt hàng tồn kho từ Firebase!\n\nFile: ${fileName}\nBao gồm tất cả thông tin đang lưu trên Firebase.`);
      
    } catch (error) {
      console.error('❌ Error downloading inventory stock from Firebase:', error);
      alert('❌ Lỗi khi tải file Excel từ Firebase. Vui lòng thử lại.');
    } finally {
      this.isLoading = false;
    }
  }

  /** Vị trí đã sửa tay (OTP / user) — không auto ghi đè E7/F7 khi search hoặc F5. */
  private isManualLocationLocked(material: {
    modifiedBy?: string;
    locationManualOverride?: boolean;
  }): boolean {
    if (material.locationManualOverride) return true;
    const by = String(material.modifiedBy || '').trim().toUpperCase();
    if (/^ASP\d{4}$/.test(by)) return true;
    return false;
  }

  private stampLocationAtLoad(material: InventoryMaterial): void {
    (material as { __locationAtLoad?: string }).__locationAtLoad = String(material.location || '').trim().toUpperCase();
    (material as { __prevPalletId?: string }).__prevPalletId = String(material.palletId || '').trim().toUpperCase();
  }

  /** Ưu tiên `location` (kể cả chuỗi rỗng đã xóa). Chỉ fallback `viTri` khi chưa có field location. */
  private locationFromInventoryDoc(data: any): string {
    if (data && Object.prototype.hasOwnProperty.call(data, 'location')) {
      return String(data.location ?? '').trim().toUpperCase();
    }
    return String(data?.viTri ?? '').trim().toUpperCase();
  }

  private inventoryLocationWriteFields(location: string): Record<string, unknown> {
    return { location, viTri: location };
  }

  /**
   * R* + IQC Pass → E7; B011/B013/B014* + IQC Pass → F7 (chỉ khi chưa có vị trí thủ công).
   * Mutates material.location when rule applies.
   * @returns location to persist ('E7' | 'F7') or null
   */
  private applyPassIqcAutoLocation(material: {
    materialCode?: string;
    iqcStatus?: string;
    location?: string;
    modifiedBy?: string;
    locationManualOverride?: boolean;
  }): 'E7' | 'F7' | null {
    try {
      if (this.isManualLocationLocked(material)) return null;

      const mc = String(material.materialCode || '').trim().toUpperCase();
      const iqc = String(material.iqcStatus || '').trim().toUpperCase();
      const loc = String(material.location || '').trim().toUpperCase();
      if (!loc) {
        if (mc.startsWith('R') && iqc === 'PASS') {
          material.location = 'E7';
          return 'E7';
        }
        if (
          (mc.startsWith('B011') || mc.startsWith('B013') || mc.startsWith('B014')) &&
          iqc === 'PASS'
        ) {
          material.location = 'F7';
          return 'F7';
        }
        return null;
      }

      const autoIqcStaging = new Set(['F62', 'F62TRA', 'E7', 'F7']);
      if (!autoIqcStaging.has(loc)) return null;

      if (mc.startsWith('R') && iqc === 'PASS' && loc !== 'E7') {
        material.location = 'E7';
        return 'E7';
      }
      if (
        (mc.startsWith('B011') || mc.startsWith('B013') || mc.startsWith('B014')) &&
        iqc === 'PASS' &&
        loc !== 'F7'
      ) {
        material.location = 'F7';
        return 'F7';
      }
    } catch {
      // ignore
    }
    return null;
  }

  // Load inventory data from Firebase - ONLY ASM1
  async loadInventoryFromFirebase(): Promise<void> {
    console.log('📦 Loading ASM1 inventory from Firebase...');
    this.isLoading = true;
    
    // 🔧 FIX: .get() một lần (Refresh / sau thao tác) — không dùng snapshotChanges để tránh
    // đọc lại toàn bộ mỗi khi doc đổi ở tab QC/Overview và vòng lặp ghi auto-location.
    try {
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
           .orderBy('importDate', 'desc')
           .limit(1000)
      ).get().toPromise();

      const docs = snapshot?.docs || [];
      console.log(`📦 Loaded ${docs.length} materials from Firebase`);
      this.readTracker.track('materials', 'inventory-materials', docs.length);

        // Auto-set location: E7 for R* + IQC PASS; F7 for B011/B013/B014* + IQC PASS
        const autoLocationBatch = this.firestore.firestore.batch();
        let autoLocationCount = 0;
        const MAX_BATCH_WRITES = 450; // safety margin under 500

        this.inventoryMaterials = docs
          .map(doc => {
            const data = doc.data() as any;
            const id = doc.id;
            const material = {
              id: id,
              ...data,
              factory: this.selectedFactory, // Force ASM1
              importDate: this.parseImportDate(data.importDate),
              receivedDate: data.receivedDate ? new Date(data.receivedDate.seconds * 1000) : new Date(),
              expiryDate: data.expiryDate ? new Date(data.expiryDate.seconds * 1000) : new Date(),
              openingStock: data.openingStock || null, // Initialize openingStock field - để trống nếu không có
              xt: data.xt || 0, // Initialize XT field for old materials
              source: data.source || 'manual', // Set default source for old materials
              iqcStatus: data.iqcStatus || undefined, // Load IQC status from Firestore
              modifiedBy: data.modifiedBy || '',
              locationManualOverride: !!data.locationManualOverride
            } as InventoryMaterial;

            this.stampLocationAtLoad(material);

            const newLoc = this.applyPassIqcAutoLocation(material);
            if (newLoc && autoLocationCount < MAX_BATCH_WRITES) {
              autoLocationBatch.update(doc.ref, {
                location: newLoc,
                lastModified: firebase.default.firestore.FieldValue.serverTimestamp(),
                modifiedBy: 'materials-auto-location'
              } as any);
              autoLocationCount++;
            }
            
            // 🔍 DEBUG: Log batchNumber để kiểm tra sequence number
            if (data.batchNumber && (data.batchNumber.includes('01') || data.batchNumber.includes('02') || data.batchNumber.includes('03'))) {
              console.log(`🔍 DEBUG: Found material with sequence batchNumber:`, {
                materialCode: material.materialCode,
                poNumber: material.poNumber,
                batchNumber: data.batchNumber,
                source: data.source
              });
            }
            
            // Apply catalog data if available
            if (this.catalogLoaded && this.catalogCache.has(material.materialCode)) {
              const catalogItem = this.catalogCache.get(material.materialCode)!;
              material.materialName = catalogItem.materialName;
              material.unit = catalogItem.unit;
              
              // Tự động điền rollsOrBags từ Standard Packing nếu trống
              if (!material.rollsOrBags || material.rollsOrBags === '' || material.rollsOrBags === '0') {
                const standardPacking = catalogItem.standardPacking;
                if (standardPacking && standardPacking > 0) {
                  material.rollsOrBags = standardPacking.toString();
                  console.log(`🔄 Auto-filled rollsOrBags from Standard Packing: ${material.materialCode} = ${standardPacking}`);
                }
              }
            }

            // Init BAG input (totalBags) for editing UI.
            material.bagTrackingInitialized = !!data.bagTrackingInitialized;
            material.openingStockAtBagInit =
              typeof data.openingStockAtBagInit === 'number' ? data.openingStockAtBagInit : undefined;
            material.bagInput =
              material.bagTrackingInitialized
                ? ''
                : material.totalBags != null && Number(material.totalBags) > 0
                  ? String(Math.floor(Number(material.totalBags)))
                  : '';
            this.applyLocalDerivedBags(material);
            
            return material;
          })
          .filter(material => material.factory === this.selectedFactory); // Double check ASM1 only

        if (autoLocationCount > 0) {
          autoLocationBatch
            .commit()
            .then(() =>
              console.log(
                `✅ [ASM1 auto location] Updated ${autoLocationCount} docs (R*→E7 / B011|B013|B014*→F7 khi IQC PASS).`
              )
            )
            .catch(err => console.warn('⚠️ [ASM1 auto location] Batch update failed:', err));
        }

        // Set filteredInventory to show all loaded items initially
        this.filteredInventory = [...this.inventoryMaterials];
        console.log(`🔍 DEBUG: Loaded ${this.inventoryMaterials.length} inventory materials`);
        void this.applyStorageUnitsFromCatalog();
        if (this.showKhColumn) void this.applyNvlkhFromCatalog();
        console.log(`🔍 DEBUG: First material:`, this.inventoryMaterials[0]);
        
        // Gộp dòng trùng lặp TRƯỚC KHI xử lý outbound
        console.log('🔄 Consolidating duplicate materials...');
        
        // Kiểm tra xem có dòng trùng lặp không
        const materialPoMap = new Map<string, InventoryMaterial[]>();
        this.inventoryMaterials.forEach(material => {
          const key = `${material.materialCode}_${material.poNumber}`;
          if (!materialPoMap.has(key)) {
            materialPoMap.set(key, []);
          }
          materialPoMap.get(key)!.push(material);
        });
        
        const duplicateGroups = Array.from(materialPoMap.values()).filter(group => group.length > 1);
        
        if (duplicateGroups.length > 0) {
          console.log(`⚠️ Found ${duplicateGroups.length} duplicate groups, auto-consolidating...`);
          
          // Gộp dòng tự động khi load toàn bộ inventory
          this.autoConsolidateOnLoad().then(() => {
            // Tiếp tục xử lý sau khi gộp xong
            this.continueAfterConsolidation();
          });
        } else {
          console.log('✅ No duplicate groups found, proceeding with normal flow...');
          // Gộp dòng bình thường (chỉ local)
          this.consolidateInventoryData();
          
          // Tiếp tục xử lý
          this.continueAfterConsolidation();
        }
    } catch (error: any) {
      console.error('❌ Error loading ASM1 inventory:', error);
      console.error('❌ Error details:', error?.message);
      this.isLoading = false;
    }
  }

  /** More → mở popup nhập mã rồi ghi snapshot TỒN */
  openSnapshotCodesModal(): void {
    if (this.isSnapshottingBagHistory) {
      return;
    }
    this.snapshotMaterialCodesText = '';
    this.closeMorePopup();
    this.showSnapshotCodesModal = true;
    this.cdr.markForCheck();
  }

  closeSnapshotCodesModal(): void {
    this.showSnapshotCodesModal = false;
    this.cdr.markForCheck();
  }

  private parseSnapshotMaterialCodesInput(raw: string): string[] {
    return [
      ...new Set(
        raw
          .split(/[\s,;]+/)
          .map(s => s.trim().toUpperCase())
          .filter(Boolean)
      )
    ];
  }

  /** Sau khi nhập mã trong modal → ghi snapshot chỉ các mã đó */
  async confirmSnapshotCodesAndRun(): Promise<void> {
    if (this.isSnapshottingBagHistory) {
      return;
    }
    const codes = this.parseSnapshotMaterialCodesInput(this.snapshotMaterialCodesText);
    if (codes.length === 0) {
      alert('Vui lòng nhập ít nhất một mã hàng (mỗi dòng hoặc cách bằng dấu phẩy).');
      return;
    }
    const ok = confirm(
      `Ghi snapshot TỒN cho ${codes.length} mã đã nhập (${this.selectedFactory}) vào rm-bag-history?\n\n` +
        `Chỉ các dòng inventory thuộc các mã này. Dữ liệu kho không bị xóa hay sửa.`
    );
    if (!ok) {
      return;
    }
    this.showSnapshotCodesModal = false;
    this.isSnapshottingBagHistory = true;
    this.cdr.markForCheck();
    try {
      const r = await this.rmBagHistory.snapshotTonFromInventoryToRmHistory(this.selectedFactory, { materialCodes: codes });
      const derivedLine =
        r.derivedFromStock > 0
          ? `\n• ${r.derivedFromStock} dòng ước tổng bịch từ (tồn kho ÷ LDV) vì totalBags trên doc = 0.`
          : '';
      const codesLine =
        r.requestedCodes != null ? `\n• Đã chọn ${r.requestedCodes} mã (khác nhau).` : '';
      alert(
        `✅ Đã ghi ${r.written} dòng TỒN vào rm-bag-history.\n` +
          `Bỏ qua ${r.skipped} dòng (không còn tồn bịch, không có mã, hoặc không đủ dữ liệu ước).${derivedLine}${codesLine}\n` +
          `Đợt: ${r.resetId}`
      );
    } catch (e: any) {
      console.error('[materials] snapshot TỒN:', e);
      alert(`❌ Lỗi: ${e?.message || String(e)}`);
    } finally {
      this.isSnapshottingBagHistory = false;
      this.cdr.markForCheck();
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
    
    // 8 hoặc 10 số dạng DDMMYYYY[XX] — lấy 8 số đầu làm ngày
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

  // Load inventory and setup search mechanism
  private loadInventoryAndSetupSearch(): void {
    console.log('📦 Setting up search mechanism and loading inventory data...');
    
    // Setup search mechanism immediately
    console.log('🔍 Setting up search mechanism...');
    this.setupDebouncedSearch();
    console.log('✅ Search mechanism setup completed');
    
    // 🔧 FIX: Load inventory data immediately
    console.log('🔍 Loading inventory data...');
    this.loadInventoryFromFirebase();
  }

  // Debug function to check outbound data on init
  async debugOutboundDataOnInit(): Promise<void> {
    try {
      console.log('🔍 DEBUG: Checking outbound data on init...');
      
      const outboundSnapshot = await this.firestore.collection('outbound-materials')
        .ref
        .where('factory', '==', this.selectedFactory)
        .limit(5)
        .get();
      
      console.log(`🔍 DEBUG: Found ${outboundSnapshot.size} outbound records for ASM1`);
      
      if (!outboundSnapshot.empty) {
        console.log('📋 Outbound records found:');
        let index = 0;
        outboundSnapshot.forEach((doc) => {
          const data = doc.data() as any;
          console.log(`  ${index + 1}. Material: ${data.materialCode}, PO: ${data.poNumber}, Quantity: ${data.exportQuantity || data.quantity || 'N/A'}, Date: ${data.exportDate}`);
          index++;
        });
      } else {
        console.log('⚠️ No outbound records found for ASM1');
      }
      
    } catch (error) {
      console.error('❌ Error checking outbound data:', error);
    }
  }

  // Helper function to get display IMD (importDate + sequence if any)
  getDisplayIMD(material: InventoryMaterial): string {
    if (!material.importDate) return 'N/A';
    
    const baseDate = material.importDate.toLocaleDateString('en-GB').split('/').join('');
    
    const bn = String((material as any)?.batchNumber ?? '').trim();
    if (bn && bn !== baseDate) {
      // Nếu batchNumber là chuỗi số (>= 8 ký tự) thì ưu tiên hiển thị toàn bộ.
      // Ví dụ: 20042026 và 2004202601 là 2 IMD khác nhau.
      if (/^\d{8,}$/.test(bn)) {
        return bn;
      }
      // Trường hợp legacy: batchNumber = baseDate + suffix số
      if (bn.startsWith(baseDate)) {
        const suffix = bn.substring(baseDate.length);
        if (/^\d+$/.test(suffix) && suffix.length > 0) {
          return baseDate + suffix;
        }
      }
    }
    
    return baseDate;
  }

  /** Còn bịch / tổng bịch (ví dụ 5/10); không có totalBags → — */
  getBatchBagsDisplay(material: InventoryMaterial): string {
    const total = Math.floor(Number(material.totalBags ?? 0));
    if (total <= 0) return '—';
    const used = Math.max(0, Math.floor(Number(material.exportedBags ?? 0)));
    const remaining = Math.max(0, total - used);
    return `${remaining}/${total}`;
  }

  /**
   * BATCH (cột bảng): ceil(tồn kho / Standard Packing). Tồn kho = cột "Tồn kho" (calculateCurrentStock).
   */
  getBatchPacksFromStockDisplay(material: InventoryMaterial): string {
    const stock = this.calculateCurrentStock(material);
    const sp = this.getStandardPacking(material.materialCode);
    if (!sp || sp <= 0) {
      return '—';
    }
    if (stock <= 0) {
      return '0';
    }
    return String(Math.ceil(stock / sp));
  }

  /** Standard Packing: đọc Danh mục NVL; chỉ fallback dòng tồn kho khi catalog chưa có. */
  getEffectiveStandardPacking(material: InventoryMaterial): number {
    const fromCatalog = this.getStandardPacking(material.materialCode);
    if (fromCatalog > 0) return fromCatalog;
    const row = Number(material.standardPacking);
    if (row > 0 && Number.isFinite(row)) return row;
    return 0;
  }

  /** Tổng số “ô bịch” = ceil(tồn kho / SP), dùng cho QR và Firebase khi đã khởi tạo. */
  computeTotalBagsFromStock(material: InventoryMaterial): number {
    const sp = this.getEffectiveStandardPacking(material);
    const stock = this.calculateCurrentStock(material);
    if (!sp || sp <= 0 || stock <= 0) {
      return 0;
    }
    return Math.ceil(stock / sp);
  }

  /**
   * Số bịch hiệu lực cho cột BAG / QR / tem:
   * có Standard Packing (catalog hoặc dòng) → tự tính ceil(tồn ÷ SP);
   * chưa có SP → fallback về totalBags đã lưu.
   */
  effectiveTotalBags(material: InventoryMaterial): number {
    if (this.getEffectiveStandardPacking(material) > 0) {
      return this.computeTotalBagsFromStock(material);
    }
    return Math.floor(Number(material.totalBags ?? 0));
  }

  /** Cập nhật totalBags trên model theo tồn (không ghi Firebase). */
  applyLocalDerivedBags(material: InventoryMaterial): void {
    if (this.getEffectiveStandardPacking(material) <= 0) {
      return;
    }
    const derived = this.computeTotalBagsFromStock(material);
    material.totalBags = derived;
    material.bagInput = '';
  }

  /**
   * Hiển thị cột BAG:
   *  - chẵn hết        → "20"     (20 bịch chẵn, không lẻ)
   *  - chẵn + lẻ       → "20+1"   (20 bịch chẵn + 1 bịch lẻ)
   *  - chỉ có lẻ       → "0+1"    (chưa đủ 1 bịch chẵn)
   */
  getBagsBreakdownText(material: InventoryMaterial): string {
    const sp = this.getEffectiveStandardPacking(material);
    const stock = this.calculateCurrentStock(material);
    if (!sp || sp <= 0) {
      if (material.totalBags != null && Number(material.totalBags) > 0) {
        return this.formatNumber(material.totalBags);
      }
      return material.bagTrackingInitialized ? '—' : '';
    }
    if (stock <= 0) {
      return '0';
    }
    const fullCount = Math.floor(stock / sp);
    const partial = Math.round((stock - fullCount * sp) * 1e6) / 1e6;
    return partial <= 1e-9 ? `${fullCount}` : `${fullCount}+1`;
  }

  getBagsBreakdownTitle(material: InventoryMaterial): string {
    const sp = this.getEffectiveStandardPacking(material);
    if (!sp || sp <= 0) {
      return '';
    }
    const stock = this.calculateCurrentStock(material);
    if (stock <= 0) {
      return `Tồn kho ${this.formatNumber(stock)} — chưa có bịch.`;
    }
    const fullCount = Math.floor(stock / sp);
    const partial = Math.round((stock - fullCount * sp) * 1e6) / 1e6;
    const base = `Tồn ${this.formatNumber(stock)} ÷ Standard Packing ${sp}`;
    return partial <= 1e-9
      ? `${base} = ${fullCount} bịch chẵn.`
      : `${base} = ${fullCount} bịch chẵn + 1 bịch lẻ ${this.formatNumber(partial)}.`;
  }

  private appendDerivedTotalBagsIfNeeded(material: InventoryMaterial, updateData: any): void {
    const sp = this.getEffectiveStandardPacking(material);
    if (!sp || sp <= 0) {
      return;
    }
    const derived = this.computeTotalBagsFromStock(material);
    material.totalBags = derived;
    material.bagInput = '';
    updateData.totalBags = derived;
  }

  // Debug function to find problematic batchNumbers
  async debugProblematicBatchNumbers(): Promise<void> {
    console.log('🔍 DEBUG: Checking for problematic batchNumbers...');
    
    try {
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
      ).get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        console.log('❌ No inventory materials found');
        return;
      }
      
      const problematicItems: any[] = [];
      
      snapshot.forEach(doc => {
        const data = doc.data() as any;
        const batchNumber = data.batchNumber;
        const importDate = data.importDate;
        
        if (batchNumber && importDate) {
          const expectedBaseDate = new Date(importDate.seconds * 1000).toLocaleDateString('en-GB').split('/').join('');
          
          // Kiểm tra nếu batchNumber có format không đúng
          if (!batchNumber.startsWith(expectedBaseDate) || 
              (batchNumber.length > expectedBaseDate.length && 
               !/^\d{1,2}$/.test(batchNumber.substring(expectedBaseDate.length)))) {
            problematicItems.push({
              id: doc.id,
              materialCode: data.materialCode,
              poNumber: data.poNumber,
              batchNumber: batchNumber,
              expectedBaseDate: expectedBaseDate,
              importDate: importDate
            });
          }
        }
      });
      
      console.log(`🔍 Found ${problematicItems.length} problematic batchNumbers:`, problematicItems);
      
      if (problematicItems.length > 0) {
        console.log('📋 Problematic items:');
        problematicItems.forEach((item, index) => {
          console.log(`  ${index + 1}. ${item.materialCode} - ${item.poNumber}`);
          console.log(`     Current: ${item.batchNumber}`);
          console.log(`     Expected: ${item.expectedBaseDate}`);
        });
      }
      
    } catch (error) {
      console.error('❌ Error checking problematic batchNumbers:', error);
    }
  }

  // Fix problematic batchNumbers in Firebase
  async fixProblematicBatchNumbers(): Promise<void> {
    console.log('🔧 Starting to fix problematic batchNumbers...');
    this.isLoading = true;
    
    try {
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
      ).get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        console.log('❌ No inventory materials found');
        return;
      }
      
      const batch = this.firestore.firestore.batch();
      let updateCount = 0;
      
      snapshot.forEach(doc => {
        const data = doc.data() as any;
        const batchNumber = data.batchNumber;
        const importDate = data.importDate;
        
        if (batchNumber && importDate) {
          const expectedBaseDate = new Date(importDate.seconds * 1000).toLocaleDateString('en-GB').split('/').join('');
          
          // Kiểm tra nếu batchNumber có format không đúng
          if (!batchNumber.startsWith(expectedBaseDate) || 
              (batchNumber.length > expectedBaseDate.length && 
               !/^\d{1,2}$/.test(batchNumber.substring(expectedBaseDate.length)))) {
            
            console.log(`🔧 Fixing ${data.materialCode} - ${data.poNumber}:`);
            console.log(`  Current: ${batchNumber}`);
            console.log(`  Fixed to: ${expectedBaseDate}`);
            
            // Cập nhật batchNumber về format đúng
            batch.update(doc.ref, {
              batchNumber: expectedBaseDate,
              updatedAt: new Date()
            });
            
            updateCount++;
          }
        }
      });
      
      if (updateCount > 0) {
        await batch.commit();
        console.log(`✅ Fixed ${updateCount} problematic batchNumbers`);
        alert(`✅ Đã sửa ${updateCount} batchNumber có format không đúng!`);
        
        // Refresh data
        this.loadInventoryFromFirebase();
      } else {
        console.log('ℹ️ No problematic batchNumbers found');
        alert('Không tìm thấy batchNumber nào cần sửa');
      }
      
    } catch (error) {
      console.error('❌ Error fixing batchNumbers:', error);
      alert('❌ Lỗi khi sửa batchNumbers. Vui lòng thử lại.');
    } finally {
      this.isLoading = false;
    }
  }

  // Debug function to check materials collection
  async debugMaterialsCollection(): Promise<void> {
    console.log('🔍 DEBUG: Checking materials collection...');
    
    try {
      const snapshot = await this.firestore.collection('materials').get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        console.log('❌ Collection "materials" is empty or does not exist');
        alert('❌ Collection "materials" is empty or does not exist');
        return;
      }
      
      console.log(`📊 Total documents in materials collection: ${snapshot.size}`);
      
      // Phân tích cấu trúc dữ liệu
      let withStandardPacking = 0;
      let withMaterialCode = 0;
      let withMaterialName = 0;
      const fieldCounts: { [key: string]: number } = {};
      
      snapshot.docs.forEach((doc, index) => {
        const data = doc.data() as any;
        
        // Đếm các field quan trọng
        if (data.standardPacking !== undefined && data.standardPacking !== null) {
          withStandardPacking++;
        }
        if (data.materialCode) {
          withMaterialCode++;
        }
        if (data.materialName) {
          withMaterialName++;
        }
        
        // Đếm tất cả fields
        Object.keys(data).forEach(field => {
          fieldCounts[field] = (fieldCounts[field] || 0) + 1;
        });
        
        // Log 3 documents đầu tiên để xem cấu trúc
        if (index < 3) {
          console.log(`📄 Document ${index + 1} (${doc.id}):`, data);
        }
      });
      
      console.log('📊 Field Analysis:');
      console.log(`  - Documents with standardPacking: ${withStandardPacking}`);
      console.log(`  - Documents with materialCode: ${withMaterialCode}`);
      console.log(`  - Documents with materialName: ${withMaterialName}`);
      
      console.log('📊 All fields and their frequency:');
      Object.entries(fieldCounts)
        .sort(([,a], [,b]) => b - a)
        .forEach(([field, count]) => {
          console.log(`  - ${field}: ${count} documents`);
        });
      
      alert(`🔍 MATERIALS COLLECTION DEBUG:\n\n` +
            `📊 Total documents: ${snapshot.size}\n` +
            `📦 With standardPacking: ${withStandardPacking}\n` +
            `🏷️ With materialCode: ${withMaterialCode}\n` +
            `📝 With materialName: ${withMaterialName}\n\n` +
            `💡 Check console (F12) for detailed field analysis`);
      
    } catch (error) {
      console.error('❌ Error checking materials collection:', error);
      alert('❌ Error checking materials collection: ' + error.message);
    }
  }

  // Xóa các mã không có standardPacking
  async deleteMaterialsWithoutStandardPacking(): Promise<void> {
    console.log('🗑️ Starting deletion of materials without standardPacking...');
    
    const confirmMessage = `⚠️ XÓA CÁC MÃ KHÔNG CÓ STANDARDPACKING\n\n` +
      `📊 Tổng documents: 8,750\n` +
      `📦 Có standardPacking: 5,792 (66%)\n` +
      `❌ Không có standardPacking: 3,958 (34%)\n\n` +
      `⚠️ Bạn có chắc chắn muốn XÓA 3,958 documents không có standardPacking?\n` +
      `⚠️ Hành động này KHÔNG THỂ HOÀN TÁC!`;
    
    if (!confirm(confirmMessage)) {
      console.log('❌ User cancelled deletion');
      return;
    }
    
    try {
      console.log('🔍 Loading materials collection...');
      const snapshot = await this.firestore.collection('materials').get().toPromise();
      
      if (!snapshot || snapshot.empty) {
        console.log('❌ No materials found');
        alert('❌ Không tìm thấy materials nào');
        return;
      }
      
      console.log(`📊 Total materials to check: ${snapshot.size}`);
      
      // Tìm các documents không có standardPacking
      const documentsToDelete: any[] = [];
      let processedCount = 0;
      
      snapshot.docs.forEach(doc => {
        const data = doc.data() as any;
        processedCount++;
        
        // Kiểm tra không có standardPacking hoặc standardPacking = null/undefined
        if (data.standardPacking === undefined || data.standardPacking === null) {
          documentsToDelete.push({
            id: doc.id,
            materialCode: data.materialCode || 'Unknown',
            materialName: data.materialName || 'Unknown'
          });
        }
        
        // Log progress mỗi 1000 documents
        if (processedCount % 1000 === 0) {
          console.log(`📊 Processed ${processedCount}/${snapshot.size} documents, found ${documentsToDelete.length} to delete`);
        }
      });
      
      console.log(`📊 Analysis complete:`);
      console.log(`  - Total processed: ${processedCount}`);
      console.log(`  - Documents to delete: ${documentsToDelete.length}`);
      console.log(`  - Documents to keep: ${processedCount - documentsToDelete.length}`);
      
      if (documentsToDelete.length === 0) {
        alert('✅ Tất cả materials đều có standardPacking! Không cần xóa gì.');
        return;
      }
      
      // Xác nhận lần 2 với số liệu cụ thể
      const finalConfirm = `⚠️ XÁC NHẬN CUỐI CÙNG\n\n` +
        `📊 Sẽ xóa: ${documentsToDelete.length} documents\n` +
        `📊 Sẽ giữ lại: ${processedCount - documentsToDelete.length} documents\n\n` +
        `⚠️ Hành động này KHÔNG THỂ HOÀN TÁC!\n` +
        `⚠️ Bạn có chắc chắn muốn tiếp tục?`;
      
      if (!confirm(finalConfirm)) {
        console.log('❌ User cancelled final confirmation');
        return;
      }
      
      // Bắt đầu xóa theo batch (Firebase limit: 500 operations per batch)
      const batchSize = 500;
      let deletedCount = 0;
      const totalBatches = Math.ceil(documentsToDelete.length / batchSize);
      
      console.log(`🗑️ Starting deletion in ${totalBatches} batches...`);
      
      for (let i = 0; i < documentsToDelete.length; i += batchSize) {
        const batch = this.firestore.firestore.batch();
        const currentBatch = documentsToDelete.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        
        console.log(`🗑️ Processing batch ${batchNumber}/${totalBatches} (${currentBatch.length} documents)...`);
        
        currentBatch.forEach(docToDelete => {
          const docRef = this.firestore.collection('materials').doc(docToDelete.id).ref;
          batch.delete(docRef);
        });
        
        await batch.commit();
        deletedCount += currentBatch.length;
        
        console.log(`✅ Batch ${batchNumber} completed. Deleted: ${deletedCount}/${documentsToDelete.length}`);
        
        // Hiển thị progress
        const progress = Math.round((deletedCount / documentsToDelete.length) * 100);
        console.log(`📊 Progress: ${progress}% (${deletedCount}/${documentsToDelete.length})`);
      }
      
      console.log(`✅ Deletion completed! Deleted ${deletedCount} documents`);
      
      alert(`✅ XÓA THÀNH CÔNG!\n\n` +
            `🗑️ Đã xóa: ${deletedCount} documents\n` +
            `📊 Còn lại: ${processedCount - deletedCount} documents\n` +
            `📦 Tất cả materials còn lại đều có standardPacking\n\n` +
            `💡 Collection materials đã được làm sạch!`);
      
    } catch (error) {
      console.error('❌ Error deleting materials without standardPacking:', error);
      alert('❌ Lỗi khi xóa materials: ' + error.message);
    }
  }

  private static readonly CATALOG_LOCALSTORAGE_KEY = 'materials-catalog-cache-v1';
  private static readonly CATALOG_CACHE_KEY_V2 = 'materials-catalog-cache-v2';
  private static readonly CATALOG_IDB_NAME = 'asm-materials-cache';
  private static readonly CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 ngày
  private static readonly CATALOG_LS_MAX_CHARS = 3_200_000;

  private catalogTodayKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private catalogDateKeyFromTs(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private restoreCatalogMemoryFast(): void {
    const today = this.catalogTodayKey();
    if (MaterialsComponent.sharedCatalogCache.size > 0 && MaterialsComponent.sharedCatalogDateKey === today) {
      this.catalogCache = MaterialsComponent.sharedCatalogCache;
      this.catalogLoaded = true;
      this.catalogLoadedDateKey = today;
      return;
    }
    const mem = this.nvlCatalogFull.peekCached();
    if (mem?.length) {
      this.fillCatalogCacheFromNvlItems(mem);
      this.catalogLoaded = true;
      this.catalogLoadedDateKey = today;
      this.rememberSharedCatalog();
    }
  }

  private rememberSharedCatalog(): void {
    if (!this.catalogCache.size) return;
    MaterialsComponent.sharedCatalogCache = this.catalogCache;
    MaterialsComponent.sharedCatalogDateKey = this.catalogLoadedDateKey || this.catalogTodayKey();
  }

  /** Đọc catalog từ đĩa (IndexedDB / localStorage compact) — không tốn lượt đọc Firestore. */
  private async hydrateCatalogFromDisk(): Promise<boolean> {
    if (this.catalogCache.size > 0 && this.catalogLoadedDateKey === this.catalogTodayKey()) return true;
    const fromLs = this.tryApplyCatalogCachePayload(this.readCatalogCacheFromLocalStorage());
    if (fromLs) return true;
    const fromIdb = this.tryApplyCatalogCachePayload(await this.readCatalogCacheFromIdb());
    return fromIdb;
  }

  private readCatalogCacheFromLocalStorage(): unknown {
    try {
      const v2 = localStorage.getItem(MaterialsComponent.CATALOG_CACHE_KEY_V2);
      if (v2) return JSON.parse(v2);
      const v1 = localStorage.getItem(MaterialsComponent.CATALOG_LOCALSTORAGE_KEY);
      if (v1) return JSON.parse(v1);
    } catch { /* ignore */ }
    return null;
  }

  private tryApplyCatalogCachePayload(parsed: unknown): boolean {
    if (!parsed || typeof parsed !== 'object') return false;
    const p = parsed as { v?: number; t?: number; timestamp?: number; d?: string; rows?: unknown[]; items?: any[] };
    const ts = Number(p.t || p.timestamp || 0);
    if (!ts || Date.now() - ts >= MaterialsComponent.CATALOG_CACHE_TTL_MS) return false;
    const cacheDay = String(p.d || '') || this.catalogDateKeyFromTs(ts);
    if (cacheDay !== this.catalogTodayKey()) return false;

    this.catalogCache.clear();
    if (Array.isArray(p.rows)) {
      for (const row of p.rows) {
        if (!Array.isArray(row) || !row[0]) continue;
        const flags = Number(row[4] || 0);
        this.catalogCache.set(String(row[0]), {
          materialCode: String(row[0]),
          materialName: String(row[1] || ''),
          unit: String(row[2] || 'PCS'),
          standardPacking: Number(row[3] || 0) || 0,
          standardPackingLocked: (flags & 1) === 1,
          isMsd: (flags & 2) === 2,
          isEsd: (flags & 4) === 4
        });
      }
    } else if (Array.isArray(p.items)) {
      for (const item of p.items) {
        const code = String(item?.materialCode || '').trim().toUpperCase();
        if (code) this.catalogCache.set(code, item);
      }
    }
    if (this.catalogCache.size > 0) {
      console.log(`📱 Loaded ${this.catalogCache.size} catalog items from disk cache`);
      this.catalogLoaded = true;
      this.catalogLoadedDateKey = this.catalogTodayKey();
      this.rememberSharedCatalog();
      return true;
    }
    return false;
  }

  private buildCatalogCachePayload(): { v: number; t: number; d: string; rows: Array<[string, string, string, number, number]> } {
    const rows: Array<[string, string, string, number, number]> = [];
    this.catalogCache.forEach((item, code) => {
      const flags =
        (item?.standardPackingLocked ? 1 : 0) |
        (item?.isMsd ? 2 : 0) |
        (item?.isEsd ? 4 : 0);
      rows.push([
        String(code || item?.materialCode || ''),
        String(item?.materialName || ''),
        String(item?.unit || 'PCS'),
        Number(item?.standardPacking || 0) || 0,
        flags
      ]);
    });
    return { v: 2, t: Date.now(), d: this.catalogTodayKey(), rows };
  }

  private persistCatalogCache(): void {
    if (!this.catalogCache.size) return;
    const payload = this.buildCatalogCachePayload();
    try {
      localStorage.removeItem(MaterialsComponent.CATALOG_LOCALSTORAGE_KEY);
    } catch { /* ignore */ }
    try {
      const json = JSON.stringify(payload);
      if (json.length <= MaterialsComponent.CATALOG_LS_MAX_CHARS) {
        localStorage.setItem(MaterialsComponent.CATALOG_CACHE_KEY_V2, json);
      } else {
        localStorage.removeItem(MaterialsComponent.CATALOG_CACHE_KEY_V2);
      }
    } catch {
      try { localStorage.removeItem(MaterialsComponent.CATALOG_CACHE_KEY_V2); } catch { /* ignore */ }
    }
    void this.writeCatalogCacheToIdb(payload);
  }

  private saveCatalogToLocalStorage(): void {
    this.persistCatalogCache();
  }

  private catalogIdbOpen(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') {
          resolve(null);
          return;
        }
        const req = indexedDB.open(MaterialsComponent.CATALOG_IDB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private async readCatalogCacheFromIdb(): Promise<unknown> {
    const db = await this.catalogIdbOpen();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('kv', 'readonly');
        const req = tx.objectStore('kv').get(MaterialsComponent.CATALOG_CACHE_KEY_V2);
        req.onsuccess = () => {
          resolve(req.result || null);
          db.close();
        };
        req.onerror = () => {
          db.close();
          resolve(null);
        };
      } catch {
        db.close();
        resolve(null);
      }
    });
  }

  private async writeCatalogCacheToIdb(payload: unknown): Promise<void> {
    const db = await this.catalogIdbOpen();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(payload, MaterialsComponent.CATALOG_CACHE_KEY_V2);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      } catch {
        try { db.close(); } catch { /* ignore */ }
        resolve();
      }
    });
  }

  private ingestCatalogDoc(doc: { id: string; data: () => unknown }): boolean {
    const data = doc.data() as Record<string, unknown> | undefined;
    if (!data) return false;
    const materialCode = String(
      data.materialCode || data.code || data.material_code || doc.id || ''
    ).trim().toUpperCase();
    const materialName = String(data.materialName || data.name || data.material_name || '').trim();
    if (!materialCode || !materialName) return false;
    this.catalogCache.set(materialCode, {
      materialCode,
      materialName,
      unit: data.unit || data.unitOfMeasure || 'PCS',
      standardPacking: Number(data.standardPacking || data.packing || data.unitSize || 0) || 0,
      standardPackingLocked: data.standardPackingLocked === true,
      isMsd: data.isMsd === true,
      isEsd: data.isEsd === true
    });
    return true;
  }

  /** Chỉ đọc catalog `materials` cho mã đang xem — không load ~10K doc khi mở KK. */
  private async ensureCatalogForMaterialCodes(codes: string[]): Promise<void> {
    if (this.catalogCache.size === 0) {
      await this.hydrateCatalogFromDisk();
    }
    const unique = [...new Set(codes.map(c => String(c || '').trim().toUpperCase()).filter(Boolean))];
    const missing = unique.filter(c => !this.catalogCache.has(c));
    if (missing.length === 0) {
      this.catalogLoaded = this.catalogCache.size > 0;
      return;
    }
    let reads = 0;
    const fetchOne = async (code: string): Promise<void> => {
      try {
        const byId = await this.firestore.collection('materials').doc(code).get().toPromise();
        reads++;
        if (byId?.exists && this.ingestCatalogDoc(byId)) return;
        const q = await this.firestore.collection('materials', ref =>
          ref.where('materialCode', '==', code).limit(1)
        ).get().toPromise();
        reads += q?.docs?.length || 0;
        if (q && !q.empty) this.ingestCatalogDoc(q.docs[0]);
      } catch (e) {
        console.warn('[ASM1] ensureCatalogForMaterialCodes:', code, e);
      }
    };
    for (let i = 0; i < missing.length; i += 20) {
      await Promise.all(missing.slice(i, i + 20).map(fetchOne));
    }
    if (reads > 0) {
      this.readTracker.track('materials', 'materials', reads);
      this.persistCatalogCache();
    }
    this.catalogLoaded = this.catalogCache.size > 0;
  }

  private applyCatalogToMaterials(materials: InventoryMaterial[]): void {
    for (const material of materials) {
      const code = String(material.materialCode || '').trim().toUpperCase();
      if (!code) continue;
      const catalogItem = this.catalogCache.get(code);
      if (!catalogItem) continue;
      material.materialName = catalogItem.materialName;
      material.unit = catalogItem.unit;
      material.standardPacking = Number(catalogItem.standardPacking) || 0;
    }
  }

  /** Một promise chung — không đọc collection `materials` 2 lần khi mở tab. Sang ngày mới thì đọc lại. */
  ensureCatalogLoaded(): Promise<void> {
    const today = this.catalogTodayKey();
    if (this.catalogLoadPromise && (this.isCatalogLoading || this.catalogLoadedDateKey === today)) {
      return this.catalogLoadPromise;
    }
    this.catalogLoadPromise = this.loadCatalogFromFirebase(false);
    return this.catalogLoadPromise;
  }

  /** Nút "Cập nhật danh mục" — đọc lại Danh mục NVL ngay, áp Standard Packing lên bảng. */
  async refreshNvlCatalogNow(): Promise<void> {
    if (this.isCatalogLoading) return;
    this.closeMorePopup();
    this.catalogLoadPromise = this.loadCatalogFromFirebase(true);
    await this.catalogLoadPromise;
    this.consolidationMessage = `✅ Đã cập nhật danh mục NVL (${this.catalogCache.size} mã) — cột Standard Packing đã làm mới`;
    this.showConsolidationMessage = true;
    if (this.showKkLocMap) {
      alert(this.consolidationMessage);
    }
    this.cdr.detectChanges();
  }

  private fillCatalogCacheFromNvlItems(items: Array<{
    materialCode: string;
    materialName?: string;
    unit?: string;
    standardPacking?: number;
    standardPackingLocked?: boolean;
    isMsd?: boolean;
    isEsd?: boolean;
  }>): void {
    this.catalogCache.clear();
    for (const item of items) {
      const materialCode = this.nvlCatalogFull.normalizeCode(item.materialCode);
      if (!materialCode) continue;
      this.catalogCache.set(materialCode, {
        materialCode,
        materialName: item.materialName || '',
        unit: item.unit || 'PCS',
        standardPacking: Number(item.standardPacking) || 0,
        standardPackingLocked: item.standardPackingLocked === true,
        isMsd: item.isMsd === true,
        isEsd: item.isEsd === true
      });
    }
  }

  private applyCatalogToAllViews(): void {
    this.applyCatalogToMaterials(this.inventoryMaterials);
    this.kkLocMapTypeCache.forEach(list => this.applyCatalogToMaterials(list));
    this.invalidateKkTypeViewCache();
  }

  private mergeNvlItemIntoCatalogCache(item: {
    materialCode: string;
    materialName?: string;
    unit?: string;
    standardPacking?: number;
    standardPackingLocked?: boolean;
    isMsd?: boolean;
    isEsd?: boolean;
  }): void {
    const materialCode = this.nvlCatalogFull.normalizeCode(item.materialCode);
    if (!materialCode) return;
    const existing = this.catalogCache.get(materialCode) || { materialCode };
    this.catalogCache.set(materialCode, {
      ...existing,
      materialCode,
      materialName: item.materialName || existing.materialName || '',
      unit: item.unit || existing.unit || 'PCS',
      standardPacking: Number(item.standardPacking) || 0,
      standardPackingLocked: item.standardPackingLocked === true,
      isMsd: item.isMsd === true,
      isEsd: item.isEsd === true
    });
  }

  // Load catalog from Firebase (Danh mục NVL). forceRefresh = bỏ cache trong ngày.
  // Không bật overlay "Đang tải danh mục" trừ khi user bấm Cập nhật danh mục.
  private async loadCatalogFromFirebase(forceRefresh = false): Promise<void> {
    if (forceRefresh) {
      this.isCatalogLoading = true;
      this.cdr.markForCheck();
    }
    const today = this.catalogTodayKey();

    try {
      if (!forceRefresh && this.hydrateCatalogFromNvlMemoryOrShared()) {
        this.applyCatalogToAllViews();
        return;
      }

      if (!forceRefresh && this.catalogCache.size > 0 && this.catalogLoadedDateKey === today) {
        this.catalogLoaded = true;
        this.applyCatalogToAllViews();
        return;
      }

      if (!forceRefresh && await this.hydrateCatalogFromDisk()) {
        this.catalogLoaded = true;
        this.catalogLoadedDateKey = today;
        this.applyCatalogToAllViews();
        return;
      }

      const items = await this.nvlCatalogFull.listAll(forceRefresh);
      if (items.length) {
        this.fillCatalogCacheFromNvlItems(items);
        this.catalogLoaded = true;
        this.catalogLoadedDateKey = today;
        this.rememberSharedCatalog();
        if (forceRefresh) this.readTracker.track('materials', 'materials', items.length);
        this.persistCatalogCache();
        this.applyCatalogToAllViews();
        console.log(`✅ Loaded ${this.catalogCache.size} catalog items from Danh mục NVL`);
        return;
      }
    } catch (error) {
      console.error('❌ Error loading catalog from Firebase:', error);
      this.catalogLoaded = this.catalogCache.size > 0;
    } finally {
      this.isCatalogLoading = false;
      this.cdr.detectChanges();
    }
  }

  private hydrateCatalogFromNvlMemoryOrShared(): boolean {
    this.restoreCatalogMemoryFast();
    return this.catalogLoaded && this.catalogLoadedDateKey === this.catalogTodayKey();
  }

  // Apply filters to inventory
  applyFilters(): void {
    // Reset negative stock filter when applying other filters
    this.showOnlyNegativeStock = false;
    
    this.filteredInventory = this.inventoryMaterials.filter(material => {
      // Always filter by ASM1 only
      if (material.factory !== this.selectedFactory) {
        return false;
      }

      if (this.searchByKk && material.kkChecked !== true) {
        return false;
      }

      if (this.viewWarehouseFilter && !this.materialMatchesViewWarehouse(material)) {
        return false;
      }

      if (this.searchTerm) {
        const term = this.searchTerm.trim().toUpperCase();
        if (this.isTieuHuySearchTerm(term)) {
          if (!this.isTieuHuyLocation(String(material.location ?? (material as any).viTri ?? ''))) return false;
        } else if (this.searchByCustomer) {
          const customer = this.getCustomerForMaterial(material).toUpperCase();
          if (!customer.includes(term)) return false;
        } else if (this.isLocationSearchActive) {
          const loc = String(material.location ?? (material as any).viTri ?? '').trim().toUpperCase();
          if (!loc.includes(term)) return false;
        } else if (this.searchType === 'po') {
          if (!material.poNumber?.toUpperCase().includes(term)) return false;
        } else if (!material.materialCode?.toUpperCase().includes(term)) {
          return false;
        }
      }

      return true;
    });

    // Sort by Material Code -> PO (oldest first) - SIMPLE FIFO LOGIC
    this.sortInventoryFIFO();
    
    // Mark duplicates
    this.markDuplicates();
    
    // Update pagination and displayed inventory
    this.updatePagination();
    this.updateDisplayedInventory();
    
    console.log('🔍 ASM1 filters applied. Items found:', this.filteredInventory.length);
  }

  get viewWarehouseButtonLabel(): string {
    const found = this.viewWarehouseOptions.find((o) => o.id === this.viewWarehouseFilter);
    return found?.id ? found.label : 'Kho';
  }

  openKhoPopup(): void {
    this.showKhoPopup = true;
  }

  closeKhoPopup(): void {
    this.showKhoPopup = false;
  }

  async setViewWarehouseFilter(id: '' | 'J' | 'ASM3' | '00' | 'NG'): Promise<void> {
    this.viewWarehouseFilter = id;
    this.showKhoPopup = false;
    if (!id) {
      if (this.searchTerm.trim()) {
        await this.performSearch(this.searchTerm);
      } else {
        this.inventoryMaterials = [];
        this.filteredInventory = [];
        this.displayedInventory = [];
        this.currentPage = 1;
        this.updatePagination();
        this.updateDisplayedInventory();
        this.cdr.detectChanges();
      }
      return;
    }
    if (this.searchTerm.trim() && this.inventoryMaterials.length) {
      this.applyViewWarehouseToCurrentList();
      return;
    }
    await this.loadViewWarehouseInventory();
  }

  materialMatchesViewWarehouse(material: InventoryMaterial): boolean {
    if (!this.viewWarehouseFilter) return true;
    const loc = String(material?.location ?? (material as any)?.viTri ?? '');
    const tokens = splitMultiLocations(loc);
    const locs = tokens.length ? tokens : [loc];
    return locs.some((token) => this.locationMatchesViewWarehouse(token, this.viewWarehouseFilter as 'J' | 'ASM3' | '00' | 'NG'));
  }

  private locationMatchesViewWarehouse(
    location: string,
    wh: 'J' | 'ASM3' | '00' | 'NG'
  ): boolean {
    const raw = String(location || '').trim().toUpperCase();
    if (!raw) return false;
    const stripped = this.stripDoiKhoWhPrefix(raw).toUpperCase();
    if (wh === 'NG') {
      return isNgPrefixLocation(raw) || isNgPrefixLocation(stripped);
    }
    if (wh === 'ASM3') {
      return isAsm3OrWh3PrefixLocation(raw) || isAsm3OrWh3PrefixLocation(stripped);
    }
    if (wh === '00') {
      return raw === '00' || raw.startsWith('00-') || raw.startsWith('00+')
        || stripped === '00' || stripped.startsWith('00-') || stripped.startsWith('00+');
    }
    return raw.startsWith('J5-') || isJWarehouseLocation(raw) || isJWarehouseLocation(stripped);
  }

  private applyViewWarehouseToCurrentList(): void {
    this.filteredInventory = this.inventoryMaterials.filter((m) => this.materialMatchesViewWarehouse(m));
    this.sortInventoryFIFO();
    this.markDuplicates();
    this.currentPage = 1;
    this.updatePagination();
    this.updateDisplayedInventory();
    this.cdr.detectChanges();
  }

  private async loadViewWarehouseInventory(): Promise<void> {
    const wh = this.viewWarehouseFilter;
    if (!wh) return;
    this.isLoading = true;
    this.isSearching = true;
    this.searchProgress = 20;
    try {
      const factories: Array<'ASM1' | 'ASM2'> = wh === 'ASM3'
        ? ['ASM1', 'ASM2']
        : [this.selectedFactory];
      const snaps = await Promise.all(
        factories.map((factory) =>
          this.firestore.collection('inventory-materials', (ref) =>
            ref.where('factory', '==', factory).limit(10000)
          ).get().toPromise()
        )
      );
      this.searchProgress = 70;
      const seen = new Set<string>();
      const materials: InventoryMaterial[] = [];
      for (const snap of snaps) {
        for (const doc of snap?.docs || []) {
          if (seen.has(doc.id)) continue;
          const data = doc.data() as any;
          const loc = String(data?.location || data?.viTri || '').trim().toUpperCase();
          const probe = { location: loc } as InventoryMaterial;
          if (!this.materialMatchesViewWarehouse(probe)) continue;
          seen.add(doc.id);
          const material = {
            id: doc.id,
            ...data,
            factory: data.factory || this.selectedFactory,
            location: loc,
            palletId: String(data.palletId || '').trim().toUpperCase(),
            importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : new Date(),
            receivedDate: data.receivedDate ? new Date(data.receivedDate.seconds * 1000) : new Date(),
            expiryDate: data.expiryDate ? new Date(data.expiryDate.seconds * 1000) : new Date(),
            openingStock: data.openingStock || null,
            xt: data.xt || 0,
            source: data.source || 'manual',
            iqcStatus: data.iqcStatus || undefined,
            modifiedBy: data.modifiedBy || '',
            locationManualOverride: !!data.locationManualOverride
          } as InventoryMaterial;
          this.stampLocationAtLoad(material);
          materials.push(material);
        }
      }
      this.readTracker.track('materials', 'inventory-materials', materials.length);
      this.inventoryMaterials = materials;
      this.applyCatalogToMaterials(this.inventoryMaterials);
      this.filteredInventory = [...this.inventoryMaterials];
      this.sortInventoryFIFO();
      this.markDuplicates();
      this.currentPage = 1;
      this.updatePagination();
      this.updateDisplayedInventory();
      if (this.filteredInventory.length) {
        void this.refreshLastStatusForMaterials(this.filteredInventory);
      }
    } catch (e) {
      console.error('❌ loadViewWarehouseInventory:', e);
      this.inventoryMaterials = [];
      this.filteredInventory = [];
      this.displayedInventory = [];
    } finally {
      this.isLoading = false;
      this.isSearching = false;
      this.searchProgress = 100;
      this.cdr.detectChanges();
    }
  }

  // Update pagination
  updatePagination(): void {
    this.totalPages = Math.ceil(this.filteredInventory.length / this.itemsPerPage);
    if (this.currentPage > this.totalPages && this.totalPages > 0) {
      this.currentPage = 1;
    }
  }

  // Update displayed inventory based on current page
  updateDisplayedInventory(): void {
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    this.displayedInventory = this.filteredInventory.slice(startIndex, endIndex);
  }

  // Go to specific page
  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage = page;
      this.updateDisplayedInventory();
    }
  }

  // Next page
  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
      this.updateDisplayedInventory();
    }
  }

  // Previous page
  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.updateDisplayedInventory();
    }
  }

  // New optimized search method
  onSearchInput(event: any): void {
    let searchTerm = event.target.value;
    console.log('🔍 ASM1 Search input:', searchTerm);
    
    // Auto-convert to uppercase (only if different to avoid infinite loop)
    if (searchTerm && searchTerm !== searchTerm.toUpperCase()) {
      searchTerm = searchTerm.toUpperCase();
      // Use setTimeout to avoid infinite loop with ngModel
      setTimeout(() => {
        event.target.value = searchTerm;
        this.searchTerm = searchTerm;
      }, 0);
    }
    
    // Clear results immediately if search is empty
    if (!searchTerm || searchTerm.trim() === '') {
      if (this.searchByKk) {
        this.searchTerm = '';
        this.applyFilters();
        return;
      }
      this.clearSearch();
      return;
    }
    
    // Send to debounced search
    this.searchSubject.next(searchTerm);
  }

  // Handle search input with better uppercase conversion
  onSearchKeyUp(event: any): void {
    const searchTerm = event.target.value;
    
    // Convert to uppercase on key up
    if (searchTerm && searchTerm !== searchTerm.toUpperCase()) {
      event.target.value = searchTerm.toUpperCase();
      this.searchTerm = searchTerm.toUpperCase();
    }
  }

  get searchInputPlaceholder(): string {
    if (this.isLoading) return '🔍 Đang tải...';
    if (this.searchByKk) return 'Lọc trong danh sách đã KK…';
    if (this.searchByLocation) return 'Vị trí (H12, TRA…)…';
    if (this.searchByCustomer) return 'Khách hàng (VD: Customer A, Shared)…';
    if (this.searchType === 'po') return 'Tìm theo PO…';
    return 'Mã hàng…';
  }

  /** true khi đang search theo vị trí — qua tick Location hoặc qua nút cycle Mã/PO/Vị trí. */
  get isLocationSearchActive(): boolean {
    return this.searchByLocation || this.searchType === 'location';
  }

  onSearchByLocationChange(): void {
    if (this.searchByLocation) {
      this.searchType = 'location';
      this.searchByCustomer = false;
    } else if (this.searchType === 'location') {
      this.searchType = 'material';
    }
    this.clearSearch();
  }

  onSearchByCustomerChange(): void {
    if (this.searchByCustomer) {
      this.searchByLocation = false;
      this.showKhColumn = true;
      void this.applyNvlkhFromCatalog();
    }
    this.clearSearch();
  }

  get filteredCustomerOptions(): string[] {
    const q = (this.customerFilterQuery || '').trim().toLowerCase();
    if (!q) return this.customerFilterOptions;
    return this.customerFilterOptions.filter((c) => c.toLowerCase().includes(q));
  }

  get filteredLocationOptions(): string[] {
    const q = (this.locationFilterQuery || '').trim().toUpperCase();
    if (!q) return this.locationFilterOptions;
    return this.locationFilterOptions.filter((loc) => loc.includes(q));
  }

  openCustomerFilterPopup(): void {
    this.customerFilterQuery = this.searchByCustomer ? this.searchTerm : '';
    this.showCustomerFilterPopup = true;
    void this.loadCustomerFilterOptions();
  }

  closeCustomerFilterPopup(): void {
    this.showCustomerFilterPopup = false;
    this.customerFilterQuery = '';
  }

  async loadCustomerFilterOptions(): Promise<void> {
    this.isLoadingCustomerFilterOptions = true;
    try {
      const map = await this.nvlkhCatalog.loadAllAsMap();
      this.nvlkhCustomerMap = map;
      const set = new Set<string>();
      map.forEach((customer) => {
        const c = String(customer || '').trim();
        if (c) set.add(c);
      });
      this.customerFilterOptions = Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
    } catch (e) {
      console.error('loadCustomerFilterOptions', e);
      this.customerFilterOptions = [];
    } finally {
      this.isLoadingCustomerFilterOptions = false;
    }
  }

  selectCustomerFilter(customer: string): void {
    const term = String(customer || '').trim();
    if (!term) return;
    this.searchByCustomer = true;
    this.searchByLocation = false;
    this.searchByKk = false;
    this.showKhColumn = true;
    this.searchType = 'material';
    this.searchTerm = term;
    this.closeCustomerFilterPopup();
    void this.applyNvlkhFromCatalog();
    void this.performSearch(term);
  }

  clearCustomerFilter(): void {
    this.searchByCustomer = false;
    this.clearSearch();
    this.closeCustomerFilterPopup();
  }

  openLocationFilterPopup(): void {
    this.locationFilterQuery = this.searchByLocation ? this.searchTerm : '';
    this.showLocationFilterPopup = true;
    void this.loadLocationFilterOptions();
  }

  closeLocationFilterPopup(): void {
    this.showLocationFilterPopup = false;
    this.locationFilterQuery = '';
  }

  async loadLocationFilterOptions(): Promise<void> {
    this.isLoadingLocationFilterOptions = true;
    try {
      const fromLoaded = new Set<string>();
      const addLocs = (raw: string) => {
        splitMultiLocations(raw).forEach((loc) => {
          const u = loc.toUpperCase();
          if (u) fromLoaded.add(u);
        });
      };

      this.inventoryMaterials.forEach((m) => addLocs(String(m.location || '')));

      const hasWh3 = Array.from(fromLoaded).some((loc) => isAsm3OrWh3PrefixLocation(loc));
      if (fromLoaded.size < 80 || !hasWh3) {
        const factories: Array<'ASM1' | 'ASM2'> = hasWh3
          ? [this.selectedFactory]
          : ['ASM1', 'ASM2'];
        for (const factory of factories) {
          const snap = await this.firestore
            .collection('inventory-materials', (ref) =>
              ref.where('factory', '==', factory).limit(2000)
            )
            .get()
            .toPromise();
          (snap?.docs || []).forEach((doc) => {
            const data = doc.data() as any;
            addLocs(String(data?.location ?? data?.viTri ?? ''));
          });
        }
      }

      try {
        const raw = localStorage.getItem(`materials-${this.selectedFactory}:recent-locations:v1`);
        const recent = raw ? (JSON.parse(raw) as string[]) : [];
        (recent || []).forEach((r) => addLocs(String(r || '')));
      } catch { /* ignore */ }

      const keys = new Set<string>(this.knownLocationGroups);
      fromLoaded.forEach((loc) => {
        const special = this.locationSpecialGroup(loc);
        if (special) keys.add(special);
        const bodyKey = this.locationGroupKey(special ? this.locationAlnum(loc) : loc);
        if (bodyKey && bodyKey !== special) keys.add(bodyKey);
      });
      this.locationFilterOptions = Array.from(keys).sort((a, b) => a.localeCompare(b));
    } catch (e) {
      console.error('loadLocationFilterOptions', e);
      this.locationFilterOptions = [];
    } finally {
      this.isLoadingLocationFilterOptions = false;
    }
  }

  private rememberRecentLocation(loc: string): void {
    const key = `materials-${this.selectedFactory}:recent-locations:v1`;
    try {
      const raw = localStorage.getItem(key);
      const list: string[] = raw ? JSON.parse(raw) : [];
      const next = [loc, ...list.filter((x) => x !== loc)].slice(0, 30);
      localStorage.setItem(key, JSON.stringify(next));
    } catch { /* ignore */ }
  }

  selectLocationFilter(location: string): void {
    const term = String(location || '').trim().toUpperCase();
    if (!term) return;
    this.applyLocationFilter(term);
  }

  applyLocationFilterFromInput(): void {
    const term = (this.locationFilterQuery || '').trim().toUpperCase();
    if (!term) return;
    this.applyLocationFilter(term);
  }

  private applyLocationFilter(term: string): void {
    this.searchByLocation = true;
    this.searchByCustomer = false;
    this.searchByKk = false;
    this.searchType = 'location';
    this.searchTerm = term;
    this.rememberRecentLocation(term);
    this.closeLocationFilterPopup();
    void this.performSearch(term);
  }

  clearLocationFilter(): void {
    this.searchByLocation = false;
    if (this.searchType === 'location') this.searchType = 'material';
    this.clearSearch();
    this.closeLocationFilterPopup();
  }

  onShowKhColumnChange(): void {
    if (this.showKhColumn) {
      void this.applyNvlkhFromCatalog();
    }
  }

  /** Đổi kiểu tìm kiếm (Mã hàng / PO). */
  changeSearchType(type: 'material' | 'po' | 'location'): void {
    this.searchType = type;
    this.searchTerm = '';
    this.applyFilters();
  }

  /** Bấm nút để chuyển vòng Mã ⇄ PO (bỏ qua khi đang tick Location/KH). */
  cycleSearchType(): void {
    if (this.searchByLocation || this.searchByCustomer || this.searchByKk) return;
    const types: ('material' | 'po')[] = ['material', 'po'];
    const currentIndex = types.indexOf(this.searchType as 'material' | 'po');
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % types.length;
    this.changeSearchType(types[nextIndex]);
  }

  // Clear search and reset to initial state
  clearSearch(): void {
    this.searchTerm = '';
    this.searchByKk = false;
    this.showOnlyNegativeStock = false;
    if (this.viewWarehouseFilter) {
      void this.loadViewWarehouseInventory();
      return;
    }
    this.filteredInventory = [];
    this.inventoryMaterials = [];

    // Return to initial state - no data displayed
    console.log('🧹 ASM1 Search cleared, returning to initial state (no data displayed)');
  }

  /** Bấm chip KK / banner KK: hiện danh sách đang tick. */
  toggleKkCheckedFilter(): void {
    if (this.isLoading || this.kkCheckRunning) return;
    if (this.searchByKk) {
      this.searchByKk = false;
      this.clearSearch();
      return;
    }
    if (this.kkTickedMaterialsCache.length) {
      this.showKkTickedMaterials(this.kkTickedMaterialsCache);
      return;
    }
    void this.loadKkCheckedList();
  }

  openKkListFromBanner(event?: Event): void {
    event?.stopPropagation();
    if (this.kkCheckRunning || this.isLoading) return;
    if (this.searchByKk && this.filteredInventory.length) return;
    this.toggleKkCheckedFilter();
  }

  private isKkFlagOn(value: unknown): boolean {
    if (value === true || value === 1) return true;
    const s = String(value ?? '').trim().toUpperCase();
    return s === 'TRUE' || s === '1' || s === 'YES';
  }

  private async loadKkCheckedList(): Promise<void> {
    this.isLoading = true;
    this.isSearching = true;
    this.searchProgress = 20;
    this.cdr.detectChanges();
    try {
      this.searchProgress = 40;
      // Dùng chung cache KK theo factory (không quét lại 10k doc mỗi lần mở danh sách).
      const factoryDocs = await this.getKkFactoryDocs(this.selectedFactory);

      const byId = new Map<string, any>();
      for (const doc of factoryDocs) {
        if (this.isKkFlagOn((doc.data() as any)?.kkChecked)) byId.set(doc.id, doc);
      }

      const docs = Array.from(byId.values());
      this.searchProgress = 80;
      this.readTracker.track('materials', 'inventory-materials', factoryDocs.length);

      this.inventoryMaterials = docs.map((doc) => this.mapKkInventoryDoc(doc));
      this.kkTickedMaterialsCache = [...this.inventoryMaterials];
      this.showKkTickedMaterials(this.inventoryMaterials);
      this.isLoading = false;
      this.isSearching = false;
      this.searchProgress = 100;
      this.cdr.detectChanges();

      if (!this.filteredInventory.length) {
        alert(`Không có dòng nào đang tick KK trên ${this.selectedFactory}.`);
      } else {
        void this.refreshLastStatusForMaterials(this.filteredInventory);
        void this.ensureCatalogForMaterialCodes(this.inventoryMaterials.map((m) => m.materialCode)).then(() => {
          this.applyCatalogToMaterials(this.inventoryMaterials);
          void this.applyStorageUnitsFromCatalog();
          if (this.showKhColumn) void this.applyNvlkhFromCatalog();
          this.cdr.markForCheck();
        });
      }
    } catch (e) {
      console.error('❌ loadKkCheckedList:', e);
      this.inventoryMaterials = [];
      this.filteredInventory = [];
      this.displayedInventory = [];
      alert('❌ Không tải được danh sách đã KK.');
    } finally {
      this.isLoading = false;
      this.isSearching = false;
      this.searchProgress = 100;
      this.cdr.detectChanges();
    }
  }

  private mapKkInventoryDoc(doc: any): InventoryMaterial {
    const data = (doc?.data ? doc.data() : doc) as any;
    const material = {
      id: doc.id,
      ...data,
      factory: data.factory || this.selectedFactory,
      location: this.locationFromInventoryDoc(data),
      palletId: String(data.palletId || '').trim().toUpperCase(),
      importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : new Date(),
      receivedDate: data.receivedDate ? new Date(data.receivedDate.seconds * 1000) : new Date(),
      expiryDate: data.expiryDate ? new Date(data.expiryDate.seconds * 1000) : new Date(),
      openingStock: data.openingStock || null,
      xt: data.xt || 0,
      source: data.source || 'manual',
      iqcStatus: data.iqcStatus || undefined,
      modifiedBy: data.modifiedBy || '',
      locationManualOverride: !!data.locationManualOverride,
      kkChecked: true,
      kkBy: data.kkBy || '',
      kkAt: data.kkAt || null,
      kkScanCount: Math.max(0, Number(data.kkScanCount) || 0)
    } as InventoryMaterial;
    this.stampLocationAtLoad(material);
    return material;
  }

  private showKkTickedMaterials(rows: InventoryMaterial[]): void {
    this.searchByLocation = false;
    this.searchByCustomer = false;
    this.searchType = 'material';
    this.searchTerm = '';
    this.searchByKk = true;
    this.showOnlyNegativeStock = false;
    this.inventoryMaterials = rows.map((row) => ({ ...row, kkChecked: true }));
    this.filteredInventory = [...this.inventoryMaterials];
    this.sortInventoryFIFO();
    this.currentPage = 1;
    this.updatePagination();
    this.updateDisplayedInventory();
    this.updateNegativeStockCount();
    this.isLoading = false;
    this.isSearching = false;
    this.cdr.detectChanges();
  }

  private docMatchesLocationSearch(data: any, normalizedLocation: string): boolean {
    const tokens = splitMultiLocations(String(data?.location ?? data?.viTri ?? ''));
    if (!tokens.length) return false;
    return tokens.some((loc) => this.locationMatchesGroup(loc, normalizedLocation));
  }

  private locationCompact(loc: string): string {
    return String(loc || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /** Nhóm cố định luôn hiện trong popup lọc vị trí. */
  private readonly knownLocationGroups = [
    'WH3', 'IQC', 'LOCKER', 'NG', 'TRA', 'E7', 'F7', 'F62', 'A12', 'Q1', 'Q2', 'Q3', 'TIEUHUY'
  ];

  /** IQC / LOCKER / NG / TRA / A12 / Q1–Q3 / kho WH3. */
  private locationSpecialGroup(loc: string): string | null {
    if (this.isTieuHuyLocation(loc)) return 'TIEUHUY';
    if (isAsm3OrWh3PrefixLocation(loc)) return 'WH3';
    if (isIqcPrefixLocation(loc)) return 'IQC';
    if (isLockerPrefixLocation(loc)) return 'LOCKER';
    if (isNgPrefixLocation(loc)) return 'NG';
    const c = this.locationCompact(loc);
    if (!c) return null;
    if (c === 'TRA' || c === 'F62TRA' || c.startsWith('F62TRA') || c.endsWith('TRA')) return 'TRA';
    if (c === 'A12' || c === 'NVLA12' || c.startsWith('NVLA12')) return 'A12';
    const q = /^Q([123])/.exec(c);
    if (q) return `Q${q[1]}`;
    return null;
  }

  /** Chỉ lấy chữ và số từ vị trí — bỏ . , - ( ) và tiền tố WH3/ASM3/F3 để D32 khớp WH3-D32. */
  private locationAlnum(loc: string): string {
    let s = this.locationCompact(loc);
    if (s.startsWith('WH3')) s = s.slice(3);
    else if (s.startsWith('ASM3')) s = s.slice(4);
    else if (/^F3[A-IK-L]\d/.test(s)) s = s.slice(2);
    return s;
  }

  /**
   * Nhóm vị trí để lọc:
   * - Nhóm đặc biệt: WH3, IQC, LOCKER, NG, TRA, A12, Q1–Q3
   * - Bắt đầu A–G → 3 ký tự chữ/số đầu
   * - Từ H trở đi → 4 ký tự chữ/số đầu
   */
  locationGroupKey(loc: string): string {
    const special = this.locationSpecialGroup(loc);
    if (special) return special;
    const alnum = this.locationAlnum(loc);
    if (!alnum) return '';
    const first = alnum.charAt(0);
    const len = first >= 'A' && first <= 'G' ? 3 : 4;
    return alnum.slice(0, len);
  }

  private isWh3SearchTerm(term: string): boolean {
    const c = this.locationCompact(term);
    return this.locationSpecialGroup(term) === 'WH3'
      || c === 'WH3' || c === 'ASM3'
      || c.startsWith('WH3') || c.startsWith('ASM3')
      || /^F3[A-IK-L]\d/.test(c);
  }

  /** true nếu vị trí thuộc cùng nhóm với từ khóa tìm. */
  private locationMatchesGroup(location: string, searchTerm: string): boolean {
    const searchCompact = this.locationCompact(searchTerm);
    if (!searchCompact) return false;

    const searchSpecial = this.locationSpecialGroup(searchTerm)
      || (searchCompact === 'WH3' || searchCompact === 'ASM3' ? 'WH3' : null)
      || (searchCompact === 'IQC' ? 'IQC' : null)
      || (searchCompact === 'LOCKER' || searchCompact === 'LOCK' ? 'LOCKER' : null)
      || (searchCompact === 'NG' ? 'NG' : null)
      || (searchCompact === 'TRA' ? 'TRA' : null)
      || (searchCompact === 'A12' || searchCompact === 'NVLA12' ? 'A12' : null);

    if (searchSpecial && searchCompact === searchSpecial) {
      return this.locationSpecialGroup(location) === searchSpecial;
    }
    if (searchCompact === 'ASM3' || searchCompact === 'LOCK' || searchCompact === 'NVLA12') {
      return this.locationSpecialGroup(location) === searchSpecial;
    }

    if (this.isWh3SearchTerm(searchTerm) && searchCompact !== 'WH3' && searchCompact !== 'ASM3') {
      if (!isAsm3OrWh3PrefixLocation(location)) return false;
      let searchBody = searchCompact;
      if (searchCompact.startsWith('ASM3')) searchBody = searchCompact.slice(4);
      else if (searchCompact.startsWith('WH3')) searchBody = searchCompact.slice(3);
      else if (/^F3[A-IK-L]\d/.test(searchCompact)) searchBody = searchCompact.slice(2);
      if (!searchBody) return true;
      return this.locationMatchesGroup(this.locationAlnum(location), searchBody);
    }

    const locSpecial = this.locationSpecialGroup(location);
    const locKey = locSpecial || this.locationGroupKey(location);
    const searchAlnum = this.locationAlnum(searchTerm);
    if (!locKey || !searchAlnum) return false;

    if (locSpecial === 'WH3') {
      const bodyKey = this.locationGroupKey(this.locationAlnum(location));
      if (!bodyKey) return false;
      const searchKey = this.locationGroupKey(searchTerm);
      if (searchAlnum.length >= searchKey.length) return bodyKey === searchKey;
      return bodyKey.startsWith(searchAlnum);
    }
    if (locSpecial === 'TRA' && (searchAlnum === 'F62' || searchAlnum === 'F62TRA' || searchAlnum === 'TRA')) {
      return true;
    }
    if (locSpecial === 'A12' && (searchAlnum === 'A12' || searchAlnum === 'NVLA12')) {
      return true;
    }
    if (locSpecial && locSpecial.startsWith('Q') && searchAlnum.startsWith(locSpecial)) {
      return true;
    }

    const searchKey = this.locationGroupKey(searchTerm);
    if (searchAlnum.length >= searchKey.length) {
      return locKey === searchKey;
    }
    return locKey.startsWith(searchAlnum);
  }

  /** Chuỗi locations (xuống dòng hoặc "A01, A01.2") — khớp từng vị trí, không ghép liền. */
  private locationsTextMatchesGroup(locationsText: string, searchTerm: string): boolean {
    const parts = splitMultiLocations(locationsText).filter((x) => x && x !== '—');
    if (!parts.length) return false;
    return parts.some((loc) => this.locationMatchesGroup(loc, searchTerm));
  }

  /** Danh sách vị trí (từng token riêng). */
  locationParts(location: string | null | undefined): string[] {
    return splitMultiLocations(String(location || ''));
  }

  /** Hiển thị 1 vị trí đầu trong cột (nhiều vị trí → hover xem thêm). */
  primaryLocationDisplay(location: string | null | undefined): string {
    const parts = this.locationParts(location);
    return parts.length ? parts[0] : '-';
  }

  /** Số vị trí còn lại ngoài vị trí đầu (dùng badge +N). */
  locationExtraCount(location: string | null | undefined): number {
    return Math.max(0, this.locationParts(location).length - 1);
  }

  /** Chuỗi đầy đủ mọi vị trí (tooltip / textarea). */
  formatLocationDisplay(location: string | null | undefined): string {
    const parts = this.locationParts(location);
    return parts.length ? parts.join('\n') : '-';
  }

  /** Chuẩn hóa trước khi lưu: UPPER từng token, nối bằng xuống dòng. */
  private normalizeMultiLocationValue(raw: string): string {
    return joinMultiLocations(splitMultiLocations(raw));
  }

  // Perform search — mã hàng hoặc vị trí (tick Location)
  private async performSearch(searchTerm: string): Promise<void> {
    if (this.searchByKk) {
      this.searchTerm = searchTerm;
      this.applyFilters();
      return;
    }
    if (searchTerm.length === 0) {
      this.searchTerm = '';
      if (this.viewWarehouseFilter) {
        await this.loadViewWarehouseInventory();
        return;
      }
      this.filteredInventory = [];
      this.inventoryMaterials = [];
      return;
    }

    if (!this.isLocationSearchActive && searchTerm.length < 3) {
      this.filteredInventory = [];
      console.log(`⏰ ASM1 Search term "${searchTerm}" quá ngắn (cần ít nhất 3 ký tự)`);
      return;
    }

    if (this.isLocationSearchActive && searchTerm.trim().length < 1) {
      this.filteredInventory = [];
      return;
    }

    this.searchTerm = searchTerm;
    this.isLoading = true;
    this.isSearching = true;
    this.searchProgress = 0;

    try {
      let querySnapshot: { docs: any[]; empty: boolean } | undefined;

      if (this.isLocationSearchActive || this.isTieuHuySearchTerm(searchTerm)) {
        const normalizedLocation = searchTerm.trim().toUpperCase();
        const groupKey = this.locationGroupKey(normalizedLocation);
        console.log(`🔍 ASM1 Searching by location group: "${normalizedLocation}" → "${groupKey}"`);
        this.searchProgress = 30;
        const factories: Array<'ASM1' | 'ASM2'> = this.isWh3SearchTerm(normalizedLocation)
          ? ['ASM1', 'ASM2']
          : [this.selectedFactory];
        const snaps = await Promise.all(
          factories.map((factory) =>
            this.firestore.collection('inventory-materials', (ref) =>
              ref.where('factory', '==', factory).limit(10000)
            ).get().toPromise()
          )
        );
        this.searchProgress = 70;
        const seen = new Set<string>();
        const filtered: any[] = [];
        for (const snap of snaps) {
          for (const doc of snap?.docs || []) {
            if (seen.has(doc.id)) continue;
            if (!this.docMatchesLocationSearch(doc.data(), normalizedLocation)) continue;
            seen.add(doc.id);
            filtered.push(doc);
          }
        }
        querySnapshot = { docs: filtered, empty: filtered.length === 0 } as any;
      } else if (this.searchByCustomer) {
        const term = searchTerm.trim().toUpperCase();
        console.log(`🔍 ASM1 Searching by customer (Danh mục NVLKH): "${term}"`);
        this.searchProgress = 20;
        const customerMap = await this.nvlkhCatalog.loadAllAsMap();
        this.nvlkhCustomerMap = customerMap;
        const matchingCodes = [...customerMap.entries()]
          .filter(([, customer]) => customer.toUpperCase().includes(term))
          .map(([code]) => code);

        if (!matchingCodes.length) {
          querySnapshot = { docs: [], empty: true };
        } else {
          this.searchProgress = 50;
          const chunkSize = 10; // giới hạn Firestore cho toán tử 'in'
          const allDocs: any[] = [];
          for (let i = 0; i < matchingCodes.length; i += chunkSize) {
            const chunk = matchingCodes.slice(i, i + chunkSize);
            const snap = await this.firestore.collection('inventory-materials', ref =>
              ref.where('factory', '==', this.selectedFactory).where('materialCode', 'in', chunk).limit(500)
            ).get().toPromise();
            if (snap?.docs) allDocs.push(...snap.docs);
          }
          querySnapshot = { docs: allDocs, empty: allDocs.length === 0 };
        }
      } else if (this.searchType === 'po') {
        console.log(`🔍 Searching by PO: "${searchTerm}"...`);
        try {
          this.searchProgress = 25;
          querySnapshot = await this.firestore.collection('inventory-materials', ref =>
            ref.where('factory', '==', this.selectedFactory)
               .where('poNumber', '>=', searchTerm)
               .where('poNumber', '<=', searchTerm + '\uf8ff')
               .limit(100)
          ).get().toPromise();

          if (!querySnapshot || querySnapshot.empty) {
            console.log(`🔍 No pattern match for PO "${searchTerm}", trying exact match...`);
            this.searchProgress = 50;
            querySnapshot = await this.firestore.collection('inventory-materials', ref =>
              ref.where('factory', '==', this.selectedFactory)
                 .where('poNumber', '==', searchTerm)
                 .limit(100)
            ).get().toPromise();
          }
        } catch (indexError: any) {
          const msg = indexError?.message || '';
          if (msg.includes('index') || msg.includes('Index')) {
            this.searchProgress = 50;
            const allSnapshot = await this.firestore.collection('inventory-materials', ref =>
              ref.where('factory', '==', this.selectedFactory).limit(3000)
            ).get().toPromise();
            if (allSnapshot && !allSnapshot.empty) {
              const term = searchTerm.trim().toUpperCase();
              const filtered = allSnapshot.docs.filter(doc => {
                const po = (doc.data() as any).poNumber;
                return po && String(po).toUpperCase().includes(term);
              });
              querySnapshot = { docs: filtered, empty: filtered.length === 0 } as any;
            }
          } else {
            throw indexError;
          }
        }
      } else {
        console.log(`🔍 ASM1 Searching for materialCode: "${searchTerm}" - Loading from Firebase...`);
        const normalizedCode = searchTerm.trim().toUpperCase();

        try {
          this.searchProgress = 25;
          querySnapshot = await this.firestore.collection('inventory-materials', ref =>
            ref.where('factory', '==', this.selectedFactory)
               .where('materialCode', '==', normalizedCode)
               .limit(50)
          ).get().toPromise();

          if (!querySnapshot || querySnapshot.empty) {
            console.log(`🔍 ASM1 No exact match for "${normalizedCode}", trying pattern search...`);
            this.searchProgress = 50;
            querySnapshot = await this.firestore.collection('inventory-materials', ref =>
              ref.where('factory', '==', this.selectedFactory)
                 .where('materialCode', '>=', normalizedCode)
                 .where('materialCode', '<=', normalizedCode + '\uf8ff')
                 .limit(100)
            ).get().toPromise();
          }
        } catch (indexError: any) {
          const msg = indexError?.message || '';
          if (msg.includes('index') || msg.includes('Index')) {
            this.searchProgress = 50;
            const allSnapshot = await this.firestore.collection('inventory-materials', ref =>
              ref.where('factory', '==', this.selectedFactory).limit(3000)
            ).get().toPromise();
            if (allSnapshot && !allSnapshot.empty) {
              const filtered = allSnapshot.docs.filter(doc => {
                const code = (doc.data() as any).materialCode;
                return code && String(code).toUpperCase().includes(normalizedCode);
              });
              querySnapshot = { docs: filtered, empty: filtered.length === 0 } as any;
            }
          } else {
            throw indexError;
          }
        }
      }

      if (querySnapshot && !querySnapshot.empty) {
        console.log(`✅ ASM1 Found ${querySnapshot.docs.length} documents from Firebase`);

        const MAX_SEARCH_LOC_WRITES = 450;
        const searchLocBatch = this.firestore.firestore.batch();
        let searchLocWrites = 0;

        // Process search results
        this.inventoryMaterials = querySnapshot.docs.map(doc => {
          const data = doc.data() as any;
          const material = {
            id: doc.id,
            ...data,
            factory: this.selectedFactory, // Force ASM1
            location: String(data.location || data.viTri || '').trim().toUpperCase(),
            palletId: String(data.palletId || '').trim().toUpperCase(),
            importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : new Date(),
            receivedDate: data.receivedDate ? new Date(data.receivedDate.seconds * 1000) : new Date(),
            expiryDate: data.expiryDate ? new Date(data.expiryDate.seconds * 1000) : new Date(),
            openingStock: data.openingStock || null, // Initialize openingStock field - để trống nếu không có
            xt: data.xt || 0, // Initialize XT field for search results
            source: data.source || 'manual', // Set default source for old materials
            iqcStatus: data.iqcStatus || undefined,
            modifiedBy: data.modifiedBy || '',
            locationManualOverride: !!data.locationManualOverride
          } as InventoryMaterial;

          this.stampLocationAtLoad(material);

          const newLoc = this.applyPassIqcAutoLocation(material);
          if (newLoc && searchLocWrites < MAX_SEARCH_LOC_WRITES) {
            searchLocBatch.update(doc.ref, {
              location: newLoc,
              lastModified: firebase.default.firestore.FieldValue.serverTimestamp(),
              modifiedBy: 'materials-auto-location'
            } as any);
            searchLocWrites++;
          }

          // Apply catalog data if available
          if (this.catalogLoaded && this.catalogCache.has(material.materialCode)) {
            const catalogItem = this.catalogCache.get(material.materialCode)!;
            material.materialName = catalogItem.materialName;
            material.unit = catalogItem.unit;
          }

          return material;
        });

        if (searchLocWrites > 0) {
          searchLocBatch
            .commit()
            .then(() =>
              console.log(
                `✅ [ASM1 search auto location] Updated ${searchLocWrites} doc(s) (R*→E7 / B011|B013|B014*→F7 khi IQC PASS).`
              )
            )
            .catch(err => console.warn('⚠️ [ASM1 search auto location] Batch update failed:', err));
        }

        this.readTracker.track('materials', 'inventory-materials', querySnapshot.docs.length);
        this.applyCatalogToMaterials(this.inventoryMaterials);
        void this.ensureCatalogForMaterialCodes(this.inventoryMaterials.map((m) => m.materialCode)).then(() => {
          this.applyCatalogToMaterials(this.inventoryMaterials);
          this.applyCatalogToMaterials(this.filteredInventory);
          void this.applyStorageUnitsFromCatalog();
          if (this.showKhColumn) void this.applyNvlkhFromCatalog();
          this.cdr.markForCheck();
        });

        // IMPROVED: Không cần filter thêm nữa vì đã query chính xác từ Firebase
        this.filteredInventory = this.viewWarehouseFilter
          ? this.inventoryMaterials.filter((m) => this.materialMatchesViewWarehouse(m))
          : [...this.inventoryMaterials];
        
        // KHÔNG gộp dòng khi search - chỉ gộp khi bấm nút "Gộp dòng trùng lặp"
        // this.consolidateInventoryData();
        
        // Sắp xếp FIFO: Material Code -> PO (oldest first)
        this.sortInventoryFIFO();
        
        // Reset to page 1 and update pagination
        this.currentPage = 1;
        this.updatePagination();
        this.updateDisplayedInventory();
        
        // 🔧 SIMPLIFIED: Exported quantities loaded directly from Firebase (no auto-update needed)
        console.log('✅ Search results exported quantities loaded directly from Firebase');
        
        console.log(`✅ ASM1 Search completed: ${this.filteredInventory.length} results from ${this.inventoryMaterials.length} loaded items`);
        
        // Debug: Log tất cả material codes tìm được
        const materialCodes = this.filteredInventory.map(item => item.materialCode);
        console.log(`🔍 ASM1 Found material codes:`, materialCodes);
        
      } else {
        // No results found
        this.inventoryMaterials = [];
        this.filteredInventory = [];
        console.log(`🔍 ASM1 No results found for: "${searchTerm}" after trying all search methods`);
      }
      
    } catch (error) {
      console.error('❌ ASM1 Error during search:', error);
      this.filteredInventory = [];
    } finally {
      this.isLoading = false;
      this.isSearching = false;
      this.searchProgress = 100;
      if (this.filteredInventory.length > 0) {
        void this.refreshLastStatusForMaterials(this.filteredInventory);
      }
    }
  }

  // Track by function for ngFor optimization
  trackByFn(index: number, item: any): any {
    return item.id || index;
  }

  // Compare material codes for FIFO sorting
  private compareMaterialCodesFIFO(codeA: string, codeB: string): number {
    if (!codeA || !codeB) return 0;
    
    // Extract first letter and 6-digit number
    const parseCode = (code: string) => {
      const match = code.match(/^([ABR])(\d{6})/);
      if (!match) return { letter: 'Z', number: 999999 }; // Put invalid codes at end
      return { 
        letter: match[1], 
        number: parseInt(match[2], 10) 
      };
    };
    
    const parsedA = parseCode(codeA);
    const parsedB = parseCode(codeB);
    
    // Priority order: A -> B -> R
    const letterOrder = { 'A': 1, 'B': 2, 'R': 3, 'Z': 999 };
    
    // Compare by letter first
    const letterComparison = letterOrder[parsedA.letter] - letterOrder[parsedB.letter];
    if (letterComparison !== 0) {
      return letterComparison;
    }
    
    // If same letter, compare by number (ascending order for FIFO)
    return parsedA.number - parsedB.number;
  }

  // Sort inventory by FIFO: Material Code -> PO (oldest first)
  private sortInventoryFIFO(): void {
    if (!this.filteredInventory || this.filteredInventory.length === 0) return;
    
    console.log('🔄 Sorting inventory by FIFO: Material Code -> PO (oldest first)...');
    
    this.filteredInventory.sort((a, b) => {
      // First compare by Material Code (group same materials together)
      const materialComparison = this.compareMaterialCodesFIFO(a.materialCode, b.materialCode);
      if (materialComparison !== 0) {
        return materialComparison;
      }
      
      // If same material code, sort by PO: Year -> Month -> Sequence (oldest first)
      return this.comparePOFIFO(a.poNumber, b.poNumber);
    });
    

    
    console.log('✅ Inventory sorted by FIFO successfully');
    
    // Update negative stock count after sorting
    this.updateNegativeStockCount();
  }



  // Compare PO numbers for FIFO sorting (older first) - FIXED LOGIC
  private comparePOFIFO(poA: string, poB: string): number {
    if (!poA || !poB) return 0;
    
    // Extract mmyy/xxxx pattern from PO
    const parsePO = (po: string) => {
      // Look for mmyy/xxxx pattern at the end of PO
      const match = po.match(/(\d{2})(\d{2})\/(\d{4})$/);
      if (!match) return { month: 99, year: 99, sequence: 9999 }; // Invalid PO goes to end
      
      const month = parseInt(match[1], 10);
      const year = parseInt(match[2], 10);
      const sequence = parseInt(match[3], 10);
      
      return { month, year, sequence };
    };
    
    const parsedA = parsePO(poA);
    const parsedB = parsePO(poB);
    
    // FIFO: Earlier year first (21 before 25)
    if (parsedA.year !== parsedB.year) {
      return parsedA.year - parsedB.year;
    }
    
    // If same year, earlier month first (02 before 03) 
    if (parsedA.month !== parsedB.month) {
      return parsedA.month - parsedB.month;
    }
    
    // If same month/year, lower sequence first (0007 before 0165)
    return parsedA.sequence - parsedB.sequence;
  }

  // Status helper methods
  getStatusClass(item: InventoryMaterial): string {
    // Không hiển thị IQC status trong cột Trạng thái nữa
    if (item.isCompleted) return 'status-completed';
    if (item.isDuplicate) return 'status-duplicate';
    if (item.importStatus === 'Import') return 'status-import';
    return 'status-active';
  }

  getStatusText(item: InventoryMaterial): string {
    // Không hiển thị IQC status trong cột Trạng thái nữa
    if (item.isCompleted) return 'Hoàn thành';
    if (item.isDuplicate) return 'Trùng lặp';
    if (item.importStatus === 'Import') return 'Import';
    return 'Hoạt động';
  }

  // Hàm riêng cho IQC Status
  getIQCStatusClass(item: InventoryMaterial): string {
    if (!item.iqcStatus) return '';
    
    switch (item.iqcStatus) {
      case 'PASS':
        return 'status-iqc-pass';
      case 'NG':
        return 'status-iqc-ng';
      case 'ĐẶC CÁCH':
        return 'status-iqc-special';
      case 'CHỜ XÁC NHẬN':
        return 'status-iqc-pending';
      default:
        return 'status-iqc-default';
    }
  }

  getIQCStatusText(item: InventoryMaterial): string {
    return item.iqcStatus || '-';
  }

  formatLastStatusDate(d: Date | null | undefined): string {
    if (!d || Number.isNaN(d.getTime())) return '—';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  getLastStatusTitle(material: InventoryMaterial): string {
    if (!material.lastStatusAt) return '';
    const who = material.lastStatusBy && material.lastStatusBy !== '—' ? ` — ID: ${material.lastStatusBy}` : '';
    if (material.lastStatusKind === 'Outbound') return `Outbound (Xuất kho) gần nhất${who}`;
    if (material.lastStatusKind === 'Change location') return `Change location (Đổi vị trí) gần nhất${who}`;
    if (material.lastStatusKind === 'Inbound') return `Inbound (Nhập kho / scan inbound) gần nhất${who}`;
    return `Hoạt động gần nhất${who}`;
  }

  private async refreshLastStatusForMaterials(materials: InventoryMaterial[]): Promise<void> {
    if (!materials?.length) return;
    for (const m of materials) {
      m.lastStatusLoading = true;
      m.lastStatusAt = null;
      m.lastStatusKind = '';
      m.lastStatusBy = '';
    }
    this.cdr.detectChanges();

    const chunkSize = 8;
    for (let i = 0; i < materials.length; i += chunkSize) {
      const chunk = materials.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async (m) => {
          try {
            const status = await this.materialsDashboard.loadLastOutboundOrLocationStatus({
              inventoryDocId: m.id,
              materialCode: m.materialCode,
              poNumber: m.poNumber || '',
              imdKey: this.getInventoryImdBaseKey(m) || this.getDisplayIMD(m),
              batchNumber: m.batchNumber || '',
              factory: this.selectedFactory
            });
            m.lastStatusAt = status.at;
            m.lastStatusKind = status.kind;
            m.lastStatusBy = status.performedBy || '';
          } catch {
            m.lastStatusAt = null;
            m.lastStatusKind = '';
            m.lastStatusBy = '';
          } finally {
            m.lastStatusLoading = false;
          }
        })
      );
      this.cdr.detectChanges();
    }
  }

  getExpiryDateText(expiryDate: Date): string {
    if (!expiryDate) return 'N/A';
    
    const today = new Date();
    const diffTime = expiryDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return 'Hết hạn';
    if (diffDays <= 30) return `${diffDays}d`;
    if (diffDays <= 90) return `${Math.ceil(diffDays/30)}m`;
    return `${Math.ceil(diffDays/365)}y`;
  }

  // Check if location is IQC
  isIQCLocation(location: string): boolean {
    return isIqcPrefixLocation(location);
  }

  // Convert old location format to new format
  // TR12 -> T1.2(R), TR11 -> T1.1(R), etc.
  convertLocationFormat(location: string): string {
    if (!location) return location;
    
    const loc = location.trim().toUpperCase();
    
    // Pattern matching for old format: [Letter][Letter][Number]
    const oldFormatPattern = /^([A-Z])([A-Z])(\d+)$/;
    const match = loc.match(oldFormatPattern);
    
    if (match) {
      const [, firstLetter, secondLetter, number] = match;
      
      // Convert based on the pattern
      if (secondLetter === 'R') {
        // TR12 -> T1.2(R)
        const rowLetter = firstLetter;
        const numStr = number.toString();
        if (numStr.length >= 2) {
          const firstDigit = numStr[0];
          const remainingDigits = numStr.substring(1);
          return `${rowLetter}${firstDigit}.${remainingDigits}(R)`;
        } else {
          return `${rowLetter}${number}(R)`;
        }
      } else if (secondLetter === 'L') {
        // TL12 -> T1.2(L)
        const rowLetter = firstLetter;
        const numStr = number.toString();
        if (numStr.length >= 2) {
          const firstDigit = numStr[0];
          const remainingDigits = numStr.substring(1);
          return `${rowLetter}${firstDigit}.${remainingDigits}(L)`;
        } else {
          return `${rowLetter}${number}(L)`;
        }
      }
    }
    
    // Special cases for Q and A12
    if (loc === 'Q1') return 'Q1(L)';
    if (loc === 'Q2') return 'Q2(L)';
    if (loc === 'Q3') return 'Q3(L)';
    if (loc === 'A12') return 'NVL-A12';
    
    // If no pattern matches, return original
    return location;
  }

  // Update all locations in inventory to new format
  async updateAllLocationsToNewFormat(): Promise<void> {
    if (!confirm('Bạn có chắc muốn cập nhật tất cả vị trí sang format mới?\n\nVí dụ: TR12 -> T1.2(R), TL12 -> T1.2(L)\n\nHành động này không thể hoàn tác!')) {
      return;
    }

    try {
      this.isLoading = true;
      console.log('🔄 Bắt đầu cập nhật vị trí sang format mới...');

      // Get all inventory materials
      const snapshot = await this.firestore.collection('inventory-materials', ref => 
        ref.where('factory', '==', this.selectedFactory)
      ).get().toPromise();

      if (!snapshot || snapshot.empty) {
        alert('Không tìm thấy dữ liệu inventory để cập nhật');
        return;
      }

      const batch = this.firestore.firestore.batch();
      let updateCount = 0;

      snapshot.docs.forEach(doc => {
        const data = doc.data() as any;
        const oldLocation = data.location;
        const newLocation = this.convertLocationFormat(oldLocation);

        if (oldLocation !== newLocation) {
          console.log(`📍 Cập nhật: ${oldLocation} -> ${newLocation}`);
          batch.update(doc.ref, { 
            location: newLocation,
            updatedAt: new Date()
          });
          updateCount++;
        }
      });

      if (updateCount > 0) {
        await batch.commit();
        console.log(`✅ Đã cập nhật ${updateCount} vị trí sang format mới`);
        alert(`✅ Đã cập nhật thành công ${updateCount} vị trí sang format mới!\n\nVí dụ: TR12 -> T1.2(R), TL12 -> T1.2(L)`);
        
        // Refresh data
        this.loadInventoryFromFirebase();
      } else {
        console.log('ℹ️ Không có vị trí nào cần cập nhật');
        alert('Không có vị trí nào cần cập nhật sang format mới');
      }

    } catch (error) {
      console.error('❌ Lỗi khi cập nhật vị trí:', error);
      alert('❌ Lỗi khi cập nhật vị trí. Vui lòng thử lại.');
    } finally {
      this.isLoading = false;
    }
  }

  // Mark duplicates within ASM1
  markDuplicates(): void {
    const poMap = new Map<string, InventoryMaterial[]>();
    
    // Group materials by PO
    this.filteredInventory.forEach(material => {
      if (!poMap.has(material.poNumber)) {
        poMap.set(material.poNumber, []);
      }
      poMap.get(material.poNumber)!.push(material);
    });
    
    // Mark duplicates
    poMap.forEach((materials, po) => {
      if (materials.length > 1) {
        materials.forEach(material => {
          material.isDuplicate = true;
        });
      } else {
        materials[0].isDuplicate = false;
      }
    });
    
    // Update negative stock count after marking duplicates
    this.updateNegativeStockCount();
  }

  // Consolidate inventory data by material code + PO (gộp tất cả dòng có cùng mã hàng và PO)
  consolidateInventoryData(): void {
    try {
      console.log('🔄 Starting inventory data consolidation by Material + PO...');
      
      if (!this.inventoryMaterials || this.inventoryMaterials.length === 0) {
        console.log('⚠️ No inventory materials to consolidate');
        return;
      }
      
      console.log(`📊 Input: ${this.inventoryMaterials.length} materials to process`);
    
    // Group materials by Material + PO + Batch
    const materialPoMap = new Map<string, InventoryMaterial[]>();
    
    this.inventoryMaterials.forEach(material => {
      // Chỉ gộp dòng không phải từ inbound (source !== 'inbound')
      if (material.source === 'inbound') {
        console.log(`⏭️ Skipping inbound material in consolidation: ${material.materialCode} - ${material.poNumber}`);
        return;
      }
      
      const key = `${material.materialCode}_${material.poNumber}_${material.batchNumber || 'NO_BATCH'}`;
      
      if (!materialPoMap.has(key)) {
        materialPoMap.set(key, []);
      }
      materialPoMap.get(key)!.push(material);
    });
    
    console.log(`📊 Found ${materialPoMap.size} unique Material+PO+Batch combinations from ${this.inventoryMaterials.length} total items`);
    
    // Final consolidation map
    const finalConsolidatedMap = new Map<string, InventoryMaterial>();
    
    materialPoMap.forEach((materials, materialPoKey) => {
      if (materials.length === 1) {
        // Single item - keep as is
        const material = materials[0];
        finalConsolidatedMap.set(materialPoKey, material);
        console.log(`✅ Single item: ${material.materialCode} - PO ${material.poNumber} - Batch: ${material.batchNumber || 'NO_BATCH'} - Location: ${material.location}`);
      } else {
        // Multiple items - merge into one row
        console.log(`🔄 Consolidating ${materials.length} items for ${materialPoKey}`);
        
        const baseMaterial = { ...materials[0] };
        
        // Combine quantities
        const totalOpeningStock = materials.reduce((sum, m) => {
          const stock = m.openingStock !== null ? m.openingStock : 0;
          return sum + stock;
        }, 0);
        baseMaterial.openingStock = totalOpeningStock > 0 ? totalOpeningStock : null;
        baseMaterial.quantity = materials.reduce((sum, m) => sum + m.quantity, 0);
        baseMaterial.stock = materials.reduce((sum, m) => sum + (m.stock || 0), 0);
        baseMaterial.exported = materials.reduce((sum, m) => sum + (m.exported || 0), 0);
        baseMaterial.xt = materials.reduce((sum, m) => sum + (m.xt || 0), 0);
        
        // Combine location field - gộp tất cả vị trí khác nhau
        const uniqueLocations = [...new Set(materials.map(m => m.location).filter(loc => loc))];
        baseMaterial.location = uniqueLocations.join('; ');
        
        // Combine type field - gộp tất cả loại hình khác nhau
        const uniqueTypes = [...new Set(materials.map(m => m.type).filter(type => type))];
        baseMaterial.type = uniqueTypes.join('; ');
        
        // Keep earliest import date and latest expiry date
        baseMaterial.importDate = new Date(Math.min(...materials.map(m => m.importDate.getTime())));
        baseMaterial.expiryDate = new Date(Math.max(...materials.map(m => m.expiryDate.getTime())));
        
        // Merge other fields
        baseMaterial.notes = materials.map(m => m.notes).filter(n => n).join('; ');
        baseMaterial.remarks = materials.map(m => m.remarks).filter(r => r).join('; ');
        baseMaterial.supplier = materials.map(m => m.supplier).filter(s => s).join('; ');
        baseMaterial.rollsOrBags = materials.map(m => m.rollsOrBags).filter(r => r).join('; ');
        
        finalConsolidatedMap.set(materialPoKey, baseMaterial);
        
        console.log(`✅ Consolidated: ${baseMaterial.materialCode} - PO: ${baseMaterial.poNumber} - Batch: ${baseMaterial.batchNumber || 'NO_BATCH'}`);
        console.log(`  📍 Location: ${baseMaterial.location} (from first row)`);
        console.log(`  🏷️ Type: ${baseMaterial.type} (from first row)`);
        console.log(`  📦 Total Quantity: ${baseMaterial.quantity}`);
        console.log(`  📤 Total Exported: ${baseMaterial.exported}`);
      }
    });
    
    // Add inbound materials back to the final list (they were skipped during consolidation)
    const inboundMaterials = this.inventoryMaterials.filter(material => material.source === 'inbound');
    console.log(`📦 Adding ${inboundMaterials.length} inbound materials back to the list`);
    
    // Update the inventory data
    const originalCount = this.inventoryMaterials.length;
    this.inventoryMaterials = [...Array.from(finalConsolidatedMap.values()), ...inboundMaterials];
    this.filteredInventory = [...this.inventoryMaterials];
    this.inventoryMaterials.forEach(m => this.applyLocalDerivedBags(m));
    
    // Sắp xếp FIFO sau khi gộp dữ liệu
    this.sortInventoryFIFO();
    
    console.log(`✅ Inventory consolidation completed: ${originalCount} → ${this.inventoryMaterials.length} items`);
    
    // Show consolidation message
    const reducedCount = originalCount - this.inventoryMaterials.length;
    if (reducedCount > 0) {
      this.consolidationMessage = `✅ Đã gộp ${reducedCount} dòng dữ liệu trùng lặp theo Material+PO. Từ ${originalCount} → ${this.inventoryMaterials.length} dòng.`;
      this.showConsolidationMessage = true;
      
      // Auto-hide message after 5 seconds
      setTimeout(() => {
        this.showConsolidationMessage = false;
      }, 5000);
    } else {
      this.consolidationMessage = 'ℹ️ Không có dữ liệu trùng lặp để gộp.';
      this.showConsolidationMessage = true;
      
      // Auto-hide message after 3 seconds
      setTimeout(() => {
        this.showConsolidationMessage = false;
      }, 3000);
    }
    
    // Mark duplicates after consolidation
    this.markDuplicates();
    
    } catch (error) {
      console.error('❌ Error during consolidation:', error);
    }
  }

  // Load permissions
  loadPermissions(): void {
    console.log('🔍 DEBUG: loadPermissions called');
    
    this.tabPermissionService.canAccessTab('materials')
      .pipe(takeUntil(this.destroy$))
      .subscribe(canAccess => {
        console.log(`🔍 DEBUG: Tab permission result for 'materials': ${canAccess}`);
        
        // Set basic permissions based on tab access
        this.canView = canAccess;
        this.canEdit = canAccess;
        this.canExport = canAccess;
        this.canDelete = canAccess;
        // this.canEditHSD = canAccess; // Removed - HSD column deleted
        
        
        // Lưu ý: Cột "Đã xuất" chỉ có thể chỉnh sửa khi user có quyền Xóa và đã mở khóa
        // không phụ thuộc vào canExport permission
        
        console.log('🔑 ASM1 Permissions loaded:', {
          canView: this.canView,
          canEdit: this.canEdit,
          canExport: this.canExport,
          canDelete: this.canDelete,
          // canEditHSD: this.canEditHSD // Removed - HSD column deleted
        });
      });
  }

  // Import current stock with ASM1 filter
  async importCurrentStock(): Promise<void> {
    try {
      // Ask user for duplicate strategy
      const duplicateStrategy = await this.getDuplicateStrategy();
      if (!duplicateStrategy) return;

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.xlsx,.xls,.csv';
      
      input.onchange = async (event: any) => {
        const file = event.target.files[0];
        if (!file) return;

        const validation = this.excelImportService.validateFile(file);
        if (!validation.valid) {
          alert(validation.message);
          return;
        }

        try {
          const dialogRef = this.dialog.open(ImportProgressDialogComponent, {
            width: '500px',
            disableClose: true,
            data: { progress$: this.excelImportService.progress$ }
          });

                      // Start import process with selected factory filter and duplicate strategy
            const result = await this.excelImportService.importStockFile(file, 50, this.selectedFactory, duplicateStrategy);
          
          const dialogResult = await dialogRef.afterClosed().toPromise();
          
          // Show detailed import results
          this.showImportResults(result);
          
          // Reload inventory data
          await this.loadInventoryFromFirebase();
          
        } catch (error) {
          console.error('Import error:', error);
          alert(`❌ Lỗi import: ${error}`);
        }
      };
      
      input.click();
      
    } catch (error) {
      console.error('Error setting up file input:', error);
      alert('Có lỗi xảy ra khi mở file picker');
    }
  }

  // Get duplicate handling strategy from user
  private async getDuplicateStrategy(): Promise<'skip' | 'update' | 'ask' | null> {
    const strategy = prompt(
      'Chọn cách xử lý items trùng lặp:\n' +
      '1 - Bỏ qua (Skip) - Chỉ import items mới\n' +
      '2 - Cập nhật (Update) - Cập nhật tất cả items trùng lặp\n' +
      '3 - Hỏi từng item (Ask) - Hỏi từng item trùng lặp\n' +
      'Nhập 1, 2, hoặc 3:',
      '3'
    );

    switch (strategy) {
      case '1': return 'skip';
      case '2': return 'update';
      case '3': return 'ask';
      default: return null;
    }
  }

  // Show detailed import results
  private showImportResults(result: { success: number; errors: string[]; duplicates: number; updated: number }): void {
    const totalProcessed = result.success + result.updated + result.duplicates;
    
    let message = `✅ Import hoàn thành!\n\n`;
    message += `📊 Tổng quan:\n`;
    message += `   • Tổng items xử lý: ${totalProcessed}\n`;
    message += `   • Items mới: ${result.success}\n`;
    message += `   • Items cập nhật: ${result.updated}\n`;
    message += `   • Items bỏ qua: ${result.duplicates}\n`;
    message += `   • Lỗi: ${result.errors.length}\n\n`;
    
    if (result.success > 0) {
      message += `🎉 Đã thêm ${result.success} items mới vào inventory ASM1\n`;
    }
    
    if (result.updated > 0) {
      message += `🔄 Đã cập nhật ${result.updated} items hiện có\n`;
    }
    
    if (result.duplicates > 0) {
      message += `⏭️ Đã bỏ qua ${result.duplicates} items trùng lặp\n`;
    }
    
    if (result.errors.length > 0) {
      message += `\n⚠️ Có ${result.errors.length} lỗi xảy ra`;
    }

    alert(message);

    // Show detailed errors if any
    if (result.errors.length > 0) {
      console.warn('Import errors:', result.errors);
      
      const errorMessage = result.errors.length <= 10 
        ? `Chi tiết lỗi:\n${result.errors.join('\n')}`
        : `Có ${result.errors.length} lỗi. Xem console để biết chi tiết.\n\nLỗi đầu tiên:\n${result.errors.slice(0, 5).join('\n')}`;
      
      alert(`⚠️ ${errorMessage}`);
    }
  }

  openMorePopup(): void {
    this.showMorePopup = true;
  }

  openKkLocMapFromMore(): void {
    this.closeMorePopup();
    this.showKkLocMap = true;
    this.kkLocMapQuery = '';
    this.kkLocMapView = 'type';
    this.kkLocMapWarehouseFilter = '';
    this.kkCountWh3 = true;
    this.kkWh3Only = false;
    this.kkFilterUncheckedOnly = false;
    this.kkLocMapBoxes = [];
    this.kkLocMapByMaterial = [];
    this.kkLocMapByType = [];
    this.kkLocMapRowCache.clear();
    this.kkLocMapMaterialCache.clear();
    this.kkLocMapTypeCache.clear();
    this.kkLocMapExpandedKey = null;
    this.kkActiveProductType = null;
    this.kkActiveTypeDraft = null;
    this.kkActivePinSplit = null;
    this.kkActiveSourceProductType = null;
    void this.loadKkCatalogForMap();
  }

  closeKkLocMap(): void {
    this.showKkLocMap = false;
    this.kkLocMapLoading = false;
    this.kkLocMapStatus = '';
    this.kkLocMapQuery = '';
    this.kkLocMapView = null;
    this.kkLocMapWarehouseFilter = '';
    this.kkCountWh3 = true;
    this.kkWh3Only = false;
    this.kkFilterUncheckedOnly = false;
    this.kkLocMapBoxes = [];
    this.kkLocMapByMaterial = [];
    this.kkLocMapByType = [];
    this.kkLocMapRowCache.clear();
    this.kkLocMapMaterialCache.clear();
    this.kkLocMapTypeCache.clear();
    this.kkLocMapLoadId++;
    this.kkLocMapBusy = false;
    this.kkLocMapExpandedKey = null;
    this.kkActiveProductType = null;
    this.kkActiveTypeDraft = null;
    this.kkActivePinSplit = null;
    this.kkActiveSourceProductType = null;
    this.showKkTypeReportMenu = false;
    this.showKkPalletCheck = false;
  }

  setKkLocMapView(view: 'location' | 'material' | 'type'): void {
    if (this.kkLocMapView === view && !this.kkLocMapLoading) return;
    this.kkLocMapView = view;
    this.kkLocMapQuery = '';
    this.kkLocMapExpandedKey = null;
    this.kkActiveProductType = null;
    this.kkActiveTypeDraft = null;
    this.kkActivePinSplit = null;
    this.kkActiveSourceProductType = null;
    if (view === 'location') void this.loadKkLocMap();
    else if (view === 'material') void this.loadKkByMaterial();
    else void this.loadKkCatalogForMap();
  }

  refreshKkLocMap(): void {
    if (this.kkLocMapView === 'material') void this.loadKkByMaterial();
    else if (this.kkLocMapView === 'location') void this.loadKkLocMap();
    else if (this.kkLocMapView === 'type') {
      void this.loadKkCatalogForMap(true);
    }
  }

  openKkCodeLookup(): void {
    this.showKkCodeLookup = true;
    this.kkCodeLookupBusy = false;
    if (!this.kkCodeLookupResult) this.kkCodeLookupInput = '';
    this.cdr.detectChanges();
    setTimeout(() => {
      const el = document.getElementById('kkCodeLookupInput') as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 80);
  }

  closeKkCodeLookup(): void {
    this.showKkCodeLookup = false;
  }

  openKkPalletCheck(): void {
    this.showKkPalletCheck = true;
    void this.loadKkPalletCheck();
  }

  closeKkPalletCheck(): void {
    this.showKkPalletCheck = false;
  }

  async loadKkPalletCheck(): Promise<void> {
    this.kkPalletCheckBusy = true;
    this.kkPalletCheckRows = [];
    this.kkPalletCheckTotal = 0;
    this.cdr.detectChanges();
    try {
      const snap = await this.firestore
        .collection('inventory-materials', (ref) =>
          ref.where('factory', '==', this.selectedFactory).limit(10000)
        )
        .get()
        .toPromise();
      const byWh = new Map<KkWarehouse, { pallets: Set<string>; lines: number; noPallet: number }>();
      for (const w of this.kkLocMapWarehouseOptions) {
        byWh.set(w.id, { pallets: new Set<string>(), lines: 0, noPallet: 0 });
      }
      for (const doc of snap?.docs || []) {
        const data = doc.data() as any;
        const stock = this.stockFromInventoryDoc(data);
        if (stock <= 0) continue;
        const warehouse = this.kkWarehouseFromLocation(String(data.location || data.viTri || ''));
        const cur = byWh.get(warehouse);
        if (!cur) continue;
        cur.lines += 1;
        const pallet = String(data.palletId || '').trim().toUpperCase();
        if (!pallet) cur.noPallet += 1;
        else cur.pallets.add(pallet);
      }
      this.kkPalletCheckRows = this.kkLocMapWarehouseOptions.map((w) => {
        const cur = byWh.get(w.id)!;
        return {
          warehouse: w.id,
          label: w.label,
          pallets: cur.pallets.size,
          lines: cur.lines,
          noPallet: cur.noPallet
        };
      });
      this.kkPalletCheckTotal = this.kkPalletCheckRows.reduce((n, r) => n + r.pallets, 0);
    } catch (e) {
      console.error('loadKkPalletCheck:', e);
      alert('Không đếm được pallet theo kho.');
    } finally {
      this.kkPalletCheckBusy = false;
      this.cdr.detectChanges();
    }
  }

  onKkCodeLookupInput(value: string): void {
    this.kkCodeLookupInput = String(value || '').toUpperCase();
  }

  async submitKkCodeLookup(): Promise<void> {
    const code = String(this.kkCodeLookupInput || '').trim().toUpperCase();
    this.kkCodeLookupInput = code;
    if (!code) {
      this.kkCodeLookupResult = null;
      return;
    }
    this.kkCodeLookupBusy = true;
    this.kkCodeLookupResult = null;
    this.cdr.detectChanges();
    try {
      if (!this.kkCatalogTypeMap.size) {
        this.kkCatalogTypeMap = await this.kkCatalog.loadAllAsMap();
      }
      const productType = this.productTypeOfMaterial(code) || 'Chưa gán danh mục';
      let stock = 0;
      let lines = 0;
      this.kkLocMapTypeCache.forEach((list) => {
        for (const m of list) {
          if (String(m.materialCode || '').trim().toUpperCase() !== code) continue;
          stock += this.calculateCurrentStock(m);
          lines += 1;
        }
      });
      if (!lines) {
        this.kkLocMapMaterialCache.forEach((list) => {
          for (const m of list) {
            if (String(m.materialCode || '').trim().toUpperCase() !== code) continue;
            stock += this.calculateCurrentStock(m);
            lines += 1;
          }
        });
      }
      if (!lines) {
        const snap = await this.firestore
          .collection('inventory-materials', (ref) =>
            ref.where('materialCode', '==', code).limit(200)
          )
          .get()
          .toPromise();
        const factory = String(this.selectedFactory || '').trim().toUpperCase();
        const seen = new Set<string>();
        for (const doc of snap?.docs || []) {
          const data = doc.data() as any;
          if (String(data.factory || '').trim().toUpperCase() !== factory) continue;
          if (seen.has(doc.id)) continue;
          seen.add(doc.id);
          stock += this.stockFromInventoryDoc(data);
          lines += 1;
        }
      }
      this.kkCodeLookupResult = {
        code,
        productType,
        stock,
        lines,
        found: lines > 0 || productType !== 'Chưa gán danh mục'
      };
    } catch (e) {
      console.error('❌ submitKkCodeLookup:', e);
      this.kkCodeLookupResult = {
        code,
        productType: '—',
        stock: 0,
        lines: 0,
        found: false
      };
      alert('❌ Không tra được mã hàng.');
    } finally {
      this.kkCodeLookupBusy = false;
      this.cdr.detectChanges();
    }
  }

  openGanPallet(): void {
    this.showGanPallet = true;
    this.ganPalletBusy = false;
    this.ganPalletLookupBusy = false;
    this.ganPalletStep = 1;
    this.ganPalletCode = '';
    this.ganPalletWh = null;
    this.ganPalletLoc = '';
    this.ganPalletMaterial = '';
    this.ganPalletQty = '';
    this.ganPalletError = '';
    this.ganPalletHit = null;
    this.ganPalletPending = [];
    this.focusGanPalletField('gan-pallet-code');
  }

  closeGanPallet(): void {
    if (this.ganPalletBusy) return;
    this.showGanPallet = false;
    this.ganPalletLookupBusy = false;
    this.ganPalletStep = 1;
    this.ganPalletCode = '';
    this.ganPalletWh = null;
    this.ganPalletLoc = '';
    this.ganPalletMaterial = '';
    this.ganPalletQty = '';
    this.ganPalletError = '';
    this.ganPalletHit = null;
    this.ganPalletPending = [];
  }

  private focusGanPalletField(id: string): void {
    const delay = this.isMobile ? 200 : 60;
    setTimeout(() => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (!el || el.disabled) return;
      el.focus();
      el.select();
    }, delay);
  }

  ganPalletGoStep(step: 1 | 2 | 3 | 4 | 5): void {
    if (this.ganPalletBusy) return;
    this.ganPalletError = '';
    this.ganPalletStep = step;
    this.cdr.detectChanges();
    if (step === 1) this.focusGanPalletField('gan-pallet-code');
    else if (step === 3) this.focusGanPalletField('gan-pallet-loc');
    else if (step === 4) this.focusGanPalletField('gan-pallet-material');
    else if (step === 5) this.focusGanPalletField('gan-pallet-qty');
  }

  onGanPalletScanInput(kind: 'code' | 'loc' | 'material', event?: Event): void {
    const el = event?.target as HTMLInputElement | undefined;
    const key = kind === 'code' ? 'ganPalletCode' : kind === 'loc' ? 'ganPalletLoc' : 'ganPalletMaterial';
    const raw = String(el?.value ?? (this as any)[key] ?? '');
    if (!/[\r\n]/.test(raw)) return;
    const cleaned = raw.replace(/[\r\n]+/g, '').trim();
    (this as any)[key] = cleaned;
    if (el) el.value = cleaned;
    if (kind === 'code') this.onGanPalletCodeEnter();
    else if (kind === 'loc') this.onGanPalletLocEnter();
    else this.onGanPalletMaterialEnter();
  }

  isGanPalletCodeOk(): boolean {
    return /^[PF].+/i.test(String(this.ganPalletCode || '').trim());
  }

  private normalizeGanPalletCode(raw: string): string {
    const s = String(raw || '').trim().toUpperCase();
    const first = s.includes('|') ? s.split('|')[0].trim() : s;
    return first;
  }

  get ganPalletLocPreview(): string {
    return this.normalizeGanPalletLocation(this.ganPalletLoc, this.ganPalletWh);
  }

  private normalizeGanPalletLocation(raw: string, wh: 'ASM1' | 'ASM3' | null): string {
    let loc = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!loc || !wh) return '';
    if (loc.includes('|')) loc = loc.split('|')[0].trim().toUpperCase();
    if (wh === 'ASM3') {
      loc = loc.replace(/^WH3-/, '').replace(/^ASM3[+_-]?/, '');
      if (!loc) return '';
      const m = loc.match(/^([A-IK-L])(\d{1,2})$/);
      if (m) return `ASM3-${m[1]}${Number(m[2])}`;
      return loc.startsWith('ASM3') ? loc : `ASM3-${loc}`;
    }
    return loc;
  }

  onGanPalletCodeEnter(event?: Event): void {
    event?.preventDefault();
    const code = this.normalizeGanPalletCode(this.ganPalletCode);
    this.ganPalletCode = code;
    this.ganPalletError = '';
    if (!this.isGanPalletCodeOk()) {
      this.ganPalletError = 'Pallet phải bắt đầu bằng P hoặc F.';
      this.ganPalletStep = 1;
      return;
    }
    if (this.ganPalletWh) {
      this.ganPalletStep = 3;
      this.cdr.detectChanges();
      this.focusGanPalletField('gan-pallet-loc');
      return;
    }
    this.ganPalletStep = 2;
    this.cdr.detectChanges();
  }

  setGanPalletWh(wh: 'ASM1' | 'ASM3'): void {
    if (!this.isGanPalletCodeOk()) {
      this.ganPalletError = 'Scan pallet trước (P… hoặc F…).';
      this.ganPalletStep = 1;
      this.cdr.detectChanges();
      this.focusGanPalletField('gan-pallet-code');
      return;
    }
    this.ganPalletCode = this.normalizeGanPalletCode(this.ganPalletCode);
    this.ganPalletWh = wh;
    this.ganPalletError = '';
    this.ganPalletStep = 3;
    this.cdr.detectChanges();
    this.focusGanPalletField('gan-pallet-loc');
  }

  onGanPalletLocEnter(event?: Event): void {
    event?.preventDefault();
    if (!this.ganPalletLocPreview) {
      this.ganPalletError = 'Nhập / scan vị trí.';
      this.ganPalletStep = 3;
      return;
    }
    this.ganPalletLoc = this.ganPalletLocPreview;
    this.ganPalletError = '';
    this.ganPalletStep = 4;
    this.cdr.detectChanges();
    this.focusGanPalletField('gan-pallet-material');
  }

  onGanPalletMaterialEnter(event?: Event): void {
    event?.preventDefault();
    void this.lookupGanPalletMaterial();
  }

  onGanPalletQtyEnter(event?: Event): void {
    event?.preventDefault();
    this.ganPalletTiep();
  }

  private async lookupGanPalletMaterial(): Promise<boolean> {
    if (this.ganPalletLookupBusy) return false;
    const code = this.parseGanPalletMaterialScan(this.ganPalletMaterial);
    this.ganPalletMaterial = code;
    this.ganPalletError = '';
    this.ganPalletHit = null;
    if (!code || code.length < 3) {
      this.ganPalletError = 'Mã hàng tối thiểu 3 ký tự.';
      return false;
    }
    if (!this.ganPalletLocPreview) {
      this.ganPalletError = 'Chọn kho và scan vị trí trước.';
      return false;
    }
    this.ganPalletLookupBusy = true;
    try {
      const snaps = await Promise.all(
        (['ASM1', 'ASM2'] as const).map((factory) =>
          this.firestore
            .collection('inventory-materials', (ref) =>
              ref.where('factory', '==', factory).where('materialCode', '==', code).limit(80)
            )
            .get()
            .toPromise()
        )
      );
      const docs = snaps.flatMap((s) => s?.docs || []);
      const rows = docs
        .map((doc) => {
          const material = this.mapKkInventoryDoc(doc);
          material.kkChecked = this.isKkFlagOn((doc.data() as any)?.kkChecked);
          material.factory = String((doc.data() as any)?.factory || this.selectedFactory);
          this.stampLocationAtLoad(material);
          this.rememberLocationBeforeEdit(material);
          this.rememberPalletBeforeEdit(material);
          return material;
        })
        .filter((m) => this.calculateCurrentStock(m) > 0)
        .sort((a, b) => {
          const c = this.compareMaterialCodesFIFO(String(a.materialCode || ''), String(b.materialCode || ''));
          if (c) return c;
          return String(a.poNumber || '').localeCompare(String(b.poNumber || ''), 'en', { numeric: true });
        });
      if (!rows.length) {
        this.ganPalletError = `Không tìm thấy mã ${code} còn tồn.`;
        this.ganPalletStep = 4;
        this.cdr.detectChanges();
        this.focusGanPalletField('gan-pallet-material');
        return false;
      }
      const qty = this.parseGanPalletQty();
      const hit = qty != null ? rows.find((m) => this.calculateCurrentStock(m) + 1e-9 >= qty) : rows[0];
      if (!hit) {
        this.ganPalletError = `Không có dòng ${code} đủ tồn ${qty}.`;
        return false;
      }
      this.ganPalletHit = hit;
      this.ganPalletStep = 5;
      this.cdr.detectChanges();
      this.focusGanPalletField('gan-pallet-qty');
      return true;
    } catch (e) {
      console.error('❌ lookupGanPalletMaterial', e);
      this.ganPalletError = 'Lỗi khi tìm mã hàng.';
      return false;
    } finally {
      this.ganPalletLookupBusy = false;
      this.cdr.detectChanges();
    }
  }

  private parseGanPalletMaterialScan(raw: string): string {
    const s = String(raw || '').trim().toUpperCase();
    if (!s) return '';
    return (s.includes('|') ? s.split('|')[0] : s).trim().toUpperCase();
  }

  private parseGanPalletQty(): number | null {
    const raw = String(this.ganPalletQty ?? '').trim().replace(/,/g, '');
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  }

  ganPalletTiep(): void {
    void this.addGanPalletPending().then((ok) => {
      if (!ok) return;
      this.ganPalletMaterial = '';
      this.ganPalletQty = '';
      this.ganPalletHit = null;
      this.ganPalletError = '';
      this.ganPalletStep = 4;
      this.cdr.detectChanges();
      this.focusGanPalletField('gan-pallet-material');
    });
  }

  async ganPalletDung(): Promise<void> {
    if (this.ganPalletHit || String(this.ganPalletMaterial || '').trim()) {
      const ok = await this.addGanPalletPending();
      if (!ok && !this.ganPalletPending.length) return;
    }
    if (!this.ganPalletPending.length) {
      this.closeGanPallet();
      return;
    }
    await this.saveGanPalletPending();
  }

  private async addGanPalletPending(): Promise<boolean> {
    this.ganPalletError = '';
    if (!this.isGanPalletCodeOk()) {
      this.ganPalletError = 'Pallet phải bắt đầu bằng P hoặc F.';
      return false;
    }
    const loc = this.ganPalletLocPreview;
    if (!this.ganPalletWh || !loc) {
      this.ganPalletError = 'Chọn kho và scan vị trí.';
      return false;
    }
    if (!this.ganPalletHit) {
      const found = await this.lookupGanPalletMaterial();
      if (!found || !this.ganPalletHit) return false;
    }
    const hit = this.ganPalletHit;
    if (!hit?.id) return false;
    const qty = this.parseGanPalletQty();
    const stock = this.calculateCurrentStock(hit);
    if (qty != null && qty > stock + 1e-9) {
      this.ganPalletError = `Lượng ${qty} vượt tồn ${this.formatNumber(stock)}.`;
      return false;
    }
    if (this.ganPalletPending.some((p) => p.material.id === hit.id)) {
      this.ganPalletError = `${hit.materialCode} đã nằm trong danh sách chờ lưu.`;
      return false;
    }
    this.ganPalletPending.push({
      material: hit,
      qty,
      location: loc,
      palletId: this.normalizeGanPalletCode(this.ganPalletCode)
    });
    return true;
  }

  private async saveGanPalletPending(): Promise<void> {
    if (this.ganPalletBusy) return;
    this.ganPalletBusy = true;
    this.ganPalletError = '';
    this.cdr.detectChanges();
    let ok = 0;
    try {
      for (const row of this.ganPalletPending) {
        const mat = row.material;
        if (!mat?.id) continue;
        this.rememberLocationBeforeEdit(mat);
        this.rememberPalletBeforeEdit(mat);
        mat.location = row.location;
        const locOk = await this.persistLocationChange(mat, { silent: true, bypassUnlock: true });
        const palOk = await this.persistPalletChange(mat, row.palletId, { silent: true, bypassUnlock: true });
        if (locOk || palOk) ok += 1;
      }
      const n = this.ganPalletPending.length;
      this.ganPalletBusy = false;
      this.closeGanPallet();
      alert(ok ? `✅ Đã gán pallet ${ok}/${n} dòng.` : '❌ Không lưu được dòng nào.');
    } catch (e) {
      console.error('❌ saveGanPalletPending', e);
      this.ganPalletBusy = false;
      this.ganPalletError = 'Lỗi khi lưu. Thử lại.';
      this.cdr.detectChanges();
    }
  }

  get kkLocMapFilteredBoxes(): Array<{ loc: string; checked: number; total: number }> {
    const q = (this.kkLocMapQuery || '').trim().toUpperCase();
    if (!q) return this.kkLocMapBoxes;
    return this.kkLocMapBoxes.filter((b) => b.loc.includes(q));
  }

  get kkLocMapFilteredMaterials(): KkLocMaterialRow[] {
    let rows = this.kkLocMapByMaterial;
    const q = (this.kkLocMapQuery || '').trim().toUpperCase();
    if (q) rows = rows.filter((r) => r.materialCode.includes(q));
    if (this.kkLocMapWarehouseFilter) {
      rows = rows.filter((r) => r.warehouse === this.kkLocMapWarehouseFilter);
    }
    rows = rows.filter((r) => this.kkMatchesWh3Mode(r.warehouse));
    if (this.kkFilterUncheckedOnly) {
      rows = rows.filter((r) => r.remaining > 0);
    }
    return rows;
  }

  get kkLocMapMaterialSummary(): { count: number; stock: number } {
    return this.kkLocMapFilteredMaterials.reduce(
      (acc, r) => ({ count: acc.count + 1, stock: acc.stock + r.stock }),
      { count: 0, stock: 0 }
    );
  }

  get kkCatalogFilteredEntries(): KkCatalogEntry[] {
    const q = (this.kkCatalogQuery || '').trim().toUpperCase();
    if (!q) return this.kkCatalogEntries;
    return this.kkCatalogEntries.filter((e) =>
      e.groupCode.includes(q) || e.productType.toUpperCase().includes(q)
    );
  }

  get kkLocMapCatalogEntries(): KkCatalogEntry[] {
    const q = (this.kkLocMapQuery || '').trim().toUpperCase();
    if (!q) return this.kkCatalogEntries;
    return this.kkCatalogEntries.filter((e) =>
      e.groupCode.includes(q) || e.productType.toUpperCase().includes(q)
    );
  }

  get kkLocMapFilteredTypes(): KkTypeRow[] {
    const q = (this.kkLocMapQuery || '').trim().toUpperCase();
    if (!q) return this.kkLocMapByType;
    return this.kkLocMapByType.filter((r) =>
      r.productType.toUpperCase().includes(q) ||
      r.groupCodes.some((g) => g.includes(q))
    );
  }

  get kkLocMapTypeSummary(): { count: number; stock: number } {
    return this.kkTypeBoxes.reduce(
      (acc, r) => ({ count: acc.count + 1, stock: acc.stock + r.stock }),
      { count: 0, stock: 0 }
    );
  }

  private invalidateKkTypeViewCache(): void {
    this.kkTypeCacheRev++;
    this.kkTypeBoxesSig = '';
    this.kkTypeDetailSig = '';
    this.kkTypePalletNotesSig = '';
  }

  get kkTypeBoxes(): Array<{
    productType: string;
    groupCodes: string[];
    sharedPrefix: string;
    stock: number;
    checked: number;
    totalLines: number;
    remaining: number;
  }> {
    this.ensureKkTypeBoxesCache();
    return this.kkTypeBoxesCached;
  }

  get kkTypeBoxGroups(): Array<{
    category: string;
    title: string;
    boxes: Array<{
      productType: string;
      groupCodes: string[];
      sharedPrefix: string;
      stock: number;
      checked: number;
      totalLines: number;
      remaining: number;
    }>;
  }> {
    const map = new Map<string, typeof this.kkTypeBoxesCached>();
    for (const box of this.kkTypeBoxes) {
      const category = this.kkTypeCategoryOf(box.productType, box.groupCodes);
      const list = map.get(category) || [];
      list.push(box);
      map.set(category, list);
    }
    return Array.from(map.entries()).map(([category, boxes]) => ({
      category,
      title: this.kkTypeMucTitle(category),
      boxes
    }));
  }

  /** Gom loại hàng thành mục. Cùng đầu mã B+3 → một mục, các box nằm trong đó. */
  kkTypeCategoryOf(productType: string, groupCodes: string[] = []): string {
    const raw = String(productType || '').trim();
    if (!raw) return 'Khác';
    if (raw === 'Chưa gán danh mục') return raw;
    if (this.isKkDauNoiMuc(raw, groupCodes)) return 'ĐẦU NỐI';
    if (this.isKkDauCotMuc(raw, groupCodes)) return 'ĐẦU CỐT';
    const bPrefix = this.kkTypeSharedBPrefix(groupCodes);
    if (bPrefix) return bPrefix;

    const tokens = raw.split(/\s+/).filter(Boolean);
    const skip = new Set([
      'DEN', 'TRANG', 'DO', 'XANH', 'VANG', 'NAU', 'XAM', 'CAM', 'HONG', 'TIM',
      'BLACK', 'WHITE', 'RED', 'BLUE', 'YELLOW', 'GREEN', 'GREY', 'GRAY', 'BROWN', 'ORANGE'
    ]);
    const fold = (t: string) => t.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[Đđ]/g, 'D');
    const isSpec = (t: string): boolean => {
      const u = t.toUpperCase().replace(/[(),]/g, '');
      if (!u) return true;
      if (/^\d/.test(u)) return true;
      if (/^(AWG|MM|CM|M|IN|MIL|V|A|W|KG|G|PCS|PC|Ø|PHI)$/.test(u)) return true;
      if (/\d/.test(u)) return true;
      return false;
    };
    const head: string[] = [];
    for (const t of tokens) {
      if (skip.has(fold(t))) continue;
      if (isSpec(t)) break;
      head.push(t);
    }
    return head.length ? head.join(' ') : raw;
  }

  private isKkDauNoiMuc(productType: string, groupCodes: string[] = []): boolean {
    const prefixes = this.kkTypeGroupPrefixes(groupCodes);
    if (prefixes.includes('B009') || prefixes.includes('B016')) return true;
    const fold = this.foldKkTypeName(productType);
    return /DAU\s*NOI/.test(fold);
  }

  private isKkDauCotMuc(productType: string, groupCodes: string[] = []): boolean {
    if (this.isKkDauNoiMuc(productType, groupCodes)) return false;
    const fold = this.foldKkTypeName(productType);
    return /DAU\s*COT/.test(fold) || /\bTERMINAL/.test(fold);
  }

  /** Phần hãng sau “Đầu cốt (terminal)”. Trống = không ghi hãng. */
  private kkTerminalBrandTail(productType: string): string {
    return this.foldKkTypeName(productType)
      .replace(/DAU\s*COT/g, ' ')
      .replace(/\(\s*TERMINAL\s*\)/g, ' ')
      .replace(/\bTERMINAL\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Terminal không hãng / chưa rõ hãng / không có hãng. */
  private isKkUnbrandedTerminalType(productType: string, groupCodes: string[] = []): boolean {
    if (!this.isKkDauCotMuc(productType, groupCodes)) return false;
    const tail = this.kkTerminalBrandTail(productType);
    if (!tail) return true;
    const fold = this.foldKkTypeName(tail).replace(/[().,]/g, ' ').replace(/\s+/g, ' ').trim();
    return /CHUA\s*RO\s*HANG/.test(fold)
      || /KHONG\s*(CO\s*)?HANG/.test(fold)
      || /^(UNKNOWN|N\/A|NA|\?|-|KHAC)$/.test(fold);
  }

  /** Gộp terminal chưa rõ hãng + không hãng thành một loại. */
  private kkCanonicalTypeKey(productType: string, groupCodes: string[] = []): string {
    if (this.isKkUnbrandedTerminalType(productType, groupCodes)) return 'Đầu cốt (terminal)';
    return productType;
  }

  /** Cùng một đầu mã B+3 (vd B017, B005). Trống nếu loại có nhiều đầu mã. */
  private kkTypeSharedBPrefix(groupCodes: string[] = []): string {
    const prefixes = this.kkTypeGroupPrefixes(groupCodes);
    if (prefixes.length !== 1) return '';
    const prefix = prefixes[0];
    return /^B\d{3}$/.test(prefix) ? prefix : '';
  }

  private foldKkTypeName(value: string): string {
    return String(value || '')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/Đ/g, 'D');
  }

  /** Loại catalog “Đầu nối 1-10P” / “Housing đầu nối 1-10P” (B009 / B016). */
  private isKkConnector110PType(productType: string, groupCodes: string[] = []): boolean {
    const fold = this.foldKkTypeName(productType);
    if (!/1\s*[-–]\s*10\s*P/.test(fold)) return false;
    return this.isKkDauNoiMuc(productType, groupCodes);
  }

  private kkConnector110PSplitLabel(productType: string, split: '1-4' | '5-10'): string {
    const repl = split === '1-4' ? '1-4P' : '5-10P';
    const next = String(productType || '').replace(/1\s*[-–]\s*10\s*P/i, repl);
    return next !== productType ? next : `${productType} ${repl}`;
  }

  /** Số P trên tên mã (bỏ khoảng 1-10P). Không parse được → null. */
  private parseKkConnectorPinsFromMaterial(material: InventoryMaterial): number | null {
    const name = this.getKkMaterialName(material);
    const u = String(name || '').toUpperCase().replace(/,/g, ' ');
    const cleaned = u.replace(/\d+\s*[-–]\s*\d+\s*P/g, ' ');
    const m = cleaned.match(/(?:^|[^\d])(\d{1,2})\s*(?:P|PIN)\b/);
    if (!m) return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 1 || n > 24) return null;
    return n;
  }

  private kkMaterialMatchesPinSplit(material: InventoryMaterial, split: '1-4' | '5-10'): boolean {
    const pins = this.parseKkConnectorPinsFromMaterial(material);
    if (split === '1-4') return pins == null || pins <= 4;
    return pins != null && pins >= 5;
  }

  kkTypeMucTitle(category: string): string {
    if (category === 'Chưa gán danh mục') return 'Chưa gán danh mục';
    if (category === 'Khác') return 'Mục khác';
    if (category === 'ĐẦU NỐI') return 'Mục Đầu nối';
    if (category === 'ĐẦU CỐT') return 'Mục Đầu cốt (Terminal)';
    if (/^B\d{3}$/.test(category)) return `Mục ${category}`;
    const lower = category.toLocaleLowerCase('vi');
    const pretty = lower ? lower.charAt(0).toLocaleUpperCase('vi') + lower.slice(1) : category;
    return `Mục ${pretty}`;
  }

  isKkTypeMucCollapsed(category: string): boolean {
    return !!this.kkTypeMucCollapsed[category];
  }

  toggleKkTypeMuc(category: string, event?: Event): void {
    event?.stopPropagation();
    this.kkTypeMucCollapsed = {
      ...this.kkTypeMucCollapsed,
      [category]: !this.kkTypeMucCollapsed[category]
    };
  }

  private ensureKkTypeBoxesCache(): void {
    const sig = [
      this.kkTypeCacheRev,
      this.kkLocMapWarehouseFilter,
      this.kkCountWh3 ? 1 : 0,
      this.kkWh3Only ? 1 : 0,
      this.kkFilterUncheckedOnly ? 1 : 0,
      (this.kkLocMapQuery || '').trim().toUpperCase()
    ].join('|');
    if (sig === this.kkTypeBoxesSig) return;
    this.kkTypeBoxesSig = sig;
    this.kkTypeBoxesCached = this.buildKkTypeBoxes();
  }

  private buildKkTypeBoxes(): Array<{
    productType: string;
    groupCodes: string[];
    sharedPrefix: string;
    stock: number;
    checked: number;
    totalLines: number;
    remaining: number;
  }> {
    const q = (this.kkLocMapQuery || '').trim().toUpperCase();
    const map = new Map<string, {
      productType: string;
      groups: Set<string>;
      sources: Set<string>;
      stock: number;
      checked: number;
      totalLines: number;
      searchHit: boolean;
    }>();
    const bump = (productType: string, groupCodes: string[] = []) => {
      const key = this.kkCanonicalTypeKey(productType, groupCodes);
      const cur = map.get(key) || {
        productType: key,
        groups: new Set<string>(),
        sources: new Set<string>(),
        stock: 0,
        checked: 0,
        totalLines: 0,
        searchHit: false
      };
      cur.sources.add(productType);
      groupCodes.forEach((g) => cur.groups.add(g));
      map.set(key, cur);
      return cur;
    };
    for (const e of this.kkCatalogEntries) {
      bump(e.productType).groups.add(e.groupCode);
    }
    for (const r of this.kkLocMapByType) {
      bump(r.productType, r.groupCodes);
    }
    const zone = this.kkLocMapWarehouseFilter;
    map.forEach((cur) => {
      const seen = new Set<string>();
      const raw: InventoryMaterial[] = [];
      for (const src of cur.sources) {
        for (const m of this.kkLocMapTypeCache.get(src) || []) {
          const id = String(m.id || '');
          if (id) {
            if (seen.has(id)) continue;
            seen.add(id);
          }
          raw.push(m);
        }
      }
      let stock = 0;
      let checked = 0;
      let totalLines = 0;
      let searchHit = false;
      for (const m of raw) {
        const wh = this.kkWarehouseFromLocation(m.location);
        if (!this.kkMatchesWh3Mode(wh)) continue;
        if (zone && wh !== zone) continue;
        const lineStock = this.calculateCurrentStock(m);
        if (lineStock <= 0) continue;
        stock += lineStock;
        totalLines += 1;
        if (this.isKkFlagOn(m.kkChecked)) checked += 1;
        if (q && !searchHit) {
          const code = String(m.materialCode || '').toUpperCase();
          const pallet = String(m.palletId || '').toUpperCase();
          const name = this.getKkMaterialName(m).toUpperCase();
          if (code.includes(q) || pallet.includes(q) || name.includes(q)) searchHit = true;
        }
      }
      if (q && !searchHit) {
        searchHit = Array.from(cur.sources).some((s) => s.toUpperCase().includes(q));
      }
      cur.stock = stock;
      cur.totalLines = totalLines;
      cur.checked = checked;
      cur.searchHit = searchHit;
    });
    const built = Array.from(map.values())
      .filter((v) => {
        if (this.kkFilterUncheckedOnly && Math.max(0, v.totalLines - v.checked) <= 0) return false;
        if (!q) return true;
        return v.productType.toUpperCase().includes(q)
          || Array.from(v.groups).some((g) => g.includes(q))
          || v.searchHit
          || (this.isKkConnector110PType(v.productType, Array.from(v.groups))
            && (/1\s*[-–]?\s*4P/.test(q) || /5\s*[-–]?\s*10P/.test(q)));
      })
      .map((v) => {
        const groupCodes = Array.from(v.groups).sort((a, b) => this.compareNhuaGroupCode(a, b));
        const sources = Array.from(v.sources);
        return {
          productType: v.productType,
          sourceProductType: sources[0] || v.productType,
          sourceProductTypes: sources,
          groupCodes,
          sharedPrefix: this.kkTypeSharedGroupPrefix(groupCodes),
          stock: v.stock,
          checked: v.checked,
          totalLines: v.totalLines,
          remaining: Math.max(0, v.totalLines - v.checked)
        };
      })
      .sort((a, b) => this.compareKkTypeBox(a, b));
    return this.expandKkConnector110PBoxes(built);
  }

  private expandKkConnector110PBoxes(
    boxes: Array<{
      productType: string;
      sourceProductType?: string;
      pinSplit?: '1-4' | '5-10';
      groupCodes: string[];
      sharedPrefix: string;
      stock: number;
      checked: number;
      totalLines: number;
      remaining: number;
    }>
  ): typeof boxes {
    const q = (this.kkLocMapQuery || '').trim().toUpperCase();
    const zone = this.kkLocMapWarehouseFilter;
    const out: typeof boxes = [];
    for (const box of boxes) {
      if (!this.isKkConnector110PType(box.productType, box.groupCodes)) {
        out.push({ ...box, sourceProductType: box.sourceProductType || box.productType });
        continue;
      }
      const raw = this.kkLocMapTypeCache.get(box.productType) || [];
      for (const split of ['1-4', '5-10'] as const) {
        if (q && /1\s*[-–]?\s*4P/.test(q) && !/5\s*[-–]?\s*10P/.test(q) && split !== '1-4') continue;
        if (q && /5\s*[-–]?\s*10P/.test(q) && split !== '5-10') continue;
        let stock = 0;
        let checked = 0;
        let totalLines = 0;
        for (const m of raw) {
          const wh = this.kkWarehouseFromLocation(m.location);
          if (!this.kkMatchesWh3Mode(wh)) continue;
          if (zone && wh !== zone) continue;
          const lineStock = this.calculateCurrentStock(m);
          if (lineStock <= 0) continue;
          if (!this.kkMaterialMatchesPinSplit(m, split)) continue;
          stock += lineStock;
          totalLines += 1;
          if (this.isKkFlagOn(m.kkChecked)) checked += 1;
        }
        if (this.kkFilterUncheckedOnly && Math.max(0, totalLines - checked) <= 0) continue;
        out.push({
          productType: this.kkConnector110PSplitLabel(box.productType, split),
          sourceProductType: box.productType,
          pinSplit: split,
          groupCodes: box.groupCodes,
          sharedPrefix: box.sharedPrefix,
          stock,
          checked,
          totalLines,
          remaining: Math.max(0, totalLines - checked)
        });
      }
    }
    return out;
  }

  /** Đầu mã hiện trên ô: B005001 / B000005 → B005; B001680 → B001. */
  private kkTypePrefixFromGroup(raw: string): string {
    const c = String(raw || '').trim().toUpperCase();
    const six = /^([ABR])(\d{6})$/.exec(c);
    if (six) {
      const digits = six[2];
      if (digits.startsWith('000')) return `${six[1]}${digits.slice(3)}`;
      return `${six[1]}${digits.slice(0, 3)}`;
    }
    const three = /^([ABR]\d{3})/.exec(c);
    return three ? three[1] : '';
  }

  /** Các đầu mã B+3 (vd B005, B002) hiện trên ô loại hàng. */
  kkTypeGroupPrefixes(groupCodes: string[]): string[] {
    const set = new Set<string>();
    for (const raw of groupCodes || []) {
      const prefix = this.kkTypePrefixFromGroup(raw);
      if (prefix) set.add(prefix);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  }

  /** Đầu mã chung của cả loại (vd B006). Chỉ hiện khi mọi nhóm mã cùng prefix. */
  kkTypeSharedGroupPrefix(groupCodes: string[]): string {
    const prefixes = (groupCodes || [])
      .map((raw) => {
        const c = String(raw || '').trim().toUpperCase();
        const m = /^([ABR]\d{3})/.exec(c);
        return m ? m[1] : '';
      });
    if (!prefixes.length || prefixes.some((p) => !p)) return '';
    const first = prefixes[0];
    return prefixes.every((p) => p === first) ? first : '';
  }

  /** Nhóm nhựa: B+6 trước (B001001 đầu), rồi A+6, rồi mã khác. */
  private compareNhuaGroupCode(a: string, b: string): number {
    const rank = (raw: string): { band: number; n: number; s: string } => {
      const c = String(raw || '').trim().toUpperCase();
      const m = /^([ABR])(\d{6})$/.exec(c);
      if (!m) return { band: 9, n: 999999, s: c };
      const band = m[1] === 'B' ? 0 : m[1] === 'A' ? 1 : 2;
      return { band, n: parseInt(m[2], 10), s: c };
    };
    const pa = rank(a);
    const pb = rank(b);
    if (pa.band !== pb.band) return pa.band - pb.band;
    if (pa.n !== pb.n) return pa.n - pb.n;
    return pa.s.localeCompare(pb.s, 'en', { numeric: true });
  }

  private compareKkTypeBox(
    a: { productType: string; groupCodes: string[] },
    b: { productType: string; groupCodes: string[] }
  ): number {
    if (a.productType === 'Chưa gán danh mục') return 1;
    if (b.productType === 'Chưa gán danh mục') return -1;
    const ga = a.groupCodes[0] || '';
    const gb = b.groupCodes[0] || '';
    const byCode = this.compareNhuaGroupCode(ga, gb);
    if (byCode) return byCode;
    return a.productType.localeCompare(b.productType, 'vi', { numeric: true });
  }

  get kkActiveTypeRow(): KkTypeRow | null {
    const name = this.kkActiveProductType;
    if (!name) return null;
    const found = this.kkLocMapByType.find((r) => r.productType === name)
      || (this.kkActiveTypeDraft?.productType === name ? this.kkActiveTypeDraft : this.buildEmptyKkTypeRow(name));
    return this.applyKkTypeRowLiveCounts(found);
  }

  private applyKkTypeRowLiveCounts(row: KkTypeRow): KkTypeRow {
    const lines = this.kkTypeDetailAll;
    let stock = 0;
    let checked = 0;
    for (const m of lines) {
      stock += this.calculateCurrentStock(m);
      if (this.isKkFlagOn(m.kkChecked)) checked += 1;
    }
    row.stock = stock;
    row.totalLines = lines.length;
    row.checked = checked;
    row.remaining = Math.max(0, row.totalLines - checked);
    return row;
  }

  kkTypeBoxTone(box: { checked: number; totalLines: number }): string {
    if (!box.totalLines) return 'empty';
    if (box.checked >= box.totalLines) return 'done';
    if (box.checked <= 0) return 'none';
    return 'partial';
  }

  selectKkTypeBox(productType: string): void {
    this.ensureKkTypeBoxesCache();
    const box = this.kkTypeBoxesCached.find((b) => b.productType === productType)
      || this.kkTypeBoxesCached.find((b) => !!b.sourceProductTypes?.includes(productType));
    this.kkActiveProductType = box?.productType || productType;
    this.kkActiveSourceProductType = box?.sourceProductType || productType;
    this.kkActivePinSplit = box?.pinSplit || null;
    const draft = this.buildEmptyKkTypeRow(this.kkActiveSourceProductType);
    draft.productType = productType;
    if (box?.groupCodes?.length) draft.groupCodes = box.groupCodes;
    this.kkActiveTypeDraft = draft;
    this.kkTypePage = 1;
    this.kkTypeDetailQuery = this.kkLocMapQuery;
    this.kkTypeSearchDraft = this.kkLocMapQuery;
    this.kkTypeFilterLoc = '';
    this.kkTypeFilterWh = '';
    this.kkTypeFilterRolls = '';
    this.kkTypeSortQtyDesc = false;
    this.kkTypeShowExtraFilter = false;
    if (!this.kkLocMapTypeCache.size) void this.loadKkByType();
    void this.ensureKkTypeMaterialNames();
  }

  kkTypeHomeLocOf(productType: string): string {
    return this.kkTypeHomeLocs.get(String(productType || '').trim()) || '';
  }

  openKkTypeHomeLocPicker(event: Event, box: { productType: string; groupCodes?: string[] }): void {
    event.preventDefault();
    event.stopPropagation();
    const productType = String(box?.productType || '').trim();
    if (!productType) return;
    this.layoutLocTypeAssign = productType;
    this.layoutLocTypeAssignGroups = box.groupCodes || [];
    this.layoutLocMaterial = null;
    this.layoutLocFocus = 'location';
    this.layoutLocWh = 'J';
    const existing = this.kkTypeHomeLocOf(productType);
    this.layoutLocSelected = new Set(
      splitMultiLocations(existing).map((x) => normalizeLayoutLocToken(x, 'J')).filter(Boolean)
    );
    const groups = getLayoutLocationGroups('J');
    const selectedUpper = new Set(Array.from(this.layoutLocSelected).map((s) => s.toUpperCase()));
    const hit = groups.find((g) => g.slots.some((s) => selectedUpper.has(s.toUpperCase())));
    const prefixes = this.kkTypeGroupPrefixes(this.layoutLocTypeAssignGroups);
    const bPrefix = prefixes.find((p) => /^B\d{3}$/.test(p)) || '';
    const suggestedS = jKhoMatSFirstRowForPrefix(bPrefix);
    if (hit) {
      this.layoutLocGroupId = hit.id;
      this.layoutLocFamily = /^S\d{2}$/.test(hit.id) ? 'S' : 'R';
    } else if (suggestedS) {
      this.layoutLocGroupId = suggestedS;
      this.layoutLocFamily = 'S';
    } else {
      this.layoutLocGroupId = groups[0]?.id || '';
      this.layoutLocFamily = 'R';
    }
    this.layoutLocQuery = '';
    this.layoutLocManualDraft = '';
    this.layoutLocPalletDraft = '';
    this.syncLayoutJFocusBlockFromSelection();
    this.showLayoutLocPicker = true;
    this.cdr.detectChanges();
  }

  private async applyKkTypeHomeLocPicker(): Promise<void> {
    const productType = String(this.layoutLocTypeAssign || '').trim();
    if (!productType) return;
    if (String(this.layoutLocManualDraft || '').trim()) this.addLayoutLocManual();
    const locs = Array.from(this.layoutLocSelected);
    const mismatch = this.layoutLocSRuleMismatchMessage(locs);
    if (mismatch && !confirm(mismatch)) return;
    const joined = joinMultiLocations(locs);
    try {
      await this.kkCatalog.saveHomeLoc(productType, joined);
      if (joined) this.kkTypeHomeLocs.set(productType, joined);
      else this.kkTypeHomeLocs.delete(productType);
      this.kkTypeHomeLocs = new Map(this.kkTypeHomeLocs);
      this.closeLayoutLocPicker();
    } catch (e) {
      console.error('❌ saveHomeLoc:', e);
      alert('❌ Không lưu được vị trí cất hàng.');
    }
  }

  backKkTypeBoxes(): void {
    this.kkActiveProductType = null;
    this.kkActiveTypeDraft = null;
    this.kkActivePinSplit = null;
    this.kkActiveSourceProductType = null;
    this.kkTypePage = 1;
    this.kkTypeFilterLoc = '';
    this.kkTypeFilterWh = '';
    this.kkTypeFilterRolls = '';
    this.kkTypeSortQtyDesc = false;
    this.kkTypeShowExtraFilter = false;
  }

  get kkTypeDetailAll(): InventoryMaterial[] {
    this.ensureKkTypeDetailCache();
    return this.kkTypeDetailAllCached;
  }

  /** Lọc danh sách chi tiết (bảng) theo mã / tên / pallet / vị trí / kho / cuộn / chưa KK. */
  get kkTypeDetailFiltered(): InventoryMaterial[] {
    this.ensureKkTypeDetailCache();
    return this.kkTypeDetailFilteredCached;
  }

  /** Tổng cuộn (ceil tồn÷SP, phần lẻ +1) của các dòng đang lọc. */
  get kkTypeFilteredRollsTotal(): number {
    this.ensureKkTypeDetailCache();
    return this.kkTypeFilteredRollsCached;
  }

  private ensureKkTypeDetailCache(): void {
    const sig = [
      this.kkTypeCacheRev,
      this.kkActiveProductType || '',
      this.kkActiveSourceProductType || '',
      this.kkActivePinSplit || '',
      this.kkLocMapWarehouseFilter,
      this.kkCountWh3 ? 1 : 0,
      this.kkWh3Only ? 1 : 0,
      this.kkFilterUncheckedOnly ? 1 : 0,
      (this.kkLocMapQuery || '').trim().toUpperCase(),
      this.kkTypeDetailQuery,
      this.kkTypeFilterLoc,
      this.kkTypeFilterWh,
      this.kkTypeFilterRolls,
      this.kkTypeSortQtyDesc ? 1 : 0
    ].join('|');
    if (sig === this.kkTypeDetailSig) return;
    this.kkTypeDetailSig = sig;
    const name = this.kkActiveProductType;
    const found = name
      ? (this.kkLocMapByType.find((r) => r.productType === name)
        || (this.kkActiveTypeDraft?.productType === name ? this.kkActiveTypeDraft : this.buildEmptyKkTypeRow(name)))
      : null;
    this.kkTypeDetailAllCached = this.kkTypeDetailLines(found);
    this.kkTypeDetailFilteredCached = this.buildKkTypeDetailFiltered(this.kkTypeDetailAllCached);
    this.kkTypeFilteredRollsCached = this.kkTypeDetailFilteredCached.reduce((sum, m) => {
      return sum + this.getKkRollsCount(m);
    }, 0);
  }

  private buildKkTypeDetailFiltered(all: InventoryMaterial[]): InventoryMaterial[] {
    let rows = all;
    if (this.kkFilterUncheckedOnly) {
      rows = rows.filter((m) => !this.isKkFlagOn(m.kkChecked));
    }
    const loc = this.kkTypeFilterLoc.trim().toUpperCase();
    if (loc) {
      rows = rows.filter((m) => String(m.location || '').trim().toUpperCase() === loc);
    }
    if (this.kkTypeFilterWh) {
      rows = rows.filter((m) => this.kkWarehouseFromLocation(m.location) === this.kkTypeFilterWh);
    }
    if (this.kkTypeFilterRolls) {
      rows = rows.filter((m) => this.getKkRollsText(m) === this.kkTypeFilterRolls);
    }
    const q = (this.kkLocMapQuery || this.kkTypeDetailQuery || '').trim().toUpperCase();
    if (q) {
      rows = rows.filter((m) => {
        const code = String(m.materialCode || '').toUpperCase();
        const pallet = String(m.palletId || '').toUpperCase();
        const name = this.getKkMaterialName(m).toUpperCase();
        return code.includes(q) || pallet.includes(q) || name.includes(q);
      });
    }
    if (this.kkTypeSortQtyDesc) {
      rows = [...rows].sort((a, b) => this.calculateCurrentStock(b) - this.calculateCurrentStock(a));
    }
    return rows;
  }

  get kkTypeLocationOptions(): string[] {
    const set = new Set<string>();
    for (const m of this.kkTypeDetailAll) {
      const loc = String(m.location || '').trim().toUpperCase();
      if (loc) set.add(loc);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  }

  get kkTypeRollsOptions(): string[] {
    const set = new Set<string>();
    for (const m of this.kkTypeDetailAll) {
      const t = this.getKkRollsText(m);
      if (t && t !== '—') set.add(t);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  }

  applyKkTypeFilters(): void {
    this.kkTypeDetailQuery = this.kkTypeSearchDraft || this.kkLocMapQuery;
    this.kkTypePage = 1;
  }

  onKkTypeUnifiedSearch(): void {
    this.kkTypeSearchDraft = this.kkLocMapQuery;
    this.kkTypeDetailQuery = this.kkLocMapQuery;
    this.kkTypePage = 1;
  }

  clearKkTypeUnifiedSearch(): void {
    this.kkLocMapQuery = '';
    this.onKkTypeUnifiedSearch();
  }

  clearKkTypeFilters(): void {
    this.kkTypeFilterLoc = '';
    this.kkTypeFilterWh = '';
    this.kkTypeFilterRolls = '';
    this.kkTypeSortQtyDesc = false;
    this.kkTypePage = 1;
  }

  toggleKkTypeSortQty(): void {
    this.kkTypeSortQtyDesc = !this.kkTypeSortQtyDesc;
    this.kkTypePage = 1;
  }

  onKkTypeFilterChange(): void {
    this.kkTypePage = 1;
  }

  onKkTypePageSizeChange(size: number): void {
    const n = Number(size) || 20;
    this.kkTypePageSize = n;
    this.kkTypePage = 1;
  }

  get kkTypeShowingFrom(): number {
    if (!this.kkTypeDetailFiltered.length) return 0;
    return (this.kkTypePage - 1) * this.kkTypePageSize + 1;
  }

  get kkTypeShowingTo(): number {
    return Math.min(this.kkTypePage * this.kkTypePageSize, this.kkTypeDetailFiltered.length);
  }

  get kkTypeVisiblePages(): Array<number | 'ellipsis'> {
    const total = this.kkTypeDetailTotalPages;
    const current = Math.min(Math.max(1, this.kkTypePage), total);
    if (total <= 7) {
      return Array.from({ length: Math.max(total, 1) }, (_, i) => i + 1);
    }
    if (current <= 4) {
      return [1, 2, 3, 4, 5, 'ellipsis', total];
    }
    if (current >= total - 3) {
      return [1, 'ellipsis', total - 4, total - 3, total - 2, total - 1, total];
    }
    return [1, 'ellipsis', current - 1, current, current + 1, 'ellipsis', total];
  }

  kkTypeGoToVisiblePage(page: number | 'ellipsis'): void {
    if (page === 'ellipsis') return;
    this.kkTypeGoToPage(page);
  }

  onKkTypeDetailQueryChange(): void {
    this.kkTypePage = 1;
  }

  onKkCountWh3Change(): void {
    if (!this.kkCountWh3) this.kkWh3Only = false;
    this.kkTypePage = 1;
    this.cdr.detectChanges();
  }

  onKkWh3OnlyChange(): void {
    if (this.kkWh3Only) this.kkCountWh3 = true;
    this.kkTypePage = 1;
    this.cdr.detectChanges();
  }

  onKkFilterUncheckedChange(): void {
    this.kkTypePage = 1;
    this.cdr.detectChanges();
  }

  get kkTypeDetailTotalPages(): number {
    return Math.max(1, Math.ceil(this.kkTypeDetailFiltered.length / this.kkTypePageSize));
  }

  get kkTypePageOptions(): number[] {
    return Array.from({ length: this.kkTypeDetailTotalPages }, (_, i) => i + 1);
  }

  get kkTypeDetailPaged(): InventoryMaterial[] {
    const all = this.kkTypeDetailFiltered;
    const maxPage = Math.max(1, Math.ceil(all.length / this.kkTypePageSize));
    const page = Math.min(Math.max(1, this.kkTypePage), maxPage);
    const start = (page - 1) * this.kkTypePageSize;
    return all.slice(start, start + this.kkTypePageSize);
  }

  kkTypeRowIndex(indexOnPage: number): number {
    const page = Math.min(Math.max(1, this.kkTypePage), this.kkTypeDetailTotalPages);
    return (page - 1) * this.kkTypePageSize + indexOnPage + 1;
  }

  kkTypeGoToPage(page: number): void {
    const max = this.kkTypeDetailTotalPages;
    if (page < 1 || page > max) return;
    this.kkTypePage = page;
  }

  kkTypePrevPage(): void {
    this.kkTypeGoToPage(this.kkTypePage - 1);
  }

  kkTypeNextPage(): void {
    this.kkTypeGoToPage(this.kkTypePage + 1);
  }

  printKkTypeList(): void {
    const row = this.kkActiveTypeRow;
    const lines = this.kkTypeDetailAll;
    if (!row || !lines.length) {
      alert('Không có dòng để in.');
      return;
    }
    const win = window.open('', '_blank', 'width=1100,height=800');
    if (!win) {
      alert('Trình duyệt chặn popup. Vui lòng cho phép popup để in.');
      return;
    }
    const esc = (s: string) => this.escapeHtmlForPrint(s);
    const zone = this.kkLocMapWarehouseFilter
      ? this.kkWarehouseLabel(this.kkLocMapWarehouseFilter)
      : (this.kkWh3Only ? 'Chỉ ASM3 / WH3' : (this.kkCountWh3 ? 'Tất cả' : 'Tất cả (không WH3/ASM3)'));
    const groupText = row.groupCodes.length
      ? `${row.groupCodes[0]}${row.groupCodes.length > 1 ? ` · ${row.groupCodes.length} nhóm mã` : ''}`
      : '—';
    const rowsHtml = lines.map((m, i) => {
      const stock = this.calculateCurrentStock(m);
      return `<tr>
        <td class="c">${i + 1}</td>
        <td>${esc(String(m.materialCode || ''))}</td>
        <td>${esc(this.getKkMaterialName(m))}</td>
        <td>${esc(String(m.poNumber || '—'))}</td>
        <td>${esc(this.getDisplayIMD(m) || '—')}</td>
        <td class="n">${esc(this.formatNumber(stock))}</td>
        <td>${esc(String(m.location || '—'))}</td>
        <td>${esc(this.kkWarehouseLabel(this.kkWarehouseFromLocation(m.location)))}</td>
        <td>${esc(String(m.palletId || '—'))}</td>
        <td class="n">${esc(this.formatNumber(this.getEffectiveStandardPacking(m) || 0))}</td>
        <td class="c">${esc(this.getKkRollsText(m))}</td>
        <td class="n">${esc(this.formatNumber(this.getKkScanCount(m)))} / ${esc(this.formatNumber(stock))}</td>
        <td class="c">${m.kkChecked ? '☑' : '☐'}</td>
        <td>${esc(this.getKkTypePalletNote(m) || '—')}</td>
      </tr>`;
    }).join('');
    const now = new Date().toLocaleString('vi-VN');
    win.document.open();
    win.document.write(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>KK · ${esc(row.productType)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm 10mm 12mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 11px; color: #000; background: #fff; }
    .no-print { background:#fffbe6; border:1px solid #e6c000; padding:8px 14px; margin-bottom:12px;
                border-radius:4px; display:flex; justify-content:space-between; align-items:center; }
    .no-print button { background:#0f172a; color:#fff; border:none; padding:7px 18px;
                       border-radius:4px; cursor:pointer; font-size:12px; }
    .page-hdr { border-bottom:2px solid #000; padding-bottom:8px; margin-bottom:10px; }
    .page-hdr h1 { font-size:16px; letter-spacing:.4px; margin-bottom:4px; }
    .page-hdr p { font-size:11px; color:#333; }
    table { width:100%; border-collapse:collapse; }
    thead { display: table-header-group; }
    th, td { border:1px solid #333; padding:4px 6px; }
    th { background:#f0f0f0; font-size:10px; text-transform:uppercase; text-align:left; }
    td.c, th.c { text-align:center; }
    td.n { text-align:right; font-variant-numeric: tabular-nums; }
    tbody tr:nth-child(even) td { background:#fafafa; }
    .print-footer { margin-top:10px; font-size:9px; color:#666; text-align:right; }
    @media print { .no-print { display:none !important; } }
  </style>
</head>
<body>
  <div class="no-print">
    <span>Nhấn <strong>Ctrl+P</strong> hoặc bấm nút để in danh sách loại hàng</span>
    <button onclick="window.print()">In ngay</button>
  </div>
  <div class="page-hdr">
    <h1>KIỂM TRA KK THEO LOẠI HÀNG</h1>
    <p>
      Loại hàng: <strong>${esc(row.productType)}</strong>
      &nbsp;|&nbsp; Nhà máy: <strong>${esc(this.selectedFactory)}</strong>
      &nbsp;|&nbsp; Zone: <strong>${esc(zone)}</strong>
      &nbsp;|&nbsp; ${esc(groupText)}
    </p>
    <p>
      KK: <strong>${row.checked}/${row.totalLines}</strong>
      &nbsp;|&nbsp; Tồn: <strong>${esc(this.formatNumber(row.stock))}</strong>
      &nbsp;|&nbsp; ${lines.length} dòng
      &nbsp;|&nbsp; In lúc: ${esc(now)}
    </p>
  </div>
  <table>
    <thead>
      <tr>
        <th class="c">STT</th>
        <th>Mã hàng</th>
        <th>Tên hàng</th>
        <th>PO</th>
        <th>IMD</th>
        <th class="c">Tồn kho</th>
        <th>Vị trí</th>
        <th>Kho</th>
        <th>Pallet</th>
        <th class="c">Standard</th>
        <th class="c">Cuộn</th>
        <th class="c">Lần quét</th>
        <th class="c">KK</th>
        <th>Ghi chú</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="print-footer">In lúc: ${esc(now)}</div>
</body>
</html>`);
    win.document.close();
    win.focus();
  }

  private kkTypeReportZoneLabel(): string {
    if (this.kkLocMapWarehouseFilter) return this.kkWarehouseLabel(this.kkLocMapWarehouseFilter);
    if (this.kkWh3Only) return 'Chi ASM3 WH3';
    if (!this.kkCountWh3) return 'Tat ca (khong WH3)';
    return 'Tat ca';
  }

  private kkTypeReportFileDate(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private mapKkTypeLineToExcelRow(
    productType: string,
    material: InventoryMaterial,
    stt: number
  ): Record<string, unknown> {
    const kkOn = this.isKkFlagOn(material.kkChecked);
    return {
      'Loại hàng': productType,
      'STT': stt,
      'Mã hàng': String(material.materialCode || ''),
      'Tên hàng': this.getKkMaterialName(material),
      'PO': String(material.poNumber || ''),
      'IMD': this.getDisplayIMD(material) === 'N/A' ? '' : this.getDisplayIMD(material),
      'Tồn kho': this.calculateCurrentStock(material),
      'Vị trí': String(material.location || ''),
      'Kho': this.kkWarehouseLabel(this.kkWarehouseFromLocation(material.location)),
      'Pallet': String(material.palletId || ''),
      'Standard': this.getEffectiveStandardPacking(material) || '',
      'Cuộn': this.getKkRollsText(material),
      'Lần quét': this.getKkScanCount(material),
      'KK': kkOn ? 'Đã KK' : 'Chưa KK',
      'Ghi chú': this.getKkTypePalletNote(material),
      'Người KK': String(material.kkBy || ''),
      'Thời gian KK': kkOn ? this.formatLastStatusDate(this.normalizeTimestamp(material.kkAt)) : ''
    };
  }

  private async writeKkTypeExcel(
    rows: Record<string, unknown>[],
    sheetName: string,
    fileKind: string
  ): Promise<void> {
    if (!rows.length) {
      alert('Không có dữ liệu để tải báo cáo.');
      return;
    }
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    const safeSheet = String(sheetName || 'KK').replace(/[\\/?*[\]]/g, ' ').slice(0, 31) || 'KK';
    XLSX.utils.book_append_sheet(wb, ws, safeSheet);
    const zone = this.kkTypeReportZoneLabel().replace(/[\\/:*?"<>|]+/g, '_');
    const fileName = `KK_${this.selectedFactory}_${zone}_${fileKind}_${this.kkTypeReportFileDate()}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }

  async exportKkTypeReport(kind: 'summary' | 'current' | 'all' | 'unchecked' | 'checked'): Promise<void> {
    if (this.kkTypeReportBusy) return;
    this.showKkTypeReportMenu = false;
    this.kkTypeReportBusy = true;
    this.cdr.detectChanges();
    try {
      if (kind === 'summary') {
        const rows = this.kkTypeBoxes.map((box, i) => ({
          'STT': i + 1,
          'Loại hàng': box.productType,
          'Đã KK': box.checked,
          'Tổng mã': box.totalLines,
          'Còn lại': box.remaining
        }));
        await this.writeKkTypeExcel(rows, 'Tong hop loai hang', 'TongHop');
        return;
      }
      if (kind === 'current' && !this.kkActiveProductType) {
        alert('Hãy mở một loại hàng trước.');
        return;
      }
      const typeNames = kind === 'current' && this.kkActiveProductType
        ? [this.kkActiveProductType]
        : this.kkTypeBoxes.map((b) => b.productType);
      const rows: Record<string, unknown>[] = [];
      let stt = 0;
      for (const productType of typeNames) {
        let lines = kind === 'current'
          ? this.kkTypeDetailAll
          : this.kkCachedLinesForType(productType).filter((m) => this.calculateCurrentStock(m) > 0);
        if (kind === 'checked') lines = lines.filter((m) => this.isKkFlagOn(m.kkChecked));
        if (kind === 'unchecked') lines = lines.filter((m) => !this.isKkFlagOn(m.kkChecked));
        for (const m of lines) {
          stt += 1;
          rows.push(this.mapKkTypeLineToExcelRow(productType, m, stt));
        }
      }
      const names: Record<'current' | 'all' | 'unchecked' | 'checked', string> = {
        current: 'ChiTietLoai',
        all: 'ChiTietTatCa',
        unchecked: 'ChuaKK',
        checked: 'DaKK'
      };
      const sheet = kind === 'current' ? String(this.kkActiveProductType || 'Chi tiet') : 'Chi tiet';
      await this.writeKkTypeExcel(rows, sheet, names[kind]);
    } catch (e) {
      console.error('❌ exportKkTypeReport:', e);
      alert('❌ Không tải được báo cáo Excel.');
    } finally {
      this.kkTypeReportBusy = false;
      this.cdr.detectChanges();
    }
  }

  private buildEmptyKkTypeRow(productType: string): KkTypeRow {
    const zone = this.kkLocMapWarehouseFilter || 'D1';
    return {
      productType,
      groupCodes: this.kkCatalogEntries
        .filter((e) => e.productType === productType)
        .map((e) => e.groupCode)
        .sort((a, b) => this.compareNhuaGroupCode(a, b)),
      warehouse: zone,
      stock: 0,
      checked: 0,
      totalLines: 0,
      remaining: 0,
      location: '',
      locationSaved: ''
    };
  }

  kkWarehouseLabel(warehouse: KkWarehouse | string): string {
    if (warehouse === '00') return '00';
    if (warehouse === 'J5') return 'J5';
    if (warehouse === 'ASM3') return 'ASM3 / WH3';
    return 'D1';
  }

  /** Kho theo vị trí: 00- → 00; J5- → J5; ASM3/WH3 → kho tạm; còn lại = D1. */
  kkWarehouseFromLocation(location: string | null | undefined): KkWarehouse {
    const tokens = splitMultiLocations(String(location || ''));
    const first = (tokens[0] || String(location || '')).trim().toUpperCase();
    if (!first) return 'D1';
    if (first === '00' || first.startsWith('00-') || first.startsWith('00+')) return '00';
    if (first.startsWith('J5-')) return 'J5';
    if (isAsm3OrWh3PrefixLocation(first)) return 'ASM3';
    return 'D1';
  }

  kkMaterialRowKey(row: { materialCode: string; warehouse: string }): string {
    return `${row.warehouse}|${String(row.materialCode || '').trim().toUpperCase()}`;
  }

  isKkMaterialExpanded(row: KkLocMaterialRow): boolean {
    return this.kkLocMapExpandedKey === this.kkMaterialRowKey(row);
  }

  toggleKkMaterialExpand(row: KkLocMaterialRow, event?: Event): void {
    event?.stopPropagation();
    const key = this.kkMaterialRowKey(row);
    this.kkLocMapExpandedKey = this.kkLocMapExpandedKey === key ? null : key;
  }

  kkMaterialDetailLines(row: KkLocMaterialRow): InventoryMaterial[] {
    const list = this.kkLocMapMaterialCache.get(this.kkMaterialRowKey(row)) || [];
    return list
      .filter((m) => this.calculateCurrentStock(m) > 0)
      .sort((a, b) => {
        const po = String(a.poNumber || '').localeCompare(String(b.poNumber || ''), 'en', { numeric: true });
        if (po) return po;
        return this.getDisplayIMD(a).localeCompare(this.getDisplayIMD(b), 'en', { numeric: true });
      });
  }

  private kkLinesForRow(row: KkLocMaterialRow): InventoryMaterial[] {
    return (this.kkLocMapMaterialCache.get(this.kkMaterialRowKey(row)) || []).filter((m) => !!m.id);
  }

  onKkMaterialRowClick(row: { materialCode: string; warehouse: string }): void {
    this.toggleKkMaterialExpand(row as KkLocMaterialRow);
  }

  private palletSummaryOf(list: InventoryMaterial[]): { palletId: string; palletMixed: boolean } {
    const ids = Array.from(
      new Set(
        list
          .map((m) => String(m.palletId || '').trim().toUpperCase())
          .filter(Boolean)
      )
    );
    if (ids.length === 1) return { palletId: ids[0], palletMixed: false };
    if (ids.length === 0) return { palletId: '', palletMixed: false };
    return { palletId: '', palletMixed: true };
  }

  private kkLinesForMaterialCode(materialCode: string): InventoryMaterial[] {
    const code = String(materialCode || '').trim().toUpperCase();
    const rows: InventoryMaterial[] = [];
    this.kkLocMapMaterialCache.forEach((list, key) => {
      if (key.endsWith(`|${code}`)) {
        rows.push(...list);
      }
    });
    return rows;
  }

  private syncKkMaterialRows(materialCode: string): void {
    const code = String(materialCode || '').trim().toUpperCase();
    this.kkLocMapByMaterial = this.kkLocMapByMaterial.map((row) => {
      if (row.materialCode !== code) return row;
      const key = `${row.warehouse}|${code}`;
      const list = this.kkLocMapMaterialCache.get(key) || [];
      const checked = list.filter((m) => this.isKkFlagOn(m.kkChecked)).length;
      return {
        ...row,
        checked,
        remaining: Math.max(0, row.totalLines - checked)
      };
    });
  }

  /** Tick KK theo mã hàng — ghi tất cả dòng cùng mã (mọi kho trong factory đang xem). */
  async onKkByMaterialTick(row: KkLocMaterialRow, checked: boolean): Promise<void> {
    if (!this.canEdit || this.kkLocMapBusy) {
      this.cdr.detectChanges();
      return;
    }
    const next = !!checked;
    const lines = this.kkLinesForMaterialCode(row.materialCode).filter((m) => !!m.id);
    const targets = lines.filter((m) => this.isKkFlagOn(m.kkChecked) !== next);
    if (!targets.length) {
      this.syncKkMaterialRows(row.materialCode);
      this.cdr.detectChanges();
      return;
    }
    if (!next) {
      const ok = confirm(`Bỏ tick KK mọi dòng mã ${row.materialCode}?\n(${targets.length} dòng)`);
      if (!ok) {
        this.cdr.detectChanges();
        return;
      }
    }
    const operator = next
      ? await this.resolveKkOperatorId()
      : await this.resolveKkOperatorFromSession();
    if (!operator) {
      this.cdr.detectChanges();
      return;
    }

    this.kkLocMapBusy = true;
    this.cdr.detectChanges();
    const kkAt = new Date();
    try {
      const chunkSize = 400;
      for (let i = 0; i < targets.length; i += chunkSize) {
        const chunk = targets.slice(i, i + chunkSize);
        const batch = this.firestore.firestore.batch();
        for (const m of chunk) {
          batch.update(this.firestore.collection('inventory-materials').doc(m.id!).ref, {
            kkChecked: next,
            kkBy: operator,
            kkAt,
            updatedAt: new Date(),
            ...(next ? {} : { kkScanCount: 0 })
          });
        }
        await batch.commit();
        if (next) {
          const histBatch = this.firestore.firestore.batch();
          for (const m of chunk) {
            histBatch.set(this.firestore.collection('inventory-kk-history').doc().ref, {
              inventoryDocId: m.id,
              factory: this.resolveKkFactoryForMaterial(m),
              materialCode: String(m.materialCode || '').trim().toUpperCase(),
              materialName: String(m.materialName || '').trim(),
              poNumber: String(m.poNumber || '').trim(),
              batchNumber: String(m.batchNumber || '').trim(),
              location: String(m.location || '').trim().toUpperCase(),
              quantity: Number(m.quantity) || 0,
              stock: Number(this.calculateCurrentStock(m)) || 0,
              unit: String(m.unit || '').trim(),
              checkedBy: operator,
              checkedAt: kkAt,
              checkedDateKey: this.toDateKey(kkAt),
              createdAt: new Date()
            });
          }
          await histBatch.commit();
        }
      }
      for (const m of targets) {
        m.kkChecked = next;
        m.kkBy = operator;
        m.kkAt = kkAt;
        if (!next) m.kkScanCount = 0;
      }
      this.invalidateKkInvSnapCache();
      this.syncKkMaterialRows(row.materialCode);
    } catch (e) {
      console.error('❌ onKkByMaterialTick:', e);
      alert('❌ Không lưu được tick KK theo mã hàng.');
    } finally {
      this.kkLocMapBusy = false;
      this.cdr.detectChanges();
    }
  }

  onKkMaterialPalletEnter(row: KkLocMaterialRow, event: Event): void {
    (event.target as HTMLInputElement | null)?.blur();
  }

  /** Nhập pallet trên dòng theo mã — ghi mọi dòng cùng mã hàng. */
  async saveKkMaterialPallet(row: KkLocMaterialRow): Promise<void> {
    if (!this.canEdit || this.kkLocMapBusy) return;
    const next = String(row.palletId || '').trim().toUpperCase();
    row.palletId = next;
    if (row.palletMixed && !next) return;
    if (next === row.palletSaved && !row.palletMixed) return;

    const lines = this.kkLinesForRow(row);
    if (!lines.length) return;

    this.kkLocMapBusy = true;
    this.cdr.detectChanges();
    try {
      const modifiedBy = await this.resolveLocationOperatorId();
      const chunkSize = 400;
      for (let i = 0; i < lines.length; i += chunkSize) {
        const chunk = lines.slice(i, i + chunkSize);
        const batch = this.firestore.firestore.batch();
        for (const m of chunk) {
          batch.update(this.firestore.collection('inventory-materials').doc(m.id!).ref, {
            palletId: next,
            updatedAt: new Date(),
            lastModified: firebase.default.firestore.FieldValue.serverTimestamp(),
            modifiedBy
          });
        }
        await batch.commit();
      }
      for (const m of lines) {
        m.palletId = next;
        (m as { __prevPalletId?: string }).__prevPalletId = next;
      }
      row.palletSaved = next;
      row.palletMixed = false;
    } catch (e) {
      console.error('❌ saveKkMaterialPallet:', e);
      alert('❌ Không lưu được số pallet.');
    } finally {
      this.kkLocMapBusy = false;
      this.cdr.detectChanges();
    }
  }

  onKkMaterialLocationEnter(row: KkLocMaterialRow, event: Event): void {
    (event.target as HTMLInputElement | null)?.blur();
  }

  /** Sửa vị trí ở dòng tổng → ghi tất cả dòng chi tiết (PO/IMD) của mã này. */
  async saveKkMaterialLocation(row: KkLocMaterialRow): Promise<void> {
    if (!this.canEdit || this.kkLocMapBusy) return;
    const next = this.normalizeMultiLocationValue(String(row.location || ''));
    row.location = next;
    if (!next) return;
    if (next === row.locationSaved) return;

    const lines = this.kkLinesForRow(row);
    if (!lines.length) return;

    this.kkLocMapBusy = true;
    this.cdr.detectChanges();
    try {
      const modifiedBy = await this.resolveLocationOperatorId();
      const changedAt = new Date();
      const chunkSize = 400;
      for (let i = 0; i < lines.length; i += chunkSize) {
        const chunk = lines.slice(i, i + chunkSize);
        const batch = this.firestore.firestore.batch();
        for (const m of chunk) {
          const fromLocation = this.normalizeMultiLocationValue(String(m.location || ''));
          const payload: Record<string, unknown> = {
            ...this.inventoryLocationWriteFields(next),
            updatedAt: changedAt,
            lastModified: firebase.default.firestore.FieldValue.serverTimestamp(),
            modifiedBy,
            locationManualOverride: true
          };
          if ((next === 'F62' || next === 'F62TRA') && m.iqcStatus !== 'Pass') {
            payload.iqcStatus = 'Pass';
          }
          batch.update(this.firestore.collection('inventory-materials').doc(m.id!).ref, payload);
          if (fromLocation !== next) {
            batch.set(this.firestore.collection('material-location-history').doc().ref, {
              factory: this.selectedFactory,
              materialId: m.id,
              materialCode: m.materialCode,
              poNumber: m.poNumber || '',
              fromLocation,
              toLocation: next,
              changedBy: modifiedBy,
              changeType: 'kk-material-summary',
              changedAt: firebase.default.firestore.FieldValue.serverTimestamp()
            });
          }
        }
        await batch.commit();
      }
      for (const m of lines) {
        m.location = next;
        if (next === 'F62' || next === 'F62TRA') m.iqcStatus = 'Pass';
        const rowMeta = m as { __prevLocation?: string; __locationAtLoad?: string; locationManualOverride?: boolean };
        rowMeta.__prevLocation = next;
        rowMeta.__locationAtLoad = next;
        rowMeta.locationManualOverride = true;
      }
      row.locationSaved = next;
    } catch (e) {
      console.error('❌ saveKkMaterialLocation:', e);
      alert('❌ Không lưu được vị trí.');
    } finally {
      this.kkLocMapBusy = false;
      this.cdr.detectChanges();
    }
  }

  /** Sửa vị trí 1 dòng chi tiết — không đổi ô vị trí ở dòng tổng. */
  async saveKkDetailLocation(line: InventoryMaterial): Promise<void> {
    if (!this.canEdit || this.kkLocMapBusy || !line?.id) return;
    await this.persistLocationChange(line, { silent: true, bypassUnlock: true, allowEmpty: true });
    this.invalidateKkTypeViewCache();
  }

  /** Sửa pallet 1 dòng chi tiết — không đổi ô pallet ở dòng tổng. */
  async saveKkDetailPallet(line: InventoryMaterial): Promise<void> {
    if (!this.canEdit || this.kkLocMapBusy || !line?.id) return;
    await this.persistPalletChange(line, String(line.palletId || ''), { silent: true, bypassUnlock: true });
    this.invalidateKkTypeViewCache();
  }

  /** Đổi số pallet: nhập pallet hiện tại → pallet mới, áp cho loại hàng đang mở. */
  async renameKkTypePallet(row: KkTypeRow): Promise<void> {
    if (!this.canEdit || this.kkLocMapBusy || !row) return;
    const fromRaw = window.prompt('Nhập số pallet hiện tại:');
    if (fromRaw == null) return;
    const from = String(fromRaw).trim().toUpperCase();
    if (!from) {
      alert('Chưa nhập số pallet hiện tại.');
      return;
    }

    const toRaw = window.prompt('Nhập số pallet mới:');
    if (toRaw == null) return;
    const to = String(toRaw).trim().toUpperCase();
    if (!to) {
      alert('Chưa nhập số pallet mới.');
      return;
    }
    if (from === to) {
      alert('Số pallet không đổi.');
      return;
    }

    const lines = this.kkLinesForTypeRow(row).filter(
      (m) => String(m.palletId || '').trim().toUpperCase() === from && !!m.id
    );
    if (!lines.length) {
      alert(`Không có dòng pallet ${from} trong loại hàng này.`);
      return;
    }
    if (!confirm(`Đổi pallet ${from} → ${to}?\n${lines.length} dòng loại ${row.productType}`)) return;

    this.kkLocMapBusy = true;
    this.cdr.detectChanges();
    try {
      const modifiedBy = await this.resolveLocationOperatorId();
      const chunkSize = 400;
      for (let i = 0; i < lines.length; i += chunkSize) {
        const chunk = lines.slice(i, i + chunkSize);
        const batch = this.firestore.firestore.batch();
        for (const m of chunk) {
          batch.update(this.firestore.collection('inventory-materials').doc(m.id!).ref, {
            palletId: to,
            updatedAt: new Date(),
            lastModified: firebase.default.firestore.FieldValue.serverTimestamp(),
            modifiedBy
          });
        }
        await batch.commit();
      }
      const ids = new Set(lines.map((m) => m.id));
      const stamp = (m: InventoryMaterial) => {
        if (!ids.has(m.id)) return;
        m.palletId = to;
        (m as { __prevPalletId?: string }).__prevPalletId = to;
      };
      this.kkLocMapTypeCache.forEach((list) => list.forEach(stamp));
      this.kkLocMapMaterialCache.forEach((list) => list.forEach(stamp));
      alert(`✅ Đã đổi pallet ${from} → ${to} (${lines.length} dòng).`);
    } catch (e) {
      console.error('❌ renameKkTypePallet:', e);
      alert('❌ Không đổi được số pallet.');
    } finally {
      this.kkLocMapBusy = false;
      this.cdr.detectChanges();
    }
  }

  kkTypePalletLabelName(row: KkTypeRow | null): string {
    if (!row) return '';
    const codes = this.kkTypeUniqueMaterialCodes(row);
    if (codes.length === 1) {
      const code = codes[0];
      const prefix = this.kkTypeCodePrefix(code);
      const abbr = this.kkTypeCustomerAbbr(this.nvlkhCustomerMap.get(code) || this.getCustomerForMaterial({ materialCode: code } as InventoryMaterial));
      if (prefix && abbr) return `${prefix}-${abbr}`;
      return code;
    }
    return String(row.productType || '').trim();
  }

  private kkTypeUniqueMaterialCodes(row: KkTypeRow): string[] {
    const set = new Set<string>();
    const lines = this.kkActiveProductType === row.productType
      ? this.kkTypeDetailAll
      : this.kkLinesForTypeRow(row).filter((m) => this.calculateCurrentStock(m) > 0);
    for (const m of lines) {
      const code = String(m.materialCode || '').trim().toUpperCase();
      if (code) set.add(code);
    }
    return Array.from(set);
  }

  private kkTypeCodePrefix(code: string): string {
    const c = String(code || '').replace(/\s/g, '').toUpperCase();
    const m = /^([ABR]\d{3})/.exec(c);
    return m ? m[1] : (c.length >= 4 ? c.slice(0, 4) : c);
  }

  private kkTypeCustomerAbbr(customer: string): string {
    const s = String(customer || '').trim();
    if (!s || /^shared$/i.test(s)) return '';
    const first = (s.split(/[\s/_-]+/).filter(Boolean)[0] || s).trim();
    return first.slice(0, 8).toUpperCase();
  }

  async printKkTypePalletLabel(row: KkTypeRow): Promise<void> {
    if (!row || this.kkTypePrintBusy) return;
    try {
      if (!this.nvlkhCustomerMap.size) {
        this.nvlkhCustomerMap = await this.nvlkhCatalog.loadAllAsMap();
      }
    } catch {
      /* in vẫn được nếu không có khách hàng */
    }
    const name = this.kkTypePalletLabelName(row);
    if (!name) {
      alert('Chưa có tên pallet để in.');
      return;
    }
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Trình duyệt chặn cửa sổ in. Cho phép popup và thử lại.');
      return;
    }
    this.kkTypePrintBusy = true;
    this.cdr.detectChanges();
    try {
      const QRCode = await import('qrcode') as any;
      const qrDataUrl = await QRCode.toDataURL(name, {
        width: 640,
        margin: 1,
        color: { dark: '#000000', light: '#FFFFFF' }
      });
      const esc = (s: string) => this.escapeHtmlForPrint(s);
      const typeName = String(row.productType || '').trim();
      printWindow.document.open();
      printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${esc(name)}</title>
  <style>
    @page { size: 100mm 100mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100mm;
      height: 100mm;
      font-family: Arial, Helvetica, sans-serif;
      color: #000;
      background: #fff;
    }
    .label {
      width: 100mm;
      height: 100mm;
      padding: 5mm 4mm 4mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
    }
    .name {
      font-size: ${name.length > 14 ? '16pt' : '22pt'};
      font-weight: 800;
      letter-spacing: 0.4px;
      text-align: center;
      line-height: 1.15;
      word-break: break-word;
      max-width: 92mm;
    }
    .qr img {
      width: 58mm;
      height: 58mm;
      display: block;
    }
    .meta {
      font-size: 8pt;
      font-weight: 700;
      text-align: center;
      color: #222;
    }
  </style>
</head>
<body>
  <div class="label">
    <div class="name">${esc(name)}</div>
    <div class="qr"><img src="${qrDataUrl}" alt="QR"></div>
    <div class="meta">${esc(typeName && typeName !== name ? typeName : 'Pallet label')} · ${esc(this.selectedFactory)}</div>
  </div>
  <script>
    window.onload = function() { setTimeout(function() { window.print(); }, 250); };
  </script>
</body>
</html>`);
      printWindow.document.close();
    } catch (e) {
      console.error('❌ printKkTypePalletLabel:', e);
      try { printWindow.close(); } catch { /* ignore */ }
      alert('Không in được tem pallet.');
    } finally {
      this.kkTypePrintBusy = false;
      this.cdr.detectChanges();
    }
  }

  openKkTypeScanModal(row?: KkTypeRow): void {
    if (!this.canEdit || this.kkLocMapBusy) return;
    if (row && !row.totalLines) return;
    this.showKkTypeScanModal = true;
    this.kkTypeScanOperator = this.kkOperatorIdCache || '';
    this.kkTypeScanOperatorInput = this.kkTypeScanOperator;
    this.kkTypeScanStep = this.kkTypeScanOperator ? 'pallet' : 'operator';
    this.kkTypeScanPallet = '';
    this.kkTypeScanPalletInput = '';
    this.kkTypeScanQrInput = '';
    this.kkTypeScanBusy = false;
    this.kkTypeScanMaterialCode = '';
    this.kkTypeScanStandardDraft = '';
    this.kkTypeScanOkCount = 0;
    this.kkTypeScanSkipCount = 0;
    this.kkTypeScanMissCount = 0;
    this.kkTypeScanLogs = [];
    this.cdr.detectChanges();
    setTimeout(() => this.focusKkTypeScanInput(
      this.kkTypeScanStep === 'operator' ? 'kkTypeScanOperatorInput' : 'kkTypeScanPalletInput'
    ), 80);
  }

  closeKkTypeScanModal(): void {
    if (this.kkTypeScanBusy) return;
    this.showKkTypeScanModal = false;
    this.kkTypeScanStep = 'pallet';
    this.kkTypeScanPallet = '';
    this.kkTypeScanPalletInput = '';
    this.kkTypeScanQrInput = '';
    this.kkTypeScanMaterialCode = '';
    this.kkTypeScanStandardDraft = '';
    this.kkTypeScanLogs = [];
  }

  submitKkTypeScanOperator(event?: Event): void {
    event?.preventDefault?.();
    const el = (event?.target as HTMLInputElement | undefined)
      || (document.getElementById('kkTypeScanOperatorInput') as HTMLInputElement | null);
    const raw = String(el?.value ?? this.kkTypeScanOperatorInput ?? '')
      .replace(/[\r\n\t]+/g, '')
      .replace(/[\u0000-\u001F]/g, '')
      .trim()
      .toUpperCase();
    const shortCode = /^\d{4}$/.test(raw) ? `ASP${raw}` : raw.slice(0, 7);
    if (!/^ASP\d{4}$/.test(shortCode)) {
      alert('Mã nhân viên không đúng. Nhập 4 số (vd: 0106) hoặc quét ASP + 4 số.');
      this.focusKkTypeScanInput('kkTypeScanOperatorInput');
      return;
    }
    this.kkOperatorIdCache = shortCode;
    this.kkTypeScanOperator = shortCode;
    this.kkTypeScanOperatorInput = shortCode;
    this.kkTypeScanStep = 'pallet';
    this.cdr.detectChanges();
    this.focusKkTypeScanInput('kkTypeScanPalletInput');
  }

  private focusKkTypeScanInput(id: string, retry = 0): void {
    if (!this.showKkTypeScanModal) return;
    setTimeout(() => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el && !el.disabled) {
        el.focus();
        return;
      }
      if (retry < 8) this.focusKkTypeScanInput(id, retry + 1);
    }, retry === 0 ? 0 : 50);
  }

  onKkTypeScanNewline(kind: 'operator' | 'pallet' | 'code', event: Event): void {
    const el = event.target as HTMLInputElement | undefined;
    const raw = String(el?.value || '');
    if (!/[\r\n]/.test(raw)) return;
    const cleaned = raw.replace(/[\r\n]+/g, '').trim();
    if (kind === 'operator') this.kkTypeScanOperatorInput = cleaned;
    else if (kind === 'pallet') this.kkTypeScanPalletInput = cleaned;
    else this.kkTypeScanQrInput = cleaned;
    if (el) el.value = cleaned;
    if (kind === 'operator') this.submitKkTypeScanOperator(event);
    else if (kind === 'pallet') this.submitKkTypeScanPallet(event);
    else void this.submitKkTypeScanCode(event);
  }

  kkTypeScanPalletLines(): InventoryMaterial[] {
    const pallet = this.kkTypeScanPallet;
    if (!pallet) return [];
    return this.kkScanScopeLines().filter(
      (m) => String(m.palletId || '').trim().toUpperCase() === pallet && !!m.id
    );
  }

  submitKkTypeScanPallet(event?: Event): void {
    event?.preventDefault?.();
    const el = (event?.target as HTMLInputElement | undefined)
      || (document.getElementById('kkTypeScanPalletInput') as HTMLInputElement | null);
    const raw = String(el?.value ?? this.kkTypeScanPalletInput ?? '')
      .replace(/[\r\n\t]+/g, '')
      .replace(/[\u0000-\u001F]/g, '')
      .trim();
    const pallet = this.normalizeGanPalletCode(raw);
    if (!pallet) {
      alert('⚠️ Vui lòng scan số pallet');
      return;
    }
    this.kkTypeScanPallet = pallet;
    this.kkTypeScanPalletInput = pallet;
    this.kkTypeScanStep = 'codes';
    this.kkTypeScanQrInput = '';
    this.kkTypeScanMaterialCode = '';
    this.kkTypeScanStandardDraft = '';
    this.cdr.detectChanges();
    this.focusKkTypeScanInput('kkTypeScanQrInput');
    this.kkTypeScanBeep('ready');
  }

  backKkTypeScanToPallet(): void {
    this.kkTypeScanStep = 'pallet';
    this.kkTypeScanQrInput = '';
    this.kkTypeScanMaterialCode = '';
    this.kkTypeScanStandardDraft = '';
    this.cdr.detectChanges();
    this.focusKkTypeScanInput('kkTypeScanPalletInput');
  }

  private kkTypeScanPoMatch(a: string, b: string): boolean {
    const x = String(a || '').trim().replace(/\s+/g, '');
    const y = String(b || '').trim().replace(/\s+/g, '');
    if (!y) return false;
    return x === y;
  }

  private kkTypeScanImdMatch(scanned: string, inventory: string): boolean {
    const a = String(scanned || '').trim();
    const b = String(inventory || '').trim();
    if (!a || a === 'N/A') return false;
    if (!b || b === 'N/A') return false;
    if (a === b) return true;
    return a.startsWith(b) || b.startsWith(a);
  }

  private pushKkTypeScanLog(ok: boolean, text: string, skip = false): void {
    this.kkTypeScanLogs = [{ ok, skip, text }, ...this.kkTypeScanLogs].slice(0, 20);
    if (ok) this.kkTypeScanOkCount += 1;
    else if (skip) this.kkTypeScanSkipCount += 1;
    else this.kkTypeScanMissCount += 1;
  }

  private kkTypeScanBeep(kind: 'ready' | 'ok' | 'err'): void {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = kind === 'err' ? 220 : kind === 'ok' ? 880 : 660;
      gain.gain.value = 0.08;
      osc.start();
      osc.stop(ctx.currentTime + (kind === 'ready' ? 0.12 : 0.08));
      osc.onended = () => ctx.close();
    } catch {
      /* ignore audio */
    }
  }

  private readKkTypeScanInput(id: string, fallback: string, event?: Event): string {
    const el = (event?.target as HTMLInputElement | undefined)
      || (document.getElementById(id) as HTMLInputElement | null);
    return String(el?.value ?? fallback ?? '')
      .replace(/[\r\n\t]+/g, '')
      .replace(/[\u0000-\u001F]/g, '')
      .trim();
  }

  async submitKkTypeScanCode(event?: Event): Promise<void> {
    event?.preventDefault?.();
    if (this.kkTypeScanStep !== 'codes' || this.kkTypeScanBusy) return;
    const raw = this.readKkTypeScanInput('kkTypeScanQrInput', this.kkTypeScanQrInput, event);
    this.kkTypeScanQrInput = '';
    const inputEl = document.getElementById('kkTypeScanQrInput') as HTMLInputElement | null;
    if (inputEl) inputEl.value = '';
    if (!raw) return;

    if (!raw.includes('|') && /^[PF]/i.test(raw)) {
      this.kkTypeScanPalletInput = raw;
      this.submitKkTypeScanPallet();
      return;
    }

    const parsed = this.parseInboundQrLabelDisplayFields(raw);
    const code = String(parsed.materialCode || raw || '').trim().toUpperCase();
    if (!code) {
      this.pushKkTypeScanLog(false, 'QR thiếu mã hàng');
      this.kkTypeScanBeep('err');
      this.cdr.detectChanges();
      this.focusKkTypeScanInput('kkTypeScanQrInput');
      return;
    }

    if (!this.kkTypeScanPallet) {
      this.pushKkTypeScanLog(false, 'Chưa lưu số pallet');
      this.kkTypeScanStep = 'pallet';
      this.cdr.detectChanges();
      this.focusKkTypeScanInput('kkTypeScanPalletInput');
      return;
    }

    this.kkTypeScanMaterialCode = code;
    const lines = this.kkTypeScanCodeRows;
    const first = lines[0];
    this.kkTypeScanStandardDraft = first ? (this.getEffectiveStandardPacking(first) || '') : '';
    if (!lines.length) {
      this.pushKkTypeScanLog(false, `${code} — không có dòng tồn`);
      this.kkTypeScanBeep('err');
    } else {
      this.pushKkTypeScanLog(true, `${code} · ${lines.length} dòng · ${this.kkTypeScanCodeRollsTotal} cuộn`);
      this.kkTypeScanBeep('ok');
    }
    this.cdr.detectChanges();
    this.focusKkTypeScanInput('kkTypeScanQrInput');
  }

  get kkTypeScanCodeRows(): InventoryMaterial[] {
    const code = this.kkTypeScanMaterialCode;
    if (!code) return [];
    return this.kkScanScopeLines()
      .filter((m) =>
        String(m.materialCode || '').trim().toUpperCase() === code &&
        this.calculateCurrentStock(m) > 0
      )
      .sort((a, b) => {
        const po = String(a.poNumber || '').localeCompare(String(b.poNumber || ''), 'en', { numeric: true });
        if (po) return po;
        return String(this.getDisplayIMD(a) || '').localeCompare(String(this.getDisplayIMD(b) || ''), 'en', { numeric: true });
      });
  }

  get kkTypeScanCodeRollsTotal(): number {
    return this.kkTypeScanCodeRows.reduce((sum, m) => sum + this.getKkRollsCount(m), 0);
  }

  get kkTypeScanAllTicked(): boolean {
    const rows = this.kkTypeScanCodeRows;
    return !!rows.length && rows.every((m) => this.isKkFlagOn(m.kkChecked));
  }

  async saveKkTypeScanStandard(): Promise<void> {
    const first = this.kkTypeScanCodeRows[0];
    if (!first) return;
    first.standardPacking = Math.max(0, Number(this.kkTypeScanStandardDraft) || 0);
    await this.saveKkTypeStandard(first);
    this.kkTypeScanStandardDraft = this.getEffectiveStandardPacking(first) || '';
    this.cdr.detectChanges();
  }

  async onKkTypeScanTickAll(checked: boolean): Promise<void> {
    const rows = this.kkTypeScanCodeRows;
    if (!rows.length) return;
    await this.applyKkTypeScanTick(rows, !!checked);
  }

  async onKkTypeScanRowTick(line: InventoryMaterial, checked: boolean): Promise<void> {
    if (!line) return;
    await this.applyKkTypeScanTick([line], !!checked);
  }

  private async applyKkTypeScanTick(lines: InventoryMaterial[], checked: boolean): Promise<void> {
    if (!this.canEdit || this.kkTypeScanBusy) return;
    const next = !!checked;
    const pallet = this.kkTypeScanPallet;
    const targets = lines.filter((m) => !!m?.id && (
      this.isKkFlagOn(m.kkChecked) !== next ||
      (!!pallet && String(m.palletId || '').trim().toUpperCase() !== pallet)
    ));
    if (!targets.length) {
      this.cdr.detectChanges();
      return;
    }
    if (!next) {
      const ok = confirm(targets.length > 1
        ? `Bỏ tick KK ${targets.length} dòng mã ${this.kkTypeScanMaterialCode}?`
        : `Bỏ tick KK mã ${this.kkTypeScanMaterialCode}?`);
      if (!ok) {
        this.cdr.detectChanges();
        return;
      }
    }
    const operator = next
      ? (this.kkTypeScanOperator || this.kkOperatorIdCache || await this.resolveKkOperatorId())
      : await this.resolveKkOperatorFromSession();
    if (!operator) {
      if (next && !this.kkTypeScanOperator) {
        this.kkTypeScanStep = 'operator';
        this.cdr.detectChanges();
        this.focusKkTypeScanInput('kkTypeScanOperatorInput');
      }
      return;
    }
    this.kkTypeScanOperator = operator;
    this.kkOperatorIdCache = operator;

    this.kkTypeScanBusy = true;
    this.cdr.detectChanges();
    const kkAt = new Date();
    try {
      const chunkSize = 400;
      for (let i = 0; i < targets.length; i += chunkSize) {
        const chunk = targets.slice(i, i + chunkSize);
        const batch = this.firestore.firestore.batch();
        for (const m of chunk) {
          const payload: Record<string, unknown> = {
            kkChecked: next,
            kkBy: operator,
            kkAt,
            updatedAt: new Date(),
            lastModified: firebase.default.firestore.FieldValue.serverTimestamp(),
            modifiedBy: operator
          };
          if (pallet) payload.palletId = pallet;
          if (!next) payload.kkScanCount = 0;
          batch.update(this.firestore.collection('inventory-materials').doc(m.id!).ref, payload);
        }
        await batch.commit();
        if (next) {
          const histBatch = this.firestore.firestore.batch();
          for (const m of chunk) {
            histBatch.set(this.firestore.collection('inventory-kk-history').doc().ref, {
              inventoryDocId: m.id,
              factory: this.resolveKkFactoryForMaterial(m),
              materialCode: String(m.materialCode || '').trim().toUpperCase(),
              materialName: String(m.materialName || '').trim(),
              poNumber: String(m.poNumber || '').trim(),
              batchNumber: String(m.batchNumber || '').trim(),
              location: String(m.location || '').trim().toUpperCase(),
              palletId: pallet || String(m.palletId || '').trim(),
              quantity: Number(m.quantity) || 0,
              stock: Number(this.calculateCurrentStock(m)) || 0,
              unit: String(m.unit || '').trim(),
              checkedBy: operator,
              checkedAt: kkAt,
              checkedDateKey: this.toDateKey(kkAt),
              createdAt: new Date(),
              source: 'kk-type-scan'
            });
          }
          await histBatch.commit();
        }
      }
      for (const m of targets) {
        m.kkChecked = next;
        m.kkBy = operator;
        m.kkAt = kkAt;
        if (pallet) {
          m.palletId = pallet;
          (m as { __prevPalletId?: string }).__prevPalletId = pallet;
        }
        if (!next) m.kkScanCount = 0;
        const stamp = (x: InventoryMaterial) => {
          if (x.id !== m.id) return;
          x.kkChecked = next;
          x.kkBy = operator;
          x.kkAt = kkAt;
          if (pallet) {
            x.palletId = pallet;
            (x as { __prevPalletId?: string }).__prevPalletId = pallet;
          }
          if (!next) x.kkScanCount = 0;
        };
        this.kkLocMapTypeCache.forEach((list) => list.forEach(stamp));
        this.kkLocMapMaterialCache.forEach((list) => list.forEach(stamp));
      }
      this.invalidateKkInvSnapCache();
      this.syncKkTypeRows();
      this.pushKkTypeScanLog(true, next
        ? `KK ${targets.length} dòng ${this.kkTypeScanMaterialCode}${pallet ? ` · pallet ${pallet}` : ''}`
        : `Bỏ KK ${targets.length} dòng ${this.kkTypeScanMaterialCode}`);
      this.kkTypeScanBeep('ok');
    } catch (e) {
      console.error('❌ applyKkTypeScanTick:', e);
      this.pushKkTypeScanLog(false, 'Không lưu được tick KK');
      this.kkTypeScanBeep('err');
      alert('❌ Không lưu được tick KK.');
    } finally {
      this.kkTypeScanBusy = false;
      this.cdr.detectChanges();
      this.focusKkTypeScanInput('kkTypeScanQrInput');
    }
  }

  kkLineWhValue(line: InventoryMaterial): '' | '00' | 'J5' | 'ASM3' {
    const tag = this.locationWhTag(line.location);
    return tag === 'J5' || tag === 'ASM3' || tag === '00' ? tag : '';
  }

  async saveKkDetailWarehouse(line: InventoryMaterial, value: string): Promise<void> {
    if (!this.canEdit || this.kkLocMapBusy || !line?.id) return;
    await this.commitWhChange(line, value, { silent: true, bypassUnlock: true });
    this.syncKkMaterialRows(String(line.materialCode || '').trim().toUpperCase());
    this.syncKkTypeRows();
    this.cdr.detectChanges();
  }

  getKkMaterialName(material: InventoryMaterial): string {
    const code = String(material?.materialCode || '').trim().toUpperCase();
    if (!code) return '—';
    const cat = this.catalogCache.get(code) || this.catalogCache.get(material.materialCode);
    const catName = String(cat?.materialName || '').trim();
    if (catName) return catName;
    const rowName = String(material.materialName || '').trim();
    if (rowName && rowName.toUpperCase() !== code) return rowName;
    const inboundName = this.inboundNameCache.get(code);
    if (inboundName) return inboundName;
    return '—';
  }

  getKkRollsText(material: InventoryMaterial): string {
    const b = this.getKkStockBreakdown(material, this.getEffectiveStandardPacking(material));
    if (!b.sp) return '—';
    if (b.bagCount <= 0) return '0';
    if (b.oddBags) return `${b.fullCount}+1`;
    return String(b.fullCount);
  }

  getKkRollsCount(material: InventoryMaterial): number {
    const b = this.getKkStockBreakdown(material, this.getEffectiveStandardPacking(material));
    return Number(b.bagCount) || 0;
  }

  private kkLineIdentityKey(material: InventoryMaterial): string {
    const code = String(material?.materialCode || '').trim().toUpperCase();
    const po = String(material?.poNumber || '').trim().replace(/\s+/g, '').toUpperCase();
    const imd = String(this.getDisplayIMD(material) || '').trim().toUpperCase();
    return `${code}|${po}|${imd}`;
  }

  /** Cùng mã + PO + IMD ở ≥ 2 pallet: "P001: 5 cuộn · P002: 3 cuộn". */
  getKkTypePalletNote(material: InventoryMaterial): string {
    const key = this.kkLineIdentityKey(material);
    if (!key || key.startsWith('|')) return '';
    return this.kkTypePalletNoteMap.get(key) || '';
  }

  get kkTypePalletNoteMap(): Map<string, string> {
    const sig = [
      this.kkTypeCacheRev,
      this.kkActiveProductType || '',
      this.kkLocMapWarehouseFilter,
      this.kkCountWh3 ? 1 : 0,
      this.kkWh3Only ? 1 : 0
    ].join('|');
    if (sig !== this.kkTypePalletNotesSig) {
      this.kkTypePalletNotesSig = sig;
      this.kkTypePalletNotesCached = this.buildKkTypePalletNoteMap();
    }
    return this.kkTypePalletNotesCached;
  }

  private buildKkTypePalletNoteMap(): Map<string, string> {
    const byKey = new Map<string, Map<string, number>>();
    const lists = this.kkActiveProductType
      ? [this.kkLocMapTypeCache.get(this.kkActiveProductType) || []]
      : [];
    for (const list of lists) {
      for (const m of list) {
        if (this.calculateCurrentStock(m) <= 0) continue;
        const key = this.kkLineIdentityKey(m);
        if (!key || key.startsWith('|')) continue;
        const pallet = String(m.palletId || '').trim().toUpperCase() || '—';
        const rolls = this.getKkRollsCount(m);
        let palMap = byKey.get(key);
        if (!palMap) {
          palMap = new Map<string, number>();
          byKey.set(key, palMap);
        }
        palMap.set(pallet, (palMap.get(pallet) || 0) + rolls);
      }
    }
    const notes = new Map<string, string>();
    byKey.forEach((palMap, key) => {
      if (palMap.size < 2) return;
      const text = Array.from(palMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))
        .map(([pallet, rolls]) => `${pallet}: ${rolls} cuộn`)
        .join(' · ');
      notes.set(key, text);
    });
    return notes;
  }

  getKkScanCount(material: InventoryMaterial): number {
    return Math.max(0, Number(material?.kkScanCount) || 0);
  }

  private parseKkScanQty(raw: string): number {
    const n = Number(String(raw || '').replace(/,/g, '').trim());
    if (!Number.isFinite(n) || n <= 0) return 0;
    return this.roundKkQty(n);
  }

  private roundKkQty(n: number): number {
    return Math.round(n * 1e6) / 1e6;
  }

  kkScanStockTone(material: InventoryMaterial): '' | 'ok' | 'low' | 'over' {
    const scanned = this.getKkScanCount(material);
    if (scanned <= 0) return '';
    const stock = this.calculateCurrentStock(material);
    const d = scanned - stock;
    if (Math.abs(d) < 1e-6) return 'ok';
    return d < 0 ? 'low' : 'over';
  }

  getKkScanCompareTitle(material: InventoryMaterial): string {
    const scanned = this.getKkScanCount(material);
    const stock = this.calculateCurrentStock(material);
    const tone = this.kkScanStockTone(material);
    if (tone === 'ok') return `Đã quét ${this.formatNumber(scanned)} = tồn ${this.formatNumber(stock)}`;
    if (tone === 'low') {
      return `Đã quét ${this.formatNumber(scanned)} / tồn ${this.formatNumber(stock)} — thiếu ${this.formatNumber(stock - scanned)}`;
    }
    if (tone === 'over') {
      return `Đã quét ${this.formatNumber(scanned)} / tồn ${this.formatNumber(stock)} — thừa ${this.formatNumber(scanned - stock)}`;
    }
    return `Chưa scan · tồn ${this.formatNumber(stock)}`;
  }

  getKkRollsTitle(material: InventoryMaterial): string {
    const b = this.getKkStockBreakdown(material, this.getEffectiveStandardPacking(material));
    if (!b.sp) return 'Chưa có Standard Packing';
    if (b.oddBags) {
      return `${b.fullCount} cuộn chẵn × ${this.formatNumber(b.sp)} + 1 cuộn lẻ ${this.formatNumber(b.oddQty)}`;
    }
    return `${b.fullCount} cuộn × ${this.formatNumber(b.sp)}`;
  }

  private async ensureKkTypeMaterialNames(): Promise<void> {
    try {
      const rows = this.kkTypeDetailAll;
      const codes = [...new Set(
        rows.map((m) => String(m.materialCode || '').trim().toUpperCase()).filter(Boolean)
      )].filter((code) => {
        if (String(this.catalogCache.get(code)?.materialName || '').trim()) return false;
        return !rows.some((m) =>
          String(m.materialCode || '').trim().toUpperCase() === code &&
          String(m.materialName || '').trim() &&
          String(m.materialName || '').trim().toUpperCase() !== code
        );
      });
      if (!codes.length) return;
      await this.ensureCatalogForMaterialCodes(codes);
      this.applyCatalogToMaterials(rows);
      this.cdr.detectChanges();
    } catch (e) {
      console.warn('[KK] ensureKkTypeMaterialNames:', e);
    }
  }

  async saveKkTypeStandard(material: InventoryMaterial): Promise<void> {
    if (!this.canEdit || this.kkLocMapBusy || !material) return;
    const code = String(material.materialCode || '').trim().toUpperCase();
    const sp = Math.max(0, Number(material.standardPacking) || 0);
    if (!code) return;
    const cat = this.catalogCache.get(code);
    const prev = this.getStandardPacking(code) || Number(cat?.standardPacking) || 0;
    if (Math.abs(sp - prev) < 1e-9) {
      this.applyKkStandardToCode(code, sp);
      return;
    }
    this.kkLocMapBusy = true;
    this.cdr.detectChanges();
    try {
      const live = await this.nvlCatalogFull.getByCode(code);
      if (live) {
        this.mergeNvlItemIntoCatalogCache(live);
        this.persistCatalogCache();
        if (live.standardPackingLocked === true) {
          alert('⚠️ Standard Packing của mã này đang Lock trên Danh mục NVL.');
          material.standardPacking = Number(live.standardPacking) || 0;
          this.applyKkStandardToCode(code, Number(live.standardPacking) || 0);
          return;
        }
      }
      const operator = await this.resolveKkOperatorFromSession();
      await this.nvlCatalogFull.update(code, { standardPacking: sp }, operator);
      this.mergeNvlItemIntoCatalogCache({
        materialCode: code,
        standardPacking: sp,
        standardPackingLocked: false,
        materialName: live?.materialName,
        unit: live?.unit,
        isMsd: live?.isMsd,
        isEsd: live?.isEsd
      });
      this.persistCatalogCache();
      this.applyKkStandardToCode(code, sp);
    } catch (e) {
      console.error('❌ saveKkTypeStandard:', e);
      alert('❌ Không lưu được Standard Packing lên danh mục.');
    } finally {
      this.kkLocMapBusy = false;
      this.cdr.detectChanges();
    }
  }

  private applyKkStandardToCode(code: string, sp: number): void {
    const apply = (m: InventoryMaterial) => {
      if (String(m.materialCode || '').trim().toUpperCase() === code) {
        m.standardPacking = sp;
      }
    };
    this.kkLocMapTypeCache.forEach((list) => list.forEach(apply));
    this.inventoryMaterials.forEach(apply);
    this.filteredInventory.forEach(apply);
    this.displayedInventory.forEach(apply);
    this.invalidateKkTypeViewCache();
  }

  async onKkDetailTick(line: InventoryMaterial, checked: boolean): Promise<void> {
    if (!this.canEdit || this.kkLocMapBusy || !line?.id) {
      this.cdr.detectChanges();
      return;
    }
    const wantOn = !!checked;
    if (this.isKkFlagOn(line.kkChecked) === wantOn) return;
    await this.toggleKk(line);
    this.syncKkMaterialRows(String(line.materialCode || '').trim().toUpperCase());
    this.syncKkTypeRows();
    this.cdr.detectChanges();
  }

  /** Nhóm vị trí KK theo chữ cái đầu (A, B, C, D…). */
  kkLocFirstLetter(loc: string): string {
    const raw = String(loc || '').trim().toUpperCase();
    if (!raw || raw === '—') return '#';
    const body = raw.replace(/^(ASM3-|WH3-)/, '');
    const ch = body.charAt(0);
    return ch || '#';
  }

  get kkLocMapGroupedBoxes(): Array<{
    key: string;
    boxes: Array<{ loc: string; checked: number; total: number }>;
    checked: number;
    total: number;
  }> {
    const buckets = new Map<string, Array<{ loc: string; checked: number; total: number }>>();
    for (const box of this.kkLocMapFilteredBoxes) {
      const key = this.kkLocFirstLetter(box.loc);
      const list = buckets.get(key) || [];
      list.push(box);
      buckets.set(key, list);
    }
    return Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))
      .map(([key, boxes]) => {
        boxes.sort((x, y) => x.loc.localeCompare(y.loc, 'en', { numeric: true }));
        return {
          key,
          boxes,
          checked: boxes.reduce((n, b) => n + b.checked, 0),
          total: boxes.reduce((n, b) => n + b.total, 0)
        };
      });
  }

  get kkLocMapSummary(): { checked: number; total: number } {
    return this.kkLocMapBoxes.reduce(
      (acc, b) => ({ checked: acc.checked + b.checked, total: acc.total + b.total }),
      { checked: 0, total: 0 }
    );
  }

  kkLocBoxTone(box: { checked: number; total: number }): string {
    if (!box.total) return 'empty';
    if (box.checked >= box.total) return 'done';
    if (box.checked <= 0) return 'none';
    return 'partial';
  }

  onKkLocBoxClick(box: { loc: string }): void {
    const loc = String(box?.loc || '').trim();
    if (!loc || loc === '—') return;
    const rows = [...(this.kkLocMapRowCache.get(loc) || [])];
    this.closeKkLocMap();
    this.showKkLocMapRows(loc, rows);
  }

  /** Hiện đúng bộ mã đã dùng để đếm ô KK — tồn > 0, chưa KK lên đầu. */
  private showKkLocMapRows(loc: string, rows: InventoryMaterial[]): void {
    this.searchByLocation = true;
    this.searchByCustomer = false;
    this.searchByKk = false;
    this.searchType = 'location';
    this.searchTerm = loc;
    this.showOnlyNegativeStock = false;
    this.inventoryMaterials = rows.map((row) => ({ ...row }));
    this.inventoryMaterials.sort((a, b) => {
      const ak = this.isKkFlagOn(a.kkChecked) ? 1 : 0;
      const bk = this.isKkFlagOn(b.kkChecked) ? 1 : 0;
      if (ak !== bk) return ak - bk;
      const codeCmp = this.compareMaterialCodesFIFO(
        String(a.materialCode || ''),
        String(b.materialCode || '')
      );
      if (codeCmp) return codeCmp;
      return String(a.poNumber || '').localeCompare(String(b.poNumber || ''), 'en', { numeric: true });
    });
    this.filteredInventory = [...this.inventoryMaterials];
    this.currentPage = 1;
    this.updatePagination();
    this.updateDisplayedInventory();
    this.updateNegativeStockCount();
    this.cdr.detectChanges();
    if (this.filteredInventory.length) {
      void this.refreshLastStatusForMaterials(this.filteredInventory);
    }
  }

  private finishKkLocMapLoad(loadId: number): void {
    if (loadId === this.kkLocMapLoadId) {
      this.kkLocMapLoading = false;
      this.kkLocMapBusy = false;
      this.kkLocMapStatus = '';
      this.cdr.detectChanges();
      return;
    }
    if (!this.showKkLocMap) {
      this.kkLocMapLoading = false;
      this.kkLocMapBusy = false;
      this.kkLocMapStatus = '';
    }
  }

  /**
   * `{ docs }` cho các view Sơ đồ KK — đọc qua cache KK theo factory thay vì quét lại
   * 10k doc mỗi lần đổi view. Giữ shape `{ docs }` để các chỗ gọi cũ không phải sửa.
   */
  private async loadKkInventorySnap(force = false): Promise<{ docs: any[] }> {
    const docs = await this.getKkFactoryDocs(this.selectedFactory, force);
    return { docs };
  }

  async loadKkLocMap(): Promise<void> {
    const loadId = ++this.kkLocMapLoadId;
    this.kkLocMapLoading = true;
    this.kkLocMapStatus = `Đang đọc tồn kho ${this.selectedFactory}…`;
    this.kkLocMapBoxes = [];
    this.cdr.detectChanges();
    try {
      const snap = await this.loadKkInventorySnap();
      if (loadId !== this.kkLocMapLoadId) return;

      this.kkLocMapRowCache.clear();
      const byLoc = new Map<string, Map<string, { rows: number; kk: number }>>();
      for (const doc of snap?.docs || []) {
        const data = doc.data() as any;
        if (this.stockFromInventoryDoc(data) <= 0) continue;
        const code = String(data.materialCode || '').trim().toUpperCase();
        if (!code) continue;
        const tokens = splitMultiLocations(String(data.location || data.viTri || ''));
        const groups = tokens.length
          ? [...new Set(tokens.map((t) => this.locationGroupKey(t) || '—'))]
          : ['—'];
        const kkOn = this.isKkFlagOn(data.kkChecked);
        const material = this.mapKkInventoryDoc(doc);
        material.kkChecked = kkOn;
        for (const loc of groups) {
          let codes = byLoc.get(loc);
          if (!codes) {
            codes = new Map();
            byLoc.set(loc, codes);
          }
          const cur = codes.get(code) || { rows: 0, kk: 0 };
          cur.rows += 1;
          if (kkOn) cur.kk += 1;
          codes.set(code, cur);
          const list = this.kkLocMapRowCache.get(loc) || [];
          list.push({ ...material });
          this.kkLocMapRowCache.set(loc, list);
        }
      }

      const boxes = Array.from(byLoc.entries()).map(([loc, codes]) => {
        let checked = 0;
        codes.forEach((v) => {
          if (v.rows > 0 && v.kk >= v.rows) checked += 1;
        });
        return { loc, checked, total: codes.size };
      });

      const known = this.knownLocationGroups;
      boxes.sort((a, b) => {
        const ai = known.indexOf(a.loc);
        const bi = known.indexOf(b.loc);
        if (ai >= 0 || bi >= 0) {
          if (ai < 0) return 1;
          if (bi < 0) return -1;
          return ai - bi;
        }
        if (a.loc === '—') return 1;
        if (b.loc === '—') return -1;
        return a.loc.localeCompare(b.loc, 'en', { numeric: true });
      });

      if (loadId !== this.kkLocMapLoadId) return;
      this.kkLocMapBoxes = boxes;
      this.readTracker.track('materials', 'inventory-materials', snap?.docs?.length || 0);
    } catch (e) {
      if (loadId !== this.kkLocMapLoadId) return;
      console.error('❌ loadKkLocMap:', e);
      this.kkLocMapBoxes = [];
      alert('❌ Không tải được sơ đồ KK theo vị trí.');
    } finally {
      this.finishKkLocMapLoad(loadId);
    }
  }

  async loadKkByMaterial(): Promise<void> {
    const loadId = ++this.kkLocMapLoadId;
    this.kkLocMapLoading = true;
    this.kkLocMapStatus = 'Đang đọc tồn kho theo mã hàng…';
    this.kkLocMapByMaterial = [];
    this.cdr.detectChanges();
    try {
      const snap = await this.loadKkInventorySnap();
      if (loadId !== this.kkLocMapLoadId) return;

      this.kkLocMapMaterialCache.clear();
      const byKey = new Map<string, {
        materialCode: string;
        warehouse: KkWarehouse;
        stock: number;
        checked: number;
        totalLines: number;
      }>();
      for (const doc of snap?.docs || []) {
        const data = doc.data() as any;
        const stock = this.stockFromInventoryDoc(data);
        if (stock <= 0) continue;
        const materialCode = String(data.materialCode || '').trim().toUpperCase();
        if (!materialCode) continue;
        const warehouse = this.kkWarehouseFromLocation(String(data.location || data.viTri || ''));
        const key = `${warehouse}|${materialCode}`;
        const kkOn = this.isKkFlagOn(data.kkChecked);
        const cur = byKey.get(key) || {
          materialCode,
          warehouse,
          stock: 0,
          checked: 0,
          totalLines: 0
        };
        cur.stock += stock;
        cur.totalLines += 1;
        if (kkOn) cur.checked += 1;
        byKey.set(key, cur);
        const material = this.mapKkInventoryDoc(doc);
        material.kkChecked = kkOn;
        const list = this.kkLocMapMaterialCache.get(key) || [];
        list.push(material);
        this.kkLocMapMaterialCache.set(key, list);
      }

      const warehouseOrder: Record<string, number> = { D1: 0, '00': 1, J5: 2, ASM3: 3 };
      this.kkLocMapByMaterial = Array.from(byKey.values())
        .map((v) => {
          const key = `${v.warehouse}|${v.materialCode}`;
          const pallet = this.palletSummaryOf(this.kkLocMapMaterialCache.get(key) || []);
          return {
            ...v,
            remaining: Math.max(0, v.totalLines - v.checked),
            palletId: pallet.palletId,
            palletMixed: pallet.palletMixed,
            palletSaved: pallet.palletId,
            location: '',
            locationSaved: ''
          };
        })
        .sort((a, b) => {
          const codeCmp = a.materialCode.localeCompare(b.materialCode, 'en', { numeric: true });
          if (codeCmp) return codeCmp;
          return (warehouseOrder[a.warehouse] ?? 9) - (warehouseOrder[b.warehouse] ?? 9);
        });
      this.readTracker.track('materials', 'inventory-materials', snap?.docs?.length || 0);
    } catch (e) {
      if (loadId !== this.kkLocMapLoadId) return;
      console.error('❌ loadKkByMaterial:', e);
      this.kkLocMapByMaterial = [];
      alert('❌ Không tải được Kiểm tra KK theo mã hàng.');
    } finally {
      this.finishKkLocMapLoad(loadId);
    }
  }

  private async loadKkCatalogForMap(forceRefresh = false): Promise<void> {
    const loadId = ++this.kkLocMapLoadId;
    this.kkLocMapBusy = true;
    this.kkLocMapStatus = 'Đang tải danh mục KK…';
    if (this.kkLocMapView === 'type') {
      this.kkLocMapLoading = false;
    } else {
      this.kkLocMapLoading = true;
    }
    this.cdr.detectChanges();
    let handedOff = false;
    try {
      this.kkCatalogEntries = await this.kkCatalog.loadAll(forceRefresh);
      this.kkCatalogTypeMap = await this.kkCatalog.loadAllAsMap();
      try {
        this.kkTypeHomeLocs = await this.kkCatalog.loadHomeLocs(forceRefresh);
      } catch (homeErr) {
        console.error('❌ loadHomeLocs:', homeErr);
      }
      if (loadId !== this.kkLocMapLoadId) return;
      this.invalidateKkTypeViewCache();
      this.cdr.detectChanges();
      if (this.kkLocMapView === 'type') {
        this.kkLocMapStatus = 'Đang đọc tồn kho…';
        this.cdr.detectChanges();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        handedOff = true;
        await this.loadKkByType(loadId);
      }
    } catch (e) {
      console.error('❌ loadKkCatalogForMap:', e);
      this.kkCatalogEntries = [];
      this.kkCatalogTypeMap = new Map();
    } finally {
      if (!handedOff) this.finishKkLocMapLoad(loadId);
    }
  }

  setKkTypeZone(zone: '' | KkWarehouse): void {
    this.kkLocMapWarehouseFilter = zone;
    this.kkLocMapExpandedKey = null;
    this.kkTypePage = 1;
    this.invalidateKkTypeViewCache();
    if (!this.kkLocMapByType.length && !this.kkLocMapBusy) void this.loadKkByType();
  }

  async loadKkByType(existingLoadId?: number): Promise<void> {
    const loadId = existingLoadId ?? ++this.kkLocMapLoadId;
    this.kkLocMapBusy = true;
    this.kkLocMapStatus = this.kkLocMapStatus || 'Đang đọc tồn kho theo loại hàng…';
    this.cdr.detectChanges();
    try {
      if (!this.kkCatalogTypeMap.size) {
        this.kkCatalogTypeMap = await this.kkCatalog.loadAllAsMap();
        this.kkCatalogEntries = await this.kkCatalog.loadAll();
      }
      const snap = await this.loadKkInventorySnap();
      if (loadId !== this.kkLocMapLoadId) return;

      this.kkLocMapTypeCache.clear();
      const byType = new Map<string, {
        productType: string;
        groups: Set<string>;
        warehouse: KkWarehouse;
        stock: number;
        checked: number;
        totalLines: number;
      }>();
      for (const doc of snap?.docs || []) {
        const data = doc.data() as any;
        const stock = this.stockFromInventoryDoc(data);
        if (stock <= 0) continue;
        const materialCode = String(data.materialCode || '').trim().toUpperCase();
        if (!materialCode) continue;
        const warehouse = this.kkWarehouseFromLocation(this.locationFromInventoryDoc(data));
        const groupCode = this.kkCatalog.groupCodeFromMaterial(materialCode);
        const productType = (groupCode && this.kkCatalogTypeMap.get(groupCode)) || 'Chưa gán danh mục';
        const kkOn = this.isKkFlagOn(data.kkChecked);
        const cur = byType.get(productType) || {
          productType,
          groups: new Set<string>(),
          warehouse,
          stock: 0,
          checked: 0,
          totalLines: 0
        };
        if (groupCode) cur.groups.add(groupCode);
        cur.stock += stock;
        cur.totalLines += 1;
        if (kkOn) cur.checked += 1;
        byType.set(productType, cur);
        const material = this.mapKkInventoryDoc(doc);
        material.kkChecked = kkOn;
        const list = this.kkLocMapTypeCache.get(productType) || [];
        list.push(material);
        this.kkLocMapTypeCache.set(productType, list);
      }

      this.kkLocMapByType = Array.from(byType.values())
        .map((v) => ({
          productType: v.productType,
          groupCodes: Array.from(v.groups).sort((a, b) => this.compareNhuaGroupCode(a, b)),
          warehouse: v.warehouse,
          stock: v.stock,
          checked: v.checked,
          totalLines: v.totalLines,
          remaining: Math.max(0, v.totalLines - v.checked),
          location: '',
          locationSaved: ''
        }))
        .sort((a, b) => this.compareKkTypeBox(a, b));
      this.invalidateKkTypeViewCache();
      this.readTracker.track('materials', 'inventory-materials', snap?.docs?.length || 0);
    } catch (e) {
      if (loadId !== this.kkLocMapLoadId) return;
      console.error('❌ loadKkByType:', e);
      this.kkLocMapByType = [];
      const timedOut = String((e as any)?.name || e).toLowerCase().includes('timeout');
      alert(timedOut
        ? '❌ Hết thời gian đọc tồn kho. Bấm Làm mới để thử lại.'
        : '❌ Không tải được Kiểm tra KK theo loại hàng.');
    } finally {
      this.finishKkLocMapLoad(loadId);
    }
  }

  kkTypeRowKey(row: { productType: string; warehouse: string }): string {
    return `type:${row.warehouse}|${row.productType}`;
  }

  kkTypeDetailLines(row: KkTypeRow | null): InventoryMaterial[] {
    if (!row) return [];
    return this.kkCachedLinesForType(row.productType)
      .filter((m) => this.calculateCurrentStock(m) > 0)
      .sort((a, b) => {
        const code = this.compareMaterialCodesFIFO(
          String(a.materialCode || ''),
          String(b.materialCode || '')
        );
        if (code) return code;
        return String(a.poNumber || '').localeCompare(String(b.poNumber || ''), 'en', { numeric: true });
      });
  }

  private kkMatchesWh3Mode(warehouse: KkWarehouse | string): boolean {
    if (this.kkWh3Only) return warehouse === 'ASM3';
    if (!this.kkCountWh3) return warehouse !== 'ASM3';
    return true;
  }

  private kkCachedLinesForType(productType: string): InventoryMaterial[] {
    this.ensureKkTypeBoxesCache();
    const boxExact = this.kkTypeBoxesCached.find((b) => b.productType === productType);
    const box = boxExact
      || this.kkTypeBoxesCached.find((b) => !!b.sourceProductTypes?.includes(productType));
    const sources = boxExact?.sourceProductTypes?.length
      ? boxExact.sourceProductTypes
      : [productType];
    const split = box?.pinSplit
      || (productType === this.kkActiveProductType ? this.kkActivePinSplit : null)
      || null;
    const seen = new Set<string>();
    let list: InventoryMaterial[] = [];
    for (const src of sources) {
      for (const m of this.kkLocMapTypeCache.get(src) || []) {
        const id = String(m.id || '');
        if (id) {
          if (seen.has(id)) continue;
          seen.add(id);
        }
        list.push(m);
      }
    }
    if (!list.length) list = this.kkLocMapTypeCache.get(productType) || [];
    list = list.filter((m) => this.kkMatchesWh3Mode(this.kkWarehouseFromLocation(m.location)));
    const zone = this.kkLocMapWarehouseFilter;
    if (zone) {
      list = list.filter((m) => this.kkWarehouseFromLocation(m.location) === zone);
    }
    if (split) {
      list = list.filter((m) => this.kkMaterialMatchesPinSplit(m, split));
    }
    return list;
  }

  private kkScanScopeLines(): InventoryMaterial[] {
    const row = this.kkActiveTypeRow;
    if (row) return this.kkLinesForTypeRow(row);
    const out: InventoryMaterial[] = [];
    const seen = new Set<string>();
    this.ensureKkTypeBoxesCache();
    for (const box of this.kkTypeBoxesCached) {
      for (const m of this.kkCachedLinesForType(box.productType)) {
        if (!m.id || seen.has(m.id)) continue;
        seen.add(m.id);
        out.push(m);
      }
    }
    return out;
  }

  private kkLinesForTypeRow(row: KkTypeRow): InventoryMaterial[] {
    return this.kkCachedLinesForType(row.productType).filter((m) => !!m.id);
  }

  groupCodeOfMaterial(materialCode: string): string {
    return this.kkCatalog.groupCodeFromMaterial(materialCode) || '—';
  }

  productTypeOfMaterial(materialCode: string): string {
    return this.kkCatalog.productTypeOf(materialCode, this.kkCatalogTypeMap) || '—';
  }

  private syncKkTypeRows(): void {
    this.invalidateKkTypeViewCache();
    this.kkLocMapByType = this.kkLocMapByType.map((row) => {
      const list = this.kkCachedLinesForType(row.productType);
      const checked = list.filter((m) => this.isKkFlagOn(m.kkChecked)).length;
      return {
        ...row,
        checked,
        remaining: Math.max(0, row.totalLines - checked)
      };
    });
  }

  async onKkByTypeTick(row: KkTypeRow, checked: boolean): Promise<void> {
    if (!this.canEdit || this.kkLocMapBusy) {
      this.cdr.detectChanges();
      return;
    }
    const next = !!checked;
    const lines = this.kkLinesForTypeRow(row);
    const targets = lines.filter((m) => this.isKkFlagOn(m.kkChecked) !== next);
    if (!targets.length) {
      this.syncKkTypeRows();
      this.cdr.detectChanges();
      return;
    }
    if (!next) {
      const ok = confirm(`Bỏ tick KK mọi dòng loại hàng ${row.productType}?\n(${targets.length} dòng)`);
      if (!ok) {
        this.cdr.detectChanges();
        return;
      }
    }
    const operator = next
      ? await this.resolveKkOperatorId()
      : await this.resolveKkOperatorFromSession();
    if (!operator) {
      this.cdr.detectChanges();
      return;
    }

    this.kkLocMapBusy = true;
    this.cdr.detectChanges();
    const kkAt = new Date();
    try {
      const chunkSize = 400;
      for (let i = 0; i < targets.length; i += chunkSize) {
        const chunk = targets.slice(i, i + chunkSize);
        const batch = this.firestore.firestore.batch();
        for (const m of chunk) {
          batch.update(this.firestore.collection('inventory-materials').doc(m.id!).ref, {
            kkChecked: next,
            kkBy: operator,
            kkAt,
            updatedAt: new Date(),
            ...(next ? {} : { kkScanCount: 0 })
          });
        }
        await batch.commit();
        if (next) {
          const histBatch = this.firestore.firestore.batch();
          for (const m of chunk) {
            histBatch.set(this.firestore.collection('inventory-kk-history').doc().ref, {
              inventoryDocId: m.id,
              factory: this.resolveKkFactoryForMaterial(m),
              materialCode: String(m.materialCode || '').trim().toUpperCase(),
              materialName: String(m.materialName || '').trim(),
              poNumber: String(m.poNumber || '').trim(),
              batchNumber: String(m.batchNumber || '').trim(),
              location: String(m.location || '').trim().toUpperCase(),
              quantity: Number(m.quantity) || 0,
              stock: Number(this.calculateCurrentStock(m)) || 0,
              unit: String(m.unit || '').trim(),
              checkedBy: operator,
              checkedAt: kkAt,
              checkedDateKey: this.toDateKey(kkAt),
              createdAt: new Date()
            });
          }
          await histBatch.commit();
        }
      }
      for (const m of targets) {
        m.kkChecked = next;
        m.kkBy = operator;
        m.kkAt = kkAt;
        if (!next) m.kkScanCount = 0;
      }
      this.invalidateKkInvSnapCache();
      this.syncKkTypeRows();
    } catch (e) {
      console.error('❌ onKkByTypeTick:', e);
      alert('❌ Không lưu được tick KK theo loại hàng.');
    } finally {
      this.kkLocMapBusy = false;
      this.cdr.detectChanges();
    }
  }

  onKkTypeLocationEnter(row: KkTypeRow, event: Event): void {
    (event.target as HTMLInputElement | null)?.blur();
  }

  async saveKkTypeLocation(row: KkTypeRow): Promise<void> {
    if (!this.canEdit || this.kkLocMapBusy) return;
    const next = this.normalizeMultiLocationValue(String(row.location || ''));
    row.location = next;
    if (!next) return;
    if (next === row.locationSaved) return;
    const lines = this.kkLinesForTypeRow(row);
    if (!lines.length) return;
    await this.writeKkTypeLocations(row, next, lines);
  }

  async clearKkTypeLocations(row: KkTypeRow): Promise<void> {
    if (!this.canEdit || this.kkLocMapBusy) return;
    const lines = this.kkLinesForTypeRow(row).filter((m) => String(m.location || '').trim());
    if (!lines.length) {
      row.location = '';
      row.locationSaved = '';
      this.cdr.detectChanges();
      return;
    }
    const ok = confirm(`Xóa vị trí mọi dòng loại hàng ${row.productType}?\n(${lines.length} dòng)`);
    if (!ok) return;
    await this.writeKkTypeLocations(row, '', lines);
  }

  private async writeKkTypeLocations(row: KkTypeRow, next: string, lines: InventoryMaterial[]): Promise<void> {
    this.kkLocMapBusy = true;
    this.cdr.detectChanges();
    try {
      const modifiedBy = await this.resolveLocationOperatorId();
      const changedAt = new Date();
      const chunkSize = 400;
      for (let i = 0; i < lines.length; i += chunkSize) {
        const chunk = lines.slice(i, i + chunkSize);
        const batch = this.firestore.firestore.batch();
        for (const m of chunk) {
          const fromLocation = this.normalizeMultiLocationValue(String(m.location || ''));
          const payload: Record<string, unknown> = {
            ...this.inventoryLocationWriteFields(next),
            updatedAt: changedAt,
            lastModified: firebase.default.firestore.FieldValue.serverTimestamp(),
            modifiedBy,
            locationManualOverride: true
          };
          if ((next === 'F62' || next === 'F62TRA') && m.iqcStatus !== 'Pass') {
            payload.iqcStatus = 'Pass';
          }
          batch.update(this.firestore.collection('inventory-materials').doc(m.id!).ref, payload);
          if (fromLocation !== next) {
            batch.set(this.firestore.collection('material-location-history').doc().ref, {
              factory: this.selectedFactory,
              materialId: m.id,
              materialCode: m.materialCode,
              poNumber: m.poNumber || '',
              fromLocation,
              toLocation: next,
              changedBy: modifiedBy,
              changeType: next ? 'kk-type-summary' : 'kk-type-clear',
              changedAt: firebase.default.firestore.FieldValue.serverTimestamp()
            });
          }
        }
        await batch.commit();
      }
      for (const m of lines) {
        m.location = next;
        const rowMeta = m as { __prevLocation?: string; __locationAtLoad?: string; locationManualOverride?: boolean };
        rowMeta.__prevLocation = next;
        rowMeta.__locationAtLoad = next;
        rowMeta.locationManualOverride = true;
      }
      row.location = next;
      row.locationSaved = next;
    } catch (e) {
      console.error('❌ writeKkTypeLocations:', e);
      alert(next ? '❌ Không lưu được vị trí theo loại hàng.' : '❌ Không xóa được vị trí theo loại hàng.');
    } finally {
      this.kkLocMapBusy = false;
      this.cdr.detectChanges();
    }
  }

  toggleQtyBagRule(): void {
    this.qtyBagRuleEnabled = !this.qtyBagRuleEnabled;
    this.syncQtyBagRulesToLocalStorage();
    this.pushQtyBagRulesToFirestore();
  }

  openRuleBagPopup(): void {
    this.rebuildRuleBagPrefixList();
    this.showRuleBagPopup = true;
    this.closeMorePopup();
  }

  closeRuleBagPopup(): void {
    this.showRuleBagPopup = false;
  }

  /** Lắng nghe Firestore — mọi máy cập nhật khi có thay đổi */
  /** Subscription hiện tại tới doc Rule Bag của factory đang chọn — huỷ + tạo lại khi đổi factory. */
  private qtyBagRulesSub: Subscription | null = null;

  private subscribeQtyBagRulesFromFirestore(): void {
    this.qtyBagRulesSub?.unsubscribe();
    this.qtyBagRulesSub = this.firestore
      .doc(`${this.QTY_BAG_FIRESTORE_COLLECTION}/${this.selectedFactory}`)
      .valueChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe(data => {
        if (!data || typeof data !== 'object') {
          return;
        }
        this.applyQtyBagRulesFromFirestoreDoc(data as Record<string, unknown>);
      });
  }

  private applyQtyBagRulesFromFirestoreDoc(data: Record<string, unknown>): void {
    if (typeof data['enabled'] === 'boolean') {
      this.qtyBagRuleEnabled = data['enabled'];
    }
    if ('prefixOff' in data && Array.isArray(data['prefixOff'])) {
      const next: Record<string, boolean> = {};
      for (const p of data['prefixOff'] as unknown[]) {
        const k = this.getMaterialCodePrefix4(String(p));
        if (k) {
          next[k] = false;
        }
      }
      this.qtyBagRuleByPrefix = next;
    }
    if ('manualPrefixes' in data && Array.isArray(data['manualPrefixes'])) {
      const set = new Set<string>();
      for (const x of data['manualPrefixes'] as unknown[]) {
        const k = this.getMaterialCodePrefix4(String(x ?? ''));
        if (k) {
          set.add(k);
        }
      }
      this.ruleBagManualPrefixes = Array.from(set).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      );
    }
    this.rebuildRuleBagPrefixList();
    this.syncQtyBagRulesToLocalStorage();
    this.cdr.markForCheck();
  }

  /** Ghi cache local (offline) trùng với trạng thái đang áp dụng */
  private syncQtyBagRulesToLocalStorage(): void {
    localStorage.setItem(this.QTY_BAG_RULE_KEY, this.qtyBagRuleEnabled ? '1' : '0');
    this.persistQtyBagRuleByPrefix();
    this.persistRuleBagManualPrefixes();
  }

  private pushQtyBagRulesToFirestore(): void {
    const prefixOff = Object.keys(this.qtyBagRuleByPrefix).filter(
      k => this.qtyBagRuleByPrefix[k] === false
    );
    this.firestore
      .doc(`${this.QTY_BAG_FIRESTORE_COLLECTION}/${this.selectedFactory}`)
      .set(
        {
          factory: this.selectedFactory,
          enabled: this.qtyBagRuleEnabled,
          prefixOff,
          manualPrefixes: [...this.ruleBagManualPrefixes],
          updatedAt: firebase.default.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      )
      .then(() => console.log(`✅ [${this.selectedFactory}] QTY bag / Rule Bag đã đồng bộ lên Firestore`))
      .catch(err => {
        console.error(`❌ [${this.selectedFactory}] Lỗi đồng bộ Rule lên Firestore:`, err);
        alert('Không lưu được cài đặt Rule lên Firebase. Kiểm tra mạng hoặc quyền Firestore.');
      });
  }

  private loadQtyBagRuleByPrefixFromStorage(): void {
    const raw = localStorage.getItem(this.QTY_BAG_RULE_BY_PREFIX_KEY);
    if (!raw) return;
    try {
      const o = JSON.parse(raw) as Record<string, unknown>;
      if (!o || typeof o !== 'object') return;
      const next: Record<string, boolean> = {};
      for (const k of Object.keys(o)) {
        if (typeof o[k] === 'boolean') {
          const nk = this.getMaterialCodePrefix4(k);
          if (nk) next[nk] = o[k] as boolean;
        }
      }
      this.qtyBagRuleByPrefix = next;
    } catch {
      /* ignore */
    }
  }

  private persistQtyBagRuleByPrefix(): void {
    localStorage.setItem(this.QTY_BAG_RULE_BY_PREFIX_KEY, JSON.stringify(this.qtyBagRuleByPrefix));
  }

  private getMaterialCodePrefix4(materialCode: string): string {
    const c = String(materialCode || '').trim().toUpperCase();
    if (!c) return '';
    return c.length >= 4 ? c.slice(0, 4) : c;
  }

  private loadRuleBagManualPrefixesFromStorage(): void {
    const raw = localStorage.getItem(this.RULE_BAG_MANUAL_PREFIXES_KEY);
    if (!raw) return;
    try {
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) return;
      const set = new Set<string>();
      for (const x of arr) {
        const p = this.getMaterialCodePrefix4(String(x ?? ''));
        if (p) set.add(p);
      }
      this.ruleBagManualPrefixes = Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    } catch {
      /* ignore */
    }
  }

  private persistRuleBagManualPrefixes(): void {
    localStorage.setItem(this.RULE_BAG_MANUAL_PREFIXES_KEY, JSON.stringify(this.ruleBagManualPrefixes));
  }

  rebuildRuleBagPrefixList(): void {
    const set = new Set<string>();
    for (const p of this.ruleBagManualPrefixes) {
      if (p) set.add(p);
    }
    for (const m of this.inventoryMaterials || []) {
      const p = this.getMaterialCodePrefix4(m.materialCode);
      if (p) set.add(p);
    }
    this.ruleBagPrefixes = Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  addRuleBagPrefix(): void {
    const p = this.getMaterialCodePrefix4(this.ruleBagNewPrefixInput);
    if (!p) {
      alert('Nhập đầu mã (tối đa 4 ký tự, ví dụ 2602).');
      return;
    }
    if (this.ruleBagManualPrefixes.includes(p)) {
      this.ruleBagNewPrefixInput = '';
      return;
    }
    this.ruleBagManualPrefixes = [...this.ruleBagManualPrefixes, p].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
    this.syncQtyBagRulesToLocalStorage();
    this.ruleBagNewPrefixInput = '';
    this.rebuildRuleBagPrefixList();
    this.pushQtyBagRulesToFirestore();
  }

  removeRuleBagManualPrefix(prefix: string, event?: Event): void {
    event?.stopPropagation();
    const p = this.getMaterialCodePrefix4(prefix);
    if (!p || !this.ruleBagManualPrefixes.includes(p)) return;
    this.ruleBagManualPrefixes = this.ruleBagManualPrefixes.filter(x => x !== p);
    this.syncQtyBagRulesToLocalStorage();
    this.rebuildRuleBagPrefixList();
    this.pushQtyBagRulesToFirestore();
  }

  isRuleBagManualPrefix(prefix: string): boolean {
    return this.ruleBagManualPrefixes.includes(this.getMaterialCodePrefix4(prefix));
  }

  isQtyBagRuleOnForPrefix(prefix: string): boolean {
    return this.qtyBagRuleByPrefix[prefix] !== false;
  }

  toggleQtyBagRuleForPrefix(prefix: string): void {
    const on = this.qtyBagRuleByPrefix[prefix] !== false;
    const copy = { ...this.qtyBagRuleByPrefix };
    if (on) {
      copy[prefix] = false;
    } else {
      delete copy[prefix];
    }
    this.qtyBagRuleByPrefix = copy;
    this.syncQtyBagRulesToLocalStorage();
    this.pushQtyBagRulesToFirestore();
  }

  /** Master OFF → không bắt; master ON → chỉ bắt khi prefix Rule Bag đang ON (mặc định ON nếu chưa tắt) */
  private shouldEnforceQtyBagMultipleForMaterial(materialCode: string): boolean {
    if (!this.qtyBagRuleEnabled) return false;
    const prefix = this.getMaterialCodePrefix4(materialCode);
    if (!prefix) return true;
    return this.qtyBagRuleByPrefix[prefix] !== false;
  }

  closeMorePopup(): void {
    this.showMorePopup = false;
  }

  get isManualStockEditOn(): boolean {
    return !!this.manualStockEditByFactory[this.selectedFactory];
  }

  /** Alias cột Đã xuất — chỉ gõ tay khi Manual ON. */
  get isExportColumnUnlocked(): boolean {
    return this.isManualStockEditOn;
  }

  toggleManualStockEdit(): void {
    if (this.isManualStockEditOn) {
      this.setManualStockEdit(false);
      return;
    }
    this.pendingMaterialsOtpAction = 'manual-on';
    this.materialsOtpActionLabel = `Bật Manual — tồn đầu / xuất tay (${this.selectedFactory})`;
    this.closeMorePopup();
    this.openMaterialsOtpModal();
  }

  private setManualStockEdit(on: boolean): void {
    this.manualStockEditByFactory[this.selectedFactory] = on;
    if (!on) {
      this.inventoryMaterials.forEach((m) => {
        m.isEditingOpeningStock = false;
      });
      this.filteredInventory.forEach((m) => {
        m.isEditingOpeningStock = false;
      });
    }
    this.cdr.markForCheck();
  }

  /** Các thao tác More đổi tồn / import / xóa — cần OTP Zalo ASP0106 (phiên 10 phút). */
  runMoreSensitiveAction(action: MaterialsOtpAction, label: string): void {
    if (this.materialsInventoryUnlock.isUnlocked()) {
      this.closeMorePopup();
      void this.executeMaterialsOtpAction(action);
      return;
    }
    this.pendingMaterialsOtpAction = action;
    this.materialsOtpActionLabel = label;
    this.closeMorePopup();
    this.openMaterialsOtpModal();
  }

  private openMaterialsOtpModal(): void {
    this.showMaterialsOtpModal = true;
    this.materialsOtpStep = 1;
    this.materialsOtpCode = '';
    this.materialsOtpError = '';
    this.materialsOtpInfo = '';
    this.cdr.markForCheck();
  }

  closeMaterialsOtpModal(): void {
    this.showMaterialsOtpModal = false;
    this.pendingMaterialsOtpAction = null;
    this.materialsOtpActionLabel = '';
    this.materialsOtpCode = '';
    this.materialsOtpError = '';
    this.materialsOtpInfo = '';
    this.cdr.markForCheck();
  }

  private async getMaterialsOtpRequester(): Promise<string> {
    try {
      const user = await firstValueFrom(this.authService.currentUser);
      const emp = String(user?.employeeId || '').trim().toUpperCase();
      if (emp) return emp;
    } catch { /* ignore */ }
    try {
      const u = await this.afAuth.currentUser;
      return (u?.email || u?.uid || '').trim().slice(0, 20);
    } catch {
      return '';
    }
  }

  private extractCallableError(e: unknown): string {
    const anyErr = e as { message?: string; details?: string; code?: string };
    const msg = String(anyErr?.message || anyErr?.details || e || 'Lỗi không xác định');
    if (msg.includes('FirebaseError:') || msg.includes('cloud function')) {
      const m = /(?:FirebaseError:\s*)?(?:\w+\/[\w-]+:\s*)?(.+)$/i.exec(msg);
      return (m?.[1] || msg).trim();
    }
    return msg;
  }

  async sendMaterialsOtp(): Promise<void> {
    this.materialsOtpError = '';
    this.materialsOtpInfo = '';
    this.materialsOtpSending = true;
    try {
      const requestedBy = await this.getMaterialsOtpRequester();
      await this.materialsInventoryUnlock.requestOtp({
        requestedBy,
        actionLabel: this.materialsOtpActionLabel || 'Thao tác tồn kho',
        factory: this.selectedFactory
      });
      this.materialsOtpStep = 2;
      this.materialsOtpInfo = `Đã gửi mã 4 số qua Zalo tới ASP0106 (${this.materialsOtpActionLabel || 'thao tác tồn kho'}).`;
    } catch (e: unknown) {
      this.materialsOtpError = this.extractCallableError(e);
    } finally {
      this.materialsOtpSending = false;
      this.cdr.markForCheck();
    }
  }

  async verifyMaterialsOtp(): Promise<void> {
    this.materialsOtpError = '';
    if (this.materialsOtpCode.trim().length !== 4) {
      this.materialsOtpError = 'Mã OTP phải gồm 4 chữ số.';
      return;
    }
    this.materialsOtpVerifying = true;
    try {
      const ok = await this.materialsInventoryUnlock.verifyOtp(this.materialsOtpCode);
      if (!ok) {
        this.materialsOtpError = 'Mã OTP không đúng.';
        return;
      }
      const action = this.pendingMaterialsOtpAction;
      this.closeMaterialsOtpModal();
      if (action) {
        await this.executeMaterialsOtpAction(action);
      }
    } catch (e: unknown) {
      this.materialsOtpError = this.extractCallableError(e);
    } finally {
      this.materialsOtpVerifying = false;
      this.cdr.markForCheck();
    }
  }

  private async executeMaterialsOtpAction(action: MaterialsOtpAction): Promise<void> {
    switch (action) {
      case 'import':
        await this.importCurrentStock();
        break;
      case 'consolidate':
        await this.consolidateAllInventory();
        break;
      case 'reset-all':
        await this.resetAllStock();
        break;
      case 'fix-batch':
        await this.fixProblematicBatchNumbers();
        break;
      case 'snapshot':
        this.openSnapshotCodesModal();
        break;
      case 'hidden-list':
        this.openHiddenInventoryPopupDirect();
        break;
      case 'manual-on':
        this.setManualStockEdit(true);
        break;
      default:
        break;
    }
  }

  /** Quản lý danh mục NVL (Mã/Tên/ĐVT/KH/Standard Packing) đã chuyển sang tab riêng — Danh mục NVL & TP. */
  goToDanhMucNvlTp(): void {
    void this.router.navigate(['/danh-muc-nvl-tp'], { queryParams: { tab: 'nvl' } });
  }

  get tieuHuyFilteredRows(): typeof this.tieuHuyRows {
    const q = String(this.tieuHuyQuery || '').trim().toUpperCase();
    if (!q) return this.tieuHuyRows;
    return this.tieuHuyRows.filter((r) =>
      r.px.toUpperCase().includes(q) || r.materialCode.includes(q) || r.poNumber.includes(q)
    );
  }

  get tieuHuySelectedCount(): number {
    return this.tieuHuyRows.filter((r) => r.selected && this.canSelectTieuHuyRow(r)).length;
  }

  get tieuHuySelectableVisibleCount(): number {
    return this.tieuHuyFilteredRows.filter((r) => this.canSelectTieuHuyRow(r)).length;
  }

  get tieuHuyAllVisibleSelected(): boolean {
    const rows = this.tieuHuyFilteredRows.filter((r) => this.canSelectTieuHuyRow(r));
    return rows.length > 0 && rows.every((r) => r.selected);
  }

  canSelectTieuHuyRow(row: typeof this.tieuHuyRows[number]): boolean {
    return !!row && !row.done && row.inventoryIds.length > 0;
  }

  toggleTieuHuySelectAll(checked: boolean): void {
    for (const row of this.tieuHuyFilteredRows) {
      row.selected = checked && this.canSelectTieuHuyRow(row);
    }
  }

  openTieuHuyPopup(): void {
    this.closeMorePopup();
    this.showTieuHuyPopup = true;
    this.tieuHuyQuery = '';
    this.restoreTieuHuyLastImport();
    void this.lookupAndMatchTieuHuyRows().then(() => this.cdr.detectChanges());
  }

  closeTieuHuyPopup(): void {
    if (this.tieuHuyImporting || this.tieuHuyBusy) return;
    this.showTieuHuyPopup = false;
  }

  downloadTieuHuyTemplate(): void {
    const ws = XLSX.utils.json_to_sheet([
      { 'PX': 'PX001', 'Mã': 'B005001', 'PO': '4500123456', 'Lượng': 0 },
      { 'PX': 'PX002', 'Mã': 'B002010', 'PO': '4500987654', 'Lượng': 0 }
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tieu huy');
    XLSX.writeFile(wb, `Tieu_huy_template_${this.selectedFactory}.xlsx`);
  }

  importTieuHuyFromExcel(): void {
    if (this.tieuHuyImporting || this.tieuHuyBusy) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = (event: Event) => {
      const file = (event.target as HTMLInputElement)?.files?.[0];
      if (file) void this.processTieuHuyImportFile(file);
    };
    input.click();
  }

  private emptyTieuHuyRow(partial: {
    px?: string;
    materialCode: string;
    poNumber: string;
    fileQty?: number | null;
    currentStock?: number;
    linkQStock?: number | null;
    matched?: boolean;
    location?: string;
    palletId?: string;
    inventoryIds?: string[];
    selected?: boolean;
    done?: '' | 'tieu-huy' | 'hidden';
  }): typeof this.tieuHuyRows[number] {
    return {
      px: this.normalizeTieuHuyPx(partial.px),
      materialCode: String(partial.materialCode || '').trim().toUpperCase(),
      poNumber: String(partial.poNumber || '').trim().toUpperCase(),
      fileQty: partial.fileQty == null || !Number.isFinite(Number(partial.fileQty)) ? null : Number(partial.fileQty),
      currentStock: Number(partial.currentStock) || 0,
      linkQStock: partial.linkQStock == null || !Number.isFinite(Number(partial.linkQStock)) ? null : Number(partial.linkQStock),
      matched: !!partial.matched,
      location: String(partial.location || ''),
      palletId: String(partial.palletId || ''),
      inventoryIds: Array.isArray(partial.inventoryIds) ? partial.inventoryIds.filter(Boolean) : [],
      selected: !!partial.selected,
      done: partial.done === 'tieu-huy' || partial.done === 'hidden' ? partial.done : ''
    };
  }

  private async processTieuHuyImportFile(file: File): Promise<void> {
    this.tieuHuyImporting = true;
    this.tieuHuyFileName = file.name;
    this.tieuHuyUpdatedCount = 0;
    this.cdr.detectChanges();
    try {
      const parsed = await this.parseTieuHuyExcel(file);
      if (!parsed.length) {
        alert('Không tìm thấy dòng hợp lệ. Cần cột Mã và PO.');
        return;
      }
      this.tieuHuyRows = parsed.map((r) => this.emptyTieuHuyRow(r));
      this.tieuHuyImportedCount = this.tieuHuyRows.length;
      await this.lookupAndMatchTieuHuyRows();
      this.saveTieuHuyLastImport();
      alert(
        `File tiêu hủy: ${this.tieuHuyImportedCount} mã.\n` +
        `Trùng tồn kho (Mã + PO): ${this.tieuHuyMatchedCount} / ${this.tieuHuyImportedCount}.\n` +
        `So sánh Lượng file với Tồn kho hiện tại, tick chọn rồi bấm Đưa vào kho tiêu hủy.\n` +
        `Ẩn = ẩn mã đó 30 ngày.`
      );
    } catch (e: any) {
      console.error('❌ processTieuHuyImportFile:', e);
      alert('Lỗi khi đọc file tiêu hủy: ' + (e?.message || e));
    } finally {
      this.tieuHuyImporting = false;
      this.cdr.detectChanges();
    }
  }

  private parseTieuHuyExcel(file: File): Promise<Array<{ px: string; materialCode: string; poNumber: string; fileQty: number | null }>> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const objects = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
          const byKey = new Map<string, { px: string; materialCode: string; poNumber: string; fileQty: number | null }>();
          const merge = (mapped: { px: string; materialCode: string; poNumber: string; fileQty: number | null } | null) => {
            if (!mapped) return;
            const key = `${mapped.px}|${mapped.materialCode}|${mapped.poNumber}`;
            const prev = byKey.get(key);
            if (!prev) {
              byKey.set(key, mapped);
              return;
            }
            if (mapped.fileQty != null) {
              prev.fileQty = (prev.fileQty || 0) + mapped.fileQty;
            }
          };
          for (const row of objects) merge(this.mapTieuHuyExcelRow(row));
          if (!byKey.size) {
            const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
            for (let i = 0; i < matrix.length; i++) {
              merge(this.mapTieuHuyExcelCells(matrix[i] || [], i === 0));
            }
          }
          resolve(Array.from(byKey.values()));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  private mapTieuHuyExcelRow(row: Record<string, unknown>): { px: string; materialCode: string; poNumber: string; fileQty: number | null } | null {
    let px = '';
    let code = '';
    let po = '';
    let fileQty: number | null = null;
    for (const [key, val] of Object.entries(row)) {
      const kind = this.tieuHuyHeaderKind(key);
      if (kind === 'px' && !px) px = this.normalizeTieuHuyPx(val);
      else if (kind === 'code' && !code) code = this.normalizeTieuHuyCode(val);
      else if (kind === 'po' && !po) po = this.normalizeTieuHuyPo(val);
      else if (kind === 'qty' && fileQty == null) fileQty = this.parseTieuHuyQty(val);
    }
    if (!code || !po) {
      const values = Object.values(row);
      if (values.length >= 3) {
        px = px || this.normalizeTieuHuyPx(values[0]);
        code = code || this.normalizeTieuHuyCode(values[1]);
        po = po || this.normalizeTieuHuyPo(values[2]);
        if (fileQty == null) fileQty = this.parseTieuHuyQty(values[3]);
      } else {
        code = code || this.normalizeTieuHuyCode(values[0]);
        po = po || this.normalizeTieuHuyPo(values[1]);
        if (fileQty == null) fileQty = this.parseTieuHuyQty(values[2]);
      }
    }
    if (!code || !po) return null;
    return { px, materialCode: code, poNumber: po, fileQty };
  }

  private mapTieuHuyExcelCells(
    line: unknown[],
    maybeHeader: boolean
  ): { px: string; materialCode: string; poNumber: string; fileQty: number | null } | null {
    const head = this.foldVn(String(line[0] ?? '') + ' ' + String(line[1] ?? '') + ' ' + String(line[2] ?? ''));
    if (maybeHeader && /px|ma|code|po/i.test(head)) {
      return null;
    }
    let px = this.normalizeTieuHuyPx(line[0]);
    let code = this.normalizeTieuHuyCode(line[1]);
    let po = this.normalizeTieuHuyPo(line[2]);
    let fileQty = this.parseTieuHuyQty(line[3]);
    if (!code || !po) {
      code = this.normalizeTieuHuyCode(line[0]);
      po = this.normalizeTieuHuyPo(line[1]);
      fileQty = this.parseTieuHuyQty(line[2]);
      px = '';
    }
    if (!code || !po) return null;
    return { px, materialCode: code, poNumber: po, fileQty };
  }

  private parseTieuHuyQty(raw: unknown): number | null {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    const s = String(raw).replace(/,/g, '').trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  private tieuHuyHeaderKind(header: string): 'px' | 'code' | 'po' | 'qty' | '' {
    const s = this.foldVn(String(header || '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!s) return '';
    if (s === 'px' || s.includes('phieu xuat') || s.includes('phieu x') || s === 'so px') return 'px';
    if (/(^|\s)po(\s|$)/.test(s) || s.includes('purchase')) return 'po';
    if (
      s === 'sl' ||
      s === 'qty' ||
      s.includes('luong') ||
      s.includes('quantity') ||
      s.includes('so luong')
    ) return 'qty';
    if (s === 'ma' || s.includes('ma hang') || s.includes('material') || s.includes('item') || s === 'code' || s.includes('ma nvl')) return 'code';
    return '';
  }

  private foldVn(s: string): string {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd');
  }

  private normalizeTieuHuyPx(raw: unknown): string {
    let s = String(raw ?? '').trim();
    if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
    return s;
  }

  private normalizeTieuHuyCode(raw: unknown): string {
    return String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  }

  private normalizeTieuHuyPo(raw: unknown): string {
    let s = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
    if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
    return s;
  }

  private tieuHuyPoMatch(a: string, b: string): boolean {
    if (!a || !b) return false;
    if (a === b) return true;
    const da = a.replace(/\D/g, '');
    const db = b.replace(/\D/g, '');
    if (da && db && da === db) return true;
    if (da && db && da.replace(/^0+/, '') === db.replace(/^0+/, '')) return true;
    return false;
  }

  isTieuHuyLocation(location: string | null | undefined): boolean {
    const u = String(location || '').trim().toUpperCase();
    return u === 'TIEUHUY' || u.startsWith('TIEUHUY-') || u.replace(/[^A-Z0-9]/g, '') === 'TIEUHUY';
  }

  isTieuHuySearchTerm(term: string | null | undefined): boolean {
    return this.locationCompact(String(term || '')) === 'TIEUHUY';
  }

  private tieuHuyStorageKey(): string {
    return `materials-tieu-huy:${this.selectedFactory}`;
  }

  private saveTieuHuyLastImport(): void {
    try {
      localStorage.setItem(this.tieuHuyStorageKey(), JSON.stringify({
        fileName: this.tieuHuyFileName,
        importedCount: this.tieuHuyImportedCount,
        matchedCount: this.tieuHuyMatchedCount,
        updatedCount: this.tieuHuyUpdatedCount,
        rows: this.tieuHuyRows,
        at: Date.now()
      }));
    } catch { /* ignore quota */ }
  }

  private restoreTieuHuyLastImport(): void {
    try {
      const raw = localStorage.getItem(this.tieuHuyStorageKey());
      if (!raw) return;
      const data = JSON.parse(raw) as {
        fileName?: string;
        importedCount?: number;
        matchedCount?: number;
        updatedCount?: number;
        rows?: Array<Partial<typeof this.tieuHuyRows[number]>>;
      };
      this.tieuHuyFileName = String(data.fileName || '');
      this.tieuHuyImportedCount = Number(data.importedCount || 0);
      this.tieuHuyMatchedCount = Number(data.matchedCount || 0);
      this.tieuHuyUpdatedCount = Number(data.updatedCount || 0);
      this.tieuHuyRows = Array.isArray(data.rows)
        ? data.rows.map((r) => this.emptyTieuHuyRow({
            px: String((r as any)?.px || ''),
            materialCode: String(r?.materialCode || ''),
            poNumber: String(r?.poNumber || ''),
            fileQty: r?.fileQty,
            currentStock: r?.currentStock,
            linkQStock: r?.linkQStock,
            matched: r?.matched,
            location: r?.location,
            palletId: r?.palletId,
            inventoryIds: r?.inventoryIds,
            selected: r?.selected,
            done: r?.done
          }))
        : [];
    } catch {
      /* ignore */
    }
  }

  private async lookupAndMatchTieuHuyRows(): Promise<void> {
    if (!this.tieuHuyRows.length) {
      this.tieuHuyMatchedCount = 0;
      this.tieuHuyStockLines = [];
      return;
    }
    const codes = Array.from(new Set(this.tieuHuyRows.map((r) => r.materialCode).filter(Boolean)));
    this.tieuHuyStockLines = await this.fetchTieuHuyStockByCodes(codes);
    this.tieuHuyLinkQMap = await this.loadTieuHuyLinkQMap();
    this.refreshTieuHuyMatchFromInventory();
  }

  private async loadTieuHuyLinkQMap(): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const put = (code: string, stock: unknown) => {
      const key = this.normalizeTieuHuyCode(code);
      if (!key) return;
      map.set(key, Math.round(Number(stock) || 0));
    };
    try {
      const canonical = await this.firestore.collection('linkQFiles').doc(this.selectedFactory).get().toPromise();
      let raw: Record<string, unknown> | null = null;
      if (canonical?.exists) {
        raw = ((canonical.data() as any)?.linkQData || null) as Record<string, unknown> | null;
      } else {
        const snap = await this.firestore.collection('linkQFiles', (ref) =>
          ref.where('factory', '==', this.selectedFactory).limit(20)
        ).get().toPromise();
        const docs = [...(snap?.docs || [])].sort((a, b) => {
          const da = (a.data() as any)?.uploadDate?.toMillis?.() || (a.data() as any)?.uploadDate?.seconds * 1000 || 0;
          const db = (b.data() as any)?.uploadDate?.toMillis?.() || (b.data() as any)?.uploadDate?.seconds * 1000 || 0;
          return db - da;
        });
        raw = ((docs[0]?.data() as any)?.linkQData || null) as Record<string, unknown> | null;
      }
      if (raw) {
        for (const [code, stock] of Object.entries(raw)) put(code, stock);
      }
    } catch (e) {
      console.warn('[TieuHuy] load LinkQ failed', e);
    }
    return map;
  }

  private async fetchTieuHuyStockByCodes(materialCodes: string[]): Promise<InventoryMaterial[]> {
    const uniq = Array.from(new Set(materialCodes.map((x) => this.normalizeTieuHuyCode(x)).filter(Boolean)));
    const out: InventoryMaterial[] = [];
    const seen = new Set<string>();
    const push = (m: InventoryMaterial) => {
      if (!m?.id || seen.has(m.id)) return;
      if (m.factory && m.factory !== this.selectedFactory) return;
      seen.add(m.id);
      out.push(m);
    };
    const parallel = 10;
    for (let i = 0; i < uniq.length; i += parallel) {
      const chunk = uniq.slice(i, i + parallel);
      const parts = await Promise.all(chunk.map((code) => this.fetchInventoryRowsByMaterialCodes([code])));
      for (const rows of parts) rows.forEach(push);
    }
    for (const m of this.inventoryMaterials || []) push(m);
    return out;
  }

  private refreshTieuHuyMatchFromInventory(): void {
    if (!this.tieuHuyRows.length) {
      this.tieuHuyMatchedCount = 0;
      return;
    }
    const stock = this.tieuHuyStockLines.length
      ? this.tieuHuyStockLines
      : (this.inventoryMaterials || []).filter((m) => !m.factory || m.factory === this.selectedFactory);
    let matchedRows = 0;
    for (const row of this.tieuHuyRows) {
      if (row.done === 'hidden') {
        row.matched = false;
        row.currentStock = 0;
        row.inventoryIds = [];
        row.selected = false;
        row.linkQStock = this.tieuHuyLinkQMap.has(row.materialCode)
          ? this.tieuHuyLinkQMap.get(row.materialCode)!
          : null;
        continue;
      }
      const found = stock.filter((m) =>
        this.normalizeTieuHuyCode(m.materialCode) === row.materialCode &&
        this.tieuHuyPoMatch(this.normalizeTieuHuyPo(m.poNumber), row.poNumber)
      );
      const ids = found.map((m) => m.id).filter((id): id is string => !!id);
      row.matched = ids.length > 0;
      row.inventoryIds = ids;
      row.currentStock = found.reduce((sum, m) => sum + this.calculateCurrentStock(m), 0);
      row.linkQStock = this.tieuHuyLinkQMap.has(row.materialCode)
        ? this.tieuHuyLinkQMap.get(row.materialCode)!
        : null;
      if (found.length) {
        matchedRows += 1;
        row.location = Array.from(new Set(found.map((m) => String(m.location || '').trim()).filter(Boolean))).join(', ');
        row.palletId = Array.from(new Set(found.map((m) => String(m.palletId || '').trim()).filter(Boolean))).join(', ');
      } else {
        row.location = row.done === 'tieu-huy' ? this.tieuHuyWarehouseValue : '';
        row.palletId = '';
        row.selected = false;
      }
      if (!this.canSelectTieuHuyRow(row)) row.selected = false;
    }
    this.tieuHuyMatchedCount = matchedRows;
  }

  async applyTieuHuySelectedToWarehouse(): Promise<void> {
    if (this.tieuHuyBusy || this.tieuHuyImporting) return;
    const rows = this.tieuHuyRows.filter((r) => r.selected && this.canSelectTieuHuyRow(r));
    const idSet = new Set<string>();
    for (const row of rows) {
      for (const id of row.inventoryIds) idSet.add(id);
    }
    if (!idSet.size) {
      alert('Chọn mã đã khớp tồn kho trước khi đưa vào kho tiêu hủy.');
      return;
    }
    const ok = confirm(
      `Đưa ${rows.length} mã đã chọn (${idSet.size} dòng tồn kho) vào kho ${this.tieuHuyWarehouseValue}?`
    );
    if (!ok) return;
    const lines = this.tieuHuyStockLines.filter((m) => m.id && idSet.has(m.id));
    const missing = Array.from(idSet).filter((id) => !lines.some((m) => m.id === id));
    const toWrite: InventoryMaterial[] = [
      ...lines,
      ...missing.map((id) => ({ id } as InventoryMaterial))
    ];
    this.tieuHuyBusy = true;
    this.cdr.detectChanges();
    try {
      const saved = await this.applyTieuHuyWarehouse(toWrite);
      if (!saved) {
        alert('Không chuyển được kho (lỗi lưu).');
        return;
      }
      this.tieuHuyUpdatedCount += toWrite.length;
      for (const row of rows) {
        row.done = 'tieu-huy';
        row.selected = false;
        row.location = this.tieuHuyWarehouseValue;
      }
      for (const m of this.inventoryMaterials || []) {
        if (m.id && idSet.has(m.id)) m.location = this.tieuHuyWarehouseValue;
      }
      this.saveTieuHuyLastImport();
      alert(`Đã chuyển ${toWrite.length} dòng sang kho ${this.tieuHuyWarehouseValue}.`);
    } finally {
      this.tieuHuyBusy = false;
      this.cdr.detectChanges();
    }
  }

  async hideTieuHuyRow(row: typeof this.tieuHuyRows[number]): Promise<void> {
    if (this.tieuHuyBusy || !row || row.done === 'hidden') return;
    if (!this.canDelete) {
      alert('❌ Bạn không có quyền ẩn item này. Vui lòng liên hệ admin để được cấp quyền.');
      return;
    }
    if (!row.inventoryIds.length) {
      alert('Mã này chưa khớp tồn kho nên không ẩn được.');
      return;
    }
    const ok = confirm(
      `Ẩn ${row.materialCode} / PO ${row.poNumber} trong ${this.hiddenRetentionDays} ngày?\n\n` +
      `Tồn kho hiện tại: ${this.formatNumber(row.currentStock)}\n` +
      `${row.inventoryIds.length} dòng sẽ vào Danh mục Ẩn.`
    );
    if (!ok) return;
    this.tieuHuyBusy = true;
    this.cdr.detectChanges();
    try {
      const n = await this.hideInventoryDocsByIds(row.inventoryIds, 'manual');
      const idSet = new Set(row.inventoryIds);
      this.removeInventoryByIds(idSet);
      this.tieuHuyStockLines = this.tieuHuyStockLines.filter((m) => !m.id || !idSet.has(m.id));
      row.done = 'hidden';
      row.selected = false;
      row.matched = false;
      row.currentStock = 0;
      row.inventoryIds = [];
      row.location = '';
      row.palletId = '';
      this.tieuHuyMatchedCount = this.tieuHuyRows.filter((r) => r.matched && r.done !== 'hidden').length;
      this.saveTieuHuyLastImport();
      alert(
        n > 0
          ? `Đã ẩn ${row.materialCode}. Xem lại trong More → Danh mục Ẩn (giữ ${this.hiddenRetentionDays} ngày).`
          : `Không ẩn được ${row.materialCode}.`
      );
    } catch (e: any) {
      console.error('❌ hideTieuHuyRow:', e);
      alert('Lỗi khi ẩn: ' + (e?.message || e));
    } finally {
      this.tieuHuyBusy = false;
      this.cdr.detectChanges();
    }
  }

  private async applyTieuHuyWarehouse(lines: InventoryMaterial[]): Promise<boolean> {
    const warehouse = this.tieuHuyWarehouseValue;
    try {
      const modifiedBy = await this.resolveLocationOperatorId();
      const chunkSize = 400;
      for (let i = 0; i < lines.length; i += chunkSize) {
        const chunk = lines.slice(i, i + chunkSize);
        const batch = this.firestore.firestore.batch();
        for (const m of chunk) {
          if (!m.id) continue;
          batch.update(this.firestore.collection('inventory-materials').doc(m.id).ref, {
            ...this.inventoryLocationWriteFields(warehouse),
            updatedAt: new Date(),
            lastModified: firebase.default.firestore.FieldValue.serverTimestamp(),
            modifiedBy
          });
        }
        await batch.commit();
      }
      for (const m of lines) {
        m.location = warehouse;
      }
      return true;
    } catch (e) {
      console.error('❌ applyTieuHuyWarehouse:', e);
      return false;
    }
  }

  openKkCatalogPopup(): void {
    this.closeMorePopup();
    this.showKkCatalogPopup = true;
    this.kkCatalogQuery = '';
    void this.loadKkCatalogPopup();
  }

  closeKkCatalogPopup(): void {
    if (this.kkCatalogImporting) return;
    this.showKkCatalogPopup = false;
  }

  async loadKkCatalogPopup(forceRefresh = false): Promise<void> {
    this.kkCatalogLoading = true;
    this.cdr.detectChanges();
    try {
      this.kkCatalogEntries = await this.kkCatalog.loadAll(forceRefresh);
      this.kkCatalogTypeMap = await this.kkCatalog.loadAllAsMap();
    } catch (e) {
      console.error('❌ loadKkCatalogPopup:', e);
      alert('❌ Không tải được Danh mục KK.');
      this.kkCatalogEntries = [];
    } finally {
      this.kkCatalogLoading = false;
      this.cdr.detectChanges();
    }
  }

  downloadKkCatalogTemplate(): void {
    const ws = XLSX.utils.json_to_sheet([
      { 'Nhóm mã': 'B001680', 'Loại hàng': 'Ví dụ loại A' },
      { 'Nhóm mã': 'B017431', 'Loại hàng': 'Ví dụ loại B' }
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Danh muc KK');
    XLSX.writeFile(wb, 'Danh_Muc_KK_Template.xlsx');
  }

  importKkCatalogFromExcel(): void {
    if (this.kkCatalogImporting) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = (event: Event) => {
      const file = (event.target as HTMLInputElement)?.files?.[0];
      if (file) void this.processKkCatalogImportFile(file);
    };
    input.click();
  }

  private async processKkCatalogImportFile(file: File): Promise<void> {
    try {
      const parsed = await this.parseKkCatalogExcel(file);
      if (!parsed.length) {
        alert('Không tìm thấy dòng hợp lệ. Cần cột "Nhóm mã" (B + 6 số, vd B001680) và "Loại hàng".');
        return;
      }
      if (
        !confirm(
          `Import sẽ THAY THẾ TOÀN BỘ Danh mục KK bằng ${parsed.length} nhóm mã trong file.\nNhóm mã không có trong file sẽ bị xóa.\n\nTiếp tục?`
        )
      ) {
        return;
      }
      this.kkCatalogImporting = true;
      this.cdr.detectChanges();
      const count = await this.kkCatalog.importFromRows(parsed);
      this.kkCatalogEntries = await this.kkCatalog.loadAll(true);
      this.kkCatalogTypeMap = await this.kkCatalog.loadAllAsMap();
      alert(`Đã import ${count} nhóm mã.`);
    } catch (e: any) {
      console.error('❌ processKkCatalogImportFile:', e);
      alert('Lỗi khi đọc file: ' + (e?.message || e));
    } finally {
      this.kkCatalogImporting = false;
      this.cdr.detectChanges();
    }
  }

  private parseKkCatalogExcel(file: File): Promise<Array<{ groupCode: string; productType: string }>> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const objects = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
          const byGroup = new Map<string, string>();
          for (const row of objects) {
            const mapped = this.mapKkCatalogExcelRow(row);
            if (mapped) byGroup.set(mapped.groupCode, mapped.productType);
          }
          if (!byGroup.size) {
            const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
            for (let i = 0; i < matrix.length; i++) {
              const line = matrix[i] || [];
              const groupCode = this.kkCatalog.normalizeGroupCode(String(line[0] ?? ''));
              const productType = String(line[1] ?? '').trim();
              if (!groupCode || !productType) continue;
              if (i === 0 && /nhom|group|ma/i.test(productType)) continue;
              byGroup.set(groupCode, productType);
            }
          }
          resolve(Array.from(byGroup.entries()).map(([groupCode, productType]) => ({ groupCode, productType })));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  private mapKkCatalogExcelRow(row: Record<string, unknown>): { groupCode: string; productType: string } | null {
    let groupRaw = '';
    let typeRaw = '';
    for (const [key, value] of Object.entries(row)) {
      const h = this.normalizeExcelHeader(key);
      if (!groupRaw && (h === 'nhomma' || h === 'manhom' || h === 'groupcode' || h === 'group' || h === 'nhom')) {
        groupRaw = String(value ?? '');
      } else if (!typeRaw && (h === 'loaihang' || h === 'producttype' || h === 'type' || h === 'loai')) {
        typeRaw = String(value ?? '');
      }
    }
    const groupCode = this.kkCatalog.normalizeGroupCode(groupRaw);
    const productType = String(typeRaw || '').trim();
    if (!groupCode || !productType) return null;
    return { groupCode, productType };
  }

  private normalizeExcelHeader(raw: string): string {
    return String(raw || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  // Toggle mobile menu
  toggleMobileMenu(): void {
    this.showMobileMenu = !this.showMobileMenu;
    console.log('📱 Mobile menu toggled:', this.showMobileMenu);
  }

  toggleMobileStats(): void {
    this.showMobileStats = !this.showMobileStats;
    console.log('📊 Mobile stats toggled:', this.showMobileStats);
  }


  stopScanning(): void {
    if (this.html5QrCode) {
      this.html5QrCode.stop();
      this.html5QrCode = null;
    }
    this.isScanning = false;
  }

  autoResizeNotesColumn(): void {
    // Placeholder for auto-resize functionality
  }

  // Download template for importing inventory
  async downloadStockTemplate(): Promise<void> {
    const XLSX = await import('xlsx');
    try {
      console.log(`📥 Downloading inventory import template for ${this.selectedFactory}...`);

      const templateData = [
        {
          'Mã hàng': 'B001003',
          'PO Number': 'KZP00001/0001',
          'Tồn đầu': 50,
          'Số lượng': 100,
          'Đơn vị': 'PCS',
          'Vị trí': 'A1',
          'Loại hình': 'Raw Material',
          'Ngày nhập (dd/mm/yyyy)': '15/12/2025',
          'Batch Number': '15122025',
          'Standard Packing': 10,
          'Ghi chú': 'Sample material 1'
        },
        {
          'Mã hàng': 'P0123',
          'PO Number': 'KZP00002/0002',
          'Tồn đầu': 0,
          'Số lượng': 200,
          'Đơn vị': 'KG',
          'Vị trí': 'B2',
          'Loại hình': 'Raw Material',
          'Ngày nhập (dd/mm/yyyy)': '15/12/2025',
          'Batch Number': '15122025',
          'Standard Packing': 20,
          'Ghi chú': 'Sample material 2'
        }
      ];

      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(templateData);

      worksheet['!cols'] = [
        { wch: 15 },  // Mã hàng
        { wch: 18 },  // PO Number
        { wch: 12 },  // Tồn đầu
        { wch: 12 },  // Số lượng
        { wch: 10 },  // Đơn vị
        { wch: 10 },  // Vị trí
        { wch: 15 },  // Loại hình
        { wch: 20 },  // Ngày nhập
        { wch: 15 },  // Batch Number
        { wch: 18 },  // Standard Packing
        { wch: 20 }   // Ghi chú
      ];

      XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventory_Template');

      const fileName = `${this.selectedFactory}_Inventory_Import_Template_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, fileName);

      console.log('✅ Inventory import template downloaded successfully');
      alert(`✅ Đã tải template import tồn kho ${this.selectedFactory}!\n\n📁 File: ${fileName}\n\n💡 Hướng dẫn:\n- Điền thông tin theo mẫu\n- Import bằng nút "Import Inventory"`);

    } catch (error) {
      console.error('❌ Error downloading template:', error);
      alert('❌ Lỗi khi tải template: ' + error.message);
    }
  }

  downloadFIFOReport(): void {
    console.log(`Download FIFO report for ${this.selectedFactory}`);
  }

  // Delete single inventory item
  async deleteInventoryItem(material: InventoryMaterial): Promise<void> {
    // Giữ tên cũ để tương thích HTML cũ nếu còn sót — chuyển sang ẩn
    return this.hideInventoryItem(material);
  }

  /** Ẩn 1 dòng inventory → chuyển sang danh mục Ẩn (giữ 30 ngày). */
  async hideInventoryItem(material: InventoryMaterial): Promise<void> {
    if (!this.canDelete) {
      alert('❌ Bạn không có quyền ẩn item này. Vui lòng liên hệ admin để được cấp quyền.');
      return;
    }

    if (!material.id) {
      alert('❌ Không thể ẩn item: Không tìm thấy ID');
      return;
    }

    if (material.factory !== this.selectedFactory) {
      alert(`❌ LỖI BẢO MẬT: Không thể ẩn item từ ${material.factory} trong ${this.selectedFactory}!`);
      return;
    }

    const ok = confirm(
      `Ẩn item ${material.materialCode} khỏi ${this.selectedFactory} Inventory?\n\n` +
        `PO: ${material.poNumber}\nVị trí: ${material.location}\nSố lượng: ${material.quantity} ${material.unit}\n\n` +
        `Dòng sẽ vào danh mục Ẩn (More) và tự xóa sau ${this.hiddenRetentionDays} ngày (có gửi backup mail trước).`
    );
    if (!ok) return;

    try {
      this.isLoading = true;
      this.isHidingInventory = true;
      const n = await this.hideInventoryDocsByIds([material.id], 'manual');
      this.removeInventoryByIds(new Set([material.id]));
      alert(
        n > 0
          ? `✅ Đã ẩn ${material.materialCode}. Xem lại trong More → Danh mục Ẩn.`
          : `⚠️ Không ẩn được ${material.materialCode}.`
      );
    } catch (error: any) {
      console.error('❌ Error hiding item:', error);
      alert(`❌ Lỗi khi ẩn item ${material.materialCode}: ${error?.message || 'Lỗi không xác định'}`);
    } finally {
      this.isHidingInventory = false;
      this.isLoading = false;
    }
  }

  private parseFirestoreDateValue(raw: any): Date | null {
    if (!raw) return null;
    if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
    if (typeof raw?.toDate === 'function') {
      try {
        const d = raw.toDate();
        return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
      } catch {
        return null;
      }
    }
    if (typeof raw?.seconds === 'number') {
      const d = new Date(raw.seconds * 1000);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private async getHiddenByLabel(): Promise<string> {
    try {
      const user = await this.afAuth.currentUser;
      return (user?.email || user?.uid || 'unknown').trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Chuyển inventory docs sang collection ẩn rồi xóa khỏi inventory-materials.
   * Mỗi dòng: set hidden + delete inventory (2 write) → batch tối đa ~200 id.
   */
  private async hideInventoryDocsByIds(ids: string[], reason: InventoryHideReason): Promise<number> {
    if (!ids.length) return 0;
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    const hiddenBy = await this.getHiddenByLabel();
    const now = new Date();
    const deleteAfterAt = new Date(now.getTime() + this.hiddenRetentionDays * 24 * 60 * 60 * 1000);
    const batchSize = 200;
    let hiddenCount = 0;

    for (let i = 0; i < uniqueIds.length; i += batchSize) {
      const chunk = uniqueIds.slice(i, i + batchSize);
      const snaps = await Promise.all(
        chunk.map((id) => this.firestore.collection('inventory-materials').doc(id).ref.get())
      );
      const batch = this.firestore.firestore.batch();
      let ops = 0;
      snaps.forEach((snap, idx) => {
        if (!snap.exists) return;
        const data = snap.data() as any;
        const id = chunk[idx];
        const stock = this.computeStockFromFirestoreData(data);
        const hiddenRef = this.firestore.collection(this.hiddenInventoryCollection).doc(id).ref;
        const invRef = this.firestore.collection('inventory-materials').doc(id).ref;
        batch.set(hiddenRef, {
          ...data,
          originalId: id,
          factory: data.factory || this.selectedFactory,
          stockAtHide: stock,
          hideReason: reason,
          hiddenBy,
          hiddenAt: now,
          deleteAfterAt,
          updatedAt: now
        });
        batch.delete(invRef);
        ops += 1;
      });
      if (ops > 0) {
        await batch.commit();
        hiddenCount += ops;
      }
      if (i + batchSize < uniqueIds.length) {
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    }
    return hiddenCount;
  }

  openHiddenInventoryPopup(): void {
    this.runMoreSensitiveAction('hidden-list', `Danh mục Ẩn / Pushback — ${this.selectedFactory}`);
  }

  /** Mở danh mục Ẩn sau khi đã OTP (không hỏi lại). */
  private openHiddenInventoryPopupDirect(): void {
    this.showMorePopup = false;
    this.hiddenSearchQuery = '';
    this.pushbackHiddenId = null;
    this.showHiddenInventoryPopup = true;
    void this.loadHiddenInventoryList();
  }

  closeHiddenInventoryPopup(): void {
    this.showHiddenInventoryPopup = false;
    this.hiddenInventoryRows = [];
    this.hiddenSearchQuery = '';
    this.pushbackHiddenId = null;
  }

  get filteredHiddenInventoryRows(): HiddenInventoryRow[] {
    const q = (this.hiddenSearchQuery || '').trim().toLowerCase();
    if (!q) return this.hiddenInventoryRows;
    return this.hiddenInventoryRows.filter((row) => {
      const hay = [
        row.materialCode,
        row.poNumber,
        row.location,
        row.hiddenBy,
        this.hideReasonLabel(row.hideReason)
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }

  async loadHiddenInventoryList(): Promise<void> {
    this.isLoadingHiddenInventory = true;
    try {
      const snap = await this.firestore
        .collection(this.hiddenInventoryCollection, (ref) =>
          ref.where('factory', '==', this.selectedFactory).limit(2000)
        )
        .get()
        .toPromise();

      const now = Date.now();
      const rows: HiddenInventoryRow[] = (snap?.docs || []).map((doc) => {
        const data = doc.data() as any;
        const hiddenAt = this.parseFirestoreDateValue(data.hiddenAt);
        const deleteAfterAt = this.parseFirestoreDateValue(data.deleteAfterAt);
        let daysLeft = 0;
        if (deleteAfterAt) {
          daysLeft = Math.max(0, Math.ceil((deleteAfterAt.getTime() - now) / (24 * 60 * 60 * 1000)));
        } else if (hiddenAt) {
          const expire = hiddenAt.getTime() + this.hiddenRetentionDays * 24 * 60 * 60 * 1000;
          daysLeft = Math.max(0, Math.ceil((expire - now) / (24 * 60 * 60 * 1000)));
        }
        const stock =
          typeof data.stockAtHide === 'number'
            ? data.stockAtHide
            : this.computeStockFromFirestoreData(data);
        return {
          id: doc.id,
          factory: String(data.factory || this.selectedFactory),
          materialCode: String(data.materialCode ?? '').trim(),
          poNumber: String(data.poNumber ?? '').trim(),
          location: String(data.location ?? data.viTri ?? '').trim().toUpperCase() || '—',
          stock,
          unit: String(data.unit ?? '').trim(),
          hideReason: String(data.hideReason || ''),
          hiddenBy: String(data.hiddenBy || ''),
          hiddenAt,
          deleteAfterAt,
          daysLeft
        };
      });

      rows.sort((a, b) => {
        const ta = a.hiddenAt?.getTime() || 0;
        const tb = b.hiddenAt?.getTime() || 0;
        return tb - ta;
      });
      this.hiddenInventoryRows = rows;
    } catch (error: any) {
      console.error('❌ loadHiddenInventoryList:', error);
      alert(`❌ Lỗi tải danh mục Ẩn: ${error?.message || error}`);
      this.hiddenInventoryRows = [];
    } finally {
      this.isLoadingHiddenInventory = false;
    }
  }

  /** Đưa dòng từ danh mục Ẩn về lại inventory. */
  async pushbackHiddenItem(row: HiddenInventoryRow): Promise<void> {
    if (!row?.id || this.pushbackHiddenId) return;
    if (!this.canDelete) {
      alert('❌ Bạn không có quyền Pushback. Liên hệ admin.');
      return;
    }
    if (!this.materialsInventoryUnlock.isUnlocked()) {
      alert('❌ Phiên OTP đã hết hạn. Mở lại Danh mục Ẩn từ More và nhập mã OTP mới.');
      this.closeHiddenInventoryPopup();
      return;
    }
    const ok = confirm(
      `Pushback ${row.materialCode} về ${this.selectedFactory} Inventory?\n\n` +
        `PO: ${row.poNumber || '—'}\nVị trí: ${row.location}\nTồn lúc ẩn: ${row.stock}`
    );
    if (!ok) return;

    this.pushbackHiddenId = row.id;
    try {
      const hiddenRef = this.firestore.collection(this.hiddenInventoryCollection).doc(row.id).ref;
      const invRef = this.firestore.collection('inventory-materials').doc(row.id).ref;
      const [hiddenSnap, invSnap] = await Promise.all([hiddenRef.get(), invRef.get()]);
      if (!hiddenSnap.exists) {
        alert('⚠️ Dòng này không còn trong danh mục Ẩn.');
        this.hiddenInventoryRows = this.hiddenInventoryRows.filter((r) => r.id !== row.id);
        return;
      }
      if (invSnap.exists) {
        alert(
          `❌ Không Pushback được: inventory đã có document cùng ID.\n` +
            `Mã: ${row.materialCode}`
        );
        return;
      }

      const data = { ...(hiddenSnap.data() as any) };
      const metaKeys = [
        'originalId',
        'hideReason',
        'hiddenBy',
        'hiddenAt',
        'deleteAfterAt',
        'stockAtHide'
      ];
      metaKeys.forEach((k) => delete data[k]);
      data.factory = data.factory || this.selectedFactory;
      data.updatedAt = new Date();

      const batch = this.firestore.firestore.batch();
      batch.set(invRef, data);
      batch.delete(hiddenRef);
      await batch.commit();

      this.hiddenInventoryRows = this.hiddenInventoryRows.filter((r) => r.id !== row.id);

      // Nạp lại dòng vừa pushback vào list nếu factory khớp
      try {
        const restored = await invRef.get();
        if (restored.exists) {
          const mapped = this.mapFirestoreDocToInventoryMaterialForPxk({
            id: restored.id,
            data: () => restored.data()
          });
          if (mapped.factory === this.selectedFactory) {
            const idx = this.inventoryMaterials.findIndex((m) => m.id === mapped.id);
            if (idx >= 0) {
              this.inventoryMaterials[idx] = mapped;
            } else {
              this.inventoryMaterials.push(mapped);
            }
            this.applyFilters();
          }
        }
      } catch {
        // Không chặn UX nếu remount local fail — user có thể Load lại
      }

      alert(`✅ Đã Pushback ${row.materialCode} về inventory.`);
    } catch (error: any) {
      console.error('❌ pushbackHiddenItem:', error);
      alert(`❌ Lỗi Pushback: ${error?.message || error}`);
    } finally {
      this.pushbackHiddenId = null;
    }
  }

  hideReasonLabel(reason: string): string {
    switch (reason) {
      case 'manual':
        return 'Ẩn tay';
      case 'reset-zero':
        return 'Reset tồn = 0';
      case 'reset-low-stock':
        return 'Reset tồn < 1';
      default:
        return reason || '—';
    }
  }

  // Delete all inventory for the currently selected factory
  async deleteAllInventory(): Promise<void> {
    try {
      // Confirm deletion with user
      const confirmDelete = confirm(
        `⚠️ CẢNH BÁO: Bạn có chắc chắn muốn xóa TOÀN BỘ tồn kho ${this.selectedFactory}?\n\n` +
        'Thao tác này sẽ:\n' +
        `• Xóa tất cả dữ liệu tồn kho ${this.selectedFactory}\n` +
        '• Không thể hoàn tác\n' +
        '• Cần import lại toàn bộ dữ liệu\n\n' +
        'Nhập "DELETE" để xác nhận:'
      );

      if (!confirmDelete) return;

      const userInput = prompt(`Nhập "DELETE" để xác nhận xóa toàn bộ tồn kho ${this.selectedFactory}:`);
      if (userInput !== 'DELETE') {
        alert('❌ Xác nhận không đúng. Thao tác bị hủy.');
        return;
      }

      // Show loading
      this.isLoading = true;

      // Get all inventory documents for the selected factory
      const inventoryQuery = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
      ).get().toPromise();

      if (!inventoryQuery || inventoryQuery.empty) {
        alert(`✅ Không có dữ liệu tồn kho ${this.selectedFactory} để xóa.`);
        this.isLoading = false;
        return;
      }

      const totalItems = inventoryQuery.docs.length;
      console.log(`🗑️ Starting deletion of ${totalItems} ${this.selectedFactory} inventory items...`);
      
      // Delete all documents in batches
      const batchSize = 500; // Firestore batch limit
      const batches = [];
      
      for (let i = 0; i < inventoryQuery.docs.length; i += batchSize) {
        const batch = this.firestore.firestore.batch();
        const batchDocs = inventoryQuery.docs.slice(i, i + batchSize);
        
        batchDocs.forEach(doc => {
          batch.delete(doc.ref);
        });
        
        batches.push(batch);
      }
      
      // Execute all batches
      let deletedCount = 0;
      for (const batch of batches) {
        await batch.commit();
        deletedCount += batchSize;
        console.log(`✅ Deleted batch: ${deletedCount}/${totalItems} items`);
      }
      
      // Clear local data
      this.inventoryMaterials = [];
      this.filteredInventory = [];
      
      // Show success message
      alert(`✅ Đã xóa thành công ${totalItems} items tồn kho ASM1!\n\n` +
            `Bạn có thể import lại dữ liệu mới.`);
      
      console.log(`✅ Successfully deleted all ${totalItems} ASM1 inventory items`);
      
    } catch (error) {
      console.error('❌ Error deleting all inventory:', error);
      alert(`❌ Lỗi khi xóa tồn kho: ${error.message}`);
    } finally {
      this.isLoading = false;
    }
  }

  // completeInventory method removed - replaced with resetZeroStock
  // completeInventory(): void {
  //   this.showCompleted = !this.showCompleted;
  // }


  // Update methods for editing
  // updateExported method removed - exported quantity is now read-only and auto-updated from outbound

  /** Mở/khóa sửa tay cột Vị trí — OTP 4 số qua Zalo bot. */
  tryUnlockLocationColumn(): void {
    if (this.TEMP_UNLOCK_LOCATION_WH_PALLET) return;
    if (this.locationUnlock.isUnlocked()) {
      this.locationUnlock.lock();
      this.closeLayoutLocPicker();
      return;
    }
    const ref = this.dialog.open(LocationUnlockDialogComponent, {
      width: '400px',
      maxWidth: '95vw',
      disableClose: false
    });
    ref.afterClosed().pipe(takeUntil(this.destroy$)).subscribe(ok => {
      if (ok) {
        this.cdr.markForCheck();
      }
    });
  }

  rememberLocationBeforeEdit(material: InventoryMaterial): void {
    (material as { __prevLocation?: string }).__prevLocation = material.location || '';
  }

  private async resolveLocationOperatorId(): Promise<string> {
    const unlocked = this.locationUnlock.getEmployeeId();
    if (unlocked) return unlocked;
    const user = await this.afAuth.currentUser;
    if (!user) return 'UNKNOWN';
    const email = String(user.email || '').trim().toUpperCase();
    const asp = email.match(/ASP\d{4}/);
    if (asp) return asp[0];
    const name = String(user.displayName || '').trim();
    if (name) return name.substring(0, 24);
    return email.substring(0, 24) || 'UNKNOWN';
  }

  /** Nhớ mã NV đã nhập cho Kiểm kê — chỉ hỏi 1 lần, các lần tick KK sau trong cùng phiên (tới khi tải lại trang) dùng lại. */
  private kkOperatorIdCache: string | null = null;

  private async resolveKkOperatorId(): Promise<string | null> {
    // Mobile Kiểm kê: không hỏi/scan mã NV — lấy từ phiên đăng nhập.
    if (this.isMobile) {
      return this.resolveKkOperatorFromSession();
    }
    if (this.kkOperatorIdCache) return this.kkOperatorIdCache;
    const raw = window.prompt('Quét hoặc nhập mã nhân viên để kiểm kê.\nChỉ cần 4 số (vd: 0106), hệ thống tự thêm ASP.\n(Chỉ hỏi 1 lần cho tới khi tải lại trang.)');
    if (raw == null) return null;
    const normalized = String(raw).trim().toUpperCase().replace(/\s+/g, '');
    const shortCode = /^\d{4}$/.test(normalized)
      ? `ASP${normalized}`
      : normalized.slice(0, 7);
    if (!/^ASP\d{4}$/.test(shortCode)) {
      alert('Mã nhân viên không đúng. Nhập 4 số (vd: 0106) hoặc quét ASP + 4 số.');
      return null;
    }
    this.kkOperatorIdCache = shortCode;
    return shortCode;
  }

  /** Operator KK từ user đang login (không popup). */
  private async resolveKkOperatorFromSession(): Promise<string> {
    const unlocked = this.locationUnlock.getEmployeeId();
    if (unlocked) return unlocked;
    try {
      const authUser = await firstValueFrom(this.authService.currentUser);
      const emp = String(authUser?.employeeId || '').trim().toUpperCase();
      if (/^ASP\d{4}$/.test(emp.slice(0, 7))) return emp.slice(0, 7);
    } catch { /* ignore */ }
    const user = await this.afAuth.currentUser;
    if (!user) return 'UNKNOWN';
    const email = String(user.email || '').trim().toUpperCase();
    const asp = email.match(/ASP\d{4}/);
    if (asp) return asp[0];
    const name = String(user.displayName || '').trim();
    if (name) return name.substring(0, 24);
    return email.substring(0, 24) || 'UNKNOWN';
  }

  onLocationKeyEnter(material: InventoryMaterial, event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    void this.persistLocationChange(material);
  }

  /** Lưu riêng cột Vị trí lên inventory-materials + material-location-history. */
  private async persistLocationChange(
    material: InventoryMaterial,
    opts?: { bypassUnlock?: boolean; silent?: boolean; allowEmpty?: boolean }
  ): Promise<boolean> {
    if (!opts?.bypassUnlock && !this.isLocationColumnUnlocked && !this.canEdit) return false;
    if (!material?.id) return false;

    const row = material as {
      __prevLocation?: string;
      __locationAtLoad?: string;
      locationManualOverride?: boolean;
      modifiedBy?: string;
    };
    const fromLocation = this.normalizeMultiLocationValue(
      String(row.__prevLocation ?? row.__locationAtLoad ?? '')
    );
    const newLocation = this.normalizeMultiLocationValue(String(material.location ?? ''));
    if (!newLocation && !opts?.allowEmpty) {
      alert('⚠️ Vui lòng nhập vị trí trước khi lưu.');
      return false;
    }
    if (newLocation === fromLocation) {
      if (!opts?.silent) {
        alert('Vị trí không đổi.');
      }
      return false;
    }

    const previousUiLocation = material.location;
    material.location = newLocation;

    const modifiedBy = await this.resolveLocationOperatorId();
    const updatePayload: Record<string, unknown> = {
      ...this.inventoryLocationWriteFields(newLocation),
      updatedAt: new Date(),
      lastModified: firebase.default.firestore.FieldValue.serverTimestamp(),
      modifiedBy,
      locationManualOverride: true
    };

    if ((newLocation === 'F62' || newLocation === 'F62TRA') && material.iqcStatus !== 'Pass') {
      material.iqcStatus = 'Pass';
      updatePayload.iqcStatus = 'Pass';
    }

    try {
      await this.firestore.collection('inventory-materials').doc(material.id).update(updatePayload);

      const changedAt = new Date();
      await this.firestore.collection('material-location-history').add({
        factory: this.selectedFactory,
        materialId: material.id,
        materialCode: material.materialCode,
        poNumber: material.poNumber || '',
        fromLocation,
        toLocation: newLocation,
        changedBy: modifiedBy,
        changeType: opts?.bypassUnlock ? 'mobile-scan' : 'bulk',
        changedAt: firebase.default.firestore.FieldValue.serverTimestamp()
      });

      material.lastStatusAt = changedAt;
      material.lastStatusKind = 'Change location';
      material.lastStatusBy = modifiedBy;
      row.__prevLocation = newLocation;
      row.__locationAtLoad = newLocation;
      row.locationManualOverride = true;
      row.modifiedBy = modifiedBy;
      console.log(`✅ [ASM1] Đã lưu vị trí ${material.materialCode}: ${fromLocation} → ${newLocation} (${modifiedBy})`);
      if (!opts?.silent) {
        alert(`✅ Đã lưu vị trí: ${newLocation}`);
      }
      this.cdr.markForCheck();
      return true;
    } catch (error) {
      material.location = previousUiLocation;
      console.error('[ASM1] persistLocationChange failed', error);
      alert('❌ Không lưu được vị trí lên tồn kho. Vui lòng thử lại hoặc báo IT.');
      this.cdr.markForCheck();
      return false;
    }
  }

  updateLocation(material: InventoryMaterial): void {
    if (!this.isLocationColumnUnlocked && !this.canEdit) return;
    void this.persistLocationChange(material);
  }

  updateType(material: InventoryMaterial): void {
    if (!this.canEdit) return;
    this.updateMaterialInFirebase(material);
    
    // Update negative stock count for real-time display
    this.updateNegativeStockCount();
  }

  /** QTY BAG (rollsOrBags) / LDV: không lưu từ tab Materials — đồng bộ từ tab Inbound. */
  /** QTY BAG (rollsOrBags) - cho phép nhập tay, giá trị ban đầu được đồng bộ từ tab Inbound. */
  onRollsOrBagsKeyEnter(material: InventoryMaterial, event: KeyboardEvent): void {
    // Prevent Enter from bubbling to parent handlers (can cause reload/reset) before Firestore update.
    event.preventDefault();
    event.stopPropagation();
    this.updateRollsOrBags(material);
  }

  updateRollsOrBags(material: InventoryMaterial): void {
    if (!this.canEdit) return;
    if (!material?.id) return;

    const raw = material.rollsOrBags;
    // Normalize number input (allow "1,400" typed/pasted from UI).
    const num =
      raw === '' || raw === null || raw === undefined
        ? 0
        : typeof raw === 'number'
          ? raw
          : parseFloat(String(raw).replace(/,/g, '').trim());
    const normalizedRaw = isFinite(num) ? Math.max(0, num) : 0;
    const normalized = Math.round(normalizedRaw * 10000) / 10000;

    // Validate: QTY BAG must be multiple of Standard Packing (theo master + Rule Bag prefix),
    // trừ khi QTY BAG = đúng tồn kho (in cả lô → in tách tem chuẩn + lẻ).
    if (this.shouldEnforceQtyBagMultipleForMaterial(material.materialCode) && normalized > 0) {
      const sp = this.getStandardPacking(material.materialCode);
      if (
        sp &&
        sp > 0 &&
        !this.isMultipleOfStandardPacking(normalized, sp) &&
        !this.isQtyBagEqualsFullStockForPrint(material, normalized)
      ) {
        alert(
          `❌ QTY BAG không hợp lệ.\n\nStandard Packing = ${sp}\nQTY BAG phải là bội số của Standard Packing (VD: ${sp}, ${sp * 2}, ${sp * 3}...)\n\n` +
            `Ngoại lệ: nhập QTY BAG đúng bằng Tồn kho thì được in tách tem xuất (bịch chuẩn + phần lẻ).`
        );
        // Revert UI to previous persisted value if possible
        const prev = (material as any).__prevRollsOrBags;
        material.rollsOrBags = prev !== undefined ? String(prev) : '';
        return;
      }
    }

    // Keep UI type consistent (rollsOrBags is declared as string in InventoryMaterial).
    material.rollsOrBags = String(normalized);
    material.updatedAt = new Date();
    (material as any).__prevRollsOrBags = normalized;

    this.firestore
      .collection('inventory-materials')
      .doc(material.id)
      .update({
        rollsOrBags: normalized,
        updatedAt: material.updatedAt
      })
      .then(() => {
        console.log(`✅ Updated rollsOrBags for ${material.materialCode} - ${material.poNumber}: ${normalized}`);
      })
      .catch(error => {
        console.error(`❌ Error updating rollsOrBags for ${material.materialCode}:`, error);
      });
  }

  /** BAG (totalBags = gwLdv): tổng số bịch dùng cho đuôi QR inbound. */
  onBagsKeyEnter(material: InventoryMaterial, event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.updateTotalBags(material);
  }

  updateTotalBags(material: InventoryMaterial): void {
    if (!this.canEdit) return;
    if (!material?.id) return;

    const sp = this.getEffectiveStandardPacking(material);

    // Có Standard Packing → cột BAG tự tính ceil(tồn kho ÷ SP) và tự đồng bộ Firebase.
    // Không cần nhập tay số bịch lần đầu nữa.
    if (sp > 0) {
      const derived = this.computeTotalBagsFromStock(material);
      const patch: any = { totalBags: derived, updatedAt: new Date() };
      if (!material.bagTrackingInitialized) {
        material.bagTrackingInitialized = true;
        material.openingStockAtBagInit = this.calculateCurrentStock(material);
        patch.bagTrackingInitialized = true;
        patch.openingStockAtBagInit = material.openingStockAtBagInit;
      }
      material.totalBags = derived;
      material.bagInput = '';
      material.updatedAt = patch.updatedAt;
      this.firestore
        .collection('inventory-materials')
        .doc(material.id)
        .update(patch)
        .then(() => {
          console.log(`✅ Synced totalBags (auto) for ${material.materialCode} - ${material.poNumber}: ${derived}`);
        })
        .catch(error => {
          console.error(`❌ Error syncing totalBags for ${material.materialCode}:`, error);
        });
      return;
    }

    // Không có Standard Packing → không tự tính được; giữ nhập tay số bịch lần đầu.
    if (material.bagTrackingInitialized) {
      return;
    }
    const stock = this.calculateCurrentStock(material);
    if (stock <= 0) {
      return;
    }

    const raw = (material.bagInput ?? material.openingBagsAtInit ?? material.totalBags ?? '') as any;
    const num =
      raw === '' || raw === null || raw === undefined
        ? 0
        : typeof raw === 'number'
          ? raw
          : parseFloat(String(raw).replace(/,/g, '').trim());
    const normalizedRaw = isFinite(num) ? Math.max(0, num) : 0;
    const userBags = Math.floor(normalizedRaw);
    if (userBags < 1) {
      return;
    }

    material.bagTrackingInitialized = true;
    material.openingStockAtBagInit = stock;
    material.totalBags = userBags;
    material.bagInput = '';
    material.updatedAt = new Date();

    this.firestore
      .collection('inventory-materials')
      .doc(material.id)
      .update({
        bagTrackingInitialized: true,
        openingStockAtBagInit: stock,
        totalBags: userBags,
        updatedAt: material.updatedAt
      })
      .then(() => {
        console.log(
          `✅ Khởi tạo bịch (tồn đầu kỳ=${stock}, totalBags=${userBags}) ${material.materialCode} - ${material.poNumber}`
        );
      })
      .catch(error => {
        console.error(`❌ Error updating bag tracking for ${material.materialCode}:`, error);
      });
  }

  isTotalBagsValid(material: InventoryMaterial): boolean {
    if (this.getEffectiveStandardPacking(material) > 0) {
      return this.computeTotalBagsFromStock(material) >= 1;
    }
    return Math.floor(Number(material.totalBags ?? 0)) > 0;
  }

  updateRemarks(material: InventoryMaterial): void {
    if (!this.canEdit) return;
    this.updateMaterialInFirebase(material);
    
    // Update negative stock count for real-time display
    this.updateNegativeStockCount();
  }

  // onHSDChange method removed - HSD column deleted
  // onHSDChange(event: any, material: InventoryMaterial): void {
  //   if (!this.canEditHSD) return;
  //   const dateValue = event.target.value;
  //   if (dateValue) {
  //     material.expiryDate = new Date(dateValue);
  //     this.updateMaterialInFirebase(material);
  //   }
  // }

  onLocationChange(material: InventoryMaterial): void {
    if (!this.isLocationColumnUnlocked && !this.canEdit) return;
    void this.persistLocationChange(material);
  }

  get layoutLocGroups(): LayoutLocGroup[] {
    return getLayoutLocationGroups('J');
  }

  get layoutLocRGroups(): LayoutLocGroup[] {
    return this.layoutLocGroups.filter((g) => /^R\d+$/.test(g.id));
  }

  get layoutLocSGroups(): LayoutLocGroup[] {
    return this.layoutLocGroups.filter((g) => /^S\d{2}$/.test(g.id));
  }

  get layoutLocFamilyGroups(): LayoutLocGroup[] {
    return this.layoutLocFamily === 'S' ? this.layoutLocSGroups : this.layoutLocRGroups;
  }

  setLayoutLocFamily(family: 'R' | 'S'): void {
    if (this.layoutLocFamily === family) return;
    this.layoutLocFamily = family;
    this.layoutLocQuery = '';
    const groups = this.layoutLocFamilyGroups;
    if (!groups.some((g) => g.id === this.layoutLocGroupId)) {
      this.layoutLocGroupId = groups[0]?.id || '';
    }
    this.syncLayoutJFocusBlockFromSelection();
  }

  get layoutLocSelectedList(): string[] {
    return Array.from(this.layoutLocSelected);
  }

  canApplyLayoutLoc(): boolean {
    if (this.layoutLocTypeAssign) {
      return this.layoutLocSelected.size > 0
        || !!String(this.layoutLocManualDraft || '').trim()
        || !!this.kkTypeHomeLocs.get(this.layoutLocTypeAssign);
    }
    const material = this.layoutLocMaterial;
    if (!material) return false;
    if (this.layoutLocSelected.size > 0) return true;
    if (String(this.layoutLocManualDraft || '').trim()) return true;
    const palletNow = String(this.layoutLocPalletDraft || '').trim().toUpperCase();
    const palletPrev = String(material.palletId || '').trim().toUpperCase();
    return palletNow !== palletPrev;
  }

  get layoutLocActiveGroup(): LayoutLocGroup | undefined {
    return this.layoutLocGroups.find((g) => g.id === this.layoutLocGroupId) || this.layoutLocGroups[0];
  }

  get layoutLocFilteredSlots(): string[] {
    const slots = this.layoutLocActiveGroup?.slots || [];
    const q = (this.layoutLocQuery || '').trim().toUpperCase();
    if (!q) return slots;
    return slots.filter((s) => s.toUpperCase().includes(q));
  }

  /** Sơ đồ kệ kho J: dãy R (A/B/C) hoặc dãy S kho mát (7 tầng). */
  get isLayoutJDiagram(): boolean {
    const id = this.layoutLocActiveGroup?.id || '';
    return /^R\d+$/.test(id) || /^S\d{2}$/.test(id);
  }

  get isLayoutJKhoMatGroup(): boolean {
    return /^S\d{2}$/.test(this.layoutLocActiveGroup?.id || '');
  }

  /**
   * Sơ đồ 1 dãy kệ kho J.
   * Kệ R: Block 1..6 × Tầng 4→1 × A/B/C.
   * Kệ S kho mát: Block 1..3 × Tầng 7→1, không A/B/C.
   */
  get layoutJRackDiagram(): Array<{
    block: number;
    levels: Array<{ level: number; cells: Array<{ slot: string; pos: string }> }>;
  }> {
    const group = this.layoutLocActiveGroup;
    if (!group) return [];
    const byBlock = new Map<number, Map<number, Array<{ slot: string; pos: string }>>>();
    const add = (block: number, level: number, slot: string, pos: string) => {
      if (!Number.isFinite(block) || !Number.isFinite(level)) return;
      if (!byBlock.has(block)) byBlock.set(block, new Map());
      const lvMap = byBlock.get(block)!;
      if (!lvMap.has(level)) lvMap.set(level, []);
      lvMap.get(level)!.push({ slot, pos });
    };
    for (const slot of group.slots) {
      const khoMat = slot.match(/^S\d{2}-(\d+)-(\d+)$/i);
      if (khoMat) {
        add(Number(khoMat[1]), Number(khoMat[2]), slot, '●');
        continue;
      }
      const prefix = group.id;
      const rest = slot.slice(prefix.length);
      const dash = rest.indexOf('-');
      if (dash < 0) continue;
      const block = Number(rest.slice(0, dash));
      const lvPos = rest.slice(dash + 1);
      const level = Number(lvPos[0]);
      const pos = lvPos.slice(1);
      add(block, level, slot, pos);
    }
    return Array.from(byBlock.keys())
      .sort((a, b) => a - b)
      .map((block) => ({
        block,
        levels: Array.from(byBlock.get(block)!.keys())
          .sort((a, b) => b - a)
          .map((level) => ({
            level,
            cells: byBlock
              .get(block)!
              .get(level)!
              .sort((a, b) => a.pos.localeCompare(b.pos))
          }))
      }));
  }

  get layoutJFocusBlockView(): {
    block: number;
    levels: Array<{ level: number; cells: Array<{ slot: string; pos: string }> }>;
  } | null {
    if (this.layoutJFocusBlock == null) return null;
    return this.layoutJRackDiagram.find((b) => b.block === this.layoutJFocusBlock) || null;
  }

  layoutJBlockSelectedCount(block: number): number {
    const hit = this.layoutJRackDiagram.find((b) => b.block === block);
    if (!hit) return 0;
    let n = 0;
    for (const lv of hit.levels) {
      for (const c of lv.cells) {
        if (this.isLayoutLocSlotOn(c.slot)) n++;
      }
    }
    return n;
  }

  isLayoutJLevelOn(lv: { cells: Array<{ slot: string }> }): boolean {
    return (lv?.cells || []).some((c) => this.isLayoutLocSlotOn(c.slot));
  }

  /** Kho mát: 1 tầng = 1 mâm. Kệ R: bấm ô A/B/C. */
  toggleLayoutJLevel(lv: { cells: Array<{ slot: string }> }): void {
    const cells = lv?.cells || [];
    if (cells.length === 1) this.toggleLayoutLocSlot(cells[0].slot);
  }

  setLayoutJFocusBlock(block: number | null): void {
    this.layoutJFocusBlock = block;
  }

  private syncLayoutJFocusBlockFromSelection(): void {
    if (this.isLayoutJKhoMatGroup) {
      this.layoutJFocusBlock = null;
      return;
    }
    const selected = Array.from(this.layoutLocSelected);
    for (const b of this.layoutJRackDiagram) {
      if (b.levels.some((lv) => lv.cells.some((c) => selected.includes(c.slot)))) {
        this.layoutJFocusBlock = b.block;
        return;
      }
    }
    this.layoutJFocusBlock = null;
  }

  isLayoutLocPickerRow(material: InventoryMaterial): boolean {
    return this.showLayoutLocPicker && this.layoutLocMaterial?.id === material.id;
  }

  /** KK: bấm cột vị trí → popup nhập mã hoặc chọn ô kệ Layout Kho J. */
  openKkLayoutLocPicker(material: InventoryMaterial, event?: Event): void {
    if (!this.canEdit || this.kkLocMapBusy || !material) return;
    this.openLayoutLocPicker(material, event, 'location');
  }

  openLayoutLocPicker(
    material: InventoryMaterial,
    event?: Event,
    focus: 'location' | 'pallet' = 'location'
  ): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (!this.showKkLocMap && !this.isLocationColumnUnlocked) {
      if (this.TEMP_UNLOCK_LOCATION_WH_PALLET) {
        this.isLocationColumnUnlocked = true;
      } else {
        this.tryUnlockLocationColumn();
        return;
      }
    }
    if (this.isLayoutLocPickerRow(material)) {
      if (this.layoutLocFocus === focus) {
        this.closeLayoutLocPicker();
        return;
      }
      this.layoutLocFocus = focus;
      this.cdr.detectChanges();
      if (focus === 'pallet') this.focusLayoutLocPalletInput();
      return;
    }
    const parts = splitMultiLocations(material.location || '');
    this.layoutLocMaterial = material;
    this.layoutLocFocus = focus;
    this.layoutLocWh = 'J';
    this.layoutLocSelected = new Set(
      parts.map((x) => normalizeLayoutLocToken(x, 'J')).filter(Boolean)
    );
    const groups = getLayoutLocationGroups('J');
    const selectedUpper = new Set(Array.from(this.layoutLocSelected).map((s) => s.toUpperCase()));
    const hit = groups.find((g) => g.slots.some((s) => selectedUpper.has(s.toUpperCase())));
    const suggestedS = this.layoutLocSuggestedSGroupId(material);
    if (hit) {
      this.layoutLocGroupId = hit.id;
      this.layoutLocFamily = /^S\d{2}$/.test(hit.id) ? 'S' : 'R';
    } else if (suggestedS) {
      this.layoutLocGroupId = suggestedS;
      this.layoutLocFamily = 'S';
    } else {
      this.layoutLocGroupId = groups[0]?.id || '';
      this.layoutLocFamily = 'R';
    }
    this.layoutLocQuery = '';
    this.layoutLocManualDraft = '';
    this.layoutLocPalletDraft = String(material.palletId || '').trim().toUpperCase();
    this.syncLayoutJFocusBlockFromSelection();
    this.rememberLocationBeforeEdit(material);
    this.rememberPalletBeforeEdit(material);
    this.showLayoutLocPicker = true;
    this.cdr.detectChanges();
    if (focus === 'pallet') this.focusLayoutLocPalletInput();
  }

  closeLayoutLocPicker(): void {
    this.showLayoutLocPicker = false;
    this.layoutLocMaterial = null;
    this.layoutLocTypeAssign = null;
    this.layoutLocTypeAssignGroups = [];
    this.layoutLocSelected = new Set();
    this.layoutLocPalletDraft = '';
    this.layoutLocManualDraft = '';
    this.layoutLocFocus = 'location';
    this.layoutJFocusBlock = null;
    this.layoutLocFamily = 'R';
    this.cdr.detectChanges();
  }

  private focusLayoutLocPalletInput(): void {
    setTimeout(() => {
      const el = document.getElementById('layout-loc-pallet-input') as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 60);
  }

  /** Thêm vị trí nhập tay từ ô trong popup (phân tách bằng , ; hoặc xuống dòng). */
  addLayoutLocManual(): void {
    const raw = String(this.layoutLocManualDraft || '');
    const tokens = raw
      .split(/[\n,;]+/)
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean);
    if (!tokens.length) return;
    const next = new Set(this.layoutLocSelected);
    for (const t of tokens) next.add(t);
    this.layoutLocSelected = next;
    this.layoutLocManualDraft = '';
  }

  /** Bỏ chọn tất cả vị trí trong popup. */
  clearLayoutLocSelected(): void {
    this.layoutLocSelected = new Set();
  }

  setLayoutLocGroup(id: string): void {
    this.layoutLocGroupId = id;
    this.layoutLocQuery = '';
    this.syncLayoutJFocusBlockFromSelection();
  }

  layoutLocSRuleLabel(groupId: string): string {
    return jKhoMatSRuleLabel(groupId);
  }

  isLayoutLocSRuleMatch(groupId: string): boolean {
    const prefix = this.layoutLocMaterialBPrefix();
    const rule = jKhoMatSRuleOfRow(groupId);
    return !!prefix && !!rule && rule.code === prefix;
  }

  private layoutLocMaterialBPrefix(): string {
    if (this.layoutLocTypeAssign) {
      const prefixes = this.kkTypeGroupPrefixes(this.layoutLocTypeAssignGroups);
      return prefixes.find((p) => /^B\d{3}$/.test(p)) || '';
    }
    const material = this.layoutLocMaterial;
    if (!material) return '';
    return this.kkTypePrefixFromGroup(String(material.materialCode || ''));
  }

  private layoutLocSuggestedSGroupId(material: InventoryMaterial): string {
    const prefix = this.kkTypePrefixFromGroup(String(material?.materialCode || ''));
    return jKhoMatSFirstRowForPrefix(prefix);
  }

  private layoutLocSRuleMismatchMessage(locs: string[]): string {
    const prefix = this.layoutLocMaterialBPrefix();
    if (!prefix || !/^B\d{3}$/.test(prefix)) return '';
    const expected = jKhoMatSFirstRowForPrefix(prefix);
    if (!expected) return '';
    for (const loc of locs) {
      const rowId = jKhoMatSRowIdFromSlot(loc) || (/^S\d{2}$/i.test(loc) ? loc.toUpperCase() : '');
      if (!rowId) continue;
      const rule = jKhoMatSRuleOfRow(rowId);
      if (!rule) continue;
      if (rule.code !== prefix) {
        const want = jKhoMatSRuleLabel(expected);
        const got = jKhoMatSRuleLabel(rowId);
        return `${prefix} quy định để ${want || expected}.\nDãy ${rowId} đang dành cho ${got || rule.code}.\nVẫn lưu vị trí này?`;
      }
    }
    return '';
  }

  toggleLayoutLocSlot(slot: string): void {
    const key = String(slot || '').trim().toUpperCase();
    if (!key) return;
    const next = new Set(this.layoutLocSelected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.layoutLocSelected = next;
  }

  isLayoutLocSlotOn(slot: string): boolean {
    return this.layoutLocSelected.has(String(slot || '').trim().toUpperCase());
  }

  async applyLayoutLocPicker(): Promise<void> {
    if (this.layoutLocTypeAssign) {
      await this.applyKkTypeHomeLocPicker();
      return;
    }
    const material = this.layoutLocMaterial;
    if (!material) return;
    // Gộp phần gõ tay chưa kịp bấm "Thêm".
    if (String(this.layoutLocManualDraft || '').trim()) this.addLayoutLocManual();
    const locs = Array.from(this.layoutLocSelected);
    const mismatch = this.layoutLocSRuleMismatchMessage(locs);
    if (mismatch && !confirm(mismatch)) return;
    const pallet = String(this.layoutLocPalletDraft || '').trim().toUpperCase();
    const prevPallet = String(
      (material as { __prevPalletId?: string }).__prevPalletId ?? material.palletId ?? ''
    ).trim().toUpperCase();

    let locOk = false;
    if (locs.length) {
      material.location = joinMultiLocations(locs);
      locOk = await this.persistLocationChange(material, {
        silent: true,
        bypassUnlock: this.showKkLocMap
      });
    }

    const palOk =
      pallet !== prevPallet ? await this.persistPalletChange(material, pallet, { silent: true, bypassUnlock: true }) : false;

    if ((locOk || palOk) && this.showKkLocMap) this.invalidateKkTypeViewCache();

    if (!locOk && !palOk) {
      alert('Chọn vị trí Kho J hoặc pallet rồi bấm Done.');
      return;
    }
    const savedLoc = material.location || '—';
    this.closeLayoutLocPicker();
    const bits: string[] = [];
    if (locOk) bits.push(`Vị trí: ${savedLoc}`);
    if (palOk || pallet) bits.push(`Pallet: ${pallet || '—'}`);
    alert(`✅ Đã lưu\n${bits.join('\n')}`);
  }

  rememberPalletBeforeEdit(material: InventoryMaterial): void {
    (material as { __prevPalletId?: string }).__prevPalletId = String(material.palletId || '');
  }

  onPalletKeyEnter(material: InventoryMaterial, event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    void this.persistPalletChange(material, String(material.palletId || ''));
  }

  onPalletBlur(material: InventoryMaterial): void {
    void this.persistPalletChange(material, String(material.palletId || ''));
  }

  onWhSelect(material: InventoryMaterial, value: string): void {
    void this.commitWhChange(material, value);
  }

  private async commitWhChange(
    material: InventoryMaterial,
    raw: string,
    opts?: { silent?: boolean; bypassUnlock?: boolean }
  ): Promise<boolean> {
    if (!opts?.bypassUnlock && !this.isLocationColumnUnlocked && !this.canEdit) return false;
    const next = String(raw || '').trim().toUpperCase();
    if (next && next !== 'ASM3' && next !== 'J5' && next !== '00') return false;
    const current = this.locationWhTag(material.location);
    if (next === current) return false;
    this.rememberLocationBeforeEdit(material);
    const bare = this.stripDoiKhoWhPrefix(String(material.location || '').trim());
    if (!bare && next) {
      alert('Nhập vị trí trước khi gán WH.');
      this.cdr.markForCheck();
      return false;
    }
    material.location = next ? `${next}-${bare}` : bare;
    return this.persistLocationChange(material, {
      silent: !!opts?.silent,
      bypassUnlock: !!opts?.bypassUnlock
    });
  }

  private async persistPalletChange(
    material: InventoryMaterial,
    raw: string,
    opts?: { silent?: boolean; bypassUnlock?: boolean }
  ): Promise<boolean> {
    if (!opts?.bypassUnlock && !this.isLocationColumnUnlocked && !this.canEdit) return false;
    if (!material?.id) return false;
    const next = String(raw || '').trim().toUpperCase();
    const prev = String((material as { __prevPalletId?: string }).__prevPalletId || '').trim().toUpperCase();
    if (next === prev) return true;
    const previousUi = material.palletId;
    material.palletId = next;
    try {
      await this.firestore.collection('inventory-materials').doc(material.id).update({
        palletId: next,
        updatedAt: new Date(),
        lastModified: firebase.default.firestore.FieldValue.serverTimestamp(),
        modifiedBy: await this.resolveLocationOperatorId()
      });
      (material as { __prevPalletId?: string }).__prevPalletId = next;
      if (!opts?.silent) {
        alert(next ? `✅ Đã lưu pallet: ${next}` : '✅ Đã xóa pallet.');
      }
      this.cdr.markForCheck();
      return true;
    } catch (error) {
      material.palletId = previousUi;
      console.error('[ASM1] persistPalletChange failed', error);
      if (!opts?.silent) alert('❌ Không lưu được pallet. Vui lòng thử lại.');
      this.cdr.markForCheck();
      return false;
    }
  }



  // Update material in Firebase
  private updateMaterialInFirebase(material: InventoryMaterial): void {
    console.log(`🔍 DEBUG: updateMaterialInFirebase called for ${material.materialCode}`);
    console.log(`🔍 DEBUG: material.id = ${material.id}`);
    
    if (!material.id) {
      console.log(`❌ DEBUG: No material ID - cannot save to Firebase`);
      return;
    }
    
    material.updatedAt = new Date();
    
    console.log(`💾 Saving to Firebase: ${material.materialCode} - Exported: ${material.exported || 0} - XT: ${material.xt || 0}`);
    console.log(`🔍 DEBUG: Full material object:`, material);
    
    // Prepare update data, only include defined values
    // Note: exported field is included when user manually updates it
    const updateData: any = {
      exported: material.exported || 0, // Đảm bảo exported luôn có giá trị
      updatedAt: material.updatedAt
    };
    
    // Chỉ thêm các field có giá trị
    if (material.openingStock !== undefined && material.openingStock !== null) {
      updateData.openingStock = material.openingStock;
    }
    
    if (material.xt !== undefined && material.xt !== null) {
      updateData.xt = material.xt;
    }
    
    if (material.location) {
      updateData.location = material.location;
    }
    
    // Nếu location là F62 hoặc F62TRA, tự động set iqcStatus = 'Pass'
    if ((material.location === 'F62' || material.location === 'F62TRA') && material.iqcStatus !== 'Pass') {
      material.iqcStatus = 'Pass';
      updateData.iqcStatus = 'Pass';
      console.log(`✅ Auto-set IQC status to Pass for ${material.materialCode} (location: ${material.location})`);
    } else if (material.iqcStatus) {
      // Nếu có iqcStatus, cập nhật vào Firebase
      updateData.iqcStatus = material.iqcStatus;
    }
    
    if (material.type) {
      updateData.type = material.type;
    }

    // rollsOrBags (QTY BAG / LDV) và standardPacking: không ghi từ tab Materials — cập nhật ở Inbound / catalog khác.

    if (material.remarks) {
      updateData.remarks = material.remarks;
    }
    
    if (material.expiryDate) {
      updateData.expiryDate = material.expiryDate;
    }
    
    if (material.importDate) {
      updateData.importDate = material.importDate;
    }
    
    if (material.batchNumber) {
      updateData.batchNumber = material.batchNumber;
    }

    this.appendDerivedTotalBagsIfNeeded(material, updateData);

    console.log(`🔍 DEBUG: Update data to Firebase:`, updateData);
    
    this.firestore.collection('inventory-materials').doc(material.id).update(updateData).then(() => {
      console.log(`✅ ASM1 Material updated successfully: ${material.materialCode}`);
      console.log(`📊 Stock updated: ${this.calculateCurrentStock(material)} (Quantity: ${material.quantity} - Exported: ${material.exported} - XT: ${material.xt || 0})`);
      
      // Update negative stock count for real-time display
      this.updateNegativeStockCount();
      
      // Show success message to user
      this.showUpdateSuccessMessage(material);
      
    }).catch(error => {
      console.error(`❌ Error updating ASM1 material ${material.materialCode}:`, error);
      
      // Show error message to user
      this.showUpdateErrorMessage(material, error);
    });
  }

  // Show success message when update is successful
  private showUpdateSuccessMessage(material: InventoryMaterial): void {
    const stock = this.calculateCurrentStock(material);
    console.log(`🎉 Update successful! ${material.materialCode} - New stock: ${stock}`);
    
    // You can add a toast notification here if needed
    // For now, just log to console
  }

  // Show error message when update fails
  private showUpdateErrorMessage(material: InventoryMaterial, error: any): void {
    console.error(`💥 Update failed for ${material.materialCode}:`, error.message);
    
    // You can add an error toast notification here if needed
    // For now, just log to console
  }

  // Calculate current stock for display
  calculateCurrentStock(material: InventoryMaterial): number {
    const openingStockValue = material.openingStock !== null ? material.openingStock : 0;
    const stock = openingStockValue + (material.quantity || 0) - (material.exported || 0) - (material.xt || 0);
    return stock;
  }

  // Calculate total stock for all filtered materials
  getTotalStock(): number {
    if (!this.filteredInventory || this.filteredInventory.length === 0) {
      return 0;
    }
    
    const totalStock = this.filteredInventory.reduce((sum, material) => {
      return sum + this.calculateCurrentStock(material);
    }, 0);

    // Update the BehaviorSubject for reactive updates
    this.totalStockSubject.next(totalStock);
    this.totalBagSubject.next(
      this.filteredInventory.reduce((sum, material) => sum + this.effectiveTotalBags(material), 0)
    );

    return totalStock;
  }

  // 🔧 QUERY LOGIC MỚI: Lấy số lượng xuất từ Outbound theo Material + PO (không còn vị trí)
  // - Trước đây: Query theo Material + PO + Location → Bị lỗi khi Outbound không có vị trí
  // - Bây giờ: Chỉ query theo Material + PO → Lấy tất cả outbound records
  // - Kết quả: Số lượng xuất chính xác cho từng Material + PO
  // - Không còn bị lỗi số âm sai khi search
  async getExportedQuantityFromOutbound(materialCode: string, poNumber: string, location: string): Promise<number> {
    try {
      console.log(`🔍 Getting exported quantity for ${materialCode} - PO: ${poNumber}`);
      
      const outboundRef = this.firestore.collection('outbound-materials');
      const snapshot = await outboundRef
        .ref
        .where('factory', '==', this.selectedFactory)
        .where('materialCode', '==', materialCode)
        .where('poNumber', '==', poNumber)
        .get();

      if (!snapshot.empty) {
        let totalExported = 0;
        snapshot.forEach(doc => {
          const data = doc.data() as any;
          totalExported += (data.exportQuantity || 0);
        });
        
        console.log(`✅ Total exported quantity for ${materialCode} - PO ${poNumber}: ${totalExported}`);
        return totalExported;
      } else {
        console.log(`ℹ️ No outbound records found for ${materialCode} - PO ${poNumber}`);
        return 0;
      }
    } catch (error) {
      console.error(`❌ Error getting exported quantity for ${materialCode} - PO ${poNumber}:`, error);
      return 0;
    }
  }

  /**
   * Outbound lưu `importDate` là chuỗi QR đầy đủ (vd. 25032025-14/77), không khớp Firestore `==` với IMD 8 số trên tồn kho.
   * Trích 8 số DDMMYYYY để khớp với dòng inventory.
   */
  private normalizeOutboundImdToKey(data: any): string {
    const raw = data?.importDate ?? data?.batchNumber ?? data?.batch;
    if (raw == null || raw === '') {
      return '';
    }
    if (typeof raw === 'string') {
      const t = raw.trim();
      const full = /^(\d{8,})(?:-\d+\/\d+)?$/.exec(t);
      if (full) {
        return full[1];
      }
      const prefix = /^(\d{8,})-/.exec(t);
      if (prefix) {
        return prefix[1];
      }
      if (/^\d{8,}$/.test(t)) {
        return t;
      }
    }
    if (raw && typeof (raw as any).toDate === 'function') {
      const d = (raw as any).toDate();
      return d.toLocaleDateString('en-GB').split('/').join('');
    }
    if (raw instanceof Date) {
      return raw.toLocaleDateString('en-GB').split('/').join('');
    }
    return '';
  }

  /** Khớp cột IMD tồn kho: phần số đầu từ batchNumber (>=8 số) nếu có, không thì từ importDate. */
  private getInventoryImdBaseKey(material: InventoryMaterial): string | undefined {
    if (material.batchNumber && String(material.batchNumber).trim()) {
      const b = String(material.batchNumber).trim();
      const m = /^(\d{8,})/.exec(b);
      if (m) {
        return m[1];
      }
    }
    if (material.importDate) {
      return material.importDate.toLocaleDateString('en-GB').split('/').join('');
    }
    return undefined;
  }

  /**
   * Đồng bộ "Đã xuất": query Material + PO, rồi lọc theo 8 số IMD (batch) vì outbound không lưu trùng field với tồn kho.
   */
  async getExportedQuantityFromOutboundFIFO(materialCode: string, poNumber: string, batch?: string): Promise<{ totalExported: number; outboundRecords: any[] }> {
    try {
      const batchKey = batch ? String(batch).trim() : '';
      console.log(`🔍 FIFO export: ${materialCode} - PO: ${poNumber} - IMD key: ${batchKey || '(tất cả)'}`);

      const outboundRef = this.firestore.collection('outbound-materials');
      const normCode = String(materialCode || '').trim();
      const normPo = String(poNumber || '').trim();

      let snapshot: any;
      try {
        snapshot = await outboundRef.ref
          .where('factory', '==', this.selectedFactory)
          .where('materialCode', '==', normCode)
          .where('poNumber', '==', normPo)
          .orderBy('exportDate', 'asc')
          .get();
      } catch {
        snapshot = await outboundRef.ref
          .where('factory', '==', this.selectedFactory)
          .where('materialCode', '==', normCode)
          .where('poNumber', '==', normPo)
          .get();
      }

      if (snapshot.empty) {
        console.log(`ℹ️ No outbound for ${materialCode} - PO ${poNumber}`);
        return { totalExported: 0, outboundRecords: [] };
      }

      let totalExported = 0;
      const outboundRecords: any[] = [];

      snapshot.forEach((doc: any) => {
        const data = doc.data() as any;
        const imdKey = this.normalizeOutboundImdToKey(data);
        if (batchKey) {
          if (!imdKey || imdKey !== batchKey) {
            return;
          }
        }

        let exportQuantity = 0;
        if (data.exportQuantity !== undefined && data.exportQuantity !== null) {
          exportQuantity = data.exportQuantity;
        } else if (data.exported !== undefined && data.exported !== null) {
          exportQuantity = data.exported;
        } else if (data.quantity !== undefined && data.quantity !== null) {
          exportQuantity = data.quantity;
        } else if (data.amount !== undefined && data.amount !== null) {
          exportQuantity = data.amount;
        } else if (data.qty !== undefined && data.qty !== null) {
          exportQuantity = data.qty;
        }
        if (typeof exportQuantity === 'string') {
          exportQuantity = parseFloat(exportQuantity) || 0;
        }

        totalExported += exportQuantity;
        outboundRecords.push({
          id: doc.id,
          materialCode: data.materialCode,
          poNumber: data.poNumber,
          exportQuantity,
          exportDate: data.exportDate,
          location: data.location || 'N/A'
        });
      });

      console.log(
        `✅ FIFO total: ${totalExported} (${outboundRecords.length} dòng) IMD=${batchKey || 'ALL'}`
      );
      return { totalExported, outboundRecords };
    } catch (error) {
      console.error(`❌ Error getExportedQuantityFromOutboundFIFO:`, error);
      return { totalExported: 0, outboundRecords: [] };
    }
  }



  // 🔧 UPDATE LOGIC ĐƠN GIẢN: Cập nhật số lượng xuất từ Outbound
  // - Lấy tổng số lượng xuất từ outbound theo Material + PO
  // - Cập nhật trực tiếp vào inventory
  async updateExportedFromOutboundFIFO(material: InventoryMaterial): Promise<void> {
    try {
      console.log(`🔄 Updating exported quantity for ${material.materialCode} - PO ${material.poNumber}`);
      
      const imdBase = this.getInventoryImdBaseKey(material);
      const { totalExported, outboundRecords } = await this.getExportedQuantityFromOutboundFIFO(
        material.materialCode,
        material.poNumber,
        imdBase
      );
      
      console.log(`🔍 Debug: ${material.materialCode} - PO ${material.poNumber} - Total exported from outbound: ${totalExported}, Records: ${outboundRecords.length}`);
      
      // Debug chi tiết: Kiểm tra từng outbound record
      if (outboundRecords.length > 0) {
        console.log(`📋 Outbound records found:`);
        outboundRecords.forEach((record, index) => {
          console.log(`  ${index + 1}. Material: ${record.materialCode}, PO: ${record.poNumber}, Quantity: ${record.exportQuantity || record.quantity}, Date: ${record.exportDate}`);
        });
      } else {
        console.log(`🔍 No outbound records found for ${material.materialCode} - ${material.poNumber} - ImportDate: ${material.importDate ? material.importDate.toLocaleDateString('en-GB').split('/').join('') : 'N/A'}`);
        console.log(`💡 Checking if outbound records exist with different criteria...`);
        
        // Kiểm tra tất cả outbound records có material code này
        const allOutboundQuery = await this.firestore.collection('outbound-materials')
          .ref
          .where('factory', '==', this.selectedFactory)
          .where('materialCode', '==', material.materialCode)
          .limit(10)
          .get();
        
        if (!allOutboundQuery.empty) {
          console.log(`📋 Found ${allOutboundQuery.size} outbound records with material code ${material.materialCode}:`);
          allOutboundQuery.forEach(doc => {
            const data = doc.data() as any;
            const outboundImportDate = data.importDate ? (typeof data.importDate === 'string' ? data.importDate : data.importDate.toLocaleDateString('en-GB').split('/').join('')) : 'N/A';
            const inventoryImportDate = material.importDate ? material.importDate.toLocaleDateString('en-GB').split('/').join('') : 'N/A';
            console.log(`  - PO: "${data.poNumber}" (type: ${typeof data.poNumber}), ImportDate: "${outboundImportDate}", Quantity: ${data.exportQuantity || data.quantity}`);
            console.log(`    → Inventory PO: "${material.poNumber}" (type: ${typeof material.poNumber}), ImportDate: "${inventoryImportDate}"`);
            
            // Kiểm tra match
            const poMatch = data.poNumber === material.poNumber;
            const importDateMatch = outboundImportDate === inventoryImportDate;
            console.log(`    → PO Match: ${poMatch}, ImportDate Match: ${importDateMatch}`);
          });
        } else {
          console.log(`⚠️ No outbound records found at all for material code ${material.materialCode}`);
        }
      }
      
      // Cập nhật số lượng xuất trực tiếp - CHỈ CẬP NHẬT NẾU TÌM THẤY OUTBOUND RECORDS
      if (outboundRecords.length > 0) {
        console.log(`🔄 BEFORE UPDATE: material.exported = ${material.exported}, totalExported = ${totalExported}`);
        
        if (material.exported !== totalExported) {
          const oldExported = material.exported;
          material.exported = totalExported;
          console.log(`🔄 UPDATING: ${oldExported} → ${totalExported}`);
          
          await this.updateExportedInFirebase(material, totalExported);
          console.log(`✅ AFTER UPDATE: material.exported = ${material.exported}`);
          
          // Force UI update
          this.filteredInventory = [...this.inventoryMaterials];
          console.log(`🔄 UI updated, filteredInventory length: ${this.filteredInventory.length}`);
        } else {
          console.log(`📊 Exported quantity already up-to-date: ${material.exported}`);
        }
      } else {
        // KHÔNG TÌM THẤY OUTBOUND RECORDS - GIỮ NGUYÊN GIÁ TRỊ EXPORTED HIỆN TẠI
        console.log(`⚠️ No outbound records found - Keeping current exported: ${material.exported}`);
        console.log(`💡 This prevents overwriting exported quantity to 0 when outbound data is missing`);
      }

    } catch (error) {
      console.error(`❌ Error updating exported quantity for ${material.materialCode} - PO ${material.poNumber}:`, error);
    }
  }

  // Helper method để cập nhật exported quantity vào Firebase
  private async updateExportedInFirebase(material: InventoryMaterial, exportedQuantity: number): Promise<void> {
    console.log(`🔍 updateExportedInFirebase called with:`);
    console.log(`  - material.id: ${material.id}`);
    console.log(`  - material.materialCode: ${material.materialCode}`);
    console.log(`  - material.poNumber: ${material.poNumber}`);
    console.log(`  - exportedQuantity: ${exportedQuantity}`);
    
    if (!material.id) {
      console.error(`❌ Cannot update: material.id is missing for ${material.materialCode} - PO ${material.poNumber}`);
      return;
    }
    
    try {
      console.log(`🔄 Updating Firebase document: inventory-materials/${material.id}`);
      material.exported = exportedQuantity;
      const updateData: any = {
        exported: exportedQuantity,
        updatedAt: new Date()
      };
      this.appendDerivedTotalBagsIfNeeded(material, updateData);
      console.log(`📝 Update data:`, updateData);
      
      await this.firestore.collection('inventory-materials').doc(material.id).update(updateData);
      console.log(`💾 Exported quantity saved to Firebase: ${material.materialCode} - PO ${material.poNumber} = ${exportedQuantity}`);
    } catch (error) {
      console.error(`❌ Error saving exported quantity to Firebase: ${material.materialCode} - PO ${material.poNumber}:`, error);
      console.error(`❌ Full error details:`, error);
    }
  }
  
  // Test method để kiểm tra logic FIFO
  async testFIFOLogic(materialCode: string, poNumber: string): Promise<void> {
    try {
      console.log(`🧪 Testing FIFO logic for ${materialCode} - PO ${poNumber}`);
      
      // Tìm tất cả dòng inventory cùng Material + PO
      const allInventoryItems = this.inventoryMaterials.filter(item => 
        item.materialCode === materialCode && 
        item.poNumber === poNumber
      );
      
      if (allInventoryItems.length === 0) {
        console.log(`⚠️ No inventory items found for ${materialCode} - PO ${poNumber}`);
        return;
      }
      
      console.log(`📊 Found ${allInventoryItems.length} inventory items:`);
      allInventoryItems.forEach(item => {
        const availableStock = (item.openingStock || 0) + item.quantity - (item.xt || 0);
        console.log(`  Item: Stock=${availableStock}, Exported=${item.exported || 0}, Current=${this.calculateCurrentStock(item)}`);
      });
      
      // Lấy thông tin outbound - Lưu ý: testFIFOLogic không có batch cụ thể nên sẽ query theo Material + PO
      const { totalExported } = await this.getExportedQuantityFromOutboundFIFO(materialCode, poNumber);
      console.log(`📦 Total outbound: ${totalExported}`);
      
      // Mô phỏng phân bổ FIFO
      let remainingExported = totalExported;
      console.log(`🔄 FIFO Distribution Simulation:`);
      
      for (const item of allInventoryItems) {
        if (remainingExported <= 0) break;
        
        const availableStock = (item.openingStock || 0) + item.quantity - (item.xt || 0);
        if (availableStock <= 0) {
          console.log(`  Item: Skip (no stock)`);
          continue;
        }
        
        const exportedFromThisItem = Math.min(remainingExported, availableStock);
        console.log(`  Item: Export ${exportedFromThisItem} from ${availableStock} available, Remaining: ${remainingExported - exportedFromThisItem}`);
        
        remainingExported -= exportedFromThisItem;
      }
      
      console.log(`✅ FIFO test completed for ${materialCode} - PO ${poNumber}`);
      
    } catch (error) {
      console.error(`❌ Error testing FIFO logic for ${materialCode} - PO ${poNumber}:`, error);
    }
  }

  // Test method để kiểm tra dữ liệu outbound
  async testOutboundData(): Promise<void> {
    try {
      console.log('🔍 Testing outbound data...');
      
      // Kiểm tra collection outbound-materials
      const outboundSnapshot = await this.firestore.collection('outbound-materials')
        .ref
        .where('factory', '==', this.selectedFactory)
        .limit(10)
        .get();
      
      console.log(`📊 Found ${outboundSnapshot.size} outbound records for ASM1`);
      
      if (!outboundSnapshot.empty) {
        outboundSnapshot.forEach(doc => {
          const data = doc.data() as any;
          console.log(`📦 Outbound: ${data.materialCode} - PO: ${data.poNumber} - Quantity: ${data.exportQuantity || data.exported || data.quantity || 'N/A'} - Date: ${data.exportDate}`);
        });
      } else {
        console.log('⚠️ No outbound records found for ASM1');
        
        // Kiểm tra xem có collection nào khác không
        console.log('🔍 Checking other possible collections...');
        const collections = ['outbound', 'exports', 'shipments', 'materials-out'];
        
        for (const collectionName of collections) {
          try {
            const snapshot = await this.firestore.collection(collectionName).ref.limit(1).get();
            if (snapshot && !snapshot.empty) {
              console.log(`✅ Found collection: ${collectionName} with ${snapshot.size} documents`);
              const sampleDoc = snapshot.docs[0].data() as any;
              console.log(`📋 Sample document fields:`, Object.keys(sampleDoc));
            }
          } catch (e) {
            console.log(`❌ Collection ${collectionName} not found`);
          }
        }
      }
      
    } catch (error) {
      console.error('❌ Error testing outbound data:', error);
    }
  }

  /**
   * Debug method để kiểm tra vấn đề matching giữa Outbound và Inventory
   */
  async debugInventoryMatching(): Promise<void> {
    try {
      console.log('🔍 Debugging RM1 Inventory matching issue...');
      
      // 1. Kiểm tra dữ liệu Outbound
      console.log('\n📦 === CHECKING OUTBOUND DATA ===');
      const outboundSnapshot = await this.firestore.collection('outbound-materials')
        .ref
        .where('factory', '==', this.selectedFactory)
        .limit(10)
        .get();
      
      console.log(`📊 Found ${outboundSnapshot.size} outbound records for ASM1`);
      
      if (!outboundSnapshot.empty) {
        console.log('\n📋 Outbound Records:');
        outboundSnapshot.forEach((doc) => {
          const data = doc.data() as any;
          console.log(`  ID: ${doc.id}`);
          console.log(`     Material: ${data.materialCode}`);
          console.log(`     PO: "${data.poNumber}" (type: ${typeof data.poNumber})`);
          console.log(`     ImportDate: ${data.importDate} (type: ${typeof data.importDate})`);
          console.log(`     ExportQuantity: ${data.exportQuantity}`);
          console.log(`     ExportDate: ${data.exportDate}`);
          console.log('     ---');
        });
      }
      
      // 2. Kiểm tra dữ liệu Inventory
      console.log('\n📦 === CHECKING INVENTORY DATA ===');
      const inventorySnapshot = await this.firestore.collection('inventory-materials')
        .ref
        .where('factory', '==', this.selectedFactory)
        .limit(10)
        .get();
      
      console.log(`📊 Found ${inventorySnapshot.size} inventory records for ASM1`);
      
      if (!inventorySnapshot.empty) {
        console.log('\n📋 Inventory Records:');
        inventorySnapshot.forEach((doc) => {
          const data = doc.data() as any;
          console.log(`  ID: ${doc.id}`);
          console.log(`     Material: ${data.materialCode}`);
          console.log(`     PO: "${data.poNumber}" (type: ${typeof data.poNumber})`);
          console.log(`     ImportDate: ${data.importDate} (type: ${typeof data.importDate})`);
          console.log(`     Quantity: ${data.quantity}`);
          console.log(`     Exported: ${data.exported}`);
          console.log(`     Location: ${data.location}`);
          console.log('     ---');
        });
      }
      
      // 3. Tìm matching records
      console.log('\n🔍 === FINDING MATCHING RECORDS ===');
      const outboundRecords: any[] = [];
      const inventoryRecords: any[] = [];
      
      outboundSnapshot.forEach(doc => {
        const data = doc.data() as any;
        outboundRecords.push({ id: doc.id, ...data });
      });
      
      inventorySnapshot.forEach(doc => {
        const data = doc.data() as any;
        inventoryRecords.push({ id: doc.id, ...data });
      });
      
      let matchCount = 0;
      let noMatchCount = 0;
      
      outboundRecords.forEach(outbound => {
        console.log(`\n🔍 Checking outbound: ${outbound.materialCode} - PO: "${outbound.poNumber}"`);
        
        const matches = inventoryRecords.filter(inventory => {
          const materialMatch = inventory.materialCode === outbound.materialCode;
          const poMatch = inventory.poNumber === outbound.poNumber;
          
          // Check import date match
          let importDateMatch = false;
          if (outbound.importDate && inventory.importDate) {
            let outboundDate = '';
            let inventoryDate = '';
            
            // Parse outbound import date
            if (outbound.importDate.toDate) {
              outboundDate = outbound.importDate.toDate().toLocaleDateString('en-GB').split('/').join('');
            } else {
              outboundDate = outbound.importDate.toString();
            }
            
            // Parse inventory import date
            if (inventory.importDate.toDate) {
              inventoryDate = inventory.importDate.toDate().toLocaleDateString('en-GB').split('/').join('');
            } else {
              inventoryDate = inventory.importDate.toString();
            }
            
            importDateMatch = outboundDate === inventoryDate;
          }
          
          return materialMatch && poMatch && importDateMatch;
        });
        
        if (matches.length > 0) {
          matchCount++;
          console.log(`  ✅ FOUND ${matches.length} matching inventory records:`);
          matches.forEach(match => {
            console.log(`    - Inventory ID: ${match.id}`);
            console.log(`    - Current Exported: ${match.exported || 0}`);
            console.log(`    - Outbound Export: ${outbound.exportQuantity || outbound.quantity || 0}`);
          });
        } else {
          noMatchCount++;
          console.log(`  ❌ NO matching inventory records found`);
          console.log(`    - Checking available inventory for material ${outbound.materialCode}:`);
          
          const materialMatches = inventoryRecords.filter(inv => inv.materialCode === outbound.materialCode);
          if (materialMatches.length > 0) {
            console.log(`    - Found ${materialMatches.length} records with same material:`);
            materialMatches.forEach(match => {
              console.log(`      * PO: "${match.poNumber}" vs "${outbound.poNumber}"`);
              console.log(`      * ImportDate: ${match.importDate} vs ${outbound.importDate}`);
            });
          } else {
            console.log(`    - No inventory records found for material ${outbound.materialCode}`);
          }
        }
      });
      
      console.log(`\n📊 === SUMMARY ===`);
      console.log(`✅ Matching records: ${matchCount}`);
      console.log(`❌ No match records: ${noMatchCount}`);
      
      // 4. Kiểm tra logic update
      console.log('\n🔧 === TESTING UPDATE LOGIC ===');
      if (matchCount > 0) {
        console.log('💡 Logic should work for matching records');
        console.log('💡 Check if updateExportedFromOutboundFIFO is being called');
        console.log('💡 Check if updateInventoryExported is being called');
      } else {
        console.log('⚠️ No matching records found - this explains why inventory is not updating');
        console.log('💡 Possible issues:');
        console.log('   - PO Number format mismatch');
        console.log('   - Import Date format mismatch');
        console.log('   - Missing inventory records');
        console.log('   - Data type issues');
      }
      
    } catch (error) {
      console.error('❌ Error during debug:', error);
    }
  }

  // Test sync with detailed debug logging
  async testSyncWithDebug(): Promise<void> {
    try {
      console.log('🧪 Testing sync with detailed debug logging...');
      
      // Kiểm tra dữ liệu hiện tại
      console.log(`📋 Current inventory materials: ${this.inventoryMaterials.length}`);
      if (this.inventoryMaterials.length > 0) {
        const firstMaterial = this.inventoryMaterials[0];
        console.log(`🔍 First material before sync:`, {
          materialCode: firstMaterial.materialCode,
          poNumber: firstMaterial.poNumber,
          batchNumber: firstMaterial.batchNumber,
          exported: firstMaterial.exported
        });
      }
      
      // Test sync với một material cụ thể
      if (this.inventoryMaterials.length > 0) {
        const testMaterial = this.inventoryMaterials[0];
        console.log(`🧪 Testing sync for material: ${testMaterial.materialCode} - PO: ${testMaterial.poNumber}`);
        await this.updateExportedFromOutboundFIFO(testMaterial);
        
        console.log(`🔍 First material after sync:`, {
          materialCode: testMaterial.materialCode,
          poNumber: testMaterial.poNumber,
          batchNumber: testMaterial.batchNumber,
          exported: testMaterial.exported
        });
        
        // Force UI update
        this.filteredInventory = [...this.inventoryMaterials];
        console.log(`🔄 UI updated, filteredInventory length: ${this.filteredInventory.length}`);
      }
      
    } catch (error) {
      console.error('❌ Error testing sync with debug:', error);
      alert(`❌ Error testing sync: ${error.message}`);
    }
  }

  // Simple test method to check if data is loaded
  async testDataLoading(): Promise<void> {
    try {
      console.log('🔍 Testing data loading...');
      
      // Check inventory data
      console.log(`📋 Inventory materials loaded: ${this.inventoryMaterials.length}`);
      if (this.inventoryMaterials.length > 0) {
        const first = this.inventoryMaterials[0];
        console.log(`📦 First material:`, {
          id: first.id,
          materialCode: first.materialCode,
          poNumber: first.poNumber,
          batchNumber: first.batchNumber,
          exported: first.exported,
          quantity: first.quantity
        });
      } else {
        console.log('⚠️ No inventory data loaded, trying backup method...');
        await this.loadInventoryBackup();
      }
      
      // Check outbound data
      const outboundSnapshot = await this.firestore.collection('outbound-materials')
        .ref
        .where('factory', '==', this.selectedFactory)
        .limit(5)
        .get();
      
      console.log(`📤 Outbound records found: ${outboundSnapshot.size}`);
      if (!outboundSnapshot.empty) {
        outboundSnapshot.forEach(doc => {
          const data = doc.data() as any;
          console.log(`📤 Outbound:`, {
            materialCode: data.materialCode,
            poNumber: data.poNumber,
            batch: data.batch || data.batchNumber,
            quantity: data.exportQuantity || data.exported || data.quantity
          });
        });
      }
      
      // Test sync for first material
      if (this.inventoryMaterials.length > 0) {
        const material = this.inventoryMaterials[0];
        console.log(`🔄 Testing sync for: ${material.materialCode} - PO: ${material.poNumber}`);
        
        const { totalExported, outboundRecords } = await this.getExportedQuantityFromOutboundFIFO(
          material.materialCode, 
          material.poNumber, 
          material.batchNumber
        );
        
        console.log(`📊 Sync result:`, {
          totalExported,
          outboundRecords: outboundRecords.length,
          currentExported: material.exported
        });
      }
      
    } catch (error) {
      console.error('❌ Error testing data loading:', error);
    }
  }

  // Backup method to load inventory data if subscription fails
  async loadInventoryBackup(): Promise<void> {
    try {
      console.log('🔄 Loading inventory data using backup method...');
      
      const snapshot = await this.firestore.collection('inventory-materials')
        .ref
        .where('factory', '==', this.selectedFactory)
        .orderBy('importDate', 'desc')
        .limit(1000)
        .get();
      
      console.log(`📦 Backup method found ${snapshot.size} inventory records`);
      
      this.inventoryMaterials = snapshot.docs.map(doc => {
        const data = doc.data() as any;
        const id = doc.id;
        return {
          id: id,
          ...data,
          factory: this.selectedFactory,
          importDate: data.importDate ? new Date(data.importDate.seconds * 1000) : new Date(),
          receivedDate: data.receivedDate ? new Date(data.receivedDate.seconds * 1000) : new Date(),
          expiryDate: data.expiryDate ? new Date(data.expiryDate.seconds * 1000) : new Date(),
          openingStock: data.openingStock || null,
          xt: data.xt || 0,
          source: data.source || 'manual'
        };
      });
      
      this.filteredInventory = [...this.inventoryMaterials];
      console.log(`✅ Backup method loaded ${this.inventoryMaterials.length} materials`);
      
      // 🔧 SIMPLIFIED: Exported quantities loaded directly from Firebase (no auto-update needed)
      console.log('✅ Backup method exported quantities loaded directly from Firebase');
      
    } catch (error) {
      console.error('❌ Error in backup method:', error);
    }
  }

  // Test method để kiểm tra link outbound-inventory
  async testOutboundInventoryLink(materialCode: string, poNumber: string): Promise<void> {
    try {
      console.log(`🔗 Testing outbound-inventory link for ${materialCode} - PO ${poNumber}`);
      
      // 1. Kiểm tra dữ liệu outbound - Lưu ý: testOutboundInventoryLink không có batch cụ thể nên sẽ query theo Material + PO
      const { totalExported, outboundRecords } = await this.getExportedQuantityFromOutboundFIFO(materialCode, poNumber);
      console.log(`📦 Outbound data: ${totalExported} units from ${outboundRecords.length} records`);
      
      // 2. Kiểm tra dữ liệu inventory
      const inventoryItems = this.inventoryMaterials.filter(item => 
        item.materialCode === materialCode && 
        item.poNumber === poNumber
      );
      console.log(`📋 Inventory items: ${inventoryItems.length} found`);
      
      inventoryItems.forEach((item, index) => {
        console.log(`  ${index + 1}. ID: ${item.id}, Location: ${item.location}, Exported: ${item.exported}, Stock: ${this.calculateCurrentStock(item)}`);
      });
      
      // 3. So sánh
      const totalInventoryExported = inventoryItems.reduce((sum, item) => sum + (item.exported || 0), 0);
      console.log(`🔍 Comparison: Outbound total = ${totalExported}, Inventory total = ${totalInventoryExported}`);
      
      if (totalExported === totalInventoryExported) {
        console.log(`✅ Link is working correctly!`);
      } else {
        console.log(`⚠️ Link mismatch! Need to sync.`);
      }
      
    } catch (error) {
      console.error(`❌ Error testing outbound-inventory link:`, error);
    }
  }

  // Tạo dữ liệu test outbound nếu không có
  async createTestOutboundData(): Promise<void> {
    try {
      console.log('🧪 Creating test outbound data...');
      
      // Kiểm tra xem có dữ liệu outbound nào không
      const existingSnapshot = await this.firestore.collection('outbound-materials')
        .ref
        .where('factory', '==', this.selectedFactory)
        .limit(1)
        .get();
      
      if (!existingSnapshot.empty) {
        console.log('✅ Outbound data already exists, no need to create test data');
        return;
      }
      
      // Tạo dữ liệu test cho mã hàng B024052
      const testData = [
        {
          factory: this.selectedFactory,
          materialCode: 'B024052',
          poNumber: 'KZP00525/0207',
          exportQuantity: 5,
          exportDate: new Date(),
          location: 'A1',
          notes: 'Test data - Auto generated'
        },
        {
          factory: this.selectedFactory,
          materialCode: 'B024052',
          poNumber: 'KZP00625/0070',
          exportQuantity: 3,
          exportDate: new Date(),
          location: 'B2',
          notes: 'Test data - Auto generated'
        }
      ];
      
      // Thêm vào Firebase
      for (const data of testData) {
        await this.firestore.collection('outbound-materials').add(data);
        console.log(`✅ Created test outbound record: ${data.materialCode} - PO ${data.poNumber} - Quantity: ${data.exportQuantity}`);
      }
      
      console.log('✅ Test outbound data created successfully!');
      
      // Refresh dữ liệu
      setTimeout(() => {
        this.autoUpdateAllExportedFromOutbound();
      }, 1000);
      
    } catch (error) {
      console.error('❌ Error creating test outbound data:', error);
    }
  }

  // Cập nhật display sau khi sync để tránh mất dữ liệu
  private updateDisplayAfterSync(): void {
    try {
      console.log('🔄 Updating display after sync...');
      
      // Đảm bảo dữ liệu exported được giữ nguyên
      this.filteredInventory = this.filteredInventory.map(item => {
        const originalItem = this.inventoryMaterials.find(m => m.id === item.id);
        if (originalItem && originalItem.exported !== undefined) {
          item.exported = originalItem.exported;
        }
        return item;
      });
      
      // Cập nhật counters
      this.updateNegativeStockCount();
      this.updateTotalStockCount();
      
      console.log('✅ Display updated after sync');
      
    } catch (error) {
      console.error('❌ Error updating display after sync:', error);
    }
  }

  // Auto-fix và test toàn bộ hệ thống
  async autoFixAndTest(): Promise<void> {
    try {
      console.log('🔧 Starting auto-fix and test process...');
      
      // 1. Kiểm tra dữ liệu outbound
      console.log('📋 Step 1: Checking outbound data...');
      await this.testOutboundData();
      
      // 2. Tạo dữ liệu test nếu cần
      console.log('📋 Step 2: Creating test data if needed...');
      await this.createTestOutboundData();
      
      // 3. Sync dữ liệu từ outbound
      console.log('📋 Step 3: Syncing data from outbound...');
      await this.syncAllExportedFromOutbound();
      
      // 4. Test link cụ thể
      console.log('📋 Step 4: Testing specific links...');
      if (this.inventoryMaterials.length > 0) {
        const firstMaterial = this.inventoryMaterials[0];
        await this.testOutboundInventoryLink(firstMaterial.materialCode, firstMaterial.poNumber);
      }
      
      console.log('✅ Auto-fix and test process completed!');
      
    } catch (error) {
      console.error('❌ Error during auto-fix and test:', error);
    }
  }

  // Fix cả 2 vấn đề: gộp dòng và hiển thị số lượng xuất
  async fixInventoryIssues(): Promise<void> {
    try {
      console.log('🔧 Fixing inventory issues...');
      
      // 1. Kiểm tra trạng thái hiện tại
      console.log(`📊 Current state: ${this.inventoryMaterials.length} materials, ${this.filteredInventory.length} filtered`);
      
      // 2. Gộp dòng trùng lặp (mã hàng + PO)
      console.log('🔄 Step 1: Consolidating duplicate materials...');
      const beforeCount = this.inventoryMaterials.length;
      this.consolidateInventoryData();
      const afterCount = this.inventoryMaterials.length;
      console.log(`✅ Consolidation: ${beforeCount} → ${afterCount} items`);
      
      // 3. Tạo dữ liệu test outbound nếu cần
      console.log('🔄 Step 2: Creating test outbound data...');
      await this.createTestOutboundData();
      
      // 4. Sync số lượng xuất từ outbound
      console.log('🔄 Step 3: Syncing exported quantities...');
      await this.syncAllExportedFromOutbound();
      
      // 5. Kiểm tra kết quả
      console.log('🔄 Step 4: Checking results...');
      this.inventoryMaterials.forEach((material, index) => {
        console.log(`${index + 1}. ${material.materialCode} - PO: ${material.poNumber} - Exported: ${material.exported} - Stock: ${this.calculateCurrentStock(material)}`);
      });
      
      // 6. Cập nhật display
      this.filteredInventory = [...this.inventoryMaterials];
      this.updateNegativeStockCount();
      
      console.log('✅ Inventory issues fixed!');
      
    } catch (error) {
      console.error('❌ Error fixing inventory issues:', error);
    }
  }

  // Kiểm tra trạng thái gộp dòng
  checkConsolidationStatus(): void {
    try {
      console.log('🔍 Checking consolidation status...');
      
      // Kiểm tra dữ liệu hiện tại
      const materialPoMap = new Map<string, InventoryMaterial[]>();
      
      this.inventoryMaterials.forEach(material => {
        // Gộp theo Mã hàng + PO + Batch
        const key = `${material.materialCode}_${material.poNumber}_${material.batchNumber || 'NO_BATCH'}`;
        if (!materialPoMap.has(key)) {
          materialPoMap.set(key, []);
        }
        materialPoMap.get(key)!.push(material);
      });
      
      // Hiển thị thống kê
      console.log(`📊 Total materials: ${this.inventoryMaterials.length}`);
      console.log(`📊 Unique Material+PO+Batch combinations: ${materialPoMap.size}`);
      
      // Hiển thị các dòng trùng lặp
      materialPoMap.forEach((materials, key) => {
        if (materials.length > 1) {
          console.log(`⚠️ Duplicate found: ${key} (${materials.length} items)`);
          materials.forEach((material, index) => {
            console.log(`  ${index + 1}. ID: ${material.id}, Location: ${material.location}, Type: ${material.type}, Quantity: ${material.quantity}, Exported: ${material.exported}`);
          });
        }
      });
      
      // Kiểm tra số lượng xuất
      const materialsWithExported = this.inventoryMaterials.filter(m => m.exported && m.exported > 0);
      console.log(`📦 Materials with exported quantities: ${materialsWithExported.length}`);
      
      if (materialsWithExported.length > 0) {
        materialsWithExported.forEach(material => {
          console.log(`  📦 ${material.materialCode} - PO ${material.poNumber}: Exported = ${material.exported}`);
        });
      } else {
        console.log('⚠️ No materials have exported quantities!');
      }
      
    } catch (error) {
      console.error('❌ Error checking consolidation status:', error);
    }
  }

  // Gộp dòng ngay lập tức
  forceConsolidateNow(): void {
    try {
      console.log('🚀 Force consolidating inventory data now...');
      
      const beforeCount = this.inventoryMaterials.length;
      console.log(`📊 Before consolidation: ${beforeCount} items`);
      
      // Gộp dòng
      this.consolidateInventoryData();
      
      const afterCount = this.inventoryMaterials.length;
      console.log(`📊 After consolidation: ${afterCount} items`);
      console.log(`✅ Reduced by: ${beforeCount - afterCount} items`);
      
      // Cập nhật display
      this.filteredInventory = [...this.inventoryMaterials];
      this.updateNegativeStockCount();
      
      console.log('✅ Force consolidation completed!');
      
    } catch (error) {
      console.error('❌ Error during force consolidation:', error);
    }
  }

  // Test gộp dòng đơn giản
  simpleConsolidate(): void {
    try {
      console.log('🔧 Simple consolidation test...');
      
      if (!this.inventoryMaterials || this.inventoryMaterials.length === 0) {
        console.log('⚠️ No materials to consolidate');
        return;
      }
      
      console.log(`📊 Input: ${this.inventoryMaterials.length} materials`);
      
      // Tạo map theo Material + PO + Batch
      const map = new Map<string, InventoryMaterial>();
      
      this.inventoryMaterials.forEach((material, index) => {
        const key = `${material.materialCode}_${material.poNumber}_${material.batchNumber || 'NO_BATCH'}`;
        
        console.log(`🔍 Row ${index + 1}: ${material.materialCode} - PO ${material.poNumber} - Batch ${material.batchNumber || 'NO_BATCH'} - Key: ${key}`);
        
        if (map.has(key)) {
          // Gộp với dòng hiện có
          const existing = map.get(key)!;
          console.log(`🔄 Found duplicate! Merging with existing row...`);
          console.log(`  Existing: Quantity=${existing.quantity}, Exported=${existing.exported}`);
          console.log(`  New: Quantity=${material.quantity}, Exported=${material.exported}`);
          
          existing.quantity += material.quantity;
          existing.exported = (existing.exported || 0) + (material.exported || 0);
          existing.xt = (existing.xt || 0) + (material.xt || 0);
          
          // Vị trí và loại hình lấy từ dòng đầu tiên (không gộp)
          // existing.location và existing.type giữ nguyên từ dòng đầu tiên
          
          console.log(`✅ After merge: Quantity=${existing.quantity}, Exported=${existing.exported}`);
        } else {
          // Dòng mới
          map.set(key, { ...material });
          console.log(`✅ New row added to map`);
        }
      });
      
      // Cập nhật dữ liệu
      const beforeCount = this.inventoryMaterials.length;
      this.inventoryMaterials = Array.from(map.values());
      this.filteredInventory = [...this.inventoryMaterials];
      
      console.log(`✅ Simple consolidation: ${beforeCount} → ${this.inventoryMaterials.length} items`);
      
      // Hiển thị kết quả gộp
      console.log(`📊 Final consolidated data:`);
      this.inventoryMaterials.forEach((material, index) => {
        console.log(`  ${index + 1}. ${material.materialCode} - PO ${material.poNumber} - Batch ${material.batchNumber || 'NO_BATCH'} - Quantity: ${material.quantity}`);
      });
      
    } catch (error) {
      console.error('❌ Error in simple consolidation:', error);
    }
  }

  // Test gộp dòng cụ thể cho B001430
  testB001430Consolidation(): void {
    try {
      console.log('🧪 Testing B001430 consolidation specifically...');
      
      if (!this.inventoryMaterials || this.inventoryMaterials.length === 0) {
        console.log('⚠️ No materials to test');
        return;
      }
      
      // Tìm tất cả dòng B001430
      const b001430Rows = this.inventoryMaterials.filter(m => m.materialCode === 'B001430');
      console.log(`📊 Found ${b001430Rows.length} rows with B001430`);
      
      b001430Rows.forEach((row, index) => {
        console.log(`  Row ${index + 1}: PO=${row.poNumber}, Batch=${row.batchNumber}, NK=${row.quantity}, Location=${row.location}`);
      });
      
      // Tìm dòng trùng lặp theo PO + Batch
      const poBatchMap = new Map<string, InventoryMaterial[]>();
      
      b001430Rows.forEach(row => {
        const key = `${row.poNumber}_${row.batchNumber || 'NO_BATCH'}`;
        if (!poBatchMap.has(key)) {
          poBatchMap.set(key, []);
        }
        poBatchMap.get(key)!.push(row);
      });
      
      console.log(`📊 PO+Batch combinations for B001430:`);
      poBatchMap.forEach((rows, key) => {
        console.log(`  ${key}: ${rows.length} rows`);
        if (rows.length > 1) {
          console.log(`    ⚠️ DUPLICATE FOUND! ${rows.length} rows with same PO+Batch`);
          rows.forEach((row, index) => {
            console.log(`      ${index + 1}. NK=${row.quantity}, Location=${row.location}`);
          });
        }
      });
      
      // Thực hiện gộp test
      console.log(`🔄 Testing consolidation for B001430...`);
      this.simpleConsolidate();
      
    } catch (error) {
      console.error('❌ Error in B001430 test:', error);
    }
  }

  // Gộp dòng thủ công khi cần thiết (không tự động gộp)
  async manualConsolidateData(): Promise<void> {
    try {
      console.log('🔄 Manual consolidation started...');
      
      // Lưu dữ liệu exported trước khi gộp
      const exportedData = new Map<string, number>();
      this.inventoryMaterials.forEach(material => {
        const key = `${material.materialCode}_${material.poNumber}`;
        if (material.exported && material.exported > 0) {
          exportedData.set(key, material.exported);
        }
      });
      
      // Gộp dòng
      this.consolidateInventoryData();
      
      // Khôi phục dữ liệu exported sau khi gộp
      this.inventoryMaterials.forEach(material => {
        const key = `${material.materialCode}_${material.poNumber}`;
        if (exportedData.has(key)) {
          material.exported = exportedData.get(key)!;
          // Cập nhật Firebase
          this.updateExportedInFirebase(material, material.exported);
        }
      });
      
      console.log('✅ Manual consolidation completed with exported data preserved!');
      
    } catch (error) {
      console.error('❌ Error during manual consolidation:', error);
    }
  }

  // Update XT (planned export) quantity
  async updateXT(material: InventoryMaterial): Promise<void> {
    try {
      console.log(`📝 Updating XT quantity for ${material.materialCode} - PO ${material.poNumber}: ${material.xt}`);
      
      // Update in Firebase
      this.updateMaterialInFirebase(material);
      
      // Recalculate stock
      const newStock = this.calculateCurrentStock(material);
      console.log(`📊 New stock calculated: ${newStock} (Opening Stock: ${material.openingStock} + Quantity: ${material.quantity} - Exported: ${material.exported} - XT: ${material.xt})`);
      
      // Update negative stock count for real-time display
      this.updateNegativeStockCount();
      
    } catch (error) {
      console.error(`❌ Error updating XT quantity for ${material.materialCode}:`, error);
    }
  }

  // Update opening stock quantity
  async updateOpeningStock(material: InventoryMaterial): Promise<void> {
    if (!this.isManualStockEditOn) return;
    try {
      const openingStockDisplay = material.openingStock !== null ? material.openingStock : 'trống';
      console.log(`📝 Updating opening stock for ${material.materialCode} - PO ${material.poNumber}: ${openingStockDisplay}`);
      
      // Update in Firebase
      this.updateMaterialInFirebase(material);
      
      // Recalculate stock
      const newStock = this.calculateCurrentStock(material);
      const openingStockValue = material.openingStock !== null ? material.openingStock : 0;
      console.log(`📊 New stock calculated: ${newStock} (Opening Stock: ${openingStockValue} + Quantity: ${material.quantity} - Exported: ${material.exported} - XT: ${material.xt})`);
      
      // Update negative stock count for real-time display
      this.updateNegativeStockCount();
      
    } catch (error) {
      console.error(`❌ Error updating opening stock for ${material.materialCode}:`, error);
    }
  }

  // Update exported amount (when Manual ON)
  updateExportedAmount(material: InventoryMaterial): void {
    console.log(`🔍 updateExportedAmount called for: ${material.materialCode} - PO ${material.poNumber}`);
    console.log(`🔍 Current material.exported value: ${material.exported}`);
    console.log(`🔍 Current material.id: ${material.id}`);

    if (!this.isManualStockEditOn) {
      return;
    }
    
    
    // Đảm bảo exported có giá trị hợp lệ
    if (material.exported === null || material.exported === undefined) {
      material.exported = 0;
    }
    
    console.log(`📝 Updating exported amount for ${material.materialCode} - PO ${material.poNumber}: ${material.exported} (by user with delete permission)`);
    
    // Update in Firebase - sử dụng updateMaterialInFirebase như ASM2
    this.updateMaterialInFirebase(material);
    
    // Update negative stock count for real-time display
    this.updateNegativeStockCount();
  }







  // Auto-update all exported quantities from RM1 outbound (silent, no user interaction)
  private async autoUpdateAllExportedFromOutbound(): Promise<void> {
    try {
      console.log('🔄 Auto-updating exported quantities from RM1 outbound with FIFO logic...');
      
      // Debug: Kiểm tra dữ liệu outbound trước
      console.log('🔍 Debug: Checking outbound data...');
      const outboundSnapshot = await this.firestore.collection('outbound-materials')
        .ref
        .where('factory', '==', this.selectedFactory)
        .limit(5)
        .get();
      
      console.log(`🔍 Debug: Found ${outboundSnapshot.size} outbound records for ASM1`);
      if (!outboundSnapshot.empty) {
        outboundSnapshot.forEach(doc => {
          const data = doc.data() as any;
          console.log(`🔍 Debug: Outbound record - Material: ${data.materialCode}, PO: ${data.poNumber}, Quantity: ${data.exportQuantity || data.exported || data.quantity || 'N/A'}`);
        });
      }
      
      let updatedCount = 0;
      let errorCount = 0;
      
      for (const material of this.inventoryMaterials) {
        try {
          console.log(`🔍 Debug: Processing material ${material.materialCode} - PO ${material.poNumber}, current exported: ${material.exported}`);
          await this.updateExportedFromOutboundFIFO(material);
          console.log(`🔍 Debug: After update - exported: ${material.exported}`);
          updatedCount++;
        } catch (error) {
          console.error(`❌ Error auto-updating ${material.materialCode} - PO ${material.poNumber} - Location ${material.location}:`, error);
          errorCount++;
        }
      }
      
      console.log(`✅ Auto-update completed with FIFO logic: ${updatedCount} materials updated, ${errorCount} errors`);
      
      // Refresh the display
      this.filteredInventory = [...this.inventoryMaterials];
      
      // KHÔNG gộp dòng sau khi cập nhật exported để tránh mất dữ liệu
      // this.consolidateInventoryData();
      
      // Sắp xếp FIFO sau khi cập nhật
      this.sortInventoryFIFO();
      
    } catch (error) {
      console.error('❌ Error during auto-update:', error);
    }
  }

  // Auto-update exported quantities for search results only
  private async autoUpdateSearchResultsExportedFromOutbound(): Promise<void> {
    try {
      console.log('🔄 Auto-updating exported quantities for search results with FIFO logic...');
      
      let updatedCount = 0;
      let errorCount = 0;
      
      for (const material of this.filteredInventory) {
        try {
          await this.updateExportedFromOutboundFIFO(material);
          updatedCount++;
        } catch (error) {
          console.error(`❌ Error auto-updating search result ${material.materialCode} - PO ${material.poNumber} - Location ${material.location}:`, error);
          errorCount++;
        }
      }
      
      console.log(`✅ Search results auto-update completed with FIFO logic: ${updatedCount} materials updated, ${errorCount} errors`);
      
    } catch (error) {
      console.error('❌ Error during search results auto-update:', error);
    }
  }

  // Sync all exported quantities from RM1 outbound (manual sync - kept for backward compatibility)
  async syncAllExportedFromOutbound(): Promise<void> {
    try {
      console.log('🔄 Starting manual sync of all exported quantities from RM1 outbound with FIFO logic...');
      console.log(`📋 Total inventory materials to process: ${this.inventoryMaterials.length}`);
      
      let updatedCount = 0;
      let errorCount = 0;
      
      for (let i = 0; i < this.inventoryMaterials.length; i++) {
        const material = this.inventoryMaterials[i];
        console.log(`\n🔄 Processing material ${i + 1}/${this.inventoryMaterials.length}: ${material.materialCode} - PO: ${material.poNumber}`);
        console.log(`  Current exported: ${material.exported || 0}`);
        
        try {
          await this.updateExportedFromOutboundFIFO(material);
          console.log(`  Final exported: ${material.exported || 0}`);
          updatedCount++;
        } catch (error) {
          console.error(`❌ Error syncing ${material.materialCode} - PO ${material.poNumber} - Location ${material.location}:`, error);
          errorCount++;
        }
      }
      
      console.log(`\n✅ Manual sync completed with FIFO logic: ${updatedCount} materials updated, ${errorCount} errors`);
      
      // Refresh the display
      this.filteredInventory = [...this.inventoryMaterials];
      console.log(`🔄 Display refreshed, filteredInventory length: ${this.filteredInventory.length}`);
      
      // KHÔNG gộp dòng sau khi đồng bộ để tránh mất dữ liệu exported
      // this.consolidateInventoryData();
      
      // Sắp xếp FIFO sau khi đồng bộ
      this.sortInventoryFIFO();
      
      // Show success message
      if (errorCount === 0) {
        alert(`✅ Đồng bộ hoàn tất!\n\nĐã cập nhật ${updatedCount} mã hàng từ RM1 outbound.`);
      } else {
        alert(`⚠️ Đồng bộ hoàn tất với ${errorCount} lỗi!\n\nĐã cập nhật ${updatedCount} mã hàng từ RM1 outbound.`);
      }
      
    } catch (error) {
      console.error('❌ Error during manual sync:', error);
      alert('❌ Lỗi khi đồng bộ số lượng xuất từ RM1 outbound!');
    }
  }

  // Get count of materials with negative stock
  getNegativeStockCount(): number {
    // Always count from inventoryMaterials (not filteredInventory) to get real total
    const count = this.inventoryMaterials.filter(material => {
      const stock = this.calculateCurrentStock(material);
      return stock < 0;
    }).length;
    
    // Emit new value to BehaviorSubject for real-time updates
    this.negativeStockSubject.next(count);
    
    console.log(`📊 Negative stock count calculated: ${count} from total ${this.inventoryMaterials.length} materials`);
    
    return count;
  }

  // Update negative stock count manually (for real-time updates)
  private updateNegativeStockCount(): void {
    const count = this.getNegativeStockCount();
    console.log(`📊 Negative stock count updated: ${count}`);
    
    // Also update total stock count
    this.updateTotalStockCount();
  }
  
  // Update total stock count for real-time display
  private updateTotalStockCount(): void {
    if (!this.filteredInventory || this.filteredInventory.length === 0) {
      this.totalStockSubject.next(0);
      this.totalBagSubject.next(0);
      return;
    }

    const totalStock = this.filteredInventory.reduce((sum, material) => {
      return sum + this.calculateCurrentStock(material);
    }, 0);

    this.totalStockSubject.next(totalStock);

    const totalBags = this.filteredInventory.reduce((sum, material) => {
      return sum + this.effectiveTotalBags(material);
    }, 0);
    this.totalBagSubject.next(totalBags);
    console.log(`📊 Total stock count updated: ${totalStock} · bags: ${totalBags}`);
  }





  // Toggle negative stock filter
  toggleNegativeStockFilter(): void {
    console.log('🔄 Toggling negative stock filter...');
    console.log(`📊 Current showOnlyNegativeStock: ${this.showOnlyNegativeStock}`);
    console.log(`📊 Total materials in inventoryMaterials: ${this.inventoryMaterials.length}`);
    console.log(`📊 Total materials in filteredInventory: ${this.filteredInventory.length}`);
    
    this.showOnlyNegativeStock = !this.showOnlyNegativeStock;
    
    if (this.showOnlyNegativeStock) {
      // Filter to show only negative stock items
      // Use filteredInventory as base if inventoryMaterials is empty
      const baseMaterials = this.inventoryMaterials.length > 0 ? this.inventoryMaterials : this.filteredInventory;
      
      this.filteredInventory = baseMaterials.filter(material => {
        const stock = this.calculateCurrentStock(material);
        const isNegative = stock < 0;
        console.log(`🔍 ${material.materialCode} - PO ${material.poNumber}: Stock = ${stock}, Is Negative = ${isNegative}`);
        return isNegative;
      });
      console.log(`🔍 Filtered to show only negative stock items: ${this.filteredInventory.length} items`);
    } else {
      // Show all items
      // Use filteredInventory as base if inventoryMaterials is empty
      const baseMaterials = this.inventoryMaterials.length > 0 ? this.inventoryMaterials : this.filteredInventory;
      this.filteredInventory = [...baseMaterials];
      console.log(`🔍 Showing all items: ${this.filteredInventory.length} items`);
    }
    
    // Force change detection
    this.cdr.detectChanges();
    
    // Update negative stock count after filtering
    this.updateNegativeStockCount();
    
    console.log(`✅ Filter toggled. showOnlyNegativeStock: ${this.showOnlyNegativeStock}, filteredItems: ${this.filteredInventory.length}`);
  }



  // Edit functions for Opening Stock
  startEditingOpeningStock(material: InventoryMaterial): void {
    if (!this.isManualStockEditOn) {
      alert('Tồn đầu đang khóa. Vào More → Manual ON (OTP Zalo ASP0106) để sửa.');
      return;
    }
    material.isEditingOpeningStock = true;
  }

  finishEditingOpeningStock(material: InventoryMaterial): void {
    material.isEditingOpeningStock = false;
    this.updateOpeningStock(material);
  }

  cancelEditingOpeningStock(material: InventoryMaterial): void {
    material.isEditingOpeningStock = false;
    // Revert to original value if needed
  }

  // Edit functions for XT
  startEditingXT(material: InventoryMaterial): void {
    material.isEditingXT = true;
  }

  finishEditingXT(material: InventoryMaterial): void {
    material.isEditingXT = false;
    this.updateXT(material);
  }

  cancelEditingXT(material: InventoryMaterial): void {
    material.isEditingXT = false;
    // Revert to original value if needed
  }

  // Format numbers with thousand separators
  formatNumber(value: any): string {
    if (value === null || value === undefined || value === '') {
      return '0';
    }
    
    const num = parseFloat(value);
    if (isNaN(num)) {
      return '0';
    }
    
    if (num % 1 === 0) {
      return num.toLocaleString('vi-VN');
    } else {
      return num.toLocaleString('vi-VN', { 
        minimumFractionDigits: 0, 
        maximumFractionDigits: 2 
      });
    }
  }

  // Get material name from catalog
  getMaterialName(materialCode: string): string {
    if (this.catalogCache.has(materialCode)) {
      return this.catalogCache.get(materialCode)!.materialName;
    }
    return materialCode;
  }

  // Get material unit from catalog
  getMaterialUnit(materialCode: string): string {
    if (this.catalogCache.has(materialCode)) {
      return this.catalogCache.get(materialCode)!.unit;
    }
    return 'PCS';
  }

  // Get standard packing from catalog
  getStandardPacking(materialCode: string): number {
    const code = String(materialCode || '').trim().toUpperCase();
    const catalogItem = this.catalogCache.get(code);
    return Number(catalogItem?.standardPacking) || 0;
  }

  /** Nhãn MSD/ESD theo mã (đọc từ danh mục NVL — gán sau ở Inbound/Danh mục). Rỗng nếu mã không thuộc danh sách nào. */
  getMsdEsdLabel(materialCode: string): string {
    const item = this.catalogCache.get(materialCode);
    if (!item) return '';
    const labels: string[] = [];
    if (item.isMsd) labels.push('MSD');
    if (item.isEsd) labels.push('ESD');
    return labels.join(' / ');
  }

  onDesktopKkClick(material: InventoryMaterial, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.canEdit) {
      alert('Bạn không có quyền tick KK trên tab này.');
      return;
    }
    if (!material?.id) return;
    void this.toggleKk(material);
  }

  /** Tick "đã kiểm kê" cho dòng — ghi kèm tài khoản đã tick vào đúng doc này, không đọc lại. */
  async toggleKk(material: InventoryMaterial): Promise<void> {
    if (!this.canEdit || !material.id) return;
    const next = !material.kkChecked;
    if (!next) {
      const code = String(material.materialCode || '').trim().toUpperCase() || '(không mã)';
      const po = String(material.poNumber || '').trim();
      if (!confirm(`Bỏ tick KK mã ${code}${po ? ` / PO ${po}` : ''}?`)) {
        this.cdr.markForCheck();
        return;
      }
    }
    const operator = next
      ? await this.resolveKkOperatorId()
      : await this.resolveKkOperatorFromSession();
    if (!operator) {
      this.cdr.markForCheck();
      return;
    }
    const kkAt = new Date();
    const prevScanCount = this.getKkScanCount(material);
    material.kkChecked = next;
    material.kkBy = operator;
    material.kkAt = kkAt;
    if (!next) material.kkScanCount = 0;
    this.cdr.markForCheck();
    try {
      const payload: Record<string, unknown> = {
        kkChecked: next,
        kkBy: operator,
        kkAt,
        updatedAt: new Date()
      };
      if (!next) payload.kkScanCount = 0;
      await this.firestore.collection('inventory-materials').doc(material.id).update(payload);
      // Cache KK theo factory giờ đã cũ (dòng vừa đổi trạng thái tick).
      this.invalidateKkInvSnapCache(this.resolveKkFactoryForMaterial(material));
      this.invalidateKkInvSnapCache(this.selectedFactory);
      if (next) {
        await this.firestore.collection('inventory-kk-history').add({
          inventoryDocId: material.id,
          factory: this.resolveKkFactoryForMaterial(material),
          materialCode: String(material.materialCode || '').trim().toUpperCase(),
          materialName: String(material.materialName || '').trim(),
          poNumber: String(material.poNumber || '').trim(),
          batchNumber: String(material.batchNumber || '').trim(),
          location: String(material.location || '').trim().toUpperCase(),
          quantity: Number(material.quantity) || 0,
          stock: Number(this.calculateCurrentStock(material)) || 0,
          unit: String(material.unit || '').trim(),
          checkedBy: operator,
          checkedAt: kkAt,
          checkedDateKey: this.toDateKey(kkAt),
          createdAt: new Date()
        });
      } else if (this.searchByKk) {
        this.applyFilters();
        this.updateNegativeStockCount();
      }
    } catch (e) {
      console.error('❌ toggleKk:', e);
      material.kkChecked = !next;
      material.kkScanCount = prevScanCount;
      this.cdr.markForCheck();
      alert('❌ Không lưu được trạng thái Kiểm kê.');
    }
  }

  /** Tooltip cho checkbox KK: hiển thị tài khoản + thời điểm tick/bỏ tick gần nhất. */
  getKkTitle(material: InventoryMaterial): string {
    const at = this.normalizeTimestamp(material.kkAt);
    const who = material.kkBy ? ` bởi ${material.kkBy}` : '';
    const when = at ? ` lúc ${this.formatLastStatusDate(at)}` : '';
    return material.kkChecked ? `Đã kiểm kê${who}${when}` : `Chưa kiểm kê${who ? ' — bỏ tick gần nhất' + who + when : ''}`;
  }

  /** Draft SP trên mobile (ô Lượng chẵn bịch/cuộn). */
  getMobileKkSpDraft(material: InventoryMaterial): string {
    const id = String(material?.id || '');
    if (id && this.mobileKkSpDraft[id] !== undefined) {
      return this.mobileKkSpDraft[id];
    }
    const sp = this.getEffectiveStandardPacking(material);
    return sp > 0 ? String(sp) : '';
  }

  setMobileKkSpDraft(material: InventoryMaterial, value: string | number | null): void {
    const id = String(material?.id || '');
    if (!id) return;
    this.mobileKkSpDraft[id] = value === null || value === undefined ? '' : String(value);
  }

  /**
   * Phân tích tồn theo lượng chẵn (SP) — cùng công thức cột BAG / tem chuẩn + lẻ.
   */
  getKkStockBreakdown(material: InventoryMaterial, standardPacking: number): {
    stock: number;
    sp: number;
    bagCount: number;
    fullCount: number;
    fullQty: number;
    oddBags: number;
    oddQty: number;
  } {
    const sp = Math.max(0, Number(standardPacking) || 0);
    const stock = this.calculateCurrentStock(material);
    if (!sp || stock <= 0) {
      return { stock, sp, bagCount: 0, fullCount: 0, fullQty: 0, oddBags: 0, oddQty: 0 };
    }
    const fullCount = Math.floor(stock / sp + 1e-9);
    const oddQty = Math.round((stock - fullCount * sp) * 1e6) / 1e6;
    const oddBags = oddQty > 1e-9 ? 1 : 0;
    const bagCount = fullCount + oddBags;
    return {
      stock,
      sp,
      bagCount,
      fullCount,
      fullQty: fullCount * sp,
      oddBags,
      oddQty: oddBags ? oddQty : 0
    };
  }

  get mobileKkConfirmBreakdown() {
    if (!this.mobileKkConfirmMaterial || !(this.mobileKkConfirmSp > 0)) {
      return null;
    }
    return this.getKkStockBreakdown(this.mobileKkConfirmMaterial, this.mobileKkConfirmSp);
  }

  /** Mobile: tick KK — nếu chưa có SP thì mở luôn bước nhập/xác nhận. */
  onMobileKkTick(material: InventoryMaterial, checked: boolean): void {
    if (!this.canEdit || !material?.id) return;
    if (!checked) {
      void this.toggleKk(material);
      return;
    }
    const draft = this.getMobileKkSpDraft(material);
    const sp = parseFloat(String(draft).replace(/,/g, '').trim());
    if (sp > 0) {
      void this.openMobileKkConfirm(material);
      return;
    }
    // Chưa có lượng chẵn — đánh dấu muốn KK, yêu cầu nhập SP
    material.kkChecked = false;
    this.cdr.markForCheck();
    alert('Vui lòng nhập Lượng chẵn bịch/cuộn rồi bấm Xác nhận.');
  }

  async openMobileKkConfirm(material: InventoryMaterial): Promise<void> {
    if (!this.canEdit || !material?.id || this.mobileKkConfirmBusy) return;
    const raw = this.getMobileKkSpDraft(material);
    const sp = parseFloat(String(raw).replace(/,/g, '').trim());
    if (!Number.isFinite(sp) || sp <= 0) {
      alert('Lượng chẵn bịch/cuộn phải > 0.');
      return;
    }
    const stock = this.calculateCurrentStock(material);
    if (stock <= 0) {
      alert('Tồn kho phải > 0 để kiểm kê.');
      return;
    }
    const code = String(material.materialCode || '').trim().toUpperCase();
    try {
      const live = await this.nvlCatalogFull.getByCode(code);
      if (live) {
        this.mergeNvlItemIntoCatalogCache(live);
        this.persistCatalogCache();
      }
      if ((live || this.catalogCache.get(code))?.standardPackingLocked === true) {
        alert('⚠️ Standard Packing của mã này đang Lock trên Danh mục NVL — không thể cập nhật từ Kiểm kê.');
        return;
      }
    } catch (e) {
      console.warn('openMobileKkConfirm lock check:', e);
    }
    this.mobileKkConfirmMaterial = material;
    this.mobileKkConfirmSp = sp;
    this.showMobileKkConfirm = true;
  }

  cancelMobileKkConfirm(): void {
    if (this.mobileKkConfirmBusy) return;
    this.showMobileKkConfirm = false;
    this.mobileKkConfirmMaterial = null;
    this.mobileKkConfirmSp = 0;
  }

  /** Đồng ý popup: tick KK + ghi Standard Packing vào danh mục NVL. */
  async confirmMobileKk(): Promise<void> {
    const material = this.mobileKkConfirmMaterial;
    const sp = this.mobileKkConfirmSp;
    if (!material?.id || !(sp > 0) || this.mobileKkConfirmBusy) return;

    this.mobileKkConfirmBusy = true;
    try {
      const code = String(material.materialCode || '').trim().toUpperCase();
      const operator = await this.resolveKkOperatorFromSession();

      // 1) Ghi Standard Packing → danh mục NVL (`materials`)
      await this.nvlCatalogFull.update(code, { standardPacking: sp }, operator);
      const existing = this.catalogCache.get(code) || { materialCode: code };
      this.catalogCache.set(code, { ...existing, materialCode: code, standardPacking: sp });
      material.standardPacking = sp;
      // Đồng bộ các dòng cùng mã trên màn hình
      const syncRows = [...this.inventoryMaterials, ...this.filteredInventory, ...this.displayedInventory];
      syncRows.forEach((m) => {
        if (String(m.materialCode || '').trim().toUpperCase() === code) {
          m.standardPacking = sp;
        }
      });
      this.setMobileKkSpDraft(material, String(sp));

      // 2) Tick KK nếu chưa
      if (!material.kkChecked) {
        await this.toggleKk(material);
      }

      this.showMobileKkConfirm = false;
      this.mobileKkConfirmMaterial = null;
      this.mobileKkConfirmSp = 0;
      this.cdr.markForCheck();
    } catch (e) {
      console.error('❌ confirmMobileKk:', e);
      alert('❌ Không lưu được Kiểm kê / Standard Packing. Vui lòng thử lại.');
    } finally {
      this.mobileKkConfirmBusy = false;
    }
  }

  /** Mở sheet quét vị trí mới cho 1 dòng tồn. */
  openMobileLocationScan(material: InventoryMaterial): void {
    if (!material?.id || this.mobileLocScanBusy) return;
    this.mobileLocScanMaterial = material;
    this.mobileLocScanBuffer = '';
    this.showMobileLocScan = true;
    setTimeout(() => this.focusMobileLocScanInput(), 50);
  }

  cancelMobileLocationScan(force = false): void {
    if (this.mobileLocScanBusy && !force) return;
    this.mobileLocScanBusy = false;
    this.showMobileLocScan = false;
    this.mobileLocScanMaterial = null;
    this.mobileLocScanBuffer = '';
  }

  private focusMobileLocScanInput(): void {
    const el = document.getElementById('mat-m-loc-scan-input') as HTMLInputElement | null;
    if (!el) return;
    el.focus();
    el.select();
  }

  onMobileLocScanKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    void this.submitMobileLocationScan();
  }

  /** Scanner bắn vị trí → cập nhật dòng đang chọn. */
  async submitMobileLocationScan(): Promise<void> {
    const material = this.mobileLocScanMaterial;
    if (!material?.id || this.mobileLocScanBusy) return;

    const newLoc = String(this.mobileLocScanBuffer || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');
    if (!newLoc) {
      alert('Vui lòng quét / nhập vị trí mới.');
      setTimeout(() => this.focusMobileLocScanInput(), 0);
      return;
    }

    this.mobileLocScanBusy = true;
    try {
      this.rememberLocationBeforeEdit(material);
      const oldLoc = String(material.location || '').trim().toUpperCase();
      material.location = newLoc;
      const ok = await this.persistLocationChange(material, { bypassUnlock: true, silent: true });
      if (ok) {
        this.showMobileLocScan = false;
        this.mobileLocScanMaterial = null;
        this.mobileLocScanBuffer = '';
        alert(`✅ ${material.materialCode}\n${oldLoc || '—'} → ${newLoc}`);
      } else {
        material.location = oldLoc;
        this.mobileLocScanBuffer = '';
        setTimeout(() => this.focusMobileLocScanInput(), 0);
      }
      this.cdr.markForCheck();
    } finally {
      this.mobileLocScanBusy = false;
    }
  }

  private normalizeTimestamp(v: unknown): Date | null {
    if (!v) return null;
    if (v instanceof Date) return v;
    const ts = v as { toDate?: () => Date; seconds?: number };
    if (typeof ts.toDate === 'function') return ts.toDate();
    if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
    return null;
  }

  /** Bấm Kiểm Kê: chạy trên Inventory hiện tại (theo nhà máy đang chọn), không mở popup. */
  runKkCheckOnInventory(): void {
    if (this.kkCheckRunning) return;
    this.showKkCheckPopup = false;
    this.kkCheckRan = false;
    this.kkCheckTotalRows = 0;
    this.kkCheckCheckedRows = 0;
    this.kkCheckByMaterial = [];
    this.kkCheckFilterMode = 'all';
    this.kkCheckSearchCode = '';
    this.kkCheckSearchLocation = '';
    this.kkCheckSelectedFactory = this.selectedFactory;
    void this.runKkCheck();
  }

  /** Ẩn thanh KPI Kiểm Kê trên Inventory. */
  clearKkInlineBanner(force = false): void {
    if (this.kkCheckRunning && !force) return;
    this.kkCheckRunId++;
    this.kkCheckRunning = false;
    this.kkCheckRan = false;
    this.kkCheckTotalRows = 0;
    this.kkCheckCheckedRows = 0;
    this.kkCheckByMaterial = [];
  }

  /** @deprecated Dùng runKkCheckOnInventory — giữ tên cũ phòng chỗ gọi khác. */
  openKkCheckPopup(): void {
    this.runKkCheckOnInventory();
  }

  closeKkCheckPopup(): void {
    if (this.kkCheckRunning) return;
    this.showKkCheckPopup = false;
  }

  setKkCheckFactory(factory: 'ASM1' | 'ASM2' | 'ASM3'): void {
    if (this.kkCheckRunning || this.kkCheckSelectedFactory === factory) return;
    this.kkCheckSelectedFactory = factory;
    this.kkCheckRan = false;
    this.kkCheckTotalRows = 0;
    this.kkCheckCheckedRows = 0;
    this.kkCheckByMaterial = [];
    this.kkCheckFilterMode = 'all';
    this.kkCheckSearchCode = '';
    this.kkCheckSearchLocation = '';
    void this.runKkCheck();
  }

  setKkCheckFilterMode(mode: 'all' | 'checked' | 'unchecked'): void {
    this.kkCheckFilterMode = mode;
  }

  get kkCheckProgressPercent(): number {
    if (!this.kkCheckTotalRows) return 0;
    return Math.min(100, (this.kkCheckCheckedRows / this.kkCheckTotalRows) * 100);
  }

  get kkTickedCountLabel(): number {
    return this.kkTickedMaterialsCache.length || this.filteredInventory.length;
  }

  getKkRowProgress(row: { total: number; checked: number }): number {
    if (!row?.total) return 0;
    return Math.min(100, (row.checked / row.total) * 100);
  }

  get kkCheckDoneCount(): number {
    return this.kkCheckByMaterial.filter((r) => r.remaining === 0).length;
  }

  get kkCheckPendingCount(): number {
    return this.kkCheckByMaterial.filter((r) => r.remaining > 0).length;
  }

  /** Danh sách mã hiển thị trong bảng theo bộ lọc trạng thái + tìm mã / vị trí (nhóm vị trí). */
  get kkCheckFilteredMaterials(): Array<{ materialCode: string; total: number; checked: number; remaining: number; locations: string }> {
    let rows = this.kkCheckByMaterial;
    if (this.kkCheckFilterMode === 'checked') {
      rows = rows.filter((r) => r.remaining === 0);
    } else if (this.kkCheckFilterMode === 'unchecked') {
      rows = rows.filter((r) => r.remaining > 0);
    }
    const codeQ = (this.kkCheckSearchCode || '').trim().toUpperCase();
    const locQ = (this.kkCheckSearchLocation || '').trim().toUpperCase();
    if (codeQ) {
      rows = rows.filter((r) => r.materialCode.includes(codeQ));
    }
    if (locQ) {
      rows = rows.filter((r) => this.locationsTextMatchesGroup(r.locations, locQ));
    }
    return rows;
  }

  /** Tồn kho từ raw Firestore doc — cùng công thức calculateCurrentStock. */
  private stockFromInventoryDoc(data: any): number {
    const openingRaw = data?.openingStock;
    const openingStockValue = openingRaw !== null && openingRaw !== undefined && openingRaw !== ''
      ? Number(openingRaw) || 0
      : 0;
    return openingStockValue + (Number(data?.quantity) || 0) - (Number(data?.exported) || 0) - (Number(data?.xt) || 0);
  }

  /** Đọc tồn kho factory — chỉ mã có tồn > 0 → % đã KK = số mã đã tick đủ / tổng mã. */
  async runKkCheck(force = false): Promise<void> {
    const runId = ++this.kkCheckRunId;
    this.kkCheckRunning = true;
    try {
      const factory = this.kkCheckSelectedFactory;
      let docs: any[] = [];

      if (factory === 'ASM3') {
        const [docsAsm3, docsAsm1, docsAsm2] = await Promise.all([
          this.getKkFactoryDocs('ASM3', force),
          this.getKkFactoryDocs('ASM1', force),
          this.getKkFactoryDocs('ASM2', force),
        ]);
        const seen = new Set<string>();
        for (const list of [docsAsm3, docsAsm1, docsAsm2]) {
          for (const doc of list) {
            const data = doc.data() as any;
            const loc = String(data.location || '');
            const docFactory = String(data.factory || '').trim().toUpperCase();
            if (docFactory === 'ASM3' || isAsm3OrWh3PrefixLocation(loc)) {
              if (!seen.has(doc.id)) {
                seen.add(doc.id);
                docs.push(doc);
              }
            }
          }
        }
      } else {
        docs = await this.getKkFactoryDocs(factory, force);
      }

      if (runId !== this.kkCheckRunId) return;

      this.kkTickedMaterialsCache = docs
        .filter((doc) => this.isKkFlagOn((doc.data() as any)?.kkChecked))
        .map((doc) => this.mapKkInventoryDoc(doc));

      // KPI: bỏ WH3 (khi xem ASM1/ASM2) + chỉ dòng tồn > 0
      if (factory !== 'ASM3') {
        docs = docs.filter((doc) => !isAsm3OrWh3PrefixLocation(String((doc.data() as any).location || '')));
      }
      docs = docs.filter((doc) => this.stockFromInventoryDoc(doc.data()) > 0);

      const byMaterial = new Map<string, { total: number; checked: number; locations: Set<string> }>();

      docs.forEach((doc) => {
        const data = doc.data() as any;
        const code = String(data.materialCode || '').trim().toUpperCase();
        if (!code) return;
        const isChecked = this.isKkFlagOn(data.kkChecked);
        const entry = byMaterial.get(code) || { total: 0, checked: 0, locations: new Set<string>() };
        entry.total++;
        if (isChecked) entry.checked++;
        const loc = String(data.location || '').trim().toUpperCase();
        if (loc) entry.locations.add(loc);
        byMaterial.set(code, entry);
      });

      if (runId !== this.kkCheckRunId) return;

      this.kkCheckByMaterial = Array.from(byMaterial.entries())
        .map(([materialCode, v]) => ({
          materialCode,
          total: v.total,
          checked: v.checked,
          remaining: v.total - v.checked,
          locations: Array.from(v.locations).sort().join('\n') || '—'
        }))
        .sort((a, b) => a.materialCode.localeCompare(b.materialCode));

      // Tổng / đã KK theo SỐ MÃ (có tồn > 0), không theo dòng
      this.kkCheckTotalRows = this.kkCheckByMaterial.length;
      this.kkCheckCheckedRows = this.kkCheckByMaterial.filter((r) => r.remaining === 0).length;
      this.kkCheckRan = true;
      // Không tự đổ danh sách đã KK vào lưới ở đây (FIFO sort + phân trang + render toàn bộ
      // là phần nặng nhất). Banner KPI hiện ngay; bấm banner/chip KK mới mở danh sách
      // (dùng kkTickedMaterialsCache — không đọc lại Firestore).
      this.cdr.detectChanges();
    } catch (e) {
      if (runId !== this.kkCheckRunId) return;
      console.error('❌ runKkCheck:', e);
      alert('❌ Lỗi khi chạy Kiểm Kê. Vui lòng thử lại.');
    } finally {
      if (runId === this.kkCheckRunId) {
        this.kkCheckRunning = false;
      }
    }
  }

  async exportKkCatalog(): Promise<void> {
    if (this.kkCatalogExporting) return;
    const dateKey = String(this.kkCatalogDate || '').trim();
    if (!dateKey) {
      alert('Vui lòng chọn ngày kiểm kê.');
      return;
    }

    this.kkCatalogExporting = true;
    try {
      const factory = this.kkCheckSelectedFactory;
      const rows: Array<Record<string, unknown>> = [];

      const historySnapshot = await this.firestore
        .collection('inventory-kk-history', ref =>
          ref
            .where('factory', '==', factory)
            .where('checkedDateKey', '==', dateKey)
            .limit(10000)
        )
        .get()
        .toPromise();

      for (const doc of historySnapshot?.docs || []) {
        const data = doc.data() as any;
        rows.push({
          'Ngày kiểm': dateKey,
          'Nhà máy': String(data.factory || factory),
          'Mã hàng': String(data.materialCode || ''),
          'Tên hàng': String(data.materialName || ''),
          'PO': String(data.poNumber || ''),
          'Batch': String(data.batchNumber || ''),
          'Vị trí': String(data.location || ''),
          'Số lượng lúc kiểm': Number(data.quantity) || 0,
          'Tồn lúc kiểm': Number(data.stock) || 0,
          'ĐVT': String(data.unit || ''),
          'ID kiểm': String(data.checkedBy || ''),
          'Thời gian kiểm': this.formatLastStatusDate(this.normalizeTimestamp(data.checkedAt)),
          'Inventory Doc ID': String(data.inventoryDocId || '')
        });
      }

      if (!rows.length) {
        const docs = await this.loadKkDocsForFactory(factory);
        docs.forEach((doc) => {
          const data = doc.data() as any;
          const kkAt = this.normalizeTimestamp(data.kkAt);
          if (data.kkChecked !== true || this.toDateKey(kkAt) !== dateKey) return;
          rows.push({
            'Ngày kiểm': dateKey,
            'Nhà máy': this.resolveKkFactoryFromDocData(data),
            'Mã hàng': String(data.materialCode || '').trim().toUpperCase(),
            'Tên hàng': String(data.materialName || ''),
            'PO': String(data.poNumber || ''),
            'Batch': String(data.batchNumber || ''),
            'Vị trí': String(data.location || '').trim().toUpperCase(),
            'Số lượng lúc kiểm': Number(data.quantity) || 0,
            'Tồn lúc kiểm': this.calculateKkStockFromDoc(data),
            'ĐVT': String(data.unit || ''),
            'ID kiểm': String(data.kkBy || ''),
            'Thời gian kiểm': this.formatLastStatusDate(kkAt),
            'Inventory Doc ID': String(doc.id || '')
          });
        });
      }

      if (!rows.length) {
        alert(`Không có dữ liệu danh mục KK cho ${factory} ngày ${dateKey}.`);
        return;
      }

      rows.sort((a, b) => {
        const aTime = String(a['Thời gian kiểm'] || '');
        const bTime = String(b['Thời gian kiểm'] || '');
        return aTime.localeCompare(bTime);
      });

      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Danh muc KK');
      XLSX.writeFile(wb, `Danh_muc_KK_${factory}_${dateKey}.xlsx`);
    } catch (e) {
      console.error('❌ exportKkCatalog:', e);
      alert('❌ Không tải được danh mục KK.');
    } finally {
      this.kkCatalogExporting = false;
    }
  }

  private async loadKkDocsForFactory(factory: 'ASM1' | 'ASM2' | 'ASM3'): Promise<any[]> {
    if (factory === 'ASM3') {
      const [snapAsm3, snapAsm1, snapAsm2] = await Promise.all([
        this.firestore.collection('inventory-materials', ref => ref.where('factory', '==', 'ASM3').limit(10000)).get().toPromise(),
        this.firestore.collection('inventory-materials', ref => ref.where('factory', '==', 'ASM1').limit(10000)).get().toPromise(),
        this.firestore.collection('inventory-materials', ref => ref.where('factory', '==', 'ASM2').limit(10000)).get().toPromise()
      ]);
      const docs: any[] = [];
      const seen = new Set<string>();
      for (const snap of [snapAsm3, snapAsm1, snapAsm2]) {
        for (const doc of snap?.docs || []) {
          const data = doc.data() as any;
          const docFactory = String(data.factory || '').trim().toUpperCase();
          if (docFactory === 'ASM3' || isAsm3OrWh3PrefixLocation(String(data.location || ''))) {
            if (!seen.has(doc.id)) {
              seen.add(doc.id);
              docs.push(doc);
            }
          }
        }
      }
      return docs;
    }

    const snapshot = await this.firestore
      .collection('inventory-materials', ref => ref.where('factory', '==', factory).limit(10000))
      .get()
      .toPromise();
    return (snapshot?.docs || []).filter((doc) => !isAsm3OrWh3PrefixLocation(String((doc.data() as any).location || '')));
  }

  private calculateKkStockFromDoc(data: any): number {
    const openingStock = data?.openingStock != null ? Number(data.openingStock) : 0;
    const quantity = Number(data?.quantity) || 0;
    const exported = Number(data?.exported) || 0;
    const xt = Number(data?.xt) || 0;
    return openingStock + quantity - exported - xt;
  }

  private resolveKkFactoryFromDocData(data: any): 'ASM1' | 'ASM2' | 'ASM3' {
    const location = String(data?.location || '');
    const rawFactory = String(data?.factory || '').trim().toUpperCase();
    if (rawFactory === 'ASM3' || isAsm3OrWh3PrefixLocation(location)) return 'ASM3';
    if (rawFactory === 'ASM2') return 'ASM2';
    return 'ASM1';
  }

  private resolveKkFactoryForMaterial(material: InventoryMaterial): 'ASM1' | 'ASM2' | 'ASM3' {
    return this.resolveKkFactoryFromDocData(material);
  }

  private toDateKey(value: Date | null | undefined): string {
    if (!value) return '';
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, '0');
    const dd = String(value.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }





  /**
   * Ngoại lệ quy tắc bội SP: QTY BAG = đúng tồn kho (in cả lô) → cho phép số lẻ so với Standard Packing,
   * tem in tách: n tem bịch chuẩn + 1 tem phần dư (VD tồn 2066, SP 1000 → 1000+1000+66).
   */
  private isQtyBagEqualsFullStockForPrint(material: InventoryMaterial, qtyBag: number): boolean {
    const stock = this.calculateCurrentStock(material);
    if (!(stock > 0) || !(qtyBag > 0)) {
      return false;
    }
    const a = Math.round(Number(stock) * 10000) / 10000;
    const b = Math.round(Number(qtyBag) * 10000) / 10000;
    return Math.abs(a - b) <= 0.0001;
  }

  // Helper method to check if Rolls/Bags is valid for QR printing
  isRollsOrBagsValid(material: InventoryMaterial): boolean {
    const rollsOrBagsValue = material.rollsOrBags;
    if (!rollsOrBagsValue) return false;
    if (typeof rollsOrBagsValue === 'string' && rollsOrBagsValue.trim() === '') return false;
    const qty = parseFloat(String(rollsOrBagsValue).replace(/,/g, '').trim());
    if (!(qty > 0)) return false;
    if (!this.shouldEnforceQtyBagMultipleForMaterial(material.materialCode)) return true;
    const sp = this.getStandardPacking(material.materialCode);
    if (sp && sp > 0) {
      if (this.isMultipleOfStandardPacking(qty, sp)) return true;
      if (this.isQtyBagEqualsFullStockForPrint(material, qty)) return true;
      return false;
    }
    return true;
  }

  private isMultipleOfStandardPacking(qty: number, sp: number): boolean {
    // Work with 4-decimal precision to reduce floating errors
    const scale = 10000;
    const q = Math.round((Number(qty) || 0) * scale);
    const s = Math.round((Number(sp) || 0) * scale);
    if (s <= 0) return true;
    return q % s === 0;
  }

  // Print QR Code for inventory items
  async printQRCode(material: InventoryMaterial): Promise<void> {
    const QRCode = await import('qrcode') as any;
    try {
      console.log('🏷️ Generating QR code for ASM1 material:', material.materialCode);
      
      // Kiểm tra Rolls/Bags trước khi tạo QR
      const rollsOrBagsValue = material.rollsOrBags;
      if (!rollsOrBagsValue || 
          (typeof rollsOrBagsValue === 'string' && rollsOrBagsValue.trim() === '') ||
          parseFloat(String(rollsOrBagsValue).replace(/,/g, '')) <= 0) {
        alert('❌ Không thể in tem QR!\n\nLý do: Thiếu Rolls/Bags\n\nVui lòng nhập số lượng Rolls/Bags trước khi in tem QR.');
        return;
      }
      
      // QTY BAG nhập để in tem
      const qtyBag = parseFloat(String(material.rollsOrBags).replace(/,/g, '')) || 0;
      const totalQuantity = this.calculateCurrentStock(material);
      
      if (!totalQuantity || totalQuantity <= 0) {
        alert('❌ Vui lòng nhập số lượng trước khi tạo QR code!');
        return;
      }
      
      // Rule in tem:
      // - Số tem chuẩn = QTY BAG / Standard Packing
      // - Tem tồn = Tồn kho - QTY BAG
      const standardPacking = this.getStandardPacking(material.materialCode);
      if (!standardPacking || standardPacking <= 0) {
        alert('❌ Standard Packing phải > 0 để in tem theo quy tắc mới.');
        return;
      }
      if (qtyBag <= 0) {
        alert('❌ QTY BAG phải > 0.');
        return;
      }

      const bagTotal = this.effectiveTotalBags(material);
      if (!bagTotal || bagTotal < 1) {
        alert('❌ Không thể in tem QR - thiếu BAG (Số bịch).');
        return;
      }

      // IMD trên QR phải giữ nguyên toàn bộ (vd 2004202601), không cắt về 8 số.
      const importDateStr = this.getImdKeyForMaterial(material);

      const isPartialLabel = qtyBag !== totalQuantity;
      const fullLabelCount = Math.floor(qtyBag / standardPacking + 1e-9);
      let qtyBagRemainder = qtyBag - fullLabelCount * standardPacking;
      // Làm tròn để tránh sai số floating (VD: 105 - 1*100 = 4.999999...)
      qtyBagRemainder = Math.round(qtyBagRemainder * 10000) / 10000;
      if (qtyBagRemainder < 1e-9) qtyBagRemainder = 0;
      const remainingFromStock = Math.max(0, totalQuantity - qtyBag);
      
      console.log('📊 QR calculation:', {
        totalQuantity,
        qtyBag,
        standardPacking,
        fullLabelCount,
        qtyBagRemainder,
        remainingFromStock
      });
      
      // Generate QR codes based on quantity per unit
      // QR code format: Mã hàng|PO|Số đơn vị|IMD (có sequence number nếu duplicate)
      // Sử dụng getDisplayIMD để lấy đúng IMD có sequence number
      const qrCodes = [];
      
      // Sử dụng getDisplayIMD để lấy đúng IMD có sequence number
      const imdForQR = this.getDisplayIMD(material);
      
      console.log('🏷️ QR Code IMD info:', {
        materialCode: material.materialCode,
        poNumber: material.poNumber,
        importDate: material.importDate,
        batchNumber: material.batchNumber,
        displayIMD: imdForQR,
        hasSequenceNumber: imdForQR !== (material.importDate ? material.importDate.toLocaleDateString('en-GB').split('/').join('') : 'N/A')
      });
      
      let bagIndexCounter = 1;
      for (let i = 0; i < fullLabelCount; i++) {
        qrCodes.push({
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          unitNumber: standardPacking,
          qrData: `${material.materialCode}|${material.poNumber}|${standardPacking}|${importDateStr}-${Math.min(bagIndexCounter, bagTotal)}/${bagTotal}`
        });
        bagIndexCounter++;
      }

      // Nếu QTY BAG không chia hết cho Standard Packing, in 1 tem lẻ phần dư
      if (qtyBagRemainder > 0) {
        qrCodes.push({
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          unitNumber: qtyBagRemainder,
          qrData: `${material.materialCode}|${material.poNumber}|${qtyBagRemainder}|${importDateStr}-${Math.min(bagIndexCounter, bagTotal)}/${bagTotal}`
        });
        bagIndexCounter++;
      }

      // In thêm tem tồn nếu còn
      if (remainingFromStock > 0) {
        qrCodes.push({
          materialCode: material.materialCode,
          poNumber: material.poNumber,
          unitNumber: remainingFromStock,
          displayPrefix: 'TỒN',
          qrData: `${material.materialCode}|${material.poNumber}|${remainingFromStock}|${importDateStr}-${Math.min(bagIndexCounter, bagTotal)}/${bagTotal}`
        });
        bagIndexCounter++;
      }

      if (qrCodes.length === 0) {
        alert('❌ Vui lòng nhập đơn vị hợp lệ trước khi tạo QR code!');
        return;
      }

      console.log(`📦 Generated ${qrCodes.length} QR codes for ASM1${isPartialLabel ? ' (Tem lẻ)' : ' (Tem chuẩn)'}`);

      // Generate QR code images
      const qrImages = await Promise.all(
        qrCodes.map(async (qrCode, index) => {
          const qrImage = await QRCode.toDataURL(qrCode.qrData, {
            width: 240,
            margin: 1,
            color: {
              dark: '#000000',
              light: '#FFFFFF'
            }
          });
          
          return {
            image: qrImage,
            materialCode: qrCode.materialCode,
            poNumber: qrCode.poNumber,
            unitNumber: qrCode.unitNumber,
            displayPrefix: qrCode.displayPrefix,
            qrData: qrCode.qrData,
            index: index + 1
          };
        })
      );

      // Create print window
      this.createQRPrintWindow(qrImages, material, isPartialLabel);
      
    } catch (error) {
      console.error('❌ Error generating QR code for ASM1:', error);
      alert('❌ Lỗi khi tạo QR code: ' + error.message);
    }
  }

  // Scan QR for location change — ĐÃ KHÓA: không còn sử dụng
  scanLocationQR(material: InventoryMaterial): void {
    return; // Chức năng cột Change đã khóa
    
    const dialogData: QRScannerData = {
      title: 'Quét Barcode Vị Trí',
      message: 'Camera sẽ tự động quét barcode vị trí mới',
      materialCode: material.materialCode
    };

    const dialogRef = this.dialog.open(QRScannerModalComponent, {
      width: '500px',
      maxWidth: '95vw',
      data: dialogData,
      disableClose: true, // Prevent accidental close
      panelClass: 'qr-scanner-dialog'
    });

    dialogRef.afterClosed().subscribe(result => {
      console.log('📷 QR Scanner result:', result);
      
      if (result && result.success && result.location) {
        // Update location
        const oldLocation = material.location;
        material.location = result.location;
        
        console.log(`📍 Location changed: ${oldLocation} → ${result.location}`);
        
        // Save to Firebase
        this.updateLocation(material);
        
        // Show success message
        const method = result.manual ? 'nhập thủ công' : 'quét QR';
        alert(`✅ Đã thay đổi vị trí thành công!\n\nMã hàng: ${material.materialCode}\nVị trí cũ: ${oldLocation}\nVị trí mới: ${result.location}\n\nPhương thức: ${method}`);
        
      } else if (result && result.cancelled) {
        console.log('❌ QR scan cancelled by user');
      } else {
        console.log('❌ QR scan failed or no result');
      }
    });
  }

  get resetLowStockSelectedCount(): number {
    return this.resetLowStockRows.filter((r) => r.selected).length;
  }

  get resetLowStockAllSelected(): boolean {
    return this.resetLowStockRows.length > 0 && this.resetLowStockRows.every((r) => r.selected);
  }

  toggleAllResetLowStock(checked: boolean): void {
    this.resetLowStockRows.forEach((r) => (r.selected = checked));
  }

  closeResetLowStockPopup(): void {
    this.showResetLowStockPopup = false;
    this.resetLowStockRows = [];
    this.resetZeroDeletedCount = 0;
  }

  /** Nhãn kho hiển thị ở cột WH — J5- → J5; ASM3-/WH3- → ASM3. */
  locationWhTag(location: string | null | undefined): string {
    const raw = String(location || '').trim().toUpperCase();
    if (raw === '00' || raw.startsWith('00-') || raw.startsWith('00+')) return '00';
    if (raw.startsWith('J5-')) return 'J5';
    if (raw === 'TIEUHUY' || raw.startsWith('TIEUHUY')) return 'TIEUHUY';
    if (raw.startsWith('ASM3-') || raw.startsWith('WH3-') || raw.startsWith('ASM3')) return 'ASM3';
    return '';
  }

  /** Bỏ tiền tố J5-/WH3-/ASM3-/00- cũ trước khi gắn tiền tố mới. */
  private stripDoiKhoWhPrefix(location: string): string {
    const raw = String(location || '').trim();
    const m = /^(J5|WH3|ASM3|00|TIEUHUY)-(.+)$/i.exec(raw);
    return m ? m[2] : raw;
  }

  openDoiKho(): void {
    if (!this.isLocationColumnUnlocked && !this.canEdit) {
      this.tryUnlockLocationColumn();
      return;
    }
    this.showDoiKho = true;
    this.doiKhoScanInput = '';
    this.doiKhoPallet = '';
    this.doiKhoWh = null;
    this.doiKhoRows = [];
    this.doiKhoError = '';
    this.doiKhoBusy = false;
    this.doiKhoLoading = false;
    setTimeout(() => {
      const el = document.getElementById('doiKhoScanInput') as HTMLInputElement | null;
      el?.focus();
    }, 80);
  }

  closeDoiKho(): void {
    if (this.doiKhoBusy) return;
    this.showDoiKho = false;
    this.doiKhoScanInput = '';
    this.doiKhoPallet = '';
    this.doiKhoWh = null;
    this.doiKhoRows = [];
    this.doiKhoError = '';
  }

  async submitDoiKhoPallet(event?: Event): Promise<void> {
    event?.preventDefault?.();
    if (this.doiKhoBusy || this.doiKhoLoading) return;
    const pallet = this.normalizeGanPalletCode(this.doiKhoScanInput);
    this.doiKhoScanInput = pallet;
    if (!pallet) {
      this.doiKhoError = 'Vui lòng scan số pallet.';
      return;
    }
    this.doiKhoLoading = true;
    this.doiKhoError = '';
    this.doiKhoPallet = '';
    this.doiKhoRows = [];
    this.doiKhoWh = null;
    this.cdr.detectChanges();
    try {
      const snap = await this.firestore
        .collection('inventory-materials', (ref) => ref.where('factory', '==', this.selectedFactory).limit(10000))
        .get()
        .toPromise();
      const rows: DoiKhoRow[] = [];
      const seen = new Set<string>();
      for (const doc of snap?.docs || []) {
        const data = doc.data() as any;
        const stock = this.stockFromInventoryDoc(data);
        if (stock <= 0) continue;
        const palletId = String(data.palletId || '').trim().toUpperCase();
        if (palletId !== pallet) continue;
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        rows.push({
          id: doc.id,
          materialCode: String(data.materialCode || '').trim(),
          poNumber: String(data.poNumber || '').trim(),
          location: String(data.location || data.viTri || '').trim().toUpperCase(),
          palletId,
          stock,
          selected: true
        });
      }
      if (!rows.length) {
        this.doiKhoError = `Không tìm thấy pallet ${pallet} trên ${this.selectedFactory}.`;
        return;
      }
      this.doiKhoPallet = pallet;
      this.doiKhoRows = rows;
    } catch (e) {
      console.error('submitDoiKhoPallet:', e);
      this.doiKhoError = 'Không tải được tồn kho để dời pallet.';
    } finally {
      this.doiKhoLoading = false;
      this.cdr.detectChanges();
      setTimeout(() => {
        const el = document.getElementById('doiKhoScanInput') as HTMLInputElement | null;
        el?.focus();
        el?.select();
      }, 40);
    }
  }

  /** Đổi tiền tố vị trí sang J5/ASM3 — mã pallet giữ nguyên. */
  async confirmDoiKho(): Promise<void> {
    if (!this.isLocationColumnUnlocked && !this.canEdit) {
      this.tryUnlockLocationColumn();
      return;
    }
    const wh = this.doiKhoWh;
    const selected = this.doiKhoRows.filter((r) => !!r.id);
    if (!wh || !selected.length) return;
    const confirmed = confirm(
      `Dời ${selected.length} dòng pallet ${this.doiKhoPallet} sang kho ${wh}?\n\n` +
        `Vị trí thêm tiền tố "${wh}-". Mã pallet giữ nguyên.`
    );
    if (!confirmed) return;

    this.doiKhoBusy = true;
    this.cdr.detectChanges();
    try {
      const modifiedBy = await this.resolveLocationOperatorId();
      const batchSize = 50;
      for (let i = 0; i < selected.length; i += batchSize) {
        const chunk = selected.slice(i, i + batchSize);
        const batch = this.firestore.firestore.batch();
        chunk.forEach((row) => {
          const bareLocation = this.stripDoiKhoWhPrefix(row.location);
          const newLocation = `${wh}-${bareLocation}`;
          const docRef = this.firestore.collection('inventory-materials').doc(row.id).ref;
          batch.update(docRef, {
            location: newLocation,
            palletId: row.palletId,
            updatedAt: new Date(),
            lastModified: firebase.default.firestore.FieldValue.serverTimestamp(),
            modifiedBy,
            locationManualOverride: true
          });
          const historyRef = this.firestore.collection('material-location-history').doc().ref;
          batch.set(historyRef, {
            factory: this.selectedFactory,
            materialId: row.id,
            materialCode: row.materialCode,
            poNumber: row.poNumber || '',
            fromLocation: row.location,
            toLocation: newLocation,
            palletId: row.palletId,
            changedBy: modifiedBy,
            changeType: 'doi-kho',
            changedAt: firebase.default.firestore.FieldValue.serverTimestamp()
          });
        });
        await batch.commit();
        if (i + batchSize < selected.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      const idSet = new Set(selected.map((r) => r.id));
      this.inventoryMaterials.forEach((m) => {
        if (!m.id || !idSet.has(m.id)) return;
        m.location = `${wh}-${this.stripDoiKhoWhPrefix(m.location)}`;
        m.palletId = this.doiKhoPallet;
        m.lastStatusAt = new Date();
        m.lastStatusKind = 'Change location';
        m.lastStatusBy = modifiedBy;
      });
      this.applyFilters();
      alert(`Đã dời ${selected.length} dòng pallet ${this.doiKhoPallet} sang kho ${wh}.`);
      this.doiKhoBusy = false;
      this.closeDoiKho();
    } catch (error: any) {
      console.error('confirmDoiKho:', error);
      alert(`Lỗi khi dời kho: ${error?.message || error}`);
    } finally {
      this.doiKhoBusy = false;
      this.cdr.markForCheck();
    }
  }

  /** Reset: (1) ẩn tồn = 0, (2) popup chọn ẩn các mã tồn < 1. */
  async resetZeroStock(): Promise<void> {
    const confirmed = confirm(
      `🔄 RESET ${this.selectedFactory} INVENTORY\n\n` +
        `Bước 1: Ẩn tất cả mã có tồn kho = 0 → danh mục Ẩn\n` +
        `Bước 2: Hiện danh sách mã tồn < 1 để bạn tick chọn và ẩn\n\n` +
        `Các dòng ẩn giữ ${this.hiddenRetentionDays} ngày, sau đó gửi backup mail rồi tự xóa.\n\n` +
        `Tiếp tục?`
    );
    if (!confirmed) return;

    this.isResetting = true;
    this.closeResetLowStockPopup();
    try {
      await this.performResetInventory();
    } catch (error: any) {
      console.error('❌ Error during reset:', error);
      alert(`❌ Lỗi khi reset ${this.selectedFactory}: ${error?.message || error}`);
    } finally {
      this.isResetting = false;
    }
  }

  async deleteSelectedLowStock(): Promise<void> {
    const selected = this.resetLowStockRows.filter((r) => r.selected);
    if (selected.length === 0) {
      alert('Chưa chọn mã nào để ẩn.');
      return;
    }
    const confirmed = confirm(
      `👁️ Ẩn ${selected.length} mã đã chọn (tồn < 1)?\n\n` +
        `Các dòng sẽ vào danh mục Ẩn (giữ ${this.hiddenRetentionDays} ngày).`
    );
    if (!confirmed) return;

    this.isDeletingResetLowStock = true;
    try {
      const ids = selected.map((r) => r.id);
      const hiddenCount = await this.hideInventoryDocsByIds(ids, 'reset-low-stock');
      const idSet = new Set(ids);
      this.removeInventoryByIds(idSet);
      this.resetLowStockRows = this.resetLowStockRows.filter((r) => !r.selected);
      if (this.resetLowStockRows.length === 0) {
        this.showResetLowStockPopup = false;
        this.resetZeroDeletedCount = 0;
      }
      alert(`✅ Đã ẩn ${hiddenCount} mã tồn < 1. Xem More → Danh mục Ẩn.`);
    } catch (error: any) {
      console.error('❌ Error hiding low-stock items:', error);
      alert(`❌ Lỗi khi ẩn: ${error?.message || error}`);
    } finally {
      this.isDeletingResetLowStock = false;
    }
  }

  private computeStockFromFirestoreData(data: any): number {
    const openingStock = data.openingStock !== null && data.openingStock !== undefined ? data.openingStock : 0;
    const quantity = data.quantity || 0;
    const exported = data.exported || 0;
    const xt = data.xt || 0;
    return openingStock + quantity - exported - xt;
  }

  private getImdLabelFromFirestoreData(data: any): string {
    const importDate = data.importDate?.toDate?.() || data.importDate;
    if (!importDate) return '—';
    const d = importDate instanceof Date ? importDate : new Date(importDate);
    if (Number.isNaN(d.getTime())) return '—';
    const baseDate = d.toLocaleDateString('en-GB').split('/').join('');
    const bn = String(data.batchNumber ?? '').trim();
    if (bn && bn !== baseDate && /^\d{8,}$/.test(bn)) return bn;
    if (bn && bn.startsWith(baseDate)) {
      const suffix = bn.substring(baseDate.length);
      if (/^\d+$/.test(suffix) && suffix.length > 0) return baseDate + suffix;
    }
    return baseDate;
  }

  private async deleteInventoryDocsByIds(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const batchSize = 50;
    let deletedCount = 0;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = this.firestore.firestore.batch();
      const chunk = ids.slice(i, i + batchSize);
      chunk.forEach((id) => {
        batch.delete(this.firestore.collection('inventory-materials').doc(id).ref);
      });
      await batch.commit();
      deletedCount += chunk.length;
      if (i + batchSize < ids.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    return deletedCount;
  }

  private removeInventoryByIds(ids: Set<string>): void {
    if (!ids.size) return;
    this.inventoryMaterials = this.inventoryMaterials.filter((m) => !m.id || !ids.has(m.id));
    this.applyFilters();
  }

  private async performResetInventory(): Promise<void> {
    console.log(`📡 Querying all ${this.selectedFactory} materials from Firebase...`);
    const snapshot = await this.firestore
      .collection('inventory-materials', (ref) => ref.where('factory', '==', this.selectedFactory))
      .get()
      .toPromise();

    if (!snapshot || snapshot.empty) {
      alert(`✅ Không có mã hàng nào trong ${this.selectedFactory}`);
      return;
    }

    const zeroStockIds: string[] = [];
    const lowStockRows: ResetLowStockRow[] = [];

    snapshot.docs.forEach((doc) => {
      const data = doc.data() as any;
      const stock = this.computeStockFromFirestoreData(data);
      if (stock === 0) {
        zeroStockIds.push(doc.id);
      } else if (stock < 1) {
        lowStockRows.push({
          id: doc.id,
          materialCode: String(data.materialCode ?? '').trim(),
          poNumber: String(data.poNumber ?? '').trim(),
          imd: this.getImdLabelFromFirestoreData(data),
          location: String(data.location ?? data.viTri ?? '').trim().toUpperCase() || '—',
          stock,
          selected: false
        });
      }
    });

    if (zeroStockIds.length === 0 && lowStockRows.length === 0) {
      alert(`✅ Không có mã tồn = 0 hoặc tồn < 1 trong ${this.selectedFactory}`);
      return;
    }

    let hiddenZero = 0;
    if (zeroStockIds.length > 0) {
      hiddenZero = await this.hideInventoryDocsByIds(zeroStockIds, 'reset-zero');
      this.removeInventoryByIds(new Set(zeroStockIds));
      console.log(`✅ ${this.selectedFactory}: hidden ${hiddenZero} items with zero stock`);
    }

    this.resetZeroDeletedCount = hiddenZero;

    if (lowStockRows.length > 0) {
      lowStockRows.sort((a, b) => a.materialCode.localeCompare(b.materialCode) || a.poNumber.localeCompare(b.poNumber));
      this.resetLowStockRows = lowStockRows;
      this.showResetLowStockPopup = true;
      if (hiddenZero > 0) {
        alert(
          `✅ Đã ẩn ${hiddenZero} mã tồn = 0.\nCòn ${lowStockRows.length} mã tồn < 1 — tick chọn và bấm Ẩn trong popup.`
        );
      }
    } else {
      alert(`✅ Reset hoàn thành!\nĐã ẩn ${hiddenZero} mã tồn = 0.`);
    }
  }

  // Reset ALL Stock - Delete ALL inventory items for the currently selected factory
  // (for complete reset before new import). Hành động phá hủy dữ liệu — luôn xác nhận 2 lần
  // và luôn nêu rõ đang xóa của nhà máy nào (quan trọng vì selectedFactory có thể đổi qua factory-switcher).
  async resetAllStock(): Promise<void> {
    const factory = this.selectedFactory;
    try {
      console.log(`🔍 Loading all ${factory} materials for reset...`);
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('factory', '==', factory)
      ).get().toPromise();

      if (!snapshot || snapshot.empty) {
        alert(`✅ Không có dữ liệu tồn kho nào trong ${factory}`);
        return;
      }

      const totalItems = snapshot.docs.length;

      // Show confirmation dialog with strong warning — luôn nêu rõ nhà máy đang chọn
      const confirmed = confirm(
        `⚠️ CẢNH BÁO: XÓA TOÀN BỘ TỒN KHO ${factory} ⚠️\n\n` +
        `Tìm thấy ${totalItems} mã hàng trong ${factory}\n\n` +
        `Bạn có CHẮC CHẮN muốn xóa TẤT CẢ tồn kho của nhà máy ${factory} không?\n\n` +
        `🔴 Hành động này sẽ xóa toàn bộ dữ liệu!\n` +
        `🔴 Không thể hoàn tác!\n` +
        `🔴 Chỉ dùng khi muốn reset hoàn toàn trước khi import mới!\n\n` +
        `Nhấn OK để tiếp tục hoặc Cancel để hủy.`
      );

      if (!confirmed) {
        console.log('❌ User cancelled reset operation');
        return;
      }

      // Second confirmation for extra safety — nhắc lại nhà máy 1 lần nữa
      const doubleConfirmed = confirm(
        `🔴 XÁC NHẬN LẦN CUỐI — NHÀ MÁY ${factory} 🔴\n\n` +
        `Bạn THỰC SỰ muốn xóa ${totalItems} mã hàng của ${factory}?\n\n` +
        `Đây là cơ hội cuối cùng để hủy bỏ!\n\n` +
        `Nhấn OK để XÓA HOÀN TOÀN hoặc Cancel để giữ lại dữ liệu.`
      );

      if (!doubleConfirmed) {
        console.log('❌ User cancelled reset operation at second confirmation');
        return;
      }

      // 🔧 SAFETY: nếu user đổi factory (qua switcher) trong lúc dialog đang mở, hủy để tránh xóa nhầm nhà máy.
      if (this.selectedFactory !== factory) {
        alert('❌ Nhà máy đang chọn đã thay đổi trong lúc xác nhận. Thao tác bị hủy để tránh xóa nhầm dữ liệu.');
        return;
      }

      console.log(`🗑️ Starting COMPLETE reset for ${factory}: ${totalItems} items to delete`);
      this.isLoading = true;

      // Delete all items in batches
      const batchSize = 100;
      let deletedCount = 0;
      const allDocs = snapshot.docs;

      for (let i = 0; i < allDocs.length; i += batchSize) {
        const batch = this.firestore.firestore.batch();
        const currentBatch = allDocs.slice(i, i + batchSize);

        currentBatch.forEach(doc => {
          const docRef = this.firestore.collection('inventory-materials').doc(doc.id).ref;
          batch.delete(docRef);
        });

        await batch.commit();
        deletedCount += currentBatch.length;

        console.log(`✅ ${factory} Complete Reset batch ${Math.floor(i / batchSize) + 1} completed: ${deletedCount}/${totalItems}`);

        // Small delay between batches
        if (i + batchSize < allDocs.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      console.log(`✅ Complete reset finished: ${deletedCount} items deleted`);

      // Clear local data (chỉ khi vẫn đang xem đúng factory vừa xóa)
      if (this.selectedFactory === factory) {
        this.inventoryMaterials = [];
        this.filteredInventory = [];
        this.updateNegativeStockCount();
        this.updateTotalStockCount();
      }

      this.isLoading = false;

      alert(
        `✅ Reset hoàn thành!\n\n` +
        `Đã xóa ${deletedCount} mã hàng từ ${factory}\n\n` +
        `Bạn có thể import dữ liệu mới ngay bây giờ.`
      );

    } catch (error) {
      console.error(`❌ Error during ${factory} complete reset:`, error);
      this.isLoading = false;
      alert(`❌ Lỗi khi reset toàn bộ ${factory}: ${error.message}`);
    }
  }

  /** Đồng bộ nội dung tem QR với inbound-asm (chuỗi Mã|PO|SL|DDMMYYYY-bịch/tổng). */
  private parseInboundQrLabelDisplayFields(qrData: string): {
    materialCode: string;
    po: string;
    quantity: string;
    imd: string;
    bag: string;
  } {
    const parts = String(qrData || '').split('|');
    const p4 = (parts[3] || '').trim();
    const di = p4.indexOf('-');
    const imd = di >= 0 ? p4.slice(0, di).trim() : p4;
    const bag = di >= 0 ? p4.slice(di + 1).trim() : '';
    const { materialCode } = stripTemThungMarker(parts[0] || '');
    return {
      materialCode: materialCode.trim(),
      po: (parts[1] || '').trim(),
      quantity: (parts[2] || '').trim(),
      imd,
      bag
    };
  }

  private formatInboundLabelQuantity(qty: string): string {
    const raw = String(qty ?? '').trim().replace(/,/g, '');
    if (raw === '') return '';
    const n = Number(raw);
    if (!Number.isFinite(n)) return String(qty);
    return n.toLocaleString('en-US');
  }

  private escapeHtmlForPrint(s: string): string {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── In Tùy Chỉnh ───────────────────────────────────────────────────────────

  openCustomPrintDialog(): void {
    this.customPrintCode = '';
    this.customPrintPo = '';
    this.customPrintQty = '';
    this.customPrintImd = '';
    this.customPrintNumLabels = 1;
    this.customPrintBusy = false;
    this.showCustomPrintDialog = true;
    this.closeMorePopup();
  }

  closeCustomPrintDialog(): void {
    this.showCustomPrintDialog = false;
  }

  async printCustomLabels(): Promise<void> {
    const code = (this.customPrintCode || '').trim().toUpperCase();
    const po   = (this.customPrintPo   || '').trim();
    const qty  = String(this.customPrintQty ?? '').trim();
    const imd  = (this.customPrintImd  || '').trim();
    const num  = Math.max(1, Math.min(200, Math.floor(Number(this.customPrintNumLabels) || 1)));

    if (!code) { alert('Vui lòng nhập Mã hàng.'); return; }
    if (!po)   { alert('Vui lòng nhập PO.'); return; }
    if (!qty || isNaN(Number(qty.replace(/,/g, ''))) || Number(qty.replace(/,/g, '')) <= 0) {
      alert('Vui lòng nhập Qty hợp lệ (> 0).'); return;
    }

    // Mở cửa sổ in NGAY trong click handler để tránh bị chặn popup (do code bên dưới có await).
    const printWindow = window.open('', '_blank');
    if (!printWindow) { alert('❌ Không thể mở cửa sổ in. Vui lòng cho phép popup!'); return; }

    this.customPrintBusy = true;
    try {
      const QRCode = await import('qrcode') as any;
      const qrImages: any[] = [];

      for (let i = 1; i <= num; i++) {
        // payload: code|po|qty|imd-i/num  (nếu không có IMD thì phần 4 = i/num)
        const imdSegment = imd ? `${imd}-${i}/${num}` : `${i}/${num}`;
        const qrData = `${code}|${po}|${qty}|${imdSegment}`;
        const image = await QRCode.toDataURL(qrData, {
          width: 240, margin: 1,
          color: { dark: '#000000', light: '#FFFFFF' }
        });
        qrImages.push({ image, qrData, index: i });
      }

      this.openCustomLabelPrintWindow(printWindow, qrImages, code, po, qty, imd, num);
    } catch (e: any) {
      console.error('[Custom Print] error', e);
      alert('❌ Lỗi khi tạo tem: ' + (e?.message || e));
      try { printWindow.close(); } catch {}
    } finally {
      this.customPrintBusy = false;
    }
  }

  private openCustomLabelPrintWindow(
    printWindow: Window,
    qrImages: { image: string; qrData: string; index: number }[],
    code: string, po: string, qty: string, imd: string, total: number
  ): void {
    const esc = (s: string) => this.escapeHtmlForPrint(s);
    const fmtQty = (q: string) => {
      const n = Number(String(q).replace(/,/g, ''));
      return Number.isFinite(n) ? n.toLocaleString('en-US') : q;
    };

    const labels = qrImages.map(qr => {
      const p = this.parseInboundQrLabelDisplayFields(qr.qrData);
      return `
        <div class="qr-container">
          <div class="qr-section">
            <img src="${qr.image}" alt="QR" class="qr-image">
          </div>
          <div class="info-section">
            <div>
              <div class="info-row material-code material-code-main">${esc(p.materialCode)}</div>
              <div class="info-row">PO: ${esc(p.po)}</div>
              <div class="info-row material-code">${fmtQty(p.quantity)}</div>
              ${imd ? `<div class="info-row">IMD: ${esc(p.imd)}</div>` : ''}
              <div class="info-row">BAG: ${esc(p.bag)}</div>
            </div>
          </div>
        </div>`;
    }).join('');

    printWindow.document.write(`<!DOCTYPE html>
<html><head><title>In Tùy Chỉnh – ${esc(code)}</title>
<style>
  * { margin:0!important; padding:0!important; box-sizing:border-box!important; }
  body { font-family:Arial,sans-serif; background:white!important; overflow:hidden!important; width:57mm!important; height:32mm!important; }
  .qr-container { display:flex!important; border:1px solid #000!important; width:57mm!important; height:32mm!important; page-break-inside:avoid!important; background:white!important; box-sizing:border-box!important; }
  .qr-section { width:30mm!important; height:30mm!important; display:flex!important; align-items:center!important; justify-content:center!important; border-right:1px solid #ccc!important; box-sizing:border-box!important; }
  .qr-image { width:28mm!important; height:28mm!important; display:block!important; }
  .info-section { flex:1!important; padding:1mm!important; display:flex!important; flex-direction:column!important; justify-content:flex-start!important; align-items:flex-start!important; font-size:9.6px!important; line-height:1.15!important; box-sizing:border-box!important; color:#000!important; }
  .info-row { margin:0.8mm 0!important; font-weight:bold!important; color:#000!important; display:block!important; white-space:nowrap!important; font-family:Arial,sans-serif!important; }
  .info-row.material-code { font-size:17.74px!important; line-height:1.05!important; }
  .info-row.material-code.material-code-main { font-size:21.36px!important; line-height:1.05!important; }
  .qr-grid { display:flex!important; flex-direction:row!important; flex-wrap:wrap!important; align-items:flex-start!important; justify-content:flex-start!important; gap:0!important; padding:0!important; margin:0!important; width:57mm!important; height:32mm!important; }
  @media print {
    body { width:57mm!important; height:32mm!important; }
    @page { margin:0!important; size:57mm 32mm!important; padding:0!important; }
    .qr-container { width:57mm!important; height:32mm!important; page-break-inside:avoid!important; border:1px solid #000!important; }
    .qr-section { width:30mm!important; height:30mm!important; }
    .qr-image { width:28mm!important; height:28mm!important; }
    .info-section { font-size:9.6px!important; padding:1mm!important; }
    .info-row.material-code { font-size:17.74px!important; }
    .info-row.material-code.material-code-main { font-size:21.36px!important; }
    .qr-grid { gap:0!important; padding:0!important; margin:0!important; width:57mm!important; height:32mm!important; }
  }
</style></head>
<body><div class="qr-grid">${labels}</div>
<script>window.onload=function(){setTimeout(function(){window.print();},500);};</script>
</body></html>`);
    printWindow.document.close();
  }

  // Create print window for QR codes — cùng layout/cỡ chữ/nội dung như inbound tem bịch
  private createQRPrintWindow(
    qrImages: any[],
    material: InventoryMaterial,
    isPartialLabel: boolean = false,
    hideQtyAndBag: boolean = false
  ): void {
    const printWindow = window.open('', '_blank');

    if (!printWindow) {
      alert('❌ Không thể mở cửa sổ in. Vui lòng cho phép popup!');
      return;
    }

    printWindow.document.write(`
      <html>
        <head>
          <title>QR Label - ASM1 - ${material.materialCode}</title>
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
              justify-content: flex-start !important;
              align-items: flex-start !important;
              font-size: 9.6px !important;
              line-height: 1.15 !important;
              box-sizing: border-box !important;
              color: #000000 !important;
              text-align: left !important;
            }

            .info-row {
              margin: 0.8mm 0 !important;
              font-weight: bold !important;
              color: #000000 !important;
              text-align: left !important;
              display: block !important;
              white-space: nowrap !important;
              font-family: Arial, sans-serif !important;
              letter-spacing: 0 !important;
            }

            .info-row.material-code {
              font-size: 17.7408px !important;
              line-height: 1.05 !important;
              font-weight: bold !important;
            }

            .info-row.material-code.material-code-main {
              font-size: 21.356368px !important;
              line-height: 1.05 !important;
              font-weight: bold !important;
            }

            .qr-grid {
              text-align: left !important;
              display: flex !important;
              flex-direction: row !important;
              flex-wrap: wrap !important;
              align-items: flex-start !important;
              justify-content: flex-start !important;
              gap: 0 !important;
              padding: 0 !important;
              margin: 0 !important;
              width: 57mm !important;
              height: 32mm !important;
            }

            .qr-container.qr-container--lsx {
              display: flex !important;
              align-items: center !important;
              justify-content: center !important;
            }

            .lsx-header-text {
              font-size: 18px !important;
              font-weight: bold !important;
              text-align: center !important;
              padding: 2mm !important;
              word-break: break-all !important;
              line-height: 1.15 !important;
              color: #000000 !important;
              font-family: Arial, sans-serif !important;
            }

            .qr-container.qr-container--blank {
              background: white !important;
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
                text-align: left !important;
                justify-content: flex-start !important;
                align-items: flex-start !important;
                line-height: 1.15 !important;
              }

              .info-row {
                text-align: left !important;
                display: block !important;
                white-space: nowrap !important;
              }

              .info-row.material-code {
                font-size: 17.7408px !important;
                line-height: 1.05 !important;
                font-weight: bold !important;
              }

              .info-row.material-code.material-code-main {
                font-size: 21.356368px !important;
                line-height: 1.05 !important;
                font-weight: bold !important;
              }

              .qr-grid {
                gap: 0 !important;
                padding: 0 !important;
                margin: 0 !important;
                width: 57mm !important;
                height: 32mm !important;
              }

              .qr-container.qr-container--lsx {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
              }

              .lsx-header-text {
                font-size: 18px !important;
                font-weight: bold !important;
                text-align: center !important;
                padding: 2mm !important;
                word-break: break-all !important;
                line-height: 1.15 !important;
                color: #000000 !important;
                font-family: Arial, sans-serif !important;
              }

              .qr-container.qr-container--blank {
                background: white !important;
              }
            }
          </style>
        </head>
        <body>
          <div class="qr-grid">
            ${qrImages
              .map(qr => {
                if (qr.kind === 'lsxHeader') {
                  const t = this.escapeHtmlForPrint(String(qr.lsxText ?? '').trim());
                  return `
              <div class="qr-container qr-container--lsx">
                <div class="lsx-header-text">${t}</div>
              </div>
            `;
                }
                if (qr.kind === 'spacer') {
                  return `
              <div class="qr-container qr-container--blank"></div>
            `;
                }
                const f = this.parseInboundQrLabelDisplayFields(qr.qrData);
                const qtyLine = qr.displayPrefix
                  ? `${qr.displayPrefix} ${this.formatInboundLabelQuantity(f.quantity)}`
                  : this.formatInboundLabelQuantity(f.quantity);
                const infoRows = hideQtyAndBag
                  ? `
                    <div class="info-row material-code material-code-main">${this.escapeHtmlForPrint(f.materialCode)}</div>
                    <div class="info-row">PO: ${this.escapeHtmlForPrint(f.po)}</div>
                    <div class="info-row">IMD: ${this.escapeHtmlForPrint(f.imd)}</div>`
                  : `
                    <div class="info-row material-code material-code-main">${f.materialCode}</div>
                    <div class="info-row">PO: ${f.po}</div>
                    <div class="info-row material-code">${qtyLine}</div>
                    <div class="info-row">IMD: ${f.imd}</div>
                    <div class="info-row">BAG: ${f.bag}</div>`;
                return `
              <div class="qr-container">
                <div class="qr-section">
                  <img src="${qr.image}" alt="QR Code" class="qr-image">
                </div>
                <div class="info-section">
                  <div>${infoRows}</div>
                </div>
              </div>
            `;
              })
              .join('')}
          </div>
          <script>
            window.onload = function() {
              setTimeout(() => {
                window.print();
              }, 500);
            };
          </script>
        </body>
      </html>
    `);

    printWindow.document.close();
    console.log(`✅ QR labels created for ASM1 with Inbound format - ${qrImages.length} labels${isPartialLabel ? ' (Tem lẻ)' : ' (Tem chuẩn)'}`);
  }

  // @deprecated Dùng ensureCatalogLoaded() — giữ để code cũ không gọi .get() riêng
  private async loadCatalogOnce(): Promise<void> {
    await this.ensureCatalogLoaded();
  }

  // Apply catalog data to existing inventory materials
  private applyCatalogToInventory(): void {
    if (!this.catalogLoaded || this.inventoryMaterials.length === 0) {
      return;
    }
    this.applyCatalogToMaterials(this.inventoryMaterials);
    this.cdr.detectChanges();
  }

  // Gộp dòng tự động khi load toàn bộ inventory
  private async autoConsolidateOnLoad(): Promise<void> {
    try {
      console.log('🔄 Auto-consolidating duplicate materials on load...');
      
      // Sử dụng dữ liệu hiện tại
      const currentData = this.inventoryMaterials;
      const originalCount = currentData.length;
      const materialPoMap = new Map<string, InventoryMaterial[]>();
      
      currentData.forEach(material => {
        // Chỉ gộp dòng không phải từ inbound (source !== 'inbound')
        if (material.source === 'inbound') {
          console.log(`⏭️ Skipping inbound material: ${material.materialCode} - ${material.poNumber}`);
          return;
        }
        
        const key = `${material.materialCode}_${material.poNumber}`;
        if (!materialPoMap.has(key)) {
          materialPoMap.set(key, []);
        }
        materialPoMap.get(key)!.push(material);
      });
      
      const duplicateGroups = Array.from(materialPoMap.values()).filter(group => group.length > 1);
      const totalDuplicates = duplicateGroups.reduce((sum, group) => sum + group.length, 0);
      
      if (duplicateGroups.length === 0) {
        console.log('✅ No duplicates to consolidate');
        return;
      }
      
      console.log(`📊 Found ${duplicateGroups.length} duplicate groups with ${totalDuplicates} total items`);
      
      // Thực hiện gộp dòng
      const consolidatedMaterials: InventoryMaterial[] = [];
      const materialsToDelete: string[] = [];
      
      // Xử lý từng nhóm trùng lặp
      for (const group of duplicateGroups) {
        if (group.length === 1) continue;
        
        const baseMaterial = { ...group[0] };
        
        // Gộp quantities
        const totalOpeningStock = group.reduce((sum, m) => {
          const stock = m.openingStock !== null ? m.openingStock : 0;
          return sum + stock;
        }, 0);
        baseMaterial.openingStock = totalOpeningStock > 0 ? totalOpeningStock : null;
        baseMaterial.quantity = group.reduce((sum, m) => sum + m.quantity, 0);
        baseMaterial.stock = group.reduce((sum, m) => sum + (m.stock || 0), 0);
        baseMaterial.exported = group.reduce((sum, m) => sum + (m.exported || 0), 0);
        baseMaterial.xt = group.reduce((sum, m) => sum + (m.xt || 0), 0);
        
        // Gộp location field
        const uniqueLocations = [...new Set(group.map(m => m.location).filter(loc => loc))];
        baseMaterial.location = uniqueLocations.join('; ');
        
        // Gộp type field
        const uniqueTypes = [...new Set(group.map(m => m.type).filter(type => type))];
        baseMaterial.type = uniqueTypes.join('; ');
        
        // Keep earliest import date and latest expiry date
        baseMaterial.importDate = new Date(Math.min(...group.map(m => m.importDate.getTime())));
        baseMaterial.expiryDate = new Date(Math.max(...group.map(m => m.expiryDate.getTime())));
        
        // Merge other fields
        baseMaterial.notes = group.map(m => m.notes).filter(n => n).join('; ');
        baseMaterial.remarks = group.map(m => m.remarks).filter(r => r).join('; ');
        baseMaterial.supplier = group.map(m => m.supplier).filter(s => s).join('; ');
        baseMaterial.rollsOrBags = group.map(m => m.rollsOrBags).filter(r => r).join('; ');
        
        // Giữ lại ID của item đầu tiên để update
        if (baseMaterial.id) {
          // Thêm các item khác vào danh sách xóa
          for (let i = 1; i < group.length; i++) {
            if (group[i].id) {
              materialsToDelete.push(group[i].id);
            }
          }
        }
        
        // Cập nhật thời gian
        baseMaterial.updatedAt = new Date();
        
        consolidatedMaterials.push(baseMaterial);
        console.log(`✅ Auto-consolidated: ${baseMaterial.materialCode} - PO ${baseMaterial.poNumber}`);
      }
      
      // Thêm các item không trùng lặp
      materialPoMap.forEach((group, key) => {
        if (group.length === 1) {
          consolidatedMaterials.push(group[0]);
        }
      });
      
      // Lưu vào Firebase
      console.log(`💾 Saving auto-consolidated materials to Firebase...`);
      
      // Update các item đã gộp
      for (const material of consolidatedMaterials) {
        if (material.id && materialPoMap.get(`${material.materialCode}_${material.poNumber}`)!.length > 1) {
          const consolidateUpdate: any = {
            openingStock: material.openingStock,
            quantity: material.quantity,
            stock: material.stock,
            exported: material.exported,
            xt: material.xt,
            location: material.location,
            type: material.type,
            importDate: material.importDate,
            expiryDate: material.expiryDate,
            notes: material.notes,
            remarks: material.remarks,
            supplier: material.supplier,
            rollsOrBags: material.rollsOrBags,
            updatedAt: material.updatedAt
          };
          this.appendDerivedTotalBagsIfNeeded(material, consolidateUpdate);
          await this.firestore.collection('inventory-materials').doc(material.id).update(consolidateUpdate);
          console.log(`✅ Auto-updated: ${material.materialCode} - PO ${material.poNumber}`);
        }
      }
      
      // Xóa các item trùng lặp
      if (materialsToDelete.length > 0) {
        console.log(`🗑️ Auto-deleting ${materialsToDelete.length} duplicate items...`);
        
        // Xóa theo batch
        const batchSize = 500;
        for (let i = 0; i < materialsToDelete.length; i += batchSize) {
          const batch = this.firestore.firestore.batch();
          const currentBatch = materialsToDelete.slice(i, i + batchSize);
          
          currentBatch.forEach(id => {
            const docRef = this.firestore.collection('inventory-materials').doc(id).ref;
            batch.delete(docRef);
          });
          
          await batch.commit();
          console.log(`✅ Auto-deleted batch ${Math.floor(i/batchSize) + 1}: ${currentBatch.length} items`);
        }
      }
      
      // Cập nhật local data
      this.inventoryMaterials = consolidatedMaterials;
      this.filteredInventory = [...this.inventoryMaterials];
      
      const finalCount = this.inventoryMaterials.length;
      const reducedCount = originalCount - finalCount;
      
      console.log(`✅ Auto-consolidation completed: ${originalCount} → ${finalCount} items (reduced by ${reducedCount})`);
      
      // Hiển thị thông báo cho user
      if (reducedCount > 0) {
        this.consolidationMessage = `✅ Đã tự động gộp ${reducedCount} dòng trùng lặp khi load inventory. Từ ${originalCount} → ${finalCount} dòng.`;
        this.showConsolidationMessage = true;
        
        // Auto-hide message after 8 seconds
        setTimeout(() => {
          this.showConsolidationMessage = false;
        }, 8000);
      }
      
    } catch (error) {
      console.error('❌ Error during auto-consolidation:', error);
      // Không hiển thị error cho user vì đây là auto-process
    }
  }

  // Tiếp tục xử lý sau khi gộp dòng
  private continueAfterConsolidation(): void {
    // Sắp xếp FIFO: Material Code -> PO (oldest first)
    this.sortInventoryFIFO();
    
    // Mark duplicates for display
    this.markDuplicates();
    
    // 🔧 SIMPLIFIED: Exported quantity được lưu trực tiếp vào Firebase từ outbound scan
    console.log('✅ Exported quantities loaded directly from Firebase (no auto-update needed)');
    console.log(`🔍 DEBUG: First material exported: ${this.inventoryMaterials[0]?.exported || 0}`);
    
    this.isLoading = false;
    
    console.log(`✅ Loaded ${this.inventoryMaterials.length} ASM1 inventory items`);
    console.log(`🔍 DEBUG: After auto-update, first material exported: ${this.inventoryMaterials[0]?.exported || 0}`);
  }

  // Gộp toàn bộ dòng trùng lặp và lưu vào Firebase
  async consolidateAllInventory(): Promise<void> {
    try {
      // Hiển thị thống kê trước khi gộp
      const originalCount = this.inventoryMaterials.length;
      const materialPoMap = new Map<string, InventoryMaterial[]>();
      
      this.inventoryMaterials.forEach(material => {
        // Gộp theo Mã hàng + PO + Batch
        const key = `${material.materialCode}_${material.poNumber}_${material.batchNumber || 'NO_BATCH'}`;
        if (!materialPoMap.has(key)) {
          materialPoMap.set(key, []);
        }
        materialPoMap.get(key)!.push(material);
      });
      
      const duplicateGroups = Array.from(materialPoMap.values()).filter(group => group.length > 1);
      const totalDuplicates = duplicateGroups.reduce((sum, group) => sum + group.length, 0);
      
      if (duplicateGroups.length === 0) {
        alert('✅ Không có dòng trùng lặp nào để gộp!');
        return;
      }
      
      // Xác định loại dữ liệu
      const dataType = this.filteredInventory.length > 0 && this.filteredInventory.length < this.inventoryMaterials.length ? 
        'kết quả search' : 'toàn bộ inventory';
      
      // Hiển thị thông tin chi tiết
      let details = `📊 THÔNG TIN GỘP DÒNG:\n\n`;
      details += `• Loại dữ liệu: ${dataType}\n`;
      details += `• Tổng dòng hiện tại: ${originalCount}\n`;
      details += `• Số nhóm trùng lặp: ${duplicateGroups.length}\n`;
      details += `• Tổng dòng sẽ được gộp: ${totalDuplicates - duplicateGroups.length}\n`;
      details += `• Dòng còn lại sau gộp: ${originalCount - (totalDuplicates - duplicateGroups.length)}\n\n`;
      
      details += `📋 CHI TIẾT CÁC NHÓM TRÙNG LẶP:\n`;
      details += `🔍 Gộp theo: Mã hàng + PO + Batch\n\n`;
      duplicateGroups.forEach((group, index) => {
        const material = group[0];
        details += `${index + 1}. ${material.materialCode} - PO: ${material.poNumber} - Batch: ${material.batchNumber || 'NO_BATCH'} (${group.length} dòng)\n`;
      });
      
      // Xác nhận gộp
      const confirmMessage = details + `\n⚠️ CẢNH BÁO: Hành động này sẽ:\n` +
        `• Gộp tất cả dòng trùng lặp theo Material+PO trong ${dataType}\n` +
        `• Lưu trực tiếp vào Firebase\n` +
        `• KHÔNG THỂ HOÀN TÁC\n\n` +
        `Bạn có muốn tiếp tục không?`;
      
      if (!confirm(confirmMessage)) {
        console.log('❌ User cancelled consolidation');
        return;
      }
      
      // Xác nhận lần thứ 2
      const finalConfirm = confirm(`🚨 XÁC NHẬN CUỐI CÙNG:\n\n` +
        `Bạn có chắc chắn muốn gộp ${totalDuplicates - duplicateGroups.length} dòng trùng lặp ` +
        `và lưu vào Firebase?\n\n` +
        `Hành động này KHÔNG THỂ HOÀN TÁC!`);
      
      if (!finalConfirm) {
        console.log('❌ User cancelled final confirmation');
        return;
      }
      
      console.log(`🚀 Starting consolidation of ${duplicateGroups.length} duplicate groups...`);
      
      // Show loading
      this.isLoading = true;
      
      // Thực hiện gộp dòng
      const consolidatedMaterials: InventoryMaterial[] = [];
      const materialsToDelete: string[] = [];
      
      // Xử lý từng nhóm trùng lặp
      for (const group of duplicateGroups) {
        if (group.length === 1) continue; // Bỏ qua nhóm chỉ có 1 item
        
        const baseMaterial = { ...group[0] };
        
        // Gộp quantities
        const totalOpeningStock = group.reduce((sum, m) => {
          const stock = m.openingStock !== null ? m.openingStock : 0;
          return sum + stock;
        }, 0);
        baseMaterial.openingStock = totalOpeningStock > 0 ? totalOpeningStock : null;
        baseMaterial.quantity = group.reduce((sum, m) => sum + m.quantity, 0);
        baseMaterial.stock = group.reduce((sum, m) => sum + (m.stock || 0), 0);
        baseMaterial.exported = group.reduce((sum, m) => sum + (m.exported || 0), 0);
        baseMaterial.xt = group.reduce((sum, m) => sum + (m.xt || 0), 0);
        
        // Gộp location field
        const uniqueLocations = [...new Set(group.map(m => m.location).filter(loc => loc))];
        baseMaterial.location = uniqueLocations.join('; ');
        
        // Gộp type field
        const uniqueTypes = [...new Set(group.map(m => m.type).filter(type => type))];
        baseMaterial.type = uniqueTypes.join('; ');
        
        // Keep earliest import date and latest expiry date
        baseMaterial.importDate = new Date(Math.min(...group.map(m => m.importDate.getTime())));
        baseMaterial.expiryDate = new Date(Math.max(...group.map(m => m.expiryDate.getTime())));
        
        // Merge other fields
        baseMaterial.notes = group.map(m => m.notes).filter(n => n).join('; ');
        baseMaterial.remarks = group.map(m => m.remarks).filter(r => r).join('; ');
        baseMaterial.supplier = group.map(m => m.supplier).filter(s => s).join('; ');
        baseMaterial.rollsOrBags = group.map(m => m.rollsOrBags).filter(r => r).join('; ');
        
        // Giữ lại ID của item đầu tiên để update
        if (baseMaterial.id) {
          // Thêm các item khác vào danh sách xóa
          for (let i = 1; i < group.length; i++) {
            if (group[i].id) {
              materialsToDelete.push(group[i].id);
            }
          }
        }
        
        // Cập nhật thời gian
        baseMaterial.updatedAt = new Date();
        
        consolidatedMaterials.push(baseMaterial);
        console.log(`✅ Consolidated: ${baseMaterial.materialCode} - PO ${baseMaterial.poNumber}`);
      }
      
      // Thêm các item không trùng lặp
      materialPoMap.forEach((group, key) => {
        if (group.length === 1) {
          consolidatedMaterials.push(group[0]);
        }
      });
      
      // Lưu vào Firebase
      console.log(`💾 Saving consolidated materials to Firebase...`);
      
      // Update các item đã gộp
      for (const material of consolidatedMaterials) {
        if (material.id && materialPoMap.get(`${material.materialCode}_${material.poNumber}_${material.batchNumber || 'NO_BATCH'}`)!.length > 1) {
          // Đây là item đã gộp, cần update
          const consolidateUpdate2: any = {
            openingStock: material.openingStock,
            quantity: material.quantity,
            stock: material.stock,
            exported: material.exported,
            xt: material.xt,
            location: material.location,
            type: material.type,
            importDate: material.importDate,
            expiryDate: material.expiryDate,
            notes: material.notes,
            remarks: material.remarks,
            supplier: material.supplier,
            rollsOrBags: material.rollsOrBags,
            updatedAt: material.updatedAt
          };
          this.appendDerivedTotalBagsIfNeeded(material, consolidateUpdate2);
          await this.firestore.collection('inventory-materials').doc(material.id).update(consolidateUpdate2);
          console.log(`✅ Updated: ${material.materialCode} - PO ${material.poNumber} - Batch ${material.batchNumber || 'NO_BATCH'}`);
        }
      }
      
      // Xóa các item trùng lặp
      if (materialsToDelete.length > 0) {
        console.log(`🗑️ Deleting ${materialsToDelete.length} duplicate items...`);
        
        // Xóa theo batch (Firestore limit: 500 operations per batch)
        const batchSize = 500;
        for (let i = 0; i < materialsToDelete.length; i += batchSize) {
          const batch = this.firestore.firestore.batch();
          const currentBatch = materialsToDelete.slice(i, i + batchSize);
          
          currentBatch.forEach(id => {
            const docRef = this.firestore.collection('inventory-materials').doc(id).ref;
            batch.delete(docRef);
          });
          
          await batch.commit();
          console.log(`✅ Deleted batch ${Math.floor(i/batchSize) + 1}: ${currentBatch.length} items`);
        }
      }
      
      // Cập nhật local data
      this.inventoryMaterials = consolidatedMaterials;
      this.filteredInventory = [...this.inventoryMaterials];
      
      // Sort và mark duplicates
      this.sortInventoryFIFO();
      this.markDuplicates();
      this.updateNegativeStockCount();
      
      // Hiển thị kết quả
      const finalCount = this.inventoryMaterials.length;
      const reducedCount = originalCount - finalCount;
      
      alert(`✅ GỘP DÒNG HOÀN TẤT!\n\n` +
        `📊 Kết quả:\n` +
        `• Tổng dòng trước: ${originalCount}\n` +
        `• Tổng dòng sau: ${finalCount}\n` +
        `• Đã gộp: ${reducedCount} dòng\n` +
        `• Số nhóm xử lý: ${duplicateGroups.length}\n\n` +
        `💾 Dữ liệu đã được lưu vào Firebase!\n` +
        `⚠️ Hành động này không thể hoàn tác.`);
      
      console.log(`✅ Consolidation completed: ${originalCount} → ${finalCount} items`);
      
    } catch (error) {
      console.error('❌ Error during consolidation:', error);
      alert(`❌ Lỗi khi gộp dòng: ${error.message}\n\nVui lòng thử lại!`);
    } finally {
      this.isLoading = false;
    }
  }

  /** Tải Excel toàn bộ kết quả đang search (filteredInventory). */
  async downloadSearchResultsExcel(): Promise<void> {
    if (!this.filteredInventory?.length) {
      alert('Không có dữ liệu để tải. Hãy search trước.');
      return;
    }
    this.isDownloadingSearch = true;
    try {
      const XLSX = await import('xlsx');
      const exportData = this.filteredInventory.map((m, idx) => ({
        'STT': idx + 1,
        'QTY BAG': m.rollsOrBags ?? '',
        'Mã hàng': m.materialCode || '',
        'Tên hàng': m.materialName || '',
        'PO': m.poNumber || '',
        'IMD': this.getDisplayIMD(m),
        'BAG': this.getBagsBreakdownText(m),
        'Tồn đầu': m.openingStock ?? '',
        'NK': m.quantity ?? 0,
        'Đã xuất': m.exported ?? 0,
        'XT': m.xt ?? 0,
        'Tồn kho': this.calculateCurrentStock(m),
        'Vị trí': m.location || '',
        'Loại Hình': m.type || '',
        'Lưu ý': m.remarks || '',
        'Standard Packing': this.getStandardPacking(m.materialCode),
        'Trạng thái': this.getStatusText(m),
        'IQC Status': this.getIQCStatusText(m),
        'Last status': this.formatLastStatusDate(m.lastStatusAt),
        'Last status loại': m.lastStatusKind || '',
        'Người thực hiện': m.lastStatusBy && m.lastStatusBy !== '—' ? m.lastStatusBy : '',
        'Factory': m.factory || this.selectedFactory,
        'Đơn vị': m.unit || '',
        'Hạn dùng': m.expiryDate
          ? m.expiryDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
          : ''
      }));

      const worksheet = XLSX.utils.json_to_sheet(exportData);
      worksheet['!cols'] = [
        { wch: 5 }, { wch: 10 }, { wch: 14 }, { wch: 22 }, { wch: 12 }, { wch: 12 },
        { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 10 },
        { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
        { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 8 }, { wch: 6 }, { wch: 12 }
      ];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, `${this.selectedFactory}_Search`);
      const date = new Date().toISOString().split('T')[0];
      const hint = (this.searchTerm || 'all').trim().slice(0, 24).replace(/[^\w\-.]/g, '_') || 'all';
      const fileName = `${this.selectedFactory}_Search_${hint}_${date}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      alert(`✅ Đã tải ${exportData.length} dòng kết quả search.\n\nFile: ${fileName}`);
    } catch (error: any) {
      console.error('❌ Download search Excel error:', error);
      alert('❌ Lỗi tải file Excel: ' + (error?.message || error));
    } finally {
      this.isDownloadingSearch = false;
    }
  }

  // Export inventory data to Excel
  async exportToExcel(): Promise<void> {
    const XLSX = await import('xlsx');
    if (!this.canExport) {
      alert('Bạn không có quyền xuất dữ liệu');
      return;
    }

    try {
      console.log('📊 Exporting ASM1 inventory data to Excel...');
      
      // Optimize data for smaller file size
      const exportData = this.filteredInventory.map(material => ({
        'Factory': material.factory || this.selectedFactory,
        'Import Date': material.importDate ? (typeof material.importDate === 'string' ? material.importDate : material.importDate.toLocaleDateString('en-GB').split('/').join('')) : 'N/A',
        'Batch': material.batchNumber || '',
        'Material': material.materialCode || '',
        'Name': material.materialName || '',
        'PO': material.poNumber || '',
        'Opening Stock': material.openingStock !== null ? material.openingStock : '',
        'Qty': material.quantity || 0,
        'Unit': material.unit || '',
        'Exported': material.exported || 0,
        'XT': material.xt || 0,
        'Stock': (material.openingStock !== null ? material.openingStock : 0) + (material.quantity || 0) - (material.exported || 0) - (material.xt || 0),
        'Location': material.location || '',
        'Type': material.type || '',
        'Expiry': material.expiryDate?.toLocaleDateString('vi-VN', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit'
        }) || '',
        'QC': material.qualityCheck ? 'Yes' : 'No',
        'Received': material.isReceived ? 'Yes' : 'No',
        'Completed': material.isCompleted ? 'Yes' : 'No',
        'Supplier': material.supplier || ''
      }));
      
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      
      // Set column widths for better readability
      const colWidths = [
        { wch: 8 },   // Factory
        { wch: 10 },  // Import Date
        { wch: 12 },  // Batch
        { wch: 15 },  // Material
        { wch: 20 },  // Name
        { wch: 12 },  // PO
        { wch: 12 },  // Opening Stock
        { wch: 8 },   // Qty
        { wch: 6 },   // Unit
        { wch: 8 },   // Exported
        { wch: 6 },   // XT
        { wch: 8 },   // Stock
        { wch: 12 },  // Location
        { wch: 8 },   // Type
        { wch: 10 },  // Expiry
        { wch: 6 },   // QC
        { wch: 8 },   // Received
        { wch: 8 },   // Completed
        { wch: 15 }   // Supplier
      ];
      worksheet['!cols'] = colWidths;
      
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, `${this.selectedFactory}_Inventory`);

      const fileName = `${this.selectedFactory}_Inventory_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      
      console.log('✅ ASM1 inventory data exported to Excel');
      alert(`✅ Đã xuất ${exportData.length} records ra file Excel`);
      
    } catch (error) {
      console.error('❌ Export error:', error);
      alert('Lỗi export: ' + error.message);
    }
  }



  // Kiểm tra lịch sử xuất của material
  checkExportHistory(material: InventoryMaterial): void {
    console.log(`🔍 DEBUG: Checking export history for ${material.materialCode} - PO: ${material.poNumber} - Location: ${material.location}`);
    console.log(`📊 Material details:`, {
      id: material.id,
      quantity: material.quantity,
      exported: material.exported,
      xt: material.xt,
      calculatedStock: this.calculateCurrentStock(material),
      location: material.location
    });

    // Kiểm tra trong collection outbound-materials - CHỈ LẤY THEO VỊ TRÍ CỤ THỂ
    this.firestore.collection('outbound-materials', ref => 
      ref.where('materialCode', '==', material.materialCode)
         .where('poNumber', '==', material.poNumber)
         .where('location', '==', material.location) // Thêm điều kiện vị trí để tránh nhân đôi
         .where('factory', '==', this.selectedFactory)
         .orderBy('exportDate', 'desc')
         .limit(10)
    ).get().subscribe(snapshot => {
      console.log(`📦 Found ${snapshot.docs.length} outbound records for ${material.materialCode} - ${material.poNumber} - Location ${material.location}`);
      
      snapshot.docs.forEach((doc, index) => {
        const data = doc.data() as any;
        console.log(`  ${index + 1}. Export: ${data.exportQuantity} from Location ${data.location} on ${data.exportDate?.toDate?.() || data.exportDate}`);
      });
    });

    // Kiểm tra trong collection inventory-materials
    this.firestore.collection('inventory-materials', ref => 
      ref.where('materialCode', '==', material.materialCode)
         .where('poNumber', '==', material.poNumber)
         .where('factory', '==', this.selectedFactory)
    ).get().subscribe(snapshot => {
      console.log(`📋 Found ${snapshot.docs.length} inventory records for ${material.materialCode} - ${material.poNumber}`);
      
      snapshot.docs.forEach((doc, index) => {
        const data = doc.data() as any;
        console.log(`  ${index + 1}. ID: ${doc.id}, Location: ${data.location}, Exported: ${data.exported}, Stock: ${data.stock}, Updated: ${data.updatedAt?.toDate?.() || data.updatedAt}`);
      });
    });
  }


}
