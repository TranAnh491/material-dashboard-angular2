import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import { Subscription } from 'rxjs';
import * as QRCode from 'qrcode';

export interface ScrapSession {
  id?: string;
  boxCode: string;
  materials: string[];
  createdAt: Date | firebase.firestore.Timestamp;
  note?: string;
}

/** Một dòng hiển thị sau khi gộp theo mã thùng (nhiều doc Firestore cùng thùng → 1 dòng). */
export interface ScrapBoxGroup {
  boxCode: string;
  materials: string[];
  docIds: string[];
}

/** Một dòng trong bảng NVL chung (Danh sách NVL). */
export interface ScrapNvlFlatRow {
  code: string;
  bags: number;
  /** Mã thùng — cột Vị trí */
  boxCode: string;
}

type ScanStep = 'idle' | 'scan-box' | 'scan-materials';

@Component({
  selector: 'app-scrap',
  templateUrl: './scrap.component.html',
  styleUrls: ['./scrap.component.scss']
})
export class ScrapComponent implements OnInit, OnDestroy, AfterViewChecked {

  /** Chỉ tải N bản ghi mới nhất — tránh đọc cả collection (rất chậm). */
  private static readonly LIST_PAGE_SIZE = 400;

  @ViewChild('boxInput') boxInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('materialInput') materialInputRef!: ElementRef<HTMLInputElement>;

  sessions: ScrapSession[] = [];
  searchTerm = '';
  /** Đang tải danh sách từ Firestore (tab mở lần đầu). */
  listLoading = false;
  /** Đang lưu phiên quét (không dùng chung listLoading để bảng không “biến mất”). */
  isSaving = false;
  loadError: string | null = null;
  savedMsg = '';

  private listSub?: Subscription;

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

  /** Toàn màn hình: danh sách NVL (bảng chung) */
  showNvlListView = false;
  nvlListSearch = '';
  /** Khóa dòng đang xóa (box + mã) để khóa nút */
  nvlRowDeletingKey: string | null = null;

  constructor(private firestore: AngularFirestore) {}

  ngOnInit(): void {
    this.loadData();
  }

  ngOnDestroy(): void {
    this.listSub?.unsubscribe();
    this.listSub = undefined;
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
    this.listSub?.unsubscribe();
    this.loadError = null;
    this.listLoading = true;
    this.listSub = this.firestore
      .collection<ScrapSession>('scrap-data', ref =>
        ref.orderBy('createdAt', 'desc').limit(ScrapComponent.LIST_PAGE_SIZE)
      )
      .valueChanges({ idField: 'id' })
      .subscribe(
        data => {
          this.sessions = data;
          this.listLoading = false;
        },
        err => {
          this.listLoading = false;
          this.loadError =
            'Không tải được dữ liệu. Kiểm tra mạng / quyền Firestore hoặc index cho createdAt. ' +
            (err?.message || err);
        }
      );
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

  undoLastMaterial(): void {
    this.currentMaterials.pop();
  }

  async saveSession(): Promise<void> {
    if (!this.currentBoxCode) return;
    this.isSaving = true;
    const box = this.currentBoxCode.trim();
    const materials7 = this.currentMaterials.map(m => (m || '').slice(0, 7));
    try {
      const snap = await this.firestore
        .collection<ScrapSession>('scrap-data', ref => ref.where('boxCode', '==', box))
        .get()
        .toPromise();
      const docs = (snap?.docs || []).slice().sort(
        (a, b) => this.docCreatedMs(a.data()) - this.docCreatedMs(b.data())
      );
      if (docs.length === 0) {
        await this.firestore.collection('scrap-data').add({
          boxCode: box,
          materials: materials7,
          createdAt: firebase.firestore.FieldValue.serverTimestamp() as any
        });
      } else {
        const merged: string[] = [];
        for (const d of docs) {
          merged.push(...((d.data().materials || []) as string[]));
        }
        merged.push(...materials7);
        await docs[0].ref.update({
          materials: merged,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp() as any
        });
        for (let i = 1; i < docs.length; i++) {
          await docs[i].ref.delete();
        }
      }
      this.savedMsg = 'Đã lưu!';
      setTimeout(() => (this.savedMsg = ''), 2500);
      this.cancelScan();
    } catch (e) {
      alert('Lỗi khi lưu: ' + e);
    } finally {
      this.isSaving = false;
    }
  }

  private docCreatedMs(data: ScrapSession): number {
    const ca = data?.createdAt as any;
    if (!ca) return 0;
    if (typeof ca.toMillis === 'function') return ca.toMillis();
    if (ca instanceof Date) return ca.getTime();
    return 0;
  }

  /** Gộp các bản ghi cùng mã thùng (giữ thứ tự xuất hiện trong stream). */
  groupByBoxCode(sessions: ScrapSession[]): ScrapBoxGroup[] {
    const map = new Map<string, ScrapBoxGroup>();
    const order: string[] = [];
    for (const s of sessions) {
      const key = (s.boxCode || '').trim();
      if (!key) continue;
      let g = map.get(key);
      if (!g) {
        g = { boxCode: key, materials: [], docIds: [] };
        map.set(key, g);
        order.push(key);
      }
      g.materials.push(...(s.materials || []));
      if (s.id && !g.docIds.includes(s.id)) {
        g.docIds.push(s.id);
      }
    }
    return order.map(k => map.get(k)!);
  }

  get allGrouped(): ScrapBoxGroup[] {
    return this.groupByBoxCode(this.sessions);
  }

  get filteredGrouped(): ScrapBoxGroup[] {
    const q = this.searchTerm.trim().toLowerCase();
    if (!q) return this.allGrouped;
    return this.allGrouped.filter(
      g =>
        g.boxCode.toLowerCase().includes(q) ||
        g.materials.some(m => (m || '').toLowerCase().includes(q))
    );
  }

  get searchTrim(): string {
    return this.searchTerm.trim();
  }

  readonly listPageSize = ScrapComponent.LIST_PAGE_SIZE;

  get isListLikelyTruncated(): boolean {
    return this.sessions.length >= ScrapComponent.LIST_PAGE_SIZE;
  }

  openNvlListView(): void {
    this.showNvlListView = true;
    this.nvlListSearch = '';
  }

  closeNvlListView(): void {
    this.showNvlListView = false;
    this.nvlListSearch = '';
  }

  get nvlListFilteredGrouped(): ScrapBoxGroup[] {
    const q = this.nvlListSearch.trim().toLowerCase();
    const base = this.allGrouped;
    if (!q) {
      return base;
    }
    return base.filter(
      g =>
        g.boxCode.toLowerCase().includes(q) ||
        g.materials.some(m => (m || '').toLowerCase().includes(q))
    );
  }

  /** Bảng NVL chung: Mã | Bag | Vị trí (thùng), sắp xếp theo thùng rồi mã */
  get nvlListFlatRows(): ScrapNvlFlatRow[] {
    const rows: ScrapNvlFlatRow[] = [];
    for (const g of this.nvlListFilteredGrouped) {
      for (const x of this.getMaterialsWithBags(g.materials)) {
        rows.push({ code: x.code, bags: x.bags, boxCode: g.boxCode });
      }
    }
    // Sắp xếp mã theo thứ tự chữ cái (a, b, c…), cùng mã thì theo vị trí thùng
    rows.sort(
      (a, b) =>
        a.code.localeCompare(b.code, 'vi', { sensitivity: 'base', numeric: true }) ||
        a.boxCode.localeCompare(b.boxCode, 'vi', { numeric: true })
    );
    return rows;
  }

  nvlFlatRowKey(row: ScrapNvlFlatRow): string {
    return `${row.boxCode}\u0001${row.code}`;
  }

  /**
   * Xóa đúng số Bag của mã NVL trong thùng (duyệt doc theo thời gian tạo, bỏ khớp trước).
   */
  async deleteNvlFlatRow(row: ScrapNvlFlatRow): Promise<void> {
    if (this.nvlRowDeletingKey) {
      return;
    }
    if (!confirm(`Xóa ${row.bags} Bag mã ${row.code} khỏi thùng ${row.boxCode}?`)) {
      return;
    }
    const key = this.nvlFlatRowKey(row);
    this.nvlRowDeletingKey = key;
    try {
      const snap = await this.firestore
        .collection<ScrapSession>('scrap-data', ref => ref.where('boxCode', '==', row.boxCode.trim()))
        .get()
        .toPromise();
      const docs = (snap?.docs || []).slice().sort(
        (a, b) => this.docCreatedMs(a.data()) - this.docCreatedMs(b.data())
      );
      let toRemove = row.bags;
      for (const d of docs) {
        if (toRemove <= 0) {
          break;
        }
        const mats = (d.data().materials || []) as string[];
        const next: string[] = [];
        for (const m of mats) {
          const c = (m || '').slice(0, 7);
          if (toRemove > 0 && c === row.code) {
            toRemove--;
          } else {
            next.push(m);
          }
        }
        if (next.length === mats.length) {
          continue;
        }
        if (next.length === 0) {
          await d.ref.delete();
        } else {
          await d.ref.update({
            materials: next,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp() as any
          });
        }
      }
      if (toRemove > 0) {
        alert('Chưa xóa hết (dữ liệu có thể đã đổi). Hãy làm mới trang.');
      }
    } catch (e) {
      alert('Lỗi khi xóa: ' + e);
    } finally {
      this.nvlRowDeletingKey = null;
    }
  }

  async deleteAggregated(g: ScrapBoxGroup): Promise<void> {
    if (!g.docIds.length) return;
    if (!confirm(`Xóa toàn bộ dữ liệu thùng ${g.boxCode}?`)) return;
    for (const id of g.docIds) {
      await this.firestore.collection('scrap-data').doc(id).delete();
    }
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

  /**
   * Khi có ô tìm: nếu khớp mã NVL thì chỉ trả về các mã NVL khớp (và Bag tương ứng);
   * nếu chỉ khớp mã thùng thì trả về toàn bộ NVL của thùng đó.
   */
  getMaterialsWithBagsForSearch(g: ScrapBoxGroup): { code: string; bags: number }[] {
    const q = this.searchTerm.trim().toLowerCase();
    if (!q) return [];
    const all = this.getMaterialsWithBags(g.materials);
    const boxMatch = (g.boxCode || '').toLowerCase().includes(q);
    const matMatch = all.filter(x => {
      if ((x.code || '').toLowerCase().includes(q)) return true;
      return (g.materials || []).some(
        m => (m || '').slice(0, 7) === x.code && (m || '').toLowerCase().includes(q)
      );
    });
    if (matMatch.length > 0) return matMatch;
    if (boxMatch) return all;
    return [];
  }

  /** Số mã hiển thị (khi tìm kiếm: theo bộ lọc NVL; không tìm: toàn bộ). */
  getDisplayMaterialCodeCount(g: ScrapBoxGroup): number {
    if (this.searchTrim) return this.getMaterialsWithBagsForSearch(g).length;
    return this.getMaterialsWithBags(g.materials).length;
  }

  /** Tổng Bag hiển thị (khi tìm: chỉ bag của các mã NVL đang hiển thị). */
  getDisplayBagTotal(g: ScrapBoxGroup): number {
    if (this.searchTrim) {
      return this.getMaterialsWithBagsForSearch(g).reduce((s, x) => s + x.bags, 0);
    }
    return g.materials.length;
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
