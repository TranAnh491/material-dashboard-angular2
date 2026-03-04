import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import * as XLSX from 'xlsx';

export interface SxxkRow {
  id?: string;
  maNVL: string;
  tonDauE31: number;
  tonDauND: number;
  nkE31: number;
  nkND: number;
  pnE31: number;
  pnND: number;
  pxE31: number;
  pxND: number;
  tieuHuyE31: number;
  tieuHuyND: number;
  tonCuoiE31: number;
  tonCuoiND: number;
  tonBCTK: number;
  ssBCTK: number;
  year?: number;
  month?: number;
  updatedAt?: Date;
}

export interface SxxkTab {
  key: string;        // 'tong-hop' hoặc key của importType
  label: string;
  icon: string;
  importKey?: string; // key dùng để import
  columns: { field: keyof SxxkRow | 'stt' | 'action'; header: string; color?: string }[];
}

const TABS: SxxkTab[] = [
  {
    key: 'tong-hop', label: 'Tổng hợp', icon: 'table_chart',
    columns: [
      { field: 'stt',        header: 'STT' },
      { field: 'maNVL',      header: 'Mã NVL' },
      { field: 'tonDauE31',  header: 'Tồn đầu E31',  color: '#bbdefb' },
      { field: 'tonDauND',   header: 'Tồn đầu ND',   color: '#bbdefb' },
      { field: 'nkE31',      header: 'NK E31',        color: '#c8e6c9' },
      { field: 'nkND',       header: 'NK ND',         color: '#c8e6c9' },
      { field: 'pnE31',      header: 'PN E31',        color: '#b2ebf2' },
      { field: 'pnND',       header: 'PN ND',         color: '#b2ebf2' },
      { field: 'pxE31',      header: 'PX E31',        color: '#ffe0b2' },
      { field: 'pxND',       header: 'PX ND',         color: '#ffe0b2' },
      { field: 'tieuHuyE31', header: 'TIEUHUY E31',   color: '#e1bee7' },
      { field: 'tieuHuyND',  header: 'TIEUHUY ND',    color: '#e1bee7' },
      { field: 'tonCuoiE31', header: 'Tồn cuối E31',  color: '#cfd8dc' },
      { field: 'tonCuoiND',  header: 'Tồn cuối ND',   color: '#cfd8dc' },
      { field: 'tonBCTK',    header: 'Tồn BCTK',      color: '#fce4ec' },
      { field: 'ssBCTK',     header: 'SS BCTK',       color: '#fce4ec' },
      { field: 'action',     header: '' },
    ]
  },
  {
    key: 'ton-dau-sxxk', label: 'Tồn Đầu SXXK', icon: 'inventory', importKey: 'ton-dau-sxxk',
    columns: [
      { field: 'stt',       header: 'STT' },
      { field: 'maNVL',     header: 'Mã NVL' },
      { field: 'tonDauE31', header: 'Tồn đầu E31', color: '#bbdefb' },
      { field: 'tonDauND',  header: 'Tồn đầu ND',  color: '#bbdefb' },
      { field: 'action',    header: '' },
    ]
  },
  {
    key: 'bk-xnvl', label: 'BK XNVL', icon: 'exit_to_app', importKey: 'bk-xnvl',
    columns: [
      { field: 'stt',    header: 'STT' },
      { field: 'maNVL',  header: 'Mã NVL' },
      { field: 'pxE31',  header: 'PX E31', color: '#ffe0b2' },
      { field: 'pxND',   header: 'PX ND',  color: '#ffe0b2' },
      { field: 'action', header: '' },
    ]
  },
  {
    key: 'bk-nnvl', label: 'BK NNVL', icon: 'input', importKey: 'bk-nnvl',
    columns: [
      { field: 'stt',   header: 'STT' },
      { field: 'maNVL', header: 'Mã NVL' },
      { field: 'nkE31', header: 'NK E31', color: '#c8e6c9' },
      { field: 'nkND',  header: 'NK ND',  color: '#c8e6c9' },
      { field: 'pnE31', header: 'PN E31', color: '#b2ebf2' },
      { field: 'pnND',  header: 'PN ND',  color: '#b2ebf2' },
      { field: 'action', header: '' },
    ]
  },
  {
    key: 'tieu-huy', label: 'TIEUHUY', icon: 'delete_forever', importKey: 'tieu-huy',
    columns: [
      { field: 'stt',        header: 'STT' },
      { field: 'maNVL',      header: 'Mã NVL' },
      { field: 'tieuHuyE31', header: 'TIEUHUY E31', color: '#e1bee7' },
      { field: 'tieuHuyND',  header: 'TIEUHUY ND',  color: '#e1bee7' },
      { field: 'action',     header: '' },
    ]
  },
  {
    key: 'chuyen-kho', label: 'Chuyển Kho', icon: 'swap_horiz', importKey: 'chuyen-kho',
    columns: [
      { field: 'stt',    header: 'STT' },
      { field: 'maNVL',  header: 'Mã NVL' },
      { field: 'pnE31',  header: 'PN E31 (CK)', color: '#b2ebf2' },
      { field: 'pnND',   header: 'PN ND (CK)',  color: '#b2ebf2' },
      { field: 'action', header: '' },
    ]
  },
  {
    key: 'bctk', label: 'BCTK', icon: 'analytics', importKey: 'bctk',
    columns: [
      { field: 'stt',       header: 'STT' },
      { field: 'maNVL',     header: 'Mã NVL' },
      { field: 'tonCuoiE31',header: 'Tồn cuối E31', color: '#cfd8dc' },
      { field: 'tonCuoiND', header: 'Tồn cuối ND',  color: '#cfd8dc' },
      { field: 'tonBCTK',   header: 'Tồn BCTK',     color: '#fce4ec' },
      { field: 'ssBCTK',    header: 'SS BCTK',       color: '#fce4ec' },
      { field: 'action',    header: '' },
    ]
  },
  {
    key: 'cn-vn', label: 'CN-VN', icon: 'person', importKey: 'cn-vn',
    columns: [
      { field: 'stt',    header: 'STT' },
      { field: 'maNVL',  header: 'Mã NVL' },
      { field: 'action', header: '' },
    ]
  },
];

@Component({
  selector: 'app-sxxk',
  templateUrl: './sxxk.component.html',
  styleUrls: ['./sxxk.component.scss']
})
export class SxxkComponent implements OnInit {

  tabs = TABS;
  activeTabKey = 'tong-hop';

  get activeTab(): SxxkTab {
    return this.tabs.find(t => t.key === this.activeTabKey) || this.tabs[0];
  }

  // ── dữ liệu ─────────────────────────────────────────────────────
  rows: SxxkRow[] = [];
  filteredRows: SxxkRow[] = [];

  // ── filter ──────────────────────────────────────────────────────
  searchTerm = '';
  yearFilter  = new Date().getFullYear();
  monthFilter = new Date().getMonth() + 1;
  years  = [2023, 2024, 2025, 2026];
  months = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `Tháng ${i + 1}` }));

  // ── import ──────────────────────────────────────────────────────
  isLoading = false;
  savedMsg  = '';

  constructor(private firestore: AngularFirestore, private router: Router) {}

  goMenu(): void { this.router.navigate(['/menu']); }

  ngOnInit(): void { this.loadData(); }

  // ── load ────────────────────────────────────────────────────────
  async loadData(): Promise<void> {
    this.isLoading = true;
    try {
      const snap = await this.firestore.collection('sxxk-data').get().toPromise();
      this.rows = (snap?.docs || []).map(d => ({ id: d.id, ...(d.data() as any) } as SxxkRow));
      this.filterRows();
    } catch (e) {
      console.error('[SXXK] Load error:', e);
    } finally {
      this.isLoading = false;
    }
  }

  filterRows(): void {
    this.filteredRows = this.rows.filter(r => {
      const matchSearch = !this.searchTerm ||
        r.maNVL.toLowerCase().includes(this.searchTerm.toLowerCase());
      const matchYear  = !this.yearFilter  || r.year  === this.yearFilter;
      const matchMonth = !this.monthFilter || r.month === this.monthFilter;
      return matchSearch && matchYear && matchMonth;
    });
  }

  // ── import ──────────────────────────────────────────────────────
  onFileSelected(event: Event, importType: string): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.isLoading = true;
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const wb  = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        const ws  = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1 });
        this.processImport(importType, raw);
      } catch (err) {
        alert('Lỗi đọc file: ' + (err as Error).message);
      } finally {
        this.isLoading = false;
        (event.target as HTMLInputElement).value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  }

  private processImport(type: string, raw: any[][]): void {
    if (raw.length < 2) { alert('File không có dữ liệu.'); return; }
    const headerRow = (raw[0] || []).map((h: any) => String(h ?? '').trim().toLowerCase());
    const dataRows  = raw.slice(1);
    const idx = (names: string[]): number =>
      names.map(n => headerRow.indexOf(n)).find(i => i >= 0) ?? -1;
    let imported = 0;

    if (type === 'ton-dau-sxxk') {
      const iMa = idx(['mã nvl','ma nvl','materialcode','mã vật tư']);
      const iE31 = idx(['tồn đầu e31','ton dau e31','e31']);
      const iND  = idx(['tồn đầu nd','ton dau nd','nd']);
      for (const row of dataRows) {
        const maNVL = String(row[iMa < 0 ? 0 : iMa] ?? '').trim();
        if (!maNVL) continue;
        this.upsertField(maNVL, 'tonDauE31', Number(row[iE31 < 0 ? 1 : iE31]) || 0);
        this.upsertField(maNVL, 'tonDauND',  Number(row[iND  < 0 ? 2 : iND ]) || 0);
        imported++;
      }
    } else if (type === 'bk-xnvl') {
      const iMa = idx(['mã nvl','ma nvl','materialcode']);
      const iE31 = idx(['px e31','pxe31']); const iND = idx(['px nd','pxnd']);
      for (const row of dataRows) {
        const maNVL = String(row[iMa < 0 ? 0 : iMa] ?? '').trim();
        if (!maNVL) continue;
        this.upsertField(maNVL, 'pxE31', Number(row[iE31 < 0 ? 1 : iE31]) || 0);
        this.upsertField(maNVL, 'pxND',  Number(row[iND  < 0 ? 2 : iND ]) || 0);
        imported++;
      }
    } else if (type === 'bk-nnvl') {
      const iMa = idx(['mã nvl','ma nvl','materialcode']);
      const iNkE = idx(['nk e31','nke31']); const iNkN = idx(['nk nd','nknd']);
      const iPnE = idx(['pn e31','pne31']); const iPnN = idx(['pn nd','pnnd']);
      for (const row of dataRows) {
        const maNVL = String(row[iMa < 0 ? 0 : iMa] ?? '').trim();
        if (!maNVL) continue;
        this.upsertField(maNVL, 'nkE31', Number(row[iNkE < 0 ? 1 : iNkE]) || 0);
        this.upsertField(maNVL, 'nkND',  Number(row[iNkN < 0 ? 2 : iNkN]) || 0);
        this.upsertField(maNVL, 'pnE31', Number(row[iPnE < 0 ? 3 : iPnE]) || 0);
        this.upsertField(maNVL, 'pnND',  Number(row[iPnN < 0 ? 4 : iPnN]) || 0);
        imported++;
      }
    } else if (type === 'tieu-huy') {
      const iMa = idx(['mã nvl','ma nvl','materialcode']);
      const iE31 = idx(['tieuhuy e31','tiêu hủy e31','e31']);
      const iND  = idx(['tieuhuy nd','tiêu hủy nd','nd']);
      for (const row of dataRows) {
        const maNVL = String(row[iMa < 0 ? 0 : iMa] ?? '').trim();
        if (!maNVL) continue;
        this.upsertField(maNVL, 'tieuHuyE31', Number(row[iE31 < 0 ? 1 : iE31]) || 0);
        this.upsertField(maNVL, 'tieuHuyND',  Number(row[iND  < 0 ? 2 : iND ]) || 0);
        imported++;
      }
    } else if (type === 'bctk') {
      const iMa  = idx(['mã nvl','ma nvl','materialcode']);
      const iTon = idx(['tồn bctk','ton bctk','tồn kho','ton kho']);
      for (const row of dataRows) {
        const maNVL = String(row[iMa < 0 ? 0 : iMa] ?? '').trim();
        if (!maNVL) continue;
        this.upsertField(maNVL, 'tonBCTK', Number(row[iTon < 0 ? 1 : iTon]) || 0);
        imported++;
      }
    } else {
      for (const row of dataRows) {
        const maNVL = String(row[0] ?? '').trim();
        if (!maNVL) continue;
        imported++;
      }
    }

    this.rows.forEach(r => this.recalc(r));
    this.filterRows();
    this.saveToFirebase();
    const label = TABS.find(t => t.importKey === type)?.label || type;
    alert(`✅ Đã import ${imported} dòng từ ${label}.`);
  }

  private upsertField(maNVL: string, field: keyof SxxkRow, value: number): void {
    let row = this.rows.find(r => r.maNVL.trim().toUpperCase() === maNVL.toUpperCase());
    if (!row) { row = this.emptyRow(maNVL); this.rows.push(row); }
    (row as any)[field] = value;
  }

  private emptyRow(maNVL: string): SxxkRow {
    return {
      maNVL, tonDauE31: 0, tonDauND: 0, nkE31: 0, nkND: 0,
      pnE31: 0, pnND: 0, pxE31: 0, pxND: 0, tieuHuyE31: 0, tieuHuyND: 0,
      tonCuoiE31: 0, tonCuoiND: 0, tonBCTK: 0, ssBCTK: 0,
      year: this.yearFilter, month: this.monthFilter, updatedAt: new Date()
    };
  }

  private recalc(r: SxxkRow): void {
    r.tonCuoiE31 = (r.tonDauE31||0)+(r.nkE31||0)+(r.pnE31||0)-(r.pxE31||0)-(r.tieuHuyE31||0);
    r.tonCuoiND  = (r.tonDauND ||0)+(r.nkND ||0)+(r.pnND ||0)-(r.pxND ||0)-(r.tieuHuyND ||0);
    r.ssBCTK     = (r.tonBCTK  ||0) - (r.tonCuoiE31 + r.tonCuoiND);
  }

  // ── lưu Firebase ─────────────────────────────────────────────────
  async saveToFirebase(): Promise<void> {
    try {
      const batch = this.firestore.firestore.batch();
      for (const row of this.rows) {
        const docRef = row.id
          ? this.firestore.collection('sxxk-data').doc(row.id).ref
          : this.firestore.collection('sxxk-data').doc().ref;
        if (!row.id) row.id = docRef.id;
        batch.set(docRef, { ...row, updatedAt: new Date() });
      }
      await batch.commit();
      this.savedMsg = '✅ Đã lưu';
      setTimeout(() => this.savedMsg = '', 3000);
    } catch (e) { console.error('[SXXK] Save error:', e); }
  }

  // ── xóa dòng ────────────────────────────────────────────────────
  async deleteRow(row: SxxkRow): Promise<void> {
    if (!confirm(`Xóa dòng ${row.maNVL}?`)) return;
    if (row.id) await this.firestore.collection('sxxk-data').doc(row.id).delete();
    this.rows = this.rows.filter(r => r !== row);
    this.filterRows();
  }

  // ── xuất Excel ──────────────────────────────────────────────────
  exportExcel(): void {
    const cols = this.activeTab.columns.filter(c => c.field !== 'stt' && c.field !== 'action');
    const headers = cols.map(c => c.header);
    const data = [
      headers,
      ...this.filteredRows.map(r => cols.map(c => (r as any)[c.field] ?? ''))
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, this.activeTab.label);
    XLSX.writeFile(wb, `SXXK_${this.activeTab.label}_${this.yearFilter}_T${this.monthFilter}.xlsx`);
  }

  // ── tải form mẫu ────────────────────────────────────────────────
  downloadTemplate(type: string): void {
    const templates: Record<string, any[][]> = {
      'ton-dau-sxxk': [['Mã NVL','Tồn đầu E31','Tồn đầu ND'],['B001',100,50]],
      'bk-xnvl':      [['Mã NVL','PX E31','PX ND'],['B001',80,40]],
      'bk-nnvl':      [['Mã NVL','NK E31','NK ND','PN E31','PN ND'],['B001',200,100,150,75]],
      'tieu-huy':     [['Mã NVL','TIEUHUY E31','TIEUHUY ND'],['B001',5,2]],
      'chuyen-kho':   [['Mã NVL','Số lượng E31','Số lượng ND'],['B001',10,5]],
      'bctk':         [['Mã NVL','Tồn BCTK'],['B001',300]],
      'cn-vn':        [['Mã NVL','Giá trị'],['B001',0]],
    };
    const ws = XLSX.utils.aoa_to_sheet(templates[type] || [['Mã NVL']]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    const label = TABS.find(t => t.importKey === type)?.label || type;
    XLSX.writeFile(wb, `Form_${label.replace(/\s+/g,'_')}.xlsx`);
  }

  // ── helpers ─────────────────────────────────────────────────────
  cellValue(row: SxxkRow, field: string): string {
    if (field === 'stt' || field === 'action') return '';
    const v = (row as any)[field];
    if (field === 'maNVL') return v ?? '';
    if (v === 0 || v == null) return '';
    return Number(v).toLocaleString('vi-VN');
  }

  isSsBCTK(field: string): boolean { return field === 'ssBCTK'; }
  isResult(field: string): boolean { return field === 'tonCuoiE31' || field === 'tonCuoiND'; }

  sum(field: keyof SxxkRow): string {
    const s = this.filteredRows.reduce((acc, r) => acc + (Number((r as any)[field]) || 0), 0);
    return s === 0 ? '' : s.toLocaleString('vi-VN');
  }

  get totalRows(): number { return this.filteredRows.length; }

  colCount(): number { return this.activeTab.columns.length; }
}
