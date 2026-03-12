import { Component, OnInit, OnDestroy } from '@angular/core';
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

@Component({
  selector: 'app-pallet-id',
  templateUrl: './pallet-id.component.html',
  styleUrls: ['./pallet-id.component.scss']
})
export class PalletIdComponent implements OnInit, OnDestroy {
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

  constructor(private firestore: AngularFirestore) {}

  ngOnInit(): void {
    this.loadPallets();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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

  // Delete pallet
  async deletePallet(pallet: PalletItem): Promise<void> {
    if (!confirm(`Bạn có chắc muốn xóa pallet ${pallet.palletCode}?`)) return;
    
    try {
      await this.firestore.collection('pallets').doc(pallet.id).delete();
      console.log(`✅ Deleted pallet: ${pallet.palletCode}`);
    } catch (error) {
      console.error('Error deleting pallet:', error);
      alert('Lỗi khi xóa pallet!');
    }
  }

  // Open print preview
  openPrintPreview(pallet: PalletItem): void {
    this.selectedPallet = pallet;
    this.showPrintPreview = true;
  }

  // Close print preview
  closePrintPreview(): void {
    this.selectedPallet = null;
    this.showPrintPreview = false;
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

    // Generate 4 labels for 4 sides of pallet
    let labelsHtml = '';
    for (let i = 1; i <= 4; i++) {
      labelsHtml += `
        <div class="label-container">
          <div class="factory-name">${pallet.factory}</div>
          <div class="qr-code">
            <img src="${qrCodeDataUrl}" alt="QR Code" />
          </div>
          <div class="pallet-code">${pallet.palletCode}</div>
          <div class="label-footer">
            <div class="created-date">${this.formatDate(pallet.createdAt)}</div>
            <div class="label-number">${i}/4</div>
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
            border: 2px solid #000;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: space-between;
            padding: 3mm 4mm;
            page-break-after: always;
            page-break-inside: avoid;
            box-sizing: border-box;
            overflow: hidden;
          }
          .label-container:last-child {
            page-break-after: avoid;
          }
          .factory-name {
            font-size: 28pt;
            font-weight: bold;
            color: #000;
            text-align: center;
            line-height: 1;
          }
          .qr-code {
            display: flex;
            align-items: center;
            justify-content: center;
            flex: 1;
          }
          .qr-code img {
            width: 70mm !important;
            height: 70mm !important;
            max-width: 70mm !important;
            max-height: 70mm !important;
            object-fit: contain;
          }
          .pallet-code {
            font-size: 32pt;
            font-weight: bold;
            color: #000;
            letter-spacing: 2px;
            text-align: center;
            line-height: 1;
            font-family: 'Courier New', monospace;
          }
          .label-footer {
            display: flex;
            justify-content: space-between;
            width: 100%;
            padding: 0 2mm;
            margin-top: 2mm;
          }
          .created-date {
            font-size: 14pt;
            color: #000;
            font-weight: 600;
          }
          .label-number {
            font-size: 14pt;
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
}
