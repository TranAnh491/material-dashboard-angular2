import { Component, OnInit } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

export type ShortedShortageLevel = 'high' | 'medium' | 'low';

export interface ShortedMaterialRow {
  id: string;
  materialCode: string;
  gw: string;
  gwQty: number | null;
  notes: string;
}

@Component({
  selector: 'app-shorted-materials',
  templateUrl: './shorted-materials.component.html',
  styleUrls: ['./shorted-materials.component.scss']
})
export class ShortedMaterialsComponent implements OnInit {
  private readonly storageKey = 'shortedMaterials_v2';
  private readonly legacyKey = 'shortedMaterials_v1';

  rows: ShortedMaterialRow[] = [];
  bulkPanelOpen = false;
  bulkText = '';

  searchText = '';
  filterGw = '';
  filterStatus: '' | ShortedShortageLevel = '';

  currentPage = 1;
  pageSize = 10;
  readonly pageSizeOptions = [5, 10, 20, 50];

  lastUpdatedAt: Date | null = null;

  constructor(private snackBar: MatSnackBar) {}

  ngOnInit(): void {
    this.loadFromStorage();
    if (this.rows.length === 0) {
      this.addRow();
    }
  }

  get dataRows(): ShortedMaterialRow[] {
    return this.rows.filter((r) => r.materialCode.trim() || r.gw.trim());
  }

  /** Bảng: dòng có dữ liệu + tối đa một dòng trống cuối để nhập tiếp */
  get visibleRows(): ShortedMaterialRow[] {
    return this.rows.filter((r, idx) => {
      const has =
        r.materialCode.trim() ||
        r.gw.trim() ||
        (r.notes || '').trim() ||
        (r.gwQty != null && !Number.isNaN(Number(r.gwQty)) && Number(r.gwQty) > 0);
      if (has) {
        return true;
      }
      return idx === this.rows.length - 1;
    });
  }

  get filteredRows(): ShortedMaterialRow[] {
    const q = this.searchText.trim().toLowerCase();
    return this.visibleRows.filter((r) => {
      const mc = r.materialCode.trim().toLowerCase();
      const gw = r.gw.trim().toLowerCase();
      if (q && !mc.includes(q) && !gw.includes(q)) {
        return false;
      }
      if (this.filterGw && r.gw.trim() !== this.filterGw) {
        return false;
      }
      if (this.filterStatus) {
        const lvl = this.shortageLevel(r.gwQty);
        if (lvl !== this.filterStatus) {
          return false;
        }
      }
      return true;
    });
  }

  get gwOptions(): string[] {
    const set = new Set<string>();
    this.dataRows.forEach((r) => {
      const g = r.gw.trim();
      if (g) {
        set.add(g);
      }
    });
    return Array.from(set).sort();
  }

  get pagedRows(): ShortedMaterialRow[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredRows.slice(start, start + this.pageSize);
  }

  get totalFiltered(): number {
    return this.filteredRows.length;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalFiltered / this.pageSize));
  }

  get pageList(): number[] {
    const t = this.totalPages;
    const c = this.currentPage;
    const win = 5;
    let start = Math.max(1, c - Math.floor(win / 2));
    let end = Math.min(t, start + win - 1);
    start = Math.max(1, end - win + 1);
    const arr: number[] = [];
    for (let i = start; i <= end; i++) {
      arr.push(i);
    }
    return arr;
  }

  get displayFrom(): number {
    if (this.totalFiltered === 0) {
      return 0;
    }
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get displayTo(): number {
    return Math.min(this.currentPage * this.pageSize, this.totalFiltered);
  }

  get statTotalRows(): number {
    return this.dataRows.length;
  }

  get statDistinctGw(): number {
    return this.gwOptions.length;
  }

  get statTotalQty(): number {
    return this.dataRows.reduce((s, r) => s + (Number(r.gwQty) > 0 ? Number(r.gwQty) : 0), 0);
  }

  get lastUpdatedLabel(): string {
    if (!this.lastUpdatedAt) {
      return '—';
    }
    const d = this.lastUpdatedAt;
    const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const date = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    return `${t} ${date}`;
  }

  shortageLevel(qty: number | null): ShortedShortageLevel {
    const n = Number(qty);
    if (Number.isNaN(n) || n <= 0) {
      return 'low';
    }
    if (n >= 100) {
      return 'high';
    }
    if (n >= 25) {
      return 'medium';
    }
    return 'low';
  }

  statusLabel(level: ShortedShortageLevel): string {
    if (level === 'high') {
      return 'Thiếu nhiều';
    }
    if (level === 'medium') {
      return 'Thiếu vừa';
    }
    return 'Thiếu ít';
  }

  formatQty(q: number | null): string {
    const n = Number(q);
    if (Number.isNaN(n) || q === null) {
      return '—';
    }
    return new Intl.NumberFormat('vi-VN').format(n);
  }

  private newId(): string {
    return `sm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  addRow(): void {
    this.rows.push({ id: this.newId(), materialCode: '', gw: '', gwQty: null, notes: '' });
  }

  removeRow(id: string): void {
    this.rows = this.rows.filter((r) => r.id !== id);
    if (this.rows.length === 0) {
      this.addRow();
    }
    this.clampPage();
    this.bumpUpdated();
    this.persist();
  }

  onFieldChange(): void {
    this.ensureEditableTail();
    this.persist();
  }

  onMaterialBlur(row: ShortedMaterialRow): void {
    row.materialCode = (row.materialCode || '').trim().toUpperCase();
    this.ensureEditableTail();
    this.bumpUpdated();
    this.persist();
  }

  onGwBlur(row: ShortedMaterialRow): void {
    row.gw = (row.gw || '').trim().toUpperCase();
    this.ensureEditableTail();
    this.bumpUpdated();
    this.persist();
  }

  onQtyBlur(): void {
    this.bumpUpdated();
    this.persist();
  }

  onNotesBlur(): void {
    this.bumpUpdated();
    this.persist();
  }

  openBulkPanel(): void {
    this.bulkText = '';
    this.bulkPanelOpen = true;
  }

  closeBulkPanel(): void {
    this.bulkPanelOpen = false;
    this.bulkText = '';
  }

  applyBulkList(): void {
    const parsed = this.parseBulkLines(this.bulkText);
    for (const item of parsed) {
      const key = `${item.materialCode}|${item.gw}`;
      const existing = this.dataRows.find(
        (r) => `${r.materialCode.trim().toUpperCase()}|${r.gw.trim().toUpperCase()}` === key
      );
      if (existing) {
        existing.gwQty = (Number(existing.gwQty) || 0) + item.qty;
        if (item.notes && !existing.notes.trim()) {
          existing.notes = item.notes;
        }
      } else {
        this.rows.push({
          id: this.newId(),
          materialCode: item.materialCode,
          gw: item.gw,
          gwQty: item.qty,
          notes: item.notes || ''
        });
      }
    }
    this.ensureEditableTail();
    this.bumpUpdated();
    this.persist();
    this.closeBulkPanel();
    this.currentPage = 1;
    this.snackBar.open(`Đã thêm ${parsed.length} dòng`, 'Đóng', { duration: 2500 });
  }

  refresh(): void {
    this.loadFromStorage();
    this.ensureEditableTail();
    this.clampPage();
    this.snackBar.open('Đã làm mới', 'Đóng', { duration: 1500 });
  }

  viewRow(row: ShortedMaterialRow): void {
    const msg = `Mã: ${row.materialCode || '—'} · GW: ${row.gw || '—'} · QTY: ${this.formatQty(row.gwQty)} · ${row.notes || 'Không ghi chú'}`;
    this.snackBar.open(msg, 'Đóng', { duration: 5000 });
  }

  onSearchChange(): void {
    this.currentPage = 1;
  }

  onFilterChange(): void {
    this.currentPage = 1;
  }

  setPage(p: number): void {
    this.currentPage = Math.min(Math.max(1, p), this.totalPages);
  }

  prevPage(): void {
    this.setPage(this.currentPage - 1);
  }

  nextPage(): void {
    this.setPage(this.currentPage + 1);
  }

  onPageSizeChange(): void {
    this.currentPage = 1;
  }

  rowDisplayIndex(i: number): number {
    return (this.currentPage - 1) * this.pageSize + i + 1;
  }

  private clampPage(): void {
    if (this.currentPage > this.totalPages) {
      this.currentPage = this.totalPages;
    }
    if (this.currentPage < 1) {
      this.currentPage = 1;
    }
  }

  private parseBulkLines(raw: string): Array<{ materialCode: string; gw: string; qty: number; notes: string }> {
    const out: Array<{ materialCode: string; gw: string; qty: number; notes: string }> = [];
    const lines = raw.split(/\r?\n/);
    const isNum = (s: string) => /^-?\d+([.,]\d+)?$/.test(s.trim());

    for (let line of lines) {
      line = line.trim();
      if (!line) {
        continue;
      }
      const parts = line.split(/[\t,;]+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length === 0) {
        continue;
      }
      let materialCode = parts[0].toUpperCase();
      let gw = '';
      let qty = 1;
      let notes = '';

      if (parts.length === 1) {
        // only code
      } else if (parts.length === 2) {
        if (isNum(parts[1])) {
          qty = parseFloat(parts[1].replace(',', '.')) || 1;
        } else {
          gw = parts[1].toUpperCase();
        }
      } else {
        gw = parts[1].toUpperCase();
        qty = parseFloat(parts[2].replace(',', '.')) || 1;
        if (parts.length > 3) {
          notes = parts.slice(3).join(' ');
        }
      }
      out.push({ materialCode, gw, qty, notes });
    }
    return out;
  }

  private ensureEditableTail(): void {
    const hasBlank = this.rows.some((r) => !r.materialCode.trim() && !r.gw.trim());
    if (!hasBlank) {
      this.rows.push({ id: this.newId(), materialCode: '', gw: '', gwQty: null, notes: '' });
    }
  }

  private bumpUpdated(): void {
    this.lastUpdatedAt = new Date();
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const pack = JSON.parse(raw) as {
          rows?: Array<{ materialCode?: string; gw?: string; gwQty?: number; notes?: string }>;
          updatedAt?: string;
        };
        if (pack?.rows && Array.isArray(pack.rows)) {
          this.rows = pack.rows.map((x) => ({
            id: this.newId(),
            materialCode: String(x.materialCode || '').trim().toUpperCase(),
            gw: String(x.gw || '').trim().toUpperCase(),
            gwQty: x.gwQty != null && !Number.isNaN(Number(x.gwQty)) ? Number(x.gwQty) : null,
            notes: String(x.notes || '')
          }));
          if (pack.updatedAt) {
            this.lastUpdatedAt = new Date(pack.updatedAt);
          }
          this.ensureEditableTail();
          return;
        }
      }
      const legacy = localStorage.getItem(this.legacyKey);
      if (legacy) {
        const data = JSON.parse(legacy) as Array<{ gw?: string; gwQty?: number }>;
        if (Array.isArray(data)) {
          this.rows = data
            .filter((x) => x && typeof x.gw === 'string' && x.gw.trim())
            .map((x) => ({
              id: this.newId(),
              materialCode: String(x.gw).trim().toUpperCase(),
              gw: '',
              gwQty: x.gwQty != null && !Number.isNaN(Number(x.gwQty)) ? Number(x.gwQty) : null,
              notes: ''
            }));
        }
      }
    } catch {
      this.rows = [];
    }
    this.ensureEditableTail();
  }

  private persist(): void {
    try {
      let prevUpdated: string | undefined;
      try {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) {
          prevUpdated = JSON.parse(raw).updatedAt;
        }
      } catch {
        /* ignore */
      }
      const rows = this.dataRows.map((r) => ({
        materialCode: r.materialCode.trim().toUpperCase(),
        gw: r.gw.trim().toUpperCase(),
        gwQty: Number(r.gwQty) >= 0 ? Number(r.gwQty) : 0,
        notes: (r.notes || '').trim()
      }));
      const updatedAt = this.lastUpdatedAt?.toISOString() ?? prevUpdated;
      const pack: { rows: typeof rows; updatedAt?: string } = { rows };
      if (updatedAt) {
        pack.updatedAt = updatedAt;
      }
      localStorage.setItem(this.storageKey, JSON.stringify(pack));
    } catch {
      /* ignore */
    }
  }
}
