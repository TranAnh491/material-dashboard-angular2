import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Router } from '@angular/router';
import { NvlCatalogFullService } from '../../services/nvl-catalog-full.service';
import { WorkOrderOutboundCreatedByService } from '../../services/work-order-outbound-created-by.service';

/** 1 mốc trên dòng thời gian mã hàng: nhận (nhập) hoặc xuất (theo LSX). */
interface TraceEvent {
  kind: 'in' | 'out';
  date: number;
  ref: string;
  qty: number;
  detail: string;
  pickers: string[];
}

/** 1 lần nhập kho của mã hàng. */
interface TraceInRow {
  date: number;
  factory: string;
  po: string;
  lot: string;
  qty: number;
  supplier: string;
  /** Mã ASP người nhận / kiểm lô (employeeIds trên phiếu nhập, nếu có). */
  employeeIds: string[];
  pickers: string[];
}

/** Xuất của mã hàng gộp theo LSX — biết ai soạn LSX nào. */
interface TraceOutByLsx {
  lsx: string;
  factory: string;
  date: number;
  qty: number;
  unit: string;
  pos: string[];
  pickers: string[];
}

/** Xuất của 1 LSX gộp theo mã hàng. */
interface TraceLsxItem {
  code: string;
  name: string;
  date: number;
  qty: number;
  unit: string;
  pos: string[];
  pickers: string[];
}

interface OutDoc {
  code: string;
  lsx: string;
  factory: string;
  po: string;
  qty: number;
  unit: string;
  date: number;
  employeeId: string;
}

/** Tra cứu xuất nhập theo mã hàng / LSX — giao diện gọn cho điện thoại. */
@Component({
  selector: 'app-qc-traceability',
  templateUrl: './qc-traceability.component.html',
  styleUrls: ['./qc-traceability.component.scss']
})
export class QcTraceabilityComponent implements AfterViewInit, OnDestroy {
  @ViewChild('traceScanInput') traceScanInput?: ElementRef<HTMLInputElement>;

  scanCode = '';
  isLoading = false;
  errorMessage = '';
  cameraOpen = false;
  cameraError = '';
  private cameraScanner: { stop: () => Promise<void>; clear: () => void } | null = null;

  /** Kết quả đang hiện: theo mã hàng hoặc theo LSX. */
  mode: 'none' | 'code' | 'lsx' = 'none';
  timeline: TraceEvent[] = [];

  code = '';
  codeName = '';
  inRows: TraceInRow[] = [];
  outByLsx: TraceOutByLsx[] = [];

  lsx = '';
  lsxFactory = '';
  lsxItems: TraceLsxItem[] = [];
  lsxPickers: string[] = [];

  constructor(
    private firestore: AngularFirestore,
    private router: Router,
    private nvlCatalog: NvlCatalogFullService,
    private createdBySvc: WorkOrderOutboundCreatedByService
  ) {}

  ngAfterViewInit(): void {
    this.focusScanField();
  }

  ngOnDestroy(): void {
    void this.stopCamera();
  }

  get inTotal(): number {
    return this.inRows.reduce((s, r) => s + r.qty, 0);
  }

  get outTotal(): number {
    return this.outByLsx.reduce((s, r) => s + r.qty, 0);
  }

  get lsxTotalCodes(): number {
    return this.lsxItems.length;
  }

  goToMenu(): void {
    void this.router.navigateByUrl('/menu');
  }

  onScanInput(event: Event): void {
    const el = event.target as HTMLInputElement | null;
    const upper = (el?.value ?? '').toUpperCase();
    this.scanCode = upper;
    if (el && el.value !== upper) el.value = upper;
  }

  focusScanField(): void {
    setTimeout(() => this.traceScanInput?.nativeElement?.focus(), 0);
  }

  /** Bấm vào LSX / mã trong danh sách → tra tiếp. */
  lookup(value: string): void {
    this.scanCode = String(value || '').trim().toUpperCase();
    void this.runLookup();
  }

  async openCameraScan(): Promise<void> {
    this.cameraOpen = true;
    this.cameraError = '';
    await new Promise((r) => setTimeout(r, 0));
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const scanner = new Html5Qrcode('trace-qr-reader');
      this.cameraScanner = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (text: string) => {
          void this.stopCamera().then(() => this.lookup(text));
        },
        () => undefined
      );
    } catch {
      this.cameraError = 'Không mở được camera.';
    }
  }

  closeCameraScan(): void {
    void this.stopCamera();
  }

  private async stopCamera(): Promise<void> {
    const sc = this.cameraScanner;
    this.cameraScanner = null;
    this.cameraOpen = false;
    if (!sc) return;
    try {
      await sc.stop();
      sc.clear();
    } catch {
      /* camera đã dừng */
    }
  }

  async runLookup(): Promise<void> {
    const raw = (this.scanCode || '').trim().toUpperCase();
    if (!raw) {
      this.errorMessage = 'Nhập mã hàng hoặc LSX.';
      return;
    }
    this.isLoading = true;
    this.errorMessage = '';
    this.mode = 'none';
    try {
      if (this.looksLikeLsx(raw)) await this.loadByLsx(raw);
      else await this.loadByCode(this.codeFromScan(raw));
    } catch (e) {
      console.error('Traceability lookup:', e);
      this.errorMessage = 'Không tải được dữ liệu, thử lại.';
    } finally {
      this.isLoading = false;
    }
  }

  // ---------- Theo mã hàng ----------

  private async loadByCode(code: string): Promise<void> {
    if (!code) {
      this.errorMessage = 'Mã không hợp lệ.';
      return;
    }
    const [inSnap, outDocs] = await Promise.all([
      this.firestore.collection('inbound-materials', (ref) => ref.where('materialCode', '==', code).limit(300)).get().toPromise(),
      this.queryOut('materialCode', code)
    ]);

    const inRows: TraceInRow[] = [];
    (inSnap?.docs || []).forEach((doc) => {
      const d = doc.data() as Record<string, unknown>;
      inRows.push({
        date: this.toMs(d.importDate) || this.toMs(d.createdAt),
        factory: this.text(d.factory),
        po: this.text(d.poNumber),
        lot: this.text(d.batchNumber),
        qty: Number(d.quantity) || 0,
        supplier: this.text(d.supplier),
        employeeIds: (Array.isArray(d.employeeIds) ? d.employeeIds : [d.employeeId])
          .map((x) => this.createdBySvc.normalizeMemberId(this.text(x)))
          .filter(Boolean),
        pickers: []
      });
    });
    inRows.sort((a, b) => b.date - a.date);

    const names = await this.pickerNames([...outDocs.map((o) => o.employeeId), ...inRows.flatMap((r) => r.employeeIds)]);
    inRows.forEach((r) => (r.pickers = [...new Set(r.employeeIds.map((id) => names.get(id) || id))]));
    const byLsx = new Map<string, TraceOutByLsx>();
    for (const o of outDocs) {
      const key = o.lsx || '(không LSX)';
      let row = byLsx.get(key);
      if (!row) {
        row = { lsx: key, factory: o.factory, date: o.date, qty: 0, unit: o.unit, pos: [], pickers: [] };
        byLsx.set(key, row);
      }
      row.qty += o.qty;
      if (o.date && (!row.date || o.date < row.date)) row.date = o.date;
      if (o.po && !row.pos.includes(o.po)) row.pos.push(o.po);
      const p = names.get(o.employeeId);
      if (p && !row.pickers.includes(p)) row.pickers.push(p);
    }

    if (!inRows.length && !byLsx.size) {
      this.errorMessage = `Không có lịch sử nhập / xuất cho mã ${code}.`;
      return;
    }
    this.code = code;
    this.codeName = await this.materialName(code);
    this.inRows = inRows;
    this.outByLsx = [...byLsx.values()].sort((a, b) => b.date - a.date);
    this.timeline = this.buildTimeline();
    this.mode = 'code';
  }

  // ---------- Theo LSX ----------

  private async loadByLsx(input: string): Promise<void> {
    const candidates = this.lsxCandidates(input);
    let docs: OutDoc[] = [];
    let lsx = candidates[0];
    for (const c of candidates) {
      docs = await this.queryOut('productionOrder', c);
      if (docs.length) {
        lsx = c;
        break;
      }
    }
    if (!docs.length) {
      this.errorMessage = `LSX ${input} chưa có lần xuất kho nào.`;
      return;
    }

    const names = await this.pickerNames(docs.map((d) => d.employeeId));
    const byCode = new Map<string, TraceLsxItem>();
    const allPickers: string[] = [];
    for (const o of docs) {
      let row = byCode.get(o.code);
      if (!row) {
        row = { code: o.code, name: '', date: o.date, qty: 0, unit: o.unit, pos: [], pickers: [] };
        byCode.set(o.code, row);
      }
      row.qty += o.qty;
      if (o.date && (!row.date || o.date < row.date)) row.date = o.date;
      if (o.po && !row.pos.includes(o.po)) row.pos.push(o.po);
      const p = names.get(o.employeeId);
      if (p && !row.pickers.includes(p)) row.pickers.push(p);
      if (p && !allPickers.includes(p)) allPickers.push(p);
    }
    const items = [...byCode.values()].sort((a, b) => b.date - a.date || a.code.localeCompare(b.code));
    const nameMap = await this.materialNameMap(items.map((i) => i.code));
    items.forEach((i) => (i.name = nameMap.get(i.code) || ''));

    this.lsx = lsx;
    this.lsxFactory = docs[0].factory;
    this.lsxItems = items;
    this.lsxPickers = allPickers;
    this.mode = 'lsx';
  }

  /** Nhập + xuất trộn theo thời gian (mới nhất trước); xuất lấy lần scan đầu của LSX. */
  private buildTimeline(): TraceEvent[] {
    const ev: TraceEvent[] = [
      ...this.inRows.map((r) => ({
        kind: 'in' as const,
        date: r.date,
        ref: r.po || '—',
        qty: r.qty,
        detail: [r.factory, r.lot ? `Lô ${r.lot}` : '', r.supplier].filter(Boolean).join(' · '),
        pickers: r.pickers
      })),
      ...this.outByLsx.map((r) => ({
        kind: 'out' as const,
        date: r.date,
        ref: r.lsx,
        qty: r.qty,
        detail: r.pos.length ? `PO ${r.pos.join(', ')}` : '',
        pickers: r.pickers
      }))
    ];
    return ev.sort((a, b) => b.date - a.date);
  }

  // ---------- Helpers ----------

  private async queryOut(field: 'materialCode' | 'productionOrder', value: string): Promise<OutDoc[]> {
    const snap = await this.firestore
      .collection('outbound-materials', (ref) => ref.where(field, '==', value).limit(800))
      .get()
      .toPromise();
    const out: OutDoc[] = [];
    (snap?.docs || []).forEach((doc) => {
      const d = doc.data() as Record<string, unknown>;
      out.push({
        code: this.text(d.materialCode).toUpperCase(),
        lsx: this.text(d.productionOrder).toUpperCase(),
        factory: this.text(d.factory),
        po: this.text(d.poNumber),
        qty: Number(d.exportQuantity ?? d.quantity) || 0,
        unit: this.text(d.unit),
        date: this.toMs(d.exportDate) || this.toMs(d.createdAt),
        employeeId: this.createdBySvc.normalizeMemberId(this.text(d.employeeId) || this.text(d.exportedBy))
      });
    });
    return out;
  }

  /** Mã ASP người scan xuất → tên (Settings, rồi Zalo). */
  private async pickerNames(employeeIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(employeeIds.filter(Boolean))];
    const map = new Map<string, string>();
    await Promise.all(
      ids.map(async (id) => {
        const name = await this.createdBySvc.resolveDisplayName(id).catch(() => id);
        map.set(id, name && name !== id ? `${name} (${id})` : id);
      })
    );
    return map;
  }

  private async materialName(code: string): Promise<string> {
    return (await this.materialNameMap([code])).get(code) || '';
  }

  private async materialNameMap(codes: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
      const items = this.nvlCatalog.peekCached() || (await this.nvlCatalog.listAll());
      const want = new Set(codes.map((c) => this.nvlCatalog.normalizeCode(c)));
      for (const i of items) {
        if (want.has(i.materialCode) && i.materialName) map.set(i.materialCode, i.materialName.trim());
      }
    } catch (e) {
      console.warn('Traceability: không đọc được Danh mục NVL', e);
    }
    return map;
  }

  private looksLikeLsx(s: string): boolean {
    return /LSX/.test(s) || /^\d{4}[\/.-]\d{3,5}$/.test(s);
  }

  /** KZLSX0826/0303 giữ nguyên; "0826/0303" → thử KZLSX rồi LHLSX. */
  private lsxCandidates(input: string): string[] {
    const t = input.replace(/\s+/g, '').replace(/[.-]/g, '/');
    if (/LSX/.test(t)) return [t];
    return [`KZLSX${t}`, `LHLSX${t}`];
  }

  /** QR tem "MÃ|PO|SL|IMD" → lấy mã hàng. */
  private codeFromScan(raw: string): string {
    return raw.split('|')[0].trim().replace(/\s+/g, '');
  }

  private text(v: unknown): string {
    return v == null ? '' : String(v).trim();
  }

  private toMs(v: unknown): number {
    if (!v) return 0;
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'object' && v !== null && 'toDate' in v) {
      try {
        return (v as { toDate: () => Date }).toDate().getTime();
      } catch {
        return 0;
      }
    }
    if (typeof v === 'object' && v !== null && 'seconds' in v) return Number((v as { seconds: number }).seconds) * 1000;
    const d = new Date(v as string | number);
    return Number.isFinite(d.getTime()) ? d.getTime() : 0;
  }

  fmtDate(ms: number): string {
    if (!ms) return '—';
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  fmtQty(n: number): string {
    return (Math.round(n * 1000) / 1000).toLocaleString('vi-VN');
  }
}
