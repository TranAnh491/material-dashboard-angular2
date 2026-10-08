import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked, ChangeDetectorRef, NgZone } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as QRCode from 'qrcode';
import { getLayoutLocationGroups, LayoutLocGroup, jKhoMatBlocksForRow } from '../materials/layout-location-catalog';

interface PalletItem {
  id: string;
  palletCode: string;
  factory: string;
  createdAt: Date;
  createdBy?: string;
  printCount: number;
}

type InternalTemplateSize = 'A3' | 'A4' | 'A5';

interface InternalTemplateItem {
  id: string;
  name: string;
  content: string;
  contentEn: string;
  bilingual: boolean;
  pageCount: number;
  size: InternalTemplateSize;
  previewUrl: string;
  createdAt: Date;
}

interface InternalTemplatePage {
  viLines: string[];
  enLines: string[];
  viFontPx: number;
  viLinePx: number;
  enFontPx: number;
  enLinePx: number;
  iconH: number;
}

type InternalTemplateScene = 'door' | 'stop' | 'staff' | 'talk' | 'battery' | 'cart' | 'bin' | 'pallet' | 'note';

const ALLOWED_EMPLOYEE_PREFIXES = ['ASP0106', 'ASP0119', 'ASP1761', 'ASP0538', 'ASP0384'];
const SCAN_MAX_MS = 150; // Coi là quét nếu nhập xong trong 150ms
type PalletLabelSizeKey = '100x100' | '130x100';

interface PalletLabelDimensions {
  pageWidthMm: number;
  pageHeightMm: number;
  innerWidthMm: number;
  innerHeightMm: number;
  qrSizeMm: number;
  factoryFontPt: number;
  numberFontPt: number;
  footerFontPt: number;
}

@Component({
  selector: 'app-pallet-id',
  templateUrl: './pallet-id.component.html',
  styleUrls: ['./pallet-id.component.scss']
})
export class PalletIdComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('scanEmployeeInput') scanEmployeeInput?: ElementRef<HTMLInputElement>;
  private destroy$ = new Subject<void>();

  // Factory selection
  selectedFactory: string = 'ASM1';
  factories: string[] = ['ASM1', 'ASM2'];
  palletSearch = '';

  // Pallet data
  pallets: PalletItem[] = [];
  /** Mảng gắn vào bảng. Gán mới sau mỗi lần tải / tìm, để dòng hiện ngay khi mở trang. */
  listPallets: PalletItem[] = [];
  isLoading: boolean = false;

  // Create new pallet
  isCreating: boolean = false;

  // Print
  selectedPallet: PalletItem | null = null;
  showPrintPreview: boolean = false;
  palletLabelSizeById: Record<string, PalletLabelSizeKey> = {};

  // Scan employee (in lần 2 trở đi)
  showScanEmployeeModal: boolean = false;
  pendingPrintPallet: PalletItem | null = null;
  scannedEmployeeCode: string = '';
  scanEmployeeError: string = '';
  private scanFirstKeyTime: number = 0;
  private scanLastKeyTime: number = 0;
  private focusScanInputOnce: boolean = false;

  // Tạo tem tạm
  showTempLabelModal: boolean = false;
  tempLabelQuantity: number = 1;
  tempLabelError: string = '';
  isPrintingTempLabels: boolean = false;

  // In số (tem 57×32mm hoặc 100×100mm, từ số bắt đầu đến số kết thúc)
  showNumberLabelModal = false;
  numberLabelSizeMm: 57 | 100 = 100;
  numberLabelStart = 1;
  numberLabelEnd = 1;
  numberLabelError = '';
  isPrintingNumberLabels = false;

  private readonly PASS_LABEL_PASSWORD = '2026';
  showPassPasswordModal = false;
  showPassLabelModal = false;
  passLabelPassword = '';
  passLabelPasswordError = '';
  passLabelQuantity = 1;
  passLabelError = '';
  isPrintingPassLabels = false;

  // In tem Đã Kiểm (57×32mm, không cần mật khẩu)
  showDaKiemLabelModal = false;
  daKiemLabelQuantity = 1;
  daKiemLabelError = '';
  isPrintingDaKiemLabels = false;

  // In tem NVL Trả / Return (57×32mm, cùng khổ tem PASS)
  showReturnLabelModal = false;
  returnLabelQuantity = 1;
  returnLabelError = '';
  isPrintingReturnLabels = false;

  showSafetyLabelModal = false;
  safetyLabelQuantity = 1;
  isPrintingSafetyLabels = false;
  readonly safetyLabels: Array<{ id: string; vi: string; en: string }> = [
    { id: 'load400', vi: 'Tải trọng tối đa 400kg / pallet', en: 'Maximum load 400kg / pallet' },
    { id: 'h3', vi: 'Chiều cao tối đa 3m', en: 'Maximum height 3m' },
    { id: 'h2', vi: 'Chiều cao tối đa 2m', en: 'Maximum height 2m' },
    { id: 'noWay', vi: 'Không đi lối này', en: 'Do not go this way' },
    { id: 'noFork', vi: 'Cấm xe nâng cao', en: 'No high forklifts' },
    { id: 'ppe', vi: 'Tuân thủ quy định về PPE', en: 'Comply with PPE regulations' }
  ];

  showFormSignModal = false;
  formSignSize: 'A4' | 'A5' = 'A4';
  isPrintingFormSigns = false;

  showInternalTemplateModal = false;
  showInternalTemplateForm = false;
  isLoadingInternalTemplates = false;
  isSavingInternalTemplate = false;
  internalTemplateError = '';
  internalTemplateName = '';
  internalTemplateContent = '';
  internalTemplateContentEn = '';
  internalTemplatePages = 1;
  internalTemplateSize: InternalTemplateSize = 'A4';
  internalTemplateBilingual = false;
  internalTemplatePreviewUrl = '';
  internalTemplates: InternalTemplateItem[] = [];
  readonly internalTemplateSizes: InternalTemplateSize[] = ['A3', 'A4', 'A5'];
  private readonly internalTemplatePageMm: Record<InternalTemplateSize, { w: number; h: number }> = {
    A3: { w: 297, h: 420 },
    A4: { w: 210, h: 297 },
    A5: { w: 148, h: 210 }
  };
  private internalMeasureCanvas?: HTMLCanvasElement;
  readonly formSigns: Array<{ id: string; vi: string; en: string }> = [
    { id: 'closeDoor', vi: 'Vui lòng đóng cửa khi ra vào', en: 'Please close the door when entering or leaving' },
    { id: 'noEntry', vi: 'Không phận sự miễn vào', en: 'No unauthorized entry' },
    { id: 'whStaff', vi: 'Chỉ nhân viên Kho sử dụng', en: 'Warehouse staff only' },
    { id: 'tellWh', vi: 'Báo quản lý Kho khi cần lấy hàng', en: 'Notify warehouse management when goods need to be picked up' },
    { id: 'noBattery', vi: 'Không để Pin dự phòng trong tủ', en: 'Do not store spare batteries in the cabinet' },
    { id: 'batteryTools', vi: 'Khu vực để dụng cụ có Pin', en: 'Battery tool area' },
    { id: 'trolley', vi: 'Khu vực để xe đẩy', en: 'Trolley area' },
    { id: 'plasticBin', vi: 'Khu vực để Thùng nhựa', en: 'Plastic bin area' },
    { id: 'palletArea', vi: 'Khu vực để Pallet', en: 'Pallet area' }
  ];

  /** Tem vị trí kho J — màn hình sơ đồ, tem A3/A4/A5/A6, song ngữ. */
  showJLocLabelModal = false;
  jLocQuery = '';
  jLocExpandedId = '';
  jLocSelected = new Set<string>();
  jLocError = '';
  isPrintingJLocLabels = false;
  jLocLabelSize: 'A3' | 'A4' | 'A5' | 'A6' = 'A4';
  readonly jLocSizes: Array<'A3' | 'A4' | 'A5' | 'A6'> = ['A3', 'A4', 'A5', 'A6'];
  jLocOrient: 'doc' | 'ngang' = 'doc';
  jLocPrintQty = 1;
  private jLocLogoDataUrl = '';
  readonly jLocGroups: LayoutLocGroup[] = getLayoutLocationGroups('J');

  /** Tem kệ (dãy R/S) — tem mâm hoặc label đầu kệ */
  showShelfLabelModal = false;
  shelfLabelQuery = '';
  shelfLabelSelected = new Set<string>();
  shelfLabelError = '';
  isPrintingShelfLabels = false;
  /** mam = từng mâm; dauKe = A4/A5; dauKeNho = 8×12cm; palletSeq = R10-1…R10-N */
  shelfLabelKind: 'mam' | 'dauKe' | 'dauKeNho' | 'palletSeq' = 'mam';
  shelfLabelSize: '60x130' | '100x150' = '60x130';
  /** Số tem theo thứ tự pallet (R10-1 … R10-N) */
  shelfLabelPalletCount = 30;
  private readonly shelfLabelRList: string[] = Array.from({ length: 28 }, (_, i) =>
    `R${String(i + 1).padStart(2, '0')}`
  );
  private readonly shelfLabelSList: string[] = Array.from({ length: 25 }, (_, i) =>
    `S${String(i + 1).padStart(2, '0')}`
  );
  private shelfLabelSlotsByAisle = new Map<string, string[]>();

  constructor(
    private firestore: AngularFirestore,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {}

  ngOnInit(): void {
    this.loadPallets();
    this.buildShelfLabelSlotIndex();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  ngAfterViewChecked(): void {
    if (this.showScanEmployeeModal && this.focusScanInputOnce && this.scanEmployeeInput?.nativeElement) {
      this.scanEmployeeInput.nativeElement.focus();
      this.focusScanInputOnce = false;
    }
  }

  // Load pallets from Firestore
  loadPallets(): void {
    this.isLoading = true;
    
    this.firestore.collection('pallets', ref =>
      ref.where('factory', '==', this.selectedFactory)
    ).get()
      .pipe(takeUntil(this.destroy$))
      .subscribe(snapshot => {
        this.pallets = snapshot.docs.map(doc => {
          const data = doc.data() as any;
          const id = doc.id;
          return {
            id,
            palletCode: data.palletCode || '',
            factory: data.factory || '',
            createdAt: data.createdAt?.toDate() || new Date(),
            createdBy: data.createdBy || '',
            printCount: data.printCount || 0
          };
        });
        // Sắp xếp client-side theo createdAt giảm dần
        this.pallets.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        this.ngZone.run(() => {
          this.isLoading = false;
          this.applyPalletSearch();
          this.cdr.detectChanges();
        });
        console.log(`✅ Loaded ${this.pallets.length} pallets for ${this.selectedFactory}`);
      }, error => {
        console.error('Error loading pallets:', error);
        this.ngZone.run(() => {
          this.isLoading = false;
          this.listPallets = [];
          this.cdr.detectChanges();
        });
      });
  }

  applyPalletSearch(): void {
    const q = String(this.palletSearch || '').trim().toUpperCase();
    if (!q) {
      this.listPallets = this.pallets.slice(0, 10);
      return;
    }
    this.listPallets = this.pallets.filter((p) =>
      p.palletCode.toUpperCase().includes(q) || p.factory.toUpperCase().includes(q)
    );
  }

  trackPallet(_index: number, pallet: PalletItem): string {
    return pallet.id;
  }

  selectFactory(factory: string): void {
    if (this.selectedFactory === factory) return;
    this.selectedFactory = factory;
    this.palletSearch = '';
    this.onFactoryChange();
  }

  // Change factory
  onFactoryChange(): void {
    this.loadPallets();
  }

  // Get next pallet number — dạng P + 4 số (P0001, P0002…), dãy dùng chung không theo F1/F2
  async getNextPalletNumber(): Promise<string> {
    // Query toàn collection để lấy max Pxxxx (không phụ thuộc nhà máy)
    const snapshot = await this.firestore.collection('pallets', ref =>
      ref.limit(5000)
    ).get().toPromise();

    let maxNumber = 0;

    if (snapshot && !snapshot.empty) {
      snapshot.docs.forEach(doc => {
        const data = doc.data() as any;
        const code = String(data.palletCode || '').trim().toUpperCase();
        const match = code.match(/^P(\d{1,4})$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (Number.isFinite(num) && num > maxNumber) {
            maxNumber = num;
          }
        }
      });
    }

    const next = maxNumber + 1;
    if (next > 9999) {
      throw new Error('Đã hết dải mã pallet P0001–P9999.');
    }

    return `P${next.toString().padStart(4, '0')}`;
  }

  // Create new pallet
  async createNewPallet(): Promise<void> {
    if (this.isCreating) return;
    
    this.isCreating = true;
    
    try {
      const palletCode = await this.getNextPalletNumber();
      
      await this.firestore.collection('pallets').add({
        palletCode,
        factory: this.selectedFactory,
        createdAt: new Date(),
        createdBy: 'user',
        printCount: 0
      });

      console.log(`✅ Created new pallet: ${palletCode}`);
      this.loadPallets();
    } catch (error) {
      console.error('Error creating pallet:', error);
      alert('Lỗi khi tạo pallet mới: ' + ((error as Error)?.message || error));
    } finally {
      this.isCreating = false;
    }
  }

  // Open print preview (hiện tại không khóa in lần 2 trở đi)
  openPrintPreview(pallet: PalletItem): void {
    this.selectedPallet = pallet;
    this.showPrintPreview = true;
  }

  getPalletLabelSize(pallet: PalletItem): PalletLabelSizeKey {
    return this.palletLabelSizeById[pallet.id] || '130x100';
  }

  setPalletLabelSize(pallet: PalletItem, size: PalletLabelSizeKey): void {
    this.palletLabelSizeById[pallet.id] = size;
  }

  getPalletLabelSizeDisplay(size: PalletLabelSizeKey): string {
    return size === '100x100' ? '100mm × 100mm' : '130mm × 100mm';
  }

  get selectedPalletLabelSize(): PalletLabelSizeKey {
    return this.selectedPallet ? this.getPalletLabelSize(this.selectedPallet) : '130x100';
  }

  get selectedPalletInnerSizeDisplay(): string {
    const dims = this.palletLabelDimensions(this.selectedPalletLabelSize);
    return `${dims.innerWidthMm}mm × ${dims.innerHeightMm}mm`;
  }

  get previewLabelStyle(): Record<string, string> {
    const size = this.selectedPalletLabelSize;
    if (size === '100x100') {
      return { width: '200px', height: '200px' };
    }
    return { width: '260px', height: '200px' };
  }

  private palletLabelDimensions(size: PalletLabelSizeKey): PalletLabelDimensions {
    if (size === '100x100') {
      return {
        pageWidthMm: 100,
        pageHeightMm: 100,
        innerWidthMm: 100,
        innerHeightMm: 100,
        qrSizeMm: 68,
        factoryFontPt: 31,
        numberFontPt: 40,
        footerFontPt: 7
      };
    }
    return {
      pageWidthMm: 130,
      pageHeightMm: 100,
      innerWidthMm: 120,
      innerHeightMm: 90,
      qrSizeMm: 58,
      factoryFontPt: 32,
      numberFontPt: 48,
      footerFontPt: 10
    };
  }

  onScanKeydown(event: KeyboardEvent): void {
    const now = Date.now();
    if (this.scannedEmployeeCode === '') {
      this.scanFirstKeyTime = now;
    }
    this.scanLastKeyTime = now;
  }

  confirmScannedEmployee(): void {
    this.scanEmployeeError = '';
    const code = (this.scannedEmployeeCode || '').trim();
    if (!code) {
      this.scanEmployeeError = 'Vui lòng quét mã nhân viên bằng máy quét.';
      return;
    }
    const duration = this.scanLastKeyTime - this.scanFirstKeyTime;
    if (duration > SCAN_MAX_MS) {
      this.scanEmployeeError = 'Vui lòng dùng máy quét, không nhập tay.';
      return;
    }
    const allowed = ALLOWED_EMPLOYEE_PREFIXES.some(prefix => code.startsWith(prefix));
    if (!allowed) {
      this.scanEmployeeError = 'Mã nhân viên không có quyền in thêm.';
      return;
    }
    if (!this.pendingPrintPallet) return;
    this.selectedPallet = this.pendingPrintPallet;
    this.pendingPrintPallet = null;
    this.scannedEmployeeCode = '';
    this.showScanEmployeeModal = false;
    this.showPrintPreview = true;
  }

  closeScanEmployeeModal(): void {
    this.showScanEmployeeModal = false;
    this.pendingPrintPallet = null;
    this.scannedEmployeeCode = '';
    this.scanEmployeeError = '';
  }

  // Close print preview
  closePrintPreview(): void {
    this.selectedPallet = null;
    this.showPrintPreview = false;
  }

  /** Prefixe trên tem 130×100: mã Pxxxx → P; mã cũ F1-/F2- → F1/F2 */
  getPalletFactoryPrefix(factory?: string, palletCode?: string): string {
    const code = String(palletCode || '').trim().toUpperCase();
    if (/^P\d{1,4}$/.test(code)) return 'P';
    if (code.startsWith('F2')) return 'F2';
    if (code.startsWith('F1')) return 'F1';
    const f = String(factory || '').trim().toUpperCase();
    if (f === 'ASM2') return 'F2';
    if (f === 'ASM1') return 'F1';
    return 'P';
  }

  /** Dòng số dưới QR: P0001 → 0001; F1-0123 → 0123 */
  getPalletNumberLine(palletCode?: string): string {
    const code = String(palletCode || '').trim().toUpperCase();
    const pMatch = code.match(/^P(\d{1,4})$/);
    if (pMatch) return pMatch[1].padStart(4, '0');
    const dash = code.match(/-(\d+)$/);
    if (dash) return dash[1];
    const digits = code.match(/(\d+)$/);
    return digits ? digits[1] : code;
  }

  /** Ngày tạo dạng ddmmyy cho tem 100×100 */
  formatDateDdMmYy(date: Date): string {
    if (!date) return '';
    const d = new Date(date);
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear().toString().slice(-2);
    return `${day}${month}${year}`;
  }

  private buildPalletLabelBodyHtml(
    labelSize: PalletLabelSizeKey,
    pallet: PalletItem,
    qrCodeDataUrl: string,
    copyIndex: number
  ): string {
    if (labelSize === '100x100') {
      return `
        <div class="pallet-label-container">
          <div class="pallet-label-code">${pallet.palletCode}</div>
          <div class="pallet-label-qr">
            <img src="${qrCodeDataUrl}" alt="QR Code" />
          </div>
          <div class="pallet-label-footer">
            <span class="pallet-label-date">${this.formatDateDdMmYy(pallet.createdAt)}</span>
            <span class="pallet-label-copy">${copyIndex}/4</span>
          </div>
        </div>
      `;
    }

    const factoryPrefix = this.getPalletFactoryPrefix(pallet.factory, pallet.palletCode);
    const numberLine = this.getPalletNumberLine(pallet.palletCode);
    return `
      <div class="label-container">
        <div class="label-inner">
          <div class="factory-prefix">${factoryPrefix}</div>
          <div class="qr-code">
            <img src="${qrCodeDataUrl}" alt="QR Code" />
          </div>
          <div class="pallet-number">${numberLine}</div>
          <div class="label-footer">
            <div class="created-date">${this.formatDate(pallet.createdAt)}</div>
            <div class="label-number">${copyIndex}/4</div>
          </div>
        </div>
      </div>
    `;
  }

  private buildSquarePrintStyles(dims: PalletLabelDimensions): string {
    const { pageWidthMm, pageHeightMm, qrSizeMm } = dims;

    // Cùng pattern với tem 57×32 (PASS / In số): 1 container = đúng khổ giấy, flex căn giữa
    return `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: Arial, Helvetica, sans-serif;
        padding: 0;
        margin: 0;
        background: #fff;
      }
      @media print {
        body { margin: 0 !important; padding: 0 !important; }
        @page { margin: 0 !important; size: ${pageWidthMm}mm ${pageHeightMm}mm !important; }
        .pallet-label-container {
          width: ${pageWidthMm}mm !important;
          height: ${pageHeightMm}mm !important;
          page-break-after: always !important;
          break-after: page !important;
        }
        .pallet-label-container:last-child {
          page-break-after: avoid !important;
          break-after: avoid !important;
        }
      }
      .pallet-label-container {
        width: ${pageWidthMm}mm;
        height: ${pageHeightMm}mm;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: space-between;
        padding: 5mm 10mm 4mm;
        overflow: hidden;
        page-break-inside: avoid;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .pallet-label-code {
        width: 100%;
        text-align: center;
        font-size: 11mm;
        font-weight: 700;
        line-height: 1.1;
        font-family: 'Courier New', monospace;
        color: #000;
        flex-shrink: 0;
      }
      .pallet-label-qr {
        flex: 1 1 auto;
        width: 100%;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .pallet-label-qr img {
        width: ${qrSizeMm}mm;
        height: ${qrSizeMm}mm;
        max-width: ${qrSizeMm}mm;
        max-height: ${qrSizeMm}mm;
        object-fit: contain;
        display: block;
      }
      .pallet-label-footer {
        width: 100%;
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        flex-shrink: 0;
        min-height: 7mm;
      }
      .pallet-label-date {
        font-size: 6.5mm;
        font-weight: 700;
        line-height: 1;
        color: #000;
      }
      .pallet-label-copy {
        font-size: 5.5mm;
        font-weight: 600;
        line-height: 1;
        color: #000;
      }
    `;
  }

  private buildPalletLabelPrintStyles(labelSize: PalletLabelSizeKey, dims: PalletLabelDimensions): string {
    if (labelSize === '100x100') {
      return this.buildSquarePrintStyles(dims);
    }

    const {
      pageWidthMm,
      pageHeightMm,
      innerWidthMm,
      innerHeightMm,
      qrSizeMm,
      factoryFontPt,
      numberFontPt,
      footerFontPt
    } = dims;

    const wideLayout = `
          .label-inner {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: space-evenly;
            text-align: center;
          }
          .factory-prefix {
            font-size: ${factoryFontPt}pt;
            font-weight: bold;
            color: #000;
            line-height: 1;
            flex-shrink: 0;
          }
          .qr-code {
            display: flex;
            align-items: center;
            justify-content: center;
            flex: 1 1 auto;
            width: 100%;
            min-height: 0;
          }
          .qr-code img {
            width: ${qrSizeMm}mm !important;
            height: ${qrSizeMm}mm !important;
            max-width: ${qrSizeMm}mm !important;
            max-height: ${qrSizeMm}mm !important;
            object-fit: contain;
          }
          .pallet-number {
            font-size: ${numberFontPt}pt;
            font-weight: bold;
            color: #000;
            letter-spacing: 3px;
            line-height: 1;
            font-family: 'Courier New', monospace;
            flex-shrink: 0;
          }
          .label-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
            flex-shrink: 0;
            padding: 0 1mm;
          }
          .created-date {
            font-size: ${footerFontPt}pt;
            color: #000;
            font-weight: 600;
          }
          .label-number {
            font-size: ${footerFontPt}pt;
            color: #000;
            font-weight: 600;
          }
    `;

    return `
          @page {
            size: ${pageWidthMm}mm ${pageHeightMm}mm;
            margin: 0 !important;
          }
          @media print {
            @page {
              size: ${pageWidthMm}mm ${pageHeightMm}mm;
              margin: 0 !important;
            }
            html, body {
              margin: 0 !important;
              padding: 0 !important;
              width: ${pageWidthMm}mm !important;
              height: auto !important;
            }
            .label-container {
              width: ${pageWidthMm}mm !important;
              height: ${pageHeightMm}mm !important;
              border: none !important;
              margin: 0 !important;
              padding: 0 !important;
              page-break-after: always !important;
              break-after: page !important;
            }
            .label-container:last-child {
              page-break-after: avoid !important;
              break-after: avoid !important;
            }
          }
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          html, body {
            width: ${pageWidthMm}mm;
            height: auto;
            margin: 0;
            padding: 0;
          }
          body {
            font-family: Arial, Helvetica, sans-serif;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          .label-container {
            width: ${pageWidthMm}mm;
            height: ${pageHeightMm}mm;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0;
            page-break-after: always;
            page-break-inside: avoid;
            box-sizing: border-box;
            overflow: hidden;
          }
          .label-container:last-child {
            page-break-after: avoid;
          }
          .label-inner {
            width: ${innerWidthMm}mm;
            height: ${innerHeightMm}mm;
            box-sizing: border-box;
          }
          ${wideLayout}
    `;
  }

  private printLabelHtml(html: string): void {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Không thể mở cửa sổ in. Vui lòng cho phép popup.');
      throw new Error('print blocked');
    }
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 400);
  }

  private buildSingleLabelDocument(
    labelSize: PalletLabelSizeKey,
    bodyHtml: string,
    dims: PalletLabelDimensions
  ): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title></title>
  <style>
    ${this.buildPalletLabelPrintStyles(labelSize, dims)}
  </style>
</head>
<body>
  ${bodyHtml}
</body>
</html>`;
  }

  // Print pallet label - 4 copies with QR code
  async printPalletLabel(): Promise<void> {
    if (!this.selectedPallet) return;

    const pallet = this.selectedPallet;
    const labelSize = this.getPalletLabelSize(pallet);
    const dims = this.palletLabelDimensions(labelSize);
    
    // Generate QR code - kích thước lớn gấp đôi
    let qrCodeDataUrl = '';
    try {
      qrCodeDataUrl = await QRCode.toDataURL(pallet.palletCode, {
        width: labelSize === '100x100' ? 1024 : 800,
        margin: 1,
        errorCorrectionLevel: 'M'
      });
    } catch (err) {
      console.error('Error generating QR code:', err);
    }

    // Generate 4 labels for 4 sides of pallet (mỗi tem = 1 trang 100×100mm)
    let labelsHtml = '';
    for (let i = 1; i <= 4; i++) {
      labelsHtml += this.buildPalletLabelBodyHtml(labelSize, pallet, qrCodeDataUrl, i);
    }

    try {
      const htmlContent = this.buildSingleLabelDocument(labelSize, labelsHtml, dims);
      this.printLabelHtml(htmlContent);
    } catch {
      return;
    }
    
    // Update print count in Firestore
    try {
      await this.firestore.collection('pallets').doc(pallet.id).update({
        printCount: (pallet.printCount || 0) + 1
      });
      console.log(`✅ Updated print count for ${pallet.palletCode}`);
    } catch (err) {
      console.error('Error updating print count:', err);
    }
    
    this.closePrintPreview();
  }

  // Format date
  formatDate(date: Date): string {
    if (!date) return '';
    const d = new Date(date);
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }

  // Format datetime
  formatDateTime(date: Date): string {
    if (!date) return '';
    const d = new Date(date);
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();
    const hours = d.getHours().toString().padStart(2, '0');
    const minutes = d.getMinutes().toString().padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  }

  // ====== Tạo tem tạm ======
  openTempLabelModal(): void {
    this.tempLabelQuantity = 1;
    this.tempLabelError = '';
    this.showTempLabelModal = true;
  }

  closeTempLabelModal(): void {
    this.showTempLabelModal = false;
    this.tempLabelError = '';
  }

  /** Tiền tố tem tạm: T1=ASM1, T2=ASM2 */
  private getTempLabelPrefix(): string {
    return this.selectedFactory === 'ASM1' ? 'T1' : 'T2';
  }

  /** Lấy số thứ tự tiếp theo (001-999), lưu Firebase (đồng bộ nhiều máy, tránh trùng) */
  private async getNextTempLabelSeqs(count: number): Promise<string[]> {
    const prefix = this.getTempLabelPrefix();
    const docRef = this.firestore.collection('pallet-temp-seq').doc(this.selectedFactory).ref;
    const result = await this.firestore.firestore.runTransaction(async (transaction) => {
      const snap = await transaction.get(docRef);
      let lastSeq = 0;
      if (snap.exists && snap.data()) {
        const data = snap.data() as { lastSeq?: number };
        lastSeq = Number(data?.lastSeq) || 0;
      }
      const seqs: string[] = [];
      for (let i = 0; i < count; i++) {
        lastSeq = (lastSeq % 999) + 1;
        seqs.push(`${prefix}-${lastSeq.toString().padStart(3, '0')}`);
      }
      transaction.set(docRef, {
        lastSeq,
        updatedAt: new Date()
      }, { merge: true });
      return seqs;
    });
    return result;
  }

  async printTempLabels(): Promise<void> {
    const qty = Math.floor(Number(this.tempLabelQuantity));
    if (qty < 1 || qty > 999) {
      this.tempLabelError = 'Số lượng phải từ 1 đến 999';
      return;
    }
    this.tempLabelError = '';
    this.isPrintingTempLabels = true;

    try {
      const labels = await this.getNextTempLabelSeqs(qty);
      const prefix = this.getTempLabelPrefix();

      const qrImages = await Promise.all(
        labels.map(code => QRCode.toDataURL(code, {
          width: 200,
          margin: 1,
          errorCorrectionLevel: 'M'
        }))
      );

      const labelHtml = labels.map((code, i) => {
        const prefixPart = code.slice(0, -3);
        const digitsPart = code.slice(-3);
        return `
        <div class="temp-label-container">
          <div class="temp-qr-section">
            <img src="${qrImages[i]}" class="temp-qr-image" alt="QR">
          </div>
          <div class="temp-text-section">
            <span class="temp-label-text">${prefixPart}<span class="temp-label-digits">${digitsPart}</span></span>
          </div>
        </div>
      `;
      }).join('');

      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('Không thể mở cửa sổ in. Vui lòng cho phép popup.');
        return;
      }

      printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Tem pallet tạm - ${prefix}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Arial, sans-serif;
      padding: 0;
      margin: 0;
      background: white;
    }
    @media print {
      body { margin: 0 !important; padding: 0 !important; }
      @page { margin: 0 !important; size: 57mm 32mm !important; }
      .temp-label-container {
        width: 57mm !important;
        height: 32mm !important;
        page-break-after: always !important;
      }
      .temp-label-container:last-child { page-break-after: avoid !important; }
    }
    .temp-label-container {
      display: flex;
      width: 57mm;
      height: 32mm;
      border: 1px solid #000;
      margin-bottom: 2px;
      page-break-inside: avoid;
    }
    .temp-qr-section {
      width: 50%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      border-right: 1px solid #ccc;
      padding: 1mm;
      box-sizing: border-box;
    }
    .temp-qr-image {
      width: 26mm;
      height: 26mm;
      display: block;
      object-fit: contain;
    }
    .temp-text-section {
      width: 50%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2mm;
      box-sizing: border-box;
    }
    .temp-label-text {
      font-size: 18px;
      font-weight: bold;
      font-family: 'Courier New', monospace;
      letter-spacing: 1px;
    }
    .temp-label-digits {
      font-size: 36px;
    }
  </style>
</head>
<body>${labelHtml}</body>
</html>`);

      printWindow.document.close();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 400);
      this.closeTempLabelModal();
    } catch (err) {
      console.error('Error printing temp labels:', err);
      alert('Lỗi khi in tem tạm. Vui lòng thử lại.');
    } finally {
      this.isPrintingTempLabels = false;
    }
  }

  // ====== In số (57×32mm hoặc 100×100mm) ======

  get numberLabelSizeDisplay(): string {
    return this.numberLabelSizeMm === 57 ? '57mm × 32mm' : '100mm × 100mm';
  }

  get numberLabelPrintCount(): number | null {
    const start = Math.floor(Number(this.numberLabelStart));
    const end = Math.floor(Number(this.numberLabelEnd));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) {
      return null;
    }
    return end - start + 1;
  }

  get canPrintNumberLabels(): boolean {
    const count = this.numberLabelPrintCount;
    return count !== null && count >= 1 && count <= 9999;
  }

  private numberLabelDimensions(sizeMm: 57 | 100): { widthMm: number; heightMm: number } {
    return sizeMm === 57 ? { widthMm: 57, heightMm: 32 } : { widthMm: 100, heightMm: 100 };
  }

  openNumberLabelModal(): void {
    this.numberLabelSizeMm = 100;
    this.numberLabelStart = 1;
    this.numberLabelEnd = 1;
    this.numberLabelError = '';
    this.showNumberLabelModal = true;
  }

  closeNumberLabelModal(): void {
    this.showNumberLabelModal = false;
    this.numberLabelError = '';
  }

  setNumberLabelSize(sizeMm: 57 | 100): void {
    this.numberLabelSizeMm = sizeMm;
  }

  printNumberLabels(): void {
    const start = Math.floor(Number(this.numberLabelStart));
    const end = Math.floor(Number(this.numberLabelEnd));
    if (start < 1 || end < 1) {
      this.numberLabelError = 'Số bắt đầu và số kết thúc phải ≥ 1';
      return;
    }
    if (end < start) {
      this.numberLabelError = 'Số kết thúc phải lớn hơn hoặc bằng số bắt đầu';
      return;
    }
    const qty = end - start + 1;
    if (qty > 9999) {
      this.numberLabelError = 'Tối đa 9999 tem mỗi lần in';
      return;
    }
    this.numberLabelError = '';
    this.isPrintingNumberLabels = true;

    try {
      const sizeMm = this.numberLabelSizeMm;
      const { widthMm, heightMm } = this.numberLabelDimensions(sizeMm);
      const labelHtml = Array.from({ length: qty }, (_, i) => {
        const n = start + i;
        const fontSize = this.numberLabelFontSize(n, sizeMm);
        return `
        <div class="number-label-container">
          <div class="number-label-value" style="font-size: ${fontSize}">${n}</div>
        </div>`;
      }).join('');

      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('Không thể mở cửa sổ in. Vui lòng cho phép popup.');
        return;
      }

      printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>In số ${start}–${end} (${widthMm}×${heightMm}mm)</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Arial, 'Helvetica Neue', sans-serif;
      padding: 0;
      margin: 0;
      background: white;
    }
    @media print {
      body { margin: 0 !important; padding: 0 !important; }
      @page { margin: 0 !important; size: ${widthMm}mm ${heightMm}mm !important; }
      .number-label-container {
        width: ${widthMm}mm !important;
        height: ${heightMm}mm !important;
        page-break-after: always !important;
        break-after: page !important;
      }
      .number-label-container:last-child {
        page-break-after: avoid !important;
        break-after: avoid !important;
      }
    }
    .number-label-container {
      width: ${widthMm}mm;
      height: ${heightMm}mm;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #000;
      page-break-inside: avoid;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .number-label-value {
      font-weight: 900;
      line-height: 0.88;
      color: #000;
      text-align: center;
      white-space: nowrap;
      max-width: 90%;
      max-height: 90%;
      letter-spacing: -0.04em;
    }
  </style>
</head>
<body>${labelHtml}</body>
</html>`);

      printWindow.document.close();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 400);
      this.closeNumberLabelModal();
    } catch (err) {
      console.error('Error printing number labels:', err);
      alert('Lỗi khi in tem số. Vui lòng thử lại.');
    } finally {
      this.isPrintingNumberLabels = false;
    }
  }

  // ====== In tem PASS (57×32mm, mật khẩu 2026) ======

  openPassLabelFlow(): void {
    this.passLabelPassword = '';
    this.passLabelPasswordError = '';
    this.showPassPasswordModal = true;
  }

  closePassPasswordModal(): void {
    this.showPassPasswordModal = false;
    this.passLabelPassword = '';
    this.passLabelPasswordError = '';
  }

  confirmPassPassword(): void {
    if (this.passLabelPassword.trim() !== this.PASS_LABEL_PASSWORD) {
      this.passLabelPasswordError = 'Mật khẩu không đúng';
      return;
    }
    this.closePassPasswordModal();
    this.openPassLabelModal();
  }

  openPassLabelModal(): void {
    this.passLabelQuantity = 1;
    this.passLabelError = '';
    this.showPassLabelModal = true;
  }

  closePassLabelModal(): void {
    this.showPassLabelModal = false;
    this.passLabelError = '';
  }

  get canPrintPassLabels(): boolean {
    const qty = Math.floor(Number(this.passLabelQuantity));
    return Number.isFinite(qty) && qty >= 1 && qty <= 9999;
  }

  printPassLabels(): void {
    const qty = Math.floor(Number(this.passLabelQuantity));
    if (qty < 1 || qty > 9999) {
      this.passLabelError = 'Số lượng phải từ 1 đến 9999';
      return;
    }
    this.passLabelError = '';
    this.isPrintingPassLabels = true;

    const widthMm = 57;
    const heightMm = 32;

    try {
      const labelHtml = Array.from({ length: qty }, () => `
        <div class="pass-label-container">
          <div class="pass-label-fit">
            <svg viewBox="0 0 ${widthMm} ${heightMm}" xmlns="http://www.w3.org/2000/svg" aria-label="PASS">
              <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
                    font-family="Arial, Helvetica, sans-serif" font-weight="900"
                    font-size="17.5" letter-spacing="0.35">PASS</text>
            </svg>
          </div>
        </div>`).join('');

      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('Không thể mở cửa sổ in. Vui lòng cho phép popup.');
        return;
      }

      printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>In tem PASS (${widthMm}×${heightMm}mm)</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Arial, 'Helvetica Neue', sans-serif;
      padding: 0;
      margin: 0;
      background: white;
    }
    @media print {
      body { margin: 0 !important; padding: 0 !important; }
      @page { margin: 0 !important; size: ${widthMm}mm ${heightMm}mm !important; }
      .pass-label-container {
        width: ${widthMm}mm !important;
        height: ${heightMm}mm !important;
        page-break-after: always !important;
        break-after: page !important;
      }
      .pass-label-container:last-child {
        page-break-after: avoid !important;
        break-after: avoid !important;
      }
    }
    .pass-label-container {
      width: ${widthMm}mm;
      height: ${heightMm}mm;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #000;
      page-break-inside: avoid;
      overflow: hidden;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .pass-label-fit {
      width: 90%;
      height: 90%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .pass-label-fit svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .pass-label-fit text {
      fill: #000;
    }
  </style>
</head>
<body>${labelHtml}</body>
</html>`);

      printWindow.document.close();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 400);
      this.closePassLabelModal();
    } catch (err) {
      console.error('Error printing PASS labels:', err);
      alert('Lỗi khi in tem PASS. Vui lòng thử lại.');
    } finally {
      this.isPrintingPassLabels = false;
    }
  }

  // ====== In tem Đã Kiểm (57×32mm, không mật khẩu) ======

  openDaKiemLabelModal(): void {
    this.daKiemLabelQuantity = 1;
    this.daKiemLabelError = '';
    this.showDaKiemLabelModal = true;
  }

  closeDaKiemLabelModal(): void {
    this.showDaKiemLabelModal = false;
    this.daKiemLabelError = '';
  }

  get canPrintDaKiemLabels(): boolean {
    const qty = Math.floor(Number(this.daKiemLabelQuantity));
    return Number.isFinite(qty) && qty >= 1 && qty <= 9999;
  }

  printDaKiemLabels(): void {
    const qty = Math.floor(Number(this.daKiemLabelQuantity));
    if (qty < 1 || qty > 9999) {
      this.daKiemLabelError = 'Số lượng phải từ 1 đến 9999';
      return;
    }
    this.daKiemLabelError = '';
    this.isPrintingDaKiemLabels = true;

    const widthMm = 57;
    const heightMm = 32;

    try {
      const labelHtml = Array.from({ length: qty }, () => `
        <div class="pass-label-container">
          <div class="pass-label-fit">
            <svg viewBox="0 0 ${widthMm} ${heightMm}" xmlns="http://www.w3.org/2000/svg" aria-label="Đã Kiểm">
              <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
                    font-family="Arial, Helvetica, sans-serif" font-weight="900"
                    font-size="9.8" letter-spacing="0.15">Đã Kiểm</text>
            </svg>
          </div>
        </div>`).join('');

      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('Không thể mở cửa sổ in. Vui lòng cho phép popup.');
        return;
      }

      printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>In tem Đã Kiểm (${widthMm}×${heightMm}mm)</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Arial, 'Helvetica Neue', sans-serif;
      padding: 0;
      margin: 0;
      background: white;
    }
    @media print {
      body { margin: 0 !important; padding: 0 !important; }
      @page { margin: 0 !important; size: ${widthMm}mm ${heightMm}mm !important; }
      .pass-label-container {
        width: ${widthMm}mm !important;
        height: ${heightMm}mm !important;
        page-break-after: always !important;
        break-after: page !important;
      }
      .pass-label-container:last-child {
        page-break-after: avoid !important;
        break-after: avoid !important;
      }
    }
    .pass-label-container {
      width: ${widthMm}mm;
      height: ${heightMm}mm;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #000;
      page-break-inside: avoid;
      overflow: hidden;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .pass-label-fit {
      width: 90%;
      height: 90%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .pass-label-fit svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .pass-label-fit text {
      fill: #000;
    }
  </style>
</head>
<body>${labelHtml}</body>
</html>`);

      printWindow.document.close();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 400);
      this.closeDaKiemLabelModal();
    } catch (err) {
      console.error('Error printing Đã Kiểm labels:', err);
      alert('Lỗi khi in tem Đã Kiểm. Vui lòng thử lại.');
    } finally {
      this.isPrintingDaKiemLabels = false;
    }
  }

  // ====== In tem NVL Trả / Return (57×32mm, cùng khổ tem PASS) ======

  openReturnLabelModal(): void {
    this.returnLabelQuantity = 1;
    this.returnLabelError = '';
    this.showReturnLabelModal = true;
  }

  closeReturnLabelModal(): void {
    this.showReturnLabelModal = false;
    this.returnLabelError = '';
  }

  get canPrintReturnLabels(): boolean {
    const qty = Math.floor(Number(this.returnLabelQuantity));
    return Number.isFinite(qty) && qty >= 1 && qty <= 9999;
  }

  printReturnLabels(): void {
    const qty = Math.floor(Number(this.returnLabelQuantity));
    if (qty < 1 || qty > 9999) {
      this.returnLabelError = 'Số lượng phải từ 1 đến 9999';
      return;
    }
    this.returnLabelError = '';
    this.isPrintingReturnLabels = true;

    const widthMm = 57;
    const heightMm = 32;

    try {
      const labelHtml = Array.from({ length: qty }, () => `
        <div class="pass-label-container">
          <div class="pass-label-fit">
            <svg viewBox="0 0 ${widthMm} ${heightMm}" xmlns="http://www.w3.org/2000/svg" aria-label="NVL TRẢ / Return">
              <text x="50%" y="38%" text-anchor="middle" dominant-baseline="central"
                    font-family="Arial, Helvetica, sans-serif" font-weight="900"
                    font-size="8.2" letter-spacing="0.1">NVL TRẢ</text>
              <text x="50%" y="66%" text-anchor="middle" dominant-baseline="central"
                    font-family="Arial, Helvetica, sans-serif" font-weight="900"
                    font-size="7.2" letter-spacing="0.12">Return</text>
            </svg>
          </div>
        </div>`).join('');

      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('Không thể mở cửa sổ in. Vui lòng cho phép popup.');
        return;
      }

      printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>In tem NVL TRẢ / Return (${widthMm}×${heightMm}mm)</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Arial, 'Helvetica Neue', sans-serif;
      padding: 0;
      margin: 0;
      background: white;
    }
    @media print {
      body { margin: 0 !important; padding: 0 !important; }
      @page { margin: 0 !important; size: ${widthMm}mm ${heightMm}mm !important; }
      .pass-label-container {
        width: ${widthMm}mm !important;
        height: ${heightMm}mm !important;
        page-break-after: always !important;
        break-after: page !important;
      }
      .pass-label-container:last-child {
        page-break-after: avoid !important;
        break-after: avoid !important;
      }
    }
    .pass-label-container {
      width: ${widthMm}mm;
      height: ${heightMm}mm;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #000;
      page-break-inside: avoid;
      overflow: hidden;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .pass-label-fit {
      width: 90%;
      height: 90%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .pass-label-fit svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .pass-label-fit text {
      fill: #000;
    }
  </style>
</head>
<body>${labelHtml}</body>
</html>`);

      printWindow.document.close();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 400);
      this.closeReturnLabelModal();
    } catch (err) {
      console.error('Error printing NVL Trả labels:', err);
      alert('Lỗi khi in tem NVL TRẢ. Vui lòng thử lại.');
    } finally {
      this.isPrintingReturnLabels = false;
    }
  }

  openSafetyLabelModal(): void {
    this.safetyLabelQuantity = 1;
    this.showSafetyLabelModal = true;
  }

  closeSafetyLabelModal(): void {
    if (this.isPrintingSafetyLabels) return;
    this.showSafetyLabelModal = false;
  }

  safetyLabelIcon(id: string): string {
    const ring = (inner: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 265 265" aria-hidden="true">${inner}</svg>`;
    if (id === 'load400') {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true"><rect x="8" y="34" width="48" height="6" rx="1" fill="#111"/><rect x="12" y="40" width="7" height="10" fill="#111"/><rect x="28.5" y="40" width="7" height="10" fill="#111"/><rect x="45" y="40" width="7" height="10" fill="#111"/><rect x="14" y="16" width="16" height="16" rx="1" fill="#111"/><rect x="32" y="8" width="18" height="24" rx="1" fill="#111"/></svg>`;
    }
    if (id === 'h3' || id === 'h2') {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="28" fill="#fff" stroke="#b71f2e" stroke-width="6"/><path fill="none" stroke="#111" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" d="M32 14v36M26 20l6-7 6 7M26 44l6 7 6-7M16 22h12M16 42h12"/></svg>`;
    }
    if (id === 'noWay') {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 702 702" aria-hidden="true"><g transform="translate(-42.564505,571.69995)"><circle cx="393.56451" cy="-220.69995" r="350" fill="#e10600"/><circle cx="393.56451" cy="-220.69995" r="250" fill="#fff"/><path fill="#111" d="m 369.46449,-388.69997 c -13.2549,-5e-5 -24.0002,10.74518 -24.0001,24.00009 0.014,11.96899 8.8447,22.09806 20.7,23.74377 v 9.35601 c -21.2337,10.16357 -31.0597,30.65526 -31.0999,43.80012 v 4.8 c 0.1548,7.79361 -7.3765,18.77612 -28.2,23.80001 h -10.4 c -9.6823,0.18034 -11.3685,11.76525 -11.4,15.99998 0.01,3.64713 5.62131,8.62084 8.5,8.59999 h 5.5 c 2.25291,-1.23216 6.10361,-1.58472 7.60001,-1.79998 2.17809,-0.34986 12.7534,-1.54543 14.2,-1.9 14.73129,-3.66924 33.54169,-15.89289 39.69999,-25.70001 l 16,43.80001 c -6.74669,27.37676 -11.7719,47.257 -13.3,51.4 -2.7203,7.58299 -18.868,39.28558 -26.39999,54.2 l 3,6.6 -36.80001,-1.8 c -1.18049,-0.10667 -1.2148,3.76805 0,4.7 l 31.10001,20.000003 c -0.4917,1.65291 0.4109,3.62611 0.89999,3.9 l 19.80001,7.6 c 10.26679,-21.48184 18.19279,-31.287603 19.8,-34.300003 l 35,-60.9 52.8,77.000003 c -5.9483,6.16573 -18.6856,19.62016 -18.9,22 -0.1529,2.97151 1.5705,6.59526 3.9,6.6 3.5373,0.0136 19.394,-5.01237 29,-10 h 2 l 23.6,-10 v -1.9 l -1.9,-14.2 c -11.973,-18.071653 -36.8819,-64.732013 -42.5,-69.500003 -4.7278,-7.84053 -19.0889,-33.38748 -18.8,-36.2 0.3905,-4.16319 -0.8515,-6.16621 -1,-8.6 v -2.8 c 0.091,-2.73928 2.9924,-5.56284 2.8,-11.4 0.1702,-3.89577 0.001,-6.32416 -0.8,-11.4 -1.2007,-9.89061 -8.7508,-31.76989 -14.2,-43.8 l 1.9,-7.70001 c 1.5598,3.16573 4.3185,5.18726 6.6,7.70001 l 13.2,16.20001 v 31.29999 l 3.7,1 h 1 c -3.2803,2.56351 -5.702,5.83864 -5.7,7.59999 v 14.30002 c 0.013,1.4437 1.1251,4.90369 4.7,4.79999 h 9.4 c 4.3322,0.0715 11.3798,-5.90426 11.4,-9.6 0.5616,-0.62038 1.01249,-1.53576 1,-2.8 v -1.9 c -0.04,-1.08301 -0.9891,-2.09215 -2,-2.90001 v -6.69999 h 7.6 v -36.9 c 0.014,-4.1946 -19.3249,-30.1144 -20.8,-31.60001 -5.79611,-6.38802 -27.591,-30.17986 -32,-31.79998 -13.5928,-4.03947 -17.9128,-4.93723 -35.8002,-4.39983 l -3.6907,-11.07324 c 4.66019,-4.51982 7.29059,-10.73478 7.291,-17.22684 0,-13.25491 -10.74521,-24.00014 -24.00011,-24.00009 z"/><rect x="409.35052" y="-217.76631" width="50" height="680" fill="#e10600" transform="rotate(-45)"/></g></svg>`;
    }
    if (id === 'noFork') {
      return ring(`<g fill-rule="evenodd"><path d="M251.75 132.5c0-65.86-53.39-119.25-119.25-119.25S13.25 66.64 13.25 132.5 66.64 251.75 132.5 251.75s119.25-53.39 119.25-119.25" fill="#fff"/><path d="M106.729 172.569c0-3.982 3.222-7.209 7.213-7.209a7.21 7.21 0 0 1 7.209 7.209 7.21 7.21 0 1 1-14.422 0zm66.105 0a9.14 9.14 0 0 1 9.14-9.135 9.14 9.14 0 0 1 9.135 9.135 9.14 9.14 0 0 1-9.135 9.14 9.14 9.14 0 0 1-9.14-9.14zm-71.438-23.327l32.619-84.459c1.595-4.185 5.651-7.19 10.435-7.19h34.136c6.172 0 11.177 5.006 11.177 11.182v48.586h14.095c7.72 0 13.975 6.255 13.975 13.971v41.238h-20.585c0 8.439-6.84 15.275-15.275 15.275s-15.28-6.835-15.28-15.275h-6.103-4.397-26.978c0 8.439-6.84 15.275-15.275 15.275s-15.28-6.835-15.28-15.275H85.01l-4.54 11.745-31.601-10.228 2.586-7.979 24.051 7.79 52.089-134.884 7.822 3.019-41.4 107.21zm49.337-27.291h5.462v15.123h-10.887zm-13.468 15.123h-17.455l20.34-29.112 3.383 3.627a1.65 1.65 0 0 0 2.337.083c.668-.622.701-1.669.083-2.332l-9.02-9.675c-.622-.668-1.678-.705-2.341-.078a1.65 1.65 0 0 0-.083 2.332l3.383 3.623-21.857 31.532h-.94l26.743-69.281c.41-1.069 1.438-1.816 2.613-1.816h34.136c1.544 0 2.798 1.249 2.798 2.793v48.586h-4.462V90.902c0-1.696-1.369-3.084-3.065-3.084l-6.398.014c-.171 0-.35.018-.516.041-.101.018-.203.037-.383.092-.147.046-.29.101-.429.166l-.184.097-.207.129-.221.157c-.281.23-.516.502-.701.807l-6.941 12.634-13.605-2.828a2.89 2.89 0 0 0-.853-.12c-1.696 0-3.07 1.378-3.07 3.074 0 1.401.931 2.59 2.217 2.959l16.034 3.381a3.03 3.03 0 0 0 .848.12c1.115 0 2.097-.599 2.636-1.489l.115-.212 2.06-3.757v11.223h-16.229c-.244 0-.484.018-.714.064-.383.069-.742.198-1.12.396l-.281.175-.171.12-.184.147c-.521.442-.922 1.014-1.148 1.669l-7.149 20.193" fill="#000"/><path d="M164.072 79.09a6.4 6.4 0 1 1 12.806 0 6.4 6.4 0 1 1-12.806 0" fill="#161313"/></g><path fill="#b71f2e" fill-rule="evenodd" d="M238.369 132.5c0-58.47-47.399-105.869-105.869-105.869a105.42 105.42 0 0 0-67.175 24.04l149.366 148.554c14.802-18.209 23.678-41.429 23.678-66.725zM50.309 65.775c-14.801 18.21-23.678 41.429-23.678 66.725 0 58.47 47.399 105.869 105.869 105.869 25.503 0 48.899-9.019 67.175-24.04zM265 132.5C265 59.322 205.678 0 132.5 0S0 59.322 0 132.5 59.322 265 132.5 265 265 205.678 265 132.5"/>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1325 265" aria-hidden="true"><svg x="0" y="0" width="265" height="265" viewBox="0 0 265 265" style="clip-path:circle(50%)"><g transform="matrix(3.949 0 0 -3.949 -881.94993 2931.5975)"><path d="M256.897 742.369c-18.479 0-33.554-15.07-33.554-33.545s15.076-33.561 33.554-33.561 33.554 15.087 33.554 33.561-15.075 33.545-33.554 33.545" fill="#005387" fill-rule="nonzero"/></g><path d="M81.254 122.622a8.46 8.46 0 0 1 8.459-8.459 8.46 8.46 0 0 1 8.459 8.459 8.46 8.46 0 0 1-8.459 8.459 8.46 8.46 0 0 1-8.459-8.459m-46.34-17.757h180.478C218.421 27.693 95.678-18.181 58.004 84.514c-1.809 4.453-2.35 7.051-8.055 8.679l-8.961 2.558c-4.167.997-6.191 4.033-6.074 9.114" fill="#fff" fill-rule="nonzero"/><g transform="matrix(3.885 0 0 -3.885 -868.02569 2886.4491)"><path d="M275.302 714.069l.018-.786c0-1.882-.299-3.784-.89-5.653-.207-.656-.638-1.381-1.184-2.3-1.753-2.949-4.401-7.405-4.401-17.21v-1.343a1.87 1.87 0 0 0-1.866-1.865h-15.845c-1.029 0-1.865.836-1.865 1.865v5.709h-1.82c-3.678.001-4.989 2.708-4.989 5.241v4.764h-2.775c-.553 0-1.057.223-1.349.597-.419.539-.345 1.299-.208 1.841l2.306 9.14h-2.039l-2.184-8.656c-.443-1.757.063-2.895.565-3.54.664-.851 1.751-1.359 2.909-1.359h.798v-2.787c0-4.262 2.729-7.143 6.808-7.216v-3.734a3.85 3.85 0 0 1 3.843-3.843h15.845a3.85 3.85 0 0 1 3.843 3.843v1.343c0 9.262 2.481 13.437 4.123 16.2.588.987 1.095 1.84 1.371 2.714a20.75 20.75 0 0 1 .982 6.249 20.39 20.39 0 0 1-.017.786z" fill="#fff" fill-rule="nonzero"/></g></svg><svg x="265" y="0" width="265" height="265" viewBox="0 0 265 265" style="clip-path:circle(50%)"><path d="M0 132.46C0 59.514 59.525 0 132.501 0 205.469 0 265 59.513 265 132.459 265 205.417 205.469 265 132.501 265 59.537 265 0 205.417 0 132.46" fill="#005387"/><path d="M132.509 235.575c-30.16.13-50.638-19.989-61.406-60.356-10.177 0-15.469-5.546-21.475-19.222-9.758-22.201-7.971-38.874 7.162-39.606-4.879-50.031 34.927-87.4 75.719-87.4 40.774 0 80.586 37.37 75.701 87.4 15.139.732 16.915 17.405 7.162 39.606-6.018 13.676-11.31 19.222-21.475 19.222-10.767 40.367-31.246 60.485-61.388 60.356m-7.882-8.401c-21.08-3.056-36.715-19.517-45.919-53.984l-1.563-5.853c-.867-3.493-5.859-3.186-6.909-.484-.761 2.024-7.688-1.044-13.393-14.024-4.649-10.561-5.953-18.614-5.186-23.446.584-3.676 4.018-6.395 6.301-5.168 1.215 5.994 8.602 3.522 7.865-.979l-.897-5.687 12.891 8.219-.059-6.826-13.458-8.219c-1.345-39.517 28.219-69.099 60.326-73.335 5.192-.69 10.484-.69 15.877 0 32.078 4.23 61.636 33.777 60.326 73.258l-13.593 8.295-.053 6.826 13.027-8.313-.903 5.782c-.737 4.502 6.643 6.974 7.853.979 2.289-1.227 5.735 1.493 6.307 5.168.773 4.832-.537 12.885-5.18 23.446-5.699 12.98-12.632 16.048-13.387 14.024-1.068-2.702-6.047-3.009-6.921.484l-1.563 5.853c-9.21 34.467-24.838 50.928-45.913 53.984a60.1 60.1 0 0 1-15.877 0m16.537-109.796c14.112-.808 28.614-.472 43.511 1.021l-.218 27.086c-.083 10.077-9.988 17.115-19.045 16.986l-3.965-.047c-11.67-.165-20.762-7.422-20.626-18.531zm38.591 5.469l-.183 22.591c-.059 6.661-6.956 12.26-14.089 12.154l-3.965-.053c-9.788-.142-15.9-5.912-15.818-13.587l.283-21.918c11.021-.437 22.272-.165 33.771.814m-3.015 22.567c-.035 4.726-5.257 9.44-11.222 9.351l-3.965-.053c-8.637-.124-13.086-4.997-13.015-10.72l.242-19.228c9.21-.266 18.585-.035 28.125.69zm19.835-34.721l-9.363 5.375-2.277-.23c-6.702-.667-13.31-1.109-19.841-1.316 9.794-1.681 22.496-3.328 31.482-3.829m-9.422 17.806l7.735-4.92c-.614 6.342-1.858 13.758-3.752 21.67l-4.413 3.381c.195-1.009.283-2.053.307-3.127zm-63.317-11.121c-14.107-.808-28.614-.472-43.511 1.021l.23 27.086c.083 10.077 9.971 17.115 19.033 16.986l3.965-.047c11.67-.165 20.762-7.422 20.626-18.531zm-38.597 5.469l.201 22.591c.053 6.661 6.95 12.26 14.077 12.154l3.971-.053c9.77-.142 15.906-5.912 15.8-13.587l-.277-21.918c-11.015-.437-22.272-.165-33.771.814m3.021 22.567c.035 4.726 5.257 9.44 11.222 9.351l3.959-.053c8.637-.124 13.104-4.997 13.027-10.72l-.248-19.228c-9.21-.266-18.585-.035-28.125.69zm-19.829-34.721l9.357 5.375 2.277-.23c6.69-.667 13.31-1.109 19.847-1.316-9.806-1.681-22.514-3.328-31.482-3.829m9.41 17.806l-7.723-4.92c.619 6.342 1.864 13.758 3.752 21.67l4.407 3.381a18.67 18.67 0 0 1-.295-3.127zm48.986-6.59c3.516-3.475 7.292-3.475 11.334 0v2.95h-11.334zm0 7.251c3.516-3.475 7.292-3.475 11.334 0v2.95h-11.334z" fill="#fff" fill-rule="evenodd"/></svg><svg x="530" y="0" width="265" height="265" viewBox="0 0 265 265" style="clip-path:circle(50%)"><path d="M0 132.501C0 59.321 59.321 0 132.5 0S265 59.32 265 132.5 205.68 265 132.5 265 0 205.685 0 132.501" fill="#005387" fill-rule="nonzero"/><path d="M65.01 110.837c10.32-12.778 15.287-33.174 14.898-61.18l22.974-5.851 27.539 62.004v58.337H98.85V47.079l-13.625 3.475v113.593h-18.03v13.63h63.227v11.363H67.195v13.63h63.227v8.658h-65.41V110.842v-.003zm134.978 0v100.586h-65.41v-8.658h63.231v-13.63h-63.231v-11.363h63.231v-13.63h-18.029V50.55l-13.634-3.47v117.068H134.58V105.81l27.539-62.004 22.969 5.851c-.385 28.006 4.583 48.402 14.902 61.18zm-88.975-58.79c14.376 5.109 28.692 5.119 42.958.032l-21.472 48.333-21.486-48.365" fill="#fff"/></svg><svg x="795" y="0" width="265" height="265" viewBox="0 0 265 265" style="clip-path:circle(50%)"><path d="M265 132.503C265 205.674 205.674 265 132.503 265S0 205.674 0 132.503 59.326 0 132.503 0 265 59.331 265 132.503" fill="#005387"/><g fill="#fff"><path d="M143.643 175.932c4.704-1.344 32.605-10.046 42.018-11.488l-6.627-34.463c-1.825-12.959-4.13-26.017-5.087-39.069-.863-11.615-.863-23.231-.863-35.327V45.314c0-3.267-2.403-6.048-5.567-6.048-3.267 0-6.146 2.781-6.146 6.048v16.319c0 1.344-1.442 3.262-3.262 3.262-1.344 0-3.267-1.918-3.267-3.262l.481-27.071c0-3.267-2.781-6.048-6.048-6.048-3.645 0-6.048 2.781-6.048 6.048v28.896a3.265 3.265 0 1 1-6.529 0V39.266c0-3.36-2.781-5.665-5.567-5.665-3.262 0-5.661 2.305-5.661 5.665l-.387 35.42c0 1.825-1.437 3.267-3.262 3.267-1.923 0-3.262-1.442-3.262-3.267V46.658c0-2.305-1.829-4.13-4.611-4.13-2.305 0-4.704 1.825-4.704 4.13l-.383 45.019c-2.497-2.301-5.185-2.781-6.146-2.781l.481-42.238c0-5.474 5.185-10.752 10.752-10.752 1.825 0 3.169.574 4.611 1.055.957-5.665 6.524-10.271 12.572-10.271 2.786 0 5.091.961 7.009 2.305 2.305-4.13 5.95-6.529 11.135-6.529 7.009 0 12.096 5.185 12.096 12.096 2.305-.961 3.841-1.344 6.146-1.344 6.911 0 11.998 5.185 11.998 12.096v6.529c0 32.541.481 34.459.957 38.589 1.344 21.504 6.146 51.744 13.057 79.198-9.693 1.437-40.478 10.414-47.1 12.817z"/><path d="M87.355 233.776c-10.79-34.149-23.646-70.423-38.568-108.822a7.52 7.52 0 0 1 4.49-9.635c3.903-1.419 8.216.591 9.639 4.494l5.433 14.741 4.167 11.61c.311.867 1.269 1.313 2.137.997s1.317-1.273.997-2.141l-4.218-11.587-9.363-25.716c-1.159-3.182.378-6.659 3.422-7.77l.469-.166c3.051-1.112 6.458.568 7.621 3.745l9.418 25.697 1.928 5.476c.319.867 1.277 1.317 2.145 1.001a1.67 1.67 0 0 0 .997-2.145l-1.987-5.456-10.223-28.074c-1.313-3.611.544-7.605 4.159-8.918s7.609.548 8.922 4.159l10.278 28.05 1.932 5.48c.315.867 1.273 1.313 2.141 1.001a1.67 1.67 0 0 0 .997-2.145l-1.987-5.456-7.329-20.134a6.68 6.68 0 0 1 3.994-8.563c3.465-1.262 7.301.528 8.563 3.998 13.27 35.635 28.641 73.017 46.118 112.149-22.649 6.095-44.75 14.141-66.291 24.127m30.953-118.862l.781-3.099.02-.087c1.447-6.418 5.854-7.826 9.19-7.073 4.199.942 7.932 5.472 6.205 13.183l-5.437 24.238 4.423 10.814 7.534-33.589c2.61-11.65-3.686-19.468-11.259-21.167-5.488-1.234-11.784.895-15.218 6.954l3.761 9.824" fill-rule="nonzero"/></g></svg><svg x="1060" y="0" width="265" height="265" viewBox="0 0 265 265" style="clip-path:circle(50%)"><path d="M132.5 0C59.529 0 0 59.51 0 132.466S59.532 265 132.5 265 265 205.419 265 132.466 205.472 0 132.5 0" fill="#005387" fill-rule="nonzero"/><path d="M105.862 55.133l5.414-28.444 65.392 15.392-16.28 62.008c-1.213 4.612-1.045 8.351 1.287 11.575l24.552 33.914c3.276 4.526 7.343 7.992 10.922 9.067 19.071 5.328 25.72 15.985 19.981 31.877l2.246.586-1.91 7.112-15.414-3.407 1.06-4.847 6.951 1.534c8.545-14.205 3.963-23.496-14.179-28.56-4.944-1.478-9.757-5.862-13.284-10.735l-24.556-33.914c-3.437-4.746-3.377-10.067-1.993-15.34l15.116-57.56-56.366-13.269-4.541 23.847zm66.537 126.318c-6.022-1.369-3.537-7.56 4.187-7.09 5.388.329 12.448 4.444 15.369 9.273 2.746 4.541-2.817 8.653-5.817 5.694-4.616-4.556-8.672-6.724-13.739-7.877m-114.347.056h46.265c14.817 0 25.944 13.716 38.239 13.716h47.426v4.481h-47.426c-13.795 0-24.187-13.713-38.239-13.713H58.052zM52.436 62.715h69.411l-2.19 63.944c-.187 5.392.899 9.739 4.429 12.634l30.302 24.832c3.119 2.556 5.925 4.534 9.082 5.198l14.604 3.063c12.638 2.649 18.254 8.952 16.523 20.672-.47 2.537.168 3.813 1.911 3.832l.003 8.642h-64.534c-1.638 0-3.463-.672-5.597-1.634 0 0-21.739-12.922-25.758-12.97l-.549 14.605H54.895l-1.914-24.343c-5.549-6.739-4.642-21.616 2.735-44.631 2.978-9.295.25-39.56-3.28-73.844" fill="#fff"/></svg></svg>`;
  }

  async printSafetyLabel(id: string): Promise<void> {
    const item = this.safetyLabels.find((x) => x.id === id);
    if (!item || this.isPrintingSafetyLabels) return;
    const qty = Math.floor(Number(this.safetyLabelQuantity));
    const count = Number.isFinite(qty) && qty >= 1 && qty <= 99 ? qty : 1;
    this.isPrintingSafetyLabels = true;
    const widthMm = 140;
    const heightMm = 90;
    const icon = this.safetyLabelIcon(item.id);
    const vi = this.escapeSafetyText(item.vi);
    const en = this.escapeSafetyText(item.en);
    try {
      const logoUrl = await this.resolveShelfLabelLogoUrl();
      const pages = Array.from({ length: count }, () => `
        <section class="sl">
          <img class="sl-logo" src="${logoUrl}" alt="">
          <div class="sl-warn" aria-hidden="true">
            <svg viewBox="0 0 64 64"><path fill="#e10600" d="M32 4L60 58H4L32 4z"/><rect fill="#fff" x="29" y="24" width="6" height="18" rx="1"/><circle fill="#fff" cx="32" cy="49" r="3.2"/></svg>
          </div>
          <div class="sl-main">
            <div class="sl-icon${id === 'ppe' ? ' sl-icon--ppe' : ''}">${icon}</div>
            <p class="sl-line">${vi}</p>
            <p class="sl-line">${en}</p>
          </div>
        </section>`).join('');
      this.printLabelHtml(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${vi}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    .sl {
      position: relative;
      width: ${widthMm}mm;
      height: ${heightMm}mm;
      background: #fff;
      color: #ff7a00;
      border: 1.4mm solid #ff7a00;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 15mm 4mm 3mm;
      page-break-after: always;
      break-after: page;
      overflow: hidden;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .sl:last-child { page-break-after: avoid; break-after: avoid; }
    .sl-logo {
      position: absolute;
      top: 2.6mm;
      left: 3mm;
      height: 12mm;
      width: auto;
      max-width: 38mm;
      object-fit: contain;
      object-position: left center;
    }
    .sl-warn {
      position: absolute;
      top: 2.4mm;
      right: 3mm;
      width: 14mm;
      height: 14mm;
    }
    .sl-warn svg { width: 100%; height: 100%; display: block; }
    .sl-main {
      width: 100%;
      height: 70%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      gap: 1.2mm;
    }
    .sl-icon { width: 32mm; height: 32mm; flex: 0 0 32mm; }
    .sl-icon--ppe { width: 118mm; height: 22mm; flex-basis: 22mm; }
    .sl-icon svg { width: 100%; height: 100%; display: block; }
    .sl-line {
      width: 100%;
      font-family: Arial, Helvetica, sans-serif;
      font-weight: 800;
      font-size: 7.8mm;
      line-height: 1.05;
      letter-spacing: -0.02em;
      color: #ff7a00;
    }
  </style>
</head>
<body>${pages}</body>
</html>`);
    } catch (err) {
      console.error('Error printing safety label:', err);
      alert('Lỗi khi in tem an toàn. Vui lòng thử lại.');
    } finally {
      this.isPrintingSafetyLabels = false;
    }
  }

  openFormSignModal(): void {
    this.formSignSize = 'A4';
    this.showFormSignModal = true;
  }

  closeFormSignModal(): void {
    if (this.isPrintingFormSigns) return;
    this.showFormSignModal = false;
  }

  formSignIcon(id: string): string {
    const s = 'fill="none" stroke="#111" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"';
    const svg = (inner: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true">${inner}</svg>`;
    const ban = '<circle cx="32" cy="32" r="28" fill="none" stroke="#e10600" stroke-width="3.2"/><path d="M14 14l36 36" fill="none" stroke="#e10600" stroke-width="3.2" stroke-linecap="round"/>';
    if (id === 'closeDoor') {
      return svg(`<rect x="14" y="8" width="24" height="48" rx="2" ${s}/><circle cx="32" cy="32" r="1.8" fill="#111"/><path ${s} d="M44 18c8 6 8 22 0 28"/><path ${s} d="M44 18l6-2v8"/>`);
    }
    if (id === 'noEntry') {
      return svg(`<circle cx="32" cy="20" r="6" ${s}/><path ${s} d="M18 50c2-12 8-16 14-16s12 4 14 16"/>${ban}`);
    }
    if (id === 'whStaff') {
      return svg(`<circle cx="32" cy="16" r="6" ${s}/><path ${s} d="M20 28h24l-2 8H22z"/><path ${s} d="M16 54c2-12 8-16 16-16s14 4 16 16"/><path ${s} d="M24 16h16l-2-6H26z"/>`);
    }
    if (id === 'tellWh') {
      return svg(`<circle cx="20" cy="20" r="6" ${s}/><path ${s} d="M10 50c1.5-12 6-16 10-16s8.5 4 10 16"/><path ${s} d="M34 14h20v16H40l-6 6v-6"/>`);
    }
    if (id === 'noBattery') {
      return svg(`<rect x="8" y="12" width="28" height="40" rx="1.5" ${s}/><path ${s} d="M8 24h28M8 36h28"/><rect x="40" y="26" width="16" height="12" rx="1.5" ${s}/><path ${s} d="M56 29v6"/><path d="M38 22l20 20" fill="none" stroke="#e10600" stroke-width="3" stroke-linecap="round"/>`);
    }
    if (id === 'batteryTools') {
      return svg(`<rect x="10" y="28" width="26" height="14" rx="2" ${s}/><path ${s} d="M36 31h12v8H36"/><rect x="48" y="33" width="6" height="4" rx="0.6" ${s}/><rect x="16" y="20" width="12" height="8" rx="1.5" ${s}/><path ${s} d="M19 20V14h6"/>`);
    }
    if (id === 'trolley') {
      return svg(`<rect x="8" y="22" width="32" height="10" rx="1.5" ${s}/><path ${s} d="M40 26h12v14"/><circle cx="18" cy="46" r="5" ${s}/><circle cx="40" cy="46" r="5" ${s}/><path ${s} d="M14 22V12h18"/>`);
    }
    if (id === 'plasticBin') {
      return svg(`<path ${s} d="M12 20h40l-4 32H16z"/><path ${s} d="M18 20l2-8h24l2 8"/><path ${s} d="M24 30v14M32 30v14M40 30v14"/>`);
    }
    return svg(`<rect x="6" y="30" width="52" height="6" rx="1" ${s}/><rect x="10" y="36" width="8" height="12" ${s}/><rect x="28" y="36" width="8" height="12" ${s}/><rect x="46" y="36" width="8" height="12" ${s}/><rect x="14" y="16" width="16" height="14" rx="1" ${s}/><rect x="32" y="10" width="16" height="20" rx="1" ${s}/>`);
  }

  async printFormSign(id: string): Promise<void> {
    const item = this.formSigns.find((x) => x.id === id);
    if (!item || this.isPrintingFormSigns) return;
    this.isPrintingFormSigns = true;
    const a4 = this.formSignSize === 'A4';
    const pageW = a4 ? 297 : 210;
    const pageH = a4 ? 210 : 148;
    const iconMm = a4 ? 62 : 40;
    const viMm = a4 ? 16 : 10;
    const enMm = a4 ? 9 : 6;
    const vi = this.escapeSafetyText(item.vi);
    const en = this.escapeSafetyText(item.en);
    const icon = this.formSignIcon(item.id);
    try {
      const logoUrl = await this.resolveShelfLabelLogoUrl();
      this.printLabelHtml(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>${vi}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      background: #fff;
      font-family: "Times New Roman", Times, serif;
    }
    .fs {
      position: relative;
      width: ${pageW}mm;
      height: ${pageH}mm;
      background: #fff;
      color: #111;
      border: ${a4 ? 2.4 : 1.8}mm solid #111;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: ${a4 ? '16mm 14mm 10mm' : '12mm 10mm 8mm'};
      overflow: hidden;
      page: ${a4 ? 'a4land' : 'a5land'};
      font-family: "Times New Roman", Times, serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .fs-logo {
      position: absolute;
      top: ${a4 ? 5 : 3.5}mm;
      left: ${a4 ? 7 : 5}mm;
      height: ${a4 ? 12 : 8}mm;
      width: auto;
      max-width: ${a4 ? 46 : 30}mm;
      object-fit: contain;
      object-position: left center;
    }
    .fs-icon { width: ${iconMm}mm; height: ${iconMm}mm; }
    .fs-icon svg { width: 100%; height: 100%; display: block; }
    .fs-vi, .fs-en {
      width: 100%;
      font-family: "Times New Roman", Times, serif;
      color: #111;
    }
    .fs-vi {
      margin-top: ${a4 ? 6 : 4}mm;
      font-weight: 700;
      font-size: ${viMm}mm;
      line-height: 1.25;
      letter-spacing: 0;
    }
    .fs-en {
      margin-top: ${a4 ? 3 : 2}mm;
      font-weight: 400;
      font-size: ${enMm}mm;
      line-height: 1.25;
      letter-spacing: 0;
    }
    @page a4land { size: A4 landscape; margin: 0; }
    @page a5land { size: A5 landscape; margin: 0; }
    @page { size: ${a4 ? 'A4' : 'A5'} landscape; margin: 0; }
  </style>
</head>
<body>
  <section class="fs">
    <img class="fs-logo" src="${logoUrl}" alt="">
    <div class="fs-icon">${icon}</div>
    <p class="fs-vi">${vi}</p>
    <p class="fs-en">${en}</p>
  </section>
</body>
</html>`);
    } catch (err) {
      console.error('Error printing form sign:', err);
      alert('Lỗi khi in biểu mẫu. Vui lòng thử lại.');
    } finally {
      this.isPrintingFormSigns = false;
    }
  }

  private escapeSafetyText(value: string): string {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Cỡ chữ (mm) để số chiếm ~90% diện tích tem, tự co theo số chữ số. */
  private numberLabelFontSize(n: number, sizeMm: 57 | 100): string {
    const digits = String(n).length;
    const { widthMm, heightMm } = this.numberLabelDimensions(sizeMm);
    const boxW = widthMm * 0.9;
    const boxH = heightMm * 0.9;
    const digitWidthEm = 0.58;
    const fromHeight = boxH;
    const fromWidth = boxW / (digits * digitWidthEm);
    const fontMm = Math.min(fromHeight, fromWidth) * 0.98;
    return `${Math.max(4, Math.round(fontMm * 10) / 10)}mm`;
  }

  // ====== Tem vị trí kho J (57×32mm, QR trái / tên vị trí phải) ======

  openJLocLabelModal(): void {
    this.jLocQuery = '';
    this.jLocError = '';
    this.jLocExpandedId = this.jLocRGroups[0]?.id || this.jLocSGroups[0]?.id || '';
    this.showJLocLabelModal = true;
  }

  closeJLocLabelModal(): void {
    if (this.isPrintingJLocLabels) return;
    this.showJLocLabelModal = false;
    this.jLocError = '';
  }

  get jLocRGroups(): LayoutLocGroup[] {
    return this.filterJLocGroups(this.jLocGroups.filter((g) => /^R\d+$/i.test(g.id)));
  }

  get jLocSGroups(): LayoutLocGroup[] {
    return this.filterJLocGroups(this.jLocGroups.filter((g) => /^S\d+/i.test(g.id)));
  }

  get jLocSelectedCount(): number {
    return this.jLocSelected.size;
  }

  private filterJLocGroups(groups: LayoutLocGroup[]): LayoutLocGroup[] {
    const q = String(this.jLocQuery || '').trim().toUpperCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        slots: g.id.toUpperCase().includes(q)
          ? g.slots
          : g.slots.filter((s) => s.toUpperCase().includes(q))
      }))
      .filter((g) => g.slots.length > 0);
  }

  onJLocQueryChange(value: string): void {
    this.jLocQuery = String(value || '').toUpperCase();
  }

  toggleJLocGroup(id: string): void {
    this.jLocExpandedId = this.jLocExpandedId === id ? '' : id;
  }

  isJLocSlotSelected(slot: string): boolean {
    return this.jLocSelected.has(slot);
  }

  toggleJLocSlot(slot: string): void {
    const next = new Set(this.jLocSelected);
    if (next.has(slot)) next.delete(slot);
    else next.add(slot);
    this.jLocSelected = next;
  }

  selectJLocGroup(group: LayoutLocGroup, on?: boolean): void {
    const next = new Set(this.jLocSelected);
    const shouldOn = on ?? !group.slots.every((s) => next.has(s));
    for (const slot of group.slots) {
      if (shouldOn) next.add(slot);
      else next.delete(slot);
    }
    this.jLocSelected = next;
  }

  isJLocGroupAllSelected(group: LayoutLocGroup): boolean {
    return group.slots.length > 0 && group.slots.every((s) => this.jLocSelected.has(s));
  }

  jLocGroupSelectedCount(group: LayoutLocGroup): number {
    return group.slots.filter((s) => this.jLocSelected.has(s)).length;
  }

  clearJLocSelection(): void {
    this.jLocSelected = new Set();
  }

  jLocDiagram(group: LayoutLocGroup): Array<{
    block: number;
    levels: Array<{ level: number; cells: Array<{ slot: string; pos: string }> }>;
  }> {
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
            cells: (byBlock.get(block)!.get(level) || []).slice().sort((a, b) => a.pos.localeCompare(b.pos))
          }))
      }));
  }

  printJLocFromPlan(loc: { vi: string; en: string; qr: string }): void {
    const qty = Math.floor(Number(this.jLocPrintQty));
    if (!loc?.vi || !loc.qr || this.isPrintingJLocLabels) return;
    if (!Number.isFinite(qty) || qty < 1) {
      this.jLocError = 'Nhập số lượng tem từ 1 trở lên.';
      return;
    }
    void this.printJLocLabels(loc, qty);
  }

  async printJLocLabels(loc?: { vi: string; en: string; qr: string }, qty?: number): Promise<void> {
    if (!loc?.vi || !loc.qr) return;
    const count = Math.min(200, Math.floor(Number(qty)));
    if (!Number.isFinite(count) || count < 1) return;
    if (count > 40 && !confirm(`In ${count} tem vị trí?`)) return;
    const spec = this.jLocPaperSpec(this.jLocLabelSize, this.jLocOrient);
    this.jLocError = '';
    this.isPrintingJLocLabels = true;
    try {
      const [qrImage, logoUrl] = await Promise.all([
        QRCode.toDataURL(loc.qr, {
          width: 480,
          margin: 1,
          color: { dark: '#000000', light: '#FFFFFF' }
        }),
        this.jLocLogoOnWhite()
      ]);
      const esc = (value: string) =>
        value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const viText = loc.vi.toLocaleUpperCase('vi');
      const enText = (loc.en || loc.vi).toLocaleUpperCase('en');
      const vi = esc(viText);
      const en = esc(enText);
      const viFont = viText.length > 22 ? spec.vi * 0.62 : spec.vi;
      const enFont = enText.length > 28 ? spec.en * 0.7 : spec.en;
      const namePad = Math.max(spec.logo, spec.qr) + 8;
      const cell = (filled: boolean) => `
        <div class="j-loc-label${filled ? '' : ' j-loc-label--blank'}">
          ${filled ? `<img class="j-loc-label__logo" src="${logoUrl}" alt="AIRSPEED">
          <div class="j-loc-label__names">
            <div class="j-loc-label__vi" style="font-size:${viFont}mm">${vi}</div>
            <div class="j-loc-label__en" style="font-size:${enFont}mm">${en}</div>
          </div>
          <img class="j-loc-label__qr" src="${qrImage}" alt="QR ${vi}">` : ''}
        </div>`;
      const pages: string[] = [];
      for (let i = 0; i < count; i += spec.perPage) {
        const cells = [];
        for (let n = 0; n < spec.perPage; n++) cells.push(cell(i + n < count));
        pages.push(`<section class="j-loc-sheet">${cells.join('')}</section>`);
      }
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('Không thể mở cửa sổ in. Vui lòng cho phép popup.');
        return;
      }
      printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Tem vị trí ${esc(loc.vi)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #fff; }
    .j-loc-sheet {
      width: ${spec.pageW}mm;
      height: ${spec.pageH}mm;
      display: flex;
      flex-wrap: wrap;
      align-content: flex-start;
      page-break-after: always;
      overflow: hidden;
    }
    .j-loc-sheet:last-child { page-break-after: avoid; }
    .j-loc-label {
      width: ${spec.labelW}mm;
      height: ${spec.labelH}mm;
      border: 0.8mm solid #000;
      background: #fff;
      position: relative;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .j-loc-label__logo {
      position: absolute;
      top: 3mm;
      left: 3mm;
      width: ${spec.logo}mm;
      height: ${spec.logo}mm;
      object-fit: contain;
      object-position: left top;
    }
    .j-loc-label__qr {
      position: absolute;
      top: 4mm;
      right: 4mm;
      width: ${spec.qr}mm;
      height: ${spec.qr}mm;
      object-fit: contain;
    }
    .j-loc-label__names {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: ${namePad}mm 6mm 6mm;
      min-height: 0;
    }
    .j-loc-label__vi {
      font-weight: 800;
      line-height: 1.05;
      word-break: break-word;
    }
    .j-loc-label__en {
      margin-top: 2mm;
      font-weight: 600;
      line-height: 1.1;
      word-break: break-word;
    }
    @media print {
      body { margin: 0 !important; background: #fff !important; }
      @page { margin: 0 !important; size: ${spec.page} ${spec.orientCss} !important; }
      .j-loc-sheet { page-break-after: always !important; }
      .j-loc-sheet:last-child { page-break-after: avoid !important; }
    }
  </style>
</head>
<body>${pages.join('')}</body>
</html>`);
      printWindow.document.close();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 400);
    } catch (err) {
      console.error('Error printing J location labels:', err);
      alert('Lỗi khi in tem vị trí. Vui lòng thử lại.');
    } finally {
      this.isPrintingJLocLabels = false;
    }
  }

  private jLocPaperSpec(size: 'A3' | 'A4' | 'A5' | 'A6', orient: 'doc' | 'ngang'): {
    page: 'A3' | 'A4';
    orientCss: 'portrait' | 'landscape';
    pageW: number;
    pageH: number;
    labelW: number;
    labelH: number;
    perPage: number;
    vi: number;
    en: number;
    qr: number;
    logo: number;
  } {
    let page: 'A3' | 'A4' = 'A4';
    let pageW = 210;
    let pageH = 297;
    let labelW = 210;
    let labelH = 297;
    let perPage = 1;
    let vi = 22;
    let en = 12;
    let qr = 52;
    if (size === 'A3') {
      page = 'A3';
      pageW = 297;
      pageH = 420;
      labelW = 297;
      labelH = 420;
      vi = 28;
      en = 14;
      qr = 70;
    } else if (size === 'A5') {
      labelW = 210;
      labelH = 148.5;
      perPage = 2;
      vi = 14;
      en = 8;
      qr = 32;
    } else if (size === 'A6') {
      labelW = 105;
      labelH = 148.5;
      perPage = 4;
      vi = 9;
      en = 5.5;
      qr = 26;
    }
    if (orient === 'ngang') {
      const pageTmp = pageW;
      pageW = pageH;
      pageH = pageTmp;
      const labelTmp = labelW;
      labelW = labelH;
      labelH = labelTmp;
    }
    const logo = Math.round(Math.sqrt((pageW * pageH) / 16) * 10) / 10;
    return {
      page,
      orientCss: orient === 'ngang' ? 'landscape' : 'portrait',
      pageW,
      pageH,
      labelW,
      labelH,
      perPage,
      vi,
      en,
      qr,
      logo
    };
  }

  private async jLocLogoOnWhite(): Promise<string> {
    if (this.jLocLogoDataUrl) return this.jLocLogoDataUrl;
    const src = await this.resolveShelfLabelLogoUrl();
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('logo'));
      el.src = src;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const g = canvas.getContext('2d');
    if (!g || !canvas.width) return src;
    g.drawImage(img, 0, 0);
    const frame = g.getImageData(0, 0, canvas.width, canvas.height);
    const px = frame.data;
    for (let i = 0; i < px.length; i += 4) {
      const max = Math.max(px[i], px[i + 1], px[i + 2]);
      const min = Math.min(px[i], px[i + 1], px[i + 2]);
      if (max < 45 && max - min < 20) {
        px[i] = 255;
        px[i + 1] = 255;
        px[i + 2] = 255;
      }
    }
    g.putImageData(frame, 0, 0);
    this.jLocLogoDataUrl = canvas.toDataURL('image/png');
    return this.jLocLogoDataUrl;
  }

  // ====== Tem kệ (dãy R / S) — tem mâm hoặc label đầu kệ ======

  private buildShelfLabelSlotIndex(): void {
    const map = new Map<string, string[]>();
    for (const g of this.jLocGroups) {
      const id = String(g.id || '').toUpperCase();
      if (/^R\d+$/i.test(id) || /^S\d+/i.test(id)) {
        map.set(id, [...(g.slots || [])]);
      }
    }
    for (const aisle of this.shelfLabelSList) {
      if (map.has(aisle) && (map.get(aisle) || []).length) continue;
      const blocks = jKhoMatBlocksForRow(aisle);
      const slots: string[] = [];
      for (let block = 1; block <= blocks; block++) {
        for (let lv = 1; lv <= 7; lv++) slots.push(`${aisle}-${block}-${lv}`);
      }
      map.set(aisle, slots);
    }
    this.shelfLabelSlotsByAisle = map;
  }

  openShelfLabelModal(): void {
    this.shelfLabelQuery = '';
    this.shelfLabelError = '';
    this.shelfLabelPalletCount = 30;
    this.showShelfLabelModal = true;
  }

  closeShelfLabelModal(): void {
    if (this.isPrintingShelfLabels) return;
    this.showShelfLabelModal = false;
    this.shelfLabelError = '';
  }

  setShelfLabelKind(kind: 'mam' | 'dauKe' | 'dauKeNho' | 'palletSeq'): void {
    this.shelfLabelKind = kind;
    this.shelfLabelError = '';
  }

  setShelfLabelSize(size: '60x130' | '100x150'): void {
    this.shelfLabelSize = size;
  }

  onShelfLabelPalletCountChange(value: number | string): void {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < 1) {
      this.shelfLabelPalletCount = 1;
      return;
    }
    this.shelfLabelPalletCount = Math.min(999, n);
  }

  get shelfLabelPerPage(): number {
    return this.shelfLabelPerPageOf(this.shelfLabelSize);
  }

  shelfLabelPerPageOf(size: '60x130' | '100x150'): number {
    const { widthMm, heightMm } = this.shelfLabelDimensions(size);
    const pageW = 210;
    const pageH = 297;
    const margin = 5;
    const gap = 2;
    const usableW = pageW - margin * 2;
    const usableH = pageH - margin * 2;
    const cols = Math.max(1, Math.floor((usableW + gap) / (widthMm + gap)));
    const rows = Math.max(1, Math.floor((usableH + gap) / (heightMm + gap)));
    return cols * rows;
  }

  private shelfLabelDimensions(size: '60x130' | '100x150'): { widthMm: number; heightMm: number } {
    return size === '100x150'
      ? { widthMm: 150, heightMm: 100 }
      : { widthMm: 130, heightMm: 60 };
  }

  get shelfLabelSelectedCount(): number {
    return this.shelfLabelSelected.size;
  }

  /** Số tem sẽ in (mâm = tổng vị trí; đầu kệ = số dãy; palletSeq = dãy × số pallet). */
  get shelfLabelPrintCount(): number {
    if (this.shelfLabelKind === 'dauKe' || this.shelfLabelKind === 'dauKeNho') {
      return this.shelfLabelSelectedCount;
    }
    if (this.shelfLabelKind === 'palletSeq') {
      return this.shelfLabelSelectedCount * Math.max(1, this.shelfLabelPalletCount || 1);
    }
    return this.expandShelfLabelSelection().length;
  }

  get isShelfLabelDauKeKind(): boolean {
    return this.shelfLabelKind === 'dauKe' || this.shelfLabelKind === 'dauKeNho';
  }

  shelfLabelMamCountOf(aisle: string): number {
    return (this.shelfLabelSlotsByAisle.get(aisle) || []).length;
  }

  get shelfLabelRAisles(): string[] {
    return this.filterShelfLabelAisles(this.shelfLabelRList);
  }

  get shelfLabelSAisles(): string[] {
    return this.filterShelfLabelAisles(this.shelfLabelSList);
  }

  private filterShelfLabelAisles(list: string[]): string[] {
    const q = String(this.shelfLabelQuery || '').trim().toUpperCase();
    if (!q) return list;
    return list.filter((a) => a.includes(q));
  }

  onShelfLabelQueryChange(value: string): void {
    this.shelfLabelQuery = String(value || '').toUpperCase();
  }

  isShelfLabelSelected(aisle: string): boolean {
    return this.shelfLabelSelected.has(aisle);
  }

  toggleShelfLabel(aisle: string): void {
    const next = new Set(this.shelfLabelSelected);
    if (next.has(aisle)) next.delete(aisle);
    else next.add(aisle);
    this.shelfLabelSelected = next;
  }

  clearShelfLabelSelection(): void {
    this.shelfLabelSelected = new Set();
  }

  isShelfLabelFamilyAllSelected(family: 'R' | 'S'): boolean {
    const list = family === 'R' ? this.shelfLabelRAisles : this.shelfLabelSAisles;
    return list.length > 0 && list.every((a) => this.shelfLabelSelected.has(a));
  }

  toggleShelfLabelFamily(family: 'R' | 'S'): void {
    const list = family === 'R' ? this.shelfLabelRAisles : this.shelfLabelSAisles;
    const next = new Set(this.shelfLabelSelected);
    const shouldOn = !list.every((a) => next.has(a));
    for (const a of list) {
      if (shouldOn) next.add(a);
      else next.delete(a);
    }
    this.shelfLabelSelected = next;
  }

  private orderedShelfLabelAisles(): string[] {
    const all = [...this.shelfLabelRList, ...this.shelfLabelSList];
    const order = new Map(all.map((a, i) => [a, i]));
    return Array.from(this.shelfLabelSelected).sort(
      (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)
    );
  }

  /** Chọn dãy → bung ra từng mâm (S01-1-1 … S01-1-7, …). */
  private expandShelfLabelSelection(): string[] {
    const out: string[] = [];
    for (const aisle of this.orderedShelfLabelAisles()) {
      const slots = this.shelfLabelSlotsByAisle.get(aisle);
      if (slots?.length) out.push(...slots);
      else out.push(aisle);
    }
    return out;
  }

  /** Theo số pallet: R10 + 30 → R10-1 … R10-30 (mỗi dãy đã tick). */
  private expandShelfLabelPalletSeq(): string[] {
    const n = Math.max(1, Math.min(999, Math.floor(Number(this.shelfLabelPalletCount) || 1)));
    const out: string[] = [];
    for (const aisle of this.orderedShelfLabelAisles()) {
      for (let i = 1; i <= n; i++) out.push(`${aisle}-${i}`);
    }
    return out;
  }

  async printShelfLabels(): Promise<void> {
    await this.emitShelfLabels('print');
  }

  async downloadShelfLabels(): Promise<void> {
    await this.emitShelfLabels('download');
  }

  private async emitShelfLabels(mode: 'print' | 'download'): Promise<void> {
    const aisles = this.orderedShelfLabelAisles();
    if (!aisles.length) {
      this.shelfLabelError = 'Chọn ít nhất một dãy kệ để in.';
      return;
    }
    if (this.shelfLabelKind === 'palletSeq') {
      const n = Math.floor(Number(this.shelfLabelPalletCount) || 0);
      if (n < 1 || n > 999) {
        this.shelfLabelError = 'Số pallet phải từ 1 đến 999.';
        return;
      }
    }
    const names =
      this.shelfLabelKind === 'dauKe' || this.shelfLabelKind === 'dauKeNho'
        ? aisles
        : this.shelfLabelKind === 'palletSeq'
          ? this.expandShelfLabelPalletSeq()
          : this.expandShelfLabelSelection();
    if (!names.length) {
      this.shelfLabelError = 'Không có tem để in.';
      return;
    }
    if (
      (this.shelfLabelKind === 'mam' || this.shelfLabelKind === 'palletSeq') &&
      names.length > 300 &&
      !confirm(`In ${names.length} tem?`)
    ) {
      return;
    }
    this.shelfLabelError = '';
    this.isPrintingShelfLabels = true;
    try {
      const html =
        this.shelfLabelKind === 'dauKe'
          ? await this.buildDauKeLabelHtml(aisles)
          : this.shelfLabelKind === 'dauKeNho'
            ? await this.buildDauKeNhoLabelHtml(aisles)
            : this.shelfLabelKind === 'palletSeq'
              ? await this.buildShelfPalletSeqLabelHtml(names)
              : await this.buildShelfMamLabelHtml(names);
      const fileTag =
        this.shelfLabelKind === 'dauKe'
          ? `dau-ke-${aisles.length}`
          : this.shelfLabelKind === 'dauKeNho'
            ? `dau-ke-8x12-${aisles.length}`
            : this.shelfLabelKind === 'palletSeq'
              ? `pallet-seq-${names.length}`
              : `mam-${this.shelfLabelSize}-${names.length}`;
      if (mode === 'download') {
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tem-ke-${fileTag}.html`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('Không thể mở cửa sổ in. Vui lòng cho phép popup.');
        return;
      }
      printWindow.document.write(html);
      printWindow.document.close();
      setTimeout(() => {
        printWindow.focus();
        printWindow.print();
      }, 500);
      this.showShelfLabelModal = false;
    } catch (err) {
      console.error('Error creating shelf labels:', err);
      alert('Lỗi khi tạo tem kệ. Vui lòng thử lại.');
    } finally {
      this.isPrintingShelfLabels = false;
    }
  }

  private async resolveShelfLabelLogoUrl(): Promise<string> {
    const fallback =
      (typeof window !== 'undefined' ? window.location.origin : '') + '/assets/img/logo.png';
    try {
      const res = await fetch('/assets/img/logo.png');
      if (!res.ok) return fallback;
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || fallback));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    } catch {
      return fallback;
    }
  }

  /** Label đầu kệ: 1 trang/dãy — A4 ngang (R) hoặc A5 ngang (S), logo + chữ to. */
  private async buildDauKeLabelHtml(aisles: string[]): Promise<string> {
    const logoUrl = await this.resolveShelfLabelLogoUrl();
    const pages = aisles
      .map((name) => {
        const isS = /^S/i.test(name);
        const pageClass = isS ? 'page page--a5' : 'page page--a4';
        return `<div class="${pageClass}">
        <img class="dau-ke__logo" src="${logoUrl}" alt="AIRSPEED">
        <div class="dau-ke__name">${name}</div>
      </div>`;
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>Label đầu kệ — ${aisles.length} tem</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      background: #e2e8f0;
      color: #000;
      padding: 12px;
    }
    .toolbar {
      position: sticky; top: 0; z-index: 2;
      display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
      background: #fffbe6; border: 1px solid #e6c000; border-radius: 8px;
      padding: 10px 14px; margin-bottom: 12px;
    }
    .toolbar button {
      border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer;
      background: #0f172a; color: #fff; font-weight: 700;
    }
    .toolbar button.secondary { background: #64748b; }
    .meta { font-size: 13px; color: #334155; }
    .pages { display: flex; flex-direction: column; gap: 16px; align-items: center; }
    .page {
      background: #fff;
      box-shadow: 0 2px 12px rgba(15,23,42,.18);
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      page-break-after: always;
      overflow: hidden;
    }
    .page:last-child { page-break-after: auto; }
    /* In ngang: A4 297×210, A5 210×148 */
    .page--a4 { width: 297mm; height: 210mm; }
    .page--a5 { width: 210mm; height: 148mm; }
    .dau-ke__logo {
      position: absolute;
      top: 10mm;
      left: 12mm;
      height: 54.6mm;
      width: auto;
      max-width: 143mm;
      object-fit: contain;
      object-position: left top;
    }
    .page--a5 .dau-ke__logo {
      height: 41.6mm;
      top: 8mm;
      left: 10mm;
      max-width: 110.5mm;
    }
    .dau-ke__name {
      font-weight: 900;
      letter-spacing: 0.04em;
      line-height: 0.95;
      text-align: center;
      color: #000;
      padding: 0 8mm;
    }
    .page--a4 .dau-ke__name { font-size: 110mm; }
    .page--a5 .dau-ke__name { font-size: 78mm; }
    @media print {
      body { background: #fff !important; padding: 0 !important; }
      .toolbar { display: none !important; }
      .pages { gap: 0 !important; }
      .page { box-shadow: none !important; margin: 0 !important; }
      .page--a4 { page: a4land; }
      .page--a5 { page: a5land; }
      @page a4land { size: A4 landscape; margin: 0; }
      @page a5land { size: A5 landscape; margin: 0; }
      @page { margin: 0; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <span class="meta"><strong>${aisles.length}</strong> label đầu kệ · in ngang · R = A4 · S = A5</span>
    <button type="button" onclick="window.print()">In ngay</button>
    <button type="button" class="secondary" onclick="window.close()">Đóng</button>
  </div>
  <div class="pages">${pages}</div>
</body>
</html>`;
  }

  /** Tem đầu kệ size nhỏ: mỗi tem 8×12 cm (cao × ngang), xếp nhiều tem trên A4. */
  private async buildDauKeNhoLabelHtml(aisles: string[]): Promise<string> {
    const logoUrl = await this.resolveShelfLabelLogoUrl();
    const widthMm = 120; // ngang 12cm
    const heightMm = 80; // cao 8cm
    const pageW = 210;
    const pageH = 297;
    const margin = 5;
    const gap = 2;
    const usableW = pageW - margin * 2;
    const usableH = pageH - margin * 2;
    const cols = Math.max(1, Math.floor((usableW + gap) / (widthMm + gap)));
    const rows = Math.max(1, Math.floor((usableH + gap) / (heightMm + gap)));
    const perPage = cols * rows;

    const labelNodes = aisles.map(
      (name) => `
      <div class="dau-ke-nho">
        <img class="dau-ke-nho__logo" src="${logoUrl}" alt="AIRSPEED">
        <div class="dau-ke-nho__name">${name}</div>
      </div>`
    );

    const pagesHtml: string[] = [];
    for (let i = 0; i < labelNodes.length; i += perPage) {
      pagesHtml.push(`<div class="page">${labelNodes.slice(i, i + perPage).join('')}</div>`);
    }

    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>Tem đầu kệ 8×12cm — ${aisles.length} tem</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      background: #e2e8f0;
      color: #000;
      padding: 12px;
    }
    .toolbar {
      position: sticky; top: 0; z-index: 2;
      display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
      background: #fffbe6; border: 1px solid #e6c000; border-radius: 8px;
      padding: 10px 14px; margin-bottom: 12px;
    }
    .toolbar button {
      border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer;
      background: #0f172a; color: #fff; font-weight: 700;
    }
    .toolbar button.secondary { background: #64748b; }
    .meta { font-size: 13px; color: #334155; }
    .pages { display: flex; flex-direction: column; gap: 16px; align-items: center; }
    .page {
      width: ${pageW}mm;
      min-height: ${pageH}mm;
      background: #fff;
      box-shadow: 0 2px 12px rgba(15,23,42,.18);
      padding: ${margin}mm;
      display: grid;
      grid-template-columns: repeat(${cols}, ${widthMm}mm);
      grid-auto-rows: ${heightMm}mm;
      gap: ${gap}mm;
      align-content: start;
      justify-content: start;
      page-break-after: always;
    }
    .page:last-child { page-break-after: auto; }
    .dau-ke-nho {
      position: relative;
      width: ${widthMm}mm;
      height: ${heightMm}mm;
      border: 1px solid #111;
      background: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      page-break-inside: avoid;
    }
    .dau-ke-nho__logo {
      position: absolute;
      top: 3.5mm;
      left: 4mm;
      height: 18mm;
      width: auto;
      max-width: 48mm;
      object-fit: contain;
      object-position: left top;
    }
    .dau-ke-nho__name {
      font-weight: 900;
      font-size: 42mm;
      letter-spacing: 0.04em;
      line-height: 0.95;
      text-align: center;
      color: #000;
      padding: 0 4mm;
    }
    @media print {
      body { background: #fff !important; padding: 0 !important; }
      .toolbar { display: none !important; }
      .pages { gap: 0 !important; }
      .page {
        box-shadow: none !important;
        margin: 0 !important;
        width: ${pageW}mm !important;
        min-height: ${pageH}mm !important;
        height: ${pageH}mm !important;
      }
      @page { margin: 0 !important; size: A4 portrait; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <span class="meta"><strong>${aisles.length}</strong> tem đầu kệ · mỗi tem <strong>8 × 12 cm</strong> · <strong>${perPage}</strong> tem/A4</span>
    <button type="button" onclick="window.print()">In ngay</button>
    <button type="button" class="secondary" onclick="window.close()">Đóng</button>
  </div>
  <div class="pages">${pagesHtml.join('')}</div>
</body>
</html>`;
  }

  /**
   * Tem theo số thứ tự pallet — 57×32mm (cùng cỡ tem inbound / tem vị trí kho J):
   * QR trái (nội dung = tên vị trí), tên vị trí phải. VD R10-1 … R10-30.
   */
  private async buildShelfPalletSeqLabelHtml(names: string[]): Promise<string> {
    const qrImages = await Promise.all(
      names.map((name) =>
        QRCode.toDataURL(name, {
          width: 360,
          margin: 1,
          color: { dark: '#000000', light: '#FFFFFF' }
        })
      )
    );

    const labelHtml = names
      .map(
        (name, i) => `
        <div class="j-loc-label">
          <div class="j-loc-label__qr">
            <img src="${qrImages[i]}" alt="QR ${name}">
          </div>
          <div class="j-loc-label__text">${name}</div>
        </div>`
      )
      .join('');

    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>Tem pallet theo kệ — ${names.length} tem</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 0;
      background: #fff;
      width: 57mm;
      height: 32mm;
    }
    .j-loc-label {
      width: 57mm;
      height: 32mm;
      border: 1px solid #000;
      display: flex;
      align-items: stretch;
      background: #fff;
      overflow: hidden;
      page-break-after: always;
      page-break-inside: avoid;
    }
    .j-loc-label:last-child { page-break-after: avoid; }
    .j-loc-label__qr {
      width: 39mm;
      height: 32mm;
      display: flex;
      align-items: center;
      justify-content: center;
      border-right: 1px solid #ccc;
      flex-shrink: 0;
    }
    .j-loc-label__qr img {
      width: 30.5mm;
      height: 30.5mm;
      object-fit: contain;
      display: block;
    }
    .j-loc-label__text {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1mm 1.5mm;
      text-align: center;
      font-size: 15px;
      font-weight: bold;
      color: #000;
      word-break: break-word;
    }
    @media print {
      body { margin: 0 !important; padding: 0 !important; background: #fff !important; width: 57mm !important; height: 32mm !important; }
      @page { margin: 0 !important; size: 57mm 32mm !important; }
      .j-loc-label {
        width: 57mm !important;
        height: 32mm !important;
        page-break-after: always !important;
      }
      .j-loc-label:last-child { page-break-after: avoid !important; }
    }
  </style>
</head>
<body>${labelHtml}</body>
</html>`;
  }

  /** Tem từng mâm kệ — logo + tên + QR, xếp trên A4 theo size đã chọn. */
  private async buildShelfMamLabelHtml(names: string[]): Promise<string> {
    const { widthMm, heightMm } = this.shelfLabelDimensions(this.shelfLabelSize);
    const perPage = this.shelfLabelPerPageOf(this.shelfLabelSize);
    const pageW = 210;
    const pageH = 297;
    const margin = 5;
    const gap = 2;
    const usableW = pageW - margin * 2;
    const cols = Math.max(1, Math.floor((usableW + gap) / (widthMm + gap)));
    const logoUrl = await this.resolveShelfLabelLogoUrl();
    const qrSize = Math.round(Math.min(widthMm, heightMm) * 0.55 * 3.78);
    const qrImages = await Promise.all(
      names.map((name) =>
        QRCode.toDataURL(name, {
          width: Math.max(120, qrSize),
          margin: 1,
          color: { dark: '#000000', light: '#FFFFFF' }
        })
      )
    );

    const nameFontMm = heightMm >= 80 ? 14 : 9;
    const logoH = heightMm >= 80 ? 20.28 : 11.83; // +30% so với 15.6 / 9.1
    const qrMm = Math.min(heightMm * 0.78, Math.min(heightMm * 0.62, widthMm * 0.28) * 1.3);

    const labelNodes = names.map(
      (name, i) => `
      <div class="shelf-lbl">
        <img class="shelf-lbl__logo" src="${logoUrl}" alt="AIRSPEED">
        <img class="shelf-lbl__qr-corner" src="${qrImages[i]}" alt="QR ${name}">
        <div class="shelf-lbl__body">
          <div class="shelf-lbl__name">${name}</div>
        </div>
      </div>`
    );

    const pagesHtml: string[] = [];
    for (let i = 0; i < labelNodes.length; i += perPage) {
      pagesHtml.push(`<div class="page">${labelNodes.slice(i, i + perPage).join('')}</div>`);
    }

    return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>Tem mâm kệ ${this.shelfLabelSize} — ${names.length} tem</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      background: #e2e8f0;
      color: #000;
      padding: 12px;
    }
    .toolbar {
      position: sticky; top: 0; z-index: 2;
      display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
      background: #fffbe6; border: 1px solid #e6c000; border-radius: 8px;
      padding: 10px 14px; margin-bottom: 12px;
    }
    .toolbar button {
      border: none; border-radius: 6px; padding: 8px 16px; cursor: pointer;
      background: #0f172a; color: #fff; font-weight: 700;
    }
    .toolbar button.secondary { background: #64748b; }
    .meta { font-size: 13px; color: #334155; }
    .pages { display: flex; flex-direction: column; gap: 16px; align-items: center; }
    .page {
      width: ${pageW}mm;
      min-height: ${pageH}mm;
      background: #fff;
      box-shadow: 0 2px 12px rgba(15,23,42,.18);
      padding: ${margin}mm;
      display: grid;
      grid-template-columns: repeat(${cols}, ${widthMm}mm);
      grid-auto-rows: ${heightMm}mm;
      gap: ${gap}mm;
      align-content: start;
      justify-content: start;
      page-break-after: always;
    }
    .page:last-child { page-break-after: auto; }
    .shelf-lbl {
      position: relative;
      width: ${widthMm}mm;
      height: ${heightMm}mm;
      border: 1px solid #111;
      background: #fff;
      padding: 2mm 3mm 2.5mm;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      page-break-inside: avoid;
    }
    .shelf-lbl__logo {
      height: ${logoH}mm;
      width: auto;
      max-width: 48%;
      object-fit: contain;
      object-position: left center;
      align-self: flex-start;
      display: block;
    }
    .shelf-lbl__qr-corner {
      position: absolute;
      top: 2mm;
      right: 2.5mm;
      width: ${Math.min(qrMm, heightMm * 0.42)}mm;
      height: ${Math.min(qrMm, heightMm * 0.42)}mm;
      object-fit: contain;
      display: block;
    }
    .shelf-lbl__body {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding-right: ${Math.min(qrMm, heightMm * 0.42) * 0.35}mm;
    }
    .shelf-lbl__name {
      flex: 1;
      text-align: center;
      font-size: ${nameFontMm}mm;
      font-weight: 900;
      letter-spacing: 0.02em;
      line-height: 1.05;
      color: #000;
      word-break: break-all;
    }
    @media print {
      body { background: #fff !important; padding: 0 !important; }
      .toolbar { display: none !important; }
      .pages { gap: 0 !important; }
      .page {
        box-shadow: none !important;
        margin: 0 !important;
        width: ${pageW}mm !important;
        min-height: ${pageH}mm !important;
        height: ${pageH}mm !important;
      }
      @page { size: A4 portrait; margin: 0; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <span class="meta"><strong>${names.length}</strong> tem mâm · ${widthMm}×${heightMm}mm · ${perPage} tem/trang A4</span>
    <button type="button" onclick="window.print()">In ngay</button>
    <button type="button" class="secondary" onclick="window.close()">Đóng</button>
  </div>
  <div class="pages">
    ${pagesHtml.join('')}
  </div>
</body>
</html>`;
  }

  get internalTemplatePageCount(): number {
    const n = Math.floor(Number(this.internalTemplatePages) || 0);
    return Math.min(20, Math.max(1, n));
  }

  openInternalTemplateModal(): void {
    this.showInternalTemplateModal = true;
    this.showInternalTemplateForm = false;
    this.internalTemplateError = '';
    this.loadInternalTemplates();
  }

  closeInternalTemplateModal(): void {
    if (this.isSavingInternalTemplate) return;
    this.showInternalTemplateModal = false;
    this.showInternalTemplateForm = false;
  }

  openInternalTemplateForm(): void {
    this.internalTemplateName = '';
    this.internalTemplateContent = '';
    this.internalTemplateContentEn = '';
    this.internalTemplatePages = 1;
    this.internalTemplateSize = 'A4';
    this.internalTemplateBilingual = false;
    this.internalTemplateError = '';
    this.showInternalTemplateForm = true;
    this.refreshInternalTemplateDrawing();
  }

  closeInternalTemplateForm(): void {
    if (this.isSavingInternalTemplate) return;
    this.showInternalTemplateForm = false;
    this.internalTemplateError = '';
  }

  loadInternalTemplates(): void {
    this.isLoadingInternalTemplates = true;
    this.firestore.collection('pallet-internal-templates').get()
      .pipe(takeUntil(this.destroy$))
      .subscribe(snapshot => {
        const rows = snapshot.docs.map(doc => {
          const data = doc.data() as any;
          const size = data.size === 'A3' || data.size === 'A5' ? data.size : 'A4';
          const pageCount = Math.min(20, Math.max(1, Number(data.pageCount) || 1));
          let previewUrl = String(data.previewUrl || '');
          try {
            previewUrl = this.drawInternalTemplatePreview({
              name: String(data.name || 'Mẫu nội bộ'),
              content: String(data.content || ' '),
              contentEn: String(data.contentEn || ''),
              bilingual: !!data.bilingual,
              pageCount,
              size
            }) || previewUrl;
          } catch (err) {
            console.error('draw saved template', err);
          }
          return {
            id: doc.id,
            name: String(data.name || ''),
            content: String(data.content || ''),
            contentEn: String(data.contentEn || ''),
            bilingual: !!data.bilingual,
            pageCount,
            size,
            previewUrl,
            createdAt: data.createdAt?.toDate?.() || new Date()
          } as InternalTemplateItem;
        });
        rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        this.internalTemplates = rows;
        this.isLoadingInternalTemplates = false;
        this.cdr.markForCheck();
      }, () => {
        this.isLoadingInternalTemplates = false;
        this.cdr.markForCheck();
      });
  }

  async createInternalTemplate(): Promise<void> {
    if (this.isSavingInternalTemplate) return;
    const name = this.internalTemplateName.trim();
    const content = this.internalTemplateContent.trim();
    const contentEn = this.internalTemplateContentEn.trim();
    const pageCount = this.internalTemplatePageCount;
    const size = this.internalTemplateSize;
    const bilingual = this.internalTemplateBilingual;
    if (!name) {
      this.internalTemplateError = 'Đặt tên mẫu.';
      return;
    }
    if (!content) {
      this.internalTemplateError = 'Nhập nội dung.';
      return;
    }
    if (bilingual && !contentEn) {
      this.internalTemplateError = 'Nhập nội dung tiếng Anh.';
      return;
    }
    this.internalTemplateError = '';
    this.isSavingInternalTemplate = true;
    try {
      const previewUrl = this.drawInternalTemplatePreview({
        name, content, contentEn, bilingual, pageCount, size
      });
      await this.firestore.collection('pallet-internal-templates').add({
        name,
        content,
        contentEn: bilingual ? contentEn : '',
        bilingual,
        pageCount,
        size,
        previewUrl,
        createdAt: new Date()
      });
      this.showInternalTemplateForm = false;
      this.loadInternalTemplates();
    } catch (err) {
      console.error('create internal template', err);
      this.internalTemplateError = 'Không lưu được mẫu. Vui lòng thử lại.';
    } finally {
      this.isSavingInternalTemplate = false;
      this.cdr.markForCheck();
    }
  }

  setInternalTemplateSize(size: InternalTemplateSize): void {
    this.internalTemplateSize = size;
    this.refreshInternalTemplateDrawing();
  }

  refreshInternalTemplateDrawing(): void {
    const name = this.internalTemplateName.trim() || 'Mẫu nội bộ';
    const content = this.internalTemplateContent.trim() || 'Nội dung sẽ hiện ở đây';
    try {
      this.internalTemplatePreviewUrl = this.drawInternalTemplatePreview({
        name,
        content,
        contentEn: this.internalTemplateContentEn.trim(),
        bilingual: this.internalTemplateBilingual && !!this.internalTemplateContentEn.trim(),
        pageCount: this.internalTemplatePageCount,
        size: this.internalTemplateSize
      });
    } catch (err) {
      console.error('draw internal template', err);
      this.internalTemplatePreviewUrl = '';
    }
  }

  printInternalTemplate(item: InternalTemplateItem): void {
    const mm = this.internalTemplatePageMm[item.size];
    const scene = this.internalTemplateScene(`${item.name} ${item.content}`);
    const icon = this.internalTemplateIconSvg(scene);
    const laid = this.layoutInternalTemplate(item);
    const pages = laid.pages.map((page, index) => {
      const vi = page.viLines.map((line) => this.escapeSafetyText(line)).join('<br>');
      const en = page.enLines.map((line) => this.escapeSafetyText(line)).join('<br>');
      const viMm = this.internalPxToMm(page.viFontPx, mm.w);
      const viLh = this.internalPxToMm(page.viLinePx, mm.w);
      const enMm = this.internalPxToMm(page.enFontPx, mm.w);
      const enLh = this.internalPxToMm(page.enLinePx, mm.w);
      const iconMm = this.internalPxToMm(page.iconH, mm.w);
      return `<section class="pg${index ? ' pg--next' : ''}">
        <div class="ico" style="width:${iconMm}mm;height:${iconMm}mm">${icon}</div>
        <h1>${this.escapeSafetyText(item.name)}</h1>
        <div class="vi" style="font-size:${viMm}mm;line-height:${viLh}mm">${vi}</div>
        ${item.bilingual ? `<div class="en" style="font-size:${enMm}mm;line-height:${enLh}mm">${en}</div>` : ''}
        <footer>${item.size} · ${index + 1}/${laid.pages.length}</footer>
      </section>`;
    }).join('');
    this.printLabelHtml(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>${this.escapeSafetyText(item.name)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #fff; }
    .pg {
      position: relative;
      width: ${mm.w}mm;
      height: ${mm.h}mm;
      padding: 12mm 14mm 12mm;
      page-break-after: always;
      font-family: "Times New Roman", Times, serif;
      color: #111;
      overflow: hidden;
      border: 2.2mm solid #111;
      text-align: center;
    }
    .ico { margin: 0 auto 4mm; }
    .ico svg { width: 100%; height: 100%; display: block; }
    h1 { font-size: 9mm; line-height: 1.15; text-align: center; margin-bottom: 4mm; }
    .vi, .en { width: 100%; word-break: break-word; text-align: center; }
    .en { margin-top: 5mm; font-style: italic; }
    footer { position: absolute; left: 0; right: 0; bottom: 6mm; text-align: center; font-size: 3.2mm; }
    @page { size: ${item.size} portrait; margin: 0; }
  </style>
</head>
<body>${pages}</body>
</html>`);
  }

  private internalPxToMm(px: number, pageWidthMm: number): number {
    return Math.round((px / 1000) * pageWidthMm * 10) / 10;
  }

  private internalMeasureCtx(): CanvasRenderingContext2D {
    if (!this.internalMeasureCanvas) this.internalMeasureCanvas = document.createElement('canvas');
    const ctx = this.internalMeasureCanvas.getContext('2d');
    if (!ctx) throw new Error('Không tạo được hình mô tả.');
    return ctx;
  }

  private wrapInternalLines(
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number,
    fontPx: number
  ): string[] {
    ctx.font = `${fontPx}px "Times New Roman", Times, serif`;
    const lines: string[] = [];
    const paragraphs = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const pushLong = (word: string) => {
      let chunk = '';
      for (const ch of word) {
        const next = chunk + ch;
        if (ctx.measureText(next).width <= maxWidth) chunk = next;
        else {
          if (chunk) lines.push(chunk);
          chunk = ch;
        }
      }
      return chunk;
    };
    paragraphs.forEach((para, paraIndex) => {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) {
        if (paraIndex < paragraphs.length - 1) lines.push('');
        return;
      }
      let line = '';
      words.forEach((word) => {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width <= maxWidth) {
          line = test;
          return;
        }
        if (line) lines.push(line);
        line = ctx.measureText(word).width <= maxWidth ? word : pushLong(word);
      });
      if (line) lines.push(line);
    });
    return lines.length ? lines : [''];
  }

  private expandInternalLines(lines: string[], count: number): string[] {
    const out = lines.map((line) => line.trim()).filter((line) => line.length > 0);
    if (!out.length) return Array.from({ length: count }, () => '');
    let guard = 0;
    while (out.length < count && guard < 800) {
      guard += 1;
      let idx = 0;
      out.forEach((line, i) => {
        if (line.length > out[idx].length) idx = i;
      });
      const line = out[idx];
      if (line.length < 2) break;
      const mid = Math.max(1, Math.floor(line.length / 2));
      let cut = line.lastIndexOf(' ', mid);
      if (cut < 1) cut = mid;
      const left = line.slice(0, cut).trim();
      const right = line.slice(cut).trim();
      if (!left || !right) break;
      out.splice(idx, 1, left, right);
    }
    while (out.length < count) out.push(out[out.length - 1]);
    return out;
  }

  private chunkInternalLines(lines: string[], pages: number): string[][] {
    const chunks: string[][] = [];
    const base = Math.floor(lines.length / pages);
    const extra = lines.length % pages;
    let index = 0;
    for (let page = 0; page < pages; page += 1) {
      const take = base + (page < extra ? 1 : 0);
      const slice = lines.slice(index, index + take);
      chunks.push(slice.length ? slice : ['']);
      index += take;
    }
    return chunks;
  }

  private fitInternalZone(lineCount: number, zoneH: number): { font: number; line: number } {
    const n = Math.max(1, lineCount);
    let line = zoneH / n;
    let font = Math.min(line * 0.72, 86);
    font = Math.max(16, font);
    line = Math.max(font * 1.2, Math.min(line, font * 1.7));
    if (line * n > zoneH) {
      line = zoneH / n;
      font = Math.max(12, line * 0.72);
    }
    return { font, line };
  }

  private layoutInternalTemplate(opts: {
    name: string;
    content: string;
    contentEn: string;
    bilingual: boolean;
    pageCount: number;
    size: InternalTemplateSize;
  }): { pageW: number; pageH: number; margin: number; titlePx: number; pages: InternalTemplatePage[] } {
    const mm = this.internalTemplatePageMm[opts.size];
    const pageW = 1000;
    const pageH = Math.round(pageW * (mm.h / mm.w));
    const margin = 64;
    const titlePx = 42;
    const innerW = pageW - margin * 2;
    const ctx = this.internalMeasureCtx();
    const viAll = this.expandInternalLines(
      this.wrapInternalLines(ctx, opts.content, innerW, 34),
      opts.pageCount
    );
    const enAll = opts.bilingual
      ? this.expandInternalLines(this.wrapInternalLines(ctx, opts.contentEn, innerW, 28), opts.pageCount)
      : [];
    const viChunks = this.chunkInternalLines(viAll, opts.pageCount);
    const enChunks = opts.bilingual ? this.chunkInternalLines(enAll, opts.pageCount) : [];
    const pages = viChunks.map((viLines, index) => {
      const enLines = enChunks[index] || [];
      const iconH = index === 0 ? Math.round(pageW * 0.34) : Math.round(pageW * 0.1);
      const bodyH = pageH - margin - iconH - titlePx - 36 - margin - 40;
      const viH = opts.bilingual ? bodyH * 0.58 : bodyH;
      const enH = opts.bilingual ? bodyH * 0.34 : 0;
      const viFit = this.fitInternalZone(viLines.length, Math.max(40, viH));
      const enFit = this.fitInternalZone(enLines.length || 1, Math.max(24, enH || 1));
      return {
        viLines,
        enLines,
        viFontPx: viFit.font,
        viLinePx: viFit.line,
        enFontPx: enFit.font,
        enLinePx: enFit.line,
        iconH
      };
    });
    return { pageW, pageH, margin, titlePx, pages };
  }

  private drawInternalTemplatePreview(opts: {
    name: string;
    content: string;
    contentEn: string;
    bilingual: boolean;
    pageCount: number;
    size: InternalTemplateSize;
  }): string {
    const laid = this.layoutInternalTemplate(opts);
    const scene = this.internalTemplateScene(`${opts.name} ${opts.content}`);
    const gap = 22;
    const maxH = 1680;
    let scale = 0.56;
    const naturalH = laid.pages.length * laid.pageH * scale + (laid.pages.length - 1) * gap;
    if (naturalH > maxH) scale = (maxH - (laid.pages.length - 1) * gap) / (laid.pages.length * laid.pageH);
    const pageW = Math.max(220, Math.round(laid.pageW * scale));
    const pageH = Math.max(300, Math.round(laid.pageH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = pageW + 28;
    canvas.height = laid.pages.length * pageH + (laid.pages.length - 1) * gap + 28;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Không tạo được hình mô tả.');
    ctx.fillStyle = '#efeae2';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const s = pageW / laid.pageW;
    laid.pages.forEach((page, index) => {
      const left = 14;
      const top = 14 + index * (pageH + gap);
      ctx.fillStyle = 'rgba(17,24,39,0.08)';
      ctx.fillRect(left + 8, top + 10, pageW, pageH);
      ctx.fillStyle = '#fff';
      ctx.fillRect(left, top, pageW, pageH);
      ctx.strokeStyle = '#111';
      ctx.lineWidth = Math.max(3, 7 * s);
      ctx.strokeRect(left + 3, top + 3, pageW - 6, pageH - 6);
      const icon = page.iconH * s;
      this.drawInternalScene(ctx, scene, left + (pageW - icon) / 2, top + laid.margin * s * 0.45, icon);
      let y = top + laid.margin * s * 0.45 + icon + 10 * s;
      ctx.fillStyle = '#111';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = `700 ${Math.max(16, Math.round(laid.titlePx * s))}px "Times New Roman", Times, serif`;
      ctx.fillText(opts.name, left + pageW / 2, y, pageW - laid.margin * 2 * s);
      y += laid.titlePx * s + 8 * s;
      ctx.font = `${Math.max(13, Math.round(page.viFontPx * s))}px "Times New Roman", Times, serif`;
      page.viLines.forEach((line) => {
        if (line) ctx.fillText(line, left + pageW / 2, y, pageW - laid.margin * 2 * s);
        y += page.viLinePx * s;
      });
      if (opts.bilingual) {
        y += 10 * s;
        ctx.fillStyle = '#374151';
        ctx.font = `italic ${Math.max(12, Math.round(page.enFontPx * s))}px "Times New Roman", Times, serif`;
        page.enLines.forEach((line) => {
          if (line) ctx.fillText(line, left + pageW / 2, y, pageW - laid.margin * 2 * s);
          y += page.enLinePx * s;
        });
      }
      ctx.fillStyle = '#6b7280';
      ctx.font = `${Math.max(11, Math.round(16 * s))}px "Times New Roman", Times, serif`;
      ctx.fillText(`${opts.size}  ·  ${index + 1} / ${laid.pages.length}`, left + pageW / 2, top + pageH - 26 * s);
    });
    let quality = 0.82;
    let url = canvas.toDataURL('image/jpeg', quality);
    while (url.length > 800000 && quality > 0.45) {
      quality -= 0.1;
      url = canvas.toDataURL('image/jpeg', quality);
    }
    return url;
  }

  private internalTemplateScene(text: string): InternalTemplateScene {
    const s = String(text || '').toLowerCase();
    if (/cửa|cua|door/.test(s)) return 'door';
    if (/miễn vào|mien vao|cấm|cam vao|không vào|khong vao|no entry/.test(s)) return 'stop';
    if (/nhân viên|nhan vien|staff|ppe|an toàn|an toan/.test(s)) return 'staff';
    if (/báo|bao quản|quản lý|quan ly|notify/.test(s)) return 'talk';
    if (/pin|battery/.test(s)) return 'battery';
    if (/xe đẩy|xe day|trolley|xe nâng/.test(s)) return 'cart';
    if (/thùng|thung|bin|nhựa|nhua/.test(s)) return 'bin';
    if (/pallet|kệ| ke\b/.test(s)) return 'pallet';
    return 'note';
  }

  private internalTemplateIconSvg(scene: InternalTemplateScene): string {
    const s = 'fill="none" stroke="#111" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"';
    const wrap = (inner: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true">${inner}</svg>`;
    if (scene === 'door') return wrap(`<rect x="16" y="8" width="24" height="48" rx="2" ${s}/><circle cx="34" cy="32" r="1.8" fill="#111"/><path ${s} d="M46 18c8 6 8 22 0 28"/>`);
    if (scene === 'stop') return wrap(`<circle cx="32" cy="22" r="7" ${s}/><path ${s} d="M18 54c2-14 8-18 14-18s12 4 14 18"/><circle cx="32" cy="32" r="26" fill="none" stroke="#c81e1e" stroke-width="3"/><path d="M14 14l36 36" stroke="#c81e1e" stroke-width="3" stroke-linecap="round"/>`);
    if (scene === 'staff') return wrap(`<path ${s} d="M22 18h20l-2-8H24z"/><circle cx="32" cy="24" r="6" ${s}/><path ${s} d="M18 54c2-14 8-18 14-18s12 4 14 18"/>`);
    if (scene === 'talk') return wrap(`<path ${s} d="M10 14h32v20H22l-8 8v-8H10z"/><circle cx="44" cy="40" r="8" ${s}/><path ${s} d="M40 54c1-6 3-8 4-8"/>`);
    if (scene === 'battery') return wrap(`<rect x="10" y="22" width="36" height="20" rx="3" ${s}/><path ${s} d="M46 28h6v8h-6"/><path ${s} d="M22 32h8M26 28v8"/>`);
    if (scene === 'cart') return wrap(`<path ${s} d="M8 18h10l6 22h24"/><circle cx="28" cy="48" r="4" ${s}/><circle cx="44" cy="48" r="4" ${s}/><path ${s} d="M20 28h28l-3 12H24"/>`);
    if (scene === 'bin') return wrap(`<path ${s} d="M14 20h36l-4 32H18z"/><path ${s} d="M20 20l2-8h20l2 8"/><path ${s} d="M26 30v14M32 30v14M38 30v14"/>`);
    if (scene === 'pallet') return wrap(`<rect x="8" y="28" width="48" height="8" rx="1" ${s}/><path ${s} d="M14 36v12M32 36v12M50 36v12"/><rect x="16" y="12" width="14" height="16" ${s}/><rect x="34" y="16" width="14" height="12" ${s}/>`);
    return wrap(`<path ${s} d="M18 8h20l10 10v38H18z"/><path ${s} d="M38 8v10h10"/><path ${s} d="M24 30h16M24 38h16M24 46h10"/>`);
  }

  private drawInternalScene(
    ctx: CanvasRenderingContext2D,
    scene: InternalTemplateScene,
    x: number,
    y: number,
    size: number
  ): void {
    const s = size;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#f7f3ea';
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.48, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = Math.max(2, s * 0.035);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    const u = s / 64;
    const ink = () => {
      ctx.strokeStyle = '#111';
      ctx.lineWidth = Math.max(1.6, s * 0.028);
    };
    ctx.save();
    ctx.translate(s * 0.18, s * 0.18);
    ctx.scale(u * 0.64, u * 0.64);
    ink();
    const path = (d: string) => {
      const p = new Path2D(d);
      ctx.stroke(p);
    };
    if (scene === 'door') {
      path('M18 6h22v52H18z');
      ctx.beginPath(); ctx.arc(34, 32, 2, 0, Math.PI * 2); ctx.fill();
      path('M40 16c10 8 10 24 0 32');
    } else if (scene === 'stop') {
      path('M32 12a8 8 0 1 1 0 16a8 8 0 1 1 0-16');
      path('M16 54c3-16 9-20 16-20s13 4 16 20');
      ctx.strokeStyle = '#c81e1e';
      ctx.lineWidth = Math.max(2, s * 0.04);
      path('M8 8l48 48');
      ctx.beginPath(); ctx.arc(32, 32, 28, 0, Math.PI * 2); ctx.stroke();
    } else if (scene === 'staff') {
      path('M20 16h24l-2-8H22z');
      path('M32 18a7 7 0 1 1 0 14a7 7 0 1 1 0-14');
      path('M16 56c3-16 9-20 16-20s13 4 16 20');
    } else if (scene === 'talk') {
      path('M6 10h36v22H20l-10 10V32H6z');
      path('M44 36a8 8 0 1 1 0 16a8 8 0 1 1 0-16');
    } else if (scene === 'battery') {
      path('M8 22h40v20H8z');
      path('M48 28h8v8h-8');
      path('M20 32h12M26 26v12');
    } else if (scene === 'cart') {
      path('M6 14h12l8 24h28');
      path('M22 26h30l-4 12H24');
      ctx.beginPath(); ctx.arc(28, 50, 4, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(46, 50, 4, 0, Math.PI * 2); ctx.stroke();
    } else if (scene === 'bin') {
      path('M12 18h40l-5 36H17z');
      path('M18 18l3-8h22l3 8');
      path('M24 28v16M32 28v16M40 28v16');
    } else if (scene === 'pallet') {
      path('M6 28h52v8H6z');
      path('M14 36v16M32 36v16M50 36v16');
      path('M14 10h16v18H14z');
      path('M34 14h16v14H34z');
    } else {
      path('M16 6h22l12 12v40H16z');
      path('M38 6v12h12');
      path('M24 30h16M24 38h16M24 46h10');
    }
    ctx.restore();
    ctx.restore();
  }
}
