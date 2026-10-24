import { Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import { firstValueFrom } from 'rxjs';
import * as QRCode from 'qrcode';
import { FirebaseAuthService } from '../../services/firebase-auth.service';
import {
  buildMaterialQrLabelDocument,
  parseMaterialQrLabelFields
} from '../../services/material-qr-label.util';

/** Mỗi lần scan hàng vào box = 1 doc. */
export interface ScrapItem {
  id?: string;
  boxNo: string;
  materialCode: string;
  po: string;
  /** DDMMYYYY như trên tem */
  imd: string;
  qty: number;
  qrData: string;
  scannedBy?: string;
  scannedAt?: firebase.firestore.Timestamp | null;
}

type ScrapPanel = '' | 'print' | 'scan';
type ScrapTab = 'detail' | 'box' | 'code';

@Component({
  selector: 'app-scrap',
  templateUrl: './scrap.component.html',
  styleUrls: ['./scrap.component.scss']
})
export class ScrapComponent implements OnInit, OnDestroy {
  static readonly ITEMS_COL = 'scrap-items';
  static readonly BOXES_COL = 'scrap-boxes';
  /** scrap-code-box/{mã} = box đang chứa mã — 1 mã chỉ được nằm ở 1 box. */
  static readonly CODE_BOX_COL = 'scrap-code-box';
  static readonly PO_CHUNG = 'PO_Chung';
  /** Bảng chi tiết cuộn liền — hiện dần theo lô để không nặng máy. */
  readonly pageSize = 300;
  readonly tabs: Array<{ key: ScrapTab; label: string; icon: string }> = [
    { key: 'detail', label: 'Chi tiết scan', icon: 'list_alt' },
    { key: 'box', label: 'Tổng hợp theo Box', icon: 'inventory_2' },
    { key: 'code', label: 'Tổng hợp theo Mã', icon: 'qr_code' }
  ];
  activeTab: ScrapTab = 'detail';
  boxFilter = '';
  private detailLimit = 300;

  @ViewChild('boxInput') boxInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('scanInput') scanInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('printCodeInput') printCodeInputRef?: ElementRef<HTMLInputElement>;

  panel: ScrapPanel = '';
  private employeeId = '';

  // 1. In tem QR
  printCode = '';
  printQty: number | null = null;
  printError = '';
  isPrinting = false;

  // 2. Scan nhập kho
  boxInputVal = '';
  currentBox = '';
  isSavingBox = false;
  scanInputVal = '';
  scanError = '';
  scanOk = '';
  isScanning = false;
  deletingId = '';

  // 4. Report
  reportItems: ScrapItem[] = [];
  reportLoading = false;
  reportError = '';
  reportSearch = '';
  reportPage = 1;
  private reportUnsub: (() => void) | null = null;

  constructor(
    private firestore: AngularFirestore,
    private authService: FirebaseAuthService,
    private location: Location,
    private router: Router
  ) {}

  goBack(): void {
    this.location.back();
  }

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  ngOnInit(): void {
    firstValueFrom(this.authService.currentUser)
      .then((user: any) => (this.employeeId = String(user?.employeeId || '').trim().toUpperCase()))
      .catch(() => undefined);
    this.startReport();
  }

  ngOnDestroy(): void {
    this.stopReport();
  }

  private get db(): firebase.firestore.Firestore {
    return this.firestore.firestore;
  }

  closePanel(): void {
    this.panel = '';
    this.currentBox = '';
    this.scanError = '';
    this.scanOk = '';
    this.printError = '';
  }

  // ── 1. In tem QR ──────────────────────────────────────────────

  openPrint(): void {
    if (this.panel === 'print') { this.closePanel(); return; }
    this.closePanel();
    this.panel = 'print';
    this.printCode = '';
    this.printQty = null;
    this.printError = '';
    setTimeout(() => this.printCodeInputRef?.nativeElement.focus(), 50);
  }

  /** Ngày in dạng DDMMYYYY (IMD trên tem). */
  todayImd(): string {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`;
  }

  get printPreviewQr(): string {
    const code = this.printCode.trim().toUpperCase();
    const qty = Number(this.printQty);
    if (!code || !Number.isFinite(qty) || qty <= 0) return '';
    return `${code}|${ScrapComponent.PO_CHUNG}|${qty}|${this.todayImd()}-1/1`;
  }

  async printLabel(): Promise<void> {
    if (this.isPrinting) return;
    const code = this.printCode.trim().toUpperCase();
    const qty = Number(this.printQty);
    if (!code) { this.printError = 'Nhập mã hàng.'; return; }
    if (code.includes('|')) { this.printError = 'Mã hàng không được chứa ký tự |'; return; }
    if (!Number.isFinite(qty) || qty <= 0) { this.printError = 'Nhập lượng lớn hơn 0.'; return; }
    this.printError = '';
    const win = window.open('', '_blank');
    if (!win) { this.printError = 'Không mở được cửa sổ in. Kiểm tra chặn popup.'; return; }
    this.isPrinting = true;
    try {
      const qrData = this.printPreviewQr;
      const qrImage = await QRCode.toDataURL(qrData, { width: 240, margin: 1, color: { dark: '#000000', light: '#FFFFFF' } });
      win.document.write(buildMaterialQrLabelDocument([{ kind: 'bag', qrImage, qrData }]));
      win.document.close();
      this.printCode = '';
      this.printQty = null;
      setTimeout(() => this.printCodeInputRef?.nativeElement.focus(), 50);
    } catch (e: any) {
      win.close();
      this.printError = 'Lỗi khi in: ' + (e?.message || e);
    } finally {
      this.isPrinting = false;
    }
  }

  // ── 2. Scan nhập kho ──────────────────────────────────────────

  openScan(): void {
    if (this.panel === 'scan') { this.closePanel(); return; }
    this.closePanel();
    this.panel = 'scan';
    this.changeBox();
  }

  changeBox(): void {
    this.currentBox = '';
    this.boxInputVal = '';
    this.scanError = '';
    this.scanOk = '';
    setTimeout(() => this.boxInputRef?.nativeElement.focus(), 50);
  }

  async saveBox(): Promise<void> {
    const box = this.boxInputVal.trim().toUpperCase();
    if (!box || this.isSavingBox) return;
    if (box.includes('/')) { this.scanError = 'Số box không được chứa ký tự /'; return; }
    this.isSavingBox = true;
    this.scanError = '';
    try {
      const ref = this.db.collection(ScrapComponent.BOXES_COL).doc(box);
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set({
          boxNo: box,
          createdBy: this.employeeId,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
      this.currentBox = box;
      setTimeout(() => this.scanInputRef?.nativeElement.focus(), 50);
    } catch (e: any) {
      this.scanError = 'Không lưu được số box: ' + (e?.message || e);
    } finally {
      this.isSavingBox = false;
    }
  }

  get boxItemCount(): number {
    return this.reportItems.filter((x) => x.boxNo === this.currentBox).length;
  }

  get boxTotalQty(): number {
    return this.reportItems
      .filter((x) => x.boxNo === this.currentBox)
      .reduce((s, x) => s + (Number(x.qty) || 0), 0);
  }

  async onScan(): Promise<void> {
    const raw = this.scanInputVal.trim();
    this.scanInputVal = '';
    if (!raw || !this.currentBox || this.isScanning) return;
    this.scanError = '';
    this.scanOk = '';
    const f = parseMaterialQrLabelFields(raw);
    const code = f.materialCode.trim().toUpperCase();
    const qty = Number(String(f.quantity).replace(/,/g, ''));
    if (!code || raw.split('|').length < 4 || !Number.isFinite(qty)) {
      this.scanError = `Tem không đúng định dạng QR (Mã|PO|Lượng|IMD): ${raw}`;
      this.focusScan();
      return;
    }
    const box = this.currentBox;
    this.isScanning = true;
    try {
      const mapRef = this.db.collection(ScrapComponent.CODE_BOX_COL).doc(code.replace(/\//g, '_'));
      const itemRef = this.db.collection(ScrapComponent.ITEMS_COL).doc();
      await this.db.runTransaction(async (tx) => {
        const m = await tx.get(mapRef);
        const other = m.exists ? String(m.data()?.['boxNo'] || '') : '';
        if (other && other !== box) {
          throw new Error(`DUP_BOX:${other}`);
        }
        if (!m.exists) {
          tx.set(mapRef, { materialCode: code, boxNo: box, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
        const item: ScrapItem = {
          boxNo: box,
          materialCode: code,
          po: f.po,
          imd: f.imd,
          qty,
          qrData: raw,
          scannedBy: this.employeeId,
          scannedAt: firebase.firestore.FieldValue.serverTimestamp() as any
        };
        tx.set(itemRef, item);
      });
      this.scanOk = `Đã nhập ${code} · ${qty} vào box ${box}`;
      this.reportPage = 1;
    } catch (e: any) {
      const msg = String(e?.message || e);
      this.scanError = msg.startsWith('DUP_BOX:')
        ? `❌ Mã ${code} đã nằm ở box ${msg.slice(8)} — một mã không được để 2 box.`
        : 'Lỗi khi lưu: ' + msg;
    } finally {
      this.isScanning = false;
      this.focusScan();
    }
  }

  private focusScan(): void {
    setTimeout(() => this.scanInputRef?.nativeElement.focus(), 30);
  }

  /** Xóa 1 dòng scan nhầm; nếu box không còn mã đó thì gỡ ràng buộc mã ↔ box. */
  async deleteItem(item: ScrapItem): Promise<void> {
    if (!item.id || this.deletingId) return;
    if (!confirm(`Xóa dòng ${item.materialCode} · PO ${item.po} · ${item.qty} khỏi box ${item.boxNo}?`)) return;
    this.deletingId = item.id;
    try {
      await this.db.collection(ScrapComponent.ITEMS_COL).doc(item.id).delete();
      const left = await this.db
        .collection(ScrapComponent.ITEMS_COL)
        .where('materialCode', '==', item.materialCode)
        .limit(1)
        .get();
      if (left.empty) {
        await this.db.collection(ScrapComponent.CODE_BOX_COL).doc(item.materialCode.replace(/\//g, '_')).delete();
      }
    } catch (e: any) {
      alert('Lỗi khi xóa: ' + (e?.message || e));
    } finally {
      this.deletingId = '';
      this.focusScan();
    }
  }

  // ── 4. Report ─────────────────────────────────────────────────

  private startReport(): void {
    this.stopReport();
    this.reportLoading = true;
    this.reportError = '';
    this.reportUnsub = this.db
      .collection(ScrapComponent.ITEMS_COL)
      .orderBy('scannedAt', 'desc')
      .onSnapshot(
        (snap) => {
          this.reportItems = snap.docs.map((d) => ({ id: d.id, ...(d.data() as ScrapItem) }));
          this.reportLoading = false;
          if (this.reportPage > this.reportPageCount) this.reportPage = this.reportPageCount;
        },
        (err) => {
          this.reportLoading = false;
          this.reportError = 'Không tải được report: ' + err.message;
        }
      );
  }

  private stopReport(): void {
    this.reportUnsub?.();
    this.reportUnsub = null;
  }

  get reportFiltered(): ScrapItem[] {
    const q = this.reportSearch.trim().toLowerCase();
    const rows = this.boxFilter ? this.reportItems.filter((x) => x.boxNo === this.boxFilter) : this.reportItems;
    if (!q) return rows;
    return rows.filter((x) =>
      [x.boxNo, x.materialCode, x.po, x.imd, this.formatImd(x.imd), String(x.qty), x.scannedBy || '']
        .some((v) => String(v || '').toLowerCase().includes(q))
    );
  }

  get reportPageCount(): number {
    return Math.max(1, Math.ceil(this.reportFiltered.length / this.pageSize));
  }

  get reportPageRows(): ScrapItem[] {
    const start = (this.reportPage - 1) * this.pageSize;
    return this.reportFiltered.slice(start, start + this.pageSize);
  }

  get reportBoxCount(): number {
    return new Set(this.reportFiltered.map((x) => x.boxNo)).size;
  }

  onReportSearch(): void {
    this.reportPage = 1;
    this.detailLimit = this.pageSize;
  }

  setTab(tab: ScrapTab): void {
    this.activeTab = tab;
  }

  clearFilters(): void {
    this.reportSearch = '';
    this.boxFilter = '';
    this.onReportSearch();
  }

  filterBox(box: string, tab?: ScrapTab): void {
    if (!box) return;
    this.boxFilter = box;
    this.onReportSearch();
    if (tab) this.activeTab = tab;
  }

  showMore(): void {
    this.detailLimit += this.pageSize;
  }

  get detailRows(): ScrapItem[] {
    return this.reportFiltered.slice(0, this.detailLimit);
  }

  get boxOptions(): string[] {
    return Array.from(new Set(this.reportItems.map((x) => x.boxNo).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  get reportCodeCount(): number {
    return new Set(this.reportFiltered.map((x) => x.materialCode)).size;
  }

  get reportTotalQty(): number {
    return Math.round(this.reportFiltered.reduce((s, x) => s + (Number(x.qty) || 0), 0) * 10000) / 10000;
  }

  get boxSummary(): Array<{ boxNo: string; codes: number; lines: number; qty: number; last: Date | null }> {
    const map = new Map<string, { boxNo: string; codes: Set<string>; lines: number; qty: number; last: Date | null }>();
    for (const x of this.reportFiltered) {
      const cur = map.get(x.boxNo) || { boxNo: x.boxNo, codes: new Set<string>(), lines: 0, qty: 0, last: null };
      cur.codes.add(x.materialCode);
      cur.lines += 1;
      cur.qty += Number(x.qty) || 0;
      const d = this.itemDate(x);
      if (d && (!cur.last || d > cur.last)) cur.last = d;
      map.set(x.boxNo, cur);
    }
    return Array.from(map.values())
      .map((b) => ({ boxNo: b.boxNo, codes: b.codes.size, lines: b.lines, qty: Math.round(b.qty * 10000) / 10000, last: b.last }))
      .sort((a, b) => a.boxNo.localeCompare(b.boxNo, undefined, { numeric: true }));
  }

  get codeSummary(): Array<{ materialCode: string; boxes: string[]; pos: string[]; lines: number; qty: number }> {
    const map = new Map<string, { materialCode: string; boxes: Set<string>; pos: Set<string>; lines: number; qty: number }>();
    for (const x of this.reportFiltered) {
      const cur = map.get(x.materialCode) || { materialCode: x.materialCode, boxes: new Set<string>(), pos: new Set<string>(), lines: 0, qty: 0 };
      cur.boxes.add(x.boxNo);
      if (x.po) cur.pos.add(x.po);
      cur.lines += 1;
      cur.qty += Number(x.qty) || 0;
      map.set(x.materialCode, cur);
    }
    return Array.from(map.values())
      .map((c) => ({ materialCode: c.materialCode, boxes: Array.from(c.boxes).sort(), pos: Array.from(c.pos).sort(), lines: c.lines, qty: Math.round(c.qty * 10000) / 10000 }))
      .sort((a, b) => a.materialCode.localeCompare(b.materialCode));
  }

  /** Xuất Excel đúng tab đang xem (theo bộ lọc hiện tại). */
  async exportExcel(): Promise<void> {
    const XLSX = await import('xlsx');
    let data: Array<Record<string, unknown>>;
    if (this.activeTab === 'box') {
      data = this.boxSummary.map((b, i) => ({
        'STT': i + 1, 'Box': b.boxNo, 'Số mã': b.codes, 'Số dòng': b.lines, 'Tổng lượng': b.qty,
        'Scan gần nhất': b.last ? b.last.toLocaleString('vi-VN') : ''
      }));
    } else if (this.activeTab === 'code') {
      data = this.codeSummary.map((c, i) => ({
        'STT': i + 1, 'Mã hàng': c.materialCode, 'Box': c.boxes.join(', '), 'PO': c.pos.join(', '), 'Số dòng': c.lines, 'Tổng lượng': c.qty
      }));
    } else {
      data = this.reportFiltered.map((x, i) => {
        const d = this.itemDate(x);
        return {
          'STT': i + 1, 'Box': x.boxNo, 'Mã hàng': x.materialCode, 'PO': x.po, 'IMD': this.formatImd(x.imd),
          'Lượng': Number(x.qty) || 0, 'Người scan': x.scannedBy || '', 'Thời gian': d ? d.toLocaleString('vi-VN') : ''
        };
      });
    }
    if (!data.length) return;
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Scrap');
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    XLSX.writeFile(wb, `Scrap_${this.activeTab}_${stamp}.xlsx`);
  }

  goReportPage(p: number): void {
    this.reportPage = Math.min(this.reportPageCount, Math.max(1, p));
  }

  // ── helpers ───────────────────────────────────────────────────

  itemDate(x: ScrapItem): Date | null {
    const t: any = x.scannedAt;
    return t && typeof t.toDate === 'function' ? t.toDate() : null;
  }

  /** DDMMYYYY → dd/MM/yyyy */
  formatImd(imd: string): string {
    const s = String(imd || '').trim();
    return /^\d{8}$/.test(s) ? `${s.slice(0, 2)}/${s.slice(2, 4)}/${s.slice(4)}` : s;
  }

  trackItem(_i: number, x: ScrapItem): string {
    return x.id || '';
  }
}
