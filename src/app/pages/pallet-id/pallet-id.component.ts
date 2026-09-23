import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
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

  /** Tem vị trí kho J — 57×32mm, QR trái / tên vị trí phải */
  showJLocLabelModal = false;
  jLocQuery = '';
  jLocExpandedId = '';
  jLocSelected = new Set<string>();
  jLocError = '';
  isPrintingJLocLabels = false;
  readonly jLocGroups: LayoutLocGroup[] = getLayoutLocationGroups('J');

  /** Tem kệ (dãy R/S) — tem mâm hoặc label đầu kệ */
  showShelfLabelModal = false;
  shelfLabelQuery = '';
  shelfLabelSelected = new Set<string>();
  shelfLabelError = '';
  isPrintingShelfLabels = false;
  /** mam = từng mâm (S01-1-1…); dauKe = 1 tem/dãy (A4 R / A5 S) */
  shelfLabelKind: 'mam' | 'dauKe' = 'mam';
  shelfLabelSize: '60x130' | '100x150' = '60x130';
  private readonly shelfLabelRList: string[] = Array.from({ length: 28 }, (_, i) =>
    `R${String(i + 1).padStart(2, '0')}`
  );
  private readonly shelfLabelSList: string[] = Array.from({ length: 25 }, (_, i) =>
    `S${String(i + 1).padStart(2, '0')}`
  );
  private shelfLabelSlotsByAisle = new Map<string, string[]>();

  constructor(private firestore: AngularFirestore) {}

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
    
    // Query chỉ dùng where, không dùng orderBy để tránh cần composite index
    this.firestore.collection('pallets', ref =>
      ref.where('factory', '==', this.selectedFactory)
         .limit(500)
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
        this.isLoading = false;
        console.log(`✅ Loaded ${this.pallets.length} pallets for ${this.selectedFactory}`);
      }, error => {
        console.error('Error loading pallets:', error);
        this.isLoading = false;
      });
  }

  get visiblePallets(): PalletItem[] {
    const q = String(this.palletSearch || '').trim().toUpperCase();
    if (!q) return this.pallets;
    return this.pallets.filter((p) =>
      p.palletCode.toUpperCase().includes(q) || p.factory.toUpperCase().includes(q)
    );
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

  async printJLocLabels(): Promise<void> {
    const order = new Map<string, number>();
    for (const g of this.jLocGroups) {
      for (const s of g.slots) {
        if (!order.has(s)) order.set(s, order.size);
      }
    }
    const slots = Array.from(this.jLocSelected).sort(
      (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)
    );
    if (!slots.length) {
      this.jLocError = 'Chọn ít nhất một vị trí để in.';
      return;
    }
    if (slots.length > 200 && !confirm(`In ${slots.length} tem vị trí kho J?`)) return;
    this.jLocError = '';
    this.isPrintingJLocLabels = true;
    try {
      const qrImages = await Promise.all(
        slots.map((name) =>
          QRCode.toDataURL(name, {
            width: 360,
            margin: 1,
            color: { dark: '#000000', light: '#FFFFFF' }
          })
        )
      );

      const labelHtml = slots.map((name, i) => `
        <div class="j-loc-label">
          <div class="j-loc-label__qr">
            <img src="${qrImages[i]}" alt="QR ${name}">
          </div>
          <div class="j-loc-label__text">${name}</div>
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
  <title>Tem vị trí kho J</title>
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
</html>`);
      printWindow.document.close();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 400);
      this.showJLocLabelModal = false;
    } catch (err) {
      console.error('Error printing J location labels:', err);
      alert('Lỗi khi in tem vị trí. Vui lòng thử lại.');
    } finally {
      this.isPrintingJLocLabels = false;
    }
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
    this.showShelfLabelModal = true;
  }

  closeShelfLabelModal(): void {
    if (this.isPrintingShelfLabels) return;
    this.showShelfLabelModal = false;
    this.shelfLabelError = '';
  }

  setShelfLabelKind(kind: 'mam' | 'dauKe'): void {
    this.shelfLabelKind = kind;
    this.shelfLabelError = '';
  }

  setShelfLabelSize(size: '60x130' | '100x150'): void {
    this.shelfLabelSize = size;
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

  /** Số tem sẽ in (mâm = tổng vị trí; đầu kệ = số dãy). */
  get shelfLabelPrintCount(): number {
    if (this.shelfLabelKind === 'dauKe') return this.shelfLabelSelectedCount;
    return this.expandShelfLabelSelection().length;
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
    const names =
      this.shelfLabelKind === 'dauKe' ? aisles : this.expandShelfLabelSelection();
    if (!names.length) {
      this.shelfLabelError = 'Không có mâm kệ để in.';
      return;
    }
    if (
      this.shelfLabelKind === 'mam' &&
      names.length > 300 &&
      !confirm(`In ${names.length} tem mâm kệ?`)
    ) {
      return;
    }
    this.shelfLabelError = '';
    this.isPrintingShelfLabels = true;
    try {
      const html =
        this.shelfLabelKind === 'dauKe'
          ? await this.buildDauKeLabelHtml(aisles)
          : await this.buildShelfMamLabelHtml(names);
      const fileTag =
        this.shelfLabelKind === 'dauKe'
          ? `dau-ke-${aisles.length}`
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
}
