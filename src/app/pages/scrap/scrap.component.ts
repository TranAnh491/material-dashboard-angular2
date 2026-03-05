import { Component, OnInit, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import * as QRCode from 'qrcode';

export interface ScrapSession {
  id?: string;
  boxCode: string;
  materials: string[];
  createdAt: Date | firebase.firestore.Timestamp;
  note?: string;
}

type ScanStep = 'idle' | 'scan-box' | 'scan-materials';

@Component({
  selector: 'app-scrap',
  templateUrl: './scrap.component.html',
  styleUrls: ['./scrap.component.scss']
})
export class ScrapComponent implements OnInit, AfterViewChecked {

  @ViewChild('boxInput') boxInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('materialInput') materialInputRef!: ElementRef<HTMLInputElement>;

  sessions: ScrapSession[] = [];
  searchTerm = '';
  isLoading = false;
  savedMsg = '';

  showPrintModal = false;
  printBoxCount = 1;
  isPrinting = false;
  nextPreviewCode = '';
  printPreviewLabels: string[] = [];
  private _nextStartSeq = 1;

  scanStep: ScanStep = 'idle';
  currentBoxCode = '';
  currentMaterials: string[] = [];
  materialInputVal = '';
  boxInputVal = '';

  private needFocusBox = false;
  private needFocusMaterial = false;

  constructor(private firestore: AngularFirestore) {}

  ngOnInit(): void {
    this.loadData();
  }

  ngAfterViewChecked(): void {
    if (this.needFocusBox && this.boxInputRef) {
      this.boxInputRef.nativeElement.focus();
      this.needFocusBox = false;
    }
    if (this.needFocusMaterial && this.materialInputRef) {
      this.materialInputRef.nativeElement.focus();
      this.needFocusMaterial = false;
    }
  }

  loadData(): void {
    this.isLoading = true;
    this.firestore.collection<ScrapSession>('scrap-data', ref => ref.orderBy('createdAt', 'desc'))
      .valueChanges({ idField: 'id' })
      .subscribe(data => {
        this.sessions = data;
        this.isLoading = false;
      }, () => { this.isLoading = false; });
  }

  startScan(): void {
    this.scanStep = 'scan-box';
    this.currentBoxCode = '';
    this.currentMaterials = [];
    this.materialInputVal = '';
    this.boxInputVal = '';
    this.needFocusBox = true;
  }

  cancelScan(): void {
    this.scanStep = 'idle';
    this.currentBoxCode = '';
    this.currentMaterials = [];
    this.materialInputVal = '';
    this.boxInputVal = '';
  }

  onBoxKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.confirmBoxCode();
    }
  }

  confirmBoxCode(): void {
    const code = this.boxInputVal.trim();
    if (!code) return;
    this.currentBoxCode = code;
    this.scanStep = 'scan-materials';
    this.materialInputVal = '';
    this.needFocusMaterial = true;
  }

  onMaterialKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.addMaterial();
    }
  }

  addMaterial(): void {
    const raw = this.materialInputVal.trim();
    if (!raw) return;
    const code = raw.slice(0, 7);
    this.currentMaterials.push(code);
    this.materialInputVal = '';
    this.needFocusMaterial = true;
  }

  removeMaterial(idx: number): void {
    this.currentMaterials.splice(idx, 1);
  }

  async saveSession(): Promise<void> {
    if (!this.currentBoxCode) return;
    this.isLoading = true;
    const materials7 = this.currentMaterials.map(m => (m || '').slice(0, 7));
    const session: Omit<ScrapSession, 'id'> = {
      boxCode: this.currentBoxCode,
      materials: materials7,
      createdAt: firebase.firestore.FieldValue.serverTimestamp() as any
    };
    try {
      await this.firestore.collection('scrap-data').add(session);
      this.savedMsg = 'Đã lưu!';
      setTimeout(() => this.savedMsg = '', 2500);
      this.cancelScan();
    } catch (e) {
      alert('Lỗi khi lưu: ' + e);
    } finally {
      this.isLoading = false;
    }
  }

  async deleteSession(s: ScrapSession): Promise<void> {
    if (!s.id) return;
    if (!confirm(`Xóa bản ghi thùng ${s.boxCode}?`)) return;
    await this.firestore.collection('scrap-data').doc(s.id).delete();
  }

  /** Nhóm materials theo mã 7 ký tự, đếm Bag */
  getMaterialsWithBags(materials: string[]): { code: string; bags: number }[] {
    const map = new Map<string, number>();
    for (const m of materials) {
      const c = (m || '').slice(0, 7);
      if (!c) continue;
      map.set(c, (map.get(c) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([code, bags]) => ({ code, bags }));
  }

  get filtered(): ScrapSession[] {
    const q = this.searchTerm.trim().toLowerCase();
    if (!q) return this.sessions;
    return this.sessions.filter(s =>
      s.boxCode.toLowerCase().includes(q) ||
      s.materials.some(m => m.toLowerCase().includes(q))
    );
  }

  formatDate(val: any): string {
    if (!val) return '';
    if (val instanceof Date) return val.toLocaleString('vi-VN');
    if (val && val.toDate) return val.toDate().toLocaleString('vi-VN');
    return String(val);
  }

  getDateKey(d?: Date): string {
    const d2 = d || new Date();
    const day = String(d2.getDate()).padStart(2, '0');
    const month = String(d2.getMonth() + 1).padStart(2, '0');
    const year = String(d2.getFullYear()).slice(-2);
    return `${day}${month}${year}`;
  }

  formatDateShort(): string {
    const d = new Date();
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  }

  async openPrintModal(): Promise<void> {
    this.printBoxCount = 1;
    await this.loadNextSequence();
    this.updatePrintPreview();
    this.showPrintModal = true;
  }

  closePrintModal(): void {
    this.showPrintModal = false;
  }

  async loadNextSequence(): Promise<void> {
    const dateKey = this.getDateKey();
    const doc = await this.firestore.collection('scrap-box-print-seq').doc(dateKey).get().toPromise();
    const data = doc?.data() as { lastSequence?: number } | undefined;
    this._nextStartSeq = (data?.lastSequence ?? 0) + 1;
    this.nextPreviewCode = dateKey + String(this._nextStartSeq).padStart(2, '0');
  }

  updatePrintPreview(): void {
    const n = Math.min(99, Math.max(1, Math.floor(this.printBoxCount) || 1));
    this.printBoxCount = n;
    this.printPreviewLabels = Array.from({ length: n }, (_, i) =>
      this.getDateKey() + String(this._nextStartSeq + i).padStart(2, '0')
    );
  }

  async doPrintLabels(): Promise<void> {
    const n = Math.min(99, Math.max(1, Math.floor(this.printBoxCount) || 1));
    if (n < 1) return;
    this.isPrinting = true;
    try {
      const dateKey = this.getDateKey();
      const labels: string[] = Array.from({ length: n }, (_, i) =>
        dateKey + String(this._nextStartSeq + i).padStart(2, '0')
      );
      await this.printLabelWindow(labels);
      const newLastSeq = this._nextStartSeq + n - 1;
      await this.firestore.collection('scrap-box-print-seq').doc(dateKey).set(
        { lastSequence: newLastSeq, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      this._nextStartSeq = newLastSeq + 1;
      this.closePrintModal();
    } catch (e) {
      alert('Lỗi khi in: ' + e);
    } finally {
      this.isPrinting = false;
    }
  }

  private async printLabelWindow(labels: string[]): Promise<void> {
    const qrImages: string[] = [];
    for (const code of labels) {
      try {
        const dataUrl = await QRCode.toDataURL(code, { width: 140, margin: 1 });
        qrImages.push(dataUrl);
      } catch {
        qrImages.push('');
      }
    }
    const html = this.buildPrintHtml(labels, qrImages);
    const win = window.open('', '_blank');
    if (!win) {
      alert('Không mở được cửa sổ in. Kiểm tra chặn popup.');
      throw new Error('Popup blocked');
    }
    win.document.write(html);
    win.document.close();
  }

  private buildPrintHtml(labels: string[], qrImages: string[]): string {
    const dateStr = new Date().toLocaleDateString('vi-VN');
    const items = labels.map((code, i) => {
      const qrSrc = qrImages[i] || '';
      return `
      <div class="label-box">
        <div class="label-qr"><img src="${qrSrc}" alt="QR" /></div>
        <div class="label-text">
          <div class="label-code">${this.escapeHtml(code)}</div>
          <div class="label-date">${dateStr}</div>
        </div>
      </div>`;
    }).join('');
    return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title></title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: Arial, sans-serif; margin: 0; padding: 0; background: #fff; }
.label-box {
  width: 57mm;
  height: 32mm;
  border: 1px solid #000;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  page-break-inside: avoid;
  page-break-after: always;
}
.label-box:last-child { page-break-after: auto; }
.label-qr {
  width: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2mm;
  border-right: 1px solid #000;
}
.label-qr img { width: 100%; max-width: 26mm; height: auto; }
.label-text {
  width: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2mm;
}
.label-code { font-size: 16px; font-weight: 700; letter-spacing: 1px; text-align: center; }
.label-date { font-size: 9px; margin-top: 2mm; color: #333; text-align: center; }
.label-grid { display: flex; flex-wrap: wrap; gap: 0; }
@media print {
  body { margin: 0; padding: 0; }
  @page { margin: 0; size: 57mm 32mm; }
  .label-box { width: 57mm; height: 32mm; }
  body::before, body::after, header, footer { display: none !important; }
}
</style>
</head>
<body>
<div class="label-grid">${items}</div>
<script>
window.onload = function() {
  document.title = '';
  const s = document.createElement('style');
  s.textContent = '@media print { body { margin:0 !important; padding:0 !important; } @page { margin:0 !important; size: 57mm 32mm !important; } body::before, body::after, header, footer { display:none !important; } }';
  document.head.appendChild(s);
  setTimeout(function() { window.print(); }, 300);
};
</script>
</body>
</html>`;
  }

  private escapeHtml(s: string): string {
    const d: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return s.replace(/[&<>"']/g, (c) => d[c] ?? c);
  }
}
