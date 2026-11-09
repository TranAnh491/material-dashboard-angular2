import { appAlert } from '../../shared/app-toast';
import { isRmQtyDecimalFactory, parseRmScanQty, roundRmQty, RM_QTY_DECIMALS_4 } from '../../services/rm-scan-qty.util';
import { stripJ5Prefix } from '../../shared/location-prefix';
import { autoKkFields, autoKkLog, isPassToShelf } from '../../shared/auto-kk';
import { PxkWeightCheckReportService } from '../../services/pxk-weight-check-report.service';
import { WEIGH_EXEMPT_REASONS, WEIGH_EXEMPT_OTHER, buildWeighExemptReason, temLeMustWeigh, catalogBagWeight, WEIGH_TOLERANCE_PERCENT } from '../../services/weigh-exempt-report';
import { PxkOddWeighService } from '../../services/pxk-odd-weigh.service';
import { readScaleNumber } from '../../services/scale-ocr.util';
import { Component, OnInit, OnDestroy, AfterViewInit, HostListener, ChangeDetectorRef, NgZone, ViewChild, ElementRef, inject } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { Location } from '@angular/common';
import { Subject, BehaviorSubject, Subscription, firstValueFrom } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged, timeout } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
// Chỉ dùng làm kiểu — `import type` bị xóa khi biên dịch nên không kéo html5-qrcode
// (~85 KB) vào chunk materials. Camera scan thực tế chỉ có ở tab Inbound (đã dynamic import).
import type { Html5Qrcode } from 'html5-qrcode';
import { MatDialog } from '@angular/material/dialog';
import { TabPermissionService } from '../../services/tab-permission.service';
import { FactoryAccessService } from '../../services/factory-access.service';
import { ExcelImportService } from '../../services/excel-import.service';
import { RmBagHistoryService } from '../../services/rm-bag-history.service';
import { TemLeSplitLog, TemLeSplitResult, TemLeClService } from '../../services/tem-le-cl.service';
import { TemXuatKhoService } from '../../services/tem-xuat-kho.service';
import { LabelReprintFlagService } from '../../services/label-reprint-flag.service';
import { FirebaseAuthService } from '../../services/firebase-auth.service';
import { getDefaultRmFactory } from '../../services/rm-factory-preference.util';
import { MaterialsDashboardService } from '../../services/materials-dashboard.service';
import { LocationUnlockService } from '../../services/location-unlock.service';
import { LocationUnlockDialogComponent } from '../../components/location-unlock-dialog/location-unlock-dialog.component';
import { MaterialsInventoryUnlockService } from '../../services/materials-inventory-unlock.service';
import { KkScanGuideZaloService } from '../../services/kk-scan-guide-zalo.service';
import {
  isAsm3OrWh3PrefixLocation,
  isIqcPrefixLocation,
  isLockerPrefixLocation,
  isBoxPrefixLocation,
  isNgPrefixLocation,
  splitMultiLocations,
  joinMultiLocations
} from '../layout-warehouse/layout-warehouse-location.util';
import { LayoutWhPick, LayoutLocGroup, getLayoutLocationGroups, normalizeLayoutLocToken, isJWarehouseLocation, jKhoMatSRuleLabel, jKhoMatSRuleOfRow, jKhoMatSFirstRowForPrefix, jKhoMatSRowIdFromSlot, parseJRackLocation, normalizeJRackLocation, formatJRackAisle, formatJRackBlock, compactJRackLocations } from './layout-location-catalog';
import { normalizeShelfGroups, shelfGroupRows } from './shelf-group-catalog';
import {
  ACTION_DEFS,
  MATERIALS_MATRIX_DOC_PREFIX,
  MATERIALS_MATRIX_PASS,
  MATRIX_DEFAULT_ROW,
  MatrixFactory,
  MatrixRuleValue,
  RULE_DEFS,
  matrixDateMs,
  matrixList,
  normalizePerms,
  normalizeRuleValues
} from './materials-matrix';
import { B037_REQUIRED_LOCATION, isB037Code } from './fridge-nvl-catalog';
import { DvLuuTruCatalogService } from '../../services/dv-luu-tru-catalog.service';
import { NvlkhCatalogService } from '../../services/nvlkh-catalog.service';
import { NvlCatalogFullService } from '../../services/nvl-catalog-full.service';
import { LinkQPendingPxkService, PendingPxkInfo, PendingPxkPo } from '../../services/linkq-pending-pxk.service';
import { KkCatalogService, KkCatalogEntry } from '../../services/kk-catalog.service';
import { SxxkSuspectService } from '../../services/sxxk-suspect.service';
import { InventoryStockReportService } from '../../services/inventory-stock-report.service';
// xlsx (~nặng) chỉ dùng khi bấm nút xuất/nhập Excel — nạp động tại chỗ dùng
// (`const XLSX = await import('xlsx')`), không nhồi vào chunk materials.
import { ReadTrackerService } from '../../services/read-tracker.service';
import { KkHistoryLogService, kkLogDateKey } from '../../services/kk-history-log.service';
import { StorageUnitSize } from '../../models/storage-unit.model';
import { ImportProgressDialogComponent } from '../../components/import-progress-dialog/import-progress-dialog.component';
import { buildTemThungQrData, stripTemThungMarker } from '../../services/tem-thung-qr.util';
import {
  MaterialQrLabel,
  buildMaterialQrLabelDocument,
  formatMaterialLabelType,
  materialLabelTraIconType,
  parseMaterialQrLabelFields
} from '../../services/material-qr-label.util';
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
  /** Standard của lô (PO) — Inbound ghi lúc nhận hàng từ LĐV. Ưu tiên hơn Standard danh mục. */
  lotStandardPacking?: number;
  /** Đã kiểm kê (đếm tồn kho) — tick tay ở cột KK, riêng theo dòng (Mã + PO + IMD). */
  kkChecked?: boolean;
  /** Dòng bị khóa in QR (Matrix qrLock): đã dùng hết lượt in fix. */
  qrFixPrintedAt?: any;
  qrFixPrintedBy?: string;
  /** Số lần đã in fix (dòng cũ chỉ có qrFixPrintedAt → tính là 1). */
  qrFixPrintCount?: number;
  /** Số lượng cộng dồn từ tem Scan KK — so sánh với tồn kho. */
  kkScanCount?: number;
  /** Tổng lượng đã quét (cộng lượng trên từng tem) — so với tồn kho, đủ thì tick KK. */
  kkScanQty?: number;
  /** Week trên tem nhập ở Inbound (chỉ trên web): 4 số theo weekFormat. */
  week?: string;
  weekFormat?: 'YYWW' | 'MMYY';
  /** Vị trí gốc đã ghi nhận lần đầu (scan cập nhật vị trí). */
  kkOriginLocation?: string;
  /** Tài khoản đã tick/bỏ tick KK gần nhất. */
  kkBy?: string;
  /** Thời điểm tick/bỏ tick KK gần nhất. */
  kkAt?: Date | null;
  /** Lần scan vị trí gần nhất (nút Scan vị trí). */
  locationScannedAt?: Date | null;
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
  /** XT theo từng bag: bag số nào, lượng bao nhiêu. */
  xtBags?: InventoryXtBagPick[];
  /** Tổng lượng xuất lẻ (không đủ 1 bag). */
  xtLe?: number;
  
  // Edit states
  isEditingOpeningStock?: boolean;
  isEditingXT?: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export interface InventoryXtBagPick {
  bagNo: number;
  qty: number;
  /** Có số thì xuất lẻ theo cột này, không lấy lượng bag đủ. */
  leQty?: number;
}

export type InventoryBagStatus = 'stock' | 'exported' | 'xt';

export interface InventoryBagRow {
  bagNo: number;
  qty: number;
  status: InventoryBagStatus;
  selected?: boolean;
  exported?: boolean;
  leQty?: number | null;
  /** Bag đã tách lẻ (xuất 1 phần / đang là bịch CL) — popup bag ghi chữ "Lẻ" */
  isLe?: boolean;
  /** Lượng còn lại của bag lẻ */
  leRemain?: number;
  /** GW (gram) bịch CL cân lúc tách tem lẻ */
  clGw?: number;
}

export type ResetLowStockRow = {
  id: string;
  materialCode: string;
  poNumber: string;
  imd: string;
  location: string;
  stock: number;
  selected: boolean;
};

/** Dòng tổng hợp Kiểm tra KK theo mã hàng. */
export type KkWarehouse = 'D1' | '00' | 'J' | 'ASM3';
export type KkLocMaterialRow = {
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
export type KkTypeRow = {
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
export type DoiKhoRow = {
  id: string;
  materialCode: string;
  poNumber: string;
  location: string;
  palletId: string;
  stock: number;
  selected: boolean;
};

/** Kho đích khi Dời kho — tiền tố gắn vào đầu Vị trí. */
export type DoiKhoWh = 'J' | 'ASM3';

export type InventoryHideReason = 'manual' | 'reset-zero' | 'reset-low-stock' | 'po-surplus' | 'delete-request';

export type MaterialsOtpAction =
  | 'import'
  | 'consolidate'
  | 'reset-all'
  | 'fix-batch'
  | 'snapshot'
  | 'hidden-list'
  | 'manual-on'
  | 'unlock-xt'
  | 'clear-kk-warning';

export type HiddenInventoryRow = {
  id: string;
  factory: string;
  materialCode: string;
  poNumber: string;
  location: string;
  /** Lô hàng = IMD (batchNumber) của dòng tồn. */
  imd: string;
  stock: number;
  unit: string;
  hideReason: InventoryHideReason | string;
  hiddenBy: string;
  hiddenAt: Date | null;
  deleteAfterAt: Date | null;
  daysLeft: number;
};

/** So sánh tồn LinkQ với tổng tồn web theo mã. */
/** Tab trang so sánh LinkQ. diffPos = lệch dương (web > LinkQ), diffNeg = lệch âm (LinkQ > web). */
/** File LinkQ đã import: tồn theo mã; `po` = tồn theo mã → PO (chỉ khi file có cột PO). */
export interface LinkQPack {
  map: Map<string, number>;
  label: string;
  po?: Map<string, Map<string, number>>;
}

export type LinkQCompareTab ='all' | 'linkq' | 'diff' | 'diffPos' | 'diffNeg' | 'linkqOnly' | 'webOnly';

export type LinkQCompareRow = {
  code: string;
  linkQ: number | null;
  web: number;
  /** Web − LinkQ */
  diff: number;
  kind: 'both' | 'linkqOnly' | 'webOnly';
  isDiff: boolean;
  linkQText: string;
  webText: string;
  diffText: string;
  statusLabel: string;
  statusCls: string;
  pos: Array<{ po: string; location: string; stock: number; stockText: string }>;
};

export type KkTypeByCodeRow = {
  code: string;
  name: string;
  lines: number;
  /** Aging PO cũ nhất của mã (tháng) */
  aging: number | null;
  web: number;
  linkQ: number | null;
  /** PXK chưa xuất của mã (ASM1; null = chưa tính / nhà máy khác) */
  pxk: number | null;
  diff: number | null;
  warn: boolean;
  checked: number;
  /** Số dòng cần KK (bỏ dòng Aging < 1 tháng) */
  kkLines: number;
  locs: string;
  /** Các dòng tồn web (mỗi PO / IMD) của mã — bảng Theo mã LinkQ hiện đủ PO. */
  items?: InventoryMaterial[];
};

export type KkStockBoxRef = {
  productType: string;
  sourceProductType?: string;
  sourceProductTypes?: string[];
  pinSplit?: string;
  groupCodes?: string[];
};

import { LocUpdDoneEvent } from '../../shared/loc-upd-scan/loc-upd-scan.component';
import { WeekWindow, WeekRules, WEEK_RULES_REV, getWeekRules, fmtDmy, weekCodeLabel, weekStatusText, weekWindow } from '../../shared/week-code';
import { WeekRulesService } from '../../services/week-rules.service';
import { WeekInputResult } from '../../shared/week-input-popup/week-input-popup.component';
import { KK_PO_BLANK, KK_PO_CMP_COLLECTION, KkPoCmpData, KkPoCmpDetailRow, buildKkPoCmpDetail, buildKkPoCmpIndex, buildKkPoCmpQty, kkPoCmpCode, kkPoCmpPo, parseKkPoCmpSheet } from './kk-po-compare';
@Component({
  selector: 'app-materials',
  templateUrl: './materials.component.html',
  styleUrls: ['./materials.component.scss', './materials-mobile.scss']
})
export class MaterialsComponent implements OnInit, OnDestroy, AfterViewInit {
  /** Nhà máy đang xem (ASM1 ⇄ ASM2) — đổi qua factory-switcher trên UI, đồng bộ với query param `factory`. */
  selectedFactory: 'ASM1' | 'ASM2' = 'ASM1';

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
  protected nvlkhCustomerMap = new Map<string, string>();
  isCatalogLoading = false;
  isResetting = false; // Loading state for reset operation
  isDownloadingSearch = false;
  showResetLowStockPopup = false;
  resetLowStockRows: ResetLowStockRow[] = [];
  isDeletingResetLowStock = false;
  resetZeroDeletedCount = 0;
  /** Trang Kiểm tra KK (tab Quản lý Nguyên Liệu). */
  showKkLocMap = false;
  kkLocMapLoading = false;
  kkLocMapQuery = '';
  /** Đã đọc tồn kho (Play hoặc search đủ 4 số). Mở trang không tự đọc. */
  kkStockLoaded = false;
  kkLocMapView: 'location' | 'material' | 'type' | 'manager' | null = null;
  kkLocMapWarehouseFilter: '' | KkWarehouse = '';
  kkLocMapByType: KkTypeRow[] = [];
  protected kkLocMapMaterialCache = new Map<string, InventoryMaterial[]>();
  protected kkLocMapTypeCache = new Map<string, InventoryMaterial[]>();
  kkLiveActive = false;
  kkLiveLoading = false;
  kkLiveError = '';
  kkLiveRows: Array<{
    materialCode: string;
    location: string;
    poNumber: string;
    checkedBy: string;
    checkedAt: Date;
  }> = [];
  showKkIdReport = false;
  kkIdReportMode: 'day' | 'range' = 'day';
  kkIdReportStart = '';
  kkIdReportEnd = '';
  kkIdReportLoading = false;
  kkIdReportError = '';
  kkIdReportExpandedId: string | null = null;
  kkIdReportRows: Array<{
    id: string;
    uniqueCodes: number;
    tickCount: number;
    firstAt: Date;
    lastAt: Date;
    codes: string[];
  }> = [];
  showKkCatalogPopup = false;
  kkCatalogTab: 'codes' | 'shelves' = 'codes';
  kkShelfRows: Array<{ shelf: string; groups: string }> = [];
  kkShelfSaving = false;
  /** Đã lọc + sắp xếp theo tab / ô tìm. */
  linkQCompareVisibleRows: LinkQCompareRow[] = [];
  /** Phần đang render (tăng dần khi cuộn). */
  linkQCompareShownRows: LinkQCompareRow[] = [];
  protected static readonly LINKQ_COMPARE_PAGE = 200;
  protected static readonly LINKQ_COMPARE_TTL_MS = 90_000;
  private static readonly LINKQ_PACK_TTL_MS = 5 * 60_000;
  private linkQPackCache = new Map<string, { pack: LinkQPack; ts: number }>();
  linkQCheckOnly = false;
  protected linkQCheckSet = new Set<string>();
  protected linkQSheetEl: HTMLElement | null = null;
  private linkQSheetUnlisten: (() => void) | null = null;

  @ViewChild('lqsSheet') set linkQSheetRef(ref: ElementRef<HTMLElement> | undefined) {
    this.linkQSheetUnlisten?.();
    this.linkQSheetUnlisten = null;
    const el = ref?.nativeElement || null;
    this.linkQSheetEl = el;
    if (!el) return;
    this.ngZone.runOutsideAngular(() => {
      const onScroll = () => {
        if (el.scrollTop + el.clientHeight < el.scrollHeight - 400) return;
        if (this.linkQCompareShownRows.length >= this.linkQCompareVisibleRows.length) return;
        this.ngZone.run(() => this.growLinkQCompareShown());
      };
      el.addEventListener('scroll', onScroll, { passive: true });
      this.linkQSheetUnlisten = () => el.removeEventListener('scroll', onScroll);
    });
  }

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
  kkCatalogSavingCode = '';
  private kkCatalogLocCommitted = new Map<string, string>();
  protected kkCatalogTypeMap = new Map<string, string>();
  kkActiveProductType: string | null = null;
  protected kkActiveTypeDraft: KkTypeRow | null = null;
  /** Ô search mã / tên / pallet trong bảng chi tiết KK theo loại hàng. */
  kkTypeDetailQuery = '';
  /** Ô tìm trong trang chi tiết box / Xem toàn bộ mục: mã, PO, IMD, vị trí, pallet, tên. */
  kkTypeInnerQuery = '';
  /** Lọc cảnh báo trong chi tiết box: '' = tất cả, 'any' = có cảnh báo, hoặc 1 loại cảnh báo. */
  kkTypeWarnFilter = '';
  kkWarnClearPending = '';
  /** Lọc theo LinkQ: '' = tất cả, 'yes' = mã có trong LinkQ, 'no' = không có. */
  kkTypeLinkQFilter = '';
  /** Lọc theo màu mã: '' | 'red' (Kiểm 100%) | 'orange' (Kế hoạch NVL — xài hết) | 'any' (đỏ hoặc cam) */
  kkTypeCodeToneFilter = '';
  /** Lọc trạng thái KK: '' tất cả · 'done' đã KK · 'todo' chưa KK. */
  kkTypeKkFilter: '' | 'done' | 'done-short' | 'todo' = '';
  /** Lọc cột chênh lệch (Web − LinkQ − PXK): '' tất cả · bad |diff|>1 · ok · pos · neg. */
  kkTypeDiffFilter: '' | 'bad' | 'ok' | 'pos' | 'neg' = '';
  kkTypeFilterLoc = '';
  /** Lọc Chi tiết KK theo mã vừa scan vị trí. */
  kkLocScanDay: '' | 'today' | 'yesterday' = '';
  protected kkLocScanIds = new Set<string>();
  protected kkLocScanReady = false;
  protected kkLocScanReq = 0;
  kkTypeFilterWh: '' | KkWarehouse = '';
  kkTypeFilterRolls = '';
  kkTypeSortQtyDesc = false;
  /** Ô chọn Sắp xếp: '' | 'qty' | 'rolls' | 'kk' (3 kiểu loại trừ nhau). */
  get kkTypeSortMode(): string {
    return this.kkTypeSortQtyDesc ? 'qty' : this.kkTypeSortRollsDesc ? 'rolls' : this.kkTypeSortKkTimeDesc ? 'kk' : '';
  }
  set kkTypeSortMode(v: string) {
    this.kkTypeSortQtyDesc = v === 'qty';
    this.kkTypeSortRollsDesc = v === 'rolls';
    this.kkTypeSortKkTimeDesc = v === 'kk';
    this.kkTypeDetailSig = '';
    this.onKkTypeSortChanged();
  }
  /** Quản lý NVL ghi đè: về trang 1 khi đổi kiểu sắp xếp. */
  protected onKkTypeSortChanged(): void { }
  /** Chi tiết box: dòng nhiều cuộn nhất lên đầu. */
  kkTypeSortRollsDesc = false;
  /** Chi tiết box: mã vừa tick KK mới nhất lên đầu. */
  kkTypeSortKkTimeDesc = false;
  protected kkTypeCacheRev = 0;
  protected kkTypeBoxesSig = '';
  protected kkManagerRowsSig = '';
  protected kkTypeBoxesCached: Array<{
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
  /** Cache cho getter `kkTypeBoxGroups` — khoá theo `kkTypeBoxesSig` để không gom nhóm
   * lại (Map mới + regex/normalize cho ~100 loại) mỗi lần change detection. */
  protected kkTypeBoxGroupsSig = ' ';
  kkMucShelfMenuCategory = '';
  kkMucShelfDraft = '';
  kkMucShelfSaving = false;
  /** Chi tiết KK theo tầng mâm (B009/B016/B018) — hiện bảng kiểm kê mọi mã trong dải */
  kkConnectorFloorDetail: {
    prefix: string;
    shelf: string;
    level: number;
    from: number;
    to: number;
    locs: string[];
    title: string;
    /** B017: lẻ = R17, chẵn = R18. */
    parity?: 'odd' | 'even';
  } | null = null;
  /** Chi tiết KK — toàn bộ tồn kho, không phân loại theo loại hàng */
  kkAllStockDetail = false;
  /** Xem toàn bộ → So sánh PO: chỉ hiện dòng có mã trong file tuổi hàng nhưng PO không có trong file. */
  kkPoCmpOn = false;
  kkPoCmp: KkPoCmpData | null = null;
  kkPoCmpBusy = false;
  /** Bấm mã khi đang So sánh PO: toàn bộ PO của mã ở web và LinkQ. */
  kkPoCmpDetail: { code: string; name: string; rows: Array<KkPoCmpDetailRow & { pxk: number; pxkLsx: string; surplus: boolean }>; webTotal: number; linkqTotal: number | null } | null = null;
  /** PXK chưa xuất theo "MÃ|PO" (Work Order chưa Done, web chưa scan) — ASM1. Dùng loại phần lệch do PXK chưa Done. */
  kkPoCmpPending: Map<string, PendingPxkPo> | null = null;
  /** Số dòng PO sai được giải thích bởi PXK chưa Done (đã ẩn khỏi bảng). */
  kkPoCmpPxkHidden = 0;
  /** So sánh PO → chỉ dòng "dư sai — có thể xóa". */
  kkPoCmpSurplusOnly = false;
  /** Số dòng dư sai trong lần lọc gần nhất. */
  kkPoCmpSurplusCount = 0;
  /** Dòng dư sai của lần lọc gần nhất (Excel / ẩn hàng loạt). */
  private kkPoCmpSurplusRows: InventoryMaterial[] = [];
  kkPoCmpSurplusBusy = false;
  protected kkPoCmpFactory = '';
  readonly kkAllStockDetailTitle = 'Chi tiết KK';
  kkActivePinSplit: '1-4' | '5-10' | null = null;
  kkActiveSourceProductType: string | null = null;
  protected kkTypeDetailSig = '';
  private kkTypeDetailAllCached: InventoryMaterial[] = [];
  protected kkTypeDetailFilteredCached: InventoryMaterial[] = [];
  private kkTypeFilteredRollsCached = 0;
  private kkTypeLiveStock = 0;
  private kkTypeLiveChecked = 0;
  private kkTypeLiveTotal = 0;
  private kkTypePalletNotesSig = '';
  private kkTypePalletNotesCached = new Map<string, string>();
  showKkTypeScanModal = false;
  /** inventory = Scan kiểm kê (đếm box + KK); location = Scan vị trí (chỉ cập nhật vị trí) */
  kkTypeScanMode: 'inventory' | 'location' = 'inventory';
  kkTypeScanStep: 'operator' | 'location' | 'codes' = 'location';
  kkTypeScanOperator = '';
  kkTypeScanOperatorInput = '';
  kkTypeScanLocation = '';
  kkTypeScanLocationInput = '';
  kkTypeScanQrInput = '';
  kkTypeScanMaterialCode = '';
  kkTypeScanStandardDraft: number | '' = '';
  kkTypeScanOkCount = 0;
  kkTypeScanSkipCount = 0;
  kkTypeScanMissCount = 0;
  kkTypeScanLogs: Array<{ id: number; ok: boolean; skip?: boolean; text: string; readMs?: number; saveMs?: number }> = [];
  kkTypeScanLastReadMs: number | null = null;
  kkTypeScanLastSaveMs: number | null = null;
  kkTypeScanLastSavePending = false;
  kkTypeScanOpUntil: Date | null = null;
  protected kkTypeScanExtraLines: InventoryMaterial[] = [];
  protected kkTypeScanCartons: Record<string, number> = {};
  /** Hàng đợi QR khi user scan tiếp lúc đang ghi. */
  protected kkHidQrQueue: Array<{ raw: string; readMs: number }> = [];
  protected kkHidQrDraining = false;
  private kkScanLogSeq = 0;
  private kkScanWriteChain: Promise<void> = Promise.resolve();
  private kkScanWritesInFlight = 0;
  private kkBeepCtx: AudioContext | null = null;
  private hidScanTimers = new Map<HTMLInputElement, ReturnType<typeof setTimeout>>();
  private hidScanBound = new WeakSet<HTMLInputElement>();
  protected kkPrevViewport = '';
  protected kkDocScanHandler: ((e: KeyboardEvent) => void) | null = null;
  protected kkDocScanBuf = '';
  protected kkDocScanAt = 0;
  protected kkDocScanTimer: ReturnType<typeof setTimeout> | null = null;
  kkTypeScanErr = '';
  /** Popup xác nhận sau mỗi lần scan mã — phải bấm Đồng ý mới scan tiếp (chỉ Scan kiểm kê) */
  showKkTypeScanConfirm = false;
  kkTypeScanConfirm: {
    code: string;
    po: string;
    imd: string;
    location: string;
    scannedShelf: string;
    relocated: boolean;
  } | null = null;
  /** Toast ngắn sau Scan vị trí — tự ẩn, không chặn scan mã tiếp */
  kkTypeScanLocToast: {
    code: string;
    location: string;
    kind?: 'ok' | 'home' | 'over';
    scanned?: string;
  } | null = null;
  protected kkTypeScanLocToastTimer: ReturnType<typeof setTimeout> | null = null;
  protected static readonly KK_SCAN_OP_KEY = 'rm-kk-scan-operator-session-v1';
  private kkScanOpTimer: any;
  showKkTypeReportMenu = false;
  showKkPalletCheck = false;
  kkPalletCheckBusy = false;
  kkPalletCheckRows: Array<{ warehouse: KkWarehouse; label: string; pallets: number; lines: number; noPallet: number }> = [];
  kkPalletCheckTotal = 0;
  kkTypeReportBusy = false;
  /** Tick: cộng các mã đang ở kho WH3/ASM3 vào số liệu KK. Bỏ tick thì không tính. */
  kkCountWh3 = true;
  /** Khi Tính WH3/ASM3: chỉ hiện dòng kho ASM3 / WH3. */
  kkWh3Only = false;
  /** Chỉ hiện mã / vị trí kho J (R1–R99, S1–S99, J5, TRA…). */
  kkJOnly = false;
  /** Lọc chỉ các dòng / loại còn chưa tick KK. */
  kkFilterUncheckedOnly = false;
  private inboundNameCache = new Map<string, string>();
  readonly kkWhSelectOptions: Array<{ id: '' | '00' | 'J' | 'ASM3'; label: string }> = [
    { id: '', label: 'D1' },
    { id: '00', label: '00' },
    { id: 'J', label: 'J' },
    { id: 'ASM3', label: 'ASM3' }
  ];

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
  /** Dùng chung (static): mở lại tab trong 90s không phải đọc lại ~10k dòng tồn. Tick KK vẫn vá trực tiếp vào cache. */
  private static readonly KK_INV_SNAP_SHARED = new Map<string, { docs: any[]; ts: number }>();
  protected kkInvSnapCache = MaterialsComponent.KK_INV_SNAP_SHARED;
  private static readonly KK_INV_SNAP_TTL_MS = 90_000;

  /** Đầu mã không hiển thị / không kiểm KK — lấy từ Matrix (rule kkExcludedPrefixes). */
  private static kkExcludedPrefixList: string[] = ['R', 'B033'];

  static isKkExcludedCode(code: unknown): boolean {
    const c = String(code ?? '').trim().toUpperCase();
    return MaterialsComponent.kkExcludedPrefixList.some((p) => c.startsWith(p));
  }

  private filterKkExcludedDocs(docs: any[]): any[] {
    return docs.filter((d) => {
      const data = typeof d?.data === 'function' ? d.data() : d;
      return !MaterialsComponent.isKkExcludedCode(data?.materialCode);
    });
  }

  /**
   * Đọc `inventory-materials` theo 1 factory, ưu tiên cache TTL. `force` = bỏ qua cache.
   * Mặc định bỏ mã đầu R / B033 (không hiển thị, không kiểm); `includeExcluded` = lấy đủ (so LinkQ).
   */
  protected async getKkFactoryDocs(factory: string, force = false, includeExcluded = false): Promise<any[]> {
    const key = String(factory || '').trim().toUpperCase();
    if (!key) return [];
    const now = Date.now();
    const hit = this.kkInvSnapCache.get(key);
    if (!force && hit && now - hit.ts < MaterialsComponent.KK_INV_SNAP_TTL_MS) {
      return includeExcluded ? hit.docs : this.filterKkExcludedDocs(hit.docs);
    }
    const snap = await firstValueFrom(
      this.firestore
        .collection('inventory-materials', (ref) => ref.where('factory', '==', key).limit(10000))
        .get()
        .pipe(timeout(60000))
    );
    const docs = snap?.docs || [];
    this.kkInvSnapCache.set(key, { docs, ts: now });
    return includeExcluded ? docs : this.filterKkExcludedDocs(docs);
  }

  /**
   * Vá tại chỗ 1 dòng trong cache KK sau khi tick/bỏ tick một dòng — thay cho việc
   * xoá cả cache (khiến lần Kiểm tra KK kế tiếp phải nạp lại 10k doc từ mạng).
   * Doc trong cache chỉ được đọc qua `.id` / `.data()`, nên thay bằng shim là đủ.
   */
  protected patchKkInvSnapCache(docId: string, patch: Record<string, unknown>): void {
    const id = String(docId || '');
    if (!id) return;
    this.kkInvSnapCache.forEach((entry) => {
      const idx = entry.docs.findIndex((d) => String(d?.id || '') === id);
      if (idx < 0) return;
      const prev = entry.docs[idx];
      const base = typeof prev?.data === 'function' ? prev.data() : prev;
      const merged = { ...base, ...patch };
      entry.docs[idx] = { id, data: () => merged };
    });
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
  mobileLocScanWh: '' | '00' | 'J' | 'ASM3' = '';

  /** Quản lý NVL: chỉ dùng máy scanner (PDA) — không camera. */
  nlScanDevice: 'pda' = 'pda';
  showNlCamera = false;
  protected nlScanLock = false;

  /** Mobile: sheet Chi tiết dòng tồn. */
  showMobileDetail = false;
  mobileDetailMaterial: InventoryMaterial | null = null;
  /** Ghi snapshot TỒN từ kho → rm-bag-history */
  isSnapshottingBagHistory = false;
  /** Popup nhập danh sách mã trước khi snapshot (tránh quá tải) */
  showSnapshotCodesModal = false;
  snapshotMaterialCodesText = '';
  
  // Consolidation status
  consolidationMessage = '';
  showConsolidationMessage = false;
  
  // Catalog cache for faster access
  protected catalogCache = new Map<string, any>();
  public catalogLoaded = false;
  /** Ngày (YYYY-MM-DD) lần tải danh mục NVL gần nhất — sang ngày mới thì đọc lại. */
  private catalogLoadedDateKey = '';
  /** Tránh gọi song song loadCatalogFromFirebase + loadCatalogOnce (đọc ~9K doc 2 lần). */
  private catalogLoadPromise: Promise<void> | null = null;
  /** Cache danh mục sống sót khi Angular hủy component (rời tab). */
  private static sharedCatalogCache = new Map<string, any>();
  private static sharedCatalogDateKey = '';
  /** Mốc danh mục NVL lúc cache này được ghi — cũ hơn mốc sửa Standard Packing thì bỏ. */
  private static sharedCatalogSourceTs = 0;
  private catalogSourceTs = 0;
  /** Mốc server (doc app-meta/nvl-catalog) mà danh mục này đã đồng bộ tới — máy khác sửa thì tải phần đổi. */
  private static sharedCatalogRemoteTs = 0;
  private catalogRemoteTs = 0;
  private onNvlCatalogStorage = (ev: StorageEvent) => {
    if (ev.key !== NvlCatalogFullService.cacheStampKey) return;
    void this.adoptNewerNvlCatalog();
  };
  
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
  /** Tăng mỗi lần search/xóa search — kết quả cũ về trễ không được ghi đè số bag. */
  private searchRequestId = 0;
  
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
  private get hiddenRetentionDays(): number {
    return Math.max(1, this.ruleNum('hiddenRetentionDays'));
  }

  get hiddenRetentionDaysView(): number {
    return this.hiddenRetentionDays;
  }
  showHiddenInventoryPopup = false;
  isLoadingHiddenInventory = false;
  hiddenInventoryRows: HiddenInventoryRow[] = [];
  hiddenSearchQuery = '';
  hiddenLocFilter = '';
  hiddenLotFilter = '';
  hiddenReasonFilter = '';
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
  protected pendingMaterialsOtpAction: MaterialsOtpAction | null = null;
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

  showBagStatusPopup = false;
  showXtBagPopup = false;
  bagPopupMaterial: InventoryMaterial | null = null;
  bagPopupRows: InventoryBagRow[] = [];
  bagPopupLoading = false;
  bagPopupError = '';
  xtBagSaving = false;
  xtBagFallbackQty: number | null = null;
  xtBagFallbackLeQty: number | null = null;

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
  
  // Show completed items
  // showCompleted = true; // Removed - replaced with Reset function
  
  // Lifecycle
  protected destroy$ = new Subject<void>();
  protected kkLiveStop$ = new Subject<void>();
  
  // QR Scanner
  private html5QrCode: Html5Qrcode | null = null;
  isScanning = false;
  
  // Permissions
  canView = false;
  canEdit = false;
  canExport = false;
  canDelete = false;

  /** Luôn mở sửa tay cột Vị trí / WH / Pallet (không OTP) — Matrix rule locationAlwaysUnlocked. */
  get TEMP_UNLOCK_LOCATION_WH_PALLET(): boolean {
    return this.ruleBool('locationAlwaysUnlocked');
  }
  readonly matrixActionDefs = ACTION_DEFS;
  readonly matrixDefaultRow = MATRIX_DEFAULT_ROW;
  matrixRules: Record<string, MatrixRuleValue> = normalizeRuleValues('ASM1', undefined);
  matrixPerms: Record<string, Record<string, boolean>> = normalizePerms(undefined);
  private matrixSub: (() => void) | null = null;
  private matrixFactory = '';
  private tabCanAccess = false;
  currentEmployeeId = '';

  private matrixFactoryOf(): MatrixFactory {
    return this.selectedFactory === 'ASM2' ? 'ASM2' : 'ASM1';
  }

  ruleBool(key: string): boolean {
    return this.matrixRules[key] === true;
  }

  ruleNum(key: string): number {
    return Number(this.matrixRules[key]) || 0;
  }

  /** Quyền thao tác của nhân viên đang đăng nhập — có dòng riêng thì theo dòng riêng, không thì theo dòng Mặc định. */
  can(action: string): boolean {
    const row = (this.currentEmployeeId && this.matrixPerms[this.currentEmployeeId]) || this.matrixPerms[MATRIX_DEFAULT_ROW];
    return row?.[action] !== false;
  }

  /** true = bị chặn (đã báo). */
  protected denyAction(action: string): boolean {
    if (this.can(action)) return false;
    const label = ACTION_DEFS.find((a) => a.key === action)?.label || action;
    appAlert(`🔒 Bạn không có quyền: ${label}\n(${this.currentEmployeeId || 'chưa rõ mã NV'} · ${this.selectedFactory}) — chỉnh ở More → Matrix rule & quyền.`);
    return true;
  }

  isLinkqDiffBad(diff: number | null | undefined): boolean {
    return diff != null && Math.abs(diff) > this.ruleNum('linkqDiffThreshold');
  }

  private applyPermissionFlags(): void {
    this.canView = this.tabCanAccess;
    this.canEdit = this.tabCanAccess && this.can('edit');
    this.canExport = this.tabCanAccess && this.can('export');
    this.canDelete = this.tabCanAccess && this.can('delete');
  }

  private applyMatrixRuntime(): void {
    MaterialsComponent.kkExcludedPrefixList = matrixList(this.matrixRules['kkExcludedPrefixes']);
    MaterialsComponent.KK_HIDDEN_MUCS = matrixList(this.matrixRules['kkHiddenMucs']);
    this.applyPermissionFlags();
    this.isLocationColumnUnlocked = this.TEMP_UNLOCK_LOCATION_WH_PALLET || this.locationUnlock.isUnlocked();
    this.invalidateKkTypeViewCache();
    this.cdr.markForCheck();
  }

  private subscribeMaterialsMatrix(): void {
    const factory = this.matrixFactoryOf();
    if (this.matrixSub && this.matrixFactory === factory) return;
    this.matrixSub?.();
    this.matrixFactory = factory;
    this.matrixRules = normalizeRuleValues(factory, undefined);
    this.matrixPerms = normalizePerms(undefined);
    this.applyMatrixRuntime();
    this.matrixSub = this.firestore.firestore.doc(MATERIALS_MATRIX_DOC_PREFIX + factory).onSnapshot(
      (snap) => {
        const d = (snap.exists ? snap.data() : null) as { rules?: Record<string, unknown>; perms?: Record<string, unknown> } | null;
        this.matrixRules = normalizeRuleValues(factory, d?.rules);
        this.matrixPerms = normalizePerms(d?.perms);
        this.applyMatrixRuntime();
      },
      (err) => console.warn('materials matrix:', err)
    );
  }

  // --- More → Matrix rule & quyền (pass 2026) ---
  showMatrix = false;
  matrixUnlocked = false;
  matrixPass = '';
  matrixPassError = '';
  matrixTab: 'rules' | 'perms' = 'rules';
  matrixDraftRules: Record<string, MatrixRuleValue> = {};
  matrixDraftPerms: Record<string, Record<string, boolean>> = {};
  matrixNewEmp = '';
  matrixSaving = false;
  matrixMsg = '';

  /**
   * Nhóm rule — tính 1 lần (KHÔNG dùng getter): getter tạo mảng mới mỗi lần vẽ → *ngFor dựng lại ô ngModel
   * → ngModel kích vẽ lại → vòng lặp vô tận, đứng máy khi mở Matrix.
   */
  readonly matrixRuleGroups: Array<{ group: string; defs: typeof RULE_DEFS }> = (() => {
    const groups: Array<{ group: string; defs: typeof RULE_DEFS }> = [];
    for (const d of RULE_DEFS) {
      let g = groups.find((x) => x.group === d.group);
      if (!g) groups.push((g = { group: d.group, defs: [] }));
      g.defs.push(d);
    }
    return groups;
  })();

  get matrixEmpRows(): string[] {
    return Object.keys(this.matrixDraftPerms)
      .filter((k) => k !== MATRIX_DEFAULT_ROW)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  }

  matrixRuleDefault(key: string): MatrixRuleValue {
    return normalizeRuleValues(this.matrixFactoryOf(), undefined)[key];
  }

  openMatrix(): void {
    this.closeMorePopup();
    this.showMatrix = true;
    this.matrixPass = '';
    this.matrixPassError = '';
    this.matrixMsg = '';
    if (this.matrixUnlocked) this.resetMatrixDraft();
    else setTimeout(() => (document.getElementById('matrix-pass') as HTMLInputElement | null)?.focus(), 50);
  }

  unlockMatrix(): void {
    if (String(this.matrixPass || '').trim() !== MATERIALS_MATRIX_PASS) {
      this.matrixPassError = 'Sai mật khẩu.';
      return;
    }
    this.matrixUnlocked = true;
    this.matrixPass = '';
    this.matrixPassError = '';
    this.resetMatrixDraft();
  }

  resetMatrixDraft(): void {
    this.matrixDraftRules = { ...this.matrixRules };
    this.matrixDraftPerms = Object.fromEntries(Object.entries(this.matrixPerms).map(([k, v]) => [k, { ...v }]));
    this.matrixNewEmp = '';
    this.matrixMsg = '';
  }

  resetMatrixRuleDefault(key: string): void {
    this.matrixDraftRules[key] = this.matrixRuleDefault(key);
  }

  addMatrixEmp(): void {
    const id = String(this.matrixNewEmp || '').trim().toUpperCase();
    if (!/^ASP\d{4}$/.test(id)) { this.matrixMsg = 'Mã nhân viên dạng ASP + 4 số (VD: ASP0106).'; return; }
    if (this.matrixDraftPerms[id]) { this.matrixMsg = `${id} đã có trong bảng.`; return; }
    this.matrixDraftPerms[id] = { ...this.matrixDraftPerms[MATRIX_DEFAULT_ROW] };
    this.matrixNewEmp = '';
    this.matrixMsg = '';
  }

  removeMatrixEmp(id: string): void {
    if (!confirm(`Xóa dòng quyền riêng của ${id}? (${id} sẽ theo dòng Mặc định)`)) return;
    delete this.matrixDraftPerms[id];
    this.matrixDraftPerms = { ...this.matrixDraftPerms };
  }

  setMatrixActionAll(action: string, value: boolean): void {
    for (const row of Object.values(this.matrixDraftPerms)) row[action] = value;
  }

  async saveMatrix(): Promise<void> {
    if (this.matrixSaving) return;
    const factory = this.matrixFactoryOf();
    const rules = normalizeRuleValues(factory, this.matrixDraftRules as Record<string, unknown>);
    for (const d of RULE_DEFS) {
      if (d.type === 'date' && !matrixDateMs(rules[d.key])) { this.matrixMsg = `"${d.label}" chưa có ngày hợp lệ.`; return; }
    }
    if (!String(rules['invAdjustPass'] || '').trim()) { this.matrixMsg = 'Mật khẩu Danh mục điều chỉnh không được để trống.'; return; }
    this.matrixSaving = true;
    this.matrixMsg = '';
    try {
      const by = await this.getMaterialsOtpRequester();
      await this.firestore.firestore.doc(MATERIALS_MATRIX_DOC_PREFIX + factory).set({
        factory,
        rules,
        perms: normalizePerms(this.matrixDraftPerms as Record<string, unknown>),
        updatedBy: by,
        updatedAt: firebase.default.firestore.FieldValue.serverTimestamp()
      });
      this.matrixMsg = `✅ Đã lưu Matrix ${factory}.`;
    } catch (e: any) {
      console.error('saveMatrix:', e);
      this.matrixMsg = '❌ Không lưu được: ' + (e?.message || e);
    } finally {
      this.matrixSaving = false;
      this.cdr.detectChanges();
    }
  }
  /** Dropdown cột WH — chọn kho đích. */
  readonly WH_SELECT_OPTIONS = [
    { id: 'ASM3', label: 'ASM3' },
    { id: 'J', label: 'J' }
  ] as const;
  /** Cột Vị trí: sửa tay sau khi xác thực OTP Zalo (4 tiếng, hết khi F5). */
  isLocationColumnUnlocked = false;
  showLayoutLocPicker = false;
  /** Popup chỉ xem danh sách mọi vị trí của dòng inventory. */
  showInvLocListPopup = false;
  invLocListMaterial: InventoryMaterial | null = null;
  /** Tick chọn vị trí để xóa trong popup. */
  invLocListSelected: Record<string, boolean> = {};
  /** Cột Vị trí bảng tồn kho: chọn kệ mẹ rồi kệ con, thay vị trí hiện tại. */
  showInvShelfPicker = false;
  invShelfPickMaterial: InventoryMaterial | null = null;
  invShelfPickParent: string | null = null;
  invShelfPickQuery = '';
  invShelfPickSaving = false;
  /** Dọn vị trí sai hàng loạt (toàn nhà máy). */
  showBulkDisposableLocPicker = false;
  bulkDisposableLocBusy = false;
  bulkDisposableLocQuery = '';
  bulkDisposableLocSelected: Record<string, boolean> = {};
  bulkDisposableLocRows: Array<{
    key: string;
    display: string;
    reason: string;
    materialCount: number;
  }> = [];
  private bulkDisposableLocMaterialMap = new Map<string, {
    id: string;
    materialCode: string;
    poNumber: string;
    location: string;
  }>();
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
  /** Gán vị trí yêu cầu cho box loại (chuột phải). */
  layoutLocTypeAssign: string | null = null;
  protected layoutLocTypeAssignGroups: string[] = [];
  kkTypeHomeLocs = new Map<string, string>();
  kkTypeBoxMenuVisible = false;
  kkTypeBoxMenuBox: { productType: string; groupCodes?: string[] } | null = null;
  kkTypeBoxMenuManagerDraft = '';
  kkTypeBoxMenuSaving = false;
  protected skipKkTypeBoxMenuClose = false;
  // canEditHSD = false; // Removed - HSD column deleted

  constructor(
    protected firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    protected cdr: ChangeDetectorRef,
    private tabPermissionService: TabPermissionService,
    private factoryAccessService: FactoryAccessService,
    private excelImportService: ExcelImportService,
    private dialog: MatDialog,
    protected router: Router,
    private route: ActivatedRoute,
    private rmBagHistory: RmBagHistoryService,
    private temLeCl: TemLeClService,
    private temXuatKho: TemXuatKhoService,
    private labelReprintFlags: LabelReprintFlagService,
    private materialsDashboard: MaterialsDashboardService,
    private locationUnlock: LocationUnlockService,
    private materialsInventoryUnlock: MaterialsInventoryUnlockService,
    protected kkScanGuideZalo: KkScanGuideZaloService,
    private dvLuuTruCatalog: DvLuuTruCatalogService,
    protected nvlkhCatalog: NvlkhCatalogService,
    protected nvlCatalogFull: NvlCatalogFullService,
    protected linkQPendingPxkSvc: LinkQPendingPxkService,
    protected kkCatalog: KkCatalogService,
    private sxxkSuspect: SxxkSuspectService,
    private invStockReport: InventoryStockReportService,
    private pxkWeightReports: PxkWeightCheckReportService,
    private pxkOddWeigh: PxkOddWeighService,
    protected readTracker: ReadTrackerService,
    protected kkLog: KkHistoryLogService,
    private location: Location,
    protected authService: FirebaseAuthService,
    private ngZone: NgZone
  ) {}

  getStorageUnitLabel(material: InventoryMaterial): string {
    const code = this.dvLuuTruCatalog.normalizeMaterialCode(material.materialCode);
    return material.storageUnitSize || this.storageUnitCatalogMap.get(code) || '';
  }

  // ===== Mục Week: hạn dùng của tem theo khách — theo Rule Week (Firestore week-rules/config, mặc định Gilbarco 8W/12W, khách khác 2W/8W, MMYY ±1 tháng) =====
  private kkWeekMemo = new Map<string, { label: string; customer: string; win: WeekWindow | null }>();

  kkWeekInfo(m: InventoryMaterial): { label: string; customer: string; win: WeekWindow | null } {
    if (!this.weekRulesAsked) {
      this.weekRulesAsked = true;
      void this.weekRulesSvc.ensureLoaded().then(() => this.cdr.markForCheck());
    }
    const customer = this.getCustomerForMaterial(m);
    const key = `${m.id}|${m.weekFormat}|${m.week}|${customer}|${WEEK_RULES_REV}`;
    let v = this.kkWeekMemo.get(key);
    if (!v) {
      v = {
        label: weekCodeLabel(m.weekFormat || 'YYWW', m.week) || String(m.week || ''),
        customer,
        win: weekWindow(m.weekFormat || 'YYWW', m.week, customer)
      };
      this.kkWeekMemo.set(key, v);
    }
    return v;
  }

  // ── Rule Week: hạn dùng tem theo khách — chỉnh ở Thao tác → Rule Week ──
  protected weekRulesSvc = inject(WeekRulesService);
  private weekRulesAsked = false;
  weekRuleOpen = false;
  weekRuleBusy = false;
  weekRuleMsg = '';
  weekRuleForm: WeekRules = getWeekRules();

  async openWeekRules(): Promise<void> {
    (this as any).kkActionsOpen = false; // popup Thao tác (Quản lý nguyên liệu)
    this.weekRuleMsg = '';
    this.weekRuleOpen = true;
    this.weekRuleBusy = true;
    try {
      const r = await this.weekRulesSvc.ensureLoaded(true);
      this.weekRuleForm = JSON.parse(JSON.stringify(r));
    } finally {
      this.weekRuleBusy = false;
      this.cdr.markForCheck();
    }
  }

  addWeekRuleRow(): void {
    this.weekRuleForm.customers.push({ prefix: '', name: '', early: this.weekRuleForm.defaultEarly, late: this.weekRuleForm.defaultLate });
  }

  removeWeekRuleRow(i: number): void {
    this.weekRuleForm.customers.splice(i, 1);
  }

  async saveWeekRules(): Promise<void> {
    if (!this.canEdit || this.weekRuleBusy) return;
    const f = this.weekRuleForm;
    const bad = f.customers.find((c) => !String(c.prefix || '').trim());
    if (bad) { this.weekRuleMsg = 'Dòng khách thiếu "Khách bắt đầu bằng".'; return; }
    this.weekRuleBusy = true;
    this.weekRuleMsg = '';
    try {
      const u = await this.afAuthWeek.currentUser;
      await this.weekRulesSvc.save(f, String(u?.email || '').split('@')[0].toUpperCase());
      this.kkWeekMemo.clear();
      this.weekRuleMsg = '✅ Đã lưu Rule Week — Outbound và mục Week dùng ngay rule mới.';
    } catch (e: any) {
      this.weekRuleMsg = '❌ Không lưu được: ' + (e?.message || e);
    } finally {
      this.weekRuleBusy = false;
      this.cdr.markForCheck();
    }
  }
  private afAuthWeek = inject(AngularFireAuth);

  /** Mã bật theo dõi Week ở Danh mục NVL (+Week) — nạp khi mở mục Week. */
  kkWeekCatalogTracked: Set<string> | null = null;

  /** Nhập / sửa Week cho 1 PO (lô) ngay trong mục Week. */
  kkWeekEdit: InventoryMaterial | null = null;
  kkWeekSaving = false;

  openKkWeekEdit(m: InventoryMaterial): void {
    if (!this.canEdit || !m?.id) return;
    this.kkWeekEdit = m;
  }

  async saveKkWeekEdit(r: WeekInputResult): Promise<void> {
    const m = this.kkWeekEdit;
    if (!m?.id || this.kkWeekSaving) return;
    this.kkWeekSaving = true;
    try {
      const by = String(this.kkTypeScanOperator || this.kkOperatorIdCache || '').trim().toUpperCase() || 'quan-ly-nvl';
      await this.firestore.firestore.collection('inventory-materials').doc(m.id).update({
        week: r.value, weekFormat: r.format, weekUpdatedAt: new Date(), weekUpdatedBy: by, weekSource: 'quan-ly-nvl'
      });
      // Inbound của lô này cũng ghi Week (best effort)
      void this.firestore.firestore.collection('inbound-materials').where('linkedInventoryDocId', '==', m.id).limit(5).get()
        .then((s) => s.forEach((x) => void x.ref.update({ week: r.value, weekFormat: r.format, updatedAt: new Date() })))
        .catch(() => undefined);
      const stamp = (x: InventoryMaterial) => { if (x?.id === m.id) { x.week = r.value; x.weekFormat = r.format; } };
      stamp(m);
      this.kkLocMapTypeCache.forEach((list) => list.forEach(stamp));
      this.kkLocMapMaterialCache.forEach((list) => list.forEach(stamp));
      this.inventoryMaterials.forEach(stamp);
      this.patchKkInvSnapCache(m.id, { week: r.value, weekFormat: r.format });
      // Mã đã có Week → Danh mục NVL tự bật theo dõi Week
      void this.nvlCatalogFull.ensureWeekTracked(String(m.materialCode || ''), by).then(() => {
        this.kkWeekCatalogTracked?.add(String(m.materialCode || '').trim().toUpperCase());
      }).catch((e) => console.warn('ensureWeekTracked', e));
      this.kkWeekMemo.clear();
      this.invalidateKkTypeViewCache();
      this.kkWeekEdit = null;
    } catch (e) {
      appAlert(`❌ Lỗi lưu Week: ${(e as any)?.message || e}`);
    } finally {
      this.kkWeekSaving = false;
      this.cdr.detectChanges();
    }
  }

  /** Nhãn gọn cho cột Week bảng tồn: W35/26 (YYWW) hoặc 08/2026 (MMYY — tháng ghi đủ năm). */
  weekShortLabel(m: InventoryMaterial): string {
    const v = String(m.week || '').replace(/\D/g, '');
    if (v.length !== 4) return String(m.week || '');
    return (m.weekFormat === 'MMYY') ? `${v.slice(0, 2)}/20${v.slice(2, 4)}` : `W${v.slice(2, 4)}/${v.slice(0, 2)}`;
  }

  kkWeekDate(d: Date): string {
    return fmtDmy(d);
  }

  /** Ngày gọn DD/MM cho cột Được dùng. */
  kkWeekDdMm(d: Date): string {
    return fmtDmy(d).slice(0, 5);
  }

  /** Hạn dùng ngắn: "Còn 19 ngày" / "Quá hạn 5 ngày" / "Chưa được dùng". */
  kkWeekStatusShort(w: WeekWindow | null): string {
    if (!w) return 'Week không hợp lệ';
    if (w.status === 'early') return 'Chưa được dùng';
    if (w.status === 'late') return `Quá hạn ${-w.daysLeft} ngày`;
    return `Còn ${w.daysLeft} ngày`;
  }

  kkWeekRangeText(w: WeekWindow | null): string {
    return w ? `${fmtDmy(w.from)} → ${fmtDmy(w.to)}` : '—';
  }

  kkWeekStatusText(w: WeekWindow | null): string {
    return w ? weekStatusText(w) : 'Week không hợp lệ';
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
      appAlert('Mã NVL đã có DV Lưu trữ. Sửa tại Danh mục DV Lưu trữ.');
      return;
    }
    const code = this.getStorageMaterialKey(material);
    if (!code) {
      appAlert('Vui lòng nhập mã NVL trước khi chọn DV Lưu trữ.');
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
      appAlert('Không lưu được DV Lưu trữ. Vui lòng thử lại.');
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

  openTemLePopup(): void {
    if (this.denyAction('printLabels')) return;
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
    this.temLeGwClInput = null;
    this.temLeGwFullInput2 = null;
    this.temLeError = '';
    this.temLeParsed = null;
    this.resetTemLeTl();
  }

  private normalizeMaterialCodeUpper(raw: string): string {
    return (raw || '').toString().trim().toUpperCase();
  }

  openTemThungPopup(): void {
    if (this.denyAction('printLabels')) return;
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
    if (this.denyAction('printLabels')) return;
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

  /** Trạng thái bịch CL của IMD vừa scan (hiện trong popup Tem lẻ). */
  temLeClInfo = '';
  /** Bắt buộc nhập GW bịch CL (gram) trước khi in; mã chưa có GW bag nguyên thì nhập luôn. */
  temLeGwClInput: number | null = null;
  temLeGwFullInput2: number | null = null;
  temLeGwFullKnown = 0;
  temLeGwFullFor = '';

  /** Danh sách mã "không cần cân" (đã duyệt) — đọc 1 lần. */
  private weighExemptCodes: Set<string> | null = null;
  private weighIncludeCodes: Set<string> | null = null;
  /** Đầu mã in tem lẻ không cần cân (Danh mục NVL/TP → Check lượng / Cân). */
  private temLeNoWeighPrefixes: string[] | undefined;
  private weighExemptLoading = false;

  private ensureWeighExemptCodes(): void {
    if (this.weighExemptCodes || this.weighExemptLoading) return;
    this.weighExemptLoading = true;
    const ids = (name: string) => this.firestore.firestore.collection(name).get()
      .then((snap) => new Set(snap.docs.map((d) => d.id.trim().toUpperCase())))
      .catch(() => new Set<string>());
    Promise.all([
      ids('pxk-weight-check-exempt'),
      ids('pxk-weight-check-include'),
      this.pxkWeightReports.loadTemLeNoWeighPrefixes().catch(() => undefined)
    ])
      .then(([exempt, include, noWeigh]) => {
        this.weighIncludeCodes = include;
        this.weighExemptCodes = exempt;
        this.temLeNoWeighPrefixes = noWeigh;
      })
      .finally(() => { this.weighExemptLoading = false; this.cdr.markForCheck(); });
  }

  /** Mã đang tách có phải cân không — theo Danh mục Check lượng (nhóm đầu mã + mã thêm, trừ mã không cần cân). */
  get temLeNeedsWeigh(): boolean {
    if (!this.temLeParsed) return false;
    this.ensureWeighExemptCodes();
    return temLeMustWeigh(this.temLeParsed.materialCode, this.weighExemptCodes, this.weighIncludeCodes, this.temLeNoWeighPrefixes);
  }

  get temLeCanPrint(): boolean {
    const qty = Number(this.temLeSplitQty);
    if (!this.temLeParsed || !(qty > 0)) return false;
    if (!this.temLeNeedsWeigh) return true;
    if (!(Number(this.temLeGwClInput) > 0)) return false;
    if (!this.temLeTlPhoto || !(Number(this.temLeGwTlInput) > 0)) return false;
    return this.temLeGwFullKnown > 0 || Number(this.temLeGwFullInput2) > 0;
  }

  // ===== Chụp bịch TL trên cân lúc tách (đọc số cân từ hình) — Outbound kế thừa khi scan tem TL =====
  temLeTlPhoto: Blob | null = null;
  temLeTlPreview = '';
  temLeGwTlInput: number | null = null;
  /** Số đọc được từ hình (để biết người dùng có sửa tay không) */
  temLeTlOcr: number | null = null;
  temLeTlReading = false;
  temLeTlMsg = '';
  temLeTlCamOn = false;
  private temLeTlStream: MediaStream | null = null;
  @ViewChild('temLeTlVideo') temLeTlVideoRef?: ElementRef<HTMLVideoElement>;

  /** GW TL dự kiến = GW bag nguyên × lượng TL ÷ Standard (null nếu chưa đủ dữ liệu). */
  get temLeTlExpected(): number | null {
    const code = this.temLeParsed?.materialCode || '';
    const gwFull = this.temLeGwFullKnown > 0 ? this.temLeGwFullKnown : Number(this.temLeGwFullInput2) || 0;
    const std = this.stdForLot(code, this.temLeParsed?.po) || 0;
    const qty = Number(this.temLeSplitQty) || 0;
    return gwFull > 0 && std > 0 && qty > 0 ? gwFull * qty / std : null;
  }

  async startTemLeTlCamera(): Promise<void> {
    this.stopTemLeTlCamera();
    this.temLeTlMsg = '';
    if (!navigator.mediaDevices?.getUserMedia) {
      this.temLeTlMsg = 'Trình duyệt không mở được camera — bấm "Chọn / chụp ảnh".';
      return;
    }
    try {
      this.temLeTlStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      this.temLeTlCamOn = true;
      this.cdr.detectChanges();
      const video = this.temLeTlVideoRef?.nativeElement;
      if (!video || !this.showTemLePopup) { this.stopTemLeTlCamera(); return; }
      video.srcObject = this.temLeTlStream;
      await video.play().catch(() => undefined);
    } catch (e) {
      console.warn('tem le TL camera:', e);
      this.stopTemLeTlCamera();
      this.temLeTlMsg = 'Không mở được camera — cấp quyền camera hoặc bấm "Chọn / chụp ảnh".';
    }
    this.cdr.markForCheck();
  }

  private stopTemLeTlCamera(): void {
    this.temLeTlStream?.getTracks().forEach((t) => t.stop());
    this.temLeTlStream = null;
    const video = this.temLeTlVideoRef?.nativeElement;
    if (video) video.srcObject = null;
    this.temLeTlCamOn = false;
  }

  async captureTemLeTl(): Promise<void> {
    const video = this.temLeTlVideoRef?.nativeElement;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    this.stopTemLeTlCamera();
    await this.setTemLeTlPhoto(canvas);
  }

  onTemLeTlFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')?.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      this.stopTemLeTlCamera();
      void this.setTemLeTlPhoto(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      this.temLeTlMsg = 'Không đọc được ảnh.';
      this.cdr.markForCheck();
    };
    img.src = url;
  }

  private async setTemLeTlPhoto(canvas: HTMLCanvasElement): Promise<void> {
    if (this.temLeTlPreview) URL.revokeObjectURL(this.temLeTlPreview);
    this.temLeTlPhoto = await this.pxkOddWeigh.compressPhoto(canvas);
    this.temLeTlPreview = URL.createObjectURL(this.temLeTlPhoto);
    this.temLeTlReading = true;
    this.temLeTlMsg = 'Đang đọc số cân…';
    this.cdr.detectChanges();
    try {
      const { value } = await readScaleNumber(canvas);
      let gram = value;
      // Cân hiển thị kg (vd 0.523) → đổi sang gram nếu gần GW dự kiến hơn
      const exp = this.temLeTlExpected;
      if (gram != null && exp && Math.abs(gram * 1000 - exp) < Math.abs(gram - exp)) gram = gram * 1000;
      if (gram != null) gram = Math.round(gram * 10) / 10;
      this.temLeTlOcr = gram;
      if (gram != null) {
        this.temLeGwTlInput = gram;
        this.temLeTlMsg = `Đọc được ${gram} g — kiểm tra đúng số trên cân, sai thì sửa tay.`;
      } else {
        this.temLeTlMsg = 'Không đọc được số cân — nhập tay GW bịch TL, hoặc chụp lại gần hơn, đủ sáng.';
      }
    } catch (e) {
      console.warn('readScaleNumber:', e);
      this.temLeTlOcr = null;
      this.temLeTlMsg = 'Không đọc được số cân — nhập tay GW bịch TL.';
    } finally {
      this.temLeTlReading = false;
      this.cdr.markForCheck();
    }
  }

  retakeTemLeTl(): void {
    this.resetTemLeTl();
    void this.startTemLeTlCamera();
  }

  private resetTemLeTl(): void {
    this.stopTemLeTlCamera();
    if (this.temLeTlPreview) URL.revokeObjectURL(this.temLeTlPreview);
    this.temLeTlPhoto = null;
    this.temLeTlPreview = '';
    this.temLeGwTlInput = null;
    this.temLeTlOcr = null;
    this.temLeTlReading = false;
    this.temLeTlMsg = '';
  }

  private loadTemLeGwFull(code: string): void {
    const c = String(code || '').trim().toUpperCase();
    if (!c || this.temLeGwFullFor === c) return;
    this.temLeGwFullFor = c;
    this.temLeGwFullKnown = 0;
    void this.nvlCatalogFull.getByCode(c)
      .then((cat) => {
        if (this.temLeGwFullFor !== c) return;
        this.temLeGwFullKnown = catalogBagWeight(cat);
        this.cdr.markForCheck();
      })
      .catch(() => undefined);
  }
  /** Lần tách gần nhất — có khi scan lại tem cũ của bịch đã tách (cho phép Hủy lần tách). */
  temLeLastSplit: TemLeSplitLog | null = null;
  temLeUndoBusy = false;

  onTemLeQrTextChanged(): void {
    this.temLeError = '';
    this.temLeClInfo = '';
    this.temLeLastSplit = null;
    if (this.temLeTlPhoto || this.temLeTlCamOn) this.resetTemLeTl();
    this.temLeParsed = this.parseTemLeQrText(this.temLeQrText);
    if (this.temLeParsed) this.loadTemLeGwFull(this.temLeParsed.materialCode);
    const parsed = this.temLeParsed;
    if (!parsed) return;
    const p = this.rmBagHistory.parseQrPart4(parsed.p4);
    const scannedTag = p.splitTag || '';
    void this.temLeCl.getState(this.selectedFactory, parsed.materialCode.trim().toUpperCase(), parsed.po.trim(), p.imdKey)
      .then((st) => {
        if (this.temLeParsed !== parsed) return;
        if (scannedTag.startsWith('TL')) {
          this.temLeClInfo = `⛔ Tem ${scannedTag} là phần đã tách để xuất — không tách tiếp.`;
        } else if (st?.clActive && scannedTag === st.clTag) {
          this.temLeClInfo = `Đang tách bịch ${st.clTag} (còn ${this.formatNumber(st.clQty)}) → in TL-${String(st.seq + 1).padStart(2, '0')} + CL-${String(st.seq + 1).padStart(2, '0')}`;
        } else if (st?.clActive && !scannedTag && TemLeClService.isSameBag(p.bagFractionLabel, st.bagFraction)) {
          const next = String(st.seq + 1).padStart(2, '0');
          this.temLeClInfo = `Tem cũ của bịch ${st.clTag} (còn ${this.formatNumber(st.clQty)}) → tách được, in TL-${next} + CL-${next} mới, bỏ tem cũ.`;
          void this.temLeCl.getLastSplit(this.selectedFactory, parsed.materialCode.trim().toUpperCase(), parsed.po.trim(), p.imdKey)
            .then((last) => {
              if (this.temLeParsed === parsed && last && last.clTag === st.clTag) {
                this.temLeLastSplit = last;
                this.cdr.markForCheck();
              }
            })
            .catch(() => undefined);
        } else if (st?.clActive) {
          this.temLeClInfo = `⛔ IMD này còn bịch ${st.clTag} (${this.formatNumber(st.clQty)}). Xuất hết ${st.clTag} trước rồi mới tách bịch chẵn.`;
          // Scan lại tem cũ của chính bịch đã tách → nói rõ, cho Hủy lần tách nếu tách sai
          void this.temLeCl.getLastSplit(this.selectedFactory, parsed.materialCode.trim().toUpperCase(), parsed.po.trim(), p.imdKey)
            .then((last) => {
              if (this.temLeParsed !== parsed || !last || last.clTag !== st.clTag) return;
              this.temLeLastSplit = last;
              const when = last.at ? last.at.toLocaleString('vi-VN', { hour12: false }) : '';
              this.temLeClInfo = `⛔ Bịch này đã tách ${when}${last.by ? ' (' + last.by + ')' : ''}: `
                + `${last.tlTag} = ${this.formatNumber(last.tlQty)} + ${last.clTag} = ${this.formatNumber(last.clQty)}. `
                + `Bịch đang giữ là ${last.clTag} — scan tem ${last.clTag} để tách tiếp. `
                + `Tách sai và ${last.tlTag} chưa xuất thì bấm "Hủy lần tách" rồi tách lại.`;
              this.cdr.markForCheck();
            })
            .catch(() => undefined);
        } else {
          const next = String((Number(st?.seq) || 0) + 1).padStart(2, '0');
          this.temLeClInfo = `Bịch chẵn → in TL-${next} (phần xuất) + CL-${next} (bịch còn lại)`;
        }
        this.cdr.markForCheck();
      })
      .catch(() => { /* chỉ là thông tin — lỗi đọc không chặn */ });
  }

  // ===== Cân GW bag CL sau khi in tem (16/10 → 17/10/2026) =====
  temLeGwStep: {
    logId: string; code: string; po: string; imd: string; clTag: string; clQty: number;
    fullQty: number; gwFull: number; gwFullKnown: boolean;
  } | null = null;
  temLeGwCl: number | null = null;
  temLeGwFullInput: number | null = null;
  temLeGwMsg = '';
  temLeGwOk: boolean | null = null;
  temLeGwBusy = false;

  /**
   * Lưu GW bịch CL đã nhập trước khi in + so với GW dự kiến (GW bag nguyên × lượng CL ÷ lượng bag nguyên).
   * Lệch > 5% → danh mục nghi ngờ (email 8h sáng hôm sau).
   */
  private async saveTemLeGwAfterSplit(
    res: TemLeSplitResult, code: string, po: string, imd: string, sourceQty: number, gwCl: number, gwFull: number,
    tl: { photo: Blob; gw: number; ocr: number | null } | null
  ): Promise<void> {
    try {
      const by = await this.getMaterialsOtpRequester();
      if (this.temLeGwFullKnownFor(code) <= 0 && gwFull > 0) await this.nvlCatalogFull.setGwBag(code, gwFull, by);
      let std = this.stdForLot(code, po) || 0;
      if (!std) std = Number((await this.nvlCatalogFull.getByCode(code).catch(() => null))?.standardPacking) || 0;
      const fullQty = std || sourceQty;
      const dev = (gw: number, qty: number) => {
        const expected = fullQty > 0 ? gwFull * qty / fullQty : null;
        const devPct = expected ? Math.round(((gw - expected) / expected) * 1000) / 10 : null;
        return { expected, devPct, ok: devPct != null && Math.abs(devPct) <= WEIGH_TOLERANCE_PERCENT };
      };
      const cl = dev(gwCl, res.clQty);
      let photo: { url: string; path: string } | null = null;
      let photoErr = '';
      if (tl) {
        try {
          photo = await this.pxkOddWeigh.uploadPhoto(this.selectedFactory, 'TEM-LE', `${code}_${po}_${imd}_${res.tlTag}`, tl.photo);
        } catch (e: any) {
          console.error('upload TL photo:', e);
          photoErr = e?.message || String(e);
        }
      }
      const t = tl && photo ? dev(tl.gw, res.tlQty) : null;
      const ok = cl.ok && (!t || t.ok);
      const reasons: string[] = [];
      if (!cl.ok) reasons.push(cl.devPct == null ? 'Không tính được GW dự kiến' : `${res.clTag} lệch ${cl.devPct}%`);
      if (t && !t.ok) reasons.push(t.devPct == null ? 'Không tính được GW TL dự kiến' : `${res.tlTag} lệch ${t.devPct}%`);
      await this.temLeCl.saveGwCheck(res.logId, {
        factory: this.selectedFactory, materialCode: code, po, imd, clTag: res.clTag, clQty: res.clQty,
        fullQty, gwBagFull: gwFull, gwCl, gwExpected: cl.expected == null ? null : Math.round(cl.expected), devPct: cl.devPct, ok,
        reason: reasons.join('; '), by,
        ...(tl && t && photo ? {
          tlTag: res.tlTag, tlQty: res.tlQty, gwTl: tl.gw, gwTlExpected: t.expected == null ? null : Math.round(t.expected),
          tlDevPct: t.devPct, tlOk: t.ok, tlGwOcr: tl.ocr, tlPhotoUrl: photo.url, tlPhotoPath: photo.path
        } : {})
      });
      if (!ok) {
        const lines: string[] = [];
        if (!cl.ok) lines.push(`GW bịch ${res.clTag} lệch ${cl.devPct ?? '?'}% (cân ${gwCl} g, dự kiến ${cl.expected ? Math.round(cl.expected) : '?'} g).`);
        if (tl && t && !t.ok) lines.push(`GW bịch ${res.tlTag} lệch ${t.devPct ?? '?'}% (cân ${tl.gw} g, dự kiến ${t.expected ? Math.round(t.expected) : '?'} g).`);
        appAlert(`⚠️ ${lines.join('\n')}\nĐã in tem và ghi vào danh mục nghi ngờ (email 8h sáng mai).`);
      }
      if (photoErr) {
        appAlert(`Đã in tem nhưng chưa lưu được hình bịch ${res.tlTag}: ${photoErr}\nKhi scan xuất tem ${res.tlTag} ở Outbound sẽ phải chụp + cân lại.`);
      }
    } catch (e: any) {
      console.error('saveTemLeGwAfterSplit:', e);
      appAlert('Đã in tem nhưng chưa lưu được GW / hình bịch TL: ' + (e?.message || e)
        + '\nKhi scan xuất tem TL ở Outbound sẽ phải chụp + cân lại.');
    }
  }

  private temLeGwFullKnownFor(code: string): number {
    return this.temLeGwFullFor === String(code || '').trim().toUpperCase() ? this.temLeGwFullKnown : 0;
  }

  /** GW dự kiến bag CL = GW bag nguyên × (lượng CL ÷ lượng bag nguyên). Lệch ≤ 5% là đạt. */
  async saveTemLeGw(skip = false): Promise<void> {
    const st = this.temLeGwStep;
    if (!st || this.temLeGwBusy) return;
    if (this.temLeGwOk !== null) { this.temLeGwStep = null; return; }
    const gwCl = Number(this.temLeGwCl) || 0;
    const gwFull = st.gwFullKnown ? st.gwFull : Math.round(Number(this.temLeGwFullInput) || 0);
    if (!skip) {
      if (!(gwCl > 0)) { this.temLeGwMsg = 'Nhập GW bag CL (gram).'; return; }
      if (!(gwFull > 0)) { this.temLeGwMsg = 'Mã chưa có GW bag nguyên — nhập GW bag nguyên (gram).'; return; }
    }
    this.temLeGwBusy = true;
    this.cdr.detectChanges();
    try {
      const by = await this.getMaterialsOtpRequester();
      if (!skip && !st.gwFullKnown && gwFull > 0) await this.nvlCatalogFull.setGwBag(st.code, gwFull, by);
      const expected = !skip && gwFull > 0 && st.fullQty > 0 ? gwFull * st.clQty / st.fullQty : null;
      const devPct = expected ? Math.round(((gwCl - expected) / expected) * 1000) / 10 : null;
      const ok = !skip && devPct != null && Math.abs(devPct) <= 5;
      await this.temLeCl.saveGwCheck(st.logId, {
        factory: this.selectedFactory, materialCode: st.code, po: st.po, imd: st.imd, clTag: st.clTag, clQty: st.clQty,
        fullQty: st.fullQty, gwBagFull: gwFull, gwCl: skip ? null : gwCl,
        gwExpected: expected == null ? null : Math.round(expected), devPct, ok,
        reason: skip ? 'Không nhập GW' : (ok ? '' : `Lệch ${devPct}%`), by
      });
      this.temLeGwOk = ok;
      this.temLeGwMsg = skip
        ? 'Đã bỏ qua — ghi vào danh mục nghi ngờ (email 8h sáng mai).'
        : ok
          ? `✅ Đạt: GW ${gwCl} g, dự kiến ${Math.round(expected!)} g (lệch ${devPct}%).`
          : `⚠️ Lệch ${devPct}% (GW ${gwCl} g, dự kiến ${Math.round(expected!)} g) — đã ghi danh mục nghi ngờ, email 8h sáng mai.`;
    } catch (e: any) {
      this.temLeGwMsg = '❌ Không lưu được GW: ' + (e?.message || e);
    } finally {
      this.temLeGwBusy = false;
      this.cdr.detectChanges();
    }
  }

  // Danh mục nghi ngờ sai lệch GW
  showTemLeGwSuspects = false;
  temLeGwSuspects: any[] = [];
  temLeGwSuspectsLoading = false;

  async openTemLeGwSuspects(): Promise<void> {
    this.showTemLeGwSuspects = true;
    this.temLeGwSuspectsLoading = true;
    this.cdr.detectChanges();
    try {
      this.temLeGwSuspects = await this.temLeCl.listGwSuspects();
    } catch (e) {
      console.error('listGwSuspects:', e);
      this.temLeGwSuspects = [];
    } finally {
      this.temLeGwSuspectsLoading = false;
      this.cdr.detectChanges();
    }
  }

  gwSuspectTime(v: any): string {
    const d = v?.toDate ? v.toDate() : null;
    return d ? d.toLocaleString('vi-VN', { hour12: false }) : '';
  }

  // ===== Report "không cân được" (tách lẻ & cân) → danh sách Check lượng PXK chờ duyệt =====
  readonly weighReasons = WEIGH_EXEMPT_REASONS;
  readonly weighOther = WEIGH_EXEMPT_OTHER;
  weighReport: { code: string; po: string; lsx: string; maKho: string; choice: string; other: string; busy: boolean; msg: string; ok: boolean } | null = null;

  openWeighReport(code: string, po: string, lsx: string, maKho = ''): void {
    const c = String(code || '').trim().toUpperCase();
    if (!c) return;
    this.weighReport = { code: c, po: String(po || '').trim(), lsx: String(lsx || '').trim(), maKho, choice: '', other: '', busy: false, msg: '', ok: false };
  }

  async submitWeighReport(): Promise<void> {
    const r = this.weighReport;
    if (!r || r.busy) return;
    const reason = buildWeighExemptReason(r.choice, r.other, 'Tách lẻ & cân — Materials');
    if (!reason) { r.msg = r.choice === WEIGH_EXEMPT_OTHER ? 'Nhập lý do khác.' : 'Chọn lý do.'; return; }
    r.busy = true;
    r.msg = '';
    try {
      const sent = await this.pxkWeightReports.submit({
        lsx: r.lsx, materialCode: r.code, maKho: r.maKho, po: r.po, reason,
        reportedBy: await this.getMaterialsOtpRequester()
      });
      r.ok = true;
      r.msg = sent.zaloOk
        ? '✅ Đã gửi — chờ duyệt ở Work Order Status (Danh mục check lượng) hoặc nhóm Quản lý kho rep "duyệt".'
        : '✅ Đã lưu báo cáo (chờ duyệt). Zalo chưa gửi được tới nhóm Quản lý kho.';
    } catch (e: any) {
      r.msg = '❌ Không gửi được: ' + (e?.message || e);
    } finally {
      r.busy = false;
      this.cdr.detectChanges();
    }
  }

  async undoTemLeLastSplit(): Promise<void> {
    const last = this.temLeLastSplit;
    const parsed = this.temLeParsed;
    if (!last || !parsed || this.temLeUndoBusy) return;
    const p = this.rmBagHistory.parseQrPart4(parsed.p4);
    if (!confirm(`Hủy lần tách ${last.tlTag} (${this.formatNumber(last.tlQty)}) + ${last.clTag} (${this.formatNumber(last.clQty)})?\n`
      + `Bỏ 2 tem ${last.tlTag} / ${last.clTag} đã in. Chỉ hủy khi ${last.tlTag} CHƯA scan xuất.`)) return;
    this.temLeUndoBusy = true;
    try {
      await this.temLeCl.undoLastSplit(this.selectedFactory, parsed.materialCode.trim().toUpperCase(), parsed.po.trim(),
        p.imdKey, last.id, await this.getMaterialsOtpRequester());
      this.onTemLeQrTextChanged();
    } catch (e: any) {
      this.temLeError = e?.message || 'Không hủy được lần tách.';
    } finally {
      this.temLeUndoBusy = false;
      this.cdr.markForCheck();
    }
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
    const qty = isRmQtyDecimalFactory(this.selectedFactory)
      ? parseRmScanQty(parts[2], RM_QTY_DECIMALS_4)
      : Number(String(parts[2] || '').replace(/,/g, '').trim());
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
    const mustWeigh = this.temLeNeedsWeigh;
    const gwCl = Math.round(Number(this.temLeGwClInput) || 0);
    const gwFull = this.temLeGwFullKnown > 0 ? this.temLeGwFullKnown : Math.round(Number(this.temLeGwFullInput2) || 0);
    if (mustWeigh && !(gwCl > 0)) {
      this.temLeError = 'Cân và nhập GW bịch CL (gram) trước khi in tem.';
      return;
    }
    if (mustWeigh && !(gwFull > 0)) {
      this.temLeError = 'Mã chưa có GW bag nguyên — nhập GW bag nguyên (gram).';
      return;
    }
    const gwTl = Math.round((Number(this.temLeGwTlInput) || 0) * 10) / 10;
    if (mustWeigh && (!this.temLeTlPhoto || !(gwTl > 0))) {
      this.temLeError = 'Đặt bịch TL lên cân, chụp hình và kiểm tra GW bịch TL (gram) trước khi in tem.';
      return;
    }
    const tlWeigh = mustWeigh && this.temLeTlPhoto ? { photo: this.temLeTlPhoto, gw: gwTl, ocr: this.temLeTlOcr } : null;

    // Tem lẻ TL / CL (16/10/2026): chỉ tách từ bịch chẵn (IMD không còn CL) hoặc đúng bịch CL hiện tại.
    // Lần tách n in TL-0n (phần đem xuất) + CL-0n (bịch còn lại). Kiểm tra + ghi trạng thái trong 1 transaction.
    const p = this.rmBagHistory.parseQrPart4(parsed.p4);
    let splitQrData = '';
    let remainQrData = '';
    let splitRes: TemLeSplitResult | null = null;
    try {
      const res = await this.temLeCl.split({
        factory: this.selectedFactory,
        materialCode: parsed.materialCode.trim().toUpperCase(),
        po: parsed.po.trim(),
        quantity: parsed.quantity,
        p4: parsed.p4,
        imd: p.imdKey,
        bagFraction: p.bagFractionLabel
      }, splitQty, await this.getMaterialsOtpRequester());
      splitQrData = res.tlQrData;
      remainQrData = res.clQrData;
      splitRes = res;
    } catch (e: any) {
      this.temLeError = e?.message || 'Không tách được tem.';
      this.cdr.markForCheck();
      return;
    }

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
      const code = parsed.materialCode.trim().toUpperCase();
      this.closeTemLePopup();
      if (splitRes && mustWeigh) void this.saveTemLeGwAfterSplit(splitRes, code, parsed.po.trim(), p.imdKey, Number(parsed.quantity) || 0, gwCl, gwFull, tlWeigh);
    } catch (e) {
      console.error('❌ Tem Lẽ print error:', e);
      this.temLeError = 'Lỗi khi tạo/in tem. Vui lòng thử lại.';
    }
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

  private ensureTemLeSuffixPool(): void {
    if (this.temLeSuffixPool.length > 0) return;
    this.temLeSuffixPool = this.generateTemLeSuffixPool6(6);
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

  /** Tab riêng Kiểm tra KK — `/quan-ly-nguyen-lieu` (QuanLyNguyenLieuComponent ghi đè thành true). */
  get isNguyenLieuPage(): boolean {
    return false;
  }

  // ── Hook cho trang Kiểm kê: RM Inventory để trống, QuanLyNguyenLieuComponent ghi đè ──

  /** Cuối ngOnInit. */
  protected initKkPage(): void { }

  /** Sau khi đổi nhà máy. */
  protected onKkPageFactoryChanged(): void {
    this.showKkTypeReportMenu = false;
    this.showKkIdReport = false;
    this.showKkPalletCheck = false;
  }

  /** Khi cửa sổ đổi kích thước. */
  protected onKkPageResize(): void { }

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

  onKkHidScanFocus(event: FocusEvent): void {
    const el = event.target as HTMLInputElement | null;
    if (!el) return;
    // Tem NV PDA: giữ inputmode=text để máy quét gõ vào ô. inputmode=none hay nuốt mã.
    if (el.id === 'kkTypeScanOperatorInput') return;
    this.suppressVirtualKeyboard(el);
  }

  protected suppressVirtualKeyboard(el: HTMLInputElement): void {
    try {
      el.setAttribute('inputmode', 'none');
      (el as HTMLInputElement & { virtualKeyboardPolicy?: string }).virtualKeyboardPolicy = 'manual';
    } catch { /* ignore */ }
    try {
      const vk = (navigator as Navigator & { virtualKeyboard?: { overlaysContent: boolean; hide?: () => void } }).virtualKeyboard;
      if (vk) {
        vk.overlaysContent = true;
        vk.hide?.();
      }
    } catch { /* ignore */ }
  }

  protected unlockKkScanKeyboard(): void {
    this.detachKkDocScan();
    const meta = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    if (meta && this.kkPrevViewport) {
      meta.content = this.kkPrevViewport;
      this.kkPrevViewport = '';
    }
    document.body.classList.remove('kk-scan-kb-lock');
  }

  private detachKkDocScan(): void {
    if (this.kkDocScanHandler) {
      document.removeEventListener('keydown', this.kkDocScanHandler, true);
      this.kkDocScanHandler = null;
    }
    if (this.kkDocScanTimer) {
      clearTimeout(this.kkDocScanTimer);
      this.kkDocScanTimer = null;
    }
    this.kkDocScanBuf = '';
    this.kkDocScanAt = 0;
  }

  protected kkActiveScanInputId(): string {
    if (this.kkTypeScanStep === 'operator') return 'kkTypeScanOperatorInput';
    if (this.kkTypeScanStep === 'location') return 'kkTypeScanLocationInput';
    return 'kkTypeScanQrInput';
  }

  pinKkScanFocus(): void {
    if (!this.showKkTypeScanModal) return;
    this.focusKkTypeScanInput(this.kkActiveScanInputId());
  }

  stopNlCamera(): void {
    const sc = this.html5QrCode;
    this.html5QrCode = null;
    this.isScanning = false;
    this.showNlCamera = false;
    this.nlScanLock = false;
    if (sc) {
      void sc.stop().catch(() => undefined);
    }
    this.cdr.markForCheck();
  }

  /** Vị trí yêu cầu đã gán ngoài box loại hàng. */
  getKkHomeLocForMaterial(material: InventoryMaterial | null | undefined): string {
    const code = String(material?.materialCode || '').trim();
    if (!code) return '';
    const loc = this.kkCatalog.assignedLocForMaterial(code, this.kkCatalogTypeMap, this.kkTypeHomeLocs);
    if (!loc) return '';
    if (/^S\d{2}-T\d$/i.test(loc) || /^S\d{2}-\d+$/i.test(loc)) return loc.toUpperCase();
    return this.primaryLocationDisplay(loc);
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

  // ===== Lịch sử KK dạng log (kk-history-log): lưu 1 năm, quá 1 năm tải file về máy =====
  /** Ghi 1 dòng inventory-kk-history vào batch + đưa vào log. */
  protected kkLogSet(batch: firebase.default.firestore.WriteBatch, data: Record<string, any>): void {
    batch.set(this.firestore.firestore.collection('inventory-kk-history').doc(), data);
    this.kkLog.enqueue(data);
  }

  private kkLogAdd(data: Record<string, any>): Promise<unknown> {
    this.kkLog.enqueue(data);
    return this.firestore.collection('inventory-kk-history').add(data);
  }
  kkLogArchiveDue = false;

  async checkKkLogArchive(): Promise<void> {
    try {
      this.kkLogArchiveDue = await this.kkLog.isArchiveDue(this.selectedFactory);
      this.readTracker.track('materials', 'kk-history-log', 1);
      this.cdr.detectChanges();
    } catch (e) {
      console.warn('kk log archive check:', e);
    }
  }

  /** Mỗi ngày kiểm 1 lần (1 lượt đọc): có log quá 1 năm cần tải về không. */
  private autoCheckKkLogArchive(): void {
    const key = `kk-log-archive-check:${this.selectedFactory}`;
    const today = kkLogDateKey(new Date());
    try {
      const prev = localStorage.getItem(key) || '';
      if (prev.startsWith(today)) { this.kkLogArchiveDue = prev.endsWith(':1'); return; }
    } catch { /* bỏ qua */ }
    void this.checkKkLogArchive().then(() => {
      try { localStorage.setItem(key, `${today}:${this.kkLogArchiveDue ? 1 : 0}`); } catch { /* bỏ qua */ }
    });
  }

  // ===== Tiêu hủy (kiểm): import Mã + Lượng tiêu hủy → đọc vị trí / tồn, đánh dấu Có / Không có / Thiếu =====
  // Lưu 1 doc / nhà máy: tieu-huy-check/{factory} (1 lượt đọc khi mở, 1 lượt ghi khi sửa).
  readonly thOptions: Array<{ value: '' | 'co' | 'khong-co' | 'thieu'; label: string }> = [
    { value: '', label: '—' },
    { value: 'co', label: 'Có' },
    { value: 'khong-co', label: 'Không có' },
    { value: 'thieu', label: 'Thiếu' }
  ];
  showThCheck = false;
  /** true = mở từ Công cụ (Import / File mẫu / Xóa); false = nút TH (chỉ xem + kiểm). */
  thManage = false;
  thItems: Array<{ code: string; qty: number; option: '' | 'co' | 'khong-co' | 'thieu'; actualQty: number | null }> = [];
  thMeta: { fileName: string; importedAt: Date | null; importedBy: string } = { fileName: '', importedAt: null, importedBy: '' };
  thStock = new Map<string, { name: string; stock: number; locations: string; lines: number }>();
  /** Tồn LinkQ theo mã (file LinkQ mới nhất, có cache) — null = chưa đọc. */
  thLinkQ: Map<string, number> | null = null;
  thLinkQLabel = '';
  thLoading = false;
  thStockLoading = false;
  thError = '';
  thQuery = '';
  thOptionFilter = '';
  private thSaveTimer: any = null;

  /** So sánh PO đang bật và đúng file của nhà máy đang xem. */
  get kkPoCmpActive(): boolean {
    return this.kkPoCmpOn && !!this.kkPoCmp && this.kkPoCmpFactory === this.selectedFactory;
  }

  /** Lượng PXK chưa xuất của mã + PO (Work Order chưa Done, web chưa scan xuất). */
  kkPoCmpPendingOf(code: unknown, po: unknown): number {
    // Service PXK để PO trống là '' (không phải '—')
    const p = kkPoCmpPo(po);
    return this.kkPoCmpPending?.get(`${kkPoCmpCode(code)}|${p === KK_PO_BLANK ? '' : p}`)?.qty || 0;
  }

  /** Web còn PO này chỉ vì PXK chưa Done: LinkQ đã trừ xuất, web chưa scan → tồn web của mã + PO ≤ lượng PXK chưa xuất. */
  private isKkPoExplainedByPxk(m: InventoryMaterial, webByKey: Map<string, number>): boolean {
    const pending = this.kkPoCmpPendingOf(m.materialCode, m.poNumber);
    if (!(pending > 0)) return false;
    const web = webByKey.get(`${kkPoCmpCode(m.materialCode)}|${kkPoCmpPo(m.poNumber)}`) || 0;
    return web <= pending + 0.001;
  }

  /** Không tính vào Dư sai: dòng ở Kho NG hoặc trạng thái QC Chờ kiểm / NG. */
  protected isKkPoSurplusExcluded(m: InventoryMaterial): boolean {
    if (this.isKkNgLine(m)) return true;
    const qc = String((m as any)?.iqcStatus || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd').toUpperCase().trim();
    return qc.includes('CHO KIEM') || /\bNG\b/.test(qc);
  }

  /** QC / IQC = NG: trang Kiểm kê (Quản lý NL) không tính vào box / mục và không hiện khi mở. */
  protected isKkQcNgData(data: any): boolean {
    const qc = String(data?.iqcStatus || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[đĐ]/g, 'd').toUpperCase().trim();
    return /\bNG\b/.test(qc);
  }

  /** Dòng tồn nằm ở Kho NG (vị trí NG…). */
  protected isKkNgLine(m: InventoryMaterial): boolean {
    const loc = String(m?.location ?? (m as any)?.viTri ?? '');
    const tokens = splitMultiLocations(loc);
    return (tokens.length ? tokens : [loc]).some((t) => this.locationMatchesViewWarehouse(t, 'NG'));
  }

  /** Tổng Tồn cuối kỳ của mã trong file LinkQ (null = file import cũ chưa có lượng). */
  private kkPoCmpLinkqTotal(code: string): number | null {
    const data = this.kkPoCmp;
    const pos = data?.byCode.get(code);
    if (!data || !pos) return null;
    let sum = 0;
    for (const po of pos) {
      const q = data.qtyByKey.get(`${code}|${po}`);
      if (q == null) return null;
      sum += q;
    }
    return Math.round(sum * 10000) / 10000;
  }

  /**
   * PO dư sai — có thể xóa: web có PO, LinkQ không; không có PXK chưa xuất của mã + PO;
   * tồn web của PO ≈ lệch tổng mã (tổng web − tổng LinkQ).
   */
  private isKkPoSurplus(m: InventoryMaterial, webByKey: Map<string, number>, webByCode: Map<string, number>): boolean {
    const code = kkPoCmpCode(m.materialCode);
    const po = kkPoCmpPo(m.poNumber);
    if (!this.isKkPoMismatch(m)) return false;
    if (this.kkPoCmpPendingOf(code, po) > 0) return false;
    const linkq = this.kkPoCmpLinkqTotal(code);
    if (linkq == null) return false;
    const webPo = webByKey.get(`${code}|${po}`) || 0;
    const diff = (webByCode.get(code) || 0) - linkq;
    if (!(webPo > 0)) return false;
    return Math.abs(webPo - diff) <= Math.max(0.01, webPo * 0.001);
  }

  toggleKkPoCmpSurplus(): void {
    this.kkPoCmpSurplusOnly = !this.kkPoCmpSurplusOnly;
    this.onKkPoCmpChanged();
  }

  /** Excel các dòng dư sai — xem trước khi ẩn. */
  async exportKkPoCmpSurplus(): Promise<void> {
    const rows = this.kkPoCmpSurplusRows;
    if (!rows.length) return;
    const XLSX = await import('xlsx');
    const webByCode = new Map<string, number>();
    for (const m of this.kkTypeDetailAll) {
      if (this.isKkPoSurplusExcluded(m)) continue;
      const c = kkPoCmpCode(m.materialCode);
      webByCode.set(c, (webByCode.get(c) || 0) + this.calculateCurrentStock(m));
    }
    const data = rows.map((m) => {
      const code = kkPoCmpCode(m.materialCode);
      const linkq = this.kkPoCmpLinkqTotal(code) || 0;
      return {
        'Mã hàng': code,
        'Tên hàng': m.materialName || '',
        'PO (web, không có trên LinkQ)': m.poNumber || '',
        'IMD': this.getDisplayIMD(m),
        'Vị trí': m.location || '',
        'Tồn dòng này': this.calculateCurrentStock(m),
        'Tổng web của mã (không tính kho NG)': Math.round((webByCode.get(code) || 0) * 10000) / 10000,
        'Tổng LinkQ của mã': linkq,
        'Lệch (web − LinkQ)': Math.round(((webByCode.get(code) || 0) - linkq) * 10000) / 10000,
        'PO trên LinkQ': this.kkPoCmpFilePos(m)
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PO du sai');
    XLSX.writeFile(wb, `PO_du_sai_${this.selectedFactory}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  /** Ẩn hàng loạt các dòng dư sai (vào Danh mục Ẩn 30 ngày — khôi phục được). */
  async hideKkPoCmpSurplus(): Promise<void> {
    const rows = this.kkPoCmpSurplusRows.filter((m) => !!m.id && m.factory === this.selectedFactory);
    if (!rows.length || this.kkPoCmpSurplusBusy) return;
    if (!this.canDelete) {
      appAlert('❌ Bạn không có quyền Xóa / Ẩn. Liên hệ admin để được cấp quyền.');
      return;
    }
    const total = rows.reduce((s, m) => s + this.calculateCurrentStock(m), 0);
    const sample = rows.slice(0, 10).map((m) => `• ${m.materialCode} · PO ${m.poNumber} · ${this.formatNumber(this.calculateCurrentStock(m))}`).join('\n');
    if (!confirm(
      `Ẩn ${rows.length} dòng PO dư sai (tổng ${this.formatNumber(total)}) khỏi ${this.selectedFactory} Inventory?\n\n` +
      `${sample}${rows.length > 10 ? '\n…' : ''}\n\n` +
      `Các dòng vào danh mục Ẩn (More), tự xóa sau ${this.hiddenRetentionDays} ngày — khôi phục được trong thời gian đó.\nNên tải Excel xem trước.`
    )) return;
    this.kkPoCmpSurplusBusy = true;
    this.cdr.detectChanges();
    try {
      const ids = rows.map((m) => m.id!) ;
      const n = await this.hideInventoryDocsByIds(ids, 'po-surplus');
      this.removeInventoryByIds(new Set(ids));
      this.invalidateKkTypeViewCache();
      appAlert(`✅ Đã ẩn ${n} / ${rows.length} dòng PO dư sai. Xem lại trong More → Danh mục Ẩn.`);
    } catch (e: any) {
      appAlert('❌ Lỗi khi ẩn: ' + (e?.message || e));
    } finally {
      this.kkPoCmpSurplusBusy = false;
      this.cdr.detectChanges();
    }
  }

  private kkPoCmpPendingFactory = '';

  protected loadKkPoCmpPending(): void {
    const factory = this.selectedFactory;
    if (this.kkPoCmpPending && this.kkPoCmpPendingFactory === factory) return;
    this.kkPoCmpPending = null;
    this.linkQPendingPxkSvc.loadByPo(factory)
      .then((map) => {
        if (this.selectedFactory !== factory) return;
        this.kkPoCmpPending = map;
        this.kkPoCmpPendingFactory = factory;
        // Popup mở trước khi PXK đọc xong → tính lại để có cột PXK chưa xuất
        if (this.kkPoCmpDetail && this.kkPoCmpDetailSrc) this.openKkPoCmpDetail(this.kkPoCmpDetailSrc);
      })
      .catch((e) => { console.warn('So sánh PO: không đọc được PXK chưa xuất', e); this.kkPoCmpPending = new Map(); })
      .finally(() => this.cdr.detectChanges());
  }

  /** Mã có trong file tuổi hàng nhưng PO của dòng tồn này không có trong file (không so IMD). */
  isKkPoMismatch(m: InventoryMaterial): boolean {
    const set = this.kkPoCmp?.byCode.get(kkPoCmpCode(m.materialCode));
    return !!set && !set.has(kkPoCmpPo(m.poNumber));
  }

  /** PO của mã trong file (tooltip). */
  kkPoCmpFilePos(m: InventoryMaterial): string {
    const set = this.kkPoCmp?.byCode.get(kkPoCmpCode(m.materialCode));
    return set ? Array.from(set).sort().join(', ') : '';
  }

  /** Công cụ → So sánh PO: chưa ở bảng xem toàn bộ thì mở "Xem toàn bộ tất cả mục" rồi bật so sánh. */
  async kkPoCompareFromMenu(): Promise<void> {
    if (!this.kkAllStockDetail && !this.kkMucAllDetail) {
      this.openKkAllMucsForPoCmp();
      if (!this.kkMucAllDetail) {
        appAlert('Chưa có danh sách box KK — bấm Đọc toàn kho trước.');
        return;
      }
      if (this.kkPoCmpOn) return;
    }
    await this.toggleKkPoCompare();
  }

  /** Bấm mã (đang So sánh PO): so toàn bộ PO của mã ở web (tồn từng PO) và LinkQ (Tồn cuối kỳ trong file). */
  /** Dòng đang mở popup — PXK đọc xong thì tính lại popup. */
  private kkPoCmpDetailSrc: InventoryMaterial | null = null;

  openKkPoCmpDetail(m: InventoryMaterial): void {
    if (!this.kkPoCmpActive || !this.kkPoCmp) return;
    this.kkPoCmpDetailSrc = m;
    const code = kkPoCmpCode(m.materialCode);
    const web = this.kkTypeDetailAll
      .filter((x) => kkPoCmpCode(x.materialCode) === code)
      .map((x) => ({ po: x.poNumber, stock: this.calculateCurrentStock(x) }));
    const lsxText = (info?: PendingPxkPo) =>
      (info?.lsx || []).map((x) => `${x.lsx} (${this.formatNumber(x.qty)})`).join(', ');
    const linkqTotal = this.kkPoCmpLinkqTotal(code);
    // Dư sai không tính kho NG
    const okLines = this.kkTypeDetailAll.filter((x) => kkPoCmpCode(x.materialCode) === code && !this.isKkPoSurplusExcluded(x));
    const webTotalAll = okLines.reduce((s, x) => s + this.calculateCurrentStock(x), 0);
    const okByPo = new Map<string, number>();
    okLines.forEach((x) => okByPo.set(kkPoCmpPo(x.poNumber) || '—', (okByPo.get(kkPoCmpPo(x.poNumber) || '—') || 0) + this.calculateCurrentStock(x)));
    const rows = buildKkPoCmpDetail(code, web, this.kkPoCmp).map((r) => {
      const info = this.kkPoCmpPending?.get(`${code}|${r.po}`);
      const pxk = info?.qty || 0;
      const okWeb = okByPo.get(r.po) || 0;
      const surplus = okWeb > 0 && !r.inLinkq && !(pxk > 0) && linkqTotal != null
        && Math.abs(okWeb - (webTotalAll - linkqTotal)) <= Math.max(0.01, okWeb * 0.001);
      return { ...r, pxk, pxkLsx: lsxText(info), surplus };
    });
    // PO chỉ có trên PXK chưa xuất (không có ở web lẫn LinkQ)
    this.kkPoCmpPending?.forEach((info, key) => {
      if (!key.startsWith(code + '|')) return;
      const po = key.slice(code.length + 1) || '—';
      if (rows.some((r) => r.po === po)) return;
      rows.push({ po, web: null, webLines: 0, inLinkq: false, linkq: null, pxk: info.qty, pxkLsx: lsxText(info), surplus: false });
    });
    const sum = (arr: number[]) => Math.round(arr.reduce((a, b) => a + b, 0) * 10000) / 10000;
    const linkqKnown = rows.every((r) => !r.inLinkq || r.linkq != null);
    this.kkPoCmpDetail = {
      code,
      name: String(m.materialName || ''),
      rows,
      webTotal: sum(rows.map((r) => r.web || 0)),
      linkqTotal: linkqKnown ? sum(rows.map((r) => r.linkq || 0)) : null
    };
  }

  /** Lớp con mở "Xem toàn bộ tất cả mục". */
  protected openKkAllMucsForPoCmp(): void {}

  /** Lớp con (trang Quản lý NL) về trang 1 của bảng khi bật/tắt So sánh PO. */
  protected onKkPoCmpChanged(): void {}

  private kkPoCmpDocRef() {
    return this.firestore.firestore.collection(KK_PO_CMP_COLLECTION).doc(this.selectedFactory);
  }

  protected async loadKkPoCmp(): Promise<void> {
    const snap = await this.kkPoCmpDocRef().get();
    const d = (snap.exists ? snap.data() : null) as any;
    const pairs: string[] = Array.isArray(d?.pairs) ? d.pairs.map((x: unknown) => String(x)) : [];
    this.kkPoCmpFactory = this.selectedFactory;
    this.kkPoCmpPending = null;
    this.kkPoCmp = pairs.length ? {
      fileName: String(d?.fileName || ''),
      importedAt: this.normalizeTimestamp(d?.importedAt),
      importedBy: String(d?.importedBy || ''),
      byCode: buildKkPoCmpIndex(pairs),
      pairCount: pairs.length,
      qtyByKey: buildKkPoCmpQty(pairs, d?.qtys)
    } : null;
  }

  /** Nút So sánh PO: bật/tắt lọc; chưa có file thì mở chọn file import. */
  async toggleKkPoCompare(): Promise<void> {
    if (this.kkPoCmpOn) {
      this.kkPoCmpOn = false;
      this.onKkPoCmpChanged();
      return;
    }
    this.kkPoCmpBusy = true;
    this.cdr.detectChanges();
    try {
      if (!this.kkPoCmp || this.kkPoCmpFactory !== this.selectedFactory) await this.loadKkPoCmp();
    } catch (e: any) {
      appAlert('❌ Không đọc được file tuổi hàng đã import: ' + (e?.message || e));
    } finally {
      this.kkPoCmpBusy = false;
    }
    if (!this.kkPoCmp) {
      this.importKkPoCompare();
      return;
    }
    this.kkPoCmpOn = true;
    this.loadKkPoCmpPending();
    this.onKkPoCmpChanged();
    this.cdr.detectChanges();
  }

  importKkPoCompare(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = (ev: Event) => {
      const file = (ev.target as HTMLInputElement)?.files?.[0];
      if (file) void this.processKkPoCompareFile(file);
    };
    input.click();
  }

  /** File tuổi hàng: Mã vật tư + Số PO (+ Mã kho), dữ liệu từ dòng 7, bỏ kho NVL_KS. Lưu theo nhà máy. */
  private async processKkPoCompareFile(file: File): Promise<void> {
    this.kkPoCmpBusy = true;
    this.cdr.detectChanges();
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }) as unknown[][];
      const { pairs, qtys, skippedKs } = parseKkPoCmpSheet(rows);
      if (!pairs.length) {
        appAlert('❌ File không có dòng Mã vật tư + Số PO nào (dữ liệu bắt đầu từ dòng 7).');
        return;
      }
      const importedAt = new Date();
      await this.kkPoCmpDocRef().set({
        fileName: file.name,
        importedAt,
        importedBy: this.currentEmployeeId || '',
        pairs,
        qtys
      });
      this.kkPoCmpFactory = this.selectedFactory;
      this.kkPoCmp = {
        fileName: file.name,
        importedAt,
        importedBy: this.currentEmployeeId || '',
        byCode: buildKkPoCmpIndex(pairs),
        pairCount: pairs.length,
        qtyByKey: buildKkPoCmpQty(pairs, qtys)
      };
      this.kkPoCmpOn = true;
      this.loadKkPoCmpPending();
      if (!this.kkAllStockDetail && !this.kkMucAllDetail) this.openKkAllMucsForPoCmp();
      this.onKkPoCmpChanged();
      appAlert(`✅ Đã import ${pairs.length} cặp Mã + PO (${this.kkPoCmp.byCode.size} mã)` + (skippedKs ? ` · bỏ ${skippedKs} dòng kho NVL_KS` : '') + '.');
    } catch (e: any) {
      appAlert('❌ Không import được file tuổi hàng: ' + (e?.message || e));
    } finally {
      this.kkPoCmpBusy = false;
      this.cdr.detectChanges();
    }
  }

  protected thDocRef() {
    return this.firestore.firestore.collection('tieu-huy-check').doc(this.selectedFactory);
  }

  /** Nút TH: mở bảng chi tiết như "Xem toàn bộ tất cả các mục", chỉ các mã trong danh sách tiêu hủy + cột TH. */
  kkThMode = false;
  /** Mục Week: chỉ các dòng tồn có Week (nhập ở Inbound). */
  kkWeekMode = false;
  private thItemByCode = new Map<string, { code: string; qty: number; option: '' | 'co' | 'khong-co' | 'thieu'; actualQty: number | null }>();

  thItemOf(code: unknown): { code: string; qty: number; option: '' | 'co' | 'khong-co' | 'thieu'; actualQty: number | null } | null {
    return this.thItemByCode.get(String(code || '').trim().toUpperCase()) || null;
  }

  protected rebuildThIndex(): void {
    this.thItemByCode = new Map(this.thItems.map((x) => [x.code, x]));
  }

  /** Hệ thống đọc mã: tồn + vị trí (chỉ đọc các mã trong danh sách). */
  async loadThStock(): Promise<void> {
    if (this.thStockLoading || !this.thItems.length) return;
    this.thStockLoading = true;
    this.cdr.detectChanges();
    try {
      const [rows, lq] = await Promise.all([
        this.fetchTieuHuyStockByCodes(this.thItems.map((x) => x.code)),
        this.getLinkQPackCached(false).catch(() => null)
      ]);
      this.thLinkQ = lq?.map || new Map();
      this.thLinkQLabel = lq?.label || '';
      const map = new Map<string, { name: string; stock: number; locations: string; lines: number }>();
      const locs = new Map<string, Set<string>>();
      for (const m of rows) {
        const code = String(m.materialCode || '').trim().toUpperCase();
        const stock = this.calculateCurrentStock(m);
        if (!code || !(stock > 0)) continue;
        const cur = map.get(code) || { name: String(m.materialName || ''), stock: 0, locations: '', lines: 0 };
        cur.stock = Math.round((cur.stock + stock) * 10000) / 10000;
        cur.lines += 1;
        if (!cur.name) cur.name = String(m.materialName || '');
        map.set(code, cur);
        const set = locs.get(code) || new Set<string>();
        const loc = String(m.location || '').trim().toUpperCase();
        if (loc) set.add(loc);
        locs.set(code, set);
      }
      locs.forEach((set, code) => { const r = map.get(code); if (r) r.locations = Array.from(set).sort().join(', '); });
      this.thStock = map;
    } catch (e: any) {
      this.thError = 'Không đọc được tồn kho: ' + (e?.message || e);
    } finally {
      this.thStockLoading = false;
      this.cdr.detectChanges();
    }
  }

  importThCheck(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = (ev: Event) => {
      const file = (ev.target as HTMLInputElement)?.files?.[0];
      if (file) void this.processThCheckFile(file);
    };
    input.click();
  }

  /** File: cột A = Mã, cột B = Lượng tiêu hủy (dòng đầu là tiêu đề thì tự bỏ). Trùng mã → cộng lượng. */
  private async processThCheckFile(file: File): Promise<void> {
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, blankrows: false });
      const byCode = new Map<string, number>();
      for (const row of raw) {
        const code = this.normalizeTieuHuyCode(row?.[0]);
        if (!code || !/\d/.test(code)) continue;
        const qty = this.parseTieuHuyQty(row?.[1]) || 0;
        byCode.set(code, Math.round(((byCode.get(code) || 0) + qty) * 10000) / 10000);
      }
      if (!byCode.size) { appAlert('File không có mã nào (cột A = Mã, cột B = Lượng tiêu hủy).'); return; }
      if (this.thItems.length && !confirm(`Thay danh sách hiện tại (${this.thItems.length} mã) bằng file mới (${byCode.size} mã)?\nKết quả Tùy chọn / Lượng hàng cũ sẽ mất.`)) return;
      const by = await this.resolveLocationOperatorId().catch(() => '');
      this.thItems = Array.from(byCode.entries()).map(([code, qty]) => ({ code, qty, option: '' as const, actualQty: null }));
      this.rebuildThIndex();
      this.thMeta = { fileName: file.name, importedAt: new Date(), importedBy: String(by || '') };
      await this.thDocRef().set({
        factory: this.selectedFactory,
        fileName: file.name,
        importedAt: firebase.default.firestore.FieldValue.serverTimestamp(),
        importedBy: String(by || ''),
        items: this.thItems
      });
      this.thStock = new Map();
      await this.loadThStock();
    } catch (e: any) {
      console.error('❌ import tiêu hủy:', e);
      appAlert('❌ Không import được file: ' + (e?.message || e));
    } finally {
      this.cdr.detectChanges();
    }
  }

  async downloadThTemplate(): Promise<void> {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.aoa_to_sheet([['Mã', 'Lượng tiêu hủy'], ['B005001', 100], ['B002010', 25.5]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tieu huy');
    XLSX.writeFile(wb, `Tieu_huy_kiem_template_${this.selectedFactory}.xlsx`);
  }

  /** Sửa Tùy chọn / Lượng hàng → lưu gộp sau 0.8s (1 lượt ghi). */
  onThItemChange(): void {
    if (this.thSaveTimer) clearTimeout(this.thSaveTimer);
    this.thSaveTimer = setTimeout(() => void this.saveThItems(), 800);
  }

  private async saveThItems(): Promise<void> {
    this.thSaveTimer = null;
    try {
      await this.thDocRef().set({
        items: this.thItems.map((x) => ({ ...x, actualQty: x.actualQty == null || (x.actualQty as any) === '' ? null : Number(x.actualQty) })),
        updatedAt: firebase.default.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (e: any) {
      appAlert('❌ Không lưu được: ' + (e?.message || e));
    }
  }

  async clearThCheck(): Promise<void> {
    if (!this.thItems.length || !confirm(`Xóa danh sách tiêu hủy ${this.selectedFactory} (${this.thItems.length} mã)?`)) return;
    try {
      await this.thDocRef().delete();
      this.thItems = [];
      this.rebuildThIndex();
      this.thStock = new Map();
      this.thMeta = { fileName: '', importedAt: null, importedBy: '' };
    } catch (e: any) {
      appAlert('❌ Không xóa được: ' + (e?.message || e));
    } finally {
      this.cdr.detectChanges();
    }
  }

  thLinkQOf(code: string): number | null {
    if (!this.thLinkQ) return null;
    const v = this.thLinkQ.get(this.normalizeTieuHuyCode(code));
    return v == null ? null : v;
  }

  /** Lệch = tồn web − LinkQ (null khi chưa có LinkQ cho mã). */
  thDiffOf(code: string): number | null {
    const lq = this.thLinkQOf(code);
    if (lq == null) return null;
    return Math.round(((this.thStock.get(code)?.stock || 0) - lq) * 10000) / 10000;
  }

  get thFiltered() {
    const q = this.thQuery.trim().toUpperCase();
    return this.thItems.filter((x) => {
      if (this.thOptionFilter === 'none' ? !!x.option : (this.thOptionFilter && x.option !== this.thOptionFilter)) return false;
      if (!q) return true;
      const st = this.thStock.get(x.code);
      return x.code.includes(q) || (st?.locations || '').includes(q) || (st?.name || '').toUpperCase().includes(q);
    });
  }

  get thCounts(): { co: number; khong: number; thieu: number; none: number } {
    const c = { co: 0, khong: 0, thieu: 0, none: 0 };
    for (const x of this.thItems) {
      if (x.option === 'co') c.co++;
      else if (x.option === 'khong-co') c.khong++;
      else if (x.option === 'thieu') c.thieu++;
      else c.none++;
    }
    return c;
  }

  async exportThCheck(): Promise<void> {
    const rows = this.thFiltered;
    if (!rows.length) { appAlert('Không có dòng nào để tải.'); return; }
    const XLSX = await import('xlsx');
    const label = (v: string) => this.thOptions.find((o) => o.value === v)?.label || '';
    const data = rows.map((x, i) => {
      const st = this.thStock.get(x.code);
      return {
        'STT': i + 1,
        'Mã': x.code,
        'Tên hàng': st?.name || '',
        'Vị trí': st?.locations || '',
        'Tồn kho': st ? st.stock : 0,
        'Tồn LinkQ': this.thLinkQOf(x.code) ?? '',
        'Lệch (Web − LinkQ)': this.thDiffOf(x.code) ?? '',
        'Lượng tiêu hủy': x.qty,
        'Tùy chọn': x.option ? label(x.option) : '',
        'Lượng hàng': x.actualQty ?? ''
      };
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tieu huy');
    XLSX.writeFile(wb, `Tieu_huy_kiem_${this.selectedFactory}_${kkLogDateKey(new Date())}.xlsx`);
  }

  // ===== Bảng tồn: cột LinkQ (bật bằng nút LinkQ) — tồn LinkQ tổng mã, so với tổng tồn web của mã =====
  invLinkQOn = false;
  invLinkQLoading = false;
  invLinkQLabel = '';
  private invLinkQMap: Map<string, number> | null = null;
  private invWebByCodeMemo: { src: unknown; map: Map<string, number> } = { src: null, map: new Map() };

  async toggleInvLinkQ(): Promise<void> {
    if (this.invLinkQLoading) return;
    if (this.invLinkQOn) { this.invLinkQOn = false; this.cdr.markForCheck(); return; }
    this.invLinkQLoading = true;
    this.cdr.markForCheck();
    try {
      const pack = await this.getLinkQPackCached(false);
      this.invLinkQMap = pack.map;
      this.invLinkQLabel = pack.label;
      if (!pack.map.size) appAlert(`Chưa có file LinkQ cho ${this.selectedFactory}. Import file LinkQ ở tab Inventory Overview.`);
      this.invLinkQOn = pack.map.size > 0;
    } catch (e: any) {
      appAlert('❌ Không đọc được LinkQ: ' + (e?.message || e));
    } finally {
      this.invLinkQLoading = false;
      this.cdr.markForCheck();
    }
  }

  /** Tồn LinkQ (tổng mã) — null = mã không có trong file LinkQ. */
  invLinkQOf(code: string | null | undefined): number | null {
    if (!this.invLinkQMap) return null;
    const v = this.invLinkQMap.get(this.normalizeTieuHuyCode(code));
    return v == null ? null : v;
  }

  /** Lệch = tổng tồn web của mã (mọi dòng đang tải) − LinkQ. */
  invLinkQDiff(code: string | null | undefined): number | null {
    const lq = this.invLinkQOf(code);
    if (lq == null) return null;
    const src = this.inventoryMaterials;
    if (this.invWebByCodeMemo.src !== src) {
      const map = new Map<string, number>();
      for (const m of src || []) {
        const c = this.normalizeTieuHuyCode(m.materialCode);
        if (c) map.set(c, (map.get(c) || 0) + this.calculateCurrentStock(m));
      }
      this.invWebByCodeMemo = { src, map };
    }
    const web = this.invWebByCodeMemo.map.get(this.normalizeTieuHuyCode(code)) || 0;
    return Math.round((web - lq) * 10000) / 10000;
  }

  invLinkQTitle(code: string | null | undefined): string {
    const lq = this.invLinkQOf(code);
    if (lq == null) return 'Mã không có trong file LinkQ';
    const d = this.invLinkQDiff(code) ?? 0;
    return `LinkQ ${this.formatNumber(lq)} (tổng mã) · Web − LinkQ = ${d > 0 ? '+' : ''}${this.formatNumber(d)}` +
      (this.invLinkQLabel ? ` · ${this.invLinkQLabel}` : '');
  }

  ngOnInit(): void {
    console.log('🔍 DEBUG: ngOnInit - Starting component initialization');
    setTimeout(() => this.autoCheckKkLogArchive(), 8000);
    this.detectMobileDevice();
    // Trạng thái khóa XT ASM1 (1 doc, theo dõi trực tiếp — mở/khóa ở máy khác cũng cập nhật ngay)
    this.watchXtLock();
    // Danh sách kiểm 100% (cùng nguồn tab Inbound, có cache) → dấu ! đỏ cạnh mã hàng
    void this.sxxkSuspect.load().then(() => this.cdr.markForCheck()).catch(() => undefined);

    const factoryParam = this.route.snapshot.queryParamMap.get('factory');
    if (this.isValidFactory(factoryParam)) {
      this.selectedFactory = factoryParam;
    } else {
      // Không có ?factory= trên URL — mặc định theo nhân viên đang đăng nhập
      // (1 số NV ưu tiên ASM2, còn lại mặc định ASM1).
      firstValueFrom(this.authService.currentUser)
        .then(user => {
          this.selectedFactory = getDefaultRmFactory(user?.employeeId);
          this.subscribeMaterialsMatrix();
        })
        .catch(() => {});
    }
    this.subscribeMaterialsMatrix();
    this.authService.currentUser.pipe(takeUntil(this.destroy$)).subscribe((user: any) => {
      this.currentEmployeeId = String(user?.employeeId || '').trim().toUpperCase();
      this.applyPermissionFlags();
      this.cdr.markForCheck();
    });
    this.route.queryParamMap.pipe(takeUntil(this.destroy$)).subscribe(params => {
      const f = params.get('factory');
      if (this.isValidFactory(f) && f !== this.selectedFactory) {
        this.selectedFactory = f;
        this.onFactoryChanged();
      }
    });

    window.addEventListener('storage', this.onNvlCatalogStorage);
    this.nvlCatalogFull.changed$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      void this.adoptNewerNvlCatalog();
    });
    this.restoreKkScanOpSession();
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
        void this.syncCatalogRemoteChanges();
      });
    }, 0);

    console.log('🔍 Setting up search mechanism (search-first, no auto load)...');
    this.setupDebouncedSearch();
    this.inventoryMaterials = [];
    this.filteredInventory = [];

    // Đến từ tab khác (VD: Layout Warehouse ASM3 → "Xem chi tiết") kèm ?location=... → tự tìm theo vị trí đó.
    const locationParam = this.route.snapshot.queryParamMap.get('location');
    if (locationParam && !this.isNguyenLieuPage) {
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

    this.initKkPage();

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
    this.onKkPageFactoryChanged();
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
    this.showMatrix = false;
    this.subscribeMaterialsMatrix();

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
    this.onKkPageResize();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.skipKkTypeBoxMenuClose) return;
    this.closeKkTypeBoxMenu();
    this.closeKkMucShelfMenu();
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
    this.stopTemLeTlCamera();
    this.matrixSub?.();
    this.matrixSub = null;
    window.removeEventListener('storage', this.onNvlCatalogStorage);
    if (this.adoptNewerTimer) clearTimeout(this.adoptNewerTimer);
    this.stopScanning();
    this.stopKkLive();
    if (this.kkScanOpTimer) {
      clearTimeout(this.kkScanOpTimer);
      this.kkScanOpTimer = null;
    }
    this.destroy$.next();
    this.destroy$.complete();
    this.kkLiveStop$.complete();
    this.hidScanTimers.forEach((t) => clearTimeout(t));
    this.hidScanTimers.clear();
    this.kkHidQrQueue = [];
    this.unlockKkScanKeyboard();
    document.body.classList.remove('kk-page-lock');
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
  protected locationFromInventoryDoc(data: any): string {
    if (data && Object.prototype.hasOwnProperty.call(data, 'location')) {
      return String(data.location ?? '').trim().toUpperCase();
    }
    return String(data?.viTri ?? '').trim().toUpperCase();
  }

  protected inventoryLocationWriteFields(location: string): Record<string, unknown> {
    location = stripJ5Prefix(location);
    return { location, viTri: location };
  }

  /**
   * Nguyên tắc vị trí sau IQC:
   * - Đang IQC + Pass → PASS
   * - Chưa Pass (chờ kiểm, NG, …) giữ nguyên vị trí IQC
   */
  private applyPassIqcAutoLocation(material: {
    materialCode?: string;
    iqcStatus?: string;
    location?: string;
    modifiedBy?: string;
    locationManualOverride?: boolean;
  }): string | null {
    try {
      if (this.isManualLocationLocked(material)) return null;

      const iqc = String(material.iqcStatus || '').trim().toUpperCase();
      const locRaw = String(material.location || '').trim();
      const loc = locRaw.toUpperCase();
      const isIqcStaging = loc === 'IQC' || loc.startsWith('IQC');
      if (!isIqcStaging || iqc !== 'PASS') return null;

      material.location = 'PASS';
      return 'PASS';
    } catch {
      return null;
    }
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

        // Auto-set location: IQC + Pass → PASS. Chưa Pass giữ IQC.
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
                `✅ [ASM1 auto location] Updated ${autoLocationCount} docs (IQC+Pass→PASS).`
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
          
          // KHÔNG tự gộp + xóa dòng trên Firestore nữa (05/11/2026): gộp mã + PO làm mất lô theo IMD
          // (tem lẻ / lịch sử bịch theo IMD). Chỉ gộp hiển thị tại chỗ.
          this.consolidateInventoryData();
          this.continueAfterConsolidation();
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
      appAlert('Vui lòng nhập ít nhất một mã hàng (mỗi dòng hoặc cách bằng dấu phẩy).');
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
      appAlert(
        `✅ Đã ghi ${r.written} dòng TỒN vào rm-bag-history.\n` +
          `Bỏ qua ${r.skipped} dòng (không còn tồn bịch, không có mã, hoặc không đủ dữ liệu ước).${derivedLine}${codesLine}\n` +
          `Đợt: ${r.resetId}`
      );
    } catch (e: any) {
      console.error('[materials] snapshot TỒN:', e);
      appAlert(`❌ Lỗi: ${e?.message || String(e)}`);
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

  /** Standard Packing của dòng tồn: Standard của lô (PO) nếu có → Danh mục NVL → field cũ trên dòng tồn. */
  getEffectiveStandardPacking(material: InventoryMaterial): number {
    const lot = Number(material?.lotStandardPacking);
    if (lot > 0 && Number.isFinite(lot)) return lot;
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

  /** Số bag đúng bằng cột BAG ("20" hoặc "20+1" = 21). Dùng cho ô Tổng bag. */
  private displayedBagCount(material: InventoryMaterial): number {
    const sp = this.getEffectiveStandardPacking(material);
    const stock = this.calculateCurrentStock(material);
    if (!sp || sp <= 0) {
      const stored = Number(material.totalBags ?? 0);
      return stored > 0 && Number.isFinite(stored) ? Math.floor(stored) : 0;
    }
    if (stock <= 0) return 0;
    const fullCount = Math.floor(stock / sp);
    const partial = Math.round((stock - fullCount * sp) * 1e6) / 1e6;
    return partial <= 1e-9 ? fullCount : fullCount + 1;
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

  getXtCellText(material: InventoryMaterial): string {
    const bags = this.getXtFullBags(material);
    const le = this.getXtLeTotal(material);
    const qty = bags.length
      ? bags.reduce((s, b) => s + (Number(b.qty) || 0), 0)
      : Math.max(0, Number(material.xt || 0) - le);
    if (qty <= 0 && bags.length === 0) return 'Chọn bag';
    if (bags.length === 0) return this.formatNumber(qty);
    const nos = bags.map((b) => `#${b.bagNo}`).join(', ');
    return `${this.formatNumber(qty)} · ${nos}`;
  }

  getXtLeCellText(material: InventoryMaterial): string {
    const le = this.getXtLeTotal(material);
    if (le <= 0) return '—';
    return this.formatNumber(le);
  }

  private getXtFullBags(material: InventoryMaterial): InventoryXtBagPick[] {
    return this.normalizeXtBags(material).filter((b) => !(Number(b.leQty) > 0));
  }

  getXtLeTotal(material: InventoryMaterial | null | undefined): number {
    const fromBags = this.normalizeXtBags(material).reduce((s, b) => s + (Number(b.leQty) > 0 ? Number(b.leQty) : 0), 0);
    if (fromBags > 0) return fromBags;
    return Number(material?.xtLe || 0) || 0;
  }

  getXtRowEffectiveQty(row: InventoryBagRow): number {
    if (row.exported) return 0;
    const le = Number(row.leQty) || 0;
    if (le > 0) return le;
    if (row.selected) return Number(row.qty) || 0;
    return 0;
  }

  getXtBagTotalQty(): number {
    return this.bagPopupRows.reduce((sum, row) => sum + this.getXtRowEffectiveQty(row), 0);
  }

  getXtBagSelectedCount(): number {
    return this.bagPopupRows.filter((r) => this.getXtRowEffectiveQty(r) > 0).length;
  }

  openBagStatusPopup(material: InventoryMaterial, event?: Event): void {
    event?.stopPropagation();
    this.showXtBagPopup = false;
    this.bagPopupMaterial = material;
    this.showBagStatusPopup = true;
    void this.reloadBagPopupRows(material);
  }

  openXtBagPopup(material: InventoryMaterial, event?: Event): void {
    if (this.denyAction('xt')) return;
    event?.stopPropagation();
    if (this.isXtLockedFor(material)) {
      appAlert('🔒 XT đang khóa ở ASM1.\nMở khóa trong More → "Mở khóa XT ASM1" (mã Zalo gửi ASP0106).');
      return;
    }
    this.showBagStatusPopup = false;
    this.bagPopupMaterial = material;
    const le = this.getXtLeTotal(material);
    this.xtBagFallbackLeQty = le > 0 ? le : null;
    const full = Math.max(0, Number(material.xt || 0) - le);
    this.xtBagFallbackQty = full > 0 ? full : null;
    this.showXtBagPopup = true;
    void this.reloadBagPopupRows(material);
  }

  closeBagBagPopups(force = false): void {
    if (this.xtBagSaving && !force) return;
    this.showBagStatusPopup = false;
    this.showXtBagPopup = false;
    this.bagPopupMaterial = null;
    this.bagPopupRows = [];
    this.bagPopupError = '';
    this.xtBagFallbackQty = null;
    this.xtBagFallbackLeQty = null;
  }

  toggleXtBagRow(row: InventoryBagRow, checked: boolean): void {
    if (row.exported) return;
    row.selected = checked;
    if (checked) {
      row.leQty = null;
      if (!(Number(row.qty) > 0)) {
        row.qty = this.getBagDefaultQty(this.bagPopupMaterial!, row.bagNo, this.bagPopupRows.length);
      }
    }
  }

  onXtBagQtyChange(row: InventoryBagRow, raw: any): void {
    const n = this.parseXtQty(raw);
    row.qty = n > 0 ? n : 0;
  }

  onXtBagLeQtyChange(row: InventoryBagRow, raw: any): void {
    if (row.exported) return;
    const n = this.parseXtQty(raw);
    row.leQty = n > 0 ? n : null;
    if (Number(row.leQty) > 0) row.selected = false;
  }

  setXtBagFallbackQty(raw: any): void {
    if (raw === '' || raw === null || raw === undefined) {
      this.xtBagFallbackQty = null;
      return;
    }
    const n = this.parseXtQty(raw);
    this.xtBagFallbackQty = n > 0 ? n : null;
  }

  setXtBagFallbackLeQty(raw: any): void {
    if (raw === '' || raw === null || raw === undefined) {
      this.xtBagFallbackLeQty = null;
      return;
    }
    const n = this.parseXtQty(raw);
    this.xtBagFallbackLeQty = n > 0 ? n : null;
  }

  /** ASM2: XT giữ đúng 2 số thập phân; ASM1: 4 số lẻ. */
  private parseXtQty(raw: any): number {
    const n = parseFloat(String(raw ?? '').replace(/,/g, '').replace(/\s/g, ''));
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (this.selectedFactory !== 'ASM2') return roundRmQty(n, RM_QTY_DECIMALS_4);
    return Math.round(n * 100) / 100;
  }

  /** Ghi nhận lượng: ASM1 làm tròn 4 số lẻ, nhà máy khác 2 số lẻ (như cũ). */
  private roundQtyByFactory(n: number): number {
    return isRmQtyDecimalFactory(this.selectedFactory) ? roundRmQty(n, RM_QTY_DECIMALS_4) : Math.round(n * 100) / 100;
  }

  selectAllRemainingXtBags(): void {
    for (const row of this.bagPopupRows) {
      if (row.exported) continue;
      row.selected = true;
      row.leQty = null;
      if (!(Number(row.qty) > 0)) {
        row.qty = this.getBagDefaultQty(this.bagPopupMaterial!, row.bagNo, this.bagPopupRows.length);
      }
    }
  }

  clearXtBagSelection(): void {
    for (const row of this.bagPopupRows) {
      if (row.exported) continue;
      row.selected = false;
      row.leQty = null;
    }
  }

  async saveXtBagPopup(): Promise<void> {
    const material = this.bagPopupMaterial;
    if (!material || this.xtBagSaving) return;
    this.xtBagSaving = true;
    try {
      if (this.bagPopupRows.length === 0) {
        const full = this.parseXtQty(this.xtBagFallbackQty || 0);
        const le = this.parseXtQty(this.xtBagFallbackLeQty || 0);
        material.xtBags = [];
        material.xtLe = le > 0 ? le : 0;
        material.xt = (full > 0 ? full : 0) + (le > 0 ? le : 0);
      } else {
        const picks = this.bagPopupRows
          .filter((r) => this.getXtRowEffectiveQty(r) > 0)
          .map((r) => {
            const le = this.parseXtQty(r.leQty || 0);
            const qty = this.parseXtQty(this.getXtRowEffectiveQty(r));
            return {
              bagNo: r.bagNo,
              qty,
              ...(le > 0 ? { leQty: le } : {})
            };
          });
        material.xtBags = picks;
        material.xtLe = picks.reduce((s, p) => s + (Number(p.leQty) > 0 ? Number(p.leQty) : 0), 0);
        material.xt = picks.reduce((s, p) => s + p.qty, 0);
      }
      await this.updateXT(material);
      this.xtBagSaving = false;
      this.closeBagBagPopups(true);
    } catch (e: any) {
      this.bagPopupError = e?.message || 'Không lưu được XT bag.';
    } finally {
      this.xtBagSaving = false;
      this.cdr.markForCheck();
    }
  }

  private normalizeXtBags(material: InventoryMaterial | null | undefined): InventoryXtBagPick[] {
    const raw = material?.xtBags;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((x) => {
        const bagNo = Math.floor(Number((x as any)?.bagNo ?? 0));
        const leQty = Number((x as any)?.leQty ?? 0);
        const qty = Number((x as any)?.qty ?? 0);
        return {
          bagNo,
          qty,
          ...(leQty > 0 ? { leQty } : {})
        };
      })
      .filter((x) => x.bagNo > 0 && (x.qty > 0 || Number(x.leQty) > 0));
  }

  private getLotBagCount(material: InventoryMaterial): number {
    const sp = this.getEffectiveStandardPacking(material);
    const received = Number(material.openingStock || 0) + Number(material.quantity || 0);
    const fromInit = Math.max(0, Math.floor(Number(material.openingBagsAtInit ?? 0)));
    if (fromInit > 0) return fromInit;
    if (sp > 0 && received > 0) return Math.max(1, Math.ceil(received / sp));
    const remaining = this.computeTotalBagsFromStock(material);
    const exported = Math.max(0, Math.floor(Number(material.exportedBags ?? 0)));
    if (remaining + exported > 0) return remaining + exported;
    const stored = Math.max(0, Math.floor(Number(material.totalBags ?? 0)));
    return stored;
  }

  private getBagDefaultQty(material: InventoryMaterial, bagNo: number, total: number): number {
    const sp = this.getEffectiveStandardPacking(material);
    const received = Number(material.openingStock || 0) + Number(material.quantity || 0);
    if (sp > 0 && received > 0 && total > 0) {
      if (bagNo < total) return sp;
      const rem = Math.round((received - (total - 1) * sp) * 1e6) / 1e6;
      return rem > 1e-9 ? rem : sp;
    }
    if (sp > 0) return sp;
    return 0;
  }

  /** Chỉ lấy số bag 1–999 từ nhãn bịch (1 hoặc 1/5). Không lấy dãy số IMD. */
  private collectOutboundBagNos(data: Record<string, unknown>): number[] {
    const nos = new Set<number>();
    const addLabel = (raw: string) => {
      const s = String(raw || '').trim();
      if (!s) return;
      for (const part of s.split(',')) {
        const t = part.trim();
        if (!t) continue;
        const frac = /^(\d+)\s*\/\s*\d+/.exec(t);
        if (frac) {
          const n = parseInt(frac[1], 10);
          if (n > 0 && n <= 999) nos.add(n);
          continue;
        }
        if (/^\d{1,3}(?:\([Tt]\d+\))?$/.test(t)) {
          const n = parseInt(t, 10);
          if (n > 0 && n <= 999) nos.add(n);
        }
      }
    };
    const resolved = this.rmBagHistory.resolveControlBatchOutboundRowBagFields(data);
    addLabel(resolved.bagDisplay);
    addLabel(resolved.bichBatch);
    addLabel(String(data['bagNumberDisplay'] ?? ''));
    addLabel(String(data['bagBatch'] ?? ''));
    const p4 = this.rmBagHistory.parseQrPart4(String(data['importDate'] ?? data['batchNumber'] ?? ''));
    addLabel(p4.bagNumberDisplay);
    addLabel(p4.bagFractionLabel);
    return [...nos];
  }

  private outboundRowQty(data: Record<string, unknown>): number {
    const raw = data['exportQuantity'] ?? data['exported'] ?? data['quantity'] ?? data['amount'] ?? data['qty'] ?? 0;
    const n = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /** Lượng outbound đã phủ từng bag. Bag chỉ khóa XT khi phủ hết lượng bag. */
  private async loadOutboundCoveredQtyByBag(material: InventoryMaterial): Promise<Map<number, number>> {
    const byBag = new Map<number, number>();
    const batchKey = this.getInventoryImdBaseKey(material) || '';
    const normCode = String(material.materialCode || '').trim();
    const normPo = String(material.poNumber || '').trim();
    if (!normCode) return byBag;

    let snapshot: any;
    try {
      snapshot = await this.firestore.collection('outbound-materials').ref
        .where('factory', '==', this.selectedFactory)
        .where('materialCode', '==', normCode)
        .where('poNumber', '==', normPo)
        .get();
    } catch (e) {
      console.warn('[BAG] outbound query failed:', e);
      snapshot = null;
    }

    let unlabeled = 0;
    if (snapshot && !snapshot.empty) {
      snapshot.forEach((doc: any) => {
        const data = doc.data() as Record<string, unknown>;
        const imdKey = this.normalizeOutboundImdToKey(data);
        if (batchKey && (!imdKey || imdKey !== batchKey)) return;
        const qty = this.outboundRowQty(data);
        if (qty <= 0) return;
        const parsed = this.collectOutboundBagNos(data);
        if (!parsed.length) {
          unlabeled += qty;
          return;
        }
        const each = qty / parsed.length;
        parsed.forEach((n) => byBag.set(n, (byBag.get(n) || 0) + each));
      });
    }

    if (byBag.size === 0 && unlabeled <= 0) {
      unlabeled = Number(material.exported) || 0;
    }

    const n = this.getLotBagCount(material);
    let left = unlabeled;
    if (left > 0 && n > 0) {
      for (let i = 1; i <= n && left > 1e-9; i++) {
        const cap = this.getBagDefaultQty(material, i, n);
        const have = byBag.get(i) || 0;
        const room = Math.max(0, cap - have);
        if (room <= 1e-9) continue;
        const take = Math.min(left, room);
        byBag.set(i, have + take);
        left -= take;
      }
    }
    return byBag;
  }

  private async reloadBagPopupRows(material: InventoryMaterial): Promise<void> {
    this.bagPopupLoading = true;
    this.bagPopupError = '';
    this.bagPopupRows = [];
    this.cdr.markForCheck();
    try {
      const [covered, clState] = await Promise.all([
        this.loadOutboundCoveredQtyByBag(material),
        // Bịch CL hiện tại của IMD (tách tem lẻ) — 1 read, lỗi thì bỏ qua
        this.temLeCl.getState(this.selectedFactory, String(material.materialCode || '').trim().toUpperCase(),
          String(material.poNumber || '').trim(), this.rmBagHistory.parseQrPart4(this.getDisplayIMD(material)).imdKey || this.getDisplayIMD(material))
          .catch(() => null)
      ]);
      const clBagNo = clState?.clActive ? Number(String(clState.bagFraction || '').split('/')[0]) || 0 : 0;
      const xtMap = new Map(this.normalizeXtBags(material).map((x) => [x.bagNo, x]));
      let n = this.getLotBagCount(material);
      const seenMax = Math.max(0, ...covered.keys(), ...xtMap.keys());
      if (seenMax > n) n = seenMax;
      if (n <= 0) {
        this.bagPopupRows = [];
        return;
      }
      const rows: InventoryBagRow[] = [];
      for (let i = 1; i <= n; i++) {
        const defaultQty = this.getBagDefaultQty(material, i, n);
        const coveredQty = covered.get(i) || 0;
        const isExported = defaultQty > 0 && coveredQty + 1e-6 >= defaultQty;
        const pick = xtMap.get(i);
        const leQty = Number(pick?.leQty) > 0 ? Number(pick.leQty) : null;
        const isFullXt = !isExported && !!pick && !(leQty > 0);
        const isClBag = !isExported && clBagNo === i;
        const partial = !isExported && coveredQty > 1e-6 && coveredQty < defaultQty;
        rows.push({
          bagNo: i,
          qty: isFullXt && pick?.qty ? pick.qty : defaultQty,
          leQty,
          status: isExported ? 'exported' : (pick ? 'xt' : 'stock'),
          selected: isFullXt,
          exported: isExported,
          isLe: isClBag || partial,
          clGw: isClBag ? Number(clState?.clGw) || undefined : undefined,
          leRemain: isClBag ? Number(clState?.clQty) || 0 : (partial ? Math.round((defaultQty - coveredQty) * 10000) / 10000 : undefined)
        });
      }
      this.bagPopupRows = rows;
    } catch (e: any) {
      this.bagPopupError = e?.message || 'Không tải được danh sách bag.';
    } finally {
      this.bagPopupLoading = false;
      this.cdr.markForCheck();
    }
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
        appAlert(`✅ Đã sửa ${updateCount} batchNumber có format không đúng!`);
        
        // Refresh data
        this.loadInventoryFromFirebase();
      } else {
        console.log('ℹ️ No problematic batchNumbers found');
        appAlert('Không tìm thấy batchNumber nào cần sửa');
      }
      
    } catch (error) {
      console.error('❌ Error fixing batchNumbers:', error);
      appAlert('❌ Lỗi khi sửa batchNumbers. Vui lòng thử lại.');
    } finally {
      this.isLoading = false;
    }
  }

  private static readonly CATALOG_LOCALSTORAGE_KEY = 'materials-catalog-cache-v1';
  private static readonly CATALOG_CACHE_KEY_V2 = 'materials-catalog-cache-v2';
  private static readonly CATALOG_IDB_NAME = 'asm-materials-cache';
  private static readonly CATALOG_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 ngày
  private static readonly CATALOG_LS_MAX_CHARS = 3_200_000;
  /** Mã đã tra danh mục mà không có — bỏ qua trong phiên (tránh đọc Firestore lặp lại). */
  private static readonly catalogMissCodes = new Set<string>();

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
    const nvlTs = this.nvlCatalogFull.readCacheTimestamp();
    if (
      MaterialsComponent.sharedCatalogCache.size > 0 &&
      MaterialsComponent.sharedCatalogDateKey === today &&
      MaterialsComponent.sharedCatalogSourceTs >= nvlTs
    ) {
      this.catalogCache = MaterialsComponent.sharedCatalogCache;
      this.catalogLoaded = true;
      this.catalogLoadedDateKey = today;
      this.catalogSourceTs = MaterialsComponent.sharedCatalogSourceTs;
      this.catalogRemoteTs = MaterialsComponent.sharedCatalogRemoteTs;
      return;
    }
    const mem = this.nvlCatalogFull.peekCached();
    if (mem?.length && this.nvlCatalogFull.cacheSavedAt() >= nvlTs) {
      this.fillCatalogCacheFromNvlItems(mem);
      this.catalogLoaded = true;
      this.catalogLoadedDateKey = today;
      this.catalogSourceTs = Math.max(nvlTs, this.nvlCatalogFull.cacheSavedAt());
      this.rememberSharedCatalog();
    }
  }

  private rememberSharedCatalog(): void {
    if (!this.catalogCache.size) return;
    MaterialsComponent.sharedCatalogCache = this.catalogCache;
    MaterialsComponent.sharedCatalogDateKey = this.catalogLoadedDateKey || this.catalogTodayKey();
    MaterialsComponent.sharedCatalogSourceTs = this.catalogSourceTs;
    MaterialsComponent.sharedCatalogRemoteTs = this.catalogRemoteTs;
  }

  /** Đọc catalog từ đĩa (IndexedDB / localStorage compact) — không tốn lượt đọc Firestore. */
  private async hydrateCatalogFromDisk(): Promise<boolean> {
    const today = this.catalogTodayKey();
    if (this.catalogCache.size > 0 && this.catalogLoadedDateKey === today && !this.nvlCatalogIsNewer()) return true;
    const fromLs = this.readCatalogCacheFromLocalStorage();
    if (this.catalogPayloadIsOlderThanNvl(fromLs)) return false;
    if (this.tryApplyCatalogCachePayload(fromLs)) return true;
    const fromIdb = await this.readCatalogCacheFromIdb();
    if (this.catalogPayloadIsOlderThanNvl(fromIdb)) return false;
    return this.tryApplyCatalogCachePayload(fromIdb);
  }

  /** Danh mục NVL vừa sửa Standard Packing sau lần cache inventory này. */
  private nvlCatalogIsNewer(): boolean {
    return this.nvlCatalogFull.readCacheTimestamp() > this.catalogSourceTs;
  }

  private catalogPayloadIsOlderThanNvl(parsed: unknown): boolean {
    if (!parsed || typeof parsed !== 'object') return false;
    const ts = Number((parsed as { t?: number; timestamp?: number }).t || (parsed as { timestamp?: number }).timestamp || 0);
    if (!ts) return false;
    return this.nvlCatalogFull.readCacheTimestamp() > ts;
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
    const p = parsed as { v?: number; t?: number; timestamp?: number; d?: string; m?: number; rows?: unknown[]; items?: any[] };
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
      this.catalogSourceTs = ts;
      this.catalogRemoteTs = Number(p.m) || ts;
      this.rememberSharedCatalog();
      return true;
    }
    return false;
  }

  private buildCatalogCachePayload(): { v: number; t: number; d: string; m: number; rows: Array<[string, string, string, number, number]> } {
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
    return { v: 2, t: Date.now(), d: this.catalogTodayKey(), m: this.catalogRemoteTs, rows };
  }

  protected persistCatalogCache(): void {
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
  protected async ensureCatalogForMaterialCodes(codes: string[]): Promise<void> {
    if (this.catalogCache.size === 0) {
      await this.hydrateCatalogFromDisk();
    }
    const unique = [...new Set(codes.map(c => String(c || '').trim().toUpperCase()).filter(Boolean))];
    const missing = unique.filter(c => !this.catalogCache.has(c) && !MaterialsComponent.catalogMissCodes.has(c));
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
        if (q && !q.empty && this.ingestCatalogDoc(q.docs[0])) return;
        // Mã không có trong danh mục (hoặc thiếu tên) → không đọc lại mỗi lần đổi trang trong phiên này
        MaterialsComponent.catalogMissCodes.add(code);
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

  protected applyCatalogToMaterials(materials: InventoryMaterial[]): void {
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

  /** Nút "Cập nhật danh mục" — đọc lại Danh mục NVL ngay, áp Standard Packing lên bảng. */
  async refreshNvlCatalogNow(): Promise<void> {
    if (this.isCatalogLoading) return;
    this.closeMorePopup();
    this.catalogLoadPromise = this.loadCatalogFromFirebase(true);
    await this.catalogLoadPromise;
    this.consolidationMessage = `✅ Đã cập nhật danh mục NVL (${this.catalogCache.size} mã) — cột Standard Packing đã làm mới`;
    this.showConsolidationMessage = true;
    if (this.showKkLocMap) {
      appAlert(this.consolidationMessage);
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
    this.catalogRemoteTs = this.nvlCatalogFull.remoteSyncTs() || Date.now();
    for (const item of items) {
      this.setCatalogItemFromNvl(item);
    }
  }

  private setCatalogItemFromNvl(item: {
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

  /** Máy khác vừa sửa Danh mục NVL: chỉ tải các mã đã sửa (1 doc mốc + vài doc), không đọc lại cả collection. */
  private async syncCatalogRemoteChanges(): Promise<void> {
    if (!this.catalogCache.size) return;
    try {
      const changes = await this.nvlCatalogFull.fetchChangesSince(this.catalogRemoteTs);
      if (!changes) return;
      if (changes.reset) {
        const items = await this.nvlCatalogFull.listAll(false);
        if (!items.length) return;
        this.fillCatalogCacheFromNvlItems(items);
      } else {
        changes.deletedCodes.forEach((code) => this.catalogCache.delete(code));
        changes.items.forEach((item) => this.setCatalogItemFromNvl(item));
        this.catalogRemoteTs = changes.syncTs;
      }
      this.catalogSourceTs = Math.max(this.catalogSourceTs, this.nvlCatalogFull.readCacheTimestamp());
      this.rememberSharedCatalog();
      this.persistCatalogCache();
      this.applyCatalogToAllViews();
      this.cdr.detectChanges();
    } catch (e) {
      console.warn('syncCatalogRemoteChanges:', e);
    }
  }

  private applyCatalogToAllViews(): void {
    this.applyCatalogToMaterials(this.inventoryMaterials);
    this.kkLocMapTypeCache.forEach(list => this.applyCatalogToMaterials(list));
    this.invalidateKkTypeViewCache();
    this.updateTotalStockCount();
  }

  protected mergeNvlItemIntoCatalogCache(item: {
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
        void this.syncCatalogRemoteChanges();
        return;
      }

      if (!forceRefresh && this.catalogCache.size > 0 && this.catalogLoadedDateKey === today) {
        this.catalogLoaded = true;
        this.applyCatalogToAllViews();
        void this.syncCatalogRemoteChanges();
        return;
      }

      if (!forceRefresh && await this.hydrateCatalogFromDisk()) {
        this.catalogLoaded = true;
        this.catalogLoadedDateKey = today;
        this.applyCatalogToAllViews();
        void this.syncCatalogRemoteChanges();
        return;
      }

      const items = await this.nvlCatalogFull.listAll(forceRefresh);
      if (items.length) {
        this.fillCatalogCacheFromNvlItems(items);
        this.catalogLoaded = true;
        this.catalogLoadedDateKey = today;
        this.catalogSourceTs = this.nvlCatalogFull.readCacheTimestamp() || Date.now();
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
    return this.catalogLoaded && this.catalogLoadedDateKey === this.catalogTodayKey() && !this.nvlCatalogIsNewer();
  }

  private adoptNewerTimer: ReturnType<typeof setTimeout> | null = null;
  private adoptNewerBusy = false;

  /** Áp Standard Packing vừa sửa ở Danh mục NVL lên bảng tồn, không đọc lại cả collection. */
  private adoptNewerNvlCatalog(): void {
    // Gộp nhiều tín hiệu liên tiếp (storage event / changed$) thành 1 lần xử lý.
    if (this.adoptNewerTimer) clearTimeout(this.adoptNewerTimer);
    this.adoptNewerTimer = setTimeout(() => {
      this.adoptNewerTimer = null;
      void this.doAdoptNewerNvlCatalog();
    }, 1500);
  }

  private async doAdoptNewerNvlCatalog(): Promise<void> {
    if (this.adoptNewerBusy || !this.nvlCatalogIsNewer()) return;
    this.adoptNewerBusy = true;
    try {
      // Tab này chưa nạp danh mục đầy đủ trong service (trang Materials dùng cache riêng):
      // chỉ tải các mã vừa sửa, không đọc lại ~10.000 mã.
      if (!this.nvlCatalogFull.peekCached() && this.catalogCache.size > 0) {
        this.catalogSourceTs = this.nvlCatalogFull.readCacheTimestamp() || Date.now();
        await this.syncCatalogRemoteChanges();
        return;
      }
      const items = await this.nvlCatalogFull.listAll(false);
      if (!items.length) return;
      this.fillCatalogCacheFromNvlItems(items);
      this.catalogLoaded = true;
      this.catalogLoadedDateKey = this.catalogTodayKey();
      this.catalogSourceTs = this.nvlCatalogFull.readCacheTimestamp() || Date.now();
      this.rememberSharedCatalog();
      this.persistCatalogCache();
      this.applyCatalogToAllViews();
      this.cdr.detectChanges();
    } catch (e) {
      console.warn('adoptNewerNvlCatalog:', e);
    } finally {
      this.adoptNewerBusy = false;
    }
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
    return this.isJWarehouseToken(raw);
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
    this.searchRequestId++;
    this.searchTerm = '';
    this.searchByKk = false;
    this.showOnlyNegativeStock = false;
    this.isLoading = false;
    this.isSearching = false;
    if (this.viewWarehouseFilter) {
      void this.loadViewWarehouseInventory();
      return;
    }
    this.filteredInventory = [];
    this.inventoryMaterials = [];
    this.displayedInventory = [];
    this.currentPage = 1;
    this.totalPages = 1;
    this.updateTotalStockCount();

    // Return to initial state - no data displayed
    console.log('🧹 ASM1 Search cleared, returning to initial state (no data displayed)');
  }

  protected isKkFlagOn(value: unknown): boolean {
    if (value === true || value === 1) return true;
    const s = String(value ?? '').trim().toUpperCase();
    return s === 'TRUE' || s === '1' || s === 'YES';
  }

  protected mapKkInventoryDoc(doc: any): InventoryMaterial {
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
      kkScanCount: Math.max(0, Number(data.kkScanCount) || 0),
      kkScanQty: Math.max(0, Number(data.kkScanQty) || 0),
      week: String(data.week || '').trim(),
      weekFormat: data.weekFormat === 'MMYY' ? 'MMYY' : 'YYWW',
      kkOriginLocation: String(data.kkOriginLocation || '').trim().toUpperCase(),
      locationScannedAt: this.normalizeTimestamp(data.locationScannedAt)
    } as InventoryMaterial;
    this.stampLocationAtLoad(material);
    return material;
  }

  private docMatchesLocationSearch(data: any, normalizedLocation: string): boolean {
    const tokens = splitMultiLocations(String(data?.location ?? data?.viTri ?? ''));
    if (!tokens.length) return false;
    return tokens.some((loc) => this.locationMatchesGroup(loc, normalizedLocation));
  }

  /** Dòng có đúng vị trí đã nhập (so chữ + số, bỏ dấu - . và tiền tố WH3/ASM3). */
  private docMatchesExactLocation(data: any, normalizedLocation: string): boolean {
    const want = this.locationCompact(normalizedLocation);
    const wantBody = this.locationAlnum(normalizedLocation);
    if (!want) return false;
    const tokens = splitMultiLocations(String(data?.location ?? data?.viTri ?? ''));
    return tokens.some((loc) => {
      const c = this.locationCompact(loc);
      return c === want || (!!wantBody && this.locationAlnum(loc) === wantBody && this.isWh3SearchTerm(normalizedLocation) === isAsm3OrWh3PrefixLocation(loc));
    });
  }

  private locationCompact(loc: string): string {
    return String(loc || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /** Nhóm cố định luôn hiện trong popup lọc vị trí. */
  protected readonly knownLocationGroups = [
    'WH3', 'IQC', 'LOCKER', 'NG', 'TRA', 'E7', 'F7', 'F62', 'A12', 'Q1', 'Q2', 'Q3', 'TIEUHUY'
  ];

  /** IQC / LOCKER / NG / TRA / A12 / Q1–Q3 / kho WH3. */
  private locationSpecialGroup(loc: string): string | null {
    if (this.isTieuHuyLocation(loc)) return 'TIEUHUY';
    if (isAsm3OrWh3PrefixLocation(loc)) return 'WH3';
    if (isIqcPrefixLocation(loc)) return 'IQC';
    if (isLockerPrefixLocation(loc) || isLockerPrefixLocation(this.stripDoiKhoWhPrefix(loc))) return 'LOCKER';
    if (isBoxPrefixLocation(loc) || isBoxPrefixLocation(this.stripDoiKhoWhPrefix(loc))) return 'BOX';
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

  /** Danh sách vị trí (từng token riêng). */
  locationParts(location: string | null | undefined): string[] {
    return splitMultiLocations(String(location || ''));
  }

  /** Hiển thị 1 vị trí đầu trong cột (nhiều vị trí → hover xem thêm). */
  primaryLocationDisplay(location: string | null | undefined): string {
    const parts = this.locationParts(location).map((p) => this.displayLocationToken(p));
    return parts.length ? parts[0] : '-';
  }

  /** Số vị trí còn lại ngoài vị trí đầu (dùng badge góc ô). */
  locationExtraCount(location: string | null | undefined): number {
    return Math.max(0, this.locationParts(location).length - 1);
  }

  /** Tổng số vị trí (để badge / popup). */
  locationLocCount(location: string | null | undefined): number {
    return this.locationParts(location).length;
  }

  openInvLocListPopup(material: InventoryMaterial, event?: Event): void {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!material) return;
    this.invLocListMaterial = material;
    this.invLocListSelected = {};
    for (const loc of this.locationParts(material.location)) {
      // Mặc định tick sẵn vị trí sai / D1 / TAM / NVL…
      this.invLocListSelected[this.invLocListKey(loc)] = this.isKkDisposableLocation(loc);
    }
    this.showInvLocListPopup = true;
    this.cdr.detectChanges();
  }

  closeInvLocListPopup(): void {
    this.showInvLocListPopup = false;
    this.invLocListMaterial = null;
    this.invLocListSelected = {};
  }

  openInvShelfPicker(material: InventoryMaterial, event?: Event): void {
    if (this.denyAction('location')) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!material) return;
    this.invShelfPickMaterial = material;
    this.invShelfPickParent = null;
    this.invShelfPickQuery = '';
    this.showInvShelfPicker = true;
    this.cdr.detectChanges();
  }

  closeInvShelfPicker(): void {
    if (this.invShelfPickSaving) return;
    this.showInvShelfPicker = false;
    this.invShelfPickMaterial = null;
    this.invShelfPickParent = null;
    this.invShelfPickQuery = '';
  }

  /** Kệ mẹ: dãy R, dãy S kho mát, khu khác (HOACHAT, Frigde, Locker…). */
  get invShelfParentSections(): Array<{ title: string; parents: Array<{ id: string; hasChildren: boolean }> }> {
    const q = this.invShelfPickQuery.trim().toUpperCase();
    const match = (id: string) => !q || id.toUpperCase().includes(q);
    const jGroups = getLayoutLocationGroups('J');
    const mix = getLayoutLocationGroups('ASM1').find((g) => g.id === 'mix')?.slots || [];
    const sections = [
      {
        title: 'Dãy kệ R',
        parents: jGroups.filter((g) => /^R\d+$/.test(g.id)).map((g) => ({ id: g.id, hasChildren: true }))
      },
      {
        title: 'Dãy kệ S · Kho mát',
        parents: jGroups.filter((g) => /^S\d{2}$/.test(g.id)).map((g) => ({ id: g.id, hasChildren: true }))
      },
      {
        title: 'Khu khác',
        parents: mix.map((id) => ({ id, hasChildren: false }))
      }
    ];
    return sections
      .map((s) => ({ ...s, parents: s.parents.filter((p) => match(p.id)) }))
      .filter((s) => s.parents.length);
  }

  /** Kệ con: R05 → R05-1…R05-6; S07 → S07-1-1…S07-3-7. */
  get invShelfChildren(): string[] {
    const parent = this.invShelfPickParent;
    if (!parent) return [];
    const rack = /^R0*(\d{1,2})$/.exec(parent);
    if (rack) {
      return Array.from({ length: 6 }, (_, i) => formatJRackBlock(Number(rack[1]), i + 1));
    }
    if (/^S\d{2}$/.test(parent)) {
      return getLayoutLocationGroups('J').find((g) => g.id === parent)?.slots || [];
    }
    return [];
  }

  isInvShelfCurrent(token: string): boolean {
    const m = this.invShelfPickMaterial;
    if (!m) return false;
    return this.locationParts(m.location).some(
      (t) => this.kkScanLocationsEqual(t, token) || String(t).trim().toUpperCase() === token.toUpperCase()
    );
  }

  pickInvShelfParent(parent: { id: string; hasChildren: boolean }): void {
    if (parent.hasChildren) {
      this.invShelfPickParent = parent.id;
      this.cdr.detectChanges();
      return;
    }
    void this.applyInvShelfPick(parent.id);
  }

  backInvShelfParent(): void {
    this.invShelfPickParent = null;
    this.cdr.detectChanges();
  }

  async applyInvShelfPick(token: string): Promise<void> {
    const m = this.invShelfPickMaterial;
    if (!m?.id || this.invShelfPickSaving) return;
    if (!this.canEditInvLocation()) {
      appAlert('Cần quyền sửa vị trí.');
      return;
    }
    this.invShelfPickSaving = true;
    this.cdr.detectChanges();
    try {
      await this.applyInvLocListParts(m, [token]);
    } finally {
      this.invShelfPickSaving = false;
    }
    this.closeInvShelfPicker();
    this.cdr.detectChanges();
  }

  /** Từ popup chọn kệ → mở danh sách vị trí hiện tại (xem / xóa). */
  openInvLocListFromShelfPicker(): void {
    const m = this.invShelfPickMaterial;
    this.closeInvShelfPicker();
    if (m) this.openInvLocListPopup(m);
  }

  /** Key ổn định cho tick chọn trong popup. */
  invLocListKey(loc: string): string {
    return String(loc || '').trim().toUpperCase();
  }

  /** Vị trí nên xóa: kho D1, TAM, NVLA/NVLH…, S01 trần, không phải S/R-… / Locker / Box. */
  isKkDisposableLocation(loc: string): boolean {
    if (!this.isKkPersistentLocation(loc)) return true;
    return false;
  }

  /** Nhãn gợi ý vì sao vị trí bị tick (D1 / TAM / NVL…). */
  invLocDisposableReason(loc: string): string {
    const raw = String(loc || '').trim();
    if (!raw) return '';
    const bare = (this.stripDoiKhoWhPrefix(raw) || raw).trim().toUpperCase();
    const c = this.locationCompact(bare);
    if (c === 'TAM' || c.startsWith('TAM')) return 'TAM';
    if (/^NVL[A-Z]?\d*/.test(c) || c.startsWith('NVLA') || c.startsWith('NVLH') || c.startsWith('NVL')) {
      return 'NVL cũ';
    }
    if (this.kkWarehouseFromLocationLegacy(raw) === 'D1' || this.kkWarehouseFromLocationLegacy(bare) === 'D1') {
      // S/R-… kho J không vào đây (persistent). Token D1 còn lại.
      if (!this.isKkPersistentLocation(raw)) return 'Kho D1';
    }
    if (!this.isKkPersistentLocation(raw)) return 'Vị trí sai';
    return '';
  }

  get invLocListSelectedCount(): number {
    return Object.keys(this.invLocListSelected).filter((k) => this.invLocListSelected[k]).length;
  }

  toggleInvLocListSelect(loc: string, on: boolean): void {
    const key = this.invLocListKey(loc);
    this.invLocListSelected = { ...this.invLocListSelected, [key]: !!on };
  }

  selectDisposableInvLocs(on: boolean): void {
    const m = this.invLocListMaterial;
    if (!m) return;
    const next = { ...this.invLocListSelected };
    for (const loc of this.locationParts(m.location)) {
      if (this.isKkDisposableLocation(loc)) {
        next[this.invLocListKey(loc)] = !!on;
      }
    }
    this.invLocListSelected = next;
  }

  /** Có quyền sửa/xóa vị trí từ cột Vị trí (popup). */
  canEditInvLocation(): boolean {
    return !!(this.canEdit || this.isLocationColumnUnlocked || this.TEMP_UNLOCK_LOCATION_WH_PALLET);
  }

  /** Từ popup danh sách → mở chỉnh sửa sơ đồ kho. */
  editInvLocFromListPopup(): void {
    const m = this.invLocListMaterial;
    this.closeInvLocListPopup();
    if (m) this.openLayoutLocPicker(m, undefined, 'location');
  }

  /** Xóa một vị trí trong popup danh sách. */
  async removeInvLocFromList(loc: string, event?: Event): Promise<void> {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const m = this.invLocListMaterial;
    if (!m?.id || !this.canEditInvLocation()) return;
    const label = this.displayLocationToken(loc);
    if (!confirm(`Xóa vị trí «${label}»?`)) return;
    await this.applyInvLocListParts(
      m,
      this.locationParts(m.location).filter((t) => {
        const same =
          this.kkScanLocationsEqual(t, loc)
          || String(t).trim().toUpperCase() === String(loc).trim().toUpperCase();
        return !same;
      })
    );
    delete this.invLocListSelected[this.invLocListKey(loc)];
    this.invLocListSelected = { ...this.invLocListSelected };
  }

  /** Xóa các vị trí đang tick trong popup. */
  async removeSelectedInvLocsFromList(event?: Event): Promise<void> {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const m = this.invLocListMaterial;
    if (!m?.id || !this.canEditInvLocation()) return;
    const parts = this.locationParts(m.location);
    const selected = parts.filter((t) => this.invLocListSelected[this.invLocListKey(t)]);
    if (!selected.length) {
      appAlert('Tick ít nhất một vị trí để xóa.');
      return;
    }
    const labels = selected.map((t) => this.displayLocationToken(t)).join(', ');
    if (!confirm(`Xóa ${selected.length} vị trí đã chọn?\n${labels}`)) return;
    const keep = parts.filter((t) => !this.invLocListSelected[this.invLocListKey(t)]);
    await this.applyInvLocListParts(m, keep);
    this.invLocListSelected = {};
    for (const loc of this.locationParts(m.location)) {
      this.invLocListSelected[this.invLocListKey(loc)] = this.isKkDisposableLocation(loc);
    }
  }

  /** Xóa hàng loạt vị trí sai: D1, TAM, NVL…, S01 trần, không phải S/R-… / Locker / Box. */
  async removeWrongInvLocsFromList(event?: Event): Promise<void> {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const m = this.invLocListMaterial;
    if (!m?.id || !this.canEditInvLocation()) return;
    const parts = this.locationParts(m.location);
    const wrong = parts.filter((t) => this.isKkDisposableLocation(t));
    if (!wrong.length) {
      appAlert('Không có vị trí sai để xóa.\n(Giữ lại: Locker/Box và S/R dạng S03-3-4, R10-1…)');
      return;
    }
    const labels = wrong.map((t) => this.displayLocationToken(t)).join(', ');
    if (!confirm(`Xóa ${wrong.length} vị trí sai?\n${labels}`)) return;
    await this.applyInvLocListParts(
      m,
      parts.filter((t) => !this.isKkDisposableLocation(t))
    );
    this.invLocListSelected = {};
    for (const loc of this.locationParts(m.location)) {
      this.invLocListSelected[this.invLocListKey(loc)] = this.isKkDisposableLocation(loc);
    }
  }

  private async applyInvLocListParts(m: InventoryMaterial, nextParts: string[]): Promise<void> {
    this.rememberLocationBeforeEdit(m);
    m.location = this.normalizeMultiLocationValue(joinMultiLocations(nextParts));
    const ok = await this.persistLocationChange(m, {
      silent: true,
      bypassUnlock: true,
      allowEmpty: true
    });
    if (ok) {
      this.patchKkInvSnapCache(m.id, {
        location: m.location,
        viTri: m.location,
        locationManualOverride: true
      });
      this.kkLocMapTypeCache.forEach((list) => {
        list.forEach((x) => {
          if (x.id === m.id) x.location = m.location;
        });
      });
    } else {
      appAlert('Không lưu được. Thử lại hoặc kiểm tra quyền sửa vị trí.');
    }
    this.cdr.detectChanges();
  }

  // ── Dọn vị trí sai hàng loạt (toàn factory) ───────────────────────────────

  openBulkDisposableLocPicker(): void {
    if (!this.canEditInvLocation()) {
      appAlert('Cần quyền sửa vị trí để dọn hàng loạt.');
      return;
    }
    this.showBulkDisposableLocPicker = true;
    this.bulkDisposableLocQuery = '';
    void this.scanBulkDisposableLocations();
  }

  closeBulkDisposableLocPicker(): void {
    if (this.bulkDisposableLocBusy) return;
    this.showBulkDisposableLocPicker = false;
    this.bulkDisposableLocQuery = '';
    this.bulkDisposableLocSelected = {};
    this.bulkDisposableLocRows = [];
    this.bulkDisposableLocMaterialMap.clear();
  }

  get bulkDisposableLocFilteredRows(): typeof this.bulkDisposableLocRows {
    const q = String(this.bulkDisposableLocQuery || '').trim().toUpperCase();
    if (!q) return this.bulkDisposableLocRows;
    return this.bulkDisposableLocRows.filter(
      (r) => r.key.includes(q) || r.display.toUpperCase().includes(q) || r.reason.toUpperCase().includes(q)
    );
  }

  get bulkDisposableLocSelectedCount(): number {
    return Object.keys(this.bulkDisposableLocSelected).filter((k) => this.bulkDisposableLocSelected[k]).length;
  }

  toggleBulkDisposableLoc(key: string, on: boolean): void {
    this.bulkDisposableLocSelected = { ...this.bulkDisposableLocSelected, [key]: !!on };
  }

  selectAllBulkDisposableLocs(on: boolean): void {
    const next = { ...this.bulkDisposableLocSelected };
    for (const r of this.bulkDisposableLocFilteredRows) next[r.key] = !!on;
    this.bulkDisposableLocSelected = next;
  }

  async scanBulkDisposableLocations(): Promise<void> {
    this.bulkDisposableLocBusy = true;
    this.bulkDisposableLocRows = [];
    this.bulkDisposableLocSelected = {};
    this.bulkDisposableLocMaterialMap.clear();
    this.cdr.markForCheck();
    try {
      const snap = await this.firestore.collection('inventory-materials', (ref) =>
        ref.where('factory', '==', this.selectedFactory)
      ).get().toPromise();
      this.readTracker.track('materials', 'inventory-materials', snap?.docs?.length || 0);

      const tokenToIds = new Map<string, Set<string>>();
      const tokenMeta = new Map<string, { display: string; reason: string }>();

      for (const doc of snap?.docs || []) {
        const data = doc.data() as any;
        const location = this.locationFromInventoryDoc(data);
        const parts = this.locationParts(location).filter((t) => this.isKkDisposableLocation(t));
        if (!parts.length) continue;
        const id = doc.id;
        this.bulkDisposableLocMaterialMap.set(id, {
          id,
          materialCode: String(data.materialCode || '').trim().toUpperCase(),
          poNumber: String(data.poNumber || '').trim().toUpperCase(),
          location: String(location || '')
        });
        for (const loc of parts) {
          const key = this.invLocListKey(loc);
          if (!tokenToIds.has(key)) tokenToIds.set(key, new Set());
          tokenToIds.get(key)!.add(id);
          if (!tokenMeta.has(key)) {
            tokenMeta.set(key, {
              display: this.displayLocationToken(loc),
              reason: this.invLocDisposableReason(loc) || 'Vị trí sai'
            });
          }
        }
      }

      this.bulkDisposableLocRows = Array.from(tokenToIds.entries())
        .map(([key, ids]) => ({
          key,
          display: tokenMeta.get(key)?.display || key,
          reason: tokenMeta.get(key)?.reason || 'Vị trí sai',
          materialCount: ids.size
        }))
        .sort((a, b) =>
          b.materialCount - a.materialCount
          || a.key.localeCompare(b.key, 'en', { numeric: true })
        );

      // Tick sẵn tất cả
      const sel: Record<string, boolean> = {};
      for (const r of this.bulkDisposableLocRows) sel[r.key] = true;
      this.bulkDisposableLocSelected = sel;
    } catch (e) {
      console.error('[Dọn vị trí sai] scan failed', e);
      appAlert('Không quét được inventory. Thử lại.');
    } finally {
      this.bulkDisposableLocBusy = false;
      this.cdr.detectChanges();
    }
  }

  async applyBulkDisposableLocDelete(): Promise<void> {
    if (!this.canEditInvLocation() || this.bulkDisposableLocBusy) return;
    const selectedKeys = new Set(
      Object.keys(this.bulkDisposableLocSelected).filter((k) => this.bulkDisposableLocSelected[k])
    );
    if (!selectedKeys.size) {
      appAlert('Tick ít nhất một vị trí để xóa hàng loạt.');
      return;
    }
    const affected = Array.from(this.bulkDisposableLocMaterialMap.values()).filter((m) =>
      this.locationParts(m.location).some((t) => selectedKeys.has(this.invLocListKey(t)))
    );
    if (!affected.length) {
      appAlert('Khong co dong nao chua vi tri da chon.');
      return;
    }
    const tokenLabels = this.bulkDisposableLocRows
      .filter((r) => selectedKeys.has(r.key))
      .map((r) => r.display)
      .join(', ');
    if (!confirm(
      `Xóa ${selectedKeys.size} vị trí khỏi ${affected.length} dòng inventory?\n\n${tokenLabels}`
    )) return;

    this.bulkDisposableLocBusy = true;
    this.cdr.markForCheck();
    const operator = (await this.resolveLocationOperatorId()) || 'bulk-loc-clean';
    let okCount = 0;
    let errCount = 0;
    const CHUNK = 400;
    try {
      for (let i = 0; i < affected.length; i += CHUNK) {
        const chunk = affected.slice(i, i + CHUNK);
        const batch = this.firestore.firestore.batch();
        const localPatches: Array<{ id: string; fromLocation: string; location: string; materialCode: string; poNumber: string }> = [];
        for (const row of chunk) {
          const fromLocation = this.normalizeMultiLocationValue(String(row.location || ''));
          const parts = this.locationParts(row.location);
          const nextParts = parts.filter((t) => !selectedKeys.has(this.invLocListKey(t)));
          const nextLoc = this.normalizeMultiLocationValue(joinMultiLocations(nextParts));
          if (nextLoc === fromLocation) continue;
          const ref = this.firestore.collection('inventory-materials').doc(row.id).ref;
          batch.update(ref, {
            ...this.inventoryLocationWriteFields(nextLoc),
            updatedAt: new Date(),
            lastModified: firebase.default.firestore.FieldValue.serverTimestamp(),
            modifiedBy: operator,
            locationManualOverride: true
          });
          localPatches.push({
            id: row.id,
            fromLocation,
            location: nextLoc,
            materialCode: row.materialCode,
            poNumber: row.poNumber
          });
          row.location = nextLoc;
        }
        if (!localPatches.length) continue;
        await batch.commit();
        okCount += localPatches.length;

        for (const p of localPatches) {
          try {
            await this.firestore.collection('material-location-history').add({
              factory: this.selectedFactory,
              materialId: p.id,
              materialCode: p.materialCode || '',
              poNumber: p.poNumber || '',
              fromLocation: p.fromLocation,
              toLocation: p.location,
              changedBy: operator,
              changeType: 'bulk-disposable-loc-clean',
              changedAt: firebase.default.firestore.FieldValue.serverTimestamp()
            });
          } catch { /* ignore history errors */ }

          const inv = this.inventoryMaterials.find((m) => m.id === p.id);
          if (inv) {
            inv.location = p.location;
            this.stampLocationAtLoad(inv);
          }
          this.patchKkInvSnapCache(p.id, {
            location: p.location,
            viTri: p.location,
            locationManualOverride: true
          });
          this.kkLocMapTypeCache.forEach((list) => {
            list.forEach((x) => {
              if (x.id === p.id) x.location = p.location;
            });
          });
          const mapRow = this.bulkDisposableLocMaterialMap.get(p.id);
          if (mapRow) mapRow.location = p.location;
        }
      }
      appAlert(`✅ Đã xóa vị trí sai trên ${okCount} dòng.${errCount ? `\n⚠ Lỗi: ${errCount}` : ''}`);
      await this.scanBulkDisposableLocations();
    } catch (e) {
      console.error('[Dọn vị trí sai] apply failed', e);
      appAlert('Lỗi khi xóa hàng loạt. Một phần có thể đã lưu — quét lại danh sách.');
      await this.scanBulkDisposableLocations();
    } finally {
      this.bulkDisposableLocBusy = false;
      this.cdr.detectChanges();
    }
  }

  /** Locker/BOX/TRA: hiện tên gốc, không kèm J5-/J-. */
  displayLocationTokenPublic(loc: string): string {
    return this.displayLocationToken(loc);
  }

  protected displayLocationToken(loc: string): string {
    const raw = String(loc || '').trim();
    const bare = this.stripDoiKhoWhPrefix(raw);
    if (this.isLockerOrBoxToken(bare) || this.isTraLocationToken(bare) || this.isTraLocationToken(raw)) {
      return (bare || raw).toUpperCase();
    }
    if (parseJRackLocation(raw) || parseJRackLocation(bare)) {
      return normalizeJRackLocation(bare || raw);
    }
    if (/^(J5|J)-/i.test(raw)) return (bare || raw).toUpperCase();
    return raw;
  }

  /** Chuẩn hóa trước khi lưu: UPPER từng token, nối bằng xuống dòng. */
  protected normalizeMultiLocationValue(raw: string): string {
    return joinMultiLocations(
      splitMultiLocations(stripJ5Prefix(raw)).map((t) => {
        const token = String(t || '').trim().toUpperCase();
        if (!token) return '';
        const bare = this.stripDoiKhoWhPrefix(token);
        if (this.isLockerOrBoxToken(bare) || this.isTraLocationToken(bare)) return bare.toUpperCase();
        if (parseJRackLocation(token) || parseJRackLocation(bare)) return normalizeJRackLocation(bare || token);
        return token;
      }).filter(Boolean)
    );
  }

  // Perform search — mã hàng hoặc vị trí (tick Location)
  protected async performSearch(searchTerm: string): Promise<void> {
    const requestId = ++this.searchRequestId;
    const stillCurrent = () => requestId === this.searchRequestId;

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
      this.displayedInventory = [];
      this.currentPage = 1;
      this.totalPages = 1;
      this.isLoading = false;
      this.isSearching = false;
      this.updateTotalStockCount();
      return;
    }

    const minSearchLen = this.isNguyenLieuPage ? 4 : 3;
    if (!this.isLocationSearchActive && searchTerm.length < minSearchLen) {
      this.filteredInventory = [];
      this.displayedInventory = [];
      this.currentPage = 1;
      this.totalPages = 1;
      this.isLoading = false;
      this.isSearching = false;
      this.updateTotalStockCount();
      console.log(`⏰ ASM1 Search term "${searchTerm}" quá ngắn (cần ít nhất ${minSearchLen} ký tự)`);
      return;
    }

    if (this.isLocationSearchActive && searchTerm.trim().length < 1) {
      this.filteredInventory = [];
      this.displayedInventory = [];
      this.currentPage = 1;
      this.totalPages = 1;
      this.isLoading = false;
      this.isSearching = false;
      this.updateTotalStockCount();
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
        const exact: any[] = [];
        for (const snap of snaps) {
          for (const doc of snap?.docs || []) {
            if (seen.has(doc.id)) continue;
            if (!this.docMatchesLocationSearch(doc.data(), normalizedLocation)) continue;
            seen.add(doc.id);
            filtered.push(doc);
            if (this.docMatchesExactLocation(doc.data(), normalizedLocation)) exact.push(doc);
          }
        }
        // Có dòng đúng y vị trí đã nhập → chỉ hiện vị trí đó; không có (VD gõ nhóm "D12", "IQC") → hiện cả nhóm
        const picked = exact.length ? exact : filtered;
        querySnapshot = { docs: picked, empty: picked.length === 0 } as any;
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

      if (!stillCurrent()) return;

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
                `✅ [ASM1 search auto location] Updated ${searchLocWrites} doc(s) (IQC+Pass→PASS).`
              )
            )
            .catch(err => console.warn('⚠️ [ASM1 search auto location] Batch update failed:', err));
        }

        this.readTracker.track('materials', 'inventory-materials', querySnapshot.docs.length);
        this.applyCatalogToMaterials(this.inventoryMaterials);
        await this.ensureCatalogForMaterialCodes(this.inventoryMaterials.map((m) => m.materialCode));
        if (!stillCurrent()) return;
        this.applyCatalogToMaterials(this.inventoryMaterials);

        // IMPROVED: Không cần filter thêm nữa vì đã query chính xác từ Firebase
        this.filteredInventory = this.viewWarehouseFilter
          ? this.inventoryMaterials.filter((m) => this.materialMatchesViewWarehouse(m))
          : [...this.inventoryMaterials];
        void this.applyStorageUnitsFromCatalog();
        if (this.showKhColumn) void this.applyNvlkhFromCatalog();
        
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
        this.displayedInventory = [];
        this.currentPage = 1;
        this.updatePagination();
        this.updateTotalStockCount();
        console.log(`🔍 ASM1 No results found for: "${searchTerm}" after trying all search methods`);
      }
      
    } catch (error) {
      console.error('❌ ASM1 Error during search:', error);
      if (!stillCurrent()) return;
      this.filteredInventory = [];
      this.displayedInventory = [];
      this.updatePagination();
      this.updateTotalStockCount();
    } finally {
      if (!stillCurrent()) return;
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
  protected compareMaterialCodesFIFO(codeA: string, codeB: string): number {
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
    if (!this.filteredInventory || this.filteredInventory.length === 0) {
      this.updateNegativeStockCount();
      return;
    }
    
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

  protected async refreshLastStatusForMaterials(materials: InventoryMaterial[]): Promise<void> {
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

  // Check if location is IQC
  isIQCLocation(location: string): boolean {
    return isIqcPrefixLocation(location);
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
        baseMaterial.xtLe = materials.reduce((sum, m) => sum + (m.xtLe || 0), 0);
        
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
        
        // Quyền tab + Matrix quyền (edit / export / delete)
        this.tabCanAccess = canAccess;
        this.applyPermissionFlags();
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
          appAlert(validation.message);
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
          appAlert(`❌ Lỗi import: ${error}`);
        }
      };
      
      input.click();
      
    } catch (error) {
      console.error('Error setting up file input:', error);
      appAlert('Có lỗi xảy ra khi mở file picker');
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

    appAlert(message);

    // Show detailed errors if any
    if (result.errors.length > 0) {
      console.warn('Import errors:', result.errors);
      
      const errorMessage = result.errors.length <= 10 
        ? `Chi tiết lỗi:\n${result.errors.join('\n')}`
        : `Có ${result.errors.length} lỗi. Xem console để biết chi tiết.\n\nLỗi đầu tiên:\n${result.errors.slice(0, 5).join('\n')}`;
      
      appAlert(`⚠️ ${errorMessage}`);
    }
  }

  openMorePopup(): void {
    this.showMorePopup = true;
  }

  openKkLocMapFromMore(): void {
    this.closeMorePopup();
    void this.router.navigate(['/quan-ly-nguyen-lieu'], {
      queryParams: { factory: this.selectedFactory }
    });
  }

  stopKkLive(): void {
    this.kkLiveStop$.next();
    this.kkLiveActive = false;
    this.kkLiveLoading = false;
    this.kkLiveError = '';
    this.kkLiveRows = [];
  }

  /** "ASP0106 · Tuấn Anh" — chưa tra được tên thì chỉ hiện mã. */
  kkEmployeeLabel(id: string): string {
    const code = String(id || '').trim().toUpperCase();
    if (!/^ASP\d+$/.test(code)) return code || '—';
    const name = this.kkEmployeeShortName(code);
    return name ? `${code} · ${name}` : code;
  }

  private static readonly KK_EMP_NAME_KEY = 'kk-emp-names-v1';
  private kkEmpNames: Map<string, string> | null = null;
  private kkEmpNameQueue = new Set<string>();
  private kkEmpNameTimer: any = null;

  /** Tên sửa tay (kk-employee-names/{ASPxxxx}.name) — ưu tiên hơn tên tài khoản. */
  private kkEmpNameOverrides: Map<string, string> | null = null;
  private kkEmpNameOverridesLoading = false;

  private ensureKkEmpNameOverrides(): void {
    if (this.kkEmpNameOverrides || this.kkEmpNameOverridesLoading) return;
    this.kkEmpNameOverridesLoading = true;
    this.firestore.firestore.collection('kk-employee-names').get()
      .then((snap) => {
        const map = new Map<string, string>();
        snap.docs.forEach((d) => {
          const name = String((d.data() as any)?.name || '').trim();
          if (name) map.set(d.id.toUpperCase(), name);
        });
        this.kkEmpNameOverrides = map;
        this.cdr.detectChanges();
      })
      .catch(() => { this.kkEmpNameOverrides = new Map(); })
      .finally(() => { this.kkEmpNameOverridesLoading = false; });
  }

  /** Sửa tên hiển thị của 1 mã nhân viên (dùng ở cột Thời gian KK, Báo cáo KK…). */
  async editKkEmployeeName(id: string, event?: Event): Promise<void> {
    event?.stopPropagation();
    const code = String(id || '').trim().toUpperCase();
    if (!/^ASP\d+$/.test(code) || !this.canEdit) return;
    const cur = this.kkEmployeeShortName(code);
    const raw = window.prompt(`Tên hiển thị cho ${code} (để trống = dùng tên tài khoản):`, cur);
    if (raw == null) return;
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, 40);
    try {
      const ref = this.firestore.firestore.collection('kk-employee-names').doc(code);
      if (name) {
        await ref.set({ name, updatedBy: await this.getMaterialsOtpRequester(), updatedAt: firebase.default.firestore.FieldValue.serverTimestamp() });
        (this.kkEmpNameOverrides ||= new Map()).set(code, name);
      } else {
        await ref.delete();
        this.kkEmpNameOverrides?.delete(code);
      }
      this.cdr.detectChanges();
    } catch (e) {
      console.error('editKkEmployeeName:', e);
      appAlert('❌ Không lưu được tên.');
    }
  }

  protected kkEmployeeShortName(id: string): string {
    if (!id) return '';
    this.ensureKkEmpNameOverrides();
    const manual = this.kkEmpNameOverrides?.get(id);
    if (manual) return manual;
    if (!this.kkEmpNames) {
      this.kkEmpNames = new Map();
      try {
        const raw = JSON.parse(localStorage.getItem(MaterialsComponent.KK_EMP_NAME_KEY) || '{}');
        Object.keys(raw || {}).forEach((k) => this.kkEmpNames!.set(k, String(raw[k] || '')));
      } catch {
        /* bỏ qua cache hỏng */
      }
    }
    if (this.kkEmpNames.has(id)) return this.kkEmpNames.get(id) || '';
    if (!this.kkEmpNameQueue.has(id)) {
      this.kkEmpNameQueue.add(id);
      if (!this.kkEmpNameTimer) this.kkEmpNameTimer = setTimeout(() => void this.flushKkEmployeeNames(), 50);
    }
    return '';
  }

  private async flushKkEmployeeNames(): Promise<void> {
    this.kkEmpNameTimer = null;
    const ids = Array.from(this.kkEmpNameQueue);
    this.kkEmpNameQueue.clear();
    if (!ids.length || !this.kkEmpNames) return;
    const shortOf = (full: string): string => {
      const words = String(full || '').trim().split(/\s+/).filter(Boolean);
      if (!words.length || /^ASP\d+$/i.test(words[0])) return '';
      return words.slice(-2).join(' ');
    };
    try {
      for (let i = 0; i < ids.length; i += 30) {
        const chunk = ids.slice(i, i + 30);
        const snap = await this.firestore.firestore.collection('users').where('employeeId', 'in', chunk).get();
        const found = new Map<string, string>();
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          const id = String(data.employeeId || '').trim().toUpperCase();
          const name = shortOf(data.displayName || data.fullName || '');
          if (id && name) found.set(id, name);
        });
        chunk.forEach((id) => this.kkEmpNames!.set(id, found.get(id) || ''));
      }
      const obj: Record<string, string> = {};
      this.kkEmpNames.forEach((v, k) => { if (v) obj[k] = v; });
      try {
        localStorage.setItem(MaterialsComponent.KK_EMP_NAME_KEY, JSON.stringify(obj));
      } catch {
        /* localStorage đầy */
      }
    } catch (e) {
      console.warn('flushKkEmployeeNames:', e);
      ids.forEach((id) => this.kkEmpNames!.set(id, ''));
    }
    this.cdr.detectChanges();
  }

  get kkIdReportTotalIds(): number {
    return this.kkIdReportRows.length;
  }

  get kkIdReportTotalCodes(): number {
    const s = new Set<string>();
    for (const row of this.kkIdReportRows) {
      for (const c of row.codes) s.add(c);
    }
    return s.size;
  }

  get kkIdReportTotalTicks(): number {
    return this.kkIdReportRows.reduce((n, r) => n + r.tickCount, 0);
  }

  closeKkIdReport(): void {
    this.showKkIdReport = false;
    this.kkIdReportExpandedId = null;
  }

  setKkIdReportMode(mode: 'day' | 'range'): void {
    this.kkIdReportMode = mode;
    if (mode === 'day') {
      this.kkIdReportEnd = this.kkIdReportStart;
    }
  }

  toggleKkIdReportId(id: string): void {
    this.kkIdReportExpandedId = this.kkIdReportExpandedId === id ? null : id;
  }

  async loadKkIdReport(): Promise<void> {
    if (this.kkIdReportLoading) return;
    let start = String(this.kkIdReportStart || '').trim();
    let end = this.kkIdReportMode === 'range'
      ? String(this.kkIdReportEnd || '').trim()
      : start;
    if (!start) {
      this.kkIdReportError = 'Chọn ngày bắt đầu.';
      return;
    }
    if (!end) end = start;
    if (end < start) {
      const t = start;
      start = end;
      end = t;
      this.kkIdReportStart = start;
      this.kkIdReportEnd = end;
    }
    const dateKeys = this.listDateKeysInclusive(start, end);
    if (dateKeys.length > 62) {
      this.kkIdReportError = 'Khoảng thời gian tối đa 62 ngày.';
      return;
    }

    this.kkIdReportLoading = true;
    this.kkIdReportError = '';
    this.kkIdReportExpandedId = null;
    this.cdr.detectChanges();
    try {
      const factory = this.selectedFactory;
      const events: Array<{ id: string; code: string; at: Date }> = [];
      let reads = 0;
      for (const dateKey of dateKeys) {
        const snap = await this.firestore
          .collection('inventory-kk-history', (ref) =>
            ref.where('factory', '==', factory).where('checkedDateKey', '==', dateKey).limit(10000)
          )
          .get()
          .toPromise();
        reads += snap?.docs?.length || 0;
        for (const doc of snap?.docs || []) {
          const data = doc.data() as any;
          const code = String(data?.materialCode || '').trim().toUpperCase();
          if (!code) continue;
          const at = this.normalizeTimestamp(data?.checkedAt) || this.normalizeTimestamp(data?.createdAt) || new Date(0);
          events.push({
            id: String(data?.checkedBy || '').trim().toUpperCase() || '(không ID)',
            code,
            at
          });
        }
      }

      if (!events.length) {
        const docs = await this.loadKkDocsForFactory(factory);
        reads += docs.length;
        const startKey = dateKeys[0];
        const endKey = dateKeys[dateKeys.length - 1];
        for (const doc of docs) {
          const data = doc.data ? doc.data() : doc;
          if (data?.kkChecked !== true) continue;
          const at = this.normalizeTimestamp(data.kkAt);
          const key = this.toDateKey(at);
          if (!key || key < startKey || key > endKey) continue;
          const code = String(data.materialCode || '').trim().toUpperCase();
          if (!code) continue;
          events.push({
            id: String(data.kkBy || '').trim().toUpperCase() || '(không ID)',
            code,
            at: at || new Date(0)
          });
        }
      }

      this.readTracker.track('materials', 'inventory-kk-history', reads);
      this.kkIdReportRows = this.aggregateKkIdReport(events);
      if (!this.kkIdReportRows.length) {
        this.kkIdReportError = `Không có tick KK ${factory} từ ${start}${start !== end ? ' → ' + end : ''}.`;
      }
    } catch (e) {
      console.error('❌ KK Report:', e);
      this.kkIdReportError = 'Không đọc được lịch sử KK.';
      this.kkIdReportRows = [];
    } finally {
      this.kkIdReportLoading = false;
      this.cdr.detectChanges();
    }
  }

  private listDateKeysInclusive(start: string, end: string): string[] {
    const out: string[] = [];
    const d = new Date(`${start}T00:00:00`);
    const last = new Date(`${end}T00:00:00`);
    if (Number.isNaN(d.getTime()) || Number.isNaN(last.getTime())) return out;
    while (d.getTime() <= last.getTime()) {
      out.push(this.toDateKey(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  private aggregateKkIdReport(
    events: Array<{ id: string; code: string; at: Date }>
  ): Array<{
    id: string;
    uniqueCodes: number;
    tickCount: number;
    firstAt: Date;
    lastAt: Date;
    codes: string[];
  }> {
    const map = new Map<string, { codes: Set<string>; ticks: number; first: Date; last: Date }>();
    for (const ev of events) {
      let g = map.get(ev.id);
      if (!g) {
        g = { codes: new Set(), ticks: 0, first: ev.at, last: ev.at };
        map.set(ev.id, g);
      }
      g.codes.add(ev.code);
      g.ticks += 1;
      if (ev.at.getTime() && ev.at.getTime() < g.first.getTime()) g.first = ev.at;
      if (ev.at.getTime() > g.last.getTime()) g.last = ev.at;
    }
    return Array.from(map.entries())
      .map(([id, g]) => ({
        id,
        uniqueCodes: g.codes.size,
        tickCount: g.ticks,
        firstAt: g.first,
        lastAt: g.last,
        codes: Array.from(g.codes).sort()
      }))
      .sort((a, b) => b.uniqueCodes - a.uniqueCodes || a.id.localeCompare(b.id));
  }

  closeKkPalletCheck(): void {
    this.showKkPalletCheck = false;
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
      appAlert(ok ? `✅ Đã gán pallet ${ok}/${n} dòng.` : '❌ Không lưu được dòng nào.');
    } catch (e) {
      console.error('❌ saveGanPalletPending', e);
      this.ganPalletBusy = false;
      this.ganPalletError = 'Lỗi khi lưu. Thử lại.';
      this.cdr.detectChanges();
    }
  }

  get kkCatalogFilteredEntries(): KkCatalogEntry[] {
    const q = (this.kkCatalogQuery || '').trim().toUpperCase();
    if (!q) return this.kkCatalogEntries;
    return this.kkCatalogEntries.filter((e) =>
      e.groupCode.includes(q) ||
      e.productType.toUpperCase().includes(q) ||
      this.kkCatalogEffectiveLoc(e).toUpperCase().includes(q)
    );
  }

  protected invalidateKkTypeViewCache(): void {
    this.kkTypeCacheRev++;
    this.kkTypeBoxesSig = '';
    this.kkTypeBoxGroupsSig = '';
    this.kkTypeDetailSig = '';
    this.kkTypePalletNotesSig = '';
    this.kkManagerRowsSig = '';
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

  protected kkConnectorCode(prefix: string, n: number): string {
    return `${prefix}${String(n).padStart(3, '0')}`;
  }

  /** Mục Đầu nối: B008, B009, B016. */
  protected isKkDauNoiMuc(_productType: string, groupCodes: string[] = []): boolean {
    const prefixes = this.kkTypeGroupPrefixes(groupCodes);
    if (!prefixes.length) return false;
    return prefixes.every((p) => p === 'B008' || p === 'B009' || p === 'B016');
  }

  protected isKkDauCotMuc(productType: string, groupCodes: string[] = []): boolean {
    if (this.isKkDauNoiMuc(productType, groupCodes)) return false;
    if (this.kkTypeSharedBPrefix(groupCodes) === 'B018') return false;
    const fold = this.foldKkTypeName(productType);
    return /DAU\s*COT/.test(fold) || /\bTERMINAL/.test(fold);
  }

  /** Phần hãng sau “Đầu cốt (terminal)”. Trống = không ghi hãng. */
  protected kkTerminalBrandTail(productType: string): string {
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
  protected kkCanonicalTypeKey(productType: string, groupCodes: string[] = []): string {
    // B008 (2 ô: 001–500, 501–999) / B009 / B016 / B018 (mỗi ô 100 mã) — 16/10/2026
    const ranges = new Set(groupCodes.map((g) => this.kkRangeTypeOf(g)).filter(Boolean));
    if (ranges.size === 1) return [...ranges][0];
    const ownRange = this.kkRangeTypeOf(productType);
    if (ownRange && ownRange === productType) return ownRange;
    // Gom cả đầu mã về một loại (không chia theo phi / kích thước nữa) — 14/10/2026
    const merged = this.kkMergedPrefixTypeOf(productType, groupCodes);
    if (merged) return merged;
    if (this.isKkUnbrandedTerminalType(productType, groupCodes)) return 'Đầu cốt (terminal)';
    return productType;
  }

  /** Đầu mã chia ô theo khoảng 100 mã thay cho loại hàng. */
  protected static readonly KK_RANGE_PREFIXES = ['B008', 'B009', 'B016', 'B018'];

  /** Số mã mỗi ô: B008 chia 2 ô (001–500, 501–999); B009 / B016 / B018 mỗi ô 100 mã. */
  private static readonly KK_RANGE_SIZE: Record<string, number> = { B008: 500 };

  /** B009123 / B009123xx → "B009101–B009200"; đầu mã khác → ''. Nhận cả nhãn khoảng đã dựng sẵn. */
  private kkRangeTypeOf(codeOrGroup: string): string {
    const s = String(codeOrGroup || '').trim().toUpperCase();
    const m = /^(B\d{3})(\d{3})/.exec(s);
    if (!m || !MaterialsComponent.KK_RANGE_PREFIXES.includes(m[1])) return '';
    const size = MaterialsComponent.KK_RANGE_SIZE[m[1]] || 100;
    const n = Math.max(1, Number(m[2]) || 0);
    const from = Math.floor((n - 1) / size) * size + 1;
    const to = Math.min(999, from + size - 1);
    const pad = (x: number) => String(x).padStart(3, '0');
    return `${m[1]}${pad(from)}–${m[1]}${pad(to)}`;
  }

  /** Mục không hiển thị trên trang KK (theo Loại hàng). */
  protected static KK_HIDDEN_MUCS: string[] = ['B033'];

  /** Đầu mã gom thành 1 loại duy nhất trên trang KK (tên ô = đầu mã). */
  private static readonly KK_MERGED_PREFIX_TYPES = ['B042', 'B017', 'B015'];

  /** Loại thuộc hẳn một đầu mã trong KK_MERGED_PREFIX_TYPES → trả về đầu mã đó, ngược lại ''. */
  private kkMergedPrefixTypeOf(productType: string, groupCodes: string[] = []): string {
    const shared = this.kkTypeSharedBPrefix(groupCodes);
    if (shared && MaterialsComponent.KK_MERGED_PREFIX_TYPES.includes(shared)) return shared;
    // Mã chưa có trong danh mục: loại = đầu mã (vd "B015"), không có groupCodes
    const raw = String(productType || '').trim().toUpperCase();
    return MaterialsComponent.KK_MERGED_PREFIX_TYPES.includes(raw) ? raw : '';
  }

  /** Cùng một đầu mã B+3 (vd B017, B005). Trống nếu loại có nhiều đầu mã. */
  protected kkTypeSharedBPrefix(groupCodes: string[] = []): string {
    const prefixes = this.kkTypeGroupPrefixes(groupCodes);
    if (prefixes.length !== 1) return '';
    const prefix = prefixes[0];
    return /^B\d{3}$/.test(prefix) ? prefix : '';
  }

  protected foldKkTypeName(value: string): string {
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

  closeKkMucShelfMenu(): void {
    this.kkMucShelfMenuCategory = '';
    this.kkMucShelfDraft = '';
  }

  /** Chi tiết KK: lấy dòng khi đã nhập mã, vị trí, hoặc bấm Hôm nay / Hôm qua. */
  protected kkAllStockSearch(): { code: string; loc: string } | null {
    const code = String(this.kkTypeDetailQuery || this.kkLocMapQuery || '').trim().toUpperCase();
    const loc = String(this.kkTypeFilterLoc || '').trim().toUpperCase();
    const codeOk = code.length >= 2;
    if (!codeOk && !loc && !this.kkLocScanDay) return null;
    return { code: codeOk ? code : '', loc };
  }

  /** Dòng tồn khớp ô tìm hoặc ngày scan vị trí — không dựng cả danh sách khi chưa chọn gì. */
  private kkAllStockDetailLines(): InventoryMaterial[] {
    const q = this.kkAllStockSearch();
    // So sánh PO: không cần gõ tìm — lấy mọi dòng tồn của mã có trong file tuổi hàng
    const poCmp = this.kkPoCmpActive ? this.kkPoCmp : null;
    if (!q && !poCmp) return [];
    if (this.kkLocScanDay && !this.kkLocScanReady) return [];

    const range = this.kkLocScanDay ? this.kkLocScanRange(this.kkLocScanDay) : null;
    const seen = new Set<string>();
    const out: InventoryMaterial[] = [];
    const zone = this.kkLocMapWarehouseFilter;
    this.kkLocMapTypeCache.forEach((list) => {
      for (const m of list) {
        const id = String(m.id || '');
        if (id && seen.has(id)) continue;
        if (poCmp && !poCmp.byCode.has(kkPoCmpCode(m.materialCode))) continue;
        if (q?.code && !this.kkLineMatchesSearchQuery(m, q.code)) continue;
        if (q?.loc && !String(m.location || '').toUpperCase().includes(q.loc)) continue;
        if (range) {
          const scanned = !!(id && this.kkLocScanIds.has(id));
          const at = scanned ? null : this.normalizeTimestamp(m.locationScannedAt);
          if (!scanned && !(at && at >= range.start && at < range.end)) continue;
        }
        const opening = m.openingStock !== null && m.openingStock !== undefined ? m.openingStock : 0;
        if (opening + (m.quantity || 0) - (m.exported || 0) - (m.xt || 0) <= 0) continue;
        const wh = this.kkWarehouseFromLocation(m.location);
        if (!this.kkMatchesWh3Mode(wh)) continue;
        if (zone && wh !== zone) continue;
        if (id) seen.add(id);
        out.push(m);
      }
    });
    out.sort((a, b) => {
      const ca = a.materialCode || '';
      const cb = b.materialCode || '';
      if (ca !== cb) return ca < cb ? -1 : 1;
      const pa = a.poNumber || '';
      const pb = b.poNumber || '';
      if (pa !== pb) return pa < pb ? -1 : 1;
      return 0;
    });
    return out;
  }

  /** Dòng tồn của mọi mã trong dải tầng đang Chi tiết (set cho vị trí mâm đó). */
  private kkConnectorFloorDetailLines(d: {
    prefix: string;
    shelf: string;
    level: number;
    from: number;
    to: number;
    locs: string[];
    title: string;
    parity?: 'odd' | 'even';
  }): InventoryMaterial[] {
    const codeSet = new Set<string>();
    for (let n = d.from; n <= d.to; n++) {
      if (d.parity === 'odd' && n % 2 === 0) continue;
      if (d.parity === 'even' && n % 2 === 1) continue;
      codeSet.add(this.kkConnectorCode(d.prefix, n));
    }
    const seen = new Set<string>();
    const out: InventoryMaterial[] = [];
    this.kkLocMapTypeCache.forEach((list) => {
      for (const m of list) {
        const id = String(m.id || '');
        if (id && seen.has(id)) continue;
        if (this.calculateCurrentStock(m) <= 0) continue;
        if (!this.kkMatchesWh3Mode(this.kkWarehouseFromLocation(m.location))) continue;
        const materialCode = String(m.materialCode || '').trim().toUpperCase();
        const group = this.kkCatalog.groupCodeFromMaterial(materialCode) || '';
        if (!codeSet.has(group) && !codeSet.has(materialCode)) continue;
        if (id) seen.add(id);
        out.push(m);
      }
    });
    out.sort((a, b) => {
      const code = this.compareMaterialCodesFIFO(
        String(a.materialCode || ''),
        String(b.materialCode || '')
      );
      if (code) return code;
      return String(a.poNumber || '').localeCompare(String(b.poNumber || ''), 'en', { numeric: true });
    });
    return out;
  }

  protected ensureKkTypeBoxesCache(): void {
    const sig = [
      this.kkTypeCacheRev,
      this.kkLocMapWarehouseFilter,
      this.kkCountWh3 ? 1 : 0,
      this.kkWh3Only ? 1 : 0,
      this.kkJOnly ? 1 : 0,
      this.kkFilterUncheckedOnly ? 1 : 0,
      this.kkEffectiveSearchQuery(),
      this.kkCheckActive ? this.linkQCheckSet.size : 0
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
    const q = this.kkEffectiveSearchQuery();
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
      const group = String(e.groupCode || '').trim();
      bump(e.productType, group ? [group] : []).groups.add(e.groupCode);
    }
    for (const r of this.kkLocMapByType) {
      bump(r.productType, r.groupCodes);
    }
    if (!this.kkStockLoaded) {
      // Chưa đọc tồn toàn kho: vẫn hiện các box đã thấy ở lần đọc trước (mã chưa có trong danh mục)
      for (const r of this.loadKkTypeSkeleton()) bump(r.t, r.g);
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
        if (q && !searchHit && this.kkLineMatchesSearchQuery(m, q)) searchHit = true;
        if (this.kkCheckActive && !this.kkCheckHas(m.materialCode)) continue;
        if (this.isKkAgingExempt(m)) continue;
        const wh = this.kkWarehouseFromLocation(m.location);
        if (!this.kkMatchesWh3Mode(wh)) continue;
        if (zone && wh !== zone) continue;
        const lineStock = this.calculateCurrentStock(m);
        if (lineStock <= 0) continue;
        stock += lineStock;
        totalLines += 1;
        if (this.isKkFlagOn(m.kkChecked)) checked += 1;
      }
      if (q && !searchHit && !this.isKkFullMaterialQuery(q)) {
        searchHit = Array.from(cur.sources).some((s) => s.toUpperCase().includes(q));
      }
      cur.stock = stock;
      cur.totalLines = totalLines;
      cur.checked = checked;
      cur.searchHit = searchHit;
    });
    const checkTypes = this.kkCheckActive ? this.kkCheckTypes() : null;
    const built = Array.from(map.values())
      .filter((v) => {
        const queryHit = !q ? true : (
          (!this.isKkFullMaterialQuery(q) && v.productType.toUpperCase().includes(q))
          || Array.from(v.groups).some((g) => this.kkCodeMatchesSearch(g, q))
          || v.searchHit
          || (!this.isKkFullMaterialQuery(q)
            && this.isKkConnector110PType(v.productType, Array.from(v.groups))
            && (/1\s*[-–]?\s*4P/.test(q) || /5\s*[-–]?\s*10P/.test(q)))
        );
        if (!queryHit) return false;
        if (checkTypes && !checkTypes.has(v.productType) && !Array.from(v.sources).some((src) => checkTypes.has(src))) return false;
        if (q) return true;
        // Chưa đọc tồn toàn kho: hiện đủ box, bấm box nào mới đọc tồn box đó
        if (!this.kkStockLoaded) return true;
        if (v.totalLines <= 0) return false;
        if (this.kkFilterUncheckedOnly && Math.max(0, v.totalLines - v.checked) <= 0) return false;
        return true;
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
      sourceProductTypes?: string[];
      pinSplit?: '1-4' | '5-10';
      groupCodes: string[];
      sharedPrefix: string;
      stock: number;
      checked: number;
      totalLines: number;
      remaining: number;
    }>
  ): typeof boxes {
    const q = this.kkEffectiveSearchQuery();
    const zone = this.kkLocMapWarehouseFilter;
    const out: typeof boxes = [];
    for (const box of boxes) {
      if (!this.isKkConnector110PType(box.productType, box.groupCodes)) {
        out.push({ ...box, sourceProductType: box.sourceProductType || box.productType });
        continue;
      }
      const sources = (box.sourceProductTypes && box.sourceProductTypes.length)
        ? box.sourceProductTypes
        : [box.sourceProductType || box.productType];
      const raw: InventoryMaterial[] = [];
      const seenRaw = new Set<string>();
      for (const src of sources) {
        for (const m of this.kkLocMapTypeCache.get(src) || []) {
          const id = String(m.id || '');
          if (id) {
            if (seenRaw.has(id)) continue;
            seenRaw.add(id);
          }
          raw.push(m);
        }
      }
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
          if (this.kkCheckActive && !this.kkCheckHas(m.materialCode)) continue;
          if (this.isKkAgingExempt(m)) continue;
          stock += lineStock;
          totalLines += 1;
          if (this.isKkFlagOn(m.kkChecked)) checked += 1;
        }
        if (this.kkFilterUncheckedOnly && Math.max(0, totalLines - checked) <= 0) continue;
        out.push({
          productType: this.kkConnector110PSplitLabel(box.productType, split),
          sourceProductType: box.sourceProductType || box.productType,
          sourceProductTypes: sources,
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
  protected compareNhuaGroupCode(a: string, b: string): number {
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

  protected compareKkTypeBox(
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
    this.ensureKkTypeDetailCache();
    row.stock = this.kkTypeLiveStock;
    row.totalLines = this.kkTypeLiveTotal;
    row.checked = this.kkTypeLiveChecked;
    row.remaining = Math.max(0, row.totalLines - row.checked);
    return row;
  }

  /** "Xem toàn bộ" 1 mục: bảng chi tiết gộp mọi box của mục (vd toàn bộ B016). */
  kkMucAllDetail: { title: string; boxes: KkStockBoxRef[] } | null = null;

  closeKkTypeBoxMenu(): void {
    this.kkTypeBoxMenuVisible = false;
    this.kkTypeBoxMenuBox = null;
    this.kkTypeBoxMenuManagerDraft = '';
    this.kkTypeBoxMenuSaving = false;
  }

  printKkTypeNameLabelFromPicker(): void {
    const productType = String(this.layoutLocTypeAssign || '').trim();
    if (!productType) return;
    this.printKkTypeNameLabel(productType);
  }

  /** File LinkQ mới nhất + map tồn (cùng nguồn Overview). */
  protected async loadKkKiemKeLinkQPack(): Promise<LinkQPack> {
    const map = new Map<string, number>();
    const po = new Map<string, Map<string, number>>();
    const put = (code: string, stock: unknown) => {
      const key = this.normalizeTieuHuyCode(code);
      if (!key) return;
      map.set(key, Math.round(Number(stock) || 0));
    };
    let label = 'Chưa có file LinkQ';
    try {
      const canonical = await this.firestore.collection('linkQFiles').doc(this.selectedFactory).get().toPromise();
      let data: any = null;
      if (canonical?.exists) {
        data = canonical.data();
      } else {
        const snap = await this.firestore.collection('linkQFiles', (ref) =>
          ref.where('factory', '==', this.selectedFactory).limit(20)
        ).get().toPromise();
        const docs = [...(snap?.docs || [])].sort((a, b) => {
          const da = (a.data() as any)?.uploadDate?.toMillis?.() || (a.data() as any)?.uploadDate?.seconds * 1000 || 0;
          const db = (b.data() as any)?.uploadDate?.toMillis?.() || (b.data() as any)?.uploadDate?.seconds * 1000 || 0;
          return db - da;
        });
        data = docs[0]?.data() || null;
      }
      const raw = (data?.linkQData || null) as Record<string, unknown> | null;
      if (raw) {
        for (const [code, stock] of Object.entries(raw)) put(code, stock);
      }
      const rawPo = (data?.linkQPoData || null) as Record<string, Record<string, unknown>> | null;
      if (rawPo) {
        for (const [code, byPo] of Object.entries(rawPo)) {
          const key = this.normalizeTieuHuyCode(code);
          if (!key || !byPo) continue;
          const m = po.get(key) || new Map<string, number>();
          for (const [p, q] of Object.entries(byPo)) m.set(String(p).trim().toUpperCase() || '—', Math.round(Number(q) || 0));
          po.set(key, m);
        }
      }
      const ms = data?.uploadDate?.toMillis?.()
        || (data?.uploadDate?.seconds ? data.uploadDate.seconds * 1000 : 0)
        || 0;
      const fileName = String(data?.fileName || data?.name || '').trim();
      if (ms || fileName || map.size) {
        const when = ms ? new Date(ms).toLocaleString('vi-VN') : '—';
        label = `${fileName || 'LinkQ'} · ${when} · ${map.size} mã`;
      }
    } catch (e) {
      console.warn('[KK giấy kiểm kê] load LinkQ failed', e);
    }
    return { map, label, po };
  }

  /** Tem 57×32mm (cùng khổ Inbound) — chỉ tên nhóm hàng. */
  printKkTypeNameLabel(productType: string): void {
    const name = String(productType || '').trim();
    if (!name) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      appAlert('❌ Không thể mở cửa sổ in. Vui lòng cho phép popup!');
      return;
    }
    const esc = (s: string) => this.escapeHtmlForPrint(s);
    printWindow.document.write(`<!DOCTYPE html>
<html><head><title>${esc(name)}</title>
<style>
  * { margin:0!important; padding:0!important; box-sizing:border-box!important; }
  body {
    font-family: Arial, sans-serif;
    background: white!important;
    overflow: hidden!important;
    width: 57mm!important;
    height: 32mm!important;
  }
  .label {
    display: flex!important;
    flex-direction: column!important;
    justify-content: center!important;
    align-items: center!important;
    text-align: center!important;
    width: 57mm!important;
    height: 32mm!important;
    padding: 2.5mm!important;
    border: 1px solid #000!important;
    page-break-inside: avoid!important;
    box-sizing: border-box!important;
    color: #000!important;
  }
  .name {
    font-size: 18px!important;
    font-weight: 800!important;
    line-height: 1.2!important;
    word-break: break-word!important;
  }
  @media print {
    body { width:57mm!important; height:32mm!important; }
    @page { margin:0!important; size: 57mm 32mm!important; padding:0!important; }
    .label { width:57mm!important; height:32mm!important; }
  }
</style></head>
<body>
  <div class="label">
    <div class="name">${esc(name)}</div>
  </div>
  <script>window.onload=function(){setTimeout(function(){window.print();},300);};</script>
</body></html>`);
    printWindow.document.close();
  }

  private async applyKkTypeHomeLocPicker(): Promise<void> {
    const productType = String(this.layoutLocTypeAssign || '').trim();
    if (!productType) return;
    if (String(this.layoutLocManualDraft || '').trim()) this.addLayoutLocManual();
    const locs = this.layoutLocNormalizeTokens(Array.from(this.layoutLocSelected));
    const mismatch = this.layoutLocSRuleMismatchMessage(locs);
    if (mismatch && !confirm(mismatch)) return;
    const joined = this.normalizeMultiLocationValue(joinMultiLocations(locs));
    try {
      await this.kkCatalog.saveHomeLoc(productType, joined);
      if (joined) this.kkTypeHomeLocs.set(productType, joined);
      else this.kkTypeHomeLocs.delete(productType);
      this.kkTypeHomeLocs = new Map(this.kkTypeHomeLocs);
      this.invalidateKkTypeViewCache();
      this.closeLayoutLocPicker();
      this.cdr.detectChanges();
    } catch (e) {
      console.error('❌ saveHomeLoc:', e);
      appAlert('❌ Không lưu được vị trí yêu cầu.');
    }
  }

  get kkTypeDetailAll(): InventoryMaterial[] {
    this.ensureKkTypeDetailCache();
    return this.kkTypeDetailAllCached;
  }

  protected ensureKkTypeDetailCache(): void {
    const floor = this.kkConnectorFloorDetail;
    const sig = [
      this.kkTypeCacheRev,
      this.kkActiveProductType || '',
      this.kkActiveSourceProductType || '',
      this.kkActivePinSplit || '',
      this.kkAllStockDetail ? 1 : 0,
      floor ? `${floor.prefix}|${floor.shelf}|${floor.level}|${floor.from}|${floor.to}` : '',
      this.kkLocMapWarehouseFilter,
      this.kkCountWh3 ? 1 : 0,
      this.kkWh3Only ? 1 : 0,
      this.kkJOnly ? 1 : 0,
      this.kkFilterUncheckedOnly ? 1 : 0,
      this.kkEffectiveSearchQuery(),
      this.kkTypeDetailQuery,
      this.kkTypeFilterLoc,
      this.kkTypeFilterWh,
      this.kkTypeFilterRolls,
      this.kkLastBagOnly ? 'LB' : '',
      this.kkRecentExportAt,
      this.kkTypeSortQtyDesc ? 1 : 0,
      this.kkTypeSortRollsDesc ? 1 : 0,
      this.kkTypeSortKkTimeDesc ? 1 : 0,
      this.kkPoCmpOn && this.kkPoCmp ? `po:${this.kkPoCmp.pairCount}:${this.kkPoCmp.importedAt?.getTime() || 0}:${this.kkPoCmpPending?.size ?? -1}:${this.kkPoCmpSurplusOnly ? 1 : 0}` : '',
      this.kkCheckActive ? this.linkQCheckSet.size : 0,
      this.kkTypeInnerQuery,
      this.kkTypeWarnFilter,
      this.kkTypeLinkQFilter,
      this.kkTypeCodeToneFilter,
      this.kkTypeKkFilter,
      this.kkTypeDiffFilter,
      this.kkPendingPxk ? this.kkPendingPxk.size : 0,
      this.kkTypeLinkQLabel,
      this.kkLocScanDay,
      this.kkLocScanReady ? 1 : 0,
      this.kkLocScanReq,
      this.kkThMode ? 'TH' + this.thItems.length : '',
      this.kkWeekMode ? 'WEEK' : ''
    ].join('|');
    if (sig === this.kkTypeDetailSig) return;
    this.kkTypeDetailSig = sig;
    if (this.kkAllStockDetail && this.kkActiveProductType === this.kkAllStockDetailTitle) {
      this.kkTypeDetailAllCached = this.kkAllStockDetailLines();
    } else if (floor && this.kkActiveProductType === floor.title) {
      this.kkTypeDetailAllCached = this.kkConnectorFloorDetailLines(floor);
    } else {
      const name = this.kkActiveProductType;
      const found = name
        ? (this.kkLocMapByType.find((r) => r.productType === name)
          || (this.kkActiveTypeDraft?.productType === name ? this.kkActiveTypeDraft : this.buildEmptyKkTypeRow(name)))
        : null;
      this.kkTypeDetailAllCached = this.kkTypeDetailLines(found);
    }
    // Mã đầu R / B033: không hiển thị, không kiểm
    this.kkTypeDetailAllCached = this.kkTypeDetailAllCached.filter((m) => !MaterialsComponent.isKkExcludedCode(m.materialCode) && !this.isKkQcNgData(m));
    // Nút TH: chỉ các mã trong danh sách tiêu hủy
    if (this.kkThMode) this.kkTypeDetailAllCached = this.kkTypeDetailAllCached.filter((m) => !!this.thItemOf(m.materialCode));
    // Nút Week: chỉ dòng còn tồn kho và đã có Week
    if (this.kkWeekMode) {
      this.kkTypeDetailAllCached = this.kkTypeDetailAllCached.filter(
        (m) => !!String(m.week || '').trim() && this.calculateCurrentStock(m) > 1e-6
      );
    }
    this.kkTypeDetailFilteredCached = this.buildKkTypeDetailFiltered(this.kkTypeDetailAllCached);
    let stock = 0;
    let checked = 0;
    let total = 0;
    for (const m of this.kkTypeDetailAllCached) {
      stock += this.calculateCurrentStock(m);
      if (this.isKkAgingExempt(m)) continue;
      total += 1;
      if (this.isKkFlagOn(m.kkChecked)) checked += 1;
    }
    this.kkTypeLiveStock = stock;
    this.kkTypeLiveChecked = checked;
    this.kkTypeLiveTotal = total;
    this.kkTypeFilteredRollsCached = this.kkAllStockDetail
      ? 0
      : this.kkTypeDetailFilteredCached.reduce((sum, m) => sum + this.getKkRollsCount(m), 0);
  }

  private buildKkTypeDetailFiltered(all: InventoryMaterial[]): InventoryMaterial[] {
    let rows = all;
    if ((this.kkAllStockDetail || this.kkMucAllDetail) && this.kkPoCmpActive) {
      const webByKey = new Map<string, number>();
      for (const m of all) {
        const k = `${kkPoCmpCode(m.materialCode)}|${kkPoCmpPo(m.poNumber)}`;
        webByKey.set(k, (webByKey.get(k) || 0) + this.calculateCurrentStock(m));
      }
      const mismatch = rows.filter((m) => this.isKkPoMismatch(m));
      rows = mismatch.filter((m) => !this.isKkPoExplainedByPxk(m, webByKey));
      this.kkPoCmpPxkHidden = mismatch.length - rows.length;
      // Dư sai: PO web không có trên LinkQ, không có PXK chưa xuất, tồn web của PO ≈ lệch tổng (web − LinkQ) của mã.
      // Không tính kho NG (cả dòng ứng viên lẫn tổng web).
      const okByKey = new Map<string, number>();
      const okByCode = new Map<string, number>();
      for (const m of all) {
        if (this.isKkPoSurplusExcluded(m)) continue;
        const c = kkPoCmpCode(m.materialCode);
        const q = this.calculateCurrentStock(m);
        okByKey.set(`${c}|${kkPoCmpPo(m.poNumber)}`, (okByKey.get(`${c}|${kkPoCmpPo(m.poNumber)}`) || 0) + q);
        okByCode.set(c, (okByCode.get(c) || 0) + q);
      }
      const surplus = rows.filter((m) => !this.isKkPoSurplusExcluded(m) && this.isKkPoSurplus(m, okByKey, okByCode));
      this.kkPoCmpSurplusRows = surplus;
      this.kkPoCmpSurplusCount = surplus.length;
      if (this.kkPoCmpSurplusOnly) rows = surplus;
    }
    if (this.kkTypeLinkQFilter && this.kkTypeLinkQMap) {
      const want = this.kkTypeLinkQFilter === 'yes';
      rows = rows.filter((m) => this.kkTypeLinkQMap!.has(this.normalizeTieuHuyCode(m.materialCode)) === want);
    }
    if (this.kkTypeCodeToneFilter) {
      const f = this.kkTypeCodeToneFilter;
      rows = rows.filter((m) => {
        const red = this.isK100(m.materialCode);
        const orange = !red && this.isPlanUsedUp(m.materialCode);
        return f === 'red' ? red : f === 'orange' ? orange : red || orange;
      });
    }
    if (this.kkTypeKkFilter === 'done') rows = rows.filter((m) => this.isKkFlagOn(m.kkChecked));
    else if (this.kkTypeKkFilter === 'done-short') rows = rows.filter((m) => this.isKkTickedScanShort(m));
    else if (this.kkTypeKkFilter === 'todo') rows = rows.filter((m) => !this.isKkFlagOn(m.kkChecked) && !this.isKkAgingExempt(m));
    if (this.kkTypeWarnFilter === 'any') rows = rows.filter((m) => !!this.kkWarningOf(m));
    else if (this.kkTypeWarnFilter) rows = rows.filter((m) => this.kkWarningOf(m) === this.kkTypeWarnFilter);
    if (this.kkTypeDiffFilter && this.kkPendingPxk) {
      const mode = this.kkTypeDiffFilter;
      const t = this.ruleNum('linkqDiffThreshold');
      rows = rows.filter((m) => {
        const d = this.kkPxkDiffOf(m);
        if (d == null) return false;
        if (mode === 'bad') return d > t || d < -t;
        if (mode === 'ok') return d >= -t && d <= t;
        if (mode === 'pos') return d > t;
        if (mode === 'neg') return d < -t;
        return true;
      });
    }
    const iq = this.kkTypeInnerQuery.trim().toUpperCase();
    if (iq) {
      rows = rows.filter((m) =>
        String(m.materialCode || '').toUpperCase().includes(iq) ||
        String(m.poNumber || '').toUpperCase().includes(iq) ||
        this.getDisplayIMD(m).includes(iq) ||
        String(m.location || '').toUpperCase().includes(iq) ||
        String(m.palletId || '').toUpperCase().includes(iq) ||
        this.getKkMaterialName(m).toUpperCase().includes(iq)
      );
    }
    if (this.kkCheckActive) rows = rows.filter((m) => this.kkCheckHas(m.materialCode));
    if (this.kkFilterUncheckedOnly) {
      rows = rows.filter((m) => !this.isKkFlagOn(m.kkChecked) && !this.isKkAgingExempt(m));
    }
    const loc = this.kkTypeFilterLoc.trim().toUpperCase();
    if (loc) {
      if (this.kkAllStockDetail) {
        rows = rows.filter((m) => String(m.location || '').trim().toUpperCase().includes(loc));
      } else {
        rows = rows.filter((m) => String(m.location || '').trim().toUpperCase() === loc);
      }
    }
    if (this.kkTypeFilterWh) {
      rows = rows.filter((m) => this.kkWarehouseFromLocation(m.location) === this.kkTypeFilterWh);
    }
    if (this.kkTypeFilterRolls) {
      rows = rows.filter((m) => this.getKkRollsText(m) === this.kkTypeFilterRolls);
    }
    // Tô sáng / lọc dòng vừa xuất còn 1 bag (đọc phiếu xuất 7 ngày ở nền)
    void this.ensureKkRecentExports();
    if (this.kkLastBagOnly) {
      rows = this.kkRecentExportKeys ? rows.filter((m) => this.isKkRecentLastBag(m)) : [];
    }
    if (this.kkLocScanDay) {
      if (!this.kkLocScanReady) {
        rows = [];
      } else {
        const range = this.kkLocScanRange(this.kkLocScanDay);
        rows = rows.filter((m) => {
          const id = String(m.id || '');
          if (id && this.kkLocScanIds.has(id)) return true;
          const at = this.normalizeTimestamp(m.locationScannedAt);
          return !!at && at >= range.start && at < range.end;
        });
      }
    }
    const qRaw = String(this.kkLocMapQuery || this.kkTypeDetailQuery || '').trim().toUpperCase();
    const q = this.kkAllStockDetail
      ? (qRaw.length >= 2 ? qRaw : '')
      : this.kkEffectiveSearchQuery(this.kkLocMapQuery || this.kkTypeDetailQuery);
    if (q) {
      rows = rows.filter((m) => this.kkLineMatchesSearchQuery(m, q));
    }
    if (this.kkTypeSortKkTimeDesc) {
      rows = [...rows].sort((a, b) => this.kkTickTimeMs(b) - this.kkTickTimeMs(a));
    } else if (this.kkTypeSortRollsDesc) {
      rows = [...rows].sort((a, b) => this.getKkRollsCount(b) - this.getKkRollsCount(a));
    } else if (this.kkTypeSortQtyDesc) {
      rows = [...rows].sort((a, b) => this.calculateCurrentStock(b) - this.calculateCurrentStock(a));
    }
    return rows;
  }

  /** Mã đầy đủ: B001800 / A012345 / R000001 (+ hậu tố). Không còn khớp nhóm B001 hay đoạn số 1800. */
  private isKkFullMaterialQuery(q: string): boolean {
    return /^[ABR]\d{6,}$/.test(String(q || '').trim().toUpperCase());
  }

  /** Search only after 4+ characters (4 số); always uppercase. Location names may be shorter. */
  protected kkEffectiveSearchQuery(raw?: string): string {
    const q = String(raw ?? (this.kkLocMapQuery || '')).trim().toUpperCase();
    if (!q) return '';
    if (this.kkLocMapView === 'location') return q;
    return q.length >= 4 ? q : '';
  }

  /** 16580 matches B016580; optional leading A/B/R. Full mã B001800 chỉ khớp đúng mã đó. */
  protected kkCodeMatchesSearch(code: string, q: string): boolean {
    const c = String(code || '').trim().toUpperCase();
    const query = String(q || '').trim().toUpperCase();
    if (!c || !query) return false;
    if (this.isKkFullMaterialQuery(query)) {
      if (c === query || c.startsWith(query)) return true;
      const qGroup = this.kkCatalog.normalizeGroupCode(query);
      const cGroup = this.kkCatalog.normalizeGroupCode(c);
      return !!(qGroup && cGroup && qGroup === cGroup);
    }
    if (c.includes(query)) return true;
    const qDigits = /^\d+$/.test(query) ? query : (/^[ABR](\d+)$/.exec(query)?.[1] || '');
    if (qDigits.length < 4) return false;
    const cDigits = c.replace(/\D/g, '');
    if (cDigits.includes(qDigits)) return true;
    const stripped = qDigits.replace(/^0+/, '') || '0';
    if (stripped.length >= 4 && stripped !== qDigits && cDigits.includes(stripped)) return true;
    if (qDigits.length >= 5 && qDigits.length <= 6) {
      const padded = this.kkCatalog.normalizeGroupCode(`B${qDigits}`);
      if (padded && c.includes(padded)) return true;
    }
    return false;
  }

  /** Match material / group / prefix for KK search (ignores Zone filter). */
  private kkLineMatchesSearchQuery(m: InventoryMaterial, q: string): boolean {
    if (!q) return true;
    if (this.kkCodeMatchesSearch(String(m.materialCode || ''), q)) return true;
    if (this.isKkFullMaterialQuery(q)) return false;
    if (String(m.palletId || '').toUpperCase().includes(q)) return true;
    return this.getKkMaterialName(m).toUpperCase().includes(q);
  }

  protected kkLocScanRange(day: 'today' | 'yesterday'): { start: Date; end: Date } {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    if (day === 'yesterday') start.setDate(start.getDate() - 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
  }

  /** Thời điểm tick KK (ms); chưa tick → 0 (xuống cuối). */
  private kkTickTimeMs(m: InventoryMaterial): number {
    if (!m || !this.isKkFlagOn(m.kkChecked)) return 0;
    const raw: any = (m as any).kkAt;
    if (!raw) return 0;
    const d: Date = typeof raw.toDate === 'function' ? raw.toDate()
      : raw.seconds != null ? new Date(raw.seconds * 1000)
      : raw instanceof Date ? raw : new Date(raw);
    const t = d.getTime();
    return Number.isNaN(t) ? 0 : t;
  }

  private async clearKkWarningAll(value: string): Promise<void> {
    if (!value) return;
    const label = this.kkWarningOptions.find((o) => o.value === value)?.label || value;
    const factory = this.selectedFactory;
    try {
      const snap = await this.firestore.firestore.collection('inventory-materials').where('kkWarning', '==', value).get();
      const docs = snap.docs.filter((d) => String((d.data() as any)?.factory || '').trim().toUpperCase() === factory);
      const by = await this.getMaterialsOtpRequester();
      const now = firebase.default.firestore.FieldValue.serverTimestamp();
      for (let i = 0; i < docs.length; i += 400) {
        const batch = this.firestore.firestore.batch();
        docs.slice(i, i + 400).forEach((d) => batch.update(d.ref, {
          kkWarning: '', kkWarningBy: '', kkWarningAt: now, kkWarningClearedBy: by, kkWarningClearedValue: value
        }));
        await batch.commit();
      }
      const ids = new Set(docs.map((d) => d.id));
      this.kkLocMapTypeCache.forEach((list) => list.forEach((m) => {
        if (m.id && ids.has(m.id)) { (m as any).kkWarning = ''; (m as any).kkWarningBy = ''; }
      }));
      ids.forEach((id) => this.patchKkInvSnapCache(id, { kkWarning: '', kkWarningBy: '' }));
      this.kkTypeWarnFilter = '';
      this.invalidateKkTypeViewCache();
      appAlert(`Đã xóa cảnh báo "${label}" của ${docs.length} dòng (${factory}).`);
    } catch (e: any) {
      console.error('clearKkWarningAll:', e);
      appAlert('❌ Không xóa được cảnh báo: ' + (e?.message || e));
    } finally {
      this.kkWarnClearPending = '';
      this.cdr.detectChanges();
    }
  }

  private kkTypeReportZoneLabel(): string {
    if (this.kkLocMapWarehouseFilter) return this.kkWarehouseLabel(this.kkLocMapWarehouseFilter);
    if (this.kkJOnly) return 'Chi kho J';
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
      appAlert('Không có dữ liệu để tải báo cáo.');
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
        appAlert('Hãy mở một loại hàng trước.');
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
      appAlert('❌ Không tải được báo cáo Excel.');
    } finally {
      this.kkTypeReportBusy = false;
      this.cdr.detectChanges();
    }
  }

  protected buildEmptyKkTypeRow(productType: string): KkTypeRow {
    const zone = this.kkLocMapWarehouseFilter || 'J';
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
    if (warehouse === 'J' || warehouse === 'J5') return 'J';
    if (warehouse === 'ASM3') return 'ASM3';
    return 'J'; // từ 14/10/2026 mọi hàng thuộc Kho J
  }

  /** Token kho J: R1–R99 / S1–S99, tiền tố J5-/J-, locker/BOX, TRA, IQC, Pass. */
  private isJWarehouseToken(loc: string): boolean {
    const raw = String(loc || '').trim().toUpperCase();
    if (!raw) return false;
    if (raw === 'IQC' || raw.startsWith('IQC')) return true;
    if (raw === 'PASS') return true;
    if (this.isLockerOrBoxToken(raw)) return true;
    if (this.isTraLocationToken(raw)) return true;
    if (raw === 'J' || raw === 'J5' || raw.startsWith('J5-') || raw.startsWith('J-')) return true;
    if (isJWarehouseLocation(raw)) return true;
    return isJWarehouseLocation(this.stripDoiKhoWhPrefix(raw).toUpperCase());
  }

  /**
   * Kho của một dòng tồn trên trang KK. Từ 14/10/2026 mọi hàng đều thuộc Kho J
   * (không còn Kho D1 / ASM3 / 00 / trống) — chỉ đổi cách hiển thị, chuỗi vị trí trong dữ liệu giữ nguyên.
   * Cách phân kho cũ theo vị trí: kkWarehouseFromLocationLegacy.
   */
  kkWarehouseFromLocation(_location: string | null | undefined): KkWarehouse {
    return 'J';
  }

  /** (Cũ) Kho theo vị trí: R1–R99 / S1–S99 / J5 → Kho J; 00- → 00; ASM3/WH3 → kho tạm; còn lại = D1. */
  kkWarehouseFromLocationLegacy(location: string | null | undefined): KkWarehouse {
    const tokens = splitMultiLocations(String(location || ''));
    const list = tokens.length ? tokens : [String(location || '')];
    for (const token of list) {
      if (this.isJWarehouseToken(token)) return 'J';
    }
    const first = (tokens[0] || String(location || '')).trim().toUpperCase();
    if (!first) return 'D1';
    if (first === '00' || first.startsWith('00-') || first.startsWith('00+')) return '00';
    if (isAsm3OrWh3PrefixLocation(first)) return 'ASM3';
    return 'D1';
  }

  /** Sửa pallet 1 dòng chi tiết — không đổi ô pallet ở dòng tổng. */
  /** Cột Báo cáo (bảng tồn kho): "Đã hết stock" → lưu vào dòng + Zalo nhóm Quản lý kho. */
  readonly invReportOptions: Array<{ value: string; label: string }> = [
    { value: 'het-stock', label: 'Đã hết stock' }
  ];
  invReportBusyId: string | null = null;

  invReportOf(m: InventoryMaterial): string {
    return String((m as any)?.invReport || '');
  }

  async onInvReportChange(m: InventoryMaterial, value: string, _raw?: unknown): Promise<void> {
    if (this.denyAction('invReport')) return;
    if (!this.canEdit || !m?.id) return;
    const next = String(value || '');
    const prev = this.invReportOf(m);
    if (next === prev) return;
    const label = this.invReportOptions.find((o) => o.value === next)?.label || '';
    if (next && !confirm(`Báo "${label}" cho ${m.materialCode} · PO ${m.poNumber || '—'}?\nBot Zalo sẽ nhắn nhóm Quản lý kho.`)) {
      (m as any).invReport = prev;
      this.cdr.detectChanges();
      return;
    }
    (m as any).invReport = next;
    this.invReportBusyId = m.id;
    this.cdr.detectChanges();
    try {
      const by = await this.getMaterialsOtpRequester();
      await this.firestore.firestore.collection('inventory-materials').doc(m.id).update({
        invReport: next,
        invReportBy: next ? by : '',
        invReportAt: firebase.default.firestore.FieldValue.serverTimestamp()
      });
      (m as any).invReportBy = next ? by : '';
      if (next) {
        try {
          await this.invStockReport.notify({
            factory: this.selectedFactory,
            materialCode: String(m.materialCode || ''),
            po: String(m.poNumber || ''),
            imd: this.getDisplayIMD(m),
            stock: this.formatNumber(this.calculateCurrentStock(m)),
            location: this.primaryLocationDisplay(m.location),
            status: label,
            reportedBy: by
          });
        } catch (e: any) {
          appAlert(`Đã lưu báo cáo nhưng chưa gửi được Zalo: ${e?.message || e}`);
        }
      }
    } catch (e) {
      console.error('onInvReportChange:', e);
      (m as any).invReport = prev;
      appAlert('❌ Không lưu được báo cáo.');
    } finally {
      this.invReportBusyId = null;
      this.cdr.detectChanges();
    }
  }

  // ===== Cột Báo cáo (điều chỉnh): đề nghị Giảm / Tăng Tồn đầu hoặc Tồn cuối → Zalo nhóm Quản lý kho → duyệt ở More =====
  /** Tồn đầu → trường openingStock; Tồn cuối → trường quantity (NK), cùng cách nhập ngược của cột Kế toán cũ. */
  private static readonly INV_ADJUST_COL = 'inventory-adjust-requests';

  invAdjust: {
    material: InventoryMaterial;
    target: '' | 'opening' | 'closing';
    direction: '' | 'dec' | 'inc';
    qty: number | null;
    note: string;
    busy: boolean;
    msg: string;
    ok: boolean;
  } | null = null;

  invAdjustTargetLabel(t: string): string {
    return t === 'opening' ? 'Tồn đầu' : t === 'closing' ? 'Tồn cuối' : t === 'delete' ? 'Xóa dòng' : t === 'po' ? 'Đổi PO' : '';
  }

  invAdjustDirectionLabel(d: string): string {
    return d === 'dec' ? 'Giảm' : d === 'inc' ? 'Tăng' : '';
  }

  openInvAdjust(m: InventoryMaterial): void {
    if (this.denyAction('invAdjustRequest')) return;
    if (!m?.id) return;
    this.invAdjust = { material: m, target: '', direction: '', qty: null, note: '', busy: false, msg: '', ok: false };
  }

  async submitInvAdjust(): Promise<void> {
    const a = this.invAdjust;
    if (!a || a.busy || a.ok) return;
    if (!a.target) { a.msg = 'Chọn báo cáo: Tồn đầu hoặc Tồn cuối.'; return; }
    if (!a.direction) { a.msg = 'Chọn Giảm hoặc Tăng.'; return; }
    const qty = Math.round((Number(a.qty) || 0) * 10000) / 10000;
    if (!(qty > 0)) { a.msg = 'Nhập lượng (> 0).'; return; }
    const m = a.material;
    const targetLabel = this.invAdjustTargetLabel(a.target);
    const dirLabel = this.invAdjustDirectionLabel(a.direction);
    const current = a.target === 'opening' ? Number(m.openingStock) || 0 : this.calculateCurrentStock(m);
    const expected = Math.round((current + (a.direction === 'inc' ? qty : -qty)) * 10000) / 10000;
    a.busy = true;
    a.msg = '';
    this.cdr.detectChanges();
    try {
      const by = await this.getMaterialsOtpRequester();
      await this.firestore.firestore.collection(MaterialsComponent.INV_ADJUST_COL).add({
        factory: this.selectedFactory,
        materialId: m.id,
        materialCode: m.materialCode || '',
        po: m.poNumber || '',
        imd: this.getDisplayIMD(m),
        location: this.primaryLocationDisplay(m.location),
        target: a.target,
        direction: a.direction,
        qty,
        currentValue: current,
        expectedValue: expected,
        note: a.note.trim(),
        status: 'pending',
        by,
        at: firebase.default.firestore.FieldValue.serverTimestamp()
      });
      let zaloOk = true;
      try {
        await this.invStockReport.notify({
          factory: this.selectedFactory,
          materialCode: String(m.materialCode || ''),
          po: String(m.poNumber || ''),
          imd: this.getDisplayIMD(m),
          stock: this.formatNumber(this.calculateCurrentStock(m)),
          location: this.primaryLocationDisplay(m.location),
          status: `Cần ${dirLabel.toLowerCase()} ${targetLabel.toLowerCase()} ${this.formatNumber(qty)}`,
          reportedBy: by,
          detail: `Đề nghị ${dirLabel.toLowerCase()} ${targetLabel.toLowerCase()} ${this.formatNumber(qty)} `
            + `(${this.formatNumber(current)} → ${this.formatNumber(expected)}) để khớp tồn.`
            + (a.note.trim() ? `\nGhi chú: ${a.note.trim()}` : '')
            + '\nDuyệt tại Materials → More → Danh mục điều chỉnh.'
        });
      } catch (e) {
        console.warn('submitInvAdjust zalo:', e);
        zaloOk = false;
      }
      a.ok = true;
      a.msg = zaloOk
        ? '✅ Đã gửi — bot Zalo đã báo nhóm Quản lý kho. Chờ duyệt ở More → Danh mục điều chỉnh.'
        : '✅ Đã lưu đề nghị (chờ duyệt). Zalo chưa gửi được tới nhóm Quản lý kho.';
    } catch (e: any) {
      console.error('submitInvAdjust:', e);
      a.msg = '❌ Không gửi được: ' + (e?.message || e);
    } finally {
      a.busy = false;
      this.cdr.detectChanges();
    }
  }

  // ===== Bấm ô Tồn kho (chi tiết mục) → đề nghị số tồn mới → duyệt ở Materials → More → Danh mục điều chỉnh =====
  kkStockPropose: { material: InventoryMaterial; current: number; next: number | null; note: string; msg: string } | null = null;

  openKkStockPropose(m: InventoryMaterial): void {
    if (!this.canEdit || !m?.id || this.denyAction('invAdjustRequest')) return;
    this.kkStockPropose = { material: m, current: this.calculateCurrentStock(m), next: null, note: '', msg: '' };
    setTimeout(() => (document.getElementById('kk-stock-new') as HTMLInputElement | null)?.focus(), 50);
  }

  /** Số mới − tồn hiện tại; 0 khi chưa nhập / không đổi. */
  kkStockProposeDelta(): number {
    const p = this.kkStockPropose;
    if (!p || p.next == null || String(p.next) === '') return 0;
    const next = Number(p.next);
    if (!Number.isFinite(next) || next < 0) return 0;
    return Math.round((next - p.current) * 10000) / 10000;
  }

  /** Gửi bằng luồng Báo cáo điều chỉnh tồn có sẵn (Tồn cuối, Tăng/Giảm phần chênh) — lưu đề nghị + Zalo nhóm Quản lý kho. */
  async submitKkStockPropose(): Promise<void> {
    const p = this.kkStockPropose;
    const delta = this.kkStockProposeDelta();
    if (!p) return;
    if (!delta) {
      p.msg = 'Nhập số tồn mới khác số hiện tại (≥ 0).';
      return;
    }
    const next = Number(p.next);
    this.kkStockPropose = null;
    this.invAdjust = {
      material: p.material,
      target: 'closing',
      direction: delta > 0 ? 'inc' : 'dec',
      qty: Math.abs(delta),
      note: `Đề nghị số tồn mới ${this.formatNumber(next)} (đang ${this.formatNumber(p.current)})` + (p.note.trim() ? ` · ${p.note.trim()}` : ''),
      busy: false,
      msg: '',
      ok: false
    };
    await this.submitInvAdjust();

  }

  // --- More → Danh mục điều chỉnh (pass 2026) ---
  showInvAdjustList = false;
  invAdjustUnlocked = false;
  invAdjustPass = '';
  invAdjustPassError = '';
  invAdjustRows: Array<{
    id: string; materialId: string; materialCode: string; po: string; imd: string; location: string;
    target: string; direction: string; qty: number; currentValue: number; expectedValue: number;
    note: string; by: string; at: Date | null; newPo: string;
  }> = [];
  invAdjustLoading = false;
  invAdjustError = '';
  invAdjustBusyId: string | null = null;

  openInvAdjustList(): void {
    if (this.denyAction('invAdjustApprove')) return;
    this.closeMorePopup();
    this.showInvAdjustList = true;
    this.invAdjustPass = '';
    this.invAdjustPassError = '';
    if (this.invAdjustUnlocked) void this.loadInvAdjustRows();
    else setTimeout(() => (document.getElementById('inv-adjust-pass') as HTMLInputElement | null)?.focus(), 50);
  }

  unlockInvAdjustList(): void {
    if (String(this.invAdjustPass || '').trim() !== String(this.matrixRules['invAdjustPass'] || '').trim()) {
      this.invAdjustPassError = 'Sai mật khẩu.';
      return;
    }
    this.invAdjustUnlocked = true;
    this.invAdjustPass = '';
    this.invAdjustPassError = '';
    void this.loadInvAdjustRows();
  }

  async loadInvAdjustRows(): Promise<void> {
    this.invAdjustLoading = true;
    this.invAdjustError = '';
    this.cdr.detectChanges();
    try {
      const snap = await this.firestore.firestore.collection(MaterialsComponent.INV_ADJUST_COL)
        .where('factory', '==', this.selectedFactory)
        .where('status', '==', 'pending')
        .get();
      this.invAdjustRows = snap.docs.map((d) => {
        const x = d.data() as any;
        return {
          id: d.id,
          materialId: String(x.materialId || ''),
          materialCode: String(x.materialCode || ''),
          po: String(x.po || ''),
          imd: String(x.imd || ''),
          location: String(x.location || ''),
          target: String(x.target || ''),
          direction: String(x.direction || ''),
          qty: Number(x.qty) || 0,
          currentValue: Number(x.currentValue) || 0,
          expectedValue: Number(x.expectedValue) || 0,
          note: String(x.note || ''),
          by: String(x.by || ''),
          at: x.at?.toDate ? x.at.toDate() : null,
          newPo: String(x.newPo || '')
        };
      }).sort((a, b) => (b.at?.getTime() || 0) - (a.at?.getTime() || 0));
      const ids = new Set(this.invAdjustRows.map((r) => r.id));
      this.invAdjustSel = new Set(Array.from(this.invAdjustSel).filter((id) => ids.has(id)));
    } catch (e: any) {
      console.error('loadInvAdjustRows:', e);
      this.invAdjustError = 'Không đọc được danh mục: ' + (e?.message || e);
    } finally {
      this.invAdjustLoading = false;
      this.cdr.detectChanges();
    }
  }

  /** Câu hỏi xác nhận khi duyệt 1 đề nghị. */
  private invAdjustConfirmText(row: (typeof this.invAdjustRows)[number]): string {
    if (row.target === 'delete') {
      return `Duyệt XÓA dòng tồn ${row.materialCode} · PO ${row.po || '—'} · IMD ${row.imd || '—'} · tồn ${this.formatNumber(row.currentValue)}?\n`
        + `Dòng vào Danh mục Ẩn (More), khôi phục được trong ${this.hiddenRetentionDays} ngày.`;
    }
    if (row.target === 'po') return `Duyệt ĐỔI PO ${row.materialCode} · IMD ${row.imd || '—'}\n${row.po || '—'} → ${row.newPo}?`;
    return `Duyệt: ${this.invAdjustDirectionLabel(row.direction)} ${this.invAdjustTargetLabel(row.target)} ${this.formatNumber(row.qty)}\n`
      + `${row.materialCode} · PO ${row.po || '—'} · IMD ${row.imd || '—'}?`;
  }

  async approveInvAdjust(row: (typeof this.invAdjustRows)[number]): Promise<void> {
    if (this.denyAction('invAdjustApprove')) return;
    if (this.invAdjustBusyId || this.invAdjustBulkBusy) return;
    if (!confirm(this.invAdjustConfirmText(row))) return;
    this.invAdjustBusyId = row.id;
    this.cdr.detectChanges();
    try {
      appAlert('✅ ' + await this.applyInvAdjust(row));
    } catch (e: any) {
      console.error('approveInvAdjust:', e);
      appAlert('❌ Không duyệt được: ' + (e?.message || e));
    } finally {
      this.invAdjustBusyId = null;
      this.cdr.detectChanges();
    }
  }

  // --- Chọn nhiều → Duyệt đã chọn ---
  invAdjustSel = new Set<string>();
  invAdjustBulkBusy = false;
  invAdjustBulkDone = 0;

  invAdjustAllSelected(): boolean {
    return this.invAdjustRows.length > 0 && this.invAdjustRows.every((r) => this.invAdjustSel.has(r.id));
  }

  toggleInvAdjustAll(on: boolean): void {
    this.invAdjustSel = on ? new Set(this.invAdjustRows.map((r) => r.id)) : new Set();
  }

  toggleInvAdjustSel(id: string, on: boolean): void {
    if (on) this.invAdjustSel.add(id);
    else this.invAdjustSel.delete(id);
  }

  async approveInvAdjustSelected(): Promise<void> {
    if (this.denyAction('invAdjustApprove')) return;
    if (this.invAdjustBusyId || this.invAdjustBulkBusy) return;
    const rows = this.invAdjustRows.filter((r) => this.invAdjustSel.has(r.id));
    if (!rows.length) return;
    const n = (t: string) => rows.filter((r) => r.target === t).length;
    const parts = [
      n('delete') && `xóa (ẩn) ${n('delete')} dòng`,
      n('po') && `đổi PO ${n('po')}`,
      (rows.length - n('delete') - n('po')) && `tăng/giảm tồn ${rows.length - n('delete') - n('po')}`
    ].filter(Boolean).join(', ');
    if (!confirm(`Duyệt ${rows.length} đề nghị đã chọn (${parts})?\nDòng xóa vào Danh mục Ẩn, khôi phục được trong ${this.hiddenRetentionDays} ngày.`)) return;
    this.invAdjustBulkBusy = true;
    this.invAdjustBulkDone = 0;
    this.cdr.detectChanges();
    const fails: string[] = [];
    try {
      for (const row of rows) {
        this.invAdjustBusyId = row.id;
        this.cdr.detectChanges();
        try {
          await this.applyInvAdjust(row);
          this.invAdjustSel.delete(row.id);
        } catch (e: any) {
          console.error('approveInvAdjustSelected:', e);
          fails.push(`${row.materialCode} · PO ${row.po || '—'}: ${e?.message || e}`);
        }
        this.invAdjustBulkDone += 1;
      }
    } finally {
      this.invAdjustBusyId = null;
      this.invAdjustBulkBusy = false;
      this.cdr.detectChanges();
    }
    const ok = rows.length - fails.length;
    appAlert(`✅ Đã duyệt ${ok}/${rows.length} đề nghị.`
      + (fails.length ? `\n❌ Không duyệt được ${fails.length}:\n` + fails.slice(0, 15).join('\n') + (fails.length > 15 ? `\n… và ${fails.length - 15} đề nghị khác` : '') : ''));
  }

  /** Duyệt 1 đề nghị (không hỏi / không alert) — lỗi thì throw; trả câu báo thành công. */
  private async applyInvAdjust(row: (typeof this.invAdjustRows)[number]): Promise<string> {
    if (row.target === 'delete') return this.applyInvDeleteRequest(row);
    if (row.target === 'po') return this.applyInvPoChange(row);
    const by = await this.getMaterialsOtpRequester();
    const db = this.firestore.firestore;
    const matRef = db.collection('inventory-materials').doc(row.materialId);
    const reqRef = db.collection(MaterialsComponent.INV_ADJUST_COL).doc(row.id);
    const field = row.target === 'opening' ? 'openingStock' : 'quantity';
    const delta = row.direction === 'inc' ? row.qty : -row.qty;
    let before = 0;
    let after = 0;
    await db.runTransaction(async (tx) => {
      const [matSnap, reqSnap] = await Promise.all([tx.get(matRef), tx.get(reqRef)]);
      if (!reqSnap.exists || (reqSnap.data() as any)?.status !== 'pending') throw new Error('Đề nghị đã được xử lý hoặc đã xóa.');
      if (!matSnap.exists) throw new Error('Dòng tồn không còn trên hệ thống.');
      before = Number((matSnap.data() as any)?.[field]) || 0;
      after = Math.round((before + delta) * 10000) / 10000;
      if (after < 0) {
        throw new Error(`${field === 'openingStock' ? 'Tồn đầu' : 'NK'} sẽ âm (${this.formatNumber(before)} → ${this.formatNumber(after)}).`);
      }
      const now = firebase.default.firestore.FieldValue.serverTimestamp();
      tx.update(matRef, { [field]: after, updatedAt: now });
      tx.update(reqRef, { status: 'approved', approvedBy: by, approvedAt: now, field, fieldBefore: before, fieldAfter: after });
    });
    const local = (this.inventoryMaterials || []).find((m) => m.id === row.materialId);
    if (local) (local as any)[field] = after;
    this.invalidateKkTypeViewCache();
    this.invAdjustRows = this.invAdjustRows.filter((r) => r.id !== row.id);
    return `Đã duyệt: ${this.invAdjustDirectionLabel(row.direction)} ${this.invAdjustTargetLabel(row.target)} ${this.formatNumber(row.qty)} cho ${row.materialCode}.`;
  }

  /** Duyệt "Đề nghị xóa": ẩn dòng tồn (vào Danh mục Ẩn, khôi phục được trong hạn) — không xóa cứng. */
  private async applyInvDeleteRequest(row: (typeof this.invAdjustRows)[number]): Promise<string> {
    const db = this.firestore.firestore;
    const reqRef = db.collection(MaterialsComponent.INV_ADJUST_COL).doc(row.id);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists || (reqSnap.data() as any)?.status !== 'pending') throw new Error('Đề nghị đã được xử lý hoặc đã xóa.');
    const n = await this.hideInventoryDocsByIds([row.materialId], 'delete-request');
    if (!n) throw new Error('Dòng tồn không còn trên hệ thống.');
    const by = await this.getMaterialsOtpRequester();
    await reqRef.update({
      status: 'approved',
      approvedBy: by,
      approvedAt: firebase.default.firestore.FieldValue.serverTimestamp()
    });
    this.removeInventoryByIds(new Set([row.materialId]));
    this.invalidateKkTypeViewCache();
    this.invAdjustRows = this.invAdjustRows.filter((r) => r.id !== row.id);
    return `Đã xóa (ẩn) dòng ${row.materialCode} · PO ${row.po || '—'}. Khôi phục ở More → Danh mục Ẩn.`;
  }

  /** Duyệt "Đổi PO" (Tự sửa Check PO: PO web gõ khác LinkQ, cùng lượng) — chỉ đổi poNumber của dòng. */
  private async applyInvPoChange(row: (typeof this.invAdjustRows)[number]): Promise<string> {
    if (!row.newPo) throw new Error('Đề nghị thiếu PO mới.');
    const by = await this.getMaterialsOtpRequester();
    const db = this.firestore.firestore;
    const matRef = db.collection('inventory-materials').doc(row.materialId);
    const reqRef = db.collection(MaterialsComponent.INV_ADJUST_COL).doc(row.id);
    await db.runTransaction(async (tx) => {
      const [matSnap, reqSnap] = await Promise.all([tx.get(matRef), tx.get(reqRef)]);
      if (!reqSnap.exists || (reqSnap.data() as any)?.status !== 'pending') throw new Error('Đề nghị đã được xử lý hoặc đã xóa.');
      if (!matSnap.exists) throw new Error('Dòng tồn không còn trên hệ thống.');
      const before = String((matSnap.data() as any)?.poNumber || '');
      const now = firebase.default.firestore.FieldValue.serverTimestamp();
      tx.update(matRef, { poNumber: row.newPo, updatedAt: now });
      tx.update(reqRef, { status: 'approved', approvedBy: by, approvedAt: now, field: 'poNumber', fieldBefore: before, fieldAfter: row.newPo });
    });
    const local = (this.inventoryMaterials || []).find((m) => m.id === row.materialId);
    if (local) local.poNumber = row.newPo;
    this.invalidateKkTypeViewCache();
    this.invAdjustRows = this.invAdjustRows.filter((r) => r.id !== row.id);
    return `Đã đổi PO ${row.materialCode}: ${row.po || '—'} → ${row.newPo}.`;
  }

  async deleteInvAdjust(row: (typeof this.invAdjustRows)[number]): Promise<void> {
    if (this.denyAction('invAdjustApprove')) return;
    if (this.invAdjustBusyId) return;
    if (!confirm(`Xóa đề nghị điều chỉnh của ${row.materialCode} · PO ${row.po || '—'}?`)) return;
    this.invAdjustBusyId = row.id;
    this.cdr.detectChanges();
    try {
      await this.firestore.firestore.collection(MaterialsComponent.INV_ADJUST_COL).doc(row.id).delete();
      this.invAdjustRows = this.invAdjustRows.filter((r) => r.id !== row.id);
    } catch (e: any) {
      console.error('deleteInvAdjust:', e);
      appAlert('❌ Không xóa được: ' + (e?.message || e));
    } finally {
      this.invAdjustBusyId = null;
      this.cdr.detectChanges();
    }
  }

  /** Mã "xài hết" theo Kế hoạch NVL (tab Report) — tô cam. Chỉ trang Quản lý NVL ghi đè. */
  isPlanUsedUp(_code: string | null | undefined): boolean {
    return false;
  }

  planUsedUpTitle(_code: string | null | undefined): string {
    return '';
  }

  /** Mã nằm trong danh sách kiểm 100% (tab Inbound). */
  isK100(code: string | null | undefined): boolean {
    return !!this.sxxkSuspect.get(code);
  }

  k100Title(code: string | null | undefined): string {
    const s = this.sxxkSuspect.get(code);
    if (!s) return '';
    return s.source === 'manual' ? `Kiểm 100% (nhập tay): ${s.reason}` : `Kiểm 100%: ${s.n} lần xuất bổ sung (SXXK) — ${s.reason}`;
  }

  /** Cột Cảnh báo (chi tiết box loại hàng). */
  readonly kkWarningOptions: Array<{ value: string; label: string }> = [
    { value: 'nghi-ngo-thieu', label: 'Nghi ngờ thiếu' },
    { value: 'chua-tim-ra', label: 'Chưa tìm ra' },
    { value: 'ncc-giao-thieu', label: 'NCC giao thiếu' },
    { value: 'lech-linkq-du', label: 'Lệch LinkQ (Dư)' },
    { value: 'du-sai-so', label: 'Dư sai số' },
    { value: 'xoa', label: 'Xóa' },
    { value: 'de-nghi-xoa', label: 'Đề nghị xóa' }
  ];

  kkWarningOf(line: InventoryMaterial): string {
    return String((line as any)?.kkWarning || '');
  }

  /**
   * Aging theo PO (không theo IMD): 8 số cuối của PO, 4 số đầu là MMYY.
   * KZPO0219/0001 / PO0219/0001 → 02/2019. Tính số tháng tới hôm nay, làm tròn.
   */
  private kkPoAgingCache = new Map<string, { months: number; label: string } | null>();

  private kkPoAging(po: string | null | undefined): { months: number; label: string } | null {
    const key = String(po || '').trim().toUpperCase();
    if (!key) return null;
    if (this.kkPoAgingCache.has(key)) return this.kkPoAgingCache.get(key) || null;
    let out: { months: number; label: string } | null = null;
    const digits = key.replace(/\D/g, '');
    if (digits.length >= 8) {
      const last8 = digits.slice(-8);
      const mm = Number(last8.slice(0, 2));
      const yy = Number(last8.slice(2, 4));
      if (mm >= 1 && mm <= 12) {
        const start = new Date(2000 + yy, mm - 1, 1).getTime();
        const months = Math.max(0, Math.round((Date.now() - start) / (30.4375 * 24 * 3600 * 1000)));
        out = { months, label: `${String(mm).padStart(2, '0')}/${2000 + yy}` };
      }
    }
    this.kkPoAgingCache.set(key, out);
    return out;
  }

  /** Từ IMD này trở đi Aging tính theo IMD (có số lẻ); trước đó tính theo PO (làm tròn tháng). */
  private get kkAgingImdFromMs(): number {
    return matrixDateMs(this.matrixRules['kkAgingImdFrom']) || new Date(2026, 0, 1).getTime();
  }

  /** Dòng tồn Aging dưới 1 tháng: hệ thống coi như đã KK ("Không cần kiểm"), không tính vào Đã KK / Tổng. */
  isKkAgingExempt(m: InventoryMaterial | null | undefined): boolean {
    // Đã bỏ quy tắc "Aging dưới 1 tháng không cần kiểm" (05/11/2026): mọi dòng đều phải kiểm.
    void m;
    return false;
  }

  // ───── Bộ phận: số bộ phận của mã (2 / 3 / 4) — lưu Danh mục NVL, hiện khi scan Outbound ─────
  readonly boPhanOptions = [2, 3, 4];
  private kkBoPhanMap: Map<string, number> | null = null;
  private kkBoPhanLoading = false;

  kkBoPhanOf(code: unknown): number {
    const c = String(code ?? '').trim().toUpperCase();
    if (!this.kkBoPhanMap && !this.kkBoPhanLoading) {
      this.kkBoPhanLoading = true;
      void this.nvlCatalogFull.listAll().then((items) => {
        this.kkBoPhanMap = new Map(items.filter((i) => Number(i.boPhan) > 0).map((i) => [i.materialCode, Number(i.boPhan)]));
        this.cdr.markForCheck();
      }).catch(() => { this.kkBoPhanMap = new Map(); }).finally(() => { this.kkBoPhanLoading = false; });
    }
    return this.kkBoPhanMap?.get(c) || 0;
  }

  async setKkBoPhan(code: unknown, v: unknown): Promise<void> {
    const c = String(code ?? '').trim().toUpperCase();
    if (!c || !this.canEdit) return;
    const n = Math.max(0, Math.round(Number(v) || 0));
    const prev = this.kkBoPhanOf(c);
    if (!this.kkBoPhanMap) this.kkBoPhanMap = new Map();
    if (n > 0) this.kkBoPhanMap.set(c, n); else this.kkBoPhanMap.delete(c);
    try {
      const u = await this.afAuthWeek.currentUser;
      await this.nvlCatalogFull.update(c, { boPhan: n }, String(u?.email || '').split('@')[0].toUpperCase());
    } catch (e: any) {
      if (prev > 0) this.kkBoPhanMap.set(c, prev); else this.kkBoPhanMap.delete(c);
      appAlert('Không lưu được Bộ phận: ' + (e?.message || e));
    } finally {
      this.cdr.markForCheck();
    }
  }

  // ───── Vừa xuất kho, chỉ còn 1 bag: tô sáng + lọc + GW bag ─────
  /** Số ngày tính là "vừa xuất" */
  readonly kkRecentExportDays = 7;
  /** Lọc: chỉ dòng vừa xuất còn 1 bag */
  kkLastBagOnly = false;
  kkRecentExportLoading = false;
  /** Khóa MÃ|PO|IMD và MÃ|PO có xuất kho trong kkRecentExportDays ngày (theo nhà máy) */
  private kkRecentExportKeys: Set<string> | null = null;
  private kkRecentExportFactory = '';
  private kkRecentExportAt = 0;
  /** GW bịch CL đã cân lúc tách tem lẻ — khóa id dòng tồn */
  private kkLastBagClGw = new Map<string, { qty: number; gw: number } | null>();
  private kkGwBagByCode = new Map<string, number>();
  private kkGwBagTried = new Set<string>();

  private kkRecentKey(code: unknown, po: unknown, imd?: unknown): string {
    const c = String(code ?? '').trim().toUpperCase();
    const p = String(po ?? '').trim().replace(/\s+/g, '').toUpperCase();
    return imd === undefined ? `${c}|${p}` : `${c}|${p}|${String(imd ?? '').trim()}`;
  }

  /** Đọc phiếu xuất kkRecentExportDays ngày gần nhất (1 lần / 10 phút / nhà máy). */
  async ensureKkRecentExports(force = false): Promise<void> {
    const fac = String(this.selectedFactory || '');
    if (this.kkRecentExportLoading) return;
    if (!force && this.kkRecentExportKeys && this.kkRecentExportFactory === fac && Date.now() - this.kkRecentExportAt < 10 * 60000) return;
    this.kkRecentExportLoading = true;
    try {
      const since = new Date(Date.now() - this.kkRecentExportDays * 86400000);
      const snap = await this.firestore.firestore.collection('outbound-materials').where('exportDate', '>=', since).get();
      const keys = new Set<string>();
      snap.forEach((doc) => {
        const d = doc.data() as any;
        if (String(d.factory || '') !== fac) return;
        if (!(Number(d.exportQuantity ?? d.quantity) > 0)) return;
        const imd = String(d.importDate ?? d.batchNumber ?? '').trim().slice(0, 8);
        keys.add(this.kkRecentKey(d.materialCode, d.poNumber));
        if (/^\d{8}$/.test(imd)) keys.add(this.kkRecentKey(d.materialCode, d.poNumber, imd));
      });
      this.kkRecentExportKeys = keys;
      this.kkRecentExportFactory = fac;
      this.kkRecentExportAt = Date.now();
      this.kkTypeDetailSig = '';
      this.cdr.markForCheck();
    } catch (e) {
      console.warn('[KK] Không đọc được phiếu xuất gần đây:', e);
    } finally {
      this.kkRecentExportLoading = false;
    }
  }

  /** Dòng vừa xuất kho (7 ngày) mà tồn chỉ còn 1 bag. */
  isKkRecentLastBag(m: InventoryMaterial | null | undefined): boolean {
    if (!m || !this.kkRecentExportKeys || this.kkRecentExportFactory !== String(this.selectedFactory || '')) return false;
    if (!(this.calculateCurrentStock(m) > 0) || this.getKkRollsCount(m) !== 1) return false;
    const imd = String(this.getDisplayIMD(m) || '').trim().slice(0, 8);
    return this.kkRecentExportKeys.has(this.kkRecentKey(m.materialCode, m.poNumber, imd))
      || this.kkRecentExportKeys.has(this.kkRecentKey(m.materialCode, m.poNumber));
  }

  toggleKkLastBagOnly(): void {
    this.kkLastBagOnly = !this.kkLastBagOnly;
    void this.ensureKkRecentExports(this.kkLastBagOnly);
    this.kkTypeDetailSig = '';
    this.cdr.markForCheck();
  }

  /**
   * GW (gram) của bag còn lại: bịch CL đã cân lúc tách tem lẻ → số cân; bag nguyên → GW bag danh mục;
   * bag lẻ chưa cân → ước theo tỷ lệ (GW bag × tồn ÷ Standard).
   */
  kkLastBagGw(m: InventoryMaterial): { gw: number; how: 'cân' | 'nguyên' | 'ước' } | null {
    const code = String(m.materialCode || '').trim().toUpperCase();
    const stock = this.calculateCurrentStock(m);
    const id = String(m.id || this.kkLineIdentityKey(m));
    if (!this.kkLastBagClGw.has(id)) {
      this.kkLastBagClGw.set(id, null);
      const imd = String(this.getDisplayIMD(m) || '').trim();
      void this.temLeCl.getState(this.selectedFactory, code, String(m.poNumber || '').trim(), imd)
        .then((st) => {
          if (st?.clActive && Number(st.clGw) > 0) {
            this.kkLastBagClGw.set(id, { qty: Number(st.clQty) || 0, gw: Number(st.clGw) });
            this.cdr.markForCheck();
          }
        })
        .catch(() => undefined);
    }
    const cl = this.kkLastBagClGw.get(id);
    if (cl && Math.abs(cl.qty - stock) < 0.01) return { gw: cl.gw, how: 'cân' };
    if (!this.kkGwBagTried.has(code)) {
      this.kkGwBagTried.add(code);
      void this.nvlCatalogFull.getByCode(code).then((it: any) => {
        const g = Number(it?.gwBag) || 0;
        if (g > 0) { this.kkGwBagByCode.set(code, g); this.cdr.markForCheck(); }
      }).catch(() => undefined);
    }
    const full = this.kkGwBagByCode.get(code) || 0;
    if (!(full > 0)) return null;
    const sp = this.getEffectiveStandardPacking(m);
    if (!(sp > 0) || Math.abs(stock - sp) < 0.01) return { gw: full, how: 'nguyên' };
    return { gw: Math.round((full * stock) / sp), how: 'ước' };
  }

  protected kkAgingRaw(m: InventoryMaterial | null | undefined): { months: number; by: 'IMD' | 'PO'; label: string } | null {
    if (!m) return null;
    const imd = m.importDate instanceof Date && !isNaN(m.importDate.getTime()) ? m.importDate.getTime() : 0;
    let out: { months: number; by: 'IMD' | 'PO'; label: string } | null = null;
    if (imd && imd >= this.kkAgingImdFromMs) {
      const months = Math.round(((Date.now() - imd) / (30.4375 * 24 * 3600 * 1000)) * 10) / 10;
      out = { months, by: 'IMD', label: `IMD ${this.getDisplayIMD(m)}` };
    } else {
      const po = this.kkPoAging(m.poNumber);
      if (po) out = { months: po.months, by: 'PO', label: `PO tháng ${po.label}` };
    }
    return out;
  }
  kkTypeLinkQLabel = '';
  protected kkTypeLinkQMap: Map<string, number> | null = null;

  /** PXK chưa xuất theo mã (Work Order 7 ngày chưa Done, web chưa scan xuất) — chỉ tính khi bấm nút. */
  kkPendingPxk: Map<string, PendingPxkInfo> | null = null;

  /** Tồn web theo mã (cộng mọi dòng PO của mã trong box / mục đang mở) — memo theo dữ liệu chi tiết. */
  private kkWebByCodeMemo: { src: unknown; map: Map<string, number> } = { src: null, map: new Map() };

  protected kkWebTotalOfCode(code: string): number {
    const all = this.kkTypeDetailAll;
    if (this.kkWebByCodeMemo.src !== all) {
      const map = new Map<string, number>();
      for (const m of all) {
        const c = String(m.materialCode || '').trim().toUpperCase();
        if (c) map.set(c, (map.get(c) || 0) + this.calculateCurrentStock(m));
      }
      this.kkWebByCodeMemo = { src: all, map };
    }
    return this.kkWebByCodeMemo.map.get(code) || 0;
  }

  /** Chênh lệch = Tồn web − (Tồn LinkQ + PXK chưa xuất), tính theo tổng mã. null khi chưa có LinkQ. */
  kkPxkDiff(code: string | null | undefined): number | null {
    const c = String(code || '').trim().toUpperCase();
    if (!c || !this.kkTypeLinkQMap) return null;
    const lq = Number(this.kkTypeLinkQMap.get(this.normalizeTieuHuyCode(c))) || 0;
    const pxk = this.kkPendingPxk?.get(c)?.qty || 0;
    return Math.round((this.kkWebTotalOfCode(c) - (lq + pxk)) * 10000) / 10000;
  }

  /** Chênh lệch của 1 dòng (lọc Chênh lệch). Mặc định theo tổng mã; Quản lý NL tính theo dòng / PO. */
  kkPxkDiffOf(m: InventoryMaterial): number | null {
    return this.kkPxkDiff(m.materialCode);
  }

  protected restoreKkScanOpSession(): void {
    try {
      const raw = sessionStorage.getItem(MaterialsComponent.KK_SCAN_OP_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { employeeId?: string; until?: number };
      const id = String(parsed?.employeeId || '').trim().toUpperCase();
      const until = Number(parsed?.until || 0);
      if (!/^ASP\d{4}$/.test(id) || !until || Date.now() >= until) {
        sessionStorage.removeItem(MaterialsComponent.KK_SCAN_OP_KEY);
        return;
      }
      this.kkOperatorIdCache = id;
      this.kkTypeScanOperator = id;
      this.kkTypeScanOpUntil = new Date(until);
      this.scheduleKkScanOpExpiry();
    } catch {
      sessionStorage.removeItem(MaterialsComponent.KK_SCAN_OP_KEY);
    }
  }

  protected scheduleKkScanOpExpiry(): void {
    if (this.kkScanOpTimer) {
      clearTimeout(this.kkScanOpTimer);
      this.kkScanOpTimer = null;
    }
    if (!this.kkTypeScanOpUntil) return;
    const ms = Math.max(250, this.kkTypeScanOpUntil.getTime() - Date.now());
    this.kkScanOpTimer = setTimeout(() => this.checkKkScanOpExpiry(), Math.min(ms, 60000));
  }

  private checkKkScanOpExpiry(): boolean {
    if (!this.kkTypeScanOperator) return false;
    if (this.kkTypeScanOpUntil && Date.now() < this.kkTypeScanOpUntil.getTime()) {
      this.scheduleKkScanOpExpiry();
      return true;
    }
    this.kkTypeScanOperator = '';
    this.kkTypeScanOperatorInput = '';
    this.kkTypeScanOpUntil = null;
    this.kkOperatorIdCache = null;
    sessionStorage.removeItem(MaterialsComponent.KK_SCAN_OP_KEY);
    if (this.kkScanOpTimer) {
      clearTimeout(this.kkScanOpTimer);
      this.kkScanOpTimer = null;
    }
    if (this.showKkTypeScanModal) {
      this.kkTypeScanStep = 'operator';
      appAlert('Hết phiên làm việc (12:00 / 17:00 / 20:00). Vui lòng quét lại mã nhân viên.');
      this.cdr.detectChanges();
      this.focusKkTypeScanInput('kkTypeScanOperatorInput');
    }
    return false;
  }

  protected focusKkTypeScanInput(id: string, retry = 0): void {
    if (!this.showKkTypeScanModal) return;
    setTimeout(() => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el && !el.disabled) {
        this.bindKkTypeScanHidInput(id, el);
        if (id !== 'kkTypeScanOperatorInput') this.suppressVirtualKeyboard(el);
        el.focus({ preventScroll: true });
        return;
      }
      if (retry < 8) this.focusKkTypeScanInput(id, retry + 1);
    }, retry === 0 ? 0 : 50);
  }

  /**
   * Gắn máy quét PDA (HID) cho 3 ô Kiểm tra KK theo loại hàng — dùng `bindHidScanInput`
   * (nghe cả `input` native, không chỉ `keydown`) thay cho `attachKkDocScan` cũ (chỉ
   * nghe keydown + idle timeout 60ms tính từ ký tự đầu tiên → hay bị đọc thiếu/đọc gãy
   * khi tem QR dài hoặc thiết bị gõ có độ trễ giữa ký tự; cũng không bắt được trường hợp
   * PDA đẩy chữ qua composition/input thay vì keydown rời từng ký tự).
   * Idempotent — `bindHidScanInput` tự bỏ qua nếu element đã được gắn.
   */
  private bindKkTypeScanHidInput(id: string, el: HTMLInputElement): void {
    // Mã NV: nhập tay — không gắn HID auto-flush (tránh nuốt khi gõ)
    if (id === 'kkTypeScanOperatorInput') return;
    if (id === 'kkTypeScanLocationInput') {
      this.bindHidScanInput(
        el,
        (raw) => this.submitKkTypeScanLocation(undefined, raw),
        {
          idleMs: 220,
          minLenForIdleFlush: 4,
          // Chỉ flush khi đủ dạng kệ S/R (tránh cắt sớm 1–2 ký tự)
          shouldFlush: (raw) => {
            const t = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
            return /^[SR]\d{1,2}(?:-\d+(?:-\d+)?)?$/.test(t);
          }
        }
      );
    } else if (id === 'kkTypeScanQrInput') {
      this.bindHidScanInput(
        el,
        (raw, readMs) => this.enqueueKkTypeScanCode(raw, readMs),
        {
          idleMs: 200,
          minLenForIdleFlush: 12,
          // Tem NVL: Mã|PO|SL|IMD… — đủ ≥3 đoạn mới coi là xong (tránh cắt giữa chừng)
          shouldFlush: (raw) => {
            const t = String(raw || '').trim();
            const parts = t.split('|');
            return parts.length >= 3 && parts[0].trim().length >= 4;
          }
        }
      );
    }
  }

  /**
   * Máy scanner HID gõ rất nhanh. Không dùng ngModel / (keydown) Angular
   * vì mỗi ký tự kích hoạt change detection → mất chữ khi tem QR dài.
   * Gom native value, chỉ xử lý khi Enter hoặc hết burst.
   */
  protected bindHidScanInput(
    el: HTMLInputElement,
    onComplete: (raw: string, readMs: number) => void,
    opts?: { idleMs?: number; minLenForIdleFlush?: number; shouldFlush?: (raw: string) => boolean }
  ): void {
    if (!el || this.hidScanBound.has(el)) return;
    this.hidScanBound.add(el);
    const idleMs = opts?.idleMs ?? 0;
    const minLenForIdleFlush = opts?.minLenForIdleFlush ?? 20;
    const shouldFlush = opts?.shouldFlush;
    let burstStart = 0;
    const markBurst = () => {
      if (!burstStart) burstStart = performance.now();
    };
    const flush = (delay: number) => {
      const prev = this.hidScanTimers.get(el);
      if (prev) clearTimeout(prev);
      const t = setTimeout(() => {
        this.hidScanTimers.delete(el);
        const raw = String(el.value || '')
          .replace(/[\r\n\t]+/g, '')
          .replace(/[\u0000-\u001F]/g, '')
          .trim();
        const started = burstStart;
        burstStart = 0;
        if (!raw) return;
        el.value = '';
        const elapsed = started ? performance.now() - started : 0;
        const readMs = Math.max(0, Math.round(elapsed - delay));
        this.ngZone.run(() => onComplete(raw, readMs));
      }, delay);
      this.hidScanTimers.set(el, t);
    };
    this.ngZone.runOutsideAngular(() => {
      el.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          event.stopPropagation();
          flush(8);
          return;
        }
        if (event.key.length === 1 || event.key === 'Unidentified' || event.key === 'Process') {
          markBurst();
        }
      });
      el.addEventListener('input', () => {
        markBurst();
        if (/[\r\n]/.test(el.value)) {
          el.value = el.value.replace(/[\r\n]+/g, '');
          flush(8);
          return;
        }
        if (idleMs > 0) {
          const v = el.value || '';
          const ready = shouldFlush
            ? shouldFlush(v)
            : (v.includes('|') || v.length >= minLenForIdleFlush);
          if (ready) flush(idleMs);
        }
      });
    });
  }

  protected enqueueKkTypeScanCode(raw: string, readMs = 0): void {
    if (this.showKkTypeScanConfirm) {
      this.kkTypeScanBeep('err');
      return;
    }
    const v = String(raw || '').trim();
    if (!v) return;
    this.kkHidQrQueue.push({ raw: v, readMs: Math.max(0, readMs || 0) });
    void this.drainKkHidQrQueue();
  }

  formatScanMs(ms: number | null | undefined): string {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0) return '—';
    if (n < 1000) return `${Math.round(n)}ms`;
    return `${(n / 1000).toFixed(2)}s`;
  }

  private async drainKkHidQrQueue(): Promise<void> {
    if (this.kkHidQrDraining) return;
    if (this.showKkTypeScanConfirm) return;
    this.kkHidQrDraining = true;
    try {
      while (
        this.kkHidQrQueue.length &&
        this.showKkTypeScanModal &&
        this.kkTypeScanStep === 'codes' &&
        !this.showKkTypeScanConfirm
      ) {
        const next = this.kkHidQrQueue.shift();
        if (!next) break;
        await this.submitKkTypeScanCodeFromRaw(next.raw, next.readMs);
        // Sau 1 mã thành công → chờ Đồng ý, không drain tiếp
        if (this.showKkTypeScanConfirm) break;
      }
    } finally {
      this.kkHidQrDraining = false;
      if (
        !this.showKkTypeScanConfirm &&
        this.kkHidQrQueue.length &&
        this.showKkTypeScanModal &&
        this.kkTypeScanStep === 'codes'
      ) {
        void this.drainKkHidQrQueue();
      }
    }
  }

  private showKkTypeScanLocToast(
    code: string,
    location: string,
    opts?: { kind?: 'ok' | 'home' | 'over'; scanned?: string; ms?: number }
  ): void {
    if (this.kkTypeScanLocToastTimer) {
      clearTimeout(this.kkTypeScanLocToastTimer);
      this.kkTypeScanLocToastTimer = null;
    }
    this.kkTypeScanLocToast = {
      code,
      location,
      kind: opts?.kind || 'ok',
      scanned: opts?.scanned
    };
    this.cdr.detectChanges();
    const ms = opts?.ms ?? (opts?.kind === 'home' || opts?.kind === 'over' ? 3200 : 1800);
    this.kkTypeScanLocToastTimer = setTimeout(() => {
      this.kkTypeScanLocToast = null;
      this.kkTypeScanLocToastTimer = null;
      if (this.showKkTypeScanModal) this.cdr.detectChanges();
    }, ms);
  }

  private normalizeKkScanLocation(raw: string): string {
    let loc = stripJ5Prefix(String(raw || ''))
      .replace(/[\u0000-\u001F]/g, '')
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '');
    if (!loc) return '';
    if (loc.includes('|')) {
      const first = loc.split('|').map((p) => p.trim()).find(Boolean) || '';
      if (/^B\d{5,}/.test(first) || /^ASP\d{4}$/.test(first)) return '';
      loc = first;
    }
    loc = loc.replace(/^(J5|J|00|WH3|ASM3)(?=-|S\d|R\d)/, '');
    loc = loc.replace(/^[-_./]+/, '');
    loc = loc.replace(/^S(\d{1,2})[._/](\d+)[._/](\d+)/, 'S$1-$2-$3');
    loc = loc.replace(/^R(\d{1,2})[._/](\d+)[._/](\d+)/, 'R$1-$2-$3');
    loc = loc.replace(/^([SR])(\d{1,2})[._/](\d+)$/, '$1$2-$3');
    // S07-1-3 / R10-2-1 — mâm kệ 3 phần
    const khoMatS = loc.match(/^S(\d{1,2})-(\d+)-(\d+)/);
    if (khoMatS) {
      return `S${String(Number(khoMatS[1])).padStart(2, '0')}-${Number(khoMatS[2])}-${Number(khoMatS[3])}`;
    }
    const khoMatR = loc.match(/^R(\d{1,2})-(\d+)-(\d+)/);
    if (khoMatR) {
      return `R${String(Number(khoMatR[1])).padStart(2, '0')}-${Number(khoMatR[2])}-${Number(khoMatR[3])}`;
    }
    // R10-1 / S07-30 — tem theo số thứ tự pallet (pallet-id)
    const aisleSeq = loc.match(/^([SR])(\d{1,2})-(\d+)$/);
    if (aisleSeq) {
      return `${aisleSeq[1]}${String(Number(aisleSeq[2])).padStart(2, '0')}-${Number(aisleSeq[3])}`;
    }
    const aisleS = loc.match(/^S(\d{1,2})$/);
    if (aisleS) return `S${String(Number(aisleS[1])).padStart(2, '0')}`;
    const aisleR = loc.match(/^R(\d{1,2})$/);
    if (aisleR) return `R${String(Number(aisleR[1])).padStart(2, '0')}`;
    return loc;
  }

  /**
   * Tem kệ hợp lệ khi scan: bắt buộc S/R + dãy + dấu - + số
   * (vd S16-1-1, R10-1, S07-2). Không nhận S01 / R03 trần.
   */
  private kkScanIsSrShelfLocation(loc: string): boolean {
    const n = this.normalizeKkScanLocation(loc) || String(loc || '').trim().toUpperCase();
    return /^[SR]\d{2}-\d+(?:-\d+)?$/.test(n);
  }

  /** Locker / Backup: mọi mã đều được đổi vào, không ép về vị trí home. */
  private kkScanIsFreeLocation(loc: string): boolean {
    const n = this.normalizeKkScanLocation(loc) || String(loc || '').trim().toUpperCase();
    const bare = (this.stripDoiKhoWhPrefix(n) || n).replace(/\s+/g, '').toUpperCase();
    return isLockerPrefixLocation(bare) || /^BACKUP(?:-?\d+)?$/.test(bare);
  }

  private kkScanAisleOf(loc: string): string {
    const n = this.normalizeKkScanLocation(loc) || String(loc || '').trim().toUpperCase();
    const m = n.match(/^([SR]\d{2})(?:-|$)/);
    return m ? m[1] : n;
  }

  /** Kệ kho J dạng Sxx / Rxx (xx là số 1–99). J5, TRA, D1… không tính. */
  private kkScanIsJShelfLocation(loc: string): boolean {
    const n = this.normalizeKkScanLocation(loc)
      || String(loc || '').trim().toUpperCase().replace(/\s+/g, '');
    return isJWarehouseLocation(n);
  }

  private static readonly KK_LOC_WRONG = 'THAO TÁC SAI';

  private kkScanIsWrongLocation(loc: string): boolean {
    const u = String(loc || '').trim().toUpperCase().replace(/\s+/g, ' ');
    return u === MaterialsComponent.KK_LOC_WRONG || u === 'THAOTACSAI' || u.includes('THAO TÁC SAI');
  }

  private kkScanIsStagingLocation(loc: string): boolean {
    const p = this.primaryLocationDisplay(loc);
    const u = String(p || '').trim().toUpperCase();
    if (this.kkScanIsWrongLocation(u)) return true;
    return !u || u === '-' || /^(F62|F62TRA|IQC|NG)$/.test(u);
  }

  private kkScanLocationsEqual(a: string, b: string): boolean {
    const x = this.normalizeKkScanLocation(a) || String(a || '').trim().toUpperCase();
    const y = this.normalizeKkScanLocation(b) || String(b || '').trim().toUpperCase();
    return !!x && !!y && x === y;
  }

  /** Không bị dọn hàng loạt: Locker/Box, IQC, PASS, Hàng lỗi, TRA, hoặc S/R + dãy + dấu - + số. */
  private isKkPersistentLocation(loc: string): boolean {
    const raw = String(loc || '').trim().toUpperCase();
    if (!raw || this.kkScanIsWrongLocation(raw)) return false;
    const bare = (this.stripDoiKhoWhPrefix(raw) || raw).trim().toUpperCase();
    const c = this.locationCompact(bare);
    // Cũ / tạm / NVL staging — không giữ
    if (c === 'TAM' || c.startsWith('TAM')) return false;
    if (/^NVL[A-Z]?\d*/.test(c) || c.startsWith('NVLA') || c.startsWith('NVLH') || c.startsWith('NVL')) {
      return false;
    }
    // Staging / kết quả IQC — giữ (không bị dọn hàng loạt)
    if (bare === 'IQC' || bare.startsWith('IQC')) return true;
    if (bare === 'PASS') return true;
    const foldHangLoi = bare
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/Đ/g, 'D')
      .replace(/[^A-Z0-9]/g, '');
    if (foldHangLoi === 'HANGLOI') return true;
    if (this.isTraLocationToken(raw) || this.isTraLocationToken(bare)) return true;
    if (this.isLockerOrBoxToken(raw) || this.isLockerOrBoxToken(bare)) return true;
    if (this.kkScanIsFreeLocation(bare)) return true;
    // Bắt buộc có "-" sau số dãy — S01 / R15 không giữ; kho D1 cũng không khớp
    const n = this.normalizeKkScanLocation(bare) || bare;
    // Ô kệ J có thể có chữ cuối: R03-5-2B, R05-5-3C, R03-4-1A
    if (/^[SR]\d{1,2}-\d+(?:-\d+[A-Z]?)?[A-Z]?$/.test(n)) return true;
    // ASM2 không theo kệ J: vị trí kiểu S1.2(R), R2.3(L), U3.1(L) là vị trí thật
    if (this.selectedFactory === 'ASM2' && /^[A-Z]{1,2}\d+(?:\.\d+)?\([LR]\)$/.test(bare.replace(/\s/g, ''))) return true;
    return false;
  }

  /** Gộp vị trí khi scan đổi vị trí: giữ Locker/Box + S/R-…; xóa PASS vì hàng đã cất kệ. */
  private mergeKkScanLocations(existing: string, scanned: string): string {
    const scannedNorm = this.normalizeKkScanLocation(scanned) || String(scanned || '').trim().toUpperCase();
    const dropPass = !!scannedNorm && this.isKkPersistentLocation(scannedNorm);
    const kept = splitMultiLocations(existing)
      .map((t) => this.normalizeKkScanLocation(t) || String(t || '').trim().toUpperCase())
      .filter((t) => {
        if (!t || !this.isKkPersistentLocation(t)) return false;
        if (!dropPass) return true;
        const bare = (this.stripDoiKhoWhPrefix(t) || t).trim().toUpperCase();
        return bare !== 'PASS';
      });
    const base: string[] = [];
    for (const t of kept) {
      if (!base.some((x) => this.kkScanLocationsEqual(x, t))) base.push(t);
    }
    // Chỉ thêm tem scan đúng mẫu (có dấu -); không thêm S01 trần
    if (scannedNorm && this.isKkPersistentLocation(scannedNorm)) {
      if (!base.some((t) => this.kkScanLocationsEqual(t, scannedNorm))) {
        base.push(scannedNorm);
      }
    }
    return this.normalizeMultiLocationValue(joinMultiLocations(base));
  }

  private kkScanHomeLocation(code: string, po = ''): string {
    const lines = this.kkStockLinesForCode(code);
    const homes: Array<{ loc: string; stock: number; slot: boolean }> = [];
    const needPo = String(po || '').trim();
    for (const m of lines) {
      if (needPo && !this.kkTypeScanPoMatch(String(m.poNumber || ''), needPo)) continue;
      const loc = this.normalizeKkScanLocation(this.primaryLocationDisplay(m.location));
      if (!loc || this.kkScanIsStagingLocation(loc)) continue;
      if (!this.kkScanIsJShelfLocation(loc)) continue;
      const hit = homes.find((h) => h.loc === loc);
      const stock = this.calculateCurrentStock(m);
      if (hit) hit.stock += stock;
      else homes.push({ loc, stock, slot: loc.includes('-') });
    }
    if (!homes.length) return '';
    homes.sort((a, b) => {
      if (a.slot !== b.slot) return a.slot ? -1 : 1;
      return b.stock - a.stock;
    });
    return homes[0].loc;
  }

  private kkScanLocationAllowed(scanned: string, home: string): boolean {
    if (!home) return true;
    if (!this.kkScanIsJShelfLocation(home)) return true;
    if (scanned === home) return true;
    const scannedAisle = this.kkScanAisleOf(scanned);
    const homeAisle = this.kkScanAisleOf(home);
    // Home chỉ là kệ Sxx/Rxx (chưa có ô) thì cho scan đúng kệ đó.
    if (!home.includes('-') && scannedAisle && scannedAisle === homeAisle) return true;
    return false;
  }

  submitKkTypeScanLocation(event?: Event, rawOverride?: string): void {
    event?.preventDefault?.();
    if (this.kkTypeScanStep === 'codes' && this.kkTypeScanLocation) return;
    if (!this.checkKkScanOpExpiry() && !this.kkTypeScanOperator) {
      this.kkTypeScanStep = 'operator';
      this.cdr.detectChanges();
      this.focusKkTypeScanInput('kkTypeScanOperatorInput');
      return;
    }
    const el = (event?.target as HTMLInputElement | undefined)
      || (document.getElementById('kkTypeScanLocationInput') as HTMLInputElement | null);
    const loc = this.normalizeKkScanLocation(String(rawOverride ?? el?.value ?? this.kkTypeScanLocationInput ?? ''));
    if (!loc) {
      this.kkTypeScanErr = 'Không đọc được kệ. Quét tem S/R (vd: S16-1-1, R10-1, S07-2).';
      this.kkTypeScanBeep('err');
      this.kkTypeScanLocationInput = '';
      if (el) el.value = '';
      this.pinKkScanFocus();
      this.cdr.detectChanges();
      return;
    }
    if (!this.kkScanIsSrShelfLocation(loc) && !this.kkScanIsFreeLocation(loc)) {
      this.kkTypeScanErr = `Kệ không hợp lệ: "${loc}". Tem phải dạng S/R + dãy + - + số (vd R10-1, S07-2, S16-1-1), hoặc Locker / Backup. Không nhận S01 trần.`;
      this.kkTypeScanBeep('err');
      this.kkTypeScanLocationInput = '';
      if (el) el.value = '';
      this.pinKkScanFocus();
      this.cdr.detectChanges();
      return;
    }
    this.kkTypeScanErr = '';
    this.kkTypeScanLocation = loc;
    this.kkTypeScanLocationInput = loc;
    if (el) el.value = loc;
    this.kkTypeScanStep = 'codes';
    this.kkTypeScanQrInput = '';
    this.kkTypeScanMaterialCode = '';
    this.kkTypeScanStandardDraft = '';
    this.kkTypeScanCartons = {};
    this.cdr.detectChanges();
    this.focusKkTypeScanInput('kkTypeScanQrInput');
    this.kkTypeScanBeep('ready');
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

  protected pushKkTypeScanLog(
    ok: boolean,
    text: string,
    skip = false,
    extra?: { readMs?: number; saveMs?: number }
  ): number {
    const id = ++this.kkScanLogSeq;
    this.kkTypeScanLogs = [{ id, ok, skip, text, readMs: extra?.readMs, saveMs: extra?.saveMs }, ...this.kkTypeScanLogs].slice(0, 20);
    if (ok) this.kkTypeScanOkCount += 1;
    else if (skip) this.kkTypeScanSkipCount += 1;
    else this.kkTypeScanMissCount += 1;
    return id;
  }

  private patchKkTypeScanLog(id: number, text: string, saveMs?: number): void {
    this.kkTypeScanLogs = this.kkTypeScanLogs.map((log) =>
      log.id === id ? { ...log, text, saveMs } : log
    );
  }

  protected kkTypeScanBeep(kind: 'ready' | 'ok' | 'err'): void {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      if (!this.kkBeepCtx) this.kkBeepCtx = new Ctx();
      const ctx = this.kkBeepCtx;
      if (ctx.state === 'suspended') void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = kind === 'err' ? 220 : kind === 'ok' ? 880 : 660;
      gain.gain.value = 0.08;
      osc.start();
      osc.stop(ctx.currentTime + (kind === 'ready' ? 0.12 : 0.08));
    } catch {
      /* ignore audio */
    }
  }

  private async submitKkTypeScanCodeFromRaw(raw: string, readMs = 0): Promise<void> {
    if (this.kkTypeScanStep !== 'codes') return;
    this.kkTypeScanLastReadMs = readMs;
    this.kkTypeScanLastSaveMs = null;
    this.kkTypeScanLastSavePending = true;
    if (!this.checkKkScanOpExpiry() && !this.kkTypeScanOperator) {
      this.kkTypeScanStep = 'operator';
      this.kkTypeScanLastSavePending = false;
      this.cdr.detectChanges();
      this.focusKkTypeScanInput('kkTypeScanOperatorInput');
      return;
    }
    if (!raw) return;

    const parsed = this.parseInboundQrLabelDisplayFields(raw);
    const code = String(parsed.materialCode || raw || '').trim().toUpperCase();
    if (!code) {
      this.pushKkTypeScanLog(false, `QR thiếu mã hàng · đọc ${this.formatScanMs(readMs)}`, false, { readMs });
      this.kkTypeScanBeep('err');
      this.kkTypeScanLastSavePending = false;
      this.cdr.detectChanges();
      this.focusKkTypeScanInput('kkTypeScanQrInput');
      return;
    }

    if (!this.kkTypeScanLocation) {
      this.pushKkTypeScanLog(false, `Chưa scan vị trí · đọc ${this.formatScanMs(readMs)}`, false, { readMs });
      this.kkTypeScanStep = 'location';
      this.kkTypeScanLastSavePending = false;
      this.cdr.detectChanges();
      this.focusKkTypeScanInput('kkTypeScanLocationInput');
      return;
    }

    const qty = 1; // không đọc lượng từ QR — mỗi lần scan = 1 lần ghi nhận vị trí
    const prevCode = this.kkTypeScanMaterialCode;
    if (prevCode && prevCode !== code) {
      this.pushKkTypeScanLog(true, `Sang mã ${code}`, true);
    }
    // Chỉ dùng mã / PO / IMD từ tem — bỏ qua quantity trên QR
    await this.applyKkTypeScanPutaway(code, parsed.po, parsed.imd, qty, readMs);
  }

  private kkStockLinesForCode(code: string): InventoryMaterial[] {
    const u = String(code || '').trim().toUpperCase();
    if (!u) return [];
    const seen = new Set<string>();
    const out: InventoryMaterial[] = [];
    const add = (m: InventoryMaterial) => {
      if (!m?.id || seen.has(m.id)) return;
      if (String(m.materialCode || '').trim().toUpperCase() !== u) return;
      if (this.calculateCurrentStock(m) <= 0) return;
      seen.add(m.id);
      out.push(m);
    };
    for (const m of this.kkScanScopeLines()) add(m);
    this.kkLocMapTypeCache.forEach((list) => list.forEach(add));
    this.kkLocMapMaterialCache.forEach((list) => list.forEach(add));
    this.kkTypeScanExtraLines.forEach(add);
    return out;
  }

  private async ensureKkScanStockLines(code: string): Promise<InventoryMaterial[]> {
    let lines = this.kkStockLinesForCode(code);
    if (lines.length) return lines;
    const factories = this.selectedFactory === 'ASM2' ? (['ASM2', 'ASM1'] as const) : (['ASM1', 'ASM2'] as const);
    try {
      const snaps = await Promise.all(
        factories.map((factory) =>
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
          return material;
        })
        .filter((m) => this.calculateCurrentStock(m) > 0);
      if (rows.length) {
        await this.ensureCatalogForMaterialCodes([code]);
        this.applyCatalogToMaterials(rows);
        const seen = new Set(this.kkTypeScanExtraLines.map((m) => m.id));
        for (const row of rows) {
          if (!row.id || seen.has(row.id)) continue;
          this.kkTypeScanExtraLines = [...this.kkTypeScanExtraLines, row];
          seen.add(row.id);
        }
      }
      return this.kkStockLinesForCode(code);
    } catch (e) {
      console.warn('[KK scan] ensureKkScanStockLines:', e);
      return lines;
    }
  }

  private pickKkScanLine(
    code: string,
    po: string,
    imd: string,
    qty = 0
  ): InventoryMaterial | null {
    const lines = this.kkStockLinesForCode(code);
    if (!lines.length) return null;
    const loc = this.kkTypeScanLocation;
    const scored = lines.map((m) => {
      let score = 0;
      if (this.kkTypeScanPoMatch(String(m.poNumber || ''), po)) score += 8;
      if (this.kkTypeScanImdMatch(imd, this.getDisplayIMD(m))) score += 4;
      const here = this.normalizeKkScanLocation(this.primaryLocationDisplay(m.location));
      if (here === loc) score += 3;
      const remainBoxes = this.getKkRollsCount(m) - this.getKkScanCount(m);
      if (remainBoxes > 0) score += 2;
      return { m, score, remain: remainBoxes };
    });
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score || b.remain - a.remain);
    return scored[0].m;
  }

  private async applyKkTypeScanPutaway(
    code: string,
    po: string,
    imd: string,
    qty: number,
    readMs = 0
  ): Promise<void> {
    this.kkTypeScanMaterialCode = code;
    const loc = this.kkTypeScanLocation;
    const readNote = `đọc ${this.formatScanMs(readMs)}`;
    try {
      await this.ensureKkScanStockLines(code);
    } catch {
      /* ensure already logs */
    }
    const home = po ? this.kkScanHomeLocation(code, po) : this.kkScanHomeLocation(code);
    let targetLoc = loc;
    let relocateNote = '';
    const locationOnly = this.kkTypeScanMode === 'location';
    // Scan kiểm kê: đã set vị trí cho loại mã → follow vị trí đúng; scan sai kệ thì đưa về home
    if (!locationOnly && home && !this.kkScanIsFreeLocation(loc) && !this.kkScanLocationAllowed(loc, home)) {
      targetLoc = home;
      relocateNote = ` · đưa về ${home}`;
    }

    const line = this.pickKkScanLine(code, po, imd, qty);
    const first = line || this.kkTypeScanCodeRows[0];
    this.kkTypeScanStandardDraft = first ? (this.getEffectiveStandardPacking(first) || '') : '';
    if (!this.kkStockLinesForCode(code).length) {
      this.pushKkTypeScanLog(false, `${code} — không có dòng tồn · ${readNote}`, false, { readMs });
      this.kkTypeScanBeep('err');
      this.kkTypeScanLastSavePending = false;
      this.cdr.detectChanges();
      this.focusKkTypeScanInput('kkTypeScanQrInput');
      return;
    }
    if (!line?.id) {
      const scanned = this.kkTypeScanQtyScanned;
      const boxTotal = this.kkTypeScanCartonTotal;
      const msg = `${code} — không khớp mã/PO/IMD · Box ${this.formatNumber(scanned)} / ${boxTotal || '—'}`;
      this.pushKkTypeScanLog(false, `${msg} · ${readNote}`, false, { readMs });
      this.kkTypeScanBeep('err');
      this.kkTypeScanLastSavePending = false;
      this.cdr.detectChanges();
      this.focusKkTypeScanInput('kkTypeScanQrInput');
      return;
    }

    // Cập nhật vị trí: thêm kệ vừa scan; tự xóa S01 trần / D1 / vị trí sai (giữ Locker/Box + S/R-…)
    if (locationOnly) {
      targetLoc = this.mergeKkScanLocations(String(line.location || ''), loc);
    }

    const operator = this.kkTypeScanOperator || this.kkOperatorIdCache;
    if (!operator) {
      this.kkTypeScanStep = 'operator';
      this.kkTypeScanLastSavePending = false;
      this.cdr.detectChanges();
      this.focusKkTypeScanInput('kkTypeScanOperatorInput');
      return;
    }

    const fromLocation = this.normalizeMultiLocationValue(String(line.location || ''));
    const nextLoc = this.normalizeMultiLocationValue(targetLoc);
    const prevScanCount = this.getKkScanCount(line);
    const prevLocation = String(line.location || '');
    const prevKk = !!line.kkChecked;
    const prevKkBy = line.kkBy;
    const prevKkAt = line.kkAt;
    const prevOrigin = String(line.kkOriginLocation || '').trim();
    // Đếm mỗi lần quét mã = 1 box (cả cập nhật vị trí lẫn kiểm kê)
    const nextScan = this.roundKkQty(prevScanCount + 1);
    // Lượng quét = cộng lượng trên tem
    const prevScanQty = this.getKkScanQty(line);
    const nextScanQty = this.roundKkQty(prevScanQty + (qty > 0 ? qty : 0));
    const stock = this.calculateCurrentStock(line);
    const rolls = this.getKkRollsCount(line);
    const enoughQty = stock > 0 && nextScanQty + 1e-9 >= stock;
    const enoughBox = rolls > 0 && nextScan + 1e-9 >= rolls;
    const shouldKk = !locationOnly && (enoughQty || enoughBox) && stock > 0 && this.can('kkTick');
    const overStandard = rolls > 0 && nextScan > rolls + 1e-9;
    const firstReal =
      splitMultiLocations(nextLoc)
        .map((t) => this.normalizeKkScanLocation(t) || t)
        .find((t) => t && !this.kkScanIsStagingLocation(t) && !this.kkScanIsWrongLocation(t))
      || '';
    const originToKeep = this.normalizeKkScanLocation(prevOrigin) || firstReal || '';
    const kkAt = new Date();

    const payload: Record<string, unknown> = {
      ...this.inventoryLocationWriteFields(nextLoc),
      kkScanCount: nextScan,
      kkScanQty: nextScanQty,
      updatedAt: kkAt,
      lastModified: firebase.default.firestore.FieldValue.serverTimestamp(),
      modifiedBy: operator,
      locationManualOverride: true
    };
    if (originToKeep) {
      payload.kkOriginLocation = originToKeep;
    }
    if (locationOnly) {
      payload.locationScannedAt = kkAt;
    }
    if (shouldKk) {
      payload.kkChecked = true;
      payload.kkBy = operator;
      payload.kkAt = kkAt;
    }
    const batch = this.firestore.firestore.batch();
    batch.update(this.firestore.collection('inventory-materials').doc(line.id).ref, payload);
    if (fromLocation !== nextLoc) {
      batch.set(this.firestore.collection('material-location-history').doc().ref, {
        factory: this.selectedFactory,
        materialId: line.id,
        materialCode: line.materialCode,
        poNumber: line.poNumber || '',
        fromLocation,
        toLocation: nextLoc,
        changedBy: operator,
        changeType: locationOnly ? 'kk-location-scan' : 'kk-type-scan',
        changedAt: firebase.default.firestore.FieldValue.serverTimestamp()
      });
    }
    if (shouldKk) {
      this.kkLogSet(batch, {
        inventoryDocId: line.id,
        factory: this.resolveKkFactoryForMaterial(line),
        materialCode: String(line.materialCode || '').trim().toUpperCase(),
        materialName: String(line.materialName || '').trim(),
        poNumber: String(line.poNumber || '').trim(),
        batchNumber: String(line.batchNumber || '').trim(),
        location: nextLoc,
        quantity: Number(line.quantity) || 0,
        stock,
        unit: String(line.unit || '').trim(),
        checkedBy: operator,
        checkedAt: kkAt,
        checkedDateKey: this.toDateKey(kkAt),
        createdAt: new Date(),
        source: 'kk-type-scan'
      });
    }

    const stampLocal = (
      location: string,
      scanCount: number,
      scanQty: number,
      kkOn: boolean,
      kkBy?: string,
      kkWhen?: Date,
      originLoc?: string
    ) => {
      const applyKk = (x: InventoryMaterial) => {
        if (kkOn) {
          x.kkChecked = true;
          x.kkBy = kkBy;
          x.kkAt = kkWhen;
        } else {
          x.kkChecked = prevKk;
          x.kkBy = prevKkBy;
          x.kkAt = prevKkAt;
        }
      };
      line.location = location;
      line.kkScanCount = scanCount;
      line.kkScanQty = scanQty;
      if (locationOnly) line.locationScannedAt = kkAt;
      if (originLoc) line.kkOriginLocation = originLoc;
      const rowMeta = line as { __prevLocation?: string; __locationAtLoad?: string; locationManualOverride?: boolean };
      rowMeta.__prevLocation = location;
      rowMeta.__locationAtLoad = location;
      rowMeta.locationManualOverride = true;
      applyKk(line);
      const stamp = (x: InventoryMaterial) => {
        if (x.id !== line.id) return;
        x.location = location;
        x.kkScanCount = scanCount;
        x.kkScanQty = scanQty;
        if (locationOnly) x.locationScannedAt = kkAt;
        if (originLoc) x.kkOriginLocation = originLoc;
        applyKk(x);
      };
      this.kkLocMapTypeCache.forEach((list) => list.forEach(stamp));
      this.kkLocMapMaterialCache.forEach((list) => list.forEach(stamp));
      this.kkTypeScanExtraLines.forEach(stamp);
      this.patchKkInvSnapCache(line.id, {
        location,
        viTri: location,
        locationManualOverride: true,
        kkScanCount: scanCount,
        kkScanQty: scanQty,
        ...(locationOnly ? { locationScannedAt: kkAt } : {}),
        ...(originLoc ? { kkOriginLocation: originLoc } : {}),
        ...(kkOn ? { kkChecked: true, kkBy, kkAt: kkWhen } : { kkChecked: prevKk })
      });
    };

    stampLocal(nextLoc, nextScan, nextScanQty, shouldKk, operator, kkAt, originToKeep || undefined);
    if (locationOnly && this.kkLocScanDay && line.id) {
      this.kkLocScanIds.add(line.id);
      this.invalidateKkTypeViewCache();
    }
    this.kkTypeScanCartons = {
      ...this.kkTypeScanCartons,
      [code]: (this.kkTypeScanCartons[code] || 0) + 1
    };
    const boxes = this.kkTypeScanQtyScanned;
    const boxTotal = this.kkTypeScanCartonTotal || rolls;
    const stdNote = overStandard
      ? ` · thừa ${this.roundKkQty(nextScan - rolls)} Box — cần xem lại Standard`
      : rolls > 0 && Math.abs(nextScan - rolls) < 1e-9
        ? ' · đủ Standard'
        : '';
    const boxNote = locationOnly
      ? `→ ${splitMultiLocations(nextLoc).join(' · ')} · ${this.formatNumber(nextScan)}${boxTotal ? ` / ${boxTotal}` : ''} Box${stdNote}`
      : boxTotal
        ? `${boxes}/${boxTotal} Box${boxes < boxTotal ? ` · thiếu ${boxTotal - boxes}` : boxes > boxTotal ? ` · thừa ${boxes - boxTotal}` : ' · đủ'}${stdNote && !locationOnly && overStandard ? stdNote : ''}`
        : `${boxes} Box`;
    const imdNote = imd ? ` · IMD ${imd}` : '';
    const poNote = po ? ` · PO ${po}` : '';
    const baseText = `${code}${poNote}${imdNote} · ${boxNote}${shouldKk ? ' · KK' : ''}${relocateNote}`;
    const logId = this.pushKkTypeScanLog(
      true,
      `${baseText} · ${readNote} · đang ghi…`,
      false,
      { readMs }
    );
    this.kkTypeScanBeep(overStandard ? 'err' : 'ok');
    this.kkTypeScanLastSavePending = true;

    if (locationOnly) {
      this.kkHidQrQueue = [];
      this.nlScanLock = false;
      if (overStandard) {
        this.showKkTypeScanLocToast(code, splitMultiLocations(nextLoc).join(' · ') || nextLoc, {
          kind: 'over',
          scanned: `${this.formatNumber(nextScan)}/${boxTotal} Box`
        });
      } else {
        this.showKkTypeScanLocToast(code, splitMultiLocations(nextLoc).join(' · ') || nextLoc);
      }
      this.kkTypeScanQrInput = '';
      this.cdr.detectChanges();
      this.focusKkTypeScanInput('kkTypeScanQrInput');
    } else {
      // Scan kiểm kê: overlay chờ Đồng ý mới scan tiếp
      this.kkHidQrQueue = [];
      this.kkTypeScanConfirm = {
        code,
        po: String(po || '').trim(),
        imd: String(imd || '').trim(),
        location: nextLoc,
        scannedShelf: loc,
        relocated: !!relocateNote
      };
      this.showKkTypeScanConfirm = true;
      this.cdr.detectChanges();
      setTimeout(() => {
        const btn = document.getElementById('kkTypeScanConfirmOk') as HTMLButtonElement | null;
        btn?.focus();
      }, 40);
    }

    this.kkScanWritesInFlight += 1;
    this.kkScanWriteChain = this.kkScanWriteChain
      .then(async () => {
        const saveStarted = performance.now();
        await batch.commit();
        const saveMs = Math.max(0, Math.round(performance.now() - saveStarted));
        this.kkTypeScanLastSaveMs = saveMs;
        this.kkTypeScanLastSavePending = this.kkScanWritesInFlight > 1;
        this.patchKkTypeScanLog(logId, `${baseText} · ${readNote} · ghi ${this.formatScanMs(saveMs)}`, saveMs);
        if (this.showKkTypeScanModal) this.cdr.detectChanges();
      })
      .catch((e) => {
        console.error('❌ applyKkTypeScanPutaway:', e);
        stampLocal(
          prevLocation,
          prevScanCount,
          prevScanQty,
          prevKk,
          prevKkBy as string | undefined,
          prevKkAt as Date | undefined,
          prevOrigin || undefined
        );
        this.kkTypeScanCartons = {
          ...this.kkTypeScanCartons,
          [code]: Math.max(0, (this.kkTypeScanCartons[code] || 1) - 1)
        };
        this.kkTypeScanLastSavePending = false;
        this.showKkTypeScanConfirm = false;
        this.kkTypeScanConfirm = null;
        this.kkTypeScanLocToast = null;
        if (this.kkTypeScanLocToastTimer) {
          clearTimeout(this.kkTypeScanLocToastTimer);
          this.kkTypeScanLocToastTimer = null;
        }
        this.patchKkTypeScanLog(logId, `${code} — không lưu được · ${readNote}`, undefined);
        this.kkTypeScanBeep('err');
        if (this.showKkTypeScanModal) this.cdr.detectChanges();
        this.focusKkTypeScanInput('kkTypeScanQrInput');
      })
      .then(() => {
        this.kkScanWritesInFlight = Math.max(0, this.kkScanWritesInFlight - 1);
        if (!this.kkScanWritesInFlight) this.syncKkTypeRows();
      });
  }

  get kkTypeScanCodeRows(): InventoryMaterial[] {
    const code = this.kkTypeScanMaterialCode;
    if (!code) return [];
    return this.kkStockLinesForCode(code).sort((a, b) => {
      const po = String(a.poNumber || '').localeCompare(String(b.poNumber || ''), 'en', { numeric: true });
      if (po) return po;
      return String(this.getDisplayIMD(a) || '').localeCompare(String(this.getDisplayIMD(b) || ''), 'en', { numeric: true });
    });
  }

  get kkTypeScanCodeRollsTotal(): number {
    return this.kkTypeScanCodeRows.reduce((sum, m) => sum + this.getKkRollsCount(m), 0);
  }

  get kkTypeScanCartonTotal(): number {
    return this.kkTypeScanCodeRollsTotal;
  }

  get kkTypeScanQtyScanned(): number {
    return this.kkTypeScanCodeRows.reduce((sum, m) => sum + this.getKkScanCount(m), 0);
  }

  kkLineWhValue(line: InventoryMaterial): '' | '00' | 'J' | 'ASM3' {
    const tag = this.locationWhTag(line.location);
    return tag === 'J' || tag === 'ASM3' || tag === '00' ? tag : '';
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
      this.kkWh3Only ? 1 : 0,
      this.kkJOnly ? 1 : 0
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

  // ===== Cột phụ bảng tồn kho (Tồn đầu, XT, Pallet, WH, Change, Tem Thùng, Lưu ý, MSD/ESD): mặc định ẩn, bật ở More =====
  private static readonly EXTRA_COLS_KEY = 'materials-show-extra-cols';
  showExtraCols = (() => {
    try { return localStorage.getItem(MaterialsComponent.EXTRA_COLS_KEY) === '1'; } catch { return false; }
  })();

  toggleExtraCols(): void {
    this.showExtraCols = !this.showExtraCols;
    try { localStorage.setItem(MaterialsComponent.EXTRA_COLS_KEY, this.showExtraCols ? '1' : '0'); } catch { /* ignore */ }
    this.cdr.markForCheck();
  }

  // ===== Kiểm kê (Quản lý NVL) = cùng màn hình scan "Cập nhật vị trí" của tab Location (<app-loc-upd-scan>) =====
  showKiemKeScan = false;

  openKiemKeScan(): void {
    if (!this.canEdit) return;
    this.showKiemKeScan = true;
  }

  /** DONE xong: cập nhật ngay các dòng đang hiện (vị trí, lượng quét, tick KK) — không đọc lại kho. */
  onKiemKeDone(e: LocUpdDoneEvent): void {
    const at = new Date();
    const byId = new Map(e.lines.map((l) => [l.id, l]));
    const stamp = (x: InventoryMaterial) => {
      const l = x?.id ? byId.get(x.id) : undefined;
      if (!l) return;
      x.location = e.location;
      (x as any).viTri = e.location;
      x.kkScanQty = l.scannedQty;
      x.kkScanCount = l.scans;
      (x as any).locationScannedAt = at;
      if (Math.abs(l.scannedQty - l.stock) < 1e-6) {
        x.kkChecked = true;
        x.kkBy = e.operator;
        x.kkAt = at;
      }
    };
    this.kkLocMapTypeCache.forEach((list) => list.forEach(stamp));
    this.kkLocMapMaterialCache.forEach((list) => list.forEach(stamp));
    this.kkTypeScanExtraLines.forEach(stamp);
    this.inventoryMaterials.forEach(stamp);
    this.filteredInventory.forEach(stamp);
    e.lines.forEach((l) => {
      const tick = Math.abs(l.scannedQty - l.stock) < 1e-6;
      this.patchKkInvSnapCache(l.id, {
        location: e.location,
        viTri: e.location,
        locationManualOverride: true,
        kkScanQty: l.scannedQty,
        kkScanCount: l.scans,
        locationScannedAt: at,
        ...(tick ? { kkChecked: true, kkBy: e.operator, kkAt: at } : {})
      });
    });
    this.invalidateKkTypeViewCache();
    this.cdr.detectChanges();
  }

  /** Nút Vị trí (Quản lý NVL): mở tab mới — % kiểm kê theo từng vị trí. */
  openKkViTriTab(): void {
    window.open(`#/kk-vi-tri?factory=${encodeURIComponent(this.selectedFactory || 'ASM1')}`, '_blank');
  }

  /** Dòng tick KK trong hôm nay → viền xanh ở ô KK (tick cũ hơn không viền). */
  isKkTickedToday(m: InventoryMaterial): boolean {
    if (!m?.kkChecked) return false;
    const raw: any = (m as any).kkAt;
    const d: Date | null = !raw ? null
      : typeof raw.toDate === 'function' ? raw.toDate()
      : raw.seconds != null ? new Date(raw.seconds * 1000)
      : raw instanceof Date ? raw : new Date(raw);
    if (!d || Number.isNaN(d.getTime())) return false;
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }

  /** Đã tick KK nhưng lượng quét (cộng lượng trên tem) nhỏ hơn tồn — gồm cả tick tay chưa quét. */
  isKkTickedScanShort(m: InventoryMaterial): boolean {
    if (!this.isKkFlagOn(m.kkChecked)) return false;
    const stock = this.calculateCurrentStock(m);
    if (!(stock > 0)) return false;
    return this.getKkScanQty(m) < stock - 1e-6;
  }

  getKkScanQty(material: InventoryMaterial): number {
    return Math.max(0, Number(material?.kkScanQty) || 0);
  }

  private roundKkQty(n: number): number {
    return Math.round(n * 1e6) / 1e6;
  }

  protected kkTypeSkeletonKey(): string {
    return `kk-type-skeleton-${this.selectedFactory}`;
  }

  /** Danh sách box (loại + nhóm mã) của lần đọc tồn gần nhất — để hiện box khi chưa đọc tồn. */
  protected kkTypeSkeletonMemo: { key: string; rows: Array<{ t: string; g: string[] }> } | null = null;

  private loadKkTypeSkeleton(): Array<{ t: string; g: string[] }> {
    const key = this.kkTypeSkeletonKey();
    if (this.kkTypeSkeletonMemo?.key === key) return this.kkTypeSkeletonMemo.rows;
    let rows: Array<{ t: string; g: string[] }> = [];
    try {
      const raw = localStorage.getItem(key);
      const arr = raw ? JSON.parse(raw) : [];
      rows = Array.isArray(arr) ? arr.filter((r) => r && typeof r.t === 'string') : [];
    } catch {
      rows = [];
    }
    this.kkTypeSkeletonMemo = { key, rows };
    return rows;
  }

  kkTypeDetailLines(row: KkTypeRow | null): InventoryMaterial[] {
    if (!row) return [];
    return this.kkCachedLinesForType(row.productType)
      .filter((m) => this.calculateCurrentStock(m) > 0)
      .sort((a, b) => {
        const ca = a.materialCode || '';
        const cb = b.materialCode || '';
        if (ca !== cb) return ca < cb ? -1 : 1;
        const pa = a.poNumber || '';
        const pb = b.poNumber || '';
        if (pa !== pb) return pa < pb ? -1 : 1;
        return 0;
      });
  }

  protected kkMatchesWh3Mode(warehouse: KkWarehouse | string): boolean {
    if (this.kkJOnly) return warehouse === 'J';
    if (this.kkWh3Only) return warehouse === 'ASM3';
    if (!this.kkCountWh3) return warehouse !== 'ASM3';
    return true;
  }

  protected kkCachedLinesForType(productType: string): InventoryMaterial[] {
    const mucAll = this.kkMucAllDetail;
    if (mucAll && productType === mucAll.title) {
      const seen = new Set<string>();
      const out: InventoryMaterial[] = [];
      // Toàn bộ tất cả mục: luôn lấy danh sách box hiện tại (sau khi đọc toàn kho có thể thêm box mới)
      let boxes = mucAll.boxes;
      if (mucAll.title === 'Toàn bộ tất cả các mục') { this.ensureKkTypeBoxesCache(); boxes = this.kkTypeBoxesCached as any; }
      for (const b of boxes) {
        for (const m of this.kkCachedLinesForType(b.productType)) {
          const id = String(m.id || '');
          if (id && seen.has(id)) continue;
          if (id) seen.add(id);
          out.push(m);
        }
      }
      return out;
    }
    if (this.kkAllStockDetail && productType === this.kkAllStockDetailTitle) {
      return this.kkAllStockDetailLines();
    }
    const floor = this.kkConnectorFloorDetail;
    if (floor && productType === floor.title) {
      return this.kkConnectorFloorDetailLines(floor);
    }
    this.ensureKkTypeBoxesCache();
    const q = this.kkEffectiveSearchQuery(this.kkLocMapQuery || this.kkTypeDetailQuery);
    const boxExact = this.kkTypeBoxesCached.find((b) => b.productType === productType);
    const box = boxExact
      || this.kkTypeBoxesCached.find((b) => !!b.sourceProductTypes?.includes(productType))
      || this.kkTypeBoxesCached.find((b) => b.sourceProductType === productType);
    const sources = (boxExact?.sourceProductTypes?.length
      ? boxExact.sourceProductTypes
      : null)
      || (box?.sourceProductTypes?.length ? box.sourceProductTypes : null)
      || [box?.sourceProductType || productType];
    const split = q
      ? null
      : (box?.pinSplit
        || (productType === this.kkActiveProductType ? this.kkActivePinSplit : null)
        || null);
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
    if (!list.length) {
      list = this.kkLocMapTypeCache.get(productType)
        || this.kkLocMapTypeCache.get(box?.sourceProductType || '')
        || [];
    }
    list = list.filter((m) => this.kkMatchesWh3Mode(this.kkWarehouseFromLocation(m.location)));
    const zone = this.kkLocMapWarehouseFilter;
    if (zone && !q) {
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

  protected kkLinesForTypeRow(row: KkTypeRow): InventoryMaterial[] {
    return this.kkCachedLinesForType(row.productType).filter((m) => !!m.id);
  }

  /** Loại hàng theo Danh mục KK; mã chưa có loại hàng → xếp theo nhóm đầu mã (R029, A031, B015…). */
  protected kkTypeOrGroupOfMaterial(materialCode: string): string {
    const code = String(materialCode || '').trim().toUpperCase();
    // B008 / B009 / B016 / B018: "loại" = khoảng 100 mã (ô B009101–B009200…)
    const range = this.kkRangeTypeOf(code);
    if (range) return range;
    const type = this.kkCatalog.productTypeOf(code, this.kkCatalogTypeMap);
    if (type) return type;
    const head = /^([A-Z]\d{3})/.exec(code);
    return head ? head[1] : 'Chưa gán danh mục';
  }

  protected syncKkTypeRows(): void {
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
        appAlert('Không lưu được cài đặt Rule lên Firebase. Kiểm tra mạng hoặc quyền Firestore.');
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
      appAlert('Nhập đầu mã (tối đa 4 ký tự, ví dụ 2602).');
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
    if (this.denyAction('manualOn')) return;
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
    if (this.denyAction('moreSensitive')) return;
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

  protected openMaterialsOtpModal(): void {
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

  protected async getMaterialsOtpRequester(): Promise<string> {
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
      case 'unlock-xt':
        await this.setXtAsm1Locked(false);
        break;
      case 'clear-kk-warning':
        await this.clearKkWarningAll(this.kkWarnClearPending);
        break;
      default:
        break;
    }
  }

  // ===== Khóa XT ở ASM1 =====
  // Mặc định khóa. Mở khóa ở More bằng mã Zalo 4 số gửi ASP0106; mở rồi giữ nguyên (mọi máy)
  // cho tới khi có người bấm khóa lại. Lưu chung ở app-settings/materials-xt-lock.
  static readonly XT_LOCK_DOC = 'app-settings/materials-xt-lock';
  xtAsm1Locked = true;
  xtAsm1LockInfo = '';
  private xtLockSub: Subscription | null = null;

  private watchXtLock(): void {
    if (this.xtLockSub) return;
    this.xtLockSub = this.firestore.doc(MaterialsComponent.XT_LOCK_DOC).valueChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe((d: any) => {
        // Chưa có doc → coi như đang khóa
        this.xtAsm1Locked = d?.asm1Locked !== false;
        const by = String(d?.updatedBy || '').trim();
        const at = d?.updatedAt?.toDate ? d.updatedAt.toDate() : null;
        this.xtAsm1LockInfo = by || at
          ? `${this.xtAsm1Locked ? 'Khóa' : 'Mở'} bởi ${by || '—'}${at ? ' · ' + at.toLocaleString('vi-VN') : ''}`
          : '';
        this.cdr.markForCheck();
      });
  }

  /** XT đang bị khóa cho dòng này (chỉ ASM1). */
  isXtLockedFor(material: InventoryMaterial | null | undefined): boolean {
    const factory = String(material?.factory || this.selectedFactory || '').trim().toUpperCase();
    return factory === 'ASM1' && this.xtAsm1Locked;
  }

  private async setXtAsm1Locked(locked: boolean): Promise<void> {
    const by = await this.getMaterialsOtpRequester();
    try {
      await this.firestore.doc(MaterialsComponent.XT_LOCK_DOC).set({
        asm1Locked: locked,
        updatedBy: by,
        updatedAt: firebase.default.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      this.xtAsm1Locked = locked;
      appAlert(locked ? '🔒 Đã khóa XT ở ASM1.' : '🔓 Đã mở khóa XT ở ASM1 — giữ mở cho tới khi bấm Khóa lại trong More.');
    } catch (e) {
      console.error('setXtAsm1Locked', e);
      appAlert('Không lưu được trạng thái khóa XT. Thử lại.');
    } finally {
      this.cdr.markForCheck();
    }
  }

  /** More → mở khóa XT ASM1: luôn hỏi mã Zalo (không dùng phiên mở khóa 10 phút). */
  openUnlockXtAsm1(): void {
    if (this.denyAction('xtLockToggle')) return;
    this.pendingMaterialsOtpAction = 'unlock-xt';
    this.materialsOtpActionLabel = 'Mở khóa XT — ASM1';
    this.closeMorePopup();
    this.openMaterialsOtpModal();
  }

  lockXtAsm1(): void {
    if (this.denyAction('xtLockToggle')) return;
    if (!confirm('Khóa XT ở ASM1? Sau khi khóa, muốn XT lại phải mở bằng mã Zalo.')) return;
    this.closeMorePopup();
    void this.setXtAsm1Locked(true);
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

  protected async getLinkQPackCached(force: boolean): Promise<LinkQPack> {
    const factory = this.selectedFactory;
    const hit = this.linkQPackCache.get(factory);
    if (!force && hit && Date.now() - hit.ts < MaterialsComponent.LINKQ_PACK_TTL_MS) return hit.pack;
    const pack = await this.loadKkKiemKeLinkQPack();
    if (pack.map.size) this.linkQPackCache.set(factory, { pack, ts: Date.now() });
    return pack;
  }

  /** Mã đầu R và A không đưa vào báo cáo so sánh LinkQ. */
  protected static isLinkQCompareExcluded(code: string): boolean {
    return /^[RA]/i.test(String(code || '').trim());
  }

  private growLinkQCompareShown(): void {
    const n = this.linkQCompareShownRows.length + MaterialsComponent.LINKQ_COMPARE_PAGE;
    this.linkQCompareShownRows = this.linkQCompareVisibleRows.slice(0, n);
  }

  /** DS Check bật → trang KK chỉ hiện mã có trong danh sách Check (dùng chung file Import Check với LinkQ). */
  get kkCheckActive(): boolean {
    return this.linkQCheckOnly && this.linkQCheckSet.size > 0;
  }

  kkCheckHas(code: string | null | undefined): boolean {
    return this.linkQCheckSet.has(this.normalizeTieuHuyCode(code));
  }

  private kkCheckTypesMemo: { set: unknown; cat: unknown; types: Set<string> } = { set: null, cat: null, types: new Set() };

  /** Loại hàng (box) chứa các mã trong DS Check — để ẩn box / mục không có mã cần kiểm. */
  private kkCheckTypes(): Set<string> {
    const m = this.kkCheckTypesMemo;
    if (m.set === this.linkQCheckSet && m.cat === this.kkCatalogTypeMap) return m.types;
    const types = new Set<string>();
    this.linkQCheckSet.forEach((c) => types.add(this.kkTypeOrGroupOfMaterial(c)));
    this.kkCheckTypesMemo = { set: this.linkQCheckSet, cat: this.kkCatalogTypeMap, types };
    return types;
  }

  async downloadTieuHuyTemplate(): Promise<void> {
    const XLSX = await import('xlsx');
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
        appAlert('Không tìm thấy dòng hợp lệ. Cần cột Mã và PO.');
        return;
      }
      this.tieuHuyRows = parsed.map((r) => this.emptyTieuHuyRow(r));
      this.tieuHuyImportedCount = this.tieuHuyRows.length;
      await this.lookupAndMatchTieuHuyRows();
      this.saveTieuHuyLastImport();
      appAlert(
        `File tiêu hủy: ${this.tieuHuyImportedCount} mã.\n` +
        `Trùng tồn kho (Mã + PO): ${this.tieuHuyMatchedCount} / ${this.tieuHuyImportedCount}.\n` +
        `So sánh Lượng file với Tồn kho hiện tại, tick chọn rồi bấm Đưa vào kho tiêu hủy.\n` +
        `Ẩn = ẩn mã đó 30 ngày.`
      );
    } catch (e: any) {
      console.error('❌ processTieuHuyImportFile:', e);
      appAlert('Lỗi khi đọc file tiêu hủy: ' + (e?.message || e));
    } finally {
      this.tieuHuyImporting = false;
      this.cdr.detectChanges();
    }
  }

  private async parseTieuHuyExcel(file: File): Promise<Array<{ px: string; materialCode: string; poNumber: string; fileQty: number | null }>> {
    const XLSX = await import('xlsx');
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

  protected normalizeTieuHuyCode(raw: unknown): string {
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

  protected async fetchTieuHuyStockByCodes(materialCodes: string[]): Promise<InventoryMaterial[]> {
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
      appAlert('Chọn mã đã khớp tồn kho trước khi đưa vào kho tiêu hủy.');
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
        appAlert('Không chuyển được kho (lỗi lưu).');
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
      appAlert(`Đã chuyển ${toWrite.length} dòng sang kho ${this.tieuHuyWarehouseValue}.`);
    } finally {
      this.tieuHuyBusy = false;
      this.cdr.detectChanges();
    }
  }

  async hideTieuHuyRow(row: typeof this.tieuHuyRows[number]): Promise<void> {
    if (this.tieuHuyBusy || !row || row.done === 'hidden') return;
    if (!this.canDelete) {
      appAlert('❌ Bạn không có quyền ẩn item này. Vui lòng liên hệ admin để được cấp quyền.');
      return;
    }
    if (!row.inventoryIds.length) {
      appAlert('Mã này chưa khớp tồn kho nên không ẩn được.');
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
      appAlert(
        n > 0
          ? `Đã ẩn ${row.materialCode}. Xem lại trong More → Danh mục Ẩn (giữ ${this.hiddenRetentionDays} ngày).`
          : `Không ẩn được ${row.materialCode}.`
      );
    } catch (e: any) {
      console.error('❌ hideTieuHuyRow:', e);
      appAlert('Lỗi khi ẩn: ' + (e?.message || e));
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
    this.kkCatalogTab = 'codes';
    void this.loadKkCatalogPopup();
    void this.loadKkShelfGroups();
  }

  closeKkCatalogPopup(): void {
    if (this.kkCatalogImporting) return;
    this.showKkCatalogPopup = false;
  }

  get kkShelfFilteredRows(): Array<{ shelf: string; groups: string }> {
    const q = this.kkCatalogQuery.trim().toUpperCase();
    if (!q) return this.kkShelfRows;
    return this.kkShelfRows.filter((row) => row.shelf.includes(q) || row.groups.toUpperCase().includes(q));
  }

  async loadKkShelfGroups(): Promise<void> {
    try {
      const snap = await this.firestore.collection('kk-shelf-group-map').doc('layout').get().toPromise();
      const raw = (snap?.data() as { shelves?: unknown } | undefined)?.shelves;
      const saved = raw && typeof raw === 'object' ? raw as Record<string, string> : null;
      this.kkShelfRows = shelfGroupRows(saved);
      this.kkShelfCommitted = JSON.stringify(this.kkShelfPayload());
    } catch (e) {
      console.error('loadKkShelfGroups', e);
      this.kkShelfRows = shelfGroupRows(null);
    }
    this.cdr.detectChanges();
  }

  async saveKkShelfGroups(): Promise<void> {
    if (this.kkShelfSaving) return;
    for (const row of this.kkShelfRows) row.groups = normalizeShelfGroups(row.groups);
    const shelves = this.kkShelfPayload();
    const key = JSON.stringify(shelves);
    if (key === this.kkShelfCommitted) return;
    this.kkShelfSaving = true;
    this.cdr.detectChanges();
    try {
      await this.firestore.collection('kk-shelf-group-map').doc('layout').set({
        shelves,
        updatedAt: firebase.default.firestore.FieldValue.serverTimestamp()
      });
      this.kkShelfCommitted = key;
      // Danh mục vị trí cộng thêm kệ theo dãy kệ → nạp lại ngay để vị trí gợi ý / ép vị trí cập nhật
      void this.kkCatalog.loadShelfMap().then(() => {
        this.invalidateKkTypeViewCache();
        this.cdr.markForCheck();
      });
    } catch (e) {
      console.error('saveKkShelfGroups', e);
      appAlert('Không lưu được danh mục dãy kệ.');
    } finally {
      this.kkShelfSaving = false;
      this.cdr.detectChanges();
    }
  }

  private kkShelfCommitted = '';

  private kkShelfPayload(): Record<string, string> {
    const shelves: Record<string, string> = {};
    for (const row of this.kkShelfRows) shelves[row.shelf] = row.groups;
    return shelves;
  }

  kkCatalogLocOf(entry: KkCatalogEntry): string {
    return this.kkCatalogEffectiveLoc(entry);
  }

  kkCatalogRuleLoc(entry: KkCatalogEntry): string {
    return this.kkCatalog.ruleLocForMaterial(
      entry.groupCode,
      entry.productType,
      this.kkCatalogTypeMap,
      this.kkTypeHomeLocs
    );
  }

  private kkCatalogEffectiveLoc(entry: KkCatalogEntry): string {
    if (isB037Code(entry.groupCode)) return B037_REQUIRED_LOCATION;
    const saved = String(entry.location || '').trim();
    if (saved) return saved;
    return this.kkCatalogRuleLoc(entry);
  }

  async saveKkCatalogLocation(entry: KkCatalogEntry): Promise<void> {
    if (isB037Code(entry.groupCode)) {
      entry.location = B037_REQUIRED_LOCATION;
      this.kkCatalogLocCommitted.set(entry.groupCode, B037_REQUIRED_LOCATION.toUpperCase());
      this.cdr.detectChanges();
      return;
    }
    const next = String(entry.location || '').trim().toUpperCase();
    const prev = this.kkCatalogLocCommitted.get(entry.groupCode) || '';
    if (next === prev || this.kkCatalogSavingCode) return;
    this.kkCatalogSavingCode = entry.groupCode;
    try {
      await this.kkCatalog.saveGroupLocation(entry.groupCode, next);
      entry.location = next;
      this.kkCatalogLocCommitted.set(entry.groupCode, next);
    } catch (e) {
      console.error('saveKkCatalogLocation:', e);
      entry.location = prev;
      appAlert('Không lưu được vị trí của nhóm mã ' + entry.groupCode + '.');
    } finally {
      this.kkCatalogSavingCode = '';
      this.cdr.detectChanges();
    }
  }

  async loadKkCatalogPopup(forceRefresh = false): Promise<void> {
    this.kkCatalogLoading = true;
    this.cdr.detectChanges();
    try {
      this.kkCatalogEntries = await this.kkCatalog.loadAll(forceRefresh);
      this.kkCatalogTypeMap = await this.kkCatalog.loadAllAsMap();
      this.kkTypeHomeLocs = await this.kkCatalog.loadHomeLocs(forceRefresh);
      this.kkCatalogLocCommitted = new Map(
        this.kkCatalogEntries.map((entry) => [entry.groupCode, String(entry.location || '').trim().toUpperCase()])
      );
    } catch (e) {
      console.error('❌ loadKkCatalogPopup:', e);
      appAlert('❌ Không tải được Danh mục KK.');
      this.kkCatalogEntries = [];
    } finally {
      this.kkCatalogLoading = false;
      this.cdr.detectChanges();
    }
  }

  async downloadKkCatalogTemplate(): Promise<void> {
    const XLSX = await import('xlsx');
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
        appAlert('Không tìm thấy dòng hợp lệ. Cần cột "Nhóm mã" (B + 6 số, vd B001680) và "Loại hàng".');
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
      appAlert(`Đã import ${count} nhóm mã.`);
    } catch (e: any) {
      console.error('❌ processKkCatalogImportFile:', e);
      appAlert('Lỗi khi đọc file: ' + (e?.message || e));
    } finally {
      this.kkCatalogImporting = false;
      this.cdr.detectChanges();
    }
  }

  private async parseKkCatalogExcel(file: File): Promise<Array<{ groupCode: string; productType: string }>> {
    const XLSX = await import('xlsx');
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


  stopScanning(): void {
    this.stopNlCamera();
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
      appAlert(`✅ Đã tải template import tồn kho ${this.selectedFactory}!\n\n📁 File: ${fileName}\n\n💡 Hướng dẫn:\n- Điền thông tin theo mẫu\n- Import bằng nút "Import Inventory"`);

    } catch (error) {
      console.error('❌ Error downloading template:', error);
      appAlert('❌ Lỗi khi tải template: ' + error.message);
    }
  }

  downloadFIFOReport(): void {
    console.log(`Download FIFO report for ${this.selectedFactory}`);
  }

  /** Ẩn 1 dòng inventory → chuyển sang danh mục Ẩn (giữ 30 ngày). */
  async hideInventoryItem(material: InventoryMaterial): Promise<void> {
    if (!this.canDelete) {
      appAlert('❌ Bạn không có quyền ẩn item này. Vui lòng liên hệ admin để được cấp quyền.');
      return;
    }

    if (!material.id) {
      appAlert('❌ Không thể ẩn item: Không tìm thấy ID');
      return;
    }

    if (material.factory !== this.selectedFactory) {
      appAlert(`❌ LỖI BẢO MẬT: Không thể ẩn item từ ${material.factory} trong ${this.selectedFactory}!`);
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
      appAlert(
        n > 0
          ? `✅ Đã ẩn ${material.materialCode}. Xem lại trong More → Danh mục Ẩn.`
          : `⚠️ Không ẩn được ${material.materialCode}.`
      );
    } catch (error: any) {
      console.error('❌ Error hiding item:', error);
      appAlert(`❌ Lỗi khi ẩn item ${material.materialCode}: ${error?.message || 'Lỗi không xác định'}`);
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
  protected async hideInventoryDocsByIds(ids: string[], reason: InventoryHideReason): Promise<number> {
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

  /** Danh mục Ẩn đang mở có cho Pushback không (chỉ sau OTP). */
  hiddenPushbackUnlocked = false;

  /** More → Danh mục Ẩn: chỉ xem / tìm, không cần OTP. Pushback mở khóa riêng bằng OTP. */
  openHiddenInventoryView(): void {
    this.showMorePopup = false;
    this.hiddenSearchQuery = '';
    this.pushbackHiddenId = null;
    this.hiddenPushbackUnlocked = false;
    this.showHiddenInventoryPopup = true;
    void this.loadHiddenInventoryList();
  }

  /** Mở danh mục Ẩn sau khi đã OTP (không hỏi lại) — cho Pushback. */
  private openHiddenInventoryPopupDirect(): void {
    this.showMorePopup = false;
    this.hiddenSearchQuery = '';
    this.pushbackHiddenId = null;
    this.hiddenPushbackUnlocked = true;
    this.showHiddenInventoryPopup = true;
    void this.loadHiddenInventoryList();
  }

  closeHiddenInventoryPopup(): void {
    this.showHiddenInventoryPopup = false;
    this.hiddenInventoryRows = [];
    this.hiddenSearchQuery = '';
    this.hiddenLocFilter = '';
    this.hiddenLotFilter = '';
    this.hiddenReasonFilter = '';
    this.pushbackHiddenId = null;
  }

  private hiddenOptions(pick: (r: HiddenInventoryRow) => string): Array<{ v: string; n: number }> {
    const m = new Map<string, number>();
    this.hiddenInventoryRows.forEach((r) => {
      const v = pick(r) || '—';
      m.set(v, (m.get(v) || 0) + 1);
    });
    return Array.from(m, ([v, n]) => ({ v, n })).sort((a, b) => a.v.localeCompare(b.v, 'en', { numeric: true }));
  }

  get hiddenLocOptions(): Array<{ v: string; n: number }> {
    return this.hiddenOptions((r) => r.location);
  }

  /** Lô (IMD ddMMyyyy[nn]) mới nhất trước. */
  get hiddenLotOptions(): Array<{ v: string; n: number }> {
    const key = (v: string) => (/^[0-9]{8}/.test(v) ? v.slice(4, 8) + v.slice(2, 4) + v.slice(0, 2) + v.slice(8) : v);
    return this.hiddenOptions((r) => r.imd).sort((a, b) => key(b.v).localeCompare(key(a.v)));
  }

  get hiddenReasonOptions(): Array<{ v: string; n: number }> {
    return this.hiddenOptions((r) => r.hideReason);
  }

  get filteredHiddenInventoryRows(): HiddenInventoryRow[] {
    const q = (this.hiddenSearchQuery || '').trim().toLowerCase();
    const loc = this.hiddenLocFilter;
    const lot = this.hiddenLotFilter;
    const reason = this.hiddenReasonFilter;
    return this.hiddenInventoryRows.filter((row) => {
      if (loc && (row.location || '—') !== loc) return false;
      if (lot && (row.imd || '—') !== lot) return false;
      if (reason && (row.hideReason || '—') !== reason) return false;
      if (!q) return true;
      const hay = [
        row.imd,
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
          imd: String(data.batchNumber ?? '').trim(),
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
      appAlert(`❌ Lỗi tải danh mục Ẩn: ${error?.message || error}`);
      this.hiddenInventoryRows = [];
    } finally {
      this.isLoadingHiddenInventory = false;
    }
  }

  /** Đưa dòng từ danh mục Ẩn về lại inventory. */
  async pushbackHiddenItem(row: HiddenInventoryRow): Promise<void> {
    if (!row?.id || this.pushbackHiddenId) return;
    if (!this.canDelete) {
      appAlert('❌ Bạn không có quyền Pushback. Liên hệ admin.');
      return;
    }
    if (!this.materialsInventoryUnlock.isUnlocked()) {
      appAlert('❌ Phiên OTP đã hết hạn. Mở lại Danh mục Ẩn từ More và nhập mã OTP mới.');
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
        appAlert('⚠️ Dòng này không còn trong danh mục Ẩn.');
        this.hiddenInventoryRows = this.hiddenInventoryRows.filter((r) => r.id !== row.id);
        return;
      }
      if (invSnap.exists) {
        appAlert(
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

      appAlert(`✅ Đã Pushback ${row.materialCode} về inventory.`);
    } catch (error: any) {
      console.error('❌ pushbackHiddenItem:', error);
      appAlert(`❌ Lỗi Pushback: ${error?.message || error}`);
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
      case 'po-surplus':
        return 'PO dư sai (So sánh PO)';
      case 'delete-request':
        return 'Đề nghị xóa (quản lý đã duyệt)';
      default:
        return reason || '—';
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

  protected async resolveLocationOperatorId(): Promise<string> {
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
  protected kkOperatorIdCache: string | null = null;

  protected async resolveKkOperatorId(): Promise<string | null> {
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
      appAlert('Mã nhân viên không đúng. Nhập 4 số (vd: 0106) hoặc quét ASP + 4 số.');
      return null;
    }
    this.kkOperatorIdCache = shortCode;
    return shortCode;
  }

  /** Operator KK từ user đang login (không popup). */
  protected async resolveKkOperatorFromSession(): Promise<string> {
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
      appAlert('⚠️ Vui lòng nhập vị trí trước khi lưu.');
      return false;
    }
    if (newLocation === fromLocation) {
      if (!opts?.silent) {
        appAlert('Vị trí không đổi.');
      }
      return false;
    }

    const previousUiLocation = material.location;
    material.location = newLocation;

    const modifiedBy = await this.resolveLocationOperatorId();
    // Từ PASS vào kệ → tự tick KK bởi người đổi vị trí
    const kkAt = new Date();
    const passToShelf = isPassToShelf(fromLocation, newLocation);
    const updatePayload: Record<string, unknown> = {
      ...this.inventoryLocationWriteFields(newLocation),
      updatedAt: new Date(),
      lastModified: firebase.default.firestore.FieldValue.serverTimestamp(),
      modifiedBy,
      locationManualOverride: true,
      ...(passToShelf ? autoKkFields(modifiedBy, kkAt, 'pass-to-shelf') : {})
    };

    if ((newLocation === 'F62' || newLocation === 'F62TRA') && material.iqcStatus !== 'Pass') {
      material.iqcStatus = 'Pass';
      updatePayload.iqcStatus = 'Pass';
    }

    try {
      await this.firestore.collection('inventory-materials').doc(material.id).update(updatePayload);
      if (passToShelf) {
        material.kkChecked = true;
        material.kkBy = modifiedBy;
        material.kkAt = kkAt;
        void this.kkLogAdd(autoKkLog({
          inventoryDocId: material.id, factory: this.selectedFactory, materialCode: material.materialCode,
          poNumber: material.poNumber, batchNumber: material.batchNumber, location: newLocation,
          quantity: material.quantity, stock: this.calculateCurrentStock(material), unit: material.unit,
          by: modifiedBy, at: kkAt, source: 'pass-to-shelf'
        })).catch((e) => console.warn('KK log (pass-to-shelf)', e));
      }

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
        appAlert(`✅ Đã lưu vị trí: ${newLocation}`);
      }
      this.cdr.markForCheck();
      return true;
    } catch (error) {
      material.location = previousUiLocation;
      console.error('[ASM1] persistLocationChange failed', error);
      appAlert('❌ Không lưu được vị trí lên tồn kho. Vui lòng thử lại hoặc báo IT.');
      this.cdr.markForCheck();
      return false;
    }
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
      const sp = this.getEffectiveStandardPacking(material);
      if (
        sp &&
        sp > 0 &&
        !this.isMultipleOfStandardPacking(normalized, sp) &&
        !this.isQtyBagEqualsFullStockForPrint(material, normalized)
      ) {
        appAlert(
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
      const parsed = parseJRackLocation(slot);
      if (parsed && parsed.level && parsed.pos) {
        add(parsed.block, parsed.level, slot, parsed.pos);
      }
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

  layoutJBlockSlotCount(block: number): number {
    const hit = this.layoutJRackDiagram.find((b) => b.block === block);
    if (!hit) return 0;
    let n = 0;
    for (const lv of hit.levels) n += lv.cells.length;
    return n;
  }

  isLayoutJBlockFullyOn(block: number): boolean {
    const total = this.layoutJBlockSlotCount(block);
    return total > 0 && this.layoutJBlockSelectedCount(block) >= total;
  }

  /** Chọn / bỏ chọn cả block kệ. Kệ R lưu một mã R05-2, không bung từng mâm. */
  toggleLayoutJBlock(block: number): void {
    if (this.isLayoutJKhoMatGroup) {
      const hit = this.layoutJRackDiagram.find((b) => b.block === block);
      if (!hit) return;
      const slots = hit.levels.flatMap((lv) => lv.cells.map((c) => String(c.slot || '').trim().toUpperCase())).filter(Boolean);
      if (!slots.length) return;
      const allOn = slots.every((s) => this.layoutLocSelected.has(s));
      const next = new Set(this.layoutLocSelected);
      if (allOn) {
        for (const s of slots) next.delete(s);
      } else {
        for (const s of slots) next.add(s);
      }
      this.layoutLocSelected = next;
      return;
    }
    const rack = this.layoutJActiveRackNum();
    if (!rack || block < 1) return;
    const token = formatJRackBlock(rack, block);
    const next = new Set(this.layoutLocSelected);
    const on = this.isLayoutJBlockFullyOn(block);
    for (const s of Array.from(next)) {
      const p = parseJRackLocation(s);
      if (p && p.rack === rack && p.block === block) next.delete(s);
    }
    if (!on) next.add(token);
    this.layoutLocSelected = next;
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

  protected syncLayoutJFocusBlockFromSelection(): void {
    if (this.isLayoutJKhoMatGroup) {
      this.layoutJFocusBlock = null;
      return;
    }
    const rack = this.layoutJActiveRackNum();
    const tokens = Array.from(this.layoutLocSelected);
    const onlyWholeBlocks = tokens.length > 0 && tokens.every((t) => {
      const p = parseJRackLocation(t);
      return !!p && (!rack || p.rack === rack) && p.block > 0 && !p.level;
    });
    if (onlyWholeBlocks) {
      this.layoutJFocusBlock = null;
      return;
    }
    for (const b of this.layoutJRackDiagram) {
      if (b.levels.some((lv) => lv.cells.some((c) => this.isLayoutLocSlotOn(c.slot)))) {
        this.layoutJFocusBlock = b.block;
        return;
      }
    }
    this.layoutJFocusBlock = null;
  }

  isLayoutLocPickerRow(material: InventoryMaterial): boolean {
    return this.showLayoutLocPicker && this.layoutLocMaterial?.id === material.id;
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
    const tokens = this.layoutLocNormalizeTokens(parts);
    this.layoutLocSelected = new Set(tokens);
    const groups = getLayoutLocationGroups('J');
    const hit = this.layoutLocGroupFromTokens(tokens);
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
    for (const t of tokens) {
      const loc = this.displayLocationToken(t) || t;
      if (loc) next.add(loc);
    }
    this.layoutLocSelected = new Set(this.layoutLocNormalizeTokens(Array.from(next)));
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
    const key = this.displayLocationToken(String(slot || '').trim().toUpperCase()) || String(slot || '').trim().toUpperCase();
    if (!key) return;
    const next = new Set(this.layoutLocSelected);
    const parsed = parseJRackLocation(key);
    if (parsed && parsed.block && parsed.level) {
      const blockTok = formatJRackBlock(parsed.rack, parsed.block);
      if (next.has(blockTok)) {
        next.delete(blockTok);
        next.add(key);
        this.layoutLocSelected = next;
        return;
      }
    }
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.layoutLocSelected = next;
  }

  isLayoutLocSlotOn(slot: string): boolean {
    const key = this.displayLocationToken(String(slot || '').trim().toUpperCase()) || String(slot || '').trim().toUpperCase();
    if (!key) return false;
    if (this.layoutLocSelected.has(key)) return true;
    const parsed = parseJRackLocation(key);
    if (parsed && parsed.block) {
      return this.layoutLocSelected.has(formatJRackBlock(parsed.rack, parsed.block));
    }
    return false;
  }

  private layoutJActiveRackNum(): number {
    const m = /^R0*(\d+)$/i.exec(this.layoutLocActiveGroup?.id || '');
    return m ? Number(m[1]) : 0;
  }

  protected layoutLocNormalizeTokens(tokens: string[]): string[] {
    return compactJRackLocations(
      tokens
        .map((x) => this.displayLocationToken(normalizeLayoutLocToken(x, 'J')))
        .filter(Boolean)
    );
  }

  protected layoutLocGroupFromTokens(tokens: string[]): LayoutLocGroup | undefined {
    const groups = getLayoutLocationGroups('J');
    for (const t of tokens) {
      const p = parseJRackLocation(t);
      if (p) {
        const g = groups.find((x) => x.id === formatJRackAisle(p.rack));
        if (g) return g;
      }
    }
    const selectedUpper = new Set(tokens.map((s) => s.toUpperCase()));
    return groups.find((g) => g.slots.some((s) => selectedUpper.has(s.toUpperCase())));
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
    const locs = this.layoutLocNormalizeTokens(Array.from(this.layoutLocSelected));
    const mismatch = this.layoutLocSRuleMismatchMessage(locs);
    if (mismatch && !confirm(mismatch)) return;
    const pallet = String(this.layoutLocPalletDraft || '').trim().toUpperCase();
    const prevPallet = String(
      (material as { __prevPalletId?: string }).__prevPalletId ?? material.palletId ?? ''
    ).trim().toUpperCase();

    let locOk = false;
    if (locs.length) {
      material.location = this.normalizeMultiLocationValue(joinMultiLocations(locs));
      locOk = await this.persistLocationChange(material, {
        silent: true,
        bypassUnlock: this.showKkLocMap
      });
    }

    const palOk =
      pallet !== prevPallet ? await this.persistPalletChange(material, pallet, { silent: true, bypassUnlock: true }) : false;

    if ((locOk || palOk) && this.showKkLocMap) this.invalidateKkTypeViewCache();

    if (!locOk && !palOk) {
      appAlert('Chọn vị trí Kho J hoặc pallet rồi bấm Done.');
      return;
    }
    const savedLoc = material.location || '—';
    this.closeLayoutLocPicker();
    const bits: string[] = [];
    if (locOk) bits.push(`Vị trí: ${savedLoc}`);
    if (palOk || pallet) bits.push(`Pallet: ${pallet || '—'}`);
    appAlert(`✅ Đã lưu\n${bits.join('\n')}`);
  }

  rememberPalletBeforeEdit(material: InventoryMaterial): void {
    (material as { __prevPalletId?: string }).__prevPalletId = String(material.palletId || '');
  }

  onWhSelect(material: InventoryMaterial, value: string): void {
    void this.commitWhChange(material, value);
  }

  protected async commitWhChange(
    material: InventoryMaterial,
    raw: string,
    opts?: { silent?: boolean; bypassUnlock?: boolean }
  ): Promise<boolean> {
    if (!opts?.bypassUnlock && !this.isLocationColumnUnlocked && !this.canEdit) return false;
    const next = String(raw || '').trim().toUpperCase();
    if (next && next !== 'ASM3' && next !== 'J' && next !== 'J5' && next !== '00') return false;
    this.rememberLocationBeforeEdit(material);
    const bare = this.stripDoiKhoWhPrefix(String(material.location || '').trim());
    if (!bare && next) {
      appAlert('Nhập vị trí trước khi gán WH.');
      this.cdr.markForCheck();
      return false;
    }
    const nextLoc = this.composeLocationWithWh(next, material.location);
    if (this.normalizeMultiLocationValue(nextLoc) === this.normalizeMultiLocationValue(String(material.location || ''))) {
      return false;
    }
    material.location = nextLoc;
    return this.persistLocationChange(material, {
      silent: !!opts?.silent,
      bypassUnlock: !!opts?.bypassUnlock
    });
  }

  protected async persistPalletChange(
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
        appAlert(next ? `✅ Đã lưu pallet: ${next}` : '✅ Đã xóa pallet.');
      }
      this.cdr.markForCheck();
      return true;
    } catch (error) {
      material.palletId = previousUi;
      console.error('[ASM1] persistPalletChange failed', error);
      if (!opts?.silent) appAlert('❌ Không lưu được pallet. Vui lòng thử lại.');
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
    updateData.xtLe = Number(material.xtLe || 0) || 0;
    updateData.xtBags = Array.isArray(material.xtBags) ? material.xtBags : [];
    
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
  protected updateNegativeStockCount(): void {
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
      return sum + this.displayedBagCount(material);
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
    if (this.denyAction('edit')) return;
    if (!this.isManualStockEditOn) {
      appAlert('Tồn đầu đang khóa. Vào More → Manual ON (OTP Zalo ASP0106) để sửa.');
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
        maximumFractionDigits: isRmQtyDecimalFactory(this.selectedFactory) ? RM_QTY_DECIMALS_4 : 2
      });
    }
  }

  /** Standard theo Mã + PO: lấy Standard của lô (dòng tồn đang tải) nếu có, không thì danh mục. */
  stdForLot(materialCode: string, po?: string | null): number {
    const code = String(materialCode || '').trim().toUpperCase();
    const p = String(po || '').trim().toUpperCase();
    if (code && p) {
      const row = (this.inventoryMaterials || []).find((m) =>
        String(m.materialCode || '').trim().toUpperCase() === code &&
        String(m.poNumber || '').trim().toUpperCase() === p &&
        Number(m.lotStandardPacking) > 0);
      if (row) return Number(row.lotStandardPacking);
    }
    return this.getStandardPacking(code);
  }

  /** Các Standard khác nhau của mã theo từng PO (Standard lúc nhận) — 1 mã có thể nhiều Standard. */
  stdListTextForCode(materialCode: string): string {
    const code = String(materialCode || '').trim().toUpperCase();
    const set = new Set<number>();
    (this.inventoryMaterials || []).forEach((m) => {
      if (String(m.materialCode || '').trim().toUpperCase() !== code) return;
      const sp = this.getEffectiveStandardPacking(m);
      if (sp > 0) set.add(sp);
    });
    if (!set.size) {
      const c = this.getStandardPacking(code);
      return c ? this.formatNumber(c) : '—';
    }
    return [...set].sort((x, y) => x - y).map((v) => this.formatNumber(v)).join(' / ');
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
      appAlert('Bạn không có quyền tick KK trên tab này.');
      return;
    }
    if (!material?.id) return;
    void this.toggleKk(material);
  }

  /** Tick "đã kiểm kê" cho dòng — ghi kèm tài khoản đã tick vào đúng doc này, không đọc lại. */
  async toggleKk(material: InventoryMaterial): Promise<void> {
    if (!this.canEdit || !material.id || this.denyAction('kkTick')) return;
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
    const prevScanQty = this.getKkScanQty(material);
    material.kkChecked = next;
    material.kkBy = operator;
    material.kkAt = kkAt;
    if (!next) { material.kkScanCount = 0; material.kkScanQty = 0; }
    this.cdr.markForCheck();
    try {
      const payload: Record<string, unknown> = {
        kkChecked: next,
        kkBy: operator,
        kkAt,
        updatedAt: new Date()
      };
      if (!next) { payload.kkScanCount = 0; payload.kkScanQty = 0; }
      await this.firestore.collection('inventory-materials').doc(material.id).update(payload);
      // Vá 1 dòng trong cache KK — không xoá cả cache (đỡ phải nạp lại 10k doc
      // cho lần Kiểm tra KK kế tiếp, chính là lúc hay bị "đứng máy").
      this.patchKkInvSnapCache(material.id, {
        kkChecked: next,
        kkBy: operator,
        kkAt,
        ...(next ? {} : { kkScanCount: 0, kkScanQty: 0 })
      });
      if (next) {
        await this.kkLogAdd({
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
      material.kkScanQty = prevScanQty;
      this.cdr.markForCheck();
      appAlert('❌ Không lưu được trạng thái Kiểm kê.');
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
    appAlert('Vui lòng nhập Lượng chẵn bịch/cuộn rồi bấm Xác nhận.');
  }

  async openMobileKkConfirm(material: InventoryMaterial): Promise<void> {
    if (!this.canEdit || !material?.id || this.mobileKkConfirmBusy) return;
    const raw = this.getMobileKkSpDraft(material);
    const sp = parseFloat(String(raw).replace(/,/g, '').trim());
    if (!Number.isFinite(sp) || sp <= 0) {
      appAlert('Lượng chẵn bịch/cuộn phải > 0.');
      return;
    }
    const stock = this.calculateCurrentStock(material);
    if (stock <= 0) {
      appAlert('Tồn kho phải > 0 để kiểm kê.');
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
        appAlert('⚠️ Standard Packing của mã này đang Lock trên Danh mục NVL — không thể cập nhật từ Kiểm kê.');
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
      appAlert('❌ Không lưu được Kiểm kê / Standard Packing. Vui lòng thử lại.');
    } finally {
      this.mobileKkConfirmBusy = false;
    }
  }

  /** Mở sheet quét vị trí mới cho 1 dòng tồn. */
  openMobileLocationScan(material: InventoryMaterial): void {
    if (!material?.id || this.mobileLocScanBusy) return;
    this.nlScanDevice = 'pda';
    this.stopNlCamera();
    this.mobileLocScanMaterial = material;
    this.mobileLocScanBuffer = '';
    this.mobileLocScanWh = this.kkLineWhValue(material);
    this.showMobileLocScan = true;
    setTimeout(() => this.focusMobileLocScanInput(), 50);
  }

  cancelMobileLocationScan(force = false): void {
    if (this.mobileLocScanBusy && !force) return;
    this.mobileLocScanBusy = false;
    this.showMobileLocScan = false;
    this.mobileLocScanMaterial = null;
    this.mobileLocScanBuffer = '';
    this.mobileLocScanWh = '';
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
      appAlert('Vui lòng quét / nhập vị trí mới.');
      setTimeout(() => this.focusMobileLocScanInput(), 0);
      return;
    }

    this.mobileLocScanBusy = true;
    try {
      this.rememberLocationBeforeEdit(material);
      const oldLoc = String(material.location || '').trim().toUpperCase();
      const scannedNorm = this.normalizeKkScanLocation(newLoc) || newLoc;
      const prefixed = this.isNguyenLieuPage
        ? this.composeLocationWithWh(this.mobileLocScanWh, scannedNorm)
        : scannedNorm;
      let merged = this.mergeKkScanLocations(oldLoc, scannedNorm);
      if (prefixed && prefixed.toUpperCase() !== scannedNorm.toUpperCase()) {
        const parts = splitMultiLocations(merged).map((t) =>
          this.kkScanLocationsEqual(t, scannedNorm) ? prefixed : t
        );
        merged = this.normalizeMultiLocationValue(joinMultiLocations(parts));
      }
      const locWithWh = merged || prefixed;
      material.location = locWithWh;
      const ok = await this.persistLocationChange(material, { bypassUnlock: true, silent: true });
      if (ok) {
        this.showMobileLocScan = false;
        this.mobileLocScanMaterial = null;
        this.mobileLocScanBuffer = '';
        this.mobileLocScanWh = '';
        const whNote = this.isNguyenLieuPage
          ? `\nKho ${this.kkWarehouseLabel(this.kkWarehouseFromLocation(locWithWh))}`
          : '';
        appAlert(`✅ ${material.materialCode}\n${oldLoc || '—'} → ${locWithWh}${whNote}`);
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

  protected normalizeTimestamp(v: unknown): Date | null {
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

  get kkCheckProgressPercent(): number {
    if (!this.kkCheckTotalRows) return 0;
    return Math.min(100, (this.kkCheckCheckedRows / this.kkCheckTotalRows) * 100);
  }

  /** Tồn kho từ raw Firestore doc — cùng công thức calculateCurrentStock. */
  protected stockFromInventoryDoc(data: any): number {
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
      appAlert('❌ Lỗi khi chạy Kiểm Kê. Vui lòng thử lại.');
    } finally {
      if (runId === this.kkCheckRunId) {
        this.kkCheckRunning = false;
      }
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
      return this.filterKkExcludedDocs(docs);
    }

    const snapshot = await this.firestore
      .collection('inventory-materials', ref => ref.where('factory', '==', factory).limit(10000))
      .get()
      .toPromise();
    return (snapshot?.docs || []).filter((doc) => !isAsm3OrWh3PrefixLocation(String((doc.data() as any).location || '')))
      .filter((doc) => !MaterialsComponent.isKkExcludedCode((doc.data() as any).materialCode));
  }

  private resolveKkFactoryFromDocData(data: any): 'ASM1' | 'ASM2' | 'ASM3' {
    const location = String(data?.location || '');
    const rawFactory = String(data?.factory || '').trim().toUpperCase();
    if (rawFactory === 'ASM3' || isAsm3OrWh3PrefixLocation(location)) return 'ASM3';
    if (rawFactory === 'ASM2') return 'ASM2';
    return 'ASM1';
  }

  protected resolveKkFactoryForMaterial(material: InventoryMaterial): 'ASM1' | 'ASM2' | 'ASM3' {
    return this.resolveKkFactoryFromDocData(material);
  }

  protected toDateKey(value: Date | null | undefined): string {
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
    const sp = this.getEffectiveStandardPacking(material);
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

  /**
   * Khóa in QR: dòng thuộc quy tắc khóa (IMD từ ngày trong Matrix) và đã dùng lần in fix duy nhất.
   * Dòng thuộc quy tắc nhưng chưa in fix → vẫn in được 1 lần (isQrFixAvailable).
   */
  isQrLocked(material: InventoryMaterial): boolean {
    return this.isQrLockRule(material) && this.qrFixUsed(material) >= MaterialsComponent.QR_FIX_MAX;
  }

  /** Dòng bị khóa in QR nhưng còn lượt in để fix. */
  isQrFixAvailable(material: InventoryMaterial): boolean {
    return this.isQrLockRule(material) && this.qrFixUsed(material) < MaterialsComponent.QR_FIX_MAX;
  }

  /** Tạm thời: dòng bị khóa được in fix tối đa 10 lần (trước là 1). */
  static readonly QR_FIX_MAX = 10;

  private qrFixUsed(material: { qrFixPrintCount?: unknown; qrFixPrintedAt?: unknown } | null | undefined): number {
    const n = Number(material?.qrFixPrintCount);
    if (Number.isFinite(n) && n > 0) return n;
    return material?.qrFixPrintedAt ? 1 : 0;
  }

  qrFixLeft(material: InventoryMaterial): number {
    return Math.max(0, MaterialsComponent.QR_FIX_MAX - this.qrFixUsed(material));
  }

  /** Quy tắc khóa in QR cho dòng có IMD từ ngày trong Matrix trở đi (rule qrLockEnabled / qrLockImdFrom). */
  private isQrLockRule(material: InventoryMaterial): boolean {
    if (!this.ruleBool('qrLockEnabled')) return false;
    const from = matrixDateMs(this.matrixRules['qrLockImdFrom']);
    if (!from) return false;
    let ms = 0;
    const d: unknown = material?.importDate;
    if (d instanceof Date && !isNaN(d.getTime())) {
      ms = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    } else {
      const m = /^(\d{2})(\d{2})(\d{4})/.exec(this.getDisplayIMD(material).replace(/\D/g, ''));
      if (m) ms = new Date(+m[3], +m[2] - 1, +m[1]).getTime();
    }
    return ms >= from;
  }

  qrLockTitle(material?: InventoryMaterial): string {
    const d = String(this.matrixRules['qrLockImdFrom'] || '').split('-').reverse().join('/');
    const at = this.normalizeTimestamp(material?.qrFixPrintedAt);
    const fix = at
      ? ` · đã in ${this.qrFixUsed(material)} lần để fix, lần cuối ${at.toLocaleString('vi-VN')}${material?.qrFixPrintedBy ? ' bởi ' + material.qrFixPrintedBy : ''}`
      : '';
    return `Đã khóa — ${this.selectedFactory}, IMD từ ${d}${fix}`;
  }

  /**
   * Ghi dấu "đã in fix" trước khi in (transaction: máy khác vừa in thì từ chối). true = được in.
   */
  private async claimQrFixPrint(material: InventoryMaterial): Promise<boolean> {
    if (!material.id) {
      appAlert('❌ Dòng này chưa có mã tài liệu — không ghi được lần in fix.');
      return false;
    }
    const by = this.currentEmployeeId || '';
    const ref = this.firestore.firestore.collection('inventory-materials').doc(material.id);
    let nextCount = 0;
    try {
      const ok = await this.firestore.firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('Không tìm thấy dòng tồn kho.');
        const cur = snap.data() as any;
        const used = this.qrFixUsed(cur);
        if (used >= MaterialsComponent.QR_FIX_MAX) {
          material.qrFixPrintedAt = cur.qrFixPrintedAt;
          material.qrFixPrintedBy = cur.qrFixPrintedBy || '';
          material.qrFixPrintCount = used;
          return false;
        }
        nextCount = used + 1;
        tx.update(ref, { qrFixPrintedAt: new Date(), qrFixPrintedBy: by, qrFixPrintCount: nextCount });
        return true;
      });
      if (!ok) {
        appAlert(`🔒 ${this.qrLockTitle(material)}.`);
        return false;
      }
      material.qrFixPrintedAt = new Date();
      material.qrFixPrintedBy = by;
      material.qrFixPrintCount = nextCount;
      return true;
    } catch (e: any) {
      appAlert('❌ Không ghi được lần in fix: ' + (e?.message || e));
      return false;
    }
  }

  // Print QR Code for inventory items
  async printQRCode(material: InventoryMaterial): Promise<void> {
    if (this.denyAction('printQr')) return;
    if (this.isQrLocked(material)) {
      appAlert(`🔒 ${this.qrLockTitle(material)} (Matrix rule).`);
      return;
    }
    const fixPrint = this.isQrFixAvailable(material);
    if (fixPrint && !confirm(
      `🔒 Dòng ${material.materialCode} · PO ${material.poNumber || '—'} đang bị khóa in QR.\n\n` +
      `Còn ${this.qrFixLeft(material)}/${MaterialsComponent.QR_FIX_MAX} lần in để fix — hết lượt sẽ khóa luôn.\n\nTiếp tục in?`
    )) return;
    const QRCode = await import('qrcode') as any;
    try {
      console.log('🏷️ Generating QR code for ASM1 material:', material.materialCode);
      
      // Kiểm tra Rolls/Bags trước khi tạo QR
      const rollsOrBagsValue = material.rollsOrBags;
      if (!rollsOrBagsValue || 
          (typeof rollsOrBagsValue === 'string' && rollsOrBagsValue.trim() === '') ||
          parseFloat(String(rollsOrBagsValue).replace(/,/g, '')) <= 0) {
        appAlert('❌ Không thể in tem QR!\n\nLý do: Thiếu Rolls/Bags\n\nVui lòng nhập số lượng Rolls/Bags trước khi in tem QR.');
        return;
      }
      
      // QTY BAG nhập để in tem — không được lớn hơn tồn kho
      const qtyBagRaw = parseFloat(String(material.rollsOrBags).replace(/,/g, '')) || 0;
      const totalQuantity = this.calculateCurrentStock(material);
      
      if (!totalQuantity || totalQuantity <= 0) {
        appAlert('❌ Vui lòng nhập số lượng trước khi tạo QR code!');
        return;
      }

      if (qtyBagRaw > totalQuantity) {
        appAlert('❌ Không thể in tem QR!\n\nQTY BAG không được lớn hơn tồn kho.\n\nTồn kho: ' + this.formatNumber(totalQuantity) + '\nQTY BAG: ' + this.formatNumber(qtyBagRaw));
        return;
      }

      const qtyBag = qtyBagRaw > 0 ? qtyBagRaw : totalQuantity;
      
      // Rule in tem:
      // - Số tem chuẩn = QTY BAG / Standard Packing
      // - Tem tồn = Tồn kho - QTY BAG
      const standardPacking = this.getEffectiveStandardPacking(material);
      if (!standardPacking || standardPacking <= 0) {
        appAlert('❌ Standard Packing phải > 0 để in tem theo quy tắc mới.');
        return;
      }
      if (qtyBag <= 0) {
        appAlert('❌ QTY BAG phải > 0.');
        return;
      }

      const bagTotal = this.effectiveTotalBags(material);
      if (!bagTotal || bagTotal < 1) {
        appAlert('❌ Không thể in tem QR - thiếu BAG (Số bịch).');
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
        appAlert('❌ Vui lòng nhập đơn vị hợp lệ trước khi tạo QR code!');
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

      // Dòng bị khóa: chỉ in khi ghi được lượt in fix (tối đa QR_FIX_MAX)
      if (fixPrint && !(await this.claimQrFixPrint(material))) return;

      // Create print window
      this.createQRPrintWindow(qrImages, material, isPartialLabel);
      
    } catch (error) {
      console.error('❌ Error generating QR code for ASM1:', error);
      appAlert('❌ Lỗi khi tạo QR code: ' + error.message);
    }
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

  /** Nhãn kho hiển thị ở cột WH — J5-/kệ J → J; ASM3-/WH3- → ASM3. */
  locationWhTag(location: string | null | undefined): string {
    const raw = String(location || '').trim().toUpperCase();
    if (raw === '00' || raw.startsWith('00-') || raw.startsWith('00+')) return '00';
    if (this.isJWarehouseToken(raw)) return 'J';
    if (raw === 'TIEUHUY' || raw.startsWith('TIEUHUY')) return 'TIEUHUY';
    if (raw.startsWith('ASM3-') || raw.startsWith('WH3-') || raw.startsWith('ASM3')) return 'ASM3';
    return '';
  }

  /** Prefix ghi vào location: kho J không gắn J5- — giữ nguyên vị trí đã ghi. */
  private whWritePrefix(wh: string): string {
    const t = String(wh || '').trim().toUpperCase();
    if (t === 'J' || t === 'J5') return '';
    return t;
  }

  /** TRA / F62TRA: giữ nguyên tên, không gắn J5-. */
  private isTraLocationToken(loc: string): boolean {
    const c = this.locationCompact(this.stripDoiKhoWhPrefix(loc) || loc);
    return c === 'TRA' || c === 'F62TRA' || c.startsWith('F62TRA') || c.endsWith('TRA');
  }

  /** Locker / BOX: không gắn J5- khi chọn kho J. */
  private isLockerOrBoxToken(loc: string): boolean {
    const raw = String(loc || '').trim();
    const body = this.stripDoiKhoWhPrefix(raw);
    return isLockerPrefixLocation(raw) || isLockerPrefixLocation(body)
      || isBoxPrefixLocation(raw) || isBoxPrefixLocation(body);
  }

  /** Gắn tiền tố kho; kho J giữ nguyên vị trí (không thêm J5-). */
  private composeLocationWithWh(wh: string, location: string): string {
    const raw = String(location || '').trim();
    const tokens = splitMultiLocations(raw);
    const list = tokens.length ? tokens : [raw];
    const nextWh = String(wh || '').trim().toUpperCase();
    return joinMultiLocations(
      list.map((token) => {
        const bare = this.stripDoiKhoWhPrefix(String(token || '').trim());
        if (!bare) return '';
        if (!nextWh) return bare;
        if (nextWh === 'J' || nextWh === 'J5') {
          return bare.toUpperCase();
        }
        const prefix = this.whWritePrefix(nextWh);
        return prefix ? `${prefix}-${bare}` : bare;
      }).filter(Boolean)
    );
  }

  /** Bỏ tiền tố J5-/J-/WH3-/ASM3-/00- cũ trước khi gắn tiền tố mới. */
  protected stripDoiKhoWhPrefix(location: string): string {
    const raw = String(location || '').trim();
    const m = /^(J5|J|WH3|ASM3|00|TIEUHUY)-(.+)$/i.exec(raw);
    return m ? m[2] : raw;
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
      appAlert(`❌ Lỗi khi reset ${this.selectedFactory}: ${error?.message || error}`);
    } finally {
      this.isResetting = false;
    }
  }

  async deleteSelectedLowStock(): Promise<void> {
    if (!this.canDelete) {
      appAlert('❌ Bạn không có quyền Ẩn / xóa dòng. Liên hệ admin để được cấp quyền.');
      return;
    }
    const selected = this.resetLowStockRows.filter((r) => r.selected);
    if (selected.length === 0) {
      appAlert('Chưa chọn mã nào để ẩn.');
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
      appAlert(`✅ Đã ẩn ${hiddenCount} mã tồn < 1. Xem More → Danh mục Ẩn.`);
    } catch (error: any) {
      console.error('❌ Error hiding low-stock items:', error);
      appAlert(`❌ Lỗi khi ẩn: ${error?.message || error}`);
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
      appAlert(`✅ Không có mã hàng nào trong ${this.selectedFactory}`);
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
      appAlert(`✅ Không có mã tồn = 0 hoặc tồn < 1 trong ${this.selectedFactory}`);
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
        appAlert(
          `✅ Đã ẩn ${hiddenZero} mã tồn = 0.\nCòn ${lowStockRows.length} mã tồn < 1 — tick chọn và bấm Ẩn trong popup.`
        );
      }
    } else {
      appAlert(`✅ Reset hoàn thành!\nĐã ẩn ${hiddenZero} mã tồn = 0.`);
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
        appAlert(`✅ Không có dữ liệu tồn kho nào trong ${factory}`);
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
        appAlert('❌ Nhà máy đang chọn đã thay đổi trong lúc xác nhận. Thao tác bị hủy để tránh xóa nhầm dữ liệu.');
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

      appAlert(
        `✅ Reset hoàn thành!\n\n` +
        `Đã xóa ${deletedCount} mã hàng từ ${factory}\n\n` +
        `Bạn có thể import dữ liệu mới ngay bây giờ.`
      );

    } catch (error) {
      console.error(`❌ Error during ${factory} complete reset:`, error);
      this.isLoading = false;
      appAlert(`❌ Lỗi khi reset toàn bộ ${factory}: ${error.message}`);
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

  protected escapeHtmlForPrint(s: string): string {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── In Tùy Chỉnh ───────────────────────────────────────────────────────────

  openCustomPrintDialog(): void {
    if (this.denyAction('printLabels')) return;
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

    if (!code) { appAlert('Vui lòng nhập Mã hàng.'); return; }
    if (!po)   { appAlert('Vui lòng nhập PO.'); return; }
    if (!qty || isNaN(Number(qty.replace(/,/g, ''))) || Number(qty.replace(/,/g, '')) <= 0) {
      appAlert('Vui lòng nhập Qty hợp lệ (> 0).'); return;
    }

    // Mở cửa sổ in NGAY trong click handler để tránh bị chặn popup (do code bên dưới có await).
    const printWindow = window.open('', '_blank');
    if (!printWindow) { appAlert('❌ Không thể mở cửa sổ in. Vui lòng cho phép popup!'); return; }

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

      await this.createQRPrintWindow(qrImages, null, false, false, [], printWindow);
    } catch (e: any) {
      console.error('[Custom Print] error', e);
      appAlert('❌ Lỗi khi tạo tem: ' + (e?.message || e));
      try { printWindow.close(); } catch {}
    } finally {
      this.customPrintBusy = false;
    }
  }

  /**
   * In tem QR nguyên liệu — cùng format tem Inbound (material-qr-label.util).
   * Lô / Loại hình lấy theo dòng tồn kho khớp Mã + PO + IMD trên QR.
   */
  private async createQRPrintWindow(
    qrImages: any[],
    material: InventoryMaterial | null,
    isPartialLabel: boolean = false,
    hideQtyAndBag: boolean = false,
    sourceRows: InventoryMaterial[] = [],
    targetWindow: Window | null = null
  ): Promise<void> {
    const printWindow = targetWindow || window.open('', '_blank');

    if (!printWindow) {
      appAlert('❌ Không thể mở cửa sổ in. Vui lòng cho phép popup!');
      return;
    }

    try {
      const labels = this.buildMaterialQrLabels(qrImages, [material, ...sourceRows], hideQtyAndBag);
      await this.attachMaterialQrLabelHomeLocs(labels);
      printWindow.document.write(buildMaterialQrLabelDocument(labels));
      printWindow.document.close();
      console.log(`✅ QR labels created with Inbound format - ${labels.length} labels${isPartialLabel ? ' (Tem lẻ)' : ' (Tem chuẩn)'}`);
    } catch (e: any) {
      console.error('❌ createQRPrintWindow error:', e);
      try { printWindow.close(); } catch {}
      appAlert('❌ Lỗi khi tạo tem: ' + (e?.message || e));
    }
  }

  private buildMaterialQrLabels(
    qrImages: any[],
    rows: Array<InventoryMaterial | null | undefined>,
    hideQtyAndBag: boolean
  ): MaterialQrLabel[] {
    const meta = new Map<string, { batchNumber: string; type: string }>();
    const addRow = (m: InventoryMaterial | null | undefined) => {
      if (!m?.id) return;
      const code = this.normalizeMaterialCodeUpper(m.materialCode);
      const po = String(m.poNumber || '').trim();
      const value = { batchNumber: String(m.batchNumber || ''), type: String(m.type || '') };
      const exact = `${code}|${po}|${this.getImdKeyForMaterial(m)}`;
      if (!meta.has(exact)) meta.set(exact, value);
      if (!meta.has(`${code}|${po}`)) meta.set(`${code}|${po}`, value);
    };
    rows.forEach(addRow);
    (this.inventoryMaterials || []).forEach(addRow);

    return qrImages.map((qr): MaterialQrLabel => {
      if (qr?.kind === 'lsxHeader' || qr?.kind === 'spacer') {
        return { kind: qr.kind, qrData: '', lsxText: qr.lsxText };
      }
      const qrData = String(qr?.qrData || '');
      const f = parseMaterialQrLabelFields(qrData);
      const code = this.normalizeMaterialCodeUpper(f.materialCode);
      const found = meta.get(`${code}|${f.po}|${f.imd}`) || meta.get(`${code}|${f.po}`);
      const batchNumber = qr?.batchNumber ?? found?.batchNumber ?? '';
      const labelType = qr?.labelType ?? found?.type ?? '';
      const isCarton = hideQtyAndBag || stripTemThungMarker(qrData.split('|')[0] || '').isTemThung;
      const [ci, ct] = f.bag.split('/');
      return {
        kind: isCarton ? 'carton' : 'bag',
        qrImage: qr?.image || qr?.qrImage || '',
        qrData,
        batchNumber,
        labelType: formatMaterialLabelType(labelType),
        iconType: materialLabelTraIconType(batchNumber),
        displayPrefix: qr?.displayPrefix,
        cartonIndex: isCarton ? Number(ci) || 1 : undefined,
        cartonTotal: isCarton ? Number(ct) || 1 : undefined
      };
    });
  }

  /** Vị trí yêu cầu góc tem — theo Danh mục vị trí (giống Inbound). */
  private async attachMaterialQrLabelHomeLocs(labels: MaterialQrLabel[]): Promise<void> {
    const real = labels.filter((l) => l.kind === 'bag' || l.kind === 'carton');
    if (!real.length) return;
    try {
      const [typeMap, homeLocs] = await Promise.all([
        this.kkCatalog.loadAllAsMap(),
        this.kkCatalog.loadHomeLocs()
      ]);
      const cache = new Map<string, string>();
      for (const label of real) {
        const code = parseMaterialQrLabelFields(label.qrData).materialCode;
        if (!cache.has(code)) cache.set(code, this.kkCatalog.assignedLocForMaterial(code, typeMap, homeLocs));
        label.homeLoc = cache.get(code) || '';
      }
    } catch (e) {
      console.warn('attachMaterialQrLabelHomeLocs failed:', e);
    }
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
        baseMaterial.xtLe = group.reduce((sum, m) => sum + (m.xtLe || 0), 0);
        
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
        appAlert('✅ Không có dòng trùng lặp nào để gộp!');
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
        baseMaterial.xtLe = group.reduce((sum, m) => sum + (m.xtLe || 0), 0);
        
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
      
      appAlert(`✅ GỘP DÒNG HOÀN TẤT!\n\n` +
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
      appAlert(`❌ Lỗi khi gộp dòng: ${error.message}\n\nVui lòng thử lại!`);
    } finally {
      this.isLoading = false;
    }
  }

  /** Tải Excel toàn bộ kết quả đang search (filteredInventory). */
  async downloadSearchResultsExcel(): Promise<void> {
    if (!this.filteredInventory?.length) {
      appAlert('Không có dữ liệu để tải. Hãy search trước.');
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
        'Xuất lẻ': m.xtLe ?? this.getXtLeTotal(m),
        'Tồn kho': this.calculateCurrentStock(m),
        'Vị trí': m.location || '',
        'Loại Hình': m.type || '',
        'Lưu ý': m.remarks || '',
        'Standard Packing': this.getEffectiveStandardPacking(m),
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
      appAlert(`✅ Đã tải ${exportData.length} dòng kết quả search.\n\nFile: ${fileName}`);
    } catch (error: any) {
      console.error('❌ Download search Excel error:', error);
      appAlert('❌ Lỗi tải file Excel: ' + (error?.message || error));
    } finally {
      this.isDownloadingSearch = false;
    }
  }

  // Export inventory data to Excel
  async exportToExcel(): Promise<void> {
    const XLSX = await import('xlsx');
    if (!this.canExport) {
      appAlert('Bạn không có quyền xuất dữ liệu');
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
        'Xuất lẻ': material.xtLe || this.getXtLeTotal(material),
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
      appAlert(`✅ Đã xuất ${exportData.length} records ra file Excel`);
      
    } catch (error) {
      console.error('❌ Export error:', error);
      appAlert('Lỗi export: ' + error.message);
    }
  }

  // ── Cờ mở popup chỉ dùng ở trang Kiểm kê: để ở lớp cha vì điều kiện *ngIf ngoài cùng của template dùng chung được AOT kiểm tra ──
  showNlPdaScan = false;
  showKkScanGuide = false;
  showKkShelfLabelPicker = false;
  showKkMucReportPicker = false;
  showKkCodeLookup = false;

  showKkLog = false;

  // ===== Log Zalo đủ / thiếu: nhân viên rep tin tồn kho của bot bằng "đủ" / "thiếu" (zalo-material-check-log) =====
  showZaloCheckLog = false;

  /** In bảng đang hiện (mọi dòng đang lọc) — khổ A4 ngang. */
  /** Popup chọn in có / không lịch sử KK. */
  kkPrintChoice = false;

  // ===== Report cảnh báo KK =====
  showKkWarnReport = false;


  // ===== Matrix rule & quyền (materials-matrix.ts) — mỗi nhà máy 1 doc app-settings/materials-matrix-<factory> =====
  readonly matrixRuleDefs = RULE_DEFS;

  private async openTemLeGwStep(res: TemLeSplitResult, code: string, po: string, imd: string, sourceQty: number): Promise<void> {
    let gwFull = 0;
    let std = this.stdForLot(code, po) || 0;
    try {
      const cat = await this.nvlCatalogFull.getByCode(code);
      gwFull = catalogBagWeight(cat);
      if (!std) std = Number(cat?.standardPacking) || 0;
    } catch { /* thiếu danh mục → yêu cầu nhập GW bag nguyên */ }
    this.temLeGwStep = {
      logId: res.logId, code, po, imd, clTag: res.clTag, clQty: res.clQty,
      fullQty: std || sourceQty, gwFull, gwFullKnown: gwFull > 0
    };
    this.temLeGwCl = null;
    this.temLeGwFullInput = null;
    this.temLeGwMsg = '';
    this.temLeGwOk = null;
    this.cdr.detectChanges();
    setTimeout(() => (document.getElementById('tem-le-gw-cl') as HTMLInputElement | null)?.focus(), 50);
  }

  /** Menu thả xuống trên thanh chi tiết box: Lọc / Thao tác / Xuất. */
  kkTypeMenu: 'filter' | 'action' | 'export' | null = null;

  toggleKkTypeMenu(menu: 'filter' | 'action' | 'export', event?: Event): void {
    event?.stopPropagation();
    this.kkTypeMenu = this.kkTypeMenu === menu ? null : menu;
  }

}
