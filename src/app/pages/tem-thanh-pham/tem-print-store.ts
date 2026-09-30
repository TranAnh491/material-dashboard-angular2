import { Injectable } from '@angular/core';

/** Sống cùng shell: rời tab là hỏi lại nhà máy. */
@Injectable()
export class TemPlantSession {
  plant: '' | 'ASM1' | 'ASM2' = '';

  choose(plant: 'ASM1' | 'ASM2'): void {
    this.plant = plant;
  }

  clear(): void {
    this.plant = '';
  }

  get prefix(): string {
    return this.plant === 'ASM2' ? 'LHLSX' : 'KZLSX';
  }

  get label(): string {
    return this.plant === 'ASM2' ? 'ASM2' : 'ASM1 / ASM3';
  }
}

/** Nút Import ở sidebar gọi vào trang tem. */
@Injectable()
export class TemImportBus {
  private listener: ((file: File) => void) | null = null;
  private pending: File | null = null;
  private importedAt = '';

  constructor() {
    try {
      this.importedAt = localStorage.getItem('tem-tp-import-at-v1') || '';
    } catch {
      this.importedAt = '';
    }
  }

  listen(fn: (file: File) => void): () => void {
    this.listener = fn;
    if (this.pending) {
      const file = this.pending;
      this.pending = null;
      fn(file);
    }
    return () => {
      if (this.listener === fn) this.listener = null;
    };
  }

  send(file: File): void {
    if (this.listener) this.listener(file);
    else this.pending = file;
  }

  markImported(): void {
    this.importedAt = new Date().toISOString();
    try {
      localStorage.setItem('tem-tp-import-at-v1', this.importedAt);
    } catch {
      /* ignore */
    }
  }

  /** Số ngày lịch kể từ lần import gần nhất. Vừa import trong ngày là 0. */
  daysSinceImport(): number | null {
    if (!this.importedAt) return null;
    const start = new Date(this.importedAt);
    if (isNaN(start.getTime())) return null;
    const from = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    return Math.max(0, Math.round((today - from) / 86400000));
  }
}

export interface TemPrintRecord {
  id: string;
  at: string;
  po: string;
  materialCode: string;
  asmCode: string;
  customerCode: string;
  pcs: string;
  workOrder: string;
  plant?: '' | 'ASM1' | 'ASM2';
  rev: string;
  netWeight: string;
  grossWeight: string;
  cartons: string[];
}

const HISTORY_KEY = 'tem-tp-print-history-v1';
const RESTORE_KEY = 'tem-tp-restore';

export function loadTemPrintHistory(): TemPrintRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTemPrintRecord(record: TemPrintRecord): void {
  const next = [record, ...loadTemPrintHistory()].slice(0, 200);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch { /* ignore */ }
}

export function stageTemRestore(record: TemPrintRecord): void {
  sessionStorage.setItem(RESTORE_KEY, JSON.stringify(record));
}

export function takeTemRestore(): TemPrintRecord | null {
  try {
    const raw = sessionStorage.getItem(RESTORE_KEY);
    sessionStorage.removeItem(RESTORE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as TemPrintRecord;
  } catch {
    return null;
  }
}
