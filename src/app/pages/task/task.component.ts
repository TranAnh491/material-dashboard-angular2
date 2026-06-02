import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import firebase from 'firebase/compat/app';
import { Subscription } from 'rxjs';

export type TaskPriority = 'Cao' | 'Trung bình' | 'Thấp';
export type TaskStatus = 'Chưa bắt đầu' | 'Đang thực hiện' | 'Hoàn thành' | 'Quá hạn';

export interface TaskItem {
  id?: string;
  title: string;
  description?: string;
  category?: string;
  assignedTo: string;       // userId
  assignedToName: string;
  assignedToAvatar?: string;
  createdBy: string;        // userId
  createdByName: string;
  priority: TaskPriority;
  status: TaskStatus;
  progress: number;         // 0-100
  dueDate: string;          // YYYY-MM-DD
  createdAt: firebase.firestore.Timestamp | Date;
  updatedAt?: firebase.firestore.Timestamp | Date;
  followers?: string[];
  note?: string;
}

export interface TaskFormData {
  title: string;
  description: string;
  category: string;
  assignedTo: string;
  assignedToName: string;
  priority: TaskPriority;
  status: TaskStatus;
  progress: number;
  dueDate: string;
  note: string;
}

@Component({
  selector: 'app-task',
  templateUrl: './task.component.html',
  styleUrls: ['./task.component.scss']
})
export class TaskComponent implements OnInit, OnDestroy {

  tasks: TaskItem[] = [];
  loading = false;
  error: string | null = null;

  currentUserId = '';
  currentUserName = '';

  // Tabs
  activeTab: 'all' | 'mine' | 'assigned' | 'follow' = 'all';

  // Filters
  filterStatus: string = '';
  filterPriority: string = '';
  filterAssignee: string = '';
  filterDue: string = '';

  // Create/Edit dialog
  showFormDialog = false;
  editingTask: TaskItem | null = null;
  formBusy = false;
  formData: TaskFormData = this.emptyForm();

  // Delete confirm
  deletingId: string | null = null;

  // Detail panel
  detailTask: TaskItem | null = null;

  private sub?: Subscription;
  private authSub?: Subscription;

  readonly PRIORITIES: TaskPriority[] = ['Cao', 'Trung bình', 'Thấp'];
  readonly STATUSES: TaskStatus[] = ['Chưa bắt đầu', 'Đang thực hiện', 'Hoàn thành'];
  readonly CATEGORIES = ['Nhập hàng', 'Xuất hàng', 'Kiểm kê', 'Báo cáo', 'Sắp xếp kho', 'Kiểm tra', 'Khác'];

  constructor(
    private firestore: AngularFirestore,
    private afAuth: AngularFireAuth,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.authSub = this.afAuth.user.subscribe(user => {
      this.currentUserId = user?.uid || '';
      this.currentUserName = user?.displayName || user?.email || 'Tôi';
      this.loadTasks();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.authSub?.unsubscribe();
  }

  loadTasks(): void {
    this.sub?.unsubscribe();
    this.loading = true;
    this.error = null;

    this.sub = this.firestore
      .collection<TaskItem>('task-management', ref =>
        ref.orderBy('createdAt', 'desc').limit(200)
      )
      .valueChanges({ idField: 'id' })
      .subscribe(
        data => {
          this.tasks = data.map(t => ({
            ...t,
            status: this.computeStatus(t)
          }));
          this.loading = false;
          this.cdr.markForCheck();
        },
        err => {
          this.loading = false;
          this.error = 'Không tải được dữ liệu: ' + (err?.message || err);
          this.cdr.markForCheck();
        }
      );
  }

  private computeStatus(t: TaskItem): TaskStatus {
    if (t.status === 'Hoàn thành') return 'Hoàn thành';
    const today = new Date(); today.setHours(0,0,0,0);
    const due = t.dueDate ? new Date(t.dueDate) : null;
    if (due && due < today) return 'Quá hạn';
    return t.status || 'Chưa bắt đầu';
  }

  // ── Getters ──────────────────────────────────────────────────────────────

  get filteredTasks(): TaskItem[] {
    let list = this.tasks;

    // Tab
    if (this.activeTab === 'mine')     list = list.filter(t => t.assignedTo === this.currentUserId);
    if (this.activeTab === 'assigned') list = list.filter(t => t.createdBy === this.currentUserId);
    if (this.activeTab === 'follow')   list = list.filter(t => (t.followers || []).includes(this.currentUserId));

    // Filters
    if (this.filterStatus)   list = list.filter(t => t.status === this.filterStatus);
    if (this.filterPriority) list = list.filter(t => t.priority === this.filterPriority);
    if (this.filterAssignee) list = list.filter(t => t.assignedToName?.toLowerCase().includes(this.filterAssignee.toLowerCase()));
    if (this.filterDue === 'overdue')  list = list.filter(t => t.status === 'Quá hạn');
    if (this.filterDue === 'today') {
      const today = new Date().toISOString().slice(0,10);
      list = list.filter(t => t.dueDate === today);
    }
    if (this.filterDue === 'week') {
      const d = new Date(); d.setDate(d.getDate() + 7);
      const limit = d.toISOString().slice(0,10);
      const today = new Date().toISOString().slice(0,10);
      list = list.filter(t => t.dueDate >= today && t.dueDate <= limit);
    }
    return list;
  }

  get totalCount()     { return this.tasks.length; }
  get inProgressCount(){ return this.tasks.filter(t => t.status === 'Đang thực hiện').length; }
  get doneCount()      { return this.tasks.filter(t => t.status === 'Hoàn thành').length; }
  get overdueCount()   { return this.tasks.filter(t => t.status === 'Quá hạn').length; }

  get myTasks() {
    return this.tasks.filter(t => t.assignedTo === this.currentUserId);
  }
  get myInProgress() { return this.myTasks.filter(t => t.status === 'Đang thực hiện').length; }
  get myNotDone()    { return this.myTasks.filter(t => t.status === 'Chưa bắt đầu').length; }
  get myDone()       { return this.myTasks.filter(t => t.status === 'Hoàn thành').length; }

  get overdueList() {
    return this.tasks.filter(t => t.status === 'Quá hạn').slice(0, 5);
  }

  get recentAssigned() {
    return this.tasks
      .filter(t => t.createdBy === this.currentUserId)
      .slice(0, 5);
  }

  inProgressPct(): number {
    if (!this.totalCount) return 0;
    return Math.round(this.inProgressCount / this.totalCount * 100);
  }
  donePct(): number {
    if (!this.totalCount) return 0;
    return Math.round(this.doneCount / this.totalCount * 100);
  }
  overduePct(): number {
    if (!this.totalCount) return 0;
    return Math.round(this.overdueCount / this.totalCount * 100);
  }

  // ── UI Helpers ───────────────────────────────────────────────────────────

  priorityClass(p: TaskPriority): string {
    return { 'Cao': 'pri-high', 'Trung bình': 'pri-mid', 'Thấp': 'pri-low' }[p] || '';
  }

  statusClass(s: TaskStatus): string {
    return {
      'Đang thực hiện': 'st-running',
      'Hoàn thành':     'st-done',
      'Quá hạn':        'st-overdue',
      'Chưa bắt đầu':   'st-pending'
    }[s] || '';
  }

  progressColor(p: number): string {
    if (p >= 100) return '#22c55e';
    if (p >= 60)  return '#3b82f6';
    if (p >= 30)  return '#f59e0b';
    return '#ef4444';
  }

  daysLeft(dueDate: string): string {
    if (!dueDate) return '';
    const today = new Date(); today.setHours(0,0,0,0);
    const due   = new Date(dueDate);
    const diff  = Math.round((due.getTime() - today.getTime()) / 86400000);
    if (diff < 0)  return `Quá hạn ${-diff} ngày`;
    if (diff === 0) return 'Hôm nay';
    return `Còn ${diff} ngày`;
  }

  daysClass(dueDate: string): string {
    if (!dueDate) return '';
    const today = new Date(); today.setHours(0,0,0,0);
    const due   = new Date(dueDate);
    const diff  = Math.round((due.getTime() - today.getTime()) / 86400000);
    if (diff < 0)  return 'due-over';
    if (diff <= 1) return 'due-warn';
    return '';
  }

  formatDate(d: string): string {
    if (!d) return '';
    const [y,m,day] = d.split('-');
    return `${day}/${m}/${y}`;
  }

  avatarLetters(name: string): string {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  clearFilters(): void {
    this.filterStatus = '';
    this.filterPriority = '';
    this.filterAssignee = '';
    this.filterDue = '';
  }

  hasFilters(): boolean {
    return !!(this.filterStatus || this.filterPriority || this.filterAssignee || this.filterDue);
  }

  // ── Form ─────────────────────────────────────────────────────────────────

  private emptyForm(): TaskFormData {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    return {
      title: '',
      description: '',
      category: '',
      assignedTo: '',
      assignedToName: '',
      priority: 'Trung bình',
      status: 'Chưa bắt đầu',
      progress: 0,
      dueDate: tomorrow.toISOString().slice(0,10),
      note: ''
    };
  }

  openCreateDialog(): void {
    this.editingTask = null;
    this.formData = this.emptyForm();
    this.formData.assignedTo = this.currentUserId;
    this.formData.assignedToName = this.currentUserName;
    this.showFormDialog = true;
  }

  openEditDialog(task: TaskItem, evt: Event): void {
    evt.stopPropagation();
    this.editingTask = task;
    this.formData = {
      title: task.title,
      description: task.description || '',
      category: task.category || '',
      assignedTo: task.assignedTo,
      assignedToName: task.assignedToName,
      priority: task.priority,
      status: task.status === 'Quá hạn' ? 'Đang thực hiện' : task.status,
      progress: task.progress,
      dueDate: task.dueDate,
      note: task.note || ''
    };
    this.showFormDialog = true;
    this.detailTask = null;
  }

  closeFormDialog(): void {
    this.showFormDialog = false;
    this.editingTask = null;
  }

  async saveTask(): Promise<void> {
    if (!this.formData.title.trim()) return;
    this.formBusy = true;
    try {
      const now = firebase.firestore.Timestamp.now();
      if (this.editingTask?.id) {
        await this.firestore.collection('task-management').doc(this.editingTask.id).update({
          ...this.formData,
          updatedAt: now
        });
      } else {
        await this.firestore.collection('task-management').add({
          ...this.formData,
          createdBy: this.currentUserId,
          createdByName: this.currentUserName,
          createdAt: now,
          updatedAt: now,
          followers: []
        });
      }
      this.closeFormDialog();
    } catch (e: any) {
      alert('Lỗi lưu: ' + (e?.message || e));
    } finally {
      this.formBusy = false;
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async deleteTask(id: string, evt: Event): Promise<void> {
    evt.stopPropagation();
    if (!confirm('Xóa công việc này?')) return;
    try {
      await this.firestore.collection('task-management').doc(id).delete();
      if (this.detailTask?.id === id) this.detailTask = null;
    } catch (e: any) {
      alert('Lỗi xóa: ' + (e?.message || e));
    }
  }

  // ── Quick status update ────────────────────────────────────────────────

  async markDone(task: TaskItem, evt: Event): Promise<void> {
    evt.stopPropagation();
    if (!task.id) return;
    await this.firestore.collection('task-management').doc(task.id).update({
      status: 'Hoàn thành',
      progress: 100,
      updatedAt: firebase.firestore.Timestamp.now()
    });
  }

  // ── Detail ─────────────────────────────────────────────────────────────

  openDetail(task: TaskItem): void {
    this.detailTask = this.detailTask?.id === task.id ? null : task;
  }

  closeDetail(): void { this.detailTask = null; }
}
