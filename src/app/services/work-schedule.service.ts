import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';

/** Nhóm nhân viên (đội). */
export interface WsGroup {
  id: string;
  name: string;
}

/** Công việc trên lịch — tùy chỉnh được; lsx/inbound gắn thống kê sống. */
export type WsTaskKind = 'custom' | 'lsx' | 'inbound';

export interface WsTask {
  id: string;
  label: string;
  kind: WsTaskKind;
  sort: number;
}

export type WsTaskKey = string;
export type WsSkills = Record<string, boolean>;

export interface WsEmployee {
  id: string;
  name: string;
  groupId: string | null;
  skills: WsSkills;
}

/** Phân công 1 ngày: mỗi công việc → danh sách id nhân viên. */
export type WsDayAssignment = Record<string, string[]>;

export interface WsWeek {
  weekStart: string;
  days: Record<string, WsDayAssignment>;
}

export interface WsLsxLive {
  total: number;
  waiting: number;
  kitting: number;
  ready: number;
  done: number;
  items: Array<{ lsx: string; status: string; productCode: string }>;
}

export interface WsInboundLive {
  total: number;
  waiting: number;
  received: number;
  items: Array<{ code: string; po: string; received: boolean }>;
}

export const DEFAULT_WS_TASKS: WsTask[] = [
  { id: 'soanLsx', label: 'Soạn LSX', kind: 'lsx', sort: 0 },
  { id: 'nhanNvl', label: 'Nhận NVL', kind: 'inbound', sort: 1 },
  { id: 'giaoLsx', label: 'Giao LSX', kind: 'custom', sort: 2 }
];

/** @deprecated dùng DEFAULT_WS_TASKS */
export const WS_TASKS = DEFAULT_WS_TASKS;

function emptyDayAssignment(taskIds: string[] = []): WsDayAssignment {
  const out: WsDayAssignment = {};
  for (const id of taskIds) out[id] = [];
  return out;
}

@Injectable({ providedIn: 'root' })
export class WorkScheduleService {
  private readonly groupsDocPath = 'work-schedule-settings/groups';
  private readonly employeesDocPath = 'work-schedule-settings/employees';
  private readonly tasksDocPath = 'work-schedule-settings/tasks';
  private readonly weeksCollection = 'work-schedule-weeks';

  private groupsCache: WsGroup[] | null = null;
  private employeesCache: WsEmployee[] | null = null;
  private tasksCache: WsTask[] | null = null;

  constructor(private firestore: AngularFirestore) {}

  getWeekStart(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const dow = d.getDay();
    const diffToMonday = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + diffToMonday);
    return d;
  }

  formatYmd(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  weekDays(weekStart: Date): Date[] {
    const out: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      out.push(d);
    }
    return out;
  }

  asDate(value: any): Date | null {
    if (!value) return null;
    if (value instanceof Date && !isNaN(value.getTime())) return value;
    if (typeof value?.toDate === 'function') {
      const d = value.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? d : null;
    }
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  private isInWeek(date: Date | null, weekStart: Date): boolean {
    if (!date) return false;
    const start = new Date(weekStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return date >= start && date < end;
  }

  // ── Công việc ────────────────────────────────────────────────────────────

  async loadTasks(forceRefresh = false): Promise<WsTask[]> {
    if (!forceRefresh && this.tasksCache) return this.tasksCache;
    const snap = await this.firestore.doc(this.tasksDocPath).get().toPromise();
    const data = snap?.exists ? (snap.data() as { list?: WsTask[] }) : undefined;
    const list = Array.isArray(data?.list)
      ? data!.list
          .map((t, i) => ({
            id: String(t?.id || '').trim(),
            label: String(t?.label || '').trim(),
            kind: (t?.kind === 'lsx' || t?.kind === 'inbound' ? t.kind : 'custom') as WsTaskKind,
            sort: Number.isFinite(Number(t?.sort)) ? Number(t.sort) : i
          }))
          .filter((t) => t.id && t.label)
      : [];
    const resolved = list.length ? list.sort((a, b) => a.sort - b.sort) : DEFAULT_WS_TASKS.map((t) => ({ ...t }));
    this.tasksCache = resolved;
    return resolved;
  }

  private async saveTasks(list: WsTask[]): Promise<void> {
    const ordered = list.map((t, i) => ({ ...t, sort: i }));
    await this.firestore.doc(this.tasksDocPath).set({ list: ordered, updatedAt: new Date() }, { merge: true });
    this.tasksCache = ordered;
  }

  async addTask(label: string): Promise<WsTask> {
    const trimmed = label.trim();
    if (!trimmed) throw new Error('Nhập tên công việc.');
    const current = await this.loadTasks(true);
    if (current.some((t) => t.label.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(`Công việc "${trimmed}" đã có.`);
    }
    const task: WsTask = {
      id: this.firestore.createId(),
      label: trimmed,
      kind: 'custom',
      sort: current.length
    };
    await this.saveTasks([...current, task]);
    return task;
  }

  async renameTask(id: string, label: string): Promise<void> {
    const trimmed = label.trim();
    if (!trimmed) throw new Error('Nhập tên công việc.');
    const current = await this.loadTasks(true);
    await this.saveTasks(current.map((t) => (t.id === id ? { ...t, label: trimmed } : t)));
  }

  async deleteTask(id: string): Promise<void> {
    const current = await this.loadTasks(true);
    if (current.length <= 1) throw new Error('Phải giữ ít nhất 1 công việc.');
    await this.saveTasks(current.filter((t) => t.id !== id));
    const employees = await this.loadEmployees(true);
    const next = employees.map((e) => {
      const skills = { ...e.skills };
      delete skills[id];
      return { ...e, skills };
    });
    await this.saveEmployees(next);
  }

  // ── Nhóm ─────────────────────────────────────────────────────────────────

  async loadGroups(forceRefresh = false): Promise<WsGroup[]> {
    if (!forceRefresh && this.groupsCache) return this.groupsCache;
    const snap = await this.firestore.doc(this.groupsDocPath).get().toPromise();
    const data = snap?.exists ? (snap.data() as { list?: WsGroup[] }) : undefined;
    const list = Array.isArray(data?.list)
      ? data!.list.map((g) => ({ id: String(g?.id || ''), name: String(g?.name || '').trim() })).filter((g) => g.id && g.name)
      : [];
    this.groupsCache = list;
    return list;
  }

  private async saveGroups(list: WsGroup[]): Promise<void> {
    await this.firestore.doc(this.groupsDocPath).set({ list, updatedAt: new Date() }, { merge: true });
    this.groupsCache = list;
  }

  async addGroup(name: string): Promise<WsGroup> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Nhập tên nhóm.');
    const current = await this.loadGroups(true);
    if (current.some((g) => g.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(`Nhóm "${trimmed}" đã tồn tại.`);
    }
    const group: WsGroup = { id: this.firestore.createId(), name: trimmed };
    await this.saveGroups([...current, group]);
    return group;
  }

  async renameGroup(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Nhập tên nhóm.');
    const current = await this.loadGroups(true);
    await this.saveGroups(current.map((g) => (g.id === id ? { ...g, name: trimmed } : g)));
  }

  async deleteGroup(id: string): Promise<void> {
    const current = await this.loadGroups(true);
    await this.saveGroups(current.filter((g) => g.id !== id));
    const employees = await this.loadEmployees(true);
    await this.saveEmployees(employees.map((e) => (e.groupId === id ? { ...e, groupId: null } : e)));
  }

  // ── Nhân viên & kỹ năng ─────────────────────────────────────────────────

  private normalizeSkills(raw: any): WsSkills {
    const out: WsSkills = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [k, v] of Object.entries(raw)) {
      if (k) out[k] = !!v;
    }
    return out;
  }

  async loadEmployees(forceRefresh = false): Promise<WsEmployee[]> {
    if (!forceRefresh && this.employeesCache) return this.employeesCache;
    const snap = await this.firestore.doc(this.employeesDocPath).get().toPromise();
    const data = snap?.exists ? (snap.data() as { list?: WsEmployee[] }) : undefined;
    const list = Array.isArray(data?.list)
      ? data!.list
          .map((e) => ({
            id: String(e?.id || ''),
            name: String(e?.name || '').trim(),
            groupId: e?.groupId ? String(e.groupId) : null,
            skills: this.normalizeSkills(e?.skills)
          }))
          .filter((e) => e.id && e.name)
      : [];
    list.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    this.employeesCache = list;
    return list;
  }

  private async saveEmployees(list: WsEmployee[]): Promise<void> {
    const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    await this.firestore.doc(this.employeesDocPath).set({ list: sorted, updatedAt: new Date() }, { merge: true });
    this.employeesCache = sorted;
  }

  async addEmployee(name: string): Promise<WsEmployee> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Nhập tên nhân viên.');
    const current = await this.loadEmployees(true);
    if (current.some((e) => e.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error(`Nhân viên "${trimmed}" đã có trong danh sách.`);
    }
    const employee: WsEmployee = { id: this.firestore.createId(), name: trimmed, groupId: null, skills: {} };
    await this.saveEmployees([...current, employee]);
    return employee;
  }

  async updateEmployee(id: string, patch: Partial<Pick<WsEmployee, 'name' | 'groupId'>>): Promise<void> {
    const current = await this.loadEmployees(true);
    await this.saveEmployees(current.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  async setEmployeeSkill(id: string, taskKey: WsTaskKey, value: boolean): Promise<void> {
    const current = await this.loadEmployees(true);
    await this.saveEmployees(
      current.map((e) => (e.id === id ? { ...e, skills: { ...e.skills, [taskKey]: value } } : e))
    );
  }

  async deleteEmployee(id: string): Promise<void> {
    const current = await this.loadEmployees(true);
    await this.saveEmployees(current.filter((e) => e.id !== id));
  }

  hasAnySkill(employee: WsEmployee): boolean {
    return Object.values(employee.skills || {}).some(Boolean);
  }

  autoAssignFromSkills(
    employees: WsEmployee[],
    dayYmds: string[],
    tasks: WsTask[]
  ): Record<string, WsDayAssignment> {
    const idsByTask: Record<string, string[]> = {};
    for (const t of tasks) {
      idsByTask[t.id] = employees.filter((e) => !!e.skills[t.id]).map((e) => e.id);
    }
    const days: Record<string, WsDayAssignment> = {};
    for (const ymd of dayYmds) {
      const day: WsDayAssignment = {};
      for (const t of tasks) day[t.id] = [...(idsByTask[t.id] || [])];
      days[ymd] = day;
    }
    return days;
  }

  isDayAssignmentEmpty(a: WsDayAssignment | undefined): boolean {
    if (!a) return true;
    return Object.values(a).every((ids) => !ids || ids.length === 0);
  }

  normalizeDayAssignment(raw: any, taskIds: string[]): WsDayAssignment {
    const out = emptyDayAssignment(taskIds);
    if (!raw || typeof raw !== 'object') return out;
    for (const [k, v] of Object.entries(raw)) {
      if (Array.isArray(v)) out[k] = v.map(String);
    }
    return out;
  }

  // ── Phân công theo tuần ──────────────────────────────────────────────────

  async loadWeek(weekStartYmd: string, taskIds: string[] = []): Promise<WsWeek> {
    const snap = await this.firestore.doc(`${this.weeksCollection}/${weekStartYmd}`).get().toPromise();
    const data = snap?.exists ? (snap.data() as Partial<WsWeek>) : undefined;
    const days: Record<string, WsDayAssignment> = {};
    if (data?.days && typeof data.days === 'object') {
      for (const [ymd, a] of Object.entries(data.days)) {
        days[ymd] = this.normalizeDayAssignment(a, taskIds);
      }
    }
    return { weekStart: weekStartYmd, days };
  }

  async setDayTaskAssignment(
    weekStartYmd: string,
    dayYmd: string,
    taskKey: WsTaskKey,
    employeeIds: string[]
  ): Promise<void> {
    const ref = this.firestore.doc(`${this.weeksCollection}/${weekStartYmd}`);
    const snap = await ref.get().toPromise();
    if (!snap?.exists) {
      const days: Record<string, WsDayAssignment> = { [dayYmd]: { [taskKey]: employeeIds } };
      await ref.set({ weekStart: weekStartYmd, days, updatedAt: new Date() });
      return;
    }
    await ref.update({
      [`days.${dayYmd}.${taskKey}`]: employeeIds,
      updatedAt: new Date()
    });
  }

  async saveWeek(weekStartYmd: string, days: Record<string, WsDayAssignment>): Promise<void> {
    await this.firestore.doc(`${this.weeksCollection}/${weekStartYmd}`).set(
      { weekStart: weekStartYmd, days, updatedAt: new Date() },
      { merge: true }
    );
  }

  // ── LSX + NVL nhập kho (thống kê tuần đang xem) ──────────────────────────

  async loadLsxWeekSummary(weekStart: Date): Promise<WsLsxLive> {
    const cutoff = new Date(weekStart);
    cutoff.setDate(cutoff.getDate() - 14);
    const snap = await this.firestore
      .collection('work-orders', (ref) => ref.where('createdDate', '>=', cutoff).limit(2000))
      .get()
      .toPromise();
    const empty: WsLsxLive = { total: 0, waiting: 0, kitting: 0, ready: 0, done: 0, items: [] };
    const docs = snap?.docs || [];
    const items: WsLsxLive['items'] = [];
    for (const doc of docs) {
      const d = doc.data() as any;
      const delivery = this.asDate(d.deliveryDate) || this.asDate(d.planReceivedDate) || this.asDate(d.createdDate);
      if (!this.isInWeek(delivery, weekStart) && !this.isInWeek(this.asDate(d.createdDate), weekStart)) continue;
      const status = String(d.status || 'waiting').toLowerCase();
      empty.total += 1;
      if (status === 'waiting' || status === 'delay') empty.waiting += 1;
      else if (status === 'kitting') empty.kitting += 1;
      else if (status === 'ready' || status === 'transfer') empty.ready += 1;
      else if (status === 'done') empty.done += 1;
      else empty.waiting += 1;
      if (items.length < 8) {
        items.push({
          lsx: String(d.productionOrder || '').trim() || '—',
          status,
          productCode: String(d.productCode || '').trim()
        });
      }
    }
    empty.items = items;
    return empty;
  }

  async loadInboundWeekSummary(weekStart: Date): Promise<WsInboundLive> {
    const start = new Date(weekStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    end.setMilliseconds(-1);
    const empty: WsInboundLive = { total: 0, waiting: 0, received: 0, items: [] };
    try {
      const snap = await this.firestore
        .collection('inbound-materials', (ref) =>
          ref.where('importDate', '>=', start).where('importDate', '<=', end).limit(3000)
        )
        .get()
        .toPromise();
      const items: WsInboundLive['items'] = [];
      for (const doc of snap?.docs || []) {
        const d = doc.data() as any;
        const received = !!d.isReceived;
        empty.total += 1;
        if (received) empty.received += 1;
        else empty.waiting += 1;
        if (items.length < 8) {
          items.push({
            code: String(d.materialCode || '').trim() || '—',
            po: String(d.poNumber || d.po || '').trim(),
            received
          });
        }
      }
      empty.items = items;
    } catch (e) {
      console.warn('loadInboundWeekSummary:', e);
    }
    return empty;
  }
}
