import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import * as XLSX from 'xlsx';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { splitMultiLocations } from '../layout-warehouse/layout-warehouse-location.util';
import { NvlCatalogFullService } from '../../services/nvl-catalog-full.service';
import { getLayoutLocationGroups, normalizeJRackLocation } from '../materials/layout-location-catalog';

interface LocRow {
  loc: string;
  /** Nhóm hiển thị: dãy kệ J (R01, S20…), LOCKER, hoặc Khác */
  group: string;
  /** Có trong danh sách gốc (sơ đồ kho J / danh mục vị trí) */
  inBase: boolean;
  lines: number;
  checked: number;
  codes: number;
  pct: number | null;
}

/** 1 dòng tồn tại 1 vị trí (trang chi tiết vị trí) */
interface LocItem {
  code: string;
  name: string;
  po: string;
  batch: string;
  stock: number;
  unit: string;
  checked: boolean;
}

interface LocGroup {
  key: string;
  rows: LocRow[];
  lines: number;
  checked: number;
  pct: number | null;
  /** Tỷ lệ sử dụng: số ô (trong sơ đồ / danh mục) đang có hàng / tổng số ô */
  slots: number;
  usedSlots: number;
  usePct: number | null;
}

/**
 * % kiểm kê theo vị trí (mở từ nút Vị trí ở Quản lý NVL, tab mới).
 * - ASM1: gốc là sơ đồ kho J (tab J-Warehouse: R01–R28, dãy S kho mát) + LOCKER;
 *   ẩn vị trí cũ (D1) / BOX không có hàng — vị trí đang có hàng luôn hiện.
 * - ASM2: gốc là danh mục vị trí (collection `locations`).
 * Bấm Run → đọc tồn kho nhà máy → mỗi vị trí: dòng đã tick KK / tổng dòng còn tồn. Gom theo dãy kệ.
 */
@Component({
  selector: 'app-kk-vi-tri',
  templateUrl: './kk-vi-tri.component.html',
  styleUrls: ['./kk-vi-tri.component.scss']
})
export class KkViTriComponent implements OnInit {
  factory: 'ASM1' | 'ASM2' = 'ASM1';
  rows: LocRow[] = [];
  loadingLocs = false;
  running = false;
  ranAt: Date | null = null;
  query = '';
  filter: '' | 'todo' | 'done' | 'empty' | 'extra' = '';
  sort: 'loc' | 'pctAsc' | 'pctDesc' | 'lines' = 'loc';
  error = '';
  totalLines = 0;
  totalChecked = 0;
  /** Nhóm đang mở xem từng ô */
  openGroups = new Set<string>();
  /** Trang chi tiết: mở ở tab mới khi bấm 1 ô vị trí (?loc=...) */
  detailLoc = '';
  detailItems: LocItem[] = [];
  detailLoading = false;

  /** Mã không kiểm kê (giống Quản lý NVL): đầu R, B033 */
  private static readonly EXCLUDED = ['R', 'B033'];
  private catalogLocs: string[] = [];
  /** Nhóm các dòng chưa ghi vị trí */
  private static readonly NO_LOC = '(CHƯA CÓ VỊ TRÍ)';

  private isNoLoc(loc: string): boolean {
    return String(loc || '').toUpperCase().replace(/\s+/g, '') === KkViTriComponent.NO_LOC.replace(/\s+/g, '');
  }

  constructor(
    private firestore: AngularFirestore,
    private route: ActivatedRoute,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private nvlCatalog: NvlCatalogFullService
  ) {}

  /** Mở ở tab mới thì không có trang trước → về Menu. */
  goBack(): void {
    if (window.history.length > 1) window.history.back();
    else this.goMenu();
  }

  goMenu(): void {
    this.router.navigate(['/menu']);
  }

  ngOnInit(): void {
    const f = String(this.route.snapshot.queryParamMap.get('factory') || '').toUpperCase();
    if (f === 'ASM2') this.factory = 'ASM2';
    const loc = String(this.route.snapshot.queryParamMap.get('loc') || '').trim();
    if (loc) {
      this.detailLoc = this.isNoLoc(loc) ? KkViTriComponent.NO_LOC : this.key(loc);
      void this.loadDetail();
      return;
    }
    void this.loadLocations();
  }

  /** Khóa so khớp: viết hoa, bỏ khoảng trắng; ô kệ J chuẩn hóa (R5-2-1A → R05-2-1A). */
  private key(loc: string): string {
    const k = String(loc || '').toUpperCase().replace(/\s+/g, '');
    return /^R\d/.test(k) ? normalizeJRackLocation(k) : k;
  }

  /** Kệ R19–R28 không chứa nguyên liệu → ẩn, không tính % / tỷ lệ sử dụng. */
  private isIgnoredShelf(loc: string): boolean {
    const m = /^R(\d{2})-/.exec(this.key(loc) + '-');
    return !!m && Number(m[1]) >= 19 && Number(m[1]) <= 28;
  }

  private groupOf(loc: string): string {
    const k = this.key(loc);
    const j = /^([RS]\d{2})-/.exec(k);
    if (j) return j[1];
    if (k.startsWith('LOCKER')) return 'LOCKER';
    if (k.startsWith('BOX')) return 'BOX';
    if (this.isNoLoc(loc)) return 'Chưa có vị trí';
    return 'Khác';
  }

  async loadLocations(): Promise<void> {
    this.loadingLocs = true;
    this.error = '';
    try {
      const snap = await this.firestore.firestore.collection('locations').get();
      this.catalogLocs = [];
      snap.forEach((d) => {
        const loc = String((d.data() as any)?.viTri || '').trim().toUpperCase();
        if (loc) this.catalogLocs.push(loc);
      });
      this.buildBaseRows();
    } catch (e: any) {
      this.error = 'Không đọc được danh mục vị trí: ' + (e?.message || e);
    } finally {
      this.loadingLocs = false;
      this.cdr.detectChanges();
    }
  }

  /** Danh sách gốc theo nhà máy (chưa Run). */
  private buildBaseRows(): void {
    const seen = new Set<string>();
    const rows: LocRow[] = [];
    const add = (loc: string) => {
      const k = this.key(loc);
      if (!k || seen.has(k) || this.isIgnoredShelf(k)) return;
      seen.add(k);
      rows.push({ loc: k, group: this.groupOf(k), inBase: true, lines: 0, checked: 0, codes: 0, pct: null });
    };
    if (this.factory === 'ASM1') {
      // Sơ đồ kho J (giống tab J-Warehouse) + LOCKER trong danh mục
      getLayoutLocationGroups('J').forEach((g) => g.slots.forEach(add));
      this.catalogLocs.filter((l) => this.key(l).startsWith('LOCKER')).forEach(add);
    } else {
      this.catalogLocs.forEach(add);
    }
    this.rows = rows;
    this.openGroups.clear();
  }

  setFactory(f: 'ASM1' | 'ASM2'): void {
    if (this.factory === f || this.running) return;
    this.factory = f;
    this.ranAt = null;
    this.totalLines = 0;
    this.totalChecked = 0;
    this.buildBaseRows();
  }

  /** Bấm 1 ô vị trí → tab mới liệt kê các mã đang để ở đó. */
  openLoc(r: LocRow): void {
    window.open('#/kk-vi-tri?factory=' + encodeURIComponent(this.factory) + '&loc=' + encodeURIComponent(r.loc), '_blank');
  }

  /** Tồn còn lại của 1 dòng (giống cách tính khi Run). */
  private stockOf(d: any): number {
    const opening = d.openingStock != null ? Number(d.openingStock) || 0 : 0;
    return opening + (Number(d.quantity) || 0) - (Number(d.exported) || 0) - (Number(d.xt) || 0);
  }

  /** Vị trí dùng để gom: vị trí đầu tiên của dòng, chưa có → (CHƯA CÓ VỊ TRÍ). */
  private rowLocKey(d: any): string {
    const tokens = splitMultiLocations(String(d.location ?? d.viTri ?? ''));
    return this.key(tokens[0] || '') || KkViTriComponent.NO_LOC;
  }

  private isExcluded(code: string): boolean {
    return !code || KkViTriComponent.EXCLUDED.some((p) => code.startsWith(p));
  }

  async loadDetail(): Promise<void> {
    this.detailLoading = true;
    this.error = '';
    this.cdr.detectChanges();
    try {
      // Tên hàng / ĐVT lấy từ Danh mục NVL (dòng tồn kho nhiều khi không lưu tên)
      const [snap, catalog] = await Promise.all([
        this.firestore.firestore.collection('inventory-materials').where('factory', '==', this.factory).get(),
        this.nvlCatalog.listAll().catch(() => [])
      ]);
      const cat = new Map<string, { materialName?: string; unit?: string }>();
      for (const c of catalog as Array<{ materialCode?: string; materialName?: string; unit?: string }>) cat.set(String(c.materialCode || '').trim().toUpperCase(), c);
      const items: LocItem[] = [];
      snap.forEach((doc) => {
        const d = doc.data() as any;
        const code = String(d.materialCode || '').trim().toUpperCase();
        if (this.isExcluded(code)) return;
        const stock = this.stockOf(d);
        if (!(stock > 1e-6)) return;
        if (this.rowLocKey(d) !== this.detailLoc) return;
        items.push({
          code,
          name: String(cat.get(code)?.materialName || d.materialName || d.name || ''),
          po: String(d.poNumber || ''),
          batch: String(d.batchNumber || ''),
          stock: Math.round(stock * 1000) / 1000,
          unit: String(d.unit || cat.get(code)?.unit || ''),
          checked: d.kkChecked === true || d.kkChecked === 'true'
        });
      });
      items.sort((a, b) => Number(a.checked) - Number(b.checked) || a.code.localeCompare(b.code) || a.po.localeCompare(b.po));
      this.detailItems = items;
      this.ranAt = new Date();
    } catch (e: any) {
      this.error = 'Không đọc được tồn kho: ' + (e?.message || e);
    } finally {
      this.detailLoading = false;
      this.cdr.detectChanges();
    }
  }

  /** In danh sách mã của vị trí đang xem (VD "(CHƯA CÓ VỊ TRÍ)" → danh sách mã chưa có vị trí). */
  printDetail(): void {
    if (!this.detailItems.length) return;
    const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const title = this.detailLoc === KkViTriComponent.NO_LOC ? 'Danh sách mã chưa có vị trí' : 'Danh sách mã tại vị trí ' + this.detailLoc;
    const rows = this.detailItems.map((it, i) => '<tr><td>' + (i + 1) + '</td><td><b>' + esc(it.code) + '</b></td><td class="l">' + esc(it.name)
      + '</td><td>' + esc(it.po) + '</td><td>' + esc(it.batch) + '</td><td class="r">' + it.stock.toLocaleString('en-US')
      + '</td><td>' + esc(it.unit) + '</td><td>' + (it.checked ? '✓' : '') + '</td><td class="w"></td></tr>').join('');
    const now = new Date();
    const html = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>'
      + 'body{font-family:Arial,sans-serif;font-size:12px;margin:12mm}h2{margin:0 0 4px;font-size:18px}p{margin:0 0 10px;color:#444}'
      + 'table{width:100%;border-collapse:collapse}th,td{border:1px solid #888;padding:4px 6px;text-align:center}th{background:#eee}'
      + 'td.l{text-align:left}td.r{text-align:right}td.w{width:90px}thead{display:table-header-group}tr{page-break-inside:avoid}'
      + '@page{size:A4 landscape;margin:8mm}</style></head><body>'
      + '<h2>' + esc(title) + ' · ' + esc(this.factory) + '</h2>'
      + '<p>' + this.detailCodes + ' mã · ' + this.detailItems.length + ' dòng · ' + this.detailChecked + ' dòng đã KK · in lúc '
      + now.toLocaleString('vi-VN') + '</p>'
      + '<table><thead><tr><th>#</th><th>Mã hàng</th><th>Tên hàng</th><th>PO</th><th>IMD / Batch</th><th>Tồn</th><th>ĐVT</th><th>KK</th><th>Vị trí mới</th></tr></thead><tbody>'
      + rows + '</tbody></table></body></html>';
    const w = window.open('', '_blank');
    if (!w) { this.error = 'Trình duyệt chặn cửa sổ in — cho phép popup rồi bấm In lại.'; return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  /** Tải danh sách mã của vị trí đang xem ra Excel. */
  downloadDetail(): void {
    if (!this.detailItems.length) return;
    const rows = this.detailItems.map((it, i) => ({
      '#': i + 1,
      'Mã hàng': it.code,
      'Tên hàng': it.name,
      'PO': it.po,
      'IMD / Batch': it.batch,
      'Tồn': it.stock,
      'ĐVT': it.unit,
      'KK': it.checked ? 'Đã KK' : '',
      'Vị trí': this.detailLoc === KkViTriComponent.NO_LOC ? '' : this.detailLoc
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 5 }, { wch: 12 }, { wch: 70 }, { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 6 }, { wch: 7 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Danh sach ma');
    const d = new Date();
    const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const name = this.detailLoc === KkViTriComponent.NO_LOC ? 'Chua-co-vi-tri' : this.detailLoc.replace(/[^A-Za-z0-9-]/g, '_');
    XLSX.writeFile(wb, 'Ma-' + name + '-' + this.factory + '-' + stamp + '.xlsx');
  }

  get detailChecked(): number {
    return this.detailItems.filter((i) => i.checked).length;
  }

  get detailCodes(): number {
    return new Set(this.detailItems.map((i) => i.code)).size;
  }

  get detailPct(): number {
    return this.detailItems.length ? Math.round((this.detailChecked / this.detailItems.length) * 1000) / 10 : 0;
  }

  /** Đọc tồn kho nhà máy → % KK từng vị trí (dòng đã tick KK / tổng dòng còn tồn). */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.error = '';
    this.cdr.detectChanges();
    try {
      this.buildBaseRows();
      const snap = await this.firestore.firestore.collection('inventory-materials')
        .where('factory', '==', this.factory).get();
      const agg = new Map<string, { loc: string; lines: number; checked: number; codes: Set<string> }>();
      snap.forEach((doc) => {
        const d = doc.data() as any;
        const code = String(d.materialCode || '').trim().toUpperCase();
        if (this.isExcluded(code)) return;
        if (!(this.stockOf(d) > 1e-6)) return;
        const loc = this.rowLocKey(d);
        if (this.isIgnoredShelf(loc)) return;
        const a = agg.get(loc) || { loc, lines: 0, checked: 0, codes: new Set<string>() };
        a.lines++;
        if (d.kkChecked === true || d.kkChecked === 'true') a.checked++;
        a.codes.add(code);
        agg.set(loc, a);
      });
      const pct = (a: { lines: number; checked: number }) => Math.round((a.checked / a.lines) * 1000) / 10;
      const byKey = new Map(this.rows.map((r) => [r.loc, r]));
      const out: LocRow[] = this.rows.map((r) => {
        const a = agg.get(r.loc);
        return a ? { ...r, lines: a.lines, checked: a.checked, codes: a.codes.size, pct: pct(a) } : r;
      });
      // Vị trí đang có hàng nhưng không có trong danh sách gốc → luôn hiện
      agg.forEach((a, k) => {
        if (byKey.has(k)) return;
        out.push({ loc: a.loc, group: this.groupOf(a.loc), inBase: false, lines: a.lines, checked: a.checked, codes: a.codes.size, pct: pct(a) });
      });
      this.rows = out;
      this.totalLines = out.reduce((s, r) => s + r.lines, 0);
      this.totalChecked = out.reduce((s, r) => s + r.checked, 0);
      this.ranAt = new Date();
    } catch (e: any) {
      this.error = 'Không đọc được tồn kho: ' + (e?.message || e);
    } finally {
      this.running = false;
      this.cdr.detectChanges();
    }
  }

  get totalPct(): number {
    return this.totalLines ? Math.round((this.totalChecked / this.totalLines) * 1000) / 10 : 0;
  }

  /** Tỷ lệ sử dụng vị trí toàn nhà máy (chỉ tính ô trong sơ đồ / danh mục). */
  get usage(): { slots: number; used: number; pct: number } {
    const base = this.rows.filter((r) => r.inBase);
    const used = base.filter((r) => r.lines > 0).length;
    return { slots: base.length, used, pct: base.length ? Math.round((used / base.length) * 1000) / 10 : 0 };
  }

  get counts() {
    const withStock = this.rows.filter((r) => r.lines > 0);
    return {
      all: this.rows.length,
      withStock: withStock.length,
      done: withStock.filter((r) => r.checked === r.lines).length,
      todo: withStock.filter((r) => r.checked < r.lines).length,
      empty: this.rows.filter((r) => r.inBase && r.lines === 0).length,
      extra: this.rows.filter((r) => !r.inBase).length
    };
  }

  private get filteredRows(): LocRow[] {
    const q = this.query.trim().toUpperCase().replace(/\s+/g, '');
    let r = this.rows.filter((x) => !q || x.loc.includes(q) || x.group.toUpperCase().includes(q));
    if (this.ranAt) {
      if (this.filter === 'todo') r = r.filter((x) => x.lines > 0 && x.checked < x.lines);
      else if (this.filter === 'done') r = r.filter((x) => x.lines > 0 && x.checked === x.lines);
      else if (this.filter === 'empty') r = r.filter((x) => x.inBase && x.lines === 0);
      else if (this.filter === 'extra') r = r.filter((x) => !x.inBase);
    }
    return r;
  }

  /** Gom theo dãy kệ: R01, R02… S01… rồi LOCKER, BOX, Khác, Chưa có vị trí. */
  get groups(): LocGroup[] {
    const byLoc = (a: LocRow, b: LocRow) => a.loc.localeCompare(b.loc, 'en', { numeric: true });
    const map = new Map<string, LocRow[]>();
    for (const r of this.filteredRows) {
      const list = map.get(r.group) || [];
      list.push(r);
      map.set(r.group, list);
    }
    const order = (k: string) => (/^R\d/.test(k) ? 0 : /^S\d/.test(k) ? 1 : k === 'LOCKER' ? 2 : k === 'BOX' ? 3 : k === 'Khác' ? 4 : 5);
    const groups = [...map.entries()].map(([key, rows]) => {
      const lines = rows.reduce((s, r) => s + r.lines, 0);
      const checked = rows.reduce((s, r) => s + r.checked, 0);
      const pctOf = (x: LocRow) => (x.pct == null ? 999 : x.pct);
      const sorted = this.sort === 'pctAsc' ? [...rows].sort((a, b) => pctOf(a) - pctOf(b) || byLoc(a, b))
        : this.sort === 'pctDesc' ? [...rows].sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || byLoc(a, b))
        : this.sort === 'lines' ? [...rows].sort((a, b) => b.lines - a.lines || byLoc(a, b))
        : [...rows].sort(byLoc);
      const slots = rows.filter((r) => r.inBase).length;
      const usedSlots = rows.filter((r) => r.inBase && r.lines > 0).length;
      return {
        key, rows: sorted, lines, checked, pct: lines ? Math.round((checked / lines) * 1000) / 10 : null,
        slots, usedSlots, usePct: slots ? Math.round((usedSlots / slots) * 1000) / 10 : null
      };
    });
    groups.sort((a, b) => order(a.key) - order(b.key) || a.key.localeCompare(b.key, 'en', { numeric: true }));
    if (this.sort === 'pctAsc') groups.sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999));
    else if (this.sort === 'pctDesc') groups.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
    else if (this.sort === 'lines') groups.sort((a, b) => b.lines - a.lines);
    return groups;
  }

  isOpen(key: string): boolean {
    // Đang tìm / lọc thì mở sẵn để thấy ô khớp
    return this.openGroups.has(key) || !!this.query.trim();
  }

  toggleGroup(key: string): void {
    if (this.openGroups.has(key)) this.openGroups.delete(key);
    else this.openGroups.add(key);
  }

  trackByKey(_i: number, g: LocGroup): string {
    return g.key;
  }

  trackByLoc(_i: number, r: LocRow): string {
    return r.loc;
  }
}
