import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';

export interface WoCreatedByStaff {
  id: string;
  /** Tên hiển thị trên dropdown (vd: Tình) */
  name: string;
  /** Giá trị lưu Firebase — UPPERCASE, khớp `normalizeCreatedBy` */
  value: string;
}

/** Danh mục người soạn LSX — thêm/xóa từ tab Work Order Status → KHÁC. */
@Injectable({ providedIn: 'root' })
export class WoCreatedByStaffService {
  private readonly docPath = 'wo-settings/created-by-staff';

  static readonly DEFAULT_STAFF: ReadonlyArray<{ name: string; value: string }> = [
    { value: 'TÌNH', name: 'Tình' },
    { value: 'TUẤN', name: 'Tuấn' },
    { value: 'VŨ', name: 'Vũ' },
    { value: 'PHÚC', name: 'Phúc' },
    { value: 'TRÍ', name: 'Trí' },
    { value: 'ĐÔNG', name: 'Đông' },
    { value: 'THỊNH', name: 'Thịnh' },
    { value: 'ÂN', name: 'Ân' },
    { value: 'HOÀNG', name: 'Hoàng' },
  ];

  private cached: WoCreatedByStaff[] | null = null;

  constructor(private firestore: AngularFirestore) {}

  pickerDefaults(): Array<{ value: string; label: string }> {
    return WoCreatedByStaffService.DEFAULT_STAFF.map((s) => ({ value: s.value, label: s.name }));
  }

  displayName(raw: string): string {
    const first = String(raw ?? '').trim().split(/[,;\/|\n\r]+/)[0]?.trim() || '';
    return first.replace(/\s+/g, ' ');
  }

  normalizeValue(raw: string): string {
    return this.displayName(raw).toUpperCase();
  }

  async loadStaff(forceRefresh = false): Promise<WoCreatedByStaff[]> {
    if (!forceRefresh && this.cached) return this.cached;

    const snap = await this.firestore.doc(this.docPath).get().toPromise();
    if (!snap?.exists) {
      const staff = WoCreatedByStaffService.DEFAULT_STAFF.map((s) => ({
        id: this.firestore.createId(),
        name: s.name,
        value: s.value
      }));
      await this.firestore.doc(this.docPath).set({ staff, updatedAt: new Date() });
      this.cached = staff;
      return staff;
    }

    const data = snap.data() as { staff?: WoCreatedByStaff[] } | undefined;
    const staff = Array.isArray(data?.staff)
      ? data.staff
          .map((s) => ({
            id: String(s?.id || this.firestore.createId()),
            name: this.displayName(s?.name || s?.value || ''),
            value: this.normalizeValue(s?.value || s?.name || '')
          }))
          .filter((s) => s.value)
      : [];
    staff.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    this.cached = staff;
    return staff;
  }

  async addStaff(rawName: string): Promise<WoCreatedByStaff> {
    const name = this.displayName(rawName);
    const value = this.normalizeValue(rawName);
    if (!value) {
      throw new Error('Nhập tên nhân viên.');
    }
    const current = await this.loadStaff(true);
    if (current.some((s) => s.value === value)) {
      throw new Error(`"${name}" đã có trong danh mục.`);
    }
    const item: WoCreatedByStaff = { id: this.firestore.createId(), name, value };
    const next = [...current, item].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    await this.firestore.doc(this.docPath).set({ staff: next, updatedAt: new Date() }, { merge: true });
    this.cached = next;
    return item;
  }

  async deleteStaff(id: string): Promise<void> {
    const current = await this.loadStaff(true);
    const next = current.filter((s) => s.id !== id);
    await this.firestore.doc(this.docPath).set({ staff: next, updatedAt: new Date() }, { merge: true });
    this.cached = next;
  }

  labelFor(value: string): string {
    const key = String(value ?? '').trim().toUpperCase();
    if (!key) return '';
    const hit = (this.cached || []).find((s) => s.value === key);
    if (hit) return hit.name;
    const def = WoCreatedByStaffService.DEFAULT_STAFF.find((s) => s.value === key);
    return def?.name || value || '';
  }
}
