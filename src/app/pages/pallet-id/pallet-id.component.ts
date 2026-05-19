import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as QRCode from 'qrcode';

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

  // Pallet data
  pallets: PalletItem[] = [];
  isLoading: boolean = false;

  // Create new pallet
  isCreating: boolean = false;

  // Print
  selectedPallet: PalletItem | null = null;
  showPrintPreview: boolean = false;

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

  constructor(private firestore: AngularFirestore) {}

  ngOnInit(): void {
    this.loadPallets();
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
    ).snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe(actions => {
        this.pallets = actions.map(a => {
          const data = a.payload.doc.data() as any;
          const id = a.payload.doc.id;
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

  // Change factory
  onFactoryChange(): void {
    this.loadPallets();
  }

  // Get next pallet number
  async getNextPalletNumber(): Promise<string> {
    const prefix = this.selectedFactory === 'ASM1' ? 'F1' : 'F2';
    
    // Query chỉ dùng where, không dùng orderBy để tránh cần composite index
    const snapshot = await this.firestore.collection('pallets', ref =>
      ref.where('factory', '==', this.selectedFactory)
         .limit(500)
    ).get().toPromise();

    let maxNumber = 0;
    
    if (snapshot && !snapshot.empty) {
      // Tìm số lớn nhất từ tất cả pallets
      snapshot.docs.forEach(doc => {
        const data = doc.data() as any;
        const code = data.palletCode || '';
        const match = code.match(/-(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNumber) {
            maxNumber = num;
          }
        }
      });
    }

    // Format with leading zeros (4 digits)
    return `${prefix}-${(maxNumber + 1).toString().padStart(4, '0')}`;
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
      // Data will auto-refresh via snapshotChanges
    } catch (error) {
      console.error('Error creating pallet:', error);
      alert('Lỗi khi tạo pallet mới!');
    } finally {
      this.isCreating = false;
    }
  }

  // Open print preview (hiện tại không khóa in lần 2 trở đi)
  openPrintPreview(pallet: PalletItem): void {
    this.selectedPallet = pallet;
    this.showPrintPreview = true;
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

  /** F1 = ASM1, F2 = ASM2 — hiển thị trên tem thay cho ASM1/ASM2 */
  getPalletFactoryPrefix(factory?: string, palletCode?: string): string {
    const f = String(factory || '').trim().toUpperCase();
    if (f === 'ASM2') return 'F2';
    if (f === 'ASM1') return 'F1';
    const code = String(palletCode || '').trim().toUpperCase();
    if (code.startsWith('F2')) return 'F2';
    return 'F1';
  }

  /** Dòng số dưới QR (phần số sau dấu -, VD: F1-0123 → 0123) */
  getPalletNumberLine(palletCode?: string): string {
    const code = String(palletCode || '').trim();
    const m = code.match(/-(\d+)$/);
    if (m) return m[1];
    const digits = code.match(/(\d+)$/);
    return digits ? digits[1] : code;
  }

  // Print pallet label - 4 copies with QR code
  async printPalletLabel(): Promise<void> {
    if (!this.selectedPallet) return;

    const pallet = this.selectedPallet;
    
    // Generate QR code - kích thước lớn gấp đôi
    let qrCodeDataUrl = '';
    try {
      qrCodeDataUrl = await QRCode.toDataURL(pallet.palletCode, {
        width: 800,
        margin: 2,
        errorCorrectionLevel: 'M'
      });
    } catch (err) {
      console.error('Error generating QR code:', err);
    }
    
    // Label size: 100mm width x 130mm height
    const printWindow = window.open('', '_blank', 'width=450,height=600');
    if (!printWindow) {
      alert('Không thể mở cửa sổ in. Vui lòng cho phép popup.');
      return;
    }

    const factoryPrefix = this.getPalletFactoryPrefix(pallet.factory, pallet.palletCode);
    const numberLine = this.getPalletNumberLine(pallet.palletCode);

    // Generate 4 labels for 4 sides of pallet
    let labelsHtml = '';
    for (let i = 1; i <= 4; i++) {
      labelsHtml += `
        <div class="label-container">
          <div class="label-inner">
            <div class="factory-prefix">${factoryPrefix}</div>
            <div class="qr-code">
              <img src="${qrCodeDataUrl}" alt="QR Code" />
            </div>
          <div class="pallet-number">${numberLine}</div>
            <div class="label-footer">
              <div class="created-date">${this.formatDate(pallet.createdAt)}</div>
              <div class="label-number">${i}/4</div>
            </div>
          </div>
        </div>
      `;
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Pallet Label - ${pallet.palletCode}</title>
        <style>
          @page {
            size: 100mm 130mm;
            margin: 0 !important;
          }
          @media print {
            @page {
              size: 100mm 130mm;
              margin: 0 !important;
            }
            html, body {
              margin: 0 !important;
              padding: 0 !important;
              width: 100mm !important;
              height: 130mm !important;
            }
          .label-container {
            width: 100mm !important;
            height: 130mm !important;
            border: none !important;
          }
          .label-inner {
            width: 90mm !important;
            height: 120mm !important;
          }
          }
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          html, body {
            width: 100mm;
            height: 130mm;
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
            width: 100mm;
            height: 130mm;
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
            width: 90mm;
            height: 120mm;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: space-evenly;
            text-align: center;
            box-sizing: border-box;
          }
          .factory-prefix {
            font-size: 36pt;
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
            width: 72mm !important;
            height: 72mm !important;
            max-width: 72mm !important;
            max-height: 72mm !important;
            object-fit: contain;
          }
          .pallet-number {
            font-size: 56pt;
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
            font-size: 11pt;
            color: #000;
            font-weight: 600;
          }
          .label-number {
            font-size: 11pt;
            color: #000;
            font-weight: 600;
          }
        </style>
      </head>
      <body>
        ${labelsHtml}
      </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
    
    // Update print count in Firestore
    try {
      await this.firestore.collection('pallets').doc(pallet.id).update({
        printCount: (pallet.printCount || 0) + 1
      });
      console.log(`✅ Updated print count for ${pallet.palletCode}`);
    } catch (err) {
      console.error('Error updating print count:', err);
    }
    
    setTimeout(() => {
      printWindow.print();
    }, 500);
    
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
}
