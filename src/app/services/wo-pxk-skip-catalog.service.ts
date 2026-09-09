import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';

export type PxkSkipKind = 'prefix' | 'code' | 'warehouse';

export interface PxkSkipScanItem {
  id: string;
  kind: PxkSkipKind;
  value: string;
  always: boolean;
  skipThieu: boolean;
}

@Injectable({ providedIn: 'root' })
export class WoPxkSkipCatalogService {
  private readonly docPath = 'wo-settings/pxk-skip-scan-catalog';

  static readonly DEFAULT_ITEMS: ReadonlyArray<Omit<PxkSkipScanItem, 'id'>> = [
    { kind: 'prefix', value: 'R', always: false, skipThieu: true },
    { kind: 'prefix', value: 'B030', always: false, skipThieu: false },
    { kind: 'prefix', value: 'B033', always: false, skipThieu: false },
    { kind: 'code', value: 'B036004', always: true, skipThieu: true },
    { kind: 'warehouse', value: 'NVL_SX', always: true, skipThieu: false }
  ];

  private cached: PxkSkipScanItem[] | null = null;

  constructor(private firestore: AngularFirestore) {}

  kindLabel(kind: PxkSkipKind): string {
    if (kind === 'prefix') return 'Đầu mã';
    if (kind === 'warehouse') return 'Mã kho';
    return 'Mã';
  }

  noteOf(item: PxkSkipScanItem): string {
    if (item.kind === 'warehouse') {
      return 'Coi như đã giao — tự điền xuất đủ, không cần scan.';
    }
    const base = item.always
      ? 'Luôn tự điền xuất đủ, không cần scan.'
      : 'Tự điền xuất đủ khi LSX đã có scan.';
    return item.skipThieu ? `${base} Không tính thiếu.` : base;
  }

  normalizeValue(raw: string): string {
    return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  inferKind(value: string): PxkSkipKind {
    const v = this.normalizeValue(value);
    if (!v) return 'code';
    if (v.startsWith('NVL') || v === '00') return 'warehouse';
    if (/^[ABR]$/.test(v) || /^[ABR]\d{3}$/.test(v)) return 'prefix';
    return 'code';
  }

  matchesMaterial(code: string, item: PxkSkipScanItem): boolean {
    if (item.kind === 'warehouse') return false;
    const c = this.normalizeValue(code);
    if (!c || !item.value) return false;
    return c === item.value || c.startsWith(item.value);
  }

  matchesWarehouse(maKho: string, item: PxkSkipScanItem): boolean {
    return item.kind === 'warehouse' && this.normalizeValue(maKho) === item.value;
  }

  isAutoFull(code: string, items: PxkSkipScanItem[]): boolean {
    return items.some((it) => this.matchesMaterial(code, it));
  }

  isAlwaysFull(code: string, items: PxkSkipScanItem[]): boolean {
    return items.some((it) => it.always && this.matchesMaterial(code, it));
  }

  isSkipThieu(code: string, items: PxkSkipScanItem[]): boolean {
    return items.some((it) => it.skipThieu && this.matchesMaterial(code, it));
  }

  isSkipWarehouse(maKho: string, items: PxkSkipScanItem[]): boolean {
    return items.some((it) => this.matchesWarehouse(maKho, it));
  }

  async load(forceRefresh = false): Promise<PxkSkipScanItem[]> {
    if (!forceRefresh && this.cached) return this.cached;

    const snap = await this.firestore.doc(this.docPath).get().toPromise();
    if (!snap?.exists) {
      const items = WoPxkSkipCatalogService.DEFAULT_ITEMS.map((s) => ({
        id: this.firestore.createId(),
        ...s
      }));
      await this.firestore.doc(this.docPath).set({ items, updatedAt: new Date() });
      this.cached = items;
      return items;
    }

    const data = snap.data() as { items?: PxkSkipScanItem[] } | undefined;
    const items = Array.isArray(data?.items)
      ? data.items
          .map((s) => this.normalizeItem(s))
          .filter((s) => !!s.value)
      : [];
    this.cached = items;
    return items;
  }

  async add(rawValue: string, kind?: PxkSkipKind): Promise<PxkSkipScanItem> {
    const value = this.normalizeValue(rawValue);
    if (!value) throw new Error('Nhập mã hoặc đầu mã.');
    const resolvedKind = kind || this.inferKind(value);
    const current = await this.load(true);
    if (current.some((s) => s.value === value && s.kind === resolvedKind)) {
      throw new Error(`${value} đã có trong danh mục.`);
    }
    const item: PxkSkipScanItem = {
      id: this.firestore.createId(),
      kind: resolvedKind,
      value,
      always: true,
      skipThieu: resolvedKind !== 'warehouse'
    };
    const next = [...current, item];
    await this.firestore.doc(this.docPath).set({ items: next, updatedAt: new Date() }, { merge: true });
    this.cached = next;
    return item;
  }

  async remove(id: string): Promise<void> {
    const current = await this.load(true);
    const next = current.filter((s) => s.id !== id);
    await this.firestore.doc(this.docPath).set({ items: next, updatedAt: new Date() }, { merge: true });
    this.cached = next;
  }

  private normalizeItem(raw: Partial<PxkSkipScanItem> | null | undefined): PxkSkipScanItem {
    const value = this.normalizeValue(String(raw?.value || ''));
    const kind: PxkSkipKind =
      raw?.kind === 'prefix' || raw?.kind === 'code' || raw?.kind === 'warehouse'
        ? raw.kind
        : this.inferKind(value);
    return {
      id: String(raw?.id || this.firestore.createId()),
      kind,
      value,
      always: raw?.always !== false,
      skipThieu: raw?.skipThieu !== false && kind !== 'warehouse'
    };
  }
}
