import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import firebase from 'firebase/compat/app';
import * as XLSX from 'xlsx';
import {
  Equipment,
  EquipmentStaff,
  EquipmentStatus,
  InspectionFrequency,
  InspectionRecord,
  InspectionResult
} from '../pages/equipment-checklist/equipment-checklist.models';
import { EQUIPMENT_CATEGORIES } from '../pages/equipment-checklist/equipment-checklist.catalog';
import { buildSeedEquipment } from '../pages/equipment-checklist/equipment-checklist.seed';

const EQUIPMENT_COL = 'warehouse-equipment';
const INSPECTION_COL = 'warehouse-equipment-inspections';
const STAFF_COL = 'warehouse-equipment-staff';

@Injectable({ providedIn: 'root' })
export class EquipmentChecklistService {
  constructor(private firestore: AngularFirestore) {}

  async listStaff(): Promise<EquipmentStaff[]> {
    const snap = await this.firestore.collection(STAFF_COL).get().toPromise();
    return (snap?.docs || [])
      .map(d => d.data() as EquipmentStaff)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'));
  }

  async saveStaff(row: EquipmentStaff): Promise<void> {
    const employeeId = row.employeeId.trim().toUpperCase();
    const name = row.name.trim();
    if (!employeeId || !name) throw new Error('Nhân viên cần có tên và mã nhân viên.');
    await this.firestore.collection(STAFF_COL).doc(employeeId).set({ employeeId, name });
  }

  async deleteStaff(employeeId: string): Promise<void> {
    const id = employeeId.trim().toUpperCase();
    if (!id) return;
    await this.firestore.collection(STAFF_COL).doc(id).delete();
  }

  async listEquipment(): Promise<Equipment[]> {
    const snap = await this.firestore.collection(EQUIPMENT_COL).get().toPromise();
    const rows = (snap?.docs || []).map(d => d.data() as Equipment);
    return rows.sort((a, b) =>
      a.categoryId.localeCompare(b.categoryId)
      || a.subcategoryId.localeCompare(b.subcategoryId)
      || a.stt - b.stt
      || a.managementCode.localeCompare(b.managementCode, 'vi')
    );
  }

  /** Nạp danh mục ban đầu. Máy đã có thì giữ nguyên, không ghi đè. */
  async ensureSeeded(): Promise<number> {
    const existing = await this.listEquipment();
    const have = new Set(existing.map(row => row.equipmentId));
    const blocked = await this.deletedEquipmentIds();
    const missing = buildSeedEquipment().filter(row => !have.has(row.equipmentId) && !blocked.has(row.equipmentId));
    if (!missing.length) return 0;
    const batch = this.firestore.firestore.batch();
    const now = new Date().toISOString();
    missing.forEach(row => {
      const ref = this.firestore.firestore.collection(EQUIPMENT_COL).doc(docId(row.equipmentId));
      batch.set(ref, stripEmpty({ ...row, createdAt: now, updatedAt: now }));
    });
    await batch.commit();
    return missing.length;
  }

  async saveEquipment(row: Equipment, isNew: boolean): Promise<void> {
    const code = row.managementCode.trim();
    if (!code || !row.equipmentName.trim()) {
      throw new Error('Thiết bị cần có tên và mã số quản lý.');
    }
    const equipmentId = (row.equipmentId || code).trim();
    const id = docId(equipmentId);
    const ref = this.firestore.collection(EQUIPMENT_COL).doc(id);
    const existing = await ref.get().toPromise();
    if (isNew && existing?.exists) {
      throw new Error(`Mã ${code} đã có trong danh mục thiết bị.`);
    }
    const now = new Date().toISOString();
    const payload: Equipment = {
      ...row,
      equipmentId,
      managementCode: code,
      equipmentName: row.equipmentName.trim(),
      responsiblePerson: blankToNull(row.responsiblePerson),
      responsibleEmployeeId: blankToNull(row.responsibleEmployeeId),
      stt: Number(row.stt) || 0,
      updatedAt: now,
      createdAt: existing?.exists ? (existing.data() as Equipment).createdAt || now : now
    };
    await ref.set(stripEmpty(payload), { merge: true });
  }

  /** Xóa thiết bị và các lần kiểm tra. Mã đã xóa không được nạp lại từ danh mục gốc. */
  async deleteEquipment(equipmentIds: string[]): Promise<void> {
    const ids = [...new Set(equipmentIds.map(id => id.trim()).filter(Boolean))];
    if (!ids.length) return;
    const db = this.firestore.firestore;
    const refs = ids.map(id => db.collection(EQUIPMENT_COL).doc(docId(id)));
    for (let i = 0; i < ids.length; i += 10) {
      const snap = await db.collection(INSPECTION_COL).where('equipmentId', 'in', ids.slice(i, i + 10)).get();
      snap.docs.forEach(doc => refs.push(doc.ref));
    }
    for (let i = 0; i < refs.length; i += 400) {
      const batch = db.batch();
      refs.slice(i, i + 400).forEach(ref => batch.delete(ref));
      await batch.commit();
    }
    await db.collection('warehouse-equipment-meta').doc('deleted').set({
      ids: firebase.firestore.FieldValue.arrayUnion(...ids)
    }, { merge: true });
  }

  async loadItemCatalog(): Promise<{ checklists: Record<string, string[]>; maintenanceItems: string[] }> {
    const snap = await this.firestore.firestore.collection('warehouse-equipment-meta').doc('catalog').get();
    const data = snap.data() || {};
    const checklists = (data.checklists || {}) as Record<string, string[]>;
    const maintenanceItems = Array.isArray(data.maintenanceItems) ? data.maintenanceItems.map(item => String(item)) : [];
    return { checklists, maintenanceItems };
  }

  async saveItemCatalog(checklists: Record<string, string[]>, maintenanceItems: string[]): Promise<void> {
    await this.firestore.firestore.collection('warehouse-equipment-meta').doc('catalog').set({
      checklists,
      maintenanceItems
    });
  }

  private async deletedEquipmentIds(): Promise<Set<string>> {
    const snap = await this.firestore.firestore.collection('warehouse-equipment-meta').doc('deleted').get();
    const ids = (snap.data()?.ids as string[] | undefined) || [];
    return new Set(ids);
  }

  async listInspections(year: number, month: number): Promise<InspectionRecord[]> {
    const start = new Date(year, month - 1, 1);
    start.setDate(start.getDate() - 6);
    const from = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    const to = `${year}-${String(month).padStart(2, '0')}-31`;
    const snap = await this.firestore.collection(INSPECTION_COL, ref =>
      ref.where('inspectionDate', '>=', from).where('inspectionDate', '<=', to)
    ).get().toPromise();
    return (snap?.docs || []).map(d => d.data() as InspectionRecord);
  }

  async listHistory(equipmentId: string): Promise<InspectionRecord[]> {
    const snap = await this.firestore.collection(INSPECTION_COL, ref =>
      ref.where('equipmentId', '==', equipmentId)
    ).get().toPromise();
    return (snap?.docs || [])
      .map(d => d.data() as InspectionRecord)
      .sort((a, b) => b.inspectionDate.localeCompare(a.inspectionDate));
  }

  /** Một thiết bị chỉ một kết quả cho một ngày. Kiểm tra lại cùng ngày thì cập nhật bản ghi cũ. */
  async upsertInspection(record: InspectionRecord): Promise<void> {
    const equipmentId = record.equipmentId.trim();
    const inspectionDate = record.inspectionDate;
    if (!equipmentId || !inspectionDate) throw new Error('Thiếu thiết bị hoặc ngày kiểm tra.');
    const id = `${docId(equipmentId)}__${inspectionDate}`;
    const ref = this.firestore.collection(INSPECTION_COL).doc(id);
    const existing = await ref.get().toPromise();
    const now = new Date().toISOString();
    const payload: InspectionRecord = {
      ...record,
      inspectionId: id,
      equipmentId,
      inspectionDate,
      inspector: record.inspector.trim(),
      createdAt: existing?.exists ? (existing.data() as InspectionRecord).createdAt || now : now,
      updatedAt: now
    };
    await ref.set(stripEmpty(payload));
  }

  async importEquipmentRows(
    rows: Array<Record<string, unknown>>,
    year: number,
    month: number
  ): Promise<{ added: number; updated: number; skipped: number; inspections: number }> {
    const current = await this.listEquipment();
    const byCode = new Map(current.map(e => [e.managementCode.toUpperCase(), e]));
    let added = 0;
    let updated = 0;
    let skipped = 0;
    let inspections = 0;
    for (const raw of rows) {
      const managementCode = pick(raw, ['managementCode', 'Mã số quản lý', 'Mã quản lý', 'Mã thiết bị', 'Mã']);
      const equipmentName = pick(raw, ['equipmentName', 'Tên thiết bị', 'Tên', 'Thiết bị']);
      if (!managementCode || !equipmentName) {
        skipped += 1;
        continue;
      }
      const subcategoryLabel = pick(raw, ['subcategory', 'Nhóm thiết bị', 'Nhóm con', 'Loại']);
      const categoryLabel = pick(raw, ['category', 'Nhóm lớn', 'Nhóm']);
      const matched = matchCategory(categoryLabel, subcategoryLabel);
      const person = pick(raw, ['responsiblePerson', 'NV phụ trách', 'Nhân viên phụ trách', 'Người phụ trách']);
      const asp = pick(raw, ['responsibleEmployeeId', 'Mã NV', 'Mã nhân viên', 'ASP']);
      const frequency = parseFrequency(pick(raw, ['frequency', 'Tần suất', 'Chu kỳ']));
      const status = parseStatus(pick(raw, ['status', 'Trạng thái']));
      const stt = Number(pick(raw, ['stt', 'STT'])) || 0;
      const key = managementCode.toUpperCase();
      const prev = byCode.get(key);
      const row: Equipment = {
        equipmentId: managementCode,
        stt: stt || prev?.stt || 0,
        categoryId: matched?.categoryId || prev?.categoryId || 'lift',
        subcategoryId: matched?.subcategoryId || prev?.subcategoryId || 'pallet-truck',
        equipmentName,
        managementCode,
        responsiblePerson: person ? person : null,
        responsibleEmployeeId: asp ? asp.toUpperCase() : (prev?.responsibleEmployeeId ?? null),
        frequency: frequency || prev?.frequency || 'daily',
        status: status || prev?.status || 'ACTIVE',
        checkBy: prev?.checkBy || 'computer'
      };
      await this.saveEquipment(row, !prev);
      byCode.set(key, row);
      if (prev) updated += 1;
      else added += 1;
      inspections += await this.importDayCells(raw, managementCode, person, year, month);
    }
    return { added, updated, skipped, inspections };
  }

  private async importDayCells(
    raw: Record<string, unknown>,
    equipmentId: string,
    person: string,
    year: number,
    month: number
  ): Promise<number> {
    let count = 0;
    const max = new Date(year, month, 0).getDate();
    for (let day = 1; day <= max; day++) {
      const value = pick(raw, [String(day), `Ngày ${day}`, `Day ${day}`]).toUpperCase();
      if (value !== 'PASS' && value !== 'FAIL' && value !== 'NA') continue;
      await this.upsertInspection({
        inspectionId: '',
        equipmentId,
        inspectionDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        inspector: person || 'Import',
        result: value
      });
      count += 1;
    }
    return count;
  }

  readExcel(file: ArrayBuffer): Array<Record<string, unknown>> {
    const wb = XLSX.read(file, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  }

  exportMonth(equipment: Equipment[], records: InspectionRecord[], year: number, month: number): void {
    const days = daysOfMonth(year, month);
    const byKey = new Map(records.map(r => [`${r.equipmentId}|${r.inspectionDate}`, r.result]));
    const aoa: Array<Array<string | number>> = [[
      'STT', 'Tên thiết bị', 'Mã số quản lý', 'NV phụ trách', 'Tần suất',
      ...days.map(d => `Ngày ${d}`)
    ]];
    equipment.forEach((eq, index) => {
      aoa.push([
        index + 1,
        eq.equipmentName,
        eq.managementCode,
        eq.responsiblePerson || '',
        frequencyLabel(eq.frequency),
        ...days.map(d => {
          const key = `${eq.equipmentId}|${dateKey(year, month, d)}`;
          return byKey.get(key) || '';
        })
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Checklist');
    XLSX.writeFile(wb, `equipment-checklist-${year}-${String(month).padStart(2, '0')}.xlsx`);
  }
}

export function daysOfMonth(year: number, month: number): number[] {
  const n = new Date(year, month, 0).getDate();
  return Array.from({ length: n }, (_, i) => i + 1);
}

export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function frequencyLabel(f: InspectionFrequency): string {
  if (f === 'weekly') return 'Tuần';
  if (f === 'monthly') return 'Tháng';
  return 'Ngày';
}

export function periodDone(eq: Equipment, records: InspectionRecord[], day: string): boolean {
  const mine = records.filter(r => r.equipmentId === eq.equipmentId && isClosed(r.result));
  if (eq.frequency === 'monthly') return mine.some(r => r.inspectionDate.slice(0, 7) === day.slice(0, 7));
  if (eq.frequency === 'weekly') {
    const start = weekStart(day);
    const end = addDays(start, 6);
    return mine.some(r => r.inspectionDate >= start && r.inspectionDate <= end);
  }
  return mine.some(r => r.inspectionDate === day);
}

export function isClosed(result: InspectionResult): boolean {
  return result === 'PASS' || result === 'FAIL' || result === 'NA';
}

function weekStart(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toIso(d);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toIso(d);
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function docId(code: string): string {
  return code.trim().replace(/\//g, '_');
}

function blankToNull(v: string | null | undefined): string | null {
  const s = String(v ?? '').trim();
  return s ? s : null;
}

function stripEmpty<T extends object>(row: T): T {
  const out: Record<string, unknown> = {};
  Object.entries(row).forEach(([k, v]) => {
    if (v !== undefined) out[k] = v;
  });
  return out as T;
}

function pick(raw: Record<string, unknown>, keys: string[]): string {
  const map = new Map<string, unknown>();
  Object.entries(raw).forEach(([k, v]) => map.set(norm(k), v));
  for (const key of keys) {
    const v = map.get(norm(key));
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function matchCategory(categoryLabel: string, subcategoryLabel: string) {
  const sub = norm(subcategoryLabel);
  const cat = norm(categoryLabel);
  return EQUIPMENT_CATEGORIES.find(c => {
    const name = norm(c.subcategoryName);
    const group = norm(c.categoryName);
    return (sub && (name.includes(sub) || sub.includes(name))) || (cat && group.includes(cat) && !sub);
  }) || EQUIPMENT_CATEGORIES.find(c => sub && norm(c.subcategoryName).includes(sub.slice(0, 8)));
}

function parseFrequency(raw: string): InspectionFrequency | null {
  const s = norm(raw);
  if (!s) return null;
  if (s.includes('week') || s.includes('tuan')) return 'weekly';
  if (s.includes('month') || s.includes('thang')) return 'monthly';
  if (s.includes('day') || s.includes('ngay')) return 'daily';
  return null;
}

function parseStatus(raw: string): EquipmentStatus | null {
  const s = norm(raw);
  if (s === 'repair' || s.includes('sua')) return 'REPAIR';
  if (s === 'spare' || s.includes('du phong')) return 'SPARE';
  if (s === 'inactive' || s.includes('ngung') || s.includes('khong su dung')) return 'INACTIVE';
  if (s === 'disposed' || s.includes('thanh ly')) return 'DISPOSED';
  if (s === 'active' || s.includes('dang su dung') || s.includes('dang dung')) return 'ACTIVE';
  return null;
}
