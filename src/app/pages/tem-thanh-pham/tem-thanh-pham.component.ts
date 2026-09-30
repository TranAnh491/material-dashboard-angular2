import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import * as QRCode from 'qrcode';
import { TpCatalogFullService } from '../../services/tp-catalog-full.service';
import { saveTemPrintRecord, takeTemRestore, TemImportBus, TemPlantSession } from './tem-print-store';

interface CartonRow {
  no: string;
  qty: number;
  qr: string;
}

interface TemCatalogRow {
  materialCode: string;
  asmCode: string;
  customerCode: string;
  name: string;
  customerName: string;
  pcs: string;
  netWeight: string;
  grossWeight: string;
  rev: string;
  source: 'danh-muc' | 'file';
}

const IMPORT_STORAGE_KEY = 'tem-tp-imported-catalog-v1';

@Component({
  selector: 'app-tem-thanh-pham',
  templateUrl: './tem-thanh-pham.component.html',
  styleUrls: ['./tem-thanh-pham.component.scss']
})
export class TemThanhPhamComponent implements OnInit, OnDestroy {
  private static readonly ICO_ITEM = '<svg viewBox="0 0 24 24"><path d="M12 3.2 4 7v10l8 3.8 8-3.8V7l-8-3.8z"/><path d="M12 12.2 4 7.4M12 12.2l8-4.8M12 12.2V21"/></svg>';
  private static readonly ICO_DOC = '<svg viewBox="0 0 24 24"><path d="M7 3.5h7.2L19 8.2V20.5H7z"/><path d="M14 3.5V8.4h5.2M9.2 12.2h6.2M9.2 16h6.2"/></svg>';
  private static readonly ICO_WO = '<svg viewBox="0 0 24 24"><path d="M12 3.2 5.2 6v5.6c0 4.1 2.7 6.8 6.8 8.2 4.1-1.4 6.8-4.1 6.8-8.2V6L12 3.2z"/><path d="m8.8 12 2.1 2.1 4.3-4.3"/></svg>';
  private static readonly ICO_KG = '<svg viewBox="0 0 24 24"><path d="M12 3.2v2.2"/><path d="M7.2 9.2h9.6l1.6 3.2a5.6 5.6 0 0 1-12.8 0l1.6-3.2z"/><path d="M5 20.8h14M8 20.8l1.6-5.2M16 20.8l-1.6-5.2"/></svg>';

  po = '';
  poSlash = '';
  materialCode = '';
  parenCode = '';
  pcs = '';
  workOrder = '';
  rev = '';
  netWeight = '';
  grossWeight = '';
  cartons: CartonRow[] = [{ no: '', qty: 1, qr: '' }];
  printing = false;

  catalogQuery = '';
  catalogLoading = false;
  catalogRows: TemCatalogRow[] = [];
  importedRows: TemCatalogRow[] = [];
  filteredCatalog: TemCatalogRow[] = [];
  selectedKey = '';

  private qrTimer: ReturnType<typeof setTimeout> | null = null;
  private stopImport: () => void = () => {};

  constructor(
    private router: Router,
    private tpCatalog: TpCatalogFullService,
    private plantSession: TemPlantSession,
    private imports: TemImportBus
  ) {}

  ngOnInit(): void {
    this.importedRows = this.readImported();
    if (!String(this.cartons[0]?.no || '').trim()) this.cartons[0].no = this.defaultCartonNo();
    void this.loadCatalog();
    this.applyRestore();
    void this.refreshQrs();
    this.stopImport = this.imports.listen((file) => void this.importCatalogFile(file));
  }

  ngOnDestroy(): void {
    if (this.qrTimer) clearTimeout(this.qrTimer);
    this.stopImport();
  }

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  get catalogCount(): number {
    return this.axonFujiRows().length;
  }

  async loadCatalog(): Promise<void> {
    this.catalogLoading = true;
    try {
      const items = await this.tpCatalog.getCatalogItemsCached();
      this.catalogRows = items
        .map((item) => ({
          materialCode: String(item.materialCode || '').trim(),
          asmCode: String(item.asmCode || '').trim(),
          customerCode: String(item.customerCode || '').trim(),
          name: String(item.productName || item.customer || '').trim(),
          customerName: String(item.customer || '').trim(),
          pcs: '',
          netWeight: String(item.netWeight || '').trim(),
          grossWeight: String(item.grossWeight || '').trim(),
          rev: this.blankRev(String(item.drawingRev || '').trim()),
          source: 'danh-muc' as const
        }))
        .filter((row) => row.materialCode || row.customerCode);
    } catch (e) {
      console.error('loadCatalog', e);
      this.catalogRows = [];
    } finally {
      this.catalogLoading = false;
      this.applyCatalogFilter();
    }
  }

  onCatalogQuery(): void {
    this.applyCatalogFilter();
  }

  applyCatalog(row: TemCatalogRow): void {
    this.selectedKey = this.rowKey(row);
    if (row.materialCode) this.materialCode = this.up(row.materialCode);
    this.poSlash = this.up(row.asmCode || '');
    if (row.customerCode) this.parenCode = this.up(row.customerCode);
    if (row.netWeight) this.netWeight = this.up(row.netWeight);
    if (row.grossWeight) this.grossWeight = this.up(row.grossWeight);
    if (row.pcs) this.pcs = this.up(row.pcs);
    this.rev = this.blankRev(row.rev);
    this.scheduleQr();
  }

  up(value: string): string {
    return String(value ?? '').toUpperCase();
  }

  async importCatalogFile(file: File): Promise<void> {
    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const book = XLSX.read(data, { type: 'array' });
      const sheet = book.Sheets[book.SheetNames[0]];
      const matrix = this.sheetMatrix(XLSX, sheet);
      const headerIdx = matrix.findIndex((line) =>
        (line || []).some((cell) => this.normKey(String(cell ?? '')) === 'mavattu')
      );
      if (headerIdx < 0) {
        alert('Không thấy cột Mã vật tư. Dòng tiêu đề cần có Mã vật tư, Mã ASM TQ, Mã S.Phẩm KH.');
        return;
      }
      const headers = (matrix[headerIdx] || []).map((cell) => String(cell ?? '').trim());
      const colA = this.findHeaderCol(headers, (key) => key === 'mavattu' || key.endsWith('mavattu'), 0);
      const colB = this.findHeaderCol(headers, (key) => this.isAsmHeader(key), colA + 1);
      const colC = this.findHeaderCol(headers, (key) => key.includes('sphamkh'), colA + 2);
      const colH = this.findHeaderCol(headers, (key) => key === 'khachhang', 7);
      const parsed = matrix
        .slice(headerIdx + 1)
        .map((line) => this.mapImportRow(this.rowFromHeader(headers, line || []), line || [], colA, colB, colC, colH))
        .filter((row) => row.materialCode || row.customerCode || row.asmCode);
      if (!parsed.length) {
        alert('File có tiêu đề nhưng không có dòng mã.');
        return;
      }
      this.importedRows = [];
      this.selectedKey = '';
      try { localStorage.removeItem(IMPORT_STORAGE_KEY); } catch { /* ignore */ }
      this.importedRows = parsed;
      this.writeImported(parsed);
      this.catalogQuery = '';
      this.applyCatalogFilter();
      this.imports.markImported();
      const withAsm = parsed.filter((row) => row.asmCode).length;
      alert(`Đã xóa danh mục cũ và nạp ${parsed.length} mã từ file mới. ${withAsm} mã có Mã TQ.`);
    } catch (e) {
      console.error(e);
      alert('Không đọc được file. Dùng Excel .xlsx hoặc .xls.');
    }
  }

  clearImported(): void {
    this.importedRows = [];
    try { localStorage.removeItem(IMPORT_STORAGE_KEY); } catch { /* ignore */ }
    this.applyCatalogFilter();
  }

  get plant(): '' | 'ASM1' | 'ASM2' {
    return this.plantSession.plant;
  }

  get woPrefix(): string {
    return this.plantSession.prefix;
  }

  removeCarton(index: number): void {
    if (this.cartons.length === 1) {
      this.cartons = [{ no: this.defaultCartonNo(), qty: 1, qr: '' }];
      return;
    }
    this.cartons = this.cartons.filter((_, i) => i !== index);
  }

  onCartonInput(row: CartonRow): void {
    row.no = this.up(row.no);
    this.scheduleQr();
  }

  onQtyChange(row: CartonRow): void {
    const no = this.up(row.no || '');
    const dated = /^(\d{8})H\d*$/i.exec(no);
    if (dated) row.no = `${dated[1]}H001`;
    else if (!no || /^\d+$/.test(no)) row.no = this.defaultCartonNo();
    this.onCartonInput(row);
  }

  scheduleQr(): void {
    if (this.qrTimer) clearTimeout(this.qrTimer);
    this.qrTimer = setTimeout(() => void this.refreshQrs(), 180);
  }

  /** Mã hàng, số PCS, Carton No, Rev. */
  private qrText(cartonNo: string): string {
    return [this.materialCode.trim(), this.formatPcs(this.pcs), cartonNo.trim(), this.blankRev(this.rev)].join('|');
  }

  cartonSpan(row: CartonRow): string {
    const all = this.expandOne(row);
    if (all.length < 2) return '';
    return `${all[0]} → ${all[all.length - 1]}`;
  }

  previewNo(row: CartonRow): string {
    return this.expandOne(row)[0] || this.up(row.no);
  }

  /** Thùng này / tổng thùng của lần in. Xem trước lấy thùng đầu của dòng. */
  boxMark(row: CartonRow): string {
    const total = this.expandCartons().length;
    if (!total) return '';
    let index = 1;
    for (const item of this.cartons) {
      if (item === row) break;
      index += this.expandOne(item).length;
    }
    return `${index}/${total}`;
  }

  /** Cột A, rồi " / " + cột B (Mã ASM TQ) chỉ khi mã B bắt đầu bằng F. */
  lineCodeLeft(): string {
    const a = this.materialCode.trim();
    const b = this.cleanCode(this.poSlash).replace(/^[^A-Za-z0-9]+/, '');
    const showB = /^F/i.test(b);
    if (a && showB) return `${a} / ${b}`;
    if (showB) return b;
    return a;
  }

  /** Cột C, hàng ngang ngay dưới mã hàng. */
  lineCodeRight(): string {
    return this.parenCode.trim();
  }

  woValue(): string {
    const body = this.woBody();
    return body ? `${this.woPrefix}${body}` : '';
  }

  /** Để trống khi không có Rev KH. */
  revValue(): string {
    return this.blankRev(this.rev);
  }

  revLine(): string {
    const rev = this.revValue();
    return rev ? `Rev: ${rev}` : '';
  }

  /** Không có Rev KH thì để trống, kể cả câu ghi chú trong danh mục. */
  blankRev(value: string): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const n = raw
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (n.includes('khong co rev')) return '';
    return raw.toUpperCase();
  }

  nwValue(): string {
    const nw = this.netWeight.trim();
    return nw ? `${nw} KGS` : '';
  }

  gwValue(): string {
    const gw = this.grossWeight.trim();
    return gw ? `${gw} KGS` : '';
  }

  pcsText(): string {
    const n = this.formatPcs(this.pcs);
    return n ? `${n} PCS` : '';
  }

  /** Hơn 1000 thì thêm dấu phẩy ngăn hàng nghìn: 1200 → 1,200. */
  private formatPcs(value: string): string {
    const raw = String(value || '').trim().replace(/,/g, '');
    if (!raw) return '';
    const match = raw.match(/^(\d+)(\.\d+)?$/);
    if (!match) return String(value || '').trim();
    const num = Number(raw);
    if (!Number.isFinite(num) || num <= 1000) return raw;
    const grouped = match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return grouped + (match[2] || '');
  }

  get canPrint(): boolean {
    const carton = String(this.cartons[0]?.no || '').trim();
    const qty = Math.floor(Number(this.cartons[0]?.qty) || 0);
    return !!(
      this.po.trim() &&
      this.poSlash.trim() &&
      this.materialCode.trim() &&
      this.parenCode.trim() &&
      this.pcs.trim() &&
      this.workOrder.trim() &&
      this.netWeight.trim() &&
      this.grossWeight.trim() &&
      carton &&
      qty >= 1
    );
  }

  async printLabels(): Promise<void> {
    if (!this.canPrint) return;
    const rows = this.expandCartons();
    if (!rows.length) {
      alert('Nhập Carton No để in. Mã QR lấy theo Carton No.');
      return;
    }
    this.printing = true;
    try {
      const labels: Array<{ no: string; qr: string }> = [];
      for (const no of rows) {
        labels.push({ no, qr: await this.makeQr(this.qrText(no)) });
      }
      const html = this.buildPrintHtml(labels);
      const win = window.open('', '_blank');
      if (!win) {
        alert('Không mở được cửa sổ in. Hãy bật popup cho trang này.');
        return;
      }
      win.document.write(html);
      win.document.close();
      win.document.title = 'Tem Thành Phẩm';
      this.rememberPrint(rows);
      const run = () => {
        win.focus();
        win.print();
      };
      win.onload = () => setTimeout(run, 250);
      setTimeout(run, 800);
    } catch (e) {
      console.error(e);
      alert('Không tạo được tem. Vui lòng thử lại.');
    } finally {
      this.printing = false;
    }
  }

  private applyRestore(): void {
    const saved = takeTemRestore();
    if (!saved) return;
    this.po = saved.po || '';
    this.materialCode = saved.materialCode || '';
    this.poSlash = saved.asmCode || '';
    this.parenCode = saved.customerCode || '';
    this.pcs = saved.pcs || '';
    this.workOrder = this.woBody(saved.workOrder || '');
    this.plantSession.plant = saved.plant === 'ASM2' || String(saved.workOrder || '').toUpperCase().startsWith('LHLSX')
      ? 'ASM2'
      : 'ASM1';
    this.rev = saved.rev || '';
    this.netWeight = saved.netWeight || '';
    this.grossWeight = saved.grossWeight || '';
    const cartons = (saved.cartons || []).filter(Boolean);
    this.cartons = (cartons.length ? cartons : ['']).map((no) => ({ no, qty: 1, qr: '' }));
    void this.refreshQrs();
  }

  private rememberPrint(cartons: string[]): void {
    saveTemPrintRecord({
      id: `${Date.now()}`,
      at: new Date().toISOString(),
      po: this.po.trim(),
      materialCode: this.materialCode.trim(),
      asmCode: this.poSlash.trim(),
      customerCode: this.parenCode.trim(),
      pcs: this.pcs.trim(),
      workOrder: `${this.woPrefix}${this.woBody()}`,
      plant: this.plant,
      rev: this.rev.trim(),
      netWeight: this.netWeight.trim(),
      grossWeight: this.grossWeight.trim(),
      cartons
    });
  }

  private woBody(raw = this.workOrder): string {
    let body = String(raw || '').trim();
    const upper = body.toUpperCase();
    if (upper.startsWith('KZLSX')) body = body.slice(5);
    else if (upper.startsWith('LHLSX')) body = body.slice(5);
    return body.trim();
  }

  /** Ngày in YYYYMMDD, rồi H001…H theo số thùng. Chuỗi sửa tay thì in đúng chuỗi đó. */
  private expandCartons(): string[] {
    const out: string[] = [];
    for (const row of this.cartons) out.push(...this.expandOne(row));
    return out;
  }

  private expandOne(row: CartonRow): string[] {
    const no = this.up(String(row.no || '').trim());
    if (!no) return [];
    const count = Math.max(1, Math.floor(Number(row.qty) || 1));
    const dated = /^(\d{8})H\d*$/i.exec(no);
    const digitsOnly = /^\d+$/.test(no);
    if (dated || digitsOnly) {
      const date = dated ? dated[1] : this.defaultCartonNo().slice(0, 8);
      if (count === 1 && dated) return [no];
      const labels: string[] = [];
      for (let i = 1; i <= count; i++) labels.push(`${date}H${String(i).padStart(3, '0')}`);
      return labels;
    }
    if (count === 1) return [no];
    const match = /^(.*?)(\d+)$/.exec(no);
    if (!match) return Array.from({ length: count }, () => no);
    const head = match[1];
    const width = match[2].length;
    const start = parseInt(match[2], 10);
    const labels: string[] = [];
    for (let i = 0; i < count; i++) labels.push(head + String(start + i).padStart(width, '0'));
    return labels;
  }

  private defaultCartonNo(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}H001`;
  }

  private applyCatalogFilter(): void {
    const q = this.catalogQuery.trim().toUpperCase();
    if (!q) {
      this.filteredCatalog = [];
      return;
    }
    const all = this.axonFujiRows();
    const matched = all.filter((row) => {
      const blob = `${row.materialCode} ${row.asmCode} ${row.customerCode} ${row.name} ${row.customerName}`.toUpperCase();
      return blob.includes(q);
    });
    this.filteredCatalog = matched.slice(0, 60);
  }

  /** Cột H Khách hàng: chỉ Axone và FJXR. */
  private isAxonOrFuji(name: string): boolean {
    const n = String(name || '').trim().toUpperCase();
    return n === 'AXONE' || n === 'FJXR';
  }

  private axonFujiRows(): TemCatalogRow[] {
    const all = this.importedRows.length ? this.importedRows : this.catalogRows;
    return all.filter((row) => this.isAxonOrFuji(row.customerName));
  }

  private rowKey(row: TemCatalogRow): string {
    return `${row.source}|${row.materialCode}|${row.customerCode}`;
  }

  private findHeaderCol(headers: string[], match: (key: string) => boolean, fallback: number): number {
    const idx = headers.findIndex((header) => match(this.normKey(header)));
    return idx >= 0 ? idx : fallback;
  }

  private rowFromHeader(headers: string[], line: unknown[]): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      row[header] = line[index] ?? '';
    });
    return row;
  }

  /** Mã ASM TQ, Mã TQ, hoặc cột ngay sau Mã vật tư. */
  private isAsmHeader(key: string): boolean {
    return key === 'maasmtq' || key === 'matq' || key.includes('asmtq');
  }

  private sheetMatrix(XLSX: { utils: { decode_range: (ref: string) => { s: { r: number; c: number }; e: { r: number; c: number } }; encode_cell: (cell: { r: number; c: number }) => string } }, sheet: Record<string, any>): string[][] {
    const ref = String(sheet?.['!ref'] || '');
    if (!ref) return [];
    const range = XLSX.utils.decode_range(ref);
    const matrix: string[][] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const line: string[] = [];
      for (let c = 0; c <= range.e.c; c++) {
        line.push(this.cellText(sheet[XLSX.utils.encode_cell({ r, c })]));
      }
      matrix.push(line);
    }
    return matrix;
  }

  /** Lấy chữ đang hiện trên ô. Ô công thức đôi khi chỉ còn phần hiển thị. */
  private cellText(cell: any): string {
    if (!cell) return '';
    const shown = cell.w != null ? String(cell.w) : '';
    if (shown.trim()) return shown.trim();
    if (cell.v != null && String(cell.v).trim()) return String(cell.v).trim();
    return '';
  }

  private mapImportRow(
    row: Record<string, unknown>,
    line: unknown[] = [],
    colA = 0,
    colB = 1,
    colC = 2,
    colH = 7
  ): TemCatalogRow {
    const revKh = this.pickLoose(row, (key) => key.includes('version') && key.includes('banve') && key.endsWith('kh'));
    const asmFromHeader = this.pickLoose(row, (key) => this.isAsmHeader(key));
    const khFromHeader = this.pick(row, ['masphamkh']) || this.pickLoose(row, (key) => key.includes('sphamkh'));
    const khFromCol = this.cleanCode(line[colC]);
    return {
      materialCode: this.pick(row, ['mavattu']),
      asmCode: this.firstText([asmFromHeader, line[colB], line[colA + 1], line[1]]),
      customerCode: khFromHeader || khFromCol,
      name: this.pick(row, ['tenvattu']),
      customerName: this.pick(row, ['khachhang']) || this.cleanCode(line[colH]),
      pcs: this.pick(row, ['slsptrenthung']),
      netWeight: this.pick(row, ['netweight']),
      grossWeight: this.pick(row, ['grossweight']),
      rev: this.blankRev(revKh),
      source: 'file'
    };
  }

  private cleanCode(value: unknown): string {
    return String(value ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  }

  private firstText(values: unknown[]): string {
    for (const value of values) {
      const text = this.cleanCode(value);
      if (text) return text;
    }
    return '';
  }

  private pick(row: Record<string, unknown>, aliases: string[]): string {
    return this.pickLoose(row, (key) => aliases.includes(key));
  }

  private pickLoose(row: Record<string, unknown>, match: (key: string) => boolean): string {
    const keys = Object.keys(row);
    for (const key of keys) {
      if (match(this.normKey(key))) {
        return this.cleanCode(row[key]);
      }
    }
    return '';
  }

  private normKey(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  private readImported(): TemCatalogRow[] {
    try {
      const raw = localStorage.getItem(IMPORT_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as TemCatalogRow[];
      if (!Array.isArray(parsed)) return [];
      return parsed.map((row) => ({
        materialCode: String(row?.materialCode || '').trim(),
        asmCode: String(row?.asmCode || '').trim(),
        customerCode: String(row?.customerCode || '').trim(),
        name: String(row?.name || '').trim(),
        customerName: String(row?.customerName || '').trim(),
        pcs: String(row?.pcs || '').trim(),
        netWeight: String(row?.netWeight || '').trim(),
        grossWeight: String(row?.grossWeight || '').trim(),
        rev: String(row?.rev || '').trim(),
        source: 'file' as const
      }));
    } catch {
      return [];
    }
  }

  private writeImported(rows: TemCatalogRow[]): void {
    try {
      localStorage.setItem(IMPORT_STORAGE_KEY, JSON.stringify(rows));
    } catch {
      /* file lớn hơn bộ nhớ trình duyệt — vẫn lọc được trong phiên này */
    }
  }

  private async refreshQrs(): Promise<void> {
    for (const row of this.cartons) {
      const no = this.previewNo(row);
      if (!no) {
        row.qr = '';
        continue;
      }
      try {
        row.qr = await this.makeQr(this.qrText(no));
      } catch {
        row.qr = '';
      }
    }
  }

  private makeQr(cartonNo: string): Promise<string> {
    return QRCode.toDataURL(cartonNo, {
      width: 240,
      margin: 0,
      errorCorrectionLevel: 'M'
    });
  }

  private buildPrintHtml(labels: Array<{ no: string; qr: string }>): string {
    const pages = labels.map((row, index) => {
      const breakAfter = index < labels.length - 1 ? ' fgtem-break' : '';
      return `<article class="fgtem-label${breakAfter}">${this.labelInner(row.no, row.qr, index + 1, labels.length)}</article>`;
    }).join('');
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Tem Thành Phẩm</title>
  <style>
    @page { size: 57mm 32mm; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 57mm; background: #fff; }
    .fgtem-label {
      width: 57mm; height: 32mm; padding: 0.35mm; box-sizing: border-box;
      background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif;
    }
    .fgtem-break { page-break-after: always; }
    .fgtem-face {
      height: 100%; border: 0.4mm solid #000; border-radius: 1.35mm;
      overflow: hidden; display: flex; flex-direction: column; background: #fff;
    }
    .fgtem-head {
      height: 5.6mm; flex: 0 0 5.6mm; display: flex; align-items: stretch;
      background: #fff; color: #000; border-bottom: 0.35mm solid #000;
    }
    .fgtem-brand {
      flex: 1; min-width: 0; display: flex; align-items: center;
      padding: 0 1.4mm; font-size: 6.4pt; font-weight: 800;
    }
    .fgtem-brand__code { min-width: 0; overflow: hidden; white-space: nowrap; font-size: 6.4pt; letter-spacing: 0; }
    .fgtem-pcs {
      flex: 0 0 16.5mm; display: flex; align-items: center; justify-content: flex-end;
      padding: 0 1.4mm; background: #fff; color: #000;
      font-size: 7.2pt; font-weight: 800; white-space: nowrap;
      border-left: 0.35mm solid #000;
    }
    .fgtem-body { flex: 1; min-height: 0; display: flex; }
    .fgtem-rows { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .fgtem-row {
      flex: 1; min-height: 0; display: flex; align-items: center; gap: 0.8mm;
      padding: 0 0.9mm; border-bottom: 0.25mm solid #000;
    }
    .fgtem-row:last-child { border-bottom: 0; }
    .fgtem-box { margin-left: auto; flex: 0 0 auto; font-size: 5.4pt; font-weight: 800; line-height: 1; white-space: nowrap; }
    .fgtem-row--pair { gap: 0.4mm; }
    .fgtem-pair { flex: 1; min-width: 0; display: flex; align-items: center; gap: 0.7mm; }
    .fgtem-ico {
      width: 2.9mm; height: 2.9mm; flex: 0 0 2.9mm; border-radius: 0.55mm;
      background: transparent; color: #000;
      display: flex; align-items: center; justify-content: center;
    }
    .fgtem-ico svg {
      width: 2mm; height: 2mm; fill: none; stroke: currentColor; stroke-width: 1.8;
      stroke-linecap: round; stroke-linejoin: round;
    }
    .fgtem-meta { min-width: 0; display: flex; flex-direction: column; justify-content: center; line-height: 1.05; }
    .fgtem-k { font-size: 3.15pt; font-weight: 700; color: #000; }
    .fgtem-v { font-size: 5pt; font-weight: 800; color: #000; white-space: nowrap; overflow: hidden; }
    .fgtem-side {
      position: relative; width: 18.8mm; flex: 0 0 18.8mm; display: flex;
      align-items: center; justify-content: center;
      border-left: 0.35mm solid #000; padding: 0.3mm 0.4mm 2.1mm;
    }
    .fgtem-qr { position: relative; width: 16.9mm; height: 16.9mm; display: flex; align-items: center; justify-content: center; }
    .fgtem-qr img { width: 13mm; height: 13mm; display: block; }
    .fgtem-rev {
      position: absolute; right: 0.45mm; bottom: 0.3mm; max-width: 17mm; text-align: right;
      font-size: 4.6pt; font-weight: 800; color: #000; line-height: 1; white-space: nowrap; overflow: hidden;
    }
    .fgtem-c { position: absolute; width: 3mm; height: 3mm; border: 0.5mm solid #000; }
    .fgtem-c--tl { top: 0; left: 0; border-right: 0; border-bottom: 0; }
    .fgtem-c--tr { top: 0; right: 0; border-left: 0; border-bottom: 0; }
    .fgtem-c--bl { bottom: 0; left: 0; border-right: 0; border-top: 0; }
    .fgtem-c--br { bottom: 0; right: 0; border-left: 0; border-top: 0; }
  </style>
</head>
<body>${pages}</body>
</html>`;
  }

  private labelInner(cartonNo: string, qr: string, index: number, total: number): string {
    const qrImg = qr ? `<img src="${qr}" alt="">` : '';
    const row = (icon: string, label: string, value: string) =>
      `<div class="fgtem-row"><span class="fgtem-ico">${icon}</span><span class="fgtem-meta"><span class="fgtem-k">${label}</span><span class="fgtem-v">${this.escape(value)}</span></span></div>`;
    return `<div class="fgtem-face">
      <div class="fgtem-head">
        <div class="fgtem-brand"><span class="fgtem-brand__code">${this.escape(this.lineCodeLeft())}</span></div>
        <div class="fgtem-pcs">${this.escape(this.pcsText())}</div>
      </div>
      <div class="fgtem-body">
        <div class="fgtem-rows">
          ${row(TemThanhPhamComponent.ICO_ITEM, 'ITEM', this.lineCodeRight())}
          <div class="fgtem-row"><span class="fgtem-ico">${TemThanhPhamComponent.ICO_DOC}</span><span class="fgtem-meta"><span class="fgtem-k">CARTON No.</span><span class="fgtem-v">${this.escape(cartonNo)}</span></span><span class="fgtem-box">${index}/${total}</span></div>
          ${row(TemThanhPhamComponent.ICO_WO, 'W.O.', this.woValue())}
          <div class="fgtem-row fgtem-row--pair">
            <span class="fgtem-pair"><span class="fgtem-ico">${TemThanhPhamComponent.ICO_KG}</span><span class="fgtem-meta"><span class="fgtem-k">N.W</span><span class="fgtem-v">${this.escape(this.nwValue())}</span></span></span>
            <span class="fgtem-pair"><span class="fgtem-ico">${TemThanhPhamComponent.ICO_KG}</span><span class="fgtem-meta"><span class="fgtem-k">G.W</span><span class="fgtem-v">${this.escape(this.gwValue())}</span></span></span>
          </div>
        </div>
        <div class="fgtem-side">
          <div class="fgtem-qr">
            <span class="fgtem-c fgtem-c--tl"></span>
            <span class="fgtem-c fgtem-c--tr"></span>
            <span class="fgtem-c fgtem-c--bl"></span>
            <span class="fgtem-c fgtem-c--br"></span>
            ${qrImg}
          </div>
          <div class="fgtem-rev">${this.escape(this.revLine())}</div>
        </div>
      </div>
    </div>`;
  }

  private escape(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
