import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as XLSX from 'xlsx';
import * as firebase from 'firebase/compat/app';

/** Một bản cache import duy nhất — document `current` trong collection này. */
const FG_OVERVIEW_IMPORT_CACHE_COLLECTION = 'fg-overview-import-cache';
const FG_OVERVIEW_IMPORT_CACHE_DOC_PREFIX = 'current-';

export interface FgOverviewImportLine {
  norm: string;
  display: string;
  ton: number;
}

interface FgOverviewImportCachePayload {
  fileName: string;
  lines: FgOverviewImportLine[];
  columnFill: FgOverviewTableColumnFill;
  updatedAt?: unknown;
}

export interface FgOverviewTableColumnFill {
  maTp: string;
  tonFg: string;
  tonFile: string;
  qtyDelta: string;
  inImport: string;
  compare: string;
  location: string;
}

export interface FgOverviewRow {
  materialCode: string;
  tonFg: number;
  tonImport: number;
  location: string;
  /**
   * Chênh lệch tổng (tồn file theo mã − tồn FG), chỉ ghi trên dòng cuối cùng của cùng mã trong file;
   * null ở các dòng trung gian cùng mã hoặc không có import.
   */
  qtyDelta: number | null;
  /** Tổng SL file của mã này có lệch tồn FG (dùng tô cả các dòng cùng mã). */
  normQtyMismatch: boolean;
  inImport: boolean;
  compare: 'Khớp' | 'Thiếu ở file import' | 'Dư so với FG Inventory';
}

@Component({
  selector: 'app-fg-overview',
  templateUrl: './fg-overview.component.html',
  styleUrls: ['./fg-overview.component.scss']
})
export class FgOverviewComponent implements OnInit, OnDestroy {
  selectedFactory: 'ASM1' | 'ASM2' = 'ASM1';
  isLoadingFg = false;
  fgError: string | null = null;

  /** Tổng tồn theo Mã TP từ Firebase */
  private tonByCode = new Map<string, number>();
  /** Danh sách vị trí theo mã TP (gộp unique từ fg-inventory) */
  private locationsByCode = new Map<string, string>();
  /** Tập mã (chuẩn hóa) có trong file import */
  private importCodesNormalized = new Set<string>();
  /** Mỗi phần tử = một dòng dữ liệu file (từ dòng 7), không gộp trùng mã */
  private importLines: { norm: string; display: string; ton: number }[] = [];

  rows: FgOverviewRow[] = [];
  importFileName: string | null = null;
  importRowCount = 0;
  /** Popup hướng dẫn + chọn file import */
  showImportDialog = false;
  /** Popup More actions */
  showMoreMenu = false;

  filterCompare: 'all' | 'mismatch' | 'missing_in_import' | 'extra_in_import' = 'all';

  /** Một dòng fill dưới tiêu đề cột bảng (lưu kèm cache Firebase). */
  tableColumnFill: FgOverviewTableColumnFill = {
    maTp: '',
    tonFg: '',
    tonFile: '',
    qtyDelta: '',
    inImport: '',
    compare: '',
    location: ''
  };

  private destroy$ = new Subject<void>();

  constructor(
    private firestore: AngularFirestore,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.loadImportCacheFromFirebase();
    this.loadFgInventory();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setFactory(f: 'ASM1' | 'ASM2'): void {
    if (this.selectedFactory === f) return;
    this.selectedFactory = f;
    this.loadImportCacheFromFirebase();
    this.loadFgInventory();
  }

  loadFgInventory(): void {
    this.isLoadingFg = true;
    this.fgError = null;
    this.firestore
      .collection('fg-inventory', ref => ref.where('factory', '==', this.selectedFactory))
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: snap => {
          this.tonByCode.clear();
          this.locationsByCode.clear();
          const locationSetByNorm = new Map<string, Set<string>>();
          snap.docs.forEach(doc => {
            const d = doc.data() as { materialCode?: string; ton?: number; location?: string };
            const code = String(d.materialCode || '').trim();
            if (!code) return;
            const ton = typeof d.ton === 'number' && !isNaN(d.ton) ? d.ton : 0;
            this.tonByCode.set(code, (this.tonByCode.get(code) || 0) + ton);
            const norm = this.normalizeCode(code);
            const loc = String(d.location || '').trim();
            if (loc) {
              const set = locationSetByNorm.get(norm) || new Set<string>();
              set.add(loc);
              locationSetByNorm.set(norm, set);
            }
          });
          locationSetByNorm.forEach((set, norm) => {
            this.locationsByCode.set(norm, Array.from(set).sort((a, b) => a.localeCompare(b)).join(', '));
          });
          this.isLoadingFg = false;
          this.rebuildRows();
        },
        error: err => {
          console.error('FG Overview load fg-inventory:', err);
          this.fgError = 'Không tải được FG Inventory. Thử lại sau.';
          this.isLoadingFg = false;
          this.tonByCode.clear();
          this.rebuildRows();
        }
      });
  }

  openImportDialog(): void {
    this.showImportDialog = true;
  }

  closeImportDialog(): void {
    this.showImportDialog = false;
  }

  toggleMoreMenu(): void {
    this.showMoreMenu = !this.showMoreMenu;
  }

  closeMoreMenu(): void {
    this.showMoreMenu = false;
  }

  onImportFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.importFileName = file.name;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: '',
          blankrows: true
        }) as any[][];
        const parsed = this.parseImportFromRow7(raw);
        if (!parsed.lines.length) {
          this.importFileName = null;
          this.importRowCount = 0;
          this.importCodesNormalized.clear();
          this.importLines = [];
          this.resetTableColumnFill();
          this.rebuildRows();
          this.deleteImportCacheFromFirebase();
          alert('Không có dòng hợp lệ trong file (kiểm tra dòng 7+, định dạng mã TP P/T/M/L + 6 số).');
          return;
        }
        this.resetTableColumnFill();
        this.applyImportedLines(parsed.lines, file.name);
        this.persistImportCacheToFirebase();
        this.showImportDialog = false;
      } catch (err) {
        console.error('FG Overview import:', err);
        this.importFileName = null;
        this.importRowCount = 0;
        this.importCodesNormalized.clear();
        this.importLines = [];
        this.rebuildRows();
        alert(
          'Không đọc được file. Kiểm tra định dạng .xlsx/.xls và đúng quy tắc: dữ liệu từ dòng 7, cột A = Mã TP, cột F = tồn kho.'
        );
      }
    };
    reader.readAsArrayBuffer(file);
  }

  clearImport(): void {
    this.importFileName = null;
    this.importRowCount = 0;
    this.importCodesNormalized.clear();
    this.importLines = [];
    this.resetTableColumnFill();
    this.rebuildRows();
    this.deleteImportCacheFromFirebase();
  }

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  /** Lưu lại ô fill cột (sau khi user chỉnh tay). */
  persistImportCacheToFirebase(): void {
    if (!this.importLines.length || !this.importFileName) {
      return;
    }
    const payload: FgOverviewImportCachePayload = {
      fileName: this.importFileName,
      lines: this.importLines.map(l => ({
        norm: l.norm,
        display: l.display,
        ton: typeof l.ton === 'number' && isFinite(l.ton) ? l.ton : 0
      })),
      columnFill: { ...this.tableColumnFill },
      updatedAt: firebase.default.firestore.FieldValue.serverTimestamp()
    };
    this.firestore
      .collection(FG_OVERVIEW_IMPORT_CACHE_COLLECTION)
      .doc(this.getImportCacheDocId())
      .set(payload)
      .then(() => {})
      .catch(err => console.error('FG Overview — lưu cache import:', err));
  }

  private deleteImportCacheFromFirebase(): void {
    this.firestore
      .collection(FG_OVERVIEW_IMPORT_CACHE_COLLECTION)
      .doc(this.getImportCacheDocId())
      .delete()
      .catch(err => console.error('FG Overview — xóa cache import:', err));
  }

  private loadImportCacheFromFirebase(): void {
    const cacheDocId = this.getImportCacheDocId();
    // Chuyển nhà máy thì reset về state rỗng trước, sau đó mới nạp bản cache tương ứng
    this.importFileName = null;
    this.importRowCount = 0;
    this.importCodesNormalized.clear();
    this.importLines = [];
    this.resetTableColumnFill();
    this.rebuildRows();

    this.firestore
      .collection(FG_OVERVIEW_IMPORT_CACHE_COLLECTION)
      .doc(cacheDocId)
      .get()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: snap => {
          if (!snap.exists) return;
          const d = snap.data() as Partial<FgOverviewImportCachePayload>;
          if (!d.lines || !Array.isArray(d.lines) || d.lines.length === 0) return;
          const lines: { norm: string; display: string; ton: number }[] = [];
          for (const row of d.lines) {
            if (!row || typeof row.display !== 'string' || typeof row.norm !== 'string') continue;
            const ton = typeof row.ton === 'number' && isFinite(row.ton) ? row.ton : 0;
            lines.push({ norm: row.norm, display: row.display.trim(), ton });
          }
          if (!lines.length) return;
          this.importFileName = typeof d.fileName === 'string' && d.fileName ? d.fileName : 'Đã lưu trên Firebase';
          this.applyImportedLines(lines, this.importFileName);
          if (d.columnFill && typeof d.columnFill === 'object') {
            this.tableColumnFill = {
              maTp: String(d.columnFill.maTp ?? ''),
              tonFg: String(d.columnFill.tonFg ?? ''),
              tonFile: String(d.columnFill.tonFile ?? ''),
              qtyDelta: String(d.columnFill.qtyDelta ?? ''),
              inImport: String(d.columnFill.inImport ?? ''),
              compare: String(d.columnFill.compare ?? ''),
              location: String(d.columnFill.location ?? '')
            };
          }
        },
        error: err => console.error('FG Overview — đọc cache import:', err)
      });
  }

  private getImportCacheDocId(): string {
    return `${FG_OVERVIEW_IMPORT_CACHE_DOC_PREFIX}${this.selectedFactory.toLowerCase()}`;
  }

  private resetTableColumnFill(): void {
    this.tableColumnFill = {
      maTp: '',
      tonFg: '',
      tonFile: '',
      qtyDelta: '',
      inImport: '',
      compare: '',
      location: ''
    };
  }

  private applyImportedLines(
    lines: { norm: string; display: string; ton: number }[],
    fileName: string | null
  ): void {
    this.importLines = lines;
    this.importCodesNormalized = new Set(lines.map(l => l.norm));
    this.importRowCount = lines.length;
    if (fileName !== null) {
      this.importFileName = fileName;
    }
    this.rebuildRows();
  }

  get statusLineText(): string {
    if (this.importFileName) {
      return `FILE IMPORT ${this.importFileName} — ${this.importRowCount} dòng (từ dòng 7, cột A) • CACHE Mỗi nhà máy lưu 1 bản riêng (ASM1/ASM2), import mới sẽ ghi đè bản của đúng nhà máy đang chọn.`;
    }
    return 'FILE IMPORT Chưa có file import • CACHE Mỗi nhà máy lưu 1 bản riêng (ASM1/ASM2), import mới sẽ ghi đè bản của đúng nhà máy đang chọn.';
  }

  setFilter(f: typeof this.filterCompare): void {
    this.filterCompare = f;
  }

  /**
   * Ô fill của cột Mã TP:
   * - luôn tự động uppercase
   * - khi đủ 7 ký tự đầu hợp lệ (P/T/M/L + 6 số), áp dụng prefix này cho
   *   tất cả mã TP đang hiển thị có cùng 7 ký tự đầu (giữ nguyên phần suffix phía sau ký tự thứ 7).
   */
  onMaTpFillChange(rawValue: string): void {
    const upper = String(rawValue || '').toUpperCase();
    this.tableColumnFill.maTp = upper;

    if (upper.length < 7) return;
    const prefix = upper.slice(0, 7);
    if (!/^[PTML]\d{6}$/.test(prefix)) return;

    this.rows = this.rows.map(row => {
      const current = String(row.materialCode || '');
      if (current.length < 7) return row;
      const curPrefix = current.slice(0, 7).toUpperCase();
      if (curPrefix !== prefix) return row;
      return {
        ...row,
        materialCode: `${prefix}${current.slice(7)}`
      };
    });
  }

  /** Template không có sẵn `Math` — dùng hàm này thay cho Math.abs trong HTML. */
  isQtyDeltaSignificant(delta: number | null | undefined): boolean {
    if (delta === null || delta === undefined || !isFinite(delta)) {
      return false;
    }
    return Math.abs(delta) >= 1e-6;
  }

  get filteredRows(): FgOverviewRow[] {
    if (this.filterCompare === 'all') return this.rows;
    if (this.filterCompare === 'mismatch') {
      return this.rows.filter(
        r =>
          r.compare !== 'Khớp' ||
          r.normQtyMismatch ||
          (r.qtyDelta !== null && Math.abs(r.qtyDelta) >= 1e-6)
      );
    }
    if (this.filterCompare === 'missing_in_import') {
      return this.rows.filter(r => r.compare === 'Thiếu ở file import');
    }
    return this.rows.filter(r => r.compare === 'Dư so với FG Inventory');
  }

  downloadComparisonReport(): void {
    const reportRows = this.filteredRows.map((r, idx) => ({
      STT: idx + 1,
      'Mã TP': r.materialCode,
      'Tồn FG Inventory': r.tonFg,
      'Tồn file import': r.inImport ? r.tonImport : '',
      'So sánh lượng': r.qtyDelta ?? '',
      'Có trong file import': r.inImport ? 'Có' : 'Không',
      'So sánh mã': r.compare,
      'Vị trí': r.location || ''
    }));

    const ws = XLSX.utils.json_to_sheet(reportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'FG_Overview_Report');
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `FG_Overview_Compare_${this.selectedFactory}_${dateStr}.xlsx`;
    XLSX.writeFile(wb, filename);
    this.closeMoreMenu();
  }

  private normalizeCode(code: string): string {
    return String(code || '').trim().toUpperCase();
  }

  /**
   * Chỉ nhận mã TP: 7 ký tự đầu = (P | T | M | L) + 6 chữ số (không phân biệt hoa thường ở chữ cái đầu).
   * Phần sau ký tự thứ 7 (nếu có) không kiểm tra.
   */
  private isValidMaTpFormat(code: string): boolean {
    const s = String(code || '').trim();
    if (s.length < 7) return false;
    const head = s.slice(0, 7).toUpperCase();
    return /^[PTML]\d{6}$/.test(head);
  }

  /**
   * Đọc file import cố định: dòng 7 trở đi (chỉ số mảng 6),
   * cột A (0) = Mã TP, cột F (5) = số lượng tồn kho.
   */
  private parseImportFromRow7(raw: any[][]): {
    lines: { norm: string; display: string; ton: number }[];
  } {
    const COL_MA_TP = 0; // A
    const COL_TON = 5; // F
    const START_INDEX = 6; // dòng 7 trên Excel (1-based)

    const lines: { norm: string; display: string; ton: number }[] = [];

    for (let i = START_INDEX; i < raw.length; i++) {
      const row = raw[i];
      if (!row || !row.length) continue;
      const codeCell = row[COL_MA_TP] != null ? String(row[COL_MA_TP]).trim() : '';
      if (!codeCell) continue;
      if (!this.isValidMaTpFormat(codeCell)) continue;
      const norm = this.normalizeCode(codeCell);
      if (!norm) continue;

      const qtyCell = row[COL_TON];
      let qty = 0;
      if (typeof qtyCell === 'number' && !isNaN(qtyCell)) {
        qty = qtyCell;
      } else {
        const s = String(qtyCell ?? '')
          .trim()
          .replace(/\s/g, '')
          .replace(',', '.');
        const n = parseFloat(s);
        qty = !isNaN(n) ? n : 0;
      }
      // Không hiển thị mã TP từ file import nếu lượng tồn <= 0
      if (!(qty > 0)) continue;
      lines.push({ norm, display: codeCell, ton: qty });
    }

    return { lines };
  }

  private rebuildRows(): void {
    const codesFg = new Set<string>();
    this.tonByCode.forEach((_, code) => codesFg.add(this.normalizeCode(code)));

    const codesImport = new Set(this.importCodesNormalized);

    const tonFgForNorm = (norm: string): number => {
      let t = 0;
      this.tonByCode.forEach((ton, code) => {
        if (this.normalizeCode(code) === norm) t += ton;
      });
      return t;
    };

    /** Tổng SL file theo mã (cộng mọi dòng cùng mã) */
    const sumImportByNorm = new Map<string, number>();
    this.importLines.forEach(line => {
      sumImportByNorm.set(line.norm, (sumImportByNorm.get(line.norm) || 0) + line.ton);
    });

    /** Chỉ số dòng cuối trong file cho từng mã (để hiển thị qtyDelta tổng một lần) */
    const lastLineIndexByNorm = new Map<string, number>();
    this.importLines.forEach((line, idx) => {
      lastLineIndexByNorm.set(line.norm, idx);
    });

    const list: FgOverviewRow[] = [];

    // Một dòng lưới = một dòng file import (thứ tự file)
    this.importLines.forEach((line, idx) => {
      const inFg = codesFg.has(line.norm);
      const tonFg = tonFgForNorm(line.norm);
      const sumImp = sumImportByNorm.get(line.norm) ?? 0;
      const normMismatch =
        inFg && Math.abs(sumImp - tonFg) >= 1e-6;
      const isLastForNorm = lastLineIndexByNorm.get(line.norm) === idx;
      const qtyDelta: number | null =
        isLastForNorm ? sumImp - tonFg : null;

      let compare: FgOverviewRow['compare'];
      if (inFg) compare = 'Khớp';
      else compare = 'Dư so với FG Inventory';

      list.push({
        materialCode: line.display,
        tonFg,
        tonImport: line.ton,
        location: this.locationsByCode.get(line.norm) || '',
        qtyDelta,
        normQtyMismatch: normMismatch,
        inImport: true,
        compare
      });
    });

    // Mã chỉ có trong FG, không có dòng nào trong file (chỉ mã đúng định dạng 7 ký tự đầu)
    codesFg.forEach(norm => {
      if (codesImport.has(norm)) return;
      let materialCode = norm;
      this.tonByCode.forEach((_, code) => {
        if (this.normalizeCode(code) === norm) {
          materialCode = code;
        }
      });
      if (!this.isValidMaTpFormat(materialCode)) return;
      const tonFg = tonFgForNorm(norm);
      list.push({
        materialCode,
        tonFg,
        tonImport: 0,
        location: this.locationsByCode.get(norm) || '',
        qtyDelta: null,
        normQtyMismatch: false,
        inImport: false,
        compare: 'Thiếu ở file import'
      });
    });

    // Thứ tự: giữ nguyên block dòng import, sau đó mã chỉ FG — sắp theo mã TP
    const importCount = this.importLines.length;
    const importPart = list.slice(0, importCount);
    const fgOnlyPart = list.slice(importCount).sort((a, b) =>
      a.materialCode.localeCompare(b.materialCode, 'vi', { sensitivity: 'base' })
    );
    this.rows = [...importPart, ...fgOnlyPart];
  }
}
