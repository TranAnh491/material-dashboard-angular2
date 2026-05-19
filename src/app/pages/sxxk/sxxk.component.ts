import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireStorage } from '@angular/fire/compat/storage';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import * as XLSX from 'xlsx';

/** Một dòng bảng SXXK 2026 (cột A–AJ) */
export interface SxxkRow {
  id?: string;
  maNVL: string;
  // Tồn đầu (C–H)
  totalTonDauSL: number;
  totalTonDauValue: number;
  tonDauE31SL: number;
  tonDauE31Value: number;
  tonDauKhacSL: number;
  tonDauKhacValue: number;
  // NK (I–N)
  totalNkSL: number;
  totalNkValue: number;
  nkE31SL: number;
  nkE31Value: number;
  nkKhacSL: number;
  nkKhacValue: number;
  // PN (O–T)
  totalPnSL: number;
  totalPnValue: number;
  pnE31SL: number;
  pnE31Value: number;
  pnKhacSL: number;
  pnKhacValue: number;
  // PX (U–Z)
  totalPxSL: number;
  totalPxValue: number;
  pxE31SL: number;
  pxE31Value: number;
  pxKhacSL: number;
  pxKhacValue: number;
  // Tồn kho (AA–AF)
  totalTonKhoSL: number;
  totalTonKhoValue: number;
  tonKhoE31SL: number;
  tonKhoE31Value: number;
  tonKhoKhacSL: number;
  tonKhoKhacValue: number;
  // BCTK & chênh lệch (AG–AJ)
  bctkSL: number;
  bctkValue: number;
  chenhLechSL: number;
  chenhLechValue: number;
  year?: number;
  updatedAt?: Date;
}

export type SxxkField = keyof SxxkRow | 'stt' | 'action';

export interface SxxkColumn {
  field: SxxkField;
  header: string;
  color?: string;
  group?: string;
  formula?: boolean;
}

export interface SxxkTab {
  key: string;
  label: string;
  icon: string;
  importKey?: string;
  columns: SxxkColumn[];
}

/** Chỉ số cột Excel (0-based) theo hướng dẫn SXXK 2026 */
const COL = {
  NHAP: { startRow: 7, ctu: 0, ma: 11, sl: 18, value: 20, loai: 34 },
  XUAT: { startRow: 6, ctu: 0, ma: 8, sl: 12, value: 15, loai: 28 },
  TONDAU: { startRow: 2, ma: 0, e31: 1, khac: 2 },
  BCTK: { startRow: 7, ma: 0, sl: 5, value: 6 },
} as const;

const RAW_SHEET_KEYS = ['nhap', 'xuat', 'ton-dau-2026', 'bctk'] as const;
type RawSheetKey = typeof RAW_SHEET_KEYS[number];

const TONG_HOP_COLUMNS: SxxkColumn[] = [
  { field: 'stt', header: 'No' },
  { field: 'maNVL', header: 'Mã NVL' },
  { field: 'totalTonDauSL', header: 'TOTAL TỒN ĐẦU SL', group: 'ton-dau', formula: true },
  { field: 'totalTonDauValue', header: 'TOTAL TỒN ĐẦU Value', group: 'ton-dau', formula: true },
  { field: 'tonDauE31SL', header: 'TỒN ĐẦU E31 SL', group: 'ton-dau' },
  { field: 'tonDauE31Value', header: 'TỒN ĐẦU E31 Value', group: 'ton-dau' },
  { field: 'tonDauKhacSL', header: 'TỒN ĐẦU KHAC SL', group: 'ton-dau' },
  { field: 'tonDauKhacValue', header: 'TỒN ĐẦU KHAC Value', group: 'ton-dau' },
  { field: 'totalNkSL', header: 'TOTAL NK SL', group: 'nk', formula: true },
  { field: 'totalNkValue', header: 'TOTAL NK Value', group: 'nk', formula: true },
  { field: 'nkE31SL', header: 'NK E31 SL', group: 'nk' },
  { field: 'nkE31Value', header: 'NK E31 Value', group: 'nk' },
  { field: 'nkKhacSL', header: 'NK KHAC SL', group: 'nk' },
  { field: 'nkKhacValue', header: 'NK KHAC Value', group: 'nk' },
  { field: 'totalPnSL', header: 'TOTAL PN SL', group: 'pn', formula: true },
  { field: 'totalPnValue', header: 'TOTAL PN Value', group: 'pn', formula: true },
  { field: 'pnE31SL', header: 'PN E31 SL', group: 'pn' },
  { field: 'pnE31Value', header: 'PN E31 Value', group: 'pn' },
  { field: 'pnKhacSL', header: 'PN KHAC SL', group: 'pn' },
  { field: 'pnKhacValue', header: 'PN KHAC Value', group: 'pn' },
  { field: 'totalPxSL', header: 'TOTAL PX SL', group: 'px', formula: true },
  { field: 'totalPxValue', header: 'TOTAL PX Value', group: 'px', formula: true },
  { field: 'pxE31SL', header: 'PX E31 SL', group: 'px' },
  { field: 'pxE31Value', header: 'PX E31 Value', group: 'px' },
  { field: 'pxKhacSL', header: 'PX KHAC SL', group: 'px' },
  { field: 'pxKhacValue', header: 'PX KHAC Value', group: 'px' },
  { field: 'totalTonKhoSL', header: 'TOTAL TỒN KHO SL', group: 'ton-kho', formula: true },
  { field: 'totalTonKhoValue', header: 'TOTAL TỒN KHO Value', group: 'ton-kho', formula: true },
  { field: 'tonKhoE31SL', header: 'TỒN KHO E31 SL', group: 'ton-kho', formula: true },
  { field: 'tonKhoE31Value', header: 'TỒN KHO E31 Value', group: 'ton-kho', formula: true },
  { field: 'tonKhoKhacSL', header: 'TỒN KHO KHAC SL', group: 'ton-kho', formula: true },
  { field: 'tonKhoKhacValue', header: 'TỒN KHO KHAC Value', group: 'ton-kho', formula: true },
  { field: 'bctkSL', header: 'BCTK 2026 SL', group: 'bctk' },
  { field: 'bctkValue', header: 'BCTK 2026 Value', group: 'bctk' },
  { field: 'chenhLechSL', header: 'Chênh lệch SL', group: 'chenh', formula: true },
  { field: 'chenhLechValue', header: 'Chênh lệch Value', group: 'chenh', formula: true },
  { field: 'action', header: '' },
];

const TABS: SxxkTab[] = [
  { key: 'tong-hop', label: 'Tổng hợp', icon: 'table_chart', columns: TONG_HOP_COLUMNS },
  {
    key: 'ton-dau-2026', label: 'Tồn Đầu 2026', icon: 'inventory', importKey: 'ton-dau-2026',
    columns: [
      { field: 'stt', header: 'STT' },
      { field: 'maNVL', header: 'Mã NVL' },
      { field: 'tonDauE31SL', header: 'TỒN ĐẦU E31 SL', color: '#bbdefb' },
      { field: 'tonDauKhacSL', header: 'TỒN ĐẦU KHAC SL', color: '#bbdefb' },
      { field: 'action', header: '' },
    ],
  },
  {
    key: 'nhap', label: 'NHAP (NK/PN)', icon: 'input', importKey: 'nhap',
    columns: [
      { field: 'stt', header: 'STT' },
      { field: 'maNVL', header: 'Mã NVL' },
      { field: 'nkE31SL', header: 'NK E31 SL', color: '#c8e6c9' },
      { field: 'nkKhacSL', header: 'NK KHAC SL', color: '#c8e6c9' },
      { field: 'pnE31SL', header: 'PN E31 SL', color: '#b2ebf2' },
      { field: 'pnKhacSL', header: 'PN KHAC SL', color: '#b2ebf2' },
      { field: 'action', header: '' },
    ],
  },
  {
    key: 'xuat', label: 'XUAT (PX)', icon: 'exit_to_app', importKey: 'xuat',
    columns: [
      { field: 'stt', header: 'STT' },
      { field: 'maNVL', header: 'Mã NVL' },
      { field: 'pxE31SL', header: 'PX E31 SL', color: '#ffe0b2' },
      { field: 'pxKhacSL', header: 'PX KHAC SL', color: '#ffe0b2' },
      { field: 'action', header: '' },
    ],
  },
  {
    key: 'bctk', label: 'BCTK 2026', icon: 'analytics', importKey: 'bctk',
    columns: [
      { field: 'stt', header: 'STT' },
      { field: 'maNVL', header: 'Mã NVL' },
      { field: 'bctkSL', header: 'BCTK SL', color: '#fce4ec' },
      { field: 'bctkValue', header: 'BCTK Value', color: '#fce4ec' },
      { field: 'chenhLechSL', header: 'Chênh lệch SL', color: '#fff9c4', formula: true },
      { field: 'chenhLechValue', header: 'Chênh lệch Value', color: '#fff9c4', formula: true },
      { field: 'action', header: '' },
    ],
  },
];

type AggKey = 'nkE31SL' | 'nkE31Value' | 'nkKhacSL' | 'nkKhacValue'
  | 'pnE31SL' | 'pnE31Value' | 'pnKhacSL' | 'pnKhacValue'
  | 'pxE31SL' | 'pxE31Value' | 'pxKhacSL' | 'pxKhacValue';

@Component({
  selector: 'app-sxxk',
  templateUrl: './sxxk.component.html',
  styleUrls: ['./sxxk.component.scss'],
})
export class SxxkComponent implements OnInit {
  tabs = TABS;
  activeTabKey = 'tong-hop';

  get activeTab(): SxxkTab {
    return this.tabs.find(t => t.key === this.activeTabKey) || this.tabs[0];
  }

  rows: SxxkRow[] = [];
  filteredRows: SxxkRow[] = [];

  searchTerm = '';
  yearFilter = 2026;
  years = [2024, 2025, 2026];

  isLoading = false;
  savedMsg = '';
  importStatus = '';

  /** Dữ liệu thô từ file import (giữ trong phiên làm việc) */
  private nhapRaw: any[][] = [];
  private xuatRaw: any[][] = [];
  private tonDauRaw: any[][] = [];
  private bctkRaw: any[][] = [];

  private nhapAgg = new Map<string, Record<AggKey, number>>();
  private xuatAgg = new Map<string, Record<AggKey, number>>();
  private tonDauMap = new Map<string, { e31: number; khac: number }>();
  private bctkMap = new Map<string, { sl: number; value: number }>();

  /** Sheet thô đã load (từ Storage hoặc vừa import) */
  rawLoaded: Record<RawSheetKey, boolean> = {
    nhap: false, xuat: false, 'ton-dau-2026': false, bctk: false,
  };

  constructor(
    private firestore: AngularFirestore,
    private storage: AngularFireStorage,
    private router: Router,
  ) {}

  goMenu(): void { this.router.navigate(['/menu']); }

  ngOnInit(): void { this.readRawAndCalculate(); }

  /** Đọc file thô từ Storage → tính bảng SXXK (không dùng dữ liệu tổng hợp cũ) */
  async readRawAndCalculate(): Promise<void> {
    this.isLoading = true;
    this.importStatus = 'Đang đọc dữ liệu thô...';
    try {
      this.resetRawState();
      const loaded = await this.loadRawFromStorage();
      if (loaded) {
        this.rebuildAll();
        this.filterRows();
        this.importStatus = this.rawStatusText();
      } else {
        this.rows = [];
        this.filteredRows = [];
        this.importStatus = 'Chưa có file thô trên Storage. Import workbook để lưu.';
      }
    } catch (e) {
      console.error('[SXXK] Read raw error:', e);
      this.importStatus = 'Lỗi đọc dữ liệu thô';
    } finally {
      this.isLoading = false;
    }
  }

  onYearChange(): void { this.readRawAndCalculate(); }

  private storageBase(): string {
    return `sxxk-raw/${this.yearFilter}`;
  }

  private rawFilePath(type: RawSheetKey | 'workbook'): string {
    return `${this.storageBase()}/${type}.xlsx`;
  }

  private resetRawState(): void {
    this.nhapRaw = [];
    this.xuatRaw = [];
    this.tonDauRaw = [];
    this.bctkRaw = [];
    this.nhapAgg.clear();
    this.xuatAgg.clear();
    this.tonDauMap.clear();
    this.bctkMap.clear();
    RAW_SHEET_KEYS.forEach(k => { this.rawLoaded[k] = false; });
  }

  private async loadRawFromStorage(): Promise<boolean> {
    // Ưu tiên workbook gộp (import 1 lần)
    const wbBuf = await this.downloadArrayBuffer(this.rawFilePath('workbook'));
    if (wbBuf) {
      const wb = XLSX.read(new Uint8Array(wbBuf), { type: 'array' });
      let any = false;
      for (const name of wb.SheetNames) {
        const key = this.detectSheetType(name);
        if (key) {
          const raw = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1 });
          this.loadRawSheet(key, raw);
          this.rawLoaded[key as RawSheetKey] = true;
          any = true;
        }
      }
      return any;
    }

    // Đọc từng file riêng
    let any = false;
    for (const key of RAW_SHEET_KEYS) {
      const buf = await this.downloadArrayBuffer(this.rawFilePath(key));
      if (!buf) continue;
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      const sheetName = wb.SheetNames[0];
      const raw = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], { header: 1 });
      this.loadRawSheet(key, raw);
      this.rawLoaded[key] = true;
      any = true;
    }
    return any;
  }

  private async downloadArrayBuffer(path: string): Promise<ArrayBuffer | null> {
    try {
      const ref = this.storage.ref(path);
      const url = await firstValueFrom(ref.getDownloadURL());
      const resp = await fetch(url);
      if (!resp.ok) return null;
      return await resp.arrayBuffer();
    } catch {
      return null;
    }
  }

  private async uploadRawFile(path: string, buffer: ArrayBuffer, fileName: string): Promise<void> {
    const ref = this.storage.ref(path);
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const task = ref.put(blob, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      customMetadata: { sourceFileName: fileName },
    });
    await firstValueFrom(
      task.snapshotChanges().pipe(
        filter(s => !!s && s.totalBytes > 0 && s.bytesTransferred === s.totalBytes),
      ),
    );
  }

  private async saveRawMeta(extra: Record<string, unknown> = {}): Promise<void> {
    await this.firestore.collection('sxxk-meta').doc(String(this.yearFilter)).set({
      ...this.rawLoaded,
      updatedAt: new Date(),
      ...extra,
    }, { merge: true });
  }

  rawStatusText(): string {
    const parts = RAW_SHEET_KEYS
      .filter(k => this.rawLoaded[k])
      .map(k => k.toUpperCase().replace('-2026', ''));
    if (parts.length === 0) return '';
    return `Đã đọc thô: ${parts.join(', ')} · ${this.rows.length} mã NVL`;
  }

  filterRows(): void {
    const term = this.searchTerm.trim().toLowerCase();
    this.filteredRows = this.rows.filter(r =>
      !term || r.maNVL.toLowerCase().includes(term)
    );
  }

  // ── Import (lưu file thô → đọc lại → tính) ───────────────────────

  onFileSelected(event: Event, importType: string): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e: ProgressEvent<FileReader>) => {
      this.isLoading = true;
      try {
        const buf = e.target?.result as ArrayBuffer;
        if (!buf) throw new Error('Không đọc được file');
        await this.uploadRawFile(this.rawFilePath(importType as RawSheetKey), buf, file.name);
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
        await this.processWorkbook(importType, wb);
        await this.saveRawMeta();
        const label = TABS.find(t => t.importKey === importType)?.label || importType;
        alert(`✅ Đã lưu file thô ${label} và tính lại. Tổng ${this.rows.length} mã NVL.`);
      } catch (err) {
        alert('Lỗi import: ' + (err as Error).message);
      } finally {
        this.isLoading = false;
        input.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  }

  /** Import workbook đa sheet → lưu 1 file thô, đọc và tính */
  onMultiFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e: ProgressEvent<FileReader>) => {
      this.isLoading = true;
      try {
        const buf = e.target?.result as ArrayBuffer;
        if (!buf) throw new Error('Không đọc được file');
        await this.uploadRawFile(this.rawFilePath('workbook'), buf, file.name);
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
        const loaded = await this.processMultiWorkbook(wb);
        if (loaded.length === 0) {
          alert('Không tìm thấy sheet NHAP/XUAT/TONDAU/BCTK. Kiểm tra tên sheet trong file.');
          return;
        }
        await this.saveRawMeta({ workbookFile: file.name });
        alert(`✅ Đã lưu file thô và tính từ ${loaded.length} sheet: ${loaded.join(', ')}. Tổng ${this.rows.length} mã NVL.`);
      } catch (err) {
        alert('Lỗi import: ' + (err as Error).message);
      } finally {
        this.isLoading = false;
        input.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  }

  private async processMultiWorkbook(wb: XLSX.WorkBook): Promise<string[]> {
    this.resetRawState();
    const loaded: string[] = [];
    for (const name of wb.SheetNames) {
      const key = this.detectSheetType(name);
      if (key) {
        const raw = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1 });
        this.loadRawSheet(key, raw);
        this.rawLoaded[key as RawSheetKey] = true;
        loaded.push(name);
      }
    }
    this.rebuildAll();
    this.filterRows();
    this.importStatus = this.rawStatusText();
    return loaded;
  }

  private async processWorkbook(importType: string, wb: XLSX.WorkBook): Promise<void> {
    this.resetRawState();
    const sheetName = this.findSheet(wb, importType);
    const raw = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], { header: 1 });
    this.loadRawSheet(importType, raw);
    await this.mergeOtherRawFromStorage(importType as RawSheetKey);
    this.rebuildAll();
    this.filterRows();
    this.importStatus = this.rawStatusText();
  }

  /** Khi import 1 sheet, đọc thêm các file thô khác đã lưu trên Storage */
  private async mergeOtherRawFromStorage(skip: RawSheetKey): Promise<void> {
    for (const key of RAW_SHEET_KEYS) {
      if (key === skip || this.rawLoaded[key]) continue;
      const buf = await this.downloadArrayBuffer(this.rawFilePath(key));
      if (!buf) continue;
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      const raw = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      this.loadRawSheet(key, raw);
      this.rawLoaded[key] = true;
    }
  }

  private findSheet(wb: XLSX.WorkBook, importType: string): string {
    const detected = wb.SheetNames.find(n => this.detectSheetType(n) === importType);
    return detected || wb.SheetNames[0];
  }

  private detectSheetType(name: string): string | null {
    const n = name.trim().toUpperCase();
    if (n.includes('NHAP') || n === 'NK' || n.includes('NNVL')) return 'nhap';
    if (n.includes('XUAT') || n === 'PX' || n.includes('XNVL')) return 'xuat';
    if (n.includes('TONDAU') || n.includes('TỒN ĐẦU') || n.includes('TON DAU')) return 'ton-dau-2026';
    if (n.includes('BCTK')) return 'bctk';
    return null;
  }

  private loadRawSheet(type: string, raw: any[][]): void {
    switch (type) {
      case 'nhap':
        this.nhapRaw = raw;
        this.buildNhapIndex();
        this.rawLoaded.nhap = true;
        break;
      case 'xuat':
        this.xuatRaw = raw;
        this.buildXuatIndex();
        this.rawLoaded.xuat = true;
        break;
      case 'ton-dau-2026':
        this.tonDauRaw = raw;
        this.buildTonDauMap();
        this.rawLoaded['ton-dau-2026'] = true;
        break;
      case 'bctk':
        this.bctkRaw = raw;
        this.buildBctkMap();
        this.rawLoaded.bctk = true;
        break;
    }
  }

  // ── Index builders ────────────────────────────────────────────────

  private buildNhapIndex(): void {
    this.nhapAgg.clear();
    const c = COL.NHAP;
    for (let i = c.startRow; i < this.nhapRaw.length; i++) {
      const row = this.nhapRaw[i];
      if (!row) continue;
      const ctu = String(row[c.ctu] ?? '').trim().toUpperCase();
      if (ctu !== 'NK' && ctu !== 'PN') continue;
      const ma = this.normMa(row[c.ma]);
      if (!ma) continue;
      const isE31 = String(row[c.loai] ?? '').trim().toUpperCase() === 'E31';
      const sl = Number(row[c.sl]) || 0;
      const val = Number(row[c.value]) || 0;
      const agg = this.getOrCreateAgg(this.nhapAgg, ma);
      const prefix = ctu === 'NK' ? 'nk' : 'pn';
      if (isE31) {
        agg[`${prefix}E31SL` as AggKey] += sl;
        agg[`${prefix}E31Value` as AggKey] += val;
      } else {
        agg[`${prefix}KhacSL` as AggKey] += sl;
        agg[`${prefix}KhacValue` as AggKey] += val;
      }
    }
  }

  private buildXuatIndex(): void {
    this.xuatAgg.clear();
    const c = COL.XUAT;
    for (let i = c.startRow; i < this.xuatRaw.length; i++) {
      const row = this.xuatRaw[i];
      if (!row) continue;
      const ctu = String(row[c.ctu] ?? '').trim().toUpperCase();
      if (ctu !== 'PX') continue;
      const ma = this.normMa(row[c.ma]);
      if (!ma) continue;
      const isE31 = String(row[c.loai] ?? '').trim().toUpperCase() === 'E31';
      const sl = Number(row[c.sl]) || 0;
      const val = Number(row[c.value]) || 0;
      const agg = this.getOrCreateAgg(this.xuatAgg, ma);
      if (isE31) {
        agg.pxE31SL += sl;
        agg.pxE31Value += val;
      } else {
        agg.pxKhacSL += sl;
        agg.pxKhacValue += val;
      }
    }
  }

  private buildTonDauMap(): void {
    this.tonDauMap.clear();
    const c = COL.TONDAU;
    for (let i = c.startRow; i < this.tonDauRaw.length; i++) {
      const row = this.tonDauRaw[i];
      if (!row) continue;
      const ma = this.normMa(row[c.ma]);
      if (!ma) continue;
      this.tonDauMap.set(ma, {
        e31: Number(row[c.e31]) || 0,
        khac: Number(row[c.khac]) || 0,
      });
    }
  }

  private buildBctkMap(): void {
    this.bctkMap.clear();
    const c = COL.BCTK;
    for (let i = c.startRow; i < this.bctkRaw.length; i++) {
      const row = this.bctkRaw[i];
      if (!row) continue;
      const ma = this.normMa(row[c.ma]);
      if (!ma) continue;
      const prev = this.bctkMap.get(ma) || { sl: 0, value: 0 };
      this.bctkMap.set(ma, {
        sl: prev.sl + (Number(row[c.sl]) || 0),
        value: prev.value + (Number(row[c.value]) || 0),
      });
    }
  }

  private getOrCreateAgg(map: Map<string, Record<AggKey, number>>, ma: string): Record<AggKey, number> {
    let agg = map.get(ma);
    if (!agg) {
      agg = {
        nkE31SL: 0, nkE31Value: 0, nkKhacSL: 0, nkKhacValue: 0,
        pnE31SL: 0, pnE31Value: 0, pnKhacSL: 0, pnKhacValue: 0,
        pxE31SL: 0, pxE31Value: 0, pxKhacSL: 0, pxKhacValue: 0,
      };
      map.set(ma, agg);
    }
    return agg;
  }

  private normMa(v: any): string {
    return String(v ?? '').trim().toUpperCase();
  }

  // ── Rebuild bảng tổng hợp ─────────────────────────────────────────

  private rebuildAll(): void {
    const maSet = new Set<string>();
    this.nhapAgg.forEach((_, k) => maSet.add(k));
    this.xuatAgg.forEach((_, k) => maSet.add(k));
    this.tonDauMap.forEach((_, k) => maSet.add(k));
    this.bctkMap.forEach((_, k) => maSet.add(k));

    const codes = Array.from(maSet).sort((a, b) => a.localeCompare(b));
    const existing = new Map(this.rows.map(r => [this.normMa(r.maNVL), r]));

    this.rows = codes.map(ma => {
      const prev = existing.get(ma);
      const row = this.computeRow(ma);
      if (prev?.id) row.id = prev.id;
      row.maNVL = ma;
      row.year = this.yearFilter;
      row.updatedAt = new Date();
      return row;
    });
  }

  private computeRow(ma: string): SxxkRow {
    const nhap = this.nhapAgg.get(ma);
    const xuat = this.xuatAgg.get(ma);
    const td = this.tonDauMap.get(ma);
    const bctk = this.bctkMap.get(ma);

    const row: SxxkRow = {
      maNVL: ma,
      tonDauE31SL: td?.e31 ?? 0,
      tonDauE31Value: 0,
      tonDauKhacSL: td?.khac ?? 0,
      tonDauKhacValue: 0,
      nkE31SL: nhap?.nkE31SL ?? 0,
      nkE31Value: nhap?.nkE31Value ?? 0,
      nkKhacSL: nhap?.nkKhacSL ?? 0,
      nkKhacValue: nhap?.nkKhacValue ?? 0,
      pnE31SL: nhap?.pnE31SL ?? 0,
      pnE31Value: nhap?.pnE31Value ?? 0,
      pnKhacSL: nhap?.pnKhacSL ?? 0,
      pnKhacValue: nhap?.pnKhacValue ?? 0,
      pxE31SL: xuat?.pxE31SL ?? 0,
      pxE31Value: xuat?.pxE31Value ?? 0,
      pxKhacSL: xuat?.pxKhacSL ?? 0,
      pxKhacValue: xuat?.pxKhacValue ?? 0,
      bctkSL: bctk?.sl ?? 0,
      bctkValue: bctk?.value ?? 0,
      totalTonDauSL: 0, totalTonDauValue: 0,
      totalNkSL: 0, totalNkValue: 0,
      totalPnSL: 0, totalPnValue: 0,
      totalPxSL: 0, totalPxValue: 0,
      totalTonKhoSL: 0, totalTonKhoValue: 0,
      tonKhoE31SL: 0, tonKhoE31Value: 0,
      tonKhoKhacSL: 0, tonKhoKhacValue: 0,
      chenhLechSL: 0, chenhLechValue: 0,
    };
    this.applyFormulas(row);
    return row;
  }

  /** Cột công thức theo hướng dẫn SXXK 2026 */
  private applyFormulas(r: SxxkRow): void {
    r.totalTonDauSL = r.tonDauE31SL + r.tonDauKhacSL;
    r.totalTonDauValue = r.tonDauE31Value + r.tonDauKhacValue;

    r.totalNkSL = r.nkE31SL + r.nkKhacSL;
    r.totalNkValue = r.nkE31Value + r.nkKhacValue;

    r.totalPnSL = r.pnE31SL + r.pnKhacSL;
    r.totalPnValue = r.pnE31Value + r.pnKhacValue;

    r.totalPxSL = r.pxE31SL + r.pxKhacSL;
    r.totalPxValue = r.pxE31Value + r.pxKhacValue;

    // AA = C + I + O - U
    r.totalTonKhoSL = r.totalTonDauSL + r.totalNkSL + r.totalPnSL - r.totalPxSL;
    r.totalTonKhoValue = r.totalTonDauValue + r.totalNkValue + r.totalPnValue - r.totalPxValue;

    r.tonKhoE31SL = r.tonDauE31SL + r.nkE31SL + r.pnE31SL - r.pxE31SL;
    r.tonKhoE31Value = r.tonDauE31Value + r.nkE31Value + r.pnE31Value - r.pxE31Value;

    r.tonKhoKhacSL = r.tonDauKhacSL + r.nkKhacSL + r.pnKhacSL - r.pxKhacSL;
    r.tonKhoKhacValue = r.tonDauKhacValue + r.nkKhacValue + r.pnKhacValue - r.pxKhacValue;

    r.chenhLechSL = r.totalTonKhoSL - r.bctkSL;
    r.chenhLechValue = r.totalTonKhoValue - r.bctkValue;
  }

  // ── Firebase ──────────────────────────────────────────────────────

  async saveToFirebase(): Promise<void> {
    if (this.rows.length === 0) return;
    try {
      const db = this.firestore.firestore;
      const CHUNK = 400;
      for (let i = 0; i < this.rows.length; i += CHUNK) {
        const batch = db.batch();
        const slice = this.rows.slice(i, i + CHUNK);
        for (const row of slice) {
          const docRef = row.id
            ? this.firestore.collection('sxxk-data').doc(row.id).ref
            : this.firestore.collection('sxxk-data').doc().ref;
          if (!row.id) row.id = docRef.id;
          batch.set(docRef, { ...row, year: this.yearFilter, updatedAt: new Date() });
        }
        await batch.commit();
      }
      this.savedMsg = '✅ Đã lưu';
      setTimeout(() => this.savedMsg = '', 3000);
    } catch (e) {
      console.error('[SXXK] Save error:', e);
      alert('Lỗi lưu Firebase: ' + (e as Error).message);
    }
  }

  async deleteRow(row: SxxkRow): Promise<void> {
    if (!confirm(`Xóa dòng ${row.maNVL}?`)) return;
    if (row.id) await this.firestore.collection('sxxk-data').doc(row.id).delete();
    this.rows = this.rows.filter(r => r !== row);
    this.filterRows();
  }

  /** Đọc lại file thô từ Storage và tính bảng */
  recalcAll(): void {
    this.readRawAndCalculate().then(() => {
      if (this.rows.length > 0) {
        alert(`✅ Đã đọc dữ liệu thô và tính ${this.rows.length} mã NVL.`);
      }
    });
  }

  // ── Export ────────────────────────────────────────────────────────

  exportExcel(): void {
    const cols = this.activeTab.columns.filter(c => c.field !== 'stt' && c.field !== 'action');
    const headers = cols.map(c => c.header);
    const data: any[][] = [
      headers,
      ...this.filteredRows.map((r, idx) => [
        idx + 1,
        ...cols.filter(c => c.field !== 'maNVL').map(c => this.exportVal(r, c.field as keyof SxxkRow)),
      ]),
    ];
    if (this.activeTab.key === 'tong-hop') {
      data.forEach((row, i) => {
        if (i === 0) return;
        row[0] = i;
      });
    }
    const ws = XLSX.utils.aoa_to_sheet(
      this.activeTab.key === 'tong-hop'
        ? [headers, ...this.filteredRows.map((r, i) => [i + 1, r.maNVL, ...cols.slice(1).map(c => this.exportVal(r, c.field as keyof SxxkRow))])]
        : data
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, this.activeTab.label);
    XLSX.writeFile(wb, `SXXK_${this.activeTab.label}_${this.yearFilter}.xlsx`);
  }

  private exportVal(r: SxxkRow, field: keyof SxxkRow): number | string {
    const v = r[field];
    if (typeof v === 'number') return v === 0 ? '' : v;
    if (typeof v === 'string') return v;
    return '';
  }

  downloadTemplate(type: string): void {
    const templates: Record<string, { name: string; rows: any[][] }> = {
      'ton-dau-2026': {
        name: 'TONDAU',
        rows: [['Mã NVL', 'TonDau_E31_SL', 'TonDau_KHAC_SL'], ['B001', 100, 50]],
      },
      nhap: {
        name: 'NHAP',
        rows: [
          ['Ctừ', '', '', '', '', '', '', '', '', '', '', 'MaNVL', '', '', '', '', '', '', 'SL', '', 'Value', '', '', '', '', '', '', '', '', '', '', '', '', '', 'LoaiHinh'],
          ['NK', '', '', '', '', '', '', '', '', '', '', 'B001', '', '', '', '', '', '', 10, '', 1000, '', '', '', '', '', '', '', '', '', '', '', '', '', 'E31'],
        ],
      },
      xuat: {
        name: 'XUAT',
        rows: [
          ['Ctừ', '', '', '', '', '', '', '', 'MaNVL', '', '', '', 'SL', '', '', 'Value', '', '', '', '', '', '', '', '', '', '', '', '', 'LoaiHinh'],
          ['PX', '', '', '', '', '', '', '', 'B001', '', '', '', 5, '', '', 500, '', '', '', '', '', '', '', '', '', '', '', '', 'E31'],
        ],
      },
      bctk: {
        name: 'BCTK',
        rows: [['Mã NVL', '', '', '', '', 'TonCuoiKy_SL', 'SoDuCuoiKy_Value'], ['B001', '', '', '', '', 300, 30000]],
      },
    };
    const t = templates[type] || { name: 'Sheet1', rows: [['Mã NVL']] };
    const ws = XLSX.utils.aoa_to_sheet(t.rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, t.name);
    const label = TABS.find(tab => tab.importKey === type)?.label || type;
    XLSX.writeFile(wb, `Form_${label.replace(/\s+/g, '_')}.xlsx`);
  }

  hasRawData(): boolean {
    return this.nhapRaw.length > 0 || this.xuatRaw.length > 0
      || this.tonDauRaw.length > 0 || this.bctkRaw.length > 0;
  }

  // ── UI helpers ────────────────────────────────────────────────────

  cellValue(row: SxxkRow, field: string): string {
    if (field === 'stt' || field === 'action') return '';
    if (field === 'maNVL') return row.maNVL ?? '';
    const v = (row as any)[field];
    if (v === 0 || v == null) return '';
    return Number(v).toLocaleString('vi-VN');
  }

  isFormula(field: string): boolean {
    const col = this.activeTab.columns.find(c => c.field === field);
    return !!col?.formula;
  }

  isChenhLech(field: string): boolean {
    return field === 'chenhLechSL' || field === 'chenhLechValue';
  }

  hasChenhLech(row: SxxkRow): boolean {
    return row.chenhLechSL !== 0 || row.chenhLechValue !== 0;
  }

  sum(field: keyof SxxkRow): string {
    const s = this.filteredRows.reduce((acc, r) => acc + (Number((r as any)[field]) || 0), 0);
    return s === 0 ? '' : s.toLocaleString('vi-VN');
  }

  get totalRows(): number { return this.filteredRows.length; }
  colCount(): number { return this.activeTab.columns.length; }

  groupLabel(group: string): string {
    const labels: Record<string, string> = {
      'ton-dau': 'TỒN ĐẦU',
      nk: 'NHẬP KHO (NK)',
      pn: 'PHIẾU NHẬP (PN)',
      px: 'XUẤT KHO (PX)',
      'ton-kho': 'TỒN KHO',
      bctk: 'BCTK 2026',
      chenh: 'CHÊNH LỆCH',
    };
    return labels[group] || group;
  }

  getGroupColumns(group: string): SxxkColumn[] {
    return this.activeTab.columns.filter(c => c.group === group);
  }

  get hasGroupHeader(): boolean {
    return this.activeTab.key === 'tong-hop';
  }
}
