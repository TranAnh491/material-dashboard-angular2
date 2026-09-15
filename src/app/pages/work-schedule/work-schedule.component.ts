import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import {
  WorkScheduleService,
  WsDayAssignment,
  WsEmployee,
  WsGroup,
  WsInboundLive,
  WsLsxLive,
  WsTask,
  WsTaskKey
} from '../../services/work-schedule.service';

interface DayColumn {
  ymd: string;
  date: Date;
  label: string;
  dateLabel: string;
  isToday: boolean;
}

const DOW_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const BODY_CLASS = 'ws-fullscreen-layout';

@Component({
  selector: 'app-work-schedule',
  templateUrl: './work-schedule.component.html',
  styleUrls: ['./work-schedule.component.scss']
})
export class WorkScheduleComponent implements OnInit, OnDestroy {
  tasks: WsTask[] = [];
  activeView: 'schedule' | 'settings' = 'schedule';
  loading = false;
  liveLoading = false;
  saving = false;
  errorMessage = '';

  groups: WsGroup[] = [];
  employees: WsEmployee[] = [];

  weekStart!: Date;
  days: DayColumn[] = [];
  selectedDayYmd = '';
  assignments: Record<string, WsDayAssignment> = {};

  newGroupName = '';
  newEmployeeName = '';
  newTaskName = '';
  groupSaving = false;
  taskSaving = false;

  lsxLive: WsLsxLive = { total: 0, waiting: 0, kitting: 0, ready: 0, done: 0, items: [] };
  inboundLive: WsInboundLive = { total: 0, waiting: 0, received: 0, items: [] };
  liveUpdatedAt: Date | null = null;
  private liveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private ws: WorkScheduleService, private router: Router) {}

  async ngOnInit(): Promise<void> {
    document.body.classList.add(BODY_CLASS);
    this.weekStart = this.ws.getWeekStart(new Date());
    await this.loadCatalogs();
    await this.loadWeekData();
    await this.refreshLiveWork();
    this.liveTimer = setInterval(() => void this.refreshLiveWork(), 60000);
  }

  ngOnDestroy(): void {
    document.body.classList.remove(BODY_CLASS);
    if (this.liveTimer) {
      clearInterval(this.liveTimer);
      this.liveTimer = null;
    }
  }

  goToMenu(): void {
    this.router.navigate(['/menu']);
  }

  private async loadCatalogs(): Promise<void> {
    try {
      [this.groups, this.employees, this.tasks] = await Promise.all([
        this.ws.loadGroups(),
        this.ws.loadEmployees(),
        this.ws.loadTasks()
      ]);
    } catch (e) {
      console.error('❌ loadCatalogs (work-schedule):', e);
      this.errorMessage = 'Không tải được danh mục nhóm / nhân viên / công việc.';
    }
  }

  private buildDayColumns(): DayColumn[] {
    const today = this.ws.formatYmd(new Date());
    return this.ws.weekDays(this.weekStart).map((date) => {
      const ymd = this.ws.formatYmd(date);
      const dow = date.getDay();
      return {
        ymd,
        date,
        label: DOW_LABELS[dow],
        dateLabel: `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`,
        isToday: ymd === today
      };
    });
  }

  private pickDefaultDay(): void {
    const today = this.days.find((d) => d.isToday);
    this.selectedDayYmd = today?.ymd || this.days[0]?.ymd || '';
  }

  get selectedDay(): DayColumn | null {
    return this.days.find((d) => d.ymd === this.selectedDayYmd) || this.days[0] || null;
  }

  selectDay(ymd: string): void {
    this.selectedDayYmd = ymd;
  }

  async loadWeekData(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';
    try {
      this.days = this.buildDayColumns();
      if (!this.selectedDayYmd || !this.days.some((d) => d.ymd === this.selectedDayYmd)) {
        this.pickDefaultDay();
      }
      const weekStartYmd = this.ws.formatYmd(this.weekStart);
      const taskIds = this.tasks.map((t) => t.id);
      const week = await this.ws.loadWeek(weekStartYmd, taskIds);
      const dayYmds = this.days.map((d) => d.ymd);
      const auto = this.ws.autoAssignFromSkills(this.employees, dayYmds, this.tasks);
      const next: Record<string, WsDayAssignment> = {};
      const weekBlank = this.days.every((day) => this.ws.isDayAssignmentEmpty(week.days[day.ymd]));
      if (weekBlank) {
        for (const day of this.days) next[day.ymd] = auto[day.ymd];
        this.assignments = next;
        if (this.employees.some((e) => this.ws.hasAnySkill(e))) {
          await this.ws.saveWeek(weekStartYmd, next);
        }
      } else {
        for (const day of this.days) {
          next[day.ymd] = this.ws.normalizeDayAssignment(week.days[day.ymd], taskIds);
        }
        this.assignments = next;
      }
    } catch (e) {
      console.error('❌ loadWeekData:', e);
      this.errorMessage = 'Không tải được lịch tuần này.';
    } finally {
      this.loading = false;
    }
  }

  async refreshLiveWork(): Promise<void> {
    this.liveLoading = true;
    try {
      [this.lsxLive, this.inboundLive] = await Promise.all([
        this.ws.loadLsxWeekSummary(this.weekStart),
        this.ws.loadInboundWeekSummary(this.weekStart)
      ]);
      this.liveUpdatedAt = new Date();
    } catch (e) {
      console.warn('refreshLiveWork:', e);
    } finally {
      this.liveLoading = false;
    }
  }

  get weekRangeLabel(): string {
    if (!this.days.length) return '';
    const first = this.days[0];
    const last = this.days[6];
    return `${first.dateLabel} – ${last.dateLabel}/${last.date.getFullYear()}`;
  }

  get liveUpdatedLabel(): string {
    if (!this.liveUpdatedAt) return '';
    const d = this.liveUpdatedAt;
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  prevWeek(): void {
    const d = new Date(this.weekStart);
    d.setDate(d.getDate() - 7);
    this.weekStart = d;
    this.selectedDayYmd = '';
    void this.loadWeekData();
    void this.refreshLiveWork();
  }

  nextWeek(): void {
    const d = new Date(this.weekStart);
    d.setDate(d.getDate() + 7);
    this.weekStart = d;
    this.selectedDayYmd = '';
    void this.loadWeekData();
    void this.refreshLiveWork();
  }

  goThisWeek(): void {
    this.weekStart = this.ws.getWeekStart(new Date());
    this.selectedDayYmd = '';
    void this.loadWeekData();
    void this.refreshLiveWork();
  }

  employeeName(id: string): string {
    return this.employees.find((e) => e.id === id)?.name || '(đã xoá)';
  }

  groupColor(groupId: string | null | undefined): string {
    if (!groupId) return '#9aa5b1';
    const idx = this.groups.findIndex((g) => g.id === groupId);
    const palette = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
    return palette[idx >= 0 ? idx % palette.length : 0];
  }

  groupName(groupId: string | null | undefined): string {
    if (!groupId) return '';
    return this.groups.find((g) => g.id === groupId)?.name || '';
  }

  cellEmployeeIds(ymd: string, taskKey: WsTaskKey): string[] {
    return this.assignments[ymd]?.[taskKey] || [];
  }

  isAssigned(empId: string, taskId: string): boolean {
    return this.cellEmployeeIds(this.selectedDayYmd, taskId).includes(empId);
  }

  hasSkill(emp: WsEmployee, taskId: string): boolean {
    return !!emp.skills?.[taskId];
  }

  async toggleAssign(emp: WsEmployee, task: WsTask): Promise<void> {
    if (!this.selectedDayYmd || this.saving) return;
    const ids = [...this.cellEmployeeIds(this.selectedDayYmd, task.id)];
    const idx = ids.indexOf(emp.id);
    const enable = idx < 0;
    if (enable) ids.push(emp.id);
    else ids.splice(idx, 1);
    this.saving = true;
    try {
      if (enable && !emp.skills[task.id]) {
        emp.skills = { ...emp.skills, [task.id]: true };
        await this.ws.setEmployeeSkill(emp.id, task.id, true);
      }
      const weekStartYmd = this.ws.formatYmd(this.weekStart);
      await this.ws.setDayTaskAssignment(weekStartYmd, this.selectedDayYmd, task.id, ids);
      this.assignments[this.selectedDayYmd] = {
        ...(this.assignments[this.selectedDayYmd] || {}),
        [task.id]: ids
      };
    } catch (e) {
      console.error('❌ toggleAssign:', e);
      alert('❌ Không lưu được phân công.');
    } finally {
      this.saving = false;
    }
  }

  switchView(view: 'schedule' | 'settings'): void {
    this.activeView = view;
  }

  lsxStatusLabel(status: string): string {
    const map: Record<string, string> = {
      waiting: 'Chờ',
      delay: 'Delay',
      kitting: 'Kitting',
      ready: 'Ready',
      transfer: 'Chuyển',
      done: 'Xong'
    };
    return map[status] || status;
  }

  async addGroup(): Promise<void> {
    const name = this.newGroupName.trim();
    if (!name || this.groupSaving) return;
    this.groupSaving = true;
    try {
      await this.ws.addGroup(name);
      this.groups = await this.ws.loadGroups(true);
      this.newGroupName = '';
    } catch (e: any) {
      alert(e?.message || 'Không thêm được nhóm.');
    } finally {
      this.groupSaving = false;
    }
  }

  async renameGroupPrompt(group: WsGroup): Promise<void> {
    const name = prompt('Đổi tên nhóm:', group.name);
    if (name == null) return;
    try {
      await this.ws.renameGroup(group.id, name);
      this.groups = await this.ws.loadGroups(true);
    } catch (e: any) {
      alert(e?.message || 'Không đổi được tên nhóm.');
    }
  }

  async deleteGroupConfirm(group: WsGroup): Promise<void> {
    if (!confirm(`Xoá nhóm "${group.name}"? Nhân viên trong nhóm sẽ chuyển về "Chưa có nhóm".`)) return;
    try {
      await this.ws.deleteGroup(group.id);
      [this.groups, this.employees] = await Promise.all([this.ws.loadGroups(true), this.ws.loadEmployees(true)]);
    } catch (e: any) {
      alert(e?.message || 'Không xoá được nhóm.');
    }
  }

  async addEmployee(): Promise<void> {
    const name = this.newEmployeeName.trim();
    if (!name) return;
    try {
      await this.ws.addEmployee(name);
      this.employees = await this.ws.loadEmployees(true);
      this.newEmployeeName = '';
    } catch (e: any) {
      alert(e?.message || 'Không thêm được nhân viên.');
    }
  }

  async setEmployeeGroup(employee: WsEmployee, groupId: string): Promise<void> {
    try {
      await this.ws.updateEmployee(employee.id, { groupId: groupId || null });
      employee.groupId = groupId || null;
    } catch (e: any) {
      alert(e?.message || 'Không đổi được nhóm.');
    }
  }

  async toggleSkill(employee: WsEmployee, taskKey: WsTaskKey): Promise<void> {
    const next = !employee.skills[taskKey];
    employee.skills = { ...employee.skills, [taskKey]: next };
    try {
      await this.ws.setEmployeeSkill(employee.id, taskKey, next);
      await this.applySkillToCurrentWeek(employee.id, taskKey, next);
    } catch (e: any) {
      employee.skills = { ...employee.skills, [taskKey]: !next };
      alert(e?.message || 'Không lưu được kỹ năng.');
    }
  }

  private async applySkillToCurrentWeek(employeeId: string, taskKey: WsTaskKey, enabled: boolean): Promise<void> {
    if (!this.days.length) return;
    const next: Record<string, WsDayAssignment> = {};
    for (const day of this.days) {
      const cur = this.assignments[day.ymd] || {};
      const list = [...(cur[taskKey] || [])];
      const idx = list.indexOf(employeeId);
      if (enabled && idx < 0) list.push(employeeId);
      if (!enabled && idx >= 0) list.splice(idx, 1);
      next[day.ymd] = { ...cur, [taskKey]: list };
    }
    this.assignments = next;
    await this.ws.saveWeek(this.ws.formatYmd(this.weekStart), next);
  }

  async addTask(): Promise<void> {
    const name = this.newTaskName.trim();
    if (!name || this.taskSaving) return;
    this.taskSaving = true;
    try {
      await this.ws.addTask(name);
      this.tasks = await this.ws.loadTasks(true);
      this.newTaskName = '';
      await this.loadWeekData();
    } catch (e: any) {
      alert(e?.message || 'Không thêm được công việc.');
    } finally {
      this.taskSaving = false;
    }
  }

  async renameTaskPrompt(task: WsTask): Promise<void> {
    const name = prompt('Đổi tên công việc:', task.label);
    if (name == null) return;
    try {
      await this.ws.renameTask(task.id, name);
      this.tasks = await this.ws.loadTasks(true);
    } catch (e: any) {
      alert(e?.message || 'Không đổi được tên công việc.');
    }
  }

  async deleteTaskConfirm(task: WsTask): Promise<void> {
    if (!confirm(`Xoá công việc "${task.label}"?`)) return;
    try {
      await this.ws.deleteTask(task.id);
      this.tasks = await this.ws.loadTasks(true);
      this.employees = await this.ws.loadEmployees(true);
      await this.loadWeekData();
    } catch (e: any) {
      alert(e?.message || 'Không xoá được công việc.');
    }
  }

  async deleteEmployeeConfirm(employee: WsEmployee): Promise<void> {
    if (!confirm(`Xoá nhân viên "${employee.name}" khỏi danh sách?`)) return;
    try {
      await this.ws.deleteEmployee(employee.id);
      this.employees = this.employees.filter((e) => e.id !== employee.id);
      await this.removeEmployeeFromCurrentWeek(employee.id);
    } catch (e: any) {
      alert(e?.message || 'Không xoá được nhân viên.');
    }
  }

  private async removeEmployeeFromCurrentWeek(employeeId: string): Promise<void> {
    if (!this.days.length) return;
    const next: Record<string, WsDayAssignment> = {};
    let changed = false;
    for (const day of this.days) {
      const cur = this.assignments[day.ymd] || {};
      const row: WsDayAssignment = {};
      for (const [k, ids] of Object.entries(cur)) {
        const filtered = (ids || []).filter((id) => id !== employeeId);
        if (filtered.length !== (ids || []).length) changed = true;
        row[k] = filtered;
      }
      next[day.ymd] = row;
    }
    if (!changed) return;
    this.assignments = next;
    await this.ws.saveWeek(this.ws.formatYmd(this.weekStart), next);
  }

  trackById(_: number, item: { id: string }): string {
    return item.id;
  }
}
