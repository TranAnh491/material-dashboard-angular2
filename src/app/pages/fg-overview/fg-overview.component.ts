import { Component, OnDestroy, OnInit } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import * as XLSX from 'xlsx';

export interface FgOverviewRow {
  materialCode: string;
  tonFg: number;
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
  /** Mã TP từ file import (chuẩn hóa trim, uppercase để so sánh ổn định) */
  private importCodesNormalized = new Set<string>();
  /** Map hiển thị mã gốc từ file theo key chuẩn hóa */
  private importDisplayByNorm = new Map<string, string>();

  rows: FgOverviewRow[] = [];
  importFileName: string | null = null;
  importRowCount = 0;

  filterCompare: 'all' | 'mismatch' | 'missing_in_import' | 'extra_in_import' = 'all';

  private destroy$ = new Subject<void>();

  constructor(private firestore: AngularFirestore) {}

  ngOnInit(): void {
    this.loadFgInventory();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  setFactory(f: 'ASM1' | 'ASM2'): void {
    if (this.selectedFactory === f) return;
    this.selectedFactory = f;
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
          snap.docs.forEach(doc => {
            const d = doc.data() as { materialCode?: string; ton?: number };
            const code = String(d.materialCode || '').trim();
            if (!code) return;
            const ton = typeof d.ton === 'number' && !isNaN(d.ton) ? d.ton : 0;
            this.tonByCode.set(code, (this.tonByCode.get(code) || 0) + ton);
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
        const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];
        const codes = this.parseImportCodes(raw);
        this.importCodesNormalized.clear();
        this.importDisplayByNorm.clear();
        codes.forEach(({ norm, display }) => {
          this.importCodesNormalized.add(norm);
          if (!this.importDisplayByNorm.has(norm)) {
            this.importDisplayByNorm.set(norm, display);
          }
        });
        this.importRowCount = codes.length;
        this.rebuildRows();
      } catch (err) {
        console.error('FG Overview import:', err);
        this.importFileName = null;
        this.importRowCount = 0;
        alert('Không đọc được file. Dùng file .xlsx/.xls có cột Mã TP (hoặc cột C như template FG Inventory).');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  clearImport(): void {
    this.importFileName = null;
    this.importRowCount = 0;
    this.importCodesNormalized.clear();
    this.importDisplayByNorm.clear();
    this.rebuildRows();
  }

  setFilter(f: typeof this.filterCompare): void {
    this.filterCompare = f;
  }

  get filteredRows(): FgOverviewRow[] {
    if (this.filterCompare === 'all') return this.rows;
    if (this.filterCompare === 'mismatch') {
      return this.rows.filter(r => r.compare !== 'Khớp');
    }
    if (this.filterCompare === 'missing_in_import') {
      return this.rows.filter(r => r.compare === 'Thiếu ở file import');
    }
    return this.rows.filter(r => r.compare === 'Dư so với FG Inventory');
  }

  private normalizeCode(code: string): string {
    return String(code || '').trim().toUpperCase();
  }

  private isHeaderRow(row: any[]): boolean {
    if (!row || row.length === 0) return true;
    const cells = row.slice(0, 12).map(c => String(c || '').toLowerCase());
    return cells.some(
      c =>
        c.includes('nhà máy') ||
        c.includes('factory') ||
        c.includes('mã tp') ||
        c.includes('ma tp') ||
        c.includes('mã hàng') ||
        c.includes('material')
    );
  }

  private findMaTpColumnIndex(headerRow: any[]): number {
    const norm = (s: string) =>
      String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
    for (let i = 0; i < headerRow.length; i++) {
      const h = norm(headerRow[i]);
      if (
        h.includes('ma tp') ||
        h.includes('ma hang') ||
        h.includes('material code') ||
        h === 'materialcode' ||
        (h.includes('ma') && h.includes('tp'))
      ) {
        return i;
      }
    }
    return 2;
  }

  private parseImportCodes(raw: any[][]): { norm: string; display: string }[] {
    const rows = raw.filter(r => r && r.length > 0);
    if (rows.length === 0) return [];

    let start = 0;
    let colIndex = 2;
    if (this.isHeaderRow(rows[0])) {
      colIndex = this.findMaTpColumnIndex(rows[0]);
      start = 1;
    }

    const out: { norm: string; display: string }[] = [];
    const seen = new Set<string>();
    for (let i = start; i < rows.length; i++) {
      const row = rows[i];
      const cell = row[colIndex] != null ? String(row[colIndex]).trim() : '';
      if (!cell) continue;
      const norm = this.normalizeCode(cell);
      if (!norm) continue;
      if (seen.has(norm)) continue;
      seen.add(norm);
      out.push({ norm, display: cell });
    }
    return out;
  }

  private rebuildRows(): void {
    const codesFg = new Set<string>();
    this.tonByCode.forEach((_, code) => codesFg.add(this.normalizeCode(code)));

    const codesImport = new Set(this.importCodesNormalized);

    const unionNorm = new Set<string>();
    codesFg.forEach(c => unionNorm.add(c));
    codesImport.forEach(c => unionNorm.add(c));

    const displayByNorm = new Map<string, string>();
    this.tonByCode.forEach((_, code) => {
      const n = this.normalizeCode(code);
      if (!displayByNorm.has(n)) displayByNorm.set(n, code);
    });
    this.importDisplayByNorm.forEach((disp, n) => {
      if (!displayByNorm.has(n)) displayByNorm.set(n, disp);
    });

    const list: FgOverviewRow[] = [];
    unionNorm.forEach(norm => {
      const inFg = codesFg.has(norm);
      const inImp = codesImport.has(norm);
      const materialCode = displayByNorm.get(norm) || norm;

      let tonFg = 0;
      this.tonByCode.forEach((ton, code) => {
        if (this.normalizeCode(code) === norm) tonFg += ton;
      });

      let compare: FgOverviewRow['compare'];
      if (inFg && inImp) compare = 'Khớp';
      else if (inFg && !inImp) compare = 'Thiếu ở file import';
      else compare = 'Dư so với FG Inventory';

      list.push({
        materialCode,
        tonFg,
        inImport: inImp,
        compare
      });
    });

    list.sort((a, b) => {
      const rank = (c: FgOverviewRow['compare']) =>
        c === 'Khớp' ? 2 : c === 'Thiếu ở file import' ? 0 : 1;
      const ra = rank(a.compare);
      const rb = rank(b.compare);
      if (ra !== rb) return ra - rb;
      return a.materialCode.localeCompare(b.materialCode, 'vi', { sensitivity: 'base' });
    });

    this.rows = list;
  }
}
