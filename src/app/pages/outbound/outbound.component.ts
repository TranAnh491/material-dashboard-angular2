import { appAlert } from '../../shared/app-toast';
import { RolePermissionService } from '../../services/role-permission.service';
import { isBsLsx, stripBsLsx, toBsLsx } from '../../shared/lsx-bo-sung';
import { isRmQtyDecimalFactory, parseRmScanQty, roundRmQty, RM_QTY_DECIMALS_4 } from '../../services/rm-scan-qty.util';
import { WeekFormat, fmtDmy, isWeekTrackedCode, weekCodeText, weekStatusText, weekWindow } from '../../shared/week-code';
import { WeekInputResult } from '../../shared/week-input-popup/week-input-popup.component';
import { PxkWeightCheckReportService } from '../../services/pxk-weight-check-report.service';
import { WEIGH_EXEMPT_REASONS, WEIGH_EXEMPT_OTHER, buildWeighExemptReason, needsWeigh, temLeMustWeigh, WEIGH_TOLERANCE_PERCENT } from '../../services/weigh-exempt-report';
import { buildMaterialQrLabelDocument } from '../../services/material-qr-label.util';
import { Component, OnInit, OnDestroy, ChangeDetectorRef, ElementRef, ViewChild, HostListener, inject } from '@angular/core';
import { WeekRulesService } from '../../services/week-rules.service';
import { Router, ActivatedRoute } from '@angular/router';
import { Subject, firstValueFrom } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { FirebaseAuthService } from '../../services/firebase-auth.service';
import { getDefaultRmFactory } from '../../services/rm-factory-preference.util';
// Chỉ dùng làm kiểu — `import type` bị xóa khi biên dịch nên không kéo html5-qrcode
// vào chunk outbound (scanner này không được khởi tạo ở đây).
import type { Html5Qrcode } from 'html5-qrcode';
import { FactoryAccessService } from '../../services/factory-access.service';
import { RmBagHistoryService } from '../../services/rm-bag-history.service';
import { TemLeClService } from '../../services/tem-le-cl.service';
import { OutboundLsxLogService, OutboundLsxLogLine } from '../../services/outbound-lsx-log.service';
import { OutboundQcRuleService } from '../../services/outbound-qc-rule.service';
import { WorkOrderOutboundCreatedByService } from '../../services/work-order-outbound-created-by.service';
import { ReadTrackerService } from '../../services/read-tracker.service';
import { QRScannerService, QRScanResult } from '../../services/qr-scanner.service';
import { MatDialog } from '@angular/material/dialog';
import { QRScannerModalComponent, QRScannerData } from '../../components/qr-scanner-modal/qr-scanner-modal.component';
import { NvlCatalogFullService } from '../../services/nvl-catalog-full.service';
import { SxxkSuspectService } from '../../services/sxxk-suspect.service';
import { TemXuatKhoService } from '../../services/tem-xuat-kho.service';
import { stripTemThungMarker } from '../../services/tem-thung-qr.util';
import * as firebase from 'firebase/compat/app';
import * as XLSX from 'xlsx';
import { ClientReloadService } from '../../services/client-reload.service';
import { PxkOddWeighService } from '../../services/pxk-odd-weigh.service';

/** Bag lẻ cần chụp hình + cân khi scan xuất (Check lượng PXK). */
interface OddWeighCtx {
  lsx: string;
  code: string;
  po: string;
  maKho: string;
  exportQty: number;
  std: number;
  /** Phần lẻ theo PXK (lượng xuất − bội số Standard) */
  oddQty: number;
  /** Lượng bag vừa scan */
  bagQty: number;
  /** Trọng lượng chẵn cuộn trong danh mục NVL (0 = chưa có) */
  catalogWeight: number;
}

/** Một dòng scan trong phiên xuất BS */
export interface BsScanLine {
  materialCode: string;
  po: string;
  imd: string;
  qty: number;
  rawQr: string;
}

/** Một dòng vật tư cần xuất Bổ Sung, đọc từ pxk-bs-data */
export interface BsPendingItem {
  docId: string;
  lsx: string;
  factory: string;
  lineIndex: number;
  materialCode: string;
  po: string;
  quantity: number;
  unit: string;
  tenVatTu?: string;
  done?: boolean;
  /** Đã scan xuất (BS done hoặc có outbound-materials). */
  exported?: boolean;
  iqcStatus?: string;
  /** Ngày import phiếu BS. */
  importedAt?: Date | null;
  /** Lượng đã xuất ở các lần Done trước (scan chưa đủ → lưu phần đã scan, chờ scan tiếp). */
  prevExported?: number;
  /** Đã ẩn khỏi danh sách BS (bỏ ẩn được). */
  hidden?: boolean;
  /** Đã xóa khỏi danh sách BS (nút Xóa). */
  deleted?: boolean;
}

export interface PxImportAlloc {
  inventoryId: string;
  imd: string;
  qty: number;
  available: number;
  location: string;
}

export interface PxImportRow {
  lsx: string;
  materialCode: string;
  poNumber: string;
  qty: number;
  imd: string;
  available: number;
  status: 'ok' | 'no-match' | 'short' | 'done' | 'error';
  message: string;
  selected: boolean;
  allocations: PxImportAlloc[];
}

export interface BsImportPreviewRow {
  lsx: string;
  materialCode: string;
  po: string;
  quantity: number;
  unit: string;
  tenVatTu: string;
}

/** LSX mặc định khi file Import BS không có / để trống cột LSX */
/** Phiếu BS không có LSX (file ghi N/A / trống) — hiển thị N/A. Dữ liệu cũ lưu 'LSX Chung' vẫn được nhận. */
export const BS_COMMON_LSX = 'N/A';

export interface OutboundMaterial {
  id?: string;
  factory?: string;
  materialCode: string;
  poNumber: string;
  quantity: number;
  unit: string;
  exportQuantity: number;
  /** Số xuất kho lẻ (QTY < Standard Packing), giữ phần thập phân. Ví dụ 112.85. */
  leQty?: number;
  /** Số lần đã scan/xuất cùng một dòng (không cộng dồn quantity, chỉ đếm số lần). */
  scanCount?: number;
  exportDate: Date;
  location: string;
  exportedBy: string;
  batch?: string;
      batchNumber?: string; // Batch number từ QR code
  /** Bịch quét (i/tổng từ QR phần 4, VD: 3/10) */
  bagBatch?: string;
  /** Cột Bag: số bịch hiện tại, có hậu tố tách VD `5(T1)` */
  bagNumberDisplay?: string;
  scanMethod?: string;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
  productionOrder?: string; // Lệnh sản xuất
  employeeId?: string; // Mã nhân viên
  importDate?: string; // Ngày nhập từ QR code để so sánh chính xác với inventory
  /** UI-only: đánh dấu bag bị trùng giữa nhiều LSX khi search theo mã hàng */
  bagDuplicate?: boolean;
  /** Dòng xem nhanh từ pending scan (mobile, phiên batch), không có bản ghi Firestore */
  pendingPreview?: boolean;
  /** Phân loại QTY vs Standard Packing: chẵn (=SP) / lẻ (<SP) — UI */
  packKind?: 'chan' | 'le' | 'bypass' | 'over' | 'unknown';
}

/** 1 dòng tiến độ PXK của LSX (lượng + bag theo Standard Packing). */
type ScanPxkRow = {
  code: string; po: string; need: number; exported: number; scanned: number; remain: number;
  std: number; needBags: number; doneBags: number; remainFull: number; remainOddQty: number;
  /** Lượng cần = needFull bag chẵn × std + needOdd */
  needFull: number; needOdd: number;
  /** Tồn kho mã + PO (null = chưa đọc xong) */
  stock: number | null;
};

/** Đếm bag CL lẻ duy nhất còn lại của mã PCS (tồn mã < 5000). */
type ClCountCtx = { code: string; po: string; imd: string; oddQty: number; remainAfter: number; totalAfter: number; unit: string };

/** 1 dòng tồn kho (theo IMD) của mã + PO — để chọn bịch tách tem lẻ. */
type PxkInvLot = { imd: string; po: string; stock: number; importMs: number; /** Standard của lô (Inbound ghi lúc nhận hàng), 0 = chưa có → dùng danh mục */ std: number };

/** Bịch được chọn để tách tem lẻ ở Outbound. */
type TemLeSourcePick = {
  /**
   * LAST = PO chỉ còn 1 bag lẻ (≤ lượng lẻ cần) → xuất nguyên bag, không tách, không CL.
   * ODD = bag lẻ đang tồn của lô (tồn không chia hết Standard, vd 2300/500 → bag 300) → tách từ bag đó.
   * COMBO = bag lẻ đang tồn NHỎ hơn lượng lẻ cần (vd 539 < 611), cùng IMD còn bịch chẵn →
   *         gom bag lẻ + phần thiếu (72) tách từ bịch chẵn thành 1 bịch TL 611, CL 1.928 để lại.
   *         sourceQty = bịch chẵn + bag lẻ (2.539).
   */
  kind: 'CL' | 'FULL' | 'EXACT' | 'LAST' | 'ODD' | 'COMBO';
  imd: string; po: string; sourceQty: number; clTag: string; bagFraction: string;
  /** COMBO: lượng bag lẻ được gom vào bịch TL. */
  partQty?: number;
  /** FULL khi IMD còn ghi nhận CL nhưng tồn chia hết Standard → CL treo, tách bịch chẵn và thay CL. */
  staleCl?: string;
};

@Component({
  selector: 'app-outbound',
  templateUrl: './outbound.component.html',
  styleUrls: ['./outbound.component.scss', './lsx-filter-styles.scss', './outbound-mobile.scss']
})
export class OutboundComponent implements OnInit, OnDestroy {
  materials: OutboundMaterial[] = [];
  filteredMaterials: OutboundMaterial[] = [];
  selectedFactory: 'ASM1' | 'ASM2' = 'ASM1';
  readonly factoryOptions: Array<'ASM1' | 'ASM2'> = ['ASM1', 'ASM2'];
  currentPage: number = 1;
  itemsPerPage: number = 50;
  totalPages: number = 1;
  isLoading: boolean = false;
  errorMessage: string = '';
  private destroy$ = new Subject<void>();
  
  // QR Scanner properties
  isCameraScanning: boolean = false;
  isScannerLoading: boolean = false;
  scanner: Html5Qrcode | null = null;
  lastScannedData: any = null;
  exportQuantity: number = 0;
  
  // Mobile Scanner Selection
  selectedScanMethod: 'camera' | 'scanner' | null = null; // 🔧 SỬA LỖI: Không chọn gì mặc định
  isMobile: boolean = false;
  
  // REMOVED: processedScans - không cần duplicate detection nữa
  
  // Physical Scanner properties
  isScannerInputActive: boolean = false;
  scannerBuffer: string = '';
  scannerTimeout: any = null;
  scanStartTime: number = 0;
  
  // Batch Scanning Mode properties
  isBatchScanningMode: boolean = false;
  batchProductionOrder: string = '';
  batchEmployeeId: string = '';
  isProductionOrderScanned: boolean = false;
  isEmployeeIdScanned: boolean = false;
  /** Phiên NV khi mở tab Xuất kho: bắt buộc quét ASP, tự hết hạn 12:00 / 17:00 / 20:00 */
  private static readonly OPERATOR_SESSION_KEY = 'rm-outbound-operator-session-v1';
  operatorSessionId = '';
  operatorSessionUntil: Date | null = null;
  operatorSessionInput = '';
  operatorSessionError = '';
  private operatorExpiryTimer: any;
  private readonly onOperatorVisibilityChange = () => this.checkOperatorSessionExpiry();
  /** Mã + PO + SL PXK của LSX đang scan. Scan xuất NL phải khớp mã/PO; SL dư trong 1 lần scan thì từ chối. */
  private batchPxkPairs: { code: string; po: string; qty: number; maKho: string }[] = [];
  private batchPxkCachedLsx = '';
  private batchPxkLoading: Promise<void> | null = null;
  /** Đã xuất (outbound-materials) theo mã|PO của LSX đang scan — để chặn scan dư. */
  private batchPxkExportedByKey = new Map<string, number>();
  
  // Scan queue to avoid losing scans during rapid input
  private isProcessingMaterialScan: boolean = false;
  private materialScanQueue: string[] = [];
  
  // 🔧 LOGIC MỚI SIÊU TỐI ƯU: Chỉ lưu dữ liệu scan, Done mới update
  pendingScanData: any[] = []; // Lưu trữ tạm thời các scan
  showScanReviewModal: boolean = false; // Hiển thị modal review
  isSavingBatchData: boolean = false; // Trạng thái đang lưu dữ liệu
  // - Bước 1: Scan lệnh sản xuất và mã nhân viên
  // - Bước 2: Scan mã hàng (Material + PO + Quantity) - lưu vào pendingScanData
  // - Bước 3: Bấm Done -> batch update inventory + Firebase
  currentScanStep: 'batch' | 'material' = 'batch';
  isWaitingForMaterial: boolean = false;
  
  // Date Range properties
  startDate: string = '';
  endDate: string = '';
  showOnlyToday: boolean = true;
  
  // Production Order Filter properties
  selectedProductionOrder: string = '';
  searchProductionOrder: string = '';
  /** Lọc nhanh danh sách lịch sử đang xem (không query lại). */
  historyFilterPo = '';
  historyFilterLsx = '';

  onSearchProductionOrderChange(value: string): void {
    this.searchProductionOrder = (value || '').toUpperCase();
  }
  /** Search theo mã hàng / QR (Material|PO|...|IMD...): hiển thị lịch sử xuất trong khoảng ngày; highlight bag trùng (Control Batch). */
  materialSearchMode: 'lsx' | 'material' = 'lsx';
  materialSearchParsed: { materialCode: string; poNumber?: string; imdKey?: string; bagNumberDisplay?: string } | null = null;
  materialSearchLoading = false;
  materialSearchError = '';
  availableProductionOrders: string[] = [];
  
  // Professional Scanning Modal properties
  showScanningSetupModal: boolean = false;
  scanningSetupStep: 'factory' | 'lsx' | 'employee' = 'factory';

  private weekRulesSvc = inject(WeekRulesService);

  /** Chế độ chọn LSX Bổ sung: scan LSX chính → xuất cho "BS <LSX>" (PXK bổ sung). */
  bsLsxMode = false;
  bsLsxSwitching = false;

  /** LSX thực sự dùng để xuất: bật Bổ sung → "BS <LSX>"; tem LSX đã có BS giữ nguyên. */
  private effLsx(raw: string): string {
    const t = String(raw || '').trim();
    if (isBsLsx(t)) return toBsLsx(t);
    return this.bsLsxMode ? toBsLsx(t) : t;
  }

  get isBsLsxActive(): boolean {
    return isBsLsx(this.batchProductionOrder);
  }

  /**
   * Nút "Bổ sung LSX": bật / tắt chọn LSX Bổ sung. Đã scan LSX → chuyển ngay sang LSX Bổ sung (hoặc về LSX chính);
   * LSX Bổ sung phải ở Kitting (tab Work Order → Bổ sung ASM1/2/3).
   */
  async toggleBsLsxMode(): Promise<void> {
    if (this.bsLsxSwitching) return;
    const next = !this.bsLsxMode;
    const cur = String(this.batchProductionOrder || '').trim();
    if (!cur) {
      this.bsLsxMode = next;
      return;
    }
    if (this.pendingScanData.length > 0) {
      appAlert('Đang có tem vừa scan chưa lưu. Bấm Done để lưu trước khi đổi LSX chính / Bổ sung.');
      return;
    }
    const target = next ? toBsLsx(cur) : stripBsLsx(cur);
    this.bsLsxSwitching = true;
    try {
      const ok = await this.checkWorkOrderKittingStatus(target);
      if (!ok) return;
      this.bsLsxMode = next;
      this.acceptBatchLsx(target);
      this.setScanFlash('ok', next ? `Đang xuất LSX Bổ sung: ${target}` : `Đang xuất LSX chính: ${target}`);
    } finally {
      this.bsLsxSwitching = false;
      this.cdr.markForCheck();
    }
  }

  private isValidLsxCode(lsx: string): boolean {
    const s = stripBsLsx(lsx ?? '').trim().toUpperCase();
    return s.startsWith('KZLSX') || s.startsWith('LHLSX');
  }
  
  // Auto-hide previous day's scan history
  hidePreviousDayHistory: boolean = true;
  
  // Dropdown management
  isDropdownOpen: boolean = false;

  // QC rule (IQC Status chặn xuất) — More → QC rule
  showQcRuleModal = false;
  qcRuleModalEnabled = false;
  qcRuleModalText = '';
  qcRuleSaving = false;
  private qcRuleEnabledActive = false;
  private qcRuleBlockedList: string[] = [];
  showPxImportPopup = false;
  pxImportBusy = false;
  pxImportFileName = '';
  pxImportRows: PxImportRow[] = [];

  /** Import BS (More) → lưu vào pxk-bs-data, hiện ở Xuất BS */
  showBsImportPopup = false;
  bsImportBusy = false;
  bsImportFileName = '';
  bsImportRows: BsImportPreviewRow[] = [];
  readonly bsCommonLsx = BS_COMMON_LSX;

  /** Ẩn nút Home nổi / toggler navbar toàn cục khi đang ở Outbound mobile (styles.css) */
  private readonly outboundMobileBodyClass = 'ob-outbound-mobile-layout';
  
  // REMOVED: inventoryMaterials - Không cần tính stock để scan nhanh
  
  // ── Xuất BS (Bổ Sung) ────────────────────────────────────────────────────
  exportMode: 'NL' | 'BS' = 'NL';
  bsItems: BsPendingItem[] = [];
  bsLoading = false;
  bsError = '';
  /** Lọc danh sách Xuất BS theo LSX / mã hàng / PO / tên vật tư (gõ để tìm thay vì phải vuốt hết danh sách). */
  bsSearchQuery = '';

  // Scan dialog
  bsScanOpen = false;
  bsScanItem: BsPendingItem | null = null;
  bsScanInput = '';
  bsScanLines: BsScanLine[] = [];
  bsScanError = '';
  bsSaving = false;

  get bsScanTotal(): number {
    return this.bsScanLines.reduce((s, l) => s + l.qty, 0);
  }

  /** Đã xuất các lần trước + đang scan trong popup. */
  get bsScanDoneTotal(): number {
    return Math.round(((Number(this.bsScanItem?.prevExported) || 0) + this.bsScanTotal) * 10000) / 10000;
  }

  /** Ô scan BS đang có con trỏ không — mất thì báo đỏ. */
  bsScanInputFocused = true;

  focusBsScanInput(): void {
    (document.getElementById('bs-scan-input') as HTMLInputElement | null)?.focus();
  }

  /** Danh sách BS: mặc định chỉ chưa xuất; khi search thì hiện cả phiếu đã xuất. */
  /** Lọc Xuất BS theo ngày import (yyyy-mm-dd, '' = mọi ngày). */
  bsDateFilter = '';

  /** Ngày import yyyy-mm-dd (giờ máy). */
  bsDateKey(it: BsPendingItem): string {
    const d = it.importedAt;
    if (!d || isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  bsDateText(it: BsPendingItem): string {
    const k = this.bsDateKey(it);
    return k ? k.split('-').reverse().join('/') : '—';
  }

  /** Các ngày đang có dòng chưa xuất (mới nhất trước) + số dòng — cho ô lọc ngày. */
  get bsDateOptions(): Array<{ key: string; label: string; count: number }> {
    const map = new Map<string, number>();
    for (const it of this.bsItems) {
      if (it.exported) continue;
      const k = this.bsDateKey(it);
      if (k) map.set(k, (map.get(k) || 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, count]) => ({ key, label: key.split('-').reverse().join('/'), count }));
  }

  /** Xuất BS: hiện tất cả dòng chưa xuất (không cần gõ tìm). */
  bsShowAll = false;
  /** Xuất BS: hiện cả dòng đã xuất / đã ẩn / đã xóa (mặc định ẩn, kể cả khi Hiển thị tất cả). */
  bsShowHidden = false;
  /** Lọc theo từng cột bảng BS. */
  bsColFilter: { date: string; lsx: string; code: string; name: string; po: string; iqc: string; qty: string; unit: string; bag: string; status: string } =
    { date: '', lsx: '', code: '', name: '', po: '', iqc: '', qty: '', unit: '', bag: '', status: '' };

  /** Cột "Đã xuất": trạng thái dòng BS. */
  bsStatusText(it: BsPendingItem): string {
    if (it.deleted) return 'Đã xóa';
    if (it.exported) return '✓ Đã xuất';
    if (it.hidden) return 'Đã ẩn';
    if ((it.prevExported || 0) > 0) return `Xuất 1 phần (${(it.prevExported || 0).toLocaleString('vi-VN')})`;
    return 'Chưa';
  }
  /** Dòng BS đang chọn (docId|lineIndex). */
  bsSelected = new Set<string>();
  bsBulkBusy = false;

  get bsAnyColFilter(): boolean {
    return Object.values(this.bsColFilter).some((v) => String(v || '').trim());
  }

  clearBsColFilters(): void {
    this.bsColFilter = { date: '', lsx: '', code: '', name: '', po: '', iqc: '', qty: '', unit: '', bag: '', status: '' };
  }

  /**
   * Xuất BS: hiện khi gõ tìm / chọn ngày / lọc cột / Hiển thị tất cả.
   * Mặc định (kể cả Hiển thị tất cả) chỉ dòng chưa xuất, chưa ẩn; tick "Hiện cả đã xuất / đã ẩn" mới hiện mọi dòng.
   */
  get filteredBsItems(): BsPendingItem[] {
    const q = this.bsSearchQuery.trim().toUpperCase();
    const day = this.bsDateFilter;
    if (!q && !day && !this.bsShowAll && !this.bsShowHidden && !this.bsAnyColFilter && !this.bsDupOnly) return [];
    let source = this.bsShowHidden
      ? [...this.bsItems]
      : this.bsItems.filter(it => !it.exported && !it.hidden);
    if (this.bsDupOnly) source = source.filter(it => this.bsDupCount(it) > 1);
    if (day) source = source.filter(it => this.bsDateKey(it) === day);
    if (q) {
      source = source.filter(it =>
        (it.lsx || '').toUpperCase().includes(q) ||
        (it.materialCode || '').toUpperCase().includes(q) ||
        (it.po || '').toUpperCase().includes(q) ||
        (it.tenVatTu || '').toUpperCase().includes(q)
      );
    }
    if (this.bsAnyColFilter) {
      const cf = this.bsColFilter;
      const has = (val: unknown, f: string) => this.bsColMatch(val, f);
      source = source.filter(it =>
        has(this.bsDateText(it), cf.date) && has(it.lsx, cf.lsx) && has(it.materialCode, cf.code) &&
        has(it.tenVatTu, cf.name) && has(it.po, cf.po) && has(it.iqcStatus, cf.iqc) &&
        this.bsColMatch(it.quantity, cf.qty, true) && has(it.unit, cf.unit) && has(this.bsBagInfo(it)?.needText, cf.bag) &&
        has(this.bsStatusText(it), cf.status)
      );
    }
    return source;
  }

  private bsKey(it: BsPendingItem): string {
    return `${it.docId}|${it.lineIndex}`;
  }

  isBsSelected(it: BsPendingItem): boolean {
    return this.bsSelected.has(this.bsKey(it));
  }

  toggleBsSelect(it: BsPendingItem): void {
    const k = this.bsKey(it);
    if (this.bsSelected.has(k)) this.bsSelected.delete(k);
    else this.bsSelected.add(k);
  }

  /** Mọi dòng đang lọc đều đã chọn. */
  get bsAllFilteredSelected(): boolean {
    const list = this.filteredBsItems;
    return list.length > 0 && list.every((it) => this.bsSelected.has(this.bsKey(it)));
  }

  /** Chọn / bỏ chọn toàn bộ dòng đang lọc (kể cả dòng ngoài 200 dòng đang vẽ). */
  toggleBsSelectAll(): void {
    const list = this.filteredBsItems;
    if (this.bsAllFilteredSelected) list.forEach((it) => this.bsSelected.delete(this.bsKey(it)));
    else list.forEach((it) => this.bsSelected.add(this.bsKey(it)));
  }

  /** Khóa sắp xếp LSX: KZLSX0926/0279 → "26|09|00279" (năm, tháng, số thứ tự). Không đọc được → cuối. */
  private bsLsxSortKey(lsx: string): string {
    const m = /(\d{2})(\d{2})\/(\d+)/.exec(String(lsx || ''));
    if (!m) return `99|99|${String(lsx || '').toUpperCase()}`;
    return `${m[2]}|${m[1]}|${m[3].padStart(5, '0')}`;
  }

  /** Dòng trùng: cùng mã + LSX + PO + lượng (bỏ dòng đã xóa). Memo theo danh sách đang tải. */
  private bsDupMemo: { src: BsPendingItem[] | null; map: Map<string, number> } = { src: null, map: new Map() };

  private bsDupKey(it: BsPendingItem): string {
    return [String(it.materialCode || '').trim().toUpperCase(), this.woOutboundCreatedBy.normLsxForMatch(it.lsx),
      String(it.po || '').replace(/\s+/g, '').toUpperCase(), Math.round((Number(it.quantity) || 0) * 10000) / 10000].join('|');
  }

  private get bsDupMap(): Map<string, number> {
    if (this.bsDupMemo.src !== this.bsItems) {
      const map = new Map<string, number>();
      for (const it of this.bsItems) {
        if (it.deleted) continue;
        const k = this.bsDupKey(it);
        map.set(k, (map.get(k) || 0) + 1);
      }
      this.bsDupMemo = { src: this.bsItems, map };
    }
    return this.bsDupMemo.map;
  }

  /** Số dòng cùng mã + LSX + PO + lượng (≥ 2 là trùng). */
  bsDupCount(it: BsPendingItem): number {
    return it.deleted ? 0 : (this.bsDupMap.get(this.bsDupKey(it)) || 0);
  }

  /** Số dòng chưa xuất, chưa ẩn đang bị trùng. */
  get bsDupPendingCount(): number {
    return this.bsItems.filter((it) => !it.exported && !it.hidden && this.bsDupCount(it) > 1).length;
  }

  /** Chỉ hiện dòng trùng. */
  bsDupOnly = false;

  /** Popup thống kê LSX theo số dòng BS. */
  showBsLsxStats = false;

  /** LSX có dòng BS chưa xuất, chưa ẩn — nhiều dòng nhất trước. */
  get bsLsxStats(): Array<{ lsx: string; lines: number; codes: number; qty: number; dups: number; firstDate: string }> {
    const map = new Map<string, { lsx: string; lines: number; codes: Set<string>; qty: number; dups: number; first: number }>();
    for (const it of this.bsItems) {
      if (it.exported || it.hidden) continue;
      const lsx = it.lsx || '—';
      const cur = map.get(lsx) || { lsx, lines: 0, codes: new Set<string>(), qty: 0, dups: 0, first: Infinity };
      cur.lines += 1;
      cur.codes.add(String(it.materialCode || '').toUpperCase());
      cur.qty += Number(it.quantity) - (Number(it.prevExported) || 0);
      if (this.bsDupCount(it) > 1) cur.dups += 1;
      const t = it.importedAt?.getTime();
      if (t && t < cur.first) cur.first = t;
      map.set(lsx, cur);
    }
    return Array.from(map.values())
      .sort((a, b) => b.lines - a.lines || this.bsLsxSortKey(a.lsx).localeCompare(this.bsLsxSortKey(b.lsx)))
      .map((s) => ({
        lsx: s.lsx, lines: s.lines, codes: s.codes.size, qty: Math.round(s.qty * 10000) / 10000, dups: s.dups,
        firstDate: Number.isFinite(s.first) ? new Date(s.first).toLocaleDateString('vi-VN') : '—'
      }));
  }

  /** Bấm 1 LSX trong thống kê → lọc danh sách theo LSX đó. */
  pickBsLsx(lsx: string): void {
    this.clearBsColFilters();
    this.bsColFilter.lsx = lsx === '—' ? '' : lsx;
    this.bsShowAll = true;
    this.bsDupOnly = false;
    this.bsSelected.clear();
    this.bsGoPage(1);
    this.showBsLsxStats = false;
  }

  get bsSelectedHasHidden(): boolean {
    return this.bsSelectedItems.some((it) => !!it.hidden);
  }

  get bsSelectedItems(): BsPendingItem[] {
    return this.bsItems.filter((it) => this.bsSelected.has(this.bsKey(it)));
  }

  /** Ẩn / bỏ ẩn / xóa hàng loạt các dòng BS đang chọn (ghi theo từng phiếu). */
  async bulkBsAction(kind: 'hide' | 'unhide' | 'delete'): Promise<void> {
    const items = this.bsSelectedItems;
    if (!items.length || this.bsBulkBusy) return;
    const label = kind === 'hide' ? 'Ẩn' : kind === 'unhide' ? 'Bỏ ẩn' : 'Xóa';
    const note = kind === 'hide' ? 'Dòng ẩn vẫn xem lại được bằng ô "Chỉ dòng đã ẩn".'
      : kind === 'delete' ? 'Dòng xóa sẽ bị loại khỏi danh sách BS (như nút xóa từng dòng).' : '';
    if (!confirm(`${label} ${items.length} dòng BS đang chọn?\n${note}`)) return;
    this.bsBulkBusy = true;
    try {
      const byDoc = new Map<string, number[]>();
      items.forEach((it) => byDoc.set(it.docId, [...(byDoc.get(it.docId) || []), it.lineIndex]));
      const db = this.firestore.firestore;
      const by = String(this.operatorSessionId || '').trim().toUpperCase();
      const now = new Date();
      const docIds = Array.from(byDoc.keys());
      for (let i = 0; i < docIds.length; i += 20) {
        await Promise.all(docIds.slice(i, i + 20).map(async (docId) => {
          const ref = db.collection('pxk-bs-data').doc(docId);
          const snap = await ref.get();
          if (!snap.exists) return;
          const lines: any[] = [...(((snap.data() as any)?.lines) || [])];
          for (const idx of byDoc.get(docId) || []) {
            if (!lines[idx]) continue;
            lines[idx] = kind === 'hide' ? { ...lines[idx], hidden: true, hiddenAt: now, hiddenBy: by }
              : kind === 'unhide' ? { ...lines[idx], hidden: false }
              : { ...lines[idx], done: true, deletedAt: now, deletedBy: by };
          }
          await ref.update({ lines });
        }));
      }
      const keys = new Set(items.map((it) => this.bsKey(it)));
      this.bsItems = this.bsItems.map((b) => !keys.has(this.bsKey(b)) ? b
        : kind === 'hide' ? { ...b, hidden: true }
        : kind === 'unhide' ? { ...b, hidden: false }
        : { ...b, done: true, exported: true, deleted: true });
      this.bsSelected.clear();
      appAlert(`✅ Đã ${label.toLowerCase()} ${items.length} dòng BS.`);
    } catch (e: any) {
      appAlert(`❌ Lỗi khi ${label.toLowerCase()}: ` + (e?.message || e));
    } finally {
      this.bsBulkBusy = false;
      this.cdr.markForCheck();
    }
  }

  /** Phân trang bảng BS (chọn toàn bộ / Excel vẫn trên mọi dòng đang lọc). */
  bsPage = 1;
  bsPageSize = 200;
  readonly bsPageSizeOptions = [100, 200, 500];
  /** Chỉ tải phiếu BS import trong N ngày gần nhất (0 = tất cả). Phiếu LSX Chung luôn tải. */
  bsDays = 3;
  readonly bsDayOptions = [3, 7, 30, 0];

  get bsPageCount(): number {
    return Math.max(1, Math.ceil(this.filteredBsItems.length / this.bsPageSize));
  }

  /** Trang đang xem (tự kéo về trang cuối khi bộ lọc làm ít dòng đi). */
  get bsPageSafe(): number {
    return Math.min(Math.max(1, this.bsPage), this.bsPageCount);
  }

  get bsPageStart(): number {
    return (this.bsPageSafe - 1) * this.bsPageSize;
  }

  bsGoPage(p: number): void {
    this.bsPage = Math.min(Math.max(1, Math.floor(p) || 1), this.bsPageCount);
  }

  private bsPageSlice(all: BsPendingItem[]): BsPendingItem[] {
    return all.slice(this.bsPageStart, this.bsPageStart + this.bsPageSize);
  }

  get bsVisibleItems(): BsPendingItem[] {
    const list = this.bsPageSlice(this.filteredBsItems);
    this.queueBsIqc(list);
    return list;
  }

  /**
   * Ô lọc cột: chữ thường → chứa chữ đó; điều kiện số "<1", ">5", "<=10", ">=100", "=0" hoặc khoảng "10-20".
   */
  private bsColMatch(val: unknown, filter: string, exactNumber = false): boolean {
    const f = String(filter || '').trim();
    if (!f) return true;
    const num = (v: unknown) => Number(String(v ?? '').replace(/,/g, '').trim());
    // Cột số (Lượng cần xuất): gõ số → đúng số đó (0 không ra 10, 100)
    if (exactNumber && /^-?\d+(?:[.,]\d+)?$/.test(f)) {
      const v = num(val);
      return Number.isFinite(v) && String(val ?? '').trim() !== '' && Math.abs(v - num(f.replace(',', '.'))) < 1e-9;
    }
    const op = /^(<=|>=|<|>|=)\s*(-?\d+(?:[.,]\d+)?)$/.exec(f);
    const range = op ? null : /^(-?\d+(?:[.,]\d+)?)\s*-\s*(-?\d+(?:[.,]\d+)?)$/.exec(f);
    if (op || range) {
      const v = num(val);
      if (!Number.isFinite(v) || String(val ?? '').trim() === '') return false;
      if (range) return v >= num(range[1]) && v <= num(range[2]);
      const n = num(op![2]);
      switch (op![1]) {
        case '<': return v < n;
        case '>': return v > n;
        case '<=': return v <= n;
        case '>=': return v >= n;
        default: return Math.abs(v - n) < 1e-9;
      }
    }
    return String(val ?? '').toUpperCase().includes(f.toUpperCase());
  }

  bsExporting = false;

  /**
   * Tải Excel danh sách BS đang tải (theo khoảng ngày đang chọn): kèm ngày import, đã xuất chưa,
   * trạng thái Work Order của LSX và tồn kho mã + PO — để xem dòng nào thực tế còn cần xuất.
   */
  async exportBsExcel(): Promise<void> {
    if (this.bsExporting || !this.bsItems.length) return;
    this.bsExporting = true;
    try {
      const items = this.bsItems;
      // Trạng thái Work Order theo LSX
      const woStatus = new Map<string, string>();
      const woSeq = new Map<string, number>();
      const lsxs = [...new Set(items.map((it) => it.lsx).filter((l) => l && !this.isBsCommonLsx(l)))];
      for (let i = 0; i < lsxs.length; i += 30) {
        const snap = await this.firestore.firestore.collection('work-orders')
          .where('productionOrder', 'in', lsxs.slice(i, i + 30)).get();
        snap.forEach((doc) => {
          const d = doc.data() as any;
          // LSX import nhiều lần: lấy trạng thái của lần mới nhất
          const key = this.woOutboundCreatedBy.normLsxForMatch(String(d.productionOrder || ''));
          const seq = Number(d.lsxSeq) || 1;
          if ((woSeq.get(key) ?? 0) > seq) return;
          woSeq.set(key, seq);
          woStatus.set(key, String(d.status || ''));
        });
      }
      // Tồn kho theo mã + PO (dòng chưa xuất)
      const codes = [...new Set(items.filter((it) => !it.exported).map((it) => String(it.materialCode || '').trim().toUpperCase()))];
      const inv = await this.readInvLots(codes);
      const fmtDate = (d?: Date | null) => (d && !isNaN(d.getTime()) ? d.toLocaleDateString('vi-VN') : '');
      const rows = items.map((it) => {
        const lots = inv.get(this.pxkScanKey(it.materialCode, this.normalizePxImportPo(it.po))) || [];
        const stock = Math.round(lots.reduce((s, l) => s + Math.max(0, l.stock), 0) * 10000) / 10000;
        const wo = this.isBsCommonLsx(it.lsx) ? '' : (woStatus.get(this.woOutboundCreatedBy.normLsxForMatch(it.lsx)) || 'Không thấy WO');
        return {
          'Ngày import': fmtDate(it.importedAt),
          'LSX': it.lsx,
          'Trạng thái WO': wo,
          'Mã hàng': it.materialCode,
          'Tên VT': it.tenVatTu || '',
          'PO': it.po,
          'Lượng cần xuất': it.quantity,
          'ĐVT': it.unit,
          'Bag cần': this.bsBagInfo(it)?.needText || '',
          'IQC': it.iqcStatus || '',
          'Đã xuất': it.exported ? 'Đã xuất' : (it.prevExported ? `Một phần (${it.prevExported})` : 'Chưa'),
          'Tồn kho mã + PO': it.exported ? '' : stock
        };
      });
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = [12, 18, 14, 12, 40, 18, 14, 8, 16, 12, 10, 16].map((wch) => ({ wch }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Xuat BS');
      const range = this.bsDays ? `${this.bsDays}ngay` : 'tatca';
      XLSX.writeFile(wb, `Xuat_BS_${this.selectedFactory}_${range}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e: any) {
      appAlert('❌ Không tải được Excel danh sách BS: ' + (e?.message || e));
    } finally {
      this.bsExporting = false;
      this.cdr.markForCheck();
    }
  }

  onBsDaysChange(): void {
    void this.loadBsItems();
  }

  get bsPendingCount(): number {
    return this.bsItems.filter(it => !it.exported && !it.hidden).length;
  }

  clearBsSearch(): void {
    this.bsSearchQuery = '';
  }

  /** Mobile WMS shell — expandable cards + bottom nav (mockup-aligned) */
  showMobileMoreSheet = false;
  showMobileFilterSheet = false;
  /** Sheet lịch sử scan tem trong phiên (theo LSX đang batch) */
  showMobileLsxHistorySheet = false;
  mobileMaterialExpanded: { [key: string]: boolean } = {};
  mobileBottomTab: 'home' | 'outbound' | 'history' | 'location' | 'bs' = 'outbound';

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private factoryAccessService: FactoryAccessService,
    private cdr: ChangeDetectorRef,
    private qrScannerService: QRScannerService,
    private dialog: MatDialog,
    private rmBagHistory: RmBagHistoryService,
    private temLeCl: TemLeClService,
    private lsxLog: OutboundLsxLogService,
    private pxkWeightReports: PxkWeightCheckReportService,
    private pxkOddWeigh: PxkOddWeighService,
    private outboundQcRule: OutboundQcRuleService,
    private router: Router,
    private route: ActivatedRoute,
    private woOutboundCreatedBy: WorkOrderOutboundCreatedByService,
    private readTracker: ReadTrackerService,
    private nvlCatalog: NvlCatalogFullService,
    private sxxkSuspect: SxxkSuspectService,
    private authService: FirebaseAuthService,
    private temXuatKho: TemXuatKhoService,
    private clientReload: ClientReloadService
  ) {}

  private static readonly RELOAD_HOLD_KEY = 'outbound-scan';

  /** Đang scan dở 1 LSX (đã quét LSX hoặc còn mã chờ lưu) → hoãn popup tải lại tới khi lưu xong. */
  private isScanSessionActive(): boolean {
    return (
      this.pendingScanData.length > 0 ||
      this.isSavingBatchData ||
      (this.isProductionOrderScanned && !!this.batchProductionOrder)
    );
  }

  private clearBatchPxkCache(): void {
    this.batchPxkPairs = [];
    this.batchPxkCachedLsx = '';
    this.batchPxkLoading = null;
    this.batchPxkExportedByKey = new Map();
    this.batchPxkInv = null;
  }

  /** Tồn kho theo mã + PO (từng IMD) của các mã trên PXK — null = chưa đọc. */
  private batchPxkInv: Map<string, PxkInvLot[]> | null = null;

  private async loadBatchPxkStock(lsx: string): Promise<void> {
    this.batchPxkInv = null;
    const codes = [...new Set(this.batchPxkPairs.map((p) => p.code).filter(Boolean))];
    try {
      const inv = await this.readInvLots(codes);
      if (this.batchPxkCachedLsx !== lsx) return;
      this.batchPxkInv = inv;
      this.autoAddScanCrumbs();
      this.cdr.markForCheck();
    } catch (e) {
      console.warn('loadBatchPxkStock:', e);
    }
  }

  /** Tồn kho từng lô (IMD) theo "MÃ|PO" của các mã — nhà máy đang xem. Dùng cho PXK (Xuất NL) và tem lẻ Xuất BS. */
  private async readInvLots(codes: string[]): Promise<Map<string, PxkInvLot[]>> {
    const inv = new Map<string, PxkInvLot[]>();
    {
      for (let i = 0; i < codes.length; i += 10) {
        const snap = await this.firestore.firestore.collection('inventory-materials')
          .where('materialCode', 'in', codes.slice(i, i + 10)).get();
        snap.forEach((doc) => {
          const d = doc.data() as any;
          if (String(d.factory || '') !== this.selectedFactory) return;
          const stock = (Number(d.openingStock) || 0) + (Number(d.quantity) || 0) - (Number(d.exported) || 0) - (Number(d.xt) || 0);
          const key = this.pxkScanKey(d.materialCode, d.poNumber);
          const imp: Date | null = d.importDate?.toDate ? d.importDate.toDate() : (d.importDate ? new Date(d.importDate) : null);
          const bn = /^(\d{8,})/.exec(String(d.batchNumber ?? '').trim());
          const imd = bn ? bn[1] : (imp && !isNaN(imp.getTime()) ? imp.toLocaleDateString('en-GB').split('/').join('') : '');
          const lotStd = Number(d.lotStandardPacking) || 0;
          const list = inv.get(key) || [];
          list.push({ imd, po: String(d.poNumber || '').trim(), stock: Math.round(stock * 10000) / 10000, importMs: imp?.getTime() || 0, std: lotStd });
          inv.set(key, list);
          const ms = imp?.getTime() || 0;
          if (lotStd > 0 && ms >= (this.lotStdMsByKey.get(key) ?? -1)) {
            this.lotStdByKey.set(key, lotStd);
            this.lotStdMsByKey.set(key, ms);
          }
        });
      }
      codes.forEach((c) => this.lotStdLoadedCodes.add(String(c || '').trim().toUpperCase()));
    }
    return inv;
  }

  /** Standard theo MÃ|PO lấy từ lô tồn kho (Inbound ghi lotStandardPacking). Mỗi PO có thể khác Standard danh mục. */
  private lotStdByKey = new Map<string, number>();
  private lotStdMsByKey = new Map<string, number>();
  private lotStdLoadedCodes = new Set<string>();

  /** Standard dùng để tính: Standard của PO (lô) nếu có, không thì Standard danh mục. */
  stdFor(materialCode: string | null | undefined, po?: string | null): number {
    const code = String(materialCode || '').trim().toUpperCase();
    if (!code) return 0;
    if (po) {
      const lot = this.lotStdByKey.get(this.pxkScanKey(code, po));
      if (lot && lot > 0) return lot;
    }
    return this.standardPackingByCode.get(code) || 0;
  }

  /** Đọc Standard của các lô (1 lần / mã) trước khi kiểm tra scan. Lỗi đọc → dùng danh mục. */
  private async ensureLotStd(materialCode: string): Promise<void> {
    const code = String(materialCode || '').trim().toUpperCase();
    if (!code || this.lotStdLoadedCodes.has(code)) return;
    try {
      await this.readInvLots([code]);
    } catch (e) {
      console.warn('ensureLotStd', code, e);
      this.lotStdLoadedCodes.add(code);
    }
  }

  /** Sau khi LSX hợp lệ (Kitting): lưu LSX và preload PXK để chặn sai mã / sai PO. */
  private acceptBatchLsx(lsx: string): void {
    const lsxTrim = String(lsx || '').trim();
    this.batchProductionOrder = lsxTrim;
    this.isProductionOrderScanned = true;
    void this.ensureBatchPxkLoaded();
    this.weighCodesLoad = null;
    void this.ensureWeighCodesLoaded().catch(() => undefined);
  }

  private async ensureBatchPxkLoaded(): Promise<void> {
    const lsx = (this.batchProductionOrder || '').trim();
    if (!lsx) return;
    if (this.batchPxkCachedLsx === lsx) {
      if (this.batchPxkLoading) await this.batchPxkLoading;
      return;
    }
    this.batchPxkCachedLsx = lsx;
    this.batchPxkPairs = [];
    this.batchPxkExportedByKey = new Map();
    this.batchPxkLoading = Promise.all([
      this.temXuatKho.loadPxkScanPairsForLsx(this.selectedFactory, lsx),
      this.loadBatchPxkExportedTotals(lsx)
    ])
      .then(([pairs, exported]) => {
        if (this.batchPxkCachedLsx === lsx) {
          // Lượng cần xuất = cột Xuất Kho của dòng kho NVL; bỏ dòng NVL_SX / NVL_KS (hàng đã ở sản xuất), giống tab Work Order
          this.batchPxkPairs = pairs
            .filter(p => !['NVL_SX', 'NVL_KS'].includes(String(p.maKho || '').trim().toUpperCase()))
            .map(p => ({
              code: String(p.materialCode || '').trim().toUpperCase(),
              po: this.normalizePxImportPo(p.po),
              qty: Number(p.quantity) || 0,
              maKho: String(p.maKho || '').trim()
            }));
          this.batchPxkExportedByKey = exported;
          void this.loadBatchPxkStock(lsx);
          // Mã đầu R: tự xuất theo PXK, không cần scan
          void this.autoExportRCodesForLsx(lsx);
        }
      })
      .catch(err => {
        console.warn('ensureBatchPxkLoaded failed:', err);
        if (this.batchPxkCachedLsx === lsx) {
          this.batchPxkPairs = [];
          this.batchPxkExportedByKey = new Map();
        }
      })
      .finally(() => {
        if (this.batchPxkCachedLsx === lsx) {
          this.batchPxkLoading = null;
        }
      });
    await this.batchPxkLoading;
  }

  private pxkScanKey(code: string, po: string): string {
    return `${String(code || '').trim().toUpperCase()}|${this.normalizePxImportPo(po)}`;
  }

  /** Tổng đã xuất theo mã+PO của LSX (outbound-materials). */
  /** Số bag đã xuất theo mã+PO của LSX (đếm cùng lúc với tổng lượng). */
  private batchPxkExportedBagsByKey = new Map<string, number>();

  /** LSX đã chạy tự xuất mã R trong phiên (tránh chạy lặp khi nạp lại PXK). */
  private autoRDoneLsx = new Set<string>();

  /**
   * Mã đầu R trên PXK của LSX: tự xuất luôn phần còn lại (PXK − đã xuất), trừ tồn FIFO theo Mã + PO
   * (IMD cũ trước) — không đợi scan. Ghi outbound-materials (scanMethod AUTO-R) như xuất thường.
   */
  private async autoExportRCodesForLsx(lsx: string): Promise<void> {
    const key0 = `${this.selectedFactory}|${lsx}`;
    if (this.autoRDoneLsx.has(key0)) return;
    this.autoRDoneLsx.add(key0);
    const r4 = (n: number) => Math.round(n * 10000) / 10000;
    const need = new Map<string, { code: string; po: string; qty: number }>();
    for (const p of this.batchPxkPairs) {
      if (!p.code.startsWith('R') || !(p.qty > 0)) continue;
      const k = this.pxkScanKey(p.code, p.po);
      const cur = need.get(k) || { code: p.code, po: p.po, qty: 0 };
      cur.qty = r4(cur.qty + p.qty);
      need.set(k, cur);
    }
    const todo = [...need.entries()]
      .map(([k, v]) => ({ ...v, remain: r4(v.qty - (this.batchPxkExportedByKey.get(k) || 0)) }))
      .filter((v) => v.remain > 1e-6);
    if (!todo.length) return;
    try {
      const lots = await this.fetchPxImportInventoryLots([...new Set(todo.map((t) => t.code))]);
      const exportedBy = this.batchEmployeeId || 'AUTO-R';
      const done: string[] = [];
      const short: string[] = [];
      for (const t of todo) {
        if (this.batchPxkCachedLsx !== lsx) return;
        const matched = lots
          .filter((l) => this.normalizePxImportCode(l.materialCode) === t.code
            && this.pxImportPoMatch(this.normalizePxImportPo(l.poNumber), t.po))
          .sort((a, b) => a.sortKey - b.sortKey);
        let left = t.remain;
        let took = 0;
        for (const lot of matched) {
          if (left <= 1e-9) break;
          if (lot.available <= 1e-9) continue;
          const qty = r4(Math.min(left, lot.available));
          const now = new Date();
          await this.firestore.collection('outbound-materials').add({
            factory: this.selectedFactory,
            materialCode: t.code,
            poNumber: t.po,
            quantity: qty,
            unit: 'PCS',
            exportQuantity: qty,
            scanCount: 1,
            exportDate: now,
            location: lot.location || '',
            exportedBy,
            employeeId: exportedBy,
            productionOrder: lsx,
            batch: lot.imd || null,
            batchNumber: lot.imd || null,
            importDate: lot.imd || null,
            scanMethod: 'AUTO-R',
            notes: `Tự xuất mã R theo PXK · LSX ${lsx}`,
            createdAt: now,
            updatedAt: now
          } as OutboundMaterial);
          await this.firestore.collection('inventory-materials').doc(lot.id).update({
            exported: firebase.default.firestore.FieldValue.increment(qty),
            updatedAt: now
          });
          lot.available = r4(lot.available - qty);
          left = r4(left - qty);
          took = r4(took + qty);
        }
        if (took > 0) {
          this.addBatchPxkExported(t.code, t.po, took);
          done.push(`${t.code} ${took}`);
        }
        if (left > 1e-6) short.push(`${t.code} thiếu ${left}`);
      }
      if (done.length || short.length) {
        this.setScanFlash(short.length ? 'err' : 'ok',
          (done.length ? `Tự xuất mã R: ${done.join(', ')}` : '') +
          (short.length ? `${done.length ? ' · ' : ''}Không đủ tồn: ${short.join(', ')}` : ''));
        this.cdr.markForCheck();
      }
    } catch (e) {
      console.warn('autoExportRCodesForLsx', e);
      this.autoRDoneLsx.delete(key0);
    }
  }

  private async loadBatchPxkExportedTotals(lsx: string): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const bags = new Map<string, number>();
    const lsxTrim = String(lsx || '').trim();
    if (!lsxTrim) return out;
    try {
      const variants = Array.from(new Set([lsxTrim, lsxTrim.toUpperCase(), lsxTrim.replace(/\s+/g, '').toUpperCase()])).slice(0, 10);
      const snap = await this.firestore
        .collection('outbound-materials', ref =>
          ref.where('factory', '==', this.selectedFactory).where('productionOrder', 'in', variants)
        )
        .get()
        .toPromise();
      (snap?.docs || []).forEach(doc => {
        const d = doc.data() as any;
        const code = String(d?.materialCode || '').trim().toUpperCase();
        if (!code) return;
        const qty = Number(d?.exportQuantity ?? d?.quantity ?? 0);
        if (!(qty > 0)) return;
        const key = this.pxkScanKey(code, d?.poNumber ?? d?.po);
        out.set(key, (out.get(key) || 0) + qty);
        bags.set(key, (bags.get(key) || 0) + Math.max(1, Number(d?.scanCount) || 1));
      });
      this.batchPxkExportedBagsByKey = bags;
    } catch (e) {
      console.warn('loadBatchPxkExportedTotals failed:', e);
    }
    return out;
  }

  private addBatchPxkExported(code: string, po: string, qty: number): void {
    const q = Number(qty) || 0;
    if (!(q > 0)) return;
    const key = this.pxkScanKey(code, po);
    const next = new Map(this.batchPxkExportedByKey);
    next.set(key, (next.get(key) || 0) + q);
    this.batchPxkExportedByKey = next;
    const bags = new Map(this.batchPxkExportedBagsByKey);
    bags.set(key, (bags.get(key) || 0) + 1);
    this.batchPxkExportedBagsByKey = bags;
  }

  /** Tập mã được phép quét Tem Thùng để xuất kho — load 1 lần từ cache dùng chung (không thêm read). */
  private allowExportByCartonSet: Set<string> = new Set();
  /** Standard Packing theo mã (từ danh mục NVL) — dùng rule Chẵn/Lẻ khi quét. */
  private standardPackingByCode = new Map<string, number>();
  private onNvlCatalogStorage = (ev: StorageEvent) => {
    if (ev.key !== NvlCatalogFullService.cacheStampKey) return;
    void this.loadAllowExportByCartonSet();
  };

  /** Scan xuất không còn ghi người scan lên work order. */
  private syncWorkOrderCreatedByAfterExport(_lsx?: string, _employeeId?: string): void {
    return;
  }

  /**
   * Tem lẻ: scan xuất tem CL (đuôi (CL-0n)) → IMD đó hết bịch CL, từ đó mới cho tách bịch chẵn mới
   * (xem TemLeClService). Chạy nền sau khi lưu xuất; lỗi chỉ ghi log, không chặn xuất.
   */
  /** Ghi log notepad theo LSX (từng bag) — chạy nền, lỗi không ảnh hưởng xuất kho. */
  private writeLsxLog(items: Array<any>, method: string): void {
    const rows = (items || []).map((it, i) => {
      const p = this.rmBagHistory.parseQrPart4(it?.importDate);
      const t = it?.scanTime instanceof Date ? it.scanTime.getTime() : Date.now();
      return {
        lsx: String(it?.productionOrder || this.batchProductionOrder || '').trim(),
        line: {
          t: t + i / 1000,
          by: String(it?.employeeId || this.batchEmployeeId || '').trim().toUpperCase(),
          code: String(it?.materialCode || '').trim().toUpperCase(),
          po: String(it?.poNumber || '').trim(),
          imd: p.imdKey || '',
          bag: String(it?.bagBatch || p.bagFractionLabel || ''),
          qty: Number(it?.quantity) || 0,
          tag: p.splitTag || '',
          loc: String(it?.location || ''),
          m: method
        } as OutboundLsxLogLine
      };
    });
    void this.lsxLog.append(this.selectedFactory, rows).catch((e) => console.warn('[LSX log] ghi lỗi', e));
  }

  // ===== Popup Log LSX (xem chi tiết từng bag đã scan) =====
  showLsxLog = false;
  lsxLogQuery = '';
  lsxLogLoading = false;
  lsxLogError = '';
  lsxLogLines: OutboundLsxLogLine[] = [];
  lsxLogShownLsx = '';

  openLsxLog(): void {
    this.showLsxLog = true;
    this.lsxLogQuery = this.lsxLogQuery || this.batchProductionOrder || this.selectedProductionOrder || '';
    if (this.lsxLogQuery.trim()) void this.loadLsxLog();
  }

  async loadLsxLog(): Promise<void> {
    const lsx = this.lsxLogQuery.trim().toUpperCase();
    if (!lsx || this.lsxLogLoading) return;
    this.lsxLogLoading = true;
    this.lsxLogError = '';
    this.cdr.detectChanges();
    try {
      const { lines, reads } = await this.lsxLog.load(this.selectedFactory, lsx);
      this.readTracker.track('outbound', 'outbound-lsx-log', reads);
      this.lsxLogLines = lines;
      this.lsxLogShownLsx = lsx;
      if (!lines.length) this.lsxLogError = `Chưa có log cho ${lsx} (log ghi từ 17/10/2026).`;
    } catch (e) {
      console.error('loadLsxLog:', e);
      this.lsxLogError = 'Không đọc được log. Thử lại.';
    } finally {
      this.lsxLogLoading = false;
      this.cdr.detectChanges();
    }
  }

  get lsxLogTotalQty(): number {
    return this.lsxLogLines.reduce((n, l) => n + (Number(l.qty) || 0), 0);
  }

  lsxLogTime(ms: number): string {
    const d = new Date(Number(ms) || 0);
    const p = (x: number) => String(x).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  private markTemLeClExported(items: Array<any>): void {
    for (const it of items || []) {
      const p = this.rmBagHistory.parseQrPart4(it?.importDate);
      if (!p.imdKey || (p.splitTag && !p.splitTag.startsWith('CL'))) continue;
      const code = String(it?.materialCode || '').trim().toUpperCase();
      const po = String(it?.poNumber || '').trim();
      if (!code || !po) continue;
      const by = String(it?.employeeId || this.batchEmployeeId || '').trim();
      if (p.splitTag) {
        void this.temLeCl.markClExported(this.selectedFactory, code, po, p.imdKey, p.splitTag, by)
          .catch((e) => console.warn('[Tem lẻ] markClExported failed', code, p.splitTag, e));
      } else {
        // Tem cũ (chưa dán tem CL mới) của bịch đang là CL: xuất hết lượng CL → IMD hết CL
        const qty = Number(it?.exportQuantity ?? it?.quantity) || 0;
        void this.temLeCl.markClExportedByOldLabel(this.selectedFactory, code, po, p.imdKey, p.bagFractionLabel, qty, by)
          .catch((e) => console.warn('[Tem lẻ] markClExportedByOldLabel failed', code, e));
      }
    }
  }

  private syncWorkOrderCreatedByFromPendingScans(): void {
    const lsxToEmp = new Map<string, string>();
    for (const item of this.pendingScanData) {
      const lsx = String(item?.productionOrder || this.batchProductionOrder || '').trim();
      const emp = String(item?.employeeId || this.batchEmployeeId || '').trim();
      if (lsx && emp && emp !== 'BS') lsxToEmp.set(lsx, emp);
    }
    if (lsxToEmp.size === 0 && this.batchProductionOrder && this.batchEmployeeId) {
      this.syncWorkOrderCreatedByAfterExport();
      return;
    }
    lsxToEmp.forEach((emp, lsx) => this.syncWorkOrderCreatedByAfterExport(lsx, emp));
  }
  
  ngOnInit(): void {
    console.log('🏭 Outbound component initialized');
    // Danh sách Kiểm 100% (cùng nguồn tab Inbound, có cache) — để nhận diện mã khi scan
    void this.sxxkSuspect.load().catch(() => undefined);

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

    this.detectMobileDevice();
    this.setupDefaultDateRange();
    this.restorePendingFromStorage();
    this.restoreOperatorSession();
    this.scheduleOperatorExpiryWatch();
    document.addEventListener('visibilitychange', this.onOperatorVisibilityChange);
    setTimeout(() => {
      if (!this.hasOperatorSession) this.focusOperatorSessionInput();
    }, 80);
    // 🔧 OPTIMIZATION: Không load materials khi khởi tạo - chỉ load khi search LSX
    console.log('⏸️ Ready - waiting for LSX search to load data');
    // REMOVED: loadMaterials() - Chỉ load khi user nhập LSX
    // REMOVED: loadInventoryMaterials() - Không cần tính stock để scan nhanh

    // Add click outside listener to close dropdown
    document.addEventListener('click', this.onDocumentClick.bind(this));

    // Add window resize listener for mobile detection
    window.addEventListener('resize', this.onWindowResize.bind(this));

    // 🔧 GLOBAL SCANNER LISTENER: Lắng nghe tất cả keyboard input khi setup modal mở hoặc đang scan
    document.addEventListener('keydown', (event) => this.onGlobalKeydown(event));

    void this.refreshOutboundQcRuleCache();
    void this.loadAllowExportByCartonSet();
    this.nvlCatalog.changed$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      void this.loadAllowExportByCartonSet();
    });
    window.addEventListener('storage', this.onNvlCatalogStorage);
    this.clientReload.setHold(OutboundComponent.RELOAD_HOLD_KEY, () => this.isScanSessionActive());
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

  private isValidFactory(f: string | null | undefined): f is 'ASM1' | 'ASM2' {
    return f === 'ASM1' || f === 'ASM2';
  }

  /** Reset state gắn với factory cũ (search, batch scan đang dở, BS list, QC rule cache) khi đổi nhà máy. */
  private onFactoryChanged(): void {
    // Đổi nhà máy giữa chừng 1 phiên scan batch dở dang là không an toàn (LSX/NV đã scan thuộc factory cũ)
    // → reset về trạng thái sạch, không âm thầm mang dữ liệu chưa lưu sang factory khác.
    if (this.isBatchScanningMode || this.isProductionOrderScanned || this.pendingScanData.length > 0) {
      this.resetScanningData();
    }
    if (this.hasOperatorSession) this.applyOperatorToBatch();
    this.showScanningSetupModal = false;
    this.materials = [];
    this.filteredMaterials = [];
    this.availableProductionOrders = [];
    this.selectedProductionOrder = '';
    this.searchProductionOrder = '';
    this.historyFilterPo = '';
    this.historyFilterLsx = '';
    this.materialSearchParsed = null;
    this.materialSearchError = '';
    this.bsItems = [];
    this.bsError = '';
    this.closeBsScanDialog();
    void this.refreshOutboundQcRuleCache();
  }

  private async loadAllowExportByCartonSet(): Promise<void> {
    try {
      const items = await this.nvlCatalog.listAll();
      this.allowExportByCartonSet = new Set(
        items.filter((i) => i.allowExportByCarton).map((i) => i.materialCode)
      );
      this.catalogByCode = new Map(items.map((i) => [i.materialCode, i]));
      const spMap = new Map<string, number>();
      items.forEach((i) => {
        const sp = Number(i.standardPacking) || 0;
        if (i.materialCode && sp > 0) {
          spMap.set(i.materialCode, sp);
        }
      });
      this.standardPackingByCode = spMap;
      this.cdr.markForCheck();
    } catch (e) {
      console.error('❌ Load Xuất thùng / Standard Packing catalog:', e);
    }
  }

  /** Standard Packing trong danh mục NVL (0 = chưa có). */
  getStandardPacking(materialCode: string | null | undefined): number {
    const code = String(materialCode || '').trim().toUpperCase();
    if (!code) return 0;
    return this.standardPackingByCode.get(code) || 0;
  }

  isAllowExportByCarton(materialCode: string | null | undefined): boolean {
    const code = String(materialCode || '').trim().toUpperCase();
    return !!code && this.allowExportByCartonSet.has(code);
  }

  /**
   * Chẵn = QTY bằng Standard Packing; Lẻ = QTY nhỏ hơn SP.
   * Mã bật Xuất thùng → bypass; QTY > SP → over (không cho quét).
   */
  getPackKind(materialCode: string | null | undefined, qty: number, po?: string | null): 'chan' | 'le' | 'bypass' | 'over' | 'unknown' {
    const code = String(materialCode || '').trim().toUpperCase();
    if (!code) return 'unknown';
    if (this.allowExportByCartonSet.has(code)) return 'bypass';
    const sp = this.stdFor(code, po);
    if (sp <= 0) return 'unknown';
    const q = Number(qty);
    if (!(q > 0)) return 'unknown';
    if (q > sp) return 'over';
    if (q === sp) return 'chan';
    return 'le';
  }

  isPackChan(material: { materialCode?: string; poNumber?: string; exportQuantity?: number; quantity?: number } | null | undefined): boolean {
    if (!material) return false;
    const qty = Number(material.exportQuantity ?? material.quantity) || 0;
    return this.getPackKind(material.materialCode, qty, material.poNumber) === 'chan';
  }

  isPackLe(material: { materialCode?: string; exportQuantity?: number; quantity?: number } | null | undefined): boolean {
    if (!material) return false;
    const qty = Number(material.exportQuantity ?? material.quantity) || 0;
    return this.getPackKind(material.materialCode, qty, (material as any).poNumber) === 'le';
  }

  /** Số xuất kho lẻ cần ghi nhận. ASM1 tối đa 4 số lẻ, nhà máy khác 2 số (112.85). Chẵn thì 0. */
  leExportQty(materialCode: string | null | undefined, qty: number, po?: string | null): number {
    const q = isRmQtyDecimalFactory(this.selectedFactory)
      ? roundRmQty(Number(qty) || 0, RM_QTY_DECIMALS_4)
      : Math.round((Number(qty) || 0) * 100) / 100;
    if (!(q > 0)) return 0;
    return this.getPackKind(materialCode, q, po) === 'le' ? q : 0;
  }

  /** Hiện số lẻ trên cột Lẻ. Dòng cũ chưa có leQty thì lấy từ số xuất nếu là Lẻ. */
  packLeQtyText(material: { materialCode?: string; exportQuantity?: number; quantity?: number; leQty?: number } | null | undefined): string {
    if (!material) return '';
    const stored = Number(material.leQty);
    const qty = stored > 0
      ? stored
      : (this.isPackLe(material) ? (Number(material.exportQuantity ?? material.quantity) || 0) : 0);
    if (!(qty > 0)) return '';
    const dec = isRmQtyDecimalFactory(this.selectedFactory) ? RM_QTY_DECIMALS_4 : 2;
    const r = roundRmQty(qty, dec);
    if (Number.isInteger(r)) return String(r);
    return r.toFixed(dec).replace(/0+$/, '').replace(/\.$/, '');
  }

  packKindLabel(material: { materialCode?: string; exportQuantity?: number; quantity?: number } | null | undefined): string {
    if (!material) return '—';
    const qty = Number(material.exportQuantity ?? material.quantity) || 0;
    const kind = this.getPackKind(material.materialCode, qty, (material as any).poNumber);
    switch (kind) {
      case 'chan':
        return 'Chẵn';
      case 'le':
        return 'Lẻ';
      case 'bypass':
        return 'Thùng';
      case 'over':
        return '>';
      default:
        return '—';
    }
  }

  /** Số lượng trên tem: nhận số lẻ, giữ tối đa 2 chữ số thập phân. */
  private parseScanQty(raw: unknown): number {
    // ASM1: đọc cả "12,5" / "1,234.5" / "1.234,56", tối đa 2 số lẻ
    // ASM1: 4 số lẻ (khớp Inbound / Materials)
    if (isRmQtyDecimalFactory(this.selectedFactory)) return parseRmScanQty(raw, RM_QTY_DECIMALS_4);
    let s = String(raw ?? '').trim().replace(/\s/g, '');
    if (!s) return 0;
    if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
    const n = parseFloat(s);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100) / 100;
  }

  /**
   * Rule quét: QTY ≤ Standard Packing (Chẵn =SP, Lẻ &lt;SP).
   * Mã bật Xuất thùng trong danh mục → không áp dụng.
   * @returns thông báo lỗi hoặc null nếu hợp lệ.
   */
  private validateScanQtyVsStandardPacking(materialCode: string, quantity: number, po?: string | null): string | null {
    const code = String(materialCode || '').trim().toUpperCase();
    if (!code) return null;
    if (this.allowExportByCartonSet.has(code)) return null;
    const sp = this.stdFor(code, po);
    if (sp <= 0) return null;
    const q = Number(quantity);
    if (!(q > 0)) return `Số lượng quét không hợp lệ: ${quantity}`;
    if (q > sp) {
      return (
        `Số lượng quét ${q} lớn hơn Standard Packing (${sp}).\n` +
        `Chỉ được quét Chẵn (=${sp}) hoặc Lẻ (<${sp}).\n` +
        `Mã bật Xuất thùng trong danh mục thì không theo quy tắc này.`
      );
    }
    return null;
  }

  private async refreshOutboundQcRuleCache(): Promise<void> {
    try {
      const doc = await this.outboundQcRule.loadRule(this.selectedFactory);
      this.qcRuleEnabledActive = doc.enabled === true;
      this.qcRuleBlockedList = this.outboundQcRule.parseBlockedList(doc.blockedStatusesText);
    } catch (e) {
      console.error('❌ QC rule load:', e);
    }
  }

  async openQcRuleModal(): Promise<void> {
    this.closeDropdown();
    try {
      const doc = await this.outboundQcRule.loadRule(this.selectedFactory);
      this.qcRuleModalEnabled = doc.enabled === true;
      this.qcRuleModalText = doc.blockedStatusesText || '';
    } catch (e) {
      console.error(e);
      this.qcRuleModalEnabled = false;
      this.qcRuleModalText = '';
    }
    this.showQcRuleModal = true;
    this.cdr.markForCheck();
  }

  closeQcRuleModal(): void {
    this.showQcRuleModal = false;
  }

  async saveQcRuleFromModal(): Promise<void> {
    this.qcRuleSaving = true;
    try {
      await this.outboundQcRule.saveRule(this.selectedFactory, {
        enabled: this.qcRuleModalEnabled,
        blockedStatusesText: this.qcRuleModalText
      });
      await this.refreshOutboundQcRuleCache();
      this.showQcRuleModal = false;
    } catch (e) {
      console.error(e);
      appAlert('❌ Không lưu được QC rule.');
    } finally {
      this.qcRuleSaving = false;
      this.cdr.markForCheck();
    }
  }
  
  private setupDefaultDateRange(): void {
    const y = new Date().getFullYear();
    this.startDate = `${y}-01-01`;
    this.endDate = `${y}-12-31`;
    const todayIso = new Date().toISOString().split('T')[0];
    this.showOnlyToday = this.startDate === todayIso && this.endDate === todayIso;
    this.hidePreviousDayHistory = false;

    console.log('📅 Date range set to current year:', { startDate: this.startDate, endDate: this.endDate, showOnlyToday: this.showOnlyToday });
  }
  
  onDateRangeChange(): void {
    console.log('📅 Date range changed:', { startDate: this.startDate, endDate: this.endDate });
    
    // Check if showing only today
    const today = new Date().toISOString().split('T')[0];
    this.showOnlyToday = (this.startDate === today && this.endDate === today);
    
    // Auto-hide previous day's history when user selects today
    if (this.showOnlyToday) {
      this.hidePreviousDayHistory = true;
      console.log('📅 User selected today, automatically hiding previous day\'s history');
    }
    
    // Reload materials with new date filter
    this.loadMaterials();
  }
  
  // Toggle auto-hide previous day's scan history
  toggleHidePreviousDayHistory(): void {
    this.hidePreviousDayHistory = !this.hidePreviousDayHistory;
    console.log(`📅 Auto-hide previous day's scan history: ${this.hidePreviousDayHistory ? 'ON' : 'OFF'}`);
    this.loadMaterials();
  }
  
  // Reset to today's date
  resetToToday(): void {
    const today = new Date();
    this.startDate = today.toISOString().split('T')[0];
    this.endDate = today.toISOString().split('T')[0];
    this.hidePreviousDayHistory = true;
    // “Hôm nay” = xem tất cả mã phát sinh hôm nay, không phụ thuộc LSX đang chọn
    this.selectedProductionOrder = '';
    this.searchProductionOrder = '';
    this.historyFilterPo = '';
    this.historyFilterLsx = '';
    this.materialSearchMode = 'lsx';
    this.materialSearchParsed = null;
    this.materialSearchError = '';
    console.log('📅 Reset to today\'s date and hide previous day\'s history');
    this.loadMaterials();
  }

  private mapOutboundDocToMaterial(doc: any): OutboundMaterial {
    const data = doc.payload.doc.data() as any;
    const rawImd = data.importDate != null && data.importDate !== '' ? String(data.importDate) : '';
    const pImd = rawImd ? this.rmBagHistory.parseQrPart4(rawImd) : null;
    const importDateNorm = pImd?.imdKey || rawImd || null;
    const bagBatchNorm =
      (data.bagBatch && String(data.bagBatch).trim()) ||
      pImd?.bagFractionLabel ||
      '';
    const bagNumNorm =
      (data.bagNumberDisplay && String(data.bagNumberDisplay).trim()) ||
      pImd?.bagNumberDisplay ||
      '';

    return {
      id: doc.payload.doc.id,
      factory: data.factory || this.selectedFactory,
      materialCode: data.materialCode || '',
      poNumber: data.poNumber || '',
      quantity: data.quantity || 0,
      unit: data.unit || '',
      exportQuantity: data.exportQuantity || 0,
      leQty: Number(data.leQty) > 0 ? Math.round(Number(data.leQty) * 100) / 100 : undefined,
      scanCount: data.scanCount ?? 1,
      exportDate: data.exportDate?.toDate() || new Date(),
      location: data.location || '',
      exportedBy: data.exportedBy || '',
      employeeId: data.employeeId || '',
      productionOrder: data.productionOrder || '',
      batchNumber: data.batchNumber || importDateNorm || null,
      importDate: importDateNorm,
      bagBatch: bagBatchNorm,
      bagNumberDisplay: bagNumNorm,
      scanMethod: data.scanMethod || 'MANUAL',
      notes: data.notes || '',
      createdAt: data.createdAt?.toDate() || data.createdDate?.toDate() || new Date(),
      updatedAt: data.updatedAt?.toDate() || data.lastUpdated?.toDate() || new Date()
    } as OutboundMaterial;
  }

  private isDateWithinRange(d: Date, startIso: string, endIso: string): boolean {
    const day = d.toISOString().split('T')[0];
    return day >= startIso && day <= endIso;
  }
  
  ngOnDestroy(): void {
    this.stopOddWeighCamera(true);
    window.removeEventListener('storage', this.onNvlCatalogStorage);
    this.clientReload.clearHold(OutboundComponent.RELOAD_HOLD_KEY);
    this.destroy$.next();
    this.destroy$.complete();
    
    // Cleanup scanner
    if (this.scanner) {
      this.scanner.stop().catch(console.error);
    }
    
    // Remove click outside listener
    document.removeEventListener('click', this.onDocumentClick.bind(this));
    
    // Remove window resize listener
    window.removeEventListener('resize', this.onWindowResize.bind(this));

    document.body.classList.remove(this.outboundMobileBodyClass);
    document.removeEventListener('visibilitychange', this.onOperatorVisibilityChange);
    if (this.operatorExpiryTimer) {
      clearTimeout(this.operatorExpiryTimer);
      this.operatorExpiryTimer = null;
    }
  }

  get hasOperatorSession(): boolean {
    if (!this.operatorSessionId || !this.operatorSessionUntil) return false;
    return Date.now() < this.operatorSessionUntil.getTime();
  }

  get operatorSessionUntilLabel(): string {
    if (!this.operatorSessionUntil) return '';
    const h = this.operatorSessionUntil.getHours();
    const m = this.operatorSessionUntil.getMinutes();
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  onOperatorSessionInputChange(value: string): void {
    this.operatorSessionInput = String(value || '').toUpperCase();
  }

  onOperatorSessionScanned(raw: string): void {
    this.operatorSessionError = '';
    const id = this.parseAspEmployeeId(raw);
    if (!id) {
      this.operatorSessionError = 'Mã nhân viên không hợp lệ. Quét mã ASP + 4 số (ví dụ ASP0106).';
      this.operatorSessionInput = '';
      setTimeout(() => this.focusOperatorSessionInput(), 50);
      return;
    }
    this.startOperatorSession(id);
  }

  private parseAspEmployeeId(raw: string): string {
    const cleaned = String(raw || '').trim().toUpperCase().replace(/[\r\n]/g, '');
    if (cleaned.length < 7) return '';
    const empId = cleaned.substring(0, 7);
    if (!/^ASP\d{4}$/.test(empId)) return '';
    return empId;
  }

  private nextOperatorExpiry(from: Date = new Date()): Date {
    const cutHours = [12, 17, 20];
    for (const h of cutHours) {
      const cut = new Date(from.getFullYear(), from.getMonth(), from.getDate(), h, 0, 0, 0);
      if (from.getTime() < cut.getTime()) return cut;
    }
    return new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1, 12, 0, 0, 0);
  }

  private restoreOperatorSession(): void {
    try {
      const raw = sessionStorage.getItem(OutboundComponent.OPERATOR_SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { employeeId?: string; until?: number };
      const id = this.parseAspEmployeeId(parsed?.employeeId || '');
      const until = Number(parsed?.until || 0);
      if (!id || !until || Date.now() >= until) {
        sessionStorage.removeItem(OutboundComponent.OPERATOR_SESSION_KEY);
        return;
      }
      this.operatorSessionId = id;
      this.operatorSessionUntil = new Date(until);
      this.applyOperatorToBatch();
    } catch {
      sessionStorage.removeItem(OutboundComponent.OPERATOR_SESSION_KEY);
    }
  }

  private persistOperatorSession(): void {
    if (!this.hasOperatorSession) {
      sessionStorage.removeItem(OutboundComponent.OPERATOR_SESSION_KEY);
      return;
    }
    sessionStorage.setItem(OutboundComponent.OPERATOR_SESSION_KEY, JSON.stringify({
      employeeId: this.operatorSessionId,
      until: this.operatorSessionUntil!.getTime()
    }));
  }

  private startOperatorSession(employeeId: string): void {
    this.operatorSessionId = employeeId;
    this.operatorSessionUntil = this.nextOperatorExpiry(new Date());
    this.operatorSessionInput = '';
    this.operatorSessionError = '';
    this.applyOperatorToBatch();
    this.persistOperatorSession();
    this.scheduleOperatorExpiryWatch();
    this.cdr.detectChanges();
  }

  private applyOperatorToBatch(): void {
    if (!this.operatorSessionId) return;
    this.batchEmployeeId = this.operatorSessionId;
    this.isEmployeeIdScanned = true;
  }

  private checkOperatorSessionExpiry(): void {
    if (!this.operatorSessionId) return;
    if (this.hasOperatorSession) {
      this.scheduleOperatorExpiryWatch();
      return;
    }
    this.endOperatorSession('expired');
  }

  private endOperatorSession(reason: 'expired' | 'manual' = 'expired'): void {
    const hadSession = !!this.operatorSessionId;
    this.operatorSessionId = '';
    this.operatorSessionUntil = null;
    this.operatorSessionInput = '';
    this.operatorSessionError = '';
    this.batchEmployeeId = '';
    this.isEmployeeIdScanned = false;
    this.showScanningSetupModal = false;
    sessionStorage.removeItem(OutboundComponent.OPERATOR_SESSION_KEY);
    if (this.operatorExpiryTimer) {
      clearTimeout(this.operatorExpiryTimer);
      this.operatorExpiryTimer = null;
    }
    this.cdr.detectChanges();
    if (hadSession && reason === 'expired') {
      appAlert('Hết phiên làm việc (12:00 / 17:00 / 20:00). Vui lòng quét lại mã nhân viên.');
    }
    setTimeout(() => this.focusOperatorSessionInput(), 80);
  }

  private scheduleOperatorExpiryWatch(): void {
    if (this.operatorExpiryTimer) {
      clearTimeout(this.operatorExpiryTimer);
      this.operatorExpiryTimer = null;
    }
    if (!this.hasOperatorSession || !this.operatorSessionUntil) return;
    const ms = Math.max(250, this.operatorSessionUntil.getTime() - Date.now());
    this.operatorExpiryTimer = setTimeout(() => this.checkOperatorSessionExpiry(), Math.min(ms, 60_000));
  }

  private focusOperatorSessionInput(): void {
    try {
      const el = document.getElementById('ob-op-session-input') as HTMLInputElement | null;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.select?.();
    } catch {}
  }

  onOperatorGateBlur(): void {
    setTimeout(() => {
      if (!this.hasOperatorSession) this.focusOperatorSessionInput();
    }, 180);
  }

  // 📱 Mobile Detection
  private detectMobileDevice(): void {
    const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
    const isMobileUserAgent = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
    const isMobileScreen = window.innerWidth <= 768;
    
    // 🔧 SỬA LỖI: PDA có thể không được detect đúng, nên coi tất cả device nhỏ là mobile
    // Hoặc có thể PDA có user agent đặc biệt
    const isPDA = /pda|handheld|mobile|android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
    const isSmallScreen = window.innerWidth <= 1024; // Tăng threshold cho PDA
    // iPad (iPadOS) báo user agent giống Mac — nhận diện qua màn cảm ứng
    const isIpadOs = /macintosh/i.test(userAgent) && (navigator.maxTouchPoints || 0) > 1;
    
    // Consider it mobile if either user agent, screen size, or PDA-like device
    this.isMobile = isMobileUserAgent || isMobileScreen || isPDA || isSmallScreen || isIpadOs;
    
    // 🔧 SỬA LỖI: Force mobile mode cho PDA nếu có vấn đề detect
    // Nếu user đã chọn scanner và device có vẻ như PDA, force mobile mode
    if (this.selectedScanMethod === 'scanner' && (isPDA || isSmallScreen)) {
      console.log('🔧 Force mobile mode for PDA device');
      this.isMobile = true;
    }
    
    console.log('📱 Device detection:', {
      userAgent: userAgent,
      isMobileUserAgent,
      isMobileScreen,
      isPDA,
      isSmallScreen,
      windowWidth: window.innerWidth,
      isMobile: this.isMobile,
      currentSelectedMethod: this.selectedScanMethod
    });
    
    // Mobile: luôn dùng scanner (không camera). Desktop: scanner
    if (this.selectedScanMethod === null || (this.isMobile && this.selectedScanMethod === 'camera')) {
      this.selectedScanMethod = 'scanner';
      console.log(`📱 Device: ${this.isMobile ? 'Mobile' : 'Desktop'} - Chỉ dùng Scanner`);
    } else {
      console.log(`📱 Device detection: ${this.isMobile ? 'Mobile' : 'Desktop'}, keeping: ${this.selectedScanMethod}`);
    }

    this.syncOutboundMobileBodyClass();
  }

  private syncOutboundMobileBodyClass(): void {
    if (typeof document === 'undefined') {
      return;
    }
    if (this.isMobile) {
      document.body.classList.add(this.outboundMobileBodyClass);
    } else {
      document.body.classList.remove(this.outboundMobileBodyClass);
    }
  }

  // 📱 Mobile Scanner Method Selection
  selectScanMethod(method: 'camera' | 'scanner'): void {
    this.selectedScanMethod = method;
    console.log(`📱 Selected scan method: ${method}`);
    console.log(`📱 Will call: ${method === 'scanner' ? 'startBatchScanningMode()' : 'startCameraScanning()'}`);
    
    // Stop current scanning if active
    if (this.isCameraScanning) {
      this.stopScanning();
    }
    
    // 🔧 SYNC FIX: Refresh inventory data khi chuyển đổi method
    console.log(`🔄 Refreshing inventory data for ${method} method...`);
    this.loadMaterials();
  }


  // 📱 Window Resize Handler
  private onWindowResize(): void {
    const wasMobile = this.isMobile;
    this.detectMobileDevice();
    
    // If mobile state changed, trigger change detection
    if (wasMobile !== this.isMobile) {
      console.log('📱 Mobile state changed:', this.isMobile);
      this.cdr.detectChanges();
    }
  }
  
  // Dropdown methods
  toggleDropdown(): void {
    this.isDropdownOpen = !this.isDropdownOpen;
    this.cdr.detectChanges();
  }
  
  closeDropdown(): void {
    this.isDropdownOpen = false;
    this.cdr.detectChanges();
  }

  /** Kiểm tra Work Order của LSX có trạng thái Kitting không - bắt buộc để quét LSX trong Outbound */
  private async checkWorkOrderKittingStatus(lsx: string): Promise<boolean> {
    const norm = (s: string) => {
      const t = String(s || '').trim().toUpperCase().replace(/\s/g, '');
      const m0 = t.match(/(\d{4}[\/\-\.]\d+)/);
      const m = m0 && /^BS/.test(t) ? ([m0[0], 'BS' + m0[1]] as unknown as RegExpMatchArray) : m0; // LSX bổ sung ≠ LSX chính
      return m ? m[1].replace(/[-.]/g, '/') : t;
    };
    const lsxTrim = lsx.trim();
    const lsxNorm = norm(lsxTrim);

    const toWoList = (snap: any) => (snap?.docs || []).map((d: any) => {
      const data = d.data();
      return Object.assign({ id: d.id }, data && typeof data === 'object' ? data : {}) as any;
    });

    // LSX import nhiều lần (lần 2, 3…) có nhiều Work Order cùng số: ưu tiên lần đang Kitting,
    // không có thì lấy lần mới nhất (lsxSeq lớn nhất) — tránh đọc trúng lần cũ đã Done.
    const findMatch = (woList: any[]) => {
      const hits = woList.filter(wo => {
        const po = String(wo.productionOrder || '').trim();
        if (!po) return false;
        return norm(po) === lsxNorm || po.toUpperCase() === lsxTrim.toUpperCase();
      });
      if (!hits.length) return undefined;
      return hits.find(wo => String(wo.status || '').toLowerCase() === 'kitting')
        || hits.sort((a, b) => (Number(b.lsxSeq) || 1) - (Number(a.lsxSeq) || 1))[0];
    };

    try {
      // Bước 1: Query trực tiếp theo productionOrder (nhanh, không bị giới hạn 500)
      const snapExact = await this.firestore.collection('work-orders', ref =>
        ref.where('factory', '==', this.selectedFactory)
           .where('productionOrder', '==', lsxTrim)
           .limit(20)
      ).get().toPromise();

      let match = findMatch(toWoList(snapExact));

      // Bước 2: Nếu không tìm thấy (khác hoa/thường hoặc format), thử query theo năm/tháng từ LSX
      // Lấy năm và tháng từ mã LSX (vd: KZLSX0326/... → tháng 3, năm 2026)
      const dateMatch = lsxNorm.match(/(\d{2})(\d{2})/);
      if (!match) {
        if (dateMatch) {
          const month = parseInt(dateMatch[1], 10);
          const year = 2000 + parseInt(dateMatch[2], 10);
          if (month >= 1 && month <= 12 && year >= 2020) {
            const snapYM = await this.firestore.collection('work-orders', ref =>
              ref.where('factory', '==', this.selectedFactory)
                 .where('year', '==', year)
                 .where('month', '==', month)
            ).get().toPromise();
            match = findMatch(toWoList(snapYM));
          }
        }
      }

      // Bước 3: LSX không có năm/tháng để lọc → quét theo factory (chỉ khi bước 2 không chạy được)
      if (!match && !dateMatch) {
        const snapAll = await this.firestore.collection('work-orders', ref =>
          ref.where('factory', '==', this.selectedFactory)
        ).get().toPromise();
        match = findMatch(toWoList(snapAll));
      }

      // Bước 4: LSX thuộc factory khác (vd SAMPLE1) — tra đúng mã, không quét cả collection
      // (trước đây có thêm bước đọc TOÀN BỘ work-orders mỗi lần scan sai LSX).
      if (!match) {
        const variants = Array.from(new Set([lsxTrim, lsxTrim.toUpperCase(), lsxTrim.replace(/\s+/g, '').toUpperCase()]))
          .filter(Boolean)
          .slice(0, 10);
        const snapNoFactory = await this.firestore.collection('work-orders', ref =>
          ref.where('productionOrder', 'in', variants).limit(10)
        ).get().toPromise();
        match = findMatch(toWoList(snapNoFactory));
      }

      if (!match) {
        appAlert(`Không tìm thấy Work Order cho LSX "${lsx}". Vui lòng kiểm tra tab Work Order Status.`);
        return false;
      }
      const status = String(match.status || '').toLowerCase();
      if (status !== 'kitting') {
        appAlert(`LSX "${lsx}" chưa ở trạng thái Kitting. Cột Tình trạng ở tab Work Order Status phải là Kitting mới được quét LSX.`);
        return false;
      }
      return true;
    } catch (e) {
      console.warn('checkWorkOrderKittingStatus error:', e);
      appAlert('Không kiểm tra được trạng thái Work Order. Vui lòng thử lại.');
      return false;
    }
  }
  
  // Search by Production Order (LSX) - Only load when user enters LSX
  async searchByProductionOrder(): Promise<void> {
    if (!this.searchProductionOrder || !this.searchProductionOrder.trim()) {
      appAlert('⚠️ Vui lòng nhập lệnh sản xuất!');
      return;
    }
    
    const searchTerm = this.searchProductionOrder.trim().toUpperCase();
    console.log(`🔍 Searching for Production Order: ${searchTerm}`);

    // Nếu không phải LSX -> coi như search mã hàng/QR và hiển thị thẳng xuống bảng
    if (!this.isValidLsxCode(searchTerm)) {
      await this.searchByMaterialInput(this.searchProductionOrder.trim());
      return;
    }

    this.materialSearchMode = 'lsx';
    this.materialSearchParsed = null;
    this.materialSearchError = '';
    
    // 🔧 TÌM KIẾM KHÔNG PHÂN BIỆT CHỮ HOA/THƯỜNG
    // Tìm trong availableProductionOrders để khớp chính xác
    const foundLSX = this.availableProductionOrders.find(lsx => 
      lsx.toUpperCase() === searchTerm || lsx.toUpperCase().includes(searchTerm)
    );
    
    console.log(`📋 Available LSX list (${this.availableProductionOrders.length}):`, this.availableProductionOrders);
    
    if (foundLSX) {
      this.selectedProductionOrder = foundLSX; // Dùng LSX gốc từ DB
      console.log(`✅ Found matching LSX: ${foundLSX}`);
    } else {
      // Không tìm thấy - vẫn thử search để xem có dữ liệu không
      this.selectedProductionOrder = this.searchProductionOrder.trim();
      console.log(`⚠️ No exact match in available list. Searching with: ${this.selectedProductionOrder}`);
      console.log(`💡 Tip: Available LSX in DB:`, this.availableProductionOrders.slice(0, 5));
    }
    
    this.loadMaterials(); // Load data for this LSX (không kiểm tra trạng thái khi search)
  }

  private parseMaterialSearchInput(raw: string): { materialCode: string; poNumber?: string; imdKey?: string; bagNumberDisplay?: string } | null {
    const t = (raw || '').trim();
    if (!t) return null;

    // Format chuẩn QR: Material|PO|Qty|IMD (IMD có thể kèm bag)
    const clean = t.replace(/\s*\|\s*/g, '|');
    const parts = clean.split('|').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 1 && /^[A-Z]\d{6,}$/i.test(parts[0])) {
      const materialCode = parts[0].toUpperCase();
      const poNumber = parts.length >= 2 ? parts[1] : undefined;
      const part4 = parts.length >= 4 ? parts[3] : undefined;
      const pImd = part4 ? this.rmBagHistory.parseQrPart4(part4) : null;
      const imdKey = pImd?.imdKey || (part4 ? String(part4).trim() : undefined);
      const bagNumberDisplay = (pImd?.bagNumberDisplay || '').trim() || undefined;
      return { materialCode, poNumber, imdKey, bagNumberDisplay };
    }

    // Nhập trực tiếp mã hàng (B + 6 số...)
    const m = t.match(/[A-Z]\d{6,}/);
    if (m) {
      return { materialCode: m[0].toUpperCase() };
    }

    return null;
  }

  async searchByMaterialInput(raw: string): Promise<void> {
    const parsed = this.parseMaterialSearchInput(raw);
    if (!parsed?.materialCode) {
      appAlert('⚠️ Vui lòng nhập LSX hoặc quét/nhập mã hàng (vd B019019 hoặc QR: Material|PO|SL|IMD).');
      return;
    }

    this.materialSearchMode = 'material';
    this.materialSearchParsed = parsed;
    this.materialSearchError = '';
    this.materialSearchLoading = true;
    this.selectedProductionOrder = '';
    this.cdr.detectChanges();

    try {
      const start = this.startDate;
      const end = this.endDate;
      const snap = await this.firestore
        .collection('outbound-materials', ref => {
          let q: any = ref.where('factory', '==', this.selectedFactory).where('materialCode', '==', parsed.materialCode).limit(10000);
          if (parsed.poNumber) {
            q = q.where('poNumber', '==', parsed.poNumber);
          }
          return q;
        })
        .get()
        .toPromise();

      const rows: OutboundMaterial[] = (snap?.docs || []).map((d: any) => {
        const data = d.data();
        // giả lập cấu trúc snapshotChanges() để dùng lại mapOutboundDocToMaterial
        return this.mapOutboundDocToMaterial({ payload: { doc: { id: d.id, data: () => data } } });
      });

      let filtered = rows.filter(r =>
        !start || !end ? true : !!(r.exportDate && this.isDateWithinRange(r.exportDate, start, end))
      );

      filtered.sort((a, b) => {
        const u = b.updatedAt!.getTime() - a.updatedAt!.getTime();
        if (u !== 0) return u;
        const ed = b.exportDate.getTime() - a.exportDate.getTime();
        if (ed !== 0) return ed;
        return b.createdAt!.getTime() - a.createdAt!.getTime();
      });

      const bagKeyOf = (it: OutboundMaterial): string =>
        this.rmBagHistory.resolveOutboundDupBagSticker({
          bagNumberDisplay: it.bagNumberDisplay,
          bagBatch: it.bagBatch,
          importDate: it.importDate,
          batchNumber: it.batchNumber,
          notes: it.notes
        }).trim();

      const groupKeyOf = (it: OutboundMaterial): string => {
        const fac = String(it.factory || this.selectedFactory).trim();
        const mc = String(it.materialCode || '').trim().toUpperCase();
        const po = String(it.poNumber || '').trim();
        const imd = String(it.importDate || '').trim();
        const bag = bagKeyOf(it);
        return `${fac}|${mc}|${po}|${imd}|${bag}`;
      };

      const groupCounts = new Map<string, number>();
      for (const it of filtered) {
        const bag = bagKeyOf(it);
        if (!bag || bag === '—') continue;
        const key = groupKeyOf(it);
        groupCounts.set(key, (groupCounts.get(key) || 0) + 1);
      }

      for (const it of filtered) {
        const bag = bagKeyOf(it);
        const key = groupKeyOf(it);
        it.bagDuplicate = !!(bag && bag !== '—' && (groupCounts.get(key) || 0) > 1);
      }

      this.materials = [...filtered];
      this.filteredMaterials = [...filtered];
      this.currentPage = 1;
      this.updatePagination();

      if (filtered.length === 0) {
        this.materialSearchError = `Không có lịch sử xuất kho cho mã ${parsed.materialCode} trong khoảng ngày đang chọn.`;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('❌ searchByMaterialInput error:', e);
      this.materialSearchError = `Lỗi tìm theo mã hàng: ${msg}`;
      this.materials = [];
      this.filteredMaterials = [];
      this.updatePagination();
    } finally {
      this.materialSearchLoading = false;
      this.cdr.detectChanges();
    }
  }

  openLsxFromMaterialResult(lsx: string): void {
    this.searchProductionOrder = lsx;
    this.selectedProductionOrder = lsx;
    this.materialSearchMode = 'lsx';
    this.materialSearchError = '';
    this.loadMaterials();
  }
  
  // Clear Production Order filter (hide all data)
  clearProductionOrderFilter(): void {
    this.selectedProductionOrder = '';
    this.searchProductionOrder = '';
    this.historyFilterPo = '';
    this.historyFilterLsx = '';
    this.materialSearchMode = 'lsx';
    this.materialSearchParsed = null;
    this.materialSearchError = '';
    console.log('🔄 Clearing Production Order filter - hiding all data');
    this.loadMaterials(); // Reload to hide all
  }
  
  // Display only first 7 characters of employee ID
  getDisplayEmployeeId(employeeId: string): string {
    if (!employeeId) return 'N/A';
    return employeeId.length > 7 ? employeeId.substring(0, 7) : employeeId;
  }

  trackByIndex(index: number, _: any): number { return index; }

  // ── Mobile WMS UI (layout only; logic unchanged) ─────────────────────────
  mobileMaterialKey(m: OutboundMaterial): string {
    const t = m.createdAt instanceof Date ? m.createdAt.getTime() : 0;
    return m.id || `${m.materialCode}|${m.poNumber}|${t}`;
  }

  toggleMobileMaterialExpand(m: OutboundMaterial): void {
    const k = this.mobileMaterialKey(m);
    this.mobileMaterialExpanded[k] = !this.mobileMaterialExpanded[k];
  }

  isMobileMaterialExpanded(m: OutboundMaterial): boolean {
    return !!this.mobileMaterialExpanded[this.mobileMaterialKey(m)];
  }

  getMobileKpiLsx(): string {
    const raw =
      (this.batchProductionOrder || '').trim() ||
      (this.selectedProductionOrder || '').trim() ||
      (this.searchProductionOrder || '').trim();
    if (!raw) {
      return '—';
    }
    return raw.length > 18 ? raw.slice(0, 16) + '…' : raw;
  }

  getMobileKpiScannedQty(): number {
    if (this.isBatchScanningMode && this.pendingScanData?.length) {
      return this.pendingScanData.reduce((s, x) => s + (Number(x?.quantity) || 0), 0);
    }
    return this.getHistoryViewMaterials().reduce((s, m) => s + (Number(m.exportQuantity) || 0), 0);
  }

  /** Phiên batch: số dòng chờ Done; ngoài batch: số dòng đang hiển thị */
  getMobileKpiPendingCount(): number {
    if (this.isBatchScanningMode) {
      return this.pendingScanData.length;
    }
    return this.getHistoryViewMaterials().length;
  }

  focusMobileScanner(): void {
    this.mobileBottomTab = 'outbound';
    setTimeout(() => {
      const el = document.querySelector(
        '.ob-m .scanner-input, .ob-m .ob-m-hero__scanner-input'
      ) as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 0);
  }

  /** Giữ hành vi cũ: cuộn tới danh sách (gọi từ chỗ khác nếu cần). */
  scrollMobileToMaterials(): void {
    this.mobileBottomTab = 'outbound';
    document.getElementById('ob-m-materials')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  mobileNavOutbound(): void {
    this.mobileBottomTab = 'outbound';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    this.focusMobileScanner();
  }

  goMobileMenu(): void {
    this.mobileBottomTab = 'home';
    this.router.navigate(['/menu']);
  }

  // ── Xuất BS methods ─────────────────────────────────────────────────────

  switchExportMode(mode: 'NL' | 'BS'): void {
    this.exportMode = mode;
    if (mode === 'BS') {
      this.mobileBottomTab = 'bs';
      void this.loadBsItems();
    } else {
      this.mobileBottomTab = 'outbound';
    }
  }

  async loadBsItems(): Promise<void> {
    this.bsLoading = true;
    this.bsError = '';
    this.bsItems = [];
    try {
      const factory = this.selectedFactory;
      const commonDocId = this.bsCommonDocId(factory);
      const legacyNoLsxDocId = `${factory}_NO_LSX`;
      // Giới hạn theo ngày import (chỉ lọc importedAt — không cần index ghép; lọc nhà máy ở máy)
      const cutoff = this.bsDays > 0 ? new Date(Date.now() - this.bsDays * 86400000) : null;
      const [snap, commonSnap, legacySnap] = await Promise.all([
        this.firestore
          .collection('pxk-bs-data', ref => cutoff ? ref.where('importedAt', '>=', cutoff) : ref.where('factory', '==', factory))
          .get()
          .toPromise(),
        this.firestore.collection('pxk-bs-data').doc(commonDocId).get().toPromise(),
        this.firestore.collection('pxk-bs-data').doc(legacyNoLsxDocId).get().toPromise()
      ]);

      const docsById = new Map<string, any>();
      (snap?.docs || []).forEach(doc => {
        const d = doc.data() as any;
        if (String(d?.factory || '') === factory) docsById.set(doc.id, d);
      });
      if (commonSnap?.exists) docsById.set(commonSnap.id, commonSnap.data());
      if (legacySnap?.exists) docsById.set(legacySnap.id, legacySnap.data());

      if (docsById.size === 0) {
        this.bsLoading = false;
        return;
      }

      const items: BsPendingItem[] = [];
      docsById.forEach((data: any, docId: string) => {
        const lsx = this.normalizeBsDisplayLsx(String(data?.lsx ?? ''), docId);
        const imp = data?.importedAt;
        const importedAt: Date | null = imp?.toDate ? imp.toDate() : (imp ? new Date(imp) : null);
        const lines: any[] = data?.lines || [];
        lines.forEach((line: any, idx: number) => {
          const materialCode = String(
            line?.materialCode || line?.maVatTu || line?.maHang || ''
          ).trim();
          if (!materialCode) return;
          items.push({
            docId,
            lsx,
            factory: data?.factory || factory,
            lineIndex: idx,
            materialCode,
            po: String(line?.po || line?.soPO || '').trim(),
            quantity: Number(line?.quantity ?? line?.soLuong ?? 0) || 0,
            unit: String(line?.unit || line?.dvt || '').trim(),
            tenVatTu: String(line?.tenVatTu || '').trim(),
            done: !!line?.done,
            exported: !!line?.done,
            iqcStatus: '',
            importedAt,
            prevExported: Number(line?.exportedQty) || 0,
            hidden: !!line?.hidden,
            deleted: !!line?.deletedAt
          });
        });
      });

      // LSX Chung lên đầu; còn lại LSX cũ nhất trước (năm → tháng → số thứ tự), rồi mã
      items.sort((a, b) => {
        const aCommon = this.isBsCommonLsx(a.lsx) ? 0 : 1;
        const bCommon = this.isBsCommonLsx(b.lsx) ? 0 : 1;
        if (aCommon !== bCommon) return aCommon - bCommon;
        return this.bsLsxSortKey(a.lsx).localeCompare(this.bsLsxSortKey(b.lsx))
          || a.materialCode.localeCompare(b.materialCode);
      });
      this.bsItems = items;
      this.bsIqcDone = new Set();
      this.bsSelected.clear();
      // Hiện danh sách ngay; "đã xuất chưa" tra nền rồi tự cập nhật (IQC tra theo dòng đang hiện — queueBsIqc)
      const pending = items.filter((it) => !it.done);
      void this.loadBsExportedKeys(items).then((exportedByKey) => {
        if (this.bsItems !== items) return;
        this.applyBsExportedInference(items, exportedByKey);
        this.cdr.markForCheck();
      });
    } catch (e: any) {
      this.bsError = 'Không tải được danh sách Xuất BS.';
      console.error('[BS] loadBsItems error', e);
    } finally {
      this.bsLoading = false;
    }
  }

  /** Mã + PO đã tra / đang tra IQC của danh sách BS hiện tại. */
  private bsIqcDone = new Set<string>();
  private bsIqcTimer: any = null;

  /** Tra IQC chỉ cho dòng đang hiện trên bảng (gom lại, chạy nền). */
  private queueBsIqc(list: BsPendingItem[]): void {
    const need = list.filter((it) => !it.iqcStatus && !this.bsIqcDone.has(this.bsMatPoKey(it.materialCode, it.po)));
    if (!need.length || this.bsIqcTimer) return;
    this.bsIqcTimer = setTimeout(() => {
      this.bsIqcTimer = null;
      const items = this.bsItems;
      const batch = this.bsPageSlice(this.filteredBsItems)
        .filter((it) => !it.iqcStatus && !this.bsIqcDone.has(this.bsMatPoKey(it.materialCode, it.po)));
      batch.forEach((it) => this.bsIqcDone.add(this.bsMatPoKey(it.materialCode, it.po)));
      if (!batch.length) return;
      void this.loadBsIqcMap(batch).then((iqcMap) => {
        if (this.bsItems !== items) return;
        for (const it of items) {
          const iqc = iqcMap.get(this.bsMatPoKey(it.materialCode, it.po));
          if (iqc && !it.iqcStatus) it.iqcStatus = iqc;
        }
        this.cdr.markForCheck();
      });
    }, 0);
  }

  private bsCommonDocId(factory: string = this.selectedFactory): string {
    return `${factory}_LSX_Chung`;
  }

  private isBsCommonLsx(lsx: string): boolean {
    const t = String(lsx || '').trim();
    if (!t || t === '__NO_LSX__') return true;
    const u = t.replace(/\s+/g, '').toUpperCase();
    return u === 'LSXCHUNG' || u === 'N/A' || u === 'NA';
  }

  /** Chuẩn hoá LSX hiển thị / xuất: thiếu LSX → LSX Chung */
  private normalizeBsDisplayLsx(rawLsx: string, docId?: string): string {
    const t = String(rawLsx || '').trim();
    if (docId && (docId.endsWith('_NO_LSX') || docId.endsWith('_LSX_Chung'))) {
      return BS_COMMON_LSX;
    }
    if (this.isBsCommonLsx(t)) return BS_COMMON_LSX;
    return t;
  }

  /** Gán LSX khi import: trống / không chuẩn → LSX Chung */
  private resolveBsImportLsx(raw: string): string {
    const t = String(raw || '').trim().replace(/\uFF0F/g, '/').replace(/\s+/g, '');
    if (!t || /^(N\/?A|-|—|–|NONE|NULL|\.)$/i.test(t)) return BS_COMMON_LSX;
    if (this.isBsCommonLsx(t)) return BS_COMMON_LSX;
    if (/^(KZLSX|LHLSX)\d{4}\/\d{4}$/i.test(t)) return t.toUpperCase();
    // Có giá trị nhưng không đúng format chuẩn → LSX Chung
    return BS_COMMON_LSX;
  }

  private bsMatchKey(lsx: string, materialCode: string, po: string): string {
    const lsxN = this.woOutboundCreatedBy.normLsxForMatch(lsx);
    const matN = String(materialCode || '').trim().toUpperCase();
    const poN = String(po || '').replace(/\s+/g, '').toUpperCase();
    return `${lsxN}|${matN}|${poN}`;
  }

  private bsMatPoKey(materialCode: string, po: string): string {
    return `${String(materialCode || '').trim().toUpperCase()}|${String(po || '').replace(/\s+/g, '').toUpperCase()}`;
  }

  /**
   * Suy ra dòng BS (chưa có cờ done) đã xuất: chỉ dùng bản ghi xuất cùng LSX + mã + PO, ngày xuất ≥ ngày import phiếu,
   * cộng lượng đủ lượng cần. Mỗi bản ghi chỉ dùng cho 1 dòng — dòng import trước được trừ trước;
   * dòng đã Done / xuất dở trừ trước phần lượng của chúng, để không bị tính lại cho dòng khác.
   */
  private applyBsExportedInference(items: BsPendingItem[], exportedByKey: Map<string, Array<{ qty: number; ms: number }>>): void {
    const EPS = 1e-6;
    const pools = new Map<string, Array<{ qty: number; ms: number }>>();
    exportedByKey.forEach((list, key) => pools.set(key, [...list].sort((a, b) => a.ms - b.ms).map((r) => ({ ...r }))));
    // Lấy lượng từ các bản ghi xuất sau ngày import; trả về lượng lấy được
    const take = (key: string, sinceMs: number, want: number, commitIfShort: boolean): number => {
      const pool = pools.get(key);
      if (!pool || !(want > 0)) return 0;
      const avail = pool.filter((r) => r.ms >= sinceMs && r.qty > EPS).reduce((s, r) => s + r.qty, 0);
      if (!commitIfShort && avail < want - EPS) return 0;
      let need = want;
      for (const r of pool) {
        if (need <= EPS) break;
        if (r.ms < sinceMs || r.qty <= EPS) continue;
        const q = Math.min(r.qty, need);
        r.qty -= q;
        need -= q;
      }
      return want - need;
    };
    const ordered = [...items].sort((a, b) => (a.importedAt?.getTime() || 0) - (b.importedAt?.getTime() || 0));
    // Ngày import: trừ 1 ngày cho chắc (giờ import / giờ máy lệch)
    const since = (it: BsPendingItem) => (it.importedAt?.getTime() || 0) - 24 * 60 * 60 * 1000;
    const keyOf = (it: BsPendingItem) => this.bsMatchKey(it.lsx, it.materialCode, it.po);
    // 1. Dòng đã Done / đã xóa / xuất dở: giữ trạng thái, trừ phần lượng đã xuất khỏi pool
    for (const it of ordered) {
      if (it.done && !it.deleted) take(keyOf(it), since(it), Number(it.quantity) || 0, true);
      else if (!it.done && (it.prevExported || 0) > 0) take(keyOf(it), since(it), Number(it.prevExported) || 0, true);
    }
    // 2. Dòng chưa có cờ: chỉ coi là đã xuất khi đủ lượng
    for (const it of ordered) {
      if (it.exported || it.done || (it.prevExported || 0) > 0) continue;
      if (take(keyOf(it), since(it), Number(it.quantity) || 0, false) > 0) it.exported = true;
    }
  }

  /**
   * Bản ghi xuất kho theo khóa LSX|mã|PO (lượng + ngày xuất) — để suy ra dòng BS đã xuất.
   */
  private async loadBsExportedKeys(items: BsPendingItem[]): Promise<Map<string, Array<{ qty: number; ms: number }>>> {
    const keys = new Map<string, Array<{ qty: number; ms: number }>>();
    const add = (key: string, d: any) => {
      const raw = d.exportDate || d.createdAt;
      const ms = raw?.toDate ? raw.toDate().getTime() : (raw ? new Date(raw).getTime() : 0);
      const qty = Number(d.exportQuantity ?? d.quantity) || 0;
      if (!(qty > 0)) return;
      const list = keys.get(key) || [];
      list.push({ qty, ms: Number.isFinite(ms) ? ms : 0 });
      keys.set(key, list);
    };
    const uniqueLsx = [...new Set(items.map(it => String(it.lsx || '').trim()).filter(Boolean))];
    const FIRESTORE_IN_MAX = 30;
    try {
      for (let i = 0; i < uniqueLsx.length; i += FIRESTORE_IN_MAX) {
        const chunk = uniqueLsx.slice(i, i + FIRESTORE_IN_MAX);
        const snap = await this.firestore
          .collection('outbound-materials', ref =>
            ref.where('factory', '==', this.selectedFactory).where('productionOrder', 'in', chunk)
          )
          .get()
          .toPromise();
        (snap?.docs || []).forEach(doc => {
          const d = doc.data() as any;
          add(this.bsMatchKey(d.productionOrder, d.materialCode, d.poNumber || d.po), d);
        });
      }

      // Phiếu BS LSX Chung / không LSX cũ: khớp bản ghi bsExport có productionOrder rỗng hoặc LSX Chung
      // — chỉ đọc theo mã của các dòng LSX Chung đang chờ (không quét 3000 bản ghi xuất BS)
      const commonCodes = [...new Set(items.filter(it => this.isBsCommonLsx(it.lsx))
        .map(it => String(it.materialCode || '').trim()).filter(Boolean))];
      for (let i = 0; i < commonCodes.length; i += FIRESTORE_IN_MAX) {
        const chunk = commonCodes.slice(i, i + FIRESTORE_IN_MAX);
        const snap = await this.firestore
          .collection('outbound-materials', ref =>
            ref.where('factory', '==', this.selectedFactory).where('bsExport', '==', true).where('materialCode', 'in', chunk)
          )
          .get()
          .toPromise();
        (snap?.docs || []).forEach(doc => {
          const d = doc.data() as any;
          const po = String(d.productionOrder || '').trim();
          if (po && !this.isBsCommonLsx(po)) return;
          add(this.bsMatchKey(BS_COMMON_LSX, d.materialCode, d.poNumber || d.po), d);
        });
      }
    } catch (e) {
      console.warn('[BS] loadBsExportedKeys failed', e);
    }
    return keys;
  }

  private async loadBsIqcMap(items: BsPendingItem[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const byMatPo = new Map<string, string[]>();
    const codes = [...new Set(items.map(it => String(it.materialCode || '').trim()).filter(Boolean))];
    if (codes.length === 0) return out;
    const parallel = 10;
    try {
      for (let i = 0; i < codes.length; i += parallel) {
        const chunk = codes.slice(i, i + parallel);
        const snaps = await Promise.all(chunk.map(code =>
          this.firestore.collection('inventory-materials', ref =>
            ref.where('factory', '==', this.selectedFactory).where('materialCode', '==', code).limit(400)
          ).get().toPromise()
        ));
        snaps.forEach(snap => {
          (snap?.docs || []).forEach(doc => {
            const d = doc.data() as any;
            const st = String(d.iqcStatus || '').trim();
            if (!st) return;
            const k = this.bsMatPoKey(d.materialCode, d.poNumber);
            if (!byMatPo.has(k)) byMatPo.set(k, []);
            byMatPo.get(k)!.push(st);
          });
        });
      }
    } catch (e) {
      console.warn('[BS] loadBsIqcMap failed', e);
    }
    byMatPo.forEach((sts, k) => out.set(k, this.summarizeBsIqc(sts)));
    return out;
  }

  private summarizeBsIqc(sts: string[]): string {
    const uniq = [...new Set(sts.map(s => String(s || '').trim()).filter(Boolean))];
    if (uniq.length === 0) return '';
    const u = uniq.map(s => s.toUpperCase());
    if (u.some(s => s === 'PASS' || s === 'PASSED')) {
      return u.every(s => s === 'PASS' || s === 'PASSED') ? 'Pass' : uniq.join(' · ');
    }
    return uniq.length === 1 ? uniq[0] : uniq.join(' · ');
  }

  bsIqcClass(status?: string): string {
    const u = String(status || '').trim().toUpperCase();
    if (!u || u === '—') return '';
    if (u === 'PASS' || u === 'PASSED' || u.includes('PASS')) return 'bs-iqc--pass';
    if (u.includes('NG')) return 'bs-iqc--ng';
    return 'bs-iqc--wait';
  }

  async deleteBsItem(item: BsPendingItem): Promise<void> {
    if (!confirm(`Xoá khỏi danh sách BS?\n${item.materialCode} | PO: ${item.po} | LSX: ${item.lsx || '—'}`)) return;
    try {
      const docSnap = await this.firestore.collection('pxk-bs-data').doc(item.docId).get().toPromise();
      if (docSnap && docSnap.exists) {
        const data = docSnap.data() as any;
        const lines: any[] = [...(data.lines || [])];
        if (lines[item.lineIndex]) {
          lines[item.lineIndex] = {
            ...lines[item.lineIndex], done: true, deletedAt: new Date(),
            deletedBy: String(this.operatorSessionId || '').trim().toUpperCase()
          };
        }
        await this.firestore.collection('pxk-bs-data').doc(item.docId).update({ lines });
      }
      this.bsItems = this.bsItems.map(b =>
        b.docId === item.docId && b.lineIndex === item.lineIndex
          ? { ...b, done: true, exported: true, deleted: true }
          : b
      );
    } catch (e: any) {
      appAlert('❌ Lỗi xoá: ' + (e?.message || e));
    }
  }

  /**
   * Xuất BS: chia lượng cần theo Standard Packing như Xuất NL — x bag chẵn + 1 lẻ.
   * scanned = lượng đã scan trong popup (tính phần còn lại).
   */
  bsBagInfo(item: BsPendingItem | null, scanned = 0): {
    std: number; needText: string; remainText: string; remainOddQty: number; remain: number;
  } | null {
    if (!item) return null;
    const std = this.stdFor(item.materialCode, item.po);
    const r4 = (n: number) => Math.round(n * 10000) / 10000;
    const need = r4(Number(item.quantity) || 0);
    const remain = Math.max(0, r4(need - (Number(scanned) || 0)));
    if (!(std > 0)) return { std: 0, needText: '—', remainText: '—', remainOddQty: 0, remain };
    const split = (q: number) => {
      const full = Math.floor(r4(q / std));
      return { full, odd: r4(q - full * std) };
    };
    const n = split(need);
    const m = split(remain);
    const needText = [n.full ? `${n.full}×${this.formatScanNum(std)}` : '', n.odd > 0 ? `lẻ ${this.formatScanNum(n.odd)}` : ''].filter(Boolean).join(' + ') || '0';
    const remainText = remain <= 0.0001 ? 'Xong'
      : [m.full ? `${m.full} chẵn` : '', m.odd > 0 ? `1 lẻ (${this.formatScanNum(m.odd)})` : ''].filter(Boolean).join(' + ');
    return { std, needText, remainText, remainOddQty: m.odd, remain };
  }

  /** Xuất BS → Tem lẻ: dùng chung popup tách tem lẻ của Xuất NL (đọc tồn từng lô của mã + PO). */
  async openBsTemLe(): Promise<void> {
    const item = this.bsScanItem;
    if (!item) return;
    // Đọc lại đã xuất trên hệ thống (máy khác có thể vừa xuất) → tính lại phần còn lại
    try {
      await this.refreshBsPrevExported(item);
    } catch (e: any) {
      this.bsScanError = 'Không đọc lại được lượng đã xuất: ' + (e?.message || e);
      return;
    }
    const info = this.bsBagInfo(item, this.bsScanDoneTotal);
    if (!info) return;
    if (info.remain <= 0.0001) { this.bsScanError = 'Dòng BS này đã xuất đủ — không cần tách tem lẻ.'; return; }
    if (!(info.std > 0)) { this.bsScanError = `Mã ${item.materialCode} chưa có Standard Packing — không tách tem lẻ được.`; return; }
    if (!(info.remainOddQty > 0)) { this.bsScanError = 'Không còn lượng lẻ cần xuất.'; return; }
    const code = String(item.materialCode || '').trim().toUpperCase();
    const po = this.normalizePxImportPo(item.po);
    let lots: PxkInvLot[] = [];
    try {
      lots = (await this.readInvLots([code])).get(this.pxkScanKey(code, po)) || [];
    } catch (e: any) {
      this.bsScanError = 'Không đọc được tồn kho: ' + (e?.message || e);
      return;
    }
    const row = {
      code, po, need: Number(item.quantity) || 0, exported: Number(item.prevExported) || 0, scanned: this.bsScanTotal, remain: info.remain,
      std: info.std, needBags: 0, doneBags: 0, remainFull: 0, remainOddQty: info.remainOddQty,
      needFull: 0, needOdd: info.remainOddQty, stock: null
    } as ScanPxkRow;
    await this.openTemLeOb(row, lots);
  }

  /** Đọc lại exportedQty của dòng BS từ pxk-bs-data, cập nhật item + danh sách. Trả về lượng đã xuất. */
  private async refreshBsPrevExported(item: BsPendingItem): Promise<number> {
    const snap = await this.firestore.collection('pxk-bs-data').doc(item.docId).get().toPromise();
    const line = ((snap?.data() as any)?.lines || [])[item.lineIndex];
    const fresh = Math.round((Number(line?.exportedQty) || 0) * 10000) / 10000;
    if (fresh !== (Number(item.prevExported) || 0)) {
      item.prevExported = fresh;
      this.bsItems = this.bsItems.map(b =>
        b.docId === item.docId && b.lineIndex === item.lineIndex ? { ...b, prevExported: fresh } : b
      );
    }
    return fresh;
  }

  openBsScanDialog(item: BsPendingItem): void {
    this.bsScanItem = item;
    this.bsScanLines = [];
    this.bsScanInput = '';
    this.bsScanError = '';
    this.bsSaving = false;
    this.bsScanOpen = true;
    setTimeout(() => {
      const el = document.getElementById('bs-scan-input');
      if (el) el.focus();
    }, 100);
  }

  closeBsScanDialog(): void {
    this.bsScanOpen = false;
    this.bsScanItem = null;
    this.bsScanLines = [];
    this.bsScanInput = '';
    this.bsScanError = '';
  }

  onBsScanKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      const val = (this.bsScanInput || '').trim();
      this.bsScanInput = '';
      if (val) void this.processBsScan(val);
      event.preventDefault();
    }
  }

  async processBsScan(raw: string): Promise<void> {
    const item = this.bsScanItem;
    if (!item) return;
    if (this.clCount) {
      this.bsScanError = `❌ Đang chờ nhập số đếm bag CL ${this.clCount.code}. Xác nhận hoặc Hủy trước khi scan tiếp.`;
      return;
    }
    if (this.tlPhoto) {
      this.bsScanError = `❌ Đang chờ chụp hình bag ${this.tlPhoto.tag}. Chụp hoặc Hủy trước khi scan tiếp.`;
      return;
    }
    if (this.oddWeigh) {
      this.bsScanError = `❌ Đang chờ chụp hình + nhập trọng lượng bag lẻ ${this.oddWeigh.code}. Lưu hoặc Hủy trước khi scan tiếp.`;
      return;
    }

    // QR format: materialCode|PO|qty|IMD-bag/total
    const parts = raw.split('|');
    if (parts.length < 3) {
      this.bsScanError = `❌ QR không đúng định dạng. Mong đợi: Mã|PO|SL|IMD`;
      return;
    }

    const strippedBs = stripTemThungMarker(parts[0] || '');
    if (strippedBs.isTemThung && !this.allowExportByCartonSet.has(strippedBs.materialCode.trim().toUpperCase())) {
      this.bsScanError = `❌ Mã ${strippedBs.materialCode} không nằm trong danh mục Xuất thùng — không thể xuất bằng Tem Thùng.`;
      return;
    }
    const scannedCode = strippedBs.materialCode.trim().toUpperCase();
    const scannedPo   = (parts[1] || '').trim();
    let scannedQty = this.parseScanQty(parts[2]);
    const part4       = (parts[3] || '').trim();

    // Extract IMD (before '-') from part4
    const dashIdx = part4.lastIndexOf('-');
    const scannedImd = dashIdx >= 0 ? part4.slice(0, dashIdx).trim() : part4.trim();

    // Validate mã
    if (scannedCode !== item.materialCode.toUpperCase().trim()) {
      this.bsScanError = `❌ Sai mã hàng. Scan: "${scannedCode}" — Cần: "${item.materialCode}"`;
      return;
    }

    // Validate PO (normalize spaces)
    const normPo      = (scannedPo).replace(/\s+/g, '').toUpperCase();
    const normItemPo  = (item.po || '').replace(/\s+/g, '').toUpperCase();
    if (normPo !== normItemPo) {
      this.bsScanError = `❌ Sai PO. Scan: "${scannedPo}" — Cần: "${item.po}"`;
      return;
    }

    if (scannedQty <= 0) {
      this.bsScanError = `❌ Số lượng scan không hợp lệ: ${scannedQty}`;
      return;
    }

    await this.ensureLotStd(scannedCode);
    const packErr = this.validateScanQtyVsStandardPacking(scannedCode, scannedQty, scannedPo);
    if (packErr) {
      this.bsScanError = `❌ ${packErr}`;
      return;
    }

    const needQty = Number(item.quantity) || 0;
    if (needQty > 0) {
      const remain = needQty - this.bsScanDoneTotal;
      if (scannedQty > remain + 1e-9) {
        const fmt = (n: number) => n.toLocaleString('vi-VN');
        this.bsScanError =
          `❌ Từ chối: số lượng quét ${fmt(scannedQty)} dư so với còn lại ${fmt(Math.max(0, remain))}.\n` +
          `Cần ${fmt(needQty)} ${item.unit || ''} — đã xuất / scan ${fmt(this.bsScanDoneTotal)}. Không cho xuất dư trong 1 lần scan.`;
        return;
      }
    }

    const bsStockErr = await this.validateScanStock(
      scannedCode, scannedPo, scannedQty, scannedImd,
      this.bsScanLines.map((l) => ({ materialCode: l.materialCode, poNumber: l.po, quantity: l.qty, importDate: l.imd }))
    );
    if (bsStockErr.err) {
      this.bsScanError = `❌ ${bsStockErr.err}`;
      return;
    }
    if (needQty > 0) {
      const crumb = this.crumbTopUp(bsStockErr.left, scannedQty, needQty - this.bsScanDoneTotal - scannedQty);
      if (crumb > 0) scannedQty = Math.round((scannedQty + crumb) * 10000) / 10000;
    }

    this.bsScanError = '';
    const line: BsScanLine = {
      materialCode: scannedCode,
      po: scannedPo,
      imd: scannedImd,
      qty: scannedQty,
      rawQr: raw
    };
    // Bag CL lẻ duy nhất của mã PCS (tồn mã < 5000) → đếm chính xác trước khi nhận tem
    const bsPendingCode = this.bsScanLines
      .filter((l) => String(l.materialCode || '').trim().toUpperCase() === scannedCode.trim().toUpperCase())
      .reduce((n, l) => n + (Number(l.qty) || 0), 0);
    const clBs = await this.findClCountNeed(scannedCode, scannedPo, scannedImd, scannedQty, bsStockErr.left, bsPendingCode).catch(() => null);
    if (clBs) {
      this.openClCount(clBs, () => this.continueBsLineAfterClCount(item, line));
      return;
    }
    await this.continueBsLineAfterClCount(item, line);
  }

  /** Xuất BS: Check lượng bag lẻ (nếu có) rồi nhận tem vào danh sách. */
  private async continueBsLineAfterClCount(item: BsPendingItem, line: BsScanLine): Promise<void> {
    const scannedCode = line.materialCode;
    const scannedPo = line.po;
    const scannedQty = line.qty;
    // Bag lẻ (< Standard) của mã phải cân → chụp hình + nhập trọng lượng như Xuất NL
    let odd: OddWeighCtx | null = null;
    try {
      odd = await this.findBsOddWeighNeed(item, scannedCode, scannedPo, scannedQty);
    } catch (e) {
      console.warn('findBsOddWeighNeed:', e);
      this.bsScanError = `❌ Không kiểm tra được Check lượng cho ${scannedCode}. Scan lại.`;
      return;
    }
    if (odd) {
      this.openOddWeigh(odd, { __bs: true, line });
      return;
    }
    const bsP4 = (String(line.rawQr || '').split('|')[3] || '').trim();
    const tlBs = this.tlTagOf(bsP4);
    if (tlBs) {
      this.openTlPhoto(scannedCode, scannedPo, tlBs, async () => {
        this.bsScanLines.push(line);
        this.bsScanError = '';
        setTimeout(() => (document.getElementById('bs-scan-input') as HTMLInputElement | null)?.focus(), 60);
      });
      return;
    }
    this.bsScanLines.push(line);
  }

  /** Bag lẻ của Xuất BS cần cân? (mã thuộc Check lượng, lượng < Standard, chưa có số cân của LSX + mã + PO). */
  private async findBsOddWeighNeed(item: BsPendingItem, code: string, po: string, bagQty: number): Promise<OddWeighCtx | null> {
    const c = String(code || '').trim().toUpperCase();
    const std = this.stdFor(c, po);
    if (!(std > 0) || !(bagQty > 0) || !(bagQty < std - 1e-9)) return null;
    await this.ensureWeighCodesLoaded();
    if (!needsWeigh(c, this.weighExemptCodes, this.weighIncludeCodes)) return null;
    const lsx = `BS ${String(item.lsx || BS_COMMON_LSX).trim()}`;
    const [saved, catalogWeight] = await Promise.all([
      this.pxkOddWeigh.getSaved(lsx, c, po),
      this.pxkOddWeigh.catalogUnitWeight(c)
    ]);
    if (Number(saved?.weightOdd) > 0) return null;
    // exportQty = lượng bag → phần lẻ = cả bag (so với dự kiến theo GW bag nguyên ÷ Standard)
    return { lsx, code: c, po: String(po || '').trim(), maKho: '', exportQty: bagQty, std, oddQty: bagQty, bagQty, catalogWeight };
  }

  /** Bag đã cân xong / đã báo → đưa vào đúng phiên (Xuất BS hoặc Xuất NL). */
  private finishOddWeighItem(item: any, flashSuffix: string): void {
    if (item?.__bs) {
      this.bsScanLines.push(item.line as BsScanLine);
      this.bsScanError = '';
      setTimeout(() => (document.getElementById('bs-scan-input') as HTMLInputElement | null)?.focus(), 60);
      return;
    }
    this.commitScanItem(item, flashSuffix);
  }

  removeBsScanLine(idx: number): void {
    this.bsScanLines.splice(idx, 1);
  }

  async doneBsScan(): Promise<void> {
    const item = this.bsScanItem;
    if (!item || this.bsSaving || this.bsScanLines.length === 0) return;
    this.bsSaving = true;
    try {
      const exportDate = new Date();
      const db = this.firestore.firestore;
      const code = String(item.materialCode || '').trim().toUpperCase();
      const po = String(this.bsScanLines[0]?.po || item.po || '').trim();

      // 1. Đọc song song: dòng tồn của mã + PO (1 truy vấn cho mọi tem) và phiếu BS
      const [invSnap, bsSnap] = await Promise.all([
        db.collection('inventory-materials')
          .where('materialCode', '==', code)
          .where('poNumber', '==', po)
          .where('factory', '==', this.selectedFactory)
          .get(),
        db.collection('pxk-bs-data').doc(item.docId).get()
      ]);
      const invDocs = invSnap.docs;

      // Chọn dòng tồn cho từng tem: khớp IMD; không khớp → dòng còn tồn đầu tiên (như trước)
      const pickInvDoc = (imd: string) => this.pickInvDocForExport(invDocs, imd);

      // 2. Gộp mọi thao tác ghi vào 1 batch (outbound + trừ tồn + đánh dấu done)
      const batch = db.batch();
      const incByDoc = new Map<string, { exported: number; le: number }>();
      for (const line of this.bsScanLines) {
        const le = this.leExportQty(line.materialCode, line.qty, line.po);
        batch.set(db.collection('outbound-materials').doc(), {
          factory: this.selectedFactory,
          materialCode: line.materialCode,
          poNumber: line.po,
          exportQuantity: line.qty,
          ...(le > 0 ? { leQty: le } : {}),
          unit: item.unit,
          productionOrder: String(item.lsx || '').trim(),
          importDate: line.imd,
          exportDate,
          createdAt: exportDate,
          bsExport: true,
          employeeId: 'BS'
        });
        const inv = pickInvDoc(line.imd);
        if (inv) {
          const cur = incByDoc.get(inv.id) || { exported: 0, le: 0 };
          cur.exported += line.qty;
          cur.le += le > 0 ? le : 0;
          incByDoc.set(inv.id, cur);
        }
      }
      incByDoc.forEach((inc, id) => {
        batch.update(db.collection('inventory-materials').doc(id), {
          exported: firebase.default.firestore.FieldValue.increment(Math.round(inc.exported * 10000) / 10000),
          ...(inc.le > 0 ? { xtLe: firebase.default.firestore.FieldValue.increment(Math.round(inc.le * 10000) / 10000) } : {}),
          updatedAt: exportDate
        });
      });
      // Scan chưa đủ → lưu phần đã scan (exportedQty cộng dồn), chờ scan phần còn lại; đủ mới đánh dấu done
      const needQty = Number(item.quantity) || 0;
      // Lấy đã xuất mới nhất trên hệ thống (không dùng số cũ trên màn hình)
      const freshLine = bsSnap.exists ? (((bsSnap.data() as any)?.lines) || [])[item.lineIndex] : null;
      const prevFresh = freshLine ? Number(freshLine.exportedQty) || 0 : Number(item.prevExported) || 0;
      const newExported = Math.round((prevFresh + this.bsScanTotal) * 10000) / 10000;
      const fullDone = !(needQty > 0) || newExported >= needQty - 1e-6;
      if (bsSnap.exists) {
        const lines: any[] = [...(((bsSnap.data() as any)?.lines) || [])];
        if (lines[item.lineIndex]) {
          lines[item.lineIndex] = { ...lines[item.lineIndex], exportedQty: newExported, ...(fullDone ? { done: true } : {}) };
          batch.update(bsSnap.ref, { lines });
        }
      }
      await batch.commit();
      if (!invDocs.length) console.warn(`[BS] Không có dòng tồn ${code} - PO ${po}: chỉ ghi outbound`);

      // 3. Đủ → ẩn khỏi danh sách; chưa đủ → giữ lại với phần còn lại
      this.bsItems = this.bsItems.map(b =>
        b.docId === item.docId && b.lineIndex === item.lineIndex
          ? (fullDone ? { ...b, done: true, exported: true, prevExported: newExported } : { ...b, prevExported: newExported })
          : b
      );

      const totalScanned = this.bsScanTotal;
      this.closeBsScanDialog();
      const fmt = (n: number) => n.toLocaleString('vi-VN');
      const left = Math.round((needQty - newExported) * 10000) / 10000;
      appAlert(fullDone
        ? `✅ Đã xuất BS: ${item.materialCode} | ${fmt(totalScanned)} ${item.unit} — đủ ${fmt(needQty)}`
        : `💾 Đã lưu phần đã scan: ${item.materialCode} | ${fmt(totalScanned)} ${item.unit}\n` +
          `Đã xuất ${fmt(newExported)} / ${fmt(needQty)} — còn ${fmt(left)}. Phiếu vẫn ở danh sách để scan tiếp.`);
    } catch (e: any) {
      console.error('[BS] doneBsScan error', e);
      this.bsScanError = '❌ Lỗi khi ghi xuất: ' + (e?.message || e);
    } finally {
      this.bsSaving = false;
    }
  }

  mobileNavHistory(): void {
    this.openMobileLsxHistorySheet();
  }

  mobileNavLocation(): void {
    this.mobileBottomTab = 'location';
    void this.router.navigate(['/location']);
  }

  getMobileNotifyCount(): number {
    const n = this.pendingScanData?.length ?? 0;
    return n > 99 ? 99 : n;
  }

  clearMobileScannerBuffer(): void {
    this.scannerBuffer = '';
  }

  openMobileFilterSheet(): void {
    this.closeMobileMoreSheet();
    this.closeMobileLsxHistorySheet();
    this.showMobileFilterSheet = true;
    this.closeDropdown();
  }

  closeMobileFilterSheet(): void {
    this.showMobileFilterSheet = false;
  }

  openMobileMoreSheet(): void {
    this.mobileBottomTab = 'outbound';
    this.closeMobileFilterSheet();
    this.closeMobileLsxHistorySheet();
    this.showMobileMoreSheet = true;
    this.closeDropdown();
  }

  closeMobileMoreSheet(): void {
    this.showMobileMoreSheet = false;
  }

  getMobileMaterialCardSubtitle(m: OutboundMaterial): string {
    const n = (m.notes ?? '').trim();
    if (n) {
      return n;
    }
    const po = (m.poNumber ?? '').trim();
    return po ? `PO ${po}` : '—';
  }

  getMobileMaterialQtyLine(m: OutboundMaterial): string {
    const u = (m.unit ?? '').trim() || 'PCS';
    const q = Number(m.exportQuantity);
    const qStr = Number.isFinite(q) ? String(q) : '0';
    return `${qStr} ${u}`;
  }

  runMobileSheetAction(
    action: 'refresh' | 'excel' | 'add' | 'monthly' | 'cleanup' | 'qc' | 'filter' | 'import-px' | 'import-bs'
  ): void {
    this.closeMobileMoreSheet();
    switch (action) {
      case 'refresh':
        this.loadMaterials();
        break;
      case 'excel':
        void this.exportToExcel();
        break;
      case 'add':
        void this.addMaterial();
        break;
      case 'monthly':
        void this.downloadMonthlyHistory();
        break;
      case 'cleanup':
        void this.cleanupData();
        break;
      case 'qc':
        void this.openQcRuleModal();
        break;
      case 'import-px':
        this.openPxImportPopup();
        break;
      case 'import-bs':
        this.openBsImportPopup();
        break;
      case 'filter':
        this.openMobileFilterSheet();
        break;
    }
  }

  // BAG number (i) từ bagBatch dạng "i/tổng" (có thể nhiều giá trị nối bằng dấu phẩy).
  getBagNumberDisplay(bagBatch?: string): string {
    const s = (bagBatch ?? '').trim();
    if (!s) return '—';
    const segs = s
      .split(',')
      .map(x => x.trim())
      .filter(Boolean);

    const nums: string[] = [];
    for (const seg of segs) {
      const iPart = String(seg).split('/')[0]?.trim();
      const n = iPart ? parseInt(iPart, 10) : NaN;
      if (Number.isFinite(n) && n > 0) nums.push(String(n));
    }

    return nums.length ? nums.join(', ') : '—';
  }

  /** Cột Bag: ưu tiên `bagNumberDisplay` (VD 5(T1)), không có thì suy từ bagBatch. */
  getOutboundBagColumnDisplay(material: { bagNumberDisplay?: string; bagBatch?: string }): string {
    const d = (material.bagNumberDisplay ?? '').trim();
    if (d) {
      return d;
    }
    return this.getBagNumberDisplay(material.bagBatch);
  }
  
  // 🗑️ REMOVED: Debug functions - không cần nữa
  
  // 🔧 UNIFIED INVENTORY UPDATE: Đảm bảo camera và scanner cùng dùng 1 method
  private async unifiedUpdateInventory(
    materialCode: string,
    poNumber: string,
    exportQuantity: number,
    importDate?: string,
    scanMethod: string = 'UNIFIED',
    exportedBagsDelta: number = 0,
    bagBatch?: string
  ): Promise<void> {
    try {
      console.log(`🎯 UNIFIED UPDATE: ${scanMethod} - Material=${materialCode}, PO=${poNumber}, Qty=${exportQuantity}, Batch=${importDate}, BagsDelta=${exportedBagsDelta}`);
      
      // Gọi method cập nhật inventory thống nhất (đã loại bỏ các delay không cần thiết)
      await this.updateInventoryExported(materialCode, poNumber, exportQuantity, importDate, exportedBagsDelta, bagBatch);
      
      console.log(`✅ UNIFIED: Inventory updated successfully for ${scanMethod}`);
      
    } catch (error) {
      console.error(`❌ UNIFIED: Error updating inventory for ${scanMethod}:`, error);
      throw error;
    }
  }
  
  // Professional Scanning Setup Modal Methods
  closeScanningSetupModal(): void {
    this.showScanningSetupModal = false;
    this.scanningSetupStep = 'factory';
    this.isScannerInputActive = false; // Reset scanner input state
    console.log('❌ Professional scanning setup modal closed');
  }

  /** Bước 0 bắt buộc: xác nhận nhà máy đang thao tác trước khi cho quét LSX. */
  confirmFactoryForScan(factory: 'ASM1' | 'ASM2'): void {
    if (this.selectedFactory !== factory) {
      this.selectedFactory = factory;
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { factory },
        queryParamsHandling: 'merge',
        replaceUrl: true
      });
    }
    this.scanningSetupStep = 'lsx';
    setTimeout(() => this.focusScannerInput(), 0);
  }

  // Handle LSX scan in modal (auto-detect from scanner input)
  onLSXScanned(lsx: string): void {
    if (!lsx || !lsx.trim()) return;
    const lsxTrim = lsx.trim();
    if (!this.isValidLsxCode(lsxTrim)) {
      this.showScanError('Sai LSX. LSX phải bắt đầu bằng KZLSX hoặc LHLSX');
      return;
    }
    this.checkWorkOrderKittingStatus(this.effLsx(lsxTrim)).then(ok => {
      if (!ok) return;
      this.acceptBatchLsx(this.effLsx(lsxTrim));
      this.scannerBuffer = '';
      if (this.hasOperatorSession) {
        this.applyOperatorToBatch();
        this.showScanningSetupModal = false;
        this.isBatchScanningMode = true;
        this.currentScanStep = 'material';
        setTimeout(() => this.focusScannerInput(), 50);
        return;
      }
      this.scanningSetupStep = 'employee';
      console.log(`✅ LSX scanned: ${lsx} - Moving to employee scan`);
      setTimeout(() => {
        this.focusScannerInput();
        console.log('📍 Auto-focused scanner input for Employee ID step');
      }, 50);
    });
  }
  
  // Handle Employee ID scan in modal (auto-detect from scanner input)
  onEmployeeScanned(employeeId: string): void {
    if (!employeeId || !employeeId.trim()) return;
    
    // 🔧 LẤY 7 KÝ TỰ ĐẦU TIÊN: QR code có thể dài bao nhiêu cũng được, chỉ lấy 7 ký tự đầu
    const trimmedId = employeeId.trim();
    const extractedId = trimmedId.substring(0, 7); // Lấy 7 ký tự đầu tiên
    
    console.log(`🔍 Original QR code: "${trimmedId}" (length: ${trimmedId.length})`);
    console.log(`🔍 Extracted 7 chars: "${extractedId}"`);
    
    // 🔧 VALIDATION: Validate format ASP + 4 số sau khi lấy 7 ký tự đầu
    if (extractedId.length === 7 && extractedId.startsWith('ASP')) {
      const aspPart = extractedId.substring(0, 3);
      const numberPart = extractedId.substring(3, 7);
      
      if (aspPart === 'ASP' && /^\d{4}$/.test(numberPart)) {
        this.batchEmployeeId = extractedId;
        this.isEmployeeIdScanned = true;
        console.log(`✅ Employee ID scanned: ${extractedId} - Setup complete`);
        
        // Close setup modal and start material scanning
        this.showScanningSetupModal = false;
        this.isBatchScanningMode = true;
        this.currentScanStep = 'material';
        
        // Clear scanner buffer for next scan
        this.scannerBuffer = '';
        
        // 🔧 ENHANCED AUTO-FOCUS: Tự động focus cho material scanning
        setTimeout(() => {
          this.focusScannerInput();
          console.log('📍 Auto-focused scanner input for material scanning');
        }, 50);
        
        console.log('🎯 Professional scanning setup complete - Ready for material scanning');
      } else {
        // ❌ Invalid format - show error and stay on employee step
        this.showScanError(`Sai định dạng mã nhân viên: ${extractedId}. Phải có format ASP + 4 số (ví dụ: ASP2101)`);
        console.log('❌ Invalid employee ID format, staying on employee step');
      }
    } else {
      // ❌ Invalid format - show error and stay on employee step
      this.showScanError(`Mã nhân viên phải có 7 ký tự (ASP + 4 số). Nhận được: ${extractedId}`);
      console.log('❌ Invalid employee ID length/format, staying on employee step');
    }
  }
  
  // Auto-detect scan input when in setup modal - REMOVED: xử lý trực tiếp trong processScannerInput()
  
  // Skip to next step in modal (for manual input)
  skipToNextStep(): void {
    if (this.scanningSetupStep === 'lsx') {
      this.scanningSetupStep = 'employee';
      console.log('⏭️ Skipped LSX scan - Moving to employee scan');
    } else if (this.scanningSetupStep === 'employee') {
      // Close modal and start material scanning
      this.showScanningSetupModal = false;
      this.isBatchScanningMode = true;
      this.currentScanStep = 'material';
      console.log('⏭️ Skipped employee scan - Setup complete');
    }
  }
  
  onDocumentClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.dropdown')) {
      this.closeDropdown();
    }
  }
  
  // 🔧 GLOBAL KEYBOARD LISTENER: Lắng nghe tất cả keyboard input khi setup modal mở
  /** Popup cân bag lẻ / báo không cân đang mở → không kéo phím / focus về ô quét barcode. */
  /** Popup có ô nhập (cân bag lẻ, report, in tem lẻ) đang mở → không kéo focus / phím gõ về ô quét. */
  private get scannerFocusPaused(): boolean {
    return !!this.oddWeigh || !!this.weighReport || !!this.temLeOb || !!this.clCount || !!this.tlPhoto;
  }

  onGlobalKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (this.scannerFocusPaused) return;

    if (!this.hasOperatorSession) {
      if (target?.id === 'ob-op-session-input') return;
      if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        this.operatorSessionInput = (this.operatorSessionInput || '') + event.key.toUpperCase();
        event.preventDefault();
      } else if (event.key === 'Enter') {
        this.onOperatorSessionScanned(this.operatorSessionInput);
        event.preventDefault();
      }
      return;
    }

    // Xử lý khi setup modal đang mở (LSX/NV) HOẶC đang trong phiên scan batch (mã hàng) —
    // fallback khi ô scanner lỡ mất focus (PDA bắn ký tự quá nhanh).
    if (!this.showScanningSetupModal && !this.isBatchScanningMode) return;

    // Đã đang gõ vào ô scanner thật — để onScannerKeydown xử lý, tránh double-handle
    if (target?.id === 'ob-setup-scanner-input' || target?.id === 'ob-m-scanner-input') return;
    if (target?.classList?.contains('scanner-input')) return;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

    console.log('🔍 Global keyboard input detected:', event.key);

    const scannerInput = this.resolveScannerInputEl();
    if (scannerInput) {
      scannerInput.focus({ preventScroll: true });
      if (event.key.length === 1) {
        // Không select() trước mỗi ký tự — PDA wedge sẽ mất chữ giữa chừng
        this.scannerBuffer = (this.scannerBuffer || '') + event.key;
        scannerInput.value = this.scannerBuffer;
        event.preventDefault();
      } else if (event.key === 'Enter') {
        const value = scannerInput.value || this.scannerBuffer || '';
        this.scannerBuffer = '';
        scannerInput.value = '';
        this.processScannerInput(value);
        event.preventDefault();
      }
    }
  }
  

  
  // Chỉ hiển thị 50 dòng gần nhất để tối ưu hiệu suất
  private readonly DISPLAY_LIMIT = 50;
  
  loadMaterials(): void {
    if (this.materialSearchMode === 'material' && this.searchProductionOrder?.trim()) {
      void this.searchByMaterialInput(this.searchProductionOrder.trim());
      return;
    }

    const hasLSX = !!(this.selectedProductionOrder && this.selectedProductionOrder.trim());
    const todayIso = new Date().toISOString().split('T')[0];
    const isTodayRange = this.startDate === todayIso && this.endDate === todayIso;

    // Nếu không chọn LSX nhưng đang ở chế độ “Hôm nay” → load tất cả mã hôm nay
    if (!hasLSX && isTodayRange) {
      this.isLoading = true;
      this.errorMessage = '';
      console.log(`📦 Loading all ${this.selectedFactory} outbound materials for TODAY (no LSX filter)...`);

      const start = this.startDate || todayIso;
      const end = this.endDate || todayIso;
      const startOfDay = new Date(`${start}T00:00:00`);
      const endOfDay = new Date(`${end}T23:59:59.999`);

      // 🔧 FIX: .get() (đọc 1 lần) thay vì .snapshotChanges() (listener sống) — tránh chồng
      // listener mỗi lần loadMaterials() được gọi lại (sau mỗi lần scan/đổi filter/refresh).
      // Lọc theo exportDate ngay trên Firestore thay vì tải hết rồi lọc ở client.
      this.firestore
        .collection('outbound-materials', (ref) =>
          ref.where('factory', '==', this.selectedFactory)
             .where('exportDate', '>=', startOfDay)
             .where('exportDate', '<=', endOfDay)
             .limit(3000)
        )
        .get()
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: (snapshot) => {
            this.readTracker.track('outbound', 'outbound-materials', snapshot.docs.length);
            const materialsAll = snapshot.docs.map((d: any) =>
              this.mapOutboundDocToMaterial({ payload: { doc: { id: d.id, data: () => d.data() } } })
            );

            this.materials = materialsAll.sort((a, b) => {
              const updatedCompare = b.updatedAt.getTime() - a.updatedAt.getTime();
              if (updatedCompare !== 0) return updatedCompare;
              const dateCompare = b.exportDate.getTime() - a.exportDate.getTime();
              if (dateCompare !== 0) return dateCompare;
              return b.createdAt.getTime() - a.createdAt.getTime();
            });

            this.filteredMaterials = [...this.materials];
            this.updatePagination();
            this.isLoading = false;
            this.cdr.detectChanges();
          },
          error: (error) => {
            console.error(`❌ Error loading ${this.selectedFactory} outbound materials (today view):`, error);
            this.errorMessage = 'Lỗi khi tải dữ liệu: ' + error.message;
            this.isLoading = false;
          }
        });
      return;
    }

    // Không chọn LSX và không phải “Hôm nay” → ẩn dữ liệu
    if (!hasLSX) {
      console.log('⏸️ No LSX selected - hiding data');
      this.materials = [];
      this.filteredMaterials = [];
      this.isLoading = false;
      return;
    }
    
    this.isLoading = true;
    this.errorMessage = '';
    console.log(`📦 Loading materials for LSX: ${this.selectedProductionOrder}...`);
    
    // 🔧 MOBILE OPTIMIZATION: Chỉ load records của LSX được chọn
    // Bỏ orderBy để tránh cần composite index, sẽ sort ở client-side
    // 🔧 FIX: .get() thay vì .snapshotChanges() — tránh chồng listener khi loadMaterials()
    // được gọi lại (sau mỗi lần scan/đổi filter/refresh không hủy subscription cũ).
    this.firestore.collection('outbound-materials', ref =>
      ref.where('factory', '==', this.selectedFactory)
         .where('productionOrder', '==', this.selectedProductionOrder)
         .limit(100)
    ).get()
    .pipe(takeUntil(this.destroy$))
    .subscribe({
      next: (snapshot) => {
        this.readTracker.track('outbound', 'outbound-materials', snapshot.docs.length);
        // 🔧 TỐI ƯU HÓA: Xử lý batch thay vì từng record để tăng tốc độ
        const materials = snapshot.docs.map((d: any) =>
          this.mapOutboundDocToMaterial({ payload: { doc: { id: d.id, data: () => d.data() } } })
        );
        
        console.log(`📦 Loaded ${materials.length} total materials from outbound-materials collection`);
        
        // 🔧 TỐI ƯU HÓA: Xử lý tất cả trong một lần để tăng tốc độ
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // 🔧 NGUYÊN TẮC MỚI: Không hiển thị LSX nào khi mở màn hình, chỉ show khi lọc
        if (materials.length > 0) {
          // Lấy danh sách tất cả LSX có sẵn để tạo dropdown
          this.availableProductionOrders = [...new Set(
            materials
              .filter(m => m.productionOrder && m.productionOrder.trim() !== '')
              .map(m => m.productionOrder)
          )].sort((a, b) => {
            // Sort LSX theo thời gian tạo (mới nhất trước)
            const aTime = materials.find(m => m.productionOrder === a)?.createdAt?.getTime() || 0;
            const bTime = materials.find(m => m.productionOrder === b)?.createdAt?.getTime() || 0;
            return bTime - aTime;
          });
          
          console.log(`📋 Available Production Orders: ${this.availableProductionOrders.length}`, this.availableProductionOrders);
        }
        
        // 🔧 DEBUG: Log trước khi filter
        if (this.selectedProductionOrder) {
          const matchingMaterials = materials.filter(m => {
            const materialLSX = (m.productionOrder || '').toUpperCase();
            const selectedLSX = (this.selectedProductionOrder || '').toUpperCase();
            return materialLSX.includes(selectedLSX) || materialLSX === selectedLSX;
          });
          console.log(`🔍 Search for LSX "${this.selectedProductionOrder}": Found ${matchingMaterials.length} matching materials`);
          if (matchingMaterials.length > 0) {
            console.log(`📋 Sample matching materials:`, matchingMaterials.slice(0, 3).map(m => ({
              lsx: m.productionOrder,
              material: m.materialCode,
              date: m.exportDate
            })));
          }
        }
        
        // 🔧 OPTIMIZATION: Đã query đúng LSX rồi, không cần filter nữa
        this.materials = materials
          .sort((a, b) => {
            // Sort by latest updated time first (newest first)
            const updatedCompare = b.updatedAt.getTime() - a.updatedAt.getTime();
            if (updatedCompare !== 0) return updatedCompare;
            
            // If same updated time, sort by export date (newest first)
            const dateCompare = b.exportDate.getTime() - a.exportDate.getTime();
            if (dateCompare !== 0) return dateCompare;
            
            // If same date, sort by creation time (newest first)
            return b.createdAt.getTime() - a.createdAt.getTime();
          })
          .filter(material => {
            // Filter by date range if specified
            if (this.startDate && this.endDate) {
              const exportDate = material.exportDate.toISOString().split('T')[0];
              return exportDate >= this.startDate && exportDate <= this.endDate;
            }
            
            // Auto-hide previous day's scan history
            if (this.hidePreviousDayHistory) {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const exportDate = new Date(material.exportDate);
              exportDate.setHours(0, 0, 0, 0);
              if (exportDate < today) return false;
            }
            
            return true;
          })
          .slice(0, this.DISPLAY_LIMIT); // vẫn giới hạn khi xem theo LSX
        
        this.filteredMaterials = [...this.materials];
        this.updatePagination();
        this.isLoading = false;
        
        // 🔧 TỐI ƯU HÓA: Chỉ log một lần thay vì nhiều lần
        console.log(`✅ Loaded ${materials.length} total, displaying ${this.materials.length} ${this.selectedFactory} materials`);
        
        // Debug: Check if new data was added
        const recentMaterials = materials.filter(m => {
          const now = new Date();
          const materialTime = m.createdAt;
          const timeDiff = now.getTime() - materialTime.getTime();
          return timeDiff < 60000; // Within last minute
        });
        if (recentMaterials.length > 0) {
          console.log(`🆕 Found ${recentMaterials.length} recently added materials:`, recentMaterials.map(m => ({
            materialCode: m.materialCode,
            createdAt: m.createdAt,
            scanMethod: m.scanMethod
          })));
        }
        
        // Force change detection to update UI
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error(`❌ Error loading ${this.selectedFactory} outbound materials:`, error);
        this.errorMessage = 'Lỗi khi tải dữ liệu: ' + error.message;
        this.isLoading = false;
      }
    });
  }
  


  updatePagination(): void {
    this.totalPages = Math.ceil(this.getHistoryViewMaterials().length / this.itemsPerPage);
    if (this.currentPage > this.totalPages) { this.currentPage = 1; }
  }
  
  getPaginatedMaterials(): OutboundMaterial[] {
    const list = this.getHistoryViewMaterials();
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    return list.slice(startIndex, endIndex);
  }

  /** Lịch sử đang xem sau khi lọc PO / LSX (client). */
  getHistoryViewMaterials(): OutboundMaterial[] {
    const po = this.historyFilterPo.trim().toUpperCase();
    const lsx = this.historyFilterLsx.trim().toUpperCase();
    if (!po && !lsx) {
      return this.filteredMaterials;
    }
    return this.filteredMaterials.filter(m => {
      if (po && !String(m.poNumber || '').toUpperCase().includes(po)) {
        return false;
      }
      if (lsx && !String(m.productionOrder || '').toUpperCase().includes(lsx)) {
        return false;
      }
      return true;
    });
  }

  onHistoryFilterChange(): void {
    this.currentPage = 1;
    this.updatePagination();
    this.cdr.markForCheck();
  }

  /** Template gọi mỗi vòng change detection — chỉ tính lại khi filteredMaterials đổi (luôn gán mảng mới). */
  private historyOptionsSource: any[] | null = null;
  private historyOptionsLength = -1;
  private historyPoOptionsCache: string[] = [];
  private historyLsxOptionsCache: string[] = [];

  private refreshHistoryOptions(): void {
    const src = this.filteredMaterials;
    if (src === this.historyOptionsSource && src.length === this.historyOptionsLength) return;
    const po = new Set<string>();
    const lsx = new Set<string>();
    for (const m of src) {
      const p = String(m.poNumber || '').trim();
      if (p) po.add(p);
      const l = String(m.productionOrder || '').trim();
      if (l) lsx.add(l);
    }
    this.historyPoOptionsCache = Array.from(po).sort();
    this.historyLsxOptionsCache = Array.from(lsx).sort();
    this.historyOptionsSource = src;
    this.historyOptionsLength = src.length;
  }

  getHistoryPoOptions(): string[] {
    this.refreshHistoryOptions();
    return this.historyPoOptionsCache;
  }

  getHistoryLsxOptions(): string[] {
    this.refreshHistoryOptions();
    return this.historyLsxOptionsCache;
  }

  /**
   * Mobile + đang phiên batch scan hàng: danh sách vật tư chỉ hiện đúng 1 dòng = tem vừa quét (mới nhất trong pending).
   * Các trường hợp khác giữ phân trang như cũ.
   */
  getMobileListMaterials(): OutboundMaterial[] {
    if (this.isMobile && this.isBatchScanningMode) {
      if (!this.pendingScanData.length) {
        return [];
      }
      const last = this.pendingScanData[this.pendingScanData.length - 1];
      return [this.mapPendingScanToOutboundPreview(last)];
    }
    return this.getPaginatedMaterials();
  }

  /** Dòng đếm dưới tiêu đề danh sách (mobile batch vs mặc định) */
  getMobileListCountLabel(): string {
    if (this.isMobile && this.isBatchScanningMode) {
      const n = this.pendingScanData.length;
      if (n <= 0) {
        return '0 tem trong phiên';
      }
      return `${n} tem · hiển thị mã mới nhất`;
    }
    return `${this.getHistoryViewMaterials().length} dòng`;
  }

  /** Số dòng / tem trên danh sách xuất (mobile). */
  getMobileExportListCount(): number {
    if (this.isMobile && this.isBatchScanningMode) {
      return this.pendingScanData.length;
    }
    return this.getHistoryViewMaterials().length;
  }

  /** Tổng QTY xuất trên danh sách mobile. */
  getMobileExportTotalQty(): number {
    if (this.isMobile && this.isBatchScanningMode) {
      return this.pendingScanData.reduce((s, it) => s + (Number(it?.quantity) || 0), 0);
    }
    return this.getHistoryViewMaterials().reduce((s, m) => s + (Number(m.exportQuantity ?? m.quantity) || 0), 0);
  }

  /** Nút QUÉT MÃ lớn (mobile mock) — START phiên batch rồi focus scanner. */
  onMobileQuetMaClick(): void {
    this.mobileBottomTab = 'outbound';
    if (this.exportMode !== 'NL') {
      this.switchExportMode('NL');
    }
    if (!this.isBatchScanningMode) {
      this.startBatchScanningMode();
    } else {
      this.focusMobileScanner();
    }
  }

  /** Có hiện phân trang dưới danh sách (mobile batch chỉ 1 dòng preview → ẩn) */
  showMobileMaterialPagination(): boolean {
    if (this.isMobile && this.isBatchScanningMode) {
      return false;
    }
    return this.totalPages > 1;
  }

  private mapPendingScanToOutboundPreview(item: any): OutboundMaterial {
    const st =
      item?.scanTime instanceof Date
        ? item.scanTime
        : item?.scanTime
          ? new Date(item.scanTime)
          : new Date();
    return {
      materialCode: String(item?.materialCode ?? '').trim(),
      poNumber: String(item?.poNumber ?? '').trim(),
      quantity: Number(item?.quantity) || 1,
      unit: 'PCS',
      exportQuantity: Number(item?.quantity) || 1,
      exportDate: st,
      location: String(item?.location ?? 'N/A'),
      exportedBy: '',
      importDate: item?.importDate != null ? String(item.importDate) : undefined,
      bagBatch: item?.bagBatch,
      bagNumberDisplay: item?.bagNumberDisplay,
      productionOrder: String(item?.productionOrder ?? '').trim(),
      employeeId: String(item?.employeeId ?? '').trim(),
      createdAt: st,
      updatedAt: st,
      scanCount: item?.scanCount ?? 1,
      scanMethod: item?.scanMethod || 'SCANNER',
      pendingPreview: true
    };
  }

  getMobileHistoryLsxLabel(): string {
    const s = (this.batchProductionOrder || this.selectedProductionOrder || '').trim();
    return s || '—';
  }

  getMobileLsxHistoryRows(): any[] {
    return [...this.pendingScanData].reverse();
  }

  openMobileLsxHistorySheet(): void {
    this.mobileBottomTab = 'history';
    this.closeMobileMoreSheet();
    this.closeMobileFilterSheet();
    this.showMobileLsxHistorySheet = true;
  }

  closeMobileLsxHistorySheet(): void {
    this.showMobileLsxHistorySheet = false;
    this.mobileBottomTab = 'outbound';
  }
  

  
  onExportDateChange(event: any, material: OutboundMaterial): void {
    const target = event.target as HTMLInputElement;
    if (target.value) {
      // Xử lý datetime-local input
      const [datePart, timePart] = target.value.split('T');
      if (datePart && timePart) {
        const [year, month, day] = datePart.split('-').map(Number);
        const [hour, minute] = timePart.split(':').map(Number);
        material.exportDate = new Date(year, month - 1, day, hour, minute);
      } else {
        material.exportDate = new Date(target.value);
      }
    } else {
      material.exportDate = new Date();
    }
    this.updateMaterial(material);
  }
  

  
  goToPage(page: number): void { if (page >= 1 && page <= this.totalPages) { this.currentPage = page; } }
  previousPage(): void { if (this.currentPage > 1) { this.currentPage--; } }
  nextPage(): void { if (this.currentPage < this.totalPages) { this.currentPage++; } }
  
  async addMaterial(): Promise<void> {
    const newMaterial: OutboundMaterial = {
      factory: this.selectedFactory,
      materialCode: '',
      poNumber: '',
      quantity: 0,
      unit: '',
      exportQuantity: 0,
      exportDate: new Date(),
      location: '',
      exportedBy: '',
      employeeId: '',
      productionOrder: '',
      
      scanMethod: 'MANUAL',
      notes: '',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    try {
      await this.firestore.collection('outbound-materials').add(newMaterial);
      console.log(`✅ ${this.selectedFactory} outbound material added`);
      this.loadMaterials();
    } catch (error) {
      console.error(`❌ Error adding ${this.selectedFactory} outbound material:`, error);
      this.errorMessage = 'Lỗi thêm material: ' + error.message;
    }
  }
  
  async updateMaterial(material: OutboundMaterial): Promise<void> {
    if (!material.id) return;
    try {
      material.updatedAt = new Date();
      material.factory = this.selectedFactory;
      await this.firestore.collection('outbound-materials').doc(material.id).update(material);
      console.log(`✅ ${this.selectedFactory} outbound material updated:`, material.materialCode);
    } catch (error) {
      console.error(`❌ Error updating ${this.selectedFactory} outbound material:`, error);
      this.errorMessage = 'Lỗi cập nhật: ' + error.message;
    }
  }
  
  /** Xóa dòng xuất (Admin / Quản lý): trả lại lượng đã xuất vào đúng dòng tồn (mã + PO + IMD) rồi xóa bản ghi xuất. */
  async deleteMaterial(material: OutboundMaterial): Promise<void> {
    if (!material.id) return;
    if (!this.canDeleteOutbound) {
      appAlert('❌ Xóa dòng xuất chỉ dành cho Admin / Quản lý (xóa sẽ trả lại tồn kho).');
      return;
    }
    const db = this.firestore.firestore;
    const ref = db.collection('outbound-materials').doc(material.id);
    try {
      const snap = await ref.get();
      if (!snap.exists) { this.loadMaterials(); return; }
      const d = snap.data() as any;
      const code = String(d.materialCode || '').trim();
      const po = String(d.poNumber || '').trim();
      const qty = Math.round((Number(d.exportQuantity ?? d.quantity) || 0) * 10000) / 10000;
      const le = Math.round((Number(d.leQty) || 0) * 10000) / 10000;
      const factory = String(d.factory || this.selectedFactory);
      const invSnap = code && po
        ? await db.collection('inventory-materials').where('materialCode', '==', code).where('poNumber', '==', po).where('factory', '==', factory).get()
        : null;
      const docs = invSnap?.docs || [];
      const want = this.scanImdKey(d.importDate ?? d.batchNumber ?? '');
      const target = (want ? docs.find((x) => {
        const v = x.data() as any;
        return this.normalizeImportDate(v.importDate) === want || String(v.batchNumber ?? '').trim().startsWith(want);
      }) : undefined) || docs.find((x) => (Number((x.data() as any).exported) || 0) >= qty) || docs[0];
      const extra = d.bsExport ? '\n⚠️ Dòng Xuất BS: lượng đã xuất của phiếu BS không tự trừ lại.' : '';
      const msg = `Xóa dòng xuất ${code} · PO ${po || '—'} · ${qty} (LSX ${d.productionOrder || '—'})?\n\n` +
        (target ? `Sẽ trả lại ${qty} vào tồn kho (dòng IMD ${this.normalizeImportDate((target.data() as any).importDate) || '—'}).` : '⚠️ Không tìm thấy dòng tồn để trả lại — chỉ xóa bản ghi xuất.') + extra;
      if (!confirm(msg)) return;
      const batch = db.batch();
      if (target && qty > 0) {
        batch.update(target.ref, {
          exported: firebase.default.firestore.FieldValue.increment(-qty),
          ...(le > 0 ? { xtLe: firebase.default.firestore.FieldValue.increment(-le) } : {}),
          updatedAt: new Date()
        });
      }
      batch.delete(ref);
      await batch.commit();
      void db.collection('outbound-delete-log').add({
        factory, outboundId: material.id, materialCode: code, poNumber: po, qty, leQty: le,
        productionOrder: d.productionOrder || '', inventoryDocId: target?.id || '', restored: !!target,
        by: String(this.batchEmployeeId || this.operatorSessionId || '').trim().toUpperCase(), at: new Date()
      }).catch(() => undefined);
      console.log(`✅ ${factory} outbound deleted + inventory restored:`, code, qty);
      this.loadMaterials();
    } catch (error: any) {
      console.error(`❌ Error deleting ${this.selectedFactory} outbound material:`, error);
      this.errorMessage = 'Lỗi xóa: ' + (error?.message || error);
    }
  }

  /** Xóa dòng xuất: chỉ Admin / Quản lý. */
  canDeleteOutbound = false;
  private rolePermOb = inject(RolePermissionService);
  private rolePermSub = this.rolePermOb.isAdminOrManager().subscribe((ok) => (this.canDeleteOutbound = !!ok));
  
  // Export tất cả dữ liệu (không giới hạn 50 dòng)
  async exportToExcel(): Promise<void> {
    const XLSX = await import('xlsx');
    try {
      console.log(`📊 Exporting TẤT CẢ ${this.selectedFactory} outbound data to Excel...`);
      
      // Load tất cả dữ liệu từ Firebase
      const snapshot = await this.firestore.collection('outbound-materials', ref => 
        ref.where('factory', '==', this.selectedFactory)
      ).ref.get();
      
      const allMaterials = snapshot.docs.map(doc => {
        const data = doc.data() as any;
        const rawImd = data.importDate != null && data.importDate !== '' ? String(data.importDate) : '';
        const pImd = rawImd ? this.rmBagHistory.parseQrPart4(rawImd) : null;
        const importDateNorm = pImd?.imdKey || rawImd || null;
        const bagBatchNorm =
          (data.bagBatch && String(data.bagBatch).trim()) ||
          pImd?.bagFractionLabel ||
          '';
        const bagNumNorm =
          (data.bagNumberDisplay && String(data.bagNumberDisplay).trim()) ||
          pImd?.bagNumberDisplay ||
          '';
        return {
          id: doc.id,
          factory: data.factory || this.selectedFactory,
          materialCode: data.materialCode || '',
          poNumber: data.poNumber || '',
          quantity: data.quantity || 0,
          unit: data.unit || '',
          exportQuantity: data.exportQuantity || 0,
          exportDate: data.exportDate?.toDate() || new Date(),
          location: data.location || '',
          exportedBy: data.exportedBy || '',
          employeeId: data.employeeId || '',
          productionOrder: data.productionOrder || '',
          batchNumber: data.batchNumber || importDateNorm || null,
          importDate: importDateNorm,
          bagBatch: bagBatchNorm,
          bagNumberDisplay: bagNumNorm,
          scanMethod: data.scanMethod || 'MANUAL',
          notes: data.notes || '',
          createdAt: data.createdAt?.toDate() || data.createdDate?.toDate() || new Date(),
          updatedAt: data.updatedAt?.toDate() || data.lastUpdated?.toDate() || new Date()
        } as OutboundMaterial;
      });
      
      // Sort by createdAt desc để có dữ liệu mới nhất trước
      const sortedMaterials = allMaterials.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      
      console.log(`📊 Exporting ${sortedMaterials.length} records (tất cả dữ liệu)`);
      
             // Optimize data for smaller file size
      const exportData = sortedMaterials.map(material => ({
          'Factory': material.factory || this.selectedFactory,
          'Material': material.materialCode || '',
          'PO': material.poNumber || '',
          'Bịch': material.bagBatch || '',
          'Qty': material.quantity || 0,
          'Unit': material.unit || '',
          'Export Qty': material.exportQuantity || 0,
          'Ngày xuất': material.exportDate ? material.exportDate.toLocaleString('vi-VN') : '',
          'Employee ID': material.employeeId || '',
          'Production Order': material.productionOrder || '',
          'Method': material.scanMethod || 'MANUAL'
        }));
      
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      
                     // Set column widths for better readability
        const colWidths = [
          { wch: 8 },   // Factory
          { wch: 15 },  // Material
          { wch: 12 },  // PO
          { wch: 10 },  // Bịch
          { wch: 8 },   // Qty
          { wch: 6 },   // Unit
          { wch: 10 },  // Export Qty
          { wch: 18 },  // Ngày xuất
          { wch: 12 },  // Employee ID
          { wch: 18 },  // Production Order
          { wch: 8 }    // Method
        ];
      worksheet['!cols'] = colWidths;
      
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, `${this.selectedFactory}_Outbound`);

      const fileName = `${this.selectedFactory}_Outbound_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, fileName);

      console.log(`✅ ${this.selectedFactory} outbound data exported to Excel`);
      appAlert(`✅ Đã xuất ${exportData.length} records ra file Excel`);
    } catch (error) {
      console.error('❌ Export error:', error);
      this.errorMessage = 'Lỗi export: ' + error.message;
      appAlert('❌ Lỗi export: ' + error.message);
    }
  }

  // 🗑️ REMOVED: downloadReport() - đã gộp vào downloadMonthlyHistory()

  // Download monthly history - Tải lịch sử outbound theo tháng
  async downloadMonthlyHistory(): Promise<void> {
    const XLSX = await import('xlsx');
    try {
      // Hiện popup chọn tháng
      const monthYear = prompt(
        'Chọn tháng để tải lịch sử outbound:\n' +
        'Nhập theo định dạng YYYY-MM (ví dụ: 2024-12)',
        new Date().toISOString().slice(0, 7) // Mặc định tháng hiện tại
      );
      
      if (!monthYear) return;
      
      // Validate format YYYY-MM
      if (!/^\d{4}-\d{2}$/.test(monthYear)) {
        appAlert('❌ Định dạng không đúng! Vui lòng nhập theo định dạng YYYY-MM (ví dụ: 2024-12)');
        return;
      }
      
      const [year, month] = monthYear.split('-');
      const startDate = new Date(parseInt(year), parseInt(month) - 1, 1); // Ngày đầu tháng
      const endDate = new Date(parseInt(year), parseInt(month), 0); // Ngày cuối tháng
      
      console.log('📅 Downloading monthly history for:', monthYear, 'from', startDate, 'to', endDate);
      
      // Lọc tháng ngay trên Firestore (index factory + exportDate đã có) — chỉ đọc dòng của tháng đó
      const endOfMonth = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), 23, 59, 59, 999);
      const querySnapshot = await this.firestore.collection('outbound-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
           .where('exportDate', '>=', startDate)
           .where('exportDate', '<=', endOfMonth)
      ).get().toPromise();
      
      if (!querySnapshot || querySnapshot.empty) {
        appAlert(`📭 Không có dữ liệu outbound ${this.selectedFactory}`);
        return;
      }

      // Filter theo date range ở client-side
      const filteredDocs = querySnapshot.docs.filter(doc => {
        const data = doc.data() as any;
        const exportDate = data.exportDate?.toDate();
        if (!exportDate) return false;
        return exportDate >= startDate && exportDate <= endOfMonth;
      });

      if (filteredDocs.length === 0) {
        appAlert(`📭 Không có dữ liệu outbound ${this.selectedFactory} trong tháng ${monthYear}`);
        return;
      }
      
      console.log(`✅ Found ${filteredDocs.length} records for ${monthYear}`);
      
      // Chuyển đổi dữ liệu và sort ở client-side
      const exportData = filteredDocs
        .map(doc => {
          const data = doc.data() as any;
          return {
            data,
            exportDate: data.exportDate?.toDate() || new Date(0)
          };
        })
        .sort((a, b) => b.exportDate.getTime() - a.exportDate.getTime()) // Sort desc
        .map(item => {
        const data = item.data;
        return {
          'Factory': data.factory || this.selectedFactory,
          'Material Code': data.materialCode || '',
          'PO Number': data.poNumber || '',
          'Batch': data.importDate || 'N/A',
          'Export Quantity': data.exportQuantity || 0,
          'Unit': data.unit || '',
          'Export Date': data.exportDate?.toDate().toLocaleDateString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }) || '',
          'Employee ID': data.employeeId || '',
          'Production Order': data.productionOrder || '',
          'Scan Method': data.scanMethod || 'MANUAL',
          'Notes': data.notes || ''
        };
      });
      
      // Tạo file Excel
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      
      // Set column widths
      const colWidths = [
        { wch: 8 },   // Factory
        { wch: 15 },  // Material Code
        { wch: 15 },  // PO Number
        { wch: 12 },  // Batch
        { wch: 12 },  // Export Quantity
        { wch: 8 },   // Unit
        { wch: 20 },  // Export Date
        { wch: 12 },  // Employee ID
        { wch: 20 },  // Production Order
        { wch: 12 },  // Scan Method
        { wch: 20 }   // Notes
      ];
      worksheet['!cols'] = colWidths;
      
      // Tạo workbook và export
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Monthly_History');
      
      const fileName = `${this.selectedFactory}_Outbound_History_${monthYear}.xlsx`;
      XLSX.writeFile(workbook, fileName);
      
      console.log(`✅ Monthly history exported: ${fileName}`);
      appAlert(`✅ Đã tải lịch sử outbound tháng ${monthYear}!\n\n` +
            `📁 File: ${fileName}\n` +
            `📊 Số lượng records: ${exportData.length}\n` +
            `📅 Từ: ${startDate.toLocaleDateString('vi-VN')} đến ${endDate.toLocaleDateString('vi-VN')}`);
      
    } catch (error) {
      console.error('❌ Error downloading monthly history:', error);
      appAlert('❌ Lỗi tải lịch sử theo tháng: ' + error.message);
    }
  }
  
  // Cleanup old data (move to archive or delete)
  async cleanupData(): Promise<void> {
    const XLSX = await import('xlsx');
    try {
      const confirmCleanup = confirm(
        '⚠️ CẢNH BÁO: Thao tác này sẽ xóa dữ liệu cũ trên Firebase!\n\n' +
        'Dữ liệu sẽ được tải về trước khi xóa.\n' +
        'Bạn có chắc chắn muốn tiếp tục?'
      );
      
      if (!confirmCleanup) return;
      
      // Get cutoff date (e.g., 30 days ago)
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);
      
      console.log('🧹 Starting data cleanup, cutoff date:', cutoffDate);
      
      // Get old data for backup
      const oldDataQuery = await this.firestore.collection('outbound-materials', ref =>
        ref.where('factory', '==', this.selectedFactory)
           .where('exportDate', '<', cutoffDate)
      ).get().toPromise();
      
      if (!oldDataQuery || oldDataQuery.empty) {
        appAlert('Không có dữ liệu cũ để dọn dẹp');
        return;
      }
      
             // Backup old data to Excel
       const oldData = oldDataQuery.docs.map(doc => {
         const data = doc.data() as any;
         return {
           'ID': doc.id,
           'Factory': data.factory,
           'Material Code': data.materialCode,
           'PO Number': data.poNumber,
           'Quantity': data.quantity,
           'Unit': data.unit,
           'Export Quantity': data.exportQuantity,
           'Export Date': data.exportDate?.toDate().toLocaleDateString('vi-VN') || '',
           'Exported By': data.exportedBy,
           'Employee ID': data.employeeId || '',
           'Production Order': data.productionOrder || '',
           'Scan Method': data.scanMethod,
           'Notes': data.notes
         };
       });
      
      // Save backup
      const worksheet = XLSX.utils.json_to_sheet(oldData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Old_Data_Backup');
      const backupFileName = `${this.selectedFactory}_Outbound_Backup_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(workbook, backupFileName);
      
      console.log(`✅ Backup saved: ${backupFileName}`);
      
      // Delete old data
      const deletePromises = oldDataQuery.docs.map(doc => doc.ref.delete());
      await Promise.all(deletePromises);
      
      console.log(`✅ Deleted ${oldDataQuery.docs.length} old records`);
      
      // Reload data
      this.loadMaterials();
      
      appAlert(`✅ Dọn dẹp hoàn tất!\n\n` +
            `📁 Backup: ${backupFileName}\n` +
            `🗑️ Đã xóa: ${oldDataQuery.docs.length} records cũ\n` +
            `📅 Dữ liệu trước: ${cutoffDate.toLocaleDateString('vi-VN')}`);
      
    } catch (error) {
      console.error('❌ Error during data cleanup:', error);
      appAlert('Lỗi dọn dẹp dữ liệu: ' + error.message);
    }
  }
  
  formatDate(date: Date | null): string { if (!date) return ''; return date.toLocaleDateString('vi-VN'); }
  formatDateTime(date: Date | null): string { if (!date) return ''; return date.toLocaleString('vi-VN'); }
  
  // Camera QR Scanner methods using QRScannerModalComponent (same as RM1 inventory)
  startCameraScanning(): void {
    console.log(`🎯 Starting QR scanner for Outbound ${this.selectedFactory}...`);
    console.log('📱 Mobile device:', this.isMobile);
    console.log('📱 Selected scan method:', this.selectedScanMethod);
    console.log('📱 Current scan step:', this.currentScanStep);
    
    // 🔧 SỬA LỖI: Khởi tạo batch mode nếu chưa có
    if (!this.hasOperatorSession) {
      this.focusOperatorSessionInput();
      return;
    }
    if (!this.isBatchScanningMode) {
      console.log('📱 Initializing batch scanning mode for camera');
      this.isBatchScanningMode = true;
      this.currentScanStep = 'batch';
      this.batchProductionOrder = '';
      this.batchEmployeeId = this.operatorSessionId;
      this.isProductionOrderScanned = false;
      this.bsLsxMode = false;
      this.isEmployeeIdScanned = true;
      this.clearBatchPxkCache();
    }
    
    let title = 'Quét QR Code';
    let message = 'Camera sẽ tự động quét QR code';
    
    if (this.currentScanStep === 'batch') {
      if (!this.isProductionOrderScanned) {
        title = 'Quét LSX (Lệnh Sản Xuất)';
        message = 'Quét mã LSX để bắt đầu xuất kho';
      } else if (!this.isEmployeeIdScanned) {
        title = 'Quét Mã Nhân Viên';
        message = 'Quét mã nhân viên (ASP + 4 số)';
      } else {
        // Both LSX and Employee ID scanned, ready for material
        title = 'Quét Mã Hàng Hóa';
        message = 'Quét QR code của hàng hóa để xuất kho';
        this.currentScanStep = 'material';
      }
    } else if (this.currentScanStep === 'material') {
      title = 'Quét Mã Hàng Hóa';
      message = 'Quét QR code của hàng hóa để xuất kho (camera sẽ tiếp tục mở để quét thêm)';
    }
    
    const dialogData: QRScannerData = {
      title: title,
      message: message,
      materialCode: undefined
    };

    const dialogRef = this.dialog.open(QRScannerModalComponent, {
      width: '500px',
      maxWidth: '95vw',
      data: dialogData,
      disableClose: true, // Prevent accidental close
      panelClass: 'qr-scanner-dialog'
    });

    dialogRef.afterClosed().subscribe(result => {
      console.log('📱 QR Scanner result:', result);
      
      if (result && result.success && result.text) {
        // Process the scanned data using SAME LOGIC as scanner
        this.processCameraScanResult(result.text);
        
        // Debug: Check current state after processing
        console.log('📱 After processing scan:');
        console.log('📱 - isProductionOrderScanned:', this.isProductionOrderScanned);
        console.log('📱 - isEmployeeIdScanned:', this.isEmployeeIdScanned);
        console.log('📱 - currentScanStep:', this.currentScanStep);
        console.log('📱 - batchProductionOrder:', this.batchProductionOrder);
        console.log('📱 - batchEmployeeId:', this.batchEmployeeId);
        
        // Update UI after processing
        this.cdr.detectChanges();
        
        // Only reopen camera if we're still in batch scanning mode and not ready to process
        if (this.isBatchScanningMode && (!this.isProductionOrderScanned || !this.isEmployeeIdScanned)) {
          console.log('📱 Still need to scan LSX/Employee - reopening camera...');
          setTimeout(() => {
            this.startCameraScanning();
          }, 1000);
        } else if (this.isBatchScanningMode && this.isProductionOrderScanned && this.isEmployeeIdScanned) {
          // After scanning material, continue camera for more materials
          console.log('📱 Material scanned - continuing camera for more materials...');
          setTimeout(() => {
            this.startCameraScanning();
          }, 1000);
        } else {
          console.log('📱 Batch scanning completed or stopped');
        }
      } else if (result && result.error) {
        console.error('❌ QR Scanner error:', result.error);
        this.errorMessage = 'Lỗi quét QR: ' + result.error;
        
        // Reopen camera even after error for continuous scanning
        if (this.isBatchScanningMode) {
          console.log('📱 Reopening camera after error...');
          setTimeout(() => {
            this.startCameraScanning();
          }, 1000);
        }
        } else {
        console.log('📱 QR Scanner cancelled or closed by user');
        // Don't reset data when camera is closed, just stop camera scanning
        // User can still use Review and Save buttons
        console.log('📱 Camera scanning stopped - data preserved for processing');
      }
    });
  }
  
  // Stop camera scanning (for continuous mode)
  stopCameraScanning(): void {
    console.log('📱 Stopping camera scanning...');
    // Don't reset data, just stop the camera
    // User can still use Done button to process pending data
    console.log('📱 Camera scanning stopped - data preserved for processing');
  }
  
  // Reset all scanning data (when user wants to start fresh)
  resetScanningData(): void {
    console.log('🔄 Resetting all scanning data...');
    this.isBatchScanningMode = false;
    this.isProductionOrderScanned = false;
    this.bsLsxMode = false;
    this.isEmployeeIdScanned = false;
    this.batchProductionOrder = '';
    this.batchEmployeeId = '';
    this.clearBatchPxkCache();
    this.pendingScanData = [];
    this.currentScanStep = 'batch';
    this.errorMessage = '';
    if (this.hasOperatorSession) this.applyOperatorToBatch();
    console.log('✅ All scanning data reset');
  }
  
  // Debug method to check current state
  debugCurrentState(): void {
    console.log('🔍 === DEBUG CURRENT STATE ===');
    console.log('🔍 isBatchScanningMode:', this.isBatchScanningMode);
    console.log('🔍 isProductionOrderScanned:', this.isProductionOrderScanned);
    console.log('🔍 isEmployeeIdScanned:', this.isEmployeeIdScanned);
    console.log('🔍 batchProductionOrder:', this.batchProductionOrder);
    console.log('🔍 batchEmployeeId:', this.batchEmployeeId);
    console.log('🔍 currentScanStep:', this.currentScanStep);
    console.log('🔍 pendingScanData.length:', this.pendingScanData.length);
    console.log('🔍 pendingScanData:', this.pendingScanData);
    console.log('🔍 selectedScanMethod:', this.selectedScanMethod);
    console.log('🔍 isMobile:', this.isMobile);
    console.log('🔍 === END DEBUG STATE ===');
  }
  
  // Start camera scanning for materials (after LSX and Employee ID are scanned)
  startMaterialCameraScanning(): void {
    console.log('📱 Starting material camera scanning...');
    if (!this.isProductionOrderScanned || !this.isEmployeeIdScanned) {
      this.errorMessage = 'Phải scan LSX và mã nhân viên trước!';
      return;
    }
    
    this.currentScanStep = 'material';
    this.startCameraScanning();
  }
  
  // Save scanned data to outbound
  saveScannedData(): void {
    console.log('💾 Saving scanned data to outbound...');
    if (this.pendingScanData.length === 0) {
      this.errorMessage = 'Không có dữ liệu để lưu!';
      return;
    }
    
    // Use the same logic as stopBatchScanningMode but without stopping batch mode
    this.processPendingScanData();
  }
  
  // Process pending scan data (extracted from stopBatchScanningMode)
  private async processPendingScanData(): Promise<void> {
    if (this.pendingScanData.length === 0) {
      console.log('📦 No pending data to process');
      return;
    }
    
    try {
      console.log(`📦 Processing ${this.pendingScanData.length} pending items...`);
      
      // Show loading
      this.isLoading = true;
      this.errorMessage = `Đang xử lý ${this.pendingScanData.length} mã hàng...`;
      
      // Process each scanned item by creating outbound records
      const batch = this.firestore.firestore.batch();
      const outboundCollection = this.firestore.collection('outbound-materials');
      
      for (const scanItem of this.pendingScanData) {
        const p = this.rmBagHistory.parseQrPart4(scanItem.importDate);
        const imdStored = p.imdKey || this.normalizeImportDate(scanItem.importDate) || scanItem.importDate;
        const bagNumberDisplay = (scanItem.bagNumberDisplay || p.bagNumberDisplay || '').trim();
        const outboundData: OutboundMaterial = {
          factory: this.selectedFactory,
          materialCode: scanItem.materialCode,
          poNumber: scanItem.poNumber,
          quantity: scanItem.quantity,
          unit: 'PCS',
          exportQuantity: scanItem.quantity,
          ...(this.leExportQty(scanItem.materialCode, scanItem.quantity, scanItem.poNumber) > 0
            ? { leQty: this.leExportQty(scanItem.materialCode, scanItem.quantity, scanItem.poNumber) }
            : {}),
          scanCount: scanItem.scanCount ?? 1,
          exportDate: new Date(),
          location: scanItem.location,
          exportedBy: scanItem.employeeId || this.batchEmployeeId,
          batch: imdStored,
          batchNumber: imdStored,
          bagBatch: scanItem.bagBatch || p.bagFractionLabel,
          ...(bagNumberDisplay ? { bagNumberDisplay } : {}),
          scanMethod: 'CAMERA', // 🔧 CAMERA ONLY: Đánh dấu rõ ràng là camera
          notes: `Auto-scanned export - ${scanItem.scanTime.toISOString()}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          productionOrder: scanItem.productionOrder,
          employeeId: scanItem.employeeId || this.batchEmployeeId,
          importDate: imdStored
        };
        
        const docRef = outboundCollection.ref.doc();
        batch.set(docRef, outboundData);
      }
      
      // Commit batch
      await batch.commit();
      console.log(`✅ Successfully saved ${this.pendingScanData.length} items to outbound-materials collection`);
      this.syncWorkOrderCreatedByFromPendingScans();
      this.markTemLeClExported(this.pendingScanData);
      this.writeLsxLog(this.pendingScanData, 'CAMERA');

      // 🔧 UNIFIED: Cập nhật inventory exported quantity cho từng item (TUẦN TỰ)
      console.log('📦 Updating inventory exported quantities sequentially...');
      for (let i = 0; i < this.pendingScanData.length; i++) {
        const scanItem = this.pendingScanData[i];
        try {
          console.log(`📦 Processing item ${i + 1}/${this.pendingScanData.length}: ${scanItem.materialCode}`);
          await this.unifiedUpdateInventory(
            scanItem.materialCode,
            scanItem.poNumber,
            scanItem.quantity,
            scanItem.importDate,
            'BATCH_SCANNER',
            scanItem.exportedBagsDelta ?? 0,
            scanItem.bagBatch || this.rmBagHistory.extractBagLabelFromQrPart4(scanItem.importDate)
          );
          console.log(`✅ Updated inventory for ${scanItem.materialCode} - PO: ${scanItem.poNumber} - Qty: ${scanItem.quantity}`);
          
          // 🔧 SYNC FIX: Thêm delay giữa các lần update để tránh race condition
          if (i < this.pendingScanData.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        } catch (error) {
          console.error(`❌ Error updating inventory for ${scanItem.materialCode}:`, error);
        }
      }
      console.log('✅ All inventory exported quantities updated');
      
      // Clear pending data
      const processedCount = this.pendingScanData.length;
      for (const scanItem of this.pendingScanData) {
        this.addBatchPxkExported(scanItem.materialCode, scanItem.poNumber, scanItem.quantity);
      }
      this.pendingScanData = [];
      this.savePendingToStorage();
      
      // Success message
      this.errorMessage = `✅ Đã lưu ${processedCount} mã hàng vào outbound và cập nhật inventory!`;
      
      // 🔧 CAMERA SYNC FIX: Không gọi loadMaterials() ở đây để tránh race condition
      console.log('✅ Camera batch processing completed - inventory will be refreshed by stopBatchScanningMode()');
      
    } catch (error) {
      console.error('❌ Error processing pending data:', error);
      this.errorMessage = 'Lỗi xử lý dữ liệu: ' + error.message;
    } finally {
      this.isLoading = false;
    }
  }
  
  private async waitForElement(elementId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 20; // 2 seconds max wait
      
      console.log('🔍 Waiting for element:', elementId);
      
      const checkElement = () => {
        const element = document.getElementById(elementId);
        console.log(`🔍 Attempt ${attempts + 1}: Looking for element "${elementId}", found:`, !!element);
        
        if (element) {
          console.log('✅ Found element:', elementId);
          resolve();
        } else if (attempts >= maxAttempts) {
          console.error('❌ Element not found after max attempts:', elementId);
          reject(new Error(`Element with id="${elementId}" not found after ${maxAttempts} attempts`));
        } else {
          attempts++;
          setTimeout(checkElement, 100); // Check every 100ms
        }
      };
      
      // Start checking immediately
      checkElement();
    });
  }
  
  async stopScanning(): Promise<void> {
    // Stop QRScannerService
    this.qrScannerService.stopScanning();
    
    // Also stop Html5Qrcode if it exists
    if (this.scanner) {
      try {
        await this.scanner.stop();
        console.log('✅ Html5Qrcode scanner stopped');
      } catch (error) {
        console.error('❌ Error stopping Html5Qrcode scanner:', error);
      }
      this.scanner = null;
    }
    
    // Reset all scanner states
    this.isCameraScanning = false;
    this.isScannerLoading = false;
    this.isScannerInputActive = false;
    this.lastScannedData = null;
    this.exportQuantity = 0;
    this.scannerBuffer = '';
    
    console.log('✅ All scanner states reset');
  }
  
  private onScanSuccess(decodedText: string): void {
    console.log('🔍 === ON SCAN SUCCESS START ===');
    console.log('🔍 Input decodedText:', decodedText);
    console.log('🔍 Input type:', typeof decodedText);
    console.log('🔍 Input length:', decodedText.length);
    console.log('🔍 Current scan step:', this.currentScanStep);
    console.log('🔍 Batch scanning mode:', this.isBatchScanningMode);
    console.log('🔍 Batch state:', {
      isProductionOrderScanned: this.isProductionOrderScanned,
      isEmployeeIdScanned: this.isEmployeeIdScanned,
      batchProductionOrder: this.batchProductionOrder,
      batchEmployeeId: this.batchEmployeeId
    });
    
    // Check if we're in batch mode
    if (this.isBatchScanningMode) {
      // Check if both LSX and Employee ID are already scanned
      if (this.isProductionOrderScanned && this.isEmployeeIdScanned) {
        console.log('🔍 Both LSX and Employee ID scanned, processing material scan');
        // Process as material scan via queue
        this.enqueueMaterialScan(decodedText);
        return;
      } else {
        console.log('🔍 Processing batch scan input for LSX/Employee ID');
        this.processBatchScanInput(decodedText);
        return;
      }
    }
    
    try {
      console.log('🔍 Processing scanned QR data:', decodedText);
      
      // Đơn giản: Parse QR data format "MaterialCode|PONumber|Quantity|BatchNumber"
      // Xử lý dấu cách và format không đúng
      let cleanText = decodedText.trim();
      
      // Loại bỏ dấu cách trước dấu |
      cleanText = cleanText.replace(/\s*\|\s*/g, '|');
      
      const parts = cleanText.split('|');
      if (parts.length >= 3) {
        this.lastScannedData = {
          materialCode: parts[0].trim(),
          poNumber: parts[1].trim(),
          quantity: this.parseScanQty(parts[2]),
          importDate: parts.length >= 4 ? parts[3].trim() : null // Bây giờ là batch number: 26082025
        };
        
        console.log('🔍 Original text:', decodedText);
        console.log('🔍 Cleaned text:', cleanText);
        console.log('🔍 Parsed data:', this.lastScannedData);
        
        // Set default export quantity to full quantity
        this.exportQuantity = this.lastScannedData.quantity;
        
      } else if (decodedText.includes(',')) {
        // Try comma-separated format: "MaterialCode,PONumber,Quantity"
        const commaParts = decodedText.split(',');
        if (commaParts.length >= 3) {
          this.lastScannedData = {
            materialCode: commaParts[0].trim(),
            poNumber: commaParts[1].trim(),
            quantity: this.parseScanQty(commaParts[2])
          };
          
          console.log('✅ Parsed QR data (comma format):', this.lastScannedData);
          this.exportQuantity = this.lastScannedData.quantity;
        } else {
          throw new Error('Invalid comma format');
        }
      } else {
        // Try JSON format as fallback
        try {
          const jsonData = JSON.parse(decodedText);
          if (jsonData.materialCode && jsonData.poNumber) {
            this.lastScannedData = {
              materialCode: jsonData.materialCode.toString().trim(),
              poNumber: jsonData.poNumber.toString().trim(),
              quantity: this.parseScanQty(jsonData.quantity) || this.parseScanQty(jsonData.unitNumber)
            };
            
            console.log('✅ Parsed QR data (JSON format):', this.lastScannedData);
            this.exportQuantity = this.lastScannedData.quantity;
          } else {
            throw new Error('Missing required fields in JSON');
          }
        } catch (jsonError) {
          // If all parsing methods fail, try to extract any recognizable pattern
          console.log('🔍 Trying pattern extraction from:', decodedText);
          
          // Look for common patterns like "B018694" (material code)
          const materialCodeMatch = decodedText.match(/[A-Z]\d{6,}/);
          const poMatch = decodedText.match(/PO\d+|P\d+/i);
          const numberMatch = decodedText.match(/\d+(?:[.,]\d+)?/);
          
          if (materialCodeMatch && poMatch && numberMatch) {
            this.lastScannedData = {
              materialCode: materialCodeMatch[0],
              poNumber: poMatch[0],
              quantity: this.parseScanQty(numberMatch[0])
            };
            
            console.log('✅ Parsed QR data (pattern extraction):', this.lastScannedData);
            this.exportQuantity = this.lastScannedData.quantity;
          } else {
            throw new Error('Could not extract material information from QR code');
          }
        }
      }
      
      // Validate parsed data
      if (!this.lastScannedData.materialCode || !this.lastScannedData.poNumber || this.lastScannedData.quantity <= 0) {
        throw new Error('Invalid material data: missing code, PO, or quantity');
      }

      // Tem Thùng (tiền tố ẩn TT:) chỉ được xuất nếu mã nằm trong danh mục Xuất thùng
      const strippedScan = stripTemThungMarker(this.lastScannedData.materialCode);
      if (strippedScan.isTemThung && !this.allowExportByCartonSet.has(strippedScan.materialCode.trim().toUpperCase())) {
        throw new Error(`Mã ${strippedScan.materialCode} không nằm trong danh mục Xuất thùng — không thể xuất bằng Tem Thùng.`);
      }
      this.lastScannedData.materialCode = strippedScan.materialCode;

      const packErrCamera = this.validateScanQtyVsStandardPacking(
        this.lastScannedData.materialCode,
        this.lastScannedData.quantity,
        this.lastScannedData.poNumber
      );
      if (packErrCamera) {
        throw new Error(packErrCamera);
      }

      console.log('✅ Final parsed data:', this.lastScannedData);
      console.log('✅ Export quantity set to:', this.exportQuantity);
      
      // 🔧 SEPARATE LOGIC: Scanner auto-export, Camera chỉ thêm vào pending
      if (this.selectedScanMethod === 'scanner') {
        console.log('📱 SCANNER: Auto-exporting immediately...');
      this.autoExportScannedMaterial();
      } else if (this.selectedScanMethod === 'camera') {
        console.log('📱 CAMERA: Adding to pending data for batch processing...');
        // Camera chỉ parse và thêm vào pendingScanData, không auto-export
        // Sẽ được xử lý khi user bấm "Done" hoặc "Save"
      } else {
        console.log('📱 UNKNOWN METHOD: Defaulting to camera behavior...');
        // Default behavior - thêm vào pending data
      }
      
    } catch (error) {
      console.error('❌ Error parsing QR data:', error);
      console.error('❌ Raw QR data was:', decodedText);
      appAlert(`QR code không hợp lệ: ${error.message}\n\nDữ liệu quét được: ${decodedText}\n\nVui lòng quét QR code từ hệ thống hoặc kiểm tra format.`);
    }
    
    console.log('🔍 === ON SCAN SUCCESS END ===');
    console.log('🔍 Final pending data count:', this.pendingScanData.length);
    console.log('🔍 Final batch state:', {
      isProductionOrderScanned: this.isProductionOrderScanned,
      isEmployeeIdScanned: this.isEmployeeIdScanned,
      batchProductionOrder: this.batchProductionOrder,
      batchEmployeeId: this.batchEmployeeId
    });
  }

  onScanError(error: any): void {
    console.error('❌ QR scan error:', error);
    // Don't show error to user for scanning attempts - they're too frequent
  }

  // 🔧 CAMERA ONLY: Process camera scan result - chỉ thêm vào pending data
  processCameraScanResult(scannedText: string): void {
    console.log('📱 === CAMERA SCAN RESULT START ===');
    console.log('📱 Scanned text:', scannedText);
    console.log('📱 Text length:', scannedText.length);
    console.log('📱 Current scan step:', this.currentScanStep);
    console.log('📱 Batch scanning mode:', this.isBatchScanningMode);
    console.log('📱 LSX scanned:', this.isProductionOrderScanned);
    console.log('📱 Employee scanned:', this.isEmployeeIdScanned);
    console.log('📱 Pending data count:', this.pendingScanData.length);
    
    if (!this.isBatchScanningMode) {
      // If not in batch mode, start batch mode first (but don't reset existing data)
      console.log('📱 Starting batch mode for camera scan');
      this.isBatchScanningMode = true;
      this.currentScanStep = 'batch';
      // DON'T reset isProductionOrderScanned, isEmployeeIdScanned, batchProductionOrder, batchEmployeeId
    }
    
    // 🔧 SỬA LỖI: Xử lý đúng thứ tự - LSX → Employee ID → Material
    if (!this.isProductionOrderScanned) {
      // Scan LSX first
      console.log('📱 CAMERA: Processing LSX scan');
      this.onLSXScanned(scannedText);
    } else if (!this.isEmployeeIdScanned) {
      // Scan Employee ID second
      console.log('📱 CAMERA: Processing Employee ID scan');
      this.onEmployeeScanned(scannedText);
    } else {
      // Both LSX and Employee ID scanned - now scan materials
      console.log('📱 CAMERA: Processing material scan');
      this.enqueueMaterialScan(scannedText);
    }
    
    console.log('📱 === CAMERA SCAN RESULT END ===');
    console.log('📱 After processing - Pending data count:', this.pendingScanData.length);
  }

  
  // Consolidate outbound records by ALL 4 fields: material code + PO + employee ID + production order (LSX)
  private consolidateOutboundRecords(materials: OutboundMaterial[]): OutboundMaterial[] {
    const consolidatedMap = new Map<string, OutboundMaterial>();
    
    materials.forEach(material => {
      // Create key: materialCode + poNumber + employeeId + productionOrder
      // Chỉ gộp khi CẢ 4 thông tin giống hệt nhau
      const key = `${material.materialCode}_${material.poNumber}_${material.employeeId || 'NO_EMPLOYEE'}_${material.productionOrder || 'NO_LSX'}`;
      
      if (consolidatedMap.has(key)) {
        // Merge with existing record - chỉ khi 4 thông tin giống hệt
        const existing = consolidatedMap.get(key)!;
        existing.exportQuantity += material.exportQuantity;
        existing.quantity = Math.max(existing.quantity, material.quantity); // Keep max quantity
        existing.updatedAt = new Date(Math.max(existing.updatedAt.getTime(), material.updatedAt.getTime()));
        existing.createdAt = new Date(Math.min(existing.createdAt.getTime(), material.createdAt.getTime())); // Keep earliest creation
        
        // Ghi chú về việc gộp
        const oldQuantity = existing.exportQuantity - material.exportQuantity;
        existing.notes = `Gộp từ ${oldQuantity} + ${material.exportQuantity} = ${existing.exportQuantity} - ${material.notes || 'Auto-scanned export'}`;
        
        console.log(`🔄 Merged outbound record: ${material.materialCode} - PO: ${material.poNumber} - Employee: ${material.employeeId} - LSX: ${material.productionOrder}`);
        
      } else {
        // New record - tạo dòng mới khi có bất kỳ thông tin nào khác nhau
        consolidatedMap.set(key, { ...material });
        console.log(`➕ New outbound record: ${material.materialCode} - PO: ${material.poNumber} - Employee: ${material.employeeId} - LSX: ${material.productionOrder}`);
      }
    });
    
    console.log(`🔄 Consolidated ${materials.length} records into ${consolidatedMap.size} unique entries`);
    console.log(`📊 Consolidation rule: Only merge when ALL 4 fields match (Material + PO + Employee + LSX)`);
    
    return Array.from(consolidatedMap.values());
  }

  // Create new outbound record
  private async createNewOutboundRecord(exportedBy: string): Promise<void> {
    const p = this.rmBagHistory.parseQrPart4(this.lastScannedData.importDate);
    const imdStored =
      p.imdKey || this.normalizeImportDate(this.lastScannedData.importDate) || this.lastScannedData.importDate || null;
    const outboundRecord: OutboundMaterial = {
      factory: this.selectedFactory,
      materialCode: this.lastScannedData.materialCode,
      poNumber: this.lastScannedData.poNumber,
      quantity: this.lastScannedData.quantity,
      unit: 'KG', // Default unit
      exportQuantity: this.exportQuantity,
      ...(this.leExportQty(this.lastScannedData.materialCode, this.exportQuantity, this.lastScannedData.poNumber) > 0
        ? { leQty: this.leExportQty(this.lastScannedData.materialCode, this.exportQuantity, this.lastScannedData.poNumber) }
        : {}),
      exportDate: new Date(),
      location: '',
      exportedBy: this.batchEmployeeId || exportedBy,
      employeeId: this.batchEmployeeId || exportedBy,
      productionOrder: this.batchProductionOrder || '',
      batchNumber: imdStored,
      bagBatch: p.bagFractionLabel || this.rmBagHistory.extractBagLabelFromQrPart4(this.lastScannedData.importDate),
      bagNumberDisplay: p.bagNumberDisplay || undefined,
      scanMethod: 'SCANNER', // 🔧 SCANNER ONLY: Đánh dấu rõ ràng là scanner
      notes: `Auto-scanned export - Original: ${this.lastScannedData.quantity}, Exported: ${this.exportQuantity}`,
      importDate: imdStored,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    console.log('🔍 Saving outbound record with importDate:', outboundRecord.importDate);
    
    console.log('📝 Creating new outbound record:', outboundRecord);
    console.log('📅 Import date in outbound record:', outboundRecord.importDate);
    console.log('📅 Import date type in outbound record:', typeof outboundRecord.importDate);
    
    // Add to outbound collection
    console.log('🔥 Adding to Firebase collection: outbound-materials');
    const docRef = await this.firestore.collection('outbound-materials').add(outboundRecord);
    console.log('✅ New outbound record created with ID:', docRef.id);
    this.syncWorkOrderCreatedByAfterExport();
    this.markTemLeClExported([this.lastScannedData]);
    this.writeLsxLog([{ ...this.lastScannedData, quantity: this.exportQuantity, scanTime: new Date() }], 'SCANNER');
    
    // Verify data was saved correctly
    const savedDoc = await docRef.get();
    const savedData = savedDoc.data() as any;
    console.log('📅 Saved importDate in database:', savedData?.importDate);
    console.log('📅 Saved importDate type in database:', typeof savedData?.importDate);
  }

  // 🔧 SCANNER ONLY: Auto-export method that runs immediately after scanner scan
  private async autoExportScannedMaterial(): Promise<void> {
    if (!this.lastScannedData || !this.exportQuantity || this.exportQuantity <= 0) {
      console.log('❌ Scanner auto-export validation failed:', { lastScannedData: this.lastScannedData, exportQuantity: this.exportQuantity });
      return;
    }

    const lsxMatchErr = await this.validateScanMatchesLsxPxk(
      this.lastScannedData.materialCode,
      this.lastScannedData.poNumber
    );
    if (lsxMatchErr) {
      this.showScanError(lsxMatchErr);
      this.lastScannedData = null;
      this.exportQuantity = 0;
      return;
    }

    const pxkQtyErrAuto = this.validateScanQtyVsPxkRemaining(
      this.lastScannedData.materialCode,
      this.lastScannedData.poNumber,
      this.exportQuantity
    );
    if (pxkQtyErrAuto) {
      this.showScanError(pxkQtyErrAuto);
      this.lastScannedData = null;
      this.exportQuantity = 0;
      return;
    }

    const stockErrAuto = await this.validateScanStock(
      this.lastScannedData.materialCode,
      this.lastScannedData.poNumber,
      this.exportQuantity,
      this.lastScannedData.importDate,
      []
    );
    if (stockErrAuto.err) {
      this.showScanError(stockErrAuto.err);
      this.lastScannedData = null;
      this.exportQuantity = 0;
      return;
    }
    {
      const rem = this.pxkRemainFor(this.lastScannedData.materialCode, this.lastScannedData.poNumber);
      const crumb = this.crumbTopUp(stockErrAuto.left, this.exportQuantity, rem == null ? null : rem - this.exportQuantity);
      if (crumb > 0) this.exportQuantity = Math.round((this.exportQuantity + crumb) * 10000) / 10000;
    }

    // Bag CL lẻ duy nhất của mã PCS (tồn mã < 5000) → đếm chính xác trước khi xuất
    if (this.clCount || this.tlPhoto) {
      this.showScanError(this.clCount ? `Đang chờ nhập số đếm bag CL ${this.clCount.code}. Xác nhận hoặc Hủy trước.` : 'Đang chờ chụp hình bag TL. Chụp hoặc Hủy trước.');
      this.lastScannedData = null;
      this.exportQuantity = 0;
      return;
    }
    const clAuto = await this.findClCountNeed(this.lastScannedData.materialCode, this.lastScannedData.poNumber,
      this.lastScannedData.importDate, this.exportQuantity, stockErrAuto.left).catch(() => null);
    if (clAuto) {
      const data = this.lastScannedData;
      const qty = this.exportQuantity;
      this.openClCount(clAuto, async () => {
        this.lastScannedData = data;
        this.exportQuantity = qty;
        await this.autoExportTlStep();
      }, () => {
        this.lastScannedData = null;
        this.exportQuantity = 0;
      });
      return;
    }
    await this.autoExportTlStep();
  }

  /** Máy scan: tem TL → bắt buộc chụp hình trước khi xuất. */
  private async autoExportTlStep(): Promise<void> {
    const data = this.lastScannedData;
    const qty = this.exportQuantity;
    const tl = this.tlTagOf(data?.importDate);
    if (data && tl) {
      this.openTlPhoto(data.materialCode, data.poNumber, tl, async () => {
        this.lastScannedData = data;
        this.exportQuantity = qty;
        await this.autoExportAfterChecks();
      }, () => {
        this.lastScannedData = null;
        this.exportQuantity = 0;
      });
      return;
    }
    await this.autoExportAfterChecks();
  }

  /** Máy scan: ghi xuất + trừ tồn (sau các bước kiểm). */
  private async autoExportAfterChecks(): Promise<void> {
    try {
      console.log('🚀 SCANNER: Auto-exporting scanned material...');
      console.log('📊 Scanned data:', this.lastScannedData);
      console.log('📊 Export quantity:', this.exportQuantity);
      
      // Get current user
      const user = await this.afAuth.currentUser;
      const exportedBy = user ? (user.email || user.uid) : 'SCANNER_USER';
      console.log('👤 Current user:', exportedBy);
      
      // 🔧 SCANNER LOGIC: Tạo record mới cho mỗi lần scan
      console.log('➕ SCANNER: Creating new record for each scan');
          await this.createNewOutboundRecord(exportedBy);
      
      // 🔧 UNIFIED: Cập nhật cột "đã xuất" trong inventory
      console.log('📦 Updating inventory exported quantity...');
      console.log(`🔍 Parameters: Material=${this.lastScannedData.materialCode}, PO=${this.lastScannedData.poNumber}, Qty=${this.exportQuantity}, Batch=${this.lastScannedData.importDate}`);
      const bagDelta = this.parseImdFromQrPart4(this.lastScannedData.importDate).bagDelta;
      const bagBatch = this.rmBagHistory.extractBagLabelFromQrPart4(this.lastScannedData.importDate);
      await this.unifiedUpdateInventory(
        this.lastScannedData.materialCode, 
        this.lastScannedData.poNumber, 
        this.exportQuantity,
        this.lastScannedData.importDate,
        'AUTO_EXPORT',
        bagDelta,
        bagBatch
      );
      console.log('✅ Inventory exported quantity updated successfully');
      
      // Store data for success message
      const successData = {
        materialCode: this.lastScannedData.materialCode,
        poNumber: this.lastScannedData.poNumber,
        exportQuantity: this.exportQuantity,
        unit: 'KG' // Default unit
      };
      this.addBatchPxkExported(successData.materialCode, successData.poNumber, successData.exportQuantity);
      
      // Reset scanner state
      this.lastScannedData = null;
      this.exportQuantity = 0;
      
      // Reload data with delay to ensure outbound data is committed
      console.log('🔄 Reloading materials data...');
      setTimeout(async () => {
        await this.loadMaterials();
        console.log('✅ Materials data reloaded');
      }, 2000); // 2 second delay to ensure inventory is updated properly
      
      // Success - no popup needed for normal export
      console.log(`✅ Auto-export completed: ${successData.exportQuantity} ${successData.unit} của ${successData.materialCode}`);
      
    } catch (error) {
      console.error('❌ Error in auto-export:', error);
      console.error('❌ Error details:', {
        message: error.message,
        stack: error.stack,
        lastScannedData: this.lastScannedData,
        exportQuantity: this.exportQuantity
      });
      // Bỏ alert - chỉ log console để scan liên tục
      console.error('❌ Lỗi tự động xuất:', error.message);
    }
  }
  
  // REMOVED: updateInventoryStock() - Không cần tính stock để scan nhanh
  
  // Physical Scanner methods
  activatePhysicalScanner(): void {
    console.log('🔌 Activating physical scanner input...');
    this.isScannerInputActive = !this.isScannerInputActive;
    
    if (this.isScannerInputActive) {
      this.scannerBuffer = '';
      this.focusScannerInput();
      console.log('✅ Physical scanner activated - Ready to receive input');
    } else {
      console.log('⏹️ Physical scanner deactivated');
    }
  }

  // 🔧 SỬA LỖI: Scan đơn giản - 1 lần bấm là scan và ghi luôn
  startBatchScanningMode(): void {
    console.log('🚀 Starting professional scanning setup...');
    if (!this.hasOperatorSession) {
      this.focusOperatorSessionInput();
      return;
    }
    
    // Reset tất cả trạng thái
    this.batchProductionOrder = '';
    this.batchEmployeeId = this.operatorSessionId;
    this.isProductionOrderScanned = false;
    this.bsLsxMode = false;
    this.isEmployeeIdScanned = true;
    this.isWaitingForMaterial = false;
    this.currentScanStep = 'batch';
    this.pendingScanData = [];
    this.clearBatchPxkCache();
    
    // Dùng luôn nhà máy đã chọn trên header — không hỏi lại popup chọn ASM1/ASM2.
    this.showScanningSetupModal = true;
    this.scanningSetupStep = 'lsx';

    // Focus ô trong modal setup (PDA cần input thật, không display:none)
    this.isScannerInputActive = true;
    setTimeout(() => this.focusScannerInput(), 50);
    setTimeout(() => this.focusScannerInput(), 200);
    
    console.log(`✅ Scanning setup → LSX (factory header: ${this.selectedFactory})`);
  }

  async stopBatchScanningMode(): Promise<void> {
    console.log('🛑 Processing Done - Batch updating all scanned items...');
    console.log('📊 Current state:', {
      pendingScanDataLength: this.pendingScanData.length,
      isProductionOrderScanned: this.isProductionOrderScanned,
      isEmployeeIdScanned: this.isEmployeeIdScanned,
      batchProductionOrder: this.batchProductionOrder,
      batchEmployeeId: this.batchEmployeeId
    });
    
    const savedCount = this.pendingScanData.length;
    
    // 🔧 SIÊU TỐI ƯU: Batch update tất cả pending scan data
    if (savedCount > 0) {
      try {
        console.log(`📦 Batch updating ${savedCount} items...`);
        
        // Hiển thị loading và trạng thái saving
        this.isLoading = true;
        this.isSavingBatchData = true;
        this.cdr.detectChanges(); // Force UI update để hiển thị ngay
        console.log('🔄 UI updated - showing saving indicator');
        
        console.log('📦 Starting batch update...');
        await this.batchUpdateAllScanData();
        console.log('✅ Batch update completed successfully');
        
        console.log(`✅ Saved ${savedCount} items - Firebase listener will auto-sync data`);
        
      } catch (error) {
        console.error('❌ Error in batch update:', error);
        appAlert('Lỗi cập nhật dữ liệu: ' + error.message);
      } finally {
        console.log('🔄 Entering finally block - resetting states...');
        this.isLoading = false;
        this.isSavingBatchData = false;
        console.log('✅ Loading flags reset:', { isLoading: this.isLoading, isSavingBatchData: this.isSavingBatchData });
        
        // 🔧 SỬA LỖI: Reset trong finally block để đảm bảo luôn chạy
        console.log('🔄 Resetting all batch scanning states...');
        this.isBatchScanningMode = false;
        this.batchProductionOrder = '';
        this.batchEmployeeId = '';
        this.isProductionOrderScanned = false;
        this.bsLsxMode = false;
        this.isEmployeeIdScanned = false;
        this.isWaitingForMaterial = false;
        this.currentScanStep = 'batch';
        this.isScannerInputActive = false;
        this.scannerBuffer = '';
        this.pendingScanData = []; // Reset pending data
        this.clearBatchPxkCache();
        this.savePendingToStorage();
        
        // Force UI update
        this.cdr.detectChanges();
        
        console.log('✅ Batch scanning mode completed and reset');
        console.log('📊 After reset:', {
          isBatchScanningMode: this.isBatchScanningMode,
          pendingScanDataLength: this.pendingScanData.length
        });
      }
    } else {
      console.log('⚠️ No pending scan data to save');
      appAlert('⚠️ Không có dữ liệu để lưu!');
      
      // Reset ngay cả khi không có data
      this.isBatchScanningMode = false;
      this.currentScanStep = 'batch';
      this.cdr.detectChanges();
    }
  }

  // 🔧 ĐƠN GIẢN HÓA: Chỉ lưu outbound records, BỎ inventory updates
  private async batchUpdateAllScanData(): Promise<void> {
    if (this.pendingScanData.length === 0) {
      console.log('⚠️ No pending data to save');
      return;
    }

    console.log(`📦 Saving ${this.pendingScanData.length} scanned items to outbound...`);
    
    const batch = this.firestore.firestore.batch();

    // 1. CỘNG DỒN - CHỈ KHI TRÙNG ĐẦY ĐỦ 6 TRƯỜNG
    // Nguyên tắc: Ngày xuất + Mã hàng + Số PO + IMD + Mã nhân viên + Lệnh sản xuất
    const consolidatedMap = new Map<string, any>();
    
    for (const scanItem of this.pendingScanData) {
      // 🔧 FIX: Key phải bao gồm ĐẦY ĐỦ các trường để tách dòng đúng
      // Ngày xuất (normalize về ngày, bỏ giờ phút giây)
      const exportDateStr = scanItem.scanTime instanceof Date 
        ? scanItem.scanTime.toISOString().split('T')[0] 
        : new Date(scanItem.scanTime).toISOString().split('T')[0];
      
      const key = `${exportDateStr}|${scanItem.materialCode}|${scanItem.poNumber}|${scanItem.importDate || 'NO_IMD'}|${scanItem.employeeId}|${scanItem.productionOrder}`;
      
      if (consolidatedMap.has(key)) {
        // ✅ TRÙNG ĐẦY ĐỦ 6 TRƯỜNG:
        // - Không cộng dồn quantity/exportQuantity (quantity đã là tổng theo scan)
        // - Chỉ cộng dồn scanCount = số lần scan
        const existing = consolidatedMap.get(key);
        existing.scanCount = (existing.scanCount || 1) + (scanItem.scanCount || 1);
        existing.updatedAt = scanItem.scanTime;
        const p = this.rmBagHistory.parseQrPart4(scanItem.importDate);
        const bb = scanItem.bagBatch || p.bagFractionLabel;
        if (bb) {
          const parts = new Set(
            (existing.bagBatch ? String(existing.bagBatch).split(/\s*,\s*/) : []).filter(Boolean)
          );
          parts.add(bb);
          existing.bagBatch = [...parts].join(', ');
        }
        const bnd = (scanItem.bagNumberDisplay || p.bagNumberDisplay || '').trim();
        if (bnd) {
          const bset = new Set(
            (existing.bagNumberDisplay ? String(existing.bagNumberDisplay).split(/\s*,\s*/) : []).filter(Boolean)
          );
          bset.add(bnd);
          existing.bagNumberDisplay = [...bset].join(', ');
        }
        console.log(`📊 Merged scan: ${scanItem.materialCode} (${scanItem.quantity}kg) into existing record`);
      } else {
        // ❌ KHÁC ÍT NHẤT 1 TRƯỜNG → Tạo dòng mới
        const p = this.rmBagHistory.parseQrPart4(scanItem.importDate);
        const imdStored = p.imdKey || this.normalizeImportDate(scanItem.importDate) || scanItem.importDate || null;
        const bagNumberDisplay = (scanItem.bagNumberDisplay || p.bagNumberDisplay || '').trim();
        consolidatedMap.set(key, {
          factory: this.selectedFactory,
          materialCode: scanItem.materialCode,
          poNumber: scanItem.poNumber,
          location: scanItem.location,
          quantity: scanItem.quantity,
          unit: 'KG',
          exportQuantity: scanItem.quantity,
          ...(this.leExportQty(scanItem.materialCode, scanItem.quantity, scanItem.poNumber) > 0
            ? { leQty: this.leExportQty(scanItem.materialCode, scanItem.quantity, scanItem.poNumber) }
            : {}),
          scanCount: scanItem.scanCount || 1,
          exportDate: scanItem.scanTime,
          exportedBy: scanItem.employeeId || this.batchEmployeeId,
          productionOrder: scanItem.productionOrder,
          employeeId: scanItem.employeeId || this.batchEmployeeId,
          batchNumber: imdStored,
          bagBatch: scanItem.bagBatch || p.bagFractionLabel,
          ...(bagNumberDisplay ? { bagNumberDisplay } : {}),
          scanMethod: 'CAMERA',
          notes: `Batch scan - ${scanItem.productionOrder}`,
          importDate: imdStored,
          createdAt: scanItem.scanTime,
          updatedAt: scanItem.scanTime
        });
        console.log(`📝 New record: ${scanItem.materialCode} | PO: ${scanItem.poNumber} | IMD: ${scanItem.importDate || 'N/A'}`);
      }
    }
    
    console.log(`📊 Consolidated ${this.pendingScanData.length} scans into ${consolidatedMap.size} outbound records`);
    
    // 2. Tạo consolidated outbound records trong batch
    for (const [key, record] of consolidatedMap) {
      const docRef = this.firestore.collection('outbound-materials').doc().ref;
      batch.set(docRef, record);
    }

    // 3. Commit batch outbound records
    console.log(`📦 Committing ${consolidatedMap.size} records to Firebase...`);
    await batch.commit();
    console.log(`✅ Successfully saved ${consolidatedMap.size} outbound records!`);
    this.syncWorkOrderCreatedByFromPendingScans();
    this.markTemLeClExported(this.pendingScanData);
    this.writeLsxLog(this.pendingScanData, 'CAMERA');

    // 4. Update inventory - Chạy SONG SONG không chờ để không làm chậm
    console.log(`📦 Updating inventory in background...`);
    this.updateInventoryInBackground(this.pendingScanData);
  }
  
  // Update inventory trong background, không block UI
  private updateInventoryInBackground(scanData: any[]): void {
    // Group theo materialCode + poNumber + importDate
    const groupedUpdates = new Map<string, any>();
    
    for (const scanItem of scanData) {
      const key = `${scanItem.materialCode}|${scanItem.poNumber}|${scanItem.importDate || 'NOBATCH'}`;
      const bb =
        scanItem.bagBatch || this.rmBagHistory.extractBagLabelFromQrPart4(scanItem.importDate);
      if (groupedUpdates.has(key)) {
        const existing = groupedUpdates.get(key);
        // Không cộng dồn quantity (chỉ cộng số lần scan/bags nếu có)
        existing.quantity = existing.quantity ?? scanItem.quantity;
        existing.exportedBagsDelta = (existing.exportedBagsDelta || 0) + (scanItem.exportedBagsDelta || 0);
        if (bb) {
          const set = new Set(
            (existing.bagBatch ? String(existing.bagBatch).split(/\s*,\s*/) : []).filter(Boolean)
          );
          set.add(bb);
          existing.bagBatch = [...set].join(', ');
        }
      } else {
        groupedUpdates.set(key, {
          materialCode: scanItem.materialCode,
          poNumber: scanItem.poNumber,
          quantity: scanItem.quantity,
          // exportQuantity trong inventory update lấy từ quantity, không cộng dồn
          importDate: scanItem.importDate,
          exportedBagsDelta: scanItem.exportedBagsDelta || 0,
          bagBatch: bb || ''
        });
      }
    }
    
    console.log(`📊 Grouped ${scanData.length} items into ${groupedUpdates.size} inventory updates`);
    
    // Update từng item trong background (không await)
    groupedUpdates.forEach((update, key) => {
      this.updateInventoryExported(
        update.materialCode,
        update.poNumber,
        update.quantity,
        update.importDate,
        update.exportedBagsDelta || 0,
        update.bagBatch || undefined
      ).catch(error => {
        console.error(`⚠️ Background inventory update failed for ${key}:`, error.message);
      });
    });
    
    console.log(`✅ Inventory updates queued in background`);
  }

  // 🔧 SCAN REVIEW MODAL: Xem danh sách scan trước khi lưu
  showScanReview(): void {
    if (this.pendingScanData.length === 0) {
      appAlert('Chưa có dữ liệu scan nào!');
      return;
    }
    this.showScanReviewModal = true;
    console.log(`📋 Showing scan review: ${this.pendingScanData.length} items`);
  }

  closeScanReview(): void {
    this.showScanReviewModal = false;
  }

  async confirmAndSave(): Promise<void> {
    this.showScanReviewModal = false;
    await this.stopBatchScanningMode();
  }

  // 🔧 SỬA LỖI: Scan đơn giản - 1 lần bấm là scan và ghi luôn
  private processBatchScanInput(scannedData: string): void {
    const scannedTrim = (scannedData ?? '').trim();
    if (!scannedTrim) return;

    console.log('🔍 === SIMPLE SCAN PROCESS START ===');
    console.log('🔍 Scanned data:', scannedData);
    console.log('🔍 Scanned (trim):', scannedTrim);
    console.log('🔍 Data length:', scannedTrim.length);
    
    // Clear the input field after processing
    this.scannerBuffer = '';
    
    try {
      // 🔧 LOGIC ĐƠN GIẢN: Xử lý theo thứ tự ưu tiên
      
      // 1. Nếu chưa scan LSX, ưu tiên scan LSX (kiểm tra Work Order phải ở trạng thái Kitting)
      if (!this.isProductionOrderScanned) {
        // Rule: LSX phải bắt đầu bằng KZLSX hoặc LHLSX
        if (this.isValidLsxCode(scannedTrim)) {
          this.checkWorkOrderKittingStatus(this.effLsx(scannedTrim)).then(ok => {
            if (!ok) return;
            this.acceptBatchLsx(this.effLsx(scannedTrim));
            console.log('✅ LSX scanned:', this.batchProductionOrder);
            this.showScanStatus();
            if (this.isProductionOrderScanned && this.isEmployeeIdScanned) {
              this.currentScanStep = 'material';
              console.log('✅ Both LSX and Employee ID scanned, ready for material scanning');
            }
          });
          return;
        } else {
          this.showScanError('Sai LSX. LSX phải bắt đầu bằng KZLSX hoặc LHLSX');
          return;
        }
      }
      
      // 2. Nếu chưa scan Employee ID, ưu tiên scan Employee ID
      if (!this.isEmployeeIdScanned) {
        if (scannedTrim.includes('ASP') || scannedTrim.length <= 10) {
          // 🔧 SỬA LỖI: Chỉ lấy 7 ký tự đầu tiên của mã nhân viên
          const extractedId = scannedTrim.substring(0, 7);
          console.log(`🔍 Auto-detect: Original "${scannedTrim}" → Extracted "${extractedId}"`);
          this.batchEmployeeId = extractedId;
          this.isEmployeeIdScanned = true;
          // 🔧 TỐI ƯU HÓA: Bỏ console.log để tăng tốc độ
          this.showScanStatus();
          
          // 🔧 SỬA LỖI: Cập nhật currentScanStep thành 'material' sau khi scan Employee ID
          if (this.isProductionOrderScanned && this.isEmployeeIdScanned) {
            this.currentScanStep = 'material';
            console.log('✅ Both LSX and Employee ID scanned, ready for material scanning');
          }
          return;
        }
      }
    
      // 3. Nếu đã scan cả LSX và Employee ID, xử lý mã hàng
    if (this.isProductionOrderScanned && this.isEmployeeIdScanned) {
        void this.processBatchMaterialScanAsync(scannedTrim).catch(err => console.error('❌ processBatchMaterialScanAsync', err));
        return;
      }
      
      // 4. Nếu không nhận diện được, thử xử lý theo độ dài
      if (!this.isProductionOrderScanned && !this.isEmployeeIdScanned) {
        if (scannedTrim.length > 10) {
          this.checkWorkOrderKittingStatus(this.effLsx(scannedTrim)).then(ok => {
            if (!ok) return;
            this.acceptBatchLsx(this.effLsx(scannedTrim));
            console.log('✅ LSX detected by length:', this.batchProductionOrder);
            this.showScanStatus();
            if (this.isProductionOrderScanned && this.isEmployeeIdScanned) {
              this.currentScanStep = 'material';
              console.log('✅ Both LSX and Employee ID scanned, ready for material scanning');
            }
          });
          return;
        } else {
          // 🔧 SỬA LỖI: Chỉ lấy 7 ký tự đầu tiên của mã nhân viên
          const extractedId = scannedTrim.substring(0, 7);
          console.log(`🔍 Auto-detect: Original "${scannedTrim}" → Extracted "${extractedId}"`);
          this.batchEmployeeId = extractedId;
          this.isEmployeeIdScanned = true;
          // 🔧 TỐI ƯU HÓA: Bỏ console.log để tăng tốc độ
          this.showScanStatus();
          
          // 🔧 SỬA LỖI: Cập nhật currentScanStep thành 'material' sau khi scan Employee ID
          if (this.isProductionOrderScanned && this.isEmployeeIdScanned) {
            this.currentScanStep = 'material';
            console.log('✅ Both LSX and Employee ID scanned, ready for material scanning');
          }
        }
        return;
      }
      
      // 5. Nếu không xử lý được, hiện thông báo lỗi
      console.log('❌ Không thể xử lý dữ liệu scan:', scannedTrim);
      this.showScanError('Không thể xử lý dữ liệu scan: ' + scannedTrim);
      
    } catch (error) {
      console.error('❌ Error processing scan:', error);
      this.showScanError('Lỗi xử lý scan: ' + error.message);
    }
    
    console.log('🔍 === SIMPLE SCAN PROCESS END ===');
  }

  // Helper methods for scan status
  private showScanStatus(): void {
    console.log('📊 Scan Status:', {
      LSX: this.isProductionOrderScanned ? this.batchProductionOrder : 'Chưa scan',
      Employee: this.isEmployeeIdScanned ? this.batchEmployeeId : 'Chưa scan',
      Ready: this.isProductionOrderScanned && this.isEmployeeIdScanned
    });
    
    // Hiển thị thông báo cho user
    if (this.isProductionOrderScanned && this.isEmployeeIdScanned) {
      this.errorMessage = `✅ Đã scan LSX: ${this.batchProductionOrder} và Employee: ${this.batchEmployeeId}. Bây giờ có thể scan mã hàng để xuất kho.`;
    } else if (this.isProductionOrderScanned) {
      this.errorMessage = `✅ Đã scan LSX: ${this.batchProductionOrder}. Tiếp tục scan mã nhân viên.`;
    } else if (this.isEmployeeIdScanned) {
      this.errorMessage = `✅ Đã scan Employee: ${this.batchEmployeeId}. Tiếp tục scan LSX.`;
    }
  }

  private showScanError(message: string): void {
    console.error('❌ Scan Error:', message);
    this.playScanBeep(false);
    if (!this.isMobile && this.isBatchScanningMode) {
      // Máy tính đang scan: báo đỏ to + 2 tiếng bíp, không chặn bằng hộp thoại
      this.setScanFlash('err', 'Lỗi scan: ' + message);
    } else {
      appAlert('Lỗi scan: ' + message);
    }
    
    // 🔧 AUTO-FOCUS AFTER ERROR: Tự động focus lại scanner input sau khi bấm OK
    setTimeout(() => {
      this.focusScannerInput();
      console.log('📍 Auto-focused scanner input after error');
    }, 100);
  }

  // Process employee ID scan
  private processEmployeeIdScan(scannedData: string): void {
    try {
      console.log('🔍 Processing employee ID scan:', scannedData);
      // Lấy 7 ký tự đầu tiên làm mã nhân viên
      const extractedId = (scannedData || '').toString().substring(0, 7);
      this.batchEmployeeId = extractedId;
      this.isEmployeeIdScanned = !!extractedId;
      if (this.isProductionOrderScanned && this.isEmployeeIdScanned) {
        this.currentScanStep = 'material';
      }
      this.showScanStatus();
      setTimeout(() => this.focusScannerInput(), 0);
    } catch (error: any) {
      console.error('❌ Error processing employee ID scan:', error);
      this.showScanError('Lỗi xử lý mã nhân viên');
    }
  }

  // Scanner input handlers for template
  onScannerKeydown(event: KeyboardEvent): void {
    const input = event.target as HTMLInputElement;
    if (event.key === 'Enter') {
      const value = (input.value || this.scannerBuffer || '').trim();
      this.scannerBuffer = '';
      input.value = '';
      this.processScannerInput(value);
      event.preventDefault();
    }
  }

  onScannerInputBlur(): void {
    if (this.scannerFocusPaused) return;
    if (!this.hasOperatorSession) {
      setTimeout(() => this.focusOperatorSessionInput(), 50);
      return;
    }
    // Chỉ giữ focus khi đang setup LSX/NV hoặc đang phiên scan batch
    if (!this.showScanningSetupModal && !this.isBatchScanningMode) return;
    setTimeout(() => this.focusScannerInput(), 50);
  }

  /** Ưu tiên ô trong modal setup (mobile PDA), rồi hero mobile, rồi desktop toolbar. */
  private resolveScannerInputEl(): HTMLInputElement | null {
    if (!this.hasOperatorSession) {
      return document.getElementById('ob-op-session-input') as HTMLInputElement | null;
    }
    if (this.showScanningSetupModal) {
      const setup = document.getElementById('ob-setup-scanner-input') as HTMLInputElement | null;
      if (setup) return setup;
    }
    if (this.isMobile) {
      const mobile = document.getElementById('ob-m-scanner-input') as HTMLInputElement | null;
      if (mobile) return mobile;
    }
    return document.querySelector<HTMLInputElement>('.scanner-input');
  }

  private focusScannerInput(): void {
    if (this.scannerFocusPaused) return;
    try {
      const el = this.resolveScannerInputEl();
      if (!el) return;
      el.focus({ preventScroll: true });
      el.select?.();
    } catch {}
  }

  private processScannerInput(scannedData: string): void {
    if (!this.hasOperatorSession) {
      this.onOperatorSessionScanned(scannedData);
      return;
    }
    // 🔧 SỬA LỖI: Nếu đang ở modal setup, xử lý riêng
    if (this.showScanningSetupModal) {
      if (this.scanningSetupStep === 'lsx') {
        this.onLSXScanned(scannedData);
      } else if (this.scanningSetupStep === 'employee') {
        this.onEmployeeScanned(scannedData);
      }
      return;
    }
    
    // Route to batch scan processor
    this.processBatchScanInput(scannedData);
  }

  // Persistence helpers safeguard
  private restorePendingFromStorage(): void {
    try {
      const raw = localStorage.getItem('rm1OutboundPending');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          this.pendingScanData = arr;
          console.log(`♻️ Restored ${arr.length} pending scans from storage`);
        }
      }
    } catch {}
  }

  private savePendingToStorage(): void {
    try {
      localStorage.setItem('rm1OutboundPending', JSON.stringify(this.pendingScanData));
    } catch {}
  }

  /** Tồn 1 dòng inventory = đầu kỳ + nhập − xuất − XT (làm tròn 4 số). */
  private invRowStock(d: any): number {
    return Math.round(((Number(d?.openingStock) || 0) + (Number(d?.quantity) || 0) - (Number(d?.exported) || 0) - (Number(d?.xt) || 0)) * 10000) / 10000;
  }

  /** IMD (DDMMYYYY) của tem scan. */
  private scanImdKey(importDate: string | null | undefined): string {
    if (!importDate) return '';
    const { imdKey } = this.parseImdFromQrPart4(importDate);
    return imdKey || this.normalizeImportDate(importDate);
  }

  /**
   * Dòng tồn sẽ bị trừ khi xuất: dòng khớp IMD tem (nhiều dòng cùng IMD → dòng còn tồn nhiều nhất);
   * không khớp IMD → dòng còn tồn nhiều nhất của mã + PO.
   */
  private pickInvDocForExport<T extends { id: string; data(): any }>(docs: T[], importDate?: string | null): T | null {
    if (!docs.length) return null;
    const want = this.scanImdKey(importDate);
    const hits = want
      ? docs.filter((d) => {
        const x = d.data() || {};
        return this.normalizeImportDate(x.importDate) === want || String(x.batchNumber ?? '').trim().startsWith(want);
      })
      : [];
    const pool = hits.length ? hits : docs;
    let best = pool[0];
    let bestStock = this.invRowStock(best.data());
    for (const d of pool) {
      const s = this.invRowStock(d.data());
      if (s > bestStock) { best = d; bestStock = s; }
    }
    return best;
  }

  /**
   * Chặn xuất làm âm tồn: lượng scan + các tem đang chờ lưu trừ vào cùng dòng tồn không được vượt tồn dòng đó.
   * Lỗi đọc tồn (mạng) → không chặn. Mã + PO không có trong tồn → không chặn (không trừ tồn nên không âm).
   */
  private async validateScanStock(
    code: string,
    po: string,
    qty: number,
    importDate: string | null | undefined,
    pending: Array<{ materialCode: string; poNumber: string; quantity: number; importDate?: string | null }>
  ): Promise<{ err: string | null; left: number | null }> {
    const none = { err: null, left: null };
    const c = String(code || '').trim().toUpperCase();
    const p = String(po || '').trim();
    if (!c || !p || p === 'Unknown' || !(qty > 0)) return none;
    let docs: any[] = [];
    try {
      const snap = await this.firestore.collection('inventory-materials', (ref) =>
        ref.where('materialCode', '==', code)
          .where('poNumber', '==', po)
          .where('factory', '==', this.selectedFactory)
      ).get().toPromise();
      docs = snap?.docs || [];
    } catch (e) {
      console.warn('[validateScanStock] đọc tồn lỗi — bỏ qua kiểm tra', e);
      return none;
    }
    const target = this.pickInvDocForExport(docs, importDate);
    if (!target) return none;
    const stock = this.invRowStock(target.data());
    let pend = 0;
    for (const it of pending || []) {
      if (String(it?.materialCode || '').trim().toUpperCase() !== c || String(it?.poNumber || '').trim() !== p) continue;
      if (this.pickInvDocForExport(docs, it.importDate)?.id === target.id) pend += Number(it.quantity) || 0;
    }
    const r4 = (n: number) => Math.round(n * 10000) / 10000;
    const left = r4(stock - pend);
    if (qty <= left + 1e-6) return { err: null, left };
    const fmt = (n: number) => r4(n).toLocaleString('vi-VN');
    const imd = this.normalizeImportDate(target.data()?.importDate);
    const err = `Không cho xuất — sẽ làm âm tồn kho.\n` +
      `${c} · PO ${p}${imd ? ' · IMD ' + imd : ''}: tồn còn ${fmt(Math.max(0, left))}` +
      (pend > 0 ? ` (đã trừ ${fmt(pend)} đang chờ lưu)` : '') +
      `, scan ${fmt(qty)} → ${fmt(left - qty)}.\n` +
      `Kiểm tra lại tem / số lượng, hoặc báo quản lý kho chỉnh tồn (nhập / XT) rồi scan lại.`;
    return { err, left };
  }

  /**
   * Gom số lẻ: sau khi xuất tem, lô chỉ còn lẻ dưới 1 (vd tem 116, lô 116,11 → còn 0,11)
   * và PXK vẫn còn thiếu ít nhất chừng đó → xuất luôn phần lẻ cùng tem. Trả về lượng lẻ cộng thêm (0 = không gom).
   */
  private crumbTopUp(left: number | null, qty: number, pxkRemainAfter: number | null): number {
    if (left == null || pxkRemainAfter == null) return 0;
    const r4 = (n: number) => Math.round(n * 10000) / 10000;
    const crumb = r4(left - qty);
    if (!(crumb > 0.00005) || crumb >= 1) return 0;
    // Lẻ của lô được lệch tối đa 0,005 so với phần PXK thiếu (mức tab Work Order vẫn coi là Đủ)
    if (crumb > r4(pxkRemainAfter) + 0.005) return 0;
    return crumb;
  }

  /** Còn phải xuất theo PXK của mã + PO (đã trừ đã xuất + đang chờ lưu). null = mã không có trên PXK. */
  private pxkRemainFor(materialCode: string, poNumber: string): number | null {
    const codeKey = String(materialCode || '').trim().toUpperCase();
    const poKey = this.normalizePxImportPo(poNumber);
    const pxkQty = this.batchPxkPairs
      .filter(p => p.code === codeKey && p.po && this.pxImportPoMatch(p.po, poKey))
      .reduce((s, p) => s + (Number(p.qty) || 0), 0);
    if (!(pxkQty > 0)) return null;
    let exported = 0;
    this.batchPxkExportedByKey.forEach((qty, key) => {
      const sep = key.indexOf('|');
      const c = sep >= 0 ? key.slice(0, sep) : key;
      const p = sep >= 0 ? key.slice(sep + 1) : '';
      if (c === codeKey && this.pxImportPoMatch(p, poKey)) exported += Number(qty) || 0;
    });
    const pending = (this.pendingScanData || []).reduce((s, item) => {
      if (String(item?.materialCode || '').trim().toUpperCase() !== codeKey) return s;
      if (!this.pxImportPoMatch(this.normalizePxImportPo(item?.poNumber), poKey)) return s;
      return s + (Number(item?.quantity) || 0);
    }, 0);
    return Math.round((pxkQty - exported - pending) * 10000) / 10000;
  }

  /** Dòng PXK thiếu dưới 1 mà tồn mã + PO có lô lẻ < 1 vừa đủ bù (nút Xuất lẻ). */
  scanCrumbLots(r: ScanPxkRow): Array<{ imd: string; po: string; qty: number }> {
    if (!(r.remain > 0.00005) || r.remain >= 1) return [];
    const lots = this.batchPxkInv?.get(this.pxkScanKey(r.code, r.po)) || [];
    const pendingImd = new Set(this.pendingScanData
      .filter((it) => this.pxkScanKey(it?.materialCode, it?.poNumber) === this.pxkScanKey(r.code, r.po))
      .map((it) => this.scanImdKey(it?.importDate)));
    let need = r.remain;
    const out: Array<{ imd: string; po: string; qty: number }> = [];
    for (const l of [...lots].sort((a, b) => a.stock - b.stock)) {
      if (need <= 0.00005) break;
      if (!(l.stock > 0.00005) || l.stock >= 1 || pendingImd.has(l.imd)) continue;
      if (l.stock > need + 0.005) continue; // lô lẻ lệch ≤ 0,005 so với phần thiếu vẫn gom (Đủ)
      out.push({ imd: l.imd, po: l.po || r.po, qty: l.stock });
      need = Math.round((need - l.stock) * 10000) / 10000;
    }
    return out;
  }

  /**
   * Tự làm tròn: vào LSX là tự đưa phần lẻ < 1 còn lại của lô (vừa khớp phần PXK thiếu, lệch ≤ 0,005)
   * vào Vừa scan — lưu cùng các tem khi bấm Done, không cần scan / bấm nút.
   */
  private autoAddScanCrumbs(): void {
    const rows = this.scanPxkProgress.filter((r) => this.scanCrumbLots(r).length > 0);
    if (!rows.length) return;
    const txt = rows.map((r) => `${r.code} +${r.remain}`).join(', ');
    rows.forEach((r) => this.addScanCrumb(r, true));
    this.setScanFlash('ok', `✔ Tự làm tròn số lẻ: ${txt} — đã đưa vào Vừa scan, bấm Done để lưu`);
  }

  private crumbScanItem(r: ScanPxkRow, l: { imd: string; po: string; qty: number }): any {
    return {
      materialCode: r.code, poNumber: l.po, quantity: l.qty, scanCount: 1, importDate: l.imd,
      exportedBagsDelta: 0, bagBatch: '', bagNumberDisplay: '', location: 'N/A',
      productionOrder: this.batchProductionOrder, employeeId: this.batchEmployeeId,
      scanTime: new Date(), scanMethod: 'CAMERA', crumbOnly: true
    };
  }

  /** Nút Xuất lẻ: đưa phần lẻ < 1 của lô vào danh sách Vừa scan (lưu cùng các tem khác). */
  addScanCrumb(r: ScanPxkRow, silent = false): void {
    const lots = this.scanCrumbLots(r);
    if (!lots.length) return;
    for (const l of lots) {
      if (silent) {
        this.pendingScanData = [...this.pendingScanData, this.crumbScanItem(r, l)];
        this.savePendingToStorage();
        continue;
      }
      this.commitScanItem({
        materialCode: r.code,
        poNumber: l.po,
        quantity: l.qty,
        scanCount: 1,
        importDate: l.imd,
        exportedBagsDelta: 0,
        bagBatch: '',
        bagNumberDisplay: '',
        location: 'N/A',
        productionOrder: this.batchProductionOrder,
        employeeId: this.batchEmployeeId,
        scanTime: new Date(),
        scanMethod: 'CAMERA',
        crumbOnly: true
      }, ' · xuất số lẻ của lô');
    }
  }

  // Minimal fallback to avoid compile break if missing
  private async updateInventoryExported(
    materialCode: string,
    poNumber: string,
    exportQuantity: number,
    importDate?: string,
    exportedBagsDelta: number = 0,
    bagBatch?: string
  ): Promise<void> {
    try {
      console.log(`📦 Updating inventory exported: ${materialCode}, PO: ${poNumber}, Qty: ${exportQuantity}, Batch: ${importDate}, BagsDelta: ${exportedBagsDelta}`);
      
      // 🔧 KHÔNG DÙNG where('importDate') vì format có thể khác nhau
      // Query tất cả records của materialCode + poNumber, sau đó filter client-side
      const snapshot = await this.firestore.collection('inventory-materials', ref =>
        ref.where('materialCode', '==', materialCode)
           .where('poNumber', '==', poNumber)
           .where('factory', '==', this.selectedFactory)
      ).get().toPromise();
      
      if (snapshot && !snapshot.empty) {
        console.log(`📦 Found ${snapshot.docs.length} inventory records for ${materialCode} - PO ${poNumber}`);
        
        // Dòng trừ: khớp IMD tem; không khớp → dòng còn tồn nhiều nhất (tồn = đầu kỳ + nhập − xuất − XT)
        const targetDoc = this.pickInvDocForExport(snapshot.docs, importDate)!;
        
        // Update inventory — atomic increment (tránh race khi nhiều scan cùng lúc cùng một dòng tồn).
        const data = targetDoc.data() as any;
        const currentExported = Number(data.exported) || 0;
        const newExported = currentExported + exportQuantity;

        let imdForRow = '';
        if (importDate) {
          const { imdKey } = this.parseImdFromQrPart4(importDate);
          imdForRow = imdKey || this.normalizeImportDate(importDate);
        } else {
          imdForRow = this.normalizeImportDate(data.importDate);
        }
        const totalB = Math.floor(Number(data.totalBags ?? 0));
        const prevExpBags = Math.floor(Number(data.exportedBags ?? 0));
        const newExpBags = prevExpBags + (exportedBagsDelta > 0 ? exportedBagsDelta : 0);
        const remainingB = Math.max(0, totalB - newExpBags);
        
        console.log(
          `🔄 Updating inventory doc ${targetDoc.id}: exported += ${exportQuantity} (atomic; snapshot was ${currentExported} → ~${newExported})`
        );
        
        const payload: Record<string, unknown> = {
          exported: firebase.default.firestore.FieldValue.increment(exportQuantity),
          updatedAt: new Date()
        };
        const leQty = this.leExportQty(materialCode, exportQuantity, poNumber);
        if (leQty > 0) {
          payload.xtLe = firebase.default.firestore.FieldValue.increment(leQty);
        }
        if (exportedBagsDelta > 0) {
          payload.exportedBags = firebase.default.firestore.FieldValue.increment(exportedBagsDelta);
        }
        await this.firestore.collection('inventory-materials').doc(targetDoc.id).update(payload);

        if (exportedBagsDelta > 0) {
          const imd = imdForRow || this.normalizeImportDate(data.importDate);
          const p = this.rmBagHistory.parseQrPart4(importDate);
          const bagNumberDisplay = (p.bagNumberDisplay || '').trim();
          await this.rmBagHistory.log({
            event: 'XUẤT',
            factory: this.selectedFactory,
            materialCode,
            poNumber,
            imd,
            totalBags: totalB,
            exportedBags: newExpBags,
            remainingBags: remainingB,
            bagsDelta: exportedBagsDelta,
            bagBatch: bagBatch || this.rmBagHistory.extractBagLabelFromQrPart4(importDate),
            ...(bagNumberDisplay ? { bagNumberDisplay } : {}),
            inventoryDocId: targetDoc.id,
            note: 'Xuất bịch (QR -i/n)'
          });
          await this.rmBagHistory.log({
            event: 'TỒN',
            factory: this.selectedFactory,
            materialCode,
            poNumber,
            imd,
            totalBags: totalB,
            exportedBags: newExpBags,
            remainingBags: remainingB,
            bagBatch: bagBatch || this.rmBagHistory.extractBagLabelFromQrPart4(importDate),
            ...(bagNumberDisplay ? { bagNumberDisplay } : {}),
            inventoryDocId: targetDoc.id,
            note: 'Tồn bịch sau xuất'
          });
        }
        
        console.log(`✅ Inventory updated: ${materialCode} - PO ${poNumber}, exported: ${newExported}`);
      } else {
        console.log(`⚠️ No inventory record found for ${materialCode} - PO ${poNumber}`);
        console.log(`⚠️ Skipping inventory update (material may not exist in inventory)`);
      }
    } catch (error) {
      console.error(`❌ Error updating inventory exported:`, error);
      // Không throw error để không block batch update của các item khác
      console.log(`⚠️ Continuing batch update despite inventory update error`);
    }
  }
  
  /** Phần 4 QR: DDMMYYYY, DDMMYYYY-i/tổng, có thể (T1) tách bịch — khớp IMD kho; có i/tổng → +1 bịch. */
  private parseImdFromQrPart4(part4: string | null | undefined): { imdKey: string; bagDelta: number } {
    const p = this.rmBagHistory.parseQrPart4(part4);
    if (p.imdKey) {
      return { imdKey: p.imdKey, bagDelta: p.bagDelta };
    }
    const s = (part4 ?? '').trim();
    return { imdKey: s ? this.normalizeImportDate(s) : '', bagDelta: 0 };
  }

  // Chuẩn hóa importDate về format DDMMYYYY để so sánh
  private normalizeImportDate(importDate: any): string {
    if (!importDate) return '';
    
    // Nếu đã là string DDMMYYYY (8 ký tự số)
    if (typeof importDate === 'string' && /^\d{8}$/.test(importDate)) {
      return importDate;
    }
    
    // Nếu là Date object
    if (importDate instanceof Date || importDate.toDate) {
      const date = importDate.toDate ? importDate.toDate() : importDate;
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const year = date.getFullYear();
      return `${day}${month}${year}`;
    }
    
    // Nếu là string format khác (YYYY-MM-DD, DD/MM/YYYY, etc.)
    if (typeof importDate === 'string') {
      // Thử parse các format phổ biến
      const formats = [
        /^(\d{2})\/(\d{2})\/(\d{4})$/,  // DD/MM/YYYY
        /^(\d{4})-(\d{2})-(\d{2})$/,    // YYYY-MM-DD
        /^(\d{2})-(\d{2})-(\d{4})$/     // DD-MM-YYYY
      ];
      
      for (const format of formats) {
        const match = importDate.match(format);
        if (match) {
          if (format.source.startsWith('^\\(\\d{4}')) {
            // YYYY-MM-DD
            return `${match[3]}${match[2]}${match[1]}`;
          } else {
            // DD/MM/YYYY or DD-MM-YYYY
            return `${match[1]}${match[2]}${match[3]}`;
          }
        }
      }
    }
    
    console.log(`⚠️ Cannot normalize importDate: ${importDate}`);
    return String(importDate);
  }

  // Queue for rapid scans
  // duplicate declarations removed here (already declared above)
  // private isProcessingMaterialScan: boolean = false;
  // private materialScanQueue: string[] = [];

  private enqueueMaterialScan(scannedData: string): void {
    if (!scannedData || !scannedData.trim()) return;
    this.materialScanQueue.push(scannedData);
    if (!this.isProcessingMaterialScan) {
      this.processMaterialScanQueue();
    }
  }

  private processMaterialScanQueue(): void {
    if (this.isProcessingMaterialScan) return;
    const next = this.materialScanQueue.shift();
    if (!next) return;
    this.isProcessingMaterialScan = true;
    void this.processBatchMaterialScanAsync(next)
      .catch(err => console.error('❌ processBatchMaterialScanAsync', err))
      .finally(() => {
        this.isProcessingMaterialScan = false;
        setTimeout(() => this.processMaterialScanQueue(), 0);
      });
  }

  /** Scan xuất NL: mã + PO phải khớp PXK của LSX đang scan. Sai thì từ chối, không ghi nhận. */
  private async validateScanMatchesLsxPxk(materialCode: string, poNumber: string): Promise<string | null> {
    await this.ensureBatchPxkLoaded();
    const lsx = (this.batchProductionOrder || '').trim();
    if (!lsx) {
      return 'Phải scan LSX trước khi xuất nguyên liệu.';
    }
    if (this.batchPxkPairs.length === 0) {
      return `LSX ${lsx} chưa có PXK — không cho xuất.`;
    }
    const codeKey = materialCode.trim().toUpperCase();
    const poKey = this.normalizePxImportPo(poNumber);
    const linesForCode = this.batchPxkPairs.filter(p => p.code === codeKey);
    if (linesForCode.length === 0) {
      return `Sai mã hàng: ${materialCode} không có trong LSX ${lsx} — từ chối.`;
    }
    const poOk = linesForCode.some(p => p.po && this.pxImportPoMatch(p.po, poKey));
    if (!poOk) {
      return `Sai PO: mã ${materialCode} PO ${poNumber} không khớp LSX ${lsx} — từ chối.`;
    }
    return null;
  }

  /**
   * Một lần scan không được dư SL so với phần còn lại của PXK (PXK − đã xuất − đang pending).
   * Không cắt tem / không ghi nhận phần dư.
   */
  private validateScanQtyVsPxkRemaining(materialCode: string, poNumber: string, scanQty: number): string | null {
    const codeKey = String(materialCode || '').trim().toUpperCase();
    const poKey = this.normalizePxImportPo(poNumber);
    const q = Number(scanQty);
    if (!(q > 0)) {
      return `Số lượng quét không hợp lệ: ${scanQty}`;
    }
    const pxkQty = this.batchPxkPairs
      .filter(p => p.code === codeKey && p.po && this.pxImportPoMatch(p.po, poKey))
      .reduce((s, p) => s + (Number(p.qty) || 0), 0);
    if (!(pxkQty > 0)) {
      return null;
    }
    let exported = 0;
    this.batchPxkExportedByKey.forEach((qty, key) => {
      const sep = key.indexOf('|');
      const c = sep >= 0 ? key.slice(0, sep) : key;
      const p = sep >= 0 ? key.slice(sep + 1) : '';
      if (c === codeKey && this.pxImportPoMatch(p, poKey)) {
        exported += Number(qty) || 0;
      }
    });
    const pending = (this.pendingScanData || []).reduce((s, item) => {
      const ic = String(item?.materialCode || '').trim().toUpperCase();
      if (ic !== codeKey) return s;
      if (!this.pxImportPoMatch(this.normalizePxImportPo(item?.poNumber), poKey)) return s;
      return s + (Number(item?.quantity) || 0);
    }, 0);
    const decimal = isRmQtyDecimalFactory(this.selectedFactory);
    const remain = decimal ? roundRmQty(pxkQty - exported - pending, RM_QTY_DECIMALS_4) : pxkQty - exported - pending;
    if (q > remain + (decimal ? 0.001 : 1e-9)) {
      const fmt = (n: number) => n.toLocaleString('vi-VN');
      const remainShow = Math.max(0, remain);
      return (
        `Từ chối: số lượng quét ${fmt(q)} dư so với còn lại ${fmt(remainShow)}.\n` +
        `PXK ${fmt(pxkQty)} — đã xuất ${fmt(exported)} — đang scan ${fmt(pending)}.\n` +
        `Không cho xuất dư trong 1 lần scan.`
      );
    }
    return null;
  }

  /** Parse và ghi pending — có kiểm QC rule (IQC) trên inventory khớp vật tư. */
  private async processBatchMaterialScanAsync(scannedData: string): Promise<void> {
    if (!this.isProductionOrderScanned || !this.isEmployeeIdScanned) {
      this.showScanError('Phải scan LSX và mã nhân viên trước!');
      return;
    }
    if (this.oddWeigh) {
      this.showScanError(`Đang chờ chụp hình + nhập trọng lượng bag lẻ ${this.oddWeigh.code}. Lưu hoặc Hủy trước khi scan tiếp.`);
      return;
    }
    if (this.clCount) {
      this.showScanError(`Đang chờ nhập số đếm bag CL ${this.clCount.code}. Xác nhận hoặc Hủy trước khi scan tiếp.`);
      return;
    }
    if (this.tlPhoto) {
      this.showScanError(`Đang chờ chụp hình bag ${this.tlPhoto.tag} của ${this.tlPhoto.code}. Chụp hoặc Hủy trước khi scan tiếp.`);
      return;
    }
    let materialCode = '';
    let poNumber = '';
    let quantity = 1;
    let importDate: string | null = null;
    const text = (scannedData || '').trim();
    let isTemThung = false;
    if (text.includes('|')) {
      const parts = text.replace(/\s*\|\s*/g, '|').split('|');
      if (parts.length >= 3) {
        const stripped = stripTemThungMarker(parts[0]);
        isTemThung = stripped.isTemThung;
        materialCode = stripped.materialCode;
        poNumber = parts[1].trim();
        quantity = this.parseScanQty(parts[2]);
        if (parts.length >= 4) importDate = parts[3].trim();
      }
    } else {
      const stripped = stripTemThungMarker(text);
      isTemThung = stripped.isTemThung;
      materialCode = stripped.materialCode;
      poNumber = 'Unknown';
      quantity = 1;
    }
    if (!materialCode) {
      this.showScanError('Không thể đọc mã hàng từ dữ liệu scan!');
      return;
    }

    // Đọc tồn song song với các kiểm tra khác (không cộng thêm thời gian chờ)
    const stockCheck = this.validateScanStock(materialCode, poNumber, quantity, importDate, this.pendingScanData);

    const lsxMatchErr = await this.validateScanMatchesLsxPxk(materialCode, poNumber);
    if (lsxMatchErr) {
      this.showScanError(lsxMatchErr);
      return;
    }

    const pxkQtyErr = this.validateScanQtyVsPxkRemaining(materialCode, poNumber, quantity);
    if (pxkQtyErr) {
      this.showScanError(pxkQtyErr);
      return;
    }

    const stockRes = await stockCheck;
    if (stockRes.err) {
      this.showScanError(stockRes.err);
      return;
    }
    // Gom số lẻ < 1 còn lại của lô (tem in số tròn, lô có lẻ) nếu PXK còn thiếu chừng đó
    const pxkRemainNow = this.pxkRemainFor(materialCode, poNumber);
    const crumbQty = this.crumbTopUp(stockRes.left, quantity, pxkRemainNow == null ? null : pxkRemainNow - quantity);
    if (crumbQty > 0) quantity = Math.round((quantity + crumbQty) * 10000) / 10000;

    if (isTemThung && !this.allowExportByCartonSet.has(materialCode.trim().toUpperCase())) {
      this.showScanError(`Mã ${materialCode} không nằm trong danh mục Xuất thùng — không thể xuất bằng Tem Thùng.`);
      return;
    }

    await this.ensureLotStd(materialCode);
    const packErr = this.validateScanQtyVsStandardPacking(materialCode, quantity, poNumber);
    if (packErr) {
      this.showScanError(packErr);
      return;
    }

    // Rule: Không được trùng bộ 3 (Mã hàng + Số PO + IMD)
    const imdKey = (importDate ?? '').trim();
    const isDuplicate = this.pendingScanData.some(item =>
      String(item?.materialCode ?? '').trim() === materialCode &&
      String(item?.poNumber ?? '').trim() === poNumber &&
      String(item?.importDate ?? '').trim() === imdKey
    );
    if (isDuplicate) {
      this.showScanError('Trùng tem và scan lại');
      return;
    }

    const qc = await this.outboundQcRule.shouldBlockOutbound(
      this.selectedFactory,
      this.qcRuleEnabledActive,
      this.qcRuleBlockedList,
      materialCode,
      poNumber,
      importDate
    );
    if (qc.block) {
      this.showScanError(
        `Không cho xuất kho: IQC Status = ${qc.iqc ?? '—'} (trùng QC rule).`
      );
      return;
    }

    // Week trên tem: ngoài hạn dùng theo khách của LSX → chặn; mã theo dõi Week mà lô chưa có Week → cảnh báo
    const weekErr = await this.checkScanWeek(materialCode, poNumber, importDate);
    if (weekErr) {
      this.showScanError(weekErr);
      return;
    }

    // Kiểm tra vị trí hiện tại của mã hàng — nếu bắt đầu bằng IQC thì cảnh báo
    await this.checkAndWarnIqcLocation(materialCode, poNumber, importDate, this.selectedFactory);

    const p = this.rmBagHistory.parseQrPart4(importDate);
    const exportedBagsDelta = p.bagDelta;
    const bagBatch = p.bagFractionLabel || this.rmBagHistory.extractBagLabelFromQrPart4(importDate);
    const bagNumberDisplay = p.bagNumberDisplay || '';
    const scanItem = {
      materialCode,
      poNumber,
      quantity,
      scanCount: 1,
      importDate,
      exportedBagsDelta,
      bagBatch,
      bagNumberDisplay,
      location: 'N/A',
      productionOrder: this.batchProductionOrder,
      employeeId: this.batchEmployeeId,
      scanTime: new Date(),
      scanMethod: 'CAMERA',
      ...(crumbQty > 0 ? { crumbQty } : {})
    };

    // Bag CL (lẻ) duy nhất còn lại của mã PCS, tồn mã < 5000 → bắt đếm chính xác bag còn lại
    let clNeed: ClCountCtx | null = null;
    try {
      clNeed = await this.findClCountNeed(materialCode, poNumber, importDate, quantity, stockRes.left);
    } catch (e) {
      console.warn('findClCountNeed:', e);
    }
    if (clNeed) {
      this.openClCount(clNeed, () => this.continueScanAfterClCount(scanItem, p));
      return;
    }
    await this.continueScanAfterClCount(scanItem, p);
  }

  /** Bước sau khi qua kiểm đếm bag CL: Check lượng bag lẻ (nếu có) rồi nhận tem. */
  private async continueScanAfterClCount(scanItem: any, p: any): Promise<void> {
    const { materialCode, poNumber, quantity } = scanItem;
    // Bag lẻ của mã Check lượng → bắt chụp hình + nhập trọng lượng rồi mới nhận bag
    let odd: OddWeighCtx | null = null;
    try {
      odd = await this.findOddWeighNeed(materialCode, poNumber, quantity);
    } catch (e: any) {
      console.warn('findOddWeighNeed:', e);
      this.showScanError(`Không kiểm tra được Check lượng cho ${materialCode}. Scan lại.`);
      return;
    }
    const tl = this.tlTagOf(scanItem.importDate);
    if (odd && tl && p.imdKey) {
      const suffix = await this.inheritOddWeighFromSplit(odd, p.imdKey, tl.tag);
      if (suffix != null) {
        // Đã cân lúc tách — vẫn bắt buộc chụp hình bag TL khi xuất
        this.openTlPhoto(materialCode, poNumber, tl, async () => this.commitScanItem(scanItem, suffix + ' · đã chụp TL'));
        return;
      }
    }
    if (odd) {
      // Popup cân bag lẻ đã bắt chụp hình → không chụp TL lần 2
      this.openOddWeigh(odd, scanItem);
      return;
    }
    if (tl) {
      this.openTlPhoto(materialCode, poNumber, tl, async () => this.commitScanItem(scanItem, ' · đã chụp TL'));
      return;
    }
    this.commitScanItem(scanItem);
  }

  // ===== Bag TL khi xuất: bắt buộc chụp hình (mọi cách xuất, mọi thiết bị) =====
  tlPhoto: {
    code: string; po: string; tag: string; imd: string;
    cont: () => Promise<void>; onCancel?: () => void;
    cameraOn: boolean; photo: Blob | null; preview: string; busy: boolean; err: string;
  } | null = null;
  @ViewChild('tlPhotoVideo') tlPhotoVideoRef?: ElementRef<HTMLVideoElement>;
  private tlPhotoStream: MediaStream | null = null;

  /** Tem TL (phần tách đem xuất) → {tag, imd}; tem khác → null. */
  private tlTagOf(part4: string | null | undefined): { tag: string; imd: string } | null {
    const p = this.rmBagHistory.parseQrPart4(part4 || '');
    return p.splitTag && p.splitTag.toUpperCase().startsWith('TL') ? { tag: p.splitTag, imd: p.imdKey || '' } : null;
  }

  private openTlPhoto(code: string, po: string, tl: { tag: string; imd: string }, cont: () => Promise<void>, onCancel?: () => void): void {
    this.tlPhoto = {
      code: String(code || '').trim().toUpperCase(), po: String(po || '').trim(), tag: tl.tag, imd: tl.imd,
      cont, onCancel, cameraOn: false, photo: null, preview: '', busy: false, err: ''
    };
    this.playScanBeep(false);
    this.cdr.markForCheck();
    setTimeout(() => void this.startTlPhotoCamera(), 60);
  }

  async startTlPhotoCamera(): Promise<void> {
    const t = this.tlPhoto;
    if (!t) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      t.err = 'Thiết bị không mở được camera trên trình duyệt — bấm "Chọn / chụp ảnh" để chụp bằng camera máy.';
      this.cdr.markForCheck();
      return;
    }
    try {
      if (!this.tlPhotoStream || !this.tlPhotoStream.getVideoTracks().some((x) => x.readyState === 'live')) {
        this.tlPhotoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      }
      const video = this.tlPhotoVideoRef?.nativeElement;
      if (!video || this.tlPhoto !== t) { this.stopTlPhotoCamera(); return; }
      video.srcObject = this.tlPhotoStream;
      await video.play().catch(() => undefined);
      t.cameraOn = true;
      t.err = '';
    } catch (e: any) {
      t.err = 'Không mở được camera: ' + (e?.message || e) + ' — bấm "Chọn / chụp ảnh".';
    }
    this.cdr.markForCheck();
  }

  private stopTlPhotoCamera(): void {
    try { this.tlPhotoStream?.getTracks().forEach((x) => x.stop()); } catch { /* bỏ qua */ }
    this.tlPhotoStream = null;
    const video = this.tlPhotoVideoRef?.nativeElement;
    if (video) video.srcObject = null;
    if (this.tlPhoto) this.tlPhoto.cameraOn = false;
  }

  async captureTlPhoto(): Promise<void> {
    const t = this.tlPhoto;
    const video = this.tlPhotoVideoRef?.nativeElement;
    if (!t || !video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    this.stopTlPhotoCamera();
    await this.setTlPhoto(await this.pxkOddWeigh.compressPhoto(canvas));
  }

  async onTlPhotoFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.tlPhoto) return;
    try {
      this.stopTlPhotoCamera();
      await this.setTlPhoto(await this.pxkOddWeigh.compressPhoto(file));
    } catch (e: any) {
      this.tlPhoto.err = e?.message || 'Không đọc được ảnh.';
    }
    this.cdr.markForCheck();
  }

  private async setTlPhoto(blob: Blob): Promise<void> {
    const t = this.tlPhoto;
    if (!t) return;
    if (t.preview) URL.revokeObjectURL(t.preview);
    t.photo = blob;
    t.preview = URL.createObjectURL(blob);
    t.err = '';
    this.cdr.markForCheck();
  }

  retakeTlPhoto(): void {
    const t = this.tlPhoto;
    if (!t) return;
    if (t.preview) URL.revokeObjectURL(t.preview);
    t.photo = null;
    t.preview = '';
    void this.startTlPhotoCamera();
  }

  async confirmTlPhoto(): Promise<void> {
    const t = this.tlPhoto;
    if (!t || t.busy) return;
    if (!t.photo) { t.err = 'Bắt buộc chụp hình bag TL trước khi xuất.'; return; }
    t.busy = true;
    t.err = '';
    this.cdr.markForCheck();
    try {
      const by = String(this.batchEmployeeId || this.operatorSessionId || '').trim().toUpperCase();
      const lsx = String(this.batchProductionOrder || (this.bsScanItem as any)?.lsx || '').trim();
      const up = await this.pxkOddWeigh.uploadPhoto(this.selectedFactory, 'tl-export',
        `${t.code}_${t.tag}_${Date.now()}`.replace(/[^A-Za-z0-9_-]/g, '_'), t.photo);
      await this.firestore.firestore.collection('outbound-tl-photos').add({
        factory: this.selectedFactory, materialCode: t.code, poNumber: t.po, imd: t.imd, tlTag: t.tag,
        productionOrder: lsx, employeeId: by, photoUrl: up.url, photoPath: up.path, at: new Date()
      });
    } catch (e: any) {
      t.busy = false;
      t.err = 'Không lưu được hình: ' + (e?.message || e) + ' — thử lại.';
      this.cdr.markForCheck();
      return;
    }
    const cont = t.cont;
    if (t.preview) URL.revokeObjectURL(t.preview);
    this.stopTlPhotoCamera();
    this.tlPhoto = null;
    await cont();
    this.cdr.markForCheck();
  }

  cancelTlPhoto(): void {
    const t = this.tlPhoto;
    if (!t || t.busy) return;
    if (t.preview) URL.revokeObjectURL(t.preview);
    this.stopTlPhotoCamera();
    this.tlPhoto = null;
    t.onCancel?.();
    if (this.bsScanOpen) this.bsScanError = `❌ Đã hủy tem ${t.tag} — chưa chụp hình bag TL nên chưa nhận.`;
    else this.showScanError(`Đã hủy tem ${t.code} ${t.tag} — chưa chụp hình bag TL nên chưa nhận tem.`);
  }

  // ===== Đếm bag CL: bag lẻ duy nhất còn lại của mã PCS (tồn mã < 5000) =====
  static readonly CL_COUNT_MAX_STOCK = 5000;
  clCount: (ClCountCtx & { cont: () => Promise<void>; onCancel?: () => void; input: string; busy: boolean; err: string; reportOpen?: boolean }) | null = null;

  /** Lý do báo cáo bỏ qua đếm bag CL (không đếm được). */
  readonly clSkipReasons = ['Dạng cuộn', 'Nhiều bộ phận', 'Dạng vỉ'];
  /** Mã đã báo không đếm được (cl-count-skip/{mã}) → lần sau không hỏi đếm nữa. */
  private clSkipCodes: Set<string> | null = null;

  private async ensureClSkipCodes(): Promise<Set<string>> {
    if (this.clSkipCodes) return this.clSkipCodes;
    const set = new Set<string>();
    try {
      const snap = await this.firestore.firestore.collection('cl-count-skip').get();
      snap.forEach((d) => set.add(d.id.toUpperCase()));
    } catch (e) { console.warn('[CL count] skip list', e); }
    this.clSkipCodes = set;
    return set;
  }

  /** Báo cáo: chọn lý do (dạng cuộn / nhiều bộ phận / dạng vỉ) → bỏ qua đếm, nhận tem luôn; mã này lần sau không hỏi. */
  async reportClSkip(reason: string): Promise<void> {
    const c = this.clCount;
    if (!c || c.busy) return;
    c.busy = true;
    try {
      const db = this.firestore.firestore;
      const now = new Date();
      await db.collection('outbound-cl-counts').add({
        factory: this.selectedFactory, materialCode: c.code, poNumber: c.po, imd: c.imd,
        productionOrder: this.batchProductionOrder || '', employeeId: this.batchEmployeeId || '',
        unit: c.unit, systemQty: c.oddQty, countedQty: null, skipped: true, reason,
        lotRemainAfter: c.remainAfter, codeStockAfter: c.totalAfter, at: now
      });
      await db.collection('cl-count-skip').doc(c.code).set({
        materialCode: c.code, reason, by: this.batchEmployeeId || '', factory: this.selectedFactory, at: now
      }, { merge: true });
      (await this.ensureClSkipCodes()).add(c.code);
    } catch (e) {
      console.warn('[CL count] báo cáo không lưu được:', e);
    }
    const cont = c.cont;
    this.clCount = null;
    await cont();
    this.setScanFlash('ok', `✔ ${c.code}: báo cáo "${reason}" — bỏ qua đếm bag CL.`);
    this.cdr.markForCheck();
  }

  /** Mở ô cam đếm bag CL; xác nhận → chạy tiếp `cont`, hủy → `onCancel`. */
  private openClCount(ctx: ClCountCtx, cont: () => Promise<void>, onCancel?: () => void): void {
    this.clCount = { ...ctx, cont, onCancel, input: '', busy: false, err: '' };
    this.cdr.markForCheck();
    setTimeout(() => (document.getElementById('cl-count-input') as HTMLInputElement | null)?.focus(), 80);
  }

  private isPcsUnit(code: string): boolean {
    const u = String((this.catalogByCode.get(code) as any)?.unit || '').trim().toUpperCase();
    return /^(PCS|PC|EA|CÁI|CAI|CHIẾC|CHIEC)$/.test(u);
  }

  /**
   * Sau tem này lô còn bag lẻ (CL) — và đó là bag lẻ duy nhất của mã (các lô khác chẵn Standard),
   * mã đơn vị cái (PCS), tổng tồn mã sau xuất < 5000 → cần đếm chính xác.
   */
  private async findClCountNeed(
    materialCode: string, poNumber: string, importDate: string | null, qty: number, left: number | null,
    pendingOverride?: number
  ): Promise<ClCountCtx | null> {
    const code = String(materialCode || '').trim().toUpperCase();
    if (!code || left == null || !this.isPcsUnit(code)) return null;
    if ((await this.ensureClSkipCodes()).has(code)) return null; // đã báo cáo không đếm được (cuộn / nhiều bộ phận / vỉ)
    const r4 = (n: number) => Math.round(n * 10000) / 10000;
    const EPS = 0.0001;
    const std = this.stdFor(code, poNumber);
    const remainAfter = r4(left - qty);
    if (!(std > 0) || !(remainAfter > EPS)) return null;
    const oddAfter = r4(remainAfter - Math.floor(r4(remainAfter / std)) * std);
    if (!(oddAfter > EPS)) return null;
    const snap = await this.firestore.firestore.collection('inventory-materials').where('materialCode', '==', materialCode).get();
    const docs = snap.docs.filter((d) => String((d.data() as any)?.factory || '') === this.selectedFactory);
    const samePo = docs.filter((d) => String((d.data() as any)?.poNumber || '').trim() === String(poNumber || '').trim());
    const target = this.pickInvDocForExport(samePo, importDate);
    let total = 0;
    for (const d of docs) {
      const x = d.data() as any;
      const st = this.invRowStock(x);
      if (st <= EPS) continue;
      total += st;
      if (target && d.id === target.id) continue;
      const sp = Number(x.lotStandardPacking) || this.stdFor(code, x.poNumber);
      if (sp > 0 && r4(st - Math.floor(r4(st / sp)) * sp) > EPS) return null; // còn bag lẻ khác
    }
    const pendingCode = pendingOverride ?? this.pendingScanData
      .filter((it) => String(it?.materialCode || '').trim().toUpperCase() === code)
      .reduce((n, it) => n + (Number(it?.quantity) || 0), 0);
    const totalAfter = r4(total - pendingCode - qty);
    if (totalAfter >= OutboundComponent.CL_COUNT_MAX_STOCK) return null;
    const unit = String((this.catalogByCode.get(code) as any)?.unit || 'PCS').trim();
    return { code, po: String(poNumber || '').trim(), imd: this.scanImdKey(importDate), oddQty: oddAfter, remainAfter, totalAfter, unit };
  }

  async confirmClCount(): Promise<void> {
    const c = this.clCount;
    if (!c || c.busy) return;
    const raw = String(c.input ?? '').trim().replace(',', '.');
    const counted = Number(raw);
    if (raw === '' || !Number.isFinite(counted) || counted < 0) {
      c.err = 'Nhập số lượng thực tế còn lại của bag (≥ 0).';
      return;
    }
    c.busy = true;
    c.err = '';
    const diff = Math.round((counted - c.oddQty) * 10000) / 10000;
    try {
      await this.firestore.firestore.collection('outbound-cl-counts').add({
        factory: this.selectedFactory, materialCode: c.code, poNumber: c.po, imd: c.imd,
        productionOrder: this.batchProductionOrder || '', employeeId: this.batchEmployeeId || '',
        unit: c.unit, systemQty: c.oddQty, countedQty: counted, diff, lotRemainAfter: c.remainAfter, codeStockAfter: c.totalAfter,
        at: new Date()
      });
    } catch (e) {
      console.warn('[CL count] không lưu được:', e);
    }
    const cont = c.cont;
    this.clCount = null;
    await cont();
    if (Math.abs(diff) > 0.0001) {
      this.setScanFlash('err', `⚠ Bag CL ${c.code}: đếm ${counted} — hệ thống ${c.oddQty} (lệch ${diff > 0 ? '+' : ''}${diff}). Đã ghi nhận, báo quản lý kho kiểm tồn.`);
    }
    this.cdr.markForCheck();
  }

  cancelClCount(): void {
    const c = this.clCount;
    this.clCount = null;
    if (!c) return;
    c.onCancel?.();
    this.showScanError(`Đã hủy tem ${c.code} — chưa đếm bag CL nên chưa nhận tem.`);
  }

  /** Tem TL đã cân + chụp lúc tách tem lẻ → ghi Check lượng PXK luôn, không cân lại. null = chưa có kết quả cân. */
  private async inheritOddWeighFromSplit(ctx: OddWeighCtx, imd: string, tlTag: string): Promise<string | null> {
    try {
      const tl = await this.temLeCl.getTlWeigh(this.selectedFactory, ctx.code, ctx.po, imd, tlTag);
      if (!tl || !tl.photoUrl || !(tl.gwBagFull > 0)) return null;
      const res = await this.pxkOddWeigh.saveFromSplit({
        lsx: ctx.lsx, materialCode: ctx.code, po: ctx.po, maKho: ctx.maKho,
        exportQty: ctx.exportQty, standard: ctx.std, tl
      });
      const pct = res.percent == null ? '' : ` ${(Math.round(res.percent * 10) / 10).toFixed(1)}% ${res.ok ? 'OK' : 'KHÔNG ĐẠT (lệch > ±5%)'}`;
      return ` · đã cân lúc tách ${tlTag}${pct}`;
    } catch (e) {
      console.warn('inheritOddWeighFromSplit:', e);
      return null;
    }
  }

  private commitScanItem(scanItem: any, flashSuffix = ''): void {
    this.pendingScanData = [...this.pendingScanData, scanItem];
    this.savePendingToStorage();
    this.playScanBeep(true);
    const { materialCode, poNumber, importDate, quantity, bagBatch } = scanItem;
    const crumbTxt = (scanItem?.crumbQty > 0 ? ` (gồm ${scanItem.crumbQty} số lẻ của lô)` : '')
      + ((Number((this.catalogByCode.get(String(materialCode || '').trim().toUpperCase()) as any)?.boPhan) || 0) > 0
        ? ` · ${Number((this.catalogByCode.get(String(materialCode || '').trim().toUpperCase()) as any)?.boPhan)} bộ phận` : '');
    this.setScanFlash('ok', `✔ ${materialCode} · PO ${poNumber} · ${bagBatch || importDate || ''} · ${quantity}${crumbTxt}${flashSuffix}`);
    this.identifyScannedMaterial(materialCode, poNumber, importDate, quantity);
    this.cdr.markForCheck();
  }

  // ===== Bag lẻ (Check lượng PXK): chụp hình + nhập trọng lượng khi scan =====
  private weighExemptCodes = new Set<string>();
  private weighIncludeCodes = new Set<string>();
  /** Đầu mã in tem lẻ không cần cân (Danh mục NVL/TP → Check lượng / Cân). */
  private temLeNoWeighPrefixes: string[] | undefined;
  private weighCodesLoad: Promise<void> | null = null;
  oddWeigh: (OddWeighCtx & {
    scanItem: any;
    weightFullInput: string;
    weightOddInput: string;
    photo: Blob | null;
    photoPreview: string;
    cameraOn: boolean;
    busy: boolean;
    error: string;
  }) | null = null;
  private oddWeighStream: MediaStream | null = null;
  @ViewChild('oddWeighVideo') oddWeighVideoRef?: ElementRef<HTMLVideoElement>;

  private ensureWeighCodesLoaded(): Promise<void> {
    if (!this.weighCodesLoad) {
      this.weighCodesLoad = Promise.all([
        this.pxkWeightReports.loadExemptCodes(),
        this.pxkWeightReports.loadIncludeCodes(),
        this.pxkWeightReports.loadTemLeNoWeighPrefixes().catch(() => undefined)
      ])
        .then(([exempt, include, noWeigh]) => {
          this.temLeNoWeighPrefixes = noWeigh;
          this.weighExemptCodes = new Set(exempt.map((c) => String(c).trim().toUpperCase()));
          this.weighIncludeCodes = new Set(include.map((c) => String(c).trim().toUpperCase()));
        })
        .catch((e) => {
          this.weighCodesLoad = null;
          throw e;
        });
    }
    return this.weighCodesLoad;
  }

  /** null = không cần cân. Bag lẻ = lượng < Standard Packing, mã thuộc Check lượng, PXK có phần lẻ, chưa có hình đã cân. */
  private async findOddWeighNeed(code: string, po: string, bagQty: number): Promise<OddWeighCtx | null> {
    const c = String(code || '').trim().toUpperCase();
    const std = this.stdFor(c, po);
    if (!(std > 0) || !(bagQty > 0) || !(bagQty < std - 1e-9)) return null;
    const key = this.pxkScanKey(c, po);
    const lines = this.batchPxkPairs.filter((p) => this.pxkScanKey(p.code, p.po) === key);
    if (!lines.length) return null;
    const exportQty = lines.reduce((s, p) => s + p.qty, 0);
    const maKho = lines.find((p) => p.maKho)?.maKho || '';
    await this.ensureWeighCodesLoaded();
    if (!this.pxkOddWeigh.isCheckLine(c, maKho, this.weighExemptCodes, this.weighIncludeCodes)) return null;
    const { oddQty } = this.pxkOddWeigh.splitRollQty(exportQty, std);
    if (!(oddQty > 0)) return null;
    const lsx = String(this.batchProductionOrder || '').trim();
    const [saved, catalogWeight] = await Promise.all([
      this.pxkOddWeigh.getSaved(lsx, c, po),
      this.pxkOddWeigh.catalogUnitWeight(c)
    ]);
    // Đã có số gram (có hoặc không có ảnh) → không bắt cân lại
    if (Number(saved?.weightOdd) > 0) return null;
    return { lsx, code: c, po: String(po || '').trim(), maKho, exportQty, std, oddQty, bagQty, catalogWeight };
  }

  private openOddWeigh(ctx: OddWeighCtx, scanItem: any): void {
    this.playScanBeep(true);
    this.setScanFlash('err', `⚖ Bag lẻ ${ctx.code} — chụp hình + nhập trọng lượng để nhận bag`);
    this.oddWeigh = {
      ...ctx,
      scanItem,
      weightFullInput: '',
      weightOddInput: '',
      photo: null,
      photoPreview: '',
      cameraOn: false,
      busy: false,
      error: ''
    };
    this.cdr.markForCheck();
    if (this.oddWeighNoCamera) {
      setTimeout(() => (document.getElementById('oddWeighOdd') as HTMLInputElement | null)?.focus(), 50);
    } else {
      setTimeout(() => void this.startOddWeighCamera(), 0);
    }
  }

  get oddWeighPercent(): number | null {
    const w = this.oddWeigh;
    if (!w) return null;
    const full = w.catalogWeight > 0 ? w.catalogWeight : this.parseWeighInput(w.weightFullInput);
    return this.pxkOddWeigh.oddPercent(full, this.parseWeighInput(w.weightOddInput), w.std, w.bagQty);
  }

  oddWeighPercentOk(p: number): boolean {
    return this.pxkOddWeigh.isOk(p);
  }

  private parseWeighInput(raw: string): number {
    const s = String(raw ?? '').trim().replace(/\s/g, '');
    if (!s) return NaN;
    const n = Number(s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s.replace(/,/g, ''));
    return Number.isFinite(n) ? n : NaN;
  }

  /** Máy chọn "Không dùng camera": cân bag lẻ chỉ nhập số gram, không chụp hình (lưu theo từng máy). */
  oddWeighNoCamera = (() => {
    try { return localStorage.getItem('ob-oddweigh-no-camera') === '1'; } catch { return false; }
  })();

  toggleOddWeighNoCamera(): void {
    this.oddWeighNoCamera = !this.oddWeighNoCamera;
    try { localStorage.setItem('ob-oddweigh-no-camera', this.oddWeighNoCamera ? '1' : '0'); } catch { /* bỏ qua */ }
    const w = this.oddWeigh;
    if (!w) return;
    w.error = '';
    if (this.oddWeighNoCamera) {
      this.stopOddWeighCamera();
      setTimeout(() => (document.getElementById('oddWeighOdd') as HTMLInputElement | null)?.focus(), 50);
    } else if (!w.photo) {
      void this.startOddWeighCamera();
    }
    this.cdr.markForCheck();
  }

  async startOddWeighCamera(): Promise<void> {
    const w = this.oddWeigh;
    if (!w) return;
    this.stopOddWeighCamera();
    w.error = '';
    if (!navigator.mediaDevices?.getUserMedia) {
      w.error = 'Trình duyệt không mở được camera — bấm "Chọn / chụp ảnh".';
      this.cdr.markForCheck();
      return;
    }
    try {
      if (this.oddWeighIdleTimer) { clearTimeout(this.oddWeighIdleTimer); this.oddWeighIdleTimer = null; }
      const live = this.oddWeighStream?.getVideoTracks().some((t) => t.readyState === 'live');
      if (!live) {
        this.oddWeighStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false
        });
        // Tự lấy nét liên tục (webcam hỗ trợ thì áp dụng, không thì bỏ qua)
        const track = this.oddWeighStream.getVideoTracks()[0];
        await (track as any)?.applyConstraints?.({ advanced: [{ focusMode: 'continuous' }] }).catch(() => undefined);
      }
      const video = this.oddWeighVideoRef?.nativeElement;
      if (!video || this.oddWeigh !== w) { this.stopOddWeighCamera(); return; }
      video.srcObject = this.oddWeighStream;
      await video.play().catch(() => undefined);
      w.cameraOn = true;
    } catch (e) {
      console.warn('odd weigh camera:', e);
      w.error = 'Không mở được camera — cấp quyền camera hoặc bấm "Chọn / chụp ảnh".';
    }
    this.cdr.markForCheck();
  }

  private oddWeighIdleTimer: any = null;

  /**
   * Tắt hiển thị camera. Mặc định GIỮ webcam bật 3 phút để bag lẻ kế tiếp mở camera ngay (không chờ 1–2s);
   * hard = true thì tắt hẳn (rời trang).
   */
  private stopOddWeighCamera(hard = false): void {
    const video = this.oddWeighVideoRef?.nativeElement;
    if (video) video.srcObject = null;
    if (this.oddWeigh) this.oddWeigh.cameraOn = false;
    if (this.oddWeighIdleTimer) { clearTimeout(this.oddWeighIdleTimer); this.oddWeighIdleTimer = null; }
    const stopAll = () => {
      this.oddWeighStream?.getTracks().forEach((t) => t.stop());
      this.oddWeighStream = null;
      this.oddWeighIdleTimer = null;
    };
    if (hard) stopAll();
    else if (this.oddWeighStream) this.oddWeighIdleTimer = setTimeout(stopAll, 3 * 60 * 1000);
  }

  /** Phím Space khi popup cân đang mở camera (không gõ trong ô nhập) → chụp. */
  @HostListener('document:keydown', ['$event'])
  onOddWeighHotkey(e: KeyboardEvent): void {
    const w = this.oddWeigh;
    if (!w || w.photo || !w.cameraOn || this.oddWeighNoCamera || e.code !== 'Space') return;
    const tag = String((e.target as HTMLElement)?.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    e.preventDefault();
    void this.captureOddWeighPhoto();
  }

  async captureOddWeighPhoto(): Promise<void> {
    const w = this.oddWeigh;
    const video = this.oddWeighVideoRef?.nativeElement;
    if (!w || !video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    this.stopOddWeighCamera();
    await this.setOddWeighPhoto(await this.pxkOddWeigh.compressPhoto(canvas));
  }

  async onOddWeighFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.oddWeigh) return;
    try {
      this.stopOddWeighCamera();
      await this.setOddWeighPhoto(await this.pxkOddWeigh.compressPhoto(file));
    } catch (e: any) {
      this.oddWeigh.error = e?.message || 'Không đọc được ảnh.';
    }
    this.cdr.markForCheck();
  }

  private async setOddWeighPhoto(blob: Blob): Promise<void> {
    const w = this.oddWeigh;
    if (!w) return;
    if (w.photoPreview) URL.revokeObjectURL(w.photoPreview);
    w.photo = blob;
    w.photoPreview = URL.createObjectURL(blob);
    w.error = '';
    this.cdr.markForCheck();
    setTimeout(() => (document.getElementById('oddWeighOdd') as HTMLInputElement | null)?.focus(), 50);
  }

  retakeOddWeighPhoto(): void {
    const w = this.oddWeigh;
    if (!w) return;
    if (w.photoPreview) URL.revokeObjectURL(w.photoPreview);
    w.photo = null;
    w.photoPreview = '';
    void this.startOddWeighCamera();
  }

  async saveOddWeigh(): Promise<void> {
    const w = this.oddWeigh;
    if (!w || w.busy) return;
    const weightFullEntered = !(w.catalogWeight > 0);
    const weightFull = weightFullEntered ? this.parseWeighInput(w.weightFullInput) : w.catalogWeight;
    const weightOdd = this.parseWeighInput(w.weightOddInput);
    if (!w.photo && !this.oddWeighNoCamera) { w.error = 'Chụp hình bag lẻ trên cân trước (hoặc tick "Không dùng camera").'; return; }
    if (!(weightOdd > 0)) { w.error = 'Nhập trọng lượng bag lẻ (gram).'; return; }
    if (!(weightFull > 0)) { w.error = 'Nhập trọng lượng chẵn cuộn (gram) — danh mục chưa có.'; return; }
    // Nhận bag ngay; tải hình + ghi Check lượng chạy nền (không bắt nhân viên chờ upload)
    const input = {
      factory: this.selectedFactory,
      lsx: w.lsx,
      materialCode: w.code,
      po: w.po,
      maKho: w.maKho,
      exportQty: w.exportQty,
      standard: w.std,
      bagQty: w.bagQty,
      weightFull,
      weightFullEntered,
      weightOdd,
      photo: this.oddWeighNoCamera ? null : w.photo,
      weighedBy: String(this.batchEmployeeId || (w.scanItem?.__bs ? 'BS' : '')).trim().toUpperCase()
    };
    const percent = this.pxkOddWeigh.oddPercent(weightFull, weightOdd, w.std, w.bagQty);
    const ok = percent == null ? null : this.pxkOddWeigh.isOk(percent);
    const pct = percent == null ? '' : ` · cân ${(Math.round(percent * 10) / 10).toFixed(1)}% ${ok ? 'OK' : 'KHÔNG ĐẠT (lệch > ±5%)'}`;
    const item = w.scanItem;
    this.closeOddWeigh();
    this.finishOddWeighItem(item, pct);
    void this.saveOddWeighInBackground(input, 2);
  }

  /** Ghi kết quả cân bag lẻ (có thử lại); lỗi thì báo đỏ để nhân viên biết. */
  private async saveOddWeighInBackground(input: any, triesLeft: number): Promise<void> {
    try {
      await this.pxkOddWeigh.save(input);
    } catch (e: any) {
      console.error('saveOddWeighInBackground:', e);
      if (triesLeft > 0) {
        setTimeout(() => void this.saveOddWeighInBackground(input, triesLeft - 1), 3000);
        return;
      }
      this.setScanFlash('err', `⚠ Chưa lưu được kết quả cân bag lẻ ${input.materialCode} (${e?.message || e}) — báo quản lý kho.`);
      this.cdr.markForCheck();
    }
  }

  /** Đã báo "không cân được" cho mã này → cho nhận bag không cần cân. */
  get oddWeighReported(): boolean {
    const w = this.oddWeigh;
    const r = this.weighReport;
    return !!w && !!r && r.ok && r.code === w.code;
  }

  acceptOddWeighWithoutWeight(): void {
    const w = this.oddWeigh;
    if (!w || !this.oddWeighReported) return;
    const item = w.scanItem;
    this.closeOddWeigh();
    this.weighReport = null;
    this.finishOddWeighItem(item, ' · đã báo không cân được');
  }

  cancelOddWeigh(): void {
    const code = this.oddWeigh?.code || '';
    this.closeOddWeigh();
    this.setScanFlash('err', `Đã hủy bag lẻ ${code} — bag chưa được nhận.`);
    setTimeout(() => this.focusScannerInput(), 50);
  }

  private closeOddWeigh(): void {
    this.stopOddWeighCamera();
    if (this.oddWeigh?.photoPreview) URL.revokeObjectURL(this.oddWeigh.photoPreview);
    this.oddWeigh = null;
    this.cdr.markForCheck();
    setTimeout(() => this.focusScannerInput(), 50);
  }

  // ===== Bảng scan máy tính: báo màu + âm thanh, tiến độ PXK, danh sách vừa scan =====
  scanFlash: { kind: 'ok' | 'err'; text: string } | null = null;
  private scanAudioCtx: AudioContext | null = null;

  private setScanFlash(kind: 'ok' | 'err', text: string): void {
    this.scanFlash = { kind, text };
    this.cdr.markForCheck();
  }

  /** Đúng: 1 tiếng bíp cao. Sai: 2 tiếng bíp trầm. */
  private playScanBeep(ok: boolean): void {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      this.scanAudioCtx ||= new Ctx();
      const ctx = this.scanAudioCtx!;
      const tone = (start: number, freq: number, dur: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        osc.type = 'square';
        gain.gain.value = 0.08;
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur);
      };
      if (ok) tone(0, 1400, 0.12);
      else { tone(0, 420, 0.18); tone(0.26, 420, 0.18); }
    } catch { /* trình duyệt chặn âm thanh — bỏ qua */ }
  }

  /** Danh mục NVL (đã nạp sẵn ở loadAllowExportByCartonSet) — tên, MSD/ESD cho thẻ nhận diện. */
  private catalogByCode = new Map<string, any>();

  /** Thẻ nhận diện mã vừa scan: tên + các ghi chú cần chú ý (Kiểm 100%, MSD/ESD, tem lẻ, vượt PXK…). */
  scanIdentity: { code: string; name: string; po: string; bag: string; qty: number; tags: Array<{ text: string; tone: 'red' | 'amber' | 'blue' | 'gray'; title?: string }> } | null = null;

  private identifyScannedMaterial(code: string, po: string, importDate: string | null, qty: number): void {
    const c = String(code || '').trim().toUpperCase();
    const cat = this.catalogByCode.get(c);
    const p = this.rmBagHistory.parseQrPart4(importDate);
    const tags: Array<{ text: string; tone: 'red' | 'amber' | 'blue' | 'gray'; title?: string }> = [];
    const k100 = this.sxxkSuspect.get(c);
    if (k100) {
      tags.push({ text: 'KIỂM 100%', tone: 'red', title: k100.source === 'manual' ? `Nhập tay: ${k100.reason}` : `${k100.n} lần xuất bổ sung (SXXK) — ${k100.reason}` });
    }
    const boPhan = Number((cat as any)?.boPhan) || 0;
    if (boPhan > 0) tags.push({ text: `${boPhan} BỘ PHẬN`, tone: 'red', title: `Mã có ${boPhan} bộ phận — lấy đủ ${boPhan} bộ phận` });
    if (cat?.isMsd) tags.push({ text: 'MSD', tone: 'amber', title: 'Hàng nhạy ẩm' });
    if (cat?.isEsd) tags.push({ text: 'ESD', tone: 'amber', title: 'Hàng nhạy tĩnh điện' });
    if (p.splitTag) tags.push({ text: `Tem lẻ ${p.splitTag}`, tone: 'blue' });
    if (cat?.allowExportByCarton) tags.push({ text: 'Xuất thùng', tone: 'gray' });
    const row = this.scanPxkProgress.find((r) => r.code === c && r.po === this.normalizePxImportPo(po));
    if (row && row.remain < -0.0001) tags.push({ text: `Vượt PXK ${Math.abs(row.remain)}`, tone: 'red' });
    else if (row && row.remain <= 0.0001) tags.push({ text: 'Đủ PXK', tone: 'blue' });
    if (!cat) tags.push({ text: 'Chưa có trong danh mục NVL', tone: 'gray' });
    this.scanIdentity = {
      code: c,
      name: String(cat?.materialName || ''),
      po: String(po || ''),
      bag: p.bagFractionLabel || '',
      qty: Number(qty) || 0,
      tags
    };
  }

  /** % tiến trình LSX = tổng (đã xuất + vừa scan, tối đa bằng cần) ÷ tổng cần trên PXK. */
  get scanLsxPercent(): number {
    const rows = this.scanPxkProgress;
    const need = rows.reduce((n, r) => n + r.need, 0);
    if (!(need > 0)) return 0;
    const done = rows.reduce((n, r) => n + Math.min(r.need, Math.max(0, r.exported + r.scanned)), 0);
    return Math.min(100, Math.round((done / need) * 1000) / 10);
  }

  /** Tạm dừng & lưu: lưu các bag đã scan nhưng vẫn giữ phiên (LSX + NV) để scan tiếp. */
  async pauseSaveBatch(): Promise<void> {
    if (!this.pendingScanData.length || this.isSavingBatchData) return;
    const n = this.pendingScanData.length;
    this.isSavingBatchData = true;
    this.cdr.detectChanges();
    try {
      await this.batchUpdateAllScanData();
      this.pendingScanData = [];
      this.savePendingToStorage();
      const lsx = (this.batchProductionOrder || '').trim();
      if (lsx) this.batchPxkExportedByKey = await this.loadBatchPxkExportedTotals(lsx);
      this.setScanFlash('ok', `💾 Đã lưu ${n} bag — tiếp tục scan ${lsx}`);
    } catch (e: any) {
      this.playScanBeep(false);
      this.setScanFlash('err', 'Lỗi lưu: ' + (e?.message || e));
    } finally {
      this.isSavingBatchData = false;
      this.cdr.detectChanges();
      setTimeout(() => this.focusScannerInput(), 50);
    }
  }

  /** Tải Excel log LSX (từng bag đã scan xuất). */
  async downloadLsxLog(lsxRaw?: string): Promise<void> {
    const lsx = String(lsxRaw || this.lsxLogShownLsx || this.batchProductionOrder || this.lsxLogQuery || '').trim().toUpperCase();
    if (!lsx) { appAlert('Nhập LSX trước.'); return; }
    try {
      const lines = lsx === this.lsxLogShownLsx && this.lsxLogLines.length
        ? this.lsxLogLines
        : (await this.lsxLog.load(this.selectedFactory, lsx)).lines;
      if (!lines.length) { appAlert(`Chưa có log cho ${lsx}.`); return; }
      // File .txt kiểu notepad — nhẹ, mở được ở mọi máy; cột cách nhau bằng " | "
      const head = ['STT', 'Thời gian', 'Người', 'Mã hàng', 'PO', 'IMD', 'Bag', 'Tem', 'Lượng', 'Vị trí', 'Cách scan'];
      const total = lines.reduce((n, l) => n + (Number(l.qty) || 0), 0);
      const text = [
        `LOG LSX ${lsx} — ${this.selectedFactory} — ${lines.length} lần scan — tổng ${total}`,
        `Tải lúc ${new Date().toLocaleString('vi-VN', { hour12: false })}`,
        '',
        head.join(' | '),
        ...lines.map((l, i) => [i + 1, this.lsxLogTime(l.t), l.by, l.code, l.po, l.imd, l.bag, l.tag, l.qty, l.loc, l.m]
          .map((v) => String(v ?? '')).join(' | '))
      ].join('\r\n');
      const blob = new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Log_${lsx.replace(/[\\/:*?"<>|]+/g, '_')}_${this.selectedFactory}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      console.error('downloadLsxLog:', e);
      appAlert('❌ Không tải được log.');
    }
  }

  // ===== Report "không cân được" (tách lẻ & cân) → danh sách Check lượng PXK chờ duyệt =====
  readonly weighReasons = WEIGH_EXEMPT_REASONS;
  readonly weighOther = WEIGH_EXEMPT_OTHER;
  weighReport: { code: string; po: string; lsx: string; maKho: string; source: string; choice: string; other: string; busy: boolean; msg: string; ok: boolean } | null = null;

  /** source = nguồn ghi trong lý do (vd "Xuất BS — Outbound"). */
  openWeighReport(code: string, po: string, lsx: string, maKho = '', source = 'Tách lẻ & cân — Outbound'): void {
    const c = String(code || '').trim().toUpperCase();
    if (!c) return;
    this.weighReport = { code: c, po: String(po || '').trim(), lsx: String(lsx || '').trim(), maKho, source, choice: '', other: '', busy: false, msg: '', ok: false };
  }

  async submitWeighReport(): Promise<void> {
    const r = this.weighReport;
    if (!r || r.busy) return;
    const reason = buildWeighExemptReason(r.choice, r.other, r.source);
    if (!reason) { r.msg = r.choice === WEIGH_EXEMPT_OTHER ? 'Nhập lý do khác.' : 'Chọn lý do.'; return; }
    r.busy = true;
    r.msg = '';
    try {
      const sent = await this.pxkWeightReports.submit({
        lsx: r.lsx, materialCode: r.code, maKho: r.maKho, po: r.po, reason,
        reportedBy: String(this.batchEmployeeId || this.operatorSessionId || '').trim().toUpperCase()
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

  get pendingScanNewestFirst(): any[] {
    return [...this.pendingScanData].reverse();
  }

  get pendingScanTotalQty(): number {
    return this.pendingScanData.reduce((n, it) => n + (Number(it?.quantity) || 0), 0);
  }

  removePendingScan(item: any): void {
    if (!confirm(`Xóa dòng scan ${item?.materialCode} · ${item?.importDate || ''} · ${item?.quantity}?`)) return;
    this.pendingScanData = this.pendingScanData.filter((x) => x !== item);
    this.savePendingToStorage();
    this.setScanFlash('ok', `Đã xóa dòng ${item?.materialCode}`);
    setTimeout(() => this.focusScannerInput(), 50);
  }

  private scanPxkMemo: { pairs: unknown; exported: unknown; pending: unknown; inv: unknown; rows: Array<ScanPxkRow> } =
    { pairs: null, exported: null, pending: null, inv: null, rows: [] };

  /** Tiến độ từng mã + PO trên PXK của LSX: cần / đã xuất trước / vừa scan / còn. */
  get scanPxkProgress(): Array<ScanPxkRow> {
    const m = this.scanPxkMemo;
    if (m.pairs === this.batchPxkPairs && m.exported === this.batchPxkExportedByKey && m.pending === this.pendingScanData
      && m.inv === this.batchPxkInv) return m.rows;
    const inv = this.batchPxkInv;
    const need = new Map<string, { code: string; po: string; need: number }>();
    for (const p of this.batchPxkPairs) {
      const key = this.pxkScanKey(p.code, p.po);
      const cur = need.get(key) || { code: p.code, po: p.po, need: 0 };
      cur.need += p.qty;
      need.set(key, cur);
    }
    const scanned = new Map<string, number>();
    const scannedBags = new Map<string, number>();
    for (const it of this.pendingScanData) {
      const key = this.pxkScanKey(it?.materialCode, it?.poNumber);
      scanned.set(key, (scanned.get(key) || 0) + (Number(it?.quantity) || 0));
      scannedBags.set(key, (scannedBags.get(key) || 0) + 1);
    }
    const r4 = (n: number) => Math.round(n * 10000) / 10000;
    const rows = Array.from(need.entries()).map(([key, v]) => {
      const exported = this.batchPxkExportedByKey.get(key) || 0;
      const sc = scanned.get(key) || 0;
      const remain = r4(v.need - exported - sc);
      // Bag theo Standard Packing: cần = làm tròn lên; còn lại = x bag chẵn + 1 bag lẻ (phần dư)
      const std = this.stdFor(v.code, v.po);
      const needBags = std > 0 ? Math.ceil(r4(v.need / std)) : 0;
      const doneBags = (this.batchPxkExportedBagsByKey.get(key) || 0) + (scannedBags.get(key) || 0);
      const left = Math.max(0, remain);
      const remainFull = std > 0 ? Math.floor(r4(left / std)) : 0;
      const remainOddQty = std > 0 ? r4(left - remainFull * std) : 0;
      const needFull = std > 0 ? Math.floor(r4(v.need / std)) : 0;
      const needOdd = std > 0 ? r4(v.need - needFull * std) : 0;
      const stock = inv ? r4((inv.get(key) || []).reduce((s, x) => s + x.stock, 0)) : null;
      return {
        code: v.code, po: v.po, need: r4(v.need), exported: r4(exported), scanned: r4(sc), remain,
        std, needBags, doneBags, remainFull, remainOddQty, needFull, needOdd, stock
      };
    }).sort((a, b) => Number(b.scanned > 0) - Number(a.scanned > 0) || a.code.localeCompare(b.code));
    this.scanPxkMemo = { pairs: this.batchPxkPairs, exported: this.batchPxkExportedByKey, pending: this.pendingScanData, inv, rows };
    return rows;
  }

  /** Cần = bag chẵn × Standard + lẻ. */
  scanNeedBagText(r: ScanPxkRow): string {
    if (!(r.std > 0)) return '—';
    const parts: string[] = [];
    if (r.needFull) parts.push(`${r.needFull}×${this.formatScanNum(r.std)}`);
    if (r.needOdd > 0) parts.push(`lẻ ${this.formatScanNum(r.needOdd)}`);
    return parts.join(' + ') || '0';
  }

  // ===== In tem lẻ ngay trên dòng PXK: tự chọn bịch trong tồn kho, tách TL (phần xuất) + CL (còn lại) =====
  temLeOb: {
    code: string; po: string; oddQty: number; std: number;
    /** Đọc lại khi mở: cần · đã xuất (hệ thống) · đang scan chưa lưu · còn lại · bag chẵn còn lại. */
    need: number; exported: number; scanned: number; remain: number; remainFull: number;
    loading: boolean; picks: TemLeSourcePick[]; pickIdx: number;
    needWeigh: boolean; gwFullKnown: number; gwFullInput: number | null; gwClInput: number | null;
    busy: boolean; error: string;
  } | null = null;

  async openTemLeOb(r: ScanPxkRow, lotsOverride?: PxkInvLot[]): Promise<void> {
    if (!(r.std > 0)) { this.showScanError(`Mã ${r.code} chưa có Standard Packing — không tách tem lẻ được.`); return; }
    const r4 = (n: number) => Math.round(n * 10000) / 10000;
    const t = {
      code: r.code, po: r.po, oddQty: 0, std: r.std,
      need: r4(r.need), exported: r4(r.exported), scanned: r4(r.scanned), remain: r4(Math.max(0, r.remain)), remainFull: 0,
      loading: true, picks: [] as TemLeSourcePick[], pickIdx: 0,
      needWeigh: false, gwFullKnown: 0, gwFullInput: null, gwClInput: null, busy: false, error: ''
    };
    this.temLeOb = t;
    this.cdr.markForCheck();
    try {
      // Xuất NL: đọc lại tổng đã xuất của LSX trên hệ thống rồi mới tính phần còn lại (BS đã đọc lại trước khi gọi)
      if (!lotsOverride) {
        const lsx = (this.batchProductionOrder || '').trim();
        if (lsx) {
          this.batchPxkExportedByKey = await this.loadBatchPxkExportedTotals(lsx);
          if (this.temLeOb !== t) return;
          const key = this.pxkScanKey(r.code, r.po);
          t.exported = r4(this.batchPxkExportedByKey.get(key) || 0);
          t.scanned = r4(this.pendingScanData
            .filter((it) => this.pxkScanKey(it?.materialCode, it?.poNumber) === key)
            .reduce((s, it) => s + (Number(it?.quantity) || 0), 0));
          t.remain = r4(Math.max(0, t.need - t.exported - t.scanned));
        }
      }
      // Từ phần còn lại → x bịch chẵn + 1 lẻ; tem lẻ chỉ tách phần lẻ
      t.remainFull = Math.floor(r4(t.remain / r.std));
      t.oddQty = r4(t.remain - t.remainFull * r.std);
      if (!(t.oddQty > 0)) {
        t.error = t.remain <= 0.0001
          ? `Mã ${r.code} đã xuất đủ (cần ${this.formatScanNum(t.need)}, đã xuất ${this.formatScanNum(t.exported + t.scanned)}) — không cần tách.`
          : `Còn lại ${this.formatScanNum(t.remain)} = ${t.remainFull} bịch chẵn ${this.formatScanNum(r.std)} — không có phần lẻ, scan bịch chẵn để xuất.`;
        return;
      }
      const oddQty = t.oddQty;
      await this.ensureWeighCodesLoaded().catch(() => undefined);
      t.needWeigh = temLeMustWeigh(r.code, this.weighExemptCodes, this.weighIncludeCodes, this.temLeNoWeighPrefixes);
      const lots = (lotsOverride || this.batchPxkInv?.get(this.pxkScanKey(r.code, r.po)) || [])
        .filter((x) => x.stock > 0.0001 && x.imd)
        .sort((a, b) => a.importMs - b.importMs);
      const [picks, gwFull] = await Promise.all([
        this.pickTemLeSources(r.code, lots, oddQty, r.std),
        this.pxkOddWeigh.catalogUnitWeight(r.code).catch(() => 0)
      ]);
      if (this.temLeOb !== t) return;
      t.picks = picks;
      t.gwFullKnown = gwFull;
      if (!lots.length) t.error = `Mã ${r.code} · PO ${r.po} không còn tồn kho.`;
      else if (!picks.length) {
        const lotTxt = (this.temLeObDiag.length ? this.temLeObDiag : lots.map((x) => `IMD ${x.imd}: tồn ${this.formatScanNum(x.stock)}`)).join(' · ');
        t.error = `Không có bịch phù hợp để tách (cần lẻ ${this.formatScanNum(oddQty)}, Standard ${this.formatScanNum(r.std)}). Tồn PO: ${lotTxt}.`;
      }
    } catch (e: any) {
      t.error = 'Không đọc được tồn kho: ' + (e?.message || e);
    } finally {
      t.loading = false;
      this.cdr.markForCheck();
    }
  }

  /** IMD cũ trước: bịch CL đang có (lớn hơn lượng lẻ) hoặc đúng bằng lượng lẻ, sau đó bịch chẵn của IMD chưa có CL. */
  private async pickTemLeSources(code: string, lots: PxkInvLot[], oddQty: number, std: number): Promise<TemLeSourcePick[]> {
    const picks: TemLeSourcePick[] = [];
    const seen = new Set<string>();
    // Ép kiểu số — giá trị chuỗi làm phép so sánh sai dù màn hình hiện đúng
    const TEMLE_EPS = 0.001;
    const odd = Number(oddQty) || 0;
    const spDefault = Number(std) || 0;
    this.temLeObDiag = [];
    for (const lot of lots) {
      const k = `${lot.imd}|${lot.po}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const stock = Math.round((Number(lot.stock) || 0) * 10000) / 10000;
      // Standard của chính lô (PO mới có thể khác danh mục); lô cũ chưa có thì dùng Standard truyền vào
      const sp = Number(lot.std) > 0 ? Number(lot.std) : spDefault;
      const st = await this.temLeCl.getState(this.selectedFactory, code, lot.po, lot.imd).catch(() => null);
      this.temLeObDiag.push(`IMD ${lot.imd}: tồn ${this.formatScanNum(stock)}${st?.clActive ? ` · CL ${st.clTag} = ${this.formatScanNum(Number(st.clQty) || 0)}` : ''}`);
      // Bag lẻ cuối của PO (tồn < Standard và ≤ lượng lẻ cần) → xuất nguyên bag, không tách / không CL
      if (stock > TEMLE_EPS && stock < sp - TEMLE_EPS && stock <= odd + TEMLE_EPS) {
        picks.push({ kind: 'LAST', imd: lot.imd, po: lot.po, sourceQty: stock, clTag: st?.clActive ? String(st.clTag || '') : '', bagFraction: st?.bagFraction || '' });
        continue;
      }
      // Tồn chia hết Standard mà vẫn ghi nhận CL → CL treo (đã xuất / đã gom): coi như toàn bịch chẵn
      const evenStock = sp > 0 && stock + TEMLE_EPS >= sp
        && Math.abs(stock - Math.round(stock / sp) * sp) < TEMLE_EPS;
      if (st?.clActive && evenStock && sp > odd) {
        picks.push({ kind: 'FULL', imd: lot.imd, po: lot.po, sourceQty: sp, clTag: '', bagFraction: '', staleCl: String(st.clTag || 'CL') });
      } else if (st?.clActive) {
        const clQty = Number(st.clQty) || 0;
        if (Math.abs(clQty - odd) < TEMLE_EPS) {
          picks.push({ kind: 'EXACT', imd: lot.imd, po: lot.po, sourceQty: clQty, clTag: st.clTag, bagFraction: st.bagFraction || '' });
        } else if (clQty > odd) {
          picks.push({ kind: 'CL', imd: lot.imd, po: lot.po, sourceQty: clQty, clTag: st.clTag, bagFraction: st.bagFraction || '' });
        } else if (clQty > TEMLE_EPS && sp > 0 && stock + TEMLE_EPS >= clQty + sp) {
          // CL nhỏ hơn lượng cần (vd CL 29 < 37) + IMD còn bịch chẵn → gom CL + phần thiếu từ 1 bịch chẵn thành 1 bịch TL
          const src = Math.round((sp + clQty) * 10000) / 10000;
          picks.push({ kind: 'COMBO', imd: lot.imd, po: lot.po, sourceQty: src, clTag: st.clTag, bagFraction: st.bagFraction || '', partQty: clQty });
        }
      } else {
        // Bag lẻ đang tồn của lô = phần dư tồn ÷ Standard (vd tồn 2300, Standard 500 → bag 300);
        // tồn < Standard thì cả lô là 1 bag lẻ (vd tồn 2568, Standard 3600 → bag 2568)
        const rem = !(sp > 0) ? 0
          : stock + TEMLE_EPS < sp ? stock
          : Math.round((stock - Math.floor(stock / sp + 1e-9) * sp) * 10000) / 10000;
        if (rem > TEMLE_EPS && Math.abs(rem - odd) < TEMLE_EPS) {
          picks.push({ kind: 'LAST', imd: lot.imd, po: lot.po, sourceQty: rem, clTag: '', bagFraction: '' });
        } else if (rem > odd + TEMLE_EPS) {
          picks.push({ kind: 'ODD', imd: lot.imd, po: lot.po, sourceQty: rem, clTag: '', bagFraction: '' });
        } else if (rem > TEMLE_EPS && stock + TEMLE_EPS >= sp + rem) {
          // Bag lẻ nhỏ hơn lượng cần + cùng IMD còn bịch chẵn → gom thành 1 bịch TL đúng lượng lẻ
          const src = Math.round((sp + rem) * 10000) / 10000;
          picks.push({ kind: 'COMBO', imd: lot.imd, po: lot.po, sourceQty: src, clTag: '', bagFraction: '', partQty: rem });
        }
        if (stock + TEMLE_EPS >= sp && sp > odd) {
          picks.push({ kind: 'FULL', imd: lot.imd, po: lot.po, sourceQty: sp, clTag: '', bagFraction: '' });
        }
      }
    }
    // Ưu tiên: không phải tách (LAST / EXACT) → bịch CL → bag lẻ đang tồn → gom bag lẻ + bịch chẵn → cuối cùng mới tách bịch chẵn (IMD cũ trước trong cùng loại)
    const rank: Record<TemLeSourcePick['kind'], number> = { LAST: 0, EXACT: 1, CL: 2, ODD: 3, COMBO: 4, FULL: 5 };
    return picks.map((p, i) => ({ p, i })).sort((a, b) => rank[a.p.kind] - rank[b.p.kind] || a.i - b.i).map((x) => x.p);
  }

  /** Lô đã xét khi chọn bịch tách (hiện trong thông báo khi không tách được). */
  private temLeObDiag: string[] = [];

  get temLeObPick(): TemLeSourcePick | null {
    return this.temLeOb?.picks[this.temLeOb.pickIdx] || null;
  }

  temLeObPickLabel(p: TemLeSourcePick): string {
    if (p.kind === 'EXACT') return `IMD ${p.imd} · bịch ${p.clTag} = ${this.formatScanNum(p.sourceQty)} (đúng lượng lẻ — không cần tách)`;
    if (p.kind === 'LAST') return `IMD ${p.imd} · bag lẻ cuối của PO = ${this.formatScanNum(p.sourceQty)} (xuất nguyên bag — không CL)`;
    if (p.kind === 'CL') return `IMD ${p.imd} · tách từ bịch ${p.clTag} (${this.formatScanNum(p.sourceQty)})`;
    if (p.kind === 'ODD') return `IMD ${p.imd} · tách từ bag lẻ đang tồn (${this.formatScanNum(p.sourceQty)})`;
    if (p.kind === 'COMBO') {
      const part = p.partQty || 0;
      return `IMD ${p.imd} · gom ${p.clTag ? 'bịch ' + p.clTag : 'bag lẻ'} ${this.formatScanNum(part)} + ${this.formatScanNum(Math.round(((this.temLeOb?.oddQty || 0) - part) * 10000) / 10000)} từ bịch chẵn`;
    }
    return `IMD ${p.imd} · tách từ bịch chẵn (${this.formatScanNum(p.sourceQty)})${p.staleCl ? ` — ${p.staleCl} trên hệ thống là treo (tồn chia hết Standard)` : ''}`;
  }

  get temLeObClQty(): number {
    const p = this.temLeObPick;
    return p && this.temLeOb ? Math.round((p.sourceQty - this.temLeOb.oddQty) * 10000) / 10000 : 0;
  }

  closeTemLeOb(): void {
    if (this.temLeOb?.busy) return;
    this.temLeOb = null;
    // Đang mở popup Xuất BS → trả focus về ô scan BS
    if (this.bsScanOpen) setTimeout(() => (document.getElementById('bs-scan-input') as HTMLInputElement | null)?.focus(), 50);
    else setTimeout(() => this.focusScannerInput(), 50);
  }

  async confirmTemLeOb(): Promise<void> {
    const t = this.temLeOb;
    const p = this.temLeObPick;
    if (!t || !p || t.busy || p.kind === 'EXACT' || p.kind === 'LAST') return;
    const gwFull = t.gwFullKnown > 0 ? t.gwFullKnown : Math.round(Number(t.gwFullInput) || 0);
    const gwCl = Math.round(Number(t.gwClInput) || 0);
    if (t.needWeigh && !(gwCl > 0)) { t.error = 'Cân bịch CL (phần còn lại) và nhập GW (gram).'; return; }
    if (t.needWeigh && !(gwFull > 0)) { t.error = 'Mã chưa có GW bag nguyên — nhập GW bag nguyên (gram).'; return; }
    const win = window.open('', '_blank');
    if (!win) { t.error = 'Không mở được cửa sổ in — cho phép popup cho trang này.'; return; }
    t.busy = true;
    t.error = '';
    this.cdr.markForCheck();
    const by = String(this.batchEmployeeId || this.operatorSessionId || '').trim().toUpperCase();
    try {
      const fromCl = p.kind === 'CL' || (p.kind === 'COMBO' && !!p.clTag);
      const p4 = fromCl ? `${p.imd}${p.bagFraction ? '-' + p.bagFraction : ''}(${p.clTag})` : p.imd;
      const res = await this.temLeCl.split({
        factory: this.selectedFactory, materialCode: t.code, po: p.po, quantity: p.sourceQty,
        p4, imd: p.imd, bagFraction: p.bagFraction,
        ...(p.staleCl ? { staleCl: true } : {}),
        ...(p.kind === 'COMBO' && p.clTag ? { mergeFullQty: Math.round((p.sourceQty - (p.partQty || 0)) * 10000) / 10000 } : {})
      }, t.oddQty, by);
      const QRCode = await import('qrcode') as any;
      const qr = (data: string) => QRCode.toDataURL(data, { width: 240, margin: 1, color: { dark: '#000000', light: '#FFFFFF' } });
      const [tlImg, clImg] = await Promise.all([qr(res.tlQrData), qr(res.clQrData)]);
      win.document.write(buildMaterialQrLabelDocument([
        { kind: 'bag', qrImage: tlImg, qrData: res.tlQrData, batchNumber: p.imd },
        { kind: 'bag', qrImage: clImg, qrData: res.clQrData, batchNumber: p.imd }
      ], `Tem lẻ ${t.code}`));
      win.document.close();
      if (t.needWeigh) await this.saveTemLeObGw(t.code, p, res, gwCl, gwFull, t.gwFullKnown <= 0, t.std, by);
      const comboNote = p.kind === 'COMBO' ? ` (gom ${p.clTag ? 'bịch ' + p.clTag : 'bag lẻ'} ${this.formatScanNum(p.partQty || 0)} vào bịch ${res.tlTag})` : '';
      this.setScanFlash('ok', `🏷 Đã in ${res.tlTag} (${this.formatScanNum(res.tlQty)})${comboNote} + ${res.clTag} (${this.formatScanNum(res.clQty)}) · ${t.code} — scan ${res.tlTag} để xuất (chụp hình bag lẻ khi scan)`);
      t.busy = false;
      this.closeTemLeOb();
    } catch (e: any) {
      win.close();
      t.busy = false;
      t.error = e?.message || 'Không tách / in được tem lẻ.';
      this.cdr.markForCheck();
    }
  }

  private async saveTemLeObGw(
    code: string, p: TemLeSourcePick, res: { logId: string; clTag: string; clQty: number },
    gwCl: number, gwFull: number, gwFullEntered: boolean, std: number, by: string
  ): Promise<void> {
    try {
      if (gwFullEntered && gwFull > 0) await this.nvlCatalog.setGwBag(code, gwFull, by);
      const expected = gwFull * res.clQty / std;
      const devPct = expected > 0 ? Math.round(((gwCl - expected) / expected) * 1000) / 10 : null;
      const ok = devPct != null && Math.abs(devPct) <= WEIGH_TOLERANCE_PERCENT;
      await this.temLeCl.saveGwCheck(res.logId, {
        factory: this.selectedFactory, materialCode: code, po: p.po, imd: p.imd, clTag: res.clTag, clQty: res.clQty,
        fullQty: std, gwBagFull: gwFull, gwCl, gwExpected: expected > 0 ? Math.round(expected) : null, devPct, ok,
        reason: ok ? '' : (devPct == null ? 'Không tính được GW dự kiến' : `${res.clTag} lệch ${devPct}%`), by
      });
      if (!ok) appAlert(`⚠️ GW bịch ${res.clTag} lệch ${devPct ?? '?'}% (cân ${gwCl} g, dự kiến ${expected > 0 ? Math.round(expected) : '?'} g).\nĐã in tem và ghi vào danh mục nghi ngờ.`);
    } catch (e: any) {
      console.error('saveTemLeObGw:', e);
      appAlert('Đã in tem nhưng chưa lưu được GW bịch CL: ' + (e?.message || e));
    }
  }

  /** % hoàn thành LSX theo bag: bag đã xuất + vừa scan ÷ tổng bag (theo Standard). Mã chưa có Standard thì tính theo lượng. */
  get scanLsxBagStats(): { done: number; total: number; percent: number } {
    let done = 0;
    let total = 0;
    for (const r of this.scanPxkProgress) {
      if (!(r.need > 0)) continue;
      if (r.std > 0) {
        total += r.needBags;
        done += Math.min(r.needBags, r.doneBags);
      }
    }
    if (!total) return { done: 0, total: 0, percent: this.scanLsxPercent };
    return { done, total, percent: Math.min(100, Math.round((done / total) * 1000) / 10) };
  }

  scanRemainBagText(r: ScanPxkRow): string {
    if (!(r.std > 0)) return '—';
    if (r.remain <= 0.0001) return 'Xong';
    const parts: string[] = [];
    if (r.remainFull) parts.push(`${r.remainFull} chẵn`);
    if (r.remainOddQty > 0) parts.push(`1 lẻ (${this.formatScanNum(r.remainOddQty)})`);
    return parts.join(' + ') || 'Xong';
  }

  private formatScanNum(n: number): string {
    return (Math.round(n * 10000) / 10000).toLocaleString('en-US');
  }

  /** PDA: dòng PXK của mã vừa scan (cần / đã xuất + vừa scan / còn) trong LSX đang xuất. */
  get mobileScanCurrentRow(): ScanPxkRow | null {
    const id = this.scanIdentity;
    if (!id) return null;
    const po = this.normalizePxImportPo(id.po);
    return this.scanPxkProgress.find((r) => r.code === id.code && r.po === po)
      || this.scanPxkProgress.find((r) => r.code === id.code)
      || null;
  }

  get scanPxkDoneCount(): number {
    return this.scanPxkProgress.filter((r) => r.remain <= 0.0001).length;
  }

  trackScanPxkRow(_: number, r: { code: string; po: string }): string {
    return `${r.code}|${r.po}`;
  }

  /**
   * Kiểm tra mã hàng đang ở vị trí IQC khi xuất kho — cảnh báo ngay cho nhân viên đang scan.
   */
  /** Khách của LSX đang xuất (Work Order) — quyết định hạn dùng tem Week. */
  private lsxCustomerCache = new Map<string, string>();

  private async customerOfBatchLsx(): Promise<string> {
    const lsx = (this.batchProductionOrder || '').trim();
    if (!lsx) return '';
    if (this.lsxCustomerCache.has(lsx)) return this.lsxCustomerCache.get(lsx) || '';
    let customer = '';
    try {
      const snap = await this.firestore.firestore.collection('work-orders')
        .where('productionOrder', '==', lsx).limit(5).get();
      snap.forEach((d) => { if (!customer) customer = String((d.data() as any)?.customer || '').trim(); });
    } catch (e) {
      console.warn('customerOfBatchLsx', e);
    }
    this.lsxCustomerCache.set(lsx, customer);
    return customer;
  }

  /** Popup bắt nhập Week khi scan lô chưa có Week (mã theo dõi Week). */
  weekAsk: { subtitle: string; note: string; resolve: (r: WeekInputResult | null) => void } | null = null;

  private askWeek(subtitle: string, note: string): Promise<WeekInputResult | null> {
    return new Promise((resolve) => {
      this.weekAsk = { subtitle, note, resolve };
      this.cdr.detectChanges();
    });
  }

  onWeekAskSaved(r: WeekInputResult): void {
    const a = this.weekAsk;
    this.weekAsk = null;
    a?.resolve(r);
  }

  onWeekAskCancelled(): void {
    const a = this.weekAsk;
    this.weekAsk = null;
    a?.resolve(null);
  }

  /**
   * Kiểm Week của lô vừa scan (Week nhập ở Inbound / bổ sung khi xuất).
   * - Mã tick Week ở Danh mục NVL mà lô chưa có Week → bắt nhập Week theo tem, lưu vào lô.
   * - Tem ngoài hạn dùng theo khách của LSX → chặn.
   */
  private async checkScanWeek(materialCode: string, poNumber: string, importDate: string | null): Promise<string | null> {
    if (this.weekAsk) return 'Đang chờ nhập Week cho lô trước — nhập xong rồi scan tiếp.';
    try {
      // Mọi lô của mã (để biết mã có đang theo dõi Week không: PO khác đã có Week)
      const all = await this.firestore.firestore.collection('inventory-materials')
        .where('materialCode', '==', materialCode)
        .get();
      const docs = all.docs.filter((x) => String((x.data() as any).factory || '') === this.selectedFactory);
      const poKey = String(poNumber || '').replace(/\s+/g, '').toUpperCase();
      const poDocs = docs.filter((x) => String((x.data() as any).poNumber || '').replace(/\s+/g, '').toUpperCase() === poKey);
      if (!poDocs.length) return null;
      let lot = poDocs[0];
      if (importDate) {
        const { imdKey } = this.parseImdFromQrPart4(importDate);
        const want = imdKey || this.normalizeImportDate(importDate);
        const hit = poDocs.find((x) => this.normalizeImportDate((x.data() as any).importDate) === want
          || String((x.data() as any).batchNumber || '').trim().startsWith(want));
        if (hit) lot = hit;
      }
      const d = lot.data() as any;
      let week = String(d.week || '').trim();
      let format: WeekFormat = d.weekFormat === 'MMYY' ? 'MMYY' : 'YYWW';
      if (!week) {
        const catalogTracked = await this.nvlCatalog.loadWeekTrackedCodes().catch(() => null);
        // Chỉ mã tick Week ở Danh mục NVL mới bắt nhập Week
        const tracked = isWeekTrackedCode(materialCode, catalogTracked);
        if (!tracked) return null;
        // Lô chưa có Week → nhập theo tem đang scan, lưu vào lô rồi mới kiểm hạn
        const r = await this.askWeek(
          `${materialCode} · PO ${poNumber}${importDate ? ' · IMD ' + importDate : ''}`,
          'Lô này chưa có Week — nhập Week theo tem để xuất (lưu luôn cho lô này).'
        );
        if (!r) return `Chưa nhập Week cho ${materialCode} (PO ${poNumber}) — không cho xuất.`;
        week = r.value;
        format = r.format;
        const by = String(this.batchEmployeeId || '').trim().toUpperCase() || 'outbound';
        await lot.ref.update({ week, weekFormat: format, weekUpdatedAt: new Date(), weekUpdatedBy: by, weekSource: 'outbound' });
        void this.nvlCatalog.ensureWeekTracked(materialCode, by).catch((e) => console.warn('ensureWeekTracked', e));
        // Inbound của lô này cũng ghi Week (best effort)
        void this.firestore.firestore.collection('inbound-materials').where('linkedInventoryDocId', '==', lot.id).limit(5).get()
          .then((s) => s.forEach((x) => void x.ref.update({ week, weekFormat: format, updatedAt: new Date() })))
          .catch(() => undefined);
      }
      const customer = await this.customerOfBatchLsx();
      await this.weekRulesSvc.ensureLoaded(); // Rule Week chỉnh ở Quản lý nguyên liệu
      const win = weekWindow(format, week, customer);
      if (!win || win.status === 'ok') return null;
      return `Không cho xuất: tem ${materialCode} (PO ${poNumber}) ${weekCodeText(format, week)} — ${weekStatusText(win)}.\n` +
        `Khách LSX: ${customer || '—'} · ${win.rule} · được dùng ${fmtDmy(win.from)} → ${fmtDmy(win.to)}.`;
    } catch (e) {
      console.warn('checkScanWeek', e);
      return null;
    }
  }

  private async checkAndWarnIqcLocation(
    materialCode: string,
    poNumber: string,
    importDate: string | null,
    factory: string
  ): Promise<void> {
    try {
      const location = await this.outboundQcRule.getLocationForScan(
        factory,
        materialCode,
        poNumber,
        importDate
      );
      if (!location || !location.toUpperCase().startsWith('IQC')) {
        return;
      }

      const imdLabel = String(importDate || '').trim();
      this.showScanError(
        `⚠️ ${materialCode} (PO: ${poNumber}${imdLabel ? `, IMD: ${imdLabel}` : ''}) đang ở vị trí ${location} (IQC)!\nVui lòng đưa về vị trí kho trước khi xuất.`
      );
    } catch (e) {
      console.error('checkAndWarnIqcLocation error:', e);
    }
  }

  get pxImportOkCount(): number {
    return this.pxImportRows.filter((r) => r.status === 'ok').length;
  }

  get pxImportFailCount(): number {
    return this.pxImportRows.filter((r) => r.status === 'no-match' || r.status === 'short' || r.status === 'error').length;
  }

  get pxImportDoneCount(): number {
    return this.pxImportRows.filter((r) => r.status === 'done').length;
  }

  get pxImportSelectedOkCount(): number {
    return this.pxImportRows.filter((r) => r.selected && r.status === 'ok').length;
  }

  openPxImportPopup(): void {
    this.closeDropdown();
    this.showPxImportPopup = true;
  }

  openBsImportPopup(): void {
    this.closeDropdown();
    this.showBsImportPopup = true;
  }

  closeBsImportPopup(): void {
    if (this.bsImportBusy) return;
    this.showBsImportPopup = false;
  }

  /**
   * Import BS → "Xuất IQC": cùng file, trừ tồn ngay (không scan).
   * Mỗi dòng (mã + PO + lượng) trừ vào dòng tồn cùng mã + PO: ưu tiên vị trí IQC, rồi IMD cũ trước.
   * Ghi outbound-materials (iqcExport) + lưu danh mục pxk-iqc-data. Hỏi xác nhận trước khi ghi.
   */
  async importIqcAndDeduct(): Promise<void> {
    if (this.bsImportBusy || !this.bsImportRows.length) return;
    const factory = this.selectedFactory;
    const rows = this.bsImportRows
      .map((r) => ({ ...r, materialCode: String(r.materialCode || '').trim().toUpperCase(), quantity: Number(r.quantity) || 0 }))
      .filter((r) => r.materialCode.startsWith('B') && r.quantity > 0);
    if (!rows.length) { appAlert('Không có dòng hợp lệ (mã B, lượng > 0).'); return; }
    this.bsImportBusy = true;
    this.cdr.detectChanges();
    try {
      const db = this.firestore.firestore;
      const poKey = (p: unknown) => String(p ?? '').replace(/\s+/g, '').toUpperCase();
      // 1. Đọc tồn các mã
      type Lot = { id: string; po: string; stock: number; location: string; imd: string; importMs: number };
      const lotsByKey = new Map<string, Lot[]>();
      const codes = [...new Set(rows.map((r) => r.materialCode))];
      for (let i = 0; i < codes.length; i += 10) {
        const snap = await db.collection('inventory-materials').where('materialCode', 'in', codes.slice(i, i + 10)).get();
        snap.forEach((doc) => {
          const d = doc.data() as any;
          if (String(d.factory || '') !== factory) return;
          const stock = Math.round(((Number(d.openingStock) || 0) + (Number(d.quantity) || 0) - (Number(d.exported) || 0) - (Number(d.xt) || 0)) * 10000) / 10000;
          if (!(stock > 0)) return;
          const imp: Date | null = d.importDate?.toDate ? d.importDate.toDate() : (d.importDate ? new Date(d.importDate) : null);
          const bn = /^(\d{8,})/.exec(String(d.batchNumber ?? '').trim());
          const imd = bn ? bn[1] : (imp && !isNaN(imp.getTime()) ? imp.toLocaleDateString('en-GB').split('/').join('') : '');
          const key = `${String(d.materialCode || '').trim().toUpperCase()}|${poKey(d.poNumber)}`;
          const list = lotsByKey.get(key) || [];
          list.push({ id: doc.id, po: String(d.poNumber || '').trim(), stock, location: String(d.location || '').trim().toUpperCase(), imd, importMs: imp?.getTime() || 0 });
          lotsByKey.set(key, list);
        });
      }
      lotsByKey.forEach((list) => list.sort((a, b) =>
        Number(!a.location.startsWith('IQC')) - Number(!b.location.startsWith('IQC')) || a.importMs - b.importMs));

      // 2. Phân bổ (không trừ quá tồn); nhiều dòng cùng mã + PO dùng chung tồn
      const remainById = new Map<string, number>();
      const plan = rows.map((r) => {
        const lots = lotsByKey.get(`${r.materialCode}|${poKey(r.po)}`) || [];
        let need = r.quantity;
        const takes: Array<{ lot: Lot; qty: number }> = [];
        for (const lot of lots) {
          if (need <= 1e-9) break;
          const left = remainById.has(lot.id) ? remainById.get(lot.id)! : lot.stock;
          const q = Math.round(Math.min(left, need) * 10000) / 10000;
          if (q <= 0) continue;
          takes.push({ lot, qty: q });
          remainById.set(lot.id, Math.round((left - q) * 10000) / 10000);
          need = Math.round((need - q) * 10000) / 10000;
        }
        const deducted = Math.round((r.quantity - need) * 10000) / 10000;
        return { row: r, takes, deducted, shortage: need > 1e-9 ? need : 0 };
      });
      const total = plan.reduce((s, p) => s + p.deducted, 0);
      const short = plan.filter((p) => p.shortage > 0);
      const fmt = (n: number) => n.toLocaleString('vi-VN');
      const shortTxt = short.slice(0, 8).map((p) => `• ${p.row.materialCode} · PO ${p.row.po} · thiếu ${fmt(p.shortage)}`).join('\n');
      if (!confirm(
        `Xuất IQC — trừ tồn ${factory} NGAY (không scan):\n` +
        `${plan.length} dòng · trừ tổng ${fmt(Math.round(total * 10000) / 10000)}\n` +
        (short.length ? `\n⚠️ ${short.length} dòng không đủ tồn đúng mã + PO (chỉ trừ phần có):\n${shortTxt}${short.length > 8 ? '\n…' : ''}\n` : '') +
        `\nTiếp tục trừ tồn?`
      )) return;

      // 3. Ghi: trừ tồn + bản ghi xuất (iqcExport) + danh mục import
      const now = new Date();
      const by = String(this.operatorSessionId || '').trim().toUpperCase();
      const incById = new Map<string, number>();
      const ops: Array<(b: any) => void> = [];
      for (const p of plan) {
        for (const t of p.takes) {
          incById.set(t.lot.id, (incById.get(t.lot.id) || 0) + t.qty);
          ops.push((b) => b.set(db.collection('outbound-materials').doc(), {
            factory, materialCode: p.row.materialCode, poNumber: t.lot.po, exportQuantity: t.qty,
            unit: p.row.unit || '', productionOrder: String(p.row.lsx || '').trim(), importDate: t.lot.imd,
            location: t.lot.location, exportDate: now, createdAt: now, iqcExport: true, employeeId: by || 'IQC'
          }));
        }
      }
      incById.forEach((q, id) => ops.push((b) => b.update(db.collection('inventory-materials').doc(id), {
        exported: firebase.default.firestore.FieldValue.increment(Math.round(q * 10000) / 10000), updatedAt: now
      })));
      ops.push((b) => b.set(db.collection('pxk-iqc-data').doc(), {
        factory, fileName: this.bsImportFileName || '', importedAt: now, importedBy: by,
        lines: plan.map((p) => ({
          lsx: p.row.lsx || '', materialCode: p.row.materialCode, po: p.row.po, quantity: p.row.quantity,
          unit: p.row.unit || '', tenVatTu: p.row.tenVatTu || '', deducted: p.deducted, shortage: p.shortage
        }))
      }));
      for (let i = 0; i < ops.length; i += 400) {
        const batch = db.batch();
        ops.slice(i, i + 400).forEach((op) => op(batch));
        await batch.commit();
      }
      this.showBsImportPopup = false;
      this.bsImportRows = [];
      this.bsImportFileName = '';
      appAlert(`✅ Đã xuất IQC ${plan.length} dòng — trừ tồn ${fmt(Math.round(total * 10000) / 10000)}` +
        (short.length ? `\n⚠️ ${short.length} dòng thiếu tồn (xem Danh mục Xuất IQC).` : '.'));
    } catch (e: any) {
      console.error('[IQC] importIqcAndDeduct', e);
      appAlert('❌ Lỗi Xuất IQC: ' + (e?.message || e));
    } finally {
      this.bsImportBusy = false;
      this.cdr.detectChanges();
    }
  }

  /** Danh mục Xuất IQC (chỉ xem). */
  showIqcList = false;
  iqcListLoading = false;
  iqcListQuery = '';
  iqcListRows: Array<{ at: Date | null; by: string; file: string; lsx: string; code: string; name: string; po: string; qty: number; unit: string; deducted: number; shortage: number }> = [];

  async openIqcList(): Promise<void> {
    this.closeDropdown();
    this.showIqcList = true;
    this.iqcListLoading = true;
    this.iqcListQuery = '';
    this.cdr.detectChanges();
    try {
      const snap = await this.firestore.firestore.collection('pxk-iqc-data').where('factory', '==', this.selectedFactory).get();
      const rows: typeof this.iqcListRows = [];
      snap.forEach((doc) => {
        const d = doc.data() as any;
        const at: Date | null = d.importedAt?.toDate ? d.importedAt.toDate() : (d.importedAt ? new Date(d.importedAt) : null);
        for (const l of (d.lines || [])) {
          rows.push({
            at, by: String(d.importedBy || ''), file: String(d.fileName || ''), lsx: String(l.lsx || ''),
            code: String(l.materialCode || ''), name: String(l.tenVatTu || ''), po: String(l.po || ''),
            qty: Number(l.quantity) || 0, unit: String(l.unit || ''), deducted: Number(l.deducted) || 0, shortage: Number(l.shortage) || 0
          });
        }
      });
      this.iqcListRows = rows.sort((a, b) => (b.at?.getTime() || 0) - (a.at?.getTime() || 0));
    } catch (e: any) {
      appAlert('❌ Không đọc được danh mục Xuất IQC: ' + (e?.message || e));
    } finally {
      this.iqcListLoading = false;
      this.cdr.detectChanges();
    }
  }

  get iqcListFiltered() {
    const q = this.iqcListQuery.trim().toUpperCase();
    if (!q) return this.iqcListRows;
    return this.iqcListRows.filter((r) =>
      [r.code, r.po, r.lsx, r.name, r.by, r.file].some((v) => String(v).toUpperCase().includes(q)));
  }

  downloadBsImportTemplate(): void {
    const ws = XLSX.utils.json_to_sheet([
      { LSX: '', 'Mã': 'B005001', PO: 'KZPO0726/0001', 'Lượng': 10, 'ĐVT': 'PCS', 'Tên VT': 'Ví dụ không LSX → LSX Chung' },
      { LSX: 'KZLSX0326/0001', 'Mã': 'B002010', PO: 'KZPO0726/0002', 'Lượng': 5, 'ĐVT': 'SET', 'Tên VT': 'Có LSX thì giữ nguyên' }
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Import BS');
    XLSX.writeFile(wb, `Import_BS_template_${this.selectedFactory}.xlsx`);
  }

  pickBsImportFile(): void {
    if (this.bsImportBusy) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = (ev: Event) => {
      const file = (ev.target as HTMLInputElement)?.files?.[0];
      if (file) void this.processBsImportFile(file);
    };
    input.click();
  }

  /** Số dòng bị bỏ khi import BS (không phải mã B hoặc lượng ≤ 0). */
  bsImportSkipped = 0;

  private async processBsImportFile(file: File): Promise<void> {
    this.bsImportBusy = true;
    this.bsImportFileName = file.name;
    this.bsImportSkipped = 0;
    this.cdr.detectChanges();
    try {
      const rows = await this.parseBsImportExcel(file);
      if (!rows.length) {
        appAlert('Không đọc được dòng hợp lệ. Cần cột Mã, PO, Lượng (LSX để trống → LSX Chung).\n' +
          'Chỉ nhận mã bắt đầu bằng B và lượng cần xuất > 0' + (this.bsImportSkipped ? ` — đã bỏ ${this.bsImportSkipped} dòng.` : '.'));
        this.bsImportRows = [];
        return;
      }
      this.bsImportRows = rows;
      if (this.bsImportSkipped) {
        appAlert(`ℹ️ Đã bỏ ${this.bsImportSkipped} dòng không phải mã B hoặc lượng cần xuất ≤ 0. Còn ${rows.length} dòng để import.`);
      }
    } catch (e: any) {
      console.error('❌ processBsImportFile:', e);
      appAlert('Lỗi đọc file Import BS: ' + (e?.message || e));
      this.bsImportRows = [];
    } finally {
      this.bsImportBusy = false;
      this.cdr.detectChanges();
    }
  }

  private parseBsImportExcel(file: File): Promise<BsImportPreviewRow[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
          resolve(this.parseBsImportMatrix(matrix));
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  private parseBsImportMatrix(rows: unknown[][]): BsImportPreviewRow[] {
    if (!rows?.length) return [];
    const fold = (s: string) => this.foldPxImportHeader(s);
    const findHeader = (): number => {
      const max = Math.min(40, rows.length);
      for (let r = 0; r < max; r++) {
        const cells = (rows[r] || []).map(c => fold(String(c ?? '')));
        const hasCode = cells.some(c => c.includes('ma vat tu') || c.includes('ma hang') || c === 'ma' || c.includes('material'));
        const hasQty = cells.some(c => c.includes('luong') || c.includes('xuat kho') || c.includes('so luong') || c === 'qty' || c === 'sl');
        if (hasCode && hasQty) return r;
      }
      return 0;
    };
    const headerRow = findHeader();
    const headers = (rows[headerRow] || []).map(c => String(c ?? '').trim());
    const colOf = (...names: string[]): number => {
      for (const name of names) {
        const n = fold(name);
        if (!n) continue;
        const i = headers.findIndex(h => {
          const nh = fold(h);
          if (!nh) return false;
          return nh.includes(n) || n.includes(nh);
        });
        if (i >= 0) return i;
      }
      return -1;
    };

    let idxLsx = colOf('Số lệnh sản xuất', 'So lenh SX', 'LSX', 'Số LSX');
    let idxCode = colOf('Mã vật tư', 'Ma vat tu', 'Mã hàng', 'Mã', 'Material');
    let idxPo = colOf('Số PO', 'So PO', 'PO');
    let idxQty = colOf('Xuất Kho', 'Lượng', 'Số lượng', 'Qty', 'SL');
    let idxUnit = colOf('Đvt', 'DVT', 'Đơn vị');
    let idxTen = colOf('Tên Vật Tư', 'Ten Vat Tu', 'Tên VT');
    let idxMaCtu = colOf('Mã Ctừ', 'Ma Ctu', 'Mã chứng từ');

    // Fallback form PXK cố định nếu thiếu cột
    if (idxCode < 0) idxCode = 5;
    if (idxPo < 0) idxPo = 8;
    if (idxQty < 0) idxQty = 9;
    if (idxUnit < 0) idxUnit = 7;
    if (idxTen < 0) idxTen = 6;
    if (idxLsx < 0) idxLsx = -1; // không có cột LSX → mọi dòng = LSX Chung

    const out: BsImportPreviewRow[] = [];
    const mergeKey = (r: BsImportPreviewRow) =>
      `${r.lsx}|${r.materialCode}|${r.po.replace(/\s+/g, '').toUpperCase()}`;
    const byKey = new Map<string, BsImportPreviewRow>();

    for (let r = headerRow + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      if (idxMaCtu >= 0) {
        const v = String(row[idxMaCtu] ?? '').trim().toUpperCase();
        const isPx = v === 'PX' || v.includes('PX') || v.includes('PHIEU XUAT') || v.includes('PHIẾU XUẤT');
        const isDn = v === 'DN' || v.includes('DN');
        // Có cột Mã Ctừ thì chỉ lấy PX/DN; không có thì lấy mọi dòng có mã
        if (v && !isPx && !isDn) continue;
      }
      const materialCode = String(row[idxCode] ?? '').trim().toUpperCase();
      if (!materialCode) continue;
      const qtyRaw = row[idxQty];
      const quantity = typeof qtyRaw === 'number' ? qtyRaw : parseFloat(String(qtyRaw ?? '0').replace(/,/g, '')) || 0;
      // Xuất BS chỉ nhận mã B và lượng cần xuất > 0
      if (!materialCode.startsWith('B') || !(quantity > 0)) {
        this.bsImportSkipped++;
        continue;
      }
      const po = String(row[idxPo] ?? '').trim();
      const unit = idxUnit >= 0 ? String(row[idxUnit] ?? '').trim() : '';
      const tenVatTu = idxTen >= 0 ? String(row[idxTen] ?? '').trim() : '';
      const lsxRaw = idxLsx >= 0 ? String(row[idxLsx] ?? '').trim() : '';
      const lsx = this.resolveBsImportLsx(lsxRaw);
      const preview: BsImportPreviewRow = { lsx, materialCode, po, quantity, unit, tenVatTu };
      const key = mergeKey(preview);
      const prev = byKey.get(key);
      if (prev) {
        prev.quantity += quantity;
        if (!prev.tenVatTu && tenVatTu) prev.tenVatTu = tenVatTu;
        if (!prev.unit && unit) prev.unit = unit;
      } else {
        byKey.set(key, preview);
      }
    }
    return Array.from(byKey.values());
  }

  get bsImportCommonCount(): number {
    return this.bsImportRows.filter(r => this.isBsCommonLsx(r.lsx)).length;
  }

  async saveBsImportRows(): Promise<void> {
    if (this.bsImportBusy || !this.bsImportRows.length) return;
    this.bsImportBusy = true;
    this.cdr.detectChanges();
    try {
      const factory = this.selectedFactory;
      const byLsx = new Map<string, BsImportPreviewRow[]>();
      for (const row of this.bsImportRows) {
        const lsx = this.resolveBsImportLsx(row.lsx);
        const list = byLsx.get(lsx) || [];
        list.push({ ...row, lsx });
        byLsx.set(lsx, list);
      }

      const lineMergeKey = (l: any): string => {
        const ct = String(l?.soChungTu || '').trim();
        if (ct) return `ct:${ct}|${String(l?.materialCode || '').trim().toUpperCase()}`;
        return `mp:${String(l?.materialCode || '').trim().toUpperCase()}|${String(l?.po || '').replace(/\s+/g, '').toUpperCase()}`;
      };

      let savedDocs = 0;
      let savedLines = 0;
      for (const [lsx, rows] of byLsx.entries()) {
        const isCommon = this.isBsCommonLsx(lsx);
        const lsxForDoc = isCommon ? BS_COMMON_LSX : lsx;
        const docId = isCommon
          ? this.bsCommonDocId(factory)
          : `${factory}_${lsxForDoc.replace(/\//g, '_').replace(/[^a-zA-Z0-9_-]/g, '_')}`;

        const newLines = rows.map(r => {
          const line: any = {
            materialCode: r.materialCode,
            po: r.po,
            quantity: r.quantity,
            done: false
          };
          if (r.unit) line.unit = r.unit;
          if (r.tenVatTu) line.tenVatTu = r.tenVatTu;
          return line;
        });

        let linesToSave = newLines;
        try {
          const prevSnap = await this.firestore.collection('pxk-bs-data').doc(docId).get().toPromise();
          if (prevSnap?.exists) {
            const prevLines: any[] = ((prevSnap.data() as any)?.lines || []) as any[];
            const map = new Map<string, any>();
            prevLines.forEach(l => map.set(lineMergeKey(l), { ...l }));
            for (const l of newLines) {
              const k = lineMergeKey(l);
              const old = map.get(k);
              if (old && (old.deletedAt || old.hidden)) {
                // Dòng cũ đã xóa / ẩn → import lại = dòng mới (trước đây giữ cờ xóa nên import xong không hiện)
                map.set(k, { ...l, done: false });
              } else if (old) {
                map.set(k, { ...old, ...l, done: !!old.done });
              } else {
                map.set(k, { ...l, done: false });
              }
            }
            linesToSave = [...map.values()];
          }
        } catch (mergeErr) {
          console.warn('[Import BS] merge existing failed', mergeErr);
        }

        await this.firestore.collection('pxk-bs-data').doc(docId).set({
          lsx: lsxForDoc,
          factory,
          lines: linesToSave,
          importedAt: new Date(),
          isBoSung: true
        });
        savedDocs++;
        savedLines += newLines.length;
      }

      this.showBsImportPopup = false;
      this.bsImportRows = [];
      this.bsImportFileName = '';
      this.switchExportMode('BS');
      await this.loadBsItems();
      appAlert(
        `Đã import BS: ${savedLines} dòng → ${savedDocs} phiếu (${factory}).\n` +
        `Không có LSX → gán "${BS_COMMON_LSX}".`
      );
    } catch (e: any) {
      console.error('[Import BS] save failed', e);
      appAlert('Lỗi lưu Import BS: ' + (e?.message || e));
    } finally {
      this.bsImportBusy = false;
      this.cdr.detectChanges();
    }
  }

  closePxImportPopup(): void {
    if (this.pxImportBusy) return;
    this.showPxImportPopup = false;
  }

  downloadPxImportTemplate(): void {
    const ws = XLSX.utils.json_to_sheet([
      { LSX: 'KZLSX0326/0001', 'Mã': 'B005001', PO: '4500123456', 'Lượng': 10 },
      { LSX: 'KZLSX0326/0001', 'Mã': 'B002010', PO: '4500987654', 'Lượng': 5 }
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Import PX');
    XLSX.writeFile(wb, `Import_PX_template_${this.selectedFactory}.xlsx`);
  }

  pickPxImportFile(): void {
    if (this.pxImportBusy) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = (ev: Event) => {
      const file = (ev.target as HTMLInputElement)?.files?.[0];
      if (file) void this.processPxImportFile(file);
    };
    input.click();
  }

  private async processPxImportFile(file: File): Promise<void> {
    this.pxImportBusy = true;
    this.pxImportFileName = file.name;
    this.cdr.detectChanges();
    try {
      const parsed = await this.parsePxImportExcel(file);
      if (!parsed.length) {
        appAlert('Không đọc được dòng hợp lệ. File cần cột LSX, Mã, PO, Lượng.');
        return;
      }
      this.pxImportRows = parsed;
      await this.matchPxImportRows();
    } catch (e: any) {
      console.error('❌ processPxImportFile:', e);
      appAlert('Lỗi đọc file Import PX: ' + (e?.message || e));
    } finally {
      this.pxImportBusy = false;
      this.cdr.detectChanges();
    }
  }

  private parsePxImportExcel(file: File): Promise<PxImportRow[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e: ProgressEvent<FileReader>) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const objects = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
          const byKey = new Map<string, PxImportRow>();
          const merge = (row: PxImportRow | null) => {
            if (!row) return;
            const key = `${row.lsx}|${row.materialCode}|${row.poNumber}`;
            const prev = byKey.get(key);
            if (!prev) {
              byKey.set(key, row);
              return;
            }
            prev.qty += row.qty;
          };
          for (const obj of objects) merge(this.mapPxImportExcelRow(obj));
          if (!byKey.size) {
            const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
            for (let i = 0; i < matrix.length; i++) {
              merge(this.mapPxImportExcelCells(matrix[i] || [], i === 0));
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

  private mapPxImportExcelRow(row: Record<string, unknown>): PxImportRow | null {
    let lsx = '';
    let code = '';
    let po = '';
    let qty: number | null = null;
    for (const [key, val] of Object.entries(row)) {
      const kind = this.pxImportHeaderKind(key);
      if (kind === 'lsx' && !lsx) lsx = this.normalizePxImportLsx(val);
      else if (kind === 'code' && !code) code = this.normalizePxImportCode(val);
      else if (kind === 'po' && !po) po = this.normalizePxImportPo(val);
      else if (kind === 'qty' && qty == null) qty = this.parsePxImportQty(val);
    }
    if (!lsx || !code || !po || qty == null || qty <= 0) {
      const values = Object.values(row);
      lsx = lsx || this.normalizePxImportLsx(values[0]);
      code = code || this.normalizePxImportCode(values[1]);
      po = po || this.normalizePxImportPo(values[2]);
      if (qty == null) qty = this.parsePxImportQty(values[3]);
    }
    if (!lsx || !code || !po || qty == null || qty <= 0) return null;
    return this.emptyPxImportRow(lsx, code, po, qty);
  }

  private mapPxImportExcelCells(line: unknown[], maybeHeader: boolean): PxImportRow | null {
    const head = this.foldPxImportHeader(String(line[0] ?? '') + ' ' + String(line[1] ?? '') + ' ' + String(line[2] ?? ''));
    if (maybeHeader && /lsx|ma|po|luong|qty/i.test(head)) return null;
    const lsx = this.normalizePxImportLsx(line[0]);
    const code = this.normalizePxImportCode(line[1]);
    const po = this.normalizePxImportPo(line[2]);
    const qty = this.parsePxImportQty(line[3]);
    if (!lsx || !code || !po || qty == null || qty <= 0) return null;
    return this.emptyPxImportRow(lsx, code, po, qty);
  }

  private emptyPxImportRow(lsx: string, materialCode: string, poNumber: string, qty: number): PxImportRow {
    return {
      lsx,
      materialCode,
      poNumber,
      qty,
      imd: '',
      available: 0,
      status: 'no-match',
      message: '',
      selected: false,
      allocations: []
    };
  }

  private pxImportHeaderKind(header: string): 'lsx' | 'code' | 'po' | 'qty' | '' {
    const s = this.foldPxImportHeader(header);
    if (!s) return '';
    if (s === 'lsx' || s.includes('lenh sx') || s.includes('lenh san xuat') || s.includes('so lenh') || s.includes('production') || s.includes('work order')) {
      return 'lsx';
    }
    if (/(^|\s)po(\s|$)/.test(s) || s.includes('purchase')) return 'po';
    if (s === 'sl' || s === 'qty' || s.includes('luong') || s.includes('quantity') || s.includes('so luong')) return 'qty';
    if (s === 'ma' || s.includes('ma hang') || s.includes('material') || s.includes('item') || s === 'code' || s.includes('ma nvl')) return 'code';
    return '';
  }

  private foldPxImportHeader(s: string): string {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private normalizePxImportLsx(raw: unknown): string {
    return String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  }

  private normalizePxImportCode(raw: unknown): string {
    return String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  }

  private normalizePxImportPo(raw: unknown): string {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return String(Math.round(raw));
    }
    let s = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
    if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
    if (/e[+-]?\d+$/i.test(s)) {
      const n = Number(s);
      if (Number.isFinite(n)) return String(Math.round(n));
    }
    return s;
  }

  private parsePxImportQty(raw: unknown): number | null {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    const n = Number(String(raw).replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }

  private pxImportPoMatch(a: string, b: string): boolean {
    if (!a || !b) return false;
    if (a === b) return true;
    const da = a.replace(/\D/g, '');
    const db = b.replace(/\D/g, '');
    if (da && db && da === db) return true;
    if (da && db && da.replace(/^0+/, '') === db.replace(/^0+/, '')) return true;
    return false;
  }

  async rematchPxImportRows(): Promise<void> {
    if (this.pxImportBusy) return;
    this.pxImportBusy = true;
    this.cdr.detectChanges();
    try {
      await this.matchPxImportRows();
    } finally {
      this.pxImportBusy = false;
      this.cdr.detectChanges();
    }
  }

  private async matchPxImportRows(): Promise<void> {
    const pending = this.pxImportRows.filter((r) => r.status !== 'done');
    if (!pending.length) return;
    const codes = Array.from(new Set(pending.map((r) => this.normalizePxImportCode(r.materialCode)).filter(Boolean)));
    const lots = await this.fetchPxImportInventoryLots(codes);
    for (const row of pending) {
      row.lsx = this.normalizePxImportLsx(row.lsx);
      row.materialCode = this.normalizePxImportCode(row.materialCode);
      row.poNumber = this.normalizePxImportPo(row.poNumber);
      row.qty = Number(row.qty) || 0;
      const matchedLots = lots
        .filter((lot) =>
          this.normalizePxImportCode(lot.materialCode) === row.materialCode &&
          this.pxImportPoMatch(this.normalizePxImportPo(lot.poNumber), row.poNumber)
        )
        .sort((a, b) => a.sortKey - b.sortKey);
      const available = matchedLots.reduce((s, lot) => s + Math.max(0, lot.available), 0);
      row.available = Math.round(available * 10000) / 10000;
      row.allocations = [];
      row.imd = '';
      if (!matchedLots.length) {
        row.status = 'no-match';
        row.selected = false;
        row.message = 'Không khớp Mã + PO trên tồn kho';
        continue;
      }
      if (row.qty <= 0) {
        row.status = 'no-match';
        row.selected = false;
        row.message = 'Lượng phải > 0';
        continue;
      }
      let need = row.qty;
      for (const lot of matchedLots) {
        if (need <= 1e-9) break;
        if (lot.available <= 1e-9) continue;
        const take = Math.min(need, lot.available);
        row.allocations.push({
          inventoryId: lot.id,
          imd: lot.imd,
          qty: take,
          available: lot.available,
          location: lot.location
        });
        lot.available -= take;
        need -= take;
      }
      row.imd = row.allocations.map((a) => a.imd).filter(Boolean).join(', ');
      if (need > 1e-6) {
        row.status = 'short';
        row.selected = false;
        row.message = `Thiếu tồn: cần ${row.qty}, còn ${row.available}`;
      } else {
        row.status = 'ok';
        row.selected = true;
        row.message = row.imd ? `IMD cũ hơn: ${row.imd}` : 'Khớp tồn kho';
      }
    }
  }

  private async fetchPxImportInventoryLots(codes: string[]): Promise<Array<{
    id: string;
    materialCode: string;
    poNumber: string;
    available: number;
    imd: string;
    location: string;
    sortKey: number;
  }>> {
    const out: Array<{
      id: string;
      materialCode: string;
      poNumber: string;
      available: number;
      imd: string;
      location: string;
      sortKey: number;
    }> = [];
    const uniq = Array.from(new Set(codes.filter(Boolean)));
    const parallel = 10;
    for (let i = 0; i < uniq.length; i += parallel) {
      const chunk = uniq.slice(i, i + parallel);
      const snaps = await Promise.all(chunk.map((code) =>
        this.firestore.collection('inventory-materials', (ref) =>
          ref.where('factory', '==', this.selectedFactory).where('materialCode', '==', code).limit(2000)
        ).get().toPromise()
      ));
      snaps.forEach((snap) => {
        if (!snap || snap.empty) return;
        snap.docs.forEach((doc) => {
          const d = doc.data() as any;
          const loc = String(d.location || '').toUpperCase();
          if (loc === 'TIEUHUY' || loc.startsWith('TIEUHUY')) return;
          const opening = d.openingStock != null ? Number(d.openingStock) : 0;
          const available = opening + (Number(d.quantity) || 0) - (Number(d.exported) || 0) - (Number(d.xt) || 0);
          const imd = this.normalizeImportDate(d.importDate) || String(d.importDate || '').trim();
          out.push({
            id: doc.id,
            materialCode: String(d.materialCode || ''),
            poNumber: String(d.poNumber || ''),
            available,
            imd,
            location: String(d.location || ''),
            sortKey: this.pxImportImdSortKey(imd, d.importDate)
          });
        });
      });
    }
    return out;
  }

  private pxImportImdSortKey(imd: string, raw: unknown): number {
    if (/^\d{8}$/.test(imd)) {
      const dd = Number(imd.slice(0, 2));
      const mm = Number(imd.slice(2, 4));
      const yyyy = Number(imd.slice(4, 8));
      const t = new Date(yyyy, mm - 1, dd).getTime();
      if (Number.isFinite(t)) return t;
    }
    if (raw instanceof Date) return raw.getTime();
    if (raw && typeof (raw as any).toDate === 'function') {
      try { return (raw as any).toDate().getTime(); } catch { /* ignore */ }
    }
    if (raw && typeof (raw as any).seconds === 'number') return (raw as any).seconds * 1000;
    return Number.MAX_SAFE_INTEGER;
  }

  async applyPxImportSelected(): Promise<void> {
    if (this.pxImportBusy) return;
    this.pxImportBusy = true;
    this.cdr.detectChanges();
    try {
      const keepUnselected = new Set(this.pxImportRows.filter((r) => r.status === 'ok' && !r.selected));
      await this.matchPxImportRows();
      keepUnselected.forEach((r) => {
        if (r.status === 'ok') r.selected = false;
      });
    } catch (e: any) {
      this.pxImportBusy = false;
      this.cdr.detectChanges();
      appAlert('Lỗi đối chiếu tồn: ' + (e?.message || e));
      return;
    }
    const rows = this.pxImportRows.filter((r) => r.selected && r.status === 'ok' && r.allocations.length);
    if (!rows.length) {
      this.pxImportBusy = false;
      this.cdr.detectChanges();
      appAlert('Không có dòng khớp để trừ tồn. Sửa Mã/PO rồi bấm Đối chiếu lại.');
      return;
    }
    const lineCount = rows.reduce((s, r) => s + r.allocations.length, 0);
    if (!confirm(`Trừ tồn ${rows.length} mã/PO (${lineCount} dòng IMD, kho ${this.selectedFactory})?`)) {
      this.pxImportBusy = false;
      this.cdr.detectChanges();
      return;
    }
    const exportedBy = this.batchEmployeeId || 'IMPORT-PX';
    let ok = 0;
    let fail = 0;
    try {
      for (const row of rows) {
        try {
          for (const alloc of row.allocations) {
            const now = new Date();
            await this.firestore.collection('outbound-materials').add({
              factory: this.selectedFactory,
              materialCode: row.materialCode,
              poNumber: row.poNumber,
              quantity: alloc.qty,
              unit: 'PCS',
              exportQuantity: alloc.qty,
              ...(this.leExportQty(row.materialCode, alloc.qty, row.poNumber) > 0
                ? { leQty: this.leExportQty(row.materialCode, alloc.qty, row.poNumber) }
                : {}),
              scanCount: 1,
              exportDate: now,
              location: alloc.location || '',
              exportedBy,
              employeeId: exportedBy,
              productionOrder: row.lsx,
              batch: alloc.imd || null,
              batchNumber: alloc.imd || null,
              importDate: alloc.imd || null,
              scanMethod: 'IMPORT-PX',
              notes: `Import PX · LSX ${row.lsx}`,
              createdAt: now,
              updatedAt: now
            } as OutboundMaterial);
            const leQty = this.leExportQty(row.materialCode, alloc.qty, row.poNumber);
            await this.firestore.collection('inventory-materials').doc(alloc.inventoryId).update({
              exported: firebase.default.firestore.FieldValue.increment(alloc.qty),
              ...(leQty > 0 ? { xtLe: firebase.default.firestore.FieldValue.increment(leQty) } : {}),
              updatedAt: now
            });
          }
          row.status = 'done';
          row.selected = false;
          row.message = `Đã trừ ${row.qty}` + (row.imd ? ` · IMD ${row.imd}` : '');
          ok += 1;
        } catch (e: any) {
          row.status = 'error';
          row.selected = false;
          row.message = e?.message || 'Lỗi lưu outbound';
          fail += 1;
        }
      }
      this.loadMaterials();
      appAlert(
        `Import PX xong.\nĐã trừ: ${ok} mã/PO.\n` +
        (fail ? `Lỗi lưu: ${fail}.\n` : '') +
        `Không khớp / thiếu tồn: ${this.pxImportFailCount} — sửa tay rồi Đối chiếu lại.`
      );
    } finally {
      this.pxImportBusy = false;
      this.cdr.detectChanges();
    }
  }
}