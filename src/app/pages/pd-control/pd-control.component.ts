import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Router } from '@angular/router';
import firebase from 'firebase/compat/app';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

type PdBatchStep = 'employee' | 'lsx' | 'material';

type PdReturnScanDoc = {
  id: string;
  employeeId: string;
  productionOrder: string;
  rawBarcode: string;
  createdAt: Date;
};

type PdRecentRow = {
  time: string;
  productionOrder: string;
  rawBarcode: string;
  employeeId: string;
};

type PdSearchRow = {
  /** Firestore doc ids trong nhóm (cùng LSX + cùng ID nhân viên) */
  docIds: string[];
  productionOrder: string;
  rawBarcodeShort: string;
  mergedCount: number;
  employeeId: string;
  timeText: string;
};

type PdTreeMaterialUi = {
  code: string;
  quantity: number;
  valid: boolean;
};

type PdTreeLsxUi = {
  lsx: string;
  /** Số mã NVL (B+6) trong outbound cho LSX — null nếu không có dữ liệu */
  planTotal: number | null;
  totalScanLines: number;
  materials: PdTreeMaterialUi[];
};

@Component({
  selector: 'app-pd-control',
  templateUrl: './pd-control.component.html',
  styleUrls: ['./pd-control.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PdControlComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  @ViewChild('pdScanInput') pdScanInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('deleteVerifyInput') deleteVerifyInputRef?: ElementRef<HTMLInputElement>;

  readonly PD_FACTORY = 'ASM1';
  readonly PD_COLLECTION = 'pd-return-scans';

  /** Chỉ mã nhân viên này (sau khi quét xác nhận) mới được xóa bản ghi scan trả */
  readonly DELETE_AUTH_EMPLOYEE_ID = 'ASP0054';

  lastUpdatedText = '—';
  isRefreshing = false;

  /** Bấm vùng scan để bật/tắt nhận máy quét */
  isPdScanActive = false;
  scanStatusText = '';
  batchSaving = false;

  /** Camera scanner (mobile): dùng camera đọc QR/Barcode */
  isCameraOn = false;
  cameraStarting = false;
  cameraError = '';
  private cameraScanner: { start: (...args: any[]) => Promise<unknown>; stop: () => Promise<unknown>; clear: () => void } | null = null;

  /** Phiên scan: ID → LSX → nguyên liệu (chờ Done mới ghi Firestore) */
  batchStep: PdBatchStep = 'employee';
  batchEmployeeId = '';
  batchProductionOrder = '';
  pendingMaterials: string[] = [];

  /** KPI chỉ tính scan trả đã lưu trong tab PD */
  kpiTotalScanned = 0;
  kpiValid = 0;
  kpiInvalid = 0;
  kpiWorkOrders = 0;

  searchQuery = '';
  appliedSearchQuery = '';

  recentRows: PdRecentRow[] = [];
  searchRows: PdSearchRow[] = [];

  /** Sơ đồ cây LSX → mã B (theo kết quả tìm) */
  treeLoading = false;
  treeRoots: PdTreeLsxUi[] = [];
  treeZoomPct = 100;
  private treeRefreshSeq = 0;

  /** Xóa: chờ quét ASP0054 để xác nhận (một hoặc nhiều doc đã gộp) */
  deleteVerifyDocIds: string[] | null = null;
  deleteBusy = false;

  get deleteVerifyModalOpen(): boolean {
    return this.deleteVerifyDocIds !== null;
  }

  private todayScans: PdReturnScanDoc[] = [];

  constructor(
    private firestore: AngularFirestore,
    private cdr: ChangeDetectorRef,
    private router: Router
  ) {}

  goToMenu(): void {
    void this.router.navigateByUrl('/menu');
  }

  get batchStepHint(): string {
    switch (this.batchStep) {
      case 'employee':
        return 'Bước 1/3: Quét ID — lấy 7 ký tự đầu (ASP + 4 số)';
      case 'lsx':
        return 'Bước 2/3: Quét lệnh sản xuất (LSX)';
      case 'material':
        return `Bước 3/3: Quét mã nguyên liệu trả (đang chờ: ${this.pendingMaterials.length}) — bấm Done để lưu`;
      default:
        return '';
    }
  }

  ngOnInit(): void {
    this.lastUpdatedText = new Date().toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    this.subscribePdReturnScans();
  }

  ngOnDestroy(): void {
    void this.stopCameraScanner();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private isSameLocalDay(d: Date): boolean {
    const t = new Date();
    return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
  }

  private isValidLsxCode(lsx: string): boolean {
    const s = (lsx ?? '').trim().toUpperCase();
    return s.startsWith('KZLSX') || s.startsWith('LHLSX');
  }

  /** Giống outbound ASM1: 7 ký tự đầu phải ASP + 4 chữ số */
  private parseEmployeeIdFromScan(raw: string): string | null {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) return null;
    const extracted = trimmed.substring(0, 7).toUpperCase();
    if (extracted.length !== 7 || !extracted.startsWith('ASP')) return null;
    const numberPart = extracted.substring(3, 7);
    if (!/^\d{4}$/.test(numberPart)) return null;
    return extracted;
  }

  private subscribePdReturnScans(): void {
    this.firestore
      .collection(this.PD_COLLECTION, ref => ref.where('factory', '==', this.PD_FACTORY).limit(4000))
      .snapshotChanges()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (snap: any[]) => {
          const rows: PdReturnScanDoc[] = snap
            .map(doc => {
              const d = doc.payload.doc.data() as any;
              const createdAt = d?.createdAt?.toDate ? d.createdAt.toDate() : new Date();
              return {
                id: doc.payload.doc.id,
                employeeId: String(d?.employeeId ?? '').trim(),
                productionOrder: String(d?.productionOrder ?? '').trim(),
                rawBarcode: String(d?.rawBarcode ?? '').trim(),
                createdAt
              };
            })
            .filter(r => this.isSameLocalDay(r.createdAt))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

          this.todayScans = rows;
          this.recomputeFromTodayScans();
          this.lastUpdatedText = new Date().toLocaleTimeString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          });
          this.cdr.markForCheck();
        },
        error: e => console.error('[PD Control] pd-return-scans:', e)
      });
  }

  private recomputeFromTodayScans(): void {
    const total = this.todayScans.length;
    const ok = this.todayScans.filter(
      r => !!r.productionOrder && !!r.rawBarcode && !!r.employeeId
    ).length;
    const wo = new Set(this.todayScans.map(r => r.productionOrder).filter(Boolean)).size;

    this.kpiTotalScanned = total;
    this.kpiValid = ok;
    this.kpiInvalid = Math.max(0, total - ok);

    this.kpiWorkOrders = wo;

    this.recentRows = this.todayScans.slice(0, 15).map(s => ({
      time: s.createdAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      productionOrder: s.productionOrder || '—',
      rawBarcode: this.shortBarcode(s.rawBarcode),
      employeeId: s.employeeId || '—'
    }));

    this.recomputeSearchRows();
    if (this.appliedSearchQuery.trim()) {
      void this.refreshTreeView();
    }
  }

  private shortBarcode(s: string, max = 48): string {
    const t = (s || '').trim();
    if (t.length <= max) return t;
    return t.slice(0, max - 1) + '…';
  }

  private mergeRawBarcodeDisplay(docs: PdReturnScanDoc[]): string {
    const uniq = [...new Set(docs.map(d => (d.rawBarcode || '').trim()).filter(Boolean))];
    if (uniq.length === 0) return '—';
    if (uniq.length === 1) return this.shortBarcode(uniq[0]);
    return `${this.shortBarcode(uniq[0])} (+${uniq.length - 1} mã khác)`;
  }

  applySearch(): void {
    this.appliedSearchQuery = this.searchQuery.trim();
    this.recomputeSearchRows();
    void this.refreshTreeView();
    this.cdr.markForCheck();
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.appliedSearchQuery = '';
    this.searchRows = [];
    this.treeRoots = [];
    this.treeLoading = false;
    this.treeZoomPct = 100;
    this.cdr.markForCheck();
  }

  zoomTree(delta: number): void {
    this.treeZoomPct = Math.round(Math.max(50, Math.min(180, this.treeZoomPct + delta)));
    this.cdr.markForCheck();
  }

  resetTreeZoom(): void {
    this.treeZoomPct = 100;
    this.cdr.markForCheck();
  }

  private getMatchedScansForAppliedQuery(): PdReturnScanDoc[] {
    const qTrim = this.appliedSearchQuery.trim();
    if (!qTrim) return [];
    const qUpper = qTrim.toUpperCase();
    const materialTok = this.extractPdMaterialCodeToken(qTrim);
    return materialTok
      ? this.todayScans.filter(s => (s.rawBarcode || '').toUpperCase().includes(materialTok))
      : this.todayScans.filter(s => {
          const po = (s.productionOrder || '').trim().toUpperCase();
          return po === qUpper || po.includes(qUpper);
        });
  }

  /** Trích các mã B+6 trong chuỗi quét (vd B019019|KZP...) */
  private extractBCodesFromRawBarcode(raw: string): string[] {
    const u = (raw || '').trim().toUpperCase();
    const out = new Set<string>();
    const seg0 = u.split('|')[0]?.trim();
    if (seg0 && /^B\d{6}$/.test(seg0)) out.add(seg0);
    for (const m of u.matchAll(/B\d{6}/g)) {
      out.add(m[0]);
    }
    return [...out];
  }

  private async fetchOutboundPlanCodesForLsx(lsx: string): Promise<Set<string>> {
    try {
      const snap = await this.firestore
        .collection('outbound-materials', ref =>
          ref.where('factory', '==', this.PD_FACTORY).where('productionOrder', '==', lsx).limit(500)
        )
        .get()
        .toPromise();
      const set = new Set<string>();
      const docs = (snap as any)?.docs ?? [];
      for (const doc of docs) {
        const data = doc.data() as any;
        const mc = String(data?.materialCode ?? '')
          .trim()
          .toUpperCase();
        const hit = mc.match(/B\d{6}/);
        if (hit) set.add(hit[0]);
      }
      return set;
    } catch (e) {
      console.warn('[PD Control] outbound plan:', e);
      return new Set();
    }
  }

  private async refreshTreeView(): Promise<void> {
    const seq = ++this.treeRefreshSeq;
    const matched = this.getMatchedScansForAppliedQuery();

    if (!this.appliedSearchQuery.trim()) {
      this.treeRoots = [];
      this.treeLoading = false;
      this.cdr.markForCheck();
      return;
    }

    if (!matched.length) {
      this.treeRoots = [];
      this.treeLoading = false;
      this.cdr.markForCheck();
      return;
    }

    this.treeLoading = true;
    this.cdr.markForCheck();

    try {
      const byLsx = new Map<string, PdReturnScanDoc[]>();
      for (const s of matched) {
        const k = (s.productionOrder || '').trim();
        if (!k) continue;
        if (!byLsx.has(k)) byLsx.set(k, []);
        byLsx.get(k)!.push(s);
      }

      const roots: PdTreeLsxUi[] = [];
      const entries = [...byLsx.entries()].sort((a, b) => a[0].localeCompare(b[0]));

      for (const [lsx, docs] of entries) {
        if (seq !== this.treeRefreshSeq) return;

        const planSet = await this.fetchOutboundPlanCodesForLsx(lsx);
        const planTotal = planSet.size > 0 ? planSet.size : null;

        const codeCounts = new Map<string, number>();
        for (const d of docs) {
          const codes = this.extractBCodesFromRawBarcode(d.rawBarcode);
          const list = codes.length ? codes : [];
          if (!list.length) continue;
          for (const c of list) {
            codeCounts.set(c, (codeCounts.get(c) || 0) + 1);
          }
        }

        const materials: PdTreeMaterialUi[] = [...codeCounts.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([code, quantity]) => ({
            code,
            quantity,
            valid: planTotal == null ? true : planSet.has(code)
          }));

        roots.push({
          lsx,
          planTotal,
          totalScanLines: docs.length,
          materials
        });
      }

      if (seq !== this.treeRefreshSeq) return;
      this.treeRoots = roots;
    } catch (e) {
      console.error('[PD Control] refreshTreeView:', e);
      if (seq === this.treeRefreshSeq) this.treeRoots = [];
    } finally {
      if (seq === this.treeRefreshSeq) {
        this.treeLoading = false;
        this.cdr.markForCheck();
      }
    }
  }

  /**
   * Mã hàng dạng B + đúng 6 chữ số (vd B019019).
   * Nhận cả chuỗi chỉ có mã, hoặc mã nằm trong text (lấy khớp đầu tiên).
   */
  private extractPdMaterialCodeToken(q: string): string | null {
    const t = (q ?? '').trim().toUpperCase();
    if (!t) return null;
    if (/^B\d{6}$/.test(t)) return t;
    const m = t.match(/B\d{6}/);
    return m ? m[0] : null;
  }

  private recomputeSearchRows(): void {
    if (!this.appliedSearchQuery.trim()) {
      this.searchRows = [];
      return;
    }

    const matched = this.getMatchedScansForAppliedQuery();

    /** Gộp theo LSX + ID nhân viên scan */
    const mergeMap = new Map<string, PdReturnScanDoc[]>();
    for (const s of matched) {
      const po = (s.productionOrder || '').trim();
      const empKey = ((s.employeeId || '').trim().toUpperCase()) || '__NONE__';
      const key = `${po}\x1f${empKey}`;
      if (!mergeMap.has(key)) mergeMap.set(key, []);
      mergeMap.get(key)!.push(s);
    }

    const flat: (PdSearchRow & { sortMs: number })[] = [];
    for (const [, list] of mergeMap) {
      const asc = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const latest = asc.reduce((a, b) => (a.createdAt >= b.createdAt ? a : b));
      const po = (asc[0].productionOrder || '').trim();
      const empDisp = (asc[0].employeeId || '').trim();

      flat.push({
        docIds: asc.map(d => d.id),
        productionOrder: po,
        rawBarcodeShort: this.mergeRawBarcodeDisplay(asc),
        mergedCount: asc.length,
        employeeId: empDisp || '—',
        timeText: latest.createdAt.toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }),
        sortMs: latest.createdAt.getTime()
      });
    }

    flat.sort((a, b) => b.sortMs - a.sortMs);
    this.searchRows = flat.map(({ sortMs: _s, ...rest }) => rest);
  }

  beginDeleteScanRows(docIds: string[]): void {
    const uniq = [...new Set((docIds || []).filter(Boolean))];
    if (!uniq.length || this.deleteBusy) return;
    this.deleteVerifyDocIds = uniq;
    this.cdr.markForCheck();
    setTimeout(() => {
      const el = this.deleteVerifyInputRef?.nativeElement;
      el?.focus();
      el?.select?.();
    }, 0);
  }

  cancelDeleteVerify(): void {
    if (this.deleteBusy) return;
    this.deleteVerifyDocIds = null;
    this.cdr.markForCheck();
  }

  cancelDeleteVerifyBackdrop(ev: MouseEvent): void {
    if (ev.target !== ev.currentTarget || this.deleteBusy) return;
    this.cancelDeleteVerify();
  }

  onDeleteVerifyEnter(input: HTMLInputElement): void {
    const raw = (input?.value ?? '').trim();
    input.value = '';
    void this.tryDeleteAfterEmployeeScan(raw);
  }

  private async tryDeleteAfterEmployeeScan(raw: string): Promise<void> {
    const ids = this.deleteVerifyDocIds;
    if (!ids?.length || this.deleteBusy) return;

    const emp = this.parseEmployeeIdFromScan(raw);
    if (!emp) {
      alert('Không đọc được mã nhân viên (7 ký tự đầu = ASP + 4 số). Quét lại.');
      return;
    }
    if (emp !== this.DELETE_AUTH_EMPLOYEE_ID) {
      alert(`Chỉ mã nhân viên ${this.DELETE_AUTH_EMPLOYEE_ID} mới được xóa.`);
      return;
    }

    this.deleteBusy = true;
    this.cdr.markForCheck();
    try {
      const colRef = this.firestore.collection(this.PD_COLLECTION).ref;
      let batch = this.firestore.firestore.batch();
      let ops = 0;
      for (const id of ids) {
        batch.delete(colRef.doc(id));
        ops++;
        if (ops >= 400) {
          await batch.commit();
          batch = this.firestore.firestore.batch();
          ops = 0;
        }
      }
      if (ops > 0) await batch.commit();
      this.deleteVerifyDocIds = null;
    } catch (e) {
      console.error('[PD Control] delete scan:', e);
      alert('Không xóa được bản ghi. Kiểm tra quyền Firestore.');
    } finally {
      this.deleteBusy = false;
      this.cdr.markForCheck();
    }
  }

  private resetBatchSession(): void {
    this.batchStep = 'employee';
    this.batchEmployeeId = '';
    this.batchProductionOrder = '';
    this.pendingMaterials = [];
  }

  private hasUnsavedBatch(): boolean {
    return (
      this.pendingMaterials.length > 0 ||
      !!this.batchEmployeeId ||
      !!this.batchProductionOrder ||
      this.batchStep !== 'employee'
    );
  }

  togglePdScan(): void {
    if (this.isPdScanActive && this.hasUnsavedBatch()) {
      if (!confirm('Đang có phiên scan chưa hoàn tất. Tắt SCAN sẽ huỷ phiên (chưa lưu). Tiếp tục?')) {
        return;
      }
    }

    this.isPdScanActive = !this.isPdScanActive;
    if (this.isPdScanActive) {
      this.resetBatchSession();
      this.scanStatusText =
        'Quét ID nhân viên (7 ký tự đầu = ASP + 4 số), sau đó LSX, rồi quét nguyên liệu — bấm Done để lưu.';
    } else {
      if (this.isCameraOn) {
        void this.toggleCamera(false);
      }
      this.resetBatchSession();
      this.scanStatusText = '';
    }
    if (this.isPdScanActive) {
      setTimeout(() => {
        const el = this.pdScanInputRef?.nativeElement;
        el?.focus();
        el?.select?.();
      }, 0);
    }
    this.cdr.markForCheck();
  }

  async toggleCamera(next?: boolean): Promise<void> {
    const desired = typeof next === 'boolean' ? next : !this.isCameraOn;
    if (desired === this.isCameraOn) return;

    if (!this.isPdScanActive && desired) {
      this.togglePdScan();
    }

    this.cameraError = '';
    this.isCameraOn = desired;
    this.cdr.markForCheck();

    if (desired) {
      await this.startCameraScanner();
    } else {
      await this.stopCameraScanner();
      setTimeout(() => this.pdScanInputRef?.nativeElement?.focus(), 0);
    }
  }

  private async startCameraScanner(): Promise<void> {
    if (this.cameraStarting) return;
    this.cameraStarting = true;
    this.cameraError = '';
    this.cdr.markForCheck();

    try {
      // đảm bảo modal đã render xong trước khi start
      await new Promise<void>(r => setTimeout(r, 0));

      const mod = await import('html5-qrcode');
      const Html5Qrcode = (mod as any).Html5Qrcode;
      const Html5QrcodeSupportedFormats = (mod as any).Html5QrcodeSupportedFormats;
      if (!Html5Qrcode) {
        throw new Error('html5-qrcode not available');
      }

      const readerId = 'pd-qr-reader';
      this.cameraScanner = new Html5Qrcode(readerId);
      const cameras = await Html5Qrcode.getCameras();
      if (!cameras || cameras.length === 0) {
        throw new Error('No cameras found');
      }

      const formatsToSupport =
        Html5QrcodeSupportedFormats != null
          ? [
              Html5QrcodeSupportedFormats.QR_CODE,
              Html5QrcodeSupportedFormats.CODE_128,
              Html5QrcodeSupportedFormats.CODE_39,
              Html5QrcodeSupportedFormats.EAN_13,
              Html5QrcodeSupportedFormats.EAN_8,
              Html5QrcodeSupportedFormats.UPC_A,
              Html5QrcodeSupportedFormats.UPC_E,
              Html5QrcodeSupportedFormats.ITF
            ]
          : undefined;

      await this.cameraScanner.start(
        { facingMode: 'environment' },
        {
          fps: 12,
          qrbox: { width: 260, height: 260 },
          aspectRatio: 1.0,
          disableFlip: true,
          formatsToSupport
        },
        (decodedText: string) => {
          const v = (decodedText || '').trim();
          if (!v) return;
          // Stop camera after first successful scan (giống thao tác scan bằng máy)
          void this.toggleCamera(false);
          this.processPdScanLine(v);
        },
        () => {}
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[PD Control] start camera scanner:', e);
      this.cameraError = 'Không thể khởi động camera. Vui lòng kiểm tra quyền camera và thử lại.';
      this.isCameraOn = false;
      alert(this.cameraError + (msg ? ` (${msg})` : ''));
    } finally {
      this.cameraStarting = false;
      this.cdr.markForCheck();
    }
  }

  private async stopCameraScanner(): Promise<void> {
    if (!this.cameraScanner) return;
    try {
      await this.cameraScanner.stop();
    } catch {
      // ignore
    }
    try {
      this.cameraScanner.clear();
    } catch {
      // ignore
    }
    this.cameraScanner = null;
  }

  cancelPdBatch(): void {
    if (!this.isPdScanActive) return;
    if (this.hasUnsavedBatch()) {
      if (!confirm('Huỷ phiên hiện tại? Dữ liệu chưa lưu sẽ mất.')) return;
    }
    this.resetBatchSession();
    this.scanStatusText = 'Đã huỷ phiên. Quét ID nhân viên để bắt đầu lại.';
    this.cdr.markForCheck();
    setTimeout(() => this.pdScanInputRef?.nativeElement?.focus(), 0);
  }

  async commitPdBatch(): Promise<void> {
    if (!this.isPdScanActive || this.batchSaving) return;
    if (!this.batchEmployeeId || !this.batchProductionOrder) {
      alert('Chưa đủ ID nhân viên hoặc LSX. Hoàn tất bước 1 và 2 trước.');
      return;
    }
    if (this.pendingMaterials.length === 0) {
      alert('Chưa có mã nguyên liệu nào trong phiên. Quét mã rồi bấm Done.');
      return;
    }

    const colRef = this.firestore.collection(this.PD_COLLECTION).ref;
    const toSave = [...this.pendingMaterials];
    const empSnap = this.batchEmployeeId;
    const lsxSnap = this.batchProductionOrder;

    this.batchSaving = true;
    this.cdr.markForCheck();

    try {
      let batch = this.firestore.firestore.batch();
      let ops = 0;
      for (const raw of toSave) {
        const ref = colRef.doc();
        batch.set(ref, {
          factory: this.PD_FACTORY,
          employeeId: empSnap,
          productionOrder: lsxSnap,
          rawBarcode: raw,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        ops++;
        if (ops >= 400) {
          await batch.commit();
          batch = this.firestore.firestore.batch();
          ops = 0;
        }
      }
      if (ops > 0) await batch.commit();

      this.resetBatchSession();
      this.scanStatusText = `Đã lưu ${toSave.length} mã trả (${lsxSnap}, ${empSnap}). Quét ID nhân viên để bắt đầu phiên mới.`;
    } catch (e) {
      console.error('[PD Control] batch commit:', e);
      alert('Không lưu được dữ liệu. Kiểm tra kết nối hoặc quyền Firestore.');
    } finally {
      this.batchSaving = false;
      this.cdr.markForCheck();
      setTimeout(() => this.pdScanInputRef?.nativeElement?.focus(), 0);
    }
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscapeDeleteVerify(ev: KeyboardEvent): void {
    if (!this.deleteVerifyModalOpen || this.deleteBusy) return;
    ev.preventDefault();
    this.cancelDeleteVerify();
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(ev: KeyboardEvent): void {
    if (this.deleteVerifyModalOpen) {
      const target = ev.target as HTMLElement | null;
      if (target?.classList.contains('pd-delete-scan-input')) return;

      const tag = target?.tagName?.toUpperCase();
      if (tag === 'TEXTAREA') return;

      const vEl = this.deleteVerifyInputRef?.nativeElement;
      if (vEl && document.activeElement !== vEl) {
        vEl.focus();
        vEl.select?.();
      }
      return;
    }

    if (!this.isPdScanActive) return;

    const target = ev.target as HTMLElement | null;
    if (target?.closest?.('.pd-exclude-scan-capture')) return;

    const tag = target?.tagName?.toUpperCase();
    if (tag === 'TEXTAREA') return;
    if (tag === 'INPUT' && !target?.classList.contains('pd-scanner-input')) return;

    const scanEl = this.pdScanInputRef?.nativeElement;
    if (!scanEl) return;
    if (document.activeElement !== scanEl) {
      scanEl.focus();
      scanEl.select?.();
    }
  }

  onPdScanEnter(input: HTMLInputElement): void {
    const v = (input?.value ?? '').trim();
    input.value = '';
    void this.processPdScanLine(v);
  }

  private processPdScanLine(raw: string): void {
    const line = raw.trim();
    if (!line || !this.isPdScanActive || this.deleteVerifyModalOpen) return;

    switch (this.batchStep) {
      case 'employee': {
        const emp = this.parseEmployeeIdFromScan(line);
        if (!emp) {
          alert(
            'Sai định dạng ID: lấy 7 ký tự đầu phải là ASP + 4 số (ví dụ ASP2101).'
          );
          return;
        }
        this.batchEmployeeId = emp;
        this.batchStep = 'lsx';
        this.scanStatusText = `Đã nhận ID: ${emp}. Tiếp theo: quét LSX.`;
        break;
      }
      case 'lsx': {
        const lsx = line.trim();
        if (!this.isValidLsxCode(lsx)) {
          alert('Quét lệnh sản xuất (LSX) — mã phải bắt đầu KZLSX hoặc LHLSX.');
          return;
        }
        this.batchProductionOrder = lsx;
        this.batchStep = 'material';
        this.scanStatusText = `LSX: ${lsx}. Quét mã nguyên liệu trả liên tục, xong bấm Done.`;
        break;
      }
      case 'material': {
        if (this.isValidLsxCode(line)) {
          alert(
            'Đang bước quét nguyên liệu. Nếu cần đổi LSX, bấm «Huỷ phiên» hoặc tắt SCAN.'
          );
          return;
        }
        const maybeEmp = this.parseEmployeeIdFromScan(line);
        if (maybeEmp) {
          alert(
            'Mã vừa quét giống format ID nhân viên. Nếu đây là nguyên liệu, kiểm tra lại; hoặc huỷ phiên và quét lại từ đầu.'
          );
          return;
        }
        this.pendingMaterials.push(line);
        this.scanStatusText = `Đã thêm ${this.pendingMaterials.length} mã — bấm Done để lưu vào hệ thống.`;
        break;
      }
    }
    this.cdr.markForCheck();
  }

  async refresh(): Promise<void> {
    this.isRefreshing = true;
    this.cdr.markForCheck();
    try {
      await new Promise<void>(r => setTimeout(r, 120));
      this.lastUpdatedText = new Date().toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } finally {
      this.isRefreshing = false;
      this.cdr.markForCheck();
    }
  }
}
